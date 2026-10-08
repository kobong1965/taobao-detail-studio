(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = () => crypto.randomUUID();
  const icon = (name) => `<i data-lucide="${name}"></i>`;
  const clone = (o) => structuredClone(o);
  let project, selected, zoom = .34, undoStack = [], redoStack = [], pendingImport, pendingTemplateId=null, saveTimer, activePanel = 'assets';
  let templates = [], recent = [], saveRevision = 0, saveQueue = Promise.resolve(), db;
  const bridge = window.desktopBridge;
  const coreReady=import('./core.mjs');
  let reference;
  const referenceReady=import('./reference-template.mjs').then(module=>reference=module);
  let referenceSource,referenceSourceError;
  let turntide,turntideSource,turntideSourceError;
  const turntideReady=import('./turntide-template.mjs').then(module=>turntide=module);
  let workflow,materialPicker,batchReview,templateDraft,analysisBusy=false;
  const workflowReady=import('./material-workflow.mjs').then(module=>workflow=module);
  let fileDrop,sizeRecognitionBusy=false;
  const fileDropReady=import('./file-drop.mjs').then(module=>fileDrop=module);
  let extensions,createLibraryUi;
  const libraryUiReady=import('./studio-library-ui.mjs').then(module=>createLibraryUi=module.createLibraryUi);
  let workspace,preview,builtinMetadata={},libraryEntries=[],projectGeneration=0,projectSwitch=0,sizeScanToken=0,quickScanToken=0,queuedAnalysis=false;
  const workspaceReady=import('./workspace-workflow.mjs').then(module=>workspace=module);
  const previewReady=import('./studio-preview.mjs').then(module=>preview=module);
  const imageCache = new Map();
  const font = '"Microsoft YaHei", "Segoe UI", sans-serif';
  const defaultSize = (kind) => kind === 'pants'
    ? { columns: ['尺码','裤长','腰围','臀围','脚口'], rows: [['S','99','68','100','42'],['M','101','72','104','44'],['L','103','76','108','46'],['XL','105','80','112','48']] }
    : { columns: ['尺码','衣长','胸围','肩宽','袖长'], rows: [['S','66','104','46','58'],['M','68','108','48','59'],['L','70','112','50','60'],['XL','72','116','52','61']] };
  const builtins = [{id:'top',name:'上衣 · 留白简约',kind:'top',builtin:true},{id:'pants',name:'裤装 · 留白简约',kind:'pants',builtin:true},{id:'pants-reference',name:'裤装 · 参考基础模板',kind:'pants',builtin:true,reference:true,columns:['尺码','腰围','臀围','裤长','腿围','脚围']},{id:'pants-four-blocks',name:'裤装 · 四板块模板',kind:'pants',builtin:true,family:'turntide',columns:['尺码(SIZE)','腰围','臀围','裤长','脚口']}];
  function emptySizeData(kind,templateId) {
    if(templateId==='pants-reference')return reference.referenceSizeDefaults();
    if(templateId==='pants-four-blocks')return turntide.turntideSizeDefaults();
    const columns=defaultSize(kind).columns;return {columns,rows:['S','M','L'].map(size=>columns.map((_,i)=>i===0?size:''))};
  }

  async function storage() {
    if (db) return db;
    db = await new Promise((resolve,reject)=>{
      const req = indexedDB.open('yixu-detail-studio',1);
      req.onupgradeneeded = () => req.result.createObjectStore('records');
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    return db;
  }
  async function storeGet(key) {
    if(!bridge){const r=await fetch('/api/records/'+encodeURIComponent(key));if(r.status===404)return undefined;if(!r.ok)throw new Error('工程读取失败');return r.json();}
    const d = await storage();
    return new Promise((resolve,reject)=>{const req=d.transaction('records').objectStore('records').get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  }
  async function storeSet(key,value) {
    if(!bridge){const r=await fetch('/api/records/'+encodeURIComponent(key),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});if(!r.ok)throw new Error('工程保存失败');return;}
    const d = await storage();
    return new Promise((resolve,reject)=>{const tx=d.transaction('records','readwrite');tx.objectStore('records').put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
  }
  function toast(message, error=false) {
    const node=document.createElement('div');node.className='toast'+(error?' error':'');node.setAttribute('role',error?'alert':'status');node.textContent=message;
    $('#toast-root').append(node);setTimeout(()=>node.remove(),4200);
  }
  function checkpoint() { undoStack.push(clone(project)); if(undoStack.length>18) undoStack.shift(); redoStack=[]; }
  function changed() { project.updatedAt=Date.now();$('#save-status').textContent='正在保存'; clearTimeout(saveTimer); saveTimer=setTimeout(save,450); }
  async function save() {
    const revision = ++saveRevision;project.savedTemplate=clone(template());const snapshot=clone(project);
    const task = saveQueue.catch(()=>{}).then(async()=>{
      await storeSet('current',snapshot);
      await storeSet('project:'+snapshot.id,snapshot);
      recent = [{id:snapshot.id,name:snapshot.name,updatedAt:snapshot.updatedAt},...recent.filter(p=>p.id!==snapshot.id)];
      await storeSet('recent',recent);
      if(bridge) await bridge.saveProject(snapshot);
      if(bridge?.listProjects)libraryEntries=await bridge.listProjects();
      renderRecent();
    });
    saveQueue=task;
    try { await task; if(revision===saveRevision) $('#save-status').textContent='已自动保存';return true; }
    catch { $('#save-status').textContent='保存失败';toast('工程保存失败，请检查磁盘空间后重试',true);return false; }
  }
  function loadImage(src) {
    if(imageCache.has(src)) return imageCache.get(src);
    const promise=new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('图片读取失败'));img.src=src;});
    imageCache.set(src,promise);return promise;
  }
  async function loadReferenceSource() {
    const response=await fetch('assets/pants-reference/geometry.json');
    if(!response.ok)throw new Error('原图模板坐标文件读取失败');
    const geometry=await response.json(),images={};
    for(const key of ['size','recommendation']){
      const block=geometry.blocks?.[key];
      if(!block?.asset||!block.width||!block.height||!block.table?.dataRows?.length)throw new Error('原图模板坐标资料不完整');
      images[key]=await loadImage(block.asset.startsWith('assets/')?block.asset:'assets/pants-reference/'+block.asset);
      if(images[key].naturalWidth!==block.width||images[key].naturalHeight!==block.height)throw new Error('原图模板图片与坐标不一致');
    }
    referenceSource={geometry,images};
  }
  async function loadTurntideSource(){
    const responses=await Promise.all([fetch('assets/turntide-template/manifest.json'),fetch('assets/turntide-template/geometry.json')]);
    if(responses.some(response=>!response.ok))throw new Error('四板块参考素材读取失败');
    const [manifest,geometry]=await Promise.all(responses.map(response=>response.json())),block=geometry.blocks?.size;
    if(!block?.asset||!block.table?.dataRows?.length)throw new Error('四板块尺码模板坐标不完整');
    const image=await loadImage(block.asset),footerAssets=[];
    for(const item of manifest.footer||[]){footerAssets.push(await sourceAsset(item,'footer'));}
    turntideSource={manifest,geometry,images:{size:image},footerAssets};
  }
  async function sourceAsset(item,group){
    const assetFile=item.asset||item.path,response=await fetch(assetFile);if(!response.ok)throw new Error('参考图片读取失败：'+assetFile);
    const src=await dataUrl(await response.blob()),image=await loadImage(src);
    return {id:uid(),name:item.name||assetFile.split('/').at(-1),group,src,width:image.naturalWidth,height:image.naturalHeight,assetFile,sourceX:item.sourceX??item.cropBox?.[0]??0,sourceCropWidth:item.sourceCropWidth??image.naturalWidth};
  }
  async function openFourBlockExample(){
    if(!turntideSource){toast(turntideSourceError||'四板块参考素材尚未加载',true);return;}
    clearTimeout(saveTimer);if(!await save())return;
    const previousId=project.id;
    try{
      const assets=[];for(const group of ['hero','details','models','footer'])for(const item of turntideSource.manifest[group]||[])assets.push(await sourceAsset(item,group));
      if(project.id!==previousId){toast('当前工程已切换，未打开参考示例');return;}
      const size=turntideSource.geometry.blocks.size.table;
      projectSwitch++;projectGeneration++;quickScanToken++;sizeScanToken++;analysisBusy=false;sizeRecognitionBusy=false;queuedAnalysis=false;project={id:uid(),name:'四板块 · 模板示例',kind:'pants',templateId:'pants-four-blocks',assets,coverId:assets.find(a=>a.group==='hero')?.id,elements:[],sizeData:{columns:[...size.columns],rows:clone(size.referenceSampleValues)},referenceExample:true,demo:false,updatedAt:Date.now()};
      undoStack=[];redoStack=[];createLayout();closeModal();render();showPanel('templates');$('#canvas-viewport').scrollTop=0;fitWidth();await save();toast('已打开参考示例，原工程保留在最近工程中');
    }catch(error){toast('参考示例读取失败：'+error.message,true);}
  }
  const dataUrl = async (blob) => {
    const bytes=await blob.arrayBuffer(),mime=fileDrop.sniffImageMime(bytes),normalized=new Blob([bytes],{type:mime||blob.type});
    const url=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(normalized);});
    if(mime)return url;
    const image=await loadImage(url),canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d').drawImage(image,0,0);return canvas.toDataURL('image/png');
  };
  async function demoAsset(file,name,group) {
    const response=await fetch('assets/'+file);if(!response.ok) throw new Error('演示图片不存在');
    const src=await dataUrl(await response.blob()), img=await loadImage(src);
    return {id:uid(),name,group,src,width:img.naturalWidth,height:img.naturalHeight,demo:true};
  }
  function element(type,props) {return {id:uid(),type,x:0,y:0,w:1440,h:100,locked:false,...props};}
  function allTemplates(){return [...builtins.map(t=>({...t,...builtinMetadata[t.id]})),...templates];}
  function template() { return allTemplates().find(t=>t.id===project.templateId) || builtins[0]; }
  function isTurntide(){return template().family==='turntide'||project.elements.some(e=>e.templateFamily==='turntide');}
  function ensureTurntideFooter(){const migration=turntide.trimTurntideFooter(project,turntideSource.footerAssets[0]);if(migration.changed)project=migration.project;if(!project.assets.some(a=>a.group==='footer'))project.assets.push(...turntideSource.footerAssets.map(a=>({...clone(a),id:uid()})));}
  function normalizeHeight() { project.height=Math.max(480, Math.ceil(Math.max(0,...project.elements.map(e=>e.y+e.h)))); }
  function createLayout(keepText=false) {
    const current=template();
    if(project.layoutLocked&&project.elements.length){project=workspace.fillLockedLayout(project);normalizeHeight();return;}
    if(current.layoutLocked&&current.elements){if(current.family==='turntide')ensureTurntideFooter();project.elements=current.elements.map(e=>({...clone(e),id:uid(),assetId:e.role==='footer'?project.assets.find(a=>a.group==='footer'&&a.assetFile===e.assetFile)?.id:undefined}));project.layoutLocked=true;project=workspace.fillLockedLayout(project);normalizeHeight();return;}
    const retained=keepText? project.elements.filter(e=>e.type==='text'):[];
    const cover=project.assets.find(a=>a.id===project.coverId && ['models','hero'].includes(a.group)) || project.assets.find(a=>a.group==='hero') || project.assets.find(a=>a.group==='models');
    project.coverId=cover?.id || null;
    const photos=project.assets.filter(a=>a.group==='models'&&a.id!==project.coverId);
    const details=project.assets.filter(a=>a.group==='details');
    if(current.family==='turntide'){
      if(!turntideSource)throw new Error(turntideSourceError||'四板块参考素材尚未加载');ensureTurntideFooter();
      const options={manifest:turntideSource.manifest,geometry:turntideSource.geometry,coverId:project.coverId,sizeData:project.sizeData,createId:uid,footerAsset:turntideSource.footerAssets[0]};
      const layout=current.elements?turntide.applySavedTurntideLayout(current.elements,project.assets,options):turntide.buildTurntideLayout(project.assets,options);
      project.elements=keepText?reference.preserveReferenceTextEdits(layout.elements,project.elements):layout.elements;project.coverId=layout.coverId;
    }else if(current.reference) {
      project.recommendationData ||= reference.referenceRecommendationDefaults();
      const keepLegacyStyle=keepText&&project.elements.some(e=>e.style==='reference');
      if(!keepLegacyStyle&&!referenceSource)throw new Error(referenceSourceError||'原图模板素材尚未加载');
      const layout=reference.buildReferenceLayout(project.assets,{coverId:project.coverId,sizeData:project.sizeData,recommendationData:project.recommendationData,createId:uid,sourceGeometry:keepLegacyStyle?undefined:referenceSource.geometry});
      project.elements=keepText?reference.preserveReferenceTextEdits(layout.elements,project.elements):layout.elements;project.coverId=layout.coverId;
    } else if(current.elements) {
      const slots={cover:cover?[cover]:[],models:photos,details};
      const used={cover:0,models:0,details:0};
      const result=[];let shift=0;
      for(const source of current.elements.slice().sort((a,b)=>a.y-b.y)) {
        const e=clone(source);e.id=uid();
        e.y=Math.max(0,e.y+shift);
        if(e.associatedRole&&e.associatedSlot>=slots[e.associatedRole].length){shift-=e.h;continue;}
        if(e.type==='image') {
          const role=e.role || 'models', a=slots[role]?.[used[role]++];
          if(!a){shift-=e.h;continue;}e.assetId=a.id;e.name=role==='cover'?'首张模特图':a.name;if(e.fit==='natural'){const old=e.h;e.h=Math.round(e.w*a.height/a.width);shift+=e.h-old;}
        }
        result.push(e);
      }
      for(const role of ['models','details']) for(const a of slots[role].slice(used[role])) {
        const sample=current.elements.find(e=>e.type==='image'&&e.role===role);
        const w=sample?.w || 1440,h=Math.round(w*a.height/a.width), firstDetail=role==='models'?result.find(e=>e.type==='image'&&e.role==='details'):null,y=firstDetail?.y??Math.max(0,...result.map(e=>e.y+e.h));
        for(const other of result)if(other.y>=y)other.y+=h;
        result.push(element('image',{x:sample?.x||0,y,w,h,assetId:a.id,role,fit:'natural',name:a.name}));
      }
      project.elements=result;
    } else {
      const items=[]; let y=0;
      if(cover) {
        const h=Math.round(1440*cover.height/cover.width);
        items.push(element('image',{assetId:cover.id,role:'cover',fit:'natural',name:'首张模特图',h}));y=h;
      }
      items.push(element('size',{name:'尺码表',x:64,y:y+64,w:1312,h:550}));y+=678;
      for(const a of [...photos,...details]) {
        const h=Math.round(1440*a.height/a.width);
        items.push(element('image',{assetId:a.id,role:a.group,fit:'natural',name:a.name,y,w:1440,h}));y+=h;
      }
      project.elements=[...items,...retained];
    }
    normalizeHeight();selected=project.elements.find(e=>e.type==='image')?.id || project.elements[0]?.id;
  }
  function renderSize(e) {
    return `<canvas class="size-preview" width="${e.w}" height="${e.h}" style="width:100%;height:100%" aria-label="尺码表预览"></canvas>`;
  }
  function renderCanvas() {
    normalizeHeight();
    const art=$('#artboard');art.style.width='1440px';art.style.height=project.height+'px';art.style.transform=`scale(${zoom})`;art.style.transformOrigin='top left';
    $('#canvas-stage').style.width=(1440*zoom)+'px';$('#canvas-stage').style.height=(project.height*zoom)+'px';
    art.innerHTML=project.elements.map(e=>{
      const a=project.assets.find(a=>a.id===e.assetId);
      const content=e.type==='image' ? (a?`<img src="${esc(a.src)}" alt="${esc(a.name)}" draggable="false" style="object-fit:${e.fit==='natural'&&!workspace.isStructureLocked(project,e)?'fill':'cover'};object-position:${e.cropX??50}% ${e.cropY??50}%">`:'<div class="image-missing">点击更换图片</div>')
        : e.type==='text'?`<div class="canvas-text" style="font-family:${esc(e.fontFamily||font)};font-size:${e.fontSize||60}px;color:${esc(e.color||'#252c30')};font-weight:${e.weight||500};text-align:${e.align||'left'};white-space:pre-wrap;line-height:1.3;${e.separator?`border-top:1px solid ${esc(e.separatorColor||'#dddddd')};`:''}">${esc(e.text)}</div>`:renderSize(e);
      return `<div class="canvas-element ${e.type}-element ${e.id===selected?'is-selected':''} ${workspace.isStructureLocked(project,e)?'is-locked':''}" data-element="${e.id}" role="button" tabindex="0" aria-label="选择${esc(e.name||e.text||'对象')}" style="left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${e.h}px">${content}${e.id===selected?`<span class="element-label">${esc(e.name||'文字')}</span>${e.type==='image'?`<button class="replace-inline" data-replace="${e.id}">更换图片</button>`:''}${workspace.isStructureLocked(project,e)?'':`<span class="resize-handle" data-resize="${e.id}"></span>`}`:''}</div>`;
    }).join('');
    art.querySelectorAll('.size-preview').forEach(node=>{const e=project.elements.find(e=>e.id===node.parentElement.dataset.element);drawSize(node.getContext('2d'),{...e,x:0,y:0},0);});
    const guides=$('#page-guides');guides.innerHTML='';guides.style.width=(1440*zoom)+'px';guides.style.height=(project.height*zoom)+'px';
    for(let i=1;i*1920<project.height;i++){const line=document.createElement('div');line.className='page-guide';line.style.top=(i*1920*zoom)+'px';line.innerHTML=`<span>切图 ${i} / ${i+1}</span>`;guides.append(line);}
    $('#zoom-value').textContent=Math.round(zoom*100)+'%';$('#canvas-size').textContent=`1440 × ${project.height} px`;
    $('#material-count').textContent=`${project.assets.filter(a=>!['size','footer'].includes(a.group)).length} 张素材`;
    $('#selection-label').textContent=project.elements.find(e=>e.id===selected)?.name || '未选择对象';
    $('.document-template-label').textContent=template().name+(template().reference?' · 来自参考图':template().builtin?' · 示例模板':'');
    const ruler=$('#ruler-horizontal');ruler.innerHTML='';const left=Math.max(20,($('#canvas-viewport').clientWidth-1440*zoom)/2-36);for(let i=0;i<=1440;i+=120){const tick=document.createElement('span');tick.className='ruler-tick';tick.style.left=(left+i*zoom)+'px';tick.textContent=String(i);ruler.append(tick);}
    renderInspector();renderLayers();refreshIcons();
  }
  function renderAssets() {
    const groups=isTurntide()?[['hero','独立首图'],['details','细节图'],['models','模特图']]:[['models','模特图'],['details','细节图']];
    $('#asset-list').innerHTML=`<section class="batch-upload-card"><div class="batch-upload-heading">${icon('images')}<strong>本批商品素材</strong></div><p>一起上传模特、细节和尺码图。先快速分类填图，再后台生成尺码表。</p><button class="primary-button full" data-action="import-batch">${icon('upload')}批量上传图片</button><button class="secondary-button full" data-action="analyze-batch" ${analysisBusy?'disabled':''}>${icon('scan-search')}${analysisBusy?'正在快速分类…':'重新快速分类'}</button>${project.latestBatchId?`<span class="batch-upload-count">本批 ${project.assets.filter(a=>a.batchId===project.latestBatchId).length} 张 · 素材可重复使用</span>`:''}<button class="text-link" data-action="review-batch">${project.batchAnalysis?'检查分类 / 人工二次排查':'手工分类素材'}</button><button class="text-link" data-action="browse-materials">查看全部素材库</button><div class="batch-workflow-status" role="status">${analysisBusy?'正在粗筛，完成后自动填入':project.quickScan?.status==='failed'?esc(project.quickScan.message):project.batchAnalysis?'素材已填入 · 等待人工二次检查':'支持点击或拖入图片上传'}</div>${sizeStatusMarkup()}</section>`+groups.map(([group,label])=>{
      const assets=project.assets.filter(a=>group==='hero'?(a.id===project.coverId||a.group==='hero'):a.group===group&&(!isTurntide()||group!=='models'||a.id!==project.coverId));
      return `<section class="asset-group"><div class="asset-group-head"><strong>${label}</strong><span>${assets.length} 张</span><button title="添加${label}" aria-label="添加${label}" data-action="import-${group}">${icon('plus')}</button></div><div class="asset-grid">${assets.map(a=>`<div class="asset-card ${a.id===project.coverId?'is-cover':''}" draggable="true" data-asset="${a.id}"><button class="asset-preview" data-select-asset="${a.id}" aria-label="在画布中选择${esc(a.name)}"><img src="${esc(a.src)}" alt="${esc(a.name)}">${a.id===project.coverId?'<span class="cover-badge">首图</span>':''}</button><div class="asset-name" title="${esc(a.name)}">${esc(a.name)}</div><div class="asset-meta">${a.width} × ${a.height}${a.demo?' · 示例':''}</div><div class="asset-actions"><button data-cover="${a.id}" ${group==='details'||isTurntide()?'hidden':''} title="设为首张模特图">${icon('flag')}首图</button><button data-move-asset="${a.id}" data-direction="-1" title="向前排序" aria-label="将${esc(a.name)}向前排序">${icon('arrow-left')}</button><button data-move-asset="${a.id}" data-direction="1" title="向后排序" aria-label="将${esc(a.name)}向后排序">${icon('arrow-right')}</button></div></div>`).join('') || `<button class="empty-upload" data-action="import-${group}">${icon('image-plus')}添加${label}</button>`}</div></section>`;
    }).join('')+`<section class="size-import-card"><div>${icon('table-2')}<strong>尺码表原图</strong></div><p>${project.sizeSource?'已导入原图，可重新识别或替换':'上传原图，通过你的 API 填入模板'}</p><button class="secondary-button" data-action="import-size">${icon('upload')} ${project.sizeSource?'更换尺码图':'导入尺码表'}</button>${project.sizeSource?'<button class="secondary-button" data-action="recognize-size">识别并填入</button>':''}</section><div class="demo-notice">${icon('info')}<span>${project.referenceExample?'当前为占位素材示例，请上传自己的商品图片和尺码。':project.demo?'当前为示例工程。导入素材开始制作你的详情页。':'拖动素材卡调整顺序；更新内容会保留手工位置。'}</span></div>`;
    const pending=project.assets.filter(a=>['unclassified','size','library'].includes(a.group));
    if(pending.length)$('#asset-list').insertAdjacentHTML('beforeend',`<section class="asset-group"><div class="asset-group-head"><strong>待分类 / 素材库</strong><span>${pending.length} 张</span></div><div class="asset-grid">${pending.map(a=>`<button class="asset-preview pool-preview" data-preview-material="${a.id}" title="${esc(a.name)}"><img src="${esc(a.src)}" alt="${esc(a.name)}"><span>${esc(a.name)}</span></button>`).join('')}</div></section>`);
    refreshIcons();
  }
  function renderLayers() {
    $('#layer-list').innerHTML=`<div class="panel-section-head">对象图层 <span>${project.elements.length}</span></div>`+project.elements.slice().reverse().map(e=>`<button class="layer-row ${e.id===selected?'active':''}" data-select-element="${e.id}">${icon(e.type==='image'?'image':e.type==='text'?'type':'table-2')}<span>${esc(e.name||e.text?.slice(0,16)||'文字')}</span>${e.locked?icon('lock-keyhole'):''}</button>`).join('');
  }
  function renderTemplates(){extensions.renderTemplates();}
  function renderRecent(){extensions.renderRecent();}
  function field(label,content) {return `<label class="field"><span>${label}</span>${content}</label>`;}
  function numberField(key,label,value,min=0,max=99999) {return field(label,`<input type="number" data-prop="${key}" value="${Math.round(value)}" min="${min}" max="${max}" step="1">`);}
  function tableData(e) {
    if(e?.dataKey==='recommendation')return project.recommendationData ||= reference.referenceRecommendationDefaults();
    return project.sizeData;
  }
  function renderTableEditor(e) {
    const recommendation=e.type==='table',d=tableData(e),key=recommendation?'recommendation':'size',fixed=e.style==='reference-original',flexible=e.style==='turntide-original';
    const help=flexible?'保留当前白底黑字样式。尺码和字段可扩展，常规版与加长版裤长分别保留；下方内容跟随移动。':fixed?'原图设计、测量示意、标题和表头保持原样，只修改下方数据。':recommendation?'推荐尺码由你填写，身高和体重列名、单位均可修改。':'点击表格直接修改，实测数值使用当前商品的数据。';
    return `<section class="property-section"><h3>${recommendation?'尺码推荐数据':'尺码数据'}</h3>${recommendation||fixed||flexible?'':`<div class="size-kind"><button data-kind="top" class="${project.kind==='top'?'active':''}">上衣</button><button data-kind="pants" class="${project.kind==='pants'?'active':''}">裤装</button></div>`}<p class="property-help">${help}</p><div class="editable-table-wrap"><table class="editable-size-table"><thead><tr>${d.columns.map((c,i)=>`<th><input aria-label="第${i+1}列名称" data-table-key="${key}" data-size-col="${i}" value="${esc(c)}" ${fixed?'readonly':''}></th>`).join('')}</tr></thead><tbody>${d.rows.map((row,r)=>`<tr>${d.columns.map((_,c)=>`<td><input aria-label="第${r+1}行第${c+1}列" data-table-key="${key}" data-size-cell="${r},${c}" value="${esc(row[c]??'')}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>${fixed?'':`<div class="table-actions"><button data-action="add-size-row">${icon('plus')}${recommendation?'增加推荐行':'增加尺码'}</button><button data-action="add-size-column">${icon('plus')}增加字段</button></div>`}${recommendation?'':`<button class="secondary-button full" data-action="import-size">${icon('scan-text')}更换尺码原图</button>${project.sizeSource?'<button class="primary-button full" data-action="recognize-size">识别并填入模板</button>':''}`}</section>`;
  }
  function renderInspector() {
    const e=project.elements.find(e=>e.id===selected);
    const target=$('#inspector-content');
    if(!e) {target.innerHTML=`<div class="inspector-empty">${icon('mouse-pointer-2')}<strong>选择一个对象</strong><p>在画布中选择图片、文字或尺码表，调整它的位置和样式。</p></div>`;return;}
    const a=project.assets.find(a=>a.id===e.assetId);
    target.innerHTML=`<div class="inspector-heading"><span>${icon(e.type==='image'?'image':e.type==='text'?'type':'table-2')}${e.type==='image'?'图片':e.type==='text'?'文字':e.type==='table'?'推荐表':'尺码表'}</span><button data-action="toggle-lock" title="${e.locked?'解锁':'锁定'}对象" aria-label="${e.locked?'解锁':'锁定'}对象">${icon(e.locked?'lock-keyhole':'lock-keyhole-open')}</button></div>`+
      (e.type==='image'?`<div class="selected-image-preview"><img src="${esc(a?.src||'')}" alt="所选图片"><button class="secondary-button" data-replace="${e.id}">${icon('replace')}更换图片</button></div><div class="selected-image-name">${esc(a?.name||'未添加图片')}</div>`:'')+
      `<section class="property-section"><h3>位置与尺寸 <span>px</span></h3><div class="property-grid">${numberField('x','X',e.x)}${numberField('y','Y',e.y)}${numberField('w','宽度',e.w,24,1440)}${numberField('h','高度',e.h,24)}</div><div class="align-actions"><button data-action="align-left" title="左对齐">${icon('align-start-vertical')}</button><button data-action="align-center" title="水平居中">${icon('align-center-vertical')}</button><button data-action="align-right" title="右对齐">${icon('align-end-vertical')}</button></div></section>`+
      (e.type==='image'?`<section class="property-section"><h3>图片适配</h3><div class="segmented"><button class="${e.fit==='fixed'||workspace.isStructureLocked(project,e)?'active':''}" data-fit="fixed">固定框</button><button class="${e.fit==='natural'?'active':''}" data-fit="natural">原图比例</button></div><p class="property-help">${e.fit==='natural'?'更换图片时按原图比例调整高度，下方内容跟随移动。':'保持板块大小，在框内调整图片取景位置。'}</p>${e.fit==='fixed'||workspace.isStructureLocked(project,e)?`${field('水平取景',`<input type="range" min="0" max="100" value="${e.cropX??50}" data-prop="cropX">`)}${field('垂直取景',`<input type="range" min="0" max="100" value="${e.cropY??50}" data-prop="cropY">`)}`:''}</section>`:'')+
      (e.type==='text'?`<section class="property-section"><h3>文字内容</h3>${field('内容',`<textarea data-prop="text" rows="3">${esc(e.text)}</textarea>`)}<div class="property-grid">${numberField('fontSize','字号',e.fontSize||60,12,300)}${field('颜色',`<input type="color" data-prop="color" value="${e.color||'#252c30'}">`)}</div>${field('字重',`<select data-prop="weight"><option value="400" ${e.weight===400?'selected':''}>常规</option><option value="500" ${e.weight===500?'selected':''}>中等</option><option value="700" ${e.weight===700?'selected':''}>加粗</option></select>`)}</section>`:'')+
      (e.type==='size'||e.type==='table'?renderTableEditor(e):'')+
      `<section class="property-section"><h3>图层</h3><div class="object-actions"><button data-action="bring-front">${icon('bring-to-front')}置于顶层</button><button data-action="send-back">${icon('send-to-back')}置于底层</button><button data-action="duplicate">${icon('copy')}复制对象</button><button class="danger" data-action="delete-object">${icon('trash-2')}删除对象</button></div></section>`;
    if(workspace.isStructureLocked(project,e)){
      target.insertAdjacentHTML('afterbegin','<p class="module-lock-note">模块已锁定，可更换图片、调整取景或填写尺码。</p>');
      target.querySelectorAll('[data-prop]').forEach(input=>{if(!['text','cropX','cropY'].includes(input.dataset.prop))input.disabled=true;});
      target.querySelectorAll('[data-fit],.align-actions button,.object-actions button').forEach(button=>button.disabled=true);
    }
    refreshIcons();
  }
  function render() {$('#project-name').textContent=project.name;$('#project-name').dataset.projectId=project.id;renderAssets();renderTemplates();renderRecent();renderCanvas();}
  function refreshIcons() { if(window.lucide) window.lucide.createIcons({attrs:{'stroke-width':1.65}});decorateUploadTargets(); }
  function decorateUploadTargets(){
    const modes={'import-batch':'batch','import-models':'models','import-details':'details','choose-cover':'cover','import-hero':'cover','import-size':'size','add-image':'models','picker-import':'picker'};
    document.querySelectorAll('[data-action]').forEach(node=>{const mode=modes[node.dataset.action];if(mode){node.dataset.dropMode=mode;node.title=(node.getAttribute('aria-label')||node.textContent.trim())+' · 支持拖入图片';}});
    document.querySelectorAll('[data-replace]').forEach(node=>{node.dataset.dropMode='replace';node.dataset.dropTarget=node.dataset.replace;node.title='点击选择素材，或拖入一张图片更换';});
    document.querySelectorAll('#artboard [data-element]').forEach(node=>{const e=project?.elements.find(e=>e.id===node.dataset.element);if(e?.type==='image'){node.dataset.dropMode='replace';node.dataset.dropTarget=e.id;}else if(e?.type==='size')node.dataset.dropMode='size';});
    for(const [selector,mode] of [['[data-panel="assets"]','batch'],['.batch-upload-card','batch'],['.size-import-card','size'],['#canvas-viewport','batch'],['.material-picker-dialog','picker']])document.querySelectorAll(selector).forEach(node=>node.dataset.dropMode=mode);
    document.querySelectorAll('.asset-group').forEach(node=>{const action=node.querySelector('.asset-group-head [data-action]')?.dataset.action;if(modes[action])node.dataset.dropMode=modes[action];});
    document.querySelectorAll('[data-action="recognize-size"]').forEach(node=>{node.disabled=sizeRecognitionBusy;if(sizeRecognitionBusy)node.textContent='正在识别…';});
  }
  function showPanel(panel) {
    activePanel=panel;document.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==panel);
    document.querySelectorAll('[data-nav]').forEach(b=>{const a=b.dataset.nav===panel;b.classList.toggle('active',a);b.classList.toggle('is-active',a);b.setAttribute('aria-selected',String(a));});
    if(window.innerWidth<1100)document.body.classList.add('show-side-panel');
    renderRecent();refreshIcons();
  }
  function setZoom(value) {zoom=Math.max(.12,Math.min(.85,value));renderCanvas();}
  function fitWidth() {setZoom(Math.min(.48,Math.max(.15,($('#canvas-viewport').clientWidth-120)/1440)));}
  function modal(title,body,footer='') {
    $('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header class="modal-header"><h2>${esc(title)}</h2><button data-action="close-modal" aria-label="关闭窗口">${icon('x')}</button></header><div class="modal-body">${body}</div>${footer?`<footer class="modal-footer">${footer}</footer>`:''}</section></div>`;refreshIcons();$('#modal-root').querySelector('input,button')?.focus();
  }
  function closeModal() {pendingTemplateId=null;materialPicker=null;templateDraft=null;$('#modal-root').innerHTML='';}
  function chooseFiles(mode,target=null) {pendingImport={mode,target};const input=$('#file-input');input.multiple=['models','details','batch','picker'].includes(mode);input.value='';input.click();}
  const materialAssets=()=>project.assets.filter(asset=>asset.group!=='footer');
  function openMaterialPicker(targetId=null){
    const target=targetId?project.elements.find(e=>e.id===targetId):null;
    if(targetId&&(!target||target.type!=='image')){toast('图片板块不存在',true);return;}
    materialPicker={projectId:project.id,targetId,assetId:target?.assetId||null};
    const assets=materialAssets();
    modal(target?'从本批素材更换图片':'商品素材库',`<p>选择已上传的图片。同一张图片可以用于多个板块，原素材会继续保留。</p><div class="material-picker-tools">${field('查找图片','<input id="material-search" placeholder="输入图片名称">')}${field('图片类型','<select id="material-filter"><option value="all">全部图片</option><option value="models">模特图</option><option value="details">细节图</option><option value="size">尺码图</option><option value="unclassified">待分类</option><option value="library">历史素材</option></select>')}${field('素材范围',`<select id="material-scope"><option value="all">全部已上传素材</option>${project.latestBatchId?'<option value="batch">仅本批上传</option>':''}</select>`)}</div><div class="material-picker-grid">${assets.map(asset=>{const count=project.elements.filter(e=>e.assetId===asset.id).length;return `<button class="material-option ${asset.id===materialPicker.assetId?'is-selected':''}" data-material-id="${asset.id}" aria-pressed="${asset.id===materialPicker.assetId}"><img src="${esc(asset.src)}" alt="${esc(asset.name)}"><strong>${esc(asset.name)}</strong><small>${asset.width} × ${asset.height}${count?` · 已用 ${count} 次`:' · 未使用'}</small></button>`;}).join('')||'<div class="material-empty">还没有上传图片，可以先添加本批素材。</div>'}</div><p id="material-selection-note">${target?'选择图片后，点击“使用这张图片”。':'素材库中的图片可以反复使用。'}</p>`,`<button class="secondary-button" data-action="picker-import">${icon('upload')}添加图片</button><button class="secondary-button" data-action="close-modal">关闭</button>${target?'<button class="primary-button" data-action="confirm-material">使用这张图片</button>':''}`);
    $('#modal-root .modal').classList.add('material-picker-dialog');
    decorateUploadTargets();
  }
  function filterMaterials(){
    if(!materialPicker)return;const search=($('#material-search')?.value||'').trim().toLowerCase(),group=$('#material-filter')?.value||'all',scope=$('#material-scope')?.value||'all';
    document.querySelectorAll('[data-material-id]').forEach(card=>{const asset=project.assets.find(a=>a.id===card.dataset.materialId);card.hidden=!asset||!asset.name.toLowerCase().includes(search)||(group!=='all'&&asset.group!==group)||(scope==='batch'&&asset.batchId!==project.latestBatchId);});
  }
  function confirmMaterial(){
    if(!materialPicker||materialPicker.projectId!==project.id){toast('当前工程已变化，请重新选择',true);return;}
    try{const before=project.elements.find(e=>e.id===materialPicker.targetId),oldAssetId=before.assetId,oldHeight=before.h,oldBottom=before.y+before.h,next=workflow.replaceMaterial(project,materialPicker.targetId,materialPicker.assetId);checkpoint();project=next;const current=project.elements.find(e=>e.id===materialPicker.targetId);reflowBelow(current,oldBottom,current.h-oldHeight);const old=project.assets.find(a=>a.id===oldAssetId);if(old&&old.group!=='footer'&&!project.elements.some(e=>e.assetId===old.id))old.group='library';selected=current.id;closeModal();render();changed();toast('图片已更换，素材可继续用于其他板块');}catch(error){toast(error.message,true);}
  }
  async function visionThumbnail(asset,fast=false){
    const image=await loadImage(asset.src),limit=fast?512:1600,scale=Math.min(1,limit/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',fast?.65:.95);
  }
  async function analyzeBatch(force=false){
    if(analysisBusy){queuedAnalysis=true;toast('当前粗筛完成后自动分析最新上传批次');return;}
    if(!force&&project.batchAnalysis){openBatchReview();return;}
    if(!bridge?.analyzeMaterials){toast('请在桌面版中使用自动分类',true);return;}
    const assets=materialAssets().filter(a=>project.latestBatchId?a.batchId===project.latestBatchId:a.group!=='library');
    if(!assets.length){chooseFiles('batch');return;}if(assets.length>100){toast('单批最多分析100张',true);return;}
    if(!project.latestBatchId){const batchId=uid();for(const asset of assets)asset.batchId=batchId;project.latestBatchId=batchId;}
    const token=++quickScanToken,generation=projectGeneration,request={id:project.id,batchId:project.latestBatchId,kind:project.kind,ids:assets.map(a=>a.id)};
    analysisBusy=true;project.quickScan={status:'running',batchId:request.batchId};renderAssets();changed();
    try{
      const cfg=await bridge.loadApiConfig();if(!cfg.hasKey||!cfg.model){throw new Error('先在设置中配置图片识别模型，素材已保留，可手动分类');}
      const inputs=await Promise.all(assets.map(async asset=>({id:asset.id,name:asset.name,dataUrl:await visionThumbnail(asset,true)})));
      const result=await bridge.analyzeMaterials({assets:inputs,kind:request.kind,mode:'fast'});
      if(token!==quickScanToken||generation!==projectGeneration||project.id!==request.id||project.latestBatchId!==request.batchId){return;}
      batchReview={...workflow.normalizeBatchReview(assets,result),projectId:request.id,batchId:request.batchId,quick:true};
      const previousSource=project.sizeSource;checkpoint();project=workflow.planQuickFill(project,batchReview,{batchId:request.batchId});createLayout(true);if(previousSource!==project.sizeSource){sizeScanToken++;sizeRecognitionBusy=false;}
      project.quickScan={status:'complete',batchId:request.batchId};batchReview=clone(project.batchAnalysis);batchReview.projectId=project.id;
      selected=project.elements.find(e=>e.role==='cover')?.id;render();changed();toast('素材已粗筛填入，可开始人工检查；尺码表继续后台识别');
      if(project.sizeSource)recognizeSize(true);else if(project.sizeCandidates.length>1){project.sizeScan={status:'selection-required',message:'多张尺码图，请在检查分类中选择来源'};renderAssets();changed();}
    }catch(error){if(token!==quickScanToken||generation!==projectGeneration)return;project.quickScan={status:'failed',message:error.message};renderAssets();changed();toast(error.message||'快速分类失败，素材已保留，可手动分类',true);}
    finally{if(token===quickScanToken&&generation===projectGeneration){analysisBusy=false;renderAssets();if(queuedAnalysis){queuedAnalysis=false;analyzeBatch(true);}}}
  }
  function renderBatchReview(){
    if(!batchReview)return;const labels={model:'模特图',detail:'细节图',size:'尺码图',unknown:'待分类 / 不填入'},items=batchReview.items,models=items.filter(i=>i.category==='model'),sizes=items.filter(i=>i.category==='size');
    modal('人工二次检查素材',`<div class="analysis-summary"><strong>${items.length} 张素材</strong><span>${models.length} 张模特 · ${items.filter(i=>i.category==='detail').length} 张细节 · ${sizes.length} 张尺码</span></div><p>粗筛图片已先填入，可以逐项修改分类。低置信图片留在素材库；尺码表继续独立后台识别。</p><div class="analysis-options">${field('首图',`<select id="analysis-cover"><option value="">首张模特图</option>${models.map(i=>`<option value="${i.assetId}" ${batchReview.coverAssetId===i.assetId?'selected':''}>${esc(project.assets.find(a=>a.id===i.assetId)?.name)}</option>`).join('')}</select>`)}${sizes.length>1?field('尺码图来源',`<select id="analysis-size-source"><option value="">请选择一张尺码图</option>${sizes.map(i=>`<option value="${i.assetId}" ${batchReview.selectedSizeAssetId===i.assetId?'selected':''}>${esc(project.assets.find(a=>a.id===i.assetId)?.name)}</option>`).join('')}</select>`):''}</div><div class="analysis-grid">${items.map(item=>{const asset=project.assets.find(a=>a.id===item.assetId);return `<article class="analysis-item ${item.needsReview?'needs-review':''}"><img src="${esc(asset.src)}" alt="${esc(asset.name)}"><strong>${esc(asset.name)}</strong><small>${item.confirmed?'人工已确认':item.category==='unknown'?'待分类':'粗筛填入 · 请检查'} · ${Math.round(item.confidence*100)}%</small><label>图片类型<select data-analysis-category="${item.assetId}">${Object.entries(labels).map(([value,label])=>`<option value="${value}" ${item.category===value?'selected':''}>${label}</option>`).join('')}</select></label><span>${esc(item.reason||'按图片内容确认分类')}</span></article>`;}).join('')}</div><p class="analysis-fill-note">应用分类修正会按当前模板更新图片；尺码数值在同一批次内保留。已用图片可反复选择。</p>`, '<button class="secondary-button" data-action="close-modal">返回画布检查</button><button class="primary-button" data-action="confirm-manual-review">已排查，应用分类修正</button>');$('#modal-root .modal').classList.add('batch-analysis-dialog');
  }
  function confirmBatchFill(){if(batchReview?.quick){confirmQuickReview();return;}
    if(!batchReview||batchReview.projectId!==project.id||batchReview.projectUpdatedAt!==project.updatedAt){toast('当前工程已变化，请重新分析再填入',true);return;}
    const before=clone(project),previousUndo=undoStack.slice(),previousRedo=redoStack.slice();
    try{
      const sizeElement=project.elements.find(e=>e.type==='size'),targetRows=sizeElement?.style==='reference-original'?6:undefined;
      const next=workflow.planBatchFill(project,batchReview,{mapSizeData:workflowMapSizeData,targetRows,preferredOrder:project.sizeData.rows.map(row=>row[0]),prepareSizeData:sizeElement?.style==='turntide-original'?source=>turntide.prepareTurntideSizeImport(source,{preferredOrder:project.sizeData.rows.map(row=>row[0])}):undefined});
      if(sizeElement?.style==='reference-original')next.sizeData=reference.fitOriginalReferenceData(next.sizeData,reference.referenceSizeDefaults());
      checkpoint();project=next;createLayout(true);closeModal();batchReview=null;render();changed();toast('素材分类和尺码已填入当前模板，可继续逐块修改');
    }catch(error){project=before;undoStack=previousUndo;redoStack=previousRedo;toast(error.message,true);}
  }
  let workflowMapSizeData;
  coreReady.then(module=>workflowMapSizeData=module.mapSizeData);
  async function rereadAnalysisSize(assetId){
    if(analysisBusy||!batchReview)return;const request=batchReview,asset=project.assets.find(a=>a.id===assetId);if(!asset)return;analysisBusy=true;
    try{const table=await bridge.recognizeSize({dataUrl:await visionThumbnail(asset),kind:project.kind});if(batchReview!==request||project.id!==request.projectId||project.updatedAt!==request.projectUpdatedAt){toast('工程已变化，识别结果未填入');return;}request.sizeTables=request.sizeTables.filter(item=>item.assetId!==assetId);request.sizeTables.push({assetId,table});renderBatchReview();}catch(error){toast(error.message,true);}finally{analysisBusy=false;renderAssets();}
  }
  function editTemplateDialog(){
    if(project.layoutLocked){toast('请先解锁当前模板模块，再修改排版');return;}
    const current=template();templateDraft={projectId:project.id,updatedAt:project.updatedAt,elements:clone(project.elements),template:{...clone(current),id:current.builtin?uid():current.id,name:current.builtin?current.name+' · 自定义':current.name,builtin:false,family:isTurntide()?'turntide':current.family},selected:project.elements.find(e=>e.id===selected)?.id||project.elements[0]?.id};
    modal('编辑模板并同步当前工程',`<p>调整当前版式的文字、位置和图片框。保存后模板和当前工程同时更新，图片绑定及尺码数值保留。</p>${field('模板名称',`<input id="edit-template-name" value="${esc(templateDraft.template.name)}">`)}<div class="template-edit-layout"><div class="template-element-list">${project.elements.map(e=>`<button data-template-element="${e.id}" class="${e.id===templateDraft.selected?'active':''}">${icon(e.type==='image'?'image':e.type==='text'?'type':'table-2')}<span>${esc(e.name||e.text||'对象')}</span></button>`).join('')}</div><div id="template-draft-properties"></div></div>`,`<button class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" data-action="confirm-template-sync">保存模板并同步当前工程</button>`);
    $('#modal-root .modal').classList.add('template-edit-dialog');renderTemplateDraftProperties();
  }
  function renderTemplateDraftProperties(){
    const e=templateDraft?.elements.find(item=>item.id===templateDraft.selected);if(!e)return;
    const numeric=(key,label)=>field(label,`<input type="number" data-template-prop="${key}" value="${Math.round(e[key]||0)}" min="${['w','h','fontSize'].includes(key)?1:0}" step="1">`);
    $('#template-draft-properties').innerHTML=`<h3>${esc(e.name||'模板对象')}</h3><div class="property-grid">${numeric('x','X位置')}${numeric('y','Y位置')}${numeric('w','宽度')}${numeric('h','高度')}</div>${e.type==='text'?`${field('文字内容',`<textarea data-template-prop="text" rows="4">${esc(e.text)}</textarea>`)}<div class="property-grid">${numeric('fontSize','字号')}${field('文字颜色',`<input type="color" data-template-prop="color" value="${esc(e.color||'#222222')}">`)}</div>${field('字重',`<select data-template-prop="weight">${[400,500,700].map(weight=>`<option value="${weight}" ${e.weight===weight?'selected':''}>${weight===700?'加粗':weight===500?'中等':'常规'}</option>`).join('')}</select>`)}${field('对齐',`<select data-template-prop="align">${[['left','左对齐'],['center','居中'],['right','右对齐']].map(([value,label])=>`<option value="${value}" ${e.align===value?'selected':''}>${label}</option>`).join('')}</select>`)}`:e.type==='image'?field('图片适配',`<select data-template-prop="fit"><option value="fixed" ${e.fit==='fixed'||workspace.isStructureLocked(project,e)?'selected':''}>固定图片框</option><option value="natural" ${e.fit==='natural'?'selected':''}>保持原比例</option></select>`):'<p class="property-help">尺码数值使用当前商品数据；此处只调整表格位置及尺寸。</p>'}`;
    document.querySelectorAll('[data-template-element]').forEach(button=>button.classList.toggle('active',button.dataset.templateElement===e.id));refreshIcons();
  }
  function updateTemplateDraft(input){
    const e=templateDraft?.elements.find(item=>item.id===templateDraft.selected);if(!e)return;const key=input.dataset.templateProp,value=['name','text','color','align','fit'].includes(key)?input.value:Number(input.value);if(typeof value==='number'&&!Number.isFinite(value))return;e[key]=value;
    if(e.type==='image'&&(key==='fit'||key==='w')&&e.fit==='natural'){const asset=project.assets.find(a=>a.id===e.assetId);if(asset)e.h=Math.round(e.w*asset.height/asset.width);const height=$('[data-template-prop="h"]');if(height)height.value=e.h;}
  }
  async function confirmTemplateSync(){
    if(!templateDraft||templateDraft.projectId!==project.id||templateDraft.updatedAt!==project.updatedAt){toast('当前工程已变化，请重新打开模板编辑',true);return;}
    const name=$('#edit-template-name').value.trim();if(!name){toast('请填写模板名称',true);return;}
    try{const draft={...templateDraft.template,name},result=workflow.syncTemplateDraft(project,draft,templateDraft.elements),nextTemplates=[...templates.filter(t=>t.id!==result.template.id),result.template];await storeSet('templates',nextTemplates);if(project.id!==templateDraft?.projectId||project.updatedAt!==templateDraft?.updatedAt){toast('工程已变化，模板已保存，当前工程未覆盖');return;}checkpoint();templates=nextTemplates;project=result.project;await refreshCurrentThumbnail();closeModal();render();changed();toast('模板和当前工程已同时更新，商品图片及尺码已保留');}catch(error){toast(error.message,true);}
  }
  function reflowBelow(e,oldBottom,delta) {
    if(project.layoutLocked||delta===0)return;
    if(e.grid){const peers=project.elements.filter(other=>other.grid===e.grid&&other.gridRow===e.gridRow),ids=new Set(peers.map(other=>other.id));const before=Math.max(...peers.map(other=>other.id===e.id?oldBottom:other.y+other.h)),after=Math.max(...peers.map(other=>other.y+other.h)),rowDelta=after-before;for(const other of project.elements)if(!ids.has(other.id)&&other.y>=before-1&&!other.locked)other.y=Math.max(0,other.y+rowDelta);return;}
    for(const other of project.elements) if(other.id!==e.id&&other.y>=oldBottom-1&&!other.locked) other.y=Math.max(0,other.y+delta);
  }
  function appendAssetObjects(assets) {
    if(project.layoutLocked){toast('模块已锁定，新素材保留在素材库，可手动换图');return;}
    if(isTurntide()){
      const represented=new Set(project.elements.filter(e=>e.type==='image').map(e=>e.assetId));
      const additions=assets.map(asset=>asset.id===project.coverId&&!represented.has(asset.id)?{...asset,group:'hero'}:asset);
      project.elements=turntide.appendTurntideAssets(project.elements,additions,{manifest:turntideSource.manifest,geometry:turntideSource.geometry,createId:uid});return;
    }
    const isReference=template().reference||project.elements.some(e=>['reference','reference-original'].includes(e.style));
    for(const a of assets) {
      if(isReference) {
        const {inset:x,photoWidth:w,photoGap,detailGap}=reference.REFERENCE_METRICS,h=Math.round(w*a.height/a.width);
        if(a.group==='models') {
          const heading=project.elements.find(e=>e.name==='细节展示标题'),firstDetail=project.elements.find(e=>e.role==='details');
          const y=heading?.y??firstDetail?.y??Math.max(0,...project.elements.map(e=>e.y+e.h))+photoGap;
          project.elements.forEach(e=>{if(e.y>=y)e.y+=h+photoGap;});
          project.elements.push(element('image',{name:a.name,assetId:a.id,role:'models',x,y,w,h,fit:'natural'}));
        } else {
          let y=Math.max(0,...project.elements.map(e=>e.y+e.h))+detailGap;
          if(!project.elements.some(e=>e.name==='细节展示标题')){project.elements.push(element('text',{name:'细节展示标题',text:'Detail show. / 细节展示',x,y,w,h:94,fontSize:36,align:'center',weight:400,color:'#222222'}));y+=94;}
          const index=project.elements.filter(e=>e.role==='details').length;
          project.elements.push(element('image',{name:a.name,assetId:a.id,role:'details',x,y,w,h,fit:'natural'}),element('text',{name:`细节说明 ${index+1}`,text:'细节说明',x,y:y+h+30,w,h:64,fontSize:18,align:'right',color:'#777777',associatedRole:'details',associatedSlot:index}),element('text',{name:`细节分隔线 ${index+1}`,text:'',x,y:y+h+94,w,h:1,color:'#777777',separator:true,separatorColor:'#dddddd',associatedRole:'details',associatedSlot:index}));
        }
      } else {
        const detail=a.group==='models'?project.elements.find(e=>e.role==='details'):null,y=detail?.y??Math.max(0,...project.elements.map(e=>e.y+e.h)),h=Math.round(1440*a.height/a.width);
        for(const other of project.elements)if(other.y>=y)other.y+=h;
        project.elements.push(element('image',{assetId:a.id,name:a.name,role:a.group,y,w:1440,h,fit:'natural'}));
      }
    }
  }
  function reorderGroup(group){if(project.layoutLocked||project.elements.some(e=>e.role===group&&e.locked))return;const elements=project.elements.filter(e=>e.type==='image'&&e.role===group).sort((a,b)=>a.y-b.y||a.x-b.x);if(elements.length<2)return;if(isTurntide()){const ordered=project.assets.filter(a=>a.group===group&&a.id!==project.coverId);elements.forEach((e,index)=>{const asset=ordered[index];if(!asset)return;const old=e.h,bottom=e.y+old;e.assetId=asset.id;e.name=asset.name;if(e.fit==='natural'){e.h=Math.round(e.w*asset.height/asset.width);reflowBelow(e,bottom,e.h-old);}});return;}const gaps=elements.slice(1).map((e,i)=>Math.max(0,e.y-elements[i].y-elements[i].h));let y=elements[0].y;const ordered=elements.slice().sort((a,b)=>project.assets.findIndex(p=>p.id===a.assetId)-project.assets.findIndex(p=>p.id===b.assetId));ordered.forEach((e,i)=>{e.y=y;y+=e.h+(gaps[i]||0);});}
  async function importFiles(files,explicitRequest=null) {
    if(!files.length) return;
    const request={...(explicitRequest||pendingImport)},projectId=project.id;
    try {
      files=fileDrop.validateUploadFiles(files,request.mode);
      if(request.mode==='replace'){const target=project.elements.find(e=>e.id===request.target);if(!target||target.type!=='image')throw new Error('目标图片不存在');}
      const imported=[];
      for(const file of files) {
        const src=await dataUrl(file), img=await loadImage(src);
        imported.push({id:uid(),name:file.name,src,width:img.naturalWidth,height:img.naturalHeight,group:['batch','picker'].includes(request.mode)?'unclassified':request.mode==='size'?'size':request.mode==='details'?'details':request.mode==='cover'&&isTurntide()?'hero':'models'});
      }
      if(project.id!==projectId){toast('导入期间已切换工程，请重新导入');return;}
      
      checkpoint();
      const {mode,target}=request;
      if(mode==='batch'||mode==='picker'){
        if(files.length>100)throw new Error('单批最多上传100张图片，请分批添加');
        const batchId=mode==='picker'&&project.latestBatchId?project.latestBatchId:uid();
        project.assets.push(...imported.map(asset=>({...asset,batchId,uploadedAt:Date.now()})));project.latestBatchId=batchId;
        render();changed();if(mode==='picker'){openMaterialPicker(target);toast(`已上传 ${imported.length} 张素材，可直接选择`);}else{batchReview=null;analyzeBatch(true);}return;
      }
      if(mode==='size') {
        sizeScanToken++;sizeRecognitionBusy=false;delete project.sizeScan;delete project.sizeRecognition;project.sizeRevision=(project.sizeRevision||0)+1;project.assets.push(imported[0]);project.sizeSource=imported[0].src;project.sizeSourceAssetId=imported[0].id;project.demo=false;selected=project.elements.find(e=>e.type==='size')?.id;render();changed();toast('已导入尺码原图，点击“识别并填入”使用你的 API');return;
      }
      if(mode==='replace'||(mode==='cover'&&isTurntide()&&project.elements.some(e=>e.role==='cover'))) {
        const e=mode==='cover'?project.elements.find(e=>e.role==='cover'):project.elements.find(e=>e.id===target), a=imported[0];if(!e){toast('目标图片已移除，请重新选择');return;}
        a.group=e.role==='details'?'details':e.role==='footer'?'footer':e.role==='cover'&&isTurntide()?'hero':'models';
        const old=project.assets.find(old=>old.id===e.assetId);
        project.assets.push(a);
        const oldBottom=e.y+e.h,oldHeight=e.h;e.assetId=a.id;e.name=a.name;
        if(e.fit==='natural'&&!workspace.isStructureLocked(project,e)){e.h=Math.round(e.w*a.height/a.width);reflowBelow(e,oldBottom,e.h-oldHeight);}
        if(e.role==='cover') project.coverId=a.id;
        if(old&&old.group!=='footer'&&!project.elements.some(item=>item.assetId===old.id))old.group='library';
      } else {
        const reset=project.demo||!project.elements.some(e=>e.type==='image');
        if(project.demo){project.assets=isTurntide()?project.assets.filter(a=>a.group==='footer'):[];project.elements=[];project.coverId=null;project.sizeData=emptySizeData(project.kind,project.templateId);}
        project.assets.push(...imported);
        if(mode==='cover') project.coverId=imported[0].id;
        if(!project.coverId&&mode==='models') project.coverId=imported[0].id;
        if(reset)createLayout(true);else{appendAssetObjects(imported);if(mode==='cover'&&!isTurntide()){const prev=project.elements.find(e=>e.role==='cover'),next=project.elements.find(e=>e.assetId===imported[0].id);if(prev)prev.role='models';next.role='cover';toast('已指定首图，重新套用模板可将它排到开头');}}
      }
      project.demo=false;render();changed();toast(`已${mode==='replace'?'更换':'导入'} ${imported.length} 张图片`);
    } catch(e){toast(e.message||'图片导入失败',true);}
  }
  function updateContent() {
    checkpoint();let count=0;
    for(const e of project.elements.filter(e=>e.type==='image')) {
      const a=project.assets.find(a=>a.id===e.assetId);if(!a)continue;
      if(e.fit==='natural'&&!workspace.isStructureLocked(project,e)){const old=e.h, bottom=e.y+old;e.h=Math.round(e.w*a.height/a.width);reflowBelow(e,bottom,e.h-old);}count++;
    }
    const represented=new Set(project.elements.filter(e=>e.type==='image').map(e=>e.assetId));
    appendAssetObjects(project.assets.filter(a=>!['size','footer','library','unclassified'].includes(a.group)&&!represented.has(a.id)));
    render();changed();toast('内容已更新，手工位置和文字已保留');
  }
  function autoLayout(newTemplateId=null) {
    if(project.layoutLocked){toast('当前模块已锁定，请先解锁再重新排版');return;}
    pendingTemplateId=newTemplateId;const t=allTemplates().find(t=>t.id===(newTemplateId||project.templateId))||template();
    if(t.reference&&!referenceSource){pendingTemplateId=null;toast(referenceSourceError||'原图模板素材尚未加载，请重启后重试',true);return;}
    if(t.reference&&project.sizeData.rows.length>referenceSource.geometry.blocks.size.table.dataRows.length){pendingTemplateId=null;toast('原图模板固定为 6 行尺码，当前数据超过原图行数。请先整理尺码行，或继续使用通用模板。',true);return;}
    if(t.reference&&project.recommendationData?.rows.length>referenceSource.geometry.blocks.recommendation.table.dataRows.length){pendingTemplateId=null;toast('原图推荐表固定为 4 行，当前推荐数据超过原图行数，未改变当前工程。',true);return;}
    if(t.family==='turntide'&&!turntideSource){pendingTemplateId=null;toast(turntideSourceError||'四板块参考素材尚未加载',true);return;}
    modal('重新套用模板',`<p>将按“${esc(t.name)}”重新排列当前素材。手工移动的布局会改变，原来的版本可以通过撤销恢复。</p>`,`<button class="secondary-button" data-action="close-modal">保留当前布局</button><button class="primary-button" data-action="confirm-layout">重新排版</button>`);
  }
  function saveTemplateDialog() {modal('保存新模板',`<p>保留版式、文字样式和通用内容，下一款商品使用新的图片和尺码。</p>${field('模板名称','<input id="template-name" placeholder="例如：上衣日常款">')}`,`<button class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" data-action="confirm-template">保存模板</button>`);}
  function confirmLayout(){
    const t=allTemplates().find(item=>item.id===(pendingTemplateId||project.templateId))||template();
    const before=clone(project),previousSelected=selected,previousUndo=undoStack.slice(),previousRedo=redoStack.slice();
    let committed=false;
    try{
      const columns=t.columns||defaultSize(t.kind).columns,previous=project.sizeData;
      let sizeData,recommendationData=project.recommendationData;
      if(t.family==='turntide'){if(!turntideSource)throw new Error(turntideSourceError||'四板块参考素材尚未加载');sizeData=turntide.fitTurntideSizeData(previous,{allowExpansion:true});}
      else if(t.reference){if(!referenceSource)throw new Error(referenceSourceError||'原图参考素材尚未加载');sizeData=reference.fitOriginalReferenceData(previous,reference.referenceSizeDefaults());recommendationData=reference.fitOriginalReferenceData(project.recommendationData||reference.referenceRecommendationDefaults(),reference.referenceRecommendationDefaults());}
      else{sizeData={columns:[...columns],rows:previous.rows.map(row=>columns.map(column=>row[previous.columns.indexOf(column)]??''))};if(t.recommendationColumns){const old=project.recommendationData||reference.referenceRecommendationDefaults();recommendationData={columns:[...t.recommendationColumns],rows:old.rows.map(row=>t.recommendationColumns.map(column=>row[old.columns.indexOf(column)]??''))};}}
      checkpoint();committed=true;project.templateId=t.id;project.kind=t.kind;project.layoutLocked=false;project.sizeData=sizeData;project.recommendationData=recommendationData;createLayout();project.layoutLocked=!!t.layoutLocked;closeModal();render();changed();toast('已重新套用模板，可撤销恢复之前布局');
    }catch(error){if(committed){project=before;selected=previousSelected;undoStack=previousUndo;redoStack=previousRedo;render();}toast('未改变当前工程：'+error.message,true);}
  }
  async function confirmTemplate() {
    const name=$('#template-name').value.trim();if(!name){toast('请填写模板名称',true);return;}
    const snapshot=clone(project),generation=projectGeneration,family=isTurntide()?'turntide':undefined;
    const elements=snapshot.elements.map(e=>{const item=clone(e);delete item.assetId;delete item.src;return item;});
    for(const e of elements){delete e.data;delete e.rows;delete e.values;}
    const t={id:uid(),name,kind:snapshot.kind,layoutLocked:!!snapshot.layoutLocked,thumbnail:await pageThumbnail(snapshot),elements,columns:[...snapshot.sizeData.columns],family,recommendationColumns:snapshot.recommendationData?[...snapshot.recommendationData.columns]:undefined};
    if(generation!==projectGeneration||project.id!==snapshot.id||project.updatedAt!==snapshot.updatedAt){toast('项目已变化，请重新保存当前模板');return;}
    templates.push(t);await storeSet('templates',templates);if(generation!==projectGeneration||project.id!==snapshot.id){toast('模板已保存，当前项目未覆盖');return;}project.templateId=t.id;closeModal();render();changed();toast('新模板已保存');
  }
  async function apiSettings() {
    const config=bridge?await bridge.loadApiConfig(): (await storeGet('api-public')||{});
    modal('尺码识别 API',`<div class="api-callout">${icon('scan-text')}<span>连接你自己的图片识别模型，提取尺码后直接填入模板。</span></div>${field('API 地址',`<input id="api-base" placeholder="https://你的中转站/v1" value="${esc(config.baseUrl||'')}">`)}${field('API Key',`<input id="api-key" type="password" autocomplete="off" placeholder="${config.hasKey?'已保存密钥，留空则保留':'填写你的 API Key'}">`)}${field('识别模型名称',`<input id="api-model" placeholder="填写支持图片输入的模型" value="${esc(config.model||'')}">`)}<p class="property-help">当前支持 OpenAI 兼容的图片识别接口。批量上传后自动请求快速分类，分类完成后单独识别尺码表。</p>${bridge?'':'<p class="inline-notice">网页为界面预览，实际识别在桌面版中使用。</p>'}`,`<button class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" data-action="save-api">保存配置</button>`);
  }
  async function saveApi() {
    const baseUrl=$('#api-base').value.trim(), model=$('#api-model').value.trim(),apiKey=$('#api-key').value.trim();
    try {const url=new URL(baseUrl);if(!['https:','http:'].includes(url.protocol))throw new Error();}catch{toast('请填写有效的 API 地址',true);return;}
    if(!model){toast('请填写识别模型名称',true);return;}
    try {if(bridge) await bridge.saveApiConfig({baseUrl,model,apiKey});await storeSet('api-public',{baseUrl,model});closeModal();toast(bridge?'API 配置已保存':'预览配置已保存，密钥未保存在网页中');}catch(e){toast(e.message,true);}
  }
  async function recognizeSize(background=false){
    if(!bridge){toast('请在桌面版中使用尺码识别',true);return;}if(!project.sizeSource){chooseFiles('size');return;}
    if(sizeRecognitionBusy){if(!background)toast('尺码表正在后台识别');return;}
    const request=workflow.captureSizeRecognition(project),generation=projectGeneration,token=++sizeScanToken;
    sizeRecognitionBusy=true;project.sizeScan={status:'running',batchId:request.batchId,sourceAssetId:request.sourceAssetId,message:'后台读取尺码中，可以继续检查图片'};renderAssets();changed();
    try{
      const cfg=await bridge.loadApiConfig();if(!cfg.hasKey||!cfg.model||!cfg.baseUrl)throw new Error('请在设置中配置尺码识别模型');
      const data=await bridge.recognizeSize({dataUrl:await visionThumbnail({src:request.source}),kind:request.kind});
      if(generation!==projectGeneration||token!==sizeScanToken||project.id!==request.projectId||project.sizeSource!==request.source)return;
      const {mapSizeData}=await coreReady,e=project.elements.find(item=>item.type==='size'),options={mapSizeData,preferredOrder:project.sizeData.rows.map(row=>row[0]),targetRows:e?.style==='reference-original'?referenceSource.geometry.blocks.size.table.dataRows.length:undefined,prepareSizeData:e?.style==='turntide-original'?source=>turntide.prepareTurntideSizeImport(source,{preferredOrder:project.sizeData.rows.map(row=>row[0])}):undefined};
      if(generation!==projectGeneration||token!==sizeScanToken||project.id!==request.projectId||project.sizeSource!==request.source)return;
      const result=workflow.applyBackgroundSizeResult(project,request,data,options);
      if(!result.applied){project.sizeScan={status:'pending-review',table:clone(data),sourceAssetId:request.sourceAssetId,message:'尺码已识别；你已手工改过数据，请核对后选择是否替换'};renderAssets();changed();return;}
      checkpoint();project=result.project;resizeCurrentSize();project.sizeScan={status:'complete',sourceAssetId:request.sourceAssetId,message:'尺码表已重新填入，请检查数值'};renderCanvas();renderAssets();changed();toast('后台尺码已填入，共 '+project.sizeData.rows.length+' 个尺码、'+project.sizeData.columns.length+' 个字段');
    }catch(error){if(token===sizeScanToken&&generation===projectGeneration){project.sizeScan={status:'failed',message:error.message};renderAssets();changed();toast(error.message||'尺码识别失败，可手动填写',true);}}
    finally{if(token===sizeScanToken&&generation===projectGeneration){sizeRecognitionBusy=false;renderAssets();decorateUploadTargets();}}
  }
  function resizeCurrentSize(){
    if(project.layoutLocked)return;const size=project.elements.find(e=>e.type==='size');if(!size||size.locked)return;
    if(size.style==='turntide-original'&&turntideSource){const before=project.elements.filter(e=>e.locked).map(clone),result=turntide.resizeTurntideSizeLayout(project.elements,project.sizeData,turntideSource.geometry);project.elements=result.elements;for(const locked of before){const e=project.elements.find(e=>e.id===locked.id);if(e)Object.assign(e,{x:locked.x,y:locked.y,w:locked.w,h:locked.h});}project.height=result.height;}
    else if(size.style!=='reference-original'){const old=size.h;size.h=size.style==='reference'?reference.referenceTableHeight('size',project.sizeData.rows.length):Math.max(550,250+(project.sizeData.rows.length+1)*66);reflowBelow(size,size.y+old,size.h-old);}
  }
  function exportDialog() {
    normalizeHeight();const count=Math.ceil(project.height/1920), last=project.height-(count-1)*1920;
    modal('导出详情页',`<div class="export-summary">${icon('images')}<div><strong>${count} 张 JPG 图片</strong><span>宽 1440 px，按 1920 px 连续切图</span></div></div><div class="export-measures"><span>完整画布高度</span><strong>${project.height} px</strong><span>最后一张高度</span><strong>${last} px</strong></div>${field('导出文件名称',`<input id="export-file-name" value="${esc(project.name)}" maxlength="100" placeholder="例如：秋季休闲裤">`)}<p class="property-help">切图依次命名为 名称_01.jpg、名称_02.jpg。下一步可选择任意导出位置。</p>${field('图片质量 <strong id="quality-label">92%</strong>','<input id="export-quality" type="range" min="60" max="100" value="92">')}<p class="property-help">按从上到下的顺序命名。切图不影响工程，之后仍可继续编辑。</p>${project.demo?'<p class="inline-notice">当前包含示例素材和示例尺码，请在正式使用前替换。</p>':''}${!bridge?'<p class="inline-notice">网页预览仅展示导出设置。使用桌面版可选择文件夹并导出 JPG。</p>':''}`,`<button class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" data-action="confirm-export" ${!bridge?'disabled':''}>${icon('download')}选择文件夹并导出</button>`);
  }
  function drawCover(ctx,img,e,offset,documentProject=project) {
    if(e.fit==='natural'&&!workspace.isStructureLocked(documentProject,e)){ctx.drawImage(img,e.x,e.y-offset,e.w,e.h);return;}
    const scale=Math.max(e.w/img.naturalWidth,e.h/img.naturalHeight), sw=e.w/scale, sh=e.h/scale;
    const sx=(img.naturalWidth-sw)*(e.cropX??50)/100,sy=(img.naturalHeight-sh)*(e.cropY??50)/100;
    ctx.drawImage(img,sx,sy,sw,sh,e.x,e.y-offset,e.w,e.h);
  }
  function drawText(ctx,e,offset) {
    ctx.save();ctx.beginPath();ctx.rect(e.x,e.y-offset,e.w,e.h);ctx.clip();ctx.fillStyle=e.color||'#252c30';ctx.textBaseline='top';ctx.font=`${e.weight||500} ${e.fontSize||60}px ${e.fontFamily||font}`;
    if(e.separator){ctx.fillStyle=e.separatorColor||'#dddddd';ctx.fillRect(e.x,e.y-offset,e.w,1);ctx.restore();return;}
    ctx.textAlign=e.align||'left';const lineX=e.align==='center'?e.x+e.w/2:e.align==='right'?e.x+e.w:e.x;
    const lineHeight=(e.fontSize||60)*1.3;let y=e.y-offset;
    for(const paragraph of (e.text||'').split('\n')) {
      let line='';for(const char of paragraph){if(ctx.measureText(line+char).width>e.w&&line){ctx.fillText(line,lineX,y);line=char;y+=lineHeight;}else line+=char;}ctx.fillText(line,lineX,y);y+=lineHeight;
    }ctx.restore();
  }
  function drawSize(ctx,e,offset,documentProject=project) {
    if(['reference-original','turntide-original'].includes(e.style)){drawOriginalReferenceBlock(ctx,e,offset,documentProject);return;}
    if(e.style==='reference'||e.type==='table'){drawReferenceTable(ctx,e,offset,documentProject);return;}
    ctx.save();ctx.beginPath();ctx.rect(e.x,e.y-offset,e.w,e.h);ctx.clip();ctx.fillStyle='#fff';ctx.fillRect(e.x,e.y-offset,e.w,e.h);
    const x=e.x+32,y=e.y-offset+48,w=e.w-64;
    ctx.textBaseline='top';ctx.fillStyle='#252c30';ctx.font=`600 34px ${font}`;ctx.fillText('SIZE GUIDE',x,y);ctx.font=`400 26px ${font}`;ctx.fillText('尺码参考',x+260,y+4);
    ctx.fillStyle='#6a7378';ctx.font=`400 20px ${font}`;ctx.fillText('单位：cm'+(documentProject.demo?' · 示例数据，请替换为真实尺码':''),x,y+52);
    const top=y+104,colW=w/documentProject.sizeData.columns.length,rowH=Math.max(12,Math.min(66,(e.h-250)/(documentProject.sizeData.rows.length+1)));ctx.fillStyle='#f2f4f4';ctx.fillRect(x,top,w,rowH);
    ctx.font=`500 25px ${font}`;ctx.fillStyle='#252c30';ctx.textAlign='center';
    documentProject.sizeData.columns.forEach((c,i)=>ctx.fillText(c,x+colW*(i+.5),top+18));ctx.font=`400 25px ${font}`;
    documentProject.sizeData.rows.forEach((row,r)=>{const ry=top+rowH*(r+1);row.forEach((v,c)=>ctx.fillText(String(v||''),x+colW*(c+.5),ry+18));ctx.strokeStyle='#e5e8e8';ctx.beginPath();ctx.moveTo(x,ry+rowH);ctx.lineTo(x+w,ry+rowH);ctx.stroke();});
    ctx.textAlign='left';ctx.fillStyle='#798286';ctx.font=`400 18px ${font}`;ctx.fillText(documentProject.sizeNote||'尺码数据可在右侧修改',x,top+rowH*(documentProject.sizeData.rows.length+1)+22);ctx.restore();
  }
  function drawOriginalReferenceBlock(ctx,e,offset,documentProject=project) {
    const source=e.style==='turntide-original'?turntideSource:referenceSource,key=e.sourceBlock||(e.type==='table'?'recommendation':'size'),block=source?.geometry.blocks[key],image=source?.images[key];
    if(!block||!image)throw new Error('原图模板素材读取失败，无法绘制原始尺寸块');
    const data=(e.dataKey==='recommendation'?documentProject.recommendationData:documentProject.sizeData),table=block.table;
    if(e.style==='turntide-original'){
      const plan=turntide.turntideSizePlan(data,source.geometry,{width:e.w});
      if(plan.mode==='expanded'){
        ctx.save();ctx.beginPath();ctx.rect(e.x,e.y-offset,e.w,e.h);ctx.clip();ctx.translate(e.x,e.y-offset);ctx.scale(e.w/plan.sourceWidth,e.h/plan.sourceHeight);ctx.fillStyle='#fff';ctx.fillRect(0,0,plan.sourceWidth,plan.sourceHeight);
        for(const s of plan.backgroundSlices)ctx.drawImage(image,s.sx,s.sy,s.sw,s.sh,s.dx,s.dy,s.dw,s.dh);
        ctx.fillStyle='#000';ctx.textAlign='center';ctx.textBaseline='alphabetic';
        if(!plan.copyHeader)for(const header of plan.headers){ctx.font=`${header.font.weight||700} ${header.font.size}px ${header.font.family}`;header.lines.forEach((line,i)=>ctx.fillText(line,header.centerX,header.baselines[i]));}
        for(const row of plan.rows)for(const cell of row.cells){ctx.font=`${cell.font.weight||400} ${cell.font.size}px ${cell.font.family}`;ctx.fillText(cell.value,cell.centerX,cell.baselineY);}
        ctx.restore();return;
      }
    }
    if(data.rows.length>table.dataRows.length||data.columns.length>table.columns.length)throw new Error('当前数据超过原图模板固定行列，未导出；请使用通用模板');
    ctx.save();ctx.beginPath();ctx.rect(e.x,e.y-offset,e.w,e.h);ctx.clip();ctx.translate(e.x,e.y-offset);ctx.scale(e.w/block.width,e.h/block.height);
    ctx.drawImage(image,0,0,block.width,block.height);
    for(const row of table.dataRows){ctx.fillStyle=row.background;for(const mask of row.cellMasks||[])ctx.fillRect(mask.left,mask.top,mask.right-mask.left,mask.bottom-mask.top);}
    const sourceFont=table.font;ctx.fillStyle=sourceFont.color;ctx.font=`${sourceFont.weight||400} ${sourceFont.size}px ${sourceFont.family}`;ctx.textBaseline=sourceFont.textBaseline||'alphabetic';ctx.textAlign=sourceFont.textAlign||'center';
    table.dataRows.forEach((row,r)=>table.columns.forEach((column,c)=>{
      const value=String(data.rows[r]?.[c]??'');if(!value)return;
      const left=table.colBounds[c],right=table.colBounds[c+1];ctx.save();ctx.beginPath();ctx.rect(left+1,row.top+1,right-left-2,row.bottom-row.top-2);ctx.clip();ctx.fillText(value,table.columnCenters[c],row.cellBaselineY?.[c]??row.baselineY??row.centerY,right-left-6);ctx.restore();
    }));
    ctx.restore();
  }
  function drawReferenceTable(ctx,e,offset,documentProject=project) {
    ctx.save();ctx.beginPath();ctx.rect(e.x,e.y-offset,e.w,e.h);ctx.clip();ctx.fillStyle='#ffffff';ctx.fillRect(e.x,e.y-offset,e.w,e.h);
    const scale=e.w/1356,d=(e.dataKey==='recommendation'?documentProject.recommendationData:documentProject.sizeData),recommendation=e.type==='table';ctx.translate(e.x,e.y-offset);ctx.scale(scale,scale);ctx.textBaseline='top';ctx.fillStyle='#222222';ctx.font=`700 29px ${font}`;
    ctx.fillText(recommendation?'· 尺码推荐':'· 实测尺寸',0,12);
    const tableX=recommendation?0:324,tableY=68,tableW=1356-tableX,rowH=recommendation?48:50,colW=tableW/d.columns.length;
    ctx.textAlign='center';ctx.font=`500 ${recommendation?22:24}px ${font}`;ctx.fillStyle='#e9e9e9';ctx.fillRect(tableX,tableY,tableW,rowH);
    ctx.fillStyle='#222222';d.columns.forEach((c,i)=>ctx.fillText(String(c),tableX+colW*(i+.5),tableY+13));ctx.font=`400 ${recommendation?22:24}px ${font}`;
    d.rows.forEach((row,r)=>{const top=tableY+(r+1)*rowH;ctx.fillStyle=r%2?'#f0f0f0':'#fafafa';ctx.fillRect(tableX,top,tableW,rowH);ctx.fillStyle='#222222';d.columns.forEach((_,c)=>ctx.fillText(String(row[c]??''),tableX+colW*(c+.5),top+13));});
    ctx.textAlign='left';ctx.fillStyle='#777777';ctx.font=`400 18px ${font}`;
    const noteY=tableY+(d.rows.length+1)*rowH+18;
    ctx.fillText(recommendation?'身高、体重单位和推荐尺码请按商品资料填写':documentProject.sizeNote||'单位：cm · 实测数据请按当前商品填写',tableX,noteY);
    if(!recommendation) {
      ctx.save();ctx.translate(22,74);ctx.strokeStyle='#777777';ctx.lineWidth=2;ctx.lineJoin='round';
      ctx.beginPath();ctx.moveTo(62,0);ctx.lineTo(208,0);ctx.lineTo(232,40);ctx.lineTo(221,332);ctx.lineTo(159,332);ctx.lineTo(145,115);ctx.lineTo(128,332);ctx.lineTo(66,332);ctx.lineTo(39,40);ctx.closePath();ctx.stroke();
      ctx.beginPath();ctx.moveTo(62,0);ctx.lineTo(60,36);ctx.lineTo(212,36);ctx.lineTo(208,0);ctx.moveTo(134,36);ctx.lineTo(139,88);ctx.lineTo(145,115);ctx.moveTo(62,36);ctx.quadraticCurveTo(76,70,92,72);ctx.moveTo(211,36);ctx.quadraticCurveTo(196,70,180,72);ctx.stroke();
      ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(44,58);ctx.lineTo(224,58);ctx.moveTo(35,112);ctx.lineTo(145,112);ctx.moveTo(17,0);ctx.lineTo(17,332);ctx.moveTo(159,315);ctx.lineTo(221,315);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle='#222222';ctx.font=`400 17px ${font}`;ctx.fillText('①',126,10);ctx.fillText('②',110,62);ctx.fillText('⑥',78,117);ctx.fillText('③',-8,159);ctx.fillText('⑧',180,314);
      ['① 腰围','② 臀围','③ 裤长','④ 前档','⑤ 后档','⑥ 大腿围','⑦ 小腿围','⑧ 裤脚宽'].forEach((label,index)=>ctx.fillText(label,(index%2)*145-12,354+Math.floor(index/2)*26));
      ctx.restore();
    }
    ctx.restore();
  }
  async function confirmExport() {
    const button=document.querySelector('[data-action="confirm-export"]');button.disabled=true;button.textContent='正在生成…';
    const quality=Number($('#export-quality').value)/100,fileName=$('#export-file-name').value.trim(),snapshot=clone(project);if(!fileName){toast('请填写导出文件名称',true);button.disabled=false;button.textContent='选择文件夹并导出';return;}
    try {
      const files=[],canvas=document.createElement('canvas');canvas.width=1440;
      for(let offset=0,index=1;offset<snapshot.height;offset+=1920,index++) {
        canvas.height=Math.min(1920,snapshot.height-offset);const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
        for(const e of snapshot.elements){if(e.y+e.h<=offset||e.y>=offset+canvas.height)continue;if(e.type==='image'){const a=snapshot.assets.find(a=>a.id===e.assetId);if(a)drawCover(ctx,await loadImage(a.src),e,offset,snapshot);}else if(e.type==='text')drawText(ctx,e,offset);else drawSize(ctx,e,offset,snapshot);}
        files.push({name:`detail_${String(index).padStart(2,'0')}.jpg`,dataUrl:canvas.toDataURL('image/jpeg',quality)});
      }
      const result=await bridge.exportJpgs({projectName:snapshot.name,fileName,files});if(result.ok){closeModal();toast(`已导出 ${result.count} 张 JPG：${result.path}`);}else{button.disabled=false;button.textContent='选择文件夹并导出';}
    }catch(e){toast(e.message||'导出失败，请重试',true);button.disabled=false;button.textContent='选择文件夹并导出';}
  }
  function mutateSelected(fn) {const e=project.elements.find(e=>e.id===selected);if(!e)return;if(workspace.isStructureLocked(project,e)&&!fn.unlock){toast('对象已锁定，请先解锁');return;}checkpoint();fn(e);renderCanvas();changed();}
  function handleAction(action) {
    if(['add-text','add-image','confirm-layout','add-size-row','add-size-column'].includes(action)&&project.layoutLocked){toast('模块已锁定，请先解锁再修改结构');return;}
    if(action==='save-project'){saveExplicit();return;}
    if(action==='save-and-export'){saveExplicit(true);return;}
    if(action==='export-project'){projectFileDialog();return;}
    if(action==='confirm-export-project'){exportProjectFile();return;}
    if(action==='import-project'){importProjectFile();return;}
    if(action==='toggle-template-lock'){toggleTemplateLock();return;}
    if(action==='confirm-rename-template'){confirmRenameTemplate();return;}
    if(action==='review-batch'){openBatchReview();return;}
    if(action==='review-background-size'){showPendingSize();return;}
    if(action==='apply-background-size'){applyPendingSize();return;}
    if(action==='confirm-manual-review'){confirmQuickReview();return;}
    if(action==='close-modal'){closeModal();return;}
    if(action==='import-batch'){chooseFiles('batch');return;}
    if(action==='analyze-batch'){analyzeBatch(true);return;}
    if(action==='reanalyze-batch'){batchReview=null;analyzeBatch(true);return;}
    if(action==='confirm-batch-fill'){confirmBatchFill();return;}
    if(action==='browse-materials'){openMaterialPicker();return;}
    if(action==='confirm-material'){confirmMaterial();return;}
    if(action==='picker-import'){chooseFiles('picker',materialPicker?.targetId||null);return;}
    if(action==='edit-template'){editTemplateDialog();return;}
    if(action==='confirm-template-sync'){confirmTemplateSync();return;}
    if(action==='toggle-theme'){const theme=document.body.dataset.theme==='dark'?'light':'dark';document.body.dataset.theme=theme;storeSet('theme',theme);refreshIcons();return;}
    if(action==='choose-cover'||action==='import-hero'){chooseFiles('cover');return;}
    if(action==='import-models'||action==='import-details'){chooseFiles(action==='import-models'?'models':'details');return;}
    if(action==='import-size'){chooseFiles('size');return;}
    if(action==='add-image'){chooseFiles('models');return;}
    if(action==='auto-layout'){autoLayout();return;}
    if(action==='confirm-layout'){confirmLayout();return;}
    if(action==='update-content'){updateContent();return;}if(action==='open-four-block-example'){openFourBlockExample();return;}
    if(action==='export'){exportDialog();return;}
    if(action==='confirm-export'){confirmExport();return;}
    if(action==='api-settings'){apiSettings();return;}
    if(action==='save-api'){saveApi();return;}
    if(action==='recognize-size'){recognizeSize();return;}
    if(action==='save-template'){saveTemplateDialog();return;}
    if(action==='confirm-template'){confirmTemplate();return;}
    if(action==='zoom-in'){setZoom(zoom+.05);return;}
    if(action==='zoom-out'){setZoom(zoom-.05);return;}
    if(action==='fit-width'){fitWidth();return;}
    if(action==='undo'||action==='redo') {const source=action==='undo'?undoStack:redoStack,target=action==='undo'?redoStack:undoStack;if(!source.length){toast('没有可'+(action==='undo'?'撤销':'重做')+'的操作');return;}target.push(clone(project));project=source.pop();render();changed();return;}
    if(action==='add-text'){checkpoint();const e=element('text',{name:'文字',text:'输入你的文字',x:100,y:Math.max(80,$('#canvas-viewport').scrollTop/zoom+140),w:1100,h:160,fontSize:60,weight:500,color:'#252c30'});project.elements.push(e);selected=e.id;renderCanvas();changed();return;}
    if(action==='new-project'){modal('新建商品工程',`${field('商品或款号','<input id="new-name" placeholder="例如：宽松圆领卫衣">')}${field('商品类型','<select id="new-kind"><option value="top">上衣</option><option value="pants">裤装</option></select>')}`,`<button class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" data-action="confirm-new">创建工程</button>`);return;}
    if(action==='confirm-new'){const name=$('#new-name').value.trim();if(!name){toast('请填写商品或款号');return;}const kind=$('#new-kind').value,templateId=kind==='pants'?'pants-four-blocks':kind;if(kind==='pants'&&!turntideSource){toast(turntideSourceError||'四板块模板素材尚未加载',true);return;}save().then(ok=>{if(!ok)return;projectSwitch++;projectGeneration++;queuedAnalysis=false;sizeScanToken++;quickScanToken++;analysisBusy=false;sizeRecognitionBusy=false;project={id:uid(),name,kind,templateId,assets:[],elements:[],sizeData:emptySizeData(kind,templateId),recommendationData:undefined,demo:false,height:678,updatedAt:Date.now()};undoStack=[];redoStack=[];createLayout();closeModal();render();changed();toast('工程已创建，导入模特图开始排版');});return;}
    if(action==='add-size-row'){const e=project.elements.find(e=>e.id===selected&&['size','table'].includes(e.type))||project.elements.find(e=>e.type==='size');if(!e)return;if(e.style==='reference-original'){toast('旧原图模板保留固定行数，可使用四板块模板增加行');return;}checkpoint();const d=tableData(e);d.rows.push(d.columns.map(()=>''));if(e.style==='turntide-original')resizeCurrentSize();else{const bottom=e.y+e.h,delta=e.style==='reference'?(e.type==='table'?48:50):66;e.h+=delta;reflowBelow(e,bottom,delta);}renderCanvas();changed();return;}
    if(action==='add-size-column'){const e=project.elements.find(e=>e.id===selected&&['size','table'].includes(e.type))||project.elements.find(e=>e.type==='size');if(!e)return;if(e.style==='reference-original'){toast('旧原图模板保留原始表头，可使用四板块模板增加字段');return;}checkpoint();const d=tableData(e);d.columns.push('新字段');d.rows.forEach(r=>r.push(''));resizeCurrentSize();renderCanvas();changed();return;}
    if(action==='toggle-lock'){if(project.layoutLocked){toast('请在模板板块解锁模块');return;}const e=project.elements.find(e=>e.id===selected);if(e){checkpoint();e.locked=!e.locked;renderCanvas();changed();}return;}
    if(action==='delete-object'){mutateSelected(e=>{project.elements=project.elements.filter(item=>item.id!==e.id);selected=null;});return;}
    if(action==='duplicate'){mutateSelected(e=>{const copy={...clone(e),id:uid(),x:Math.min(1440-e.w,e.x+32),y:e.y+32};project.elements.push(copy);selected=copy.id;});return;}
    if(action==='bring-front'){mutateSelected(e=>{project.elements=project.elements.filter(item=>item.id!==e.id);project.elements.push(e);});return;}
    if(action==='send-back'){mutateSelected(e=>{project.elements=project.elements.filter(item=>item.id!==e.id);project.elements.unshift(e);});return;}
    if(action.startsWith('align-')){mutateSelected(e=>{e.x=action==='align-left'?0:action==='align-center'?Math.round((1440-e.w)/2):1440-e.w;});}
  }
  document.addEventListener('click',async event=>{
    const rename=event.target.closest('[data-action="rename-template"]');if(rename){renameTemplateDialog(rename.dataset.templateId);return;}
    const view=event.target.closest('[data-action="preview-template"]');if(view){previewTemplate(view.dataset.templateId);return;}
    const analysisRead=event.target.closest('[data-action="analysis-recognize-size"]');if(analysisRead){rereadAnalysisSize(analysisRead.dataset.sizeAsset);return;}
    const material=event.target.closest('[data-material-id]');if(material&&materialPicker){materialPicker.assetId=material.dataset.materialId;document.querySelectorAll('[data-material-id]').forEach(card=>{card.classList.toggle('is-selected',card===material);card.setAttribute('aria-pressed',String(card===material));});$('#material-selection-note').textContent=project.assets.find(a=>a.id===materialPicker.assetId)?.name||'';return;}
    const draftObject=event.target.closest('[data-template-element]');if(draftObject&&templateDraft){templateDraft.selected=draftObject.dataset.templateElement;renderTemplateDraftProperties();return;}
    const previewMaterial=event.target.closest('[data-preview-material]');if(previewMaterial){openMaterialPicker();return;}
    const action=event.target.closest('[data-action]');if(action){handleAction(action.dataset.action);return;}
    const nav=event.target.closest('[data-nav]');if(nav){showPanel(nav.dataset.nav);return;}
    const replace=event.target.closest('[data-replace]');if(replace){openMaterialPicker(replace.dataset.replace);return;}
    const select=event.target.closest('[data-select-element]');if(select){selected=select.dataset.selectElement;renderCanvas();return;}
    const asset=event.target.closest('[data-select-asset]');if(asset){const e=project.elements.find(e=>e.assetId===asset.dataset.selectAsset);if(e){selected=e.id;renderCanvas();$('#canvas-viewport').scrollTop=Math.max(0,e.y*zoom-70);}return;}
    const cover=event.target.closest('[data-cover]');if(cover){checkpoint();const previous=project.coverId;project.coverId=cover.dataset.cover;const first=project.elements.find(e=>e.role==='cover'),other=project.elements.find(e=>e.type==='image'&&e.assetId===project.coverId&&e!==first);if(first){first.assetId=project.coverId;if(other)other.assetId=previous;}render();changed();toast('首张模特图已更换，板块位置保留');return;}
    const move=event.target.closest('[data-move-asset]');if(move){const a=project.assets.find(a=>a.id===move.dataset.moveAsset), group=project.assets.filter(p=>p.group===a.group),idx=group.indexOf(a),other=group[idx+Number(move.dataset.direction)];if(other){checkpoint();const i=project.assets.indexOf(a),j=project.assets.indexOf(other);[project.assets[i],project.assets[j]]=[project.assets[j],project.assets[i]];reorderGroup(a.group);render();changed();}return;}
    const fit=event.target.closest('[data-fit]');if(fit){mutateSelected(e=>{const bottom=e.y+e.h,old=e.h;e.fit=fit.dataset.fit;if(e.fit==='natural'){const a=project.assets.find(a=>a.id===e.assetId);if(a)e.h=Math.round(e.w*a.height/a.width);reflowBelow(e,bottom,e.h-old);}});return;}
    const kind=event.target.closest('[data-kind]');if(kind){if(project.kind===kind.dataset.kind)return;checkpoint();project.kind=kind.dataset.kind;project.templateId=project.kind;project.sizeData={columns:defaultSize(project.kind).columns,rows:project.sizeData.rows.map(r=>defaultSize(project.kind).columns.map((_,i)=>i===0?r[0]:''))};render();changed();toast('已切换尺码字段，请填写对应数据');return;}
    const t=event.target.closest('[data-template]');if(t){autoLayout(t.dataset.template);return;}
    const open=event.target.closest('[data-open-project]');if(open){await openLibraryProject(open.dataset.openProject);return;}
    const e=event.target.closest('[data-element]');if(e&&!event.target.closest('[data-resize]')){selected=e.dataset.element;renderCanvas();}
  });
  document.addEventListener('change',event=>{
    const input=event.target;
    if(['material-filter','material-scope'].includes(input.id)){filterMaterials();return;}
    if(input.dataset.templateProp){updateTemplateDraft(input);return;}
    if(input.dataset.analysisCategory&&batchReview){const item=batchReview.items.find(i=>i.assetId===input.dataset.analysisCategory);item.category=input.value;item.needsReview=false;item.confirmed=true;if(input.value!=='size'&&batchReview.selectedSizeAssetId===item.assetId)batchReview.selectedSizeAssetId=null;if(input.value==='size'&&!batchReview.sizeTables.some(t=>t.assetId===item.assetId))batchReview.sizeTables.push({assetId:item.assetId,table:{columns:[...project.sizeData.columns],rows:project.sizeData.rows.map(row=>row.map((value,c)=>c===0?value:''))}});renderBatchReview();return;}
    if(input.id==='analysis-cover'&&batchReview){batchReview.coverAssetId=input.value||null;return;}
    if(input.id==='analysis-size-source'&&batchReview){batchReview.selectedSizeAssetId=input.value||null;return;}
    if(input.dataset.analysisCell||input.dataset.analysisCol){updateAnalysisCell(input);return;}
    if(input.id==='file-input'){importFiles([...input.files]);return;}
    if(input.dataset.prop){const e=project.elements.find(e=>e.id===selected);if(!e||(workspace.isStructureLocked(project,e)&&!['text','cropX','cropY'].includes(input.dataset.prop)))return;if(!input.dataset.editing)checkpoint();const prop=input.dataset.prop,value=['text','color','align'].includes(prop)?input.value:Number(input.value);if(typeof value==='number'&&!Number.isFinite(value))return;
      e[prop]=value;if(prop==='w'){e.w=Math.min(1440,Math.max(24,e.w));if(e.fit==='natural'){const a=project.assets.find(a=>a.id===e.assetId);if(a){const old=e.h,bottom=e.y+old;e.h=Math.round(e.w*a.height/a.width);reflowBelow(e,bottom,e.h-old);}}}e.x=Math.max(0,Math.min(1440-e.w,e.x));e.y=Math.max(0,e.y);e.h=Math.max(24,e.h);renderCanvas();changed();return;}
    if(input.dataset.sizeCell){project.sizeRevision=(project.sizeRevision||0)+1;checkpoint();const [r,c]=input.dataset.sizeCell.split(',').map(Number),d=tableData({dataKey:input.dataset.tableKey});d.rows[r][c]=input.value;renderCanvas();changed();return;}
    if(input.dataset.sizeCol){project.sizeRevision=(project.sizeRevision||0)+1;if(project.elements.find(e=>e.id===selected)?.style==='reference-original')return;checkpoint();tableData({dataKey:input.dataset.tableKey}).columns[Number(input.dataset.sizeCol)]=input.value;resizeCurrentSize();renderCanvas();changed();}
  });
  function updateAnalysisCell(input){if(!batchReview)return;const parts=(input.dataset.analysisCell||input.dataset.analysisCol).split(':'),table=batchReview.sizeTables.find(t=>t.assetId===parts[0])?.table;if(!table)return;if(input.dataset.analysisCell)table.rows[Number(parts[1])][Number(parts[2])]=input.value;else table.columns[Number(parts[1])]=input.value;}
  document.addEventListener('input',event=>{const input=event.target;if(input.id==='project-search'){filterProjects();return;}if(input.dataset.sizeCell){const [r,c]=input.dataset.sizeCell.split(',').map(Number),d=tableData({dataKey:input.dataset.tableKey});if(!input.dataset.editing){checkpoint();input.dataset.editing='true';}d.rows[r][c]=input.value;project.sizeRevision=(project.sizeRevision||0)+1;changed();return;}if(input.id==='material-search'){filterMaterials();return;}if(input.dataset.sizeCol){const d=tableData({dataKey:input.dataset.tableKey});if(!input.dataset.editing){checkpoint();input.dataset.editing='true';}d.columns[Number(input.dataset.sizeCol)]=input.value;project.sizeRevision=(project.sizeRevision||0)+1;changed();return;}if(input.dataset.templateProp){updateTemplateDraft(input);return;}if(input.dataset.analysisCell||input.dataset.analysisCol){updateAnalysisCell(input);return;}if(input.id==='export-quality'){$('#quality-label').textContent=input.value+'%';return;}if(input.dataset.prop==='text'){const e=project.elements.find(e=>e.id===selected);if(!e)return;if(!input.dataset.editing){checkpoint();input.dataset.editing='true';}e.text=input.value;const text=$(`#artboard [data-element="${e.id}"] .canvas-text`);if(text)text.textContent=e.text;changed();}});
  document.addEventListener('focusout',event=>{if(event.target.id==='project-name'){const name=event.target.textContent.trim();if(name&&name!==project.name){checkpoint();project.name=name;changed();}}});
  let dragging;
  document.addEventListener('pointerdown',event=>{
    if(event.button!==0||event.target.closest('button'))return;
    const node=event.target.closest('[data-element]');if(!node)return;
    const e=project.elements.find(e=>e.id===node.dataset.element);if(!e||workspace.isStructureLocked(project,e))return;
    checkpoint();selected=e.id;dragging={e,node,x:event.clientX,y:event.clientY,initial:clone(e),resize:!!event.target.dataset.resize};node.setPointerCapture(event.pointerId);event.preventDefault();
  });
  document.addEventListener('pointermove',event=>{
    if(!dragging)return;const d=dragging,dx=(event.clientX-d.x)/zoom,dy=(event.clientY-d.y)/zoom;
    if(d.resize){d.e.w=Math.min(1440-d.e.x,Math.max(80,d.initial.w+dx));d.e.h=d.e.fit==='natural'?d.e.w*(d.initial.h/d.initial.w):Math.max(40,d.initial.h+dy);d.node.style.width=d.e.w+'px';d.node.style.height=d.e.h+'px';}
    else{d.e.x=Math.round(Math.max(0,Math.min(1440-d.e.w,d.initial.x+dx)));d.e.y=Math.round(Math.max(0,d.initial.y+dy));d.node.style.left=d.e.x+'px';d.node.style.top=d.e.y+'px';}
  });
  document.addEventListener('pointerup',()=>{if(dragging){const current=dragging;if(current.resize&&current.e.grid)reflowBelow(current.e,current.initial.y+current.initial.h,current.e.h-current.initial.h);dragging=null;renderCanvas();changed();}});
  let draggedAsset;
  document.addEventListener('dragstart',event=>{const item=event.target.closest('[data-asset]');if(item){draggedAsset=item.dataset.asset;event.dataTransfer.effectAllowed='move';}});
  function clearFileDrag(){document.querySelectorAll('.file-drop-active').forEach(node=>node.classList.remove('file-drop-active'));}
  function activeFileTarget(event){
    const target=fileDrop.dropTarget(event.target),modalNode=$('#modal-root .modal');
    if(modalNode&&(!modalNode.classList.contains('material-picker-dialog')||!modalNode.contains(event.target)))return null;
    return target;
  }
  document.addEventListener('dragover',event=>{
    if(!fileDrop?.hasExternalFiles(event.dataTransfer))return;event.preventDefault();clearFileDrag();const target=activeFileTarget(event);event.dataTransfer.dropEffect=target?'copy':'none';if(target)target.element.classList.add('file-drop-active');
  });
  document.addEventListener('dragleave',event=>{if(event.target.closest?.('.file-drop-active')&&!event.target.closest('.file-drop-active').contains(event.relatedTarget))clearFileDrag();});
  document.addEventListener('dragend',clearFileDrag);
  document.addEventListener('drop',event=>{
    if(!fileDrop?.hasExternalFiles(event.dataTransfer))return;event.preventDefault();event.stopImmediatePropagation();clearFileDrag();draggedAsset=null;
    const target=activeFileTarget(event);if(!target){toast('请把图片拖入上传区域或要更换的图片板块');return;}
    const request={mode:target.mode,target:target.target||(target.mode==='picker'?materialPicker?.targetId:null)};
    importFiles(fileDrop.filesFromDrop(event.dataTransfer),request);
  });
  document.addEventListener('dragover',event=>{if(event.target.closest('[data-asset]'))event.preventDefault();});
  document.addEventListener('drop',event=>{const target=event.target.closest('[data-asset]');if(target&&draggedAsset&&draggedAsset!==target.dataset.asset){event.preventDefault();const i=project.assets.findIndex(a=>a.id===draggedAsset),j=project.assets.findIndex(a=>a.id===target.dataset.asset);if(i>=0&&j>=0&&project.assets[i].group===project.assets[j].group){checkpoint();const [a]=project.assets.splice(i,1);project.assets.splice(j,0,a);reorderGroup(a.group);render();changed();}}draggedAsset=null;});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){closeModal();return;}
    if(event.target.matches('input,textarea,select,[contenteditable]')||$('#modal-root .modal'))return;
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();handleAction(event.shiftKey?'redo':'undo');return;}
    if(event.key==='Delete'){handleAction('delete-object');return;}
    if(event.key==='Enter'&&event.target.dataset.element){selected=event.target.dataset.element;renderCanvas();return;}
    const movement={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
    if(movement&&selected){event.preventDefault();mutateSelected(e=>{const step=event.shiftKey?10:1;e.x=Math.max(0,Math.min(1440-e.w,e.x+movement[0]*step));e.y=Math.max(0,e.y+movement[1]*step);});}
  });
  function libraryEnvironment(){
    return {$,esc,icon,clone,field,modal,toast,storeGet,storeSet,bridge,loadImage,drawCover,drawText,drawSize,refreshIcons,template,allTemplates,render,renderRecent,changed,checkpoint,save,exportDialog,closeModal,
      get project(){return project;},set project(v){project=v;},get templates(){return templates;},set templates(v){templates=v;},get recent(){return recent;},get builtinMetadata(){return builtinMetadata;},set builtinMetadata(v){builtinMetadata=v;},get libraryEntries(){return libraryEntries;},set libraryEntries(v){libraryEntries=v;},get workspace(){return workspace;},get preview(){return preview;},get projectGeneration(){return projectGeneration;},set projectGeneration(v){projectGeneration=v;},get projectSwitch(){return projectSwitch;},set projectSwitch(v){projectSwitch=v;},get sizeScanToken(){return sizeScanToken;},set sizeScanToken(v){sizeScanToken=v;},get quickScanToken(){return quickScanToken;},set quickScanToken(v){quickScanToken=v;},set analysisBusy(v){analysisBusy=v;},set sizeRecognitionBusy(v){sizeRecognitionBusy=v;},set selected(v){selected=v;},clearHistory(){undoStack=[];redoStack=[];batchReview=null;queuedAnalysis=false;},clearSaveTimer(){clearTimeout(saveTimer);},savedProjectIds,templatePreviewSnapshot};
  }
  async function savedProjectIds(){const d=await storage();return new Promise((resolve,reject)=>{const request=d.transaction('records').objectStore('records').getAllKeys();request.onsuccess=()=>resolve(request.result.filter(key=>typeof key==='string'&&key.startsWith('project:')).map(key=>key.slice(8)));request.onerror=()=>reject(request.error);});}
  async function templatePreviewSnapshot(t){
    if(t.id===project.templateId)return clone(project);
    const assets=await Promise.all([demoAsset('cover.jpg','模板预览模特','models'),demoAsset('look.jpg','模板预览细节','details')]),sizeData=emptySizeData(t.kind,t.id),recommendationData=reference.referenceRecommendationDefaults();
    let layout;
    if(t.family==='turntide'){assets[0].group='hero';assets.push(...clone(turntideSource.footerAssets));layout=turntide.buildTurntideLayout(assets,{manifest:turntideSource.manifest,geometry:turntideSource.geometry,coverId:assets[0].id,sizeData,createId:uid,footerAsset:turntideSource.footerAssets[0]});}
    else if(t.reference)layout=reference.buildReferenceLayout(assets,{coverId:assets[0].id,sizeData,recommendationData,sourceGeometry:referenceSource.geometry,createId:uid});
    else if(t.elements){let model=0,detail=0;const elements=t.elements.map(e=>{const next=clone(e);if(next.type==='image'&&next.role!=='footer')next.assetId=assets[next.role==='details'?1:0].id;return next;});layout={elements};}
    else layout={elements:[element('image',{role:'cover',assetId:assets[0].id,x:0,y:0,w:1440,h:1800,fit:'fixed'}),element('size',{x:64,y:1864,w:1312,h:600}),element('image',{role:'details',assetId:assets[1].id,x:100,y:2560,w:1240,h:1500,fit:'fixed'})]};
    return {id:uid(),name:t.name,kind:t.kind,templateId:t.id,assets,...layout,sizeData,recommendationData,demo:false};
  }
  const pageThumbnail=snapshot=>extensions.pageThumbnail(snapshot);
  const refreshCurrentThumbnail=()=>extensions.refreshCurrentThumbnail();
  const ensureTemplateThumbnails=()=>extensions.ensureTemplateThumbnails();
  const filterProjects=()=>extensions.filterProjects();
  const renameTemplateDialog=id=>extensions.renameTemplateDialog(id);
  const confirmRenameTemplate=()=>extensions.confirmRenameTemplate();
  const previewTemplate=id=>extensions.previewTemplate(id);
  const toggleTemplateLock=()=>extensions.toggleTemplateLock();
  const saveExplicit=exportAfter=>extensions.saveExplicit(exportAfter);
  const projectFileDialog=()=>extensions.projectFileDialog();
  const exportProjectFile=()=>extensions.exportProjectFile();
  const restoreSavedTemplate=t=>extensions.restoreSavedTemplate(t);
  const openLibraryProject=id=>extensions.openLibraryProject(id);
  const importProjectFile=()=>extensions.importProjectFile();
  const migrateOldProjects=()=>extensions.migrateOldProjects();
  function sizeStatusMarkup(){const status=project.sizeScan;if(!status)return '';return `<div class="size-scan-status" data-status="${esc(status.status)}" role="status">${icon(status.status==='running'?'scan-text':status.status==='complete'?'check':'info')}<span>${esc(status.message||'')}</span>${status.status==='pending-review'?'<button class="text-link" data-action="review-background-size">核对识别结果</button>':status.status==='failed'||status.status==='interrupted'?'<button class="text-link" data-action="recognize-size">重新识别</button>':''}</div>`;}
  function openBatchReview(){
    const assets=materialAssets().filter(a=>a.batchId===project.latestBatchId);
    if(!assets.length){toast('先上传本批素材');return;}
    batchReview=project.batchAnalysis?.batchId===project.latestBatchId?clone(project.batchAnalysis):{items:assets.map(a=>({assetId:a.id,category:'unknown',confidence:0,needsReview:true,confirmed:false})),sizeTables:[],batchId:project.latestBatchId,coverAssetId:project.coverId};
    batchReview.projectId=project.id;batchReview.quick=true;renderBatchReview();
  }
  function confirmQuickReview(){
    if(!batchReview||batchReview.projectId!==project.id||batchReview.batchId!==project.latestBatchId){toast('项目或批次已变化，请重新检查分类',true);return;}
    try{const previousSource=project.sizeSource,previousSize=JSON.stringify(project.sizeData);batchReview.items=batchReview.items.map(item=>({...item,confirmed:true,needsReview:false}));checkpoint();project=workflow.planQuickFill(project,batchReview,{batchId:batchReview.batchId});createLayout(true);project.batchAnalysis.reviewedAt=Date.now();closeModal();render();changed();toast('人工分类已更新，可继续检查画布');if(project.sizeSource&&(project.sizeSource!==previousSource||!project.sizeRecognition)){if(project.sizeSource!==previousSource){sizeScanToken++;sizeRecognitionBusy=false;}recognizeSize(true);}}
    catch(error){toast(error.message,true);}
  }
  function showPendingSize(){const table=project.sizeScan?.table;if(!table)return;modal('核对后台尺码结果',`<p>你已经手工填写过尺码，后台结果已单独保留。选择替换后会采用下方数据。</p><div class="editable-table-wrap"><table class="pending-size-table"><thead><tr>${table.columns.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${table.rows.map(row=>`<tr>${row.map(cell=>`<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,'<button class="secondary-button" data-action="close-modal">保留人工填写</button><button class="primary-button" data-action="apply-background-size">使用这份识别结果</button>');}
  async function applyPendingSize(){try{const pending=project.sizeScan,table=pending?.table;if(!table)return;if(pending.sourceAssetId!==project.sizeSourceAssetId){toast('尺码来源已变化，请重新识别',true);return;}const request=workflow.captureSizeRecognition(project),{mapSizeData}=await coreReady,size=project.elements.find(e=>e.type==='size'),result=workflow.applyBackgroundSizeResult(project,request,table,{mapSizeData,prepareSizeData:size?.style==='turntide-original'?data=>turntide.prepareTurntideSizeImport(data):undefined});if(!result.applied){toast(result.reason,true);return;}checkpoint();project=result.project;resizeCurrentSize();project.sizeScan={status:'complete',message:'已使用核对后的尺码识别结果'};closeModal();render();changed();}catch(error){toast(error.message,true);}}

  async function init() {
    try {
      await Promise.all([referenceReady,turntideReady,workflowReady,coreReady,fileDropReady,workspaceReady,previewReady,libraryUiReady]);
      extensions=createLibraryUi(libraryEnvironment());
      try{await loadReferenceSource();}catch(error){referenceSourceError=error.message;toast('原图参考模板暂不可用：'+error.message,true);}try{await loadTurntideSource();}catch(error){turntideSourceError=error.message;toast('四板块模板暂不可用：'+error.message,true);}
      if(bridge?.onBeforeClose)bridge.onBeforeClose(async()=>{const active=document.activeElement;if(active?.matches('[data-prop],[data-size-cell],[data-size-col]'))active.dispatchEvent(new Event('change',{bubbles:true}));if(active?.id==='project-name')active.blur();clearTimeout(saveTimer);return await save();});
      templates=await storeGet('templates')||[];recent=await storeGet('recent')||[];builtinMetadata=await storeGet('builtin-template-metadata')||{};
      let migratedTemplates=false;templates=templates.map(t=>{if(t.family!=='turntide'||!t.elements)return t;const elements=turntide.normalizeTurntideFooterTemplate(t.elements);if(JSON.stringify(elements)!==JSON.stringify(t.elements)){migratedTemplates=true;return {...t,elements};}return t;});if(migratedTemplates)await storeSet('templates',templates);
      document.body.dataset.theme=await storeGet('theme')||'light';
      project=bridge?await bridge.loadProject():await storeGet('current');if(!project)project=await storeGet('current');
      if(project?.savedTemplate)await restoreSavedTemplate(project.savedTemplate);
      if(!project) {
        const assets=await Promise.all([demoAsset('cover.jpg','都市穿搭_01.jpg','models'),demoAsset('look.jpg','都市穿搭_02.jpg','models')]);
        project={id:uid(),name:'衣序 · 开始制作',kind:'top',templateId:'top',assets,coverId:assets[0].id,elements:[],sizeData:emptySizeData('top','top'),demo:true,updatedAt:Date.now()};createLayout();
        const cover=project.elements[0];cover.fit='fixed';cover.h=1680;const size=project.elements.find(e=>e.type==='size');size.y=1744;const look=project.elements.find(e=>e.type==='image'&&e.role==='models');look.y=2380;
        project.elements.push(element('text',{name:'首图标题',text:'日常，轻装上阵',x:100,y:1280,w:1200,h:120,fontSize:86,weight:500,color:'#ffffff'}),element('text',{name:'首图说明',text:'秋日穿搭  /  示例素材',x:106,y:1420,w:1000,h:80,fontSize:34,weight:400,color:'#ffffff'}));
        selected=cover.id;
      }else{if(turntideSource&&isTurntide()){const before=clone(project),migration=turntide.trimTurntideFooter(project,turntideSource.footerAssets[0]);if(migration.changed){project=migration.project;undoStack.push(before);toast('页尾已保留中文购买须知，后续原说明已移除，可撤销');}}selected=project.elements[0]?.id;}
      if(project.sizeScan?.status==='running')project.sizeScan={...project.sizeScan,status:'interrupted',message:'上次尺码识别已中断，可手动重新识别'};
      await migrateOldProjects();render();showPanel('assets');fitWidth();await save();refreshIcons();ensureTemplateThumbnails().catch(error=>console.warn('模板预览生成失败',error));if(bridge?.getAppInfo){const info=await bridge.getAppInfo();if(info.openFourBlockExample)await openFourBlockExample();}
    }catch(e){toast('界面初始化失败：'+e.message,true);console.error(e);}
  }
  init();
})();






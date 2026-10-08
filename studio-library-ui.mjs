export function createLibraryUi(env) {
  const { $,esc,icon,clone,field,modal,toast,storeGet,storeSet,bridge } = env;
  let renameId=null;
  async function pageThumbnail(snapshot) {
    return env.preview.createPageThumbnail(snapshot,{loadImage:env.loadImage,drawImage:env.drawCover,drawText:env.drawText,drawTable:env.drawSize});
  }
  async function persistTemplate(t) {
    if(t.builtin){const metadata=clone(t);delete metadata.id;delete metadata.builtin;env.builtinMetadata={...env.builtinMetadata,[t.id]:metadata};await storeSet('builtin-template-metadata',env.builtinMetadata);}
    else{env.templates=[...env.templates.filter(item=>item.id!==t.id),t];await storeSet('templates',env.templates);}
  }
  async function refreshCurrentThumbnail() {
    const snapshot=clone(env.project),thumbnail=await pageThumbnail(snapshot);
    if(env.project.id!==snapshot.id||env.project.updatedAt!==snapshot.updatedAt)return;
    env.project.thumbnail=thumbnail;await persistTemplate({...env.template(),thumbnail});
  }
  function renderTemplates() {
    const p=env.project;
    $('#template-list').innerHTML=`<button class="primary-button full template-sync-entry" data-action="edit-template">${icon('square-pen')}编辑模板并同步当前项目</button><button class="secondary-button full template-lock-entry" data-action="toggle-template-lock" aria-pressed="${!!p.layoutLocked}">${icon(p.layoutLocked?'lock-keyhole-open':'lock-keyhole')}${p.layoutLocked?'解锁当前模板模块':'锁定当前模板模块'}</button><p class="property-help">锁定位置、尺寸与模块结构；模块中的图片、取景和尺码内容仍可更换。</p><div class="template-intro"><strong>我的排版模板</strong><p>缩略图展示保存时的真实页面，点击预览可查看完整排版。</p></div>`+env.allTemplates().map(t=>`<article class="template-entry"><button class="template-card ${t.id===p.templateId?'active':''}" data-template="${t.id}"><div class="template-thumbnail">${t.thumbnail?`<img src="${esc(t.thumbnail)}" alt="${esc(t.name)}排版缩略图">`:'<span>正在生成预览</span>'}</div><div><strong>${esc(t.name)}</strong><small>${t.kind==='pants'?'裤装':'上衣'} · ${t.builtin?'内置模板':'我的模板'}${t.layoutLocked?' · 模块锁定':''}</small></div>${t.id===p.templateId?icon('check'):''}</button><div class="template-card-actions"><button class="text-link" data-action="preview-template" data-template-id="${t.id}">${icon('image')}查看预览</button><button class="text-link" data-action="rename-template" data-template-id="${t.id}">${icon('square-pen')}改名称</button></div></article>`).join('')+`<button class="secondary-button full" data-action="open-four-block-example">${icon('image')}打开参考示例</button><button class="secondary-button full" data-action="save-template">${icon('bookmark-plus')}将当前布局存为模板</button>`;
    env.refreshIcons();
  }
  function renderRecent() {
    if(!env.project)return;
    const search=$('#project-search')?.value||'',entries=env.libraryEntries.length?env.libraryEntries:env.recent;
    $('#recent-list').innerHTML=`<div class="project-library-actions"><button class="primary-button full" data-action="new-project">${icon('plus')}新建商品项目</button><div><button class="secondary-button" data-action="save-project">${icon('save')}保存当前项目</button><button class="secondary-button" data-action="import-project">${icon('folder-open')}导入项目文件</button></div><button class="secondary-button full" data-action="export-project">${icon('download')}导出可编辑项目</button></div>${field('查找项目',`<input id="project-search" type="search" value="${esc(search)}" placeholder="输入商品名称或款号">`)}<div class="panel-section-head">项目库 <span>${entries.length} 个</span></div>`+entries.map(p=>`<button class="recent-row project-library-row" data-open-project="${p.id}" data-project-search="${esc(p.name.toLowerCase())}">${p.thumbnail?`<img src="${esc(p.thumbnail)}" alt="${esc(p.name)}预览">`:icon('file-image')}<span><strong>${esc(p.name)}</strong><small>${new Date(p.updatedAt).toLocaleString('zh-CN')}${p.assetCount!==undefined?` · ${p.assetCount} 张素材`:''}</small></span>${p.id===env.project.id?icon('check'):''}</button>`).join('');filterProjects();env.refreshIcons();
  }
  function filterProjects(){const search=$('#project-search')?.value.trim().toLowerCase()||'';document.querySelectorAll('[data-open-project]').forEach(node=>node.hidden=!node.dataset.projectSearch.includes(search));}
  function renameTemplateDialog(id){const t=env.allTemplates().find(t=>t.id===id);if(!t)return;renameId=id;modal('修改模板名称',field('模板名称',`<input id="rename-template-name" value="${esc(t.name)}" maxlength="100">`),'<button class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" data-action="confirm-rename-template">保存名称</button>');}
  async function confirmRenameTemplate(){try{const t=env.allTemplates().find(t=>t.id===renameId),next=env.workspace.updateTemplateMetadata(t,{name:$('#rename-template-name').value});await persistTemplate(next);env.closeModal();env.render();env.changed();toast('模板名称已保存');}catch(error){toast(error.message,true);}}
  function previewTemplate(id){const t=env.allTemplates().find(t=>t.id===id);if(!t?.thumbnail){toast('模板预览正在生成，请稍候');return;}modal(t.name,`<div class="template-full-preview"><img src="${esc(t.thumbnail)}" alt="${esc(t.name)}完整排版"></div>`,'<button class="primary-button" data-action="close-modal">关闭预览</button>');$('#modal-root .modal').classList.add('template-preview-dialog');}
  async function toggleTemplateLock(){
    try{const id=env.project.id,updated=env.project.updatedAt,blueprint={...env.template(),elements:env.project.elements.map(element=>{const item=clone(element);for(const key of ['assetId','src','data','rows','values'])delete item[key];return item;}),columns:[...env.project.sizeData.columns]},result=env.workspace.setTemplateLayoutLocked(env.project,blueprint,!env.project.layoutLocked);await persistTemplate(result.template);if(env.project.id!==id||env.project.updatedAt!==updated){toast('项目已变化，请重新切换锁定状态');return;}env.checkpoint();env.project=result.project;env.render();env.changed();toast(env.project.layoutLocked?'模块已锁定，仍可换图及填写尺码':'模块已解锁');}catch(error){toast(error.message,true);}
  }
  async function saveExplicit(exportAfter=false){if(!env.project)return;try{await refreshCurrentThumbnail();if(!await env.save())return;env.renderRecent();toast('当前项目已保存到项目库');if(exportAfter)env.exportDialog();}catch(error){toast(error.message,true);}}
  function projectFileDialog(){modal('导出可编辑项目',`${field('项目文件名称',`<input id="project-file-name" value="${esc(env.project.name)}" maxlength="100">`)}<p>保存图片、尺码、当前模板及排版。以后可从项目库继续修改，也可导入此 .yixu 文件再编辑。</p>`,'<button class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" data-action="confirm-export-project">选择位置并导出项目</button>');}
  async function exportProjectFile(){const fileName=$('#project-file-name').value.trim();if(!fileName){toast('请填写文件名称');return;}try{if(!bridge?.exportProject)throw new Error('请使用桌面版导出项目');const p=clone(env.project);p.savedTemplate=clone(env.template());const result=await bridge.exportProject({project:p,fileName});if(result.ok){env.closeModal();toast('项目文件已导出：'+result.path);}}catch(error){toast(error.message,true);}}
  async function restoreSavedTemplate(t){if(!t)return;if(t.builtin){const original=env.allTemplates().find(item=>item.id===t.id);if(original)await persistTemplate(clone(t));return;}await persistTemplate(t);}
  async function adoptProject(p,token){await restoreSavedTemplate(p.savedTemplate);if(token!==env.projectSwitch)return;env.projectGeneration++;env.quickScanToken++;env.sizeScanToken++;env.analysisBusy=false;env.sizeRecognitionBusy=false;env.project=p;env.selected=p.elements[0]?.id;env.clearHistory();if(p.sizeScan?.status==='running')p.sizeScan={...p.sizeScan,status:'interrupted',message:'上次识别已中断，可重新识别'};env.closeModal();env.render();env.changed();await env.save();}
  async function openLibraryProject(id){const token=++env.projectSwitch;env.clearSaveTimer();if(!await env.save())return;try{const p=bridge?.loadLibraryProject?await bridge.loadLibraryProject(id):await storeGet('project:'+id);if(token!==env.projectSwitch)return;if(p)await adoptProject(p,token);}catch(error){toast(error.message,true);}}
  async function importProjectFile(){env.clearSaveTimer();if(!await env.save())return;try{if(!bridge?.importProject)throw new Error('请使用桌面版导入项目');const token=++env.projectSwitch,result=await bridge.importProject();if(result.ok&&token===env.projectSwitch){await adoptProject(result.project,token);toast('项目已导入，可继续修改并重新导出');}}catch(error){toast(error.message,true);}}
  async function migrateOldProjects(){
    if(!bridge?.listProjects)return;const entries=await bridge.listProjects(),known=new Set(entries.map(p=>p.id));
    for(const id of await env.savedProjectIds()){if(known.has(id))continue;const p=await storeGet('project:'+id);if(p){p.savedTemplate ||= env.allTemplates().find(t=>t.id===p.templateId);await bridge.saveProject(p);known.add(id);}}
    env.libraryEntries=await bridge.listProjects();
  }
  async function ensureTemplateThumbnails(){
    for(const t of env.allTemplates()){if(t.thumbnail)continue;try{const snapshot=await env.templatePreviewSnapshot(t),thumbnail=await pageThumbnail(snapshot);const current=env.allTemplates().find(item=>item.id===t.id);if(current&&!current.thumbnail)await persistTemplate({...current,thumbnail});}catch(error){console.warn('模板预览暂不可用',t.id,error.message);}}
    renderTemplates();
  }
  return {pageThumbnail,refreshCurrentThumbnail,renderTemplates,renderRecent,filterProjects,renameTemplateDialog,confirmRenameTemplate,previewTemplate,toggleTemplateLock,saveExplicit,projectFileDialog,exportProjectFile,restoreSavedTemplate,openLibraryProject,importProjectFile,migrateOldProjects,ensureTemplateThumbnails};
}

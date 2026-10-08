export const TURNTIDE_TEMPLATE_ID='pants-four-blocks';
export const TURNTIDE_SIZE_COLUMNS=['尺码(SIZE)','腰围','臀围','裤长','脚口'];
export function turntideSizeDefaults(){return {columns:[...TURNTIDE_SIZE_COLUMNS],rows:['S','M','L','XL'].map(size=>[size,'','','',''])};}
export function fitTurntideSizeData(previous,options={}){
  if(options.allowExpansion)return prepareTurntideSizeImport(previous,options).data;
  const defaults=turntideSizeDefaults(),normalize=value=>String(value).replace(/[（(].*?[）)]/g,'').replace(/\s/g,'').toLowerCase();
  if(previous.rows.length>4){if(previous.rows.every(row=>row.slice(1).every(value=>String(value??'').trim()==='')))return defaults;throw new Error('四板块原图尺码表固定为 4 行，当前尺码数据超过原图行数');}
  const rows=previous.rows.map(row=>defaults.columns.map(column=>row[previous.columns.findIndex(source=>normalize(source)===normalize(column))]??'')),used=new Set(rows.map(row=>row[0]));
  for(const row of defaults.rows)if(rows.length<4&&!used.has(row[0]))rows.push([...row]);
  while(rows.length<4)rows.push(defaults.columns.map(()=>''));return {columns:defaults.columns,rows};
}
const sizeFieldAliases={尺码:['尺码','尺码size','size','码数','规格'],腰围:['腰围','waist'],臀围:['臀围','hip','hips'],腿围:['腿围','大腿围'],脚口:['脚口','裤脚','裤脚围','legopening'],裤长:['裤长','外长','pantslength','trouserlength']};
const sizeFieldToken=value=>String(value??'').toLowerCase().replace(/[（(][^）)]*[）)]/g,'').replace(/\s|[:：_\/]/g,'').replace(/厘米|公分|cm/g,'');
function sizeField(value){const token=sizeFieldToken(value);if(token.includes('裤长')&&/常规|标准/.test(token))return '常规版裤长';if(token.includes('裤长')&&/加长/.test(token))return '加长版裤长';return Object.keys(sizeFieldAliases).find(key=>sizeFieldAliases[key].includes(token))||token;}
export function normalizeTurntideSizeLabel(value){return String(value??'').trim().toUpperCase().replace(/\s/g,'').replace(/(?:尺码|码)$/,'');}
function sizeRank(value){const label=normalizeTurntideSizeLabel(value),known=['XXXS','XXS','XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL','7XL','8XL','9XL'];if(label==='XXL')return 7;if(label==='XXXL')return 8;const rank=known.indexOf(label);if(rank>=0)return rank;if(/^\d+(?:\.\d+)?$/.test(label))return 100+Number(label);return 10000;}
/** Keep every recognized measurement, including distinct regular and long trouser lengths. */
export function prepareTurntideSizeImport(source,options={}){
  if(!Array.isArray(source?.columns)||!source.columns.length||!Array.isArray(source?.rows)||!source.rows.length||source.rows.some(row=>!Array.isArray(row)))throw new Error('没有识别到有效尺码表');
  const width=Math.max(source.columns.length,...source.rows.map(row=>row.length)),warnings=[],fields=Array.from({length:width},(_,index)=>{const original=String(source.columns[index]??'').trim()||`字段${index+1}`,semantic=sizeField(original);return {index,original,semantic};});
  if(width>source.columns.length)warnings.push('部分数据没有字段名，已保留为额外字段，请核对列名');
  const standard=fields.length===5&&TURNTIDE_SIZE_COLUMNS.every(column=>fields.some(field=>field.semantic===sizeField(column)));
  const order=standard?TURNTIDE_SIZE_COLUMNS.map(sizeField):['尺码','腰围','臀围','腿围','脚口','裤长','常规版裤长','加长版裤长'];
  fields.sort((a,b)=>(order.includes(a.semantic)?order.indexOf(a.semantic):1000)-(order.includes(b.semantic)?order.indexOf(b.semantic):1000)||a.index-b.index);
  const seen=new Map(),columns=fields.map(field=>{let label=field.semantic==='尺码'?'尺码(SIZE)':Object.hasOwn(sizeFieldAliases,field.semantic)||['常规版裤长','加长版裤长'].includes(field.semantic)?field.semantic:field.original;const count=(seen.get(label)||0)+1;seen.set(label,count);if(count>1){warnings.push(`字段“${label}”重复，已保留所有列，请核对含义`);label+=`（${count}）`;}return label;});
  const sizeIndex=fields.findIndex(field=>field.semantic==='尺码'),preferred=new Map((options.preferredOrder||[]).map((label,index)=>[normalizeTurntideSizeLabel(label),index]));
  const rows=source.rows.map((row,index)=>({index,values:fields.map((field,column)=>column===sizeIndex?normalizeTurntideSizeLabel(row[field.index]):String(row[field.index]??''))}));
  if(sizeIndex>=0)rows.sort((a,b)=>{const rank=label=>preferred.has(label)?preferred.get(label):preferred.size+sizeRank(label);return rank(a.values[sizeIndex])-rank(b.values[sizeIndex])||a.index-b.index;});
  const hasLength=fields.some(field=>['裤长','常规版裤长','加长版裤长'].includes(field.semantic)),missing=TURNTIDE_SIZE_COLUMNS.filter(column=>sizeField(column)==='裤长'?!hasLength:!fields.some(field=>field.semantic===sizeField(column)));
  if(fields.some(field=>field.semantic==='常规版裤长')&&fields.some(field=>field.semantic==='加长版裤长'))warnings.push('常规版裤长和加长版裤长已分别保留，没有合并为单一裤长');
  const data={columns,rows:rows.map(row=>row.values)};
  return {data,missing,warnings,expanded:data.rows.length>4||!standard};
}
function headerLines(column,fontSize,cellWidth){
  const text=String(column),capacity=cellWidth-14,estimate=value=>[...value].reduce((width,char)=>width+(char.charCodeAt(0)>255?fontSize:fontSize*.6),0);
  if(estimate(text)<=capacity)return [text];
  if(['常规版裤长','加长版裤长'].includes(text))return [text.slice(0,3),'裤长'];
  if(sizeField(text)==='尺码')return ['尺码','(SIZE)'];
  const lines=[];let line='';for(const char of text){if(line&&estimate(line+char)>capacity){lines.push(line);line='';}line+=char;}if(line)lines.push(line);return lines;
}
/** Shared original-pixel coordinate plan for DOM preview and JPG export. */
export function turntideSizePlan(data,geometry,options={}){
  const block=geometry?.blocks?.size;if(!block?.table?.dataRows?.length)throw new Error('四板块尺码原图坐标不可用');
  if(!Array.isArray(data?.columns)||!data.columns.length||!Array.isArray(data.rows))throw new Error('尺码数据无效');
  const table=block.table,originalColumns=data.columns.length===TURNTIDE_SIZE_COLUMNS.length&&data.columns.every((column,index)=>sizeField(column)===sizeField(TURNTIDE_SIZE_COLUMNS[index])),mode=originalColumns&&data.rows.length<=table.dataRows.length?'original':'expanded',width=options.width??1440;
  const font={...table.font},sourceWidth=block.width,rowStep=table.dataRows.length>1?table.dataRows[1].centerY-table.dataRows[0].centerY:68,bodyEnd=table.dataRows.at(-1).bottom,headerTop=table.headerRow.top,originalHeaderHeight=table.headerRow.bottom-headerTop,columnCount=data.columns.length,left=table.colBounds[0],right=table.colBounds.at(-1),cellWidth=(right-left)/columnCount;
  const headers=data.columns.map((column,index)=>({text:column,lines:headerLines(column,font.size,originalColumns?table.colBounds[index+1]-table.colBounds[index]:cellWidth),centerX:originalColumns?table.columnCenters[index]:left+(index+.5)*cellWidth,font:{...font,weight:700}}));
  const lineHeight=Math.ceil(font.size*1.2),headerHeight=originalColumns?originalHeaderHeight:Math.max(originalHeaderHeight,...headers.map(header=>header.lines.length*lineHeight)),headerDelta=headerHeight-originalHeaderHeight,rowCount=mode==='original'?table.dataRows.length:Math.max(table.dataRows.length,data.rows.length),rowDelta=(rowCount-table.dataRows.length)*rowStep,growth=headerDelta+rowDelta,sourceHeight=block.height+growth;
  headers.forEach(header=>{header.top=headerTop;header.lineHeight=lineHeight;header.baselines=header.lines.map((_,index)=>headerTop+font.size+index*lineHeight);});
  const rows=Array.from({length:rowCount},(_,row)=>({top:table.dataRows[0].top+headerDelta+row*rowStep,bottom:table.dataRows[0].top+headerDelta+(row+1)*rowStep,centerY:table.dataRows[0].centerY+headerDelta+row*rowStep,baselineY:table.dataRows[0].baselineY+headerDelta+row*rowStep,cells:data.columns.map((column,index)=>({value:String(data.rows[row]?.[index]??''),centerX:headers[index].centerX,baselineY:mode==='original'?(table.dataRows[row].cellBaselineY?.[index]??table.dataRows[row].baselineY):table.dataRows[0].baselineY+headerDelta+row*rowStep,font:{...font,...(sizeField(column)==='尺码'?table.columnFonts?.[0]:{})}}))}));
  const slice=(sy,sh,dy)=>({sx:0,sy,sw:sourceWidth,sh,dx:0,dy,dw:sourceWidth,dh:sh});
  return {mode,sourceWidth,sourceHeight,height:Math.round(width*sourceHeight/sourceWidth),scale:width/sourceWidth,copyHeader:originalColumns,headers,rows,font,headerDelta,rowDelta,notesOffset:growth,backgroundSlices:mode==='original'?[slice(0,block.height,0)]:[slice(0,originalColumns?table.dataRows[0].top:headerTop,0),slice(bodyEnd,block.height-bodyEnd,bodyEnd+growth)]};
}
/** Resize only the size block and preserve the spacing and edits in later page sections. */
export function resizeTurntideSizeLayout(current,data,geometry){
  const elements=structuredClone(current);let delta=0,changed=false;
  for(const element of elements.filter(item=>item.type==='size'&&(item.style==='turntide-original'||item.templateFamily==='turntide')).sort((a,b)=>a.y-b.y)){
    const plan=turntideSizePlan(data,geometry,{width:element.w}),bottom=element.y+element.h,difference=plan.height-element.h;
    if(difference){for(const other of elements)if(other!==element&&other.y>=bottom-1)other.y+=difference;delta+=difference;changed=true;}
    if(element.sizeLayout!==plan.mode||element.sizeSourceHeight!==plan.sourceHeight)changed=true;
    element.h=plan.height;element.sizeLayout=plan.mode;element.sizeSourceHeight=plan.sourceHeight;
  }
  return {elements,changed,delta,height:Math.max(480,Math.ceil(Math.max(0,...elements.map(element=>element.y+element.h))))};
}
const copy=value=>structuredClone(value);
export const TURNTIDE_FOOTER_ASSET='assets/turntide-template/footer-service-cn.png';
const legacyFooterFiles=['assets/turntide-template/footer-before-toolbar.png','assets/turntide-template/footer-after-toolbar.png'];
const legacyFooterHeights=[2282,1051];
const legacyFooterNames=['购买须知与洗涤建议 · 原图上段','洗涤建议与设计理念 · 原图下段'];
const footerFile=value=>String(value||'').replaceAll('\\','/');
function legacyFooterIndex(value){return legacyFooterFiles.findIndex(file=>footerFile(value).endsWith(file));}
function isOriginalFooterAsset(asset,index){return asset&&legacyFooterIndex(asset.assetFile||asset.asset)===index&&asset.width===1026&&asset.height===legacyFooterHeights[index]&&(!asset.name||asset.name===legacyFooterNames[index]);}
function originalFooterKind(element,assets){
  if(element.type!=='image'||(element.role!=='footer'&&element.section!=='footer'))return -1;
  const asset=assets?.find(item=>item.id===element.assetId),index=legacyFooterIndex(element.assetFile||asset?.assetFile);
  // Image replacement keeps old assetFile metadata in older projects. Never replace user media based only on that stale filename.
  return index>=0&&(!assets||!asset||isOriginalFooterAsset(asset,index))?index:-1;
}
function trimFooterElements(elements,assets){
  const kinds=new Map(elements.map(element=>[element.id,originalFooterKind(element,assets)])),intervals=[],removedElementIds=[],replacedElementIds=[];
  const resized=new Map();
  for(const element of elements){const kind=kinds.get(element.id);if(kind<0)continue;
    if(kind===1){removedElementIds.push(element.id);intervals.push([element.y,element.y+element.h]);}
    else{const height=element.fit==='natural'?Math.round(element.w*900/1026):element.h*900/2282;resized.set(element.id,height);replacedElementIds.push(element.id);if(height<element.h)intervals.push([element.y+height,element.y+element.h]);}
  }
  const merged=[];for(const interval of intervals.sort((a,b)=>a[0]-b[0])){const previous=merged.at(-1);if(previous&&interval[0]<=previous[1])previous[1]=Math.max(previous[1],interval[1]);else merged.push([...interval]);}
  const removedBefore=y=>merged.reduce((sum,[top,bottom])=>sum+Math.max(0,Math.min(y,bottom)-top),0);
  const result=elements.filter(element=>kinds.get(element.id)!==1).map(source=>{const element=copy(source);element.y-=removedBefore(source.y);if(resized.has(element.id)){element.h=resized.get(element.id);element.assetFile=TURNTIDE_FOOTER_ASSET;element.name='ABOUT SERVICE · 中文购买须知';element.footerVersion='chinese-only';}return element;});
  return {elements:result,removedElementIds,replacedElementIds,removedHeight:merged.reduce((sum,[top,bottom])=>sum+bottom-top,0)};
}
/** Normalize old saved design sources without deleting unrelated user objects. */
export function normalizeTurntideFooterTemplate(elements){return trimFooterElements(elements).elements;}
/** Pure, undoable migration: crop only original footer sources, preserving user media and edits. */
export function trimTurntideFooter(project,footerAsset){
  const result=trimFooterElements(project.elements,project.assets),changed=!!(result.removedElementIds.length||result.replacedElementIds.length);
  if(!changed)return {project:copy(project),changed:false,...result};
  const next=copy(project);next.elements=result.elements;
  if(result.replacedElementIds.length){
    const existing=next.assets.find(asset=>footerFile(asset.assetFile)===TURNTIDE_FOOTER_ASSET&&asset.width===1026&&asset.height===900&&asset.name==='ABOUT SERVICE · 中文购买须知');
    const replacement=copy(existing||footerAsset);
    if(!replacement?.id||replacement.width!==1026||replacement.height!==900)throw new Error('中文购买须知原图素材尚未加载');
    replacement.assetFile=TURNTIDE_FOOTER_ASSET;replacement.group='footer';replacement.sourceX=0;replacement.sourceCropWidth=1026;replacement.name='ABOUT SERVICE · 中文购买须知';
    if(!existing&&next.assets.some(asset=>asset.id===replacement.id))throw new Error('中文购买须知素材标识与现有素材冲突');
    if(!existing)next.assets.push(replacement);
    for(const element of next.elements)if(result.replacedElementIds.includes(element.id))element.assetId=replacement.id;
  }
  const referenced=new Set(next.elements.map(element=>element.assetId));
  next.assets=next.assets.filter(asset=>{const index=legacyFooterIndex(asset.assetFile);return !(index>=0&&isOriginalFooterAsset(asset,index)&&!referenced.has(asset.id));});
  next.height=Math.max(480,Math.ceil(Math.max(0,...next.elements.map(element=>element.y+element.h))));
  return {project:next,changed,...result};
}
function currentFooterAssets(assets,options={}){
  const footers=assets.filter(asset=>asset.group==='footer'),originals=footers.filter(asset=>isOriginalFooterAsset(asset,legacyFooterIndex(asset.assetFile||asset.asset)));
  const chinese=footers.find(asset=>footerFile(asset.assetFile||asset.asset)===TURNTIDE_FOOTER_ASSET)||((originals.length&&options.footerAsset)?options.footerAsset:null);
  return [...(chinese?[chinese]:[]),...footers.filter(asset=>asset!==chinese&&!originals.includes(asset)&&footerFile(asset.assetFile||asset.asset)!==TURNTIDE_FOOTER_ASSET).map(asset=>legacyFooterIndex(asset.assetFile||asset.asset)>=0?{...asset,assetFile:undefined}:asset)];
}
export function turntideMetrics(manifest={}){
  const detail=manifest.layout?.details||manifest.details?.layout||{},model=manifest.layout?.models||manifest.models?.layout||{};
  const scale=1440/(detail.sourceWidth||1052),modelScale=1440/(model.sourceWidth||1026);
  return {detailScale:scale,modelScale,detailX:(detail.left||122)*scale,detailW:(detail.cellWidth||416)*scale,detailH:(detail.cellHeight||312)*scale,detailGapX:(detail.gapX||21)*scale,detailGapY:(detail.gapY||18)*scale,detailHeader:(detail.titleHeight||218)*scale,detailTail:(detail.bottomGap||58)*scale,modelX:(model.photoX||73)*modelScale,modelW:(model.photoWidth||911)*modelScale,modelHeader:(model.titleHeight||234)*modelScale,modelCaption:(model.captionHeight||114)*modelScale};
}
function objectFactory(createId){return (type,props)=>({id:createId(),type,x:0,y:0,w:1440,h:60,locked:false,templateFamily:'turntide',...props});}
function sectionTitle(make,name,section,y,height,manifest={}){
  const m=turntideMetrics(manifest),isDetail=section==='details',scale=isDetail?m.detailScale:m.modelScale,source=manifest.layout?.[section]?.titles;
  if(source?.length)return source.map(title=>{
    const english=title.text.includes('['),width=english?Math.max(title.w+20,title.fontSize*title.text.length*.95):title.w+20;
    const left=title.x+title.w/2-width/2;
    return make('text',{name:title.name,text:title.text,section,sectionOffset:title.y*scale,x:left*scale,y:y+title.y*scale,w:width*scale,h:Math.max(title.h,title.fontSize*1.4)*scale,fontSize:title.fontSize*scale,weight:title.weight,align:title.align||'center',fontFamily:isDetail||english?'Arial, sans-serif':undefined,color:'#222222'});
  });
  return [make('text',{name:name+'英文',text:isDetail?'[PRODUCT DETAILS]':'[MODEL DISPLAY]',section,sectionOffset:60*scale,x:0,y:y+60*scale,w:1440,h:80,fontSize:44*scale,align:'center',weight:700,color:'#222222'}),make('text',{name:name+'中文',text:isDetail?'产品细节':'模特展示',section,sectionOffset:114*scale,x:0,y:y+114*scale,w:1440,h:80,fontSize:34*scale,align:'center',weight:400,color:'#222222'})];
}
function modelCaption(make,index,y,h,manifest={}){const m=turntideMetrics(manifest),source=manifest.layout?.models?.caption;if(source)return ['brand','year'].map(key=>{const item=source[key],offset=(item.y-1440)*m.modelScale;return make('text',{name:(key==='brand'?'服装展示 标题 ':'模特副标题 ')+(index+1),text:item.text,section:'models',associatedRole:'models',associatedSlot:index,x:item.x*m.modelScale,y:y+offset,w:(key==='year'?Math.min((manifest.layout?.models?.sourceWidth||1026)-item.x,Math.max(item.w,item.fontSize*item.text.length*.9)):item.w)*m.modelScale,h:item.h*m.modelScale,fontSize:item.fontSize*m.modelScale,weight:item.weight,align:'left',fontFamily:'Arial, sans-serif',color:'#222222'});});return [make('text',{name:'服装展示 标题 '+(index+1),text:'服装展示',section:'models',associatedRole:'models',associatedSlot:index,x:m.modelX,y:y+h*.2,w:500,h:h*.6,fontSize:54,align:'left',weight:400,color:'#222222'})];}

export function buildTurntideLayout(assets,options={}){
  const {manifest={},geometry,coverId,createId=()=>crypto.randomUUID()}=options;
  if(!geometry?.blocks?.size)throw new Error('四板块模板的尺码原图坐标不可用');
  const make=objectFactory(createId),metrics=turntideMetrics(manifest),elements=[];
  const cover=assets.find(asset=>asset.id===coverId)||assets.find(asset=>asset.group==='hero');
  const details=assets.filter(asset=>asset.group==='details'),models=assets.filter(asset=>asset.group==='models'&&asset.id!==cover?.id),footers=currentFooterAssets(assets,options);
  let y=0;
  if(cover){const h=Math.round(1440*cover.height/cover.width);elements.push(make('image',{name:'独立首图',role:'cover',section:'hero',assetId:cover.id,fit:'natural',w:1440,h}));y+=h;}
  const sizePlan=turntideSizePlan(options.sizeData||turntideSizeDefaults(),geometry),h=sizePlan.height;
  elements.push(make('size',{name:'尺码表（原图）',section:'size',style:'turntide-original',sourceBlock:'size',sizeLayout:sizePlan.mode,sizeSourceHeight:sizePlan.sourceHeight,y,w:1440,h}));y+=h;
  elements.push(...sectionTitle(make,'细节展示标题','details',y,metrics.detailHeader,manifest));y+=metrics.detailHeader;
  for(let row=0;row<Math.ceil(details.length/2);row++){
    for(let column=0;column<2;column++){
      const index=row*2+column,asset=details[index];if(!asset)continue;
      const frame=manifest.layout?.details?.frames?.[(row%2)*2+column];
      elements.push(make('image',{name:asset.name,assetId:asset.id,role:'details',section:'details',grid:'turntide-details',gridRow:row,gridColumn:column,fit:'fixed',x:frame?frame.x*metrics.detailScale:metrics.detailX+column*(metrics.detailW+metrics.detailGapX),y,w:frame?frame.w*metrics.detailScale:metrics.detailW,h:frame?frame.h*metrics.detailScale:metrics.detailH}));
    }
    const rowHeight=Math.max(...elements.filter(e=>e.gridRow===row&&e.grid).map(e=>e.h));y+=rowHeight+metrics.detailGapY;
  }
  y+=metrics.detailTail-(details.length?metrics.detailGapY:0);
  elements.push(...sectionTitle(make,'模特展示标题','models',y,metrics.modelHeader,manifest));y+=metrics.modelHeader;
  models.forEach((asset,index)=>{const h=Math.round(metrics.modelW*asset.height/asset.width);elements.push(make('image',{name:asset.name,assetId:asset.id,role:'models',section:'models',fit:'natural',x:metrics.modelX,y,w:metrics.modelW,h}));y+=h;elements.push(...modelCaption(make,index,y,metrics.modelCaption,manifest));y+=metrics.modelCaption;});
  footers.forEach(asset=>{const sourceWidth=manifest.layout?.footer?.sourceWidth||manifest.sourceWidth||1026,sourceX=asset.sourceX??0,w=(asset.sourceCropWidth||asset.width)*1440/sourceWidth,h=w*asset.height/asset.width;elements.push(make('image',{name:asset.name,assetId:asset.id,assetFile:asset.assetFile,footerVersion:footerFile(asset.assetFile)===TURNTIDE_FOOTER_ASSET?'chinese-only':undefined,role:'footer',section:'footer',fit:'natural',x:sourceX*1440/sourceWidth,y,w,h}));y+=h;});
  return {elements,coverId:cover?.id||null,height:Math.max(480,Math.ceil(y))};
}

/** Add material while preserving the current section order and all existing edits. */
export function appendTurntideAssets(current,added,options={}){
  const elements=copy(current),m=turntideMetrics(options.manifest),make=objectFactory(options.createId||(()=>crypto.randomUUID()));
  const shiftBelow=(boundary,delta)=>elements.forEach(e=>{if(e.y>=boundary-1)e.y+=delta;});
  for(const asset of added){
    if(asset.group==='hero'){
      const hero=elements.find(e=>e.role==='cover'),h=Math.round(1440*asset.height/asset.width);
      if(hero){const bottom=hero.y+hero.h,delta=h-hero.h;hero.assetId=asset.id;if(hero.fit==='natural'){hero.h=h;shiftBelow(bottom,delta);}}
      else{shiftBelow(0,h);elements.push(make('image',{name:'独立首图',assetId:asset.id,role:'cover',section:'hero',fit:'natural',x:0,y:0,w:1440,h}));}
    }else if(asset.group==='details'){
      const photos=elements.filter(e=>e.role==='details').sort((a,b)=>a.gridRow-b.gridRow||a.gridColumn-b.gridColumn),last=photos.at(-1);
      let row=last?.gridRow??0,column=last&&last.gridColumn===0?1:0,y;
      const frames=options.manifest?.layout?.details?.frames;
      if(column===1)y=last.y;
      else{
        row=last?row+1:0;
        const modelStart=Math.min(...elements.filter(e=>e.section==='models'||e.section==='footer').map(e=>e.y-(e.sectionOffset||0)));
        y=last?Math.max(...photos.filter(e=>e.gridRow===last.gridRow).map(e=>e.y+e.h))+m.detailGapY:modelStart-m.detailTail;
        const nextFrame=frames?.[(row%2)*2];shiftBelow(modelStart,(nextFrame?nextFrame.h*m.detailScale:m.detailH)+m.detailGapY);
      }
      const frame=frames?.[(row%2)*2+column],height=frame?frame.h*m.detailScale:m.detailH;
      if(column===1){const oldBottom=Math.max(...photos.filter(e=>e.gridRow===row).map(e=>e.y+e.h));if(y+height>oldBottom)shiftBelow(oldBottom,y+height-oldBottom);}
      elements.push(make('image',{name:asset.name,assetId:asset.id,role:'details',section:'details',grid:'turntide-details',gridRow:row,gridColumn:column,fit:'fixed',x:frame?frame.x*m.detailScale:m.detailX+column*(m.detailW+m.detailGapX),y,w:frame?frame.w*m.detailScale:m.detailW,h:height}));
    }else if(asset.group==='models'){
      const boundary=Math.min(...elements.filter(e=>e.section==='footer').map(e=>e.y),Math.max(0,...elements.map(e=>e.y+e.h))),h=Math.round(m.modelW*asset.height/asset.width),index=elements.filter(e=>e.role==='models').length;
      shiftBelow(boundary,h+m.modelCaption);
      elements.push(make('image',{name:asset.name,assetId:asset.id,role:'models',section:'models',fit:'natural',x:m.modelX,y:boundary,w:m.modelW,h}),...modelCaption(make,index,boundary+h,m.modelCaption,options.manifest));
    }
  }
  return elements;
}

/** Saved templates retain the original grid and free edits without retaining example media. */
export function applySavedTurntideLayout(sources,assets,options={}){
  sources=normalizeTurntideFooterTemplate(sources);
  const makeId=options.createId||(()=>crypto.randomUUID()),cover=assets.find(a=>a.id===options.coverId)||assets.find(a=>a.group==='hero');
  const slots={cover:cover?[cover]:[],details:assets.filter(a=>a.group==='details'),models:assets.filter(a=>a.group==='models'&&a.id!==cover?.id),footer:currentFooterAssets(assets,options)},used={cover:0,details:0,models:0,footer:0},elements=[];
  const groups=new Map();for(const e of sources){const key=e.grid?`grid:${e.grid}:${e.gridRow}`:`object:${e.id}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e);}
  let shift=0;
  for(const group of [...groups.values()].sort((a,b)=>Math.min(...a.map(e=>e.y))-Math.min(...b.map(e=>e.y)))){
    const top=Math.min(...group.map(e=>e.y)),bottom=Math.max(...group.map(e=>e.y+e.h)),generated=[];
    for(const source of group){const e=copy(source);e.id=makeId();e.y+=shift;
      if(e.associatedRole&&e.associatedSlot>=slots[e.associatedRole].length)continue;
      if(e.type==='image'){const role=e.role||'models',asset=slots[role]?.[used[role]++];if(!asset)continue;e.assetId=asset.id;if(role==='footer'){e.assetFile=asset.assetFile;e.footerVersion=footerFile(asset.assetFile)===TURNTIDE_FOOTER_ASSET?'chinese-only':undefined;}if(e.fit==='natural')e.h=Math.round(e.w*asset.height/asset.width);}
      else if(e.type==='size'&&options.geometry&&(e.style==='turntide-original'||e.templateFamily==='turntide')){const plan=turntideSizePlan(options.sizeData||turntideSizeDefaults(),options.geometry,{width:e.w});e.h=plan.height;e.sizeLayout=plan.mode;e.sizeSourceHeight=plan.sourceHeight;}
      generated.push(e);
    }
    const actualBottom=generated.length?Math.max(...generated.map(e=>e.y+e.h)):top+shift;
    shift+=actualBottom-(bottom+shift);elements.push(...generated);
  }
  const additional=[...slots.details.slice(used.details),...slots.models.slice(used.models),...slots.cover.slice(used.cover).map(asset=>({...asset,group:'hero'}))];
  return {elements:appendTurntideAssets(elements,additional,options),coverId:cover?.id||null};
}



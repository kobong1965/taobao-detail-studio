export const REFERENCE_TEMPLATE_ID = 'pants-reference';
export const REFERENCE_METRICS = Object.freeze({ width: 1440, inset: 42, photoWidth: 1360, photoGap: 110, detailGap: 163 });
export const REFERENCE_SIZE_COLUMNS = ['尺码', '腰围', '臀围', '裤长', '腿围', '脚围'];
export const REFERENCE_SIZE_ORDER = ['M', 'L', 'XL', '2XL', '3XL', '4XL'];

export function referenceSizeDefaults() {
  return { columns: [...REFERENCE_SIZE_COLUMNS], rows: REFERENCE_SIZE_ORDER.map(size => [size, '', '', '', '', '']) };
}

export function referenceRecommendationDefaults() {
  const columns = ['身高 / 体重', '100', '110', '120', '130', '140', '150', '160', '170', '180'];
  return { columns, rows: ['165–170', '170–175', '175–180', '180–185'].map(height => [height, ...Array(9).fill('')]) };
}

export function fitOriginalReferenceData(previous, defaults) {
  const columns=[...defaults.columns],rowLimit=defaults.rows.length;
  if(previous.rows.length>rowLimit)throw new Error(`原图模板固定为 ${rowLimit} 行，当前数据超过原图行数`);
  const rows=previous.rows.map(row=>columns.map(column=>row[previous.columns.indexOf(column)]??''));
  const used=new Set(rows.map(row=>String(row[0])));
  for(const row of defaults.rows)if(rows.length<rowLimit&&!used.has(String(row[0]))){rows.push([...row]);used.add(String(row[0]));}
  while(rows.length<rowLimit)rows.push(columns.map(()=>''));
  return {columns,rows};
}

export function referenceTableHeight(kind, rows) {
  return kind === 'recommendation' ? Math.max(316, 112 + (rows + 1) * 48) : Math.max(560, 176 + (rows + 1) * 50);
}

/** Keep content edits when the first imported photo introduces its height into the layout. */
export function preserveReferenceTextEdits(generatedElements, previousElements) {
  const previousText = previousElements.filter(element => element.type === 'text');
  const consumed = new Set();
  const fields = ['text', 'fontSize', 'color', 'weight', 'align'];
  const result = generatedElements.map(element => {
    const updated = structuredClone(element);
    if (element.type !== 'text') return updated;
    const prior = previousText.find(item => item.name === element.name && !consumed.has(item.id));
    if (!prior) return updated;
    consumed.add(prior.id);
    for (const field of fields) if (prior[field] !== undefined) updated[field] = prior[field];
    return updated;
  });
  const anchorName = '商品信息标题';
  const oldAnchor = previousText.find(element => element.name === anchorName) || previousElements.find(element => element.type === 'size');
  const newAnchor = result.find(element => element.name === anchorName) || result.find(element => element.type === 'size');
  const shift = oldAnchor && newAnchor ? newAnchor.y - oldAnchor.y : 0;
  for (const previous of previousText.filter(element => !consumed.has(element.id))) {
    const custom = structuredClone(previous);
    if (oldAnchor && custom.y >= oldAnchor.y) custom.y = Math.max(0, custom.y + shift);
    result.push(custom);
  }
  return result;
}

/** Reconstruct the reference's hierarchy with original-ratio, replaceable photos. */
export function buildReferenceLayout(assets, options = {}) {
  if(options.sourceGeometry)return buildOriginalReferenceLayout(assets, options);
  const { inset: x, photoWidth: w, photoGap, detailGap } = REFERENCE_METRICS;
  const createId = options.createId || (() => crypto.randomUUID());
  const sizeData = options.sizeData || referenceSizeDefaults();
  const recommendationData = options.recommendationData || referenceRecommendationDefaults();
  const models = assets.filter(asset => asset.group === 'models');
  const details = assets.filter(asset => asset.group === 'details');
  const cover = models.find(asset => asset.id === options.coverId) || models[0];
  const elements = [];
  let y = 24;
  const add = (type, props) => {
    const object = { id: createId(), type, x, y, w, h: 60, locked: false, ...props };
    elements.push(object); return object;
  };
  const text = (name, content, height, fontSize, align = 'left', weight = 400, color = '#222222') => {
    add('text', { name, text: content, h: height, fontSize, align, weight, color }); y += height;
  };
  const photo = (asset, role) => {
    const height = Math.max(1, Math.round(w * asset.height / asset.width));
    add('image', { assetId: asset.id, name: role === 'cover' ? '首张模特图' : asset.name, role, fit: 'natural', h: height }); y += height;
  };

  text('页首小标题', '图文详情', 54, 24, 'left', 700);
  if (cover) photo(cover, 'cover');
  y += 112;
  text('商品信息标题', 'information', 65, 48, 'center', 700);
  text('商品信息副标题', '商品信息', 44, 28, 'center', 500);
  y += 44;
  add('size', { name: '实测尺寸', style: 'reference', h: referenceTableHeight('size', sizeData.rows.length) });
  y += referenceTableHeight('size', sizeData.rows.length) + 32;
  add('table', { name: '尺码推荐', dataKey: 'recommendation', style: 'reference', h: referenceTableHeight('recommendation', recommendationData.rows.length) });
  y += referenceTableHeight('recommendation', recommendationData.rows.length) + 36;
  for (const asset of models.filter(asset => asset.id !== cover?.id)) { photo(asset, 'models'); y += photoGap; }
  if (details.length) {
    y += 24;
    text('细节展示标题', 'Detail show. / 细节展示', 94, 36, 'center', 400);
    for (const [index, asset] of details.entries()) {
      photo(asset, 'details'); y += 30;
      text(`细节说明 ${index + 1}`, '细节说明', 64, 18, 'right', 400, '#777777');
      elements.at(-1).associatedRole='details';elements.at(-1).associatedSlot=index;
      add('text', { name: `细节分隔线 ${index + 1}`, text: '', h: 1, color: '#777777', separator: true, separatorColor: '#dddddd', associatedRole:'details',associatedSlot:index });
      y += 1 + detailGap;
    }
  }
  return { elements, coverId: cover?.id || null, height: Math.ceil(Math.max(480, y)) };
}

/** Use copied original information/table blocks; only their cell values are drawn separately. */
export function buildOriginalReferenceLayout(assets, options = {}) {
  const geometry=options.sourceGeometry;
  if(!geometry?.blocks?.size||!geometry?.blocks?.recommendation)throw new Error('原图模板的坐标资料不可用');
  const { inset:x,photoWidth:w,photoGap,detailGap }=REFERENCE_METRICS;
  const createId=options.createId||(()=>crypto.randomUUID()),elements=[];
  const models=assets.filter(asset=>asset.group==='models'),details=assets.filter(asset=>asset.group==='details');
  const cover=models.find(asset=>asset.id===options.coverId)||models[0];
  let y=24;
  const add=(type,props)=>{const object={id:createId(),type,x,y,w,h:60,locked:false,...props};elements.push(object);return object;};
  const photo=(asset,role)=>{const h=Math.max(1,Math.round(w*asset.height/asset.width));add('image',{assetId:asset.id,name:role==='cover'?'首张模特图':asset.name,role,fit:'natural',h});y+=h;};
  add('text',{name:'页首小标题',text:'图文详情',h:54,fontSize:24,align:'left',weight:700,color:'#222222'});y+=54;
  if(cover)photo(cover,'cover');
  const scale=w/geometry.blocks.size.width,size=geometry.blocks.size,recommendation=geometry.blocks.recommendation;
  y+=Math.round((geometry.spacing?.afterHero??65)*scale);
  const sizeH=Math.round(size.height*scale);
  add('size',{name:'商品信息与实测尺寸（原图）',style:'reference-original',sourceBlock:'size',h:sizeH});y+=sizeH;
  const sourceGap=recommendation.cropOrigin&&size.cropOrigin?recommendation.cropOrigin.y-size.cropOrigin.y-size.height:0;
  y+=Math.round((geometry.spacing?.betweenTables??Math.max(0,sourceGap))*scale);
  const recommendationH=Math.round(recommendation.height*w/recommendation.width);
  add('table',{name:'尺码推荐（原图）',style:'reference-original',sourceBlock:'recommendation',dataKey:'recommendation',h:recommendationH});y+=recommendationH;
  y+=Math.round((geometry.spacing?.afterRecommendation??15)*scale);
  for(const asset of models.filter(asset=>asset.id!==cover?.id)){photo(asset,'models');y+=photoGap;}
  if(details.length){
    y+=24;
    add('text',{name:'细节展示标题',text:'Detail show. / 细节展示',h:94,fontSize:36,align:'center',weight:400,color:'#222222'});y+=94;
    for(const [index,asset] of details.entries()){
      photo(asset,'details');y+=30;
      add('text',{name:`细节说明 ${index+1}`,text:'细节说明',h:64,fontSize:18,align:'right',weight:400,color:'#777777',associatedRole:'details',associatedSlot:index});y+=64;
      add('text',{name:`细节分隔线 ${index+1}`,text:'',h:1,color:'#777777',separator:true,separatorColor:'#dddddd',associatedRole:'details',associatedSlot:index});y+=1+detailGap;
    }
  }
  return {elements,coverId:cover?.id||null,height:Math.ceil(Math.max(480,y))};
}

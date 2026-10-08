const aliases={尺码:['尺码','码数','尺寸','size','规格'],衣长:['衣长','后衣长','bodylength'],胸围:['胸围','bust','chest'],肩宽:['肩宽','shoulder','shoulderwidth'],袖长:['袖长','sleeve','sleevelength'],裤长:['裤长','外长','pantslength','trouserlength'],腰围:['腰围','waist'],臀围:['臀围','hips','hip'],脚口:['脚口','裤脚围','legopening']};
const normalize=s=>String(s??'').toLowerCase().replace(/（/g,'(').replace(/）/g,')').replace(/\([^)]*\)/g,'').replace(/\s|[:：_/]/g,'').replace(/厘米|cm|公分/g,'');
const semantic=s=>Object.keys(aliases).find(k=>aliases[k].some(v=>normalize(v)===normalize(s)))||normalize(s);
function rank(s){const n=String(s??'').trim().toUpperCase().replace(/\s/g,'');const known=['XXXS','XXS','XS','S','M','L','XL','XXL','XXXL','4XL','5XL','6XL','7XL','8XL','9XL'];const i=known.indexOf(n);if(i>=0)return i;if(/^\d+XL$/.test(n))return 5+Number(n.slice(0,-2));if(/^\d+(\.\d+)?$/.test(n))return 100+Number(n);return 10000;}
export function mapSizeData(columns,source,preferredOrder=[]){
 if(!Array.isArray(source.columns)||!source.columns.length||!Array.isArray(source.rows)||!source.rows.length)throw new Error('没有识别到有效尺码表');
 const indexes=columns.map(c=>source.columns.findIndex(s=>semantic(s)===semantic(c))),sizeIndex=columns.findIndex(c=>semantic(c)==='尺码');
 const preferred=new Map(preferredOrder.filter(Boolean).map((s,i)=>[String(s).trim().toUpperCase(),i]));
 const rows=source.rows.filter(Array.isArray).map((r,order)=>({order,values:indexes.map(i=>i<0?'':String(r[i]??''))}));
 if(sizeIndex>=0)rows.sort((a,b)=>{const av=a.values[sizeIndex].trim().toUpperCase(),bv=b.values[sizeIndex].trim().toUpperCase();return (preferred.has(av)?preferred.get(av):100+rank(av))-(preferred.has(bv)?preferred.get(bv):100+rank(bv))||a.order-b.order;});
 return {data:{columns:[...columns],rows:rows.map(r=>r.values)},missing:columns.filter((_,i)=>indexes[i]<0)};
}
export function jpgSegments(height){if(!Number.isFinite(height)||height<=0)throw new Error('画布高度无效');const h=Math.ceil(height);return Array.from({length:Math.ceil(h/1920)},(_,i)=>({width:1440,height:Math.min(1920,h-i*1920),offset:i*1920}));}

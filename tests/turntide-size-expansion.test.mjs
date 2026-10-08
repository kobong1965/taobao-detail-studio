import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareTurntideSizeImport,normalizeTurntideSizeLabel,turntideSizePlan,resizeTurntideSizeLayout,buildTurntideLayout,applySavedTurntideLayout,fitTurntideSizeData,turntideSizeDefaults} from '../turntide-template.mjs';

const geometry=JSON.parse(readFileSync(new URL('../assets/turntide-template/geometry.json',import.meta.url)));
const manifest=JSON.parse(readFileSync(new URL('../assets/turntide-template/manifest.json',import.meta.url)));
const labels=['S','M','L','XL','2XL','3XL'];
const source=()=>({columns:['尺码','腰围','臀围','腿围','裤脚','常规版裤长','加长版裤长'],rows:['3XL','S','2XL','M','XL','L'].map(label=>[label+'码',label+'-waist',label+'-hip',label+'-leg',label+'-opening',label+'-regular',label+'-long'])});

test('all six sizes and both trouser lengths survive mapping while labels and foot opening aliases normalize',()=>{
  const original=source(),snapshot=structuredClone(original),mapped=prepareTurntideSizeImport(original);
  assert.deepEqual(original,snapshot);assert.deepEqual(mapped.data.columns,['尺码(SIZE)','腰围','臀围','腿围','脚口','常规版裤长','加长版裤长']);
  assert.deepEqual(mapped.data.rows.map(row=>row[0]),labels);assert.deepEqual(mapped.missing,[]);assert.equal(mapped.expanded,true);
  for(const row of mapped.data.rows){const label=row[0];assert.deepEqual(row,[label,label+'-waist',label+'-hip',label+'-leg',label+'-opening',label+'-regular',label+'-long']);}
  assert.ok(!mapped.data.columns.includes('裤长'));assert.ok(mapped.warnings.some(warning=>warning.includes('没有合并')));
  assert.equal(normalizeTurntideSizeLabel(' 2xl 码 '),'2XL');
});

test('seven rows, unknown measurements, duplicate length fields and nonnumeric values are never dropped or inferred',()=>{
  const original={columns:['裤长','尺码','腰围','臀围','裤脚围','裤长','未知测量'],rows:['4XL','3XL','S','2XL','M','XL','L'].map(label=>['100±2',label+'码','74-78','114','27','108','/'])};
  const mapped=prepareTurntideSizeImport(original);
  assert.equal(mapped.data.rows.length,7);assert.equal(mapped.data.columns.length,7);
  const opening=mapped.data.columns.indexOf('脚口');assert.ok(mapped.data.rows.every(row=>row[opening]==='27'));
  assert.ok(mapped.data.columns.includes('裤长'));assert.ok(mapped.data.columns.includes('裤长（2）'));
  for(const row of mapped.data.rows)assert.deepEqual(row.slice(1).sort(),['100±2','108','114','27','74-78','/'].sort());
  assert.ok(mapped.warnings.some(warning=>warning.includes('重复')));
  assert.deepEqual(mapped.data.rows.map(row=>row[0]),['S','M','L','XL','2XL','3XL','4XL']);
});

test('the existing four-by-five plan keeps the complete original background and geometry',()=>{
  const data=turntideSizeDefaults(),plan=turntideSizePlan(data,geometry),block=geometry.blocks.size;
  assert.equal(plan.mode,'original');assert.equal(plan.sourceHeight,block.height);assert.equal(plan.notesOffset,0);
  assert.deepEqual(plan.backgroundSlices,[{sx:0,sy:0,sw:block.width,sh:block.height,dx:0,dy:0,dw:block.width,dh:block.height}]);
  assert.deepEqual(plan.headers.map(header=>header.centerX),block.table.columnCenters);
  assert.deepEqual(plan.rows.map(row=>row.cells.map(cell=>cell.baselineY)),block.table.dataRows.map(row=>row.cellBaselineY));
  assert.deepEqual(fitTurntideSizeData(data),data);
});

test('six-by-seven rendering grows rows and long headers without squeezing fonts or changing the original note pixels',()=>{
  const data=prepareTurntideSizeImport(source()).data,plan=turntideSizePlan(data,geometry),block=geometry.blocks.size;
  assert.equal(plan.mode,'expanded');assert.equal(plan.copyHeader,false);assert.equal(plan.rows.length,6);assert.equal(plan.headers.length,7);
  assert.ok(plan.height>turntideSizePlan(turntideSizeDefaults(),geometry).height);assert.equal(plan.rowDelta,136);assert.ok(plan.headerDelta>0);
  assert.deepEqual(plan.headers.at(-2).lines,['常规版','裤长']);assert.deepEqual(plan.headers.at(-1).lines,['加长版','裤长']);
  assert.ok(plan.rows.every(row=>row.cells.every(cell=>cell.font.size===block.table.font.size&&cell.font.color==='#000000')));
  const note=plan.backgroundSlices.at(-1);assert.equal(note.sy,block.table.dataRows.at(-1).bottom);assert.equal(note.sh,block.height-note.sy);assert.equal(note.dy,note.sy+plan.notesOffset);
  assert.ok(note.dy>plan.rows.at(-1).baselineY);assert.equal(plan.sourceHeight,block.height+plan.notesOffset);
});

test('adding rows with original columns keeps source header pixels and works beyond six rows',()=>{
  const data=turntideSizeDefaults();data.rows.push(['2XL','90','130','110','60'],['3XL','94','134','112','62'],['4XL','98','138','114','64']);
  const plan=turntideSizePlan(data,geometry);
  assert.equal(plan.mode,'expanded');assert.equal(plan.copyHeader,true);assert.equal(plan.headerDelta,0);assert.equal(plan.rows.length,7);assert.equal(plan.rowDelta,204);
  assert.ok(plan.backgroundSlices[0].sh>geometry.blocks.size.table.headerRow.bottom);
  assert.equal(plan.rows.at(-1).cells[3].value,'114');
});

test('expanded data reflows later sections and saved templates without changing asset identity or user edits',()=>{
  const assets=[{id:'hero',group:'hero',name:'首图',width:1500,height:1996},{id:'detail',group:'details',name:'细节',width:416,height:312},{id:'model',group:'models',name:'模特',width:911,height:1206}],makeId=()=>{let index=0;return()=>`id-${++index}`;};
  const options={manifest,geometry,createId:makeId()},original=buildTurntideLayout(assets,options),data=prepareTurntideSizeImport(source()).data;
  const size=original.elements.find(element=>element.type==='size'),following=original.elements.find(element=>element.role==='details');following.name='用户修改图片名';
  const snapshot=structuredClone(original.elements),resized=resizeTurntideSizeLayout(original.elements,data,geometry),nextSize=resized.elements.find(element=>element.id===size.id),nextDetail=resized.elements.find(element=>element.id===following.id);
  assert.deepEqual(original.elements,snapshot);assert.ok(resized.delta>0);assert.equal(nextDetail.y-nextSize.y-nextSize.h,following.y-size.y-size.h);assert.equal(nextDetail.assetId,following.assetId);assert.equal(nextDetail.name,'用户修改图片名');
  assert.deepEqual(resized.elements.find(element=>element.role==='cover'),original.elements.find(element=>element.role==='cover'));
  const again=resizeTurntideSizeLayout(resized.elements,data,geometry);assert.equal(again.changed,false);assert.equal(again.delta,0);
  const built=buildTurntideLayout(assets,{...options,createId:makeId(),sizeData:data});assert.equal(built.elements.find(element=>element.type==='size').h,nextSize.h);
  const saved=applySavedTurntideLayout(original.elements,assets,{...options,createId:makeId(),sizeData:data}),savedSize=saved.elements.find(element=>element.type==='size');
  assert.equal(savedSize.h,nextSize.h);assert.ok(saved.elements.filter(element=>element.role==='details').every(element=>element.y>=savedSize.y+savedSize.h));
  assert.equal(fitTurntideSizeData(data,{allowExpansion:true}).rows.length,6);
});

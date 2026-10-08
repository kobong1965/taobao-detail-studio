import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TURNTIDE_FOOTER_ASSET,trimTurntideFooter,normalizeTurntideFooterTemplate,buildTurntideLayout,applySavedTurntideLayout} from '../turntide-template.mjs';

const files=['assets/turntide-template/footer-before-toolbar.png','assets/turntide-template/footer-after-toolbar.png'];
const names=['购买须知与洗涤建议 · 原图上段','洗涤建议与设计理念 · 原图下段'];
const replacement={id:'chinese-footer',group:'footer',name:'ABOUT SERVICE · 中文购买须知',assetFile:TURNTIDE_FOOTER_ASSET,src:'new-source-pixels',width:1026,height:900};
const fixture=()=>({id:'existing-project',name:'用户工程',templateId:'pants-four-blocks',sizeData:{rows:[['S','74']]},assets:files.map((assetFile,index)=>({id:`old-${index}`,assetFile,name:names[index],group:'footer',width:1026,height:[2282,1051][index],src:`original-${index}`})),elements:[{id:'model',type:'image',role:'models',assetId:'user-photo',x:25,y:0,w:1200,h:900},{id:'first-footer',type:'image',templateFamily:'turntide',section:'footer',role:'footer',assetId:'old-0',assetFile:files[0],name:names[0],x:24,y:10000,w:1400,h:3202,fit:'natural',locked:true},{id:'second-footer',type:'image',templateFamily:'turntide',section:'footer',role:'footer',assetId:'old-1',assetFile:files[1],name:names[1],x:0,y:13230,w:1440,h:1475,fit:'natural'},{id:'user-note',type:'text',name:'用户追加文字',text:'售后补充',x:17,y:14815,w:700,h:90,fontSize:42,color:'#123456'}],height:14905});

test('old original footer becomes Chinese only without changing the source project or manual footer placement',()=>{
  const previous=fixture(),snapshot=structuredClone(previous),result=trimTurntideFooter(previous,replacement),next=result.project;
  assert.deepEqual(previous,snapshot);assert.equal(result.changed,true);
  const footer=next.elements.find(element=>element.id==='first-footer'),note=next.elements.find(element=>element.id==='user-note');
  assert.deepEqual([footer.x,footer.y,footer.w,footer.fit,footer.locked],[24,10000,1400,'natural',true]);
  assert.equal(footer.assetId,replacement.id);assert.equal(footer.assetFile,TURNTIDE_FOOTER_ASSET);assert.equal(footer.h,1228);
  assert.deepEqual(result.removedElementIds,['second-footer']);assert.deepEqual(result.replacedElementIds,['first-footer']);
  assert.equal(note.y-(footer.y+footer.h),138);assert.equal(note.text,'售后补充');assert.equal(note.fontSize,42);assert.equal(note.color,'#123456');
  assert.equal(next.height,note.y+note.h);assert.ok(next.height>footer.y+footer.h);
  assert.deepEqual(next.sizeData,previous.sizeData);assert.equal(next.name,previous.name);assert.deepEqual(next.elements.find(element=>element.id==='model'),previous.elements[0]);
  assert.deepEqual(next.assets.map(asset=>asset.id),['chinese-footer']);
  const again=trimTurntideFooter(next,replacement);assert.equal(again.changed,false);assert.deepEqual(again.project,next);
});

test('fixed footer preserves its crop scale and unrelated media using the legacy image remains available',()=>{
  const previous=fixture();previous.elements[1].fit='fixed';previous.elements[1].h=2282;
  previous.elements.push({id:'extra-photo',type:'image',role:'details',assetId:'old-0',x:30,y:15500,w:600,h:400});
  const next=trimTurntideFooter(previous,replacement).project;
  assert.equal(next.elements.find(element=>element.id==='first-footer').h,900);
  assert.ok(next.assets.some(asset=>asset.id==='old-0'));
  assert.ok(next.elements.some(element=>element.id==='extra-photo'&&element.assetId==='old-0'));
  assert.equal(next.elements.filter(element=>element.type==='image').length,3);
});

test('a footer replaced by the user is preserved even when older app metadata still names the original file',()=>{
  const previous=fixture();previous.assets[0].name='我的购买须知.png';previous.assets[0].src='my-own-photo';
  const next=trimTurntideFooter(previous,replacement).project,footer=next.elements.find(element=>element.id==='first-footer');
  assert.equal(footer.assetId,'old-0');assert.equal(footer.h,3202);assert.equal(footer.x,24);assert.equal(footer.y,10000);
  assert.equal(next.assets.find(asset=>asset.id==='old-0').src,'my-own-photo');
  assert.ok(!next.assets.some(asset=>asset.id==='chinese-footer'));
  assert.ok(next.elements.some(element=>element.id==='user-note'));
});

test('legacy saved layouts and a new default both use one Chinese footer with all added text retained',()=>{
  const previous=fixture(),sources=previous.elements.slice(1).map(element=>{const source=structuredClone(element);delete source.assetId;return source;}),snapshot=structuredClone(sources);
  const normalized=normalizeTurntideFooterTemplate(sources);
  assert.deepEqual(sources,snapshot);assert.equal(normalized.filter(element=>element.role==='footer').length,1);
  assert.equal(normalized.find(element=>element.role==='footer').assetFile,TURNTIDE_FOOTER_ASSET);
  assert.ok(normalized.some(element=>element.id==='user-note'));
  let id=0;const applied=applySavedTurntideLayout(sources,[replacement],{createId:()=>`new-${++id}`});
  assert.equal(applied.elements.filter(element=>element.role==='footer').length,1);
  assert.equal(applied.elements.find(element=>element.role==='footer').assetFile,TURNTIDE_FOOTER_ASSET);
  assert.ok(applied.elements.some(element=>element.text==='售后补充'));
  const manifest=JSON.parse(readFileSync(new URL('../assets/turntide-template/manifest.json',import.meta.url))),geometry=JSON.parse(readFileSync(new URL('../assets/turntide-template/geometry.json',import.meta.url)));
  assert.equal(manifest.footer.length,1);assert.deepEqual(manifest.footer[0].cropBox,[0,12114,1026,13014]);
  const built=buildTurntideLayout([...previous.assets,replacement],{manifest,geometry,createId:()=>`built-${++id}`});
  assert.equal(built.elements.filter(element=>element.role==='footer').length,1);
  assert.equal(built.elements.find(element=>element.role==='footer').assetId,replacement.id);
});

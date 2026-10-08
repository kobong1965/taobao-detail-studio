import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBatchReview, planBatchFill, planQuickFill, captureSizeRecognition, applyBackgroundSizeResult, replaceMaterial, syncTemplateDraft } from '../material-workflow.mjs';
import { mapSizeData } from '../core.mjs';
import {prepareTurntideSizeImport} from '../turntide-template.mjs';

const asset = (id, group = 'models', width = 600, height = 900) => ({ id, name: `${id}.jpg`, group, width, height, src: `data:image/jpeg;base64,${id}` });
const project = () => ({ id: 'product', name: '当前商品', kind: 'pants', templateId: 'pants-four-blocks', coverId: 'old-model', assets: [asset('old-model'), asset('old-detail', 'details'), asset('old-library', 'library')], elements: [{ id: 'cover', type: 'image', role: 'cover', assetId: 'old-model', x: 0, y: 0, w: 1440, h: 1920, fit: 'fixed' }, { id: 'detail', type: 'image', role: 'details', assetId: 'old-detail', x: 80, y: 2700, w: 500, h: 400, fit: 'natural' }, { id: 'other', type: 'image', role: 'models', assetId: 'old-model', x: 80, y: 4000, w: 1280, h: 1700, fit: 'fixed' }], sizeData: { columns: ['尺码(SIZE)', '腰围', '臀围', '裤长', '脚口'], rows: ['S', 'M', 'L', 'XL'].map(size => [size, '', '', '', '']) }, height: 6000 });
const sizeTable = { columns: ['脚口(cm)', 'SIZE', '裤长(cm)', '腰围(cm)', '臀围(cm)'], rows: [['57', 'M', '104', '78', '118'], ['55', 'S', '102', '74', '114'], ['61', 'XL', '108', '86', '124'], ['59', 'L', '106', '82', '120']] };
const batch = () => [asset('new-detail', 'unclassified'), asset('new-cover', 'unclassified'), asset('new-size', 'unclassified'), asset('new-model', 'unclassified')];
const withBatch = (assets = batch()) => { const original = project(); original.assets.push(...assets); return original; };
const result = () => ({ items: [{ assetId: 'new-detail', category: 'detail', confidence: 0.98, needsReview: false }, { assetId: 'new-cover', category: 'model', confidence: 0.97, needsReview: false }, { assetId: 'new-size', category: 'size', confidence: 0.99, needsReview: false }, { assetId: 'new-model', category: 'model', confidence: 0.96, needsReview: false }], coverAssetId: 'new-cover', sizeTables: [{ assetId: 'new-size', table: structuredClone(sizeTable) }], warnings: [] });
const options = { mapSizeData, targetRows: 4, preferredOrder: ['S', 'M', 'L', 'XL'] };

test('expanding template batch fill keeps six sizes, thigh and separate regular and long measurements',()=>{
  const original=withBatch(),analysis=result();
  analysis.sizeTables[0].table={columns:['尺码','腰围','臀围','腿围','裤脚','常规版裤长','加长版裤长'],rows:[['3XL码','88','128','80','67','110','116'],['S码','70','108','70','57','100','106'],['M码','74','112','72','59','102','108'],['L码','78','116','74','61','104','110'],['XL码','80','120','76','63','106','112'],['2XL码','84','124','78','65','108','114']]};
  const snapshot=JSON.stringify(original),filled=planBatchFill(original,normalizeBatchReview(batch(),analysis),{prepareSizeData:prepareTurntideSizeImport});
  assert.equal(filled.sizeData.rows.length,6);assert.equal(filled.sizeData.columns.length,7);
  assert.deepEqual(filled.sizeData.rows[0],['S','70','108','70','57','100','106']);
  assert.deepEqual(filled.sizeData.rows[5],['3XL','88','128','80','67','110','116']);
  assert.equal(filled.assets.length,original.assets.length);assert.equal(JSON.stringify(original),snapshot);
});

test('batch review covers every uploaded image and leaves omitted classifications for human review', () => {
  const assets = batch(), analysis = result(); analysis.items.pop();
  const before = JSON.stringify({ assets, analysis });
  const review = normalizeBatchReview(assets, analysis);
  assert.equal(review.items.length, assets.length);
  const omitted = review.items.find(item => item.assetId === 'new-model');
  assert.equal(omitted.category, 'unknown'); assert.equal(omitted.needsReview, true);
  assert.equal(JSON.stringify({ assets, analysis }), before);
});

test('review rejects duplicate or foreign classification IDs instead of binding results to another image', () => {
  const analysis = result(); analysis.items.push({ ...analysis.items[0] });
  assert.throws(() => normalizeBatchReview(batch(), analysis));
  const foreign = result(); foreign.items[0].assetId = 'other-product-image';
  assert.throws(() => normalizeBatchReview(batch(), foreign));
});

test('batch fill keeps the material pool, maps the active template columns, and preserves original inputs', () => {
  const assets = batch(), original = withBatch(assets), review = normalizeBatchReview(assets, result());
  const before = JSON.stringify({ original, review });
  const filled = planBatchFill(original, review, options);
  assert.notEqual(filled, original);
  assert.equal(filled.templateId, original.templateId); assert.equal(filled.coverId, 'new-cover');
  assert.equal(filled.assets.length, original.assets.length);
  assert.ok(filled.assets.filter(item => item.id.startsWith('old-')).every(item => item.group === 'library'));
  assert.equal(filled.assets.find(item => item.id === 'new-detail').group, 'details');
  assert.equal(filled.assets.find(item => item.id === 'new-model').group, 'models');
  assert.equal(filled.sizeSource, assets.find(item => item.id === 'new-size').src);
  assert.deepEqual(filled.sizeData, { columns: original.sizeData.columns, rows: [['S', '74', '114', '102', '55'], ['M', '78', '118', '104', '57'], ['L', '82', '120', '106', '59'], ['XL', '86', '124', '108', '61']] });
  assert.equal(JSON.stringify({ original, review }), before);
});

test('unresolved images and extra actual size rows reject atomically without changing the current product', () => {
  const original = withBatch(), before = JSON.stringify(original), analysis = result();
  analysis.items[0] = { ...analysis.items[0], category: 'unknown', needsReview: true };
  assert.throws(() => planBatchFill(original, normalizeBatchReview(batch(), analysis), options));
  const overflow = result(); overflow.sizeTables[0].table.rows.push(['63', '2XL', '110', '90', '128']);
  assert.throws(() => planBatchFill(original, normalizeBatchReview(batch(), overflow), options), /4|行|尺码/);
  assert.equal(JSON.stringify(original), before);
});

test('an explicitly reviewed image may remain in the material pool without being placed into photo blocks', () => {
  const original = withBatch(), analysis = result();
  analysis.items[0] = { ...analysis.items[0], category: 'unknown', needsReview: true };
  const review = normalizeBatchReview(batch(), analysis);
  assert.equal(review.items[0].needsReview, true);
  review.items[0].needsReview = false; // The human explicitly chooses to keep this image in the pool.
  const filled = planBatchFill(original, review, options);
  const retained = filled.assets.find(item => item.id === 'new-detail');
  assert.ok(retained); assert.equal(retained.src, original.assets.find(item => item.id === 'new-detail').src);
  assert.ok(!['models', 'details', 'hero', 'size'].includes(retained.group));
});

test('multiple recognized size tables require an explicit selection and cannot silently overwrite one another', () => {
  const assets = [...batch(), asset('second-size', 'unclassified')], original = withBatch(assets), analysis = result();
  analysis.items.push({ assetId: 'second-size', category: 'size', confidence: 0.99, needsReview: false });
  const second = structuredClone(sizeTable); second.rows[1][3] = '75';
  analysis.sizeTables.push({ assetId: 'second-size', table: second });
  const review = normalizeBatchReview(assets, analysis);
  assert.throws(() => planBatchFill(original, review, options));
  review.selectedSizeAssetId = 'second-size';
  const filled = planBatchFill(original, review, options);
  assert.equal(filled.sizeData.rows[0][1], '75');
  assert.equal(filled.sizeSource, assets.find(item => item.id === 'second-size').src);
});

test('the same pool image can fill multiple blocks without modifying shared image content', () => {
  const original = project(), assetSnapshot = JSON.stringify(original.assets);
  const repeated = replaceMaterial(original, 'detail', 'old-model');
  assert.equal(repeated.elements.find(item => item.id === 'detail').assetId, 'old-model');
  assert.equal(repeated.elements.find(item => item.id === 'cover').assetId, 'old-model');
  assert.equal(repeated.elements.find(item => item.id === 'other').assetId, 'old-model');
  assert.equal(repeated.elements.find(item => item.id === 'detail').h, 750);
  assert.equal(JSON.stringify(repeated.assets), assetSnapshot);
  const independent = replaceMaterial(repeated, 'cover', 'old-detail');
  assert.equal(independent.coverId, 'old-detail');
  assert.equal(independent.elements.find(item => item.id === 'detail').assetId, 'old-model');
  assert.equal(independent.elements.find(item => item.id === 'other').assetId, 'old-model');
  assert.equal(JSON.stringify(independent.assets), assetSnapshot);
  assert.equal(original.elements.find(item => item.id === 'detail').assetId, 'old-detail');
});

test('locked photo blocks permit replacement while preserving their frame and image fitting settings', () => {
  const original = project(); original.elements[1].locked = true;
  Object.assign(original.elements[1], { cropX: 25, cropY: 75 });
  const before = JSON.stringify(original);
  const replaced = replaceMaterial(original, 'detail', 'old-model');
  assert.equal(replaced.elements[1].assetId, 'old-model');
  for (const key of ['x', 'y', 'w', 'h', 'fit', 'cropX', 'cropY', 'locked']) assert.equal(replaced.elements[1][key], original.elements[1][key]);
  assert.throws(() => replaceMaterial(original, 'missing-object', 'old-model'));
  assert.throws(() => replaceMaterial(original, 'cover', 'missing-asset'));
  assert.equal(JSON.stringify(original), before);
});

test('a globally locked template preserves a natural photo frame when its image is replaced', () => {
  const original = project(); original.layoutLocked = true;
  const replaced = replaceMaterial(original, 'detail', 'old-model');
  assert.equal(replaced.elements[1].assetId, 'old-model');
  assert.equal(replaced.elements[1].h, 400);
  assert.equal(replaced.elements[1].fit, 'natural');
});

test('quick screening fills confident categories immediately and leaves uncertain images for human review', () => {
  const original = withBatch(), analysis = result();
  original.sizeData.rows[0][1] = 'OLD-PRODUCT';
  analysis.items[0].confidence = .6;
  analysis.sizeTables = [];
  const review = normalizeBatchReview(batch(), analysis), before = JSON.stringify({ original, review });
  const filled = planQuickFill(original, review, { batchId: 'batch-1' });
  assert.equal(filled.coverId, 'new-cover');
  assert.equal(filled.assets.find(item => item.id === 'new-detail').group, 'unclassified');
  assert.equal(filled.assets.find(item => item.id === 'new-cover').group, 'models');
  assert.equal(filled.assets.find(item => item.id === 'new-cover').analysis.confirmed, false);
  assert.equal(filled.batchAnalysis.batchId, 'batch-1');
  assert.equal(filled.sizeSourceAssetId, 'new-size');
  assert.equal(filled.sizeSource, original.assets.find(item => item.id === 'new-size').src);
  assert.deepEqual(filled.sizeData.rows, ['S', 'M', 'L', 'XL'].map(label => [label, '', '', '', '']));
  assert.equal(JSON.stringify({ original, review }), before);
});

test('human category corrections in the same batch keep completed size data and accept low-confidence manual choices', () => {
  const review = normalizeBatchReview(batch(), result());
  const screened = planQuickFill(withBatch(), review, { batchId: 'batch-1' });
  screened.sizeData.rows[0][1] = '74';
  screened.sizeRecognition = { sourceAssetId: 'new-size', table: sizeTable };
  const corrected = structuredClone(review);
  Object.assign(corrected.items[0], { category: 'model', confidence: .2, needsReview: false, confirmed: true });
  const filled = planQuickFill(screened, corrected, { batchId: 'batch-1' });
  assert.equal(filled.assets.find(item => item.id === 'new-detail').group, 'models');
  assert.equal(filled.assets.find(item => item.id === 'new-detail').analysis.confirmed, true);
  assert.equal(filled.sizeData.rows[0][1], '74');
  assert.deepEqual(filled.sizeRecognition, screened.sizeRecognition);
});

test('marking automatically filled images for secondary review does not remove unchanged classifications in the same batch', () => {
  const screened = planQuickFill(withBatch(), normalizeBatchReview(batch(), result()), { batchId: 'batch-1' });
  screened.sizeData.rows[0][1] = '74';
  screened.sizeRecognition = { sourceAssetId: 'new-size', table: sizeTable };
  const corrected = structuredClone(screened.batchAnalysis);
  corrected.items.forEach(item => item.needsReview = true);
  Object.assign(corrected.items[0], { category: 'model', confirmed: true, needsReview: false });
  const filled = planQuickFill(screened, corrected);
  assert.equal(filled.assets.find(item => item.id === 'new-detail').group, 'models');
  assert.equal(filled.assets.find(item => item.id === 'new-cover').group, 'models');
  assert.equal(filled.assets.find(item => item.id === 'new-model').group, 'models');
  assert.equal(filled.sizeSourceAssetId, 'new-size');
  assert.equal(filled.sizeData.rows[0][1], '74');
  assert.deepEqual(filled.sizeRecognition, screened.sizeRecognition);
});

test('a new product batch clears old size jobs and recommendations while preserving the template fields', () => {
  const original = withBatch();
  Object.assign(original, { sizeScan: { status: 'running', sourceAssetId: 'old-size' }, sizeRecognition: { table: sizeTable }, sizeSource: 'old-source', sizeSourceAssetId: 'old-size', recommendationData: { columns: ['身高', '体重', '尺码'], rows: [['170', '60', 'M']] } });
  const filled = planQuickFill(original, normalizeBatchReview(batch(), result()), { batchId: 'batch-1' });
  assert.equal(filled.sizeScan, undefined); assert.equal(filled.sizeRecognition, undefined);
  assert.equal(filled.sizeSourceAssetId, 'new-size');
  assert.deepEqual(filled.recommendationData, { columns: ['身高', '体重', '尺码'], rows: [['', '', '']] });
});

test('quick screening keeps multiple size candidates without silently choosing a table', () => {
  const assets = [...batch(), asset('second-size', 'unclassified')], analysis = result();
  analysis.items.push({ assetId: 'second-size', category: 'size', confidence: .99, needsReview: false });
  analysis.sizeTables = [];
  const original = withBatch(assets); original.sizeSource = 'old-table'; original.sizeSourceAssetId = 'old-size';
  const filled = planQuickFill(original, normalizeBatchReview(assets, analysis), { batchId: 'batch-1' });
  assert.deepEqual(filled.sizeCandidates, ['new-size', 'second-size']);
  assert.equal(filled.sizeSource, undefined); assert.equal(filled.sizeSourceAssetId, undefined);
  const review = structuredClone(filled.batchAnalysis); review.selectedSizeAssetId = 'second-size';
  const selected = planQuickFill(filled, review, { batchId: 'batch-1' });
  assert.equal(selected.sizeSourceAssetId, 'second-size');
});

function screenedWithOtherCharts(count=0) {
  const assets=[...batch(),...Array.from({length:count},(_,index)=>asset(`other-chart-${index+1}`,'unclassified'))],analysis=result();
  analysis.items.push(...assets.slice(batch().length).map(item=>({assetId:item.id,category:'unknown',confidence:.2,needsReview:true})));
  const screened=planQuickFill(withBatch(assets),normalizeBatchReview(assets,analysis),{batchId:'corrected-source-batch'});
  screened.sizeData.rows[0][1]='PREVIOUS-SOURCE';
  screened.sizeRecognition={sourceAssetId:'new-size',table:structuredClone(sizeTable)};
  screened.sizeScan={status:'pending-review',sourceAssetId:'new-size',table:structuredClone(sizeTable)};
  return screened;
}

test('correcting the selected size image into detail or unknown accepts zero candidates and clears the old source data', () => {
  for(const category of ['detail','unknown']){
    const screened=screenedWithOtherCharts(),review=structuredClone(screened.batchAnalysis);
    Object.assign(review.items.find(item=>item.assetId==='new-size'),{category,confirmed:true,needsReview:false});
    const before=JSON.stringify({screened,review}),filled=planQuickFill(screened,review,{resetSize:false});
    assert.equal(filled.assets.find(item=>item.id==='new-size').group,category==='detail'?'details':'unclassified');
    assert.deepEqual(filled.sizeCandidates,[]);
    assert.equal(filled.sizeSourceAssetId,undefined);assert.equal(filled.sizeSource,undefined);
    assert.equal(filled.batchAnalysis.selectedSizeAssetId,null);assert.equal(filled.batchAnalysis.sizeStatus,'missing');
    assert.equal(filled.sizeRecognition,undefined);assert.equal(filled.sizeScan,undefined);
    assert.equal(filled.sizeData.rows[0][1],'');assert.equal(filled.sizeRevision,screened.sizeRevision+1);
    for(const id of ['new-cover','new-model','new-detail'])assert.deepEqual(filled.assets.find(item=>item.id===id),screened.assets.find(item=>item.id===id));
    assert.equal(filled.coverId,screened.coverId);assert.deepEqual(filled.elements,screened.elements);
    assert.equal(JSON.stringify({screened,review}),before);
  }
});

test('one remaining size candidate becomes the new source after the old selected image is corrected', () => {
  const screened=screenedWithOtherCharts(1),review=structuredClone(screened.batchAnalysis);
  Object.assign(review.items.find(item=>item.assetId==='new-size'),{category:'detail',confirmed:true,needsReview:false});
  Object.assign(review.items.find(item=>item.assetId==='other-chart-1'),{category:'size',confirmed:true,needsReview:false});
  const filled=planQuickFill(screened,review,{resetSize:false});
  assert.deepEqual(filled.sizeCandidates,['other-chart-1']);
  assert.equal(filled.sizeSourceAssetId,'other-chart-1');
  assert.equal(filled.sizeSource,screened.assets.find(item=>item.id==='other-chart-1').src);
  assert.equal(filled.batchAnalysis.selectedSizeAssetId,'other-chart-1');assert.equal(filled.batchAnalysis.sizeStatus,'pending');
  assert.equal(filled.sizeData.rows[0][1],'');assert.equal(filled.sizeRecognition,undefined);assert.equal(filled.sizeScan,undefined);
  assert.equal(filled.coverId,'new-cover');assert.equal(filled.assets.find(item=>item.id==='new-model').group,'models');
});

test('multiple remaining candidates require a fresh choice after the selected size image becomes unknown', () => {
  const screened=screenedWithOtherCharts(2),review=structuredClone(screened.batchAnalysis);
  Object.assign(review.items.find(item=>item.assetId==='new-size'),{category:'unknown',confirmed:true,needsReview:false});
  for(const item of review.items.filter(item=>item.assetId.startsWith('other-chart-')))Object.assign(item,{category:'size',confirmed:true,needsReview:false});
  const filled=planQuickFill(screened,review,{resetSize:false});
  assert.deepEqual(filled.sizeCandidates,['other-chart-1','other-chart-2']);
  assert.equal(filled.sizeSourceAssetId,undefined);assert.equal(filled.sizeSource,undefined);
  assert.equal(filled.batchAnalysis.selectedSizeAssetId,null);assert.equal(filled.batchAnalysis.sizeStatus,'selection-required');
  assert.equal(filled.sizeData.rows[0][1],'');assert.equal(filled.sizeRecognition,undefined);assert.equal(filled.sizeScan,undefined);
  assert.equal(filled.coverId,'new-cover');assert.equal(filled.assets.find(item=>item.id==='new-detail').group,'details');
});

test('foreign or out-of-batch selected size IDs still reject atomically instead of silently choosing a source', () => {
  const screened=screenedWithOtherCharts();
  for(const selectedSizeAssetId of ['foreign-chart','old-detail']){
    const review={...structuredClone(screened.batchAnalysis),selectedSizeAssetId},before=JSON.stringify({screened,review});
    assert.throws(()=>planQuickFill(screened,review),/尺码图已变化/);
    assert.equal(JSON.stringify({screened,review}),before);
  }
});

test('a batch containing only uncertain images still clears old product bindings and values', () => {
  const assets = [asset('uncertain', 'unclassified')], original = withBatch(assets);
  original.sizeData.rows[0][1] = 'OLD';
  const review = normalizeBatchReview(assets, { items: [{ assetId: 'uncertain', category: 'detail', confidence: .3 }] });
  const filled = planQuickFill(original, review, { batchId: 'uncertain-batch' });
  assert.equal(filled.coverId, null);
  assert.ok(filled.assets.filter(item => item.id.startsWith('old-')).every(item => item.group === 'library'));
  assert.equal(filled.sizeData.rows[0][1], '');
});

test('background size recognition applies without blocking unrelated photo review edits', () => {
  const filled = planQuickFill(withBatch(), normalizeBatchReview(batch(), result()), { batchId: 'batch-1' });
  const request = captureSizeRecognition(filled);
  filled.elements[1].assetId = 'new-detail'; filled.name = '人工核对后的商品';
  const before = JSON.stringify(filled);
  const applied = applyBackgroundSizeResult(filled, request, sizeTable, { ...options, recognizedAt: 123 });
  assert.equal(applied.applied, true);
  assert.equal(applied.project.sizeData.rows[0][1], '74');
  assert.equal(applied.project.name, filled.name);
  assert.equal(applied.project.sizeRecognition.batchId, 'batch-1');
  assert.equal(applied.project.sizeRecognition.recognizedAt, 123);
  assert.equal(JSON.stringify(filled), before);
});

test('late background size results cannot overwrite another project, batch, source, or manual table edit', () => {
  const filled = planQuickFill(withBatch(), normalizeBatchReview(batch(), result()), { batchId: 'batch-1' });
  const request = captureSizeRecognition(filled);
  const changes = [
    current => current.id = 'other-product',
    current => current.batchAnalysis.batchId = 'new-batch',
    current => current.sizeSource = 'other-source',
    current => current.sizeSourceAssetId = 'other-asset',
    current => current.sizeData.rows[0][1] = '人工填写',
    current => current.sizeRevision = (current.sizeRevision || 0) + 1
  ];
  for (const change of changes) {
    const current = structuredClone(filled); change(current);
    const before = JSON.stringify(current), result = applyBackgroundSizeResult(current, request, sizeTable, options);
    assert.equal(result.applied, false);
    assert.equal(JSON.stringify(result.project), before);
  }
});

test('template draft sync updates only the current layout and strips product data from the reusable template', () => {
  const original = project(), template = { id: 'custom-template', name: '当前模板', family: 'turntide', kind: 'pants', columns: [...original.sizeData.columns], elements: [] };
  original.templateId = template.id;
  const drafts = structuredClone(original.elements); Object.assign(drafts[1], { x: 140, type: 'text', assetId: 'old-model', role: 'models', grid: 'foreign-grid', data: { product: 'private' }, rows: [['private']], values: ['private'] });
  const before = JSON.stringify({ original, template, drafts });
  const synced = syncTemplateDraft(original, template, drafts);
  assert.equal(synced.project.elements.find(item => item.id === 'detail').x, 140);
  assert.equal(synced.project.elements.find(item => item.id === 'detail').assetId, 'old-detail');
  assert.equal(synced.project.elements.find(item => item.id === 'detail').type, 'image');
  assert.equal(synced.project.elements.find(item => item.id === 'detail').role, 'details');
  assert.equal(synced.project.elements.find(item => item.id === 'detail').grid, undefined);
  assert.deepEqual(synced.project.assets, original.assets); assert.deepEqual(synced.project.sizeData, original.sizeData);
  assert.equal(synced.template.id, template.id);
  assert.ok(synced.template.elements.every(item => !item.assetId && !item.data && !item.rows && !item.values));
  assert.ok(!JSON.stringify(synced.template).includes('data:image/'));
  assert.equal(JSON.stringify({ original, template, drafts }), before);
});

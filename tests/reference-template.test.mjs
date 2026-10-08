import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReferenceLayout, referenceSizeDefaults, referenceRecommendationDefaults, REFERENCE_METRICS } from '../reference-template.mjs';
import { mapSizeData } from '../core.mjs';

const asset = (id, group = 'models', width = 951, height = 1440) => ({ id, name: `${id}.jpg`, group, width, height });
const ids = () => { let index = 0; return () => `fixture-${++index}`; };

test('reference template keeps all variable image blocks in source ratio and page margins', () => {
  const assets = [asset('m1'), asset('m2'), asset('m3'), asset('d1', 'details', 951, 650), asset('d2', 'details', 951, 520)];
  const layout = buildReferenceLayout(assets, { coverId: 'm2', createId: ids() });
  const photos = layout.elements.filter(element => element.type === 'image');
  assert.equal(photos.length, 5);
  assert.equal(photos[0].assetId, 'm2');
  assert.equal(photos[0].role, 'cover');
  for (const photo of photos) {
    const source = assets.find(item => item.id === photo.assetId);
    assert.equal(photo.x, REFERENCE_METRICS.inset);
    assert.equal(photo.w, REFERENCE_METRICS.photoWidth);
    assert.equal(photo.h, Math.round(photo.w * source.height / source.width));
    assert.equal(photo.fit, 'natural');
  }
  assert.ok(photos.filter(photo => photo.role === 'details').every(photo => photo.y > Math.max(...photos.filter(item => item.role !== 'details').map(item => item.y + item.h))));
});

test('reference template defaults use empty product measurements and editable recommendation cells', () => {
  const size = referenceSizeDefaults();
  const recommendation = referenceRecommendationDefaults();
  assert.deepEqual(size.columns, ['尺码', '腰围', '臀围', '裤长', '腿围', '脚围']);
  assert.ok(size.rows.every(row => row.slice(1).every(cell => cell === '')));
  assert.ok(recommendation.rows.every(row => row.slice(1).every(cell => cell === '')));
  size.rows[0][1] = '99';
  recommendation.rows[0][1] = 'M';
  assert.equal(referenceSizeDefaults().rows[0][1], '');
  assert.equal(referenceRecommendationDefaults().rows[0][1], '');
});

test('reference layout keeps information tables and omits absent photos', () => {
  const layout = buildReferenceLayout([], { createId: ids() });
  assert.equal(layout.elements.filter(element => element.type === 'image').length, 0);
  assert.equal(layout.elements.filter(element => element.type === 'size').length, 1);
  assert.equal(layout.elements.filter(element => element.dataKey === 'recommendation').length, 1);
  const text = layout.elements.filter(element => element.type === 'text');
  assert.equal(text.some(element => element.text.includes('Detail show')), false);
});

test('relay OCR data maps to the original pants columns without circumference conversion', () => {
  const template = referenceSizeDefaults();
  const source = { columns: ['裤长(cm)', '尺码', '脚围(cm)', '腿围(cm)', '臀围(cm)', '腰围(cm)'], rows: [['107.5', '2XL', '48', '71', '115', '82'], ['104.5', 'M', '45', '65', '103', '73']] };
  const mapped = mapSizeData(template.columns, source, template.rows.map(row => row[0]));
  assert.deepEqual(mapped.missing, []);
  assert.deepEqual(mapped.data.rows, [['M', '73', '103', '104.5', '65', '45'], ['2XL', '82', '115', '107.5', '71', '48']]);
});

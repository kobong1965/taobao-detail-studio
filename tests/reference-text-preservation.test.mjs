import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReferenceLayout, preserveReferenceTextEdits } from '../reference-template.mjs';
import { readFileSync } from 'node:fs';
const sourceGeometry = JSON.parse(readFileSync(new URL('../assets/pants-reference/geometry.json', import.meta.url), 'utf8'));

const idFactory = prefix => { let id = 0; return () => `${prefix}-${++id}`; };

test('first photo import preserves added text edits alongside the copied information block', () => {
  const previous = buildReferenceLayout([], { createId: idFactory('before'), sourceGeometry });
  const oldAnchor = previous.elements.find(element => element.type === 'size').y;
  const heading = { id: 'added-heading', type: 'text', name: '用户自定义文字', text: '商品资料', fontSize: 42, color: '#333333', weight: 400, align: 'right', x: 42, y: oldAnchor + 20, w: 400, h: 70 };
  previous.elements.push(heading);
  const asset = { id: 'hero', name: 'hero.jpg', group: 'models', width: 900, height: 1200 };
  const next = buildReferenceLayout([asset], { createId: idFactory('after'), sourceGeometry });
  const result = preserveReferenceTextEdits(next.elements, previous.elements);
  const after = result.find(element => element.id === 'added-heading');
  assert.equal(after.text, '商品资料');
  assert.equal(after.fontSize, 42); assert.equal(after.color, '#333333');
  assert.equal(after.weight, 400); assert.equal(after.align, 'right');
  assert.equal(after.y, next.elements.find(element => element.type === 'size').y + 20);
  assert.ok(after.y > result.find(element => element.role === 'cover').y + result.find(element => element.role === 'cover').h);
  assert.equal(heading.text, '商品资料');
  assert.equal(next.elements.find(element => element.type === 'size').style, 'reference-original');
});

test('first photo import keeps custom text, shifting lower text with the information flow', () => {
  const previous = buildReferenceLayout([], { createId: idFactory('before'), sourceGeometry });
  const oldAnchor = previous.elements.find(element => element.type === 'size').y;
  previous.elements.push({ id: 'top-custom', type: 'text', name: '顶部自定义', text: '新品', x: 70, y: 20, w: 300, h: 60, color: '#222222' }, { id: 'bottom-custom', type: 'text', name: '下方自定义', text: '洗涤提示', x: 90, y: oldAnchor + 80, w: 300, h: 60, color: '#777777' });
  const next = buildReferenceLayout([{ id: 'hero', name: 'hero.jpg', group: 'models', width: 900, height: 1200 }], { createId: idFactory('after'), sourceGeometry });
  const result = preserveReferenceTextEdits(next.elements, previous.elements);
  assert.equal(result.find(element => element.id === 'top-custom').y, 20);
  const newAnchor = next.elements.find(element => element.type === 'size').y;
  assert.equal(result.find(element => element.id === 'bottom-custom').y, newAnchor + 80);
  assert.equal(result.filter(element => element.type === 'size').length, 1);
});

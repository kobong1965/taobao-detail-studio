import test from 'node:test';
import assert from 'node:assert/strict';
import { updateTemplateMetadata, setTemplateLayoutLocked, isStructureLocked, fillLockedLayout } from '../workspace-workflow.mjs';

const fixture = () => ({
  id: 'product', templateId: 'template', layoutLocked: true, coverId: 'new-cover', height: 7000,
  assets: [{ id: 'old-photo', name: '旧商品.jpg', group: 'library' }, { id: 'new-cover', name: '新首图.jpg', group: 'models' }, { id: 'new-model', name: '新模特.jpg', group: 'models' }, { id: 'extra-model', name: '留库模特.jpg', group: 'models' }, { id: 'new-detail', name: '新细节.jpg', group: 'details' }, { id: 'footer', group: 'footer' }],
  elements: [{ id: 'cover', type: 'image', role: 'cover', assetId: 'old-photo', x: 0, y: 0, w: 1440, h: 1700, fit: 'natural', cropX: 20 }, { id: 'model', type: 'image', role: 'models', assetId: 'old-photo', x: 60, y: 4000, w: 1300, h: 1800, fit: 'natural' }, { id: 'details', type: 'image', role: 'details', assetId: 'old-photo', x: 60, y: 2600, w: 600, h: 500 }, { id: 'empty-detail', type: 'image', role: 'details', assetId: 'old-photo', src: 'old-product', x: 680, y: 2600, w: 600, h: 500 }, { id: 'footer', type: 'image', role: 'footer', assetId: 'footer', x: 0, y: 6000, w: 1440, h: 500 }, { id: 'heading', type: 'text', text: '细节说明', x: 0, y: 2300, w: 1440, h: 100 }, { id: 'size', type: 'size', x: 60, y: 1900, w: 1300, h: 300 }],
  sizeData: { columns: ['尺码', '腰围'], rows: [['S', '74']] }
});

test('template renaming and thumbnail capture change metadata without copying current product images into template slots', () => {
  const original = { id: 'template', name: '旧名字', builtin: true, elements: [{ type: 'image', role: 'cover', x: 0, y: 0, w: 1440, h: 1600 }] };
  const renamed = updateTemplateMetadata(original, { name: '  我的裤装模板  ', thumbnail: 'data:image/jpeg;base64,preview' });
  assert.equal(renamed.name, '我的裤装模板');
  assert.equal(renamed.thumbnail, 'data:image/jpeg;base64,preview');
  assert.deepEqual(renamed.elements, original.elements);
  assert.equal(original.name, '旧名字'); assert.equal(original.thumbnail, undefined);
  assert.throws(() => updateTemplateMetadata(original, { name: '  ' }), /名称/);
});

test('template locking is synchronized but individual image content stays editable', () => {
  const original = fixture(); original.layoutLocked = false;
  const template = { id: 'template', name: '版式', elements: structuredClone(original.elements) };
  const locked = setTemplateLayoutLocked(original, template, true);
  assert.equal(locked.project.layoutLocked, true); assert.equal(locked.template.layoutLocked, true);
  assert.ok(isStructureLocked(locked.project, locked.project.elements[0]));
  assert.deepEqual(locked.project.elements, original.elements);
  assert.deepEqual(locked.project.sizeData, original.sizeData);
  const unlocked = setTemplateLayoutLocked(locked.project, locked.template, false);
  assert.equal(unlocked.project.layoutLocked, false); assert.equal(unlocked.template.layoutLocked, false);
  const ownLocked = { ...original.elements[0], locked: true };
  assert.equal(isStructureLocked(unlocked.project, ownLocked), true);
  assert.equal(isStructureLocked(unlocked.project, original.elements[0]), false);
});

test('filling a locked layout replaces photos in existing slots without moving modules or retaining previous product photos', () => {
  const original = fixture(), before = JSON.stringify(original);
  const filled = fillLockedLayout(original);
  assert.deepEqual(filled.elements.map(item => item.id), original.elements.map(item => item.id));
  assert.equal(filled.elements[0].assetId, 'new-cover');
  assert.equal(filled.elements[1].assetId, 'new-model');
  assert.equal(filled.elements[2].assetId, 'new-detail');
  assert.equal(filled.elements[3].assetId, undefined); assert.equal(filled.elements[3].src, undefined);
  assert.equal(filled.elements[4].assetId, 'footer');
  for (let index = 0; index < filled.elements.length; index++) for (const key of ['x', 'y', 'w', 'h', 'fit', 'cropX']) assert.equal(filled.elements[index][key], original.elements[index][key]);
  assert.equal(filled.height, 7000);
  assert.equal(filled.assets.find(item => item.id === 'extra-model').group, 'models');
  assert.equal(JSON.stringify(original), before);
});

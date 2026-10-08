import test from 'node:test';
import assert from 'node:assert/strict';
import { createLibraryUi } from '../studio-library-ui.mjs';

function environment(metadata = {}) {
  const defaults = { id: 'top', name: '上衣 · 留白简约', kind: 'top', builtin: true };
  const writes = [];
  const env = { clone: structuredClone, templates: [], builtinMetadata: { top: metadata },
    allTemplates() { return [{ ...defaults, ...this.builtinMetadata.top }]; },
    async storeSet(key, value) { writes.push({ key, value: structuredClone(value) }); } };
  return { env, writes, ui: createLibraryUi(env) };
}

test('reopening an original template keeps the absent lock field absent and drops unrelated project metadata', async () => {
  const { env, writes, ui } = environment({ layoutLocked: true, oldProjectOnly: 'stale' });
  const saved = { id: 'top', name: '商品自己的模板', kind: 'top', builtin: true, thumbnail: 'saved-preview' };
  await ui.restoreSavedTemplate(saved);
  assert.deepEqual(env.allTemplates()[0], saved);
  assert.equal(Object.hasOwn(env.builtinMetadata.top, 'layoutLocked'), false);
  assert.equal(Object.hasOwn(env.builtinMetadata.top, 'oldProjectOnly'), false);
  assert.equal(writes.length, 1);
  assert.deepEqual(saved, { id: 'top', name: '商品自己的模板', kind: 'top', builtin: true, thumbnail: 'saved-preview' });
});

test('reopening preserves each explicitly stored lock value and the entire reusable layout', async () => {
  for (const locked of [false, true]) {
    const { env, ui } = environment({ columns: ['旧项目字段'], elements: [{ id: 'old' }] });
    const saved = { id: 'top', name: '已保存模板', kind: 'top', builtin: true, layoutLocked: locked, thumbnail: '',
      columns: ['尺码', '衣长'], elements: [{ id: 'saved', type: 'image', x: 64, y: 0, w: 1312, h: 1700 }] };
    await ui.restoreSavedTemplate(saved);
    assert.deepEqual(env.allTemplates()[0], saved);
    assert.equal(env.allTemplates()[0].layoutLocked, locked);
  }
});

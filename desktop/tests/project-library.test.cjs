'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createProjectLibrary, exportProjectFile, exportJpgFiles, readBoundedJson } = require('../project-library.cjs');

const TEST_ROOT = 'E:\\Codex工作盘\\temp\\taobao-detail-studio\\project-library-tests';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const JPG = 'data:image/jpeg;base64,/9j/2Q==';
const fixture = (id = 'pants-1', updatedAt = 100) => ({
  id, name: '棕色长裤', kind: 'pants', templateId: 'my-template',
  assets: [{ id: 'asset-1', name: '模特图.png', group: 'models', src: PNG, width: 1, height: 1 }], coverId: 'asset-1',
  elements: [{ id: 'hero', type: 'image', role: 'cover', assetId: 'asset-1', x: 0, y: 0, w: 1440, h: 1440, locked: true, cropX: 30 }, { id: 'size', type: 'size', x: 0, y: 1440, w: 1440, h: 600 }],
  sizeData: { columns: ['尺码', '腰围'], rows: [['S', '70']] }, height: 2040, updatedAt,
  savedTemplate: { id: 'my-template', name: '手动改名模板', kind: 'pants', elements: [{ id: 'hero', type: 'image', role: 'cover', x: 0, y: 0, w: 1440, h: 1440, locked: true }] },
  thumbnail: PNG,
});

async function setup(t, options = {}) {
  await fs.mkdir(TEST_ROOT, { recursive: true });
  const directory = await fs.mkdtemp(path.join(TEST_ROOT, 'run-'));
  t.after(async () => {
    const relative = path.relative(TEST_ROOT, directory);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const root = path.join(directory, 'projects'), tempRoot = path.join(directory, 'temp');
  return { directory, root, tempRoot, library: createProjectLibrary({ root, tempRoot, ...options }) };
}

test('旧 current 原文件保持不变，迁移后项目库可找到并重新打开', async t => {
  const { root, library } = await setup(t);
  await fs.mkdir(root, { recursive: true });
  const legacy = JSON.stringify(fixture(), null, 2);
  await fs.writeFile(path.join(root, 'current-project.json'), legacy);
  const records = await library.list();
  assert.equal(records.length, 1);
  assert.equal(records[0].thumbnail, PNG);
  assert.equal(records[0].assetCount, 1);
  assert.deepEqual(await library.load('pants-1'), fixture());
  assert.equal(await fs.readFile(path.join(root, 'current-project.json'), 'utf8'), legacy);
});

test('多项目写盘串行保留每个项目，保存捕获调用时快照并拒绝无效覆盖', async t => {
  const { library, tempRoot } = await setup(t);
  const first = fixture('pants-1', 100), later = fixture('pants-2', 200);
  const savedFirst = library.save(first);
  first.name = '调用后修改不能污染保存快照';
  const savedLater = library.save(later);
  await Promise.all([savedFirst, savedLater]);
  assert.equal((await library.load('pants-1')).name, '棕色长裤');
  assert.equal((await library.loadCurrent()).id, 'pants-2');
  assert.deepEqual((await library.list()).map(item => item.id), ['pants-2', 'pants-1']);
  assert.throws(() => library.save({ ...later, sizeData: null }), /尺码/);
  assert.equal((await library.loadCurrent()).id, 'pants-2');
  assert.deepEqual(await fs.readdir(tempRoot), []);
  await assert.rejects(library.load('../../current-project'), /没有找到/);
});

test('项目库不限于旧版最近12条，写盘失败不覆盖current且后续保存可恢复', async t => {
  const { library, tempRoot } = await setup(t);
  await Promise.all(Array.from({ length: 14 }, (_, index) => library.save(fixture(`project-${index}`, index))));
  assert.equal((await library.list()).length, 14);
  await fs.rmdir(tempRoot);
  await assert.rejects(library.save(fixture('failed-save', 200)), { code: 'ENOENT' });
  assert.equal((await library.loadCurrent()).id, 'project-13');
  assert.equal((await library.list()).length, 14);
  await fs.mkdir(tempRoot);
  await library.save(fixture('recovered-save', 300));
  assert.equal((await library.loadCurrent()).id, 'recovered-save');
  assert.equal((await library.list()).length, 15);
});

test('便携工程保留图片、模板、尺码和锁定，导入不会覆盖原项目，同名导出增加编号', async t => {
  const { library, directory } = await setup(t);
  const project = fixture(); project.apiKey = 'secret';
  await library.save(project);
  const firstPath = await exportProjectFile({ project, targetPath: path.join(directory, '其他位置 自定义.yixu') });
  const secondPath = await exportProjectFile({ project, targetPath: path.join(directory, '其他位置 自定义.yixu') });
  assert.equal(path.basename(firstPath), '其他位置 自定义.yixu');
  assert.equal(path.basename(secondPath), '其他位置 自定义-2.yixu');
  const bytes = await fs.readFile(firstPath, 'utf8');
  assert.ok(!bytes.includes('secret'));
  const imported = await library.importFile(firstPath);
  assert.notEqual(imported.id, project.id);
  assert.equal(imported.assets[0].src, PNG);
  assert.equal(imported.elements[0].cropX, 30);
  assert.equal(imported.elements[0].locked, true);
  assert.equal(imported.savedTemplate.name, '手动改名模板');
  assert.deepEqual(imported.sizeData, project.sizeData);
  assert.equal((await library.list()).length, 2);
  assert.equal((await library.load(project.id)).apiKey, undefined);
});

test('JPG 支持导出根目录之外的用户目录及基础文件名，碰撞保留旧文件', async t => {
  const { directory } = await setup(t);
  const chosen = path.join(directory, '用户选择文件夹');
  await fs.mkdir(chosen);
  const payload = { projectName: '棕色长裤', fileName: '../手动名称.jpg', files: [{ dataUrl: JPG }, { dataUrl: JPG }] };
  const first = await exportJpgFiles({ directory: chosen, payload });
  assert.equal(first.count, 2);
  assert.deepEqual(await fs.readdir(first.path), ['..-手动名称_01.jpg', '..-手动名称_02.jpg']);
  const before = await fs.readFile(path.join(first.path, '..-手动名称_01.jpg'));
  const second = await exportJpgFiles({ directory: chosen, payload });
  assert.equal(second.path, `${first.path}-2`);
  assert.deepEqual(await fs.readFile(path.join(first.path, '..-手动名称_01.jpg')), before);
  await assert.rejects(exportJpgFiles({ directory: chosen, payload: { ...payload, files: [{ dataUrl: PNG }] } }), /有效/);
  assert.equal((await fs.readdir(chosen)).length, 2);
});

test('大文件在解析前拦截，坏工程导入不改变当前项目或项目库', async t => {
  const { library, directory } = await setup(t);
  await library.save(fixture());
  const invalid = path.join(directory, 'bad.yixu');
  await fs.writeFile(invalid, '{"format":"yixu-detail-project","version":1,"project":{}}');
  await assert.rejects(library.importFile(invalid), /结构/);
  assert.equal((await library.loadCurrent()).id, 'pants-1');
  assert.equal((await library.list()).length, 1);
  await assert.rejects(readBoundedJson(invalid, 4), /200 MB/);
  const exportPath = path.join(directory, 'too-large.yixu');
  await assert.rejects(exportProjectFile({ project: fixture(), targetPath: exportPath, maxBytes: 100 }), /200 MB/);
  await assert.rejects(fs.access(exportPath), { code: 'ENOENT' });
});

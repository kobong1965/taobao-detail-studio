'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { safeFileName, isInside, completionUrl, imageData, parseSizeTable, exportBaseName, validateProject, portableProject, parseProjectFile } = require('../contracts.cjs');

test('API 地址兼容 /v1、完整聊天地址和自定义网关前缀', () => {
  assert.equal(completionUrl('https://relay.example'), 'https://relay.example/v1/chat/completions');
  assert.equal(completionUrl('https://relay.example/v1/'), 'https://relay.example/v1/chat/completions');
  assert.equal(completionUrl('https://relay.example/openai/v1'), 'https://relay.example/openai/v1/chat/completions');
  assert.equal(completionUrl('https://relay.example/v1/chat/completions'), 'https://relay.example/v1/chat/completions');
  assert.throws(() => completionUrl('file:///E:/api'), /http/);
  assert.throws(() => completionUrl('https://key@relay.example'), /账号/);
});

test('导出名称不能包含路径，目录边界工具保留给源码及测试隔离', () => {
  assert.equal(safeFileName('../商品:01'), '..-商品-01');
  assert.equal(safeFileName('CON'), '详情页');
  assert.equal(isInside('E:\\app\\exports', 'E:\\app\\exports\\项目'), true);
  assert.equal(isInside('E:\\app\\exports', 'E:\\app\\exports-copy'), false);
  assert.equal(isInside('E:\\app\\exports', 'E:\\app\\exports\\..\\private'), false);
  assert.equal(isInside('E:\\app\\exports', 'C:\\temp'), false);
  assert.equal(exportBaseName('商品 夏装.jpg'), '商品 夏装');
  assert.equal(exportBaseName('../商品\\01.yixu.json'), '..-商品-01');
  assert.equal(exportBaseName('NUL.jpg', '新款'), '新款');
  assert.equal(exportBaseName('   '), '详情页');
  assert.equal(safeFileName(`${'a'.repeat(95)}.b`), 'a'.repeat(95));
});

function projectFixture() {
  return { id: 'project-1', name: '棕色长裤', kind: 'pants', templateId: 'pants-four-blocks', assets: [], elements: [{ id: 'size-1', type: 'size', x: 0, y: 0, w: 1440, h: 600, locked: true }], sizeData: { columns: ['尺码', '腰围'], rows: [['S', '70']] }, height: 600, updatedAt: 100 };
}

test('便携工程保留模板和锁定模块，清理密钥并验证结构', () => {
  const project = projectFixture();
  project.elements.push({ id: 'recommendation', type: 'table', tableKey: 'recommendationData', x: 0, y: 600, w: 1440, h: 600 });
  project.recommendationData = { columns: ['身高', '体重'], rows: [['170', '60']] };
  project.savedTemplate = { id: 'custom-pants', name: '我的模板', kind: 'pants', elements: structuredClone(project.elements) };
  project.apiKey = 'should-not-export';
  project.sizeRecognition = { model: 'vision-model', encryptedKey: 'also-private' };
  const parsed = parseProjectFile(JSON.stringify(portableProject(project)));
  assert.equal(parsed.elements[0].locked, true);
  assert.equal(parsed.elements[1].type, 'table');
  assert.deepEqual(parsed.recommendationData, project.recommendationData);
  assert.deepEqual(parsed.savedTemplate, project.savedTemplate);
  assert.equal(parsed.apiKey, undefined);
  assert.deepEqual(parsed.sizeRecognition, { model: 'vision-model' });
  assert.equal(project.apiKey, 'should-not-export');
  assert.throws(() => validateProject({ ...project, elements: [{ ...project.elements[0], w: -1 }] }), /位置或尺寸/);
  assert.throws(() => validateProject({ ...project, sizeData: { columns: ['尺码'], rows: [['S', 70]] } }), /尺码表/);
  assert.throws(() => validateProject({ ...project, assets: [{ id: 'a', name: '图片', src: 'https://remote.example/image.jpg', width: 1, height: 1 }] }), /有效/);
  assert.throws(() => parseProjectFile(JSON.stringify(project)), /衣序导出/);
  assert.throws(() => parseProjectFile('{ invalid json }'), /JSON/);
  assert.throws(() => validateProject(project, { maxBytes: 10 }), /200 MB/);
});

test('尺码识别保留数值和半围含义，拒绝结构不一致与空结果', () => {
  assert.deepEqual(parseSizeTable('```json\n{"columns":["尺码","胸围（半围 cm）"],"rows":[["S","54"],["M",null]]}\n```'), {
    columns: ['尺码', '胸围（半围 cm）'], rows: [['S', '54'], ['M', '']],
  });
  assert.throws(() => parseSizeTable('{"columns":["尺码","胸围"],"rows":[["S"]]}'), /列数/);
  assert.throws(() => parseSizeTable('{"columns":["尺码"],"rows":[]}'), /没有识别/);
  assert.throws(() => parseSizeTable('不是 JSON'), /JSON/);
});

test('拒绝伪造图片 MIME 和无效导出数据', () => {
  assert.throws(() => imageData('data:image/jpeg;base64,aGVsbG8='), /内容/);
  assert.throws(() => imageData('https://remote.example/a.jpg'), /有效/);
  assert.throws(() => imageData('data:text/html;base64,PGh0bWw+'), /有效/);
});

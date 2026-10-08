'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runtimePaths } = require('../runtime-paths.cjs');

test('development keeps data beside the existing source without a machine-specific root', () => {
  const paths = runtimePaths({ sourceRoot: 'D:\\Apps\\衣序源码', execPath: 'D:\\Runtime\\electron.exe', isPackaged: false, argv: [] });
  assert.equal(paths.dataRoot, 'D:\\Apps\\衣序源码\\data');
  assert.equal(paths.tempRoot, 'D:\\Apps\\衣序源码\\data\\temp');
  assert.equal(paths.exportRoot, 'D:\\Apps\\衣序源码\\data\\exports');
  assert.equal(paths.smoke, false);
});

test('portable application writes beside its executable instead of resources or the build machine', () => {
  const paths = runtimePaths({ sourceRoot: 'F:\\衣序\\resources\\app', execPath: 'F:\\衣序\\YixuDetailStudio.exe', isPackaged: true, argv: [] });
  assert.equal(paths.dataRoot, 'F:\\衣序\\data');
  assert.equal(paths.profileRoot, 'F:\\衣序\\data\\desktop-profile');
  assert.equal(paths.projectRoot, 'F:\\衣序\\data\\projects');
  assert.equal(paths.apiRoot, 'F:\\衣序\\data\\api');
});

test('an explicitly selected data directory uses the same volume for atomic save temporaries', () => {
  const paths = runtimePaths({ sourceRoot: 'F:\\衣序\\resources\\app', execPath: 'F:\\衣序\\YixuDetailStudio.exe', isPackaged: true, argv: ['--data-dir=G:\\服装资料\\衣序'] });
  assert.equal(paths.dataRoot, 'G:\\服装资料\\衣序');
  assert.equal(paths.tempRoot, 'G:\\服装资料\\衣序\\temp');
  assert.throws(() => runtimePaths({ sourceRoot: 'F:\\app', execPath: 'F:\\app.exe', isPackaged: true, argv: ['--data-dir=relative'] }), /绝对路径/);
});

test('release verification explicitly isolates all writes on the authorized E drive', () => {
  const output = 'E:\\Codex工作盘\\artifacts\\test-builds\\衣序发布验证';
  const paths = runtimePaths({ sourceRoot: 'E:\\Portable\\resources\\app', execPath: 'E:\\Portable\\YixuDetailStudio.exe', isPackaged: true, argv: ['--release-smoke=' + output] });
  assert.equal(paths.smoke, true);
  assert.equal(paths.smokeRoot, output);
  assert.equal(paths.dataRoot, output + '\\data');
  assert.equal(paths.profileRoot, output + '\\data\\desktop-profile');
  assert.equal(paths.exportRoot, output + '\\data\\exports');
  assert.equal(paths.normalDataRoot, 'E:\\Portable\\data');
  assert.throws(() => runtimePaths({ sourceRoot: 'F:\\app', execPath: 'F:\\app.exe', isPackaged: true, argv: ['--release-smoke=C:\\Temp\\validation'] }), /Codex工作盘/);
  assert.throws(() => runtimePaths({ sourceRoot: 'F:\\app', execPath: 'F:\\app.exe', isPackaged: true, argv: ['--smoke-test'] }), /release-smoke/);
});

test('restart checks require an explicit isolated output and reject ambiguous data overrides', () => {
  const base = { sourceRoot: 'F:\\app', execPath: 'F:\\app.exe', isPackaged: true };
  assert.throws(() => runtimePaths({ ...base, argv: ['--release-smoke-reopen'] }), /release-smoke/);
  assert.throws(() => runtimePaths({ ...base, argv: ['--release-smoke=E:\\Codex工作盘\\temp\\release', '--data-dir=G:\\personal'] }), /同时/);
  assert.throws(() => runtimePaths({ ...base, argv: ['--upload-size-smoke'] }), /不支持/);
});

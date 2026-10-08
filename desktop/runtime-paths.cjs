'use strict';

const path = require('node:path');

function argumentValue(argv, flag) {
  const values = argv.filter(value => value.startsWith(flag + '='));
  if (values.length > 1) throw new Error(`参数 ${flag} 只能指定一次。`);
  return values[0]?.slice(flag.length + 1);
}

function absoluteDirectory(value, label) {
  if (!value || !path.win32.isAbsolute(value) || !/^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/.test(value)) throw new Error(`${label}必须使用完整绝对路径。`);
  return path.win32.resolve(value);
}

function runtimePaths({ sourceRoot, execPath, isPackaged, argv = [] }) {
  const join = path.win32.join;
  const runtimeRoot = isPackaged ? path.win32.dirname(execPath) : sourceRoot;
  const explicitData = argumentValue(argv, '--data-dir');
  const releaseOutput = argumentValue(argv, '--release-smoke');
  const reopen = argv.includes('--release-smoke-reopen');
  const unsupported = argv.find(value => /^--(?:reference-template|four-block|batch-workflow|upload-size|workspace-upgrade)(?:-smoke|-reopen|-fixture)/.test(value));
  if (unsupported) throw new Error(`公开版不支持私人验证参数 ${unsupported.split('=')[0]}，请使用 --release-smoke=<绝对输出目录>。`);
  if ((reopen || argv.includes('--smoke-test')) && !releaseOutput) throw new Error('隐藏验证必须显式指定 --release-smoke=<绝对输出目录>。');
  if (releaseOutput && explicitData) throw new Error('隐藏验证不能同时指定普通数据目录。');
  const normalDataRoot = explicitData ? absoluteDirectory(explicitData, '数据目录') : join(runtimeRoot, 'data');
  let smokeRoot = null;
  if (releaseOutput) {
    smokeRoot = absoluteDirectory(releaseOutput, '发布验证输出目录');
    const allowed = 'E:\\Codex工作盘';
    const relative = path.win32.relative(allowed, smokeRoot);
    if (!relative || relative.startsWith('..') || path.win32.isAbsolute(relative)) throw new Error('发布验证输出目录必须位于 E:\\Codex工作盘 下，且不能直接使用工作盘根目录。');
  }
  const dataRoot = smokeRoot ? join(smokeRoot, 'data') : normalDataRoot;
  return Object.freeze({ runtimeRoot, normalDataRoot, dataRoot, smoke: Boolean(smokeRoot), reopen, smokeRoot,
    profileRoot: join(dataRoot, 'desktop-profile'), projectRoot: join(dataRoot, 'projects'), apiRoot: join(dataRoot, 'api'),
    tempRoot: join(dataRoot, 'temp'), cacheRoot: join(dataRoot, 'cache'), exportRoot: join(dataRoot, 'exports') });
}

module.exports = { runtimePaths };

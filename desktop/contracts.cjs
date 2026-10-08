'use strict';

const path = require('node:path');

function safeFileName(value, fallback = '详情页') {
  const cleaned = String(value || '').normalize('NFC').trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .slice(0, 96).replace(/[. ]+$/g, '');
  if (!cleaned || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(cleaned)) return fallback;
  return cleaned;
}

const PROJECT_MAX_BYTES = 200 * 1024 * 1024;
const PROJECT_FILE_FORMAT = 'yixu-detail-project';
const privateFields = new Set(['apikey', 'encryptedkey', 'authorization', 'accesstoken', 'refreshtoken', 'sessionkey', 'password', 'apiconfig']);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);

function cleanProjectJson(value, maxBytes = PROJECT_MAX_BYTES) {
  let serialized;
  try { serialized = JSON.stringify(value); } catch { throw new Error('工程中有无法保存的数据。'); }
  if (typeof serialized !== 'string') throw new Error('工程数据格式无效。');
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) throw new Error('工程超过 200 MB，请减少图片数量或压缩素材后再保存。');
  // Portable projects never carry credentials, even if a legacy record accidentally included them.
  return JSON.parse(serialized, (key, item) => privateFields.has(key.toLowerCase()) || ['__proto__', 'constructor', 'prototype'].includes(key) ? undefined : item);
}

function validateElements(elements, label) {
  if (!Array.isArray(elements) || elements.length > 10000) throw new Error(`${label}的模块列表无效。`);
  const ids = new Set();
  for (const element of elements) {
    if (!element || typeof element !== 'object' || Array.isArray(element) || !validId(element.id) || ids.has(element.id)
      || !['image', 'text', 'size', 'table'].includes(element.type)) throw new Error(`${label}含有无效或重复的模块。`);
    ids.add(element.id);
    if (['x', 'y', 'w', 'h'].some(key => !Number.isFinite(element[key]) || Math.abs(element[key]) > 10000000) || element.w <= 0 || element.h <= 0) throw new Error(`${label}含有无效的模块位置或尺寸。`);
  }
}

function validateProject(value, { maxBytes = PROJECT_MAX_BYTES } = {}) {
  const project = cleanProjectJson(value, maxBytes);
  if (!project || typeof project !== 'object' || Array.isArray(project)
    || !validId(project.id)
    || typeof project.name !== 'string' || !project.name.trim() || project.name.length > 500
    || !['top', 'pants'].includes(project.kind)
    || !validId(project.templateId)
    || !Array.isArray(project.assets) || project.assets.length > 1000) throw new Error('工程文件结构无效，无法打开。');
  const assetIds = new Set();
  for (const asset of project.assets) {
    if (!asset || typeof asset !== 'object' || Array.isArray(asset) || !validId(asset.id) || assetIds.has(asset.id)
      || typeof asset.name !== 'string' || asset.name.length > 1000
      || !Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width <= 0 || asset.height <= 0) throw new Error('工程含有无效或重复的图片素材。');
    assetIds.add(asset.id);
    try { imageData(asset.src); }
    catch (error) { throw new Error(`素材“${asset.name}”无法保存：${error.message}`); }
  }
  validateElements(project.elements, '工程');
  if (project.elements.some(element => element.type === 'image' && element.assetId && !assetIds.has(element.assetId))) throw new Error('工程模块引用的图片素材不存在。');
  if (!project.sizeData || !Array.isArray(project.sizeData.columns) || project.sizeData.columns.length > 30 || !project.sizeData.columns.length
    || project.sizeData.columns.some(column => typeof column !== 'string' || column.length > 200)
    || !Array.isArray(project.sizeData.rows) || project.sizeData.rows.length > 100
    || project.sizeData.rows.some(row => !Array.isArray(row) || row.length !== project.sizeData.columns.length || row.some(cell => !['string', 'number'].includes(typeof cell) || String(cell).length > 500))) throw new Error('工程尺码表结构无效。');
  for (const key of ['savedTemplate', 'sourceTemplate']) {
    const saved = project[key];
    if (saved !== undefined && saved !== null && (!saved || typeof saved !== 'object' || Array.isArray(saved) || !validId(saved.id) || typeof saved.name !== 'string' || saved.name.length > 500 || !['top', 'pants'].includes(saved.kind))) throw new Error('工程中保存的模板结构无效。');
    if (saved?.elements !== undefined) validateElements(saved.elements, '模板');
    if (saved?.thumbnail) imageData(saved.thumbnail);
  }
  if (project.thumbnail !== undefined) {
    if (typeof project.thumbnail !== 'string' || project.thumbnail.length > 1024 * 1024) throw new Error('工程缩略图过大或无效。');
    if (project.thumbnail) imageData(project.thumbnail);
  }
  return project;
}

function portableProject(value, options) {
  return { format: PROJECT_FILE_FORMAT, version: 1, exportedAt: new Date().toISOString(), project: validateProject(value, options) };
}

function parseProjectFile(content, options) {
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > (options?.maxBytes || PROJECT_MAX_BYTES)) throw new Error('工程文件超过 200 MB 或内容无效。');
  let parsed;
  try { parsed = JSON.parse(content.replace(/^\uFEFF/, '')); } catch { throw new Error('工程文件不是有效的 JSON。'); }
  if (parsed?.format !== PROJECT_FILE_FORMAT || parsed.version !== 1 || !parsed.project) throw new Error('请选择衣序导出的 .yixu 工程文件。');
  return validateProject(parsed.project, options);
}

function exportBaseName(value, fallback = '详情页') {
  return safeFileName(String(value || '').replace(/\.(?:jpe?g|yixu(?:\.json)?|json)$/i, ''), safeFileName(fallback));
}

function isInside(base, candidate) {
  const relative = path.win32.relative(path.win32.resolve(base), path.win32.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.win32.isAbsolute(relative));
}

function completionUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('请先填写中转站 API 地址。');
  let url;
  try { url = new URL(raw); } catch { throw new Error('API 地址格式无效，请填写完整的 http:// 或 https:// 地址。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('API 地址必须使用 http:// 或 https://，且不能包含账号或密码。');
  }
  url.hash = '';
  url.search = '';
  const pathname = url.pathname.replace(/\/+$/, '');
  url.pathname = pathname.endsWith('/chat/completions')
    ? pathname
    : `${pathname || '/v1'}/chat/completions`;
  return url.toString();
}

function imageData(value, requiredMime) {
  if (typeof value !== 'string' || value.length > 35 * 1024 * 1024) {
    throw new Error('图片数据无效或过大，请使用小于 25 MB 的图片。');
  }
  const match = /^data:image\/(jpeg|jpg|png|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || (requiredMime && !requiredMime.includes(match[1]))) throw new Error('只支持有效的 JPG、PNG、WebP 或 GIF 图片。');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 25 * 1024 * 1024 || bytes.length === 0) throw new Error('图片数据无效或超过 25 MB。');
  const jpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  const gif = bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6));
  if (!({jpeg, jpg: jpeg, png, webp, gif})[match[1]]) throw new Error('图片文件内容与格式不一致，请重新选择图片。');
  return { mime: match[1], bytes };
}

function parseSizeTable(content) {
  let candidate = content;
  if (typeof content === 'string') {
    let text = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first >= 0 && last >= first) text = text.slice(first, last + 1);
    try { candidate = JSON.parse(text); } catch { throw new Error('模型没有返回有效的尺码表 JSON，请确认模型支持图片识别后重试。'); }
  }
  if (!candidate || !Array.isArray(candidate.columns) || !Array.isArray(candidate.rows)
    || candidate.columns.length < 1 || candidate.columns.length > 30 || candidate.rows.length > 100) {
    throw new Error('识别结果的表格结构无效，请检查尺码图或更换图片识别模型。');
  }
  const columns = candidate.columns.map((column) => {
    if (typeof column !== 'string' || !column.trim() || column.length > 100) throw new Error('识别结果含有无效的表头。');
    return column.trim();
  });
  const rows = candidate.rows.map((row) => {
    if (!Array.isArray(row) || row.length !== columns.length) throw new Error('识别结果存在列数不一致，请检查尺码图或重试。');
    return row.map((value) => {
      if (value === null || value === undefined) return '';
      if (!['string', 'number'].includes(typeof value) || String(value).length > 200) throw new Error('识别结果存在无效的单元格。');
      return String(value).trim();
    });
  });
  if (!rows.length) throw new Error('没有识别到可读的尺码数据，请上传更清晰的尺码表图片。');
  return { columns, rows };
}

module.exports = { safeFileName, isInside, completionUrl, imageData, parseSizeTable, PROJECT_MAX_BYTES, PROJECT_FILE_FORMAT, validateProject, portableProject, parseProjectFile, exportBaseName };

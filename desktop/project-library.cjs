'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { PROJECT_MAX_BYTES, validateProject, portableProject, parseProjectFile, exportBaseName, imageData } = require('./contracts.cjs');

function metadata(project) {
  return {
    id: project.id, name: project.name, kind: project.kind, templateId: project.templateId,
    updatedAt: Number.isFinite(project.updatedAt) ? project.updatedAt : 0,
    height: Number.isFinite(project.height) ? project.height : 0,
    assetCount: project.assets.length, thumbnail: project.thumbnail || '',
  };
}

async function readBoundedJson(file, maxBytes = PROJECT_MAX_BYTES) {
  let handle;
  try {
    handle = await fs.open(file, 'r');
    if ((await handle.stat()).size > maxBytes) throw new Error('工程文件超过 200 MB，请先压缩素材。');
    const text = await handle.readFile('utf8');
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('工程文件超过 200 MB，请先压缩素材。');
    return text;
  } finally { await handle?.close(); }
}

function createProjectLibrary({ root, tempRoot, maxBytes = PROJECT_MAX_BYTES }) {
  if (!path.isAbsolute(root) || !path.isAbsolute(tempRoot)) throw new Error('工程库及临时目录必须使用完整绝对路径。');
  const currentPath = path.join(root, 'current-project.json');
  const libraryRoot = path.join(root, 'library');
  let queue = Promise.resolve();
  let initialized = false;
  const paths = id => {
    if (typeof id !== 'string' || !id || id.length > 160) throw new Error('工程编号无效。');
    const hash = createHash('sha256').update(id).digest('hex');
    return { project: path.join(libraryRoot, `${hash}.json`), meta: path.join(libraryRoot, `${hash}.meta.json`) };
  };
  function serial(operation) {
    const running = queue.catch(() => undefined).then(operation);
    queue = running.catch(() => undefined);
    return running;
  }
  async function atomicJson(file, value) {
    const temporary = path.join(tempRoot, `project-library-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, { force: true }); }
  }
  async function readProject(file) {
    return validateProject(JSON.parse(await readBoundedJson(file, maxBytes)), { maxBytes });
  }
  async function archive(project) {
    const target = paths(project.id);
    await atomicJson(target.project, project);
    await atomicJson(target.meta, metadata(project));
  }
  async function initialize() {
    if (initialized) return;
    await fs.mkdir(libraryRoot, { recursive: true });
    await fs.mkdir(tempRoot, { recursive: true });
    // Migration adds a library entry without changing the existing current record.
    let current;
    try { current = await readProject(currentPath); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error(`原工程无法读取，已保留原文件：${error.message}`); }
    if (current) {
      const target = paths(current.id);
      try { await fs.access(target.project); }
      catch (error) { if (error.code !== 'ENOENT') throw error; await archive(current); }
    }
    // Recover an archive whose metadata write was interrupted, without using a global index.
    for (const name of await fs.readdir(libraryRoot)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const metaFile = path.join(libraryRoot, name.replace(/\.json$/, '.meta.json'));
      try { await fs.access(metaFile); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await atomicJson(metaFile, metadata(await readProject(path.join(libraryRoot, name))));
      }
    }
    initialized = true;
  }
  return Object.freeze({
    currentPath,
    save(value) {
      const snapshot = validateProject(value, { maxBytes });
      return serial(async () => {
        await initialize();
        await archive(snapshot);
        await atomicJson(currentPath, snapshot);
        return { ok: true, id: snapshot.id, project: metadata(snapshot) };
      });
    },
    loadCurrent() {
      return serial(async () => {
        await initialize();
        try { return await readProject(currentPath); }
        catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      });
    },
    list() {
      return serial(async () => {
        await initialize();
        const records = [];
        for (const name of await fs.readdir(libraryRoot)) {
          if (!/^[a-f0-9]{64}\.meta\.json$/.test(name)) continue;
          const item = JSON.parse(await readBoundedJson(path.join(libraryRoot, name), 2 * 1024 * 1024));
          if (item && typeof item.id === 'string' && typeof item.name === 'string') records.push(item);
        }
        return records.sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name));
      });
    },
    load(id) {
      const target = paths(id);
      return serial(async () => {
        await initialize();
        try {
          const project = await readProject(target.project);
          if (project.id !== id) throw new Error('项目库工程编号与保存位置不一致，请保留原文件。');
          return project;
        }
        catch (error) { if (error.code === 'ENOENT') throw new Error('项目库中没有找到这个工程。'); throw error; }
      });
    },
    async importFile(file) {
      if (!path.isAbsolute(file)) throw new Error('请使用完整的工程文件路径。');
      const imported = parseProjectFile(await readBoundedJson(file, maxBytes), { maxBytes });
      // An imported file becomes a new project; reopening it cannot overwrite a library entry.
      const project = { ...imported, id: randomUUID(), updatedAt: Date.now() };
      await this.save(project);
      return project;
    },
  });
}

async function writeUniqueFile(target, bytes) {
  const parsed = path.parse(target);
  for (let index = 1; index <= 10000; index++) {
    const candidate = index === 1 ? target : path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    let handle;
    try { handle = await fs.open(candidate, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') continue; throw error; }
    try {
      await handle.writeFile(bytes);
      await handle.close();
      return candidate;
    } catch (error) {
      await handle.close().catch(() => undefined);
      await fs.rm(candidate, { force: true });
      throw error;
    }
  }
  throw new Error('同名文件太多，请换一个导出名称。');
}

async function exportProjectFile({ project, targetPath, maxBytes = PROJECT_MAX_BYTES }) {
  if (!path.isAbsolute(targetPath)) throw new Error('请选择完整的工程文件导出路径。');
  const document = portableProject(project, { maxBytes });
  const serialized = JSON.stringify(document);
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) throw new Error('工程文件超过 200 MB，请先压缩素材。');
  const directory = path.dirname(targetPath);
  const fileName = `${exportBaseName(path.basename(targetPath), project.name)}.yixu`;
  return writeUniqueFile(path.join(directory, fileName), serialized);
}

async function exportJpgFiles({ directory, payload }) {
  if (!path.isAbsolute(directory)) throw new Error('请选择完整的导出文件夹路径。');
  if (!payload || !Array.isArray(payload.files) || payload.files.length < 1 || payload.files.length > 200) throw new Error('没有有效的导出图片，或图片数量超过 200 张。');
  const files = payload.files.map(file => imageData(file?.dataUrl, ['jpeg', 'jpg']).bytes);
  const prefix = exportBaseName(payload.fileName, payload.projectName || '详情页');
  let output;
  for (let index = 1; index <= 10000; index++) {
    output = path.join(directory, index === 1 ? prefix : `${prefix}-${index}`);
    try { await fs.mkdir(output); break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; output = null; }
  }
  if (!output) throw new Error('同名文件夹太多，请换一个导出名称。');
  try {
    for (const [index, bytes] of files.entries()) {
      await fs.writeFile(path.join(output, `${prefix}_${String(index + 1).padStart(2, '0')}.jpg`), bytes, { flag: 'wx' });
    }
  } catch (error) {
    // This directory was exclusively created by this export, so failure cleanup is bounded.
    const relative = path.relative(path.resolve(directory), path.resolve(output));
    if (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) await fs.rm(output, { recursive: true, force: true });
    throw error;
  }
  return { ok: true, path: output, count: files.length };
}

module.exports = { createProjectLibrary, exportProjectFile, exportJpgFiles, readBoundedJson, metadata };

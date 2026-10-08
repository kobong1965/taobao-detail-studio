'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');

const APP_FILES=[
  'package.json','index.html','app.js','app.css','styles.css','core.mjs',
  'reference-template.mjs','turntide-template.mjs','file-drop.mjs','material-workflow.mjs',
  'workspace-workflow.mjs','studio-library-ui.mjs','studio-preview.mjs',
  'desktop/package.json','desktop/main.cjs','desktop/preload.cjs','desktop/contracts.cjs',
  'desktop/material-analysis.cjs','desktop/project-library.cjs','desktop/recognition-task.cjs',
  'desktop/runtime-paths.cjs'
];
const inside=(root,target)=>{const relative=path.relative(root,target);return !relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function absolute(value,label){if(!value||!path.isAbsolute(value))throw new Error(`${label}必须显式指定完整绝对路径`);return path.resolve(value);}
async function copyTree(source,target){
  const info=await fs.lstat(source);if(info.isSymbolicLink())throw new Error('发布内容不允许符号链接：'+source);
  if(info.isDirectory()){
    await fs.mkdir(target,{recursive:true});
    for(const entry of await fs.readdir(source))await copyTree(path.join(source,entry),path.join(target,entry));
  }else if(info.isFile()){await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(source,target);}
  else throw new Error('发布内容不是常规文件：'+source);
}
async function listFiles(root,current=root){
  const files=[];for(const entry of await fs.readdir(current,{withFileTypes:true})){
    const absolutePath=path.join(current,entry.name);
    if(entry.isSymbolicLink())throw new Error('发布清单不允许符号链接');
    if(entry.isDirectory())files.push(...await listFiles(root,absolutePath));
    else {const bytes=await fs.readFile(absolutePath);files.push({path:path.relative(root,absolutePath).split(path.sep).join('/'),bytes:bytes.length,sha256:sha256(bytes)});}
  }return files.sort((a,b)=>a.path.localeCompare(b.path));
}
async function buildPortable(options){
  const sourceRoot=absolute(options.sourceRoot,'源码目录'),runtimeRoot=absolute(options.runtimeRoot,'运行时目录'),outputRoot=absolute(options.outputRoot,'输出目录');
  if(inside(sourceRoot,outputRoot)||inside(runtimeRoot,outputRoot)||inside(outputRoot,sourceRoot)||inside(outputRoot,runtimeRoot))throw new Error('输出目录必须与源码和运行时分离');
  const metadata=JSON.parse(await fs.readFile(path.join(sourceRoot,'package.json'),'utf8'));
  const desktop=JSON.parse(await fs.readFile(path.join(sourceRoot,'desktop','package.json'),'utf8'));
  if(metadata.version!==desktop.version||!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(metadata.version))throw new Error('桌面版本与打包版本不一致');
  if(metadata.main!=='desktop/main.cjs')throw new Error('便携包入口必须为 desktop/main.cjs');
  const name=`yixu-detail-studio-${metadata.version}-win-x64`,directory=path.join(outputRoot,name);
  try{await fs.access(directory);throw new Error('发布目录已存在，拒绝覆盖：'+directory);}catch(error){if(error.code!=='ENOENT')throw error;}
  // Validate required input before creating the payload. User data is never enumerated.
  for(const file of APP_FILES)await fs.access(path.join(sourceRoot,file));
  await fs.access(path.join(runtimeRoot,'electron.exe'));await fs.access(path.join(runtimeRoot,'LICENSE'));
  await fs.mkdir(directory,{recursive:true});await copyTree(runtimeRoot,directory);
  await fs.rename(path.join(directory,'electron.exe'),path.join(directory,'YixuDetailStudio.exe'));
  const application=path.join(directory,'resources','app');await fs.mkdir(application,{recursive:true});
  for(const file of APP_FILES)await copyTree(path.join(sourceRoot,file),path.join(application,file));
  await copyTree(path.join(sourceRoot,'assets'),path.join(application,'assets'));
  await fs.copyFile(path.join(sourceRoot,'README.md'),path.join(directory,'使用说明.md'));
  try{await fs.copyFile(path.join(sourceRoot,'COPYRIGHT.txt'),path.join(directory,'APP-COPYRIGHT.txt'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const launcher='@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\nstart "" "%~dp0YixuDetailStudio.exe"\r\n';
  await fs.writeFile(path.join(directory,'启动衣序.cmd'),launcher,'utf8');
  const manifest={schemaVersion:1,product:'衣序 · 详情页工作室',version:metadata.version,platform:'win32-x64',electron:(await fs.readFile(path.join(runtimeRoot,'version'),'utf8')).trim(),builtAt:new Date().toISOString(),containsUserData:false,files:await listFiles(directory)};
  await fs.writeFile(path.join(directory,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return {directory,name,manifest};
}
if(require.main===module){
  const args=process.argv.slice(2),option=name=>{const index=args.indexOf(name);return index>=0?args[index+1]:undefined;};
  buildPortable({sourceRoot:option('--source-root'),runtimeRoot:option('--runtime-root'),outputRoot:option('--output-root')})
    .then(result=>console.log(JSON.stringify({directory:result.directory,version:result.manifest.version,files:result.manifest.files.length,totalBytes:result.manifest.files.reduce((sum,file)=>sum+file.bytes,0)},null,2)))
    .catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports={buildPortable,APP_FILES,listFiles};

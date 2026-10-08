'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {buildPortable,APP_FILES}=require('../../scripts/build-portable.cjs');

async function fixture(t){
  const base=process.env.YIXU_TEST_ROOT || (process.platform==='win32'?'E:\\Codex工作盘\\temp\\taobao-detail-studio\\public-package-tests':path.join(os.tmpdir(),'yixu-package-tests'));
  await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'case-'));
  const source=path.join(root,'source'),runtime=path.join(root,'runtime'),output=path.join(root,'output');
  await fs.mkdir(source,{recursive:true});await fs.mkdir(runtime,{recursive:true});
  for(const name of APP_FILES){const target=path.join(source,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,name==='package.json'?JSON.stringify({name:'taobao-detail-studio',version:'0.1.7-preview',main:'desktop/main.cjs'}):name==='desktop/package.json'?JSON.stringify({version:'0.1.7-preview'}):'public application file');}
  await fs.mkdir(path.join(source,'assets'),{recursive:true});await fs.writeFile(path.join(source,'assets','safe.png'),'public placeholder');
  await fs.mkdir(path.join(source,'data','api'),{recursive:true});await fs.writeFile(path.join(source,'data','api','config.json'),'PRIVATE_CONFIG_SENTINEL');
  await fs.writeFile(path.join(source,'.env'),'SECRET_SENTINEL');await fs.mkdir(path.join(source,'design-sources'),{recursive:true});await fs.writeFile(path.join(source,'design-sources','private.png'),'PRIVATE_IMAGE_SENTINEL');
  await fs.writeFile(path.join(source,'README.md'),'public instructions');
  await fs.writeFile(path.join(runtime,'electron.exe'),'runtime fixture');await fs.writeFile(path.join(runtime,'LICENSE'),'runtime license');await fs.writeFile(path.join(runtime,'version'),'44.7.0');
  t.after(async()=>{if(!path.resolve(root).startsWith(path.resolve(base)+path.sep))throw new Error('拒绝清理测试根之外的路径');await fs.rm(root,{recursive:true,force:true});});return {root,source,runtime,output};
}
test('便携构建只复制运行白名单，保留运行时许可和正确入口，私有数据不进入软件包',async t=>{
  const f=await fixture(t),result=await buildPortable({sourceRoot:f.source,runtimeRoot:f.runtime,outputRoot:f.output});
  assert.equal(await fs.readFile(path.join(result.directory,'YixuDetailStudio.exe'),'utf8'),'runtime fixture');
  const metadata=JSON.parse(await fs.readFile(path.join(result.directory,'resources','app','package.json'),'utf8'));assert.equal(metadata.main,'desktop/main.cjs');
  for(const denied of ['data/api/config.json','.env','design-sources/private.png'])await assert.rejects(fs.access(path.join(result.directory,'resources','app',denied)));
  assert.equal(await fs.readFile(path.join(result.directory,'LICENSE'),'utf8'),'runtime license');
  assert.ok(result.manifest.files.some(file=>file.path==='resources/app/assets/safe.png'));
  assert.ok(result.manifest.files.every(file=>/^[a-f0-9]{64}$/.test(file.sha256)));
});
test('构建拒绝覆盖源码或已有发布目录，保护已有文件',async t=>{
  const f=await fixture(t);
  await assert.rejects(buildPortable({sourceRoot:f.source,runtimeRoot:f.runtime,outputRoot:f.source}),/输出/);
  const first=await buildPortable({sourceRoot:f.source,runtimeRoot:f.runtime,outputRoot:f.output});
  await assert.rejects(buildPortable({sourceRoot:f.source,runtimeRoot:f.runtime,outputRoot:f.output}),/已存在/);
  assert.equal(await fs.readFile(path.join(first.directory,'YixuDetailStudio.exe'),'utf8'),'runtime fixture');
});
test('发布资源中的目录链接不能带入用户私有数据',async t=>{
  const f=await fixture(t);await fs.symlink(path.join(f.source,'data'),path.join(f.source,'assets','private-link'),'junction');
  await assert.rejects(buildPortable({sourceRoot:f.source,runtimeRoot:f.runtime,outputRoot:f.output}),/符号链接/);
});

const multipleModes=new Set(['models','details','batch','picker']);
/** The OS-provided File.type and extension may not match dragged image bytes. */
export function sniffImageMime(input){
  const bytes=input instanceof ArrayBuffer?new Uint8Array(input):ArrayBuffer.isView(input)?new Uint8Array(input.buffer,input.byteOffset,input.byteLength):null;
  if(!bytes)return null;
  const matches=(signature,offset=0)=>bytes.length>=offset+signature.length&&signature.every((value,index)=>bytes[offset+index]===value);
  if(matches([0xff,0xd8,0xff]))return 'image/jpeg';
  if(matches([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))return 'image/png';
  if(matches([0x52,0x49,0x46,0x46])&&matches([0x57,0x45,0x42,0x50],8))return 'image/webp';
  if(matches([0x47,0x49,0x46,0x38,0x37,0x61])||matches([0x47,0x49,0x46,0x38,0x39,0x61]))return 'image/gif';
  return null;
}
export function hasExternalFiles(transfer){return !!transfer&&(Array.from(transfer.types||[]).includes('Files')||Array.from(transfer.items||[]).some(item=>item.kind==='file')||transfer.files?.length>0);}
export function filesFromDrop(transfer){return hasExternalFiles(transfer)?Array.from(transfer.files||[]):[];}
export function validateUploadFiles(input,mode){
  const files=Array.from(input||[]);
  if(!files.length)throw new Error('没有可上传的图片文件，请从文件夹拖入图片');
  if(!multipleModes.has(mode)&&files.length!==1)throw new Error('此位置一次只能上传一张图片；多张图片请拖入批量上传区域');
  if(files.length>100)throw new Error('单批最多上传100张图片，请分批添加');
  if(files.some(file=>!String(file.type||'').startsWith('image/')&&!(/\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(file.name||''))))throw new Error('只支持可读取的图片文件，请移除其他类型文件');
  return files;
}
export function dropTarget(target){const element=target?.closest?.('[data-drop-mode]');return element?{mode:element.dataset.dropMode,target:element.dataset.dropTarget||null,element}:null;}

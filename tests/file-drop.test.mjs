import test from 'node:test';
import assert from 'node:assert/strict';
import { hasExternalFiles, filesFromDrop, validateUploadFiles, dropTarget, sniffImageMime } from '../file-drop.mjs';

const image = name => new File([new Uint8Array([137,80,78,71])], name, { type: 'image/png' });

test('external Files drag is recognized before files are readable, while internal sorting stays separate', () => {
  assert.equal(hasExternalFiles({ types: ['Files'], files: [] }), true);
  assert.equal(hasExternalFiles({ types: ['text/plain'], files: [] }), false);
  const first=image('first.png'),second=image('second.png');
  const files=filesFromDrop({types:['Files'],files:[first,second]});
  assert.equal(files[0],first);assert.equal(files[1],second);
  assert.deepEqual(filesFromDrop({types:['text/plain'],files:[]}),[]);
});

test('batch/model/detail/picker upload validation retains every actual File in order', () => {
  const files=[image('a.png'),image('b.png')];
  for(const mode of ['batch','models','details','picker'])assert.deepEqual(validateUploadFiles(files,mode),files);
});

test('single-image targets and mixed invalid drops reject without silently discarding files', () => {
  for(const mode of ['cover','replace','size'])assert.throws(()=>validateUploadFiles([image('a.png'),image('b.png')],mode));
  const invalid=new File(['unrelated document'],'notes.txt',{type:'text/plain'});
  assert.throws(()=>validateUploadFiles([image('a.png'),invalid],'batch'));
});

test('drop targeting resolves the closest declared upload zone and keeps its object identity', () => {
  const zone={dataset:{dropMode:'replace',dropTarget:'photo-1'}};
  const target={closest:selector=>selector==='[data-drop-mode]'?zone:null};
  const result=dropTarget(target);
  assert.equal(result.mode,'replace');assert.equal(result.target,'photo-1');assert.equal(result.element,zone);
  assert.equal(dropTarget({closest:()=>null}),null);
});

test('image MIME sniffing identifies standard JPEG, PNG, WebP and both GIF headers from bytes', () => {
  const fixtures=[
    [[0xff,0xd8,0xff,0xe0,0,0x10],'image/jpeg'],
    [[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a],'image/png'],
    [[0x52,0x49,0x46,0x46,0x24,0,0,0,0x57,0x45,0x42,0x50],'image/webp'],
    [[0x47,0x49,0x46,0x38,0x37,0x61],'image/gif'],
    [[0x47,0x49,0x46,0x38,0x39,0x61],'image/gif'],
  ];
  for(const [header,mime] of fixtures){
    const bytes=new Uint8Array(header);
    assert.equal(sniffImageMime(bytes),mime);
    assert.equal(sniffImageMime(bytes.buffer),mime);
    assert.equal(sniffImageMime(Buffer.from(header)),mime);
  }
});

test('JPEG bytes mislabeled as PNG are detected as JPEG independently of File.type and extension', async () => {
  const mislabeled=new File([new Uint8Array([0xff,0xd8,0xff,0xe1,0,0x16,0xff,0xd9])],'copied-image.png',{type:'image/png'});
  assert.equal(mislabeled.type,'image/png');
  assert.equal(sniffImageMime(await mislabeled.arrayBuffer()),'image/jpeg');
  const unknownMime=new File([new Uint8Array([0xff,0xd8,0xff,0xe0,0xff,0xd9])],'camera-photo.jpg',{type:'application/octet-stream'});
  assert.deepEqual(validateUploadFiles([unknownMime],'batch'),[unknownMime]);
  assert.equal(sniffImageMime(await unknownMime.arrayBuffer()),'image/jpeg');
});

test('sniffing honors typed-array view offsets and does not inspect bytes outside the view', () => {
  const storage=new Uint8Array([0,0,0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0]);
  assert.equal(sniffImageMime(storage.subarray(2,10)),'image/png');
  assert.equal(sniffImageMime(new DataView(storage.buffer,2,8)),'image/png');
  assert.equal(sniffImageMime(storage.subarray(2,6)),null);
  assert.equal(sniffImageMime(storage),null);
});

test('unknown, truncated and other RIFF formats return null for frontend decoding and normalization', () => {
  for(const bytes of [[],[0xff],[0xff,0xd8],[0x89,0x50,0x4e,0x47],[0x42,0x4d],
    [0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x41,0x56,0x45],
    [0x47,0x49,0x46,0x38,0x39,0x62],Array.from(new TextEncoder().encode('<svg></svg>'))]){
    assert.equal(sniffImageMime(new Uint8Array(bytes)),null);
  }
  assert.equal(sniffImageMime(null),null);
  assert.equal(sniffImageMime(undefined),null);
  assert.equal(sniffImageMime('image/png'),null);
});

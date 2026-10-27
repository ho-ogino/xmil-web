'use strict';
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./pcg.js'));
  else root.X1FontBuilder=factory(root.X1Pcg);
})(typeof globalThis!=='undefined'?globalThis:this,function(pcg){
const alloc=(length,value=0)=>new Uint8Array(length).fill(value);
const view=bytes=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
const ascii=text=>Uint8Array.from(text,c=>c.charCodeAt(0));
const write16=(bytes,at,value)=>view(bytes).setUint16(at,value);
const write32=(bytes,at,value)=>view(bytes).setUint32(at,value);
// 256 characters, 8 scanlines per character, MSB is the leftmost pixel.
function parseFontRom(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 2048) throw Error('8x8 ANKフォントは2048バイト（8バイト×256文字）のファイルを指定してください。');
  return Array.from({length:256}, (_,code) => Array.from(bytes.subarray(code*8,code*8+8)));
}
function buildFont(bitmap,pcgEntries=[],order='BRG',layout='planar') {
if (!Array.isArray(bitmap) || bitmap.length !== 256 || bitmap.some(g => !Array.isArray(g) || g.length !== 8 || g.some(n => !Number.isInteger(n) || n < 0 || n > 255))) throw Error('Invalid 256 x 8 font');
const u16 = n => { const b = alloc(2); write16(b,0,n & 65535); return b; };
const i16 = n => { const b = alloc(2); view(b).setInt16(0,n); return b; };
const u32 = n => { const b = alloc(4); write32(b,0,n >>> 0); return b; };
const cat = list => { const result=alloc(list.reduce((n,b)=>n+b.length,0)); let at=0; for(const b of list){result.set(b,at);at+=b.length;} return result; };
const pad = b => cat([b, alloc((4 - b.length % 4) % 4)]);
function checksum(b) { const p = pad(b); let n = 0; for (let i = 0; i < p.length; i += 4) n = (n + view(p).getUint32(i)) >>> 0; return n; }
function outline(rows) {
  const points = [], ends = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < 8; x++) if (row & (128 >> x)) {
      const left = x * 128, bottom = (7 - y) * 128;
      points.push([left,bottom], [left,bottom+128], [left+128,bottom+128], [left+128,bottom]);
      ends.push(points.length - 1);
    }
  });
  if (!ends.length) return alloc(0);
  let px = 0, py = 0;
  const xs = points.map(p => { const delta = p[0] - px; px = p[0]; return i16(delta); });
  const ys = points.map(p => { const delta = p[1] - py; py = p[1]; return i16(delta); });
  return pad(cat([i16(ends.length), i16(0), i16(0), i16(1024), i16(1024),
    ...ends.map(u16), u16(0), alloc(points.length, 1), ...xs, ...ys]));
}
const glyphs = [alloc(0), ...bitmap.map(outline)];
const colorBases=[],colorLayers=[],seenCodes=new Set();
if(!Array.isArray(pcgEntries)||pcgEntries.length>256)throw Error('PCG定義は256文字までです。');
for(const entry of [...pcgEntries].sort((a,b)=>a.code-b.code)) {
  if(!pcg)throw Error('Load pcg.js before building a PCG font.');
  if(!Number.isInteger(entry.code)||entry.code<0||entry.code>255||seenCodes.has(entry.code))throw Error('PCGの文字コードが不正または重複しています。');
  seenCodes.add(entry.code);
  const colors=pcg.pixels(entry.hex,order,layout),baseRows=Array(8).fill(0),firstLayer=colorLayers.length;
  for(let color=1;color<=7;color++){
    const rows=colors.map(row=>row.reduce((bits,pixel,x)=>bits|(pixel===color?0x80>>x:0),0));
    if(!rows.some(Boolean))continue;
    rows.forEach((bits,y)=>baseRows[y]|=bits);
    colorLayers.push({glyph:glyphs.length,color});glyphs.push(outline(rows));
  }
  glyphs[entry.code+1]=outline(baseRows);
  if(colorLayers.length>firstLayer)colorBases.push({glyph:entry.code+1,first:firstLayer,count:colorLayers.length-firstLayer});
}
let offset = 0;
const locations = glyphs.map(g => { const at = offset; offset += g.length; return u32(at); }); locations.push(u32(offset));
const head = cat([u32(0x00010000), u32(0x00010000), u32(0), u32(0x5f0f3cf5), u16(3), u16(1024),
  alloc(16), i16(0), i16(0), i16(1024), i16(1024), u16(0), u16(8), i16(2), i16(1), i16(0)]);
const hhea = cat([u32(0x00010000), i16(1024), i16(0), i16(0), u16(1024), i16(0), i16(0), i16(1024),
  i16(1), i16(0), i16(0), alloc(8), i16(0), u16(glyphs.length)]);
const maxp = cat([u32(0x00010000), ...[glyphs.length,256,64,0,0,1,0,0,0,0,0,0,0,0].map(u16)]);
const cmapSub = cat([u16(4),u16(40),u16(0),u16(6),u16(4),u16(1),u16(2),
  u16(0x7e),u16(0xe0ff),u16(0xffff),u16(0),u16(0x20),u16(0xe000),u16(0xffff),
  u16(1),u16((1-0xe000)&65535),u16(1),u16(0),u16(0),u16(0)]);
const cmap = cat([u16(0),u16(1),u16(3),u16(1),u32(12),cmapSub]);
const nameStrings = ['X1 BASIC Editor','Regular','X1BasicEditor-0.1','X1 BASIC Editor','Version 0.1','X1BasicEditor'];
let nameOffset = 0;
const nameBuffers = nameStrings.map(s => Uint8Array.from(s.split('').flatMap(c => [0,c.charCodeAt(0)])));
const nameRecords = nameBuffers.map((b, i) => { const rec = cat([u16(3),u16(1),u16(0x409),u16([1,2,3,4,5,6][i]),u16(b.length),u16(nameOffset)]); nameOffset += b.length; return rec; });
const name = cat([u16(0),u16(6),u16(78),...nameRecords,...nameBuffers]);
const os2 = alloc(78); write16(os2,2,1024); write16(os2,4,400); write16(os2,6,5);
write32(os2,42,1); // Basic Latin.
write32(os2,46,1 << 28); // Unicode private use area (bit 60).
os2.set(ascii('X1BE'),58); write16(os2,62,0x40); write16(os2,64,0x20); write16(os2,66,0xe0ff);
write16(os2,68,1024); write16(os2,74,1024);
const post = alloc(32); write32(post,0,0x00030000); write32(post,12,1);
const tables = { 'OS/2':os2, cmap, glyf:cat(glyphs), head, hhea, hmtx:cat(glyphs.map(() => cat([u16(1024),i16(0)]))),
  loca:cat(locations), maxp, name, post };
if(colorBases.length){
  tables.COLR=cat([u16(0),u16(colorBases.length),u32(14),u32(14+6*colorBases.length),u16(colorLayers.length),
    ...colorBases.map(base=>cat([u16(base.glyph),u16(base.first),u16(base.count)])),
    ...colorLayers.map(layer=>cat([u16(layer.glyph),u16(layer.color)]))]);
  const colors=Array.from({length:8},(_,color)=>Uint8Array.from([color&1?255:0,color&4?255:0,color&2?255:0,255]));
  tables.CPAL=cat([u16(0),u16(8),u16(1),u16(8),u32(14),u16(0),...colors]);
}
const tags = Object.keys(tables).sort(), count = tags.length;
const power = 2 ** Math.floor(Math.log2(count));
const header = cat([u32(0x00010000),u16(count),u16(power*16),u16(Math.log2(power)),u16(count*16-power*16)]);
let tableOffset = 12 + count * 16, headOffset;
const records = [], bodies = [];
for (const tag of tags) {
  const b = tables[tag]; if (tag === 'head') headOffset = tableOffset;
  records.push(cat([ascii(tag),u32(checksum(b)),u32(tableOffset),u32(b.length)]));
  bodies.push(pad(b)); tableOffset += pad(b).length;
}
const font = cat([header,...records,...bodies]);
write32(font,headOffset + 8,(0xb1b0afba - checksum(font)) >>> 0);
return font;
}
function buildFontFromRom(bytes) { return buildFont(parseFontRom(bytes)); }
return {parseFontRom,buildFont,buildFontFromRom};
});

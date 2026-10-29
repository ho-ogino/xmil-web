(function (root,factory) {
  if (typeof module === 'object' && module.exports) module.exports=factory(require('./syntax.js'));
  else root.X1Pcg=factory(root.X1Syntax);
})(typeof globalThis!=='undefined'?globalThis:this,function (syntax) {
  'use strict';
  const ORDERS=['BRG','BGR','RGB','RBG','GBR','GRB'];
  const PALETTE=['#000000','#0000ff','#ff0000','#ff00ff','#00ff00','#00ffff','#ffff00','#ffffff'];
  const number='[+-]?(?:&H[0-9a-f]+|&O[0-7]+|&B[01]+|[0-9]+)%?';
  const literal=new RegExp('^DEFCHR\\$\\s*\\(\\s*(?<code>'+number+')\\s*\\)\\s*=\\s*(?:HEXCHR\\$\\s*\\(\\s*"(?<hex>[0-9a-f \t]+)"\\s*\\)|STRING\\$\\s*\\(\\s*24\\s*,\\s*(?<fill>'+number+')\\s*\\))(?=\\s*(?::|\'|REM\\b|$))','i');
  function parseCode(text) {
    const input=String(text).trim();
    if (!new RegExp('^'+number+'$','i').test(input)) throw Error('文字コードは0〜255の整数で指定してください。');
    const value=input.replace(/%$/,'');
    const sign=value[0]==='-'?-1:1,body=value.replace(/^[+-]/,'');
    const base=/^&H/i.test(body)?16:/^&O/i.test(body)?8:/^&B/i.test(body)?2:10;
    const code=sign*parseInt(base===10?body:body.slice(2),base);
    if (!Number.isInteger(code)||code<0||code>255) throw Error('文字コードは0〜255の範囲で指定してください。');
    return code;
  }
  function validateHex(hex) {
    if(typeof hex!=='string'||!/^[0-9a-f]{48}$/i.test(hex))throw Error('PCGは48桁の16進数（24バイト）で指定してください。');
    return hex.toUpperCase();
  }
  function sourceHex(text) { return validateHex(text.replace(/[ \t]/g,'')); }
  function pixels(hex,order='BRG',layout='planar') {
    validateHex(hex);
    if(!ORDERS.includes(order)||!['planar','interleaved'].includes(layout))throw Error('PCGの色順または配列形式が不正です。');
    const bytes=Array.from({length:24},(_,i)=>parseInt(hex.slice(i*2,i*2+2),16));
    return Array.from({length:8},(_,y)=>Array.from({length:8},(_,x)=>{
      let color=0;
      for(let p=0;p<3;p++)if(bytes[layout==='planar'?p*8+y:y*3+p]&(0x80>>x))color|={B:1,R:2,G:4}[order[p]];
      return color;
    }));
  }
  function svg(hex,order='BRG',layout='planar') {
    let result='<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8" shape-rendering="crispEdges"><path fill="#000000" d="M0 0h8v8H0z"/>';
    pixels(hex,order,layout).forEach((row,y)=>row.forEach((color,x)=>{if(color)result+='<rect x="'+x+'" y="'+y+'" width="1" height="1" fill="'+PALETTE[color]+'"/>';}));
    return result+'</svg>';
  }
  function scan(text) {
    const definitions=[],raw=[],warnings=[];let offset=0;
    for(const [index,line] of text.replace(/\r\n|\r/g,'\n').split('\n').entries()) {
      let at=0;const spans=syntax.highlightLine(line).map(token=>{const span={start:at,end:at+token.text.length,kind:token.kind};at=span.end;return span;});
      const kind=pos=>spans.find(span=>pos>=span.start&&pos<span.end)?.kind;
      const consumed=[];
      for(const match of line.matchAll(/DEFCHR\$\s*\(/gi)) {
        if(kind(match.index)!=='keyword')continue;
        const found=line.slice(match.index).match(literal);
        if(found) {
          consumed.push([match.index,match.index+found[0].length]);
          try {
            const code=parseCode(found.groups.code);
            const hex=found.groups.hex?sourceHex(found.groups.hex):parseCode(found.groups.fill).toString(16).padStart(2,'0').repeat(24).toUpperCase();
            definitions.push({code,hex,line:index+1,offset:offset+match.index});
          }catch(err){warnings.push('選択内'+(index+1)+'行：'+err.message);}
        }else{
          let end=match.index,quote=false;
          for(;end<line.length;end++){if(line[end]==='"')quote=!quote;else if(!quote&&line[end]===':')break;}
          consumed.push([match.index,end]);warnings.push('選択内'+(index+1)+'行：定数のDEFCHR$ / HEXCHR$ または STRING$(24,n) として読み取れませんでした。');
        }
      }
      const rawStart=raw.length;
      for(const match of line.matchAll(/[0-9a-f]{48}/gi)) {
        const start=match.index,end=start+48;
        if(/[0-9a-f]/i.test(line[start-1]||'')||/[0-9a-f]/i.test(line[end]||''))continue;
        if(kind(start)==='comment'||consumed.some(([a,b])=>start>=a&&start<b))continue;
        raw.push({hex:validateHex(match[0]),line:index+1,offset:offset+start});
      }
      // Keep existing contiguous records independent; only join horizontal gaps
      // in the remaining source, without swallowing BASIC keywords or comments.
      const search=line.split('');
      const blocked=[...consumed,
        ...spans.filter(span=>span.kind==='comment'||span.kind==='keyword'&&!/^[0-9a-f \t]+$/i.test(line.slice(span.start,span.end))).map(span=>[span.start,span.end]),
        ...raw.slice(rawStart).map(entry=>[entry.offset-offset,entry.offset-offset+48])];
      for(const [start,end] of blocked)search.fill('|',start,end);
      for(const match of search.join('').matchAll(/[0-9a-f]+(?:[ \t]+[0-9a-f]+)*/gi)) {
        if(!/[ \t]/.test(match[0]))continue;
        const hex=match[0].replace(/[ \t]/g,'');
        if(hex.length===48)raw.push({hex:validateHex(hex),line:index+1,offset:offset+match.index});
      }
      offset+=line.length+1;
    }
    raw.sort((a,b)=>a.offset-b.offset);
    return {definitions,raw,warnings};
  }
  function assignments(scanResult,startCode=0) {
    const start=parseCode(startCode);
    if(start+scanResult.raw.length>256)throw Error('割り当てが文字コード255を超えます。開始コードを小さくしてください。');
    return [...scanResult.definitions,...scanResult.raw.map((entry,i)=>({...entry,code:start+i}))].sort((a,b)=>a.offset-b.offset);
  }
  return {ORDERS,PALETTE,parseCode,validateHex,pixels,svg,scan,assignments};
});

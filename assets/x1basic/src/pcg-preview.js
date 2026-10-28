(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./codec.js'),require('./pcg.js'));
  else root.X1PcgPreview=factory(root.X1,root.X1Pcg);
})(typeof globalThis!=='undefined'?globalThis:this,function(X1,pcg){
  'use strict';
  const MAX_BYTES=4096,MAX_EXTENT=64,DELAY=600;
  // Call only for syntax string tokens; comments must not become hover targets.
  function quoteRanges(text){
    return Array.from(text.matchAll(/"[^"]*"/g),match=>({start:match.index,end:match.index+match[0].length}));
  }
  function compose(bytes){
    const cells=new Map(),ignored=new Set();
    let x=0,y=0,minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,truncated=bytes.length>MAX_BYTES;
    for(let at=0;at<Math.min(bytes.length,MAX_BYTES);at++){
      const code=bytes[at];
      if(code===0x1c){x++;continue;}if(code===0x1d){x--;continue;}
      if(code===0x1e){y--;continue;}if(code===0x1f){y++;continue;}
      if(code<0x20){ignored.add(code);continue;}
      const left=Math.min(minX,x),top=Math.min(minY,y),right=Math.max(maxX,x),bottom=Math.max(maxY,y);
      if(right-left+1>MAX_EXTENT || bottom-top+1>MAX_EXTENT){truncated=true;break;}
      minX=left;minY=top;maxX=right;maxY=bottom;
      cells.set(x+','+y,{x,y,code});x++;
    }
    const columns=cells.size?maxX-minX+1:0,rows=cells.size?maxY-minY+1:0;
    return {cells:Array.from(cells.values(),cell=>({...cell,x:cell.x-minX,y:cell.y-minY})),
      columns,rows,width:columns*8,height:rows*8,ignored:[...ignored].sort((a,b)=>a-b),truncated};
  }
  function lowerBound(list,after){
    let low=0,high=list.length;
    while(low<high){const mid=(low+high)>>>1;if(after(list[mid]))high=mid;else low=mid+1;}
    return low;
  }
  const contains=(rect,point)=>point.x>=rect.left&&point.x<rect.right&&point.y>=rect.top&&point.y<rect.bottom;
  const endsAfter=(rect,point)=>Boolean(rect&&(point.y<rect.top || point.y<rect.bottom&&point.x<rect.right));
  function hitTest(lines,viewport,point){
    if(!contains(viewport,point))return null;
    const index=lowerBound(lines,line=>line.element.getBoundingClientRect().bottom>point.y),line=lines[index];
    if(!line || line.element.getBoundingClientRect().top>point.y)return null;
    const literals=line.literals||[],cache=new Map();
    const rects=literal=>{
      if(!cache.has(literal))cache.set(literal,Array.from(literal.element.getClientRects()));
      return cache.get(literal);
    };
    const at=lowerBound(literals,literal=>endsAfter(rects(literal).at(-1),point)),literal=literals[at];
    if(!literal)return null;
    const fragments=rects(literal),fragment=fragments[lowerBound(fragments,rect=>endsAfter(rect,point))];
    return fragment&&contains(fragment,point)?literal:null;
  }
  function attach(options){
    const {editor,panel,canvas,summary,warning}=options,document=editor.ownerDocument,win=document.defaultView;
    let timer=null,generation=0,visibleTarget=null;
    const listeners=[];
    function listen(target,name,callback,capture=false){target.addEventListener(name,callback,capture);listeners.push(()=>target.removeEventListener(name,callback,capture));}
    function describe(show){
      const ids=new Set((editor.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean));
      if(show)ids.add(panel.id);else ids.delete(panel.id);
      if(ids.size)editor.setAttribute('aria-describedby',[...ids].join(' '));else editor.removeAttribute('aria-describedby');
    }
    function hide(){
      generation++;if(timer!==null)win.clearTimeout(timer);timer=null;visibleTarget=null;panel.hidden=true;describe(false);
    }
    const locate=point=>hitTest(options.getLines(),editor.getBoundingClientRect(),point);
    async function show(point,revision){
      if(revision!==generation || !options.isEnabled())return;
      const target=locate(point);if(!target)return;
      const bytes=options.getBytes().subarray(target.byteStart,target.byteEnd),image=compose(bytes),state=options.getState();
      const entries=new Map(state.entries);
      if(!image.cells.length)return;
      try{
        const ctx=canvas.getContext('2d');if(!ctx)return;
        const family=state.font||'X1';
        if(document.fonts?.load)await document.fonts.load('8px '+family);else await document.fonts?.ready;
        if(revision!==generation || !options.isEnabled() || locate(point)!==target)return;
        canvas.width=image.width;canvas.height=image.height;
        ctx.imageSmoothingEnabled=false;ctx.fillStyle='#000000';ctx.fillRect(0,0,image.width,image.height);
        ctx.font='8px '+family;ctx.textBaseline='alphabetic';
        const tiles=new Map();
        for(const cell of image.cells){
          const x=cell.x*8,y=cell.y*8;
          if(entries.has(cell.code)){
            if(!tiles.has(cell.code))tiles.set(cell.code,pcg.pixels(entries.get(cell.code),state.order,state.layout));
            tiles.get(cell.code).forEach((row,dy)=>row.forEach((color,dx)=>{if(color){ctx.fillStyle=pcg.PALETTE[color];ctx.fillRect(x+dx,y+dy,1,1);}}));
          }else{ctx.fillStyle='#FFFFFF';ctx.fillText(X1.glyph(cell.code),x,y+8);}
        }
        summary.textContent=image.width+'×'+image.height+' ドット（'+image.columns+'×'+image.rows+'文字）';
        const notes=[];
        if(image.ignored.length)notes.push('未対応制御を省略: '+image.ignored.slice(0,8).map(code=>'$'+X1.hex(code)).join(', ')+(image.ignored.length>8?' ほか'+(image.ignored.length-8)+'種':''));
        if(image.truncated)notes.push('上限（4096バイト・64×64文字）以降は省略');
        warning.textContent=notes.join(' / ');warning.hidden=!notes.length;
        const scale=Math.min(4,Math.max(1,Math.min(456,win.innerWidth-40))/image.width,Math.max(1,win.innerHeight-140)/image.height);
        const displayed=Math.max(1,Math.floor(image.width*scale));
        canvas.style.width=displayed+'px';
        panel.style.width=Math.max(1,Math.min(win.innerWidth-16,Math.max(200,displayed+24)))+'px';
        panel.hidden=false;visibleTarget=target;describe(true);
        const rect=panel.getBoundingClientRect();
        panel.style.left=Math.max(8,Math.min(point.x+12,win.innerWidth-rect.width-8))+'px';
        const top=point.y+18+rect.height<=win.innerHeight-8?point.y+18:point.y-rect.height-12;
        panel.style.top=Math.max(8,Math.min(top,win.innerHeight-rect.height-8))+'px';
      }catch{if(revision===generation)hide();}
    }
    function move(event){
      if(event.buttons || !options.isEnabled()){hide();return;}
      const point={x:event.clientX,y:event.clientY};
      if(!panel.hidden && locate(point)===visibleTarget)return;
      hide();const revision=generation;
      timer=win.setTimeout(()=>{timer=null;show(point,revision);},DELAY);
    }
    listen(editor,'mousemove',move);
    for(const name of ['mouseleave','mousedown','scroll','input','compositionstart','blur'])listen(editor,name,hide);
    listen(document,'pointerdown',hide,true);listen(document,'keydown',hide,true);listen(document,'visibilitychange',hide);
    listen(win,'resize',hide);listen(win,'blur',hide);
    hide();
    return {hide,destroy(){hide();listeners.forEach(remove=>remove());}};
  }
  return {quoteRanges,compose,hitTest,attach,MAX_BYTES,MAX_EXTENT,DELAY};
});

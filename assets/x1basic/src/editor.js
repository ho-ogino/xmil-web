'use strict';
(() => {
  const host = window.X1Host;
  const $ = id => document.getElementById(id);
  const editor = $('editor'), mirror = $('mirror'), doc = new X1.ByteDocument();
  let selectionBefore = [0,0], pendingInputType = '', busy = false, composing = false, group = 'symbols';
  let noticeTimer, hoverCode = 0x87;
  let renderedLines = [];
  let lastContent = null;
  function contentChanged(){
    if(lastContent!==null && X1.equal(lastContent,doc.bytes))return;
    lastContent=doc.bytes;
    if(!host?.contentChanged)return;
    const failed=err=>notify('変更通知に失敗しました。\n'+String(err?.message??err),true);
    try{Promise.resolve(host.contentChanged({bytes:doc.bytes.slice(),dirty:doc.dirty})).catch(failed);}
    catch(err){failed(err);}
  }
  const mirrorSelection=typeof window.Highlight==='function'&&Boolean(window.CSS?.highlights);
  $('text-area').classList.toggle('mirror-selection',mirrorSelection);
  let activeFontFace = null, fontSequence = 0, fontRevision = 0;
  const pcgEntries=new Map();
  let pcgFontFace=null,pcgRevision=0,pcgSelected=0,pcgImport=null;
  const selection = () => [editor.selectionStart, editor.selectionEnd];
  const notify = (text, error = false) => {
    clearTimeout(noticeTimer); $('notice').textContent = text; $('notice').classList.toggle('error',error); $('notice').hidden = false;
    noticeTimer = setTimeout(() => { $('notice').hidden = true; }, error ? 9000 : 3500);
  };
  async function prepareFont(info) {
    if (!info.data) return null;
    const face = new FontFace('X1Custom' + (++fontSequence),Uint8Array.from(info.data));
    await face.load();
    return face;
  }
  function activateFont(info,face) {
    if (face) document.fonts.add(face);
    if (activeFontFace) document.fonts.delete(activeFontFace);
    activeFontFace = face;
    $('font-name').textContent = info.name; $('font-name').title = info.name;
    document.querySelector('[data-command="font-reset"]').disabled = !face;
    if(pcgFontFace){document.fonts.delete(pcgFontFace);pcgFontFace=null;}
    displayFont();
    if($('pcg-enabled').checked&&pcgEntries.size)refreshPcgFont();
  }
  function displayFont(){
    const face=$('pcg-enabled').checked&&pcgEntries.size&&pcgFontFace?pcgFontFace:activeFontFace;
    document.documentElement.style.setProperty('--x1-font',face?face.family:'X1');
    document.documentElement.style.setProperty('--x1-base-font',activeFontFace?activeFontFace.family:'X1');
    $('text-area').classList.toggle('pcg-strings-only',$('pcg-strings-only').checked);
    updateLayout();
  }
  async function refreshPcgFont(){
    const revision=++pcgRevision;
    if(!$('pcg-enabled').checked||!pcgEntries.size){
      if(pcgFontFace){document.fonts.delete(pcgFontFace);pcgFontFace=null;}displayFont();return true;
    }
    try{
      const data=await host.pcgFont({entries:[...pcgEntries].map(([code,hex])=>({code,hex})),order:$('pcg-order').value,layout:$('pcg-layout').value});
      if(revision!==pcgRevision)return;
      const face=await prepareFont({data});if(revision!==pcgRevision)return;
      document.fonts.add(face);if(pcgFontFace)document.fonts.delete(pcgFontFace);pcgFontFace=face;displayFont();return true;
    }catch(err){
      if(revision!==pcgRevision)return;
      if(pcgFontFace){document.fonts.delete(pcgFontFace);pcgFontFace=null;}
      $('pcg-enabled').checked=false;displayFont();notify('PCG表示に切り替えられませんでした。定義は一覧で確認できます。\n'+err.message,true);return false;
    }
  }
  function sidebar(name){
    $('ank-panel').hidden=name!=='ank';$('pcg-panel').hidden=name!=='pcg';$('sidebar').classList.toggle('pcg-open',name==='pcg');
    document.querySelectorAll('[data-sidebar]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.sidebar===name)));
    sidebarResize.refresh();
  }
  const pcgImage=hex=>'data:image/svg+xml,'+encodeURIComponent(X1Pcg.svg(hex,$('pcg-order').value,$('pcg-layout').value));
  function pcgDetail(code){
    pcgSelected=code;const hex=pcgEntries.get(code);
    $('pcg-code').textContent='$'+X1.hex(code)+' / '+code;$('pcg-definition-state').textContent=hex?'PCG定義あり':'未定義';
    $('pcg-preview').hidden=!hex;if(hex)$('pcg-preview').src=pcgImage(hex);else $('pcg-preview').removeAttribute('src');
    $('pcg-hex').value=hex||'';$('pcg-remove').disabled=!hex;
    $('pcg-grid').querySelectorAll('button').forEach(button=>button.classList.toggle('selected',Number(button.dataset.pcgCode)===code));
  }
  function renderPcgGrid(){
    const fragment=document.createDocumentFragment();
    for(let code=0;code<256;code++){
      const button=document.createElement('button'),hex=pcgEntries.get(code);button.type='button';button.dataset.pcgCode=String(code);
      button.title='$'+X1.hex(code)+' / '+code+'：'+(hex?'クリックして挿入':'未定義');button.setAttribute('aria-label',button.title);
      button.className=hex?'defined':'';
      if(hex){const img=document.createElement('img');img.alt='';img.src=pcgImage(hex);button.append(img);}else button.textContent='·';
      button.addEventListener('mousedown',event=>event.preventDefault());
      button.addEventListener('click',()=>{pcgDetail(code);if(pcgEntries.has(code))applyBytes(Uint8Array.of(code));});fragment.append(button);
    }
    $('pcg-grid').replaceChildren(fragment);$('pcg-count').textContent=pcgEntries.size+' / 256 文字を定義';$('pcg-clear').disabled=!pcgEntries.size;pcgDetail(pcgSelected);
  }
  function importPreview(){
    if(!pcgImport)return;
    try{
      const records=X1Pcg.assignments(pcgImport.scan,$('pcg-start').value);
      const fragment=document.createDocumentFragment();
      for(const record of records.slice(0,16)){
        const item=document.createElement('figure'),img=document.createElement('img'),label=document.createElement('figcaption');
        img.alt='';img.src='data:image/svg+xml,'+encodeURIComponent(X1Pcg.svg(record.hex,$('pcg-import-order').value,$('pcg-import-layout').value));
        label.textContent='$'+X1.hex(record.code)+' / '+record.code;item.append(img,label);fragment.append(item);
      }
      $('pcg-import-preview').replaceChildren(fragment);$('pcg-import-error').textContent='';$('pcg-import-confirm').disabled=false;
    }catch(err){$('pcg-import-preview').replaceChildren();$('pcg-import-error').textContent=err.message;$('pcg-import-confirm').disabled=true;}
  }
  async function applyPcg(scan,start){
    const records=X1Pcg.assignments(scan,start);
    for(const record of records)pcgEntries.set(record.code,record.hex);
    if(records.length)pcgSelected=records[0].code;
    $('pcg-enabled').checked=true;sidebar('pcg');renderPcgGrid();
    if(await refreshPcgFont())notify(records.length+'件のPCGを設定しました（'+pcgEntries.size+'文字）。'+(scan.warnings.length?'\n'+scan.warnings.join('\n'):''));
  }
  async function setupPcg(){
    const [start,end]=selection();if(start===end){notify('PCG定義や48桁の16進データを選択してください。',true);return;}
    const scan=X1Pcg.scan(doc.view.text.slice(start,end));
    if(!scan.definitions.length&&!scan.raw.length){notify('取り込めるPCG定義が見つかりません。\n'+scan.warnings.join('\n'),true);return;}
    if(scan.raw.length){
      pcgImport={scan,bytes:doc.bytes};$('pcg-import-summary').textContent='コード指定の定義 '+scan.definitions.length+'件、開始コードを指定するデータ '+scan.raw.length+'件を検出しました。'+(scan.warnings.length?' '+scan.warnings.length+'件は読み飛ばします。':'');
      $('pcg-start-label').hidden=false;$('pcg-import-order').value=$('pcg-order').value;$('pcg-import-layout').value=$('pcg-layout').value;
      importPreview();$('pcg-import-dialog').showModal();$('pcg-start').focus();return;
    }
    await applyPcg(scan,0);
  }
  function cancelPcgImport(){
    pcgImport=null;if($('pcg-import-dialog').open)$('pcg-import-dialog').close();
  }
  async function restoreFont() {
    const revision = fontRevision;
    try {
      const info = await host?.currentFont?.();
      if (!info) return;
      if (info.error) { notify(info.error,true); return; }
      const face = await prepareFont(info);
      if (revision === fontRevision) activateFont(info,face);
    } catch (err) { notify('保存されたフォントを表示できません。内蔵フォントを使います。\n'+err.message,true); }
  }
  function setSelection(start, end = start, focus = true) {
    if (focus) editor.focus(); editor.setSelectionRange(start,end); selectionBefore = [start,end]; status();
  }
  function status() {
    const at = editor.selectionStart, byteOffset = doc.view.offsets[at];
    const before = doc.view.text.slice(0,at), line = before.split('\n').length, column = at - before.lastIndexOf('\n');
    $('position').textContent = `行 ${line} · 桁 ${column}`;
    const byte = doc.bytes[byteOffset];
    $('byte-info').textContent = byte === undefined ? 'EOF' : '$' + X1.hex(byte) + ' · ' + X1.describe(byte);
    if (editor.selectionEnd > at) $('byte-info').textContent += ` · 選択 ${doc.view.offsets[editor.selectionEnd] - byteOffset} bytes`;
    $('size').textContent = doc.bytes.length.toLocaleString() + ' bytes';
    syncSelection();
  }
  function syncSelection(){
    if(!mirrorSelection)return;
    const [start,end]=selection();
    if(start===end||document.activeElement!==editor){CSS.highlights.delete('x1-selection');return;}
    function point(at){
      const line=renderedLines.find(item=>at<=item.start+item.text.length)||renderedLines.at(-1);
      let remaining=at-line.start;
      const walker=document.createTreeWalker(line.element,NodeFilter.SHOW_TEXT);
      let node;
      while((node=walker.nextNode())){
        if(remaining<node.length)return [node,remaining];
        remaining-=node.length;
      }
      return [line.element,line.element.childNodes.length];
    }
    const range=document.createRange();range.setStart(...point(start));range.setEnd(...point(end));
    CSS.highlights.set('x1-selection',new Highlight(range));
  }
  function syncScroll() {
    mirror.style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`;
    $('line-numbers').style.transform = `translateY(${-editor.scrollTop}px)`;
  }
  function layoutMetrics() {
    const style = getComputedStyle(editor), scale = Number($('scale').value);
    const cell = parseFloat(style.fontSize) || 8 * scale;
    const lineHeight = parseFloat(style.lineHeight) || 10 * scale;
    const padding = (parseFloat(style.paddingLeft) || 18) + (parseFloat(style.paddingRight) || 18);
    return { cell, lineHeight, columns: Math.max(1, Math.floor((editor.clientWidth - padding) / cell)) };
  }
  function updateLayout() {
    const wrapped = $('word-wrap').checked;
    // Match the textarea's actual content area, excluding its vertical scrollbar.
    mirror.style.width = wrapped ? editor.clientWidth + 'px' : '';
    const {lineHeight, columns} = layoutMetrics(), numbers = [];
    let visualRow = 0;
    renderedLines.forEach((line, index) => {
      const measuredHeight = line.element.getBoundingClientRect().height;
      const rows = wrapped ? Math.max(1, measuredHeight > 0 ? Math.round(measuredHeight / lineHeight) : Math.ceil(line.text.length / columns)) : 1;
      line.row = visualRow; line.rows = rows; visualRow += rows;
      numbers.push(String(index + 1));
      for (let row = 1; row < rows; row++) numbers.push('↪');
    });
    $('line-numbers').textContent = numbers.join('\n'); syncScroll();
  }
  function revealPosition(at) {
    const {cell,lineHeight,columns} = layoutMetrics();
    const line = renderedLines.find(item => at >= item.start && at <= item.start + item.text.length) || renderedLines.at(-1);
    if (!line) return;
    const column = at - line.start, wrapped = $('word-wrap').checked;
    let top = (line.row + (wrapped ? Math.min(line.rows - 1, Math.floor(column / columns)) : 0)) * lineHeight;
    let left = (wrapped ? column % columns : column) * cell;
    // Read the actual glyph position for wrapping, including spaces and colored spans.
    const walker = document.createTreeWalker(line.element, NodeFilter.SHOW_TEXT);
    let node, remaining = Math.min(column, Math.max(0, line.text.length - 1));
    while ((node = walker.nextNode())) {
      if (remaining < node.length) {
        const range = document.createRange(); range.setStart(node,remaining); range.setEnd(node,remaining+1);
        if (range.getBoundingClientRect) {
          const rect = range.getBoundingClientRect(), viewport = editor.getBoundingClientRect();
          top = rect.top - viewport.top + editor.scrollTop;
          left = rect.left - viewport.left + editor.scrollLeft;
        }
        break;
      }
      remaining -= node.length;
    }
    if (top < editor.scrollTop || top > editor.scrollTop+editor.clientHeight-lineHeight*2) editor.scrollTop = Math.max(0,top-editor.clientHeight/3);
    if (!wrapped && (left < editor.scrollLeft || left > editor.scrollLeft+editor.clientWidth-cell*3)) editor.scrollLeft = Math.max(0,left-editor.clientWidth/3);
    syncScroll();
  }
  function setWrap() {
    const wrapped = $('word-wrap').checked;
    editor.wrap = wrapped ? 'soft' : 'off';
    $('text-area').classList.toggle('wrapped',wrapped);
    if (wrapped) editor.scrollLeft = 0;
    updateLayout();
  }
  function render(caret, end) {
    const x = editor.scrollLeft, y = editor.scrollTop;
    editor.value = doc.view.text;
    const fragment = document.createDocumentFragment();
    // One display block per real source line, so wrapped continuation rows can be measured.
    let start = 0;
    renderedLines = doc.view.text.split('\n').map(lineText => {
      const element = document.createElement('span'); element.className = 'source-line';
      for (const token of X1Syntax.highlightLine(lineText)) {
        const syntaxSpan = document.createElement('span');
        if (token.kind) syntaxSpan.className = 'syntax-' + token.kind;
        let text = '', kind = '', quoted = false;
        function flush() {
          if (!text) return;
          const span = document.createElement('span'); span.className = kind; span.textContent = text; syntaxSpan.append(span); text = '';
        }
        for (const c of token.text) {
          const b = c.charCodeAt(0) - X1.BASE;
          const glyphKind = b >= 0 && b < 32 ? 'control' : b >= 128 && b <= 159 || b >= 224 ? 'special' : '';
          const inString=token.kind==='string'&&quoted&&c!=='"';
          const next=[glyphKind,inString?'pcg-string':''].filter(Boolean).join(' ');
          if(token.kind==='string'&&c==='"')quoted=!quoted;
          if (next !== kind) { flush(); kind = next; }
          text += c;
        }
        flush(); element.append(syntaxSpan);
      }
      fragment.append(element);
      const line = {element,text:lineText,start}; start += lineText.length + 1; return line;
    });
    mirror.replaceChildren(fragment); updateLayout();
    $('empty-hint').hidden = doc.bytes.length > 0;
    const counts = doc.view.counts;
    $('eol-info').textContent = '既存：' + (Object.entries(counts).filter(([,n]) => n).map(([name,n]) => `${name} ${n}`).join(' / ') || 'なし');
    $('newline').value = {'\r\n':'CRLF','\n':'LF','\r':'CR'}[doc.newline];
    document.querySelector('[data-command="undo"]').disabled = !doc.undoStack.length;
    document.querySelector('[data-command="redo"]').disabled = !doc.redoStack.length;
    host?.state({dirty:doc.dirty});
    if (caret !== undefined) setSelection(caret,end ?? caret);
    editor.scrollLeft = x; editor.scrollTop = y; syncScroll(); status();
    contentChanged();
  }
  function applyBytes(bytes) {
    if (busy) return;
    const [start,end] = selection();
    const caret = doc.replace(start,end,bytes,[start,end]); render(caret);
  }
  function applyInput() {
    if (composing || busy) return;
    if (editor.value === doc.view.text) { status(); return; }
    try { const caret = doc.updateText(editor.value,selectionBefore,pendingInputType); render(caret); }
    catch (err) { render(...selectionBefore); notify(err.message,true); }
  }
  function showFind() { $('search-panel').hidden = false; $('find-text').focus(); $('find-text').select(); }
  function hideFind() { $('search-panel').hidden = true; editor.focus(); }
  function fold(text) {
    return $('case-sensitive').checked ? text : text.toLowerCase();
  }
  function queryText() { return X1.decode(X1.parseEscapes($('find-text').value,doc.newline)).text; }
  function find(backward = false) {
    try {
      const needle = fold(queryText());
      if (!needle.length) { showFind(); return false; }
      const haystack = fold(doc.view.text);
      let at;
      if (backward) {
        const start = editor.selectionStart - 1;
        at = start >= 0 ? haystack.lastIndexOf(needle,start) : -1;
        if (at < 0) at = haystack.lastIndexOf(needle);
      } else {
        at = haystack.indexOf(needle,editor.selectionEnd);
        if (at < 0) at = haystack.indexOf(needle);
      }
      if (at < 0) { $('find-status').textContent = '見つかりません'; return false; }
      setSelection(at,at+needle.length);
      revealPosition(at); $('find-status').textContent = ''; return true;
    } catch (err) { notify(err.message,true); return false; }
  }
  function replaceOne() {
    try {
      const needle = fold(queryText()); if (!needle) return;
      if (fold(doc.view.text.slice(...selection())) !== needle && !find()) return;
      applyBytes(X1.parseEscapes($('replace-text').value,doc.newline)); find();
    } catch (err) { notify(err.message,true); }
  }
  function replaceAll() {
    if (busy) return;
    try {
      const needle = fold(queryText()); if (!needle) return;
      const replacement = X1.parseEscapes($('replace-text').value,doc.newline);
      const haystack = fold(doc.view.text), parts = [];
      let at = 0, previousByte = 0, count = 0, length = 0;
      while ((at = haystack.indexOf(needle,at)) >= 0) {
        const begin = doc.view.offsets[at], end = doc.view.offsets[at+needle.length];
        parts.push(doc.bytes.slice(previousByte,begin),replacement);
        length += begin-previousByte+replacement.length;
        previousByte = end; at += needle.length; count++;
      }
      if (!count) { $('find-status').textContent = '見つかりません'; return; }
      const tail = doc.bytes.slice(previousByte); parts.push(tail); length += tail.length;
      if (length > 2*1024*1024) throw Error('置換後のサイズが2 MiBを超えます。');
      const result = new Uint8Array(length); let offset = 0;
      for (const part of parts) { result.set(part,offset); offset += part.length; }
      doc.replace(0,doc.view.text.length,result,selection()); render(0); $('find-status').textContent = count + '件置換しました';
    } catch (err) { notify(err.message,true); }
  }
  function preview(code) {
    hoverCode = code; $('preview-glyph').textContent = X1.glyph(code);
    $('preview-code').textContent = '$' + X1.hex(code); $('preview-name').textContent = X1.describe(code);
  }
  function palette() {
    let codes;
    if (group === 'symbols') codes = [...Array.from({length:32},(_,i)=>i+128),...Array.from({length:32},(_,i)=>i+224)];
    else if (group === 'kana') codes = Array.from({length:64},(_,i)=>i+160);
    else if (group === 'controls') codes = Array.from({length:32},(_,i)=>i);
    else codes = Array.from({length:256},(_,i)=>i);
    $('palette').replaceChildren(...codes.map(code => {
      const button = document.createElement('button'); button.textContent = X1.glyph(code);
      button.title = '$' + X1.hex(code) + ' · ' + X1.describe(code);
      button.setAttribute('aria-label',button.title); button.dataset.code = String(code);
      if (code < 32) button.className = 'control-key';
      button.addEventListener('mouseenter',()=>preview(code));
      button.addEventListener('focus',()=>preview(code));
      button.addEventListener('mousedown',e=>e.preventDefault());
      button.addEventListener('click',()=>{ applyBytes(Uint8Array.of(code)); preview(code); });
      return button;
    }));
    document.querySelectorAll('[data-group]').forEach(b => b.classList.toggle('active',b.dataset.group === group));
  }
  async function save(saveAs = false) {
    const snapshot = doc.bytes.slice();
    const result = await host.save({bytes:Array.from(snapshot),saveAs});
    if (!result) return false;
    doc.markSaved(snapshot); render(...selection()); notify('保存しました · バイト検証済み'); return true;
  }
  async function canLeave() {
    if (!doc.dirty) return true;
    const answer = await host.confirmDirty();
    if (answer === 'discard') return true;
    if (answer === 'save') return save();
    return false;
  }
  function load(data) { cancelPcgImport();doc.load(data.bytes); editor.scrollTop = 0; editor.scrollLeft = 0; render(0); }
  async function command(name) {
    if (busy) return;
    if(name==='pcg-setup'){await setupPcg();return;}
    if (name === 'undo' || name === 'redo') {
      if (document.activeElement?.tagName === 'INPUT') { document.execCommand(name); return; }
      const sel = doc[name](selection()); if (sel) render(...sel); return;
    }
    if (name === 'find') return showFind();
    if (name === 'find-next') return find();
    if (name === 'find-prev') return find(true);
    if (name === 'insert') { $('insert-dialog').showModal(); $('insert-text').focus(); return; }
    if (name === 'help') return $('help-dialog').showModal();
    if (name === 'zoom-in' || name === 'zoom-out') {
      $('scale').value = String(Math.max(1,Math.min(4,Number($('scale').value)+(name==='zoom-in'?1:-1)))); setScale(); return;
    }
    busy = true; editor.readOnly = true; document.body.classList.add('busy');
    try {
      if (name === 'font-load') {
        const info = await host.chooseFont();
        if (info) {
          fontRevision++;
          const face = await prepareFont(info);
          if (await host.commitFont(info.token)) {
            activateFont(info,face); notify(info.name+' を設定しました。次回起動時も使用します。');
          }
        }
      } else if (name === 'font-reset') {
        if (await host.resetFont()) {
          fontRevision++; activateFont({name:'内蔵フォント'},null); notify('内蔵フォントに戻しました。');
        }
      } else if (name === 'save' || name === 'save-as') await save(name === 'save-as');
      else if (name === 'new' || name === 'open' || name === 'close') {
        if (!(await canLeave())) return;
        if (name === 'new') { host.newDocument(); load({name:'Untitled.bas',bytes:[]}); }
        else if (name === 'open') { const data = await host.open(); if (data) load(data); }
        else host.close();
      }
    } catch (err) { notify(err.message,true); }
    finally { busy = false; editor.readOnly = false; document.body.classList.remove('busy'); editor.focus(); }
  }
  function setScale() {
    const scale = Number($('scale').value);
    document.documentElement.style.setProperty('--cell',8*scale+'px');
    document.documentElement.style.setProperty('--line-height',10*scale+'px'); updateLayout();
  }
  editor.addEventListener('beforeinput',event => {
    if (busy) { event.preventDefault(); return; }
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') { event.preventDefault(); command(event.inputType==='historyUndo'?'undo':'redo'); }
    else if (!composing) { selectionBefore = selection(); pendingInputType = event.inputType; }
  });
  editor.addEventListener('input',event => { if (!event.isComposing) applyInput(); });
  editor.addEventListener('compositionstart',()=>{ selectionBefore=selection(); composing=true; });
  editor.addEventListener('compositionend',()=>{ composing=false; applyInput(); });
  editor.addEventListener('scroll',syncScroll);
  editor.addEventListener('select',status); editor.addEventListener('click',status); editor.addEventListener('keyup',status);
  editor.addEventListener('focus',syncSelection);
  editor.addEventListener('blur',()=>{if(mirrorSelection)CSS.highlights.delete('x1-selection');});
  document.addEventListener('selectionchange',syncSelection);
  editor.addEventListener('keydown',event => {
    if (busy || composing) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); command(event.shiftKey?'redo':'undo'); }
    else if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); command('redo'); }
    else if (event.key === 'Tab') { event.preventDefault(); applyBytes(Uint8Array.of(9)); }
    else if (event.key === 'Escape') hideFind();
  });
  function copy(event,cut) {
    event.preventDefault(); if (busy) return;
    const [start,end] = selection(); if (start === end) return;
    const bytes = doc.bytes.slice(doc.view.offsets[start],doc.view.offsets[end]);
    try {
      event.clipboardData.setData('text/plain',X1.clipboardText(bytes));
      event.clipboardData.setData('application/x-x1-basic-editor',JSON.stringify(Array.from(bytes)));
      event.clipboardData.setData('application/x-x1-byte-editor',JSON.stringify(Array.from(bytes)));
      if (cut) {
        const caret = doc.replace(start,end,new Uint8Array(),[start,end]); render(caret);
      }
    } catch (err) { notify(err.message,true); }
  }
  editor.addEventListener('copy',event=>copy(event,false)); editor.addEventListener('cut',event=>copy(event,true));
  editor.addEventListener('paste',event => {
    event.preventDefault(); if (busy) return;
    const at = selection();
    try {
      const raw = event.clipboardData.getData('application/x-x1-basic-editor') || event.clipboardData.getData('application/x-x1-byte-editor');
      let bytes;
      if (raw) {
        const values = JSON.parse(raw);
        if (!Array.isArray(values) || values.length > 2*1024*1024 || values.some(n=>!Number.isInteger(n)||n<0||n>255)) throw Error('クリップボードのバイトデータが不正です。');
        bytes = Uint8Array.from(values);
      } else bytes = X1.encodeInput(event.clipboardData.getData('text/plain'),doc.newline);
      const caret = doc.replace(at[0],at[1],bytes,at); render(caret);
    } catch (err) { notify(err.message,true); }
  });
  // Do not let native text dropping insert unvalidated data or trigger file navigation.
  editor.addEventListener('drop',event => { event.preventDefault(); notify('ファイルは「開く…」から選択してください。'); });
  document.addEventListener('dragover',event=>event.preventDefault());
  document.addEventListener('drop',event=>event.preventDefault());
  document.querySelectorAll('[data-command]').forEach(button=>button.addEventListener('click',()=>command(button.dataset.command)));
  document.querySelectorAll('[data-group]').forEach(button=>button.addEventListener('click',()=>{ group=button.dataset.group; palette(); }));
  $('find-next').onclick=()=>find(); $('find-prev').onclick=()=>find(true); $('replace-one').onclick=replaceOne; $('replace-all').onclick=replaceAll;
  $('close-search').onclick=hideFind; $('open-insert').onclick=()=>command('insert'); $('close-help').onclick=()=>$('help-dialog').close();
  $('find-text').addEventListener('keydown',event=>{ if(event.key==='Enter'){event.preventDefault();find(event.shiftKey);} if(event.key==='Escape')hideFind(); });
  $('replace-text').addEventListener('keydown',event=>{ if(event.key==='Enter'){event.preventDefault();replaceOne();} });
  $('insert-confirm').onclick=event=>{
    event.preventDefault();
    try { const bytes=X1.parseEscapes($('insert-text').value,doc.newline); $('insert-dialog').close(); applyBytes(bytes); }
    catch(err){notify(err.message,true);}
  };
  $('newline').onchange=()=>{ doc.newline={CRLF:'\r\n',LF:'\n',CR:'\r'}[$('newline').value]; notify('新しく入力する改行を '+$('newline').value+' にしました。'); };
  $('scale').onchange=setScale;
  document.querySelectorAll('[data-sidebar]').forEach(button=>button.addEventListener('click',()=>sidebar(button.dataset.sidebar)));
  $('pcg-enabled').onchange=refreshPcgFont;
  $('pcg-strings-only').onchange=displayFont;
  for(const id of ['pcg-order','pcg-layout'])$(id).onchange=()=>{renderPcgGrid();refreshPcgFont();};
  for(const id of ['pcg-start','pcg-import-order','pcg-import-layout'])$(id).addEventListener(id==='pcg-start'?'input':'change',importPreview);
  $('pcg-remove').onclick=()=>{pcgEntries.delete(pcgSelected);renderPcgGrid();refreshPcgFont();};
  $('pcg-clear').onclick=()=>{pcgEntries.clear();$('pcg-enabled').checked=false;renderPcgGrid();refreshPcgFont();};
  $('pcg-import-confirm').onclick=async event=>{
    event.preventDefault();if(!pcgImport)return;
    if(pcgImport.bytes!==doc.bytes){$('pcg-import-error').textContent='選択後に文書が変更されました。選び直してください。';return;}
    try{
      const scan=pcgImport.scan,start=$('pcg-start').value;X1Pcg.assignments(scan,start);
      $('pcg-order').value=$('pcg-import-order').value;$('pcg-layout').value=$('pcg-import-layout').value;
      $('pcg-import-dialog').close();pcgImport=null;await applyPcg(scan,start);
    }catch(err){$('pcg-import-error').textContent=err.message;}
  };
  $('word-wrap').onchange=setWrap;
  if (window.ResizeObserver) new ResizeObserver(updateLayout).observe($('text-area'));
  else window.addEventListener('resize',updateLayout);
  document.fonts?.ready.then(updateLayout);
  const sidebarResize=window.X1SidebarResize(updateLayout);
  host?.onCommand(command); host?.onLoaded(load);
  setScale(); setWrap(); palette(); preview(hoverCode); renderPcgGrid(); render(0); displayFont();restoreFont();
})();

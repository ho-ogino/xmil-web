(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.X1 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const BASE = 0xe000;
  const graphics = ['vfill1','vfill2','vfill3','vfill4','vfill5','vfill6','vfill7','vfill8',
    'hfill1','hfill2','hfill3','hfill4','hfill5','hfill6','hfill7','diag_bl_tr',
    'box_h','box_v','box_up','box_down','box_left','box_right','box_cross','box_tr',
    'box_br','box_bl','box_tl','circle_tr','circle_bl','circle_br','circle_tl','diag_tl_br'];
  const symbols = ['circle_fill','circle','spade','heart','diamond','club','diag_fill_br','diag_fill_bl',
    'cross','quad_tl','quad_bl','quad_tr','quad_br','checker_bl_tr','checker_tl_br','square',
    'gray','saturday','friday','thursday','wednesday','tuesday','monday','sunday','hour','minute',
    'second','year','yen','hito','sei','postal'];
  const controls = ['NUL','SOH','STX','ETX','EOT','ENQ','ACK','BEL','BS','TAB','LF','VT','FF','CR',
    'SO','SI','DLE','DC1','DC2','DC3','DC4','NAK','SYN','ETB','CAN','EM','SUB','ESC',
    'RIGHT','LEFT','UP','DOWN'];
  const aliases = new Map();
  const names = new Map();
  graphics.forEach((name, i) => names.set(0x80 + i, name));
  symbols.forEach((name, i) => names.set(0xe0 + i, name));
  controls.forEach((name, i) => names.set(i, name));
  names.forEach((name, code) => aliases.set(name.toLowerCase(), code));
  const symbolUnicode = ['●','○','♠','♥','♦','♣',null,null,'×',null,null,null,null,null,null,'□',
    null,'土','金','木','水','火','月','日','時','分','秒','年','円','人','生','〒'];
  const boxUnicode = ['─','│','┴','┬','┤','├','┼','┐','┘','└','┌'];
  const unicodeBytes = new Map();
  symbolUnicode.forEach((c, i) => { if (c) unicodeBytes.set(c, 0xe0 + i); });
  boxUnicode.forEach((c, i) => unicodeBytes.set(c, 0x90 + i));
  unicodeBytes.set('■', 0x87);
  unicodeBytes.set('¥', 0x5c);
  unicodeBytes.set('π', 0x7f);
  const kanaMap = new Map();
  for (let n = 0xff61; n <= 0xff9f; n++) {
    const half = String.fromCharCode(n);
    kanaMap.set(half, [n - 0xff61 + 0xa1]);
    kanaMap.set(half.normalize('NFKC'), [n - 0xff61 + 0xa1]);
    for (const mark of ['\uff9e', '\uff9f']) {
      const full = (half + mark).normalize('NFKC');
      if ([...full].length === 1) kanaMap.set(full, [n - 0xff61 + 0xa1, mark === '\uff9e' ? 0xde : 0xdf]);
    }
  }
  kanaMap.set('゛', [0xde]); kanaMap.set('゜', [0xdf]);
  kanaMap.set('\u3099', [0xde]); kanaMap.set('\u309a', [0xdf]);

  function glyph(byte) { return String.fromCharCode(byte >= 0x20 && byte <= 0x7e ? byte : BASE + byte); }
  function hex(byte) { return byte.toString(16).toUpperCase().padStart(2, '0'); }
  function describe(byte) {
    if (byte === undefined) return 'EOF';
    if (names.has(byte)) return names.get(byte);
    if (byte >= 0xa1 && byte <= 0xdf) return String.fromCharCode(0xff61 + byte - 0xa1);
    if (byte >= 0x20 && byte < 0x7f) return byte === 0x20 ? 'SPACE' : String.fromCharCode(byte);
    if (byte === 0x7f) return 'π';
    return '$' + hex(byte);
  }

  function decode(bytes) {
    const chars = [], offsets = [0];
    const counts = { CRLF: 0, LF: 0, CR: 0 };
    let preferred = '\r\n', highest = 0;
    for (let i = 0; i < bytes.length;) {
      const b = bytes[i++];
      if (b === 13 || b === 10) {
        let key = b === 13 ? 'CR' : 'LF';
        if (b === 13 && bytes[i] === 10) { i++; key = 'CRLF'; }
        counts[key]++;
        chars.push('\n');
      } else chars.push(glyph(b));
      offsets.push(i);
    }
    for (const key of ['CRLF', 'LF', 'CR']) {
      if (counts[key] > highest) { highest = counts[key]; preferred = {CRLF:'\r\n', LF:'\n', CR:'\r'}[key]; }
    }
    return { text: chars.join(''), offsets, counts, preferred };
  }

  function encodeInput(text, newline = '\r\n') {
    const result = [], invalid = new Set();
    // No compatibility normalization over the whole string: that would alter ASCII and symbols.
    for (const original of text.replace(/\r\n|\r/g, '\n').normalize('NFC')) {
      const cp = original.codePointAt(0);
      if (cp >= BASE && cp <= BASE + 255) result.push(cp - BASE);
      else if (original === '\n') result.push(...Array.from(newline, c => c.charCodeAt(0)));
      else if (cp <= 0x7f) result.push(cp);
      else if (unicodeBytes.has(original)) result.push(unicodeBytes.get(original));
      else {
        let kana = original;
        if (cp >= 0x3041 && cp <= 0x3096) kana = String.fromCharCode(cp + 0x60);
        if (kanaMap.has(kana)) result.push(...kanaMap.get(kana));
        else invalid.add(original);
      }
    }
    if (invalid.size) throw new Error('X1で表現できない文字があります：' + [...invalid].join(' ') + '\n入力・貼り付けは反映していません。');
    return Uint8Array.from(result);
  }

  function parseEscapes(text, newline = '\r\n') {
    const result = [];
    // Avoid the engine's argument-count limit for long search/insert/replace text.
    const append = part => { for (const byte of encodeInput(part, newline)) result.push(byte); };
    let pos = 0;
    const re = /\\(?:x([0-9a-f]{2})|\{([^}]+)\}|(\\))/gi;
    for (const m of text.matchAll(re)) {
      append(text.slice(pos, m.index));
      if (m[1]) result.push(parseInt(m[1], 16));
      else if (m[3]) result.push(0x5c);
      else {
        const code = aliases.get(m[2].toLowerCase());
        if (code === undefined) throw new Error('不明な記号名：' + m[2]);
        result.push(code);
      }
      pos = m.index + m[0].length;
    }
    append(text.slice(pos));
    return Uint8Array.from(result);
  }

  function clipboardText(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b === 13 || b === 10) {
        if (b === 13 && bytes[i + 1] === 10) i++;
        out += '\n';
      } else if (b === 0x5c) out += '\\\\';
      else if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
      else if (b >= 0xa1 && b <= 0xdf) out += String.fromCharCode(0xff61 + b - 0xa1);
      else if (names.has(b)) out += '\\{' + names.get(b) + '}';
      else out += '\\x' + hex(b);
    }
    return out;
  }

  function equal(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function spliceBytes(bytes, start, end, insert) {
    const out = new Uint8Array(bytes.length - (end - start) + insert.length);
    out.set(bytes.subarray(0, start)); out.set(insert, start); out.set(bytes.subarray(end), start + insert.length);
    return out;
  }
  class ByteDocument {
    constructor(bytes = new Uint8Array()) { this.load(bytes); }
    load(bytes) {
      this.bytes = Uint8Array.from(bytes); this.saved = this.bytes.slice();
      this.undoStack = []; this.redoStack = []; this.refresh();
      this.newline = this.view.preferred;
    }
    refresh() { this.view = decode(this.bytes); }
    get dirty() { return !equal(this.bytes, this.saved); }
    markSaved(bytes = this.bytes) { this.saved = Uint8Array.from(bytes); }
    replace(start, end, insert, selection = [start, end]) {
      const from = this.view.offsets[start], to = this.view.offsets[end];
      if (from === undefined || to === undefined) throw new RangeError('Selection out of range');
      const updated = spliceBytes(this.bytes, from, to, insert);
      if (updated.length > 2 * 1024 * 1024) throw new Error('編集できるサイズは2 MiBまでです。');
      const caretByte = from + insert.length;
      if (equal(updated, this.bytes)) return end;
      this.undoStack.push({ bytes: this.bytes, selection });
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack = []; this.bytes = updated; this.refresh();
      const idx = this.view.offsets.findIndex(n => n >= caretByte);
      return idx < 0 ? this.view.text.length : idx;
    }
    updateText(text, selection, inputType = '') {
      const old = this.view.text;
      let start = 0, endOld = old.length, endNew = text.length;
      while (start < endOld && start < endNew && old[start] === text[start]) start++;
      while (endOld > start && endNew > start && old[endOld - 1] === text[endNew - 1]) { endOld--; endNew--; }
      // A diff alone is ambiguous among repeated characters or newlines whose original
      // byte encodings differ. Prefer the browser's actual pre-edit selection and action.
      if (selection) {
        let [from,to] = selection;
        if (from === to && inputType.startsWith('delete')) {
          const removed = old.length - text.length;
          if (inputType.endsWith('Backward')) from -= removed;
          else if (inputType.endsWith('Forward')) to += removed;
        }
        const insertedEnd = text.length - (old.length - to);
        if (from >= 0 && to <= old.length && insertedEnd >= from &&
          old.slice(0,from) === text.slice(0,from) && old.slice(to) === text.slice(insertedEnd)) {
          start = from; endOld = to; endNew = insertedEnd;
        }
      }
      const insert = encodeInput(text.slice(start, endNew), this.newline);
      return this.replace(start, endOld, insert, selection);
    }
    undo(selection) { return this.travel(this.undoStack, this.redoStack, selection); }
    redo(selection) { return this.travel(this.redoStack, this.undoStack, selection); }
    travel(from, to, selection) {
      if (!from.length) return null;
      const state = from.pop(); to.push({ bytes: this.bytes, selection });
      this.bytes = state.bytes; this.refresh(); return state.selection;
    }
  }
  return { BASE, glyph, hex, describe, names, decode, encodeInput, parseEscapes, clipboardText,
    equal, spliceBytes, ByteDocument };
});

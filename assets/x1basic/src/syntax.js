(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./keywords.js'));
  else root.X1Syntax = factory(root.X1Keywords);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (words) {
  'use strict';
  // HuLexer matches the longest reserved prefix at each identifier start, even without spaces.
  // An identifier that does not start with a reserved word consumes its whole name, including digits.
  const byInitial = new Map();
  for (const word of [...words].sort((a,b) => b.length-a.length || a.localeCompare(b))) {
    if (!byInitial.has(word[0])) byInitial.set(word[0], []);
    byInitial.get(word[0]).push(word);
  }
  const decimal = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[ED][+-]?\d+)?[!#%]?/i;
  const radix = /^&(?:H[\dA-F]*|O[0-7]*|B[01]*)/i;
  const dataNumber = /^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[ED][+-]?\d+)?[!#%]?|&(?:H[\dA-F]+|O[0-7]+|B[01]+))$/i;
  const isLetter = c => c !== undefined && /[A-Z]/i.test(c);
  const isDigit = c => c !== undefined && c >= '0' && c <= '9';

  function highlightLine(line) {
    const runs = [], upper = line.toUpperCase();
    let pos = 0;
    function emit(end, kind = '') {
      if (end <= pos) return;
      const text = line.slice(pos,end), previous = runs[runs.length-1];
      if (previous?.kind === kind) previous.text += text;
      else runs.push({text,kind});
      pos = end;
    }
    function readData() {
      while (pos < line.length && line[pos] !== ':') {
        if (line[pos] === ',') { emit(pos+1,'operator'); continue; }
        if (line[pos] === ' ') {
          let end = pos+1; while (line[end] === ' ') end++; emit(end); continue;
        }
        let end = pos, inQuote = line[pos] === '"';
        if (inQuote) {
          end++;
          while (end < line.length && line[end] !== '"') end++;
          if (end < line.length) end++;
        }
        // Unquoted DATA items are raw text, including apostrophes and reserved words.
        while (end < line.length && line[end] !== ',' && line[end] !== ':') end++;
        const item = line.slice(pos,end), trimmed = item.trimEnd();
        const bodyEnd = pos + trimmed.length;
        emit(bodyEnd, dataNumber.test(trimmed) ? 'number' : 'string'); emit(end);
      }
    }
    // Leading digits are the source's BASIC line number; retain all original spacing.
    const leading = line.match(/^( *)(\d+)/);
    if (leading) { emit(leading[1].length); emit(leading[0].length,'line-number'); }
    while (pos < line.length) {
      const c = line[pos];
      if (c === "'") { emit(line.length,'comment'); break; }
      if (c === '"') {
        let end = pos+1; while (end < line.length && line[end] !== '"') end++;
        if (end < line.length) end++;
        emit(end,'string'); continue;
      }
      if (isDigit(c) || c === '.' && isDigit(line[pos+1])) {
        const number = line.slice(pos).match(decimal); emit(pos+number[0].length,'number'); continue;
      }
      if (c === '&') {
        const number = line.slice(pos).match(radix);
        if (number) { emit(pos+number[0].length,'number'); continue; }
      }
      if (c === '?') { emit(pos+1,'keyword'); continue; }
      if (isLetter(c)) {
        const word = byInitial.get(upper[pos])?.find(word => upper.startsWith(word,pos));
        if (word) {
          if (word === 'REM') { emit(line.length,'comment'); break; }
          let end = pos+word.length;
          if ((word === 'POKE' || word === 'PEEK') && line[end] === '@') end++;
          emit(end,'keyword');
          if (word === 'DATA') readData();
          continue;
        }
        let end = pos+1; while (isLetter(line[end]) || isDigit(line[end])) end++;
        if (line[end] && '$%!#'.includes(line[end])) end++;
        emit(end); continue;
      }
      emit(pos+1, '+-*/\\=<>(),;:#^'.includes(c) ? 'operator' : '');
    }
    return runs;
  }
  return {highlightLine};
});

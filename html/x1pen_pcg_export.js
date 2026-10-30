// x1pen_pcg_export.js — what X1Pen inserts or copies for DEFCHR TOOL (the PCG tab)
// DEFCHR TOOL (defchrtool/, imported by scripts/import-defchrtool.mjs) calls X1Host.exportPCG
// ("X1Pen に挿入") or X1Host.copyPCG ("クリップボードにコピー") with the file it would save (its
// X1HOST.md, version 1). This file checks such a request and builds the text for the target;
// x1pen.js reads the Blob, then inserts the text at the cursor, merges the HuBASIC lines into the
// program, or hands the text back for the clipboard.
// Target and format, as agreed with DEFCHR TOOL:
//   fuzzybasic / asm -> the ASM tab: asm, asm3 and bas (ASCII) text as is; bin, bin3 as DB lines
//   slang            -> the SLANG tab: the same texts as is; bin, bin3 as an ARRAY BYTE
//   hubasic          -> the HuBASIC tab: bas (ASCII) only, its DEFCHR$ lines merged by line number
//   image, bas (binary) -> nowhere
// Bytes keep the order DEFCHR TOOL wrote them in: bin3 is rows of B,R,G, bin is B[8],R[8],G[8].

(function(root) {
    'use strict';

    var TARGETS = ['fuzzybasic', 'asm', 'slang', 'hubasic'];
    var FORMATS = ['image', 'bin', 'bin3', 'bas', 'asm', 'asm3'];
    var MAX_BLOB_BYTES = 1024 * 1024;
    var BYTES_PER_CHAR = 24;
    var HUBASIC_MAX_LINE = 65529;      // HuParser.MaxLineNumber in SLANG-compiler's hubasic2sl

    function fail(code, message) {
        return { ok: false, code: code, message: message };
    }

    function hex2(n) {
        return ('0' + n.toString(16).toUpperCase()).slice(-2);
    }

    function isCode(n) {
        return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 255;
    }

    function isPositive(n) {
        return typeof n === 'number' && Number.isInteger(n) && n >= 1;
    }

    // The request's fields, or a failure. The Blob comes from the DEFCHR TOOL iframe, so it is
    // checked by its shape (instanceof Blob is false across windows).
    function checkRequest(request) {
        if (!request || typeof request !== 'object') return fail('invalid', 'X1Pen への依頼が読めません。');
        if (request.version !== 1) return fail('invalid', 'この版の依頼には対応していません（version 1 だけ）。');
        if (TARGETS.indexOf(request.target) < 0) return fail('invalid', '出力先が分かりません。');
        if (FORMATS.indexOf(request.format) < 0) return fail('invalid', '出力の形式が分かりません。');
        if (request.format === 'bas' && request.basFormat !== 'asc' && request.basFormat !== 'bin') {
            return fail('invalid', 'BAS の形式（ASCII かバイナリ）が分かりません。');
        }
        if (!isCode(request.start) || !isCode(request.end) || request.start > request.end) {
            return fail('invalid', '文字コードの範囲を 00〜FF で正しく指定してください。');
        }
        var blob = request.blob;
        if (!blob || typeof blob !== 'object' || typeof blob.arrayBuffer !== 'function' ||
            typeof blob.text !== 'function' || typeof blob.size !== 'number') {
            return fail('invalid', '出力のデータが読めません。');
        }
        if (blob.size > MAX_BLOB_BYTES) return fail('invalid', '出力が大きすぎます（1 MiB まで）。');
        var count = request.end - request.start + 1;
        var lines = request.hubasic;
        if (request.target === 'hubasic' &&
            (!lines || typeof lines !== 'object' || !isPositive(lines.lineStart) || !isPositive(lines.lineStep) ||
             lines.lineStart + (count - 1) * lines.lineStep > HUBASIC_MAX_LINE)) {
            return fail('invalid', '開始行とステップは正の整数で指定し、最後の行番号を ' + HUBASIC_MAX_LINE + ' 以下にしてください。');
        }
        return {
            ok: true,
            target: request.target,
            format: request.format,
            basFormat: request.format === 'bas' ? request.basFormat : undefined,
            start: request.start,
            end: request.end,
            count: count,
            hubasic: request.target === 'hubasic' ? { lineStart: lines.lineStart, lineStep: lines.lineStep } : undefined
        };
    }

    // Where a checked request goes and how its Blob is read:
    // { ok, editor: 'asm'|'slang'|'hubasic', read: 'text'|'bytes' }
    function plan(checked) {
        if (checked.target === 'hubasic') {
            if (checked.format === 'bas' && checked.basFormat === 'asc') return { ok: true, editor: 'hubasic', read: 'text' };
            return fail('unsupported', 'HuBASIC に入れられるのは BAS（ASCII）だけです。出力先を選び直して推奨形式に変更するか、ファイル保存を使ってください。');
        }
        if (checked.format === 'image' || (checked.format === 'bas' && checked.basFormat === 'bin')) {
            return fail('unsupported', 'この形式は挿入できません。ファイル保存を選ぶか、出力先を選び直して推奨形式に変更してください。');
        }
        return {
            ok: true,
            editor: checked.target === 'slang' ? 'slang' : 'asm',
            read: (checked.format === 'bin' || checked.format === 'bin3') ? 'bytes' : 'text'
        };
    }

    // DEFCHR TOOL's text with CR, CRLF and LF as LF, ending with a newline
    function normalizeText(text) {
        var out = String(text).replace(/\r\n?/g, '\n');
        if (!/\S/.test(out)) return null;
        return /\n$/.test(out) ? out : out + '\n';
    }

    function orderNote(format) {
        return format === 'bin3' ? 'rows of B,R,G' : 'B[8],R[8],G[8]';
    }

    function rangeNote(checked) {
        return checked.count === 1 ? '$' + hex2(checked.start) : '$' + hex2(checked.start) + '-$' + hex2(checked.end);
    }

    function charBytes(bytes, i) {
        var out = [];
        for (var j = 0; j < BYTES_PER_CHAR; j++) out.push('$' + hex2(bytes[i * BYTES_PER_CHAR + j]));
        return out.join(',');
    }

    // BIN / BIN(x3) bytes -> DB lines, one character a line, like DEFCHR TOOL's own ASM files
    function dbBlock(bytes, checked) {
        var lines = ['; DEFCHR TOOL: CHR ' + rangeNote(checked) + ' (' + orderNote(checked.format) + ')'];
        for (var i = 0; i < checked.count; i++) {
            lines.push('; CHR $' + hex2(checked.start + i));
            lines.push('\tDB\t' + charBytes(bytes, i));
        }
        return lines.join('\n') + '\n';
    }

    function escapeRegExp(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // PCG<start code>, or PCG<start code>_2, _3, ... when the SLANG program already has the word
    // (in any case: the name must not collide whatever SLANG does with case)
    function slangArrayName(source, start) {
        var base = 'PCG' + hex2(start);
        var used = function(name) {
            return new RegExp('(^|[^A-Za-z0-9_])' + escapeRegExp(name) + '(?![A-Za-z0-9_])', 'i').test(String(source || ''));
        };
        if (!used(base)) return base;
        for (var n = 2; ; n++) {
            if (!used(base + '_' + n)) return base + '_' + n;
        }
    }

    // BIN / BIN(x3) bytes -> an initialized ARRAY BYTE (global or static only in SLANG)
    function slangArray(bytes, checked, name) {
        var lines = ['// DEFCHR TOOL: CHR ' + rangeNote(checked) + ' (' + orderNote(checked.format) + ')',
            'ARRAY BYTE ' + name + '[] = {'];
        for (var i = 0; i < checked.count; i++) {
            var last = i === checked.count - 1;
            lines.push('    ' + charBytes(bytes, i) + (last ? ' ' : ', ') + '// $' + hex2(checked.start + i));
        }
        lines.push('};');
        return lines.join('\n') + '\n';
    }

    var DEFCHR_OUT = /^(\d+)DEFCHR\$\((\d+)\)=HEXCHR\$\("([0-9A-Fa-f]{48})"\)$/;
    // A whole line that only sets one character from hex digits: DEFCHR$(65)=HEXCHR$("...") or
    // DEFCHR$(&H41)=..., in any case and spacing (the X1 BASIC Editor takes spaces between digits)
    var DEFCHR_LINE = /^[ \t]*DEFCHR\$[ \t]*\([ \t]*(?:(\d+)|&H([0-9A-F]+))[ \t]*\)[ \t]*=[ \t]*HEXCHR\$[ \t]*\([ \t]*"[0-9A-F \t]*"[ \t]*\)[ \t]*$/i;

    // DEFCHR TOOL's BAS (ASCII) text -> its lines, checked against the request: one
    // DEFCHR$(code)=HEXCHR$("48 digits") a character, numbered lineStart, lineStart+lineStep, ...
    function huBasicLines(text, checked) {
        var lines = String(text).split(/\r\n|\r|\n/).filter(function(line) { return line !== ''; });
        var bad = fail('invalid', '出力の DEFCHR$ の行が、指定（行番号・文字コード）と合いません。');
        if (lines.length !== checked.count) return bad;
        var out = [];
        for (var i = 0; i < lines.length; i++) {
            var m = DEFCHR_OUT.exec(lines[i]);
            if (!m || Number(m[1]) !== checked.hubasic.lineStart + i * checked.hubasic.lineStep ||
                Number(m[2]) !== checked.start + i) return bad;
            out.push({ number: Number(m[1]), code: Number(m[2]), text: lines[i] });
        }
        return { ok: true, lines: out };
    }

    function ascii(text) {
        var out = [];
        for (var i = 0; i < text.length; i++) out.push(text.charCodeAt(i));
        return out;
    }

    function latin1(bytes) {
        var s = '';
        for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return s;
    }

    // The program's lines: { content, eol } (bytes, kept as they are) with the line number, or null
    // for a line without one (blank, or not a program line); the line ends as HuBASIC reads them
    function programLines(bytes) {
        var lines = [];
        var start = 0;
        while (start < bytes.length) {
            var end = start;
            while (end < bytes.length && bytes[end] !== 0x0D && bytes[end] !== 0x0A) end++;
            var eolEnd = end === bytes.length ? end : (bytes[end] === 0x0D && bytes[end + 1] === 0x0A ? end + 2 : end + 1);
            var content = bytes.slice(start, end);
            lines.push({ content: content, eol: bytes.slice(end, eolEnd), number: lineNumberOf(content) });
            start = eolEnd;
        }
        return lines;
    }

    function lineNumberOf(content) {
        var i = 0;
        while (i < content.length && (content[i] === 0x20 || content[i] === 0x09)) i++;
        var digits = '';
        while (i < content.length && content[i] >= 0x30 && content[i] <= 0x39) digits += String.fromCharCode(content[i++]);
        return digits ? Number(digits) : null;
    }

    function isBlank(content) {
        return content.every(function(b) { return b === 0x20 || b === 0x09; });
    }

    // Is the program line, after its line number, DEFCHR$ for character `code` and nothing else?
    function setsSameCharacter(content, code) {
        var text = latin1(content).replace(/^[ \t]*\d+/, '');
        var m = DEFCHR_LINE.exec(text);
        return !!m && (m[1] !== undefined ? Number(m[1]) : parseInt(m[2], 16)) === code;
    }

    // Merges DEFCHR TOOL's lines into the HuBASIC program (X1 bytes) by line number:
    // { ok, bytes, added, replaced } or a conflict, which leaves the program as it is.
    // A program line with the same number is replaced when it is the same character's DEFCHR$;
    // any other line there is a conflict. A new line goes before the first line with a greater
    // number, or after the last non-blank line. Lines not touched keep their bytes and line ends.
    function mergeHuBasic(programBytes, newLines) {
        var bytes = Array.prototype.slice.call(programBytes);
        var eof = bytes.indexOf(0x1A);
        var tail = eof < 0 ? [] : bytes.slice(eof);
        var lines = programLines(eof < 0 ? bytes : bytes.slice(0, eof));

        var conflicts = [];
        newLines.forEach(function(line) {
            var clash = lines.some(function(old) {
                return old.number === line.number && !setsSameCharacter(old.content, line.code);
            });
            if (clash) conflicts.push(line.number);
        });
        if (conflicts.length) {
            var shown = conflicts.slice(0, 5).join(', ') + (conflicts.length > 5 ? ' ほか ' + (conflicts.length - 5) + ' 行' : '');
            return fail('conflict', '行番号 ' + shown + ' に別の行があるので、何も変えていません。開始行かステップを変えてください。');
        }

        var newline = [0x0D, 0x0A];
        for (var k = 0; k < lines.length; k++) {
            if (lines[k].eol.length) { newline = lines[k].eol; break; }
        }
        var lastText = -1;
        lines.forEach(function(old, index) { if (!isBlank(old.content)) lastText = index; });

        // Where each new line goes: in place of the first program line with its number, or
        // before the program line at an index (lines.length: at the end)
        var before = {};
        var replaceAt = {};
        var replaced = 0;
        newLines.forEach(function(line) {
            var first = -1;
            for (var j = 0; j < lines.length; j++) {
                if (lines[j].number === line.number) { first = j; break; }
            }
            if (first >= 0) {
                replaceAt[first] = line;
                replaced++;
                return;
            }
            var at = lastText + 1;
            for (j = 0; j < lines.length; j++) {
                if (lines[j].number !== null && lines[j].number > line.number) { at = j; break; }
            }
            (before[at] = before[at] || []).push(line);
        });
        var replacedNumbers = {};
        Object.keys(replaceAt).forEach(function(index) { replacedNumbers[replaceAt[index].number] = true; });

        var out = [];
        var open = false;      // the last line written has no line end yet
        function put(content, eol) {
            if (open) Array.prototype.push.apply(out, newline);
            Array.prototype.push.apply(out, content);
            Array.prototype.push.apply(out, eol);
            open = eol.length === 0;
        }
        function putNew(line) { put(ascii(line.text), newline); }
        for (var n = 0; n <= lines.length; n++) {
            (before[n] || []).forEach(putNew);
            if (n === lines.length) break;
            if (replaceAt[n]) put(ascii(replaceAt[n].text), lines[n].eol.length ? lines[n].eol : newline);
            else if (!(lines[n].number !== null && replacedNumbers[lines[n].number])) put(lines[n].content, lines[n].eol);
        }
        return { ok: true, bytes: new Uint8Array(out.concat(tail)), added: newLines.length - replaced, replaced: replaced };
    }

    // The text to insert or copy, from the Blob's text or bytes: { ok, text } or a failure; for
    // HuBASIC also { lines } to merge (the text is the lines, for the clipboard).
    // slangSource is the SLANG program at the moment of inserting (for the array name).
    function build(checked, planned, data, slangSource) {
        if (planned.editor === 'hubasic') {
            var parsed = huBasicLines(data, checked);
            if (!parsed.ok) return parsed;
            return {
                ok: true,
                lines: parsed.lines,
                text: parsed.lines.map(function(line) { return line.text; }).join('\n') + '\n'
            };
        }
        if (planned.read === 'text') {
            var text = normalizeText(data);
            return text === null ? fail('invalid', '出力が空です。') : { ok: true, text: text };
        }
        var bytes = data;
        if (!bytes || bytes.length !== checked.count * BYTES_PER_CHAR) {
            return fail('invalid', '出力の長さが範囲と合いません（1 文字 24 バイト）。');
        }
        if (planned.editor === 'slang') {
            return { ok: true, text: slangArray(bytes, checked, slangArrayName(slangSource, checked.start)) };
        }
        return { ok: true, text: dbBlock(bytes, checked) };
    }

    function charsNote(checked) {
        return checked.count + ' 文字分（$' + hex2(checked.start) + (checked.count > 1 ? '〜$' + hex2(checked.end) : '') + '）';
    }

    // The message DEFCHR TOOL shows (and X1Pen's status line) after inserting. `line` is the line
    // the text starts at (ASM, SLANG) or the merge result (HuBASIC)
    function successMessage(checked, planned, line) {
        if (planned.editor === 'hubasic') {
            var last = checked.hubasic.lineStart + (checked.count - 1) * checked.hubasic.lineStep;
            return 'HuBASIC タブの ' + checked.hubasic.lineStart + (checked.count > 1 ? '〜' + last : '') + ' 行に ' +
                charsNote(checked) + 'を入れました' + (line.replaced ? '（' + line.replaced + ' 行は置き換え）' : '') +
                '。HuBASIC への挿入は Ctrl+Z では戻せません。';
        }
        var where = (planned.editor === 'slang' ? 'SLANG' : 'ASM') + ' タブの ' + line + ' 行目に ';
        return where + charsNote(checked) + 'を入れました。' +
            (planned.editor === 'slang' && planned.read === 'bytes' ? '配列は関数の外に置いてください。' : '');
    }

    // The message after copying: what the clipboard now holds
    function copyMessage(checked, planned) {
        var what = planned.editor === 'hubasic' ? 'HuBASIC の DEFCHR$ の行'
            : planned.read === 'text' ? (planned.editor === 'slang' ? 'SLANG' : 'ASM') + ' 向けの文'
            : planned.editor === 'slang' ? 'SLANG の配列' : 'ASM の DB';
        return charsNote(checked) + 'を ' + what + (/[A-Za-z]$/.test(what) ? ' ' : '') + 'でクリップボードにコピーしました。';
    }

    root.X1PenPcgExport = {
        checkRequest: checkRequest,
        plan: plan,
        build: build,
        normalizeText: normalizeText,
        slangArrayName: slangArrayName,
        mergeHuBasic: mergeHuBasic,
        successMessage: successMessage,
        copyMessage: copyMessage
    };
})(typeof window !== 'undefined' ? window : globalThis);

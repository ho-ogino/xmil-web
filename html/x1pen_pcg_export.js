// x1pen_pcg_export.js — what X1Pen inserts for DEFCHR TOOL's "X1Pen に挿入" (the PCG tab)
// DEFCHR TOOL (defchrtool/, imported by scripts/import-defchrtool.mjs) calls X1Host.exportPCG with
// the file it would save (its X1HOST.md, version 1). This file checks such a request and builds the
// text for the target editor; x1pen.js reads the Blob and inserts the text at the cursor.
// Target and format, as agreed with DEFCHR TOOL:
//   fuzzybasic / asm -> the ASM tab: asm, asm3 and bas (ASCII) text as is; bin, bin3 as DB lines
//   slang            -> the SLANG tab: the same texts as is; bin, bin3 as an ARRAY BYTE
//   hubasic          -> not yet (DEFCHR$ lines merged by line number come in a later change)
//   image, bas (binary) -> nowhere
// Bytes keep the order DEFCHR TOOL wrote them in: bin3 is rows of B,R,G, bin is B[8],R[8],G[8].

(function(root) {
    'use strict';

    var TARGETS = ['fuzzybasic', 'asm', 'slang', 'hubasic'];
    var FORMATS = ['image', 'bin', 'bin3', 'bas', 'asm', 'asm3'];
    var MAX_BLOB_BYTES = 1024 * 1024;
    var BYTES_PER_CHAR = 24;

    function fail(code, message) {
        return { ok: false, code: code, message: message };
    }

    function hex2(n) {
        return ('0' + n.toString(16).toUpperCase()).slice(-2);
    }

    function isCode(n) {
        return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 255;
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
        return {
            ok: true,
            target: request.target,
            format: request.format,
            basFormat: request.format === 'bas' ? request.basFormat : undefined,
            start: request.start,
            end: request.end,
            count: request.end - request.start + 1
        };
    }

    // Where a checked request goes and how its Blob is read: { ok, editor: 'asm'|'slang', read: 'text'|'bytes' }
    function plan(checked) {
        if (checked.target === 'hubasic') {
            return fail('unsupported', 'X1Pen はまだ HuBASIC への挿入に対応していません。ファイル保存（BAS・ASCII）を使ってください。');
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

    // The text to insert, from the Blob's text or bytes: { ok, text } or a failure.
    // slangSource is the SLANG program at the moment of inserting (for the array name).
    function build(checked, planned, data, slangSource) {
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

    // The message DEFCHR TOOL shows (and X1Pen's status line) after inserting
    function successMessage(checked, planned, line) {
        var where = (planned.editor === 'slang' ? 'SLANG' : 'ASM') + ' タブの ' + line + ' 行目に ';
        var what = checked.count + ' 文字分（$' + hex2(checked.start) +
            (checked.count > 1 ? '〜$' + hex2(checked.end) : '') + '）を入れました。';
        return where + what + (planned.editor === 'slang' && planned.read === 'bytes' ? '配列は関数の外に置いてください。' : '');
    }

    root.X1PenPcgExport = {
        checkRequest: checkRequest,
        plan: plan,
        build: build,
        normalizeText: normalizeText,
        slangArrayName: slangArrayName,
        successMessage: successMessage
    };
})(typeof window !== 'undefined' ? window : globalThis);

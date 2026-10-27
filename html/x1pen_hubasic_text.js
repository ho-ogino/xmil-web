// x1pen_hubasic_text.js — the HuBASIC program as text, for storage and the automation API
// The HuBASIC tab keeps the program in X1 bytes (X1 BASIC Editor). Outside the editor it is a
// Unicode string written with the editor's codec (x1basic/src/codec.js, global X1):
// ASCII as is, $A1-$DF as half-width kana, named symbols as \{name}, other bytes as \xHH,
// newlines as \n, and $5C as ¥ (X1's own glyph for $5C; the codec's clipboard form is \\).
// Reading accepts everything X1.parseEscapes accepts: \xHH, \{name}, \\, ¥, kana, hiragana, ♥ ...

(function(root) {
    'use strict';

    var NEWLINE = '\r\n';

    function codec() {
        if (!root.X1 || typeof root.X1.parseEscapes !== 'function') {
            throw new Error('X1 BASIC Editor codec (x1basic/src/codec.js) is not loaded');
        }
        return root.X1;
    }

    // X1 bytes -> text. Every byte reads back unchanged with fromText, except that CR, LF and
    // CRLF all become \n (and come back as CRLF).
    function toText(bytes) {
        // clipboardText writes only \\, \xHH and \{name} with a backslash, so \\ is always $5C
        return codec().clipboardText(bytes).replace(/\\\\/g, '¥');
    }

    // Text -> X1 bytes. Throws for characters the X1 cannot show; nothing is changed then.
    function fromText(text) {
        return new Uint8Array(codec().parseEscapes(String(text), NEWLINE));
    }

    // Text saved by the former plain HuBASIC tab -> X1 bytes. Escapes are not interpreted (a
    // backslash is $5C). Characters the X1 cannot show become '?' and are counted.
    function fromLegacyText(text) {
        var X1 = codec();
        var out = [];
        var replaced = 0;
        Array.from(String(text).replace(/\r\n|\r/g, '\n')).forEach(function(ch) {
            var bytes;
            try {
                bytes = X1.encodeInput(ch, NEWLINE);
            } catch (e) {
                bytes = [0x3F];
                replaced++;
            }
            for (var i = 0; i < bytes.length; i++) out.push(bytes[i]);
        });
        return { bytes: new Uint8Array(out), replaced: replaced };
    }

    root.X1PenHuBasicText = {
        toText: toText,
        fromText: fromText,
        fromLegacyText: fromLegacyText
    };
})(typeof window !== 'undefined' ? window : globalThis);

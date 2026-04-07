// x1pen_slang_lang.js — SLANG syntax highlighting for CodeMirror 6
// Uses StreamLanguage (CodeMirror 5 compatible stream parser)

import { StreamLanguage } from '@codemirror/language';

var SLANG_KEYWORDS = new Set([
    'VAR','BYTE','WORD','FLOAT','ARRAY','CONST','MACHINE','ASM',
    'IF','THEN','ELSE','ELIF','ELSEIF','EF','ENDIF',
    'WHILE','DO','WEND','REPEAT','UNTIL',
    'CASE','OTHERS','OF','LOOP',
    'FOR','TO','DOWNTO','NEXT',
    'EXIT','CONTINUE','RETURN','GOTO','BEGIN','END',
    'ORG','WORK','OFFSET','MODULE',
    'PRINT','CODE','HIGH','LOW',
    'NOT','CPL','MOD','AND','OR','XOR',
]);

var SLANG_BUILTINS = new Set([
    'TRUE','FALSE',
    'MEM','MEMW','PORT','PORTW','SOS','SOSW',
    'BEEP','STOP','LOCATE','INKEY','INPUT','GETL','GETLIN','LINPUT',
    'WIDTH','SCREEN','PRMODE','BIT','SET','RESET',
    'ABS','SEX','SGN','RND','VTOS','GETREG','CALL',
]);

var SLANG_STRFUNCS = new Set([
    'FORM$','DECI$','PN$','HEX2$','HEX4$','MSG$','MSX$',
    'STR$','CHR$','SPC$','CR$','TAB$','FL$',
]);

var slangParser = {
    name: 'slang',
    startState: function() {
        return { inString: false, inBlockComment: 0, inAsmBlock: false };
    },
    token: function(stream, state) {
        // Block comment (* ... *)
        if (state.inBlockComment > 0) {
            while (!stream.eol()) {
                if (stream.match('*)')) { state.inBlockComment--; return 'comment'; }
                if (stream.match('(*')) { state.inBlockComment++; return 'comment'; }
                stream.next();
            }
            return 'comment';
        }

        // #ASM block
        if (state.inAsmBlock) {
            if (stream.match(/^#END\b/i) || stream.match(/^#ENDIF\b/i)) {
                state.inAsmBlock = false;
                return 'meta';
            }
            stream.skipToEnd();
            return 'string';
        }

        // String
        if (state.inString) {
            if (stream.skipTo('"')) { stream.next(); state.inString = false; }
            else { stream.skipToEnd(); }
            return 'string';
        }

        // Whitespace
        if (stream.eatSpace()) return null;

        // Line comment //
        if (stream.match('//')) { stream.skipToEnd(); return 'comment'; }

        // Block comment /* ... */
        if (stream.match('/*')) {
            while (!stream.eol()) {
                if (stream.match('*/')) return 'comment';
                stream.next();
            }
            return 'comment';
        }

        // Block comment (* ... *)
        if (stream.match('(*')) {
            state.inBlockComment = 1;
            return 'comment';
        }

        // Preprocessor
        if (stream.match(/^#(IF|ELSE|END|ENDIF|INCLUDE|ASM|MODULE)\b/i)) {
            var m = stream.current().toUpperCase();
            if (m === '#ASM') state.inAsmBlock = true;
            return 'meta';
        }

        // String literal
        if (stream.match('"')) {
            state.inString = true;
            if (stream.skipTo('"')) { stream.next(); state.inString = false; }
            else { stream.skipToEnd(); }
            return 'string';
        }

        // Char literal
        if (stream.match("'")) {
            if (stream.skipTo("'")) stream.next();
            return 'string';
        }

        // Hex number $xx or 0xNN
        if (stream.match(/^\$[0-9A-Fa-f]+/) || stream.match(/^0x[0-9A-Fa-f]+/i)) return 'number';

        // Number with suffix (FFh, 1100b)
        if (stream.match(/^[0-9][0-9A-Fa-f]*[Hh]\b/)) return 'number';
        if (stream.match(/^[01]+[Bb]\b/)) return 'number';

        // Decimal / float
        if (stream.match(/^[0-9]+(\.[0-9]+)?/)) return 'number';

        // Dot operators .>=. etc
        if (stream.match(/^\.[<>=!*\/]+\.?/)) return 'operator';
        if (stream.match(/^\.MOD\.?/i)) return 'operator';

        // String functions (FORM$, etc)
        if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*\$/)) {
            if (SLANG_STRFUNCS.has(stream.current().toUpperCase())) return 'keyword';
            return null;
        }

        // Identifiers and keywords
        if (stream.match(/^[@^]?[A-Za-z_\u3041-\u3096\u30A1-\u30FA\u3400-\u9FFF][A-Za-z0-9_\u3041-\u3096\u30A1-\u30FA\u3400-\u9FFF]*/)) {
            var word = stream.current().toUpperCase();
            if (SLANG_KEYWORDS.has(word)) return 'keyword';
            if (SLANG_BUILTINS.has(word)) return 'variableName';
            return null;
        }

        // Operators
        if (stream.match(/^[+\-*\/=<>!&|^~%]+/) || stream.match(/^[?:;,]/)) return 'operator';

        // Brackets
        if (stream.match(/^[\[\](){}\uff62\uff63]/)) return 'bracket';

        stream.next();
        return null;
    }
};

export var slangLanguage = StreamLanguage.define(slangParser);

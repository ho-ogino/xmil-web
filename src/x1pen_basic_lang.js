// x1pen_basic_lang.js — FuzzyBASIC syntax highlighting for CodeMirror 6
// Uses StreamLanguage (CodeMirror 5 compatible stream parser)

import { StreamLanguage } from '@codemirror/language';

// FuzzyBASIC keywords (from x1pen_tokenizer.js RSVTBL)
var BASIC_KEYWORDS = new Set([
    // Statements (0xFF)
    'AUTO','BEEP','BLOAD','BOOT','BOX','BROFF','BRON','BSAVE','BYE',
    'CALL','CHAIN','CHECK','CIRCLE','CLR','COLD','CLS','CURSOR',
    'DEC','DELETE','DEVICE','DEVI','DEVO','DIR','DOT',
    'ELSE','END','FILES','FOR','FRESET','FSET',
    'GOTO','GOSUB','GRAPH',
    'IF','INC','INPUT','INKEY',
    'KILL',
    'LDIR','LDDR','LET','LIMIT','LINPUT','LINE','LOCATE','LOCAL',
    'MERGE','MEM',
    'OUT','ON',
    'PAUSE','POKE','PRINT','PRMODE','PROC','PULL','PUSH',
    'RANDOMIZE','REPEAT','RESET','RETURN',
    'SET','STOP','STOFF','STON','SWAP',
    'TAB','TILE','TRIANGLE','MAGIC','COLOR','PCGDEF','TCOLOR','SOUND',
    'THEN','TO','TRANS','TEXT',
    'UNTIL',
    'WAIT','WIDTH','WINDOW','WHILE','WOUT','WPOKE','WEND',
    'NEXT','REM','DATA','READ','RESTORE','DIM','STEP',
    // Commands (0xFE)
    'APPEND','CONT','EDIT','ERMODE','LOAD','NEW','RECOVER','RENUM',
    'RUN','SAVE','SEARCH','VLIST','VSTACK',
    // Functions (0xFD) — treated as keywords for highlighting
    'ADR','BIT','CHARA','CODE','CP','CURX','CURY','DSK',
    'EX','FLASH','FUNC','GET','HIGH','INKEY','INP','INSTR',
    'LEN','LINADR','LOW','MIRROR','MAX','MULH','MOD','MSP','MSX',
    'NEST','NOT','NOW','PARITY','PEEK','POINT','POP',
    'RND','ROTL','ROTR','ROTLD','ROTRD',
    'SIZE','SQR','SQU','SUM',
    'TABLE','TXBEGIN','TXEND','TOP',
    'USR','VAL','VEADR','VSADR','VERSION','WINP','WPEEK','ZERO',
    'COS','SIN','PAI',
    // Print functions (0xFB)
    'BIN','BINL','CHR$','DECI','HEX2','HEX4','LEFT$','RIGHT$',
    'MSG','PN','SPC','STRING','STR',
]);

// Compound keywords (matched first)
var BASIC_COMPOUND = ['END IF', 'RET FUNC', 'RET PROC'];
var COMPOUND_REGEXES = BASIC_COMPOUND.map(function(kw) {
    return new RegExp('^' + kw + '\\b', 'i');
});

var BASIC_OPERATORS = new Set(['AND', 'OR', 'XOR']);

var fuzzyBasicParser = {
    name: 'fuzzybasic',
    startState: function() {
        return { inString: false };
    },
    token: function(stream, state) {
        if (state.inString) {
            if (stream.skipTo('"')) {
                stream.next();
                state.inString = false;
            } else {
                stream.skipToEnd();
            }
            return 'string';
        }

        // Line number at start of line
        if (stream.sol() && stream.match(/^\d+/)) {
            return 'number';
        }

        // Comment (')
        if (stream.match("'")) {
            stream.skipToEnd();
            return 'comment';
        }

        // REM comment
        if (stream.match(/^REM\b/i)) {
            stream.skipToEnd();
            return 'comment';
        }

        // String
        if (stream.match('"')) {
            state.inString = true;
            if (stream.skipTo('"')) {
                stream.next();
                state.inString = false;
            } else {
                stream.skipToEnd();
            }
            return 'string';
        }

        // Compound keywords (END IF, RET FUNC, RET PROC)
        for (var i = 0; i < COMPOUND_REGEXES.length; i++) {
            if (stream.match(COMPOUND_REGEXES[i])) return 'keyword';
        }

        // Label (\...\)
        if (stream.match(/^\\.+\\/)) {
            return 'labelName';
        }

        // Hex number &Hxx or $xx
        if (stream.match(/^&H[0-9A-Fa-f]+/i)) return 'number';
        if (stream.match(/^\$[0-9A-Fa-f]+/)) return 'number';

        // Binary &Bnnnn or &nnnn
        if (stream.match(/^&B[01]+/i)) return 'number';
        if (stream.match(/^&[01]+/)) return 'number';

        // Word (keyword, function, variable)
        if (stream.match(/^[A-Za-z_][A-Za-z0-9_$@^]*/)) {
            var word = stream.current().toUpperCase();
            // USR^A..H, FN^A..H (exact match only)
            if (/^(USR\^[A-H]|USR@?|FN\^[A-H])$/.test(word)) return 'keyword';
            if (BASIC_KEYWORDS.has(word)) return 'keyword';
            if (BASIC_OPERATORS.has(word)) return 'operator';
            return null;
        }

        // Decimal number
        if (stream.match(/^\d+/)) {
            return 'number';
        }

        // Operators
        if (stream.match(/^[+\-*\/=<>!&|^~]+/)) {
            return 'operator';
        }

        stream.next();
        return null;
    }
};

export var fuzzyBasicLanguage = StreamLanguage.define(fuzzyBasicParser);

// BASIC AUTO line number: Enter at end of a numbered line inserts next number
export function basicAutoLineNumber(view) {
    var state = view.state;
    var sel = state.selection.main;

    // Only when no selection and cursor at end of line
    if (sel.from !== sel.to) return false;
    var cursor = sel.head;
    var currentLine = state.doc.lineAt(cursor);
    if (cursor !== currentLine.to) return false;

    // Current line must start with a line number
    var match = currentLine.text.match(/^(\d+)\s?(.*)/);
    if (!match) return false;

    var currentNum = parseInt(match[1], 10);
    var body = match[2];

    // Line number only (no body) → clear the line number (exit AUTO)
    if (!body.trim()) {
        view.dispatch({
            changes: { from: currentLine.from, to: currentLine.to, insert: '' }
        });
        return true;
    }

    // Check next line for existing line number
    var nextLineNum = null;
    if (currentLine.number < state.doc.lines) {
        var nextLine = state.doc.line(currentLine.number + 1);
        var nextMatch = nextLine.text.match(/^(\d+)/);
        if (nextMatch) nextLineNum = parseInt(nextMatch[1], 10);
    }

    // Calculate new line number
    var newNum;
    if (nextLineNum !== null) {
        // Between lines: midpoint
        newNum = Math.floor((currentNum + nextLineNum) / 2);
        if (newNum <= currentNum || newNum >= nextLineNum) {
            return false; // No room → normal Enter
        }
    } else {
        // At end: +10
        newNum = currentNum + 10;
        if (newNum > 65535) return false;
    }

    var insertText = '\n' + newNum + ' ';
    view.dispatch({
        changes: { from: cursor, insert: insertText },
        selection: { anchor: cursor + insertText.length }
    });
    return true;
}

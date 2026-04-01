// x1pen_slang_compiler.js — SLANG Compiler for X1Pen
// Ported from C# (SLANGCompiler.Core) to JavaScript
// Lazy-loaded: window.X1PenSlangCompiler = { compile: ... }

(function() {
    'use strict';

    // ================================================================
    // TokenKind
    // ================================================================
    var TK = {
        // Special
        EOF: 'EOF', Error: 'Error',
        // Literals
        IntegerLiteral: 'IntegerLiteral', FloatLiteral: 'FloatLiteral',
        StringLiteral: 'StringLiteral', CharLiteral: 'CharLiteral',
        // Identifier
        Identifier: 'Identifier',
        // Keywords - declarations
        Var: 'Var', Byte: 'Byte', Word: 'Word', Float: 'Float',
        Array: 'Array', Const: 'Const', Machine: 'Machine', Asm: 'Asm',
        // Keywords - control flow
        If: 'If', Then: 'Then', Else: 'Else', Elif: 'Elif', EndIf: 'EndIf',
        While: 'While', Do: 'Do', Wend: 'Wend',
        Repeat: 'Repeat', Until: 'Until',
        Case: 'Case', Others: 'Others', Of: 'Of', Loop: 'Loop',
        For: 'For', To: 'To', DownTo: 'DownTo', Next: 'Next',
        Exit: 'Exit', Continue: 'Continue', Return: 'Return',
        Goto: 'Goto', Begin: 'Begin', End: 'End',
        // Keywords - special
        Org: 'Org', Work: 'Work', Offset: 'Offset', Module: 'Module',
        Print: 'Print', Code: 'Code', High: 'High', Low: 'Low',
        Not: 'Not', Cpl: 'Cpl', Mod: 'Mod',
        // Keywords - bitwise
        And: 'And', Or: 'Or', Xor: 'Xor', Ef: 'Ef',
        // Operators
        Plus: 'Plus', Minus: 'Minus', Star: 'Star', Slash: 'Slash',
        Percent: 'Percent', Ampersand: 'Ampersand', Pipe: 'Pipe',
        Caret: 'Caret', Tilde: 'Tilde', Exclamation: 'Exclamation',
        Eq: 'Eq', EqEq: 'EqEq', NotEq: 'NotEq',
        Lt: 'Lt', Gt: 'Gt', Le: 'Le', Ge: 'Ge',
        // Signed operators
        SignedLt: 'SignedLt', SignedGt: 'SignedGt',
        SignedLe: 'SignedLe', SignedGe: 'SignedGe',
        SignedMul: 'SignedMul', SignedDiv: 'SignedDiv', SignedMod: 'SignedMod',
        SignedShl: 'SignedShl', SignedShr: 'SignedShr',
        // Shift / Logic
        Shl: 'Shl', Shr: 'Shr', LogAnd: 'LogAnd', LogOr: 'LogOr',
        // Compound assignment
        PlusPlus: 'PlusPlus', MinusMinus: 'MinusMinus',
        PlusEq: 'PlusEq', MinusEq: 'MinusEq',
        StarEq: 'StarEq', SlashEq: 'SlashEq',
        Question: 'Question',
        // Delimiters
        LParen: 'LParen', RParen: 'RParen',
        LBracket: 'LBracket', RBracket: 'RBracket',
        LBrace: 'LBrace', RBrace: 'RBrace',
        LAngleBracket: 'LAngleBracket', RAngleBracket: 'RAngleBracket',
        Comma: 'Comma', Colon: 'Colon', Semicolon: 'Semicolon',
        // Context-dependent
        ArrayBracketOpen: 'ArrayBracketOpen',
        // String functions
        StringFunc: 'StringFunc',
        // Preprocessor
        PreprocInclude: 'PreprocInclude', PreprocIf: 'PreprocIf',
        PreprocElse: 'PreprocElse', PreprocEnd: 'PreprocEnd',
        PreprocAsm: 'PreprocAsm',
        // Inline assembly
        Plain: 'Plain',
    };

    // Keyword range for isKeyword check
    var KEYWORD_KINDS = new Set([
        TK.Var, TK.Byte, TK.Word, TK.Float, TK.Array, TK.Const, TK.Machine, TK.Asm,
        TK.If, TK.Then, TK.Else, TK.Elif, TK.EndIf,
        TK.While, TK.Do, TK.Wend, TK.Repeat, TK.Until,
        TK.Case, TK.Others, TK.Of, TK.Loop,
        TK.For, TK.To, TK.DownTo, TK.Next,
        TK.Exit, TK.Continue, TK.Return, TK.Goto, TK.Begin, TK.End,
        TK.Org, TK.Work, TK.Offset, TK.Module,
        TK.Print, TK.Code, TK.High, TK.Low,
        TK.Not, TK.Cpl, TK.Mod,
        TK.And, TK.Or, TK.Xor, TK.Ef,
    ]);

    // ================================================================
    // SourceLocation / SourceSpan
    // ================================================================
    function SourceLocation(fileName, line, column) {
        return { fileName: fileName, line: line, column: column };
    }
    SourceLocation.Unknown = SourceLocation('<unknown>', 0, 0);

    function SourceSpan(start, end) {
        return { start: start, end: end };
    }
    SourceSpan.Unknown = SourceSpan(SourceLocation.Unknown, SourceLocation.Unknown);

    function spanToString(span) {
        var s = span.start;
        return s.fileName + ':' + s.line + ':' + s.column;
    }

    // ================================================================
    // Token
    // ================================================================
    function Token(kind, text, span, value) {
        return {
            kind: kind,
            text: text,
            span: span,
            value: value !== undefined ? value : null,
            get intValue() {
                return typeof this.value === 'number' ? this.value | 0 : 0;
            },
            get floatValue() {
                return typeof this.value === 'number' ? this.value : 0.0;
            },
            get stringValue() {
                return typeof this.value === 'string' ? this.value : this.text;
            },
            get isKeyword() {
                return KEYWORD_KINDS.has(this.kind);
            },
        };
    }

    // ================================================================
    // DiagnosticBag
    // ================================================================
    var DiagnosticSeverity = { Info: 'Info', Warning: 'Warning', Error: 'Error' };

    function Diagnostic(severity, message, span) {
        return { severity: severity, message: message, span: span };
    }

    function diagnosticToString(d) {
        var prefix = d.severity === DiagnosticSeverity.Error ? 'error' :
                     d.severity === DiagnosticSeverity.Warning ? 'warning' : 'info';
        return spanToString(d.span) + ': ' + prefix + ': ' + d.message;
    }

    function DiagnosticBag() {
        var bag = {
            _diagnostics: [],
            MAX_ERRORS: 30,
            get diagnostics() { return this._diagnostics; },
            get hasErrors() {
                for (var i = 0; i < this._diagnostics.length; i++) {
                    if (this._diagnostics[i].severity === DiagnosticSeverity.Error) return true;
                }
                return false;
            },
            get errorCount() {
                var c = 0;
                for (var i = 0; i < this._diagnostics.length; i++) {
                    if (this._diagnostics[i].severity === DiagnosticSeverity.Error) c++;
                }
                return c;
            },
            get hasReachedMaxErrors() { return this.errorCount >= this.MAX_ERRORS; },
            report: function(severity, message, span) {
                this._diagnostics.push(Diagnostic(severity, message, span || SourceSpan.Unknown));
            },
            error: function(message, span) {
                if (this.hasReachedMaxErrors) return;
                this.report(DiagnosticSeverity.Error, message, span);
            },
            warning: function(message, span) {
                this.report(DiagnosticSeverity.Warning, message, span);
            },
            info: function(message, span) {
                this.report(DiagnosticSeverity.Info, message, span);
            },
        };
        return bag;
    }

    // ================================================================
    // LabelUtils
    // ================================================================
    function sanitizeLabel(name) {
        var safe = true;
        for (var i = 0; i < name.length; i++) {
            var c = name.charCodeAt(i);
            if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95)) {
                safe = false; break;
            }
        }
        if (safe) return name;

        var sb = '';
        for (var i = 0; i < name.length; i++) {
            var ch = name[i];
            var cc = name.charCodeAt(i);
            if (ch === '@') sb += '_AT_';
            else if (ch === '^') sb += '.';
            else if ((cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122) || (cc >= 48 && cc <= 57) || cc === 95)
                sb += ch;
            else
                sb += '_U' + cc.toString(16).toUpperCase().padStart(4, '0') + '_';
        }
        return sb;
    }

    function userVarLabel(name) { return '_V_' + sanitizeLabel(name); }
    function staticVarLabel(funcName, varName) {
        return '_V_' + sanitizeLabel(funcName) + '_' + sanitizeLabel(varName);
    }
    function userLabel(name) { return '_LBL_' + sanitizeLabel(name); }

    // f24 (24-bit float) conversion
    function convertToF24(value) {
        if (value === 0) return [0, 0, 0];
        var sign = 0;
        if (value < 0) { sign = 1; value = -value; }
        if (!isFinite(value)) return [0, 0, 127 + (sign << 7)];

        var exp = 0;
        while (value < 1) { exp--; value += value; }
        while (value >= 2) { exp++; value /= 2; }
        if (exp > 63) return [0, 0, 127 + (sign << 7)];
        if (exp < -62) return [0, 0, 0];

        var a = (exp + 63 + (sign << 7)) & 0xFF;
        value -= 1.0;
        value *= 256;
        var h = value | 0;
        value -= h;
        value *= 256;
        value += 0.5;
        var l = value | 0;
        if (l === 0 && value >= 256) { h++; if (h === 256) { h = 0; a++; } }
        return [l & 0xFF, h & 0xFF, a & 0xFF];
    }

    // StringEncoder: Unicode → Shift-JIS DB args for Z80
    // Simplified version: ASCII-only for now, non-ASCII chars encoded as hex
    function toAsmDbArgs(text) {
        var allAscii = true;
        for (var i = 0; i < text.length; i++) {
            var c = text.charCodeAt(i);
            if (c < 0x20 || c >= 0x7F || c === 0x22) { allAscii = false; break; }
        }
        if (allAscii) return '"' + text + '"';

        var parts = [];
        var strBuf = '';
        for (var i = 0; i < text.length; i++) {
            var c = text.charCodeAt(i);
            if (c >= 0x20 && c < 0x7F && c !== 0x22) {
                strBuf += text[i];
            } else {
                if (strBuf.length > 0) { parts.push('"' + strBuf + '"'); strBuf = ''; }
                parts.push('$' + (c & 0xFF).toString(16).toUpperCase().padStart(2, '0'));
            }
        }
        if (strBuf.length > 0) parts.push('"' + strBuf + '"');
        return parts.join(',');
    }

    // ================================================================
    // Lexer
    // ================================================================

    // Keyword table (case-insensitive)
    var KEYWORDS = {};
    (function() {
        var kw = {
            VAR: TK.Var, BYTE: TK.Byte, WORD: TK.Word, ARRAY: TK.Array,
            CONST: TK.Const, MACHINE: TK.Machine,
            IF: TK.If, THEN: TK.Then, ELSE: TK.Else, ELIF: TK.Elif, ELSEIF: TK.Elif,
            EF: TK.Ef, ENDIF: TK.EndIf,
            WHILE: TK.While, DO: TK.Do, WEND: TK.Wend,
            REPEAT: TK.Repeat, UNTIL: TK.Until,
            CASE: TK.Case, OTHERS: TK.Others, OF: TK.Of, LOOP: TK.Loop,
            FOR: TK.For, TO: TK.To, DOWNTO: TK.DownTo, NEXT: TK.Next,
            EXIT: TK.Exit, CONTINUE: TK.Continue, RETURN: TK.Return,
            GOTO: TK.Goto, BEGIN: TK.Begin, END: TK.End,
            ORG: TK.Org, WORK: TK.Work, OFFSET: TK.Offset,
            PRINT: TK.Print, CODE: TK.Code, HIGH: TK.High, LOW: TK.Low,
            NOT: TK.Not, CPL: TK.Cpl, MOD: TK.Mod,
            FLOAT: TK.Float, ASM: TK.Asm,
            AND: TK.And, OR: TK.Or, XOR: TK.Xor,
        };
        for (var k in kw) KEYWORDS[k] = kw[k];
    })();

    var STRING_FUNCS = new Set([
        'FORM$', 'DECI$', 'PN$', 'HEX2$', 'HEX4$', 'MSG$', 'MSX$',
        'STR$', 'CHR$', 'SPC$', 'CR$', 'TAB$', 'FL$',
    ]);

    function isHexDigit(c) {
        var cc = c.charCodeAt(0);
        return (cc >= 48 && cc <= 57) || (cc >= 65 && cc <= 70) || (cc >= 97 && cc <= 102);
    }

    function hexValue(c) {
        var cc = c.charCodeAt(0);
        if (cc >= 48 && cc <= 57) return cc - 48;
        if (cc >= 97 && cc <= 102) return cc - 97 + 10;
        if (cc >= 65 && cc <= 70) return cc - 65 + 10;
        return 0;
    }

    function isIdentStart(c) {
        var cc = c.charCodeAt(0);
        return (cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122) || cc === 95 || cc === 64 || cc === 94 ||
            (cc >= 0x3041 && cc <= 0x3096) || (cc >= 0x30A1 && cc <= 0x30FA) ||
            cc === 0x3005 || cc === 0x3007 || cc === 0x303B ||
            (cc >= 0x3400 && cc <= 0x9FFF) || (cc >= 0xF900 && cc <= 0xFAFF);
    }

    function isIdentPart(c) {
        var cc = c.charCodeAt(0);
        return isIdentStart(c) || (cc >= 48 && cc <= 57);
    }

    function isDigit(c) {
        var cc = c.charCodeAt(0);
        return cc >= 48 && cc <= 57;
    }

    function Lexer(source, fileName) {
        var _source = source;
        var _fileName = fileName || '<input>';
        var _pos = 0;
        var _line = 1;
        var _column = 1;
        var _nextBraceIsArray = false;

        function peek(offset) {
            var idx = _pos + (offset || 0);
            return idx < _source.length ? _source[idx] : '\0';
        }

        function advance() {
            var c = _source[_pos];
            _pos++;
            if (c === '\n') { _line++; _column = 1; }
            else { _column++; }
            return c;
        }

        function isAtEnd() { return _pos >= _source.length; }

        function currentLocation() { return SourceLocation(_fileName, _line, _column); }

        function makeToken(kind, text, start, value) {
            return Token(kind, text, SourceSpan(start, currentLocation()), value);
        }

        function skipWhitespace() {
            while (!isAtEnd()) {
                var c = peek();
                if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
                    advance(); _nextBraceIsArray = false;
                } else if (c === '/' && peek(1) === '/') {
                    while (!isAtEnd() && peek() !== '\n') advance();
                } else if (c === '/' && peek(1) === '*') {
                    advance(); advance();
                    while (!isAtEnd() && !(peek() === '*' && peek(1) === '/')) advance();
                    if (!isAtEnd()) { advance(); advance(); }
                } else if (c === '(' && peek(1) === '*') {
                    advance(); advance();
                    while (!isAtEnd() && !(peek() === '*' && peek(1) === ')')) advance();
                    if (!isAtEnd()) { advance(); advance(); }
                } else {
                    break;
                }
            }
        }

        function skipSpaces() {
            while (!isAtEnd() && (peek() === ' ' || peek() === '\t')) advance();
        }

        function skipToEndOfLine() {
            while (!isAtEnd() && peek() !== '\n') advance();
            if (!isAtEnd()) advance();
        }

        function readEscapeChar() {
            if (isAtEnd()) return '\\';
            var c = advance();
            switch (c) {
                case 'n': case '/': return '\r';
                case 'c': case 'C': return '\f';
                case 'r': case 'R': return String.fromCharCode(0x1c);
                case 'l': case 'L': return String.fromCharCode(0x1d);
                case 'u': case 'U': return String.fromCharCode(0x1e);
                case 'd': case 'D': return String.fromCharCode(0x1f);
                case 'x': case 'X':
                    var val = 0;
                    for (var i = 0; i < 2 && !isAtEnd() && isHexDigit(peek()); i++) {
                        val = val * 16 + hexValue(advance());
                    }
                    return String.fromCharCode(val);
                default: return c;
            }
        }

        function readNumber(start) {
            var startPos = _pos;

            // $ prefix hex
            if (peek() === '$') {
                advance();
                while (!isAtEnd() && isHexDigit(peek())) advance();
                var text = _source.substring(startPos, _pos);
                var val = parseInt(text.substring(1), 16);
                return makeToken(TK.IntegerLiteral, text, start, val | 0);
            }

            // 0x prefix hex
            if (peek() === '0' && (peek(1) === 'x' || peek(1) === 'X')) {
                advance(); advance();
                while (!isAtEnd() && isHexDigit(peek())) advance();
                var text = _source.substring(startPos, _pos);
                var val = parseInt(text.substring(2), 16);
                return makeToken(TK.IntegerLiteral, text, start, val | 0);
            }

            while (!isAtEnd() && isDigit(peek())) advance();

            // Float
            if (!isAtEnd() && peek() === '.' && _pos + 1 < _source.length && isDigit(peek(1))) {
                advance();
                while (!isAtEnd() && isDigit(peek())) advance();
                var ftext = _source.substring(startPos, _pos);
                return makeToken(TK.FloatLiteral, ftext, start, parseFloat(ftext));
            }

            var raw = _source.substring(startPos, _pos);

            // Binary suffix
            if (!isAtEnd() && (peek() === 'B' || peek() === 'b')) {
                var allBin = true;
                for (var i = 0; i < raw.length; i++) {
                    if (raw[i] !== '0' && raw[i] !== '1') { allBin = false; break; }
                }
                if (allBin) {
                    advance();
                    var text = _source.substring(startPos, _pos);
                    return makeToken(TK.IntegerLiteral, text, start, parseInt(raw, 2) | 0);
                }
            }

            // Hex digits + H suffix
            if (!isAtEnd() && isHexDigit(peek()) && peek() !== 'B' && peek() !== 'b') {
                while (!isAtEnd() && isHexDigit(peek())) advance();
                raw = _source.substring(startPos, _pos);
                if (!isAtEnd() && (peek() === 'H' || peek() === 'h')) {
                    advance();
                    var text = _source.substring(startPos, _pos);
                    return makeToken(TK.IntegerLiteral, text, start, parseInt(raw, 16) | 0);
                }
            }

            // H suffix on plain digits
            if (!isAtEnd() && (peek() === 'H' || peek() === 'h')) {
                advance();
                var text = _source.substring(startPos, _pos);
                return makeToken(TK.IntegerLiteral, text, start, parseInt(raw, 16) | 0);
            }

            // Decimal
            return makeToken(TK.IntegerLiteral, raw, start, parseInt(raw, 10) | 0);
        }

        function readString(start) {
            advance(); // skip "
            var sb = '';
            while (!isAtEnd() && peek() !== '"') {
                if (peek() === '\n') return makeToken(TK.Error, 'Unterminated string', start);
                if (peek() === '\\') { advance(); sb += readEscapeChar(); }
                else { sb += advance(); }
            }
            if (!isAtEnd()) advance(); // skip "
            return makeToken(TK.StringLiteral, sb, start, sb);
        }

        function readChar(start) {
            advance(); // skip '
            var sb = '';
            while (!isAtEnd() && peek() !== "'") {
                if (peek() === '\n') return makeToken(TK.Error, 'Unterminated char', start);
                if (peek() === '\\') { advance(); sb += readEscapeChar(); }
                else { sb += advance(); }
            }
            if (!isAtEnd()) advance(); // skip '
            var charVal = sb.length > 0 ? sb.charCodeAt(0) : 0;
            return makeToken(TK.CharLiteral, sb, start, charVal);
        }

        function readIdentifier(start) {
            var startPos = _pos;
            while (!isAtEnd() && isIdentPart(peek())) advance();

            // String functions (e.g. FORM$)
            if (!isAtEnd() && peek() === '$') {
                var savedPos = _pos;
                advance();
                var withDollar = _source.substring(startPos, _pos);
                if (STRING_FUNCS.has(withDollar.toUpperCase())) {
                    _nextBraceIsArray = false;
                    return makeToken(TK.StringFunc, withDollar, start, withDollar);
                }
                _pos = savedPos;
            }

            var text = _source.substring(startPos, _pos);
            _nextBraceIsArray = true;

            var kw = KEYWORDS[text.toUpperCase()];
            if (kw) return makeToken(kw, text, start);

            return makeToken(TK.Identifier, text, start, text);
        }

        var DOT_OPS = [
            ['>=', '.>=.', TK.SignedGe],
            ['<=', '.<=.', TK.SignedLe],
            ['>>', '.>>.', TK.SignedShr],
            ['<<', '.<<.', TK.SignedShl],
            ['>', '.>.', TK.SignedGt],
            ['<', '.<.', TK.SignedLt],
            ['MOD', '.MOD.', TK.SignedMod],
            ['*', '.*.', TK.SignedMul],
            ['/', './.', TK.SignedDiv],
        ];

        function readDotOperator(start) {
            var savedPos = _pos, savedLine = _line, savedCol = _column;
            if (peek() !== '.') return null;

            for (var d = 0; d < DOT_OPS.length; d++) {
                var inner = DOT_OPS[d][0], full = DOT_OPS[d][1], kind = DOT_OPS[d][2];
                var fullLen = 1 + inner.length;
                if (_pos + fullLen > _source.length) continue;
                var slice = _source.substring(_pos + 1, _pos + 1 + inner.length);
                if (slice.toUpperCase() !== inner.toUpperCase()) continue;

                var consumeLen = fullLen;
                if (_pos + fullLen < _source.length && _source[_pos + fullLen] === '.') {
                    consumeLen = fullLen + 1;
                }
                for (var i = 0; i < consumeLen; i++) advance();
                return makeToken(kind, full, start);
            }

            _pos = savedPos; _line = savedLine; _column = savedCol;
            return null;
        }

        function readOperator(start) {
            var c = advance();
            switch (c) {
                case '+':
                    if (!isAtEnd() && peek() === '+') { advance(); return makeToken(TK.PlusPlus, '++', start); }
                    if (!isAtEnd() && peek() === '=') { advance(); return makeToken(TK.PlusEq, '+=', start); }
                    return makeToken(TK.Plus, '+', start);
                case '-':
                    if (!isAtEnd() && peek() === '-') { advance(); return makeToken(TK.MinusMinus, '--', start); }
                    if (!isAtEnd() && peek() === '=') { advance(); return makeToken(TK.MinusEq, '-=', start); }
                    return makeToken(TK.Minus, '-', start);
                case '*':
                    if (!isAtEnd() && peek() === '=') { advance(); return makeToken(TK.StarEq, '*=', start); }
                    return makeToken(TK.Star, '*', start);
                case '/':
                    if (!isAtEnd() && peek() === '=') { advance(); return makeToken(TK.SlashEq, '/=', start); }
                    return makeToken(TK.Slash, '/', start);
                case '%':
                    if (!isAtEnd() && peek() === '%') { advance(); return makeToken(TK.Float, '%%', start); }
                    return makeToken(TK.Percent, '%', start);
                case '&':
                    if (!isAtEnd() && peek() === '&') { advance(); return makeToken(TK.LogAnd, '&&', start); }
                    return makeToken(TK.Ampersand, '&', start);
                case '|':
                    if (!isAtEnd() && peek() === '|') { advance(); return makeToken(TK.LogOr, '||', start); }
                    return makeToken(TK.Pipe, '|', start);
                case '=':
                    if (!isAtEnd() && peek() === '=') { advance(); return makeToken(TK.EqEq, '==', start); }
                    _nextBraceIsArray = false;
                    return makeToken(TK.Eq, '=', start);
                case '<':
                    if (!isAtEnd() && peek() === '=') { advance(); return makeToken(TK.Le, '<=', start); }
                    if (!isAtEnd() && peek() === '<') { advance(); return makeToken(TK.Shl, '<<', start); }
                    if (!isAtEnd() && peek() === '>') { advance(); return makeToken(TK.NotEq, '<>', start); }
                    return makeToken(TK.Lt, '<', start);
                case '>':
                    if (!isAtEnd() && peek() === '=') { advance(); return makeToken(TK.Ge, '>=', start); }
                    if (!isAtEnd() && peek() === '>') { advance(); return makeToken(TK.Shr, '>>', start); }
                    return makeToken(TK.Gt, '>', start);
                case '!':
                    if (!isAtEnd() && peek() === '=') { advance(); return makeToken(TK.NotEq, '!=', start); }
                    return makeToken(TK.Exclamation, '!', start);
                case '?': return makeToken(TK.Question, '?', start);
                case '(': return makeToken(TK.LParen, '(', start);
                case ')': _nextBraceIsArray = false; return makeToken(TK.RParen, ')', start);
                case '[':
                    var brKind = _nextBraceIsArray ? TK.ArrayBracketOpen : TK.LBracket;
                    _nextBraceIsArray = false;
                    return makeToken(brKind, '[', start);
                case ']': _nextBraceIsArray = true; return makeToken(TK.RBracket, ']', start);
                case '{': return makeToken(TK.LBrace, '{', start);
                case '}': return makeToken(TK.RBrace, '}', start);
                case '\uff62': return makeToken(TK.LAngleBracket, '\uff62', start);
                case '\uff63': return makeToken(TK.RAngleBracket, '\uff63', start);
                case ',': return makeToken(TK.Comma, ',', start);
                case ':': _nextBraceIsArray = false; return makeToken(TK.Colon, ':', start);
                case ';': _nextBraceIsArray = false; return makeToken(TK.Semicolon, ';', start);
                default: return makeToken(TK.Error, c, start);
            }
        }

        function readPreprocessor(start) {
            var startPos = _pos;
            advance(); // skip #
            while (!isAtEnd() && isIdentPart(peek())) advance();
            var directive = _source.substring(startPos + 1, _pos);
            var dirUp = directive.toUpperCase();

            if (dirUp === 'INCLUDE') {
                skipSpaces();
                var fnStart = _pos;
                while (!isAtEnd() && peek() !== '\n') advance();
                var path = _source.substring(fnStart, _pos).trim().replace(/^"|"$/g, '');
                return makeToken(TK.PreprocInclude, path, start, path);
            }
            if (dirUp === 'IF') {
                skipSpaces();
                var exprStart = _pos;
                while (!isAtEnd() && peek() !== '\n') advance();
                var expr = _source.substring(exprStart, _pos).trim();
                return makeToken(TK.PreprocIf, expr, start, expr);
            }
            if (dirUp === 'ELSE') return makeToken(TK.PreprocElse, '#ELSE', start);
            if (dirUp === 'END' || dirUp === 'ENDIF') return makeToken(TK.PreprocEnd, '#END', start);
            if (dirUp === 'ASM') {
                skipToEndOfLine();
                var sb = '';
                while (!isAtEnd()) {
                    if (peek() === '#') {
                        advance();
                        var dStart = _pos;
                        while (!isAtEnd() && isIdentPart(peek())) advance();
                        var d = _source.substring(dStart, _pos).toUpperCase();
                        if (d === 'END' || d === 'ENDIF') break;
                        sb += '#' + _source.substring(dStart, _pos);
                        continue;
                    }
                    sb += advance();
                }
                return makeToken(TK.Plain, sb, start, sb);
            }
            if (dirUp === 'MODULE') return makeToken(TK.Module, '#MODULE', start);
            return makeToken(TK.Error, '#' + directive, start);
        }

        function nextToken() {
            skipWhitespace();
            if (isAtEnd()) return makeToken(TK.EOF, '', currentLocation());
            var start = currentLocation();
            var c = peek();

            if (c === '#') return readPreprocessor(start);
            if (isDigit(c) || (c === '$' && _pos + 1 < _source.length && isHexDigit(peek(1))))
                return readNumber(start);
            if (c === '.' && _pos + 1 < _source.length && isDigit(peek(1))) {
                advance();
                return readNumber(start);
            }
            if (c === '"') return readString(start);
            if (c === "'") return readChar(start);
            if (c === '.' && _pos + 1 < _source.length && !isDigit(peek(1))) {
                var dotResult = readDotOperator(start);
                if (dotResult) return dotResult;
                return readOperator(start);
            }
            if (isIdentStart(c)) return readIdentifier(start);
            return readOperator(start);
        }

        return {
            tokenize: function() {
                var tokens = [];
                while (true) {
                    var token = nextToken();
                    tokens.push(token);
                    if (token.kind === TK.EOF) break;
                }
                return tokens;
            },
            nextToken: nextToken,
        };
    }

    // ================================================================
    // Public API (Phase 1 foundation)
    // ================================================================
    window.X1PenSlangCompiler = {
        // Exposed for testing — will be expanded as more phases are ported
        _TK: TK,
        _KEYWORD_KINDS: KEYWORD_KINDS,
        _Token: Token,
        _SourceLocation: SourceLocation,
        _SourceSpan: SourceSpan,
        _DiagnosticSeverity: DiagnosticSeverity,
        _DiagnosticBag: DiagnosticBag,
        _sanitizeLabel: sanitizeLabel,
        _userVarLabel: userVarLabel,
        _staticVarLabel: staticVarLabel,
        _userLabel: userLabel,
        _convertToF24: convertToF24,
        _toAsmDbArgs: toAsmDbArgs,
        _Lexer: Lexer,

        // Main compile entry point (stub — will be implemented in later phases)
        compile: function(source, virtualFS, env) {
            return { asm: '', errors: [{ message: 'SLANG compiler not yet implemented' }] };
        },
    };
})();

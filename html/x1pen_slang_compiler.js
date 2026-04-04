// x1pen_slang_compiler.js — SLANG Compiler for X1Pen
// Ported from C# (SLANGCompiler.Core) to JavaScript
// C# source snapshot: https://github.com/h-o-soft/SLANG-compiler @ d52860f
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
    // AST Node types
    // ================================================================

    var DataSize = { Word: 'Word', Byte: 'Byte', Float: 'Float' };

    var BinaryOp = {
        Add: 'Add', Sub: 'Sub', Mul: 'Mul', Div: 'Div', Mod: 'Mod',
        SMul: 'SMul', SDiv: 'SDiv', SMod: 'SMod',
        And: 'And', Or: 'Or', Xor: 'Xor',
        Shl: 'Shl', Shr: 'Shr', SShl: 'SShl', SShr: 'SShr',
        Eq: 'Eq', Neq: 'Neq', Lt: 'Lt', Gt: 'Gt', Le: 'Le', Ge: 'Ge',
        SLt: 'SLt', SGt: 'SGt', SLe: 'SLe', SGe: 'SGe',
        LogAnd: 'LogAnd', LogOr: 'LogOr',
    };

    var UnaryOp = { Negate: 'Negate', Plus: 'Plus', Not: 'Not', Cpl: 'Cpl' };

    var CompoundAssignOp = {
        AddAssign: 'AddAssign', SubAssign: 'SubAssign',
        MulAssign: 'MulAssign', DivAssign: 'DivAssign',
    };

    // AST node factory: { type, span, ...fields }
    function ast(type, span, fields) {
        var node = { type: type, span: span };
        if (fields) { for (var k in fields) node[k] = fields[k]; }
        return node;
    }

    var AST = {
        CompilationUnit: function(defs, span) { return ast('CompilationUnit', span, { definitions: defs }); },
        OrgDirective: function(value, span) { return ast('OrgDirective', span, { value: value }); },
        WorkDirective: function(value, span) { return ast('WorkDirective', span, { value: value }); },
        OffsetDirective: function(value, span) { return ast('OffsetDirective', span, { value: value }); },
        ModuleBlock: function(name, defs, span) { return ast('ModuleBlock', span, { name: name, definitions: defs }); },
        PlainAsm: function(text, span) { return ast('PlainAsm', span, { asmText: text }); },

        VarDecl: function(name, size, address, initVal, initCode, span) {
            return ast('VarDecl', span, { name: name, size: size, address: address, initialValue: initVal, initialCode: initCode });
        },
        ArrayDecl: function(name, size, address, dims, initVal, initCode, span) {
            return ast('ArrayDecl', span, { name: name, size: size, address: address, dimensions: dims, initialValue: initVal, initialCode: initCode, isArrayKeyword: false });
        },
        ConstDecl: function(name, value, isAsmEqu, span) {
            return ast('ConstDecl', span, { name: name, value: value, isAsmEqu: isAsmEqu });
        },
        MachineDecl: function(name, address, paramCount, span, codeBody, staticDecls) {
            return ast('MachineDecl', span, { name: name, address: address, paramCount: paramCount, codeBody: codeBody || null, staticDeclarations: staticDecls || [] });
        },
        FuncDef: function(name, address, params, staticDecls, localDecls, body, retVal, span) {
            return ast('FuncDef', span, { name: name, address: address, parameters: params, staticDeclarations: staticDecls, localDeclarations: localDecls, body: body, returnValue: retVal });
        },
        ParamDecl: function(name, size, isArray, span) {
            return ast('ParamDecl', span, { name: name, size: size, isArray: isArray });
        },

        Block: function(stmts, span) { return ast('Block', span, { statements: stmts }); },
        ExpressionStmt: function(expr, span) { return ast('ExpressionStmt', span, { expr: expr }); },
        IfStmt: function(branches, elseBody, span) { return ast('IfStmt', span, { branches: branches, elseBody: elseBody }); },
        WhileStmt: function(cond, body, span) { return ast('WhileStmt', span, { condition: cond, body: body }); },
        RepeatStmt: function(body, cond, span) { return ast('RepeatStmt', span, { body: body, condition: cond }); },
        LoopStmt: function(body, span) { return ast('LoopStmt', span, { body: body }); },
        ForStmt: function(variable, from, to, isDownTo, body, span) {
            return ast('ForStmt', span, { variable: variable, from: from, to: to, isDownTo: isDownTo, body: body });
        },
        CaseBranch: function(value, rangeEnd, body) { return { value: value, rangeEnd: rangeEnd, body: body }; },
        CaseStmt: function(expr, branches, span) { return ast('CaseStmt', span, { expr: expr, branches: branches }); },
        ExitStmt: function(level, targetLabel, span) { return ast('ExitStmt', span, { level: level, targetLabel: targetLabel }); },
        ContinueStmt: function(span) { return ast('ContinueStmt', span); },
        ReturnStmt: function(value, span) { return ast('ReturnStmt', span, { value: value }); },
        GotoStmt: function(label, span) { return ast('GotoStmt', span, { label: label }); },
        LabelStmt: function(label, span) { return ast('LabelStmt', span, { label: label }); },
        PrintStmt: function(args, span) { return ast('PrintStmt', span, { arguments: args }); },

        IntegerLiteral: function(value, span) { return ast('IntegerLiteral', span, { value: value }); },
        FloatLiteral: function(value, span) { return ast('FloatLiteral', span, { value: value }); },
        StringLiteral: function(value, span) { return ast('StringLiteral', span, { value: value }); },
        IdentifierExpr: function(name, span) { return ast('IdentifierExpr', span, { name: name }); },
        BinaryExpr: function(op, left, right, span) { return ast('BinaryExpr', span, { op: op, left: left, right: right }); },
        UnaryExpr: function(op, operand, span) { return ast('UnaryExpr', span, { op: op, operand: operand }); },
        AssignExpr: function(target, value, span) { return ast('AssignExpr', span, { target: target, value: value }); },
        CompoundAssignExpr: function(op, target, value, span) { return ast('CompoundAssignExpr', span, { op: op, target: target, value: value }); },
        IncrementExpr: function(operand, isInc, isPrefix, span) { return ast('IncrementExpr', span, { operand: operand, isIncrement: isInc, isPrefix: isPrefix }); },
        CallExpr: function(func, args, span) { return ast('CallExpr', span, { func: func, arguments: args }); },
        ArrayAccessExpr: function(arr, indices, span) { return ast('ArrayAccessExpr', span, { array: arr, indices: indices }); },
        ConditionalExpr: function(cond, trueE, falseE, span) { return ast('ConditionalExpr', span, { condition: cond, trueExpr: trueE, falseExpr: falseE }); },
        CommaExpr: function(left, right, span) { return ast('CommaExpr', span, { left: left, right: right }); },
        AddressOfExpr: function(operand, span) { return ast('AddressOfExpr', span, { operand: operand }); },
        HighLowExpr: function(isHigh, operand, span) { return ast('HighLowExpr', span, { isHigh: isHigh, operand: operand }); },
        CodeExpr: function(values, span) { return ast('CodeExpr', span, { values: values }); },
        CodeEvalExpr: function(inner, span) { return ast('CodeEvalExpr', span, { inner: inner }); },
        CodeLabelRef: function(label, span) { return ast('CodeLabelRef', span, { label: label }); },
        CastExpr: function(targetSize, operand, span) { return ast('CastExpr', span, { targetSize: targetSize, operand: operand }); },
        StringFuncExpr: function(funcName, args, span) { return ast('StringFuncExpr', span, { funcName: funcName, arguments: args }); },
    };

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
    // Parser
    // ================================================================

    function Parser(tokens, diagnostics, preprocDefs) {
        var _tokens = tokens;
        var _diag = diagnostics;
        var _pos = 0;
        var _argListDepth = 0;
        var _preprocDefs = preprocDefs || {};

        function current() { return _pos < _tokens.length ? _tokens[_pos] : Token(TK.EOF, '', SourceSpan.Unknown); }
        function peekAt(offset) { var i = _pos + (offset || 0); return i < _tokens.length ? _tokens[i] : Token(TK.EOF, '', SourceSpan.Unknown); }
        function advance() { var t = current(); _pos++; return t; }
        function check(k) { return current().kind === k; }
        function checkAny() { var c = current().kind; for (var i = 0; i < arguments.length; i++) { if (c === arguments[i]) return true; } return false; }
        function match(k) { if (check(k)) { advance(); return true; } return false; }
        function expect(k, msg) { if (check(k)) return advance(); error(msg || ('Expected ' + k + ', got ' + current().kind)); return current(); }
        function error(msg) { _diag.error(msg, current().span); }

        function isBlockOpen() { return checkAny(TK.Begin, TK.LBracket, TK.LBrace, TK.LAngleBracket); }
        function isBlockClose() { return checkAny(TK.End, TK.RBracket, TK.RBrace, TK.RAngleBracket); }
        function expectBlockOpen(msg) { if (isBlockOpen()) { advance(); return; } error(msg || 'Expected block open'); }
        function expectBlockClose(msg) { if (isBlockClose()) { advance(); return; } error(msg || 'Expected block close'); }
        function isDeclStart() { return checkAny(TK.Var, TK.Array, TK.Const, TK.Machine, TK.Byte, TK.Word); }

        function isFuncDefStart() {
            var i = 1;
            if (peekAt(i).kind === TK.Colon) i += 2;
            return peekAt(i).kind === TK.LParen;
        }

        function parseOptionalDataSize() {
            if (match(TK.Byte) || match(TK.Exclamation)) return DataSize.Byte;
            if (match(TK.Word)) return DataSize.Word;
            if (match(TK.Float)) return DataSize.Float;
            return DataSize.Word;
        }

        // ---- Synchronization ----
        function syncTopLevel() {
            while (!check(TK.EOF)) {
                if (match(TK.Semicolon)) return;
                var k = current().kind;
                if (k === TK.Org || k === TK.Work || k === TK.Offset || k === TK.Plain ||
                    k === TK.PreprocIf || k === TK.PreprocElse || k === TK.PreprocEnd || k === TK.PreprocInclude ||
                    k === TK.Const || k === TK.Var || k === TK.Array || k === TK.Machine ||
                    k === TK.Byte || k === TK.Word || k === TK.Float || k === TK.Exclamation || k === TK.Module) return;
                if (k === TK.Identifier && isFuncDefStart()) return;
                advance();
            }
        }
        function syncDecl() {
            while (!check(TK.EOF)) { if (match(TK.Semicolon)) return; if (isDeclStart() || isBlockOpen()) return; advance(); }
        }
        function syncStmt() {
            while (!check(TK.EOF)) {
                if (match(TK.Semicolon)) return;
                var k = current().kind;
                if (k === TK.If || k === TK.While || k === TK.Repeat || k === TK.Loop || k === TK.For || k === TK.Case ||
                    k === TK.Exit || k === TK.Continue || k === TK.Return || k === TK.Goto || k === TK.Print || k === TK.Plain ||
                    k === TK.Var || k === TK.Array || k === TK.Byte || k === TK.Word || k === TK.Float ||
                    k === TK.PreprocIf || k === TK.PreprocEnd || k === TK.Identifier ||
                    k === TK.Until || k === TK.Wend || k === TK.Else || k === TK.Elif || k === TK.Ef || k === TK.EndIf) return;
                if (isBlockOpen() || isBlockClose()) return;
                advance();
            }
        }

        // ---- Preprocessor (in-parser, simplified) ----
        function evalPreprocExpr(expr) {
            // Substitute defined constants and keywords
            // Undefined identifiers become 0 (matching SLANG compiler behavior)
            var s = expr.replace(/[A-Za-z_][A-Za-z0-9_]*/g, function(name) {
                var up = name.toUpperCase();
                if (up === 'TRUE') return '1';
                if (up === 'FALSE') return '0';
                if (up === 'AND') return '&';
                if (up === 'OR') return '|';
                if (up === 'NOT') return '!';
                if (up in _preprocDefs) return String(_preprocDefs[up]);
                return '0';
            });
            // Remove surrounding parens for simpler eval
            s = s.trim();
            // Simple expression evaluator for #IF conditions
            try {
                // Tokenize: numbers, identifiers, operators
                var tokens = [];
                var i = 0;
                while (i < s.length) {
                    if (s[i] === ' ' || s[i] === '\t') { i++; continue; }
                    if (s[i] === '(') { tokens.push({ t: '(' }); i++; continue; }
                    if (s[i] === ')') { tokens.push({ t: ')' }); i++; continue; }
                    if (s[i] === '<' && s[i+1] === '=') { tokens.push({ t: '<=' }); i+=2; continue; }
                    if (s[i] === '>' && s[i+1] === '=') { tokens.push({ t: '>=' }); i+=2; continue; }
                    if (s[i] === '=' && s[i+1] === '=') { tokens.push({ t: '==' }); i+=2; continue; }
                    if (s[i] === '!' && s[i+1] === '=') { tokens.push({ t: '!=' }); i+=2; continue; }
                    if (s[i] === '<') { tokens.push({ t: '<' }); i++; continue; }
                    if (s[i] === '>') { tokens.push({ t: '>' }); i++; continue; }
                    if (s[i] === '=') { tokens.push({ t: '==' }); i++; continue; }
                    if (s[i] === '+') { tokens.push({ t: '+' }); i++; continue; }
                    if (s[i] === '-') { tokens.push({ t: '-' }); i++; continue; }
                    if (s[i] === '*') { tokens.push({ t: '*' }); i++; continue; }
                    if (s[i] === '/') { tokens.push({ t: '/' }); i++; continue; }
                    if (s[i] === '&') { tokens.push({ t: '&' }); i++; continue; }
                    if (s[i] === '|') { tokens.push({ t: '|' }); i++; continue; }
                    if (s[i] === '!') { tokens.push({ t: '!' }); i++; continue; }
                    if (s[i] === '$') {
                        i++;
                        var hs = '';
                        while (i < s.length && /[0-9A-Fa-f]/.test(s[i])) hs += s[i++];
                        tokens.push({ t: 'num', v: parseInt(hs, 16) || 0 });
                        continue;
                    }
                    if (/[0-9]/.test(s[i])) {
                        var ns = '';
                        while (i < s.length && /[0-9]/.test(s[i])) ns += s[i++];
                        tokens.push({ t: 'num', v: parseInt(ns, 10) });
                        continue;
                    }
                    // Identifier (residual after substitution) — treat as 0
                    if (/[A-Za-z_]/.test(s[i])) {
                        while (i < s.length && /[A-Za-z0-9_]/.test(s[i])) i++;
                        tokens.push({ t: 'num', v: 0 });
                        continue;
                    }
                    // Unknown char — bail
                    return null;
                }
                // Recursive descent parser
                var tp = 0;
                function peek2() { return tp < tokens.length ? tokens[tp] : null; }
                function next() { return tokens[tp++]; }
                function parseOr() {
                    var v = parseAnd();
                    while (peek2() && peek2().t === '|') { next(); v = (v | parseAnd()); }
                    return v;
                }
                function parseAnd() {
                    var v = parseComp();
                    while (peek2() && peek2().t === '&') { next(); v = (v & parseComp()); }
                    return v;
                }
                function parseComp() {
                    var v = parseAdd();
                    while (peek2() && (peek2().t === '<=' || peek2().t === '>=' || peek2().t === '<' || peek2().t === '>' || peek2().t === '==' || peek2().t === '!=')) {
                        var op = next().t;
                        var r = parseAdd();
                        if (op === '<=') v = (v <= r) ? 1 : 0;
                        else if (op === '>=') v = (v >= r) ? 1 : 0;
                        else if (op === '<') v = (v < r) ? 1 : 0;
                        else if (op === '>') v = (v > r) ? 1 : 0;
                        else if (op === '==') v = (v === r) ? 1 : 0;
                        else if (op === '!=') v = (v !== r) ? 1 : 0;
                    }
                    return v;
                }
                function parseAdd() {
                    var v = parseMul();
                    while (peek2() && (peek2().t === '+' || peek2().t === '-')) {
                        var op = next().t;
                        v = op === '+' ? v + parseMul() : v - parseMul();
                    }
                    return v;
                }
                function parseMul() {
                    var v = parseUnary();
                    while (peek2() && (peek2().t === '*' || peek2().t === '/')) {
                        var op = next().t;
                        var r = parseUnary();
                        v = op === '*' ? v * r : (r !== 0 ? Math.floor(v / r) : 0);
                    }
                    return v;
                }
                function parseUnary() {
                    if (peek2() && peek2().t === '!') { next(); return parseUnary() ? 0 : 1; }
                    if (peek2() && peek2().t === '-') { next(); return -parseUnary(); }
                    return parsePrimary();
                }
                function parsePrimary() {
                    var tok = peek2();
                    if (!tok) return 0;
                    if (tok.t === 'num') { next(); return tok.v; }
                    if (tok.t === '(') { next(); var v = parseOr(); if (peek2() && peek2().t === ')') next(); return v; }
                    return 0; // unknown — treat as 0
                }
                var result = parseOr();
                return result;
            } catch (e) { return null; }
        }
        function parsePreprocIf() {
            var t = advance();
            var expr = t.stringValue;
            var val = evalPreprocExpr(expr);
            // If evaluation failed (parse error), default to false (exclude the block)
            var condTrue = (val === null) ? false : (val !== 0);
            if (!condTrue) {
                // Condition false: skip to #ELSE or #END
                skipPreprocBlock();
                // After skip: if we stopped at #ELSE, the else-body will be parsed normally.
                // If we stopped at #END, nothing more to parse.
            }
            // Condition true: body will be parsed normally by caller.
            // We return null; the caller will parse statements until hitting #ELSE or #END.
            return null;
        }
        // Skip tokens until matching #ELSE (at depth 1) or #END
        function skipPreprocBlock() {
            var depth = 1;
            while (!check(TK.EOF) && depth > 0) {
                if (check(TK.PreprocIf)) { depth++; advance(); continue; }
                if (check(TK.PreprocEnd)) { depth--; advance(); continue; }
                if (check(TK.PreprocElse) && depth === 1) { advance(); return; }
                advance();
            }
        }
        // Skip tokens from #ELSE to matching #END (used when true-branch was taken)
        function skipPreprocToEnd() {
            var depth = 1;
            while (!check(TK.EOF) && depth > 0) {
                if (check(TK.PreprocIf)) { depth++; advance(); continue; }
                if (check(TK.PreprocEnd)) { depth--; advance(); continue; }
                advance();
            }
        }

        // ---- Directives ----
        function parseOrg() { var s = advance().span; return AST.OrgDirective(parseNcExpr(), s); }
        function parseWork() { var s = advance().span; return AST.WorkDirective(parseNcExpr(), s); }
        function parseOffset() { var s = advance().span; return AST.OffsetDirective(parseNcExpr(), s); }

        function parseModuleBlock() {
            var start = advance().span;
            var addr = parseNcExpr();
            var defs = [];
            while (!check(TK.EOF) && !_diag.hasReachedMaxErrors) {
                if (check(TK.PreprocEnd)) { advance(); break; }
                if (match(TK.Semicolon)) continue;
                var eb = _diag.errorCount, bp = _pos;
                var def = parseTopLevel();
                if (def) defs.push(def);
                if (_diag.errorCount > eb) syncTopLevel();
                else if (_pos === bp) advance();
            }
            return AST.ModuleBlock(addr, defs, start);
        }

        // ---- CONST ----
        function parseConstDecl() {
            var start = advance().span;
            var decls = [];
            do {
                var isAsm = match(TK.Asm);
                var name = expect(TK.Identifier, 'Expected constant name').stringValue;
                expect(TK.Eq, "Expected '='");
                var value;
                if (isBlockOpen()) { value = AST.CodeExpr(parseCodeBlock(), start); }
                else { value = parseNcExpr(); }
                decls.push(AST.ConstDecl(name, value, isAsm, start));
                // Register integer constants for #IF preprocessor evaluation
                if (value && value.type === 'IntegerLiteral' && name) {
                    _preprocDefs[name] = value.value;
                }
            } while (match(TK.Comma));
            match(TK.Semicolon);
            return decls.length === 1 ? decls[0] : AST.Block(decls, start);
        }

        // ---- VAR ----
        function parseVarDeclList() {
            var start = current().span;
            var hadVar = match(TK.Var);
            var decls = [];
            do { decls.push(parseSingleVarOrArray(hadVar)); } while (match(TK.Comma));
            match(TK.Semicolon);
            return decls.length === 1 ? decls[0] : AST.Block(decls, start);
        }
        function parseSingleVarOrArray() {
            var start = current().span;
            var size = parseOptionalDataSize();
            var name = expect(TK.Identifier, 'Expected variable name').stringValue;
            var address = null, dims = [], initValue = null, initCode = null;
            while (check(TK.ArrayBracketOpen)) {
                advance();
                if (check(TK.RBracket)) dims.push(null);
                else dims.push(parseNcExpr());
                expect(TK.RBracket, "Expected ']'");
            }
            if (match(TK.Colon)) address = parseNcExpr();
            if (match(TK.Eq)) {
                if (isBlockOpen()) initCode = parseCodeBlock();
                else initValue = parseNcExpr();
            }
            if (dims.length > 0) return AST.ArrayDecl(name, size, address, dims, initValue, initCode, start);
            return AST.VarDecl(name, size, address, initValue, initCode, start);
        }

        // ---- ARRAY ----
        function parseArrayDeclList() {
            var start = advance().span;
            var decls = [];
            do {
                var s = current().span;
                var size = parseOptionalDataSize();
                var name = expect(TK.Identifier, 'Expected array name').stringValue;
                var dims = [];
                while (check(TK.ArrayBracketOpen)) {
                    advance();
                    if (check(TK.RBracket)) dims.push(null); else dims.push(parseNcExpr());
                    expect(TK.RBracket, "Expected ']'");
                }
                var address = null; if (match(TK.Colon)) address = parseNcExpr();
                var initValue = null, initCode = null;
                if (match(TK.Eq)) { if (isBlockOpen()) initCode = parseCodeBlock(); else initValue = parseNcExpr(); }
                var node = AST.ArrayDecl(name, size, address, dims, initValue, initCode, s);
                node.isArrayKeyword = true;
                decls.push(node);
            } while (match(TK.Comma));
            match(TK.Semicolon);
            return decls.length === 1 ? decls[0] : AST.Block(decls, start);
        }

        // ---- MACHINE ----
        function parseMachineDeclList() {
            var start = advance().span;
            var decls = [];
            do {
                var name = expect(TK.Identifier, 'Expected function name').stringValue;
                var address = null, paramCount = null;
                if (match(TK.LParen)) {
                    if (check(TK.IntegerLiteral)) { paramCount = current().intValue; advance(); }
                    expect(TK.RParen, "Expected ')'");
                }
                if (match(TK.Colon)) address = parseNcExpr();
                decls.push(AST.MachineDecl(name, address, paramCount, start));
            } while (match(TK.Comma));
            match(TK.Semicolon);
            return decls.length === 1 ? decls[0] : AST.Block(decls, start);
        }

        // ---- Function definition ----
        function parseFuncDef() {
            var start = current().span;
            var name = advance().stringValue;
            var address = null;
            if (match(TK.Colon)) address = parseNcExpr();
            expect(TK.LParen, "Expected '('");

            // MACHINE CODE def: FUNC(paramCount) ...
            if (check(TK.IntegerLiteral)) {
                var pc = advance().intValue;
                expect(TK.RParen, "Expected ')'");
                var msd = [];
                while (isDeclStart() && !isBlockOpen() && !_diag.hasReachedMaxErrors) {
                    var eb = _diag.errorCount, bp = _pos;
                    msd.push(parseLocalDecl());
                    if (_diag.errorCount > eb) syncDecl(); else if (_pos === bp) advance();
                }
                var cb = null;
                if (isBlockOpen()) {
                    advance();
                    var expr = parseNcExpr();
                    match(TK.Semicolon);
                    expectBlockClose('Expected block close');
                    if (expr.type === 'CodeExpr') cb = expr;
                }
                match(TK.Semicolon);
                return AST.MachineDecl(name, address, pc, start, cb, msd.length > 0 ? msd : null);
            }

            var params = [];
            if (!check(TK.RParen)) {
                do {
                    var ps = current().span;
                    var psz = parseOptionalDataSize();
                    var pn = expect(TK.Identifier, 'Expected parameter name').stringValue;
                    var isArr = false;
                    if (check(TK.ArrayBracketOpen)) { advance(); expect(TK.RBracket); isArr = true; }
                    params.push(AST.ParamDecl(pn, psz, isArr, ps));
                } while (match(TK.Comma));
            }
            expect(TK.RParen, "Expected ')'");

            // MACHINE CODE def (0 params): FUNC()[CODE(...);]
            if (isBlockOpen() && peekAt(1).kind === TK.Code) {
                advance();
                var expr = parseNcExpr();
                match(TK.Semicolon);
                expectBlockClose('Expected block close');
                match(TK.Semicolon);
                var cb = expr.type === 'CodeExpr' ? expr : null;
                return AST.MachineDecl(name, address, params.length, start, cb);
            }

            // Static declarations (before BEGIN)
            var staticDecls = [];
            while (isDeclStart() && !isBlockOpen() && !_diag.hasReachedMaxErrors) {
                var eb = _diag.errorCount, bp = _pos;
                staticDecls.push(parseLocalDecl());
                if (_diag.errorCount > eb) syncDecl(); else if (_pos === bp) advance();
            }

            expectBlockOpen('Expected BEGIN for function body');

            // Local declarations (after BEGIN)
            var localDecls = [];
            while (isDeclStart() && !_diag.hasReachedMaxErrors) {
                var eb = _diag.errorCount, bp = _pos;
                localDecls.push(parseLocalDecl());
                if (_diag.errorCount > eb) syncDecl(); else if (_pos === bp) advance();
            }

            var stmts = parseStmtList();
            var body = AST.Block(stmts, start);
            var retVal = null;
            expectBlockClose('Expected END');
            if (match(TK.LParen)) { retVal = parseExpr(); expect(TK.RParen, "Expected ')'"); }
            match(TK.Semicolon);
            return AST.FuncDef(name, address, params, staticDecls, localDecls, body, retVal, start);
        }

        function parseLocalDecl() {
            if (check(TK.Array)) return parseArrayDeclList();
            return parseVarDeclList();
        }

        // ---- Statements ----
        function parseStmtList() {
            var stmts = [];
            while (!isBlockClose() && !check(TK.EOF) && !check(TK.Until) && !check(TK.Wend) && !_diag.hasReachedMaxErrors) {
                if (match(TK.Semicolon)) continue;
                var eb = _diag.errorCount, bp = _pos;
                var stmt = parseStmt();
                if (stmt) stmts.push(stmt);
                if (_diag.errorCount > eb) syncStmt(); else if (_pos === bp) advance();
            }
            return stmts;
        }

        function parseStmt() {
            // 空文（セミコロンのみ）: repeat ; until ... 等に対応
            if (check(TK.Semicolon)) {
                var span = current().span;
                advance();
                return AST.Block([], span);
            }
            var k = current().kind;
            if (k === TK.If) return parseIf();
            if (k === TK.While) return parseWhile();
            if (k === TK.Repeat) return parseRepeat();
            if (k === TK.Loop) return parseLoop();
            if (k === TK.For) return parseFor();
            if (k === TK.Case) return parseCase();
            if (k === TK.Exit) return parseExit();
            if (k === TK.Continue) { advance(); match(TK.Semicolon); return AST.ContinueStmt(current().span); }
            if (k === TK.Return) return parseReturn();
            if (k === TK.Goto) return parseGoto();
            if (k === TK.Print) return parsePrint();
            if (k === TK.Plain) return AST.PlainAsm(advance().stringValue, current().span);
            if (k === TK.Var || k === TK.Array || k === TK.Byte || k === TK.Word || k === TK.Float) return parseLocalDecl();
            if (k === TK.PreprocIf) return parsePreprocIf();
            if (k === TK.PreprocElse) { advance(); skipPreprocToEnd(); return null; }
            if (k === TK.PreprocEnd) { advance(); return null; }
            if (isBlockOpen()) return parseCompound();
            if (check(TK.Identifier) && peekAt(1).kind === TK.Colon) {
                var lbl = advance().stringValue; advance();
                return AST.LabelStmt(lbl, current().span);
            }
            return parseExprStmt();
        }

        function parseCompound() {
            var s = current().span;
            expectBlockOpen();
            var stmts = parseStmtList();
            expectBlockClose();
            return AST.Block(stmts, s);
        }

        function parseExprStmt() {
            var s = current().span;
            var expr = parseExpr();
            match(TK.Semicolon);
            return AST.ExpressionStmt(expr, s);
        }

        // ---- IF ----
        function parseIf() {
            var s = advance().span;
            var branches = [];
            var cond = parseExpr(); match(TK.Then); var body = parseIfBody();
            branches.push({ condition: cond, body: body });
            while (check(TK.Elif) || check(TK.Ef) || (check(TK.Else) && peekAt(1).kind === TK.If)) {
                if (match(TK.Elif) || match(TK.Ef)) { } else { advance(); advance(); }
                cond = parseExpr(); match(TK.Then); body = parseIfBody();
                branches.push({ condition: cond, body: body });
            }
            var elsePart = null;
            if (match(TK.Else)) elsePart = parseIfBody();
            match(TK.EndIf);
            return AST.IfStmt(branches, elsePart, s);
        }
        function parseIfBody() {
            if (isBlockOpen()) return parseCompound();
            var stmt = parseStmt();
            match(TK.Semicolon);
            return stmt || AST.Block([], current().span);
        }

        // ---- WHILE ----
        function parseWhile() {
            var s = advance().span;
            var cond = parseExpr();
            var body;
            if (match(TK.Do) || isBlockOpen()) {
                if (isBlockOpen()) { body = parseCompound(); }
                else { var stmts = parseStmtList(); if (match(TK.Wend)) {} else expectBlockClose(); body = AST.Block(stmts, s); }
            } else { body = parseStmt() || AST.Block([], s); }
            return AST.WhileStmt(cond, body, s);
        }

        // ---- REPEAT ----
        function parseRepeat() {
            var s = advance().span;
            var body = isBlockOpen() ? parseCompound() : (parseStmt() || AST.Block([], s));
            expect(TK.Until, 'Expected UNTIL');
            var cond = parseExpr(); match(TK.Semicolon);
            return AST.RepeatStmt(body, cond, s);
        }

        // ---- LOOP ----
        function parseLoop() {
            var s = advance().span;
            var body = isBlockOpen() ? parseCompound() : parseStmt();
            return AST.LoopStmt(body, s);
        }

        // ---- FOR ----
        function parseFor() {
            var s = advance().span;
            var v = expect(TK.Identifier).stringValue;
            expect(TK.Eq, "Expected '='");
            var from = parseNcExpr();
            var down = match(TK.DownTo);
            if (!down) expect(TK.To, 'Expected TO or DOWNTO');
            var to = parseNcExpr();
            var body;
            if (match(TK.Do) || isBlockOpen()) {
                body = parseCompound(); match(TK.Next); match(TK.Semicolon);
            } else {
                body = parseStmt() || AST.Block([], s); match(TK.Next); match(TK.Semicolon);
            }
            return AST.ForStmt(v, from, to, down, body, s);
        }

        // ---- CASE ----
        function parseCase() {
            var s = advance().span;
            var expr = parseExpr(); match(TK.Of); expectBlockOpen();
            var branches = [];
            while (!isBlockClose() && !check(TK.EOF)) {
                if (match(TK.Semicolon)) continue;
                if (check(TK.Others)) {
                    advance(); match(TK.Colon);
                    branches.push(AST.CaseBranch(null, null, parseStmt()));
                } else {
                    var val = parseNcExpr(), rangeEnd = null;
                    var commaValues = [];
                    while (match(TK.Comma)) {
                        commaValues.push(val);
                        val = parseNcExpr();
                    }
                    if (match(TK.To)) rangeEnd = parseNcExpr();
                    match(TK.Colon);
                    var body = parseStmt();
                    // カンマ先行値は body=null（IrGenerator でフォールスルー処理）
                    for (var ci = 0; ci < commaValues.length; ci++)
                        branches.push(AST.CaseBranch(commaValues[ci], null, null));
                    branches.push(AST.CaseBranch(val, rangeEnd, body));
                }
            }
            expectBlockClose();
            return AST.CaseStmt(expr, branches, s);
        }

        // ---- EXIT / RETURN / GOTO ----
        function parseExit() {
            var s = advance().span; var level = null, label = null;
            if (match(TK.To)) label = expect(TK.Identifier).stringValue;
            else if (match(TK.LParen)) { level = parseExpr(); expect(TK.RParen); }
            match(TK.Semicolon);
            return AST.ExitStmt(level, label, s);
        }
        function parseReturn() {
            var s = advance().span; var val = null;
            if (match(TK.LParen)) { val = parseExpr(); expect(TK.RParen); }
            else if (!check(TK.Semicolon) && !isBlockClose() && !check(TK.EOF)) { val = parseExpr(); }
            match(TK.Semicolon);
            return AST.ReturnStmt(val, s);
        }
        function parseGoto() {
            var s = advance().span;
            var lbl = expect(TK.Identifier).stringValue; match(TK.Semicolon);
            return AST.GotoStmt(lbl, s);
        }

        // ---- PRINT ----
        function parsePrint() {
            var s = advance().span;
            expect(TK.LParen, "Expected '('");
            var args = []; _argListDepth++;
            while (!check(TK.RParen) && !check(TK.EOF)) {
                args.push(parsePrintArg());
                if (!match(TK.Comma)) break;
            }
            _argListDepth--;
            expect(TK.RParen, "Expected ')'"); match(TK.Semicolon);
            return AST.PrintStmt(args, s);
        }
        function parsePrintArg() {
            var s = current().span;
            if (check(TK.Slash)) { advance(); return AST.StringFuncExpr('/', [], s); }
            if (check(TK.StringFunc)) {
                var fn = advance().stringValue;
                expect(TK.LParen); var args = parseArgList(); expect(TK.RParen);
                return AST.StringFuncExpr(fn, args, s);
            }
            if (check(TK.Exclamation) && peekAt(1).kind === TK.LParen) {
                advance(); expect(TK.LParen); var args = parseArgList(); expect(TK.RParen);
                return AST.StringFuncExpr('!', args, s);
            }
            if (check(TK.Percent) && peekAt(1).kind === TK.LParen) {
                advance(); expect(TK.LParen); var args = parseArgList(); expect(TK.RParen);
                return AST.StringFuncExpr('%', args, s);
            }
            return parseNcExpr();
        }

        // ---- Expression parsing ----
        function parseExpr() {
            var e = parseAssign();
            while (_argListDepth === 0 && match(TK.Comma)) { e = AST.CommaExpr(e, parseAssign(), e.span); }
            return e;
        }
        function parseNcExpr() { return parseAssign(); }

        function parseAssign() {
            var e = parseConditional();
            if (match(TK.Eq)) return AST.AssignExpr(e, parseAssign(), e.span);
            if (checkAny(TK.PlusEq, TK.MinusEq, TK.StarEq, TK.SlashEq)) {
                var k = current().kind;
                var op = k === TK.PlusEq ? CompoundAssignOp.AddAssign :
                         k === TK.MinusEq ? CompoundAssignOp.SubAssign :
                         k === TK.StarEq ? CompoundAssignOp.MulAssign : CompoundAssignOp.DivAssign;
                advance();
                return AST.CompoundAssignExpr(op, e, parseAssign(), e.span);
            }
            return e;
        }
        function parseConditional() {
            var e = parseLogOr();
            if (match(TK.Question)) { var t = parseNcExpr(); expect(TK.Colon, "Expected ':' in ?:"); return AST.ConditionalExpr(e, t, parseConditional(), e.span); }
            return e;
        }
        function parseLogOr() { var e = parseLogAnd(); while (match(TK.LogOr)) e = AST.BinaryExpr(BinaryOp.LogOr, e, parseLogAnd(), e.span); return e; }
        function parseLogAnd() { var e = parseBitOps(); while (match(TK.LogAnd)) e = AST.BinaryExpr(BinaryOp.LogAnd, e, parseBitOps(), e.span); return e; }
        function parseBitOps() {
            var e = parseEquality();
            while (true) {
                if (match(TK.And) || match(TK.Ampersand)) e = AST.BinaryExpr(BinaryOp.And, e, parseEquality(), e.span);
                else if (match(TK.Or) || match(TK.Pipe)) e = AST.BinaryExpr(BinaryOp.Or, e, parseEquality(), e.span);
                else if (match(TK.Xor)) e = AST.BinaryExpr(BinaryOp.Xor, e, parseEquality(), e.span);
                else break;
            }
            return e;
        }
        function parseEquality() {
            var e = parseComparison();
            while (checkAny(TK.EqEq, TK.NotEq)) {
                var op = current().kind === TK.EqEq ? BinaryOp.Eq : BinaryOp.Neq; advance();
                e = AST.BinaryExpr(op, e, parseComparison(), e.span);
            }
            return e;
        }
        function parseComparison() {
            var e = parseAdd();
            while (true) {
                var op, k = current().kind;
                if (k === TK.Lt) op = BinaryOp.Lt;
                else if (k === TK.Gt) op = BinaryOp.Gt;
                else if (k === TK.Le) op = BinaryOp.Le;
                else if (k === TK.Ge) op = BinaryOp.Ge;
                else if (k === TK.SignedLt) op = BinaryOp.SLt;
                else if (k === TK.SignedGt) op = BinaryOp.SGt;
                else if (k === TK.SignedLe) op = BinaryOp.SLe;
                else if (k === TK.SignedGe) op = BinaryOp.SGe;
                else break;
                advance(); e = AST.BinaryExpr(op, e, parseAdd(), e.span);
            }
            return e;
        }
        function parseAdd() {
            var e = parseMul();
            while (checkAny(TK.Plus, TK.Minus)) {
                var op = current().kind === TK.Plus ? BinaryOp.Add : BinaryOp.Sub; advance();
                e = AST.BinaryExpr(op, e, parseMul(), e.span);
            }
            return e;
        }
        function parseMul() {
            var e = parseUnary();
            while (true) {
                var op, k = current().kind;
                if (k === TK.Star) op = BinaryOp.Mul;
                else if (k === TK.Slash) op = BinaryOp.Div;
                else if (k === TK.Mod) op = BinaryOp.Mod;
                else if (k === TK.Shl) op = BinaryOp.Shl;
                else if (k === TK.Shr) op = BinaryOp.Shr;
                else if (k === TK.SignedMul) op = BinaryOp.SMul;
                else if (k === TK.SignedDiv) op = BinaryOp.SDiv;
                else if (k === TK.SignedMod) op = BinaryOp.SMod;
                else if (k === TK.SignedShl) op = BinaryOp.SShl;
                else if (k === TK.SignedShr) op = BinaryOp.SShr;
                else break;
                advance(); e = AST.BinaryExpr(op, e, parseUnary(), e.span);
            }
            return e;
        }
        function parseUnary() {
            var s = current().span;
            if (checkAny(TK.PlusPlus, TK.MinusMinus)) { var inc = current().kind === TK.PlusPlus; advance(); return AST.IncrementExpr(parseUnary(), inc, true, s); }
            if (match(TK.Minus)) return AST.UnaryExpr(UnaryOp.Negate, parseUnary(), s);
            if (match(TK.Plus)) return AST.UnaryExpr(UnaryOp.Plus, parseUnary(), s);
            if (match(TK.Not)) return AST.UnaryExpr(UnaryOp.Not, parseUnary(), s);
            if (match(TK.Cpl)) return AST.UnaryExpr(UnaryOp.Cpl, parseUnary(), s);
            if (match(TK.Ampersand)) return AST.AddressOfExpr(parseUnary(), s);
            if (check(TK.High)) { advance(); return AST.HighLowExpr(true, parseUnary(), s); }
            if (check(TK.Low)) { advance(); return AST.HighLowExpr(false, parseUnary(), s); }
            if (match(TK.Percent)) return AST.CastExpr(DataSize.Word, parseUnary(), s);
            if (check(TK.Code)) {
                advance(); expect(TK.LParen);
                var codes = parseCodeExprList(); expect(TK.RParen);
                return AST.CodeExpr(codes, s);
            }
            return parsePostfix();
        }
        function parsePostfix() {
            var e = parsePrimary();
            while (true) {
                if (checkAny(TK.PlusPlus, TK.MinusMinus)) {
                    var inc = current().kind === TK.PlusPlus; advance();
                    e = AST.IncrementExpr(e, inc, false, e.span);
                } else if (check(TK.ArrayBracketOpen)) {
                    var indices = [];
                    while (check(TK.ArrayBracketOpen)) { advance(); indices.push(parseNcExpr()); expect(TK.RBracket, "Expected ']'"); }
                    e = AST.ArrayAccessExpr(e, indices, e.span);
                } else if (check(TK.LParen)) {
                    advance();
                    var args = [];
                    if (!check(TK.RParen)) { _argListDepth++; args = parseArgList(); _argListDepth--; }
                    expect(TK.RParen, "Expected ')'");
                    e = AST.CallExpr(e, args, e.span);
                } else break;
            }
            return e;
        }
        function parsePrimary() {
            var s = current().span;
            if (check(TK.IntegerLiteral) || check(TK.CharLiteral)) { var t = advance(); return AST.IntegerLiteral(t.intValue, t.span); }
            if (check(TK.FloatLiteral)) { var t = advance(); return AST.FloatLiteral(t.floatValue, t.span); }
            if (check(TK.StringLiteral)) { var t = advance(); return AST.StringLiteral(t.stringValue, t.span); }
            if (check(TK.Identifier)) {
                var t = advance();
                if (t.text.toUpperCase() === 'TRUE') return AST.IntegerLiteral(1, t.span);
                if (t.text.toUpperCase() === 'FALSE') return AST.IntegerLiteral(0, t.span);
                return AST.IdentifierExpr(t.stringValue, t.span);
            }
            if (match(TK.LParen)) { var e = parseExpr(); expect(TK.RParen, "Expected ')'"); return e; }
            error('Expected expression, got ' + current().kind + " '" + current().text + "'");
            return AST.IntegerLiteral(0, s);
        }

        // ---- Helpers ----
        function parseArgList() { var list = []; do { list.push(parseNcExpr()); } while (match(TK.Comma)); return list; }
        function parseCodeExprList() { var list = []; do { list.push(parseCodeItem()); } while (match(TK.Comma)); return list; }
        function parseCodeItem() {
            var s = current().span;
            if (check(TK.LBracket)) { advance(); var expr = parseNcExpr(); expect(TK.RBracket, "Expected ']'"); return AST.CodeEvalExpr(expr, s); }
            if (check(TK.Lt)) { advance(); var label = expect(TK.Identifier, 'Expected label name').stringValue; expect(TK.Gt, "Expected '>'"); return AST.CodeLabelRef(label, s); }
            if (checkAny(TK.Byte, TK.Exclamation)) { advance(); match(TK.Comma); return AST.CastExpr(DataSize.Byte, parseNcExpr(), s); }
            if (checkAny(TK.Word, TK.Percent)) { advance(); match(TK.Comma); return AST.CastExpr(DataSize.Word, parseNcExpr(), s); }
            return parseNcExpr();
        }
        function parseCodeBlock() { expectBlockOpen(); var list = parseCodeExprList(); expectBlockClose(); return list; }

        // ---- Top-level ----
        function parseTopLevel() {
            var k = current().kind;
            if (k === TK.Org) return parseOrg();
            if (k === TK.Work) return parseWork();
            if (k === TK.Offset) return parseOffset();
            if (k === TK.Plain) return AST.PlainAsm(advance().stringValue, current().span);
            if (k === TK.PreprocIf) return parsePreprocIf();
            if (k === TK.PreprocElse) { advance(); skipPreprocToEnd(); return null; }
            if (k === TK.PreprocEnd || k === TK.PreprocInclude) { advance(); return null; }
            if (k === TK.Const) return parseConstDecl();
            if (k === TK.Var) return parseVarDeclList();
            if (k === TK.Array) return parseArrayDeclList();
            if (k === TK.Machine) return parseMachineDeclList();
            if (k === TK.Byte || k === TK.Word || k === TK.Float || k === TK.Exclamation) return parseVarDeclList();
            if (k === TK.Identifier && isFuncDefStart()) return parseFuncDef();
            if (k === TK.Identifier) { error('Unexpected identifier at top level: ' + current().text); return null; }
            if (k === TK.Module) return parseModuleBlock();
            error('Unexpected token at top level: ' + current().kind + " '" + current().text + "'");
            return null;
        }

        return {
            parseCompilationUnit: function() {
                var defs = [];
                while (!check(TK.EOF) && !_diag.hasReachedMaxErrors) {
                    if (match(TK.Semicolon)) continue;
                    var eb = _diag.errorCount, bp = _pos;
                    var def = parseTopLevel();
                    if (def) defs.push(def);
                    if (_diag.errorCount > eb) syncTopLevel();
                    else if (_pos === bp) advance();
                }
                return AST.CompilationUnit(defs, SourceSpan.Unknown);
            }
        };
    }

    // ================================================================
    // Type System
    // ================================================================

    var PrimitiveKind = { Byte: 'Byte', Word: 'Word', Float: 'Float', Void: 'Void' };

    function PrimitiveType(kind) {
        var sizes = { Byte: 1, Word: 2, Float: 3, Void: 0 };
        return { typeClass: 'Primitive', kind: kind, byteSize: sizes[kind] || 0 };
    }
    function PointerType(elemType) { return { typeClass: 'Pointer', elementType: elemType, byteSize: 2 }; }
    function ArrayType(elemType, dims) {
        var total = 1; for (var i = 0; i < dims.length; i++) total *= dims[i];
        return {
            typeClass: 'Array', elementType: elemType, dimensions: dims,
            rank: dims.length, totalElements: total, byteSize: total * elemType.byteSize,
            getStride: function(dim) {
                var s = elemType.byteSize;
                for (var i = dims.length - 1; i > dim; i--) s *= dims[i];
                return s;
            }
        };
    }
    function FunctionType(retType, paramTypes) { return { typeClass: 'Function', returnType: retType, parameterTypes: paramTypes, byteSize: 2 }; }
    function PortArrayType(elemType) { return { typeClass: 'PortArray', elementType: elemType, byteSize: 0 }; }
    function MemoryArrayType(elemType) { return { typeClass: 'MemoryArray', elementType: elemType, byteSize: 0 }; }

    var SlangType = {
        Word: PrimitiveType(PrimitiveKind.Word),
        Byte: PrimitiveType(PrimitiveKind.Byte),
        Float: PrimitiveType(PrimitiveKind.Float),
        Void: PrimitiveType(PrimitiveKind.Void),
    };

    function dataSizeToType(size) {
        if (size === DataSize.Byte) return SlangType.Byte;
        if (size === DataSize.Float) return SlangType.Float;
        return SlangType.Word;
    }

    // ================================================================
    // Symbol Table
    // ================================================================

    var SymbolKind = {
        Variable: 'Variable', Parameter: 'Parameter', Function: 'Function',
        MachineFunction: 'MachineFunction', Constant: 'Constant', Label: 'Label',
    };

    function Symbol(name, kind, type) {
        return {
            name: name, kind: kind, type: type,
            address: null, offset: 0, constValue: null,
            isGlobal: false, isCodeBlock: false, asmLabel: null, isArrayDecl: false,
            constAst: null, addressAst: null,
            constAsmExpr: null, constAsmDeps: null, constAsmResolved: false,
            addressExpr: null, addressExprDeps: null, addressExprResolved: false,
        };
    }

    function Scope(name, parent) {
        var _symbols = {};
        return {
            name: name, parent: parent, symbols: _symbols,
            define: function(sym) { _symbols[sym.name.toUpperCase()] = sym; },
            resolve: function(n) { var s = _symbols[n.toUpperCase()]; return s || (parent ? parent.resolve(n) : null); },
            resolveLocal: function(n) { return _symbols[n.toUpperCase()] || null; },
        };
    }

    function SymbolTable() {
        var _scopes = [];
        _scopes.push(Scope('global', null));
        return {
            get currentScope() { return _scopes[_scopes.length - 1]; },
            get isGlobalScope() { return _scopes.length === 1; },
            pushScope: function(name) { _scopes.push(Scope(name, _scopes[_scopes.length - 1])); },
            popScope: function() { if (_scopes.length > 1) _scopes.pop(); },
            define: function(name, kind, type) {
                var sym = Symbol(name, kind, type);
                sym.isGlobal = _scopes.length === 1;
                this.currentScope.define(sym);
                return sym;
            },
            resolve: function(name) { return this.currentScope.resolve(name); },
        };
    }

    // ================================================================
    // Const Evaluator
    // ================================================================

    function ConstEvaluator(symbols) {
        function evaluate(expr) {
            if (!expr) return null;
            var t = expr.type;
            if (t === 'IntegerLiteral') return expr.value | 0;
            if (t === 'FloatLiteral' && expr.value === Math.trunc(expr.value)) return expr.value | 0;
            if (t === 'IdentifierExpr') return evalId(expr);
            if (t === 'UnaryExpr') return evalUnary(expr);
            if (t === 'BinaryExpr') return evalBinary(expr);
            if (t === 'HighLowExpr') return evalHighLow(expr);
            if (t === 'CastExpr') return evaluate(expr.operand);
            if (t === 'ConditionalExpr') return evalCond(expr);
            return null;
        }
        function evalId(expr) {
            var n = expr.name.toUpperCase();
            if (n === 'TRUE') return 1; if (n === 'FALSE') return 0;
            if (symbols) { var sym = symbols.resolve(expr.name); if (sym && sym.kind === SymbolKind.Constant && typeof sym.constValue === 'number') return sym.constValue; }
            return null;
        }
        function evalUnary(expr) {
            var v = evaluate(expr.operand); if (v === null) return null;
            if (expr.op === UnaryOp.Negate) return (-v) & 0xFFFF;
            if (expr.op === UnaryOp.Plus) return v;
            if (expr.op === UnaryOp.Not) return v === 0 ? 1 : 0;
            if (expr.op === UnaryOp.Cpl) return (~v) & 0xFFFF;
            return null;
        }
        function evalBinary(expr) {
            var l = evaluate(expr.left), r = evaluate(expr.right);
            if (l === null || r === null) return null;
            var BO = BinaryOp;
            switch (expr.op) {
                case BO.Add: return (l + r) & 0xFFFF;
                case BO.Sub: return (l - r) & 0xFFFF;
                case BO.Mul: return (l * r) & 0xFFFF;
                case BO.Div: return r !== 0 ? (l / r) | 0 : null;
                case BO.Mod: return r !== 0 ? l % r : null;
                case BO.And: return l & r;
                case BO.Or: return l | r;
                case BO.Xor: return l ^ r;
                case BO.Shl: return (l << r) & 0xFFFF;
                case BO.Shr: return (l >>> r) & 0xFFFF;
                case BO.Eq: return l === r ? 1 : 0;
                case BO.Neq: return l !== r ? 1 : 0;
                case BO.Lt: return (l & 0xFFFF) < (r & 0xFFFF) ? 1 : 0;
                case BO.Gt: return (l & 0xFFFF) > (r & 0xFFFF) ? 1 : 0;
                case BO.Le: return (l & 0xFFFF) <= (r & 0xFFFF) ? 1 : 0;
                case BO.Ge: return (l & 0xFFFF) >= (r & 0xFFFF) ? 1 : 0;
                case BO.SLt: return ((l << 16) >> 16) < ((r << 16) >> 16) ? 1 : 0;
                case BO.SGt: return ((l << 16) >> 16) > ((r << 16) >> 16) ? 1 : 0;
                case BO.SLe: return ((l << 16) >> 16) <= ((r << 16) >> 16) ? 1 : 0;
                case BO.SGe: return ((l << 16) >> 16) >= ((r << 16) >> 16) ? 1 : 0;
                case BO.LogAnd: return (l !== 0 && r !== 0) ? 1 : 0;
                case BO.LogOr: return (l !== 0 || r !== 0) ? 1 : 0;
                default: return null;
            }
        }
        function evalHighLow(expr) {
            var v = evaluate(expr.operand); if (v === null) return null;
            return expr.isHigh ? (v >> 8) & 0xFF : v & 0xFF;
        }
        function evalCond(expr) {
            var c = evaluate(expr.condition); if (c === null) return null;
            return c !== 0 ? evaluate(expr.trueExpr) : evaluate(expr.falseExpr);
        }
        return { evaluate: evaluate };
    }

    // ================================================================
    // FuncInfo (local variable allocation)
    // ================================================================

    function FuncInfo(name) {
        var localSize = 0;
        return {
            name: name,
            get localSize() { return localSize; },
            allocLocal: function(byteSize, opts) {
                if (opts && opts.isArray) localSize += byteSize;
                else if (opts && opts.isFloat) localSize += 3;
                else localSize += 2;
                return 0x70 - localSize;
            }
        };
    }

    // ================================================================
    // Semantic Analyzer
    // ================================================================

    function SemanticAnalyzer(diagnostics) {
        var _diag = diagnostics;
        var _symbols = SymbolTable();
        var _constEval = ConstEvaluator(_symbols);
        var _inStaticDecl = false;
        var _currentFuncName = null;
        var _currentFunc = null;

        // ---- Builtins ----
        function defineConst(name, value) {
            var sym = _symbols.define(name, SymbolKind.Constant, SlangType.Word);
            sym.constValue = value; sym.isGlobal = true;
        }
        function defineSysArray(name, elemType) {
            var sym = _symbols.define(name, SymbolKind.Variable, MemoryArrayType(elemType));
            sym.isGlobal = true; sym.asmLabel = '_SYS_' + name;
        }
        defineConst('TRUE', 1); defineConst('FALSE', 0);
        defineSysArray('MEM', SlangType.Byte); defineSysArray('MEMW', SlangType.Word);
        defineSysArray('PORT', SlangType.Byte); defineSysArray('PORTW', SlangType.Word);
        defineSysArray('SOS', SlangType.Byte); defineSysArray('SOSW', SlangType.Word);

        var regVars = ['^BC','^DE','^HL','^IX','^IY','^AF','^SP','^CARRY','^ZERO'];
        for (var ri = 0; ri < regVars.length; ri++) {
            var rn = regVars[ri];
            var rs = _symbols.define(rn, SymbolKind.Variable, SlangType.Word);
            rs.isGlobal = true; rs.asmLabel = '_' + rn.substring(1).toUpperCase();
        }
        var aReg = _symbols.define('^A', SymbolKind.Variable, SlangType.Word); aReg.isGlobal = true; aReg.asmLabel = '_A';
        var cyReg = _symbols.define('^CY', SymbolKind.Variable, SlangType.Word); cyReg.isGlobal = true; cyReg.asmLabel = '_CARRY';
        var kbuff = _symbols.define('@KBUFF', SymbolKind.Variable, SlangType.Word); kbuff.isGlobal = true; kbuff.asmLabel = '_KBUFF';

        var builtinFuncs = [
            ['BEEP',0],['STOP',0],['LOCATE',2],['INKEY',1],
            ['INPUT',0],['GETL',1],['GETLIN',2],['LINPUT',2],
            ['WIDTH',1],['SCREEN',2],['PRMODE',1],
            ['BIT',2],['SET',2],['RESET',2],
            ['ABS',1],['SEX',1],['SGN',1],['RND',1],
            ['VTOS',2],['GETREG',0],['CALL',1],
        ];
        for (var bi = 0; bi < builtinFuncs.length; bi++) {
            var bn = builtinFuncs[bi][0], bpc = builtinFuncs[bi][1];
            var bpt = []; for (var j = 0; j < bpc; j++) bpt.push(SlangType.Word);
            var bsym = _symbols.define(bn, SymbolKind.MachineFunction, FunctionType(SlangType.Word, bpt));
            bsym.isGlobal = true; bsym.asmLabel = bn;
        }

        // ---- Visit helpers ----
        function visitChildren(node) {
            if (!node) return;
            var t = node.type;
            if (t === 'CompilationUnit') { for (var i = 0; i < node.definitions.length; i++) visit(node.definitions[i]); }
            else if (t === 'Block') { for (var i = 0; i < node.statements.length; i++) visit(node.statements[i]); }
            else if (t === 'IfStmt') {
                for (var i = 0; i < node.branches.length; i++) { visit(node.branches[i].condition); visit(node.branches[i].body); }
                if (node.elseBody) visit(node.elseBody);
            }
            else if (t === 'WhileStmt') { visit(node.condition); visit(node.body); }
            else if (t === 'RepeatStmt') { visit(node.body); visit(node.condition); }
            else if (t === 'LoopStmt') { visit(node.body); }
            else if (t === 'ForStmt') { visit(node.from); visit(node.to); visit(node.body); }
            else if (t === 'CaseStmt') {
                visit(node.expr);
                for (var i = 0; i < node.branches.length; i++) {
                    if (node.branches[i].value) visit(node.branches[i].value);
                    if (node.branches[i].rangeEnd) visit(node.branches[i].rangeEnd);
                    if (node.branches[i].body) visit(node.branches[i].body);
                }
            }
            else if (t === 'ExpressionStmt') { visit(node.expr); }
            else if (t === 'PrintStmt') { for (var i = 0; i < node.arguments.length; i++) visit(node.arguments[i]); }
            else if (t === 'ReturnStmt') { if (node.value) visit(node.value); }
            else if (t === 'ExitStmt') { if (node.level) visit(node.level); }
            else if (t === 'BinaryExpr') { visit(node.left); visit(node.right); }
            else if (t === 'UnaryExpr') { visit(node.operand); }
            else if (t === 'AssignExpr') { visit(node.target); visit(node.value); }
            else if (t === 'CompoundAssignExpr') { visit(node.target); visit(node.value); }
            else if (t === 'IncrementExpr') { visit(node.operand); }
            else if (t === 'CallExpr') { visit(node.func); for (var i = 0; i < node.arguments.length; i++) visit(node.arguments[i]); }
            else if (t === 'ArrayAccessExpr') { visit(node.array); for (var i = 0; i < node.indices.length; i++) visit(node.indices[i]); }
            else if (t === 'ConditionalExpr') { visit(node.condition); visit(node.trueExpr); visit(node.falseExpr); }
            else if (t === 'CommaExpr') { visit(node.left); visit(node.right); }
            else if (t === 'AddressOfExpr') { visit(node.operand); }
            else if (t === 'HighLowExpr') { visit(node.operand); }
            else if (t === 'CastExpr') { visit(node.operand); }
            else if (t === 'CodeExpr') { for (var i = 0; i < node.values.length; i++) visit(node.values[i]); }
            else if (t === 'StringFuncExpr') { for (var i = 0; i < node.arguments.length; i++) visit(node.arguments[i]); }
            else if (t === 'ModuleBlock') { for (var i = 0; i < node.definitions.length; i++) visit(node.definitions[i]); }
        }

        function visit(node) {
            if (!node) return;
            var t = node.type;

            if (t === 'VarDecl') {
                var type = dataSizeToType(node.size);
                var sym = _symbols.define(node.name, SymbolKind.Variable, type);
                if (_currentFunc && !_symbols.isGlobalScope && !_inStaticDecl) {
                    sym.isGlobal = false;
                    sym.offset = _currentFunc.allocLocal(type.byteSize, { isFloat: node.size === DataSize.Float });
                } else {
                    sym.isGlobal = true;
                    sym.asmLabel = (_inStaticDecl && _currentFuncName)
                        ? staticVarLabel(_currentFuncName, node.name) : userVarLabel(node.name);
                }
                if (node.initialValue) visit(node.initialValue);
                return;
            }

            if (t === 'ArrayDecl') {
                var elemType = dataSizeToType(node.size);
                var dims = [];
                for (var i = 0; i < node.dimensions.length; i++) {
                    if (node.dimensions[i] === null) dims.push(0);
                    else { var v = _constEval.evaluate(node.dimensions[i]); dims.push(v !== null ? v + 1 : 1); }
                }
                var atype;
                if (dims.every(function(d) { return d === 0; })) atype = PointerType(elemType);
                else atype = ArrayType(elemType, dims);
                var sym = _symbols.define(node.name, SymbolKind.Variable, atype);
                if (node.isArrayKeyword) sym.isArrayDecl = true;
                if (_currentFunc && !_symbols.isGlobalScope && !_inStaticDecl) {
                    sym.isGlobal = false;
                    sym.offset = _currentFunc.allocLocal(atype.byteSize, { isArray: true });
                } else {
                    sym.isGlobal = true;
                    sym.asmLabel = (_inStaticDecl && _currentFuncName)
                        ? staticVarLabel(_currentFuncName, node.name) : userVarLabel(node.name);
                }
                return;
            }

            if (t === 'ConstDecl') {
                if (node.value && node.value.type === 'CodeExpr') {
                    var sym = _symbols.define(node.name, SymbolKind.Variable, SlangType.Word);
                    sym.isGlobal = true; sym.isCodeBlock = true;
                    sym.asmLabel = (_inStaticDecl && _currentFuncName)
                        ? staticVarLabel(_currentFuncName, node.name) : userVarLabel(node.name);
                } else {
                    var sym = _symbols.define(node.name, SymbolKind.Constant, SlangType.Word);
                    var val = _constEval.evaluate(node.value);
                    if (val !== null) sym.constValue = val;
                    else sym.constAst = node.value;
                }
                return;
            }

            if (t === 'MachineDecl') {
                var paramTypes = [];
                if (node.paramCount !== null) { for (var i = 0; i < node.paramCount; i++) paramTypes.push(SlangType.Word); }
                var sym = _symbols.define(node.name, SymbolKind.MachineFunction, FunctionType(SlangType.Word, paramTypes));
                sym.isGlobal = true; sym.asmLabel = '_' + sanitizeLabel(node.name);
                if (node.address) sym.addressAst = node.address;
                if (node.staticDeclarations && node.staticDeclarations.length > 0) {
                    _currentFuncName = node.name; _inStaticDecl = true;
                    for (var i = 0; i < node.staticDeclarations.length; i++) visit(node.staticDeclarations[i]);
                    _inStaticDecl = false; _currentFuncName = null;
                }
                return;
            }

            if (t === 'FuncDef') {
                var paramTypes = node.parameters.map(function(p) { return dataSizeToType(p.size); });
                var funcSym = _symbols.define(node.name, SymbolKind.Function, FunctionType(SlangType.Word, paramTypes));
                funcSym.isGlobal = true; funcSym.asmLabel = sanitizeLabel(node.name);
                _symbols.pushScope(node.name);
                var prevFunc = _currentFunc;
                _currentFunc = FuncInfo(node.name);
                var argOff = 0x70;
                for (var i = 0; i < node.parameters.length; i++) {
                    var p = node.parameters[i];
                    var pSym = _symbols.define(p.name, SymbolKind.Parameter, dataSizeToType(p.size));
                    pSym.isGlobal = false; pSym.offset = argOff; argOff += 2;
                }
                _currentFuncName = node.name; _inStaticDecl = true;
                for (var i = 0; i < node.staticDeclarations.length; i++) visit(node.staticDeclarations[i]);
                _inStaticDecl = false;
                for (var i = 0; i < node.localDeclarations.length; i++) visit(node.localDeclarations[i]);
                visit(node.body);
                funcSym.constValue = _currentFunc;
                _currentFunc = prevFunc; _symbols.popScope();
                return;
            }

            // Default: visit children
            visitChildren(node);
        }

        return {
            symbols: _symbols,
            constEval: _constEval,
            analyze: function(unit) { visit(unit); },
        };
    }

    // ================================================================
    // IR (Intermediate Representation)
    // ================================================================

    var IrOp = {
        // Data movement
        LoadConst: 'LoadConst', LoadVar: 'LoadVar', StoreVar: 'StoreVar',
        LoadLocal: 'LoadLocal', StoreLocal: 'StoreLocal',
        LoadAddr: 'LoadAddr', LoadIndirect: 'LoadIndirect', StoreIndirect: 'StoreIndirect',
        // Arithmetic
        Add: 'Add', Sub: 'Sub', Mul: 'Mul', Div: 'Div', Mod: 'Mod',
        SMul: 'SMul', SDiv: 'SDiv', SMod: 'SMod', Neg: 'Neg',
        // Bitwise
        And: 'And', Or: 'Or', Xor: 'Xor', Not: 'Not',
        Shl: 'Shl', Shr: 'Shr', SShl: 'SShl', SShr: 'SShr',
        // Comparison
        CmpEq: 'CmpEq', CmpNeq: 'CmpNeq',
        CmpLt: 'CmpLt', CmpGt: 'CmpGt', CmpLe: 'CmpLe', CmpGe: 'CmpGe',
        CmpSLt: 'CmpSLt', CmpSGt: 'CmpSGt', CmpSLe: 'CmpSLe', CmpSGe: 'CmpSGe',
        // Logical
        LogAnd: 'LogAnd', LogOr: 'LogOr', LogNot: 'LogNot',
        // High/Low
        High: 'High', Low: 'Low',
        // Array
        ArrayLoad: 'ArrayLoad', ArrayStore: 'ArrayStore',
        // Memory
        MemLoad: 'MemLoad', MemStore: 'MemStore',
        // Indirect
        IndirLoad: 'IndirLoad', IndirStore: 'IndirStore',
        // Port I/O
        PortIn: 'PortIn', PortOut: 'PortOut',
        // Control flow
        Label: 'Label', Jump: 'Jump', JumpIfZero: 'JumpIfZero', JumpIfNonZero: 'JumpIfNonZero',
        Call: 'Call', Return: 'Return',
        // Function
        FuncBegin: 'FuncBegin', FuncEnd: 'FuncEnd',
        PushArg: 'PushArg', PopResult: 'PopResult',
        // Stack
        Push: 'Push', Pop: 'Pop',
        // Inline assembly
        InlineAsm: 'InlineAsm',
        // Special
        Nop: 'Nop', Comment: 'Comment',
        // Data definition
        DefByte: 'DefByte', DefWord: 'DefWord', DefString: 'DefString',
    };

    var IrOperandKind = {
        None: 'None', Immediate: 'Immediate', Symbol: 'Symbol',
        Temp: 'Temp', Label: 'Label', AsmString: 'AsmString',
    };

    var IrOperand = {
        None: { kind: IrOperandKind.None, immediateValue: 0, name: null, tempIndex: -1 },
        Imm: function(v) { return { kind: IrOperandKind.Immediate, immediateValue: v, name: null, tempIndex: -1 }; },
        Sym: function(n) { return { kind: IrOperandKind.Symbol, immediateValue: 0, name: n, tempIndex: -1 }; },
        Temp: function(i) { return { kind: IrOperandKind.Temp, immediateValue: 0, name: null, tempIndex: i }; },
        Lbl: function(n) { return { kind: IrOperandKind.Label, immediateValue: 0, name: n, tempIndex: -1 }; },
        Asm: function(t) { return { kind: IrOperandKind.AsmString, immediateValue: 0, name: t, tempIndex: -1 }; },
    };

    function IrInstruction(op, dest, src1, src2, dataSize) {
        return { op: op, dest: dest || IrOperand.None, src1: src1 || IrOperand.None, src2: src2 || IrOperand.None, dataSize: dataSize || 2 };
    }

    function IrFunction(name) {
        var tempCount = 0;
        var insts = [];
        return {
            name: name || '',
            get instructions() { return insts; },
            get tempCount() { return tempCount; },
            set tempCount(v) { tempCount = v; },
            localSize: 0,
            allocTemp: function() { return tempCount++; },
            emit: function(op, dest, src1, src2, ds) {
                insts.push(IrInstruction(op, dest, src1, src2, ds));
            },
        };
    }

    var VarStorageKind = { Bss: 'Bss', InitArray: 'InitArray', CodeConst: 'CodeConst' };

    function InitItem(byteValue, asmExpr) {
        return { byteValue: asmExpr ? null : byteValue, asmExpr: asmExpr || null, byteSize: asmExpr ? 2 : 1 };
    }

    function GlobalVarInfo(name, asmLabel, byteSize) {
        return {
            name: name, asmLabel: asmLabel, byteSize: byteSize || 2,
            fixedAddress: null, fixedAddressLabel: null,
            initialItems: null, isArray: false,
            storageKind: VarStorageKind.Bss,
            get hasInitializer() { return this.initialItems && this.initialItems.length > 0; },
        };
    }

    function IrModule() {
        return {
            functions: [], globalData: [], stringTable: {},
            globalVars: [], orgAddress: null, workAddress: null, offsetAddress: null,
            overlays: [], addressSymbolDeps: {},
        };
    }

    // ================================================================
    // ExprToAsmString: AST Expression → assembler expression string
    // (LabelUtils.ExprToAsmString equivalent)
    // ================================================================
    function exprToAsmString(expr, symbols, diagnostics) {
        var deps = [];
        function convert(e) {
            if (!e) return null;
            if (e.type === 'IntegerLiteral') {
                var hex = (e.value & 0xFFFF).toString(16).toUpperCase();
                while (hex.length < 4) hex = '0' + hex;
                return '$' + hex;
            }
            if (e.type === 'IdentifierExpr') {
                var sym = symbols ? symbols.resolve(e.name) : null;
                if (sym) {
                    if (typeof sym.constValue === 'number') {
                        var hex2 = (sym.constValue & 0xFFFF).toString(16).toUpperCase();
                        while (hex2.length < 4) hex2 = '0' + hex2;
                        return '$' + hex2;
                    }
                    if (sym.constAst && !sym.constAsmResolved) {
                        sym.constAsmResolved = true;
                        var inner = exprToAsmString(sym.constAst, symbols, diagnostics);
                        if (inner) { sym.constAsmExpr = inner.expr; sym.constAsmDeps = inner.deps; }
                    }
                    if (sym.constAsmExpr) {
                        if (sym.constAsmDeps) for (var d = 0; d < sym.constAsmDeps.length; d++) deps.push(sym.constAsmDeps[d]);
                        return sym.constAsmExpr;
                    }
                    if (sym.isCodeBlock || sym.isGlobal || sym.kind === SymbolKind.Function || sym.kind === SymbolKind.MachineFunction) {
                        var label = sym.asmLabel || sanitizeLabel(e.name);
                        deps.push(label);
                        return label;
                    }
                    if (diagnostics) diagnostics.error("'" + e.name + "' cannot be used in MACHINE/CONST address expression", e.span);
                    return null;
                }
                var extLabel = sanitizeLabel(e.name);
                deps.push(extLabel);
                return extLabel;
            }
            if (e.type === 'BinaryExpr' && (e.op === BinaryOp.Add || e.op === BinaryOp.Sub)) {
                var left = convert(e.left);
                var right = convert(e.right);
                if (left === null || right === null) return null;
                return left + (e.op === BinaryOp.Add ? '+' : '-') + right;
            }
            if (e.type === 'BinaryExpr') {
                var ce = symbols ? ConstEvaluator(symbols) : null;
                var cv = ce ? ce.evaluate(e) : null;
                if (cv !== null) {
                    var hex3 = (cv & 0xFFFF).toString(16).toUpperCase();
                    while (hex3.length < 4) hex3 = '0' + hex3;
                    return '$' + hex3;
                }
                if (diagnostics) diagnostics.error('Unsupported expression in MACHINE/CONST address: ' + e.type, e.span);
                return null;
            }
            if (diagnostics) diagnostics.error('Unsupported expression in MACHINE/CONST address: ' + e.type, e.span);
            return null;
        }
        var result = convert(expr);
        return result !== null ? { expr: result, deps: deps } : null;
    }

    // ================================================================
    // IrGenerator: AST → IR conversion
    // ================================================================
    function IrGenerator(diagnostics, globalSymbols) {
        var _module = IrModule();
        var _currentFunction = null;
        var _labelCount = 0;
        var _inStaticDecl = false;
        var _currentFuncName = null;
        var _emitToGlobalData = false;
        var _localVars = null;
        var _staticVarLabels = null;
        var _staticVarSizes = null;
        var _staticElemSizes = null;
        var _staticVarKinds = null;
        var _localOffset = 0;
        var _tempDataSize = {};
        var _floatConstCount = 0;
        var _loopStack = [];

        var VarKind = { Scalar: 'Scalar', Array: 'Array', Pointer: 'Pointer' };

        function allocTemp() { return _currentFunction ? _currentFunction.allocTemp() : 0; }
        function newLabel() { return '_L' + (_labelCount++); }

        function emit(op, dest, src1, src2, dataSize) {
            var inst = IrInstruction(op, dest || IrOperand.None, src1 || IrOperand.None, src2 || IrOperand.None, dataSize || 2);
            if (_emitToGlobalData || !_currentFunction)
                _module.globalData.push(inst);
            else
                _currentFunction.instructions.push(inst);
        }

        function emitInlinePrint(text) {
            var dbArgs = toAsmDbArgs(text);
            emit(IrOp.InlineAsm, IrOperand.Asm('\tCALL\tMPRNT\n\tDB\t' + dbArgs + ',0'));
        }

        // --- Short-circuit helpers ---
        function canShortCircuit(expr) {
            if (!expr || !expr.type) return false;
            if (expr.type === 'BinaryExpr') {
                if (expr.op === BinaryOp.And || expr.op === BinaryOp.LogAnd || expr.op === BinaryOp.LogOr)
                    return isComparisonOrChain(expr.left) && isComparisonOrChain(expr.right);
            }
            return false;
        }
        function isComparisonOrChain(expr) {
            if (!expr || !expr.type) return false;
            if (expr.type === 'BinaryExpr') {
                var op = expr.op;
                if (op === BinaryOp.Eq || op === BinaryOp.Neq ||
                    op === BinaryOp.Lt || op === BinaryOp.Gt || op === BinaryOp.Le || op === BinaryOp.Ge ||
                    op === BinaryOp.SLt || op === BinaryOp.SGt || op === BinaryOp.SLe || op === BinaryOp.SGe)
                    return true;
                if (op === BinaryOp.And || op === BinaryOp.LogAnd || op === BinaryOp.LogOr)
                    return isComparisonOrChain(expr.left) && isComparisonOrChain(expr.right);
            }
            return false;
        }
        function emitShortCircuitJump(expr, falseLabel) {
            if (expr.type === 'BinaryExpr' && (expr.op === BinaryOp.And || expr.op === BinaryOp.LogAnd)) {
                emitShortCircuitJump(expr.left, falseLabel);
                emitShortCircuitJump(expr.right, falseLabel);
            } else if (expr.type === 'BinaryExpr' && expr.op === BinaryOp.LogOr) {
                var trueLabel = newLabel();
                emitShortCircuitJumpIfTrue(expr.left, trueLabel);
                emitShortCircuitJump(expr.right, falseLabel);
                emit(IrOp.Label, IrOperand.Lbl(trueLabel));
            } else {
                var val = visitNode(expr);
                emit(IrOp.JumpIfZero, IrOperand.Lbl(falseLabel), val);
            }
        }
        function emitShortCircuitJumpIfTrue(expr, trueLabel) {
            if (expr.type === 'BinaryExpr' && expr.op === BinaryOp.LogOr) {
                emitShortCircuitJumpIfTrue(expr.left, trueLabel);
                emitShortCircuitJumpIfTrue(expr.right, trueLabel);
            } else if (expr.type === 'BinaryExpr' && (expr.op === BinaryOp.And || expr.op === BinaryOp.LogAnd)) {
                var skipLabel = newLabel();
                emitShortCircuitJump(expr.left, skipLabel);
                emitShortCircuitJumpIfTrue(expr.right, trueLabel);
                emit(IrOp.Label, IrOperand.Lbl(skipLabel));
            } else {
                var val = visitNode(expr);
                emit(IrOp.JumpIfNonZero, IrOperand.Lbl(trueLabel), val);
            }
        }

        // --- VarInfo resolution ---
        function resolveAsmLabel(name) {
            if (_staticVarLabels) {
                var key = name.toUpperCase();
                if (_staticVarLabels[key] !== undefined) return _staticVarLabels[key];
            }
            var sym = globalSymbols ? globalSymbols.resolve(name) : null;
            return (sym && sym.asmLabel) ? sym.asmLabel : userVarLabel(name);
        }

        function resolveVarInfo(name) {
            // 1. Local variable
            if (_localVars) {
                var key = name.toUpperCase();
                if (_localVars[key] !== undefined) {
                    var li = _localVars[key];
                    var varDs = li.byteSize;
                    var elemSz = li.kind === VarKind.Scalar ? varDs : (li.isByte ? 1 : 2);
                    return { kind: li.kind, elemSize: elemSz, varDataSize: varDs, local: li, globalSym: null, isResolved: true };
                }
            }
            // 2. Static variable
            if (_staticVarSizes) {
                var key2 = name.toUpperCase();
                if (_staticVarSizes[key2] !== undefined) {
                    var kind = (_staticVarKinds && _staticVarKinds[key2] !== undefined) ? _staticVarKinds[key2] : VarKind.Scalar;
                    var varDs2 = _staticVarSizes[key2];
                    var elemSz2 = kind === VarKind.Scalar ? varDs2 : ((_staticElemSizes && _staticElemSizes[key2] !== undefined) ? _staticElemSizes[key2] : 2);
                    return { kind: kind, elemSize: elemSz2, varDataSize: varDs2, local: null, globalSym: null, isResolved: true };
                }
            }
            // 3. Global symbol
            var sym = globalSymbols ? globalSymbols.resolve(name) : null;
            if (sym) {
                var isByte = false;
                if (sym.type && sym.type.typeClass === 'Array') isByte = sym.type.elementType === SlangType.Byte;
                else if (sym.type && sym.type.typeClass === 'Pointer') isByte = sym.type.elementType === SlangType.Byte;
                var kind2;
                if (sym.type && sym.type.typeClass === 'Pointer' && !sym.isArrayDecl) kind2 = VarKind.Pointer;
                else if ((sym.type && sym.type.typeClass === 'Array') || sym.isArrayDecl) kind2 = VarKind.Array;
                else kind2 = VarKind.Scalar;
                var varDs3 = (sym.type && sym.type.byteSize) ? sym.type.byteSize : 2;
                var elemSz3 = kind2 === VarKind.Scalar ? varDs3 : (isByte ? 1 : 2);
                return { kind: kind2, elemSize: elemSz3, varDataSize: varDs3, local: null, globalSym: sym, isResolved: true };
            }
            // 4. Unresolved
            return { kind: VarKind.Scalar, elemSize: 2, varDataSize: 2, local: null, globalSym: null, isResolved: false };
        }

        function checkDefined(name, span) {
            var vi = resolveVarInfo(name);
            if (!vi.isResolved) {
                if (diagnostics) diagnostics.error('Undefined variable: ' + name, span);
            }
            return vi;
        }

        function allocLocalVar(name, byteSize) {
            var allocSize = byteSize <= 2 ? 2 : byteSize;
            _localOffset += allocSize;
            var offset = 0x70 - _localOffset;
            _localVars[name.toUpperCase()] = { offset: offset, byteSize: allocSize, kind: VarKind.Scalar, isByte: false, dims: null };
            return offset;
        }

        // --- Loop stack ---
        function pushLoop(cont, brk) { _loopStack.push({ continueLabel: cont, breakLabel: brk }); }
        function popLoop() { _loopStack.pop(); }
        function getBreakLabel() { return _loopStack.length > 0 ? _loopStack[_loopStack.length - 1].breakLabel : null; }
        function getContinueLabel() { return _loopStack.length > 0 ? _loopStack[_loopStack.length - 1].continueLabel : null; }

        // --- Stride computation helpers ---
        function computeStrides(arraySym, indexCount, arrayName) {
            var strides = [];
            if (arraySym && arraySym.type && arraySym.type.typeClass === 'Array') {
                for (var i = 0; i < indexCount; i++) strides.push(arraySym.type.getStride(i));
            } else {
                var elemSize = arrayName ? resolveVarInfo(arrayName).elemSize : 2;
                for (var i = 0; i < indexCount; i++) strides.push(elemSize);
            }
            return strides;
        }
        function computeStridesFromDims(dims, elemSize, indexCount) {
            var strides = [];
            for (var i = 0; i < indexCount && i < dims.length; i++) {
                var stride = elemSize;
                for (var j = dims.length - 1; j > i; j--) stride *= dims[j];
                strides.push(stride);
            }
            return strides;
        }
        function tryComputeLocalArrayOffset(localInfo, indices, strides, elemSize) {
            var constEval = globalSymbols ? ConstEvaluator(globalSymbols) : null;
            if (!constEval) return null;
            var totalOffset = localInfo.offset;
            for (var i = 0; i < indices.length && i < strides.length; i++) {
                var constIdx = constEval.evaluate(indices[i]);
                if (constIdx === null) return null;
                totalOffset += constIdx * strides[i];
            }
            var maxOffset = 127 - (elemSize - 1);
            if (totalOffset < 0 || totalOffset > maxOffset) return null;
            return totalOffset;
        }
        function tryComputeConstArrayOffset(indices, strides) {
            var constEval = globalSymbols ? ConstEvaluator(globalSymbols) : null;
            if (!constEval) return null;
            var totalOffset = 0;
            for (var i = 0; i < indices.length && i < strides.length; i++) {
                var constIdx = constEval.evaluate(indices[i]);
                if (constIdx === null) return null;
                totalOffset += constIdx * strides[i];
            }
            if (totalOffset < 0) return null;
            return totalOffset;
        }

        // --- Type conversion helper ---
        function emitTypeConversion(value, targetDs) {
            var valueDs = (value.kind === IrOperandKind.Temp && _tempDataSize[value.tempIndex] !== undefined) ? _tempDataSize[value.tempIndex] : 2;
            if (targetDs === 3 && valueDs !== 3) {
                var conv = IrOperand.Temp(allocTemp());
                emit(IrOp.Call, conv, IrOperand.Sym('i16tof24'), IrOperand.Imm(0), 3);
                _tempDataSize[conv.tempIndex] = 3;
                return conv;
            } else if (targetDs !== 3 && valueDs === 3) {
                var conv2 = IrOperand.Temp(allocTemp());
                emit(IrOp.Call, conv2, IrOperand.Sym('FTOI'), IrOperand.Imm(0));
                _tempDataSize[conv2.tempIndex] = 2;
                return conv2;
            }
            return value;
        }

        // --- EmitStore ---
        function emitStore(target, value) {
            if (target.type === 'IdentifierExpr') {
                var vi = checkDefined(target.name, target.span);
                var storeDs = vi.varDataSize;
                value = emitTypeConversion(value, storeDs);
                if (vi.local)
                    emit(IrOp.StoreLocal, IrOperand.Imm(vi.local.offset), value, undefined, storeDs);
                else
                    emit(IrOp.StoreVar, IrOperand.Sym(resolveAsmLabel(target.name)), value, undefined, storeDs);
            } else if (target.type === 'ArrayAccessExpr') {
                var arrayName = (target.array && target.array.type === 'IdentifierExpr') ? target.array.name : null;
                // shape統一用fallback — checkDefined対象外（arrayNameがnullの場合のみ）
                var stVi = arrayName ? checkDefined(arrayName, target.array.span) : { kind: VarKind.Scalar, elemSize: 2, varDataSize: 2, local: null, globalSym: null, isResolved: false };
                var arraySym = stVi.globalSym;
                var isMemArray = arraySym && arraySym.type && arraySym.type.typeClass === 'MemoryArray';
                var isByteAccess = isMemArray && arraySym.type.elementType === SlangType.Byte;
                var isIndirect = stVi.kind === VarKind.Pointer;
                var isIndirectByte = isIndirect && stVi.elemSize === 1;

                var isPortArray = arrayName && (arrayName.toUpperCase() === 'PORT' || arrayName.toUpperCase() === 'PORTW');
                var isPortByte = arrayName && arrayName.toUpperCase() === 'PORT';

                if (isPortArray) {
                    var addr = visitNode(target.indices[0]);
                    emit(IrOp.PortOut, addr, value, undefined, isPortByte ? 1 : 2);
                } else if (isMemArray) {
                    var addr2 = visitNode(target.indices[0]);
                    emit(IrOp.MemStore, addr2, value, undefined, isByteAccess ? 1 : 2);
                } else if (isIndirect) {
                    var baseAddr = IrOperand.Temp(allocTemp());
                    if (stVi.local)
                        emit(IrOp.LoadLocal, baseAddr, IrOperand.Imm(stVi.local.offset));
                    else
                        emit(IrOp.LoadVar, baseAddr, IrOperand.Sym(resolveAsmLabel(arrayName)));
                    var idx = visitNode(target.indices[0]);
                    var elemSz = stVi.elemSize;
                    var scaledIdx;
                    if (elemSz === 1) scaledIdx = idx;
                    else { scaledIdx = IrOperand.Temp(allocTemp()); emit(IrOp.Add, scaledIdx, idx, idx); }
                    var addrI = IrOperand.Temp(allocTemp());
                    emit(IrOp.Add, addrI, baseAddr, scaledIdx);
                    emit(IrOp.IndirStore, addrI, value, undefined, elemSz);
                } else {
                    // Normal array store (multidimensional)
                    var storeIsByte = stVi.kind === VarKind.Array && stVi.elemSize === 1;
                    var strides;
                    var stArrLi = stVi.local;
                    var isLocalStoreArray = stArrLi && stArrLi.kind === VarKind.Array && stArrLi.dims;
                    if (isLocalStoreArray) {
                        strides = computeStridesFromDims(stArrLi.dims, stArrLi.isByte ? 1 : 2, target.indices.length);
                        storeIsByte = stArrLi.isByte;
                    } else {
                        strides = computeStrides(arraySym, target.indices.length, arrayName);
                    }

                    var localStoreHandled = false;
                    if (isLocalStoreArray) {
                        var elemSz2 = stArrLi.isByte ? 1 : 2;
                        var directOff = tryComputeLocalArrayOffset(stArrLi, target.indices, strides, elemSz2);
                        if (directOff !== null) {
                            emit(IrOp.StoreLocal, IrOperand.Imm(directOff), value, undefined, elemSz2);
                            localStoreHandled = true;
                        }
                    }

                    if (!localStoreHandled && !isLocalStoreArray && arrayName && stVi.kind === VarKind.Array) {
                        var gElemSize = storeIsByte ? 1 : 2;
                        var globalOff = tryComputeConstArrayOffset(target.indices, strides);
                        if (globalOff !== null) {
                            var label = resolveAsmLabel(arrayName);
                            var sym2 = globalOff === 0 ? label : label + '+' + globalOff;
                            emit(IrOp.StoreVar, IrOperand.Sym(sym2), value, undefined, gElemSize);
                            localStoreHandled = true;
                        }
                    }

                    if (!localStoreHandled) {
                        var baseAddr2;
                        if (arrayName) {
                            baseAddr2 = IrOperand.Temp(allocTemp());
                            if (isLocalStoreArray) {
                                var hexOff = stArrLi.offset.toString(16).toUpperCase();
                                while (hexOff.length < 4) hexOff = '0' + hexOff;
                                emit(IrOp.InlineAsm, baseAddr2, IrOperand.Asm('\tPUSH\tIY\n\tPOP\tHL\n\tLD\tDE,$' + hexOff + '\n\tADD\tHL,DE'));
                            } else if (stVi.local) {
                                emit(IrOp.LoadLocal, baseAddr2, IrOperand.Imm(stVi.local.offset));
                            } else if (stVi.kind === VarKind.Pointer) {
                                emit(IrOp.LoadVar, baseAddr2, IrOperand.Sym(resolveAsmLabel(arrayName)));
                            } else {
                                emit(IrOp.LoadAddr, baseAddr2, IrOperand.Sym(resolveAsmLabel(arrayName)));
                            }
                        } else {
                            baseAddr2 = visitNode(target.array);
                        }

                        var addrS = baseAddr2;
                        for (var si = 0; si < target.indices.length; si++) {
                            var idxS = visitNode(target.indices[si]);
                            var strideS = strides[si];
                            var scaledS = IrOperand.Temp(allocTemp());
                            if (strideS === 1) scaledS = idxS;
                            else if (strideS === 2) emit(IrOp.Add, scaledS, idxS, idxS);
                            else {
                                var strOp = IrOperand.Temp(allocTemp());
                                emit(IrOp.LoadConst, strOp, IrOperand.Imm(strideS));
                                emit(IrOp.Mul, scaledS, idxS, strOp);
                            }
                            var newAddrS = IrOperand.Temp(allocTemp());
                            emit(IrOp.Add, newAddrS, addrS, scaledS);
                            addrS = newAddrS;
                        }
                        emit(IrOp.IndirStore, addrS, value, undefined, storeIsByte ? 1 : 2);
                    }
                }
            } else {
                var addrT = visitNode(target);
                emit(IrOp.StoreIndirect, addrT, value);
            }
        }

        // --- BuildCodeBlockItems ---
        function buildCodeBlockItems(codeExpr) {
            var initItems = [];
            var vals = codeExpr.values;
            for (var vi = 0; vi < vals.length; vi++) {
                var initExpr = vals[vi];
                var itemSize = 1;
                if (initExpr.type === 'CastExpr') {
                    itemSize = initExpr.targetSize === DataSize.Byte ? 1 : (initExpr.targetSize === DataSize.Float ? 3 : 2);
                    initExpr = initExpr.operand;
                }
                var constEval2 = globalSymbols ? ConstEvaluator(globalSymbols) : null;
                var constVal2 = constEval2 ? constEval2.evaluate(initExpr) : null;
                if (initExpr.type === 'IntegerLiteral') constVal2 = initExpr.value | 0;

                if (constVal2 !== null) {
                    var v = constVal2;
                    if (itemSize === 1) initItems.push(InitItem(v & 0xFF));
                    else { initItems.push(InitItem(v & 0xFF)); initItems.push(InitItem((v >> 8) & 0xFF)); }
                } else if (initExpr.type === 'StringLiteral') {
                    for (var ci = 0; ci < initExpr.value.length; ci++)
                        initItems.push(InitItem(initExpr.value.charCodeAt(ci) & 0xFF));
                } else {
                    var asmResult = exprToAsmString(initExpr, globalSymbols, diagnostics);
                    if (asmResult) {
                        initItems.push(InitItem(0, asmResult.expr));
                        for (var di = 0; di < asmResult.deps.length; di++)
                            _module.addressSymbolDeps[asmResult.deps[di]] = true;
                    } else if (itemSize === 1) {
                        if (diagnostics) diagnostics.error('Non-constant BYTE expression in CODE block not supported', initExpr.span);
                    }
                }
            }
            return initItems;
        }

        // --- ComputeArrayAccess ---
        function computeArrayAccess(node, loadValue) {
            var arrayName = (node.array && node.array.type === 'IdentifierExpr') ? node.array.name : null;
            var vi = arrayName ? resolveVarInfo(arrayName) : { kind: VarKind.Scalar, elemSize: 2, varDataSize: 2, local: null, globalSym: null };
            var arraySym = vi.globalSym;
            var arrInfo = vi.local;
            var isArrayByte = vi.kind !== VarKind.Scalar && vi.elemSize === 1;

            var strides;
            var isLocalArray = arrInfo && arrInfo.kind === VarKind.Array && arrInfo.dims;
            if (isLocalArray) {
                strides = computeStridesFromDims(arrInfo.dims, arrInfo.isByte ? 1 : 2, node.indices.length);
                isArrayByte = arrInfo.isByte;
            } else {
                strides = computeStrides(arraySym, node.indices.length, arrayName);
            }

            var elemSize = isArrayByte ? 1 : 2;

            // 部分配列参照: 指定インデックス数 < 配列の次元数 → アドレスを返す
            var arrayRank = 0;
            if (isLocalArray && arrInfo.dims) arrayRank = arrInfo.dims.length;
            else if (arraySym && arraySym.type && arraySym.type.typeClass === 'Array') {
                if (arraySym.type.rank) arrayRank = arraySym.type.rank;
                else if (arraySym.type.dimensions) arrayRank = arraySym.type.dimensions.length;
            }
            if (arrayRank > 0 && node.indices.length < arrayRank)
                loadValue = false;

            // Local array const index optimization
            if (isLocalArray) {
                var directOffset = tryComputeLocalArrayOffset(arrInfo, node.indices, strides, elemSize);
                if (directOffset !== null) {
                    var result = IrOperand.Temp(allocTemp());
                    if (loadValue) {
                        emit(IrOp.LoadLocal, result, IrOperand.Imm(directOffset), undefined, elemSize);
                    } else {
                        var hexOff2 = directOffset.toString(16).toUpperCase();
                        while (hexOff2.length < 4) hexOff2 = '0' + hexOff2;
                        emit(IrOp.InlineAsm, result, IrOperand.Asm('\tPUSH\tIY\n\tPOP\tHL\n\tLD\tDE,$' + hexOff2 + '\n\tADD\tHL,DE'));
                    }
                    return result;
                }
            }

            // Global/static array const index optimization
            if (!isLocalArray && arrayName && vi.kind === VarKind.Array) {
                var globalOffset = tryComputeConstArrayOffset(node.indices, strides);
                if (globalOffset !== null) {
                    var result2 = IrOperand.Temp(allocTemp());
                    var label = resolveAsmLabel(arrayName);
                    var sym2 = globalOffset === 0 ? label : label + '+' + globalOffset;
                    if (loadValue)
                        emit(IrOp.LoadVar, result2, IrOperand.Sym(sym2), undefined, elemSize);
                    else
                        emit(IrOp.LoadAddr, result2, IrOperand.Sym(sym2));
                    return result2;
                }
            }

            // Load base address
            var baseAddr;
            if (arrayName) {
                baseAddr = IrOperand.Temp(allocTemp());
                if (isLocalArray) {
                    emit(IrOp.Comment, IrOperand.Asm('local array ' + arrayName + ' addr'));
                    var hexOff3 = arrInfo.offset.toString(16).toUpperCase();
                    while (hexOff3.length < 4) hexOff3 = '0' + hexOff3;
                    emit(IrOp.InlineAsm, baseAddr, IrOperand.Asm('\tPUSH\tIY\n\tPOP\tHL\n\tLD\tDE,$' + hexOff3 + '\n\tADD\tHL,DE'));
                } else if (_localVars && _localVars[arrayName.toUpperCase()] !== undefined) {
                    emit(IrOp.LoadLocal, baseAddr, IrOperand.Imm(_localVars[arrayName.toUpperCase()].offset));
                } else {
                    emit(IrOp.LoadAddr, baseAddr, IrOperand.Sym(resolveAsmLabel(arrayName)));
                }
            } else {
                baseAddr = visitNode(node.array);
            }

            // Add scaled indices
            var addr = baseAddr;
            for (var i = 0; i < node.indices.length; i++) {
                var idx = visitNode(node.indices[i]);
                var stride = strides[i];
                var scaledIdx = IrOperand.Temp(allocTemp());
                if (stride === 1) scaledIdx = idx;
                else if (stride === 2) emit(IrOp.Add, scaledIdx, idx, idx);
                else {
                    var strideOp = IrOperand.Temp(allocTemp());
                    emit(IrOp.LoadConst, strideOp, IrOperand.Imm(stride));
                    emit(IrOp.Mul, scaledIdx, idx, strideOp);
                }
                var newAddr = IrOperand.Temp(allocTemp());
                emit(IrOp.Add, newAddr, addr, scaledIdx);
                addr = newAddr;
            }

            if (loadValue) {
                var result3 = IrOperand.Temp(allocTemp());
                emit(IrOp.IndirLoad, result3, addr, undefined, elemSize);
                return result3;
            }
            return addr;
        }

        // --- Hex format helper ---
        function toHex4(v) {
            var hex = (v & 0xFFFF).toString(16).toUpperCase();
            while (hex.length < 4) hex = '0' + hex;
            return hex;
        }

        // ============================================================
        // Main visitor dispatch
        // ============================================================
        function visitNode(node) {
            if (!node) return IrOperand.None;
            switch (node.type) {
                case 'CompilationUnit': return visitCompilationUnit(node);
                case 'Block': return visitBlock(node);
                case 'VarDecl': return visitVarDecl(node);
                case 'ArrayDecl': return visitArrayDecl(node);
                case 'ConstDecl': return visitConstDecl(node);
                case 'MachineDecl': return visitMachineDecl(node);
                case 'ParamDecl': return IrOperand.None;
                case 'FuncDef': return visitFuncDef(node);
                case 'ExpressionStmt': return visitExpressionStmt(node);
                case 'IfStmt': return visitIfStmt(node);
                case 'WhileStmt': return visitWhileStmt(node);
                case 'RepeatStmt': return visitRepeatStmt(node);
                case 'LoopStmt': return visitLoopStmt(node);
                case 'ForStmt': return visitForStmt(node);
                case 'CaseStmt': return visitCaseStmt(node);
                case 'ExitStmt': return visitExitStmt(node);
                case 'ContinueStmt': return visitContinueStmt(node);
                case 'ReturnStmt': return visitReturnStmt(node);
                case 'GotoStmt': return visitGotoStmt(node);
                case 'LabelStmt': return visitLabelStmt(node);
                case 'PrintStmt': return visitPrintStmt(node);
                case 'IntegerLiteral': return visitIntegerLiteral(node);
                case 'FloatLiteral': return visitFloatLiteral(node);
                case 'StringLiteral': return visitStringLiteral(node);
                case 'IdentifierExpr': return visitIdentifier(node);
                case 'BinaryExpr': return visitBinaryExpr(node);
                case 'UnaryExpr': return visitUnaryExpr(node);
                case 'AssignExpr': return visitAssignExpr(node);
                case 'CompoundAssignExpr': return visitCompoundAssignExpr(node);
                case 'IncrementExpr': return visitIncrementExpr(node);
                case 'CallExpr': return visitCallExpr(node);
                case 'ArrayAccessExpr': return visitArrayAccessExpr(node);
                case 'ConditionalExpr': return visitConditionalExpr(node);
                case 'CommaExpr': return visitCommaExpr(node);
                case 'AddressOfExpr': return visitAddressOfExpr(node);
                case 'HighLowExpr': return visitHighLowExpr(node);
                case 'CodeExpr': return visitCodeExpr(node);
                case 'CastExpr': return visitCastExpr(node);
                case 'StringFuncExpr': return visitStringFuncExpr(node);
                case 'OrgDirective': return visitOrgDirective(node);
                case 'WorkDirective': return visitWorkDirective(node);
                case 'OffsetDirective': return visitOffsetDirective(node);
                case 'ModuleBlock': return visitModuleBlock(node);
                case 'PlainAsm': return visitPlainAsm(node);
                default: return IrOperand.None;
            }
        }

        // ==== Top-level ====
        function visitCompilationUnit(node) {
            for (var i = 0; i < node.definitions.length; i++) visitNode(node.definitions[i]);
            return IrOperand.None;
        }
        function visitBlock(node) {
            for (var i = 0; i < node.statements.length; i++) visitNode(node.statements[i]);
            return IrOperand.None;
        }

        // ==== Declarations ====
        function visitVarDecl(node) {
            var ds = node.size === DataSize.Byte ? 1 : (node.size === DataSize.Float ? 3 : 2);

            if (!_currentFunction || _inStaticDecl) {
                var fixedAddr = null;
                if (node.address && node.address.type === 'IntegerLiteral')
                    fixedAddr = node.address.value | 0;

                var label = (_inStaticDecl && _currentFuncName)
                    ? staticVarLabel(_currentFuncName, node.name)
                    : userVarLabel(node.name);

                if (_inStaticDecl && _currentFuncName) {
                    _staticVarLabels[node.name.toUpperCase()] = label;
                    _staticVarSizes[node.name.toUpperCase()] = ds;
                    _staticVarKinds[node.name.toUpperCase()] = VarKind.Scalar;
                }

                var gvi = GlobalVarInfo(node.name, label, ds);
                gvi.fixedAddress = fixedAddr;
                _module.globalVars.push(gvi);

                if (node.initialValue) {
                    _emitToGlobalData = true;
                    try {
                        var val = visitNode(node.initialValue);
                        emit(IrOp.StoreVar, IrOperand.Sym(label), val, undefined, ds);
                    } finally {
                        _emitToGlobalData = false;
                    }
                }
            } else {
                allocLocalVar(node.name, ds);
                if (node.initialValue) {
                    var val2 = visitNode(node.initialValue);
                    var info = _localVars[node.name.toUpperCase()];
                    emit(IrOp.StoreLocal, IrOperand.Imm(info.offset), val2, undefined, ds);
                }
            }
            return IrOperand.None;
        }

        function visitArrayDecl(node) {
            var elemSize = node.size === DataSize.Byte ? 1 : 2;
            var isByte = node.size === DataSize.Byte;

            var dims = [];
            var totalSize = elemSize;
            for (var di = 0; di < node.dimensions.length; di++) {
                var dim = node.dimensions[di];
                var dimSize;
                if (dim && dim.type === 'IntegerLiteral')
                    dimSize = (dim.value | 0) + 1;
                else if (!dim)
                    dimSize = 0;
                else {
                    var constEval = globalSymbols ? ConstEvaluator(globalSymbols) : null;
                    var val = constEval ? constEval.evaluate(dim) : null;
                    dimSize = val !== null ? val + 1 : 1;
                }
                dims.push(dimSize);
                if (dimSize > 0) totalSize *= dimSize;
            }

            if (!_currentFunction || _inStaticDecl) {
                var fixedAddr = null;
                var fixedAddrLabel = null;
                if (node.address && node.address.type === 'IntegerLiteral')
                    fixedAddr = node.address.value | 0;
                else if (node.address) {
                    var asmResult = exprToAsmString(node.address, globalSymbols, diagnostics);
                    if (asmResult) {
                        fixedAddrLabel = asmResult.expr;
                        for (var dep = 0; dep < asmResult.deps.length; dep++)
                            _module.addressSymbolDeps[asmResult.deps[dep]] = true;
                    }
                }

                var initItems = null;
                if (node.initialCode) {
                    initItems = [];
                    for (var ii = 0; ii < node.initialCode.length; ii++) {
                        var initExpr = node.initialCode[ii];
                        var itemSize = 1;
                        if (initExpr.type === 'CastExpr') {
                            itemSize = initExpr.targetSize === DataSize.Byte ? 1 : (initExpr.targetSize === DataSize.Float ? 3 : 2);
                            initExpr = initExpr.operand;
                        }
                        var constEval2 = globalSymbols ? ConstEvaluator(globalSymbols) : null;
                        var constVal = constEval2 ? constEval2.evaluate(initExpr) : null;
                        if (initExpr.type === 'IntegerLiteral') constVal = initExpr.value | 0;

                        if (constVal !== null) {
                            var v = constVal;
                            if (itemSize === 1) initItems.push(InitItem(v & 0xFF));
                            else if (itemSize === 3) {
                                initItems.push(InitItem(v & 0xFF));
                                initItems.push(InitItem((v >> 8) & 0xFF));
                                initItems.push(InitItem((v >> 16) & 0xFF));
                            } else {
                                initItems.push(InitItem(v & 0xFF));
                                initItems.push(InitItem((v >> 8) & 0xFF));
                            }
                        } else if (initExpr.type === 'StringLiteral') {
                            for (var si = 0; si < initExpr.value.length; si++)
                                initItems.push(InitItem(initExpr.value.charCodeAt(si) & 0xFF));
                        } else {
                            var asmResult2 = exprToAsmString(initExpr, globalSymbols, diagnostics);
                            if (asmResult2 && itemSize === 2) {
                                initItems.push(InitItem(0, asmResult2.expr));
                                for (var d2 = 0; d2 < asmResult2.deps.length; d2++)
                                    _module.addressSymbolDeps[asmResult2.deps[d2]] = true;
                            } else if (itemSize === 1) {
                                if (diagnostics) diagnostics.error('Non-constant BYTE expression in CODE block not supported', initExpr.span);
                            }
                        }
                    }
                    // Pad to totalSize
                    var currentSize = 0;
                    for (var pi = 0; pi < initItems.length; pi++) currentSize += initItems[pi].byteSize;
                    while (currentSize < totalSize) { initItems.push(InitItem(0)); currentSize++; }
                }

                var label = (_inStaticDecl && _currentFuncName)
                    ? staticVarLabel(_currentFuncName, node.name)
                    : userVarLabel(node.name);

                if (_inStaticDecl && _currentFuncName) {
                    _staticVarLabels[node.name.toUpperCase()] = label;
                    var isPointerType = dims.every(function(d) { return d === 0; });
                    _staticVarSizes[node.name.toUpperCase()] = 2;
                    _staticElemSizes[node.name.toUpperCase()] = isByte ? 1 : 2;
                    _staticVarKinds[node.name.toUpperCase()] = isPointerType ? VarKind.Pointer : VarKind.Array;
                }

                var isPointerGlobal = dims.every(function(d) { return d === 0; });
                var globalByteSize = isPointerGlobal ? 2 : totalSize;

                var gvi = GlobalVarInfo(node.name, label, globalByteSize);
                gvi.fixedAddress = fixedAddr;
                gvi.fixedAddressLabel = fixedAddrLabel;
                gvi.isArray = true;
                gvi.initialItems = initItems;
                gvi.storageKind = initItems ? VarStorageKind.InitArray : VarStorageKind.Bss;
                _module.globalVars.push(gvi);
            } else {
                // Local array/indirect
                var isPointerVar = dims.every(function(d) { return d === 0; });
                var allocSize = isPointerVar ? 2 : totalSize;
                _localOffset += allocSize;
                var offset = 0x70 - _localOffset;
                var kind = isPointerVar ? VarKind.Pointer : VarKind.Array;
                _localVars[node.name.toUpperCase()] = { offset: offset, byteSize: allocSize, kind: kind, isByte: isByte, dims: dims };
            }
            return IrOperand.None;
        }

        function visitConstDecl(node) {
            if (node.value && node.value.type === 'CodeExpr') {
                var label = (_inStaticDecl && _currentFuncName)
                    ? staticVarLabel(_currentFuncName, node.name)
                    : userVarLabel(node.name);

                if (_inStaticDecl && _currentFuncName)
                    _staticVarLabels[node.name.toUpperCase()] = label;

                var initItems = buildCodeBlockItems(node.value);
                var totalBytes = 0;
                for (var i = 0; i < initItems.length; i++) totalBytes += initItems[i].byteSize;

                var gvi = GlobalVarInfo(node.name, label, totalBytes);
                gvi.initialItems = initItems;
                gvi.storageKind = VarStorageKind.CodeConst;
                _module.globalVars.push(gvi);
            } else {
                emit(IrOp.Comment, IrOperand.Asm('CONST ' + node.name));
            }
            return IrOperand.None;
        }

        function visitMachineDecl(node) {
            emit(IrOp.Comment, IrOperand.Asm('MACHINE ' + node.name));

            if (node.staticDeclarations && node.staticDeclarations.length > 0) {
                var prevSL = _staticVarLabels;
                var prevSS = _staticVarSizes;
                var prevSE = _staticElemSizes;
                var prevSK = _staticVarKinds;
                _staticVarLabels = {};
                _staticVarSizes = {};
                _staticElemSizes = {};
                _staticVarKinds = {};
                _currentFuncName = sanitizeLabel(node.name);
                _inStaticDecl = true;
                for (var i = 0; i < node.staticDeclarations.length; i++) visitNode(node.staticDeclarations[i]);
                _inStaticDecl = false;
                _currentFuncName = null;
                _staticVarLabels = prevSL;
                _staticVarSizes = prevSS;
                _staticElemSizes = prevSE;
                _staticVarKinds = prevSK;
            }

            if (node.codeBody) {
                var sym = globalSymbols ? globalSymbols.resolve(node.name) : null;
                var label = (sym && sym.asmLabel) ? sym.asmLabel : '_' + sanitizeLabel(node.name);
                var initItems = buildCodeBlockItems(node.codeBody);
                initItems.push(InitItem(0xC9)); // RET
                var totalBytes = 0;
                for (var i = 0; i < initItems.length; i++) totalBytes += initItems[i].byteSize;

                var gvi = GlobalVarInfo(node.name, label, totalBytes);
                gvi.initialItems = initItems;
                gvi.storageKind = VarStorageKind.CodeConst;
                _module.globalVars.push(gvi);
            }
            return IrOperand.None;
        }

        // ==== Function ====
        function visitFuncDef(node) {
            _currentFunction = IrFunction(sanitizeLabel(node.name));
            _tempDataSize = {};

            var prevLocalVars = _localVars;
            var prevOffset = _localOffset;
            var prevSL = _staticVarLabels;
            var prevSS = _staticVarSizes;
            var prevSE = _staticElemSizes;
            var prevSK = _staticVarKinds;
            _localVars = {};
            _staticVarLabels = {};
            _staticVarSizes = {};
            _staticElemSizes = {};
            _staticVarKinds = {};
            _localOffset = 0;

            var paramNames = [];
            for (var pi = 0; pi < node.parameters.length; pi++) {
                _localVars[node.parameters[pi].name.toUpperCase()] = { offset: 0, byteSize: 2, kind: VarKind.Scalar, isByte: false, dims: null };
                paramNames.push(node.parameters[pi].name);
            }

            emit(IrOp.FuncBegin, IrOperand.Sym(sanitizeLabel(node.name)));

            _currentFuncName = sanitizeLabel(node.name);
            _inStaticDecl = true;
            for (var si = 0; si < node.staticDeclarations.length; si++) visitNode(node.staticDeclarations[si]);
            _inStaticDecl = false;
            for (var li = 0; li < node.localDeclarations.length; li++) visitNode(node.localDeclarations[li]);

            // Fix param offsets after locals allocated
            var totalFrameSize = _localOffset + paramNames.length * 2;
            var argOff = 0x70 - totalFrameSize;
            for (var ai = 0; ai < paramNames.length; ai++) {
                _localVars[paramNames[ai].toUpperCase()] = { offset: argOff, byteSize: 2, kind: VarKind.Scalar, isByte: false, dims: null };
                argOff += 2;
            }
            _localOffset = totalFrameSize;

            visitNode(node.body);

            if (node.returnValue) {
                var retVal = visitNode(node.returnValue);
                emit(IrOp.Return, retVal);
            }

            emit(IrOp.FuncEnd);
            _currentFunction.localSize = _localOffset;
            _module.functions.push(_currentFunction);
            _currentFunction = null;
            _localVars = prevLocalVars;
            _staticVarLabels = prevSL;
            _staticVarSizes = prevSS;
            _staticElemSizes = prevSE;
            _staticVarKinds = prevSK;
            _localOffset = prevOffset;
            return IrOperand.None;
        }

        // ==== Statements ====
        function visitExpressionStmt(node) {
            visitNode(node.expr);
            return IrOperand.None;
        }

        function visitIfStmt(node) {
            var endLabel = newLabel();
            var constEval = globalSymbols ? ConstEvaluator(globalSymbols) : null;

            for (var i = 0; i < node.branches.length; i++) {
                var cond = node.branches[i].condition;
                var body = node.branches[i].body;
                var nextLabel = (i < node.branches.length - 1 || node.elseBody) ? newLabel() : endLabel;

                var constCond = constEval ? constEval.evaluate(cond) : null;
                if (constCond !== null && constCond !== 0) {
                    visitNode(body);
                    emit(IrOp.Label, IrOperand.Lbl(endLabel));
                    return IrOperand.None;
                } else if (constCond !== null && constCond === 0) {
                    if (nextLabel !== endLabel)
                        emit(IrOp.Label, IrOperand.Lbl(nextLabel));
                    continue;
                }

                if (canShortCircuit(cond))
                    emitShortCircuitJump(cond, nextLabel);
                else {
                    var condVal = visitNode(cond);
                    emit(IrOp.JumpIfZero, IrOperand.Lbl(nextLabel), condVal);
                }

                visitNode(body);
                if (nextLabel !== endLabel)
                    emit(IrOp.Jump, IrOperand.Lbl(endLabel));
                if (nextLabel !== endLabel)
                    emit(IrOp.Label, IrOperand.Lbl(nextLabel));
            }

            if (node.elseBody) visitNode(node.elseBody);
            emit(IrOp.Label, IrOperand.Lbl(endLabel));
            return IrOperand.None;
        }

        function visitWhileStmt(node) {
            var startLabel = newLabel();
            var endLabel = newLabel();
            pushLoop(startLabel, endLabel);

            var constEval = globalSymbols ? ConstEvaluator(globalSymbols) : null;
            var constCond = constEval ? constEval.evaluate(node.condition) : null;

            emit(IrOp.Label, IrOperand.Lbl(startLabel));

            if (constCond !== null && constCond !== 0) {
                // Always true: skip condition check
            } else {
                if (canShortCircuit(node.condition))
                    emitShortCircuitJump(node.condition, endLabel);
                else {
                    var condVal = visitNode(node.condition);
                    emit(IrOp.JumpIfZero, IrOperand.Lbl(endLabel), condVal);
                }
            }

            visitNode(node.body);
            emit(IrOp.Jump, IrOperand.Lbl(startLabel));
            emit(IrOp.Label, IrOperand.Lbl(endLabel));
            popLoop();
            return IrOperand.None;
        }

        function visitRepeatStmt(node) {
            var startLabel = newLabel();
            var endLabel = newLabel();
            pushLoop(startLabel, endLabel);
            emit(IrOp.Label, IrOperand.Lbl(startLabel));
            visitNode(node.body);
            var condVal = visitNode(node.condition);
            emit(IrOp.JumpIfZero, IrOperand.Lbl(startLabel), condVal);
            emit(IrOp.Label, IrOperand.Lbl(endLabel));
            popLoop();
            return IrOperand.None;
        }

        function visitLoopStmt(node) {
            var startLabel = newLabel();
            var endLabel = newLabel();
            pushLoop(startLabel, endLabel);
            emit(IrOp.Label, IrOperand.Lbl(startLabel));
            visitNode(node.body);
            emit(IrOp.Jump, IrOperand.Lbl(startLabel));
            emit(IrOp.Label, IrOperand.Lbl(endLabel));
            popLoop();
            return IrOperand.None;
        }

        function visitForStmt(node) {
            var startLabel = newLabel();
            var contLabel = newLabel();
            var endLabel = newLabel();

            var forVi = checkDefined(node.variable, node.span);
            var forVarInfo = forVi.local;
            var forVarIsLocal = forVarInfo !== null;
            var forVarDs = forVi.varDataSize;

            var fromVal = visitNode(node.from);
            if (forVarIsLocal)
                emit(IrOp.StoreLocal, IrOperand.Imm(forVarInfo.offset), fromVal, undefined, forVarDs);
            else
                emit(IrOp.StoreVar, IrOperand.Sym(resolveAsmLabel(node.variable)), fromVal, undefined, forVarDs);

            pushLoop(contLabel, endLabel);
            emit(IrOp.Label, IrOperand.Lbl(startLabel));
            visitNode(node.body);
            emit(IrOp.Label, IrOperand.Lbl(contLabel));

            var curVal = IrOperand.Temp(allocTemp());
            if (forVarIsLocal)
                emit(IrOp.LoadLocal, curVal, IrOperand.Imm(forVarInfo.offset), undefined, forVarDs);
            else
                emit(IrOp.LoadVar, curVal, IrOperand.Sym(resolveAsmLabel(node.variable)), undefined, forVarDs);
            var one = IrOperand.Temp(allocTemp());
            emit(IrOp.LoadConst, one, IrOperand.Imm(1));
            var newVal = IrOperand.Temp(allocTemp());
            emit(node.isDownTo ? IrOp.Sub : IrOp.Add, newVal, curVal, one);
            if (forVarIsLocal)
                emit(IrOp.StoreLocal, IrOperand.Imm(forVarInfo.offset), newVal, undefined, forVarDs);
            else
                emit(IrOp.StoreVar, IrOperand.Sym(resolveAsmLabel(node.variable)), newVal, undefined, forVarDs);

            var limit = visitNode(node.to);
            var cmp = IrOperand.Temp(allocTemp());
            emit(node.isDownTo ? IrOp.CmpSGe : IrOp.CmpLe, cmp, newVal, limit);
            emit(IrOp.JumpIfNonZero, IrOperand.Lbl(startLabel), cmp);

            emit(IrOp.Label, IrOperand.Lbl(endLabel));
            popLoop();
            return IrOperand.None;
        }

        function visitCaseStmt(node) {
            var endLabel = newLabel();
            pushLoop(endLabel, endLabel);

            // Phase 1: bodyLabel 前計算（後ろから走査）
            // body===null のブランチ（カンマ先行値）は次の body 付きブランチの bodyLabel を共有
            var bodyLabels = [];
            var othersLabel = null;
            var currentBodyLabel = null;
            for (var i = node.branches.length - 1; i >= 0; i--) {
                var b = node.branches[i];
                if (b.body !== null) {
                    currentBodyLabel = newLabel();
                    bodyLabels[i] = currentBodyLabel;
                    if (b.value === null) othersLabel = currentBodyLabel;
                } else {
                    bodyLabels[i] = currentBodyLabel;
                }
            }

            // Phase 2: 比較コード出力
            for (var i = 0; i < node.branches.length; i++) {
                var branch = node.branches[i];
                if (branch.value === null) continue; // OTHERS — Phase 3 で出力
                var nextLabel = newLabel();
                var branchVal = visitNode(branch.value);

                if (branch.rangeEnd) {
                    var rangeEnd = visitNode(branch.rangeEnd);
                    var reloaded1 = visitNode(node.expr);
                    var cmpLo = IrOperand.Temp(allocTemp());
                    emit(IrOp.CmpGe, cmpLo, reloaded1, branchVal);
                    emit(IrOp.JumpIfZero, IrOperand.Lbl(nextLabel), cmpLo);
                    var reloaded2 = visitNode(node.expr);
                    var cmpHi = IrOperand.Temp(allocTemp());
                    emit(IrOp.CmpLe, cmpHi, reloaded2, rangeEnd);
                    emit(IrOp.JumpIfZero, IrOperand.Lbl(nextLabel), cmpHi);
                } else {
                    var reloaded = visitNode(node.expr);
                    var cmp2 = IrOperand.Temp(allocTemp());
                    emit(IrOp.CmpEq, cmp2, reloaded, branchVal);
                    emit(IrOp.JumpIfZero, IrOperand.Lbl(nextLabel), cmp2);
                }

                emit(IrOp.Jump, IrOperand.Lbl(bodyLabels[i]));
                emit(IrOp.Label, IrOperand.Lbl(nextLabel));
            }

            // 全比較不一致: OTHERS があればそこへ、なければ endLabel へ
            emit(IrOp.Jump, IrOperand.Lbl(othersLabel || endLabel));

            // Phase 3: body コード出力（body !== null のブランチだけ）
            for (var i = 0; i < node.branches.length; i++) {
                if (node.branches[i].body === null) continue;
                emit(IrOp.Label, IrOperand.Lbl(bodyLabels[i]));
                visitNode(node.branches[i].body);
                emit(IrOp.Jump, IrOperand.Lbl(endLabel));
            }

            emit(IrOp.Label, IrOperand.Lbl(endLabel));
            popLoop();
            return IrOperand.None;
        }

        function visitExitStmt(node) {
            if (node.targetLabel) {
                emit(IrOp.Jump, IrOperand.Lbl(node.targetLabel));
            } else {
                var breakLabel = getBreakLabel();
                if (breakLabel) emit(IrOp.Jump, IrOperand.Lbl(breakLabel));
                else if (diagnostics) diagnostics.error('EXIT outside loop', node.span);
            }
            return IrOperand.None;
        }

        function visitContinueStmt(node) {
            var contLabel = getContinueLabel();
            if (contLabel) emit(IrOp.Jump, IrOperand.Lbl(contLabel));
            else if (diagnostics) diagnostics.error('CONTINUE outside loop', node.span);
            return IrOperand.None;
        }

        function visitReturnStmt(node) {
            if (node.value) {
                var val = visitNode(node.value);
                emit(IrOp.Return, val);
            } else {
                emit(IrOp.Return);
            }
            return IrOperand.None;
        }

        function visitGotoStmt(node) {
            emit(IrOp.Jump, IrOperand.Lbl(userLabel(node.label)));
            return IrOperand.None;
        }

        function visitLabelStmt(node) {
            emit(IrOp.Label, IrOperand.Lbl(userLabel(node.label)));
            return IrOperand.None;
        }

        function visitPrintStmt(node) {
            for (var i = 0; i < node.arguments.length; i++) {
                var arg = node.arguments[i];
                if (arg.type === 'StringFuncExpr') {
                    var fn = arg.funcName.toUpperCase();
                    switch (fn) {
                        case '/':
                            emit(IrOp.Call, IrOperand.None, IrOperand.Sym('PCRONE'));
                            break;
                        case 'HEX2$':
                            if (arg.arguments.length > 0) visitNode(arg.arguments[0]);
                            emit(IrOp.Call, IrOperand.None, IrOperand.Sym('PHEX2'));
                            break;
                        case 'HEX4$':
                            if (arg.arguments.length > 0) visitNode(arg.arguments[0]);
                            emit(IrOp.Call, IrOperand.None, IrOperand.Sym('PHEX4'));
                            break;
                        case 'FORM$':
                            if (arg.arguments.length >= 2) {
                                visitNode(arg.arguments[0]);
                                emit(IrOp.PushArg, IrOperand.None);
                                visitNode(arg.arguments[1]);
                                emit(IrOp.PushArg, IrOperand.None);
                            }
                            emit(IrOp.Call, IrOperand.None, IrOperand.Sym('P10toN'), IrOperand.Imm(2));
                            break;
                        case 'DECI$':
                            if (arg.arguments.length > 0) visitNode(arg.arguments[0]);
                            emit(IrOp.Call, IrOperand.None, IrOperand.Sym('P10to5'));
                            break;
                        case '%': case 'PN$':
                            if (arg.arguments.length > 0) visitNode(arg.arguments[0]);
                            emit(IrOp.Call, IrOperand.None, IrOperand.Sym('PSIGN'));
                            break;
                        case 'MSG$':
                            if (arg.arguments.length > 0) visitNode(arg.arguments[0]);
                            emit(IrOp.Call, IrOperand.None, IrOperand.Sym('PMSG'));
                            break;
                        case '!': case 'MSX$':
                            if (arg.arguments.length > 0) visitNode(arg.arguments[0]);
                            emit(IrOp.Call, IrOperand.None, IrOperand.Sym('PMSX'));
                            break;
                        case 'STR$':
                            if (arg.arguments.length >= 2) {
                                visitNode(arg.arguments[0]);
                                emit(IrOp.PushArg, IrOperand.None);
                                visitNode(arg.arguments[1]);
                                emit(IrOp.PushArg, IrOperand.None);
                            }
                            emit(IrOp.Call, IrOperand.None, IrOperand.Sym('PSTR'), IrOperand.Imm(2));
                            break;
                        case 'CHR$':
                            if (arg.arguments.length > 0) visitNode(arg.arguments[0]);
                            emit(IrOp.Call, IrOperand.None, IrOperand.Sym('PCHR'));
                            break;
                        case 'SPC$':
                            if (arg.arguments.length > 0) visitNode(arg.arguments[0]);
                            emit(IrOp.Call, IrOperand.None, IrOperand.Sym('PSPC'));
                            break;
                        case 'CR$':
                            if (arg.arguments.length > 0) visitNode(arg.arguments[0]);
                            emit(IrOp.Call, IrOperand.None, IrOperand.Sym('PCR'));
                            break;
                        case 'TAB$':
                            if (arg.arguments.length > 0) visitNode(arg.arguments[0]);
                            emit(IrOp.Call, IrOperand.None, IrOperand.Sym('PTAB'));
                            break;
                        default:
                            for (var ai = 0; ai < arg.arguments.length; ai++) visitNode(arg.arguments[ai]);
                            emit(IrOp.Call, IrOperand.None, IrOperand.Sym('PRINT_' + arg.funcName));
                            break;
                    }
                } else if (arg.type === 'StringLiteral') {
                    emitInlinePrint(arg.value);
                } else {
                    visitNode(arg);
                    emit(IrOp.Call, IrOperand.None, IrOperand.Sym('P10'));
                }
            }
            return IrOperand.None;
        }

        // ==== Expressions ====
        function visitIntegerLiteral(node) {
            var t = IrOperand.Temp(allocTemp());
            emit(IrOp.LoadConst, t, IrOperand.Imm(node.value));
            return t;
        }

        function visitFloatLiteral(node) {
            var f24 = convertToF24(node.value);
            var label = '_FC' + (_floatConstCount++);
            var gvi = GlobalVarInfo(label, label, 3);
            gvi.initialItems = [InitItem(f24[0]), InitItem(f24[1]), InitItem(f24[2])];
            gvi.storageKind = VarStorageKind.CodeConst;
            _module.globalVars.push(gvi);
            var t = IrOperand.Temp(allocTemp());
            emit(IrOp.LoadVar, t, IrOperand.Sym(label), undefined, 3);
            _tempDataSize[t.tempIndex] = 3;
            return t;
        }

        function visitStringLiteral(node) {
            var label = null;
            for (var k in _module.stringTable) {
                if (_module.stringTable[k] === node.value) { label = k; break; }
            }
            if (!label) {
                var count = 0;
                for (var k2 in _module.stringTable) count++;
                label = '_S' + count;
                _module.stringTable[label] = node.value;
            }
            var t = IrOperand.Temp(allocTemp());
            emit(IrOp.LoadAddr, t, IrOperand.Lbl(label));
            return t;
        }

        function visitIdentifier(node) {
            var t = IrOperand.Temp(allocTemp());

            if (_localVars && _localVars[node.name.toUpperCase()] !== undefined) {
                var localInfo = _localVars[node.name.toUpperCase()];
                if (localInfo.kind === VarKind.Array) {
                    var hexOff = localInfo.offset.toString(16).toUpperCase();
                    while (hexOff.length < 4) hexOff = '0' + hexOff;
                    emit(IrOp.InlineAsm, t, IrOperand.Asm('\tPUSH\tIY\n\tPOP\tHL\n\tLD\tDE,$' + hexOff + '\n\tADD\tHL,DE'));
                    return t;
                }
                var localDs = localInfo.kind === VarKind.Pointer ? 2 : localInfo.byteSize;
                emit(IrOp.LoadLocal, t, IrOperand.Imm(localInfo.offset), undefined, localDs);
                _tempDataSize[t.tempIndex] = localDs;
                return t;
            }

            var sym = globalSymbols ? globalSymbols.resolve(node.name) : null;
            if (sym && sym.kind === SymbolKind.Constant && typeof sym.constValue === 'number') {
                emit(IrOp.LoadConst, t, IrOperand.Imm(sym.constValue));
            } else if (sym && sym.kind === SymbolKind.Constant && sym.constAst) {
                if (!sym.constAsmResolved) {
                    sym.constAsmResolved = true;
                    var result = exprToAsmString(sym.constAst, globalSymbols, diagnostics);
                    if (result) { sym.constAsmExpr = result.expr; sym.constAsmDeps = result.deps; }
                }
                if (sym.constAsmExpr) {
                    emit(IrOp.LoadAddr, t, IrOperand.Sym(sym.constAsmExpr));
                    if (sym.constAsmDeps) {
                        for (var d = 0; d < sym.constAsmDeps.length; d++)
                            _module.addressSymbolDeps[sym.constAsmDeps[d]] = true;
                    }
                }
            } else if (sym && sym.isCodeBlock) {
                emit(IrOp.LoadAddr, t, IrOperand.Sym(resolveAsmLabel(node.name)));
            } else {
                var vi = checkDefined(node.name, node.span);
                if (vi.kind === VarKind.Array) {
                    emit(IrOp.LoadAddr, t, IrOperand.Sym(resolveAsmLabel(node.name)));
                } else {
                    emit(IrOp.LoadVar, t, IrOperand.Sym(resolveAsmLabel(node.name)), undefined, vi.varDataSize);
                    _tempDataSize[t.tempIndex] = vi.varDataSize;
                }
            }
            return t;
        }

        function visitBinaryExpr(node) {
            // Constant folding
            if (globalSymbols) {
                var constEval = ConstEvaluator(globalSymbols);
                var constResult = constEval.evaluate(node);
                if (constResult !== null) {
                    var t = IrOperand.Temp(allocTemp());
                    emit(IrOp.LoadConst, t, IrOperand.Imm(constResult));
                    return t;
                }

                // No-op normalization
                if (node.op === BinaryOp.Add || node.op === BinaryOp.Sub) {
                    var rc = constEval.evaluate(node.right);
                    if (rc !== null && rc === 0) return visitNode(node.left);
                    if (node.op === BinaryOp.Add) {
                        var lc = constEval.evaluate(node.left);
                        if (lc !== null && lc === 0) return visitNode(node.right);
                    }
                }
                if (node.op === BinaryOp.Mul || node.op === BinaryOp.SMul || node.op === BinaryOp.Div || node.op === BinaryOp.SDiv) {
                    var rc2 = constEval.evaluate(node.right);
                    if (rc2 !== null && rc2 === 1) return visitNode(node.left);
                    if (node.op === BinaryOp.Mul || node.op === BinaryOp.SMul) {
                        var lc2 = constEval.evaluate(node.left);
                        if (lc2 !== null && lc2 === 1) return visitNode(node.right);
                    }
                }
            }

            // Short-circuit LogAnd
            if (node.op === BinaryOp.LogAnd) {
                var falseL = newLabel();
                var endL = newLabel();
                var result = IrOperand.Temp(allocTemp());
                var lhsAnd = visitNode(node.left);
                emit(IrOp.JumpIfZero, IrOperand.Lbl(falseL), lhsAnd);
                var rhsAnd = visitNode(node.right);
                emit(IrOp.JumpIfZero, IrOperand.Lbl(falseL), rhsAnd);
                emit(IrOp.LoadConst, result, IrOperand.Imm(1));
                emit(IrOp.Jump, IrOperand.Lbl(endL));
                emit(IrOp.Label, IrOperand.Lbl(falseL));
                emit(IrOp.LoadConst, result, IrOperand.Imm(0));
                emit(IrOp.Label, IrOperand.Lbl(endL));
                return result;
            }
            // Short-circuit LogOr
            if (node.op === BinaryOp.LogOr) {
                var trueL = newLabel();
                var endL2 = newLabel();
                var result2 = IrOperand.Temp(allocTemp());
                var lhsOr = visitNode(node.left);
                emit(IrOp.JumpIfNonZero, IrOperand.Lbl(trueL), lhsOr);
                var rhsOr = visitNode(node.right);
                emit(IrOp.JumpIfNonZero, IrOperand.Lbl(trueL), rhsOr);
                emit(IrOp.LoadConst, result2, IrOperand.Imm(0));
                emit(IrOp.Jump, IrOperand.Lbl(endL2));
                emit(IrOp.Label, IrOperand.Lbl(trueL));
                emit(IrOp.LoadConst, result2, IrOperand.Imm(1));
                emit(IrOp.Label, IrOperand.Lbl(endL2));
                return result2;
            }

            // FLOAT special patterns: f24sqr, f24mul2
            if (node.op === BinaryOp.Mul) {
                var leftIsFloat = node.left.type === 'IdentifierExpr' && globalSymbols &&
                    (function() { var s = globalSymbols.resolve(node.left.name); return s && s.type && s.type.byteSize === 3; })();
                var rightIsFloat = node.right.type === 'IdentifierExpr' && globalSymbols &&
                    (function() { var s = globalSymbols.resolve(node.right.name); return s && s.type && s.type.byteSize === 3; })();

                // f24sqr: X*X
                if (leftIsFloat && rightIsFloat &&
                    node.left.type === 'IdentifierExpr' && node.right.type === 'IdentifierExpr' &&
                    node.left.name === node.right.name) {
                    visitNode(node.left);
                    var sqrDest = IrOperand.Temp(allocTemp());
                    emit(IrOp.Call, sqrDest, IrOperand.Sym('f24sqr'), IrOperand.Imm(0), 3);
                    _tempDataSize[sqrDest.tempIndex] = 3;
                    return sqrDest;
                }

                // f24mul2: 2*X or X*2
                var floatSide = null;
                if (node.left.type === 'IntegerLiteral' && node.left.value === 2 && rightIsFloat)
                    floatSide = node.right;
                else if (node.right.type === 'IntegerLiteral' && node.right.value === 2 && leftIsFloat)
                    floatSide = node.left;
                if (floatSide) {
                    visitNode(floatSide);
                    var mul2Dest = IrOperand.Temp(allocTemp());
                    emit(IrOp.Call, mul2Dest, IrOperand.Sym('f24mul2'), IrOperand.Imm(0), 3);
                    _tempDataSize[mul2Dest.tempIndex] = 3;
                    return mul2Dest;
                }
            }

            var left = visitNode(node.left);
            var leftDs = (left.kind === IrOperandKind.Temp && _tempDataSize[left.tempIndex] !== undefined) ? _tempDataSize[left.tempIndex] : 2;

            var rightMightBeFloat = node.right.type === 'FloatLiteral' ||
                (node.right.type === 'IdentifierExpr' && globalSymbols &&
                 (function() { var s = globalSymbols.resolve(node.right.name); return s && s.type && s.type.byteSize === 3; })());

            if (leftDs !== 3 && rightMightBeFloat) {
                var conv = IrOperand.Temp(allocTemp());
                emit(IrOp.Call, conv, IrOperand.Sym('i16tof24'), IrOperand.Imm(0), 3);
                _tempDataSize[conv.tempIndex] = 3;
                left = conv;
                leftDs = 3;
            }

            var right = visitNode(node.right);
            var dest = IrOperand.Temp(allocTemp());

            var opMap = {};
            opMap[BinaryOp.Add] = IrOp.Add; opMap[BinaryOp.Sub] = IrOp.Sub;
            opMap[BinaryOp.Mul] = IrOp.Mul; opMap[BinaryOp.Div] = IrOp.Div; opMap[BinaryOp.Mod] = IrOp.Mod;
            opMap[BinaryOp.SMul] = IrOp.SMul; opMap[BinaryOp.SDiv] = IrOp.SDiv; opMap[BinaryOp.SMod] = IrOp.SMod;
            opMap[BinaryOp.And] = IrOp.And; opMap[BinaryOp.Or] = IrOp.Or; opMap[BinaryOp.Xor] = IrOp.Xor;
            opMap[BinaryOp.Shl] = IrOp.Shl; opMap[BinaryOp.Shr] = IrOp.Shr;
            opMap[BinaryOp.SShl] = IrOp.SShl; opMap[BinaryOp.SShr] = IrOp.SShr;
            opMap[BinaryOp.Eq] = IrOp.CmpEq; opMap[BinaryOp.Neq] = IrOp.CmpNeq;
            opMap[BinaryOp.Lt] = IrOp.CmpLt; opMap[BinaryOp.Gt] = IrOp.CmpGt;
            opMap[BinaryOp.Le] = IrOp.CmpLe; opMap[BinaryOp.Ge] = IrOp.CmpGe;
            opMap[BinaryOp.SLt] = IrOp.CmpSLt; opMap[BinaryOp.SGt] = IrOp.CmpSGt;
            opMap[BinaryOp.SLe] = IrOp.CmpSLe; opMap[BinaryOp.SGe] = IrOp.CmpSGe;
            opMap[BinaryOp.LogAnd] = IrOp.LogAnd; opMap[BinaryOp.LogOr] = IrOp.LogOr;
            var irOp = opMap[node.op] || IrOp.Nop;

            var rightDs = (right.kind === IrOperandKind.Temp && _tempDataSize[right.tempIndex] !== undefined) ? _tempDataSize[right.tempIndex] : 2;
            var resultDs = (leftDs === 3 || rightDs === 3) ? 3 : 2;

            if (resultDs === 3) {
                if (leftDs !== 3) {
                    var conv2 = IrOperand.Temp(allocTemp());
                    emit(IrOp.Call, conv2, IrOperand.Sym('i16tof24'), IrOperand.Imm(0), 3);
                    _tempDataSize[conv2.tempIndex] = 3;
                    left = conv2;
                }
                if (rightDs !== 3) {
                    var conv3 = IrOperand.Temp(allocTemp());
                    emit(IrOp.Call, conv3, IrOperand.Sym('i16tof24'), IrOperand.Imm(0), 3);
                    _tempDataSize[conv3.tempIndex] = 3;
                    right = conv3;
                }
            }

            emit(irOp, dest, left, right, resultDs);
            _tempDataSize[dest.tempIndex] = resultDs;
            return dest;
        }

        function visitUnaryExpr(node) {
            if (node.operand.type === 'IntegerLiteral') {
                var v = node.operand.value | 0;
                var folded = null;
                if (node.op === UnaryOp.Plus) folded = v;
                else if (node.op === UnaryOp.Negate) folded = (-v) & 0xFFFF;
                else if (node.op === UnaryOp.Not) folded = (v !== 0) ? 0 : 1;
                else if (node.op === UnaryOp.Cpl) folded = (~v) & 0xFFFF;
                if (folded !== null) {
                    var dest = IrOperand.Temp(allocTemp());
                    emit(IrOp.LoadConst, dest, IrOperand.Imm(folded));
                    return dest;
                }
            }

            var operand = visitNode(node.operand);
            if (node.op === UnaryOp.Plus) return operand;

            var dest2 = IrOperand.Temp(allocTemp());
            var op;
            if (node.op === UnaryOp.Negate) op = IrOp.Neg;
            else if (node.op === UnaryOp.Not) op = IrOp.LogNot;
            else if (node.op === UnaryOp.Cpl) op = IrOp.Not;
            else op = IrOp.Nop;
            emit(op, dest2, operand);
            return dest2;
        }

        function visitAssignExpr(node) {
            var value = visitNode(node.value);
            emitStore(node.target, value);
            return value;
        }

        function visitCompoundAssignExpr(node) {
            var target = visitNode(node.target);
            var value = visitNode(node.value);
            var dest = IrOperand.Temp(allocTemp());

            var op;
            if (node.op === CompoundAssignOp.AddAssign) op = IrOp.Add;
            else if (node.op === CompoundAssignOp.SubAssign) op = IrOp.Sub;
            else if (node.op === CompoundAssignOp.MulAssign) op = IrOp.Mul;
            else if (node.op === CompoundAssignOp.DivAssign) op = IrOp.Div;
            else op = IrOp.Nop;

            emit(op, dest, target, value);
            emitStore(node.target, dest);
            return dest;
        }

        function visitIncrementExpr(node) {
            var val = visitNode(node.operand);
            var one = IrOperand.Temp(allocTemp());
            emit(IrOp.LoadConst, one, IrOperand.Imm(1));
            var result = IrOperand.Temp(allocTemp());
            emit(node.isIncrement ? IrOp.Add : IrOp.Sub, result, val, one);
            emitStore(node.operand, result);
            return node.isPrefix ? result : val;
        }

        function visitCallExpr(node) {
            var funcName = (node.func && node.func.type === 'IdentifierExpr') ? node.func.name : null;
            var funcSym = (funcName && globalSymbols) ? globalSymbols.resolve(funcName) : null;

            var isUserFunc = funcSym && funcSym.kind === SymbolKind.Function;
            var isMachine = !isUserFunc;
            var machineParamCount = null;
            if (isMachine) {
                if (funcSym && funcSym.type && funcSym.type.typeClass === 'Function')
                    machineParamCount = funcSym.type.parameterTypes.length;
                else
                    machineParamCount = node.arguments.length;
            }

            if (isMachine && machineParamCount !== null) {
                for (var i = 0; i < node.arguments.length; i++) {
                    var argVal = visitNode(node.arguments[i]);
                    emit(IrOp.PushArg, argVal, IrOperand.Imm(i));
                }

                var dest = IrOperand.Temp(allocTemp());
                var asmName;
                if (funcSym && funcSym.addressAst) {
                    if (!funcSym.addressExprResolved) {
                        funcSym.addressExprResolved = true;
                        var result = exprToAsmString(funcSym.addressAst, globalSymbols, diagnostics);
                        if (result) { funcSym.addressExpr = result.expr; funcSym.addressExprDeps = result.deps; }
                    }
                    asmName = funcSym.addressExpr || (funcSym.asmLabel || sanitizeLabel(funcName));
                    if (funcSym.addressExprDeps) {
                        for (var d = 0; d < funcSym.addressExprDeps.length; d++)
                            _module.addressSymbolDeps[funcSym.addressExprDeps[d]] = true;
                    }
                } else {
                    asmName = (funcSym && funcSym.asmLabel) ? funcSym.asmLabel : sanitizeLabel(funcName);
                }
                emit(IrOp.Call, dest, IrOperand.Sym(asmName), IrOperand.Imm(machineParamCount));
                return dest;
            } else {
                for (var i2 = 0; i2 < node.arguments.length; i2++) {
                    var argVal2 = visitNode(node.arguments[i2]);
                    emit(IrOp.PushArg, argVal2, IrOperand.Imm(i2));
                }
                var dest2 = IrOperand.Temp(allocTemp());
                var asmName2 = (funcSym && funcSym.asmLabel) ? funcSym.asmLabel : sanitizeLabel(funcName || '__indirect_call');
                emit(IrOp.Call, dest2, IrOperand.Sym(asmName2),
                    IrOperand.Imm(node.arguments.length > 0 ? -node.arguments.length : 0));
                return dest2;
            }
        }

        function visitArrayAccessExpr(node) {
            var arrayName = (node.array && node.array.type === 'IdentifierExpr') ? node.array.name : null;
            var arraySym = (arrayName && globalSymbols) ? globalSymbols.resolve(arrayName) : null;

            var isMemArray = arraySym && arraySym.type && arraySym.type.typeClass === 'MemoryArray';
            var isByteAccess = isMemArray && arraySym.type.elementType === SlangType.Byte;

            // shape統一用fallback — checkDefined対象外（arrayNameがnullの場合のみ）
            var arrVi = arrayName ? checkDefined(arrayName, node.array.span) : { kind: VarKind.Scalar, elemSize: 2, varDataSize: 2, local: null, globalSym: null, isResolved: false };
            var isIndirect = arrVi.kind === VarKind.Pointer;
            var isIndirectByte = isIndirect && arrVi.elemSize === 1;
            var isArrayByte = arrVi.kind === VarKind.Array && arrVi.elemSize === 1;

            var isPortArray = arrayName && (arrayName.toUpperCase() === 'PORT' || arrayName.toUpperCase() === 'PORTW');
            var isPortByte = arrayName && arrayName.toUpperCase() === 'PORT';

            var isSosArray = arrayName && (arrayName.toUpperCase() === 'SOS' || arrayName.toUpperCase() === 'SOSW');

            if (isPortArray) {
                var addr = visitNode(node.indices[0]);
                var dest = IrOperand.Temp(allocTemp());
                emit(IrOp.PortIn, dest, addr, undefined, isPortByte ? 1 : 2);
                return dest;
            } else if (isMemArray || isSosArray) {
                var addr2 = visitNode(node.indices[0]);
                var dest2 = IrOperand.Temp(allocTemp());
                emit(IrOp.MemLoad, dest2, addr2, undefined, isByteAccess ? 1 : 2);
                return dest2;
            } else if (isIndirect) {
                var baseAddr = visitNode(node.array);
                var idx = visitNode(node.indices[0]);
                var elemSz = isIndirectByte ? 1 : 2;
                var scaledIdx;
                if (elemSz === 1) scaledIdx = idx;
                else { scaledIdx = IrOperand.Temp(allocTemp()); emit(IrOp.Add, scaledIdx, idx, idx); }
                var addrI = IrOperand.Temp(allocTemp());
                emit(IrOp.Add, addrI, baseAddr, scaledIdx);
                var dest3 = IrOperand.Temp(allocTemp());
                emit(IrOp.IndirLoad, dest3, addrI, undefined, elemSz);
                return dest3;
            } else {
                return computeArrayAccess(node, true);
            }
        }

        function visitConditionalExpr(node) {
            var falseL = newLabel();
            var endL = newLabel();
            var result = IrOperand.Temp(allocTemp());
            var cond = visitNode(node.condition);
            emit(IrOp.JumpIfZero, IrOperand.Lbl(falseL), cond);
            var trueVal = visitNode(node.trueExpr);
            emit(IrOp.Add, result, trueVal, IrOperand.Imm(0));
            emit(IrOp.Jump, IrOperand.Lbl(endL));
            emit(IrOp.Label, IrOperand.Lbl(falseL));
            var falseVal = visitNode(node.falseExpr);
            emit(IrOp.Add, result, falseVal, IrOperand.Imm(0));
            emit(IrOp.Label, IrOperand.Lbl(endL));
            return result;
        }

        function visitCommaExpr(node) {
            visitNode(node.left);
            return visitNode(node.right);
        }

        function visitAddressOfExpr(node) {
            if (node.operand.type === 'IdentifierExpr') {
                var t = IrOperand.Temp(allocTemp());
                if (_localVars && _localVars[node.operand.name.toUpperCase()] !== undefined) {
                    var localInfo = _localVars[node.operand.name.toUpperCase()];
                    var hexOff = localInfo.offset.toString(16).toUpperCase();
                    while (hexOff.length < 4) hexOff = '0' + hexOff;
                    emit(IrOp.InlineAsm, t, IrOperand.Asm('\tPUSH\tIY\n\tPOP\tHL\n\tLD\tDE,$' + hexOff + '\n\tADD\tHL,DE'));
                    return t;
                }
                checkDefined(node.operand.name, node.operand.span);
                emit(IrOp.LoadAddr, t, IrOperand.Sym(resolveAsmLabel(node.operand.name)));
                return t;
            }
            if (node.operand.type === 'ArrayAccessExpr') {
                var arr = node.operand;
                var arrName = (arr.array && arr.array.type === 'IdentifierExpr') ? arr.array.name : null;
                var arrSym = (arrName && globalSymbols) ? globalSymbols.resolve(arrName) : null;

                if (arrSym && arrSym.type && arrSym.type.typeClass === 'MemoryArray')
                    return visitNode(arr.indices[0]);

                if (arrName && (arrName.toUpperCase() === 'PORT' || arrName.toUpperCase() === 'PORTW'))
                    return visitNode(arr.indices[0]);

                // shape統一用fallback — checkDefined対象外（arrNameがnullの場合のみ）
                var addrVi = arrName ? checkDefined(arrName, arr.array.span) : { kind: VarKind.Scalar, elemSize: 2, varDataSize: 2, local: null, globalSym: null, isResolved: false };
                if (addrVi.kind === VarKind.Pointer) {
                    var baseAddr = visitNode(arr.array);
                    var idx = visitNode(arr.indices[0]);
                    var eSize = addrVi.elemSize;
                    var scaledIdx;
                    if (eSize === 1) scaledIdx = idx;
                    else { scaledIdx = IrOperand.Temp(allocTemp()); emit(IrOp.Add, scaledIdx, idx, idx); }
                    var addr = IrOperand.Temp(allocTemp());
                    emit(IrOp.Add, addr, baseAddr, scaledIdx);
                    return addr;
                }

                return computeArrayAccess(arr, false);
            }
            return visitNode(node.operand);
        }

        function visitHighLowExpr(node) {
            var val = visitNode(node.operand);
            var dest = IrOperand.Temp(allocTemp());
            emit(node.isHigh ? IrOp.High : IrOp.Low, dest, val);
            return dest;
        }

        function visitCodeExpr(node) {
            for (var i = 0; i < node.values.length; i++) {
                var v = node.values[i];
                if (v.type === 'StringLiteral') {
                    emit(IrOp.DefString, IrOperand.Asm(v.value));
                } else if (v.type === 'CodeEvalExpr') {
                    visitNode(v.inner);
                } else if (v.type === 'CodeLabelRef') {
                    emit(IrOp.DefWord, IrOperand.Lbl(v.label));
                } else if (v.type === 'CastExpr') {
                    var constVal = globalSymbols ? ConstEvaluator(globalSymbols).evaluate(v.operand) : null;
                    if (constVal !== null) {
                        if (v.targetSize === DataSize.Byte)
                            emit(IrOp.DefByte, IrOperand.Imm(constVal & 0xFF));
                        else
                            emit(IrOp.DefWord, IrOperand.Imm(constVal & 0xFFFF));
                    } else if (v.targetSize === DataSize.Word) {
                        var asmResult = exprToAsmString(v.operand, globalSymbols, diagnostics);
                        if (asmResult) {
                            emit(IrOp.DefWord, IrOperand.Lbl(asmResult.expr));
                            for (var d = 0; d < asmResult.deps.length; d++)
                                _module.addressSymbolDeps[asmResult.deps[d]] = true;
                        } else {
                            visitNode(v.operand);
                        }
                    } else {
                        visitNode(v.operand);
                    }
                } else if (v.type === 'IntegerLiteral') {
                    emit(IrOp.DefByte, IrOperand.Imm(v.value & 0xFF));
                } else {
                    visitNode(v);
                }
            }
            var dest = IrOperand.Temp(allocTemp());
            return dest;
        }

        function visitCastExpr(node) {
            return visitNode(node.operand);
        }

        function visitStringFuncExpr(node) {
            for (var i = 0; i < node.arguments.length; i++) visitNode(node.arguments[i]);
            var t = IrOperand.Temp(allocTemp());
            emit(IrOp.Call, t, IrOperand.Sym('_SF_' + sanitizeLabel(node.funcName)));
            return t;
        }

        // ==== Directives ====
        function visitOrgDirective(node) {
            if (node.value && node.value.type === 'IntegerLiteral')
                _module.orgAddress = node.value.value | 0;
            return IrOperand.None;
        }

        function visitWorkDirective(node) {
            if (node.value && node.value.type === 'IntegerLiteral')
                _module.workAddress = node.value.value | 0;
            return IrOperand.None;
        }

        function visitOffsetDirective(node) {
            if (node.value && node.value.type === 'IntegerLiteral')
                _module.offsetAddress = node.value.value | 0;
            return IrOperand.None;
        }

        function visitModuleBlock(node) {
            var orgAddr = 0;
            if (node.name && node.name.type === 'IntegerLiteral')
                orgAddr = node.name.value | 0;
            else {
                var constEval = globalSymbols ? ConstEvaluator(globalSymbols) : null;
                var val = constEval ? constEval.evaluate(node.name) : null;
                if (val !== null) orgAddr = val;
            }

            var overlay = { index: _module.overlays.length, orgAddress: orgAddr, functions: [], localVars: [], stringTable: {} };

            for (var i = 0; i < node.definitions.length; i++) {
                var prevCount = _module.functions.length;
                visitNode(node.definitions[i]);
                while (_module.functions.length > prevCount) {
                    var func = _module.functions[_module.functions.length - 1];
                    _module.functions.splice(_module.functions.length - 1, 1);
                    overlay.functions.push(func);
                }
            }

            _module.overlays.push(overlay);
            return IrOperand.None;
        }

        function visitPlainAsm(node) {
            emit(IrOp.InlineAsm, IrOperand.Asm(node.asmText));
            return IrOperand.None;
        }

        // ============================================================
        // Public interface
        // ============================================================
        return {
            generate: function(compilationUnit) {
                visitNode(compilationUnit);
                return _module;
            }
        };
    }

    // ================================================================
    // Z80Emitter
    // ================================================================
    function Z80Emitter() {
        var _lines = [];
        return {
            get lines() { return _lines; },
            label: function(name) { _lines.push(name + ':'); },
            instruction: function(mnemonic, operands) {
                if (operands != null)
                    _lines.push('\t' + mnemonic + '\t' + operands);
                else
                    _lines.push('\t' + mnemonic);
            },
            comment: function(text) { _lines.push('; ' + text); },
            blank: function() { _lines.push(''); },
            raw: function(line) { _lines.push(line); },
            org: function(address) {
                _lines.push('\tORG\t$' + ('0000' + address.toString(16).toUpperCase()).slice(-4));
            },
            defByte: function(values) {
                _lines.push('\tDB\t' + values.map(function(v) { return '$' + ('00' + (v & 0xFF).toString(16).toUpperCase()).slice(-2); }).join(','));
            },
            defWord: function(values) {
                _lines.push('\tDW\t' + values.map(function(v) { return '$' + ('0000' + (v & 0xFFFF).toString(16).toUpperCase()).slice(-4); }).join(','));
            },
            defString: function(text) {
                _lines.push('\tDB\t"' + text + '",0');
            },
            appendFrom: function(other) {
                var ol = other.lines;
                for (var i = 0; i < ol.length; i++) _lines.push(ol[i]);
            },
            optimizeWith: function(optimizer) {
                var optimized = optimizer.optimize(_lines);
                _lines.length = 0;
                for (var i = 0; i < optimized.length; i++) _lines.push(optimized[i]);
            },
            toAssembly: function() { return _lines.join('\n'); },
        };
    }

    // ================================================================
    // PeepholeOptimizer
    // ================================================================
    function PeepholeOptimizer() {
        function applyRules(lines) {
            var result = [];
            var changes = 0;
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i].trim();
                var next = (i + 1 < lines.length) ? lines[i + 1].trim() : '';
                // Rule 1: PUSH HL / POP HL -> delete
                if (line === 'PUSH\tHL' && next === 'POP\tHL') { i++; changes++; continue; }
                // Rule 3: PUSH DE / POP DE -> delete
                if (line === 'PUSH\tDE' && next === 'POP\tDE') { i++; changes++; continue; }
                // Rule 4: LD HL,x / PUSH HL / POP DE -> LD DE,x
                if (line.indexOf('LD\tHL,') === 0 && next === 'PUSH\tHL'
                    && i + 2 < lines.length && lines[i + 2].trim() === 'POP\tDE') {
                    var operand = line.substring(6);
                    result.push('\tLD\tDE,' + operand);
                    i += 2; changes++; continue;
                }
                // Rule 5: EX DE,HL / EX DE,HL -> delete
                if (line === 'EX\tDE,HL' && next === 'EX\tDE,HL') { i++; changes++; continue; }
                // Rule 6: JP label / label: -> label: (remove redundant jump)
                if (line.indexOf('JP\t') === 0 && line.indexOf(',') < 0) {
                    var target = line.substring(3).trim();
                    if (next === target + ':') { changes++; continue; }
                }
                // Rule 7: LD DE,x / PUSH DE / POP HL -> LD HL,x
                if (line.indexOf('LD\tDE,') === 0 && next === 'PUSH\tDE'
                    && i + 2 < lines.length && lines[i + 2].trim() === 'POP\tHL') {
                    result.push('\tLD\tHL,' + line.substring(6));
                    i += 2; changes++; continue;
                }
                // Rule 8: PUSH HL / POP DE / EX DE,HL / ADD HL,DE -> ADD HL,HL
                if (line === 'PUSH\tHL' && next === 'POP\tDE'
                    && i + 2 < lines.length && lines[i + 2].trim() === 'EX\tDE,HL'
                    && i + 3 < lines.length && lines[i + 3].trim() === 'ADD\tHL,DE') {
                    result.push('\tADD\tHL,HL');
                    i += 3; changes++; continue;
                }
                // Rule 9: PUSH HL / POP DE / EX DE,HL -> delete
                if (line === 'PUSH\tHL' && next === 'POP\tDE'
                    && i + 2 < lines.length && lines[i + 2].trim() === 'EX\tDE,HL') {
                    i += 2; changes++; continue;
                }
                // Rule 10: POP DE / EX DE,HL / ADD HL,DE -> POP DE / ADD HL,DE
                if (line === 'POP\tDE' && next === 'EX\tDE,HL'
                    && i + 2 < lines.length && lines[i + 2].trim() === 'ADD\tHL,DE') {
                    result.push(lines[i]);
                    result.push('\tADD\tHL,DE');
                    i += 2; changes++; continue;
                }
                // Rule 11: LD (var),HL / LD HL,(var) -> LD (var),HL (remove redundant reload)
                if (line.indexOf('LD\t(') === 0 && line.length > 6 && line.substring(line.length - 3) === ',HL') {
                    var varPart = line.substring(3, line.length - 3);
                    if (next === 'LD\tHL,' + varPart) {
                        result.push(lines[i]);
                        i++; changes++; continue;
                    }
                }
                result.push(lines[i]);
            }
            return { result: result, changes: changes };
        }
        return {
            optimize: function(lines, maxPasses) {
                if (maxPasses == null) maxPasses = 10;
                var result = lines.slice();
                for (var pass = 0; pass < maxPasses; pass++) {
                    var r = applyRules(result);
                    result = r.result;
                    if (r.changes === 0) break;
                }
                return result;
            },
        };
    }

    // ================================================================
    // RuntimeFunction / RuntimeParser / RuntimeManager
    // ================================================================
    function RuntimeFunction() {
        return {
            name: '', paramCount: 0, dependencies: [], code: '',
            initCode: null, libName: null, sourceFile: '', loadOrder: 0,
            works: null, calleeCleanup: false, aliases: [],
        };
    }

    var RuntimeParser = {
        parse: function(text, sourcePath) {
            var functions = [];
            var current = null;
            var codeLines = [];
            var initCodeLines = [];
            var inInitCode = false;

            var rawLines = text.split('\n');
            for (var li = 0; li < rawLines.length; li++) {
                var rawLine = rawLines[li].replace(/\r$/, '');
                var trimLine = rawLine.trimStart ? rawLine.trimStart() : rawLine.replace(/^\s+/, '');
                if (trimLine.indexOf('; @') === 0) {
                    var meta = trimLine.substring(3);
                    var spaceIdx = meta.indexOf(' ');
                    var key = spaceIdx >= 0 ? meta.substring(0, spaceIdx).trim() : meta.trim();
                    var value = spaceIdx >= 0 ? meta.substring(spaceIdx + 1).trim() : '';
                    var keyLower = key.toLowerCase();
                    if (keyLower === 'name') {
                        if (current) {
                            current.code = codeLines.join('\n').replace(/\s+$/, '');
                            if (initCodeLines.length > 0) current.initCode = initCodeLines.join('\n').replace(/\s+$/, '');
                            functions.push(current);
                        }
                        current = RuntimeFunction();
                        current.name = value;
                        current.sourceFile = sourcePath || '<inline>';
                        codeLines = []; initCodeLines = []; inInitCode = false;
                    } else if (keyLower === 'param_count') {
                        if (current) { var pc = parseInt(value, 10); if (!isNaN(pc)) current.paramCount = pc; }
                    } else if (keyLower === 'calls') {
                        if (current) {
                            var deps = value.split(',');
                            for (var di = 0; di < deps.length; di++) {
                                var d = deps[di].trim();
                                if (d) current.dependencies.push(d);
                            }
                        }
                    } else if (keyLower === 'lib') {
                        if (current) current.libName = value;
                    } else if (keyLower === 'works') {
                        if (current && value) {
                            if (!current.works) current.works = [];
                            var items = value.split(',');
                            for (var wi = 0; wi < items.length; wi++) {
                                var item = items[wi].trim();
                                var colonIdx = item.indexOf(':');
                                if (colonIdx > 0) {
                                    var wLabel = item.substring(0, colonIdx).trim();
                                    var wSize = parseInt(item.substring(colonIdx + 1).trim(), 10);
                                    if (!isNaN(wSize)) current.works.push({ label: wLabel, size: wSize });
                                }
                            }
                        }
                    } else if (keyLower === 'init_code') {
                        inInitCode = true;
                    } else if (keyLower === 'end_init') {
                        inInitCode = false;
                    } else if (keyLower === 'stack_cleanup') {
                        if (current && value.toLowerCase() === 'callee') current.calleeCleanup = true;
                    } else if (keyLower === 'alias') {
                        if (current && value) current.aliases.push(value);
                    }
                    continue;
                }
                if (current) {
                    if (inInitCode) initCodeLines.push(rawLine);
                    else codeLines.push(rawLine);
                }
            }
            if (current) {
                current.code = codeLines.join('\n').replace(/\s+$/, '');
                if (initCodeLines.length > 0) current.initCode = initCodeLines.join('\n').replace(/\s+$/, '');
                functions.push(current);
            }
            return functions;
        },
    };

    function RuntimeManager() {
        var _functions = {};      // name(lowercase) -> RuntimeFunction
        var _usedFunctions = {};  // name(lowercase) -> true
        var _excludedFromOutput = {};
        var _loadOrderCounter = 0;

        function lc(s) { return s.toLowerCase(); }

        function markUsed(name) {
            var k = lc(name);
            if (_usedFunctions[k]) return;
            _usedFunctions[k] = true;
            var func = _functions[k];
            if (func) {
                for (var i = 0; i < func.dependencies.length; i++) markUsed(func.dependencies[i]);
            }
        }

        function collectDependencies(name, visited, result) {
            var k = lc(name);
            if (visited[k]) return;
            visited[k] = true;
            var func = _functions[k];
            if (func) {
                for (var i = 0; i < func.dependencies.length; i++)
                    collectDependencies(func.dependencies[i], visited, result);
                result.push(func);
            }
        }

        function getUsedFunctions() {
            var visited = {};
            var result = [];
            for (var name in _usedFunctions) {
                if (_usedFunctions[name]) collectDependencies(name, visited, result);
            }
            return result;
        }

        return {
            get functions() { return _functions; },
            loadFromString: function(text, sourcePath) {
                var funcs = RuntimeParser.parse(text, sourcePath);
                for (var i = 0; i < funcs.length; i++) {
                    var func = funcs[i];
                    func.loadOrder = _loadOrderCounter++;
                    _functions[lc(func.name)] = func;
                    for (var j = 0; j < func.aliases.length; j++)
                        _functions[lc(func.aliases[j])] = func;
                }
            },
            markUsed: markUsed,
            getAndExclude: function(name) {
                markUsed(name);
                _excludedFromOutput[lc(name)] = true;
                var func = _functions[lc(name)];
                return func ? func.code : null;
            },
            getUsedFunctions: getUsedFunctions,
            getUsedWorkVariables: function() {
                var seen = {};
                var result = [];
                var funcs = getUsedFunctions();
                for (var i = 0; i < funcs.length; i++) {
                    if (!funcs[i].works) continue;
                    for (var j = 0; j < funcs[i].works.length; j++) {
                        var w = funcs[i].works[j];
                        var k = lc(w.label);
                        if (!seen[k]) { seen[k] = true; result.push(w); }
                    }
                }
                return result;
            },
            getUsedWorkVariablesWithLib: function() {
                var seen = {};
                var result = [];
                var funcs = getUsedFunctions();
                for (var i = 0; i < funcs.length; i++) {
                    var f = funcs[i];
                    if (!f.works) continue;
                    for (var j = 0; j < f.works.length; j++) {
                        var w = f.works[j];
                        var k = lc(w.label);
                        if (!seen[k]) { seen[k] = true; result.push({ label: w.label, size: w.size, libName: f.libName }); }
                    }
                }
                return result;
            },
            getOutputFunctions: function() {
                return getUsedFunctions()
                    .filter(function(f) { return !_excludedFromOutput[lc(f.name)]; })
                    .sort(function(a, b) { return a.loadOrder - b.loadOrder; });
            },
            resolveForNames: function(names, userFuncs) {
                var visited = {};
                var result = [];
                for (var n in names) {
                    if (names[n] && !userFuncs[lc(n)]) collectDependencies(n, visited, result);
                }
                return result.filter(function(f) { return !_excludedFromOutput[lc(f.name)]; })
                    .sort(function(a, b) { return a.loadOrder - b.loadOrder; });
            },
            hasFunction: function(name) { return !!_functions[lc(name)]; },
            getFunction: function(name) { return _functions[lc(name)] || null; },
        };
    }

    // ================================================================
    // CodeGenerator
    // ================================================================
    function CodeGenerator(irModule, runtimeManager, envConfig, diagnostics) {
        var _module = irModule;
        var _rm = runtimeManager || null;
        var _env = envConfig || {};
        var _diag = diagnostics || null;
        var _mainEmitter = Z80Emitter();
        var _e = _mainEmitter;
        var _currentFuncExitLabel = '_EXIT';
        var _currentFuncLocalSize = 0;
        var _calledFunctions = {};
        var _genLabelCount = 0;
        var _currentFunction = null;

        // optimization pass state
        var _currentDirectBinaryOps = {};
        var _currentHalfDirectOps = {};
        var _currentReverseHalfDirectOps = {};
        var _currentIndirStoreDirectValue = {};
        var _currentSkipEmit = {};

        var isCodeReadonly = _env.codeReadonly === true;

        var SystemRegisterWorks = [
            { label: '_BC', size: 2 }, { label: '_DE', size: 2 }, { label: '_HL', size: 2 },
            { label: '_IX', size: 2 }, { label: '_IY', size: 2 }, { label: '_AF', size: 2 },
            { label: '_CARRY', size: 2 }, { label: '_ZERO', size: 2 }, { label: '_SP', size: 2 },
        ];

        var InvertCond = { Z: 'NZ', NZ: 'Z', C: 'NC', NC: 'C' };
        var SignedCompareRuntimeNames = { LT: 'OPSLTHLDE', GT: 'OPSGTHLDE', LE: 'OPSLEHLDE', GE: 'OPSGEHLDE' };

        function hex4(v) { return ('0000' + ((v & 0xFFFF) >>> 0).toString(16).toUpperCase()).slice(-4); }
        function hex2(v) { return ('00' + ((v & 0xFF) >>> 0).toString(16).toUpperCase()).slice(-2); }

        function asmLabel(name) { return name; }

        function callRuntime(name) {
            _calledFunctions[name] = true;
            _e.instruction('CALL', qualifyAsmExpr(name));
        }

        function qualifyRuntimeName(name) {
            if (_rm) {
                var func = _rm.getFunction(name);
                if (func) {
                    var resolved = func.name;
                    if (func.libName) return func.libName + '.' + resolved;
                    return resolved;
                }
            }
            return name;
        }

        function qualifyAsmExpr(expr) {
            if (!_rm) return expr;
            var funcs = _rm.functions;
            for (var key in funcs) {
                var func = funcs[key];
                var name = key;
                var resolved = func.name;
                if (!func.libName && name === resolved.toLowerCase()) continue;
                // Find name in expr with word boundary check
                var idx = expr.toLowerCase().indexOf(name);
                if (idx < 0) continue;
                var startOk = idx === 0 || (!isAlnumOrUnderscore(expr.charAt(idx - 1)));
                var endOk = idx + name.length >= expr.length || (!isAlnumOrUnderscore(expr.charAt(idx + name.length)));
                if (startOk && endOk) {
                    var target = func.libName ? func.libName + '.' + resolved : resolved;
                    expr = expr.substring(0, idx) + target + expr.substring(idx + name.length);
                }
            }
            return expr;
        }

        function isAlnumOrUnderscore(ch) {
            return /[a-zA-Z0-9_]/.test(ch);
        }

        function isBinaryOp(op) {
            return op === IrOp.Add || op === IrOp.Sub || op === IrOp.Mul || op === IrOp.Div || op === IrOp.Mod
                || op === IrOp.SMul || op === IrOp.SDiv || op === IrOp.SMod
                || op === IrOp.And || op === IrOp.Or || op === IrOp.Xor
                || op === IrOp.Shl || op === IrOp.Shr || op === IrOp.SShl || op === IrOp.SShr
                || op === IrOp.CmpEq || op === IrOp.CmpNeq || op === IrOp.CmpLt || op === IrOp.CmpGt
                || op === IrOp.CmpLe || op === IrOp.CmpGe
                || op === IrOp.CmpSLt || op === IrOp.CmpSGt || op === IrOp.CmpSLe || op === IrOp.CmpSGe
                || op === IrOp.LogAnd || op === IrOp.LogOr;
        }

        function isCommutativeOp(op) {
            return op === IrOp.Add || op === IrOp.Mul || op === IrOp.SMul
                || op === IrOp.And || op === IrOp.Or || op === IrOp.Xor
                || op === IrOp.CmpEq || op === IrOp.CmpNeq
                || op === IrOp.LogAnd || op === IrOp.LogOr;
        }

        function isCompareOp(op) {
            return op === IrOp.CmpEq || op === IrOp.CmpNeq
                || op === IrOp.CmpLt || op === IrOp.CmpGt || op === IrOp.CmpLe || op === IrOp.CmpGe
                || op === IrOp.CmpSLt || op === IrOp.CmpSGt || op === IrOp.CmpSLe || op === IrOp.CmpSGe;
        }

        function isSimpleLoad(inst) {
            return inst.dataSize !== 3 && (inst.op === IrOp.LoadVar || inst.op === IrOp.LoadConst
                || inst.op === IrOp.LoadLocal || inst.op === IrOp.LoadAddr);
        }

        function usesTemp(inst, tempIdx) {
            return (inst.src1.kind === IrOperandKind.Temp && inst.src1.tempIndex === tempIdx)
                || (inst.src2.kind === IrOperandKind.Temp && inst.src2.tempIndex === tempIdx)
                || (inst.dest.kind === IrOperandKind.Temp && inst.dest.tempIndex === tempIdx);
        }

        function needsPushAfter(insts, currentIdx, destTemp) {
            for (var j = currentIdx + 1; j < insts.length; j++) {
                if (_currentSkipEmit[j]) continue;
                var next = insts[j];
                if (next.src1.kind === IrOperandKind.Temp && next.src1.tempIndex === destTemp) {
                    if (_currentDirectBinaryOps[j] || _currentHalfDirectOps[j] || _currentReverseHalfDirectOps[j])
                        return false;
                    if (isBinaryOp(next.op) && next.src2.kind === IrOperandKind.Temp)
                        return true;
                    if ((next.op === IrOp.IndirStore || next.op === IrOp.MemStore || next.op === IrOp.PortOut)
                        && next.dest.kind === IrOperandKind.Temp && next.dest.tempIndex !== destTemp) {
                        if (_currentIndirStoreDirectValue[j] != null) return false;
                        return true;
                    }
                    if (next.op === IrOp.ArrayStore && next.src2.kind === IrOperandKind.Temp)
                        return true;
                    if (next.op === IrOp.StoreVar || next.op === IrOp.StoreLocal)
                        continue;
                    return false;
                }
                if (next.src2.kind === IrOperandKind.Temp && next.src2.tempIndex === destTemp)
                    return false;
                if (next.dest.kind === IrOperandKind.Temp && next.dest.tempIndex === destTemp)
                    return false;
            }
            return false;
        }

        function emitPushValue(dataSize) {
            if (dataSize == null) dataSize = 2;
            if (dataSize === 3) _e.instruction('PUSH', 'AF');
            _e.instruction('PUSH', 'HL');
        }

        function emitPopToDE(dataSize) {
            if (dataSize == null) dataSize = 2;
            if (dataSize === 3) {
                _e.instruction('LD', 'C,A');
                _e.instruction('EX', 'DE,HL');
                _e.instruction('POP', 'HL');
                _e.instruction('POP', 'AF');
            } else {
                _e.instruction('POP', 'DE');
                _e.instruction('EX', 'DE,HL');
            }
        }

        function emitLoadToDE(inst) {
            switch (inst.op) {
                case IrOp.LoadConst:
                    if (inst.src1.kind === IrOperandKind.AsmString)
                        _e.instruction('LD', 'DE,0 ; string placeholder');
                    else
                        _e.instruction('LD', 'DE,$' + hex4(inst.src1.immediateValue));
                    break;
                case IrOp.LoadVar:
                    if (inst.dataSize === 1) {
                        _e.instruction('LD', 'A,(' + asmLabel(inst.src1.name) + ')');
                        _e.instruction('LD', 'E,A'); _e.instruction('LD', 'D,$00');
                    } else
                        _e.instruction('LD', 'DE,(' + asmLabel(inst.src1.name) + ')');
                    break;
                case IrOp.LoadLocal:
                    var off = inst.src1.immediateValue | 0;
                    if (inst.dataSize === 1) {
                        _e.instruction('LD', 'E,(IY+$' + hex2(off) + ')');
                        _e.instruction('LD', 'D,$00');
                    } else {
                        _e.instruction('LD', 'E,(IY+$' + hex2(off) + ')');
                        _e.instruction('LD', 'D,(IY+$' + hex2(off + 1) + ')');
                    }
                    break;
                case IrOp.LoadAddr:
                    var addrName = inst.src1.kind === IrOperandKind.Symbol ? asmLabel(inst.src1.name) : inst.src1.name;
                    _e.instruction('LD', 'DE,' + addrName);
                    break;
            }
        }

        function emitLoadToHL(inst) {
            switch (inst.op) {
                case IrOp.LoadConst:
                    _e.instruction('LD', 'HL,$' + hex4(inst.src1.immediateValue));
                    break;
                case IrOp.LoadVar:
                    if (inst.dataSize === 1) {
                        _e.instruction('LD', 'A,(' + asmLabel(inst.src1.name) + ')');
                        _e.instruction('LD', 'L,A'); _e.instruction('LD', 'H,$00');
                    } else
                        _e.instruction('LD', 'HL,(' + asmLabel(inst.src1.name) + ')');
                    break;
                case IrOp.LoadLocal:
                    var off = inst.src1.immediateValue | 0;
                    if (inst.dataSize === 1) {
                        _e.instruction('LD', 'L,(IY+$' + hex2(off) + ')');
                        _e.instruction('LD', 'H,$00');
                    } else {
                        _e.instruction('LD', 'L,(IY+$' + hex2(off) + ')');
                        _e.instruction('LD', 'H,(IY+$' + hex2(off + 1) + ')');
                    }
                    break;
                case IrOp.LoadAddr:
                    var an = inst.src1.kind === IrOperandKind.Symbol ? asmLabel(inst.src1.name) : inst.src1.name;
                    _e.instruction('LD', 'HL,' + an);
                    break;
            }
        }

        function emitLoadToBC(inst) {
            switch (inst.op) {
                case IrOp.LoadConst:
                    _e.instruction('LD', 'BC,$' + hex4(inst.src1.immediateValue));
                    break;
                case IrOp.LoadVar:
                    if (inst.dataSize === 1) {
                        _e.instruction('LD', 'A,(' + asmLabel(inst.src1.name) + ')');
                        _e.instruction('LD', 'C,A'); _e.instruction('LD', 'B,$00');
                    } else
                        _e.instruction('LD', 'BC,(' + asmLabel(inst.src1.name) + ')');
                    break;
                case IrOp.LoadLocal:
                    var off = inst.src1.immediateValue | 0;
                    if (inst.dataSize === 1) {
                        _e.instruction('LD', 'C,(IY+$' + hex2(off) + ')');
                        _e.instruction('LD', 'B,$00');
                    } else {
                        _e.instruction('LD', 'C,(IY+$' + hex2(off) + ')');
                        _e.instruction('LD', 'B,(IY+$' + hex2(off + 1) + ')');
                    }
                    break;
                case IrOp.LoadAddr:
                    var an = inst.src1.kind === IrOperandKind.Symbol ? asmLabel(inst.src1.name) : inst.src1.name;
                    _e.instruction('LD', 'BC,' + an);
                    break;
            }
        }

        function emitConstMul(constVal, emitSrc) {
            switch (constVal) {
                case 2:
                    if (emitSrc) emitSrc();
                    _e.instruction('ADD', 'HL,HL'); return true;
                case 3:
                    if (emitSrc) emitSrc();
                    _e.instruction('LD', 'D,H'); _e.instruction('LD', 'E,L');
                    _e.instruction('ADD', 'HL,HL'); _e.instruction('ADD', 'HL,DE'); return true;
                case 4:
                    if (emitSrc) emitSrc();
                    _e.instruction('ADD', 'HL,HL'); _e.instruction('ADD', 'HL,HL'); return true;
                case 5:
                    if (emitSrc) emitSrc();
                    _e.instruction('LD', 'D,H'); _e.instruction('LD', 'E,L');
                    _e.instruction('ADD', 'HL,HL'); _e.instruction('ADD', 'HL,HL');
                    _e.instruction('ADD', 'HL,DE'); return true;
                case 6:
                    if (emitSrc) emitSrc();
                    _e.instruction('ADD', 'HL,HL');
                    _e.instruction('LD', 'D,H'); _e.instruction('LD', 'E,L');
                    _e.instruction('ADD', 'HL,HL'); _e.instruction('ADD', 'HL,DE'); return true;
                case 8:
                    if (emitSrc) emitSrc();
                    _e.instruction('ADD', 'HL,HL'); _e.instruction('ADD', 'HL,HL'); _e.instruction('ADD', 'HL,HL'); return true;
                default: return false;
            }
        }

        function emitBinaryDirect(inst) {
            var isFloat = inst.dataSize === 3;
            switch (inst.op) {
                case IrOp.Add:
                    if (isFloat) callRuntime('f24add'); else _e.instruction('ADD', 'HL,DE'); break;
                case IrOp.Sub:
                    if (isFloat) callRuntime('f24sub');
                    else { _e.instruction('OR', 'A'); _e.instruction('SBC', 'HL,DE'); } break;
                case IrOp.Mul: case IrOp.SMul:
                    if (isFloat) callRuntime('f24mul'); else callRuntime('MULHLDE'); break;
                case IrOp.Div: case IrOp.SDiv:
                    if (isFloat) callRuntime('f24div');
                    else callRuntime(inst.op === IrOp.SDiv ? 'SDIVHLDE' : 'DIVHLDE'); break;
                case IrOp.Mod: callRuntime('MODHLDE'); break;
                case IrOp.SMod: callRuntime('SMODHLDE'); break;
                case IrOp.And:
                    _e.instruction('LD', 'A,H'); _e.instruction('AND', 'D'); _e.instruction('LD', 'H,A');
                    _e.instruction('LD', 'A,L'); _e.instruction('AND', 'E'); _e.instruction('LD', 'L,A'); break;
                case IrOp.Or:
                    _e.instruction('LD', 'A,H'); _e.instruction('OR', 'D'); _e.instruction('LD', 'H,A');
                    _e.instruction('LD', 'A,L'); _e.instruction('OR', 'E'); _e.instruction('LD', 'L,A'); break;
                case IrOp.Xor:
                    _e.instruction('LD', 'A,H'); _e.instruction('XOR', 'D'); _e.instruction('LD', 'H,A');
                    _e.instruction('LD', 'A,L'); _e.instruction('XOR', 'E'); _e.instruction('LD', 'L,A'); break;
                case IrOp.Shl: callRuntime('LSHIFTHLDE'); break;
                case IrOp.Shr: callRuntime('RSHIFTHLDE'); break;
                case IrOp.SShl: callRuntime('LSHIFTHLDE'); break;
                case IrOp.SShr: callRuntime('SRSHIFTHLDE'); break;
                case IrOp.CmpEq:
                    if (isFloat) callRuntime('f24cmp');
                    else { _e.instruction('OR', 'A'); _e.instruction('SBC', 'HL,DE'); }
                    _e.instruction('LD', 'HL,$0000'); _e.instruction('JR', 'NZ,$+3'); _e.instruction('INC', 'HL'); break;
                case IrOp.CmpNeq:
                    _e.instruction('OR', 'A'); _e.instruction('SBC', 'HL,DE');
                    _e.instruction('LD', 'HL,$0000'); _e.instruction('JR', 'Z,$+3'); _e.instruction('INC', 'HL'); break;
                case IrOp.CmpLt:
                    _e.instruction('OR', 'A'); _e.instruction('SBC', 'HL,DE');
                    _e.instruction('LD', 'HL,$0000'); _e.instruction('JR', 'NC,$+3'); _e.instruction('INC', 'HL'); break;
                case IrOp.CmpGe:
                    _e.instruction('OR', 'A'); _e.instruction('SBC', 'HL,DE');
                    _e.instruction('LD', 'HL,$0000'); _e.instruction('JR', 'C,$+3'); _e.instruction('INC', 'HL'); break;
                case IrOp.CmpGt:
                    _e.instruction('EX', 'DE,HL'); _e.instruction('OR', 'A'); _e.instruction('SBC', 'HL,DE');
                    _e.instruction('LD', 'HL,$0000'); _e.instruction('JR', 'NC,$+3'); _e.instruction('INC', 'HL'); break;
                case IrOp.CmpLe:
                    _e.instruction('EX', 'DE,HL'); _e.instruction('OR', 'A'); _e.instruction('SBC', 'HL,DE');
                    _e.instruction('LD', 'HL,$0000'); _e.instruction('JR', 'C,$+3'); _e.instruction('INC', 'HL'); break;
                case IrOp.CmpSLt: callRuntime('OPSLTHLDE'); break;
                case IrOp.CmpSGt: callRuntime('OPSGTHLDE'); break;
                case IrOp.CmpSLe: callRuntime('OPSLEHLDE'); break;
                case IrOp.CmpSGe: callRuntime('OPSGEHLDE'); break;
                case IrOp.LogAnd:
                    _e.instruction('LD', 'A,H'); _e.instruction('OR', 'L');
                    _e.instruction('LD', 'HL,$0000'); _e.instruction('JR', 'Z,$+7');
                    _e.instruction('LD', 'A,D'); _e.instruction('OR', 'E');
                    _e.instruction('JR', 'Z,$+3'); _e.instruction('INC', 'HL'); break;
                case IrOp.LogOr:
                    _e.instruction('LD', 'A,H'); _e.instruction('OR', 'L');
                    _e.instruction('OR', 'D'); _e.instruction('OR', 'E');
                    _e.instruction('LD', 'HL,$0000'); _e.instruction('JR', 'Z,$+3'); _e.instruction('INC', 'HL'); break;
                default:
                    _e.comment('unsupported direct: ' + inst.op); break;
            }
        }

        function emitSignedFusedJump(label, lessThan, jumpOnTrue) {
            var jumpIfLess = lessThan === jumpOnTrue;
            var sameSign = '_SC' + (_genLabelCount++);
            _e.instruction('LD', 'A,H');
            _e.instruction('XOR', 'D');
            _e.instruction('JP', 'P,' + sameSign);
            _e.instruction('BIT', '7,H');
            if (jumpIfLess)
                _e.instruction('JP', 'NZ,' + label);
            else
                _e.instruction('JP', 'Z,' + label);
            var done = '_SC' + (_genLabelCount++);
            _e.instruction('JP', done);
            _e.label(sameSign);
            _e.instruction('OR', 'A');
            _e.instruction('SBC', 'HL,DE');
            if (jumpIfLess)
                _e.instruction('JP', 'C,' + label);
            else
                _e.instruction('JP', 'NC,' + label);
            _e.label(done);
        }

        function emitFusedCompareJump(cmpInst, label, jumpOnTrue) {
            if (cmpInst.dataSize === 3) {
                callRuntime('f24cmp');
                switch (cmpInst.op) {
                    case IrOp.CmpEq:
                        _e.instruction('JP', (jumpOnTrue ? 'Z' : 'NZ') + ',' + label); break;
                    case IrOp.CmpNeq:
                        _e.instruction('JP', (jumpOnTrue ? 'NZ' : 'Z') + ',' + label); break;
                    case IrOp.CmpLt:
                        _e.instruction('JP', (jumpOnTrue ? 'C' : 'NC') + ',' + label); break;
                    case IrOp.CmpGe:
                        _e.instruction('JP', (jumpOnTrue ? 'NC' : 'C') + ',' + label); break;
                    case IrOp.CmpGt:
                        if (jumpOnTrue) {
                            var skipGt = '_SC' + (_genLabelCount++);
                            _e.instruction('JP', 'C,' + skipGt);
                            _e.instruction('JP', 'NZ,' + label);
                            _e.label(skipGt);
                        } else {
                            _e.instruction('JP', 'C,' + label);
                            _e.instruction('JP', 'Z,' + label);
                        }
                        break;
                    case IrOp.CmpLe:
                        if (jumpOnTrue) {
                            _e.instruction('JP', 'C,' + label);
                            _e.instruction('JP', 'Z,' + label);
                        } else {
                            var skipLe = '_SC' + (_genLabelCount++);
                            _e.instruction('JP', 'C,' + skipLe);
                            _e.instruction('JP', 'NZ,' + label);
                            _e.label(skipLe);
                        }
                        break;
                    default:
                        emitBinaryDirect(cmpInst);
                        _e.instruction('LD', 'A,H'); _e.instruction('OR', 'L');
                        _e.instruction('JP', (jumpOnTrue ? 'NZ' : 'Z') + ',' + label);
                        break;
                }
                return;
            }
            switch (cmpInst.op) {
                case IrOp.CmpEq:
                    _e.instruction('OR', 'A'); _e.instruction('SBC', 'HL,DE');
                    _e.instruction('JP', (jumpOnTrue ? 'Z' : 'NZ') + ',' + label); break;
                case IrOp.CmpNeq:
                    _e.instruction('OR', 'A'); _e.instruction('SBC', 'HL,DE');
                    _e.instruction('JP', (jumpOnTrue ? 'NZ' : 'Z') + ',' + label); break;
                case IrOp.CmpLt:
                    _e.instruction('OR', 'A'); _e.instruction('SBC', 'HL,DE');
                    _e.instruction('JP', (jumpOnTrue ? 'C' : 'NC') + ',' + label); break;
                case IrOp.CmpGe:
                    _e.instruction('OR', 'A'); _e.instruction('SBC', 'HL,DE');
                    _e.instruction('JP', (jumpOnTrue ? 'NC' : 'C') + ',' + label); break;
                case IrOp.CmpGt:
                    _e.instruction('EX', 'DE,HL'); _e.instruction('OR', 'A'); _e.instruction('SBC', 'HL,DE');
                    _e.instruction('JP', (jumpOnTrue ? 'C' : 'NC') + ',' + label); break;
                case IrOp.CmpLe:
                    _e.instruction('EX', 'DE,HL'); _e.instruction('OR', 'A'); _e.instruction('SBC', 'HL,DE');
                    _e.instruction('JP', (jumpOnTrue ? 'NC' : 'C') + ',' + label); break;
                case IrOp.CmpSLt: emitSignedFusedJump(label, true, jumpOnTrue); break;
                case IrOp.CmpSGe: emitSignedFusedJump(label, false, jumpOnTrue); break;
                case IrOp.CmpSGt:
                    _e.instruction('EX', 'DE,HL'); emitSignedFusedJump(label, true, jumpOnTrue); break;
                case IrOp.CmpSLe:
                    _e.instruction('EX', 'DE,HL'); emitSignedFusedJump(label, false, jumpOnTrue); break;
                default:
                    emitBinaryDirect(cmpInst);
                    _e.instruction('LD', 'A,H'); _e.instruction('OR', 'L');
                    _e.instruction('JP', (jumpOnTrue ? 'NZ' : 'Z') + ',' + label); break;
            }
        }

        // ==== EmitInstruction dispatcher ====
        function emitInstruction(inst) {
            switch (inst.op) {
                case IrOp.FuncBegin: emitFuncBegin(inst); break;
                case IrOp.FuncEnd: emitFuncEnd(); break;
                case IrOp.LoadConst: emitLoadConst(inst); break;
                case IrOp.LoadVar: emitLoadVar(inst); break;
                case IrOp.StoreVar: emitStoreVar(inst); break;
                case IrOp.LoadLocal: emitLoadLocal(inst); break;
                case IrOp.StoreLocal: emitStoreLocal(inst); break;
                case IrOp.LoadAddr: emitLoadAddr(inst); break;
                case IrOp.Add: emitArith(inst, 'ADD'); break;
                case IrOp.Sub: emitArith(inst, 'SUB'); break;
                case IrOp.Mul: case IrOp.SMul: emitMul(inst); break;
                case IrOp.Div: emitDiv(inst, false); break;
                case IrOp.SDiv: emitDiv(inst, true); break;
                case IrOp.Mod: emitMod(inst, false); break;
                case IrOp.SMod: emitMod(inst, true); break;
                case IrOp.Neg: emitNeg(inst); break;
                case IrOp.And: emitBitwise(inst, 'AND'); break;
                case IrOp.Or: emitBitwise(inst, 'OR'); break;
                case IrOp.Xor: emitBitwise(inst, 'XOR'); break;
                case IrOp.Not: emitCpl(inst); break;
                case IrOp.Shl: emitShift(inst, true); break;
                case IrOp.Shr: emitShift(inst, false); break;
                case IrOp.CmpEq: emitCompare(inst, 'Z'); break;
                case IrOp.CmpNeq: emitCompare(inst, 'NZ'); break;
                case IrOp.CmpLt: emitCompare(inst, 'C'); break;
                case IrOp.CmpGe: emitCompare(inst, 'NC'); break;
                case IrOp.CmpGt: emitCompareGt(inst); break;
                case IrOp.CmpLe: emitCompareLe(inst); break;
                case IrOp.CmpSLt: emitSignedCompare(inst, 'LT'); break;
                case IrOp.CmpSGt: emitSignedCompare(inst, 'GT'); break;
                case IrOp.CmpSLe: emitSignedCompare(inst, 'LE'); break;
                case IrOp.CmpSGe: emitSignedCompare(inst, 'GE'); break;
                case IrOp.LogAnd: emitLogAnd(inst); break;
                case IrOp.LogOr: emitLogOr(inst); break;
                case IrOp.LogNot: emitLogNot(inst); break;
                case IrOp.High: emitHighLow(inst, true); break;
                case IrOp.Low: emitHighLow(inst, false); break;
                case IrOp.ArrayLoad: emitArrayLoad(inst); break;
                case IrOp.ArrayStore: emitArrayStore(inst); break;
                case IrOp.MemLoad: emitMemLoad(inst); break;
                case IrOp.MemStore: emitMemStore(inst); break;
                case IrOp.IndirLoad: emitIndirLoad(inst); break;
                case IrOp.IndirStore: emitIndirStore(inst); break;
                case IrOp.PortIn: emitPortIn(inst); break;
                case IrOp.PortOut: emitPortOut(inst); break;
                case IrOp.Label: _e.label(inst.dest.name || ''); break;
                case IrOp.Jump: _e.instruction('JP', inst.dest.name); break;
                case IrOp.JumpIfZero:
                    _e.comment('if ' + inst.src1.tempIndex + ' == 0 goto ' + inst.dest.name);
                    _e.instruction('LD', 'A,H'); _e.instruction('OR', 'L');
                    _e.instruction('JP', 'Z,' + inst.dest.name); break;
                case IrOp.JumpIfNonZero:
                    _e.comment('if ' + inst.src1.tempIndex + ' != 0 goto ' + inst.dest.name);
                    _e.instruction('LD', 'A,H'); _e.instruction('OR', 'L');
                    _e.instruction('JP', 'NZ,' + inst.dest.name); break;
                case IrOp.Call: emitCall(inst); break;
                case IrOp.Return:
                    if (inst.dest.kind !== IrOperandKind.None)
                        _e.comment('return value in HL');
                    _e.instruction('JP', _currentFuncExitLabel); break;
                case IrOp.PushArg: emitPushValue(inst.dataSize); break;
                case IrOp.InlineAsm:
                    var asmCode = inst.dest.kind === IrOperandKind.Temp ? inst.src1.name : inst.dest.name;
                    if (asmCode) {
                        _e.raw(asmCode);
                        var asmLines = asmCode.split('\n');
                        for (var ai = 0; ai < asmLines.length; ai++) {
                            var trimmed = asmLines[ai].trim();
                            if (trimmed.indexOf('CALL\t') === 0 || trimmed.indexOf('CALL ') === 0) {
                                var fn = trimmed.substring(5).trim().split(';')[0].trim();
                                if (fn) _calledFunctions[fn] = true;
                            }
                        }
                    }
                    break;
                case IrOp.Comment: _e.comment(inst.dest.name || ''); break;
                case IrOp.DefByte: _e.raw('\tDB\t$' + hex2(inst.dest.immediateValue)); break;
                case IrOp.DefWord:
                    if (inst.dest.kind === IrOperandKind.Label) _e.raw('\tDW\t' + inst.dest.name);
                    else _e.raw('\tDW\t$' + hex4(inst.dest.immediateValue));
                    break;
                case IrOp.DefString:
                    if (inst.dest.name != null) {
                        var dbArgs = toAsmDbArgs(inst.dest.name);
                        _e.raw('\tDB\t' + dbArgs);
                    }
                    break;
                case IrOp.Nop: break;
                default: _e.comment('TODO: ' + inst.op); break;
            }
        }

        // ==== Individual instruction emitters ====
        function emitFuncBegin(inst) {
            var funcName = inst.dest.name || 'UNKNOWN';
            _currentFuncExitLabel = '_' + funcName + '_EXIT';
            _currentFuncLocalSize = (_currentFunction && _currentFunction.localSize > 0)
                ? _currentFunction.localSize : computeLocalSize();
            _e.comment('function ' + funcName);
            if (_currentFuncLocalSize > 0) {
                _e.instruction('PUSH', 'IY');
                _e.instruction('LD', 'BC,$' + hex4(_currentFuncLocalSize));
                _e.instruction('ADD', 'IY,BC');
            }
        }

        function emitFuncEnd() {
            _e.label(_currentFuncExitLabel);
            if (_currentFuncLocalSize > 0) _e.instruction('POP', 'IY');
            _e.instruction('RET');
        }

        function computeLocalSize() {
            if (!_currentFunction) return 0;
            var minOffset = 0x70;
            var insts = _currentFunction.instructions;
            for (var i = 0; i < insts.length; i++) {
                var inst = insts[i];
                if (inst.op === IrOp.StoreLocal || inst.op === IrOp.LoadLocal) {
                    var off = inst.op === IrOp.StoreLocal ? (inst.dest.immediateValue | 0) : (inst.src1.immediateValue | 0);
                    if (off < 0x70 && off < minOffset) minOffset = off;
                }
            }
            return 0x70 - minOffset;
        }

        function emitLoadConst(inst) {
            if (inst.src1.kind === IrOperandKind.AsmString) {
                _e.comment('load string ' + inst.src1.name);
                _e.instruction('LD', 'HL,0 ; string placeholder');
            } else {
                var val = inst.src1.immediateValue & 0xFFFF;
                if (inst.dataSize === 1)
                    _e.instruction('LD', 'A,$' + hex2(val));
                else
                    _e.instruction('LD', 'HL,$' + hex4(val));
            }
        }

        function emitLoadVar(inst) {
            var lbl = asmLabel(inst.src1.name);
            if (inst.dataSize === 1) {
                _e.instruction('LD', 'A,(' + lbl + ')');
                _e.instruction('LD', 'L,A'); _e.instruction('LD', 'H,$00');
            } else {
                _e.instruction('LD', 'HL,(' + lbl + ')');
                if (inst.dataSize === 3) _e.instruction('LD', 'A,(' + lbl + '+2)');
            }
        }

        function emitStoreVar(inst) {
            var lbl = asmLabel(inst.dest.name);
            if (inst.dataSize === 1) {
                _e.instruction('LD', 'A,L'); _e.instruction('LD', '(' + lbl + '),A');
            } else {
                _e.instruction('LD', '(' + lbl + '),HL');
                if (inst.dataSize === 3) _e.instruction('LD', '(' + lbl + '+2),A');
            }
        }

        function emitLoadLocal(inst) {
            var off = inst.src1.immediateValue | 0;
            if (inst.dataSize === 1) {
                _e.instruction('LD', 'L,(IY+$' + hex2(off) + ')'); _e.instruction('LD', 'H,$00');
            } else {
                _e.instruction('LD', 'L,(IY+$' + hex2(off) + ')');
                _e.instruction('LD', 'H,(IY+$' + hex2(off + 1) + ')');
                if (inst.dataSize === 3) _e.instruction('LD', 'A,(IY+$' + hex2(off + 2) + ')');
            }
        }

        function emitStoreLocal(inst) {
            var off = inst.dest.immediateValue | 0;
            if (inst.dataSize === 1) {
                _e.instruction('LD', '(IY+$' + hex2(off) + '),L');
            } else {
                _e.instruction('LD', '(IY+$' + hex2(off) + '),L');
                _e.instruction('LD', '(IY+$' + hex2(off + 1) + '),H');
                if (inst.dataSize === 3) _e.instruction('LD', '(IY+$' + hex2(off + 2) + '),A');
            }
        }

        function emitLoadAddr(inst) {
            var name = inst.src1.name;
            var lbl = inst.src1.kind === IrOperandKind.Symbol ? asmLabel(name) : name;
            _e.instruction('LD', 'HL,' + lbl);
            if (inst.src1.kind === IrOperandKind.Symbol) _calledFunctions[name] = true;
        }

        function emitArith(inst, op) {
            emitPopToDE(inst.dataSize);
            if (inst.dataSize === 3) callRuntime(op === 'ADD' ? 'f24add' : 'f24sub');
            else if (op === 'ADD') _e.instruction('ADD', 'HL,DE');
            else { _e.instruction('OR', 'A'); _e.instruction('SBC', 'HL,DE'); }
        }
        function emitMul(inst) { emitPopToDE(inst.dataSize); if (inst.dataSize === 3) callRuntime('f24mul'); else callRuntime('MULHLDE'); }
        function emitDiv(inst, signed) { emitPopToDE(inst.dataSize); if (inst.dataSize === 3) callRuntime('f24div'); else callRuntime(signed ? 'SDIVHLDE' : 'DIVHLDE'); }
        function emitMod(inst, signed) { _e.instruction('POP', 'DE'); _e.instruction('EX', 'DE,HL'); callRuntime(signed ? 'SMODHLDE' : 'MODHLDE'); }
        function emitNeg(inst) {
            _e.instruction('LD', 'A,H'); _e.instruction('CPL'); _e.instruction('LD', 'H,A');
            _e.instruction('LD', 'A,L'); _e.instruction('CPL'); _e.instruction('LD', 'L,A');
            _e.instruction('INC', 'HL');
        }
        function emitBitwise(inst, op) {
            _e.instruction('POP', 'DE');
            _e.instruction('LD', 'A,D'); _e.instruction(op, 'H'); _e.instruction('LD', 'H,A');
            _e.instruction('LD', 'A,E'); _e.instruction(op, 'L'); _e.instruction('LD', 'L,A');
        }
        function emitCpl(inst) {
            _e.instruction('LD', 'A,H'); _e.instruction('CPL'); _e.instruction('LD', 'H,A');
            _e.instruction('LD', 'A,L'); _e.instruction('CPL'); _e.instruction('LD', 'L,A');
        }
        function emitShift(inst, left) {
            _e.instruction('POP', 'DE'); _e.instruction('EX', 'DE,HL');
            callRuntime(left ? 'LSHIFTHLDE' : 'RSHIFTHLDE');
        }
        function emitCompare(inst, trueCond) {
            emitPopToDE(inst.dataSize);
            if (inst.dataSize === 3) callRuntime('f24cmp');
            else { _e.instruction('OR', 'A'); _e.instruction('SBC', 'HL,DE'); }
            _e.instruction('LD', 'HL,$0000');
            _e.instruction('JR', InvertCond[trueCond] + ',$+3');
            _e.instruction('INC', 'HL');
        }
        function emitCompareGt(inst) {
            emitPopToDE(inst.dataSize);
            _e.instruction('EX', 'DE,HL');
            if (inst.dataSize === 3) {
                _e.instruction('LD', 'B,A'); _e.instruction('LD', 'A,C'); _e.instruction('LD', 'C,B');
                callRuntime('f24cmp');
            } else { _e.instruction('OR', 'A'); _e.instruction('SBC', 'HL,DE'); }
            _e.instruction('LD', 'HL,$0000'); _e.instruction('JR', 'NC,$+3'); _e.instruction('INC', 'HL');
        }
        function emitCompareLe(inst) {
            emitCompareGt(inst);
            _e.instruction('LD', 'A,L'); _e.instruction('XOR', '$01'); _e.instruction('LD', 'L,A');
        }
        function emitSignedCompare(inst, kind) {
            _e.instruction('POP', 'DE'); _e.instruction('EX', 'DE,HL');
            callRuntime(SignedCompareRuntimeNames[kind]);
        }
        function emitLogAnd(inst) {
            _e.instruction('POP', 'DE');
            _e.instruction('LD', 'A,D'); _e.instruction('OR', 'E');
            _e.instruction('LD', 'D,H'); _e.instruction('LD', 'E,L');
            _e.instruction('LD', 'HL,$0000'); _e.instruction('JR', 'Z,$+7');
            _e.instruction('LD', 'A,D'); _e.instruction('OR', 'E');
            _e.instruction('JR', 'Z,$+3'); _e.instruction('INC', 'HL');
        }
        function emitLogOr(inst) {
            _e.instruction('POP', 'DE');
            _e.instruction('LD', 'A,H'); _e.instruction('OR', 'L');
            _e.instruction('OR', 'D'); _e.instruction('OR', 'E');
            _e.instruction('LD', 'HL,$0000'); _e.instruction('JR', 'Z,$+3'); _e.instruction('INC', 'HL');
        }
        function emitLogNot(inst) {
            _e.instruction('LD', 'A,H'); _e.instruction('OR', 'L');
            _e.instruction('LD', 'HL,$0001'); _e.instruction('JR', 'Z,$+3'); _e.instruction('DEC', 'HL');
        }
        function emitHighLow(inst, high) {
            if (high) { _e.instruction('LD', 'L,H'); _e.instruction('LD', 'H,$00'); }
            else _e.instruction('LD', 'H,$00');
        }
        function emitArrayLoad(inst) {
            var isByte = inst.dataSize === 1;
            _e.comment('array load [' + (isByte ? 'BYTE' : 'WORD') + ']');
            if (!isByte) _e.instruction('ADD', 'HL,HL');
            _e.instruction('POP', 'DE'); _e.instruction('ADD', 'HL,DE');
            if (isByte) { _e.instruction('LD', 'L,(HL)'); _e.instruction('LD', 'H,$00'); }
            else { _e.instruction('LD', 'E,(HL)'); _e.instruction('INC', 'HL'); _e.instruction('LD', 'D,(HL)'); _e.instruction('EX', 'DE,HL'); }
        }
        function emitArrayStore(inst) {
            var isByte = inst.dataSize === 1;
            _e.comment('array store [' + (isByte ? 'BYTE' : 'WORD') + ']');
            if (!isByte) _e.instruction('ADD', 'HL,HL');
            _e.instruction('POP', 'DE'); _e.instruction('ADD', 'HL,DE');
            _e.instruction('POP', 'DE');
            if (isByte) _e.instruction('LD', '(HL),E');
            else { _e.instruction('LD', '(HL),E'); _e.instruction('INC', 'HL'); _e.instruction('LD', '(HL),D'); }
        }
        function emitMemLoad(inst) {
            if (inst.dataSize === 1) { _e.instruction('LD', 'L,(HL)'); _e.instruction('LD', 'H,$00'); }
            else { _e.instruction('LD', 'E,(HL)'); _e.instruction('INC', 'HL'); _e.instruction('LD', 'D,(HL)'); _e.instruction('EX', 'DE,HL'); }
        }
        function emitMemStore(inst) {
            _e.instruction('POP', 'DE');
            if (inst.dataSize === 1) _e.instruction('LD', '(HL),E');
            else { _e.instruction('LD', '(HL),E'); _e.instruction('INC', 'HL'); _e.instruction('LD', '(HL),D'); }
        }
        function emitIndirLoad(inst) {
            if (inst.dataSize === 1) { _e.instruction('LD', 'L,(HL)'); _e.instruction('LD', 'H,$00'); }
            else { _e.instruction('LD', 'E,(HL)'); _e.instruction('INC', 'HL'); _e.instruction('LD', 'D,(HL)'); _e.instruction('EX', 'DE,HL'); }
        }
        function emitIndirStore(inst) {
            _e.instruction('POP', 'DE');
            if (inst.dataSize === 1) _e.instruction('LD', '(HL),E');
            else { _e.instruction('LD', '(HL),E'); _e.instruction('INC', 'HL'); _e.instruction('LD', '(HL),D'); }
        }
        function emitPortIn(inst) {
            _e.instruction('LD', 'B,H'); _e.instruction('LD', 'C,L');
            if (inst.dataSize === 1) { _e.instruction('IN', 'L,(C)'); _e.instruction('LD', 'H,$00'); }
            else { _e.instruction('IN', 'L,(C)'); _e.instruction('INC', 'BC'); _e.instruction('IN', 'H,(C)'); }
        }
        function emitPortOut(inst) {
            _e.instruction('POP', 'DE');
            _e.instruction('LD', 'B,H'); _e.instruction('LD', 'C,L');
            _e.instruction('EX', 'DE,HL');
            if (inst.dataSize === 1) _e.instruction('OUT', '(C),L');
            else { _e.instruction('OUT', '(C),L'); _e.instruction('INC', 'BC'); _e.instruction('OUT', '(C),H'); }
        }

        function emitCall(inst) {
            var funcName = inst.src1.name || String(inst.src1);
            _calledFunctions[funcName] = true;
            var isRuntimeOrExpr = (_rm && _rm.hasFunction(funcName))
                || funcName.indexOf('+') >= 0 || funcName.indexOf('-') >= 0;
            var callLabel = isRuntimeOrExpr ? qualifyAsmExpr(funcName) : funcName;
            var callArgMode = inst.src2.immediateValue | 0;

            if (callArgMode < 0) {
                var userArgCount = -callArgMode;
                var argOffset = 0x70 + (userArgCount - 1) * 2;
                for (var i = userArgCount - 1; i >= 0; i--) {
                    _e.instruction('POP', 'HL');
                    _e.instruction('LD', '(IY+$' + hex2(argOffset) + '),L');
                    _e.instruction('LD', '(IY+$' + hex2(argOffset + 1) + '),H');
                    argOffset -= 2;
                }
            } else if (callArgMode > 0 && callArgMode <= 3) {
                if (callArgMode >= 3) _e.instruction('POP', 'BC');
                if (callArgMode >= 2) _e.instruction('POP', 'DE');
                _e.instruction('POP', 'HL');
            }

            _e.instruction('CALL', callLabel);

            if (callArgMode >= 4) {
                var calleeCleanup = false;
                if (_rm) { var rtFunc = _rm.getFunction(funcName); if (rtFunc) calleeCleanup = rtFunc.calleeCleanup; }
                if (!calleeCleanup) {
                    var stackSize = callArgMode * 2;
                    _e.instruction('EX', 'DE,HL');
                    _e.instruction('LD', 'HL,' + stackSize);
                    _e.instruction('ADD', 'HL,SP');
                    _e.instruction('LD', 'SP,HL');
                    _e.instruction('EX', 'DE,HL');
                }
            }
        }

        // ==== EmitFunction: main function codegen with optimization passes ====
        function emitFunction(func) {
            _currentFunction = func;
            _e.label(func.name);

            var insts = func.instructions;
            // Pass 1: temp definition map
            var tempDef = {};
            for (var i = 0; i < insts.length; i++) {
                if (insts[i].dest.kind === IrOperandKind.Temp)
                    tempDef[insts[i].dest.tempIndex] = i;
            }

            var skipEmit = {};
            var directBinaryOps = {};
            var halfDirectOps = {};
            var reverseHalfDirectOps = {};

            for (var i = 0; i < insts.length; i++) {
                var inst = insts[i];
                if (isBinaryOp(inst.op)
                    && inst.src1.kind === IrOperandKind.Temp
                    && inst.src2.kind === IrOperandKind.Temp
                    && tempDef[inst.src1.tempIndex] != null
                    && tempDef[inst.src2.tempIndex] != null) {
                    var s1 = tempDef[inst.src1.tempIndex];
                    var s2 = tempDef[inst.src2.tempIndex];
                    if (isSimpleLoad(insts[s1]) && isSimpleLoad(insts[s2])) {
                        skipEmit[s1] = true; skipEmit[s2] = true; directBinaryOps[i] = true;
                    } else if (isSimpleLoad(insts[s2]) && !isSimpleLoad(insts[s1])) {
                        skipEmit[s2] = true; halfDirectOps[i] = true;
                    } else if (isSimpleLoad(insts[s1]) && !isSimpleLoad(insts[s2]) && isCommutativeOp(inst.op)) {
                        skipEmit[s1] = true; reverseHalfDirectOps[i] = true;
                    }
                }
            }

            // Fused compare+jump
            var fusedCompareJumps = {};
            for (var i = 0; i < insts.length - 1; i++) {
                if (isCompareOp(insts[i].op) && insts[i].dest.kind === IrOperandKind.Temp) {
                    var cmpTemp = insts[i].dest.tempIndex;
                    for (var j = i + 1; j < insts.length; j++) {
                        if (skipEmit[j]) continue;
                        if ((insts[j].op === IrOp.JumpIfZero || insts[j].op === IrOp.JumpIfNonZero)
                            && insts[j].src1.kind === IrOperandKind.Temp
                            && insts[j].src1.tempIndex === cmpTemp) {
                            fusedCompareJumps[i] = j;
                            skipEmit[j] = true;
                            break;
                        }
                        if (usesTemp(insts[j], cmpTemp)) break;
                    }
                }
            }

            // IndirStore/MemStore direct value load
            var indirStoreDirectValue = {};
            for (var i = 0; i < insts.length; i++) {
                var inst = insts[i];
                if ((inst.op === IrOp.IndirStore || inst.op === IrOp.MemStore)
                    && inst.src1.kind === IrOperandKind.Temp
                    && tempDef[inst.src1.tempIndex] != null) {
                    var valDefIdx = tempDef[inst.src1.tempIndex];
                    var valDef = insts[valDefIdx];
                    if (isSimpleLoad(valDef) && !skipEmit[valDefIdx]) {
                        var valTemp = inst.src1.tempIndex;
                        var onlyUsedHere = true;
                        for (var j = 0; j < insts.length; j++) {
                            if (j === i || j === valDefIdx) continue;
                            if (skipEmit[j]) continue;
                            if (usesTemp(insts[j], valTemp)) { onlyUsedHere = false; break; }
                        }
                        if (onlyUsedHere) { indirStoreDirectValue[i] = valDefIdx; skipEmit[valDefIdx] = true; }
                    }
                }
            }

            // StoreLocal direct const
            var storeLocalDirectConst = {};
            for (var i = 0; i < insts.length; i++) {
                var inst = insts[i];
                if (inst.op === IrOp.StoreLocal
                    && inst.src1.kind === IrOperandKind.Temp
                    && tempDef[inst.src1.tempIndex] != null) {
                    var cDefIdx = tempDef[inst.src1.tempIndex];
                    var cDef = insts[cDefIdx];
                    if (cDef.op === IrOp.LoadConst && cDef.src1.kind === IrOperandKind.Immediate && !skipEmit[cDefIdx]) {
                        var vt = inst.src1.tempIndex;
                        var ouh = true;
                        for (var j = 0; j < insts.length; j++) {
                            if (j === i || j === cDefIdx) continue;
                            if (usesTemp(insts[j], vt)) { ouh = false; break; }
                        }
                        if (ouh) { storeLocalDirectConst[i] = cDefIdx; skipEmit[cDefIdx] = true; }
                    }
                }
            }

            // MACHINE direct register load
            var machineDirectCandidates = {};
            for (var i = 0; i < insts.length; i++) {
                var inst = insts[i];
                if (inst.op !== IrOp.Call || inst.src2.kind !== IrOperandKind.Immediate) continue;
                var argCount = inst.src2.immediateValue | 0;
                if (argCount < 1 || argCount > 3) continue;
                var argDefs = []; var pushIdxs = [];
                var pos = i - 1;
                var allSimple = true;
                for (var a = argCount - 1; a >= 0; a--) {
                    while (pos >= 0 && skipEmit[pos]) pos--;
                    if (pos < 0 || insts[pos].op !== IrOp.PushArg) { allSimple = false; break; }
                    pushIdxs.unshift(pos); pos--;
                    while (pos >= 0 && skipEmit[pos]) pos--;
                    if (pos < 0 || !isSimpleLoad(insts[pos])) { allSimple = false; break; }
                    var loadTemp = insts[pos].dest.tempIndex;
                    var onlyUsedByPush = true;
                    for (var j = 0; j < insts.length; j++) {
                        if (j === pos || j === pushIdxs[0]) continue;
                        if (usesTemp(insts[j], loadTemp)) { onlyUsedByPush = false; break; }
                    }
                    if (!onlyUsedByPush) { allSimple = false; break; }
                    argDefs.unshift(pos); pos--;
                }
                if (allSimple && argDefs.length === argCount)
                    machineDirectCandidates[i] = { argDefs: argDefs, pushIdxs: pushIdxs };
            }
            var machineDirectArgs = {};
            for (var callIdx in machineDirectCandidates) {
                var c = machineDirectCandidates[callIdx];
                machineDirectArgs[callIdx] = c.argDefs;
                for (var ii = 0; ii < c.argDefs.length; ii++) skipEmit[c.argDefs[ii]] = true;
                for (var ii = 0; ii < c.pushIdxs.length; ii++) skipEmit[c.pushIdxs[ii]] = true;
            }

            // Set fields for NeedsPushAfter
            _currentDirectBinaryOps = directBinaryOps;
            _currentHalfDirectOps = halfDirectOps;
            _currentReverseHalfDirectOps = reverseHalfDirectOps;
            _currentIndirStoreDirectValue = indirStoreDirectValue;
            _currentSkipEmit = skipEmit;

            // Pass 2: emit
            for (var i = 0; i < insts.length; i++) {
                if (skipEmit[i]) continue;
                var inst = insts[i];

                if (directBinaryOps[i] && inst.dataSize !== 3) {
                    var s1Inst = insts[tempDef[inst.src1.tempIndex]];
                    var s2Inst = insts[tempDef[inst.src2.tempIndex]];

                    if (fusedCompareJumps[i] != null) {
                        var jumpInst = insts[fusedCompareJumps[i]];
                        var jumpOnTrue = jumpInst.op === IrOp.JumpIfNonZero;
                        emitInstruction(s1Inst);
                        emitLoadToDE(s2Inst);
                        emitFusedCompareJump(inst, jumpInst.dest.name, jumpOnTrue);
                        continue;
                    }

                    // Constant folding
                    if (s1Inst.op === IrOp.LoadConst && s2Inst.op === IrOp.LoadConst
                        && s1Inst.src1.kind === IrOperandKind.Immediate && s2Inst.src1.kind === IrOperandKind.Immediate) {
                        var v1 = (s1Inst.src1.immediateValue & 0xFFFF);
                        var v2 = (s2Inst.src1.immediateValue & 0xFFFF);
                        var foldResult = null;
                        switch (inst.op) {
                            case IrOp.Add: foldResult = (v1 + v2) & 0xFFFF; break;
                            case IrOp.Sub: foldResult = (v1 - v2) & 0xFFFF; break;
                            case IrOp.Mul: case IrOp.SMul: foldResult = (v1 * v2) & 0xFFFF; break;
                            case IrOp.And: foldResult = v1 & v2; break;
                            case IrOp.Or: foldResult = v1 | v2; break;
                            case IrOp.Xor: foldResult = v1 ^ v2; break;
                            case IrOp.Shl: foldResult = (v1 << v2) & 0xFFFF; break;
                            case IrOp.Shr: foldResult = (v1 >>> v2) & 0xFFFF; break;
                        }
                        if (foldResult !== null) {
                            _e.instruction('LD', 'HL,$' + hex4(foldResult));
                            if (inst.dest.kind === IrOperandKind.Temp && needsPushAfter(insts, i, inst.dest.tempIndex))
                                _e.instruction('PUSH', 'HL');
                            continue;
                        }
                    }

                    // LoadAddr + LoadConst Add -> LD HL,label+offset
                    if (inst.op === IrOp.Add) {
                        var addrInst = null, constInst = null;
                        if (s1Inst.op === IrOp.LoadAddr && s2Inst.op === IrOp.LoadConst && s2Inst.src1.kind === IrOperandKind.Immediate)
                            { addrInst = s1Inst; constInst = s2Inst; }
                        else if (s2Inst.op === IrOp.LoadAddr && s1Inst.op === IrOp.LoadConst && s1Inst.src1.kind === IrOperandKind.Immediate)
                            { addrInst = s2Inst; constInst = s1Inst; }
                        if (addrInst && constInst) {
                            var addrOff = constInst.src1.immediateValue & 0xFFFF;
                            var addrLbl = asmLabel(addrInst.src1.name);
                            _e.instruction('LD', 'HL,' + addrLbl + (addrOff === 0 ? '' : '+' + addrOff));
                            if (inst.dest.kind === IrOperandKind.Temp && needsPushAfter(insts, i, inst.dest.tempIndex))
                                _e.instruction('PUSH', 'HL');
                            continue;
                        }
                    }

                    // Same operand Add -> ADD HL,HL
                    if (inst.op === IrOp.Add && inst.src1.tempIndex === inst.src2.tempIndex) {
                        emitInstruction(s1Inst);
                        _e.instruction('ADD', 'HL,HL');
                        if (inst.dest.kind === IrOperandKind.Temp && needsPushAfter(insts, i, inst.dest.tempIndex))
                            _e.instruction('PUSH', 'HL');
                        continue;
                    }

                    // Same variable Add -> ADD HL,HL
                    if (inst.op === IrOp.Add
                        && s1Inst.op === s2Inst.op && (s1Inst.op === IrOp.LoadVar || s1Inst.op === IrOp.LoadLocal || s1Inst.op === IrOp.LoadConst)
                        && s1Inst.dataSize === 2
                        && s1Inst.src1.kind === s2Inst.src1.kind
                        && ((s1Inst.src1.kind === IrOperandKind.Label && s1Inst.src1.name === s2Inst.src1.name)
                            || (s1Inst.src1.kind === IrOperandKind.Immediate && s1Inst.src1.immediateValue === s2Inst.src1.immediateValue))) {
                        emitInstruction(s1Inst);
                        _e.instruction('ADD', 'HL,HL');
                        if (inst.dest.kind === IrOperandKind.Temp && needsPushAfter(insts, i, inst.dest.tempIndex))
                            _e.instruction('PUSH', 'HL');
                        continue;
                    }

                    // INC/DEC optimization
                    if ((inst.op === IrOp.Add || inst.op === IrOp.Sub)
                        && s2Inst.op === IrOp.LoadConst && s2Inst.src1.kind === IrOperandKind.Immediate) {
                        var cv = s2Inst.src1.immediateValue & 0xFFFF;
                        var incOrDec = inst.op === IrOp.Add ? 'INC' : 'DEC';
                        if (cv === 0) { emitInstruction(s1Inst); }
                        else if (cv === 1) { emitInstruction(s1Inst); _e.instruction(incOrDec, 'HL'); }
                        else if (cv === 2) { emitInstruction(s1Inst); _e.instruction(incOrDec, 'HL'); _e.instruction(incOrDec, 'HL'); }
                        else { cv = -1; } // signal not handled
                        if (cv >= 0 && cv <= 2) {
                            if (inst.dest.kind === IrOperandKind.Temp && needsPushAfter(insts, i, inst.dest.tempIndex))
                                _e.instruction('PUSH', 'HL');
                            continue;
                        }
                    }

                    // Constant multiplication
                    if (inst.op === IrOp.Mul && s2Inst.op === IrOp.LoadConst && s2Inst.src1.kind === IrOperandKind.Immediate) {
                        var cv = s2Inst.src1.immediateValue & 0xFFFF;
                        var handled = false;
                        if (cv === 0) { _e.instruction('LD', 'HL,$0000'); handled = true; }
                        else if (cv === 1) { emitInstruction(s1Inst); handled = true; }
                        else { handled = emitConstMul(cv, function() { emitInstruction(s1Inst); }); }
                        if (handled) {
                            if (inst.dest.kind === IrOperandKind.Temp && needsPushAfter(insts, i, inst.dest.tempIndex))
                                _e.instruction('PUSH', 'HL');
                            continue;
                        }
                    }

                    // Constant MOD power-of-2 -> AND
                    if (inst.op === IrOp.Mod && s2Inst.op === IrOp.LoadConst && s2Inst.src1.kind === IrOperandKind.Immediate) {
                        var cv = s2Inst.src1.immediateValue & 0xFFFF;
                        if (cv > 0 && (cv & (cv - 1)) === 0) {
                            emitInstruction(s1Inst);
                            _e.instruction('LD', 'DE,$' + hex4(cv - 1));
                            callRuntime('ANDHLDE');
                            if (inst.dest.kind === IrOperandKind.Temp && needsPushAfter(insts, i, inst.dest.tempIndex))
                                _e.instruction('PUSH', 'HL');
                            continue;
                        }
                    }

                    // Normal direct load path
                    emitInstruction(s1Inst);
                    // Same operand short form
                    if (s1Inst.op === s2Inst.op && s1Inst.dataSize === 2
                        && (s1Inst.op === IrOp.LoadVar || s1Inst.op === IrOp.LoadConst || s1Inst.op === IrOp.LoadLocal)
                        && s1Inst.src1.kind === s2Inst.src1.kind
                        && ((s1Inst.src1.kind === IrOperandKind.Label && s1Inst.src1.name === s2Inst.src1.name)
                            || (s1Inst.src1.kind === IrOperandKind.Immediate && s1Inst.src1.immediateValue === s2Inst.src1.immediateValue))) {
                        _e.instruction('LD', 'D,H'); _e.instruction('LD', 'E,L');
                    } else {
                        emitLoadToDE(s2Inst);
                    }
                    emitBinaryDirect(inst);
                    if (inst.dest.kind === IrOperandKind.Temp && needsPushAfter(insts, i, inst.dest.tempIndex))
                        _e.instruction('PUSH', 'HL');
                    continue;
                }

                // halfDirectOps: src2 only simple load
                if (halfDirectOps[i] && inst.dataSize !== 3) {
                    var s2Inst = insts[tempDef[inst.src2.tempIndex]];
                    if (fusedCompareJumps[i] != null) {
                        var jumpInst = insts[fusedCompareJumps[i]];
                        emitLoadToDE(s2Inst);
                        emitFusedCompareJump(inst, jumpInst.dest.name, jumpInst.op === IrOp.JumpIfNonZero);
                        continue;
                    }
                    // Constant add/sub optimization
                    if ((inst.op === IrOp.Add || inst.op === IrOp.Sub)
                        && s2Inst.op === IrOp.LoadConst && s2Inst.src1.kind === IrOperandKind.Immediate) {
                        var cv = s2Inst.src1.immediateValue & 0xFFFF;
                        var incOrDec = inst.op === IrOp.Add ? 'INC' : 'DEC';
                        if (cv <= 2) {
                            if (cv === 1) _e.instruction(incOrDec, 'HL');
                            else if (cv === 2) { _e.instruction(incOrDec, 'HL'); _e.instruction(incOrDec, 'HL'); }
                            if (inst.dest.kind === IrOperandKind.Temp && needsPushAfter(insts, i, inst.dest.tempIndex))
                                _e.instruction('PUSH', 'HL');
                            continue;
                        }
                    }
                    // Constant mul
                    if (inst.op === IrOp.Mul && s2Inst.op === IrOp.LoadConst && s2Inst.src1.kind === IrOperandKind.Immediate) {
                        var cv = s2Inst.src1.immediateValue & 0xFFFF;
                        var handled = false;
                        if (cv === 0) { _e.instruction('LD', 'HL,$0000'); handled = true; }
                        else if (cv === 1) handled = true;
                        else handled = emitConstMul(cv);
                        if (handled) {
                            if (inst.dest.kind === IrOperandKind.Temp && needsPushAfter(insts, i, inst.dest.tempIndex))
                                _e.instruction('PUSH', 'HL');
                            continue;
                        }
                    }
                    // Constant MOD power-of-2
                    if (inst.op === IrOp.Mod && s2Inst.op === IrOp.LoadConst && s2Inst.src1.kind === IrOperandKind.Immediate) {
                        var cv = s2Inst.src1.immediateValue & 0xFFFF;
                        if (cv > 0 && (cv & (cv - 1)) === 0) {
                            _e.instruction('LD', 'DE,$' + hex4(cv - 1));
                            callRuntime('ANDHLDE');
                            if (inst.dest.kind === IrOperandKind.Temp && needsPushAfter(insts, i, inst.dest.tempIndex))
                                _e.instruction('PUSH', 'HL');
                            continue;
                        }
                    }
                    emitLoadToDE(s2Inst);
                    emitBinaryDirect(inst);
                    if (inst.dest.kind === IrOperandKind.Temp && needsPushAfter(insts, i, inst.dest.tempIndex))
                        _e.instruction('PUSH', 'HL');
                    continue;
                }

                // reverseHalfDirectOps: src1 only simple load (commutative)
                if (reverseHalfDirectOps[i] && inst.dataSize !== 3) {
                    var s1Inst = insts[tempDef[inst.src1.tempIndex]];
                    if (fusedCompareJumps[i] != null) {
                        var jumpInst = insts[fusedCompareJumps[i]];
                        emitLoadToDE(s1Inst);
                        emitFusedCompareJump(inst, jumpInst.dest.name, jumpInst.op === IrOp.JumpIfNonZero);
                        continue;
                    }
                    if (inst.op === IrOp.Add && s1Inst.op === IrOp.LoadConst && s1Inst.src1.kind === IrOperandKind.Immediate) {
                        var cv = s1Inst.src1.immediateValue & 0xFFFF;
                        if (cv <= 2) {
                            if (cv === 1) _e.instruction('INC', 'HL');
                            else if (cv === 2) { _e.instruction('INC', 'HL'); _e.instruction('INC', 'HL'); }
                            if (inst.dest.kind === IrOperandKind.Temp && needsPushAfter(insts, i, inst.dest.tempIndex))
                                _e.instruction('PUSH', 'HL');
                            continue;
                        }
                    }
                    if (inst.op === IrOp.Mul && s1Inst.op === IrOp.LoadConst && s1Inst.src1.kind === IrOperandKind.Immediate) {
                        var cv = s1Inst.src1.immediateValue & 0xFFFF;
                        var handled = false;
                        if (cv === 0) { _e.instruction('LD', 'HL,$0000'); handled = true; }
                        else if (cv === 1) handled = true;
                        else handled = emitConstMul(cv);
                        if (handled) {
                            if (inst.dest.kind === IrOperandKind.Temp && needsPushAfter(insts, i, inst.dest.tempIndex))
                                _e.instruction('PUSH', 'HL');
                            continue;
                        }
                    }
                    emitLoadToDE(s1Inst);
                    emitBinaryDirect(inst);
                    if (inst.dest.kind === IrOperandKind.Temp && needsPushAfter(insts, i, inst.dest.tempIndex))
                        _e.instruction('PUSH', 'HL');
                    continue;
                }

                // Non-direct fused compare jump
                if (fusedCompareJumps[i] != null) {
                    var jumpInst = insts[fusedCompareJumps[i]];
                    var jumpOnTrue = jumpInst.op === IrOp.JumpIfNonZero;
                    if (inst.dataSize === 3) emitPopToDE(inst.dataSize);
                    else { _e.instruction('POP', 'DE'); _e.instruction('EX', 'DE,HL'); }
                    emitFusedCompareJump(inst, jumpInst.dest.name, jumpOnTrue);
                    continue;
                }

                // IndirStore/MemStore direct value
                if (indirStoreDirectValue[i] != null) {
                    var isByte = inst.dataSize === 1;
                    emitLoadToDE(insts[indirStoreDirectValue[i]]);
                    if (isByte) _e.instruction('LD', '(HL),E');
                    else { _e.instruction('LD', '(HL),E'); _e.instruction('INC', 'HL'); _e.instruction('LD', '(HL),D'); }
                    continue;
                }

                // MACHINE direct register load
                if (machineDirectArgs[i]) {
                    var argDefIdxs = machineDirectArgs[i];
                    var argCount = inst.src2.immediateValue | 0;
                    emitLoadToHL(insts[argDefIdxs[0]]);
                    if (argCount >= 2) emitLoadToDE(insts[argDefIdxs[1]]);
                    if (argCount >= 3) emitLoadToBC(insts[argDefIdxs[2]]);
                    var funcName = inst.src1.name || String(inst.src1);
                    _calledFunctions[funcName] = true;
                    var isRtOrExpr = (_rm && _rm.hasFunction(funcName)) || funcName.indexOf('+') >= 0 || funcName.indexOf('-') >= 0;
                    _e.instruction('CALL', isRtOrExpr ? qualifyAsmExpr(funcName) : funcName);
                    if (inst.dest.kind === IrOperandKind.Temp && needsPushAfter(insts, i, inst.dest.tempIndex))
                        emitPushValue(inst.dataSize);
                    continue;
                }

                // StoreLocal direct const
                if (storeLocalDirectConst[i] != null) {
                    var off = inst.dest.immediateValue | 0;
                    var val = insts[storeLocalDirectConst[i]].src1.immediateValue & 0xFFFF;
                    if (inst.dataSize === 1) {
                        _e.instruction('LD', '(IY+$' + hex2(off) + '),$' + hex2(val));
                    } else {
                        _e.instruction('LD', '(IY+$' + hex2(off) + '),$' + hex2(val & 0xFF));
                        _e.instruction('LD', '(IY+$' + hex2(off + 1) + '),$' + hex2((val >> 8) & 0xFF));
                    }
                    continue;
                }

                emitInstruction(inst);

                if (inst.dest.kind === IrOperandKind.Temp && !skipEmit[i]) {
                    if (needsPushAfter(insts, i, inst.dest.tempIndex))
                        emitPushValue(inst.dataSize);
                }
            }
            _currentFunction = null;
        }

        // ==== Generate helpers ====
        function emitStringData(text) {
            var allAscii = true;
            for (var i = 0; i < text.length; i++) {
                var c = text.charCodeAt(i);
                if (c < 0x20 || c >= 0x7F || c === 0x22) { allAscii = false; break; }
            }
            if (allAscii) _e.raw('\tDB\t"' + text + '",0');
            else _e.raw('\tDB\t' + toAsmDbArgs(text) + ',0');
        }

        function emitInitialItems(items) {
            var byteRun = [];
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                if (item.byteValue != null) {
                    byteRun.push(item.byteValue);
                } else {
                    if (byteRun.length > 0) {
                        _e.raw('\tDB\t' + byteRun.map(function(b) { return '$' + hex2(b); }).join(','));
                        byteRun = [];
                    }
                    _e.raw('\tDW\t' + qualifyAsmExpr(item.asmExpr));
                }
            }
            if (byteRun.length > 0)
                _e.raw('\tDB\t' + byteRun.map(function(b) { return '$' + hex2(b); }).join(','));
        }

        function emitGlobalInit() {
            var pendingConstVal = null;
            var gd = _module.globalData;
            for (var i = 0; i < gd.length; i++) {
                var inst = gd[i];
                if (inst.op === IrOp.LoadConst && inst.src1.kind === IrOperandKind.Immediate) {
                    pendingConstVal = inst.src1.immediateValue & 0xFFFF;
                } else if (inst.op === IrOp.StoreVar && pendingConstVal !== null) {
                    _e.instruction('LD', 'HL,$' + hex4(pendingConstVal));
                    _e.instruction('LD', '(' + asmLabel(inst.dest.name) + '),HL');
                    pendingConstVal = null;
                } else {
                    pendingConstVal = null;
                }
            }
        }

        function emitGlobalPlainAsm() {
            var gd = _module.globalData;
            for (var i = 0; i < gd.length; i++) {
                if (gd[i].op === IrOp.InlineAsm && gd[i].dest.kind === IrOperandKind.AsmString) {
                    var lines = gd[i].dest.name.split('\n');
                    for (var j = 0; j < lines.length; j++) {
                        if (lines[j].trim()) _e.raw(lines[j]);
                    }
                }
            }
        }

        function emitRuntimeCode(code, currentNamespace) {
            var lines = code.split('\n');
            for (var i = 0; i < lines.length; i++) {
                if (lines[i].trim()) {
                    var outLine = lines[i];
                    if (currentNamespace)
                        outLine = outLine.replace(/!\s*(\w+)/g, 'NAME_SPACE_DEFAULT.$1');
                    else
                        outLine = outLine.replace(/!\s*(\w+)/g, '$1');
                    _e.raw(outLine);
                }
            }
        }

        function hasInitDataArrays() {
            return _module.globalVars.some(function(v) {
                return v.storageKind === VarStorageKind.InitArray && v.fixedAddress == null && v.fixedAddressLabel == null;
            });
        }

        function hasRuntimeInitializers() {
            if (!_rm) return false;
            return _rm.getUsedFunctions().some(function(f) { return f.initCode && f.initCode.trim(); });
        }

        function buildCallInitializerCode() {
            var sb = '';
            if (isCodeReadonly && hasInitDataArrays()) {
                sb += ' LD HL,__INIT_TEMPLATE\n';
                sb += ' LD DE,__WORK__\n';
                sb += ' LD BC,__INIT_TEMPLATE_END-__INIT_TEMPLATE\n';
                sb += ' LDIR\n';
            }
            sb += ' CALL RUNTIME_INIT\n';
            return sb;
        }

        function emitRuntimeInit() {
            _e.blank();
            _e.label('RUNTIME_INIT');
            if (_rm) {
                var uf = _rm.getUsedFunctions();
                for (var i = 0; i < uf.length; i++) {
                    if (uf[i].initCode && uf[i].initCode.trim())
                        _e.instruction('CALL', uf[i].name + '_INITIALIZE');
                }
            }
            _e.instruction('RET');
            if (_rm) {
                var uf = _rm.getUsedFunctions();
                for (var i = 0; i < uf.length; i++) {
                    if (uf[i].initCode && uf[i].initCode.trim()) {
                        _e.blank();
                        _e.label(uf[i].name + '_INITIALIZE');
                        var lines = uf[i].initCode.split('\n');
                        for (var j = 0; j < lines.length; j++) {
                            if (lines[j].trim()) _e.raw(lines[j]);
                        }
                    }
                }
            }
        }

        function emitWorkArea() {
            _e.blank();
            _e.comment('; Variables (works)');
            if (_module.workAddress != null) {
                _e.instruction('ORG', '$' + hex4(_module.workAddress));
                _e.blank();
            }
            _e.label('__WORK__');
            var workOffset = 0;

            // ROM: InitArray at __WORK__ start
            if (isCodeReadonly) {
                var gv = _module.globalVars;
                for (var i = 0; i < gv.length; i++) {
                    var v = gv[i];
                    if (v.storageKind === VarStorageKind.InitArray && v.fixedAddress == null && v.fixedAddressLabel == null) {
                        _e.raw(v.asmLabel + ' EQU (__WORK__ + ' + workOffset + ')');
                        workOffset += v.byteSize;
                    }
                }
            }

            // Bss variables
            var gv = _module.globalVars;
            for (var i = 0; i < gv.length; i++) {
                var v = gv[i];
                if (v.fixedAddress == null && v.fixedAddressLabel == null && v.storageKind === VarStorageKind.Bss) {
                    _e.raw(v.asmLabel + ' EQU (__WORK__ + ' + workOffset + ')');
                    workOffset += v.byteSize;
                }
            }

            // System register works
            var afOffset = 0;
            for (var i = 0; i < SystemRegisterWorks.length; i++) {
                var sw = SystemRegisterWorks[i];
                if (sw.label === '_AF') afOffset = workOffset;
                _e.raw(sw.label + ' EQU (__WORK__ + ' + workOffset + ')');
                workOffset += sw.size;
            }
            _e.raw('_A EQU (_AF + 1)');

            // Runtime works variables
            if (_rm) {
                var currentNs = null;
                var wvars = _rm.getUsedWorkVariablesWithLib();
                for (var i = 0; i < wvars.length; i++) {
                    var w = wvars[i];
                    if (w.libName !== currentNs) {
                        if (w.libName) _e.raw('[' + w.libName + ']');
                        else if (currentNs) _e.raw('[NAME_SPACE_DEFAULT]');
                        currentNs = w.libName;
                    }
                    var workRef = currentNs ? 'NAME_SPACE_DEFAULT.__WORK__' : '__WORK__';
                    _e.raw(w.label + ' EQU (' + workRef + ' + ' + workOffset + ')');
                    workOffset += w.size;
                }
                if (currentNs) _e.raw('[NAME_SPACE_DEFAULT]');
            }

            _e.raw('__IYWORK EQU (__WORK__ + ' + workOffset + ')');
            _e.raw('WORKEND EQU (__WORK__ + ' + (workOffset + 256) + ')');
            _e.blank();
            _e.raw('__WORKEND__ EQU (__WORK__ + ' + (workOffset + 256) + ')');
        }

        // ==== Main Generate method ====
        function generate() {
            // Phase 1: Generate function bodies (collecting _calledFunctions)
            var funcEmitter = Z80Emitter();
            var savedEmitter = _e;
            _e = funcEmitter;
            for (var i = 0; i < _module.functions.length; i++) {
                emitFunction(_module.functions[i]);
                _e.blank();
            }
            _e = savedEmitter;

            // Phase 2: Mark runtime usage
            if (_rm) {
                var userFuncs = {};
                for (var i = 0; i < _module.functions.length; i++) userFuncs[_module.functions[i].name.toLowerCase()] = true;
                for (var name in _calledFunctions) {
                    if (_calledFunctions[name] && !userFuncs[name.toLowerCase()]) _rm.markUsed(name);
                }
                var adeps = _module.addressSymbolDeps;
                for (var dep in adeps) {
                    if (adeps[dep] && _rm.hasFunction(dep)) _rm.markUsed(dep);
                }
            }

            // Phase 3: ORG
            var effectiveOrg = _module.orgAddress != null ? _module.orgAddress : (_env.defaultOrg || null);
            if (effectiveOrg != null) {
                _e.instruction('ORG', '$' + hex4(effectiveOrg));
            }

            // Phase 4: Entry point
            if (_rm && _rm.hasFunction('SLANGINIT')) {
                var code = _rm.getAndExclude('SLANGINIT');
                if (code) {
                    var callinitReplacement = buildCallInitializerCode();
                    code = code.replace('<<CALLINITIALIZER>>', callinitReplacement);
                    var codeLines = code.split('\n');
                    for (var i = 0; i < codeLines.length; i++) {
                        var tokens = codeLines[i].trim().split(/[\s\t]+/);
                        if (tokens.length >= 2 && tokens[0].toUpperCase() === 'CALL' && tokens[1].toUpperCase() === 'MAIN')
                            emitGlobalInit();
                        if (codeLines[i].trim()) _e.raw(codeLines[i]);
                    }
                }
            } else {
                _e.comment('=== Entry Point ===');
                _e.instruction('XOR', 'A');
                _e.instruction('LD', 'HL,__WORK__');
                _e.instruction('LD', 'DE,__WORK__+1');
                _e.instruction('LD', 'BC,__WORKEND__-__WORK__-1');
                _e.instruction('LD', '(HL),A');
                _e.instruction('LDIR');
                if (isCodeReadonly && hasInitDataArrays()) {
                    _e.instruction('LD', 'HL,__INIT_TEMPLATE');
                    _e.instruction('LD', 'DE,__WORK__');
                    _e.instruction('LD', 'BC,__INIT_TEMPLATE_END-__INIT_TEMPLATE');
                    _e.instruction('LDIR');
                }
                if (hasRuntimeInitializers()) _e.instruction('CALL', 'RUNTIME_INIT');
                _e.instruction('LD', 'IY,__IYWORK');
                emitGlobalInit();
                _e.instruction('CALL', 'MAIN');
                _e.instruction('RET');
            }
            _e.blank();

            // Phase 5: Optimized function bodies
            funcEmitter.optimizeWith(PeepholeOptimizer());
            _e.appendFrom(funcEmitter);

            // Phase 5.5: Top-level inline ASM
            emitGlobalPlainAsm();

            // Phase 6: String table
            var stKeys = Object.keys(_module.stringTable);
            if (stKeys.length > 0) {
                _e.blank();
                _e.comment('=== String Table ===');
                for (var i = 0; i < stKeys.length; i++) {
                    _e.label(stKeys[i]);
                    emitStringData(_module.stringTable[stKeys[i]]);
                }
            }

            // Phase 7: Global variables with initializers
            var gv = _module.globalVars;
            // Fixed-address: EQU
            for (var i = 0; i < gv.length; i++) {
                var v = gv[i];
                if (v.fixedAddress != null)
                    _e.raw(v.asmLabel + '\tEQU\t$' + hex4(v.fixedAddress));
                else if (v.fixedAddressLabel != null)
                    _e.raw(v.asmLabel + '\tEQU\t' + v.fixedAddressLabel);
                else continue;
                if (isCodeReadonly && v.hasInitializer && _diag)
                    _diag.error("Fixed-address array '" + v.name + "' with initializer is not supported in code_readonly environment");
            }

            // CodeConst
            for (var i = 0; i < gv.length; i++) {
                if (gv[i].storageKind === VarStorageKind.CodeConst) {
                    _e.label(gv[i].asmLabel);
                    emitInitialItems(gv[i].initialItems);
                }
            }

            // InitArray: RAM/ROM split
            var initArrays = gv.filter(function(v) {
                return v.storageKind === VarStorageKind.InitArray && v.fixedAddress == null && v.fixedAddressLabel == null;
            });
            if (isCodeReadonly) {
                if (initArrays.length > 0) {
                    _e.label('__INIT_TEMPLATE');
                    for (var i = 0; i < initArrays.length; i++) {
                        _e.comment(initArrays[i].asmLabel);
                        emitInitialItems(initArrays[i].initialItems);
                    }
                    _e.label('__INIT_TEMPLATE_END');
                }
            } else {
                for (var i = 0; i < initArrays.length; i++) {
                    _e.label(initArrays[i].asmLabel);
                    emitInitialItems(initArrays[i].initialItems);
                }
            }

            // Phase 8: Runtime functions + RUNTIME_INIT
            if (_rm) {
                emitRuntimeInit();
                var outputFuncs = _rm.getOutputFunctions();
                if (outputFuncs.length > 0) {
                    _e.blank();
                    _e.comment('=== Runtime Functions ===');
                    var currentNamespace = null;
                    for (var i = 0; i < outputFuncs.length; i++) {
                        var func = outputFuncs[i];
                        var ns = func.libName;
                        if (ns !== currentNamespace) {
                            if (ns) _e.raw('[' + ns + ']');
                            else if (currentNamespace) _e.raw('[NAME_SPACE_DEFAULT]');
                            currentNamespace = ns;
                        }
                        _e.label(func.name);
                        emitRuntimeCode(func.code, currentNamespace);
                        _e.blank();
                    }
                    if (currentNamespace) _e.raw('[NAME_SPACE_DEFAULT]');
                }
            }

            _e.label('SLANG_PROG_END');

            // Phase 9: Work area layout
            emitWorkArea();

            return _e.toAssembly();
        }

        return {
            generate: generate,
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
        _Parser: Parser,
        _SymbolTable: SymbolTable,
        _ConstEvaluator: ConstEvaluator,
        _SemanticAnalyzer: SemanticAnalyzer,
        _SlangType: SlangType,
        _IrOp: IrOp,
        _IrOperand: IrOperand,
        _IrFunction: IrFunction,
        _IrModule: IrModule,
        _IrGenerator: IrGenerator,
        _AST: AST,
        _DataSize: DataSize,
        _BinaryOp: BinaryOp,
        _UnaryOp: UnaryOp,
        _Z80Emitter: Z80Emitter,
        _PeepholeOptimizer: PeepholeOptimizer,
        _CodeGenerator: CodeGenerator,
        _RuntimeManager: RuntimeManager,
        _RuntimeParser: RuntimeParser,

        // Main compile entry point
        compile: function(source, virtualFS, env) {
            var diagnostics = DiagnosticBag();
            try {
                var tokens = Lexer(source).tokenize();

                // #INCLUDE 展開: PreprocInclude トークンをファイル内容のトークンに置換
                if (virtualFS) {
                    var expanded = [];
                    for (var ti = 0; ti < tokens.length; ti++) {
                        if (tokens[ti].kind === TK.PreprocInclude) {
                            var incPath = tokens[ti].value || tokens[ti].text;
                            // virtualFS からファイル内容を取得（大文字小文字非依存）
                            var incContent = null;
                            var incPathUpper = incPath.toUpperCase();
                            for (var vk in virtualFS) {
                                if (vk.toUpperCase() === incPathUpper || vk.toUpperCase().replace(/.*[\/\\]/, '') === incPathUpper) {
                                    incContent = typeof virtualFS[vk] === 'string' ? virtualFS[vk] : null;
                                    break;
                                }
                            }
                            if (incContent) {
                                var incTokens = Lexer(incContent, incPath).tokenize();
                                // EOF トークンを除いて展開
                                for (var iti = 0; iti < incTokens.length; iti++) {
                                    if (incTokens[iti].kind !== TK.EOF) expanded.push(incTokens[iti]);
                                }
                            } else {
                                diagnostics.warning('#INCLUDE file not found: ' + incPath);
                            }
                        } else {
                            expanded.push(tokens[ti]);
                        }
                    }
                    tokens = expanded;
                }

                var envConfig = env || {};
                var preprocDefs = envConfig.defines || {};
                var parser = Parser(tokens, diagnostics, preprocDefs);
                var ast = parser.parseCompilationUnit();
                if (diagnostics.hasErrors) return { asm: '', errors: diagnostics.diagnostics };

                var analyzer = SemanticAnalyzer(diagnostics);
                analyzer.analyze(ast);
                if (diagnostics.hasErrors) return { asm: '', errors: diagnostics.diagnostics };

                var irGen = IrGenerator(diagnostics, analyzer.symbols);
                var irModule = irGen.generate(ast);
                if (diagnostics.hasErrors) return { asm: '', errors: diagnostics.diagnostics };

                // Load runtime from virtualFS if available
                var rm = null;
                if (virtualFS) {
                    rm = RuntimeManager();
                    var fsKeys = typeof virtualFS.keys === 'function' ? Array.from(virtualFS.keys()) : Object.keys(virtualFS);
                    for (var i = 0; i < fsKeys.length; i++) {
                        var fname = fsKeys[i];
                        if (fname.match(/\.asm$/i)) {
                            var content = typeof virtualFS.get === 'function' ? virtualFS.get(fname) : virtualFS[fname];
                            if (content) rm.loadFromString(content, fname);
                        }
                    }
                }

                var codeGen = CodeGenerator(irModule, rm, envConfig, diagnostics);
                var asm = codeGen.generate();
                return { asm: asm, errors: diagnostics.hasErrors ? diagnostics.diagnostics : [], warnings: [] };
            } catch (e) {
                return { asm: '', errors: [{ message: 'Internal compiler error: ' + e.message }] };
            }
        },
    };
})();

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

    function Parser(tokens, diagnostics) {
        var _tokens = tokens;
        var _diag = diagnostics;
        var _pos = 0;
        var _argListDepth = 0;

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
        function parsePreprocIf() {
            var t = advance();
            var expr = t.stringValue;
            if (expr.toUpperCase() === 'FALSE' || expr === '0') { skipPreprocBlock(); return null; }
            return null;
        }
        function skipPreprocBlock() {
            var depth = 1;
            while (!check(TK.EOF) && depth > 0) {
                if (check(TK.PreprocIf)) { depth++; advance(); continue; }
                if (check(TK.PreprocEnd)) { depth--; advance(); continue; }
                if (check(TK.PreprocElse) && depth === 1) { advance(); return; }
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
                    while (match(TK.Comma)) {
                        match(TK.Colon);
                        if (!check(TK.IntegerLiteral) && !check(TK.Identifier)) {
                            branches.push(AST.CaseBranch(val, rangeEnd, parseStmt()));
                            val = null; break;
                        }
                        branches.push(AST.CaseBranch(val, null, AST.Block([], s)));
                        val = parseNcExpr();
                    }
                    if (val !== null) {
                        if (match(TK.To)) rangeEnd = parseNcExpr();
                        match(TK.Colon);
                        branches.push(AST.CaseBranch(val, rangeEnd, parseStmt()));
                    }
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
            if (k === TK.PreprocElse || k === TK.PreprocEnd || k === TK.PreprocInclude) { advance(); return null; }
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
        _AST: AST,
        _DataSize: DataSize,
        _BinaryOp: BinaryOp,
        _UnaryOp: UnaryOp,

        // Main compile entry point (stub — will be implemented in later phases)
        compile: function(source, virtualFS, env) {
            return { asm: '', errors: [{ message: 'SLANG compiler not yet implemented' }] };
        },
    };
})();

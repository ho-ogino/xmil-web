// x1pen_z80asm.js — Z80 Assembler for X1Pen
// 2-pass assembler: Pass 1 collects labels, Pass 2 emits bytes

(function() {
    'use strict';

    // ================================================================
    // Register encoding tables
    // ================================================================

    var R8 = { B:0, C:1, D:2, E:3, H:4, L:5, '(HL)':6, A:7 };
    var QQ = { BC:0, DE:1, HL:2, SP:3 };
    var PP = { BC:0, DE:1, HL:2, AF:3 };
    var CC = { NZ:0, Z:1, NC:2, C:3, PO:4, PE:5, P:6, M:7 };
    var RST_VALS = [0x00, 0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38];

    // ================================================================
    // Expression parser
    // ================================================================

    function parseNumber(s) {
        s = s.trim();
        if (s === '') return null;
        // Character literal 'X' (ASCII only)
        if (s.length === 3 && s[0] === "'" && s[2] === "'") {
            var cv = s.charCodeAt(1);
            if (cv > 0x7F) return null; // non-ASCII
            return cv;
        }
        // 0x prefix
        if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s, 16);
        // $ prefix hex
        if (/^\$[0-9a-f]+$/i.test(s)) return parseInt(s.slice(1), 16);
        // Nh suffix hex (digits and A-F followed by H)
        if (/^[0-9a-f][0-9a-f]*h$/i.test(s)) return parseInt(s.slice(0, -1), 16);
        // %prefix binary
        if (/^%[01]+$/.test(s)) return parseInt(s.slice(1), 2);
        // Nb suffix binary
        if (/^[01]+b$/i.test(s)) return parseInt(s.slice(0, -1), 2);
        // Decimal
        if (/^[0-9]+$/.test(s)) return parseInt(s, 10);
        return null;
    }

    // Tokenize expression string into tokens: NUMBER, SYMBOL, OP, LPAREN, RPAREN
    function tokenizeExpr(s) {
        var tokens = [];
        var i = 0;
        while (i < s.length) {
            var c = s[i];
            if (c === ' ' || c === '\t') { i++; continue; }
            // 2文字比較演算子を先にチェック
            if (i + 1 < s.length) {
                var c2 = s[i] + s[i + 1];
                if (c2 === '==' || c2 === '!=' || c2 === '>=' || c2 === '<=') {
                    tokens.push({ type: 'OP', val: c2 }); i += 2; continue;
                }
            }
            if (c === '>' || c === '<') { tokens.push({ type: 'OP', val: c }); i++; continue; }
            if (c === '+') { tokens.push({ type: 'OP', val: '+' }); i++; continue; }
            if (c === '-') { tokens.push({ type: 'OP', val: '-' }); i++; continue; }
            if (c === '*') { tokens.push({ type: 'OP', val: '*' }); i++; continue; }
            if (c === '/') { tokens.push({ type: 'OP', val: '/' }); i++; continue; }
            if (c === '(') { tokens.push({ type: 'LPAREN' }); i++; continue; }
            if (c === ')') { tokens.push({ type: 'RPAREN' }); i++; continue; }
            if (c === '$' && (i + 1 >= s.length || !/[0-9a-f]/i.test(s[i + 1]))) {
                tokens.push({ type: 'DOLLAR' }); i++; continue;
            }
            // Number or symbol
            var start = i;
            if (c === "'" && i + 2 < s.length && s[i + 2] === "'") {
                var cv = s.charCodeAt(i + 1);
                if (cv > 0x7F) return null; // non-ASCII
                tokens.push({ type: 'NUMBER', val: cv });
                i += 3; continue;
            }
            if (c === '$' || /[0-9]/.test(c)) {
                // Try to parse as number
                while (i < s.length && /[0-9a-fA-FxXhHbB%$]/.test(s[i])) i++;
                var ns = s.substring(start, i);
                var nv = parseNumber(ns);
                if (nv !== null) { tokens.push({ type: 'NUMBER', val: nv }); continue; }
                // fallback to symbol
                i = start;
            }
            if (c === '%' && i + 1 < s.length && /[01]/.test(s[i + 1])) {
                // %binary prefix
                while (i < s.length && /[0-9a-fA-FxXhHbB%$]/.test(s[i])) i++;
                var bs = s.substring(start, i);
                var bv = parseNumber(bs);
                if (bv !== null) { tokens.push({ type: 'NUMBER', val: bv }); continue; }
                i = start + 1; // skip %
            }
            if (/[a-zA-Z_.]/.test(c)) {
                while (i < s.length && /[a-zA-Z0-9_.]/.test(s[i])) i++;
                var sym = s.substring(start, i);
                // A-F で始まり H で終わる場合、hex number の可能性を再チェック
                var hexVal = parseNumber(sym);
                if (hexVal !== null) {
                    tokens.push({ type: 'NUMBER', val: hexVal });
                } else {
                    tokens.push({ type: 'SYMBOL', val: sym });
                }
                continue;
            }
            // Unknown character
            return null;
        }
        return tokens;
    }

    function evalExpr(exprStr, symbols, pc, globalLabel, currentNamespace) {
        var tokens = tokenizeExpr(exprStr);
        if (!tokens) return null;

        var pos = 0;
        function peek() { return pos < tokens.length ? tokens[pos] : null; }
        function next() { return tokens[pos++]; }

        function parseAtom() {
            var t = peek();
            if (!t) return null;
            if (t.type === 'NUMBER') { next(); return t.val; }
            if (t.type === 'DOLLAR') { next(); return pc; }
            if (t.type === 'SYMBOL') {
                next();
                var key = t.val;
                // LOW/HIGH unary operators (case-insensitive)
                var keyUpper = key.toUpperCase();
                if (keyUpper === 'LOW') { var lv = parseAtom(); return (lv !== null && lv !== undefined) ? lv & 0xFF : lv; }
                if (keyUpper === 'HIGH') { var hv = parseAtom(); return (hv !== null && hv !== undefined) ? (hv >> 8) & 0xFF : hv; }
                // Resolve local labels: .foo → LASTGLOBAL.FOO
                if (key[0] === '.' && globalLabel) {
                    key = globalLabel + key;
                }
                // 1. そのまま検索 (NS.LABEL 明示参照 or bare predefined symbol)
                if (key in symbols) return symbols[key];
                // 2. currentNS.KEY (ドット付き参照でも名前空間プレフィックスを試す)
                if (currentNamespace) {
                    var nsKey = currentNamespace + '.' + key;
                    if (nsKey in symbols) return symbols[nsKey];
                }
                // 3-5. dotless → 追加の名前空間解決
                if (currentNamespace && key.indexOf('.') < 0) {
                    // 2. currentNS.KEY
                    var nsKey = currentNamespace + '.' + key;
                    if (nsKey in symbols) return symbols[nsKey];
                    // 3. NAME_SPACE_DEFAULT.KEY
                    if (currentNamespace !== 'NAME_SPACE_DEFAULT') {
                        var defKey = 'NAME_SPACE_DEFAULT.' + key;
                        if (defKey in symbols) return symbols[defKey];
                    }
                    // 4. 任意の名前空間で *.KEY を検索（ランタイムライブラリ互換）
                    var suffix = '.' + key;
                    for (var sk in symbols) {
                        if (sk.length > suffix.length && sk.substring(sk.length - suffix.length) === suffix) {
                            return symbols[sk];
                        }
                    }
                }
                return undefined; // unresolved
            }
            if (t.type === 'LPAREN') {
                next();
                var v = parseAddSub();
                if (peek() && peek().type === 'RPAREN') next();
                return v;
            }
            if (t.type === 'OP' && t.val === '+') {
                next();
                return parseAtom();  // unary plus: no-op
            }
            if (t.type === 'OP' && t.val === '-') {
                next();
                var v2 = parseAtom();
                if (v2 === null || v2 === undefined) return v2;
                return (-v2) & 0xFFFF;
            }
            return null;
        }

        function parseMulDiv() {
            var left = parseAtom();
            while (true) {
                var t = peek();
                if (!t || t.type !== 'OP' || (t.val !== '*' && t.val !== '/')) break;
                var op = next().val;
                var right = parseAtom();
                if (right === null || left === null) return null;
                if (left === undefined || right === undefined) return undefined;
                if (op === '*') left = (left * right) & 0xFFFF;
                else left = (right !== 0) ? (Math.floor(left / right)) & 0xFFFF : 0;
            }
            return left;
        }

        function parseAddSub() {
            var left = parseMulDiv();
            while (true) {
                var t = peek();
                if (!t || t.type !== 'OP' || (t.val !== '+' && t.val !== '-')) break;
                var op = next().val;
                var right = parseMulDiv();
                if (right === null || left === null) return null;
                if (left === undefined || right === undefined) return undefined;
                if (op === '+') left = (left + right) & 0xFFFF;
                else left = (left - right) & 0xFFFF;
            }
            return left;
        }

        function parseCompare() {
            var left = parseAddSub();
            while (true) {
                var t = peek();
                if (!t || t.type !== 'OP') break;
                var op = t.val;
                if (op !== '==' && op !== '!=' && op !== '>=' && op !== '<=' && op !== '>' && op !== '<') break;
                next();
                var right = parseAddSub();
                if (right === null || left === null) return null;
                if (left === undefined || right === undefined) return undefined;
                if (op === '==') left = (left === right) ? 1 : 0;
                else if (op === '!=') left = (left !== right) ? 1 : 0;
                else if (op === '>=') left = (left >= right) ? 1 : 0;
                else if (op === '<=') left = (left <= right) ? 1 : 0;
                else if (op === '>') left = (left > right) ? 1 : 0;
                else if (op === '<') left = (left < right) ? 1 : 0;
            }
            return left;
        }

        var result = parseCompare();
        if (pos < tokens.length) return null; // leftover tokens
        return result;
    }

    // ================================================================
    // Line parser
    // ================================================================

    // Known mnemonics/pseudo-instructions (for label-without-colon detection)
    var KNOWN_MNEMONICS = {};
    ('NOP HALT DI EI RLCA RRCA RLA RRA DAA CPL SCF CCF EXX RET ' +
     'LD PUSH POP EX ADD ADC SUB SBC AND OR XOR CP INC DEC ' +
     'JP JR DJNZ CALL RST IN OUT NEG ' +
     'RLC RRC RL RR SLA SRA SRL BIT RES SET ' +
     'RETI RETN IM RRD RLD LDI LDIR LDD LDDR CPI CPIR CPD CPDR ' +
     'INI INIR IND INDR OUTI OTIR OUTD OTDR ' +
     'ORG DB DW DS DEFB DEFW DEFS EQU ALIGN').split(' ').forEach(function(m) {
        KNOWN_MNEMONICS[m] = true;
    });

    function parseLine(line) {
        // Returns { label, mnemonic, operands, comment, raw }
        var result = { label: null, mnemonic: null, operands: '', comment: null, raw: line };

        // Strip comment
        var commentIdx = -1;
        var inString = false;
        for (var i = 0; i < line.length; i++) {
            if (line[i] === '"') inString = !inString;
            if (!inString && line[i] === ';') { commentIdx = i; break; }
        }
        var code = commentIdx >= 0 ? line.substring(0, commentIdx) : line;
        if (commentIdx >= 0) result.comment = line.substring(commentIdx);

        code = code.trimEnd();
        if (code.trim() === '') return result;

        // Namespace directive: [NAME]
        var nsMatch = code.trim().match(/^\[([a-zA-Z_][a-zA-Z0-9_]*)\]$/);
        if (nsMatch) {
            result.mnemonic = '_NAMESPACE';
            result.operands = nsMatch[1];
            return result;
        }

        // Check for label: at start of line (with colon)
        var m = code.match(/^(\.[a-zA-Z_][a-zA-Z0-9_]*|[a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
        if (m) {
            result.label = m[1];
            code = code.substring(m[0].length);
        }

        code = code.trim();
        if (code === '') return result;

        // Check for EQU (special: label without colon)
        var equMatch = code.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+EQU\s+(.+)$/i);
        if (equMatch && !result.label) {
            result.label = equMatch[1];
            result.mnemonic = 'EQU';
            result.operands = equMatch[2].trim();
            return result;
        }

        // Check for local label without colon (.foo)
        if (!result.label && code === code.trimStart()) {
            var localMatch = code.match(/^(\.[a-zA-Z_][a-zA-Z0-9_]*)([\s].*)?$/);
            if (localMatch) {
                result.label = localMatch[1];
                code = (localMatch[2] || '').trim();
                if (code === '') return result;
            }
        }

        // Check for label without colon at start of line (not indented, not a known mnemonic)
        if (!result.label && code === code.trimStart()) {
            var wordMatch = code.match(/^([a-zA-Z_][a-zA-Z0-9_]*)([\s].*)?$/);
            if (wordMatch && !(wordMatch[1].toUpperCase() in KNOWN_MNEMONICS)) {
                result.label = wordMatch[1];
                code = (wordMatch[2] || '').trim();
                if (code === '') return result;
            }
        }

        // Mnemonic + operands
        var parts = code.match(/^([a-zA-Z]+)\s*(.*)?$/);
        if (parts) {
            result.mnemonic = parts[1].toUpperCase();
            result.operands = (parts[2] || '').trim();
        }

        return result;
    }

    // Split operands by comma, respecting parentheses
    function splitOperands(s) {
        if (s === '') return [];
        var parts = [];
        var depth = 0;
        var current = '';
        var inString = false;
        for (var i = 0; i < s.length; i++) {
            var c = s[i];
            if (c === '"') inString = !inString;
            if (!inString) {
                if (c === '(') depth++;
                if (c === ')') depth--;
                if (c === ',' && depth === 0) {
                    parts.push(current.trim());
                    current = '';
                    continue;
                }
            }
            current += c;
        }
        parts.push(current.trim());
        return parts;
    }

    // ================================================================
    // Operand classification
    // ================================================================

    function classifyOperand(s, symbols, pc, pass, globalLabel, currentNamespace) {
        var su = s.toUpperCase().trim();

        // Single 8-bit register
        if (su in R8) return { type: 'r8', reg: R8[su], name: su };

        // Register pairs
        if (su in QQ) return { type: 'qq', reg: QQ[su], name: su };
        if (su === 'AF') return { type: 'pp', reg: PP.AF, name: 'AF' };
        if (su === "AF'") return { type: 'af_prime' };

        // I, R registers
        if (su === 'I') return { type: 'reg_i' };
        if (su === 'R') return { type: 'reg_r' };

        // IX, IY
        if (su === 'IX') return { type: 'ix' };
        if (su === 'IY') return { type: 'iy' };

        // (HL), (BC), (DE), (SP)
        if (su === '(HL)') return { type: 'r8', reg: 6, name: '(HL)' };
        if (su === '(BC)') return { type: 'ind_bc' };
        if (su === '(DE)') return { type: 'ind_de' };
        if (su === '(SP)') return { type: 'ind_sp' };

        // (IX+d), (IY+d)
        var ixm = su.match(/^\((IX|IY)\s*([+\-].*)\)$/i);
        if (ixm) {
            var val = evalExpr(ixm[2], symbols, pc, globalLabel, currentNamespace);
            return { type: 'ind_idx', idx: ixm[1].toUpperCase(), disp: val };
        }
        var ixm0 = su.match(/^\((IX|IY)\)$/i);
        if (ixm0) {
            return { type: 'ind_idx', idx: ixm0[1].toUpperCase(), disp: 0 };
        }

        // (C) - for IN/OUT
        if (su === '(C)') return { type: 'ind_c' };

        // (nn) - indirect memory
        var indm = su.match(/^\((.+)\)$/);
        if (indm) {
            var addr = evalExpr(indm[1], symbols, pc, globalLabel, currentNamespace);
            return { type: 'ind_nn', val: addr };
        }

        // Condition codes
        if (su in CC) return { type: 'cc', code: CC[su], name: su };

        // Immediate / expression
        var v = evalExpr(s, symbols, pc, globalLabel, currentNamespace);
        if (v !== null && v !== undefined) return { type: 'imm', val: v };

        // Unresolved (pass 1)
        if (pass === 1) return { type: 'imm', val: 0 }; // placeholder

        return { type: 'unknown', raw: s };
    }

    // ================================================================
    // Instruction encoders (family-based)
    // ================================================================

    // Helper: treat r8 'C' as condition code in JP/JR/CALL/RET context
    function asCC(op) {
        if (op.type === 'cc') return op;
        if (op.type === 'r8' && op.name === 'C') return { type: 'cc', code: CC.C, name: 'C' };
        return null;
    }

    function encodeBasic(mnemonic, ops, symbols, pc, pass) {
        // ops: array of classified operands
        var mn = mnemonic;
        var o = ops;
        var bytes = [];

        // --- No operand instructions ---
        var NOARG = {
            NOP: [0x00], HALT: [0x76], DI: [0xF3], EI: [0xFB],
            RLCA: [0x07], RRCA: [0x0F], RLA: [0x17], RRA: [0x1F],
            DAA: [0x27], CPL: [0x2F], SCF: [0x37], CCF: [0x3F],
            EXX: [0xD9],
            RET: [0xC9]
        };
        if (o.length === 0 && mn in NOARG) return NOARG[mn];

        // --- LD family ---
        if (mn === 'LD') return encodeLD(o, symbols, pc, pass);

        // --- PUSH / POP ---
        if (mn === 'PUSH' && o.length === 1) {
            if (o[0].type === 'pp') return [0xC5 + o[0].reg * 16];
            if (o[0].type === 'qq' && o[0].reg < 3) return [0xC5 + o[0].reg * 16];
            if (o[0].type === 'ix') return [0xDD, 0xE5];
            if (o[0].type === 'iy') return [0xFD, 0xE5];
        }
        if (mn === 'POP' && o.length === 1) {
            if (o[0].type === 'pp') return [0xC1 + o[0].reg * 16];
            if (o[0].type === 'qq' && o[0].reg < 3) return [0xC1 + o[0].reg * 16];
            if (o[0].type === 'ix') return [0xDD, 0xE1];
            if (o[0].type === 'iy') return [0xFD, 0xE1];
        }

        // --- EX ---
        if (mn === 'EX') {
            if (o.length === 2) {
                if (o[0].type === 'qq' && o[0].name === 'DE' && o[1].type === 'qq' && o[1].name === 'HL') return [0xEB];
                if (o[0].type === 'qq' && o[0].name === 'HL' && o[1].type === 'qq' && o[1].name === 'DE') return [0xEB]; // EX HL,DE alias
                if (o[0].type === 'pp' && o[0].name === 'AF' && o[1].type === 'af_prime') return [0x08];
                if (o[0].type === 'ind_sp' && o[1].type === 'qq' && o[1].name === 'HL') return [0xE3];
                if (o[0].type === 'ind_sp' && o[1].type === 'ix') return [0xDD, 0xE3];
                if (o[0].type === 'ind_sp' && o[1].type === 'iy') return [0xFD, 0xE3];
            }
        }

        // --- Arithmetic/Logic (A, operand) ---
        var ALU_A = { ADD: 0, ADC: 1, SUB: 2, SBC: 3, AND: 4, XOR: 5, OR: 6, CP: 7 };
        if (mn in ALU_A) {
            var aluBase = ALU_A[mn];
            if (o.length === 1) {
                // SUB r, AND r, etc. (implied A)
                if (o[0].type === 'r8') return [0x80 + aluBase * 8 + o[0].reg];
                if (o[0].type === 'ind_idx') return [o[0].idx === 'IX' ? 0xDD : 0xFD, 0x86 + aluBase * 8, o[0].disp & 0xFF];
                if (o[0].type === 'imm') return [0xC6 + aluBase * 8, o[0].val & 0xFF];
            }
            if (o.length === 2 && o[0].type === 'r8' && o[0].name === 'A') {
                if (o[1].type === 'r8') return [0x80 + aluBase * 8 + o[1].reg];
                if (o[1].type === 'ind_idx') return [o[1].idx === 'IX' ? 0xDD : 0xFD, 0x86 + aluBase * 8, o[1].disp & 0xFF];
                if (o[1].type === 'imm') return [0xC6 + aluBase * 8, o[1].val & 0xFF];
            }
            // ADD HL,ss / ADD IX,ss / ADD IY,ss
            if (mn === 'ADD' && o.length === 2) {
                if (o[0].type === 'qq' && o[0].name === 'HL' && o[1].type === 'qq')
                    return [0x09 + o[1].reg * 16];
                if (o[0].type === 'ix' && o[1].type === 'qq')
                    return [0xDD, 0x09 + o[1].reg * 16];
                if (o[0].type === 'iy' && o[1].type === 'qq')
                    return [0xFD, 0x09 + o[1].reg * 16];
            }
        }

        // --- INC / DEC ---
        if (mn === 'INC' || mn === 'DEC') {
            var idOff = mn === 'INC' ? 0 : 1;
            if (o.length === 1) {
                if (o[0].type === 'r8') return [0x04 + o[0].reg * 8 + idOff];
                if (o[0].type === 'qq') return [0x03 + o[0].reg * 16 + idOff * 8];
                if (o[0].type === 'ix') return [0xDD, 0x23 + idOff * 8];
                if (o[0].type === 'iy') return [0xFD, 0x23 + idOff * 8];
                if (o[0].type === 'ind_idx') return [o[0].idx === 'IX' ? 0xDD : 0xFD, 0x34 + idOff, o[0].disp & 0xFF];
            }
        }

        // --- JP ---
        if (mn === 'JP') {
            if (o.length === 1) {
                if (o[0].type === 'r8' && o[0].name === '(HL)') return [0xE9];
                if (o[0].type === 'ix') return [0xDD, 0xE9]; // JP (IX)
                if (o[0].type === 'iy') return [0xFD, 0xE9]; // JP (IY)
                if (o[0].type === 'ind_idx' && o[0].disp === 0) {
                    return [o[0].idx === 'IX' ? 0xDD : 0xFD, 0xE9];
                }
                if (o[0].type === 'imm') return [0xC3, o[0].val & 0xFF, (o[0].val >> 8) & 0xFF];
            }
            if (o.length === 2) {
                var jpcc = asCC(o[0]);
                if (jpcc && o[1].type === 'imm') return [0xC2 + jpcc.code * 8, o[1].val & 0xFF, (o[1].val >> 8) & 0xFF];
            }
        }

        // --- JR ---
        if (mn === 'JR') {
            if (o.length === 1 && o[0].type === 'imm') {
                var rel = (o[0].val - (pc + 2)) & 0xFF;
                if (pass === 2) {
                    var diff = o[0].val - (pc + 2);
                    if (diff < -128 || diff > 127) return null; // range error
                }
                return [0x18, rel];
            }
            if (o.length === 2) {
                var jrcc = asCC(o[0]) || o[0];
                if (jrcc.type === 'cc') {
                    var jrCCmap = { NZ: 0, Z: 1, NC: 2, C: 3 };
                    if (!(jrcc.name in jrCCmap)) return null;
                    var rel2 = (o[1].val - (pc + 2)) & 0xFF;
                    if (pass === 2) {
                        var diff2 = o[1].val - (pc + 2);
                        if (diff2 < -128 || diff2 > 127) return null;
                    }
                    return [0x20 + jrCCmap[jrcc.name] * 8, rel2];
                }
            }
        }

        // --- DJNZ ---
        if (mn === 'DJNZ' && o.length === 1 && o[0].type === 'imm') {
            var rel3 = (o[0].val - (pc + 2)) & 0xFF;
            if (pass === 2) {
                var diff3 = o[0].val - (pc + 2);
                if (diff3 < -128 || diff3 > 127) return null;
            }
            return [0x10, rel3];
        }

        // --- CALL ---
        if (mn === 'CALL') {
            if (o.length === 1 && o[0].type === 'imm')
                return [0xCD, o[0].val & 0xFF, (o[0].val >> 8) & 0xFF];
            if (o.length === 2) {
                var callcc = asCC(o[0]) || o[0];
                if (callcc.type === 'cc' && o[1].type === 'imm')
                    return [0xC4 + callcc.code * 8, o[1].val & 0xFF, (o[1].val >> 8) & 0xFF];
            }
        }

        // --- RET cc ---
        if (mn === 'RET' && o.length === 1) {
            var retcc = asCC(o[0]) || o[0];
            if (retcc.type === 'cc') return [0xC0 + retcc.code * 8];
        }

        // --- RST ---
        if (mn === 'RST' && o.length === 1 && o[0].type === 'imm') {
            var idx = RST_VALS.indexOf(o[0].val);
            if (idx >= 0) return [0xC7 + idx * 8];
        }

        // --- IN / OUT (basic) ---
        if (mn === 'IN' && o.length === 2 && o[0].type === 'r8' && o[0].name === 'A' && o[1].type === 'ind_nn')
            return [0xDB, o[1].val & 0xFF];
        if (mn === 'OUT' && o.length === 2 && o[0].type === 'ind_nn' && o[1].type === 'r8' && o[1].name === 'A')
            return [0xD3, o[0].val & 0xFF];

        // --- NEG (basic listing has it, but it's ED-family) ---
        if (mn === 'NEG' && o.length === 0) return [0xED, 0x44];

        return null; // not handled here
    }

    // LD instruction encoder
    function encodeLD(o, symbols, pc, pass) {
        if (o.length !== 2) return null;
        var dst = o[0], src = o[1];

        // LD r,r
        if (dst.type === 'r8' && src.type === 'r8')
            return [0x40 + dst.reg * 8 + src.reg];

        // LD r,n
        if (dst.type === 'r8' && src.type === 'imm')
            return [0x06 + dst.reg * 8, src.val & 0xFF];

        // LD r,(IX+d) / LD r,(IY+d)
        if (dst.type === 'r8' && dst.name !== '(HL)' && src.type === 'ind_idx')
            return [src.idx === 'IX' ? 0xDD : 0xFD, 0x46 + dst.reg * 8, src.disp & 0xFF];

        // LD (IX+d),r / LD (IY+d),r
        if (dst.type === 'ind_idx' && src.type === 'r8' && src.name !== '(HL)')
            return [dst.idx === 'IX' ? 0xDD : 0xFD, 0x70 + src.reg, dst.disp & 0xFF];

        // LD (IX+d),n / LD (IY+d),n
        if (dst.type === 'ind_idx' && src.type === 'imm')
            return [dst.idx === 'IX' ? 0xDD : 0xFD, 0x36, dst.disp & 0xFF, src.val & 0xFF];

        // LD dd,nn (16-bit load)
        if (dst.type === 'qq' && src.type === 'imm')
            return [0x01 + dst.reg * 16, src.val & 0xFF, (src.val >> 8) & 0xFF];
        if (dst.type === 'ix' && src.type === 'imm')
            return [0xDD, 0x21, src.val & 0xFF, (src.val >> 8) & 0xFF];
        if (dst.type === 'iy' && src.type === 'imm')
            return [0xFD, 0x21, src.val & 0xFF, (src.val >> 8) & 0xFF];

        // LD (nn),A / LD A,(nn)
        if (dst.type === 'ind_nn' && src.type === 'r8' && src.name === 'A')
            return [0x32, dst.val & 0xFF, (dst.val >> 8) & 0xFF];
        if (dst.type === 'r8' && dst.name === 'A' && src.type === 'ind_nn')
            return [0x3A, src.val & 0xFF, (src.val >> 8) & 0xFF];

        // LD (BC/DE),A / LD A,(BC/DE)
        if (dst.type === 'ind_bc' && src.type === 'r8' && src.name === 'A') return [0x02];
        if (dst.type === 'ind_de' && src.type === 'r8' && src.name === 'A') return [0x12];
        if (dst.type === 'r8' && dst.name === 'A' && src.type === 'ind_bc') return [0x0A];
        if (dst.type === 'r8' && dst.name === 'A' && src.type === 'ind_de') return [0x1A];

        // LD SP,HL / LD SP,IX / LD SP,IY
        if (dst.type === 'qq' && dst.name === 'SP') {
            if (src.type === 'qq' && src.name === 'HL') return [0xF9];
            if (src.type === 'ix') return [0xDD, 0xF9];
            if (src.type === 'iy') return [0xFD, 0xF9];
        }

        // LD (nn),HL / LD HL,(nn) — direct
        if (dst.type === 'ind_nn' && src.type === 'qq' && src.name === 'HL')
            return [0x22, dst.val & 0xFF, (dst.val >> 8) & 0xFF];
        if (dst.type === 'qq' && dst.name === 'HL' && src.type === 'ind_nn')
            return [0x2A, src.val & 0xFF, (src.val >> 8) & 0xFF];

        // LD (nn),dd / LD dd,(nn) — ED prefix
        if (dst.type === 'ind_nn' && src.type === 'qq')
            return [0xED, 0x43 + src.reg * 16, dst.val & 0xFF, (dst.val >> 8) & 0xFF];
        if (dst.type === 'qq' && src.type === 'ind_nn')
            return [0xED, 0x4B + dst.reg * 16, src.val & 0xFF, (src.val >> 8) & 0xFF];

        // LD (nn),IX/IY / LD IX/IY,(nn)
        if (dst.type === 'ind_nn' && src.type === 'ix')
            return [0xDD, 0x22, dst.val & 0xFF, (dst.val >> 8) & 0xFF];
        if (dst.type === 'ind_nn' && src.type === 'iy')
            return [0xFD, 0x22, dst.val & 0xFF, (dst.val >> 8) & 0xFF];
        if (dst.type === 'ix' && src.type === 'ind_nn')
            return [0xDD, 0x2A, src.val & 0xFF, (src.val >> 8) & 0xFF];
        if (dst.type === 'iy' && src.type === 'ind_nn')
            return [0xFD, 0x2A, src.val & 0xFF, (src.val >> 8) & 0xFF];

        // LD I,A / LD R,A / LD A,I / LD A,R
        if (dst.type === 'reg_i' && src.type === 'r8' && src.name === 'A') return [0xED, 0x47];
        if (dst.type === 'reg_r' && src.type === 'r8' && src.name === 'A') return [0xED, 0x4F];
        if (dst.type === 'r8' && dst.name === 'A' && src.type === 'reg_i') return [0xED, 0x57];
        if (dst.type === 'r8' && dst.name === 'A' && src.type === 'reg_r') return [0xED, 0x5F];

        return null;
    }

    // CB family encoder
    function encodeCB(mnemonic, ops, symbols, pc, pass) {
        var CB_OPS = { RLC:0x00, RRC:0x08, RL:0x10, RR:0x18, SLA:0x20, SRA:0x28, SRL:0x38 };
        var CB_BIT = { BIT:0x40, RES:0x80, SET:0xC0 };

        if (mnemonic in CB_OPS) {
            if (ops.length === 1) {
                if (ops[0].type === 'r8') return [0xCB, CB_OPS[mnemonic] + ops[0].reg];
                if (ops[0].type === 'ind_idx') {
                    return [ops[0].idx === 'IX' ? 0xDD : 0xFD, 0xCB, ops[0].disp & 0xFF, CB_OPS[mnemonic] + 6];
                }
            }
        }
        if (mnemonic in CB_BIT) {
            if (ops.length === 2 && ops[0].type === 'imm') {
                var bit = ops[0].val;
                if (bit < 0 || bit > 7) return null;
                if (ops[1].type === 'r8')
                    return [0xCB, CB_BIT[mnemonic] + bit * 8 + ops[1].reg];
                if (ops[1].type === 'ind_idx')
                    return [ops[1].idx === 'IX' ? 0xDD : 0xFD, 0xCB, ops[1].disp & 0xFF, CB_BIT[mnemonic] + bit * 8 + 6];
            }
        }
        return null;
    }

    // ED family encoder
    function encodeED(mnemonic, ops) {
        // No-operand ED instructions
        var ED_NOARG = {
            RETI: [0xED, 0x4D], RETN: [0xED, 0x45],
            RRD: [0xED, 0x67], RLD: [0xED, 0x6F],
            LDI: [0xED, 0xA0], LDIR: [0xED, 0xB0],
            LDD: [0xED, 0xA8], LDDR: [0xED, 0xB8],
            CPI: [0xED, 0xA1], CPIR: [0xED, 0xB1],
            CPD: [0xED, 0xA9], CPDR: [0xED, 0xB9],
            INI: [0xED, 0xA2], INIR: [0xED, 0xB2],
            IND: [0xED, 0xAA], INDR: [0xED, 0xBA],
            OUTI: [0xED, 0xA3], OTIR: [0xED, 0xB3],
            OUTD: [0xED, 0xAB], OTDR: [0xED, 0xBB]
        };
        if (ops.length === 0 && mnemonic in ED_NOARG) return ED_NOARG[mnemonic];

        // IM n
        if (mnemonic === 'IM' && ops.length === 1 && ops[0].type === 'imm') {
            var imMap = { 0: 0x46, 1: 0x56, 2: 0x5E };
            if (ops[0].val in imMap) return [0xED, imMap[ops[0].val]];
        }

        // IN r,(C) / OUT (C),r
        if (mnemonic === 'IN' && ops.length === 2 && ops[0].type === 'r8' && ops[1].type === 'ind_c')
            return [0xED, 0x40 + ops[0].reg * 8];
        if (mnemonic === 'OUT' && ops.length === 2 && ops[0].type === 'ind_c' && ops[1].type === 'r8')
            return [0xED, 0x41 + ops[1].reg * 8];

        // ADC HL,ss / SBC HL,ss
        if ((mnemonic === 'ADC' || mnemonic === 'SBC') && ops.length === 2 &&
            ops[0].type === 'qq' && ops[0].name === 'HL' && ops[1].type === 'qq') {
            var base = mnemonic === 'ADC' ? 0x4A : 0x42;
            return [0xED, base + ops[1].reg * 16];
        }

        return null;
    }

    // ================================================================
    // Main assembler
    // ================================================================

    function assemble(source, predefinedSymbols) {
        var lines = source.split('\n');
        var symbols = {};
        // predefined symbols (addrmap 由来) を初期値として注入
        // ユーザーの EQU/ラベル定義で後勝ちで上書き可能
        if (predefinedSymbols) {
            for (var k in predefinedSymbols) {
                symbols[k] = predefinedSymbols[k];
            }
        }
        var errors = [];

        // ── Preprocess: #IF / #ELSE / #ENDIF ──
        // 1回の走査で active 状態を見ながら EQU 収集と条件評価を同時処理
        var ppSymbols = {};
        if (predefinedSymbols) {
            for (var k in predefinedSymbols) ppSymbols[k] = predefinedSymbols[k];
        }
        var ifStack = [];
        function ppIsActive() {
            if (ifStack.length === 0) return true;
            var top = ifStack[ifStack.length - 1];
            return top.parentActive && (top.inElse ? !top.condTrue : top.condTrue);
        }
        for (var pi = 0; pi < lines.length; pi++) {
            var trimmed = lines[pi].trim();
            var directive = trimmed.match(/^#(IF|ELSE|ENDIF)\b\s*(.*)?$/i);
            if (directive) {
                var cmd = directive[1].toUpperCase();
                if (cmd === 'IF') {
                    var parentActive = ppIsActive();
                    var condActive = false;
                    if (parentActive) {
                        var exprStr = (directive[2] || '').replace(/;.*$/, '').trim();
                        var condVal = evalExpr(exprStr, ppSymbols, 0, '');
                        if (condVal === null) {
                            errors.push({ line: pi + 1, msg: 'Invalid #IF expression' });
                        } else if (condVal === undefined) {
                            condVal = 0;
                        }
                        condActive = (condVal !== 0);
                    }
                    ifStack.push({ parentActive: parentActive, condTrue: condActive, inElse: false });
                } else if (cmd === 'ELSE') {
                    if (ifStack.length === 0) {
                        errors.push({ line: pi + 1, msg: '#ELSE without #IF' });
                    } else {
                        var top = ifStack[ifStack.length - 1];
                        if (top.inElse) {
                            errors.push({ line: pi + 1, msg: 'Duplicate #ELSE' });
                        } else {
                            top.inElse = true;
                        }
                    }
                } else if (cmd === 'ENDIF') {
                    if (ifStack.length === 0) {
                        errors.push({ line: pi + 1, msg: '#ENDIF without #IF' });
                    } else {
                        ifStack.pop();
                    }
                }
                lines[pi] = '';
                continue;
            }
            var active = ppIsActive();
            if (!active) {
                lines[pi] = '';
                continue;
            }
            // active な行の EQU を ppSymbols に収集（後続の #IF で参照可能）
            // 注: 前処理段階の EQU は定数式のみ保証（$ やローカルラベルは不正確）
            var ppParsed = parseLine(lines[pi]);
            if (ppParsed.label && ppParsed.mnemonic === 'EQU') {
                var ppVal = evalExpr(ppParsed.operands, ppSymbols, 0, '');
                if (ppVal !== null && ppVal !== undefined) {
                    ppSymbols[ppParsed.label] = ppVal;
                }
            }
        }
        if (ifStack.length > 0) {
            errors.push({ line: lines.length, msg: 'Unterminated #IF' });
        }

        var baseOrg = -1;  // first ORG (returned as .org)
        var curAddr = 0;   // current absolute address
        var output = [];
        var lastGlobalLabel = '';

        function resolveLocalLabel(name, lineNum) {
            if (name[0] === '.') {
                if (!lastGlobalLabel) {
                    errors.push({ line: lineNum, msg: 'Local label "' + name + '" without preceding global label' });
                    return name;
                }
                return lastGlobalLabel + name;
            }
            return name;
        }

        // Handle ORG: set curAddr, pad output with 0 if needed
        function handleOrg(addr, lineNum) {
            if (baseOrg < 0) {
                // First ORG
                baseOrg = addr;
                curAddr = addr;
            } else if (addr >= curAddr) {
                // Forward ORG: pad with 0
                var pad = addr - curAddr;
                for (var p = 0; p < pad; p++) output.push(0);
                curAddr = addr;
            } else {
                // Backward ORG: error
                errors.push({ line: lineNum, msg: 'ORG cannot go backward (current: 0x' +
                    curAddr.toString(16).toUpperCase() + ', requested: 0x' + addr.toString(16).toUpperCase() + ')' });
            }
        }

        // ---- Pass 1: collect labels, determine sizes ----
        var pass1Addr = 0;
        var pass1BaseOrg = -1;
        var currentNamespace = 'NAME_SPACE_DEFAULT';

        for (var i = 0; i < lines.length; i++) {
            var parsed = parseLine(lines[i]);

            // Namespace directive
            if (parsed.mnemonic === '_NAMESPACE') {
                currentNamespace = parsed.operands;
                continue;
            }

            if (parsed.label) {
                var lbl;
                if (parsed.label[0] === '.') {
                    lbl = resolveLocalLabel(parsed.label, i + 1);
                } else {
                    lbl = currentNamespace + '.' + parsed.label;
                    lastGlobalLabel = lbl;
                }

                if (parsed.mnemonic === 'EQU') {
                    var eqVal = evalExpr(parsed.operands, symbols, pass1Addr, lastGlobalLabel, currentNamespace);
                    if (eqVal === null || eqVal === undefined) eqVal = 0;
                    symbols[lbl] = eqVal;
                    continue;
                }
                symbols[lbl] = pass1Addr;
            }

            if (!parsed.mnemonic) continue;

            if (parsed.mnemonic === 'ORG') {
                var orgVal = evalExpr(parsed.operands, symbols, pass1Addr, lastGlobalLabel, currentNamespace);
                if (orgVal !== null && orgVal !== undefined) {
                    if (pass1BaseOrg < 0) pass1BaseOrg = orgVal;
                    pass1Addr = orgVal;
                }
                continue;
            }

            if (parsed.mnemonic === 'ALIGN') {
                var alignVal = evalExpr(parsed.operands, symbols, pass1Addr, lastGlobalLabel, currentNamespace);
                if (alignVal && alignVal > 0) {
                    var rem = pass1Addr % alignVal;
                    if (rem !== 0) pass1Addr += alignVal - rem;
                }
                continue;
            }

            var size = getInstructionSize(parsed, symbols, pass1Addr, 1, lastGlobalLabel, currentNamespace);
            if (size < 0) {
                errors.push({ line: i + 1, msg: 'Unknown instruction: ' + parsed.mnemonic + ' ' + parsed.operands });
                continue;
            }
            pass1Addr += size;
        }

        // ---- Pass 2: emit bytes ----
        lastGlobalLabel = '';
        currentNamespace = 'NAME_SPACE_DEFAULT';
        for (var j = 0; j < lines.length; j++) {
            var parsed2 = parseLine(lines[j]);

            // Namespace directive
            if (parsed2.mnemonic === '_NAMESPACE') {
                currentNamespace = parsed2.operands;
                continue;
            }

            if (parsed2.label) {
                if (parsed2.label[0] === '.') {
                    // ローカルラベル
                } else {
                    var lbl2ns = currentNamespace + '.' + parsed2.label;
                    lastGlobalLabel = lbl2ns;
                }
                if (parsed2.mnemonic === 'EQU') {
                    var lbl2;
                    if (parsed2.label[0] === '.') {
                        lbl2 = resolveLocalLabel(parsed2.label, j + 1);
                    } else {
                        lbl2 = currentNamespace + '.' + parsed2.label;
                    }
                    var eqVal2 = evalExpr(parsed2.operands, symbols, curAddr, lastGlobalLabel, currentNamespace);
                    if (eqVal2 !== null && eqVal2 !== undefined) symbols[lbl2] = eqVal2;
                    continue;
                }
            }

            if (!parsed2.mnemonic) continue;

            if (parsed2.mnemonic === 'ORG') {
                var orgVal2 = evalExpr(parsed2.operands, symbols, curAddr, lastGlobalLabel, currentNamespace);
                if (orgVal2 !== null && orgVal2 !== undefined) {
                    handleOrg(orgVal2, j + 1);
                }
                continue;
            }

            if (parsed2.mnemonic === 'ALIGN') {
                var alignVal2 = evalExpr(parsed2.operands, symbols, curAddr, lastGlobalLabel, currentNamespace);
                if (alignVal2 && alignVal2 > 0) {
                    var rem2 = curAddr % alignVal2;
                    if (rem2 !== 0) {
                        var pad2 = alignVal2 - rem2;
                        for (var ap = 0; ap < pad2; ap++) output.push(0xFF);
                        curAddr += pad2;
                    }
                }
                continue;
            }

            var bytes = emitInstruction(parsed2, symbols, curAddr, 2, lastGlobalLabel, currentNamespace);
            if (bytes === null) {
                errors.push({ line: j + 1, msg: 'Failed to encode: ' + parsed2.mnemonic + ' ' + parsed2.operands });
                continue;
            }
            for (var k = 0; k < bytes.length; k++) {
                output.push(bytes[k] & 0xFF);
            }
            curAddr += bytes.length;
        }

        return {
            bytes: new Uint8Array(output),
            org: baseOrg >= 0 ? baseOrg : 0,
            errors: errors,
            symbols: symbols
        };
    }

    function getInstructionSize(parsed, symbols, pc, pass, globalLabel, currentNamespace) {
        var bytes = emitInstruction(parsed, symbols, pc, pass, globalLabel);
        if (bytes === null) return -1;
        return bytes.length;
    }

    function emitInstruction(parsed, symbols, pc, pass, globalLabel, currentNamespace) {
        var mn = parsed.mnemonic;
        var opStr = parsed.operands;

        // Pseudo-instructions
        if (mn === 'DB' || mn === 'DEFB') return emitDB(opStr, symbols, pc, pass, globalLabel, currentNamespace);
        if (mn === 'DW' || mn === 'DEFW') return emitDW(opStr, symbols, pc, pass, globalLabel, currentNamespace);
        if (mn === 'DS' || mn === 'DEFS') return emitDS(opStr, symbols, pc, pass, globalLabel, currentNamespace);

        // Classify operands
        var rawOps = splitOperands(opStr);
        var ops = rawOps.map(function(s) { return classifyOperand(s, symbols, pc, pass, globalLabel, currentNamespace); });

        // Try each family
        var result = encodeBasic(mn, ops, symbols, pc, pass);
        if (result) return result;

        result = encodeCB(mn, ops, symbols, pc, pass);
        if (result) return result;

        result = encodeED(mn, ops);
        if (result) return result;

        return null;
    }

    function emitDB(opStr, symbols, pc, pass, globalLabel, currentNamespace) {
        var bytes = [];
        var parts = [];
        // Split by comma, but respect strings
        var current = '';
        var inStr = false;
        for (var i = 0; i < opStr.length; i++) {
            if (opStr[i] === '"') { inStr = !inStr; current += opStr[i]; continue; }
            if (!inStr && opStr[i] === ',') { parts.push(current.trim()); current = ''; continue; }
            current += opStr[i];
        }
        if (current.trim()) parts.push(current.trim());

        for (var j = 0; j < parts.length; j++) {
            var p = parts[j];
            if (p.length >= 2 && p[0] === '"' && p[p.length - 1] === '"') {
                // String literal (ASCII only)
                for (var k = 1; k < p.length - 1; k++) {
                    var ch = p.charCodeAt(k);
                    if (ch > 0x7F) return null; // non-ASCII error
                    bytes.push(ch);
                }
            } else {
                var v = evalExpr(p, symbols, pc + bytes.length, globalLabel, currentNamespace);
                if (v === null) return null; // parse error (e.g. non-ASCII literal)
                if (v === undefined && pass === 2) return null; // unresolved
                if (v === undefined) v = 0; // pass 1 placeholder
                bytes.push(v & 0xFF);
            }
        }
        return bytes;
    }

    function emitDW(opStr, symbols, pc, pass, globalLabel, currentNamespace) {
        var bytes = [];
        var parts = splitOperands(opStr);
        for (var i = 0; i < parts.length; i++) {
            var v = evalExpr(parts[i], symbols, pc + bytes.length, globalLabel, currentNamespace);
            if (v === null) return null;
            if (v === undefined && pass === 2) return null;
            if (v === undefined) v = 0;
            bytes.push(v & 0xFF);
            bytes.push((v >> 8) & 0xFF);
        }
        return bytes;
    }

    function emitDS(opStr, symbols, pc, pass, globalLabel, currentNamespace) {
        var parts = splitOperands(opStr);
        var count = evalExpr(parts[0], symbols, pc, globalLabel, currentNamespace);
        if (count === null || count === undefined) count = 0;
        var fill = parts.length > 1 ? evalExpr(parts[1], symbols, pc, globalLabel, currentNamespace) : 0;
        if (fill === null || fill === undefined) fill = 0;
        var bytes = [];
        for (var i = 0; i < count; i++) bytes.push(fill & 0xFF);
        return bytes;
    }

    // ================================================================
    // Public API
    // ================================================================

    window.X1PenZ80Asm = {
        assemble: assemble
    };

})();

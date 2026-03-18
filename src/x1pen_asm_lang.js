// x1pen_asm_lang.js — Z80 ASM syntax highlighting for CodeMirror 6
// Uses StreamLanguage (CodeMirror 5 compatible stream parser)

import { StreamLanguage } from '@codemirror/language';

var ASM_MNEMONICS = new Set([
    'NOP','HALT','DI','EI','RLCA','RRCA','RLA','RRA','DAA','CPL','SCF','CCF','EXX',
    'LD','PUSH','POP','EX','ADD','ADC','SUB','SBC','AND','OR','XOR','CP','INC','DEC',
    'JP','JR','DJNZ','CALL','RET','RST','IN','OUT','NEG',
    'RLC','RRC','RL','RR','SLA','SRA','SRL','BIT','RES','SET',
    'RETI','RETN','IM','RRD','RLD',
    'LDI','LDIR','LDD','LDDR','CPI','CPIR','CPD','CPDR',
    'INI','INIR','IND','INDR','OUTI','OTIR','OUTD','OTDR',
]);

var ASM_PSEUDO = new Set([
    'ORG','DB','DW','DS','DEFB','DEFW','DEFS','EQU',
]);

var ASM_REGISTERS = new Set([
    'A','B','C','D','E','H','L',
    'BC','DE','HL','SP','AF',
    'IX','IY','IXH','IXL','IYH','IYL',
    'I','R',
]);

var ASM_CONDITIONS = new Set(['NZ','Z','NC','PO','PE','P','M']);
// Note: 'C' is both a register and condition; treated as register

var z80AsmParser = {
    name: 'z80asm',
    startState: function() {
        return { inString: false, sol: true };
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

        var atLineStart = stream.sol();

        // Comment
        if (stream.match(';')) {
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

        // Character literal 'X'
        if (stream.match(/'[^']*'/)) {
            return 'string';
        }

        // Hex numbers: $xx, 0xNN, NNh
        if (stream.match(/^\$[0-9A-Fa-f]+/)) return 'number';
        if (stream.match(/^0x[0-9A-Fa-f]+/i)) return 'number';
        if (stream.match(/^[0-9][0-9A-Fa-f]*[hH]/)) return 'number';

        // Binary: %nnnn, nnnnb
        if (stream.match(/^%[01]+/)) return 'number';
        if (stream.match(/^[01]+[bB]/)) return 'number';

        // Decimal
        if (stream.match(/^[0-9]+/)) return 'number';

        // Word (mnemonic, pseudo, register, label)
        if (stream.match(/^[A-Za-z_.][A-Za-z0-9_]*/)) {
            var word = stream.current().toUpperCase();

            // Skip colon after label
            var hasColon = stream.eat(':');

            if (ASM_MNEMONICS.has(word)) return 'keyword';
            if (ASM_PSEUDO.has(word)) return 'typeName';
            if (ASM_REGISTERS.has(word) && !hasColon) return 'variableName';
            if (ASM_CONDITIONS.has(word) && !hasColon) return 'variableName';

            // Label: at line start (no indent) or has colon
            if (atLineStart || hasColon) return 'labelName';

            return null;
        }

        // Operators
        if (stream.match(/^[+\-*\/,()]/)) {
            return null;
        }

        stream.next();
        return null;
    }
};

export var z80AsmLanguage = StreamLanguage.define(z80AsmParser);

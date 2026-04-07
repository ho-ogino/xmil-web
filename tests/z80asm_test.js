// Z80 Assembler comprehensive test suite
// Run: node tests/z80asm_test.js

global.window = global;
require('../html/x1pen_z80asm.js');
var asm = window.X1PenZ80Asm;

var passes = 0, failures = 0;

function hex(b) { return '$' + ('0' + b.toString(16).toUpperCase()).slice(-2); }

function testOK(name, source, expectedBytes) {
    var result = asm.assemble(source);
    if (result.errors.length > 0) {
        console.error('FAIL:', name, '— unexpected errors:', result.errors);
        failures++; return;
    }
    var actual = Array.from(result.bytes);
    if (JSON.stringify(actual) !== JSON.stringify(expectedBytes)) {
        console.error('FAIL:', name);
        console.error('  expected:', expectedBytes.map(hex).join(' '));
        console.error('  actual:  ', actual.map(hex).join(' '));
        failures++;
    } else { passes++; }
}

function testFail(name, source) {
    var result = asm.assemble(source);
    if (result.errors.length === 0) {
        console.error('FAIL:', name, '— expected error but got', Array.from(result.bytes).map(hex).join(' '));
        failures++;
    } else { passes++; }
}

// ================================================================
// 1. No-argument instructions
// ================================================================
testOK('NOP',  'NOP',  [0x00]);
testOK('HALT', 'HALT', [0x76]);
testOK('DI',   'DI',   [0xF3]);
testOK('EI',   'EI',   [0xFB]);
testOK('RLCA', 'RLCA', [0x07]);
testOK('RRCA', 'RRCA', [0x0F]);
testOK('RLA',  'RLA',  [0x17]);
testOK('RRA',  'RRA',  [0x1F]);
testOK('DAA',  'DAA',  [0x27]);
testOK('CPL',  'CPL',  [0x2F]);
testOK('SCF',  'SCF',  [0x37]);
testOK('CCF',  'CCF',  [0x3F]);
testOK('EXX',  'EXX',  [0xD9]);
testOK('RET',  'RET',  [0xC9]);

// ================================================================
// 2. LD r,r
// ================================================================
testOK('LD A,A',    'LD A,A',    [0x7F]);
testOK('LD A,B',    'LD A,B',    [0x78]);
testOK('LD B,C',    'LD B,C',    [0x41]);
testOK('LD D,E',    'LD D,E',    [0x53]);
testOK('LD H,L',    'LD H,L',    [0x65]);
testOK('LD (HL),A', 'LD (HL),A', [0x77]);
testOK('LD A,(HL)', 'LD A,(HL)', [0x7E]);
testOK('LD (HL),B', 'LD (HL),B', [0x70]);

// ================================================================
// 3. LD r,n
// ================================================================
testOK('LD A,0x42', 'LD A,0x42', [0x3E, 0x42]);
testOK('LD B,0xFF', 'LD B,0xFF', [0x06, 0xFF]);
testOK('LD C,0',    'LD C,0',    [0x0E, 0x00]);
testOK('LD D,100',  'LD D,100',  [0x16, 0x64]);
testOK('LD E,$AB',  'LD E,$AB',  [0x1E, 0xAB]);

// ================================================================
// 4. LD dd,nn (16-bit immediate)
// ================================================================
testOK('LD BC,0x1234', 'LD BC,0x1234', [0x01, 0x34, 0x12]);
testOK('LD DE,0x5678', 'LD DE,0x5678', [0x11, 0x78, 0x56]);
testOK('LD HL,0x9ABC', 'LD HL,0x9ABC', [0x21, 0xBC, 0x9A]);
testOK('LD SP,0x0000', 'LD SP,0x0000', [0x31, 0x00, 0x00]);
testOK('LD IX,0x1234', 'LD IX,0x1234', [0xDD, 0x21, 0x34, 0x12]);
testOK('LD IY,0x5678', 'LD IY,0x5678', [0xFD, 0x21, 0x78, 0x56]);

// ================================================================
// 5. LD (IX+d),r / LD r,(IX+d)
// ================================================================
testOK('LD (IX+5),A',  'LD (IX+5),A',  [0xDD, 0x77, 0x05]);
testOK('LD A,(IX+5)',  'LD A,(IX+5)',   [0xDD, 0x7E, 0x05]);
testOK('LD (IY+3),B',  'LD (IY+3),B',  [0xFD, 0x70, 0x03]);
testOK('LD B,(IY+3)',  'LD B,(IY+3)',   [0xFD, 0x46, 0x03]);
testOK('LD (IX+0),C',  'LD (IX+0),C',  [0xDD, 0x71, 0x00]);
testOK('LD (IX),A',     'LD (IX),A',    [0xDD, 0x77, 0x00]);

// ================================================================
// 6. LD (IX+d),n
// ================================================================
testOK('LD (IX+2),0x42', 'LD (IX+2),0x42', [0xDD, 0x36, 0x02, 0x42]);
testOK('LD (IY+1),0xFF', 'LD (IY+1),0xFF', [0xFD, 0x36, 0x01, 0xFF]);

// ================================================================
// 7. LD (nn),A / LD A,(nn)
// ================================================================
testOK('LD (0x1234),A', 'LD (0x1234),A', [0x32, 0x34, 0x12]);
testOK('LD A,(0x1234)', 'LD A,(0x1234)', [0x3A, 0x34, 0x12]);

// ================================================================
// 8. LD (BC/DE),A / LD A,(BC/DE)
// ================================================================
testOK('LD (BC),A', 'LD (BC),A', [0x02]);
testOK('LD (DE),A', 'LD (DE),A', [0x12]);
testOK('LD A,(BC)', 'LD A,(BC)', [0x0A]);
testOK('LD A,(DE)', 'LD A,(DE)', [0x1A]);

// ================================================================
// 9. LD SP,HL / LD SP,IX / LD SP,IY
// ================================================================
testOK('LD SP,HL', 'LD SP,HL', [0xF9]);
testOK('LD SP,IX', 'LD SP,IX', [0xDD, 0xF9]);
testOK('LD SP,IY', 'LD SP,IY', [0xFD, 0xF9]);

// ================================================================
// 10. LD (nn),HL / LD HL,(nn) — direct
// ================================================================
testOK('LD (0x1234),HL', 'LD (0x1234),HL', [0x22, 0x34, 0x12]);
testOK('LD HL,(0x1234)', 'LD HL,(0x1234)', [0x2A, 0x34, 0x12]);

// ================================================================
// 11. LD (nn),dd / LD dd,(nn) — ED prefix
// ================================================================
testOK('LD (0x1234),BC', 'LD (0x1234),BC', [0xED, 0x43, 0x34, 0x12]);
testOK('LD (0x1234),DE', 'LD (0x1234),DE', [0xED, 0x53, 0x34, 0x12]);
testOK('LD (0x1234),SP', 'LD (0x1234),SP', [0xED, 0x73, 0x34, 0x12]);
testOK('LD BC,(0x1234)', 'LD BC,(0x1234)', [0xED, 0x4B, 0x34, 0x12]);
testOK('LD DE,(0x1234)', 'LD DE,(0x1234)', [0xED, 0x5B, 0x34, 0x12]);
testOK('LD SP,(0x1234)', 'LD SP,(0x1234)', [0xED, 0x7B, 0x34, 0x12]);

// LD (nn),IX/IY / LD IX/IY,(nn)
testOK('LD (0x1234),IX', 'LD (0x1234),IX', [0xDD, 0x22, 0x34, 0x12]);
testOK('LD (0x1234),IY', 'LD (0x1234),IY', [0xFD, 0x22, 0x34, 0x12]);
testOK('LD IX,(0x1234)', 'LD IX,(0x1234)', [0xDD, 0x2A, 0x34, 0x12]);
testOK('LD IY,(0x1234)', 'LD IY,(0x1234)', [0xFD, 0x2A, 0x34, 0x12]);

// ================================================================
// 12. LD I,A / LD A,I / LD R,A / LD A,R — ED prefix
// ================================================================
testOK('LD I,A', 'LD I,A', [0xED, 0x47]);
testOK('LD R,A', 'LD R,A', [0xED, 0x4F]);
testOK('LD A,I', 'LD A,I', [0xED, 0x57]);
testOK('LD A,R', 'LD A,R', [0xED, 0x5F]);

// Invalid I/R usage
testFail('LD I,B (invalid)', 'LD I,B');
testFail('LD R,B (invalid)', 'LD R,B');
testFail('LD B,I (invalid)', 'LD B,I');
testFail('LD B,R (invalid)', 'LD B,R');
testFail('LD I,I (invalid)', 'LD I,I');
testFail('LD R,R (invalid)', 'LD R,R');

// ================================================================
// 13. PUSH / POP
// ================================================================
testOK('PUSH BC', 'PUSH BC', [0xC5]);
testOK('PUSH DE', 'PUSH DE', [0xD5]);
testOK('PUSH HL', 'PUSH HL', [0xE5]);
testOK('PUSH AF', 'PUSH AF', [0xF5]);
testOK('PUSH IX', 'PUSH IX', [0xDD, 0xE5]);
testOK('PUSH IY', 'PUSH IY', [0xFD, 0xE5]);
testOK('POP BC',  'POP BC',  [0xC1]);
testOK('POP DE',  'POP DE',  [0xD1]);
testOK('POP HL',  'POP HL',  [0xE1]);
testOK('POP AF',  'POP AF',  [0xF1]);
testOK('POP IX',  'POP IX',  [0xDD, 0xE1]);
testOK('POP IY',  'POP IY',  [0xFD, 0xE1]);

// Invalid PUSH/POP
testFail('PUSH SP (invalid)', 'PUSH SP');
testFail('POP SP (invalid)',  'POP SP');

// ================================================================
// 14. EX
// ================================================================
testOK('EX DE,HL',    'EX DE,HL',    [0xEB]);
testOK("EX AF,AF'",   "EX AF,AF'",   [0x08]);
testOK('EX (SP),HL',  'EX (SP),HL',  [0xE3]);
testOK('EX (SP),IX',  'EX (SP),IX',  [0xDD, 0xE3]);
testOK('EX (SP),IY',  'EX (SP),IY',  [0xFD, 0xE3]);

// ================================================================
// 15. ALU: ADD/ADC/SUB/SBC/AND/OR/XOR/CP
// ================================================================
// r
testOK('ADD A,B',  'ADD A,B',  [0x80]);
testOK('ADC A,C',  'ADC A,C',  [0x89]);
testOK('SUB D',    'SUB D',    [0x92]);
testOK('SBC A,E',  'SBC A,E',  [0x9B]);
testOK('AND H',    'AND H',    [0xA4]);
testOK('OR L',     'OR L',     [0xB5]);
testOK('XOR A',    'XOR A',    [0xAF]);
testOK('CP (HL)',  'CP (HL)',  [0xBE]);
// n
testOK('ADD A,0x42', 'ADD A,0x42', [0xC6, 0x42]);
testOK('SUB 0xFF',   'SUB 0xFF',   [0xD6, 0xFF]);
testOK('AND 0x0F',   'AND 0x0F',   [0xE6, 0x0F]);
testOK('CP 0',       'CP 0',       [0xFE, 0x00]);
// (IX+d)
testOK('ADD A,(IX+2)', 'ADD A,(IX+2)', [0xDD, 0x86, 0x02]);
testOK('SUB (IY+3)',   'SUB (IY+3)',   [0xFD, 0x96, 0x03]);

// ================================================================
// 16. ADD HL,ss / ADD IX,ss / ADD IY,ss
// ================================================================
testOK('ADD HL,BC', 'ADD HL,BC', [0x09]);
testOK('ADD HL,DE', 'ADD HL,DE', [0x19]);
testOK('ADD HL,HL', 'ADD HL,HL', [0x29]);
testOK('ADD HL,SP', 'ADD HL,SP', [0x39]);
testOK('ADD IX,BC', 'ADD IX,BC', [0xDD, 0x09]);
testOK('ADD IY,DE', 'ADD IY,DE', [0xFD, 0x19]);

// ================================================================
// 17. ADC HL,ss / SBC HL,ss
// ================================================================
testOK('ADC HL,BC', 'ADC HL,BC', [0xED, 0x4A]);
testOK('ADC HL,DE', 'ADC HL,DE', [0xED, 0x5A]);
testOK('ADC HL,HL', 'ADC HL,HL', [0xED, 0x6A]);
testOK('ADC HL,SP', 'ADC HL,SP', [0xED, 0x7A]);
testOK('SBC HL,BC', 'SBC HL,BC', [0xED, 0x42]);
testOK('SBC HL,DE', 'SBC HL,DE', [0xED, 0x52]);

// ================================================================
// 18. INC / DEC
// ================================================================
testOK('INC A',    'INC A',    [0x3C]);
testOK('INC B',    'INC B',    [0x04]);
testOK('INC (HL)', 'INC (HL)', [0x34]);
testOK('DEC A',    'DEC A',    [0x3D]);
testOK('DEC C',    'DEC C',    [0x0D]);
testOK('DEC (HL)', 'DEC (HL)', [0x35]);
// dd
testOK('INC BC', 'INC BC', [0x03]);
testOK('INC DE', 'INC DE', [0x13]);
testOK('INC HL', 'INC HL', [0x23]);
testOK('INC SP', 'INC SP', [0x33]);
testOK('DEC BC', 'DEC BC', [0x0B]);
testOK('DEC SP', 'DEC SP', [0x3B]);
// IX/IY
testOK('INC IX', 'INC IX', [0xDD, 0x23]);
testOK('DEC IY', 'DEC IY', [0xFD, 0x2B]);
// (IX+d)
testOK('INC (IX+5)', 'INC (IX+5)', [0xDD, 0x34, 0x05]);
testOK('DEC (IY+3)', 'DEC (IY+3)', [0xFD, 0x35, 0x03]);

// ================================================================
// 19. JP
// ================================================================
testOK('JP 0x1234',    'ORG 0\nJP 0x1234',    [0xC3, 0x34, 0x12]);
testOK('JP NZ,0x1234', 'ORG 0\nJP NZ,0x1234', [0xC2, 0x34, 0x12]);
testOK('JP Z,0x1234',  'ORG 0\nJP Z,0x1234',  [0xC2+0x08, 0x34, 0x12]);
testOK('JP NC,0x1234', 'ORG 0\nJP NC,0x1234', [0xC2+0x10, 0x34, 0x12]);
testOK('JP C,0x1234',  'ORG 0\nJP C,0x1234',  [0xC2+0x18, 0x34, 0x12]);
testOK('JP (HL)',      'JP (HL)',              [0xE9]);
testOK('JP (IX)',      'JP (IX)',              [0xDD, 0xE9]);
testOK('JP (IY)',      'JP (IY)',              [0xFD, 0xE9]);

// ================================================================
// 20. JR
// ================================================================
testOK('JR forward',    'ORG 0\nJR 5',    [0x18, 0x03]);  // PC=2, target=5, offset=3
testOK('JR NZ,forward', 'ORG 0\nJR NZ,5', [0x20, 0x03]);
testOK('JR Z,forward',  'ORG 0\nJR Z,5',  [0x28, 0x03]);
testOK('JR NC,forward', 'ORG 0\nJR NC,5', [0x30, 0x03]);
testOK('JR C,forward',  'ORG 0\nJR C,5',  [0x38, 0x03]);

// ================================================================
// 21. DJNZ
// ================================================================
testOK('DJNZ forward', 'ORG 0\nDJNZ 5', [0x10, 0x03]);

// ================================================================
// 22. CALL
// ================================================================
testOK('CALL 0x1234',    'ORG 0\nCALL 0x1234',    [0xCD, 0x34, 0x12]);
testOK('CALL NZ,0x1234', 'ORG 0\nCALL NZ,0x1234', [0xC4, 0x34, 0x12]);
testOK('CALL Z,0x1234',  'ORG 0\nCALL Z,0x1234',  [0xCC, 0x34, 0x12]);
testOK('CALL C,0x1234',  'ORG 0\nCALL C,0x1234',  [0xDC, 0x34, 0x12]);
testOK('CALL NC,0x1234', 'ORG 0\nCALL NC,0x1234', [0xD4, 0x34, 0x12]);

// ================================================================
// 23. RET cc
// ================================================================
testOK('RET NZ', 'RET NZ', [0xC0]);
testOK('RET Z',  'RET Z',  [0xC8]);
testOK('RET NC', 'RET NC', [0xD0]);
testOK('RET C',  'RET C',  [0xD8]);
testOK('RET PO', 'RET PO', [0xE0]);
testOK('RET PE', 'RET PE', [0xE8]);
testOK('RET P',  'RET P',  [0xF0]);
testOK('RET M',  'RET M',  [0xF8]);

// ================================================================
// 24. RST
// ================================================================
testOK('RST 00h', 'RST 0',    [0xC7]);
testOK('RST 08h', 'RST 8',    [0xCF]);
testOK('RST 10h', 'RST 0x10', [0xD7]);
testOK('RST 18h', 'RST 0x18', [0xDF]);
testOK('RST 20h', 'RST 0x20', [0xE7]);
testOK('RST 28h', 'RST 0x28', [0xEF]);
testOK('RST 30h', 'RST 0x30', [0xF7]);
testOK('RST 38h', 'RST 0x38', [0xFF]);

// ================================================================
// 25. IN / OUT (basic)
// ================================================================
testOK('IN A,(0x10)',  'IN A,(0x10)',  [0xDB, 0x10]);
testOK('OUT (0x10),A', 'OUT (0x10),A', [0xD3, 0x10]);

// IN r,(C) / OUT (C),r — ED prefix
testOK('IN B,(C)',  'IN B,(C)',  [0xED, 0x40]);
testOK('IN A,(C)',  'IN A,(C)',  [0xED, 0x78]);
testOK('OUT (C),B', 'OUT (C),B', [0xED, 0x41]);
testOK('OUT (C),A', 'OUT (C),A', [0xED, 0x79]);

// ================================================================
// 26. CB instructions: rotate/shift
// ================================================================
testOK('RLC B',    'RLC B',    [0xCB, 0x00]);
testOK('RLC A',    'RLC A',    [0xCB, 0x07]);
testOK('RRC C',    'RRC C',    [0xCB, 0x09]);
testOK('RL D',     'RL D',     [0xCB, 0x12]);
testOK('RR E',     'RR E',     [0xCB, 0x1B]);
testOK('SLA H',    'SLA H',    [0xCB, 0x24]);
testOK('SRA L',    'SRA L',    [0xCB, 0x2D]);
testOK('SRL A',    'SRL A',    [0xCB, 0x3F]);
testOK('RLC (HL)', 'RLC (HL)', [0xCB, 0x06]);

// CB with (IX+d)
testOK('RLC (IX+5)', 'RLC (IX+5)', [0xDD, 0xCB, 0x05, 0x06]);
testOK('SRL (IY+3)', 'SRL (IY+3)', [0xFD, 0xCB, 0x03, 0x3E]);

// ================================================================
// 27. BIT / RES / SET
// ================================================================
testOK('BIT 0,B',  'BIT 0,B',  [0xCB, 0x40]);
testOK('BIT 3,A',  'BIT 3,A',  [0xCB, 0x5F]);
testOK('BIT 7,(HL)', 'BIT 7,(HL)', [0xCB, 0x7E]);
testOK('RES 0,B',  'RES 0,B',  [0xCB, 0x80]);
testOK('SET 7,A',  'SET 7,A',  [0xCB, 0xFF]);

// BIT/SET/RES with (IX+d)
testOK('BIT 3,(IX+5)', 'BIT 3,(IX+5)', [0xDD, 0xCB, 0x05, 0x5E]);
testOK('SET 0,(IY+2)', 'SET 0,(IY+2)', [0xFD, 0xCB, 0x02, 0xC6]);
testOK('RES 7,(IX+1)', 'RES 7,(IX+1)', [0xDD, 0xCB, 0x01, 0xBE]);

// ================================================================
// 28. ED instructions: NEG, RETI, RETN, IM, RRD, RLD
// ================================================================
testOK('NEG',  'NEG',  [0xED, 0x44]);
testOK('RETI', 'RETI', [0xED, 0x4D]);
testOK('RETN', 'RETN', [0xED, 0x45]);
testOK('IM 0', 'IM 0', [0xED, 0x46]);
testOK('IM 1', 'IM 1', [0xED, 0x56]);
testOK('IM 2', 'IM 2', [0xED, 0x5E]);
testOK('RRD',  'RRD',  [0xED, 0x67]);
testOK('RLD',  'RLD',  [0xED, 0x6F]);

// ================================================================
// 29. Block transfer / IO
// ================================================================
testOK('LDI',  'LDI',  [0xED, 0xA0]);
testOK('LDIR', 'LDIR', [0xED, 0xB0]);
testOK('LDD',  'LDD',  [0xED, 0xA8]);
testOK('LDDR', 'LDDR', [0xED, 0xB8]);
testOK('CPI',  'CPI',  [0xED, 0xA1]);
testOK('CPIR', 'CPIR', [0xED, 0xB1]);
testOK('CPD',  'CPD',  [0xED, 0xA9]);
testOK('CPDR', 'CPDR', [0xED, 0xB9]);
testOK('INI',  'INI',  [0xED, 0xA2]);
testOK('INIR', 'INIR', [0xED, 0xB2]);
testOK('IND',  'IND',  [0xED, 0xAA]);
testOK('INDR', 'INDR', [0xED, 0xBA]);
testOK('OUTI', 'OUTI', [0xED, 0xA3]);
testOK('OTIR', 'OTIR', [0xED, 0xB3]);
testOK('OUTD', 'OUTD', [0xED, 0xAB]);
testOK('OTDR', 'OTDR', [0xED, 0xBB]);

// ================================================================
// 30. Unary plus / expressions
// ================================================================
testOK('DB +5',         'DB +5',         [5]);
testOK('LD A,+1',       'LD A,+1',       [0x3E, 0x01]);
testOK('DB 3+2',        'DB 3+2',        [5]);
testOK('DB 10-3',       'DB 10-3',       [7]);
testOK('DB 2*3',        'DB 2*3',        [6]);
testOK('LD (IX+5),A displacement', 'LD (IX+5),A', [0xDD, 0x77, 0x05]);

// ================================================================
// 31. Pseudo-instructions
// ================================================================
testOK('DB',  'DB 1,2,3',     [1, 2, 3]);
testOK('DW',  'DW 0x1234',    [0x34, 0x12]);
testOK('DS',  'DS 3',         [0xFF, 0xFF, 0xFF]);
testOK('DS fill', 'DS 3,0xFF', [0xFF, 0xFF, 0xFF]);
testOK('DB string', 'DB "AB"', [0x41, 0x42]);
testOK('ORG', 'ORG 0x100\nNOP', [0x00]);

testOK('EQU', 'VAL EQU 0x42\nLD A,VAL', [0x3E, 0x42]);

// ================================================================
// 31. Labels
// ================================================================
testOK('label forward ref', 'ORG 0\nJP target\ntarget:\nNOP', [0xC3, 0x03, 0x00, 0x00]);
testOK('label backward ref', 'ORG 0\nloop:\nNOP\nJP loop', [0x00, 0xC3, 0x00, 0x00]);

// Local labels
testOK('local label', 'ORG 0\nmain:\n.loop:\nNOP\nJR .loop', [0x00, 0x18, 0xFD]);

// ================================================================
// Summary
// ================================================================
// ================================================================
// #IF / #ELSE / #ENDIF preprocessor tests
// ================================================================
console.log('\n--- #IF / #ELSE / #ENDIF ---');

testOK('#IF true', 'VAL EQU 5\n#IF VAL == 5\nNOP\n#ENDIF', [0x00]);
testOK('#IF false', 'VAL EQU 3\n#IF VAL == 5\nNOP\n#ENDIF', []);
testOK('#IF true with ELSE',
    'VAL EQU 5\n#IF VAL == 5\nNOP\n#ELSE\nHALT\n#ENDIF', [0x00]);
testOK('#IF false with ELSE',
    'VAL EQU 3\n#IF VAL == 5\nNOP\n#ELSE\nHALT\n#ENDIF', [0x76]);
testOK('#IF nested',
    'A EQU 1\nB EQU 0\n#IF A\n#IF B\nNOP\n#ELSE\nHALT\n#ENDIF\n#ENDIF',
    [0x76]);
testOK('#IF !=', 'VAL EQU 3\n#IF VAL != 5\nNOP\n#ENDIF', [0x00]);
testOK('#IF >', 'VAL EQU 10\n#IF VAL > 5\nNOP\n#ENDIF', [0x00]);
testOK('#IF >=', 'VAL EQU 5\n#IF VAL >= 5\nNOP\n#ENDIF', [0x00]);
testOK('#IF <', 'VAL EQU 3\n#IF VAL < 5\nNOP\n#ENDIF', [0x00]);
testOK('#IF <=', 'VAL EQU 5\n#IF VAL <= 5\nNOP\n#ENDIF', [0x00]);
testOK('#IF nonzero', '#IF 1\nNOP\n#ENDIF', [0x00]);
testOK('#IF zero', '#IF 0\nNOP\n#ENDIF', []);
testOK('#IF false EQU hidden',
    '#IF 0\nFOO EQU 1\n#ENDIF\n#IF FOO\nNOP\n#ENDIF', []);
testOK('#IF false ORG hidden',
    'ORG 0\n#IF 0\nORG 0x8000\n#ENDIF\nNOP', [0x00]);
testOK('#IF UNDEF is false', '#IF UNDEF\nNOP\n#ENDIF', []);
testOK('#IF UNDEF == 0 is true', '#IF UNDEF == 0\nNOP\n#ENDIF', []);
testOK('#IF nested false-true',
    '#IF 0\n#IF 1\nNOP\n#ENDIF\n#ENDIF', []);
testOK('#IF nested true-false-else',
    'A EQU 1\nB EQU 0\n#IF A\n#IF B\nNOP\n#ELSE\nHALT\n#ENDIF\nRET\n#ENDIF',
    [0x76, 0xC9]);

// predefinedSymbols in #IF
(function() {
    var r = asm.assemble('#IF MY_FLAG\nNOP\n#ENDIF', { MY_FLAG: 1 });
    if (r.errors.length > 0 || r.bytes.length !== 1 || r.bytes[0] !== 0x00) {
        console.error('FAIL: #IF predefined true'); failures++;
    } else { passes++; }
    var r2 = asm.assemble('#IF MY_FLAG\nNOP\n#ENDIF', { MY_FLAG: 0 });
    if (r2.errors.length > 0 || r2.bytes.length !== 0) {
        console.error('FAIL: #IF predefined false'); failures++;
    } else { passes++; }
})();

testFail('#ELSE without #IF', '#ELSE\nNOP\n#ENDIF');
testFail('#ENDIF without #IF', '#ENDIF');
testFail('Unterminated #IF', '#IF 1\nNOP');
testFail('Duplicate #ELSE', '#IF 1\nNOP\n#ELSE\nHALT\n#ELSE\nNOP\n#ENDIF');
testFail('#IF syntax error', '#IF 1 +\nNOP\n#ENDIF');

// #ELIF
testOK('#ELIF: IF true, ELIF skipped', '#IF 1\n LD A,1\n#ELIF 1\n LD A,2\n#ENDIF', [0x3E, 0x01]);
testOK('#ELIF: IF false, ELIF true', '#IF 0\n LD A,1\n#ELIF 1\n LD A,2\n#ENDIF', [0x3E, 0x02]);
testOK('#ELIF: IF false, ELIF false, ELSE', '#IF 0\n LD A,1\n#ELIF 0\n LD A,2\n#ELSE\n LD A,3\n#ENDIF', [0x3E, 0x03]);
testOK('#ELIF: multiple (V=2)', 'V EQU 2\n#IF V==0\n DB 0\n#ELIF V==1\n DB 1\n#ELIF V==2\n DB 2\n#ELSE\n DB 99\n#ENDIF', [0x02]);
testOK('#ELIF: none match, ELSE', 'V EQU 5\n#IF V==0\n DB 0\n#ELIF V==1\n DB 1\n#ELIF V==2\n DB 2\n#ELSE\n DB 99\n#ENDIF', [0x63]);
testFail('#ELIF after #ELSE', '#IF 0\n NOP\n#ELSE\n NOP\n#ELIF 1\n NOP\n#ENDIF');
testFail('#ELIF without #IF', '#ELIF 1\nNOP\n#ENDIF');

// --- IX/IY half registers ---
console.log('\n--- IX/IY half registers ---');

// LD r, IXH/IXL/IYH/IYL
testOK('LD A,IXH',  'LD A,IXH',  [0xDD, 0x7C]);
testOK('LD A,IXL',  'LD A,IXL',  [0xDD, 0x7D]);
testOK('LD A,IYH',  'LD A,IYH',  [0xFD, 0x7C]);
testOK('LD A,IYL',  'LD A,IYL',  [0xFD, 0x7D]);
testOK('LD B,IXH',  'LD B,IXH',  [0xDD, 0x44]);
testOK('LD C,IXL',  'LD C,IXL',  [0xDD, 0x4D]);

// LD IXH/IXL/IYH/IYL, r
testOK('LD IXH,A',  'LD IXH,A',  [0xDD, 0x67]);
testOK('LD IXL,A',  'LD IXL,A',  [0xDD, 0x6F]);
testOK('LD IYH,A',  'LD IYH,A',  [0xFD, 0x67]);
testOK('LD IYL,A',  'LD IYL,A',  [0xFD, 0x6F]);
testOK('LD IXH,B',  'LD IXH,B',  [0xDD, 0x60]);
testOK('LD IXL,C',  'LD IXL,C',  [0xDD, 0x69]);

// LD IXH/IXL, imm8
testOK('LD IXH,$42', 'LD IXH,$42', [0xDD, 0x26, 0x42]);
testOK('LD IXL,$42', 'LD IXL,$42', [0xDD, 0x2E, 0x42]);
testOK('LD IYH,$42', 'LD IYH,$42', [0xFD, 0x26, 0x42]);
testOK('LD IYL,$42', 'LD IYL,$42', [0xFD, 0x2E, 0x42]);

// INC/DEC IXH/IXL/IYH/IYL
testOK('INC IXH', 'INC IXH', [0xDD, 0x24]);
testOK('DEC IXH', 'DEC IXH', [0xDD, 0x25]);
testOK('INC IXL', 'INC IXL', [0xDD, 0x2C]);
testOK('DEC IXL', 'DEC IXL', [0xDD, 0x2D]);
testOK('INC IYH', 'INC IYH', [0xFD, 0x24]);
testOK('DEC IYH', 'DEC IYH', [0xFD, 0x25]);
testOK('INC IYL', 'INC IYL', [0xFD, 0x2C]);
testOK('DEC IYL', 'DEC IYL', [0xFD, 0x2D]);

// Case insensitive
testOK('LD a,ixl',  'LD a,ixl',  [0xDD, 0x7D]);
testOK('inc ixh',   'inc ixh',   [0xDD, 0x24]);
testOK('dec iyl',   'dec iyl',   [0xFD, 0x2D]);

// --- SLL (undocumented) ---
console.log('\n--- SLL (undocumented) ---');
testOK('SLL E',    'SLL E',    [0xCB, 0x33]);
testOK('SLL A',    'SLL A',    [0xCB, 0x37]);
testOK('SLL B',    'SLL B',    [0xCB, 0x30]);
testOK('SLL (HL)', 'SLL (HL)', [0xCB, 0x36]);
testOK('SL1 E',    'SL1 E',    [0xCB, 0x33]);
testOK('sll e (lowercase)', 'sll e', [0xCB, 0x33]);
testOK('SLL (IX+5)', 'SLL (IX+5)', [0xDD, 0xCB, 0x05, 0x36]);

// --- MACRO / ENDM ---
console.log('\n--- MACRO / ENDM ---');

// No-arg macro
testOK('Macro no args', 'ALLLD MACRO\n LD A,1\n LD B,2\nENDM\n ALLLD', [0x3E,0x01, 0x06,0x02]);

// Macro with args
testOK('Macro with args', 'MYSET MACRO REG,VAL\n LD REG,VAL\nENDM\n MYSET A,$42', [0x3E,0x42]);

// Multiple expansions
testOK('Macro multi expand', 'LOADR MACRO R,V\n LD R,V\nENDM\n LOADR A,1\n LOADR B,2',
    [0x3E,0x01, 0x06,0x02]);

// Macro with label on call line
testOK('Macro call with label', 'MYPUSH MACRO R\n PUSH R\nENDM\nSTART: MYPUSH BC\n NOP',
    [0xC5, 0x00]);

// Forward reference: call before definition
testOK('Macro forward ref', ' FWDMAC\nFWDMAC MACRO\n NOP\n HALT\nENDM', [0x00, 0x76]);

// Nested macro call (macro A calls macro B)
testOK('Nested macro call',
    'INNER MACRO\n NOP\nENDM\nOUTER MACRO\n INNER\n HALT\nENDM\n OUTER',
    [0x00, 0x76]);

// Error: unterminated MACRO
testFail('Unterminated MACRO', 'FOO MACRO\n NOP');

// Error: mnemonic name conflict
testFail('Macro name conflict with mnemonic', 'NOP MACRO\n HALT\nENDM');

// Error: arg count mismatch
testFail('Macro arg count mismatch', 'M2 MACRO A,B\n LD A,B\nENDM\n M2 1');

// Error: recursive macro
testFail('Recursive macro', 'REC MACRO\n REC\nENDM\n REC');

// Error: label in macro body
testFail('Label in macro body', 'BADMAC MACRO\nFOO:\n NOP\nENDM');

// Error: local label in macro body
testFail('Local label in macro body', 'BADMAC2 MACRO\n.FOO:\n NOP\nENDM');

// Error: EQU label in macro body
testFail('EQU in macro body', 'BAD MACRO\nLBL EQU 1\n NOP\nENDM');

// Error: colonless label in macro body
testFail('Colonless label in macro body', 'BAD3 MACRO\nLBL\n NOP\nENDM');

// Error: local label without colon in macro body
testFail('Local label no colon in macro body', 'BAD4 MACRO\n.LBL\n NOP\nENDM');

// MACRO/ENDM with comments
testOK('MACRO with comment', 'M MACRO ; comment\n NOP\nENDM\n M', [0x00]);
testOK('MACRO args with comment', 'M MACRO R ; load reg\n LD R,0\nENDM\n M A', [0x3E, 0x00]);
testOK('ENDM with comment', 'M MACRO\n NOP\nENDM ; done\n M', [0x00]);

// --- Case insensitive symbols ---
console.log('\n--- Case insensitive symbols ---');

// Labels: mixed case reference
testOK('Case insensitive label', 'Foo: NOP\n JP FOO', [0x00, 0xC3, 0x00, 0x00]);
testOK('Case insensitive label (lower ref)', 'FOO: NOP\n JP foo', [0x00, 0xC3, 0x00, 0x00]);
testOK('Case insensitive EQU', 'myVal EQU $42\n LD A,(MYVAL)', [0x3A, 0x42, 0x00]);

// exists operator case insensitive
testOK('exists case insensitive', 'FOO EQU 1\n#IF exists foo\n NOP\n#ENDIF', [0x00]);

// CALL MAIN resolves to main: (SLANG pattern)
testOK('CALL MAIN matches main:', 'main:\n RET\nentry:\n CALL MAIN', [0xC9, 0xCD, 0x00, 0x00]);

console.log('\n' + '='.repeat(40));
console.log('Results: ' + passes + ' passed, ' + failures + ' failed');
console.log('='.repeat(40));
process.exit(failures > 0 ? 1 : 0);

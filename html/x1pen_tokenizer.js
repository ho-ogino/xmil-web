/**
 * X1Pen FuzzyBASIC Tokenizer
 *
 * FuzzyBASIC intermediate code spec (ref/fuzzybasic-git/doc/intermediate_code_spec.md)
 * に準拠した JS トークナイザ。
 *
 * RSVTBL の出現順は検索セマンティクスに影響するため厳密に維持する。
 */
(function() {
    'use strict';

    // ---- RSVTBL (検索順序が意味を持つ — 順序変更禁止) ----
    // [prefix, tokenNum, keyword]
    // keyword 中のスペースはマッチング時にスキップされる
    var RSVTBL = [
        [0xFE, 0x87, 'AUTO'],
        [0xFD, 0x9C, 'ADR('],
        [0xFC, 0x80, ' AND '],
        [0xFE, 0x84, 'APPEND'],
        [0xFF, 0xB8, 'BEEP '],
        [0xFB, 0x81, 'BIN('],
        [0xFF, 0xBB, 'BIN@ '],
        [0xFB, 0x82, 'BINL('],
        [0xFD, 0x94, 'BIT('],
        [0xFF, 0xBF, 'BLOAD '],
        [0xFF, 0xB3, 'BOOT'],
        [0xFF, 0xD2, 'BOX '],
        [0xFF, 0xB6, 'BROFF'],
        [0xFF, 0xB7, 'BRON'],
        [0xFF, 0xC0, 'BSAVE '],
        [0xFF, 0xB1, 'BYE'],
        [0xFE, 0x81, 'CONT'],
        [0xFF, 0xC5, 'CALL@ '],
        [0xFF, 0xC4, 'CALL '],
        [0xFF, 0xBE, 'CHAIN '],
        [0xFD, 0xA6, 'CHARA('],
        [0xFE, 0x8D, 'CHECK'],
        [0xFB, 0x80, 'CHR$('],
        [0xFF, 0xD3, 'CIRCLE '],
        [0xFF, 0x99, 'CLR'],
        [0xFF, 0xCE, 'CLEAR'],
        [0xFF, 0x98, 'CLS'],
        [0xFD, 0xA1, 'CODE('],
        [0xFF, 0xB2, 'COLD'],
        [0xFD, 0xAA, 'CP('],
        [0xFD, 0xAB, 'CP$('],
        [0xFF, 0xD4, '@PAINT '],
        [0xFF, 0xAC, 'CURSOR '],
        [0xFD, 0xA4, 'CURX'],
        [0xFD, 0xA5, 'CURY'],
        [0xFF, 0xD0, 'DIR '],
        [0xFB, 0x83, 'DECI('],
        [0xFF, 0x9D, 'DEC '],
        [0xFE, 0x88, 'DELETE'],
        [0xFF, 0xC1, 'DEVICE '],
        [0xFF, 0xCB, 'DEVI '],
        [0xFF, 0xCC, 'DEVO '],
        [0xFF, 0xD5, 'DOT '],
        [0xFD, 0xB7, 'DSK'],
        [0xFE, 0x92, 'EDIT'],
        [0xFF, 0x91, ' ELSE '],
        [0xFF, 0x92, 'END IF'],
        [0xFF, 0x9B, 'END'],
        [0xFE, 0x91, 'ERMODE'],
        [0xFD, 0x82, 'EX('],
        [0xFF, 0x81, 'FOR '],
        [0xFF, 0xCF, 'FILES '],
        [0xFD, 0x9B, 'FLASH'],
        [0xFF, 0xCA, 'FRESET '],
        [0xFF, 0xC9, 'FSET '],
        [0xFD, 0xA8, 'FUNC('],
        [0xFD, 0xBA, 'FN^A('],
        [0xFD, 0xBB, 'FN^B('],
        [0xFD, 0xBC, 'FN^C('],
        [0xFD, 0xBD, 'FN^D('],
        [0xFD, 0xBE, 'FN^E('],
        [0xFD, 0xBF, 'FN^F('],
        [0xFD, 0xC0, 'FN^G('],
        [0xFD, 0xC1, 'FN^H('],
        [0xFF, 0x89, ' GOTO '],
        [0xFF, 0x8A, ' GOSUB '],
        [0xFD, 0x9A, 'GET'],
        [0xFF, 0xD6, 'GRAPH '],
        [0xFB, 0x84, 'HEX2('],
        [0xFB, 0x85, 'HEX4('],
        [0xFF, 0xBC, 'HEX@ '],
        [0xFD, 0x80, 'HIGH('],
        [0xFF, 0x94, 'INPUT '],
        [0xFF, 0x8F, 'IF '],
        [0xFF, 0x9C, 'INC '],
        [0xFD, 0x99, 'INKEY'],
        [0xFD, 0x97, 'INP('],
        [0xFD, 0xAC, 'INSTR('],
        [0xFD, 0xAD, 'INSTR$('],
        [0xFF, 0xCD, 'KEY0 '],
        [0xFF, 0xC7, 'KILL '],
        [0xFF, 0xA3, 'LDIR '],
        [0xFF, 0xA4, 'LDDR '],
        [0xFD, 0xA9, 'LEN('],
        [0xFB, 0x86, 'LEFT$('],
        [0xFF, 0x80, 'LET '],
        [0xFF, 0xC3, 'LIMIT '],
        [0xFD, 0x9E, 'LINADR('],
        [0xFF, 0x95, 'LINPUT '],
        [0xFF, 0xD7, 'LINE '],
        [0xFE, 0x93, 'LMODE'],
        [0xFE, 0x82, 'LOAD'],
        [0xFF, 0xD1, 'LOCATE '],
        [0xFF, 0xC2, 'LOCAL '],
        [0xFD, 0x8F, 'LOG('],
        [0xFD, 0x81, 'LOW('],
        [0xFE, 0x85, 'MERGE '],
        [0xFD, 0x90, 'MAX('],
        [0xFD, 0xB5, 'MAX'],
        [0xFF, 0xB9, 'MEM '],
        [0xFD, 0x91, 'MIN('],
        [0xFD, 0x84, 'MIRROR('],
        [0xFF, 0xBD, 'MIRROR@ '],
        [0xFD, 0x89, 'MOD('],
        [0xFF, 0xB0, 'MON'],
        [0xFB, 0x88, 'MSG('],
        [0xFD, 0xA2, 'MSP'],
        [0xFB, 0x89, 'MSX('],
        [0xFD, 0x8A, 'MULH('],
        [0xFF, 0x84, 'NEXT '],
        [0xFD, 0xA7, 'NEST('],
        [0xFE, 0x8A, 'NEW'],
        [0xFD, 0x83, 'NOT('],
        [0xFD, 0x9D, 'NOW'],
        [0xFF, 0xA8, 'OUT '],
        [0xFF, 0x8E, 'ON '],
        [0xFC, 0x81, ' OR '],
        [0xFF, 0x97, 'PRINT '],
        [0xFF, 0xAE, 'PAUSE'],
        [0xFD, 0x93, 'PARITY('],
        [0xFF, 0xD8, '@AINT '],
        [0xFF, 0xD9, 'PALET '],
        [0xFD, 0x95, 'PEEK('],
        [0xFB, 0x8A, 'PN('],
        [0xFF, 0xA6, 'POKE '],
        [0xFD, 0xA0, 'POP'],
        [0xFD, 0xB9, 'POINT('],
        [0xFB, 0x8E, 'PR^A('],
        [0xFB, 0x8F, 'PR^B('],
        [0xFF, 0x96, 'PRMODE '],
        [0xFF, 0x8C, 'PROC '],
        [0xFF, 0xA2, 'PULL '],
        [0xFF, 0xA1, 'PUSH '],
        [0xFE, 0x80, 'RUN'],
        [0xFF, 0xC6, 'RANDOMIZE'],
        [0xFF, 0x8B, ' RETURN '],
        [0xFE, 0x8B, 'RECOVER'],
        [0xFE, 0x8E, 'RENUM'],
        [0xFF, 0xC8, 'RENAME '],
        [0xFF, 0x85, 'REPEAT'],
        [0xFF, 0xAB, 'RESET '],
        [0xFF, 0x93, 'RET FUNC '],
        [0xFF, 0x8D, 'RET PROC '],
        [0xFB, 0x8B, 'RIGHT$('],
        [0xFD, 0x92, 'RND('],
        [0xFD, 0x85, 'ROTL('],
        [0xFD, 0x86, 'ROTR('],
        [0xFD, 0x87, 'ROTLD('],
        [0xFD, 0x88, 'ROTRD('],
        [0xFF, 0x83, ' STEP '],
        [0xFE, 0x83, 'SAVE'],
        [0xFE, 0x8C, 'SEARCH'],
        [0xFF, 0xAA, 'SET '],
        [0xFD, 0xA3, 'SIZE'],
        [0xFB, 0x8C, 'SPC('],
        [0xFF, 0xDA, 'SPLINE '],
        [0xFD, 0x8D, 'SQR('],
        [0xFD, 0x8C, 'SQU('],
        [0xFF, 0x9A, 'STOP'],
        [0xFF, 0xB4, 'STOFF'],
        [0xFF, 0xB5, 'STON'],
        [0xFB, 0x8D, 'STRING('],
        [0xFF, 0xBA, 'STR '],
        [0xFD, 0x8E, 'SUM('],
        [0xFF, 0xA0, 'SWAP '],
        [0xFF, 0x90, ' THEN '],
        [0xFD, 0xB8, 'TABLE('],
        [0xFB, 0x87, 'TAB('],
        [0xFE, 0x89, 'TEXT'],
        [0xFD, 0x9F, 'TOP'],
        [0xFF, 0x82, ' TO '],
        [0xFF, 0xA5, 'TRANS '],
        [0xFD, 0xB0, 'TXBEGIN'],
        [0xFD, 0xB1, 'TXEND'],
        [0xFF, 0x86, 'UNTIL '],
        [0xFD, 0xAE, 'USR('],
        [0xFD, 0xAF, 'USR@('],
        [0xFF, 0xDC, 'USR^A '],
        [0xFF, 0xDD, 'USR^B '],
        [0xFF, 0xDE, 'USR^C '],
        [0xFF, 0xDF, 'USR^D '],
        [0xFF, 0xE0, 'USR^E '],
        [0xFF, 0xE1, 'USR^F '],
        [0xFF, 0xE2, 'USR^G '],
        [0xFF, 0xE3, 'USR^H '],
        [0xFE, 0x8F, 'VLIST'],
        [0xFD, 0xB4, 'VAL('],
        [0xFD, 0xB6, 'VERSION'],
        [0xFD, 0xB3, 'VEADR'],
        [0xFD, 0xB2, 'VSADR'],
        [0xFE, 0x90, 'VSTACK'],
        [0xFF, 0x87, 'WHILE '],
        [0xFF, 0xAF, 'WAIT '],
        [0xFF, 0x9F, 'WDEC '],
        [0xFF, 0x88, 'WEND'],
        [0xFF, 0xAD, 'WIDTH '],
        [0xFF, 0x9E, 'WINC '],
        [0xFD, 0x98, 'WINP('],
        [0xFF, 0xDB, 'WINDOW '],
        [0xFF, 0xA9, 'WOUT '],
        [0xFD, 0x96, 'WPEEK('],
        [0xFF, 0xA7, 'WPOKE '],
        [0xFC, 0x82, ' XOR '],
        [0xFD, 0x8B, 'ZERO('],
        [0xFD, 0xC2, 'COS('],
        [0xFD, 0xC3, 'SIN('],
        [0xFD, 0xC4, 'PAI('],
        [0xFF, 0xE4, 'TILE '],
        [0xFF, 0xE5, 'TRIANGLE '],
        [0xFF, 0xE6, 'MAGIC '],
        [0xFF, 0xE7, 'COLOR '],
        [0xFF, 0xE8, 'PCGDEF '],
        [0xFF, 0xE9, 'TCOLOR '],
        [0xFF, 0xEA, 'SOUND ']
    ];

    // ---- ヘルパー ----
    function cap(ch) {
        if (ch >= 0x61 && ch <= 0x7A) return ch - 0x20;
        return ch;
    }
    function isAlpha(ch) {
        return (ch >= 0x41 && ch <= 0x5A) || (ch >= 0x61 && ch <= 0x7A);
    }
    function isAlphaNum(ch) {
        return isAlpha(ch) || (ch >= 0x30 && ch <= 0x39);
    }

    // ---- RSVTBL 検索 ----
    // テーブル側のスペースをスキップしつつ case-insensitive 比較
    // ピリオド (.) でキーワード残りをスキップ (省略記法)
    function matchKeyword(input, ipos, keyword) {
        var ip = ipos;
        var kp = 0;
        while (kp < keyword.length) {
            var kch = keyword.charCodeAt(kp);
            if (kch === 0x20) { kp++; continue; }  // テーブル側スペーススキップ
            if (ip >= input.length) return -1;
            var ich = input[ip];
            if (ich === 0x2E) return ip + 1;  // '.' 省略記法 — マッチ成功
            if (cap(ich) !== cap(kch)) return -1;
            ip++; kp++;
        }
        return ip;
    }

    function searchRsvtbl(input, ipos) {
        for (var i = 0; i < RSVTBL.length; i++) {
            var entry = RSVTBL[i];
            var end = matchKeyword(input, ipos, entry[2]);
            if (end >= 0) {
                return { prefix: entry[0], token: entry[1], endPos: end };
            }
        }
        return null;
    }

    // ---- 1行トークナイズ ----
    function tokenizeLine(lineText) {
        // 入力をバイト配列に変換 (ASCII 前提)
        var input = [];
        for (var ci = 0; ci < lineText.length; ci++) {
            input.push(lineText.charCodeAt(ci));
        }

        var output = [];
        var ix = 0;

        // 1. 行頭スペース処理
        var spaceCount = 0;
        while (ix < input.length && input[ix] === 0x20) { spaceCount++; ix++; }
        if (spaceCount >= 2) {
            output.push(Math.min(spaceCount - 1, 0x1F));
        }

        // 2. メインループ
        while (ix < input.length) {
            var ch = input[ix];

            // 省略記法
            if (ch === 0x3F) {
                // ? → PRINT
                output.push(0xFF); output.push(0x97);
                ix++;
            } else if (ch === 0x21) {
                // ! → GOSUB
                output.push(0xFF); output.push(0x8A);
                ix++;
            } else if (ch === 0x23) {
                // # → PROC
                output.push(0xFF); output.push(0x8C);
                ix++;
            } else if (isAlpha(ch) || ch === 0x40) {
                // @ で始まるキーワード (@PAINT, @AINT) も検索対象
                var matched = searchRsvtbl(input, ix);
                if (matched) {
                    output.push(matched.prefix);
                    output.push(matched.token);
                    ix = matched.endPos;
                } else {
                    // 変数名等: 英数字をそのまま出力
                    while (ix < input.length && isAlphaNum(input[ix])) {
                        output.push(input[ix]);
                        ix++;
                    }
                }
            } else if (ch === 0x22) {
                // 文字列: " ... "
                output.push(ch); ix++;
                while (ix < input.length && input[ix] !== 0x22) {
                    output.push(input[ix]); ix++;
                }
                if (ix < input.length && input[ix] === 0x22) {
                    output.push(0x22); ix++;
                }
            } else if (ch === 0x27) {
                // コメント: ' → 行末まで
                output.push(ch); ix++;
                while (ix < input.length) {
                    output.push(input[ix]); ix++;
                }
            } else if (ch === 0x5C || ch === 0xA2) {
                // ラベル: \ ... \ or 0xA2 ... 0xA3
                output.push(ch); ix++;
                while (ix < input.length && input[ix] !== 0x5C && input[ix] !== 0xA3) {
                    output.push(input[ix]); ix++;
                }
                if (ix < input.length) { output.push(input[ix]); ix++; }
            } else if (ch === 0x20) {
                // キーワード間のスペースは消滅 (SPSKP)
                ix++;
            } else {
                // その他 (数値、演算子、: ; , ( ) + - * / < > = 等)
                output.push(ch);
                ix++;
            }

            // スペーススキップ (SPSKP)
            while (ix < input.length && input[ix] === 0x20) { ix++; }
        }

        return output;
    }

    // ---- プログラム全体トークナイズ ----
    function tokenizeProgram(sourceText) {
        var lines = sourceText.split('\n');
        var result = [];

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].replace(/\r$/, '');  // CR 除去
            if (line.length === 0) continue;

            // 行番号のパース
            var m = line.match(/^(\d+)\s?(.*)/);
            if (!m) continue;  // 行番号なし行はスキップ

            var lineNum = parseInt(m[1], 10);
            if (lineNum < 1 || lineNum > 65535) continue;

            var body = m[2];

            // 行番号 2-byte LE
            result.push(lineNum & 0xFF);
            result.push((lineNum >> 8) & 0xFF);

            // 本文をトークナイズ
            var tokens = tokenizeLine(body);
            for (var j = 0; j < tokens.length; j++) {
                result.push(tokens[j]);
            }

            // 行終端 0x00
            result.push(0x00);
        }

        // プログラム終端: 行番号 0x0000
        result.push(0x00);
        result.push(0x00);

        return new Uint8Array(result);
    }

    // ---- 公開 ----
    window.X1PenTokenizer = {
        tokenizeProgram: tokenizeProgram,
        tokenizeLine: tokenizeLine
    };
})();

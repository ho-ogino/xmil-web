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

    // ---- Unicode → X1 バイト変換テーブル ----
    // 値は number (1バイト) または number[] (複数バイト)
    var UNICODE_TO_X1 = {};

    // JIS X 0201 句読点・記号
    UNICODE_TO_X1[0x3002] = 0xA1;  // 。
    UNICODE_TO_X1[0x300C] = 0xA2;  // 「
    UNICODE_TO_X1[0x300D] = 0xA3;  // 」
    UNICODE_TO_X1[0x3001] = 0xA4;  // 、
    UNICODE_TO_X1[0x30FB] = 0xA5;  // ・

    // 全角カタカナ (清音)
    UNICODE_TO_X1[0x30F2] = 0xA6;  // ヲ
    UNICODE_TO_X1[0x30A1] = 0xA7;  // ァ
    UNICODE_TO_X1[0x30A3] = 0xA8;  // ィ
    UNICODE_TO_X1[0x30A5] = 0xA9;  // ゥ
    UNICODE_TO_X1[0x30A7] = 0xAA;  // ェ
    UNICODE_TO_X1[0x30A9] = 0xAB;  // ォ
    UNICODE_TO_X1[0x30E3] = 0xAC;  // ャ
    UNICODE_TO_X1[0x30E5] = 0xAD;  // ュ
    UNICODE_TO_X1[0x30E7] = 0xAE;  // ョ
    UNICODE_TO_X1[0x30C3] = 0xAF;  // ッ
    UNICODE_TO_X1[0x30FC] = 0xB0;  // ー
    UNICODE_TO_X1[0x30A2] = 0xB1;  // ア
    UNICODE_TO_X1[0x30A4] = 0xB2;  // イ
    UNICODE_TO_X1[0x30A6] = 0xB3;  // ウ
    UNICODE_TO_X1[0x30A8] = 0xB4;  // エ
    UNICODE_TO_X1[0x30AA] = 0xB5;  // オ
    UNICODE_TO_X1[0x30AB] = 0xB6;  // カ
    UNICODE_TO_X1[0x30AD] = 0xB7;  // キ
    UNICODE_TO_X1[0x30AF] = 0xB8;  // ク
    UNICODE_TO_X1[0x30B1] = 0xB9;  // ケ
    UNICODE_TO_X1[0x30B3] = 0xBA;  // コ
    UNICODE_TO_X1[0x30B5] = 0xBB;  // サ
    UNICODE_TO_X1[0x30B7] = 0xBC;  // シ
    UNICODE_TO_X1[0x30B9] = 0xBD;  // ス
    UNICODE_TO_X1[0x30BB] = 0xBE;  // セ
    UNICODE_TO_X1[0x30BD] = 0xBF;  // ソ
    UNICODE_TO_X1[0x30BF] = 0xC0;  // タ
    UNICODE_TO_X1[0x30C1] = 0xC1;  // チ
    UNICODE_TO_X1[0x30C4] = 0xC2;  // ツ
    UNICODE_TO_X1[0x30C6] = 0xC3;  // テ
    UNICODE_TO_X1[0x30C8] = 0xC4;  // ト
    UNICODE_TO_X1[0x30CA] = 0xC5;  // ナ
    UNICODE_TO_X1[0x30CB] = 0xC6;  // ニ
    UNICODE_TO_X1[0x30CC] = 0xC7;  // ヌ
    UNICODE_TO_X1[0x30CD] = 0xC8;  // ネ
    UNICODE_TO_X1[0x30CE] = 0xC9;  // ノ
    UNICODE_TO_X1[0x30CF] = 0xCA;  // ハ
    UNICODE_TO_X1[0x30D2] = 0xCB;  // ヒ
    UNICODE_TO_X1[0x30D5] = 0xCC;  // フ
    UNICODE_TO_X1[0x30D8] = 0xCD;  // ヘ
    UNICODE_TO_X1[0x30DB] = 0xCE;  // ホ
    UNICODE_TO_X1[0x30DE] = 0xCF;  // マ
    UNICODE_TO_X1[0x30DF] = 0xD0;  // ミ
    UNICODE_TO_X1[0x30E0] = 0xD1;  // ム
    UNICODE_TO_X1[0x30E1] = 0xD2;  // メ
    UNICODE_TO_X1[0x30E2] = 0xD3;  // モ
    UNICODE_TO_X1[0x30E4] = 0xD4;  // ヤ
    UNICODE_TO_X1[0x30E6] = 0xD5;  // ユ
    UNICODE_TO_X1[0x30E8] = 0xD6;  // ヨ
    UNICODE_TO_X1[0x30E9] = 0xD7;  // ラ
    UNICODE_TO_X1[0x30EA] = 0xD8;  // リ
    UNICODE_TO_X1[0x30EB] = 0xD9;  // ル
    UNICODE_TO_X1[0x30EC] = 0xDA;  // レ
    UNICODE_TO_X1[0x30ED] = 0xDB;  // ロ
    UNICODE_TO_X1[0x30EF] = 0xDC;  // ワ
    UNICODE_TO_X1[0x30F3] = 0xDD;  // ン
    UNICODE_TO_X1[0x309B] = 0xDE;  // ゛
    UNICODE_TO_X1[0x309C] = 0xDF;  // ゜

    // 全角カタカナ (濁音) → 2バイト展開
    UNICODE_TO_X1[0x30AC] = [0xB6, 0xDE];  // ガ
    UNICODE_TO_X1[0x30AE] = [0xB7, 0xDE];  // ギ
    UNICODE_TO_X1[0x30B0] = [0xB8, 0xDE];  // グ
    UNICODE_TO_X1[0x30B2] = [0xB9, 0xDE];  // ゲ
    UNICODE_TO_X1[0x30B4] = [0xBA, 0xDE];  // ゴ
    UNICODE_TO_X1[0x30B6] = [0xBB, 0xDE];  // ザ
    UNICODE_TO_X1[0x30B8] = [0xBC, 0xDE];  // ジ
    UNICODE_TO_X1[0x30BA] = [0xBD, 0xDE];  // ズ
    UNICODE_TO_X1[0x30BC] = [0xBE, 0xDE];  // ゼ
    UNICODE_TO_X1[0x30BE] = [0xBF, 0xDE];  // ゾ
    UNICODE_TO_X1[0x30C0] = [0xC0, 0xDE];  // ダ
    UNICODE_TO_X1[0x30C2] = [0xC1, 0xDE];  // ヂ
    UNICODE_TO_X1[0x30C5] = [0xC2, 0xDE];  // ヅ
    UNICODE_TO_X1[0x30C7] = [0xC3, 0xDE];  // デ
    UNICODE_TO_X1[0x30C9] = [0xC4, 0xDE];  // ド
    UNICODE_TO_X1[0x30D0] = [0xCA, 0xDE];  // バ
    UNICODE_TO_X1[0x30D3] = [0xCB, 0xDE];  // ビ
    UNICODE_TO_X1[0x30D6] = [0xCC, 0xDE];  // ブ
    UNICODE_TO_X1[0x30D9] = [0xCD, 0xDE];  // ベ
    UNICODE_TO_X1[0x30DC] = [0xCE, 0xDE];  // ボ
    UNICODE_TO_X1[0x30F4] = [0xB3, 0xDE];  // ヴ

    // 全角カタカナ (半濁音) → 2バイト展開
    UNICODE_TO_X1[0x30D1] = [0xCA, 0xDF];  // パ
    UNICODE_TO_X1[0x30D4] = [0xCB, 0xDF];  // ピ
    UNICODE_TO_X1[0x30D7] = [0xCC, 0xDF];  // プ
    UNICODE_TO_X1[0x30DA] = [0xCD, 0xDF];  // ペ
    UNICODE_TO_X1[0x30DD] = [0xCE, 0xDF];  // ポ

    // 半角カタカナ (JIS X 0201 1:1)
    UNICODE_TO_X1[0xFF61] = 0xA1;  // ｡
    UNICODE_TO_X1[0xFF62] = 0xA2;  // ｢
    UNICODE_TO_X1[0xFF63] = 0xA3;  // ｣
    UNICODE_TO_X1[0xFF64] = 0xA4;  // ､
    UNICODE_TO_X1[0xFF65] = 0xA5;  // ･
    UNICODE_TO_X1[0xFF66] = 0xA6;  // ｦ
    UNICODE_TO_X1[0xFF67] = 0xA7;  // ｧ
    UNICODE_TO_X1[0xFF68] = 0xA8;  // ｨ
    UNICODE_TO_X1[0xFF69] = 0xA9;  // ｩ
    UNICODE_TO_X1[0xFF6A] = 0xAA;  // ｪ
    UNICODE_TO_X1[0xFF6B] = 0xAB;  // ｫ
    UNICODE_TO_X1[0xFF6C] = 0xAC;  // ｬ
    UNICODE_TO_X1[0xFF6D] = 0xAD;  // ｭ
    UNICODE_TO_X1[0xFF6E] = 0xAE;  // ｮ
    UNICODE_TO_X1[0xFF6F] = 0xAF;  // ｯ
    UNICODE_TO_X1[0xFF70] = 0xB0;  // ｰ
    UNICODE_TO_X1[0xFF71] = 0xB1;  // ｱ
    UNICODE_TO_X1[0xFF72] = 0xB2;  // ｲ
    UNICODE_TO_X1[0xFF73] = 0xB3;  // ｳ
    UNICODE_TO_X1[0xFF74] = 0xB4;  // ｴ
    UNICODE_TO_X1[0xFF75] = 0xB5;  // ｵ
    UNICODE_TO_X1[0xFF76] = 0xB6;  // ｶ
    UNICODE_TO_X1[0xFF77] = 0xB7;  // ｷ
    UNICODE_TO_X1[0xFF78] = 0xB8;  // ｸ
    UNICODE_TO_X1[0xFF79] = 0xB9;  // ｹ
    UNICODE_TO_X1[0xFF7A] = 0xBA;  // ｺ
    UNICODE_TO_X1[0xFF7B] = 0xBB;  // ｻ
    UNICODE_TO_X1[0xFF7C] = 0xBC;  // ｼ
    UNICODE_TO_X1[0xFF7D] = 0xBD;  // ｽ
    UNICODE_TO_X1[0xFF7E] = 0xBE;  // ｾ
    UNICODE_TO_X1[0xFF7F] = 0xBF;  // ｿ
    UNICODE_TO_X1[0xFF80] = 0xC0;  // ﾀ
    UNICODE_TO_X1[0xFF81] = 0xC1;  // ﾁ
    UNICODE_TO_X1[0xFF82] = 0xC2;  // ﾂ
    UNICODE_TO_X1[0xFF83] = 0xC3;  // ﾃ
    UNICODE_TO_X1[0xFF84] = 0xC4;  // ﾄ
    UNICODE_TO_X1[0xFF85] = 0xC5;  // ﾅ
    UNICODE_TO_X1[0xFF86] = 0xC6;  // ﾆ
    UNICODE_TO_X1[0xFF87] = 0xC7;  // ﾇ
    UNICODE_TO_X1[0xFF88] = 0xC8;  // ﾈ
    UNICODE_TO_X1[0xFF89] = 0xC9;  // ﾉ
    UNICODE_TO_X1[0xFF8A] = 0xCA;  // ﾊ
    UNICODE_TO_X1[0xFF8B] = 0xCB;  // ﾋ
    UNICODE_TO_X1[0xFF8C] = 0xCC;  // ﾌ
    UNICODE_TO_X1[0xFF8D] = 0xCD;  // ﾍ
    UNICODE_TO_X1[0xFF8E] = 0xCE;  // ﾎ
    UNICODE_TO_X1[0xFF8F] = 0xCF;  // ﾏ
    UNICODE_TO_X1[0xFF90] = 0xD0;  // ﾐ
    UNICODE_TO_X1[0xFF91] = 0xD1;  // ﾑ
    UNICODE_TO_X1[0xFF92] = 0xD2;  // ﾒ
    UNICODE_TO_X1[0xFF93] = 0xD3;  // ﾓ
    UNICODE_TO_X1[0xFF94] = 0xD4;  // ﾔ
    UNICODE_TO_X1[0xFF95] = 0xD5;  // ﾕ
    UNICODE_TO_X1[0xFF96] = 0xD6;  // ﾖ
    UNICODE_TO_X1[0xFF97] = 0xD7;  // ﾗ
    UNICODE_TO_X1[0xFF98] = 0xD8;  // ﾘ
    UNICODE_TO_X1[0xFF99] = 0xD9;  // ﾙ
    UNICODE_TO_X1[0xFF9A] = 0xDA;  // ﾚ
    UNICODE_TO_X1[0xFF9B] = 0xDB;  // ﾛ
    UNICODE_TO_X1[0xFF9C] = 0xDC;  // ﾜ
    UNICODE_TO_X1[0xFF9D] = 0xDD;  // ﾝ
    UNICODE_TO_X1[0xFF9E] = 0xDE;  // ﾞ
    UNICODE_TO_X1[0xFF9F] = 0xDF;  // ﾟ

    // Unicode 記号 → X1 特殊文字 (直接入力可能なもの)
    UNICODE_TO_X1[0x00A5] = 0x5C;  // ¥
    UNICODE_TO_X1[0x2500] = 0x90;  // ─ box_h
    UNICODE_TO_X1[0x2502] = 0x91;  // │ box_v
    UNICODE_TO_X1[0x2534] = 0x92;  // ┴ box_up
    UNICODE_TO_X1[0x252C] = 0x93;  // ┬ box_down
    UNICODE_TO_X1[0x2524] = 0x94;  // ┤ box_left
    UNICODE_TO_X1[0x251C] = 0x95;  // ├ box_right
    UNICODE_TO_X1[0x253C] = 0x96;  // ┼ box_cross
    UNICODE_TO_X1[0x2510] = 0x97;  // ┐ box_tr
    UNICODE_TO_X1[0x2518] = 0x98;  // ┘ box_br
    UNICODE_TO_X1[0x2514] = 0x99;  // └ box_bl
    UNICODE_TO_X1[0x250C] = 0x9A;  // ┌ box_tl
    UNICODE_TO_X1[0x00D7] = 0xE8;  // × cross
    UNICODE_TO_X1[0x571F] = 0xF1;  // 土
    UNICODE_TO_X1[0x91D1] = 0xF2;  // 金
    UNICODE_TO_X1[0x6728] = 0xF3;  // 木
    UNICODE_TO_X1[0x6C34] = 0xF4;  // 水
    UNICODE_TO_X1[0x706B] = 0xF5;  // 火
    UNICODE_TO_X1[0x6708] = 0xF6;  // 月
    UNICODE_TO_X1[0x65E5] = 0xF7;  // 日
    UNICODE_TO_X1[0x6642] = 0xF8;  // 時
    UNICODE_TO_X1[0x5206] = 0xF9;  // 分
    UNICODE_TO_X1[0x79D2] = 0xFA;  // 秒
    UNICODE_TO_X1[0x5E74] = 0xFB;  // 年
    UNICODE_TO_X1[0x5186] = 0xFC;  // 円
    UNICODE_TO_X1[0x4EBA] = 0xFD;  // 人
    UNICODE_TO_X1[0x751F] = 0xFE;  // 生
    UNICODE_TO_X1[0x3012] = 0xFF;  // 〒

    // ---- 名前付きエスケープ \{name} → X1 バイト ----
    var NAMED_ESCAPES = {
        // $80-$8F: 縦横フィル・斜線
        'vfill1': 0x80, 'vfill2': 0x81, 'vfill3': 0x82, 'vfill4': 0x83,
        'vfill5': 0x84, 'vfill6': 0x85, 'vfill7': 0x86, 'vfill8': 0x87,
        'hfill1': 0x88, 'hfill2': 0x89, 'hfill3': 0x8A, 'hfill4': 0x8B,
        'hfill5': 0x8C, 'hfill6': 0x8D, 'hfill7': 0x8E, 'diag_bl_tr': 0x8F,
        // $90-$9F: 罫線・角丸・斜線
        'box_h': 0x90, 'box_v': 0x91, 'box_up': 0x92, 'box_down': 0x93,
        'box_left': 0x94, 'box_right': 0x95, 'box_cross': 0x96,
        'box_tr': 0x97, 'box_br': 0x98, 'box_bl': 0x99, 'box_tl': 0x9A,
        'circle_tr': 0x9B, 'circle_bl': 0x9C, 'circle_br': 0x9D,
        'circle_tl': 0x9E, 'diag_tl_br': 0x9F,
        // $E0-$EF: 図形記号
        'circle_fill': 0xE0, 'circle': 0xE1, 'spade': 0xE2, 'heart': 0xE3,
        'diamond': 0xE4, 'club': 0xE5, 'diag_fill_br': 0xE6, 'diag_fill_bl': 0xE7,
        'cross': 0xE8, 'quad_tl': 0xE9, 'quad_bl': 0xEA, 'quad_tr': 0xEB,
        'quad_br': 0xEC, 'checker_bl_tr': 0xED, 'checker_tl_br': 0xEE, 'square': 0xEF,
        // $F0-$FF: 漢字・記号
        'gray': 0xF0, 'saturday': 0xF1, 'friday': 0xF2, 'thursday': 0xF3,
        'wednesday': 0xF4, 'tuesday': 0xF5, 'monday': 0xF6, 'sunday': 0xF7,
        'hour': 0xF8, 'minute': 0xF9, 'second': 0xFA, 'year': 0xFB,
        'yen': 0xFC, 'hito': 0xFD, 'sei': 0xFE, 'postal': 0xFF
    };

    // ---- Unicode → X1 バイト列変換 ----
    function convertToX1Bytes(lineText) {
        lineText = lineText.normalize('NFC');  // 結合濁点 → precomposed
        var output = [];
        var i = 0;
        while (i < lineText.length) {
            // エスケープ: \xNN (直接バイト) or \{name} (名前付き)
            if (lineText[i] === '\\' && i + 1 < lineText.length) {
                if (lineText[i+1] === 'x' && i + 3 < lineText.length) {
                    var hex = lineText.substring(i+2, i+4);
                    if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
                        output.push(parseInt(hex, 16));
                        i += 4;
                        continue;
                    }
                }
                if (lineText[i+1] === '{') {
                    var close = lineText.indexOf('}', i+2);
                    if (close >= 0) {
                        var name = lineText.substring(i+2, close).toLowerCase();
                        if (name in NAMED_ESCAPES) {
                            output.push(NAMED_ESCAPES[name]);
                            i = close + 1;
                            continue;
                        }
                    }
                }
            }
            var uc = lineText.charCodeAt(i);
            if (uc in UNICODE_TO_X1) {
                var mapped = UNICODE_TO_X1[uc];
                if (Array.isArray(mapped)) {
                    for (var mi = 0; mi < mapped.length; mi++) output.push(mapped[mi]);
                } else {
                    output.push(mapped);
                }
            } else if (uc <= 0x7F) {
                output.push(uc);
            } else {
                throw new Error('Unsupported character: ' + lineText[i] +
                    ' (U+' + uc.toString(16).toUpperCase() + ')' +
                    ' \u2014 use \\xNN or \\{name}');
            }
            i++;
        }
        return output;
    }

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
        // Unicode → X1 バイト列変換
        var input = convertToX1Bytes(lineText);

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

            // 本文をトークナイズ (エラー時は行番号付きで再throw)
            var tokens;
            try {
                tokens = tokenizeLine(body);
            } catch(e) {
                throw new Error('Line ' + lineNum + ': ' + e.message);
            }
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
        tokenizeLine: tokenizeLine,
        UNICODE_TO_X1: UNICODE_TO_X1,
        NAMED_ESCAPES: NAMED_ESCAPES
    };
})();

// x1pen_pcg_howto.js — the PCG tab's "使い方": how FuzzyBASIC and SLANG define PCG characters from
// what DEFCHR TOOL's "X1Pen に挿入" puts in (DB lines in the ASM tab, an ARRAY BYTE in the SLANG
// tab). HuBASIC gets DEFCHR$ lines, which need no example. x1pen.js shows these in a panel with a
// copy button each; docs/X1PEN.md has the same code (tests/defchrtool_test.mjs keeps them equal).
// The examples are for two characters, $41 and $42 (24 bytes each), and are run in X1Pen by
// tests/x1pen_automation_test.mjs. The SLANG one goes below the inserted array: pasted first, its
// PCG41 would make the inserted array PCG41_2.

(function(root) {
    'use strict';

    var examples = [
        {
            id: 'fuzzybasic',
            title: 'FuzzyBASIC',
            note: '出力先 FuzzyBASIC（ASM(x3)）で、ASM タブの ORG の下に入れます。ASM タブはアセンブルされて ' +
                'PROGRAM.BIN になり、BASIC から BLOAD で読みます。1 文字 24 バイトなので、2 文字目は $B018 です。',
            blocks: [
                { label: 'ASM タブ', code: '\tORG\t$B000\n; この下に「X1Pen に挿入」（出力先 FuzzyBASIC）\n' },
                {
                    label: 'BASIC タブ',
                    code: [
                        '10 LIMIT $AFFF',
                        '20 BLOAD "PROGRAM.BIN",$B000',
                        '30 PCGDEF 65,$B000',
                        '40 PCGDEF 66,$B018',
                        '50 WIDTH 40:TCOLOR $27',
                        '60 PRINT CHR$(65);CHR$(66)',
                        '70 TCOLOR 7',
                        ''
                    ].join('\n')
                }
            ]
        },
        {
            id: 'slang',
            title: 'SLANG',
            note: '先に、出力先 SLANG（BIN(x3)）で「X1Pen に挿入」します（関数の外に ARRAY BYTE PCG41[] = { … }; が入ります）。' +
                'その下にこれを貼ります。PCGDEFS で続けて定義し、表示するマスごとに TATTR で PCG を選んでから PRINT します。' +
                '同じ名前がもうあると PCG41_2 などになるので、そのときは PCGDEFS の名前も合わせてください。',
            blocks: [
                {
                    label: 'SLANG タブ',
                    code: [
                        '// この上に「X1Pen に挿入」（出力先 SLANG）で入れた配列',
                        'MAIN()',
                        '{',
                        '    WIDTH(40);',
                        '    PCGDEFS($41, PCG41, 2);',
                        '    LOCATE(0, 0);',
                        '    TATTR($27); PRINT(CHR$($41));',
                        '    TATTR($27); PRINT(CHR$($42), /);',
                        '}',
                        ''
                    ].join('\n')
                }
            ]
        }
    ];

    root.X1PenPcgHowto = {
        intro: 'DEFCHR TOOL の P の画面で入れたデータを、PCG として使うお手本です（$41・$42 の 2 文字を入れたとき。' +
            '文字の数と最初の文字コードに合わせて直してください）。HuBASIC は DEFCHR$ の行が入るので、そのまま使えます。',
        examples: examples
    };
})(typeof window !== 'undefined' ? window : globalThis);

# Third-Party Licenses

本プロジェクトは以下のサードパーティコードを使用しています。

---

## fm.c / ay8910.c (PSG・FM 音源エミュレーション)

**ファイル**: `src/OPMSOUND/fm.cpp`, `src/OPMSOUND/ay8910.cpp`

旧 MAME License（MAME プロジェクト 2003年以前のライセンス）の下で配布されています。
主な条件：非商用利用のみ・著作権表示の維持・無保証。

原文（ソースファイルヘッダーより）:

```
File: fm.c -- software implementation of FM sound generator
Copyright (C) 1998 Tatsuyuki Satoh, MultiArcadeMachineEmulator development
Version 0.37d

ay8910.c -- Emulation of the AY-3-8910 / YM2149 sound chip.
Based on various code snippets by Ville Hallik, Michael Cuddy,
Tatsuyuki Satoh, Fabrice Frances, Nicola Salmoria.
```

---

## chips z80.h (Z80 CPU エミュレーション)

**ファイル**: `platform/z80.h`
**ソース**: https://github.com/floooh/chips

zlib/libpng License の下で配布されています。

原文（z80.h:205-223 より）:

```
zlib/libpng license

Copyright (c) 2021 Andre Weissflog
This software is provided 'as-is', without any express or implied warranty.
In no event will the authors be held liable for any damages arising from the
use of this software.
Permission is granted to anyone to use this software for any purpose,
including commercial applications, and to alter it and redistribute it
freely, subject to the following restrictions:
    1. The origin of this software must not be misrepresented; you must not
    claim that you wrote the original software. If you use this software in a
    product, an acknowledgment in the product documentation would be
    appreciated but is not required.
    2. Altered source versions must be plainly marked as such, and must not
    be misrepresented as being the original software.
    3. This notice may not be removed or altered from any source
    distribution.
```

---

## X millennium (原作エミュレータ)

**著作者**: ぷにゅ氏 / T_tune 改変版

フリーウェア・非商用・無保証の条件で頒布されています。
原作の頒布条件を継承します。

**サウンドエフェクト**: `FDDSEEK.WAV`, `FDDSEEK1.WAV`, `CMTSTOP.WAV`, `CMTPLAY.WAV`, `CMTEJECT.WAV`, `CMTFF.WAV`
原作 X millennium 配布物に含まれる効果音ファイルです。同条件で頒布されています。

---

## X1 BASIC Editor (X1Pen の HuBASIC タブ)

**ファイル**: `assets/x1basic/`（公開先 `x1basic/`）
**ソース**: https://github.com/ho-ogino/x1-basic-editor （取り込んだコミットは `assets/x1basic/source.json`）

MIT License の下で配布されています。X1Pen が足したのは、`src/index.html` の 1 行（X1Pen 用のつなぎ `x1pen-host.js` を読む）だけです。

```
MIT License

Copyright (c) 2026 Hiroshi OGINO

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## X1 互換フォント / 美咲フォント（X1 BASIC Editor の内蔵字形）

**ファイル**: `assets/x1basic/assets/x1-basic.ttf` / `x1-font.json`（エディタの repo の `assets/x1-font-source.txt` から作られたもの）
**ソース**: Meister 氏の X1 互換フォント https://github.com/meister68k/X1_compatible_font （`FNT0808.X1`、取得元と SHA-256 は `assets/x1basic/assets/x1-font-provenance.json`）
**元の字形**: 門真 なむ氏「8×8 ドット日本語フォント『美咲フォント』」https://littlelimit.net/misaki.htm

改変の有無、商用・非商用を問わず、利用・複製・再配布が許されています（無保証）。全文は `assets/x1basic/assets/licenses/misaki.txt`（公開先 `x1basic/assets/licenses/misaki.txt`）、詳細は `assets/x1basic/THIRD-PARTY-NOTICES.md` にあります。

```
These fonts are free softwares.
Unlimited permission is granted to use, copy, and distribute it, with or without modification, either commercially and noncommercially.
THESE FONTS ARE PROVIDED "AS IS" WITHOUT WARRANTY.

Copyright(C) 2002-2019 Num Kadoma
```

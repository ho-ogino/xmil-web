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

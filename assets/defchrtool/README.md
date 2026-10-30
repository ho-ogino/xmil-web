# DEFCHR TOOL for Web

1980年代のSHARP X1用PCGエディタ「DEFCHR TOOL」をWebブラウザで再現したツールです。

## 概要

DEFCHR TOOLは、SHARP X1のシステムディスクに収録されていたPCG（Programmable Character Generator）エディタです。PCGとは、テキスト文字に任意の8x8ドット・8色のグラフィックキャラクターを割り当てる機能で、本ツールはそのPCG画像を編集するためのグラフィックエディタです。

- 256種類のキャラクター（0x00〜0xFF）を編集可能
- 8色（黒、青、赤、マゼンタ、緑、シアン、黄、白）に対応
- オリジナルのX1版と同様の操作感を再現

## デモ

[DEFCHR TOOL for Web](https://h-o-soft.github.io/defchrtool/) （GitHub Pages）

## 使い方

### 画面構成

- **左側**: 編集エリア（16x16ドット = 2x2文字分）
- **右側**: 定義エリア（256文字の一覧表示）
- **下部**: メニュー表示
- **右下**: プレビュー（実寸表示）

### 基本操作

| キー | 機能 |
|------|------|
| `0`〜`7` | 指定した色でドットを描画（キーボードモード時） |
| `↑` `↓` `←` `→` | カーソル移動 |
| `Shift` + 矢印 | 2ドット単位で移動 |
| `Space` | トグル描画（色があれば消す、なければ現在の色で描画） |
| `Home` | カーソルをホーム位置（左上）に移動 |

### 編集モード（Mキー）

編集エリア（16x16ドット）をどのように扱うかを設定します。

| モード | 説明 |
|--------|------|
| 4Chr.ベツベツ | 4文字を独立して編集 |
| タテ2Chr. | 縦2文字を1組として編集 |
| ヨコ2Chr. | 横2文字を1組として編集 |
| 4Chr.スベテ | 4文字を1つの16x16画像として編集 |

### キャラクター操作

| キー | 機能 |
|------|------|
| `E` | **EDIT CHR.** - ROMフォントまたはPCGデータを編集エリアに読み込み |
| `S` | **SET CHR.** - 編集エリアの内容を指定した文字コードに定義 |
| `C` | **COLOR CHANGE** - 編集エリア内の色を一括変換 |
| `R` | **ROTATION** - 移動、回転、フリップ |
| `T` | **TRANSFER** - 定義エリア内の文字をコピー |
| `Ctrl+L` | **CLR** - 編集エリアをクリア |

### EDIT CHR.（Eキー）

1. `0` (ROMCG) または `1` (RAMCG) を選択
2. 文字コードを16進数で入力（例: `41` = 'A'）
3. 選択したソースから編集エリアにデータが読み込まれる

### SET CHR.（Sキー）

1. 文字コードを16進数で入力
2. 編集エリアの内容が指定した文字コードに定義される
3. 編集モードに応じて1〜4文字分が定義される

### ROTATION（Rキー）

| 番号 | 機能 |
|------|------|
| `0` | 右方向に1ドット移動（循環） |
| `1` | 左方向に1ドット移動（循環） |
| `2` | 上方向に1ドット移動（循環） |
| `3` | 下方向に1ドット移動（循環） |
| `4` | 90度反時計回り回転 |
| `5` | 180度回転 |
| `6` | 上下フリップ |
| `7` | 左右フリップ |

※ 4、5は「タテ2Chr.」「ヨコ2Chr.」モードでは無効

### COLOR CHANGE（Cキー）

編集エリア内の色を一括変換します。

1. 8つの入力欄が表示される（0〜7）
2. 各入力欄に変換先の色番号を入力
3. Enterで実行（色変換は同時に行われる）

例: 入力欄1を「2」、入力欄2を「3」に設定すると、色1は色2に、色2は色3に変換される

### TRANSFER（Tキー）

定義エリア内の文字を別の位置にコピーします。

- `S`: 開始文字コード
- `E`: 終了文字コード
- `T`: 転送先文字コード

例: S=60, E=61, T=63 → 0x60〜0x61の2文字を0x63〜0x64にコピー

### ファイル操作（Pキー）

#### 対応フォーマット

| フォーマット | 保存 | 読込 | 説明 |
|-------------|:----:|:----:|------|
| PNG | ○ | ○ | 全256文字を128x128画像として保存 |
| BIN | ○ | ○ | バイナリ形式（BRG順、24バイト/文字） |
| BIN(x3) | ○ | ○ | 三倍速定義フォーマット |
| BAS | ○ | ○ | BASIC ASCII形式（DEFCHR$文） |
| ASM | ○ | — | 面ごとに並ぶDB文 |
| ASM(x3) | ○ | — | 行ごとのB/R/G順に並ぶDB文 |

#### 操作手順

1. `P`キーでPROGRAMMINGパネルを表示
2. フォーマットを選択（IMAGE / BIN / BIN(x3) / BAS / ASM / ASM(x3)）
3. SAVE / LOAD を選択
4. 範囲を指定（PNG以外）
5. EXECボタンで実行

#### BASファイルの読み込みモード

- **From START**: 指定した開始コードから連続して読み込み
- **As defined**: ファイル内のDEFCHR$()のコードをそのまま使用

### その他の機能

| キー | 機能 |
|------|------|
| `G` | グリッド表示切り替え |
| `D` | カーソル移動方向の切り替え |
| `K` | キーボード/マウスモード切り替え |

### マウスモード（Kキー）

- **キーボードモード（KB）**: 数字キーでドットを描画
- **マウスモード（MS）**: 数字キーは色選択のみ、マウスクリック/ドラッグで描画

画面下部に現在のモード（KB/MS）とカレントカラー（COL=N）が表示されます。

### データの自動保存

編集データはブラウザのローカルストレージに自動保存されます。ページをリロードしても編集内容が保持されます。

### X1Pen への挿入

X1Pen 内で起動した場合、PROGRAMMING の SAVE に「保存先」と「出力先」が表示されます。
「X1Pen に挿入」を選び、FuzzyBASIC / ASM / SLANG / HuBASIC の出力先を明示的に選んでください。
選択すると推奨形式に切り替わります。形式はその後も手動変更できます。

| 出力先 | 推奨形式 | 挿入先 |
| --- | --- | --- |
| FuzzyBASIC | ASM(x3) | ASM タブ（PCGDEF で読むデータ） |
| ASM | ASM(x3) | ASM タブ |
| SLANG | BIN(x3) | SLANG タブの ARRAY BYTE |
| HuBASIC | BAS / ASC | HuBASIC タブの DEFCHR$ |

HuBASIC の開始行は60960、ステップは10が初期値です。最後の行番号は65529以下にしてください。
同じ行番号に同じ文字の DEFCHR$ がある場合は置き換え、それ以外の行との衝突は拒否します。
**HuBASIC への反映はエディタの Undo 履歴を消すため、Ctrl+Z では戻せません。** RETURN は追加しません。

「ファイル保存」を選ぶと従来の保存操作が使えます。単独の GitHub Pages では従来どおり動作します。
X1Pen と GitHub Pages の編集データはそれぞれの origin に保存され、自動共有されません。
送信エラー時には自動再送・自動ダウンロードをしません。応答がない場合は挿入先を確認したうえで
ページを再読み込みしてください（再読み込みは送信取消を保証しません）。

組込方法、形式の対応表、失敗時の契約は [X1HOST.md](X1HOST.md) を参照してください。

## 開発

### 必要環境

- Node.js 22.12以上
- npm

### セットアップ

```bash
git clone https://github.com/h-o-soft/defchrtool.git
cd defchrtool
npm install
```

### 開発サーバー起動

```bash
npm run dev
```

### ビルド

```bash
npm run build
```

ビルド結果は `dist/` ディレクトリに出力されます。

### 検証

```bash
npm test
npm run build
npm run test:browser
```

`npm test` はバイト順、行番号、ホストの受渡し・応答検証を確認します。
`test:browser` はローカルの Chrome を使い、単独保存・同一 origin の iframe・エラー復帰・保存復元を確認します。
追加の npm 依存は不要です。Chrome のパスは `CHROME_BIN` で指定できます（既定 `/usr/bin/google-chrome`）。
相対パス配布は `npx vite build --base ./ --outDir /tmp/defchrtool-relative` の後に
`npm run test:browser -- /tmp/defchrtool-relative` で同じ操作を確認できます。

## 技術仕様

- TypeScript + Vite
- Canvas 2D API（ダブルバッファリング）
- X1互換フォント使用
- フレームワークなし（Vanilla JS）

### PCGデータ形式

- 1文字 = 24バイト（B/R/Gプレーン各8バイト）
- 全256文字 = 6,144バイト

## クレジット

- オリジナル「DEFCHR TOOL」: SHARP X1システムディスク収録

### 使用フォント

同梱の `public/assets/fonts/X1font.png` は、次の X1互換フォント（美咲フォント由来）です。

- **X1互換フォント**: [meister68k/X1_compatible_font](https://github.com/meister68k/X1_compatible_font) by Meister氏
- **美咲フォント**: [littlelimit.net](https://littlelimit.net/misaki.htm) by 門真なむ氏

このフォントには、このリポジトリのコードの MIT ライセンスとは別に、美咲フォントの利用条件が適用されます。
詳細は[美咲フォントライセンス](https://littlelimit.net/font.htm#license)をご確認ください。

## 作成について

このプロジェクトは、SHARP X1用の「DEFCHR TOOL」の動作を参考にしつつ、元のソースコードは見ずに作成しました。
元のツールの作者とは関係のないプロジェクトです。

以下の MIT ライセンスは、このリポジトリのコードに適用します。元のツールや使用フォントのライセンスを示すものではありません。
フォントの利用条件は、上の「使用フォント」をご確認ください。
MIT の本文は以下と [LICENSE](LICENSE) に載せています。

## ライセンス

MIT License

Copyright (c) 2026 H.O SOFT

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

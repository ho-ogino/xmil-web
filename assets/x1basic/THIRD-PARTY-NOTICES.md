# 第三者の著作物とライセンス

X1 BASIC Editor 本体は MIT License です。以下のデータ・ライブラリは、それぞれのライセンスに従います。

## 内蔵X1互換フォント

`assets/x1-font-source.txt` と、それを変換した `assets/x1-font.json` / `assets/x1-basic.ttf` は、Meister氏のX1互換フォントを使用しています。

- 配布元：<https://github.com/meister68k/X1_compatible_font>
- 使用ファイル：`FNT0808.X1`
- 固定コミット：`0d96525cef8c1cf9e99a1f79130b0ab8a0cdbc93`
- 元の字形：門真 なむ氏の「8×8 ドット日本語フォント『美咲フォント』」<https://littlelimit.net/misaki.htm>
- Copyright(C) 2002-2019 Num Kadoma
- 著作権・利用許諾・無保証の全文：[`assets/licenses/misaki.txt`](assets/licenses/misaki.txt)

美咲フォントの利用条件は、改変の有無、商用・非商用を問わず利用・複製・再配布を許可し、無保証としています。X1互換フォントの配布元READMEも、フォント部分に美咲フォントの条件を適用すると明記しています。

本プロジェクトでの変更は、256文字×8行のビットマップをJSONおよびアプリ専用TrueTypeフォントへ変換する処理です。文字の並びやドットは変更していません。元の2048バイトのデータのSHA-256と取得元は `assets/x1-font-provenance.json` に記録しています。変換後のデータにも美咲フォントの利用条件が適用されます。

実機のCG-ROMや、利用者が読み込んだ個人用フォントデータは同梱していません。旧試作で参照していたX1Pen / DEFFNT.CPP由来の内蔵字形は、公開版には含めていません。

## Electron / Chromium / electron-builder / jsdom

これらと依存ライブラリは、それぞれのライセンスに従います。ソース利用時は `node_modules` 内のライセンス、ビルド済みファイルでは同梱される Electron / Chromium のライセンス表示を参照してください。

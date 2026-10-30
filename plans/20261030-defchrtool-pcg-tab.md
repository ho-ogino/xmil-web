# X1Pen に DEFCHR TOOL（PCG エディタ）のタブを載せる — 1 本目

## Purpose

ひろしさんが 2026-10-27 に挙げた「PCG エディタのタブを付けて、各 BASIC 側のエディタに出せるようにする」の 1 本目。上流 DEFCHR TOOL for Web（h-o-soft/defchrtool）は、X1Pen に出力を渡す口を PR #7〜#9 で足し、`07fa3388984be6476ff57bc6d8a2845426a20133` にマージ済み。X1Pen 側でこれを取り込み、タブとして載せる。

ひろしさんの決めごと（2026-10-30）:
- 出力の形の選択は defchrtool の今のまま。defchrtool に「出力先」（FuzzyBASIC / ASM / SLANG / HuBASIC）のコンボがあり、選ぶとおすすめの形になる。出す先はユーザーが明示的に選ぶ（今開いているタブから推測しない）。
- HuBASIC のときだけ行番号・ステップの欄。`RETURN` は足さない。
- 描いた絵はブラウザを閉じても残る（defchrtool 自身の localStorage）。キーボード操作は今のまま。
- 逆向き（プログラム → defchrtool）は後。

**この PR でやること（Secretary の指示どおり）**:
1. defchrtool を写すスクリプトと、写した一式（`assets/defchrtool/`）。
2. X1Pen の新しいタブ（iframe）として載せる。
3. ファイルへの書き出し（Firefox でも保存できるように、X1Pen のページで保存する）。
4. SLANG・ASM・FuzzyBASIC（ASM タブ）への流し込み（`exportPCG` の実装）。
5. キャッシュバスター（`?v=<commit>`）を defchrtool の資産にも付ける。

**やらないこと**:
- HuBASIC の行番号での差し込み（2 本目の PR）。この PR では `target: 'hubasic'` に `unsupported` を返し、何も変えない。
- クリップボードへのコピー。合意した口（`exportPCG`）は挿入だけで、defchrtool に「コピー」を選ぶ UI が無い。defchrtool に口（`copyPCG`）を Secretary 経由で頼んだ。口ができたら別の PR で入れる。
- 逆向きの読み込み、PCGDEF 呼び出しやアドレスの生成、版上げ、本番（Cloudflare Pages・npm）への反映、上流 defchrtool の変更。
- モバイルのタブ（下の Open decisions 1）。

## Observed evidence

### defchrtool 07fa338（scratch に clone して読んだ・ビルドした）

1. `X1HOST.md`（上流の契約）:
   - ホストは子 iframe の**最初の module script より前に同期スクリプト**を置き、その子の `window.X1Host = { exportPCG }` を設定する。defchrtool は自分の window だけを見る（親は探さない）。
   - X1Pen は commit を固定し、`npm ci` → `npx vite build --base ./` でビルドする。資産一式・LICENSE・README.md・source.json（commit と sha256）を `assets/defchrtool/` に入れ、`dist/defchrtool/`、同じ origin の `/defchrtool/index.html` に置く。README.md の MIT 節を参照し、フォントの利用条件の参照も残す。
   - ホストはタブを初めて開いたときに iframe を一度作り、切り替えでは隠すだけ。表示時に iframe にフォーカスを渡し、挿入に成功したら実際の出力先タブに切り替える。
   - 型（`src/host/X1Host.ts`）:
     ```ts
     interface PCGExportRequest {
       version: 1;
       target: 'fuzzybasic' | 'asm' | 'slang' | 'hubasic';
       format: 'image' | 'bin' | 'bin3' | 'bas' | 'asm' | 'asm3';
       basFormat?: 'asc' | 'bin';
       start: number; end: number;          // inclusive, 0..255
       fileName: string;
       blob: Blob;
       hubasic?: { lineStart: number; lineStep: number };
     }
     type PCGExportResult =
       | { ok: true; insertedInto: 'asm' | 'slang' | 'hubasic'; message?: string }
       | { ok: false; code: 'unsupported' | 'invalid' | 'conflict' | 'unavailable'; message: string };
     ```
   - defchrtool は結果を形で確かめる（`ok:true` は `insertedInto` が期待先〔fuzzybasic→asm〕と一致し、`message` が無いか文字列のときだけ。`ok:false` は 4 つの code と文字列 message のときだけ）。それ以外・例外は「反映状況を確認」表示。自動再送・自動ダウンロードはしない。待機中は EXEC・CANCEL・Esc が無効。
   - 対応表（契約）:

     | 手動選択 | fuzzybasic / asm | slang | hubasic |
     | --- | --- | --- | --- |
     | asm / asm3 | テキストを ASM へそのまま | テキストをそのまま | 非対応 |
     | bas / asc | テキストをそのまま | テキストをそのまま | DEFCHR$ 行（2 本目） |
     | bin / bin3 | ホストで DB 数値列へ | ホストで ARRAY BYTE へ | 非対応 |
     | bas / bin、image | 非対応 | 非対応 | 非対応 |

     BIN は面順（B[8],R[8],G[8]）、BIN(x3) は行順（B0,R0,G0,…,B7,R7,G7）のまま。ホストで並べ替えない。1 文字 24 バイト、start..end の昇順。
   - SLANG の構文と名前はホスト。例 `ARRAY BYTE PCG41[] = { … };`、ぶつかったら `_2` 等、1 文字 1 行、`// $41` を付ける。
   - ホストは確認ダイアログで止めず Promise を必ず決着させる。RUN 中・自動操作中は `unavailable`。`ok:false` は何も変えなかったときだけ。部分書き込みはしない。`message` は利用者向けの日本語で、defchrtool が textContent で出す。
2. `src/main.ts` の `handleFileSave`: host への配信でないとき（「ファイル保存」）は `downloadBlob(blob, fileName)`:
   ```ts
   const url = URL.createObjectURL(blob);
   const a = document.createElement('a'); a.href = url; a.download = fileName;
   a.click();                       // document には付けない
   URL.revokeObjectURL(url);        // click の直後に同期で破棄
   ```
   上流には、ファイル保存をホストに任せる口は無い。
3. `npm ci`（Node v24.19.0 / npm 12.0.2。npm 12 は esbuild の postinstall を走らせないが、ビルドは通った）→ `npx vite build --base ./` の出力は 3 ファイル:
   - `dist/index.html`（17,304 B。CSS はインライン。外部 URL なし。`<script type="module" crossorigin src="./assets/index-K3VHm9yx.js"></script>` が 1 つだけ。CSP の meta なし）
   - `dist/assets/index-<hash>.js`（74 KB、名前にハッシュ）
   - `dist/assets/fonts/X1font.png`（2,480 B、`public/` から。名前にハッシュなし）。JS の中は `loadFont("./assets/fonts/X1font.png")`（文書からの相対）。
4. キー: `KeyboardInputHandler` は `window.addEventListener('keydown', …)`。iframe にフォーカスがあれば効く。描いた絵は localStorage の `defchr-pcgdata` / `defchr-editbuffer` / `defchr-state` / `defchr-fontdata`（X1Pen には `defchr` で始まるキーは無い）。
5. `LICENSE`（MIT、Copyright (c) 2026 H.O SOFT）が PR #8 で入った。README.md の「## ライセンス」節にも MIT 本文、「### 使用フォント」に X1font.png の出典（Meister 氏の X1 互換フォント、美咲フォント由来、美咲フォントの利用条件）。

### X1Pen（main 2ad62b6）

6. タブ: `html/x1pen.html` の `#editor-tabs` に `basic`（FuzzyBASIC）・`asm`・`slang`・`hubasic` の 4 つと、タブごとの操作ボタン（ASM/SLANG の Import、Manual、HuBASIC の Options、Charmap）。コンテナは `#<tab>-editor-container`、隠すときは `.hidden`（`display:flex; visibility:hidden; height:0`）。`html/x1pen.js` の `setActiveEditorTab(target)` が表示を切り替え、`hubasic` のときは `hubasicEditor.mount()`（初回だけ iframe を作る）。モバイルは `#mobile-tabs`（`switchMobilePanel`）。
7. RUN の対象は**タブではなく中身**で決まる（`inferSourceMode`: HuBASIC に中身 → hubasic、SLANG に中身 → slang、BASIC 空で ASM あり → asm、ほか basic+asm）。新しいタブは RUN の対象を変えない。
8. HuBASIC エディタの載せ方（手本）:
   - `scripts/import-x1-basic-editor.mjs`: git checkout の 1 commit から git object でファイルを読み、`src/index.html` に `<script src="x1pen-host.js"></script>` を 1 行差し込み、`assets/x1basic/source.json`（repository・commit・ファイルごとの sha256/size・injected）を書く。一時ディレクトリに作ってから rename。
   - `html/x1pen_x1basic_host.js` を build.sh が `x1basic/src/x1pen-host.js` として写す。親の `window.X1PenHuBasicEditorBridge` と話す（同じ origin、postMessage ではない）。
   - `createHuBasicEditor()` の `mount()` が `x1basic/src/index.html?v=<hash>` の iframe を作る。自動操作のロック中は `doc.body.inert = true`（`#editor-panel` の inert は iframe の文書に届かない）。
   - Firefox は iframe の中でクリックしたダウンロードリンク（blob:）を親ページの CSP `frame-src`（`default-src 'self'`）で止める（K4、`plans/20261029-hubasic-export-firefox.md`）。ひろしさんは「X1Pen のページでダウンロードを作る」（B）を選び、CSP は変えなかった。`bridge.download(data, name)` が親で `<a download>` を作る。
9. 挿入の手本: ASM の Import（`binaryToDbLines` → カーソル位置に `insertAt`、行の途中なら前に改行）、SLANG の Import（`binaryToSlangValues` → 値だけをカーソル位置に）。`src/x1pen_editor.js` のラッパーは `insertAt(pos, text)` が 1 回の `view.dispatch`。`view` も公開している。変更は `onChange` → `markProgramChanged()` と `persistEditorSource()`（localStorage）。ASM の onChange は `lastAsmTabOrigin = 'user'` にする。
10. RUN 中: `runAdmission`（`tryReserveRun` で作られ、終わると null）。自動操作のロック: `automationInteractionLocked`（`setAutomationInteractionLocked`）。
11. エディタにフォーカスが入るとエミュレータを止める（`pauseCallbacks.onFocus` → `_js_xmil_stop`、blur で再開）。HuBASIC の iframe は bridge の `focus()`/`blur()` で同じことをする。
12. 確かめたこと（X1Pen のコードで実際に動かした）:
    - defchrtool の ASM(x3) の形（タブ字下げの `DB $..,…`、`; CHR $41`）は `html/x1pen_z80asm.js` でそのまま通る（2 文字で 48 バイト、行ごとに B,R,G）。
    - `ARRAY BYTE PCG41[] = {` ＋ 1 文字 1 行（`$00,…,$27, // $41`）＋ `};` と `PCGDEF($41, PCG41);` は `html/x1pen_slang_compiler.js` でエラーなし、48 バイトの DB になる。SLANG の初期値付き宣言は大域・静的のみ（`docs/SLANG-spec.md` の「初期化（大域・静的宣言のみ）」）。
13. 配信: `html/_headers` は `/*` に `X-Frame-Options: DENY` と `frame-ancestors 'none'`。`/x1basic/*` だけ外して `frame-ancestors 'self'`。`tests/x1basic_editor_test.mjs` がこの規則を確かめている。X1Pen のページの CSP は `default-src 'self'`（frame-src も同じ origin なら可）。
14. キャッシュバスター（PR #150・#151）: build.sh が `XMIL_BUILD_HASH` を `x1pen.js` に入れ、`for _html in …` で `<script src>` と CSS の `href` に `?v=`、`for _css in …` で CSS の `url()` に `?v=`。`tests/x1pen_automation_test.mjs` の「every script, stylesheet and font … carries the build commit」が両方の frame の resource timing を見る。本番は js・css・png などが `max-age=14400`。
15. ライセンスの表示: `THIRD_PARTY_LICENSES.md` と `html/licenses.html`（CMake が build/ に写す）に、X1 BASIC Editor（MIT）と「X1 互換フォント / 美咲フォント」の項がある。美咲フォントの全文は `x1basic/assets/licenses/misaki.txt`。

## Change scope

| ファイル | 変更 |
| --- | --- |
| `scripts/import-defchrtool.mjs`（新規） | checkout（clean）の 1 commit を確かめ、`npm ci` → `npx vite build --base ./ --outDir <一時> --emptyOutDir` でビルド、出力一式と LICENSE・README.md（git object から）を `assets/defchrtool/` に写す。index.html の最初の `<script type="module"` の前に `<script src="x1pen-host.js"></script>` を差し込む。source.json を書く。 |
| `assets/defchrtool/`（新規、生成物） | `index.html`、`assets/index-<hash>.js`、`assets/fonts/X1font.png`、`LICENSE`、`README.md`、`source.json`。手で直さない。 |
| `html/x1pen_defchrtool_host.js`（新規） | defchrtool の iframe の中で動く（build.sh が `defchrtool/x1pen-host.js` として写す）。親の `X1PenDefchrToolBridge` があるときだけ `window.X1Host = { exportPCG }` を置き、ファイル保存を親に回し、フォーカスを親に伝える。親が無ければ何もしない（`/defchrtool/` を直接開いたら単独のまま動く）。 |
| `html/x1pen_pcg_export.js`（新規） | 依頼の確かめと、挿入する文の組み立て（純粋な関数。Node の試験から読める）。 |
| `html/x1pen.js` | `createPcgTool()`（iframe・bridge・`exportPCG` の実行・ロック）、`setActiveEditorTab` に `pcg`、自動操作のロックを iframe にも。 |
| `html/x1pen.html` | `PCG` タブ・コンテナ・CSS、`x1pen_pcg_export.js` の script。 |
| `build.sh` | `assets/defchrtool` と host を build/・dist/ に写す。`dist/defchrtool/index.html` をキャッシュバスターの HTML の対象に、`dist/defchrtool/assets/*.js` の中の `"./assets/….png"` に `?v=`。資産が無ければ止まる。 |
| `html/_headers` | `/defchrtool/*` を `/x1basic/*` と同じ「同じ origin からだけ枠に入れられる」に。 |
| `THIRD_PARTY_LICENSES.md`・`html/licenses.html` | DEFCHR TOOL for Web（MIT、H.O SOFT、README.md の MIT 節と LICENSE）を足す。X1 互換フォント / 美咲フォントの項に `defchrtool/assets/fonts/X1font.png` を足す。 |
| `docs/X1PEN.md`・`CHANGELOG.md` | PCG タブの使い方・流し込みの形・ファイル保存。CHANGELOG は「Unreleased」に追記（版は上げない）。 |
| `tests/defchrtool_test.mjs`（新規、`npm run test:defchrtool` を `npm test` に） | Node の試験（写した一式・取り込みスクリプト・文の組み立て・SLANG/ASM で通ること・_headers）。 |
| `tests/x1pen_automation_test.mjs` | ブラウザの試験（タブ・iframe・流し込み・失敗・ロック・ファイル保存・キャッシュバスター）。 |

### 1. 取り込みスクリプト `scripts/import-defchrtool.mjs`

`node scripts/import-defchrtool.mjs <checkout-dir> [--expect <40-hex commit>]`。`import-x1-basic-editor.mjs` と同じ骨組み（`parseArgs`、`--expect`、clean でない checkout は拒否、一時ディレクトリ → rename、失敗したら一時ディレクトリを消して元の `assets/defchrtool/` は残す）。

1. `git status --porcelain` が空、`git rev-parse HEAD` が 40 桁（`--expect` と一致）。
2. `LICENSE` と `README.md` を git object から読む。README.md に `## ライセンス` 節があり、その中に `MIT License` があることを確かめる。無ければ止まる（上流でライセンスが変わったら気づく）。
3. ビルド: checkout の中で `npm ci`、続けて `npx vite build --base ./ --outDir <一時>/build --emptyOutDir`（checkout の `dist/` は使わない）。`npm`/`npx` は PATH のもの。ビルドは関数として差し替えられるようにする（試験では npm を走らせない）。
4. 出力の確かめ:
   - `index.html` がある。`<script type="module"` がちょうど 1 つ（Vite の入口）。`x1pen-host.js` をまだ読んでいない。
   - `<script src>`・`<link href>` の参照はすべて相対で、出力の中にある（`/` や `scheme:` で始まる参照があれば止まる）。
   - 出力のファイルは `index.html` と `assets/` の下だけ（ほかがあれば止まる。`LICENSE`・`README.md`・`source.json`・`x1pen-host.js` と名前がぶつからないように）。
5. `<script src="x1pen-host.js"></script>` を最初の `<script type="module"` の直前に差し込む。
6. `assets/defchrtool/` に: 出力一式（index.html は差し込んだ後のもの）、`LICENSE`、`README.md`。`source.json`:
   ```json
   { "repository": "https://github.com/h-o-soft/defchrtool", "commit": "<40hex>",
     "build": { "command": "npm ci && npx vite build --base ./", "node": "v24.x", "npm": "12.x" },
     "files": { "<path>": { "sha256": "…", "size": n } },
     "injected": { "path": "index.html", "line": "<script src=\"x1pen-host.js\"></script>", "before": "<script type=\"module\"" } }
   ```
   `files` の index.html は差し込む前の sha256（ビルドしたまま）。LICENSE・README.md は git object の sha256。Vite のビルドは機械によってバイトが変わりうるので、source.json は「この X1Pen に入っている中身」の記録であって、上流から同じバイトが再現できる保証ではない（書いておく）。

### 2. iframe の中の host（`html/x1pen_defchrtool_host.js` → `defchrtool/x1pen-host.js`）

module script より前に同期で走る。`window.parent !== window` で、`window.parent.X1PenDefchrToolBridge` があるときだけ:

- `window.X1Host = { exportPCG: function(request) { … } }`。親の `bridge.exportPCG(request)` を呼び、結果をこの window の新しいオブジェクトに写して返す（`{ok, insertedInto, message}` / `{ok, code, message}`）。親の関数が投げたら、この Promise を reject する（defchrtool は「反映状況を確認」と出す）。
- **ファイル保存を親に回す**（Firefox の K4 と同じ理由、ひろしさんの選んだ B と同じ形）: `URL.createObjectURL` を包んで「この window で作った blob: URL → Blob」を覚える（`revokeObjectURL` で忘れる）。`HTMLAnchorElement.prototype.click` を包み、`download` 属性付きで href が覚えている blob: URL なら、ブラウザのダウンロードの代わりに `bridge.download(blob, a.download)` を呼ぶ（同期のうちに Blob を渡すので、直後の revoke に間に合う）。それ以外は元の click。親は `new Blob([blob], {type})` から自分の blob: URL と `<a download>` を作って押す（HuBASIC の `download` と同じ）。
- フォーカス: この window の `focus` → `bridge.focus()`（エミュレータを止める、ほかのエディタと同じ）、`blur` → `bridge.blur()`。
- 親が無いとき（`/defchrtool/index.html` を直接開いた）は何もしない。X1Host が無いので defchrtool は単独の動き（ふつうのダウンロード）。

### 3. 文の組み立て（`html/x1pen_pcg_export.js`、`window.X1PenPcgExport`）

`x1pen_hubasic_text.js` と同じ `(function(root){…})(typeof window !== 'undefined' ? window : globalThis)` の形。

- `checkRequest(request)` → `{ ok:false, code:'invalid', message }` または正規化した `{ target, format, basFormat, start, end, count }`:
  - オブジェクト、`version === 1`、`target` が 4 つのどれか、`format` が 6 つのどれか、`start`/`end` が整数で `0 <= start <= end <= 255`、`blob` が `arrayBuffer` と `text` の関数を持つ（`instanceof` は使わない）、`format === 'bas'` なら `basFormat` が `asc`/`bin`、`blob.size` が 1 MiB 以下。
- `plan(request)` → 挿入先と読み方。表のとおり:
  - `target === 'hubasic'` → `unsupported`「X1Pen はまだ HuBASIC への挿入に対応していません。ファイル保存（BAS・ASCII）を使ってください。」（2 本目で置き換える）
  - `image`、`bas`+`bin` → `unsupported`（defchrtool と同じ説明）。
  - `fuzzybasic`/`asm` → 挿入先 `asm`、`slang` → `slang`。読み方は `asm`/`asm3`/`bas`(asc) がテキスト、`bin`/`bin3` がバイト列。
- テキスト: `blob.text()` を CR/CRLF/LF → LF にそろえ、末尾に改行が無ければ足す。空なら `invalid`。
- バイト列: 長さが `24 × count` でなければ `invalid`。
  - ASM へ（`dbBlock`）: 先頭に `; DEFCHR TOOL: CHR $41-$42 (BIN(x3): rows of B,R,G)` か `(BIN: B[8],R[8],G[8])`、1 文字ごとに `; CHR $41` と `\tDB\t$..,…`（24 バイト 1 行）。ラベル・ORG は付けない（defchrtool の ASM の形に合わせる）。
  - SLANG へ（`slangArray`）: 先頭に `// DEFCHR TOOL: CHR $41-$42 (rows of B,R,G)` か `(B[8],R[8],G[8])`、`ARRAY BYTE <名前>[] = {`、1 文字 1 行 `    $00,…,$27, // $41`（最後の行はカンマなし）、`};`。
  - 名前（`slangArrayName(source, start)`）: `PCG` ＋ 開始コードの 16 進 2 桁（大文字）。SLANG のソースに同じ語（`\b…\b`、大文字小文字を区別しない）があれば `_2`、`_3`、… の最初の空いているもの。
- `message`: 成功時「ASM タブの 12 行目に 2 文字分（$41〜$42）を入れました。」／SLANG は「SLANG タブの … 入れました（配列は関数の外に置いてください）。」

### 4. X1Pen 本体（`html/x1pen.js`・`html/x1pen.html`）

- タブ: `#editor-tabs` の HuBASIC の後に `<button class="editor-tab" data-tab="pcg" title="DEFCHR TOOL (PCG editor)">PCG</button>`。コンテナ `<div id="pcg-editor-container" class="hidden"></div>`、CSS は hubasic と同じ（iframe 100%）。
- `createPcgTool(container)`:
  - `mount()`: 初回だけ `defchrtool/index.html?v=<hash>` の iframe（title「DEFCHR TOOL」）を作る。以後は作り直さない。
  - `show()`: mount のあと iframe（`contentWindow`）にフォーカスを渡す。読み込み前なら `load` のあとで。
  - `setLocked(locked)`: HuBASIC と同じく iframe の `body.inert`。
  - `window.X1PenDefchrToolBridge = { exportPCG, download, focus, blur }`。
- `setActiveEditorTab`: `pcg` を足す（コンテナの表示、`pcgTool.mount(); pcgTool.show()`）。ほかのタブの操作ボタンは隠す。activeTab を見る既存の分岐（モバイル・resize の `requestMeasure`）は `pcg` のとき何もしない。
- `exportPCG(request)`（async、確認ダイアログなし、必ず決着）:
  1. `checkRequest` → だめなら `ok:false`。
  2. `plan` → `unsupported` ならそのまま返す。
  3. blob をテキストかバイト列で読む（読めなければ `invalid`）→ 挿入する文を作る。
  4. **ここから同期**: `runAdmission` か `automationInteractionLocked` なら `unavailable`（「RUN の準備中か、AI が操作中です。終わってからもう一度」）。対象のエディタが無ければ `unavailable`。SLANG の名前はこの時点のソースで決める。
  5. カーソル位置（`getCursor()`）に、行の途中なら前に改行を足して、1 回の `view.dispatch({ changes, selection: 挿入した末尾, scrollIntoView: true })` で入れる（Ctrl+Z 1 回で戻る）。onChange が保存（localStorage）と `markProgramChanged` をする。
  6. `setActiveEditorTab(挿入先)`、ステータス欄にも同じ文言。`{ ok:true, insertedInto, message }`。
- `download(blob, name)`: 親で `<a download>` を作る（HuBASIC の download と同じ。名前が空なら `pcg.bin`）。
- 自動操作のロック: `setAutomationInteractionLocked` で `pcgTool.setLocked(...)` も呼ぶ。
- Ctrl+Enter（RUN）は defchrtool の中では効かない（キーボードは今のまま、の決めごと）。

### 5. build.sh・_headers・キャッシュバスター

- `assets/defchrtool/source.json` が無ければ「Import it with: node scripts/import-defchrtool.mjs <checkout-dir>」で止まる（x1basic と同じ）。
- build/ と dist/ に `defchrtool/` を写し、`html/x1pen_defchrtool_host.js` を `defchrtool/x1pen-host.js` に。
- キャッシュバスター: `for _html` に `"${DIST_DIR}/defchrtool/index.html"` を足す（`x1pen-host.js` と `./assets/index-<hash>.js` に `?v=`）。`dist/defchrtool/assets/*.js` の中の `"./assets/<…>.png"`（文字列）に `?v=<hash>` を足す sed（今は X1font.png の 1 か所）。iframe の src にも `?v=`。
- `_headers`: `/defchrtool/*` に `! X-Frame-Options`、`! Content-Security-Policy`、`Content-Security-Policy: frame-ancestors 'self'`（x1basic と同じ）。

## Implementation steps

1. `scripts/import-defchrtool.mjs` を書き、scratch の clone（07fa338）から `assets/defchrtool/` を作る（実際の `npm ci` とビルド）。
2. `html/x1pen_pcg_export.js` と Node の試験。
3. `html/x1pen_defchrtool_host.js`、`html/x1pen.js`・`html/x1pen.html` の変更。
4. build.sh・_headers・ライセンス・docs・CHANGELOG。
5. ブラウザの試験。`./build.sh` → `npm test`（Chrome）。Firefox は Playwright の Firefox でファイル保存と流し込みを確かめる（npm test は Chrome だけ）。
6. 確認用サーバー（127.0.0.1:8000）を新しい dist で見られるようにする。
7. 実装レビュー → PR 1 本。

## Edge cases and test plan

**Node（`tests/defchrtool_test.mjs`）**
1. 写した一式: `assets/defchrtool/source.json` の commit が `07fa338…`、files の各ファイルの sha256/size が一致（index.html は差し込んだ 1 行を除くと一致）。差し込みはちょうど 1 行、最初の `<script type="module"` の直前。LICENSE・README.md がある。README.md に MIT の節。
2. 取り込みスクリプト（偽のビルドで）: clean でない checkout・`--expect` 違い・README に MIT 節が無い・module script が 0 個/2 個・絶対パスや外部の参照・出力に `index.html`/`assets/` 以外・参照先が無い、をそれぞれ拒否し、元の `assets/defchrtool/` を残す。正しい入力では一式と source.json を書く。`parseArgs`。
3. `checkRequest`: version・target・format・範囲（-1, 256, 小数, start>end）・blob の形・bas の basFormat・サイズ上限を拒否。
4. `plan`: 対応表の全 24 組（4 target × 6 format、bas は asc/bin）を表どおりに。hubasic は `unsupported`。
5. テキスト: CR / CRLF / LF がそろう、末尾改行、空は invalid。
6. バイト列: 長さ違いは invalid。BIN(x3)・BIN の DB/ARRAY が元のバイト順のまま（B=00..07, R=10..17, G=20..27 の区別できる値で、x3 は 00,10,20,01,…、面順は 00..07,10..17,20..27）。00・FF の端、256 文字。
7. 名前: `PCG41`、既にあれば `_2`、`_2` もあれば `_3`、大文字小文字を区別しない、`PCG410` のような長い語にはぶつからない。
8. 実際に通る: 作った DB を `x1pen_z80asm.js` で、作った ARRAY BYTE ＋ `PCGDEF` を `x1pen_slang_compiler.js` でアセンブル・コンパイルし、エラーなし・期待するバイト列。
9. `_headers`: `/defchrtool/*` が同じ origin からだけ枠に入れられる（x1basic の試験と同じ形）。

**ブラウザ（`tests/x1pen_automation_test.mjs`、Chrome）**
10. PCG タブ: 押すと iframe が 1 つでき、defchrtool が起動し、iframe の `X1Host.exportPCG` が関数。ほかのタブに移って戻っても同じ iframe（作り直さない）、`X1Host` は X1Pen の HuBASIC エディタのものと別。
11. 本物の UI で 1 回: iframe の中で P → 配信「X1Pen に挿入」→ 出力先 ASM → EXEC。ASM タブに切り替わり、カーソル位置に `; CHR $00` … の DB が入る。defchrtool の表示が成功。
12. `exportPCG` を iframe の中から直接（iframe の Blob で）: asm3→asm、asm3→fuzzybasic（insertedInto は asm）、bin3→slang（ARRAY BYTE、名前の衝突で `_2`）、bin→asm（DB）、asm→slang（そのまま）。行の途中のカーソル。Ctrl+Z 1 回で元に戻る。localStorage に保存される。RUN の対象（sourceMode の推定）が変わるのは中身が入ったときだけ（既存の規則どおり）。
13. 失敗は何も変えない: hubasic → unsupported、image・bas/bin → unsupported、長さ違いの bin → invalid、壊れた依頼 → invalid、自動操作のロック中 → unavailable（エディタの中身・カーソル・タブが変わらない）。
14. ファイル保存: defchrtool の「ファイル保存」が X1Pen のページのダウンロードになる（Playwright の `download` イベント、名前と中身）。
15. キャッシュバスター: 既存の試験に defchrtool の frame を足す（`/defchrtool/x1pen-host.js`、`/defchrtool/assets/index-*.js`、`/defchrtool/assets/fonts/X1font.png` が `?v=<hash>`）。
16. 単独: `/defchrtool/index.html` を直接開くと `X1Host` が無く、エラーも出ない。

**手で（Playwright の Firefox）**: 14 のファイル保存と 11 の流し込みが Firefox でも動く。結果は PR に書く。

**戻し方**: この PR を revert すれば、タブ・資産・ヘッダーが全部消える。defchrtool の絵は X1Pen の origin の localStorage（`defchr-*`）に残るが、X1Pen はそれを読まない。

## Open decisions

1. **モバイルのタブ**: defchrtool はキーボードで描く道具なので、モバイルの `#mobile-tabs` には足さない（狭い幅に 6 つ目を詰めない）。おすすめはこのまま。要るなら後で。
2. **タブの名前**: 「PCG」（ひろしさんの言葉「PCG エディタのタブ」）。title に「DEFCHR TOOL」。
3. **ファイル保存の横取り**: 上流に「ファイル保存をホストに任せる口」（`saveFile`）ができたらそれに替える（Secretary 経由で任意のお願い済み）。それまでは iframe の中で `click` と `createObjectURL` を包む。
4. **成功時のタブ切り替え**: 契約どおり出力先タブに切り替える。続けて何度も描いて入れるときは、PCG タブに戻る手間がある。

## Cross-review反映

### Round 1 — codex / gpt-6-astra/high
- Verdict: APPROVED (model=APPROVED; policy=strict; host_override=no)
- Implementation: READY (next_action=implement; reviewer=READY)
- 指摘なし（findings 0）。request 87406436-4992-40f1-a0d9-aaec7bcb10f8

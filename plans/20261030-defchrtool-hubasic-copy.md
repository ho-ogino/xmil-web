# PCG タブ 2 本目: DEFCHR TOOL cd11507 に写し直し、HuBASIC への行番号マージ、クリップボードへのコピー、親ページでのファイル保存

## Purpose

1 本目（PR #152、マージ済み 49f7806）で X1Pen に PCG タブ（DEFCHR TOOL for Web、h-o-soft/defchrtool `07fa338`）を載せ、ASM・SLANG・FuzzyBASIC（ASM タブ）への挿入とファイル保存を入れた。HuBASIC への挿入は `unsupported` を返していた。

上流 defchrtool は PR #10 で任意の口 `copyPCG`（クリップボードへのコピー）と `saveFile`（ファイル保存をホストに任せる）を足し、`cd11507d6cf10564beae3711b8ed83ce73f0e648` にマージした。Secretary から 2 本目の依頼（2026-10-30 21:52）:

1. 写す SHA を `cd11507…` に差し替えて写し直す（ビルドの手順・同梱物の種類は変わらない）。
2. HuBASIC への挿入（ひろしさんが前に決めた形）:
   - カーソルではなく**行番号で混ぜる**。開始番号とステップの欄（初期値 60960 / 10）は defchrtool 側にある。
   - ぶつかった行が**どれも同じ文字の `DEFCHR$` なら置き換える**。ほかの行とぶつかったら `conflict` で何も変えない。
   - 行は番号の順に入れる。`RETURN` は足さない。
   - 全部作ってから 1 回で差し替える（エディタの undo は消えるので、そこは分かるように）。上限は 65529。
3. クリップボードへのコピー（`copyPCG`）: 出力先に合わせて整形して、クリップボードに入れる。
4. ファイル保存を `saveFile` に寄せる: X1Host に `saveFile` を置いてから、1 本目の「ダウンロードの横取り」を外す。
5. Firefox でも確かめる（保存・コピーとも）。

**やらないこと**: 逆向き（プログラムの `DEFCHR$` をツールに読み込む）、PCGDEF 呼び出しやアドレスの生成、版上げ、本番（Cloudflare Pages・npm）への反映、上流 defchrtool・X1 BASIC Editor の変更、モバイルの下のタブ。

## Observed evidence

### defchrtool cd11507（scratch に clone、07fa338 との差分を読んだ）

- 変わったファイル: `X1HOST.md`、`README.md`、`index.html`（保存先に「クリップボードにコピー」の option）、`src/host/X1Host.ts`、`src/input/InputPanelManager.ts`、`src/main.ts`、テスト。ビルドの手順・出力の形（`index.html` + `assets/`、フォント `assets/fonts/X1font.png`）は同じ。
- 型（`src/host/X1Host.ts`）:
  ```ts
  type PCGFailure = { ok: false; code: 'unsupported' | 'invalid' | 'conflict' | 'unavailable'; message: string };
  type PCGExportResult = { ok: true; insertedInto: 'asm' | 'slang' | 'hubasic'; message?: string } | PCGFailure;
  type PCGCopyResult = { ok: true; message?: string } | PCGFailure;
  interface X1Host {
    exportPCG(request: PCGExportRequest): Promise<PCGExportResult>;
    copyPCG?(request: PCGExportRequest): Promise<PCGCopyResult>;
    saveFile?(blob: Blob, fileName: string): void | Promise<void>;
  }
  // PCGExportRequest は 1 本目と同じ: version 1, target, format, basFormat?, start, end, fileName, blob, hubasic?: { lineStart, lineStep }
  export const HUBASIC_MAX_LINE = 65529;
  export const DEFAULT_HUBASIC_LINES = { lineStart: 60960, lineStep: 10 };
  ```
- 能力は口ごとに別々に検出する（`getHostMethod(name)`: `window.X1Host[name]` が関数か）。`copyPCG` は `exportPCG` もあるときだけ「クリップボードにコピー」を出す。`saveFile` は `exportPCG` と無関係に使う。P を開くたびに検出し直す。
- `copyPCGToHost`: 戻り値を形で確かめる。成功は `ok === true` かつ **`insertedInto` が undefined** かつ message が無いか文字列。失敗は 4 つの code と文字列 message。それ以外・例外は「コピー結果を確認できません」。自動再送・別経路への出力はしない。成功 message が無ければ「クリップボードにコピーしました。」。
- `saveFileWithHost(blob, fileName)`: `saveFile` が無ければ false を返し、従来どおり子 iframe でダウンロード。あれば `await saveFile.call(host, blob, fileName)`、throw/reject なら「X1Pen でのファイル保存を確認できません…」と出し、子での再ダウンロードはしない。
- X1HOST.md の HuBASIC 節（契約）:
  - 開始行 60960・ステップ 10。両方正の整数、最後の行は 65529 以下（`validateHuBasicLines`: lineStart ≥ 1、1 ≤ lineStep ≤ 65529、lineStart + (count−1)·lineStep ≤ 65529。送信前に defchrtool が検査する）。
  - 1 文字 1 行、RETURN は付けない。元の ASCII は **CR 区切り**。ホストが CR/CRLF/LF を論理行に正規化する。
  - 同番号の既存行がすべて同じ文字コードの DEFCHR$ なら置換できる。別の文字や別の文と一つでも衝突したら conflict で全体を拒否し、何も変えない。全行を組み立ててから番号順に一回で差し替える。**HuBASIC の差し替えは Undo 履歴を消すため、Ctrl+Z で戻せない。**
- defchrtool の BAS（ASCII）の出力（`src/io/BasFormat.ts` `saveAscii`）: 1 文字につき `${lineNum}DEFCHR$(${charCode})=HEXCHR$("${hex}")`。hex は B[8],R[8],G[8] の 24 バイトを大文字 2 桁ずつ（48 桁）。行番号と `DEFCHR$` の間に空白なし、文字コードは 10 進。`lines.join('\r') + '\r'`。
- コピーの契約: 同じ target・形式・範囲・行番号・Blob を渡す。対応形式・推奨形式・バイト順は挿入と共通。ホストが整形してクリップボードに書く。**コピー成功ではエディタの内容や表示タブを変えない。** ok:true はクリップボード書込み後に返す。拒否や権限エラーは通常の ok:false。RUN 中や自動操作中は unavailable（挿入/コピー共通）。
- 結果の待機: 挿入/コピーの送信待ちは EXEC・CANCEL・Esc を無効化。成功でパネルを閉じ、失敗はパネルと入力を残す。message は textContent でそのまま表示。

### X1Pen の今（main 49f7806）

- `html/x1pen_defchrtool_host.js`（`defchrtool/x1pen-host.js` として公開、defchrtool の `index.html` の最初の `<script type="module">` の前に読まれる）:
  - `window.parent.X1PenDefchrToolBridge` があるときだけ `window.X1Host = { exportPCG }` を置く（結果は iframe 側の object に写す `localResult`）。単独で開いたら何もしない。
  - **横取り**: `URL.createObjectURL`/`revokeObjectURL` を包んで blob: URL → Blob を覚え、`HTMLAnchorElement.prototype.click` を包んで、覚えた Blob の download リンクなら `bridge.download(blob, name)` に回す（Firefox は iframe 内の blob: ダウンロードを X1Pen の CSP frame-src で止めるため。CSP は変えていない）。
  - window の focus/blur を `bridge.focus`/`bridge.blur`（エミュレータの一時停止）に回す。
- `html/x1pen.js` `createPcgTool()`:
  - iframe はタブを初めて開いたときに 1 度だけ作る。`setLocked` で iframe の body を inert に。
  - `exportPCG(request)`: `X1PenPcgExport.checkRequest` → `plan` → Blob を読む（await）→ **ここから待たない**: `runAdmission || automationInteractionLocked` なら unavailable → `build` → 1 回の `view.dispatch` でカーソル位置に挿入 → `setActiveEditorTab` → `editor.focus()` → ステータス「PCG: …」→ `{ ok:true, insertedInto, message }`。
  - `X1PenDefchrToolBridge = { exportPCG, download(blob, name), focus, blur }`。`download` は親のページで `new Blob([blob])` → `<a download>` → click。
- `html/x1pen_pcg_export.js`（`window.X1PenPcgExport`）: `checkRequest`（形で Blob を確かめる、1 MiB まで）、`plan`（hubasic は今 `unsupported`）、`build`（テキストは `normalizeText` で LF・末尾改行、bin/bin3 は DB 行か `ARRAY BYTE PCGxx[]`）、`slangArrayName`、`successMessage`。
- HuBASIC タブ（`createHuBasicEditor`）: プログラムは **X1 のバイト列**で X1Pen が持つ（`bytes`）。X1 BASIC Editor（iframe `x1basic/src/index.html`）には `loaded({ name, bytes })` で渡し、編集は `contentChanged(next)` で受け取る。
  - `hubasicEditor.getBytes()` / `setBytes(next, { silent })`: `setBytes` は bytes を置き換えてエディタに読み込ませ直す（**エディタの undo とカーソルは消える**。ボードの「既知の制約」にもある）。silent でなければ `onChange` → `markProgramChanged()` と `persistEditorSource(LS_EDITOR_HUBASIC, text)`（自動操作の revision も進む）。
  - iframe はタブを初めて開いたときに `mount()`。まだなら `setBytes` は bytes だけ持ち、開いたときに渡す。
  - 改行: X1Pen 側の文字列との変換（`x1pen_hubasic_text.js`）は `\r\n`。エディタが返すバイトの改行はエディタ次第なので、既存の改行を見て合わせる（下の手順）。
  - X1 BASIC Editor のフォーカス: X1Pen のアダプタ（`html/x1pen_x1basic_host.js`）は、利用者がその iframe で押す・打つ（または X1Pen で Tab）までは、iframe に来たフォーカスを X1Pen の元の要素へ返す。タブを切り替えただけではキーボードはエディタに入らない（今の HuBASIC タブの動き）。
- 自動操作の `X1PenAutomation.validate()` は HuBASIC のとき hubasic2sl（wasm）で変換して確かめる（`validateHuBasicProgram`）。テストで混ぜた結果が通ることを見られる。
- HuBASIC の行の読み方（SLANG-compiler `HuSource.FromX1Bytes`・`HuParser.ParseLine`、読んだのはこの 2 つのソースだけ）: CR・LF・CRLF で行を分け、0x1A で終わり。空白（0x20）だけの行は無視。行頭の空白を飛ばして数字が行番号（無ければエラー HB0201、1〜65529 の外はエラー HB0108）。同じ行番号 2 回はエラー（HB0502）、昇順でなければ警告して並べ替え（HB0501）。タブは空白として読む。

### クリップボードの実験（scratch、Playwright）

親ページに同じ origin の iframe。iframe のボタンの click → 親の関数を await（`blob.text()` と 300 ms 待ち）→ **iframe の `navigator.clipboard.writeText`**。Chrome（google-chrome）・Firefox（Playwright の Firefox）とも書けた（親のテキストエリアに Ctrl+V で貼って同じ文字列）。1 本目のときの調べでは、親のページから書くと、フォーカスが iframe にあるため Chrome は「Document is not focused」で断る。→ **クリップボードへは iframe の中（x1pen-host.js）から書く。**

## Change scope

1. `assets/defchrtool/`（生成物）: `node scripts/import-defchrtool.mjs <clone> --expect cd11507d6cf10564beae3711b8ed83ce73f0e648` で写し直す（index.html・`assets/index-*.js`・LICENSE・README.md・source.json）。スクリプトは変えない。
2. `html/x1pen_pcg_export.js`: HuBASIC を足す。
   - `checkRequest`: target が hubasic のとき `request.hubasic` の `lineStart`・`lineStep` を検査（整数、lineStart ≥ 1、lineStep ≥ 1、最後の行 ≤ 65529。外れたら invalid）。checked に `hubasic: { lineStart, lineStep }` を持つ。
   - `plan`: hubasic は format `bas` かつ basFormat `asc` だけ `{ ok, editor: 'hubasic', read: 'text' }`。ほかの形式は unsupported（「HuBASIC に入れられるのは BAS（ASCII）だけです。…」）。asm/slang は今のまま。
   - `huBasicLines(text, checked)`（新）: Blob のテキストを CR/CRLF/LF で行に分け、空行を除き、各行が `^(\d+)DEFCHR\$\((\d+)\)=HEXCHR\$\("([0-9A-Fa-f]{48})"\)$` で、行番号が `lineStart + i·lineStep`、文字コードが `start + i`、行数が `count` と一致するか確かめる。違えば invalid。`[{ number, code, text }]`。
   - `mergeHuBasic(programBytes, lines)`（新、純粋関数）: 下の「手順 3」。`{ ok, bytes, added, replaced }` か conflict。
   - `build`: hubasic（コピー用）は `lines.map(text).join('\n') + '\n'`。
   - 文言: `successMessage` に HuBASIC（Ctrl+Z で戻せないこと）、`copyMessage`（新）。
3. `html/x1pen.js` `createPcgTool()`:
   - 共通の準備 `prepare(request)`（check → plan → Blob を読む → ロック → build/行の検査）を exportPCG と新しい `formatPCG` で使う。
   - `exportPCG`: hubasic のとき `mergeHuBasic(hubasicEditor.getBytes(), lines)` → 衝突なら conflict（何も変えない）→ `hubasicEditor.setBytes(merged.bytes)`（silent なし: 保存・変更の印・revision）→ `setActiveEditorTab('hubasic')` → キーボードを隠れた PCG の iframe から HuBASIC のタブのボタンへ → ステータス → `{ ok:true, insertedInto:'hubasic', message }`。asm/slang は今のまま。
   - `formatPCG(request)`（新、コピー用）: 同じ準備とロックで、エディタもタブも変えずに `{ ok:true, text, message }` か失敗を返す。SLANG の配列名は今の SLANG プログラムとぶつからない名前（挿入と同じ）。
   - `copied(message)`（新）: コピーが済んだら iframe から呼ばれ、ステータス「PCG: …」を出すだけ。
   - bridge の `download` は今のまま（`saveFile` が使う）。
4. `html/x1pen_defchrtool_host.js`:
   - `X1Host = { exportPCG, copyPCG, saveFile }`。
   - `copyPCG(request)`: `bridge.formatPCG(request)` を待ち、失敗ならそれを iframe 側の object にして返す。成功なら **この iframe の** `navigator.clipboard.writeText(text)`。無い・断られたら `{ ok:false, code:'unavailable', message:'クリップボードに書き込めませんでした。ブラウザの設定（クリップボードの許可）を確かめてください。' }`。書けたら `bridge.copied(message)` して `{ ok:true, message }`（`insertedInto` は付けない）。Promise は必ず決着させる（bridge の例外は reject、defchrtool はそれを「結果不明」と出す）。
   - `saveFile(blob, fileName)`: `bridge.download(blob, fileName)` を同期で呼ぶ。失敗はこの iframe の Error で throw。
   - **横取り（`URL.createObjectURL`・`revokeObjectURL`・`HTMLAnchorElement.prototype.click` の包み）を外す。** 新しいビルドは `saveFile` があれば必ずそちらを使い、iframe 内でダウンロードしない。
   - 先頭の説明を書き直す。
5. 試験: `tests/defchrtool_test.mjs`（Node）、`tests/x1pen_automation_test.mjs`（Chrome）。
6. 文書: `docs/X1PEN.md`（PCG タブの節）、`CHANGELOG.md`（Unreleased）、`THIRD_PARTY_LICENSES.md`・`html/licenses.html`（commit の記載があれば cd11507 に）。
7. 設計の控え: `plans/YYYYMMDD-defchrtool-hubasic-copy.md`（archive）。

## Implementation steps

1. **写し直し**: scratch の clone で `git checkout cd11507`（clean）→ nvm の Node で `node scripts/import-defchrtool.mjs <clone> --expect cd11507d6cf10564beae3711b8ed83ce73f0e648`。`assets/defchrtool/source.json` の commit・sha256 が新しくなり、`index.html` に x1pen-host.js の 1 行が入っていることを確かめる。
2. **`x1pen_pcg_export.js`**: checkRequest・plan・huBasicLines・build・文言（Change scope 2）。
3. **`mergeHuBasic(programBytes, lines)`**:
   1. `programBytes` を、最初の 0x1A より前（本体）と、**最初の 0x1A そのものから最後まで**（尻尾。0x1A を含めてバイトのまま残す）に分ける。0x1A が無ければ尻尾は空。
   2. 本体を行に分ける。各行は `{ content, eol }`（eol は CRLF・CR・LF・最後の行は空のことあり。**触らない行はバイトのまま、改行もそのまま残す**）。行頭の空白（0x20・0x09）を飛ばして数字が続けば、その数字が行番号（`number`）。数字が無い行・空白だけの行は `number = null`（ぶつからないし、位置の目印にもしない）。
   3. 新しい行ごとに、同じ番号の既存の行を集める。どれか 1 つでも「同じ文字の DEFCHR$ 行」でなければ衝突。「同じ文字の DEFCHR$ 行」は、行番号の後ろ全体が 1 つの文 `DEFCHR$(<c>)=HEXCHR$("<16 進>")` で、c が新しい行の文字コードと同じもの（大文字小文字・空白の有無は問わない。c は 10 進か `&H` 16 進。16 進の中の空白は許す）。衝突が 1 つでもあれば `{ ok:false, code:'conflict', message }`（衝突した行番号を最大 5 つ並べ、「開始行かステップを変えてください」）。
   4. 置き場所:
      - 置き換える行（同じ番号の既存の行がある）: その番号の**最初の**既存の行の場所に新しい行を置き、同じ番号のほかの行は消す（結果に同じ番号が 2 つ残らない）。改行はその行の eol のまま（eol が空の最後の行なら、下の 5 で足す）。
      - 新しく足す行: 文書の上から見て、**その番号より大きい番号の最初の行**の前に入れる。そういう行が無ければ、空白でない最後の行の後ろ（後ろの空行の前）。同じ場所に入る行は番号の順。
      - 昇順に並んだプログラムなら、結果も昇順になる。昇順でないプログラムでも、決まった場所に入れる（HuBASIC は読むときに並べ替える。hubasic2sl も警告 HB0501 で並べ替える）。
   5. 新しい行の改行は、本体で最初に見つけた改行（CRLF・CR・LF）。改行が 1 つも無ければ CRLF（`x1pen_hubasic_text.js` と同じ）。新しい行の前の行に改行が無ければ足す。新しい行の後ろには必ず改行を付ける。
   6. 混ぜた本体 + 尻尾（0x1A から）をつないだバイト列と、足した数・置き換えた数を返す。新しい行は必ず 0x1A より前に入る。**何かを変えるのは、全部組み立てて衝突が無いと分かってから、`setBytes` の 1 回だけ。**
4. **`x1pen.js`**: prepare・exportPCG（hubasic）・formatPCG・copied（Change scope 3）。HuBASIC の挿入のあと、フォーカスは HuBASIC のタブのボタンに置く（隠れた iframe にキーボードを残さない。X1 BASIC Editor にはクリックで入る。今の HuBASIC タブを開いたときと同じ）。
5. **`x1pen_defchrtool_host.js`**: copyPCG・saveFile・横取りを外す（Change scope 4）。
6. 文書・CHANGELOG・ライセンスの記載。
7. `./build.sh`、確認用サーバーを立て直す、`npm test`、Firefox を手で（Playwright の Firefox）。
8. 実装レビュー → PR 1 本。

## Edge cases and test plan

### 純粋な部分（`tests/defchrtool_test.mjs`、Node）

- 写した一式: source.json の commit が `cd11507…`、ファイルの sha256 が一致、index.html に x1pen-host.js の 1 行（今の試験の commit を差し替える）。
- checkRequest: hubasic で `hubasic` が無い・0・負・小数・最後の行が 65530 → invalid。65529 ちょうどは通る。asm/slang は `hubasic` を見ない。
- plan: hubasic × 7 形式（bas/asc だけ通る、ほかは unsupported）。asm/slang は 1 本目の表のまま。
- huBasicLines: defchrtool と同じ形の CR 区切り・CRLF・LF・末尾改行なし → 読める。行番号のずれ・文字コードのずれ・行数の違い・48 桁でない・余計な文 → invalid。
- mergeHuBasic:
  - 空のプログラム → 新しい行だけ（CRLF）。
  - 昇順のプログラムの途中・前・後ろ（後ろの空行の前）に入る。
  - 同じ文字の DEFCHR$ を置き換え（10 進・`&H41`・小文字・空白入り・16 進に空白）。同じ番号・同じ文字の行が 2 つ → 1 つに。
  - 衝突: 別の文（`60960 PRINT`）、別の文字の DEFCHR$、DEFCHR$ の後ろに `:PRINT`、`DEFCHR$(65)=A$` → conflict で入力のバイト列のまま（結果を返さない）。衝突の文言に行番号。
  - CR だけ・LF だけ・CRLF のプログラムで、触らない行のバイトが変わらない。新しい行はそのプログラムの改行。
  - 最後の行に改行が無い → 改行を足してから新しい行。
  - 0x1A があるプログラム: 0x1A とその後ろのバイトがそのまま残り（0x1A の位置は新しい行の分だけ後ろへ）、新しい行はすべて 0x1A より前。結果を HuBASIC と同じ規則（0x1A で終わり）で読むと、0x1A の後ろの行は読まれない。行頭に空白のある行番号、数字の無い行（ぶつからない）、昇順でないプログラム（決まった場所）。
  - 混ぜた結果を `HuSource` と同じ規則（行番号・重複）で読み直して、新しい行がそろって 1 つずつあること（JS で書いた小さな読み手で確かめる）。
- コピーの文（build の hubasic）: LF 区切り・末尾改行。asm/slang のコピーの文は挿入の文と同じ。

### ブラウザ（`tests/x1pen_automation_test.mjs`、Chrome）

- **本物の P の画面から HuBASIC へ**: HuBASIC に `10 PRINT "A"\r\n65000 END\r\n` を置き、PCG タブで出力先 HuBASIC（60960/10 のまま）、範囲 41〜42 → EXEC。HuBASIC のタブに切り替わり、プログラムが `10 …`、`60960DEFCHR$(65)=…`、`60970DEFCHR$(66)=…`、`65000 END` の順。localStorage にも保存。ステータスに「Ctrl+Z では戻せません」。`X1PenAutomation.validate()` が通る（hubasic2sl）。フォーカスが PCG の iframe に残っていない。
- 同じ設定でもう一度 → 置き換え（行数は同じ、置き換えの数がメッセージに）。
- 衝突: 60970 に `PRINT` を置いて EXEC → パネルが残り、conflict の文言、プログラムは変わらない、タブも PCG のまま。
- **コピー**（`grantPermissions(['clipboard-read','clipboard-write'])`）: 本物のパネルで保存先「クリップボードにコピー」→ ASM（DB）・SLANG（配列）・HuBASIC（DEFCHR$ 行）。クリップボードの中身を `navigator.clipboard.readText()` で確かめる。プログラムもタブも変わらない。ステータス「PCG: …」。
- copyPCG の直接呼び出し: 断る場合（hubasic で asm3、長さ違い、AI のロック中）→ ok:false で、クリップボードもプログラムも変わらない。成功の結果に `insertedInto` が無い。
- **ファイル保存**: 本物のパネルで「ファイル保存」→ 親のページの download イベント（名前・中身）。iframe の `URL.createObjectURL`・`HTMLAnchorElement.prototype.click` が包まれていない（`[native code]`）。`X1Host.saveFile` が関数。
- 1 本目の試験は残す（ASM の挿入・undo・同じ iframe・各形式・断る場合）。断る表から hubasic の行を外し、HuBASIC の試験に移す。
- 単独で開いたとき: `X1Host` が無い（今のまま）。
- 読み込み（`?v=`）の試験は今のまま通ること。

### Firefox（手で、Playwright の Firefox、scratch の `pcg-probe.mjs` を直して）

- HuBASIC への挿入、ASM への挿入、「クリップボードにコピー」（親のテキストエリアに Ctrl+V で貼って同じ）、「ファイル保存」（download イベントと中身）。

### 失敗・後戻り

- 失敗はどれも何も変えない（検査はすべて `setBytes`/`dispatch` の前。読み込み以外は待たない）。
- HuBASIC の差し替えは undo で戻せない。メッセージ・defchrtool のパネルの注記（上流がすでに出す）・docs に書く。
- 後戻りはこの PR を revert（`assets/defchrtool/` は 07fa338 に戻り、横取りも戻る）。保存の形は変えないので、ユーザーのデータの移し替えは要らない。

## Open decisions

1. **置き換えてよい行の範囲**: 「同じ文字の DEFCHR$」を、行全体が `DEFCHR$(c)=HEXCHR$("…")` の 1 文のときだけにする（`DEFCHR$(65)=A$` や `:` で別の文が続く行は conflict）。ユーザーの書いた処理を消さないためのおすすめ。
2. **HuBASIC へ入れたあとのキーボード**: X1 BASIC Editor にはクリックで入る（今の HuBASIC タブと同じ）。フォーカスは HuBASIC のタブのボタンへ。エディタに直接入れるには X1 BASIC Editor 側のアダプタを変えることになるので、この PR ではしない。
3. **コピーもロック中は断る**: 契約（挿入/コピー共通で RUN 中・自動操作中は unavailable）どおり。

## Cross-review反映

### Round 1 — codex / gpt-6-astra/high
- Verdict: NEEDS_WORK (model=NEEDS_WORK; policy=strict; host_override=no)
- Implementation: READY AFTER FIXES (R1-F1) (next_action=fix_then_implement; reviewer=READY_AFTER_FIXES)
- [adopted][high] R1-F1 0x1A の終わりの印が、混ぜたあとに残ることが書かれていない → Implementation steps 3.1・3.6（尻尾は最初の 0x1A そのものから。新しい行は 0x1A より前）、Edge cases（0x1A とその後ろがバイトのまま残り、読むと 0x1A で止まることを試す）

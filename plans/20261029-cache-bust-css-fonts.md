# CSS・フォント・ほかの読み込みにもキャッシュバスター（?v=）を付ける

## Purpose

0.13.0 を本番に出したあと、Firefox で HuBASIC の「エクスポート」が失敗した。原因は、HuBASIC エディタの iframe の中の `x1pen-host.js` が `?v=` なしで読まれ、ブラウザのキャッシュから古い版（0.12.0 のアダプタ）が使われたこと。ひろしさんが PR #150（ac9f129）で、iframe の中の `<script src>` にも `?v=<commit>` を付けて直した。

今回は、同じことが **CSS・フォント・ほかの読み込み** で起きないようにする。ひろしさんの言葉は「リリースはしなくていいけど、忘れないうちにPR出してマージしておきますか。そのうちの、次のリリースに入れる感じで」。

- やること: 本番でブラウザが問い合わせずにキャッシュから使うファイルのうち、ビルドごとに中身が変わりうるものへ `?v=<commit>` を付ける。`x1-font.json` にも付ける（Secretary からの指定）。付け忘れたら落ちる回帰テストを足す。
- やらないこと:
  - 版上げ・公開・本番（Cloudflare Pages・npm）への反映。次のリリースに一緒に入る。
  - 上流から写した `assets/x1basic/`（X1 BASIC Editor）の書き換え。`dist/` に写したあとで `build.sh` が書き換えるだけにする（PR #150 と同じ）。
  - `_headers` の Cache-Control の変更（下の「観察」4 を参照。効かない見込み）。
  - アイコン類（favicon・apple-touch-icon・manifest.json のアイコン）。理由は「変更の範囲」の表に書く。

## Observed evidence

1. **いまの `build.sh` のキャッシュバスター**（ac9f129、`build.sh` 287–298 行あたり）:
   ```sh
   XMIL_BUILD_HASH=$(git -C "${SCRIPT_DIR}" rev-parse --short HEAD 2>/dev/null || date +%s)
   sed -i.bak "s/@@XMIL_BUILD_HASH@@/${XMIL_BUILD_HASH}/g" "${DIST_DIR}/x1pen.js"
   for _html in "${DIST_DIR}/x1pen.html" "${DIST_DIR}/xmillennium.html" "${DIST_DIR}/url-builder.html" "${DIST_DIR}/x1basic/src/index.html"; do
       sed -i.bak "s|src=\"\([^\"?]*\.js\)\"|src=\"\1?v=${XMIL_BUILD_HASH}\"|g" "${_html}"
       sed -i.bak "s|src=\([A-Za-z_][A-Za-z0-9_./-]*\.js\)|src=\"\1?v=${XMIL_BUILD_HASH}\"|g" "${_html}"
       rm -f "${_html}.bak"
   done
   ```
   `<script src>` の `.js` だけが対象。`<link href>`（CSS）は対象外。`xmillennium.html` は emcc の出力で、属性のクォートが外れている（`href=library.css`）。
2. **PR #150 の回帰テスト**（`tests/x1basic_editor_test.mjs` の「browser builds version every HuBASIC iframe script, not just the iframe URL」）: `build.sh` から `^for _html in …; do … ^done$` を正規表現で切り出し、一時ディレクトリで `DIST_DIR`・`XMIL_BUILD_HASH` を 2 通り（abc1234・def5678）にして実行する。iframe の `index.html`（上流の写し）の全 `<script src>` に `?v=` が付くこと、親ページの合成 HTML（`<script src="parent.js">` と `<script src=unquoted.js>`）にも付くこと、上流の写しが書き換わらないことを見ている。
3. **本番で見た Cache-Control**（2026-10-29、curl -I）:
   | ファイル | Cache-Control |
   |---|---|
   | `*.js`（`x1pen-host.js` など）・`*.css`（`library.css`・`x1basic/src/style.css`）・`*.svg`・`*.png`・`x1basic/assets/x1-basic.ttf` | `public, max-age=14400, must-revalidate` |
   | `*.json`（`x1-font.json`・`hubasic/current.json`・`addrmap_versions.json`・`manifest.json`・`reloc/reloc_webapp.json`）・`xmillennium.wasm`・`lsxdodgers_*.xmst/.d88`・`slang_runtime/*.asm`・`slang_include/*.LIB`・HTML | `public, max-age=0, must-revalidate` |
   | `fuzzybasic_cold.*`・`fuzzybasic_boot.*`・`hubasic/*/*` | `public, max-age=31536000, immutable`（`html/_headers` で指定。名前に版が入る） |

   4 時間（14400）は、Cloudflare が「静的ファイル」とみなす拡張子（js・css・svg・png・ttf・woff など）にだけ付く。それ以外は Pages の既定（max-age=0）で、毎回問い合わせる。
4. `html/_headers` には max-age=14400 の指定はない（上の immutable 3 つだけ）。4 時間はゾーン側の Browser Cache TTL とみられ、オリジンの値（max-age=0）より長い。`_headers` に max-age=0 を書いても上書きされる見込みが高いので、`?v=` で直す。
5. **`?v=` が付いていない読み込みの洗い出し**（dist の HTML のタグと、`html/*.js`・`assets/x1basic/src/*.js` の `fetch`・`Worker`・`importScripts`・`addModule` などを grep）:
   - `dist/x1pen.html`: `<link rel="stylesheet" href="library.css">`
   - `dist/xmillennium.html`: `<link rel=stylesheet href=library.css>`（クォートなし）
   - `dist/x1basic/src/index.html`: `<link rel="stylesheet" href="style.css">`
   - `dist/x1basic/src/style.css`: `@font-face{…src:url('../assets/x1-basic.ttf')…}`。iframe の HTML や style.css の `?v=` は、CSS の中の url() には引き継がれない。
   - `dist/x1pen_charmap.html`（X1Pen の「Charmap」リンクで開く別ページ）: `<script src="x1pen_tokenizer.js">`。いまのループの対象ページに入っていない。
   - `html/x1pen.js` の `builtinFontBitmap`: `fetch('x1basic/assets/x1-font.json')`。同じファイルの `x1pen_slang_compiler.js`・`x1pen_hubasic.js`・`slang_runtime/`・`slang_include/` は `XMIL_BUILD_HASH` から作った `?v=` をすでに付けている（`var vBust = (XMIL_BUILD_HASH && XMIL_BUILD_HASH.indexOf('@@') < 0) ? '?v=' + XMIL_BUILD_HASH : '';`）。iframe の `src` も同じ形で付いている。
   - アイコン: `favicon.svg`・`x1pen_favicon.svg`・`apple-touch-icon.png`・`manifest.json`（`<link rel=icon|apple-touch-icon|manifest>`）。
   - JS から読むほかのもの: `xmillennium.wasm`（emscripten の既定の読み込み）、`addrmap_versions.json`・`lsxdodgers_*`・`fuzzybasic_*`（`loadRuntimeAsset`）、`reloc/reloc_webapp.json`（`cache: 'no-cache'`）、`reloc/*.REL`、`hubasic/current.json` と `hubasic/<revision>/…`、`/api/share`（Functions）。エディタの iframe の JS（`assets/x1basic/src/*.js`）には `fetch` がない（`FontFace` は利用者が選んだファイルから作る）。

## Change scope

| 読み込み | 本番のキャッシュ | 扱い |
|---|---|---|
| `library.css`（x1pen.html・xmillennium.html）、`style.css`（iframe） | 4 時間 | **付ける**: `build.sh` のループで `href` の `.css` にも `?v=` |
| `x1-basic.ttf`（style.css の url()） | 4 時間 | **付ける**: `dist/x1basic/src/style.css` の url() に `?v=` |
| `x1pen_tokenizer.js`（x1pen_charmap.html） | 4 時間 | **付ける**: ループのページに `x1pen_charmap.html` を足す |
| `x1-font.json` | 毎回問い合わせ | **付ける**（指定。`vBust` と同じ形にそろえる） |
| アイコン・manifest.json | 4 時間／毎回 | 付けない。動きに関わらず、ブラウザはアイコンを別のキャッシュで扱う。manifest の URL が毎回変わると、インストール済みのアプリから見て別のものになるおそれがある |
| `xmillennium.wasm`・`addrmap_versions.json`・`lsxdodgers_*`・`reloc/*`・`slang_*`（JS 以外）・`hubasic/current.json` | 毎回問い合わせ（または no-cache） | 付けない。ブラウザは毎回 ETag で確かめるので古くならない。付けると変わっていない wasm（数 MB）までデプロイごとに読み直しになる |
| `fuzzybasic_*`・`hubasic/<revision>/…` | immutable（名前に版） | 付けない。名前が変わるので古くならない。付けるとデプロイごとに読み直しになる |

変えるファイル:
- `build.sh`: 
  - 既存の `for _html in …; do … done` に `"${DIST_DIR}/x1pen_charmap.html"` を足し、`.css` の `href` を 2 通り（クォート付き・なし）書き換える sed を足す。`?` を含むもの・`.css` で終わらないもの（アイコン・manifest）は変えない。
  - そのすぐ後に `for _css in "${DIST_DIR}/library.css" "${DIST_DIR}/x1basic/src/style.css"; do … done` を足し、`url('…')`・`url("…")`・`url(…)` のうち、相対パス（`:` を含まない、`data:` でない、`?` を含まない）で拡張子が ttf・otf・woff・woff2・png・svg・gif・jpg・jpeg・webp のものに `?v=` を付ける。
  - コメント（「iframe の HTML の ?v= は…」）を CSS と url() の理由が分かるように直す。
- `html/x1pen.js`: `builtinFontBitmap` の `fetch('x1basic/assets/x1-font.json')` に、同じファイルの `vBust` と同じ形で `?v=` を付ける（ハッシュが `@@…@@` のまま＝開発のときは付けない）。
- `tests/x1basic_editor_test.mjs`: PR #150 のテストを広げる（下）。
- `tests/x1pen_automation_test.mjs`: 本物の dist で、読み込まれたファイルに `?v=` が付いているかを見る試験を足す（下）。
- `CHANGELOG.md`: 「Unreleased」に 1 項目（次のリリースに入る）。0.13.0 の節には入れない。

## Implementation steps

1. `build.sh` のループを直す（ページに charmap、`.css` の href の sed 2 本、コメント）。
2. `build.sh` に CSS の url() のループを足す（ループとして切り出せる形 `^for _css in …; do … ^done$`）。
3. `html/x1pen.js` の x1-font.json に `?v=`。
4. `tests/x1basic_editor_test.mjs`: PR #150 のテストを次のように広げる（テストの名前も CSS を含む形に変える）。
   - 親ページの合成 HTML に `<link rel="stylesheet" href="a.css">`・`<link rel=stylesheet href=b.css>`・`<link rel="icon" href="x.svg">`・`<link rel="manifest" href="manifest.json">` を足し、css 2 つにだけ `?v=` が付き、アイコンと manifest は変わらないことを見る。対象ページに `x1pen_charmap.html` も入れる。
   - 実物の入力でも見る: `html/x1pen.html`・`html/url-builder.html`・`html/x1pen_charmap.html`・上流の `assets/x1basic/src/index.html` をループにかけ、ローカルの `<script src>` と `rel=stylesheet` の `href` の **全部** に `?v=<hash>` が付き、ほかの `href` は変わらないことを見る。新しい script や CSS を足して付け忘れても、ループの書き方が変われば落ちる。
   - `_css` ループを上流の `assets/x1basic/src/style.css` と `html/library.css` にかけ、相対の url() の全部（いまは `../assets/x1-basic.ttf`）に `?v=<hash>` が付き、上流の写しは書き換わらないことを見る。2 つのハッシュで回す。
5. `tests/x1pen_automation_test.mjs`: 新しい試験「X1Pen と HuBASIC エディタが読むファイルは全部ビルドのコミットで版が付く」。
   - 新しい context の page で `x1pen.html` を開き、HuBASIC タブを出して iframe の `#editor` と `document.fonts.ready` を待ち、`X1PenHuBasicEditorBridge.builtinFontBitmap()` を呼ぶ（x1-font.json を読ませる）。
   - 親と iframe の両方で `performance.getEntriesByType('resource')` と `document.querySelectorAll('script[src], link[rel=stylesheet]')` を集め、同じオリジンのもので拡張子が js・css・ttf・woff・woff2・otf のもの、それと `x1-font.json` の URL に、`v=<dist の x1pen.js に入ったハッシュ>` が付いていることを見る。immutable（`fuzzybasic_*`・`hubasic/<40桁>/`）と「付けない」表のものは対象外として名前で外す。
   - ハッシュは `dist/x1pen.js` の中の `XMIL_BUILD_HASH` の値を読む（`@@` のままなら、その試験は skip ではなく失敗にする。dist は `./build.sh` で作る前提）。
6. `./build.sh` → `dist/` の HTML・CSS に `?v=` が付いたのを目で見る（grep）。
7. `X1PEN_BROWSER_EXECUTABLE=/usr/bin/google-chrome npm test` を全部通す。
8. 確認用サーバーで x1pen.html と Charmap を開き、見た目（フォント・CSS）が変わっていないこと、HuBASIC のエクスポートが Firefox（Playwright）で保存できることを見る。
9. commit → 実装レビュー（通るまで）→ PR 1 本。マージはひろしさん。

## Edge cases and test plan

- **クォートの有無**: emcc の出力（xmillennium.html）は `href=library.css`。sed はクォートなしにも当て、結果はクォート付き（`href="library.css?v=…"`）にする（script と同じ）。合成 HTML の試験で両方を見る。
- **二重付け**: `?` を含むものは対象外にする。同じループを 2 回かけても 1 つしか付かないことを試験で見る（ビルドは毎回 dist を作り直すが、念のため）。
- **アイコン・manifest を巻き込まない**: sed は `.css` で終わる href だけ。試験で icon・manifest が変わらないことを見る。
- **外部の URL**: `https://…` の href や url()（Google Fonts など）は `:` を含むので対象外（いまは無い）。`data:` の url() も対象外。
- **上流の写しは変えない**: `assets/x1basic/` は書き換えない（試験で見る）。`assets/x1basic/source.json` の sha256 は写しの検査用で、dist の書き換えには関係しない（PR #150 も同じ）。
- **開発のとき**: `XMIL_BUILD_HASH` が入っていない（`@@…@@` のまま）とき、x1-font.json には何も付けない（`vBust` と同じ）。
- **フォントの読み込みが失敗しないこと**: `?v=` 付きの URL でも Pages は同じファイルを返す（クエリは無視される。0.13.0 の本番で JS の `?v=` が動いている）。確認用サーバー（python の http.server）もクエリを無視する。自動試験の新しい試験で、フォントと CSS が実際に読まれたこと（resource timing に出ること）も見る。
- **CSP**: URL のクエリは CSP に関係しない（同じ origin のまま）。
- **戻し方**: `build.sh` と `x1pen.js` の変更を戻すだけ。データや保存形式は変えない。本番には次のリリースまで出ない。
- **残る穴**: Charmap ページ・xmillennium.html のアイコン類は 4 時間古いままのことがある（見た目だけ）。CHANGELOG と PR に書く。

## Open decisions

- アイコン・manifest.json・JSON や wasm（毎回問い合わせのもの）に付けない判断。おすすめは「付けない」（上の表の理由）。ひろしさんが全部に付けたいなら、`loadRuntimeAsset` と emscripten の `locateFile` に足す形になる（wasm の読み直しが増える）。
- 自動試験で「読んだファイル」を見る試験（step 5）は、ほかの試験より少し重い（新しい page を 1 枚開く）。おすすめは入れる（実際のページで漏れを見られるのはこれだけ）。

## Cross-review反映

### Round 1 — codex / gpt-6-astra/high
- Verdict: APPROVED (model=APPROVED; policy=strict; host_override=no)
- Implementation: READY (next_action=implement; reviewer=READY)
- 指摘なし

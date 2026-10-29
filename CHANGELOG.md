# Changelog

## Unreleased

- X1Pen の HuBASIC タブの X1 BASIC Editor を e55a98d にしました。「選択からPCG設定」が、同じ行の中でスペースやタブで区切った 16 進数も、合わせて 48 桁なら PCG の 1 文字として取り込みます（`970 DATA 0000000000010003 0007030707020301 000000000702031D` のような DATA の行）。行をまたいでは繋げません。今までの続けて書いた 48 桁の扱いは変わりません。X1Pen では、エディタの単独アプリ用のファイル名の欄は出ず、「インポート…」「エクスポート」のままです。
- X1Pen の HuBASIC の変換の仕組み（hubasic2sl とランタイム）を SLANG-compiler 55e7271 にしました（`scripts/import-hubasic-bundle.mjs`）。
  - `MIRROR$` を使えるようにしました（各バイトのビットを左右逆にする）。HuBASIC と同じく、引数が文字列の変数か配列の要素なら、その変数の中身もその場で書き換わります（`B$=MIRROR$(A$)` の後は `A$` も逆になる）。
  - `MUSIC` を使えるようにしました（`PLAY` と同じ）。
  - `HEXCHR$` を HuBASIC に合わせました。スペースを区切りとして飛ばし、スペースか終わりの前の 1 桁は 1 バイトにします。**空の文字列は Illegal function call になりました**（前は空の文字列を返していました）。前は error だった奇数の桁が通るようになりました。
  - BAS_ABI（変換結果とランタイムの組の番号）は 1 のまま、hubasic2sl の版も 0.1.0-alpha のままです。
- x1pen-mcp の HuBASIC のリファレンスを 55e7271 に合わせて見直しました（版はまだ上げていません）。
  - `MIRROR$`（引数の変数も書き換わることを、題と最初の文に書きました）と `HEXCHR$` の項目を足し、`MUSIC` を `PLAY` の項目に足しました。古くなっていた `HEXCHR$` の説明（奇数の桁は error）を直しました。
  - SLANG-compiler 55e7271 のソースと `docs/HUBASIC.md`、X1Pen 自身のコードだけから書きました。HuBASIC のマニュアルは元にしていません。
  - 公開中の x1pen-mcp 2.9.0 は 5abbffa を前提にしているので、この束の X1Pen とつなぐと `x1pen_get_language_profile` が `compatible: false`（`revisionMismatches`）を返します（ほかの道具はそのまま使えます）。Web と x1pen-mcp は一緒に出すのがよいです。
- X1Pen の HuBASIC の変換の仕組みを SLANG-compiler 10cf481 にしました（上の 55e7271 の続き）。
  - `CONSOLE [ys,yl[,xs,xl]]`（テキストの窓）を使えるようにしました。表示・折り返し・改行・スクロール・`CLS`・`INPUT` は窓の中だけで行われます。**`LOCATE`・`TAB`・`PRINT ,` の区切り・`CHARACTER$`・`SCRN$` の座標は窓の中の相対ではなく、画面の絶対の座標のまま**で、窓の外への `LOCATE` は Illegal function call です（HuBASIC と同じ）。`WIDTH` と `INIT` で窓は全画面に戻ります。
  - `PRINT` の文字列の中の `CHR$(14)`（窓の上の行からカーソルの行までを 1 行上にずらす）と `CHR$(15)`（カーソルの行から窓の下の行までを 1 行下にずらす）が効くようになりました。窓がなくても効きます（前は捨てていました）。
  - **`CONSOLE` を使わないプログラムでも見え方が変わる所**: `PRINT ,` の次の区切りが行の右端を越えるとき、右端まで空白を書いてから次の行へ折り返すようになりました（前は空白を書かずに改行していたので、行の残りの文字が残っていました）。
  - 変換した bin は、`CONSOLE` を使わなくても 140〜196 バイトほど大きくなります（作業領域は 4 バイト増え）。BAS_ABI は 1、hubasic2sl は 0.1.0-alpha のままです。
- x1pen-mcp の HuBASIC のリファレンスを 10cf481 に合わせて見直しました（版はまだ上げていません）。
  - `CONSOLE` の項目を足しました。座標が窓の相対ではなく画面の絶対であること、窓の外への `LOCATE` は error 5 であることを、題と最初の文に書きました。
  - `PRINT` の項目に `CHR$(11)`・`CHR$(12)`・`CHR$(14)`・`CHR$(15)` と `,` の区切り（画面の 10 桁ごと、右端を越えると空白を書いて折り返す）を足し、`LOCATE`・`CLS`・`WIDTH`・`INIT`・`INPUT`・`CHARACTER$`・`SCRN$` の窓での動きを書き足しました。HuBASIC との違い（折り返した行を論理行としてつながない、`INPUT` は画面を読み直さない、縦 2 倍の `PRINT#0` の折り返し）も足しました。
  - SLANG-compiler 10cf481 のソースと `docs/HUBASIC.md`、X1Pen 自身のコードだけから書きました。HuBASIC のマニュアルは元にしていません。

## x1pen-mcp 2.9.0

x1pen-mcp だけの新しい版です。X1Pen Web 0.11.0 と X1Pen Connector 1.4.0 はそのまま使えます（Web と Connector は変えていません）。

- 同梱のリファレンスに HuBASIC を足しました（`x1pen_search_reference` の `language: "hubasic"`、26 項目）。hubasic2sl が受け付ける命令・関数と引数の形、hubasic2sl だけの決まり（`VSYNC n`、`'#VSYNC n` は変換オプションの `wait` を frame にしたときだけ効く）、`DEFCHR$` のバイトの並び（青 8 バイト → 赤 8 → 緑 8。FuzzyBASIC の `PCGDEF` とは並びが違う）、まだ無いもの、HuBASIC との違い、error の番号、X1Pen での変換オプションなどです。
  - X1Pen に入っている hubasic2sl（SLANG-compiler 5abbffa）のソースと `docs/HUBASIC.md`、X1Pen 自身のコードだけから書きました。HuBASIC のマニュアルは元にしていません。各項目に元にしたリビジョンを残しています。
  - X1Pen の HuBASIC の束を入れ替えたら、リファレンスも見直します。見直して profile のリビジョンを書き直すまで `tests/x1pen_reference_test.mjs` が失敗します（`scripts/import-hubasic-bundle.mjs` も最後に知らせます）。
  - 例のプログラムは、試験で本物の変換・組み立てを通しています。まだ無い命令が、書いてある error の番号になることも、`DEFCHR$` の並びも、試験で確かめています。
- `x1pen_get_language_profile` が、X1Pen 0.11.0 とつなぐといつも `compatible: false` を返していたのを直しました。X1Pen が報告する HuBASIC の profile がリファレンスに無かったためです。あわせて、X1Pen が HuBASIC の変換の仕組みを読み込んだあとは、そのリビジョンもリファレンスと比べ、違えば `compatible: false` と `revisionMismatches` を返します。
- 道具の説明とサーバーの説明に、HuBASIC の文字は読み出すと決まった書き方で返る（`\xB1` は `ｱ` など）こと、hash は返ってくる形で計ること、比べるなら読み直した文字と比べることを足しました。動きは変えていません。

## X1Pen Web 0.11.0 / x1pen-mcp 2.8.0 / Connector 1.4.0

3 つとも新しい版です。公開の順番は x1pen-mcp → X1Pen Web → X1Pen Connector です。どの段階で止めても、黙って壊れる組み合わせはありません（下の「版の組み合わせ」）。

### X1Pen Web 0.11.0

- X1Pen に HuBASIC タブを追加しました（試験中）。RUN すると、HuBASIC を SLANG に変換し（hubasic2sl をブラウザの中の .NET wasm で実行）、OS なしの x1native 環境の機械語に組み立て、HuBASIC の IPL で起動できるディスクを作って FDD0 から起動します。変換の仕組みとランタイムは SLANG-compiler の同じリビジョンから取り込みます（`scripts/import-hubasic-bundle.mjs`）。読み込むときに、リビジョンと BAS_ABI（変換結果とランタイムの組の番号）が変換の仕組み・ランタイム・manifest で揃っていることを確かめます。
- X1Pen の HuBASIC タブの編集欄を **X1 BASIC Editor**（https://github.com/ho-ogino/x1-basic-editor、MIT）にしました（試験中）。
  - プログラムを X1 の文字コードのバイト列のまま扱い、X1 の字形で表示します。カナ・グラフィック文字・制御コード・PCG の表示に対応します。RUN ではそのバイト列を変換に渡します。
  - エディタは決まったコミットを `scripts/import-x1-basic-editor.mjs` で `assets/x1basic/` に写して使います。iframe で開くため、`x1basic/` だけ同じサイトからの埋め込みを許すヘッダーを足しました。
  - 自動操作の `hubasic` の文字列では、$5C を `¥`、記号を `\{name}`／`\xHH` で書きます。前の版で保存した HuBASIC のプログラムは、最初に一度だけ移します。
  - 内蔵の字形（X1 互換フォント／美咲フォント）のライセンス表示を足しました。
  - エディタを 31f309b にしました。閉じた文字列にマウスを置いて少し待つと、矢印の制御コードで並べたとおりの 1 枚の絵（通常の文字と PCG）を出します。通常の文字も 8×8 のドットのまま描くので、ぼけません。取り込みの道具（`scripts/import-x1-basic-editor.mjs`）は、エディタのページが読むファイルを写し漏らしたときは止まるようにしました。
- X1Pen の HuBASIC タブに「Options」を足し、hubasic2sl の変換のオプションを設定できるようにしました（試験中）。
  - 設定できるのは、速度（`--wait`）、行番号を記録しない（`--no-line-numbers`）、型の無い変数を整数にする（`--assume-defint`）、文字列の長さの上限（`--string-len`）、静的データの上限（`--data-budget`）です。
  - 設定はすべての HuBASIC プログラムに共通で、ブラウザに保存します。触っていなければ、変換はこれまでと同じです。
  - 自動操作には `getHuBasicOptions` / `setHuBasicOptions` を足しました。
  - x1pen-mcp 2.8.0 から読み書きできます（下の「x1pen-mcp 2.8.0」）。
- X1Pen の Z80 アセンブラが、文字の定数 `','`、`#IF exists` で前に定義されたラベル（AILZ80ASM と同じ順の扱い）を正しく扱うようにしました。
- X1Pen のプロジェクトディスクの RUN で、直前に解像度（高解像度・標準）やディスクの種類を切り替えると「本体設定を適用できませんでした」で止まっていた問題を修正しました。設定は電源を入れ直したときに反映されるので、起動のあとで確かめるようにしました。
- X1Pen の RUN で、作ったディスクを書き込めなかったときは、起動せずに失敗として止まるようにしました（これまでは前のディスクのまま起動することがありました）。
- X1Pen の RUN で前のプログラムがディスクに書き込んでいたとき、まだ書き戻していないトラックが新しく作ったディスクの上に書き戻され、ディスクが壊れることがあった問題を修正しました。前のディスクを取り出してから新しいディスクを書き込みます。
- X1Pen の HuBASIC タブのプログラムを Share できるようにしました（試験中）。
  - 共有には、プログラムを X1 の文字コードのバイト列のまま、変換のオプション（既定と違うものだけ）、MODEL を載せます。
  - 開くと、それらで RUN します。開いた人の保存済みのプログラムや設定は変えません。
  - 共有を保存するサーバー（`functions/api/share.js`）が、HuBASIC だけの共有を受け付けるようにしました。あわせて、JSON が object でない共有は 500 ではなく 400 で断るようにしました。

### x1pen-mcp 2.8.0

- x1pen-mcp が X1Pen の HuBASIC タブに対応しました（試験中）。
  - HuBASIC のプログラムを、ほかのモードと同じ道具で読む・探す・差分を取る・編集する・置き換えることができます（`sourceMode: "hubasic"`、`hubasic` セクション）。これまでの 2.7.x は、X1Pen が HuBASIC のプログラムを持っている間、`invalid source mode` で止まっていました。
  - 変換オプションを読む `x1pen_get_hubasic_options`、変える `x1pen_set_hubasic_options` を足しました。オプションはプログラムに含めません（revision も変わりません）。
  - X1Pen・X1Pen Connector・x1pen-mcp に feature `hubasic.options` を足しました。Connector は 2 つの命令を中継します。HuBASIC のプログラムは、今の Connector（1.3.0）のままで通ります。
  - HuBASIC タブの無い X1Pen では、HuBASIC の読み書きを X1Pen の更新を案内して断ります。ほかのモードの動きと hash は変わりません。
- ローカルの UTF-8 のファイルから 1 つのセクションを置き換える `x1pen_set_source_file` を足しました（#111）。読めるのは起動の引数 `--allow-source-root` で許したフォルダの中だけで、ファイルのパスと中身はモデルに返しません。
  - FIFO などの普通のファイルでないものは、開く前に断ります。

### X1Pen Connector 1.4.0

- x1pen-mcp からの HuBASIC の変換オプションの読み書き（feature `hubasic.options`）を中継します。
- manifest の権限は 1.3.0 から増えていません。

### 版の組み合わせ

- x1pen-mcp 2.7.x は、X1Pen が HuBASIC のプログラムを持っている間、`x1pen_get_program` などが `invalid source mode` で止まります（ほかのモードは使えます）。2.8.0 で直りました。
- x1pen-mcp 2.8.0 は X1Pen Connector 1.3.0 のままでも HuBASIC のプログラムを扱えます。変換オプションの道具だけ、Connector 1.4.0 以上を案内します。
- x1pen-mcp 2.8.0 は HuBASIC タブの無い X1Pen Web 0.10.1 でも、ほかのモードを今までどおり扱います。

## X millennium Web / X1Pen Web 0.10.1

- 表示中の文字の PCG を定義し直したとき（Hu-BASIC の `DEFCHR$`、FuzzyBASIC の `PCGDEF` など）、画面に反映されなかった問題を修正しました。PCG の書き換えによるアニメーションが動くようになります。
- Linux（大文字小文字を区別するファイルシステム）でもビルドとテストができるよう、`#include` のファイル名を実際のファイル名の大文字小文字に合わせました。macOS で使われるヘッダは変わりません。
- Webのみのパッチリリースです。X millennium WebとX1Pen Webの共有製品バージョンを0.10.1へ更新します。x1pen-mcpは2.7.0、X1Pen Connectorは1.3.0に据え置き、今回のWebリリースではnpm公開・ストア再提出は行いません。

## X millennium Web / X1Pen Web 0.10.0

- Google Drive／Dropboxの公開共有URLからRelay経由でFDD、HDD、CMTを読み込むURL Builderを追加しました。外部メディアの変更はprovider sourceごとのbrowser-local copyへ保存され、同じURLを再度開いたときに再利用されます。
- URL起動を通常のmount設定から隔離する`External Session`を追加しました。URL fragmentは再読み込み用に保持し、指定されていないslotは空のまま開始し、通常の`xmil_mount_state`は復元・変更しません。
- URL Builderから320KiB〜16MiBのzero-filled一時EMMを最大10 slotへ指定できるようにしました。一時EMMはbrowser storageへ保存されず、ejectまたはreloadで消去されます。
- URLの`model` parameterでX1／X1turbo／X1turboZを一時選択できるようにしました。保存済みの通常MODEL設定は変更しません。
- Share URLのsource／media隔離と、保存済みmediaがmount中のShare拒否を追加しました。
- 24kHz underline対応text rendererで、ANK、PCG、ROM漢字glyph下部のクリッピングを修正しました。
- X millennium WebとX1Penは現在同じ`html/x1pen-version.js`をbuild時の製品version sourceとして共有するため、両方の表示・descriptor versionが0.10.0になります。X1Pen editor、Automation／bridge protocol、feature IDには今回変更がありません。
- x1pen-mcp 2.7.0とX1Pen Connector 1.3.0は変更せず、npm publish、再pack、store再提出を行いません。

## X1Pen Web 0.9.2

- Share URLを開いたページを一時的なShare modeとして隔離し、保存済みのsourceやmediaを復元・変更せず、保存済みmediaのmountも拒否するようにしました。
- 保存済みのFDD、HDD、CMT、EMMが挿入されている間はShare URLの生成を拒否するようにしました。一時的なPROGRAM diskは引き続きShareできます。
- Webのみのパッチリリースです。x1pen-mcp 2.7.0とX1Pen Connector 1.3.0に変更はなく、再公開・再提出は不要です。

## X1Pen Web 0.9.1

- 24kHzアンダーライン対応テキスト経路で、ANK、8-dot PCG、16-dot PCG、ROM漢字の下部がクリッピングされる問題を修正しました。
- Webのみのパッチリリースです。x1pen-mcp 2.7.0とX1Pen Connector 1.3.0に変更はなく、再公開・再提出は不要です。

## X1Pen 0.9.0 / x1pen-mcp 2.7.0 / Connector 1.3.0

### X1Pen Web 0.9.0

- 書き込み可能なLSX-Dodgers diskを元に、非破壊のworking copyを作るproject disk機能を追加しました。project diskからのRUNはcold startとなり、X1／X1turbo／X1turboZのMODELを選べます。
- ディスクなしで作ったBASIC／SLANGプログラムの一時PROGRAM diskを保存し、project diskの安全なベースとして再利用できるようになりました。
- SLANGに`STICK`と`TATTR`を追加し、runtime呼出しの引数個数検証を強化しました。
- SLANGタブにbinary Importを追加しました。
- Z80 assemblerの`#IF`で`&&`、`||`、`!`を利用できるようになりました。
- NMI操作がIPL resetの代用ではなく、実際のZ80 NMIを発生するようになりました。
- 物理キー入力の取りこぼし、M8ALOADのbrowser assembly経路を修正しました。
- source revision／hash／epochを追加し、page reloadや競合をまたぐ古い編集を検出できるようにしました。
- timing、`INKEY`、inline assembly、大量書き込み、SLANGの`{}`推奨記法などのreferenceを更新しました。

挙動が変わる点:

- project disk RUNはcold startのため、RAM、VRAM、PCGと未保存のmachine stateが消えます。MODEL切り替えはこの経路だけで利用できます。
- NMIはresetではなくなりました。再起動が必要な場合はIPL Resetを使用してください。
- staleなsource更新と、引数個数が不正なSLANG runtime呼出しは、誤動作させず明示的に拒否します。

### x1pen-mcp 2.7.0

- `x1pen_send_key`、`x1pen_set_pad`を追加しました。
- bounded source read/search、`x1pen_diff_source`、`x1pen_apply_edits`を追加しました。
- revision／hash／epochに基づくsource conflict guardを追加しました。
- 旧Connectorでもsourceの読み書きを継続できるgraceful degradationを追加しました。
- project disk、MODEL、実行、入力、SLANG／FuzzyBASIC／Z80 assemblyのreferenceを更新しました。

Connector 1.2.0ではsource read/writeを`revision-only` modeで継続できますが、reloadをまたぐ完全な競合防止、`x1pen_diff_source`、remote key入力、remote pad入力は利用できません。完全な機能にはConnector 1.3.0以降が必要です。

既知の制約: `x1pen_send_key`の成功は指定時間のkey down／up dispatch完了を表し、guestが入力を消費したことまでは保証しません。background tabや高負荷では短い入力を取りこぼす一方、長い`durationMs`はresponsiveなguestの`INKEY(1)`などでkey repeatとして複数回返る場合があります。画面またはdebugger memoryでguest側の反応を確認し、program側でrelease待ち／debounceを行ってください。反応がなく、同じkeyの再送がprogram上安全な場合だけ再送してください。

### X1Pen Connector 1.3.0

- X1Penの表示中emulatorへ送る、許可済みのbounded key入力とactive-low joystick pad入力を追加しました。
- disconnect、reload、session変更、bridge終了、emulator resetで保持中のpad入力を解放します。
- source revision epoch／capability descriptor／source-sync transportと構造化errorを追加しました。
- manifest permissionは1.2.0から増えていません。

### Project diskとMODELについて

- project diskには、書き込み可能なsingle-member LSX-Dodgers形式のD88／2Dが必要です。起動には`LD.BIN`と`AUTOEXEC.BAT`、BASICには`FZBASIC.COM`が必要です。X1PenはBASICの`PROGRAM.BIN`／`AUTORUN.BAS`、SLANGの`PROG.COM`をworking copyへ書き込みます。
- 一時PROGRAM diskをSaveして再登録する方法なら、`MAGIC.BIN`、`PSGAKM.BIN`、`PSGAKG.BIN`などの同梱fileも保持されます。
- MODEL切り替えはproject diskのcold-start RUN限定です。通常のRUNでは切り替えられません。
- cold startではRAM、VRAM、PCGが消去されます。
- ROM未登録時はstub BIOSを使います。実IPL ROMとは動作が異なる場合があるため、必要に応じてX1用`IPLROM.X1`、turbo／turboZ用`IPLROM.X1T`を登録してください。

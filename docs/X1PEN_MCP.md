# X1Pen MCP Connector

X1Pen MCP Connectorは、ユーザーがChromeまたはEdgeで開いているX1PenタブをCodex / Claude Codeから操作するためのローカル連携機能です。AI専用ブラウザーを起動するのではなく、人間とAIが同じエディターとエミュレーターを使用します。

## 対応環境

- Windows / macOS: Chrome、Edge
- Linux: Chromium系ブラウザー（ベストエフォート）
- Brave、Vivaldiなど: ベストエフォート
- Firefox、Safari: 現時点では対象外

Node.js 20以降が必要です。通信はstdioと`127.0.0.1`だけを使用します。

## セットアップ

MCPサーバーはnpmパッケージとしてX1Pen本体から独立して配布します。MCPサーバーを動かすために、このリポジトリをcloneする必要はありません。最新版へ追従するため、設定ではnpmの`latest`タグを指定します。更新を反映するにはCodexまたはClaude Codeを再起動してください。

### Codex

CodexのMCP設定に以下を追加します。

```toml
[mcp_servers.x1pen]
command = "npx"
args = ["-y", "x1pen-mcp@latest"]
startup_timeout_sec = 30
tool_timeout_sec = 60
```

Codexを再起動後、`codex mcp list`で登録を確認します。

### Claude Code

userスコープへ登録すると、任意のプロジェクトからX1Penを利用できます。

```bash
claude mcp add --transport stdio --scope user x1pen -- \
  npx -y x1pen-mcp@latest
claude mcp list
```

プロジェクト単位で共有する場合は、対象プロジェクトの`.mcp.json`へ以下を追加します。初回起動時にプロジェクトMCPサーバーを承認してください。

```json
{
  "mcpServers": {
    "x1pen": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "x1pen-mcp@latest"]
    }
  }
}
```

### 拡張機能

Chrome Web Store版の公開後はストアからインストールする方式を推奨します。ストア審査中または拡張機能を開発する場合は、次の手順でunpacked extensionを読み込みます。

1. Chromeで`chrome://extensions`、Edgeで`edge://extensions`を開く
2. Developer modeを有効化
3. Load unpackedを選択
4. このリポジトリの`extension/`ディレクトリを指定

MCPサーバーのnpm配布とブラウザー拡張の配布は独立しており、拡張機能の更新にMCPパッケージの再公開は不要です。Chrome Web Storeの掲載URLは初回審査通過後に本書へ追記します。

## 接続

1. AIに`x1pen_connection_info`を呼ばせ、bridge portと6桁のpairing codeを確認
2. Automation API v2を含むX1PenをChrome / Edgeで開く
3. X1Pen Connector拡張を開く
4. bridge portとpairing codeを入力
5. `Connect this tab`を押す

接続されたX1Penには`MCP Connected`と表示されます。複数タブを接続した場合は`x1pen_list_sessions`と`x1pen_select_session`で操作対象を選びます。通常はX1Pen自身の複数タブ警告により1タブだけが接続されます。選択変更時は旧タブのMCP pad入力を2秒以内に解放してから切り替えます。解放に失敗した場合は`PAD_RELEASE_FAILED`となり選択を維持します。旧タブを切断／再読込できない場合に限り`force: true`で切り替えられますが、その応答には「旧タブで入力が保持され得る」というwarningが含まれます。

### バージョンと機能互換性

`x1pen_connection_info`、`x1pen_list_sessions`、`x1pen_get_status`は、MCPサーバー、Connector、X1Penのバージョンと実効capabilityを返します。バージョンは診断と更新案内に使用し、実際の利用可否は3コンポーネントが申告するfeatureの積集合で決定します。

feature IDは完全一致する不変の契約です。現在は`automation.core`、`automation.run-recovery`、`screen.capture`、`input.keyboard`、`input.pad`、`debugger.cpu`、`debugger.vram`を使用します。後方互換性のない変更では既存IDの意味を変更せず、`debugger.vram-v2`のような新しいIDを追加します。

公開済みのConnector 1.0.1、1.1.0、1.1.1だけは、明示featureがないためMCPサーバーが既知の機能を推定します。この表は歴史的互換性のために凍結されており、Connector 1.2.0以降は明示featureを申告します。未対応機能はConnectorへ送信する前に拒否され、`component`、`feature`、現在版、必要な場合は必要版、対処方法を含む機械可読エラーが返ります。

## ツール

| Tool | 内容 |
|---|---|
| `x1pen_connection_info` | 拡張機能の接続情報を取得 |
| `x1pen_list_sessions` | 接続済みX1Penタブを一覧表示 |
| `x1pen_select_session` | 旧タブのpadを解放してから操作対象タブを選択 |
| `x1pen_get_language_profile` | 同梱言語／X1ハードウェアprofileと接続中X1Penの言語profileを確認 |
| `x1pen_search_reference` | FuzzyBASIC / SLANG / 内蔵Z80アセンブラ / X1ハードウェアリファレンスを要約検索 |
| `x1pen_get_reference` | 検索結果のIDを指定して詳細を上限付きで取得 |
| `x1pen_get_program` | メタデータと明示指定した完全ソースを取得 |
| `x1pen_get_source` | 1セクションを行範囲・文字数上限付きで取得 |
| `x1pen_search_source` | 1セクションをリテラル検索し、限定した前後行を取得 |
| `x1pen_diff_source` | full source-sync時に保持済みbaselineと現在の1セクションを上限付きline diffで比較 |
| `x1pen_apply_edits` | full時はepoch/revision、縮退時はrevisionをguardに構造化された行編集を適用 |
| `x1pen_set_program` | full時はepoch/revision、縮退時はrevisionをguardにプログラム全体を更新（新規作成・全置換用。sourceModeで非対象のsectionは入力してもclear） |
| `x1pen_validate` | 実行せずにコンパイル、アセンブル、トークナイズ（SLANG生成ASMは一時出力でprogramには保持しない） |
| `x1pen_run` | ユーザーが開いているX1Penで実行 |
| `x1pen_recover_stalled` | stallしたRun準備を、データ損失確認後のタブ再読込で復旧 |
| `x1pen_send_key` | 表示中のX1Penエミュレーターへ許可済みの1キーを送信 |
| `x1pen_set_pad` | 表示中のX1Penエミュレーターのjoystick portへactive-low byteを設定 |
| `x1pen_stop` | ESCを送信して停止 |
| `x1pen_get_status` | 接続、ロック、実行状態を取得 |
| `x1pen_capture_screen` | 640x400のエミュレーター画面をPNG取得 |
| `x1pen_debug_get_state` | Z80の停止理由、レジスタ、メモリマッピングを取得 |
| `x1pen_debug_pause` | Run準備完了後にZ80を一時停止 |
| `x1pen_debug_resume` | Z80実行を再開 |
| `x1pen_debug_step` | 停止位置から1〜100命令をステップ実行 |
| `x1pen_debug_set_breakpoints` | PCブレークポイントを一括置換・解除 |
| `x1pen_debug_read_memory` | 現在の64KBアドレス空間を範囲指定して16進取得 |
| `x1pen_debug_get_video_state` | 現在機種、画面寸法、表示／アクセスbankを取得 |
| `x1pen_debug_read_vram` | テキスト／属性／漢字／グラフィックVRAMを副作用なしで16進取得 |
| `x1pen_debug_write_vram` | 停止中にVRAMへ連続16進データを書き込み |
| `x1pen_debug_wait_for_pause` | 条件に一致する停止まで待機 |

AIによる更新、検証、実行、停止中はエディターとツールバーを一時的にロックします。MCP・Connector・X1Penの3コンポーネントがすべて`automation.source-sync`をadvertiseする場合、`x1pen_set_program`と`x1pen_apply_edits`は取得済みの`revisionEpoch`と`revision`を要求し、途中の人間編集やタブ再読込を検出して上書きを拒否します。いずれかが旧版または判定不能の場合は従来のnumeric revision guardへ縮退します。読み取り・書き込み結果の`guardedWritesReloadSafe: false` / `writeGuard: "revision-only"`は、再読込後に同じrevision値へ戻る衝突を検出できないことを示します。

縮退時も`get_program`、`get_source`、`search_source`、`set_program`、`apply_edits`は利用できます。`diff_source`だけは3コンポーネントすべてのsource-sync対応が必要です。旧Connector × 新MCP × 新X1Penでは、X1Penがepochを返しても旧Connectorが書き込み時のepochを転送しないため、書き込み結果は必ずrevision-onlyと表示されます。`apply_edits`は最終書き込み直前にもrevision・epoch（取得可能時）・mode・hashを再確認しますが、その再確認から書き込みまでの短い区間はatomicではありません。

`x1pen_set_program`は完全置換です。`sourceMode: "slang"`では`basic`と`asm`、`sourceMode: "asm"`では`basic`と`slang`、`sourceMode: "basic+asm"`では`slang`が、非空で入力されても保持されずclearされます。現在modeの一部だけを安全に変更して他のauthoring sectionを保持する場合は`x1pen_apply_edits`を使います。SLANGの`x1pen_validate`が返す`output.generatedAsmLines`と`output.asmBytes`は一時compile/assemble結果の量であり、programのASM sectionには書き戻しません。生成ASMを保持して読む必要がある場合は`x1pen_run`後にprogramを再取得します。

### 大きな生成アセット表

通常のプログラムは、ソース全体が16 KiBやそれ以上でも長さだけでは警告対象にしません。書き込もうとする変更本文が、既知の8 KiB（8,192 bytes）以上のアセットをほぼ全量埋め込む場合、または8個以上連続するbyte値の表に合計8,192個以上のbyte literalがあり、その表が変更本文の非空白文字の50%以上を占める場合だけ、大きなアセット表として扱います。byte literalは`$00`〜`$FF`、`0x00`〜`0xFF`、10進の`0`〜`255`です。ASMは`DB`／`DEFB`行、BASICは`DATA`行、SLANGは配列初期値のカンマ区切りだけを数えます。

この条件に該当した場合、AIは利用者がtoken・時間コストを明示的に了承するまで、アセット本文を読んで再出力したり、警告を避けるため分割したりしません。対象sectionに合わせて、現在利用できる手動経路を案内します。

- ASM: 既存の **Import** ボタンでbinaryを`DB`行へ変換します。
- SLANG: 既存の **Import** ボタンでbinary array値をcursor位置へ挿入します。byte列をAIへ送る必要はありません。runtime fileとして使う場合はDisk Editorでproject diskへbinaryを追加し、用途に応じて`MAGLOAD`または`FOPEN`／`FREAD`を使います。
- BASIC: Disk Editorでproject diskへbinaryを追加し、`BLOAD`または該当するfile処理を使います。`DATA`埋め込みが必要なら、用意済みtextを指定位置へ利用者が貼り付けます。

了承後はguardを維持した1回の書き込みを優先し、clientの出力上限で不可能な場合だけ分割します。既存source全文を読む必要はなく、metadata-onlyの`x1pen_get_program`と挿入位置周辺だけの検索・取得を使います。local UTF-8 source-file同期は、接続中MCPが実際に提供し、利用者がfile accessを設定済みで、完全なsource section fileがある場合だけ候補にします。raw binaryやsource断片のimportとしては案内しません。

### エミュレーターへのキー入力

`x1pen_send_key`は、接続中かつ表示中のX1Penタブのエミュレーターだけへ、1つのdown／hold／upライフサイクルを送ります。OSキーボード入力、任意JavaScript、文字列、複数キーのchordは公開しません。`durationMs`は80〜2000 msの整数（既定80 ms）です。成功はローカルでkey-upまでdispatchしたことを表し、実行中プログラムがキーを消費したことまでは保証しません。

background tabや高負荷でguest実行が遅れると、bounded hold中にguestがkeyを読めず、key-up後に入力が残らない場合があります。blocking `INKEY`などへ送るときは長めの`durationMs`を指定し、`x1pen_capture_screen`またはdebugger memoryでguest側のacknowledgementを確認してください。ackがなく、同じkeyを複数回処理しても安全なprogramである場合だけ再送します。

`code`はX1Penが内部で使用するWindows互換virtual-key整数です。主な値は`0x30`〜`0x39`（数字）、`0x41`〜`0x5A`（A〜Z）、`0x70`〜`0x7B`（F1〜F12）、`0x0D`（Enter）、`0x1B`（ESC）、`0x20`（Space）、`0x25`〜`0x28`（矢印）です。numpadとJIS/OEM記号キーも許可済みですが、Shift／Control／Alt、Caps／Kana／IMEのようなmodifier・latchキーは対象外です。たとえば文字Aの入力は次のように指定します。

```json
{
  "code": 65,
  "durationMs": 80
}
```

RUN、PROG、MCPキー入力は同じ合成キーqueueを共有するため、各キー列のdown→upは相互に割り込みません。同時に2件目のMCPキーを要求すると`INPUT_IN_PROGRESS`、背景タブでは`INPUT_TAB_NOT_VISIBLE`、旧版X1Penでは`FEATURE_UNAVAILABLE`または更新案内を返します。キー要求や結果をConnectorのstorageへ保持しません。

### エミュレーターへのpad入力

`x1pen_set_pad`は、表示中のX1Penへ`port`（1または2）と`bits`（0〜255）を送り、PSG register 14／15で読むjoystick入力へactive-lowで合成します。0のbitが押下、1が解放です。`bits: 255`はrelease操作として扱い、背景タブや実行中の別automation操作でも直ちに解放を試みます。

| bit | mask | 入力 |
|---:|---:|---|
| 0 | `01H` | Up |
| 1 | `02H` | Down |
| 2 | `04H` | Left |
| 3 | `08H` | Right |
| 4 | `10H` | Button 4 |
| 5 | `20H` | Button 2 (B) |
| 6 | `40H` | Button 1 (A) |
| 7 | `80H` | Button 3 |

port 1と2の状態は独立し、物理gamepad／JoyKey入力とはAND合成されます。公開byteはraw PSG入力契約なので、MCP padにはユーザー設定のbutton swapやrapid変換を適用しません（物理入力のswap／rapid処理後に合成します）。PSGのsound registerやguestのOUT命令は変更しません。press要求は表示中タブだけで受け付け、RUN、PROG、キーと共通の非割込みqueueを使います。別のpad pressが処理中なら`PAD_INPUT_IN_PROGRESS`、背景タブなら`INPUT_TAB_NOT_VISIBLE`を返します。

保持状態は`bits: 255`のほか、Connector切断、MCP bridge終了、タブ再読込／session消失、session切替、machine resetで解放されます。MCP serverとbridgeは同じprocess内にあり、stdioのEOF／closeもbridge shutdownを開始するため、Connector側の切断cleanupへ到達します。通信断では相手がすでに消失している場合もあるため、最終的な安全弁としてタブ再読込またはmachine resetを使用してください。pad要求や結果をConnectorのstorageへ保持しません。

### 言語・X1ハードウェアリファレンス

MCPパッケージには、X1Pen FuzzyBASIC 1.2L（X1 / LSX-Dodgers版）、X1Pen内蔵SLANGコンパイラ、内蔵Z80アセンブラ、X millennium Webが実装するX1ハードウェアに対応する構造化リファレンスが同梱されています。ブラウザー未接続でも検索できるため、プログラム作成前に仕様を確認できます。MCP初期化時にも「一般的なBASIC、C、別バージョンのSLANGや別のアセンブラから仕様を推測しない」こと、X1のCPUメモリ／I/O空間／VRAMを混同しないこと、生成前のリファレンス検索、生成後の検証をクライアントへ通知します。

schema v2の`symbols`と`relatedIds`による索引はFuzzyBASIC、SLANG、内蔵Z80アセンブラ、X1ハードウェアの全profileへ適用しています。SLANGは内蔵コンパイラの予約語表と、`x1pen.js`が実際に読み込むruntime/includeファイルから公開シンボルを検査します。アセンブラは内蔵実装の全命令語、X1ハードウェアは現在の`Z80_In` / `Z80_Out`から到達する全I/Oハンドラを検査し、更新時に未収録項目が生じるとテストで検出します。

最初に`x1pen_get_language_profile`を呼ぶと、同梱profileを確認できます。X1Penへ接続済みなら、ブラウザーが報告したprofile IDとの互換性も返します。

リファレンスは全件取得せず、`x1pen_search_reference`で必要な項目を検索します。応答は短い要約とstable IDだけです。全検索語を含む項目がない場合のみ部分一致へ切り替わり、`matchMode: "partial"`が返ります。

```json
{
  "language": "slang",
  "query": "tile sprite scroll",
  "maxResults": 5
}
```

FuzzyBASICの固有構文は記号や日本語でも検索できます。

```json
{
  "language": "fuzzybasic",
  "query": "メモリ配列 A%[I]",
  "maxResults": 5
}
```

内蔵Z80アセンブラの書式も独立profileとして検索できます。

```json
{
  "language": "z80asm",
  "query": "条件アセンブル macro",
  "maxResults": 5
}
```

必要な項目だけ`x1pen_get_reference`で取得します。1回に指定できるIDは10件までで、既定の応答上限は32 KiBです。

```json
{
  "ids": ["slang.include.tile-sprite"]
}
```

FuzzyBASICについては、メモリ／I/O配列、16bit値と変数制約、PROC/FUNC、スタック、機械語連携、LSX-Dodgersファイル処理、X1のグラフィック・PCG・PSG・JOYまで収録しています。一般言語構文は原典を参照しますが、OS、ファイル、コンソール、メモリ配置、X1拡張の挙動はLSX-Dodgers移植ソースを優先しています。全トークナイザ予約語がリファレンスの`symbols`でカバーされることと、代表サンプルが現在のX1Pen tokenizerで処理できることを自動検証しています。

SLANGについては、正確なコンパイラrevision、`ENV_TYPE=1`のLSX-Dodgers環境、予約語と文字列関数、native FLOAT、LSXファイル、X1の画面／描画／PCG／PSG／VSYNC／SGL、圧縮・画像ローダ、同梱される8本のinclude APIを収録しています。網羅catalogには内部実装シンボルも含まれるため、通常は検索結果の専用項目を優先してください。ゲーム開発で利用するPCGについては、FuzzyBASICの`PCGDEF` / `TCOLOR`、SLANGの`PCGDEF` / `PCGDEFS`、24-byte BRGパターン形式、TILELIBとの初期化順序まで独立項目として収録しています。未知のAPIや複雑な引数規約については、リファレンス確認後も`x1pen_validate`で検証してください。

内蔵Z80アセンブラについては、数値／文字列／式、global・local labelとnamespace、`ORG` / `EQU` / `DB` / `DW` / `DS` / `ALIGN`、条件アセンブル、macro、受理される全命令語を収録しています。X1のI/Oは16bit portを使うため、一般的な8bit immediate portを推測せず、`LD BC,port`と`IN A,(C)` / `OUT (C),A`の形を確認してください。全項目の例を現在の内蔵アセンブラで自動検証しています。

X1ハードウェアについては、Z80のCPUメモリと16bit I/O空間の分離、X1turbo/Zの低位バンクRAM、テキスト／属性／漢字VRAM、グラフィックVRAMのbankとB/R/G plane、同時アクセス、画面制御、PCG／paletteに加え、PPI・sub CPU、PSG・joystick、OPM、CTC、DMA、SIO・mouse、FDC、SASI、EMM・ROM board、漢字ROM、turboZ拡張を収録しています。VRAMをCPUバンク切替で参照できるとは推測せず、デバッガでは`x1pen_debug_read_memory`と`x1pen_debug_read_vram`を目的に応じて使い分けてください。収録範囲は現在のX millennium Webビルドが実際にdispatchする機能であり、未実装の実機拡張は掲載しません。

### 大きなプログラムの扱い

`x1pen_get_program`は引数なしの場合、`sourceMode`、利用可能なら`revisionEpoch`、`revision`、`guardedWritesReloadSafe`、`writeGuard`、`authoringHash`、各セクションの行数・文字数・UTF-8 byte数・hashを返します。hashはexact UTF-8 byte列の`sha256-utf8-v1`で、改行を正規化しないためLFとCRLFは異なります。完全ソースが必要な場合だけ`fields`を明示します。SLANGから生成されたASMは`generatedContentHash`としてauthoringHashから除外され、`includeGeneratedAsm: true`を明示しない限り本文を返しません。SLANGのRunだけでrevisionと生成ASM hashが変化し、authoringHashが変わらない場合がありますが、自動retryの許可にはなりません。完全取得には既定で128 KiBの上限があり、超えるソースは`x1pen_get_source`で分割取得します。

```json
{
  "fields": ["slang"],
  "includeGeneratedAsm": false
}
```

大きなソースは、まず`x1pen_search_source`で位置を探し、`x1pen_get_source`で必要な範囲だけを取得します。旧版またはcapability不明のページでも、Automation APIが対象sectionを文字列として返す限りbounded read/searchは利用できます。section自体が欠落している場合は、空文字の正当な空ソースと区別して`SOURCE_CONTENT_UNAVAILABLE`を返します。

```json
{
  "section": "slang",
  "startLine": 100,
  "lineCount": 200,
  "maxCharacters": 32768
}
```

既存プログラムの変更には、全置換ではなく`x1pen_apply_edits`を使用します。行番号は1始まりで、同一リクエスト内の編集範囲は重複できません。`expectedRevisionEpoch`はschema上optionalですが、full source-sync時は必須です。縮退時は省略でき、指定されて現在のepochも得られる場合はbest-effortで事前照合します。応答には新しいepoch/revision、guard mode、hash、変更行数だけが含まれ、完全ソースは返りません。

```json
{
  "section": "slang",
  "expectedRevisionEpoch": "取得時のrevisionEpoch",
  "expectedRevision": 3,
  "edits": [
    {
      "startLine": 120,
      "deleteLineCount": 4,
      "text": "replacement source"
    }
  ]
}
```

### 競合時の比較手順

`REVISION_MISMATCH`はnumeric revisionの編集競合、`REVISION_EPOCH_MISMATCH`はcallerのepochと現在のprogram epochの不一致、`REVISION_EPOCH_REQUIRED`はfull source-sync接続なのにepochを省略したcallerを表します。epoch不一致の原因をreloadとは断定しません。全componentがsource-syncをadvertiseしているのにX1Pen snapshot自体にepochがない不整合は`REVISION_EPOCH_UNAVAILABLE`となり、callerに取得不能なepochを要求せずX1Penの更新／再読込を案内します。いずれも更新は適用されません。errorには取得可能な場合、競合発生時と再観測時のrevision、現在のepoch、guard mode、hash、行数が含まれます。縮退時は`diff_source`を案内せず、bounded read/hashで手動比較します。競合後にrevisionだけを差し替えて同じsourceを再送しないでください。

Source toolのdomain validationもmachine-readableです。編集範囲は`EDIT_RANGE_INVALID`、重複hunkは`EDITS_OVERLAP`、現在modeで編集不能なsectionは`SOURCE_SECTION_NOT_EDITABLE`、文字数上限は`SOURCE_LIMIT_EXCEEDED`、read範囲は`SOURCE_RANGE_INVALID`、生成ASMの明示opt-in不足は`GENERATED_SOURCE_REQUIRES_OPT_IN`を返します。Connectorが既知featureをadvertiseしていない場合、判明している最小Connector版は`requiredVersion`にも含まれます。

1. 直前に保持した`revisionEpoch`、`revision`、section hash、`authoringHash`を確認します。
2. `writeGuard`が`revision-epoch`で同一modeのbaselineなら`x1pen_diff_source`を呼び、人間／Run／別AIの変更を比較します。`revision-only`時はbounded read/hashで比較します。
3. 変更を取り込んだ後、最新のepoch/revisionを使って別のguarded requestとして明示的にretryします。

```json
{
  "section": "slang",
  "baseHash": "sha256-utf8-v1:<64 hex>",
  "baseSourceMode": "slang",
  "baseRevisionEpoch": "取得時のrevisionEpoch",
  "baseGenerated": false,
  "contextLines": 3,
  "maxHunks": 20,
  "maxCharacters": 32768
}
```

MCP processは観測したsectionを最大256 KiB/entry、合計4 MiB/64 entries、15分TTLのLRU cacheにだけ保持し、disk、browser storage、telemetryへ保存しません。disconnect、process終了、TTL/上限でbaselineが消えた場合は`BASE_SNAPSHOT_UNAVAILABLE`になります。caller自身が保持した`baseSource`をfallbackとして渡せますが、結果の`baseSourceOrigin: caller-supplied`はhashとの自己整合性だけを示し、そのsourceが過去にtabへ存在した証明ではありません。

diffは1 source 256 KiB/20,000行、比較work、hunk数、context、出力文字数を制限します。上限超過は`DIFF_LIMIT_EXCEEDED`、sourceMode変更は`BASE_MODE_MISMATCH`です。前epochとのinformational diffは`epochChanged: true`を返しますが、write guardを緩和しません。SLANG生成ASMは両側とも`includeGeneratedAsm: true`が必要です。hunkはLF表示に統一し、CRLF/LF差はbounded side-band metadata、final newline欠落はmarkerで表します。

SLANG編集中のASMは生成物として読み取り・編集とも既定で保護されます。SLANGへ編集を適用すると古い生成ASMは破棄され、次回の検証・実行時に再生成されます。

### Z80デバッグ

デバッガは命令アドレス単位の停止、再開、ステップ、最大1024件のPCブレークポイント、レジスタ参照、現在のメモリマッピングに従った読み取りを提供します。現時点ではZ80レベルの機能であり、SLANGソース行との対応付け、逆アセンブル表示、ウォッチポイントは含みません。

典型的な手順は次のとおりです。

1. `x1pen_debug_set_breakpoints`で停止したいPCアドレスを設定
2. `x1pen_run`または`x1pen_debug_resume`で実行
3. `x1pen_debug_wait_for_pause`でブレークポイント停止を待機
4. `x1pen_debug_get_state`と`x1pen_debug_read_memory`で状態を調査
5. `x1pen_debug_step`で必要な命令数だけ進める

`x1pen_debug_resume`後の新しい停止を待つ場合、`afterSequence`には停止前の値ではなく、`x1pen_debug_resume`が返した`sequence`を指定します。`x1pen_debug_read_memory`と`x1pen_debug_read_vram`は既定64 byte、最大4096 byteで、モデルのコンテキスト消費を抑えるためバイト配列ではなく連続した大文字16進文字列を返します。

VRAMはCPUの64KBメモリ空間とは別です。`x1pen_debug_get_video_state`で現在の機種とbankを確認し、グラフィックVRAMではbank（`0`、`1`、`display`、`access`）とplane（`blue`、`red`、`green`）を指定します。実行中の読出しは複数バイトの一貫したスナップショットにならない場合があるため、厳密な調査では先にpauseしてください。書込みは停止中のみ許可され、空白なしの偶数桁hex文字列を指定します。

```json
{
  "address": 256,
  "length": 32
}
```

Runボタン、Ctrl+Enter、Share自動実行、Automation API、MCPの`x1pen_run`は、ページ全体で1つのRun予約を共有します。先に受理されたRunだけがビルド・状態復元・コマンドキー注入へ進み、同時要求は通常のツールcontentとして次を返します。

- `RUN_IN_PROGRESS`: `retryable: true`。`retryAfterMs`以降に呼出し側が再試行できます。MCP/Connector自身は自動再試行しません。
- `RUN_QUEUE_TIMEOUT`: 先行Automation処理のため実行開始できなかった非再試行結果です。`x1pen_get_status`で状態を確認してください。

既存の`ok: true`は従来どおり「Run準備とコマンドキー注入が完了した」ことを示し、X1プログラムが実際に開始したことの確認までは含みません。Run準備中はpause/resume/step、プログラム更新、検証、デバッガ書込みを拒否または待機し、起動用キー注入への割込みを防ぎます。

通常のライブラリディスクがFDD0にある場合、最初のMCP Runは`PROJECT_DISK_SETUP_REQUIRED`を返します。X1Pen画面で一度RUNし、別名のpersistent project copy作成を承認してください。metadata付きproject copyに対するRunは、managed fileのcommitとcold power-onが成功すると`committed: true`、`poweredOn: true`、`verification: "filesystem-only"`、`bootVerified: false`、`executionVerified: false`を返します。これはbootやguest program実行の確認ではありません。

Run準備が`stalled`になった場合、`x1pen_get_status`は`runAdmission`のphase/origin/経過時間を返します。`x1pen_recover_stalled`を確認なしで呼ぶと警告を返し、`confirmDataLoss: true`でのみ再読込します。エディターの現在値は保存されますが、エミュレーターRAMと未永続化のディスク変更は失われます。

Share機能はユーザーが開いているX1Pen自身から実行するため、本番X1Pen上では既存のShare APIと公開URLをそのまま利用できます。

## 開発と公開

このリポジトリでMCPサーバーを開発する場合は、ルートの`.codex/config.toml`と`.mcp.json`が`mcp/x1pen-server.mjs`を直接起動します。

```bash
npm ci
./build.sh
```

### ローカル確認

```bash
npm run test:automation
npm run test:bridge
npm run test:mcp
npm run test:mcp-package
```

MCPサーバー単体を起動すると、標準エラーにbridge portとpairing codeが表示されます。標準出力はMCP通信専用です。

```bash
npm run mcp:x1pen
```

`test:mcp-package`は`npm pack`で作ったtarballを一時ディレクトリへインストールし、リポジトリ外からMCPサーバーを起動してツール一覧を確認します。

### npm公開

パッケージ名は`x1pen-mcp`、公開単位は`mcp/`です。公開前に`mcp/package.json`のversionと変更内容を確認し、次を実行します。同じversionはnpmへ再公開できません。

```bash
npm whoami
npm run test:mcp-package
npm publish ./mcp
```

公開後は`npm view x1pen-mcp version`と`npx -y x1pen-mcp@<version> --version`で確認します。

### コンポーネント公開順

互換性機能を追加するリリースは、次の順序で公開します。

1. `html/x1pen-version.js`を更新し、X1Penをデプロイ
2. `mcp/package.json`を確認し、MCPサーバーをnpmへ公開
3. `extension/manifest.json`を確認し、ConnectorをChrome Web Storeへ提出・公開

Connectorの審査中でも、旧Connector 1.2.0と新しいMCPを組み合わせて、sourceの読み書きを`revision-only` modeで継続できます。この組み合わせではreloadをまたぐ完全な競合防止は利用できず、`x1pen_diff_source`、remote key入力、remote pad入力も利用できません。MCPのstatusとerrorに更新案内が表示されたら、Connector 1.3.0以降へ更新してください。

X1Pen製品バージョンの真実の源は`html/x1pen-version.js`です。X1Pen 0.8.0、Connector 1.2.0、MCP 2.6.0から明示的な3層互換性情報に対応します。X1Penのリリースタグは製品バージョンと同じ`v<version>`形式にします。

## セキュリティ

- ブリッジは`127.0.0.1`だけで待ち受ける
- 6桁コードによる明示的なペアリングが必要
- Chrome拡張の`activeTab`権限はユーザーが接続操作したタブだけに付与される
- 任意JavaScriptやChrome DevTools Protocolは公開しない
- X1Pen Automation APIの許可済みメソッドだけを中継する

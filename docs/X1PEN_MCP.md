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

接続されたX1Penには`MCP Connected`と表示されます。複数タブを接続した場合は`x1pen_list_sessions`と`x1pen_select_session`で操作対象を選びます。通常はX1Pen自身の複数タブ警告により1タブだけが接続されます。

### バージョンと機能互換性

`x1pen_connection_info`、`x1pen_list_sessions`、`x1pen_get_status`は、MCPサーバー、Connector、X1Penのバージョンと実効capabilityを返します。バージョンは診断と更新案内に使用し、実際の利用可否は3コンポーネントが申告するfeatureの積集合で決定します。

feature IDは完全一致する不変の契約です。現在は`automation.core`、`screen.capture`、`debugger.cpu`、`debugger.vram`を使用します。後方互換性のない変更では既存IDの意味を変更せず、`debugger.vram-v2`のような新しいIDを追加します。

公開済みのConnector 1.0.1、1.1.0、1.1.1だけは、明示featureがないためMCPサーバーが既知の機能を推定します。この表は歴史的互換性のために凍結されており、Connector 1.2.0以降は明示featureを申告します。未対応機能はConnectorへ送信する前に拒否され、`component`、`feature`、現在版、必要な場合は必要版、対処方法を含む機械可読エラーが返ります。

## ツール

| Tool | 内容 |
|---|---|
| `x1pen_connection_info` | 拡張機能の接続情報を取得 |
| `x1pen_list_sessions` | 接続済みX1Penタブを一覧表示 |
| `x1pen_select_session` | 操作対象タブを選択 |
| `x1pen_get_language_profile` | 同梱言語／X1ハードウェアprofileと接続中X1Penの言語profileを確認 |
| `x1pen_search_reference` | FuzzyBASIC / SLANG / 内蔵Z80アセンブラ / X1ハードウェアリファレンスを要約検索 |
| `x1pen_get_reference` | 検索結果のIDを指定して詳細を上限付きで取得 |
| `x1pen_get_program` | メタデータと明示指定した完全ソースを取得 |
| `x1pen_get_source` | 1セクションを行範囲・文字数上限付きで取得 |
| `x1pen_search_source` | 1セクションをリテラル検索し、限定した前後行を取得 |
| `x1pen_apply_edits` | revision一致時だけ構造化された行編集を適用 |
| `x1pen_set_program` | revision一致時だけプログラム全体を更新（新規作成・全置換用） |
| `x1pen_validate` | 実行せずにコンパイル、アセンブル、トークナイズ |
| `x1pen_run` | ユーザーが開いているX1Penで実行 |
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

AIによる更新、検証、実行、停止中はエディターとツールバーを一時的にロックします。`x1pen_set_program`と`x1pen_apply_edits`は取得済みの`revision`を要求し、途中で人間が編集していた場合は上書きを拒否します。

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

`x1pen_get_program`は引数なしの場合、`sourceMode`、`revision`、各セクションの行数・文字数だけを返します。完全ソースが必要な場合だけ`fields`を明示します。SLANGから生成されたASMは`includeGeneratedAsm: true`を明示しない限り返しません。完全取得には既定で128 KiBの上限があり、超えるソースは`x1pen_get_source`で分割取得します。

```json
{
  "fields": ["slang"],
  "includeGeneratedAsm": false
}
```

大きなソースは、まず`x1pen_search_source`で位置を探し、`x1pen_get_source`で必要な範囲だけを取得します。

```json
{
  "section": "slang",
  "startLine": 100,
  "lineCount": 200,
  "maxCharacters": 32768
}
```

既存プログラムの変更には、全置換ではなく`x1pen_apply_edits`を使用します。行番号は1始まりで、同一リクエスト内の編集範囲は重複できません。応答には新しいrevisionと変更行数だけが含まれ、完全ソースは返りません。

```json
{
  "section": "slang",
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

Runボタン、Ctrl+Enter、Share自動実行、MCPの`x1pen_run`による実行準備中は、pause/resume/stepが準備完了まで拡張ブリッジ内で待機します。人間とAIが同じX1Penを操作しても、起動用キー注入の途中へデバッガ操作が割り込まないための制約です。

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
2. `extension/manifest.json`を更新し、ConnectorをChrome Web Storeへ提出・公開
3. `mcp/package.json`を更新し、MCPサーバーをnpmへ公開

X1Pen製品バージョンの真実の源は`html/x1pen-version.js`です。X1Pen 0.8.0、Connector 1.2.0、MCP 2.6.0から明示的な3層互換性情報に対応します。X1Penのリリースタグは製品バージョンと同じ`v<version>`形式にします。

## セキュリティ

- ブリッジは`127.0.0.1`だけで待ち受ける
- 6桁コードによる明示的なペアリングが必要
- Chrome拡張の`activeTab`権限はユーザーが接続操作したタブだけに付与される
- 任意JavaScriptやChrome DevTools Protocolは公開しない
- X1Pen Automation APIの許可済みメソッドだけを中継する

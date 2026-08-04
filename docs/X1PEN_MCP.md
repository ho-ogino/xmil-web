# X1Pen MCP Connector

X1Pen MCP Connectorは、ユーザーがChromeまたはEdgeで開いているX1PenタブをCodex / Claude Codeから操作するためのローカル連携機能です。AI専用ブラウザーを起動するのではなく、人間とAIが同じエディターとエミュレーターを使用します。

## 対応環境

- Windows / macOS: Chrome、Edge
- Linux: Chromium系ブラウザー（ベストエフォート）
- Brave、Vivaldiなど: ベストエフォート
- Firefox、Safari: 現時点では対象外

Node.js 20以降が必要です。通信はstdioと`127.0.0.1`だけを使用します。

## セットアップ

MCPサーバーはnpmパッケージとしてX1Pen本体から独立して配布します。MCPサーバーを動かすために、このリポジトリをcloneする必要はありません。予期しない自動更新を避けるため、設定ではバージョンを固定します。

### Codex

CodexのMCP設定に以下を追加します。

```toml
[mcp_servers.x1pen]
command = "npx"
args = ["-y", "x1pen-mcp@2.2.0"]
startup_timeout_sec = 30
tool_timeout_sec = 60
```

Codexを再起動後、`codex mcp list`で登録を確認します。

### Claude Code

userスコープへ登録すると、任意のプロジェクトからX1Penを利用できます。

```bash
claude mcp add --transport stdio --scope user x1pen -- \
  npx -y x1pen-mcp@2.2.0
claude mcp list
```

プロジェクト単位で共有する場合は、対象プロジェクトの`.mcp.json`へ以下を追加します。初回起動時にプロジェクトMCPサーバーを承認してください。

```json
{
  "mcpServers": {
    "x1pen": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "x1pen-mcp@2.2.0"]
    }
  }
}
```

### 拡張機能

1. Chromeで`chrome://extensions`、Edgeで`edge://extensions`を開く
2. Developer modeを有効化
3. Load unpackedを選択
4. このリポジトリの`extension/`ディレクトリを指定

ストア公開前はunpacked extensionとして読み込みます。MCPサーバーのnpm配布とブラウザー拡張の配布は独立しており、拡張機能の更新にMCPパッケージの再公開は不要です。

## 接続

1. AIに`x1pen_connection_info`を呼ばせ、bridge portと6桁のpairing codeを確認
2. Automation API v2を含むX1PenをChrome / Edgeで開く
3. X1Pen Connector拡張を開く
4. bridge portとpairing codeを入力
5. `Connect this tab`を押す

接続されたX1Penには`MCP Connected`と表示されます。複数タブを接続した場合は`x1pen_list_sessions`と`x1pen_select_session`で操作対象を選びます。通常はX1Pen自身の複数タブ警告により1タブだけが接続されます。

## ツール

| Tool | 内容 |
|---|---|
| `x1pen_connection_info` | 拡張機能の接続情報を取得 |
| `x1pen_list_sessions` | 接続済みX1Penタブを一覧表示 |
| `x1pen_select_session` | 操作対象タブを選択 |
| `x1pen_get_language_profile` | 同梱リファレンスと接続中X1Penの言語profileを確認 |
| `x1pen_search_reference` | FuzzyBASIC / SLANGリファレンスを要約検索 |
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

AIによる更新、検証、実行、停止中はエディターとツールバーを一時的にロックします。`x1pen_set_program`と`x1pen_apply_edits`は取得済みの`revision`を要求し、途中で人間が編集していた場合は上書きを拒否します。

### 言語リファレンス

MCPパッケージには、X1Pen FuzzyBASIC 1.2LとX1Pen内蔵SLANGコンパイラに対応する構造化リファレンスが同梱されています。ブラウザー未接続でも検索できるため、プログラム作成前に仕様を確認できます。

最初に`x1pen_get_language_profile`を呼ぶと、同梱profileを確認できます。X1Penへ接続済みなら、ブラウザーが報告したprofile IDとの互換性も返します。

リファレンスは全件取得せず、`x1pen_search_reference`で必要な項目を検索します。応答は短い要約とstable IDだけです。

```json
{
  "language": "slang",
  "query": "tile sprite scroll",
  "maxResults": 5
}
```

必要な項目だけ`x1pen_get_reference`で取得します。1回に指定できるIDは10件までで、既定の応答上限は32 KiBです。

```json
{
  "ids": ["slang.include.tile-sprite"]
}
```

収録内容には、一般的な言語構文だけでなく、SLANGの正確なコンパイラrevision、`ENV_TYPE=1`のLSX-Dodgers環境、X1Pen同梱runtime/include API、FuzzyBASIC 1.2LのX1拡張を含みます。ゲーム開発で利用するPCGについては、FuzzyBASICの`PCGDEF` / `TCOLOR`、SLANGの`PCGDEF` / `PCGDEFS`、24-byte BRGパターン形式、TILELIBとの初期化順序まで独立項目として収録しています。代表サンプルは現在のX1Pen tokenizer/compilerで自動検証しています。未知のAPIや複雑な引数規約については、リファレンス確認後も`x1pen_validate`で検証してください。

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

## セキュリティ

- ブリッジは`127.0.0.1`だけで待ち受ける
- 6桁コードによる明示的なペアリングが必要
- Chrome拡張の`activeTab`権限はユーザーが接続操作したタブだけに付与される
- 任意JavaScriptやChrome DevTools Protocolは公開しない
- X1Pen Automation APIの許可済みメソッドだけを中継する

# X1Pen MCP Connector

X1Pen MCP Connectorは、ユーザーがChromeまたはEdgeで開いているX1PenタブをCodex / Claude Codeから操作するためのローカル連携機能です。AI専用ブラウザーを起動するのではなく、人間とAIが同じエディターとエミュレーターを使用します。

## 対応環境

- Windows / macOS: Chrome、Edge
- Linux: Chromium系ブラウザー（ベストエフォート）
- Brave、Vivaldiなど: ベストエフォート
- Firefox、Safari: 現時点では対象外

Node.js 20以降が必要です。通信はstdioと`127.0.0.1`だけを使用します。

## セットアップ

```bash
npm ci
./build.sh
```

### 拡張機能

1. Chromeで`chrome://extensions`、Edgeで`edge://extensions`を開く
2. Developer modeを有効化
3. Load unpackedを選択
4. このリポジトリの`extension/`ディレクトリを指定

PoC段階ではストア配布を行わないため、unpacked extensionとして読み込みます。

### Codex

リポジトリルートからCodexを起動すると`.codex/config.toml`がMCPサーバーを登録します。

```bash
codex mcp list
codex
```

### Claude Code

`.mcp.json`がプロジェクトMCPサーバーを登録します。初回起動時に承認してください。

```bash
claude mcp list
claude
```

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
| `x1pen_get_program` | ソース、instance ID、revisionを取得 |
| `x1pen_set_program` | revision一致時だけプログラム全体を更新 |
| `x1pen_validate` | 実行せずにコンパイル、アセンブル、トークナイズ |
| `x1pen_run` | ユーザーが開いているX1Penで実行 |
| `x1pen_stop` | ESCを送信して停止 |
| `x1pen_get_status` | 接続、ロック、実行状態を取得 |
| `x1pen_capture_screen` | 640x400のエミュレーター画面をPNG取得 |

AIによる更新、検証、実行、停止中はエディターとツールバーを一時的にロックします。`x1pen_set_program`は`x1pen_get_program`で取得した`revision`を要求し、途中で人間が編集していた場合は上書きを拒否します。

Share機能はユーザーが開いているX1Pen自身から実行するため、本番X1Pen上では既存のShare APIと公開URLをそのまま利用できます。

## ローカル確認

```bash
npm run test:automation
npm run test:bridge
npm run test:mcp
```

MCPサーバー単体を起動すると、標準エラーにbridge portとpairing codeが表示されます。標準出力はMCP通信専用です。

```bash
npm run mcp:x1pen
```

## セキュリティ

- ブリッジは`127.0.0.1`だけで待ち受ける
- 6桁コードによる明示的なペアリングが必要
- Chrome拡張の`activeTab`権限はユーザーが接続操作したタブだけに付与される
- 任意JavaScriptやChrome DevTools Protocolは公開しない
- X1Pen Automation APIの許可済みメソッドだけを中継する

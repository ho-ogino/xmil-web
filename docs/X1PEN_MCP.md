# X1Pen MCP Server

X1Penをローカルのstdio MCPサーバーとして起動し、CodexやClaude Codeからプログラムの編集、検証、実行、画面取得を行えます。ソース、ディスクイメージ、エミュレーション処理はローカル環境内に留まります。

## セットアップ

Node.js 20以降とEmscripten SDKが必要です。

```bash
npm ci
./build.sh
npm run mcp:install-browser
```

ChromeまたはEdgeが既にインストールされている場合、Playwright同梱Chromiumがなくても自動的にフォールバックします。使用するブラウザーを固定する場合は`X1PEN_BROWSER_EXECUTABLE`に実行ファイルの絶対パスを設定してください。

## Codex

プロジェクトを信頼してCodexをこのリポジトリのルートから起動すると、`.codex/config.toml`の`x1pen`サーバーが利用可能になります。

```bash
codex mcp list
```

## Claude Code

リポジトリに含まれる`.mcp.json`がプロジェクトスコープの`x1pen`サーバーを登録します。初回はClaude Code上でプロジェクトMCPサーバーの承認が必要です。

```bash
claude mcp list
```

## ツール

| Tool | 内容 |
|---|---|
| `x1pen_get_program` | 現在のBASIC、ASM、SLANGソースを取得 |
| `x1pen_set_program` | プログラム全体を一括設定 |
| `x1pen_validate` | 実行せずにトークナイズ、コンパイル、アセンブル |
| `x1pen_run` | 現在のプログラムをビルドして実行 |
| `x1pen_stop` | ESCを送信して停止 |
| `x1pen_get_status` | 初期化・処理中・ステータス文字列を取得 |
| `x1pen_capture_screen` | エミュレーター画面を640x400 PNGで取得 |

`x1pen_set_program`は完全置換です。`sourceMode`で使用しないエディターの内容は消去され、過去のソースが実行モードへ影響することを防ぎます。ブラウザーコンテキストはMCPプロセスごとに分離されるため、通常利用しているX1PenのlocalStorage設定は変更しません。

## 手動起動と診断

stdioサーバーを直接起動する場合は次を実行します。標準出力はMCP通信専用で、診断ログは標準エラーへ出力されます。

```bash
npm run mcp:x1pen
```

Automation APIの実ブラウザテストとMCPプロトコルテストは次のとおりです。Automationテストの前に`./build.sh`で`dist/`を更新してください。

```bash
npm run test:automation
npm run test:mcp
npm run test:mcp:e2e
```

GUI付きブラウザーで調査する場合は`X1PEN_HEADLESS=0`を設定できます。

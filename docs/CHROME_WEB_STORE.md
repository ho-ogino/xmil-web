# X1Pen Connector: Chrome Web Store submission

This document is the source of truth for packaging and submitting X1Pen Connector. Review the text against the current extension behavior before every update.

## Build the upload ZIP

```bash
npm run test:extension-package
npm run pack:extension
```

Upload `dist/x1pen-connector-1.1.0.zip`. The ZIP has `manifest.json` at its root and excludes source artwork, README files, and Store-only images.

## Store listing

- Product name: `X1Pen Connector`
- Category: `Developer Tools`
- Language: Japanese (English is included as an extension localization)
- Privacy policy: `https://x1.onoda-pro.com/x1pen-connector-privacy.html`
- Homepage: `https://x1.onoda-pro.com/x1pen`
- Support: `https://github.com/ho-ogino/xmil-web/issues`

### English summary

Connect the active X1Pen tab to a local MCP server for AI-assisted FuzzyBASIC and SLANG development.

### English description

X1Pen Connector links the X1Pen tab you explicitly select to an x1pen-mcp server running on the same computer. A configured MCP client such as Codex or Claude Code can then assist with FuzzyBASIC and SLANG development in the X1Pen editor you can see and edit yourself.

The connection handles the selected tab's title and URL, requested source, validation results, execution and debugger state, requested emulator memory ranges, and emulator screen captures. Supported operations include reading and editing source, validating programs, running and stopping programs, and controlling the Z80 debugger. Access starts only after you open the extension popup, review the data-access disclosure, enter the local bridge port and pairing code, and choose "Connect this tab." The port and pairing code are stored locally so the requested connection can be restored.

The extension communicates with the paired local bridge at 127.0.0.1. It does not contain advertising, analytics, or tracking, and it does not send data to a server operated by the extension developer. Your configured MCP client may send requested X1Pen data to its AI provider under that provider's terms and privacy policy.

Requirements:

- An X1Pen tab open in Chrome
- Node.js 20 or later
- The x1pen-mcp local server
- A compatible MCP client

Setup and source code: https://github.com/ho-ogino/xmil-web/blob/main/docs/X1PEN_MCP.md

### Japanese summary

X1PenのタブをローカルMCPサーバーへ接続し、AIによるFuzzyBASIC・SLANG開発支援を可能にします。

### Japanese description

X1Pen Connectorは、明示的に選択したX1Penタブを、同じコンピューターで動作するx1pen-mcpサーバーへ接続します。CodexやClaude CodeなどのMCPクライアントが、人間も操作できるX1Penエディター上でFuzzyBASIC・SLANGプログラムの作成を支援できます。

選択したタブのタイトルとURL、要求されたソース、検証結果、実行・デバッガ状態、要求されたエミュレータメモリ範囲、エミュレーター画面を取り扱い、ソースの読み書き、検証、実行・停止、Z80デバッガ操作に対応します。拡張機能のポップアップでデータ取扱いの説明を確認し、ローカル接続情報を入力して「Connect this tab」を押したタブだけにアクセスします。ポートとペアリングコードは、要求された接続を復元するためローカルへ保存します。

通信先は127.0.0.1のペアリング済みローカルブリッジです。広告、アクセス解析、追跡はなく、拡張機能の開発者が運用するサーバーへデータを送信しません。設定したMCPクライアントは、各AIプロバイダーの規約とプライバシーポリシーに基づき、要求したX1Penデータを送信する場合があります。

## Single purpose

Connect one user-selected X1Pen browser tab to the user's paired local x1pen-mcp server so a configured MCP client can assist with X1Pen program development.

All extension features directly support this purpose. It does not access arbitrary tabs; access to page data begins only after the user explicitly connects a tab.

## Permission justifications

### `activeTab`

Grants temporary access only to the tab on which the user invokes the extension. This is used to verify that the tab is X1Pen and to perform requested X1Pen operations after explicit connection. Persistent host permissions are not requested.

### `scripting`

Runs a packaged function in the selected tab's MAIN world to call the allowlisted `window.X1PenAutomation` API. It does not evaluate downloaded code or accept arbitrary JavaScript from the MCP client.

### `storage`

Stores the user-entered local bridge port and pairing code in local extension storage, and connected-tab metadata in session storage, so the service worker can maintain and restore the explicitly requested local connection.

## Privacy practices

The extension handles the following user data only after prominent disclosure and affirmative consent in the popup:

- Website content: X1Pen source, validation results, execution and debugger state, requested emulator memory ranges, and requested emulator screenshots.
- Web browsing activity: title and URL of the explicitly connected X1Pen tab only.
- Authentication information: the six-digit pairing code for the user-selected local bridge.

Data use declarations:

- Used only for the extension's disclosed single purpose.
- Transferred only to the user-selected local MCP bridge and, through the user's configured MCP client, potentially to that client's configured AI provider.
- Not sold or transferred for advertising, creditworthiness, lending, or unrelated purposes.
- Not used for personalized advertising, profiling, analytics, or tracking.
- Not made available for unrelated human review.
- The developer does not operate a data collection server for the extension.
- Program source and screenshots are not retained in extension storage.

The loopback WebSocket uses `ws://127.0.0.1`. Chrome Web Store policy explicitly exempts communication between an extension and a native program on the same computer from the transmission-encryption requirement.

## Reviewer instructions

No account or paid feature is required.

1. Install Node.js 20 or later.
2. Run `npx -y x1pen-mcp@2.5.0` in a terminal. Keep it running and note the bridge port and six-digit pairing code printed to standard error.
3. Open `https://x1.onoda-pro.com/x1pen` in Chrome and wait for the editor to become ready.
4. Open X1Pen Connector, enter the displayed port and pairing code, review and accept the disclosure, then click `Connect this tab`.
5. Confirm the extension badge shows `1` and X1Pen shows `MCP Connected`.
6. Configure an MCP client using the instructions at `https://github.com/ho-ogino/xmil-web/blob/main/docs/X1PEN_MCP.md` to exercise source read/edit, validation, run/stop, debugger, status, and screenshot tools.
7. Click `Disconnect` to end access to the tab.

The extension should show a clear error if the current tab is not X1Pen, if the pairing code is invalid, or if the local server is not running.

## Assets

- Extension icon in ZIP: `extension/icons/icon-128.png` (128 x 128 PNG)
- Small promo tile: `extension/store/small-promo-440x280.png` (440 x 280 PNG)
- Marquee promo tile: `extension/store/marquee-promo-1400x560.png` (1400 x 560 PNG, optional)
- Screenshot: `extension/store/screenshot-1280x800.png` (1280 x 800 PNG)

The screenshot must show the actual X1Pen editor and connector popup without unrelated browser or desktop content.

## Submission checklist

1. Deploy this branch so the privacy policy URL is publicly reachable.
2. Register or sign in to the Chrome Web Store Developer Dashboard and complete its one-time registration fee.
3. Choose **Add new item** and upload the generated ZIP.
4. Complete Store Listing using the copy and assets above.
5. Complete Privacy practices using the single-purpose, permission, and data-use declarations above.
6. Set distribution to public and choose the intended regions.
7. Add the reviewer instructions above under Test instructions.
8. Verify developer contact email and Google account 2-Step Verification.
9. Save the draft, resolve dashboard warnings, and choose **Submit for review**.

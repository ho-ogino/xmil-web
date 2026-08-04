# X1Pen Connector Extension

Chromium extension for connecting the active X1Pen tab to the local `x1pen-mcp` bridge. The extension only accesses a tab after the user opens the popup, accepts the data-access disclosure, and selects **Connect this tab**.

## Development install

Load this directory as an unpacked extension from `chrome://extensions` or `edge://extensions`. See [`docs/X1PEN_MCP.md`](../docs/X1PEN_MCP.md) for the complete setup and pairing flow.

## Store package

From the repository root:

```bash
npm run pack:extension
npm run test:extension-package
```

The upload ZIP is written to `dist/x1pen-connector-<version>.zip`. Store-only artwork and source assets under `extension/store/` and `extension/icons/icon-source.svg` are intentionally excluded.

Submission copy, permission justifications, and reviewer instructions are maintained in [`docs/CHROME_WEB_STORE.md`](../docs/CHROME_WEB_STORE.md).

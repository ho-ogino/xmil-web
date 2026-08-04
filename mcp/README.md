# x1pen-mcp

`x1pen-mcp` is a local MCP server that lets Codex and Claude Code edit, validate, run, and inspect programs in the X1Pen tab already open in Chrome or Edge.

The server communicates only through stdio and `127.0.0.1`. It requires Node.js 20 or later and the X1Pen Connector browser extension.

## Codex

Add the following server to your Codex MCP configuration. Pinning the version prevents an unexpected update during startup.

```toml
[mcp_servers.x1pen]
command = "npx"
args = ["-y", "x1pen-mcp@2.1.0"]
startup_timeout_sec = 30
tool_timeout_sec = 60
```

## Claude Code

Register the server at user scope to make it available from any project.

```bash
claude mcp add --transport stdio --scope user x1pen -- \
  npx -y x1pen-mcp@2.1.0
```

Use `claude mcp list` or `/mcp` to check the connection.

## Pairing

1. Call `x1pen_connection_info` from the AI client.
2. Open the X1Pen Connector extension in Chrome or Edge.
3. Enter the reported bridge port and six-digit pairing code.
4. Select **Connect this tab** on the X1Pen tab.

The pairing code changes whenever the MCP server process restarts. One browser extension connection can be paired with one running MCP server at a time.

See the [complete setup and tool documentation](https://github.com/ho-ogino/xmil-web/blob/main/docs/X1PEN_MCP.md) for details.

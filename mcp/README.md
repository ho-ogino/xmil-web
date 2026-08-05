# x1pen-mcp

`x1pen-mcp` is a local MCP server that lets Codex and Claude Code edit, validate, run, inspect, and Z80-debug programs in the X1Pen tab already open in Chrome or Edge. It also includes bounded, offline-searchable references for X1Pen FuzzyBASIC and SLANG.

The server communicates only through stdio and `127.0.0.1`. It requires Node.js 20 or later. Browser-control tools require the X1Pen Connector extension; the bundled reference tools do not.

## Codex

Add the following server to your Codex MCP configuration. Pinning the version prevents an unexpected update during startup.

```toml
[mcp_servers.x1pen]
command = "npx"
args = ["-y", "x1pen-mcp@2.3.0"]
startup_timeout_sec = 30
tool_timeout_sec = 60
```

## Claude Code

Register the server at user scope to make it available from any project.

```bash
claude mcp add --transport stdio --scope user x1pen -- \
  npx -y x1pen-mcp@2.3.0
```

Use `claude mcp list` or `/mcp` to check the connection.

## Pairing

1. Call `x1pen_connection_info` from the AI client.
2. Open the X1Pen Connector extension in Chrome or Edge.
3. Enter the reported bridge port and six-digit pairing code.
4. Select **Connect this tab** on the X1Pen tab.

The pairing code changes whenever the MCP server process restarts. One browser extension connection can be paired with one running MCP server at a time.

## Z80 debugger

The debugger tools expose named CPU state, pause/resume, bounded multi-step execution, atomic PC breakpoint replacement, compact hexadecimal memory reads, and filtered pause waiting. They operate only through the allowlisted X1Pen Automation API; arbitrary JavaScript and raw WASM access are not exposed.

## Language reference

The reference tools work before browser pairing because the data is bundled in this package:

- `x1pen_get_language_profile` lists the bundled profiles and compares them with a connected X1Pen version.
- `x1pen_search_reference` returns short summaries and stable reference IDs.
- `x1pen_get_reference` returns full details only for selected IDs, with a response-size limit.

Search first and fetch only the entries needed for the current program. This avoids putting a complete language manual into the model context.

See the [complete setup and tool documentation](https://github.com/ho-ogino/xmil-web/blob/main/docs/X1PEN_MCP.md) for details.

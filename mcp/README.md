# x1pen-mcp

`x1pen-mcp` is a local MCP server that lets Codex and Claude Code edit, validate, run, inspect, and Z80-debug programs in the X1Pen tab already open in Chrome or Edge. It also includes bounded, offline-searchable references for X1Pen FuzzyBASIC, SLANG, and the X1 hardware implemented by the emulator.

The server communicates only through stdio and `127.0.0.1`. It requires Node.js 20 or later. Browser-control tools require the X1Pen Connector extension; the bundled reference tools do not.

## Codex

Add the following server to your Codex MCP configuration. The `latest` tag keeps newly started MCP processes on the current release. Restart Codex after an `x1pen-mcp` update to use it.

```toml
[mcp_servers.x1pen]
command = "npx"
args = ["-y", "x1pen-mcp@latest"]
startup_timeout_sec = 30
tool_timeout_sec = 60
```

## Claude Code

Register the server at user scope to make it available from any project.

```bash
claude mcp add --transport stdio --scope user x1pen -- \
  npx -y x1pen-mcp@latest
```

Use `claude mcp list` or `/mcp` to check the connection.

## Pairing

1. Call `x1pen_connection_info` from the AI client.
2. Open the X1Pen Connector extension in Chrome or Edge.
3. Enter the reported bridge port and six-digit pairing code.
4. Select **Connect this tab** on the X1Pen tab.

The pairing code changes whenever the MCP server process restarts. One browser extension connection can be paired with one running MCP server at a time.

## Z80 debugger

The debugger tools expose named CPU/video state, pause/resume, bounded multi-step execution, atomic PC breakpoint replacement, compact hexadecimal CPU/VRAM reads, paused VRAM writes, and filtered pause waiting. They operate only through the allowlisted X1Pen Automation API; arbitrary JavaScript, raw I/O, and raw WASM access are not exposed.

## Language and X1 hardware reference

The reference tools work before browser pairing because the data is bundled in this package:

- `x1pen_get_language_profile` lists the bundled profiles and compares them with a connected X1Pen version.
- `x1pen_search_reference` returns short summaries and stable reference IDs.
- `x1pen_get_reference` returns full details only for selected IDs, with a response-size limit.

Search first and fetch only the entries needed for the current program. This avoids putting a complete language manual into the model context.

The server initialization instructions tell MCP clients not to infer these nonstandard languages from ordinary BASIC, C, or another SLANG release, and not to confuse X1 CPU memory, I/O ports, VRAM, or their independent banks. FuzzyBASIC coverage includes direct indexed memory/I/O arrays, LSX-Dodgers-specific file limitations, machine-code integration, PCG, PSG sound, and joystick input. SLANG coverage is tied to the exact browser compiler and VFS, including compiler vocabulary, native FLOAT, LSX file I/O, X1 graphics/PCG/PSG/timing/SGL, compression and all bundled include APIs. The X1 hardware profile initially covers address spaces, turbo low-memory banking, text/attribute/kanji VRAM, graphics banks and color planes, simultaneous access, screen control, PCG, and the base palette. Exact symbols are searchable in English or Japanese, and an unsuccessful all-term search falls back to partial matches explicitly marked with `matchMode: "partial"`.

See the [complete setup and tool documentation](https://github.com/ho-ogino/xmil-web/blob/main/docs/X1PEN_MCP.md) for details.

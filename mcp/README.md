# x1pen-mcp

`x1pen-mcp` is a local MCP server that lets Codex and Claude Code edit, validate, run, inspect, and Z80-debug programs in the X1Pen tab already open in Chrome or Edge. It also includes bounded, offline-searchable references for X1Pen FuzzyBASIC, SLANG, its built-in Z80 assembler, and the X1 hardware implemented by the emulator.

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

## Local source files

`x1pen_set_source_file` can replace one editable BASIC, ASM, or SLANG section directly from a local UTF-8 file without returning its path or content to the model. File access is disabled by default. Add one or more explicit roots when starting the MCP server:

```toml
[mcp_servers.x1pen]
command = "npx"
args = ["-y", "x1pen-mcp@latest", "--allow-source-root", "/absolute/path/to/project/sources"]
startup_timeout_sec = 30
tool_timeout_sec = 60
```

Repeat `--allow-source-root <dir>` to allow multiple source trees. Each root must already exist and be a directory; a bad root fails server startup with its configured value visible in the local startup error. The tool resolves canonical paths, rejects paths and symlinks that escape every root, accepts regular files only, and rejects invalid UTF-8, NUL, files over 512 KiB, and files that change during the read. It strips one leading UTF-8 BOM and normalizes CRLF or lone CR to LF before writing. It applies the same revision/epoch guard as other source writes, preserves the other authoring section, and clears generated ASM when replacing SLANG. Results contain only the section, raw-file byte count and SHA-256, changed state, and program metadata; the section summary hash describes the normalized stored text.

## Pairing

1. Call `x1pen_connection_info` from the AI client.
2. Open the X1Pen Connector extension in Chrome or Edge.
3. Enter the reported bridge port and six-digit pairing code.
4. Select **Connect this tab** on the X1Pen tab.

The pairing code changes whenever the MCP server process restarts. One browser extension connection can be paired with one running MCP server at a time.

## Compatibility

Connection, session and status results report the versions and effective features of the MCP server, X1Pen Connector and connected X1Pen. Versions are diagnostic; commands are permitted from the exact feature IDs advertised by all required components. Unsupported debugger commands are rejected before they reach an older Connector and return a machine-readable update action.

The current feature contracts are `automation.core`, `automation.run-recovery`, `automation.source-sync`, `screen.capture`, `input.keyboard`, `input.pad`, `debugger.cpu` and `debugger.vram`. `automation.source-sync` covers epoch-bound guarded writes and structured source conflicts. Feature IDs are immutable. A backward-incompatible successor uses a new ID such as `debugger.vram-v2` rather than changing the meaning of an existing ID.

Program metadata includes exact UTF-8 SHA-256 section hashes, a mode-aware authoring hash, `revisionEpoch` when available, `revision`, `guardedWritesReloadSafe`, and `writeGuard`. Retain the epoch/revision pair before editing. When MCP, Connector, and X1Pen all advertise `automation.source-sync`, `x1pen_set_program`, `x1pen_set_source_file`, and `x1pen_apply_edits` require both values and fail closed after reload or concurrent edit. A full-capability snapshot that omits its own epoch fails writes with `REVISION_EPOCH_UNAVAILABLE` instead of asking the caller for an unobtainable value. Older or unknown peers visibly degrade to numeric revision guarding (`guardedWritesReloadSafe: false`, `writeGuard: revision-only`); reads and writes remain available, while `x1pen_diff_source` requires full source-sync support. Bounded source reads accept a present empty string but report `SOURCE_CONTENT_UNAVAILABLE` when the page omits a source field. Degraded file replacement and `apply_edits` re-read mode, hashes, epoch, and revision immediately before their whole-program write, but that check and write are not atomic. On conflict, compare hashes (or use diff only in full mode); never replace only the revision and blindly retry a stale write. Diff baselines are held only in a bounded, expiring in-memory cache. An optional caller-supplied baseline is labeled self-attested, generated SLANG ASM requires explicit opt-in, and all diff inputs/work/hunks/output are bounded.

Source validation failures are structured: `EDIT_RANGE_INVALID`, `EDITS_OVERLAP`, `SOURCE_SECTION_NOT_EDITABLE`, `SOURCE_LIMIT_EXCEEDED`, `SOURCE_RANGE_INVALID`, and `GENERATED_SOURCE_REQUIRES_OPT_IN`. Known Connector feature minimums are returned as `requiredVersion` even when the Connector advertises an explicit feature list. Unmapped bridge RPC methods fail closed with `METHOD_FEATURE_UNMAPPED` before transport.

`x1pen_set_program` is a complete replacement. Sections inactive for its `sourceMode` are cleared even when non-empty values are supplied; use `x1pen_apply_edits` to preserve other authoring content in the current mode. For SLANG validation, `output.generatedAsmLines` and `output.asmBytes` describe temporary compilation output only. Validation does not store that generated ASM in the program; Run does.

## Emulator keyboard input

`x1pen_send_key` sends one allowlisted numeric Windows-compatible virtual key to the visible connected X1Pen emulator. For example, `65` is A, `13` is Enter, and `32` is Space. `durationMs` defaults to 80 and accepts integers through 2000. Modifier/latching keys, chords, text strings, OS input and arbitrary JavaScript are not supported. RUN, PROG and key requests share one non-interleaving queue; verify guest behavior with a screen capture or debugger state when needed.

## Emulator pad input

`x1pen_set_pad` sets joystick port 1 or 2 with one raw active-low byte (`bits` 0 through 255): bits 0–7 are Up, Down, Left, Right, Button 4, Button 2 (B), Button 1 (A), and Button 3. A zero bit means pressed; `255` releases every remote input on that port. Pad presses require a visible tab and share the RUN/PROG/key queue. Release bypasses visibility and busy admission so cleanup can supersede queued input.

The two ports are independent and are ANDed with physical input after physical rapid/button-swap transforms, leaving the public raw bit contract stable. Disconnect, bridge shutdown, tab reload/session loss, session selection, and machine reset release held remote input. Session selection waits up to two seconds for the old live tab to release its pads; by default failure returns `PAD_RELEASE_FAILED` without switching. `force: true` is an explicit escape hatch and returns a warning that the old tab may remain held until disconnect or reload.

## Z80 debugger

The debugger tools expose named CPU/video state, pause/resume, bounded multi-step execution, atomic PC breakpoint replacement, compact hexadecimal CPU/VRAM reads, paused VRAM writes, and filtered pause waiting. They operate only through the allowlisted X1Pen Automation API; arbitrary JavaScript, raw I/O, and raw WASM access are not exposed.

## Language and X1 hardware reference

The reference tools work before browser pairing because the data is bundled in this package:

- `x1pen_get_language_profile` lists the bundled profiles and compares them with a connected X1Pen version.
- `x1pen_search_reference` returns short summaries and stable reference IDs.
- `x1pen_get_reference` returns full details only for selected IDs, with a response-size limit.

Search first and fetch only the entries needed for the current program. This avoids putting a complete language manual into the model context.

The server initialization instructions tell MCP clients not to infer these nonstandard languages from ordinary BASIC, C, another SLANG release, or a different assembler, and not to confuse X1 CPU memory, I/O ports, VRAM, or their independent banks. FuzzyBASIC coverage includes direct indexed memory/I/O arrays, LSX-Dodgers-specific file limitations, machine-code integration, PCG, PSG sound, and joystick input. SLANG coverage is tied to the exact browser compiler and VFS, including compiler vocabulary, native FLOAT, LSX file I/O, X1 graphics/PCG/PSG/timing/SGL, compression, and all bundled include APIs. The assembler profile covers its exact literals, expressions, labels, directives, conditional assembly, macros, and complete accepted mnemonic set. The X1 hardware profile covers every I/O device routed by the current emulator build, including VRAM, screen controls, PPI/sub CPU, PSG/joystick, OPM, CTC, DMA, SIO/mouse, FDC, SASI, EMM/ROM board, Kanji ROM, and turboZ extensions. Exact symbols are searchable in English or Japanese, and an unsuccessful all-term search falls back to partial matches explicitly marked with `matchMode: "partial"`.

See the [complete setup and tool documentation](https://github.com/ho-ogino/xmil-web/blob/main/docs/X1PEN_MCP.md) for details.

# PCG redefinition redraw fix and Linux build/preview support

## Purpose

1. **Fix**: when a program redefines a PCG glyph (Hu-BASIC `DEFCHR$`, FuzzyBASIC `PCGDEF`, raw `OUT` to ports 0x15xx–0x17xx) while the character is already on screen, X millennium Web must show the new glyph. Today the on-screen cell keeps the glyph it had at its last redraw, so PCG-swap animations (e.g. a wave made by alternately redefining "V") do not animate. Real X1 hardware and other emulators animate.
2. **Linux build**: the wasm build and `npm run test:draw` must work on Linux (case-sensitive filesystem) as well as macOS (case-insensitive), without changing what macOS compiles.
3. **Preview**: the owner must be able to check the fix from another machine (their Mac) against a build served from the Linux host `dunedin`, reachable only over LAN/tailnet — never the public internet.

Non-goals:
- Per-cell PCG dirty tracking ("option B"). Kept as the follow-up if option A proves too slow.
- Raster-accurate mid-frame PCG reflection. Reflection is per frame (VSYNC), as for every other text change in this renderer.
- Automating the x1pen MCP pairing code.
- Any production change (Cloudflare Pages, npm publish, x1.onoda-pro.com).
- Renaming source files or restructuring headers.

## Observed evidence

### PCG redraw bug

- `src/X1_PCG.CPP` `x1_pcg_w(WORD port, BYTE value)` writes `pcg.B/R/G[chr][line] = value` in three code paths (T_TUNE=1 is the active build, `CMakeLists.txt:195`):
  - PCG high-speed mode (`crtc.SCRN_BITS & SCRN_PCGMODE`): `chr` from `pcg_offset()`, row `l = (port >> 1) & 7` (or `port & 15` for 16-line PCG).
  - Sync access (T_TUNE): `nowsyncoffset(&l)`.
  - Non-T_TUNE sync access: `pcg.woffN++` (compiled out in the web build).
  None of these touch `updatetmp[]`, `scrnflash` or `scrnallflash`.
- The text renderers in `platform/draw_width.cpp` (e.g. `draw_text_graph_common`, lines ~286–289, and the per-mode loops at ~609, ~780, ~956, ~1143, ~1332, ~1496) only regenerate a cell into `screenmap` when `updatetmp[addr] & update_mask` is set, then clear the bit.
- `updatetmp` is set by: text VRAM writes **only when the byte value changes** (`platform/x1_vram_port.cpp:101`), graphics VRAM writes, `fillupdatetmp()` (full screen), double-size attribute changes (`flashupdatetmp`), blink.
- `scrnupdate()` (`src/Draw.cpp:427`) runs once per emulated frame at the end of the display period (`x1_DISP_raster_callback` / `x1_V_SYNC_event_callback`, `src/X1.cpp`). It already handles `scrnallflash`:
  ```c
  if (scrnallflash) { scrnallflash = 0; fillupdatetmp(); x1vram_adjust(); scrnflash = 1; }
  ```
  `scrnallflash` is declared `extern BYTE scrnallflash;` in both `src/DRAW.H` and `platform/dummy_includes/draw.h`, defined in `src/Draw.cpp:18`.
- canvas presentation (`ddraws_drawall()` → `Platform_Graphics_UpdateScreen`, `platform/ddraws_web.cpp:159`) copies the whole `screenmap` whenever a redraw happened; `main_loop` runs one emulated frame per `emscripten_set_main_loop(main_loop, 60, 1)` tick. DRAW_SKIP is 0. The browser side is not the problem.
- Native reproduction (renderer compiled with g++ the same way `tests/draw_width_kanji_test.mjs` does): a PCG cell drawn with pattern A keeps showing A after `pcg.B` is rewritten to B four times with no `updatetmp` mark; marking the cell shows B immediately.

### Linux build failure

- On Linux, every translation unit fails at its first include, e.g. `src/X1_PCG.CPP:5: fatal error: 'common.h' file not found` (actual file `src/COMMON.H`). Same for `x1.h`/`X1.H`, `xmil.h`/`XMIL.H`, `opmcore.h`, `x1_irq.h`, etc. `npm run test:draw` fails identically (`tests/draw_width_kanji_test.cpp:8`).
- Include search on macOS is case-insensitive per directory, with the quoted-include order: directory of the including file, then `-I` dirs in order (`platform/dummy_includes`, `platform`, `src`, `src/Z80R`, `src/OPMSOUND`, `src/OTHERFNT`).
- A generated lowercase-alias include directory cannot reproduce macOS semantics: e.g. `src/Draw.cpp`'s `#include "draw.h"` resolves to `src/DRAW.H` on macOS (same directory first), but an alias dir after the real dirs would yield `platform/dummy_includes/draw.h` on Linux (different linkage: the dummy declares the functions `extern "C"`). An analysis script found 8 such divergences (`draw.h`, `draw_sub.h`, and `platform/platform_main.cpp`'s `DRAW.H`, which macOS resolves to the dummy `draw.h`).
- Rewriting each quoted/angle include string to the **exact on-disk spelling of the file macOS resolves it to** is behavior-preserving on macOS by construction (the case-insensitive lookup sees the same name) and makes Linux resolve the same file (the first case-insensitive match is the only possible exact match at or before that directory). Dry run: 240 include lines in 46 files. Applied in a throwaway worktree, `emcmake cmake` + `emmake make` (emsdk 6.0.13, Linux) builds `xmillennium.wasm` with no errors, and `node --test tests/draw_width_kanji_test.mjs` passes on Linux.
- No other case-sensitivity issue appeared in the build (CMake source lists already use exact names; runtime file access goes through Emscripten MEMFS, which is case-sensitive on every host).

### Build tooling on dunedin

- emsdk installed at `~/emsdk` (approved; emcc 6.0.13). `build.sh` already searches `$HOME/emsdk/emsdk_env.sh`.
- `build.sh` runs `npm ci` and `npx esbuild` for the X1Pen CodeMirror bundle. The repo requires Node `>=24.15 <25` and npm `>=12 <13` (`package.json` engines/packageManager, `.npmrc` `min-release-age`/`strict-allow-scripts`, `allowScripts`). System Node is v18 without npm (to be removed by the owner later; not touched here). emsdk ships Node 24.19.0 with npm 11.17.0, which would bypass the npm-12 install-script allowlist, so emsdk's npm must not be the one used.
- **Decided (owner, 2026-10-24): install Node via nvm under `~/.nvm`.** Done: nvm 0.40.3, `nvm install` (reads `.nvmrc` = 24.19.0, set as default alias), `npm install -g npm@12.0.2` inside that Node. With `. ~/.nvm/nvm.sh` loaded, `node` = v24.19.0 and `npm` = 12.0.2 from `~/.nvm/versions/node/v24.19.0/bin`. No system files touched.
- Ordering matters: `emsdk_env.sh` prepends emsdk's own Node/npm to `PATH`. `build.sh` sources emsdk only when `EMSDK` is unset; the build procedure therefore loads emsdk first and nvm second (`source ~/emsdk/emsdk_env.sh; . ~/.nvm/nvm.sh; nvm use`) so `npm` resolves to nvm's npm 12. `build.sh` then skips its own emsdk sourcing because `EMSDK` is set. The implementation verifies `npm --version` = 12.x inside the build.
- `.mcp.json` launches the x1pen MCP server as `node mcp/x1pen-server.mjs` (bare `node`). It stays unchanged: an absolute path would break the owner's Mac. Once the system Node is removed, `node` resolves through nvm's default alias in shells that load `~/.bashrc` (the nvm installer appended the loader there). This is documented, not coded.

### Preview reachability

- Network: LAN `192.168.5.15/24`, tailnet `100.97.52.38` (owner's `macbook-pro` is on the tailnet). `tailscale serve` already publishes noVNC on :6080 (tailnet only).
- The app needs a secure context: `crypto.randomUUID` (`html/x1pen.js:57`), `crypto.subtle.digest` (`html/pre.js:945`, `:1508`, `html/x1pen.js:1709`), OPFS (`html/storage.js`, with IndexedDB fallback), AudioWorklet (with ScriptProcessor fallback). Plain `http://100.97.52.38:8000/` is not a secure context, so disk hashing and X1Pen would break. `http://localhost:…` is a secure context.

## Change scope

Single PR, three commits (readable separately):

1. **`build: make include names match on-disk case`** — rewrite include strings in `src/**`, `platform/**`, `tests/draw_width_kanji_test.cpp` to the exact spelling of the macOS-resolved file. Only `#include` lines change; bytes elsewhere (CRLF, Shift-JIS comments) untouched. Add `tests/include_case_test.mjs` (Node, no compiler): for every tracked C/C++ source/header, assert that each project include resolves by exact case to the same file as a case-insensitive macOS-style lookup. Wire it into `npm test` as `test:include-case`. This keeps macOS-only development from silently breaking Linux again.
2. **`fix: redraw text when PCG patterns change`** — in `src/X1_PCG.CPP` `x1_pcg_w()`, for every path that stores a PCG byte, compare with the old value; when it differs, store it and set `scrnallflash = 1`. Declare via the existing `draw.h` extern (add the include if `X1_PCG.CPP` lacks it). Add a native regression test `tests/pcg_redraw_test.cpp` that links the real `src/X1_PCG.CPP` with `platform/draw_width.cpp`/`platform/draw_sub_data.cpp` and small stubs (`crtc`, `TXT_RAM`, `ANK_FNT`, `KNJ_FNT`, `x1flg`, event/timer symbols), driven from `tests/draw_width_kanji_test.mjs` (shared compile helper).
3. **`docs: Linux build and LAN preview`** — README: Linux build notes (emsdk, Node/npm requirement) and how to serve `dist/` for another machine on the tailnet/LAN via an SSH tunnel (secure context). Plus `CHANGELOG.md` entry under Unreleased if the file uses that convention.

Outside the repo (not committed): preview server start/stop instructions in the Secretary whiteboard directory.

## Implementation steps

1. Branch `fix/pcg-redraw-linux-build` from `main`.
2. Apply the include rewrite with the analysis script (kept outside the repo); review `git diff -U0` to confirm only `#include` lines changed. Add `tests/include_case_test.mjs` and the `test:include-case` npm script. Commit 1.
3. Build wasm on Linux (`emcmake cmake`, `emmake make`) and run `node --test tests/draw_width_kanji_test.mjs tests/include_case_test.mjs`.
4. Edit `x1_pcg_w()`:
   ```c
   static inline void pcg_store(BYTE *dst, BYTE value) {
       if (*dst != value) { *dst = value; scrnallflash = 1; }
   }
   ```
   used in all `pcg.B/R/G[...] = value` sites (the non-T_TUNE path too, for consistency). No change to reads, offsets, or wait behavior.
5. Write `tests/pcg_redraw_test.cpp`:
   - High-speed PCG mode: `crtc.SCRN_BITS |= SCRN_PCGMODE`, PCG-attribute cell at `TEXT_ATR+0x7ff` with ANK 0x56. Draw a PCG cell showing pattern A; write pattern B through `x1_pcg_w(0x1500 | (row << 1), …)`; assert `scrnallflash == 1`; simulate the existing `scrnupdate` contract (`scrnallflash` → mark every `updatetmp` cell with `UPDATE_TVRAM`) and redraw; assert the screen shows B.
   - Writing the same value again leaves `scrnallflash == 0`.
   - Sync-access path (no `SCRN_PCGMODE`) also sets `scrnallflash`.
   - Before the fix, the "shows B" assertion fails (verify by running the test against the unfixed source).
   Commit 2.
6. Browser verification on dunedin: build `dist/`, serve on `127.0.0.1:8000`, drive headless `/usr/bin/google-chrome` through CDP using emsdk's Node 24 (built-in WebSocket; no new install). Load X1Pen, set a FuzzyBASIC program that alternately `PCGDEF`s two patterns for one on-screen character, run it, take screen captures via `window.X1PenAutomation.captureScreen()` at intervals; assert both patterns appear. Repeat against the unfixed build to show it stays frozen. This uses the X1Pen editor bundle built by `./build.sh` with nvm's npm 12.
7. Docs commit 3. Run `npm test` subsets that are runnable on dunedin (`test:draw`, `test:include-case`, plus others that need only Node).
8. Implementation cross-review, then open one PR. Merge is the owner's.
9. Start the preview server (127.0.0.1 only) for the owner and report the tunnel command + URL + stop command.

## Edge cases and test plan

- **Performance**: during PCG animation, every changed PCG byte sets one flag; `scrnupdate` performs at most one full text redraw per frame (same work as a mode change). Hu-BASIC `DEFCHR$` writes 24 bytes per definition; flags coalesce. If profiling shows a problem, option B (per-character dirty set) is the follow-up.
- **Unchanged writes** (program re-defines the same glyph every loop) do not trigger redraws.
- **16-line PCG** (`TEXT_KNJ & 0x90`, `chr &= 0xfe`, `l = port & 15`): same store helper; covered implicitly by the full redraw.
- **64-color / 4096-color modes**: `scrnallflash` path already used by mode changes in those modes; no new code path.
- **State load**: unaffected (`pcg` restored wholesale; existing load path already sets `scrnallflash = 1`, `platform/state_save.cpp:597`).
- **Raster / mid-frame changes**: reflected at the next frame boundary. Two redefinitions within one frame show the last one — same as other text changes here.
- **macOS safety (include rewrite)**: proof by construction (only the case of names that macOS already resolves case-insensitively changes; resolution target is identical) plus `tests/include_case_test.mjs`, which asserts exact-case resolution equals case-insensitive resolution for every include. The test runs on both OSes. Owner can confirm with a normal `./build.sh` on the Mac.
- **Rollback**: each commit is independently revertible. Reverting commit 2 restores old rendering; reverting commit 1 restores macOS-only builds.
- **Preview server exposure**: bound to `127.0.0.1`; reachable from the Mac only through the owner's SSH tunnel. Nothing listens on LAN/tailnet/public interfaces.

## Open decisions

1. ~~Node 24 / npm 12 on dunedin~~ — **resolved**: nvm in `~/.nvm` (owner decision). The no-install alternative (skipping the editor bundle in `build.sh`) is dropped; `build.sh` is not changed.
2. **Preview access method** — chosen: serve `dist/` on `127.0.0.1:8000` and reach it from the Mac through an SSH tunnel over the tailnet/LAN (`ssh -N -L 8000:127.0.0.1:8000 ogino@dunedin`, then open `http://localhost:8000/`). Reason: secure context without touching the shared `tailscale serve` config, and nothing listens on non-loopback interfaces. `tailscale serve` HTTPS remains an option if the owner prefers a tunnel-less URL.
3. **One PR vs two**: one PR with three commits is planned. The include rewrite is a large mechanical diff (240 lines / 46 files); if the owner prefers, commit 1 can be split into its own PR.

## Acceptance checks

- Linux toolchain: in a shell with emsdk then nvm loaded, `node --version` = v24.19.0, `npm --version` = 12.0.2, `./build.sh` exits 0, and `dist/` contains `xmillennium.wasm`, `xmillennium.js`, `x1pen.html`, `x1pen_editor.bundle.js`.
- Tests on Linux: `npm run test:draw` and `npm run test:include-case` pass; the other Node-only suites in `npm test` are run and their results reported.
- Native fix proof: `tests/pcg_redraw_test.cpp` fails on the unfixed `X1_PCG.CPP` and passes on the fixed one.
- Browser proof: headless Chrome against `http://127.0.0.1:8000/x1pen.html`, FuzzyBASIC program alternating two `PCGDEF` patterns on one on-screen character; `X1PenAutomation.captureScreen()` frames show both patterns with the fix and only one without it.
- Preview: server listening only on `127.0.0.1:8000` (checked with `ss -ltnp`); the tunnel instructions, URL, start and stop commands are reported.
- macOS safety: `tests/include_case_test.mjs` passes (exact-case resolution equals case-insensitive resolution for every include) and the argument in "Edge cases" holds; the owner can additionally run `./build.sh` on the Mac.

## Cross-review反映

### Round 1 — codex / gpt-6-astra/high
- Verdict: NEEDS_WORK (model=NEEDS_WORK; policy=strict; host_override=no)
- Implementation: READY AFTER FIXES (R1-F1) (next_action=fix_then_implement; reviewer=READY_AFTER_FIXES)
- [adopted][medium] R1-F1 Resolve the incomplete no-install build and preview path → owner chose nvm Node 24/npm 12 (installed); no-install path dropped; "Build tooling on dunedin" documents the emsdk/nvm PATH ordering; new "Acceptance checks" section; implementation step 6 and Open decisions updated.

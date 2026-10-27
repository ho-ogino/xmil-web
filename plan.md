# X1Pen HuBASIC tab: replace the plain CodeMirror editor with X1 BASIC Editor (byte-preserving), imported at a fixed commit

## Purpose

Replace the editor of X1Pen's HuBASIC tab with **X1 BASIC Editor** (https://github.com/ho-ogino/x1-basic-editor, MIT, owned by the same owner; kept as a standalone Electron app too). The editor edits **X1 bytes** (the X1 ASCII-save character set: kana, graphic symbols, control codes) with an 8×8 X1 font, a symbol palette and PCG previews.

Decisions already made by the owner (not up for review):
- **Option A**: a script copies a chosen commit of the editor repo into xmil-web (same pattern as the HuBASIC bundle, `scripts/import-hubasic-bundle.mjs`). No submodule, no npm package. The commit was **`1539e3d02d031e93b2ec784b90e13eff24d2be20`** (main after the editor's PR #2). Before the merge it was replaced by **`aa1061142660d4c4d95bd7a1794cd677ea5d7c2f`** (editor PR #3). That commit adds a sidebar toggle, renames 開く/保存 to インポート/エクスポート, and hides 新規/別名で保存 when a host is injected. The host API is unchanged. The repo does not use tags for this (tags mean releases there).
- The editor is shown in an **iframe** inside the HuBASIC tab and **replaces** the current CodeMirror editor of that tab (no second HuBASIC tab).
- **X1 bytes are the source of truth.** Run passes the bytes to hubasic2sl as `inputEncoding: "x1"`. Storage (localStorage) and the automation/MCP API (`getProgram`/`setProgram` `hubasic` string) stay Unicode strings, converted with the editor's own `codec.js`.
- One host adapter file `x1pen-host.js` (xmil-web's own code) plugs X1Pen into the editor.
- Add the license notice for the editor's built-in font (Misaki-derived X1-compatible font).

Non-goals: Share of HuBASIC programs (still refused), x1pen-mcp changes (published 2.7.x still stops with `invalid source mode` while HuBASIC is the active source), the PCG editor (defchrtool), a cursor-preserving replace API, any change to the other tabs, any production deploy or version bump.

## Observed evidence

### The editor at 1539e3d (read in a scratch clone; nothing pushed)
- Browser files: `src/index.html`, `src/style.css`, `src/codec.js`, `src/keywords.js`, `src/syntax.js`, `src/pcg.js`, `src/font-builder.js`, `src/host.js`, `src/sidebar-resize.js`, `src/editor.js`; assets `assets/x1-basic.ttf` (91,688 bytes), `assets/x1-font.json`, `assets/x1-font-provenance.json`, `assets/licenses/misaki.txt`; `LICENSE` (MIT), `THIRD-PARTY-NOTICES.md`. Electron-only: `main.cjs`, `preload.cjs`, `src/*.cjs`.
- `src/index.html` loads, in order: `codec.js keywords.js syntax.js pcg.js font-builder.js host.js sidebar-resize.js editor.js`, has a meta CSP `default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'`, and `style.css` loads the font with `url('../assets/x1-basic.ttf')` (so `src/` and `assets/` must stay siblings).
- `src/host.js`: `window.X1Host = window.X1Host ?? window.desktop; if (!window.X1Host) throw ...`. The editor README ("iframeへの組み込み") says: in an iframe, add `<script src="x1pen-host.js">` after `font-builder.js` and before `host.js`, and set `window.X1Host` synchronously.
- Host methods used by `editor.js`: `onLoaded(cb)` (cb receives `{name, bytes}`; this is how a document is loaded from outside; `doc.load` resets undo and puts the caret at 0), `onCommand(cb)` (cb is the editor's `command(name)`; names include `new open save save-as undo redo find find-next find-prev insert pcg-setup zoom-in zoom-out help font-load font-reset`), `open()`, `save({bytes, saveAs})` (truthy → the snapshot becomes "saved"), `confirmDirty()` → `'save'|'discard'|'cancel'`, `state({dirty})`, `newDocument()`, `close()`, optional `currentFont()` → `{name, data: TTF bytes}` or null, `chooseFont()`, `commitFont(token)`, `resetFont()`, `pcgFont({entries, order, layout})` → TTF bytes, optional `contentChanged({bytes, dirty})`: called on the initial render and on every real byte change (typing, IME end, paste, cut, insert, replace, undo/redo, new, load), not for identical content or save-only.
- If `onLoaded` calls back synchronously at registration, the first `contentChanged` already carries that document (README).
- `window.X1FontBuilder` (browser): `parseFontRom(Uint8Array(2048))` → 256×8 bitmap, `buildFont(bitmap, entries=[], order='BRG', layout='planar')` → TTF `Uint8Array`, `buildFontFromRom(bytes)`.
- Header buttons in `index.html`: 新規 / 開く… / 保存 / 別名で保存… / undo / redo / 検索 / ?. Keyboard shortcuts for these exist only as Electron menu accelerators (`main.cjs`: Ctrl+N/O/S/Shift+S/I/Shift+P/F, F3, Shift+F3, Ctrl+Plus/Minus); the editor itself handles only Ctrl+Z/Y, Tab, Escape.
- `codec.js` (UMD; browser global `X1`): `decode`, `encodeInput(text, newline)` (ASCII, U+E000+b, half/full-width kana and hiragana, ♥ ● ─ ¥ π …; throws `X1で表現できない文字があります：…` otherwise), `parseEscapes(text, newline)` (`\xHH`, `\{name}`, `\\` plus `encodeInput`), `clipboardText(bytes)` (ASCII as is, $A1–$DF as half-width kana, named symbols as `\{name}`, others `\xHH`, $5C as `\\`, CR/LF/CRLF as `\n`).
- I ran `parseEscapes(clipboardText(b))` for all 256 bytes (wrapped as `41 b 42 0D 0A`): identical for every byte. Only the newline kind is not preserved.
- The editor no longer ships X1Pen-derived glyphs. The built-in font is Meister's X1-compatible font (from the Misaki font), with provenance (commit and SHA-256) and the license text included; redistribution is allowed with the notice.

### X1Pen today (main 1b30cbd)
- `html/x1pen.js:461` creates `hubasicEditor = window.X1PenEditor.create(#hubasic-editor-container, {language:'basic', onChange: markProgramChanged + persistEditorSource(LS_EDITOR_HUBASIC, text), onFocus/onBlur: pause/resume the emulator})`. The only methods X1Pen calls on it are `getValue()` and `setValue(text, {silent:true})` (lines 481, 1132, 1159, 1175, 1893, 2003, 2726, 3105, 3304).
- Run: `performRun` → `performHuBasicRun(hubasicEditor.getValue())` → `X1PenHuBasic.build(source)`; `html/x1pen_hubasic.js:163` does `new TextEncoder().encode(sourceText)` and `Transpile(bytes, SOURCE_NAME, '{"inputEncoding":"utf8"}')`. Automation `validateHuBasicProgram(program)` calls `X1PenHuBasic.build(program.hubasic)`.
- hubasic2sl accepts `inputEncoding` `auto|utf8|sjis|x1` (SLANG-compiler `src/SLANGCompiler.HuBasic/Web/HuWebApi.cs`, `Text/HuSource.cs`). The `x1` reader stops at $1A, splits lines on CR, LF and CRLF, and maps tab to space. It is covered by `HuBasicWebTests` in the bundle revision X1Pen ships (5abbffa).
- Storage: `localStorage['x1pen_editor_hubasic']` holds the Unicode text. `persistEditorSources` writes all four sources.
- Automation: `getAutomationProgram` returns `hubasic` as a string. `normalizeAutomationProgram` validates the strings. `setAutomationProgram` writes all editors with `setValue(..., {silent:true})`, persists them and bumps `automationRevision` (`markProgramChanged`).
- Automation lock: `#editor-panel.inert = locked`, and `document.activeElement.blur()` runs when the lock starts.
- Tabs: `setActiveEditorTab` toggles `.hidden` (visibility hidden, height 0) on the four containers. Startup selects the HuBASIC tab when it has content. There is a mobile tab `data-panel="hubasic"`.
- Page CSP (`html/x1pen.html` meta): `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; ... connect-src 'self' blob:` → a same-origin iframe is allowed (frame-src falls back to default-src).
- **Production headers** (`html/_headers`, Cloudflare Pages) set `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` on `/*`. **This blocks even a same-origin iframe.** The test server (`tests/x1pen_automation_test.mjs`, a plain Node static server on `dist/`) and the preview server do not apply `_headers`, so tests alone would not catch it.
- `build.sh` copies `assets/hubasic` to `dist/hubasic` (two copy sections: build dir and `DIST_DIR`), appends `?v=<hash>` only to script tags of x1pen.html/xmillennium.html/url-builder.html. Pages serves other static files with revalidation by default.
- Registered font ROM: `html/pre.js` keeps the ANK 8×8 ROM in localStorage `xmil_fnt_ank8` and writes it to the emulator VFS as `/FNT0808.X1` (`FONT_CFG.ank8`). Absent → the emulator uses its built-in font.
- `THIRD_PARTY_LICENSES.md` has no Misaki/X1-compatible-font entry. It is linked from `licenses.html`.
- HuBASIC is in CHANGELOG "Unreleased" (not yet deployed), so only preview users can have saved HuBASIC text.

## Change scope

1. **`scripts/import-x1-basic-editor.mjs`** (new): `node scripts/import-x1-basic-editor.mjs <checkout-dir> [--expect <40-hex>]`.
   - Requires a git checkout with a clean worktree (`git status --porcelain` empty). Reads `HEAD` (and checks it equals `--expect` when given).
   - Copies the browser file list above into `assets/x1basic/` with the same relative layout (`src/…`, `assets/…`, `LICENSE`, `THIRD-PARTY-NOTICES.md`). Removes stale files there first.
   - **Inserts exactly one line** `<script src="x1pen-host.js"></script>` immediately before `<script src="host.js"></script>` in `src/index.html`, and fails if that anchor is not found exactly once.
   - Writes `assets/x1basic/source.json` = `{repository, commit, files: {path: {sha256, size}}, injected: {path: 'src/index.html', line}}`. The hashes are of the upstream bytes, so `index.html` is hashed before the insertion.
2. **`assets/x1basic/`** (generated, committed): the copied files + `source.json`. Never edited by hand.
3. **`html/x1pen_hubasic_text.js`** (new, UMD-style like the other `x1pen_*.js`; global `X1PenHuBasicText`; needs `X1` from `codec.js`):
   - `toText(bytes)`: `X1.clipboardText(bytes)` with `\\` written as `¥`. $5C is ¥ on the X1, and `¥` reads back as $5C. Only `\x..`, `\{..}` and `\\` are escapes.
   - `fromText(text)`: `X1.parseEscapes(text, '\r\n')`. Strict: it throws the codec error for characters the X1 cannot show.
   - `fromLegacyText(text)`: per character, `encodeInput`, falling back to `?`. **It never interprets escapes**: a literal `\x41`, `\{heart}` or `\\` stays as those characters, with `\` as $5C. Returns `{bytes, replaced}`. Used only to migrate text saved by the plain tab.
4. **`html/x1pen_x1basic_host.js`** (new; published as `x1basic/src/x1pen-host.js`): runs inside the iframe and synchronously sets `window.X1Host`, delegating to the parent bridge `window.parent.X1PenHuBasicEditorBridge` (same origin):
   - `onLoaded(cb)`: registers `cb` with the bridge, which calls it synchronously with the current program `{name, bytes}`.
   - `contentChanged({bytes})`: forwards to the bridge.
   - `onCommand(cb)`: keeps `cb`, and installs a keydown handler on the iframe document that mirrors the Electron accelerators. It calls `preventDefault` so Ctrl+S/O/N/F do not reach the browser.
   - `open()`: an `<input type=file>` in the iframe, up to 2 MiB → `{name, bytes}`.
   - `save({bytes, saveAs})`: downloads the bytes as a file. The name is the last opened name or `PROGRAM.BAS`; `saveAs` asks for a name. Returns true. The program itself is already kept by X1Pen; this is an export.
   - `confirmDirty()`: `confirm('今の HuBASIC プログラムを置き換えます。よろしいですか？')` → `'discard'` or `'cancel'`. X1Pen always keeps the current program, so "save first" does not apply.
   - `state`, `newDocument`, `close`: no-ops.
   - `currentFont()`: if the parent emulator VFS has `/FNT0808.X1` (2048 bytes) → `{name: 'X1Pen に登録したフォント', data: X1FontBuilder.buildFontFromRom(Uint8Array.from(rom))}`; else null (the built-in font).
   - `chooseFont()`: null. Fonts are registered in X1Pen's settings, and the browser UI has no font-load button.
   - `resetFont()`: true.
   - `pcgFont(...)`: `X1FontBuilder.buildFont(base, entries, order, layout)`. `base` is the registered ROM's bitmap or `assets/x1-font.json`. The parent fetches that file, because the iframe CSP has `connect-src 'none'`.
   - Focus: iframe window `focus` → pause the emulator, `blur` → resume (the same callbacks as CodeMirror's `onFocus`/`onBlur`).
5. **`html/x1pen.js`**: replace the CodeMirror `hubasicEditor` with an adapter object that has the same `getValue()` / `setValue(text, {silent})`, plus `getBytes()`.
   - The adapter holds `bytes` (the truth) even before the iframe exists. The iframe is created on the first activation of the HuBASIC tab, `src = x1basic/src/index.html?v=<build hash>`.
   - `getValue()` = `toText(bytes)`.
   - `setValue(text)` = `fromText` (throws before changing anything); if the iframe is ready, it hands the bytes to the registered `onLoaded` callback and suppresses the echo.
   - Bridge `contentChanged(bytes)`: equal to the current bytes → ignore; else store a copy, then `markProgramChanged()` and `persistEditorSource(LS_EDITOR_HUBASIC, toText(bytes))`.
   - **Storage is versioned (R1-F1).** The new tab reads and writes only a new key, `x1pen_editor_hubasic_x1` (format: `toText` text; `LS_EDITOR_HUBASIC` now points to it).
   - The old key `x1pen_editor_hubasic` (plain Unicode text from the CodeMirror tab) is **only read, never written or removed**, so it stays as the backup of the original.
   - Restore at startup:
     - (a) the new key exists → `fromText(value)`. If that fails (only possible after a manual edit), start empty, leave the value untouched and show the error in the status. The next edit overwrites it.
     - (b) else the old key exists → migrate once with `fromLegacyText`, write the result to the new key immediately, and show a status message when `replaced > 0` (the original stays under the old key).
     - (c) else empty.
   - Because (a) wins on the next load, the migration runs exactly once and never parses legacy text as escapes.
   - `normalizeAutomationProgram`: validates `hubasic` with `fromText`. An unrepresentable character → `TypeError` (`hubasic: X1で表現できない文字があります：…`) and no editor changes.
   - `performHuBasicRun` and `validateHuBasicProgram` pass `hubasicEditor.getBytes()` (validate converts `program.hubasic` with `fromText`).
6. **`html/x1pen_hubasic.js`**: `build(source)` accepts a `Uint8Array` → `inputEncoding: 'x1'`. A string keeps the current `utf8` path (unchanged behavior for callers that pass text).
7. **`html/x1pen.html`**:
   - Load `x1basic/src/codec.js` and `x1pen_hubasic_text.js` before `x1pen.js`.
   - CSS so that an iframe fills `#hubasic-editor-container` (no border, 100%×100%).
8. **`html/_headers`**: allow same-origin framing only for `/x1basic/*`:
   ```
   /x1basic/*
     ! X-Frame-Options
     ! Content-Security-Policy
     Content-Security-Policy: frame-ancestors 'self'
   ```
   Every other path keeps `DENY` / `'none'`. Verified locally with `wrangler pages dev dist` (already in node_modules; local only, no Cloudflare account). Fallback if Pages cannot detach and set in one rule: change the global rule to `X-Frame-Options: SAMEORIGIN` + `frame-ancestors 'self'` (same-origin framing only). That is reported back before choosing it.
9. **`build.sh`** (both copy sections): `rm -rf x1basic; cp -R assets/x1basic → x1basic` and copy `html/x1pen_x1basic_host.js` → `x1basic/src/x1pen-host.js`. Also copy `html/x1pen_hubasic_text.js`. Fail the build if `assets/x1basic/source.json` is missing.
10. **`THIRD_PARTY_LICENSES.md`**: new section "X1 BASIC Editor (MIT)" and "X1 互換フォント / 美咲フォント", with the source repo, commit, the file list and the notice. Point to `x1basic/assets/licenses/misaki.txt` and `x1basic/THIRD-PARTY-NOTICES.md`, which are published as is.
11. **Docs/CHANGELOG**: `docs/X1PEN.md` HuBASIC section (editor, bytes, `¥`/`\{name}`/`\xHH` in the automation string, file open/export, registered font). CHANGELOG Unreleased entry.
12. **Tests** (below).

## Implementation steps

1. Write the import script; clone the editor at 1539e3d in the scratch dir and import; commit `assets/x1basic/` with the script.
2. `x1pen_hubasic_text.js` + node tests.
3. `x1pen_hubasic.js` byte input.
4. Host adapter + parent adapter/bridge in `x1pen.js`, HTML/CSS, build.sh.
5. `_headers` + local `wrangler pages dev` check (framing allowed for `/x1basic/*`; `/x1pen.html` and others still `DENY`).
6. Licenses, docs, CHANGELOG.
7. Full `npm test` + the new E2E tests; manual check through the preview server.

## Edge cases and test plan

Node (`tests/x1basic_editor_test.mjs`, added to `npm test`):
- `source.json`: every listed file exists in `assets/x1basic/` with the recorded SHA-256 and size. `src/index.html` matches after removing the single injected line. The injected line sits right before `host.js`. No unlisted files. The commit is 40-hex.
- `toText`/`fromText` round trip for all 256 bytes (with `41 b 42 0D 0A`); $5C → `¥`; `fromText('¥')` = $5C; `fromText('\\')` (lone backslash) = $5C; kana, hiragana and `♥` map to X1 codes; `漢` throws; `fromLegacyText('A漢')` = `41 3F`, replaced 1.
- `_headers`: the `/x1basic/*` rule exists, and the global rule still has DENY / `'none'`.
- The import script refuses a dirty checkout, a mismatched `--expect` and a missing anchor (run against a temp git repo built in the test).

E2E (`tests/x1pen_automation_test.mjs`, existing Playwright harness; add `.ttf` to its MIME map):
- Existing HuBASIC tests keep passing: setProgram → validate → run → text VRAM, conversion error lines, failure states. The persistence test now checks the new key `x1pen_editor_hubasic_x1` holds the program text.
- Editor shows the program: after `setProgram`, the HuBASIC tab iframe's `#editor` value equals the program (mirror text).
- Typing in the iframe (frame locator, `keyboard.type`) updates `getProgram().hubasic`, bumps the revision, and persists to localStorage.
- Bytes reach the converter: `setProgram('10 PRINT "\\{heart}ｱ¥"\n…')`, Run, and text VRAM contains `E3 B1 5C`. This proves the x1 path: under the old utf8 path the escape `\{heart}` would have reached hubasic2sl as eight literal characters.
- `setProgram` with `漢` → rejected with the X1 error; editor and revision unchanged.
- Legacy migration (R1-F1):
  - reload with only the old key = `'10 REM 漢\\x41\\{heart}\\\\'` (literal backslashes) → the new key holds `toText` of `10 REM ?` followed by the literal bytes `5C 78 34 31 5C 7B …` (no escape interpreted);
  - the old key is unchanged, and the status names one replaced character;
  - a second reload reads the new key, so the status shows no migration message and the program is the same;
  - after an edit, only the new key changes;
  - with both keys present, the new key wins.
- The automation lock makes the panel inert: focus cannot enter the iframe while locked.
- `pcgFont` through the host returns a non-empty TTF (called inside the iframe).

Manual (preview server via ssh tunnel): IME kana input, palette insert, open a real `.bas`, export, registered font ROM, Ctrl+S not opening the browser's save dialog, emulator pauses while typing, narrow window.

Failure behavior:
- The editor iframe fails to load: the bytes stay in the adapter. Run, automation and storage still work, and the status shows the load error.
- `setProgram` with bad text: rejected, nothing changes.
- Import script errors: no partial copy is left (copy into a temp dir, then rename).

Rollback: revert the PR. The old CodeMirror tab reads only the old key, which the new tab never writes, so it gets back the text as it was before the first migration. Edits made in the new tab are not visible to the old tab: they stay in the new key. Acceptable for a revert of an unreleased feature, and stated in the PR.

## Open decisions

- **D1 (_headers)**: per-path detach for `/x1basic/*` (planned) vs. making the global rule same-origin. Decided by the local wrangler check; if per-path does not work, report before switching to the global rule.
- **D2 (¥)**: the automation string writes $5C as `¥` (planned; the codec's own clipboard form uses `\\`). Lone `\` still reads as $5C.
- **D3 (save button)**: "保存" downloads an export file (planned). The program itself is kept by X1Pen automatically.
- Known limits, written in the docs:
  - an outside `setProgram` resets undo and puts the caret at the top;
  - the newline kind is normalized to CRLF;
  - on phones the editor's side panel is wide;
  - a font ROM registered while the tab is open is used after a reload.

## Cross-review反映

### Round 1 — codex / gpt-6-astra/high
- Verdict: NEEDS_WORK (model=NEEDS_WORK; policy=strict; host_override=no)
- Implementation: READY AFTER FIXES (R1-F1) (next_action=fix_then_implement; reviewer=READY_AFTER_FIXES)
- [adopted][high] R1-F1 Legacy restoration silently interprets existing text as escapes → Change scope 3 (`fromLegacyText` never interprets escapes) and 5 (versioned key `x1pen_editor_hubasic_x1`; the old key is read once, never written; migration only when the new key is absent), test plan (literal `\x41` / `\{heart}` / `\\` in legacy text, backup preserved, second reload, new key wins), rollback.
- Also checked locally after writing the plan (not a finding): `wrangler pages dev` (local, compatibility date 2026-08-01) applies the `/x1basic/*` rule as planned: no `X-Frame-Options` and `frame-ancestors 'self'` there; `/x1pen.html` keeps `DENY` / `'none'`. Pages redirects `/x1basic/src/index.html?v=…` to `/x1basic/src/?v=…` (308, query kept), so the iframe uses `x1basic/src/index.html` and works on both servers. D1 is settled: per-path rule.

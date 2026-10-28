# X1Pen: import X1 BASIC Editor 292901a (hover preview of strings as a composed PCG image)

## Purpose

The X1 BASIC Editor (HuBASIC tab of X1Pen, an iframe) is copied from `ho-ogino/x1-basic-editor` at one commit into `assets/x1basic/`. Its PR #4 is merged at `292901a7379212c009ea1d7c73a19ad33b4eed5c` (previous copy: `aa1061142660d4c4d95bd7a1794cd677ea5d7c2f`). Re-import it so that, in X1Pen, resting the mouse on a closed string (`"…"`) for 600 ms shows the string drawn with its cursor-move control codes ($1C–$1F) as one image, normal characters and PCG alike.

Also make the importer refuse a commit whose `src/index.html` loads a local file the importer does not copy. This import is the first one that adds a new upstream file (`src/pcg-preview.js`); without the fix the copy would load a missing script and the editor would not start.

Non-goals: no change to the editor itself (owned by the x1editor Province; requests go through Secretary), to X1Pen's host adapter API, to Share/automation/MCP, or to production (deploy and version bump are the owner's).

## Observed evidence

- `assets/x1basic/source.json`: `commit` = `aa10611…`, `files` = sha256/size of 16 upstream files, `injected` = the one line `<script src="x1pen-host.js"></script>` before `<script src="host.js"></script>` in `src/index.html`.
- `scripts/import-x1-basic-editor.mjs`: `FILES` is a fixed list of 16 paths (`src/index.html`, `src/style.css`, `src/codec.js`, `src/keywords.js`, `src/syntax.js`, `src/pcg.js`, `src/font-builder.js`, `src/host.js`, `src/sidebar-resize.js`, `src/editor.js`, 4 assets, `LICENSE`, `THIRD-PARTY-NOTICES.md`). `importEditor(checkout, {expect, target})` reads each path from git objects of the checkout HEAD (refuses a dirty worktree or a different `--expect`), injects the host line, writes to a temp dir and renames it over `assets/x1basic`. Files not in `FILES` are silently not copied.
- Upstream `aa10611..292901a` (`git diff --stat`): `src/editor.js` (+53/−15), `src/index.html` (+2/−1), **new `src/pcg-preview.js` (116 lines)**, `src/style.css` (+5), plus README and upstream tests (not copied).
  - `src/index.html` now loads `pcg-preview.js` between `pcg.js` and `font-builder.js`, and adds `<div id="pcg-string-preview" role="tooltip" hidden>` with a canvas. The `host.js` anchor is unchanged, so the injection still applies.
  - `src/editor.js` calls `X1PcgPreview.attach({...})` at start-up unconditionally: if `pcg-preview.js` is missing, start-up throws and the editor never calls `host.onLoaded` — X1Pen's HuBASIC tab would show an empty, dead editor.
  - `src/pcg-preview.js`: the panel is `position:fixed` inside the editor document, sized and placed from `window.innerWidth/innerHeight` of the iframe (scale ≤ 4, may go below 1 to fit), `pointer-events:none`, hidden on mouseleave/mousedown/scroll/input/blur/document pointerdown+keydown/resize/visibilitychange. It changes no source, selection, undo or saved state. No new host API, command or dependency (as x1editor reported).
  - Local references of the new `src/index.html`: `style.css`, `codec.js`, `keywords.js`, `syntax.js`, `pcg.js`, `pcg-preview.js`, `font-builder.js`, `host.js`, `sidebar-resize.js`, `editor.js` — all in `FILES` once `src/pcg-preview.js` is added.
- `html/x1pen_x1basic_host.js` (X1Pen's adapter, served as `x1basic/src/x1pen-host.js`): keyboard shortcuts on document keydown (capture), and focus handling that sends focus back to X1Pen unless the user pressed/typed in the frame. Mouse moves are not handled, so hovering neither focuses the frame nor pauses the emulator.
- `html/_headers` `/x1basic/*`: only frame-ancestors; no script CSP, so a new same-origin script needs no header change. `build.sh` copies the whole `assets/x1basic` directory, so no build change.
- `tests/x1basic_editor_test.mjs`: checks the committed copy against `source.json` (file set, sizes, sha256, host line placement, script order around `host.js`) and importer behaviour on a fake repo. It does not check that every local script of `index.html` is copied.
- Pre-plan experiment (scratchpad Playwright, X1Pen from the preview server with `x1basic/src/*` routed to the 292901a checkout + injected host line; repo unchanged):
  - 1500×900 (iframe 831×832): hovering `"ABC↓←←←DEF"` shows the panel, `24×16 ドット（3×2文字）`, ABC over DEF, inside the frame; no page errors.
  - 900×600 (iframe 231×532, wrapped lines): panel shows within the frame (x 23–223).
  - A 5,000-byte string (64 columns × 40 rows, truncated at 4096 bytes / 64×32 chars): panel width clamps to the frame (8–223 at 231 wide; 197–677 at 831 wide), canvas scaled down to fit, `scrollHeight == clientHeight` (nothing cut), truncation warning shown.
  - So the overlay cannot leave the iframe, but it is kept inside it and not clipped. In a very narrow frame a big image is scaled below 1× and becomes hard to read (upstream behaviour; reported, not changed here).

## Change scope

- `scripts/import-x1-basic-editor.mjs`
  - Add `'src/pcg-preview.js'` to `FILES`.
  - New check (exported helper `localReferences(html)`): every `<script src>` / `<link href>` in upstream `src/index.html` (before the host line is injected) that is a relative path must resolve to a path in `FILES` (relative to `src/`); otherwise fail `src/index.html loads <path>, which is not copied (add it to FILES)`, before anything is written. Absolute URLs (`http:`, `https:`, `//`, `data:`) are ignored.
- `assets/x1basic/**`: regenerated by the importer from `292901a` (`--expect`): `source.json`, `src/index.html`, `src/editor.js`, `src/style.css`, new `src/pcg-preview.js`. No hand edits.
- `tests/x1basic_editor_test.mjs`: the committed copy's `index.html` local references are all present upstream files (the injected `x1pen-host.js` is checked separately: its source exists and `build.sh` copies it); importer refuses a commit whose `index.html` loads an uncopied script and leaves the previous copy; `localReferences` unit cases.
- `tests/x1pen_automation_test.mjs`: one E2E test of the hover preview in X1Pen (below).
- `docs/X1PEN.md` (HuBASIC tab bullets) and `CHANGELOG.md` (Unreleased, under the X1 BASIC Editor entry): one bullet each.

## Implementation steps

1. Branch `feat/x1basic-292901a` from main `3fe646c`.
2. Importer: add `src/pcg-preview.js` to `FILES`; add `localReferences` and run the check on the upstream `src/index.html` bytes right after reading them (before the temp dir is written).
3. Run `node scripts/import-x1-basic-editor.mjs <scratch clone at 292901a> --expect 292901a7379212c009ea1d7c73a19ad33b4eed5c` (clone in the scratchpad; the x1editor Province's checkout is not touched). Confirm `git diff --stat assets/x1basic` matches the upstream diff of the copied files and `source.json` has 17 files.
4. Tests (unit + E2E), docs, CHANGELOG.
5. `./build.sh`, full `npm test`, refresh the preview server's `dist/`, manual hover check in the preview at a wide and a narrow window.
6. Implementation review, then one PR.

## Edge cases and test plan

- Unit (`npm run test:x1basic`):
  - committed copy: hashes/sizes/file set as today (now 17 files), and every local reference of `src/index.html` exists under `assets/x1basic/src` and is in `source.json`, **except the injected host adapter** (`x1pen-host.js`, the `source.injected.line`), which is not an upstream file; its placement checks stay as they are, and the test checks that its source `html/x1pen_x1basic_host.js` exists and that `build.sh` copies it to `x1basic/src/x1pen-host.js` for both the build and `dist/` (the E2E tests load it from that URL);
  - importer on a fake repo whose `index.html` has `<script src="extra.js">` not in `FILES` → rejects `/not copied/`, previous copy intact; absolute and `data:` URLs ignored; `localReferences` parses both quote styles of `src`/`href` it needs (upstream uses double quotes; single quotes covered for safety).
- E2E (`tests/x1pen_automation_test.mjs`, new test "hovering a string in the HuBASIC editor shows it as one image"):
  - program `10 CLS\n20 PRINT "ABC\x1F\x1D\x1D\x1DDEF"\n30 GOTO 30\n`; focus the emulator canvas; move the mouse onto the first client rect of `.pcg-literal` inside the iframe; wait for `#pcg-string-preview` to be visible;
  - assert size text `24×16 ドット（3×2文字）`, the panel rect lies inside the iframe viewport (`0 ≤ left`, `right ≤ innerWidth`, `0 ≤ top`, `bottom ≤ innerHeight`) and `scrollHeight ≤ clientHeight`;
  - hovering did not change focus (`document.activeElement` still the canvas) or the program revision;
  - moving the mouse out of the editor hides it.
  - Mutation check: drop `src/pcg-preview.js` from the dist copy → the E2E test (and the existing editor tests) fail.
- Rollback: re-run the importer at `aa10611` (the `FILES` addition is harmless for that commit only if the file exists — it does not at `aa10611`, so rollback = revert the PR commit, which restores both the list and the copy). Note this in the PR.
- Regression: full `npm test` (all existing HuBASIC editor E2E tests: Run uses bytes, Ctrl+Enter, focus not taken, import/export/side panel).

## Open decisions

- None blocking. Readability of a big image in a very narrow frame (scaled below 1×) is upstream behaviour; report it to x1editor via Secretary as an observation, not a request.

## Cross-review反映

### Round 1 — codex / gpt-6-astra/high
- Verdict: NEEDS_WORK (model=NEEDS_WORK; policy=strict; host_override=no)
- Implementation: READY AFTER FIXES (R1-F1) (next_action=fix_then_implement; reviewer=READY_AFTER_FIXES)
- [adopted][medium] R1-F1 the committed `index.html` also loads the injected `x1pen-host.js`, which is not in the upstream manifest, so a plain "every reference is in source.json" assertion would reject a valid copy → Edge cases and test plan (unit: injected adapter excluded from the manifest check, its source file and its copy in `build.sh` checked instead), Change scope (tests, importer check runs on the upstream HTML before injection)

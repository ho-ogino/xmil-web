# X1Pen: HuBASIC editor "エクスポート" saves in Firefox (download from x1pen.html, not from the iframe)

## Purpose

In Firefox, the HuBASIC tab's "エクスポート" button shows "エクスポートしました" but saves nothing: no file in Downloads and no save dialog. Chrome saves to Downloads, and Brave shows its save dialog. ひろしさん chose fix B: X1Pen starts the download from its own page (x1pen.html), like its other downloads, and the CSP stays as it is (fix A, adding `frame-src blob:`, is not taken).

Also wanted:
- a Firefox test, so this does not come back;
- an export that fails visibly instead of showing "エクスポートしました", where X1Pen can tell.

Non-goals:
- No change to X1 BASIC Editor itself (x1-basic-editor, vendored under `assets/x1basic/`). If the message needs an editor change, it is only reported (Secretary relays it to x1editor).
- No CSP change, no version bump, no deploy or publish.

## Observed evidence

- Reproduced on dunedin with Playwright's Firefox (`~/.cache/ms-playwright/firefox-1538`, installed with `npx playwright install firefox`) against the preview server:
  - Firefox: no download event. Console: `Content-Security-Policy: The page's settings blocked the loading of a resource (frame-src) at blob:http://127.0.0.1:8000/… because it violates the following directive: "default-src 'self'"`, reported for `x1pen.html`.
  - Chrome (same steps): download `PROGRAM.BAS`.
- Code path:
  - The editor's button `[data-command="save"]` (labelled "エクスポート" by the editor's `host.js` when a host is injected) calls `command('save')` → `save()` in `assets/x1basic/src/editor.js`. `save()` calls `host.save({bytes, saveAs})` synchronously (no await before it), and when it returns a truthy value shows `notify('エクスポートしました')`. If `host.save` throws, `command()` catches it and shows `notify(err.message, true)` (the error style) instead.
  - The host is X1Pen's adapter `html/x1pen_x1basic_host.js`, published into the editor folder as `x1basic/src/x1pen-host.js` and loaded inside the iframe. Its `download(bytes, name)` builds a Blob URL **in the iframe**, appends `<a download>` to the iframe's body and clicks it; `save` returns `true` right after.
  - The iframe is created by `createHuBasicEditor` in `html/x1pen.js` without a `sandbox` attribute. `window.X1PenHuBasicEditorBridge` (same function) is what the adapter calls in the parent (`attach`, `contentChanged`, `fontRom`, `builtinFontBitmap`, `isLocked`, `run`, `focus`, `blur`).
  - `html/x1pen.html`'s CSP meta: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; … img-src 'self' blob: data:; connect-src 'self' blob:; worker-src blob:; object-src 'none'; base-uri 'none';` — no `frame-src`, so `default-src 'self'` applies.
- Why only Firefox: Firefox treats the download link clicked inside the iframe as loading `blob:` into that nested frame and checks it against the parent's `frame-src`; Chrome and Brave do not apply that check to downloads.
- Both fixes were tried in Firefox without changing files: A (CSP with `frame-src 'self' blob:`, by request interception) and B (a click inside the iframe that creates the Blob URL and `<a download>` in `window.parent.document`). Both downloaded `PROGRAM.BAS`.
- X1Pen's other downloads build the Blob URL and anchor in x1pen.html itself, e.g. FDD0 save (`html/x1pen.js`, `ec-fdd0-save`: `URL.createObjectURL(blob)`, `a.download = 'PROGRAM.d88'`, append, click, remove, revoke) and the disk editor's file extract (`html/disk_editor.js`).
- The Electron app (x1-basic-editor `main.cjs`) saves through `dialog.showSaveDialog`, and the editor does not start in a browser without a host, so this only concerns X1Pen.
- Tests: `tests/x1pen_automation_test.mjs` runs on Chromium (`launchChromium`, `X1PEN_BROWSER_EXECUTABLE`), with its own static server over `dist/` (the CSP is the meta tag, so it applies there too). The test "in X1Pen the HuBASIC editor imports and exports, and its side panel folds away" checks the button labels only, not that a download happens.

## Change scope

- `html/x1pen.js`, `X1PenHuBasicEditorBridge`: new `download(data, name)`.
  - Copies the bytes into this window (`Uint8Array.from`), builds the Blob URL and `<a download>` in x1pen.html's document, clicks it, removes the anchor, and revokes the URL after 10 s (the adapter's current delay; a short delay is safe for any browser that reads the Blob after the click returns).
  - `name` is the adapter's file name (`PROGRAM.BAS` or the imported file's name); an empty or non-string name falls back to `PROGRAM.BAS`.
  - It throws if the Blob URL or the anchor cannot be made; the error reaches the editor (below).
  - A comment says why the download is made here (Firefox checks a download link clicked in the iframe against this page's `frame-src`).
- `html/x1pen_x1basic_host.js`: `download()` calls `bridge.download(bytes, name)` instead of building the anchor in the iframe. `save` still returns `true` after it, and any exception propagates, so the editor shows the error in its error style and not "エクスポートしました". The header comment changes to say the parent page makes the file.
  - FDD0 save and the disk editor are not changed (they already download from x1pen.html).
- `tests/x1pen_automation_test.mjs`:
  - The existing import/export test also clicks "エクスポート" in Chromium and checks the download (`page.waitForEvent('download')`): suggested name `PROGRAM.BAS`, content is the program bytes (contains `10 PRINT "PANEL"`).
  - The same test checks failure: with `URL.createObjectURL` in x1pen.html replaced by a throwing stub, clicking "エクスポート" shows the editor's notice in the error style with the error text, and not "エクスポートしました"; the stub is restored in `finally`.
  - New test "in Firefox the HuBASIC editor's エクスポート downloads the program": launches Playwright's Firefox (`firefox` from `playwright`), opens x1pen.html from the same static server, sets a HuBASIC program, clicks "エクスポート" in the iframe and expects a download named `PROGRAM.BAS` with the program bytes. If Playwright's Firefox is not installed (`existsSync(firefox.executablePath())` is false) the test is skipped with the message `npx playwright install firefox`, so `npm test` still runs where only Chrome exists (`X1PEN_BROWSER_EXECUTABLE`).
  - A guard in the same Firefox test: no `securitypolicyviolation` / CSP console error is seen during the export.
- `README.md`: one sentence next to the `X1PEN_BROWSER_EXECUTABLE` note: the Firefox export test runs only when Playwright's Firefox is installed (`npx playwright install firefox`), otherwise it is skipped.
- `CHANGELOG.md` `## Unreleased`: one bullet (Firefox could not save the HuBASIC エクスポート; now the file is made by X1Pen's page; a failure shows an error instead of "エクスポートしました").
- `plans/`: this plan, archived into the PR.

## Implementation steps

1. Branch `fix/hubasic-export-firefox` from main `a8ee763` (done).
2. Add `bridge.download` and switch the adapter.
3. `./build.sh`; manual probe on the preview server with Firefox and Chrome (download event, file content, no CSP error), and the failure stub.
4. Add the tests and the README/CHANGELOG lines.
5. `./build.sh`, the full `npm test` (with Playwright's Firefox installed here, so the Firefox test runs), mutation checks, commit.
6. Implementation review (must pass), one PR. Do not merge.
7. Preview server on the PR head's `dist/`; report how to connect.

## Edge cases and test plan

- User activation: the click (or Ctrl+S, mapped by the adapter's keydown handler) happens in the iframe, and `bridge.download` runs synchronously in that handler. Activation in a same-origin child counts for its ancestors, so the parent's anchor click is allowed; checked in Firefox (fix B probe) and Chrome (new test). Ctrl+S is the same synchronous path and is not tested separately.
- Bytes from the iframe's realm: copied with `Uint8Array.from` in the parent before making the Blob, as the bridge already does in `contentChanged`.
- Interaction lock: export does not change the program, so it is allowed while automation holds the lock, as today (the adapter does not check the lock for save). Unchanged.
- What X1Pen cannot detect: after the anchor click, the page is not told whether the browser saved, the user cancelled Brave's dialog, or a browser policy blocked it silently. So "エクスポートしました" means "handed to the browser". Making it reflect the real outcome needs a different save mechanism (for example the File System Access API's save picker, Chromium only) or an editor change to its wording; that is the editor's (x1editor's) or ひろしさん's decision and is only reported.
- Brave's save dialog: not testable here (no Brave on dunedin). The download now starts from the top-level page, which is the way FDD0 save already works; the report says Brave was not checked.
- Firefox test availability: skipped with a clear message when Playwright's Firefox is missing. The plan does not make it mandatory, so ひろしさん's Mac `npm test` keeps working without the extra browser.
- Mutation checks:
  - reverting the adapter to the in-iframe anchor makes the Firefox test fail (no download, CSP error);
  - making `bridge.download` swallow errors makes the failure-path assertion fail.
- Rollback: revert the PR commit; only the bridge, the adapter, tests and docs change.

## Open decisions

- None blocking. The wording of "エクスポートしました" (handed to the browser vs. saved) is reported to Secretary for x1editor/ひろしさん; this PR does not change the editor.

## Implementation notes

- After the change, the probe on the preview server (Playwright Firefox and Chrome) downloads `PROGRAM.BAS` in both, with no CSP error in Firefox.
- The existing import/export test runs in the shared page after a test that imports `NEW.BAS`; the adapter keeps the last imported name for エクスポート (unchanged behaviour), so the Chromium download check accepts `PROGRAM.BAS` or `NEW.BAS`. The Firefox test uses a fresh page and checks `PROGRAM.BAS` exactly.
- That test also fails when run alone (its first assertion, before this change's lines, sees the editor's buttons before `host.js` has hidden them); it passes in the suite and after the preceding HuBASIC tab test. Not changed here.
- The failure path: with `URL.createObjectURL` in x1pen.html throwing, the editor shows "export probe: no file" in the error style, and not "エクスポートしました".
- Full `npm test` (Playwright Firefox installed): passed (MCP 111, automation 70 including the Firefox test).
- Mutation checks (on `dist/` copies, restored afterwards):
  - the adapter building the anchor inside the iframe again: the Firefox test fails (no download);
  - `bridge.download` swallowing its errors: the import/export test fails (no error notice).
- Brave was not checked (not installed on dunedin).
- README had mixed CRLF/LF line endings; the new sentence keeps the surrounding CRLF.

## Cross-review反映

### Round 1 — codex / gpt-6-astra/high
- Verdict: APPROVED (model=APPROVED; policy=strict; host_override=no)
- Implementation: READY (next_action=implement; reviewer=READY)
- No findings.

# X1Pen HuBASIC Share: share HuBASIC programs (X1 bytes) with their conversion options

## Purpose

Today Share refuses HuBASIC programs ("HuBASIC programs cannot be shared yet"). Make them shareable, together with the conversion options (PR #137's one global set). Without the options, a program converted with `wait: line:450` would run at a different speed for the person who opens the link.

Rules from the owner (via Secretary):
- Opening a share never changes the viewer's own saved settings (options, model) or saved program: it uses the shared ones for that tab only.
- New payload fields are optional, read as "absent = default", so existing share URLs keep working unchanged.
- The server (`functions/api/share*`) should stay as it is if possible. If it must change, report why.
- The X1 bytes are the program (unchanged rule since PR #136): the share must give back exactly the bytes the sender had.
- Share is an outward-facing path: nobody's program may get mixed with another, lost, or become unreadable.

Non-goals: MCP and the `hubasic.options` feature name (next project); OG tags / screenshot handling (unchanged); sharing the resolution or other machine settings (no share carries them today); any production deploy.

## Observed evidence

### Server (Cloudflare Pages Functions, deployed together with the static files)
- `functions/api/share.js` `onRequestPost`:
  1. Takes a gzip blob (multipart `data`, or a legacy octet-stream body), at most 1 MiB compressed and 512 KiB decompressed.
  2. Parses it as JSON, then requires one non-empty string among `basic`, `asm`, `slang`; otherwise **400 "No code"**.
  3. Stores the compressed blob unchanged in D1 (`shares.data`) and returns `{ id }`.
- `functions/api/share/[id].js` returns the stored blob with `X-X1pen-Codec: gzip`.
- `functions/x1pen.js` only reads `screenshot_key` for OG tags.
- **Consequence**: a HuBASIC-only payload (no basic/asm/slang) is rejected with 400. The server must also accept the HuBASIC field. This is a one-line condition change; nothing else on the server reads the payload.
- There are no tests for `functions/api/share.js` today.

### Client (`html/x1pen.js`)
- `onShareClick()`:
  - Returns early with "HuBASIC programs cannot be shared yet" when the HuBASIC editor has text.
  - Otherwise builds `{ basic, asm, slang, meta: { model, coldState, bootDisk, runMode, sourceMode, relocAddrs? } }`.
  - It hashes that payload string (`computePayloadHash`) and reuses `lastShareId` when the hash equals `lastShareHash`.
  - It gzips the payload, adds a screenshot, POSTs to `/api/share`, then shows `location.origin + '/x1pen?id=' + id`.
  - Media check: `inspectShareMediaState()` refuses when any slot holds saved media. X1Pen's temporary disk `__x1pen_temp__` (what a HuBASIC Run puts into FDD0) is allowed.
- Share load (`__x1pen_onModuleReady`, `?id=`):
  - Fetches `/api/share/<id>` and gunzips it when the header says gzip (else reads JSON).
  - Sets the basic/asm/slang editors (`shared.x || ''`) and calls `markProgramChanged()`.
  - From `meta` it builds `pendingShareRuntime = { model, coldState, bootDisk, relocAddrs, sourceMode }` and normalises it for the run mode.
  - Builds a "replay" payload the same way as `onShareClick` and stores its hash as `lastShareHash` / `lastShareId` (so re-sharing an unchanged program reuses the URL).
  - Then calls `onRunClick('share')`. Errors show "Shared code load failed"; 404 "Shared code not found"; 400 "Invalid share ID".
- Share sessions:
  - `?id=` makes `isEphemeralShareSession` true for the whole page life.
  - Saved sources are neither restored nor written (`persistEditorSources` / `persistEditorSource` return early).
  - Since PR #137, HuBASIC options are read from storage but not written.
- `performRun(token)` decides `sourceMode` from `pendingShareRuntime.sourceMode` if set, else `inferSourceMode(...)` (HuBASIC first).
  - The HuBASIC branch returns `performHuBasicRun(bytes, options)` **before** the code that clears `pendingShareRuntime`. Today that cannot happen in a share session (no HuBASIC share exists).
  - The other branches use `baseRuntime = pendingShareRuntime || getUserDefaultRuntime(); pendingShareRuntime = null;` and record `lastUsedRuntime`, `lastRunWasShared = isSharedRun` (= `isEphemeralShareSession`).
- `performHuBasicRun(source, options)` uses `model = getUserDefaultRuntime().model` (the user's MODEL setting).
  - It cold-boots with `XmilControls.coldPowerOn(model, …)`, which sets the ROM type in the emulator only (it does not save settings, `html/pre.js` ~line 1223).
  - It then sets `lastUsedRuntime = { model: machine.model, …, runMode: 'x1native' }`, `lastRunWasShared = false`.
- `onShareClick` picks the runtime for meta in this order: `pendingShareRuntime`, then `lastUsedRuntime` if `lastRunWasShared`, else `getUserDefaultRuntime()`.
- HuBASIC program state (`createHuBasicEditor`): X1 bytes held in the parent page; `getBytes()` / `setBytes(bytes, { silent })`; text form `X1PenHuBasicText.toText/fromText`.
  - The text form round-trips every byte except that lone CR / lone LF / CRLF all become `\n` and come back as CRLF. So text is **not** an exact carrier of the bytes.
- HuBASIC options (`html/x1pen.js`, PR #137):
  - `hubasicOptions`, changed through `updateHuBasicOptions(patch)`, which validates, saves except in share sessions, and re-renders the panel.
  - `X1PenHuBasicOptions.changed(options)` gives only the non-default keys.
  - `X1PenHuBasicOptions.fromStored(value)` reads any value field by field and never throws.

### Tests
- `tests/x1pen_automation_test.mjs`:
  - `installShareRoute(context, id, payload)` serves a share as plain JSON.
  - Existing tests capture the POST to `**/api/share`, e.g. "Share refuses persistent media…", "Share runs isolate…".
  - `assertEphemeralShareDocument` checks the share-mode markers.
  - "Share refuses HuBASIC programs" asserts today's refusal; it gets replaced.
  - `snapshotX1PenPersistence(page)` snapshots localStorage/IndexedDB state for "saved state unchanged" checks.

## Design

### Payload (format version unchanged; new fields optional)
A HuBASIC share is:
```json
{ "basic": null, "asm": null, "slang": null,
  "hubasicX1": "<base64 of the exact X1 bytes>",
  "meta": { "model": 1, "runMode": "x1native", "sourceMode": "hubasic",
            "hubasicOptions": { "wait": "line:450" } } }
```
- **`hubasicX1`**: standard base64 (RFC 4648, with padding) of the editor's X1 bytes, exactly as `hubasicEditor.getBytes()` returns them. Base64 rather than the text form, because the text form normalises lone CR/LF; the share must give back the sender's bytes byte for byte.
- **`meta.hubasicOptions`**: `X1PenHuBasicOptions.changed(options)`, i.e. only non-default values. Omitted when all are defaults. Absent means all defaults.
- **`meta.model`**: the model the program is run on (rule below). No `coldState` / `bootDisk` / `relocAddrs` (a HuBASIC Run does not use them).
- Non-HuBASIC shares are built exactly as today (byte-identical payloads, so their hashes and URL reuse do not change).

### Server: `functions/api/share.js`
- Accept a payload whose only code is `hubasicX1`: `hasHubasic = typeof parsed.hubasicX1 === 'string' && parsed.hubasicX1.length > 0`, added to the "No code" condition.
- Also reject a payload that is not a JSON object (`null`, array, number) with 400 "No code" instead of throwing.
  - Today `parsed.basic` on `null` throws → 500. This is a one-line hardening of the condition being edited.
- Nothing else changes: the blob is stored and served as before. Deploy note for the owner: the server and the page must ship together, which Cloudflare Pages does in one deployment.

### Client: sharing (`onShareClick`)
- If the HuBASIC editor has text (trimmed, as `inferSourceMode` decides), build a HuBASIC share. The order of checks stays the same: `Nothing to share`, then the media check.
  - Bytes: `hubasicEditor.getBytes()` → base64.
  - Options: `changed(hubasicOptions)` (the options the next Run would use).
  - Model: `pendingShareRuntime.model` if a shared program has not been run yet in this tab; else `lastUsedRuntime.model` if `lastRunWasShared` and the last run was a HuBASIC run (`runMode === 'x1native'`); else `getUserDefaultRuntime().model`. This mirrors the existing runtime choice.
  - Same hash → same URL reuse, same gzip/POST/screenshot path as today. The payload builder is one function (`buildHuBasicSharePayload(bytes, options, model)`) used for sharing and for the replay hash on load.
- Other modes: unchanged.

### Client: opening a share (`?id=`)
- Decide the mode: `meta.sourceMode === 'hubasic'`, or no `meta.sourceMode` but a `hubasicX1` field present.
- For a HuBASIC share, **decode and validate everything first; change nothing until all checks pass**:
  - `hubasicX1` must be a non-empty string matching `^[A-Za-z0-9+/]*={0,2}$` with length % 4 == 0, decoding to ≥ 1 byte.
  - Options: `X1PenHuBasicOptions.fromStored(meta.hubasicOptions)`. Absent → defaults; unknown or invalid fields fall back to their defaults (a newer sender's extra option must not break the link).
  - Model: `validateModel(meta.model, 1)` (the existing validator).
  - On a decode failure: status "Shared HuBASIC program could not be read", no Run, editors left empty (the share tab started empty).
- Then:
  - Set the basic/asm/slang editors to `''`.
  - `hubasicEditor.setBytes(bytes, { silent: true })`, `markProgramChanged()`.
  - Apply the options for this tab: `updateHuBasicOptions(fullOptions)` — in a share session it is not saved, which already holds since #137.
  - `pendingShareRuntime = { model, coldState: null, bootDisk: null, relocAddrs: null, sourceMode: 'hubasic', runMode: 'x1native' }`.
  - Replay hash: `buildHuBasicSharePayload(bytes, options, model)`.
  - Show the HuBASIC tab, then `onRunClick('share')` as today.
- For a share that is not HuBASIC: unchanged. The tab's HuBASIC options stay as since #137 (the saved ones; they are not used unless the viewer writes a HuBASIC program).

### Client: running a shared HuBASIC program
- In `performRun`'s HuBASIC branch:
  - take `model = pendingShareRuntime ? pendingShareRuntime.model : getUserDefaultRuntime().model`;
  - clear `pendingShareRuntime`, like the other branches do. That also fixes the "sourceMode stays forced" case;
  - pass the model to `performHuBasicRun(bytes, options, model)`.
- `performHuBasicRun` uses the given model and records `lastRunWasShared = isEphemeralShareSession`, like the other branches (it is `false` today).
- Later Runs in the share tab use the viewer's MODEL setting, as for the other modes. The options stay the shared ones for the tab's life, because they replaced the tab's options.

### Docs
- `docs/X1PEN.md`:
  - Share section: HuBASIC shares carry the program bytes, the options and the model.
  - The HuBASIC notes: remove "cannot be shared"; the options paragraph says Share carries them.
  - 注意事項.
- `CHANGELOG.md`.

## Change scope
- `functions/api/share.js`: the "No code" condition (accept `hubasicX1`; non-object JSON → 400).
- `html/x1pen.js`:
  - base64 helpers;
  - `buildHuBasicSharePayload`;
  - `onShareClick` HuBASIC branch;
  - share-load HuBASIC branch;
  - `performRun` HuBASIC branch;
  - `performHuBasicRun(source, options, model)`.
- `tests/share_api_test.mjs` (new, Node: calls `onRequestPost` with an in-memory D1 stub, no R2) and a `test:share` script in `package.json`, added to `npm test`.
- `tests/x1pen_automation_test.mjs`: replace "Share refuses HuBASIC programs"; add the round-trip, isolation and frozen-link tests below.
- `docs/X1PEN.md`, `CHANGELOG.md`.

## Implementation steps
1. Archive the options plan (done: `plans/20261027-hubasic-options.md`), write this plan, design review.
2. Server condition + `tests/share_api_test.mjs`.
3. Client: payload builder and base64; Share click; Share load; Run model; docs.
4. E2E tests, full `npm test`, rebuild `dist` for the preview server.
5. Optional end-to-end smoke against `wrangler pages dev` with a local D1, if it runs without new tools (it is in node_modules; local only, `--compatibility-date=2026-08-01`, `WRANGLER_SEND_METRICS=false`).
6. Implementation review, one PR.

## Edge cases and test plan

Server (`tests/share_api_test.mjs`):
- A HuBASIC-only payload → 200 and the stored blob equals the posted bytes.
- `basic` / `asm` / `slang` payloads are still accepted.
- No code (all empty, `hubasicX1: ''`, `hubasicX1: 5`) → 400 "No code".
- JSON `null` / `[]` / `42` → 400, not 500.
- Bad gzip → 400.

Client E2E (Chrome; POST captured with `context.route('**/api/share')`, served back with `installShareRoute`):
1. **Exact bytes round trip**:
   - The program contains $5C, kana, graphic symbols, `$00`, `$FF`, a lone CR and a lone LF inside a line, and CRLF.
   - Share captures the payload: `hubasicX1` decodes to exactly `getBytes()`; `sourceMode: 'hubasic'`; no basic/asm/slang code.
   - Opening it in a new page gives byte-identical `getBytes()` in the share tab, and the Run boots (`run.sourceMode === 'hubasic'`, text VRAM shows the output).
2. **Options travel, the viewer's do not change**:
   - The sender sets `wait: 'line:450', noLineNumbers: true`; the payload has exactly those in `meta.hubasicOptions`.
   - The viewer has its own saved options (e.g. `stringLen: 80`). In the share tab:
     - `getHuBasicOptions()` equals the shared set (`stringLen` back at 255, not 80);
     - the recorded build options are the shared ones;
     - the viewer's localStorage value is unchanged afterwards, even after changing options in the share tab.
3. **Absent = default**:
   - A HuBASIC share without `meta.hubasicOptions` runs with all defaults, even though the viewer's saved options are not defaults.
   - Unknown or invalid option fields fall back to defaults.
4. **Old shares unchanged**:
   - Existing share tests keep passing; a BASIC share payload built by the new code is byte-identical to the old one (same keys and order).
   - Opening a legacy BASIC/SLANG share leaves the HuBASIC editor empty and the options as saved.
5. **Model**:
   - The share's `meta.model` is the sender's MODEL setting; the share tab's first Run boots that model.
   - The viewer's saved settings (`xmil_settings`) are unchanged.
6. **Bad data**: `hubasicX1` not base64 / empty → status "Shared HuBASIC program could not be read", no Run, empty HuBASIC editor, nothing saved.
7. **Re-share without changes** in the share tab reuses the same ID (no POST); after an edit it POSTs a new one.
8. **Saved state isolation**: with the owner's saved program and options in the same browser profile, opening a HuBASIC share, editing and running there leaves `snapshotX1PenPersistence` unchanged.
9. **Refusals stay**: "Nothing to share" for an empty program; a saved disk in a slot still refuses Share; X1Pen's temporary FDD0 disk (after a HuBASIC Run) does not.
10. `pendingShareRuntime` is cleared by a HuBASIC Run: after the share Run, clearing the HuBASIC program and writing BASIC runs BASIC (no forced `hubasic` source mode).

11. **Frozen link** (rollback compatibility): a HuBASIC share payload written out literally in the test file, standing for a link created before any later change.
    - It is served with `installShareRoute` and must open with exact bytes, options and model, and run.
    - It does not go through the share-creation code, so it keeps passing when creating HuBASIC shares is switched off. The test file says it must not be updated to follow a format change.

Rollback (links that exist must stay readable):
- Never revert the reader.
- To stop new HuBASIC shares, restore only the refusal at the top of `onShareClick` ("HuBASIC programs cannot be shared yet"). Keep:
  - the share-load HuBASIC branch, the base64 decoding and the options and model handling;
  - the `performRun` / `performHuBasicRun` changes;
  - the server condition.
- The reader and the creator are separate code blocks, so this is a one-block change. Test 11 checks that existing links still open after it.
- Other shares are unaffected either way.

## Open decisions
- The field is `hubasicX1` (base64 of the bytes) rather than the readable text form, for exactness (proposed).
- Later Runs in a share tab use the viewer's MODEL setting (same as the other modes); the shared options stay for the tab (proposed).
- Hardening the server's "No code" check for non-object JSON (proposed; it is in the line being edited).

## Cross-review反映

### Round 1 — codex / gpt-6-astra/high
- Verdict: NEEDS_WORK (model=NEEDS_WORK; policy=strict; host_override=no)
- Implementation: READY AFTER FIXES (R1-F1) (next_action=fix_then_implement; reviewer=READY_AFTER_FIXES)
- [adopted][high] Rollback that reverts the reader would make existing HuBASIC links unreadable → "Edge cases and test plan": the rollback now restores only the creation refusal and keeps reading, running, options, model and the server condition; added test 11, a frozen hand-written HuBASIC payload that must keep opening.

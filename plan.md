# X1Pen HuBASIC tab: conversion options (one global setting) and an automation API for them

## Purpose

hubasic2sl (the HuBASIC → SLANG converter X1Pen runs as .NET browser-wasm) has options that change the generated program: per-line wait, no line-number bookkeeping, integer default type, string length limit, static data budget. X1Pen passes none of them today; the owner wants to set them.

Goals:
1. A place in the HuBASIC tab (X1Pen side, not inside the X1 BASIC Editor iframe) to set five options: `wait` (none / line:N / frame:N), `noLineNumbers`, `assumeDefint`, `stringLen`, `dataBudget`.
   - **One global setting** (not per program), remembered in localStorage.
   - The wait setting must make clear that `'#VSYNC n` directive comments only work with the frame mode.
   - **Untouched settings give exactly today's behaviour**.
2. `X1PenAutomation.getHuBasicOptions()` / `setHuBasicOptions()`, separate from `getProgram` (the MCP server checks `getProgram`'s result strictly, so it must not change).

Non-goals (decided by the owner; order is API → Share → MCP, each with its own project):
- Share URL: HuBASIC programs cannot be shared yet (`onShareClick` stops with "HuBASIC programs cannot be shared yet"); options go into Share together with HuBASIC Share.
- MCP / the Chrome extension bridge: x1pen-mcp 2.7 does not know the hubasic source mode yet; npm releases are the owner's.
- `emitLineComments`: only adds comments to the generated SLANG, which X1Pen never shows.
- CLI-only options (`--env`, `--emit`, `--disk-main-name`, `--tape-name`, `--wav`, `--check-bin`, `--lst`, `--slangbuild`) and `inputEncoding` (X1Pen always passes `x1` because the tab holds X1 bytes).
- No change to the SLANG-compiler bundle (`assets/hubasic/5abbffaa…`), the wasm, or the editor copy (`assets/x1basic`).

## Observed evidence

- `html/x1pen_hubasic.js` `build(source)` (line ~157) calls
  `state.api.Transpile(bytes, SOURCE_NAME, JSON.stringify({ inputEncoding: x1 ? 'x1' : 'utf8' }))`. `build` is called from `html/x1pen.js` in two places: `performHuBasicRun(source)` (Run, also automation `run`) and `validateHuBasicProgram` (automation `validate`). The success result contains `sl` (generated SLANG); failures carry `stage` and `diagnostics`.
- `window.X1PenHuBasic` is a plain (not frozen) object `{ load, build, info, _checkManifest, _checkBasAbi }`.
- The wasm entry `HuWebApi.ParseOptions` (SLANG-compiler 5abbffaa, `src/SLANGCompiler.HuBasic/Web/HuWebApi.cs`) accepts a JSON object with keys `inputEncoding`, `wait` (string `none` / `line[:N]` / `frame[:N]`; N unreadable or ≤0 → 1), `stringLen` (int 1..255), `dataBudget` (int > 0), `noLineNumbers`, `assumeDefint`, `emitLineComments` (booleans). Unknown keys and wrong types are errors.
- Defaults (`HuTranspileOptions`): Wait=None, WaitArg=1, LineNumbers=true, AssumeDefint=false, StringLen=255 (`HuAnalyzer.MaxStringLen`), DataBudget=24576 (`HuAnalyzer.DefaultDataBudget`).
- Meaning (CLI usage text and `HuLowerer`):
  - `line:N`: `BAS_WLINE(N)` at the head of every line, N × ≈0.1 ms (N=450..500 ≈ Hu-BASIC speed).
  - `frame:N`: `'#VSYNC n` directive comments call `BAS_VSYNC(n or N)`; without frame mode those comments do nothing. The `VSYNC [n]` statement always waits.
  - `noLineNumbers`: no `CurrentLine` bookkeeping (`BAS_LNINIT` / hidden assignments), so the program is smaller and faster but runtime errors show no line number.
  - `assumeDefint`: variables with no suffix and no DEFxxx become integers (Hu-BASIC default is single float).
  - `stringLen`: maximum length of one string; smaller string variables/arrays, `String too long` past it.
  - `dataBudget`: limit of static data bytes; exceeding it is a transpile error.
- The runtime wait routines take N in HL (16 bit): `BAS_WLINE`, `BAS_VSYNC` → `BAS_WAITF` in `runtime/libx1_basic.asm`. An N above 65535 would wrap, so X1Pen limits N to 1..65535.
- `html/x1pen.html`: `#editor-tabs` holds the tab buttons and per-tab `.editor-tab-action` buttons (`#btn-asm-import`, `#btn-slang-import`, `#btn-basic-manual`), shown and hidden by `setActiveEditorTab(target)` in `html/x1pen.js` (~line 4092).
- While automation holds the interaction lock, `#editor-panel` becomes inert, so anything inside the tab bar is locked with it.
- Ephemeral share sessions (`isEphemeralShareSession`) skip localStorage writes (`persistEditorSources` returns early) and do not restore saved sources.
- `X1PenAutomation` (`html/x1pen.js` ~line 3027) is a frozen object.
  - `setProgram` and `validate` reject with `createRunPendingError` while `isRunSetupPending()` and are serialised with `queueAutomationOperation`.
  - `getStatus().x1pen.features` comes from `getAutomationFeatures()`; `tests/x1pen_automation_test.mjs:237` asserts the exact list.
  - The MCP compatibility layer (`mcp/x1pen-compatibility.mjs` `normalizeFeatureList`) keeps unknown feature strings, so adding one is harmless to 2.7.
- `html/x1pen.html` loads the small helper `x1pen_hubasic_text.js` before `x1pen-version.js`; a test requires `x1pen-version.js` to be directly followed by `x1pen.js`.
- `tests/x1basic_editor_test.mjs` already loads helpers in a `vm` context (codec.js, x1pen_hubasic_text.js) for unit tests.

## Change scope

- **New `html/x1pen_hubasic_options.js`** (`window.X1PenHuBasicOptions`): pure functions, no DOM.
  - `DEFAULTS` (frozen): `{ wait: 'none', noLineNumbers: false, assumeDefint: false, stringLen: 255, dataBudget: 24576 }`.
  - `parseWait(value)` → `{ mode, count }` or throws; `formatWait(mode, count)` → `'none'` / `'line:N'` / `'frame:N'`.
  - `apply(current, patch)` → a new full options object, or throws `TypeError` naming the key.
    - Strict validation: unknown key; wrong type; `wait` not `none` / `line[:N]` / `frame[:N]` with integer N 1..65535 (`line` alone = `line:1`, as the CLI); `stringLen` integer 1..255; `dataBudget` integer 1..65535.
    - A `null` value resets that key to the default. Atomic: nothing changes when any key is invalid.
    - The result is normalised (`wait` always has an explicit N unless `none`).
  - `fromStored(json)` → full options. Invalid or unknown stored fields fall back to defaults one by one, never throws.
  - `toTranspile(options)` → only the keys whose value differs from `DEFAULTS`, in the wasm key names. With all defaults this is `{}`.
  - `isDefault(options)`.
- **`html/x1pen_hubasic.js`**: `build(source, options)` merges `toTranspile`-style extra keys (a plain object, may be absent) into the Transpile options JSON: `Object.assign({ inputEncoding: … }, options || {})`. With no options, the JSON string is byte-identical to today's.
- **`html/x1pen.js`**:
  - State: `hubasicOptions` (full object), localStorage key `LS_HUBASIC_OPTIONS = 'x1pen_hubasic_options'` storing `{ version: 1, options: {...non-default keys...} }`.
  - Loaded at start, also in share sessions (a preference, not program content). Saved on every change except in ephemeral share sessions (changes there last for the tab only, like other edits).
  - `setHuBasicOptionsInternal(patch)` → apply, store, re-render the panel, return a copy.
  - `performHuBasicRun` and `validateHuBasicProgram` call `build(bytes, X1PenHuBasicOptions.toTranspile(hubasicOptions))`, so Run, automation `run` and automation `validate` all use the current options.
  - Automation: `getHuBasicOptions()` (synchronous, returns a fresh copy) and `setHuBasicOptions(patch)` (a Promise).
    - Rejects with `createRunPendingError` while a Run is being set up, like `setProgram`; serialised through `queueAutomationOperation`; invalid input rejects with the `TypeError`.
    - Allowed while the interaction lock is held (that lock is automation's own).
    - Does not touch `revision` / `revisionEpoch` (options are not program content).
  - No new feature string: `tests/x1pen_extension_bridge_test.mjs` requires X1Pen, the Connector and MCP to advertise the same feature IDs, so one is added with the MCP work. Callers detect the methods with `typeof X1PenAutomation.setHuBasicOptions === 'function'`.
  - UI wiring for the panel below.
- **`html/x1pen.html`**:
  - An `Options` `.editor-tab-action` button (`#btn-hubasic-options`), shown only on the HuBASIC tab via `setActiveEditorTab`. It shows a marker (`Options •`, plus `aria-label` text) when any option differs from its default, so a user can tell a global setting is active.
  - A non-modal panel `#hubasic-options-panel` (absolute, under the tab bar, right-aligned, max-width that fits at phone width with 16 px gutters). It closes on the button, Escape inside the panel, or a click outside.
  - Panel contents (Japanese, like the editor and hubasic2sl's own help):
    - 速度 (wait): a select なし / 行ごとに待つ / `'#VSYNC` コメントで待つ, plus a number N enabled for the latter two. Help text per mode:
      - line: 「各行の頭で N × 約 0.1 ms 待ちます（450〜500 で Hu-BASIC に近い速さ）」
      - frame: 「`'#VSYNC n` のコメントの所で n フレーム待ちます（n が無いときは N）」
      - always shown: 「`'#VSYNC` コメントはこのモードのときだけ効きます。`VSYNC` 文はいつも効きます」
    - 行番号を記録しない (noLineNumbers), with 「小さく速くなります。実行時エラーに行番号が出ません」.
    - 型の無い変数を整数にする (assumeDefint).
    - 文字列の長さの上限 (stringLen, 1〜255).
    - 静的データの上限 (dataBudget, bytes).
    - 「既定に戻す」.
    - A line saying the settings apply to every HuBASIC program and take effect on the next RUN.
  - Number fields commit on `change`. An invalid value is marked (`aria-invalid`) and not applied.
  - Load `x1pen_hubasic_options.js` next to `x1pen_hubasic_text.js` (before `x1pen-version.js`).
- **`build.sh`**: copy `x1pen_hubasic_options.js` like `x1pen_hubasic_text.js`.
- **Docs**: `docs/X1PEN.md` (HuBASIC section: the options and the wait/VSYNC rule; automation section: the two methods and the feature string; note that Share and MCP do not carry them yet), `CHANGELOG.md`.
- **Tests** (see below): unit tests in `tests/hubasic_toolchain_test.mjs` (already run by `npm run test:hubasic`), E2E in `tests/x1pen_automation_test.mjs`. No `package.json` change.

## Implementation steps

1. Archive the finished X1 BASIC Editor plan (done: `plans/20261027-x1-basic-editor.md`).
2. Write `html/x1pen_hubasic_options.js` and its unit tests (vm context).
3. Extend `build(source, options)` in `html/x1pen_hubasic.js`.
4. `html/x1pen.js`: state, storage, the two build call sites, automation methods, feature string.
5. `html/x1pen.html` + `build.sh`: script tag, button, panel, CSS; UI wiring in `x1pen.js`.
6. E2E tests in `tests/x1pen_automation_test.mjs`; update the expected feature list.
7. Docs, CHANGELOG. Build, full `npm test`, refresh the preview server (127.0.0.1:8000) with the new dist.
8. Implementation review (secretary review, codex), then one PR.

## Edge cases and test plan

Unit (`tests/hubasic_toolchain_test.mjs`, vm context loading `html/x1pen_hubasic_options.js`):
- `toTranspile(DEFAULTS)` is `{}`; `isDefault(DEFAULTS)`.
- `apply` happy paths:
  - `line` → `line:1`, `line:450`, `frame:2`, `none`;
  - boundaries 1 and 65535 for N, 1/255 for `stringLen`, 1/65535 for `dataBudget`;
  - `null` resets one key.
- `apply` rejects, leaving `current` unchanged:
  - `line:0`, `line:65536`, `line:x`, `line:1:2`, `wait: 5`;
  - `stringLen` 0 / 256 / 1.5 / '10';
  - `dataBudget` 0 / 65536;
  - booleans given as strings;
  - an unknown key.
- `fromStored`: garbage JSON, non-object, a mix of valid and invalid fields → valid ones kept, others default.
- `toTranspile` of a changed set gives exactly the wasm key names and values.

The real wasm is exercised only in the browser E2E below (the node toolchain test does not start .NET, and this change does not add that).

E2E (`tests/x1pen_automation_test.mjs`, Chrome):
- Default: wrap `window.X1PenHuBasic.build` to record its second argument.
  - Automation `validate` of a HuBASIC program passes `{}`, which is the exact Transpile JSON `{"inputEncoding":"x1"}`.
  - Its generated `sl` contains `BAS_LNINIT` and no `BAS_WLINE`.
- `setHuBasicOptions({ wait: 'line:450', noLineNumbers: true })` → resolved value is the full object.
  - The next `validate` records `{ wait: 'line:450', noLineNumbers: true }`.
  - The SL contains `BAS_WLINE` and no `BAS_LNINIT`.
- `frame:3` with a program containing `'#VSYNC` → SL calls `BAS_VSYNC`; with `none` it does not.
- `dataBudget: 1` → `validate` reports the budget error; `setHuBasicOptions({ dataBudget: null })` → ok again.
- Invalid input rejects with a `TypeError` and `getHuBasicOptions()` is unchanged.
- During Run setup, `setHuBasicOptions` rejects with the run-pending error.
- `getProgram()` has the same keys as before (no options); `revision` is unchanged by `setHuBasicOptions`.
- Persistence: set options, reload the page → `getHuBasicOptions()` returns them.
  - With a corrupt stored value → defaults.
  - In a share session (`?id=` with the `**/api/share/<id>` route stub the existing share tests use, `tests/x1pen_automation_test.mjs` ~line 131), saved options are read and changes are not written to localStorage.
- UI:
  - The Options button is visible only on the HuBASIC tab.
  - Opening the panel shows current values; changing the select/checkbox/number updates `getHuBasicOptions()` and storage.
  - The `'#VSYNC` note is visible; an invalid number is marked and not applied.
  - The button marker appears only with non-default options; Escape and an outside click close the panel.
  - An automation `setHuBasicOptions` while the panel is open updates its controls.
  - The panel is inert under the interaction lock.
- Run uses the options: with `line:…`, Run succeeds (program still boots), checked via the recorded build argument.
- The feature list is unchanged (the existing exact-list assertions still pass).

Rollback: the change is additive; removing the button and passing no options restores today's behaviour. Stored `x1pen_hubasic_options` is ignored by older builds.

## Open decisions

- Share sessions read the saved options and do not save changes (proposed). When HuBASIC Share comes, the shared options will override for that tab only.
- Panel language: Japanese contents with an English `Options` button label, matching the neighbouring English tab actions (`Import`, `Manual`, `Charmap`) and the Japanese hubasic2sl help (proposed).
- `dataBudget` UI/API upper bound 65535 (the wasm has none; larger values are meaningless on a 64 KiB machine) (proposed).

## Cross-review反映

### Round 1 — codex / gpt-6-astra/high
- Verdict: APPROVED (model=APPROVED; policy=strict; host_override=no)
- Implementation: READY (next_action=implement; reviewer=READY)
- No findings.

### Implementation note
- Dropped the planned `hubasic.options` feature string: `tests/x1pen_extension_bridge_test.mjs` ("feature IDs match across X1Pen, Connector and MCP") requires one shared feature list, so adding it would change the Connector and MCP, which are out of scope. It comes with the MCP work.

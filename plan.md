# x1pen-mcp: HuBASIC programs and HuBASIC conversion options

## Purpose

X1Pen's HuBASIC tab (X1 BASIC Editor, `sourceMode: 'hubasic'`) and its global hubasic2sl conversion options (PR #137) are not reachable from MCP. x1pen-mcp 2.7.x does not know the mode at all: while X1Pen's current source is HuBASIC, every source tool fails with `X1Pen returned an invalid source mode: hubasic`, and it cannot even switch the tab back to another mode (every write pre-reads the program).

Goals:
1. x1pen-mcp reads, searches, diffs, edits and replaces HuBASIC programs like the other modes (`hubasic` becomes a fourth source section). This fixes the 2.7.x stop (it is the same change).
2. Two MCP tools read and change the conversion options (`getHuBasicOptions` / `setHuBasicOptions` of the page), behind a new feature `hubasic.options` advertised by X1Pen, X1Pen Connector and x1pen-mcp (the three feature lists must stay equal: `tests/x1pen_extension_bridge_test.mjs`).
3. Mixed versions stay safe and are tested, including the published MCP 2.7.0 against the new page.

Non-goals: version bumps and publishing (npm, Chrome Web Store, Pages deploy are the owner's; the PR only states what each release carries); a bundled HuBASIC language reference for `x1pen_search_reference` (separate follow-up: it needs curated entries from SLANG-compiler docs/HUBASIC.md); options inside `getProgram` (see Decisions); keeping caret/undo on external replacement (needs an X1 BASIC Editor API, later).

## Observed evidence

- X1Pen page (`html/x1pen.js`):
  - `getAutomationProgram()` returns `{basic, asm, slang, hubasic, sourceMode, revision, revisionEpoch, instanceId}`; `hubasic` is the editor's text form (`X1PenHuBasicText`: `\n` lines, $5C as `¥`, `\{name}` / `\xHH` escapes). `inferSourceMode` returns `'hubasic'` whenever the HuBASIC text is non-empty, so in the other modes `hubasic` is `''`.
  - `normalizeAutomationProgram` already accepts `sourceMode: 'hubasic'` (requires non-empty hubasic, checks `fromText`, clears the other sections; other modes clear hubasic). Unknown keys are ignored.
  - `getHuBasicOptions()` returns the full options `{wait, noLineNumbers, assumeDefint, stringLen, dataBudget}`; `setHuBasicOptions(patch)` (queued, rejects `RUN_PENDING` during run setup; null resets a key; TypeError on unknown key/bad value) returns the full options. Validation in `html/x1pen_hubasic_options.js` (`wait` none|line[:N]|frame[:N], N 1..65535; `stringLen` 1..255; `dataBudget` 1..65535).
  - `getAutomationFeatures()` = `automation.core, automation.run-recovery, automation.source-sync, screen.capture` + conditional `input.keyboard, input.pad, debugger.cpu, debugger.vram`.
  - validate/run already handle hubasic (`validateHuBasicProgram`, HuBASIC Run).
- Connector (`extension/page-automation.mjs` `invokeX1PenInPage`): forwards `getProgram` / `setProgram` payloads unchanged (setProgram gets `transport.requireRevisionEpoch` from `service-worker.js`); any other method name not listed throws `Unsupported X1Pen method`. `extension/compatibility.mjs` `CONNECTOR_FEATURES` = the 8 features; manifest version 1.3.0.
- MCP (`mcp/`):
  - `x1pen-server.mjs`: `SOURCE_SECTIONS = ['basic','asm','slang']`; `normalizeProgramSnapshot` rejects any other sourceMode and throws `SOURCE_CONTENT_UNAVAILABLE` when a section field is absent ("an absent source field is not treated as empty source"); `assertEditableSection` per mode; `x1pen_set_program` / `x1pen_diff_source` use `z.enum(['basic+asm','asm','slang'])`; `x1pen_get_program` `fields` max 3; writes pre-read via `assertWriteBaseline` and `assertApplySnapshotUnchanged`; `apply_edits` / `set_source_file` send `{sourceMode, basic, asm, slang, [section]: new}`.
  - `x1pen-source-sync.mjs`: `AUTHORING_SECTIONS` per mode; `authoringHash` hashes mode + authoring sections only (so adding a section does not change the existing modes' hashes); `sourceIdentities` / `SourceBaselineCache.rememberSnapshot` iterate the three sections.
  - `x1pen-compatibility.mjs`: `FEATURE_IDS` (8), `METHOD_FEATURES` (every bridge method must be mapped, else `METHOD_FEATURE_UNMAPPED`), `CONNECTOR_MINIMUMS` (only used for `requiredVersion` in messages), `evaluateCompatibility` (a feature is available only if all three advertise it; a component that advertises a list without it → `FEATURE_UNAVAILABLE` with action "Update X1Pen Connector and reconnect this tab." / "Reload or update X1Pen and reconnect this tab.").
  - `x1pen-bridge.mjs` `sendCommand` runs `assertMethodCompatible` before sending.
- Versions: `mcp/package.json` 2.7.0, Connector 1.3.0; `mcp/` and `extension/` are unchanged since tag v0.10.1. MCP code at tag v0.9.2 is the published 2.7.0 line (the later set_source_file work is unpublished, #111). Past feature PRs bumped versions in the same commit; here bumps are the owner's at release (`docs/RELEASE_CHECKLIST.md`).
- Tests: `tests/x1pen_mcp_test.mjs` (fake bridge; tool list snapshot; source-sync; compatibility), `tests/x1pen_extension_bridge_test.mjs` (fake `window.X1PenAutomation`; feature lists equal), `tests/x1pen_bridge_test.mjs` (real `X1PenBridge`, fake Connector over WebSocket), `tests/x1pen_automation_test.mjs` (real page). No test runs MCP + Connector code + the real page together.
- Docs: `docs/X1PEN_MCP.md` (says 2.7.x does not support HuBASIC), `mcp/README.md`.

## Decisions (answers to Secretary)

- **Options stay out of `getProgram`/`setProgram`.** They are one global setting, not part of a program: the revision, revisionEpoch, authoringHash and baseline cache describe sources; putting options there would make an option change look like a program edit, and `set_program` (complete replacement) would have to decide whether it also resets options. Separate tools keep both contracts simple.
- **The 2.7.x stop is fixed in this PR**: recognising `hubasic` is the core of the change, not a separate fix. Published 2.7.x stays as it is; users get the fix with the next npm release (owner).
- **HuBASIC programs need no Connector update** (payloads pass through, verified with Connector 1.3.0 code). **The options do** (new methods in `invokeX1PenInPage`): until the owner releases a new Connector, the option tools answer `FEATURE_UNAVAILABLE` (component connector, "Update X1Pen Connector and reconnect this tab."). No `CONNECTOR_MINIMUMS` entry: the version number is chosen at release, and the message works without it.
- HuBASIC source support is detected from the page's `getProgram` (`hubasic` field present), not a feature ID: a feature would require the Connector to advertise it although it plays no part.

## Change scope

- `mcp/x1pen-source-sync.mjs`: `AUTHORING_SECTIONS.hubasic = ['hubasic']`; section loops cover `hubasic` and skip a section whose content is `null` (page without HuBASIC).
- `mcp/x1pen-server.mjs`:
  - `SOURCE_SECTIONS` + `'hubasic'`; `SOURCE_MODES = ['basic+asm','asm','slang','hubasic']` used by `set_program` / `diff_source`; `get_program` `fields` max 4; `set_program` gains `hubasic` (string, max `MAX_SOURCE_LENGTH`).
  - `normalizeProgramSnapshot`: accept `'hubasic'`; `hubasic` absent → `null` when the mode is not hubasic (page predates HuBASIC), error otherwise; other sections unchanged.
  - `summarizeProgram` / `toolError` sections: omit `hubasic` when `null`. Reading/searching/diffing/editing `hubasic` on such a page → `SOURCE_CONTENT_UNAVAILABLE` (existing code, X1Pen component, action update/reload X1Pen). `set_program` with `sourceMode: 'hubasic'` on such a page → `SOURCE_MODE_UNSUPPORTED` after the pre-read, before any write.
  - `assertEditableSection`: hubasic mode allows only `hubasic`; other modes reject `hubasic` ("replace the complete program with sourceMode hubasic").
  - `apply_edits` / `set_source_file`: send `hubasic` too when the snapshot has it.
  - New tools `x1pen_get_hubasic_options` (read-only) and `x1pen_set_hubasic_options` (`patch`: strict object, optional nullable `wait` (regex none|line[:N]|frame[:N]), `noLineNumbers`, `assumeDefint` (boolean), `stringLen` (int 1..255), `dataBudget` (int 1..65535); at least one key). Both return `{ options }` (full options from the page). Descriptions: global for all HuBASIC programs, not part of the program or its revision, null resets to the hubasic2sl default, the page rejects during Run setup.
  - `SERVER_INSTRUCTIONS`: one sentence on HuBASIC mode (text form of X1 bytes, options are a separate global setting, the bundled reference does not cover HuBASIC: do not assume FuzzyBASIC syntax).
- `mcp/x1pen-compatibility.mjs`: `FEATURE_IDS` + `'hubasic.options'`; `METHOD_FEATURES` `getHuBasicOptions` / `setHuBasicOptions` → `'hubasic.options'`.
- `extension/compatibility.mjs`: `CONNECTOR_FEATURES` + `'hubasic.options'`.
- `extension/page-automation.mjs`: `getHuBasicOptions` / `setHuBasicOptions(params.patch)`, with a check like `requireKeyboardInput` (feature advertised by X1Pen and function present, else `FEATURE_UNAVAILABLE` x1pen); lock label for set ("AI is updating HuBASIC options...").
- `html/x1pen.js`: `getAutomationFeatures` + `'hubasic.options'`.
- Tests (below); docs `docs/X1PEN_MCP.md`, `mcp/README.md`, `CHANGELOG.md`. No version fields change.

## Implementation steps

1. Branch `feat/mcp-hubasic` from main `69ca76a` (done; previous plan archived).
2. Compatibility lists (MCP, Connector, X1Pen) and `METHOD_FEATURES`.
3. Source sync + server source changes; unit tests in `tests/x1pen_mcp_test.mjs`.
4. Option tools (MCP) + Connector methods; unit tests (`x1pen_mcp_test`, `x1pen_extension_bridge_test`).
5. End-to-end chain test in `tests/x1pen_automation_test.mjs` (real page + real `X1PenBridge` + test Connector running `invokeX1PenInPage` in the page + MCP client over InMemoryTransport), new and old MCP.
6. Docs, CHANGELOG. `./build.sh`, full `npm test`, refresh preview `dist/`.
7. Implementation review, one PR (body lists what each release carries and the mixed-version matrix).

## Edge cases and test plan

- Unit, MCP (`tests/x1pen_mcp_test.mjs`; fake bridge's `normalizeProgram` learns hubasic):
  - tool list snapshot gains the two tools; `set_program` / `diff_source` accept `hubasic`.
  - hubasic mode: `get_program` metadata (hubasic authoring, others inactive, authoringHash over hubasic), `fields: ['hubasic']`, `get_source` / `search_source`, `apply_edits` on hubasic (sends sourceMode hubasic), editing `basic` in hubasic mode → `SOURCE_SECTION_NOT_EDITABLE`, editing `hubasic` in basic+asm mode → same, `set_program` hubasic, `set_source_file` hubasic, `diff_source` with a hubasic baseline, switching modes (hubasic → basic+asm via set_program).
  - authoringHash / section hashes for basic+asm, asm and slang snapshots are identical to the pre-change values (golden values from main), with and without a `hubasic: ''` field.
  - page without `hubasic` field: non-HuBASIC tools work and summaries have no hubasic section; `get_source hubasic` → `SOURCE_CONTENT_UNAVAILABLE`; `set_program` hubasic → `SOURCE_MODE_UNSUPPORTED` and no `setProgram` sent; a snapshot with `sourceMode: 'hubasic'` but no field → `SOURCE_CONTENT_UNAVAILABLE`.
  - options: get returns page options; set forwards the patch; schema rejects unknown keys, empty patch, `stringLen: 0/256`, `dataBudget: 65536`, `wait: 'line:0'`, non-boolean flags; null passes through; a page error (`RUN_PENDING`) keeps its code; Connector without the feature → `FEATURE_UNAVAILABLE` component connector (no requiredVersion); X1Pen without it → component x1pen.
- Unit, Connector (`tests/x1pen_extension_bridge_test.mjs`): the three feature lists still equal; `getHuBasicOptions` / `setHuBasicOptions` call the page API with the patch and lock/unlock around set; page without the methods/feature → `FEATURE_UNAVAILABLE` x1pen.
- E2E (`tests/x1pen_automation_test.mjs`, real page):
  - X1Pen advertises `hubasic.options`.
  - New chain (Connector code at this commit): `x1pen_set_program` hubasic → page shows it in the HuBASIC tab → `x1pen_get_program` / `get_source` return it → `x1pen_apply_edits` → `x1pen_validate` ok → `x1pen_set_hubasic_options {wait:'line:2'}` → page `getHuBasicOptions()` matches and validate still ok → reset with null; `set_program` back to basic+asm.
  - Old Connector descriptor (1.3.0 features) with new MCP: HuBASIC source tools work; option tools → `FEATURE_UNAVAILABLE` connector.
  - Old MCP (mcp/ from tag v0.9.2, extracted with `git archive` to a temp dir that links the repo `node_modules`; skipped with a message if the tag is missing): basic programs work against the new page; with a HuBASIC program, `x1pen_get_program` fails with `invalid source mode: hubasic` (documents the known 2.7.x limit; no silent misbehaviour).
- Mutation checks: drop `hubasic` from `SOURCE_SECTIONS`; drop the Connector method; drop the X1Pen feature → the corresponding tests fail.
- Rollback: revert the PR. Nothing is stored by the new code (options are already stored by the page). If only the Connector or MCP release is held back, the matrix below still holds.
- Mixed versions (documented in docs and PR):
  - new MCP + Connector 1.3.0 + new page: HuBASIC sources yes, options "update Connector".
  - new MCP + any Connector + page without HuBASIC (production 0.10.1): non-HuBASIC unchanged (same hashes); HuBASIC tools refuse with update/reload X1Pen; options "update X1Pen".
  - MCP 2.7.x + new page: unchanged known limit (HuBASIC mode stops source tools; other modes fine). The page's extra field and feature are ignored by old MCPs.
- Regression: full `npm test`.

## Open decisions

- None blocking. Follow-ups to report: a bundled HuBASIC reference for MCP; the owner's release of x1pen-mcp (npm) and X1Pen Connector (Web Store) — HuBASIC sources need only the MCP release, options need both plus the Web deploy.

## Cross-review反映

### Round 1 — codex / gpt-6-astra/high
- Verdict: APPROVED (model=APPROVED; policy=strict; host_override=no)
- Implementation: READY (next_action=implement; reviewer=READY)
- No findings.

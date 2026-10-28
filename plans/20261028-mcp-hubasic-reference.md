# x1pen-mcp 2.9.0: HuBASIC reference, language-profile compatibility, HuBASIC text form wording

## Purpose

An AI used X1Pen 0.11.0 + x1pen-mcp 2.8.0 + Connector 1.4.0 in production to write HuBASIC programs and reported:
1. There is no HuBASIC reference, so it could not know what hubasic2sl accepts (`VSYNC n` only after being told).
2. `DEFCHR$` byte order differs from FuzzyBASIC `PCGDEF` (striped PCG on the first try). This is the specification; it belongs in the reference.
3. `x1pen_get_language_profile` says `compatible: false`, and the "tool schema" has no hubasic.
4. `\xHH` written by the AI comes back as a real character, and `contentHash` is the value after that normalization.

ひろしさん chose option A: one PR, MCP only, released as npm x1pen-mcp 2.9.0 (Web and Connector unchanged):
- add a bundled HuBASIC reference (`mcp/reference/hubasic.json`, 25–40 entries) and `hubasic` as a reference language;
- fix the `compatible: false` bug and mention HuBASIC in the reference tool descriptions;
- for item 4, only add wording (tool descriptions, server instructions, docs). Code behavior does not change.

**Rights constraint (hard rule, from ひろしさん):** the reference is written only from material in SLANG-compiler (ひろしさん's own MIT repository): the hubasic2sl source and `docs/HUBASIC.md` at the bundled revision, plus the X1Pen code in this repo. The HuBASIC reference manual is not read, copied or paraphrased. Allowed content: statement/function names, the argument forms hubasic2sl parses, hubasic2sl-only rules, unsupported items, known differences, error code classes, X1Pen-side rules, the `DEFCHR$` byte layout (from the runtime implementation), and short self-written examples. Every entry records the hubasic2sl revision it was written from. A rule that the reference is reviewed whenever the bundle is replaced must be written down (and enforced by a test).

Non-goals: no change to html/ (X1Pen), extension/ (Connector), the HuBASIC bundle, or how HuBASIC text is normalized. No new MCP tools. No SLANG-compiler changes.

## Observed evidence

- `mcp/x1pen-reference.mjs` loads `reference/{fuzzybasic,slang,slang-catalogs,z80asm,x1-hardware}.json` into `ENTRIES`; `validateReferenceData()` checks unique IDs, required fields (`id, language, kind, title, summary`), non-empty `profiles` that exist in `manifest.json`, non-empty `symbols`, string arrays for `symbols/aliases/relatedIds/sourceUrls`, and `relatedIds` that resolve. Entry shape (FuzzyBASIC): `id, language, kind, title, profiles, symbols, aliases (EN+JA), summary, syntax[], notes[], examples[{title, source}], relatedIds, sourceUrls`. Entries are English with Japanese aliases.
- `mcp/reference/manifest.json`: `schemaVersion 2`, `referenceVersion "2026-08-10"`, `defaultProfiles` for fuzzybasic/slang/z80asm/x1, and 4 `profiles` (`x1pen-fuzzybasic-1.2L`, `x1pen-slang-c9e8f53-lsx`, `x1pen-z80asm-current`, `x1-hardware-xmillennium-web`). No HuBASIC profile.
- `mcp/x1pen-server.mjs`:
  - `REFERENCE_LANGUAGES = ['fuzzybasic', 'slang', 'z80asm', 'x1']` (the `language` enum of `x1pen_search_reference`); `REFERENCE_KINDS = ['syntax','runtime','x1-extension','catalog','library','profile','limits','architecture','memory','video','io']`.
  - `x1pen_get_language_profile`: `compatible = activeIds.every((id) => bundledIds.has(id))`, where `activeIds` are all `status.languageProfiles[*].id` from X1Pen's `getStatus`.
  - Descriptions of `x1pen_get_language_profile` and `x1pen_search_reference` name only FuzzyBASIC, SLANG, Z80 assembler and X1 hardware.
  - Server instructions line: "In sourceMode hubasic the hubasic section is the HuBASIC program as X1 bytes in X1Pen text form: ¥ for $5C, \{name} or \xHH for other X1 characters, LF between lines. The bundled reference does not cover HuBASIC; do not assume FuzzyBASIC syntax. …"
  - Source tools already accept hubasic in 2.8.0: `SOURCE_MODES` and `SOURCE_SECTIONS` include `hubasic` (set_program, get_source, apply_edits, set_source_file …). 2.7.0 had `z.enum(['basic+asm','asm','slang'])`, so a server that accepted `sourceMode: "hubasic"` was ≥ 2.8.0; a client tool list without hubasic in a source tool can only be a stale client-side cache. The reference tools genuinely lack hubasic.
- `html/x1pen.js` `getStatus().languageProfiles.hubasic = { id: 'x1pen-hubasic-x1native-slfs', environment: 'x1native_slfs', defaultOrg: 0x1000, runtimeRevision: <bundle revision or null until the toolchain is loaded once>, hubasic2slVersion }`. Hence with X1Pen 0.11.0 and MCP 2.8.0, `compatible` is always `false` (bug from PR #140; the MCP unit test fake reports only fuzzybasic and slang, so it was not caught).
- HuBASIC text form (`html/x1pen_hubasic_text.js`): the program is X1 bytes; `toText` = codec `clipboardText` with `\\`→`¥` (ASCII as is, $A1–$DF as half-width kana, named symbols as `\{name}`, other bytes `\xHH`, LF). `fromText` accepts everything `X1.parseEscapes` accepts. So `\xB1` is stored as byte $B1 and read back as `ｱ`; `\x87`-like named bytes come back as `\{name}`. Program hashes are computed on the read-back text. `x1pen_set_source_file` returns the raw file SHA-256 and the stored section hash, which by design differ when the file used other spellings. Existing docs say "X1Pen text form" and "section summary hash describes the normalized stored text" but not "what you send may come back spelled differently; compare with what you read back".
- Bundle: `assets/hubasic/current.json` revision `5abbffaa2e412f1b9792a3abc1de149908838c6b`; `assets/hubasic/<rev>/manifest.json` `hubasic2slVersion "0.1.0-alpha"`, `basAbi 1`, `loadAddress 4096`, `reservedStart 65504`; runtime `libx1_basic.asm` etc. Imported by `scripts/import-hubasic-bundle.mjs`; `tests/hubasic_toolchain_test.mjs` asserts bundle/fixture revisions agree.
- SLANG-compiler at 5abbffa (read-only, via `git archive`): `src/SLANGCompiler.HuBasic/Lexing/HuKeywords.cs` (reserved-word table, `VSYNC` marked as hubasic2sl-only), `Parsing/HuParser.cs` (statement dispatch and argument forms; function arity table: e.g. `CHR$ 1..255`, `MID$ 2..3`, `INSTR 2..3`, `SCRN$ 3`, `PAI 1`, `RAD 1`, `RND 0..1`; unknown statements → HB0301), `MakeRem` (`'#VSYNC n` directive: body after `'`/`REM` starting with `#VSYNC`, n = positive ASCII integer else 1), `Lowering/HuLowerer.cs` (`'#VSYNC` emits `BAS_VSYNC` only when `Wait == Frame`; `VSYNC` statement emits `BAS_VSYNCS(n default 1)` regardless of `--wait`; `DEFCHR$` → `BAS_DEFCHR(code, string)`), `docs/HUBASIC.md` (supported statements/functions, unsupported list, known differences, diagnostics classes; content identical to HEAD except a spelling rename). Runtime `BAS_DEFCHR`: code 0–255 (else error 5); string = **blue 8 bytes, red 8 bytes, green 8 bytes** (plane-major), shorter → zero-filled, longer → first 24; reordered to PCGDEF's row-major B,R,G. `BAS_SHEX` (`HEXCHR$`): 2 hex digits → 1 byte, odd length / non-hex → error 5. So `DEFCHR$(n)=HEXCHR$(48 hex digits)` = B 16 digits, R 16, G 16; FuzzyBASIC `PCGDEF` takes B,R,G per row (BRG × 8 rows), which caused the stripes. `BAS_CGEN`: 1 = PCG (attribute $20), 0 = ROM. `CGPAT$(n)` = 32 bytes (ROM 8 + B 8 + R 8 + G 8).
- X1Pen options (`html/x1pen_hubasic_options.js`): `wait` (`none` | `line:N` | `frame:N`, N 1..65535), `noLineNumbers`, `assumeDefint`, `stringLen` (1..255), `dataBudget` (1..65535); defaults `none,false,false,255,24576`. MCP tools `x1pen_get/set_hubasic_options`.
- Tests: `tests/x1pen_reference_test.mjs` (node: data validity, search ranking per language, examples accepted by real toolchains, relatedIds reachability, keyword coverage); `tests/x1pen_mcp_test.mjs` (fake X1Pen; `language profile reports bundled data…` asserts `profiles.length === 4`, `compatible === true`); `tests/x1pen_mcp_package_test.mjs` (packed file list incl. `reference/*.json`, version 2.8.0 twice); `tests/x1pen_automation_test.mjs` (Playwright on the real page; `connectMcp` E2E chain MCP→test Connector→real X1Pen; HuBASIC validate/run tests; `textVramContains`).

## Change scope

1. `mcp/reference/hubasic.json` (new): ~27 entries, language `hubasic`, profile `x1pen-hubasic-x1native-slfs`. Every entry has `sourceUrls` pointing to `https://github.com/h-o-soft/SLANG-compiler/blob/5abbffaa2e412f1b9792a3abc1de149908838c6b/<file>` (docs/HUBASIC.md and/or the specific source file), plus `basedOn: "hubasic2sl 0.1.0-alpha @ 5abbffa"`-style provenance via the profile (see 2). Entry plan (ids):
   - `hubasic.program.text-form` (syntax): X1Pen text form; `¥`, `\{name}`, `\xHH`, kana; **canonical read-back** (what you write may come back spelled differently; hashes are of the read-back text; compare with re-read text, not with your input or a local file hash); characters X1 cannot show are refused.
   - `hubasic.program.structure` (syntax): line numbers, `:` and the optional-separator rule, `'`/`REM`, case-insensitive keywords with longest match, reserved-prefix pitfalls (`VSYNCX=1`, `PAI`, `RAD`, `LABEL`), 255 chars per line, non-ascending line warning.
   - `hubasic.values.types` (syntax): `%`/`!`/`#`/`$`, `DEFINT/DEFSNG/DEFDBL/DEFSTR` (whole program), FLOAT 24-bit ≈5 digits, 16-bit ints wrap, string lengths, `assumeDefint`.
   - `hubasic.values.numbers-operators` (syntax): `&H/&O/&B`, operators `+ - * / \ MOD ^`, comparisons, `NOT AND OR XOR`, string `+`/compare.
   - `hubasic.values.arrays` (limits): one dimension, constant bounds and their maxima, implicit 10, memory per element, `stringLen` effect.
   - `hubasic.flow.jumps-labels` (syntax): `GOTO/GOSUB/RETURN [line]`, `ON … GOTO/GOSUB/RESTORE`, `LABEL "name"`, `GOTO "name"`, constant names only.
   - `hubasic.flow.if` (syntax), `hubasic.flow.loops` (syntax: `FOR/NEXT [v,…]` incl. float FOR, `REPEAT/UNTIL`, `WHILE/WEND`), `hubasic.flow.end-errors` (runtime: `END`, program end leaves the screen, runtime error display, `noLineNumbers`).
   - `hubasic.data.read` (syntax): `DATA/READ/RESTORE [line]`, `dataBudget`, number reading rule.
   - `hubasic.text.print` (runtime): `PRINT ; , SPC() TAB() USING`, `PRINT#0`, cursor codes 28–31.
   - `hubasic.text.screen` (runtime): `LOCATE x,y`, `CLS [n]` meanings, `COLOR [fg][,bg]`, `WIDTH 40/80`, `CFLASH`, `CSIZE` (PRINT#0), `CGEN`, `PALET [c,p]`, `PRW [n]`, text `LINE (x1,y1)-(x2,y2),"c"[,B|BF]`, `INIT`.
   - `hubasic.input.keys` (runtime): `INPUT`, `INKEY$`, `INKEY$(0)`, `INPUT$(n)`, `STICK`, `STRIG`, `CLICK ON/OFF`, `REPEAT ON/OFF`, no-op `KBUF/KEY/SCREEN`.
   - `hubasic.graphics.line-paint` (x1-extension): graphic `LINE … PSET|PRESET[,c][,B|BF]`, `PAINT (x,y),c[,borders…]`, size cost.
   - `hubasic.pcg.defchr` (x1-extension): `DEFCHR$(n)=s`, **B 8 bytes → R 8 → G 8 (with HEXCHR$: B 16 hex digits → R 16 → G 16)**, short/long strings, code range, `CGEN 1` to show PCG, `CGPAT$` layout, explicit contrast with FuzzyBASIC/SLANG `PCGDEF` (BRG per row); relatedIds to `fuzzybasic.x1.pcg-definition` and `x1.video.pcg-palette`.
   - `hubasic.sound.play` (runtime): `PLAY "MML"`, `PLAY n`, `TEMPO`, `BEEP [0|1]`, `SOUND r,v`, `PAUSE n`.
   - `hubasic.timing.vsync-wait` (x1-extension): `VSYNC [n]` (hubasic2sl-only, any `wait`, n≤0 no wait, not valid on real HuBASIC), `'#VSYNC n` (comment directive; **only effective when the X1Pen option `wait` is frame mode**, i.e. `x1pen_set_hubasic_options {patch:{wait:"frame:1"}}` (X1Pen also accepts `"frame"` and stores it as `"frame:1"`; the N of `frame:N` is not used by the directive, which waits its own n)), `line:N` (~0.1 ms × N per line, 450–500 ≈ HuBASIC speed, ineffective inside one-line loops), recommended game pattern (`wait none` + `VSYNC 1` in the main loop).
   - `hubasic.machine.memory-io` (runtime): `POKE`, `POKE@`, `PEEK`, `PEEK@`, `OUT`, `INP`, `CALL` (RET, IX/IY saved), program at $1000, work area after it, end ≤ $FFDF (`__WORKEND__`), no `CLEAR`, value ranges.
   - `hubasic.functions.math` (runtime), `hubasic.functions.string` (runtime: incl. `MID$` statement, `SWAP`, `HEXCHR$`, `CHARACTER$`, `SCRN$`), `hubasic.misc.time-random` (runtime: `TIME`, `TIME=`, `RND`, `RANDOMIZE`).
   - `hubasic.unsupported` (limits): unsupported statements/functions and their codes (HB0301/HB0302/HB0303).
   - `hubasic.differences` (limits): known differences from HuBASIC (numbers, flow, screen, input/sound, speed), condensed.
   - `hubasic.diagnostics` (runtime): HB code classes, warnings, how X1Pen reports them (`x1pen_validate` diagnostics, `HUBASIC_TRANSPILE_FAILED`, stages).
   - `hubasic.x1pen.run` (profile): what Run does in X1Pen (convert → SLANG → assemble → size check → SLFS disk → boot from FDD0), options keys/defaults and their CLI meaning, the options are global and not part of the program.
   - `hubasic.keywords.catalog` (catalog): the full reserved-word list from `HuKeywords.All`, partitioned into supported statements, supported functions/operators, no-op statements and reserved-but-unsupported.
   Examples: short, self-written, only in entries where useful, in X1Pen text form.
2. `mcp/reference/manifest.json`: bump `referenceVersion` to `2026-10-28`; add `defaultProfiles.hubasic = "x1pen-hubasic-x1native-slfs"` and a profile `{ id: "x1pen-hubasic-x1native-slfs", language: "hubasic", displayName: "X1Pen HuBASIC (hubasic2sl 0.1.0-alpha / x1native_slfs)", hubasic2slVersion: "0.1.0-alpha", runtimeRevision: "5abbffa…", environment: { runtime: "x1native_slfs", defaultOrg: 4096 }, notes (scope + rights rule: written only from hubasic2sl source/docs, not from the HuBASIC manual), sourceUrls }`.
3. `mcp/x1pen-reference.mjs`: load `hubasic.json`.
4. `mcp/x1pen-server.mjs`:
   - `REFERENCE_LANGUAGES` += `'hubasic'`.
   - `x1pen_get_language_profile`: keep the id check; additionally, a reported profile whose bundled profile has `runtimeRevision` and whose reported `runtimeRevision` is a non-null different value makes `compatible` false and adds `revisionMismatches: [{ language, reported, bundled }]` (null reported revision = not yet loaded → id check only). Other languages unchanged.
   - Descriptions: `x1pen_get_language_profile`, `x1pen_search_reference` (and `x1pen_get_reference` if it lists languages) mention HuBASIC.
   - Server instructions: replace "The bundled reference does not cover HuBASIC; do not assume FuzzyBASIC syntax." with "Search the bundled HuBASIC reference (language hubasic) for what hubasic2sl accepts; do not assume FuzzyBASIC syntax." and add the read-back sentence: "X1Pen stores X1 bytes, so text you write may come back spelled differently (\xB1 as ｱ, named bytes as \{name}); program hashes describe the read-back text, so compare with text read back from X1Pen."
   - `x1pen_set_program` and `x1pen_set_source_file` descriptions: one sentence each about HuBASIC read-back spelling and hashes.
5. `mcp/package.json` 2.9.0; `tests/x1pen_mcp_package_test.mjs` version pins and packed file list (`reference/hubasic.json`).
6. Rule for bundle replacement: a node test asserts the manifest HuBASIC profile `runtimeRevision` equals `assets/hubasic/current.json` revision and every `hubasic.*` entry's `sourceUrls` use that revision — so importing a new bundle fails `npm test` until the reference is reviewed and re-stamped. Written down in: `scripts/import-hubasic-bundle.mjs` (header comment + final console line "review mcp/reference/hubasic.json"), `docs/RELEASE_CHECKLIST.md` is NOT touched (Secretary handles its additions), `mcp/README.md`/`docs/X1PEN_MCP.md` one line.
7. Docs: `docs/X1PEN_MCP.md` (HuBASIC section: reference now exists, read-back wording; tool table descriptions), `mcp/README.md` (same), `CHANGELOG.md` (`## Unreleased` → x1pen-mcp 2.9.0 entry; version line "x1pen-mcp 2.9.0 / X1Pen Web 0.11.0 / Connector 1.4.0").

## Implementation steps

1. Write `hubasic.json` entries from the 5abbffa sources (extracted to the scratchpad by `git archive`, never from a manual). Write each example myself.
2. Manifest profile + loader + server changes (enum, compatibility, descriptions, instructions).
3. Tests (below), docs, CHANGELOG, version 2.9.0, import-script note.
4. `./build.sh`, full `X1PEN_BROWSER_EXECUTABLE=/usr/bin/google-chrome npm test`.
5. Implementation review via `secretary review`, fix, then one PR.

## Edge cases and test plan

Node (`tests/x1pen_reference_test.mjs`):
- existing validity test covers the new file (unique IDs, known profile, symbols, relatedIds).
- every `hubasic.*` entry is reachable through relatedIds (same pattern as other languages).
- representative EN/JA queries hit dedicated entries: `VSYNC` → `hubasic.timing.vsync-wait`; `#VSYNC`/`'#VSYNC` → same; `DEFCHR$` → `hubasic.pcg.defchr`; `PCG 定義` (language hubasic) → `hubasic.pcg.defchr`; `LABEL` → jumps-labels; `CIRCLE` → `hubasic.unsupported`; `\\xHH`/`エスケープ` → text-form.
- coverage: every word of the catalog's "supported statements" partition is a symbol of some dedicated entry; every word in the catalog is in exactly one partition; the catalog's full list matches a checked-in copy of `HuKeywords.All` from 5abbffa (stored in the catalog itself; the bundle drift is caught by the revision test below).
- provenance: manifest HuBASIC profile `runtimeRevision` === `assets/hubasic/current.json` revision === `assets/hubasic/<rev>/manifest.json.slangCompilerRevision`; `hubasic2slVersion` equals the bundle manifest; every hubasic entry has ≥1 sourceUrl and all its SLANG-compiler URLs contain that revision.
- `DEFCHR$` entry states the plane-major order and mentions PCGDEF (string assertions on syntax/notes, so the key fact cannot silently disappear).

Node (`tests/x1pen_mcp_test.mjs`, fake X1Pen):
- fake `getStatus` gains `languageProfiles.hubasic` (id + runtimeRevision of the bundle): `compatible === true`, `profiles.length === 5`, `defaultProfiles.hubasic`.
- reported hubasic runtimeRevision different → `compatible === false` with `revisionMismatches`; null → true.
- unknown profile id still → false (existing semantics).
- `x1pen_search_reference` with `language: 'hubasic'` accepted and returns hubasic entries; server instructions mention the HuBASIC reference and read-back; `x1pen_set_program`/`x1pen_set_source_file` descriptions mention read-back.

E2E (`tests/x1pen_automation_test.mjs`, real X1Pen page + real hubasic2sl wasm):
- MCP chain (`connectMcp`): `x1pen_get_language_profile` against the real X1Pen → `compatible: true`, `reportedProfiles.hubasic.id` is a bundled profile (this is the regression the fake missed). Run once after the toolchain is loaded so `runtimeRevision` is non-null and matches.
- every example in `hubasic.json` passes `X1PenAutomation.validate()` (convert + compile + assemble + size check), with no error diagnostics.
- the unsupported entry's listed statements each produce HB0301/HB0302/HB0303 on validate (small one-line programs).
- `DEFCHR$` layout: `DEFCHR$(65)=HEXCHR$("FF…FF" + "00"×16)` (blue plane all set), `CGEN 1`, `PRINT "A"`, run, then read the screen capture: the cell is uniformly blue (no stripes). Also a red-only variant → red. This pins the byte order end to end.
- `VSYNC`/`'#VSYNC` example validates under `wait: "frame:1"` (set through `X1PenAutomation`'s HuBASIC options API, the same path as `x1pen_set_hubasic_options`) and under `wait: "none"`; the options are restored afterwards.

Package: `npm run test:mcp-package` file list includes `reference/hubasic.json`; version 2.9.0.

Rollback: MCP-only; `npm dist-tag add x1pen-mcp@2.8.0 latest` restores the previous latest. No Web/Connector impact; the change is additive (new language value, new profile). Older X1Pen (0.10.1) reports no hubasic profile → compatible unchanged (true).

Compatibility: an old X1Pen without hubasic → id check passes as before. A future X1Pen with another bundle revision → `compatible:false` + `revisionMismatches` (intended: the reference may be stale).

## Open decisions

- `revisionMismatches` field name and making mismatched runtime revisions incompatible: chosen (cheap, honest). Alternative: only a note. Decided: incompatible + field.
- Entry language: English with Japanese aliases (matches existing files).

## Cross-review反映

### Round 1 — codex / gpt-6-astra/high
- Verdict: NEEDS_WORK (model=NEEDS_WORK; policy=strict; host_override=no)
- Implementation: READY AFTER FIXES (R1-F1) (next_action=fix_then_implement; reviewer=READY_AFTER_FIXES)
- [adopted][medium] R1-F1 Use the accepted frame wait option syntax → Change scope 1 (`hubasic.timing.vsync-wait`) and the E2E test plan now use the canonical `"frame:1"` in tool calls, explain that `"frame"` is also accepted and stored as `"frame:1"` (`parseWait` in `html/x1pen_hubasic_options.js` defaults a missing N to 1), and that the directive ignores N.

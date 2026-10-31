# X1Pen: HuBASIC bundle from SLANG-compiler ff3cf7e (BIN$, two-dimensional arrays, HB0314, --string-len hints) and the reference review

## Purpose

SLANG-compiler PR #249 is merged at `ff3cf7eaea73a0157da014783604eafe9cf52845`. X1Pen main (`47ae94f`, released as X1Pen Web 0.13.0 / x1pen-mcp 2.11.0 for the HuBASIC part) bundles hubasic2sl and the x1native runtime from `d15d32eb7c033ca73b8468d1401a2b57fad70979` (PR #248). This PR, as Secretary asked for ひろしさん:

1. replaces the bundle with ff3cf7e;
2. reviews the x1pen-mcp HuBASIC reference (`mcp/reference/hubasic.json`) against ff3cf7e. The stamp test fails until that is done. Secretary asked for three things in particular:
   - a `BIN$` entry. It gives **no leading zeros** and works on the **16-bit** value (`BIN$(5)` is `101`, `BIN$(-1)` is sixteen `1`s). AI tends to assume fixed-width output, so the reference states it plainly and shows how to pad;
   - two-dimensional arrays: now supported; three or more dimensions are not (HB0303); an array used without `DIM` as 2-D is 11×11; a name used both as 1-D and 2-D is the new error HB0314;
   - `--string-len`: lower it when static data does not fit. HB0305 (string array) and HB0309 (static data) now print a value that fits. In X1Pen this is the `stringLen` option;
3. checks in X1Pen that these convert and run as slang's docs describe.

Rights rule (ひろしさん's): the reference is written only from SLANG-compiler sources and `docs/HUBASIC.md` at ff3cf7e (MIT, ひろしさん's repository) and X1Pen's own code. The HuBASIC manual is never read, copied or paraphrased.

Non-goals:
- No version bump (Web, x1pen-mcp, Connector). Bumping and publishing come after the merge, separately.
- No deploy or npm publish; ひろしさん does both.
- No change to the converter or runtime (slang Province's), and no change to the emulator.
- No change to the Options panel UI.

## Observed evidence

- SLANG-compiler `d15d32e..ff3cf7e`: 2 commits (f556c1a feat, 682a013 fix) and the merge. 11 files: `docs/HUBASIC.md`, `runtime/libx1_basic.asm`, `HuAnalyzer.cs`, `HuProgram.cs`, `SlangBackend.cs`, `HuTranspiler.cs`, `HuLowerer.cs`, `HuAst.cs`, `HuParser.cs`, 2 test files. `HuKeywords.cs` is unchanged: `BIN$` was already a reserved word (until now rejected as HB0302).
- Converter:
  - `HuParser.cs`: `["BIN$"] = (1, 1)` joins the function table. `ParseIndex` and `ParseDim` read an optional second subscript or bound. `SkipExtraSubscripts` reports a third one as `HB0303 3 次元以上の配列は未対応です (2 次元までです)`.
  - `HuAnalyzer.cs`:
    - `BIN$` shares the `HEX$` case: `ExpectNum(a[0], intConv: true)`, result string.
    - `DimBound`: each bound is a constant 0..max (integer 8191, float 5460, string `16384/(N+1)-1`, default N=255 gives 63). Variable bounds are HB0304, float arithmetic HB0313, out of range HB0305.
    - 2-D `DIM`: the element count `(b1+1)*(b2+1)` must be at most max+1, else HB0305 ("要素の数 … が上限 … を超えています"). Several `DIM`s of one array merge per dimension, and the merged size is checked again.
    - String arrays add `StrArrayHint` to HB0305: " (文字列の配列は --string-len で 1 本を短くすると上限が増えます)".
    - `CheckRank`: the rank is fixed by the first `DIM` or use. A different rank later is `HB0314 配列 X を 1 次元と 2 次元の両方で使っています (HuBASIC では Duplicate definition)`, once per array.
    - `UseArray`: a 2-D array used without `DIM` is 11×11 (bounds 10,10, 121 elements). If 121 elements exceed the per-array maximum (string arrays at the default length), HB0305 says: "DIM で大きさを書くか、--string-len で文字列 1 本を {MaxArrayBytes / 121 - 1} 以下にしてください". docs give 134.
    - `StringLenHint`: HB0309 (static data over `dataBudget`) gains "文字列の置き場が大きいので、--string-len {n} 以下にすると収まります" when shortening strings would fit. There are two variants: one from the analyzer's estimate ("この時点の計算では収まります … もう少し短くする必要があることがあります") and one after the backend (`HuTranspiler.cs`, exact).
    - `ComputeStaticBytes`: a 2-D array costs 6 header bytes instead of 4.
  - `HuLowerer.cs` / `SlangBackend.cs`: a hidden second upper bound `H_UB2_*`. The index is `BAS_AIDX(i, state, UB) * (b2+1) + BAS_AIDX(j, state, UB2)`, so each subscript is checked against its own bound. The first subscript is evaluated first. Before `DIM` runs, both bounds start at `min(10, storage bound)`.
- Runtime: new `BAS_SBINS` in `libx1_basic.asm`: "HL = 16 ビットの値 → その 2 進 (頭の 0 なし。0 は "0") の一時文字列 (BIN$ 関数)".
- `docs/HUBASIC.md` at ff3cf7e:
  - arrays up to 2-D; the limits; without `DIM` 10, or 11×11 for 2-D; subscripts checked per dimension; storage per dimension.
  - 3-D or more is HB0303 ("HuBASIC は使える"); HB0314 for mixed rank ("HuBASIC では実行時に Duplicate definition").
  - a 2-D string array without `DIM` exceeds one array's limit at 256 bytes per element (HB0305). Write a `DIM`, or set `--string-len` to 134 or less. HB0309 also prints a `--string-len` that fits.
  - `BIN$(n)`: "HuBASIC と同じく、16 ビットの値を頭の 0 なしの 2 進にします (`BIN$(5)` は `101`、`BIN$(-1)` は `1` が 16 個)。引数の扱いは `HEX$` と同じです".
  - not yet supported: `OCT$` etc. (HB0302), 3-D arrays (HB0303).
  - known differences: 2-D arrays used before their `DIM` follow the same per-dimension rule as 1-D (`A(3,0)` before `DIM A(2,20)`: HuBASIC allows it, here Subscript out of range). A `MIRROR$` in an assignment target's subscript is evaluated once, left to right; HuBASIC seems to evaluate the target subscript twice. This applies to 1-D arrays too.
  - diagnostics table HB03xx: HB0303 3-D or more, HB0314 mixed rank, HB0305 array too large, HB0309/HB0312 do not fit.
- slang reports: the converted SL of the 515 existing programs is unchanged, and their bins are byte-identical.
- Bundle: built in the scratchpad from a clean clone of `ff3cf7e` with `scripts/build-hubasic-wasm.sh`.
  - manifest: `dirty: false`, `basAbi: 1`, `hubasic2slVersion: 0.1.0-alpha`, 91 files, 4 testdata programs.
  - The upstream smoke check (`hubasic-wasm-smoke.mjs`) passed. It compares wasm and CLI output and checks the version, ABI and SHA, and the `CheckLayout` boundary.
- X1Pen:
  - X1Pen passes the `stringLen` option (1..255, `html/x1pen_hubasic_options.js`) to the wasm as `StringLen`. The Options panel labels it 「文字列の長さの上限」. `docs/X1PEN.md` maps it to `--string-len`, and MCP sets it with `x1pen_set_hubasic_options {"patch":{"stringLen":N}}`. The converter's messages name the CLI spelling `--string-len N`, so the reference must translate.
  - Validate diagnostics carry the HB code inside `message` (`error HB0305 …`), as found in the d15d32e work (`plans/20261029-hubasic-d15d32e.md`).
- Reference text that becomes wrong or incomplete:
  - `hubasic.values.arrays`: title "One-dimensional arrays…", summary "Arrays have one dimension only", note "Two or more dimensions are error HB0303".
  - `hubasic.functions.string`: no `BIN$`; note "OCT$, BIN$ and other unlisted functions are HB0302".
  - `hubasic.unsupported`: `BIN$` in symbols and the HB0302 list; HB0303 described as "two or more dimensions" with `10 DIM A(2,2)`.
  - `hubasic.diagnostics`: HB03xx line says "2-D array HB0303"; no HB0305/HB0314; nothing on the `--string-len` hint.
  - `hubasic.x1pen.run`: `stringLen` line has no hint of when to lower it.
  - `hubasic.keywords.catalog`: `BIN$` under "reserved, not supported".
  - `hubasic.differences`: nothing on 2-D arrays before `DIM` or the `MIRROR$` subscript order.
  - every SLANG-compiler `sourceUrl` points at d15d32e.
- Tests that encode the old behaviour (`tests/x1pen_automation_test.mjs`, "the HuBASIC reference names the code hubasic2sl gives each unsupported word"): `['BIN$', 'HB0302', '10 A$=BIN$(8)']` and `['DIM A(2,2)', 'HB0303', '10 DIM A(2,2)']`. Both become wrong.
- `tests/x1pen_reference_test.mjs` checks:
  - the stamp: every SLANG-compiler `sourceUrl`, `runtimeRevision` and `hubasic2slVersion` must match the bundle;
  - every catalog word is a UTF-16 string in the wasm;
  - every word in the catalog's statement, no-op and function groups appears in a dedicated entry's `symbols`;
  - per-feature tests check the bundled runtime/converter text against the reference, for example "HuBASIC V16 envelope, … reference matches the bundled converter and runtime".
- `tests/x1pen_automation_test.mjs` runs every reference example through the real toolchain.
- `mcp/reference/manifest.json`: `referenceVersion` `2026-10-29` (released in x1pen-mcp 2.11.0). The HuBASIC profile `runtimeRevision` and `sourceUrls` are at d15d32e.
- The reference generator is a scratchpad script (`gen-hubasic-d15.py`, REV-pinned). The JSON is committed; the script is not, as before.

## Change scope

- `assets/hubasic/`: `ff3cf7e…/` replaces `d15d32e…/`; `current.json` updated (importer).
- `tests/fixtures/hubasic/`: regenerated by the importer. Expected: only the revision in `expected.json` changes, since the 4 testdata programs use neither `BIN$` nor 2-D arrays.
- `mcp/reference/hubasic.json`, regenerated with REV ff3cf7e (generator copied to `gen-hubasic-ff3.py`). The entry count stays 29.
  - Every SLANG-compiler `sourceUrl` moves to ff3cf7e.
  - `hubasic.functions.string`:
    - `BIN$` in symbols;
    - summary: "BIN$(n) gives the binary digits of the 16-bit value **without leading zeros**: BIN$(5) is "101" (not "0000000000000101"), BIN$(0) is "0", BIN$(-1) is sixteen 1s";
    - syntax line `B$=BIN$(5)   "101": no leading zeros   B$=RIGHT$("0000000"+BIN$(N),8)   8 digits`;
    - notes:
      - negative numbers and 32768-65535 show their 16-bit pattern (BIN$(-32768) is 1 followed by 15 zeros);
      - the argument is handled as for HEX$ (a float is converted to an integer first). The exact rule is filled in from the probe: rounding, 65535, and above 65535;
      - to get a fixed width, pad with RIGHT$ as shown; LEN(BIN$(n)) varies with n;
    - the HB0302 note becomes "OCT$ and other unlisted functions are HB0302";
    - aliases gain binary, bits, 2 進, ビット;
    - a new example, "Binary digits with BIN$, padded to 8", which prints BIN$(5), BIN$(-1) and an 8-digit padded value.
  - `hubasic.values.arrays`:
    - title "Arrays (one or two dimensions) and their limits";
    - symbols gain `A(I,J)`, `HB0303`, `HB0305`, `HB0314`;
    - summary: up to two dimensions (`DIM A(100)`, `DIM B(10,20)`); constant bounds and the per-type limits; for 2-D the element count `(b1+1)*(b2+1)` must not exceed that limit + 1; without `DIM`, bound 10, or 10,10 (11×11 = 121 elements) for 2-D; storage is the largest `DIM`, per dimension for 2-D;
    - notes:
      - three or more dimensions are HB0303;
      - one name used with one subscript and with two (`A(1)` and `A(1,2)`, or `DIM A(5)` then `A(1,2)`) is HB0314. HuBASIC gives Duplicate definition at run time. A, A% and A$ are different arrays;
      - each subscript is checked against its own bound: with `DIM A(2,3)`, `A(0,4)` stops with Subscript out of range;
      - a 2-D string array without `DIM` needs 121 × 256 bytes, which is over one array's limit (HB0305). Write a `DIM` with the size you need, or lower stringLen to 134 or less;
      - the `--string-len` hints differ by case (R1-F1): an explicit string-array `DIM` that is too large gives HB0305 with only a generic suggestion to shorten strings with `--string-len` (no number); the undimensioned 2-D string array gives HB0305 naming 134; HB0309 names a value only when shortening strings would make the data fit, and the analyzer-time value may need to go a little lower. Non-string arrays and non-string data get no hint. In X1Pen `--string-len` is the stringLen option (hubasic.x1pen.run);
      - the existing notes on string element size, several `DIM`s and `DIM` below 10, extended to "per dimension";
    - aliases gain two-dimensional, 2D, matrix, Duplicate definition, 2 次元, 二次元;
    - a new example "Two-dimensional array" (a small table filled with nested FOR, one value printed).
  - `hubasic.unsupported`:
    - `BIN$` leaves symbols and the HB0302 list;
    - HB0303 becomes "arrays with three or more dimensions", syntax `10 DIM A(2,2,2)`.
  - `hubasic.diagnostics`:
    - symbols gain HB0305, HB0309, HB0314;
    - the HB03xx line becomes: unsupported (statement HB0301, function HB0302, 3-D or more array HB0303, array used both 1-D and 2-D HB0314); HB0305 array bound or size too large; HB0309 static data over dataBudget; HB0312 does not fit in memory;
    - a note on the hints, by case as in the arrays entry (R1-F1): HB0305 for a too-large explicit string-array `DIM` suggests `--string-len` without a number; HB0305 for an undimensioned 2-D string array names 134; HB0309 names `--string-len N` only when shortening strings would fit (the analyzer-time value may need a little lower). In X1Pen, set stringLen to N (Options 「文字列の長さの上限」, `x1pen_set_hubasic_options {"patch":{"stringLen":N}}`). A string longer than N then stops with String too long;
  - `hubasic.x1pen.run`:
    - the stringLen syntax line gains "lower it when HB0305 or HB0309 suggests --string-len (HB0309 and the undimensioned 2-D case name a value)";
    - a note: the stringLen option is hubasic2sl's `--string-len`. Lowering it shrinks every string variable and string-array element to N+1 bytes, frees static data and raises the string-array bound. Programs whose strings stay shorter than N run the same;
    - aliases gain string-len, --string-len, string length, 文字列の長さ.
  - `hubasic.values.types`: the stringLen note gains "lowering it saves memory (hubasic.x1pen.run)".
  - `hubasic.differences`, two notes:
    - Arrays: a 2-D array used before its `DIM` is bounded per dimension by min(10, DIM bound) (`A(3,0)` before `DIM A(2,20)` is Subscript out of range; HuBASIC allows it). Three or more dimensions are unsupported.
    - An in-place `MIRROR$` inside an assignment target's subscript is evaluated once, left to right; HuBASIC seems to evaluate the target subscript twice. This applies to 1-D arrays too. This goes in the existing Strings note.
  - `hubasic.keywords.catalog`: `BIN$` moves from "reserved, not supported" to "functions" (after HEX$).
  - Every other entry is re-read against the ff3cf7e diff. `data.read`, `pcg.defchr` and `functions.mirror` mention arrays; any wording that says "one-dimensional" is fixed.
- `mcp/reference/manifest.json`: the HuBASIC profile `runtimeRevision` and `sourceUrls` move to ff3cf7e. `referenceVersion` becomes `2026-10-31` (the date, as the d15d32e plan's rule says; not a version bump).
- `tests/x1pen_reference_test.mjs`, a new test "HuBASIC BIN$, two-dimensional arrays and the --string-len hints reference matches the bundled converter and runtime":
  - the runtime has `BAS_SBINS` with its "頭の 0 なし" comment;
  - the wasm (UTF-16) contains `HB0314`, "3 次元以上の配列は未対応です" and "--string-len";
  - `hubasic.functions.string` names BIN$, "101" and "no leading zeros";
  - `hubasic.values.arrays` names HB0303, HB0314, 11×11 and 134;
  - `hubasic.x1pen.run` and `hubasic.diagnostics` name `--string-len` and stringLen;
  - the wasm contains both hint texts: the generic "--string-len で 1 本を短くすると上限が増えます" (no number) and the numbered "以下にすると収まります"; the arrays and diagnostics entries say that the explicit-DIM HB0305 hint has no number (R1-F1);
  - the catalog has BIN$ under functions;
  - searches: `BIN$` ranks `hubasic.functions.string` first; `two-dimensional array` and `2 次元` rank `hubasic.values.arrays` first; `--string-len` ranks `hubasic.x1pen.run` or `hubasic.diagnostics` first.
- `tests/x1pen_automation_test.mjs`:
  - the unsupported-word test: drop the `BIN$` row; `DIM A(2,2)` becomes `DIM A(2,2,2)` (HB0303);
  - a new E2E test "HuBASIC BIN$, two-dimensional arrays and the --string-len hints behave as the reference says":
    - Run a program that prints BIN$ results with markers: BIN$(5), BIN$(0), BIN$(-1), LEN(BIN$(-1)), the padded 8-digit form. It fills `DIM T%(2,3)` and prints T%(2,3) and a sum. It sets and reads an undimensioned `B(10,10)`. Read text VRAM for the expected strings.
    - Run a program that uses `A%(0,4)` after `DIM A%(2,3)` and check that it stops with Subscript out of range. Its display is matched as the existing runtime-error tests do.
    - Validate:
      - `DIM A(1,1,1)`: HB0303;
      - `A(1)=1:A(1,2)=2`: HB0314;
      - undimensioned `A$(1,1)="X"`: HB0305, and the message names 134;
      - explicit `DIM A$(64)`: HB0305 with the generic `--string-len` suggestion and no number in it; `DIM A%(8192)`: HB0305 without any `--string-len` text (R1-F1);
      - with stringLen 134 the same program validates;
      - `DIM A$(63),B$(63)`: HB0309, and the message names `--string-len N`; with stringLen N it validates.
    - The test restores the HuBASIC options (null patch) in `finally`.
- `docs/X1PEN.md`: the options table's 「文字列の長さの上限」 row gains (R1-F1, worded by case): "文字列の配列が大きすぎる（HB0305）・静的データが収まらない（HB0309）ときに下げると収まることがあります。エラーの文が `--string-len` を勧めます（HB0309 と、DIM なしの文字列の 2 次元の配列では、収まる値も書きます）".
- `CHANGELOG.md` `## Unreleased`:
  - a bullet for the bundle: BIN$ (no leading zeros, 16-bit), 2-D arrays (11×11 without DIM, 3-D unsupported), HB0314, the `--string-len` hints, existing programs unchanged;
  - a bullet for the reference.
- `plans/`: this plan, archived into the PR.

## Implementation steps

1. Branch `feat/hubasic-ff3cf7e` from main `47ae94f` (done).
2. `node scripts/import-hubasic-bundle.mjs <scratch bundle-ff3>`. Check `git status`: the old dir is removed, the new dir added, and `current.json` and the fixtures changed.
3. `./build.sh`, then the full `npm test`. Only the reference stamp tests and the two stale unsupported-word rows should fail. Any other failure is investigated and recorded here before changing anything.
4. Probe in X1Pen with a scratchpad script on the preview server:
   - BIN$ outputs, including the float, 65535 and >65535 argument rules;
   - 2-D fill and read; 11×11 without DIM; per-dimension Subscript out of range;
   - the HB0303, HB0314, HB0305 (134) and HB0309 messages, and that the hinted stringLen makes them validate and run;
   - a 1-D program still converts to the same output.
   Record the results under "Implementation notes".
5. Update the generator per Change scope, regenerate `hubasic.json`, update `manifest.json`.
6. Update the tests; add the new ones; update CHANGELOG and `docs/X1PEN.md`.
7. `./build.sh`, the full `npm test`, mutation checks, commit.
8. Implementation review (must pass), then one PR. Do not merge.
9. Restart the preview server on the PR head's `dist/` and report.

## Edge cases and test plan

- Bundle integrity: the importer checks every sha256 and refuses a dirty bundle. `npm run test:hubasic` compares X1Pen's in-browser compile and assemble of the 4 testdata programs with the regenerated fixtures.
- Existing HuBASIC E2E and reference-example tests catch behaviour changes in what X1Pen already does. slang says existing programs convert identically, so only tests asserting the old errors should change.
- BIN$ edge cases in the E2E test and probe:
  - 0 gives "0", not an empty string;
  - -1 gives 16 digits;
  - -32768 gives 1 then 15 zeros;
  - the float argument rule is checked in the probe; the reference states only what the probe confirms.
- 2-D arrays:
  - each subscript is bounded on its own, not the flat index;
  - DIM-less 11×11 (B(10,10) works; B(11,0) is Subscript out of range);
  - mixed rank is HB0314 for both use orders (DIM 1-D then 2-D use; 2-D use then 1-D use);
  - a string 2-D array without DIM is HB0305 with 134, and validates at stringLen 134.
- `--string-len` hint: the HB0309 value N must make the same program validate when set as stringLen. A test that only checked the message could pass on a wrong number; this one does not.
- Options isolation: the E2E test changes stringLen and restores it in `finally`, so later tests see the defaults.
- Reference tests:
  - stamp;
  - catalog: BIN$ is in the functions group, so it must be in a dedicated entry's symbols (functions.string);
  - search ranking;
  - every example converts and runs, including the new BIN$ and 2-D examples.
- Mutation checks:
  - the new reference test fails if "no leading zeros" is removed from the string entry, or HB0314 from the arrays entry;
  - the new E2E test fails if the expected BIN$(5) is changed to "0000000000000101";
  - the HB0309 check fails if the test sets stringLen to N+1 instead of N (expected to still give HB0309). Run in step 7 if the boundary is exact; otherwise recorded.
- Rollback: revert the PR commit; bundle, fixtures, reference and manifest return together.
- MCP compatibility: published x1pen-mcp 2.11.0 pins d15d32e. After this merges, main mismatches it (advisory `compatible: false`) until the next release bumps both together, as with PRs #145 and the d15d32e PR.

## Open decisions

- None blocking. Version bump and publishing come after the merge, as Secretary said.
- No real X1 to compare against. Behaviour is checked against slang's docs and sources and X1Pen runs. Where the docs say "HuBASIC と同じく" (BIN$), the reference repeats that claim as slang's, without the manual.

## Implementation notes

- Step 2: the importer replaced the bundle. Among the fixtures, only `expected.json` changed, and only its revision; the 4 testdata bins are byte-identical, as slang reported.
- Step 3: after the import, the only failure in the full `npm test` was the stamp test in the MCP suite. `npm test` stops at the first failing suite. The two stale unsupported-word rows (`BIN$` HB0302, `DIM A(2,2)` HB0303) were fixed together with the new tests.
- Step 4, the probe in X1Pen (preview server, `hb-ff3.mjs` in the scratchpad), matches the docs:
  - BIN$:
    - 5 gives `101`, 0 gives `0`, -1 gives sixteen `1`s (LEN 16);
    - -32768 gives `1` followed by 15 zeros, and 65535 gives sixteen `1`s;
    - `BIN$(2.6)` is `11` and `BIN$(2.4)` is `10` (rounded, as `HEX$(2.6)` is `3`); `BIN$(-2.6)` is `1111111111111101`;
    - `BIN$(65536)` stops with `Overflow in 20`;
    - `BIN$("A")` is HB0404 and `BIN$(1,2)` is HB0212;
    - `RIGHT$("0000000"+BIN$(5),8)` is `00000101`.
  - 2-D arrays:
    - `DIM T%(2,3)` fill and read work (T%(2,3)=23, sum 138);
    - undimensioned `B(10,10)` works, and `B(11,0)` and `B(0,11)` stop with Subscript out of range;
    - after `DIM A%(2,3)`, `A%(0,4)` stops with Subscript out of range;
    - `A(3,0)` before `DIM A(2,20)` stops with Subscript out of range (the documented difference).
  - Diagnostics:
    - `DIM A(1,1,1)` and `A(1,1,1)=1` give HB0303 "3 次元以上の配列は未対応です (2 次元までです)";
    - HB0314 comes in all three orders (1-D use then 2-D, `DIM A(5)` then 2-D, 2-D then 1-D);
    - `A`, `A%(1,2)` and `A$` in one program are separate arrays and convert.
  - Hints (R1-F1 confirmed):
    - `DIM A$(64)` and `DIM A$(8,8)` give HB0305 with the generic "(文字列の配列は --string-len で 1 本を短くすると上限が増えます)" and no number;
    - `DIM A%(8192)` and `DIM A%(90,90)` give HB0305 with no hint. Two `DIM`s merging to (100,100) give HB0305 for the merged size;
    - undimensioned `A$(1,1)` gives HB0305 naming 134 (it validates at stringLen 134 and fails at 135). At the default length the same program also gets HB0309, which names 202;
    - `DIM A$(63),B$(63)` gives HB0309 naming 190. It validates at 190 and fails at 191, so the hint is exact here;
    - integer-only overflow (`DIM A%(8000),B%(8000)`) gives HB0309 with no hint.
- Validate diagnostics read `error HBxxxx (BASIC n): …`, but a diagnostic without a program line (HB0309) reads `error HB0309: …`. The E2E matcher accepts both.
- Search ranking: `HB0314` ties between `hubasic.diagnostics` and `hubasic.values.arrays`, and `--string-len` ranks `hubasic.diagnostics` first, then `hubasic.x1pen.run`. The test requires both entries in the top two for these, and the arrays/strings entry first for `BIN$`, `binary digits`, `two-dimensional array` and `2 次元`.
- `BIN$` in the reference: its summary leads with the no-leading-zeros rule, its syntax shows padding to 8 and to 16 digits, and an example prints `BIN$(5)`, `BIN$(0)`, `BIN$(-1)` and the padded form.

- Step 7: the full `npm test` passed: 13 suites, 315 tests (MCP 112, automation 80).
- Mutation checks, all run, and each fails as expected:
  - removing "WITHOUT leading zeros" from the string entry fails the new reference test;
  - removing HB0314 from the arrays note fails it too;
  - expecting `B5=0000000000000101` fails the new E2E test (TimeoutError waiting for the text).
  - The HB0309 boundary is part of the test itself: the hinted N validates and N+1 fails.

## Cross-review反映

### Round 1 — codex / gpt-6-astra/high
- Verdict: NEEDS_WORK (model=NEEDS_WORK; policy=strict; host_override=no)
- Implementation: READY AFTER FIXES (R1-F1) (next_action=fix_then_implement; reviewer=READY_AFTER_FIXES)
- [adopted][medium] R1-F1 The documentation overpromised numeric stringLen hints: only the undimensioned 2-D string array (134) and HB0309 (conditional, analyzer estimate may need lower) give a number; an explicit oversized string-array DIM gives a generic suggestion; non-string cases none → Change scope (`hubasic.values.arrays` notes, `hubasic.diagnostics` note, `hubasic.x1pen.run` syntax, `docs/X1PEN.md`), the reference test (both hint texts, the no-number wording) and the E2E validate cases (`DIM A$(64)`, `DIM A%(8192)`).

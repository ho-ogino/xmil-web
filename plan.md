# X1Pen Hu-BASIC, step 1: write Hu-BASIC in a plain tab, Run converts, compiles and boots it from a disk image

## Purpose

Give X1Pen (the browser IDE in this repo, `html/x1pen.html` + `html/x1pen.js`) a fourth source tab, **Hu-BASIC**. Pressing Run on a Hu-BASIC program must:

1. convert it to SLANG with **hubasic2sl** (C#, from the SLANG-compiler repo), running **in the browser as .NET browser-wasm**;
2. compile that SLANG with X1Pen's existing **JS SLANG compiler** (`html/x1pen_slang_compiler.js`) for the **x1native_slfs** environment (no OS, ORG $1000);
3. assemble it with X1Pen's existing **JS Z80 assembler** (`html/x1pen_z80asm.js`), after fixing three AILZ80ASM incompatibilities;
4. check that the work area ends at or below $FFE0;
5. build an **SLFS D88 disk image** in JS;
6. insert it in FDD0 as a temporary disk and **cold-boot** the emulated X1 through IPL. Today's LSX-Dodgers state-load path is not used for Hu-BASIC.

Background and decisions already taken (owner, 2026-10-27):
- Use .NET wasm for hubasic2sl. A JS port is rejected because it would drift; X1Pen's SLANG JS port is already 384 commits behind its C# source.
- Proceed in order. Step 1 is "convert and boot" only. The Hu-BASIC editor (X1 Byte Editor), the PCG editor (defchrtool) and Share come later.
- The owner delegated detailed choices ("use the recommended way") but wants to be asked about big forks. Those are listed under Open decisions.
- The **slang Province** owns a parallel PR in SLANG-compiler. It adds the wasm entry project and a publishable **bundle**: the wasm `_framework`, the x1native_slfs runtime `.asm` set and a manifest, all from **one SLANG-compiler SHA**. This repo only copies that bundle in. Building xmil-web never needs dotnet.

Non-goals (step 1):
- The byte-preserving Hu-BASIC editor, X1 graphic-character input and PCG editor integration.
- Share, i.e. `functions/api/share.js` and the share URL. Share refuses Hu-BASIC with a clear message.
- MCP server (`mcp/`) support for the new source mode. This is a fork; see Open decision D2.
- Updating the existing LSX-Dodgers SLANG runtime (`assets/slang_runtime/`) or the JS SLANG compiler to the current C# version. The one exception is in Open decision D4.
- Tape output, and SLFS assets (`FS_READ_BY_ID`).
- Production deploy, version bump or npm publish. The owner does those from a Mac.

## Observed evidence

Feasibility study, with experiments and screenshots: `/home/ogino/secretary/whiteboards/xmilweb/hubasic-feasibility/README.md` (addenda 1–6). The slang Province independently confirmed the main points.

**hubasic2sl** (SLANG-compiler `src/SLANGCompiler.HuBasic`, about 5,000 lines of C#):
- No project references. Its only NuGet dependency is System.Text.Encoding.CodePages, used for Shift-JIS input.
- The pure entry point is `HuTranspiler.Transpile(string, options)`, which takes text and returns SLANG text.
- `TranspileFile(path, encoding, options)` does input-encoding detection: UTF-8, Shift-JIS or raw X1 codes, with warning HB0110.
- slang published a throwaway browser-wasm build. It was 5.5 MB raw, 1.7 MB brotli, and produced output identical to the CLI for 4 programs, including Shift-JIS input.
- Its generated SLANG only calls `BAS_*` routines in `runtime/libx1_basic.asm` (about 7,700 lines). Converter and runtime must come from the same SHA. A mismatch either fails at assembly (unknown `BAS_x`), fails at compile (argument count), or **silently** changes behaviour when only the routine's contract changed.

**JS SLANG compiler**: `window.X1PenSlangCompiler.compile(source, virtualFS, env)`.
- `env = { defaultOrg, codeReadonly, defines }`.
- It loads **every** `.asm` in `virtualFS` as runtime (RuntimeManager) and links only the routines that are used.
- Its header comment says "C# source snapshot … @ c9e8f53". `getAutomationStatus().languageProfiles.slang.compilerRevision` is `c9e8f5315d8d44a413368045d78439a4ec8da3fc`.
- Today the SLANG tab passes `{ defaultOrg: 0x100, defines: { ENV_TYPE: 1 } }` and a VFS built in `ensureSlangToolchain()` from `slang_runtime/*.asm`, which is the LSX-Dodgers set.
- Experiment: hubasic2sl output compiled with the current x1native runtime gave assembly identical to `slangc`, apart from label numbering and work-area order. slang confirmed this for 4 programs.

**JS Z80 assembler**: `window.X1PenZ80Asm.assemble(source, predefinedSymbols)` returns `{ bytes, org, symbols, errors:[{line,msg}] }`.
- It is two-pass and was written for X1Pen (first commit 8cfcbc0, 2026-03-17).
- With the full x1native runtime (346 disk / 358 tape routines, checked by slang), exactly three gaps were found:
  1. **Local label before any global label** (`.init_crtc:` at the top of `libx1native_base.asm`). `resolveLocalLabel()` deliberately reports `Local label "…" without preceding global label` (commit e777f95).
  2. **Character literal `','`**. `splitOperands()` tracks only `"` strings, so `CP ','` is split on the comma (4–9 sites in `libx1_basic.asm`).
  3. **`#if exists LABEL`**. The `#IF` preprocessor in `assemble()` evaluates conditions with `ppSymbols`, which holds only predefined symbols and EQUs, before labels are collected. `exists label` is therefore **always false**, silently producing 3 different bytes (2 sites in `libfloat.asm`, `#if exists return_CDE`).
- Already supported: MACRO/ENDM, `ALIGN 256`, `#IF/#ELIF/#ELSE/#ENDIF`, `$+n` and namespaced labels.
- An error in pass 2 drops that instruction's bytes but keeps pass-1 addresses, so one error cascades into later `JR`/`DJNZ` range errors. **Never use a binary that had any error, and compare only the first error.** `performRun` already aborts on `asmResult.errors.length > 0` and shows `errors[0]`.
- `tests/z80asm_test.js` (343 cases, all passing) exists but is **not** in `npm test`.

**Equivalence evidence**:
- I built MUSIC with the JS toolchain and the current x1native runtime. It was byte-identical to slangbuild's `PROG.bin` (2,845 bytes) except for 86 words, all of which resolve to the same work-area symbol at a different offset.
- slang booted JS-built HELLO/GRAPH/MUSIC on an emulator. The screens at frames 600 and 1500 and the PSG write sequence matched the slangbuild builds.
- Work-area order is irrelevant. There is no `@works_align` and no cross-block `label+n`. The IM2 vectors are fixed at $FFE0–$FFFF, outside the work area, and `_CTCVEC` is just a pointer.

**x1native constants that must be right**:
- Assembler predefined `OS_TYPE=4`, `ENV_TYPE=1`. `libx1_base`/`libx1_psg` branch on `#IF NAME_SPACE_DEFAULT.OS_TYPE == 4`, so a wrong value **silently** produces LSX-Dodgers code.
- Compiler defines `X1NATIVE=1`, `SLFS=1`.
- `default_org` $1000, stack $0FFE (set by the runtime), work-area limit $FFE0.
- **Never mix LSX-Dodgers and x1native runtime files in one VFS.** Same-named routines exist in both, e.g. `sGETKY` in `liblsx_base` and in `libx1native_input`.
- The env file `runtime/env/x1native_slfs.env` lists 17 libraries: runtime, libfloat, libx1native_base/input/print, libx1_base/pcg/grp/magic/sgl/psg, libx1native_slfs, libcompress, libsoroban, libx1_arkos, libx1_banjo, libx1_basic. core.asm and opt.asm are also included the same way the LSX set includes them; confirm against the manifest.

**SLFS D88 format** (SLANG-compiler `src/SLANGCompiler.SlfsPack`: D88Writer.cs, SlfsBootHeader.cs, SlfsSuperblock.cs, SlfsPackerLibrary.cs; checked against a slangbuild `PROG.d88`):
- 2D geometry: 40 cylinders × 2 heads × 16 sectors × 256 bytes; total 348,848 bytes.
- D88 header: name at +0, media type +0x1B = 0x00, size +0x1C. Each sector has a 16-byte header: C, H, R (1-based), N=1, sector count at +4, size at +0x0E.
- Logical sector 0 holds the 32-byte Hu-BASIC IPL header:
  - +00 flag $01;
  - +01 name, 13 bytes, space-padded (default "SLFSMAIN");
  - +0E "Sys"; +11 $20;
  - +12 size, +14 load $1000, +16 exec $1000 (each LE16);
  - +18 date, 5 zero bytes;
  - +1D disk byte offset as LE24 (= 0x000300 for sector 3).
- Sector 1 is the superblock: "SLFS", version 1, geometry, directory/data/save positions, volume name ("SLFS DEMO" in the reference). Sector 2 is the directory. The program starts at sector 3, followed by a 64-sector save area.
- The output is deterministic (no timestamps), so byte-identical comparison with slangbuild is possible. The IPL reads only sector 0 and the program body.

**Cold boot already exists** (the owner corrected my earlier claim that it didn't):
- v0.9.0 "project disk" (`docs/RELEASE_NOTES_0.9.0.md`).
- `html/x1pen.js` `performRun()`, in the `mountedProjectSelection` branch, calls `window.XmilControls.coldPowerOnProjectDisk(model, otherSlots)` in `html/pre.js` (line ~1219). That function:
  1. sets the model (`_js_set_rom_type`), DIP and FM switch;
  2. calls `_js_xmil_power_off()` then `_js_xmil_power_on()`;
  3. verifies the other slots;
  4. sets `isRunning` and updates the power button.
  It throws `projectDiskFailure(...)` errors.
- `XmilControls.mountTempDisk(arrayBuffer, 'drive0')` (`html/pre.js` ~4143) already mounts the LSX `PROG.COM` disk.
- With no IPL ROM registered, the built-in IPL boots: `DEFROM` in `src/DEFFNT.CPP`, "X1EMU IPL version 1.01".
- **Experiment**: on today's `dist/`, calling just `mountTempDisk(slangbuild PROG.d88)` then `coldPowerOnProjectDisk(model, {})` booted MUSIC and a 29 KB game on the built-in IPL. They printed and drew PCG graphics. Script: `…/hubasic-feasibility/experiment/boot-d88.mjs`; screenshots in `…/shots/`.

**Program model / automation coupling**:
- `getAutomationProgram()` returns `{basic, asm, slang, sourceMode, revision, revisionEpoch, instanceId}`.
- `inferSourceMode(basic, asm, slang)` returns 'slang' if slang is non-empty, else 'asm' if basic is empty and asm is not, else 'basic+asm'.
- `normalizeAutomationProgram()` rejects any other sourceMode. It **clears the non-selected sources** ("A complete program replaces all editor state so stale sources cannot change run mode").
- Editor sources are kept in localStorage via `persistEditorSource(LS_EDITOR_*)` and `persistEditorSources(basic, asm, slang)`.
- `getAutomationStatus()` reports `sourceMode`, `activeLanguageProfile` and `languageProfiles`.
- The automation `validate()` at ~1850 compiles without running.
- MCP (`mcp/x1pen-server.mjs` `normalizeProgramSnapshot`) **throws** on any sourceMode other than the three, and zod enums list the three. `mcp/x1pen-source-sync.mjs` `AUTHORING_SECTIONS` maps modes to sections. MCP 2.7.x is already published on npm.
- Share builds `meta.sourceMode` in the share handler (~2900).

**Tabs and build**:
- `html/x1pen.html` line ~639 has `<button class="editor-tab" data-tab="basic|asm|slang">`, plus per-tab Import/Manual buttons.
- Editors are created with `window.X1PenEditor.create(container, {language, …})`. Available languages: basic, asm, slang (CodeMirror 6, `src/x1pen_editor.js` → `html/x1pen_editor.bundle.js`).
- `build.sh` copies assets into `dist/` in two blocks (around lines 100 and 195; e.g. `assets/slang_runtime/*.asm` → `dist/slang_runtime/`).
- CSP in `html/x1pen.html` is `script-src 'self' 'wasm-unsafe-eval' blob:; connect-src 'self' blob:; worker-src blob:`.
- `html/_headers` sets security headers; there is no wasm-specific header today.

## Change scope

| File | Responsibility |
|---|---|
| `html/x1pen_z80asm.js` | Fix the 3 gaps. (a) `splitOperands`: treat `'…'` char literals like strings. (b) `#if exists`: while the `#IF` preprocessor walks the lines, record the label names defined on **earlier active lines** (bare and `NS.`-qualified) and let `exists` consult that set as well as the symbols. (Corrected during implementation: see the note under Cross-review反映.) (c) Local label before any global label: accept it when the caller passes `{ allowTopLevelLocalLabels: true }`, resolving it in an empty-global scope consistently for definitions and references. Without the option, today's error remains, so the ASM tab's behaviour does not change. |
| `html/x1pen_hubasic.js` (new) | Lazy loader and pipeline for Hu-BASIC. It loads `hubasic/<sha>/manifest.json` and verifies file sha256s. It loads the wasm through `_framework/dotnet.js` and calls the exported transpile entry. It builds a **separate** x1native VFS from the manifest's runtime list and runs the JS compiler with the manifest's defines/defaultOrg. It runs the assembler with manifest `OS_TYPE`/`ENV_TYPE` and `allowTopLevelLocalLabels`. It checks `__WORKEND__ <= workLimit` and that the program fits from $1000. It returns `{ ok, sl, asm, bin, diagnostics, stage }`. Nothing x1native-specific is hard-coded: the values come from the manifest, with a JS-side whitelist check. |
| `html/x1pen_slfs_disk.js` (new) | `buildSlfsD88(programBytes, { mainName, loadAddr, execAddr, volumeName })` returns an ArrayBuffer. It ports D88Writer, SlfsBootHeader, SlfsSuperblock and the no-asset path of SlfsPackerLibrary. The output must be byte-identical to slangbuild's. |
| `html/pre.js` | Extract the machine part of `coldPowerOnProjectDisk` (model/DIP/FM, power off/on, `isRunning`, power button) into `coldPowerOn(model)` and export it on `XmilControls`. `coldPowerOnProjectDisk` keeps its slot checks and error codes and calls the shared function. |
| `html/x1pen.js` | Add the Hu-BASIC editor and tab, localStorage key and restore. Add sourceMode `'hubasic'` (inference, normalize/clear rules, automation get/set/status/validate, `languageProfiles.hubasic` from the manifest SHA). Add the Run branch: pipeline → `mountTempDisk(drive0)` → `autoRestoreMounts(['drive0'])` → `XmilControls.coldPowerOn(model)`, with `lastRunDetails`/`lastUsedRuntime` set for runMode `'x1native'`. Share refuses Hu-BASIC. The status text names the mode. |
| `html/x1pen.html` | Hu-BASIC tab button and editor container, and `<script>` tags for the two new files (or lazy-load like the SLANG compiler). |
| `assets/hubasic/<sha>/…` (new, copied in) | The slang bundle: `manifest.json`, `_framework/*`, `runtime/*.asm`, and conformance fixtures (see D5). Copied by a script, never edited by hand. |
| `scripts/import-hubasic-bundle.sh` (new) | Copy a bundle from a SLANG-compiler publish directory into `assets/hubasic/<sha>/`, verify the manifest sha256s, and remove the previous SHA directory. |
| `build.sh` | Copy `assets/hubasic/` to `dist/hubasic/` in both copy blocks. |
| `html/_headers` | `Cache-Control: public, max-age=31536000, immutable` for `/hubasic/*`. The directory is SHA-named, so this is safe. |
| `package.json` | Add `test:z80asm` (existing suite) and `test:hubasic` to `npm test`. |
| `tests/z80asm_test.js` | New cases for the 3 fixes, plus a check that the default still errors on top-level local labels. |
| `tests/hubasic_toolchain_test.mjs` (new, Node) | Conformance tests against the bundle fixtures (see Test plan). |
| `tests/x1pen_automation_test.mjs` | E2E for Hu-BASIC Run, Validate, setProgram clearing, persistence and Share refusal. |
| `docs/X1PEN.md`, `CHANGELOG.md` (Unreleased) | User-facing notes and limits. |

## Implementation steps

1. **Assembler fixes** (no dependency on the bundle):
   - (a) Char literals in `splitOperands`. Make sure `''''` and `'"'` still work, and add a test for each.
   - (b) `#if exists` sees labels defined on earlier active lines (sequential). This is the rule `libfloat.asm` depends on: `f24add` and `f24mul` each contain `#if exists return_CDE / jp … / #else … return_CDE: … #endif`, so the first routine defines the label and the second jumps to it. A "defined anywhere" rule would make both true and leave `return_CDE` undefined. Verified against AILZ80ASM with the fixture bins in step 6.
   - (c) `allowTopLevelLocalLabels` option.
   - Add z80asm cases and wire `test:z80asm` into `npm test`.
2. **SLFS D88 builder**: write `html/x1pen_slfs_disk.js` as a UMD/IIFE that is usable from Node tests like `x1pen_z80asm.js`. Unit-test the header bytes and the total size.
3. **Cold power-on extraction** in `pre.js`. Project-disk behaviour must stay identical: same error codes, and the slot checks still run after power-on.
4. **Bundle contract and import script**. Agree the manifest schema with slang via Secretary (a draft has already been sent):
   - `slangCompilerSha` and `hubasic2slVersion`;
   - `files[{path, sha256}]`;
   - `env{ name:"x1native_slfs", libraries[], defines{X1NATIVE,SLFS}, defaultOrg, osType, envType, workLimit, diskMainName, volumeName }`;
   - `entry{ module, export }`;
   - optional `abi` (`BAS_ABI_n`);
   - `fixtures[]`.
   Write `scripts/import-hubasic-bundle.sh`.
5. **`html/x1pen_hubasic.js`**. Load the manifest, check it against the whitelist (`osType===4`, `envType===1`, `defines.X1NATIVE===1`, `defines.SLFS===1`, `defaultOrg===0x1000`, `workLimit<=0xFFE0`; otherwise refuse) and verify sha256 with `crypto.subtle`. Then:
   - Load the wasm on first use only. Transpile UTF-8 bytes of the editor text, with `input-encoding utf8`.
   - Build the x1native VFS from `env.libraries` only.
   - Compile, then assemble with `allowTopLevelLocalLabels`, stopping on the **first** error.
   - Check size: `__WORKEND__` from the assembler symbols must be `<= workLimit`, and the bin must not run past it.
   - Return structured diagnostics (stage `transpile|compile|assemble|size`; HB code, line/column and BASIC line when the converter gives them).
6. **Conformance test (Node)**. For each fixture (HELLO/GRAPH/MUSIC, plus a required FLOAT constant-expression program per D4; `.BAS` + slangbuild `.SL`/`.bin`/`.d88` from the bundle SHA):
   - run the JS compile + assemble on the fixture `.SL` with the bundle runtime;
   - require **zero errors**;
   - require the bin to equal the reference except for words that resolve, through the reference LST/symbols and the JS symbol table, to the same work-area symbol (the method from `symcheck.py`);
   - require `buildSlfsD88(referenceBin)` to be **byte-identical** to the reference `.d88`.
   The wasm transpile itself is covered in E2E, because Node loading of the browser-wasm build is not guaranteed.
7. **UI and Run branch in `x1pen.js`/`x1pen.html`**: tab, editor (CodeMirror `basic` highlighting for now), persistence, sourceMode `'hubasic'`, automation get/set/validate/status, Run branch, Share refusal and status messages.
8. **build.sh, `_headers`, docs, CHANGELOG**.
9. **Import the real bundle** once slang's PR is merged. Run `./build.sh`, the full `npm test`, and a manual check over the SSH tunnel preview.
10. Implementation review (codex), fixes, one PR. The owner merges. No deploy.

## Edge cases and test plan

**Failure handling (no partial run)**:
- Any stage failure stops Run before the disk is touched. Shown in the status line: `Hu-BASIC: <stage>: <first message>`. `lastRunDetails.code` is one of `HUBASIC_TRANSPILE_FAILED`, `HUBASIC_COMPILE_FAILED`, `HUBASIC_ASSEMBLE_FAILED`, `HUBASIC_TOO_LARGE` or `HUBASIC_TOOLCHAIN_UNAVAILABLE`, plus the stage.
- Bundle missing, sha256 mismatch, manifest outside the whitelist, or wasm fails to start under CSP: `HUBASIC_TOOLCHAIN_UNAVAILABLE`. Other tabs keep working. The loader is lazy, so non-Hu-BASIC users never download the 1.7 MB.
- Converter warnings do not stop Run. They are shown alongside the run status.
- `__WORKEND__` above the limit, or the bin overlapping $FFE0: `HUBASIC_TOO_LARGE`, with the sizes shown.

**Failures after the disk is touched** (R1-F1). The Run sequence after a successful build is: (1) `mountTempDisk(d88,'drive0')`, (2) `autoRestoreMounts(['drive0'])`, (3) `XmilControls.coldPowerOn(model)`. Rules:
- Each step is awaited inside one try/catch in the Hu-BASIC branch. `lastUsedRuntime`, `lastRunWasShared` and a success `lastRunDetails` are assigned **only after step 3 returns**. A failure never records a successful run.
- (1) fails: FDD0 may be half-switched. Call `autoRestoreMounts([])` as best effort, which re-applies every saved library mount including FDD0's previous one. Report `HUBASIC_MOUNT_FAILED` with `{ restored: true|false }`. The emulator is not powered off; it stays in whatever state it was before Run.
- (2) fails: FDD0 holds the temporary disk and other slots may be stale. Do not power on. Call `autoRestoreMounts([])` as best effort and report `HUBASIC_MOUNT_RESTORE_FAILED` with `{ restored }`.
- (3) fails or throws partway: call `module._js_xmil_stop()` if present, set `isRunning=false` and update the power button. This mirrors the existing slot-mismatch path in `coldPowerOnProjectDisk`, so the machine is in a defined **stopped** state. Report `HUBASIC_BOOT_FAILED`. The temporary disk stays in FDD0 so the user can inspect or retry, and a later normal Run re-mounts as usual.
- In every case the run-admission token is released through the existing `performRun` exit path, so the next Run is accepted.
- Tests (Playwright): override `XmilControls.mountTempDisk`, `autoRestoreMounts` and `coldPowerOn` in the page to throw, one at a time, then assert: the error code and status text; no success `lastRunDetails`; `lastUsedRuntime` unchanged; a pre-mounted FDD1 library disk is still mounted afterwards; for case (3), the emulator reports not running; and a following Run with the overrides removed succeeds.

**State**:
- FDD0 gets a temporary disk, the same as an LSX Run today. FDD1 and other slots are restored with `autoRestoreMounts(['drive0'])`.
- A mounted library **project disk** in FDD0 is not modified. The Hu-BASIC Run replaces the FDD0 mount with the temporary disk, the same way an LSX Run does when no project disk is selected. Open decision D3 covers whether to refuse instead.
- Cold boot clears RAM/VRAM/PCG. The status says so on the first Hu-BASIC Run, matching the project-disk confirmation wording.
- Run re-entrancy: the Hu-BASIC branch lives inside `performRun(token)` and keeps the existing run-admission token checks. A second Run during the async wasm load is rejected like any pending Run (`isRunSetupPending`).

**Source mode**:
- `setProgram({sourceMode:'slang', …})` clears the hubasic source and `setProgram({sourceMode:'hubasic', hubasic})` clears the others, preserving the "stale sources cannot change run mode" rule.
- Programs without a `hubasic` field behave as today.
- Inference order is in D1.

**Rollback**:
- Everything is additive. Removing the tab and Run branch restores today's behaviour.
- The assembler fixes are unit-tested, and the top-level-local-label change sits behind an option.
- The bundle sits in a SHA directory, so reverting means re-importing the previous SHA.

**Tests**:
- `node tests/z80asm_test.js` (now in `npm test`): `CP ','` = FE 2C; `LD A,','`; `DB ','`; quotes inside char literals; `#if exists L` true for both a later and an earlier label `L`; `#if exists` false for an undefined name; namespaced `exists`; a top-level local label is an error by default and resolves with the option; existing 343 cases still pass.
- `tests/hubasic_toolchain_test.mjs`: the per-fixture conformance described in step 6; the D88 header bytes and size; a manifest whitelist rejection case (OS_TYPE 0 refused); a VFS-isolation check that no `liblsx_*` file is present in the x1native VFS; and assembling with the wrong OS_TYPE yields different bytes, proving the guard matters.
- `tests/x1pen_automation_test.mjs` (Playwright, real `dist/`):
  1. `setProgram({sourceMode:'hubasic', hubasic:'10 PRINT "HELLO"\n20 GOTO 20'})` → `run()` → the screen shows HELLO within N frames (`captureScreen` + text VRAM read through the debugger API);
  2. a syntax error gives `HUBASIC_TRANSPILE_FAILED` with the BASIC line;
  3. `validate()` on Hu-BASIC returns ok without running;
  4. setProgram to SLANG clears Hu-BASIC, and the reverse;
  5. the Hu-BASIC source persists across reload;
  6. Share refuses Hu-BASIC;
  7. existing SLANG and BASIC tests are unchanged and still pass.
- Manual check: the MUSIC sample plays, with sound, over the SSH tunnel preview; and the fixture programs from the slang lab (game) boot on both the built-in IPL and the X1 model.

## Open decisions

- **D1 — which source runs when several tabs have content.** Today it is content-based: SLANG wins over BASIC. **Recommendation:** put `hubasic` first (`hubasic > slang > asm/basic`) and show the active mode in the status line. Automation `setProgram` already clears the other sources, so AI-driven use is unambiguous. Alternative: Run follows the active tab. Rejected because it would change today's BASIC/SLANG behaviour.
- **D2 — MCP: decided by the owner (2026-10-27).** Step 1 is page-side only. MCP (x1pen-mcp) support comes after everything else ("ひととおり全部終わってから落ち着いて"); the npm version bump stays on hold. **Known limit to document** (`docs/X1PEN.md`, `docs/X1PEN_MCP.md`, CHANGELOG): while the active source is Hu-BASIC, the published x1pen-mcp 2.7.x fails closed on `getProgram` with `invalid source mode`; other modes are unaffected.
- **D3 — FDD0 holding a library project disk during a Hu-BASIC Run.** **Recommendation:** temporarily replace the mount, as an LSX Run without a project disk does. The project disk itself is never written. Alternative: refuse and ask the user to eject.
- **D4 — FLOAT constant folding (C# fix 99a8109), decided by R1-F2.** A FLOAT constant-expression fixture (e.g. `A=1.5*2+3/4`, `PRINT 2.5-1`, exercised through hubasic2sl output) is part of the **required** conformance suite, and divergence is **blocking** for this PR. If it diverges, port 99a8109 into `html/x1pen_slang_compiler.js` in this PR. That port also changes the existing SLANG tab, so the existing SLANG automation tests plus a new SLANG FLOAT-constant test must pass. Shipping Hu-BASIC with a known miscompilation is not allowed. If no divergence appears, the fixture stays as a guard and nothing is ported.
- **D5 — bundle contents (requested from slang).** The manifest schema above, plus conformance fixtures (HELLO/GRAPH/MUSIC `.BAS` + slangbuild `.SL`, `.bin`, `.LST` or symbol map, `.d88`) built at the same SHA, plus the optional `BAS_ABI_n` marker. If slang cannot ship fixtures, generate them once with slangbuild on dunedin and commit them under `tests/fixtures/hubasic/<sha>/`.
- **D6 — character input.** Step 1 sends UTF-8 (`input-encoding utf8`). Half-width kana works. X1 graphic characters need the charmap mapping from the later editor step and are rejected with a converter error.
- **D7 — dependency on slang's PR.** This PR cannot pass step 9 until the bundle exists. Steps 1–3 and the test scaffolding go first. If slang's PR changes the entry signature, adapt `x1pen_hubasic.js` only.

## Cross-review反映

### Round 1 — codex / gpt-6-astra/high
- Verdict: NEEDS_WORK (model=NEEDS_WORK; policy=strict; host_override=no)
- Implementation: READY AFTER FIXES (R1-F1, R1-F2) (next_action=fix_then_implement; reviewer=READY_AFTER_FIXES)
- [adopted][medium] R1-F1 Define recovery for failures after the disk is replaced (mount, restore, cold boot) → Edge cases: new "Failures after the disk is touched" (per-step handling, codes HUBASIC_MOUNT_FAILED / HUBASIC_MOUNT_RESTORE_FAILED / HUBASIC_BOOT_FAILED, success recorded only after boot, defined stopped state, injected-failure Playwright tests)
- [adopted][medium] R1-F2 Make FLOAT conformance divergence blocking → Open decisions D4 rewritten as decided (FLOAT fixture required; divergence means porting 99a8109 in this PR, with SLANG regression tests)

### Implementation note (not a review round) — `#if exists` semantics corrected
- The plan said "labels defined anywhere, including inactive branches". Reading `libfloat.asm` shows that rule would make both `#if exists return_CDE` sites true and leave the label undefined. AILZ80ASM's behaviour is sequential: true only for labels defined on earlier active lines.
- Implemented the sequential rule. Evidence: HELLO/GRAPH/MUSIC built by the current hubasic2sl + slangbuild (SLANG-compiler cd86f11, prebuilt Release tools) against the JS compiler + fixed JS assembler: same sizes (5364/8250/2845 bytes), every differing word resolves to the same work-area symbol (98/98/86), and `__WORKEND__` equals hubasic2sl's figure ($349C/$4302/$2845).

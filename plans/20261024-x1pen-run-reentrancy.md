# X1Pen Run re-entrancy prevention design

## Purpose

Prevent two Run requests from executing `performRun()` and emitting X1 command keys concurrently. The confirmed user-visible symptom is duplicated/interleaved text such as `rruunn` when the Run button is pressed repeatedly before the first run setup finishes.

This plan covers design and verification only. It does not implement code, commit changes, alter PR #78, or redefine a successful Run as proof that the X1 program has started. The latter requires mode-specific machine-state acknowledgement and remains a separate API design.

The previous `simulateKeys()` work is archived at `plans/20260809-sequential-simulate-keys.md`. It guarantees `down → hold → up → gap` ordering inside one invocation, but deliberately does not serialize separate invocations.

## Observed evidence

### Reproduction status

- UI Run repetition is user-confirmed: pressing Run again before completion produces mixed text such as `rruunn`.
- A live repeat in this session was unavailable because the in-app browser exposed no browser tab. No alternate browser-control backend was substituted. The call-path result below is therefore source-proven rather than a second visual reproduction.
- The same race applies to FuzzyBASIC `RUN` and LSX `PROG`: both paths enter the same unguarded `onRunClick()` / `performRun()` flow and call `simulateRunCommand()` or `simulateProgCommand()` only near the end.

### UI call path and collision layer

- `html/x1pen.js:2992` registers the Run button directly with `elBtnRun.addEventListener('click', onRunClick)`.
- `html/x1pen.js:3004-3008` calls the same function for Ctrl+Enter. It checks `elBtnRun.disabled`, but Run setup never disables the button.
- `html/x1pen.js:706-712` increments `automationActiveRuns` as a counter but performs no check before starting another `performRun()`.
- Each `performRun()` independently compiles/loads state, starts the emulator, waits 500 ms, and then awaits its own `simulateProgCommand()` or `simulateRunCommand()` (`html/x1pen.js:933-962`).
- `simulateKeys()` is sequential only inside one invocation (`html/x1pen.js:597-632`). Two invocations can call the same module `_js_key_down/up` exports concurrently. Thus the fault begins with UI handler multi-fire, creates parallel command-function invocations, and manifests as interleaved `simulateKeys()` calls; it is not an ordering defect inside either individual call.
- Timing after PR #78 is about 600 ms for PROG and 620 ms for RUN, in addition to build/load and the fixed 500 ms pre-injection wait, leaving an easy multi-click window.

### Automation API and MCP behavior

- Direct `window.X1PenAutomation.run()` calls enter `queueAutomationOperation()` (`html/x1pen.js:1960-1973,1989-2008`). Its Promise chain runs one Automation operation at a time. `Promise.all([api.run(), api.run()])` therefore schedules two complete runs sequentially; their key sequences do not interleave, but the second request creates backlog and repeats the run.
- `automationQueuedRuns` is incremented synchronously before queue execution, and `isRunSetupPending()` already reports queued or active Run setup to debugger clients (`html/x1pen.js:1468-1484`).
- MCP `x1pen_run` sends a `run` command through `mcp/x1pen-server.mjs:724-731` and `mcp/x1pen-bridge.mjs:215-238`.
- The Connector can dispatch multiple commands concurrently: `createUpdateCoordinator().run()` counts active work but does not serialize it (`extension/update-coordinator.mjs:28-37`), and each command invokes `invokeX1PenInPage()` independently (`extension/service-worker.js:174-176,233-261`).
- Nevertheless, each page invocation calls `api.run()` (`extension/page-automation.mjs:87-91`), so multiple MCP Run requests ultimately serialize in the page Automation queue. They do not mix with each other, but can accumulate and rerun stale intent.
- A UI Run bypasses `automationOperationQueue`. A direct API/MCP Run that arrives while a UI Run is active can therefore overlap it. Connector interaction locking disables toolbar buttons after an MCP request begins, but it cannot retroactively serialize a UI Run already in progress.

### Stop and physical/screen keyboard relationship

- UI Stop directly emits Escape and schedules key-up 30 ms later (`html/x1pen.js:1046-1053`); it does not participate in either run admission or the Automation queue. It can interleave with a UI-origin Run command sequence.
- Automation/MCP Stop uses `queueAutomationOperation()` (`html/x1pen.js:2010-2014`) and therefore follows an Automation-origin Run. It can still overlap a UI-origin Run because that Run is outside the queue.
- Physical keyboard callbacks are installed on `window` and write the same emulator key state (`platform/platform_input.cpp:151-180,244-250`). They ignore only form-field focus; `inert` and toolbar disabling do not suppress window key events.
- The screen keyboard directly calls `_js_key_down/up` (`html/pre.js:1910-1915`).
- Stop and physical/screen keys are therefore the same low-level collision family, but resolving them requires cancellation and input-arbitration policy beyond Run/Run admission. This plan recommends tracking them as a separate follow-up rather than silently changing Stop or physical-input semantics in the Run fix.

## Change scope

### Proposed implementation scope

- `html/x1pen.js`
  - Add one synchronous, cross-entry Run admission reservation covering UI, Ctrl+Enter, Share auto-run, direct Automation, and MCP-origin Automation.
  - Split admission from execution so an accepted request reserves before the first `await` and releases exactly once in `finally`.
  - Require the live reservation token inside the only function that can invoke `performRun()`; an unowned/stale token must fail before side effects.
  - Disable/mark the Run UI while reserved and restore it without racing the existing Automation interaction lock.
  - Return an additive structured busy result for rejected Automation requests.
- `html/x1pen.html`
  - Add/identify a dedicated aria-live notification region and reserved-state Run styling; the current toolbar has no aria-live region, so the active Run status must remain a distinct element.
- `tests/x1pen_automation_test.mjs`
  - Add deterministic UI, API, mixed-origin, FuzzyBASIC, and LSX concurrency tests using the existing module key spies.
- `extension/page-automation.mjs`, `extension/service-worker.js`, `extension/update-coordinator.mjs`, and extension/bridge tests
  - Pass the Run origin/effective queue bound, preserve admission-failure results, skip `waitMs` only for admission codes, keep status reads outside the operation queue, route atomic stalled recovery, and settle navigation cleanup with balanced lock/coordinator state.
- `mcp/x1pen-server.mjs`, `mcp/x1pen-bridge.mjs`, and MCP/bridge tests
  - Update the model-facing `x1pen_run` contract, derive the queue bound from effective transport timeout, add compatibility-gated `x1pen_recover_stalled`, and define exactly-once `TAB_RELOADED` correlation cleanup. Test ordinary admission content and recovery refusal/acceptance.
- `docs/X1PEN_MCP.md` and, if the page API is documented there, `docs/X1PEN.md`
  - Document concurrent Run as a behavioral compatibility change, bounded retry guidance, feature detection decision, and the unchanged meaning of successful `ok:true`.

### Explicit non-goals

- Do not queue arbitrary UI Run clicks.
- Do not cancel an accepted Run and replace it with the newest request.
- Do not change key timing or `simulateKeys()` internal ordering from PR #78.
- Do not solve UI Stop or physical/screen-key arbitration in the same change.
- Do not change `ok:true` from “build/setup and command-key injection completed” to “the X1 program demonstrably started.”
- Do not bump the Automation API or Connector protocol solely for additive busy fields unless implementation uncovers a consumer that rejects unknown result fields.
- Do not provide a general force-unlock. The only remote recovery added here is a guarded page reload after status proves `stalled` and the caller explicitly confirms the stated data loss.

## Implementation steps

### 1. Compare the candidate policies

| Option | UI protection | Automation/MCP protection | Contract impact | Backlog | UX / maintenance | Decision |
|---|---|---|---|---|---|---|
| A. Disable Run and ignore UI repeats | Yes | No; direct API can overlap an existing UI Run | None for API | None for UI | Simple and natural, but incomplete alone | Adopt as presentation layer only |
| B. Shared re-entrancy guard | Yes | Yes, if reservation happens before Automation queueing | Additive `ok:false` busy result for concurrent programmatic calls | No extra Run backlog; accepted Run may wait bounded time behind unrelated Automation work | Clear ownership and bounded work; moderate state/UI tests | Adopt as core |
| C. Queue every Run | Prevents mixing | Prevents mixing | Existing calls keep resolving, but timing/ordering semantics change | Unbounded unless extra policy is added | Repeated clicks run later, stale programs may execute, cancellation/timeout ownership is complex | Reject |
| D. Abort current and run latest | Yes | Yes | Requires cancellation result and partial-side-effect contract | Bounded | Responsive latest-wins UX, but compilation, state load, disk mount, emulator start, and key cleanup need abort points | Reject for now |

Recommended design: A+B. UI affordances prevent normal double-clicks, while a shared execution-layer reservation closes programmatic clicks, Ctrl+Enter, Share, direct API, MCP, and mixed UI/API races. C remains rejected because solving rejection pollution does not solve stale queued intent or unbounded backlog; coalescing distinct requests would incorrectly claim that the later program ran. D is a separate cancellation project.

### 2. Define one synchronous Run reservation

1. Add module-local Run admission state containing a unique opaque token, normalized origin (`ui | automation | mcp | share`), phase (`reserved | queued | executing | stalled | recovering`), and monotonic timestamps. Tokens never leave the module, appear in status/results/logs, or cross the page API boundary. The admission record is the sole source of truth for Run pending/phase/ownership; retire the two Run counters or derive compatibility fields from this record rather than maintaining parallel mutable state.
2. `tryReserveRun(origin)` performs check-and-set synchronously with no `await`. It returns the opaque token or `null` when another Run is reserved.
3. Place the guarded execution behind one module-private function such as `executeReservedRun(token)`. It validates token ownership once immediately before calling `performRun(token)`. Once phase becomes `executing`, only that owner's `finally` may invalidate/release the token; watchdogs and remote callers cannot do so. Any later ownership check is a defensive assertion that logs but continues cleanup/execution rather than aborting after partial side effects. No entry point may call an unguarded zero-argument `performRun()`.
4. Mandate reserve-to-cleanup adjacency, with zero statements between successful acquisition and the `try`: `const token = tryReserveRun(origin); if (!token) return busyResult(); try { ... } finally { releaseRun(token); }`. Source/revision reads, status changes, and UI refreshes all occur inside the `try`. `releaseRun(token)` ignores stale/non-owner tokens, clears ownership first, and performs fallible UI refresh in a contained `try/catch` so a detached DOM node cannot prevent state cleanup.
5. Distinguish `queued` from `executing` in `getStatus()` through non-sensitive `runAdmission: { pending, origin, phase, ageMs, phaseAgeMs }`, where `ageMs` is total reservation age and `phaseAgeMs` resets on each transition. Keep the existing `capabilities.debugger.runPending` boolean for compatibility.
6. Bound a pre-execution Automation reservation with a direct/page default `RUN_QUEUE_TIMEOUT_MS = 20_000`. For MCP, derive the per-request effective value from the actual bridge setting as `min(20_000, floor(commandTimeoutMs / 4))` (15 seconds under the 60-second default), pass it through the Connector to `run()`, and clamp/validate it page-side. This preserves a 4× transport ratio under lower test/operator settings instead of relying on equal fixed constants. Implement the caller-facing Promise as a race that settles once with `RUN_QUEUE_TIMEOUT`. The queue callback's synchronous first statement atomically changes its live token from `queued` to `executing` before any `await`. The timeout handler releases/settles only if it still owns a `queued` token; if callback entry already won, timeout is a complete no-op and the caller remains pending for normal owner completion (ultimately bounded by the outer bridge timeout). Test both same-task orderings.
7. Start `RUN_STALL_WARNING_MS = 30_000` when the reservation enters `executing`, not when it is created. Do not force-release an `executing` token merely because that watchdog fires: non-cancellable work could later resume and overlap the replacement Run. Change phase to `stalled`, keep the safety gate closed, show the data-loss warning with reported origin in a separate unverified diagnostic line, and expose total/phase age in status. Thirty seconds is more than three times the currently observed cold automation-run duration (about 6–8 seconds); validate and adjust that constant against fresh cold/warm measurements during implementation. With the 20-second direct queue bound, the longest pre-warning hold is about 50 seconds (about 45 seconds for default MCP). Network-only stages should use `AbortController`/bounded fetch timeouts where cancellation is real; non-cooperative storage/emulator awaits must not be unlocked by `Promise.race` alone. If the original owner later completes or rejects before recovery claims the state, its `finally` clears the warning/reservation and restores idle; after `recovering`, navigation owns cleanup and late owner completion cannot reopen admission.
8. `isRunSetupPending()` includes accepted queued/executing/stalled/recovering reservations so debugger controls remain blocked from acceptance through final cleanup or reload.
9. Audit every `automationQueuedRuns` / `automationActiveRuns` consumer, then remove the counters or make them derived read-only compatibility values. This is not a widening of current `runPending`: UI `onRunClick()` already increments `automationActiveRuns`, so UI setup already contributes to the existing boolean. Preserve that boolean's semantics while enriching it with the admission phase/origin object.
10. Expose `runAdmission.phase`, total/phase age, and best-effort origin through the existing `getStatus()` / `x1pen_get_status` path, including after the original MCP Run command has exceeded its bridge timeout. Source audit confirms page `getStatus`, `getProgram`, and `captureScreen` execute synchronously outside `queueAutomationOperation()` and `extension/page-automation.mjs` calls them directly; preserve that bypass. `validate` currently enters the queue and is not an observation/recovery prerequisite: reject it promptly with `RUN_PENDING` rather than claiming it proceeds during an API-origin stall. A gating integration test must hold an MCP-origin Run in the queue and prove a concurrent MCP status call still returns `stalled`.

### 3. Separate UI and Automation entry behavior

1. UI button, Ctrl+Enter, and Share auto-run call wrappers that assign their internal origin labels and attempt reservation before starting asynchronous work. Labels are best-effort diagnostics, not a MAIN-world security boundary: page scripts can dispatch UI events or claim `mcp`, so attribution never changes admission or recovery eligibility. User-visible recovery renders origin separately as “Reported origin (unverified): …”; the actionable data-loss text is byte-identical across origins.
2. When reservation fails, do not invoke `performRun()`, do not enqueue work, and do not overwrite the active Run status. Normal activations should already be ignored by the focusable `aria-disabled` trigger, while this handler-level check remains the correctness boundary.
3. Derive Run-trigger state from the complete reason set in one `refreshRunTriggerState()` function: initial/module readiness, Run reservation, and Automation interaction lock. The source audit found only the initial disabled markup, the module-ready enable write, and the toolbar interaction-lock snapshot writes; implementation must repeat this audit before editing and stop if another reason appears. For a user-origin reservation, keep the focused button focusable and mark it visually/semantically unavailable with `aria-disabled="true"` and `aria-busy="true"`; the guarded handler ignores activation, and CSS treats `[aria-disabled="true"]` as non-hoverable/unavailable. A Connector interaction lock deliberately takes precedence with native `disabled`/`inert` and the existing blur because AI owns the interaction surface during that interval; this accepted focus loss is restored only according to existing lock behavior. Exempt Run from the lock's snapshot/restore loop and call `refreshRunTriggerState()` on lock acquisition/release, ensuring unlock cannot re-enable it while reserved. Sibling controls retain current snapshot behavior.
4. Automation `run(options?)` accepts an additive optional `{ origin }` hint but publicly trusts only `automation | mcp`; Connector/MCP page invocation supplies `mcp`, omitted or unknown values default to `automation`, and `ui | share` can be assigned only by their internal wrappers. The method attempts reservation synchronously before `queueAutomationOperation()`. A rejected request returns immediately and never enters the operation queue.
5. An accepted Automation request captures its token, queues exactly one execution, and releases the token in a finally path even if readiness or the preceding Automation queue rejects.
6. Share auto-run rejection emits a separate non-destructive aria-live notice/toast (“Run already in progress”) that does not replace the active Run status text or enqueue stale Share intent.

### 4. Audit the behavioral compatibility change

1. Enumerate all `onRunClick`, `performRun`, `X1PenAutomation.run`, Connector `run`, and MCP `x1pen_run` call sites and tests before implementation. Current read-only search found UI button, Ctrl+Enter, Share replay, the page Automation method, Connector MAIN-world invocation, MCP tool routing, and individual test calls; it found no repository test or production caller that intentionally overlaps two `run()` calls.
2. Record that concurrent programmatic behavior changes: today two overlapping API/MCP requests execute sequentially; after the gate, the first is admitted and later overlapping requests return busy without running. Sequential `await api.run(); await api.run()` remains unchanged.
3. Update callers that intentionally need two runs to await the first before issuing the second. Update tests to assert the new busy policy rather than the old queue-both behavior.
4. Do not add a feature ID/API version bump: concurrent Run execution was not an advertised capability, existing `ok:false` is already part of the result contract, and sequential success remains compatible. Document the behavior prominently. If implementation discovers a strict schema consumer or an advertised queue-both guarantee, stop and reconsider this decision before coding further.
5. Verify deployment skew explicitly. Current `mcp/x1pen-server.mjs::textResult()` wraps any returned object as ordinary content and does not inspect `value.ok`, so new page + old server still yields `isError:false`; an old extension may retain the historical `waitMs` on busy but does not change the payload. Old page + new extension/server retains queue-both behavior because no admission code is present, and the extension skips `waitMs` only when a new code actually exists. Add both-direction skew tests. The new stalled-recovery command is separate: advertise/check a new `automation.run-recovery` compatibility feature and refuse with update-required guidance when the connected page/Connector lacks it.

### 5. Define additive admission-failure contracts

Concurrent Automation/API/MCP Run returns a normal Run result with:

```json
{
  "ok": false,
  "code": "RUN_IN_PROGRESS",
  "retryable": true,
  "retryAfterMs": 500,
  "activeOrigin": "ui",
  "status": "Run setup is already in progress",
  "sourceMode": "<current source mode>",
  "revision": 123
}
```

- `status` is the existing human-readable field already returned for every current `ok:false` Run result; admission failures must keep it non-empty so naive `if (!result.ok) show(result.status)` consumers continue to work.
- `code` is the only machine-branching key. Do not add a redundant `reason` branch key.
- `revision` means the current editor program revision at the rejected caller's observation time, matching the existing Run result field; it is not a run ID.
- `activeOrigin` is diagnostic only and contains one normalized non-sensitive label. Direct page callers default to `automation`; Connector/MCP explicitly supplies `mcp`. The opaque owner token is never exposed.
- Existing successful result fields and `ok:true` semantics remain unchanged.
- `ok:false` is already a valid Run outcome, so optional `code`, `retryable`, and retry-diagnostic fields are additive. Sequential callers see no change.
- Do not throw for busy: returning a result preserves the current Run-result control flow across the page API, Connector, and MCP tool.
- `extension/page-automation.mjs` skips `waitMs` only for the two admission failures in the table below; successful and historical non-admission outcomes keep their current timing.
- MCP returns either admission-failure payload as ordinary tool content with `isError:false`, because it is an expected application result rather than a transport/tool failure. Tests must assert both `isError:false` and payload `ok:false`.
- No page, extension, bridge, or MCP-server layer retries automatically; each admission failure settles and releases any interaction lock. Only `RUN_IN_PROGRESS` is automatically retryable guidance: begin at the supplied delay, apply capped exponential backoff up to 2 seconds, and stop after a 30-second overall budget. Callers must still handle another admission failure after `runPending` becomes false because admission is inherently racy. A contract harness drives that algorithm against an active Run lasting longer than 1.1 seconds; it validates the guidance, not hidden production retry code. `RUN_QUEUE_TIMEOUT` is not automatically retryable because the unrelated preceding Automation operation has already blocked for 20 seconds; inspect status/operator state instead of immediately enqueueing the same stale intent.
- Keep Automation API version 2 and current feature IDs unless compatibility tests show an existing consumer treats unknown fields as invalid.

Outcome handling is explicit:

| Code | When returned | `retryable` / delay | `waitMs` | MCP mapping | Caller Promise |
|---|---|---|---|---|---|
| `RUN_IN_PROGRESS` | Reservation fails because another Run owns admission | `true`, initial 500 ms | Skip | Ordinary content, `isError:false` | Settles promptly with the result |
| `RUN_QUEUE_TIMEOUT` | An admitted Automation Run does not begin within its effective queue bound (20 seconds direct; 15 seconds under default MCP transport) because it is behind prior Automation work | `false`, no delay field | Skip | Ordinary content, `isError:false` before the outer bridge timeout | Settles only if timeout wins while still `queued`; otherwise owner completion wins |

There is no third public “stale token” outcome. Staleness is an internal ownership check: a queue-timed-out caller has already received `RUN_QUEUE_TIMEOUT`, while a stale/non-owner callback resolves internally without executing or changing the caller-visible result.

### 6. Keep command-start acknowledgement separate

The busy contract answers “was this Run admitted?” Successful `ok:true` continues to answer “did setup and command injection complete?” Determining whether FuzzyBASIC or LSX actually began execution requires different state evidence, timeouts, and error reporting. Combining it here would couple admission control to emulator-specific completion detection and make rollback harder. Track command-start acknowledgement as a separate design/issue.

### 7. Record related input-arbitration follow-up

Create a follow-up design for UI Stop and physical/screen input during synthetic command injection. Candidate policy to evaluate there:

- expose a synthetic-input critical-section flag independent of JoyKey mode/depth;
- defer one Stop request until the current synthetic key is released, or add explicit cancellation checkpoints;
- decide whether physical/screen input is suppressed, buffered, or deliberately allowed;
- ensure every accepted key-down has a key-up and release held physical keys at the boundary.

Do not add these semantics opportunistically to the Run admission patch.

### 8. Define interaction with other Automation operations

- `setProgram` mutates editor text/revision and must reject with the existing `RUN_PENDING` control error while any Run reservation is live, including a UI-origin Run. This prevents source/revision changes between compile and injection.
- Debugger pause/resume/step/write operations consult or will be extended to consult `isRunSetupPending()`; test rejection for `reserved`, `queued`, `executing`, `stalled`, and `recovering`.
- `getProgram`, `getStatus`, and `captureScreen` bypass the operation queue and may proceed because they do not mutate emulator execution or stored program. Their observations can change between calls. `validate` currently queues; change it to reject promptly with `RUN_PENDING` during any reservation rather than wait indefinitely or run concurrently with UI setup.
- `stop` remains explicitly permitted under its current origin-dependent behavior and caveat described above; changing it belongs to the input-arbitration follow-up.
- Interaction locking is presentation state, not program mutation. Disk-library/machine controls are inaccessible to normal UI while the Connector lock is active, but physical/manual interaction outside that lock remains outside this Run/Run plan. Do not describe the admission record as a global emulator transaction lock.

### 9. Add stalled-only local and remote recovery

1. Keep the existing safety invariant: no action clears an `executing` reservation or admits concurrent work. Recovery becomes eligible only after the watchdog has changed phase to `stalled` while retaining the owner.
2. Put the local recovery control and its live warning outside `editor-panel` inert scope and exempt it from the toolbar interaction-lock button loop. It remains focusable/activatable while the stuck MCP command still owns that lock. Add `x1pen_recover_stalled` with `confirmDataLoss`; absent confirmation returns the warning, and no caller can supply a token or force-unlock request.
3. Authorization is page-local and atomic, not based on a stale server-side status read. A MAIN-world recovery entry synchronously rechecks `phase === 'stalled'`, returns `RECOVERY_NOT_STALLED` with no navigation otherwise, synchronously persists current editor values through the existing `persistEditorSources()` boundary, then changes phase to `recovering` so late owner cleanup cannot reopen the gate or admit a new Run. The automation instance/revision is session-scoped and may reset after navigation; callers must fetch the fresh revision rather than expect revision continuity. In that same task it posts the accepted result and schedules navigation; the service worker must not independently reload based on an earlier snapshot.
4. After confirmation, record a bounded diagnostic event with session ID/reported origin/age (never the opaque token). The accepted response is posted before the page's scheduled navigation. Because navigation destroys the old context, the caller polls `x1pen_get_status` for a fresh ready session rather than expecting the original Run Promise to recover.
5. Define navigation cleanup: disconnecting/reloading the exact tab rejects every other pending bridge correlation for that session exactly once with `TAB_RELOADED`; service-worker `finally` paths decrement update-coordinator counts and interaction-lock depth, and the new page starts with depth zero. The recovery request itself may return accepted before disconnect, but must also settle exactly once. Test recovery both before and after the original Run's 60-second timeout.
6. The command is the remote equivalent of the UI reload, not a runtime bypass: it does not release the old page and continue there. Advertise it as `automation.run-recovery` so an old page/Connector receives an update-required response rather than an unknown command.

## Edge cases and test plan

### Admission and cleanup

- Two Run-button events in the same task: one reservation, one `performRun()`, one complete key sequence.
- Reservation is observable synchronously before the first asynchronous preparation step; a second request during `reserved`/`queued` phase is rejected before any key-down.
- Ctrl+Enter while Run is reserved: no second execution.
- Share auto-run while another Run is reserved: no second execution and one non-destructive notice in the dedicated aria-live region, which is distinct from `x1pen-status`; snapshot the active status before rejection and assert it is unchanged afterward.
- Compile/validation failure before emulator start: reservation releases; the next Run succeeds.
- Exception during asset load, mount, or key injection: reservation releases in `finally`; UI and `runPending` return to idle.
- Interaction lock begins/ends while Run is reserved: the Run trigger remains semantically unavailable until both reasons are clear, and release of the lock alone cannot clear `aria-disabled`/`aria-busy`.
- Automation Run held behind another operation: status reports `queued` and the UI/tooltip says “Run queued behind automation (up to 20 seconds)”; the reservation releases with caller-visible `RUN_QUEUE_TIMEOUT` after 20 seconds, and the later stale queue callback performs no work or second settlement.
- Execution watchdog: status changes to `stalled` and offers reload without accepting another Run. A late original completion releases only its own token, clears the stalled prompt, and restores idle state; a stale callback can neither release nor execute another owner's reservation.
- Immediately before either recovery navigation, synchronously persist the current values of all three editors using the existing localStorage boundary. Add a test that edits during the stall window and proves those latest values survive reload. Assert a fresh automation instance/revision is returned after navigation rather than requiring revision continuity. Reload still discards emulator RAM, programs typed only inside the emulated X1, and disk/mounted-image changes not flushed to persistent storage. Use invariant action text such as “Reloading preserves the current editor source but loses emulator RAM and unpersisted disk changes,” with the unverified reported origin shown separately.
- Throw synchronously from the first statement inside the post-reservation `try` and separately from Run-trigger refresh during release; both cases must clear admission and accept a later Run.
- Hold an MCP-origin execution past the 30-second stall threshold while it still owns `automationOperationQueue`; assert a concurrent MCP `x1pen_get_status` bypasses the queue and reports `stalled` with age/origin. Repeat after the original command's 60-second bridge timeout. Ordinary Run/edit/debugger/validate calls remain gated; unconfirmed or pre-stall recovery is refused; confirmed recovery reloads to a ready page where a new Run is accepted.
- For `setProgram`, record that this is a new rejection window: it does not currently call `isRunSetupPending()`. Assert `RUN_PENDING` in `reserved`, `queued`, `executing`, `stalled`, and `recovering`. Assert existing pause/resume/step guards in those phases; add equivalent guards/tests for validate and mutating breakpoint/write-VRAM operations. Assert `getProgram`, `getStatus`, and `captureScreen` remain available outside the queue throughout.
- Race late owner completion against recovery preparation: if completion reaches idle first, page-side recheck returns `RECOVERY_NOT_STALLED` and does not navigate; if recovery atomically claims `recovering` first, no subsequent Run is admitted before navigation.
- Trigger confirmed recovery before the original bridge timeout and assert outstanding Run correlation rejects exactly once with `TAB_RELOADED`, recovery settles once, interaction-lock depth/coordinator active count return to zero, and the reloaded session accepts Run. Repeat with recovery after the original timeout to prove no orphan correlation remains.
- Token hygiene: Run results and `getStatus()` contain diagnostic origin/phase/age but never the opaque token.

### Deterministic browser integration tests

- Cover two distinct synchronization points: (a) issue two requests in the same task and assert `runPending`/reservation is visible immediately, proving acquisition occurs before the first `await`; (b) expose a Promise/latch after the first synthetic key-down and trigger another request there, proving the gate remains held through injection.
- For the pre-injection window, wait for `getStatus().runAdmission.phase` to become `executing` before any key event, issue the second request during build/load or the fixed 500 ms wait, and assert one sequence. A test-only controllable preparation dependency may pause this phase; it must not expose reservation tokens.
- FuzzyBASIC UI double-click: first prove the affordance transition sets `aria-disabled`/`aria-busy` while retaining focus for keyboard activation. Then remove only those DOM attributes/classes and dispatch the second click so the guarded handler itself is exercised; assert exactly one `R,U,N,Enter` down/up sequence, not `RRUU...` and not two concatenated sequences. This is the negative control against a test that passes only because presentation state suppresses activation.
- LSX UI double-click: use the same guard-bypassing second dispatch and assert exactly one `P,R,O,G,Enter` sequence and the existing marker still reaches `12 34 56 78`.
- Direct API concurrency: call `api.run()` twice without awaiting the first. Assert one normal result, one `RUN_IN_PROGRESS` busy result, one key sequence, and no queued second execution.
- Mixed origin: start UI Run, wait for its first key-down latch, then call `api.run()`. Assert API busy and UI completes. Repeat with API first then programmatic UI click.
- After each case assert `capabilities.debugger.runPending === false`, the Run trigger is focusable/available when not interaction-locked, JoyKey restored, and a subsequent Run is accepted.
- Inject preparation and key-stage rejection and assert release. Simulate queue timeout and a late stale callback; assert the caller settles exactly once with `RUN_QUEUE_TIMEOUT`, the next token remains owned, and no old `performRun()` begins.
- Simulate an execution watchdog and assert `stalled`/reload guidance without force-release. Resolve and reject the original owner late in separate cases and assert the warning/reservation clears to idle. Reload is the recovery boundary for a genuinely non-cooperative hang, and editor-persistence coverage precedes that recovery assertion.
- Exercise Run-trigger transitions across all reasons: readiness false across acquire/release remains native-disabled; reservation alone marks unavailable then restores; interaction lock alone preserves behavior; reservation ending while a lock remains keeps native disabling; lock ending while a reservation remains restores focusable `aria-disabled`/`aria-busy`; both reasons active accepts the lock's deliberate focus loss; and the last nested lock ending with no reservation restores Run. Keep the separate non-Run nested-lock compatibility assertion.
- Assert `api.run({ origin: 'ui' })` is reported as `automation`, while internal UI/Share paths retain their trusted labels.
- Add a static/private-boundary test or source assertion ensuring `performRun` cannot be invoked without a live token; do not create a public test-only method.

### Connector and MCP contract tests

- Page Automation unit test: both admission-failure results are preserved and skip `waitMs`, an existing non-admission `ok:false` still receives the historical wait, the optional `mcp` origin reaches the page while omitted origin defaults to `automation`, and interaction lock calls remain balanced under two concurrent invocations.
- MCP server shape test: a fake bridge returns each admission-failure object; `x1pen_run` exposes `isError:false`, `ok:false`, non-empty `status`, `code`, `retryable`, optional `retryAfterMs`, and `activeOrigin` unchanged. Assert `retryAfterMs` is present only for `RUN_IN_PROGRESS` and consumers branch on `code`, not `reason`.
- End-to-end bridge test: derive the page queue timeout from injected bridge settings (for example 1,000 ms bridge → 250 ms queue), hold a prior Automation operation past the inner timeout, and assert the real page→extension→bridge→MCP boundary returns `RUN_QUEUE_TIMEOUT` with `isError:false`. Repeat with a lower non-default bridge timeout to prove derivation preserves ordering.
- Boundary scheduling test enters the queue callback and fires its timeout in both same-task orders. Callback-first transitions synchronously to `executing`, suppresses timeout settlement/release, and completes normally; timeout-first settles once and the stale callback performs no work. Neither order admits a second owner.
- Assert the `x1pen_run` tool description tells model callers that concurrent Run returns `RUN_IN_PROGRESS`, queued expiry returns `RUN_QUEUE_TIMEOUT`, no server-side retry occurs, and `retryAfterMs` guides caller retry only for the former.
- Deployment-skew tests prove new page/old extension+server preserves ordinary-content mapping (with at most legacy `waitMs`) and old page/new extension+server preserves queue-both behavior; recovery feature checks fail closed against old components.
- Bridge transport test remains concurrent-safe and correlates both command IDs; no transport-level error is invented for an application busy result.

### Related Stop / physical observations

- Add diagnostic-only test coverage or a separate issue demonstrating that UI Stop and window/screen keyboard events can reach `_js_key_down/up` during synthetic injection. Do not make the Run patch’s acceptance depend on silently suppressing these inputs.
- Confirm Automation/MCP Stop remains serialized after Automation Run. Document that Stop versus UI-origin Run is unresolved pending the input-arbitration follow-up.

### Non-regression and performance

- `./build.sh`.
- Run the enlarged `npm run test:automation` suite completely green in at least three fresh processes (expected ≥20 test functions; report the actual count and scenario/assertion count rather than retaining an old fixed label).
- `npm run test:bridge`, `test:extension-package`, `test:mcp`, and `test:mcp-package`.
- Verify `RUN_IN_PROGRESS` is synchronous, the derived `RUN_QUEUE_TIMEOUT` beats its effective outer bridge timeout at default and lowered settings, and neither consumes `waitMs`.
- Verify no source/editor mutation, disk remount, emulator restart, or key-mode change occurs for a rejected Run.
- Audit all repository Run call sites/tests and record how each handles busy versus intentionally sequential repeated execution.

### Rollback

- The admission gate and additive busy result have no persisted-data migration.
- If the gate causes regressions, revert the implementation commit(s); PR #78’s single-invocation ordering remains independently valid.
- Prefer forward-fixing UI disable-reason composition or token cleanup over reverting to concurrent Run execution.
- Do not provide a runtime bypass that re-enables concurrency: a kill switch would recreate data/key corruption. A stalled executing reservation keeps the gate closed and presents reload as the safety-preserving recovery, while warning that emulator RAM and unpersisted disk changes are lost.

### Estimated implementation size

- Approximately 10–14 files including toolbar markup/styles, Connector/service-worker routing, bridge cleanup, documentation, and tests; roughly 300–520 production lines, at least 20 test functions, and 35–55 focused scenarios/assertion groups after recovery/skew/accessibility coverage.
- No C++/WASM change is planned for Run/Run admission. Stop/physical arbitration would be a separate, larger cross-layer change.

## Implementation outcome

- Status: implemented on `fix/run-reentrancy`, stacked on PR #78 so the sequential `simulateKeys()` behavior remains the base without modifying that PR.
- A/UI: Run becomes focusable `aria-disabled`/`aria-busy` during setup, repeated click/Ctrl+Enter activation is ignored by the handler guard, Share reports through a separate aria-live region, and interaction-lock restoration cannot re-enable Run early.
- B/admission: UI, Share, direct Automation, and MCP share one synchronous reservation. Automation reserves before entering its operation queue. A second request returns `RUN_IN_PROGRESS`; an admitted request that remains queued past its derived bound returns `RUN_QUEUE_TIMEOUT` only if it is still in `queued` phase.
- Compatibility: successful `ok:true` meaning is unchanged. MCP preserves admission results as ordinary content, `waitMs` is skipped only for admission failures, and `automation.run-recovery` is advertised separately.
- Review findings: status reads remain outside the operation queue; mutating program/validation/debugger operations reject during Run; stalled recovery is lock-exempt, confirmation-gated, atomically claims `recovering`, persists current editor source, and reloads through Connector/MCP; timeout derivation uses one quarter of the effective bridge budget.
- Verification: `./build.sh`; `npm run test:automation` 9/9 in three fresh processes; `test:bridge` 8/8; `test:extension-package` 12/12; `test:mcp` 45/45; `test:mcp-package` 1/1.
- Implementation cross-review was not run, as the GO dispatch made it optional and limited it to one round. Human approval is the convergence decision.
- Deferred by design: command-start acknowledgement, Stop versus synthetic injection, and physical/screen-key arbitration.

## Open decisions

Recommended decisions awaiting GO:

1. Accept the hybrid A+B policy: ignore UI duplicates and return additive structured busy results to concurrent programmatic Run calls.
2. Keep Automation API v2 / current Connector feature IDs because success shape is unchanged and busy fields are additive.
3. Reject global queueing and latest-wins cancellation for this implementation.
4. Keep command-start acknowledgement separate from Run admission.
5. Track Stop and physical/screen-key arbitration as a separate follow-up rather than expanding this patch.
6. Treat the missing live in-app-browser reproduction as an environment limitation; the implementation task should run the deterministic latch-based browser scenarios before merge.
7. Represent both MCP admission failures as `isError:false`; only `RUN_IN_PROGRESS` is deadline-retryable, while queue timeout requires status/operator review.
8. Permit safe timeout release only while phase is still `queued`. During non-cooperative execution stalls, keep the gate closed and require a data-loss-warning reload rather than risk overlapping a late continuation.
9. Add the compatibility-gated `x1pen_recover_stalled` reload action for human and headless recovery; require explicit data-loss confirmation and refuse it before `stalled`.

## Cross-review反映

### Round 1 — claude / claude-opus-5
- Verdict: NEEDS_WORK
- [adopted][high] R1-F1 stuck reservation recovery — Added queued-phase timeout/stale-token handling, phase/age diagnostics, cancellable network deadlines, and stalled/reload recovery. Automatic force-release during non-cooperative execution is rejected because a late continuation could overlap a replacement Run.
- [adopted][high] R1-F2 concurrent caller compatibility — Added full call-site/test audit, explicit queue-both→busy behavioral migration, sequential-call preservation, and documented no-version-bump decision with a stop condition for strict consumers.
- [adopted][medium] R1-F3 gate enforcement inside execution — `performRun(token)` and its sole guarded wrapper must validate a live owner token; missing call sites fail before side effects.
- [adopted][medium] R1-F4 MCP busy mapping — Chose `isError:false`, added `retryAfterMs`, bounded polling/attempt guidance, and TOCTOU-aware retry handling.
- [rejected][medium] R1-F5 toolbar-wide disable-reason refactor — Reason: only Run gains a second disable reason; sibling controls retain interaction-lock as their sole reason. Scope remains `refreshRunTriggerState()` plus a non-Run nested-lock regression test.
- [adopted][medium] R1-F6 reservation across queue wait — Added queued/executing phases, a safe pre-execution queue timeout, stale callback validation, and status/test coverage.
- [adopted][medium] R1-F7 missing pre-injection coverage — Added immediate/same-task acquisition checks and an executing-before-keydown synchronization point in addition to the injection latch.
- [adopted][medium] R1-F8 over-broad waitMs skip — Skip only `RUN_IN_PROGRESS`; retain/test historical waits for other `ok:false` results.
- [adopted][low] R1-F9 stale counts/estimate — Changed validation to actual enlarged count (expected ≥14) and raised estimate to 14–20 cases.
- [adopted][low] R1-F10 revision/origin ambiguity — Defined revision, added normalized `activeOrigin`, and exposed non-sensitive admission phase/age.
- [adopted][low] R1-F11 token hygiene — Tokens stay module-local and are asserted absent from API/status/log output.
- [adopted][low] R1-F12 Share behavior — Added non-destructive aria-live busy notice without clobbering active status.
- [rejected][low] R1-F13 runtime bypass — Reason: bypassing admission recreates the corruption. Safe recovery is status-guided reload/revert; the Cross-review section is now populated.

### Round 2 — claude / claude-opus-5
- Verdict: NEEDS_WORK
- [adopted][medium] R2-F1 incomplete timeout contract — Added an outcome table for `RUN_IN_PROGRESS` and `RUN_QUEUE_TIMEOUT`, including retry, `waitMs`, MCP mapping, settlement, and tests. Internal stale callbacks have no third public outcome.
- [adopted][medium] R2-F2 unrealistic retry budget — Replaced three attempts/five seconds with 500 ms→2 s capped backoff under a 30-second deadline and added realistic-contention coverage.
- [adopted][medium] R2-F3 unreachable MCP origin — Added optional `run({ origin })`; Connector/MCP supplies `mcp` and direct callers default to `automation`.
- [partially rejected][medium] R2-F4 runPending widening — The asserted widening is not present: current UI `onRunClick()` already increments the active counter consumed by `runPending`. Adopted the consumer audit and made the admission record the explicit source of truth while preserving the existing boolean semantics.
- [adopted][medium] R2-F5 vacuous disabled-button test — Separated the affordance assertion from a second event that deliberately clears DOM disabled state, proving the handler-level guard blocks re-entry.
- [adopted][medium] R2-F6 missing Run-button transitions — Added reservation-only, lock-only, overlapping-reasons, and nested-lock restoration cases plus the non-Run compatibility case.
- [adopted][medium] R2-F7 stalled late completion/threshold — Specified late owner cleanup to idle and justified the 30-second warning against observed 6–8 second cold runs, with measurement-based adjustment during implementation.
- [adopted][low] R2-F8 stale-token Promise ambiguity — Queue timeout settles once; the later stale callback is an internal no-op with no unsettled or double-settled caller Promise.
- [adopted][low] R2-F9 source-of-truth ambiguity — Chose the admission record and required removal or read-only derivation of legacy counters.
- [adopted][low] R2-F10 queued UX/timeout basis — Added queued status text and selected a named 30-second bound aligned with the bridge budget, subject to fresh timing validation.
- [adopted][low] R2-F11 reload persistence — Added editor/source persistence verification before reload is offered as the recovery boundary.

### Round 3 — claude / claude-opus-5
- Verdict: NEEDS_WORK
- [adopted][high] R3-F1 unreachable queue-timeout MCP result — Corrected the actual bridge budget to 60 seconds, shortened the page queue timeout to 20 seconds with an explicit margin invariant, and added a real page→extension→bridge→MCP timeout-ordering test with injectable short budgets.
- [adopted][medium] R3-F2 reserve/finally gap — Mandated zero statements between acquisition and `try`, clear-before-refresh cleanup, and synchronous fault injection at acquisition/cleanup boundaries.
- [adopted][medium] R3-F3 existing failure message field — Source audit confirms `status` is the existing Run-result message field; kept it non-empty, made `code` the sole branch key, and removed redundant `reason`.
- [adopted][medium] R3-F4 missing lock-release transition — Exempted Run from disabled snapshot restore, required centralized refresh on lock transitions, and added the fifth lock-release-while-reserved case.
- [adopted][medium] R3-F5 reload data-loss scope — Enumerated emulator RAM, in-session programs, and unpersisted disk changes as losses; the stalled warning names the owning origin and states the loss.
- [adopted][medium] R3-F6 non-Run mutations — Renamed the gate to cross-entry Run admission and defined policy for `setProgram`, debugger controls, reads/validation, Stop, and manual machine/disk controls.
- [adopted][medium] R3-F7 retry owner/tool description — Assigned retry to callers only, labelled the algorithm test as contract guidance, and added model-facing `x1pen_run` description updates to scope.
- [adopted][low] R3-F8 spoofable origin — Public callers may supply only `automation | mcp`; `ui | share` remain trusted internal labels and unknown values coerce to `automation`.
- [adopted][low] R3-F9 watchdog clock — Defined the watchdog from the `executing` transition, added phase age, and documented the roughly 50-second worst-case pre-warning hold.
- [adopted][low] R3-F10 focus loss — Chose focusable `aria-disabled`/guard semantics for user reservations and added keyboard-focus coverage.

### Round 4 — claude / claude-opus-5
- Verdict: NEEDS_WORK
- [adopted][high] R4-F1 headless stalled recovery — Made admission state observable through existing MCP status and added a stalled-only, confirmation-required `x1pen_recover_stalled` reload action with compatibility gating, audit data, and post-timeout recovery tests. It cannot release a live executing gate.
- [adopted][medium] R4-F2 per-phase validation contradiction — Declared executing ownership immutable until owner `finally`; retained only pre-execution validation and non-aborting diagnostic assertions thereafter.
- [adopted][medium] R4-F3 incoherent queue-timeout retry — Made queue timeout non-retryable automatically; the 30-second backoff contract now applies only to synchronous `RUN_IN_PROGRESS`.
- [adopted][medium] R4-F4 incomplete disable reasons — Audited current Run writes, added module readiness as a source of truth, required re-audit, CSS semantics, and readiness-overlap testing.
- [adopted][medium] R4-F5 artifact skew — Verified current MCP `textResult()` does not escalate `ok:false`, specified both deployment directions/tests, and added a compatibility feature only for the new recovery command.
- [adopted][medium] R4-F6 setProgram/control change — Recorded `setProgram` gating as new, extended the consumer audit, and enumerated phase-by-phase mutation/read tests.
- [adopted][low] R4-F7 missing live region — Source audit found none; added `html/x1pen.html`, a distinct live region, styling, file estimate, and non-clobbering assertions.
- [adopted][low] R4-F8 timeout invariant wording — Split the general 3× ratio from the production-only 10-second absolute margin so injected tests satisfy the stated rule.
- [adopted][low] R4-F9 combined focus behavior — Explicitly accepted Connector-lock blur precedence and added a both-reasons focus assertion.
- [adopted][low] R4-F10 origin trust boundary — Treat origin as best-effort MAIN-world diagnostics; warning content/data-loss policy never depends on it.
- [adopted][low] R4-F11 test estimate — Raised the estimate to at least 20 test functions and 30–45 scenarios/assertion groups.

### Round 5 — claude / claude-opus-5
- Verdict: NEEDS_WORK — automated review limit reached; human review is required before implementation.
- [adopted][high] R5-F1 queued status observability — Source audit confirms `getStatus`/`getProgram`/`captureScreen` bypass the queue while `validate` queues. Preserved/bound the read bypass, changed validate to prompt `RUN_PENDING`, and made MCP-origin in-queue stall observability a gating test.
- [adopted][medium] R5-F2 locked local recovery — Placed/exempted the recovery control outside inert/toolbar locking and added an MCP-lock-held activation test.
- [adopted][medium] R5-F3 queue-entry timeout race — Required callback-first synchronous `queued → executing`, phase-checked timeout no-op, normal owner settlement, and both-order boundary tests.
- [adopted][medium] R5-F4 recovery TOCTOU — Moved authorization page-side, added atomic `stalled → recovering`, `RECOVERY_NOT_STALLED`, and late-completion race coverage.
- [adopted][medium] R5-F5 navigation cleanup — Defined `TAB_RELOADED`, exactly-once bridge settlement, lock/coordinator cleanup, and pre/post-bridge-timeout recovery tests.
- [adopted][medium] R5-F6 editor persistence — Required synchronous persistence of current editor values immediately before navigation and an edit-during-stall reload test.
- [adopted][low] R5-F7 configurable timeout — Replaced the fixed MCP value with a timeout derived at one quarter of the effective bridge setting and added a lower-setting test.
- [adopted][low] R5-F8 origin warning contradiction — Separated unverified diagnostic attribution from origin-invariant eligibility and byte-identical data-loss text.

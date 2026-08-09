# `simulateKeys()` 逐次キー注入化 — 実装レビュー計画

## 最終状態

- five-round failure後のhuman approval（Secretary request `20260809T110807.629241-secretary`）に基づき、R5-F1とR5-F2を実装・再検証済み。
- 採用済みfindingの未実装残はなし。
- `interval`→`gapMs`、per-key finally、最新keyModeの0..2 validation付き復元、JoyKey/timing assertionを反映済み。
- queue/guardとAutomation `run()`の`ok:true`拡張は、承認どおり今回scope外のまま。

## 目的

`html/x1pen.js` の合成キー注入で、複数の keydown/keyUp タイマーが main-thread 遅延時に重なり、LSX の `PROG` コマンドが欠落する問題を解消する。

## 確認済みの原因

- 旧 `simulateKeys(keys, interval)` は全 keydown を `i * interval` で先行予約し、各 keyUp を keydown の 80ms 後に予約していた。
- `simulateProgCommand()` の `interval=50ms` は hold=80ms より短く、平常時からキーが構造的に重なる。
- headless 環境でタイマーが coalesce すると複数 keydown が同時刻に集中し、`PROG` の一部が欠落して LSX プログラムが開始されない。
- 1キーずつ down、wait、up、wait と逐次注入する非変更実験では、プログラム開始と ASM marker 書込みを確認済み。

## 実装方針と現在の実装

1. `SYNTHETIC_KEY_HOLD_MS = 80` を定義する。
2. Promise ベースの `waitForSyntheticKey(ms)` を定義する。
3. `simulateKeys(keys, gapMs)` を async function とし、各キーを次の順で直列処理する。
   - `module._js_key_down(vk)`
   - hold 80ms を await
   - `module._js_key_up(vk)`
   - 最終キー以外は inter-key gap を await
4. 旧 `interval` 引数は意味を明確にするため `gapMs` に改名し、次の keydown までの間隔ではなく keyUp 後の gap とする。
   - PROG: 80ms hold + 50ms gap = keydown 間隔 130ms 以上
   - RUN: 80ms hold + 100ms gap = keydown 間隔 180ms 以上
5. keyDown/keyUp の既存の例外握りつぶしを維持しつつ、各キーを `down; try { await hold } finally { up }` にして、将来hold待機がreject可能になってもkeyUpを必ず試行する。合成キー用 Keyboard mode は外側の `finally` で復元する。
6. 合成sequenceの一時KB切替はmoduleの `_js_set_key_mode(0)` を直接呼び、`XmilControls` の設定storeは変更しない。最終mode復元時は開始時snapshotだけを無条件に書き戻さず、`XmilControls.getSettings().keyMode` を再読込する。0..2の有効値なら最新設定を復元し、未定義・値不正・例外時のみ開始時snapshotをfallbackにする。
7. private helper のテスト専用公開は追加しない。
8. Round 3 の再評価により、Promise queue と新しいin-flight拒否guardはいずれも導入しない。前者はbacklog/rejection管理、後者は新しい`run_in_progress` API結果契約を生み、単一`simulateKeys()`内の確定済みtimer overlap修正を越えるためである。

この共通関数を利用する `simulateRunCommand()` と `simulateProgCommand()` の双方が同じ逐次化の恩恵を受ける。

## 呼び出しチェーンの棚卸し

- `simulateKeys()` の直接呼び出しは `simulateRunCommand()` と `simulateProgCommand()` の2箇所だけで、可変長キー列や第三の呼び出し元はない。
- 両 wrapper は `simulateKeys()` の Promise を return する。
- `performRun()` は LSX 分岐で `await simulateProgCommand()`、FuzzyBASIC 分岐で `await simulateRunCommand()` としている。
- Automation API の `run()` は operation queue 内で `await onRunClick()` し、`onRunClick()` は `await performRun()` する。従って Automation の完了は全キーの keyUp まで伝播しており、floating Promise はない。
- UI click / Ctrl+Enter / Share-triggered run は Automation operation queue 外から `onRunClick()` に到達し得る。新たな同時run拒否契約は今回追加せず、同時runは既存制約として残す。
- Keyboard mode の復元は既存の `syntheticKeyDepth` 参照カウントで管理される。最初の合成sequenceだけがユーザーmodeを保存してKBへ切り替え、重複sequenceはdepthだけを増やし、depth=0になった最後のleaveだけが保存済みユーザーmodeへ復元する。従って重複時もmode snapshotの上書き・固着は起きない。

## キー注入・mode参照の全体棚卸し

- program command合成注入は `simulateKeys()` のみで、直接callerは固定列のRUN/PROG wrapper 2箇所だけ。
- `html/x1pen.js` のStop操作はESCを30msの独立timerで送る。これはrun cancellation契約を持たない既存経路で、今回のprogram command逐次化には統合しない。
- `html/pre.js` のscreen/physical keyboard handlerはユーザー入力を直接 `_js_key_down/up` へ渡す。Automation interaction lock中はUI操作を抑制する既存責務であり、program command helperには統合しない。
- Keyboard mode writeは合成sequenceの一時KB切替・参照カウント復元、Controlsの設定適用、設定UI changeに存在する。今回の修正は既存参照カウント方式を変更しない。
- 合成sequence中にControls設定が変わった場合はleave時に最新`getSettings().keyMode`を再読込するため、古いsnapshotで新しいユーザー選択を巻き戻さない。
- テストの `_js_key_down/up` 参照はイベント記録用spyであり、finallyで元関数へ戻す。

## テスト方針と結果（human approval実装後）

- 既存 Playwright automation integration test で Emscripten Module の `_js_key_down` / `_js_key_up` を一時的にラップし、実際の `X1PenAutomation.run()` 中のイベント列を記録する。
- FuzzyBASIC の RUN が `down R, up R, down U, up U, down N, up N, down Enter, up Enter` の厳密な交互列であることを検証する。
- LSX の PROG が `down P, up P, down R, up R, down O, up O, down G, up G, down Enter, up Enter` の厳密な交互列であることを検証する。
- LSX テストは marker address `0x4000..0x4003` が `12 34 56 78` になる既存確認も維持し、コマンドが実際に開始したことを検証する。
- 旧 PROG 実装は gap 相当の50ms時点で2キー目が down し、1キー目の up は80ms時点なので、正常な timer 実行でも新 assertion の期待する down/up 交互列に必ず違反する。この assertion は timer coalescing の偶然を待たずに旧構造を決定的に検出する。coalescing 自体の再現テストではない。
- 先行調査の修正前 baseline は automation 9件中6件 pass、ASM/PROG を使う3件が30秒 timeout だった。
- 記録イベントに `performance.now()` timestamp を含め、各down→upが70ms以上、50ms gapは40ms以上、100ms gapは85ms以上であることを検証する。これにより順序だけでなくhold/gap=0への退行も検出する。
- `_js_set_key_mode`もspyし、JoyKey設定からrunした場合に一時KB(0)へ切り替わり、完了後に最新のユーザーmodeへ復元されることをassertする。
- `npm run test:automation`: 新timing/mode assertion込みで9/9を独立プロセスで3回連続pass（合計27/27）。
- `test:bridge`: 8/8、`test:extension-package`: 11/11、`test:mcp`: 44/44、`test:mcp-package`: 1/1 pass。
- `./build.sh`: human approval実装反映後に成功。

## スコープ判断

- Automation `run()` の `ok:true` は今回変更しない。
- 理由: `ok:true` を「キー注入完了」から「コマンド開始確認」へ変えるには、FuzzyBASIC と LSX の開始条件、timeout、エラー表現を含む別の API 契約が必要であり、今回のタイマー競合修正と分離する方が安全。
- リセット・電源断・run cancellation の世代チェックは追加しない。現行 API に進行中の `performRun()` を abort する契約がなく、旧実装にも同じ制約があるため、別途 cancellation contract を設計する課題とする。
- 同時run / Stop / physical inputとの交差は今回新規に悪化させる状態管理を導入せず、既存の参照カウントmode復元を維持する。単一sequence内のorderingだけを今回の保証範囲とする。
- UI click / Ctrl+Enter / Share / Stop / physical keyを意図的に同時実行した場合、program commandの注入窓が旧280–380msから新600–620msへ伸びるため、別sequenceまたはESC/physical keyが割り込み、今回と同じ交互列崩れを起こす可能性は高くなる。Automation API同士は既存operation queueでserializeされ、Connector経由では既存interaction lockがUIを抑制するため、報告されたheadless Automation経路にはこの並行入力はない。対話操作の同時run/cancel契約は別課題とする。

## リスクとロールバック

- PROG は旧約280msから新約600ms、RUNは旧約380msから新約620msになる。`performRun()` と全 Automation caller は注入 Promise を await するため、注入後の画面取得や marker polling は注入完了後に開始する。marker は固定 sleep ではなく `waitForFunction` で状態を polling し、suite timeout は60秒である。bridge/MCPを含む指定suiteも新時間で passしており、追加約320msに対する実測余裕がある。
- key mode 復元は全キー処理を囲む `finally` に置き、正常完了以外でも復元を試みる。
- 現在の `waitForSyntheticKey()` は resolve-only の Promise で、run cancellation / AbortSignal はなく、keyDown 後から keyUp 前に reject するコード経路はない。ページ unload 時は JS context 自体が破棄される。防御的なper-key finallyでは `_js_key_down` 成功をlocal flagで保持し、成功時だけkeyUpを試行する。
- 80ms hold は wall-clock ordering の保証であり、エミュレータ進行フレーム数の保証ではない。今回の確定原因と非変更実験は key overlap を対象としており、エミュレータ停止・background throttling は別問題として扱う。
- 非表示tabでbrowser timerが1秒 clampされる場合、Nキーの逐次hold/gapは最大約2N回のtimer待機となり、PROGは約9秒規模まで延び得る。ただし旧parallel方式は同条件でtimer coalescingによりキー欠落するため、安全なparallel化へは戻さない。Automation実行はX1Pen tabが表示・稼働している条件を想定し、hidden-tab最適化は別課題とする。
- mode固着・キー欠落など限定的な回帰はhold/gapまたはmode復元の前進修正を第一選択とする。逐次化自体が広範な破損を起こす場合のみPR branchの単一squash commitをrevertできるが、修正前baseline 6/9へ戻るため automation 9件の再実行と既知3 timeoutの再確認を要する。review後amendでSHAは変わるため固定hashをrollback手順に使わない。データ形式や永続設定の migration はない。

## Cross-review反映

### Round 1 — claude / claude-opus-5
- Verdict: NEEDS_WORK
- [rejected][high] R1-F1 async化に伴うawait伝播が未記載 — Reason: repository棚卸しで両wrapperがPromiseをreturnし、`performRun()`、`onRunClick()`、Automation queueまで全段がawait済みと確認した。呼び出しチェーン節に証拠を追記した。
- [rejected][high] R1-F2 中断時に押下中キーが解放されない — Reason: 現在のhold/gap Promiseはresolve-onlyでAbortSignalやrun cancellationがなく、down後up前にrejectする経路がない。将来cancellable化する場合の必須cleanupをリスク節に明記した。
- [adopted][medium] R1-F3 awaitをまたぐKeyboard mode再入 — 既存depth参照カウントを記録し、Automation queue外のUI経路も含めて全key sequenceを専用Promise queueで直列化する方針を実装節へ追加した。（R2-F1 / R3-F1で撤回・superseded。現行方針は実装方針8。）
- [rejected][medium] R1-F4 所要時間倍増による下流定数 — Reason: 全callerが注入完了をawaitし、markerは完了後の状態polling、suite timeoutは60秒。追加約320msを含む全指定suite passをリスク節へ記録した。
- [adopted][medium] R1-F5 `interval`の意味変更とcaller棚卸し — `gapMs`への改名、直接caller2箇所と全await chainを呼び出しチェーン節へ追加した。
- [rejected][medium] R1-F6 wall-clock holdはemulator進行を保証しない — Reason: 今回の確定原因と実証はordering overlapであり、emulator停止は別問題。制約をリスク節へ明記した。
- [rejected][medium] R1-F7 間欠障害への回帰検出力 — Reason: interval=50ms、hold=80msの旧PROG構造はcoalescingなしでも必ずdown/downとなり、追加assertionが決定的に失敗する。修正前baseline 6/9もテスト節へ追記した。
- [rejected][low] R1-F8 reset/cancel世代チェック — Reason: 現行runにabort契約がなく旧実装にもある制約のため別課題とし、スコープ節に記録した。
- [adopted][low] R1-F9 境界条件と文書状態 — 実装済みレビュー文書であること、単一commitに実装とテストが含まれること、Cross-review履歴を明記した。private固定callerのみのため新たな公開test hookは追加しない。

### Round 2 — claude / claude-opus-5
- Verdict: NEEDS_WORK
- [adopted][high] R2-F1 queueとKeyboard mode snapshotの境界 — Promise queue案を撤回し、唯一のrun入口で開始前に拒否するin-flight guardへ変更した。（R3-F1で撤回・superseded。現行方針は実装方針8。）
- [adopted][medium] R2-F2 同時実行制御とholdのtest不足 — UI/Automation重複trigger、単一完全sequence、mode復元、hold/gap下限を検証するintegration assertionをテスト節へ追加した。（重複trigger部分はR3-F5で撤回・superseded。mode復元とhold/gap検証は維持。）
- [rejected][medium] R2-F3 queue rejection汚染 — Reason: Promise queue案を撤回したためrejection chainは存在しない。各重複callerは開始前に自身の`false`を受け取る。
- [adopted][medium] R2-F4 非有界backlog — queueを撤回し、active run中の新規triggerを`false`で拒否してpending key sequenceを0本に制限する。（R3-F1で撤回・superseded。現行方針は実装方針8。）
- [adopted][medium] R2-F5 hidden tab timer clamp — 2N回の直列timerとPROG約9秒のworst-case、visible/稼働tabを利用条件とする判断をリスク節へ追加した。
- [rejected][low] R2-F6 約320msのAPI latency文書化 — Reason: public APIの意味とtimeout契約は変更せず、実測増分は1秒未満で全callerがawait済み。内部定数の一般利用者向け文書化は今回scopeに対して過剰である。`ok:true`非変更はスコープ節に明記済み。
- [adopted][low] R2-F7 rollback判断基準 — 前進修正を優先し、広範破損時のみ既知failure baselineへrevertする基準と再検証をリスク節へ追加した。

### Round 3 — claude / claude-opus-5
- Verdict: NEEDS_WORK
- [rejected][high] R3-F1 同時run拒否のAPI結果が未定義 — Reason: 新しい拒否guard案そのものを撤回したため、新しい結果状態やMCP/bridge契約変更は導入しない。
- [rejected][high] R3-F2 `automationActiveRuns`所有権 — Reason: guard案を撤回し、既存counterのmutation/意味を変更しない。
- [rejected][medium] R3-F3 guard atomicity/decrement — Reason: guard案を撤回したため新しいcheck/increment境界は存在しない。
- [adopted][medium] R3-F4 全キー/mode経路の棚卸し — repositoryの `_js_key_down/up`、`_js_set_key_mode`、Controls設定参照を検索し、program command、Stop、physical/screen keyboard、mode設定、test spyを専用節に列挙した。
- [rejected][medium] R3-F5 重複trigger testの同期点 — Reason: guard案を撤回し、同時runを今回の新保証に含めない。単一sequenceの決定的なdown/up構造testにscopeを戻した。
- [rejected][low] R3-F6 部分注入silent success — Reason: down/up例外握りつぶしは既存API動作で、今回のtimer ordering修正では変更しない。開始確認を含む結果契約と併せて別課題とする。
- [adopted][low] R3-F7 rollback単位 — review後amendmentを既存commitへsquashし、PRを単一commitに保つ。rollbackは既知障害への復帰なので原則前進修正とする。

### Round 4 — claude / claude-opus-5
- Verdict: NEEDS_WORK
- [rejected][high] R4-F1 並行runのinterleave窓拡大 — Reason: Automation API同士は既存queue、Connector操作中は既存interaction lockでUIを抑制し、確定したheadless failure経路に並行callerはない。queue/coalesceは別runの注入結果を誤って共有するかbacklogを作るため採用しない。対話的同時run/Stop/physical入力では窓が2倍以上になり得る制約をリスク節へ明記した。
- [adopted][medium] R4-F2 sequence中のmode設定変更上書き — leave時に最新`XmilControls.getSettings().keyMode`を再読込し、開始時snapshotはfallbackだけに使う方針を実装節へ追加した。
- [adopted][medium] R4-F3 mode復元assertion欠落 — `_js_set_key_mode`をspyして一時KB切替と最新ユーザーmode復元を検証する項目をテスト節へ復活した。
- [adopted][low] R4-F4 keyUp保証 — 各キーのholdをtry/finallyで囲み、down成功時のkeyUpをfinallyで必ず試行する構造を追加した。
- [adopted][low] R4-F5 rollback固定hash矛盾 — rollback対象をPR branchのsquash commitとし、amendでSHAが変わる前提を記録した。
- [rejected][low] R4-F6 注入全体の上限assertion — Reason: CI負荷やtimer clampでcorrectnessを保ったまま遅くなるケースを固定2秒でflakeに変えるため採用しない。60秒suite timeoutと3回連続passで実環境条件を検証する。

### Round 5 — claude / claude-opus-5
- Verdict: NEEDS_WORK
- [adopted][medium] R5-F1 `getSettings()`再読込の不変条件 — 合成KB切替はmodule `_js_set_key_mode(0)`を直接呼びControls storeを変更しないこと、有効mode値0..2だけを採用し不正値/例外時は開始snapshotへfallbackすること、JoyKey復元spyを実装時の必須条件とする。
- [adopted][medium] R5-F2 Round 4採用変更後の再検証 — Human approval後にR4/R5採用分を実装し、build、automation 9/9×3、bridge 8/8、extension-package 11/11、mcp 44/44、mcp-package 1/1を再実行して全passを確認した。
- [adopted][low] R5-F3 superseded履歴 — R1-F3、R2-F1/F2/F4に撤回roundと現行方針8への参照を追記した。
- [adopted][low] R5-F4 gap許容誤差 — 50ms gapは40ms以上、100ms gapは85ms以上とテスト節に固定した。
- [adopted][low] R5-F5 down不成立時のup — local success flagを用い、down成功時だけfinallyでupを試行する方針をリスク節へ追加した。

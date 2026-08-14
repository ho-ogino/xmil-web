# Changelog

## X1Pen 0.9.0 / x1pen-mcp 2.7.0 / Connector 1.3.0

### X1Pen Web 0.9.0

- 書き込み可能なLSX-Dodgers diskを元に、非破壊のworking copyを作るproject disk機能を追加しました。project diskからのRUNはcold startとなり、X1／X1turbo／X1turboZのMODELを選べます。
- ディスクなしで作ったBASIC／SLANGプログラムの一時PROGRAM diskを保存し、project diskの安全なベースとして再利用できるようになりました。
- SLANGに`STICK`と`TATTR`を追加し、runtime呼出しの引数個数検証を強化しました。
- SLANGタブにbinary Importを追加しました。
- Z80 assemblerの`#IF`で`&&`、`||`、`!`を利用できるようになりました。
- NMI操作がIPL resetの代用ではなく、実際のZ80 NMIを発生するようになりました。
- 物理キー入力の取りこぼし、M8ALOADのbrowser assembly経路を修正しました。
- source revision／hash／epochを追加し、page reloadや競合をまたぐ古い編集を検出できるようにしました。
- timing、`INKEY`、inline assembly、大量書き込み、SLANGの`{}`推奨記法などのreferenceを更新しました。

挙動が変わる点:

- project disk RUNはcold startのため、RAM、VRAM、PCGと未保存のmachine stateが消えます。MODEL切り替えはこの経路だけで利用できます。
- NMIはresetではなくなりました。再起動が必要な場合はIPL Resetを使用してください。
- staleなsource更新と、引数個数が不正なSLANG runtime呼出しは、誤動作させず明示的に拒否します。

### x1pen-mcp 2.7.0

- `x1pen_send_key`、`x1pen_set_pad`を追加しました。
- bounded source read/search、`x1pen_diff_source`、`x1pen_apply_edits`を追加しました。
- revision／hash／epochに基づくsource conflict guardを追加しました。
- 旧Connectorでもsourceの読み書きを継続できるgraceful degradationを追加しました。
- project disk、MODEL、実行、入力、SLANG／FuzzyBASIC／Z80 assemblyのreferenceを更新しました。

Connector 1.2.0ではsource read/writeを`revision-only` modeで継続できますが、reloadをまたぐ完全な競合防止、`x1pen_diff_source`、remote key入力、remote pad入力は利用できません。完全な機能にはConnector 1.3.0以降が必要です。

既知の制約: `x1pen_send_key`の成功は指定時間のkey down／up dispatch完了を表し、guestが入力を消費したことまでは保証しません。background tabや高負荷では短い入力を取りこぼす一方、長い`durationMs`はresponsiveなguestの`INKEY(1)`などでkey repeatとして複数回返る場合があります。画面またはdebugger memoryでguest側の反応を確認し、program側でrelease待ち／debounceを行ってください。反応がなく、同じkeyの再送がprogram上安全な場合だけ再送してください。

### X1Pen Connector 1.3.0

- X1Penの表示中emulatorへ送る、許可済みのbounded key入力とactive-low joystick pad入力を追加しました。
- disconnect、reload、session変更、bridge終了、emulator resetで保持中のpad入力を解放します。
- source revision epoch／capability descriptor／source-sync transportと構造化errorを追加しました。
- manifest permissionは1.2.0から増えていません。

### Project diskとMODELについて

- project diskには、書き込み可能なsingle-member LSX-Dodgers形式のD88／2Dが必要です。起動には`LD.BIN`と`AUTOEXEC.BAT`、BASICには`FZBASIC.COM`が必要です。X1PenはBASICの`PROGRAM.BIN`／`AUTORUN.BAS`、SLANGの`PROG.COM`をworking copyへ書き込みます。
- 一時PROGRAM diskをSaveして再登録する方法なら、`MAGIC.BIN`、`PSGAKM.BIN`、`PSGAKG.BIN`などの同梱fileも保持されます。
- MODEL切り替えはproject diskのcold-start RUN限定です。通常のRUNでは切り替えられません。
- cold startではRAM、VRAM、PCGが消去されます。
- ROM未登録時はstub BIOSを使います。実IPL ROMとは動作が異なる場合があるため、必要に応じてX1用`IPLROM.X1`、turbo／turboZ用`IPLROM.X1T`を登録してください。

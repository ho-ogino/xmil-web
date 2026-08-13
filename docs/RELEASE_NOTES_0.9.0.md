# X1Pen 0.9.0 リリースノート原稿

公開時にそのまま転記できる、コンポーネント別の原稿です。

## X1Pen Web 0.9.0

X1Pen 0.9.0では、ライブラリのLSX-Dodgers diskを安全なworking copyにして使うproject disk機能を追加しました。project diskからのRUNはcold startとなり、X1／X1turbo／X1turboZのMODELを選択できます。SLANGの`STICK`／`TATTR`、binary Import、Z80 assembler `#IF`の論理演算子、実NMIにも対応しました。物理キーの取りこぼしとM8ALOADのbrowser assemblyも修正し、source revision／hash／epochによる競合検出を強化しています。

注意: MODEL切り替えはproject diskのcold-start RUN限定です。通常のRUNでは切り替えられません。cold startではRAM、VRAM、PCGと未保存のmachine stateが消えます。NMIもresetではなくなったため、再起動にはIPL Resetを使用してください。不正なSLANG runtime引数とstaleなsource更新は明示エラーになります。

### MODELを切り替える安全な手順

1. FDD0／FDD1を空にして、BASICまたはSLANGで短いプログラムをRUNします。
2. **FDD → FDD0 → Save** で`PROGRAM.d88`を保存します。
3. `PROGRAM.d88`をファイルライブラリへ追加し、FDD0へマウントします。
4. MODELを選んで再度RUNし、`<元の名前>-X1Pen` working copyの作成を承認します。
5. cold start後の実行を確認し、元の`PROGRAM.d88`はベースとして保管します。

このdiskには起動に必要な`LD.BIN`／`AUTOEXEC.BAT`、BASIC用の`FZBASIC.COM`、グラフィック／サウンド用の`MAGIC.BIN`／`PSGAKM.BIN`／`PSGAKG.BIN`が含まれ、Saveと再登録後も保持されます。X1PenはBASICなら`PROGRAM.BIN`／`AUTORUN.BAS`、SLANGなら`PROG.COM`を書き込みます。

ROMを登録していない環境では内蔵stub BIOSで起動します。実IPL ROMとは動作が異なるsoftwareがあるため、必要に応じてX1用`IPLROM.X1`、X1turbo／turboZ用`IPLROM.X1T`を登録してください。stubでの確認は実ROMでの動作保証ではありません。

## npm: x1pen-mcp 2.7.0

x1pen-mcp 2.7.0では、`x1pen_send_key`／`x1pen_set_pad`、bounded source read/search、`x1pen_diff_source`、`x1pen_apply_edits`を追加しました。revision／hash／epochによるsource conflict guardで、page reloadや同時編集をまたぐstale updateを安全に拒否します。project disk、MODEL、SLANG／FuzzyBASIC／Z80 assemblyのreferenceも更新しました。

Connector 1.2.0の審査待ち環境でもsource read/writeは`revision-only` modeで継続できます。ただしreloadをまたぐ完全な競合防止、`x1pen_diff_source`、remote key入力、remote pad入力は利用できません。MCPのstatusにdegraded表示が出た場合は、Connector 1.3.0以降へ更新すると全機能を利用できます。

## Chrome Web Store: X1Pen Connector 1.3.0

X1Pen Connector 1.3.0では、表示中のX1Pen emulatorに対する許可済みのbounded key入力とjoystick pad入力、source revision epoch／capability negotiation／source-sync transportを追加しました。保持中のpad入力はdisconnect、reload、session変更、bridge終了、emulator resetで自動解放されます。manifest permissionは1.2.0から増えていません。

完全なsource conflict guard、`x1pen_diff_source`、remote key／pad入力を使うには、X1Pen 0.9.0、x1pen-mcp 2.7.0、Connector 1.3.0以降を組み合わせてください。

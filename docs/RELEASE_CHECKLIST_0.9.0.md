# X1Pen 0.9.0 公開前チェックリスト

OwnerがWeb deploy → npm publish → Chrome Web Store提出の直前に実行するチェックリストです。失敗項目が1つでもあれば次の公開工程へ進みません。

## 1. Release candidate

- [ ] PR #111が含まれておらず、PR #118を含むrelease準備PRのmerge commitを記録した。
- [ ] `html/x1pen-version.js`は`0.9.0`、`mcp/package.json`は`2.7.0`、`extension/manifest.json`は`1.3.0`である。
- [ ] `npm run test:project-disk`、`npm run test:bridge`、`npm run test:mcp`、`npm run test:mcp-package`、`npm run test:extension-package`が成功した。
- [ ] `./build.sh`と`npm run test:automation`が成功した。
- [ ] MCP tarballとConnector ZIPのversion／内容を確認し、公開するartifactを固定した。

## 2. Project diskのexact click path

### BASIC

- [ ] FDD0／FDD1を空にし、`10 PRINT "HELLO, WORLD"`をRUNした。
- [ ] **FDD → FDD0 → Save** で`PROGRAM.d88`を保存した。
- [ ] 保存したdiskをライブラリへ追加し、FDD0へマウントした。
- [ ] MODELを選んでRUNし、`<元名>-X1Pen` working copy作成を承認した。
- [ ] cold start後にHELLOプログラムが実行された。
- [ ] working copyに`LD.BIN`、`AUTOEXEC.BAT`、`FZBASIC.COM`、`MAGIC.BIN`、`PSGAKM.BIN`、`PSGAKG.BIN`が残っている。

### SLANG

- [ ] FDD0／FDD1を空にし、短いHELLOプログラムをSLANGでRUNした。
- [ ] FDD0をSaveしてライブラリへ再登録し、project working copyを作成した。
- [ ] cold start後に`PROG.COM`が実行された。
- [ ] `LD.BIN`、`AUTOEXEC.BAT`、`MAGIC.BIN`、`PSGAKM.BIN`、`PSGAKG.BIN`が残っている。

## 3. MODEL／ROM

- [ ] X1、X1turbo、X1turboZをproject diskのcold-start RUNで順に起動した。
- [ ] MODEL変更ごとにRAM／VRAM／PCGが初期化されることを確認した。
- [ ] 通常の一時PROGRAM disk RUNではMODEL切り替えを案内しないことを確認した。
- [ ] ROM未登録のstub BIOS環境で起動結果を記録した。
- [ ] 利用可能なら、X1は`IPLROM.X1`、turbo／turboZは`IPLROM.X1T`でも起動結果を記録した。stubと実ROMの結果は別々に扱った。

## 4. MCP／Connector互換性

- [ ] X1Pen 0.9.0 + MCP 2.7.0 + Connector 1.2.0でsource read/writeが成功し、statusが`revision-only`／degradedを示した。
- [ ] 上記の旧Connector構成で`x1pen_diff_source`、remote key、remote padが利用不可となり、1.3.0への更新案内が表示された。
- [ ] Connector 1.3.0でfull source-sync、`x1pen_diff_source`、remote key、remote padが成功した。
- [ ] padを保持した状態からdisconnect／reload／session変更／resetを行い、入力が解放された。

## 5. Web deploy（Owner）

- [ ] deploy前に直前正常なCloudflare Pages deployment IDと`v0.8.1`を記録した。
- [ ] release merge commitにannotated tag `v0.9.0`を付けた。
- [ ] X1Pen Webをdeployし、hard reload／cache無効化を行った。
- [ ] `x1pen-version.js`、page status、feature descriptorがすべて`0.9.0`相当を示した。
- [ ] editor、RUN、project disk、MCP coreを本番でsmoke testした。

## 6. npm publish（Owner）

- [ ] `npm whoami`と`npm run test:mcp-package`を再確認した。
- [ ] `npm publish ./mcp`を実行した。
- [ ] `npm view x1pen-mcp version`と`npx -y x1pen-mcp@2.7.0 --version`が`2.7.0`を示した。

## 7. Chrome Web Store（Owner）

- [ ] 公開中が`1.2.0`で、別の審査中draftがないことをDashboardで再確認した。
- [ ] `dist/x1pen-connector-1.3.0.zip`を提出した。
- [ ] 審査手順で本番X1Pen 0.9.0と`x1pen-mcp@latest`を使って新機能を再現できることを確認した。
- [ ] 提出日時、artifact checksum、Dashboard statusを記録した。

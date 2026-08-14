# X1Pen リリースチェックリスト

X1Pen Web、x1pen-mcp、X1Pen Connector の協調リリースと、パッチ／単一コンポーネントリリースに共通で使うOwner向けチェックリストです。各リリースで選択したgateが1つでも失敗したら、次の公開工程へ進みません。

この文書は、旧 `docs/RELEASE_CHECKLIST_0.9.0.md` を汎用化したものです。0.9.0時点のチェックリストは [v0.9.0 tagの履歴](https://github.com/ho-ogino/xmil-web/blob/v0.9.0/docs/RELEASE_CHECKLIST_0.9.0.md) で参照できます。

## 0. Release identity と scope matrix

開始時に次をrelease logへ記録します。

- Release version／tag:
- Release commit:
- Owner:
- 実施日時:
- GitHub Release draft URL:
- 前回の正常なtag／deployment／公開artifact:

各componentは必ず `changed` または `unchanged` のどちらかにします。空欄のまま開始しません。

| Component | Scope | Current | Target | 変更概要 | 公開channel／artifact |
| --- | --- | --- | --- | --- | --- |
| X1Pen Web | `changed` / `unchanged` |  |  |  | Cloudflare Pages |
| x1pen-mcp | `changed` / `unchanged` |  |  |  | npm package |
| X1Pen Connector | `changed` / `unchanged` |  |  |  | Chrome Web Store ZIP |

Canonical version sourceは次の3つです。

- X1Pen Web: `html/x1pen-version.js`
- x1pen-mcp: `mcp/package.json`
- X1Pen Connector: `extension/manifest.json`

Scopeの規則:

- `changed`: canonical version、CHANGELOG、対象test、artifactを更新し、この文書の対象channel節を実施します。
- `unchanged`: versionを据え置き、再pack／再publish／再提出しません。変更componentとの互換性監査と必要最小限の接続smokeは省略できません。
- protocol、feature ID、transport、権限、serialization contractの変更は、影響componentをscopeへ追加するか、mixed-versionで安全なrollout順とfallbackをrelease logへ記録します。
- docs-onlyなど全runtime componentが`unchanged`の場合は、product tag／GitHub Releaseが本当に必要かを明示的に判断します。自動的に3channelを公開しません。

## 1. 未変更componentの互換性監査

1つでも`unchanged`がある場合の必須gateです。version bump、tag、artifact公開より前に完了します。

- [ ] page、Connector、MCPで、変更componentのproduct versionを完全一致比較していないか確認した。
- [ ] minimum version比較、手動parse、文字列の大小比較を洗い出した。
- [ ] semantic versionの大小が必要な箇所は、文字列比較ではなくtested semver comparatorを使い、`0.9.10`と`0.9.2`のようなmulti-digit segmentをtestした。
- [ ] product versionと、Automation API／bridge protocol／debugger state／save-state formatなどの整数versionを区別して記録した。
- [ ] legacy componentのversion辞書がある場合、対象、fallback条件、変更componentへの影響を記録した。
- [ ] advertised feature IDs／protocol capabilitiesが互換性の根拠なら、changed／unchangedの組み合わせで必要featureがavailableになることをtestした。
- [ ] 解消できない完全一致、誤った文字列比較、mixed-version非互換が見つかった場合、version変更と公開を止めてscopeまたは実装方針を再決定した。

検索の出発点:

```sh
rg -n -g '*.js' -g '*.mjs' -g '*.ts' -g '*.cpp' -g '*.h' \
  '(version|Version|VERSION).{0,80}(===|!==|==|!=|>=|<=|>|<)|(===|!==|==|!=|>=|<=|>|<).{0,80}(version|Version|VERSION)' \
  html mcp extension platform src tests
```

検索結果だけで安全と判断せず、descriptor生成、normalization、feature negotiation、error pathも読みます。

## 2. Release candidate

- [ ] releaseに含むPR／commitと、意図的に除外する変更を記録した。
- [ ] scope matrixと3つのcanonical version sourceが一致した。
- [ ] changed componentだけversionを更新し、unchanged componentのversionと公開artifact内容を変更していない。
- [ ] CHANGELOG／release notesにchanged／unchangedと更新不要なcomponentを明記した。
- [ ] `./build.sh`が成功した。
- [ ] `npm test`が成功した。
- [ ] 変更箇所に対応するtargeted test／manual acceptance pathを追加し、結果を記録した。
- [ ] 省略したfeature-specific gateと、その影響ベースの理由を記録した。
- [ ] 最終diffにversion、generated artifact、権限、依存関係の意図しない変更がない。

Connectorが`changed`の場合だけ、最終の`./build.sh`とtestより後に`npm run pack:extension`を実行します。`./build.sh`は`dist/`を作り直し、先にpackしたConnector ZIPを削除するため、pack後は提出までbuildしません。Connectorが`unchanged`なら再packしません。

## 3. Tag と GitHub Release draft

- [ ] final release commitが意図したbase branchにあり、scope matrixとtest結果を指している。
- [ ] final release commitへannotated tag `v<version>`を作り、tag objectとpeeled commit SHAを記録した。
- [ ] tagをpushした。
- [ ] tagを対象にGitHub Releaseを**draft**で作成した。
- [ ] draft本文にchanged component、unchanged componentとその更新不要、公開予定channel、既知の制約を記載した。
- [ ] draftのtarget commitがannotated tagのpeeled commitと一致した。
- [ ] 全selected channelのproduction確認が終わるまでdraftを公開しない。

push済みtagは削除・移動しません。tag後に問題が見つかった場合は「8. 中止と復旧」に従い、新しいpatch versionでfix forwardします。

## 4. X1Pen Web channel

Webが`changed`の場合:

- [ ] deploy前に直前正常なCloudflare Pages deployment URL／IDとtagを記録した。
- [ ] deployment情報を取得できない場合、代替の復旧点とOwnerのrisk acceptanceをrelease logへ記録した。
- [ ] 最終release commitで`./build.sh`を実行した。
- [ ] `dist/x1pen-version.js`とbuild outputがtarget versionを示した。
- [ ] `npm run pages:deploy`を実行し、deployment URL／IDを記録した。
- [ ] productionをhard reload／cache無効化した。
- [ ] page表示、`X1PenAutomation.ready().x1pen.version`、status／feature descriptorがtarget versionと必要featureを示した。
- [ ] editor、通常RUN、変更featureのtargeted production smokeを実行した。
- [ ] unchangedのMCP／Connectorがある場合、現在公開中のversionとの接続と必要featureをsmoke testした。

Webが`unchanged`の場合はversion bumpとdeployを行いません。別componentの変更がWeb contractへ触れる場合だけmixed-version smokeを実施します。

## 5. x1pen-mcp channel

MCPが`changed`の場合:

- [ ] `mcp/package.json`、CHANGELOG、package内容、dependency graphを確認した。
- [ ] `npm whoami`と`npm run test:mcp-package`が成功した。
- [ ] `npm pack ./mcp`でtarball内容とversionを確認した。
- [ ] `npm publish ./mcp`を実行した。
- [ ] installを伴わない`npm view x1pen-mcp@<version> version`がtarget versionを示した。
- [ ] `npm view x1pen-mcp dist-tags --json`の`latest`が意図したversionを示した。

このprojectの`.npmrc`は公開から7日未満のpackageを除外するため、公開直後の`npx -y x1pen-mcp@<version> --version`は`ETARGET`になり得ます。原則7日後に確認します。どうしても公開直後に1回だけ必要なら、package内容とdependency graphを確認したうえで次を実行します。

```sh
npm_config_min_release_age=0 npx -y x1pen-mcp@<version> --version
```

このoverrideはtransitive dependencies全体のrelease-age制限を解除します。shell profileやCIへexportせず、`.npmrc`も変更しません。

MCPが`unchanged`の場合はpack／publish／dist-tag変更を行わず、scope matrixのversion据え置きと互換性監査だけを記録します。

## 6. X1Pen Connector channel

Connectorが`changed`の場合:

- [ ] Chrome Web Store Dashboardで現在公開中のversionと別の審査中draftがないことを確認した。
- [ ] 最終build／test後に`npm run pack:extension`を実行した。
- [ ] ZIP直下のmanifest version、ZIP全体SHA256、timestamp非依存のcontent digestを記録した。
- [ ] Store提出直前に同じ3項目を再確認し、不一致なら提出を止めて原因を調査した。
- [ ] ZIPを提出し、提出日時、artifact hashes、Dashboard statusを記録した。
- [ ] 審査用手順でtarget Web／MCPとの変更featureを再現した。
- [ ] Store公開後、実際のConnector versionとmixed-component statusを確認した。

```sh
CONNECTOR_VERSION=$(node -p "require('./extension/manifest.json').version")
ZIP="dist/x1pen-connector-${CONNECTOR_VERSION}.zip"
test -f "$ZIP"
unzip -p "$ZIP" manifest.json | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).version"
shasum -a 256 "$ZIP"
unzip -Z1 "$ZIP" | LC_ALL=C sort | while IFS= read -r entry; do
  case "$entry" in */) continue ;; esac
  entry_sha=$(unzip -p "$ZIP" "$entry" | shasum -a 256 | awk '{print $1}')
  printf '%s  %s\n' "$entry_sha" "$entry"
done | shasum -a 256
```

ZIP entry timestampによりwhole-file SHA256は再packごとに変わり得ます。content digestはentry名と各entry内容を比較するため、両方を記録します。

Connectorが`unchanged`の場合は再pack／hash固定／Store提出を行いません。再packは同じsourceでも新しいZIP hashを作るため「変更なし」とは扱いません。

## 7. Feature-specific regression addenda

scopeの影響に応じて選択します。選ばなかったaddendumは理由をrelease logへ記録します。versionはscope matrixのprevious／current／targetを使い、ここへ固定値を持ち込みません。

### Project disk／MODEL／ROMを変更した場合

- [ ] BASICでFDD0／FDD1を空にし、短いprogramをRUN、FDD0 Save、library再登録、working copy作成、cold-start実行までexact click pathを確認した。
- [ ] BASIC working copyに`LD.BIN`、`AUTOEXEC.BAT`、`FZBASIC.COM`と必要な同梱fileが残ることを確認した。
- [ ] SLANGでもSave、再登録、working copy、`PROG.COM` cold-start実行を確認した。
- [ ] X1、X1turbo、X1turboZでcold-startし、MODEL変更時のRAM／VRAM／PCG初期化を確認した。
- [ ] stub BIOSと、利用可能なら`IPLROM.X1`／`IPLROM.X1T`を別結果として記録した。
- [ ] 通常の一時PROGRAM disk RUNへMODEL選択を誤って広げていない。

### MCP／Connector／page contractを変更した場合

- [ ] scope matrixのprevious componentとrelease candidateを組み合わせ、backward-compatible機能とdegraded表示を確認した。
- [ ] previous componentで利用不能な新featureがfail closedし、target version／featureへの更新案内を返した。
- [ ] target component同士でfull feature setが成功した。
- [ ] input ownershipを変更した場合、disconnect／reload／session変更／resetでkey／padが解放された。
- [ ] mixed-versionの公開順と、各段階で許容するfeature setをrelease logへ記録した。

## 8. 中止と復旧

selected gateが失敗したらRelease公開を止め、理由と時刻をrelease logへ記録します。

- Tag／draft前: 問題を修正してrelease candidateを作り直します。
- Tag／draft後: pushed tagを削除・移動せず、Releaseをdraftのまま保持します。修正版は新しいpatch version／tagで作ります。
- Web deploy後: 記録したprior deploymentへrollbackします。deployment IDがない場合は、事前にOwnerが承認したprior tagなどの代替復旧点を使います。
- npm publish後: 公開versionは削除でなかったことにせず、必要なら`npm deprecate`で警告し、新versionを公開します。
- Connector審査失敗／却下: 現在公開中のConnectorを維持し、修正版を新versionで再提出します。
- 1channelだけ先に公開された場合: 公開済み／rollback済み／pendingをdraftへ明記し、mixed-version安全性が回復するまでReleaseを公開しません。

## 9. Production reconciliation と GitHub Release公開

- [ ] scopeで選択した全channelがliveで、targeted production smokeが成功した。
- [ ] unchanged componentの公開versionがscope matrixどおりで、必要なmixed-version接続が成功した。
- [ ] draft本文を実際の公開状態へ更新し、`pending`／`審査中`など古い前提を削除した。
- [ ] draftのtag／target commit、component versions、artifact hashes、既知の制約が実物と一致した。
- [ ] rollbackやabort中ではない。
- [ ] Releaseをdraftからpublishし、公開URLと日時をrelease logへ記録した。

## 10. Worked example: X1Pen Web 0.9.1

以下は非normativeなWeb-only patchの実例です。

| Component | Scope | Version | 実施内容 |
| --- | --- | --- | --- |
| X1Pen Web | `changed` | 0.9.0 → 0.9.1 | version／CHANGELOG、build、全test、deploy、hard reload、text rendering smoke |
| x1pen-mcp | `unchanged` | 2.7.0 | version比較／feature互換性監査、現行接続smoke。pack／publishなし |
| X1Pen Connector | `unchanged` | 1.3.0 | version比較／feature互換性監査、現行接続smoke。pack／Store提出なし |

実施した共通gate:

- `./build.sh`と`npm test`
- product versionの完全一致、minimum比較、lexicographic比較の監査
- annotated tag → GitHub Release draft → Web deploy → hard reload／下切れ修正確認 → Release公開

省略したgateと理由:

- Project disk exact click pathと全MODEL／ROM matrix: renderer patchの影響外。自動testと通常RUN smokeは実施。
- MCP tarball／npm publish: MCP sourceとversionが変更されていないため。
- Connector pack／ZIP hashes／Chrome Web Store: Connector source、manifest、公開artifactが変更されていないため。
- 旧Connectorを含むfull compatibility matrix: protocol／feature変更がなく、version比較監査と自動互換性testで非回帰を確認したため。公開中MCP／Connectorとの接続smokeは省略しなかった。

Deployment URL／IDは記録されませんでしたが、Ownerがproduction修正確認後に今回だけriskを受容しました。通常は「4. X1Pen Web channel」のrollback情報を先に記録します。

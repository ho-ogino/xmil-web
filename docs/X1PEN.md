# X1Pen — FuzzyBASIC IDE for SHARP X1

X1Pen は、ブラウザ上で SHARP X1 の BASIC (FuzzyBASIC) とZ80 アセンブリを書いて即座に実行できる Web IDE です。
[MSXPen](https://msxpen.com/) にインスパイアされて作られました。

## はじめに

X1Pen にアクセスするには、X millennium Web の `/x1pen` パスを開いてください。

画面は左側がコードエディタ、右側が X1 エミュレータです。

## エディタ

### BASIC タブ

FuzzyBASIC のプログラムを書きます。行番号付きの BASIC コードを入力してください。

```
10 PRINT "HELLO WORLD"
20 GOTO 10
```

**AUTO 行番号**: 行末で Enter を押すと、次の行番号が自動で入力されます。
行間に挿入する場合は中間の番号が計算されます。

### ASM タブ

Z80 アセンブリを書きます。BASIC から呼び出すマシン語ルーチンや、
画像・音楽データの定義に使います。

```
ORG 0E000h
    LD A,042h
    RET
```

対応する疑似命令: `ORG`, `DB`, `DW`, `DS`, `EQU`

**Import ボタン**: バイナリファイルを読み込んで、`DB $xx,$xx,...` 形式でカーソル位置に挿入します。
画像データや音楽データの取り込みに便利です。

### SLANG タブ

SLANGタブの **Import** ボタンは、binary fileを現在のcursor位置へ大文字の`$XX`値列として挿入します。16 bytesごとに改行し、値の間だけにカンマを入れます。末尾カンマ、label、`ARRAY`宣言、filename commentは生成しません。周囲のsourceは解析しないため、必要なカンマや括弧は利用者が用意してください。

空fileは拒否します。最大読込sizeはASM Importと同じ128 KiBで、64 KiBを超える場合はshareへの影響を警告します。この上限はimporterがfileを読む上限であり、生成された配列がSLANG compilerやX1のaddress spaceへ収まることを保証しません。大きなassetはDisk Editorでproject diskへ追加し、`MAGLOAD`または`FOPEN`／`FREAD`で読む方法も検討してください。

### HuBASIC タブ（試験中）

HuBASIC（CZ-8FB01 系）の行番号付きプログラムを書くタブです。編集欄は **X1 BASIC Editor**（https://github.com/ho-ogino/x1-basic-editor）で、プログラムを X1 の文字コードのバイト列のまま扱います。X1 の 8×8 の字形で表示し、カナ（IME）・グラフィック文字（右の文字パレット、`\{heart}` などの記号名）・制御コードを書けます。

- プログラムは X1Pen が自動で保存します（ほかのタブと同じ）。エディタの「エクスポート」はファイルへの書き出し（ダウンロード）、「インポート…」はファイルからの読み込みです（アスキーセーブしたファイルをそのまま読めます）。単独アプリにある「新規」「別名で保存…」は、X1Pen の中では出ません。
- Ctrl+S（エクスポート）/ Ctrl+O（インポート）/ Ctrl+F（検索）などのキーは、エディタの操作になります（ブラウザの「ページを保存」などは開きません）。
- 右の欄（文字パレット・PCG）は、上の「右欄を隠す」で畳めます。狭いウィンドウではこちらを使ってください。
- 表示の字形は、X1Pen の設定で 8×8 のフォント（FNT0808.X1）を登録していればそれを、なければ内蔵の X1 互換フォント（美咲フォント由来）を使います。「.X1 を読み込む…」で選んだフォントは、ページを読み直すまで使われます。
- 「選択からPCG設定」で、プログラムの中の PCG の定義を表示に反映できます。
- 閉じた文字列（`"…"`）にマウスを置いて少し待つと、その文字列を 1 枚の絵で出します。矢印の制御コード（$1C〜$1F）でカーソルを動かした並びのまま、通常の文字も PCG も描きます（カラーコード 7 の前提。PCG は PCG 表示が ON のとき、「選択からPCG設定」で反映した定義で描きます）。ほかの制御コードは省きます。通常の文字は、表示に使っているフォントの 8×8 のドットのまま描きます。絵はエディタの枠の中に収まるよう縮めて出します。プログラムは変わりません。

RUN すると、次の順に動きます。

1. hubasic2sl（SLANG-compiler の HuBASIC → SLANG 変換。ブラウザの中で .NET の wasm として動きます）で SLANG に変換
2. X1Pen の SLANG コンパイラとアセンブラで、OS なしの x1native 環境（$1000 から）の機械語に組み立て
3. メモリに収まるか（作業領域が $FFE0 より前で終わるか）を確かめる
4. HuBASIC の IPL で起動できるディスク（SLFS、2D）を作り、FDD0 に一時ディスクとして入れる
5. 本体の電源を入れ直し、IPL からディスクを起動する（RAM・VRAM・PCG は消えます）

- 対応している命令・関数、本物の HuBASIC との違いは、SLANG-compiler の `docs/HUBASIC.md` を見てください（アルファ版です）。
- 変換・組み立てで止まったときは、ステータス欄に段階と最初のエラーを出し、ディスクも本体も変えません。
- 最初に RUN したときに変換の仕組み（約 1.7MB、圧縮後）を読み込みます。HuBASIC タブを使わなければ読み込みません。
- 変換にはエディタのバイト列をそのまま渡します（hubasic2sl の X1 の文字コードの読み方）。
- X1Pen の外（保存や自動操作の `getProgram` / `setProgram` の `hubasic`）では、プログラムは文字列です。書き方は次のとおりです。
  - 英数字はそのまま、カナは半角カナ、$5C は `¥`
  - 名前のある記号は `\{heart}` など、そのほかは `\xHH`
  - 改行は `\n`（X1 のバイト列では CR LF）
  - `setProgram` では全角カナ・ひらがな・`♥` なども受け付けます。X1 で表せない文字（漢字など）があると、何も変えずにエラーにします。
- 外から（自動操作などで）プログラムを入れ替えると、エディタの「元に戻す」の履歴とカーソルの位置は消えます。

#### 変換のオプション

HuBASIC タブの上の「Options」で、hubasic2sl の変換のオプションを設定できます。

- 設定はすべての HuBASIC プログラムに共通で、1 つだけです。ブラウザ（localStorage の `x1pen_hubasic_options`）に保存し、次の RUN から使います。
- 既定から変えているときは、ボタンが「Options •」になります。
- 触っていなければ、これまでと同じに変換します（既定の値は変換に渡しません）。

| 項目 | hubasic2sl | 意味 |
|---|---|---|
| 速度 | `--wait` | 待たない（既定）／行ごとに待つ（各行の頭で N × 約 0.1 ms。450〜500 で HuBASIC に近い速さ）／`'#VSYNC` コメントで待つ（`'#VSYNC n` のコメントの所で n フレーム。n が無いときは N） |
| 行番号を記録しない | `--no-line-numbers` | 小さく速くなります。実行時エラーに行番号が出ません |
| 型の無い変数を整数にする | `--assume-defint` | 接尾辞も DEFxxx も無い変数を整数にします（HuBASIC の既定は単精度） |
| 文字列の長さの上限 | `--string-len` | 1〜255（既定 255） |
| 静的データの上限 | `--data-budget` | 1〜65535 バイト（既定 24576） |

- `'#VSYNC n` のコメントは、速度が「`'#VSYNC` コメントで待つ」のときだけ効きます。`VSYNC` 文は、設定によらずいつも待ちます。
- N は 1〜65535 です。
- Share の画面（`?id=`）では、保存済みの設定を読みますが、そこで変えた設定は保存しません。HuBASIC の共有を開いたときは、共有に載っている設定を使います（載っていない項目は既定）。
- 自動操作からは `X1PenAutomation.getHuBasicOptions()` / `setHuBasicOptions(patch)` で読み書きします。
  - 値は `{ wait: 'none' | 'line:N' | 'frame:N', noLineNumbers, assumeDefint, stringLen, dataBudget }` です。
  - `setHuBasicOptions` は渡した項目だけを変え、`null` の項目は既定に戻します。
  - 知らない項目や範囲の外の値があると `TypeError` で、何も変えません。
  - RUN の準備中は `RUN_PENDING` で断ります。
  - 設定はプログラムの一部ではないので、`getProgram` には入らず、`revision` も変わりません。
  - feature `hubasic.options` を申告します（X1Pen・X1Pen Connector・x1pen-mcp でそろえる名前）。
- Share はこの設定を運びます（下の「Share（共有）」）。x1pen-mcp からは `x1pen_get_hubasic_options` / `x1pen_set_hubasic_options` で読み書きできます（[X1PEN_MCP.md](X1PEN_MCP.md) の「HuBASIC」）。
- 前の版（素の編集欄）で保存した HuBASIC のプログラムは、最初に開いたときに一度だけ移します。X1 で表せない文字は `?` になり、ステータス欄でお知らせします。元の文字列は localStorage の `x1pen_editor_hubasic` に残ります。
- スマートフォンなど狭い画面では、エディタの右の欄が場所を取ります（「右欄を隠す」で畳むか、境界をドラッグして狭められます）。
- 複数のタブに内容があるときは、HuBASIC を優先して実行します。
- FDD0 にライブラリのディスクや外部のメディアが入っているときは RUN できません（取り出してください）。FDD1 などほかのドライブはそのままです。
- Share できます（下の「Share（共有）」）。x1pen-mcp からも読み書きできます（2.8.0 から。HuBASIC のリファレンスは 2.9.0 から。[X1PEN_MCP.md](X1PEN_MCP.md) の「HuBASIC」と、下の「注意事項」）。

## 実行

**RUN ボタン** または **Ctrl+Enter** で実行します。

- BASIC タブの内容がトークナイズされ、エミュレータのメモリに注入されます
- ASM タブに内容がある場合は、アセンブルされて `PROGRAM.BIN` としてディスクに書き込まれます
- BASIC 側から `BLOAD "PROGRAM.BIN",&HE000` のようにしてマシン語をロードできます

### BASIC + ASM の連携例

**BASIC タブ**:
```
10 LIMIT &HBFFF
20 BLOAD "PROGRAM.BIN",&HC000
30 A=USR(&HC000)
40 PRINT "A=";A
```

**ASM タブ**:
```
ORG 0C000h
    LD HL,42h
    RET
```

- `LIMIT &HBFFF` で BASIC のメモリ上限を設定し、`&HC000` 以降をマシン語用に確保します
- ASM のルーチンが `&HC000` に配置され、BASIC の `USR(&HC000)` で呼び出されます
- FuzzyBASIC では `USR` の戻り値は HL レジスタに入れます

## PROGRAM ディスク、project disk、AUTORUN.BAS

FDD0に通常のライブラリディスクをマウントしていない状態でRUNすると、従来どおり一時的な「(PROGRAM)」ディスクがマウントされます。
このディスクには以下が含まれます:

| ファイル | 内容 |
|---------|------|
| `PROGRAM.BIN` | ASM のアセンブル結果（バイナリ） |
| `AUTORUN.BAS` | BASIC タブのトークナイズ済みプログラム |

また、ベースディスクには以下のファイルがあらかじめ含まれており、
BASIC プログラムから自由に利用できます:

| ファイル | 内容 |
|---------|------|
| `MAGIC.BIN` | グラフィックパッケージ MAGIC |
| `PSGAKG.BIN` | Arkos Tracker AKG 形式の再生ドライバ |
| `PSGAKM.BIN` | Arkos Tracker AKM 形式の再生ドライバ |

### FDD0をproject diskとして使う

書き込み可能なLSX-Dodgers形式のD88/2DディスクをライブラリからFDD0へマウントしてRUNすると、初回だけ確認後に`<元の名前>-X1Pen`という別のworking copyを作成します。同名時は連番が付きます。元ディスクへX1Pen管理ファイルを書き込まず、working copyへ`PROG.COM`、`PROGRAM.BIN`、`AUTORUN.BAS`、`AUTOEXEC.BAT`を更新します。

- working copyにはproject metadataが付くため、X1Penを閉じて再度マウントしてもコピーは増えません
- guestによるディスク書き込みとRUN結果はライブラリへ自動保存されます
- FDD1は変更・イジェクトされず、2枚目のデータディスクとして利用できます
- multi-disk D88、HuBASICなどLSX-Dodgers以外の形式、write-protectedまたは異常のあるディスクは拒否します
- 検査するのはファイルシステム構造だけです。正常なbootやプログラム開始は保証しません
- project diskのRUNは通常のcold power-onを行うため、現在のエミュレータRAMは消去されます

MCP/Automationから通常ディスクを初めて使う場合は`PROJECT_DISK_SETUP_REQUIRED`になります。X1Pen画面で一度RUNしてworking copy作成を承認した後に再実行してください。

### ディスクイメージのダウンロード

一時PROGRAMディスクは、エミュレータ下部のコントロールバーで **FDD** → FDD0 の **Save** ボタンをクリックすると、
`PROGRAM.d88` としてディスクイメージをダウンロードできます。

project diskはRUNとguest writeのたびライブラリへ自動保存されます。外部D88として保存する場合はライブラリ一覧の **Download** を使用してください。

このディスクには LSX-Dodgers と FuzzyBASIC が含まれており、そのままブートできる起動ディスクです。
X millennium Web 本体のエミュレータで FDD にマウントして起動すれば、AUTORUN.BAS が自動実行されます。

### 安全なproject diskベースを作る

手元にboot可能なLSX-Dodgers diskがない場合は、X1Pen自身が作る一時PROGRAM diskをベースにできます。

1. FDD0とFDD1を空にし、BASICまたはSLANGで短いプログラムを書いてRUNします。
2. **FDD** → FDD0の **Save** で`PROGRAM.d88`を保存します。
3. `PROGRAM.d88`をファイルライブラリへ追加し、FDD0へマウントします。
4. MODELを選び、もう一度RUNして`<元の名前>-X1Pen` working copyの作成を承認します。
5. cold start後にプログラムが実行されることを確認します。元の`PROGRAM.d88`は再利用できる安全なベースとして保管してください。

この方法では元ディスクに含まれる`LD.BIN`、`AUTOEXEC.BAT`、`MAGIC.BIN`、`PSGAKM.BIN`、`PSGAKG.BIN`が保持されます。BASIC用ディスクには`FZBASIC.COM`も含まれます。X1PenはBASICで`PROGRAM.BIN`／`AUTORUN.BAS`、SLANGで`PROG.COM`をworking copyへ書き込みます。

### MODEL切り替えの制約

- MODEL切り替えを適用できるのは、libraryのproject diskから行うcold-start RUNです。通常の一時PROGRAM disk／cold stateを使うRUNの途中ではMODELを切り替えられません。
- cold startではCPU stateに加えてRAM、VRAM、PCGが初期化され、未保存の内容は消えます。必要なdisk writeを保存してから切り替えてください。
- X1では`IPLROM.X1`、X1turbo／X1turboZでは`IPLROM.X1T`を使用します。ROM未登録時は内蔵stub BIOSで最低限の起動ができますが、実IPL ROMと動作が異なるsoftwareがあります。stubでの起動確認は実ROMでの互換性保証ではなく、その逆も同様です。利用者が合法的に用意した実IPL ROMでの確認を推奨します。
- project diskの検証はfilesystem構造、保存、mountまでです。任意のdiskが選択MODEL／ROMでbootし、guest programを開始することまでは保証しません。

## Share（共有）

**Share ボタン**をクリックすると、BASIC と ASM の内容が共有用 URL としてクリップボードにコピーされます。

- 共有 URL を開くと、コードが自動で読み込まれ実行されます
- MODEL（X1 / X1turbo / X1turboZ）やランタイムバージョンも記録されます
- 音声は自動再生ポリシーによりミュートされます。エミュレータ画面をクリックすると有効になります
- HuBASIC タブのプログラムも共有できます。
  - 共有されるのは、プログラム（X1 の文字コードのバイト列そのまま）、変換のオプション（既定と違うものだけ）、MODEL です。
  - 開くと、共有したときと同じバイト列・同じ変換のオプション・同じ MODEL で RUN します。
  - 2 回目からの RUN は、開いた人の MODEL の設定を使います（ほかのタブの共有と同じ）。変換のオプションは、その画面の間は共有のものを使います。
  - その画面からもう一度 Share すると、その画面で最後に RUN した MODEL を載せます（RUN できなかったときは共有の MODEL。MODEL を選び直したときは、その MODEL）。
  - 開いた人の保存済みのプログラム・変換のオプション・本体の設定は変わりません。
  - 共有に変換のオプションが無いときは、すべて既定で変換します（開いた人の設定は使いません）。
  - 共有のプログラムが読めないときは、「Shared HuBASIC program could not be read」と出し、何も実行しません。

## 文字入力

### カタカナ

全角・半角どちらのカタカナでも入力できます。X1 の文字コード（JIS X 0201 カナ）に自動変換されます。

- 全角: `アイウエオ` → そのまま変換
- 半角: `ｱｲｳｴｵ` → 同じ X1 コードに変換
- 濁音・半濁音: `ガ` `パ` → 2バイト（清音 + 濁点/半濁点）に自動展開

カギカッコ `「」` も全角・半角問わず変換されます。

### 罫線・漢字の直接入力

一部の Unicode 文字は X1 コードに直接変換されます:

- 罫線: `─` `│` `┌` `┐` `└` `┘` `├` `┤` `┬` `┴` `┼`
- 漢字: `日` `月` `火` `水` `木` `金` `土` `時` `分` `秒` `年` `円` `人` `生`
- 記号: `×` `¥` `〒`

### 名前付きエスケープ `\{name}`

キーボードで入力しにくい X1 特殊文字は、名前で指定できます:

```
10 PRINT "\{heart}\{heart}\{heart}"
20 PRINT "\{box_tl}\{box_h}\{box_h}\{box_tr}"
```

主な名前:

| 名前 | 文字 | 名前 | 文字 |
|------|------|------|------|
| `heart` | ♥ | `spade` | ♠ |
| `diamond` | ♦ | `club` | ♣ |
| `circle` | ○ | `circle_fill` | ● |
| `square` | □ | `cross` | × |
| `box_tl` | ┌ | `box_tr` | ┐ |
| `box_bl` | └ | `box_br` | ┘ |
| `box_h` | ─ | `box_v` | │ |

その他: `vfill1`-`vfill8`, `hfill1`-`hfill7`, `gray`, `sunday`-`saturday`,
`hour`, `minute`, `second`, `year`, `yen`, `hito`, `sei`, `postal` など

### 直接バイト指定 `\xNN`

テーブルにない X1 文字コードは、16進数で直接指定できます:

```
10 PRINT "\xE3"
```

`\xE3` は X1 の $E3（ハートマーク）を出力します。

### 文字コード一覧

全文字の入力方法は [Character Map](../html/x1pen_charmap.html) で確認できます。

### 未対応文字

変換テーブルにない非 ASCII 文字を入力すると、エラーになります。
`\xNN` または `\{name}` で指定してください。

## エミュレータ コントロール

エミュレータ画面の下にコントロールバーがあります:

| ボタン | 機能 |
|--------|------|
| **MACHINE** | IPL Reset / NMI（実 NMI。復旧が必要な場合は IPL Reset） / Resolution / Start Disk |
| **FDD** | FDD0/1 のマウント・イジェクト・Save |
| **HDD** | HDD0/1 のマウント・イジェクト |
| **CMT** | カセットテープの操作 |
| **EMM** | 拡張メモリの管理 |
| **MODEL** | X1 / X1turbo / X1turboZ の切り替え |
| **OPT** | FM音源・モーター音・ジョイスティック・キーモード・ROM/フォント管理 |

## キーボードショートカット

| キー | 動作 |
|------|------|
| **Ctrl+Enter** | RUN（どちらのタブでも） |
| **Tab** | 4スペースインデント |
| **Shift+Tab** | アンインデント（複数行選択時） |
| **Ctrl+F** | 検索 |
| **Ctrl+Z** / **Ctrl+Shift+Z** | Undo / Redo |

RUNの準備中はRUNボタンがbusy表示になり、連打やCtrl+Enterの再入力は無視されます。Automation/MCPから同時にRUNされた場合も、先に受理された1件だけが実行されます。

## 自動保存

エディタの内容はブラウザの localStorage に自動保存されます。
ページをリロードしても内容は保持されます。
BASIC タブと ASM タブはそれぞれ独立して保存されます。

## 注意事項

- HuBASIC タブのプログラムを開いている（いまのソースが HuBASIC の）間は、公開済みの x1pen-mcp 2.7.x の `x1pen_get_program` などが `invalid source mode` で止まります。ほかのタブのプログラムには影響しません。x1pen-mcp 2.8.0 で直ります
- エディタにフォーカスがある間、エミュレータは一時停止します（スクロール時の負荷軽減のため）
- エミュレータ画面をクリックすると再開します
- 共有 URL のプログラムはサーバーに保存されます

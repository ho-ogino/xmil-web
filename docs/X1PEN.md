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

## PROGRAM ディスクと AUTORUN.BAS

ASM タブに内容がある状態で RUN すると、FDD0 に「(PROGRAM)」ディスクがマウントされます。
このディスクには以下が含まれます:

| ファイル | 内容 |
|---------|------|
| `PROGRAM.BIN` | ASM のアセンブル結果（バイナリ） |
| `AUTORUN.BAS` | BASIC タブのトークナイズ済みプログラム |

### ディスクイメージのダウンロード

エミュレータ下部のコントロールバーで **FDD** → FDD0 の **Save** ボタンをクリックすると、
`PROGRAM.d88` としてディスクイメージをダウンロードできます。

このディスクには LSX-Dodgers と FuzzyBASIC が含まれており、そのままブートできる起動ディスクです。
X millennium Web 本体のエミュレータで FDD にマウントして起動すれば、AUTORUN.BAS が自動実行されます。

## Share（共有）

**Share ボタン**をクリックすると、BASIC と ASM の内容が共有用 URL としてクリップボードにコピーされます。

- 共有 URL を開くと、コードが自動で読み込まれ実行されます
- MODEL（X1 / X1turbo / X1turboZ）やランタイムバージョンも記録されます
- 音声は自動再生ポリシーによりミュートされます。エミュレータ画面をクリックすると有効になります

## エミュレータ コントロール

エミュレータ画面の下にコントロールバーがあります:

| ボタン | 機能 |
|--------|------|
| **MACHINE** | IPL Reset / NMI Reset / Resolution / Start Disk |
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

## 自動保存

エディタの内容はブラウザの localStorage に自動保存されます。
ページをリロードしても内容は保持されます。
BASIC タブと ASM タブはそれぞれ独立して保存されます。

## 注意事項

- エディタにフォーカスがある間、エミュレータは一時停止します（スクロール時の負荷軽減のため）
- エミュレータ画面をクリックすると再開します
- 共有 URL のプログラムは Cloudflare D1 に保存されます

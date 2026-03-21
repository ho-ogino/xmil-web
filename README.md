# X millennium Web

SHARP X1 シリーズ（X1 / X1turbo / X1turboZ）のエミュレータ「X millennium」を WebAssembly に移植した Web 版です。
ブラウザ上でインストール不要で X1 のソフトウェアを動作させることができます。

## 機能

- X1 / X1turbo / X1turboZ をサポート
- フロッピーディスク（D88 / 2D 形式）
- カセットテープ（CAS / CMT / TAP 形式、APSS ヘッドサーチ対応）
- SASI ハードディスク（最大 2 スロット）
- PSG / FM 音源（YM2151）
- ファイルライブラリ（ブラウザストレージに保存・自動再マウント）
- ステートセーブ / ロード（クイックセーブ・上書きモード対応）
- ソフトキーボード（X1 配列準拠・テンキー・カーソルキー付き）
- Google Drive 連携（drive.file スコープのみ使用）
- フルスクリーン対応（ダブルクリック）
- 4096 色モード（turboZ）
- **[X1Pen](docs/X1PEN.md)** — ブラウザ上で FuzzyBASIC + Z80 アセンブリを書いて即実行できる Web IDE

## 必要な ROM

ROM イメージは著作権物のため同梱していません。実機または合法的な手段で入手してください。

最低限の動作を可能にするスタブ BIOS が内蔵されており、IPL ROM がなくても起動できます。
より正確なエミュレーションのため、実機の ROM の使用を推奨します。

| ファイル名 | 内容 | 備考 |
|---|---|---|
| `IPLROM.X1` | IPL ROM（標準 X1 用） | 任意（省略時はスタブ BIOS で動作） |
| `IPLROM.X1T` | IPL ROM（X1turbo / turboZ 用） | 任意（省略時はスタブ BIOS で動作） |
| `FNT0808.X1` | CG-ROM（ANK 8×8） | 任意（内蔵フォントで代替可） |
| `FNT0816.X1` | CG-ROM（ANK 8×16） | 任意 |
| `FNT1616.X1` | CG-ROM（漢字 16×16） | 任意（漢字表示に必要） |

## 動作環境

WebAssembly に対応したブラウザ（Chrome / Firefox / Safari / Edge 最新版）

ファイルはブラウザの OPFS（Origin Private File System）または IndexedDB に保存されます。

> **注意**: `file://` での直接起動は動作しません。HTTP サーバー経由でアクセスしてください。

## プライバシー

読み込んだ ROM・ディスクイメージ・設定はすべてブラウザ内にのみ保存されます。これらのファイルがサーバーに送信されることはありません。エミュレーション処理もブラウザ内で完結します。

Google Drive 連携を使用する場合も、ファイルのやり取りはユーザーの Google アカウントとの間で直接行われます。現在の実装で要求するアクセス権は **drive.file スコープのみ**（このアプリが作成したファイルにのみアクセス可能）です。

## ビルド方法

Emscripten SDK が必要です。[インストール手順](https://emscripten.org/docs/getting_started/downloads.html)

```bash
./build.sh
```

ビルド後、`build/` に以下のファイルが生成されます：

- `index.html` — ランディングページ
- `xmillennium.html` — エミュレータ本体
- `xmillennium.js` / `xmillennium.wasm`

## ローカルでの実行

```bash
cd build
python3 -m http.server 8000
# ブラウザで http://localhost:8000/ を開く
```

## Google Drive 連携の設定

Google Drive 連携を使用するには、Google Cloud Console で OAuth クライアント ID を取得し、`html/config.js` を作成してください。

```bash
cp html/config.js.example html/config.js
```

`config.js` を編集し、取得したクライアント ID を設定します：

```javascript
window.XmilConfig = {
    DRIVE_CLIENT_ID: 'your-client-id.apps.googleusercontent.com'
};
```

> **注意**: `config.js` は `.gitignore` に含まれているため、リポジトリにはコミットされません。

Google Cloud Console での設定手順：
1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. Google Drive API と Google Picker API を有効化
3. OAuth 同意画面を設定（スコープ: `drive.file`）
4. OAuth 2.0 クライアント ID を作成（種類: ウェブアプリケーション）
5. 承認済みの JavaScript 生成元にホスティング先のオリジンを追加

## クレジット・権利情報

- **X millennium**（原作）: ぷにゅ氏
- **T_tune 改変版**: 原作をベースに機能追加・チューニングを施した版。本プロジェクトはこちらのソースを使用しています。
- **PSG / FM 音源エミュレーション**: Tatsuyuki Satoh（fm.c v0.37, MAME Project）/ 旧 MAME License（非商用）→ 詳細は [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)
- **FDD シミュレーションデータ**: nerd 氏
- **Web 版移植**: ひろし☆H.O SOFT — Emscripten（WebAssembly）による移植。原作の頒布条件（フリーウェア・非商用・無保証）を継承します。

SHARP および X1 は株式会社シャープの商標または登録商標です。本ソフトウェアはシャープ株式会社とは無関係の非公式プロジェクトです。
ROM イメージは著作権物のため同梱していません。

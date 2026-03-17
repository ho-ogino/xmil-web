#!/bin/bash

# X millennium Web - ビルドスクリプト

set -e

# スクリプトの場所を先頭で確定（cd する前に取得しないと相対パスがズレる）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "======================================"
echo "X millennium Web - Build Script"
echo "======================================"
echo ""

# Emscripten環境の設定
# EMSDK 環境変数が未設定の場合、よくある場所を順に探す
if [ -z "$EMSDK" ]; then
    for _candidate in \
        "$HOME/emsdk" \
        "$HOME/projects/emsdk" \
        "/opt/emsdk" \
        "/usr/local/emsdk"
    do
        if [ -f "$_candidate/emsdk_env.sh" ]; then
            echo "Setting up Emscripten environment from $_candidate..."
            source "$_candidate/emsdk_env.sh"
            break
        fi
    done
fi

# Emscriptenの確認
if ! command -v emcc &> /dev/null; then
    echo "Error: Emscripten (emcc) not found!"
    echo "Please install Emscripten SDK and run 'source emsdk_env.sh'"
    exit 1
fi

echo "Emscripten version:"
emcc --version
echo ""

# ビルドディレクトリの作成
echo "Creating build directory..."
mkdir -p build
cd build

# CMakeの実行
echo "Running CMake..."
emcmake cmake .. -DCMAKE_BUILD_TYPE=Release

# ビルド
echo "Building..."
emmake make -j$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

# CMakeLists.txt からバージョン文字列を取得
XMIL_VERSION=$(grep 'set(XMIL_VERSION' "${SCRIPT_DIR}/CMakeLists.txt" | sed 's/.*"\(.*\)".*/\1/')
COLD_STATE_FILE="fuzzybasic_cold.v1.xmst"
BOOT_DISK_FILE="fuzzybasic_boot.v1.d88"

# HTML/JS ファイルを build/ に同期（WASM 再コンパイルなしで更新できるよう明示コピー）
echo "Copying HTML/JS files..."
cp "${SCRIPT_DIR}/html/index.html"           ./index.html
cp "${SCRIPT_DIR}/html/pre.js"               ./pre.js
cp "${SCRIPT_DIR}/html/storage.js"           ./storage.js
cp "${SCRIPT_DIR}/html/drive_integration.js" ./drive_integration.js
cp "${SCRIPT_DIR}/html/disk_container.js"   ./disk_container.js
cp "${SCRIPT_DIR}/html/disk_fs.js"          ./disk_fs.js
cp "${SCRIPT_DIR}/html/disk_editor.js"      ./disk_editor.js
cp "${SCRIPT_DIR}/html/library.css"        ./library.css
cp "${SCRIPT_DIR}/html/ui_fragments.js"   ./ui_fragments.js
cp "${SCRIPT_DIR}/html/favicon.svg"          ./favicon.svg
cp "${SCRIPT_DIR}/html/manifest.json"       ./manifest.json
cp "${SCRIPT_DIR}/html/icon-192.png"        ./icon-192.png
cp "${SCRIPT_DIR}/html/icon-512.png"        ./icon-512.png
cp "${SCRIPT_DIR}/html/apple-touch-icon.png" ./apple-touch-icon.png

# X1Pen IDE ファイル
cp "${SCRIPT_DIR}/html/x1pen.html"           ./x1pen.html
cp "${SCRIPT_DIR}/html/x1pen.js"             ./x1pen.js
cp "${SCRIPT_DIR}/html/x1pen_tokenizer.js"   ./x1pen_tokenizer.js
cp "${SCRIPT_DIR}/html/x1pen_z80asm.js"     ./x1pen_z80asm.js
[ -f "${SCRIPT_DIR}/assets/${COLD_STATE_FILE}" ] && \
    cp "${SCRIPT_DIR}/assets/${COLD_STATE_FILE}" "./${COLD_STATE_FILE}"
[ -f "${SCRIPT_DIR}/assets/${BOOT_DISK_FILE}" ] && \
    cp "${SCRIPT_DIR}/assets/${BOOT_DISK_FILE}" "./${BOOT_DISK_FILE}"

echo ""
echo "======================================"
echo "Build completed successfully!"
echo "======================================"

# ── デプロイ用 dist/ ディレクトリを作成 ──────────────────────────
# build/ には CMake のビルドアーティファクトが混在しているため、
# デプロイに必要なファイルだけを dist/ に集める。
echo ""
echo "Creating dist/ for deployment..."
DIST_DIR="${SCRIPT_DIR}/dist"
rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

# Emscripten 生成物
cp ./xmillennium.html "${DIST_DIR}/"
cp ./xmillennium.js   "${DIST_DIR}/"
cp ./xmillennium.wasm "${DIST_DIR}/"

# HTML / JS
cp ./index.html           "${DIST_DIR}/"
cp ./licenses.html        "${DIST_DIR}/"
cp "${SCRIPT_DIR}/html/privacy.html" "${DIST_DIR}/"
cp "${SCRIPT_DIR}/html/terms.html"   "${DIST_DIR}/"
cp ./storage.js           "${DIST_DIR}/"
cp ./drive_integration.js "${DIST_DIR}/"
cp ./disk_container.js   "${DIST_DIR}/"
cp ./disk_fs.js          "${DIST_DIR}/"
cp ./disk_editor.js      "${DIST_DIR}/"
cp ./library.css          "${DIST_DIR}/"
cp ./ui_fragments.js      "${DIST_DIR}/"
cp ./favicon.svg          "${DIST_DIR}/"
[ -f ./favicon.ico ] && cp ./favicon.ico "${DIST_DIR}/"
cp ./manifest.json        "${DIST_DIR}/"
cp ./icon-192.png         "${DIST_DIR}/"
cp ./icon-512.png         "${DIST_DIR}/"
cp ./apple-touch-icon.png "${DIST_DIR}/"

# Cloudflare Pages ヘッダー / リダイレクト
[ -f "${SCRIPT_DIR}/html/_headers" ] && cp "${SCRIPT_DIR}/html/_headers" "${DIST_DIR}/_headers"
[ -f "${SCRIPT_DIR}/html/_redirects" ] && cp "${SCRIPT_DIR}/html/_redirects" "${DIST_DIR}/_redirects"

# X1Pen IDE
cp "${SCRIPT_DIR}/html/x1pen.html"           "${DIST_DIR}/"
cp "${SCRIPT_DIR}/html/x1pen.js"             "${DIST_DIR}/"
cp "${SCRIPT_DIR}/html/x1pen_tokenizer.js"   "${DIST_DIR}/"
cp "${SCRIPT_DIR}/html/x1pen_z80asm.js"     "${DIST_DIR}/"
[ -f "${SCRIPT_DIR}/assets/${COLD_STATE_FILE}" ] && \
    cp "${SCRIPT_DIR}/assets/${COLD_STATE_FILE}" "${DIST_DIR}/"
[ -f "${SCRIPT_DIR}/assets/${BOOT_DISK_FILE}" ] && \
    cp "${SCRIPT_DIR}/assets/${BOOT_DISK_FILE}" "${DIST_DIR}/"

# Pages Functions (Cloudflare Workers)
if [ -d "${SCRIPT_DIR}/functions" ]; then
    cp -r "${SCRIPT_DIR}/functions" "${DIST_DIR}/functions"
fi

# Google Search Console 所有権確認ファイル（あれば）
for f in "${SCRIPT_DIR}"/html/google*.html; do
    [ -f "$f" ] && cp "$f" "${DIST_DIR}/"
done

# バージョン文字列を注入（@@XMIL_VERSION@@ → 実際のバージョン）
sed -i.bak "s/@@XMIL_VERSION@@/${XMIL_VERSION}/g" \
    "${DIST_DIR}/xmillennium.html" \
    "${DIST_DIR}/index.html" \
    "${DIST_DIR}/x1pen.html"
rm -f "${DIST_DIR}/xmillennium.html.bak" "${DIST_DIR}/index.html.bak" "${DIST_DIR}/x1pen.html.bak"

# config.js: html/config.js があればそれを使用、なければ空の example を使用
if [ -f "${SCRIPT_DIR}/html/config.js" ]; then
    cp "${SCRIPT_DIR}/html/config.js" "${DIST_DIR}/config.js"
else
    cp "${SCRIPT_DIR}/html/config.example.js" "${DIST_DIR}/config.js"
fi

echo ""
echo "Output files (dist/):"
echo "  - index.html        (ランディングページ)"
echo "  - xmillennium.html  (エミュレータ本体)"
echo "  - xmillennium.js"
echo "  - xmillennium.wasm"
echo "  - licenses.html"
echo ""
echo "To run locally (static only):"
echo "  cd dist && python3 -m http.server 8000"
echo ""
echo "To run with Pages Functions + D1 (Share 機能含む):"
echo "  wrangler pages dev dist/"
echo ""

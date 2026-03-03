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

# HTML/JS ファイルを build/ に同期（WASM 再コンパイルなしで更新できるよう明示コピー）
echo "Copying HTML/JS files..."
cp "${SCRIPT_DIR}/html/index.html"           ./index.html
cp "${SCRIPT_DIR}/html/pre.js"               ./pre.js
cp "${SCRIPT_DIR}/html/storage.js"           ./storage.js
cp "${SCRIPT_DIR}/html/drive_integration.js" ./drive_integration.js
cp "${SCRIPT_DIR}/html/favicon.svg"          ./favicon.svg
cp "${SCRIPT_DIR}/html/manifest.json"       ./manifest.json
cp "${SCRIPT_DIR}/html/icon-192.png"        ./icon-192.png
cp "${SCRIPT_DIR}/html/icon-512.png"        ./icon-512.png
cp "${SCRIPT_DIR}/html/apple-touch-icon.png" ./apple-touch-icon.png

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
cp ./favicon.svg          "${DIST_DIR}/"
[ -f ./favicon.ico ] && cp ./favicon.ico "${DIST_DIR}/"
cp ./manifest.json        "${DIST_DIR}/"
cp ./icon-192.png         "${DIST_DIR}/"
cp ./icon-512.png         "${DIST_DIR}/"
cp ./apple-touch-icon.png "${DIST_DIR}/"

# Cloudflare Pages ヘッダー（frame-ancestors 等）
[ -f "${SCRIPT_DIR}/html/_headers" ] && cp "${SCRIPT_DIR}/html/_headers" "${DIST_DIR}/_headers"

# Google Search Console 所有権確認ファイル（あれば）
for f in "${SCRIPT_DIR}"/html/google*.html; do
    [ -f "$f" ] && cp "$f" "${DIST_DIR}/"
done

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
echo "To run the emulator:"
echo "  1. cd dist"
echo "  2. python3 -m http.server 8000"
echo "  3. Open http://localhost:8000/ in your browser"
echo ""

cmake_minimum_required(VERSION 3.10)
project(XMillennium-Web)

set(XMIL_VERSION "0.7.0")

# Emscripten用の設定
if(EMSCRIPTEN)
    message(STATUS "Building for Emscripten/WebAssembly")

    # Emscriptenフラグ
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -std=c++11 -sUSE_ZLIB=1")
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -std=c99")

    # 最適化フラグ
    set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -O2")

    # Emscriptenリンクフラグ
    set(EM_LINK_FLAGS "")
    set(EM_LINK_FLAGS "${EM_LINK_FLAGS} -s WASM=1")
    set(EM_LINK_FLAGS "${EM_LINK_FLAGS} -s ALLOW_MEMORY_GROWTH=1")
    set(EM_LINK_FLAGS "${EM_LINK_FLAGS} -s INITIAL_MEMORY=67108864") # 64MB
    set(EM_LINK_FLAGS "${EM_LINK_FLAGS} -s GLOBAL_BASE=131072") # 128KB: stack-first layout 対策
    set(EM_LINK_FLAGS "${EM_LINK_FLAGS} -s EXPORTED_FUNCTIONS='[\"_main\",\"_malloc\",\"_free\",\"_js_xmil_start\",\"_js_xmil_stop\",\"_js_xmil_reset\",\"_js_xmil_nmi\",\"_js_xmil_power_off\",\"_js_xmil_power_on\",\"_js_insert_disk\",\"_js_set_rom_type\",\"_js_set_dip_sw\",\"_js_set_skip_line\",\"_js_set_motor\",\"_js_set_motor_volume\",\"_js_eject_disk\",\"_js_insert_cmt\",\"_js_cmt_eject\",\"_js_cmt_play\",\"_js_cmt_stop\",\"_js_cmt_ff\",\"_js_cmt_rew\",\"_js_get_cmt_cmd\",\"_js_get_cmt_pos\",\"_js_get_cmt_end\",\"_js_get_cmt_freq\",\"_js_set_sasi_path\",\"_js_set_joystick\",\"_js_set_key_mode\",\"_js_set_mouse\",\"_js_reload_fonts\",\"_js_key_down\",\"_js_key_up\",\"_js_save_state\",\"_js_load_state\",\"_js_get_load_warnings\",\"_js_get_dip_sw\",\"_js_get_rom_type\",\"_js_fdd_flush\",\"_js_emm_flush\",\"_js_emm_reset_slot\",\"_js_emm_take_dirty_slots\",\"_js_set_sound_sw\",\"_js_get_sound_sw\",\"_js_get_main_ram\"]'")
    set(EM_LINK_FLAGS "${EM_LINK_FLAGS} -s EXPORTED_RUNTIME_METHODS='[\"ccall\",\"cwrap\",\"FS\",\"wasmMemory\"]'")
    set(EM_LINK_FLAGS "${EM_LINK_FLAGS} -sUSE_ZLIB=1")
    set(EM_LINK_FLAGS "${EM_LINK_FLAGS} --pre-js ${CMAKE_SOURCE_DIR}/html/pre.js")
    set(EM_LINK_FLAGS "${EM_LINK_FLAGS} --shell-file ${CMAKE_SOURCE_DIR}/html/shell.html")

    # フォント ROM は著作権物のため埋め込みなし。
    # ユーザーが UI から FNT0808.X1 / FNT0816.X1 / FNT1616.X1 を読み込む。
    # ANK 8x8 は src/DEFFNT.CPP に内蔵フォントがあるため未ロード時もテキスト表示可能。

    # IPL ROM (optional - src/IPLROM.X1 に置くと埋め込まれる)
    # 未配置時は DEFFNT.CPP の DEFROM スタブ BIOS で動作する
    if(EXISTS "${CMAKE_SOURCE_DIR}/src/IPLROM.X1")
        message(STATUS "Found IPLROM.X1 - will be included")
        set(EM_LINK_FLAGS "${EM_LINK_FLAGS} --embed-file ${CMAKE_SOURCE_DIR}/src/IPLROM.X1@/IPLROM.X1")
    else()
        message(WARNING "IPLROM.X1 not found - emulator will run with stub BIOS")
    endif()
    if(EXISTS "${CMAKE_SOURCE_DIR}/src/IPLROM.X1T")
        message(STATUS "Found IPLROM.X1T - will be included")
        set(EM_LINK_FLAGS "${EM_LINK_FLAGS} --embed-file ${CMAKE_SOURCE_DIR}/src/IPLROM.X1T@/IPLROM.X1T")
    endif()

    # WAV sound effects (optional; place in assets/ directory to embed)
    # FDDSEEK.WAV / FDDSEEK1.WAV : FDDシーク音
    # CMTSTOP.WAV / CMTPLAY.WAV / CMTEJECT.WAV / CMTFF.WAV : CMTテープ音
    foreach(_wav FDDSEEK.WAV FDDSEEK1.WAV CMTSTOP.WAV CMTPLAY.WAV CMTEJECT.WAV CMTFF.WAV)
        if(EXISTS "${CMAKE_SOURCE_DIR}/assets/${_wav}")
            set(EM_LINK_FLAGS "${EM_LINK_FLAGS} --embed-file ${CMAKE_SOURCE_DIR}/assets/${_wav}@/${_wav}")
            message(STATUS "Embedding WAV: ${_wav}")
        endif()
    endforeach()

    set(CMAKE_EXECUTABLE_SUFFIX ".html")
else()
    message(FATAL_ERROR "This project must be built with Emscripten")
endif()

# インクルードディレクトリ（ダミーヘッダーを最優先）
include_directories(
    ${CMAKE_SOURCE_DIR}/platform/dummy_includes
    ${CMAKE_SOURCE_DIR}/platform
    ${CMAKE_SOURCE_DIR}/src
    ${CMAKE_SOURCE_DIR}/src/Z80R
    ${CMAKE_SOURCE_DIR}/src/OPMSOUND
    ${CMAKE_SOURCE_DIR}/src/OTHERFNT
)

# Windows API互換ヘッダーを強制インクルード
add_compile_options(
    -include ${CMAKE_SOURCE_DIR}/platform/windows_compat.h
)

# Emscripten固有の修正を強制インクルード
set_source_files_properties(
    src/X1_dma.cpp
    src/X1_scpu.cpp
    PROPERTIES COMPILE_FLAGS "-include ${CMAKE_SOURCE_DIR}/platform/emscripten_fixes.h -Wno-c++11-narrowing"
)

# Shift-JIS文字リテラルのnarrowingエラーを抑制
# (Input.cpp は sdl/src 版で hex リテラルに修正済みのため除外)
set_source_files_properties(
    src/X1.cpp
    src/X1_cmt.cpp
    PROPERTIES COMPILE_FLAGS "-Wno-c++11-narrowing"
)

# プラットフォーム抽象化層のソース
set(PLATFORM_SOURCES
    platform/platform_graphics.cpp
    platform/platform_audio.cpp
    platform/platform_input.cpp
    platform/platform_joystick.cpp  # X1 ジョイスティック変換（joy_getflag/joy_flash）
    platform/platform_file.cpp
    platform/platform_main.cpp
    platform/web_sound.cpp
    platform/state_save.cpp
)

# OPMSOUND ソース (src/OPMSOUND から)
set(OPMSOUND_SOURCES
    ${CMAKE_SOURCE_DIR}/src/OPMSOUND/fm.cpp
    ${CMAKE_SOURCE_DIR}/src/OPMSOUND/ay8910.cpp
    ${CMAKE_SOURCE_DIR}/src/OPMSOUND/Opmcore.cpp
)
set_source_files_properties(${OPMSOUND_SOURCES} PROPERTIES
    COMPILE_FLAGS "-Wno-c++11-narrowing -Wno-deprecated-declarations"
)

# Z80エミュレータのソース（chips z80.hを使用）
set(Z80_SOURCES
    platform/z80_wrapper.cpp
    # platform/x1_system.cpp  # X1.cppと重複するため削除
    platform/x1_vram_port.cpp
    platform/x1_mem_port.cpp
    platform/x1_dmam_port.cpp
    # platform/x1_io_stub.cpp  # 不要: X1_IO.CPPがC++ linkageで直接提供
    platform/otherfnt_stubs.cpp
)

# 元のX1エミュレーションソース（インラインアセンブリなし）
set(X1_SOURCES
    src/X1.cpp
    # src/X1_MEM.CPP        # インラインアセンブリあり - platform/x1_mem_port.cpp を使用
    # src/DINPUTS.CPP       # Web版不使用: platform/platform_joystick.cpp が代替
    src/X1_event.cpp
    src/X1_irq.cpp
    src/X1_CRTC.CPP
    src/X1_IO.CPP
    src/X1_SOUND.CPP
    src/X1_fdc.cpp
    src/X1_ctc.cpp
    src/X1_8255.cpp
    src/X1_PCG.CPP
    src/X1_cmt.cpp
    src/X1_sio.cpp
    src/X1_scpu.cpp
    src/X1_dma.cpp
    src/X1_sasi.cpp
    src/X1_emm.cpp
    src/X1_CLNDR.CPP
    src/DOSIO.CPP
    src/DEFFNT.CPP
    src/Input.cpp
    src/Timer.cpp
    src/Milstr.cpp
    src/FDD_2D.CPP
    src/FDD_D88.CPP
    src/FDD_MTR.CPP
)

# 描画関連ソース（インラインアセンブリ含む - 順次ポート予定）
set(DRAW_SOURCES
    src/Draw.cpp                    # 描画メインルーチン
    src/drawinfo.cpp                # 情報表示
    platform/draw_sub_data.cpp      # DRAW_SUB.CPPからデータ部分を抽出
    platform/draw_width.cpp         # テキストモード描画実装
    # src/DRAW_SUB.CPP       # 描画サブルーチン（インラインアセンブリ含む - draw_sub_data.cppに移行）
    # src/DRAW8.CPP          # インラインアセンブリ - draw_width.cppに移行
    # src/DRAW64.CPP         # インラインアセンブリ - スタブ
    # src/DRAW64H.CPP        # インラインアセンブリ - スタブ
    # src/DRAW64L.CPP        # インラインアセンブリ - スタブ
    # src/DRAW4096.CPP       # インラインアセンブリ - スタブ
    # src/DRAWTXT6.CPP       # インラインアセンブリ - スタブ
    # src/DRAWTXT8.CPP       # インラインアセンブリ - スタブ
    # src/DRAWTXTB.CPP       # インラインアセンブリ - スタブ
    # src/DRAWTXTD.CPP       # インラインアセンブリ - スタブ
    src/PALETTES.CPP                # パレットデータ（アセンブリなし）
    platform/ddraws_web.cpp         # DirectDrawラッパー（Web API版）
)

# すべてのソースをまとめる
set(ALL_SOURCES
    ${PLATFORM_SOURCES}
    ${Z80_SOURCES}
    ${X1_SOURCES}
    ${DRAW_SOURCES}
    ${OPMSOUND_SOURCES}
)

# 実行ファイルの作成
add_executable(xmillennium ${ALL_SOURCES})

# コンパイル定義
target_compile_definitions(xmillennium PRIVATE
    T_TUNE=1
    EMSCRIPTEN_BUILD=1
)

# FDC/DMA diagnostic logging (off by default)
option(FDC_DMA_TRACE "Enable FDC/DMA diagnostic logging" OFF)
if(FDC_DMA_TRACE)
    target_compile_definitions(xmillennium PRIVATE FDC_DMA_TRACE)
endif()

# リンクフラグの設定
set_target_properties(xmillennium PROPERTIES
    LINK_FLAGS "${EM_LINK_FLAGS}"
)

# shell.html / pre.js / storage.js / drive_integration.js / config.example.js の変更を検知してリリンクを強制
set_property(TARGET xmillennium PROPERTY LINK_DEPENDS
    ${CMAKE_SOURCE_DIR}/html/shell.html
    ${CMAKE_SOURCE_DIR}/html/pre.js
    ${CMAKE_SOURCE_DIR}/html/storage.js
    ${CMAKE_SOURCE_DIR}/html/drive_integration.js
    ${CMAKE_SOURCE_DIR}/html/disk_container.js
    ${CMAKE_SOURCE_DIR}/html/disk_fs.js
    ${CMAKE_SOURCE_DIR}/html/disk_editor.js
    ${CMAKE_SOURCE_DIR}/html/config.example.js
    ${CMAKE_SOURCE_DIR}/html/x1pen.html
    ${CMAKE_SOURCE_DIR}/html/ui_fragments.js
    ${CMAKE_SOURCE_DIR}/html/x1pen_z80asm.js
)

# ビルド後にファイルをコピー
add_custom_command(TARGET xmillennium POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory
    ${CMAKE_SOURCE_DIR}/html ${CMAKE_BINARY_DIR}/html
    COMMAND ${CMAKE_COMMAND} -E copy
    ${CMAKE_SOURCE_DIR}/html/pre.js ${CMAKE_BINARY_DIR}/pre.js
    COMMAND ${CMAKE_COMMAND} -E copy
    ${CMAKE_SOURCE_DIR}/html/storage.js ${CMAKE_BINARY_DIR}/storage.js
    COMMAND ${CMAKE_COMMAND} -E copy
    ${CMAKE_SOURCE_DIR}/html/drive_integration.js ${CMAKE_BINARY_DIR}/drive_integration.js
    COMMAND ${CMAKE_COMMAND} -E copy
    ${CMAKE_SOURCE_DIR}/html/disk_container.js ${CMAKE_BINARY_DIR}/disk_container.js
    COMMAND ${CMAKE_COMMAND} -E copy
    ${CMAKE_SOURCE_DIR}/html/disk_fs.js ${CMAKE_BINARY_DIR}/disk_fs.js
    COMMAND ${CMAKE_COMMAND} -E copy
    ${CMAKE_SOURCE_DIR}/html/disk_editor.js ${CMAKE_BINARY_DIR}/disk_editor.js
    COMMAND ${CMAKE_COMMAND} -E copy
    ${CMAKE_SOURCE_DIR}/html/index.html ${CMAKE_BINARY_DIR}/index.html
    COMMAND ${CMAKE_COMMAND} -E copy
    ${CMAKE_SOURCE_DIR}/html/licenses.html ${CMAKE_BINARY_DIR}/licenses.html
    COMMAND ${CMAKE_COMMAND} -E copy
    ${CMAKE_SOURCE_DIR}/html/privacy.html ${CMAKE_BINARY_DIR}/privacy.html
    COMMAND ${CMAKE_COMMAND} -E copy
    ${CMAKE_SOURCE_DIR}/html/terms.html ${CMAKE_BINARY_DIR}/terms.html
    # X1Pen IDE ファイル
    COMMAND ${CMAKE_COMMAND} -E copy
    ${CMAKE_SOURCE_DIR}/html/x1pen.html ${CMAKE_BINARY_DIR}/x1pen.html
    COMMAND ${CMAKE_COMMAND} -E copy
    ${CMAKE_SOURCE_DIR}/html/x1pen.js ${CMAKE_BINARY_DIR}/x1pen.js
    COMMAND ${CMAKE_COMMAND} -E copy
    ${CMAKE_SOURCE_DIR}/html/x1pen_tokenizer.js ${CMAKE_BINARY_DIR}/x1pen_tokenizer.js
    COMMAND ${CMAKE_COMMAND} -E copy
    ${CMAKE_SOURCE_DIR}/html/x1pen_z80asm.js ${CMAKE_BINARY_DIR}/x1pen_z80asm.js
    COMMAND ${CMAKE_COMMAND} -E copy
    ${CMAKE_SOURCE_DIR}/html/ui_fragments.js ${CMAKE_BINARY_DIR}/ui_fragments.js
    # config.js: html/config.js があればそれを使用（認証情報入り・gitignore済み）
    #            なければ config.example.js を config.js としてコピー（認証情報未設定）
    COMMAND ${CMAKE_COMMAND}
        -DSRC_DIR=${CMAKE_SOURCE_DIR}/html
        -DDST_DIR=${CMAKE_BINARY_DIR}
        -P ${CMAKE_SOURCE_DIR}/cmake/copy_config.cmake
    # バージョン文字列を注入（@@XMIL_VERSION@@ → 実際のバージョン）
    COMMAND sed -i.bak "s/@@XMIL_VERSION@@/${XMIL_VERSION}/g"
        ${CMAKE_BINARY_DIR}/xmillennium.html
        ${CMAKE_BINARY_DIR}/index.html
    COMMAND ${CMAKE_COMMAND} -E remove -f
        ${CMAKE_BINARY_DIR}/xmillennium.html.bak
        ${CMAKE_BINARY_DIR}/index.html.bak
    COMMENT "Copying HTML files to build directory"
)

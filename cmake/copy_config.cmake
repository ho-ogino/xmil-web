# copy_config.cmake
# 呼び出し: cmake -DSRC_DIR=<html_dir> -DDST_DIR=<build_dir> -P copy_config.cmake
#
# html/config.js が存在すればそれをコピー（認証情報入り・gitignore済み）
# なければ config.example.js を config.js としてコピー（認証情報未設定テンプレート）

if(EXISTS "${SRC_DIR}/config.js")
    file(COPY_FILE "${SRC_DIR}/config.js" "${DST_DIR}/config.js")
else()
    file(COPY_FILE "${SRC_DIR}/config.example.js" "${DST_DIR}/config.js")
endif()

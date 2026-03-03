#ifndef COMMON_COMPAT_H
#define COMMON_COMPAT_H

// Emscriptenビルド用の互換性ヘッダー

#ifdef EMSCRIPTEN_BUILD

// プラットフォーム抽象化層のインクルード
#include "platform_types.h"

// Windows API互換定義
#define LABEL
#define __declspec(x)
#define RELEASE(x) if (x) { free(x); (x) = NULL; }

// 元のCOMMON.Hの内容
#define SUCCESS 0
#define FAILURE 1

#ifndef PI
#define PI 3.14159265357989
#endif

typedef union {
    struct {
        BYTE b;
        BYTE g;
        BYTE r;
        BYTE f;
    } p;
    BYTE b[4];
    DWORD d;
} PALETTE_TABLE;

#else
// Windows版の場合は元のヘッダーをインクルード
#include "../src/common.h"
#endif

#endif // COMMON_COMPAT_H

#ifndef PLATFORM_GRAPHICS_H
#define PLATFORM_GRAPHICS_H

#include "platform_types.h"

#ifdef __cplusplus
extern "C" {
#endif

// グラフィックスサブシステムの初期化
BOOL Platform_Graphics_Init(int width, int height, int bpp);
void Platform_Graphics_Term(void);

// 画面バッファの取得とロック
BYTE* Platform_Graphics_LockSurface(int* pitch);
void Platform_Graphics_UnlockSurface(void);

// 画面の更新（バックバッファをフロントバッファに転送）
void Platform_Graphics_Flip(void);

// パレット設定（8bit/256色モード用）
void Platform_Graphics_SetPalette(BYTE index, BYTE r, BYTE g, BYTE b);

// 画面サイズの変更
BOOL Platform_Graphics_SetMode(int width, int height, int bpp);

// 画面クリア
void Platform_Graphics_Clear(DWORD color);

// 画面全体の更新（screenmapからの転送）
void Platform_Graphics_UpdateScreen(BYTE* screenmap, int width, int height, WORD* palette16, int palette_count);

#ifdef __cplusplus
}
#endif

#endif // PLATFORM_GRAPHICS_H

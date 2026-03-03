#include "platform_graphics.h"
#include <emscripten.h>
#include <emscripten/html5.h>
#include <stdlib.h>
#include <string.h>

// グラフィックス状態
static struct {
    BYTE* framebuffer;
    int width;
    int height;
    int bpp;
    int pitch;
    DWORD palette[256];
    BOOL initialized;
} g_graphics = {0};

// Canvas要素のID
static const char* CANVAS_ID = "#canvas";

BOOL Platform_Graphics_Init(int width, int height, int bpp) {
    if (g_graphics.initialized) {
        Platform_Graphics_Term();
    }

    g_graphics.width = width;
    g_graphics.height = height;
    g_graphics.bpp = bpp;

    // ピッチの計算（バイト単位）
    if (bpp == 8) {
        g_graphics.pitch = width;
    } else if (bpp == 16) {
        g_graphics.pitch = width * 2;
    } else if (bpp == 32) {
        g_graphics.pitch = width * 4;
    } else {
        return FALSE;
    }

    // フレームバッファの確保
    int buffer_size = g_graphics.pitch * height;
    g_graphics.framebuffer = (BYTE*)malloc(buffer_size);
    if (!g_graphics.framebuffer) {
        return FALSE;
    }
    memset(g_graphics.framebuffer, 0, buffer_size);

    // デフォルトパレットの初期化
    for (int i = 0; i < 256; i++) {
        g_graphics.palette[i] = 0xFF000000 | (i << 16) | (i << 8) | i;
    }

    // Canvas要素のサイズ設定
    emscripten_set_canvas_element_size(CANVAS_ID, width, height);

    g_graphics.initialized = TRUE;
    return TRUE;
}

void Platform_Graphics_Term(void) {
    if (g_graphics.framebuffer) {
        free(g_graphics.framebuffer);
        g_graphics.framebuffer = NULL;
    }
    g_graphics.initialized = FALSE;
}

BYTE* Platform_Graphics_LockSurface(int* pitch) {
    if (!g_graphics.initialized) {
        return NULL;
    }
    if (pitch) {
        *pitch = g_graphics.pitch;
    }
    return g_graphics.framebuffer;
}

void Platform_Graphics_UnlockSurface(void) {
    // WebGLではロック/アンロックは不要だが、互換性のために残す
}

void Platform_Graphics_Flip(void) {
    if (!g_graphics.initialized) {
        return;
    }

    // Canvas 2Dコンテキストを取得
    EMSCRIPTEN_WEBGL_CONTEXT_HANDLE ctx = emscripten_webgl_get_current_context();

    // JavaScriptコードを実行してCanvasに描画
    EM_ASM({
        var canvas = document.querySelector('#canvas');
        if (!canvas) return;

        var ctx = canvas.getContext('2d');
        if (!ctx) return;

        var width = $0;
        var height = $1;
        var bpp = $2;
        var framebuffer = $3;

        // ImageDataを作成
        var imageData = ctx.createImageData(width, height);
        var data = imageData.data;

        if (bpp == 8) {
            // 8bitパレットモード
            var palette = $4;
            for (var i = 0; i < width * height; i++) {
                var paletteIndex = HEAPU8[framebuffer + i];
                var color = HEAPU32[(palette >> 2) + paletteIndex];
                var offset = i * 4;
                data[offset + 0] = (color >> 16) & 0xFF; // R
                data[offset + 1] = (color >> 8) & 0xFF;  // G
                data[offset + 2] = color & 0xFF;         // B
                data[offset + 3] = 255;                  // A
            }
        } else if (bpp == 32) {
            // 32bitダイレクトカラー
            for (var i = 0; i < width * height; i++) {
                var offset = i * 4;
                data[offset + 0] = HEAPU8[framebuffer + offset + 2]; // R
                data[offset + 1] = HEAPU8[framebuffer + offset + 1]; // G
                data[offset + 2] = HEAPU8[framebuffer + offset + 0]; // B
                data[offset + 3] = 255;                              // A
            }
        }

        // Canvasに描画
        ctx.putImageData(imageData, 0, 0);
    }, g_graphics.width, g_graphics.height, g_graphics.bpp,
       g_graphics.framebuffer, g_graphics.palette);
}

void Platform_Graphics_SetPalette(BYTE index, BYTE r, BYTE g, BYTE b) {
    // indexはBYTE型なので常に0-255の範囲内
    g_graphics.palette[index] = 0xFF000000 | (r << 16) | (g << 8) | b;
}

BOOL Platform_Graphics_SetMode(int width, int height, int bpp) {
    return Platform_Graphics_Init(width, height, bpp);
}

void Platform_Graphics_Clear(DWORD color) {
    if (!g_graphics.initialized || !g_graphics.framebuffer) {
        return;
    }

    if (g_graphics.bpp == 8) {
        memset(g_graphics.framebuffer, color & 0xFF,
               g_graphics.width * g_graphics.height);
    } else if (g_graphics.bpp == 32) {
        DWORD* pixels = (DWORD*)g_graphics.framebuffer;
        for (int i = 0; i < g_graphics.width * g_graphics.height; i++) {
            pixels[i] = color;
        }
    }
}

// 画面全体の更新（screenmapからの転送）
void Platform_Graphics_UpdateScreen(BYTE* screenmap, int width, int height, WORD* palette16, int palette_count) {
    if (!g_graphics.initialized || !screenmap) {
        return;
    }

    // パレットを更新
    for (int i = 0; i < palette_count && i < 256; i++) {
        WORD rgb565 = palette16[i];
        BYTE r = ((rgb565 >> 11) & 0x1F) << 3;  // 5bit -> 8bit
        BYTE g = ((rgb565 >> 5) & 0x3F) << 2;   // 6bit -> 8bit
        BYTE b = (rgb565 & 0x1F) << 3;          // 5bit -> 8bit
        Platform_Graphics_SetPalette(i, r, g, b);
    }

    // screenmapをバックバッファにコピー
    BYTE* pixels = Platform_Graphics_LockSurface(NULL);
    if (pixels) {
        int copy_width = (width < g_graphics.width) ? width : g_graphics.width;
        int copy_height = (height < g_graphics.height) ? height : g_graphics.height;

        for (int y = 0; y < copy_height; y++) {
            memcpy(&pixels[y * g_graphics.width],
                   &screenmap[y * width],
                   copy_width);
        }

        // putlines < SCREEN_HEIGHT の場合、下部を黒で塗りつぶし
        // (origsrc の clearblanklines() 相当)
        if (copy_height < g_graphics.height) {
            memset(&pixels[copy_height * g_graphics.width], 0,
                   (g_graphics.height - copy_height) * g_graphics.width);
        }

        Platform_Graphics_UnlockSurface();
    }

    // 画面を更新
    Platform_Graphics_Flip();
}

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
    DWORD palette_version;  // パレット変更カウンタ（符号なし: UB 回避）
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

    // 再初期化時の状態持ち越し防止
    g_graphics.palette_version = 0;

    // JS 側のキャッシュを初期化
    EM_ASM({
        var g = {};
        g.ctx = null;
        g.imageData = null;
        g.dataU32 = null;
        g.width = 0;
        g.height = 0;
        g.canvas = null;
        g.paletteLUT = new Uint32Array(256);
        g.paletteVersion = -1;
        window._xmilGfx = g;
    });

    g_graphics.initialized = TRUE;
    return TRUE;
}

void Platform_Graphics_Term(void) {
    if (g_graphics.framebuffer) {
        free(g_graphics.framebuffer);
        g_graphics.framebuffer = NULL;
    }
    g_graphics.initialized = FALSE;

    // JS 側のキャッシュをクリア
    EM_ASM({ window._xmilGfx = null; });
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

    EM_ASM({
        var gfx = window._xmilGfx;
        if (!gfx) return;

        var width = $0;
        var height = $1;
        var bpp = $2;
        var framebuffer = $3;
        var palette = $4;
        var palVersion = $5;

        // ctx / ImageData のキャッシュ
        // 再取得条件: 未初期化 / canvas 差替え / サイズ変更 / コンテキストロスト
        var currentCanvas = document.getElementById('canvas');
        if (!currentCanvas) return;
        if (!gfx.ctx || gfx.canvas !== currentCanvas
            || gfx.width !== width || gfx.height !== height) {
            gfx.canvas = currentCanvas;
            gfx.ctx = currentCanvas.getContext('2d');
            if (!gfx.ctx) return;
            gfx.imageData = gfx.ctx.createImageData(width, height);
            gfx.dataU32 = new Uint32Array(gfx.imageData.data.buffer);
            gfx.width = width;
            gfx.height = height;
            gfx.dataU32.fill(0xFF000000); // アルファ一括設定
            gfx.paletteVersion = -1;      // LUT 再構築を強制
        }

        var dataU32 = gfx.dataU32;
        var n = width * height;

        if (bpp == 8) {
            // パレット LUT — version が変わった時のみ再構築
            if (gfx.paletteVersion !== palVersion) {
                var lut = gfx.paletteLUT;
                for (var i = 0; i < 256; i++) {
                    var argb = HEAPU32[(palette >> 2) + i];
                    // ARGB (C++) → ABGR (ImageData LE Uint32)
                    lut[i] = 0xFF000000
                        | ((argb & 0xFF) << 16)    // B → byte2
                        | (argb & 0xFF00)           // G → byte1
                        | ((argb >> 16) & 0xFF);    // R → byte0
                }
                gfx.paletteVersion = palVersion;
            }
            // 高速ピクセル転送: LUT 参照 1 回のみ（shift/mask/alpha 不要）
            var lut = gfx.paletteLUT;
            for (var i = 0; i < n; i++) {
                dataU32[i] = lut[HEAPU8[framebuffer + i]];
            }
        } else if (bpp == 32) {
            // 32bpp (4096色モード)
            // C++ 側 (ddraws_web.cpp): BGRA バイト順で書き込み
            //   pixel = b | (g<<8) | (r<<16) | 0xFF000000
            //   メモリ上 (LE): [B, G, R, 0xFF]
            //   HEAPU32 読み値: 0xFF_RR_GG_BB
            // JS 側: ImageData Uint32 (LE) = 0xAA_BB_GG_RR (ABGR)
            //   → R と B を入れ替え
            var srcU32 = (framebuffer >> 2);
            for (var i = 0; i < n; i++) {
                var src = HEAPU32[srcU32 + i];
                dataU32[i] = 0xFF000000
                    | ((src & 0xFF) << 16)    // B → byte2
                    | (src & 0xFF00)           // G → byte1
                    | ((src >> 16) & 0xFF);    // R → byte0
            }
        }

        gfx.ctx.putImageData(gfx.imageData, 0, 0);
    }, g_graphics.width, g_graphics.height, g_graphics.bpp,
       g_graphics.framebuffer, g_graphics.palette, g_graphics.palette_version);
}

void Platform_Graphics_SetPalette(BYTE index, BYTE r, BYTE g, BYTE b) {
    DWORD newval = 0xFF000000 | (r << 16) | (g << 8) | b;
    if (g_graphics.palette[index] != newval) {
        g_graphics.palette[index] = newval;
        g_graphics.palette_version++;
    }
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

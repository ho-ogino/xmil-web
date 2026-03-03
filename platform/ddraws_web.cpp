//----------------------------------------------------------------------------
// Ddraws - DirectDraw wrapper for Web (Canvas API)
// Original: src/Ddraws.cpp (DirectX implementation)
// Ported to HTML5 Canvas for Emscripten
//----------------------------------------------------------------------------

#include <windows.h>
#include <stdio.h>
#include <string.h>
#include "common.h"
#include "xmil.h"
#include "draw.h"
#include "ddraws.h"
#include "palettes.h"
#include "x1.h"
#include "x1_crtc.h"
#include "platform_graphics.h"

#if T_TUNE
static RECT rect200 = {0, 0, SCREEN_WIDTH, SCREEN_HEIGHT+INFO_HEIGHT};
#else
static RECT rect200 = {0, 0, SCREEN_WIDTH, SCREEN_HEIGHT};
#endif

static RECT rectdraw1 = {0, 0, SCREEN_WIDTH, 1};
static PALETTEENTRY winpal[256];
static BYTE allflash = 0;
static BYTE palchanged = 0;
static BYTE setscmd = 0;

BYTE SCREENMODE = 0;
BYTE drawingmode = 0;

int xm_palettes = 0;
PALETTE_TABLE xm_palette[256];
BYTE screenmap[SCREEN_WIDTH * SCREEN_HEIGHT];
static BYTE x2_scalebuf[SCREEN_WIDTH * SCREEN_HEIGHT];
BYTE renewalline[SCREEN_HEIGHT+4];
BYTE x2mode = X2MODE_WIDTH40;
WORD putlines = SCREEN_HEIGHT;

#if T_TUNE
PALETTE_TABLE info_palette[INFO_PALS];
WORD info_pal16[INFO_PALS];
BYTE infoscreenmap[SCREEN_WIDTH * INFO_HEIGHT];
BYTE inforenewal;
#endif

WORD xmil_pal16[256];

extern int winx, winy;
static int winw = 640;
static int winh = 400;

// Fill renewal line array
inline void fillrenewalline(DWORD value) {
    int cnt = SCREEN_HEIGHT / 4;
    DWORD *p = (DWORD *)renewalline;
    while(cnt--) {
        *p++ |= value;
    }
#if T_TUNE
    inforenewal = 1;
#endif
}

// Initialize window size (stub for web)
void ddraws_initwindowsize(WORD width, WORD height) {
    winw = width;
    winh = height;
}

// Set screen mode (stub for web)
// 戻り値: 0=変更不要(即成功), 非0=変更が必要(InitDirectDrawに進む)
// Webではwindowed/fullscreenの概念がないため常に0を返す
BYTE ddraws_setscreenmode(BYTE mode) {
    SCREENMODE = mode;
    return 0;
}

// Window stats (stub for web)
void ddraws_windowstats(void) {
    // No-op for web
}

// Center window (stub for web)
void ddraws_wincenter(void) {
    // No-op for web
}

// Initialize DirectDraw (Web版は初期化済み)
void ddraws_init(void) {
    memset(screenmap, 0, sizeof(screenmap));
    memset(renewalline, 1, sizeof(renewalline));
}

// Change palette
void ddraws_change_palette(void) {
    // Convert xm_palette to platform format
    for (int i = 0; i < xm_palettes && i < 256; i++) {
        PALETTE_TABLE *p = &xm_palette[i];
        winpal[i].peRed = p->p.r;
        winpal[i].peGreen = p->p.g;
        winpal[i].peBlue = p->p.b;
        winpal[i].peFlags = 0;

        // Convert to 16-bit RGB565
        xmil_pal16[i] = ((p->p.r >> 3) << 11) |
                        ((p->p.g >> 2) << 5) |
                        (p->p.b >> 3);
    }

    palchanged = 1;
}

// Clear blank area (stub)
void clearblankarea(void) {
    // No-op for web
}

// Initialize DirectDraw (stub)
int ddraws_InitDirectDraw(void) {
    return 0; // SUCCESS (0 = success, non-zero = failure)
}

// Terminate DirectDraw (stub)
void ddraws_TermDirectDraw(void) {
}

// Change draw lines
void ddraws_change_drawlines(DWORD lines) {
    putlines = (WORD)lines;
    if (putlines > SCREEN_HEIGHT) {
        putlines = SCREEN_HEIGHT;
    }
}

// Clear blank lines (stub)
void clearblanklines(DWORD posx, DWORD posy) {
    // No-op for web
}

#if T_TUNE
// Info draw — Web版では未使用（デスクトップ版のデバッグオーバーレイに相当）
void ddraws_infodraw(void) {
}
#endif

// Draw screen (incremental) — Web版では ddraws_drawsa() で全面描画するため未使用
void ddraws_draws(void) {
    for (int y = 0; y < putlines; y++) {
        if (renewalline[y]) {
            renewalline[y] = 0;
        }
    }
}

// Draw all screen (full redraw)
void ddraws_drawall(void) {
    // X2MODE_4096: 32bpp 直接書き込み (screenmap左右合成 → GRPHPAL4096 → BGRA)
    if (x2mode == X2MODE_4096) {
        int pitch;
        BYTE* fb = Platform_Graphics_LockSurface(&pitch);
        if (fb && pitch >= SCREEN_WIDTH * 4) {
            int lines = ((int)putlines < SCREEN_HEIGHT) ? (int)putlines : SCREEN_HEIGHT;
            for (int y = 0; y < lines; y++) {
                BYTE* in = &screenmap[y * SCREEN_WIDTH];
                DWORD* out = (DWORD*)(fb + y * pitch);
                for (int x = 0; x < SCREEN_WIDTH / 2; x++) {
                    BYTE lo = in[x];        // B3R3 (左半分)
                    BYTE hi = in[x + 320];  // G4TG (右半分)
                    WORD idx = (WORD)lo | ((WORD)hi << 8);
                    PALETTE_TABLE* pal = &GRPHPAL4096[idx];
                    // BGRA順 (platform_graphics.cpp Flip() の読み出しに合わせる)
                    DWORD pixel = (DWORD)pal->p.b
                                | ((DWORD)pal->p.g << 8)
                                | ((DWORD)pal->p.r << 16)
                                | 0xFF000000;
                    out[x * 2 + 0] = pixel;  // 横2倍 (40桁→640px)
                    out[x * 2 + 1] = pixel;
                }
            }
            // putlines < SCREEN_HEIGHT の場合、下部を黒で塗りつぶし
            if (lines < SCREEN_HEIGHT) {
                for (int y = lines; y < SCREEN_HEIGHT; y++) {
                    memset(fb + y * pitch, 0, SCREEN_WIDTH * 4);
                }
            }
            Platform_Graphics_UnlockSurface();
        }
        Platform_Graphics_Flip();
        memset(renewalline, 0, sizeof(renewalline));
        palchanged = 0;
        return;
    }

    BYTE* src = screenmap;

    // WIDTH 40桁時は左320pxを横2倍して640px幅に拡大（SDL版と同じ処理）
    // x2mode==X2MODE_WIDTH80(0): 等倍(80桁)
    // x2mode==X2MODE_WIDTH40(1): 横2倍(40桁)
    if (x2mode == X2MODE_WIDTH40) {
        for (int y = 0; y < (int)putlines; y++) {
            BYTE* in  = &screenmap[y * SCREEN_WIDTH];
            BYTE* out = &x2_scalebuf[y * SCREEN_WIDTH];
            for (int x = 0; x < SCREEN_WIDTH / 2; x++) {
                BYTE c = in[x];
                out[x * 2 + 0] = c;
                out[x * 2 + 1] = c;
            }
        }
        src = x2_scalebuf;
    }

    Platform_Graphics_UpdateScreen(src, SCREEN_WIDTH, putlines, xmil_pal16, xm_palettes);

    // Clear renewal flags
    memset(renewalline, 0, sizeof(renewalline));

    palchanged = 0;
}

// Restore surface (always return 0 for web)
BYTE ddraws_restore(void) {
    return 0;
}

// Palette update (stub)
void ddraws_palette(void) {
    ddraws_change_palette();
}

// Change X mode (40/80 column / 4096 color)
void ddraws_change_xmode(BYTE x2flag) {
    BYTE prev = x2mode;
    x2mode = x2flag;
    if (x2flag == X2MODE_4096 && prev != X2MODE_4096) {
        // 4096色モード進入: 32bpp フレームバッファに切替
        if (!Platform_Graphics_SetMode(640, 400, 32)) {
            x2mode = prev;  // SetMode失敗時はフォールバック
            return;
        }
        fillrenewalline(0x01010101);  // バッファ再確保後の全行更新強制
    } else if (x2flag != X2MODE_4096 && prev == X2MODE_4096) {
        // 4096色モードから復帰: 8bpp フレームバッファに切替
        if (!Platform_Graphics_SetMode(640, 400, 8)) {
            x2mode = prev;
            return;
        }
        fillrenewalline(0x01010101);
    }
}

// Top window UI (stub)
void ddraws_topwinui(void) {
    // No-op for web
}

// Clear window UI (stub)
void ddraws_clearwinui(void) {
    // No-op for web
}

// Draw 1 line
BYTE ddraws_draw1(DWORD linepos) {
    if (linepos >= SCREEN_HEIGHT) {
        return 0;
    }

    renewalline[linepos] = 1;
    return 1;
}

// Redraw screen
void ddraws_redraw(void) {
    fillrenewalline(0x01010101);
    allflash = 1;
}

#if T_TUNE
// Clip area (stub)
void ddraws_cliparea(void) {
    // No-op for web
}
#endif

// Display clock (stub)
void ddraws_dispclock(void) {
    // No-op for web
}

// Get palette entry
PALETTEENTRY* ddraws_getpal(void) {
    return winpal;
}

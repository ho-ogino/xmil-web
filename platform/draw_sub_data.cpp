//----------------------------------------------------------------------------
// DRAW_SUB データ部分とinit_drawtable()関数
// インラインアセンブリを含まない部分のみ抽出
//----------------------------------------------------------------------------

#include <windows.h>
#include "common.h"

// WORK
BYTE cwork[256];
DWORD mask1;
DWORD mask2;

BYTE fontycnt = 0;  // xmillでは 8ライン 16ラインを同時に扱うので
                    // なので 16ラインをベースとする

DWORD text_x2_table[16][64];

DWORD bmp2byte_table[32][512];


// width40,25,0,1 64色モードのパレット変換テーブル群

WORD PAL4096_BANK0[] = {
    0x000, 0x008, 0x080, 0x088, 0x800, 0x808, 0x880, 0x888,
    0x004, 0x00C, 0x084, 0x08C, 0x804, 0x80C, 0x884, 0x88C,
    0x040, 0x048, 0x0C0, 0x0C8, 0x840, 0x848, 0x8C0, 0x8C8,
    0x044, 0x04C, 0x0C4, 0x0CC, 0x844, 0x84C, 0x8C4, 0x8CC,
    0x400, 0x408, 0x480, 0x488, 0xC00, 0xC08, 0xC80, 0xC88,
    0x404, 0x40C, 0x484, 0x48C, 0xC04, 0xC0C, 0xC84, 0xC8C,
    0x440, 0x448, 0x4C0, 0x4C8, 0xC40, 0xC48, 0xCC0, 0xCC8,
    0x444, 0x44C, 0x4C4, 0x4CC, 0xC44, 0xC4C, 0xCC4, 0xCCC};

WORD PAL4096_BANK1[] = {
    0x000, 0x002, 0x020, 0x022, 0x200, 0x202, 0x220, 0x222,
    0x001, 0x003, 0x021, 0x023, 0x201, 0x203, 0x221, 0x223,
    0x010, 0x012, 0x030, 0x032, 0x210, 0x212, 0x230, 0x232,
    0x011, 0x013, 0x031, 0x033, 0x211, 0x213, 0x231, 0x233,
    0x100, 0x102, 0x120, 0x122, 0x300, 0x302, 0x320, 0x322,
    0x101, 0x103, 0x121, 0x123, 0x301, 0x303, 0x321, 0x323,
    0x110, 0x112, 0x130, 0x132, 0x310, 0x312, 0x330, 0x332,
    0x111, 0x113, 0x131, 0x133, 0x311, 0x313, 0x331, 0x333};

DWORD x2left[64] = {
    0x00000000, 0x00000000, 0x00000000, 0x00000000,
    0x03030303, 0x03030303, 0x03030303, 0x03030303,
    0x0c0c0c0c, 0x0c0c0c0c, 0x0c0c0c0c, 0x0c0c0c0c,
    0x0f0f0f0f, 0x0f0f0f0f, 0x0f0f0f0f, 0x0f0f0f0f,
    0x30303030, 0x30303030, 0x30303030, 0x30303030,
    0x33333333, 0x33333333, 0x33333333, 0x33333333,
    0x3c3c3c3c, 0x3c3c3c3c, 0x3c3c3c3c, 0x3c3c3c3c,
    0x3f3f3f3f, 0x3f3f3f3f, 0x3f3f3f3f, 0x3f3f3f3f,
    0xc0c03030, 0xc0c0c0c0, 0xc0c0c0c0, 0xc0c0c0c0,
    0xc3c3c3c3, 0xc3c3c3c3, 0xc3c3c3c3, 0xc3c3c3c3,
    0xcccccccc, 0xcccccccc, 0xcccccccc, 0xcccccccc,
    0xcfcfcfcf, 0xcfcfcfcf, 0xcfcfcfcf, 0xcfcfcfcf,
    0xf0f0f0f0, 0xf0f0f0f0, 0xf0f0f0f0, 0xf0f0f0f0,
    0xf3f3f3f3, 0xf3f3f3f3, 0xf3f3f3f3, 0xf3f3f3f3,
    0xfcfcfcfc, 0xfcfcfcfc, 0xfcfcfcfc, 0xfcfcfcfc,
    0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff};

DWORD x2right[64] = {
    0x0f0c0300, 0x3f3c3330, 0xcfccc3c0, 0xfffcf3f0,
    0x0f0c0300, 0x3f3c3330, 0xcfccc3c0, 0xfffcf3f0,
    0x0f0c0300, 0x3f3c3330, 0xcfccc3c0, 0xfffcf3f0,
    0x0f0c0300, 0x3f3c3330, 0xcfccc3c0, 0xfffcf3f0,
    0x0f0c0300, 0x3f3c3330, 0xcfccc3c0, 0xfffcf3f0,
    0x0f0c0300, 0x3f3c3330, 0xcfccc3c0, 0xfffcf3f0,
    0x0f0c0300, 0x3f3c3330, 0xcfccc3c0, 0xfffcf3f0,
    0x0f0c0300, 0x3f3c3330, 0xcfccc3c0, 0xfffcf3f0,
    0x0f0c0300, 0x3f3c3330, 0xcfccc3c0, 0xfffcf3f0,
    0x0f0c0300, 0x3f3c3330, 0xcfccc3c0, 0xfffcf3f0,
    0x0f0c0300, 0x3f3c3330, 0xcfccc3c0, 0xfffcf3f0,
    0x0f0c0300, 0x3f3c3330, 0xcfccc3c0, 0xfffcf3f0,
    0x0f0c0300, 0x3f3c3330, 0xcfccc3c0, 0xfffcf3f0,
    0x0f0c0300, 0x3f3c3330, 0xcfccc3c0, 0xfffcf3f0,
    0x0f0c0300, 0x3f3c3330, 0xcfccc3c0, 0xfffcf3f0,
    0x0f0c0300, 0x3f3c3330, 0xcfccc3c0, 0xfffcf3f0};

// --------------------------------------------------------------------------

void init_drawtable(void) {
    BYTE i;
    BYTE bit;
    DWORD work = 0;
    WORD pat;

    for (pat = 0; pat < 256; pat++) {
        for (bit = 0x10; bit; bit <<= 1) {
            work <<= 8;
            if (pat & bit) {
                work |= 1;
            }
        }
        bmp2byte_table[16][pat * 2] = work;
        bmp2byte_table[17][pat * 2] = work << 1;
        bmp2byte_table[18][pat * 2] = work << 2;
        bmp2byte_table[19][pat * 2] = work << 6;
        bmp2byte_table[20][pat * 2] = work << 7;
        for (i = 0; i < 8; i++) {
            bmp2byte_table[i][pat * 2] = (work * i) << 3;
            bmp2byte_table[i + 8][pat * 2] = bmp2byte_table[i][pat * 2] ^ 0x38383838;
        }

        for (bit = 1; bit < 0x10; bit <<= 1) {
            work <<= 8;
            if (pat & bit) {
                work |= 1;
            }
        }
        bmp2byte_table[16][pat * 2 + 1] = work;
        bmp2byte_table[17][pat * 2 + 1] = work << 1;
        bmp2byte_table[18][pat * 2 + 1] = work << 2;
        bmp2byte_table[19][pat * 2 + 1] = work << 6;
        bmp2byte_table[20][pat * 2 + 1] = work << 7;
        for (i = 0; i < 8; i++) {
            bmp2byte_table[i][pat * 2 + 1] = (work * i) << 3;
            bmp2byte_table[i + 8][pat * 2 + 1] =
                bmp2byte_table[i][pat * 2 + 1] ^ 0x38383838;
        }
    }

    for (pat = 0; pat < 16; pat++) {
        work = 0;
        for (bit = 0x4; bit < 0x10; bit <<= 1) {
            work <<= 16;
            if (pat & bit) {
                work |= 0x0101;
            }
        }
        for (i = 0; i < 8; i++) {
            text_x2_table[pat][i] = (work * i) << 3;
            text_x2_table[pat][i + 8] = text_x2_table[pat][i] ^ 0x38383838;
        }

        for (bit = 1; bit < 4; bit <<= 1) {
            work <<= 16;
            if (pat & bit) {
                work |= 0x0101;
            }
        }
        for (i = 0; i < 8; i++) {
            text_x2_table[pat][i + 16] = (work * i) << 3;
            text_x2_table[pat][i + 24] = text_x2_table[pat][i + 16] ^ 0x38383838;
        }
    }
}

// --------------------------------------------------------------------------
// DRAW_SUB.CPP, DRAWTXT*.CPP 由来の関数ポインタ配列スタブ
// （これらのファイルはインラインアセンブリのためコンパイル除外）

void (*planeeffects[1])(void)   = {nullptr};
void (*planeeffects16[1])(void) = {nullptr};

void (*txt8effects[1])(void)    = {nullptr};
void (*pcg8effects[1])(void)    = {nullptr};
void (*knj8effects[1])(void)    = {nullptr};

void (*txt16effects[1])(void)   = {nullptr};
void (*pcg16effects[1])(void)   = {nullptr};
void (*knj16effects[1])(void)   = {nullptr};

void (*txtbeffects[1])(void)    = {nullptr};
void (*knjbeffects[1])(void)    = {nullptr};
void (*extbeffects[1])(void)    = {nullptr};

void (*txtbeffects16[1])(void)  = {nullptr};
void (*knjbeffects16[1])(void)  = {nullptr};
void (*pcgbeffectsx2[1])(void)  = {nullptr};

// X1デフォルトパレット設定
// bmp2byte_tableが生成するインデックス体系:
//   前景色c のピクセル → バイト値 c*8  (0,8,16,...,56)
//   反転前景           → バイト値 c*8 ^ 0x38
//   背景（黒）         → バイト値 0
//   反転背景           → バイト値 0x38 = 56（白）
// なのでxm_palette[i*8] = X1色i を設定すれば良い
extern PALETTE_TABLE xm_palette[256];
extern int xm_palettes;
extern void ddraws_change_palette(void);

void init_default_palette(void) {
    // X1 8色: bit0=B, bit1=R, bit2=G
    for (int c = 0; c < 8; c++) {
        BYTE b = (c & 1) ? 0xAA : 0;
        BYTE r = (c & 2) ? 0xAA : 0;
        BYTE g = (c & 4) ? 0xAA : 0;
        // グラフィックスピクセル用: インデックス c (0-7) → 色c
        xm_palette[c].p.b = b;
        xm_palette[c].p.r = r;
        xm_palette[c].p.g = g;
        xm_palette[c].p.f = 0;
        // テキストピクセル用: インデックス c*8 ～ c*8+7 を全部同じ色に
        for (int j = 0; j < 8; j++) {
            xm_palette[c * 8 + j].p.b = b;
            xm_palette[c * 8 + j].p.r = r;
            xm_palette[c * 8 + j].p.g = g;
            xm_palette[c * 8 + j].p.f = 0;
        }
    }
    xm_palettes = 64;
    ddraws_change_palette();
}

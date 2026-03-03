//----------------------------------------------------------------------------
// Width mode drawing functions - C++ port of DRAW8.CPP / DRAWTXT8.CPP
// Assembly-free reimplementation for Emscripten
//----------------------------------------------------------------------------

#include <stdio.h>
#include <string.h>
#include "common.h"
#include "xmil.h"
#include "x1.h"
#include "x1_crtc.h"
#include "x1_vram.h"
#include "draw.h"
#include "draw_sub.h"
#include "x1_pcg.h"

extern BYTE TXT_RAM[0x01800];
extern BYTE ANK_FNT[256][8];
extern BYTE KNJ_FNT[0x4bc00];
extern BYTE screenmap[SCREEN_WIDTH * SCREEN_HEIGHT];
extern DWORD bmp2byte_table[32][512];
extern DWORD text_x2_table[16][64];
extern BYTE blinktest;
extern BYTE fontlpcnt;
extern BYTE fonttype;
extern BYTE vramylpcnt;
extern BYTE dispflg;
extern WORD vramsize;
extern BYTE updatetmp[];
extern BYTE *dispp;   // Draw.cppで定義: &GRP_RAM[GRAM_BANK0 or BANK1]
extern BYTE *dispp2;  // Draw.cppで定義: &GRP_RAM[GRAM_BANK1 or BANK0]
extern WORD vramylpad;
extern BYTE g_cli_disable_text;
extern BYTE g_cli_disable_graph;
extern BYTE renewalline[];

// WIDTH 40 モード: 1文字を16px幅でスクリーンに書く（text_x2_tableを使用）
// color_idx: 0-7(normal) または 8-15(reversed)
static inline void draw_char_x2(int off, BYTE fdata, int color_idx) {
    BYTE hi = (fdata >> 4) & 0xF;
    BYTE lo = fdata & 0xF;
    // 各ニブル → 8ピクセル(DWORD×2) = 合計16ピクセル(DWORD×4)
    *(DWORD*)&screenmap[off + 0]  = text_x2_table[hi][color_idx];
    *(DWORD*)&screenmap[off + 4]  = text_x2_table[hi][color_idx + 16];
    *(DWORD*)&screenmap[off + 8]  = text_x2_table[lo][color_idx];
    *(DWORD*)&screenmap[off + 12] = text_x2_table[lo][color_idx + 16];
}

static inline BYTE expand_nibble_x2(BYTE n) {
    BYTE v = 0;
    if (n & 0x8) v |= 0xC0;
    if (n & 0x4) v |= 0x30;
    if (n & 0x2) v |= 0x0C;
    if (n & 0x1) v |= 0x03;
    return v;
}

static inline BYTE apply_upt_hfx(BYTE fdata, BYTE eff4) {
    switch (eff4) {
        case 2:
        case 3:
        case 6:
        case 7:
            return (BYTE)(fdata << 4);      // right4dot*
        case 8:
        case 9:
        case 12:
        case 13:
            return expand_nibble_x2((BYTE)(fdata >> 4));   // *left
        case 10:
        case 11:
        case 14:
        case 15:
            return expand_nibble_x2((BYTE)(fdata & 0x0F)); // *right
        default:
            return fdata;
    }
}

// DRAWTXT8.CPP の txt8effects/pcg8effects に合わせた 8line 効果。
// src8 は 8line フォント(ANK/PCG1plane)。
static inline BYTE effect8_fetch(const BYTE* src8, BYTE eff4, BYTE row_fyc, int y) {
    int idx = 0;
    const int iter = y >> 1;

    switch (eff4) {
        case 1:  // halfx2
        case 3:  // right4half
        case 9:  // halfx4left
        case 11: // halfx4right
        {
            int base = (row_fyc >> 1) & 7;
            if (base != 0) {
                if (iter == 0) idx = base;
                else idx = ((iter - 1) * 2) & 7;
            } else {
                idx = (iter * 2) & 7;
            }
            break;
        }
        case 4:  // Yx2
        case 6:  // right4x2
        case 12: // x4left
        case 14: // x4right
            idx = (((row_fyc >> 1) & 7) + iter) & 7;
            break;
        default:
            idx = y & 7;
            break;
    }

    BYTE v = src8[idx];
    return apply_upt_hfx(v, eff4);
}

static inline BYTE map_src_y_knj8(BYTE y, BYTE eff4, BYTE fyc) {
    switch (eff4) {
        case 1:
        case 3:
        case 9:
        case 11:
            return (BYTE)((((fyc << 1) + ((y >> 1) << 3)) & 31));
        case 4:
        case 6:
        case 12:
        case 14:
            return (BYTE)((((fyc << 1) + ((y >> 1) << 2)) & 31));
        default:
            return (BYTE)(((y << 2) & 31));
    }
}

// DRAWTXT8.CPP の knj8effects に合わせた 8line 漢字効果。
// src32 は 32byte ストライド（+4/+2/+8, &31 で参照）。
static inline BYTE effect8_fetch_knj(const BYTE* src32, BYTE eff4, BYTE row_fyc, int y) {
    int idx = 0;
    const int iter = y >> 1;

    switch (eff4) {
        case 1:  // halfx2
        case 3:  // right4half
        case 9:  // halfx4left
        case 11: // halfx4right
        {
            int base = ((int)row_fyc << 1) & 31;
            if (base != 0) {
                if (iter == 0) idx = base;
                else idx = ((iter - 1) * 8) & 31;
            } else {
                idx = (iter * 8) & 31;
            }
            break;
        }
        case 4:  // Yx2
        case 6:  // right4x2
        case 12: // x4left
        case 14: // x4right
        {
            int base = ((int)row_fyc << 1) & 31;
            idx = (base + iter * 2) & 31;
            break;
        }
        default:
            idx = (y * 4) & 31;
            break;
    }

    BYTE v = src32[idx];
    return apply_upt_hfx(v, eff4);
}

// DRAWTXT6.CPP の txt16effects 相当（src16: 16byte 連続）
static inline BYTE effect16_fetch_txt(const BYTE* src16, BYTE eff4, BYTE row_fyc, int subline) {
    int idx = 0;
    const int iter = subline >> 1;

    switch (eff4) {
        case 1:  // halfx2
        case 3:  // right4half
        case 9:  // halfx4left
        case 11: // halfx4right
        {
            int base = row_fyc & 15;
            if (base != 0) {
                if (iter == 0) idx = base;
                else idx = ((iter - 1) * 2) & 15;
            } else {
                idx = (iter * 2) & 15;
            }
            break;
        }
        case 4:  // Yx2
        case 6:  // right4x2
        case 12: // x4left
        case 14: // x4right
            idx = (row_fyc + iter) & 15;
            break;
        default:
            idx = subline & 15;
            break;
    }

    BYTE v = src16[idx];
    return apply_upt_hfx(v, eff4);
}

// DRAWTXT6.CPP の knj16effects 相当（src32: 32byte, stride=2, mask=31）
// 漢字フォントは 32 バイト中 偶数バイト(0,2,4,...,30) にデータがある。
// txt16effects のインデックスを ×2 したものが基本だが、
// right4x2(eff4=6) は stride=4 で特殊。
static inline BYTE effect16_fetch_knj(const BYTE* src32, BYTE eff4, BYTE row_fyc, int subline) {
    int idx = 0;
    const int iter = subline >> 1;

    switch (eff4) {
        case 1:  // halfx2
        case 3:  // right4half
        case 9:  // halfx4left
        case 11: // halfx4right
        {
            int base = ((int)row_fyc * 2) & 31;
            if (base != 0) {
                if (iter == 0) idx = base;
                else idx = ((iter - 1) * 4) & 31;
            } else {
                idx = (iter * 4) & 31;
            }
            break;
        }
        case 4:  // Yx2
        case 12: // x4left
        case 14: // x4right
            idx = (((int)row_fyc + iter) * 2) & 31;
            break;
        case 6:  // right4x2
            idx = (((int)row_fyc * 2) + iter * 4) & 31;
            break;
        default:
            idx = (subline * 2) & 31;
            break;
    }

    BYTE v = src32[idx];
    return apply_upt_hfx(v, eff4);
}

// DRAW8.CPP の各モードが持つ差分（更新マスク/縦倍率/TRAM上限）を
// 共通 C++ 描画器に反映する。
static void draw_text_graph_common(BYTE update_mask, WORD tram_limit, int max_rows, int y_scale,
                                   bool use_400_graph_bank, bool blend_graph) {
    WORD tram_pos = crtc.TXT_TOP;
    int cols = crtc.TXT_XL ? (int)crtc.TXT_XL : 80;
    int rows = crtc.TXT_YL ? (int)crtc.TXT_YL : max_rows;
    if (cols > 80) cols = 80;
    if (rows > max_rows) rows = max_rows;
    if (y_scale < 1) y_scale = 1;

    int chr_h = fontlpcnt ? (int)fontlpcnt : 8;
    int cell_h = vramylpcnt ? (int)vramylpcnt : chr_h;

    for (int row = 0; row < rows; row++) {
        BYTE row_fontycnt = fontycnt;
        WORD row_last_addr = tram_pos;
        for (int col = 0; col < cols; col++) {
            WORD raw_addr = tram_pos & (TRAM_MAX - 1);
            if (raw_addr >= tram_limit) {
                tram_pos++;
                continue;
            }
            WORD addr = raw_addr;
            row_last_addr = addr;

            if (updatetmp[addr] & update_mask) {
                BYTE upt = updatetmp[addr];
                BYTE eff4 = (BYTE)(upt & 0x0F);
                updatetmp[addr] &= (BYTE)~update_mask;
                WORD src_addr = addr;
                // DRAW8.CPP: bt dx,4 / sbb si,0
                // 右半分属性時はひとつ左の文字コード/属性を参照する。
                if (upt & 0x10) {
                    src_addr = (WORD)((addr - 1) & (TRAM_MAX - 1));
                }

                BYTE src_attr = TXT_RAM[src_addr + TEXT_ATR];
            BYTE attr = TXT_RAM[addr + TEXT_ATR];
            if (attr & blinktest) {
                    attr ^= X1ATR_REVERSE;
                }

                BYTE char_code = TXT_RAM[src_addr + TEXT_ANK];
                BYTE knj_code = TXT_RAM[src_addr + TEXT_KNJ];
                BYTE color_idx;
                if (attr & X1ATR_REVERSE) {
                    color_idx = (attr & X1ATR_COLOR) + 8;
                } else {
                    color_idx = attr & X1ATR_COLOR;
                }

                int sx = col * 8;
                int sy = row * cell_h * y_scale;
                const bool draw_text_layer = (g_cli_disable_text == 0);
                const bool draw_graph_layer = blend_graph && (g_cli_disable_graph == 0);

                if (!draw_text_layer) {
                    for (int y = 0; y < chr_h; y++) {
                        for (int ys = 0; ys < y_scale; ys++) {
                            int off = (sy + y * y_scale + ys) * SCREEN_WIDTH + sx;
                            if (off + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                                *(DWORD*)&screenmap[off + 0] = 0;
                                *(DWORD*)&screenmap[off + 4] = 0;
                            }
                        }
                    }
                }
                else if (src_attr & X1ATR_PCG) {
                    BYTE color_bits = attr & X1ATR_COLOR;
                    // REVERSE時: 未使用プレーンを全ビットONにする（背景=色7, 文字=complement）
                    DWORD rev_fill_unused = 0;
                    if (attr & X1ATR_REVERSE) {
                        if (!(color_bits & 1)) rev_fill_unused |= 0x08080808u;
                        if (!(color_bits & 2)) rev_fill_unused |= 0x10101010u;
                        if (!(color_bits & 4)) rev_fill_unused |= 0x20202020u;
                    }
                    const bool pcg16 = (knj_code & 0x90) != 0;
                    BYTE pcg_chr = pcg16 ? (BYTE)(char_code & 0xFE) : char_code;
                    for (int y = 0; y < chr_h; y++) {
                        for (int ys = 0; ys < y_scale; ys++) {
                            const int subline = y * y_scale + ys;
                            DWORD pl = rev_fill_unused, pr = rev_fill_unused;
                            if (color_bits & 1) {
                                BYTE b = pcg16 ? effect16_fetch_txt(&pcg.B[pcg_chr][0], eff4, row_fontycnt, subline)
                                               : effect8_fetch(pcg.B[pcg_chr], eff4, row_fontycnt, y);
                                if (attr & X1ATR_REVERSE) b ^= 0xFF;
                                pl |= bmp2byte_table[1][b*2];
                                pr |= bmp2byte_table[1][b*2+1];
                            }
                            if (color_bits & 2) {
                                BYTE r = pcg16 ? effect16_fetch_txt(&pcg.R[pcg_chr][0], eff4, row_fontycnt, subline)
                                               : effect8_fetch(pcg.R[pcg_chr], eff4, row_fontycnt, y);
                                if (attr & X1ATR_REVERSE) r ^= 0xFF;
                                pl |= bmp2byte_table[2][r*2];
                                pr |= bmp2byte_table[2][r*2+1];
                            }
                            if (color_bits & 4) {
                                BYTE g = pcg16 ? effect16_fetch_txt(&pcg.G[pcg_chr][0], eff4, row_fontycnt, subline)
                                               : effect8_fetch(pcg.G[pcg_chr], eff4, row_fontycnt, y);
                                if (attr & X1ATR_REVERSE) g ^= 0xFF;
                                pl |= bmp2byte_table[4][g*2];
                                pr |= bmp2byte_table[4][g*2+1];
                            }
                            pl &= 0x38383838u;
                            pr &= 0x38383838u;
                            int off = (sy + y * y_scale + ys) * SCREEN_WIDTH + sx;
                            if (off + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                                *(DWORD*)&screenmap[off + 0] = pl;
                                *(DWORD*)&screenmap[off + 4] = pr;
                            }
                        }
                    }
                } else {
                    for (int y = 0; y < chr_h; y++) {
                        BYTE fdata = 0;
                        if (knj_code & 0x80) {
                            WORD jis_adr = ((WORD)knj_code << 8) | char_code;
                            BYTE* kfont = getfontjis(adr2jis_x1t(jis_adr));
                            if (knj_code & 0x40) {
                                kfont++;
                            }
                            if (!(fonttype & KNJ_24KHz)) {
                                fdata = effect8_fetch_knj(kfont, eff4, row_fontycnt, y);
                            }
                        } else if (fonttype & ANK_24KHz) {
                            // 下で subline ベースで取得
                        } else {
                            fdata = effect8_fetch(ANK_FNT[char_code], eff4, row_fontycnt, y);
                        }
                        for (int ys = 0; ys < y_scale; ys++) {
                            BYTE pf = fdata;
                            if (knj_code & 0x80) {
                                if (fonttype & KNJ_24KHz) {
                                    WORD jis_adr = ((WORD)knj_code << 8) | char_code;
                                    BYTE* kfont = getfontjis(adr2jis_x1t(jis_adr));
                                    if (knj_code & 0x40) {
                                        kfont++;
                                    }
                                    pf = effect16_fetch_knj(kfont, eff4, row_fontycnt, y * y_scale + ys);
                                }
                            } else if (fonttype & ANK_24KHz) {
                                const BYTE* a16 = &KNJ_FNT[((WORD)char_code << 4)];
                                pf = effect16_fetch_txt(a16, eff4, row_fontycnt, y * y_scale + ys);
                            }

                            DWORD left4  = bmp2byte_table[color_idx][pf * 2];
                            DWORD right4 = bmp2byte_table[color_idx][pf * 2 + 1];
                            left4  &= 0x38383838u;
                            right4 &= 0x38383838u;
                            int off = (sy + y * y_scale + ys) * SCREEN_WIDTH + sx;
                            if (off + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                                *(DWORD*)&screenmap[off + 0] = left4;
                                *(DWORD*)&screenmap[off + 4] = right4;
                            }
                        }
                    }
                }

                if (draw_graph_layer) {
                    int vcnt = vramylpcnt ? (int)vramylpcnt : chr_h;
                    for (int y = 0; y < vcnt; y++) {
                        DWORD gr_left;
                        DWORD gr_right;

                        if (use_400_graph_bank) {
                            DWORD grp_idx = (DWORD)(addr) << 5;
                            int off_base = (sy + y * y_scale) * SCREEN_WIDTH + sx;
                            if (y_scale >= 4) {
                                // DRAW8.CPP width80x12_400line の grphcpy400_lp:
                                // BANK0L, BANK1L, BANK0H, BANK1H を 4ラスターに対応
                                BYTE b0l = GRP_RAM[GRAM_BANK0L + grp_idx + PLANE_B + y];
                                BYTE r0l = GRP_RAM[GRAM_BANK0L + grp_idx + PLANE_R + y];
                                BYTE g0l = GRP_RAM[GRAM_BANK0L + grp_idx + PLANE_G + y];
                                BYTE b1l = GRP_RAM[GRAM_BANK1L + grp_idx + PLANE_B + y];
                                BYTE r1l = GRP_RAM[GRAM_BANK1L + grp_idx + PLANE_R + y];
                                BYTE g1l = GRP_RAM[GRAM_BANK1L + grp_idx + PLANE_G + y];
                                BYTE b0h = GRP_RAM[GRAM_BANK0H + grp_idx + PLANE_B + y];
                                BYTE r0h = GRP_RAM[GRAM_BANK0H + grp_idx + PLANE_R + y];
                                BYTE g0h = GRP_RAM[GRAM_BANK0H + grp_idx + PLANE_G + y];
                                BYTE b1h = GRP_RAM[GRAM_BANK1H + grp_idx + PLANE_B + y];
                                BYTE r1h = GRP_RAM[GRAM_BANK1H + grp_idx + PLANE_R + y];
                                BYTE g1h = GRP_RAM[GRAM_BANK1H + grp_idx + PLANE_G + y];

                                DWORD gl0 = bmp2byte_table[16][b0l*2]   | bmp2byte_table[17][r0l*2]   | bmp2byte_table[18][g0l*2];
                                DWORD gr0 = bmp2byte_table[16][b0l*2+1] | bmp2byte_table[17][r0l*2+1] | bmp2byte_table[18][g0l*2+1];
                                DWORD gl1 = bmp2byte_table[16][b1l*2]   | bmp2byte_table[17][r1l*2]   | bmp2byte_table[18][g1l*2];
                                DWORD gr1 = bmp2byte_table[16][b1l*2+1] | bmp2byte_table[17][r1l*2+1] | bmp2byte_table[18][g1l*2+1];
                                DWORD gl2 = bmp2byte_table[16][b0h*2]   | bmp2byte_table[17][r0h*2]   | bmp2byte_table[18][g0h*2];
                                DWORD gr2 = bmp2byte_table[16][b0h*2+1] | bmp2byte_table[17][r0h*2+1] | bmp2byte_table[18][g0h*2+1];
                                DWORD gl3 = bmp2byte_table[16][b1h*2]   | bmp2byte_table[17][r1h*2]   | bmp2byte_table[18][g1h*2];
                                DWORD gr3 = bmp2byte_table[16][b1h*2+1] | bmp2byte_table[17][r1h*2+1] | bmp2byte_table[18][g1h*2+1];
                                gl0 &= 0x07070707u; gr0 &= 0x07070707u;
                                gl1 &= 0x07070707u; gr1 &= 0x07070707u;
                                gl2 &= 0x07070707u; gr2 &= 0x07070707u;
                                gl3 &= 0x07070707u; gr3 &= 0x07070707u;

                                int off0 = off_base;
                                int off1 = off_base + SCREEN_WIDTH;
                                int off2 = off_base + SCREEN_WIDTH * 2;
                                int off3 = off_base + SCREEN_WIDTH * 3;
                                if (off0 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                                    *(DWORD*)&screenmap[off0 + 0] |= gl0;
                                    *(DWORD*)&screenmap[off0 + 4] |= gr0;
                                }
                                if (off1 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                                    *(DWORD*)&screenmap[off1 + 0] |= gl1;
                                    *(DWORD*)&screenmap[off1 + 4] |= gr1;
                                }
                                if (off2 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                                    *(DWORD*)&screenmap[off2 + 0] |= gl2;
                                    *(DWORD*)&screenmap[off2 + 4] |= gr2;
                                }
                                if (off3 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                                    *(DWORD*)&screenmap[off3 + 0] |= gl3;
                                    *(DWORD*)&screenmap[off3 + 4] |= gr3;
                                }
                            } else {
                                BYTE b0 = GRP_RAM[GRAM_BANK0 + grp_idx + PLANE_B + y];
                                BYTE r0 = GRP_RAM[GRAM_BANK0 + grp_idx + PLANE_R + y];
                                BYTE g0 = GRP_RAM[GRAM_BANK0 + grp_idx + PLANE_G + y];
                                BYTE b1 = GRP_RAM[GRAM_BANK1 + grp_idx + PLANE_B + y];
                                BYTE r1 = GRP_RAM[GRAM_BANK1 + grp_idx + PLANE_R + y];
                                BYTE g1 = GRP_RAM[GRAM_BANK1 + grp_idx + PLANE_G + y];

                                DWORD gl0 = bmp2byte_table[16][b0*2]   | bmp2byte_table[17][r0*2]   | bmp2byte_table[18][g0*2];
                                DWORD gr0 = bmp2byte_table[16][b0*2+1] | bmp2byte_table[17][r0*2+1] | bmp2byte_table[18][g0*2+1];
                                DWORD gl1 = bmp2byte_table[16][b1*2]   | bmp2byte_table[17][r1*2]   | bmp2byte_table[18][g1*2];
                                DWORD gr1 = bmp2byte_table[16][b1*2+1] | bmp2byte_table[17][r1*2+1] | bmp2byte_table[18][g1*2+1];
                                gl0 &= 0x07070707u; gr0 &= 0x07070707u;
                                gl1 &= 0x07070707u; gr1 &= 0x07070707u;

                                int off0 = off_base;
                                int off1 = off_base + SCREEN_WIDTH;
                                if (off0 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                                    *(DWORD*)&screenmap[off0 + 0] |= gl0;
                                    *(DWORD*)&screenmap[off0 + 4] |= gr0;
                                }
                                if (off1 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                                    *(DWORD*)&screenmap[off1 + 0] |= gl1;
                                    *(DWORD*)&screenmap[off1 + 4] |= gr1;
                                }
                            }
                        } else {
                            BYTE* grp = dispp + ((DWORD)(addr) << 5);
                            if ((y_scale == 4) && !use_400_graph_bank) {
                                // DRAW8.CPP width80x12_200line の grphcpy_lp:
                                // 上2ラスターはベース面、下2ラスターは GRAM_HALFSTEP 面を使用。
                                BYTE b0 = grp[PLANE_B + y];
                                BYTE r0 = grp[PLANE_R + y];
                                BYTE g0 = grp[PLANE_G + y];
                                DWORD gl0 = bmp2byte_table[16][b0*2]   | bmp2byte_table[17][r0*2]   | bmp2byte_table[18][g0*2];
                                DWORD gr0 = bmp2byte_table[16][b0*2+1] | bmp2byte_table[17][r0*2+1] | bmp2byte_table[18][g0*2+1];
                                gl0 &= 0x07070707u; gr0 &= 0x07070707u;

                                BYTE b1 = grp[PLANE_B + GRAM_HALFSTEP + y];
                                BYTE r1 = grp[PLANE_R + GRAM_HALFSTEP + y];
                                BYTE g1 = grp[PLANE_G + GRAM_HALFSTEP + y];
                                DWORD gl1 = bmp2byte_table[16][b1*2]   | bmp2byte_table[17][r1*2]   | bmp2byte_table[18][g1*2];
                                DWORD gr1 = bmp2byte_table[16][b1*2+1] | bmp2byte_table[17][r1*2+1] | bmp2byte_table[18][g1*2+1];
                                gl1 &= 0x07070707u; gr1 &= 0x07070707u;

                                int off0 = (sy + y * 4 + 0) * SCREEN_WIDTH + sx;
                                int off1 = (sy + y * 4 + 1) * SCREEN_WIDTH + sx;
                                int off2 = (sy + y * 4 + 2) * SCREEN_WIDTH + sx;
                                int off3 = (sy + y * 4 + 3) * SCREEN_WIDTH + sx;

                                if (off0 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                                    *(DWORD*)&screenmap[off0 + 0] |= gl0;
                                    *(DWORD*)&screenmap[off0 + 4] |= gr0;
                                }
                                if (off1 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                                    *(DWORD*)&screenmap[off1 + 0] += (gl0 | 0x40404040u);
                                    *(DWORD*)&screenmap[off1 + 4] += (gr0 | 0x40404040u);
                                }
                                if (off2 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                                    *(DWORD*)&screenmap[off2 + 0] |= gl1;
                                    *(DWORD*)&screenmap[off2 + 4] |= gr1;
                                }
                                if (off3 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                                    *(DWORD*)&screenmap[off3 + 0] += (gl1 | 0x40404040u);
                                    *(DWORD*)&screenmap[off3 + 4] += (gr1 | 0x40404040u);
                                }
                            } else {
                                BYTE b = grp[PLANE_B + y];
                                BYTE r = grp[PLANE_R + y];
                                BYTE g = grp[PLANE_G + y];
                                gr_left  = bmp2byte_table[16][b*2]   | bmp2byte_table[17][r*2]   | bmp2byte_table[18][g*2];
                                gr_right = bmp2byte_table[16][b*2+1] | bmp2byte_table[17][r*2+1] | bmp2byte_table[18][g*2+1];
                                gr_left  &= 0x07070707u;
                                gr_right &= 0x07070707u;
                                for (int ys = 0; ys < y_scale; ys++) {
                                    int off = (sy + y * y_scale + ys) * SCREEN_WIDTH + sx;
                                    if (off + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                                        if (!use_400_graph_bank) {
                                            // DRAW8.CPP の 8色グラフィック合成:
                                            // 200line/倍ラスタは偶数ラスター=OR, 奇数ラスター=ADD(|40404040h)。
                                            if ((ys & 1) == 0) {
                                                *(DWORD*)&screenmap[off + 0] |= gr_left;
                                                *(DWORD*)&screenmap[off + 4] |= gr_right;
                                            } else {
                                                *(DWORD*)&screenmap[off + 0] += (gr_left  | 0x40404040u);
                                                *(DWORD*)&screenmap[off + 4] += (gr_right | 0x40404040u);
                                            }
                                        } else {
                                            *(DWORD*)&screenmap[off + 0] |= gr_left;
                                            *(DWORD*)&screenmap[off + 4] |= gr_right;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            tram_pos++;
        }

        // DRAW8.CPP の行末処理に合わせて fontycnt を更新
        if (updatetmp[row_last_addr & (TRAM_MAX - 1)] & 0x04) {
            fontycnt += vramylpcnt;
        } else {
            fontycnt = (BYTE)(vramylpcnt * 2);
        }
        fontycnt &= 0x0F;
    }
}

// 80桁 x 25行 x 200ライン テキスト描画
void width80x25_200line(void) {
    fontycnt = 0;

    WORD tram_pos = crtc.TXT_TOP;
    const int cols = crtc.TXT_XL ? (int)crtc.TXT_XL : 80;
    if (cols <= 0) return;
    const int rows = (int)vramsize / cols;
    const int chr_h = fontlpcnt ? (int)fontlpcnt : 8;
    const int cell_h = vramylpcnt ? (int)vramylpcnt : chr_h;

    for (int row = 0; row < rows; row++) {
        BYTE row_fontycnt = fontycnt;
        WORD row_last_addr = tram_pos;
        int sy = row * cell_h * 2;

        for (int col = 0; col < cols; col++) {
            WORD addr = (WORD)(tram_pos & (TRAM_MAX - 1));
            row_last_addr = addr;

            BYTE upt = updatetmp[addr];
            if (!(upt & dispflg)) {
                tram_pos++;
                continue;
            }
            updatetmp[addr] &= (BYTE)~dispflg;

            BYTE eff4 = (BYTE)(upt & 0x0F);
            WORD src_addr = addr;
            if (upt & 0x10) {
                src_addr = (WORD)((addr - 1) & (TRAM_MAX - 1));
            }

            BYTE src_attr = TXT_RAM[src_addr + TEXT_ATR];
            BYTE attr = TXT_RAM[addr + TEXT_ATR];
            if (attr & blinktest) {
                attr ^= X1ATR_REVERSE;
            }

            BYTE char_code = TXT_RAM[src_addr + TEXT_ANK];
            BYTE knj_code = TXT_RAM[src_addr + TEXT_KNJ];
            BYTE color_idx = (attr & X1ATR_REVERSE)
                           ? (BYTE)((attr & X1ATR_COLOR) + 8)
                           : (BYTE)(attr & X1ATR_COLOR);

            int sx = col * 8;

            if (g_cli_disable_text) {
                for (int y = 0; y < chr_h; y++) {
                    int off0 = (sy + y * 2 + 0) * SCREEN_WIDTH + sx;
                    int off1 = off0 + SCREEN_WIDTH;
                    if (off0 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                        *(DWORD*)&screenmap[off0 + 0] = 0;
                        *(DWORD*)&screenmap[off0 + 4] = 0;
                    }
                    if (off1 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                        *(DWORD*)&screenmap[off1 + 0] = 0;
                        *(DWORD*)&screenmap[off1 + 4] = 0;
                    }
                }
            } else if (src_attr & X1ATR_PCG) {
                BYTE color_bits = attr & X1ATR_COLOR;
                const bool pcg16 = (knj_code & 0x90) != 0;
                BYTE pcg_chr = pcg16 ? (BYTE)(char_code & 0xFE) : char_code;

                for (int y = 0; y < chr_h; y++) {
                    for (int ys = 0; ys < 2; ys++) {
                        int subline = y * 2 + ys;
                        DWORD pl = 0, pr = 0;
                        if (color_bits & 1) {
                            BYTE b = pcg16 ? effect16_fetch_txt(&pcg.B[pcg_chr][0], eff4, row_fontycnt, subline)
                                           : effect8_fetch(pcg.B[pcg_chr], eff4, row_fontycnt, y);
                            if (attr & X1ATR_REVERSE) b ^= 0xFF;
                            pl |= bmp2byte_table[1][b * 2];
                            pr |= bmp2byte_table[1][b * 2 + 1];
                        }
                        if (color_bits & 2) {
                            BYTE r = pcg16 ? effect16_fetch_txt(&pcg.R[pcg_chr][0], eff4, row_fontycnt, subline)
                                           : effect8_fetch(pcg.R[pcg_chr], eff4, row_fontycnt, y);
                            if (attr & X1ATR_REVERSE) r ^= 0xFF;
                            pl |= bmp2byte_table[2][r * 2];
                            pr |= bmp2byte_table[2][r * 2 + 1];
                        }
                        if (color_bits & 4) {
                            BYTE g = pcg16 ? effect16_fetch_txt(&pcg.G[pcg_chr][0], eff4, row_fontycnt, subline)
                                           : effect8_fetch(pcg.G[pcg_chr], eff4, row_fontycnt, y);
                            if (attr & X1ATR_REVERSE) g ^= 0xFF;
                            pl |= bmp2byte_table[4][g * 2];
                            pr |= bmp2byte_table[4][g * 2 + 1];
                        }
                        pl &= 0x38383838u;
                        pr &= 0x38383838u;

                        int off = (sy + y * 2 + ys) * SCREEN_WIDTH + sx;
                        if (off + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                            *(DWORD*)&screenmap[off + 0] = pl;
                            *(DWORD*)&screenmap[off + 4] = pr;
                        }
                    }
                }
            } else {
                for (int y = 0; y < chr_h; y++) {
                    for (int ys = 0; ys < 2; ys++) {
                        BYTE pf = 0;
                        if (knj_code & 0x80) {
                            WORD jis_adr = ((WORD)knj_code << 8) | char_code;
                            BYTE* kfont = getfontjis(adr2jis_x1t(jis_adr));
                            if (knj_code & 0x40) {
                                kfont++;
                            }
                            if (fonttype & KNJ_24KHz) {
                                pf = effect16_fetch_knj(kfont, eff4, row_fontycnt, y * 2 + ys);
                            } else {
                                pf = effect8_fetch_knj(kfont, eff4, row_fontycnt, y);
                            }
                        } else if (fonttype & ANK_24KHz) {
                            const BYTE* a16 = &KNJ_FNT[((WORD)char_code << 4)];
                            pf = effect16_fetch_txt(a16, eff4, row_fontycnt, y * 2 + ys);
                        } else {
                            pf = effect8_fetch(ANK_FNT[char_code], eff4, row_fontycnt, y);
                        }

                        DWORD left4 = bmp2byte_table[color_idx][pf * 2] & 0x38383838u;
                        DWORD right4 = bmp2byte_table[color_idx][pf * 2 + 1] & 0x38383838u;
                        int off = (sy + y * 2 + ys) * SCREEN_WIDTH + sx;
                        if (off + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                            *(DWORD*)&screenmap[off + 0] = left4;
                            *(DWORD*)&screenmap[off + 4] = right4;
                        }
                    }
                }
            }

            if (!g_cli_disable_graph) {
                BYTE* grp = dispp + ((DWORD)(addr) << 5);
                int vcnt = vramylpcnt ? (int)vramylpcnt : chr_h;
                for (int y = 0; y < vcnt; y++) {
                    BYTE b = grp[PLANE_B + y];
                    BYTE r = grp[PLANE_R + y];
                    BYTE g = grp[PLANE_G + y];
                    DWORD gl = (bmp2byte_table[16][b * 2] |
                                bmp2byte_table[17][r * 2] |
                                bmp2byte_table[18][g * 2]) & 0x07070707u;
                    DWORD gr = (bmp2byte_table[16][b * 2 + 1] |
                                bmp2byte_table[17][r * 2 + 1] |
                                bmp2byte_table[18][g * 2 + 1]) & 0x07070707u;

                    int off0 = (sy + y * 2 + 0) * SCREEN_WIDTH + sx;
                    int off1 = off0 + SCREEN_WIDTH;
                    if (off0 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                        *(DWORD*)&screenmap[off0 + 0] |= gl;
                        *(DWORD*)&screenmap[off0 + 4] |= gr;
                    }
                    if (off1 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                        *(DWORD*)&screenmap[off1 + 0] += (gl | 0x40404040u);
                        *(DWORD*)&screenmap[off1 + 4] += (gr | 0x40404040u);
                    }
                }
            }

            tram_pos++;
        }

        if (updatetmp[row_last_addr & (TRAM_MAX - 1)] & 0x04) {
            fontycnt = (BYTE)((fontycnt + vramylpcnt) & 0x0F);
        } else {
            fontycnt = (BYTE)((vramylpcnt * 2) & 0x0F);
        }
    }
}

// 400ライン: 各フォント行を1ラスターにそのまま表示（伸ばさない）
void width80x25_400line(void) {
    fontycnt = 0;

    WORD tram_pos = crtc.TXT_TOP;
    const int cols = crtc.TXT_XL ? (int)crtc.TXT_XL : 80;
    if (cols <= 0) return;
    const int rows = (int)vramsize / cols;
    const int chr_h = fontlpcnt ? (int)fontlpcnt : 8;
    const int cell_h = vramylpcnt ? (int)vramylpcnt : chr_h;

    for (int row = 0; row < rows; row++) {
        BYTE row_fontycnt = fontycnt;
        WORD row_last_addr = tram_pos;
        int sy = row * cell_h * 2;

        for (int col = 0; col < cols; col++) {
            WORD addr = (WORD)(tram_pos & (TRAM_MAX - 1));
            row_last_addr = addr;

            BYTE upt = updatetmp[addr];
            if (!(upt & UPDATE_VRAM)) {
                tram_pos++;
                continue;
            }
            updatetmp[addr] &= (BYTE)~UPDATE_VRAM;

            BYTE eff4 = (BYTE)(upt & 0x0F);
            WORD src_addr = addr;
            if (upt & 0x10) {
                src_addr = (WORD)((addr - 1) & (TRAM_MAX - 1));
            }

            BYTE src_attr = TXT_RAM[src_addr + TEXT_ATR];
            BYTE attr = TXT_RAM[addr + TEXT_ATR];
            if (attr & blinktest) {
                attr ^= X1ATR_REVERSE;
            }

            BYTE char_code = TXT_RAM[src_addr + TEXT_ANK];
            BYTE knj_code = TXT_RAM[src_addr + TEXT_KNJ];
            BYTE color_idx = (attr & X1ATR_REVERSE)
                           ? (BYTE)((attr & X1ATR_COLOR) + 8)
                           : (BYTE)(attr & X1ATR_COLOR);
            int sx = col * 8;

            if (g_cli_disable_text) {
                for (int y = 0; y < chr_h; y++) {
                    for (int ys = 0; ys < 2; ys++) {
                        int off = (sy + y * 2 + ys) * SCREEN_WIDTH + sx;
                        if (off + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                            *(DWORD*)&screenmap[off + 0] = 0;
                            *(DWORD*)&screenmap[off + 4] = 0;
                        }
                    }
                }
            } else if (src_attr & X1ATR_PCG) {
                BYTE color_bits = attr & X1ATR_COLOR;
                const bool pcg16 = (knj_code & 0x90) != 0;
                BYTE pcg_chr = pcg16 ? (BYTE)(char_code & 0xFE) : char_code;

                for (int y = 0; y < chr_h; y++) {
                    for (int ys = 0; ys < 2; ys++) {
                        int subline = y * 2 + ys;
                        DWORD pl = 0, pr = 0;
                        if (color_bits & 1) {
                            BYTE b = pcg16 ? effect16_fetch_txt(&pcg.B[pcg_chr][0], eff4, row_fontycnt, subline)
                                           : effect8_fetch(pcg.B[pcg_chr], eff4, row_fontycnt, y);
                            if (attr & X1ATR_REVERSE) b ^= 0xFF;
                            pl |= bmp2byte_table[1][b * 2];
                            pr |= bmp2byte_table[1][b * 2 + 1];
                        }
                        if (color_bits & 2) {
                            BYTE r = pcg16 ? effect16_fetch_txt(&pcg.R[pcg_chr][0], eff4, row_fontycnt, subline)
                                           : effect8_fetch(pcg.R[pcg_chr], eff4, row_fontycnt, y);
                            if (attr & X1ATR_REVERSE) r ^= 0xFF;
                            pl |= bmp2byte_table[2][r * 2];
                            pr |= bmp2byte_table[2][r * 2 + 1];
                        }
                        if (color_bits & 4) {
                            BYTE g = pcg16 ? effect16_fetch_txt(&pcg.G[pcg_chr][0], eff4, row_fontycnt, subline)
                                           : effect8_fetch(pcg.G[pcg_chr], eff4, row_fontycnt, y);
                            if (attr & X1ATR_REVERSE) g ^= 0xFF;
                            pl |= bmp2byte_table[4][g * 2];
                            pr |= bmp2byte_table[4][g * 2 + 1];
                        }
                        pl &= 0x38383838u;
                        pr &= 0x38383838u;

                        int off = (sy + y * 2 + ys) * SCREEN_WIDTH + sx;
                        if (off + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                            *(DWORD*)&screenmap[off + 0] = pl;
                            *(DWORD*)&screenmap[off + 4] = pr;
                        }
                    }
                }
            } else {
                for (int y = 0; y < chr_h; y++) {
                    for (int ys = 0; ys < 2; ys++) {
                        BYTE pf = 0;
                        if (knj_code & 0x80) {
                            WORD jis_adr = ((WORD)knj_code << 8) | char_code;
                            BYTE* kfont = getfontjis(adr2jis_x1t(jis_adr));
                            if (knj_code & 0x40) {
                                kfont++;
                            }
                            if (fonttype & KNJ_24KHz) {
                                pf = effect16_fetch_knj(kfont, eff4, row_fontycnt, y * 2 + ys);
                            } else {
                                pf = effect8_fetch_knj(kfont, eff4, row_fontycnt, y);
                            }
                        } else if (fonttype & ANK_24KHz) {
                            const BYTE* a16 = &KNJ_FNT[((WORD)char_code << 4)];
                            pf = effect16_fetch_txt(a16, eff4, row_fontycnt, y * 2 + ys);
                        } else {
                            pf = effect8_fetch(ANK_FNT[char_code], eff4, row_fontycnt, y);
                        }

                        DWORD left4 = bmp2byte_table[color_idx][pf * 2] & 0x38383838u;
                        DWORD right4 = bmp2byte_table[color_idx][pf * 2 + 1] & 0x38383838u;
                        int off = (sy + y * 2 + ys) * SCREEN_WIDTH + sx;
                        if (off + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                            *(DWORD*)&screenmap[off + 0] = left4;
                            *(DWORD*)&screenmap[off + 4] = right4;
                        }
                    }
                }
            }

            if (!g_cli_disable_graph) {
                DWORD grp_idx = (DWORD)(addr) << 5;
                int vcnt = vramylpcnt ? (int)vramylpcnt : chr_h;
                for (int y = 0; y < vcnt; y++) {
                    BYTE b0 = GRP_RAM[GRAM_BANK0 + grp_idx + PLANE_B + y];
                    BYTE r0 = GRP_RAM[GRAM_BANK0 + grp_idx + PLANE_R + y];
                    BYTE g0 = GRP_RAM[GRAM_BANK0 + grp_idx + PLANE_G + y];
                    BYTE b1 = GRP_RAM[GRAM_BANK1 + grp_idx + PLANE_B + y];
                    BYTE r1 = GRP_RAM[GRAM_BANK1 + grp_idx + PLANE_R + y];
                    BYTE g1 = GRP_RAM[GRAM_BANK1 + grp_idx + PLANE_G + y];

                    DWORD gl0 = (bmp2byte_table[16][b0 * 2] | bmp2byte_table[17][r0 * 2] | bmp2byte_table[18][g0 * 2]) & 0x07070707u;
                    DWORD gr0 = (bmp2byte_table[16][b0 * 2 + 1] | bmp2byte_table[17][r0 * 2 + 1] | bmp2byte_table[18][g0 * 2 + 1]) & 0x07070707u;
                    DWORD gl1 = (bmp2byte_table[16][b1 * 2] | bmp2byte_table[17][r1 * 2] | bmp2byte_table[18][g1 * 2]) & 0x07070707u;
                    DWORD gr1 = (bmp2byte_table[16][b1 * 2 + 1] | bmp2byte_table[17][r1 * 2 + 1] | bmp2byte_table[18][g1 * 2 + 1]) & 0x07070707u;

                    int off0 = (sy + y * 2 + 0) * SCREEN_WIDTH + sx;
                    int off1 = off0 + SCREEN_WIDTH;
                    if (off0 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                        *(DWORD*)&screenmap[off0 + 0] |= gl0;
                        *(DWORD*)&screenmap[off0 + 4] |= gr0;
                    }
                    if (off1 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                        *(DWORD*)&screenmap[off1 + 0] |= gl1;
                        *(DWORD*)&screenmap[off1 + 4] |= gr1;
                    }
                }
            }

            tram_pos++;
        }

        if (updatetmp[row_last_addr & (TRAM_MAX - 1)] & 0x04) {
            fontycnt = (BYTE)((fontycnt + vramylpcnt) & 0x0F);
        } else {
            fontycnt = (BYTE)((vramylpcnt * 2) & 0x0F);
        }
    }
}

// Remaining modes currently share the same software renderer path.
// Keep behavior consistent enough for debugging until full mode-specific
// DRAW8/DRAWTXT port is completed.

void width80x12_200line(void) {
    fontycnt = 0;

    WORD tram_pos = crtc.TXT_TOP;
    const int cols = crtc.TXT_XL ? (int)crtc.TXT_XL : 80;
    if (cols <= 0) return;
    const int rows = (int)vramsize / cols;
    const int chr_h = fontlpcnt ? (int)fontlpcnt : 8;
    const int cell_h = vramylpcnt ? (int)vramylpcnt : chr_h;

    for (int row = 0; row < rows; row++) {
        BYTE row_fontycnt = fontycnt;
        WORD row_last_addr = tram_pos;
        int sy = row * cell_h * 4;

        for (int col = 0; col < cols; col++) {
            WORD addr = (WORD)(tram_pos & (TRAM_MAX - 1));
            row_last_addr = addr;
            if (addr >= (TRAM_MAX / 2)) {
                tram_pos++;
                continue;
            }

            BYTE upt = updatetmp[addr];
            if (!(upt & dispflg)) {
                tram_pos++;
                continue;
            }
            updatetmp[addr] ^= dispflg;
            upt = updatetmp[addr];

            BYTE eff4 = (BYTE)(upt & 0x0F);
            WORD src_addr = addr;
            if (upt & 0x10) {
                src_addr = (WORD)((addr - 1) & (TRAM_MAX - 1));
            }

            BYTE src_attr = TXT_RAM[src_addr + TEXT_ATR];
            BYTE attr = TXT_RAM[addr + TEXT_ATR];
            if (attr & blinktest) {
                attr ^= X1ATR_REVERSE;
            }

            BYTE char_code = TXT_RAM[src_addr + TEXT_ANK];
            BYTE knj_code = TXT_RAM[src_addr + TEXT_KNJ];
            BYTE color_idx = (attr & X1ATR_REVERSE)
                           ? (BYTE)((attr & X1ATR_COLOR) + 8)
                           : (BYTE)(attr & X1ATR_COLOR);
            int sx = col * 8;

            if (g_cli_disable_text) {
                for (int y = 0; y < chr_h; y++) {
                    for (int ys = 0; ys < 4; ys++) {
                        int off = (sy + y * 4 + ys) * SCREEN_WIDTH + sx;
                        if (off + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                            *(DWORD*)&screenmap[off + 0] = 0;
                            *(DWORD*)&screenmap[off + 4] = 0;
                        }
                    }
                }
            } else if (src_attr & X1ATR_PCG) {
                BYTE color_bits = attr & X1ATR_COLOR;
                const bool pcg16 = (knj_code & 0x90) != 0;
                BYTE pcg_chr = pcg16 ? (BYTE)(char_code & 0xFE) : char_code;

                for (int y = 0; y < chr_h; y++) {
                    for (int ys = 0; ys < 4; ys++) {
                        int subline = (y * 4 + ys) / 2;  // TEXT_DOUBLERASTER equivalent
                        DWORD pl = 0, pr = 0;
                        if (color_bits & 1) {
                            BYTE b = pcg16 ? effect16_fetch_txt(&pcg.B[pcg_chr][0], eff4, row_fontycnt, subline)
                                           : effect8_fetch(pcg.B[pcg_chr], eff4, row_fontycnt, y);
                            if (attr & X1ATR_REVERSE) b ^= 0xFF;
                            pl |= bmp2byte_table[1][b * 2];
                            pr |= bmp2byte_table[1][b * 2 + 1];
                        }
                        if (color_bits & 2) {
                            BYTE r = pcg16 ? effect16_fetch_txt(&pcg.R[pcg_chr][0], eff4, row_fontycnt, subline)
                                           : effect8_fetch(pcg.R[pcg_chr], eff4, row_fontycnt, y);
                            if (attr & X1ATR_REVERSE) r ^= 0xFF;
                            pl |= bmp2byte_table[2][r * 2];
                            pr |= bmp2byte_table[2][r * 2 + 1];
                        }
                        if (color_bits & 4) {
                            BYTE g = pcg16 ? effect16_fetch_txt(&pcg.G[pcg_chr][0], eff4, row_fontycnt, subline)
                                           : effect8_fetch(pcg.G[pcg_chr], eff4, row_fontycnt, y);
                            if (attr & X1ATR_REVERSE) g ^= 0xFF;
                            pl |= bmp2byte_table[4][g * 2];
                            pr |= bmp2byte_table[4][g * 2 + 1];
                        }
                        pl &= 0x38383838u;
                        pr &= 0x38383838u;

                        int off = (sy + y * 4 + ys) * SCREEN_WIDTH + sx;
                        if (off + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                            *(DWORD*)&screenmap[off + 0] = pl;
                            *(DWORD*)&screenmap[off + 4] = pr;
                        }
                    }
                }
            } else {
                for (int y = 0; y < chr_h; y++) {
                    for (int ys = 0; ys < 4; ys++) {
                        BYTE pf = 0;
                        if (knj_code & 0x80) {
                            WORD jis_adr = ((WORD)knj_code << 8) | char_code;
                            BYTE* kfont = getfontjis(adr2jis_x1t(jis_adr));
                            if (knj_code & 0x40) {
                                kfont++;
                            }
                            if (fonttype & KNJ_24KHz) {
                                pf = effect16_fetch_knj(kfont, eff4, row_fontycnt, (y * 4 + ys) / 2);
                            } else {
                                pf = effect8_fetch_knj(kfont, eff4, row_fontycnt, y);
                            }
                        } else if (fonttype & ANK_24KHz) {
                            const BYTE* a16 = &KNJ_FNT[((WORD)char_code << 4)];
                            pf = effect16_fetch_txt(a16, eff4, row_fontycnt, (y * 4 + ys) / 2);
                        } else {
                            pf = effect8_fetch(ANK_FNT[char_code], eff4, row_fontycnt, y);
                        }

                        DWORD left4 = bmp2byte_table[color_idx][pf * 2] & 0x38383838u;
                        DWORD right4 = bmp2byte_table[color_idx][pf * 2 + 1] & 0x38383838u;
                        int off = (sy + y * 4 + ys) * SCREEN_WIDTH + sx;
                        if (off + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                            *(DWORD*)&screenmap[off + 0] = left4;
                            *(DWORD*)&screenmap[off + 4] = right4;
                        }
                    }
                }
            }

            if (!g_cli_disable_graph) {
                BYTE* grp = dispp + ((DWORD)(addr) << 5);
                int vcnt = vramylpcnt ? (int)vramylpcnt : chr_h;
                for (int y = 0; y < vcnt; y++) {
                    BYTE b0 = grp[PLANE_B + y];
                    BYTE r0 = grp[PLANE_R + y];
                    BYTE g0 = grp[PLANE_G + y];
                    DWORD gl0 = (bmp2byte_table[16][b0 * 2] |
                                 bmp2byte_table[17][r0 * 2] |
                                 bmp2byte_table[18][g0 * 2]) & 0x07070707u;
                    DWORD gr0 = (bmp2byte_table[16][b0 * 2 + 1] |
                                 bmp2byte_table[17][r0 * 2 + 1] |
                                 bmp2byte_table[18][g0 * 2 + 1]) & 0x07070707u;

                    BYTE b1 = grp[PLANE_B + GRAM_HALFSTEP + y];
                    BYTE r1 = grp[PLANE_R + GRAM_HALFSTEP + y];
                    BYTE g1 = grp[PLANE_G + GRAM_HALFSTEP + y];
                    DWORD gl1 = (bmp2byte_table[16][b1 * 2] |
                                 bmp2byte_table[17][r1 * 2] |
                                 bmp2byte_table[18][g1 * 2]) & 0x07070707u;
                    DWORD gr1 = (bmp2byte_table[16][b1 * 2 + 1] |
                                 bmp2byte_table[17][r1 * 2 + 1] |
                                 bmp2byte_table[18][g1 * 2 + 1]) & 0x07070707u;

                    int off0 = (sy + y * 4 + 0) * SCREEN_WIDTH + sx;
                    int off1 = off0 + SCREEN_WIDTH;
                    int off2 = off0 + SCREEN_WIDTH * 2;
                    int off3 = off0 + SCREEN_WIDTH * 3;
                    if (off0 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                        *(DWORD*)&screenmap[off0 + 0] |= gl0;
                        *(DWORD*)&screenmap[off0 + 4] |= gr0;
                    }
                    if (off1 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                        *(DWORD*)&screenmap[off1 + 0] += (gl0 | 0x40404040u);
                        *(DWORD*)&screenmap[off1 + 4] += (gr0 | 0x40404040u);
                    }
                    if (off2 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                        *(DWORD*)&screenmap[off2 + 0] |= gl1;
                        *(DWORD*)&screenmap[off2 + 4] |= gr1;
                    }
                    if (off3 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                        *(DWORD*)&screenmap[off3 + 0] += (gl1 | 0x40404040u);
                        *(DWORD*)&screenmap[off3 + 4] += (gr1 | 0x40404040u);
                    }
                }
            }

            tram_pos++;
        }

        if (updatetmp[row_last_addr & (TRAM_MAX - 1)] & 0x04) {
            fontycnt = (BYTE)((fontycnt + vramylpcnt) & 0x0F);
        } else {
            fontycnt = (BYTE)((vramylpcnt * 2) & 0x0F);
        }
    }
}

void width80x12_400line(void) {
    fontycnt = 0;

    WORD tram_pos = crtc.TXT_TOP;
    const int cols = crtc.TXT_XL ? (int)crtc.TXT_XL : 80;
    if (cols <= 0) return;
    const int rows = (int)vramsize / cols;
    const int chr_h = fontlpcnt ? (int)fontlpcnt : 8;
    const int cell_h = vramylpcnt ? (int)vramylpcnt : chr_h;

    for (int row = 0; row < rows; row++) {
        BYTE row_fontycnt = fontycnt;
        WORD row_last_addr = tram_pos;
        int sy = row * cell_h * 4;

        for (int col = 0; col < cols; col++) {
            WORD addr = (WORD)(tram_pos & (TRAM_MAX - 1));
            row_last_addr = addr;

            BYTE upt = updatetmp[addr];
            if (!(upt & UPDATE_VRAM)) {
                tram_pos++;
                continue;
            }
            updatetmp[addr] &= (BYTE)~UPDATE_VRAM;

            BYTE eff4 = (BYTE)(upt & 0x0F);
            WORD src_addr = addr;
            if (upt & 0x10) {
                src_addr = (WORD)((addr - 1) & (TRAM_MAX - 1));
            }

            BYTE src_attr = TXT_RAM[src_addr + TEXT_ATR];
            BYTE attr = TXT_RAM[addr + TEXT_ATR];
            if (attr & blinktest) {
                attr ^= X1ATR_REVERSE;
            }

            BYTE char_code = TXT_RAM[src_addr + TEXT_ANK];
            BYTE knj_code = TXT_RAM[src_addr + TEXT_KNJ];
            BYTE color_idx = (attr & X1ATR_REVERSE)
                           ? (BYTE)((attr & X1ATR_COLOR) + 8)
                           : (BYTE)(attr & X1ATR_COLOR);
            int sx = col * 8;

            if (g_cli_disable_text) {
                for (int y = 0; y < chr_h; y++) {
                    for (int ys = 0; ys < 4; ys++) {
                        int off = (sy + y * 4 + ys) * SCREEN_WIDTH + sx;
                        if (off + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                            *(DWORD*)&screenmap[off + 0] = 0;
                            *(DWORD*)&screenmap[off + 4] = 0;
                        }
                    }
                }
            } else if (src_attr & X1ATR_PCG) {
                BYTE color_bits = attr & X1ATR_COLOR;
                const bool pcg16 = (knj_code & 0x90) != 0;
                BYTE pcg_chr = pcg16 ? (BYTE)(char_code & 0xFE) : char_code;

                for (int y = 0; y < chr_h; y++) {
                    for (int ys = 0; ys < 4; ys++) {
                        int subline = (y * 4 + ys) / 2;  // TEXT_DOUBLERASTER equivalent
                        DWORD pl = 0, pr = 0;
                        if (color_bits & 1) {
                            BYTE b = pcg16 ? effect16_fetch_txt(&pcg.B[pcg_chr][0], eff4, row_fontycnt, subline)
                                           : effect8_fetch(pcg.B[pcg_chr], eff4, row_fontycnt, y);
                            if (attr & X1ATR_REVERSE) b ^= 0xFF;
                            pl |= bmp2byte_table[1][b * 2];
                            pr |= bmp2byte_table[1][b * 2 + 1];
                        }
                        if (color_bits & 2) {
                            BYTE r = pcg16 ? effect16_fetch_txt(&pcg.R[pcg_chr][0], eff4, row_fontycnt, subline)
                                           : effect8_fetch(pcg.R[pcg_chr], eff4, row_fontycnt, y);
                            if (attr & X1ATR_REVERSE) r ^= 0xFF;
                            pl |= bmp2byte_table[2][r * 2];
                            pr |= bmp2byte_table[2][r * 2 + 1];
                        }
                        if (color_bits & 4) {
                            BYTE g = pcg16 ? effect16_fetch_txt(&pcg.G[pcg_chr][0], eff4, row_fontycnt, subline)
                                           : effect8_fetch(pcg.G[pcg_chr], eff4, row_fontycnt, y);
                            if (attr & X1ATR_REVERSE) g ^= 0xFF;
                            pl |= bmp2byte_table[4][g * 2];
                            pr |= bmp2byte_table[4][g * 2 + 1];
                        }
                        pl &= 0x38383838u;
                        pr &= 0x38383838u;

                        int off = (sy + y * 4 + ys) * SCREEN_WIDTH + sx;
                        if (off + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                            *(DWORD*)&screenmap[off + 0] = pl;
                            *(DWORD*)&screenmap[off + 4] = pr;
                        }
                    }
                }
            } else {
                for (int y = 0; y < chr_h; y++) {
                    for (int ys = 0; ys < 4; ys++) {
                        BYTE pf = 0;
                        if (knj_code & 0x80) {
                            WORD jis_adr = ((WORD)knj_code << 8) | char_code;
                            BYTE* kfont = getfontjis(adr2jis_x1t(jis_adr));
                            if (knj_code & 0x40) {
                                kfont++;
                            }
                            if (fonttype & KNJ_24KHz) {
                                pf = effect16_fetch_knj(kfont, eff4, row_fontycnt, (y * 4 + ys) / 2);
                            } else {
                                pf = effect8_fetch_knj(kfont, eff4, row_fontycnt, y);
                            }
                        } else if (fonttype & ANK_24KHz) {
                            const BYTE* a16 = &KNJ_FNT[((WORD)char_code << 4)];
                            pf = effect16_fetch_txt(a16, eff4, row_fontycnt, (y * 4 + ys) / 2);
                        } else {
                            pf = effect8_fetch(ANK_FNT[char_code], eff4, row_fontycnt, y);
                        }

                        DWORD left4 = bmp2byte_table[color_idx][pf * 2] & 0x38383838u;
                        DWORD right4 = bmp2byte_table[color_idx][pf * 2 + 1] & 0x38383838u;
                        int off = (sy + y * 4 + ys) * SCREEN_WIDTH + sx;
                        if (off + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                            *(DWORD*)&screenmap[off + 0] = left4;
                            *(DWORD*)&screenmap[off + 4] = right4;
                        }
                    }
                }
            }

            if (!g_cli_disable_graph) {
                DWORD grp_idx = (DWORD)(addr) << 5;
                int vcnt = vramylpcnt ? (int)vramylpcnt : chr_h;
                for (int y = 0; y < vcnt; y++) {
                    BYTE b0l = GRP_RAM[GRAM_BANK0L + grp_idx + PLANE_B + y];
                    BYTE r0l = GRP_RAM[GRAM_BANK0L + grp_idx + PLANE_R + y];
                    BYTE g0l = GRP_RAM[GRAM_BANK0L + grp_idx + PLANE_G + y];
                    BYTE b1l = GRP_RAM[GRAM_BANK1L + grp_idx + PLANE_B + y];
                    BYTE r1l = GRP_RAM[GRAM_BANK1L + grp_idx + PLANE_R + y];
                    BYTE g1l = GRP_RAM[GRAM_BANK1L + grp_idx + PLANE_G + y];
                    BYTE b0h = GRP_RAM[GRAM_BANK0H + grp_idx + PLANE_B + y];
                    BYTE r0h = GRP_RAM[GRAM_BANK0H + grp_idx + PLANE_R + y];
                    BYTE g0h = GRP_RAM[GRAM_BANK0H + grp_idx + PLANE_G + y];
                    BYTE b1h = GRP_RAM[GRAM_BANK1H + grp_idx + PLANE_B + y];
                    BYTE r1h = GRP_RAM[GRAM_BANK1H + grp_idx + PLANE_R + y];
                    BYTE g1h = GRP_RAM[GRAM_BANK1H + grp_idx + PLANE_G + y];

                    DWORD gl0 = (bmp2byte_table[16][b0l * 2] | bmp2byte_table[17][r0l * 2] | bmp2byte_table[18][g0l * 2]) & 0x07070707u;
                    DWORD gr0 = (bmp2byte_table[16][b0l * 2 + 1] | bmp2byte_table[17][r0l * 2 + 1] | bmp2byte_table[18][g0l * 2 + 1]) & 0x07070707u;
                    DWORD gl1 = (bmp2byte_table[16][b1l * 2] | bmp2byte_table[17][r1l * 2] | bmp2byte_table[18][g1l * 2]) & 0x07070707u;
                    DWORD gr1 = (bmp2byte_table[16][b1l * 2 + 1] | bmp2byte_table[17][r1l * 2 + 1] | bmp2byte_table[18][g1l * 2 + 1]) & 0x07070707u;
                    DWORD gl2 = (bmp2byte_table[16][b0h * 2] | bmp2byte_table[17][r0h * 2] | bmp2byte_table[18][g0h * 2]) & 0x07070707u;
                    DWORD gr2 = (bmp2byte_table[16][b0h * 2 + 1] | bmp2byte_table[17][r0h * 2 + 1] | bmp2byte_table[18][g0h * 2 + 1]) & 0x07070707u;
                    DWORD gl3 = (bmp2byte_table[16][b1h * 2] | bmp2byte_table[17][r1h * 2] | bmp2byte_table[18][g1h * 2]) & 0x07070707u;
                    DWORD gr3 = (bmp2byte_table[16][b1h * 2 + 1] | bmp2byte_table[17][r1h * 2 + 1] | bmp2byte_table[18][g1h * 2 + 1]) & 0x07070707u;

                    int off0 = (sy + y * 4 + 0) * SCREEN_WIDTH + sx;
                    int off1 = off0 + SCREEN_WIDTH;
                    int off2 = off0 + SCREEN_WIDTH * 2;
                    int off3 = off0 + SCREEN_WIDTH * 3;
                    if (off0 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                        *(DWORD*)&screenmap[off0 + 0] |= gl0;
                        *(DWORD*)&screenmap[off0 + 4] |= gr0;
                    }
                    if (off1 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                        *(DWORD*)&screenmap[off1 + 0] |= gl1;
                        *(DWORD*)&screenmap[off1 + 4] |= gr1;
                    }
                    if (off2 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                        *(DWORD*)&screenmap[off2 + 0] |= gl2;
                        *(DWORD*)&screenmap[off2 + 4] |= gr2;
                    }
                    if (off3 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                        *(DWORD*)&screenmap[off3 + 0] |= gl3;
                        *(DWORD*)&screenmap[off3 + 4] |= gr3;
                    }
                }
            }

            tram_pos++;
        }

        if (updatetmp[row_last_addr & (TRAM_MAX - 1)] & 0x04) {
            fontycnt = (BYTE)((fontycnt + vramylpcnt) & 0x0F);
        } else {
            fontycnt = (BYTE)((vramylpcnt * 2) & 0x0F);
        }
    }
}

void width80x20_15khz(void) {
    fontycnt = 0;

    WORD tram_pos = crtc.TXT_TOP;
    const int cols = crtc.TXT_XL ? (int)crtc.TXT_XL : 80;
    if (cols <= 0) return;
    const int rows = (int)vramsize / cols;
    const int chr_h = fontlpcnt ? (int)fontlpcnt : 8;
    int yline = 0;

    for (int row = 0; row < rows; row++) {
        BYTE row_fontycnt = fontycnt;
        WORD row_last_addr = tram_pos;
        bool row_updated = false;
        int sy = row * (vramylpcnt ? (int)vramylpcnt : chr_h) * 2;

        for (int col = 0; col < cols; col++) {
            WORD addr = (WORD)(tram_pos & (TRAM_MAX - 1));
            row_last_addr = addr;

            BYTE upt = updatetmp[addr];
            if (!(upt & UPDATE_TRAM)) {
                tram_pos++;
                continue;
            }
            updatetmp[addr] &= (BYTE)~UPDATE_TRAM;
            row_updated = true;

            BYTE eff4 = (BYTE)(upt & 0x0F);
            WORD src_addr = addr;
            if (upt & 0x10) {
                src_addr = (WORD)((addr - 1) & (TRAM_MAX - 1));
            }

            BYTE src_attr = TXT_RAM[src_addr + TEXT_ATR];
            BYTE attr = TXT_RAM[addr + TEXT_ATR];
            if (attr & blinktest) {
                attr ^= X1ATR_REVERSE;
            }
            BYTE char_code = TXT_RAM[src_addr + TEXT_ANK];
            BYTE knj_code = TXT_RAM[src_addr + TEXT_KNJ];
            BYTE color_idx = (attr & X1ATR_REVERSE)
                           ? (BYTE)((attr & X1ATR_COLOR) + 8)
                           : (BYTE)(attr & X1ATR_COLOR);

            int sx = col * 8;
            BYTE* base = &screenmap[sy * SCREEN_WIDTH + sx];

            if (g_cli_disable_text) {
                for (int y = 0; y < chr_h * 2 + 4; y++) {
                    int off = sy * SCREEN_WIDTH + y * SCREEN_WIDTH + sx;
                    if (off + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                        *(DWORD*)&screenmap[off + 0] = 0;
                        *(DWORD*)&screenmap[off + 4] = 0;
                    }
                }
            } else if (src_attr & X1ATR_PCG) {
                BYTE color_bits = attr & X1ATR_COLOR;
                const bool pcg16 = (knj_code & 0x90) != 0;
                BYTE pcg_chr = pcg16 ? (BYTE)(char_code & 0xFE) : char_code;

                for (int y = 0; y < chr_h; y++) {
                    for (int ys = 0; ys < 2; ys++) {
                        int subline = y * 2 + ys;
                        DWORD pl = 0, pr = 0;
                        if (color_bits & 1) {
                            BYTE b = pcg16 ? effect16_fetch_txt(&pcg.B[pcg_chr][0], eff4, row_fontycnt, subline)
                                           : effect8_fetch(pcg.B[pcg_chr], eff4, row_fontycnt, y);
                            if (attr & X1ATR_REVERSE) b ^= 0xFF;
                            pl |= bmp2byte_table[1][b * 2];
                            pr |= bmp2byte_table[1][b * 2 + 1];
                        }
                        if (color_bits & 2) {
                            BYTE r = pcg16 ? effect16_fetch_txt(&pcg.R[pcg_chr][0], eff4, row_fontycnt, subline)
                                           : effect8_fetch(pcg.R[pcg_chr], eff4, row_fontycnt, y);
                            if (attr & X1ATR_REVERSE) r ^= 0xFF;
                            pl |= bmp2byte_table[2][r * 2];
                            pr |= bmp2byte_table[2][r * 2 + 1];
                        }
                        if (color_bits & 4) {
                            BYTE g = pcg16 ? effect16_fetch_txt(&pcg.G[pcg_chr][0], eff4, row_fontycnt, subline)
                                           : effect8_fetch(pcg.G[pcg_chr], eff4, row_fontycnt, y);
                            if (attr & X1ATR_REVERSE) g ^= 0xFF;
                            pl |= bmp2byte_table[4][g * 2];
                            pr |= bmp2byte_table[4][g * 2 + 1];
                        }
                        pl &= 0x38383838u;
                        pr &= 0x38383838u;
                        *(DWORD*)(base + (y * 2 + ys) * SCREEN_WIDTH + 0) = pl;
                        *(DWORD*)(base + (y * 2 + ys) * SCREEN_WIDTH + 4) = pr;
                    }
                }
            } else {
                for (int y = 0; y < chr_h; y++) {
                    BYTE pf = 0;
                    if (knj_code & 0x80) {
                        WORD jis_adr = ((WORD)knj_code << 8) | char_code;
                        BYTE* kfont = getfontjis(adr2jis_x1t(jis_adr));
                        if (knj_code & 0x40) {
                            kfont++;
                        }
                        if (fonttype & KNJ_24KHz) {
                            pf = effect16_fetch_knj(kfont, eff4, row_fontycnt, y * 2);
                        } else {
                            pf = effect8_fetch_knj(kfont, eff4, row_fontycnt, y);
                        }
                    } else if (fonttype & ANK_24KHz) {
                        const BYTE* a16 = &KNJ_FNT[((WORD)char_code << 4)];
                        pf = effect16_fetch_txt(a16, eff4, row_fontycnt, y * 2);
                    } else {
                        pf = effect8_fetch(ANK_FNT[char_code], eff4, row_fontycnt, y);
                    }

                    DWORD left4 = bmp2byte_table[color_idx][pf * 2] & 0x38383838u;
                    DWORD right4 = bmp2byte_table[color_idx][pf * 2 + 1] & 0x38383838u;
                    *(DWORD*)(base + (y * 2 + 0) * SCREEN_WIDTH + 0) = left4;
                    *(DWORD*)(base + (y * 2 + 0) * SCREEN_WIDTH + 4) = right4;
                    *(DWORD*)(base + (y * 2 + 1) * SCREEN_WIDTH + 0) = left4;
                    *(DWORD*)(base + (y * 2 + 1) * SCREEN_WIDTH + 4) = right4;
                }
            }

            // DRAW8.CPP add_skiplinelp + putunderline 相当
            DWORD addv = 0x40404040u;
            for (int i = 0; i < (int)fontlpcnt; i++) {
                DWORD* p0 = (DWORD*)(base + (i * 2 + 1) * SCREEN_WIDTH + 0);
                DWORD* p1 = (DWORD*)(base + (i * 2 + 1) * SCREEN_WIDTH + 4);
                *p0 += addv;
                *p1 += addv;
            }
            BYTE ul = (TXT_RAM[addr + TEXT_KNJ] & X1KNJ_ULINE) ? 0x01 : 0x00;
            DWORD ulv = (DWORD)ul * 0x01010101u;
            int tail = (int)fontlpcnt * 2;
            *(DWORD*)(base + (tail + 0) * SCREEN_WIDTH + 0) = ulv;
            *(DWORD*)(base + (tail + 0) * SCREEN_WIDTH + 4) = ulv;
            *(DWORD*)(base + (tail + 1) * SCREEN_WIDTH + 0) = addv + ulv;
            *(DWORD*)(base + (tail + 1) * SCREEN_WIDTH + 4) = addv + ulv;
            *(DWORD*)(base + (tail + 2) * SCREEN_WIDTH + 0) = 0;
            *(DWORD*)(base + (tail + 2) * SCREEN_WIDTH + 4) = 0;
            *(DWORD*)(base + (tail + 3) * SCREEN_WIDTH + 0) = addv;
            *(DWORD*)(base + (tail + 3) * SCREEN_WIDTH + 4) = addv;

            tram_pos++;
        }

        if (updatetmp[row_last_addr & (TRAM_MAX - 1)] & 0x04) {
            fontycnt = (BYTE)((fontycnt + vramylpcnt) & 0x0F);
        } else {
            fontycnt = (BYTE)((vramylpcnt * 2) & 0x0F);
        }

        if (row_updated) {
            for (int i = 0; i < vramylpcnt * 2; i++) {
                renewalline[yline + i] |= 3;
            }
        }
        yline += vramylpcnt * 2;
    }
}

void width80x10_15khz(void) {
    fontycnt = 0;

    WORD tram_pos = crtc.TXT_TOP;
    const int cols = crtc.TXT_XL ? (int)crtc.TXT_XL : 80;
    if (cols <= 0) return;
    const int rows = (int)vramsize / cols;
    const int chr_h = fontlpcnt ? (int)fontlpcnt : 8;
    int yline = 0;

    for (int row = 0; row < rows; row++) {
        BYTE row_fontycnt = fontycnt;
        WORD row_last_addr = tram_pos;
        bool row_updated = false;
        int sy = row * (vramylpcnt ? (int)vramylpcnt : chr_h) * 4;

        for (int col = 0; col < cols; col++) {
            WORD addr = (WORD)(tram_pos & (TRAM_MAX - 1));
            row_last_addr = addr;
            if (addr >= (TRAM_MAX / 2)) {
                tram_pos++;
                continue;
            }

            BYTE upt = updatetmp[addr];
            if (!(upt & dispflg)) {
                tram_pos++;
                continue;
            }
            updatetmp[addr] ^= dispflg; // DRAW8.CPP 準拠
            row_updated = true;

            BYTE eff4 = (BYTE)(upt & 0x0F);
            WORD src_addr = addr;
            if (upt & 0x10) {
                src_addr = (WORD)((addr - 1) & (TRAM_MAX - 1));
            }

            BYTE src_attr = TXT_RAM[src_addr + TEXT_ATR];
            BYTE attr = TXT_RAM[addr + TEXT_ATR];
            if (attr & blinktest) {
                attr ^= X1ATR_REVERSE;
            }
            BYTE char_code = TXT_RAM[src_addr + TEXT_ANK];
            BYTE knj_code = TXT_RAM[src_addr + TEXT_KNJ];
            BYTE color_idx = (attr & X1ATR_REVERSE)
                           ? (BYTE)((attr & X1ATR_COLOR) + 8)
                           : (BYTE)(attr & X1ATR_COLOR);

            int sx = col * 8;
            BYTE* base = &screenmap[sy * SCREEN_WIDTH + sx];

            if (g_cli_disable_text) {
                for (int y = 0; y < chr_h * 4 + 8; y++) {
                    int off = sy * SCREEN_WIDTH + y * SCREEN_WIDTH + sx;
                    if (off + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                        *(DWORD*)&screenmap[off + 0] = 0;
                        *(DWORD*)&screenmap[off + 4] = 0;
                    }
                }
            } else if (src_attr & X1ATR_PCG) {
                BYTE color_bits = attr & X1ATR_COLOR;
                const bool pcg16 = (knj_code & 0x90) != 0;
                BYTE pcg_chr = pcg16 ? (BYTE)(char_code & 0xFE) : char_code;

                for (int y = 0; y < chr_h; y++) {
                    for (int ys = 0; ys < 4; ys++) {
                        int subline = (y * 4 + ys) / 2;  // TEXT_DOUBLERASTER equivalent
                        DWORD pl = 0, pr = 0;
                        if (color_bits & 1) {
                            BYTE b = pcg16 ? effect16_fetch_txt(&pcg.B[pcg_chr][0], eff4, row_fontycnt, subline)
                                           : effect8_fetch(pcg.B[pcg_chr], eff4, row_fontycnt, y);
                            if (attr & X1ATR_REVERSE) b ^= 0xFF;
                            pl |= bmp2byte_table[1][b * 2];
                            pr |= bmp2byte_table[1][b * 2 + 1];
                        }
                        if (color_bits & 2) {
                            BYTE r = pcg16 ? effect16_fetch_txt(&pcg.R[pcg_chr][0], eff4, row_fontycnt, subline)
                                           : effect8_fetch(pcg.R[pcg_chr], eff4, row_fontycnt, y);
                            if (attr & X1ATR_REVERSE) r ^= 0xFF;
                            pl |= bmp2byte_table[2][r * 2];
                            pr |= bmp2byte_table[2][r * 2 + 1];
                        }
                        if (color_bits & 4) {
                            BYTE g = pcg16 ? effect16_fetch_txt(&pcg.G[pcg_chr][0], eff4, row_fontycnt, subline)
                                           : effect8_fetch(pcg.G[pcg_chr], eff4, row_fontycnt, y);
                            if (attr & X1ATR_REVERSE) g ^= 0xFF;
                            pl |= bmp2byte_table[4][g * 2];
                            pr |= bmp2byte_table[4][g * 2 + 1];
                        }
                        pl &= 0x38383838u;
                        pr &= 0x38383838u;
                        *(DWORD*)(base + (y * 4 + ys) * SCREEN_WIDTH + 0) = pl;
                        *(DWORD*)(base + (y * 4 + ys) * SCREEN_WIDTH + 4) = pr;
                    }
                }
            } else {
                // TEXT_DOUBLERASTER: pf を ys 毎に計算 (subline/2 で2行ずつ同一)
                BYTE* kfont = nullptr;
                if (knj_code & 0x80) {
                    WORD jis_adr = ((WORD)knj_code << 8) | char_code;
                    kfont = getfontjis(adr2jis_x1t(jis_adr));
                    if (knj_code & 0x40) kfont++;
                }
                for (int y = 0; y < chr_h; y++) {
                    for (int ys = 0; ys < 4; ys++) {
                        BYTE pf = 0;
                        int subline = (y * 4 + ys) / 2;
                        if (knj_code & 0x80) {
                            if (fonttype & KNJ_24KHz) {
                                pf = effect16_fetch_knj(kfont, eff4, row_fontycnt, subline);
                            } else {
                                pf = effect8_fetch_knj(kfont, eff4, row_fontycnt, y);
                            }
                        } else if (fonttype & ANK_24KHz) {
                            const BYTE* a16 = &KNJ_FNT[((WORD)char_code << 4)];
                            pf = effect16_fetch_txt(a16, eff4, row_fontycnt, subline);
                        } else {
                            pf = effect8_fetch(ANK_FNT[char_code], eff4, row_fontycnt, y);
                        }

                        DWORD left4 = bmp2byte_table[color_idx][pf * 2] & 0x38383838u;
                        DWORD right4 = bmp2byte_table[color_idx][pf * 2 + 1] & 0x38383838u;
                        *(DWORD*)(base + (y * 4 + ys) * SCREEN_WIDTH + 0) = left4;
                        *(DWORD*)(base + (y * 4 + ys) * SCREEN_WIDTH + 4) = right4;
                    }
                }
            }

            // DRAW8.CPP add_skiplinelp + putunderline 相当
            DWORD addv = 0x40404040u;
            for (int i = 0; i < (int)fontlpcnt * 2; i++) {
                DWORD* p0 = (DWORD*)(base + (i * 2 + 1) * SCREEN_WIDTH + 0);
                DWORD* p1 = (DWORD*)(base + (i * 2 + 1) * SCREEN_WIDTH + 4);
                *p0 += addv;
                *p1 += addv;
            }
            BYTE ul = (TXT_RAM[addr + TEXT_KNJ] & X1KNJ_ULINE) ? 0x01 : 0x00;
            DWORD ulv = (DWORD)ul * 0x01010101u;
            int tail = (int)fontlpcnt * 4;
            *(DWORD*)(base + (tail + 0) * SCREEN_WIDTH + 0) = ulv;
            *(DWORD*)(base + (tail + 0) * SCREEN_WIDTH + 4) = ulv;
            *(DWORD*)(base + (tail + 1) * SCREEN_WIDTH + 0) = addv + ulv;
            *(DWORD*)(base + (tail + 1) * SCREEN_WIDTH + 4) = addv + ulv;
            *(DWORD*)(base + (tail + 2) * SCREEN_WIDTH + 0) = ulv;
            *(DWORD*)(base + (tail + 2) * SCREEN_WIDTH + 4) = ulv;
            *(DWORD*)(base + (tail + 3) * SCREEN_WIDTH + 0) = addv + ulv;
            *(DWORD*)(base + (tail + 3) * SCREEN_WIDTH + 4) = addv + ulv;
            *(DWORD*)(base + (tail + 4) * SCREEN_WIDTH + 0) = 0;
            *(DWORD*)(base + (tail + 4) * SCREEN_WIDTH + 4) = 0;
            *(DWORD*)(base + (tail + 5) * SCREEN_WIDTH + 0) = addv;
            *(DWORD*)(base + (tail + 5) * SCREEN_WIDTH + 4) = addv;
            *(DWORD*)(base + (tail + 6) * SCREEN_WIDTH + 0) = 0;
            *(DWORD*)(base + (tail + 6) * SCREEN_WIDTH + 4) = 0;
            *(DWORD*)(base + (tail + 7) * SCREEN_WIDTH + 0) = addv;
            *(DWORD*)(base + (tail + 7) * SCREEN_WIDTH + 4) = addv;

            tram_pos++;
        }

        if (updatetmp[row_last_addr & (TRAM_MAX - 1)] & 0x04) {
            fontycnt = (BYTE)((fontycnt + vramylpcnt) & 0x0F);
        } else {
            fontycnt = (BYTE)((vramylpcnt * 2) & 0x0F);
        }

        if (row_updated) {
            for (int i = 0; i < vramylpcnt * 4; i++) {
                renewalline[yline + i] |= 3;
            }
        }
        yline += vramylpcnt * 4;
    }
}

void width80x20_24khz(void) {
    fontycnt = 0;

    WORD tram_pos = crtc.TXT_TOP;
    const int cols = crtc.TXT_XL ? (int)crtc.TXT_XL : 80;
    if (cols <= 0) return;
    const int rows = (int)vramsize / cols;
    const int chr_h = fontlpcnt ? (int)fontlpcnt : 8;
    int yline = 0;

    for (int row = 0; row < rows; row++) {
        BYTE row_fontycnt = fontycnt;
        WORD row_last_addr = tram_pos;
        bool row_updated = false;
        int sy = row * (vramylpcnt ? (int)vramylpcnt : chr_h) * 2;

        for (int col = 0; col < cols; col++) {
            WORD addr = (WORD)(tram_pos & (TRAM_MAX - 1));
            row_last_addr = addr;

            BYTE upt = updatetmp[addr];
            if (!(upt & UPDATE_TRAM)) {
                tram_pos++;
                continue;
            }
            updatetmp[addr] &= (BYTE)~UPDATE_TRAM;
            row_updated = true;

            BYTE eff4 = (BYTE)(upt & 0x0F);
            WORD src_addr = addr;
            if (upt & 0x10) {
                src_addr = (WORD)((addr - 1) & (TRAM_MAX - 1));
            }

            BYTE src_attr = TXT_RAM[src_addr + TEXT_ATR];
            BYTE attr = TXT_RAM[addr + TEXT_ATR];
            if (attr & blinktest) {
                attr ^= X1ATR_REVERSE;
            }
            BYTE char_code = TXT_RAM[src_addr + TEXT_ANK];
            BYTE knj_code = TXT_RAM[src_addr + TEXT_KNJ];
            BYTE color_idx = (attr & X1ATR_REVERSE)
                           ? (BYTE)((attr & X1ATR_COLOR) + 8)
                           : (BYTE)(attr & X1ATR_COLOR);
            int sx = col * 8;
            BYTE* base = &screenmap[sy * SCREEN_WIDTH + sx];

            if (g_cli_disable_text) {
                for (int y = 0; y < chr_h * 2 + 4; y++) {
                    int off = sy * SCREEN_WIDTH + y * SCREEN_WIDTH + sx;
                    if (off + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                        *(DWORD*)&screenmap[off + 0] = 0;
                        *(DWORD*)&screenmap[off + 4] = 0;
                    }
                }
            } else if (src_attr & X1ATR_PCG) {
                BYTE color_bits = attr & X1ATR_COLOR;
                const bool pcg16 = (knj_code & 0x90) != 0;
                BYTE pcg_chr = pcg16 ? (BYTE)(char_code & 0xFE) : char_code;

                for (int y = 0; y < chr_h; y++) {
                    for (int ys = 0; ys < 2; ys++) {
                        int subline = y * 2 + ys;
                        DWORD pl = 0, pr = 0;
                        if (color_bits & 1) {
                            BYTE b = pcg16 ? effect16_fetch_txt(&pcg.B[pcg_chr][0], eff4, row_fontycnt, subline)
                                           : effect8_fetch(pcg.B[pcg_chr], eff4, row_fontycnt, y);
                            if (attr & X1ATR_REVERSE) b ^= 0xFF;
                            pl |= bmp2byte_table[1][b * 2];
                            pr |= bmp2byte_table[1][b * 2 + 1];
                        }
                        if (color_bits & 2) {
                            BYTE r = pcg16 ? effect16_fetch_txt(&pcg.R[pcg_chr][0], eff4, row_fontycnt, subline)
                                           : effect8_fetch(pcg.R[pcg_chr], eff4, row_fontycnt, y);
                            if (attr & X1ATR_REVERSE) r ^= 0xFF;
                            pl |= bmp2byte_table[2][r * 2];
                            pr |= bmp2byte_table[2][r * 2 + 1];
                        }
                        if (color_bits & 4) {
                            BYTE g = pcg16 ? effect16_fetch_txt(&pcg.G[pcg_chr][0], eff4, row_fontycnt, subline)
                                           : effect8_fetch(pcg.G[pcg_chr], eff4, row_fontycnt, y);
                            if (attr & X1ATR_REVERSE) g ^= 0xFF;
                            pl |= bmp2byte_table[4][g * 2];
                            pr |= bmp2byte_table[4][g * 2 + 1];
                        }
                        pl &= 0x38383838u;
                        pr &= 0x38383838u;
                        *(DWORD*)(base + (y * 2 + ys) * SCREEN_WIDTH + 0) = pl;
                        *(DWORD*)(base + (y * 2 + ys) * SCREEN_WIDTH + 4) = pr;
                    }
                }
            } else {
                for (int y = 0; y < chr_h; y++) {
                    for (int ys = 0; ys < 2; ys++) {
                        BYTE pf = 0;
                        if (knj_code & 0x80) {
                            WORD jis_adr = ((WORD)knj_code << 8) | char_code;
                            BYTE* kfont = getfontjis(adr2jis_x1t(jis_adr));
                            if (knj_code & 0x40) {
                                kfont++;
                            }
                            if (fonttype & KNJ_24KHz) {
                                pf = effect16_fetch_knj(kfont, eff4, row_fontycnt, y * 2 + ys);
                            } else {
                                pf = effect8_fetch_knj(kfont, eff4, row_fontycnt, y);
                            }
                        } else if (fonttype & ANK_24KHz) {
                            const BYTE* a16 = &KNJ_FNT[((WORD)char_code << 4)];
                            pf = effect16_fetch_txt(a16, eff4, row_fontycnt, y * 2 + ys);
                        } else {
                            pf = effect8_fetch(ANK_FNT[char_code], eff4, row_fontycnt, y);
                        }

                        DWORD left4 = bmp2byte_table[color_idx][pf * 2] & 0x38383838u;
                        DWORD right4 = bmp2byte_table[color_idx][pf * 2 + 1] & 0x38383838u;
                        *(DWORD*)(base + (y * 2 + ys) * SCREEN_WIDTH + 0) = left4;
                        *(DWORD*)(base + (y * 2 + ys) * SCREEN_WIDTH + 4) = right4;
                    }
                }
            }

            BYTE ul = (TXT_RAM[addr + TEXT_KNJ] & X1KNJ_ULINE) ? 0x01 : 0x00;
            DWORD ulv = (DWORD)ul * 0x01010101u;
            int tail = (int)fontlpcnt * 2;
            *(DWORD*)(base + (tail + 0) * SCREEN_WIDTH + 0) = 0;
            *(DWORD*)(base + (tail + 0) * SCREEN_WIDTH + 4) = 0;
            *(DWORD*)(base + (tail + 1) * SCREEN_WIDTH + 0) = ulv;
            *(DWORD*)(base + (tail + 1) * SCREEN_WIDTH + 4) = ulv;
            *(DWORD*)(base + (tail + 2) * SCREEN_WIDTH + 0) = 0;
            *(DWORD*)(base + (tail + 2) * SCREEN_WIDTH + 4) = 0;
            *(DWORD*)(base + (tail + 3) * SCREEN_WIDTH + 0) = 0;
            *(DWORD*)(base + (tail + 3) * SCREEN_WIDTH + 4) = 0;

            tram_pos++;
        }

        if (updatetmp[row_last_addr & (TRAM_MAX - 1)] & 0x04) {
            fontycnt = (BYTE)((fontycnt + vramylpcnt) & 0x0F);
        } else {
            fontycnt = (BYTE)((vramylpcnt * 2) & 0x0F);
        }

        if (row_updated) {
            for (int i = 0; i < vramylpcnt * 2; i++) {
                renewalline[yline + i] |= 3;
            }
        }
        yline += vramylpcnt * 2;
    }
}

void width80x10_24khz(void) {
    fontycnt = 0;

    WORD tram_pos = crtc.TXT_TOP;
    const int cols = crtc.TXT_XL ? (int)crtc.TXT_XL : 80;
    if (cols <= 0) return;
    const int rows = (int)vramsize / cols;
    const int chr_h = fontlpcnt ? (int)fontlpcnt : 8;
    int yline = 0;

    for (int row = 0; row < rows; row++) {
        BYTE row_fontycnt = fontycnt;
        WORD row_last_addr = tram_pos;
        bool row_updated = false;
        int sy = row * (vramylpcnt ? (int)vramylpcnt : chr_h) * 4;

        for (int col = 0; col < cols; col++) {
            WORD addr = (WORD)(tram_pos & (TRAM_MAX - 1));
            row_last_addr = addr;
            if (addr >= (TRAM_MAX / 2)) {
                tram_pos++;
                continue;
            }

            BYTE upt = updatetmp[addr];
            if (!(upt & UPDATE_TRAM)) {
                tram_pos++;
                continue;
            }
            updatetmp[addr] &= (BYTE)~UPDATE_TRAM;
            row_updated = true;

            BYTE eff4 = (BYTE)(upt & 0x0F);
            WORD src_addr = addr;
            if (upt & 0x10) {
                src_addr = (WORD)((addr - 1) & (TRAM_MAX - 1));
            }

            BYTE src_attr = TXT_RAM[src_addr + TEXT_ATR];
            BYTE attr = TXT_RAM[addr + TEXT_ATR];
            if (attr & blinktest) {
                attr ^= X1ATR_REVERSE;
            }
            BYTE char_code = TXT_RAM[src_addr + TEXT_ANK];
            BYTE knj_code = TXT_RAM[src_addr + TEXT_KNJ];
            BYTE color_idx = (attr & X1ATR_REVERSE)
                           ? (BYTE)((attr & X1ATR_COLOR) + 8)
                           : (BYTE)(attr & X1ATR_COLOR);
            int sx = col * 8;
            BYTE* base = &screenmap[sy * SCREEN_WIDTH + sx];

            if (g_cli_disable_text) {
                for (int y = 0; y < chr_h * 4 + 8; y++) {
                    int off = sy * SCREEN_WIDTH + y * SCREEN_WIDTH + sx;
                    if (off + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
                        *(DWORD*)&screenmap[off + 0] = 0;
                        *(DWORD*)&screenmap[off + 4] = 0;
                    }
                }
            } else if (src_attr & X1ATR_PCG) {
                BYTE color_bits = attr & X1ATR_COLOR;
                const bool pcg16 = (knj_code & 0x90) != 0;
                BYTE pcg_chr = pcg16 ? (BYTE)(char_code & 0xFE) : char_code;

                for (int y = 0; y < chr_h; y++) {
                    for (int ys = 0; ys < 4; ys++) {
                        int subline = (y * 4 + ys) / 2;  // TEXT_DOUBLERASTER equivalent
                        DWORD pl = 0, pr = 0;
                        if (color_bits & 1) {
                            BYTE b = pcg16 ? effect16_fetch_txt(&pcg.B[pcg_chr][0], eff4, row_fontycnt, subline)
                                           : effect8_fetch(pcg.B[pcg_chr], eff4, row_fontycnt, y);
                            if (attr & X1ATR_REVERSE) b ^= 0xFF;
                            pl |= bmp2byte_table[1][b * 2];
                            pr |= bmp2byte_table[1][b * 2 + 1];
                        }
                        if (color_bits & 2) {
                            BYTE r = pcg16 ? effect16_fetch_txt(&pcg.R[pcg_chr][0], eff4, row_fontycnt, subline)
                                           : effect8_fetch(pcg.R[pcg_chr], eff4, row_fontycnt, y);
                            if (attr & X1ATR_REVERSE) r ^= 0xFF;
                            pl |= bmp2byte_table[2][r * 2];
                            pr |= bmp2byte_table[2][r * 2 + 1];
                        }
                        if (color_bits & 4) {
                            BYTE g = pcg16 ? effect16_fetch_txt(&pcg.G[pcg_chr][0], eff4, row_fontycnt, subline)
                                           : effect8_fetch(pcg.G[pcg_chr], eff4, row_fontycnt, y);
                            if (attr & X1ATR_REVERSE) g ^= 0xFF;
                            pl |= bmp2byte_table[4][g * 2];
                            pr |= bmp2byte_table[4][g * 2 + 1];
                        }
                        pl &= 0x38383838u;
                        pr &= 0x38383838u;
                        *(DWORD*)(base + (y * 4 + ys) * SCREEN_WIDTH + 0) = pl;
                        *(DWORD*)(base + (y * 4 + ys) * SCREEN_WIDTH + 4) = pr;
                    }
                }
            } else {
                for (int y = 0; y < chr_h; y++) {
                    for (int ys = 0; ys < 4; ys++) {
                        BYTE pf = 0;
                        if (knj_code & 0x80) {
                            WORD jis_adr = ((WORD)knj_code << 8) | char_code;
                            BYTE* kfont = getfontjis(adr2jis_x1t(jis_adr));
                            if (knj_code & 0x40) {
                                kfont++;
                            }
                            if (fonttype & KNJ_24KHz) {
                                pf = effect16_fetch_knj(kfont, eff4, row_fontycnt, (y * 4 + ys) / 2);
                            } else {
                                pf = effect8_fetch_knj(kfont, eff4, row_fontycnt, y);
                            }
                        } else if (fonttype & ANK_24KHz) {
                            const BYTE* a16 = &KNJ_FNT[((WORD)char_code << 4)];
                            pf = effect16_fetch_txt(a16, eff4, row_fontycnt, (y * 4 + ys) / 2);
                        } else {
                            pf = effect8_fetch(ANK_FNT[char_code], eff4, row_fontycnt, y);
                        }

                        DWORD left4 = bmp2byte_table[color_idx][pf * 2] & 0x38383838u;
                        DWORD right4 = bmp2byte_table[color_idx][pf * 2 + 1] & 0x38383838u;
                        *(DWORD*)(base + (y * 4 + ys) * SCREEN_WIDTH + 0) = left4;
                        *(DWORD*)(base + (y * 4 + ys) * SCREEN_WIDTH + 4) = right4;
                    }
                }
            }

            BYTE ul = (TXT_RAM[addr + TEXT_KNJ] & X1KNJ_ULINE) ? 0x01 : 0x00;
            DWORD ulv = (DWORD)ul * 0x01010101u;
            int tail = (int)fontlpcnt * 4;
            *(DWORD*)(base + (tail + 0) * SCREEN_WIDTH + 0) = 0;
            *(DWORD*)(base + (tail + 0) * SCREEN_WIDTH + 4) = 0;
            *(DWORD*)(base + (tail + 1) * SCREEN_WIDTH + 0) = 0;
            *(DWORD*)(base + (tail + 1) * SCREEN_WIDTH + 4) = 0;
            *(DWORD*)(base + (tail + 2) * SCREEN_WIDTH + 0) = ulv;
            *(DWORD*)(base + (tail + 2) * SCREEN_WIDTH + 4) = ulv;
            *(DWORD*)(base + (tail + 3) * SCREEN_WIDTH + 0) = ulv;
            *(DWORD*)(base + (tail + 3) * SCREEN_WIDTH + 4) = ulv;
            *(DWORD*)(base + (tail + 4) * SCREEN_WIDTH + 0) = 0;
            *(DWORD*)(base + (tail + 4) * SCREEN_WIDTH + 4) = 0;
            *(DWORD*)(base + (tail + 5) * SCREEN_WIDTH + 0) = 0;
            *(DWORD*)(base + (tail + 5) * SCREEN_WIDTH + 4) = 0;
            *(DWORD*)(base + (tail + 6) * SCREEN_WIDTH + 0) = 0;
            *(DWORD*)(base + (tail + 6) * SCREEN_WIDTH + 4) = 0;
            *(DWORD*)(base + (tail + 7) * SCREEN_WIDTH + 0) = 0;
            *(DWORD*)(base + (tail + 7) * SCREEN_WIDTH + 4) = 0;

            tram_pos++;
        }

        if (updatetmp[row_last_addr & (TRAM_MAX - 1)] & 0x04) {
            fontycnt = (BYTE)((fontycnt + vramylpcnt) & 0x0F);
        } else {
            fontycnt = (BYTE)((vramylpcnt * 2) & 0x0F);
        }

        if (row_updated) {
            for (int i = 0; i < vramylpcnt * 4; i++) {
                renewalline[yline + i] |= 3;
            }
        }
        yline += vramylpcnt * 4;
    }
}

// ============================================================================
// 64色/4096色描画モード共通ヘルパー
// origsrc DRAW64.CPP / DRAW64H.CPP / DRAW64L.CPP / DRAW4096.CPP の
// x86インラインアセンブリを C++ で再実装
// ============================================================================

// grphtxtout_64: cwork[56] → screenmap[] の 64色変換 (7プレーン OR合成)
// origsrc DRAW64.CPP:328-360 の grphcpy64_lp ループ相当
// cwork レイアウト (各8バイト):
//   [0..7]:   BIT6 (テキスト優先マスク)
//   [8..15]:  BLUE  (BANK0L PLANE_B)
//   [16..23]: RED   (BANK0L PLANE_R)
//   [24..31]: GREEN (BANK0L PLANE_G)
//   [32..39]: BLUE2 (BANK0H PLANE_B)
//   [40..47]: RED2  (BANK0H PLANE_R)
//   [48..55]: GREEN2(BANK0H PLANE_G)
static void grphtxtout_64(int scr_off, int vyl) {
    // bmp2byte_table[idx][pat*2] / [pat*2+1] で pat→4ピクセルDWORD変換
    // BMP2B_* / 0x800 = テーブル行インデックス
    for (int y = 0; y < vyl; y++) {
        BYTE c0 = cwork[y + 0];   // BIT6
        BYTE c1 = cwork[y + 8];   // BLUE
        BYTE c2 = cwork[y + 16];  // RED
        BYTE c3 = cwork[y + 24];  // GREEN
        BYTE c4 = cwork[y + 32];  // BLUE2
        BYTE c5 = cwork[y + 40];  // RED2
        BYTE c6 = cwork[y + 48];  // GREEN2

        DWORD left = bmp2byte_table[19][c0 * 2];       // BMP2B_BIT6/0x800=19
        DWORD right = bmp2byte_table[19][c0 * 2 + 1];
        left  |= bmp2byte_table[16][c1 * 2];            // BLUE
        right |= bmp2byte_table[16][c1 * 2 + 1];
        left  |= bmp2byte_table[17][c2 * 2];            // RED
        right |= bmp2byte_table[17][c2 * 2 + 1];
        left  |= bmp2byte_table[18][c3 * 2];            // GREEN
        right |= bmp2byte_table[18][c3 * 2 + 1];
        left  |= bmp2byte_table[1][c4 * 2];             // BLUE2
        right |= bmp2byte_table[1][c4 * 2 + 1];
        left  |= bmp2byte_table[2][c5 * 2];             // RED2
        right |= bmp2byte_table[2][c5 * 2 + 1];
        left  |= bmp2byte_table[4][c6 * 2];             // GREEN2
        right |= bmp2byte_table[4][c6 * 2 + 1];

        // 200→400: 各ラインを2スキャンラインに書き込む
        int off0 = scr_off + y * 2 * SCREEN_WIDTH;
        int off1 = off0 + SCREEN_WIDTH;
        if (off0 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
            *(DWORD*)&screenmap[off0 + 0] = left;
            *(DWORD*)&screenmap[off0 + 4] = right;
        }
        if (off1 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
            *(DWORD*)&screenmap[off1 + 0] = left;
            *(DWORD*)&screenmap[off1 + 4] = right;
        }
    }
}

// getgrphmaskpat_64: 6プレーン(BANK0L+BANK0H)のOR→マスク生成
// origsrc DRAW64.CPP:27-58 の getgrphmaskpat() 相当
// grp = &dispp[addr * 32 + PLANE_B]
// mask_lo[0..3], mask_hi[4..7] にマスクを返す
static void getgrphmaskpat_64(BYTE* grp, DWORD& mask_lo, DWORD& mask_hi) {
    // BANK0L: PLANE_B, PLANE_R, PLANE_G (各8バイト、+8オフセット刻み)
    DWORD* p = (DWORD*)grp;
    mask_lo  = p[0];                          // PLANE_B[0..3]
    mask_hi  = p[1];                          // PLANE_B[4..7]
    mask_lo |= p[2];                          // PLANE_R[0..3]
    mask_hi |= p[3];                          // PLANE_R[4..7]
    mask_lo |= p[4];                          // PLANE_G[0..3]
    mask_hi |= p[5];                          // PLANE_G[4..7]
    // BANK0H: +GRAM_HALFSTEP
    DWORD* ph = (DWORD*)(grp + GRAM_HALFSTEP);
    mask_lo |= ph[0];
    mask_hi |= ph[1];
    mask_lo |= ph[2];
    mask_hi |= ph[3];
    mask_lo |= ph[4];
    mask_hi |= ph[5];
}

// fill_cwork_grphonly_64: グラフィックスのみ(テキスト色=0)のcwork生成
// origsrc DRAW64.CPP:315-327 の grphonly 相当
static void fill_cwork_grphonly_64(WORD addr) {
    BYTE* grp = dispp + ((DWORD)addr << 5) + PLANE_B;
    // cwork[0..7] = 0 (テキストマスクなし)
    *(DWORD*)&cwork[0] = 0;
    *(DWORD*)&cwork[4] = 0;
    // cwork[8..31] = BANK0L の PLANE_B,R,G (24バイト = 6 DWORD)
    memcpy(&cwork[8], grp, 24);
    // cwork[32..55] = BANK0H の PLANE_B,R,G
    memcpy(&cwork[32], grp + GRAM_HALFSTEP, 24);
}

// fill_cwork_text_64: テキスト→cwork[0..7]マスク + cwork[8..31]色プレーン
// planeeffects[] が nullptr のため直接実装
// color: テキスト色(0-7), reverse: REVERSE属性
static void fill_cwork_text_planes_64(BYTE color, bool reverse) {
    // cwork[0..7] にはフォントデータが既に格納済み
    // REVERSE時: フォントデータを反転
    if (reverse) {
        for (int i = 0; i < 8; i++) cwork[i] ^= 0xFF;
    }
    // テキスト色に基づいてカラープレーンを生成
    // B,R,G の各プレーンに、色ビットが立っていればフォントデータをコピー
    // REVERSE時: 色ビットが立っていないプレーンは0xFF（全ビットON）にする
    //   → 背景色が色7（TEXTPAL[7]）、文字色が complement(color) = 7 XOR color になる
    //   origsrc planex* assembly の動作と bmp2byte_table[i+8] の XOR 0x38 に対応
    BYTE unused_fill = reverse ? 0xFF : 0;
    for (int i = 0; i < 8; i++) {
        cwork[8  + i] = (color & 1) ? cwork[i] : unused_fill;  // BLUE
        cwork[16 + i] = (color & 2) ? cwork[i] : unused_fill;  // RED
        cwork[24 + i] = (color & 4) ? cwork[i] : unused_fill;  // GREEN
        cwork[32 + i] = 0;  // BLUE2 (テキストは上位プレーン不使用)
        cwork[40 + i] = 0;  // RED2
        cwork[48 + i] = 0;  // GREEN2
    }
}

// merge_graph_txtup_64: テキスト上・グラフィックス下 (ZPRY bit0=0)
// origsrc DRAW64.CPP:269-296 の screen1txtupt/screen1txtup 相当
// テキストマスク(cwork[0..7])の反転部分にのみグラフィックスを合成
static void merge_graph_txtup_64(WORD addr) {
    DWORD mask_lo = *(DWORD*)&cwork[0];
    DWORD mask_hi = *(DWORD*)&cwork[4];
    DWORD inv_lo = ~mask_lo;
    DWORD inv_hi = ~mask_hi;
    BYTE* grp = dispp + ((DWORD)addr << 5) + PLANE_B;
    DWORD* gp = (DWORD*)grp;
    // BANK0L: 3プレーン × 8バイト → cwork[8..31] にOR合成
    for (int plane = 0; plane < 3; plane++) {
        DWORD g_lo = gp[plane * 2 + 0] & inv_lo;
        DWORD g_hi = gp[plane * 2 + 1] & inv_hi;
        *(DWORD*)&cwork[8 + plane * 8 + 0] |= g_lo;
        *(DWORD*)&cwork[8 + plane * 8 + 4] |= g_hi;
    }
    // BANK0H: 3プレーン → cwork[32..55] に直接書込み（テキスト上位プレーンは0）
    DWORD* gph = (DWORD*)(grp + GRAM_HALFSTEP);
    for (int plane = 0; plane < 3; plane++) {
        *(DWORD*)&cwork[32 + plane * 8 + 0] = gph[plane * 2 + 0] & inv_lo;
        *(DWORD*)&cwork[32 + plane * 8 + 4] = gph[plane * 2 + 1] & inv_hi;
    }
}

// merge_graph_txtdwn_64: グラフィックス上・テキスト下 (ZPRY bit0=1)
// origsrc DRAW64.CPP:243-265 の screen1txtdwn 相当
// グラフィックスマスクの反転部分にのみテキストを残す
static void merge_graph_txtdwn_64(WORD addr) {
    BYTE* grp = dispp + ((DWORD)addr << 5) + PLANE_B;
    DWORD mask_lo, mask_hi;
    getgrphmaskpat_64(grp, mask_lo, mask_hi);
    DWORD inv_lo = ~mask_lo;  // グラフィックスが無い部分 = テキスト表示領域
    DWORD inv_hi = ~mask_hi;
    DWORD* gp = (DWORD*)grp;
    // BANK0L: テキストをマスク＋グラフィックスをOR
    for (int plane = 0; plane < 3; plane++) {
        DWORD* cw = (DWORD*)&cwork[8 + plane * 8];
        cw[0] = (cw[0] & inv_lo) | gp[plane * 2 + 0];
        cw[1] = (cw[1] & inv_hi) | gp[plane * 2 + 1];
    }
    // BANK0H: グラフィックスを直接コピー
    DWORD* gph = (DWORD*)(grp + GRAM_HALFSTEP);
    for (int plane = 0; plane < 3; plane++) {
        *(DWORD*)&cwork[32 + plane * 8 + 0] = gph[plane * 2 + 0];
        *(DWORD*)&cwork[32 + plane * 8 + 4] = gph[plane * 2 + 1];
    }
    // テキストマスクもグラフィックスマスクで制限
    *(DWORD*)&cwork[0] &= inv_lo;
    *(DWORD*)&cwork[4] &= inv_hi;
}

// width40x25_64s: 40桁×25行 64色モード (320×200 横2倍)
// origsrc DRAW64.CPP:63-375
void width40x25_64s(void) {
    fontycnt = 0;
    WORD tram_pos = crtc.TXT_TOP;
    int total_chars = (int)vramsize;
    if (total_chars <= 0) return;
    int cols = (int)crtc.TXT_XL;
    if (cols <= 0) cols = 40;
    int vyl = (int)vramylpcnt;
    if (vyl <= 0) vyl = 8;

    int col = 0;
    int scr_off = 0;
    BYTE newline = 0;
    int yp = 0;
    BYTE row_fontycnt = fontycnt;

    for (int i = 0; i < total_chars; i++) {
        WORD addr = (WORD)(tram_pos & (TRAM_MAX / 2 - 1));
        if (addr >= TRAM_MAX / 2) break;

        BYTE upt = updatetmp[addr];
        if (upt & dispflg) {
            updatetmp[addr] &= (BYTE)~dispflg;
            newline = 1;

            BYTE attr = TXT_RAM[addr + TEXT_ATR];
            if (attr & blinktest) attr ^= X1ATR_REVERSE;
            BYTE text_color = attr & 0x0F;  // color(0-7) + REVERSE(bit3)

            if (text_color == 0) {
                // grphonly: テキスト色なし → グラフィックスのみ
                fill_cwork_grphonly_64(addr);
            } else {
                // テキスト描画
                BYTE eff4 = (BYTE)(upt & 0x0F);
                WORD src_addr = addr;
                if (upt & 0x10) src_addr = (WORD)((addr - 1) & (TRAM_MAX / 2 - 1));
                BYTE char_code = TXT_RAM[src_addr + TEXT_ANK];
                BYTE knj_code = TXT_RAM[src_addr + TEXT_KNJ];
                BYTE color = attr & X1ATR_COLOR;  // 0-7
                bool reverse = (attr & X1ATR_REVERSE) != 0;

                // フォントデータを cwork[0..7] に格納 (effect8_fetch で倍角効果適用)
                if (knj_code & 0x80) {
                    WORD jis_adr = ((WORD)knj_code << 8) | char_code;
                    BYTE* kfont = getfontjis(adr2jis_x1t(jis_adr));
                    if (knj_code & 0x40) kfont++;
                    for (int y = 0; y < 8 && y < vyl; y++) {
                        cwork[y] = effect8_fetch_knj(kfont, eff4, row_fontycnt, y);
                    }
                } else {
                    for (int y = 0; y < 8 && y < vyl; y++) {
                        cwork[y] = effect8_fetch(ANK_FNT[char_code], eff4, row_fontycnt, y);
                    }
                }
                // vyl > 8 の場合は残りを0埋め
                for (int y = 8; y < vyl; y++) cwork[y] = 0;

                // テキスト色プレーン生成 + REVERSE
                fill_cwork_text_planes_64(color, reverse);

                if (text_color == 0x08) {
                    // REVERSE + 色0 = 全面テキスト(白背景黒文字)
                    // textonly パス: 上位プレーン=0, マスク=0xFF
                    for (int y = 0; y < vyl; y++) cwork[y] = 0xFF;
                }

                // ZPRY に基づくテキスト/グラフィックス合成
                if (crtc.ZPRY & 1) {
                    merge_graph_txtdwn_64(addr);
                } else {
                    merge_graph_txtup_64(addr);
                }
            }

            // cwork → screenmap 変換
            grphtxtout_64(scr_off, vyl);
        }

        // VRAMADRRESS_INC: 列・行進行
        tram_pos++;
        scr_off += 8;
        col++;
        if (col >= cols) {
            // 行末処理: fontycnt 更新
            if (updatetmp[(tram_pos - 1) & (TRAM_MAX / 2 - 1)] & 0x04) {
                fontycnt = (BYTE)((fontycnt + vyl) & 0x0F);
            } else {
                fontycnt = (BYTE)((vyl * 2) & 0x0F);
            }
            row_fontycnt = fontycnt;
            // newline が立っていれば renewalline マーク
            if (newline) {
                for (int j = 0; j < vyl * 2; j++) {
                    if (yp + j < SCREEN_HEIGHT) {
                        renewalline[yp + j] |= 3;
                    }
                }
            }
            yp += vyl * 2;
            newline = 0;
            col = 0;
            // scr_off を次行先頭に調整
            // assembly: v += (vramylpad - cols*2) * 4
            // vramylpad = vramylpcnt * (SCREEN_WIDTH / 4) * 2
            scr_off = yp * SCREEN_WIDTH;
        }
    }
    // 最終行の renewalline 処理 (行末に到達しなかった場合)
    if (newline && col > 0) {
        for (int j = 0; j < vyl * 2; j++) {
            if (yp + j < SCREEN_HEIGHT) {
                renewalline[yp + j] |= 3;
            }
        }
    }
}

// Forward declarations (定義は 128-byte helper セクション内)
static inline void get_grph_mask(BYTE* grp, DWORD& ml, DWORD& mh);
static void grphtxtout_64x2_56(int scr_off, int vyl);

// width40x25_64x2: 40桁×25行 64色×2面モード (320×200 横2倍)
// origsrc DRAW64.CPP:378-843
// dispp/dispp2 の2面合成、8プレーン (BIT7+6色+BIT6)
// 56-byte cwork, 8-line font, ×2 出力
// updatetmp: &= ~UPDATE_VRAM
void width40x25_64x2(void) {
    fontycnt = 0;
    WORD tram_pos = crtc.TXT_TOP;
    int total_chars = (int)vramsize;
    if (total_chars <= 0) return;
    int cols = (int)crtc.TXT_XL;
    if (cols <= 0) cols = 40;
    int vyl = (int)vramylpcnt;
    if (vyl <= 0) vyl = 8;

    int col = 0;
    int scr_off = 0;
    BYTE newline = 0;
    int yp = 0;
    BYTE row_fontycnt = fontycnt;

    for (int i = 0; i < total_chars; i++) {
        WORD addr = (WORD)(tram_pos & (TRAM_MAX / 2 - 1));
        if (addr >= TRAM_MAX / 2) break;

        BYTE upt = updatetmp[addr];
        if (upt & UPDATE_VRAM) {
            updatetmp[addr] &= (BYTE)(~UPDATE_VRAM);
            newline = 1;

            BYTE attr = TXT_RAM[addr + TEXT_ATR];
            if (attr & blinktest) attr ^= X1ATR_REVERSE;
            BYTE text_color = attr & 0x0F;

            DWORD gram_off = (DWORD)addr * 32 + PLANE_B;
            BYTE* grp1 = dispp + gram_off;    // Surface 1
            BYTE* grp2 = dispp2 + gram_off;   // Surface 2

            if (text_color == 0) {
                // grphonly: Surface1 → cwork, Surface2 below (masked)
                *(DWORD*)&cwork[0] = 0;
                *(DWORD*)&cwork[4] = 0;
                DWORD s1_ml = 0, s1_mh = 0;
                // Surface1 BANK0L → cwork[8..31], accumulate mask
                DWORD* p1 = (DWORD*)grp1;
                for (int pl = 0; pl < 3; pl++) {
                    DWORD lo = p1[pl*2], hi = p1[pl*2+1];
                    s1_ml |= lo; s1_mh |= hi;
                    *(DWORD*)&cwork[8 + pl*8 + 0] = lo;
                    *(DWORD*)&cwork[8 + pl*8 + 4] = hi;
                }
                // Surface1 BANK0H → cwork[32..55], accumulate mask
                DWORD* p1h = (DWORD*)(grp1 + GRAM_HALFSTEP);
                for (int pl = 0; pl < 3; pl++) {
                    DWORD lo = p1h[pl*2], hi = p1h[pl*2+1];
                    s1_ml |= lo; s1_mh |= hi;
                    *(DWORD*)&cwork[32 + pl*8 + 0] = lo;
                    *(DWORD*)&cwork[32 + pl*8 + 4] = hi;
                }
                // Surface2 masked by ~surface1 → OR into cwork
                DWORD inv_lo = ~s1_ml, inv_hi = ~s1_mh;
                DWORD* p2 = (DWORD*)grp2;
                for (int pl = 0; pl < 3; pl++) {
                    *(DWORD*)&cwork[8 + pl*8 + 0] |= p2[pl*2] & inv_lo;
                    *(DWORD*)&cwork[8 + pl*8 + 4] |= p2[pl*2+1] & inv_hi;
                }
                DWORD* p2h = (DWORD*)(grp2 + GRAM_HALFSTEP);
                for (int pl = 0; pl < 3; pl++) {
                    *(DWORD*)&cwork[32 + pl*8 + 0] |= p2h[pl*2] & inv_lo;
                    *(DWORD*)&cwork[32 + pl*8 + 4] |= p2h[pl*2+1] & inv_hi;
                }
                // BIT6 = ~surface1_mask (surface2 visible area)
                *(DWORD*)&cwork[56] = inv_lo;
                *(DWORD*)&cwork[60] = inv_hi;
            } else {
                // Text + Graphics (2面合成)
                BYTE eff4 = (BYTE)(upt & 0x0F);
                WORD src_addr = addr;
                if (upt & 0x10) src_addr = (WORD)((addr - 1) & (TRAM_MAX / 2 - 1));
                BYTE char_code = TXT_RAM[src_addr + TEXT_ANK];
                BYTE knj_code = TXT_RAM[src_addr + TEXT_KNJ];
                BYTE color = attr & X1ATR_COLOR;
                bool reverse = (attr & X1ATR_REVERSE) != 0;

                // 8-line font → cwork[0..7] (effect8_fetch で倍角効果適用)
                if (knj_code & 0x80) {
                    WORD jis_adr = ((WORD)knj_code << 8) | char_code;
                    BYTE* kfont = getfontjis(adr2jis_x1t(jis_adr));
                    if (knj_code & 0x40) kfont++;
                    for (int y = 0; y < 8 && y < vyl; y++)
                        cwork[y] = effect8_fetch_knj(kfont, eff4, row_fontycnt, y);
                } else {
                    for (int y = 0; y < 8 && y < vyl; y++)
                        cwork[y] = effect8_fetch(ANK_FNT[char_code], eff4, row_fontycnt, y);
                }
                for (int y = 8; y < vyl; y++) cwork[y] = 0;

                fill_cwork_text_planes_64(color, reverse);

                if (text_color == 0x08) {
                    for (int y = 0; y < vyl; y++) cwork[y] = 0xFF;
                }

                BYTE zpry = crtc.ZPRY & 3;

                if (zpry == 0) {
                    // txtomoura: Text(top) → Surface1(mid) → Surface2(bottom)
                    DWORD inv_txt_lo = ~(*(DWORD*)&cwork[0]);
                    DWORD inv_txt_hi = ~(*(DWORD*)&cwork[4]);
                    DWORD s1_ml = 0, s1_mh = 0;
                    DWORD* p1 = (DWORD*)grp1;
                    // Surface1 BANK0L under text → OR into cwork[8..31]
                    for (int pl = 0; pl < 3; pl++) {
                        DWORD lo = p1[pl*2], hi = p1[pl*2+1];
                        s1_ml |= lo; s1_mh |= hi;
                        *(DWORD*)&cwork[8 + pl*8 + 0] |= lo & inv_txt_lo;
                        *(DWORD*)&cwork[8 + pl*8 + 4] |= hi & inv_txt_hi;
                    }
                    // Surface1 BANK0H under text → write to cwork[32..55]
                    DWORD* p1h = (DWORD*)(grp1 + GRAM_HALFSTEP);
                    for (int pl = 0; pl < 3; pl++) {
                        DWORD lo = p1h[pl*2], hi = p1h[pl*2+1];
                        s1_ml |= lo; s1_mh |= hi;
                        *(DWORD*)&cwork[32 + pl*8 + 0] = lo & inv_txt_lo;
                        *(DWORD*)&cwork[32 + pl*8 + 4] = hi & inv_txt_hi;
                    }
                    // combined = ~(text | surface1)
                    DWORD combined_lo = inv_txt_lo & ~s1_ml;
                    DWORD combined_hi = inv_txt_hi & ~s1_mh;
                    // Surface2 below (if visible)
                    if (combined_lo | combined_hi) {
                        DWORD* p2 = (DWORD*)grp2;
                        DWORD* p2h = (DWORD*)(grp2 + GRAM_HALFSTEP);
                        for (int pl = 0; pl < 3; pl++) {
                            *(DWORD*)&cwork[8 + pl*8 + 0] |= p2[pl*2] & combined_lo;
                            *(DWORD*)&cwork[8 + pl*8 + 4] |= p2[pl*2+1] & combined_hi;
                        }
                        for (int pl = 0; pl < 3; pl++) {
                            *(DWORD*)&cwork[32 + pl*8 + 0] |= p2h[pl*2] & combined_lo;
                            *(DWORD*)&cwork[32 + pl*8 + 4] |= p2h[pl*2+1] & combined_hi;
                        }
                    }
                    *(DWORD*)&cwork[56] = combined_lo;
                    *(DWORD*)&cwork[60] = combined_hi;
                } else if (!(zpry & 2)) {
                    // omouratxt: Surface2(top) → Text(mid) → Surface1(bottom)
                    DWORD s2_ml, s2_mh;
                    get_grph_mask(grp2, s2_ml, s2_mh);
                    *(DWORD*)&cwork[56] = s2_ml;
                    *(DWORD*)&cwork[60] = s2_mh;
                    DWORD inv_s2_lo = ~s2_ml, inv_s2_hi = ~s2_mh;
                    // Surface2 BANK0L on top of text
                    DWORD* p2 = (DWORD*)grp2;
                    for (int pl = 0; pl < 3; pl++) {
                        DWORD* cw = (DWORD*)&cwork[8 + pl*8];
                        cw[0] = (cw[0] & inv_s2_lo) | p2[pl*2];
                        cw[1] = (cw[1] & inv_s2_hi) | p2[pl*2+1];
                    }
                    // Surface2 BANK0H → cwork[32..55] (direct copy)
                    DWORD* p2h = (DWORD*)(grp2 + GRAM_HALFSTEP);
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[32 + pl*8 + 0] = p2h[pl*2];
                        *(DWORD*)&cwork[32 + pl*8 + 4] = p2h[pl*2+1];
                    }
                    *(DWORD*)&cwork[0] &= inv_s2_lo;
                    *(DWORD*)&cwork[4] &= inv_s2_hi;
                    // Surface1 under both (surface2 | text)
                    DWORD s1_ml, s1_mh;
                    get_grph_mask(grp1, s1_ml, s1_mh);
                    DWORD inv_s1_lo = ~s1_ml, inv_s1_hi = ~s1_mh;
                    *(DWORD*)&cwork[56] &= inv_s1_lo;
                    *(DWORD*)&cwork[60] &= inv_s1_hi;
                    // Surface1 BANK0L
                    DWORD* p1 = (DWORD*)grp1;
                    for (int pl = 0; pl < 3; pl++) {
                        DWORD* cw = (DWORD*)&cwork[8 + pl*8];
                        cw[0] = (cw[0] & inv_s1_lo) | p1[pl*2];
                        cw[1] = (cw[1] & inv_s1_hi) | p1[pl*2+1];
                    }
                    // Surface1 BANK0H
                    DWORD* p1h = (DWORD*)(grp1 + GRAM_HALFSTEP);
                    for (int pl = 0; pl < 3; pl++) {
                        DWORD* cw = (DWORD*)&cwork[32 + pl*8];
                        cw[0] = (cw[0] & inv_s1_lo) | p1h[pl*2];
                        cw[1] = (cw[1] & inv_s1_hi) | p1h[pl*2+1];
                    }
                    *(DWORD*)&cwork[0] &= inv_s1_lo;
                    *(DWORD*)&cwork[4] &= inv_s1_hi;
                } else {
                    // txtandgrph1: Surface1(top) → Text(mid) → Surface2(bottom)
                    DWORD s1_ml, s1_mh;
                    get_grph_mask(grp1, s1_ml, s1_mh);
                    DWORD inv_s1_lo = ~s1_ml, inv_s1_hi = ~s1_mh;
                    // Surface1 BANK0L on top of text
                    DWORD* p1 = (DWORD*)grp1;
                    for (int pl = 0; pl < 3; pl++) {
                        DWORD* cw = (DWORD*)&cwork[8 + pl*8];
                        cw[0] = (cw[0] & inv_s1_lo) | p1[pl*2];
                        cw[1] = (cw[1] & inv_s1_hi) | p1[pl*2+1];
                    }
                    // Surface1 BANK0H → cwork[32..55] (direct copy)
                    DWORD* p1h = (DWORD*)(grp1 + GRAM_HALFSTEP);
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[32 + pl*8 + 0] = p1h[pl*2];
                        *(DWORD*)&cwork[32 + pl*8 + 4] = p1h[pl*2+1];
                    }
                    *(DWORD*)&cwork[0] &= inv_s1_lo;
                    *(DWORD*)&cwork[4] &= inv_s1_hi;
                    // combined = ~(surface1 | text)
                    DWORD combined_lo = ~(s1_ml | *(DWORD*)&cwork[0]);
                    DWORD combined_hi = ~(s1_mh | *(DWORD*)&cwork[4]);
                    // Surface2 below (if visible)
                    if (combined_lo | combined_hi) {
                        DWORD* p2 = (DWORD*)grp2;
                        DWORD* p2h = (DWORD*)(grp2 + GRAM_HALFSTEP);
                        for (int pl = 0; pl < 3; pl++) {
                            *(DWORD*)&cwork[8 + pl*8 + 0] |= p2[pl*2] & combined_lo;
                            *(DWORD*)&cwork[8 + pl*8 + 4] |= p2[pl*2+1] & combined_hi;
                        }
                        for (int pl = 0; pl < 3; pl++) {
                            *(DWORD*)&cwork[32 + pl*8 + 0] |= p2h[pl*2] & combined_lo;
                            *(DWORD*)&cwork[32 + pl*8 + 4] |= p2h[pl*2+1] & combined_hi;
                        }
                    }
                    *(DWORD*)&cwork[56] = combined_lo;
                    *(DWORD*)&cwork[60] = combined_hi;
                }
            }

            grphtxtout_64x2_56(scr_off, vyl);
        }

        // VRAMADRRESS_INC
        tram_pos++;
        scr_off += 8;
        col++;
        if (col >= cols) {
            if (updatetmp[(tram_pos - 1) & (TRAM_MAX / 2 - 1)] & 0x04) {
                fontycnt = (BYTE)((fontycnt + vyl) & 0x0F);
            } else {
                fontycnt = (BYTE)((vyl * 2) & 0x0F);
            }
            row_fontycnt = fontycnt;
            if (newline) {
                for (int j = 0; j < vyl * 2; j++) {
                    if (yp + j < SCREEN_HEIGHT)
                        renewalline[yp + j] |= 3;
                }
            }
            yp += vyl * 2;
            newline = 0;
            col = 0;
            scr_off = yp * SCREEN_WIDTH;
        }
    }
    if (newline && col > 0) {
        for (int j = 0; j < vyl * 2; j++) {
            if (yp + j < SCREEN_HEIGHT)
                renewalline[yp + j] |= 3;
        }
    }
}

// ============================================================================
// 4096色ヘルパー (width40x25_4096 / width40x12_4096 共通)
// ============================================================================

// grphtxtout_4096_104: 104バイト cwork → screenmap 左右分割書込み (×2出力)
// cwork layout:
//   [0]:TG  [8]:B3(BANK1H_B) [16]:B2(BANK1L_B) [24]:B1(BANK0H_B) [32]:B0(BANK0L_B)
//   [40]:R0(BANK0L_R) [48]:G0(BANK0L_G) [56]:R1(BANK0H_R) [64]:G1(BANK0H_G)
//   [72]:R2(BANK1L_R) [80]:G2(BANK1L_G) [88]:R3(BANK1H_R) [96]:G3(BANK1H_G)
// 右半分 screenmap[+320]: 000.TG.G0.G1.G2.G3
// 左半分 screenmap[+0]:   R0.R1.R2.R3.B0.B1.B2.B3
static void grphtxtout_4096_104(int scr_off, int vyl) {
    for (int y = 0; y < vyl; y++) {
        // 右半分: TG(bit4) + G0(bit3) + G1(bit2) + G2(bit1) + G3(bit0)
        DWORD rl = bmp2byte_table[2][cwork[0+y] * 2];         // TG → row 2 (bit4)
        DWORD rr = bmp2byte_table[2][cwork[0+y] * 2 + 1];
        rl |= bmp2byte_table[1][cwork[48+y] * 2];             // G0 → row 1 (bit3)
        rr |= bmp2byte_table[1][cwork[48+y] * 2 + 1];
        rl |= bmp2byte_table[18][cwork[64+y] * 2];            // G1 → row 18 (bit2)
        rr |= bmp2byte_table[18][cwork[64+y] * 2 + 1];
        rl |= bmp2byte_table[17][cwork[80+y] * 2];            // G2 → row 17 (bit1)
        rr |= bmp2byte_table[17][cwork[80+y] * 2 + 1];
        rl |= bmp2byte_table[16][cwork[96+y] * 2];            // G3 → row 16 (bit0)
        rr |= bmp2byte_table[16][cwork[96+y] * 2 + 1];

        // 左半分: B3(bit0) + B2(bit1) + B1(bit2) + B0(bit3) + R0(bit7) + R1(bit6) + R2(bit5) + R3(bit4)
        DWORD ll = bmp2byte_table[16][cwork[8+y] * 2];        // B3 → row 16 (bit0)
        DWORD lr = bmp2byte_table[16][cwork[8+y] * 2 + 1];
        ll |= bmp2byte_table[17][cwork[16+y] * 2];            // B2 → row 17 (bit1)
        lr |= bmp2byte_table[17][cwork[16+y] * 2 + 1];
        ll |= bmp2byte_table[18][cwork[24+y] * 2];            // B1 → row 18 (bit2)
        lr |= bmp2byte_table[18][cwork[24+y] * 2 + 1];
        ll |= bmp2byte_table[1][cwork[32+y] * 2];             // B0 → row 1 (bit3)
        lr |= bmp2byte_table[1][cwork[32+y] * 2 + 1];
        ll |= bmp2byte_table[20][cwork[40+y] * 2];            // R0 → row 20 (bit7)
        lr |= bmp2byte_table[20][cwork[40+y] * 2 + 1];
        ll |= bmp2byte_table[19][cwork[56+y] * 2];            // R1 → row 19 (bit6)
        lr |= bmp2byte_table[19][cwork[56+y] * 2 + 1];
        ll |= bmp2byte_table[4][cwork[72+y] * 2];             // R2 → row 4 (bit5)
        lr |= bmp2byte_table[4][cwork[72+y] * 2 + 1];
        ll |= bmp2byte_table[2][cwork[88+y] * 2];             // R3 → row 2 (bit4)
        lr |= bmp2byte_table[2][cwork[88+y] * 2 + 1];

        // ×2: 各ラインを2スキャンラインに書き込む
        int off0 = scr_off + y * 2 * SCREEN_WIDTH;
        int off1 = off0 + SCREEN_WIDTH;
        if (off0 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
            *(DWORD*)&screenmap[off0 + 0]   = ll;
            *(DWORD*)&screenmap[off0 + 4]   = lr;
            *(DWORD*)&screenmap[off0 + 320] = rl;
            *(DWORD*)&screenmap[off0 + 324] = rr;
        }
        if (off1 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
            *(DWORD*)&screenmap[off1 + 0]   = ll;
            *(DWORD*)&screenmap[off1 + 4]   = lr;
            *(DWORD*)&screenmap[off1 + 320] = rl;
            *(DWORD*)&screenmap[off1 + 324] = rr;
        }
    }
}

// getgrphmaskpat_4096: 4バンク×3プレーン(12プレーン)のOR→マスク生成
static void getgrphmaskpat_4096(DWORD grp_off, DWORD& mask_lo, DWORD& mask_hi) {
    mask_lo = 0; mask_hi = 0;
    static const DWORD banks[4] = { GRAM_BANK0L, GRAM_BANK0H, GRAM_BANK1L, GRAM_BANK1H };
    for (int b = 0; b < 4; b++) {
        DWORD* p = (DWORD*)&GRP_RAM[banks[b] + grp_off + PLANE_B];
        mask_lo |= p[0]; mask_hi |= p[1];  // PLANE_B
        mask_lo |= p[2]; mask_hi |= p[3];  // PLANE_R
        mask_lo |= p[4]; mask_hi |= p[5];  // PLANE_G
    }
}

// fill_cwork_grphonly_4096: グラフィックスのみのcwork生成 (104バイト)
static void fill_cwork_grphonly_4096(DWORD grp_off) {
    // TG = 0
    *(DWORD*)&cwork[0] = 0;
    *(DWORD*)&cwork[4] = 0;
    // B planes: BANK1H, BANK1L, BANK0H, BANK0L (B3→B0)
    memcpy(&cwork[8],  &GRP_RAM[GRAM_BANK1H + grp_off + PLANE_B], 8);
    memcpy(&cwork[16], &GRP_RAM[GRAM_BANK1L + grp_off + PLANE_B], 8);
    memcpy(&cwork[24], &GRP_RAM[GRAM_BANK0H + grp_off + PLANE_B], 8);
    memcpy(&cwork[32], &GRP_RAM[GRAM_BANK0L + grp_off + PLANE_B], 8);
    // R0,G0 (BANK0L)
    memcpy(&cwork[40], &GRP_RAM[GRAM_BANK0L + grp_off + PLANE_R], 8);
    memcpy(&cwork[48], &GRP_RAM[GRAM_BANK0L + grp_off + PLANE_G], 8);
    // R1,G1 (BANK0H)
    memcpy(&cwork[56], &GRP_RAM[GRAM_BANK0H + grp_off + PLANE_R], 8);
    memcpy(&cwork[64], &GRP_RAM[GRAM_BANK0H + grp_off + PLANE_G], 8);
    // R2,G2 (BANK1L)
    memcpy(&cwork[72], &GRP_RAM[GRAM_BANK1L + grp_off + PLANE_R], 8);
    memcpy(&cwork[80], &GRP_RAM[GRAM_BANK1L + grp_off + PLANE_G], 8);
    // R3,G3 (BANK1H)
    memcpy(&cwork[88], &GRP_RAM[GRAM_BANK1H + grp_off + PLANE_R], 8);
    memcpy(&cwork[96], &GRP_RAM[GRAM_BANK1H + grp_off + PLANE_G], 8);
}

// merge_graph_txtup_4096: テキスト上・グラフィックス下 (ZPRY bit0=0)
// テキストマスクで覆われた部分はテキスト色、残りはグラフィックス
static void merge_graph_txtup_4096(DWORD grp_off) {
    DWORD inv_lo = ~(*(DWORD*)&cwork[0]);
    DWORD inv_hi = ~(*(DWORD*)&cwork[4]);
    // cwork[8..31] は text B/R/G → 4096色では B3/B2/B1 に相当
    // テキスト色プレーンはOR合成済み。グラフィックスをマスク付きで合成
    // B3 (cwork[8]): text_B | (BANK1H_B & ~text_mask)
    DWORD* p;
    p = (DWORD*)&GRP_RAM[GRAM_BANK1H + grp_off + PLANE_B];
    *(DWORD*)&cwork[8]  |= p[0] & inv_lo;
    *(DWORD*)&cwork[12] |= p[1] & inv_hi;
    // B2 (cwork[16]): text_R | (BANK1L_B & ~text_mask)
    p = (DWORD*)&GRP_RAM[GRAM_BANK1L + grp_off + PLANE_B];
    *(DWORD*)&cwork[16] |= p[0] & inv_lo;
    *(DWORD*)&cwork[20] |= p[1] & inv_hi;
    // B1 (cwork[24]): text_G | (BANK0H_B & ~text_mask)
    p = (DWORD*)&GRP_RAM[GRAM_BANK0H + grp_off + PLANE_B];
    *(DWORD*)&cwork[24] |= p[0] & inv_lo;
    *(DWORD*)&cwork[28] |= p[1] & inv_hi;
    // B0 (cwork[32]): BANK0L_B & ~text_mask
    p = (DWORD*)&GRP_RAM[GRAM_BANK0L + grp_off + PLANE_B];
    *(DWORD*)&cwork[32] = p[0] & inv_lo;
    *(DWORD*)&cwork[36] = p[1] & inv_hi;
    // R/G planes: all masked by ~text_mask
    // R0,G0 (BANK0L)
    p = (DWORD*)&GRP_RAM[GRAM_BANK0L + grp_off + PLANE_R];
    *(DWORD*)&cwork[40] = p[0] & inv_lo;
    *(DWORD*)&cwork[44] = p[1] & inv_hi;
    p = (DWORD*)&GRP_RAM[GRAM_BANK0L + grp_off + PLANE_G];
    *(DWORD*)&cwork[48] = p[0] & inv_lo;
    *(DWORD*)&cwork[52] = p[1] & inv_hi;
    // R1,G1 (BANK0H)
    p = (DWORD*)&GRP_RAM[GRAM_BANK0H + grp_off + PLANE_R];
    *(DWORD*)&cwork[56] = p[0] & inv_lo;
    *(DWORD*)&cwork[60] = p[1] & inv_hi;
    p = (DWORD*)&GRP_RAM[GRAM_BANK0H + grp_off + PLANE_G];
    *(DWORD*)&cwork[64] = p[0] & inv_lo;
    *(DWORD*)&cwork[68] = p[1] & inv_hi;
    // R2,G2 (BANK1L)
    p = (DWORD*)&GRP_RAM[GRAM_BANK1L + grp_off + PLANE_R];
    *(DWORD*)&cwork[72] = p[0] & inv_lo;
    *(DWORD*)&cwork[76] = p[1] & inv_hi;
    p = (DWORD*)&GRP_RAM[GRAM_BANK1L + grp_off + PLANE_G];
    *(DWORD*)&cwork[80] = p[0] & inv_lo;
    *(DWORD*)&cwork[84] = p[1] & inv_hi;
    // R3,G3 (BANK1H)
    p = (DWORD*)&GRP_RAM[GRAM_BANK1H + grp_off + PLANE_R];
    *(DWORD*)&cwork[88] = p[0] & inv_lo;
    *(DWORD*)&cwork[92] = p[1] & inv_hi;
    p = (DWORD*)&GRP_RAM[GRAM_BANK1H + grp_off + PLANE_G];
    *(DWORD*)&cwork[96] = p[0] & inv_lo;
    *(DWORD*)&cwork[100] = p[1] & inv_hi;
}

// merge_graph_txtdwn_4096: グラフィックス上・テキスト下 (ZPRY bit0=1)
// グラフィックスマスクの無い部分にのみテキストを残す
static void merge_graph_txtdwn_4096(DWORD grp_off) {
    DWORD mask_lo, mask_hi;
    getgrphmaskpat_4096(grp_off, mask_lo, mask_hi);
    DWORD inv_lo = ~mask_lo;
    DWORD inv_hi = ~mask_hi;
    // B3 (cwork[8]): text_B where no graphics, BANK1H_B where graphics
    DWORD* p;
    p = (DWORD*)&GRP_RAM[GRAM_BANK1H + grp_off + PLANE_B];
    *(DWORD*)&cwork[8]  = (*(DWORD*)&cwork[8]  & inv_lo) | p[0];
    *(DWORD*)&cwork[12] = (*(DWORD*)&cwork[12] & inv_hi) | p[1];
    // B2 (cwork[16]): text_R masked + BANK1L_B
    p = (DWORD*)&GRP_RAM[GRAM_BANK1L + grp_off + PLANE_B];
    *(DWORD*)&cwork[16] = (*(DWORD*)&cwork[16] & inv_lo) | p[0];
    *(DWORD*)&cwork[20] = (*(DWORD*)&cwork[20] & inv_hi) | p[1];
    // B1 (cwork[24]): text_G masked + BANK0H_B
    p = (DWORD*)&GRP_RAM[GRAM_BANK0H + grp_off + PLANE_B];
    *(DWORD*)&cwork[24] = (*(DWORD*)&cwork[24] & inv_lo) | p[0];
    *(DWORD*)&cwork[28] = (*(DWORD*)&cwork[28] & inv_hi) | p[1];
    // B0: pure graphics (BANK0L_B)
    memcpy(&cwork[32], &GRP_RAM[GRAM_BANK0L + grp_off + PLANE_B], 8);
    // R/G: pure graphics from all banks
    memcpy(&cwork[40], &GRP_RAM[GRAM_BANK0L + grp_off + PLANE_R], 8);
    memcpy(&cwork[48], &GRP_RAM[GRAM_BANK0L + grp_off + PLANE_G], 8);
    memcpy(&cwork[56], &GRP_RAM[GRAM_BANK0H + grp_off + PLANE_R], 8);
    memcpy(&cwork[64], &GRP_RAM[GRAM_BANK0H + grp_off + PLANE_G], 8);
    memcpy(&cwork[72], &GRP_RAM[GRAM_BANK1L + grp_off + PLANE_R], 8);
    memcpy(&cwork[80], &GRP_RAM[GRAM_BANK1L + grp_off + PLANE_G], 8);
    memcpy(&cwork[88], &GRP_RAM[GRAM_BANK1H + grp_off + PLANE_R], 8);
    memcpy(&cwork[96], &GRP_RAM[GRAM_BANK1H + grp_off + PLANE_G], 8);
    // TG: mask by ~graphics_mask
    *(DWORD*)&cwork[0] &= inv_lo;
    *(DWORD*)&cwork[4] &= inv_hi;
}

// width40x25_4096: 40桁×25行 4096色モード (320×200 横2倍)
// origsrc DRAW4096.CPP:27-387
// 4バンク(BANK0L/0H/1L/1H)から12ビット色情報読み出し
// screenmap左半分(0..319)にB3B2B1B0+R3R2R1R0、右半分(320..639)にTG+G3G2G1G0
// 8-line font, ×2 出力
// updatetmp: &= ~UPDATE_VRAM
void width40x25_4096(void) {
    fontycnt = 0;
    WORD tram_pos = crtc.TXT_TOP;
    int total_chars = (int)vramsize;
    if (total_chars <= 0) return;
    int cols = (int)crtc.TXT_XL;
    if (cols <= 0) cols = 40;
    int vyl = (int)vramylpcnt;
    if (vyl <= 0) vyl = 8;

    int col = 0;
    int scr_off = 0;
    BYTE newline = 0;
    int yp = 0;
    BYTE row_fontycnt = fontycnt;

    for (int i = 0; i < total_chars; i++) {
        WORD addr = (WORD)(tram_pos & (TRAM_MAX / 2 - 1));
        if (addr >= TRAM_MAX / 2) break;

        BYTE upt = updatetmp[addr];
        if (upt & UPDATE_VRAM) {
            updatetmp[addr] &= (BYTE)~UPDATE_VRAM;
            newline = 1;

            DWORD grp_off = (DWORD)addr << 5;
            BYTE attr = TXT_RAM[addr + TEXT_ATR];
            if (attr & blinktest) attr ^= X1ATR_REVERSE;
            BYTE text_color = attr & 0x0F;

            if (text_color == 0) {
                // grphonly: テキスト色なし
                fill_cwork_grphonly_4096(grp_off);
            } else {
                // テキスト描画
                BYTE eff4 = (BYTE)(upt & 0x0F);
                WORD src_addr = addr;
                if (upt & 0x10) src_addr = (WORD)((addr - 1) & (TRAM_MAX / 2 - 1));
                BYTE char_code = TXT_RAM[src_addr + TEXT_ANK];
                BYTE knj_code = TXT_RAM[src_addr + TEXT_KNJ];
                BYTE color = attr & X1ATR_COLOR;
                bool reverse = (attr & X1ATR_REVERSE) != 0;

                // フォントデータを cwork[0..7] に格納 (effect8_fetch で倍角効果適用)
                if (knj_code & 0x80) {
                    WORD jis_adr = ((WORD)knj_code << 8) | char_code;
                    BYTE* kfont = getfontjis(adr2jis_x1t(jis_adr));
                    if (knj_code & 0x40) kfont++;
                    for (int y = 0; y < 8 && y < vyl; y++)
                        cwork[y] = effect8_fetch_knj(kfont, eff4, row_fontycnt, y);
                } else {
                    for (int y = 0; y < 8 && y < vyl; y++)
                        cwork[y] = effect8_fetch(ANK_FNT[char_code], eff4, row_fontycnt, y);
                }
                for (int y = 8; y < vyl; y++) cwork[y] = 0;

                // REVERSE 処理
                if (reverse) {
                    for (int y = 0; y < vyl; y++) cwork[y] ^= 0xFF;
                }

                // テキスト色プレーン生成: B/R/G → cwork[8..31]
                // REVERSE時: 色ビットが立っていないプレーンは0xFF
                //   → 背景=色7(TEXTPAL[7]), 文字=complement(color)
                BYTE unused_fill = reverse ? 0xFF : 0;
                for (int y = 0; y < vyl; y++) {
                    cwork[8  + y] = (color & 1) ? cwork[y] : unused_fill;  // BLUE → B3位置
                    cwork[16 + y] = (color & 2) ? cwork[y] : unused_fill;  // RED  → B2位置
                    cwork[24 + y] = (color & 4) ? cwork[y] : unused_fill;  // GREEN → B1位置
                }

                // origsrc DRAW4096.CPP:
                // planeeffects後に ZPRY==0 のときだけ inc eax / jne を通し、
                // reverse+color(0..6) で textonly に入る（reverse+color7 は textup）
                bool textonly = reverse && (color != 7);
                if (crtc.ZPRY & 1) {
                    // screen1txtdwn: グラフィックス上・テキスト下
                    // (REVERSE含む全パターンでこのパスを通る)
                    merge_graph_txtdwn_4096(grp_off);
                } else if (textonly) {
                    // textonly: REVERSE時はグラフィックスを無視
                    // origsrc: planeeffects後 eax=-1 → inc eax=0 → jmp textonly
                    // cwork[0..7] = 0xFF (全面テキストマスク)
                    // cwork[8..31] はplaneeffects相当で既にセット済み
                    // cwork[32..103] = 0
                    for (int y = 0; y < vyl; y++) cwork[y] = 0xFF;
                    memset(&cwork[32], 0, 72);
                } else {
                    // screen1txtupt: テキスト上・グラフィックス下 (非REVERSE)
                    merge_graph_txtup_4096(grp_off);
                }
            }

            grphtxtout_4096_104(scr_off, vyl);
        }

        // VRAMADRRESS_INC
        tram_pos++;
        scr_off += 8;
        col++;
        if (col >= cols) {
            if (updatetmp[(tram_pos - 1) & (TRAM_MAX / 2 - 1)] & 0x04) {
                fontycnt = (BYTE)((fontycnt + vyl) & 0x0F);
            } else {
                fontycnt = (BYTE)((vyl * 2) & 0x0F);
            }
            row_fontycnt = fontycnt;
            if (newline) {
                for (int j = 0; j < vyl * 2; j++) {
                    if (yp + j < SCREEN_HEIGHT)
                        renewalline[yp + j] |= 3;
                }
            }
            yp += vyl * 2;
            newline = 0;
            col = 0;
            scr_off = yp * SCREEN_WIDTH;
        }
    }
    if (newline && col > 0) {
        for (int j = 0; j < vyl * 2; j++) {
            if (yp + j < SCREEN_HEIGHT)
                renewalline[yp + j] |= 3;
        }
    }
}

// ============================================================================
// 128-byte cwork ヘルパー (64h/64l/80x12_64s 共通)
// ============================================================================

// cwork7_to_pixels: 7プレーン (BIT6,B,R,G,B2,R2,G2) → pixel DWORD pair
// base=0 で upper half, base=64 で lower half
static inline void cwork7_to_pixels(int base, int y, DWORD& left, DWORD& right) {
    BYTE c0 = cwork[base + y + 0];   // BIT6
    BYTE c1 = cwork[base + y + 8];   // BLUE
    BYTE c2 = cwork[base + y + 16];  // RED
    BYTE c3 = cwork[base + y + 24];  // GREEN
    BYTE c4 = cwork[base + y + 32];  // BLUE2
    BYTE c5 = cwork[base + y + 40];  // RED2
    BYTE c6 = cwork[base + y + 48];  // GREEN2
    left  = bmp2byte_table[19][c0 * 2];
    right = bmp2byte_table[19][c0 * 2 + 1];
    left  |= bmp2byte_table[16][c1 * 2];
    right |= bmp2byte_table[16][c1 * 2 + 1];
    left  |= bmp2byte_table[17][c2 * 2];
    right |= bmp2byte_table[17][c2 * 2 + 1];
    left  |= bmp2byte_table[18][c3 * 2];
    right |= bmp2byte_table[18][c3 * 2 + 1];
    left  |= bmp2byte_table[1][c4 * 2];
    right |= bmp2byte_table[1][c4 * 2 + 1];
    left  |= bmp2byte_table[2][c5 * 2];
    right |= bmp2byte_table[2][c5 * 2 + 1];
    left  |= bmp2byte_table[4][c6 * 2];
    right |= bmp2byte_table[4][c6 * 2 + 1];
}

// grphtxtout_64_128: 128-byte cwork → screenmap (400-line interleaved)
// upper half (base=0) → even scanline, lower half (base=64) → odd scanline
// origsrc DRAW64H.CPP:360-416
static void grphtxtout_64_128(int scr_off, int vyl) {
    for (int y = 0; y < vyl; y++) {
        DWORD left_u, right_u, left_l, right_l;
        cwork7_to_pixels(0, y, left_u, right_u);
        cwork7_to_pixels(64, y, left_l, right_l);
        int off0 = scr_off + y * 2 * SCREEN_WIDTH;   // even scanline
        int off1 = off0 + SCREEN_WIDTH;                // odd scanline
        if (off0 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
            *(DWORD*)&screenmap[off0 + 0] = left_u;
            *(DWORD*)&screenmap[off0 + 4] = right_u;
        }
        if (off1 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
            *(DWORD*)&screenmap[off1 + 0] = left_l;
            *(DWORD*)&screenmap[off1 + 4] = right_l;
        }
    }
}

// fill_cwork_text_planes_64_128: 16-line font → 128-byte cwork text planes
// cwork[0..7] / cwork[64..71] にフォントデータが格納済みの前提
static void fill_cwork_text_planes_64_128(BYTE color, bool reverse) {
    if (reverse) {
        for (int i = 0; i < 8; i++) {
            cwork[i] ^= 0xFF;
            cwork[64 + i] ^= 0xFF;
        }
    }
    // REVERSE時: 色ビットが立っていないプレーンは0xFF（背景=色7, 文字=complement）
    BYTE unused_fill = reverse ? 0xFF : 0;
    for (int i = 0; i < 8; i++) {
        cwork[8  + i] = (color & 1) ? cwork[i] : unused_fill;
        cwork[16 + i] = (color & 2) ? cwork[i] : unused_fill;
        cwork[24 + i] = (color & 4) ? cwork[i] : unused_fill;
        cwork[32 + i] = 0;
        cwork[40 + i] = 0;
        cwork[48 + i] = 0;
        cwork[72 + i] = (color & 1) ? cwork[64 + i] : unused_fill;
        cwork[80 + i] = (color & 2) ? cwork[64 + i] : unused_fill;
        cwork[88 + i] = (color & 4) ? cwork[64 + i] : unused_fill;
        cwork[96 + i] = 0;
        cwork[104 + i] = 0;
        cwork[112 + i] = 0;
    }
}

// grphtxtout_64_128_x4: 128-byte cwork → screenmap (×4倍出力: ローレゾ100ライン系)
// upper half → lines 0,1 (doubled), lower half → lines 2,3 (doubled)
// origsrc DRAW64L.CPP / DRAW64H.CPP grphtxtout (×4)
static void grphtxtout_64_128_x4(int scr_off, int vyl) {
    for (int y = 0; y < vyl; y++) {
        DWORD left_u, right_u, left_l, right_l;
        cwork7_to_pixels(0, y, left_u, right_u);
        cwork7_to_pixels(64, y, left_l, right_l);
        int off0 = scr_off + y * 4 * SCREEN_WIDTH;   // line 0: upper
        int off1 = off0 + SCREEN_WIDTH;                // line 1: upper dup
        int off2 = off0 + SCREEN_WIDTH * 2;            // line 2: lower
        int off3 = off0 + SCREEN_WIDTH * 3;            // line 3: lower dup
        if (off0 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
            *(DWORD*)&screenmap[off0 + 0] = left_u;
            *(DWORD*)&screenmap[off0 + 4] = right_u;
        }
        if (off1 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
            *(DWORD*)&screenmap[off1 + 0] = left_u;
            *(DWORD*)&screenmap[off1 + 4] = right_u;
        }
        if (off2 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
            *(DWORD*)&screenmap[off2 + 0] = left_l;
            *(DWORD*)&screenmap[off2 + 4] = right_l;
        }
        if (off3 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
            *(DWORD*)&screenmap[off3 + 0] = left_l;
            *(DWORD*)&screenmap[off3 + 4] = right_l;
        }
    }
}

// width40x25_64h: 40桁×25行 64色ハイレゾモード (320×400)
// origsrc DRAW64H.CPP:27-430
// 128-byte cwork, 4バンク (BANK0L/BANK0H/BANK1L/BANK1H)
// upper→偶数スキャンライン, lower→奇数スキャンライン
// updatetmp: &= ~UPDATE_VRAM
void width40x25_64h(void) {
    fontycnt = 0;
    WORD tram_pos = crtc.TXT_TOP;
    int total_chars = (int)vramsize;
    if (total_chars <= 0) return;
    int cols = (int)crtc.TXT_XL;
    if (cols <= 0) cols = 40;
    int vyl = (int)vramylpcnt;
    if (vyl <= 0) vyl = 8;

    int col = 0;
    int scr_off = 0;
    BYTE newline = 0;
    int yp = 0;

    for (int i = 0; i < total_chars; i++) {
        WORD addr = (WORD)(tram_pos & (TRAM_MAX / 2 - 1));
        if (addr >= TRAM_MAX / 2) break;

        BYTE upt = updatetmp[addr];
        if (upt & UPDATE_VRAM) {
            updatetmp[addr] &= (BYTE)(~UPDATE_VRAM);
            newline = 1;

            BYTE attr = TXT_RAM[addr + TEXT_ATR];
            if (attr & blinktest) attr ^= X1ATR_REVERSE;
            BYTE text_color = attr & 0x0F;

            // GRP_RAM 4バンク直接アクセス (BANK0L基点)
            BYTE* grp = &GRP_RAM[(DWORD)addr * 32 + GRAM_BANK0L + PLANE_B];

            if (text_color == 0) {
                // grphonly: テキスト色なし
                *(DWORD*)&cwork[0] = 0;
                *(DWORD*)&cwork[4] = 0;
                memcpy(&cwork[8], grp, 24);                          // BANK0L B,R,G
                memcpy(&cwork[32], grp + GRAM_HALFSTEP * 2, 24);     // BANK1L B2,R2,G2
                *(DWORD*)&cwork[64] = 0;
                *(DWORD*)&cwork[68] = 0;
                memcpy(&cwork[72], grp + GRAM_HALFSTEP, 24);         // BANK0H B,R,G
                memcpy(&cwork[96], grp + GRAM_HALFSTEP * 3, 24);     // BANK1H B2,R2,G2
            } else {
                WORD src_addr = addr;
                if (upt & 0x10) src_addr = (WORD)((addr - 1) & (TRAM_MAX / 2 - 1));
                BYTE char_code = TXT_RAM[src_addr + TEXT_ANK];
                BYTE knj_code = TXT_RAM[src_addr + TEXT_KNJ];
                BYTE color = attr & X1ATR_COLOR;
                bool reverse = (attr & X1ATR_REVERSE) != 0;

                // 16-line font → cwork[0..7] (upper) + cwork[64..71] (lower)
                if (knj_code & 0x80) {
                    WORD jis_adr = ((WORD)knj_code << 8) | char_code;
                    BYTE* kfont = getfontjis(adr2jis_x1t(jis_adr));
                    if (knj_code & 0x40) kfont++;
                    for (int y = 0; y < 8 && y < vyl; y++) {
                        cwork[y]      = kfont[(y * 2) & 31];
                        cwork[64 + y] = kfont[((y + 8) * 2) & 31];
                    }
                } else {
                    BYTE* fnt16 = &KNJ_FNT[(WORD)char_code * 16];
                    for (int y = 0; y < 8 && y < vyl; y++) {
                        cwork[y]      = fnt16[y];
                        cwork[64 + y] = fnt16[y + 8];
                    }
                }
                for (int y = 8; y < vyl; y++) {
                    cwork[y] = 0;
                    cwork[64 + y] = 0;
                }

                fill_cwork_text_planes_64_128(color, reverse);

                if (text_color == 0x08) {
                    for (int y = 0; y < 8; y++) {
                        cwork[y] = 0xFF;
                        cwork[64 + y] = 0xFF;
                    }
                }

                if (crtc.ZPRY & 1) {
                    // screen1txtdwn: グラフィックス上
                    // Upper: mask from BANK0L+BANK1L
                    DWORD* p0 = (DWORD*)grp;                            // BANK0L
                    DWORD ml = p0[0]; DWORD mh = p0[1];
                    ml |= p0[2]; mh |= p0[3];
                    ml |= p0[4]; mh |= p0[5];
                    DWORD* p1l = (DWORD*)(grp + GRAM_HALFSTEP * 2);     // BANK1L
                    ml |= p1l[0]; mh |= p1l[1];
                    ml |= p1l[2]; mh |= p1l[3];
                    ml |= p1l[4]; mh |= p1l[5];
                    DWORD inv_lo = ~ml, inv_hi = ~mh;
                    for (int pl = 0; pl < 3; pl++) {
                        DWORD* cw = (DWORD*)&cwork[8 + pl * 8];
                        cw[0] = (cw[0] & inv_lo) | p0[pl * 2 + 0];
                        cw[1] = (cw[1] & inv_hi) | p0[pl * 2 + 1];
                    }
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[32 + pl * 8 + 0] = p1l[pl * 2 + 0];
                        *(DWORD*)&cwork[32 + pl * 8 + 4] = p1l[pl * 2 + 1];
                    }
                    *(DWORD*)&cwork[0] &= inv_lo;
                    *(DWORD*)&cwork[4] &= inv_hi;
                    // Lower: mask from BANK0H+BANK1H
                    DWORD* p0h = (DWORD*)(grp + GRAM_HALFSTEP);         // BANK0H
                    ml = p0h[0]; mh = p0h[1];
                    ml |= p0h[2]; mh |= p0h[3];
                    ml |= p0h[4]; mh |= p0h[5];
                    DWORD* p1h = (DWORD*)(grp + GRAM_HALFSTEP * 3);     // BANK1H
                    ml |= p1h[0]; mh |= p1h[1];
                    ml |= p1h[2]; mh |= p1h[3];
                    ml |= p1h[4]; mh |= p1h[5];
                    inv_lo = ~ml; inv_hi = ~mh;
                    for (int pl = 0; pl < 3; pl++) {
                        DWORD* cw = (DWORD*)&cwork[72 + pl * 8];
                        cw[0] = (cw[0] & inv_lo) | p0h[pl * 2 + 0];
                        cw[1] = (cw[1] & inv_hi) | p0h[pl * 2 + 1];
                    }
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[96 + pl * 8 + 0] = p1h[pl * 2 + 0];
                        *(DWORD*)&cwork[96 + pl * 8 + 4] = p1h[pl * 2 + 1];
                    }
                    *(DWORD*)&cwork[64] &= inv_lo;
                    *(DWORD*)&cwork[68] &= inv_hi;
                } else {
                    // screen1txtup: テキスト上
                    // Upper: BANK0L + BANK1L
                    DWORD inv_lo_u = ~(*(DWORD*)&cwork[0]);
                    DWORD inv_hi_u = ~(*(DWORD*)&cwork[4]);
                    DWORD* p0 = (DWORD*)grp;                            // BANK0L
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[8 + pl*8 + 0] |= p0[pl*2 + 0] & inv_lo_u;
                        *(DWORD*)&cwork[8 + pl*8 + 4] |= p0[pl*2 + 1] & inv_hi_u;
                    }
                    DWORD* p1l = (DWORD*)(grp + GRAM_HALFSTEP * 2);     // BANK1L
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[32 + pl*8 + 0] = p1l[pl*2 + 0] & inv_lo_u;
                        *(DWORD*)&cwork[32 + pl*8 + 4] = p1l[pl*2 + 1] & inv_hi_u;
                    }
                    // Lower: BANK0H + BANK1H
                    DWORD inv_lo_l = ~(*(DWORD*)&cwork[64]);
                    DWORD inv_hi_l = ~(*(DWORD*)&cwork[68]);
                    DWORD* p0h = (DWORD*)(grp + GRAM_HALFSTEP);         // BANK0H
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[72 + pl*8 + 0] |= p0h[pl*2 + 0] & inv_lo_l;
                        *(DWORD*)&cwork[72 + pl*8 + 4] |= p0h[pl*2 + 1] & inv_hi_l;
                    }
                    DWORD* p1h = (DWORD*)(grp + GRAM_HALFSTEP * 3);     // BANK1H
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[96 + pl*8 + 0] = p1h[pl*2 + 0] & inv_lo_l;
                        *(DWORD*)&cwork[96 + pl*8 + 4] = p1h[pl*2 + 1] & inv_hi_l;
                    }
                }
            }

            grphtxtout_64_128(scr_off, vyl);
        }

        // VRAMADRRESS_INC
        tram_pos++;
        scr_off += 8;
        col++;
        if (col >= cols) {
            if (updatetmp[(tram_pos - 1) & (TRAM_MAX / 2 - 1)] & 0x04) {
                fontycnt = (BYTE)((fontycnt + vyl) & 0x0F);
            } else {
                fontycnt = (BYTE)((vyl * 2) & 0x0F);
            }
            if (newline) {
                for (int j = 0; j < vyl * 2; j++) {
                    if (yp + j < SCREEN_HEIGHT)
                        renewalline[yp + j] |= 3;
                }
            }
            yp += vyl * 2;
            newline = 0;
            col = 0;
            scr_off = yp * SCREEN_WIDTH;
        }
    }
    if (newline && col > 0) {
        for (int j = 0; j < vyl * 2; j++) {
            if (yp + j < SCREEN_HEIGHT)
                renewalline[yp + j] |= 3;
        }
    }
}

// width80x25_64s: 80桁×25行 64色モード (640×200 倍ライン)
// origsrc DRAW64.CPP:843-1179
// width40x25_64s との違い:
// - GRP_RAM[addr*32+GRAM_BANK0+8] 直接アクセス (dispp不使用)
// - 上位バンク: +GRAM_SIZE (0x10000 = BANK1) vs +GRAM_HALFSTEP (0x8000)
// - TRAM上限: TRAM_MAX vs TRAM_MAX/2
// - updatetmp: &= ~UPDATE_VRAM vs &= ~dispflg
void width80x25_64s(void) {
    fontycnt = 0;
    WORD tram_pos = crtc.TXT_TOP;
    int total_chars = (int)vramsize;
    if (total_chars <= 0) return;
    int cols = (int)crtc.TXT_XL;
    if (cols <= 0) cols = 80;
    int vyl = (int)vramylpcnt;
    if (vyl <= 0) vyl = 8;

    int col = 0;
    int scr_off = 0;
    BYTE newline = 0;
    int yp = 0;
    BYTE row_fontycnt = fontycnt;

    for (int i = 0; i < total_chars; i++) {
        WORD addr = (WORD)(tram_pos & (TRAM_MAX - 1));
        if (addr >= TRAM_MAX) break;

        BYTE upt = updatetmp[addr];
        if (upt & UPDATE_VRAM) {
            updatetmp[addr] &= (BYTE)(~UPDATE_VRAM);
            newline = 1;

            BYTE attr = TXT_RAM[addr + TEXT_ATR];
            if (attr & blinktest) attr ^= X1ATR_REVERSE;
            BYTE text_color = attr & 0x0F;

            // GRP_RAM: BANK0 + addr*32 + PLANE_B (dispp不使用)
            BYTE* grp = &GRP_RAM[(DWORD)addr * 32 + GRAM_BANK0 + PLANE_B];

            if (text_color == 0) {
                // grphonly
                *(DWORD*)&cwork[0] = 0;
                *(DWORD*)&cwork[4] = 0;
                memcpy(&cwork[8], grp, 24);                // BANK0
                memcpy(&cwork[32], grp + GRAM_SIZE, 24);   // BANK1
            } else {
                BYTE eff4 = (BYTE)(upt & 0x0F);
                WORD src_addr = addr;
                if (upt & 0x10) src_addr = (WORD)((addr - 1) & (TRAM_MAX - 1));
                BYTE char_code = TXT_RAM[src_addr + TEXT_ANK];
                BYTE knj_code = TXT_RAM[src_addr + TEXT_KNJ];
                BYTE color = attr & X1ATR_COLOR;
                bool reverse = (attr & X1ATR_REVERSE) != 0;

                if (knj_code & 0x80) {
                    WORD jis_adr = ((WORD)knj_code << 8) | char_code;
                    BYTE* kfont = getfontjis(adr2jis_x1t(jis_adr));
                    if (knj_code & 0x40) kfont++;
                    for (int y = 0; y < 8 && y < vyl; y++)
                        cwork[y] = effect8_fetch_knj(kfont, eff4, row_fontycnt, y);
                } else {
                    for (int y = 0; y < 8 && y < vyl; y++)
                        cwork[y] = effect8_fetch(ANK_FNT[char_code], eff4, row_fontycnt, y);
                }
                for (int y = 8; y < vyl; y++) cwork[y] = 0;

                fill_cwork_text_planes_64(color, reverse);

                if (text_color == 0x08) {
                    for (int y = 0; y < vyl; y++) cwork[y] = 0xFF;
                }

                if (crtc.ZPRY & 1) {
                    // txtdwn: グラフィックス上
                    DWORD mask_lo, mask_hi;
                    // BANK0 + BANK1 のマスク生成
                    DWORD* p0 = (DWORD*)grp;
                    mask_lo  = p0[0]; mask_hi  = p0[1];
                    mask_lo |= p0[2]; mask_hi |= p0[3];
                    mask_lo |= p0[4]; mask_hi |= p0[5];
                    DWORD* p1 = (DWORD*)(grp + GRAM_SIZE);
                    mask_lo |= p1[0]; mask_hi |= p1[1];
                    mask_lo |= p1[2]; mask_hi |= p1[3];
                    mask_lo |= p1[4]; mask_hi |= p1[5];
                    DWORD inv_lo = ~mask_lo;
                    DWORD inv_hi = ~mask_hi;
                    // BANK0: テキストをマスク + グラフィックスをOR
                    for (int pl = 0; pl < 3; pl++) {
                        DWORD* cw = (DWORD*)&cwork[8 + pl * 8];
                        cw[0] = (cw[0] & inv_lo) | p0[pl * 2 + 0];
                        cw[1] = (cw[1] & inv_hi) | p0[pl * 2 + 1];
                    }
                    // BANK1: 直接コピー
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[32 + pl * 8 + 0] = p1[pl * 2 + 0];
                        *(DWORD*)&cwork[32 + pl * 8 + 4] = p1[pl * 2 + 1];
                    }
                    *(DWORD*)&cwork[0] &= inv_lo;
                    *(DWORD*)&cwork[4] &= inv_hi;
                } else {
                    // txtup: テキスト上
                    DWORD inv_lo = ~(*(DWORD*)&cwork[0]);
                    DWORD inv_hi = ~(*(DWORD*)&cwork[4]);
                    DWORD* p0 = (DWORD*)grp;
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[8 + pl * 8 + 0] |= p0[pl * 2 + 0] & inv_lo;
                        *(DWORD*)&cwork[8 + pl * 8 + 4] |= p0[pl * 2 + 1] & inv_hi;
                    }
                    DWORD* p1 = (DWORD*)(grp + GRAM_SIZE);
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[32 + pl * 8 + 0] = p1[pl * 2 + 0] & inv_lo;
                        *(DWORD*)&cwork[32 + pl * 8 + 4] = p1[pl * 2 + 1] & inv_hi;
                    }
                }
            }

            grphtxtout_64(scr_off, vyl);
        }

        tram_pos++;
        scr_off += 8;
        col++;
        if (col >= cols) {
            if (updatetmp[(tram_pos - 1) & (TRAM_MAX - 1)] & 0x04) {
                fontycnt = (BYTE)((fontycnt + vyl) & 0x0F);
            } else {
                fontycnt = (BYTE)((vyl * 2) & 0x0F);
            }
            row_fontycnt = fontycnt;
            if (newline) {
                for (int j = 0; j < vyl * 2; j++) {
                    if (yp + j < SCREEN_HEIGHT)
                        renewalline[yp + j] |= 3;
                }
            }
            yp += vyl * 2;
            newline = 0;
            col = 0;
            scr_off = yp * SCREEN_WIDTH;
        }
    }
    if (newline && col > 0) {
        for (int j = 0; j < vyl * 2; j++) {
            if (yp + j < SCREEN_HEIGHT)
                renewalline[yp + j] |= 3;
        }
    }
}

// width40x12_64l: 40桁×12行 64色ローレゾ (320×100 ×4倍)
// origsrc DRAW64L.CPP:46-418
// dispp ベース、BANK0L+BANK0H の2バンク、上下同一データ
// updatetmp: &= ~dispflg
void width40x12_64l(void) {
    fontycnt = 0;
    WORD tram_pos = crtc.TXT_TOP;
    int total_chars = (int)vramsize;
    if (total_chars <= 0) return;
    int cols = (int)crtc.TXT_XL;
    if (cols <= 0) cols = 40;
    int vyl = (int)vramylpcnt;
    if (vyl <= 0) vyl = 8;

    int col = 0;
    int scr_off = 0;
    BYTE newline = 0;
    int yp = 0;

    for (int i = 0; i < total_chars; i++) {
        WORD addr = (WORD)(tram_pos & (TRAM_MAX / 2 - 1));
        if (addr >= TRAM_MAX / 2) break;

        BYTE upt = updatetmp[addr];
        if (upt & dispflg) {
            updatetmp[addr] &= (BYTE)(~dispflg);
            newline = 1;

            BYTE attr = TXT_RAM[addr + TEXT_ATR];
            if (attr & blinktest) attr ^= X1ATR_REVERSE;
            BYTE text_color = attr & 0x0F;

            // dispp ベース: BANK0L (dispp) + BANK0H (dispp + GRAM_HALFSTEP)
            BYTE* grp = dispp + (DWORD)addr * 32 + PLANE_B;

            if (text_color == 0) {
                // grphonly: 上下同一データ
                *(DWORD*)&cwork[0] = 0;
                *(DWORD*)&cwork[4] = 0;
                memcpy(&cwork[8], grp, 24);                        // BANK0L
                memcpy(&cwork[32], grp + GRAM_HALFSTEP, 24);       // BANK0H
                *(DWORD*)&cwork[64] = 0;
                *(DWORD*)&cwork[68] = 0;
                memcpy(&cwork[72], grp, 24);                        // BANK0L (same)
                memcpy(&cwork[96], grp + GRAM_HALFSTEP, 24);       // BANK0H (same)
            } else {
                WORD src_addr = addr;
                if (upt & 0x10) src_addr = (WORD)((addr - 1) & (TRAM_MAX / 2 - 1));
                BYTE char_code = TXT_RAM[src_addr + TEXT_ANK];
                BYTE knj_code = TXT_RAM[src_addr + TEXT_KNJ];
                BYTE color = attr & X1ATR_COLOR;
                bool reverse = (attr & X1ATR_REVERSE) != 0;

                if (knj_code & 0x80) {
                    WORD jis_adr = ((WORD)knj_code << 8) | char_code;
                    BYTE* kfont = getfontjis(adr2jis_x1t(jis_adr));
                    if (knj_code & 0x40) kfont++;
                    for (int y = 0; y < 8 && y < vyl; y++) {
                        cwork[y]      = kfont[(y * 2) & 31];
                        cwork[64 + y] = kfont[((y + 8) * 2) & 31];
                    }
                } else {
                    BYTE* fnt16 = &KNJ_FNT[(WORD)char_code * 16];
                    for (int y = 0; y < 8 && y < vyl; y++) {
                        cwork[y]      = fnt16[y];
                        cwork[64 + y] = fnt16[y + 8];
                    }
                }
                for (int y = 8; y < vyl; y++) {
                    cwork[y] = 0;
                    cwork[64 + y] = 0;
                }

                fill_cwork_text_planes_64_128(color, reverse);

                if (text_color == 0x08) {
                    for (int y = 0; y < 8; y++) {
                        cwork[y] = 0xFF;
                        cwork[64 + y] = 0xFF;
                    }
                }

                if (crtc.ZPRY & 1) {
                    // txtdwn: mask from BANK0L+BANK0H, 上下同一処理
                    DWORD* p0 = (DWORD*)grp;
                    DWORD ml = p0[0]; DWORD mh = p0[1];
                    ml |= p0[2]; mh |= p0[3];
                    ml |= p0[4]; mh |= p0[5];
                    DWORD* p0h = (DWORD*)(grp + GRAM_HALFSTEP);
                    ml |= p0h[0]; mh |= p0h[1];
                    ml |= p0h[2]; mh |= p0h[3];
                    ml |= p0h[4]; mh |= p0h[5];
                    DWORD inv_lo = ~ml, inv_hi = ~mh;
                    // 上下同一: BANK0L → cwork[8..31] & cwork[72..95]
                    for (int pl = 0; pl < 3; pl++) {
                        DWORD bl = p0[pl * 2 + 0], bh = p0[pl * 2 + 1];
                        *(DWORD*)&cwork[8 + pl*8 + 0] = (*(DWORD*)&cwork[8 + pl*8 + 0] & inv_lo) | bl;
                        *(DWORD*)&cwork[8 + pl*8 + 4] = (*(DWORD*)&cwork[8 + pl*8 + 4] & inv_hi) | bh;
                        *(DWORD*)&cwork[72 + pl*8 + 0] = (*(DWORD*)&cwork[72 + pl*8 + 0] & inv_lo) | bl;
                        *(DWORD*)&cwork[72 + pl*8 + 4] = (*(DWORD*)&cwork[72 + pl*8 + 4] & inv_hi) | bh;
                    }
                    // BANK0H → cwork[32..55] & cwork[96..119]
                    for (int pl = 0; pl < 3; pl++) {
                        DWORD bl = p0h[pl * 2 + 0], bh = p0h[pl * 2 + 1];
                        *(DWORD*)&cwork[32 + pl*8 + 0] = bl;
                        *(DWORD*)&cwork[32 + pl*8 + 4] = bh;
                        *(DWORD*)&cwork[96 + pl*8 + 0] = bl;
                        *(DWORD*)&cwork[96 + pl*8 + 4] = bh;
                    }
                    *(DWORD*)&cwork[0] &= inv_lo;
                    *(DWORD*)&cwork[4] &= inv_hi;
                    *(DWORD*)&cwork[64] &= inv_lo;
                    *(DWORD*)&cwork[68] &= inv_hi;
                } else {
                    // txtup: 上下別テキストマスクで同一GRAMを適用
                    DWORD inv_lo_u = ~(*(DWORD*)&cwork[0]);
                    DWORD inv_hi_u = ~(*(DWORD*)&cwork[4]);
                    DWORD* p0 = (DWORD*)grp;
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[8 + pl*8 + 0] |= p0[pl*2 + 0] & inv_lo_u;
                        *(DWORD*)&cwork[8 + pl*8 + 4] |= p0[pl*2 + 1] & inv_hi_u;
                    }
                    DWORD* p0h = (DWORD*)(grp + GRAM_HALFSTEP);
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[32 + pl*8 + 0] = p0h[pl*2 + 0] & inv_lo_u;
                        *(DWORD*)&cwork[32 + pl*8 + 4] = p0h[pl*2 + 1] & inv_hi_u;
                    }
                    // Lower: 同じ GRAM、下半分のテキストマスク使用
                    DWORD inv_lo_l = ~(*(DWORD*)&cwork[64]);
                    DWORD inv_hi_l = ~(*(DWORD*)&cwork[68]);
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[72 + pl*8 + 0] |= p0[pl*2 + 0] & inv_lo_l;
                        *(DWORD*)&cwork[72 + pl*8 + 4] |= p0[pl*2 + 1] & inv_hi_l;
                    }
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[96 + pl*8 + 0] = p0h[pl*2 + 0] & inv_lo_l;
                        *(DWORD*)&cwork[96 + pl*8 + 4] = p0h[pl*2 + 1] & inv_hi_l;
                    }
                }
            }

            grphtxtout_64_128_x4(scr_off, vyl);
        }

        // VRAMADRRESS_INC2
        tram_pos++;
        scr_off += 8;
        col++;
        if (col >= cols) {
            if (updatetmp[(tram_pos - 1) & (TRAM_MAX / 2 - 1)] & 0x04) {
                fontycnt = (BYTE)((fontycnt + vyl) & 0x0F);
            } else {
                fontycnt = (BYTE)((vyl * 2) & 0x0F);
            }
            if (newline) {
                for (int j = 0; j < vyl * 4; j++) {
                    if (yp + j < SCREEN_HEIGHT)
                        renewalline[yp + j] |= 3;
                }
            }
            yp += vyl * 4;
            newline = 0;
            col = 0;
            scr_off = yp * SCREEN_WIDTH;
        }
    }
    if (newline && col > 0) {
        for (int j = 0; j < vyl * 4; j++) {
            if (yp + j < SCREEN_HEIGHT)
                renewalline[yp + j] |= 3;
        }
    }
}

// cwork8_to_pixels: 8プレーン (BIT7,B,R,G,B2,R2,G2,BIT6) → pixel DWORD pair
// width40x12_64x2 / width40x25_64x2 用 (2面合成モード)
static inline void cwork8_to_pixels(int base, int y, DWORD& left, DWORD& right) {
    left  = bmp2byte_table[20][cwork[base + y + 0] * 2];     // BIT7
    right = bmp2byte_table[20][cwork[base + y + 0] * 2 + 1];
    left  |= bmp2byte_table[16][cwork[base + y + 8] * 2];    // BLUE
    right |= bmp2byte_table[16][cwork[base + y + 8] * 2 + 1];
    left  |= bmp2byte_table[17][cwork[base + y + 16] * 2];   // RED
    right |= bmp2byte_table[17][cwork[base + y + 16] * 2 + 1];
    left  |= bmp2byte_table[18][cwork[base + y + 24] * 2];   // GREEN
    right |= bmp2byte_table[18][cwork[base + y + 24] * 2 + 1];
    left  |= bmp2byte_table[1][cwork[base + y + 32] * 2];    // BLUE2
    right |= bmp2byte_table[1][cwork[base + y + 32] * 2 + 1];
    left  |= bmp2byte_table[2][cwork[base + y + 40] * 2];    // RED2
    right |= bmp2byte_table[2][cwork[base + y + 40] * 2 + 1];
    left  |= bmp2byte_table[4][cwork[base + y + 48] * 2];    // GREEN2
    right |= bmp2byte_table[4][cwork[base + y + 48] * 2 + 1];
    left  |= bmp2byte_table[19][cwork[base + y + 56] * 2];   // BIT6
    right |= bmp2byte_table[19][cwork[base + y + 56] * 2 + 1];
}

// grphtxtout_64x2_56: 56-byte cwork (8プレーン) → screenmap (×2倍)
// width40x25_64x2 用 (25行, 各行 vyl*2 スキャンライン)
// origsrc DRAW64.CPP:793-828 の grphtxtout ループ
static void grphtxtout_64x2_56(int scr_off, int vyl) {
    for (int y = 0; y < vyl; y++) {
        DWORD left, right;
        cwork8_to_pixels(0, y, left, right);
        int off0 = scr_off + y * 2 * SCREEN_WIDTH;
        int off1 = off0 + SCREEN_WIDTH;
        if (off0 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
            *(DWORD*)&screenmap[off0 + 0] = left;
            *(DWORD*)&screenmap[off0 + 4] = right;
        }
        if (off1 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
            *(DWORD*)&screenmap[off1 + 0] = left;
            *(DWORD*)&screenmap[off1 + 4] = right;
        }
    }
}

// grphtxtout_64x2_128_x4: 128-byte cwork (8プレーン) → screenmap (×4倍)
static void grphtxtout_64x2_128_x4(int scr_off, int vyl) {
    for (int y = 0; y < vyl; y++) {
        DWORD left_u, right_u, left_l, right_l;
        cwork8_to_pixels(0, y, left_u, right_u);
        cwork8_to_pixels(64, y, left_l, right_l);
        int off0 = scr_off + y * 4 * SCREEN_WIDTH;
        if (off0 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
            *(DWORD*)&screenmap[off0 + 0] = left_u;
            *(DWORD*)&screenmap[off0 + 4] = right_u;
        }
        int off1 = off0 + SCREEN_WIDTH;
        if (off1 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
            *(DWORD*)&screenmap[off1 + 0] = left_u;
            *(DWORD*)&screenmap[off1 + 4] = right_u;
        }
        int off2 = off0 + SCREEN_WIDTH * 2;
        if (off2 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
            *(DWORD*)&screenmap[off2 + 0] = left_l;
            *(DWORD*)&screenmap[off2 + 4] = right_l;
        }
        int off3 = off0 + SCREEN_WIDTH * 3;
        if (off3 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
            *(DWORD*)&screenmap[off3 + 0] = left_l;
            *(DWORD*)&screenmap[off3 + 4] = right_l;
        }
    }
}

// apply_surface_masked: 1面分の GRAM データを mask 付きで cwork にマージ
// base: cwork開始オフセット (0 or 64)
// grp: GRAM PLANE_B ポインタ
// inv_lo, inv_hi: 適用マスク (~higher_priority_mask)
// mode: 0=OR merge, 1=replace
static inline void apply_surface_masked(int base, BYTE* grp, DWORD inv_lo, DWORD inv_hi, int mode) {
    DWORD* p0 = (DWORD*)grp;
    DWORD* p0h = (DWORD*)(grp + GRAM_HALFSTEP);
    if (mode == 0) {
        for (int pl = 0; pl < 3; pl++) {
            *(DWORD*)&cwork[base + 8 + pl*8 + 0] |= p0[pl*2] & inv_lo;
            *(DWORD*)&cwork[base + 8 + pl*8 + 4] |= p0[pl*2+1] & inv_hi;
        }
        for (int pl = 0; pl < 3; pl++) {
            *(DWORD*)&cwork[base + 32 + pl*8 + 0] |= p0h[pl*2] & inv_lo;
            *(DWORD*)&cwork[base + 32 + pl*8 + 4] |= p0h[pl*2+1] & inv_hi;
        }
    } else {
        for (int pl = 0; pl < 3; pl++) {
            *(DWORD*)&cwork[base + 8 + pl*8 + 0] = p0[pl*2] & inv_lo;
            *(DWORD*)&cwork[base + 8 + pl*8 + 4] = p0[pl*2+1] & inv_hi;
        }
        for (int pl = 0; pl < 3; pl++) {
            *(DWORD*)&cwork[base + 32 + pl*8 + 0] = p0h[pl*2] & inv_lo;
            *(DWORD*)&cwork[base + 32 + pl*8 + 4] = p0h[pl*2+1] & inv_hi;
        }
    }
}

// get_grph_mask: 6プレーン分の OR マスクを取得
static inline void get_grph_mask(BYTE* grp, DWORD& ml, DWORD& mh) {
    DWORD* p0 = (DWORD*)grp;
    ml = p0[0]; mh = p0[1];
    ml |= p0[2]; mh |= p0[3];
    ml |= p0[4]; mh |= p0[5];
    DWORD* p0h = (DWORD*)(grp + GRAM_HALFSTEP);
    ml |= p0h[0]; mh |= p0h[1];
    ml |= p0h[2]; mh |= p0h[3];
    ml |= p0h[4]; mh |= p0h[5];
}

// width40x12_64x2: 40桁×12行 64色×2面ローレゾ (320×100 ×4倍)
// origsrc DRAW64L.CPP:422-978
// dispp/dispp2 の2面合成、8プレーン (BIT7+6色+BIT6)
// updatetmp: &= ~UPDATE_VRAM
void width40x12_64x2(void) {
    fontycnt = 0;
    WORD tram_pos = crtc.TXT_TOP;
    int total_chars = (int)vramsize;
    if (total_chars <= 0) return;
    int cols = (int)crtc.TXT_XL;
    if (cols <= 0) cols = 40;
    int vyl = (int)vramylpcnt;
    if (vyl <= 0) vyl = 8;

    int col = 0;
    int scr_off = 0;
    BYTE newline = 0;
    int yp = 0;

    for (int i = 0; i < total_chars; i++) {
        WORD addr = (WORD)(tram_pos & (TRAM_MAX / 2 - 1));
        if (addr >= TRAM_MAX / 2) break;

        BYTE upt = updatetmp[addr];
        if (upt & UPDATE_VRAM) {
            updatetmp[addr] &= (BYTE)(~UPDATE_VRAM);
            newline = 1;

            BYTE attr = TXT_RAM[addr + TEXT_ATR];
            if (attr & blinktest) attr ^= X1ATR_REVERSE;
            BYTE text_color = attr & 0x0F;

            DWORD gram_off = (DWORD)addr * 32 + PLANE_B;
            BYTE* grp1 = dispp + gram_off;    // Surface 1
            BYTE* grp2 = dispp2 + gram_off;   // Surface 2

            if (text_color == 0) {
                // grphonly: Surface1 → cwork, Surface2 below
                *(DWORD*)&cwork[0] = 0;
                *(DWORD*)&cwork[4] = 0;
                *(DWORD*)&cwork[64] = 0;
                *(DWORD*)&cwork[68] = 0;
                // Surface 1 → cwork (collect mask)
                DWORD s1_ml, s1_mh;
                get_grph_mask(grp1, s1_ml, s1_mh);
                DWORD* p1 = (DWORD*)grp1;
                DWORD* p1h = (DWORD*)(grp1 + GRAM_HALFSTEP);
                for (int pl = 0; pl < 3; pl++) {
                    *(DWORD*)&cwork[8 + pl*8 + 0] = p1[pl*2];
                    *(DWORD*)&cwork[8 + pl*8 + 4] = p1[pl*2+1];
                    *(DWORD*)&cwork[72 + pl*8 + 0] = p1[pl*2];
                    *(DWORD*)&cwork[72 + pl*8 + 4] = p1[pl*2+1];
                }
                for (int pl = 0; pl < 3; pl++) {
                    *(DWORD*)&cwork[32 + pl*8 + 0] = p1h[pl*2];
                    *(DWORD*)&cwork[32 + pl*8 + 4] = p1h[pl*2+1];
                    *(DWORD*)&cwork[96 + pl*8 + 0] = p1h[pl*2];
                    *(DWORD*)&cwork[96 + pl*8 + 4] = p1h[pl*2+1];
                }
                // Surface 2 below (masked by ~surface1_mask)
                DWORD inv_lo = ~s1_ml, inv_hi = ~s1_mh;
                apply_surface_masked(0, grp2, inv_lo, inv_hi, 0);
                apply_surface_masked(64, grp2, inv_lo, inv_hi, 0);
                // BIT6 = ~surface1_mask (surface 2 area marker)
                *(DWORD*)&cwork[56] = inv_lo;
                *(DWORD*)&cwork[60] = inv_hi;
                *(DWORD*)&cwork[120] = inv_lo;
                *(DWORD*)&cwork[124] = inv_hi;
            } else {
                // Text + Graphics (2面合成)
                WORD src_addr = addr;
                if (upt & 0x10) src_addr = (WORD)((addr - 1) & (TRAM_MAX / 2 - 1));
                BYTE char_code = TXT_RAM[src_addr + TEXT_ANK];
                BYTE knj_code = TXT_RAM[src_addr + TEXT_KNJ];
                BYTE color = attr & X1ATR_COLOR;
                bool reverse = (attr & X1ATR_REVERSE) != 0;

                if (knj_code & 0x80) {
                    WORD jis_adr = ((WORD)knj_code << 8) | char_code;
                    BYTE* kfont = getfontjis(adr2jis_x1t(jis_adr));
                    if (knj_code & 0x40) kfont++;
                    for (int y = 0; y < 8 && y < vyl; y++) {
                        cwork[y]      = kfont[(y * 2) & 31];
                        cwork[64 + y] = kfont[((y + 8) * 2) & 31];
                    }
                } else {
                    BYTE* fnt16 = &KNJ_FNT[(WORD)char_code * 16];
                    for (int y = 0; y < 8 && y < vyl; y++) {
                        cwork[y]      = fnt16[y];
                        cwork[64 + y] = fnt16[y + 8];
                    }
                }
                for (int y = 8; y < vyl; y++) { cwork[y] = 0; cwork[64 + y] = 0; }

                fill_cwork_text_planes_64_128(color, reverse);

                if (text_color == 0x08) {
                    for (int y = 0; y < 8; y++) { cwork[y] = 0xFF; cwork[64 + y] = 0xFF; }
                }

                BYTE zpry = crtc.ZPRY & 3;
                DWORD s1_ml, s1_mh, s2_ml, s2_mh;
                get_grph_mask(grp1, s1_ml, s1_mh);
                get_grph_mask(grp2, s2_ml, s2_mh);

                if (zpry == 0) {
                    // txtomoura: Text(top) → Surface1(mid) → Surface2(bottom)
                    for (int half = 0; half < 2; half++) {
                        int b = half * 64;
                        DWORD txt_lo = *(DWORD*)&cwork[b], txt_hi = *(DWORD*)&cwork[b + 4];
                        DWORD inv_txt_lo = ~txt_lo, inv_txt_hi = ~txt_hi;
                        // Surface 1 under text
                        apply_surface_masked(b, grp1, inv_txt_lo, inv_txt_hi, 0);
                        // Surface 2 under (text | surface1)
                        DWORD combined_lo = ~(txt_lo | s1_ml);
                        DWORD combined_hi = ~(txt_hi | s1_mh);
                        apply_surface_masked(b, grp2, combined_lo, combined_hi, 0);
                        // BIT6 = final mask
                        *(DWORD*)&cwork[b + 56] = combined_lo;
                        *(DWORD*)&cwork[b + 60] = combined_hi;
                    }
                } else if (!(zpry & 2)) {
                    // omouratxt: Surface2(top) → Text+Surface1(bottom)
                    for (int half = 0; half < 2; half++) {
                        int b = half * 64;
                        DWORD txt_lo = *(DWORD*)&cwork[b], txt_hi = *(DWORD*)&cwork[b + 4];
                        // Surface 2 mask → BIT6 placeholder
                        *(DWORD*)&cwork[b + 56] = s2_ml;
                        *(DWORD*)&cwork[b + 60] = s2_mh;
                        // Surface 2 on top (txtdwn on text)
                        DWORD inv_s2_lo = ~s2_ml, inv_s2_hi = ~s2_mh;
                        DWORD* p2 = (DWORD*)grp2;
                        DWORD* p2h = (DWORD*)(grp2 + GRAM_HALFSTEP);
                        for (int pl = 0; pl < 3; pl++) {
                            DWORD* cw = (DWORD*)&cwork[b + 8 + pl*8];
                            cw[0] = (cw[0] & inv_s2_lo) | p2[pl*2];
                            cw[1] = (cw[1] & inv_s2_hi) | p2[pl*2+1];
                        }
                        for (int pl = 0; pl < 3; pl++) {
                            *(DWORD*)&cwork[b + 32 + pl*8 + 0] = p2h[pl*2];
                            *(DWORD*)&cwork[b + 32 + pl*8 + 4] = p2h[pl*2+1];
                        }
                        *(DWORD*)&cwork[b] &= inv_s2_lo;
                        *(DWORD*)&cwork[b + 4] &= inv_s2_hi;
                        // Surface 1 under (surface2 | text)
                        DWORD combined_lo = ~(*(DWORD*)&cwork[b] | s2_ml);
                        DWORD combined_hi = ~(*(DWORD*)&cwork[b + 4] | s2_mh);
                        apply_surface_masked(b, grp1, combined_lo, combined_hi, 0);
                        // Update BIT6
                        *(DWORD*)&cwork[b + 56] &= ~s1_ml;
                        *(DWORD*)&cwork[b + 60] &= ~s1_mh;
                    }
                } else {
                    // txtandgrph1: Surface1(top) → Text(mid) → Surface2(bottom)
                    for (int half = 0; half < 2; half++) {
                        int b = half * 64;
                        DWORD txt_lo = *(DWORD*)&cwork[b], txt_hi = *(DWORD*)&cwork[b + 4];
                        // Surface 1 on top of text (txtdwn-style)
                        DWORD inv_s1_lo = ~s1_ml, inv_s1_hi = ~s1_mh;
                        DWORD* p1 = (DWORD*)grp1;
                        DWORD* p1h = (DWORD*)(grp1 + GRAM_HALFSTEP);
                        for (int pl = 0; pl < 3; pl++) {
                            DWORD* cw = (DWORD*)&cwork[b + 8 + pl*8];
                            cw[0] = (cw[0] & inv_s1_lo) | p1[pl*2];
                            cw[1] = (cw[1] & inv_s1_hi) | p1[pl*2+1];
                        }
                        for (int pl = 0; pl < 3; pl++) {
                            *(DWORD*)&cwork[b + 32 + pl*8 + 0] = p1h[pl*2];
                            *(DWORD*)&cwork[b + 32 + pl*8 + 4] = p1h[pl*2+1];
                        }
                        *(DWORD*)&cwork[b] &= inv_s1_lo;
                        *(DWORD*)&cwork[b + 4] &= inv_s1_hi;
                        // Surface 2 under (surface1 | text)
                        DWORD combined_lo = ~(*(DWORD*)&cwork[b] | s1_ml);
                        DWORD combined_hi = ~(*(DWORD*)&cwork[b + 4] | s1_mh);
                        apply_surface_masked(b, grp2, combined_lo, combined_hi, 0);
                        // BIT6 = final mask
                        *(DWORD*)&cwork[b + 56] = combined_lo;
                        *(DWORD*)&cwork[b + 60] = combined_hi;
                    }
                }
            }

            grphtxtout_64x2_128_x4(scr_off, vyl);
        }

        // VRAMADRRESS_INC2
        tram_pos++;
        scr_off += 8;
        col++;
        if (col >= cols) {
            if (updatetmp[(tram_pos - 1) & (TRAM_MAX / 2 - 1)] & 0x04) {
                fontycnt = (BYTE)((fontycnt + vyl) & 0x0F);
            } else {
                fontycnt = (BYTE)((vyl * 2) & 0x0F);
            }
            if (newline) {
                for (int j = 0; j < vyl * 4; j++) {
                    if (yp + j < SCREEN_HEIGHT)
                        renewalline[yp + j] |= 3;
                }
            }
            yp += vyl * 4;
            newline = 0;
            col = 0;
            scr_off = yp * SCREEN_WIDTH;
        }
    }
    if (newline && col > 0) {
        for (int j = 0; j < vyl * 4; j++) {
            if (yp + j < SCREEN_HEIGHT)
                renewalline[yp + j] |= 3;
        }
    }
}

// ============================================================================
// 4096色 12行ヘルパー (width40x12_4096 用、256バイト cwork)
// ============================================================================
//
// cwork layout (256 bytes):
// Upper half (base 0): [0..7]:TG [8..15]:B3 [16..23]:B2 [24..31]:B1 [32..39]:B0
// Lower half (base 64): [64..71]:TG [72..79]:B3 [80..87]:B2 [88..95]:B1 [96..103]:B0
// R/G upper (base 128): R0(128),G0(136),R1(144),G1(152),R2(160),G2(168),R3(176),G3(184)
// R/G lower (base 192): R0(192),G0(200),R1(208),G1(216),R2(224),G2(232),R3(240),G3(248)

// grphtxtout_4096_256_x4: 256バイト cwork → screenmap 左右分割書込み (×4出力)
// 各フォント行 y → scanline 0,1 (upper) + scanline 2,3 (lower)
static void grphtxtout_4096_256_x4(int scr_off, int vyl) {
    for (int y = 0; y < vyl; y++) {
        // Upper half → scanlines 0, 1
        DWORD rl, rr, ll, lr;
        rl = bmp2byte_table[2][cwork[0+y]*2];
        rr = bmp2byte_table[2][cwork[0+y]*2+1];
        rl |= bmp2byte_table[1][cwork[136+y]*2]; rr |= bmp2byte_table[1][cwork[136+y]*2+1];
        rl |= bmp2byte_table[18][cwork[152+y]*2]; rr |= bmp2byte_table[18][cwork[152+y]*2+1];
        rl |= bmp2byte_table[17][cwork[168+y]*2]; rr |= bmp2byte_table[17][cwork[168+y]*2+1];
        rl |= bmp2byte_table[16][cwork[184+y]*2]; rr |= bmp2byte_table[16][cwork[184+y]*2+1];
        ll = bmp2byte_table[16][cwork[8+y]*2];
        lr = bmp2byte_table[16][cwork[8+y]*2+1];
        ll |= bmp2byte_table[17][cwork[16+y]*2]; lr |= bmp2byte_table[17][cwork[16+y]*2+1];
        ll |= bmp2byte_table[18][cwork[24+y]*2]; lr |= bmp2byte_table[18][cwork[24+y]*2+1];
        ll |= bmp2byte_table[1][cwork[32+y]*2]; lr |= bmp2byte_table[1][cwork[32+y]*2+1];
        ll |= bmp2byte_table[20][cwork[128+y]*2]; lr |= bmp2byte_table[20][cwork[128+y]*2+1];
        ll |= bmp2byte_table[19][cwork[144+y]*2]; lr |= bmp2byte_table[19][cwork[144+y]*2+1];
        ll |= bmp2byte_table[4][cwork[160+y]*2]; lr |= bmp2byte_table[4][cwork[160+y]*2+1];
        ll |= bmp2byte_table[2][cwork[176+y]*2]; lr |= bmp2byte_table[2][cwork[176+y]*2+1];
        int off0 = scr_off + y * 4 * SCREEN_WIDTH;
        int off1 = off0 + SCREEN_WIDTH;
        if (off0 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
            *(DWORD*)&screenmap[off0+0] = ll; *(DWORD*)&screenmap[off0+4] = lr;
            *(DWORD*)&screenmap[off0+320] = rl; *(DWORD*)&screenmap[off0+324] = rr;
        }
        if (off1 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
            *(DWORD*)&screenmap[off1+0] = ll; *(DWORD*)&screenmap[off1+4] = lr;
            *(DWORD*)&screenmap[off1+320] = rl; *(DWORD*)&screenmap[off1+324] = rr;
        }

        // Lower half → scanlines 2, 3
        rl = bmp2byte_table[2][cwork[64+y]*2];
        rr = bmp2byte_table[2][cwork[64+y]*2+1];
        rl |= bmp2byte_table[1][cwork[200+y]*2]; rr |= bmp2byte_table[1][cwork[200+y]*2+1];
        rl |= bmp2byte_table[18][cwork[216+y]*2]; rr |= bmp2byte_table[18][cwork[216+y]*2+1];
        rl |= bmp2byte_table[17][cwork[232+y]*2]; rr |= bmp2byte_table[17][cwork[232+y]*2+1];
        rl |= bmp2byte_table[16][cwork[248+y]*2]; rr |= bmp2byte_table[16][cwork[248+y]*2+1];
        ll = bmp2byte_table[16][cwork[72+y]*2];
        lr = bmp2byte_table[16][cwork[72+y]*2+1];
        ll |= bmp2byte_table[17][cwork[80+y]*2]; lr |= bmp2byte_table[17][cwork[80+y]*2+1];
        ll |= bmp2byte_table[18][cwork[88+y]*2]; lr |= bmp2byte_table[18][cwork[88+y]*2+1];
        ll |= bmp2byte_table[1][cwork[96+y]*2]; lr |= bmp2byte_table[1][cwork[96+y]*2+1];
        ll |= bmp2byte_table[20][cwork[192+y]*2]; lr |= bmp2byte_table[20][cwork[192+y]*2+1];
        ll |= bmp2byte_table[19][cwork[208+y]*2]; lr |= bmp2byte_table[19][cwork[208+y]*2+1];
        ll |= bmp2byte_table[4][cwork[224+y]*2]; lr |= bmp2byte_table[4][cwork[224+y]*2+1];
        ll |= bmp2byte_table[2][cwork[240+y]*2]; lr |= bmp2byte_table[2][cwork[240+y]*2+1];
        int off2 = off0 + SCREEN_WIDTH * 2;
        int off3 = off0 + SCREEN_WIDTH * 3;
        if (off2 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
            *(DWORD*)&screenmap[off2+0] = ll; *(DWORD*)&screenmap[off2+4] = lr;
            *(DWORD*)&screenmap[off2+320] = rl; *(DWORD*)&screenmap[off2+324] = rr;
        }
        if (off3 + 8 <= SCREEN_WIDTH * SCREEN_HEIGHT) {
            *(DWORD*)&screenmap[off3+0] = ll; *(DWORD*)&screenmap[off3+4] = lr;
            *(DWORD*)&screenmap[off3+320] = rl; *(DWORD*)&screenmap[off3+324] = rr;
        }
    }
}

// fill_cwork_grphonly_4096_256: grphonly 用 256バイト cwork 生成
static void fill_cwork_grphonly_4096_256(DWORD grp_off) {
    // Upper TG = 0
    *(DWORD*)&cwork[0] = 0; *(DWORD*)&cwork[4] = 0;
    // Upper B planes
    memcpy(&cwork[8],  &GRP_RAM[GRAM_BANK1H + grp_off + PLANE_B], 8);
    memcpy(&cwork[16], &GRP_RAM[GRAM_BANK1L + grp_off + PLANE_B], 8);
    memcpy(&cwork[24], &GRP_RAM[GRAM_BANK0H + grp_off + PLANE_B], 8);
    memcpy(&cwork[32], &GRP_RAM[GRAM_BANK0L + grp_off + PLANE_B], 8);
    // Lower = same as upper (graphics-only: same data for both halves)
    *(DWORD*)&cwork[64] = 0; *(DWORD*)&cwork[68] = 0;
    memcpy(&cwork[72], &cwork[8], 32);
    // Upper R/G
    memcpy(&cwork[128], &GRP_RAM[GRAM_BANK0L + grp_off + PLANE_R], 8);
    memcpy(&cwork[136], &GRP_RAM[GRAM_BANK0L + grp_off + PLANE_G], 8);
    memcpy(&cwork[144], &GRP_RAM[GRAM_BANK0H + grp_off + PLANE_R], 8);
    memcpy(&cwork[152], &GRP_RAM[GRAM_BANK0H + grp_off + PLANE_G], 8);
    memcpy(&cwork[160], &GRP_RAM[GRAM_BANK1L + grp_off + PLANE_R], 8);
    memcpy(&cwork[168], &GRP_RAM[GRAM_BANK1L + grp_off + PLANE_G], 8);
    memcpy(&cwork[176], &GRP_RAM[GRAM_BANK1H + grp_off + PLANE_R], 8);
    memcpy(&cwork[184], &GRP_RAM[GRAM_BANK1H + grp_off + PLANE_G], 8);
    // Lower R/G = same
    memcpy(&cwork[192], &cwork[128], 64);
}

// merge_graph_txtup_4096_256: テキスト上 256バイト版
static void merge_graph_txtup_4096_256(DWORD grp_off) {
    // Upper half
    DWORD inv_lo_u = ~(*(DWORD*)&cwork[0]);
    DWORD inv_hi_u = ~(*(DWORD*)&cwork[4]);
    // Lower half
    DWORD inv_lo_l = ~(*(DWORD*)&cwork[64]);
    DWORD inv_hi_l = ~(*(DWORD*)&cwork[68]);
    DWORD* p;
    // B3: text | (BANK1H_B & ~text_mask)
    p = (DWORD*)&GRP_RAM[GRAM_BANK1H + grp_off + PLANE_B];
    *(DWORD*)&cwork[8]  |= p[0] & inv_lo_u; *(DWORD*)&cwork[12] |= p[1] & inv_hi_u;
    *(DWORD*)&cwork[72] |= p[0] & inv_lo_l; *(DWORD*)&cwork[76] |= p[1] & inv_hi_l;
    // B2
    p = (DWORD*)&GRP_RAM[GRAM_BANK1L + grp_off + PLANE_B];
    *(DWORD*)&cwork[16] |= p[0] & inv_lo_u; *(DWORD*)&cwork[20] |= p[1] & inv_hi_u;
    *(DWORD*)&cwork[80] |= p[0] & inv_lo_l; *(DWORD*)&cwork[84] |= p[1] & inv_hi_l;
    // B1
    p = (DWORD*)&GRP_RAM[GRAM_BANK0H + grp_off + PLANE_B];
    *(DWORD*)&cwork[24] |= p[0] & inv_lo_u; *(DWORD*)&cwork[28] |= p[1] & inv_hi_u;
    *(DWORD*)&cwork[88] |= p[0] & inv_lo_l; *(DWORD*)&cwork[92] |= p[1] & inv_hi_l;
    // B0
    p = (DWORD*)&GRP_RAM[GRAM_BANK0L + grp_off + PLANE_B];
    *(DWORD*)&cwork[32] = p[0] & inv_lo_u; *(DWORD*)&cwork[36] = p[1] & inv_hi_u;
    *(DWORD*)&cwork[96] = p[0] & inv_lo_l; *(DWORD*)&cwork[100] = p[1] & inv_hi_l;
    // R/G: all masked by ~text_mask (upper and lower separately)
    static const DWORD rg_banks[4] = { GRAM_BANK0L, GRAM_BANK0H, GRAM_BANK1L, GRAM_BANK1H };
    static const int rg_planes[2] = { PLANE_R, PLANE_G };
    for (int b = 0; b < 4; b++) {
        for (int pl = 0; pl < 2; pl++) {
            int off_u = 128 + b * 16 + pl * 8;
            int off_l = off_u + 64;
            p = (DWORD*)&GRP_RAM[rg_banks[b] + grp_off + rg_planes[pl]];
            *(DWORD*)&cwork[off_u+0] = p[0] & inv_lo_u;
            *(DWORD*)&cwork[off_u+4] = p[1] & inv_hi_u;
            *(DWORD*)&cwork[off_l+0] = p[0] & inv_lo_l;
            *(DWORD*)&cwork[off_l+4] = p[1] & inv_hi_l;
        }
    }
}

// merge_graph_txtdwn_4096_256: グラフィックス上 256バイト版
static void merge_graph_txtdwn_4096_256(DWORD grp_off) {
    DWORD mask_lo, mask_hi;
    getgrphmaskpat_4096(grp_off, mask_lo, mask_hi);
    DWORD inv_lo = ~mask_lo;
    DWORD inv_hi = ~mask_hi;
    DWORD* p;
    // B3: text masked + BANK1H_B (upper and lower)
    p = (DWORD*)&GRP_RAM[GRAM_BANK1H + grp_off + PLANE_B];
    *(DWORD*)&cwork[8]  = (*(DWORD*)&cwork[8]  & inv_lo) | p[0];
    *(DWORD*)&cwork[12] = (*(DWORD*)&cwork[12] & inv_hi) | p[1];
    *(DWORD*)&cwork[72] = (*(DWORD*)&cwork[72] & inv_lo) | p[0];
    *(DWORD*)&cwork[76] = (*(DWORD*)&cwork[76] & inv_hi) | p[1];
    // B2
    p = (DWORD*)&GRP_RAM[GRAM_BANK1L + grp_off + PLANE_B];
    *(DWORD*)&cwork[16] = (*(DWORD*)&cwork[16] & inv_lo) | p[0];
    *(DWORD*)&cwork[20] = (*(DWORD*)&cwork[20] & inv_hi) | p[1];
    *(DWORD*)&cwork[80] = (*(DWORD*)&cwork[80] & inv_lo) | p[0];
    *(DWORD*)&cwork[84] = (*(DWORD*)&cwork[84] & inv_hi) | p[1];
    // B1
    p = (DWORD*)&GRP_RAM[GRAM_BANK0H + grp_off + PLANE_B];
    *(DWORD*)&cwork[24] = (*(DWORD*)&cwork[24] & inv_lo) | p[0];
    *(DWORD*)&cwork[28] = (*(DWORD*)&cwork[28] & inv_hi) | p[1];
    *(DWORD*)&cwork[88] = (*(DWORD*)&cwork[88] & inv_lo) | p[0];
    *(DWORD*)&cwork[92] = (*(DWORD*)&cwork[92] & inv_hi) | p[1];
    // B0: pure graphics (same for upper/lower)
    p = (DWORD*)&GRP_RAM[GRAM_BANK0L + grp_off + PLANE_B];
    *(DWORD*)&cwork[32] = p[0]; *(DWORD*)&cwork[36] = p[1];
    *(DWORD*)&cwork[96] = p[0]; *(DWORD*)&cwork[100] = p[1];
    // R/G: pure graphics (same for upper/lower)
    static const DWORD rg_banks[4] = { GRAM_BANK0L, GRAM_BANK0H, GRAM_BANK1L, GRAM_BANK1H };
    static const int rg_planes[2] = { PLANE_R, PLANE_G };
    for (int b = 0; b < 4; b++) {
        for (int pl = 0; pl < 2; pl++) {
            int off_u = 128 + b * 16 + pl * 8;
            int off_l = off_u + 64;
            p = (DWORD*)&GRP_RAM[rg_banks[b] + grp_off + rg_planes[pl]];
            *(DWORD*)&cwork[off_u+0] = p[0]; *(DWORD*)&cwork[off_u+4] = p[1];
            *(DWORD*)&cwork[off_l+0] = p[0]; *(DWORD*)&cwork[off_l+4] = p[1];
        }
    }
    // TG: mask by ~graphics_mask (upper and lower separately)
    *(DWORD*)&cwork[0]  &= inv_lo; *(DWORD*)&cwork[4]  &= inv_hi;
    *(DWORD*)&cwork[64] &= inv_lo; *(DWORD*)&cwork[68] &= inv_hi;
}

// width40x12_4096: 40桁×12行 4096色モード (320×100 ×4倍)
// origsrc DRAW4096.CPP:392-934
// 16-line font, ×4出力, VRAMADRRESS_INC2
// updatetmp: &= ~UPDATE_VRAM
void width40x12_4096(void) {
    fontycnt = 0;
    WORD tram_pos = crtc.TXT_TOP;
    int total_chars = (int)vramsize;
    if (total_chars <= 0) return;
    int cols = (int)crtc.TXT_XL;
    if (cols <= 0) cols = 40;
    int vyl = (int)vramylpcnt;
    if (vyl <= 0) vyl = 8;

    int col = 0;
    int scr_off = 0;
    BYTE newline = 0;
    int yp = 0;

    for (int i = 0; i < total_chars; i++) {
        WORD addr = (WORD)(tram_pos & (TRAM_MAX / 2 - 1));
        if (addr >= TRAM_MAX / 2) break;

        BYTE upt = updatetmp[addr];
        if (upt & UPDATE_VRAM) {
            updatetmp[addr] &= (BYTE)~UPDATE_VRAM;
            newline = 1;

            DWORD grp_off = (DWORD)addr << 5;
            BYTE attr = TXT_RAM[addr + TEXT_ATR];
            if (attr & blinktest) attr ^= X1ATR_REVERSE;
            BYTE text_color = attr & 0x0F;

            if (text_color == 0) {
                // grphonly
                fill_cwork_grphonly_4096_256(grp_off);
            } else {
                WORD src_addr = addr;
                if (upt & 0x10) src_addr = (WORD)((addr - 1) & (TRAM_MAX / 2 - 1));
                BYTE char_code = TXT_RAM[src_addr + TEXT_ANK];
                BYTE knj_code = TXT_RAM[src_addr + TEXT_KNJ];
                BYTE color = attr & X1ATR_COLOR;
                bool reverse = (attr & X1ATR_REVERSE) != 0;

                // 16-line font → upper(cwork[0..7]) + lower(cwork[64..71])
                if (knj_code & 0x80) {
                    WORD jis_adr = ((WORD)knj_code << 8) | char_code;
                    BYTE* kfont = getfontjis(adr2jis_x1t(jis_adr));
                    if (knj_code & 0x40) kfont++;
                    for (int y = 0; y < 8 && y < vyl; y++) {
                        cwork[y]      = kfont[(y * 2) & 31];
                        cwork[64 + y] = kfont[((y + 8) * 2) & 31];
                    }
                } else {
                    BYTE* fnt16 = &KNJ_FNT[(WORD)char_code * 16];
                    for (int y = 0; y < 8 && y < vyl; y++) {
                        cwork[y]      = fnt16[y];
                        cwork[64 + y] = fnt16[y + 8];
                    }
                }
                for (int y = 8; y < vyl; y++) {
                    cwork[y] = 0;
                    cwork[64 + y] = 0;
                }

                // REVERSE
                if (reverse) {
                    for (int y = 0; y < vyl; y++) {
                        cwork[y] ^= 0xFF;
                        cwork[64 + y] ^= 0xFF;
                    }
                }

                // テキスト色プレーン生成 (upper + lower)
                // REVERSE時: 色ビットが立っていないプレーンは0xFF
                BYTE unused_fill = reverse ? 0xFF : 0;
                for (int y = 0; y < vyl; y++) {
                    cwork[8+y]  = (color & 1) ? cwork[y] : unused_fill;
                    cwork[16+y] = (color & 2) ? cwork[y] : unused_fill;
                    cwork[24+y] = (color & 4) ? cwork[y] : unused_fill;
                    cwork[72+y] = (color & 1) ? cwork[64+y] : unused_fill;
                    cwork[80+y] = (color & 2) ? cwork[64+y] : unused_fill;
                    cwork[88+y] = (color & 4) ? cwork[64+y] : unused_fill;
                }

                // origsrc DRAW4096.CPP (16line版) と同じ:
                // ZPRY==0 かつ reverse+color(0..6) のみ textonly
                bool textonly = reverse && (color != 7);
                if (textonly) {
                    // textonly: TG=0xFF, B0=0, R/G=0
                    for (int y = 0; y < vyl; y++) {
                        cwork[y] = 0xFF;
                        cwork[64 + y] = 0xFF;
                    }
                    memset(&cwork[32], 0, 8);
                    memset(&cwork[96], 0, 8);
                    memset(&cwork[128], 0, 128);
                } else if (crtc.ZPRY & 1) {
                    merge_graph_txtdwn_4096_256(grp_off);
                } else {
                    merge_graph_txtup_4096_256(grp_off);
                }
            }

            grphtxtout_4096_256_x4(scr_off, vyl);
        }

        // VRAMADRRESS_INC2
        tram_pos++;
        scr_off += 8;
        col++;
        if (col >= cols) {
            if (updatetmp[(tram_pos - 1) & (TRAM_MAX / 2 - 1)] & 0x04) {
                fontycnt = (BYTE)((fontycnt + vyl) & 0x0F);
            } else {
                fontycnt = (BYTE)((vyl * 2) & 0x0F);
            }
            if (newline) {
                for (int j = 0; j < vyl * 4; j++) {
                    if (yp + j < SCREEN_HEIGHT)
                        renewalline[yp + j] |= 3;
                }
            }
            yp += vyl * 4;
            newline = 0;
            col = 0;
            scr_off = yp * SCREEN_WIDTH;
        }
    }
    if (newline && col > 0) {
        for (int j = 0; j < vyl * 4; j++) {
            if (yp + j < SCREEN_HEIGHT)
                renewalline[yp + j] |= 3;
        }
    }
}

// width40x12_64h: 40桁×12行 64色ハイレゾ (320×200 ×2倍)
// origsrc DRAW64H.CPP:434-809
// width40x25_64h と同じ 4バンク構成だが ×4 出力 (upper doubled + lower doubled)
void width40x12_64h(void) {
    fontycnt = 0;
    WORD tram_pos = crtc.TXT_TOP;
    int total_chars = (int)vramsize;
    if (total_chars <= 0) return;
    int cols = (int)crtc.TXT_XL;
    if (cols <= 0) cols = 40;
    int vyl = (int)vramylpcnt;
    if (vyl <= 0) vyl = 8;

    int col = 0;
    int scr_off = 0;
    BYTE newline = 0;
    int yp = 0;

    for (int i = 0; i < total_chars; i++) {
        WORD addr = (WORD)(tram_pos & (TRAM_MAX / 2 - 1));
        if (addr >= TRAM_MAX / 2) break;

        BYTE upt = updatetmp[addr];
        if (upt & UPDATE_VRAM) {
            updatetmp[addr] &= (BYTE)(~UPDATE_VRAM);
            newline = 1;

            BYTE attr = TXT_RAM[addr + TEXT_ATR];
            if (attr & blinktest) attr ^= X1ATR_REVERSE;
            BYTE text_color = attr & 0x0F;

            BYTE* grp = &GRP_RAM[(DWORD)addr * 32 + GRAM_BANK0L + PLANE_B];

            if (text_color == 0) {
                *(DWORD*)&cwork[0] = 0;
                *(DWORD*)&cwork[4] = 0;
                memcpy(&cwork[8], grp, 24);                          // BANK0L
                memcpy(&cwork[32], grp + GRAM_HALFSTEP * 2, 24);     // BANK1L
                *(DWORD*)&cwork[64] = 0;
                *(DWORD*)&cwork[68] = 0;
                memcpy(&cwork[72], grp + GRAM_HALFSTEP, 24);         // BANK0H
                memcpy(&cwork[96], grp + GRAM_HALFSTEP * 3, 24);     // BANK1H
            } else {
                WORD src_addr = addr;
                if (upt & 0x10) src_addr = (WORD)((addr - 1) & (TRAM_MAX / 2 - 1));
                BYTE char_code = TXT_RAM[src_addr + TEXT_ANK];
                BYTE knj_code = TXT_RAM[src_addr + TEXT_KNJ];
                BYTE color = attr & X1ATR_COLOR;
                bool reverse = (attr & X1ATR_REVERSE) != 0;

                if (knj_code & 0x80) {
                    WORD jis_adr = ((WORD)knj_code << 8) | char_code;
                    BYTE* kfont = getfontjis(adr2jis_x1t(jis_adr));
                    if (knj_code & 0x40) kfont++;
                    for (int y = 0; y < 8 && y < vyl; y++) {
                        cwork[y]      = kfont[(y * 2) & 31];
                        cwork[64 + y] = kfont[((y + 8) * 2) & 31];
                    }
                } else {
                    BYTE* fnt16 = &KNJ_FNT[(WORD)char_code * 16];
                    for (int y = 0; y < 8 && y < vyl; y++) {
                        cwork[y]      = fnt16[y];
                        cwork[64 + y] = fnt16[y + 8];
                    }
                }
                for (int y = 8; y < vyl; y++) {
                    cwork[y] = 0;
                    cwork[64 + y] = 0;
                }

                fill_cwork_text_planes_64_128(color, reverse);

                if (text_color == 0x08) {
                    for (int y = 0; y < 8; y++) {
                        cwork[y] = 0xFF;
                        cwork[64 + y] = 0xFF;
                    }
                }

                if (crtc.ZPRY & 1) {
                    // txtdwn: Upper = BANK0L+BANK1L, Lower = BANK0H+BANK1H
                    DWORD* p0 = (DWORD*)grp;
                    DWORD ml = p0[0]; DWORD mh = p0[1];
                    ml |= p0[2]; mh |= p0[3];
                    ml |= p0[4]; mh |= p0[5];
                    DWORD* p1l = (DWORD*)(grp + GRAM_HALFSTEP * 2);
                    ml |= p1l[0]; mh |= p1l[1];
                    ml |= p1l[2]; mh |= p1l[3];
                    ml |= p1l[4]; mh |= p1l[5];
                    DWORD inv_lo = ~ml, inv_hi = ~mh;
                    for (int pl = 0; pl < 3; pl++) {
                        DWORD* cw = (DWORD*)&cwork[8 + pl * 8];
                        cw[0] = (cw[0] & inv_lo) | p0[pl * 2 + 0];
                        cw[1] = (cw[1] & inv_hi) | p0[pl * 2 + 1];
                    }
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[32 + pl * 8 + 0] = p1l[pl * 2 + 0];
                        *(DWORD*)&cwork[32 + pl * 8 + 4] = p1l[pl * 2 + 1];
                    }
                    *(DWORD*)&cwork[0] &= inv_lo;
                    *(DWORD*)&cwork[4] &= inv_hi;
                    DWORD* p0h = (DWORD*)(grp + GRAM_HALFSTEP);
                    ml = p0h[0]; mh = p0h[1];
                    ml |= p0h[2]; mh |= p0h[3];
                    ml |= p0h[4]; mh |= p0h[5];
                    DWORD* p1h = (DWORD*)(grp + GRAM_HALFSTEP * 3);
                    ml |= p1h[0]; mh |= p1h[1];
                    ml |= p1h[2]; mh |= p1h[3];
                    ml |= p1h[4]; mh |= p1h[5];
                    inv_lo = ~ml; inv_hi = ~mh;
                    for (int pl = 0; pl < 3; pl++) {
                        DWORD* cw = (DWORD*)&cwork[72 + pl * 8];
                        cw[0] = (cw[0] & inv_lo) | p0h[pl * 2 + 0];
                        cw[1] = (cw[1] & inv_hi) | p0h[pl * 2 + 1];
                    }
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[96 + pl * 8 + 0] = p1h[pl * 2 + 0];
                        *(DWORD*)&cwork[96 + pl * 8 + 4] = p1h[pl * 2 + 1];
                    }
                    *(DWORD*)&cwork[64] &= inv_lo;
                    *(DWORD*)&cwork[68] &= inv_hi;
                } else {
                    // txtup: Upper = BANK0L+BANK1L, Lower = BANK0H+BANK1H
                    DWORD inv_lo_u = ~(*(DWORD*)&cwork[0]);
                    DWORD inv_hi_u = ~(*(DWORD*)&cwork[4]);
                    DWORD* p0 = (DWORD*)grp;
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[8 + pl*8 + 0] |= p0[pl*2 + 0] & inv_lo_u;
                        *(DWORD*)&cwork[8 + pl*8 + 4] |= p0[pl*2 + 1] & inv_hi_u;
                    }
                    DWORD* p1l = (DWORD*)(grp + GRAM_HALFSTEP * 2);
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[32 + pl*8 + 0] = p1l[pl*2 + 0] & inv_lo_u;
                        *(DWORD*)&cwork[32 + pl*8 + 4] = p1l[pl*2 + 1] & inv_hi_u;
                    }
                    DWORD inv_lo_l = ~(*(DWORD*)&cwork[64]);
                    DWORD inv_hi_l = ~(*(DWORD*)&cwork[68]);
                    DWORD* p0h = (DWORD*)(grp + GRAM_HALFSTEP);
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[72 + pl*8 + 0] |= p0h[pl*2 + 0] & inv_lo_l;
                        *(DWORD*)&cwork[72 + pl*8 + 4] |= p0h[pl*2 + 1] & inv_hi_l;
                    }
                    DWORD* p1h = (DWORD*)(grp + GRAM_HALFSTEP * 3);
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[96 + pl*8 + 0] = p1h[pl*2 + 0] & inv_lo_l;
                        *(DWORD*)&cwork[96 + pl*8 + 4] = p1h[pl*2 + 1] & inv_hi_l;
                    }
                }
            }

            grphtxtout_64_128_x4(scr_off, vyl);
        }

        // VRAMADRRESS_INC2
        tram_pos++;
        scr_off += 8;
        col++;
        if (col >= cols) {
            if (updatetmp[(tram_pos - 1) & (TRAM_MAX / 2 - 1)] & 0x04) {
                fontycnt = (BYTE)((fontycnt + vyl) & 0x0F);
            } else {
                fontycnt = (BYTE)((vyl * 2) & 0x0F);
            }
            if (newline) {
                for (int j = 0; j < vyl * 4; j++) {
                    if (yp + j < SCREEN_HEIGHT)
                        renewalline[yp + j] |= 3;
                }
            }
            yp += vyl * 4;
            newline = 0;
            col = 0;
            scr_off = yp * SCREEN_WIDTH;
        }
    }
    if (newline && col > 0) {
        for (int j = 0; j < vyl * 4; j++) {
            if (yp + j < SCREEN_HEIGHT)
                renewalline[yp + j] |= 3;
        }
    }
}

// width80x12_64s: 80桁×12行 64色ローレゾ (640×100 ×4倍)
// origsrc DRAW64L.CPP:982-1357
// 4バンク: upper=BANK0L+BANK1L, lower=BANK0H+BANK1H
// updatetmp: &= ~UPDATE_VRAM
void width80x12_64s(void) {
    fontycnt = 0;
    WORD tram_pos = crtc.TXT_TOP;
    int total_chars = (int)vramsize;
    if (total_chars <= 0) return;
    int cols = (int)crtc.TXT_XL;
    if (cols <= 0) cols = 80;
    int vyl = (int)vramylpcnt;
    if (vyl <= 0) vyl = 8;

    int col = 0;
    int scr_off = 0;
    BYTE newline = 0;
    int yp = 0;

    for (int i = 0; i < total_chars; i++) {
        WORD addr = (WORD)(tram_pos & (TRAM_MAX / 2 - 1));
        if (addr >= TRAM_MAX / 2) break;

        BYTE upt = updatetmp[addr];
        if (upt & UPDATE_VRAM) {
            updatetmp[addr] &= (BYTE)(~UPDATE_VRAM);
            newline = 1;

            BYTE attr = TXT_RAM[addr + TEXT_ATR];
            if (attr & blinktest) attr ^= X1ATR_REVERSE;
            BYTE text_color = attr & 0x0F;

            BYTE* grp = &GRP_RAM[(DWORD)addr * 32 + GRAM_BANK0L + PLANE_B];

            if (text_color == 0) {
                *(DWORD*)&cwork[0] = 0;
                *(DWORD*)&cwork[4] = 0;
                memcpy(&cwork[8], grp, 24);                          // BANK0L
                memcpy(&cwork[32], grp + GRAM_HALFSTEP * 2, 24);     // BANK1L
                *(DWORD*)&cwork[64] = 0;
                *(DWORD*)&cwork[68] = 0;
                memcpy(&cwork[72], grp + GRAM_HALFSTEP, 24);         // BANK0H
                memcpy(&cwork[96], grp + GRAM_HALFSTEP * 3, 24);     // BANK1H
            } else {
                WORD src_addr = addr;
                if (upt & 0x10) src_addr = (WORD)((addr - 1) & (TRAM_MAX / 2 - 1));
                BYTE char_code = TXT_RAM[src_addr + TEXT_ANK];
                BYTE knj_code = TXT_RAM[src_addr + TEXT_KNJ];
                BYTE color = attr & X1ATR_COLOR;
                bool reverse = (attr & X1ATR_REVERSE) != 0;

                if (knj_code & 0x80) {
                    WORD jis_adr = ((WORD)knj_code << 8) | char_code;
                    BYTE* kfont = getfontjis(adr2jis_x1t(jis_adr));
                    if (knj_code & 0x40) kfont++;
                    for (int y = 0; y < 8 && y < vyl; y++) {
                        cwork[y]      = kfont[(y * 2) & 31];
                        cwork[64 + y] = kfont[((y + 8) * 2) & 31];
                    }
                } else {
                    BYTE* fnt16 = &KNJ_FNT[(WORD)char_code * 16];
                    for (int y = 0; y < 8 && y < vyl; y++) {
                        cwork[y]      = fnt16[y];
                        cwork[64 + y] = fnt16[y + 8];
                    }
                }
                for (int y = 8; y < vyl; y++) {
                    cwork[y] = 0;
                    cwork[64 + y] = 0;
                }

                fill_cwork_text_planes_64_128(color, reverse);

                if (text_color == 0x08) {
                    for (int y = 0; y < 8; y++) {
                        cwork[y] = 0xFF;
                        cwork[64 + y] = 0xFF;
                    }
                }

                if (crtc.ZPRY & 1) {
                    // txtdwn: Upper = BANK0L+BANK1L, Lower = BANK0H+BANK1H
                    DWORD* p0 = (DWORD*)grp;
                    DWORD ml = p0[0]; DWORD mh = p0[1];
                    ml |= p0[2]; mh |= p0[3];
                    ml |= p0[4]; mh |= p0[5];
                    DWORD* p1l = (DWORD*)(grp + GRAM_HALFSTEP * 2);
                    ml |= p1l[0]; mh |= p1l[1];
                    ml |= p1l[2]; mh |= p1l[3];
                    ml |= p1l[4]; mh |= p1l[5];
                    DWORD inv_lo = ~ml, inv_hi = ~mh;
                    for (int pl = 0; pl < 3; pl++) {
                        DWORD* cw = (DWORD*)&cwork[8 + pl * 8];
                        cw[0] = (cw[0] & inv_lo) | p0[pl * 2 + 0];
                        cw[1] = (cw[1] & inv_hi) | p0[pl * 2 + 1];
                    }
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[32 + pl * 8 + 0] = p1l[pl * 2 + 0];
                        *(DWORD*)&cwork[32 + pl * 8 + 4] = p1l[pl * 2 + 1];
                    }
                    *(DWORD*)&cwork[0] &= inv_lo;
                    *(DWORD*)&cwork[4] &= inv_hi;
                    DWORD* p0h = (DWORD*)(grp + GRAM_HALFSTEP);
                    ml = p0h[0]; mh = p0h[1];
                    ml |= p0h[2]; mh |= p0h[3];
                    ml |= p0h[4]; mh |= p0h[5];
                    DWORD* p1h = (DWORD*)(grp + GRAM_HALFSTEP * 3);
                    ml |= p1h[0]; mh |= p1h[1];
                    ml |= p1h[2]; mh |= p1h[3];
                    ml |= p1h[4]; mh |= p1h[5];
                    inv_lo = ~ml; inv_hi = ~mh;
                    for (int pl = 0; pl < 3; pl++) {
                        DWORD* cw = (DWORD*)&cwork[72 + pl * 8];
                        cw[0] = (cw[0] & inv_lo) | p0h[pl * 2 + 0];
                        cw[1] = (cw[1] & inv_hi) | p0h[pl * 2 + 1];
                    }
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[96 + pl * 8 + 0] = p1h[pl * 2 + 0];
                        *(DWORD*)&cwork[96 + pl * 8 + 4] = p1h[pl * 2 + 1];
                    }
                    *(DWORD*)&cwork[64] &= inv_lo;
                    *(DWORD*)&cwork[68] &= inv_hi;
                } else {
                    // txtup: Upper = BANK0L+BANK1L, Lower = BANK0H+BANK1H
                    DWORD inv_lo_u = ~(*(DWORD*)&cwork[0]);
                    DWORD inv_hi_u = ~(*(DWORD*)&cwork[4]);
                    DWORD* p0 = (DWORD*)grp;
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[8 + pl*8 + 0] |= p0[pl*2 + 0] & inv_lo_u;
                        *(DWORD*)&cwork[8 + pl*8 + 4] |= p0[pl*2 + 1] & inv_hi_u;
                    }
                    DWORD* p1l = (DWORD*)(grp + GRAM_HALFSTEP * 2);
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[32 + pl*8 + 0] = p1l[pl*2 + 0] & inv_lo_u;
                        *(DWORD*)&cwork[32 + pl*8 + 4] = p1l[pl*2 + 1] & inv_hi_u;
                    }
                    DWORD inv_lo_l = ~(*(DWORD*)&cwork[64]);
                    DWORD inv_hi_l = ~(*(DWORD*)&cwork[68]);
                    DWORD* p0h = (DWORD*)(grp + GRAM_HALFSTEP);
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[72 + pl*8 + 0] |= p0h[pl*2 + 0] & inv_lo_l;
                        *(DWORD*)&cwork[72 + pl*8 + 4] |= p0h[pl*2 + 1] & inv_hi_l;
                    }
                    DWORD* p1h = (DWORD*)(grp + GRAM_HALFSTEP * 3);
                    for (int pl = 0; pl < 3; pl++) {
                        *(DWORD*)&cwork[96 + pl*8 + 0] = p1h[pl*2 + 0] & inv_lo_l;
                        *(DWORD*)&cwork[96 + pl*8 + 4] = p1h[pl*2 + 1] & inv_hi_l;
                    }
                }
            }

            grphtxtout_64_128_x4(scr_off, vyl);
        }

        // VRAMADRRESS_INC2
        tram_pos++;
        scr_off += 8;
        col++;
        if (col >= cols) {
            if (updatetmp[(tram_pos - 1) & (TRAM_MAX / 2 - 1)] & 0x04) {
                fontycnt = (BYTE)((fontycnt + vyl) & 0x0F);
            } else {
                fontycnt = (BYTE)((vyl * 2) & 0x0F);
            }
            if (newline) {
                for (int j = 0; j < vyl * 4; j++) {
                    if (yp + j < SCREEN_HEIGHT)
                        renewalline[yp + j] |= 3;
                }
            }
            yp += vyl * 4;
            newline = 0;
            col = 0;
            scr_off = yp * SCREEN_WIDTH;
        }
    }
    if (newline && col > 0) {
        for (int j = 0; j < vyl * 4; j++) {
            if (yp + j < SCREEN_HEIGHT)
                renewalline[yp + j] |= 3;
        }
    }
}

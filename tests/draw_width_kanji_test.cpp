#include <cstring>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include "common.h"
#include "xmil.h"
#include "x1.h"
#include "x1_crtc.h"
#include "x1_pcg.h"
#include "x1_vram.h"
#include "draw.h"
#include "draw_sub.h"

BYTE TXT_RAM[0x01800];
BYTE ANK_FNT[256][8];
BYTE KNJ_FNT[0x4bc00];
BYTE GRP_RAM[0x20000];
BYTE screenmap[SCREEN_WIDTH * SCREEN_HEIGHT];
BYTE blinktest;
BYTE fontlpcnt;
BYTE fonttype;
BYTE vramylpcnt;
BYTE dispflg;
WORD vramsize;
BYTE updatetmp[0x800 + 0x101];
BYTE* dispp = &GRP_RAM[GRAM_BANK0];
BYTE* dispp2 = &GRP_RAM[GRAM_BANK1];
WORD vramylpad;
BYTE g_cli_disable_text;
BYTE g_cli_disable_graph;
BYTE renewalline[SCREEN_HEIGHT + 4];
PCG_TABLE pcg;
CRTC_TABLE crtc;
PALETTE_TABLE xm_palette[256];
int xm_palettes;

void ddraws_change_palette(void) {}

static BYTE synthetic_kanji[32];

BYTE* __fastcall getfontjis(WORD) {
    return synthetic_kanji;
}

WORD __fastcall adr2jis_x1t(WORD adr) {
    return adr;
}

static void fail(const std::string& message) {
    throw std::runtime_error(message);
}

static void expect_equal(int actual, int expected, const std::string& label) {
    if (actual != expected) {
        std::ostringstream out;
        out << label << ": expected " << expected << ", got " << actual;
        fail(out.str());
    }
}

static void expect_equal(BYTE actual, BYTE expected, const std::string& label) {
    expect_equal(static_cast<int>(actual), static_cast<int>(expected), label);
}

static void reset_renderer(int logical_font_rows, int logical_cell_rows, int rows = 1) {
    std::memset(TXT_RAM, 0, sizeof(TXT_RAM));
    std::memset(ANK_FNT, 0, sizeof(ANK_FNT));
    std::memset(KNJ_FNT, 0, sizeof(KNJ_FNT));
    std::memset(GRP_RAM, 0, sizeof(GRP_RAM));
    std::memset(screenmap, 0, sizeof(screenmap));
    std::memset(updatetmp, 0, sizeof(updatetmp));
    std::memset(renewalline, 0, sizeof(renewalline));
    std::memset(&pcg, 0, sizeof(pcg));
    std::memset(&crtc, 0, sizeof(crtc));
    std::memset(synthetic_kanji, 0, sizeof(synthetic_kanji));

    init_drawtable();
    blinktest = 0;
    fontlpcnt = static_cast<BYTE>(logical_font_rows);
    vramylpcnt = static_cast<BYTE>(logical_cell_rows);
    fonttype = ANK_24KHz | KNJ_24KHz;
    dispflg = UPDATE_VRAM0;
    vramsize = static_cast<WORD>(rows);
    g_cli_disable_text = 0;
    g_cli_disable_graph = 1;
    crtc.TXT_TOP = 0;
    crtc.TXT_XL = 1;
    crtc.TXT_YL = static_cast<BYTE>(rows);
}

static void set_row_coded_glyph() {
    for (int row = 0; row < 16; row++) {
        synthetic_kanji[row * 2] = static_cast<BYTE>(row + 1);
        synthetic_kanji[row * 2 + 1] = static_cast<BYTE>(0x80 | row);
    }
}

static void set_row_coded_ank() {
    for (int row = 0; row < 16; row++) {
        KNJ_FNT[row] = static_cast<BYTE>(row + 1);
    }
}

static void set_row_coded_ank8() {
    for (int row = 0; row < 8; row++) {
        ANK_FNT[0][row] = static_cast<BYTE>(row + 1);
    }
}

static void set_row_coded_pcg8() {
    for (int row = 0; row < 8; row++) {
        pcg.B[0][row] = static_cast<BYTE>(row + 1);
    }
}

static void set_row_coded_pcg16() {
    for (int row = 0; row < 16; row++) {
        pcg.B[row / 8][row % 8] = static_cast<BYTE>(row + 1);
    }
}

static void set_cell(int addr, bool kanji, bool underline) {
    TXT_RAM[TEXT_ANK + addr] = 0;
    TXT_RAM[TEXT_ATR + addr] = 7;
    TXT_RAM[TEXT_KNJ + addr] = static_cast<BYTE>((kanji ? 0x80 : 0) |
                                                 (underline ? X1KNJ_ULINE : 0));
    updatetmp[addr] = UPDATE_TVRAM;
}

static void set_ank_cell(int addr, bool underline, bool reverse = false) {
    TXT_RAM[TEXT_ANK + addr] = 0;
    TXT_RAM[TEXT_ATR + addr] = static_cast<BYTE>(7 |
        (reverse ? X1ATR_REVERSE : 0));
    TXT_RAM[TEXT_KNJ + addr] = underline ? X1KNJ_ULINE : 0;
    updatetmp[addr] = UPDATE_TVRAM;
}

static void set_pcg_cell(int addr, bool pcg16, bool underline,
                         BYTE color = 1) {
    TXT_RAM[TEXT_ANK + addr] = 0;
    TXT_RAM[TEXT_ATR + addr] = static_cast<BYTE>(X1ATR_PCG | color);
    TXT_RAM[TEXT_KNJ + addr] = static_cast<BYTE>((pcg16 ? 0x10 : 0) |
                                                 (underline ? X1KNJ_ULINE : 0));
    updatetmp[addr] = UPDATE_TVRAM;
}

static BYTE decode_text_pattern(int scanline, int x = 0) {
    BYTE pattern = 0;
    const BYTE* pixels = &screenmap[scanline * SCREEN_WIDTH + x];
    for (int bit = 0; bit < 8; bit++) {
        if (pixels[bit] & 0x38) {
            pattern |= static_cast<BYTE>(0x80 >> bit);
        }
    }
    return pattern;
}

static BYTE pixel_value(int scanline, int bit, int x = 0) {
    return screenmap[scanline * SCREEN_WIDTH + x + bit];
}

static bool has_underline_mask(int scanline, int x = 0) {
    const BYTE* pixels = &screenmap[scanline * SCREEN_WIDTH + x];
    for (int bit = 0; bit < 8; bit++) {
        if ((pixels[bit] & 0x01) == 0) return false;
    }
    return true;
}

static int count_nonzero_text_rows(int first, int count) {
    int nonzero = 0;
    for (int y = first; y < first + count; y++) {
        if (decode_text_pattern(y) != 0) nonzero++;
    }
    return nonzero;
}

static void expect_row_sequence_at(int first, int physical_rows, int repeat,
                                   const std::string& label) {
    for (int y = 0; y < physical_rows; y++) {
        const int source_row = y / repeat;
        expect_equal(decode_text_pattern(first + y),
                     static_cast<BYTE>(source_row + 1),
                     label + " scanline " + std::to_string(y));
    }
}

static void expect_row_sequence(int physical_rows, int repeat,
                                const std::string& label) {
    expect_row_sequence_at(0, physical_rows, repeat, label);
}

static void test_24khz_ank_pcg_geometry() {
    reset_renderer(6, 8);
    set_row_coded_ank();
    set_ank_cell(0, false);
    width80x20_24khz();
    const int ank_normal = count_nonzero_text_rows(0, 16);
    expect_row_sequence(16, 1, "24kHz ANK row identity");

    reset_renderer(6, 8);
    set_row_coded_ank();
    set_ank_cell(0, false);
    width80x10_24khz();
    const int ank_doubled = count_nonzero_text_rows(0, 32);
    expect_row_sequence(32, 2, "24kHz doubled ANK row identity");

    reset_renderer(6, 8);
    set_row_coded_pcg8();
    set_pcg_cell(0, false, false);
    width80x20_24khz();
    const int pcg8_normal = count_nonzero_text_rows(0, 16);
    expect_row_sequence(16, 2, "24kHz PCG8 row identity");

    reset_renderer(6, 8);
    set_row_coded_pcg8();
    set_pcg_cell(0, false, false);
    width80x10_24khz();
    const int pcg8_doubled = count_nonzero_text_rows(0, 32);
    expect_row_sequence(32, 4, "24kHz doubled PCG8 row identity");

    reset_renderer(6, 8);
    set_row_coded_pcg16();
    set_pcg_cell(0, true, false);
    width80x20_24khz();
    const int pcg16_normal = count_nonzero_text_rows(0, 16);
    expect_row_sequence(16, 1, "24kHz PCG16 row identity");

    reset_renderer(6, 8);
    set_row_coded_pcg16();
    set_pcg_cell(0, true, false);
    width80x10_24khz();
    const int pcg16_doubled = count_nonzero_text_rows(0, 32);
    expect_row_sequence(32, 2, "24kHz doubled PCG16 row identity");

    if (ank_normal != 16 || ank_doubled != 32 ||
        pcg8_normal != 16 || pcg8_doubled != 32 ||
        pcg16_normal != 16 || pcg16_doubled != 32) {
        std::ostringstream out;
        out << "24kHz baseline pixels: ANK=" << ank_normal << "/16,"
            << ank_doubled << "/32; PCG8=" << pcg8_normal << "/16,"
            << pcg8_doubled << "/32; PCG16=" << pcg16_normal << "/16,"
            << pcg16_doubled << "/32";
        fail(out.str());
    }
}

static void test_24khz_underlined_geometry() {
    reset_renderer(6, 8);
    set_row_coded_glyph();
    set_cell(0, true, false);
    width80x20_24khz();
    expect_equal(count_nonzero_text_rows(0, 16), 16,
                 "24kHz underline-capable Kanji rows");
    expect_row_sequence(16, 1, "24kHz row identity");
}

static void test_24khz_doubled_geometry() {
    reset_renderer(6, 8);
    set_row_coded_glyph();
    set_cell(0, true, false);
    width80x10_24khz();
    expect_equal(count_nonzero_text_rows(0, 32), 32,
                 "24kHz doubled Kanji rows");
    expect_row_sequence(32, 2, "24kHz doubled row identity");
}

static void test_unaffected_geometries() {
    reset_renderer(8, 8);
    set_row_coded_glyph();
    set_cell(0, true, false);
    width80x25_400line();
    expect_row_sequence(16, 1, "24kHz non-underline row identity");

    reset_renderer(8, 10);
    set_row_coded_glyph();
    set_cell(0, true, false);
    width80x20_15khz();
    for (int y = 0; y < 16; y++) {
        const int source_row = (y / 2) * 2;
        expect_equal(decode_text_pattern(y), static_cast<BYTE>(source_row + 1),
                     "15kHz underline row identity " + std::to_string(y));
    }
}

static void test_ank_pcg_unaffected_geometries() {
    reset_renderer(8, 8);
    set_row_coded_ank();
    set_ank_cell(0, false);
    width80x25_400line();
    expect_row_sequence(16, 1, "24kHz non-underline ANK identity");

    reset_renderer(8, 8);
    set_row_coded_pcg8();
    set_pcg_cell(0, false, false);
    width80x25_400line();
    expect_row_sequence(16, 2, "24kHz non-underline PCG8 identity");

    reset_renderer(8, 8);
    set_row_coded_pcg16();
    set_pcg_cell(0, true, false);
    width80x25_400line();
    expect_row_sequence(16, 1, "24kHz non-underline PCG16 identity");

    reset_renderer(8, 10);
    fonttype = KNJ_24KHz;
    set_row_coded_ank8();
    set_ank_cell(0, false);
    width80x20_15khz();
    expect_row_sequence(16, 2, "15kHz underline ANK identity");

    reset_renderer(8, 10);
    fonttype = KNJ_24KHz;
    set_row_coded_pcg8();
    set_pcg_cell(0, false, false);
    width80x20_15khz();
    expect_row_sequence(16, 2, "15kHz underline PCG8 identity");

    reset_renderer(8, 10);
    fonttype = KNJ_24KHz;
    set_row_coded_pcg16();
    set_pcg_cell(0, true, false);
    width80x20_15khz();
    expect_row_sequence(16, 1, "15kHz underline PCG16 identity");
}

static void test_ank_pcg_underline_merge() {
    reset_renderer(6, 8);
    set_row_coded_ank();
    set_ank_cell(0, true);
    width80x20_24khz();
    expect_row_sequence(16, 1, "24kHz underlined ANK identity");
    if (!has_underline_mask(13)) fail("24kHz ANK underline mask missing");

    reset_renderer(6, 8);
    set_row_coded_pcg16();
    set_pcg_cell(0, true, true);
    width80x10_24khz();
    expect_row_sequence(32, 2, "24kHz doubled underlined PCG16 identity");
    if (!has_underline_mask(26) || !has_underline_mask(27)) {
        fail("24kHz doubled PCG16 underline mask missing");
    }

    reset_renderer(6, 8);
    pcg.B[0][6] = 0x90;
    pcg.R[0][6] = 0x50;
    pcg.G[0][6] = 0x30;
    set_pcg_cell(0, false, true, 7);
    width80x20_24khz();
    const BYTE expected[8] = {0x09, 0x11, 0x21, 0x39,
                              0x01, 0x01, 0x01, 0x01};
    for (int bit = 0; bit < 8; bit++) {
        expect_equal(static_cast<BYTE>(pixel_value(13, bit) & 0x39),
                     expected[bit],
                     "multicolor PCG underline pixel " + std::to_string(bit));
    }

    reset_renderer(6, 8);
    set_ank_cell(0, true, true);
    width80x20_24khz();
    for (int y = 0; y < 16; y++) {
        expect_equal(decode_text_pattern(y), static_cast<BYTE>(0xFF),
                     "reverse ANK background row " + std::to_string(y));
    }
    if (!has_underline_mask(13)) {
        fail("reverse ANK underline position changed");
    }
}

static void test_render_row_boundaries() {
    reset_renderer(10, 12);
    set_row_coded_ank();
    set_ank_cell(0, false);
    width80x20_24khz();
    expect_equal(count_nonzero_text_rows(0, 20), 20,
                 "tall cell must not shrink the existing loop");

    reset_renderer(2, 2);
    std::memset(&screenmap[4 * SCREEN_WIDTH], 0x55, 4 * SCREEN_WIDTH);
    set_ank_cell(0, false);
    width80x20_24khz();
    for (int y = 4; y < 8; y++) {
        for (int bit = 0; bit < 8; bit++) {
            expect_equal(pixel_value(y, bit), static_cast<BYTE>(0),
                         "legacy tail clear row " + std::to_string(y));
        }
    }
}

static std::vector<int> underline_rows(void (*draw)(), int physical_rows,
                                       bool kanji, int font_rows = 6,
                                       int cell_rows = 8) {
    reset_renderer(font_rows, cell_rows);
    set_cell(0, kanji, true);
    draw();
    std::vector<int> rows;
    for (int y = 0; y < physical_rows; y++) {
        if (has_underline_mask(y)) rows.push_back(y);
    }
    return rows;
}

static void expect_rows(const std::vector<int>& actual,
                        const std::vector<int>& expected,
                        const std::string& label) {
    if (actual != expected) {
        std::ostringstream out;
        out << label << ": expected";
        for (int row : expected) out << ' ' << row;
        out << ", got";
        for (int row : actual) out << ' ' << row;
        fail(out.str());
    }
}

static void test_underline_positions_and_merge() {
    expect_rows(underline_rows(width80x20_24khz, 16, false), {13},
                "24kHz ANK underline position");
    expect_rows(underline_rows(width80x20_24khz, 16, true), {13},
                "24kHz Kanji underline position");
    expect_rows(underline_rows(width80x10_24khz, 32, false), {26, 27},
                "24kHz doubled ANK underline position");
    expect_rows(underline_rows(width80x10_24khz, 32, true), {26, 27},
                "24kHz doubled Kanji underline position");

    reset_renderer(6, 8);
    set_row_coded_glyph();
    set_cell(0, true, true);
    width80x20_24khz();
    expect_row_sequence(16, 1, "24kHz underline merge row identity");
    if (!has_underline_mask(13)) fail("24kHz underline merge mask missing");
    expect_rows(underline_rows(width80x20_24khz, 16, true), {13},
                "24kHz underline merge mask");

    reset_renderer(6, 8);
    set_row_coded_glyph();
    set_cell(0, true, true);
    width80x10_24khz();
    expect_row_sequence(32, 2, "24kHz doubled underline merge row identity");
    if (!has_underline_mask(26) || !has_underline_mask(27)) {
        fail("24kHz doubled underline merge mask missing");
    }
    expect_rows(underline_rows(width80x10_24khz, 32, true), {26, 27},
                "24kHz doubled underline merge mask");
}

static void test_short_cell_bounds() {
    reset_renderer(2, 4);
    set_row_coded_glyph();
    std::memset(&screenmap[8 * SCREEN_WIDTH], 0x55, SCREEN_WIDTH);
    set_cell(0, true, true);
    width80x20_24khz();
    expect_row_sequence(8, 1, "short-cell row identity");
    expect_equal(static_cast<int>(screenmap[8 * SCREEN_WIDTH]), 0x55,
                 "short-cell following row sentinel");
    if (!has_underline_mask(5)) fail("short-cell underline mask missing at row 5");

    const int rows = SCREEN_HEIGHT / 8;
    reset_renderer(2, 4, rows);
    set_row_coded_glyph();
    set_cell(rows - 1, true, false);
    width80x20_24khz();
    const int last_cell_top = SCREEN_HEIGHT - 8;
    for (int y = 0; y < 8; y++) {
        expect_equal(decode_text_pattern(last_cell_top + y),
                     static_cast<BYTE>(y + 1),
                     "last short cell row " + std::to_string(y));
    }

    reset_renderer(2, 4);
    set_row_coded_ank();
    std::memset(&screenmap[8 * SCREEN_WIDTH], 0x55, SCREEN_WIDTH);
    set_ank_cell(0, true);
    width80x20_24khz();
    expect_row_sequence(8, 1, "short-cell ANK identity");
    expect_equal(screenmap[8 * SCREEN_WIDTH], static_cast<BYTE>(0x55),
                 "short-cell ANK following row sentinel");

    reset_renderer(2, 4);
    set_row_coded_pcg8();
    std::memset(&screenmap[8 * SCREEN_WIDTH], 0x55, SCREEN_WIDTH);
    set_pcg_cell(0, false, true);
    width80x20_24khz();
    expect_row_sequence(8, 2, "short-cell PCG8 identity");
    expect_equal(screenmap[8 * SCREEN_WIDTH], static_cast<BYTE>(0x55),
                 "short-cell PCG8 following row sentinel");

    reset_renderer(2, 4);
    set_row_coded_pcg16();
    std::memset(&screenmap[8 * SCREEN_WIDTH], 0x55, SCREEN_WIDTH);
    set_pcg_cell(0, true, true);
    width80x20_24khz();
    expect_row_sequence(8, 1, "short-cell PCG16 identity");
    expect_equal(screenmap[8 * SCREEN_WIDTH], static_cast<BYTE>(0x55),
                 "short-cell PCG16 following row sentinel");

    reset_renderer(2, 4, rows);
    set_row_coded_ank();
    set_ank_cell(rows - 1, false);
    width80x20_24khz();
    expect_row_sequence_at(last_cell_top, 8, 1,
                           "last short ANK cell identity");

    reset_renderer(2, 4, rows);
    set_row_coded_pcg8();
    set_pcg_cell(rows - 1, false, false);
    width80x20_24khz();
    expect_row_sequence_at(last_cell_top, 8, 2,
                           "last short PCG8 cell identity");

    reset_renderer(2, 4, rows);
    set_row_coded_pcg16();
    set_pcg_cell(rows - 1, true, false);
    width80x20_24khz();
    expect_row_sequence_at(last_cell_top, 8, 1,
                           "last short PCG16 cell identity");
}

int main() {
    try {
        test_24khz_ank_pcg_geometry();
        test_24khz_doubled_geometry();
        test_24khz_underlined_geometry();
        test_unaffected_geometries();
        test_ank_pcg_unaffected_geometries();
        test_underline_positions_and_merge();
        test_ank_pcg_underline_merge();
        test_render_row_boundaries();
        test_short_cell_bounds();
        std::cout << "draw_width text glyph tests passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}

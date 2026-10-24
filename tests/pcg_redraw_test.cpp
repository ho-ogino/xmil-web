#include <cstring>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>

#include "COMMON.H"
#include "XMIL.H"
#include "X1.H"
#include "X1_CRTC.H"
#include "X1_PCG.H"
#include "X1_VRAM.H"
#include "draw.h"
#include "draw_sub.h"

// src/X1_PCG.CPP が参照するもの
BYTE TXT_RAM[0x01800];
BYTE ANK_FNT[256][8];
BYTE KNJ_FNT[0x4bc00];
CRTC_TABLE crtc;
X1_FLAG x1flg;
EVENT V_SYNC_event;
EV_TIME H_SYNC_interval = 250;
EV_TIME icount_time[2] = {1, 1};
BYTE scrnallflash;

// フレーム先頭に居ることにする (nowsyncoffset() は TXT_TOP の 0 ライン目を指す)
EV_TIME event_timeleft(EVENT* event) {
    return event->interval;
}

void event_wait_cpu(int, EV_TIME) {}

// platform/draw_width.cpp が参照するもの
BYTE screenmap[SCREEN_WIDTH * SCREEN_HEIGHT];
BYTE blinktest;
BYTE fontlpcnt;
BYTE fonttype;
BYTE vramylpcnt;
BYTE dispflg;
WORD vramsize;
BYTE updatetmp[0x800 + 0x101];
BYTE GRP_RAM[0x20000];
BYTE* dispp = &GRP_RAM[GRAM_BANK0];
BYTE* dispp2 = &GRP_RAM[GRAM_BANK1];
WORD vramylpad;
BYTE g_cli_disable_text;
BYTE g_cli_disable_graph;
BYTE renewalline[SCREEN_HEIGHT + 4];
PALETTE_TABLE xm_palette[256];
int xm_palettes;

void ddraws_change_palette(void) {}

static const BYTE kPatternA[8] = {0x81, 0x42, 0x24, 0x18, 0x81, 0x42, 0x24, 0x18};
static const BYTE kPatternB[8] = {0x18, 0x24, 0x42, 0x81, 0x18, 0x24, 0x42, 0x81};
static const BYTE kChar = 0x56;  // 'V'
static const WORD kPcgSelect = 0x7ff;  // pcg_offset() が見る TRAM 位置

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

static void reset_machine() {
    std::memset(TXT_RAM, 0, sizeof(TXT_RAM));
    std::memset(screenmap, 0, sizeof(screenmap));
    std::memset(updatetmp, 0, sizeof(updatetmp));
    std::memset(&pcg, 0, sizeof(pcg));
    std::memset(&crtc, 0, sizeof(crtc));
    std::memset(&x1flg, 0, sizeof(x1flg));

    init_drawtable();
    blinktest = 0;
    fontlpcnt = 8;
    vramylpcnt = 8;
    fonttype = ANK_24KHz | KNJ_24KHz;
    dispflg = UPDATE_VRAM0;
    vramsize = 1;
    g_cli_disable_text = 0;
    g_cli_disable_graph = 1;
    crtc.TXT_TOP = 0;
    crtc.TXT_XL = 1;
    crtc.TXT_YL = 1;
    crtc.fnty = 8;
    x1flg.HSYNC_CLK = 250;
    V_SYNC_event.interval = 262 * 250;

    // 画面のセル 0 に PCG の 'V' (青)
    TXT_RAM[TEXT_ANK] = kChar;
    TXT_RAM[TEXT_ATR] = X1ATR_PCG | 1;
    // 高速アクセス時に書き込み先の文字を選ぶセル
    TXT_RAM[TEXT_ANK + kPcgSelect] = kChar;
    TXT_RAM[TEXT_ATR + kPcgSelect] = X1ATR_PCG;

    std::memcpy(pcg.B[kChar], kPatternA, 8);
    updatetmp[0] = UPDATE_TVRAM;
    width80x20_24khz();
    scrnallflash = 0;
}

static BYTE displayed_row(int row) {
    BYTE pattern = 0;
    const BYTE* pixels = &screenmap[row * 2 * SCREEN_WIDTH];  // 24kHz: 1 行 = 2 ライン
    for (int bit = 0; bit < 8; bit++) {
        if (pixels[bit] & 0x38) {
            pattern |= static_cast<BYTE>(0x80 >> bit);
        }
    }
    return pattern;
}

static void expect_displayed(const BYTE* pattern, const std::string& label) {
    for (int row = 0; row < 8; row++) {
        expect_equal(displayed_row(row), pattern[row], label + " row " + std::to_string(row));
    }
}

// src/Draw.cpp scrnupdate() と同じ扱い: scrnallflash なら全セルを描き直す
static void next_frame() {
    if (scrnallflash) {
        scrnallflash = 0;
        for (int i = 0; i < 0x800; i++) {
            updatetmp[i] |= UPDATE_TVRAM;
        }
    }
    width80x20_24khz();
}

static void define_blue(const BYTE* pattern) {
    for (int row = 0; row < 8; row++) {
        x1_pcg_w(static_cast<WORD>(0x1500 | (row << 1)), pattern[row]);
    }
}

static void test_redefinition_redraws_visible_cell() {
    reset_machine();
    expect_displayed(kPatternA, "initial");

    crtc.SCRN_BITS |= SCRN_PCGMODE;
    define_blue(kPatternB);
    expect_equal(scrnallflash, 1, "full redraw requested after redefinition");
    next_frame();
    expect_displayed(kPatternB, "after redefinition to B");

    define_blue(kPatternA);
    next_frame();
    expect_displayed(kPatternA, "after redefinition back to A");
}

static void test_same_pattern_does_not_request_redraw() {
    reset_machine();
    crtc.SCRN_BITS |= SCRN_PCGMODE;
    define_blue(kPatternA);
    expect_equal(scrnallflash, 0, "no redraw for unchanged pattern");
}

static void test_sync_access_requests_redraw() {
    reset_machine();
    x1_pcg_w(0x1500, kPatternB[0]);
    expect_equal(pcg.B[kChar][0], kPatternB[0], "sync access stores row 0");
    expect_equal(scrnallflash, 1, "sync access requests full redraw");
}

int main() {
    try {
        test_redefinition_redraws_visible_cell();
        test_same_pattern_does_not_request_redraw();
        test_sync_access_requests_redraw();
        std::cout << "pcg redraw tests passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}

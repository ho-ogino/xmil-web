//----------------------------------------------------------------------------
// X1_VRAM - VRAM I/O Port Handlers (C++ port from inline assembly)
// Original: X1_VRAM.CPP with __asm blocks
// Ported to pure C++ for Emscripten compatibility
//----------------------------------------------------------------------------

#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include "common.h"
#include "x1.h"
#include "x1_crtc.h"
#include "x1_vram.h"
#include "draw.h"
#include "keylog.h"
#include "state_save.h"

// Variables (defined in draw_port.cpp)
extern BYTE updatetmp[0x800+0x101];
extern BYTE scrnflash;
extern BYTE scrnallflash;
extern BYTE doubleatrchange;
extern BYTE palandply;
extern BYTE blinkflag;
extern DWORD drawtime;

// VRAM variables (defined here)
BYTE *curvram;
BYTE curupdt;

// External variables from x1.h
extern DWORD updatemsk;
extern BYTE TXT_RAM[0x01800];
extern BYTE GRP_RAM[0x20000];
extern X1_FLAG x1flg;

static int vram_trace_enabled(void) {
    static int s_init = 0;
    static int s_enabled = 0;
    if (!s_init) {
        const char* env = getenv("XMIL_VRAM_TRACE");
        s_enabled = (env && *env && strcmp(env, "0") != 0) ? 1 : 0;
        s_init = 1;
    }
    return s_enabled;
}

// Initialize VRAM
void init_vram(void) {
    memset(GRP_RAM, 0, 0x20000);
    memset(TXT_RAM, 0, 0x01800);
    memset(&TXT_RAM[TEXT_ATR], 0x07, 0x800);  // White on black
    memset(&TXT_RAM[TEXT_ANK], 0x20, 0x800);  // Spaces
    memset(updatetmp, 0, sizeof(updatetmp));
    curvram = &GRP_RAM[GRAM_BANK0];
    curupdt = UPDATE_VRAM0;
}

// Text VRAM write (port 0x3000-0x3FFF)
X1_IOW x1_txt_w(WORD port, BYTE value) {
    WORD addr = port & 0x7FF;
    BYTE high = (port >> 8) & 0xFF;
    WORD offset;
    BYTE old_value;

    // Determine which RAM area to write to
    if (high < 0x30) {
        // Attribute RAM (0x2800-0x2FFF)
        offset = addr + TEXT_ATR;

        // Check for blink attribute
        if (value & X1ATR_BLINK) {
            blinkflag = 1;
        }

        old_value = TXT_RAM[offset];

        // Check for double size change
        BYTE changed = old_value ^ value;
        if (changed & (X1ATR_Yx2 | X1ATR_Xx2)) {
            doubleatrchange = 1;
        }
    }
    else if (high < 0x38) {
        // ANK character RAM (0x3000-0x37FF)
        offset = addr + TEXT_ANK;
        old_value = TXT_RAM[offset];
    }
    else {
        // Kanji character RAM (0x3800-0x3FFF) - only on X1turbo/turboZ
        if (x1flg.ROM_TYPE < 2) {
            offset = addr + TEXT_ANK;  // Fall back to ANK on older models
        } else {
            offset = addr + TEXT_KNJ;
        }
        old_value = TXT_RAM[offset];
    }

    // Only update if value changed
    if (value != old_value) {
        TXT_RAM[offset] = value;
        scrnflash = 1;

        // Mark update area
        WORD update_addr = addr & 0x7FF;

        // Check for double-width character
        if (TXT_RAM[update_addr + TEXT_ATR] & X1ATR_Xx2) {
            // Match original asm behavior (or word ptr updatetmp[eax], UPDATE_TVRAM*101h):
            // mark current and next byte unconditionally. updatetmp has sentinel area.
            updatetmp[update_addr] |= UPDATE_TVRAM;
            updatetmp[update_addr + 1] |= UPDATE_TVRAM;
        }
        else {
            updatetmp[update_addr] |= UPDATE_TVRAM;
        }
    }
}

// Text VRAM read (port 0x3000-0x3FFF)
X1_IOR x1_txt_r(WORD port) {
    WORD addr = port & 0x7FF;
    BYTE high = (port >> 8) & 0xFF;

    if (high < 0x30) {
        // Attribute RAM
        return TXT_RAM[addr + TEXT_ATR];
    }
    else if (high < 0x38) {
        // ANK character RAM
        return TXT_RAM[addr + TEXT_ANK];
    }
    else {
        // Kanji character RAM (X1turbo/turboZ only)
        if (x1flg.ROM_TYPE < 2) {
            return TXT_RAM[addr + TEXT_ANK];
        } else {
            return TXT_RAM[addr + TEXT_KNJ];
        }
    }
}

// 16-bit rotate left by N (replicates x86 `rol ax, N`)
static inline WORD rol16(WORD v, int n) {
    return (WORD)((v << n) | (v >> (16 - n)));
}

// Graphics VRAM write - 2 planes (port range depends on upper bits)
// Original asm: mov ah,ch; and ah,3Fh; rol ax,5; add eax,curvram
// plane selection: ch<40h→B+R+G, 40-7F→R+G, 80-BF→B+G, C0-FF→B+R
X1_IOW x1_grp_w2(WORD port, BYTE value) {
    WORD addr = (WORD)(port & updatemsk);
    updatetmp[addr] |= curupdt;
    scrnflash = 1;

    // Correct 16-bit address calculation (rol ax, 5)
    // ax = ((port_high & 0x3F) << 8) | port_low
    WORD ax = (WORD)(((((port >> 8) & 0x3F)) << 8) | (port & 0xFF));
    WORD grp_off = rol16(ax, 5);
    BYTE* grp_ptr = curvram + grp_off;

    // Plane selection based on original port high byte
    BYTE ch = (BYTE)(port >> 8);
    if (ch < 0x40) {
        // ch < 0x40: B+R+G
        grp_ptr[PLANE_B] = value;
        grp_ptr[PLANE_R] = value;
        grp_ptr[PLANE_G] = value;
    } else if (ch < 0x80) {
        // ch 0x40-0x7F: R+G
        grp_ptr[PLANE_R] = value;
        grp_ptr[PLANE_G] = value;
    } else if (ch < 0xC0) {
        // ch 0x80-0xBF: B+G
        grp_ptr[PLANE_B] = value;
        grp_ptr[PLANE_G] = value;
    } else {
        // ch 0xC0-0xFF: B+R
        grp_ptr[PLANE_B] = value;
        grp_ptr[PLANE_R] = value;
    }

    if (vram_trace_enabled()) {
        static DWORD s_w2_log = 0;
        if (s_w2_log < 256) {
            keylog_printf("VRAM W2 port=%04X val=%02X off=%04X bank=%u updt=%02X",
                (unsigned int)port, (unsigned int)value, (unsigned int)grp_off,
                (unsigned int)((curvram == &GRP_RAM[GRAM_BANK1]) ? 1 : 0), (unsigned int)curupdt);
            s_w2_log++;
        }
    }
}

// Graphics VRAM write - 1 plane (single byte at rol16(port,5))
// Original asm: xor eax,eax; mov ax,cx; rol ax,5; add eax,curvram
X1_IOW x1_grp_w(WORD port, BYTE value) {
    WORD grp_off = rol16(port, 5);
    BYTE* vram_ptr = curvram + grp_off;

    if (*vram_ptr != value) {
        *vram_ptr = value;
        WORD addr = (WORD)(port & updatemsk);
        updatetmp[addr] |= curupdt;
        scrnflash = 1;

        if (vram_trace_enabled()) {
            static DWORD s_w_log = 0;
            if (s_w_log < 256) {
                keylog_printf("VRAM W  port=%04X val=%02X off=%04X bank=%u updt=%02X",
                    (unsigned int)port, (unsigned int)value, (unsigned int)grp_off,
                    (unsigned int)((curvram == &GRP_RAM[GRAM_BANK1]) ? 1 : 0), (unsigned int)curupdt);
                s_w_log++;
            }
        }
    }
}

// Graphics VRAM read
// Original asm: xor eax,eax; mov ax,cx; rol ax,5; add eax,curvram
X1_IOR x1_grp_r(WORD port) {
    WORD grp_off = rol16(port, 5);
    return curvram[grp_off];
}

/* ---- state save/load ---- */

int vram_save_state(BYTE *buf, int maxlen)
{
    int pos = 0;
    /* curvram as offset from GRP_RAM */
    DWORD curvram_offset = (DWORD)(curvram - GRP_RAM);
    SS_WRITE_U32(buf, pos, curvram_offset);
    SS_WRITE_U8(buf, pos, curupdt);
    SS_WRITE_U32(buf, pos, updatemsk);
    SS_WRITE_U8(buf, pos, scrnallflash);
    SS_WRITE_U8(buf, pos, doubleatrchange);
    SS_WRITE_U8(buf, pos, palandply);
    SS_WRITE_U8(buf, pos, blinkflag);
    return pos;
}

int vram_load_state(const BYTE *buf, int len)
{
    int pos = 0;
    DWORD curvram_offset;
    SS_READ_U32(buf, pos, curvram_offset);
    if (curvram_offset < 0x20000)
        curvram = &GRP_RAM[curvram_offset];
    else
        curvram = &GRP_RAM[GRAM_BANK0];
    SS_READ_U8(buf, pos, curupdt);
    SS_READ_U32(buf, pos, updatemsk);
    SS_READ_U8(buf, pos, scrnallflash);
    SS_READ_U8(buf, pos, doubleatrchange);
    SS_READ_U8(buf, pos, palandply);
    SS_READ_U8(buf, pos, blinkflag);
    /* Force full screen redraw */
    scrnallflash = 1;
    return 0;
}

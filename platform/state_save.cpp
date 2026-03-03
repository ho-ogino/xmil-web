//----------------------------------------------------------------------------
// state_save.cpp — Save/Load state orchestration
// Calls per-device helpers in the correct order (§1.4 of plan)
//----------------------------------------------------------------------------

#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "common.h"
#include "x1.h"
#include "X1_CRTC.H"
#include "X1_8255.H"
#include "X1_SCPU.H"
#include "X1_EMM.H"
#include "X1_SASI.H"
#include "X1_PCG.H"
#include "state_save.h"

// Draw.cpp / PALETTES.CPP の関数（C++ linkage）
// state_save.h の extern "C" ブロックより前に宣言する必要がある
void textdrawproc_renewal(void);
void reflesh_palette(void);

WORD state_load_version = 0;

// --- Section helpers ---

static void write_section(BYTE *buf, int &pos, const char tag[4],
                          const BYTE *data, int datalen)
{
    memcpy(buf + pos, tag, 4);  pos += 4;
    DWORD len = (DWORD)datalen;
    memcpy(buf + pos, &len, 4); pos += 4;
    if (datalen > 0) {
        memcpy(buf + pos, data, datalen);
        pos += datalen;
    }
}

static void write_end(BYTE *buf, int &pos)
{
    memcpy(buf + pos, "END!", 4); pos += 4;
    DWORD zero = 0;
    memcpy(buf + pos, &zero, 4); pos += 4;
}

// find_section: scan from startpos for a section with matching tag.
// Returns pointer to section data, sets out_len. NULL if not found.
static const BYTE* find_section(const BYTE *buf, int size, int startpos,
                                const char *want_tag, int &out_len)
{
    int pos = startpos;
    while (pos + 8 <= size) {
        char tag[4];
        memcpy(tag, buf + pos, 4); pos += 4;
        DWORD len;
        memcpy(&len, buf + pos, 4); pos += 4;
        if (pos + (int)len > size) return NULL;
        if (memcmp(tag, "END!", 4) == 0) return NULL;
        if (memcmp(tag, want_tag, 4) == 0) {
            out_len = (int)len;
            return buf + pos;
        }
        pos += (int)len;
    }
    return NULL;
}

// --- Externs ---

extern BYTE mMAIN[0x10000];
extern BYTE mBANK[16][0x8000];
extern BYTE GRP_RAM[0x20000];
extern BYTE TXT_RAM[0x01800];
extern BYTE scrnallflash;
extern BYTE palandply;

// --- Scratch buffer ---

#define SECTION_BUF_SIZE  (0x100000)  // 1MB

// --- Save ---

BYTE* save_full_state(int *out_size)
{
    // Allocate output: header(8) + ~30 sections * (8+data) + end(8)
    // Largest: BANK=512KB, GVRA=128KB, MRAM=64KB → ~800KB total
    int alloc_size = 0x100000; // 1MB
    BYTE *buf = (BYTE*)malloc(alloc_size);
    if (!buf) { *out_size = 0; return NULL; }

    BYTE *scratch = (BYTE*)malloc(SECTION_BUF_SIZE);
    if (!scratch) { free(buf); *out_size = 0; return NULL; }

    int pos = 0;
    int n;

    // Header
    memcpy(buf + pos, STATE_MAGIC, 4); pos += 4;
    WORD ver = STATE_VERSION;
    memcpy(buf + pos, &ver, 2); pos += 2;
    WORD flags = (WORD)(x1flg.ROM_TYPE & 0x03);
    memcpy(buf + pos, &flags, 2); pos += 2;

    // FLAG (x1flg, lastmem, v_cnt, flame, events)
    n = x1_save_state(scratch, SECTION_BUF_SIZE);
    write_section(buf, pos, "FLAG", scratch, n);

    // Memory
    write_section(buf, pos, "MRAM", mMAIN, 0x10000);
    write_section(buf, pos, "BANK", (BYTE*)mBANK, sizeof(mBANK));
    write_section(buf, pos, "GVRA", GRP_RAM, 0x20000);
    write_section(buf, pos, "TVRA", TXT_RAM, 0x01800);

    // Event base
    n = event_save_state(scratch, SECTION_BUF_SIZE);
    write_section(buf, pos, "EVNT", scratch, n);

    // Z80
    n = z80w_save_state(scratch, SECTION_BUF_SIZE);
    write_section(buf, pos, "Z80C", scratch, n);

    // Devices
    n = ctc_save_state(scratch, SECTION_BUF_SIZE);
    write_section(buf, pos, "CTC0", scratch, n);

    n = fdc_save_state(scratch, SECTION_BUF_SIZE);
    write_section(buf, pos, "FDC0", scratch, n);

    n = fdd2d_save_state(scratch, SECTION_BUF_SIZE);
    write_section(buf, pos, "FD2D", scratch, n);

    n = fddd88_save_state(scratch, SECTION_BUF_SIZE);
    write_section(buf, pos, "FD88", scratch, n);

    n = dma_save_state(scratch, SECTION_BUF_SIZE);
    write_section(buf, pos, "DMA0", scratch, n);

    n = cmt_save_state(scratch, SECTION_BUF_SIZE);
    write_section(buf, pos, "CMT0", scratch, n);

    n = sio_save_state(scratch, SECTION_BUF_SIZE);
    write_section(buf, pos, "SIO0", scratch, n);

    // Simple struct devices
    n = ppi_save_state(scratch, SECTION_BUF_SIZE);
    write_section(buf, pos, "8255", scratch, n);
    write_section(buf, pos, "SCPU", (BYTE*)&scpu, sizeof(scpu));
    write_section(buf, pos, "EMM0", (BYTE*)&emm, sizeof(emm));
    write_section(buf, pos, "SASI", (BYTE*)&sasi, sizeof(sasi));
    write_section(buf, pos, "PCG0", (BYTE*)&pcg, sizeof(pcg));

    // CRTC (struct + palettes)
    {
        int cp = 0;
        SS_WRITE(scratch, cp, &crtc, sizeof(crtc));
        SS_WRITE(scratch, cp, crtc_TEXTPAL, sizeof(crtc_TEXTPAL));
        SS_WRITE(scratch, cp, crtc_GRPHPAL, sizeof(crtc_GRPHPAL));
        SS_WRITE(scratch, cp, crtc_PAL4096, sizeof(crtc_PAL4096));
        write_section(buf, pos, "CRTC", scratch, cp);
    }

    // IRQ
    n = irq_save_state(scratch, SECTION_BUF_SIZE);
    write_section(buf, pos, "IRQ0", scratch, n);

    // OPM
    n = opm_save_state(scratch, SECTION_BUF_SIZE);
    write_section(buf, pos, "OPM0", scratch, n);

    // OPM timers
    n = opmcore_save_state(scratch, SECTION_BUF_SIZE);
    write_section(buf, pos, "OPMC", scratch, n);

    // PSG
    n = psg_save_state(scratch, SECTION_BUF_SIZE);
    write_section(buf, pos, "PSG0", scratch, n);

    // Sound I/O latches
    n = snd_save_state(scratch, SECTION_BUF_SIZE);
    write_section(buf, pos, "SND0", scratch, n);

    // FDD motor
    n = fddmtr_save_state(scratch, SECTION_BUF_SIZE);
    write_section(buf, pos, "FMTR", scratch, n);

    // Timer
    n = timer_save_state(scratch, SECTION_BUF_SIZE);
    write_section(buf, pos, "TIMR", scratch, n);

    // VRAM control
    n = vram_save_state(scratch, SECTION_BUF_SIZE);
    write_section(buf, pos, "VRAM", scratch, n);

    // End marker
    write_end(buf, pos);

    free(scratch);

    // Shrink to actual size
    BYTE *result = (BYTE*)realloc(buf, pos);
    if (!result) result = buf;
    *out_size = pos;
    return result;
}

// --- Load ---

// Load a tagged section via device helper function.
// Returns 0 on success or section-not-found (forward compat), -1 on error.
static int load_section(const BYTE *buf, int size, int body,
                        const char *tag, int (*loader)(const BYTE*, int))
{
    int len = 0;
    const BYTE *data = find_section(buf, size, body, tag, len);
    if (!data) return 0;
    return loader(data, len);
}

// Load a tagged section as raw memory copy.
static void load_memory(const BYTE *buf, int size, int body,
                        const char *tag, void *dst, int dst_size)
{
    int len = 0;
    const BYTE *data = find_section(buf, size, body, tag, len);
    if (!data) return;
    int copy = (len < dst_size) ? len : dst_size;
    memcpy(dst, data, copy);
}

// Failed-section warning buffer (read by js_get_load_warnings)
static char s_load_warnings[256];

const char* get_load_warnings(void) { return s_load_warnings; }

// Helper: try load_section, on failure record tag and continue
static void load_section_warn(const BYTE *buf, int size, int body,
                              const char *tag, int (*loader)(const BYTE*, int),
                              char *warn, int warnmax)
{
    if (load_section(buf, size, body, tag, loader) < 0) {
        int wl = (int)strlen(warn);
        if (wl > 0 && wl + 1 < warnmax) { warn[wl] = ','; warn[wl+1] = '\0'; wl++; }
        int tl = (int)strlen(tag);
        if (wl + tl < warnmax) { memcpy(warn + wl, tag, tl); warn[wl + tl] = '\0'; }
    }
}

int load_full_state(const BYTE *data, int size)
{
    s_load_warnings[0] = '\0';

    if (size < 8) return -1;

    // --- Header ---
    if (memcmp(data, STATE_MAGIC, 4) != 0) return -1;
    WORD ver;
    memcpy(&ver, data + 4, 2);
    if (ver > STATE_VERSION) return -1;
    // flags bit0-1 = ROM_TYPE
    WORD flags;
    memcpy(&flags, data + 6, 2);
    int rom_type_mismatch = ((flags & 0x03) != (x1flg.ROM_TYPE & 0x03)) ? 1 : 0;

    state_load_version = ver;

    int body = 8;
    char *warn = s_load_warnings;
    int wmax = (int)sizeof(s_load_warnings);

    // ====================================================================
    // Restore order:
    //
    //  1. Memory (MRAM, BANK, GVRA, TVRA) — raw memcpy, no dependencies
    //  2. Event base (event_load_state)
    //       → event_init(1), event_setup_cpu(), restore base_time/time/global_count
    //       → MUST be before any event_set() calls from device loaders
    //  3. Z80 CPU → restore Z80_ICount BEFORE any event_set()
    //       → event_set() uses absolutetime() = cpu.time + Z80_ICount * icount_time
    //       → if Z80_ICount is stale, all event expire times will be wrong
    //  4. FLAG + X1 core events (x1_load_state)
    //       → restores x1flg, lastmem, rebuilds RAM0r/RAM0w
    //       → re-registers V_SYNC_event, DISP_event, scpu_event
    //  5. Devices with events (CTC, FDC, CMT, DMA)
    //  6. Simple struct devices (FD2D, FD88, SIO, 8255, SCPU, EMM, SASI, PCG)
    //  7. CRTC (struct + palettes)
    //  8. IRQ → irq_update_int_pin()
    //  9. OPM (REGS mirror replay)
    // 10. OPM timers
    // 11. PSG
    // 12. Sound I/O latches
    // 13. FDD motor (delta-based)
    // 14. Timer (delta-based)
    // 15. VRAM control (curvram pointer rebuild)
    // 16. Force full screen redraw
    // ====================================================================

    // 1. Memory
    load_memory(data, size, body, "MRAM", mMAIN, 0x10000);
    load_memory(data, size, body, "BANK", mBANK, sizeof(mBANK));
    load_memory(data, size, body, "GVRA", GRP_RAM, 0x20000);
    load_memory(data, size, body, "TVRA", TXT_RAM, 0x01800);

    // 2. Event base
    load_section_warn(data, size, body, "EVNT", event_load_state, warn, wmax);

    // 3. Z80 CPU — MUST be before any event_set() calls (FLAG, CTC, FDC, etc.)
    //    because event_set() uses absolutetime() which reads Z80_ICount.
    //    If Z80_ICount is stale, all event expire times will be wrong.
    load_section_warn(data, size, body, "Z80C", z80w_load_state, warn, wmax);

    // 4. FLAG + X1 core events (called AFTER event base + Z80 so event_set works)
    load_section_warn(data, size, body, "FLAG", x1_load_state, warn, wmax);

    // 5. Devices with events
    load_section_warn(data, size, body, "CTC0", ctc_load_state, warn, wmax);
    load_section_warn(data, size, body, "FDC0", fdc_load_state, warn, wmax);
    load_section_warn(data, size, body, "CMT0", cmt_load_state, warn, wmax);
    load_section_warn(data, size, body, "DMA0", dma_load_state, warn, wmax);

    // 6. Simple struct devices
    load_section_warn(data, size, body, "FD2D", fdd2d_load_state, warn, wmax);
    load_section_warn(data, size, body, "FD88", fddd88_load_state, warn, wmax);
    load_section_warn(data, size, body, "SIO0", sio_load_state, warn, wmax);
    load_section_warn(data, size, body, "8255", ppi_load_state, warn, wmax);
    load_memory(data, size, body, "SCPU", &scpu, sizeof(scpu));
    load_memory(data, size, body, "EMM0", &emm, sizeof(emm));
    load_memory(data, size, body, "SASI", &sasi, sizeof(sasi));
    load_memory(data, size, body, "PCG0", &pcg, sizeof(pcg));

    // 7. CRTC
    {
        int len = 0;
        const BYTE *sec = find_section(data, size, body, "CRTC", len);
        if (sec) {
            int cp = 0;
            int expected = (int)(sizeof(crtc) + sizeof(crtc_TEXTPAL) +
                                 sizeof(crtc_GRPHPAL) + sizeof(crtc_PAL4096));
            if (len >= expected) {
                SS_READ(sec, cp, &crtc, sizeof(crtc));
                SS_READ(sec, cp, crtc_TEXTPAL, sizeof(crtc_TEXTPAL));
                SS_READ(sec, cp, crtc_GRPHPAL, sizeof(crtc_GRPHPAL));
                SS_READ(sec, cp, crtc_PAL4096, sizeof(crtc_PAL4096));
            }
        }
    }

    // 8. IRQ
    load_section_warn(data, size, body, "IRQ0", irq_load_state, warn, wmax);

    // 9. OPM (REGS mirror replay via OPMWriteReg)
    load_section_warn(data, size, body, "OPM0", opm_load_state, warn, wmax);

    // 10. OPM timers
    load_section_warn(data, size, body, "OPMC", opmcore_load_state, warn, wmax);

    // 11. PSG
    load_section_warn(data, size, body, "PSG0", psg_load_state, warn, wmax);

    // 12. Sound I/O latches
    load_section_warn(data, size, body, "SND0", snd_load_state, warn, wmax);

    // 13. FDD motor (delta-based GetTickCount)
    load_section_warn(data, size, body, "FMTR", fddmtr_load_state, warn, wmax);

    // 14. Timer (delta-based GetTickCount)
    load_section_warn(data, size, body, "TIMR", timer_load_state, warn, wmax);

    // 15. VRAM control
    load_section_warn(data, size, body, "VRAM", vram_load_state, warn, wmax);

    // 16. Recalculate derived display mode from restored CRTC registers.
    //     dispmode, pal_bank, pal_disp are globals in X1_CRTC.CPP that
    //     are NOT part of the crtc struct — they must be recomputed here.
    vrambank_patch();

    // 17. Rebuild font type selection from restored CRTC state
    textdrawproc_renewal();

    // 18. Rebuild display palette tables from restored palette data
    reflesh_palette();

    // 19. Force full screen redraw + palette recalculation
    scrnallflash = 1;
    palandply = 1;  // crtc.PLY 復元値をパレットテーブルに反映

    // 0 = success, 1 = success but ROM_TYPE mismatch (warning)
    return rom_type_mismatch;
}

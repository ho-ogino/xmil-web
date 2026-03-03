//----------------------------------------------------------------------------
// X1_DMAM - DMA transfer main routine (C++ port of T_TUNE asm path)
//----------------------------------------------------------------------------

#include <windows.h>
#include <stdlib.h>
#include <stdio.h>

#ifdef FDC_DMA_TRACE
#include <emscripten.h>
#endif

#include "X1_IO.H"
#include "X1_DMA.H"
#include "X1_DMAM.H"
#include "X1_irq.h"
#include "keylog.h"

// Z80 cycle counter (defined in z80_wrapper.cpp)
extern WORD Z80_ICount;

typedef BYTE (__fastcall *dma_src_func_t)(WORD);
typedef void (__fastcall *dma_dst_func_t)(WORD, BYTE);

static inline void add_z80_icount(WORD delta) {
    unsigned int sum = (unsigned int)Z80_ICount + (unsigned int)delta;
    Z80_ICount = (sum > 0xFFFFu) ? 0xFFFFu : (WORD)sum;
}

static int dma_trace_enabled(void) {
    static int s_init = 0;
    static int s_enabled = 0;
    if (!s_init) {
        const char* env = getenv("XMIL_DMA_TRACE");
        s_enabled = (env && *env && strcmp(env, "0") != 0) ? 1 : 0;
        s_init = 1;
    }
    return s_enabled;
}

void x1_dma(void) {
    BYTE gate = (BYTE)(dma.DMA_CMND & dma.DMA_ENBL & dma.RETI_ENBL);
    if (!gate) {
        return;
    }
    if (dma.ENDB_FLG) {
        return;
    }
    if ((gate & 2) && dma.MACH_FLG) {
        return;
    }

    if (dma.DMA_MODE != 1) {
        BYTE ready = (BYTE)((dma.WR[5] ^ dma.DMA_REDY) & 0x08);
        if (ready) {
            return;
        }
        // non-continuous mode penalty (matches asm: add Z80_ICount,3)
        add_z80_icount(3);
    }
#ifdef FDC_DMA_TRACE
    else {
        // MODE=1 skips RDY check — log if RDY is not asserted
        BYTE ready_m1 = (BYTE)((dma.WR[5] ^ dma.DMA_REDY) & 0x08);
        if (ready_m1) {
            EM_ASM({console.log('DMA MODE1 ENTRY: RDY not asserted! REDY='+$0+' WR5='+$1.toString(16)+' CNT_A='+$2.toString(16)+' CNT_B='+$3.toString(16))},
                dma.DMA_REDY, dma.WR[5], dma.CNT_A.w, dma.CNT_B.w);
        }
    }
#endif

    WORD* src_cnt = dma_src_cnt_ptr;
    WORD* dst_cnt = dma_dst_cnt_ptr;
    dma_src_func_t src_func = (dma_src_func_t)dma_src_func;
    dma_dst_func_t dst_func = (dma_dst_func_t)dma_dst_func;

    for (;;) {
        if (dma.ENDB_FLG) {
            break;
        }
        if ((dma.DMA_CMND & 2) && dma.MACH_FLG) {
            break;
        }

        add_z80_icount(dma_cycles);

        WORD dst_addr = *dst_cnt;
        WORD src_addr = *src_cnt;
        BYTE data = src_func(src_addr);
        dst_func(dst_addr, data);
#ifdef FDC_DMA_TRACE
        {
            static WORD trc_last_dst = 0xFFFF;
            static DWORD trc_dma_log_count = 0;
            if ((dst_addr != (WORD)(trc_last_dst + 1) && trc_last_dst != 0xFFFF) ||
                (trc_dma_log_count % 256 == 0)) {
                EM_ASM({console.log('DMA XFER: dst='+$0.toString(16)+' BYTN='+$1.toString(16)+' BYTL='+$2.toString(16)+' REDY='+$3)},
                    (unsigned)dst_addr, (unsigned)dma.BYT_N.w, (unsigned)dma.BYT_L.w, dma.DMA_REDY);
            }
            trc_last_dst = dst_addr;
            trc_dma_log_count++;
        }
#endif
        if (dma_trace_enabled()) {
            static DWORD s_dma_log = 0;
            if (s_dma_log < 256) {
                keylog_printf("DMA XFER src=%04X dst=%04X data=%02X mode=%u cmd=%02X bytn=%04X",
                    (unsigned int)src_addr, (unsigned int)dst_addr, (unsigned int)data,
                    (unsigned int)dma.DMA_MODE, (unsigned int)dma.DMA_CMND, (unsigned int)dma.BYT_N.w);
                s_dma_log++;
            }
        }

        if (dma.DMA_CMND & 2) {
            BYTE cmp = (BYTE)((data ^ dma.MACH_BYT) & (BYTE)(~dma.MASK_BYT));
            if (cmp == 0) {
                dma.MACH_FLG = 1;
            }
        }

        *src_cnt = (WORD)(*src_cnt + dma_src_upcount);

        // Z80-DMA: BYT_N is 0-based index of last transferred byte.
        // Initialized to 0xFFFF by LOAD/CONTINUE, so first increment → 0.
        // BYT_L=0 means "no byte-count termination" (transfer relies on RDY).
        // Guard (BYT_N != 0) prevents false match on the first transfer.
        dma.BYT_N.w = (WORD)(dma.BYT_N.w + 1);
        if ((dma.BYT_N.w != 0) && (dma.BYT_N.w == dma.BYT_L.w)) {
            dma.ENDB_FLG = 1;
            break;
        }

        *dst_cnt = (WORD)(*dst_cnt + dma_dst_upcount);

        if (dma.DMA_MODE != 1) {
            BYTE ready = (BYTE)((dma.WR[5] ^ dma.DMA_REDY) & 0x08);
            if (ready) {
                break;
            }
        }

        if (dma.DMA_MODE == 0) {
            break;
        }
    }

    if (!dma.INT_ENBL) {
        return;
    }

    BYTE irq_bits = 0x02;
    BYTE int_flg = dma.INT_FLG;

    if (!(int_flg & 0x01) || !dma.MACH_FLG) {
        irq_bits = 0x04;
        if (!(int_flg & 0x02) || !dma.ENDB_FLG) {
            return;
        }
    }

    BYTE vector = dma.INT_VCT;
    if (int_flg & 0x20) {
        vector = (BYTE)((vector & 0xF9) | irq_bits);
    }
    dma.NXT_VECTOR = vector;
    Z80_set_irq_line(DEVICE_DMA);
}

//----------------------------------------------------------------------------
//  Z80 Wrapper for chips Z80 emulator
//  Bridges chips z80.h to X1 emulator interface
//  SDL2 build version
//----------------------------------------------------------------------------

#define CHIPS_IMPL
#include "z80.h"

#include <stdio.h>
#include <string.h>
#include "platform_types.h"
#include "state_save.h"
#include "X1_IO.H"
#include "X1_DMA.H"
#include "X1_DMAM.H"
#include "x1_irq.h"

// X1 memory and I/O functions (will be linked from X1 code)
BYTE __fastcall Z80_RDMEM(WORD adrs);
void __fastcall Z80_WRMEM(WORD adrs, BYTE value);
BYTE __fastcall Z80_In(WORD port);
void __fastcall Z80_Out(WORD port, BYTE value);

// T_TUNEイベントシステムとの連携
// BreakICount: 次のイベントまでのT-state数（X1_event.cppで定義）
extern unsigned short BreakICount;

// Z80 CPU state
static z80_t g_cpu;
static uint64_t g_pins = 0;
static int g_cycles = 0;


// Z80 registers structure (for compatibility with original code)
typedef union {
    struct {
        BYTE l;
        BYTE h;
    } B;
    WORD W;
} z80_pair;

typedef struct {
    z80_pair AF, BC, DE, HL, IX, IY, PC, SP;
    z80_pair AF2, BC2, DE2, HL2;
    BYTE I, IM, R, R2;
    WORD IFF;
} Z80_Regs;

// Global registers (for compatibility)
Z80_Regs R;
WORD Z80_ICount = 0;

static inline void add_z80_icount(WORD delta) {
    unsigned int sum = (unsigned int)Z80_ICount + (unsigned int)delta;
    Z80_ICount = (sum > 0xFFFFu) ? 0xFFFFu : (WORD)sum;
}

// Parity/Sign/Zero table (for compatibility)
BYTE ZSPtable[256] = {
    0x44, 0x00, 0x00, 0x04, 0x00, 0x04, 0x04, 0x00,
    0x00, 0x04, 0x04, 0x00, 0x04, 0x00, 0x00, 0x04,
    0x00, 0x04, 0x04, 0x00, 0x04, 0x00, 0x00, 0x04,
    0x04, 0x00, 0x00, 0x04, 0x00, 0x04, 0x04, 0x00,
    0x00, 0x04, 0x04, 0x00, 0x04, 0x00, 0x00, 0x04,
    0x04, 0x00, 0x00, 0x04, 0x00, 0x04, 0x04, 0x00,
    0x04, 0x00, 0x00, 0x04, 0x00, 0x04, 0x04, 0x00,
    0x00, 0x04, 0x04, 0x00, 0x04, 0x00, 0x00, 0x04,
    0x00, 0x04, 0x04, 0x00, 0x04, 0x00, 0x00, 0x04,
    0x04, 0x00, 0x00, 0x04, 0x00, 0x04, 0x04, 0x00,
    0x04, 0x00, 0x00, 0x04, 0x00, 0x04, 0x04, 0x00,
    0x00, 0x04, 0x04, 0x00, 0x04, 0x00, 0x00, 0x04,
    0x04, 0x00, 0x00, 0x04, 0x00, 0x04, 0x04, 0x00,
    0x00, 0x04, 0x04, 0x00, 0x04, 0x00, 0x00, 0x04,
    0x00, 0x04, 0x04, 0x00, 0x04, 0x00, 0x00, 0x04,
    0x04, 0x00, 0x00, 0x04, 0x00, 0x04, 0x04, 0x00,
    0x80, 0x84, 0x84, 0x80, 0x84, 0x80, 0x80, 0x84,
    0x84, 0x80, 0x80, 0x84, 0x80, 0x84, 0x84, 0x80,
    0x84, 0x80, 0x80, 0x84, 0x80, 0x84, 0x84, 0x80,
    0x80, 0x84, 0x84, 0x80, 0x84, 0x80, 0x80, 0x84,
    0x84, 0x80, 0x80, 0x84, 0x80, 0x84, 0x84, 0x80,
    0x80, 0x84, 0x84, 0x80, 0x84, 0x80, 0x80, 0x84,
    0x80, 0x84, 0x84, 0x80, 0x84, 0x80, 0x80, 0x84,
    0x84, 0x80, 0x80, 0x84, 0x80, 0x84, 0x84, 0x80,
    0x84, 0x80, 0x80, 0x84, 0x80, 0x84, 0x84, 0x80,
    0x80, 0x84, 0x84, 0x80, 0x84, 0x80, 0x80, 0x84,
    0x80, 0x84, 0x84, 0x80, 0x84, 0x80, 0x80, 0x84,
    0x84, 0x80, 0x80, 0x84, 0x80, 0x84, 0x84, 0x80,
    0x80, 0x84, 0x84, 0x80, 0x84, 0x80, 0x80, 0x84,
    0x84, 0x80, 0x80, 0x84, 0x80, 0x84, 0x84, 0x80,
    0x84, 0x80, 0x80, 0x84, 0x80, 0x84, 0x84, 0x80,
    0x80, 0x84, 0x84, 0x80, 0x84, 0x80, 0x80, 0x84
};

// Sync R structure with chips z80_t
static void sync_registers_from_chips() {
    R.AF.B.h = g_cpu.a;
    R.AF.B.l = g_cpu.f;
    R.BC.B.h = g_cpu.b;
    R.BC.B.l = g_cpu.c;
    R.DE.B.h = g_cpu.d;
    R.DE.B.l = g_cpu.e;
    R.HL.B.h = g_cpu.h;
    R.HL.B.l = g_cpu.l;
    R.PC.W = g_cpu.pc;
    R.SP.W = g_cpu.sp;
    R.IX.W = g_cpu.ix;
    R.IY.W = g_cpu.iy;

    R.AF2.W = g_cpu.af2;
    R.BC2.W = g_cpu.bc2;
    R.DE2.W = g_cpu.de2;
    R.HL2.W = g_cpu.hl2;

    R.I = g_cpu.i;
    R.R = g_cpu.r;
    R.IM = g_cpu.im;
    R.IFF = (g_cpu.iff1 ? 1 : 0) | (g_cpu.iff2 ? 2 : 0);
}

static void sync_registers_to_chips() {
    g_cpu.a = R.AF.B.h;
    g_cpu.f = R.AF.B.l;
    g_cpu.b = R.BC.B.h;
    g_cpu.c = R.BC.B.l;
    g_cpu.d = R.DE.B.h;
    g_cpu.e = R.DE.B.l;
    g_cpu.h = R.HL.B.h;
    g_cpu.l = R.HL.B.l;
    g_cpu.pc = R.PC.W;
    g_cpu.sp = R.SP.W;
    g_cpu.ix = R.IX.W;
    g_cpu.iy = R.IY.W;

    g_cpu.af2 = R.AF2.W;
    g_cpu.bc2 = R.BC2.W;
    g_cpu.de2 = R.DE2.W;
    g_cpu.hl2 = R.HL2.W;

    g_cpu.i = R.I;
    g_cpu.r = R.R;
    g_cpu.im = R.IM;
    g_cpu.iff1 = (R.IFF & 1) ? true : false;
    g_cpu.iff2 = (R.IFF & 2) ? true : false;
}

// Reset Z80
void Z80_Reset(void) {

    g_pins = z80_reset(&g_cpu);
    g_cycles = 0;
    Z80_ICount = 0;

    memset(&R, 0, sizeof(Z80_Regs));
    sync_registers_from_chips();
}

// 1クロックティック処理（メモリ/IO/割り込みアック）
static inline void handle_tick(void) {
    // RETI命令検出
    if (g_pins & Z80_RETI) {
        Z80_irq_reti();
    }

    // Handle memory request
    if (g_pins & Z80_MREQ) {
        const WORD addr = Z80_GET_ADDR(g_pins);
        if (g_pins & Z80_RD) {
            Z80_SET_DATA(g_pins, Z80_RDMEM(addr));
        } else if (g_pins & Z80_WR) {
            Z80_WRMEM(addr, Z80_GET_DATA(g_pins));
        }
    }
    // Handle I/O request
    else if (g_pins & Z80_IORQ) {
        if (g_pins & Z80_M1) {
            // 割り込みアックノレッジサイクル (IORQ+M1)
            // ここで初めてベクタフェッチ＋IEOロックを実行する（実機タイミング）
            BYTE vector = Z80_irq_vector_fetch();
            Z80_SET_DATA(g_pins, vector);
            // INT pin state is updated by irq_update_int_pin() inside
            // the vector_r callback (via Z80_clear_irq_line + Z80_set_ieo_line)
        } else {
            const WORD port = Z80_GET_ADDR(g_pins);
            if (g_pins & Z80_RD) {
                Z80_SET_DATA(g_pins, Z80_In(port));
            } else if (g_pins & Z80_WR) {
                Z80_Out(port, Z80_GET_DATA(g_pins));
            }
        }
    }
}

// Execute Z80 for cycles_to_run T-states
void Z80_Execute(void) {
    // INT pin is managed reactively by irq_update_int_pin() in X1_irq.cpp.
    // chips z80.h samples INT at instruction boundaries and enters IORQ+M1
    // when IFF1 is set. Vector fetch happens in handle_tick() at that time.
    do {
        if ((dma.DMA_CMND & 3) && dma.DMA_ENBL) {
            x1_dma();
        }
        int inst_cycles = 0;
        do {
            g_pins = z80_tick(&g_cpu, g_pins);
            inst_cycles++;
            handle_tick();
        } while (!z80_opdone(&g_cpu));
        add_z80_icount((WORD)inst_cycles);
        g_cycles += inst_cycles;
    } while (Z80_ICount < BreakICount);

    sync_registers_from_chips();
}

// Execute one Z80 instruction (T_TUNE mode)
void Z80_ExecuteOne(void) {
    int inst_cycles = 0;
    do {
        g_pins = z80_tick(&g_cpu, g_pins);
        inst_cycles++;
        handle_tick();
    } while (!z80_opdone(&g_cpu));
    add_z80_icount((WORD)inst_cycles);
    g_cycles += inst_cycles;
    // Match original T_TUNE path: execute DMA service after one instruction.
    x1_dma();
    sync_registers_from_chips();
}

// Check if interrupts are enabled
BYTE Z80_Able_interrupt(void) {
    return g_cpu.iff1 ? 1 : 0;
}

// INT pin control — called from X1_irq.cpp::irq_update_int_pin()
// Level-sensitive: asserted when daisy-chain has a serviceable request,
// regardless of IFF state. chips z80.h checks IFF internally.
void Z80_assert_int(int assert_int) {
    if (assert_int)
        g_pins |= Z80_INT;
    else
        g_pins &= ~Z80_INT;
}

// Legacy: trigger maskable interrupt (non-T_TUNE path only)
// Daisy-chain ベクタフェッチ (Z80_irq_vector_fetch) で処理されるため、
// ここでは INT ピンをアサートするだけ。
void __fastcall Z80_Cause_Interrupt(BYTE irq) {
    (void)irq;  // ベクタは Z80_irq_vector_fetch() 経由で取得される
    g_pins |= Z80_INT;
}

void __fastcall Z80_Cause_Interrupt2(BYTE irq) {
    Z80_Cause_Interrupt(irq);
}

// Trigger non-maskable interrupt
void Z80_NonMaskedInterrupt(void) {
    g_pins |= Z80_NMI;
}

// ---- state save/load helpers ----

int z80w_save_state(BYTE *buf, int maxlen) {
    int pos = 0;

    // z80_t internal decoder state
    SS_WRITE_U16(buf, pos, g_cpu.step);
    SS_WRITE_U16(buf, pos, g_cpu.addr);
    SS_WRITE_U8(buf, pos, g_cpu.dlatch);
    SS_WRITE_U8(buf, pos, g_cpu.opcode);
    SS_WRITE_U8(buf, pos, g_cpu.hlx_idx);
    SS_WRITE_U8(buf, pos, g_cpu.prefix_active ? 1 : 0);
    SS_WRITE_U64(buf, pos, g_cpu.pins);
    SS_WRITE_U64(buf, pos, g_cpu.int_bits);

    // main registers
    SS_WRITE_U8(buf, pos, g_cpu.a);
    SS_WRITE_U8(buf, pos, g_cpu.f);
    SS_WRITE_U8(buf, pos, g_cpu.b);
    SS_WRITE_U8(buf, pos, g_cpu.c);
    SS_WRITE_U8(buf, pos, g_cpu.d);
    SS_WRITE_U8(buf, pos, g_cpu.e);
    SS_WRITE_U8(buf, pos, g_cpu.h);
    SS_WRITE_U8(buf, pos, g_cpu.l);
    SS_WRITE_U16(buf, pos, g_cpu.ix);
    SS_WRITE_U16(buf, pos, g_cpu.iy);
    SS_WRITE_U16(buf, pos, g_cpu.wz);
    SS_WRITE_U16(buf, pos, g_cpu.sp);
    SS_WRITE_U16(buf, pos, g_cpu.pc);
    SS_WRITE_U8(buf, pos, g_cpu.r);
    SS_WRITE_U8(buf, pos, g_cpu.i);
    SS_WRITE_U8(buf, pos, g_cpu.im);

    // shadow registers
    SS_WRITE_U16(buf, pos, g_cpu.af2);
    SS_WRITE_U16(buf, pos, g_cpu.bc2);
    SS_WRITE_U16(buf, pos, g_cpu.de2);
    SS_WRITE_U16(buf, pos, g_cpu.hl2);

    // bool flags as u8 (ABI safety)
    SS_WRITE_U8(buf, pos, g_cpu.iff1 ? 1 : 0);
    SS_WRITE_U8(buf, pos, g_cpu.iff2 ? 1 : 0);

    // wrapper globals
    SS_WRITE_U64(buf, pos, g_pins);
    SS_WRITE_I32(buf, pos, g_cycles);
    SS_WRITE_U16(buf, pos, Z80_ICount);

    return pos;
}

int z80w_load_state(const BYTE *buf, int len) {
    int pos = 0;

    // z80_t internal decoder state
    SS_READ_U16(buf, pos, g_cpu.step);
    SS_READ_U16(buf, pos, g_cpu.addr);
    SS_READ_U8(buf, pos, g_cpu.dlatch);
    SS_READ_U8(buf, pos, g_cpu.opcode);
    SS_READ_U8(buf, pos, g_cpu.hlx_idx);
    { BYTE tmp; SS_READ_U8(buf, pos, tmp); g_cpu.prefix_active = (tmp != 0); }
    SS_READ_U64(buf, pos, g_cpu.pins);
    SS_READ_U64(buf, pos, g_cpu.int_bits);

    // main registers
    SS_READ_U8(buf, pos, g_cpu.a);
    SS_READ_U8(buf, pos, g_cpu.f);
    SS_READ_U8(buf, pos, g_cpu.b);
    SS_READ_U8(buf, pos, g_cpu.c);
    SS_READ_U8(buf, pos, g_cpu.d);
    SS_READ_U8(buf, pos, g_cpu.e);
    SS_READ_U8(buf, pos, g_cpu.h);
    SS_READ_U8(buf, pos, g_cpu.l);
    SS_READ_U16(buf, pos, g_cpu.ix);
    SS_READ_U16(buf, pos, g_cpu.iy);
    SS_READ_U16(buf, pos, g_cpu.wz);
    SS_READ_U16(buf, pos, g_cpu.sp);
    SS_READ_U16(buf, pos, g_cpu.pc);
    SS_READ_U8(buf, pos, g_cpu.r);
    SS_READ_U8(buf, pos, g_cpu.i);
    SS_READ_U8(buf, pos, g_cpu.im);

    // shadow registers
    SS_READ_U16(buf, pos, g_cpu.af2);
    SS_READ_U16(buf, pos, g_cpu.bc2);
    SS_READ_U16(buf, pos, g_cpu.de2);
    SS_READ_U16(buf, pos, g_cpu.hl2);

    // bool flags from u8
    { BYTE tmp; SS_READ_U8(buf, pos, tmp); g_cpu.iff1 = (tmp != 0); }
    { BYTE tmp; SS_READ_U8(buf, pos, tmp); g_cpu.iff2 = (tmp != 0); }

    // wrapper globals
    SS_READ_U64(buf, pos, g_pins);
    SS_READ_I32(buf, pos, g_cycles);
    SS_READ_U16(buf, pos, Z80_ICount);

    // sync the compatibility R struct from restored chips state
    sync_registers_from_chips();

    return 0;
}

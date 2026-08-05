#ifndef XMIL_DEBUGGER_CORE_H
#define XMIL_DEBUGGER_CORE_H

#include <stdint.h>

enum DebuggerRunState {
    DEBUGGER_RUNNING = 0,
    DEBUGGER_PAUSED = 1
};

enum DebuggerStopReason {
    DEBUGGER_STOP_NONE = 0,
    DEBUGGER_STOP_MANUAL = 1,
    DEBUGGER_STOP_BREAKPOINT = 2,
    DEBUGGER_STOP_STEP = 3
};

enum DebuggerMemoryMapping {
    DEBUGGER_MEMORY_MAIN = 0,
    DEBUGGER_MEMORY_BIOS = 1,
    DEBUGGER_MEMORY_BANK = 2
};

enum DebuggerStateWord {
    DEBUGGER_STATE_VERSION = 0,
    DEBUGGER_STATE_WORD_COUNT,
    DEBUGGER_STATE_SEQUENCE,
    DEBUGGER_STATE_RUN_STATE,
    DEBUGGER_STATE_STOP_REASON,
    DEBUGGER_STATE_STOP_ADDRESS,
    DEBUGGER_STATE_BREAKPOINT_COUNT,
    DEBUGGER_STATE_EMULATOR_RUNNING,
    DEBUGGER_STATE_AF,
    DEBUGGER_STATE_BC,
    DEBUGGER_STATE_DE,
    DEBUGGER_STATE_HL,
    DEBUGGER_STATE_IX,
    DEBUGGER_STATE_IY,
    DEBUGGER_STATE_PC,
    DEBUGGER_STATE_SP,
    DEBUGGER_STATE_AF2,
    DEBUGGER_STATE_BC2,
    DEBUGGER_STATE_DE2,
    DEBUGGER_STATE_HL2,
    DEBUGGER_STATE_I,
    DEBUGGER_STATE_R,
    DEBUGGER_STATE_IM,
    DEBUGGER_STATE_IFF1,
    DEBUGGER_STATE_IFF2,
    DEBUGGER_STATE_CYCLES,
    DEBUGGER_STATE_LOW_MEMORY_MAPPING,
    DEBUGGER_STATE_LOW_MEMORY_BANK,
    DEBUGGER_STATE_ROM_TYPE,
    DEBUGGER_STATE_ROM_SWITCH,
    DEBUGGER_STATE_LASTMEM,
    DEBUGGER_STATE_WORDS
};

struct Z80DebugRegisters {
    uint16_t af;
    uint16_t bc;
    uint16_t de;
    uint16_t hl;
    uint16_t ix;
    uint16_t iy;
    uint16_t pc;
    uint16_t sp;
    uint16_t af2;
    uint16_t bc2;
    uint16_t de2;
    uint16_t hl2;
    uint8_t i;
    uint8_t r;
    uint8_t im;
    uint8_t iff1;
    uint8_t iff2;
    uint32_t cycles;
};

struct DebuggerStatus {
    uint32_t sequence;
    DebuggerRunState state;
    DebuggerStopReason stop_reason;
    uint16_t stop_address;
    uint32_t breakpoint_count;
};

bool debugger_is_paused();
void debugger_pause(uint16_t pc);
void debugger_resume(uint16_t pc);
bool debugger_begin_step(uint16_t pc);
bool debugger_should_stop_before_instruction(uint16_t pc);
bool debugger_after_instruction(uint16_t pc);
bool debugger_replace_breakpoints(const uint16_t *addresses, int count);
void debugger_on_machine_reset(uint16_t pc);
DebuggerStatus debugger_get_status();

uint16_t z80w_get_pc();
void z80w_get_debug_registers(Z80DebugRegisters *registers);

#endif

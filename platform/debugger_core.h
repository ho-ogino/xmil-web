#ifndef XMIL_DEBUGGER_CORE_H
#define XMIL_DEBUGGER_CORE_H

#include <stdint.h>

// C++-only debugger core interface. JavaScript calls the js_debug_* wrappers
// exported from platform_main.cpp rather than these functions directly.

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

enum DebuggerVideoStateWord {
    DEBUGGER_VIDEO_STATE_VERSION = 0,
    DEBUGGER_VIDEO_STATE_WORD_COUNT,
    DEBUGGER_VIDEO_STATE_ROM_TYPE,
    DEBUGGER_VIDEO_STATE_SCREEN_BITS,
    DEBUGGER_VIDEO_STATE_DISPLAY_BANK,
    DEBUGGER_VIDEO_STATE_ACCESS_BANK,
    DEBUGGER_VIDEO_STATE_TEXT_COLUMNS,
    DEBUGGER_VIDEO_STATE_TEXT_ROWS,
    DEBUGGER_VIDEO_STATE_GRAPHICS_WIDTH,
    DEBUGGER_VIDEO_STATE_GRAPHICS_HEIGHT,
    DEBUGGER_VIDEO_STATE_DISPLAY_PAGE,
    DEBUGGER_VIDEO_STATE_WORDS
};

// DEBUGGER_STATE_SEQUENCE changes on control/configuration transitions as well
// as stops. Consumers must compare RUN_STATE and STOP_REASON when detecting a
// new stop. CYCLES wraps modulo 2^32. LOW_MEMORY_BANK is UINT32_MAX unless
// LOW_MEMORY_MAPPING is BANK.

struct DebuggerStatus {
    uint32_t sequence;
    DebuggerRunState state;
    DebuggerStopReason stop_reason;
    uint16_t stop_address;
    uint32_t breakpoint_count;
};

enum DebuggerFastFlag {
    DEBUGGER_FAST_BEFORE_INSTRUCTION = 1,
    DEBUGGER_FAST_AFTER_INSTRUCTION = 2
};

// Read-only outside debugger_core.cpp. These inline checks keep the normal CPU
// hot path to one load and branch while no debugger operation is armed.
extern uint8_t debugger_fast_flags;

static inline bool debugger_before_instruction_armed() {
    return (debugger_fast_flags & DEBUGGER_FAST_BEFORE_INSTRUCTION) != 0;
}

static inline bool debugger_after_instruction_armed() {
    return (debugger_fast_flags & DEBUGGER_FAST_AFTER_INSTRUCTION) != 0;
}

bool debugger_is_paused();
void debugger_pause(uint16_t pc);
void debugger_resume(uint16_t pc);
bool debugger_begin_step(uint16_t pc);
bool debugger_should_stop_before_instruction(uint16_t pc);
bool debugger_after_instruction(uint16_t pc);
bool debugger_replace_breakpoints(const uint16_t *addresses, int count);
void debugger_on_machine_reset(uint16_t pc);
DebuggerStatus debugger_get_status();

#endif

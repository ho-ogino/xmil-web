#include "debugger_core.h"

#include <string.h>

static uint8_t g_breakpoints[0x10000 / 8];
static uint32_t g_breakpoint_count = 0;
static uint32_t g_sequence = 0;
static DebuggerRunState g_state = DEBUGGER_RUNNING;
static DebuggerStopReason g_stop_reason = DEBUGGER_STOP_NONE;
static uint16_t g_stop_address = 0;
static bool g_step_requested = false;
static bool g_skip_breakpoint_once = false;
static uint16_t g_skip_breakpoint_address = 0;

static bool has_breakpoint(uint16_t address) {
    return (g_breakpoints[address >> 3] & (uint8_t)(1u << (address & 7))) != 0;
}

static void set_paused(DebuggerStopReason reason, uint16_t address) {
    g_state = DEBUGGER_PAUSED;
    g_stop_reason = reason;
    g_stop_address = address;
    g_step_requested = false;
    g_sequence++;
}

bool debugger_is_paused() {
    return g_state == DEBUGGER_PAUSED;
}

void debugger_pause(uint16_t pc) {
    if (g_state == DEBUGGER_PAUSED) return;
    g_skip_breakpoint_once = false;
    set_paused(DEBUGGER_STOP_MANUAL, pc);
}

void debugger_resume(uint16_t pc) {
    if (g_state == DEBUGGER_RUNNING) return;
    g_skip_breakpoint_once =
        g_stop_reason == DEBUGGER_STOP_BREAKPOINT && g_stop_address == pc;
    g_skip_breakpoint_address = pc;
    g_step_requested = false;
    g_state = DEBUGGER_RUNNING;
    g_stop_reason = DEBUGGER_STOP_NONE;
    g_stop_address = pc;
    g_sequence++;
}

bool debugger_begin_step(uint16_t pc) {
    if (g_state != DEBUGGER_PAUSED) return false;
    g_skip_breakpoint_once = true;
    g_skip_breakpoint_address = pc;
    g_step_requested = true;
    g_state = DEBUGGER_RUNNING;
    g_stop_reason = DEBUGGER_STOP_NONE;
    g_stop_address = pc;
    g_sequence++;
    return true;
}

bool debugger_should_stop_before_instruction(uint16_t pc) {
    if (g_state == DEBUGGER_PAUSED) return true;

    if (g_skip_breakpoint_once && g_skip_breakpoint_address == pc) {
        g_skip_breakpoint_once = false;
        return false;
    }

    if (!has_breakpoint(pc)) return false;
    set_paused(DEBUGGER_STOP_BREAKPOINT, pc);
    return true;
}

bool debugger_after_instruction(uint16_t pc) {
    if (!g_step_requested) return false;
    g_skip_breakpoint_once = false;
    set_paused(DEBUGGER_STOP_STEP, pc);
    return true;
}

bool debugger_replace_breakpoints(const uint16_t *addresses, int count) {
    if (count < 0 || count > 0x10000 || (count > 0 && addresses == 0)) {
        return false;
    }

    memset(g_breakpoints, 0, sizeof(g_breakpoints));
    g_breakpoint_count = 0;
    for (int i = 0; i < count; i++) {
        uint16_t address = addresses[i];
        uint8_t mask = (uint8_t)(1u << (address & 7));
        uint8_t *entry = &g_breakpoints[address >> 3];
        if ((*entry & mask) == 0) {
            *entry |= mask;
            g_breakpoint_count++;
        }
    }
    g_sequence++;
    return true;
}

void debugger_on_machine_reset(uint16_t pc) {
    g_step_requested = false;
    g_skip_breakpoint_once = false;
    g_stop_address = pc;
    g_stop_reason = (g_state == DEBUGGER_PAUSED)
        ? DEBUGGER_STOP_MANUAL
        : DEBUGGER_STOP_NONE;
    g_sequence++;
}

DebuggerStatus debugger_get_status() {
    DebuggerStatus status;
    status.sequence = g_sequence;
    status.state = g_state;
    status.stop_reason = g_stop_reason;
    status.stop_address = g_stop_address;
    status.breakpoint_count = g_breakpoint_count;
    return status;
}

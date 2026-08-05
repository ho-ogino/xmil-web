#ifndef XMIL_Z80_DEBUG_H
#define XMIL_Z80_DEBUG_H

#include <stdint.h>

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
    uint32_t cycles; // Wraps modulo 2^32.
};

uint16_t z80w_get_pc();
void z80w_get_debug_registers(Z80DebugRegisters *registers);

#endif

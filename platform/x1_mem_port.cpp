//----------------------------------------------------------------------------
// X1_MEM.CPP - Z80 memory access functions (ported from inline assembly)
// Original: src/X1_MEM.CPP
//----------------------------------------------------------------------------

#include <windows.h>
#include "common.h"
#include "x1.h"

// Z80 memory read (byte)
BYTE __fastcall Z80_RDMEM(WORD adrs) {
    if (adrs >= 0x8000) {
        return mMAIN[adrs];
    } else {
        return RAM0r[adrs];
    }
}

// Z80 memory write (byte)
void __fastcall Z80_WRMEM(WORD adrs, BYTE value) {
    if (adrs >= 0x8000) {
        mMAIN[adrs] = value;
    } else {
        RAM0w[adrs] = value;
    }
}

// Z80 memory read (word)
WORD __fastcall Z80_RDMEM_W(WORD adrs) {
    if (adrs == 0xFFFF) {
        // Special case: 0xFFFF wraps to 0x0000
        return (RAM0r[0] << 8) | mMAIN[0xFFFF];
    } else if (adrs == 0x7FFF) {
        // Special case: crosses boundary at 0x7FFF/0x8000
        return (mMAIN[0x8000] << 8) | RAM0r[0x7FFF];
    } else if (adrs >= 0x8000) {
        // High memory (0x8000-0xFFFE)
        return *(WORD*)&mMAIN[adrs];
    } else {
        // Low memory (0x0000-0x7FFE)
        return *(WORD*)&RAM0r[adrs];
    }
}

// Z80 memory write (word)
void __fastcall Z80_WRMEM_W(WORD adrs, WORD value) {
    if (adrs == 0xFFFF) {
        // Special case: 0xFFFF wraps to 0x0000
        mMAIN[0xFFFF] = (BYTE)(value & 0xFF);
        RAM0w[0] = (BYTE)(value >> 8);
    } else if (adrs == 0x7FFF) {
        // Special case: crosses boundary at 0x7FFF/0x8000
        RAM0w[0x7FFF] = (BYTE)(value & 0xFF);
        mMAIN[0x8000] = (BYTE)(value >> 8);
    } else if (adrs >= 0x8000) {
        // High memory (0x8000-0xFFFE)
        *(WORD*)&mMAIN[adrs] = value;
    } else {
        // Low memory (0x0000-0x7FFE)
        *(WORD*)&RAM0w[adrs] = value;
    }
}

// Fast memory read (byte) - optimized version
BYTE __fastcall fast_RDMEM(WORD adrs) {
    if (adrs >= 0x8000) {
        return mMAIN[adrs];
    } else {
        return RAM0r[adrs];
    }
}

// Fast memory write (byte) - optimized version
void __fastcall fast_WRMEM(WORD adrs, BYTE value) {
    if (adrs >= 0x8000) {
        mMAIN[adrs] = value;
    } else {
        RAM0w[adrs] = value;
    }
}

// Fast memory read (word) - optimized version
WORD __fastcall fast_RDMEM_W(WORD adrs) {
    if (adrs == 0xFFFF) {
        return (RAM0r[0] << 8) | mMAIN[0xFFFF];
    } else if (adrs == 0x7FFF) {
        return (mMAIN[0x8000] << 8) | RAM0r[0x7FFF];
    } else if (adrs >= 0x8000) {
        return *(WORD*)&mMAIN[adrs];
    } else {
        return *(WORD*)&RAM0r[adrs];
    }
}

// Fast memory write (word) - optimized version
void __fastcall fast_WRMEM_W(WORD adrs, WORD value) {
    if (adrs == 0xFFFF) {
        mMAIN[0xFFFF] = (BYTE)(value & 0xFF);
        RAM0w[0] = (BYTE)(value >> 8);
    } else if (adrs == 0x7FFF) {
        RAM0w[0x7FFF] = (BYTE)(value & 0xFF);
        mMAIN[0x8000] = (BYTE)(value >> 8);
    } else if (adrs >= 0x8000) {
        *(WORD*)&mMAIN[adrs] = value;
    } else {
        *(WORD*)&RAM0w[adrs] = value;
    }
}

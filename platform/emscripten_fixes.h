#ifndef EMSCRIPTEN_FIXES_H
#define EMSCRIPTEN_FIXES_H

#include <stddef.h>  // offsetof用

// Emscripten/64-bit環境での互換性修正

#ifdef EMSCRIPTEN_BUILD

// X1_dma.h のDMAOFSTマクロを標準的なoffsetofに置き換え
#ifdef DMAOFST
#undef DMAOFST
#endif
#define DMAOFST(item) ((BYTE)offsetof(DMA_TABLE, item))

// X1_scpu.h のSCPUOFSTマクロを標準的なoffsetofに置き換え
#ifdef SCPUOFST
#undef SCPUOFST
#endif
#define SCPUOFST(item) ((WORD)offsetof(SCPU_TABLE, item))

#endif // EMSCRIPTEN_BUILD

#endif // EMSCRIPTEN_FIXES_H

#ifndef STATE_SAVE_H
#define STATE_SAVE_H

#include <windows.h>

/* ---- binary format ----
 * [Header 8B]  magic "XMST" + version(u16) + flags(u16)
 *   flags: bit0-1 = ROM_TYPE
 *
 * v1-v2 (uncompressed):
 *   [Section]*N  tag(4B) + len(4B) + data(lenB)
 *   [End]        "END!" + 0(4B)
 *
 * v3+ (zlib compressed):
 *   [uncompressed_size 4B LE]
 *   [zlib compressed body containing sections + END marker]
 */

#define STATE_MAGIC     "XMST"
#define STATE_VERSION   3

/* flags bit assignments */
/* bit0-1: ROM_TYPE (0-3)  — existing, do not change */
/* bit2:   Portable EMM    — v2: EMM file data compressed in EMDn sections */
#define STATE_FLAG_PORTABLE_EMM  0x04

/* ---- serialization helpers ---- */

#define SS_WRITE(buf, pos, src, sz) do { \
    memcpy((buf) + (pos), (src), (sz)); \
    (pos) += (int)(sz);                 \
} while(0)

#define SS_WRITE_VAL(buf, pos, val) do {               \
    memcpy((buf) + (pos), &(val), sizeof(val));        \
    (pos) += (int)sizeof(val);                         \
} while(0)

#define SS_WRITE_U8(buf, pos, v) do {   \
    (buf)[(pos)++] = (BYTE)(v);         \
} while(0)

#define SS_WRITE_U16(buf, pos, v) do {          \
    WORD _w = (WORD)(v);                        \
    memcpy((buf) + (pos), &_w, 2);              \
    (pos) += 2;                                 \
} while(0)

#define SS_WRITE_U32(buf, pos, v) do {          \
    DWORD _d = (DWORD)(v);                      \
    memcpy((buf) + (pos), &_d, 4);              \
    (pos) += 4;                                 \
} while(0)

#define SS_WRITE_I32(buf, pos, v) do {          \
    int32_t _i = (int32_t)(v);                  \
    memcpy((buf) + (pos), &_i, 4);              \
    (pos) += 4;                                 \
} while(0)

#define SS_WRITE_U64(buf, pos, v) do {          \
    uint64_t _q = (uint64_t)(v);                \
    memcpy((buf) + (pos), &_q, 8);              \
    (pos) += 8;                                 \
} while(0)

/* ---- deserialization helpers (bounds-checked) ----
 *
 * IMPORTANT: These macros implicitly reference a local variable
 * named `len` (int) in the calling scope.  They MUST only be used
 * inside functions with `int len` in scope (i.e. *_load_state).
 *
 * On out-of-bounds: immediately `return -1` from the calling function.
 * Overflow-safe: checks `len >= sz` before `pos > len - sz` to avoid
 * signed integer underflow.
 */

#define SS_CHECK(pos, len, sz) do {                                          \
    if ((pos) < 0 || (len) < (int)(sz) || (pos) > (len) - (int)(sz))        \
        return -1;                                                           \
} while(0)

#define SS_READ(buf, pos, dst, sz) do {     \
    SS_CHECK(pos, len, sz);                 \
    memcpy((dst), (buf) + (pos), (sz));     \
    (pos) += (int)(sz);                     \
} while(0)

#define SS_READ_VAL(buf, pos, val) do {                \
    SS_CHECK(pos, len, sizeof(val));                   \
    memcpy(&(val), (buf) + (pos), sizeof(val));        \
    (pos) += (int)sizeof(val);                         \
} while(0)

#define SS_READ_U8(buf, pos, v) do {    \
    SS_CHECK(pos, len, 1);              \
    (v) = (buf)[(pos)++];               \
} while(0)

#define SS_READ_U16(buf, pos, v) do {           \
    SS_CHECK(pos, len, 2);                      \
    WORD _w; memcpy(&_w, (buf) + (pos), 2);    \
    (v) = _w; (pos) += 2;                      \
} while(0)

#define SS_READ_U32(buf, pos, v) do {           \
    SS_CHECK(pos, len, 4);                      \
    DWORD _d; memcpy(&_d, (buf) + (pos), 4);   \
    (v) = _d; (pos) += 4;                      \
} while(0)

#define SS_READ_I32(buf, pos, v) do {           \
    SS_CHECK(pos, len, 4);                      \
    int32_t _i; memcpy(&_i, (buf) + (pos), 4); \
    (v) = _i; (pos) += 4;                      \
} while(0)

#define SS_READ_U64(buf, pos, v) do {                   \
    SS_CHECK(pos, len, 8);                              \
    uint64_t _q; memcpy(&_q, (buf) + (pos), 8);        \
    (v) = _q; (pos) += 8;                              \
} while(0)

/* ---- device helper declarations ---- */

#ifdef __cplusplus
extern "C" {
#endif

/* z80_wrapper.cpp */
int z80w_save_state(BYTE *buf, int maxlen);
int z80w_load_state(const BYTE *buf, int len);

/* X1.cpp */
int x1_save_state(BYTE *buf, int maxlen);
int x1_load_state(const BYTE *buf, int len);

/* X1_irq.cpp */
int irq_save_state(BYTE *buf, int maxlen);
int irq_load_state(const BYTE *buf, int len);

/* X1_ctc.cpp */
int ctc_save_state(BYTE *buf, int maxlen);
int ctc_load_state(const BYTE *buf, int len);

/* X1_sio.cpp */
int sio_save_state(BYTE *buf, int maxlen);
int sio_load_state(const BYTE *buf, int len);

/* X1_fdc.cpp */
int fdc_save_state(BYTE *buf, int maxlen);
int fdc_load_state(const BYTE *buf, int len);

/* FDD_2D.CPP */
int fdd2d_save_state(BYTE *buf, int maxlen);
int fdd2d_load_state(const BYTE *buf, int len);

/* FDD_D88.CPP */
int fddd88_save_state(BYTE *buf, int maxlen);
int fddd88_load_state(const BYTE *buf, int len);

/* FDD_MTR.CPP */
int fddmtr_save_state(BYTE *buf, int maxlen);
int fddmtr_load_state(const BYTE *buf, int len);

/* X1_dma.cpp */
int dma_save_state(BYTE *buf, int maxlen);
int dma_load_state(const BYTE *buf, int len);

/* X1_cmt.cpp */
int cmt_save_state(BYTE *buf, int maxlen);
int cmt_load_state(const BYTE *buf, int len);

/* X1_event.cpp */
int event_save_state(BYTE *buf, int maxlen);
int event_load_state(const BYTE *buf, int len);

/* X1_SOUND.CPP */
int snd_save_state(BYTE *buf, int maxlen);
int snd_load_state(const BYTE *buf, int len);

/* Timer.cpp */
int timer_save_state(BYTE *buf, int maxlen);
int timer_load_state(const BYTE *buf, int len);

/* OPMSOUND/fm.cpp */
int opm_save_state(BYTE *buf, int maxlen);
int opm_load_state(const BYTE *buf, int len);

/* OPMSOUND/ay8910.cpp */
int psg_save_state(BYTE *buf, int maxlen);
int psg_load_state(const BYTE *buf, int len);

/* OPMSOUND/Opmcore.cpp */
int opmcore_save_state(BYTE *buf, int maxlen);
int opmcore_load_state(const BYTE *buf, int len);

/* X1_8255.cpp */
int ppi_save_state(BYTE *buf, int maxlen);
int ppi_load_state(const BYTE *buf, int len);

/* x1_vram_port.cpp + otherfnt_stubs.cpp */
int vram_save_state(BYTE *buf, int maxlen);
int vram_load_state(const BYTE *buf, int len);

/* ---- version info (set by load_full_state before calling loaders) ---- */
extern WORD state_load_version;

/* ---- main entry points ---- */

/* Returns malloc'd buffer; caller must free(). *out_size receives byte count.
 * flags: 0 = Fast mode, STATE_FLAG_PORTABLE_EMM = include compressed EMM data */
BYTE* save_full_state(int *out_size, int flags);

/* Returns 0 on success, 1 on success with ROM_TYPE mismatch, -1 on header error.
 * Section-level failures are skipped (not fatal); call get_load_warnings()
 * after load to retrieve comma-separated tags of failed sections ("" if none). */
int load_full_state(const BYTE *data, int size);

/* Returns failed section tags from the last load ("" if all OK). */
const char* get_load_warnings(void);

#ifdef __cplusplus
}
#endif

#endif /* STATE_SAVE_H */

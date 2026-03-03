#ifndef DRAW_SUB_H_COMPAT
#define DRAW_SUB_H_COMPAT

// Compatibility header for draw_sub.h

// X1
void width80x25_200line(void);

// turbo
void width80x25_400line(void);
void width80x12_200line(void);
void width80x12_400line(void);
void width80x20_15khz(void);
void width80x10_15khz(void);
void width80x20_24khz(void);
void width80x10_24khz(void);

// turboZ
void width40x25_64s(void);
void width40x25_64x2(void);
void width40x25_4096(void);
void width40x25_64h(void);
void width80x25_64s(void);
void width40x12_64l(void);
void width40x12_64x2(void);
void width40x12_4096(void);
void width40x12_64h(void);
void width80x12_64s(void);

void init_drawtable(void);
// reflesh_paletteは他で宣言されている

extern DWORD bmp2byte_table[32][512];

#define BMP2B_TEXT      (0x800*0)
#define BMP2B_BLUE      (0x800*16)
#define BMP2B_RED       (0x800*17)
#define BMP2B_GREEN     (0x800*18)

#define BMP2B_BLUE2     (0x800*1)
#define BMP2B_RED2      (0x800*2)
#define BMP2B_GREEN2    (0x800*4)

#define BMP2B_BIT0      (0x800*16)
#define BMP2B_BIT1      (0x800*17)
#define BMP2B_BIT2      (0x800*18)
#define BMP2B_BIT3      (0x800*1)
#define BMP2B_BIT4      (0x800*2)
#define BMP2B_BIT5      (0x800*4)
#define BMP2B_BIT6      (0x800*19)
#define BMP2B_BIT7      (0x800*20)

extern DWORD text_x2_table[16][64];

extern BYTE cwork[];
extern DWORD mask1;
extern DWORD mask2;

extern BYTE fontycnt;

extern WORD PAL4096_BANK0[];
extern WORD PAL4096_BANK1[];

extern DWORD x2left[];
extern DWORD x2right[];

extern void (*planeeffects[])(void);
extern void (*planeeffects16[])(void);

// Function pointer arrays (with extern to avoid definition errors)
extern void (*txt8effects[])(void);
extern void (*pcg8effects[])(void);
extern void (*knj8effects[])(void);

extern void (*txt16effects[])(void);
extern void (*pcg16effects[])(void);
extern void (*knj16effects[])(void);

extern void (*txtbeffects[])(void);
extern void (*knjbeffects[])(void);
extern void (*extbeffects[])(void);

extern void (*txtbeffects16[])(void);
extern void (*knjbeffects16[])(void);
extern void (*pcgbeffectsx2[])(void);

#endif // DRAW_SUB_H_COMPAT

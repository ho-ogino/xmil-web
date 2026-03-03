extern	PALETTE_TABLE	TEXTPALS[24];
extern	PALETTE_TABLE	GRPHPALS[2][16];
extern	PALETTE_TABLE	GRPHPALS64[2][64];
extern	PALETTE_TABLE	GRPHPAL4096[4096+8];
extern	WORD			GRPHPAL16bit[4096+8];
extern	BYTE			pal_renewal;

void textpalette1(BYTE num);
void grphpalette1(BYTE bank, BYTE num);
void grphpal4096(WORD num);
void reflesh_palette(void);

void pal_make16mask(DWORD bmask, DWORD rmask, DWORD gmask);
WORD pal_get16pal(DWORD pal);
void pal_cnv16pal(WORD *dst, DWORD *src, int pals);
void pal_makegrad(PALETTE_TABLE *pal, int pals, DWORD bg, DWORD fg);


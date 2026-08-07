#define	X1ATR_COLOR		0x07
#define	X1ATR_REVERSE	0x08
#define	X1ATR_BLINK		0x10
#define	X1ATR_PCG		0x20
#define	X1ATR_Yx2		0x40
#define	X1ATR_Xx2		0x80
#define	X1KNJ_ULINE		0x20

extern	BYTE	*curvram;
extern	BYTE	curupdt;
extern	DWORD	updatemsk;

enum X1_DEBUG_VRAM_REGION {
	X1_DEBUG_VRAM_TEXT = 0,
	X1_DEBUG_VRAM_ATTRIBUTE,
	X1_DEBUG_VRAM_KANJI,
	X1_DEBUG_VRAM_GRAPHICS
};

enum X1_DEBUG_VRAM_BANK {
	X1_DEBUG_VRAM_BANK0 = 0,
	X1_DEBUG_VRAM_BANK1,
	X1_DEBUG_VRAM_DISPLAY_BANK,
	X1_DEBUG_VRAM_ACCESS_BANK
};

enum X1_DEBUG_VRAM_PLANE {
	X1_DEBUG_VRAM_BLUE = 0,
	X1_DEBUG_VRAM_RED,
	X1_DEBUG_VRAM_GREEN
};

#define X1_DEBUG_VRAM_ERROR_INVALID      -1
#define X1_DEBUG_VRAM_ERROR_UNSUPPORTED  -2
#define X1_DEBUG_VRAM_ERROR_NOT_PAUSED   -3

void init_vram(void);

X1_IOW x1_txt_w(WORD port, BYTE value);
X1_IOR x1_txt_r(WORD port);

X1_IOW x1_grp_w2(WORD port, BYTE value);
X1_IOW x1_grp_w(WORD port, BYTE value);
X1_IOR x1_grp_r(WORD port);

// Debugger regions use logical offsets rather than GRP_RAM's interleaved
// layout. Display/access bank selectors are resolved in the same call and the
// resolved numeric bank is returned through resolved_bank.
int x1_debug_read_vram(int region, int bank_selector, int plane, int offset,
	BYTE *output, int length, int *resolved_bank);
int x1_debug_write_vram(int region, int bank_selector, int plane, int offset,
	const BYTE *input, int length, int *resolved_bank);

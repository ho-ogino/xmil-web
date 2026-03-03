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

void init_vram(void);

X1_IOW x1_txt_w(WORD port, BYTE value);
X1_IOR x1_txt_r(WORD port);

X1_IOW x1_grp_w2(WORD port, BYTE value);
X1_IOW x1_grp_w(WORD port, BYTE value);
X1_IOR x1_grp_r(WORD port);


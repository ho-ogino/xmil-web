#define	PAL_NORMAL		0x00
#define PAL_HIGHRESO	0x01

#define PAL_4096H		0x00
#define PAL_4096L		0x01

#define	PAL_4096BANK	0x01
#define PAL_64x2		0x02
#define PAL_4096FULL	0x04
#define	PAL_4096		0x10


#define	SCRN_BANK0			0x00
#define	SCRN_BANK1			0x80
#define	SCRN_DRAW4096		0x40

#define	SCRN64_MASK				0x0f
#define	SCRN64_INVALID			0
#define	SCRN64_320x200			1
#define	SCRN64_L320x200x2		2
#define	SCRN64_L640x200			3
#define	SCRN64_H320x400			4
#define	SCRN64_320x200x4096		5

#define	SCRN64_320x100			6
#define	SCRN64_320x100x2		7
#define	SCRN64_L640x100			8
#define	SCRN64_H320x200			9
#define	SCRN64_320x100x4096		10


#define	SCRN_24KHZ		0x01	// 0:15KHz		1:24KHz
#define	SCRN_200LINE	0x02	// 0:400line	1:200line
#define	SCRN_TEXTYx2	0x04	// 0:ノーマル	1:縦に拡大
#define	SCRN_DISPVRAM	0x08	// 0:表			1:裏
#define	SCRN_ACCESSVRAM	0x10	// 0:表			1:裏
#define	SCRN_PCGMODE	0x20	// 0:互換		1:高速
#define	SCRN_CPUFONT	0x40	// 0:8ラスタ	1:16ラスタ
#define	SCRN_UNDERLINE	0x80	// 0:なし		1:あり

#define	SCRN_DISPCHANGE	(SCRN_24KHZ | SCRN_200LINE |					\
									SCRN_TEXTYx2 | SCRN_UNDERLINE)


typedef struct {
	BYTE	PAL_B;
	BYTE	PAL_R;
	BYTE	PAL_G;
	BYTE	PLY;
	BYTE	TEXT_PAL[8];
	BYTE	SCRN_BITS;
	BYTE	CRTC_NUM;

	WORD	DISP_PAGE;
	WORD	FNT_XL;
	WORD	FNT_YL;
	BYTE	TXT_XL;
	BYTE	TXT_YL;
	BYTE	TXT_YS;
	WORD	GRP_XL;
	WORD	GRP_YL;
	BYTE	CPU_BANK;
	BYTE	CRT_BANK;

	WORD	CRT_YL;
	WORD	CRT_VS;
	WORD	CRT_VL;

	BYTE	TXT_VL;
	BYTE	TXT_VLA;

	WORD	TXT_TOP;
	WORD	fnty;

	BYTE	BLACKPAL;
	BYTE	EXTPALMODE;
	BYTE	EXTGRPHPAL;
	BYTE	ZPRY;
	BYTE	lastpal;

} CRTC_TABLE;


extern	CRTC_TABLE	crtc;
extern	BYTE		crtc_TEXTPAL[8];
extern	WORD		crtc_GRPHPAL[2][64];
extern	WORD		crtc_PAL4096[4096];


//**********************************************************************

void init_crtc(void);
void crtc_cold_reset(void);
void vrambank_patch(void);

X1_IOW x1_crtc_w(WORD port, BYTE value);

X1_IOW x1_scrn_w(WORD port, BYTE value);
X1_IOR x1_scrn_r(WORD port);

X1_IOW x1_ply_w(WORD port, BYTE value);
X1_IOR x1_ply_r(WORD port);

X1_IOW x1_extpal_w(WORD port, BYTE value);
X1_IOR x1_extpal_r(WORD port);

X1_IOW x1_extgrphpal_w(WORD port, BYTE value);
X1_IOR x1_extgrphpal_r(WORD port);

X1_IOW x1_exttextpal_w(WORD port, BYTE value);
X1_IOR x1_exttextpal_r(WORD port);

X1_IOW x1_exttextdisp_w(WORD port, BYTE value);
X1_IOR x1_exttextdisp_r(WORD port);

X1_IOW x1_palet_w(WORD port, BYTE value);
X1_IOR x1_palet_r(WORD port);

X1_IOW x1_blackctrl_w(WORD port, BYTE value);
X1_IOR x1_blackctrl_r(WORD port);

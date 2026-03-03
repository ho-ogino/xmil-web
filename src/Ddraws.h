#define	START_PAL		0x0a
#define	USE_PALS		0xc0
#define	START_EXT		(START_PAL + USE_PALS)
#define	EXT_PALS		0x28
#if T_TUNE
#define	INFO_PALS		9
#define	TOTAL_PALS		(USE_PALS + EXT_PALS + INFO_PALS)
#else
#define	TOTAL_PALS		(USE_PALS + EXT_PALS)
#endif

#if T_TUNE
/* for information block */
#define INFO_HEIGHT		16
/* palettes */
enum{
	INFO_BLACK,
	INFO_RED,
	INFO_GREEN,
	INFO_HALF_GREEN,
	INFO_WHITE,
	INFO_GRAY,
	INFO_FDD1,
	INFO_FDD2,
	INFO_BACK
};

extern	PALETTE_TABLE	info_palette[INFO_PALS];
#endif

#define	SCMD_SETWINDOWED	0x01
#define	SCMD_SETFULLSCREEN	0x02
#define	SCMD_SET256			0x04
#define	SCMD_SET65536		0x08
#define	SCMD_XORWINDOWED	0x10
#define	SCMD_XORFULLSCREEN	0x10

#define	SCMD_COLOR8			3
#define	SCMD_COLOR16		2
#define	SCMD_COLOR24		1
#define	SCMD_COLOR32		0

#define	SCMD_COLORMASK		0x03
#define	SCMD_FULLSCRN		0x04
#define	SCMD_WINDOWED		0x08
#define	SCMD_USEPAL			0x10
#define	SCMD_NONPAL			0x20

#define	SCMD_WINDOW8		(SCMD_WINDOWED | SCMD_COLOR8 | SCMD_USEPAL)
#define	SCMD_WINDOW16		(SCMD_WINDOWED | SCMD_COLOR16 | SCMD_NONPAL)
#define	SCMD_WINDOW24		(SCMD_WINDOWED | SCMD_COLOR24 | SCMD_NONPAL)
#define	SCMD_WINDOW32		(SCMD_WINDOWED | SCMD_COLOR32 | SCMD_NONPAL)

#define	SCMD_FSCREEN8		(SCMD_FULLSCRN | SCMD_COLOR8 | SCMD_USEPAL)
#define	SCMD_FSCREEN16		(SCMD_FULLSCRN | SCMD_COLOR16 | SCMD_NONPAL)
#define	SCMD_FSCREEN24		(SCMD_FULLSCRN | SCMD_COLOR24 | SCMD_NONPAL)
#define	SCMD_FSCREEN32		(SCMD_FULLSCRN | SCMD_COLOR32 | SCMD_NONPAL)


#define	X2MODE_WIDTH80		0
#define	X2MODE_WIDTH40		1
#define	X2MODE_4096			2

extern	BYTE			SCREENMODE;
extern	int				xm_palettes;
extern	PALETTE_TABLE	xm_palette[];
extern	BYTE			screenmap[];
#if T_TUNE
extern BYTE				inforenewal;
extern BYTE				infoscreenmap[];
#endif
extern	BYTE			renewalline[];
extern	BYTE			x2mode;

BYTE ddraws_setscreenmode(BYTE mode);

void ddraws_initwindowsize(WORD width, WORD height);
void ddraws_windowstats(void);
void ddraws_wincenter(void);

void ddraws_xmilsystempal(void);
void ddraws_xmilsyspalset(PALETTE_TABLE *degpal);

void ddraws_init(void);
int ddraws_InitDirectDraw(void);
void ddraws_TermDirectDraw(void);

void ddraws_draws(void);
void ddraws_drawall(void);
void ddraws_palette(void);
void ddraws_change_palette(void);
void ddraws_change_xmode(BYTE x2flag);

void ddraws_topwinui(void);
void ddraws_clearwinui(void);
void ddraws_redraw(void);
void ddraws_change_drawlines(DWORD lines);
BYTE ddraws_restore(void);

BYTE ddraws_draw1(DWORD linepos);
#if T_TUNE
void ddraws_infodraw(void);
void ddraws_cliparea(void);
#endif

void ddraws_dispclock(void);

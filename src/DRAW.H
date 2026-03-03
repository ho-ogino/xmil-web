
#define	TRAM_MAX	0x800

#define	UPDATEVRAM0BIT	6
#define	UPDATEVRAM1BIT	7
#define	UPDATE_TRAM		(1 << 5)
#define	UPDATE_VRAM0	(1 << UPDATEVRAM0BIT)
#define	UPDATE_VRAM1	(1 << UPDATEVRAM1BIT)
#define	UPDATE_VRAM		(UPDATE_VRAM0 | UPDATE_VRAM1)
#define	UPDATE_TVRAM	(UPDATE_VRAM0 | UPDATE_VRAM1 | UPDATE_TRAM)

#define	ANK_24KHz		1
#define	KNJ_24KHz		2

extern	BYTE	updatetmp[0x800+0x101];
extern	BYTE	scrnflash;
extern	BYTE	scrnallflash;
extern	BYTE	doubleatrchange;
extern	BYTE	palandply;
extern	BYTE	blinkflag;
extern	DWORD	degitalpal[24];
extern	DWORD	drawtime;


void textdrawproc_renewal(void);
void palettes(void);

void init_draw(void);
void scrnupdate(void);

void scrnupdate1line(DWORD line);

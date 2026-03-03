#include	"z80r.h"
#include	"x1_io.h"
#include	"x1_mem.h"
#if T_TUNE
#include	"x1_event.h"
#endif

typedef struct {
	WORD	HSYNC_CLK;
	BYTE	ROM_TYPE;
	BYTE	ROM_SW;
	BYTE	DIP_SW;
	BYTE	SOUND_SW;
} X1_FLAG;

extern	X1_FLAG	x1flg;
extern	BYTE	*RAM0r;
extern	BYTE	*RAM0w;
extern	BYTE	lastmem;
#if !T_TUNE
extern	DWORD	h_cntbase;
#endif

extern	BYTE	mMAIN[0x10000];
extern	BYTE	mBIOS[0x8000];
extern	BYTE	mBANK[16][0x8000];
extern	BYTE	ANK_FNT[256][8];
extern	BYTE	KNJ_FNT[0x4bc00];
extern	BYTE	GRP_RAM[0x20000];
extern	BYTE	TXT_RAM[0x01800];

#define	GRAM_SIZE		0x10000
#define	GRAM_BANK0		0x00000
#define	GRAM_BANK1		0x10000

#define	GRAM_BANK0L		0x00000
#define	GRAM_BANK0H		0x08000
#define	GRAM_BANK1L		0x10000
#define	GRAM_BANK1H		0x18000

#define GRAM_HALFSTEP	0x08000

#define	TEXT_ANK	0x0000
#define	TEXT_ATR	0x0800
#define	TEXT_KNJ	0x1000

#define	PLANE_B		8
#define	PLANE_R		16
#define	PLANE_G		24

#if T_TUNE
/* CRTC video position */
extern EVENT V_SYNC_event;
extern EV_TIME H_SYNC_interval;
#define get_frame_pos() (V_SYNC_event.interval-event_timeleft(&V_SYNC_event))
#define get_vpos(frame_pos) ((WORD)(frame_pos/H_SYNC_interval))
#define get_hpos(frame_pos) ((unsigned short)(frame_pos%H_SYNC_interval))
extern DWORD	x1_tick_msec;
#else //T_TUNE
#define	h_cnt	Z80_ICount
extern	WORD	v_cnt;
#endif //T_TUNE

BYTE reset_x1(BYTE ROM_TYPE, BYTE SOUND_SW, BYTE DIP_SW);

void x1r_init(void);
void x1r_term(void);

void x1r_exec(void);

X1_IOR x1_dipsw_r(WORD port);


typedef struct {
	long	draws;
	long	khz;
} WORKCLOCK_T;

void workclock_reset(void);
WORKCLOCK_T *workclock_get(void);
void makecaption(BYTE flg, WORKCLOCK_T *workclock);


#define	FONT_ANK8		0x01
#define	FONT_ANK16a		0x02
#define	FONT_ANK16b		0x04
#define	FONT_KNJ1		0x08
#define	FONT_KNJ2		0x10

#define	FONT_ANK16		0x06
#define	FONT_KNJ		0x18
#define	FONT_ALL		0x1f


#define	DIP_RESOLUTE	1
#define	DIP_BOOTMEDIA	4


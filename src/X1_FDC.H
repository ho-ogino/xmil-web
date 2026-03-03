typedef struct {
	short	drv;
	short	cmnd;
	short	skip;
	short	off;
	short	crc_off;
	BYTE	crc_dat[8];

	BYTE	type;
	BYTE	treg;
	BYTE	sct_bak;
	BYTE	data;
	char	step;
	BYTE	motor;

	BYTE	c;
	BYTE	h;
	BYTE	r;
	BYTE	n;
	BYTE	img[4];

	DWORD	busyclock;
	DWORD	busystart;
	BYTE	media;
	BYTE	rreg;
#if T_TUNE
	BYTE	status;
#endif
} FDC_REGS;

#define	X1_MAX_PATH		260

#define	DRV_EMPTY	0
#define	DRV_FMT88	1
#define	DRV_FMT2D	255


extern	FDC_REGS	FDC;
extern	BYTE		fdcdummyread;
extern	char		FDC_NAME[4][X1_MAX_PATH];
extern	char 		FDC_PATH[X1_MAX_PATH];

short x1_fdimage(LPSTR data);

short x1_eject_fd(short drv);
short x1_set_fd(short drv, short dskno, LPSTR fname);
LPSTR x1_get_fname(short drv);

void init_fdc(void);
X1_IOW x1_fdc_w(WORD port, BYTE value);
X1_IOR x1_fdc_r(WORD port);

short sctor_read(short drv, short trk, short sct, BYTE *buff);


#include	<windows.h>
#include	<stdio.h>
#include	<string.h>
#include	"x1.h"
#include	"dosio.h"
#include	"x1_fdc.h"
#include	"fdd_mtr.h"
#include	"fdd_d88.h"
#include	"state_save.h"

#include	"trace.h"
#include	"x1_dma.h"

#ifdef __EMSCRIPTEN__
#include	<emscripten.h>
#endif


static	D88_HEADER	d88head[4];
static	D88_SECTOR	cursec;
static	short		curdrv = -1;
static	WORD		curtrk = -1;
static	BYTE		curtype = 0;
static	WORD		cursct = -1;
static	DWORD		curfp = 0;
static	DWORD		cursize = 0;
static	BYTE		curwrite = 0;
static	BYTE		curtrkerr = 0;
static	BYTE		hole = 0;
static	BYTE		*curdata;
static	WORD		crcnum = 0;
static	BYTE		crcerror = FALSE;

extern	BYTE		WRITEPT[];
extern	BYTE		DISKNUM[];

extern	WORD		readdiag;

#define		TAO_MODE_GAP	0x4e
#define		TAO_MODE_SYNC	0x00
#define		TAO_MODE_AM		0xf5
#define		TAO_MODE_IM		0xf6
#define		TAO_MODE_ID		0xfe
#define		TAO_MODE_DATA	0xfb
#define		TAO_ENDOFDATA	0xf7

#define		TAO_CMD_GAP		0x4e
#define		TAO_CMD_SYNC	0x00
#define		TAO_CMD_IM_IN	0xf6
#define		TAO_CMD_IM		0xfc
#define		TAO_CMD_AM_IN	0xf5
#define		TAO_CMD_IAM		0xfe
#define		TAO_CMD_DAM		0xfb
#define		TAO_CMD_DDAM	0xf8
#define		TAO_CMD_CRC		0xf7

typedef struct {
	BYTE	mode;
	BYTE	flag;
	WORD	cnt;
	WORD	size;
	WORD	ptr;
	WORD	top;
	WORD	gap;
	BYTE	sector;
	WORD	lostdatacnt;
	BYTE	maxsector;
	WORD	maxsize;
} WID_PARA;

#define LOSTDATA_COUNT	256

static	WID_PARA WID_2D	= {TAO_ENDOFDATA, 3, 0, 0, 0, 0, 0, 0, 0, 33, 0x1f80};
static	WID_PARA WID_2HD= {TAO_ENDOFDATA, 3, 0, 0, 0, 0, 0, 0, 0, 55, 0x2f80};
static	WID_PARA WID_ERR= {TAO_ENDOFDATA, 4, 0, 0, 0, 0, 0, 0, 0,  0, 0x0000};
static	WID_PARA tao	= {TAO_ENDOFDATA, 4, 0, 0, 0, 0, 0, 0, 0,  0, 0x0000};

static	BYTE		D88_BUF[0x4000];
static	BYTE		TAO_BUF[0x3000];


//----------------------------------------------------------------------

DWORD nexttrackp(D88_HEADER *head, DWORD fptr, DWORD last) {

	int		t;
	DWORD	ret;
	DWORD	*trkp;

	ret = last;
	trkp = (DWORD *)head->trackp;
	for (t=0; t<164; t++, trkp++) {
		if ((*trkp > fptr) && (*trkp < ret)) {
			ret = *trkp;
		}
	}
	return(ret);
}


int curdataflush(void) {

	FILEH	hdr;
	int		ret = 0;

	if ((!curfp) || (!cursize)) {
		return(-1);
	}
	if (!curwrite) {
		return(0);
	}
	if ((hdr = file_open(FDC_NAME[curdrv])) == (FILEH)-1) {
		return(-1);
	}
	if ((file_seek(hdr, curfp, FSEEK_SET) != curfp) ||
		(file_write(hdr, D88_BUF, (WORD)cursize) != (WORD)cursize)) {
		ret = -1;
	}
	if (file_close(hdr)) {
		ret = -1;
	}
	if (ret == 0) {
		curwrite = 0;
	}
	return(ret);
}


DWORD read_d88track(short drv, WORD track, BYTE type) {

	FILEH	hdr;

	curdataflush();
	curdrv = drv;
	curtrk = track;
	curtype = type;
	cursct = -1;
	curwrite = 0;
	curtrkerr = 0;
	crcnum = 0;
	crcerror = 0;

	if ((drv < 0) || (drv > 3) || (track > 163) ||
		((type == 0) && (d88head[drv].fd_type == 0x20)) ||
		((type == 1) && (d88head[drv].fd_type != 0x20)) ||
		((curfp = d88head[drv].trackp[track]) == 0) ||
		((cursize = nexttrackp(&d88head[drv], curfp,
								d88head[drv].fd_size) - curfp) > 0x4000)) {
		goto readd88_err;
	}

	if ((hdr = file_open(FDC_NAME[drv])) == (FILEH)-1) {
		goto readd88_err;
	}
	if (file_seek(hdr, curfp, FSEEK_SET) != curfp) {
		file_close(hdr);
		goto readd88_err;
	}
	if (file_read(hdr, D88_BUF, (WORD)cursize) != (WORD)cursize) {
		file_close(hdr);
		goto readd88_err;
	}
	if (file_close(hdr)) {
		goto readd88_err;
	}
	return(TRUE);

readd88_err:
	curfp = 0;
	cursize = 0;
	curtrkerr = 1;
	return(FALSE);
}




int seeksector(short drv, WORD track, WORD sector) {

static	int		lastflag = FALSE;

	BYTE 		*p;
	WORD		sec;

	if ((curdrv != drv) || (curtrk != track) || (curtype != FDC.media)) {
		read_d88track(drv, track, FDC.media);
	}
	if (curtrkerr) {
		cursct = sector;
		goto seekerror;
	}
	if (cursct != sector) {
		cursct = sector;
		p = D88_BUF;
		for (sec=0; sec<40;) {
			if ((WORD)((D88_SECTOR *)p)->r == sector) {
				memcpy(&cursec, p, sizeof(D88_SECTOR));
				curdata = p + sizeof(D88_SECTOR);
				lastflag = TRUE;
				break;
			}
			if (++sec >= ((D88_SECTOR *)p)->sectors) {
				goto seekerror;
			}
			p += ((D88_SECTOR *)p)->size;
			p += sizeof(D88_SECTOR);
		}
		if (sec >= 40) {
			goto seekerror;
		}
	}
	return(lastflag);

seekerror:;
	ZeroMemory(&cursec, sizeof(D88_SECTOR));
	curdata = &D88_BUF[16];
	lastflag = FALSE;
	return(FALSE);
}


void drvflush(short drv) {

	if (curdrv == drv) {
		curdataflush();
		curdrv = -1;
		curtrk = -1;
		cursct = -1;
	}
}


int fdd_flush_d88(void) {
	return curdataflush();
}


//**********************************************************************

short fdd_eject_d88(short drv) {

	drvflush(drv);
	ZeroMemory(&d88head[drv], sizeof(D88_HEADER));
	FDC_NAME[drv][0] = '\0';
	DISKNUM[drv] = 0;
	return(0);
}


short fdd_set_d88(short drv, LPSTR fname) {

	WORD	attr;
	FILEH	hdr;
	short	rsize;

	fdd_eject_d88(drv);
	if ((drv < 0 || drv > 3) ||
		((attr = file_attr(fname)) & 0x18)) {	// ｴﾗｰ･ﾃﾞｨﾚｸﾄﾘ･ﾗﾍﾞﾙ
		return(1);
	}
	if ((hdr = file_open(fname)) == (FILEH)-1) {
		return(1);
	}
	rsize = file_read(hdr, &d88head[drv], sizeof(D88_HEADER));
	file_close(hdr);
	if (rsize != sizeof(D88_HEADER)) {
		fdd_eject_d88(drv);
		return(1);
	}
	if (attr & 1) {
		d88head[drv].protect |= (WORD)0x10;
	}
	mx_strncpy(FDC_NAME[drv], fname, X1_MAX_PATH);
	DISKNUM[drv] = 1;
	return(0);
}


//**********************************************************************

short fdd_crc_d88(void) {

	WORD		track;
	BYTE		*p;
	WORD		sec;

	ZeroMemory(FDC.crc_dat, 6);
	if ((track = (WORD)(FDC.c << 1) + (WORD)FDC.h) > 163) {
		goto crcerror_d88;
	}
	seeksector(FDC.drv, track, FDC.r);
	if (curtrkerr) {
		goto crcerror_d88;
	}
	p = D88_BUF;
	for (sec=0; sec<crcnum;) {
		if (++sec >= ((D88_SECTOR *)p)->sectors) {
			goto crcerror_d88;
		}
		p += ((D88_SECTOR *)p)->size;
		p += sizeof(D88_SECTOR);
	}
	*(long *)FDC.crc_dat = *(long *)p;
	FDC.rreg = ((D88_SECTOR *)p)->c;				// ??? ﾒﾙﾍﾝｳﾞｪｰﾙ
	crcnum++;
	if (((D88_SECTOR *)p)->stat) {
		crcerror = TRUE;
	}
	else {
		crcerror = FALSE;
	}
	return(0);

crcerror_d88:;
	crcerror = TRUE;
	return(1);
}


BYTE fdd_stat_d88(void) {

	BYTE		type, cmnd;
	BYTE		ans = 0;
	int			seekable;
	WORD		trk;

	if (DISKNUM[FDC.drv] == DRV_EMPTY) {
		return(0x80);						// NOT READY
	}
	type = FDC.type;
	cmnd = (BYTE)(FDC.cmnd >> 4);
	trk = (FDC.c << 1) + (WORD)FDC.h;
	seekable = seeksector(FDC.drv, trk, FDC.r);
	if (!FDC.r) {
		seekable = TRUE;
	}

	if (type == 0 || type == 1 || type == 4 ||
		cmnd == 0x0a || cmnd == 0x0b || cmnd == 0x0f) {
		if (d88head[FDC.drv].protect & 0x10) {	// WRITE PROTECT
			ans |= 0x40;
		}
	}
	if (type == 2 || cmnd == 0x0f) {
		if (FDC.r && cursec.del_flg) {
			ans |= 0x20;					// RECODE TYPE / WRITE FAULT
		}
	}
	if (type == 1 || type == 2) {
		if ((trk > 163) || (!seekable)) {
			ans |= 0x10;					// SEEK ERROR / RECORD NOT FOUND
		}
		if ((!(ans & 0xf0)) && FDC.r && (cursec.stat)) {
			ans |= 0x08;					// CRC ERROR
		}
	}
	if (cmnd == 0x0c) {
		if (curtrkerr) {
			ans |= 0x10;
		}
		if (crcerror) {
			ans |= 0x08;					// CRC ERROR
		}
	}
	if (type == 1 || type == 4) {
		if (type == 1) {					// ver0.25
			ans |= 0x20;					// HEAD ENGAGED (X1 ﾃﾞﾊ ﾂﾈﾆ 1)
			if (!FDC.c) {					// TRACK00
				ans |= 0x04;
			}
		}
		if (++hole < 8) {					// ver0.25
			ans |= 0x02;					// INDEX
		}
	}
	else if (!(ans & 0xf0)) {
		if ((type != 4) && (FDDMTR_BUSY)) {
			ans |= 0x01;
		}
		if ((type == 2) && ((WORD)FDC.off < cursec.size)) {
			ans |= 0x03; 					// DATA REQUEST / BUSY
		}
		else if ((cmnd == 0x0e) && (readdiag < 0x1a00)) {
			ans |= 0x03;
		}
		else if ((cmnd == 0x0c) && (FDC.crc_off < 6)) {		// ver0.25
			ans |= 0x03;
		}
		else if (cmnd == 0x0f) {
			if (tao.flag == 3) {
				if (++tao.lostdatacnt > LOSTDATA_COUNT) {
					tao.flag = 4;
				}
			}
			ans |= tao.flag;
		}
	}
	return(ans);
}

//**********************************************************************

void fdd_read_d88(void) {
						// POCO:読めなかったらレジスタを変更させない
	if ((fdd_stat_d88() & 0xf3) == 3) {
		FDC.data = curdata[FDC.off];
#ifdef TRACE
{
	char	buf[256];
	wsprintf(buf, "%3d %2d %02x -> %04x/%04x",
						(FDC.c << 1) + FDC.h, FDC.r, FDC.off, R.HL.W,
							dma.CNT_B.w);
	TRACE_(buf, FDC.data);
}
#endif
	}
}


void fdd_write_d88(void) {

	if ((fdd_stat_d88() & 0xf3) == 3) {
		curdata[FDC.off] = FDC.data;
		curwrite = 1;
#ifdef __EMSCRIPTEN__
		EM_ASM({
			if (window.XMillennium && window.XMillennium.onFddWrite) {
				window.XMillennium.onFddWrite($0);
			}
		}, (int)curdrv);
#endif
	}
}


BYTE fdd_incoff_d88(void) {

	BYTE	cmnd;
	WORD	trk;

	cmnd = (BYTE)(FDC.cmnd >> 4);
	trk = (FDC.c << 1) + (WORD)FDC.h;
	seeksector(FDC.drv, trk, FDC.r);
	if ((WORD)(++FDC.off) < cursec.size) {
		return(0);
	}
	FDC.off = cursec.size;
	if (cmnd == 0x09 || cmnd == 0x0b) {
		FDC.rreg = FDC.r + 1;						// ver0.25
		if (seeksector(FDC.drv, trk, FDC.rreg)) {
			FDC.r++;
			FDC.off = 0;
			return(0);
		}
	}
	return(1);
}

// ---------------------------------------------------------------------------

void init_tao_d88(void) {

	if ((FDC.media == 0) && (d88head[FDC.drv].fd_type != 0x20)) {
		tao = WID_2D;
	}
	else if ((FDC.media == 1) && (d88head[FDC.drv].fd_type == 0x20)) {
		tao = WID_2HD;
	}
	else {
		tao = WID_ERR;
	}
}


int fileappend(FILEH hdr, D88_HEADER *head,
									long ptr, long last, long apsize) {

	long	length;
	WORD	size;
	WORD	rsize;
	int		t;
	DWORD	*trkp;

	if ((length = last - ptr) <= 0) {			// 書き換える必要なし
		return(0);
	}
	while(length) {
		if (length >= 0x4000) {
			size = 0x4000;
		}
		else {
			size = (WORD)length;
		}
		length -= (long)size;
		file_seek(hdr, ptr+length, 0);
		rsize = file_read(hdr, D88_BUF, size);
		file_seek(hdr, ptr+length+apsize, 0);
		file_write(hdr, D88_BUF, rsize);
	}

	trkp = head->trackp;
	for (t=0; t<164; t++, trkp++) {
		if ((*trkp) && ((long)*trkp >= ptr)) {
			(*trkp) = (DWORD)(*trkp + apsize);
		}
	}
	return(0);
}



void endoftrack(void) {

	FILEH		hdr;
	int			i;
	WORD		trk;
	D88_HEADER	*head;
	long		fpointer;
	long		endpointer;
	long		lastpointer;
	long		trksize;
	int			ptr;
	long		apsize;

	if (!tao.sector) {
		tao.flag = 4;
		return;
	}
	tao.flag = 0;

	curdataflush();						// write cache flush &
	curdrv = -1;						// use D88_BUF[] for temp

	head = &d88head[FDC.drv];
	trk = (FDC.c << 1) + (WORD)FDC.h;

	ptr = 0;
	for (i=0; i<(int)tao.sector; i++) {
		((D88_SECTOR *)&TAO_BUF[ptr])->sectors = tao.sector;
		ptr += ((D88_SECTOR *)&TAO_BUF[ptr])->size + 16;
	}

	if ((hdr = file_open(FDC_NAME[FDC.drv])) == (FILEH)-1) {
		return;
	}
	lastpointer = file_seek(hdr, 0, 2);
	if ((fpointer = head->trackp[trk]) == 0) {
		fpointer = 0;								// 新規トラック
		for (i=trk; i>=0; i--) {
			if (head->trackp[i]) {
				fpointer = head->trackp[i];
				break;
			}
		}
		if (fpointer) {								// ヒットした
			fpointer = nexttrackp(head, fpointer, lastpointer);
		}
		else {
			fpointer = sizeof(D88_HEADER);
		}
		endpointer = fpointer;
	}
	else {										// トラックデータは既にある
		endpointer = nexttrackp(head, fpointer, lastpointer);
	}
	trksize = endpointer - fpointer;
	if ((apsize = (long)tao.size - trksize) > 0) {
								// 書き込むデータのほーが大きい
		fileappend(hdr, head, endpointer, lastpointer, apsize);
		head->fd_size += apsize;
	}
	head->trackp[trk] = fpointer;
	file_seek(hdr, fpointer, 0);
	file_write(hdr, TAO_BUF, tao.size);
	file_seek(hdr, 0, 0);
	file_write(hdr, head, sizeof(D88_HEADER));
	file_close(hdr);
}


void fdd_wtao_d88(BYTE data) {

	if (tao.flag != 3) {
		return;
	}
	tao.lostdatacnt = 0;
	if (tao.cnt > tao.maxsize) {
		endoftrack();
		return;
	}
	tao.cnt++;
	switch(tao.mode) {
		case TAO_ENDOFDATA:
			if (data == TAO_MODE_GAP) {
				tao.mode = TAO_MODE_GAP;
				tao.gap = 0;
			}
			break;
		case TAO_MODE_GAP:
			if (data == TAO_MODE_GAP) {
				if (tao.gap++ > 256) {
					endoftrack();
				}
			}
			else if (data == TAO_CMD_SYNC) {
				tao.mode = TAO_MODE_SYNC;
			}
#if 1												// ver0.26 Zeliard
			else if (data == 0xf4) {
				endoftrack();
			}
#endif
			else {
				tao.flag = 4;
			}
			break;
		case TAO_MODE_SYNC:
//			tao.cnt--;								// ver0.26 Zeliard
			if (data == TAO_CMD_AM_IN) {
				tao.mode = TAO_MODE_AM;
			}
			else if (data == TAO_CMD_IM_IN) {
				tao.mode = TAO_MODE_IM;
			}
			else if (data) {
				tao.flag = 4;
			}
			break;
		case TAO_MODE_IM:
			if (data == TAO_CMD_IM) {
				tao.mode = TAO_ENDOFDATA;
			}
			else if (data != TAO_CMD_IM_IN) {
				tao.flag = 4;
			}
			break;
		case TAO_MODE_AM:
			if (data == TAO_CMD_IAM) {
				tao.mode = TAO_MODE_ID;
				tao.ptr = 0;
				tao.top = tao.size;
			}
			else if (data == TAO_CMD_DAM) {
				tao.mode = TAO_MODE_DATA;
				tao.ptr = 0;
			}
			else if (data == TAO_CMD_DDAM) {
				tao.mode = TAO_MODE_DATA;
				tao.ptr = 0;
				((D88_SECTOR *)&TAO_BUF[tao.top])->del_flg = 1;
			}
			break;
		case TAO_MODE_ID:
			if ((data == TAO_CMD_IAM) && (!tao.ptr)) {
				break;
			}
			else if (tao.ptr < 4) {
				TAO_BUF[tao.size++] = data;
				tao.ptr++;
			}
			else if (data == TAO_CMD_CRC) {
				tao.mode = TAO_ENDOFDATA;
				ZeroMemory(&TAO_BUF[tao.size], 12);
				tao.size += 12;
			}
			break;
		case TAO_MODE_DATA:						// DATA WRITE
			if ((!tao.ptr) &&
				((data == TAO_CMD_DAM) || (data == TAO_CMD_DDAM))) {
				break;
			}
			else if (data == TAO_CMD_CRC) {			// nで判定した方が無難か？
				tao.mode = TAO_ENDOFDATA;
				((D88_SECTOR *)&TAO_BUF[tao.top])->size = tao.ptr;
				if (tao.sector++ > tao.maxsector) {
					tao.flag = 4;
				}
			}
			else {
				TAO_BUF[tao.size++] = data;
				tao.ptr++;
			}
			break;
	}
}


/* ---- state save / load ---- */

int fddd88_save_state(BYTE *buf, int maxlen) {
	int pos = 0;

	/* d88head[4] */
	SS_WRITE(buf, pos, d88head, sizeof(d88head));
	/* cursec */
	SS_WRITE(buf, pos, &cursec, sizeof(cursec));
	/* scalar statics */
	SS_WRITE_I32(buf, pos, (int32_t)curdrv);
	SS_WRITE_U16(buf, pos, curtrk);
	SS_WRITE_U8(buf, pos, curtype);
	SS_WRITE_U16(buf, pos, cursct);
	SS_WRITE_U32(buf, pos, curfp);
	SS_WRITE_U32(buf, pos, cursize);
	SS_WRITE_U8(buf, pos, curwrite);
	SS_WRITE_U8(buf, pos, curtrkerr);
	SS_WRITE_U8(buf, pos, hole);
	SS_WRITE_U16(buf, pos, crcnum);
	SS_WRITE_U8(buf, pos, crcerror);
	/* tao (WID_PARA) */
	SS_WRITE(buf, pos, &tao, sizeof(tao));
	/* D88_BUF, TAO_BUF */
	SS_WRITE(buf, pos, D88_BUF, sizeof(D88_BUF));
	SS_WRITE(buf, pos, TAO_BUF, sizeof(TAO_BUF));
	/* curdata as offset into D88_BUF (-1 if NULL) */
	{
		int32_t offset = curdata ? (int32_t)(curdata - D88_BUF) : -1;
		SS_WRITE_I32(buf, pos, offset);
	}

	return pos;
}

int fddd88_load_state(const BYTE *buf, int len) {
	int pos = 0;

	/* d88head[4] */
	SS_READ(buf, pos, d88head, sizeof(d88head));
	/* cursec */
	SS_READ(buf, pos, &cursec, sizeof(cursec));
	/* scalar statics */
	{
		int32_t tmp;
		SS_READ_I32(buf, pos, tmp);
		curdrv = (short)tmp;
	}
	SS_READ_U16(buf, pos, curtrk);
	SS_READ_U8(buf, pos, curtype);
	SS_READ_U16(buf, pos, cursct);
	SS_READ_U32(buf, pos, curfp);
	SS_READ_U32(buf, pos, cursize);
	SS_READ_U8(buf, pos, curwrite);
	SS_READ_U8(buf, pos, curtrkerr);
	SS_READ_U8(buf, pos, hole);
	SS_READ_U16(buf, pos, crcnum);
	SS_READ_U8(buf, pos, crcerror);
	/* tao (WID_PARA) */
	SS_READ(buf, pos, &tao, sizeof(tao));
	/* D88_BUF, TAO_BUF */
	SS_READ(buf, pos, D88_BUF, sizeof(D88_BUF));
	SS_READ(buf, pos, TAO_BUF, sizeof(TAO_BUF));
	/* curdata as offset into D88_BUF (-1 or out-of-range → safe default) */
	{
		int32_t offset;
		SS_READ_I32(buf, pos, offset);
		if (offset >= 0 && offset < (int32_t)sizeof(D88_BUF))
			curdata = D88_BUF + offset;
		else
			curdata = &D88_BUF[16];  /* safe fallback (same as seekerror) */
	}

	return 0;
}

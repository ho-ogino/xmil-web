#include	<windows.h>
#include	<stdio.h>
#include	<stdlib.h>
#include	<string.h>
#include	"x1.h"
#include	"dosio.h"
#include	"x1_dma.h"
#include	"x1_fdc.h"
#include	"fdd_2d.h"
#include	"fdd_d88.h"
#include	"fdd_mtr.h"
#include	"state_save.h"
#if T_TUNE
#include	"drawinfo.h"
#endif

#include	"trace.h"

#ifdef FDC_DMA_TRACE
#include	<emscripten.h>
#endif

		FDC_REGS	FDC;
		BYTE		FDC_c[4];
		char		FDC_NAME[4][X1_MAX_PATH];
		char		FDC_PATH[X1_MAX_PATH];
		BYTE		WRITEPT[4] = {0, 0, 0, 0};
		BYTE		DISKNUM[4] = {0, 0, 0, 0};
		BYTE		driveset = 0;
#if !T_TUNE
		BYTE		fdcdummyread = 0;
#endif

const	BYTE		fdctype[] = {1,1,1,1,1,1,1,1,2,2,2,2,3,4,3,3};
		WORD		readdiag = 0;

#if T_TUNE
	EVENT fdc_busy_event = EVENT_VALUE("FDD busy",0,NULL,0);
	EVENT fdc_rw_event = EVENT_VALUE("FDD R/W",0,NULL,0);
#endif

#if T_TUNE
/* read 1byte */
void fdc_read_callback(int param)
{
	if (dma.DMA_ENBL)
		dma.DMA_REDY = 0;
	event_remove(&fdc_rw_event);
}
/* write 1byte */
void fdc_write_callback(int param)
{
	if (dma.DMA_ENBL)
		dma.DMA_REDY = 0;
	event_remove(&fdc_rw_event);
}
/* read address 1byte */
void fdc_read_address_callback(int param)
{
	if (dma.DMA_ENBL)
		dma.DMA_REDY = 0;
	event_remove(&fdc_rw_event);
}
void fdc_rw_start(void (*byte_callback)(int),int first_dummy_bytes)
{
	fdc_rw_event.callback = byte_callback;
#if 1
	fdc_rw_event.interval = TIME_IN_USEC(FDC.media?32:32);
#endif
	fdc_rw_event.interval = TIME_IN_USEC(FDC.media?16:32);
	event_set(&fdc_rw_event,fdc_rw_event.interval*first_dummy_bytes);
}


#endif

/***********************************************************************
	ＦＤＤ （フロッピーの出入に相当する関数）
***********************************************************************/

short x1_fdimage(LPSTR fname) {

	int		leng;
	char	*p;

	leng = strlen(fname);
	if (leng > 3) {
		p = &fname[leng-3];
		if (strcmp(p, ".2D") == 0 || strcmp(p, ".2d") == 0) {
			return(DRV_FMT2D);
		}
	}
	if (leng > 4) {
		p = &fname[leng-4];
		if (strcmp(p, ".D88") == 0 || strcmp(p, ".d88") == 0 ||
			strcmp(p, ".88D") == 0 || strcmp(p, ".88d") == 0) {
			return(DRV_FMT88);
		}
	}
	return(DRV_EMPTY);
}


short x1_eject_fd(short drv) {

	if (drv < 0 || drv > 3) {
		return(0);
	}
	switch(DISKNUM[drv]) {
		case DRV_EMPTY:
			return(0);
		case DRV_FMT2D:
			return(fdd_eject_2d(drv));
	}
	return(fdd_eject_d88(drv));
}

short x1_set_fd(short drv, short dskno, LPSTR fname) {

	if (drv < 0 || drv > 3) {
		return(1);
	}
	if ((!fname) || (!fname[0])) {
		return(x1_eject_fd(drv));
	}
	switch(x1_fdimage(fname)) {
		case DRV_EMPTY:
			return(1);
		case DRV_FMT2D:
			return(fdd_set_2d(drv, fname));
	}
	return(fdd_set_d88(drv, fname));
}


LPSTR x1_get_fname(short drv) {

	return(FDC_NAME[drv]);
}


/***********************************************************************
	ＦＤＣ 初期化／終了
***********************************************************************/


void init_fdc(void) {

	FDDMTR_INIT;
	ZeroMemory(&FDC, sizeof(FDC));
	FDC.step = 1;
	ZeroMemory(FDC_c, 4);
}


BYTE fdd_stat(void) {

	switch(DISKNUM[FDC.drv]) {
		case DRV_EMPTY:
			return(0);
		case DRV_FMT2D:
			return(fdd_stat_2d());
	}
	return(fdd_stat_d88());
}


/***********************************************************************
	ＦＤＣ （Ｘ１から見るＩ／Ｏに相当する関数）
***********************************************************************/

int inc_off(void) {

	BYTE	ret;

	if (!FDC.motor) {
		return(0);
	}
#if T_TUNE
	if (event_enabled(&fdc_rw_event))
	{
#else
	if (fdcdummyread) {
		fdcdummyread--;
#endif
		return(0);
	}
	else {
		switch(DISKNUM[FDC.drv]) {
			case DRV_EMPTY:
				return(0);
			case DRV_FMT2D:
				ret = fdd_incoff_2d();
				break;
			default:
				ret = fdd_incoff_d88();
				break;
		}
		if (ret) {
			dma.DMA_REDY = 8;	// <- DMA ﾉ ﾚﾃﾞｨｼﾝｺﾞｳ ｦ ｸﾘｱ
		}
	}
	return(ret);
}


X1_IOW x1_fdc_w(WORD port, BYTE value) {

	short	cmnd;

	TRACEOUT(port, value);

	port &= 0xf;
	if (port == 8) {						// ｺﾏﾝﾄﾞ
		driveset = 0;
		FDC.cmnd = value;
		cmnd = value >> 4;
		FDC.type = fdctype[cmnd];
		FDC.skip = 2;
		switch(cmnd) {
			case 0:							// ﾘｽﾄｱ
				if (value & 8) {			// LAYDOCK
					FDC.skip = 0;
#if T_TUNE
					fdc_busy_event.callback = NULL;
					event_set(&fdc_busy_event,TIME_IN_NSEC(20*250));
#else
					FDC.busyclock = 20;		// ver0.25 (now testing)
					FDC.busystart = h_cntbase + h_cnt;
#endif
				}
				FDC.motor = 0x80;			// ﾓｰﾀｰOn?
				FDC.treg = FDC.c = 0;
				FDDMTR_MOVE;
				FDC.step = 1;
#if 1										// ver0.25
				FDC.rreg = FDC.r = 0;		// ﾃﾞｾﾞﾆﾜｰﾙﾄﾞ
#endif
				break;
			case 1:							// ｼｰｸ
				FDC.motor = 0x80;			// ﾓｰﾀｰOn
				FDC.step = (char)(FDC.c<=FDC.data?1:-1);
#if !T_TUNE // ｽﾀｰｸﾙｰｻﾞｰ
#if 1
				FDC.rreg = FDC.r = 0;
#endif
#endif
#if 1
				FDC.treg = FDC.c = FDC.data;
#else												// ちょい実験
				{
					int	seek = FDC.c + FDC.data - FDC.treg;
					if (seek >= (164/2)) {
						FDC.c = (164/2) - 1;
					}
					else if (seek < 0) {
						FDC.c = 0;
					}
					else {
						FDC.c = (BYTE)seek;
					}
					FDC.treg = FDC.c;
				}
#endif
				FDDMTR_MOVE;
				break;
			case 2: case 3:					// ｽﾃｯﾌﾟ
				if (FDC.motor) {
					FDC.c += FDC.step;
					if (cmnd & 1) {
						FDDMTR_MOVE;
						FDC.treg = FDC.c;
					}
				}
				break;
			case 4: case 5:					// ｽﾃｯﾌﾟ･ｲﾝ
				if (FDC.motor) {
					FDC.step = 1;
					FDC.c++;
					if (cmnd & 1) {
						FDDMTR_MOVE;
						FDC.treg = FDC.c;
					}
				}
				break;
			case 6: case 7:					// ｽﾃｯﾌﾟ･ｱｳﾄ
				if (FDC.motor) {
					FDC.step = -1;
					FDC.c--;
					if (cmnd & 1) {
						FDDMTR_MOVE;
						FDC.treg = FDC.c;
					}
				}
				break;

			case 0x8: case 0x9:				// ﾘｰﾄﾞ ﾃﾞｰﾀ
			case 0xa: case 0xb:				// ﾗｲﾄ  ﾃﾞｰﾀ
				FDC.off = 0;
#ifdef FDC_DMA_TRACE
				EM_ASM({console.log('FDC CMD: cmnd='+$0.toString(16)+' drv='+$1+' c='+$2+' h='+$3+' r='+$4+' DMA_ENBL='+$5+' REDY='+$6)},
					value, FDC.drv, FDC.c, FDC.h, FDC.r, dma.DMA_ENBL, dma.DMA_REDY);
#endif
#if T_TUNE
				dma.DMA_REDY = 8;
				if (FDC.motor) {
					//少なくともＩＤ読むまでデータは来ないので
					//16/32usec * 48byte 後にDMA_READYを出す
					fdc_rw_start( cmnd&0x02 ? fdc_write_callback:fdc_read_callback,48);
				}
#else
				fdcdummyread = 2;
				if (FDC.motor) {
					if (dma.DMA_ENBL) {
						dma.DMA_REDY = 0;		// <- DMA ﾆ ﾚﾃﾞｨｼﾝｺﾞｳ
//						FDC.skip = 0;			// DMAで割り込みを監視する事！
					}
				}
#endif
				break;

			case 0xc:							// ﾘｰﾄﾞ ｱﾄﾞﾚｽ
				FDC.crc_off = 0;
#if T_TUNE
				if (FDC.motor) {
					//少なくともsync 3byte + ID + 1st byteまでデータは来ないので
					//16/32usec * 4byte 後にDMA_READYを出す
					fdc_rw_start( fdc_read_address_callback,48);
				}
#else
				fdcdummyread = 2;
				if (FDC.motor) {				// ver0.25
					if (dma.DMA_ENBL) {
						dma.DMA_REDY = 0;		// <- DMA ﾆ ﾚﾃﾞｨｼﾝｺﾞｳ
					}
				}
#endif
				switch(DISKNUM[FDC.drv]) {
					case DRV_EMPTY:
						break;
					case DRV_FMT2D:
						fdd_crc_2d();
						break;
					default:
						fdd_crc_d88();
						break;
				}
				break;

			case 0xd:						// ﾌｫｰｽ.ｲﾝﾀﾗﾌﾟﾄ
#if !T_TUNE
				fdcdummyread = 0;			// 必要ない？
#endif
				FDC.skip = 0;				// 000330
				dma.DMA_REDY = 8;			// ver0.25
				break;

			case 0xe:						// ﾘｰﾄﾞ ﾄﾗｯｸ
				readdiag = 0;
				break;

			case 0xf:						// ﾗｲﾄ  ﾄﾗｯｸ
				switch(DISKNUM[FDC.drv]) {
					case DRV_EMPTY:
					case DRV_FMT2D:
						break;
					default:
						if (FDC.motor) {	// ver0.25
							init_tao_d88();
							if (dma.DMA_ENBL) {
								dma.DMA_REDY = 0;
							}
						}
						break;
				}
				break;
		}
	}
	else {
		cmnd = FDC.cmnd >> 4;
		switch(port) {
			case 0x9:				// ﾄﾗｯｸ
				FDC.treg = value;
				break;
			case 0xa:				// ｾｸﾀ
				FDDMTR_WAITSEC(value);
				FDC.rreg = FDC.r = value;
				break;
			case 0xb: // ﾃﾞｰﾀ
				FDC.data = value;
				if (cmnd==0x0a || cmnd==0x0b) {
					switch(DISKNUM[FDC.drv]) {
						case DRV_EMPTY:
							break;
						case DRV_FMT2D:
							fdd_write_2d();
							break;
						default:
							fdd_write_d88();
							break;
					}
					inc_off();
				}
				else if (cmnd==0x0f) {					// TRACK WRITE !!!
					switch(DISKNUM[FDC.drv]) {
						case DRV_EMPTY:
						case DRV_FMT2D:
							break;
						default:
							fdd_wtao_d88(value);
							break;
					}
				}
				break;
			case 0xc: // ﾄﾞﾗｲﾌﾞ/ｻｲﾄﾞ
				driveset = 1;
#if 1													// ARSYS !!!
				FDC_c[FDC.drv] = FDC.c;	
				FDC.c = FDC_c[value & 0x03];			// XTAL !!!
#else
				FDC_TBL[FDC.drv] = FDC;
				FDC = FDC_TBL[value & 0x03];
#endif
				FDC.motor = (BYTE)(value & 0x80);
				FDC.drv = value & 0x03;
#if T_TUNE
				drawinfo_fdd_led(FDC.drv,FDC.motor?FDC.media+1:0);
#endif
				FDC.h = (BYTE)(value & 0x10?1:0);

				FDC.cmnd = 0;							// T&E SORCERIAN
//				FDC.data = 0;							// 影の伝説
				FDC.type = 0;

				FDDMTR_DRVSET;
#if 0
	if (value == 1) {
		if ((!trace_sw) && (FDC.r == 7)) {
			debug_status();
			trace_sw = 1;
		}
	}
#endif
				if (!FDC.motor) {
					FDC.rreg = FDC.r = 0;				// SACOM TELENET !!!
#if 0													// XTAL !!!
					FDC.c = 0;
					FDC.step = 1;
#endif
				}
				break;
		}
	}
}

X1_IOR x1_fdc_r(WORD port) {

static	BYTE	timeoutwait;
static	BYTE	last_r;
static	short	last_off;
		BYTE	ans;
		BYTE	cmnd;

	TRACEIN(port);

	cmnd = (BYTE)(FDC.cmnd >> 4);

	if ((port &= 0xf) != 8) {
		last_r = -1;
		last_off = -1;
		timeoutwait = 4;
	}
	switch(port) {
		case 0x8:	// ｽﾃｰﾀｽ
			ans = 0;
#if !T_TUNE
			fdcdummyread = 0;
#endif
			if (FDC.skip) {
				FDC.skip--;
				return(1);
			}
#if T_TUNE
			if (event_enabled(&fdc_busy_event) || event_enabled(&fdc_rw_event)) {{
#else
			if (FDC.busyclock) {					// ver0.25
				if (((h_cntbase + h_cnt) - FDC.busystart) < FDC.busyclock) {
#endif
					TRACE_("busy", 1);
					return(1);
				}
				FDC.busyclock = 0;
			}
			if (!DISKNUM[FDC.drv]) {
				if (FDC.type == 1 && FDC.c == 0) {	// ドライブチェック !!!
					return(0x84);					// ←接続されてる時だけ
				}
				return(0x80);
			}
			if (FDC.type == 2) {
				if (last_r == FDC.r && last_off == FDC.off &&
						!(--timeoutwait)) {
					inc_off();
					timeoutwait = 4;
				}
				last_r = FDC.r;
				last_off = FDC.off;
			}							// Read Write時のみの変化でいい筈
			if (!((ans = fdd_stat()) & 2)) {
#ifdef FDC_DMA_TRACE
				if (dma.DMA_ENBL) {
					static BYTE trc_prev_stat_ans = 0xFF;
					static BYTE trc_prev_stat_redy = 0xFF;
					if (ans != trc_prev_stat_ans || dma.DMA_REDY != trc_prev_stat_redy) {
						EM_ASM({console.log('FDC STAT: ans='+$0.toString(16)+' REDY='+$1+'->8 r='+$2+' off='+$3)},
							ans, dma.DMA_REDY, FDC.r, FDC.off);
						trc_prev_stat_ans = ans;
						trc_prev_stat_redy = 8;
					}
				}
#endif
				dma.DMA_REDY = 8;				// <- DMA ﾉ ﾚﾃﾞｨｼﾝｺﾞｳ ｦ ｸﾘｱ
			}
#if 1
			if (driveset) {					// 0xffcを叩いた直後だったら
				ans &= 0xc4;
			}
#endif
			TRACE_("FDC status", ans);
			return(ans);

		case 0x9:							// ﾄﾗｯｸ
			return(FDC.treg);

		case 0xa:							// ｾｸﾀ
			return(FDC.rreg);				// ver0.25

		case 0xb:							// ﾃﾞｰﾀ
			if (FDC.motor) {
#if T_TUNE
				if (event_enabled(&fdc_rw_event))
					return(FDC.data);
#endif
				if (cmnd==0x08 || cmnd==0x09) {	// ﾘｰﾄﾞ･ﾃﾞｰﾀ
					switch(DISKNUM[FDC.drv]) {
						case DRV_EMPTY:
							break;
						case DRV_FMT2D:
							fdd_read_2d();
							break;
						default:
							fdd_read_d88();		// WOODY POCO !!!
							break;
					}
#ifdef FDC_DMA_TRACE
					if (dma.DMA_ENBL) {
						static BYTE trc_prev_r_pre = 0xFF;
						static short trc_prev_drv = -1;
						static short trc_prev_cmnd = -1;
						if (FDC.drv != trc_prev_drv || FDC.cmnd != trc_prev_cmnd) {
							trc_prev_r_pre = 0xFF;
							trc_prev_drv = FDC.drv;
							trc_prev_cmnd = FDC.cmnd;
						}
						if (FDC.r != trc_prev_r_pre) {
							EM_ASM({console.log('FDC PRE-INC: r='+$0+' off='+$1+' data='+$2.toString(16)+' REDY='+$3)},
								FDC.r, FDC.off, FDC.data, dma.DMA_REDY);
							trc_prev_r_pre = FDC.r;
						}
					}
#endif
					{
						int ret = inc_off();
#ifdef FDC_DMA_TRACE
						if (dma.DMA_ENBL) {
							static BYTE trc_prev_r_post = 0xFF;
							static short trc_prev_off_post = -1;
							static int trc_prev_ret = -1;
							static short trc_prev_drv2 = -1;
							static short trc_prev_cmnd2 = -1;
							if (FDC.drv != trc_prev_drv2 || FDC.cmnd != trc_prev_cmnd2) {
								trc_prev_r_post = 0xFF;
								trc_prev_off_post = -1;
								trc_prev_ret = -1;
								trc_prev_drv2 = FDC.drv;
								trc_prev_cmnd2 = FDC.cmnd;
							}
							if (FDC.r != trc_prev_r_post ||
								(FDC.off == 0 && trc_prev_off_post != 0) ||
								ret != trc_prev_ret) {
								EM_ASM({console.log('FDC POST-INC: r='+$0+' off='+$1+' ret='+$2+' REDY='+$3)},
									FDC.r, FDC.off, ret, dma.DMA_REDY);
								trc_prev_r_post = FDC.r;
								trc_prev_off_post = FDC.off;
								trc_prev_ret = ret;
							}
						}
#endif
						(void)ret;
					}
				}
				else if (cmnd==0x0c) {			// ﾘｰﾄﾞ･ｱﾄﾞﾚｽ
					if (FDC.crc_off < 6) {		// ver0.25
						FDC.data = FDC.crc_dat[FDC.crc_off];
#ifdef TRACE
{
	char	buf[256];
	wsprintf(buf, "crc: %3d %2d %02x -> %04x/%04x",
						(FDC.c << 1) + FDC.h, FDC.r, FDC.crc_off, R.HL.W,
							dma.CNT_B.w);
	TRACE_(buf, FDC.data);
}
#endif
#if T_TUNE
						FDC.crc_off++;
#else
						if (fdcdummyread) {		// ver0.25
							fdcdummyread--;
						}
						else {
							FDC.crc_off++;
						}
#endif
					}
				}
				else if (cmnd == 0x0e) {		// ver0.25(prepart)
					FDC.data = 0;
					readdiag++;
				}
			}
			return(FDC.data);					// WOODY POCO !!!

//		case 0xc:								// FM
//		case 0xd:								// MFM
		case 0xe:								// 1.6M
			FDC.media = 1;
#if T_TUNE
			drawinfo_fdd_led(FDC.drv,FDC.motor?FDC.media+1:0);
#endif
			return(0xff);
		case 0xf:								// 500K/1M
			FDC.media = 0;
#if T_TUNE
			drawinfo_fdd_led(FDC.drv,FDC.motor?FDC.media+1:0);
#endif
			return(0xff);
	}
	return(0);
}

/* ---- state save / load ---- */

int fdc_save_state(BYTE *buf, int maxlen) {
	int pos = 0;

	/* FDC_REGS struct */
	SS_WRITE(buf, pos, &FDC, sizeof(FDC));
	/* WRITEPT[4], DISKNUM[4] */
	SS_WRITE(buf, pos, WRITEPT, 4);
	SS_WRITE(buf, pos, DISKNUM, 4);
	/* driveset, readdiag */
	SS_WRITE_U8(buf, pos, driveset);
	SS_WRITE_U16(buf, pos, readdiag);

#if T_TUNE
	/* fdc_busy_event: active flag, timeleft, interval */
	{
		BYTE active = (event_enabled(&fdc_busy_event) ? 1 : 0);
		SS_WRITE_U8(buf, pos, active);
		if (active) {
			EV_TIME tl = event_timeleft(&fdc_busy_event);
			SS_WRITE_U32(buf, pos, tl);
			SS_WRITE_U32(buf, pos, fdc_busy_event.interval);
		}
	}
	/* fdc_rw_event: active flag, timeleft, interval, callback_id, callback_param */
	{
		BYTE active = (event_enabled(&fdc_rw_event) ? 1 : 0);
		SS_WRITE_U8(buf, pos, active);
		if (active) {
			EV_TIME tl = event_timeleft(&fdc_rw_event);
			SS_WRITE_U32(buf, pos, tl);
			SS_WRITE_U32(buf, pos, fdc_rw_event.interval);
			/* callback ID: 0=inactive, 1=fdc_read_callback, 2=fdc_write_callback, 3=fdc_read_address_callback */
			BYTE cb_id = 0;
			if (fdc_rw_event.callback == fdc_read_callback) cb_id = 1;
			else if (fdc_rw_event.callback == fdc_write_callback) cb_id = 2;
			else if (fdc_rw_event.callback == fdc_read_address_callback) cb_id = 3;
			SS_WRITE_U8(buf, pos, cb_id);
			SS_WRITE_I32(buf, pos, fdc_rw_event.callback_param);
		}
	}
#endif

	return pos;
}

int fdc_load_state(const BYTE *buf, int len) {
	int pos = 0;

	/* FDC_REGS struct */
	SS_READ(buf, pos, &FDC, sizeof(FDC));
	/* WRITEPT[4], DISKNUM[4] */
	SS_READ(buf, pos, WRITEPT, 4);
	SS_READ(buf, pos, DISKNUM, 4);
	/* driveset, readdiag */
	SS_READ_U8(buf, pos, driveset);
	SS_READ_U16(buf, pos, readdiag);

#if T_TUNE
	/* fdc_busy_event — read first, then apply */
	{
		BYTE active;
		EV_TIME tl = 0, intv = 0;
		SS_READ_U8(buf, pos, active);
		if (active) {
			SS_READ_U32(buf, pos, tl);
			SS_READ_U32(buf, pos, intv);
		}
		event_remove(&fdc_busy_event);
		if (active) {
			fdc_busy_event.interval = intv;
			fdc_busy_event.callback = NULL;
			event_set(&fdc_busy_event, tl);
		}
	}
	/* fdc_rw_event — read first, then apply */
	{
		BYTE active;
		EV_TIME tl = 0, intv = 0;
		BYTE cb_id = 0;
		int cb_param = 0;
		SS_READ_U8(buf, pos, active);
		if (active) {
			SS_READ_U32(buf, pos, tl);
			SS_READ_U32(buf, pos, intv);
			SS_READ_U8(buf, pos, cb_id);
			SS_READ_I32(buf, pos, cb_param);
		}
		event_remove(&fdc_rw_event);
		if (active) {
			fdc_rw_event.interval = intv;
			fdc_rw_event.callback_param = cb_param;
			switch (cb_id) {
				case 1: fdc_rw_event.callback = fdc_read_callback; break;
				case 2: fdc_rw_event.callback = fdc_write_callback; break;
				case 3: fdc_rw_event.callback = fdc_read_address_callback; break;
				default: fdc_rw_event.callback = NULL; break;
			}
			event_set(&fdc_rw_event, tl);
		}
	}
#endif

	return 0;
}


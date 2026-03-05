#include	<windows.h>
#include	<stdio.h>
#include	<string.h>

#include	"common.h"
#include	"xmil.h"
#include	"x1.h"
#include	"keylog.h"
#include	"x1_scpu.h"
#include	"x1_8255.h"
#include	"x1_pcg.h"
#include	"x1_crtc.h"
#include	"x1_vram.h"
#include	"x1_fdc.h"
#include	"x1_dma.h"
#include	"x1_dmam.h"
#include	"x1_ctc.h"
#include	"x1_clndr.h"
#include	"x1_sio.h"
#include	"x1_sound.h"
#include	"x1_cmt.h"
#include	"input.h"
#include	"draw.h"
#include	"ddraws.h"
#include	"timer.h"
#include	"dosio.h"
#include	"trace.h"
#include	"dsounds.h"
#include	"menu.h"
#include	"deffnt.h"
#include	"otherfnt.h"
#if T_TUNE
#include	"x1_event.h"
#include	"x1_irq.h"
#include	"X1_EMM.H"
#include	"x1_sasi.h"
#include	"drawinfo.h"
#include	"fdd_mtr.h"
#include	"state_save.h"
#endif

	X1_FLAG		x1flg = {250, 0, 1, 1, 0};

// コマンドラインで指定されたIPL ROMパス（空文字列なら自動選択）
char	g_ipl_rom_path[512] = "";
	BYTE		mMAIN[0x10000];
	BYTE		mBIOS[0x8000];
	BYTE		mBANK[16][0x8000];
	BYTE		KNJ_FNT[0x4bc00];
	BYTE		GRP_RAM[0x20000];
	BYTE		TXT_RAM[0x01800];
#if T_TUNE
	static WORD		v_cnt;
	DWORD		x1_tick_msec;
#else
	WORD		v_cnt;
	int			s_cnt;
#endif

	BYTE		*RAM0r;
	BYTE		*RAM0w;
	BYTE		lastmem;
#if T_TUNE
static void x1_V_SYNC_event_callback(int param);
	EVENT		V_SYNC_event = EVENT_VALUE("V-SYNC",0,x1_V_SYNC_event_callback,0);
	static EVENT	DISP_event = EVENT_VALUE("DISPLAY",0,NULL,0);
	EV_TIME		H_SYNC_interval;
	static BYTE V_SYNC_done; /* V-BLANK FOUND FLAG */

static void x1_1msec_event(int param);
	static EVENT scpu_event = EVENT_VALUE("subCPU,SIO",TIME_IN_MSEC(1),x1_1msec_event,0);

#else
	DWORD		h_cntbase;
#endif

extern  HWND    hWndMain;

/***********************************************************************
	IPL-ROM LOAD
***********************************************************************/

void ipl_load(void) {

	FILEH	hdl;

	ZeroMemory(mBIOS, sizeof(mBIOS));
	memcpy(mBIOS, DEFROM, sizeof(DEFROM));

	// コマンドラインでROMパスが指定された場合はそちらを優先
	if (g_ipl_rom_path[0] != '\0') {
		if ((hdl = file_open(g_ipl_rom_path)) != (FILEH)-1) {
			file_read(hdl, mBIOS, 0x8000);
			file_close(hdl);
			printf("IPL ROM loaded: %s\n", g_ipl_rom_path);
		} else {
			printf("Warning: IPL ROM not found: %s\n", g_ipl_rom_path);
		}
		return;
	}

	if (x1flg.ROM_TYPE >= 2) {
		if ((hdl = file_open_c("IPLROM.X1T")) != (FILEH)-1) {
			file_read(hdl, mBIOS, 0x8000);
			file_close(hdl);
		}
	}
	else if (x1flg.ROM_TYPE == 1) {
		if ((hdl = file_open_c("IPLROM.X1")) != (FILEH)-1) {
			file_read(hdl, mBIOS, 0x8000);
			file_close(hdl);
		}
	}
}


/***********************************************************************
	FONT-ROM LOAD
***********************************************************************/

void fnt_load(void) {

	FILEH	fh;
	BYTE	loaded = 0;
	BYTE	x1loaded;

	if ((fh = file_open_c("FNT0808.X1")) != (FILEH)-1) {
		file_read(fh, ANK_FNT[0], 8*256);
		file_close(fh);
		loaded |= FONT_ANK8;
		if (keylog_enabled()) keylog_printf("FNT LOAD FNT0808.X1 OK");
	}
	else {
		if (keylog_enabled()) keylog_printf("FNT LOAD FNT0808.X1 MISS");
	}

	if ((fh = file_open_c("FNT0816.X1")) != (FILEH)-1) {
		file_read(fh, KNJ_FNT, 0x1000);
		file_close(fh);
		loaded |= FONT_ANK16a | FONT_ANK16b;
		if (keylog_enabled()) keylog_printf("FNT LOAD FNT0816.X1 OK");
	}
	else {
		if (keylog_enabled()) keylog_printf("FNT LOAD FNT0816.X1 MISS");
	}
	if ((fh = file_open_c("FNT1616.X1")) != (FILEH)-1) {
		file_lread(fh, &KNJ_FNT[0x1000], 0x4ac00);
		file_close(fh);
		loaded |= FONT_KNJ1 | FONT_KNJ2;
		if (keylog_enabled()) keylog_printf("FNT LOAD FNT1616.X1 OK");
	}
	else {
		if (keylog_enabled()) keylog_printf("FNT LOAD FNT1616.X1 MISS");
	}

	x1loaded = loaded;

	if ((~loaded) & (FONT_ANK16a | FONT_KNJ1)) {
		loaded |= fm7fontread(loaded);
	}

	if (loaded != FONT_ALL) {
		loaded |= pc88fontread(loaded);
	}

	if (loaded != FONT_ALL) {
		loaded |= x68kfontread(loaded);
	}

	if ((~loaded) & (FONT_ALL ^ FONT_ANK8)) {
		loaded |= t98fontread(loaded);
	}

	// 最後に ANK16のパッチする
	if (!(x1loaded & FONT_ANK16a)) {
		patch_ank16();
	}

	printf("FONT load summary: x1=%02X final=%02X (ANK8=%d ANK16=%d KNJ16=%d)\n",
		(int)x1loaded, (int)loaded,
		((loaded & FONT_ANK8) != 0),
		((loaded & (FONT_ANK16a|FONT_ANK16b)) == (FONT_ANK16a|FONT_ANK16b)),
		((loaded & (FONT_KNJ1|FONT_KNJ2)) == (FONT_KNJ1|FONT_KNJ2)));
	if (keylog_enabled()) {
		keylog_printf("FNT SUMMARY x1=%02X final=%02X", (unsigned)x1loaded, (unsigned)loaded);
	}
}

#if T_TUNE
/***********************************************************************
	CALLBACK HANDLER OF EVENT TIMER
***********************************************************************/

static	BYTE	flame = 0;

/* DISPLAY update event callback (raster) */
static void x1_DISP_raster_callback(int param)
{
	if(v_cnt++ < crtc.CRT_YL)
	{
		scrnupdate1line(v_cnt-1);
		return;
	}

	event_remove(&DISP_event);
	scrnupdate();
}

/* DISPLAY update event callback (vblank/vsync) */
static void x1_DISP_callback(int param)
{
	scrnupdate();
}

/* V-SYNC interval event callback */
static void x1_V_SYNC_event_callback(int param)
{
	/* x1r_exec()ルーチンに終了通知 */
	V_SYNC_done++;
}

/* 1msec timer event */
static void x1_1msec_event(int param)
{
	x1_tick_msec++;
	/* sub cpu */
	x1_sub_int();
}
#endif

/***********************************************************************
	初期化
***********************************************************************/

BYTE reset_x1(BYTE ROM_TYPE, BYTE SOUND_SW, BYTE DIP_SW) {

	x1_psg_reset();
	x1_opm_reset();

	x1flg.HSYNC_CLK = 250;
	x1flg.ROM_SW = 1;
	x1flg.ROM_TYPE = ROM_TYPE;
	x1flg.SOUND_SW = SOUND_SW;
	x1flg.DIP_SW = DIP_SW;

	// スクリーンモードの変更...
	if (x1flg.ROM_TYPE >= 3) {
		if (changescreen(SCMD_SET65536)) {
			x1flg.ROM_TYPE = 2;
			changescreen(SCMD_SET256);
		}
	}

	textdrawproc_renewal();
	ipl_load();

	Z80_Reset();
#if T_TUNE
	/* setup event timers */
	event_init(1);
	event_setup_cpu(0,4000000L,&Z80_ICount);
#endif
	workclock_reset();

	lastmem = 0x78;
	RAM0r = mBIOS;
	RAM0w = mMAIN;
#if !T_TUNE
	h_cntbase = 0;
#endif

#if 0
	RAM0r = mMAIN;
	x1flg.ROM_SW = 0;
#if 1
	{
		FILEH	fh;
#if 1
		if ((fh = file_open_c("euphory.ram")) != (FILEH)-1) {
			file_read(fh, &mMAIN[0x0000], 0xffff);
			file_close(fh);
		}
#else
		if ((fh = file_open_c("chackn.pop")) != (FILEH)-1) {
			file_read(fh, &mMAIN[0x0000], 0xffff);
			file_close(fh);
		}
#endif
	}
#else
	{
		FILEH	fh;
		if ((fh = file_open_c("sys.com")) != (FILEH)-1) {
			file_read(fh, &mMAIN[0x0000], 4096);
			file_close(fh);
		}
		if ((fh = file_open_c("sc.com")) != (FILEH)-1) {
			file_read(fh, &mMAIN[0x1000], 4096);
			file_close(fh);
		}
		if ((fh = file_open_c("s.dat")) != (FILEH)-1) {
			file_read(fh, &mMAIN[0xe000], 0x2000);
			file_close(fh);
		}
	}
	x1_set_fd(0, 0, "d:\\prv_project\\work\\test.d88");
#endif
#endif

#if T_TUNE

	//垂直帰線期間のイベントタイマ
	//ＰＣＧの定義にも使われる
	H_SYNC_interval = x1flg.HSYNC_CLK * TIME_IN_NSEC(250); //@4MHz
	/* V-SYNC interval event */
	V_SYNC_event.interval = H_SYNC_interval*266;
	event_set(&V_SYNC_event,V_SYNC_event.interval);

	// １ｍｓｅｃイベントタイマ
	// キー割り込みとＳＩＯの監視をする
	// 本当は、こんなタイマ必要ないんだけど、手抜き
	event_set(&scpu_event ,scpu_event.interval);

	init_irq();
	init_emm();
	init_sasi();
#endif //T_TUNE

	clndr_init();

	init_fdc();
	init_scpu();
	init_8255();
	init_crtc();
	init_vram();

	init_dma();
	init_ctc();
	init_pcg();
	init_cmt();
	init_sio();

	return(SUCCESS);
}



/***********************************************************************
	実行／終了
***********************************************************************/

#if (T_TUNE == 0)
static	BYTE	keyintcnt = 0;
static	BYTE	flame = 0;
static	BYTE	inttiming = 0;
#endif

void x1r_init(void) {

	TRACE_START();

	init_draw();
	fnt_load();
	reset_x1(xmilcfg.ROM_TYPE, xmilcfg.SOUND_SW, xmilcfg.DIP_SW);

	timer_init(60);
#if T_TUNE
	x1_sound_init(15000); // sound update resolution is 15KHz
#endif

	x1_psg_cont();
	x1_opm_cont();
	keyboard_init();
	keyboard_reset();
	timer_setcount(0);
}


#if T_TUNE
void x1r_exec(void) {

extern	BYTE	disp_flashscreen;

	TRACE_START();

	/* set CPU speed */
	event_setup_cpu(0, 1000000L * xmilcfg.CPU8MHz,&Z80_ICount);

	xmilcfg.DISPSYNC &= 1;

	if(xmilcfg.DISPSYNC ==1)
	{
		/* set display update event */
		if(disp_flashscreen)
		{	/* V-BLANK */
			DISP_event.callback = x1_DISP_callback;
			DISP_event.interval = 0;
			event_set(&DISP_event, H_SYNC_interval*crtc.CRT_YL);
			v_cnt = crtc.CRT_YL;
		}
		else
		{	/* H-SYNC */
			DISP_event.callback = x1_DISP_raster_callback;
			DISP_event.interval = H_SYNC_interval;
			event_set(&DISP_event ,H_SYNC_interval);
			v_cnt = 0;
		}
	}
	else
	{	/* V-SYNC */
		DISP_event.callback = x1_DISP_callback;
		DISP_event.interval = 0;
		event_set(&DISP_event, event_timeleft(&V_SYNC_event));
		v_cnt = 266;
	}

	/* execute */
	V_SYNC_done = 0;
	do
	{
		/* run for next event */
		Z80_Execute();
		/* event update */
		event_update();
	}while(!V_SYNC_done);

	// if display update was not done , finish here
	if(event_enabled(&DISP_event))
	{
		event_remove(&DISP_event);
		scrnupdate();
	}

	/* sound update of this frame */
	x1_sound_update_frame();

	if (++flame >= 60) {
		flame = 0;
		clndr_inc();
	}
#if 0
	/* update CMT counter */
	if(!(flame%6) &&  scpu.Ex[0x0a][0]>=CMT_PLAY)
	{
		makecaption(1);
	}
#endif
}
#else //T_TUNE
void x1r_exec(void) {

extern	BYTE	disp_flashscreen;

	v_cnt = 0;
	s_cnt = 0;
	xmilcfg.DISPSYNC &= 1;
	inttiming = xmilcfg.CPU8MHz & 1;

	if (disp_flashscreen) {
		while(s_cnt < 266) {
			while(h_cnt < x1flg.HSYNC_CLK) {
				Z80_Execute();
				x1_dma();
				TRACE1();
			}
			h_cnt -= x1flg.HSYNC_CLK;
			h_cntbase += x1flg.HSYNC_CLK;
			inttiming ^= 2;
			if (inttiming != 3) {
				if (xmilcfg.SOUNDPLY) {
					STREAM_MAKES(pcmbufsize[s_cnt]);
				}
				s_cnt++;
				x1_ctc_int();
				if (!((++keyintcnt) & 15)) {
					x1_sub_int();
					if (xmilcfg.MOUSE_SW) {
						x1_sio();
					}
				}
			}
			v_cnt++;
			if (crtc.CRT_YL == v_cnt) {
				pcg.vsync = 1;
				if (xmilcfg.DISPSYNC == 1) {
					xmilcfg.DISPSYNC |= 0x80;
					scrnupdate();
				}
			}
		}
	}
	else {
		while(s_cnt < 266) {
			while(h_cnt < x1flg.HSYNC_CLK) {
				Z80_Execute();
				x1_dma();
				TRACE1();
			}
			h_cnt -= x1flg.HSYNC_CLK;
			h_cntbase += x1flg.HSYNC_CLK;
			inttiming ^= 2;
			if (inttiming != 3) {
				if (xmilcfg.SOUNDPLY) {
					STREAM_MAKES(pcmbufsize[s_cnt]);
				}
				s_cnt++;
				x1_ctc_int();
				if (!((++keyintcnt) & 15)) {
					x1_sub_int();
					if (xmilcfg.MOUSE_SW) {
						x1_sio();
					}
				}
			}
			if (!(xmilcfg.DISPSYNC & 0x80)) {
				scrnupdate1line(v_cnt);
			}
			v_cnt++;
			if (crtc.CRT_YL == v_cnt) {
				pcg.vsync = 1;
				if (xmilcfg.DISPSYNC == 1) {
					xmilcfg.DISPSYNC |= 0x80;
					scrnupdate();
				}
			}
		}
	}
	if (++flame >= 60) {
		flame = 0;
		clndr_inc();
	}
	if (!xmilcfg.SOUNDPLY) {
		STREAM_MAKES(framesoundcnt);
	}
	if (!(xmilcfg.DISPSYNC & 0x80)) {
		scrnupdate();
	}
}
#endif //T_TUNE


void x1r_term(void) {

#if T_TUNE
	emm_close_handle();
	sasi_close_handle();
#endif
	timer_term();
	x1_opm_stop();
	x1_psg_stop();
	keyboard_term();
	TRACE_END();

	x1_set_fd(0, 0, NULL);
	x1_set_fd(1, 0, NULL);
	x1_set_fd(2, 0, NULL);
	x1_set_fd(3, 0, NULL);
}



X1_IOR x1_dipsw_r(WORD port) {

	return(x1flg.DIP_SW);
}

// ---------------------------------------------------------------------------

static struct {
	DWORD	tick;
	DWORD	clock;
	DWORD	draws;
} worklast;

void workclock_reset(void) {

	worklast.tick = GetTickCount();
#if T_TUNE
	worklast.clock = x1_tick_msec = 0;
#else
	worklast.clock = h_cnt + h_cntbase;
#endif
	worklast.draws = drawtime;
}

WORKCLOCK_T *workclock_get(void) {

static	WORKCLOCK_T		workclock;

	DWORD	tick = GetTickCount();
	DWORD	nowclock;

	if ((tick - worklast.tick) < 2000) {
		return(NULL);
	}
	workclock.draws = ((drawtime - worklast.draws) * 10000)
													/ (tick - worklast.tick);
	worklast.draws = drawtime;
#if T_TUNE
	nowclock = x1_tick_msec;
	workclock.khz = xmilcfg.CPU8MHz*1000*(nowclock - worklast.clock) / (tick - worklast.tick);
#else
	nowclock = h_cnt + h_cntbase;
	workclock.khz = (nowclock - worklast.clock) / (tick - worklast.tick);
#endif
	worklast.clock = nowclock;
	worklast.tick = tick;
	return(&workclock);
}

void makecaption(BYTE flg, WORKCLOCK_T *workclock) {

static	char	title[1024] = "";
static	char	clock[64] = "";
		char	*p;
		char	work[1024+64+2];

	if (flg & 1) {
		strcpy(title, szProgName);
		p = (char *)x1_get_fname(0);
		if (*p) {
#if T_TUNE
			p = getFileName(p);
			strcat(work, "  FDD1:");
			strcat(work, p);
		}
		drawinfo_fdd_name(0,getFileName(p));
#else
			strcat(title, "  FDD0:");
			strcat(title, getFileName(p));
		}
#endif
		p = (char *)x1_get_fname(1);
		if (*p) {
#if T_TUNE
			p = getFileName(p);
			strcat(work, "  FDD1:");
			strcat(work, p);
		}
		drawinfo_fdd_name(1,getFileName(p));
#else
			strcat(work, "  FDD1:");
			strcat(work, getFileName(p));
		}
#endif
#if T_TUNE
		//CMT filename:status:position
		p = cmt_get_tape_name();
		if(*p)
		{
			p = getFileName(p);
			strcat(work, "  CMT:");
			strcat(work, p);
		}
		drawinfo_cmt_name(getFileName(p));
		/* CPU SPEED */
		drawinfo_clock(xmilcfg.CPU8MHz);
#endif
	}
	if (flg & 6) {
		clock[0] = '\0';
		if (workclock) {
			if (flg & 4) {
				if (workclock->draws) {
					wsprintf(clock, " - %u.%1uFPS",
							(workclock->draws / 10), (workclock->draws % 10));
				}
				else {
					wsprintf(clock, " - 0FPS");
				}
			}
			if (flg & 2) {
				wsprintf(work, " %2u.%03uMHz",
							(workclock->khz / 1000), (workclock->khz % 1000));
				if (!clock[0]) {
					strcpy(clock, " -");
				}
				strcat(clock, work);
			}
		}
	}
	strcpy(work, title);
	strcat(work, clock);
	SetWindowText(hWndMain, work);
}

#if T_TUNE
/* ---- state save/load ---- */

/* DISP_event callback ID mapping */
static int disp_callback_id(void (*cb)(int))
{
	if (cb == x1_DISP_callback) return 1;
	if (cb == x1_DISP_raster_callback) return 2;
	return 0;
}

static void (*disp_callback_from_id(int id))(int)
{
	switch (id) {
	case 1: return x1_DISP_callback;
	case 2: return x1_DISP_raster_callback;
	default: return NULL;
	}
}

int x1_save_state(BYTE *buf, int maxlen)
{
	int pos = 0;

	/* scalar statics */
	SS_WRITE_U16(buf, pos, v_cnt);
	SS_WRITE_U8(buf, pos, flame);
	SS_WRITE_U8(buf, pos, V_SYNC_done);
	SS_WRITE_U8(buf, pos, lastmem);
	SS_WRITE_VAL(buf, pos, x1flg);
	SS_WRITE_VAL(buf, pos, x1_tick_msec);
	SS_WRITE_VAL(buf, pos, H_SYNC_interval);

	/* V_SYNC_event (fixed callback) */
	{
		BYTE active = (V_SYNC_event.next != NULL) ? 1 : 0;
		SS_WRITE_U8(buf, pos, active);
		if (active) {
			EV_TIME tl = event_timeleft(&V_SYNC_event);
			SS_WRITE_VAL(buf, pos, tl);
			SS_WRITE_VAL(buf, pos, V_SYNC_event.interval);
		}
	}

	/* DISP_event (dynamic callback) */
	{
		BYTE active = (DISP_event.next != NULL) ? 1 : 0;
		int cb_id = disp_callback_id(DISP_event.callback);
		SS_WRITE_U8(buf, pos, active);
		SS_WRITE_U8(buf, pos, (BYTE)cb_id);
		SS_WRITE_VAL(buf, pos, DISP_event.interval);
		SS_WRITE_VAL(buf, pos, DISP_event.callback_param);
		if (active) {
			EV_TIME tl = event_timeleft(&DISP_event);
			SS_WRITE_VAL(buf, pos, tl);
		}
	}

	/* scpu_event (fixed callback) */
	{
		BYTE active = (scpu_event.next != NULL) ? 1 : 0;
		SS_WRITE_U8(buf, pos, active);
		if (active) {
			EV_TIME tl = event_timeleft(&scpu_event);
			SS_WRITE_VAL(buf, pos, tl);
			SS_WRITE_VAL(buf, pos, scpu_event.interval);
		}
	}

	return pos;
}

int x1_load_state(const BYTE *buf, int len)
{
	int pos = 0;

	/* scalar statics */
	SS_READ_U16(buf, pos, v_cnt);
	SS_READ_U8(buf, pos, flame);
	SS_READ_U8(buf, pos, V_SYNC_done);
	SS_READ_U8(buf, pos, lastmem);
	SS_READ_VAL(buf, pos, x1flg);
	SS_READ_VAL(buf, pos, x1_tick_msec);
	SS_READ_VAL(buf, pos, H_SYNC_interval);

	/* Rebuild RAM0r/RAM0w from lastmem + x1flg
	 * Must match the logic in X1_IO.CPP:
	 *   Port 0x0Bxx (ROM_TYPE>=2): bank switching
	 *   Port 0x1Dxx/0x1Exx:        ROM on/off (ROM_SW)
	 */
	if (x1flg.ROM_TYPE >= 2 && !(lastmem & 0x10)) {
		/* Bank mode (turbo/turboZ): read & write go to bank RAM */
		RAM0r = RAM0w = mBANK[lastmem & 15];
	} else {
		/* Main memory mode */
		RAM0w = mMAIN;
		RAM0r = x1flg.ROM_SW ? mBIOS : mMAIN;
	}

	/* V_SYNC_event — read all fields first, then apply */
	{
		BYTE active;
		EV_TIME tl = 0, interval = 0;
		SS_READ_U8(buf, pos, active);
		if (active) {
			SS_READ_VAL(buf, pos, tl);
			SS_READ_VAL(buf, pos, interval);
		}
		event_clear(&V_SYNC_event);
		if (active) {
			V_SYNC_event.interval = interval;
			V_SYNC_event.callback = x1_V_SYNC_event_callback;
			V_SYNC_event.callback_param = 0;
			event_set(&V_SYNC_event, tl);
		}
	}

	/* DISP_event — read all fields first, then apply */
	{
		BYTE active, cb_id;
		EV_TIME interval = 0, tl = 0;
		int cb_param = 0;
		SS_READ_U8(buf, pos, active);
		SS_READ_U8(buf, pos, cb_id);
		SS_READ_VAL(buf, pos, interval);
		SS_READ_VAL(buf, pos, cb_param);
		if (active) {
			SS_READ_VAL(buf, pos, tl);
		}
		event_clear(&DISP_event);
		DISP_event.interval = interval;
		DISP_event.callback_param = cb_param;
		DISP_event.callback = disp_callback_from_id(cb_id);
		if (active) {
			event_set(&DISP_event, tl);
		}
	}

	/* scpu_event — read all fields first, then apply */
	{
		BYTE active;
		EV_TIME tl = 0, interval = 0;
		SS_READ_U8(buf, pos, active);
		if (active) {
			SS_READ_VAL(buf, pos, tl);
			SS_READ_VAL(buf, pos, interval);
		}
		event_clear(&scpu_event);
		if (active) {
			scpu_event.interval = interval;
			scpu_event.callback = x1_1msec_event;
			scpu_event.callback_param = 0;
			event_set(&scpu_event, tl);
		}
	}

	return 0;
}
#endif /* T_TUNE */

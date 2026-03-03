#if T_TUNE

/* all of source was replaced , based "x1_tape.c" in X1EMU 0.5 */
#include	<windows.h>
#include	<stdio.h>
#ifdef __EMSCRIPTEN__
#include	<emscripten.h>
#endif
#include	"x1.h"
#include	"xmil.h"
#include	"x1_cmt.h"
#include	"x1_scpu.h"
#include	"menu.h"
#include	"dosio.h"
#include	"dsounds.h"
#include	"drawinfo.h"
#include	"state_save.h"
/*
  note:
	センサーのビット０（回転中）はFF側のリールを検出している。
　　手でFF側のリールを回しても反応するので明らかだ
  　・FF側のリール回転−＞即センサーＯＮ
　　・FF側のリール停止−＞２秒くらい後にセンサーＯＦＦ
*/
#define tape_freq (tape.header.frequency)
#define tape_pos  (tape.header.position)
#define tape_end  (tape.header.datasize)
#define tape_protect (tape.header.protect)

/* FF/REWの速度（倍率） */
/* とある30分TAAPE(片面15分)を巻き取るのに54秒だった */
#define FF_REW_SPEED 16
/* APSSの速度（倍率） */
#define APSS_SPEED 16

/* APSSの検出時間設定 */
#define APSS_HEAD_IGNORE (tape_freq*2) /* 開始時の無効部分 2sec */
#define APSS_NOSILENT    (tape_freq*2) /* 有音検出時間 2sec */
#define APSS_SILENT      (tape_freq*2) /* 無音検出時間 2sec */
/* ヘッドの動作時間 */
#define HEAD_UP_TIME         TIME_IN_MSEC(200) /* 200msec */
#define HEAD_DOWN_PLAY_TIME  TIME_IN_MSEC(500) /* 500msec PLAY */
#define HEAD_DOWN_TIME       TIME_IN_MSEC(100) /* 100msec FF,REW,REC */

CMT_TABLE tape;
static char tape_filename[128] = { 0 };
/* LP64(macOS arm64/SDL)で書かれたヘッダーかどうか(WASM32固有問題) */
static int s_tape_lp64 = 0;

/* モーター回転イベント */
static EVENT motor_event = EVENT_VALUE("CMT MOTOR",0,NULL,0);
/* ヘッドアップ／ダウンイベント */
static EVENT head_event = EVENT_VALUE(NULL,0,NULL,0);

static void cmt_head_up(void);


static const X1TAPE_HEADER default_header =
{
	TAPE_INDEX,
	"auto converted",
	{0,0,0,0,0},
	0,
	TAPE_FORMAT_SAMPLING,
	0,
	8000,
	0
};

#if 0
/**********************************************************************
	ステータス文字列の作成
**********************************************************************/
/* update tape state and window title */
char *cmt_get_stat_str(void)
{
	static char work[128];

	unsigned long t;
	int s,m,h;
	static const char *cmt_cmd_str[]=
	{
		"EJT","STP","PLY","FF ",
		"REW","AFF","ARW","   ",
		"   ","   ","REC"
	};

	t=tape_freq ? (tape_pos / tape_freq) : 0;
	s=(int)(t%60l); t/=60l;
	m=(int)(t%60l); t/=60l;
	h=(int)(t%60l);
	sprintf(work," %s(%1d:%02d:%02d)",cmt_cmd_str[tape.cur_cmd],h,m,s);

	return work;
}
#endif


void init_cmt(void)
{
	if( tape_filename[0] == 0)
	{
		ZeroMemory(&tape, sizeof(CMT_TABLE));
		tape.cur_cmd = CMT_STOP;
		cmt_set_protect(0);
	}
	else
		cmt_stop();
	drawinfo_cmt_cnt();
}

/**********************************************************************
	テープヘッダーのセーブ
**********************************************************************/
static void cmt_save_header(void)
{
	/* output tape position */
	if( (tape.header.index == TAPE_INDEX) && (tape_freq != 0) )
	{
		FILEH hdr;

		/* write header to file */
		if ((hdr = file_open(tape_filename)) != (FILEH)-1)
		{
			if (s_tape_lp64) {
				/* LP64形式ファイル: position は offset 48 に 8バイトLE で書く */
				BYTE lbuf[8] = { 0 };
				lbuf[0] = (BYTE)(tape_pos);
				lbuf[1] = (BYTE)(tape_pos >> 8);
				lbuf[2] = (BYTE)(tape_pos >> 16);
				lbuf[3] = (BYTE)(tape_pos >> 24);
				if (file_seek(hdr, 48, FSEEK_SET) == 48)
					file_write(hdr, lbuf, 8);
			} else {
				if (file_seek(hdr, 0, FSEEK_SET) == 0)
					file_write(hdr, &tape.header, sizeof(tape.header));
			}
			file_close(hdr);
		}
	}
}

/**********************************************************************
	テープファイルの読み書き
**********************************************************************/

/* flush curent buffer */
static int cmt_flush_buffer(void)
{
	FILEH hdr;
	DWORD cur_ptr;
	int ret = 0;

	if(!tape_freq)
		return(-1);

	if (!tape.dirty_buf || (tape.page==-1) )
		return(0);

	if ((hdr = file_open(tape_filename)) == (FILEH)-1) {
		return(-1);
	}

	cur_ptr = tape.page * CMT_PAGE_SIZE + (DWORD)(s_tape_lp64 ? 56 : sizeof(X1TAPE_HEADER));
	tape.page = -1;
	tape.dirty_buf = 0;
	if ((file_seek(hdr, cur_ptr, FSEEK_SET) != cur_ptr) ||
		(file_write(hdr, tape.buf, tape.buf_size) != tape.buf_size)) {
		ret = -1;
	}
	if (file_close(hdr)) {
		ret = -1;
	}
	return(ret);
}

/* get pointer of tape data */
static BYTE *cmt_data_ptr(DWORD pos)
{
	static BYTE dummy_data=0;
	FILEH hdr;
	DWORD cur_ptr;
	DWORD page;

	if(!tape_freq)
		return(&dummy_data);

	page = pos / CMT_PAGE_SIZE;
	pos %= CMT_PAGE_SIZE;
	if(tape.page == page)
		return &tape.buf[pos];

	/* flush current buffer */
	if( cmt_flush_buffer() < 0)
		return(&dummy_data);

	/* read new buffer */
	if ((hdr = file_open(tape_filename)) == (FILEH)-1)
		return(&dummy_data);

	cur_ptr = page * CMT_PAGE_SIZE + (DWORD)(s_tape_lp64 ? 56 : sizeof(X1TAPE_HEADER));

	if(cur_ptr+CMT_PAGE_SIZE > tape.filesize)
		tape.buf_size = (WORD)(tape.filesize - cur_ptr);
	else
		tape.buf_size = CMT_PAGE_SIZE;

	if ((file_seek(hdr, cur_ptr, FSEEK_SET) != cur_ptr) ||
		(file_read(hdr, tape.buf, tape.buf_size) != tape.buf_size))
	{
		file_close(hdr);
		return &dummy_data;
	}

	if (file_close(hdr))
		return &dummy_data;

	tape.page = page;
	return &tape.buf[pos];
}

/**********************************************************************
	センサーのチェック
**********************************************************************/

static void cmt_set_sensor(void)
{
	if(!tape_freq)
		tape.sensor &= ~(2|4);
	else
	{
		tape.sensor |= 2;    /* ｶｾｯﾄ 0=ﾅｼ 1=ｱﾘ */
		if(!tape_protect)
			tape.sensor |= 4; /* ｶｷｺﾐ 1=OK */
		else
			tape.sensor &= ~4; /* ｶｷｺﾐ 0=ｷﾝｼ */
	}
}

/**********************************************************************
	テープモーターのイベントハンドラと、モーターの制御
**********************************************************************/

/* set motor event */
static void cmt_motor_start(void (*callback)(int),int param)
{
	/* set motor event interval with adjust overclock rate */
	/* CPUのクロック率は実速度から計算する。設定値を参照してはダメ。 */
	motor_event.interval = TIME_IN_CYCLES(4000000L,0) / tape_freq;
	motor_event.callback = callback;
	motor_event.callback_param = param;
	event_set(&motor_event,motor_event.interval);
}

/* adjust timming sampling period to write eddge */
static void adjust_rec_timming(void)
{
#if 0
	/* 32KHz以下のテープファイルは補正無し */
	if( (tape_freq < 32000) && (tape.cur_cmd == CMT_REC) )
#else
	if( tape.cur_cmd == CMT_REC )
#endif
	{
		event_set(&motor_event,motor_event.interval/2);
	}
}

/* stop tape motor */
static void motor_stop(void)
{
	event_remove(&motor_event);
	tape.sensor &= ~1;
}

/* tape position increment & check break */
static int tape_move_pos(long step)
{
	if(step >= 0)
	{
		if( tape_pos+step >= tape_end)
		{
			/* tape end */
			tape_pos = tape_end-1;
			/* 本来は２秒がんばってから停止するぅ */
			if( tape.headdown )
				cmt_stop();
			return 1;
		}
		tape_pos += step;
	}
	else
	{
		step = -step;
		if( tape_pos <= (unsigned long)step )
		{
			tape_pos = 0;
			/* 本来は２秒がんばってから停止するぅ */
			if( tape.headdown )
				cmt_stop();
			return 1;
		}
		tape_pos -= step;
	}
	/* not tape stop */
	tape.sensor |= 1;
	drawinfo_cmt_cnt();
	return 0;
}

/* PLAY one sampling rate */
static void cmt_play_callback(int param)
{
	tape_move_pos((long)param);
}

/* REC one sampling rate */
static void cmt_rec_callback(int param)
{
	BYTE bit_mask;
	BYTE *ptr;

	tape_move_pos((long)param);
	/* write data */
	bit_mask  = 0x80 >> (tape_pos&7);
	ptr = cmt_data_ptr(tape_pos/8);
	if(tape.data)
		(*cmt_data_ptr(tape_pos/8)) |= bit_mask;
	else
		(*cmt_data_ptr(tape_pos/8)) &= ~bit_mask;
	tape.dirty_buf = 1;
}

/* FF/REW sampling rate */
static void cmt_ff_rew_callback(int param)
{
	tape_move_pos((long)param);
}

/* APSS FF/REW sampling rate */
static void cmt_apss_callback(int speed)
{
	unsigned long pos;
	BYTE data,mask;
	int num_bit =0;

	if( tape_move_pos((long)speed) )
		return;

	/* increment tape position and sampling data bits */
	for( pos=tape_pos ; pos != tape_pos+APSS_SPEED ; pos++)
	{
		mask  = 0x80>>(pos&7);
		data  = *cmt_data_ptr(pos/8);
		if(data&mask)
			num_bit++;
	}

	/* ０／1の割合が、１：９または９：１の時、無音とする */
	if(num_bit*2 > APSS_SPEED) // 50% ? 
		num_bit = APSS_SPEED-num_bit;
	if( num_bit*5 < APSS_SPEED) // 20%
	{	/* silent */
		if( (tape.apss_cnt>=-(long)APSS_NOSILENT) && (tape.apss_cnt<0) )
			tape.apss_cnt = -(long)APSS_NOSILENT;
	}
	else
	{	/* not silent */
		if(tape.apss_cnt >0)
			tape.apss_cnt = 0;
	}

	/* add silent count & finish check */
	tape.apss_cnt += APSS_SPEED;
	if( tape.apss_cnt >= (long)APSS_SILENT)
		cmt_ctrl(CMT_STOP,0);
}

/* finish HEAD down */
static void cmt_head_down_callback(int param)
{
	int speed;
	int ff_flag = 0;

	tape.busy &= ~1;
	tape.headdown = 1;

	switch(tape.cur_cmd)
	{
		case CMT_PLAY:
			cmt_motor_start(cmt_play_callback,1);
			/* no wait ! */
			xmilcfg.NOWAIT |= 0x02;
			x1_sub_cmtrx(tape.cur_cmd);
			break;
		case CMT_FF:
		case CMT_REW:
			ff_flag = 1;
			speed = (tape.cur_cmd==CMT_FF) ? FF_REW_SPEED : -FF_REW_SPEED;
			cmt_motor_start(cmt_ff_rew_callback,speed);
			x1_sub_cmtrx(tape.cur_cmd);
			break;
		case CMT_AFF:
		case CMT_AREW:
			ff_flag = 1;
			tape.busy |= 2;
			speed = (tape.cur_cmd==CMT_AFF) ? APSS_SPEED : -APSS_SPEED;
			/* 有音検出＋無効検出の時間を足す */
			tape.apss_cnt = -(long)(APSS_HEAD_IGNORE+APSS_NOSILENT);
			cmt_motor_start(cmt_apss_callback,speed);
			/* no wait ! */
			xmilcfg.NOWAIT |= 0x02;
			x1_sub_cmtrx(tape.cur_cmd);
			break;
		case CMT_REC:
			if(tape_protect) return;
			cmt_motor_start(cmt_rec_callback,1);
			/* no wait ! */
			xmilcfg.NOWAIT |= 0x02;
			x1_sub_cmtrx(tape.cur_cmd);
			break;
		default:
			/* STOP,EJECT */
			cmt_head_up();
	}
	if(ff_flag && xmilcfg.MOTOR)
		WAVE_PLAY(WAV_FFREW,1);
	/* currect LED ON */
	drawinfo_cmt_icon(tape.cur_cmd,1);
}

/* HEAD down */
static void cmt_head_down(int is_play)
{
	if(!tape_freq)
		return;

	if(!tape.headdown)
	{
		/* ０．５秒後 */
		head_event.name     = "CMT HEAD DOWN";
		head_event.callback = cmt_head_down_callback;
		event_set(&head_event, is_play ? HEAD_DOWN_PLAY_TIME : HEAD_DOWN_TIME);
		tape.busy |= 1;
		if(xmilcfg.MOTOR)
			WAVE_PLAY(WAV_PLAY,0);
	}
	else
		cmt_head_down_callback(0);
}

/* finish HEAD up */
static void cmt_head_up_callback(int param)
{
	tape.busy &= ~1;
	tape.headdown = 0;

	/* ヘッドを上げ終わったとき、モーターを停止 */
	if(param)
		motor_stop();

	/* ヘッドああがった後の処理 */
	switch(tape.cur_cmd)
	{
		case CMT_EJECT:
			x1_sub_cmtrx(tape.cur_cmd);
			cmt_set_sensor();
			if(xmilcfg.MOTOR)
				WAVE_PLAY(WAV_EJECT,0);
#if 0
			if(tape_filename[0]!=0)
				changetape();
#endif
			break;
		case CMT_STOP:
			tape.busy &= ~2;
			x1_sub_cmtrx(tape.cur_cmd);
			break;
		case CMT_PLAY:
			if(tape_freq)
				cmt_head_down(1);
			break;
		case CMT_FF:
		case CMT_REW:
		case CMT_AFF:
		case CMT_AREW:
		case CMT_REC:
			if(tape_freq)
				cmt_head_down(0);
			break;
	}
}

/* HEAD up */
static void cmt_head_up(void)
{
	if(tape.headdown)
	{
		/* ０．５秒後 */
		head_event.name     = "CMT HEAD UP";
		head_event.callback = cmt_head_up_callback;
		head_event.callback_param = 1;
		event_set(&head_event,HEAD_UP_TIME);
		tape.busy |= 1;

		/* テープの停止を開始するが、惰性で動くので速度を1/2に落とす     */
		/* 停止時にちょっと動かないと、thexderで次のロードがエラーになる */
		motor_event.interval *= 2;

		if(xmilcfg.MOTOR)
		{
			WAVE_STOP(WAV_FFREW);
			WAVE_PLAY(WAV_STOP,0);
		}
		xmilcfg.NOWAIT &= 0xfd;
	}
	else
	{
		/* すでにあがっていたら、次の処理へ */
		cmt_head_up_callback(0);
	}
}


/**********************************************************************
	テープの投入／イジェクト ボタン に相当する関数
**********************************************************************/

char *cmt_get_tape_name(void)
{
	return tape_filename;
}

// sw ... 0=録音可 1=録音不可
void cmt_set(char *fname)
{
	FILEH hdr;

	if(tape_freq)
		cmt_eject();

	if( fname[0])
		strcpy(tape_filename,fname);

	if ((hdr = file_open(tape_filename)) == (FILEH)-1)
	{
		printf("[cmt_set] file_open FAILED: %s\n", tape_filename);
		return;
	}
	/* file length */
	tape.filesize = file_length(hdr);
	if(tape.filesize < sizeof(tape.header) )
	{
		printf("[cmt_set] file too small (need %lu)\n", (unsigned long)sizeof(tape.header));
		return;
	}

	/* read header */
	file_read(hdr, &tape.header ,sizeof(tape.header));
	file_close(hdr);

	/* when old format file , auto conversion */
	if(tape.header.index != TAPE_INDEX)
	{
		DWORD frq = tape.header.index;
		memcpy(&tape.header,&default_header,sizeof(X1TAPE_HEADER) );
		tape_freq = frq;
		tape_end  = (tape.filesize - sizeof(X1TAPE_HEADER))*8;
#if 1
		/* 自動変換してよいかどうかの確認 */
extern HWND hWndMain;

		if( MessageBox(hWndMain,"\
旧フォーマットのテープファイルです。\n\
自動変換すると先頭３６バイトのデータは失われます。\n\
新フォーマットに自動変換しますか？"
			,"確認",MB_YESNO | MB_ICONQUESTION | MB_TASKMODAL ) != IDYES )
		{
			tape.header.index = 0; /* セーブしないように */
		}
#endif
		/* save the header */
		cmt_save_header();
	}

	/* WASM32 では unsigned long = 4バイト (sizeof(X1TAPE_HEADER)=40) だが、
	   LP64環境 (SDL/macOS arm64) で書かれたファイルは unsigned long = 8バイト (sizeof=56)。
	   freq > 96000 かつ filesize >= 56 の場合は LP64 レイアウトで再パースする。 */
	s_tape_lp64 = 0;
	if ((tape_freq == 0 || tape_freq > 96000) && tape.filesize >= 56) {
		FILEH hdr2 = file_open(tape_filename);
		if (hdr2 != (FILEH)-1) {
			BYTE lbuf[56];
			if (file_read(hdr2, lbuf, 56) == 56) {
				/* LP64: frequency at offset 32 (8 bytes LE, high 4 bytes are 0) */
				DWORD lp_freq = lbuf[32] | ((DWORD)lbuf[33]<<8) | ((DWORD)lbuf[34]<<16) | ((DWORD)lbuf[35]<<24);
				/* LP64: datasize at offset 40 */
				DWORD lp_end  = lbuf[40] | ((DWORD)lbuf[41]<<8) | ((DWORD)lbuf[42]<<16) | ((DWORD)lbuf[43]<<24);
				/* LP64: position at offset 48 */
				DWORD lp_pos  = lbuf[48] | ((DWORD)lbuf[49]<<8) | ((DWORD)lbuf[50]<<16) | ((DWORD)lbuf[51]<<24);
				if (lp_freq >= 100 && lp_freq <= 96000) {
					tape_freq = lp_freq;
					tape_end  = lp_end;
					tape_pos  = lp_pos;
					s_tape_lp64 = 1;
				}
			}
			file_close(hdr2);
		}
	}
	if (!s_tape_lp64 && (tape_freq == 0 || tape_freq > 96000)) {
		tape_freq = 4800;
	}

	/* set tape */
	tape.cur_cmd = CMT_STOP;
	/* set protect bit */
	cmt_set_protect(tape_protect);
	/* sensor change check */
	cmt_set_sensor();

	tape.page=-1;
	printf("[cmt_set] tape loaded OK: freq=%lu end=%lu sensor=0x%02X\n",
		(unsigned long)tape_freq, (unsigned long)tape_end, (unsigned)tape.sensor);

	/* update display status */
	makecaption(1,NULL);
	drawinfo_cmt_cnt();
}

void cmt_set_protect(BYTE sw)
{
#if 1
#include	"resource.h"
#define	MFCHECK(a) ((a)?MF_CHECKED:MF_UNCHECKED)
extern HWND hWndMain;
	CheckMenuItem(GetMenu(hWndMain), IDM_CMTPROTECT, MFCHECK(sw));
#endif
	tape_protect = sw ? TAPE_PROTECT : 0;
	/* sensor change check */
	cmt_set_sensor();
}

/**********************************************************************
	テープの１ビット入出力
**********************************************************************/

/* read tape port : bit1 = read data */
BYTE cmt_read(void)
{
	BYTE data,bitmask;

	if(tape.cur_cmd == CMT_PLAY)
	{
		bitmask = 0x80>>(tape_pos&7);

		data =*cmt_data_ptr(tape_pos/8);
		if( data & bitmask)
			return 0x02;
	}
	return 0x00;
}

void cmt_write(BYTE data)
{
	if(tape.data != data)
	{
		adjust_rec_timming();
		tape.data = data;
	}
}

/**********************************************************************
	サブＣＰＵからデッキコントロールの為にコールされる関数
**********************************************************************/

void cmt_ctrl(BYTE cmnd,int isButton)
{
	/* sensor command */
	if( cmnd ==CMT_SENSOR)
	{
		cmt_set_sensor();
		x1_sub_cmtrx(tape.sensor | 0x80);
		return;
	}
	/* status command or , same as current command */
	if((cmnd == CMT_STATUS || tape.cur_cmd == cmnd)&&(tape.cur_cmd != CMT_EJECT))
	{
		x1_sub_cmtrx(tape.cur_cmd);
		return;
	}

	/* if REC mode , update write data */
	cmt_flush_buffer();

	/* check break and send break message */
	if(isButton)
	{
		switch(tape.cur_cmd)
		{
		case CMT_PLAY:
		case CMT_AFF:
		case CMT_AREW:
		case CMT_REC:
			x1_sub_cmtrx(CMT_BREAK);
		}
	}
	/* currect LED off */
	drawinfo_cmt_icon(tape.cur_cmd,0);
	/* change current command */
	tape.cur_cmd = cmnd;

#ifdef __EMSCRIPTEN__
	/* JS へコマンド変化をイベント通知 (ユーザー操作・テープ終端・APSS 全て対応) */
	EM_ASM({
		if (window.XMillennium && window.XMillennium.onCmtStateChange) {
			window.XMillennium.onCmtStateChange($0);
		}
	}, (int)cmnd);
#endif

	/* if no tape and no EJECT  , ignore command */
	if(tape_freq==0 && (tape.cur_cmd != CMT_EJECT) )
	{
		x1_sub_cmtrx(CMT_STOP);
		return;
	}

	/* if EJECT , remove tape file */
	if(cmnd == CMT_EJECT)
	{
		cmt_save_header();
		/* */
		tape.header.index = 0;
		tape_freq      = 0;
		tape_pos       = 0;
		tape_end       = 0;
		cmt_set_protect(0);
		makecaption(1,NULL);
		drawinfo_cmt_cnt();
	}

	/* ヘッドが降りてたら、一度ヘッドを上げてからコマンド実行 */
	cmt_head_up();
}

BYTE cmt_busy(void)
{
	return tape.busy;
}

/* ---- state save / load ---- */

int cmt_save_state(BYTE *buf, int maxlen) {
	int pos = 0;

	/* CMT_TABLE (includes buf[CMT_PAGE_SIZE]) */
	SS_WRITE(buf, pos, &tape, sizeof(tape));
	/* tape_filename */
	SS_WRITE(buf, pos, tape_filename, sizeof(tape_filename));
	/* s_tape_lp64 */
	SS_WRITE_I32(buf, pos, s_tape_lp64);

	/* motor_event */
	{
		BYTE active = (event_enabled(&motor_event) ? 1 : 0);
		SS_WRITE_U8(buf, pos, active);
		if (active) {
			EV_TIME tl = event_timeleft(&motor_event);
			SS_WRITE_U32(buf, pos, tl);
			SS_WRITE_U32(buf, pos, motor_event.interval);
			/* callback ID: 1=cmt_play_callback, 2=cmt_rec_callback, 3=cmt_ff_rew_callback, 4=cmt_apss_callback */
			BYTE cb_id = 0;
			if (motor_event.callback == cmt_play_callback) cb_id = 1;
			else if (motor_event.callback == cmt_rec_callback) cb_id = 2;
			else if (motor_event.callback == cmt_ff_rew_callback) cb_id = 3;
			else if (motor_event.callback == cmt_apss_callback) cb_id = 4;
			SS_WRITE_U8(buf, pos, cb_id);
			SS_WRITE_I32(buf, pos, motor_event.callback_param);
		}
	}

	/* head_event */
	{
		BYTE active = (event_enabled(&head_event) ? 1 : 0);
		SS_WRITE_U8(buf, pos, active);
		if (active) {
			EV_TIME tl = event_timeleft(&head_event);
			SS_WRITE_U32(buf, pos, tl);
			SS_WRITE_U32(buf, pos, head_event.interval);
			/* callback ID: 1=cmt_head_down_callback, 2=cmt_head_up_callback */
			BYTE cb_id = 0;
			if (head_event.callback == cmt_head_down_callback) cb_id = 1;
			else if (head_event.callback == cmt_head_up_callback) cb_id = 2;
			SS_WRITE_U8(buf, pos, cb_id);
			SS_WRITE_I32(buf, pos, head_event.callback_param);
		}
	}

	return pos;
}

int cmt_load_state(const BYTE *buf, int len) {
	int pos = 0;

	/* CMT_TABLE */
	SS_READ(buf, pos, &tape, sizeof(tape));
	/* tape_filename */
	SS_READ(buf, pos, tape_filename, sizeof(tape_filename));
	/* s_tape_lp64 */
	SS_READ_I32(buf, pos, s_tape_lp64);

	/* motor_event — read first, then apply */
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
		event_remove(&motor_event);
		if (active) {
			motor_event.interval = intv;
			motor_event.callback_param = cb_param;
			switch (cb_id) {
				case 1: motor_event.callback = cmt_play_callback; break;
				case 2: motor_event.callback = cmt_rec_callback; break;
				case 3: motor_event.callback = cmt_ff_rew_callback; break;
				case 4: motor_event.callback = cmt_apss_callback; break;
				default: motor_event.callback = NULL; break;
			}
			event_set(&motor_event, tl);
		}
	}

	/* head_event — read first, then apply */
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
		event_remove(&head_event);
		if (active) {
			head_event.interval = intv;
			head_event.callback_param = cb_param;
			switch (cb_id) {
				case 1: head_event.callback = cmt_head_down_callback; break;
				case 2: head_event.callback = cmt_head_up_callback; break;
				default: head_event.callback = NULL; break;
			}
			event_set(&head_event, tl);
		}
	}

	return 0;
}

#else //T_TUNE

#include	<windows.h>
#include	"x1.h"

static	BYTE	CMT_CMND = 0;
static	BYTE	CMT_STOP = 1;

void init_cmt(void) {

	CMT_CMND = 0;
	CMT_STOP = 1;
}

BYTE cmt_read(void) { return(0); }

void cmt_write(BYTE dat) { }

void cmt_ctrl(BYTE cmnd)
{
	switch(cmnd){
		case 0x00:				// EJECT

		case 0x01:				// STOP
			CMT_STOP = 1;
			break;
//		case 0x02:				// PLAY
//		case 0x03:				// FF
//		case 0x04:				// REW
//		case 0x05:				// APSS_FF
//		case 0x06:				// APSS_REW
//		case 0x0a:				// REC
//			break;
	}
	CMT_CMND = cmnd;
}

BYTE cmt_test(void) {

	if (CMT_STOP) {
		CMT_STOP = 0;
		return(0);
	}
	return(1);
}
#endif //T_TUNE

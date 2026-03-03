#include	<windows.h>
#include	<stdio.h>
#include	<string.h>
#include	"xmil.h"
#include	"x1.h"
#include	"x1_cmt.h"
#include	"x1_scpu.h"
#include	"x1_clndr.h"
#include	"input.h"
#include	"dosio.h"
#include	"keylog.h"

#if T_TUNE
#include	"x1_irq.h"
#include	"x1_cmt.h"
#endif

/***********************************************************************
	SUB CPU
***********************************************************************/

		SCPU_TABLE	scpu;

//							  e3 e4 e5 e6 e7 e8 e9 ea eb ec ed ee ef
const	BYTE	CMD_TBL[] = {  0, 1, 0, 0, 1, 0, 1, 0, 0, 3, 0, 3, 0};
#if !T_TUNE
const	BYTE	DAT_TBL[] = {  3, 0, 0, 2, 0, 1, 0, 1, 1, 0, 3, 0, 3};
#endif

#if T_TUNE
/* CMT breakable flags          EJ,ST,PL,FF,RE,AF,AR, -, -, -,RC, */
static const BYTE BRK_TLB[] = {  0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1 };
#define cmt_can_break() (BRK_TLB[scpu.Ex[0xa][0]])

//**********************************************************************
// 割り込みベクトルフェッチサイクル
static BYTE x1_sub_vector_r(BYTE device)
{
	Z80_clear_irq_line(device);
	/* IEO制御はないよん */
	return x1_sub_r(0x1900);
}
#endif

//**********************************************************************

void init_scpu(void) {

	ZeroMemory(&scpu, sizeof(scpu));
	scpu.OBF = 1;
#if T_TUNE
	Z80_setup_irq_handler(DEVICE_SUB,x1_sub_vector_r,NULL);
	/* キーデータの初期化 */
	scpu.Ex[0x06][0] = 0xff; /* ket off , CAPS=KANA=SHIFT = OFF */
#endif
}

#if T_TUNE
//**********************************************************************
// キーボード受信
/* 戻り値は、キー受信後のウェイト値 */
static int x1_sub_keyin(void)
{
	/* キーデータあり、キーが空いていればキーに書き込む */
	if (KEY_INT)
	{
		BYTE vec = scpu.Ex[4][0];
		BYTE qcnt_before = scpu.keyque_cnt;
		/* キーデータ読み込み */
		keyboard_inkey(xmilcfg.KEY_MODE, scpu.keyque[7] );
		keylog_printf("SCPU INKEY st=%02X key=%02X key_mode=%u",
			(unsigned int)scpu.keyque[7][0], (unsigned int)scpu.keyque[7][1],
			(unsigned int)xmilcfg.KEY_MODE);
		KEY_INT = 0;
		/* CMT制御キー , BREAKキーでCMT停止処理 */
		switch( scpu.keyque[7][1] )
		{
		case 0xc0:
		case 0xc1:
		case 0xc2:
		case 0xc3:
		case 0xc4:
		case 0xc5:
		case 0xc6:
/*		case 0xca: 実際のsubcpuはこれを受け付けるが、怖いので切っておく */
			/* テンキー＋有効キー時のみ動作 */
			if( (scpu.keyque[7][0] & 0xc0) != 0x00 )
				break;
			if(cmt_can_break())
			{
				/* 250ms間、ブレーク信号を出す */
				scpu.cmt_break_cnt = 250; /* 250ms */
			}
			/* cmt controll */
			scpu.Ex[0xa][0] = scpu.keyque[7][1]-0xc0;
			cmt_ctrl(scpu.Ex[0xa][0],0);
			break;
		case 0x03: /* BERAK */
			/* FFやREWは停止しない */
			if(cmt_can_break())
			{
				scpu.Ex[0xa][0] = CMT_STOP;
				cmt_ctrl(CMT_STOP,0);
			}
			break;
		}
		if( scpu.Ex[4][0] == 0x00)
		{	/*キー割り込み無し時 */
			/* 最後の１つだけ有効にする */
			scpu.keyque_cnt = 0;
		}
		else
		{	/* キー割り込み有り */
			/* キューの最後のデータが「キー入力無し」の時はそこに上書きする */
			if( (scpu.keyque_cnt>0) && (scpu.keyque[(scpu.keyque_rp+scpu.keyque_cnt-1)%7][0]&0x40) )
				scpu.keyque_cnt--;
		}
		/* キューの空きがあれば、追加する */
		if( scpu.keyque_cnt < 7)
		{
			scpu.keyque[(scpu.keyque_rp+scpu.keyque_cnt)%7][0] = scpu.keyque[7][0];
			scpu.keyque[(scpu.keyque_rp+scpu.keyque_cnt)%7][1] = scpu.keyque[7][1];
			if (scpu.keyque[7][1] == 0x0d) {
				keylog_printf("SCPU QUEUE PUSH st=%02X key=%02X qcnt=%u",
					(unsigned int)scpu.keyque[7][0], (unsigned int)scpu.keyque[7][1],
					(unsigned int)scpu.keyque_cnt);
			}
			scpu.keyque_cnt++;
		}
		keylog_printf("SCPU INKEY Q vec=%02X q_before=%u q_after=%u rp=%u",
			(unsigned int)vec, (unsigned int)qcnt_before,
			(unsigned int)scpu.keyque_cnt, (unsigned int)scpu.keyque_rp);
		/* 入力後、約25msはサブＣＰＵ動作をロックする */
/*		scpu.keyin_wait = 25 +1;*/
	}
	/* キー受信後のウェイト値を返す */
	return scpu.keyin_wait ? --scpu.keyin_wait : 0;
}

//**********************************************************************
// コマンド実行
/* 規定バイト数受信時後に発生 */
void x1_sub_cmd(void)
{
	/* データポインタのプリセット */
	if( scpu.MODE >= 0xe3 && scpu.MODE <= 0xef)
		scpu.datap = SCPUOFST(Ex[scpu.MODE - 0xe0][0]);
	scpu.DAT_CNT = 0;

	/* コマンドの実行 */
	switch(scpu.MODE)
	{
	case 0xe3: /* gamekey(MODE-B) read */
		if (xmilcfg.KEY_MODE) {
			scpu.Ex[0x03][0] =
			scpu.Ex[0x03][1] =
			scpu.Ex[0x03][2] = 0;
		}
		else {
			keyboard_e3(scpu.Ex[0x03]);
		}
		if (scpu.Ex[0x03][0] || scpu.Ex[0x03][1] || scpu.Ex[0x03][2]) {
			keylog_printf("SCPU CMD E3 d0=%02X d1=%02X d2=%02X key_mode=%u",
				(unsigned int)scpu.Ex[0x03][0], (unsigned int)scpu.Ex[0x03][1],
				(unsigned int)scpu.Ex[0x03][2], (unsigned int)xmilcfg.KEY_MODE);
		}
		scpu.DAT_CNT = 3;
		break;
	case 0xe4: /* irq vector */
		keylog_printf("SCPU CMD E4 (IRQ VECTOR/CLEAR)");
		scpu.keyque_cnt = 0; /* clear key que */
		Z80_clear_irq_line(DEVICE_SUB);
		/* 現在のキーを無効にする */
		scpu.Ex[0x06][0] |= 0x40; /* キー入力無し */
		scpu.Ex[0x06][1] = 0;     /* キーコードNULL */
		scpu.MODE = 0;
		scpu.DAT_CNT = 0;
		scpu.OBF = 1;
		break;
	case 0xe6: /* keydata read */
		/* キーキューにデータがあればリードして更新する */
		if( scpu.keyque_cnt )
		{
			scpu.Ex[0x06][0] = scpu.keyque[scpu.keyque_rp][0];
			scpu.Ex[0x06][1] = scpu.keyque[scpu.keyque_rp][1];
			scpu.keyque_rp = (scpu.keyque_rp+1) % 7;
			scpu.keyque_cnt--;
		}
		else
		{
			/* キューが空の場合はライブ状態を返す（非T_TUNE版と同じ挙動）
			 * ゲームがキュー消化後に再度0xe6でポーリングしても正しい状態を返せる */
			keyboard_inkey(xmilcfg.KEY_MODE, scpu.Ex[0x06]);
		}
		if ((scpu.Ex[0x06][0] != 0xff) || (scpu.Ex[0x06][1] != 0x00)) {
			keylog_printf("SCPU CMD E6 st=%02X key=%02X qcnt=%u",
				(unsigned int)scpu.Ex[0x06][0], (unsigned int)scpu.Ex[0x06][1],
				(unsigned int)scpu.keyque_cnt);
		}
		/* なぜかROLL UP,ROLL DOWN,HELP,COPY,REW,STOP,FFのキー */
		/* だけは、リピート時に、リピートビットがバタつく      */
		scpu.DAT_CNT = 2;
		break;
	case 0xe7: /* TV controll */
		scpu.Ex[0x08][0] = scpu.Ex[0x07][0];
		break;
	case 0xe8: /* TV controll read */
		scpu.DAT_CNT = 1;
		break;
	case 0xe9: /* CMT controll */
		if( scpu.Ex[0x9][0] <= CMT_REC )
		{
			scpu.Ex[0xa][0] = scpu.Ex[0x9][0];
			cmt_ctrl(scpu.Ex[0x9][0],0);
		}
		break;
	case 0xea: /* CMT status */
		cmt_ctrl(CMT_STATUS,0); /* to CZ8RL1, return for x1_sub_cmtrx() */
		scpu.DAT_CNT = 1;
		break;
	case 0xeb: /* CMT sencer */
		cmt_ctrl(CMT_SENSOR,0); /* to CZ8RL1, return for x1_sub_cmtrx() */
		scpu.DAT_CNT = 1;
		break;
	case 0xec: /* set calender */
		clndr_setdate(scpu.Ex[0x0c]);
		break;
	case 0xed: /* get calender */
		clndr_getdate(scpu.Ex[0x0d]);
		scpu.DAT_CNT = 3;
		break;
	case 0xee: /* set time */
		clndr_settime(scpu.Ex[0x0e]);
		break;
	case 0xef: /* get time */
		clndr_gettime(scpu.Ex[0x0f]);
		scpu.DAT_CNT = 3;
		break;
	case 0xd0: /* timer0 set */
	case 0xd1: /* timer1 set */
	case 0xd2: /* timer2 set */
	case 0xd3: /* timer3 set */
	case 0xd4: /* timer4 set */
	case 0xd5: /* timer5 set */
	case 0xd6: /* timer6 set */
	case 0xd7: /* timer7 set */
		break;
	case 0xd8: /* timer0 set */
	case 0xd9: /* timer1 set */
	case 0xda: /* timer2 set */
	case 0xdb: /* timer3 set */
	case 0xdc: /* timer4 set */
	case 0xdd: /* timer5 set */
	case 0xde: /* timer6 set */
	case 0xdf: /* timer7 set */
		scpu.DAT_CNT = 6;
		scpu.datap = SCPUOFST(Dx[scpu.MODE - 0xd0][0]);
		break;
	}
	/* コマンド受付終了 */
	scpu.MODE = 0x00;
}

#endif /* T_TUNE */
//**********************************************************************

// キーボード割り込み
short x1_sub_int(void) {								// 990922
#if T_TUNE
	BYTE keyin_wait;
	BYTE busy;
	/* CMTブレーク時の、ブレーク信号出力パルスのカウントダウン */
	if( scpu.cmt_break_cnt )
		scpu.cmt_break_cnt--;

	/**************************************************************
		常時並列処理出来るのはたぶんこの２つだけでどっちかを行って
		いるときは、他の処理はされない
		（もしかしたらキーデータの受信＋OBUFへの送信はありかも）
		１．キーデータの受信
		２．APSS実行、テープの回転開始／停止
	***************************************************************/
	keyin_wait = (BYTE)x1_sub_keyin();
	busy = cmt_busy();
	if( keyin_wait || busy )
	{
		if (KEY_INT || scpu.keyque_cnt || busy) {
			keylog_printf("SCPU HOLD KEY keyin_wait=%u cmt_busy=%u qcnt=%u vec=%02X dat=%u cmd=%u ibf=%u obf=%u",
				(unsigned int)keyin_wait, (unsigned int)busy,
				(unsigned int)scpu.keyque_cnt, (unsigned int)scpu.Ex[4][0],
				(unsigned int)scpu.DAT_CNT, (unsigned int)scpu.CMD_CNT,
				(unsigned int)scpu.IBF, (unsigned int)scpu.OBF);
		}
		return(1);
	}

	/* ステータス送信中なら、メインＣＰＵへリードデータの送信 */
	if( scpu.DAT_CNT)
	{
		if(scpu.OBF)
		{
			scpu.OBUF = *((BYTE *)(&scpu) + scpu.datap);
			scpu.OBF = 0;
			scpu.datap++;
			scpu.DAT_CNT--;
		}
		else if (scpu.keyque_cnt || KEY_INT) {
			keylog_printf("SCPU HOLD DAT dat=%u mode=%02X qcnt=%u ibf=%u obf=%u",
				(unsigned int)scpu.DAT_CNT, (unsigned int)scpu.MODE,
				(unsigned int)scpu.keyque_cnt, (unsigned int)scpu.IBF,
				(unsigned int)scpu.OBF);
		}
		return(1);
	}

	/* コマンド受付中なら、メインＣＰＵからライトデータを受信 */
	if( scpu.CMD_CNT )
	{
		if( scpu.IBF)
		{
			*((BYTE *)(&scpu) + scpu.datap) = scpu.IBUF;
			scpu.datap++;
			scpu.IBF = 0;
			if (--scpu.CMD_CNT == 0)
				x1_sub_cmd();
		}
		if (scpu.keyque_cnt || KEY_INT) {
			keylog_printf("SCPU HOLD CMD cmd=%u mode=%02X qcnt=%u ibf=%u obf=%u",
				(unsigned int)scpu.CMD_CNT, (unsigned int)scpu.MODE,
				(unsigned int)scpu.keyque_cnt, (unsigned int)scpu.IBF,
				(unsigned int)scpu.OBF);
		}
		return(1);
	}

	/* なにもしていなければ、新規コマンドを受付 */
	if (scpu.IBF)
	{
		BYTE mode_before;
		mode_before = scpu.IBUF;
		scpu.MODE = scpu.IBUF;
		scpu.IBF = 0;
		scpu.CMD_CNT = 0;
		if (scpu.MODE >= 0xd0 && scpu.MODE <= 0xd7) {
			scpu.CMD_CNT = 6;
			scpu.datap = SCPUOFST(Dx[scpu.MODE - 0xd0][0]);
		}
		else if (scpu.MODE >= 0xe3 && scpu.MODE <= 0xef) {
			scpu.CMD_CNT = CMD_TBL[scpu.MODE - 0xe3];
			scpu.datap = SCPUOFST(Ex[scpu.MODE - 0xe0][0]);
		}
		/* ０バイトコマンドの実行 */
		if(scpu.CMD_CNT==0)
			x1_sub_cmd();
		if (scpu.keyque_cnt || KEY_INT || (mode_before == 0xe4) || (mode_before == 0xe6)) {
			keylog_printf("SCPU NEW CMD mode=%02X cmd=%u dat=%u qcnt=%u vec=%02X",
				(unsigned int)mode_before, (unsigned int)scpu.CMD_CNT,
				(unsigned int)scpu.DAT_CNT, (unsigned int)scpu.keyque_cnt,
				(unsigned int)scpu.Ex[4][0]);
		}
		return (1);
	}

	/* キー入力バッファ有、割り込みベクタ有なら、割り込み要求！ */
	if (scpu.keyque_cnt && scpu.Ex[4][0])
	{
/*!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
	割り込みベクタはZ80の割り込みベクタフェッチサイクルで、
	OBUF(I/O 1900H)から割り込みベクタが読みとられるしくみなのだ！
	だから、[割り込みベクタ]送信後に、２バイトのキーデータが出力される
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!*/
		scpu.OBUF = scpu.Ex[4][0]; /* 割り込みベクタ */
		scpu.OBF = 0;
		/* キーキューからリード */
		scpu.MODE = 0xe6;
		x1_sub_cmd();
		/* 割り込み発生要求！ */
		Z80_set_irq_line(DEVICE_SUB);
		keylog_printf("SCPU IRQ RAISE vec=%02X qcnt=%u mode=%02X",
			(unsigned int)scpu.Ex[4][0], (unsigned int)scpu.keyque_cnt,
			(unsigned int)scpu.MODE);
		return 0;
	}
	if (KEY_INT || scpu.keyque_cnt) {
		keylog_printf("SCPU IRQ SKIP key_int=%u qcnt=%u vec=%02X cmd=%u dat=%u ibf=%u obf=%u",
			(unsigned int)KEY_INT, (unsigned int)scpu.keyque_cnt,
			(unsigned int)scpu.Ex[4][0], (unsigned int)scpu.CMD_CNT,
			(unsigned int)scpu.DAT_CNT, (unsigned int)scpu.IBF, (unsigned int)scpu.OBF);
	}
	return (1);
#else /* T_TUNE */

#if 1
	if ((!KEY_INT) || (scpu.CMD_CNT) || (scpu.DAT_CNT) ||
		(!Z80_Able_interrupt())) {						// 割り込めなかったら
		return(1);										// また来週〜
	}
#else
	if ((!KEY_INT) || (scpu.CMD_CNT) || (scpu.DAT_CNT)) {
		return(1);
	}
#endif
	KEY_INT = 0;
	if (!scpu.Ex[4][0]) {				// 割り込み不要だったら捨てる
		return(1);
	}
	if (KEY_HIT) {						// キーが押された場合
		keyboard_inkey(xmilcfg.KEY_MODE, scpu.Ex[0x06]);
		if (!scpu.Ex[0x06][1]) {		// 無効なキーだったら捨てる
			return(1);
		}
		scpu.INT_SW = 1;
	}
	else {
		if (!scpu.INT_SW) {				// 何も押されてなかったら割り込まない
			return(1);
		}
		scpu.INT_SW = 0;
		keyboard_inkey(xmilcfg.KEY_MODE, scpu.Ex[0x06]);
	}

//	x1_sub_w(0x1900, 0xe6);				// Key読み取りでステータスが変わって
										// しまうようになった為....
	scpu.MODE = 0xe6;
	scpu.CMD_CNT = 0;
	scpu.DAT_CNT = 2;
	scpu.datap = SCPUOFST(Ex[0xe6 - 0xe0][0]);
	scpu.OBF = 0;
	scpu.IBF = 1;

	Z80_Cause_Interrupt2(scpu.Ex[4][0]);
	return(0);
#endif /* T_TUNE */
}

//**********************************************************************

X1_IOW x1_sub_w(WORD port, BYTE value) {
#if T_TUNE
	scpu.IBUF = value;
	scpu.IBF = 1;
#else /* T_TUNE */
	if (scpu.IBF) {
		return;
	}
	if (!scpu.CMD_CNT) {
		scpu.MODE = value;
		scpu.CMD_CNT = 0;
		scpu.DAT_CNT = 0;
		if (value >= 0xd0 && value <= 0xd7) {
			scpu.CMD_CNT = 6;
			scpu.DAT_CNT = 0;
		}
		else if (value >= 0xd8 && value <= 0xdf) {
			scpu.CMD_CNT = 0;
			scpu.DAT_CNT = 6;
		}
		else if (value >= 0xe3 && value <= 0xef) {
			scpu.CMD_CNT = CMD_TBL[value - 0xe3];
			scpu.DAT_CNT = DAT_TBL[value - 0xe3];
		}
		if (value < 0xe0) {
			scpu.datap = SCPUOFST(Dx[value - 0xd0][0]);
		}
		else {
			scpu.datap = SCPUOFST(Ex[value - 0xe0][0]);
		}
		switch(scpu.MODE) {							// 990225 puni
			case 0xe3:
				if (xmilcfg.KEY_MODE) {
					scpu.Ex[0x03][0] = 0;
					scpu.Ex[0x03][1] = 0;
					scpu.Ex[0x03][2] = 0;
				}
				else {
					keyboard_e3(scpu.Ex[0x03]);
				}
				break;

			case 0xe6:
				keyboard_inkey(xmilcfg.KEY_MODE, scpu.Ex[0x06]);
				break;

			case 0xed:
				clndr_getdate(scpu.Ex[0x0d]);
				break;

			case 0xef:
				clndr_gettime(scpu.Ex[0x0f]);
				break;
		}
	}
	else {
		*((BYTE *)(&scpu) + scpu.datap) = value;
		scpu.datap++;
		if (--scpu.CMD_CNT == 0) {
			switch(scpu.MODE) {
				case 0xe9:
					cmt_ctrl(scpu.Ex[0x9][0]);
					break;
				case 0xec:
					clndr_setdate(scpu.Ex[0x0c]);
					break;
				case 0xee:
					clndr_settime(scpu.Ex[0x0e]);
					break;
			}
		}
	}
	scpu.OBF = (BYTE)(scpu.DAT_CNT?0:1);
	scpu.IBF = (BYTE)(scpu.DAT_CNT?1:0);
#endif /* T_TUNE */
}


X1_IOR x1_sub_r(WORD port) {
#if T_TUNE
	scpu.OBF = 1;
	return scpu.OBUF;
#else /* T_TUNE */
	BYTE	ret;
#if 1										// D-SIDE で通るように…
	if (!scpu.DAT_CNT) {					// ポインタは変らない？
		scpu.DAT_CNT++;

		switch(scpu.MODE) {						// 990225 puni
			case 0xe3:
				if (xmilcfg.KEY_MODE) {
					scpu.Ex[0x03][0] = 0;
					scpu.Ex[0x03][1] = 0;
					scpu.Ex[0x03][2] = 0;
				}
				else {
					keyboard_e3(scpu.Ex[0x03]);
				}
				break;

			case 0xe6:
				keyboard_inkey(xmilcfg.KEY_MODE, scpu.Ex[0x06]);
				break;

			case 0xed:
				clndr_getdate(scpu.Ex[0x0d]);
				break;

			case 0xef:
				clndr_gettime(scpu.Ex[0x0f]);
				break;
		}
	}

#else
	if (scpu.OBF) {
		return(0);
	}
#endif
	ret = 0;
	switch(scpu.MODE) {
		case 0xd8:
		case 0xd9:
		case 0xda:
		case 0xdb:
		case 0xdc:
		case 0xdd:
		case 0xde:
		case 0xdf:
			ret = scpu.Dx[scpu.MODE - 0xd8][6 - scpu.DAT_CNT];
			break;
		case 0xe3:
			ret = scpu.Ex[0x03][3 - scpu.DAT_CNT];
			if (ret != 0x00) {
				keylog_printf("SCPU R E3 idx=%u ret=%02X datcnt=%u",
					(unsigned int)(3 - scpu.DAT_CNT), (unsigned int)ret,
					(unsigned int)scpu.DAT_CNT);
			}
			break;
		case 0xe6:
#if T_TUNE
//				X1_clear_ieo_line(DEVICE_SUB);
#endif
			ret = scpu.Ex[0x06][2 - scpu.DAT_CNT];
			if ((2 - scpu.DAT_CNT) == 1 && ret != 0x00) {
				keylog_printf("SCPU R E6 st=%02X key=%02X datcnt=%u qcnt=%u",
					(unsigned int)scpu.Ex[0x06][0], (unsigned int)scpu.Ex[0x06][1],
					(unsigned int)scpu.DAT_CNT, (unsigned int)scpu.keyque_cnt);
			}
			break;
		case 0xe8:
			ret = scpu.Ex[0x07][0];
			break;
		case 0xea:
			ret = cmt_ctrl_stat();
			break;
		case 0xeb:
			ret = cmt_tape_stat();
			break;
		case 0xed:
			ret = scpu.Ex[0x0d][3 - scpu.DAT_CNT];
			break;
		case 0xef:
			ret = scpu.Ex[0x0f][3 - scpu.DAT_CNT];
			break;
	}
	scpu.DAT_CNT--;
	scpu.OBF = (BYTE)(scpu.DAT_CNT?0:1);
	scpu.IBF = (BYTE)(scpu.DAT_CNT?1:0);
	return(ret);
#endif /* T_TUNE */
}

#if T_TUNE
/* CZ8RL1 -> X1 転送データ */
void x1_sub_cmtrx(BYTE data)
{
	BYTE sel;

	/* カセットのボタン、テープエンドによるブレーク通知 */
	if(data==0xff)
	{
		/* 250ms間、ブレーク信号を出す */
		scpu.cmt_break_cnt = 250; /* 250ms */
		return;
	}

	/* b7=0 : CMTの状態です、CMTコマンド発行時にも受信します */
	sel = data/128;
	/* b6..0: CMT状態又はセンサーの値 */
	data &= 0x7f;
	/* ステータスの登録 */
	scpu.Ex[0x0a + sel][0] = data & 0x7f;
}

/* BREAK ビット検出 */
BYTE x1_sub_getbreak(void)
{
	/* BREAK KEY */
	if( scpu.keyque[7][1] == 0x03)
		return 0x00; /* BREAK KEY */
	/* CMT BREAK */
	if( scpu.cmt_break_cnt > 0)
		return 0x00; /* BREAK KEY */

	/* NO BREAK */
	return 0x01;
}
#endif

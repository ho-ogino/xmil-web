#if T_TUNE
#include	<windows.h>
#include	<stdio.h>
#include	"x1.h"
#include	"xmil.h"
#include	"x1_dma.h"
#include	"x1_sasi.h"
#include	"dosio.h"

#ifdef __EMSCRIPTEN__
#include	<emscripten.h>
#endif

/***************************************************************
	SASI I/F & SASI HDD

	SASI HDD部については．．．
	-X1から使われるコマンドとシーケンスのみサポート
	-フォーマットとかは無視！
	-SASIのデータ線のハンドシェークはなく、データ通信時は、
	  REQは出っぱなしで、フェーズ変化時もディレイ無しで、
	  即時応答する。
***************************************************************/

/* ファイル名 */
#define SASI_FILENAME "SASI%d_%d.HDD"

/* CLIからのパスオーバーライド（main.cppで設定、未設定時は空文字列） */
/* インデックス: SASI ID (0 or 1)、LUN=0 のみ対象 */
char g_sasi_path[2][256] = {"", ""};

SASI_TABLE sasi;

/**************************************************************/
/* SASI HDD emulation */

/* SASI phase */
enum {
SASI_BUSFREE,	/* Bus free */
SASI_SELECTION,	/* Selection (taget not answer) */
SASI_SELECTED,	/* Selection (taget answerd) */
SASI_COMMAND,	/* Command out */
SASI_DATAIN,	/* Data in */
SASI_DATAOUT,	/* Data out */
SASI_COMPLETE,	/* Completion satus */
SASI_MESSAGE	/* Message Byte */
};

/* message code */
#define SASI_MSG_OK  0x00
#define SASI_MSG_ERR 0xff /* SASI規格不明、X1では0以外でエラー */

void init_sasi(void)
{
	ZeroMemory(&sasi, sizeof(SASI_TABLE));
}

/* １セクター分の書き込み */
/* ポインターは次のセクタ位置にあることに注意! */
static int sasi_write_block(void)
{
	FILEH hdr;

	if ((hdr = file_open_c(sasi.filename)) == (FILEH)-1)
		return -1;

	/* file size check */
	if( file_length(hdr) < (sasi.addr) )
	{
		file_close(hdr);
		return -1;
	}

	if ((file_seek(hdr, sasi.addr-256, FSEEK_SET) != sasi.addr-256) ||
		(file_write(hdr, sasi.buf, 256) != 256))
	{
		file_close(hdr);
		return -1;
	}

	if (file_close(hdr))
		return -1;

#ifdef __EMSCRIPTEN__
	EM_ASM({
		if (window.XMillennium && window.XMillennium.onHddWrite) {
			window.XMillennium.onHddWrite($0, $1, 256);
		}
	}, (int)sasi.id, (int)(sasi.addr - 256));
#endif

	return 0;
}

/* １セクター分の読み込み */
static int sasi_read_block(void)
{
	FILEH hdr;

	if ((hdr = file_open_c(sasi.filename)) == (FILEH)-1)
		return -1;

	/* file size check */
	if( file_length(hdr) < (sasi.addr+256) )
	{
		file_close(hdr);
		return -1;
	}

	if ((file_seek(hdr, sasi.addr, FSEEK_SET) != sasi.addr) ||
		(file_read(hdr, sasi.buf, 256) != 256))
	{
		file_close(hdr);
		return -1;
	}

	if (file_close(hdr))
		return -1;

	return 0;
}

/* ファイル名の作成 */
static void sasi_make_filename(BYTE lun)
{
	/* LUN=0 かつ CLIオーバーライドが設定されていればそちらを使用 */
	if (lun == 0 && g_sasi_path[sasi.id][0] != '\0') {
		strncpy(sasi.filename, g_sasi_path[sasi.id], sizeof(sasi.filename) - 1);
		sasi.filename[sizeof(sasi.filename) - 1] = '\0';
		return;
	}
	/* デフォルト: SASI0_0.HDD 等の固定名 */
	sprintf(sasi.filename, SASI_FILENAME, sasi.id, lun);
}


/* SASIコマンド実行部 */
static void sasi_cmd(void)
{
	BYTE lun; /* logical unit number */

	/* コマンド解析 */
	if( sasi.len == 6)
	{ /* 6バイトコマンド */
		/* Logical Unit Number : +01.b7..b5 */
		lun  = sasi.cmd[1]>>5;
		/* sector address21    : +01.b4..b0 . +02 , +03 */
		sasi.addr = (((DWORD)sasi.cmd[1]&0x1f)*0x100000)
					+ (DWORD)sasi.cmd[2]*0x100 + sasi.cmd[3];
		/* sector length       : +04 */
		sasi.len  = (DWORD)sasi.cmd[4];
		if( sasi.len == 0)
			sasi.len  = 0x100;
#if 0
		/* message ?           : +05 */
		sasi.msg  = sasi.cmd[5];
#endif
	}
	else if( sasi.len == 10)
	{ /* 10バイトコマンド */
	}

	/* build filename */
	sasi_make_filename(lun);

	/* convert sector address to offset */
	sasi.addr *= 0x100;

	/* エラー＋COMPLETEフェーズ行きをデフォールトとする */
	sasi.msg = SASI_MSG_ERR;
	sasi.phase = SASI_COMPLETE;

	/* 個別処理 */
	switch(sasi.cmd[0])
	{
	case 0x08: /* READ  */
		if( !sasi_read_block() )
			sasi.phase = SASI_DATAIN; /* fast bufer read OK */
		break;
	case 0x0A: /* WRITE */
		if( !sasi_read_block() )
			sasi.phase = SASI_DATAOUT; /* fast buffer seek OK */
		break;
	case 0x0b: /* SEEK (FORMAT時のverifyで使われる) */
		/* 最初のセクター */
		if( sasi_read_block() )
			break; /* error */
		sasi.addr += (sasi.len-1)*0x100;
		/* 最後のセクター */
		if( sasi_read_block() )
			break; /* error */
		/* OK */
		sasi.msg = SASI_MSG_OK; /* finish! */
		break;
	case 0x06: /* FORMAT? */
		ZeroMemory(sasi.buf, 256);
		sasi.len *= 11; /* なぜ３で３３セクタなの？ */
		while(sasi.len)
		{
			sasi.addr += 0x100;
			if( sasi_write_block() )
				break; /* error */
			/* next sector */
			sasi.len--;
		}
		sasi.msg = SASI_MSG_OK; /* finish! */
		break;
	case 0x01: /* rezero unit? */
	case 0xc2: /* set capacity ?   */
		sasi.msg = SASI_MSG_OK; /* finish! */
		break;
	}

	/* メッセージがOKになってたら、COMPLETEフェーズへ */
	if( sasi.msg = SASI_MSG_OK)
		sasi.phase = SASI_COMPLETE;
}

/* HOST->TARGET バイトデータ転送、フェーズ毎に動作が異なる */
void sasi_data_w(BYTE value)
{
	switch(sasi.phase)
	{
	case SASI_COMMAND:
		sasi.cmd[sasi.addr++] = value;
		if( sasi.len == 0)
		{	/* command length check */
			switch( sasi.cmd[0] )
			{
			case 0x01:
			case 0x06: /* FORMAT? */
			case 0x08: /* READ  */
			case 0x0a: /* WRITE */
			case 0x0b: /* SEEK  */
				sasi.len = 6;
				break;
			case 0xc2: /* ?? capacity ?? */
				/* 0xc2,0,0,0,0,0x0b,0x3c,0x00,0x03,0x01,0x32,0x80,0,0,0 */
				sasi.len = 15;
				break;
			default:
{
extern HWND hWndMain;
char message[256];
sprintf(message,"SASIコマンド'%02X'は未対応！",sasi.cmd[0]);
MessageBox(hWndMain,message,"報告して下さい",MB_YESNO | MB_ICONQUESTION | MB_TASKMODAL );
}
				sasi.len = 1;
			}
		}
		/* コマンド受信終了？ */
		if( sasi.addr == sasi.len)
			sasi_cmd();
		break;
	case SASI_DATAOUT:
		sasi.buf[sasi.addr&0xff] = value;
		if( (++sasi.addr&0xff) == 0)
		{
			if( sasi_write_block() )
			{	/* error */
				sasi.phase = SASI_COMPLETE;
				break;
			}
			if( --sasi.len == 0)
			{	/* finish */
				sasi.msg = SASI_MSG_OK; /* finish! */
				sasi.phase = SASI_COMPLETE;
			}
		}
		break;
	}
}

/* HOST<-TARGET バイトデータ転送、フェーズ毎に動作が異なる */
BYTE sasi_data_r(void)
{
	BYTE ret = 0xff;

	switch(sasi.phase)
	{
	case SASI_DATAIN:
		ret = sasi.buf[sasi.addr&0xff];
		if( (++sasi.addr&0xff) == 0)
		{
			if( --sasi.len >0)
			{
				if( sasi_read_block() )
				{	/* error */
					sasi.phase = SASI_COMPLETE;
					break;
				}
			}
			else
			{	/* finish */
				sasi.msg = SASI_MSG_OK; /* finish! */
				sasi.phase = SASI_COMPLETE;
			}
		}
		break;
	case SASI_COMPLETE:
		ret = 0x00;
		sasi.phase = SASI_MESSAGE;
		break;
	case SASI_MESSAGE:
		ret = sasi.msg;
		sasi.phase = SASI_BUSFREE;
		break;
	}
	return ret;
}

/* セレクション開始 */
static void sasi_set_selection(BYTE dbus)
{
	BYTE lun;

	if( sasi.phase != SASI_BUSFREE)
		return;

	sasi.phase = SASI_SELECTION;
	for(sasi.id=0 ; sasi.id <= 1 ; sasi.id++)
	{
		if( (dbus & (1<<sasi.id)) )
		{	/* try to select */
			for(lun=0;lun<=1;lun++)
			{
				FILEH hdr;
				/* 	いづれかのLUNファイルが存在するなら、セレクション応答 */
				sasi_make_filename(lun);
				if ((hdr = file_open_c(sasi.filename)) != (FILEH)-1)
				{
					file_close(hdr);
					sasi.addr = 0;
					sasi.len  = 0;
					sasi.phase = SASI_SELECTED;
					break;
				}
			}
			/* IDビットを見つけたときは、そこで終了 */
			return;
		}
	}
	/* ファイルがないか、IDの選択がないときは無応答 */
}

/* セレクション終了 */
static void sasi_reset_selection(void)
{
	/* セレクション無応答時はバスフリー */
	if( sasi.phase == SASI_SELECTION)
		sasi.phase = SASI_BUSFREE;

	/* セレクション応答時はコマンドフェーズ */
	if( sasi.phase == SASI_SELECTED)
		sasi.phase = SASI_COMMAND;
}

/* バスリセット */
static void sasi_reset(void)
{
	sasi.phase = SASI_BUSFREE;
}

/**************************************************************/
/* X1 SASI I/F */

/* X1のI/Fにおける、SASI制御線リードポートのビット割当て */
#define X1_SASI_REQ 0x01
#define X1_SASI_BSY 0x02
#define X1_SASI_IXO 0x04
#define X1_SASI_CXD 0x08
#define X1_SASI_MSG 0x10

/* SASIフェーズから制御線ポート値に変換するテーブル */
static BYTE x1_sasi_statis[8] = 
{
	0															,/*Bus Free  */
	0															,/*Selection */
	0			|X1_SASI_BSY									,/*Selected  */
	X1_SASI_REQ	|X1_SASI_BSY			|X1_SASI_CXD			,/*Command   */
	X1_SASI_REQ	|X1_SASI_BSY|X1_SASI_IXO						,/*Data In   */
	X1_SASI_REQ	|X1_SASI_BSY									,/*Data Out  */
	X1_SASI_REQ	|X1_SASI_BSY|X1_SASI_IXO|X1_SASI_CXD			,/*Completion*/
	X1_SASI_REQ	|X1_SASI_BSY|X1_SASI_IXO|X1_SASI_CXD|X1_SASI_MSG,/*Message   */
};

X1_IOW x1_sasi_w(WORD port, BYTE value)
{
	switch(port&3)
	{
	case 0: /* data out with handshake */
		sasi_data_w(value);
		break;
	case 1: /* deassert selection */
		sasi_reset_selection();
		break;
	case 2: /* reset bus */
		sasi_reset();
		break;
	case 3: /* assert selection */
		sasi_set_selection(value);
		break;
	}
}

X1_IOR x1_sasi_r(WORD port)
{
	BYTE sasi_sts = x1_sasi_statis[sasi.phase];

	/* REQが有効なフェーズでは、常にDMACはREADY */
	dma.DMA_REDY = (sasi_sts&X1_SASI_REQ)? 0 : 8;

	switch(port&3)
	{
	case 0: /* data in with handshake */
		return sasi_data_r();
	case 1: /* sasi control signals */
		return sasi_sts;
	}
	return 0xff;
}
#endif


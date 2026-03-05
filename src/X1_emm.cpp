#if T_TUNE
/*
	EMM / ROM basic board
*/

#include	<windows.h>
#include	<stdio.h>
#include	"x1.h"
#include	"xmil.h"
#include	"X1_EMM.H"
#include	"dosio.h"

#ifdef __EMSCRIPTEN__
#include	<emscripten.h>
#endif

#define EMM_FILENAME "EMM%d.MEM"
#define ROM_FILENAME "ROMBASIC.ROM"

EMM_TABLE emm;

/**********************************************************************
	ファイルハンドルキャッシュ
**********************************************************************/

void emm_close_handle(void)
{
	if (emm.cached_hdr != NULL && emm.cached_hdr != (FILEH)-1) {
		file_close(emm.cached_hdr);
	}
	emm.cached_hdr = (FILEH)-1;
	emm.cached_filename[0] = '\0';
}

static FILEH emm_get_handle(void)
{
	if (emm.cached_hdr != (FILEH)-1
		&& strcmp(emm.cached_filename, emm.filename) == 0) {
		return emm.cached_hdr;
	}
	emm_close_handle();
	emm.cached_hdr = file_open_c(emm.filename);
	if (emm.cached_hdr != (FILEH)-1) {
		strcpy(emm.cached_filename, emm.filename);
	}
	return emm.cached_hdr;
}

/**********************************************************************
	ファイルの読み書き
**********************************************************************/

/* 一時バッファを破棄、更新があればファイルにセーブ */
static int emm_flush_buffer(void)
{
	FILEH hdr;
	DWORD cur_ptr;
	int ret = 0;

	if( emm.sel == 0xff || !emm.dirty_buf )
		return 0;

	int saved_sel = emm.sel;
	WORD saved_buf_size = emm.buf_size;

	hdr = emm_get_handle();
	if (hdr == (FILEH)-1) {
		return(-1);
	}

	cur_ptr = emm.page * 256;
	emm.sel = 0xff; /* 空きマーク */

	if ((file_seek(hdr, cur_ptr, FSEEK_SET) != cur_ptr) ||
		(file_write(hdr, emm.buf, emm.buf_size) != emm.buf_size)) {
		emm_close_handle();
		ret = -1;
	}
	if (ret == 0) {
		emm.dirty_buf = 0;
#ifdef __EMSCRIPTEN__
		EM_ASM({
			if (window.XMillennium && window.XMillennium.onEmmPageWrite) {
				window.XMillennium.onEmmPageWrite($0, $1, $2);
			}
		}, saved_sel, (int)cur_ptr, (int)saved_buf_size);
#endif
	}
	return(ret);
}

/* get pointer of tape data */
static BYTE *x1_emm_get_ptr(int sel)
{
	static BYTE dummy_data;
	FILEH hdr;
	DWORD cur_ptr;
	DWORD page;
	DWORD filesize;

	dummy_data = 0xff;
	/* check file open error status */
	if( emm.addr[sel] & 0x80000000)
	{
		return(&dummy_data);
	}

	/* same page check */
	page = emm.addr[sel] / 256;
	if( (emm.sel == sel) && (emm.page == page))
		return &(emm.buf[emm.addr[sel]&0xff]);

	/* flush current buffer */
	emm_flush_buffer();

	/* read new buffer */
	if( sel == MAX_EMM)
		sprintf(emm.filename,ROM_FILENAME);
	else
		sprintf(emm.filename,EMM_FILENAME,sel);

	hdr = emm_get_handle();
	if (hdr == (FILEH)-1)
	{
		emm.addr[sel] |= 0x80000000;
		return(&dummy_data);
	}

	/* file size over check */
	filesize =file_length(hdr);
	if( emm.addr[sel] >= filesize)
	{
		return &dummy_data;
	}

	cur_ptr = page * 256;
	if(cur_ptr+256 > filesize )
		emm.buf_size = (WORD)(filesize - cur_ptr);
	else
		emm.buf_size = 256;

	if ((file_seek(hdr, cur_ptr, FSEEK_SET) != cur_ptr) ||
		(file_read(hdr, emm.buf, emm.buf_size) != emm.buf_size))
	{
		emm_close_handle();
		return &dummy_data;
	}

	emm.page = page;
	emm.sel = sel;
	return &(emm.buf[emm.addr[sel]&0xff]);
}

/* initialize */
void init_emm(void)
{
	emm_close_handle();
	ZeroMemory(&emm, sizeof(EMM_TABLE));
	emm.sel = 0xff;
	emm.cached_hdr = (FILEH)-1;
}

/* EMM port write */
X1_IOW x1_emm_w(WORD port, BYTE value)
{
	int bd = (port/4)%64;
	if( bd < MAX_EMM )
	{
		switch(port&3)
		{
		case 0:
			emm.addr[bd] &= 0x80ffff00;
			emm.addr[bd] |= value;
			break;
		case 1:
			emm.addr[bd] &= 0x80ff00ff;
			emm.addr[bd] |= ((unsigned long)value)*0x100;
			break;
		case 2:
			emm.addr[bd] &= 0x8000ffff;
			emm.addr[bd] |= ((unsigned long)value)*0x10000;
			break;
		case 3:
			*x1_emm_get_ptr(bd) = value;
			emm.dirty_buf = 1;
			emm.dirty_slots |= (1 << bd);
			/* １レコード書き込み終了時にファイルを更新 */
			if( (++emm.addr[bd] & 0xff) == 0x00)
				emm_flush_buffer();
			break;
		}
	}
}

X1_IOR x1_emm_r(WORD port)
{
	int bd = (port/4)%64;
	BYTE ret;

	if( (bd < MAX_EMM) && (port&3 == 3) )
	{
		ret = *x1_emm_get_ptr(bd);
		emm.addr[bd]++;
		return ret;
	}
	return 0xff;
}

X1_IOW x1_rom_w(WORD port, BYTE value)
{
	switch(port&3)
	{
	case 0:
		emm.addr[MAX_EMM] &= 0x8000ffff;
		emm.addr[MAX_EMM] |= ((unsigned long)value)*0x10000;
		break;
	case 1:
		emm.addr[MAX_EMM] &= 0x80ff00ff;
		emm.addr[MAX_EMM] |= ((unsigned long)value)*0x100;
		break;
	case 2:
		emm.addr[MAX_EMM] &= 0x80ffff00;
		emm.addr[MAX_EMM] |= value;
		break;
	}
}

X1_IOR x1_rom_r(WORD port)
{
	if(port&3 == 3)
		return *x1_emm_get_ptr(MAX_EMM);
	return 0xff;
}
void emm_flush_all_buffers(void)
{
	emm_flush_buffer();
}

void emm_reset_slot(int sel)
{
	if (sel < 0 || sel >= MAX_EMM) return;
	/* dirty バッファが対象スロットなら先にフラッシュ */
	if (emm.sel == sel) emm_flush_buffer();
	/* エラーフラグクリア */
	emm.addr[sel] &= 0x00FFFFFF;
	/* ページキャッシュ無効化 */
	if (emm.sel == sel) emm.sel = 0xff;
	/* キャッシュがこのスロットのファイルなら閉じる */
	char fname[16];
	sprintf(fname, EMM_FILENAME, sel);
	if (emm.cached_hdr != (FILEH)-1
		&& strcmp(emm.cached_filename, fname) == 0) {
		emm_close_handle();
	}
}

WORD emm_take_dirty_slots(void)
{
	WORD mask = emm.dirty_slots;
	emm.dirty_slots = 0;
	return mask;
}

#endif /* T_TUNE */

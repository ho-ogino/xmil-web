#include	<windows.h>
#include	<stdio.h>

#include	"x1.h"
#include	"x1_crtc.h"
#include	"x1_scpu.h"
#include	"x1_vram.h"
#include	"x1_cmt.h"
#include	"x1_8255.h"
#include	"draw.h"

#include	"dosio.h"
#include	"trace.h"
#include	"keylog.h"
#if T_TUNE
#include	"x1_cmt.h"
#endif

/***********************************************************************
	8255\
***********************************************************************/

#if 1													// phantasie II, III
	s8255_TABLE		s8255 = {0, 0xff, 0xff, 0};
#else
	s8255_TABLE		s8255 = {0xff, 0xff, 0xff, 0};
#endif

static DWORD s_iomode_set_logs = 0;
static DWORD s_portc_bit5_logs = 0;
// DAMSEL(bit5) edge detector latch for IO_MODE trigger.
// Keep this independent from PORT_C init value to avoid false trigger at boot.
static BYTE s_damsel_prev = 0;

void init_8255(void) {

	s8255.MODE = 0;
	s8255.PORT_A = 0;
	s8255.PORT_C |= 0x40;
	s8255.IO_MODE = 0;
	s_damsel_prev = 0;
}


X1_IOW x1_8255_w(WORD port, BYTE value) {

	BYTE	bak_c, bit;
	WORD	xl;

//	TRACEOUT(port, value);

	if (crtc.TXT_XL == 40) {
		s8255.PORT_C |= 0x40;
	}
	else {
		s8255.PORT_C &= ~0x40;
	}
	bak_c = s8255.PORT_C;

#if T_TUNE
	/* ld bc,1a0b : out(c),c : dec c : out (c),c でﾄﾞｳｼﾞｱｸｾｽﾓｰﾄﾞ ﾆﾅﾙﾉﾖ */
	switch(port & 0x03) {
#else
	switch(port & 0x0f) {
#endif
		case 0:
			if (!(s8255.MODE & 0x10)) {
				s8255.PORT_A = value;
			}
			return;
		case 1:
			if (!(s8255.MODE & 0x02)) {
				s8255.PORT_B = value;
			}
			return;
		case 2:
			if (!(s8255.MODE & 0x01)) {
				s8255.PORT_C &= 0xf0;
				s8255.PORT_C |= (value & 0x0f);
			}
			if (!(s8255.MODE & 0x08)) {
				s8255.PORT_C &= 0x0f;
				s8255.PORT_C |= (value & 0xf0);
			}
			break;
		case 3:
			if (value & 0x80) {
				s8255.MODE = value;
				return;
			}
			else {
				bit = (BYTE)(1 << ((value>>1) & 7));
				if (value & 0x01) {
					s8255.PORT_C |= bit;
				}
				else {
					s8255.PORT_C &= ~bit;
				}
			}
			break;
			default:
				return;
		}

	if (((bak_c ^ s8255.PORT_C) & 0x20) && keylog_enabled() && (s_portc_bit5_logs < 512)) {
		keylog_printf("8255 PORTC bit5 change pc=%04X port=%04X val=%02X old=%02X new=%02X mode=%02X",
			(unsigned int)R.PC.W, (unsigned int)port, (unsigned int)value,
			(unsigned int)bak_c, (unsigned int)s8255.PORT_C, (unsigned int)s8255.MODE);
		s_portc_bit5_logs++;
	}

#if T_TUNE
	cmt_write(s8255.PORT_C & 1);
#else
//	cmt_write(s8255.PORT_C & 1);
#endif
	BYTE damsel_now = (BYTE)(s8255.PORT_C & 0x20);
	if (s_damsel_prev && !damsel_now) {
		s8255.IO_MODE = 1;
		if (keylog_enabled() && (s_iomode_set_logs < 512)) {
			keylog_printf("IOMODE SET pc=%04X port=%04X val=%02X bak=%02X new=%02X",
				(unsigned int)R.PC.W, (unsigned int)port, (unsigned int)value,
				(unsigned int)bak_c, (unsigned int)s8255.PORT_C);
			s_iomode_set_logs++;
		}
	}
	s_damsel_prev = damsel_now;
	xl = ((s8255.PORT_C & 0x40)?40:80);
	if (crtc.TXT_XL != xl) {
		crtc.TXT_XL = (BYTE)xl;
		crtc.GRP_XL = xl << 3;
		vrambank_patch();
		scrnallflash = 1;
	}
}

// ---- state save/load ----
#include "state_save.h"

int ppi_save_state(BYTE *buf, int maxlen) {
	int pos = 0;
	SS_WRITE(buf, pos, &s8255, sizeof(s8255));
	SS_WRITE_U8(buf, pos, s_damsel_prev);
	return pos;
}

int ppi_load_state(const BYTE *buf, int len) {
	int pos = 0;
	SS_READ(buf, pos, &s8255, sizeof(s8255));
	// backward compat: old saves may not have s_damsel_prev
	if (len >= pos + 1) {
		SS_READ_U8(buf, pos, s_damsel_prev);
	} else {
		s_damsel_prev = (BYTE)(s8255.PORT_C & 0x20);
	}
	return 0;
}

X1_IOR x1_8255_r(WORD port) {
#if T_TUNE
	WORD v_cnt = get_vpos(get_frame_pos());

	/* bit 0 : BREAK off */
	s8255.PORT_B  = x1_sub_getbreak();
	/* bit 1 : CMT read data */
	s8255.PORT_B |= cmt_read();
#else
	s8255.PORT_B = cmt_test(); // | cmt_read();	// THUNDER BALL
#endif

	if (v_cnt < crtc.CRT_YL) {
		s8255.PORT_B |= 0x80;					// 1:DISP
	}
	if (scpu.IBF) {
#if !T_TUNE
		scpu.IBF = 0;
#endif
		s8255.PORT_B |= 0x40;					// 1:SUB-CPU BUSY
	}
	if (scpu.OBF) {
		s8255.PORT_B |= 0x20;					// 1:SUB-CPU Data empty
	}
	if (!x1flg.ROM_SW) {
		s8255.PORT_B |= 0x10;					// 1:RAM
	}
	if (!(v_cnt < crtc.CRT_VS)) {
		s8255.PORT_B |= 0x04;					// V-SYNC
	}
	if (crtc.TXT_XL == 40) {
		s8255.PORT_C |= 0x40;
	}
	else {
		s8255.PORT_C &= ~0x40;
	}

	switch(port & 0x0f) {
		case 0:
			return(s8255.PORT_A);
		case 1:
			return(s8255.PORT_B);
		case 2:
			return(s8255.PORT_C);
		case 3:
			return(s8255.MODE);
	}
	return(-1);
}

#include	<windows.h>

#include	"xmil.h"
#include	"x1.h"
#include	"x1_scpu.h"
#include	"x1_8255.h"
#include	"x1_pcg.h"
#include	"x1_crtc.h"
#include	"x1_vram.h"
#include	"x1_fdc.h"
#include	"x1_dma.h"
#include	"x1_ctc.h"
#include	"x1_sio.h"
#include	"x1_sound.h"
#if T_TUNE
#include	"x1_emm.h"
#include	"x1_sasi.h"
#endif

#include	"dosio.h"
#include	"trace.h"
#include	"keylog.h"

static DWORD s_iomode_out_logs = 0;
static DWORD s_iomode_clear_logs = 0;

/***********************************************************************
	Ｉ／Ｏ
***********************************************************************/

void __fastcall Z80_Out(WORD port, BYTE value) {

	BYTE	hi;
	WORD	lo;

	if (s8255.IO_MODE) {							// ﾄﾞｳｼﾞ･ｱｸｾｽ ﾓｰﾄﾞ
		if (keylog_enabled() && (s_iomode_out_logs < 1024)) {
			keylog_printf("IOMODE OUT pc=%04X port=%04X val=%02X",
				(unsigned int)R.PC.W, (unsigned int)port, (unsigned int)value);
			s_iomode_out_logs++;
		}
		x1_grp_w2(port, value);
		return;
	}
	if (port >= 0x4000) {
		x1_grp_w(port, value);
		return;
	}
	if (port >= 0x2000) {
		x1_txt_w(port, value);
		return;
	}
	hi = (BYTE)(port >> 8);
	if (hi < 0x10) {
		lo = port & 0xfffc;
		if ((lo == 0x0ff8) || (lo == 0x0ffc)) {
			x1_fdc_w(port, value);
			return;
		}
		if (port == 0x0700) {
			x1_opm_reg(port, value);
			return;
		}
		if (port == 0x0701) {
			x1_opm_dat(port, value);
			return;
		}
		if (lo == 0x0704) {
			x1_ctc_w(port, value);
			return;
		}
		if (lo == 0x0e80) {
			x1_knj_w(port, value);
			return;
		}
		if ((x1flg.ROM_TYPE >= 2) && (hi == 0x0b)) {
			if (value & 0x10) {
				if (x1flg.ROM_SW) {
					RAM0r = mBIOS;
					RAM0w = mMAIN;
				}
				else {
					RAM0r = RAM0w = mMAIN;
				}
			}
			else {
				RAM0r = RAM0w = mBANK[value & 15];
			}
			lastmem = value;
			return;
		}
#if T_TUNE
		if ( lo == 0x0fd0 ){
			x1_sasi_w(port, value);
			return;
		}
		if (hi == 0x0d) {
			x1_emm_w(port, value);
			return;
		}
		if (hi == 0x0e) {
			x1_rom_w(port, value);
			return;
		}
#endif
		return;
	}
	if (hi < 0x13) {
		x1_palet_w(port, value);
		return;
	}
	if (hi == 0x13) {
		x1_ply_w(port, value);
		return;
	}
	if (hi < 0x18) {
		x1_pcg_w(port, value);
		return;
	}
	if (hi == 0x18) {
		x1_crtc_w(port, value);
		return;
	}
	if (hi == 0x19) {
		x1_sub_w(port, value);
		return;
	}
	if (hi == 0x1a) {
		x1_8255_w(port, value);
		return;
	}
	if (hi == 0x1b) {
		x1_psg_dat(port, value);
		return;
	}
	if (hi == 0x1c) {
		x1_psg_reg(port, value);
		return;
	}
	if (hi == 0x1d) {
		x1flg.ROM_SW = 1;
		if (lastmem & 0x10) {
			RAM0r = mBIOS;
		}
		return;
	}
	if (hi == 0x1e) {
		x1flg.ROM_SW = 0;
		if (lastmem & 0x10) {
			RAM0r = mMAIN;
		}
		return;
	}
	lo = port & 0xfc;
	if (lo < 0x80) {
		return;
	}
	if (x1flg.ROM_TYPE >= 2) {
		if (lo < 0x90) {
			x1_dma_w(port, value);
			return;
		}
		if ((lo == 0xa0) || (lo == 0xa8)) {
			x1_ctc_w(port, value);
			return;
		}
		if (port == 0x1fd0) {
			x1_scrn_w(port, value);
			return;
		}
		if (port == 0x1fe0) {
			x1_blackctrl_w(port, value);
			return;
		}
	}
	if (x1flg.ROM_TYPE >= 3) {
		if (port == 0x1fb0) {
			x1_extpal_w(port, value);
			return;
		}
		if (port == 0x1fc0) {
			x1_exttextdisp_w(port, value);
			return;
		}
		if (port == 0x1fc5) {
			x1_extgrphpal_w(port, value);
			return;
		}
		if ((port >= 0x1fb9) && (port < 0x1fc0)) {
			x1_exttextpal_w(port, value);
			return;
		}
	}
	if (lo == 0x90) {
		x1_sio_w(port, value);
		return;
	}
}



BYTE __fastcall Z80_In(WORD port) {

	BYTE	hi, lo;
	WORD	port4;

	if (s8255.IO_MODE && keylog_enabled() && (s_iomode_clear_logs < 512)) {
		keylog_printf("IOMODE CLR pc=%04X in_port=%04X", (unsigned int)R.PC.W, (unsigned int)port);
		s_iomode_clear_logs++;
	}
	s8255.IO_MODE = 0;
	hi = (BYTE)(port >> 8);

	if (port >= 0x4000) {
#if 0
		return(x1_grp_r(port));
#else
		BYTE	ret = x1_grp_r(port);
		if ((R.PC.W == 0x8209) ||
			(R.PC.W == 0x81FC) ||
			(R.PC.W == 0x81f2)) {
			TRACEIN_A(port, ret);
		}
		return(ret);
#endif
	}
	if (port >= 0x2000) {
		return(x1_txt_r(port));
	}
	if (hi < 0x13) {
		port4 = port & 0xfffc;
		if ((port4 == 0xff8) || (port4 == 0xffc)) {
			return(x1_fdc_r(port));
		}
		if ((port == 0x0700) || (port == 0x0701)) {
			return(x1_opm_stat(port));
		}
		if (port4 == 0x0704) {
			return(x1_ctc_r(port));
		}
		if ((port == 0xe80) || (port == 0xe81)) {
			return(x1_knj_r(port));
		}
		if ((x1flg.ROM_TYPE >= 2) && (hi == 0x0b)) {
			return(lastmem);
		}
		if ((x1flg.ROM_TYPE >= 3) && (hi >= 0x10)) {
			return(x1_palet_r(port));
		}
#if T_TUNE
		if (port4 == 0xfd0) {
			return(x1_sasi_r(port));
		}
		if (hi == 0x0d) {
			return(x1_emm_r(port));
		}
		if (hi == 0x0e) {
			return(x1_rom_r(port));
		}
#endif
	}
	else if (hi == 0x13) {
		if (x1flg.ROM_TYPE >= 3) {
			return(x1_ply_r(port));
		}
	}
	else {
		if (hi < 0x18) {
			return(x1_pcg_r(port));
		}
		if (hi == 0x19) {
			return(x1_sub_r(port));
		}
		if (hi == 0x1a) {
			return(x1_8255_r(port));
		}
		if (hi == 0x1b) {
			return(x1_psg_sta(port));
		}
		if (hi == 0x1f) {
			lo = (BYTE)(port & 0xfc);
			if (lo < 0x80) {
				return(0xff);
			}
			if (x1flg.ROM_TYPE >= 2) {
				if (lo < 0x90) {
					return(x1_dma_r(port));
				}
				if ((lo == 0xa0) || (lo == 0xa8)) {
					return(x1_ctc_r(port));
				}
				if (port == 0x1fd0) {
					return(x1_scrn_r(port));
				}
				if (port >= 0x1ff0) {
					return(x1_dipsw_r(port));
				}
			}
			if (x1flg.ROM_TYPE >= 3) {
				if (port == 0x1fb0) {
					return(x1_extpal_r(port));
				}
				if (port == 0x1fc0) {
					return(x1_exttextdisp_r(port));
				}
				if (port == 0x1fc5) {
					return(x1_extgrphpal_r(port));
				}
				if ((port >= 0x1fb9) && (port < 0x1fc0)) {
					return(x1_exttextpal_r(port));
				}
				if (port == 0x1fe0) {
					return(x1_blackctrl_r(port));
				}
			}
			if (lo == 0x90) {
				return(x1_sio_r(port));
			}
		}
	}
	return(0xff);
}

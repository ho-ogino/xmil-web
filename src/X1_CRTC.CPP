#include	<windows.h>

#include	"common.h"
#include	"x1.h"
#include	"x1_crtc.h"
#include	"x1_pcg.h"
#include	"x1_vram.h"
#include	"ddraws.h"
#include	"draw.h"
#include	"palettes.h"

#include	"dosio.h"
#include	"trace.h"

		CRTC_TABLE	crtc;

		BYTE	crtc_TEXTPAL[8];
		WORD	crtc_GRPHPAL[2][64];
		WORD	crtc_PAL4096[4096];

static	BYTE	def_TEXTPAL[8] = {
				0x00, 0x03, 0x0c, 0x0f, 0x30, 0x33, 0x3c, 0x3f};
static	WORD	def_GRPHPAL[64] = {
				0x000, 0x00a, 0x0a0, 0x0aa, 0xa00, 0xa0a, 0xaa0, 0xaaa,
				0x005, 0x00f, 0x0a5, 0x0af, 0xa05, 0xa0f, 0xaa5, 0xaaf,
				0x050, 0x05a, 0x0f0, 0x0fa, 0xa50, 0xa5a, 0xaf0, 0xafa,
				0x055, 0x05f, 0x0f5, 0x0ff, 0xa55, 0xa5f, 0xaf5, 0xaff,
				0x500, 0x50a, 0x5a0, 0x5aa, 0xf00, 0xf0a, 0xfa0, 0xfaa,
				0x505, 0x50f, 0x5a5, 0x5af, 0xf05, 0xf0f, 0xfa5, 0xfaf,
				0x550, 0x55a, 0x5f0, 0x5fa, 0xf50, 0xf5a, 0xff0, 0xffa,
				0x555, 0x55f, 0x5f5, 0x5ff, 0xf55, 0xf5f, 0xff5, 0xfff};


const	CRTC_TABLE	crtcdefault = {
				0xaa,						// PAL_B;
				0xcc,						// PAL_R;
				0xf0,						// PAL_G;
				0x00,						// PLY
				{0, 1, 2, 3, 4, 5, 6, 7},	// TEXT_PAL[8]
				0,							// SCRN_BITS
				0,							// CRTC_NUM

				0,							// DISP_PAGE
				8,							// FNT_XL
				8,							// FNT_YL
				40,							// TXT_XL
				25,							// TXT_YL
				28,							// TXT_YS
				320,						// GRP_XL
				200,						// GRP_YL
				0,							// CPU_BANK
				0,							// CRT_BANK

				200,						// CRT_YL
				232,						// CRT_VS
				266,						// CRT_VL

				31,							// TXT_VL
				10,							// TXT_VLA

				0,							// TXT_TOP
				8,							// fnty

				0,							// lastpal

				0,							// BLACKPAL
				0,							// EXTPALMODE
				0,							// EXTGRPHPAL
				0,							// ZPRY
	};

	BYTE	dispmode = SCRN64_INVALID;
	BYTE	pal_bank = PAL_NORMAL;
	BYTE	pal_disp = PAL_NORMAL;

void vrambank_patch(void) {

//	TRACE_("SCRN_BITS : ",crtc.SCRN_BITS);
//	TRACE_("EXTPALMODE: ",crtc.EXTPALMODE);
//	TRACE_("ZPRY      : ",crtc.ZPRY);
//	TRACE_("TXT_XL    : ",crtc.TXT_XL);

	if (crtc.SCRN_BITS & 0x10) {
		curvram = &GRP_RAM[GRAM_BANK1];
		curupdt = UPDATE_VRAM1;
	}
	else {
		curvram = &GRP_RAM[GRAM_BANK0];
		curupdt = UPDATE_VRAM0;
	}
	dispmode = ((crtc.SCRN_BITS & SCRN_DISPVRAM) ? SCRN_BANK1 : SCRN_BANK0);
	pal_bank = pal_disp = PAL_NORMAL;


	if ((!(crtc.EXTPALMODE & 0x80)) || (crtc.SCRN_BITS & SCRN_UNDERLINE)) {
		updatemsk = 0x7ff;
		if ((crtc.SCRN_BITS & SCRN_24KHZ) && (crtc.TXT_XL == 80)) {
			pal_bank = pal_disp = PAL_HIGHRESO;
		}
		if (crtc.SCRN_BITS & SCRN_TEXTYx2) {
			updatemsk = 0x3ff;
		}
	}
	else {													// Analog mode
		updatemsk = 0x3ff;
		if (!(crtc.SCRN_BITS & SCRN_TEXTYx2)) {
			if (crtc.SCRN_BITS & SCRN_24KHZ) {
				if (crtc.TXT_XL == 40) {
					if (crtc.SCRN_BITS & SCRN_200LINE) {	// width 40,25,0,2
						dispmode |= SCRN64_320x200;
					}
					else {									// width 40,25,1,2
						dispmode = SCRN64_H320x400;
					}
				}
				else {										// width 80,25,?,2
					updatemsk = 0x7ff;
					pal_bank = pal_disp = PAL_HIGHRESO;
				}
			}
			else {
				if (crtc.TXT_XL == 40) {					// width 40,25,0,1
					if (crtc.EXTPALMODE & 0x10) {
						if (crtc.ZPRY & 0x10) {
							dispmode = SCRN64_L320x200x2 |
								((crtc.ZPRY & 8) ? SCRN_BANK1 : SCRN_BANK0);
							pal_disp = PAL_4096 | PAL_64x2 |
								((crtc.ZPRY & 8) ? PAL_4096L : PAL_4096H);
						}
						else {
							dispmode |= SCRN64_320x200;
							pal_disp = PAL_4096 |
									((crtc.SCRN_BITS & SCRN_DISPVRAM)
													? PAL_4096L : PAL_4096H);
						}
						pal_bank = PAL_4096 |
									((crtc.SCRN_BITS & SCRN_ACCESSVRAM)
													? PAL_4096L : PAL_4096H);
					}
					else {
						dispmode = SCRN64_320x200x4096 | SCRN_DRAW4096;
						pal_bank = pal_disp = PAL_4096 | PAL_4096FULL;
					}
				}
				else {										// width 80,25,0,1
					updatemsk = 0x7ff;
					dispmode = SCRN64_L640x200;
				}
			}
		}
		else {
			if (crtc.SCRN_BITS & SCRN_24KHZ) {
				if (crtc.TXT_XL == 40) {
					if (crtc.SCRN_BITS & SCRN_200LINE) {	// width 40,12,0,2
						dispmode |= SCRN64_320x100;
					}
					else {									// width 40,12,1,2
						dispmode = SCRN64_H320x200;
					}
				}
				else {										// width 80,12,?,2
					pal_bank = pal_disp = PAL_HIGHRESO;
				}
			}
			else {
				if (crtc.TXT_XL == 40) {					// width 40,12,0,1
					if (crtc.EXTPALMODE & 0x10) {
						if (crtc.ZPRY & 0x10) {
							dispmode = SCRN64_320x100x2 |
								((crtc.ZPRY & 8) ? SCRN_BANK1 : SCRN_BANK0);
							pal_disp = PAL_4096 | PAL_64x2 |
								((crtc.ZPRY & 8) ? PAL_4096L : PAL_4096H);
						}
						else {
							dispmode |= SCRN64_320x100;
							pal_disp = PAL_4096 |
									((crtc.SCRN_BITS & SCRN_DISPVRAM)
													? PAL_4096L : PAL_4096H);
						}
						pal_bank = PAL_4096 |
									((crtc.SCRN_BITS & SCRN_ACCESSVRAM)
													? PAL_4096L : PAL_4096H);
					}
					else {
						dispmode = SCRN64_320x100x4096 | SCRN_DRAW4096;
						pal_bank = pal_disp = PAL_4096 | PAL_4096FULL;
					}
				}
				else {										// width 80,12,0,1
					dispmode = SCRN64_L640x100;
				}
			}
		}
	}
}




void crtc_updt(void) {

	if (crtc.SCRN_BITS & SCRN_24KHZ) {
		crtc.fnty = (crtc.FNT_YL >> 1) & 0xfffe;
	}
	else {
		crtc.fnty = crtc.FNT_YL  & 0xfffe;
	}
	if (crtc.TXT_YL) {
		crtc.CRT_YL = crtc.fnty * crtc.TXT_YL;
	}
	else {
		crtc.CRT_YL = crtc.fnty * 1;
	}
	crtc.CRT_VS = crtc.fnty * (crtc.TXT_YS + 1);
	crtc.CRT_VL = (crtc.TXT_VL + 1) * crtc.fnty + crtc.TXT_VLA;

}



/***********************************************************************
	初期化
***********************************************************************/

// 電源投入（コールドスタート）時に呼ぶ。
// 次回 init_crtc() で initcrtc==0 パスを通り、パレットが初期値に戻る。
static	BYTE	initcrtc = 0;

void crtc_cold_reset(void) {
	initcrtc = 0;
}

void init_crtc(void) {

	crtc = crtcdefault;

	palandply = 1;
	dispmode = SCRN64_INVALID;
	pal_bank = pal_disp = PAL_NORMAL;
	if (!initcrtc) {
		initcrtc++;
		memcpy(crtc_TEXTPAL, def_TEXTPAL, 8);
		memcpy(crtc_GRPHPAL[0], def_GRPHPAL, 64*2);
		memcpy(crtc_GRPHPAL[1], def_GRPHPAL, 64*2);
		for (WORD p=0; p<4096; p++) {
			crtc_PAL4096[p] = p;
		}
	}
	else if (x1flg.ROM_TYPE < 3) {
		memcpy(crtc_TEXTPAL, def_TEXTPAL, 8);
		memcpy(crtc_GRPHPAL[0], def_GRPHPAL, 64*2);
		memcpy(crtc_GRPHPAL[1], def_GRPHPAL, 64*2);
	}
	if ((x1flg.ROM_TYPE >= 2) && (!(x1flg.DIP_SW & 1))) {
		crtc.SCRN_BITS = SCRN_200LINE;
		crtc.FNT_YL = 16;
	}

	textdrawproc_renewal();
	reflesh_palette();
	crtc_updt();

	vrambank_patch();
	palandply = 1;
	scrnallflash = 1;
}


/***********************************************************************
	CRTC
***********************************************************************/

X1_IOW x1_crtc_w(WORD port, BYTE value) {

//	TRACEOUT(port, value);

	if (port == 0x1800) {
		crtc.CRTC_NUM = value;
	}
	else if (port == 0x1801) {
		switch(crtc.CRTC_NUM) {
			case  1:
				if (value <= 40) {
					crtc.TXT_XL = 40;
				}
				else {
					crtc.TXT_XL = 80;
				}
				vrambank_patch();
				break;
			case  4:
				crtc.TXT_VL = value;
				break;
			case  5:
				crtc.TXT_VLA = value;
				break;
			case  6:
				crtc.TXT_YL = value;
				break;
			case  7:
				crtc.TXT_YS = value;
				break;
			case  9:
				crtc.FNT_YL = (WORD)value+1;
				break;
			case 12:
				*(((BYTE *)&crtc.TXT_TOP)+1) = (BYTE)(value & 7);
				doubleatrchange = 1;
				break;
			case 13:
				*(BYTE *)&crtc.TXT_TOP = value;
				doubleatrchange = 1;
				break;
			default:
				return;
		}
		crtc.GRP_XL = crtc.TXT_XL << 3;
		crtc.GRP_YL = 200;
		crtc_updt();
		scrnallflash = 1;								/* 990220 puni */
	}
}

/***********************************************************************
	PALLET
***********************************************************************/

X1_IOW x1_extpal_w(WORD port, BYTE value) {

//	TRACEOUT(port, value);

	crtc.EXTPALMODE = value;
	vrambank_patch();
}

X1_IOR x1_extpal_r(WORD port) {

	return(crtc.EXTPALMODE);
}

X1_IOW x1_extgrphpal_w(WORD port, BYTE value) {

//	TRACEOUT(port, value);

	if (crtc.EXTPALMODE & 0x80) {
		crtc.EXTGRPHPAL = value;
	}
}

X1_IOR x1_extgrphpal_r(WORD port) {

	if (crtc.EXTPALMODE & 0x80) {
		return(crtc.EXTGRPHPAL);
	}
	return(-1);
}

X1_IOW x1_exttextpal_w(WORD port, BYTE value) {

//	TRACEOUT(port, value);

	if (crtc.EXTPALMODE & 0x80) {
		crtc_TEXTPAL[port-0x1fb8] = value;
		textpalette1(port-0x1fb8);
	}
}

X1_IOR x1_exttextpal_r(WORD port) {

	if (crtc.EXTPALMODE & 0x80) {
		return(crtc_TEXTPAL[port-0x1fb8]);
	}
	return(-1);
}

X1_IOW x1_exttextdisp_w(WORD port, BYTE value) {

//	TRACEOUT(port, value);

	crtc.ZPRY = value;
	vrambank_patch();
}

X1_IOR x1_exttextdisp_r(WORD port) {

	if (crtc.EXTPALMODE & 0x80) {
		return(crtc.ZPRY);
	}
	return(-1);
}


X1_IOW x1_palet_w(WORD port, BYTE value) {

	BYTE	c;
	WORD	pal;

//	TRACEOUT(port, value);

	crtc.lastpal = (value & 0xf0);
	if (crtc.EXTPALMODE & 0x80) {
		if ((crtc.EXTGRPHPAL & 0x88) != 0x80) {
			return;
		}
		if (pal_bank & PAL_4096) {					// use 4096palettes
			switch(pal_bank & (PAL_4096FULL | PAL_4096BANK)) {
				case 0:
					pal = ((port & 0xcc) << 4) | ((value & 0xc0) >> 4);
					break;
				case 1:
					pal = ((port & 0xcc) << 2) | ((value & 0xc0) >> 6);
					break;
				default:
					pal = ((port & 0xff) << 4) | (crtc.lastpal >> 4);
					break;
			}
			value &= 0xf;
			switch(port & 0xff00) {
				case 0x1000:
					crtc_PAL4096[pal] &= 0xff0;
					crtc_PAL4096[pal] |= value;
					break;
				case 0x1100:
					crtc_PAL4096[pal] &= 0xf0f;
					crtc_PAL4096[pal] |= (value << 4);
					break;
				case 0x1200:
					crtc_PAL4096[pal] &= 0x0ff;
					crtc_PAL4096[pal] |= ((WORD)value << 8);
					break;
			}
			grphpal4096(pal);
		}
		else {
			c = ((port & 0x80) >> 5) | ((port & 0x08) >> 2) |
												((value & 0x80) >> 7);
			if ((dispmode & SCRN64_MASK) == SCRN64_INVALID) {
				c |= (c << 3);
			}
			else {
				c += ((port & 0x40) >> 1) | ((port & 0x04) << 2) |
													((value & 0x40) >> 3);
			}
			value &= 0xf;
			switch(port & 0xff00) {
				case 0x1000:
					crtc_GRPHPAL[pal_bank][c] &= 0xff0;
					crtc_GRPHPAL[pal_bank][c] |= value;
					break;
				case 0x1100:
					crtc_GRPHPAL[pal_bank][c] &= 0xf0f;
					crtc_GRPHPAL[pal_bank][c] |= (value << 4);
					break;
				case 0x1200:
					crtc_GRPHPAL[pal_bank][c] &= 0x0ff;
					crtc_GRPHPAL[pal_bank][c] |= ((WORD)value << 8);
					break;
			}
			grphpalette1(pal_bank, c);
		}
	}
	else {
		switch(port & 0xff00) {
			case 0x1000:
				if (crtc.PAL_B != value) {
					crtc.PAL_B = value;
					palandply = 1;
				}
				break;
			case 0x1100:
				if (crtc.PAL_R != value) {
					crtc.PAL_R = value;
					palandply = 1;
				}
				break;
			case 0x1200:
				if (crtc.PAL_G != value) {
					crtc.PAL_G = value;
					palandply = 1;
				}
				break;
		}
	}
}


X1_IOR x1_palet_r(WORD port) {

	WORD	c;

	if ((crtc.EXTPALMODE & 0x80) && ((crtc.EXTGRPHPAL & 0x88) == 0x88)) {
		if (pal_bank & PAL_4096) {					// use 4096palettes
			switch(pal_bank & (PAL_4096FULL | PAL_4096BANK)) {
				case 0:
					c = ((port & 0xcc) << 4) | ((crtc.lastpal & 0xc0) >> 4);
					break;
				case 1:
					c = ((port & 0xcc) << 2) | ((crtc.lastpal & 0xc0) >> 6);
					break;
				default:
					c = ((port & 0xff) << 4) | (crtc.lastpal >> 4);
					break;
			}
			switch(port & 0xff00) {
				case 0x1000:
					return(crtc.lastpal | (crtc_PAL4096[c] & 0xf));
				case 0x1100:
					return(crtc.lastpal | ((crtc_PAL4096[c] & 0xf0) >> 4));
				case 0x1200:
					return(crtc.lastpal | ((crtc_PAL4096[c] & 0xf00) >> 8));
			}
		}
		else {
			c = ((port & 0x80) >> 5) | ((port & 0x08) >> 2) |
											((crtc.lastpal & 0x80) >> 7);
			if ((dispmode & SCRN64_MASK) == SCRN64_INVALID) {
				c |= (c << 3);
			}
			else {
				c += ((port & 0x40) >> 1) | ((port & 0x04) << 2) |
											((crtc.lastpal & 0x40) >> 3);
			}
			switch(port & 0xff00) {
				case 0x1000:
					return(crtc.lastpal |
								(crtc_GRPHPAL[pal_bank][c] & 0xf));
				case 0x1100:
					return(crtc.lastpal |
								((crtc_GRPHPAL[pal_bank][c] & 0xf0) >> 4));
				case 0x1200:
					return(crtc.lastpal |
								((crtc_GRPHPAL[pal_bank][c] & 0xf00) >> 8));
			}
		}
	}
	return(0xff);
}

X1_IOW x1_blackctrl_w(WORD port, BYTE value) {

	crtc.BLACKPAL = value;
	palandply = 1;
}

X1_IOR x1_blackctrl_r(WORD port) {

	return(crtc.BLACKPAL);
}


/***********************************************************************
	ﾌﾟﾗｲｵﾘﾃｨ
***********************************************************************/

X1_IOW x1_ply_w(WORD port, BYTE value) {

	if (crtc.PLY != value) {
		crtc.PLY = value;
		palandply = 1;
	}
}

X1_IOR x1_ply_r(WORD port) {

	return(crtc.PLY);
}


/***********************************************************************
	ｶﾞﾒﾝ ｶﾝﾘ
***********************************************************************/

X1_IOW x1_scrn_w(WORD port, BYTE value) {

	BYTE	scrnbitsbak = crtc.SCRN_BITS;

//	TRACEOUT(port, value);

	crtc.SCRN_BITS = value;
	if ((crtc.SCRN_BITS ^ scrnbitsbak) & SCRN_DISPCHANGE) {
		textdrawproc_renewal();
		reflesh_palette();
		scrnallflash = 1;
		palandply = 1;
		crtc_updt();
	}
	vrambank_patch();
	crtc.CPU_BANK = (BYTE)((crtc.SCRN_BITS & SCRN_ACCESSVRAM)?1:0);
	crtc.CRT_BANK = (BYTE)((crtc.SCRN_BITS & SCRN_DISPVRAM)?1:0);
}

X1_IOR x1_scrn_r(WORD port) {

	return(crtc.SCRN_BITS);
}


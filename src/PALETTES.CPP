#include	<windows.h>

#include	"common.h"
#include	"xmil.h"
#include	"x1.h"
#include	"x1_crtc.h"
#include	"ddraws.h"
#include	"draw.h"

static	PALETTE_TABLE	pal16bit;
static	BYTE			np2_r16b;
static	BYTE			np2_l16r;
static	BYTE			np2_l16g;

void pal_make16mask(DWORD bmask, DWORD rmask, DWORD gmask) {

	WORD	bit;
	BYTE	cnt;

	pal16bit.d = 0;
	for (bit=1; (bit) && (!(bmask & bit)); bit<<=1);
	for (np2_r16b=8; (np2_r16b) && (bmask & bit); np2_r16b--, bit<<=1) {
		pal16bit.p.b >>= 1;
		pal16bit.p.b |= 0x80;
	}
	for (np2_l16r=0, bit=1; (bit) && (!(rmask & bit)); np2_l16r++, bit<<=1);
	for (cnt=0x80; (cnt) && (rmask & bit); cnt>>=1, bit<<=1) {
		pal16bit.p.r |= cnt;
	}
	for (; cnt; cnt>>=1) {
		np2_l16r--;
	}
	for (np2_l16g=0, bit=1; (bit) && (!(gmask & bit)); np2_l16g++, bit<<=1);
	for (cnt=0x80; (cnt) && (gmask & bit); cnt>>=1, bit<<=1) {
		pal16bit.p.g |= cnt;
	}
	for (; cnt; cnt>>=1) {
		np2_l16g--;
	}
}

WORD pal_get16pal(DWORD pal) {

	PALETTE_TABLE	ret;

	ret.d = pal & pal16bit.d;
	return((((WORD)ret.p.g) << np2_l16g) |
			(((WORD)ret.p.r) << np2_l16r) | (ret.p.b >> np2_r16b));
}

void pal_cnv16pal(WORD *dst, DWORD *src, int pals) {

	PALETTE_TABLE	ret;

	while(pals--) {
		ret.d = *src++ & pal16bit.d;
		*dst++ = (((WORD)ret.p.g) << np2_l16g) |
					(((WORD)ret.p.r) << np2_l16r) | (ret.p.b >> np2_r16b);
	}
}


void pal_makegrad(PALETTE_TABLE *pal, int pals, DWORD bg, DWORD fg) {

	int		i;

	if (pals >= 2) {
		pals--;
		for (i=0; i<=pals; i++) {
			pal[i].p.b = (BYTE)
				((((fg >> 0) & 0x0000ff) * i + 
				((bg >> 0) & 0x0000ff) * (pals-i)) / pals);
			pal[i].p.g = (BYTE)
				((((fg >> 8) & 0x0000ff) * i + 
				((bg >> 8) & 0x0000ff) * (pals-i)) / pals);
			pal[i].p.r = (BYTE)
				((((fg >> 16) & 0x0000ff) * i + 
				((bg >> 16) & 0x0000ff) * (pals-i)) / pals);
			pal[i].p.f = 0;
		}
	}
}

// ---------------------------------------------------------------------------

static	BYTE	blankcol = 0;
static	WORD	halfgrp = 0;
static	WORD	halftxt = 0;

		PALETTE_TABLE	TEXTPALS[24];
		PALETTE_TABLE	GRPHPALS[2][16];
		PALETTE_TABLE	GRPHPALS64[2][64];
		PALETTE_TABLE	GRPHPAL4096[4096+8];
		WORD			GRPHPAL16bit[4096+8];

void textpalette1(BYTE num) {

	PALETTE_TABLE	c;
	BYTE			f = 0;

	c.p.f = 0;
	c.p.b = (crtc_TEXTPAL[num] & 0x3) * 0x55;
	if (c.p.b < blankcol) {
		f |= 1;
	}
	c.p.g = ((crtc_TEXTPAL[num] & 0x30) >> 4) * 0x55;
	if (c.p.g < blankcol) {
		f |= 2;
	}
	c.p.r = ((crtc_TEXTPAL[num] & 0x0c) >> 2) * 0x55;
	if (c.p.r < blankcol) {
		f |= 4;
	}
	if (f == 7) {
		c.d = 0x010101 * blankcol;
	}
	GRPHPAL4096[4096+num].d = c.d;
	if ((SCREENMODE & SCMD_COLORMASK) == SCMD_COLOR16) {
		GRPHPAL16bit[4096+num] = pal_get16pal(c.d);
	}

	TEXTPALS[num].d = c.d;
	TEXTPALS[num].p.f = num + START_EXT;

	TEXTPALS[num+8].p.b = (halftxt * c.p.b) / 0x00ff;
	TEXTPALS[num+8].p.g = (halftxt * c.p.g) / 0x00ff;
	TEXTPALS[num+8].p.r = (halftxt * c.p.r) / 0x00ff;
	TEXTPALS[num+8].p.f = num + START_EXT + 0x08;

	TEXTPALS[num+16].p.b = (halfgrp * c.p.b) / 0x00ff;
	TEXTPALS[num+16].p.g = (halfgrp * c.p.g) / 0x00ff;
	TEXTPALS[num+16].p.r = (halfgrp * c.p.r) / 0x00ff;
	TEXTPALS[num+16].p.f = num + START_EXT + 0x10;

	palandply = 1;
}


void grphpalette1(BYTE bank, BYTE num) {

	PALETTE_TABLE	c;
	BYTE			f = 0;

	c.p.b = (crtc_GRPHPAL[bank][num] & 0xf) * 0x11;
	if (c.p.b < blankcol) {
		f |= 1;
	}
	c.p.g = (crtc_GRPHPAL[bank][num] >> 8) * 0x11;
	if (c.p.g < blankcol) {
		f |= 2;
	}
	c.p.r = ((crtc_GRPHPAL[bank][num] & 0xf0) >> 4) * 0x11;
	if (c.p.r < blankcol) {
		f |= 4;
	}
	if (f == 7) {
		c.d = 0x010101 * blankcol;
	}

	GRPHPALS64[bank][num].d = c.d;
	GRPHPALS64[bank][num].p.f = num + START_PAL;
	if (!(((num >> 3) ^ num) & 7)) {
		num &= 7;
		GRPHPALS[bank][num+0].d = c.d;
		GRPHPALS[bank][num+0].p.f = num + START_EXT + 0x18;
		GRPHPALS[bank][num+8].p.b = (halfgrp * c.p.b) / 0xff;
		GRPHPALS[bank][num+8].p.g = (halfgrp * c.p.g) / 0xff;
		GRPHPALS[bank][num+8].p.r = (halfgrp * c.p.r) / 0xff;
		GRPHPALS[bank][num+8].p.f = num + START_EXT + 0x20;
	}
	palandply = 1;
}


void grphpal4096(WORD num) {

	PALETTE_TABLE	c;
	BYTE			f = 0;

	c.p.f = 0;
	c.p.b = (crtc_PAL4096[num] & 0xf) * 0x11;
	if (c.p.b < blankcol) {
		f |= 1;
	}
	c.p.g = (crtc_PAL4096[num] >> 8) * 0x11;
	if (c.p.g < blankcol) {
		f |= 2;
	}
	c.p.r = ((crtc_PAL4096[num] & 0xf0) >> 4) * 0x11;
	if (c.p.r < blankcol) {
		f |= 4;
	}
	if (f == 7) {
		c.d = 0x010101 * blankcol;
	}
	GRPHPAL4096[num].d = c.d;
	if ((SCREENMODE & SCMD_COLORMASK) == SCMD_COLOR16) {
		GRPHPAL16bit[num] = pal_get16pal(c.d);
	}
	palandply = 1;
}



void reflesh_palette(void) {

	BYTE	i, j;
	WORD	k;

	blankcol = xmilcfg.BLKLIGHT;
	if ((!xmilcfg.SKIP_LINE) || (crtc.SCRN_BITS & SCRN_24KHZ)) {
		blankcol >>= 1;
	}
	halfgrp = xmilcfg.LINEDEPTH;
	switch(xmilcfg.TEXT400L) {
		case 0:
			halftxt = xmilcfg.LINEDEPTH;
			break;
		case 1:
			halftxt = 0xff;
			break;
		default:
			halftxt = xmilcfg.LINETEXT;
			break;
	}

	for (i=0; i<8; i++) {
		textpalette1(i);
	}
	for (j=0; j<2; j++) {
		for (i=0; i<64; i++) {
			grphpalette1(j, i);
		}
	}
	for (k=0; k<4096; k++) {
		grphpal4096(k);
	}
}


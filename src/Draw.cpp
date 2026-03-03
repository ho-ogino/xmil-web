#include	<windows.h>
#include	<stdio.h>
#include	"common.h"
#include	"xmil.h"
#include	"x1.h"
#include	"x1_crtc.h"
#include	"x1_pcg.h"
#include	"keylog.h"
#include	"x1_vram.h"
#include	"draw.h"
#include	"ddraws.h"
#include	"draw.mcr"
#include	"palettes.h"
#include	"draw_sub.h"

		BYTE	updatetmp[0x800+0x101];
		BYTE	scrnflash;
		BYTE	scrnallflash;
		BYTE	doubleatrchange;
		BYTE	palandply;
		BYTE	blinkflag;
		BYTE	blinktest = 0;

extern	BYTE	screenmap[];
extern	BYTE	dispmode;
extern	BYTE	pal_disp;

static	BYTE	lastdisp = 0;
		BYTE	dispflg = UPDATE_VRAM0;
		BYTE	*dispp = &GRP_RAM[GRAM_BANK0];
		BYTE	*dispp2 = &GRP_RAM[GRAM_BANK1];
		WORD	vramsize;
		BYTE	fontlpcnt;
		BYTE	vramylpcnt;
		WORD	vramylpad;
static	BYTE	blinktime = 1;

static	BYTE	ddrawflash = 0;
static	WORD	drawlines = 200;
		BYTE	fonttype = 0;
		BYTE	disp_flashscreen = 1;
		DWORD	drawtime = 0;


void textdrawproc_renewal(void) {

	fonttype = 0;
	if (!(crtc.SCRN_BITS & SCRN_24KHZ)) {
		if (xmilcfg.TEXTMODE) {
			fonttype = KNJ_24KHz;
		}
	}
	else {
		fonttype = ANK_24KHz | KNJ_24KHz;
	}
	scrnallflash = 1;
}


void init_draw(void) {

	fontlpcnt = 8;
	vramylpcnt = 8;
	vramylpad = 160 * 16;
	vramsize = 40*25;

	init_drawtable();
	reflesh_palette();
	lastdisp = 0;
	dispflg = UPDATE_VRAM0;
	dispp = &GRP_RAM[GRAM_BANK0];
}


void fillupdatetmp(void) {

	for (int i = 0; i < 0x800; i++) {
		updatetmp[i] |= UPDATE_TVRAM;
	}
}


static LABEL void flashupdatetmp(void) {

	WORD esi = crtc.TXT_TOP;
	BYTE dl = 0;

	while (dl < crtc.TXT_YL) {
		WORD edi = esi;
		WORD cx = crtc.TXT_XL;
		// 元asm tatex2 条件: 行の全キャラが X1ATR_Yx2 を持つ場合のみ
		// （「je tatex1」= Yx2なし発見でtatex1へ脱出、loopを全走破した場合のみtatex2）
		// 旧実装は逆で「ANY Yx2あり → has_tate_double=TRUE」だったためバグだった。
		BOOL all_yx2 = TRUE;
		for (WORD i = 0; i < cx; i++) {
			WORD addr = (edi + i) & (TRAM_MAX - 1);
			if (!(TXT_RAM[addr + TEXT_ATR] & X1ATR_Yx2)) {
				all_yx2 = FALSE;
				break;
			}
		}

		cx = crtc.TXT_XL >> 1;
		if (all_yx2) {
			// tatex2: 全キャラ Yx2 → eff4=4 を全キャラに設定
			for (WORD i = 0; i < cx; i++) {
				WORD addr0 = esi & (TRAM_MAX - 1);
				WORD addr1 = (esi + 1) & (TRAM_MAX - 1);
				BYTE attr0 = TXT_RAM[addr0 + TEXT_ATR];
				BYTE attr1 = TXT_RAM[addr1 + TEXT_ATR];

				BYTE upd0 = UPDATE_TVRAM | 0x04;
				BYTE upd1 = UPDATE_TVRAM | 0x04;

				if (attr0 & X1ATR_Xx2) {
					upd0 |= 0x08;		// 左セルに横倍角フラグ
					upd1 |= 0x12;		// 右セルに右半倍角フラグ
					if (attr1 & X1ATR_Xx2) {
						upd1 |= 0x08;	// 右セルも横倍角フラグ
					}
				}
				else if (attr1 & X1ATR_Xx2) {
					upd1 |= 0x08;
				}

				upd0 |= (updatetmp[addr0] & UPDATE_TVRAM);
				upd1 |= (updatetmp[addr1] & UPDATE_TVRAM);

				if (updatetmp[addr0] != upd0 || updatetmp[addr1] != upd1) {
					updatetmp[addr0] = upd0 | UPDATE_TVRAM;
					updatetmp[addr1] = upd1 | UPDATE_TVRAM;
				}
				esi += 2;
			}
		}
		else {
			// tatex1: 混在行または Yx2 なし行
			// 先頭から連続して Yx2 のペアは eff4=1(halfx2)。
			// 最初の非Yx2キャラが見つかったら dh=1 として以降は eff4=0。
			BYTE dh = 0;
			for (WORD i = 0; i < cx; i++) {
				WORD addr0 = esi & (TRAM_MAX - 1);
				WORD addr1 = (esi + 1) & (TRAM_MAX - 1);
				BYTE attr0 = TXT_RAM[addr0 + TEXT_ATR];
				BYTE attr1 = TXT_RAM[addr1 + TEXT_ATR];

				BYTE upd0 = 0;
				BYTE upd1 = 0;

				if (dh == 0) {
					if (attr0 & X1ATR_Yx2) {
						upd0 = UPDATE_TVRAM | 0x01;	// 左辺縦倍角(halfx2)
						if (attr1 & X1ATR_Yx2) {
							upd1 = UPDATE_TVRAM | 0x01;	// 右辺縦倍角(halfx2)
							// 両方 Yx2: dh 維持（次のペアも引き続きチェック）
						}
						else {
							dh = 1;	// 右辺が通常: 以降は eff4=0
						}
					}
					else {
						dh = 1;	// 左辺が通常: 以降は eff4=0
					}
				}

				if (attr0 & X1ATR_Xx2) {
					upd0 |= 0x08;		// 左セルに横倍角フラグ
					upd1 |= 0x12;		// 右セルに右半倍角フラグ
					if (attr1 & X1ATR_Xx2) {
						upd1 |= 0x08;	// 右セルも横倍角フラグ
					}
				}
				else if (attr1 & X1ATR_Xx2) {
					upd1 |= 0x08;
				}

				upd0 |= (updatetmp[addr0] & UPDATE_TVRAM);
				upd1 |= (updatetmp[addr1] & UPDATE_TVRAM);

				if (updatetmp[addr0] != upd0 || updatetmp[addr1] != upd1) {
					updatetmp[addr0] = upd0 | UPDATE_TVRAM;
					updatetmp[addr1] = upd1 | UPDATE_TVRAM;
				}
				esi += 2;
			}
		}
		dl++;
	}
}



void updateblink(void) {

	if (blinktime > 0) {
		blinktime--;
		return;
	}
	blinktime = 30 - 1;

	WORD edi = crtc.TXT_TOP;
	const BYTE al = X1ATR_BLINK;
	blinktest ^= al;

	BYTE ah = 0;
	if (vramsize != 0) {
		WORD cx = vramsize;
		do {
			WORD idx = edi & (TRAM_MAX - 1);
			if (TXT_RAM[idx + TEXT_ATR] & al) {
				ah = UPDATE_TVRAM;
				updatetmp[idx] |= UPDATE_TVRAM;
			}
			edi++;
		} while (--cx != 0);
		scrnflash |= ah;
		ah >>= 5;
	}
	blinkflag = ah;
}


// ---------------------------------------------------------------------------

void pal4096to64(PALETTE_TABLE *pal, WORD *map) {

	int		p = 64;

	while(p--) {
		pal->d = GRPHPAL4096[*map++].d;
		pal++;
	}
}

void palettes(void) {

	int		i, j;
	BYTE	bit;
	BYTE	c;
	BYTE	skip8 = 0;
	BYTE	skip16 = 0;

	if (pal_disp & PAL_4096) {
		switch(pal_disp & 0xf) {
			case PAL_4096H:
				pal4096to64(xm_palette, PAL4096_BANK0);
				xm_palettes = 64;

				break;
			case PAL_4096L:
				pal4096to64(xm_palette, PAL4096_BANK1);
				xm_palettes = 64;
				break;
			case (PAL_4096H | PAL_64x2):
				pal4096to64(&xm_palette[ 0], PAL4096_BANK0);
				pal4096to64(&xm_palette[64], PAL4096_BANK1);
				xm_palettes = 128;
				break;
			case (PAL_4096L | PAL_64x2):
				pal4096to64(&xm_palette[ 0], PAL4096_BANK1);
				pal4096to64(&xm_palette[64], PAL4096_BANK0);
				xm_palettes = 128;
				break;
			default:						// fullcolor!
				return;
		}
		for (i=0; i<8; i++) {
			xm_palette[xm_palettes++].d = TEXTPALS[i].d;
		}
	}
	else if ((dispmode & SCRN64_MASK) == SCRN64_INVALID) {
		if ((xmilcfg.SKIP_LINE) && (!(crtc.SCRN_BITS & SCRN_24KHZ))) {
			skip8 = 8;
			skip16 = 16;
		}
		for (i=0, bit=1; i<8; i++, bit<<=1) {
			if (!(crtc.EXTPALMODE & 0x80)) {
				c = 0;
				if (crtc.PAL_B & bit) {
					c |= 1;
				}
				if (crtc.PAL_R & bit) {
					c |= 2;
				}
				if (crtc.PAL_G & bit) {
					c |= 4;
				}
			}
			else {
				c = i;
			}
			xm_palette[i].d = GRPHPALS[pal_disp][c].d;
			xm_palette[i+64].d = xm_palette[i+128].d
										= GRPHPALS[pal_disp][c+skip8].d;
			if (crtc.PLY & bit) {
				for (j=i+8; j<64; j+=8) {
					xm_palette[j].d = xm_palette[i].d;
					xm_palette[j+64].d = xm_palette[j+128].d
													= xm_palette[i+64].d;
				}
			}
			else {
				BYTE cnt = (crtc.BLACKPAL & 15) - 8;
				for (j=i+8; j<64; j+=8) {
					if (--cnt) {
						c = crtc.TEXT_PAL[j>>3];
					}
					else {
						c = 0;
					}
					xm_palette[j].d = TEXTPALS[c].d;
					xm_palette[j+64].d = TEXTPALS[c+skip8].d;
					xm_palette[j+128].d = TEXTPALS[c+skip16].d;
				}
			}
		}
		for (i=0; i<24; i++) {
			xm_palette[i+192].d = TEXTPALS[i].d;
		}
		for (i=0; i<16; i++) {
			xm_palette[i+192+24].d = GRPHPALS[pal_disp][i].d;
		}
		xm_palettes = 64+64+64+24+16;
	}
	else {
		for (i=0; i<64; i++) {
			xm_palette[i].d = GRPHPALS64[pal_disp][i].d;
		}
		for (i=0; i<8; i++) {
			xm_palette[i+64].d = TEXTPALS[i].d;
		}
		xm_palettes = 64+8;
	}
	ddraws_change_palette();
}


static void x1vram_adjust(void) {

	BYTE	maxline;
	BYTE	underlines = 0;

	if (crtc.TXT_XL <= 40) {
		if (dispmode & SCRN_DRAW4096) {
			ddraws_change_xmode(X2MODE_4096);
		}
		else {
			ddraws_change_xmode(X2MODE_WIDTH40);
		}
	}
	else {
		ddraws_change_xmode(X2MODE_WIDTH80);
	}

	fontlpcnt = (BYTE)crtc.FNT_YL;
	if (crtc.SCRN_BITS & SCRN_24KHZ) {
		fontlpcnt >>= 1;
	}
	if (crtc.SCRN_BITS & SCRN_UNDERLINE) {
		fontlpcnt -= 2;
		underlines = 2;
	}
	if (crtc.SCRN_BITS & SCRN_TEXTYx2) {
		fontlpcnt >>= 1;
		fontlpcnt &= 0xfe;
		if (((dispmode & SCRN64_MASK) == SCRN64_INVALID) && (fontlpcnt > 8)) {
			fontlpcnt = 8;
		}
		else if (fontlpcnt < 2) {
			fontlpcnt = 2;
		}
		else if (fontlpcnt > 32) {
			fontlpcnt = 32;
		}
		vramylpcnt = fontlpcnt + underlines;
		vramylpad = vramylpcnt * (SCREEN_WIDTH / 4) * 4;
		maxline = (BYTE)100 / vramylpcnt;
		if (maxline > crtc.TXT_YL) {
			maxline = crtc.TXT_YL;
		}
		vramsize = maxline * crtc.TXT_XL;
		drawlines = maxline * vramylpcnt * 2;
	}
	else {
		fontlpcnt &= 0xfe;
		if (((dispmode & SCRN64_MASK) == SCRN64_INVALID) && (fontlpcnt > 8)) {
			fontlpcnt = 8;
		}
		else if (fontlpcnt < 2) {
			fontlpcnt = 2;
		}
		else if (fontlpcnt > 32) {
			fontlpcnt = 32;
		}
		vramylpcnt = fontlpcnt + underlines;
		vramylpad = vramylpcnt * (SCREEN_WIDTH / 4) * 2;
		maxline = (BYTE)200 / vramylpcnt;
		if (maxline > crtc.TXT_YL) {
			maxline = crtc.TXT_YL;
		}
		vramsize = maxline * crtc.TXT_XL;
		drawlines = maxline * vramylpcnt;
	}
	ddraws_change_drawlines(drawlines*2);
#if 0
	if (vramsize >= (0x800 - crtc.TXT_TOP)) {
		vramsize = 0x800 - crtc.TXT_TOP;
	}
#endif
}

// -------------------------------------------------------------------------

static void (*screendraw[8])(void) = {
				width80x25_200line, width80x25_400line,
				width80x25_200line, width80x25_200line,
				width80x12_200line, width80x12_400line,
				width80x12_200line, width80x12_200line};

static void (*screendraw2[8])(void) = {
				width80x20_15khz, width80x20_24khz,
				width80x20_15khz, width80x20_24khz,
				width80x10_15khz, width80x10_24khz,
				width80x10_15khz, width80x10_24khz};


void scrnupdate(void) {

static	BYTE	framecnt = 0;
static	BYTE	disableraster = 0;

	if (disp_flashscreen) {
		if (++framecnt < xmilcfg.DRAW_SKIP) {
			return;
		}
		framecnt = 0;
	}
	else {
		if (ddrawflash) {
			ddrawflash = 0;
#if T_TUNE
			ddraws_cliparea();
			ddraws_infodraw();
#endif
			ddraws_drawall();
		}
	}

	if (lastdisp != dispmode) {
		if (keylog_enabled()) {
			keylog_printf("DRAW dispmode change old=%02X new=%02X SCRN_BITS=%02X TXT=%dx%d FNT_YL=%d fontlpcnt=%d vramylpcnt=%d",
				lastdisp, dispmode, crtc.SCRN_BITS, crtc.TXT_XL, crtc.TXT_YL, crtc.FNT_YL, fontlpcnt, vramylpcnt);
		}
		lastdisp = dispmode;
		scrnallflash = 1;
		palandply = 1;
		if (!(dispmode & SCRN_BANK1)) {
			dispp = &GRP_RAM[GRAM_BANK0];
			dispp2 = &GRP_RAM[GRAM_BANK1];
			dispflg = UPDATE_VRAM0;
		}
		else {
			dispp = &GRP_RAM[GRAM_BANK1];
			dispp2 = &GRP_RAM[GRAM_BANK0];
			dispflg = UPDATE_VRAM1;
		}
	}
	if (scrnallflash) {
		scrnallflash = 0;
		fillupdatetmp();
		x1vram_adjust();
		scrnflash = 1;
	}
	if (doubleatrchange) {
		flashupdatetmp();
		doubleatrchange = 0;
	}
	if (palandply) {
		palandply = 0;
		palettes();
		ddrawflash = 1;
	}
	if (blinkflag) {
		updateblink();
	}

	if (scrnflash) {
		scrnflash = 0;
		switch(lastdisp & SCRN64_MASK) {
			case SCRN64_320x200:
				width40x25_64s();
				disableraster = 1;
				break;
			case SCRN64_L320x200x2:
				width40x25_64x2();
				disableraster = 1;
				break;
			case SCRN64_L640x200:
				width80x25_64s();
				disableraster = 1;
				break;
			case SCRN64_H320x400:
				width40x25_64h();
				disableraster = 1;
				break;
			case SCRN64_320x200x4096:
				width40x25_4096();
				disableraster = 1;
				break;
			case SCRN64_320x100:
				width40x12_64l();
				disableraster = 1;
				break;
			case SCRN64_320x100x2:
				width40x12_64x2();
				disableraster = 1;
				break;
			case SCRN64_L640x100:
				width80x12_64s();
				disableraster = 1;
				break;
			case SCRN64_H320x200:
				width40x12_64h();
				disableraster = 1;
				break;
			case SCRN64_320x100x4096:
				width40x12_4096();
				disableraster = 1;
				break;
//			case SCRN64_INVALID:
			default:
				if (keylog_enabled()) {
					keylog_printf("DRAW path SCRN64_INVALID underline=%d idx=%d",
						((crtc.SCRN_BITS & SCRN_UNDERLINE) != 0),
						(crtc.SCRN_BITS & 7));
				}
				if (!(crtc.SCRN_BITS & SCRN_UNDERLINE)) {
					screendraw[crtc.SCRN_BITS & 7]();
				}
				else {
					screendraw2[crtc.SCRN_BITS & 7]();
				}
				disableraster = 0;
				break;
		}
		ddrawflash = 1;
	}
	disp_flashscreen = xmilcfg.DRAW_SKIP | disableraster;

	if (ddrawflash) {
		if (disp_flashscreen) {
			ddrawflash = 0;
#if T_TUNE
			ddraws_cliparea();
			ddraws_infodraw();
#endif
			ddraws_draws();
			ddraws_drawall();
			drawtime++;
		}
	}
	else {
		ddrawflash = ddraws_restore();
	}
	ddraws_dispclock();
}



void scrnupdate1line(DWORD line) {

	if (line < drawlines) {
		if (palandply) {
			palandply = 0;
			palettes();
			ddrawflash = 1;
		}
		ddrawflash |= ddraws_draw1(line*2);
		ddrawflash |= ddraws_draw1(line*2+1);
	}
}

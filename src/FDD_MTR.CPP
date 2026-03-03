#include	<windows.h>
#include	"xmil.h"
#include	"x1.h"
#include	"x1_fdc.h"
#include	"dsounds.h"
#include	"state_save.h"

extern	FDC_REGS	FDC;
		BYTE		curevent = 0;
		DWORD		nextevent = 0;
		BYTE		FDC_HEAD[4] = {0, 0, 0, 0};
		DWORD		FDC_TIME[4] = {0, 0, 0, 0};
		short		curdrv = 0;

#define		MOVE1TCK_MS		30 
#define		MOVEMOTOR1_MS	30
#define		SEKSEC_MS		20

void fddmtr_event(void) {

	switch(curevent) {
		case 100:
			WAVE_STOP(0);
			nextevent += MOVEMOTOR1_MS;
			curevent = 1;
			break;
		case 80:
			curevent = 0;
			break;
		default:
			curevent = 0;
			break;
	}
}



void fddmtr_init(void) {

	fddmtr_event();
	memset(FDC_HEAD, 24, sizeof(FDC_HEAD));
	ZeroMemory(FDC_TIME, sizeof(FDC_TIME));
}

void fddmtr_callback(DWORD time) {

	if ((curevent) && (time >= nextevent)) {
		fddmtr_event();
	}
}

void fddmtr_drvset(void) {

	curdrv = FDC.drv;
	if ((!FDC_TIME[curdrv]) && (!FDC.motor)) {
		FDC_TIME[curdrv] = GetTickCount() + 5000;
	}
	else if ((FDC_TIME[curdrv]) && (FDC.motor)) {
		if (FDC_TIME[curdrv] < GetTickCount()) {
			FDC_HEAD[curdrv] = 24;
		}
		FDC_TIME[curdrv] = 0;
	}
}

void fddmtr_motormove(void) {

	int		regmove;

	regmove = FDC_HEAD[curdrv] - FDC.c;
	FDC_HEAD[curdrv] = FDC.c;
	if ((!xmilcfg.MOTOR) || (xmilcfg.NOWAIT)) {
		return;
	}
	if (regmove < 0) {
		regmove *= (-1);
	}
	if (regmove == 1) {
		if (curevent < 80) {
			fddmtr_event();
			WAVE_PLAY(1, 0);
			curevent = 80;
			nextevent = GetTickCount() + MOVEMOTOR1_MS;
		}
	}
	else if (regmove) {
		if (curevent < 100) {
			fddmtr_event();
			WAVE_PLAY(0, 1);
			curevent = 100;
			nextevent = GetTickCount() + regmove * MOVE1TCK_MS;
		}
	}
}

void fddmtr_waitsec(BYTE value) {

	if ((!xmilcfg.MOTOR) || (xmilcfg.NOWAIT)) {
		return;
	}
	if ((FDC.r != value) && (curevent < 1)) {
		fddmtr_event();
		curevent = 1;
		nextevent = GetTickCount() + SEKSEC_MS;
	}
}

/* ---- state save / load ---- */

int fddmtr_save_state(BYTE *buf, int maxlen) {
	int pos = 0;

	SS_WRITE_U8(buf, pos, curevent);
	/* nextevent: save as delta from GetTickCount() */
	{
		int32_t delta = (int32_t)(nextevent - GetTickCount());
		SS_WRITE_I32(buf, pos, delta);
	}
	SS_WRITE(buf, pos, FDC_HEAD, sizeof(FDC_HEAD));
	/* FDC_TIME[4]: 0 means inactive, otherwise save as delta */
	{
		int i;
		DWORD now = GetTickCount();
		for (i = 0; i < 4; i++) {
			if (FDC_TIME[i] == 0) {
				int32_t zero = 0;
				SS_WRITE_I32(buf, pos, zero);
			} else {
				int32_t delta = (int32_t)(FDC_TIME[i] - now);
				SS_WRITE_I32(buf, pos, delta);
			}
		}
	}
	{
		int16_t drv = (int16_t)curdrv;
		SS_WRITE_VAL(buf, pos, drv);
	}

	return pos;
}

int fddmtr_load_state(const BYTE *buf, int len) {
	int pos = 0;

	SS_READ_U8(buf, pos, curevent);
	/* nextevent: restore from delta */
	{
		int32_t delta;
		SS_READ_I32(buf, pos, delta);
		nextevent = (DWORD)(GetTickCount() + delta);
	}
	SS_READ(buf, pos, FDC_HEAD, sizeof(FDC_HEAD));
	/* FDC_TIME[4] */
	{
		int i;
		DWORD now = GetTickCount();
		for (i = 0; i < 4; i++) {
			int32_t delta;
			SS_READ_I32(buf, pos, delta);
			if (delta == 0) {
				FDC_TIME[i] = 0;
			} else {
				FDC_TIME[i] = (DWORD)(now + delta);
			}
		}
	}
	{
		int16_t drv;
		SS_READ_VAL(buf, pos, drv);
		curdrv = (short)drv;
	}

	return 0;
}


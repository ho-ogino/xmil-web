#include	<windows.h>
#include	<stdint.h>

#include	"common.h"
#include	"fdd_mtr.h"
#include	"dclock.h"
#include	"state_save.h"

static	WORD		timercnt = 0;
static	int		timer_phase_cnt = 0;

	DWORD	tick = 0;

void timer_init(int time) {

	tick = GetTickCount();
}

void timer_setcount(WORD value) {

	timercnt = value;
}

WORD timer_getcount(void) {

		DWORD	ticknow;
		DWORD	span;
		DWORD	steps;

static	BYTE	cnt3[4] = {16,17,17,0};

	ticknow = GetTickCount();

	span = ticknow - tick;
	if (span) {
		FDDMTR_CALLBACK(ticknow);
		dclock_callback();
		if (span >= 50) {
			steps = span / 50;
			span %= 50;
			timercnt += (WORD)(steps * 3);
			tick += (steps * 50);
		}
		while(span >= cnt3[timer_phase_cnt]) {
			span -= cnt3[timer_phase_cnt];
			tick += cnt3[timer_phase_cnt];
			timercnt++;
			if (++timer_phase_cnt >= 3) {
				timer_phase_cnt = 0;
			}
		}
	}
	return(timercnt);
}

void timer_term(void) {

}

/* ---- state save/load (delta for GetTickCount-based values) ---- */

int timer_save_state(BYTE *buf, int maxlen)
{
	int pos = 0;
	DWORD now = GetTickCount();
	int32_t delta_tick = (int32_t)(tick - now);

	SS_WRITE_VAL(buf, pos, timercnt);
	SS_WRITE_I32(buf, pos, delta_tick);
	SS_WRITE_I32(buf, pos, timer_phase_cnt);
	return pos;
}

int timer_load_state(const BYTE *buf, int len)
{
	int pos = 0;
	DWORD now = GetTickCount();
	int32_t delta_tick;

	SS_READ_VAL(buf, pos, timercnt);
	SS_READ_I32(buf, pos, delta_tick);
	tick = (DWORD)(now + delta_tick);
	/* timer_phase_cnt: forward-compatible (absent in older saves) */
	if (len >= 4 && pos <= len - 4) {
		SS_READ_I32(buf, pos, timer_phase_cnt);
		if (timer_phase_cnt < 0 || timer_phase_cnt > 2) timer_phase_cnt = 0;
	} else {
		timer_phase_cnt = 0;
	}
	return 0;
}


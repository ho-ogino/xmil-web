#include	<windows.h>

#include	"common.h"
#include	"x1.h"
#include	"dosio.h"
#include	"parts.h"


typedef struct {
	WORD	year;
	BYTE	month;
	BYTE	day;
	BYTE	hour;
	BYTE	minute;
	BYTE	second;
	BYTE	weekday;
} CALENDER;

static	CALENDER	dt;
static	BYTE		days[12] = {31, 28, 31, 30, 31, 30,
								31, 31, 30, 31, 30, 31};

void clndr_inc(void) {

	if (++dt.second < 60) {
		return;
	}
	dt.second = 0;
	if (++dt.minute < 60) {
		return;
	}
	dt.minute = 0;
	if (++dt.hour < 24) {
		return;
	}
	dt.hour = 0;
	if (dt.month == 2) {
		if (dt.year & 3) {					// 上２桁ってないぢゃん
			days[1] = 28;
		}
		else {
			days[1] = 29;
		}
	}
	dt.weekday = (BYTE)((dt.weekday + 1) % 7);
	if (++dt.day < days[dt.month-1]) {
		return;
	}
	dt.day = 1;
	if (++dt.month <= 12) {
		return;
	}
	dt.month = 1;
	dt.year++;
}

void clndr_getdate(BYTE *str) {

	*str++ = AdjustAfterMultiply((BYTE)(dt.year % 100));
	*str++ = (BYTE)((dt.month << 4) + dt.weekday);
	*str   = AdjustAfterMultiply(dt.day);
}

void clndr_setdate(BYTE *str) {

	if ((dt.year = 1900+AdjustBeforeDivision(*str++)) < 1980) {
		dt.year += 100;
	}
	dt.weekday = (BYTE)(*str & 0x0f);
	dt.month = (BYTE)(*str++ >> 4);
	dt.day = AdjustBeforeDivision(*str);
}

void clndr_gettime(BYTE *str) {

	*str++ = AdjustAfterMultiply(dt.hour);
	*str++ = AdjustAfterMultiply(dt.minute);
	*str   = AdjustAfterMultiply(dt.second);
}

void clndr_settime(BYTE *str) {

	dt.hour   = AdjustBeforeDivision(*str++);
	dt.minute = AdjustBeforeDivision(*str++);
	dt.second = AdjustBeforeDivision(*str);
}


void clndr_init(void) {

	BYTE	work[3];

	dosdateset(work);
	clndr_setdate(work);
	dostimeset(work);
	clndr_settime(work);
}

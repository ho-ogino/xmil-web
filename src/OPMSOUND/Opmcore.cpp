#include	<windows.h>
#include	"stdio.h"
#include	"common.h"
#include	"dsounds.h"
#include	"opm.h"
#include	"opmcore.h"
#include	"ay8910.h"
#include	"fm.h"
#include	"xmil.h"
#include	"x1_event.h"

#include	"x1.h"
#include	"state_save.h"

WORD	inx1f_counter;
static	DWORD	pcmmakepos;
void *errorlog;

static void timer_callback_2151(int param)
{
	YM2151TimerOver(0,param);
}

static EVENT Timer[2] = 
{	EVENT_VALUE("FM TimerA",0,timer_callback_2151,0),EVENT_VALUE("FM TimerB",0,timer_callback_2151,1) };


/* TimerHandler from fm.c */
static void TimerHandler(int n,int c,int count,double stepTime)
{
	if( count == 0 )
	{	/* Reset FM Timer */
		event_remove(&Timer[c]);
	}
	else
	{	/* Start FM Timer */
		double timeSec = (double)count * stepTime;
		EV_TIME expire = (EV_TIME)(timeSec*TIME_IN_SEC(1));
		event_set (&Timer[c],expire);
	}
}

void INX1F_init(void)
{
	AY8910_init(2000000,xmilcfg.samplingrate);
	OPMInit(1,4000000,xmilcfg.samplingrate,TimerHandler,NULL);

	INX1F_reset();
	pcmmakepos = 0;
};

void INX1F_reset(void)
{
	AY8910_set_clock(2000000,xmilcfg.samplingrate);
	AY8910_reset();
	YM2151SetClock(0,4000000,xmilcfg.samplingrate);
	OPMResetChip(0);
}

// make OSC DATA  stereo 16bit
void INX1F_makesample(DWORD samplecount)
{
	INT32 *buf;
	INT16 *buf_array[2];

	if(!samplecount)
		return;

	if(pcmmakepos >= pcmfreemax)
		return;

	if(samplecount > (pcmfreemax - pcmmakepos) )
		samplecount = pcmfreemax - pcmmakepos;

	buf = ((INT32 *)pcmbuffer);//+pcmmakepos;
	buf += pcmmakepos;

	AY8910Update(buf,samplecount);
	buf_array[0] = (INT16 *)buf;
	if (x1flg.SOUND_SW)
		OPMUpdateOne(0,buf_array,samplecount);

	pcmmakepos += samplecount;
}

void INX1F_resetsamplepos(void)
{
	pcmmakepos = 0;
}

void INX1F_PSGmode(BYTE withpuchinoise)
{
	AY8910_set_puchi_noize(withpuchinoise);
}

void INX1F_PSGctrl(BYTE reg, BYTE value)
{
	AY8910Write(0,reg);
	AY8910Write(1,value);
}

void INX1F_OPMctrl(BYTE reg, BYTE value)
{
	YM2151Write(0,0,reg);
	YM2151Write(0,1,value);
}

void INX1F_logging(void)
{
}
void INX1F_alltrash(void)
{
}

void YM2151UpdateRequest(int mum)
{
}

/* ---- state save/load ---- */

int opmcore_save_state(BYTE *buf, int maxlen)
{
	int pos = 0;
	SS_WRITE_VAL(buf, pos, inx1f_counter);
	SS_WRITE_VAL(buf, pos, pcmmakepos);

	/* Timer[0] and Timer[1] events */
	for (int i = 0; i < 2; i++) {
		BYTE active = (Timer[i].next != NULL) ? 1 : 0;
		SS_WRITE_U8(buf, pos, active);
		if (active) {
			EV_TIME tl = event_timeleft(&Timer[i]);
			SS_WRITE_VAL(buf, pos, tl);
			SS_WRITE_VAL(buf, pos, Timer[i].interval);
		}
	}
	return pos;
}

int opmcore_load_state(const BYTE *buf, int len)
{
	int pos = 0;
	SS_READ_VAL(buf, pos, inx1f_counter);
	SS_READ_VAL(buf, pos, pcmmakepos);

	/* Timer[0] and Timer[1] events — read first, then apply */
	for (int i = 0; i < 2; i++) {
		BYTE active;
		EV_TIME tl = 0, interval = 0;
		SS_READ_U8(buf, pos, active);
		if (active) {
			SS_READ_VAL(buf, pos, tl);
			SS_READ_VAL(buf, pos, interval);
		}
		event_clear(&Timer[i]);
		if (active) {
			Timer[i].interval = interval;
			Timer[i].callback = timer_callback_2151;
			Timer[i].callback_param = i;
			event_set(&Timer[i], tl);
		}
	}
	return 0;
}

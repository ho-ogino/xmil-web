#if T_TUNE
#include	<windows.h>
#include	<stdio.h>
#include	<string.h>
#include	"x1.h"
#include	"x1_ctc.h"

#include	"x1_irq.h"

#include	"dosio.h"
#include	"trace.h"
#include	"state_save.h"


/***********************************************************************
	CTC
***********************************************************************/


typedef struct {
	BYTE	device;		/* device number of daisy chain   */
	BYTE	value[4];	/* command value          */
	WORD	count[4];	/* time counstant (1-256) */
	EV_TIME basetime[4];/* interval of count down */
	EVENT	event[4];	/* event timer     */
	BYTE	vector;
} CTC_TABLE;

		CTC_TABLE	CTC[3];
extern	Z80_Regs	R;

static const char *ctc_event_name[3*4] =
{
	"CTC0.0","CTC0.1","CTC0.2","CTC0.3",
	"CTC1.0","CTC1.1","CTC1.2","CTC1.3",
	"CTC2.0","CTC2.1","CTC2.2","CTC2.3"
};

/* event callback: timer overflow */
static void ctc_int_callback(int device)
{
	Z80_set_irq_line((BYTE)device);
}

static BYTE ctc_vector_r(BYTE device)
{
	int chip;
	int ch;

	/* chip */
	if( (device >= CTC[0].device) && (device <= CTC[0].device+3) )
		chip = 0;
	else if( (device >= CTC[1].device) && (device <= CTC[1].device+3) )
		chip = 1;
	else
		chip = 2;
	/* channel */
	ch = 3-(device - CTC[chip].device);

	Z80_set_ieo_line(device);
	Z80_clear_irq_line(device);

	return CTC[chip].vector | (ch<<1);
}

void init_ctc(void)
{
	int chip,ch;
	ZeroMemory(CTC, sizeof(CTC));

	CTC[0].device = DEVICE_CTC0;
	CTC[1].device = DEVICE_CTC1;
	CTC[2].device = DEVICE_CTC2;
	for(chip=0; chip<=2; chip++)
	{
		for(ch=0;ch<4;ch++)
		{
			CTC[chip].value[ch] = 0x03;
			/* callback parmeter is IRQ device number */
			CTC[chip].event[ch].name = ctc_event_name[chip*4+ch];
			CTC[chip].event[ch].callback_param = CTC[chip].device + (3-ch);
			/* daisy chain */
			Z80_setup_irq_handler(CTC[chip].device+(3-ch),ctc_vector_r,Z80_clear_ieo_line);
		}
	}
}

/* update interval time and event timer */
static void ctc_update(CTC_TABLE *ctc,BYTE ch)
{
	EV_TIME interval,clkin,basetime =0;

	BYTE value = ctc->value[ch];

	/* calcrate input source clock */
	if( !(value & 0x02) )
	{
		switch(ch)
		{
		case 1:
		case 2:
			clkin = TIME_IN_HZ(2000000);// CH1,2 : 2MHz
			break;
		case 3:
			clkin = ctc->basetime[0] * ctc->count[0];	// CH3 <- ZC/TO0
			break;
		default:
			//CH.0はＶＣＣ接続なので動作しない
			clkin = 0;
		}
		if(value & 0x40)
		{	/* counter mode */
			basetime = clkin;
		}
		else
		{	/* timer mode */
			if( !(value&0x08) || clkin)
			{
				//タイマーソースはＣＰＵ速度には依存せず、４ＭＨｚ固定！
				basetime = TIME_IN_HZ(4000000) * (value&0x20 ? 256:16);
			}
		}
	}
	else
	{
		/* clear pending irq */
		Z80_clear_irq_line(ctc->device + (3-ch) );
	}

	ctc->basetime[ch] = basetime;

	/* output interval time */
	interval = basetime * ctc->count[ch];

	if(interval == 0)
	{	/* stop */
		event_remove(&ctc->event[ch]);
	}
	else
	{
		if( value & 0x80)
		{	/* with interrupt */
			ctc->event[ch].callback = ctc_int_callback;
		}
		else
		{	/* without interrupt */
			ctc->event[ch].callback = NULL;

			/* clear pending irq */
			Z80_clear_irq_line(ctc->device + (3-ch) );
			/* オーバーヘッドを減らす為、１秒付近へ倍数化  */
			/* interval *= (TIME_IN_SEC(1) / interval); */
		}
		/* イベントを仕掛ける */
		ctc->event[ch].interval = interval;
		event_set(&ctc->event[ch],interval);
	}
	/* if CH0 then recalc CH3 because cascade connection */
	if(ch==0)
		ctc_update(ctc,3);
}

//----------------------------------------------------------------------

CTC_TABLE *ctctablep(WORD port) {

	port &= 0xfffc;
	if (port == 0x1fa0) {
		return(CTC);
	}
	if (port == 0x1fa8) {
		return(&CTC[1]);
	}
	if ((x1flg.SOUND_SW) && (port == 0x0704)) {
		return(&CTC[2]);
	}
	return(NULL);
}

X1_IOW x1_ctc_w(WORD port, BYTE value) {

	CTC_TABLE	*ctc;
	WORD		p = port;

	if ((ctc = ctctablep(port)) == NULL) {
		return;
	}
	port &= 0x0003;
	if (ctc->value[port] & 0x04)
	{	/* time constant */
		ctc->count[port] = value ? value : 0x100;
		ctc->value[port] &= (BYTE)~0x06;
		ctc_update(ctc,(BYTE)port);
	}
	else if (value & 1)
	{	/* mode */
		if( ctc->value[port] != value)
		{
			ctc->value[port] = value;
			ctc_update(ctc,(BYTE)port);
		}
	}
	else
	{	/* vector */
		ctc->vector = value & 0xf8;
	}
}

X1_IOR x1_ctc_r(WORD port) {

	CTC_TABLE	*ctc;
	EV_TIME timeleft;

	if ((ctc = ctctablep(port)) == NULL) {
		return 0xff;
	}

	port &= 3;
	if( !event_enabled(&ctc->event[port]) )
		return (BYTE)ctc->count[port];

	/* return 'now' counter by event timer */
	timeleft = event_timeleft(&ctc->event[port]);
	return (BYTE)((timeleft/ctc->basetime[port]) % ctc->count[port] +1);
}

/* ---- state save/load ---- */

int ctc_save_state(BYTE *buf, int maxlen)
{
	int pos = 0;
	int chip, ch;

	for (chip = 0; chip < 3; chip++) {
		SS_WRITE_U8(buf, pos, CTC[chip].device);
		SS_WRITE(buf, pos, CTC[chip].value, 4);
		SS_WRITE(buf, pos, CTC[chip].count, sizeof(CTC[chip].count));
		SS_WRITE(buf, pos, CTC[chip].basetime, sizeof(CTC[chip].basetime));
		SS_WRITE_U8(buf, pos, CTC[chip].vector);

		for (ch = 0; ch < 4; ch++) {
			BYTE active = (CTC[chip].event[ch].next != NULL) ? 1 : 0;
			SS_WRITE_U8(buf, pos, active);
			if (active) {
				EV_TIME tl = event_timeleft(&CTC[chip].event[ch]);
				SS_WRITE_VAL(buf, pos, tl);
				SS_WRITE_VAL(buf, pos, CTC[chip].event[ch].interval);
				SS_WRITE_VAL(buf, pos, CTC[chip].event[ch].callback_param);
				BYTE has_cb = (CTC[chip].event[ch].callback != NULL) ? 1 : 0;
				SS_WRITE_U8(buf, pos, has_cb);
			}
		}
	}
	return pos;
}

int ctc_load_state(const BYTE *buf, int len)
{
	int pos = 0;
	int chip, ch;

	for (chip = 0; chip < 3; chip++) {
		SS_READ_U8(buf, pos, CTC[chip].device);
		SS_READ(buf, pos, CTC[chip].value, 4);
		SS_READ(buf, pos, CTC[chip].count, sizeof(CTC[chip].count));
		SS_READ(buf, pos, CTC[chip].basetime, sizeof(CTC[chip].basetime));
		SS_READ_U8(buf, pos, CTC[chip].vector);

		for (ch = 0; ch < 4; ch++) {
			BYTE active;
			EV_TIME tl = 0, interval = 0;
			int cb_param = 0;
			BYTE has_cb = 0;
			SS_READ_U8(buf, pos, active);
			if (active) {
				SS_READ_VAL(buf, pos, tl);
				SS_READ_VAL(buf, pos, interval);
				SS_READ_VAL(buf, pos, cb_param);
				SS_READ_U8(buf, pos, has_cb);
			}
			/* all reads succeeded — now apply side effects */
			event_clear(&CTC[chip].event[ch]);
			if (active) {
				CTC[chip].event[ch].interval = interval;
				CTC[chip].event[ch].callback_param = cb_param;
				CTC[chip].event[ch].callback = has_cb ? ctc_int_callback : NULL;
				event_set(&CTC[chip].event[ch], tl);
			}
		}
	}
	return 0;
}

#else //T_TUNE
#include "x1_ctc.cpp_"
#endif //T_TUNE

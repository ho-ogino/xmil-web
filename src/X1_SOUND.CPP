#include	<windows.h>

#include	"xmil.h"
#include	"dinputs.h"
#include	"x1.h"
#include	"dsounds.h"
#include	"opm.h"
#include	"state_save.h"

	BYTE	changehz = 0;
	BYTE	psg[0x10];
	BYTE	psgreg = 0;
	BYTE	opmreg = 0;

#define	key_4	0x4b
#define	key_6	0x4d
#define	key_8	0x48
#define	key_2	0x50
#define	key_sp	0x39
#define	key_et	0x1c
#define	key_x	0x2d
#define	key_z	0x2c
#define	key_up	0xc8
#define	key_rt	0xcd
#define	key_lt	0xcb
#define	key_dn	0xd0
#define	key_c	0x2e
#define	key_v	0x2f

const	BYTE	joybitdata[16] = {
					key_c,	key_c,		key_sp,	key_x,
					key_et,	key_z,		key_v,	key_v,
					key_rt,	key_6,		key_lt,	key_4,
					key_dn,	key_2,		key_up,	key_8};

/*-----------------------------------------------------------*/
typedef DWORD SAMPLE_POS_TYPE;

static SAMPLE_POS_TYPE stream_avaiable;
static SAMPLE_POS_TYPE update_mergin;

void x1_sound_init(DWORD resolitionHz)
{
	//stream_avaiable = 0;
	/* convert minimum update mergin (Hz) to (Num of Buffers) */
	update_mergin = (SAMPLE_POS_TYPE)(ds_rate / resolitionHz);
}

/* sound stream update */
void x1_sound_update_frame(void)
{
	if(stream_avaiable < framesoundcnt)
		STREAM_MAKES( framesoundcnt-stream_avaiable );
	stream_avaiable = 0;
}

/* sound stream update when sound chip changed */
static void sound_update(void)
{
	SAMPLE_POS_TYPE now_pos;

	now_pos = (DWORD)(get_frame_pos() / (V_SYNC_event.interval/framesoundcnt) );
	if(now_pos > framesoundcnt)
		now_pos = framesoundcnt;

	/* check update mergin */
	if( now_pos > stream_avaiable+update_mergin)
	{
		/* update stream buffer */
		STREAM_MAKES(now_pos - stream_avaiable);
		stream_avaiable = now_pos;
	}
}

/*-----------------------------------------------------------*/

void x1_psg_reset(void) {

	if (changehz) {
		changehz = 0;
		STREAM_TERM();
		STREAM_CREATE();

		stream_avaiable = 0;
	}
	INX1F_reset();
	opmreg = 0;
	psgreg = 0;
}

void x1_psg_stop(void) { }
void x1_psg_cont(void) { }

X1_IOW x1_psg_reg(WORD port, BYTE value) {

	psgreg = value;
}

X1_IOW x1_psg_dat(WORD port, BYTE value) {

	if (psgreg < 0x0e) {
		sound_update();
		psg[psgreg] = value;
		INX1F_PSGctrl(psgreg, value);
	}
}

BYTE joy_key(void) {

		BYTE	ret = 0xff;
		BYTE	bit;
		BYTE	*p = (BYTE *)joybitdata;
extern	BYTE	KEY_TBL[];

	for(bit=0x80; bit; bit>>=1, p+=2) {
		if (KEY_TBL[*p] || KEY_TBL[*(p+1)]) {
			ret ^= bit;
		}
	}
	return(ret);
}

X1_IOR x1_psg_sta(WORD port) {

static	BYTE	rapids = 0;

	if (psgreg < 0x0e) {
		return(psg[psgreg]);
	}
	if (psgreg < 0x10) {
		BYTE ret = 0xff;
		if (psgreg == (xmilcfg.KEY_MODE + 0x0d)) {
			ret &= joy_key();
		}
		if (psgreg == 0x0e) {
			ret &= joy_getflag();
		}
		if (xmilcfg.BTN_RAPID) {
			rapids ^= 0x60;
			ret |= rapids;
		}
		if (xmilcfg.BTN_MODE) {
			BYTE bit1 = (ret & 0x40) >> 1;
			BYTE bit2 = (ret & 0x20) << 1;
			ret = (ret & (~0x60)) | bit1 | bit2;
		}
		return(ret);
	}
	return(0xff);
}




void x1_opm_reset(void) { }
void x1_opm_stop(void) { }
void x1_opm_cont(void) { }

X1_IOW x1_opm_reg(WORD port, BYTE value) {

	opmreg = value;
}
X1_IOW x1_opm_dat(WORD port, BYTE value) {

	sound_update();
	INX1F_OPMctrl(opmreg, value);
}

X1_IOR x1_opm_stat(WORD port) {

	if (x1flg.SOUND_SW) {
		return(0x00);								// ゼリアード対策
	}
	return(0xff);
}

/* ---- state save/load ---- */

int snd_save_state(BYTE *buf, int maxlen)
{
	int pos = 0;
	SS_WRITE(buf, pos, psg, sizeof(psg));
	SS_WRITE_U8(buf, pos, psgreg);
	SS_WRITE_U8(buf, pos, opmreg);
	SS_WRITE_U8(buf, pos, changehz);
	return pos;
}

int snd_load_state(const BYTE *buf, int len)
{
	int pos = 0;
	SS_READ(buf, pos, psg, sizeof(psg));
	SS_READ_U8(buf, pos, psgreg);
	SS_READ_U8(buf, pos, opmreg);
	SS_READ_U8(buf, pos, changehz);
	return 0;
}

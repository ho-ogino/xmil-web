#if T_TUNE
/* ＳＩＯ全面書き直し */

#include	<windows.h>
#include	"x1.h"
#include	"xmil.h"
#include	"x1_sio.h"
#include	"mouses.h"
#include	"x1_irq.h"
#include	"state_save.h"

/***********************************************************************
	ＳＩＯ
***********************************************************************/

/* daisychain IRQ number */
#define SIO_TX_IRQ(ch) (4-(ch*4))
#define SIO_ST_IRQ(ch) (5-(ch*4))
#define SIO_RX_IRQ(ch) (6-(ch*4))
#define SIO_SP_IRQ(ch) (7-(ch*4))

typedef struct {
	BYTE device;	/* IRQ device No. */
	short	ptr;	/* pointer */
	BYTE	wr[8];
	BYTE	rr[4];
	BYTE	rxd[3]; /* RX data  */
	BYTE	rxd_c;  /* RX count */
	WORD	rxd_sr; /* RX data  shift register */
	WORD	rxd_sc; /* RX data  shift register */
	int		nextirq;/* RX next RX interrupt enable */
	BYTE	txd;    /* TX data  */
	WORD	txd_sr; /* TX data shift register */
	WORD	txd_sc; /* TX data shift register counter */
} SIO_REGS;

typedef struct {
	BYTE	device;
	BYTE	irq_int;
	BYTE	irq_ieo;
	SIO_REGS ch[2];
}Z80SIO;

static	Z80SIO	sio;

#define SIODBG(...) do {} while (0)

/***********************************************************************
	デイジーチェーン割り込み
***********************************************************************/

static const int vector_offset[8] =
{  /* lowerst */
	0x02, /* CHB ST IRQ */
	0x00, /* CHB TX IRQ */
	0x04, /* CHB RX IRQ */
	0x06, /* CHB SP IRQ */
	0x0a, /* CHA ST IRQ */
	0x08, /* CHA TX IRQ */
	0x0c, /* CHA RX IRQ */
	0x0e  /* CHA RX IRQ */
}; /* highest */

/* 保留中の割り込みベクタをCHB.RR2にセットする */
static BYTE sio_get_pending_vector(Z80SIO *c)
{
	BYTE vector = c->ch[1].wr[2]; /* CH.B wr2 */
	int sel;

	if( (c->ch[1].wr[1] & 4) == 0 )
		return vector;

	/* ステータスアフェクツベクトル */
	for(sel=c->device+7 ; sel > c->device ; sel--)
	{
		int idx = sel - c->device;
		vector &= 0xf1 | vector_offset[idx];
		if( Z80_check_pending_irq(sel) )
			return vector | vector_offset[idx];
	}
	/* no pending irq */
	return vector | 0x06;
}

static BYTE sio_vector_r(BYTE device)
{
	BYTE vector = sio.ch[1].wr[2]; /* CH.B wr2 */

	/* ステータスアフェクツベクトル */
	if( sio.ch[1].wr[1]&4 )
		vector = (vector & 0xf1) | vector_offset[device-sio.device];
	/* assert IEO line */
	Z80_set_ieo_line(device);
	/* clear INT line */
	Z80_clear_irq_line(device);
	SIODBG("VECTOR fetch device=%d vector=%02X wr1=%02X wr2=%02X",
		(int)device, (unsigned int)vector,
		(unsigned int)sio.ch[1].wr[1], (unsigned int)sio.ch[1].wr[2]);
	/* return vector */
	return vector;
}

/***********************************************************************
	初期化
***********************************************************************/

void init_sio(void)
{
	int i;
	ZeroMemory(&sio, sizeof(sio));
	/* daisy chain */
	sio.device = DEVICE_SIO0;
	/* per-channel irq base */
	sio.ch[0].device = sio.device;
	sio.ch[1].device = sio.device;
	/* register all 8 SIO daisy-chain lines (CHB/CHA ST,TX,RX,SP) */
	for(i = 0; i < 8; i++) {
		Z80_setup_irq_handler((BYTE)(sio.device + i), sio_vector_r, Z80_clear_ieo_line);
	}
	SIODBG("init_sio device=%d ch0.device=%d ch1.device=%d",
		(int)sio.device, (int)sio.ch[0].device, (int)sio.ch[1].device);

}

/***********************************************************************
	receice data
***********************************************************************/

static void sio_rxdata_w(Z80SIO *c , int ch , BYTE data)
{
	SIO_REGS *r = &c->ch[ch];

	if (r->wr[3] & 0x01)/* enable receiver */
	{
		if (r->rxd_c == 3)
		{	/* RX overrun error */
			r->rr[1] |= 0x20; /* error flag */
			if (ch == 1) {
				SIODBG("RX overrun ch=%d data=%02X wr3=%02X rr0=%02X rr1=%02X",
					ch, (unsigned int)data, (unsigned int)r->wr[3],
					(unsigned int)r->rr[0], (unsigned int)r->rr[1]);
			}
				/* irq assert */
				if (ch == 1) {
					SIODBG("IRQ set SP ch=%d line=%d (base=%d)",
						ch, (int)(r->device + SIO_SP_IRQ(ch)), (int)r->device);
				}
				Z80_set_irq_line(r->device + SIO_SP_IRQ(ch) );
			}
		else
			{	/* RX buufer in */
				r->rxd[r->rxd_c++] = data;
				r->rr[0] |= 0x01;
				if (ch == 1) {
					SIODBG("RX push ch=%d data=%02X rxd_c=%d wr1=%02X rr0=%02X",
						ch, (unsigned int)data, (int)r->rxd_c,
						(unsigned int)r->wr[1], (unsigned int)r->rr[0]);
				}
				/* RX irq check */
				switch(r->wr[1] & 0x18)
				{
			case 0x08:
				if( !r->nextirq)
					break;
				r->nextirq=0;
				case 0x11:
				case 0x10:
					if (ch == 1) {
						SIODBG("IRQ set RX ch=%d line=%d (base=%d wr1=%02X)",
							ch, (int)(r->device + SIO_RX_IRQ(ch)), (int)r->device,
							(unsigned int)r->wr[1]);
					}
					Z80_set_irq_line(r->device + SIO_RX_IRQ(ch) );
				}
		}
	}
}

/* clear RX buffer/error/irq state for one channel */
static void sio_rxclear_w(Z80SIO *c , int ch)
{
	SIO_REGS *r = &c->ch[ch];

	r->rxd[0] = r->rxd[1] = r->rxd[2] = 0;
	r->rxd_c = 0;
	r->nextirq = 0;
	r->rr[0] &= ~0x01; /* RX ready off */
	r->rr[1] &= ~0x20; /* clear overrun error */

	/* clear stale RX/SP IRQ from previous packet */
	Z80_clear_irq_line(r->device + SIO_RX_IRQ(ch));
	Z80_clear_ieo_line(r->device + SIO_RX_IRQ(ch));
	Z80_clear_irq_line(r->device + SIO_SP_IRQ(ch));
	Z80_clear_ieo_line(r->device + SIO_SP_IRQ(ch));
}

static BYTE sio_rxdata_r(SIO_REGS *r)
{
	BYTE data = r->rxd[0];
	int ch = (r == &sio.ch[1]) ? 1 : 0;

	r->rxd[0] = r->rxd[1];
	r->rxd[1] = r->rxd[2];
	if(r->rxd_c)
		r->rxd_c--;
	if(!r->rxd_c)
		r->rr[0] &= ~0x01;

	/*
	 * RX IRQ is edge-like in this legacy implementation.
	 * If multiple bytes are already queued, re-assert RX IRQ after each read
	 * so the CPU can continue servicing remaining bytes.
	 */
	if(r->rxd_c > 0)
	{
		switch(r->wr[1] & 0x18)
		{
		case 0x08:
			if(!r->nextirq)
				break;
			r->nextirq = 0;
			/* fallthrough */
		case 0x10:
		case 0x18:
			Z80_set_irq_line(r->device + SIO_RX_IRQ(ch));
			if (ch == 1) {
				SIODBG("IRQ reassert RX ch=1 line=%d remain=%d wr1=%02X",
					(int)(r->device + SIO_RX_IRQ(ch)),
					(int)r->rxd_c, (unsigned int)r->wr[1]);
			}
			break;
		}
	}

	if (r == &sio.ch[1]) {
		SIODBG("RX read ch=1 data=%02X remain=%d rr0=%02X rr1=%02X",
			(unsigned int)data, (int)r->rxd_c,
			(unsigned int)r->rr[0], (unsigned int)r->rr[1]);
	}
	return data;
}

/* update RR0 modem status bits (DCD/CTS) */
static void sio_update_rr0_modem(SIO_REGS *r, int ch)
{
	/* RR0 bit3:DCD, bit5:CTS */
	if (ch == 1) {
		BYTE old_rr0 = r->rr[0];
		if (xmilcfg.MOUSE_SW) {
			/* mouse connected -> signals asserted (active-low => RR0 bits clear) */
			r->rr[0] &= ~(0x08 | 0x20);
		}
		else {
			/* mouse disabled -> disconnected */
			r->rr[0] |= (0x08 | 0x20);
		}
		if ((old_rr0 ^ r->rr[0]) & (0x08 | 0x20)) {
			SIODBG("RR0 modem ch=1 mouse_sw=%d rr0 %02X -> %02X",
				(int)xmilcfg.MOUSE_SW, (unsigned int)old_rr0, (unsigned int)r->rr[0]);
		}
	}
}

static void mouse_read(void);

/***********************************************************************
	Ｘ１から見たＩ／Ｏ
***********************************************************************/

X1_IOW x1_sio_w(WORD port, BYTE value)
{
	int ch = (port/2)&1;
	SIO_REGS *r = &sio.ch[ch];
	int sel;

	if(!(port&1))
	{	/* data */
		if( r->wr[3] & 0x08 ) /* TX enable? */
		{
			r->txd = value;
			/* clear TXbuffer emtpy */
			r->rr[0] &= ~0x04;
		}
	}
	else
	{	/* controll */
		BYTE oldval = r->wr[r->ptr];
		r->wr[r->ptr] = value;
		switch(r->ptr)
		{
		case 0: /* wr0 */
			r->ptr = value & 7;
			switch(value&0x38)
			{
			case 0x00: /* no operation */
			case 0x08: /* send abort */
			case 0x10: /* external/status reset */
				break;
			case 0x18: /* channel reset */
				for(sel=7-ch*4;sel>4-ch*4;sel--)
				{
					Z80_clear_irq_line(sio.device + sel);
					Z80_clear_ieo_line(sio.device + sel);
				}
				r->wr[0] = 0x00;
				r->wr[1] = 0x00;
				r->wr[2] = 0x00;
				r->wr[3] = 0x00;
				r->wr[4] = 0x00;
				r->wr[5] = 0x00;
				r->wr[6] = 0x00;
				r->wr[7] = 0x00;
				r->rr[0] = r->rr[0] & 0x28 | 0x04;
				r->rr[1] = r->rr[0] & 0x28 | 0x04;
				r->rr[2] = 0x00;
				break;
			case 0x20: /* next RX interrupt enable */
				r->nextirq=1;
				break;
			case 0x30: /* error reset */
				r->rr[0] &= 0x2f;
				r->rr[1] &= 0x01;
				break;
				case 0x38: /* RETI (chA only) */
					if(ch==0) {
						SIODBG("WR0 RETI ch=%d device=%d", ch, (int)sio.device);
						Z80_clear_ieo_line(sio.device);
					}
					break;
				}
			/* don't clear wr ptr */
			return;
		case 1: /* wr1 */
		case 2: /* wr2 */
		case 3: /* wr3 */
		case 4: /* wr4 */
			break;
			case 5: /* wr5 */
				/* RTS(WR5:BIT1)の立ち上がりで */
				/* マウスから３バイトのデータが送られてくる */
				if(ch==1 && (value&0x02&(value^oldval)) ) {
					SIODBG("WR5 RTS rise ch=1 old=%02X new=%02X wr3=%02X",
						(unsigned int)oldval, (unsigned int)value, (unsigned int)r->wr[3]);
					mouse_read();
				}
				break;
		case 6: /* wr6 */
		case 7: /* wr7 */
			break;
		}
		/* clear pointer */
		r->ptr = 0;
	}
}

X1_IOR x1_sio_r(WORD port)
{
	int ch = (port/2)&1;
	SIO_REGS *r = &sio.ch[ch];
	int data;

	if(!(port&1))
	{	/* data */
		if (ch == 1) {
			SIODBG("DATA read req ch=1 port=%04X rr0=%02X rxd_c=%d",
				(unsigned int)port, (unsigned int)r->rr[0], (int)r->rxd_c);
		}
		return sio_rxdata_r(r);
	}
	/* status */
	sio_update_rr0_modem(r, ch);
	switch(r->ptr)
	{
	case 2:
		if( ch==1)
			r->rr[2] = sio_get_pending_vector(&sio);
		break;
	}
	data = r->rr[r->ptr];
	if (ch == 1) {
		SIODBG("STATUS read ch=1 ptr=%d val=%02X rr0=%02X rr1=%02X rr2=%02X",
			(int)r->ptr, (unsigned int)data,
			(unsigned int)r->rr[0], (unsigned int)r->rr[1], (unsigned int)r->rr[2]);
	}
	r->ptr = 0;
	return data;
}

/***********************************************************************
	マウスの状態をＳＩＯのＦＩＦＯに送る
***********************************************************************/

static BYTE mouse_dat[3];

static void mouse_read(void) {

	short	mx, my;

	/* replace previous packet state before enqueueing 3 bytes */
	sio_rxclear_w(&sio, 1);

	mouse_dat[0] = mouse_posget(&mx, &my) & 3;

	if (mx > 127) {
		mouse_dat[1] = 0x7f;
		mouse_dat[0] |= 0x10;
	}
	else if (mx < -127) {
		mouse_dat[1] = 0x80;
		mouse_dat[0] |= 0x20;
	}
	else {
		mouse_dat[1] = (char)mx;
	}
	if (my > 127) {
		mouse_dat[2] = 0x7f;
		mouse_dat[0] |= 0x40;
	}
	else if (my < -127) {
		mouse_dat[2] = 0x80;
		mouse_dat[0] |= 0x80;
	}
	else {
		mouse_dat[2] = (char)my;
	}
	SIODBG("mouse_read btn=%02X mx=%d my=%d pkt=%02X %02X %02X",
		(unsigned int)(mouse_dat[0] & 0x03), (int)mx, (int)my,
		(unsigned int)mouse_dat[0], (unsigned int)mouse_dat[1], (unsigned int)mouse_dat[2]);
	/* send 3-byte mouse packet to RX FIFO on RTS edge */
	sio_rxdata_w(&sio , 1 , mouse_dat[0] );
	sio_rxdata_w(&sio , 1 , mouse_dat[1] );
	sio_rxdata_w(&sio , 1 , mouse_dat[2] );
}

/* ---- state save/load ---- */

int sio_save_state(BYTE *buf, int maxlen)
{
	int pos = 0;
	SS_WRITE(buf, pos, &sio, sizeof(sio));
	return pos;
}

int sio_load_state(const BYTE *buf, int len)
{
	int pos = 0;
	SS_READ(buf, pos, &sio, sizeof(sio));
	return 0;
}

#else /* T_TUNE */
#include "x1_sio.cpp_"
#endif /* T_TUNE */

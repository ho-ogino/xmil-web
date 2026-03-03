/*
	DaisyChain IRQ handler
*/
#include <windows.h>

#include "x1.h"
#include "x1_irq.h"
#include "keylog.h"
#include "state_save.h"

/* higher request device, and assert device */
static BYTE irq_request;
static BYTE irq_ieolock;

static BYTE irq_int[MAX_DAISY_CHAIN+1];
static BYTE irq_ieo[MAX_DAISY_CHAIN+1];
static IRQ_VECTOR irq_vector_r[MAX_DAISY_CHAIN+1];
static IRQ_RETI irq_reti[MAX_DAISY_CHAIN+1];

/* Update Z80 INT pin based on daisy-chain state.
   INT is a level-sensitive signal: asserted whenever a device
   requests an interrupt that is not blocked by a higher-priority IEO.
   The CPU checks IFF internally (chips z80.h handles this). */
static void irq_update_int_pin(void)
{
	Z80_assert_int(irq_request > irq_ieolock);
}

/* dummy handlers */
static BYTE dummy_vector_r(BYTE device)
{
	Z80_clear_irq_line(device);
	return 0xff;
}

static void dummy_reti(BYTE device)
{
}

/* Vector fetch — called from z80_wrapper handle_tick() at IORQ+M1 time.
   This is the correct timing: the CPU has acknowledged the interrupt and
   is requesting the vector on the data bus. The callback sets IEO lock
   and clears the device's IRQ line. */
BYTE Z80_irq_vector_fetch(void)
{
	if(irq_request == 0 || irq_request <= irq_ieolock)
		return 0xff;
	keylog_printf("IRQ VECTOR FETCH req=%u ieo=%u",
		(unsigned int)irq_request, (unsigned int)irq_ieolock);
	return (*irq_vector_r[irq_request])(irq_request);
}

/* Legacy check — now just ensures INT pin reflects current state.
   Vector fetch and IEO lock are handled by Z80_irq_vector_fetch()
   at the proper M1+IORQ timing. */
void __fastcall Z80_check_irq_line(void)
{
	irq_update_int_pin();
}

/* clear IEO lock */
void __fastcall Z80_irq_reti(void)
{
	(*irq_reti[irq_ieolock])(irq_ieolock);
}

void Z80_set_irq_line(BYTE device)
{
	irq_int[device] = 1;
	if (device == DEVICE_SUB) {
		keylog_printf("IRQ SET SUB req=%u ieo=%u",
			(unsigned int)irq_request, (unsigned int)irq_ieolock);
	}

	if(irq_request < device)
	{
		irq_request = device;
	}
	irq_update_int_pin();
}

void Z80_clear_irq_line(BYTE device)
{
	irq_int[device] = 0;
	if(irq_request == device)
	{
		/* search next IRQ device */
		while(--irq_request >0)
		{
			if(irq_int[irq_request])
				break;
		}
	}
	irq_update_int_pin();
}

void Z80_set_ieo_line(BYTE device)
{
	irq_ieo[device] = 1;

	if(irq_ieolock < device)
		irq_ieolock = device;
	keylog_printf("IEO SET dev=%u req=%u ieo=%u", (unsigned int)device,
		(unsigned int)irq_request, (unsigned int)irq_ieolock);
	irq_update_int_pin();
}

void Z80_clear_ieo_line(BYTE device)
{
	irq_ieo[device] = 0;
	if(irq_ieolock == device)
	{
		/* search next IEO device */
		while(--irq_ieolock >0)
		{
			if(irq_ieo[irq_ieolock])
				break;
		}
	}
	keylog_printf("IEO CLR dev=%u req=%u ieo=%u", (unsigned int)device,
		(unsigned int)irq_request, (unsigned int)irq_ieolock);
	irq_update_int_pin();
}

BYTE Z80_check_pending_irq(BYTE device)
{
	return irq_int[device];
}

/* set 'vector fetch' and 'RETI ditect' callback handler */
void Z80_setup_irq_handler(BYTE device,
							IRQ_VECTOR v_hndr,IRQ_RETI r_hndr)
{
	irq_vector_r[device] = v_hndr ? v_hndr : dummy_vector_r;
	irq_reti[device]   = r_hndr ? r_hndr : dummy_reti;
}

/* initialize */
void init_irq(void)
{
	int i;

	irq_request = irq_ieolock = 0;
	for(i=0; i<=MAX_DAISY_CHAIN; i++)
	{
		irq_int[i]= irq_ieo[i]= 0;
		irq_vector_r[i]    = dummy_vector_r;
		irq_reti[i]        = dummy_reti;
	}
	irq_update_int_pin();
}

/* ---- state save/load helpers ---- */

int irq_save_state(BYTE *buf, int maxlen) {
	int pos = 0;

	SS_WRITE_U8(buf, pos, irq_request);
	SS_WRITE_U8(buf, pos, irq_ieolock);
	SS_WRITE(buf, pos, irq_int, sizeof(irq_int));
	SS_WRITE(buf, pos, irq_ieo, sizeof(irq_ieo));

	return pos;
}

int irq_load_state(const BYTE *buf, int len) {
	int pos = 0;

	SS_READ_U8(buf, pos, irq_request);
	SS_READ_U8(buf, pos, irq_ieolock);
	SS_READ(buf, pos, irq_int, sizeof(irq_int));
	SS_READ(buf, pos, irq_ieo, sizeof(irq_ieo));

	// Refresh INT pin state from restored daisy-chain data
	irq_update_int_pin();

	return 0;
}

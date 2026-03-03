/***************************************************************************

  ay8910.c


  Emulation of the AY-3-8910 / YM2149 sound chip.

  Based on various code snippets by Ville Hallik, Michael Cuddy,
  Tatsuyuki Satoh, Fabrice Frances, Nicola Salmoria.

***************************************************************************/

#include "opmcore.h"
#include "ay8910.h"
#include "state_save.h"

#define MAX_OUTPUT (0x1fff)

#define STEP 0x2000


struct AY8910
{
	int register_latch;
	unsigned char Regs[16];
	UINT32 UpdateStep;
	int PeriodA,PeriodB,PeriodC,PeriodN,PeriodE;
	int CountA,CountB,CountC,CountN,CountE;
	unsigned int VolA,VolB,VolC,VolE;
	unsigned char EnvelopeA,EnvelopeB,EnvelopeC;
	unsigned char OutputA,OutputB,OutputC,OutputN;
	signed char CountEnv;
	unsigned char Hold,Alternate,Attack,Holding;
	UINT32 RNG;
	UINT32 VolTable[32];

	int puchi;
};

/* register id's */
#define AY_AFINE	(0)
#define AY_ACOARSE	(1)
#define AY_BFINE	(2)
#define AY_BCOARSE	(3)
#define AY_CFINE	(4)
#define AY_CCOARSE	(5)
#define AY_NOISEPER	(6)
#define AY_ENABLE	(7)
#define AY_AVOL		(8)
#define AY_BVOL		(9)
#define AY_CVOL		(10)
#define AY_EFINE	(11)
#define AY_ECOARSE	(12)
#define AY_ESHAPE	(13)

#define AY_PORTA	(14)
#define AY_PORTB	(15)


/* array of PSG's */
static struct AY8910 PSG;

void _AYWriteReg(int r, int v)
{
	int old;

	PSG.Regs[r] = v;

	/* A note about the period of tones, noise and envelope: for speed reasons,*/
	/* we count down from the period to 0, but careful studies of the chip     */
	/* output prove that it instead counts up from 0 until the counter becomes */
	/* greater or equal to the period. This is an important difference when the*/
	/* program is rapidly changing the period to modulate the sound.           */
	/* To compensate for the difference, when the period is changed we adjust  */
	/* our internal counter.                                                   */
	/* Also, note that period = 0 is the same as period = 1. This is mentioned */
	/* in the YM2203 data sheets. However, this does NOT apply to the Envelope */
	/* period. In that case, period = 0 is half as period = 1. */
	switch( r )
	{
	case AY_AFINE:
	case AY_ACOARSE:
		PSG.Regs[AY_ACOARSE] &= 0x0f;
		old = PSG.PeriodA;
		PSG.PeriodA = (PSG.Regs[AY_AFINE] + 256 * PSG.Regs[AY_ACOARSE]) * PSG.UpdateStep;
		if (PSG.PeriodA == 0) PSG.PeriodA = PSG.UpdateStep;
		PSG.CountA += PSG.PeriodA - old;
		if (PSG.CountA <= 0) PSG.CountA = 1;
		break;
	case AY_BFINE:
	case AY_BCOARSE:
		PSG.Regs[AY_BCOARSE] &= 0x0f;
		old = PSG.PeriodB;
		PSG.PeriodB = (PSG.Regs[AY_BFINE] + 256 * PSG.Regs[AY_BCOARSE]) * PSG.UpdateStep;
		if (PSG.PeriodB == 0) PSG.PeriodB = PSG.UpdateStep;
		PSG.CountB += PSG.PeriodB - old;
		if (PSG.CountB <= 0) PSG.CountB = 1;
		break;
	case AY_CFINE:
	case AY_CCOARSE:
		PSG.Regs[AY_CCOARSE] &= 0x0f;
		old = PSG.PeriodC;
		PSG.PeriodC = (PSG.Regs[AY_CFINE] + 256 * PSG.Regs[AY_CCOARSE]) * PSG.UpdateStep;
		if (PSG.PeriodC == 0) PSG.PeriodC = PSG.UpdateStep;
		PSG.CountC += PSG.PeriodC - old;
		if (PSG.CountC <= 0) PSG.CountC = 1;
		break;
	case AY_NOISEPER:
		PSG.Regs[AY_NOISEPER] &= 0x1f;
		old = PSG.PeriodN;
		PSG.PeriodN = PSG.Regs[AY_NOISEPER] * PSG.UpdateStep;
		if (PSG.PeriodN == 0) PSG.PeriodN = PSG.UpdateStep;
		PSG.CountN += PSG.PeriodN - old;
		if (PSG.CountN <= 0) PSG.CountN = 1;
		break;
	case AY_AVOL:
		PSG.Regs[AY_AVOL] &= 0x1f;
		PSG.EnvelopeA = PSG.Regs[AY_AVOL] & 0x10;
		PSG.VolA = PSG.EnvelopeA ? PSG.VolE : PSG.VolTable[PSG.Regs[AY_AVOL] ? PSG.Regs[AY_AVOL]*2+1 : 0];
		break;
	case AY_BVOL:
		PSG.Regs[AY_BVOL] &= 0x1f;
		PSG.EnvelopeB = PSG.Regs[AY_BVOL] & 0x10;
		PSG.VolB = PSG.EnvelopeB ? PSG.VolE : PSG.VolTable[PSG.Regs[AY_BVOL] ? PSG.Regs[AY_BVOL]*2+1 : 0];
		break;
	case AY_CVOL:
		PSG.Regs[AY_CVOL] &= 0x1f;
		PSG.EnvelopeC = PSG.Regs[AY_CVOL] & 0x10;
		PSG.VolC = PSG.EnvelopeC ? PSG.VolE : PSG.VolTable[PSG.Regs[AY_CVOL] ? PSG.Regs[AY_CVOL]*2+1 : 0];
		break;
	case AY_EFINE:
	case AY_ECOARSE:
		old = PSG.PeriodE;
		PSG.PeriodE = ((PSG.Regs[AY_EFINE] + 256 * PSG.Regs[AY_ECOARSE])) * PSG.UpdateStep;
		if (PSG.PeriodE == 0) PSG.PeriodE = PSG.UpdateStep / 2;
		PSG.CountE += PSG.PeriodE - old;
		if (PSG.CountE <= 0) PSG.CountE = 1;
		break;
	case AY_ESHAPE:
		/* envelope shapes:
		C AtAlH
		0 0 x x  \___

		0 1 x x  /___

		1 0 0 0  \\\\

		1 0 0 1  \___

		1 0 1 0  \/\/
		          ___
		1 0 1 1  \

		1 1 0 0  ////
		          ___
		1 1 0 1  /

		1 1 1 0  /\/\

		1 1 1 1  /___

		The envelope counter on the AY-3-8910 has 16 steps. On the YM2149 it
		has twice the steps, happening twice as fast. Since the end result is
		just a smoother curve, we always use the YM2149 behaviour.
		*/
		PSG.Regs[AY_ESHAPE] &= 0x0f;
		PSG.Attack = (PSG.Regs[AY_ESHAPE] & 0x04) ? 0x1f : 0x00;
		if ((PSG.Regs[AY_ESHAPE] & 0x08) == 0)
		{
			/* if Continue = 0, map the shape to the equivalent one which has Continue = 1 */
			PSG.Hold = 1;
			PSG.Alternate = PSG.Attack;
		}
		else
		{
			PSG.Hold = PSG.Regs[AY_ESHAPE] & 0x01;
			PSG.Alternate = PSG.Regs[AY_ESHAPE] & 0x02;
		}
		PSG.CountE = PSG.PeriodE;
		PSG.CountEnv = 0x1f;
		PSG.Holding = 0;
		PSG.VolE = PSG.VolTable[PSG.CountEnv ^ PSG.Attack];
		if (PSG.EnvelopeA) PSG.VolA = PSG.VolE;
		if (PSG.EnvelopeB) PSG.VolB = PSG.VolE;
		if (PSG.EnvelopeC) PSG.VolC = PSG.VolE;
		break;
	case AY_PORTA:
		break;
	case AY_PORTB:
		break;
	}
}


/* write a register on AY8910 chip number 'n' */
void AYWriteReg(int r, int v)
{
	_AYWriteReg(r,v);
}

unsigned char AYReadReg(int r)
{
	if (r > 15) return 0;
	return PSG.Regs[r];
}


void AY8910Write(int a,int data)
{
	if (a & 1)
	{	/* Data port */
		AYWriteReg(PSG.register_latch,data);
	}
	else
	{	/* Register port */
		PSG.register_latch = data & 0x0f;
	}
}

int AY8910Read()
{
	return AYReadReg(PSG.register_latch);
}

void AY8910Update(INT32 *buffer,int length)
{
	int outn;
	INT32 out_data;

	/* The 8910 has three outputs, each output is the mix of one of the three */
	/* tone generators and of the (single) noise generator. The two are mixed */
	/* BEFORE going into the DAC. The formula to mix each channel is: */
	/* (ToneOn | ToneDisable) & (NoiseOn | NoiseDisable). */
	/* Note that this means that if both tone and noise are disabled, the output */
	/* is 1, not 0, and can be modulated changing the volume. */

	/* If the channels are disabled, set their output to 1, and increase the */
	/* counter, if necessary, so they will not be inverted during this update. */
	/* Setting the output to 1 is necessary because a disabled channel is locked */
	/* into the ON state (see above); and it has no effect if the volume is 0. */
	/* If the volume is 0, increase the counter, but don't touch the output. */
	if (PSG.Regs[AY_ENABLE] & 0x01 || (PSG.Regs[AY_AFINE] + 256 * PSG.Regs[AY_ACOARSE])<1)
	{
		if (PSG.CountA <= length*STEP) PSG.CountA += length*STEP;
		PSG.OutputA = PSG.puchi;
	}
	else if (PSG.Regs[AY_AVOL] == 0)
	{
		/* note that I do count += length, NOT count = length + 1. You might think */
		/* it's the same since the volume is 0, but doing the latter could cause */
		/* interferencies when the program is rapidly modulating the volume. */
		if (PSG.CountA <= length*STEP) PSG.CountA += length*STEP;
	}
	if (PSG.Regs[AY_ENABLE] & 0x02 || (PSG.Regs[AY_BFINE] + 256 * PSG.Regs[AY_BCOARSE])<1)
	{
		if (PSG.CountB <= length*STEP) PSG.CountB += length*STEP;
		PSG.OutputB = PSG.puchi;
	}
	else if (PSG.Regs[AY_BVOL] == 0)
	{
		if (PSG.CountB <= length*STEP) PSG.CountB += length*STEP;
	}
	if (PSG.Regs[AY_ENABLE] & 0x04 || (PSG.Regs[AY_CFINE] + 256 * PSG.Regs[AY_CCOARSE])<1)
	{
		if (PSG.CountC <= length*STEP) PSG.CountC += length*STEP;
		PSG.OutputC = PSG.puchi;
	}
	else if (PSG.Regs[AY_CVOL] == 0)
	{
		if (PSG.CountC <= length*STEP) PSG.CountC += length*STEP;
	}

	/* for the noise channel we must not touch OutputN - it's also not necessary */
	/* since we use outn. */
	if ((PSG.Regs[AY_ENABLE] & 0x38) == 0x38)	/* all off */
		if (PSG.CountN <= length*STEP) PSG.CountN += length*STEP;

	outn = (PSG.OutputN | PSG.Regs[AY_ENABLE]);

	/* buffering loop */
	while (length)
	{
		int vola,volb,volc;
		int left;

		/* vola, volb and volc keep track of how long each square wave stays */
		/* in the 1 position during the sample period. */
		vola = volb = volc = 0;

		left = STEP;
		do
		{
			int nextevent;

			if (PSG.CountN < left) nextevent = PSG.CountN;
			else nextevent = left;
			nextevent = left;

			if (outn & 0x08)
			{
				if (PSG.OutputA) vola += PSG.CountA;
				PSG.CountA -= nextevent;
				/* PeriodA is the half period of the square wave. Here, in each */
				/* loop I add PeriodA twice, so that at the end of the loop the */
				/* square wave is in the same status (0 or 1) it was at the start. */
				/* vola is also incremented by PeriodA, since the wave has been 1 */
				/* exactly half of the time, regardless of the initial position. */
				/* If we exit the loop in the middle, OutputA has to be inverted */
				/* and vola incremented only if the exit status of the square */
				/* wave is 1. */
				while (PSG.CountA <= 0)
				{
					PSG.CountA += PSG.PeriodA;
					if (PSG.CountA > 0)
					{
						PSG.OutputA ^= 1;
						if (PSG.OutputA) vola += PSG.PeriodA;
						break;
					}
					PSG.CountA += PSG.PeriodA;
					vola += PSG.PeriodA;
				}
				if (PSG.OutputA) vola -= PSG.CountA;
			}
			else
			{
				PSG.CountA -= nextevent;
				while (PSG.CountA <= 0)
				{
					PSG.CountA += PSG.PeriodA;
					if (PSG.CountA > 0)
					{
						PSG.OutputA ^= 1;
						break;
					}
					PSG.CountA += PSG.PeriodA;
				}
			}

			if (outn & 0x10)
			{
				if (PSG.OutputB) volb += PSG.CountB;
				PSG.CountB -= nextevent;
				while (PSG.CountB <= 0)
				{
					PSG.CountB += PSG.PeriodB;
					if (PSG.CountB > 0)
					{
						PSG.OutputB ^= 1;
						if (PSG.OutputB) volb += PSG.PeriodB;
						break;
					}
					PSG.CountB += PSG.PeriodB;
					volb += PSG.PeriodB;
				}
				if (PSG.OutputB) volb -= PSG.CountB;
			}
			else
			{
				PSG.CountB -= nextevent;
				while (PSG.CountB <= 0)
				{
					PSG.CountB += PSG.PeriodB;
					if (PSG.CountB > 0)
					{
						PSG.OutputB ^= 1;
						break;
					}
					PSG.CountB += PSG.PeriodB;
				}
			}

			if (outn & 0x20)
			{
				if (PSG.OutputC) volc += PSG.CountC;
				PSG.CountC -= nextevent;
				while (PSG.CountC <= 0)
				{
					PSG.CountC += PSG.PeriodC;
					if (PSG.CountC > 0)
					{
						PSG.OutputC ^= 1;
						if (PSG.OutputC) volc += PSG.PeriodC;
						break;
					}
					PSG.CountC += PSG.PeriodC;
					volc += PSG.PeriodC;
				}
				if (PSG.OutputC) volc -= PSG.CountC;
			}
			else
			{
				PSG.CountC -= nextevent;
				while (PSG.CountC <= 0)
				{
					PSG.CountC += PSG.PeriodC;
					if (PSG.CountC > 0)
					{
						PSG.OutputC ^= 1;
						break;
					}
					PSG.CountC += PSG.PeriodC;
				}
			}

			PSG.CountN -= nextevent;
			if (PSG.CountN <= 0)
			{
				/* Is noise output going to change? */
				if ((PSG.RNG + 1) & 2)	/* (bit0^bit1)? */
				{
					PSG.OutputN = ~PSG.OutputN;
					outn = (PSG.OutputN | PSG.Regs[AY_ENABLE]);
				}

				/* The Random Number Generator of the 8910 is a 17-bit shift */
				/* register. The input to the shift register is bit0 XOR bit2 */
				/* (bit0 is the output). */

				/* The following is a fast way to compute bit 17 = bit0^bit2. */
				/* Instead of doing all the logic operations, we only check */
				/* bit 0, relying on the fact that after two shifts of the */
				/* register, what now is bit 2 will become bit 0, and will */
				/* invert, if necessary, bit 16, which previously was bit 18. */
				if (PSG.RNG & 1) PSG.RNG ^= 0x28000;
				PSG.RNG >>= 1;
				PSG.CountN += PSG.PeriodN;
			}

			left -= nextevent;
		} while (left > 0);

		/* update envelope */
		if (PSG.Holding == 0)
		{
			PSG.CountE -= STEP;
			if (PSG.CountE <= 0)
			{
				do
				{
					PSG.CountEnv--;
					PSG.CountE += PSG.PeriodE;
				} while (PSG.CountE <= 0);

				/* check envelope current position */
				if (PSG.CountEnv < 0)
				{
					if (PSG.Hold)
					{
						if (PSG.Alternate)
							PSG.Attack ^= 0x1f;
						PSG.Holding = 1;
						PSG.CountEnv = 0;
					}
					else
					{
						/* if CountEnv has looped an odd number of times (usually 1), */
						/* invert the output. */
						if (PSG.Alternate && (PSG.CountEnv & 0x20))
 							PSG.Attack ^= 0x1f;

						PSG.CountEnv &= 0x1f;
					}
				}

				PSG.VolE = PSG.VolTable[PSG.CountEnv ^ PSG.Attack];
				/* reload volume */
				if (PSG.EnvelopeA) PSG.VolA = PSG.VolE;
				if (PSG.EnvelopeB) PSG.VolB = PSG.VolE;
				if (PSG.EnvelopeC) PSG.VolC = PSG.VolE;
			}
		}
		out_data = ((vola * PSG.VolA) + (volb * PSG.VolB) + (volc * PSG.VolC) )/ STEP;
		*buffer++ = out_data * 0x00010001;
		length--;
	}
}

void AY8910_set_clock(int clock,int rate)
{
	/* the step clock for the tone and noise generators is the chip clock    */
	/* divided by 8; for the envelope generator of the AY-3-8910, it is half */
	/* that much (clock/16), but the envelope of the YM2149 goes twice as    */
	/* fast, therefore again clock/8.                                        */
	/* Here we calculate the number of steps which happen during one sample  */
	/* at the given sample rate. No. of events = sample rate / (clock/8).    */
	/* STEP is a multiplier used to turn the fraction into a fixed point     */
	/* number.                                                               */
	PSG.UpdateStep = (UINT32)(((double)STEP * rate * 8) / clock);
}

static void build_mixer_table(void)
{
	int i;
	double out;


	/* calculate the volume->voltage conversion table */
	/* The AY-3-8910 has 16 levels, in a logarithmic scale (3dB per step) */
	/* The YM2149 still has 16 levels for the tone generators, but 32 for */
	/* the envelope generator (1.5dB per step). */
	out = MAX_OUTPUT;
	for (i = 31;i > 0;i--)
	{
		PSG.VolTable[i] = (UINT32)(out + 0.5);	/* round to nearest */

		out /= 1.188502227;	/* = 10 ^ (1.5/20) = 1.5dB */
	}
	PSG.VolTable[0] = 0;
}



void AY8910_reset(void)
{
	int i;

	PSG.register_latch = 0;
	PSG.RNG = 1;
	PSG.OutputA = 0;
	PSG.OutputB = 0;
	PSG.OutputC = 0;
	PSG.OutputN = 0xff;
	for (i = 0;i < AY_PORTA;i++)
		_AYWriteReg(i,0);	/* AYWriteReg() uses the timer system; we cannot */
								/* call it at this time because the timer system */
								/* has not been initialized. */
}

int AY8910_init(int clock,int sample_rate)
{
	memset(&PSG,0,sizeof(struct AY8910));

	PSG.puchi = 1;

	AY8910_set_clock(clock,sample_rate);
	AY8910_reset();
	build_mixer_table();

	return 0;
}

void AY8910_set_puchi_noize(int value)
{
	PSG.puchi = value;
}

/* ---- state save/load ---- */

int psg_save_state(BYTE *buf, int maxlen)
{
	int pos = 0;
	/* Save entire PSG struct - no pointers, safe to memcpy */
	SS_WRITE(buf, pos, &PSG, sizeof(PSG));
	return pos;
}

int psg_load_state(const BYTE *buf, int len)
{
	int pos = 0;
	/* VolTable will be overwritten but it's constant after init.
	   Restore it after load. */
	UINT32 saved_voltable[32];
	memcpy(saved_voltable, PSG.VolTable, sizeof(saved_voltable));

	SS_READ(buf, pos, &PSG, sizeof(PSG));

	/* VolTable depends on build-time constants, not runtime state.
	   Restore it to prevent stale data from breaking audio. */
	memcpy(PSG.VolTable, saved_voltable, sizeof(PSG.VolTable));
	return 0;
}

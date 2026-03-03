#include	<windows.h>
#include	"x1.h"
#include	"x1_8255.h"
#include	"x1_dma.h"
#include	"x1_fdc.h"
#include	"state_save.h"

#include	"dosio.h"
#include	"trace.h"
#if T_TUNE
#include	"common.h"
#include	"x1_irq.h"
#include	"x1_mem.h"
#endif

#ifdef FDC_DMA_TRACE
#include	<emscripten.h>
#endif

/***********************************************************************
	DMA
***********************************************************************/

	DMA_TABLE	dma;

#if T_TUNE
static EVENT dma_break_event = EVENT_VALUE("DMA cpu break",0,NULL,0);

WORD dma_src_upcount;
WORD dma_dst_upcount;
WORD *dma_src_cnt_ptr;
WORD *dma_dst_cnt_ptr;
void *dma_src_func; /* BYTE __fastcall (*func)(WORD) */
void *dma_dst_func; /* void __fastcall (*func)(WORD,BYTE) */
WORD dma_cycles;

/* set internal status for DMA transfer main routine */
void __fastcall dma_outdmy(WORD port,BYTE value)
{
}

void x1_dma_setup(void)
{
	BYTE src,dst;

	/* address pointer & direction */
	if( dma.WR[0] & 4)
	{	/* A -> B */
		dma_src_cnt_ptr = &dma.CNT_A.w;
		dma_dst_cnt_ptr = &dma.CNT_B.w;
		src = 0; /* A */
		dst = 1; /* B */
	}
	else
	{	/* B -> A */
		dma_src_cnt_ptr = &dma.CNT_B.w;
		dma_dst_cnt_ptr = &dma.CNT_A.w;
		src = 1; /* B */
		dst = 0; /* A */
	}
	/* cycles per byte */
	dma_cycles = ((dma.TIMMING.b[src]&0x03)^0x03)+1;
	if( dma.DMA_CMND & 1)
		dma_cycles += ((dma.TIMMING.b[dst]&0x03)^0x03)+1;
	/* src function */
	dma_src_func = (dma.WR[1+src]&8) ? (void *)Z80_In  : (void *)fast_RDMEM;

	/* dst function */
	if( dma.DMA_CMND & 1)
		dma_dst_func = (dma.WR[1+dst]&8) ? (void *)Z80_Out : (void *)fast_WRMEM;
	else
		dma_dst_func = (void *)&dma_outdmy;

	/* src update count */
	if( dma.WR[1+src] & 0x20)
		dma_src_upcount = 0;
	else 
		dma_src_upcount = (dma.WR[1+src] & 0x10) ? (WORD)1 : (WORD)-1;

	/* dst update count */
	if( dma.WR[1+dst] & 0x20)
		dma_dst_upcount = 0;
	else 
		dma_dst_upcount = (dma.WR[1+dst] & 0x10) ? (WORD)1 : (WORD)-1;
}

/* IRQ vector read callback from IRQ controller */
static BYTE x1_dma_vector_r(BYTE device)
{
	Z80_set_ieo_line(device);
	Z80_clear_irq_line(device);
	return dma.NXT_VECTOR;
}

void x1_dma_reti(BYTE device)
{
	dma.RETI_ENBL = 0x03;
	Z80_clear_ieo_line(device);
}
#endif

void init_dma(void) {

	ZeroMemory(&dma, sizeof(dma));
	dma.DMA_REDY = 8;
	dma.RR = 0x38;
#if T_TUNE
	dma.RETI_ENBL = 0x03;
	/* daisy chain */
	Z80_setup_irq_handler(DEVICE_DMA,x1_dma_vector_r,x1_dma_reti);
#endif
}


void setdmareaddat(void) {

	dma.RR_CNT = dma.RR_OFF = 0;
	if (dma.RR_MSK & 0x01) dma.RR_TBL[dma.RR_CNT++] = DMAOFST(RR);
	if (dma.RR_MSK & 0x02) dma.RR_TBL[dma.RR_CNT++] = DMAOFST(BYT_N.b[0]);
	if (dma.RR_MSK & 0x04) dma.RR_TBL[dma.RR_CNT++] = DMAOFST(BYT_N.b[1]);
	if (dma.RR_MSK & 0x08) dma.RR_TBL[dma.RR_CNT++] = DMAOFST(CNT_A.b[0]);
	if (dma.RR_MSK & 0x10) dma.RR_TBL[dma.RR_CNT++] = DMAOFST(CNT_A.b[1]);
	if (dma.RR_MSK & 0x20) dma.RR_TBL[dma.RR_CNT++] = DMAOFST(CNT_B.b[0]);
	if (dma.RR_MSK & 0x40) dma.RR_TBL[dma.RR_CNT++] = DMAOFST(CNT_B.b[1]);
}

X1_IOW x1_dma_w(WORD port, BYTE value) {

	BYTE	wr;
#if T_TUNE
	BYTE	old_enbl = dma.DMA_ENBL;
#endif

	TRACEOUT(port, value);

	dma.DMA_ENBL = 0;

	if (!dma.WR_CNT) {
		wr = 6;
		dma.WR_CNT = dma.WR_OFF = 0;
		if (!(value & 0x80)) {
			if ((value & 3) != 0) {
				wr = 0;
			}
			else if ((value & 7) == 4) {
				wr = 1;
			}
			else if ((value & 7) == 0) {
				wr = 2;
			}
		}
		else {
			if ((value & 3) == 0) {
				wr = 3;
			}
			else if (((value & 3) == 1) && (value >> 5) != 7) {
				wr = 4;
			}
			else if (((value & 7) == 2) && (!(value & 0x40))) {
				wr = 5;
			}
			else if ((value & 3) == 3) {
				wr = 6;
			}
		}
		dma.WR[wr] = value;
		switch(wr) {
			case 0:
				dma.DMA_CMND = (BYTE)(value & 3);
				if (value & 0x08) {
					dma.WR_TBL[dma.WR_CNT++] = DMAOFST(ADR_A.b[0]);
				}
				if (value & 0x10) {
					dma.WR_TBL[dma.WR_CNT++] = DMAOFST(ADR_A.b[1]);
				}
				if (value & 0x20) {
					dma.WR_TBL[dma.WR_CNT++] = DMAOFST(BYT_L.b[0]);
				}
				if (value & 0x40) {
					dma.WR_TBL[dma.WR_CNT++] = DMAOFST(BYT_L.b[1]);
				}
				break;
			case 1:
			case 2:
#if T_TUNE
				dma.TIMMING.b[wr-1] = value&0x08 ? 0xcc : 0xcd;
				if (value & 0x40) {
					dma.WR_TBL[dma.WR_CNT++] = DMAOFST(TIMMING.b[wr-1]);
				}
#else
				if (value & 0x40) {
					dma.WR_TBL[dma.WR_CNT++] = DMAOFST(nul);
				}
#endif
				break;
			case 3:
				if (value & 0x08) {
					dma.WR_TBL[dma.WR_CNT++] = DMAOFST(MASK_BYT);
				}
				if (value & 0x10) {
					dma.WR_TBL[dma.WR_CNT++] = DMAOFST(MACH_BYT);
				}
				dma.INT_ENBL = (BYTE)((value & 0x20)?1:0);
#if T_TUNE
				dma.DMA_ENBL = (BYTE)((value & 0x40)?3:0);
#else
				dma.DMA_ENBL = (BYTE)((value & 0x40)?1:0);
#endif
				break;
			case 4:
				dma.DMA_MODE = (BYTE)((dma.WR[4] >> 5) & 3);
				if (value & 0x04) {
					dma.WR_TBL[dma.WR_CNT++] = DMAOFST(ADR_B.b[0]);
				}
				if (value & 0x08) {
					dma.WR_TBL[dma.WR_CNT++] = DMAOFST(ADR_B.b[1]);
				}
				if (value & 0x10){
					dma.WR_TBL[dma.WR_CNT++] = DMAOFST(INT_FLG);
				}
				break;
			case 6:
				switch(value) {
					case 0x83:				// DMA･ﾃﾞｨｽｴｲﾌﾞﾙ
						dma.DMA_ENBL = 0;
						break;
					case 0x87:				// DMA･ｲﾈｰﾌﾞﾙ
#if T_TUNE
						dma.DMA_ENBL = 3;
#else
						dma.DMA_ENBL = 1;
#endif
						break;
					case 0x8b:				// ﾘ･ｲﾆｼｬﾗｲｽﾞ･ｽﾃｰﾀｽ･ﾊﾞｲﾄ
						dma.MACH_FLG = dma.ENDB_FLG = 0;
						break;
					case 0xa7:				// ｲﾆｼｴｲﾄ･ﾘｰﾄﾞ･ｼｰｹﾝｽ
						setdmareaddat();
						break;
					case 0xab:				// ｲﾝﾀﾗﾌﾟﾄ･ｲﾈｰﾌﾞﾙ
						dma.INT_ENBL = 1;
#if T_TUNE
						if(dma.INT_FLG&0x40) /* ready interrupt */
						{
//							if( (dma.WR[5] ^ dma.DMA_REDY) & 8 )
//							{
								dma.NXT_VECTOR = 
									dma.INT_FLG&0x20 ? 
									dma.INT_VCT & 0xf9 : dma.INT_VCT;
								Z80_set_irq_line(DEVICE_DMA);
//							}
						}
#endif
						break;
					case 0xaf:				// ｲﾝﾀﾗﾌﾟﾄ･ﾃﾞｨｽｴｲﾌﾞﾙ
						dma.INT_ENBL = 0;
#if T_TUNE
						Z80_clear_irq_line(DEVICE_DMA);
#endif
						break;
					case 0xb3:				// ｷｮｳｾｲ･ﾚﾃﾞｨ
						dma.DMA_REDY = (dma.WR[5] & 0x08);
						break;
#if T_TUNE
					case 0xb7:				// RETI後･ｲﾈｰﾌﾞﾙ
						dma.RETI_ENBL = 0;
						break;
#endif
					case 0xbb:				// ﾘｰﾄﾞ･ﾏｽｸ･ﾌｫﾛｰｽﾞ
						dma.WR_TBL[dma.WR_CNT++] = DMAOFST(RR_MSK);
						break;
					case 0xbf:				// ﾘｰﾄﾞ･ｽﾃｰﾀｽ･ﾊﾞｲﾄ
						dma.RR_MSK = 1;
						setdmareaddat();
						break;
					case 0xc3:				// ﾘｾｯﾄ
#if 1										// ver0.25 ﾛｰｸﾞｱﾗｲｱﾝｽ
						dma.DMA_CMND = 0;
						dma.DMA_ENBL = 0;
						dma.INT_ENBL = 0;
#else
						init_dma();
#endif
#if T_TUNE
						Z80_clear_irq_line(DEVICE_DMA);
#endif
						break;
					case 0xc7:				// ﾘｾｯﾄ･ﾎﾟｰﾄAﾀｲﾐﾝｸﾞ
#if T_TUNE
						dma.TIMMING.b[0] = dma.TIMMING.b[1]&0x08 ? 0xcc : 0xcd;
						break;
#endif
					case 0xcb:				// ﾘｾｯﾄ･ﾎﾟｰﾄBﾀｲﾐﾝｸﾞ
#if T_TUNE
						dma.TIMMING.b[1] = dma.TIMMING.b[2]&0x08 ? 0xcc : 0xcd;
#endif
						break;
					case 0xcf: // ﾛｰﾄﾞ
						dma.DMA_MODE = (BYTE)((dma.WR[4] >> 5) & 3);
						dma.CNT_A.w = dma.ADR_A.w;
						dma.CNT_B.w = dma.ADR_B.w;
						dma.BYT_N.w = (WORD)-1;	// Z80-DMA: 0-based index of last transferred byte
						dma.ENDB_FLG = 0;
						dma.MACH_FLG = 0;			// 0619
						dma.DMA_ENBL = 0;
#ifdef FDC_DMA_TRACE
						EM_ASM({console.log('DMA LOAD: MODE='+$0+' CNT_A='+$1.toString(16)+' CNT_B='+$2.toString(16)+' BYTL='+$3.toString(16)+' REDY='+$4)},
							dma.DMA_MODE, dma.CNT_A.w, dma.CNT_B.w, dma.BYT_L.w, dma.DMA_REDY);
#endif
						break;
					case 0xd3:				// ｺﾝﾃｨﾆｭｰ
#if !T_TUNE
						if (dma.DMA_STOP) {			// 前回途中でNOT READY
							dma.DMA_STOP = 0;
							// ここでインクリメントするのはちょい無理が…
							switch(dma.WR[1] & 0x30) {
								case 0x00:
									dma.CNT_A.w--;
									break;
								case 0x10:
									dma.CNT_A.w++;
									break;
							}
							switch(dma.WR[2] & 0x30) {
								case 0x00:
									dma.CNT_B.w--;
									break;
								case 0x10:
									dma.CNT_B.w++;
									break;
							}
						}
#endif
						dma.BYT_N.w = (WORD)-1;	// Z80-DMA: 0-based index of last transferred byte
						dma.MACH_FLG = 0;			// 0619
						dma.ENDB_FLG = 0;
#ifdef FDC_DMA_TRACE
						EM_ASM({console.log('DMA CONT: MODE='+$0+' CNT_A='+$1.toString(16)+' CNT_B='+$2.toString(16)+' REDY='+$3+' CMND='+$4)},
							dma.DMA_MODE, dma.CNT_A.w, dma.CNT_B.w, dma.DMA_REDY, dma.DMA_CMND);
#endif
#if T_TUNE
						dma.DMA_ENBL = 3;
#else
						dma.DMA_ENBL = 1;
#endif
						break;
				}
				break;
		}
	}
	else {
		*(((BYTE *)&dma) + dma.WR_TBL[dma.WR_OFF]) = value;
#ifdef FDC_DMA_TRACE
		if (dma.WR_TBL[dma.WR_OFF] == DMAOFST(ADR_B.b[0]) ||
			dma.WR_TBL[dma.WR_OFF] == DMAOFST(ADR_B.b[1])) {
			EM_ASM({console.log('DMA WR ADR_B: byte='+$0+' val='+$1.toString(16)+' ADR_B='+$2.toString(16))},
				(dma.WR_TBL[dma.WR_OFF] == DMAOFST(ADR_B.b[1])) ? 1 : 0, value, dma.ADR_B.w);
		}
#endif
		if (dma.WR_TBL[dma.WR_OFF] == DMAOFST(INT_FLG)) {
			if (value & 0x08) {
				dma.WR_TBL[dma.WR_OFF + dma.WR_CNT] = DMAOFST(INT_PLS);
				dma.WR_CNT++;
			}
			if (value & 0x10) {
				dma.WR_TBL[dma.WR_OFF + dma.WR_CNT] = DMAOFST(INT_VCT);
				dma.WR_CNT++;
			}
		}
		else if (dma.WR_TBL[dma.WR_OFF] == DMAOFST(RR_MSK)) {
			setdmareaddat();
		}
		dma.WR_OFF++;
		dma.WR_CNT--;
	}
#if T_TUNE
	if( old_enbl != dma.DMA_ENBL)
	{
		/* setup internal status */
		x1_dma_setup();
		/* cause dummy event */
		event_set(&dma_break_event,0);
	}
#endif
}

X1_IOR x1_dma_r(WORD port) {

	TRACEIN(port);

	dma.RR = 0xcc;
	if (dma.DMA_ENBL) {
		dma.RR |= 0x01;
	}
	if ((dma.DMA_MODE != 1) && ((dma.WR[5] ^ dma.DMA_REDY) & 8)) {
		dma.RR |= 0x02;
	}
	if (!dma.MACH_FLG) {
		dma.RR |= 0x10;
	}
	if (!dma.ENDB_FLG) {
		dma.RR |= 0x20;
	}
	if (!dma.RR_CNT) {
		return(dma.RR);
	}
	if (dma.RR_OFF >= dma.RR_CNT) {
		dma.RR_OFF = 0;
	}
	{
		BYTE rr_off = dma.RR_TBL[dma.RR_OFF];
		BYTE rr_val = *(((BYTE *)&dma) + rr_off);
#ifdef FDC_DMA_TRACE
		{
			static const char* rr_names[] = {
				"RR","BYTN_L","BYTN_H","CNTA_L","CNTA_H","CNTB_L","CNTB_H"
			};
			static const BYTE rr_offsets[] = {
				DMAOFST(RR), DMAOFST(BYT_N.b[0]), DMAOFST(BYT_N.b[1]),
				DMAOFST(CNT_A.b[0]), DMAOFST(CNT_A.b[1]),
				DMAOFST(CNT_B.b[0]), DMAOFST(CNT_B.b[1])
			};
			int i;
			for (i = 0; i < 7; i++) {
				if (rr_off == rr_offsets[i]) {
					EM_ASM({console.log('DMA RD: '+UTF8ToString($0)+'='+$1.toString(16)+' BYTN='+$2.toString(16)+' CNTB='+$3.toString(16))},
						rr_names[i], rr_val, dma.BYT_N.w, dma.CNT_B.w);
					break;
				}
			}
		}
#endif
		dma.RR_OFF++;
		return(rr_val);
	}
}

/* ---- state save / load ---- */

int dma_save_state(BYTE *buf, int maxlen) {
	int pos = 0;

	/* DMA_TABLE struct */
	SS_WRITE(buf, pos, &dma, sizeof(dma));
#if T_TUNE
	/* dma_src_upcount, dma_dst_upcount, dma_cycles */
	SS_WRITE_U16(buf, pos, dma_src_upcount);
	SS_WRITE_U16(buf, pos, dma_dst_upcount);
	SS_WRITE_U16(buf, pos, dma_cycles);
	/* dma_break_event: oneshot, normally inactive */
	{
		BYTE active = (event_enabled(&dma_break_event) ? 1 : 0);
		SS_WRITE_U8(buf, pos, active);
		if (active) {
			EV_TIME tl = event_timeleft(&dma_break_event);
			SS_WRITE_U32(buf, pos, tl);
		}
	}
#endif

	return pos;
}

int dma_load_state(const BYTE *buf, int len) {
	int pos = 0;

	/* DMA_TABLE struct */
	SS_READ(buf, pos, &dma, sizeof(dma));
#if T_TUNE
	/* dma_src_upcount, dma_dst_upcount, dma_cycles */
	SS_READ_U16(buf, pos, dma_src_upcount);
	SS_READ_U16(buf, pos, dma_dst_upcount);
	SS_READ_U16(buf, pos, dma_cycles);
	/* dma_break_event — read first, then apply */
	{
		BYTE active;
		EV_TIME tl = 0;
		SS_READ_U8(buf, pos, active);
		if (active) {
			SS_READ_U32(buf, pos, tl);
		}
		event_remove(&dma_break_event);
		if (active) {
			dma_break_event.callback = NULL;
			dma_break_event.interval = 0;
			event_set(&dma_break_event, tl);
		}
	}
	/* rebuild pointer fields from DMA register state */
	x1_dma_setup();
#endif

	return 0;
}

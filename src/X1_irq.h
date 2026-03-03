#include <windows.h>
#include <stdio.h>

/* X1 IRQ device numbers */
/*
	数が大きいほど優先順位が高い。
	ここの配列は資料が手元に無いので適当に配置している。
	ＣＴＣは１チップ４本使用
	ＳＩＯは１チップ８本使用
*/
/* lower priority */
#define DEVICE_SUB  1  /* 1ch */
#define DEVICE_SIO0 2  /* 8ch */
#define DEVICE_CTC2 10 /* 4ch */
#define DEVICE_CTC1 14 /* 4ch */
#define DEVICE_CTC0 18 /* 4ch */
#define DEVICE_DMA  22 /* 1ch */
/* higher priority */

#define MAX_DAISY_CHAIN 25

/* IRQ fetch vector handler */
typedef BYTE (*IRQ_VECTOR)(BYTE device);
/* IRQ RETI ditect handler */
typedef void (*IRQ_RETI)(BYTE device);

/* Z80CPU core interface */

/* INT check and enter INT request */
/*     before CPU execute, after EI(+extra instruction),and after RETN */
void __fastcall Z80_check_irq_line(void);
/* after RETI instruction */
void __fastcall Z80_irq_reti(void);

/* IRQ device interface */

/* assert INT line in interrupt device */
/* device : interrupt device */
/*   timming of normal Z80 daisy chain device : INT requrst is 'ON' */
void Z80_set_irq_line(BYTE device);

/* clear  INT line in interrupt device */
/*   timming of normal Z80 daisy chain device : after RETI */
void Z80_clear_irq_line(BYTE device);

/* assert IEO line in interrupt device */
/* INT line for Z80 is automaticaly mask when IEI is inavtive */
/*   timming of normal Z80 daisy chain device : int vector fetch */
void Z80_set_ieo_line(BYTE device);

/* clear  IEO line in interrupt device */
/*   timming of normal Z80 daisy chain device : after RETI */
void Z80_clear_ieo_line(BYTE device);

/* check current irq line */
BYTE Z80_check_pending_irq(BYTE device);

/*
  setup vector fetch and REIT ditect callback handler

  v_hndr : vector fetch callback handler
  r_hndr : RETI ditect callback handler
*/
void Z80_setup_irq_handler(BYTE device,
							IRQ_VECTOR v_hndr,IRQ_RETI r_hndr);


/* initilize daisychain irq system */
void init_irq(void);

/* Z80 CPU core → daisy-chain interface (z80_wrapper.cpp で定義) */
/* INT ピンのレベル制御: assert_int != 0 でアサート */
void Z80_assert_int(int assert_int);
/* 割り込みアックサイクル (IORQ+M1) でベクタを取得 */
BYTE Z80_irq_vector_fetch(void);

typedef union {
	BYTE	b[2];
	WORD	w;
} PAIR;


typedef struct {
	BYTE	nul;
	BYTE	DMA_ENBL;
	BYTE	DMA_REDY;
	BYTE	INT_ENBL;

	BYTE	DMA_MODE;
	BYTE	DMA_CMND;

	BYTE	MASK_BYT;
	BYTE	MACH_BYT;

	BYTE	MACH_FLG;
	BYTE	ENDB_FLG;

	BYTE	INT_FLG;
	BYTE	INT_PLS;
	BYTE	INT_VCT;
	BYTE	padding;

	BYTE	RR_MSK;
	BYTE	RR;

	PAIR	ADR_A;
	PAIR	ADR_B;
	PAIR	BYT_L;

	PAIR	CNT_A;
	PAIR	CNT_B;
	PAIR	BYT_N;

	BYTE	WR[8];

	WORD	WR_CNT;
	WORD	WR_OFF;
	WORD	RR_CNT;
	WORD	RR_OFF;
	BYTE	WR_TBL[16];
	BYTE	RR_TBL[16];

	BYTE	DMA_STOP;
#if T_TUNE
	BYTE	RETI_ENBL;
	PAIR	TIMMING;
	BYTE	NXT_VECTOR;
#endif
} DMA_TABLE;

#include <stddef.h>
#define DMAOFST(item)	((BYTE)offsetof(DMA_TABLE, item))

extern	DMA_TABLE	dma;

#if T_TUNE
/* ここはポインタ群なので、直接セーブロードしないでね */
/* dma復帰後にx1_dma_setup()を呼べばセットアップされるから */
extern WORD dma_src_upcount;
extern WORD dma_dst_upcount;
extern WORD *dma_src_cnt_ptr;
extern WORD *dma_dst_cnt_ptr;
extern void *dma_src_func;
extern void *dma_dst_func;
extern WORD dma_cycles;

/* ↑のデータをセットアップする */
void x1_dma_setup(void);
#endif


void init_dma(void);
X1_IOW x1_dma_w(WORD port, BYTE value);
X1_IOR x1_dma_r(WORD port);


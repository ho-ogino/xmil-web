typedef struct {
	BYTE	Dx[16][8];
	BYTE	Ex[16][8];

	BYTE	MODE;
	BYTE	CMD_CNT;
	BYTE	DAT_CNT;

	BYTE	INT_SW;
	BYTE	IBF;
	BYTE	OBF;

	WORD	datap;
#if T_TUNE
	/* 8255 I/F */
	BYTE	IBUF;
	BYTE	OBUF;
	/* KEY que : 7word+current 1word */
	BYTE keyque[7+1][2];
	BYTE keyque_rp;
	BYTE keyque_cnt;
	BYTE keyin_wait;
	/* オートリピートタイマー
	 * 初回遅延 557ms、リピートレート 61ms */
	WORD repeat_timer;   /* カウントダウン(ms単位)。0になったらリピート発火 */
	BYTE repeat_in_rep;  /* 0=初回遅延中, 1=リピート中 */
	BYTE repeat_key;     /* リピート中のキーコード（新規キーを検出するため） */
	/*	CMT controll */
	int  cmt_break_cnt;
#endif
} SCPU_TABLE;

extern	SCPU_TABLE	scpu;

#include <stddef.h>
#define SCPUOFST(item)	((WORD)offsetof(SCPU_TABLE, item))


void init_scpu(void);
short x1_sub_int(void);
X1_IOW x1_sub_w(WORD port, BYTE value);
X1_IOR x1_sub_r(WORD port);

#if T_TUNE
/* to CMT interface */
void x1_sub_cmtrx(BYTE data);
/* to 8255 interface */
BYTE x1_sub_getbreak(void);
#endif

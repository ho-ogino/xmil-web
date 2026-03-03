#ifndef __X1_CMT__
#define __X1_CMT__

#if T_TUNE

/* ----- tape file header ----- */
#define TAPE_INDEX   0x45504154   /* index (for LSB first model) */
#define TAPE_PROTECT 0x10         /* write protect               */
#define TAPE_FORMAT_SAMPLING 0x01 /* normal sampling format      */

typedef struct X1TapeHeaderRecoard
{
  unsigned long index;       /* 00H:識別インデックス "TAPE"            */
  char name[17];             /* 04H:テープの名前(asciiz)               */
  unsigned char reserve[5];  /* 15H:リザーブ                           */
  unsigned char protect;     /* 1AH:ライトプロテクトノッチ             */
                             /*     (00H=書き込み可、10H=書き込み禁止）*/
  unsigned char format;      /* 1BH:フォーマットの種類 ※未対応        */
                             /*    （01H=定速サンプリング方法）        */
  unsigned long frequency;   /* 1CH:サンプリング周波数(Ｈｚ単位）      */
  unsigned long datasize;    /* 20H:テープデータのサイズ（ビット単位） */
  unsigned long position;    /* 24H:テープの位置（ビット単位）         */
}X1TAPE_HEADER;
/* ----- tape file header ----- */


#define CMT_PAGE_SIZE 0x4000
typedef struct {
	/* file hedaer */
	X1TAPE_HEADER header;

	/* file status */
	BYTE buf[CMT_PAGE_SIZE];// current buffer of data
	DWORD filesize;			// file size
	DWORD page;				// current buffer page
	WORD buf_size;			// current buffer size
	BYTE dirty_buf;			// dirty flag of current page
	/* write data */
	BYTE data;
	BYTE busy;
	BYTE headdown;
	/* command state */
	BYTE cur_cmd;			// current command
	BYTE sensor;			// sensor
	/* apss controll */
	long apss_cnt;
} CMT_TABLE;

extern CMT_TABLE tape;

#define CMT_EJECT  0x00
#define CMT_STOP   0x01
#define CMT_PLAY   0x02
#define CMT_FF     0x03
#define CMT_REW    0x04
#define CMT_AFF    0x05
#define CMT_AREW   0x06
#define CMT_REC    0x0a
#define CMT_STATUS 0x80
#define CMT_SENSOR 0x81
#define CMT_BREAK  0xff

void init_cmt(void);

char *cmt_get_tape_name(void);
void cmt_set(char *fname);
void cmt_set_protect(BYTE sw);

#define cmt_eject() cmt_ctrl(CMT_EJECT,1)
#define cmt_play() cmt_ctrl(CMT_PLAY,1)
#define cmt_rec() cmt_ctrl(CMT_REC,1)
#define cmt_stop() cmt_ctrl(CMT_STOP,1)
#define cmt_ff() cmt_ctrl(CMT_FF,1)
#define cmt_rew() cmt_ctrl(CMT_REW,1)
#define cmt_apss_ff() cmt_ctrl(CMT_AFF,1)
#define cmt_apss_rew() cmt_ctrl(CMT_AREW,1)

BYTE cmt_read(void);
void cmt_write(BYTE data);

/* CZ8RL1 command form subcpu of X1turbo , or CMT controll button */
void cmt_ctrl(BYTE cmnd,int isButton);
BYTE cmt_busy(void);

short tape_boot(void);

#else  //T_TUNE
void init_cmt(void);
BYTE cmt_read(void);
void cmt_write(BYTE dat);
void cmt_ctrl(BYTE cmnd);
BYTE cmt_test(void);
#endif //T_TUNE

#endif

#include	<windows.h>
#include	"keylog.h"

// キーボードルーチンの叩き台
// かなり不備あり。

#if T_TUNE
// カセット制御キーは「テンキー」の0xc0〜0xcaコードに割り当てられている
// ＣＭＴのコマンドは、 (ASCIIコード - 0xc0) に対応する。
// 本物のキーボードでは不可能だが、0xc2や0xcaを送るとちゃんと再生／録音
// も出来てしまう
 #define C_EJ 0xc0
 #define C_ST 0xc1
 #define C_PL 0xc2
 #define C_FF 0xc3
 #define C_RW 0xc4
 #define C_AF 0xc5
 #define C_AR 0xc6
 #define C_RC 0xca
#endif

// と言うか…うちの環境が106キーボードではないだけだったり…

		BYTE	KEY_INT = 0;
		BYTE	KEY_HIT = 0;
		BYTE	KEY_TBL[256];
		BYTE	KEY_CHR = 0;
		BYTE	_CAPS_ = 0;
		BYTE	_KANA_ = 0;

static BYTE key106[256] = {
/*    ,    ,    ,STOP,    ,    ,    ,    ,  0x00 */
     0,   0,   0,0x45,   0,   0,   0,   0,
/*  BS, TAB,    ,    , CLR, ENT,    ,    ,  0x08 */
  0x0e,0x0f,   0,   0,   0,0x1c,   0,   0,
/* SFT,CTRL, ALT,PAUS,CAPS,KANA,    ,    ,  0x10 */
  0x2a,0x1d,0x38,0x45,   0,   0,   0,   0,
/* FIN, KAN,    , ESC,XFER,NFER,    ,  MD,  0x18 */
     0,   0,   0,0x01,0x5e,   0,   0,   0,
/* SPC,RLUP,RLDN, END,HOME,  ←,  ↑,  →,  0x20 */
  0x39,0x5b,0x5c,0x5f,0xc7,0xcb,0xc8,0xcd,
/*  ↓, SEL, PNT, EXE,COPY, INS, DEL, HLP,  0x28 */
  0xd0,   0,   0,   0,   0,0xd2,0xd3,   0,
/*  ０,  １,  ２,  ３,  ４,  ５,  ６,  ７,  0x30 */
  0x0b,0x02,0x03,0x04,0x05,0x06,0x07,0x08,
/*  ８,  ９,    ,    ,    ,    ,    ,    ,  0x38 */
  0x09,0x0a,   0,   0,   0,   0,   0,   0,
/*    ,  Ａ,  Ｂ,  Ｃ,  Ｄ,  Ｅ,  Ｆ,  Ｇ,  0x40 */
     0,0x1e,0x30,0x2e,0x20,0x12,0x21,0x22,
/*  Ｈ,  Ｉ,  Ｊ,  Ｋ,  Ｌ,  Ｍ,  Ｎ,  Ｏ,  0x48 */
  0x23,0x17,0x24,0x25,0x26,0x32,0x31,0x18,
/*  Ｐ,  Ｑ,  Ｒ,  Ｓ,  Ｔ,  Ｕ,  Ｖ,  Ｗ,  0x50 */
  0x19,0x10,0x13,0x1f,0x14,0x16,0x2f,0x11,
/*  Ｘ,  Ｙ,  Ｚ,LWIN,RWIN, APP,    ,    ,  0x58 */
  0x2d,0x15,0x2c,   0,   0,   0,   0,   0,
/*<０>,<１>,<２>,<３>,<４>,<５>,<６>,<７>,  0x60 */
  0x52,0x4f,0x50,0x51,0x04b,0x4c,0x4d,0x47,
/*<８>,<９>,<＊>,<＋>,<，>,<−>,<．>,<／>,  0x68 */
  0x48,0x49,0x37,0x4e,0x33,0x4a,0x53,0x35,
/* f.1, f.2, f.3, f.4, f.5, f.6, f.7, f.8,  0x70 */
  0x3b,0x3c,0x3d,0x3e,0x3f,0x40,0x41,0x42,
/* f.9, f10, f11, f12, f13, f14, f15, f16,  0x78 */
  0x43,0x44,0x57,0x58,   0,   0,   0,   0,
/*    ,    ,    ,    ,    ,    ,    ,    ,  0x80 */
     0,   0,   0,   0,   0,   0,   0,   0,
/*    ,    ,    ,    ,    ,    ,    ,    ,  0x88 */
     0,   0,   0,   0,   0,   0,   0,   0,
/*HELP, ALT,<＝>,    ,    ,    ,    ,    ,  0x90 */
     0,0x38,0x5d,   0,   0,   0,   0,   0,
/*    ,    ,    ,    ,    ,    ,    ,    ,  0x98 */
     0,   0,   0,   0,   0,   0,   0,   0,
/*    ,    ,    ,    ,    ,    ,    ,    ,  0xa0 */
     0,   0,   0,   0,   0,   0,   0,   0,
/*    ,    ,    ,    ,    ,    ,    ,    ,  0xa8 */
     0,   0,   0,   0,   0,   0,   0,   0,
/*    ,    ,    ,    ,    ,    ,    ,    ,  0xb0 */
     0,   0,   0,   0,   0,   0,   0,   0,
/*    ,    ,  ：,  ；,  ，,  −,  ．,  ／,  0xb8 */
     0,   0,0x28,0x27,0x33,0x0c,0x34,0x35,
/*  ＠,    ,    ,    ,    ,    ,    ,    ,  0xc0 */
  0x1a,   0,   0,   0,   0,   0,   0,   0,
/*    ,    ,    ,    ,    ,    ,    ,    ,  0xc0 */
     0,   0,   0,   0,   0,   0,   0,   0,
/*    ,    ,    ,    ,    ,    ,    ,    ,  0xd0 */
     0,   0,   0,   0,   0,   0,   0,   0,
/*    ,    ,    ,  ［,  ￥,  ］,  ＾,    ,  0xd8 */
     0,   0,   0,0x1b,0x5a,0x2b,0x0d,   0,
/*    ,    ,  ＿,    ,    ,    ,    ,    ,  0xe0 */
     0,   0,0x59,   0,   0,   0,   0,   0,
/*    ,    ,    ,    ,    ,    ,    ,    ,  0xe8 */
     0,   0,   0,   0,   0,   0,   0,   0,
/*CAPS,    ,    ,    ,    ,    ,    ,    ,  0xf0 */
     0,   0,   0,   0,   0,   0,   0,   0,
/*    ,    ,    ,    ,    ,    ,    ,    ,  0xf8 */
     0,   0,   0,   0,   0,   0,   0,   0,
};


void winkeyinit106(void) {

	KEY_INT = KEY_HIT = KEY_CHR = _CAPS_ = _KANA_ = 0;
	ZeroMemory(KEY_TBL, sizeof(KEY_TBL));
	keylog_printf("WINKEY INIT");
}


void winkeydown106(WPARAM wParam, LPARAM lParam) {

	wParam &= 0xff;
	switch(wParam) {
		case 0x14:
		case 0xf0:
			_CAPS_ ^= 1;
#if T_TUNE
			KEY_INT = 1;
			KEY_HIT = 0;
#endif
			break;
		case 0x15:
        case 0xf2:
			_KANA_ ^= 1;
#if T_TUNE
			KEY_INT = 1;
			KEY_HIT = 0;
#endif
			break;
		default:
			KEY_CHR = key106[wParam];
			if (KEY_CHR == 0) {
				break;
			}
			KEY_TBL[KEY_CHR] = 1;
			KEY_INT = 1;
			KEY_HIT = 1;
			keylog_printf("WINKEY DOWN vk=%02X chr=%02X hit=%u int=%u",
				(unsigned int)wParam, (unsigned int)KEY_CHR,
				(unsigned int)KEY_HIT, (unsigned int)KEY_INT);
			break;
	}
}

void winkeyup106(WPARAM wParam, LPARAM lParam) {

	wParam &= 0xff;
	KEY_TBL[key106[wParam]] = 0;
	keylog_printf("WINKEY UP   vk=%02X chr=%02X hit=%u int=%u",
		(unsigned int)wParam, (unsigned int)key106[wParam],
		(unsigned int)KEY_HIT, (unsigned int)KEY_INT);
#if T_TUNE
	/* 最後に押したキーが離されたときに発生（モディファイアキー等の誤検知を防ぐ） */
	if (wParam != 0x13 && KEY_CHR != 0 && KEY_CHR == key106[wParam])
#else
	if (wParam != 0x13 )
#endif
	{
		KEY_INT = 1;
		KEY_HIT = 0;
		KEY_CHR = 0;
	}
}



// ------------------------------------------------------------------------

// BASE
BYTE CHR_TBL0[]={
/* -- , ESC,  １,  ２,  ３,  ４,  ５,  ６,  0x00 */
  0x00,0x1b, '1', '2', '3', '4', '5', '6',
/*  ７,  ８,  ９,  ０,  −,  ＾,  BS, TAB,  0x08 */
   '7', '8', '9', '0', '-', '^',0x08,0x09,
/*  Ｑ,  Ｗ,  Ｅ,  Ｒ,  Ｔ,  Ｙ,  Ｕ,  Ｉ,  0x10 */
   'q', 'w', 'e', 'r', 't', 'y', 'u', 'i',
/*  Ｏ,  Ｐ,  ＠,  ［, Ent,Ctrl,  Ａ,  Ｓ,  0x18 */
   'o', 'p', '@', '[',0x0d,0x00, 'a', 's',
/*  Ｄ,  Ｆ,  Ｇ,  Ｈ,  Ｊ,  Ｋ,  Ｌ,  ；,  0x20 */
   'd', 'f', 'g', 'h', 'j', 'k', 'l', ';',
/*  ：,  全,SftL,  ］,  Ｚ,  Ｘ,  Ｃ,  Ｖ,  0x28 */
   ':',0x00,0x00, ']', 'z', 'x', 'c', 'v',
/*  Ｂ,  Ｎ,  Ｍ,  ，,  ．,  ／,SftR, [*],  0x30 */
   'b', 'n', 'm', ',', '.', '/',0x00,0x2a,
/* Alt, SPC, Cap, f.1, f.2, f.3, f.4, f.5,  0x38 */
  0x00, ' ',0x00, 'q', 'r', 's', 't', 'u',
/* f.6, f.7, f.8, f.9,f.10,Paus,ScrL, [7],  0x40 */
#if T_TUNE
  C_RW,C_ST,C_FF,0xe1,0x00,0x13,0x00, '7',
#else
  0xec,0xeb,0xe2,0xe1,0x00,0x13,0x00, '7',
#endif
/* [8], [9], [-], [4], [5], [6], [+], [1],  0x48 */
   '8', '9', '-', '4', '5', '6', '+', '1',
/* [2], [3], [0], [.], ???, ???, ???,f.11,  0x50 */
   '2', '3', '0', '.',0x00,0x00,0x00,0x00,
/*f.12,  _ ,  \ ,RLUP,RLDN,<＝>,XFER, END,  0x58 */
  0x00,0x00,'\\',0x0e,0x0f, '=',0xfe,0x11,
};

// SHIFT
BYTE CHR_TBL1[]={
/* -- , ESC,  １,  ２,  ３,  ４,  ５,  ６,  0x00 */
  0x00,0x1b, '!',0x22, '#', '$',0x25, '&',
/*  ７,  ８,  ９,  ０,  −,  ＾,  BS, TAB,  0x08 */
  0x27, '(', ')', '0', '=','~',0x12,0x09,
/*  Ｑ,  Ｗ,  Ｅ,  Ｒ,  Ｔ,  Ｙ,  Ｕ,  Ｉ,  0x10 */
   'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I',
/*  Ｏ,  Ｐ,  ＠,  ［, Ent,Ctrl,  Ａ,  Ｓ,  0x18 */
   'O', 'P','`', '{',0x0d,0x00, 'A', 'S',
/*  Ｄ,  Ｆ,  Ｇ,  Ｈ,  Ｊ,  Ｋ,  Ｌ,  ；,  0x20 */
   'D', 'F', 'G', 'H', 'J', 'K', 'L', '+',
/*  ：,  全,SftL,  ］,  Ｚ,  Ｘ,  Ｃ,  Ｖ,  0x28 */
  0x2a,0x00,0x00, '}', 'Z', 'X', 'C', 'V',
/*  Ｂ,  Ｎ,  Ｍ,  ，,  ．,  ／,SftR, [*],  0x30 */
   'B', 'N', 'M', '<', '>',0x3f,0x00,0x2a,
/* Alt, SPC, Cap, f.1, f.2, f.3, f.4, f.5,  0x38 */
  0x00, ' ',0x00, 'v', 'w', 'x', 'y', 'z',
/* f.6, f.7, f.8, f.9,f.10,Paus, ???, [7],  0x40 */
#if T_TUNE
  C_AR,C_EJ,C_AF,0x00,0x00,0x03,0x00, '7',
#else
  0x00,0x00,0x00,0x00,0x00,0x03,0x00, '7',
#endif
/* [8], [9], [-], [4], [5], [6], [+], [1],  0x48 */
   '8', '9', '-', '4', '5', '6', '+', '1',
/* [2], [3], [0], [.], ???, ???, ???,f.11,  0x50 */
   '2', '3', '0', '.',0x00,0x00,0x00,0x00,
/*f.12,  _ ,  \ ,RLUP,RLDN,<＝>,XFER, END,  0x58 */
  0x00, '_', '|',0x0e,0x0f, '=',0xfe,0x11,
};

// GRPH (Alt)
BYTE CHR_TBL2[]={
/* -- , ESC,  １,  ２,  ３,  ４,  ５,  ６,  0x00 */
  0x00,0x00,0xf1,0xf2,0xf3,0xf4,0xf5,0xf6,
/*  ７,  ８,  ９,  ０,  −,  ＾,  BS, TAB,  0x08 */
  0xf7,0xf8,0xf9,0xfa,0x8c,0x8b,0x00,0x00,
/*  Ｑ,  Ｗ,  Ｅ,  Ｒ,  Ｔ,  Ｙ,  Ｕ,  Ｉ,  0x10 */
  0xe0,0xe1,0xe2,0xe3,0xe4,0xe5,0xe6,0xe7,
/*  Ｏ,  Ｐ,  ＠,  ［, Ent,Ctrl,  Ａ,  Ｓ,  0x18 */
  0xf0,0x8d,0x8a,0xfc,0x00,0x00,0x7f,0xe9,
/*  Ｄ,  Ｆ,  Ｇ,  Ｈ,  Ｊ,  Ｋ,  Ｌ,  ；,  0x20 */
  0xea,0xeb,0xec,0xed,0xee,0xef,0x8e,0x89,
/*  ：,  全,SftL,  ］,  Ｚ,  Ｘ,  Ｃ,  Ｖ,  0x28 */
  0xfd,0x00,0x00,0xe8,0x80,0x81,0x82,0x83,
/*  Ｂ,  Ｎ,  Ｍ,  ，,  ．,  ／,SftR, [*],  0x30 */
  0x84,0x85,0x86,0x87,0x88,0xfe,0x00,0x9b,
/* Alt, SPC, Cap, f.1, f.2, f.3, f.4, f.5,  0x38 */
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
/* f.6, f.7, f.8, f.9,f.10,Paus, ???, [7],  0x40 */
  0x00,0x00,0x00,0x00,0x00,0x13,0x00,0x9a,
/* [8], [9], [-], [4], [5], [6], [+], [1],  0x48 */
  0x93,0x97,0x9c,0x95,0x96,0x94,0x9d,0x99,
/* [2], [3], [0], [.], ???, ???, ???,f.11,  0x50 */
  0x92,0x98,0x8f,0x91,0x00,0x00,0x00,0x00,
/*f.12,  _ ,  \ ,RLUP,RLDN,<＝>,XFER, END,  0x58 */
  0x00,0xff,0xfb,0x0e,0x0f,0x90,0xfe,0x11,
};

// CTRL
BYTE CHR_TBL3[]={
/* -- , ESC,  １,  ２,  ３,  ４,  ５,  ６,  0x00 */
  0x00,0x1b, '1', '2', '3', '4', '5', '6',
/*  ７,  ８,  ９,  ０,  −,  ＾,  BS, TAB,  0x08 */
   '7', '8', '9', '0',0x00,0x1e,0x08,0x09,
/*  Ｑ,  Ｗ,  Ｅ,  Ｒ,  Ｔ,  Ｙ,  Ｕ,  Ｉ,  0x10 */
  0x11,0x17,0x05,0x12,0x14,0x19,0x15,0x09,
/*  Ｏ,  Ｐ,  ＠,  ［, Ent,Ctrl,  Ａ,  Ｓ,  0x18 */
  0x0f,0x10, '@',0x1b,0x0d,0x00,0x01,0x13,
/*  Ｄ,  Ｆ,  Ｇ,  Ｈ,  Ｊ,  Ｋ,  Ｌ,  ；,  0x20 */
  0x04,0x06,0x07,0x08,0x0a,0x0b,0x0c, ';',
/*  ：,  全,SftL,  ］,  Ｚ,  Ｘ,  Ｃ,  Ｖ,  0x28 */
   ':',0x00,0x1c,0x1d,0x1a,0x18,0x03,0x16,
/*  Ｂ,  Ｎ,  Ｍ,  ，,  ．,  ／,SftR, [*],  0x30 */
  0x02,0x0e,0x0d,0x00,0x00,0x00,0x00,0x2a,
/* Alt, SPC, Cap, f.1, f.2, f.3, f.4, f.5,  0x38 */
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
/* f.6, f.7, f.8, f.9,f.10,Paus, ???, [7],  0x40 */
  0xec,0xeb,0xe2,0xe1,0x00,0x03,0x00, '7',
/* [8], [9], [-], [4], [5], [6], [+], [1],  0x48 */
   '8', '9', '-', '4', '5', '6', '+', '1',
/* [2], [3], [0], [.], ???, ???, ???,f.11,  0x50 */
   '2', '3', '0', '.',0x00,0x00,0x00,0x00,
/*f.12,  _ ,  \ ,RLUP,RLDN,<＝>,XFER, END,  0x58 */
  0x00,0x00,0x1c,0x0e,0x0f, '=',0xfe,0x11,
};

// ｶﾅ
BYTE CHR_TBL4[]={
/* -- , ESC,  １,  ２,  ３,  ４,  ５,  ６,  0x00 */
  0x00,0x1b, 0xC7, 0xCC, 0xB1, 0xB3, 0xB4, 0xB5,
/*  ７,  ８,  ９,  ０,  −,  ＾,  BS, TAB,  0x08 */
   0xD4, 0xD5, 0xD6, 0xDC, 0xCE, 0xCD,0x08,0x09,
/*  Ｑ,  Ｗ,  Ｅ,  Ｒ,  Ｔ,  Ｙ,  Ｕ,  Ｉ,  0x10 */
   0xC0, 0xC3, 0xB2, 0xBD, 0xB6, 0xDD, 0xC5, 0xC6,
/*  Ｏ,  Ｐ,  ＠,  ［, Ent,Ctrl,  Ａ,  Ｓ,  0x18 */
   0xD7, 0xBE, 0xDE, 0xDF,0x0d,0x00, 0xC1, 0xC4,
/*  Ｄ,  Ｆ,  Ｇ,  Ｈ,  Ｊ,  Ｋ,  Ｌ,  ；,  0x20 */
   0xBC, 0xCA, 0xB7, 0xB8, 0xCF, 0xC9, 0xD8, 0xDA,
/*  ：,  全,SftL,  ］,  Ｚ,  Ｘ,  Ｃ,  Ｖ,  0x28 */
   0xB9,0x00,0x00, 0xD1, 0xC2, 0xBB, 0xBF, 0xCB,
/*  Ｂ,  Ｎ,  Ｍ,  ，,  ．,  ／,SftR, [*],  0x30 */
   0xBA, 0xD0, 0xD3, 0xC8, 0xD9, 0xD2,0x00,0x2a,
/* Alt, SPC, Cap, f.1, f.2, f.3, f.4, f.5,  0x38 */
  0x00,0x20,0x00, 'q', 'r', 's', 't', 'u',
/* f.6, f.7, f.8, f.9,f.10,Paus, ???, [7],  0x40 */
  0xec,0xeb,0xe2,0xe1,0x00,0x13,0x00, '7',
/* [8], [9], [-], [4], [5], [6], [+], [1],  0x48 */
   '8', '9', '-', '4', '5', '6', '+', '1',
/* [2], [3], [0], [.], ???, ???, ???,f.11,  0x50 */
   '2', '3', '0', '.',0x00,0x00,0x00,0x00,
/*f.12,  _ ,  \ ,RLUP,RLDN,<＝>,XFER, END,  0x58 */
  0x00, 0xDB, 0xB0,0x0e,0x0f, '=',0xfe,0x11,
};

// ｶﾅ+ｼﾌﾄ
BYTE CHR_TBL5[]={
/* -- , ESC,  １,  ２,  ３,  ４,  ５,  ６,  0x00 */
  0x00,0x1b, 0xC7, 0xCC, 0xA7, 0xA9, 0xAA, 0xAB,
/*  ７,  ８,  ９,  ０,  −,  ＾,  BS, TAB,  0x08 */
   0xAC, 0xAD, 0xAE, 0xA6, 0xCE, 0xCD,0x12,0x09,
/*  Ｑ,  Ｗ,  Ｅ,  Ｒ,  Ｔ,  Ｙ,  Ｕ,  Ｉ,  0x10 */
   0xC0, 0xC3, 0xA8, 0xBD, 0xB6, 0xDD, 0xC5, 0xC6,
/*  Ｏ,  Ｐ,  ＠,  ［, Ent,Ctrl,  Ａ,  Ｓ,  0x18 */
   0xD7, 0xBE, 0xDE, 0xA2,0x0d,0x00, 0xC1, 0xC4,
/*  Ｄ,  Ｆ,  Ｇ,  Ｈ,  Ｊ,  Ｋ,  Ｌ,  ；,  0x20 */
   0xBC, 0xCA, 0xB7, 0xB8, 0xCF, 0xC9, 0xD8, 0xDA,
/*  ：,  全,SftL,  ］,  Ｚ,  Ｘ,  Ｃ,  Ｖ,  0x28 */
   0xB9,0x00,0x00, 0xA3, 0xAF, 0xBB, 0xBF, 0xCB,
/*  Ｂ,  Ｎ,  Ｍ,  ，,  ．,  ／,SftR, [*],  0x30 */
   0xBA, 0xD0, 0xD3, 0xA4, 0xA1, 0xA5,0x00,0x2a,
/* Alt, SPC, Cap, f.1, f.2, f.3, f.4, f.5,  0x38 */
  0x00, ' ',0x00, 'v', 'w', 'x', 'y', 'z',
/* f.6, f.7, f.8, f.9,f.10,Paus, ???, [7],  0x40 */
  0x00,0x00,0x00,0x00,0x00,0x03,0x00, '7',
/* [8], [9], [-], [4], [5], [6], [+], [1],  0x48 */
   '8', '9', '-', '4', '5', '6', '+', '1',
/* [2], [3], [0], [.], ???, ???, ???,f.11,  0x50 */
   '2', '3', '0', '.',0x00,0x00,0x00,0x00,
/*f.12,  _ ,  \ ,RLUP,RLDN,<＝>,XFER, END,  0x58 */
  0x00, 0xDB, 0xB0,0x0e,0x0f, '=',0xfe,0x11,
};




BYTE joykeyhook[] = {
/* -- , ESC,  １,  ２,  ３,  ４,  ５,  ６,  0x00 */
     0,   0,   0,   0,   0,   0,   0,   0,
/*  ７,  ８,  ９,  ０,  −,  ＾,  BS, TAB,  0x08 */
     0,   0,   0,   0,   0,   0,   0,   0,
/*  Ｑ,  Ｗ,  Ｅ,  Ｒ,  Ｔ,  Ｙ,  Ｕ,  Ｉ,  0x10 */
     0,   0,   0,   0,   0,   0,   0,   0,
/*  Ｏ,  Ｐ,  ＠,  ［, Ent,Ctrl,  Ａ,  Ｓ,  0x18 */
     0,   0,   0,   0,   1,   0,   0,   0,
/*  Ｄ,  Ｆ,  Ｇ,  Ｈ,  Ｊ,  Ｋ,  Ｌ,  ；,  0x20 */
     0,   0,   0,   0,   0,   0,   0,   0,
/*  ：,  全,SftL,  ］,  Ｚ,  Ｘ,  Ｃ,  Ｖ,  0x28 */
     0,   0,   0,   0,   1,   1,   1,   1,
/*  Ｂ,  Ｎ,  Ｍ,  ，,  ．,  ／,SftR, [*],  0x30 */
     0,   0,   0,   0,   0,   0,   0,   0,
/* Alt, SPC, Cap, f.1, f.2, f.3, f.4, f.5,  0x38 */
     0,   1,   0,   0,   0,   0,   0,   0,
/* f.6, f.7, f.8, f.9,f.10,NumL,ScrL, [7],  0x40 */
     0,   0,   0,   0,   0,   0,   0,   0,
/* [8], [9], [-], [4], [5], [6], [+], [1],  0x48 */
     1,   0,   0,   1,   0,   1,   0,   0,
/* [2], [3], [0], [.], ???, ???, ???,f.11,  0x50 */
     1};




void keyboard_init(void) { }

void keyboard_reset(void) { }

void keyboard_term(void) { }


void keyboard_inkey(BYTE sw, BYTE *data) {

	BYTE	key;
	BYTE	shiftflg;

	*(WORD *)data = 0xff;
	shiftflg = KEY_TBL[0x2a] | KEY_TBL[0x36];	/* 990220 puni 右シフト有効 */
	key = 0;

	if (KEY_TBL[0x1d] | KEY_TBL[0x9d]) {
		data[0] ^= 0x01;								// ctrl	(bit0)
	}
	if (shiftflg) {
		data[0] ^= 0x02;								// shift(bit1)
	}
	if (_KANA_) {
		data[0] ^= 0x04;								// kana	(bit2)
	}
	if (_CAPS_) {
		data[0] ^= 0x08;								// caps	(bit3)
	}
	if (KEY_TBL[0x38]) {
		data[0] ^= 0x10;								// graph(bit4)
	}
//		data[0] ^= 0x20;								// Rep	(bit5)

	if (!KEY_HIT) {
#if T_TUNE
		data[1] = 0x00;
#endif
		return;
	}
	if ((sw) && (KEY_CHR < 0x52) && (joykeyhook[KEY_CHR])) {	// 991004
		return;
	}

#if T_TUNE
	if ((KEY_CHR>=0x3b && KEY_CHR<=0x42) ||				// f.1 - f.8
#else
	if ((KEY_CHR>=0x3b && KEY_CHR<=0x3f) ||				// f.1 - f.5
#endif
		(KEY_CHR>=0x47 && KEY_CHR<=0x53) || 			// 10-key
		(KEY_CHR==0x37) || (KEY_CHR==0xb5)) {
		data[0] ^= 0x80;								// Func	(bit7)
	}

	if (KEY_CHR == 0xcd) {
		if (sw) return;								// 991004
		data[1] = 0x1c;								// right
	}
	else if (KEY_CHR == 0xcb) {
		if (sw) return;								// 991004
		data[1] = 0x1d;								// left
	}
	else if (KEY_CHR == 0xc8) {
		if (sw) return;								// 991004
		data[1] = 0x1e;								// up
	}
	else if (KEY_CHR == 0xd0) {
		if (sw) return;								// 991004
		data[1] = 0x1f;								// down
	}
	else if (KEY_CHR == 0xd2) {
		data[1] = 0x12;								// INS
	}
	else if (KEY_CHR == 0xd3) {
		data[1] = 0x08;								// DEL
	}
	else if (KEY_CHR == 0xc7) {			/* 990220 puni addes HOMEキー */
		data[1] = (BYTE)0x0b + shiftflg;
	}
#if 0
	else if (KEY_CHR == 0x29) {						//
		data[0] |= 1 | 4;
		data[1] = 0xff;
	}
#endif
	else if (KEY_CHR == 0x9c) {					// pad enter
		key = 0x1c;
	}
	else if (KEY_CHR>0x00 && KEY_CHR<0x60) {
		key = KEY_CHR;
	}

#if !T_TUNE
	data[0] &= (BYTE)~0x40;						// keyin(bit6)
#endif

	if (key) {
		if (_KANA_) {							// kana
			if (shiftflg) {
				data[1] = CHR_TBL5[key];		// shift
			}
			else {
				data[1] = CHR_TBL4[key];
			}
		}
		else {
			if (!(data[0] & 1)) {
				data[1] = CHR_TBL3[key];		// ctrl
			}
			else if (!(data[0] & 0x10)) {
				data[1] = CHR_TBL2[key];		// grph
			}
			else {
				if (shiftflg) {
					data[1] = CHR_TBL1[key];	// shift
				}
				else {
					data[1] = CHR_TBL0[key];
				}
				if (_CAPS_) {						// caps
					if (((data[1] >= 'a') && (data[1] <= 'z')) ||
						((data[1] >= 'A') && (data[1] <= 'Z'))) {
						data[1] ^= 0x20;
					}
				}
			}
		}
	}
#if T_TUNE
	if( data[1] != 0x00 )
		data[0] &= (BYTE)~0x40;						// keyin(bit6)

	if (KEY_CHR == 0x45 && KEY_TBL[KEY_CHR] ==0) {
#else
	if (KEY_CHR == 0x45) {					// PauseKey対策
#endif
		KEY_INT = 1;							// このタイミングでリリース
		KEY_HIT = 0;
		KEY_CHR = 0;
	}
	if (data[1] == 0x0d || KEY_CHR == 0x1c || KEY_CHR == 0x9c ||
		KEY_TBL[0x1c] || KEY_TBL[0x9c]) {
		keylog_printf("KBD INKEY d0=%02X d1=%02X chr=%02X hit=%u int=%u tbl1c=%u tbl9c=%u mode=%u",
			(unsigned int)data[0], (unsigned int)data[1], (unsigned int)KEY_CHR,
			(unsigned int)KEY_HIT, (unsigned int)KEY_INT,
			(unsigned int)KEY_TBL[0x1c], (unsigned int)KEY_TBL[0x9c], (unsigned int)sw);
	}
}


void keyboard_e3(BYTE *data) {

		int		i;
		BYTE	bit;

static	BYTE	gamekey[] = {
				0x10, 0x11, 0x12, 0x1e, 0x20, 0x2c, 0x2d, 0x2e,
				0x47, 0x4b, 0x4f, 0x48, 0x50, 0x49, 0x4d, 0x51,
				0x01, 0x02, 0x4a, 0x4e, 0x37, 0x0f, 0x39, 0x1c};

	for (i=0; i<24;) {
		*data = 0;
		for (bit=0x80; bit; bit>>=1, i++) {
			if (KEY_TBL[gamekey[i]]) {
				*data |= bit;
			}
		}
		data++;
	}
}

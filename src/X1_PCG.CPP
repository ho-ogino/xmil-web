#include	<windows.h>
#include	<stdio.h>
#include	<string.h>
#include	<stdlib.h>
#include	"common.h"
#include	"x1.h"
#include	"x1_crtc.h"
#include	"x1_pcg.h"
#include	"x1_vram.h"
#include	"keylog.h"

		PCG_TABLE	pcg;
		BYTE		*KFONT;
		BYTE		*PFONT;
		BYTE		NULLCODE[32];

/***********************************************************************
	PCG
***********************************************************************/

static void reset_pcgoff(void) {
#if (T_TUNE==0)
	*(DWORD *)&pcg.vsync = 0;
	*(DWORD *)&pcg.roff0 = 0;
#endif
}

void init_pcg(void) {

static	BYTE	initpcg = 0;

	if (!initpcg) {
		initpcg++;
		ZeroMemory(&pcg, sizeof(PCG_TABLE));
		ZeroMemory(NULLCODE, 32);
	}
	else {
		reset_pcgoff();
	}
}


WORD pcg_offset(void) {

	if (TXT_RAM[TEXT_ATR + 0x07ff] & 0x20) {
		return(0x7ff);
	}
	if (TXT_RAM[TEXT_ATR + 0x03ff] & 0x20) {
		return(0x3ff);
	}
	if (TXT_RAM[TEXT_ATR + 0x05ff] & 0x20) {
		return(0x5ff);
	}
	if (TXT_RAM[TEXT_ATR + 0x01ff] & 0x20) {
		return(0x1ff);
	}
	return(0x7ff);
}


WORD knj_offset(void) {

	if (!(TXT_RAM[TEXT_ATR + 0x07ff] & 0x20)) {
		return(0x7ff);
	}
	if (!(TXT_RAM[TEXT_ATR + 0x03ff] & 0x20)) {
		return(0x3ff);
	}
	if (!(TXT_RAM[TEXT_ATR + 0x05ff] & 0x20)) {
		return(0x5ff);
	}
	if (!(TXT_RAM[TEXT_ATR + 0x01ff] & 0x20)) {
		return(0x1ff);
	}
	return(0x7ff);
}


// JIS → フォントポインタ変換（元はx86インラインアセンブリ）
// JISコードをShift-JISに変換し、KNJ_FNT内の対応フォントデータへのポインタを返す
BYTE* __fastcall getfontjis(WORD jis) {
    static DWORD s_nullcnt = 0;
    static DWORD s_okcnt = 0;
    // bit15またはbit7がセットされていればエラー
    if (jis & 0x8080) {
        if (keylog_enabled() && s_nullcnt < 128) {
            keylog_printf("KNJ getfontjis NULL jis=%04X reason=bit80", jis);
        }
        s_nullcnt++;
        return NULLCODE;
    }

    BYTE hi = (BYTE)(jis >> 8) + 0x21;
    BYTE lo = (BYTE)(jis & 0xFF);
    BYTE dl = (hi & 1) ? (BYTE)0x5E : (BYTE)0;

    hi = (BYTE)((signed char)hi >> 1); // SAR (算術右シフト)
    lo += dl;
    hi = (BYTE)((hi ^ 0x20) | 0x80);
    if (lo >= 0x60) lo++;
    lo += 0x1F;

    WORD ax = ((WORD)hi << 8) | lo;

    // sub ax, 0x8140; jc → エラー
    if (ax < 0x8140) {
        if (keylog_enabled() && s_nullcnt < 128) {
            keylog_printf("KNJ getfontjis NULL jis=%04X sjis=%04X reason=lt8140", jis, ((WORD)hi << 8) | lo);
        }
        s_nullcnt++;
        return NULLCODE;
    }
    ax -= 0x8140;

    BYTE* edx;
    if (ax < (0x84C0 - 0x8140)) {
        edx = KNJ_FNT + 0x1000;
    } else {
        // sub ax, (0x8890-0x8140); jc → エラー
        if (ax < (0x8890 - 0x8140)) {
            if (keylog_enabled() && s_nullcnt < 128) {
                keylog_printf("KNJ getfontjis NULL jis=%04X reason=gap84c0_8890", jis);
            }
            s_nullcnt++;
            return NULLCODE;
        }
        ax -= (WORD)(0x8890 - 0x8140);
        edx = KNJ_FNT + 0x8000;
        if (ax >= (0xA000 - 0x8890)) {
            // sub ax, (0xE040-0x8890); jc → エラー
            if (ax < (0xE040 - 0x8890)) {
                if (keylog_enabled() && s_nullcnt < 128) {
                    keylog_printf("KNJ getfontjis NULL jis=%04X reason=gapA000_E040", jis);
                }
                s_nullcnt++;
                return NULLCODE;
            }
            ax -= (WORD)(0xE040 - 0x8890);
            if (ax >= (0xEAB0 - 0xE040)) {
                if (keylog_enabled() && s_nullcnt < 128) {
                    keylog_printf("KNJ getfontjis NULL jis=%04X reason=gteEAB0", jis);
                }
                s_nullcnt++;
                return NULLCODE;
            }
            edx = KNJ_FNT + 0x36E00;
        }
    }
    BYTE* ret = edx + ((DWORD)ax << 5);
    if (keylog_enabled() && s_okcnt < 64) {
        DWORD ofs = (DWORD)(ret - KNJ_FNT);
        keylog_printf("KNJ getfontjis OK jis=%04X ofs=%05X", jis, (unsigned int)ofs);
    }
    s_okcnt++;
    return ret;
}


static BYTE adr2jis_tbl[4] = {0x20, 0x60, 0x40, 0x00};

// TRAM アドレス → JISコード変換（元はx86インラインアセンブリの正確な移植）
// アセンブリの核心部分:
//   mov cx, ax; shl cx, 3; mov cl, al; and cx, 071fh
//   → cx_hi = ((adr & 0xFF) >> 5) & 0x07, cx_lo = (adr & 0xFF) & 0x1F
//   ※ shl cx,3後にcl=al(元の下位byte)で上書きするため、cx_hiにはalの上位3bitが入る
WORD __fastcall adr2jis_x1t(WORD adr) {
    static DWORD s_logcnt = 0;

    BYTE orig_al = (BYTE)(adr & 0xFF);
    BYTE cx_hi = (BYTE)((orig_al >> 5) & 0x07);
    BYTE cx_lo = (BYTE)(orig_al & 0x1F);

    // mov al, ah; mov ah, 0  (分岐判定値 = アドレス上位5bit)
    BYTE branch_val = (BYTE)(adr >> 8) & 0x1F;

    WORD result;
    if (branch_val < 4) {
        // a2jx1t_2121: or ch, 20h; and eax,3; or cl, tbl[eax]
        // ※ and eax,3 時点でeax=branch_val (mov al,ah; mov ah,0 の結果)
        BYTE ch = (BYTE)(cx_hi | 0x20);
        BYTE cl = (BYTE)(cx_lo | adr2jis_tbl[branch_val & 3]);
        result = (WORD)(((WORD)ch << 8) | cl);
    } else if (branch_val <= 0x1C) {
        // a2jxt1_us
        BYTE ch = cx_hi;
        if (branch_val & 1) ch |= 0x08;   // shr al,1; jnc; or ch,8

        // add al,7; div 3; shl al,1; inc ah; shl ax,3; shl ah,2; xchg al,ah; or ax,cx
        // 整理すると: result_hi = (q<<4)|ch, result_lo = ((r+1)<<5)|cx_lo
        BYTE val = (BYTE)((branch_val >> 1) + 7);
        BYTE q = (BYTE)(val / 3);
        BYTE r = (BYTE)(val % 3);
        BYTE result_hi = (BYTE)((q << 4) | ch);
        BYTE result_lo = (BYTE)(((r + 1) << 5) | cx_lo);
        result = (WORD)(((WORD)result_hi << 8) | result_lo);
    } else {
        // or ch, 50h; (fall to a2jx1t_2121) or ch, 20h; and eax,3; or cl, tbl[eax]
        // ※ テーブルインデックスも branch_val & 3
        BYTE ch = (BYTE)(cx_hi | 0x70);
        BYTE cl = (BYTE)(cx_lo | adr2jis_tbl[branch_val & 3]);
        result = (WORD)(((WORD)ch << 8) | cl);
    }

    if (keylog_enabled() && s_logcnt < 64) {
        keylog_printf("KNJ adr2jis_x1t adr=%04X jis=%04X bv=%02X", adr, result, (unsigned)branch_val);
        s_logcnt++;
    }
    return result;
}

#if T_TUNE
/* CPU wait for next H-SYNC */
#define wait_H_SYNC() event_wait_cpu(0,event_timeleft(&V_SYNC_event) % H_SYNC_interval)

WORD nowsyncoffset(WORD *line)
{
	EV_TIME video_pos;
	WORD v_pos, h_clk;
	WORD	ret;

	/* ビデオ描画位置の取得 */
	video_pos = get_frame_pos();
	h_clk = (WORD)TIME_TO_CYCLES(0,get_hpos(video_pos));

	/* overclock syncronizing */
	if( h_clk >= x1flg.HSYNC_CLK-2)
	{
		/*
		水平開始位置から数えたＣＰＵの実行クロック数が、４Ｍｈｚ時の
		水平描画時間（２５０クロック）を過ぎていれば、それは次のライン
		へのアクセスなので、H-BLANKウェイトをかけて次のラインになるまで
		ＣＰＵをとめる。
		*/
		wait_H_SYNC();
		video_pos = get_frame_pos();
		h_clk = 0;
	}
	v_pos = (WORD)get_vpos(video_pos);

	/* charactor line */
	*line = (WORD)(v_pos % crtc.fnty);	// テキストの何ライン目か

	/* charactor offset V */
	ret = (WORD)((v_pos / crtc.fnty) * crtc.TXT_XL + crtc.TXT_TOP) ;
	/* charactor offset H */
	if (x1flg.HSYNC_CLK) {
		ret += (h_clk * crtc.TXT_XL) / x1flg.HSYNC_CLK;
	}

	if (ret >= 0x0800) {
		ret = 0x07ff;		// オーバーフロー
	}
	return(ret);			// まさに表示しようとしている TXT-RAMアドレス
}
#else //T_TUNE
WORD nowsyncoffset(void) {

	WORD	ret;

	ret = (((v_cnt - crtc.CRT_YL) / crtc.fnty) + crtc.TXT_YL) * crtc.TXT_XL
															+ crtc.TXT_TOP;
	if (x1flg.HSYNC_CLK) {
		ret += (h_cnt * crtc.TXT_XL) / x1flg.HSYNC_CLK;
	}

	if (ret >= 0x0800) {
		ret = 0x07ff;		// オーバーフロー
	}
	return(ret);			// まさに表示しようとしている TXT-RAMアドレス
}
#endif //T_TUNE


X1_IOW x1_pcg_w(WORD port, BYTE value) {

	BYTE	chr;
	WORD	off, l;

	if (crtc.SCRN_BITS & SCRN_PCGMODE) {
#if T_TUNE
		/* H-BLANK wait */
		wait_H_SYNC();	//H-BLANKまでウェイトをかけてからアクセスされる。
#endif
		off = pcg_offset();
		chr = TXT_RAM[TEXT_ANK + off];
		if (TXT_RAM[TEXT_KNJ + off] & 0x90) {
			chr &= 0xfe;
			l = port & 15;
		}
		else {
			l = (port >> 1) & 7;
		}
		switch(port & 0xff00) {
			case 0x1500:
				pcg.B[chr][l] = value;
				break;
			case 0x1600:
				pcg.R[chr][l] = value;
				break;
			case 0x1700:
				pcg.G[chr][l] = value;
				break;
		}
	}
	else {
#if T_TUNE
		off = nowsyncoffset(&l);
		chr = TXT_RAM[TEXT_ANK + off];
		switch(port & 0xff00) {
			case 0x1500:
				pcg.B[chr][l] = value;
				break;
			case 0x1600:
				pcg.R[chr][l] = value;
				break;
			case 0x1700:
				pcg.G[chr][l] = value;
				break;
		}
#else //T_TUNE
		off = nowsyncoffset();						// 990622 puni
		chr = TXT_RAM[TEXT_ANK + off];
		if (pcg.vsync) {
			reset_pcgoff();
		}
		switch(port & 0xff00) {
			case 0x1500:
				pcg.B[chr][pcg.woff1++] = value;
				pcg.woff1 &= 7;
				break;
			case 0x1600:
				pcg.R[chr][pcg.woff2++] = value;
				pcg.woff2 &= 7;
				break;
			case 0x1700:
				pcg.G[chr][pcg.woff4++] = value;
				pcg.woff4 &= 7;
				break;
		}
#endif //T_TUNE
	}
}


X1_IOR x1_pcg_r(WORD port) {

static	WORD	localknj = -1;
		WORD	off,l;
		BYTE	chr,knj,val;
		WORD	jis;

	val = 0xff;
	if (crtc.SCRN_BITS & SCRN_PCGMODE) {
#if T_TUNE
		/* H-BLANK wait */
		wait_H_SYNC();	//H-BLANKまでウェイトをかけてからアクセスされる。
#endif
		l = port & 0x0f;
		if ((port & 0xff00) == 0x1400) {
			off = knj_offset();
			chr = TXT_RAM[off + TEXT_ANK];
			knj = TXT_RAM[off + TEXT_KNJ];
			if (knj & 0x80) {
				jis = ((WORD)knj << 8) | chr;
				if (localknj != jis) {
					localknj = jis;
					PFONT = getfontjis(adr2jis_x1t(jis));
				}
				l <<= 1;
				if (knj & 0x40) {
					val = PFONT[l + 1];
				}
				else {
					val = PFONT[l];
				}
			}
			else if (crtc.SCRN_BITS & SCRN_CPUFONT) {
				val = KNJ_FNT[(chr << 4) + l];
			}
			else {
				val = ANK_FNT[chr][l >> 1];
			}
		}
		else {
			off = pcg_offset();
			chr = TXT_RAM[TEXT_ANK + off];
			if (TXT_RAM[TEXT_KNJ + off] & 0x90) {
				chr &= 0xfe;
			}
			else {
				l >>= 1;
			}
			switch(port & 0xff00) {
				case 0x1500:
					val = pcg.B[chr][l];
					break;
				case 0x1600:
					val = pcg.R[chr][l];
					break;
				case 0x1700:
					val = pcg.G[chr][l];
					break;
			}
		}
	}
	else {
#if T_TUNE
		off = nowsyncoffset(&l);
		chr = TXT_RAM[TEXT_ANK + off];
		switch(port & 0xff00) {
			case 0x1400:
				val = ANK_FNT[chr][l];
				break;
			case 0x1500:
				val = pcg.B[chr][l];
				break;
			case 0x1600:
				val = pcg.R[chr][l];
				break;
			case 0x1700:
				val = pcg.G[chr][l];
				break;
		}
#else //T_TUNE
		off = nowsyncoffset();					// 990622 puni
		chr = TXT_RAM[TEXT_ANK + off];
		if (pcg.vsync) {
			reset_pcgoff();
		}
		switch(port & 0xff00) {
			case 0x1400:
				val = ANK_FNT[chr][pcg.roff0++];
				pcg.roff0 &= 7;
				break;
			case 0x1500:
				val = pcg.B[chr][pcg.roff1++];
				pcg.roff1 &= 7;
				break;
			case 0x1600:
				val = pcg.R[chr][pcg.roff2++];
				pcg.roff2 &= 7;
				break;
			case 0x1700:
				val = pcg.G[chr][pcg.roff4++];
				pcg.roff4 &= 7;
				break;
		}
#endif //T_TUNE
	}
	return(val);
}

/***********************************************************************
	KANJI
***********************************************************************/

WORD jis2adr_x1(WORD jis) {

	BYTE	jh, jl;
	WORD	ret;

	jh = (BYTE)(jis >> 8);
	jl = (BYTE)(jis & 0xff);
	if (jh > 0x28) {
		ret = 0x4000 + ((jh - 0x30) * 0x600);
	}
	else {
		ret = 0x0100 + ((jh - 0x21) * 0x600);
	}
	if (jl >= 0x20) {
		ret += ((jl-0x20)*0x10);
	}
	return(ret);
}

WORD adr2jis_x1(WORD adr) {

	BYTE	jis[2];

	if (adr < 0x4000) {
		jis[1] = (BYTE)(((adr - 0x0100) / 0x0600) + 0x21);
	}
	else {
		jis[1] = (BYTE)(((adr - 0x4000) / 0x0600) + 0x30);
	}
	if (jis[1] > 0x28) {
		adr -= (0x4000 + ((jis[1] - 0x30) * 0x600));
	}
	else {
		adr -= (0x0100 + ((jis[1] - 0x21) * 0x600));
	}
	jis[0] = (BYTE)((adr >> 4) + 0x20);
	return(*(WORD *)jis);
}


BYTE	KCODE[2] = {0, 0};
BYTE	K_CNT = 0;
BYTE	K_FLG = 0;

X1_IOW x1_knj_w(WORD port, BYTE value) {

	if (port == 0x0e80) {
		KCODE[0] = value;
	}
	else if (port == 0x0e81) {
		KCODE[1] = value;
	}
	else if (port == 0x0e82) {
		KFONT = getfontjis(adr2jis_x1((*(WORD *)KCODE) & 0xfff0));
	}
}

X1_IOR x1_knj_r(WORD port) {

	BYTE	ret;
	static	int force_knj_ff_init = 0;
	static	int force_knj_ff = 0;

	if (!force_knj_ff_init) {
		const char* env = getenv("XMIL_FORCE_KNJROM_FF");
		force_knj_ff = (env && *env && strcmp(env, "0") != 0) ? 1 : 0;
		force_knj_ff_init = 1;
	}
	if (force_knj_ff) {
		return 0xFF;
	}

	if (KCODE[1]) {
		if (port == 0x0e80) {
			ret = KFONT[K_CNT << 1];
			K_FLG |= 1;
		}
		else if (port == 0x0e81) {
			ret = KFONT[(K_CNT << 1) + 1];
			K_FLG |= 2;
		}
		if (K_FLG == 3) {
			K_FLG = 0;
			K_CNT = (BYTE)((K_CNT + 1) & 15);
		}
	}
	else {
		if (port == 0x0e80) {
			ret = (BYTE)(jis2adr_x1(KCODE[0] << 8) >> 8);
		}
		else {
			ret = 0;
		}
	}
	return(ret);
}

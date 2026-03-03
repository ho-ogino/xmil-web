typedef struct {
	BYTE	B[256][8];
	BYTE	R[256][8];
	BYTE	G[256][8];
#if (T_TUNE==0)
	BYTE	vsync;
	BYTE	woff1;
	BYTE	woff2;
	BYTE	woff4;
	BYTE	roff0;
	BYTE	roff1;
	BYTE	roff2;
	BYTE	roff4;
#endif
} PCG_TABLE;

extern	PCG_TABLE	pcg;

extern	BYTE		ANK_FNT[256][8];

//**********************************************************************

void init_pcg(void);

X1_IOW x1_pcg_w(WORD port, BYTE value);
X1_IOR x1_pcg_r(WORD port);

X1_IOW x1_knj_w(WORD port, BYTE value);
X1_IOR x1_knj_r(WORD port);

BYTE * __fastcall getfontjis(WORD jis);
WORD __fastcall adr2jis_x1t(WORD adr);

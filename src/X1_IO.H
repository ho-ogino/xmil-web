#define	X1_IOW	void __fastcall
#define	X1_IOR	BYTE __fastcall

void __fastcall Z80_Out(WORD port, BYTE value);
BYTE __fastcall Z80_In(WORD port);

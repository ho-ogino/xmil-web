//----------------------------------------------------------------------------
//
//  Z80R : Z80 Engine  for Intel x86 Protectmode (80386 later)
//
//                                       Copyright by Studio Milmake 1999-2000
//
//----------------------------------------------------------------------------

#define Z80RPUB	void __fastcall
#define	Z80RASM __declspec(naked) static void __fastcall
typedef void (__fastcall * Z80ROPCODE)(void);

#define S_FLAG          0x80
#define Z_FLAG          0x40
#define H_FLAG          0x10
#define V_FLAG          0x04
#define N_FLAG          0x02
#define C_FLAG          0x01

typedef union {
	struct {
		BYTE	l;
		BYTE	h;
	} B;
	WORD	W;
} z80_pair;


typedef struct {
	z80_pair	AF,BC,DE,HL,IX,IY,PC,SP;	/* -NS- */
	z80_pair	AF2,BC2,DE2,HL2;			/* -NS- */
	BYTE		I, IM, R, R2;
	WORD		IFF;
} Z80_Regs;



extern	Z80_Regs	R;
extern	WORD		Z80_ICount;
extern	BYTE		ZSPtable[];


BYTE Z80_Able_interrupt(void);
void __fastcall Z80_Cause_Interrupt(BYTE irq);
void __fastcall Z80_Cause_Interrupt2(BYTE irq);
void Z80_NonMaskedInterrupt(void);

void Z80_Reset(void);
void Z80_Execute(void);
#if T_TUNE
void Z80_ExecuteOne(void);
#endif


#define	IFF_IFLAG	0
#define	IFF_IRQ		1
#define	IFF_NMI		2
#define	IFF_HALT	3


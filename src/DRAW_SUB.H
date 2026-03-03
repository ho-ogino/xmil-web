// X1
extern void		width80x25_200line(void);		// 80x25 200line モード

// turbo
extern	void	width80x25_400line(void);		// 80x25 400line モード
extern	void	width80x12_200line(void);		// 80x12 200line モード
extern	void	width80x12_400line(void);		// 80x12 400line モード
extern	void	width80x20_15khz(void);			// 80x20 15KHz モード
extern	void	width80x10_15khz(void);			// 80x10 15KHz モード
extern	void	width80x20_24khz(void);			// 80x20 24KHz モード
extern	void	width80x10_24khz(void);			// 80x10 24KHz モード

// turboZ
extern	void	width40x25_64s(void);			// 40x25 64colors
extern	void	width40x25_64x2(void);			// 40x25 64colorsx2
extern	void	width40x25_4096(void);			// 40x25 4096colors(Low-reso)
extern	void	width40x25_64h(void);			// 40x25 64colors high-reso
extern	void	width80x25_64s(void);			// 80x25 64colors
extern	void	width40x12_64l(void);			// 40x25 64colors
extern	void	width40x12_64x2(void);			// 40x25 64colors
extern	void	width40x12_4096(void);			// 40x12 4096colors(Low-reso)
extern	void	width40x12_64h(void);			// 40x12 64colors high-reso
extern	void	width80x12_64s(void);			// 80x25 64colors low-reso

// -------------------------------------------------------------------------

void init_drawtable(void);



extern	DWORD	bmp2byte_table[32][512];

#define	BMP2B_TEXT			(0x800*0)
#define	BMP2B_BLUE			(0x800*16)
#define	BMP2B_RED			(0x800*17)
#define	BMP2B_GREEN			(0x800*18)

#define	BMP2B_BLUE2			(0x800*1)
#define	BMP2B_RED2			(0x800*2)
#define	BMP2B_GREEN2		(0x800*4)

#define	BMP2B_BIT0			(0x800*16)
#define	BMP2B_BIT1			(0x800*17)
#define	BMP2B_BIT2			(0x800*18)
#define	BMP2B_BIT3			(0x800*1)
#define	BMP2B_BIT4			(0x800*2)
#define	BMP2B_BIT5			(0x800*4)
#define	BMP2B_BIT6			(0x800*19)
#define	BMP2B_BIT7			(0x800*20)

extern	DWORD	text_x2_table[16][64];

extern	BYTE	cwork[];
extern	DWORD	mask1;
extern	DWORD	mask2;

extern	BYTE	fontycnt;

extern	WORD	PAL4096_BANK0[];
extern	WORD	PAL4096_BANK1[];

extern	DWORD	x2left[];
extern	DWORD	x2right[];

extern	void	(*planeeffects[])(void);
extern	void	(*planeeffects16[])(void);


// これらの関数は引数レジスタ渡しです。

// esi = font face pointer
// edi = vrampos
// edx = text color | reverse flag (TXT, KNJ)
// ecx = loop count (text height)

extern void (*txt8effects[])(void);
extern void (*pcg8effects[])(void);
extern void (*knj8effects[])(void);

extern void (*txt16effects[])(void);
extern void (*pcg16effects[])(void);
extern void (*knj16effects[])(void);


// ds:esi = font face pointer
// es:edi = dest
//    ecx = loop count (text height)
extern void (*txtbeffects[])(void);
extern void (*knjbeffects[])(void);
extern void (*extbeffects[])(void);

extern void (*txtbeffects16[])(void);
extern void (*knjbeffects16[])(void);
extern void (*pcgbeffectsx2[])(void);


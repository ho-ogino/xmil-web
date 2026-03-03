
extern	WORD	inx1f_counter;
#define	INX1F_INC	inx1f_counter++;

void INX1F_init(void);
void INX1F_inittable(void);
void INX1F_reset(void);
void INX1F_makesample(DWORD samplecount);
void INX1F_resetsamplepos(void);

void INX1F_PSGctrl(BYTE reg, BYTE value);
void INX1F_OPMctrl(BYTE reg, BYTE value);

void INX1F_PSGmode(BYTE withpuchinoise);

void INX1F_logging(void);
void INX1F_alltrash(void);


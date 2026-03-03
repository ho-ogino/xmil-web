void initload(void);
void initsave(void);

extern	BYTE	init_flag;

#define	INIT_RENEWAL	init_flag = 1;
#define	INIT_RESET		init_flag = 0;

BYTE solveBOOL(LPSTR str);

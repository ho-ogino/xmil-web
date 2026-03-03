typedef struct {
	BYTE	PORT_A;
	BYTE	PORT_B;
	BYTE	PORT_C;
	BYTE	MODE;
	BYTE	IO_MODE;
} s8255_TABLE;

extern	s8255_TABLE		s8255;

void init_8255(void);
X1_IOW x1_8255_w(WORD port, BYTE value);
X1_IOR x1_8255_r(WORD port);


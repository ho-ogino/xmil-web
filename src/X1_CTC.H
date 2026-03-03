#if T_TUNE
void init_ctc(void);
X1_IOW x1_ctc_w(WORD port, BYTE value);
X1_IOR x1_ctc_r(WORD port);
#else //T_TUNE

typedef struct {
	BYTE	value[4];
	long	countmax[4];
	long	count[4];
	BYTE	vector;
	BYTE	int_flag;
	BYTE	bakval[4];
} CTC_TABLE;

void init_ctc(void);
void x1_ctc_int(void);
X1_IOW x1_ctc_w(WORD port, BYTE value);
X1_IOR x1_ctc_r(WORD port);

#endif

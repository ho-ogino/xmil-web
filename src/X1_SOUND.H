extern	BYTE	changehz;
#define	INIT_SOUNDS		changehz = 1;

void x1_opm_reset(void);
void x1_opm_stop(void);
void x1_opm_cont(void);
X1_IOW x1_opm_reg(WORD port, BYTE value);
X1_IOW x1_opm_dat(WORD port, BYTE value);
X1_IOR x1_opm_stat(WORD port);

void x1_psg_reset(void);
void x1_psg_stop(void);
void x1_psg_cont(void);
X1_IOW x1_psg_reg(WORD port, BYTE value);
X1_IOW x1_psg_dat(WORD port, BYTE value);
X1_IOR x1_psg_sta(WORD port);

void opm_trace_cnt(void);

void x1_sound_init(DWORD resolitionHz);
void x1_sound_update_frame(void);

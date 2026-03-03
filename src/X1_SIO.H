
void init_sio(void);
#if !T_TUNE
void x1_sio(void);
#endif

X1_IOW x1_sio_w(WORD port, BYTE value);
X1_IOR x1_sio_r(WORD port);

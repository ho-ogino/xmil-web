#ifndef __X1_SASI__
#define __X1_SASI__

#if T_TUNE

typedef struct {
	BYTE phase;				// sasi phase
	BYTE id;				// selection taget ID
	BYTE cmd[15];			// command buffers
	DWORD addr;				// coommand pointer / data pointer
	DWORD len;				// command length / sector length
	BYTE  msg;				// command message / message out code
	char filename[64];		// filename
	BYTE buf[256];			// sector buffer
} SASI_TABLE;

extern SASI_TABLE sasi;

void init_sasi(void);
X1_IOW x1_sasi_w(WORD port, BYTE value);
X1_IOR x1_sasi_r(WORD port);

#endif /* T_TUNE */

#endif

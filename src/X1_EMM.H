#ifndef __X1_EMM__
#define __X1_EMM__

#if T_TUNE

#define MAX_EMM 10  /* BASICのサポート範囲なので */

typedef struct {
	/* EMMx64 registers + ROM registers */
	DWORD	addr[MAX_EMM+1];
	/* file buffer status */
	char	filename[16];	// current imagefilename
	BYTE	buf[256];		// current buffer of memory page
	DWORD	filesize;		// file size
	BYTE	sel;			// select file
	DWORD	page;			// current buffer page
	WORD	buf_size;		// current buffer size
	BYTE	dirty_buf;		// dirty flag of current page
} EMM_TABLE;

extern EMM_TABLE emm;

void init_emm(void);

X1_IOW x1_emm_w(WORD port, BYTE value);
X1_IOR x1_emm_r(WORD port);
X1_IOW x1_rom_w(WORD port, BYTE value);
X1_IOR x1_rom_r(WORD port);

#endif /* T_TUNE */

#endif

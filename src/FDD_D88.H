typedef struct {				// Header Part (size:2B0h)
	BYTE	fd_name[17];		// Disk Name
	BYTE	reserved1[9]; 		// Reserved
	BYTE	protect;			// Write Protect bit:4
	BYTE	fd_type;			// Disk Format
	DWORD	fd_size;			// Disk Size  (32bit: longはmacOSで64bitになる)
	DWORD	trackp[164];		// Track_pointer
} D88_HEADER;

// セクター部 (16 Bytes)
typedef struct {
	BYTE	c;
	BYTE	h;
	BYTE	r;
	BYTE	n;
	WORD	sectors;			// Sector Count
	BYTE	mfm_flg;			// sides
	BYTE	del_flg;			// DELETED DATA
	BYTE	stat;				// STATUS (FDC ret)
	BYTE	reserved2[5];		// Reserved
	WORD	size;				// Sector Size
//	byte	data[0];			// Sector Data
} D88_SECTOR;


short fdd_eject_d88(short drv);
short fdd_set_d88(short drv, LPSTR fname);

short fdd_crc_d88(void);
BYTE fdd_stat_d88(void);

void fdd_read_d88(void);
void fdd_write_d88(void);

BYTE fdd_incoff_d88(void);

void init_tao_d88(void);
void fdd_wtao_d88(BYTE data);

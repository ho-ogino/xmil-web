void fdd_flush_2d(void);
short fdd_eject_2d(short drv);
short fdd_set_2d(short drv, LPSTR fname);

short fdd_crc_2d(void);
BYTE fdd_stat_2d(void);

void fdd_read_2d(void);
void fdd_write_2d(void);

BYTE fdd_incoff_2d(void);

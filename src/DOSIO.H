#define		FILEH		HANDLE

#define		FSEEK_SET	0
#define		FSEEK_CUR	1
#define		FSEEK_END	2

											// DOSIO:関数の準備
void dosio_init(void);
											// ファイル操作
FILEH file_open(LPSTR filename);
FILEH file_create(LPSTR filename);
DWORD file_seek(FILEH handle, long pointer, short mode);
#if T_TUNE
DWORD file_length(FILEH handle);
#endif
DWORD file_lread(FILEH handle, void *data, DWORD length);
DWORD file_lwrite(FILEH handle, void *data, DWORD length);
WORD file_read(FILEH handle, void *data, WORD length);
WORD file_write(FILEH handle, void *data, WORD length);
WORD file_lineread(FILEH handle, void *data, WORD length);
short file_close(FILEH handle);
short file_attr(LPSTR filename);
											// カレントファイル操作
void file_setcd(LPSTR exename);
FILEH file_open_c(LPSTR filename);
FILEH file_create_c(LPSTR filename);
short file_attr_c(LPSTR filename);

											// 日時の取得
void dosdateset(BYTE *dat);
void dostimeset(BYTE *dat);


LPSTR getFileName(LPSTR filename);
void cutFileName(LPSTR filename);
void cutExtName(LPSTR filename);
void cutyen(LPSTR str);

void mx_strncpy(LPSTR dst, LPSTR src, int maxlen);

int kanji1st(LPSTR str, int pos);
int ex_a2i(LPSTR str, int min, int max);

void fname_mix(LPSTR str, LPSTR mix, int size);


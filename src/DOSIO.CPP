#include	<windows.h>
#include	<time.h>

#include	"common.h"
#include	"dosio.h"
#include	"parts.h"

static	char	curpath[MAX_PATH+32] = "";
static	LPSTR	curfilep = curpath;

void dosio_init(void) { }

											// ファイル操作
FILEH file_open(LPSTR filename) {

	FILEH	ret;

	if ((ret = CreateFile(filename, GENERIC_READ | GENERIC_WRITE,
						0, 0, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL))
											== INVALID_HANDLE_VALUE) {
		if ((ret = CreateFile(filename, GENERIC_READ,
						0, 0, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL))
											== INVALID_HANDLE_VALUE) {
			return((FILEH)-1);
		}
	}
	return(ret);
}

FILEH file_create(LPSTR filename) {

	FILEH	ret;

	if ((ret = CreateFile(filename, GENERIC_READ | GENERIC_WRITE,
						 0, 0, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL))
											== INVALID_HANDLE_VALUE) {
		return((FILEH)-1);
	}
	return(ret);
}

DWORD file_seek(FILEH handle, long pointer, short mode) {

	return(SetFilePointer(handle, pointer, 0, mode));
}

#if T_TUNE
DWORD file_length(FILEH handle)
{
	DWORD dwSize = GetFileSize (handle, NULL) ;
	if (dwSize == 0xFFFFFFFF)
	{
		//dwError = GetLastError() ;
		return 0;
	}
	return dwSize;
}
#endif

DWORD file_lread(FILEH handle, void *data, DWORD length) {

	DWORD	readsize;

	if (!ReadFile(handle, data, length, &readsize, NULL)) {
		return(0);
	}
	return(readsize);
}

DWORD file_lwrite(FILEH handle, void *data, DWORD length) {

	DWORD	writesize;

	if (!WriteFile(handle, data, length, &writesize, NULL)) {
		return(0);
	}
	return(writesize);
}

WORD file_read(FILEH handle, void *data, WORD length) {

	DWORD	readsize;

	if (!ReadFile(handle, data, length, &readsize, NULL)) {
		return(0);
	}
	return((WORD)readsize);
}

WORD file_write(FILEH handle, void *data, WORD length) {

	DWORD	writesize;

	if (!WriteFile(handle, data, length, &writesize, NULL)) {
		return(0);
	}
	return((WORD)writesize);
}

WORD file_lineread(FILEH handle, void *data, WORD length) {

	DWORD	readsize;
	LPSTR	p = (LPSTR)data;
	DWORD	pos;
	WORD	ret = 0;

	if ((!length) || ((pos = file_seek(handle, 0, 1)) == (DWORD)-1)) {
		return(0);
	}
	ZeroMemory(data, length);
	if (!ReadFile(handle, data, length-1, &readsize, NULL)) {
		return(0);
	}
	while(*p) {
		ret++;
		pos++;
		if ((*p == 0x0d) || (*p == 0x0a)) {
			break;
		}
		p++;
	}
	*p = '\0';
	file_seek(handle, pos, 0);
	return(ret);
}

short file_close(FILEH handle) {

	CloseHandle(handle);
	return(0);
}

short file_attr(LPSTR filename) {

	return((short)GetFileAttributes(filename));
}


											// カレントファイル操作
void file_setcd(LPSTR exename) {

	strcpy(curpath, exename);
	curfilep = getFileName(curpath);
	*curfilep = '\0';
}

FILEH file_open_c(LPSTR filename) {

	strcpy(curfilep, filename);
	return(file_open(curpath));
}

FILEH file_create_c(LPSTR filename) {

	strcpy(curfilep, filename);
	return(file_create(curpath));
}

short file_attr_c(LPSTR filename) {

	strcpy(curfilep, filename);
	return(file_attr(curpath));
}



											// 日時の取得
void dosdateset(BYTE *dat) {

	time_t		ltime;
	struct tm	*nt;

	time(&ltime);
	nt = localtime(&ltime);
	*dat++ = AdjustAfterMultiply((BYTE)(nt->tm_year % 100));
	*dat++ = (BYTE)(((nt->tm_mon + 1) << 4) + nt->tm_wday);
	*dat   = AdjustAfterMultiply(nt->tm_mday);
}

void dostimeset(BYTE *dat) {

	time_t		ltime;
	struct tm	*nt;

	time(&ltime);
	nt = localtime(&ltime);
	*dat++ = AdjustAfterMultiply(nt->tm_hour);
	*dat++ = AdjustAfterMultiply(nt->tm_min);
	*dat   = AdjustAfterMultiply(nt->tm_sec);
}


LPSTR getFileName(LPSTR filename) {

	LPSTR	ret;

	ret = filename;
	while(*filename != '\0') {
		if (IsDBCSLeadByte(*filename) == 0) {
			if ((*filename == '\\') || (*filename == '/')
					|| (*filename == ':')) {
				ret = filename + 1;
			}
		}
		filename = CharNext(filename);
	}
	return(ret);
}

void cutFileName(LPSTR filename) {

	LPSTR	p;

	p = NULL;
	while(*filename != '\0') {
		if (IsDBCSLeadByte(*filename) == 0) {	// 半角文字だったら
			if ((*filename == '\\') || (*filename == '/')
					|| (*filename == ':')) {
				p = filename + 1;
			}
		}
		filename = CharNext(filename);		// 次の文字へ
	}
	if (p) {
		*p = '\0';
	}
}

void cutExtName(LPSTR filename) {

	LPSTR	p;
	LPSTR	q;

	p = getFileName(filename);
	q = NULL;

	while(*p != '\0') {
		if (IsDBCSLeadByte(*p) == 0) {
			if (*p == '.') {
				q = p;
			}
		}
		p = CharNext(p);
	}
	if (q) {
		*q = '\0';
	}
}

void mx_strncpy(LPSTR dst, LPSTR src, int maxlen) {

	while((--maxlen) && *src) {
		*dst++ = *src++;
	}
	*dst = '\0';
}


int kanji1st(LPSTR str, int pos) {

	int		ret = 0;
	BYTE	c;

	for (; pos; pos--) {
		c = (BYTE)str[pos];
		if (!((0x81 <= c && c <= 0x9f) || (0xe0 <= c && c <= 0xfc))) {
			break;
		}
		ret ^= 1;
	}
	return(ret);
}

int kanji2nd(LPSTR str, int pos) {

	int		ret = 0;
	BYTE	c;

	while(pos--) {
		c = (BYTE)str[pos];
		if (!((0x81 <= c && c <= 0x9f) || (0xe0 <= c && c <= 0xfc))) {
			break;
		}
		ret ^= 1;
	}
	return(ret);
}


int ex_a2i(LPSTR str, int min, int max) {

	int		ret = 0;
	char	c;

	if (!str) {
		return(min);
	}
	while(1) {
		c = *str++;
		if (c == ' ') {
			continue;
		}
		if ((c < '0') || (c > '9')) {
			break;
		}
		ret = ret * 10 + (c - '0');
	}
	if (ret < min) {
		return(min);
	}
	else if (ret > max) {
		return(max);
	}
	return(ret);
}

void cutyen(LPSTR str) {

	int		pos = strlen(str) - 1;

	if ((pos > 0) &&							// 2文字以上でー
		(str[pos] == '\\') &&					// ケツが \ でー
		(!kanji2nd(str, pos)) &&				// 漢字の2バイト目ぢゃなくてー
		((pos != 1) || (str[0] != '\\')) &&		// '\\' ではなくてー
		((pos != 2) || (str[1] != ':'))) {		// '?:\' ではなかったら
		str[pos] = '\0';
	}
}

void plusyen(LPSTR str, int len) {

	int		pos = strlen(str);

	if (pos) {
		pos--;
		if ((str[pos] == '\\') && (!kanji2nd(str, pos))) {
			return;
		}
	}
	if ((pos + 2) >= len) {
		return;
	}
	str[pos++] = '\\';
	str[pos] = '\0';
}


void fname_mix(LPSTR str, LPSTR mix, int size) {

	LPSTR 	p;
	int		len;
	int		done = 0;
	char	c;
	char	check;

	cutFileName(str);
	if ((mix[1] == ':')	||					// ドライブレター
		(*(WORD *)mix == 0x5c5c)) {			// ネットワーク
		str[0] = '\0';
	}
	else if (mix[0] == '\\') {				// ルート
		if ((str[1] == ':') || (*(WORD *)str == 0x5c5c)) {
			str[2] = '\0';
		}
		else {
			str[0] = '\0';
		}
	}
	len = strlen(str);
	p = str + len;
	check = '.';
	while(len < size) {
		if ((c = *mix++) == '\0') {
			break;
		}
		if (c == check) {
			if (*mix == '\\') {
				mix++;
				continue;
			}
			if (*(WORD *)mix == 0x5c2e) {
				mix += 2;
				cutyen(str);
				cutFileName(str);
				len = strlen(str);
				p = str + len;
				continue;
			}
		}
		if (c == '\\') {
			check = '.';
		}
		else {
			check = 0;
		}
		*p++ = c;
		len++;
	}
	*p = '\0';
}


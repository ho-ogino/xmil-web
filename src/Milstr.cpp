#include	<windows.h>

BOOL milstr_cmpA(char *str, char *cmp) {

	BYTE	s, c;
	BOOL	kanji = FALSE;

	while(1) {
		s = *str++;
		if (kanji) {
			kanji = FALSE;
			if (s != *cmp++) {
				return(1);
			}
		}
		if (((s >= 0x81) && (s < 0xa0)) ||
			((s >= 0xe0) && (s < 0xfc))) {
			kanji = TRUE;
			if (s != *cmp++) {
				return(1);
			}
		}
		else {
			if ((s >= 'a') && (s <= 'z')) {
				s -= 0x20;
			}
			c = *cmp++;
#if T_TUNE
			if(!c) break;
#endif
			if ((c >= 'a') && (c <= 'z')) {
				c -= 0x20;
			}
			if (s != c) {
				return(1);
			}
		}
		if (!s) {
			break;
		}
	}
	return(0);
}


BOOL milstr_extendcmp(char *str, char *cmp) {

	char	c, s;

	while(*cmp) {
		while(*cmp) {
			s = *cmp++;
			if (!s) {
				return(TRUE);
			}
			if ((s >= '0') && (s <= '9')) {
				break;
			}
			s &= 0xef;
			if ((s >= 'A') && (s <= 'Z')) {
				break;
			}
		}
		while(1) {
			c = *str++;
			if (!c) {
				return(FALSE);
			}
			if ((c >= '0') && (c <= '9')) {
				break;
			}
			c &= 0xef;
			if ((c >= 'A') && (c <= 'Z')) {
				break;
			}
		}
		if (c != s) {
			return(FALSE);
		}
	}
	return(TRUE);
}


int milstr_kanji1st(char *str, int pos) {

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

void milstr_ncpy(char *dst, char *src, int maxlen) {

	if (maxlen) {
		if (maxlen >= 2) {
			if (milstr_kanji1st(src, maxlen-2)) {
				maxlen--;
			}
		}
		while((--maxlen) && *src) {
			*dst++ = *src++;
		}
		*dst = '\0';
	}
}

char *milstr_getext(char *filename) {

	char	*ret = NULL;

	while(*filename != '\0') {
		if (IsDBCSLeadByte(*filename) == 0) {
			if ((*filename == '\\') || (*filename == '/')
					|| (*filename == ':')) {
				ret = NULL;
			}
			else if (*filename == '.') {
				ret = filename + 1;
			}
		}
		filename = CharNext(filename);
	}
	if (ret) {
		return(ret);
	}
	return(filename);
}


int milstr_getarg(char *str, char *arg[], int maxarg) {

	int		ret = 0;
	char	*p;
	BOOL	quot;

	while(maxarg--) {
		quot = FALSE;
		while((*str) && (((BYTE)*str) <= 0x20)) {
			str++;
		}
		if (*str == '\0') {
			break;
		}
		arg[ret++] = str;
		p = str;
		while(*str) {
			if (*str == 0x22) {
				quot = !quot;
			}
			else if ((((BYTE)*str) > 0x20) || (quot)) {
				*p++ = *str;
			}
			else {
				str++;
				break;
			}
			str++;
		}
		*p = '\0';
	}
	return(ret);
}

long milstr_solveHEX(char *str) {

	long	ret;
	int		i;
	char	c;

	ret = 0;
	for (i=0; i<8; i++) {
		c = *str++;
		if ((c >= '0') && (c <= '9')) {
			c -= '0';
		}
		else if ((c >= 'A') && (c <= 'F')) {
			c -= '7';
		}
		else if ((c >= 'a') && (c <= 'f')) {
			c -= 'W';
		}
		else {
			break;
		}
		ret <<= 4;
		ret += (long)c;
	}
	return(ret);
}

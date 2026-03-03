
// 大文字小文字を同一視して比較
// ret 0:一致
BOOL milstr_cmpA(char *str, char *cmp);

// 0~9, A~Z のみを大文字小文字を同一視して比較
// ret 0:一致
BOOL milstr_extendcmp(char *str, char *cmp);

// str[pos]が漢字１文字目かどうか…
int milstr_kanji1st(char *str, int pos);

// maxlen分だけ文字列をコピー
void milstr_ncpy(char *dst, char *src, int maxlen);

// filenameの拡張子を取得
char *milstr_getext(char *filename);

// 文字列からARGの取得
int milstr_getarg(char *str, char *arg[], int maxarg);

// HEX2INT
long milstr_solveHEX(char *str);

LPSTR savefileselect(LPSTR filter, LPSTR defname, LPSTR ext, LPSTR title);
void changefdd(short drv);
#if T_TUNE
void changetape(void);
#endif

void disable_windowmenu(void);

void xmenu_setiplrom(BYTE num);
void xmenu_setskipline(BYTE value);
void xmenu_setsound(BYTE value);
void xmenu_setresolute(BYTE value);
void xmenu_setbootmedia(BYTE value);
void xmenu_setkey(BYTE value);
void xmenu_setbtnrapid(BYTE value);
void xmenu_setbtnmode(BYTE value);
void xmenu_setcpuspeed(BYTE value);
void xmenu_setwidth(BYTE value);
void xmenu_setwaitflg(BYTE value);
void xmenu_setflame(BYTE value);
void xmenu_setmotorflg(BYTE value);
void xmenu_setz80save(BYTE value);
void xmenu_setjoystick(BYTE value);
void xmenu_opmlog(BYTE value);
void xmenu_setdispmode(BYTE value);
void xmenu_setmouse(BYTE value);
void xmenu_setwinsnap(BYTE value);
void xmenu_setdispclk(BYTE value);
void xmenu_setbackground(BYTE value);
void xmenu_setbgsound(BYTE value);

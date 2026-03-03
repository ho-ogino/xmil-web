#if T_TUNE

/* LED color */
enum {
	INFO_LED_OFF,
	INFO_LED_RED,
	INFO_LED_GREEN
};

/* --------- draw information bar ---------- */
/* FDD info */
void drawinfo_fdd_name(int driveno,char *name);
void drawinfo_fdd_led(int driveno,int led);
/* CMT info */
void drawinfo_cmt_name(char *name);
void drawinfo_cmt_icon(int cmd,BYTE lampon);
void drawinfo_cmt_cnt(void);
/* HDD info */
void drawinfo_hdd_led(int driveno,int led);
/* speed */
void drawinfo_clock(DWORD clockKHz);

/* --------- click information bar ---------- */
int drawinfo_click(WORD xpos,WORD ypos,int button,int shift);

void drawinfo_init(void);

#endif

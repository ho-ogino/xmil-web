extern	BYTE	KEY_INT;
extern	BYTE	KEY_HIT;


void winkeyinit106(void);
void winkeyup106(WPARAM wParam, LPARAM lParam);
void winkeydown106(WPARAM wParam, LPARAM lParam);


void keyboard_init(void);
void keyboard_reset(void);
void keyboard_term(void);

void keyboard_e3(BYTE *data);
void keyboard_inkey(BYTE KEY_MODE, BYTE *data);


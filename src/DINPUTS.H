#ifdef __cplusplus
extern "C" {
#endif

void mx_initdinput(void);
void mx_termdinput(void);
void joy_foregroundprc(UINT wParam);
BYTE joy_getflag(void);
BYTE joy_getautomation(BYTE port_index);
void joy_releaseautomation(void);
void joy_flash(void);

#ifdef __cplusplus
}
#endif

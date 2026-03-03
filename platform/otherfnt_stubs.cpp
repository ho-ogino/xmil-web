#include <stdio.h>
#include "common.h"

char szProgName[] = "XMillennium Web";

extern "C" {
    DWORD updatemsk = 0x7FF;
}

BYTE g_cli_disable_text  = 0;
BYTE g_cli_disable_graph = 0;

// 他機種フォント読み込み（Web版では無効）
extern "C" {

BYTE fm7fontread(BYTE code)  { (void)code; return 0xFF; }
BYTE pc88fontread(BYTE code) { (void)code; return 0xFF; }
BYTE x68kfontread(BYTE code) { (void)code; return 0xFF; }
BYTE t98fontread(BYTE code)  { (void)code; return 0xFF; }

} // extern "C"

BYTE changescreen(BYTE mode) { (void)mode; return 0; }

// BCD変換（X1_CLNDR.CPP で使用）
BYTE AdjustBeforeDivision(BYTE val) {
    return (BYTE)((val >> 4) * 10 + (val & 0x0f));
}
BYTE AdjustAfterMultiply(BYTE val) {
    return (BYTE)(((val / 10) << 4) + (val % 10));
}

void dclock_callback(void) {}

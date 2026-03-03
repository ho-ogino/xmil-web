#ifndef OTHERFNT_H
#define OTHERFNT_H

// OTHERFNT - 他機種フォント変換機能（Web版では未実装）

#include "common.h"

// 関数プロトタイプ（実装はotherfnt_stubs.cpp）
extern "C" {
    BYTE fm7fontread(BYTE code);
    BYTE pc88fontread(BYTE code);
    BYTE x68kfontread(BYTE code);
    BYTE t98fontread(BYTE code);
}

#endif // OTHERFNT_H

#ifndef PLATFORM_INPUT_H
#define PLATFORM_INPUT_H

#include "platform_types.h"

#ifdef __cplusplus
extern "C" {
#endif

// キーコード定義（仮想キーコード）
#define KEY_ESCAPE      0x01
#define KEY_1           0x02
#define KEY_2           0x03
#define KEY_3           0x04
#define KEY_4           0x05
#define KEY_5           0x06
#define KEY_6           0x07
#define KEY_7           0x08
#define KEY_8           0x09
#define KEY_9           0x0A
#define KEY_0           0x0B
#define KEY_MINUS       0x0C
#define KEY_EQUALS      0x0D
#define KEY_BACKSPACE   0x0E
#define KEY_TAB         0x0F
#define KEY_Q           0x10
#define KEY_W           0x11
#define KEY_E           0x12
#define KEY_R           0x13
#define KEY_T           0x14
#define KEY_Y           0x15
#define KEY_U           0x16
#define KEY_I           0x17
#define KEY_O           0x18
#define KEY_P           0x19
#define KEY_ENTER       0x1C
#define KEY_CONTROL     0x1D
#define KEY_A           0x1E
#define KEY_S           0x1F
#define KEY_D           0x20
#define KEY_F           0x21
#define KEY_G           0x22
#define KEY_H           0x23
#define KEY_J           0x24
#define KEY_K           0x25
#define KEY_L           0x26
#define KEY_SHIFT       0x2A
#define KEY_Z           0x2C
#define KEY_X           0x2D
#define KEY_C           0x2E
#define KEY_V           0x2F
#define KEY_B           0x30
#define KEY_N           0x31
#define KEY_M           0x32
#define KEY_SPACE       0x39
#define KEY_F1          0x3B
#define KEY_F2          0x3C
#define KEY_F3          0x3D
#define KEY_F4          0x3E
#define KEY_F5          0x3F
#define KEY_F6          0x40
#define KEY_F7          0x41
#define KEY_F8          0x42
#define KEY_F9          0x43
#define KEY_F10         0x44
#define KEY_F11         0x57
#define KEY_F12         0x58
#define KEY_UP          0xC8
#define KEY_DOWN        0xD0
#define KEY_LEFT        0xCB
#define KEY_RIGHT       0xCD

// 入力サブシステムの初期化
BOOL Platform_Input_Init(void);
void Platform_Input_Term(void);

// キーボード状態の更新と取得
void Platform_Input_Update(void);
BOOL Platform_Input_IsKeyPressed(int keycode);
BOOL Platform_Input_IsKeyDown(int keycode);
BOOL Platform_Input_IsKeyUp(int keycode);

// マウス状態の取得
void Platform_Input_GetMousePos(int* x, int* y);
BOOL Platform_Input_GetMouseButton(int button); // 0=left, 1=right, 2=middle

// ジョイスティック/ゲームパッド
BOOL Platform_Input_IsJoystickConnected(int index);
void Platform_Input_GetJoystickState(int index, int* x, int* y, DWORD* buttons);

#ifdef __cplusplus
}
#endif

#endif // PLATFORM_INPUT_H

#include "common.h"
#include "XMIL.H"
#include "platform_input.h"

// X1 ジョイスティックビット（アクティブ Low: 0xFF = 全方向・ボタン未押下）
#define JOY_UP_BIT    0x01
#define JOY_DOWN_BIT  0x02
#define JOY_LEFT_BIT  0x04
#define JOY_RIGHT_BIT 0x08
#define JOY_BTN4_BIT  0x10
#define JOY_BTN2_BIT  0x20
#define JOY_BTN1_BIT  0x40
#define JOY_BTN3_BIT  0x80

static BYTE joyflag = 0xFF;
static BYTE automation_joyflag[2] = { 0xFF, 0xFF };

// joy_getflag / joy_flash / js_set_joystick はすべて C リンケージ
// （DINPUTS.H の extern "C" 宣言と一致させる）
extern "C" {

BYTE joy_getflag(void) {
    if (xmilcfg.JOYSTICK == 1) {
        xmilcfg.JOYSTICK |= 0x80;  // bit7: 読み取り済みフラグ（フレーム内重複読み取り防止）
        int ax, ay; DWORD btns;
        Platform_Input_GetJoystickState(0, &ax, &ay, &btns);
        joyflag = 0xFF;
        // 方向
        if (ax < -16384 || (btns & (1u << 14))) joyflag &= ~JOY_LEFT_BIT;
        if (ax >  16384 || (btns & (1u << 15))) joyflag &= ~JOY_RIGHT_BIT;
        if (ay < -16384 || (btns & (1u << 12))) joyflag &= ~JOY_UP_BIT;
        if (ay >  16384 || (btns & (1u << 13))) joyflag &= ~JOY_DOWN_BIT;
        // ボタン
        if (btns & (1u << 0)) joyflag &= ~JOY_BTN1_BIT;
        if (btns & (1u << 1)) joyflag &= ~JOY_BTN2_BIT;
        if (btns & (1u << 2)) joyflag &= ~JOY_BTN3_BIT;
        if (btns & (1u << 3)) joyflag &= ~JOY_BTN4_BIT;
    }
    return joyflag;
}

BYTE joy_getautomation(BYTE port_index) {
    if (port_index >= 2) return 0xFF;
    return automation_joyflag[port_index];
}

void joy_releaseautomation(void) {
    automation_joyflag[0] = 0xFF;
    automation_joyflag[1] = 0xFF;
}

void joy_flash(void) {
    xmilcfg.JOYSTICK &= 0x7f;  // bit7 クリア
    joyflag = 0xFF;
    Platform_Input_Update();    // Gamepad API ポーリング
    if (Platform_Input_IsJoystickConnected(0))
        xmilcfg.JOYSTICK &= ~0x02;  // bit1: 接続あり
    else
        xmilcfg.JOYSTICK |= 0x02;   // bit1: 未接続
}

void js_set_joystick(int enabled) {
    if (enabled) {
        xmilcfg.JOYSTICK |= 0x01;   // bit0 ON
        xmilcfg.JOYSTICK &= ~0x80;  // bit7 クリア（再有効化時に即時動作）
        joyflag = 0xFF;
    } else {
        xmilcfg.JOYSTICK &= ~0x01;  // bit0 OFF
    }
}

int js_set_automation_pad(int port, int bits) {
    if (port < 1 || port > 2 || bits < 0 || bits > 0xFF) {
        return 0;
    }
    automation_joyflag[port - 1] = (BYTE)bits;
    return 1;
}

void js_release_automation_pads(void) {
    joy_releaseautomation();
}

} // extern "C"

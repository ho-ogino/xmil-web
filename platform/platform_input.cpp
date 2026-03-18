#include "platform_input.h"
#include <emscripten.h>
#include <emscripten/html5.h>
#include <string.h>

// X1キーボード処理（Input.cpp）
#include "INPUT.H"
// X1設定（xmilcfg.MOUSE_SW 参照）
#include "xmil.h"
// マウス定数（MOUSE_MASK, MOUSE_LEFTDOWN 等）
#include "mouses.h"

// --- X1 マウス状態 (MOUSES.CPP 相当) ---
static BYTE  mouserunning = 0;
static short mousex = 0;
static short mousey = 0;
static BYTE  mouseb = 0;

// Pointer Lock アクティブ判定
static bool isPointerLocked(void) {
    EmscriptenPointerlockChangeEvent st;
    if (emscripten_get_pointerlock_status(&st) == EMSCRIPTEN_RESULT_SUCCESS) {
        return st.isActive;
    }
    return false;
}

// 飽和クランプ付き加算（short オーバーフロー防止）
static inline short saturate_add(short a, short b) {
    int sum = (int)a + (int)b;
    if (sum > 32767)  return 32767;
    if (sum < -32767) return -32767;
    return (short)sum;
}

// 入力サブシステム状態
static struct {
    BOOL initialized;
} g_input = {0};

// ゲームパッド状態（Gamepad API ポーリング結果キャッシュ）
// joy_flash() 毎フレーム更新 → joy_getflag() が参照する
static struct {
    BOOL  connected;
    int   axis_x;    // ±32767（左スティック X 軸、右方向が正）
    int   axis_y;    // ±32767（左スティック Y 軸、下方向が正）
    DWORD buttons;   // ビットマスク（Web Gamepad standard mapping）
} g_gamepad = {FALSE, 0, 0, 0};

// ブラウザ e->code → Windows VK コード変換
// winkeydown106/winkeyup106 に渡す値 (Input.cpp の key106[] テーブルで
// Windows VK → X1スキャンコードに変換される)
static int browser_code_to_vk(const char* code) {
    // アルファベット A-Z (KeyA=0x41 ... KeyZ=0x5A)
    if (code[0]=='K' && code[1]=='e' && code[2]=='y' &&
        code[3]>='A' && code[3]<='Z' && code[4]=='\0')
        return 0x41 + (code[3] - 'A');

    // 数字 0-9 (Digit0=0x30 ... Digit9=0x39)
    if (code[0]=='D' && code[1]=='i' && code[2]=='g' && code[3]=='i' &&
        code[4]=='t' && code[5]>='0' && code[5]<='9' && code[6]=='\0')
        return 0x30 + (code[5] - '0');

    // ファンクションキー F1-F12 (F1=0x70 ... F12=0x7B)
    if (code[0]=='F') {
        // F1-F9: "F1".."F9"
        if (code[1]>='1' && code[1]<='9' && code[2]=='\0')
            return 0x6F + (code[1] - '0');
        // F10-F12: "F10".."F12"
        if (code[1]=='1' && code[2]>='0' && code[2]<='2' && code[3]=='\0')
            return 0x79 + (code[2] - '0');  // F10=0x79, F11=0x7A, F12=0x7B
    }

    // 特殊キー
    if (strcmp(code, "Escape")==0)       return 0x1B;
    if (strcmp(code, "Backspace")==0)    return 0x08;
    if (strcmp(code, "Tab")==0)          return 0x09;
    if (strcmp(code, "Enter")==0)        return 0x0D;
    if (strcmp(code, "NumpadEnter")==0)  return 0x0D;
    if (strcmp(code, "ShiftLeft")==0 || strcmp(code, "ShiftRight")==0)
        return 0x10;
    if (strcmp(code, "ControlLeft")==0 || strcmp(code, "ControlRight")==0)
        return 0x11;
    if (strcmp(code, "AltLeft")==0 || strcmp(code, "AltRight")==0)
        return 0x12;
    if (strcmp(code, "Pause")==0)        return 0x13;
    if (strcmp(code, "CapsLock")==0)     return 0x14;
    if (strcmp(code, "KanaMode")==0 || strcmp(code,"Lang1") == 0)     return 0x15;  // カナキー
    if (strcmp(code, "Convert")==0)      return 0x1C;  // 変換 (XFER)
    if (strcmp(code, "NonConvert")==0)   return 0x1D;  // 無変換 (NFER)
    if (strcmp(code, "Space")==0)        return 0x20;
    if (strcmp(code, "PageUp")==0)       return 0x21;  // ROLL UP
    if (strcmp(code, "PageDown")==0)     return 0x22;  // ROLL DOWN
    if (strcmp(code, "End")==0)          return 0x23;
    if (strcmp(code, "Home")==0)         return 0x24;
    if (strcmp(code, "ArrowLeft")==0)    return 0x25;
    if (strcmp(code, "ArrowUp")==0)      return 0x26;
    if (strcmp(code, "ArrowRight")==0)   return 0x27;
    if (strcmp(code, "ArrowDown")==0)    return 0x28;
    if (strcmp(code, "Insert")==0)       return 0x2D;
    if (strcmp(code, "Delete")==0)       return 0x2E;

    // テンキー (VK_NUMPAD0=0x60 ... VK_NUMPAD9=0x69)
    if (strcmp(code, "Numpad0")==0)      return 0x60;
    if (strcmp(code, "Numpad1")==0)      return 0x61;
    if (strcmp(code, "Numpad2")==0)      return 0x62;
    if (strcmp(code, "Numpad3")==0)      return 0x63;
    if (strcmp(code, "Numpad4")==0)      return 0x64;
    if (strcmp(code, "Numpad5")==0)      return 0x65;
    if (strcmp(code, "Numpad6")==0)      return 0x66;
    if (strcmp(code, "Numpad7")==0)      return 0x67;
    if (strcmp(code, "Numpad8")==0)      return 0x68;
    if (strcmp(code, "Numpad9")==0)      return 0x69;
    if (strcmp(code, "NumpadMultiply")==0)  return 0x6A;
    if (strcmp(code, "NumpadAdd")==0)       return 0x6B;
    if (strcmp(code, "NumpadSubtract")==0)  return 0x6D;
    if (strcmp(code, "NumpadDecimal")==0)   return 0x6E;
    if (strcmp(code, "NumpadDivide")==0)    return 0x6F;

    // OEM / 記号キー（JIS 配列基準）
    // browser code は物理位置を US 配列名で表す。JIS キーボードでは
    // 同じ物理位置に異なる文字が割り当てられるため、JIS→X1 VK に変換する。
    //
    // 物理位置(US名)  JIS刻印  → VK    → key106 scan → X1文字
    // Minus           -        → 0xBD  → 0x0c        → -
    // Equal           ^        → 0xDE  → 0x0d        → ^
    // BracketLeft     @        → 0xC0  → 0x1a        → @
    // BracketRight    [        → 0xDB  → 0x1b        → [
    // Backslash       ]        → 0xDD  → 0x2b        → ]
    // Semicolon       ;        → 0xBB  → 0x27        → ;
    // Quote           :        → 0xBA  → 0x28        → :
    // IntlYen         ¥        → 0xDC  → 0x5a        → ¥
    // IntlRo          _        → 0xE2  → 0x59        → _
    if (strcmp(code, "Minus")==0)        return 0xBD;  // JIS - key
    if (strcmp(code, "Equal")==0)        return 0xDE;  // JIS ^ key
    if (strcmp(code, "BracketLeft")==0)  return 0xC0;  // JIS @ key
    if (strcmp(code, "BracketRight")==0) return 0xDB;  // JIS [ key
    if (strcmp(code, "Backslash")==0)    return 0xDD;  // JIS ] key
    if (strcmp(code, "Semicolon")==0)    return 0xBB;  // JIS ; key
    if (strcmp(code, "Quote")==0)        return 0xBA;  // JIS : key
    if (strcmp(code, "Backquote")==0)    return 0xC0;  // JIS 半角/全角 → X1 @ (fallback)
    if (strcmp(code, "Comma")==0)        return 0xBC;  // ,<
    if (strcmp(code, "Period")==0)       return 0xBE;  // .>
    if (strcmp(code, "Slash")==0)        return 0xBF;  // /?
    if (strcmp(code, "IntlYen")==0)      return 0xDC;  // JIS ¥ key
    if (strcmp(code, "IntlRo")==0)       return 0xE2;  // JIS _ key

    return -1;  // 未知のキー
}

// キーボードイベントコールバック
static EM_BOOL keyboard_callback(int eventType, const EmscriptenKeyboardEvent* e, void* userData) {
    // input / textarea / select / contentEditable にフォーカスがある場合はエミュレータに送らない
    // （UI入力欄や CodeMirror エディタでのキー入力を許可するため）
    int inFormField = EM_ASM_INT({
        var el = document.activeElement;
        if (!el) return 0;
        var tag = el.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return 1;
        if (el.isContentEditable) return 1;
        return 0;
    });
    if (inFormField) return FALSE;  // ブラウザのデフォルト動作を通す

    int vk = browser_code_to_vk(e->code);
    if (vk < 0) {
        return FALSE;
    }

    if (eventType == EMSCRIPTEN_EVENT_KEYDOWN) {
        winkeydown106((WPARAM)vk, 0);
    } else if (eventType == EMSCRIPTEN_EVENT_KEYUP) {
        winkeyup106((WPARAM)vk, 0);
    }

    // デフォルト動作を抑制（Tab/矢印キーによるフォーカス移動・スクロール防止）
    return TRUE;
}

// Emscripten マウスイベントコールバック（Pointer Lock 対応）
static EM_BOOL em_mouse_callback(int eventType, const EmscriptenMouseEvent* e, void* userData) {
    bool locked = xmilcfg.MOUSE_SW && isPointerLocked();

    // 移動量累積は MOUSEMOVE 時のみ（down/up のノイズ回避）
    if (locked && eventType == EMSCRIPTEN_EVENT_MOUSEMOVE) {
        mousex = saturate_add(mousex, (short)(e->movementX));
        mousey = saturate_add(mousey, (short)(e->movementY));
    }

    // ボタン状態（Pointer Lock 中のみ更新）
    if (locked) {
        if (eventType == EMSCRIPTEN_EVENT_MOUSEDOWN) {
            if (e->button == 0) mouseb |= 1;   // 左
            if (e->button == 2) mouseb |= 2;   // 右
        } else if (eventType == EMSCRIPTEN_EVENT_MOUSEUP) {
            if (e->button == 0) mouseb &= ~1;
            if (e->button == 2) mouseb &= ~2;
        }
    } else {
        // Pointer Lock 非アクティブ時: 固着防止クリア
        mouseb = 0;
        mousex = 0;
        mousey = 0;
    }
    // Pointer Lock 中のみイベント消費（preventDefault）
    // 非ロック時は UI 要素（スライダー等）への操作を妨げない
    return locked ? TRUE : FALSE;
}

BOOL Platform_Input_Init(void) {
    if (g_input.initialized) {
        return TRUE;
    }

    memset(&g_input, 0, sizeof(g_input));

    // X1キーボード状態の初期化
    winkeyinit106();

    // キーボードイベントリスナーの登録
    emscripten_set_keydown_callback(EMSCRIPTEN_EVENT_TARGET_WINDOW, NULL, TRUE, keyboard_callback);
    emscripten_set_keyup_callback(EMSCRIPTEN_EVENT_TARGET_WINDOW, NULL, TRUE, keyboard_callback);

    // マウスイベントリスナーの登録（Pointer Lock 中の取りこぼし防止のため document レベル）
    emscripten_set_mousedown_callback(EMSCRIPTEN_EVENT_TARGET_DOCUMENT, NULL, TRUE, em_mouse_callback);
    emscripten_set_mouseup_callback(EMSCRIPTEN_EVENT_TARGET_DOCUMENT, NULL, TRUE, em_mouse_callback);
    emscripten_set_mousemove_callback(EMSCRIPTEN_EVENT_TARGET_DOCUMENT, NULL, TRUE, em_mouse_callback);

    g_input.initialized = TRUE;
    return TRUE;
}

void Platform_Input_Term(void) {
    g_input.initialized = FALSE;
}

// ── ソフトウェアキーボード用エクスポート ──
extern "C" EMSCRIPTEN_KEEPALIVE void js_key_down(int vk) {
    winkeydown106((WPARAM)vk, 0);
}
extern "C" EMSCRIPTEN_KEEPALIVE void js_key_up(int vk) {
    winkeyup106((WPARAM)vk, 0);
}

void Platform_Input_Update(void) {
    // Gamepad API ポーリング
    EMSCRIPTEN_RESULT sr = emscripten_sample_gamepad_data();
    if (sr != EMSCRIPTEN_RESULT_SUCCESS) {
        g_gamepad.connected = FALSE;
        return;
    }
    int numPads = emscripten_get_num_gamepads();
    if (numPads <= 0) {
        g_gamepad.connected = FALSE;
        return;
    }
    EmscriptenGamepadEvent gs;
    if (emscripten_get_gamepad_status(0, &gs) != EMSCRIPTEN_RESULT_SUCCESS || !gs.connected) {
        g_gamepad.connected = FALSE;
        return;
    }
    g_gamepad.connected = TRUE;
    // float ±1.0 → int ±32767（numAxes < 2 のデバイス対策で境界チェック）
    g_gamepad.axis_x = (gs.numAxes > 0) ? (int)(gs.axis[0] * 32767.0) : 0;
    g_gamepad.axis_y = (gs.numAxes > 1) ? (int)(gs.axis[1] * 32767.0) : 0;
    // ボタン状態をビットマスクに変換
    g_gamepad.buttons = 0;
    int nb = gs.numButtons < 32 ? gs.numButtons : 32;
    for (int i = 0; i < nb; i++) {
        if (gs.digitalButton[i]) {
            g_gamepad.buttons |= (1u << i);
        }
    }
}

BOOL Platform_Input_IsKeyPressed(int keycode) {
    (void)keycode;
    return FALSE;
}

BOOL Platform_Input_IsKeyDown(int keycode) {
    (void)keycode;
    return FALSE;
}

BOOL Platform_Input_IsKeyUp(int keycode) {
    (void)keycode;
    return TRUE;
}

BOOL Platform_Input_IsJoystickConnected(int index) {
    if (index != 0) return FALSE;
    return g_gamepad.connected;
}

void Platform_Input_GetJoystickState(int index, int* x, int* y, DWORD* buttons) {
    if (index != 0 || !g_gamepad.connected) {
        if (x)       *x       = 0;
        if (y)       *y       = 0;
        if (buttons) *buttons = 0;
        return;
    }
    if (x)       *x       = g_gamepad.axis_x;
    if (y)       *y       = g_gamepad.axis_y;
    if (buttons) *buttons = g_gamepad.buttons;
}

// --- MOUSES.H 関数群（X1 SIO マウスプロトコル用） ---

BYTE mouse_flag(void) {
    return mouserunning;
}

void mouse_running(BYTE flg) {
    BYTE mf = mouserunning;
    switch(flg & 0xc0) {
        case 0x00: mf &= ~(1 << (flg & 7)); break;
        case 0x40: mf ^=  (1 << (flg & 7)); break;
        default:   mf |=  (1 << (flg & 7)); break;
    }
    mouserunning = (mf & MOUSE_MASK);
}

// メインループ毎フレーム呼び出し
// Web版: mousemove イベントで累積済みなので空実装
void mouse_callback(void) {
}

BYTE mouse_posget(short *x, short *y) {
    *x = mousex;
    mousex = 0;
    *y = mousey;
    mousey = 0;
    return mouseb;
}

BYTE mouse_btn(BYTE btn) {
    if (!xmilcfg.MOUSE_SW || !isPointerLocked()) return 0;
    switch(btn) {
        case MOUSE_LEFTDOWN:  mouseb |= 1;    break;
        case MOUSE_LEFTUP:    mouseb &= 0xfe; break;
        case MOUSE_RIGHTDOWN: mouseb |= 2;    break;
        case MOUSE_RIGHTUP:   mouseb &= 0xfd; break;
    }
    return 1;
}

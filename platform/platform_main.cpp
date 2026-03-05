#include <emscripten.h>
#include <emscripten/html5.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

// プラットフォーム抽象化層
#include "platform_types.h"
#include "platform_graphics.h"
#include "platform_audio.h"
#include "platform_input.h"
#include "platform_file.h"

// X1エミュレータの定義
#include "common.h"
#include "xmil.h"
#include "TIMER.H"    // timer_getcount() / timer_setcount()
#include "dsounds.h"  // WAVE_INIT / WAVE_CREATE / WAV_SEEK 等
#include "PALETTES.H" // reflesh_palette()
#include "DRAW.H"     // palandply
#include "x1.h"       // mMAIN, mBANK, GRP_RAM, TXT_RAM
#include "X1_PCG.H"   // pcg (電源ON時のPCGクリア用)
#include "X1_CRTC.H"  // crtc_cold_reset() (電源ON時のパレットリセット用)
#include "state_save.h"
#include "X1_EMM.H"
#include "X1_SASI.H"
#include "FDD_D88.H"
#include "FDD_2D.H"

// web_sound.cpp で定義されているサウンドパラメータ (dsounds.h より)
extern WORD  ds_rate;
extern DWORD framesoundcnt;

// Windows互換スタブ変数（X1.cpp, X1_cmt.cpp, X1_sasi.cpp等から extern 宣言される）
HWND hWndMain = nullptr;

// CMT状態取得用
#include "x1_cmt.h"

XMIL_CFG xmilcfg = {
    0,      // KEY_MODE
    1,      // SOUND_SW
    0,      // SKIP_LINE (スキャンライン: デフォルト無効)
    0,      // NOWAIT
    0,      // DRAW_SKIP
    1,      // ROM_TYPE (X1)
    4,      // CPU8MHz (0 はゼロ除算クラッシュのため 4MHz 固定)
    1,      // DIP_SW (sdl/orig と同じ既定値)
    44100,  // samplingrate
    1000,   // delayms
    0,      // BTN_RAPID
    0,      // BTN_MODE
    0,      // LINEDEPTH
    0,      // BLKLIGHT
    1,      // MOTOR (シーク音: デフォルト有効)
    80,     // MOTORVOL (0 は無音になるため 80 を既定値に)
    0,      // TEXTMODE
    0,      // TEXT400L
    0,      // LINETEXT
    1,      // SOUNDPLY (sdl/orig と同じ既定値)
    1,      // PUCHI = 1: PSG ノイズ正常動作に必須
    0,      // DSOUND3
    0,      // Z80SAVE
    1,      // JOYSTICK (デフォルト有効)
    1,      // DISPSYNC (origsrc と同じ既定値)
};

// 元のエミュレータの関数を使用（X1.Hから）
void x1r_init(void);
void x1r_exec(void);
void x1r_term(void);
BYTE reset_x1(BYTE ROM_TYPE, BYTE SOUND_SW, BYTE DIP_SW);
short x1_set_fd(short drv, short dskno, LPSTR fname);
short x1_eject_fd(short drv);
void cmt_set(char* fname);
void cmt_ctrl(BYTE cmnd, int isButton);
void fnt_load(void);  // X1.cpp で定義（ANK_FNT / KNJ_FNT をファイルから再読み込み）

// otherfnt_stubs.cpp で定義（毎フレームゲームパッドポーリング + JOYSTICK bit 管理）
extern "C" void joy_flash(void);
// platform_input.cpp で定義（X1 SIO マウス用、Web版では空実装）
void mouse_callback(void);

// グローバル変数
static BOOL   g_running = FALSE;
static int    g_frame_count = 0;

// 実経過時間ベースの framesoundcnt 計算用
// ブラウザの実 fps は 60 に保証されない（58fps 等）ため
// 「実経過時間 × サンプルレート」でフレームごとのサンプル数を決定する
static double g_prev_frame_ms  = 0.0;  // 前フレームの emscripten_get_now() 値
static double g_audio_acc      = 0.0;  // サンプル端数の蓄積

// メインループのコールバック（Emscriptenから毎フレーム呼ばれる）
void main_loop() {
    if (!g_running) {
        return;
    }

    double now = emscripten_get_now();

    // 実経過時間から今フレームで生成すべきサンプル数を計算
    // fps 非依存: 58fps でも 120fps でも正確に ds_rate samples/sec を出す
    if (g_prev_frame_ms > 0.0) {
        double elapsed_ms = now - g_prev_frame_ms;
        // 暴走防止: タブが裏に回った等で極端に長い場合は最大 2 フレーム相当に制限
        if (elapsed_ms > 33.0) elapsed_ms = 33.0;
        if (elapsed_ms <  1.0) elapsed_ms =  1.0;
        g_audio_acc += (double)ds_rate * elapsed_ms / 1000.0;
        framesoundcnt = (DWORD)g_audio_acc;
        g_audio_acc  -= (double)framesoundcnt;
    } else {
        // 初回フレーム: elapsed が不明なので標準値を使う
        framesoundcnt = (DWORD)(ds_rate / 60);
    }
    g_prev_frame_ms = now;

    // タイマーコールバックを回す（FDD モータ状態更新に必要）
    timer_getcount();

    // 入力更新（ゲームパッドポーリング含む）
    joy_flash();
    mouse_callback();

    x1r_exec();

    g_frame_count++;
}

// 初期化関数
BOOL xmil_init() {
    // プラットフォームサブシステムの初期化
    if (!Platform_Graphics_Init(640, 400, 8)) {
        printf("Failed to initialize graphics\n");
        return FALSE;
    }

    if (!Platform_Audio_Init(xmilcfg.samplingrate, 2, 100)) {
        printf("Failed to initialize audio\n");
        return FALSE;
    }

    // WAV サウンドエフェクトの初期化
    // WAV ファイルは --embed-file で埋め込まれている場合のみ再生される。
    // 埋め込まれていない場合は wavecreate() が静かに失敗するため安全。
    WAVE_INIT();
    WAVE_CREATE("FDDSEEK.WAV",  WAV_SEEK,  xmilcfg.MOTORVOL);
    WAVE_CREATE("FDDSEEK1.WAV", WAV_SEEK1, xmilcfg.MOTORVOL);
    WAVE_CREATE("CMTSTOP.WAV",  WAV_STOP,  xmilcfg.MOTORVOL);
    WAVE_CREATE("CMTPLAY.WAV",  WAV_PLAY,  xmilcfg.MOTORVOL);
    WAVE_CREATE("CMTEJECT.WAV", WAV_EJECT, xmilcfg.MOTORVOL);
    WAVE_CREATE("CMTFF.WAV",    WAV_FFREW, xmilcfg.MOTORVOL);

    if (!Platform_Input_Init()) {
        printf("Failed to initialize input\n");
        return FALSE;
    }

    // X1エミュレータの初期化（元のコードを使用）
    x1r_init();

    return TRUE;
}

// 終了処理
void xmil_term() {
    g_running = FALSE;
    x1r_term();
    Platform_Graphics_Term();
    Platform_Audio_Term();
    Platform_Input_Term();
}

// エミュレータの開始
void xmil_start() {
    if (g_running) return;
    g_running = TRUE;
    Platform_Audio_Play();
}

// エミュレータの停止
void xmil_stop() {
    if (!g_running) return;
    g_running = FALSE;
    Platform_Audio_Stop();
}

// メイン関数
int main(int argc, char** argv) {
    // 初期化
    if (!xmil_init()) {
        EM_ASM({ console.error('xmil_init() failed!'); });
        return 1;
    }

    // 自動的に開始
    xmil_start();

    // Emscriptenのメインループを設定（60FPS）
    emscripten_set_main_loop(main_loop, 60, 1);

    // 終了処理（通常は到達しない）
    xmil_term();

    return 0;
}

// JavaScript側から呼び出せるようにエクスポート
#ifdef __cplusplus
extern "C" {
#endif

EMSCRIPTEN_KEEPALIVE
void js_xmil_start() {
    xmil_start();
}

EMSCRIPTEN_KEEPALIVE
void js_xmil_stop() {
    xmil_stop();
}

EMSCRIPTEN_KEEPALIVE
void js_xmil_reset() {
    emm_flush_all_buffers();
    reset_x1(xmilcfg.ROM_TYPE, xmilcfg.SOUND_SW, xmilcfg.DIP_SW);
}

EMSCRIPTEN_KEEPALIVE
void js_insert_disk(const char* path, int drive) {
    if (drive < 0 || drive > 3) drive = 0;
    x1_set_fd((short)drive, 0, (LPSTR)path);
}

EMSCRIPTEN_KEEPALIVE
void js_set_rom_type(int type) {
    if (type >= 1 && type <= 3)
        xmilcfg.ROM_TYPE = (BYTE)type;
}

EMSCRIPTEN_KEEPALIVE
int js_get_rom_type() {
    return (int)x1flg.ROM_TYPE;
}

EMSCRIPTEN_KEEPALIVE
void js_set_dip_sw(int dip) {
    xmilcfg.DIP_SW = (BYTE)dip;
}

EMSCRIPTEN_KEEPALIVE
int js_get_dip_sw() {
    // x1flg.DIP_SW はステートロードで復元される実行時値
    return (int)x1flg.DIP_SW;
}

EMSCRIPTEN_KEEPALIVE
void js_set_skip_line(int val) {
    xmilcfg.SKIP_LINE = val ? 1 : 0;
    reflesh_palette();  // Windows版 xmenu_setskipline() と同様に即時反映
    palandply = 1;
}

EMSCRIPTEN_KEEPALIVE
void js_set_motor(int val) {
    xmilcfg.MOTOR = val ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
void js_set_motor_volume(int vol) {
    if (vol < 0)   vol = 0;
    if (vol > 100) vol = 100;
    xmilcfg.MOTORVOL = (BYTE)vol;
    for (int i = 0; i < 6; i++) {
        WAVE_VOLUME(i, vol);
    }
}

EMSCRIPTEN_KEEPALIVE
void js_set_key_mode(int mode) {
    if (mode < 0 || mode > 2) mode = 0;
    xmilcfg.KEY_MODE = (BYTE)mode;
}

EMSCRIPTEN_KEEPALIVE
void js_set_mouse(int val) {
    xmilcfg.MOUSE_SW = val ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
void js_set_sound_sw(int val) {
    xmilcfg.SOUND_SW = val ? 1 : 0;
    x1flg.SOUND_SW = xmilcfg.SOUND_SW;
}

EMSCRIPTEN_KEEPALIVE
int js_get_sound_sw() {
    return (int)x1flg.SOUND_SW;
}

EMSCRIPTEN_KEEPALIVE
void js_eject_disk(int drive) {
    if (drive < 0 || drive > 3) drive = 0;
    x1_eject_fd((short)drive);
}

EMSCRIPTEN_KEEPALIVE
void js_insert_cmt(const char* path) {
    if (!path || !path[0]) return;
    cmt_set((char*)path);
}

EMSCRIPTEN_KEEPALIVE
void js_cmt_eject() { cmt_ctrl(0x00, 1); }

EMSCRIPTEN_KEEPALIVE
void js_cmt_play()  { cmt_ctrl(0x02, 1); }

EMSCRIPTEN_KEEPALIVE
void js_cmt_stop()  { cmt_ctrl(0x01, 1); }

EMSCRIPTEN_KEEPALIVE
void js_cmt_ff()    { cmt_ctrl(0x03, 1); }

EMSCRIPTEN_KEEPALIVE
void js_cmt_rew()   { cmt_ctrl(0x04, 1); }

// CMT状態取得 (JavaScript側ポーリング用)
EMSCRIPTEN_KEEPALIVE
int js_get_cmt_cmd() {
    return (int)tape.cur_cmd;
}

EMSCRIPTEN_KEEPALIVE
unsigned int js_get_cmt_pos() {
    return (unsigned int)tape.header.position;
}

EMSCRIPTEN_KEEPALIVE
unsigned int js_get_cmt_end() {
    return (unsigned int)tape.header.datasize;
}

EMSCRIPTEN_KEEPALIVE
unsigned int js_get_cmt_freq() {
    return (unsigned int)tape.header.frequency;
}

// NMI リセット (Z80 NMI ライン; 暫定的に IPL リセットと同じ動作)
EMSCRIPTEN_KEEPALIVE
void js_xmil_nmi() {
    reset_x1(xmilcfg.ROM_TYPE, xmilcfg.SOUND_SW, xmilcfg.DIP_SW);
}

// 電源 OFF: エミュレータ停止 + 画面を黒にクリア
EMSCRIPTEN_KEEPALIVE
void js_xmil_power_off() {
    emm_flush_all_buffers();
    xmil_stop();
    Platform_Graphics_Clear(0);
    Platform_Graphics_Flip();
}

// 電源 ON: 全メモリクリア（コールドスタート）→ reset_x1() で起動
// 実機の電源投入と同様に RAM/VRAM/PCG を全消去してから初期化する
EMSCRIPTEN_KEEPALIVE
void js_xmil_power_on() {
    // メインRAM・バンクRAM・VRAM・PCG をゼロクリア（コールドスタート）
    memset(mMAIN, 0, sizeof(mMAIN));
    memset(mBANK, 0, sizeof(mBANK));
    memset(GRP_RAM, 0, sizeof(GRP_RAM));
    memset(TXT_RAM, 0, sizeof(TXT_RAM));
    memset(&pcg, 0, sizeof(pcg));

    // パレットを初期値に戻す（コールドスタート）
    // reset_crtc() は ROM_TYPE >= 3 (Zモード) の場合パレットを保持するが、
    // crtc_cold_reset() で initcrtc を 0 に戻すと次の init_crtc() で全パレットがリセットされる
    crtc_cold_reset();

    // reset_x1() 内の init_vram() で TXT_RAM は再初期化される
    reset_x1(xmilcfg.ROM_TYPE, xmilcfg.SOUND_SW, xmilcfg.DIP_SW);
    xmil_start();
}

// SASI HDD パス設定
// VFS 上の任意パスを SASI デバイス id のイメージとして使用する。
// 空文字列を渡すとデフォルト名 (SASI%d_0.HDD) に戻す。
extern char g_sasi_path[2][256];   // X1_sasi.cpp で定義

EMSCRIPTEN_KEEPALIVE
void js_set_sasi_path(const char* path, int id) {
    if (id < 0 || id > 1) id = 0;
    sasi_close_handle();
    if (!path || !path[0]) {
        g_sasi_path[id][0] = '\0';
    } else {
        strncpy(g_sasi_path[id], path, sizeof(g_sasi_path[id]) - 1);
        g_sasi_path[id][sizeof(g_sasi_path[id]) - 1] = '\0';
    }
}

// フォント再ロード（VFS に配置した FNT*.X1 を読み込み直す）
// VFS にファイルが無い場合 fnt_load() は内蔵 ANK_FNT をそのまま維持する
EMSCRIPTEN_KEEPALIVE
void js_reload_fonts(void) {
    fnt_load();
}

// ---- State save/load ----

EMSCRIPTEN_KEEPALIVE
BYTE* js_save_state(int *out_size, int flags) {
    return save_full_state(out_size, flags);
}

// ---- FDD ----

EMSCRIPTEN_KEEPALIVE
void js_fdd_flush(void) {
    fdd_flush_d88();
    fdd_flush_2d();
}

// ---- EMM ----

EMSCRIPTEN_KEEPALIVE
void js_emm_flush(void) {
    emm_flush_all_buffers();
}

EMSCRIPTEN_KEEPALIVE
void js_emm_reset_slot(int slot) {
    emm_reset_slot(slot);
}

EMSCRIPTEN_KEEPALIVE
int js_emm_take_dirty_slots(void) {
    return (int)emm_take_dirty_slots();
}

EMSCRIPTEN_KEEPALIVE
int js_load_state(const BYTE *data, int size) {
    return load_full_state(data, size);
}

EMSCRIPTEN_KEEPALIVE
const char* js_get_load_warnings(void) {
    return get_load_warnings();
}

#ifdef __cplusplus
}
#endif

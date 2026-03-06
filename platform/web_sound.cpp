//----------------------------------------------------------------------------
// Web Sound System - DSOUNDS replacement for XMillennium Web (Emscripten)
// Implements DSOUNDS struct function pointers using Web Audio API
// PCM globals (normally defined in origsrc/OPMSOUND/DSOUNDS.CPP) are here
//----------------------------------------------------------------------------

#include <emscripten.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "common.h"
#include "opmcore.h"   // INT8/INT16/INT32/UINT8/UINT16/UINT32 型定義
#include "xmil.h"
#include "x1.h"
#include "dsounds.h"
#include "opm.h"

//----------------------------------------------------------------------------
// PCM グローバル変数 (DSOUNDS.CPP の代替)
// dsounds.h で extern 宣言されている
//----------------------------------------------------------------------------
BYTE  pcmbuffer[2*2*44100];   // staging buffer (INX1F_makesample が書き込む)
WORD  pcmbufsize[300];        // フレーム毎サンプル数テーブル
WORD  ds_rate       = 22050;
DWORD pcmfreemax    = 0;
DWORD eventbuffer   = (DWORD)-1;  // OPM_NOMAKE 相当 (DSOUNDS.CPP:21)
DWORD ds_halfbuffer = 0;
DWORD framesoundcnt = 367;        // 安全なデフォルト値 (22050/60≈367); dsounds_makepara()で上書きされる
BYTE  usedsound3    = 0;

//----------------------------------------------------------------------------
// FDD アクセス検出フラグ (ビットマスク: bit0=drive0, bit1=drive1)
// WAV_SEEK(0) / WAV_SEEK1(1) 再生時にセット → js_get_fdd_access() で取得・クリア
// curdrv は FDD_MTR.CPP のグローバル (fddmtr_drvset で FDC.drv に更新される)
//----------------------------------------------------------------------------
extern short curdrv;  // FDD_MTR.CPP

//----------------------------------------------------------------------------
// dsounds_makepara() - PCM パラメータ設定 + OPM/PSG 初期化
// (origsrc/OPMSOUND/DSOUNDS.CPP から移植)
//----------------------------------------------------------------------------
void dsounds_makepara(void) {
    WORD i, cnt, lastcnt;
    WORD delay;

    ds_rate = xmilcfg.samplingrate;
    if (ds_rate < 11025) ds_rate = 11025;
    else if (ds_rate > 55500) ds_rate = 55500;

    INX1F_init();
    INX1F_PSGmode(xmilcfg.PUCHI);

    delay = xmilcfg.delayms;
    if (delay < 100) delay = 100;
    else if (delay > 1000) delay = 1000;

    framesoundcnt = ds_rate / 60;
    lastcnt = 0;
    for (i = 0; i < 266; i++) {
        cnt = (WORD)((ds_rate * (i + 1)) / (60 * 266));
        pcmbufsize[i] = cnt - lastcnt;
        lastcnt = cnt;
    }

    pcmfreemax    = (DWORD)ds_rate * delay / 2000;
    ds_halfbuffer = (DWORD)pcmfreemax * PCMMUL;

}

void dsounds_init(void) {
    dsounds_makepara();  // framesoundcnt/pcmfreemax/ds_halfbuffer を初期化
}

//----------------------------------------------------------------------------
// Web Audio ストリーム関数
//----------------------------------------------------------------------------

static void web_ds_play(void) {
    // ScriptProcessorNode は JS 側 setupAudioStream() で管理
}

static void web_ds_stop(void) {
}

static int web_ds_streamcreate(void) {
    dsounds_makepara();

    return 0;
}

static void web_ds_streamterm(void) {
    // No resources to free
}

static void web_ds_streammakes(DWORD N) {
    if (!N) return;

    // pcmbuffer は最大 pcmfreemax フレーム分
    DWORD maxN = (pcmfreemax < 44100U) ? pcmfreemax : 44100U;
    if (N > maxN) N = maxN;

    INX1F_resetsamplepos();               // pcmmakepos を 0 にリセット
    memset(pcmbuffer, 0, N * PCMMUL);    // OPM/PSG は加算なのでゼロクリア必須
    INX1F_makesample(N);                  // pcmbuffer[0..N*4-1] に INT16 ステレオ書き込み

    // JS リングバッファに INT16 ステレオデータを書き込む
    // オーバーフロー保護: 書き込み可能なスペースを超えた分は破棄する
    EM_ASM({
        var pcm = window.xmilPcm;
        if (!pcm) return;

        // AudioContext 未起動 (ユーザー操作待ち) の場合: データを静かに破棄して
        // バッファを空状態に保つ (OVERFLOW 警告を出さない)
        if (!window.xmilAudioProcessor) {
            window.xmilPcmRead  = window.xmilPcmWrite;
            return;
        }

        var size  = window.xmilPcmSize;
        var wp    = window.xmilPcmWrite;
        var rp    = window.xmilPcmRead;
        var i16   = HEAP16;
        var base  = $0 >> 1;   // HEAP16 インデックス (2バイト単位)
        var n     = $1;

        // 書き込み可能スロット数: size - 読み取り待ちスロット数
        // (空バッファ時: avail_read=0 → avail_write=size)
        var avail_read  = (wp - rp + size) % size;
        var avail_write = size - avail_read;
        // 安全マージン 4スロット (2ステレオフレーム分) を確保
        var max_frames  = (avail_write > 4) ? ((avail_write - 4) >> 1) : 0;

        // オーバーフロー発生時にログ (1秒に1回程度)
        if (n > max_frames) {
            if (!window._xmilOvfCount) window._xmilOvfCount = 0;
            window._xmilOvfCount++;
            var now = performance.now();
            if (!window._xmilOvfLast || now - window._xmilOvfLast > 1000) {
                console.warn('[xmil audio] OVERFLOW: tried to write ' + n +
                    ' frames, only ' + max_frames + ' available' +
                    ' (avail_read=' + (avail_read>>1) + ', avail_write=' + (avail_write>>1) + ')' +
                    ' total=' + window._xmilOvfCount);
                window._xmilOvfLast = now;
            }
            n = max_frames;
        }

        for (var i = 0; i < n; i++) {
            pcm[wp]     = i16[base + i * 2];      // L
            pcm[wp + 1] = i16[base + i * 2 + 1];  // R
            wp = (wp + 2) % size;
        }
        window.xmilPcmWrite = wp;

    }, pcmbuffer, (int)N);
}

static void web_ds_streamcallback(void) {
    // プッシュ型のため no-op（SDL2 版と同じ）
}

static void web_ds_stramclear(void) {
    // リングバッファリセット: 読み書きポインタを揃えてサイレンスに
    EM_ASM({
        if (window.xmilPcm) {
            window.xmilPcmRead  = 0;
            window.xmilPcmWrite = 0;
        }
        // AudioWorklet リセット
        if (window.xmilAudioProcessor && window.xmilAudioProcessor.port) {
            window.xmilAudioProcessor.port.postMessage({ type: 'reset' });
        }
    });
}

static void web_ds_stramreset(void) {
    web_ds_stramclear();
}

//----------------------------------------------------------------------------
// WAV 関数 (Web Audio API 実装)
// シーク音 / CMT テープ音をブラウザで再生する。
// WAV ファイルは --embed-file で WASM に埋め込まれた場合のみ再生される。
// 埋め込まれていない場合は wavecreate() が -1 を返して以降は無音で動作する。
//----------------------------------------------------------------------------

#define WAV_SLOTS 8
static int s_wav_volume[WAV_SLOTS];  // per-slot volume (0–100)

static void web_ds_waveinit(void) {
    for (int i = 0; i < WAV_SLOTS; i++) s_wav_volume[i] = 80;
    EM_ASM({
        var n = $0;
        window.xmilWavBufs = new Array(n).fill(null);
        window.xmilWavSrcs = new Array(n).fill(null);
        window.xmilWavVols = new Array(n).fill(0.8);
    }, WAV_SLOTS);
}

static void web_ds_waveterm(void) {
    EM_ASM({
        if (window.xmilWavSrcs) {
            for (var i = 0; i < window.xmilWavSrcs.length; i++) {
                if (window.xmilWavSrcs[i]) {
                    try { window.xmilWavSrcs[i].stop(); } catch(e) {}
                    window.xmilWavSrcs[i] = null;
                }
            }
        }
        window.xmilWavBufs = null;
        window.xmilWavSrcs = null;
        window.xmilWavVols = null;
    });
}

// WAV ファイルを VFS から読み込み、Web Audio API で非同期デコードして保存する。
// decodeAudioData は非同期だが、ロード完了前に waveplay が呼ばれても
// バッファが null のため無音になるだけで問題ない（シーク完了より先にロードが終わる）。
static int web_ds_wavecreate(LPSTR filename, int num, int volume) {
    if (!filename || num < 0 || num >= WAV_SLOTS) return -1;

    FILE* fp = fopen(filename, "rb");
    if (!fp) {
        printf("web_ds_wavecreate: '%s' not found (slot %d) - seek sound disabled\n",
               filename, num);
        return -1;
    }

    fseek(fp, 0, SEEK_END);
    long size = ftell(fp);
    fseek(fp, 0, SEEK_SET);

    if (size <= 0 || size > 4 * 1024 * 1024) {
        printf("web_ds_wavecreate: '%s' invalid size %ld\n", filename, size);
        fclose(fp);
        return -1;
    }

    void* data = malloc((size_t)size);
    if (!data) { fclose(fp); return -1; }
    size_t nread = fread(data, 1, (size_t)size, fp);
    fclose(fp);

    s_wav_volume[num] = volume;

    // WASM ヒープのバイト列を JS へ渡す。
    // AudioContext 作成前 (ユーザー操作待ち) は xmilWavPending に生データを保存し、
    // AudioContext 作成後 (setupAudioStream 内) に pre.js 側でデコードする。
    EM_ASM({
        var num  = $0;
        var ptr  = $1;
        var size = $2;
        var vol  = $3 / 100.0;
        if (!window.xmilWavBufs)    window.xmilWavBufs    = [];
        if (!window.xmilWavSrcs)    window.xmilWavSrcs    = [];
        if (!window.xmilWavVols)    window.xmilWavVols    = [];
        if (!window.xmilWavPending) window.xmilWavPending = [];
        window.xmilWavVols[num] = vol;
        var ab = HEAPU8.buffer.slice(ptr, ptr + size);
        if (window.audioContext) {
            // AudioContext 既存: 即デコード
            window.audioContext.decodeAudioData(ab,
                function(buf) {
                    window.xmilWavBufs[num] = buf;
                },
                function(err) {
                    console.warn('[xmil wav] decode error slot=' + num + ': ' + err);
                }
            );
        } else {
            // AudioContext 未作成: pre.js の setupAudioStream() 完了後にデコード
            window.xmilWavPending[num] = ab;
        }
    }, num, data, (int)nread, volume);

    free(data);
    return 0;
}

static int web_ds_waveplay(int num, int lpflg) {
    // WAV_SEEK(0) / WAV_SEEK1(1) → FDD アクセス LED をイベントで直接通知
    if (num == 0 || num == 1) {
        int drv = (int)curdrv;
        if (drv < 0) drv = 0;
        if (drv > 3) drv = 3;
        EM_ASM({
            if (window.XMillennium && window.XMillennium.onFddAccess) {
                window.XMillennium.onFddAccess($0);
            }
        }, (1 << drv));
    }
    EM_ASM({
        var num  = $0;
        var loop = !!$1;
        if (!window.audioContext || !window.xmilWavBufs || !window.xmilWavBufs[num]) return;

        // 同じスロットが再生中なら先に止める
        if (window.xmilWavSrcs && window.xmilWavSrcs[num]) {
            try { window.xmilWavSrcs[num].stop(); } catch(e) {}
            window.xmilWavSrcs[num] = null;
        }
        if (!window.xmilWavSrcs) window.xmilWavSrcs = [];

        // autoplay policy 対策: suspended なら resume する
        if (window.audioContext.state === 'suspended') {
            window.audioContext.resume();
        }

        var vol = (window.xmilWavVols && window.xmilWavVols[num] !== undefined)
                    ? window.xmilWavVols[num] : 0.8;

        var gainNode = window.audioContext.createGain();
        gainNode.gain.value = vol;
        var dest = window.xmilMasterGain || window.audioContext.destination;
        gainNode.connect(dest);

        var src = window.audioContext.createBufferSource();
        src.buffer = window.xmilWavBufs[num];
        src.loop   = loop;
        src.connect(gainNode);
        src.onended = function() {
            if (window.xmilWavSrcs && window.xmilWavSrcs[num] === src) {
                window.xmilWavSrcs[num] = null;
            }
        };
        src.start();
        window.xmilWavSrcs[num] = src;
    }, num, lpflg);
    return 0;
}

static void web_ds_wavestop(int num) {
    EM_ASM({
        var num = $0;
        if (!window.xmilWavSrcs || !window.xmilWavSrcs[num]) return;
        try { window.xmilWavSrcs[num].stop(); } catch(e) {}
        window.xmilWavSrcs[num] = null;
    }, num);
}

static void web_ds_wavevolume(int num, int volume) {
    if (num < 0 || num >= WAV_SLOTS) return;
    s_wav_volume[num] = volume;
    EM_ASM({
        var num = $0;
        var vol = $1 / 100.0;
        if (window.xmilWavVols) window.xmilWavVols[num] = vol;
    }, num, volume);
}

static void web_ds_waverelease(int num) {
    EM_ASM({
        var num = $0;
        if (window.xmilWavSrcs && window.xmilWavSrcs[num]) {
            try { window.xmilWavSrcs[num].stop(); } catch(e) {}
            window.xmilWavSrcs[num] = null;
        }
        if (window.xmilWavBufs) window.xmilWavBufs[num] = null;
    }, num);
}

//----------------------------------------------------------------------------
// DSOUNDS 構造体 (Web Audio 実装で全 DSOUNDS 関数ポインタを満たす)
//----------------------------------------------------------------------------
DSOUNDS dsounds = {
    web_ds_play,
    web_ds_stop,
    web_ds_streamcreate,
    web_ds_streamterm,
    web_ds_streammakes,
    web_ds_streamcallback,
    web_ds_stramclear,
    web_ds_stramreset,
    web_ds_waveinit,
    web_ds_waveterm,
    web_ds_wavecreate,
    web_ds_waveplay,
    web_ds_wavestop,
    web_ds_wavevolume,
    web_ds_waverelease
};

//----------------------------------------------------------------------------
// リンクスタブ (DSOUNDS.H で宣言; src/Xmil.cpp が未ビルドのため参照なし)
//----------------------------------------------------------------------------
int  InitDirectSound(void) { return 0; }
void TermDirectSound(void) {}

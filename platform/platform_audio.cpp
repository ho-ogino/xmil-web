#include "platform_audio.h"
#include <emscripten.h>
#include <stdlib.h>
#include <string.h>

// web_sound.cpp から PCM パラメータ初期化
extern void dsounds_init(void);

// オーディオ状態
static struct {
    BYTE* buffer;
    int buffer_size;
    int sample_rate;
    int channels;
    int write_pos;
    int read_pos;
    BOOL initialized;
    BOOL playing;
} g_audio = {0};

BOOL Platform_Audio_Init(int sample_rate, int channels, int buffer_size_ms) {
    if (g_audio.initialized) {
        Platform_Audio_Term();
    }

    g_audio.sample_rate = sample_rate;
    g_audio.channels = channels;
    g_audio.buffer_size = (sample_rate * channels * 2 * buffer_size_ms) / 1000;

    // リングバッファの確保
    g_audio.buffer = (BYTE*)malloc(g_audio.buffer_size);
    if (!g_audio.buffer) {
        return FALSE;
    }
    memset(g_audio.buffer, 0, g_audio.buffer_size);

    g_audio.write_pos = 0;
    g_audio.read_pos = 0;
    g_audio.playing = FALSE;

    // PCMリングバッファ初期化のみ行う。
    // AudioContext の生成はユーザー操作後に pre.js::setupAudioStream() が担当する。
    // ここで new AudioContext() すると Chrome の autoplay policy で
    // "AudioContext was not allowed to start" 警告が毎フレーム発生するため行わない。
    EM_ASM({
        var sr = $0;
        // C++ 側のサンプルレートを JS に公開（pre.js から参照）
        window.xmilSampleRate = sr;
        // PCMリングバッファ (Int16 ステレオ、2秒分)
        window.xmilPcmSize  = sr * 2 * 2;  // 2秒×ステレオ×Int16
        window.xmilPcm      = new Int16Array(window.xmilPcmSize);
        window.xmilPcmWrite = 0;
        window.xmilPcmRead  = 0;
    }, sample_rate);

    g_audio.initialized = TRUE;

    // PCM パラメータを初期化 (framesoundcnt, pcmfreemax, OPM/PSG)
    dsounds_init();

    return TRUE;
}

void Platform_Audio_Term(void) {
    if (g_audio.buffer) {
        free(g_audio.buffer);
        g_audio.buffer = NULL;
    }
    g_audio.initialized = FALSE;
}

BYTE* Platform_Audio_LockBuffer(int* size) {
    if (!g_audio.initialized) {
        return NULL;
    }
    if (size) {
        *size = g_audio.buffer_size;
    }
    return g_audio.buffer;
}

void Platform_Audio_UnlockBuffer(int bytes_written) {
    if (!g_audio.initialized || !g_audio.playing) {
        return;
    }

    // Web Audio APIにバッファを送信
    EM_ASM({
        var audioCtx = window.audioContext;
        if (!audioCtx) return;

        var bufferPtr = $0;
        var bufferSize = $1;
        var sampleRate = $2;
        var channels = $3;

        // 16bitステレオと仮定
        var numSamples = bufferSize / (2 * channels);
        var audioBuffer = audioCtx.createBuffer(channels, numSamples, sampleRate);

        // バッファにデータをコピー
        for (var ch = 0; ch < channels; ch++) {
            var channelData = audioBuffer.getChannelData(ch);
            for (var i = 0; i < numSamples; i++) {
                var offset = (i * channels + ch) * 2;
                var sample = (HEAP8[bufferPtr + offset + 1] << 8) | HEAPU8[bufferPtr + offset];
                channelData[i] = sample / 32768.0;
            }
        }

        // バッファを再生キューに追加
        var source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);

        var currentTime = audioCtx.currentTime;
        if (window.audioNextTime < currentTime) {
            window.audioNextTime = currentTime;
        }

        source.start(window.audioNextTime);
        window.audioNextTime += audioBuffer.duration;

    }, g_audio.buffer, bytes_written, g_audio.sample_rate, g_audio.channels);
}

void Platform_Audio_Play(void) {
    g_audio.playing = TRUE;
}

void Platform_Audio_Stop(void) {
    g_audio.playing = FALSE;
    EM_ASM({
        if (window.audioContext) {
            window.audioNextTime = 0;
        }
    });
}

void Platform_Audio_Pause(BOOL pause) {
    g_audio.playing = !pause;
}

void Platform_Audio_SetVolume(int volume) {
    // Web Audio APIでボリューム制御
    EM_ASM({
        var vol = $0 / 100.0;
        if (window.audioContext && window.audioContext.destination) {
            if (!window.gainNode) {
                window.gainNode = window.audioContext.createGain();
                window.gainNode.connect(window.audioContext.destination);
            }
            window.gainNode.gain.value = vol;
        }
    }, volume);
}

int Platform_Audio_GetBufferStatus(void) {
    // 簡易的な実装：書き込み位置を返す
    return g_audio.write_pos;
}

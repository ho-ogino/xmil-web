#ifndef PLATFORM_AUDIO_H
#define PLATFORM_AUDIO_H

#include "platform_types.h"

#ifdef __cplusplus
extern "C" {
#endif

// オーディオサブシステムの初期化
BOOL Platform_Audio_Init(int sample_rate, int channels, int buffer_size_ms);
void Platform_Audio_Term(void);

// オーディオバッファの取得とロック
BYTE* Platform_Audio_LockBuffer(int* size);
void Platform_Audio_UnlockBuffer(int bytes_written);

// 再生制御
void Platform_Audio_Play(void);
void Platform_Audio_Stop(void);
void Platform_Audio_Pause(BOOL pause);

// ボリューム制御（0-100）
void Platform_Audio_SetVolume(int volume);

// バッファの状態取得
int Platform_Audio_GetBufferStatus(void);

#ifdef __cplusplus
}
#endif

#endif // PLATFORM_AUDIO_H

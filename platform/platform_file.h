#ifndef PLATFORM_FILE_H
#define PLATFORM_FILE_H

#include "platform_types.h"

#ifdef __cplusplus
extern "C" {
#endif

// ファイルハンドル型
typedef void* FILEHANDLE;

// ファイルオープンモード
#define FILE_READ       0x01
#define FILE_WRITE      0x02
#define FILE_CREATE     0x04

// ファイルシーク位置（stdio.hで定義済みなので不要）
// #define SEEK_SET        0
// #define SEEK_CUR        1
// #define SEEK_END        2

// ファイルI/O関数
FILEHANDLE Platform_File_Open(const char* filename, int mode);
void Platform_File_Close(FILEHANDLE handle);
int Platform_File_Read(FILEHANDLE handle, void* buffer, int size);
int Platform_File_Write(FILEHANDLE handle, const void* buffer, int size);
int Platform_File_Seek(FILEHANDLE handle, int offset, int whence);
int Platform_File_Tell(FILEHANDLE handle);
int Platform_File_GetSize(FILEHANDLE handle);

// ファイル/ディレクトリ操作
BOOL Platform_File_Exists(const char* filename);
BOOL Platform_File_Delete(const char* filename);
BOOL Platform_Dir_Create(const char* dirname);
BOOL Platform_Dir_Exists(const char* dirname);

// ファイル選択ダイアログ（Emscripten経由でHTML5 File APIを使用）
const char* Platform_File_OpenDialog(const char* filter, const char* title);
const char* Platform_File_SaveDialog(const char* filter, const char* title);

#ifdef __cplusplus
}
#endif

#endif // PLATFORM_FILE_H

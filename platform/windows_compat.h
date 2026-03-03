#ifndef WINDOWS_COMPAT_H
#define WINDOWS_COMPAT_H

// Windows API互換ヘッダー（Emscriptenビルド用）

#ifdef EMSCRIPTEN_BUILD

// 標準ライブラリ
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

// 基本的な型定義
#include "platform_types.h"

// windows.hのインクルードを防ぐ
#define _WINDOWS_
#define _WINDOWS_H
#define __WINDOWS__

// MSVC固有の呼び出し規約をクリア
#define __fastcall
#define __cdecl
#define __stdcall
#define __declspec(x)
#define LABEL  // naked function attribute not supported

// Windows APIスタブ
#define WINAPI
#define CALLBACK

// メッセージ関連
#define WM_CREATE           0x0001
#define WM_DESTROY          0x0002
#define WM_PAINT            0x000F
#define WM_CLOSE            0x0010
#define WM_QUIT             0x0012
#define WM_KEYDOWN          0x0100
#define WM_KEYUP            0x0101
#define WM_COMMAND          0x0111
#define WM_SYSCOMMAND       0x0112
#define WM_LBUTTONDOWN      0x0201
#define WM_LBUTTONUP        0x0202
#define WM_MOUSEMOVE        0x0200

// その他の定義
#define MAX_PATH            260
#define INFINITE            0xFFFFFFFF

// マクロ
#define LOWORD(l)           ((WORD)(((DWORD)(l)) & 0xffff))
#define HIWORD(l)           ((WORD)((((DWORD)(l)) >> 16) & 0xffff))
#define LOBYTE(w)           ((BYTE)(((WORD)(w)) & 0xff))
#define HIBYTE(w)           ((BYTE)((((WORD)(w)) >> 8) & 0xff))

// ファイル関連
typedef void* HANDLE;
#define INVALID_HANDLE_VALUE ((HANDLE)(long)-1)

// ファイルアクセスフラグ
#define GENERIC_READ            0x80000000
#define GENERIC_WRITE           0x40000000
#define OPEN_EXISTING           3
#define CREATE_ALWAYS           2
#define FILE_ATTRIBUTE_NORMAL   0x00000080

// ダイアログ/メニュー関連
#define IDYES                   6
#define IDNO                    7
#define IDOK                    1
#define IDCANCEL                2
#define MB_YESNO                0x00000004
#define MB_ICONQUESTION         0x00000020
#define MB_TASKMODAL            0x00002000

// メニューフラグ
#define MF_CHECKED              0x00000008
#define MF_UNCHECKED            0x00000000
#define MF_GRAYED               0x00000001

// GDI構造体
typedef struct tagBITMAPINFOHEADER {
    DWORD biSize;
    long  biWidth;
    long  biHeight;
    WORD  biPlanes;
    WORD  biBitCount;
    DWORD biCompression;
    DWORD biSizeImage;
    long  biXPelsPerMeter;
    long  biYPelsPerMeter;
    DWORD biClrUsed;
    DWORD biClrImportant;
} BITMAPINFOHEADER;

// 文字列型
typedef char* LPSTR;
typedef const char* LPCSTR;
typedef wchar_t* LPWSTR;
typedef const wchar_t* LPCWSTR;

// メッセージパラメータ型
typedef unsigned long WPARAM;
typedef long LPARAM;
typedef long LRESULT;

// メモリ管理
#define ZeroMemory(p, size) memset((p), 0, (size))
#define CopyMemory(dst, src, size) memcpy((dst), (src), (size))

// 時間関連
typedef struct _SYSTEMTIME {
    WORD wYear;
    WORD wMonth;
    WORD wDayOfWeek;
    WORD wDay;
    WORD wHour;
    WORD wMinute;
    WORD wSecond;
    WORD wMilliseconds;
} SYSTEMTIME;

// RECTはplatform_types.hで定義済み

// パレットエントリ
typedef struct tagPALETTEENTRY {
    BYTE peRed;
    BYTE peGreen;
    BYTE peBlue;
    BYTE peFlags;
} PALETTEENTRY;

// スタブ関数
inline void OutputDebugString(const char* str) {
    (void)str;  // リリースビルドでは出力しない
}

// emscripten_get_now() は double (ミリ秒) を返す。DWORD にキャストして
// GetTickCount() 互換の「ミリ秒タイムスタンプ」を提供する。
// Timer.cpp の fddmtr_callback/dclock_callback や FDD_MTR.CPP の nextevent
// 計算が正常に動作するために必須。
#include <emscripten.h>
inline DWORD GetTickCount() {
    return (DWORD)emscripten_get_now();
}

inline void Sleep(DWORD ms) {
    // スタブ
}

inline void SetWindowText(HWND hwnd, const char* text) {
    // スタブ - Web版ではウィンドウタイトルを変更しない
}

#define wsprintf sprintf

// ファイルI/O関数スタブ（platform_file.cppで実装予定）
inline HANDLE CreateFile(const char* filename, DWORD access, DWORD share,
                         void* security, DWORD creation, DWORD flags, HANDLE templ) {
    // Emscripten VFSを使った実装に置き換え予定
    FILE* fp = NULL;
    if (creation == OPEN_EXISTING) {
        if (access & GENERIC_WRITE) {
            fp = fopen(filename, "r+b");
        } else {
            fp = fopen(filename, "rb");
        }
    } else if (creation == CREATE_ALWAYS) {
        fp = fopen(filename, "wb");
    }
    return fp ? (HANDLE)fp : INVALID_HANDLE_VALUE;
}

inline BOOL CloseHandle(HANDLE handle) {
    if (handle && handle != INVALID_HANDLE_VALUE) {
        fclose((FILE*)handle);
        return TRUE;
    }
    return FALSE;
}

inline DWORD SetFilePointer(HANDLE handle, long distance, long* distanceHigh, DWORD mode) {
    if (handle && handle != INVALID_HANDLE_VALUE) {
        int whence = (mode == 0) ? SEEK_SET : (mode == 1) ? SEEK_CUR : SEEK_END;
        fseek((FILE*)handle, distance, whence);
        return ftell((FILE*)handle);
    }
    return 0xFFFFFFFF;
}

inline DWORD GetFileSize(HANDLE handle, DWORD* sizeHigh) {
    if (handle && handle != INVALID_HANDLE_VALUE) {
        FILE* fp = (FILE*)handle;
        long pos = ftell(fp);
        fseek(fp, 0, SEEK_END);
        long size = ftell(fp);
        fseek(fp, pos, SEEK_SET);
        if (sizeHigh) *sizeHigh = 0;
        return (DWORD)size;
    }
    return 0;
}

inline BOOL ReadFile(HANDLE handle, void* buffer, DWORD toRead, DWORD* read, void* overlapped) {
    if (handle && handle != INVALID_HANDLE_VALUE) {
        size_t result = fread(buffer, 1, toRead, (FILE*)handle);
        if (read) *read = (DWORD)result;
        return TRUE;
    }
    return FALSE;
}

inline BOOL WriteFile(HANDLE handle, const void* buffer, DWORD toWrite, DWORD* written, void* overlapped) {
    if (handle && handle != INVALID_HANDLE_VALUE) {
        size_t result = fwrite(buffer, 1, toWrite, (FILE*)handle);
        if (written) *written = (DWORD)result;
        return TRUE;
    }
    return FALSE;
}

inline DWORD GetFileAttributes(const char* filename) {
    // スタブ - ファイル存在チェック
    FILE* fp = fopen(filename, "rb");
    if (fp) {
        fclose(fp);
        return FILE_ATTRIBUTE_NORMAL;
    }
    return 0xFFFFFFFF;
}

inline BOOL IsDBCSLeadByte(BYTE ch) {
    // スタブ - Shift-JISのリードバイト判定を簡易実装
    return (ch >= 0x81 && ch <= 0x9F) || (ch >= 0xE0 && ch <= 0xFC);
}

inline char* CharNext(const char* p) {
    // スタブ - マルチバイト文字の次の文字へ
    if (IsDBCSLeadByte((BYTE)*p) && *(p+1)) {
        return (char*)(p + 2);
    }
    return (char*)(p + 1);
}

// メッセージボックス（スタブ）
inline int MessageBox(HWND hwnd, const char* text, const char* caption, DWORD type) {
    printf("[MessageBox] %s: %s\n", caption, text);
    return IDYES;  // 常にYesを返す
}

// メニュー関連（スタブ）
typedef void* HMENU;
inline HMENU GetMenu(HWND hwnd) {
    return NULL;
}

inline BOOL CheckMenuItem(HMENU hmenu, DWORD item, DWORD flags) {
    return TRUE;
}

// メモリ管理（スタブ）
typedef void* HGLOBAL;

#define GMEM_MOVEABLE   0x0002
#define GPTR            0x0040

inline HGLOBAL GlobalAlloc(DWORD flags, size_t size) {
    return malloc(size);
}

inline void* GlobalLock(HGLOBAL hMem) {
    return hMem;  // 既にポインタなのでそのまま返す
}

inline BOOL GlobalUnlock(HGLOBAL hMem) {
    return TRUE;
}

inline HGLOBAL GlobalFree(HGLOBAL hMem) {
    if (hMem) free(hMem);
    return NULL;
}

#else
// Windows版の場合は通常のwindows.hをインクルード
#include <windows.h>
#endif

#endif // WINDOWS_COMPAT_H

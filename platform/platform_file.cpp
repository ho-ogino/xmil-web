#include "platform_file.h"
#include <emscripten.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Emscriptenの仮想ファイルシステム（MEMFS）を使用

FILEHANDLE Platform_File_Open(const char* filename, int mode) {
    const char* fmode = "rb";

    if (mode & FILE_WRITE) {
        if (mode & FILE_CREATE) {
            fmode = "wb+";
        } else {
            fmode = "rb+";
        }
    } else if (mode & FILE_READ) {
        fmode = "rb";
    }

    FILE* fp = fopen(filename, fmode);
    return (FILEHANDLE)fp;
}

void Platform_File_Close(FILEHANDLE handle) {
    if (handle) {
        fclose((FILE*)handle);
    }
}

int Platform_File_Read(FILEHANDLE handle, void* buffer, int size) {
    if (!handle) return 0;
    return fread(buffer, 1, size, (FILE*)handle);
}

int Platform_File_Write(FILEHANDLE handle, const void* buffer, int size) {
    if (!handle) return 0;
    return fwrite(buffer, 1, size, (FILE*)handle);
}

int Platform_File_Seek(FILEHANDLE handle, int offset, int whence) {
    if (!handle) return -1;
    return fseek((FILE*)handle, offset, whence);
}

int Platform_File_Tell(FILEHANDLE handle) {
    if (!handle) return -1;
    return ftell((FILE*)handle);
}

int Platform_File_GetSize(FILEHANDLE handle) {
    if (!handle) return -1;
    FILE* fp = (FILE*)handle;
    int current = ftell(fp);
    fseek(fp, 0, SEEK_END);
    int size = ftell(fp);
    fseek(fp, current, SEEK_SET);
    return size;
}

BOOL Platform_File_Exists(const char* filename) {
    FILE* fp = fopen(filename, "rb");
    if (fp) {
        fclose(fp);
        return TRUE;
    }
    return FALSE;
}

BOOL Platform_File_Delete(const char* filename) {
    return remove(filename) == 0;
}

BOOL Platform_Dir_Create(const char* dirname) {
    // EmscriptenのMEMFSでは自動的にディレクトリが作成される
    return TRUE;
}

BOOL Platform_Dir_Exists(const char* dirname) {
    // 簡易実装
    return TRUE;
}

const char* Platform_File_OpenDialog(const char* filter, const char* title) {
    // HTML5 File APIを使用したファイル選択
    // これはJavaScript側で実装する必要がある
    static char filename[256] = {0};

    int result = EM_ASM_INT({
        // ファイル選択ダイアログを表示
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = UTF8ToString($0);

        return new Promise(function(resolve) {
            input.onchange = function(e) {
                var file = e.target.files[0];
                if (file) {
                    var reader = new FileReader();
                    reader.onload = function(evt) {
                        var data = new Uint8Array(evt.target.result);
                        var filename = '/' + file.name;

                        // Emscriptenの仮想ファイルシステムに書き込む
                        FS.writeFile(filename, data);

                        // ファイル名を返す
                        var len = lengthBytesUTF8(filename) + 1;
                        var strPtr = _malloc(len);
                        stringToUTF8(filename, strPtr, len);
                        resolve(strPtr);
                    };
                    reader.readAsArrayBuffer(file);
                } else {
                    resolve(0);
                }
            };
            input.click();
        });
    }, filter);

    return result ? (const char*)result : NULL;
}

const char* Platform_File_SaveDialog(const char* filter, const char* title) {
    // 保存ダイアログはブラウザの制限により実装が難しい
    // ダウンロード機能として実装
    return NULL;
}

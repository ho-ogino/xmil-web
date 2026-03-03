#pragma once
// Stub keylog for web/Emscripten build (no-op)
#include <stdarg.h>
static inline int keylog_enabled(void) { return 0; }
static inline void keylog_printf(const char* fmt, ...) { (void)fmt; }

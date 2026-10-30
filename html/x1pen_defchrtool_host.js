// x1pen_defchrtool_host.js — X1Pen's host adapter for DEFCHR TOOL for Web, published as
// defchrtool/x1pen-host.js and loaded by the tool's page (in an iframe of x1pen.html) before its
// module script, as the tool's X1HOST.md asks. It sets window.X1Host = { exportPCG, copyPCG,
// saveFile }; the work is done by X1Pen (window.parent.X1PenDefchrToolBridge). Opened on its own,
// outside X1Pen, the page gets no X1Host and works as the standalone tool.
// - exportPCG ("X1Pen に挿入"): X1Pen inserts into the target tab.
// - copyPCG ("クリップボードにコピー"): X1Pen builds the text; it is written to the clipboard from
//   here, since this frame has the focus (Chrome refuses a write from X1Pen's page then).
// - saveFile ("ファイル保存"): X1Pen's page writes the file. Firefox checks a download link clicked
//   inside this iframe against X1Pen's CSP frame-src, which does not allow blob:, and drops it.

(function() {
    'use strict';

    var bridge = null;
    try {
        bridge = window.parent && window.parent !== window ? window.parent.X1PenDefchrToolBridge : null;
    } catch (e) {
        bridge = null;     // a parent of another origin: not X1Pen
    }
    if (!bridge) return;

    // A result from X1Pen's window, copied into this window's objects
    function localResult(result) {
        if (!result || typeof result !== 'object') return result;
        var out = { ok: result.ok };
        ['insertedInto', 'code', 'message'].forEach(function(key) {
            if (result[key] !== undefined) out[key] = result[key];
        });
        return out;
    }

    function localError(error) {
        return new Error(error && error.message ? String(error.message) : 'X1Pen failed');
    }

    function copyText(text) {
        if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
            return Promise.reject(new Error('no clipboard'));
        }
        return navigator.clipboard.writeText(text);
    }

    window.X1Host = {
        exportPCG: function(request) {
            return new Promise(function(resolve, reject) {
                Promise.resolve(bridge.exportPCG(request)).then(function(result) {
                    resolve(localResult(result));
                }, function(error) {
                    reject(localError(error));
                });
            });
        },
        copyPCG: function(request) {
            return new Promise(function(resolve, reject) {
                Promise.resolve(bridge.formatPCG(request)).then(function(result) {
                    if (!result || result.ok !== true) { resolve(localResult(result)); return; }
                    var message = String(result.message);
                    copyText(String(result.text)).then(function() {
                        resolve({ ok: true, message: message });
                        try { bridge.copied(message); } catch (e) { /* only X1Pen's status line */ }
                    }, function() {
                        resolve({ ok: false, code: 'unavailable',
                            message: 'クリップボードに書き込めませんでした。ブラウザがクリップボードへの書き込みを許しているか確かめてください。' });
                    });
                }, function(error) {
                    reject(localError(error));
                });
            });
        },
        saveFile: function(blob, fileName) {
            try {
                bridge.download(blob, fileName);
            } catch (e) {
                throw localError(e);
            }
        }
    };

    // Focus in the tool pauses the emulator, as in X1Pen's other editors
    window.addEventListener('focus', function() { bridge.focus(); });
    window.addEventListener('blur', function() { bridge.blur(); });
})();

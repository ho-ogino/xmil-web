// x1pen_defchrtool_host.js — X1Pen's host adapter for DEFCHR TOOL for Web, published as
// defchrtool/x1pen-host.js and loaded by the tool's page (in an iframe of x1pen.html) before its
// module script, as the tool's X1HOST.md asks. It sets window.X1Host = { exportPCG }; the inserting
// is done by X1Pen (window.parent.X1PenDefchrToolBridge). Opened on its own, outside X1Pen, the
// page gets no X1Host and works as the standalone tool.
// "ファイル保存" has X1Pen's page write the file: Firefox checks a download link clicked inside this
// iframe against X1Pen's CSP frame-src, which does not allow blob:, and drops the download. The
// tool clicks a detached <a download href="blob:..."> and revokes the URL right after, so the Blob
// is remembered when its URL is made and handed over during the click.

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

    window.X1Host = {
        exportPCG: function(request) {
            return new Promise(function(resolve, reject) {
                Promise.resolve(bridge.exportPCG(request)).then(function(result) {
                    resolve(localResult(result));
                }, function(error) {
                    reject(new Error(error && error.message ? String(error.message) : 'X1Pen failed'));
                });
            });
        }
    };

    var blobs = new Map();     // blob: URLs made in this window -> their Blob, until revoked
    var createObjectURL = URL.createObjectURL;
    var revokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = function(object) {
        var url = createObjectURL.call(URL, object);
        if (object && typeof object.arrayBuffer === 'function') blobs.set(url, object);
        return url;
    };
    URL.revokeObjectURL = function(url) {
        blobs.delete(url);
        return revokeObjectURL.call(URL, url);
    };
    var click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
        var blob = this.hasAttribute('download') ? blobs.get(this.href) : undefined;
        if (!blob) return click.call(this);
        bridge.download(blob, this.getAttribute('download'));
    };

    // Focus in the tool pauses the emulator, as in X1Pen's other editors
    window.addEventListener('focus', function() { bridge.focus(); });
    window.addEventListener('blur', function() { bridge.blur(); });
})();

// x1pen_x1basic_host.js — X1Pen's host adapter for X1 BASIC Editor, published as
// x1basic/src/x1pen-host.js and loaded by the editor page (in an iframe of x1pen.html) before
// host.js. It sets window.X1Host synchronously; the program itself lives in X1Pen
// (window.parent.X1PenHuBasicEditorBridge), so there is no "unsaved" state to protect.
// "エクスポート" writes the bytes to a file; "インポート…" reads a file into the editor. The editor
// hides "新規" and "別名で保存…" when a host is injected, so their shortcuts are not mapped here.

(function() {
    'use strict';

    var bridge = window.parent && window.parent !== window ? window.parent.X1PenHuBasicEditorBridge : null;
    if (!bridge) throw new Error('X1 BASIC Editor here runs only inside X1Pen (x1pen.html)');

    var MAX_BYTES = 2 * 1024 * 1024;
    var fileName = 'PROGRAM.BAS';
    var command = null;
    var loads = 0;              // programs X1Pen has handed to the editor
    // The font the editor shows, as a 256x8 bitmap for PCG fonts: null until the user picks one
    // (X1Pen's registered ROM, else the built-in font), 'builtin' after "内蔵に戻す"
    var baseFont = null;
    var fontCandidate = null;
    var fontTokens = 0;

    // Bytes from X1Pen's window: copy them into this window before the editor sees them
    var local = function(bytes) { return Uint8Array.from(bytes); };

    function baseBitmap() {
        if (Array.isArray(baseFont)) return Promise.resolve(baseFont);
        var rom = baseFont === 'builtin' ? null : bridge.fontRom();
        if (rom) return Promise.resolve(window.X1FontBuilder.parseFontRom(local(rom)));
        return bridge.builtinFontBitmap();
    }

    function pickFile(accept, maxBytes, tooLarge) {
        return new Promise(function(resolve, reject) {
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = accept;
            input.addEventListener('change', function() {
                var file = input.files && input.files[0];
                if (!file) { resolve(null); return; }
                if (file.size > maxBytes) { reject(new Error(tooLarge)); return; }
                file.arrayBuffer().then(function(buffer) {
                    resolve({ name: file.name, bytes: new Uint8Array(buffer) });
                }, reject);
            });
            input.addEventListener('cancel', function() { resolve(null); });
            input.click();
        });
    }

    // A file read that finishes after X1Pen replaced the program, or while automation holds the
    // interaction lock, is dropped, whatever its outcome: it must not overwrite the newer program.
    function chooseFile() {
        var loadsAtStart = loads;
        var overtaken = function() { return loads !== loadsAtStart || bridge.isLocked(); };
        return pickFile('.bas,.BAS,.txt,.asc,*/*', MAX_BYTES, '開けるのは 2 MiB までです。').then(function(file) {
            if (overtaken()) return null;
            if (file) fileName = file.name;
            return file;
        }, function(error) {
            if (overtaken()) return null;
            throw error;
        });
    }

    // A font ROM chosen in the editor is used until the page is reloaded; X1Pen's own font
    // registration (FNT0808.X1) is what the editor starts with.
    function chooseFont() {
        return pickFile('.x1,.X1,.rom,.bin,*/*', 2048, 'X1 のフォント（2048 バイト）を選んでください。').then(function(file) {
            if (!file) return null;
            var bitmap = window.X1FontBuilder.parseFontRom(file.bytes);
            fontCandidate = { token: 'font-' + (++fontTokens), bitmap: bitmap };
            return { name: file.name, data: window.X1FontBuilder.buildFont(bitmap), token: fontCandidate.token };
        });
    }

    function download(bytes, name) {
        var url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'application/octet-stream' }));
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function() { URL.revokeObjectURL(url); }, 10000);
    }

    // The Electron app's menu accelerators (main.cjs) for the commands shown in X1Pen; in a
    // browser they would reach the browser
    function shortcut(event) {
        var mod = event.ctrlKey || event.metaKey;
        var key = event.key.toLowerCase();
        if (event.key === 'F3') return event.shiftKey ? 'find-prev' : 'find-next';
        if (!mod || event.altKey) return null;
        if (key === 'p' && event.shiftKey) return 'pcg-setup';
        if (event.shiftKey) return null;
        return { s: 'save', o: 'open', f: 'find', i: 'insert', '+': 'zoom-in', '=': 'zoom-in', ';': 'zoom-in', '-': 'zoom-out' }[key] || null;
    }
    document.addEventListener('keydown', function(event) {
        if (event.isComposing) return;
        // X1Pen's Run shortcut; the parent page does not see keys typed in this iframe
        if (event.ctrlKey && event.key === 'Enter') {
            event.preventDefault();
            bridge.run();
            return;
        }
        if (!command) return;
        var name = shortcut(event);
        if (!name) return;
        event.preventDefault();
        command(name);
    }, true);

    // The editor focuses its textarea on its own: whenever it shows a document (at start and on
    // every load from X1Pen) and at the end of every command, also when that command waited for
    // a file meanwhile. Such focus is not the user's: it must not pause the emulator or take the
    // keyboard away from where the user is in X1Pen. Focus entering this page counts as the user's
    // only after the user pressed or typed something here, or pressed Tab in X1Pen; any other
    // focus goes straight back to the element X1Pen had focused.
    var parentDoc = window.parent.document;
    var userIntent = false;
    var bouncing = false;
    var lastParentFocus = parentDoc.activeElement !== window.frameElement ? parentDoc.activeElement : null;

    ['pointerdown', 'mousedown', 'touchstart', 'keydown'].forEach(function(type) {
        document.addEventListener(type, function() { userIntent = true; }, true);
    });
    parentDoc.addEventListener('keydown', function(event) { if (event.key === 'Tab') userIntent = true; }, true);
    parentDoc.addEventListener('focusin', function(event) {
        if (event.target === window.frameElement) return;
        lastParentFocus = event.target;
        userIntent = false;
    }, true);

    function giveFocusBack() {
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        var before = lastParentFocus;
        if (before && before !== parentDoc.body && before.isConnected && before.focus) {
            before.focus();
        } else if (parentDoc.activeElement === window.frameElement) {
            window.frameElement.blur();
        }
    }

    // Focus is handed back after the focus event: moving it from inside the event leaves Chrome
    // treating this frame as focused while X1Pen's element shows the focus
    window.addEventListener('focus', function() {
        if (userIntent) { bridge.focus(); return; }
        bouncing = true;
        setTimeout(function() {
            try { if (!userIntent) giveFocusBack(); } finally { bouncing = false; }
        }, 0);
    });
    window.addEventListener('blur', function() {
        if (bouncing) return;
        bridge.blur();
        // Focus moved elsewhere in X1Pen (not a file dialog or another window): the next focus
        // here is the user's only after new input
        setTimeout(function() { if (parentDoc.hasFocus() && !document.hasFocus()) userIntent = false; }, 0);
    });

    window.X1Host = {
        onLoaded: function(callback) {
            bridge.attach(function(data) {
                loads++;
                callback({ name: data.name, bytes: local(data.bytes) });
            });
        },
        onCommand: function(callback) { command = callback; },
        contentChanged: function(data) { bridge.contentChanged(data.bytes); },
        open: chooseFile,
        save: function(payload) {
            var name = fileName;
            if (payload.saveAs) {
                name = window.prompt('ファイル名', fileName);
                if (!name) return false;
                fileName = name;
            }
            download(payload.bytes, name);
            return true;
        },
        confirmDirty: function() {
            return window.confirm('今の HuBASIC プログラムを置き換えます。よろしいですか？') ? 'discard' : 'cancel';
        },
        state: function() {},
        newDocument: function() { fileName = 'PROGRAM.BAS'; },
        close: function() {},
        currentFont: function() {
            var rom = bridge.fontRom();
            if (!rom) return null;
            return { name: 'X1Pen に登録したフォント', data: window.X1FontBuilder.buildFontFromRom(local(rom)) };
        },
        chooseFont: chooseFont,
        commitFont: function(token) {
            if (!fontCandidate || fontCandidate.token !== token) return false;
            baseFont = fontCandidate.bitmap;
            fontCandidate = null;
            return true;
        },
        resetFont: function() { baseFont = 'builtin'; return true; },
        pcgFont: function(request) {
            return baseBitmap().then(function(bitmap) {
                return window.X1FontBuilder.buildFont(bitmap, request.entries, request.order, request.layout);
            });
        },
        _baseBitmap: baseBitmap     // for tests
    };
})();

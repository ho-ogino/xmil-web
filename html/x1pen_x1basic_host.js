// x1pen_x1basic_host.js — X1Pen's host adapter for X1 BASIC Editor, published as
// x1basic/src/x1pen-host.js and loaded by the editor page (in an iframe of x1pen.html) before
// host.js. It sets window.X1Host synchronously; the program itself lives in X1Pen
// (window.parent.X1PenHuBasicEditorBridge), so there is no "unsaved" state to protect.
// "保存" exports the bytes as a file; "開く…" reads a file into the editor.

(function() {
    'use strict';

    var bridge = window.parent && window.parent !== window ? window.parent.X1PenHuBasicEditorBridge : null;
    if (!bridge) throw new Error('X1 BASIC Editor here runs only inside X1Pen (x1pen.html)');

    var MAX_BYTES = 2 * 1024 * 1024;
    var fileName = 'PROGRAM.BAS';
    var command = null;

    // Bytes from X1Pen's window: copy them into this window before the editor sees them
    var local = function(bytes) { return Uint8Array.from(bytes); };

    function baseBitmap() {
        var rom = bridge.fontRom();
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

    function chooseFile() {
        return pickFile('.bas,.BAS,.txt,.asc,*/*', MAX_BYTES, '開けるのは 2 MiB までです。').then(function(file) {
            if (file) fileName = file.name;
            return file;
        });
    }

    // A font ROM chosen in the editor is used until the page is reloaded; X1Pen's own font
    // registration (FNT0808.X1) is what the editor starts with.
    function chooseFont() {
        return pickFile('.x1,.X1,.rom,.bin,*/*', 2048, 'X1 のフォント（2048 バイト）を選んでください。').then(function(file) {
            if (!file) return null;
            return { name: file.name, data: window.X1FontBuilder.buildFontFromRom(file.bytes), token: file.name };
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

    // The Electron app's menu accelerators (main.cjs); in a browser they would reach the browser
    function shortcut(event) {
        var mod = event.ctrlKey || event.metaKey;
        var key = event.key.toLowerCase();
        if (event.key === 'F3') return event.shiftKey ? 'find-prev' : 'find-next';
        if (!mod || event.altKey) return null;
        if (key === 's') return event.shiftKey ? 'save-as' : 'save';
        if (key === 'p' && event.shiftKey) return 'pcg-setup';
        if (event.shiftKey) return null;
        return { n: 'new', o: 'open', f: 'find', i: 'insert', '+': 'zoom-in', '=': 'zoom-in', ';': 'zoom-in', '-': 'zoom-out' }[key] || null;
    }
    document.addEventListener('keydown', function(event) {
        if (!command || event.isComposing) return;
        var name = shortcut(event);
        if (!name) return;
        event.preventDefault();
        command(name);
    }, true);

    window.addEventListener('focus', function() { bridge.focus(); });
    window.addEventListener('blur', function() { bridge.blur(); });

    window.X1Host = {
        onLoaded: function(callback) {
            bridge.attach(function(data) { callback({ name: data.name, bytes: local(data.bytes) }); });
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
        commitFont: function() { return true; },
        resetFont: function() { return true; },
        pcgFont: function(request) {
            return baseBitmap().then(function(bitmap) {
                return window.X1FontBuilder.buildFont(bitmap, request.entries, request.order, request.layout);
            });
        }
    };
})();

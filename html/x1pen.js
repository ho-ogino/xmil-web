// X1Pen — FuzzyBASIC IDE application logic
// Requires: x1pen_tokenizer.js, storage.js, xmillennium.js (Emscripten)

// xmillennium.js ロード前にフラグ設定 (CSP 対策: inline script 不可)
window.__X1PEN_MODE = true;

(function() {
    'use strict';

    var module = null;
    var coldStateData = null;

    var elBtnRun    = document.getElementById('btn-run');
    var elBtnStop   = document.getElementById('btn-stop');
    var elStatus    = document.getElementById('x1pen-status');
    var elEditor    = document.getElementById('basic-editor');

    // ── ステート復元 (専用経路 — マウント復元なし) ──

    function restoreColdState() {
        if (!coldStateData || !module) {
            console.error('[x1pen] restoreColdState: missing data or module',
                          !!coldStateData, !!module);
            return false;
        }
        var arr = new Uint8Array(coldStateData);
        console.log('[x1pen] restoreColdState: size=' + arr.length +
                    ' header=' + Array.from(arr.slice(0, 8)).map(
                        function(b){return b.toString(16).padStart(2,'0')}).join(' '));
        var ptr = module._malloc(arr.length);
        new Uint8Array(module.wasmMemory.buffer).set(arr, ptr);
        var rc = module._js_load_state(ptr, arr.length);
        module._free(ptr);
        console.log('[x1pen] js_load_state rc=' + rc);
        if (module._js_get_load_warnings) {
            var warnPtr = module._js_get_load_warnings();
            if (warnPtr) {
                var warn = UTF8ToString(warnPtr);
                if (warn) console.warn('[x1pen] load warnings: ' + warn);
            }
        }
        return (rc >= 0);
    }

    // ── メモリ注入 ──

    function injectProgram(tokenizedBytes) {
        var ramPtr = module._js_get_main_ram();
        var ram = new Uint8Array(module.wasmMemory.buffer, ramPtr, 0x10000);

        var TEXTAREA    = 0x4A26;  // addrmap.json
        var TEXTST_ADDR = 0x39CD;  // 2-byte LE pointer
        var TEXTED_ADDR = 0x39CF;  // 2-byte LE pointer

        // TEXTST 読取 (cold state では TEXTAREA を指す)
        var textStart = ram[TEXTST_ADDR] | (ram[TEXTST_ADDR + 1] << 8);
        if (textStart === 0) textStart = TEXTAREA;

        // トークン化バイト列を書き込み
        for (var i = 0; i < tokenizedBytes.length; i++) {
            ram[textStart + i] = tokenizedBytes[i];
        }

        // TEXTED 更新 (0x0000 ターミネータの先頭を指す)
        var textEnd = textStart + tokenizedBytes.length - 2;
        ram[TEXTED_ADDR]     = textEnd & 0xFF;
        ram[TEXTED_ADDR + 1] = (textEnd >> 8) & 0xFF;
    }

    // ── キー注入 ──

    function simulateRunCommand() {
        var keys = [0x52, 0x55, 0x4E, 0x0D];  // R, U, N, Enter
        keys.forEach(function(vk, i) {
            setTimeout(function() {
                module._js_key_down(vk);
                setTimeout(function() { module._js_key_up(vk); }, 30);
            }, i * 50);
        });
    }

    // ── RUN ──

    async function onRunClick() {
        console.log('[x1pen] onRunClick: module=' + !!module +
                    ' coldStateData=' + !!coldStateData);
        if (!module || !coldStateData) return;

        // 1. コールドステート復元 (マシンを FuzzyBASIC Ok プロンプト状態に)
        if (!restoreColdState()) {
            elStatus.textContent = 'State restore failed';
            return;
        }

        // 2. FDD 等のマウント状態を再適用 (ステート復元でクリアされるため)
        if (window.XmilLibrary && window.XmilLibrary.autoRestoreMounts) {
            await window.XmilLibrary.autoRestoreMounts();
        }

        // 3. BASIC ソースをトークナイズ
        var src = elEditor.value.trim();
        if (!src) {
            elStatus.textContent = 'No program to run';
            return;
        }

        var tokenized;
        try {
            tokenized = window.X1PenTokenizer.tokenizeProgram(src);
        } catch(e) {
            elStatus.textContent = 'Tokenize error: ' + e.message;
            return;
        }

        // 4. エミュレータメモリに注入
        injectProgram(tokenized);

        // 5. エミュレータ開始 + "RUN"+Enter キー注入
        console.log('[x1pen] starting emulator + injecting RUN command');
        module._js_xmil_start();
        simulateRunCommand();

        elStatus.textContent = 'Running';
        elEditor.blur();  // キャンバスにフォーカス移動
    }

    // ── STOP (ESC キー注入) ──

    function onStopClick() {
        if (!module) return;
        // ESC key
        module._js_key_down(0x1B);
        setTimeout(function() { module._js_key_up(0x1B); }, 30);
        elStatus.textContent = 'Stopped';
    }

    // ── Module Ready コールバック ──

    window.__x1pen_onModuleReady = async function() {
        console.log('[x1pen] onModuleReady called');
        module = window.Module;

        // マルチタブ警告 (pre.js の _multiTabPromise を消費)
        if (window.__multiTabPromise) {
            var otherTabExists = await window.__multiTabPromise;
            if (otherTabExists) {
                var ok = confirm(
                    'X1Pen is already running in another tab.\n\n' +
                    'Running in multiple tabs may cause issues.\n\n' +
                    'Continue anyway?'
                );
                if (!ok) {
                    if (window.__tabChannel) {
                        window.__tabChannel.close();
                        window.__tabChannel = null;
                    }
                    elStatus.textContent = 'Close other tabs and reload.';
                    return;
                }
            }
        }

        // 事前焼き込みステートを fetch で取得
        try {
            var resp = await fetch('fuzzybasic_cold.xmst');
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            coldStateData = await resp.arrayBuffer();
            console.log('[x1pen] cold state loaded: ' + coldStateData.byteLength + ' bytes');
        } catch(e) {
            elStatus.textContent = 'Failed to load FuzzyBASIC state: ' + e.message;
            return;
        }

        // 共通初期化: 設定反映 (DOM 不要で localStorage から直接適用) + オーディオアンロック
        if (window.XmilInit) {
            window.XmilInit.applySettingsFromStorage();
            // 最初のユーザー操作で AudioContext をアンロック
            var unlockOnce = function() { window.XmilInit.setupAudioStream(); };
            document.addEventListener('click',      unlockOnce, { once: true });
            document.addEventListener('keydown',    unlockOnce, { once: true });
            document.addEventListener('touchstart', unlockOnce, { once: true, passive: true });
        }

        // ライブラリ UI のイベントリスナー登録
        setupLibraryListeners();

        // ステート復元 + エミュレータ起動 (FuzzyBASIC 画面を表示)
        if (!restoreColdState()) {
            elStatus.textContent = 'State restore failed';
            return;
        }
        module._js_xmil_start();

        elBtnRun.disabled = false;
        elStatus.textContent = 'Ready';
    };

    // ── ライブラリ イベントリスナー登録 ──
    // (pre.js の init() は X1Pen モードで呼ばれないため、ここで登録)

    function setupLibraryListeners() {
        // 閉じるボタン
        var closeBtn = document.getElementById('lib-close-btn');
        if (closeBtn) closeBtn.addEventListener('click', function() {
            if (window.closeLibraryPanel) window.closeLibraryPanel();
        });

        // 追加ボタン
        var addBtn = document.getElementById('lib-add-btn');
        if (addBtn) addBtn.addEventListener('click', function() {
            var el = document.getElementById('file-add-to-library');
            if (el) el.click();
        });

        // ファイル追加 input
        var fileInput = document.getElementById('file-add-to-library');
        if (fileInput) fileInput.addEventListener('change', async function(e) {
            if (!window.XmilLibrary || !window.XmilLibrary.addToLibrary) return;
            var files = e.target.files;
            for (var i = 0; i < files.length; i++) {
                await window.XmilLibrary.addToLibrary(files[i]);
            }
            e.target.value = '';
        });

        // フィルタボタン
        var filterBtns = document.querySelectorAll('.lib-filter');
        filterBtns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                filterBtns.forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                if (window.XmilLibrary) window.XmilLibrary.renderLibraryList();
            });
        });

        // リスト内クリック委譲
        var libListEl = document.getElementById('library-list');
        if (libListEl) {
            libListEl.addEventListener('click', function(e) {
                var btn = e.target.closest('[data-action]');
                if (!btn) return;
                var lib = window.XmilLibrary;
                if (!lib) return;
                var action = btn.dataset.action;
                var key    = btn.dataset.key;
                var slot   = btn.dataset.slot;
                var name   = btn.dataset.name;
                if (action === 'mount'    && lib.mountFromLibrary)    lib.mountFromLibrary(key, slot);
                if (action === 'download' && lib.downloadFromLibrary) lib.downloadFromLibrary(key, name);
                if (action === 'delete'   && lib.deleteFromLibrary)   lib.deleteFromLibrary(key);
                if (action === 'toggle-fav' && lib.toggleFavorite)    lib.toggleFavorite(key);
            });
        }

        // 検索
        var searchInput = document.getElementById('lib-search-input');
        if (searchInput) searchInput.addEventListener('input', function() {
            if (window.XmilLibrary) {
                window.XmilLibrary.setSearch(searchInput.value);
                window.XmilLibrary.renderLibraryList();
            }
        });

        // ソート
        var sortSelect = document.getElementById('lib-sort-select');
        if (sortSelect) sortSelect.addEventListener('change', function() {
            if (window.XmilLibrary) {
                window.XmilLibrary.setSort(sortSelect.value);
                window.XmilLibrary.renderLibraryList();
            }
        });

        // お気に入りフィルタ
        var favFilter = document.getElementById('lib-fav-filter');
        if (favFilter) favFilter.addEventListener('click', function() {
            if (window.XmilLibrary) {
                var newVal = !window.XmilLibrary.getFavoritesOnly();
                window.XmilLibrary.setFavoritesOnly(newVal);
                favFilter.classList.toggle('active', newVal);
                favFilter.textContent = newVal ? '\u2605' : '\u2606';
                window.XmilLibrary.renderLibraryList();
            }
        });
    }

    // ── イベントリスナー ──

    elBtnRun.addEventListener('click', onRunClick);
    elBtnStop.addEventListener('click', onStopClick);

    // FDD ボタン
    document.getElementById('btn-fdd0').addEventListener('click', function() {
        if (window.openFddLibrary) window.openFddLibrary(0);
    });
    document.getElementById('btn-fdd1').addEventListener('click', function() {
        if (window.openFddLibrary) window.openFddLibrary(1);
    });

    // Ctrl+Enter で RUN
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.key === 'Enter' && !elBtnRun.disabled) {
            e.preventDefault();
            onRunClick();
        }
    });

    // エディタ内の Tab キーでスペース挿入
    elEditor.addEventListener('keydown', function(e) {
        if (e.key === 'Tab') {
            e.preventDefault();
            var start = this.selectionStart;
            var end = this.selectionEnd;
            this.value = this.value.substring(0, start) + '  ' + this.value.substring(end);
            this.selectionStart = this.selectionEnd = start + 2;
        }
    });
})();

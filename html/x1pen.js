// X1Pen — FuzzyBASIC IDE application logic
// Requires: x1pen_tokenizer.js, storage.js, xmillennium.js (Emscripten)

// xmillennium.js ロード前にフラグ設定 (CSP 対策: inline script 不可)
window.__X1PEN_MODE = true;

(function() {
    'use strict';

    var COLD_STATE_FILE = 'fuzzybasic_cold.v1.xmst';
    var BOOT_DISK_FILE  = 'fuzzybasic_boot.v1.d88';
    var module = null;

    // ── Runtime asset cache + selection ──
    var assetCache = {};  // filename → ArrayBuffer

    async function loadRuntimeAsset(filename, forceReload) {
        if (!filename) return null;
        if (!forceReload && assetCache[filename]) return assetCache[filename];
        try {
            var url = forceReload ? filename + '?dev-bust=' + Date.now() : filename;
            var opts = forceReload ? { cache: 'reload' } : undefined;
            var resp = await fetch(url, opts);
            if (!resp.ok) return null;
            var data = await resp.arrayBuffer();
            assetCache[filename] = data;
            return data;
        } catch(e) { return null; }
    }

    // model → asset resolution (currently all models use same assets)
    function resolveRuntimeAssets(model) {
        return { coldState: COLD_STATE_FILE, bootDisk: BOOT_DISK_FILE };
    }

    function validateModel(value, fallback) {
        var n = parseInt(value, 10);
        return (n >= 1 && n <= 3) ? n : fallback;
    }

    var COLD_STATE_PATTERN = /^fuzzybasic_cold\.[A-Za-z0-9._-]+\.xmst$/;
    var BOOT_DISK_PATTERN  = /^fuzzybasic_boot\.[A-Za-z0-9._-]+\.d88$/;
    function validateAssetName(name, fallback) {
        if (!name || typeof name !== 'string') return fallback;
        var pattern = name.endsWith('.xmst') ? COLD_STATE_PATTERN : BOOT_DISK_PATTERN;
        return pattern.test(name) ? name : fallback;
    }

    function getUserDefaultRuntime() {
        var settings = window.XmilControls ? window.XmilControls.getSettings() : {};
        var model = validateModel(settings.romType, 1);
        var assets = resolveRuntimeAssets(model);
        return { model: model, coldState: assets.coldState, bootDisk: assets.bootDisk };
    }

    var pendingShareRuntime = null;
    var lastUsedRuntime = null;
    var lastRunWasShared = false;

    function setModelAndClearShareState(model) {
        if (window.XmilControls) window.XmilControls.setRomType(model);
        lastRunWasShared = false;
    }

    var LS_EDITOR_BASIC = 'x1pen_editor';
    var LS_EDITOR_ASM   = 'x1pen_editor_asm';

    var elBtnRun    = document.getElementById('btn-run');
    var elBtnStop   = document.getElementById('btn-stop');
    var elBtnDevReload = document.getElementById('btn-dev-reload');
    var elStatus    = document.getElementById('x1pen-status');
    var activeTab   = 'basic';

    function isDevAssetMode() {
        var host = location.hostname;
        return host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
               new URLSearchParams(location.search).get('dev') === '1';
    }

    async function reloadAssetsBypassCache() {
        assetCache = {};
        if (elBtnDevReload) elBtnDevReload.disabled = true;
        elStatus.textContent = 'Reloading assets...';
        try {
            await loadRuntimeAsset(COLD_STATE_FILE, true);
            await loadRuntimeAsset(BOOT_DISK_FILE, true);
            elStatus.textContent = 'Assets reloaded';
        } catch (e) {
            elStatus.textContent = 'Asset reload failed: ' + e.message;
        } finally {
            if (elBtnDevReload) elBtnDevReload.disabled = false;
        }
    }

    // CodeMirror editors
    var pauseCallbacks = {
        onFocus: function() { if (module && module._js_xmil_stop) module._js_xmil_stop(); },
        onBlur:  function() { if (module && module._js_xmil_start) module._js_xmil_start(); }
    };

    var basicEditor = window.X1PenEditor.create(
        document.getElementById('basic-editor-container'),
        { language: 'basic',
          showLineNumbers: false,
          placeholder: '10 PRINT "HELLO WORLD"\n20 GOTO 10',
          onChange: function(text) { try { localStorage.setItem(LS_EDITOR_BASIC, text); } catch(e) {} },
          onFocus: pauseCallbacks.onFocus,
          onBlur:  pauseCallbacks.onBlur }
    );

    var asmEditor = window.X1PenEditor.create(
        document.getElementById('asm-editor-container'),
        { language: 'asm',
          showLineNumbers: true,
          placeholder: '; Z80 Assembly\nORG 0E000h\n    LD A,042h\n    RET',
          onChange: function(text) { try { localStorage.setItem(LS_EDITOR_ASM, text); } catch(e) {} },
          onFocus: pauseCallbacks.onFocus,
          onBlur:  pauseCallbacks.onBlur }
    );

    // localStorage から復元 (silent: onChange を発火させない)
    try {
        var savedBasic = localStorage.getItem(LS_EDITOR_BASIC);
        if (savedBasic) basicEditor.setValue(savedBasic, { silent: true });
        var savedAsm = localStorage.getItem(LS_EDITOR_ASM);
        if (savedAsm) asmEditor.setValue(savedAsm, { silent: true });
    } catch(e) {}

    // ── ステート復元 (専用経路 — マウント復元なし) ──

    function restoreColdState(stateData) {
        if (!stateData || !module) {
            console.error('[x1pen] restoreColdState: missing data or module',
                          !!stateData, !!module);
            return false;
        }
        var arr = new Uint8Array(stateData);
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

        var TEXTAREA    = 0x4A37;  // addrmap.json
        var TEXTST_ADDR = 0x39DE;  // 2-byte LE pointer
        var TEXTED_ADDR = 0x39E0;  // 2-byte LE pointer

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
        if (!module) return false;

        // 1. effective runtime を決定
        var isSharedRun = !!pendingShareRuntime;
        var runtime = pendingShareRuntime || getUserDefaultRuntime();
        pendingShareRuntime = null;

        // 2. MODEL を適用
        if (module._js_set_rom_type) module._js_set_rom_type(runtime.model);

        // 3. runtime asset をロード (キャッシュヒットすれば高速)
        var actualColdState = runtime.coldState;
        var actualBootDisk = runtime.bootDisk;

        var stateData = await loadRuntimeAsset(runtime.coldState);
        if (!stateData && runtime.coldState !== COLD_STATE_FILE) {
            console.warn('[x1pen] Fallback to current cold state');
            stateData = await loadRuntimeAsset(COLD_STATE_FILE);
            if (stateData) actualColdState = COLD_STATE_FILE;
        }
        var bootData = await loadRuntimeAsset(runtime.bootDisk);
        if (!bootData && runtime.bootDisk !== BOOT_DISK_FILE) {
            console.warn('[x1pen] Fallback to current boot disk');
            bootData = await loadRuntimeAsset(BOOT_DISK_FILE);
            if (bootData) actualBootDisk = BOOT_DISK_FILE;
        }

        if (!stateData) {
            elStatus.textContent = 'Failed to load cold state';
            return false;
        }

        // lastUsedRuntime を記録 (再 Share 用、state restore 後に model 更新)
        lastUsedRuntime = { model: runtime.model, coldState: actualColdState, bootDisk: actualBootDisk };
        lastRunWasShared = isSharedRun;

        var asmSrc = asmEditor ? asmEditor.getValue().trim() : '';
        var hasProgramDisk = false;

        // 4. ASM アセンブル (タブに内容がある場合)
        var asmResult = null;
        if (asmSrc) {
            asmResult = window.X1PenZ80Asm.assemble(asmSrc);
            if (asmResult.errors.length > 0) {
                elStatus.textContent = 'ASM error (L' + asmResult.errors[0].line + '): ' +
                                       asmResult.errors[0].msg;
                return false;
            }
        }

        // 5. BASIC ソースをトークナイズ
        var src = basicEditor.getValue().trim();
        var tokenized = null;
        if (src) {
            try {
                tokenized = window.X1PenTokenizer.tokenizeProgram(src);
            } catch(e) {
                elStatus.textContent = 'Tokenize error: ' + e.message;
                return false;
            }
        }

        // 6. コールドステート復元 (runtime 指定のステートを使用)
        if (!restoreColdState(stateData)) {
            elStatus.textContent = 'State restore failed';
            return false;
        }

        // state restore で x1flg.ROM_TYPE が確定 → lastUsedRuntime を更新
        if (module._js_get_rom_type) {
            lastUsedRuntime.model = module._js_get_rom_type();
        }

        // 7. ASM バイナリをディスクに配置して FDD0 にマウント (BASIC も同梱)
        if (asmResult && asmResult.bytes.length > 0) {
            if (!(await mountProgramDisk(asmResult.bytes, tokenized, bootData))) {
                elStatus.textContent = 'Disk write failed';
                return false;
            }
            hasProgramDisk = true;
        }

        // 8. FDD 等のマウント状態を再適用 (PROGRAM ディスク使用時は drive0 を除外)
        if (window.XmilLibrary && window.XmilLibrary.autoRestoreMounts) {
            await window.XmilLibrary.autoRestoreMounts(hasProgramDisk ? ['drive0'] : []);
        }

        // 9. エミュレータメモリに BASIC 注入
        if (!tokenized) {
            elStatus.textContent = 'No program to run';
            return false;
        }
        injectProgram(tokenized);

        // 7. エミュレータ開始 + "RUN"+Enter キー注入
        console.log('[x1pen] starting emulator + injecting RUN command');
        module._js_xmil_start();
        simulateRunCommand();

        elStatus.textContent = 'Running';
        // キャンバスにフォーカス移動 (エミュ再開のため blur が必要)
        var canvas = document.getElementById('canvas');
        if (canvas) canvas.focus();
        return true;
    }

    // ── PROGRAM ディスク マウント ──

    async function mountProgramDisk(programBytes, basicTokenized, diskData) {
        if (!diskData) {
            console.error('[x1pen] Boot disk not loaded');
            return false;
        }

        // 1. ベースディスクを ArrayBuffer としてコピー
        var diskCopy = diskData.slice(0);

        // 2. D88 コンテナとして開く
        var container = window.XmilDiskContainer.openContainer(diskCopy, 'boot.d88', 'fdd');
        if (!container) return false;

        // 3. LSX-Dodgers FS で PROGRAM.BIN を書き込み
        try {
            var fs = new window.XmilDiskFS.LsxDodgersFS(container);
            fs.addFile('PROGRAM', 'BIN', new Uint8Array(programBytes));
            if (basicTokenized) {
                fs.addFile('AUTORUN', 'BAS', basicTokenized);
            }
        } catch(e) {
            console.error('[x1pen] Disk write failed:', e);
            return false;
        }

        // 4. D88 バイナリを取得
        var d88Data = container.toArrayBuffer();

        // 5. FDD0 マウント (slotState 同期)
        if (window.XmilControls) await window.XmilControls.mountTempDisk(d88Data, 'drive0');
        return true;
    }

    // ── STOP (ESC キー注入) ──

    function onStopClick() {
        if (!module) return;
        // ESC key
        module._js_key_down(0x1B);
        setTimeout(function() { module._js_key_up(0x1B); }, 30);
        elStatus.textContent = 'Stopped';
    }

    // ── Audio unmute overlay (for autoplay policy) ──

    function showAudioUnmuteIfNeeded() {
        var ctx = window.audioContext;
        if (ctx && ctx.state === 'running') return;
        var overlay = document.getElementById('audio-unmute-overlay');
        var canvas = document.getElementById('canvas');
        if (!overlay) return;
        overlay.classList.remove('hidden');
        function unlock() {
            if (window.XmilInit) window.XmilInit.setupAudioStream();
            // AudioContext が実際に running になったらバーを消す
            var ctx = window.audioContext;
            if (ctx && ctx.state === 'running') {
                overlay.classList.add('hidden');
                overlay.removeEventListener('click', unlock);
                if (canvas) canvas.removeEventListener('click', unlock);
            } else if (ctx && ctx.state === 'suspended') {
                // resume は非同期なので state change を待つ
                ctx.resume().then(function() {
                    overlay.classList.add('hidden');
                    overlay.removeEventListener('click', unlock);
                    if (canvas) canvas.removeEventListener('click', unlock);
                }).catch(function() {});
            } else {
                // fallback: とにかく消す
                overlay.classList.add('hidden');
                overlay.removeEventListener('click', unlock);
                if (canvas) canvas.removeEventListener('click', unlock);
            }
        }
        overlay.addEventListener('click', unlock);
        if (canvas) canvas.addEventListener('click', unlock);
    }

    // ── Share ──

    async function onShareClick() {
        var src = basicEditor.getValue().trim();
        if (!src) { elStatus.textContent = 'Nothing to share'; return; }

        var asmSrc = asmEditor ? asmEditor.getValue().trim() : '';

        // Share 用 runtime を決定
        var shareRuntime;
        if (pendingShareRuntime) {
            shareRuntime = pendingShareRuntime;
        } else if (lastRunWasShared && lastUsedRuntime) {
            shareRuntime = lastUsedRuntime;
        } else {
            shareRuntime = getUserDefaultRuntime();
        }

        var payload = JSON.stringify({
            basic: src,
            asm: asmSrc || null,
            meta: {
                model: shareRuntime.model,
                coldState: shareRuntime.coldState,
                bootDisk: shareRuntime.bootDisk
            }
        });
        var rawBytes = new TextEncoder().encode(payload);

        // サイズ警告 (目安)
        if (rawBytes.length > 400 * 1024) {
            elStatus.textContent = 'Code is large, share may fail';
        }

        elStatus.textContent = 'Sharing...';
        try {
            // gzip 圧縮
            var cs = new CompressionStream('gzip');
            var writer = cs.writable.getWriter();
            writer.write(rawBytes);
            writer.close();
            var compressed = await new Response(cs.readable).arrayBuffer();

            var resp = await fetch('/api/share', {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: compressed
            });
            if (!resp.ok) {
                var errBody = await resp.json().catch(function() { return {}; });
                throw new Error(errBody.error || 'HTTP ' + resp.status);
            }
            var result = await resp.json();
            var url = location.origin + '/x1pen?id=' + result.id;
            await navigator.clipboard.writeText(url);
            elStatus.textContent = 'URL copied!';
        } catch(e) {
            elStatus.textContent = 'Share failed: ' + e.message;
        }
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

        // runtime asset をプリロード (assetCache に格納)
        var coldState = await loadRuntimeAsset(COLD_STATE_FILE);
        if (!coldState) {
            elStatus.textContent = 'Failed to load FuzzyBASIC state';
            return;
        }
        await loadRuntimeAsset(BOOT_DISK_FILE); // 失敗しても起動は継続

        // 共通初期化: 設定反映 (DOM 不要で localStorage から直接適用) + オーディオアンロック
        if (window.XmilInit) {
            window.XmilInit.applySettingsFromStorage();
            // 最初のユーザー操作で AudioContext をアンロック
            var unlockOnce = function() { window.XmilInit.setupAudioStream(); };
            document.addEventListener('click',      unlockOnce, { once: true });
            document.addEventListener('keydown',    unlockOnce, { once: true });
            document.addEventListener('touchstart', unlockOnce, { once: true, passive: true });
        }

        // ライブラリ UI + コントロールバー のイベントリスナー登録
        setupLibraryListeners();
        setupControlBarListeners();

        // 初期化シーケンス:
        // 1. ROM を VFS に配置 (reset なし)
        if (window.XmilControls) window.XmilControls.loadRomToVfs();
        // 2. フォントを VFS に配置 (reload なし)
        if (window.XmilControls) window.XmilControls.loadFontsToVfs();
        // 3. コールドステート復元
        if (!restoreColdState(assetCache[COLD_STATE_FILE])) {
            elStatus.textContent = 'State restore failed';
            return;
        }
        // 4. フォントを現セッションに反映
        if (module._js_reload_fonts) module._js_reload_fonts();
        // 5. マウント状態復元
        if (window.XmilLibrary && window.XmilLibrary.autoRestoreMounts) {
            await window.XmilLibrary.autoRestoreMounts();
        }
        // 6. エミュレータ開始
        module._js_xmil_start();

        elBtnRun.disabled = false;
        elStatus.textContent = 'Ready';

        // 共有コード読み込み (?id=xxx)
        var urlId = new URLSearchParams(location.search).get('id');
        if (urlId) {
            elStatus.textContent = 'Loading shared code...';
            // 読み込み中は Share ボタンを無効化 (race 防止)
            var elBtnShare = document.getElementById('btn-share');
            if (elBtnShare) elBtnShare.disabled = true;
            try {
                var shareResp = await fetch('/api/share/' + encodeURIComponent(urlId));
                if (shareResp.ok) {
                    var shared;
                    var codec = shareResp.headers.get('X-X1pen-Codec');
                    if (codec === 'gzip') {
                        var ds = new DecompressionStream('gzip');
                        var decompText = await new Response(shareResp.body.pipeThrough(ds)).text();
                        shared = JSON.parse(decompText);
                    } else {
                        shared = await shareResp.json();
                    }
                    basicEditor.setValue(shared.basic, { silent: true });
                    if (asmEditor) {
                        asmEditor.setValue(shared.asm || '', { silent: true });
                    }
                    // Share meta → pendingShareRuntime
                    if (shared.meta) {
                        pendingShareRuntime = {
                            model: validateModel(shared.meta.model, 1),
                            coldState: validateAssetName(shared.meta.coldState, COLD_STATE_FILE),
                            bootDisk: validateAssetName(shared.meta.bootDisk, BOOT_DISK_FILE)
                        };
                    }
                    var runOk = await onRunClick();
                    // 実行成功時のみ: AudioContext がまだ suspended ならオーバーレイ表示
                    if (runOk) showAudioUnmuteIfNeeded();
                } else if (shareResp.status === 400) {
                    elStatus.textContent = 'Invalid share ID';
                } else if (shareResp.status === 404) {
                    elStatus.textContent = 'Shared code not found';
                } else {
                    elStatus.textContent = 'Failed to load shared code';
                }
            } catch(e) {
                console.warn('[x1pen] Failed to load shared code:', e);
                elStatus.textContent = 'Shared code load failed';
            } finally {
                if (elBtnShare) elBtnShare.disabled = false;
            }
        }
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
                if (action === 'edit' && window.XmilDiskEditor)       window.XmilDiskEditor.openEditor(key);
                // EMM スロット操作
                var ctrl = window.XmilControls;
                if (ctrl) {
                    if (action === 'emm-create') ctrl.onEmmSlotCreate(parseInt(btn.dataset.slot, 10));
                    if (action === 'emm-export') ctrl.onEmmSlotExport(parseInt(btn.dataset.slot, 10));
                    if (action === 'emm-import') ctrl.onEmmSlotImport(parseInt(btn.dataset.slot, 10));
                    if (action === 'emm-delete') ctrl.onEmmSlotDelete(parseInt(btn.dataset.slot, 10));
                    if (action === 'emm-insert') ctrl.onEmmSlotInsert(parseInt(btn.dataset.slot, 10));
                    if (action === 'emm-eject')  ctrl.onEmmSlotEject(parseInt(btn.dataset.slot, 10));
                    if (action === 'emm-edit') {
                        var slotNum = parseInt(btn.dataset.slot, 10);
                        var emmFileName = 'EMM' + slotNum + '.MEM';
                        var emmLib = window.XmilCore ? window.XmilCore.getLibrary() : [];
                        var emmEntry = emmLib.find(function(ent) { return ent.type === 'emm' && ent.name === emmFileName; });
                        if (emmEntry && window.XmilDiskEditor) window.XmilDiskEditor.openEditor(emmEntry.key);
                    }
                }
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

        // EMM ダイアログ: 閉じる/確認ボタン + サイズラジオ初期化 + import input 生成
        var ctrl = window.XmilControls;
        if (ctrl) {
            var emmCloseBtn = document.getElementById('emm-create-close');
            if (emmCloseBtn) emmCloseBtn.addEventListener('click', function() { ctrl.closeEmmCreateDialog(); });
            var emmConfirmBtn = document.getElementById('emm-create-confirm');
            if (emmConfirmBtn) emmConfirmBtn.addEventListener('click', function() { ctrl.onEmmCreateConfirm(); });
            ctrl.initEmmSizeRadios();
            ctrl.createEmmImportInput();
        }
    }

    // ── ドロップダウンメニュー開閉 ──

    var currentOpenMenu = null;
    var currentOpenBtn = null;

    function closeAllMenus() {
        if (currentOpenMenu) { currentOpenMenu.classList.remove('open'); currentOpenMenu = null; }
        if (currentOpenBtn)  { currentOpenBtn.classList.remove('active'); currentOpenBtn = null; }
    }

    var emuControls = document.getElementById('emu-controls');
    if (emuControls) {
        emuControls.addEventListener('click', function(e) {
            var btn = e.target.closest('.emu-ctrl-btn[data-menu]');
            if (!btn) return;
            var menuId = 'menu-' + btn.dataset.menu;
            var menu = document.getElementById(menuId);
            if (!menu) return;
            if (currentOpenMenu === menu) {
                closeAllMenus();
            } else {
                closeAllMenus();
                updateMenuState(btn.dataset.menu);
                menu.classList.add('open');
                btn.classList.add('active');
                currentOpenMenu = menu;
                currentOpenBtn = btn;
            }
            e.stopPropagation();
        });
    }

    document.addEventListener('click', function(e) {
        if (currentOpenMenu && !e.target.closest('.emu-ctrl-menu') && !e.target.closest('.emu-ctrl-btn')) {
            closeAllMenus();
        }
    });

    // ── メニュー状態同期 ──

    function getSlotFileName(slotState, slotName) {
        if (!slotState || !slotState[slotName]) return null;
        if (slotState[slotName] === '__x1pen_temp__') return '(PROGRAM)';
        var lib = window.XmilCore ? window.XmilCore.getLibrary() : [];
        var entry = lib.find(function(e) { return e.key === slotState[slotName]; });
        return entry ? entry.name : '(mounted)';
    }

    function setFileName(elId, name) {
        var el = document.getElementById(elId);
        if (!el) return;
        if (name) { el.textContent = name; el.classList.remove('empty'); }
        else { el.textContent = 'empty'; el.classList.add('empty'); }
    }

    function updateMenuState(menuName) {
        var ctrl = window.XmilControls;
        var core = window.XmilCore;
        if (!ctrl) return;

        if (menuName === 'fdd' || menuName === 'hdd' || menuName === 'cmt') {
            var ss = core ? core.getSlotState() : {};
            if (menuName === 'fdd') {
                setFileName('ec-fdd0-name', getSlotFileName(ss, 'drive0'));
                setFileName('ec-fdd1-name', getSlotFileName(ss, 'drive1'));
                // Show Save button only for temp PROGRAM disk
                var saveBtn = document.getElementById('ec-fdd0-save');
                if (saveBtn) saveBtn.classList.toggle('hidden', ss['drive0'] !== '__x1pen_temp__');
            } else if (menuName === 'hdd') {
                setFileName('ec-hdd0-name', getSlotFileName(ss, 'hdd0'));
                setFileName('ec-hdd1-name', getSlotFileName(ss, 'hdd1'));
            } else if (menuName === 'cmt') {
                setFileName('ec-cmt-name', getSlotFileName(ss, 'cmt'));
            }
        }

        if (menuName === 'machine') {
            var s = ctrl.getSettings();
            var elStd  = document.getElementById('ec-res-std');
            var elHigh = document.getElementById('ec-res-high');
            if (elStd && elHigh) {
                elStd.classList.toggle('active', !s.dipHighres);
                elHigh.classList.toggle('active', !!s.dipHighres);
            }
            var el2d  = document.getElementById('ec-disk-2d');
            var el2hd = document.getElementById('ec-disk-2hd');
            if (el2d && el2hd) {
                el2d.classList.toggle('active', !s.dip2hd);
                el2hd.classList.toggle('active', !!s.dip2hd);
            }
        }

        if (menuName === 'model') {
            var s = ctrl.getSettings();
            var romType = s.romType !== undefined ? s.romType : 1;
            document.querySelectorAll('input[name="ec-model"]').forEach(function(r) {
                r.checked = (parseInt(r.value, 10) === romType);
            });
        }

        if (menuName === 'opt') {
            var s = ctrl.getSettings();
            var elScan = document.getElementById('ec-scanline');
            if (elScan) elScan.checked = !!s.skipLine;
            var elFm = document.getElementById('ec-fm');
            if (elFm) elFm.checked = s.fmEnable !== undefined ? !!s.fmEnable : true;
            var elMotor = document.getElementById('ec-motor');
            if (elMotor) elMotor.checked = s.motorSound !== undefined ? !!s.motorSound : true;
            var elVol = document.getElementById('ec-volume');
            var elVolVal = document.getElementById('ec-volume-val');
            if (elVol) { elVol.value = s.seekVolume !== undefined ? s.seekVolume : 80; }
            if (elVolVal) elVolVal.textContent = elVol ? elVol.value : '80';
            var elJoy = document.getElementById('ec-joystick');
            if (elJoy) elJoy.checked = s.joystickEnable !== undefined ? !!s.joystickEnable : true;
            var elMouse = document.getElementById('ec-mouse');
            if (elMouse) elMouse.checked = !!s.mouseEnable;
            var keyMode = s.keyMode !== undefined ? s.keyMode : 0;
            document.querySelectorAll('input[name="ec-keymode"]').forEach(function(r) {
                r.checked = (parseInt(r.value, 10) === keyMode);
            });
            // ROM/Font status
            var rs = ctrl.getRomStatus();
            setFileName('ec-rom-x1-name', rs.x1);
            setFileName('ec-rom-x1t-name', rs.x1t);
            setFileName('ec-fnt-ank8-name', rs.ank8);
            setFileName('ec-fnt-ank16-name', rs.ank16);
            setFileName('ec-fnt-knj-name', rs.knj);
        }
    }

    // ── コントロールバー イベントハンドラ ──

    function setupControlBarListeners() {
        var ctrl = window.XmilControls;
        var core = window.XmilCore;
        if (!ctrl) return;

        // RESET
        var iplBtn = document.getElementById('ec-ipl-reset');
        var nmiBtn = document.getElementById('ec-nmi-reset');
        if (iplBtn) iplBtn.addEventListener('click', function() { ctrl.iplReset(); closeAllMenus(); });
        if (nmiBtn) nmiBtn.addEventListener('click', function() { ctrl.nmiReset(); closeAllMenus(); });

        // FDD
        var fdd0Mount = document.getElementById('ec-fdd0-mount');
        var fdd0Eject = document.getElementById('ec-fdd0-eject');
        var fdd1Mount = document.getElementById('ec-fdd1-mount');
        var fdd1Eject = document.getElementById('ec-fdd1-eject');
        if (fdd0Mount) fdd0Mount.addEventListener('click', function() { closeAllMenus(); if (window.openFddLibrary) window.openFddLibrary(0); });
        if (fdd0Eject) fdd0Eject.addEventListener('click', function() { if (core) core.ejectSlot('drive0'); updateMenuState('fdd'); });
        var fdd0Save = document.getElementById('ec-fdd0-save');
        if (fdd0Save) fdd0Save.addEventListener('click', function() {
            if (!module || !module.FS) return;
            try {
                var data = module.FS.readFile('/fdd0.d88');
                var blob = new Blob([data], { type: 'application/octet-stream' });
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url; a.download = 'PROGRAM.d88';
                document.body.appendChild(a); a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch(e) { console.error('[x1pen] FDD0 save failed:', e); }
        });
        if (fdd1Mount) fdd1Mount.addEventListener('click', function() { closeAllMenus(); if (window.openFddLibrary) window.openFddLibrary(1); });
        if (fdd1Eject) fdd1Eject.addEventListener('click', function() { if (core) core.ejectSlot('drive1'); updateMenuState('fdd'); });

        // HDD
        var hdd0Mount = document.getElementById('ec-hdd0-mount');
        var hdd0Eject = document.getElementById('ec-hdd0-eject');
        var hdd1Mount = document.getElementById('ec-hdd1-mount');
        var hdd1Eject = document.getElementById('ec-hdd1-eject');
        if (hdd0Mount) hdd0Mount.addEventListener('click', function() { closeAllMenus(); if (window.openHddLibrary) window.openHddLibrary(0); });
        if (hdd0Eject) hdd0Eject.addEventListener('click', function() { if (core) core.ejectSlot('hdd0'); updateMenuState('hdd'); });
        if (hdd1Mount) hdd1Mount.addEventListener('click', function() { closeAllMenus(); if (window.openHddLibrary) window.openHddLibrary(1); });
        if (hdd1Eject) hdd1Eject.addEventListener('click', function() { if (core) core.ejectSlot('hdd1'); updateMenuState('hdd'); });

        // CMT
        var cmtInsert = document.getElementById('ec-cmt-insert');
        var cmtEject  = document.getElementById('ec-cmt-eject');
        var cmtPlay   = document.getElementById('ec-cmt-play');
        var cmtStop   = document.getElementById('ec-cmt-stop');
        var cmtFf     = document.getElementById('ec-cmt-ff');
        var cmtRew    = document.getElementById('ec-cmt-rew');
        if (cmtInsert) cmtInsert.addEventListener('click', function() { closeAllMenus(); if (window.openCmtLibrary) window.openCmtLibrary(); });
        if (cmtEject)  cmtEject.addEventListener('click', function() { if (core) core.ejectSlot('cmt'); updateMenuState('cmt'); });
        if (cmtPlay)   cmtPlay.addEventListener('click', function() { ctrl.cmtPlay(); });
        if (cmtStop)   cmtStop.addEventListener('click', function() { ctrl.cmtStop(); });
        if (cmtFf)     cmtFf.addEventListener('click', function() { ctrl.cmtFf(); });
        if (cmtRew)    cmtRew.addEventListener('click', function() { ctrl.cmtRew(); });

        // EMM
        var emmOpen = document.getElementById('ec-emm-open');
        if (emmOpen) emmOpen.addEventListener('click', function() { if (window.openLibraryPanel) window.openLibraryPanel('emm'); });

        // MODEL
        document.querySelectorAll('input[name="ec-model"]').forEach(function(r) {
            r.addEventListener('change', function() { setModelAndClearShareState(parseInt(this.value, 10)); });
        });

        // DISP - Resolution toggle
        var resStd  = document.getElementById('ec-res-std');
        var resHigh = document.getElementById('ec-res-high');
        if (resStd)  resStd.addEventListener('click', function() { ctrl.setDipHighres(false); updateMenuState('machine'); });
        if (resHigh) resHigh.addEventListener('click', function() { ctrl.setDipHighres(true); updateMenuState('machine'); });
        // DISP - Start Disk toggle
        var disk2d  = document.getElementById('ec-disk-2d');
        var disk2hd = document.getElementById('ec-disk-2hd');
        if (disk2d)  disk2d.addEventListener('click', function() { ctrl.setDip2hd(false); updateMenuState('machine'); });
        if (disk2hd) disk2hd.addEventListener('click', function() { ctrl.setDip2hd(true); updateMenuState('machine'); });
        // DISP - Scanline
        var scanline = document.getElementById('ec-scanline');
        if (scanline) scanline.addEventListener('change', function() { ctrl.setSkipLine(this.checked); });

        // OPT
        var ecFm = document.getElementById('ec-fm');
        if (ecFm) ecFm.addEventListener('change', function() { ctrl.setFmSound(this.checked); });
        var ecMotor = document.getElementById('ec-motor');
        if (ecMotor) ecMotor.addEventListener('change', function() { ctrl.setMotorSound(this.checked); });
        var ecVol = document.getElementById('ec-volume');
        var ecVolVal = document.getElementById('ec-volume-val');
        if (ecVol) ecVol.addEventListener('input', function() {
            if (ecVolVal) ecVolVal.textContent = this.value;
            ctrl.setMotorVolume(parseInt(this.value, 10));
        });
        var ecJoy = document.getElementById('ec-joystick');
        if (ecJoy) ecJoy.addEventListener('change', function() { ctrl.setJoystick(this.checked); });
        var ecMouse = document.getElementById('ec-mouse');
        if (ecMouse) ecMouse.addEventListener('change', function() { ctrl.setMouse(this.checked); });
        document.querySelectorAll('input[name="ec-keymode"]').forEach(function(r) {
            r.addEventListener('change', function() { ctrl.setKeyMode(parseInt(this.value, 10)); });
        });

        // ROM/Font file inputs
        var romFontMap = [
            { loadBtn: 'ec-rom-x1-load',   clearBtn: 'ec-rom-x1-clear',   fileInput: 'ec-file-rom-x1',    type: 'x1',    isRom: true },
            { loadBtn: 'ec-rom-x1t-load',  clearBtn: 'ec-rom-x1t-clear',  fileInput: 'ec-file-rom-x1t',   type: 'x1t',   isRom: true },
            { loadBtn: 'ec-fnt-ank8-load', clearBtn: 'ec-fnt-ank8-clear', fileInput: 'ec-file-fnt-ank8',  type: 'ank8',  isRom: false },
            { loadBtn: 'ec-fnt-ank16-load',clearBtn: 'ec-fnt-ank16-clear',fileInput: 'ec-file-fnt-ank16', type: 'ank16', isRom: false },
            { loadBtn: 'ec-fnt-knj-load',  clearBtn: 'ec-fnt-knj-clear',  fileInput: 'ec-file-fnt-knj',   type: 'knj',   isRom: false },
        ];
        romFontMap.forEach(function(cfg) {
            var loadEl  = document.getElementById(cfg.loadBtn);
            var clearEl = document.getElementById(cfg.clearBtn);
            var fileEl  = document.getElementById(cfg.fileInput);
            if (loadEl && fileEl) loadEl.addEventListener('click', function() { fileEl.click(); });
            if (fileEl) fileEl.addEventListener('change', function(e) {
                if (cfg.isRom) ctrl.onRomFileChange(cfg.type, e);
                else ctrl.onFontFileChange(cfg.type, e);
                setTimeout(function() { updateMenuState('opt'); }, 100);
            });
            if (clearEl) clearEl.addEventListener('click', function() {
                if (cfg.isRom) ctrl.clearRom(cfg.type);
                else ctrl.clearFont(cfg.type);
                updateMenuState('opt');
            });
        });
    }

    // ── イベントリスナー ──

    elBtnRun.addEventListener('click', onRunClick);
    elBtnStop.addEventListener('click', onStopClick);
    var elBtnShare = document.getElementById('btn-share');
    if (elBtnShare) elBtnShare.addEventListener('click', onShareClick);
    if (elBtnDevReload && isDevAssetMode()) {
        elBtnDevReload.classList.remove('hidden');
        elBtnDevReload.addEventListener('click', function() {
            reloadAssetsBypassCache();
        });
    }

    // Ctrl+Enter で RUN
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.key === 'Enter' && !elBtnRun.disabled) {
            e.preventDefault();
            onRunClick();
        }
    });

    // Tab, focus/blur, localStorage は CodeMirror 初期化時に設定済み

    // タブ切り替え
    var editorTabs = document.getElementById('editor-tabs');
    if (editorTabs) {
        editorTabs.addEventListener('click', function(e) {
            var tab = e.target.closest('.editor-tab');
            if (!tab) return;
            var target = tab.dataset.tab;
            if (target === activeTab) return;
            activeTab = target;
            editorTabs.querySelectorAll('.editor-tab').forEach(function(t) {
                t.classList.toggle('active', t.dataset.tab === target);
            });
            var importBtn = document.getElementById('btn-asm-import');
            var basicContainer = document.getElementById('basic-editor-container');
            var asmContainer = document.getElementById('asm-editor-container');
            if (target === 'basic') {
                if (basicContainer) basicContainer.classList.remove('hidden');
                if (asmContainer) asmContainer.classList.add('hidden');
                if (importBtn) importBtn.classList.add('hidden');
            } else {
                if (basicContainer) basicContainer.classList.add('hidden');
                if (asmContainer) asmContainer.classList.remove('hidden');
                if (importBtn) importBtn.classList.remove('hidden');
            }
        });
    }

    // ASM Import: バイナリ → DB 行変換
    function binaryToDbLines(uint8array, filename) {
        var lines = ['; imported: ' + filename + ' (' + uint8array.length + ' bytes)'];
        for (var i = 0; i < uint8array.length; i += 16) {
            var chunk = uint8array.slice(i, Math.min(i + 16, uint8array.length));
            var hex = Array.from(chunk).map(function(b) {
                return '$' + ('0' + b.toString(16).toUpperCase()).slice(-2);
            });
            lines.push('DB ' + hex.join(','));
        }
        return lines.join('\n');
    }

    var asmImportBtn = document.getElementById('btn-asm-import');
    var asmImportFile = document.getElementById('asm-import-file');
    if (asmImportBtn && asmImportFile) {
        asmImportBtn.addEventListener('click', function() { asmImportFile.click(); });
        asmImportFile.addEventListener('change', function(e) {
            var file = e.target.files[0];
            e.target.value = '';
            if (!file || !asmEditor) return;

            if (file.size > 128 * 1024) {
                elStatus.textContent = 'File too large (max 128KB)';
                return;
            }

            var reader = new FileReader();
            reader.onload = function() {
                var data = new Uint8Array(reader.result);

                if (data.length > 64 * 1024) {
                    elStatus.textContent = 'Warning: large file, may affect share';
                }

                var dbText = binaryToDbLines(data, file.name);
                var pos = asmEditor.getCursor();

                // 行の途中なら前に改行
                var prefix = (pos > 0 && asmEditor.getCharAt(pos - 1) !== '\n') ? '\n' : '';
                // 末尾に改行
                var suffix = '\n';

                var insertText = prefix + dbText + suffix;
                asmEditor.insertAt(pos, insertText);
                asmEditor.setCursor(pos + insertText.length);
                elStatus.textContent = 'Imported: ' + file.name + ' (' + data.length + ' bytes)';
            };
            reader.readAsArrayBuffer(file);
        });
    }
})();

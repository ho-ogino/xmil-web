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

        // ライブラリ UI + コントロールバー のイベントリスナー登録
        setupLibraryListeners();
        setupControlBarListeners();

        // 初期化シーケンス:
        // 1. ROM を VFS に配置 (reset なし)
        if (window.XmilControls) window.XmilControls.loadRomToVfs();
        // 2. フォントを VFS に配置 (reload なし)
        if (window.XmilControls) window.XmilControls.loadFontsToVfs();
        // 3. コールドステート復元
        if (!restoreColdState()) {
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
            r.addEventListener('change', function() { ctrl.setRomType(parseInt(this.value, 10)); });
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

    // エディタ内容を localStorage に自動保存/復元
    var LS_EDITOR = 'x1pen_editor';
    try {
        var saved = localStorage.getItem(LS_EDITOR);
        if (saved) elEditor.value = saved;
    } catch(e) {}
    elEditor.addEventListener('input', function() {
        try { localStorage.setItem(LS_EDITOR, elEditor.value); } catch(e) {}
    });
})();

// X millennium Web - JavaScript frontend

(function() {
    'use strict';

    let module = null;
    let isRunning = false;
    let audioUnlocked = false;
    let frameCount = 0;
    let lastTime = performance.now();
    let fps = 0;
    let cmtDeckInterval = null;
    let cmtDeckTapeName = null;
    let fddLedTimers = [null, null];  // per-drive LED 消灯タイマー
    let fddDiskType = [null, null];   // 'null' | '2d' | '2hd' per drive

    // ----------------------------------------------------------------
    // ファイルライブラリ: スロット状態
    // slotName: 'drive0', 'drive1', 'hdd0', 'hdd1', 'cmt', 'emm0'..'emm9'
    // ----------------------------------------------------------------
    const slotState         = { drive0: null, drive1: null, hdd0: null, hdd1: null, cmt: null, emm0: null, emm1: null, emm2: null, emm3: null, emm4: null, emm5: null, emm6: null, emm7: null, emm8: null, emm9: null };
    const slotDirty         = { drive0: false, drive1: false, hdd0: false, hdd1: false, cmt: false, emm0: false, emm1: false, emm2: false, emm3: false, emm4: false, emm5: false, emm6: false, emm7: false, emm8: false, emm9: false };
    const slotFlushInFlight = { drive0: null, drive1: null, hdd0: null, hdd1: null, cmt: null, emm0: null, emm1: null, emm2: null, emm3: null, emm4: null, emm5: null, emm6: null, emm7: null, emm8: null, emm9: null };
    const slotVfsPath       = { drive0: null, drive1: null, hdd0: null, hdd1: null, cmt: null, emm0: null, emm1: null, emm2: null, emm3: null, emm4: null, emm5: null, emm6: null, emm7: null, emm8: null, emm9: null };

    const slotDirtyPages = {};     // slotName → Set<pageIndex> (64KB pages for OPFS partial write)
    const slotDirtyEpoch = {};     // slotName → number (incremented per write, for safe dirty clearing)
    const PAGE_SIZE = 65536;       // 64KB

    var emmImportSlot = -1;       // インポート対象スロット番号
    var emmImportInput = null;    // 隠し file input (init() で生成)
    var emmSlotInFlight = {};     // スロット単位の処理中ガード
    var currentLibrarySort = 'name';      // 'name' | 'type-name' | 'date-desc' | 'size-desc'
    var currentLibrarySearch = '';         // 検索テキスト
    var currentFavoritesOnly = false;     // ★フィルタ ON/OFF

    // マルチタブ検出 (BroadcastChannel requestId 付きハンドシェイク)
    // 初期化直後から ping に応答する。キャンセル時のみ close() する。
    var _multiTabPromise = null;
    var _tabChannel = null;
    if (typeof BroadcastChannel !== 'undefined') {
        var _channelName = window.__X1PEN_MODE ? 'x1pen_tab' : 'xmil_tab';
        _tabChannel = new BroadcastChannel(_channelName);
        var _myTabId = Math.random().toString(36).slice(2);
        _multiTabPromise = new Promise(function(resolve) {
            var detected = false;
            _tabChannel.onmessage = function(e) {
                if (!e.data) return;
                if (e.data.type === 'ping') {
                    _tabChannel.postMessage({ type: 'pong', replyTo: e.data.id });
                } else if (e.data.type === 'pong' && e.data.replyTo === _myTabId) {
                    if (!detected) { detected = true; resolve(true); }
                }
            };
            _tabChannel.postMessage({ type: 'ping', id: _myTabId });
            setTimeout(function() { if (!detected) resolve(false); }, 500);
        });
        window.addEventListener('pagehide', function() {
            if (_tabChannel) { _tabChannel.close(); _tabChannel = null; }
        });
    }
    // X1Pen モード用: マルチタブ promise をグローバル公開
    window.__multiTabPromise = _multiTabPromise;
    window.__tabChannel = _tabChannel;

    // スロット→対応タイプ
    const SLOT_TYPES = { drive0: 'fdd', drive1: 'fdd', hdd0: 'hdd', hdd1: 'hdd', cmt: 'cmt', emm0: 'emm', emm1: 'emm', emm2: 'emm', emm3: 'emm', emm4: 'emm', emm5: 'emm', emm6: 'emm', emm7: 'emm', emm8: 'emm', emm9: 'emm' };

    // ファイルタイプ別サイズ上限 (DoS防止)
    const SIZE_LIMIT = { fdd: 32 * 1024 * 1024, cmt: 32 * 1024 * 1024, hdd: 512 * 1024 * 1024, emm: 16 * 1024 * 1024 };

    // ---- EMM ユーティリティ ----
    function emmSlotFromName(filename) {
        var m = filename.match(/^EMM(\d)\.MEM$/i);
        return m ? ('emm' + m[1]) : null;
    }
    function emmSlotNum(slotName) { return parseInt(slotName.replace('emm', ''), 10); }

    // ----------------------------------------------------------------
    // localStorage キー
    // ----------------------------------------------------------------
    const LS_SETTINGS    = 'xmil_settings';
    const LS_ROM         = 'xmil_rom';      // 旧キー (互換読み取り用)
    const LS_ROM_X1      = 'xmil_rom_x1';
    const LS_ROM_X1T     = 'xmil_rom_x1t';
    const LS_FNT_ANK8    = 'xmil_fnt_ank8';
    const LS_FNT_ANK16   = 'xmil_fnt_ank16';
    const LS_FNT_KNJ     = 'xmil_fnt_knj';
    const LS_LIBRARY     = 'xmil_library';     // LibraryEntry[] JSON
    const LS_MOUNT_STATE = window.__X1PEN_MODE ? 'x1pen_mount_state' : 'xmil_mount_state';
    const LS_STATES      = 'xmil_savestates';  // SaveStateEntry[] JSON
    const QUICK_STATE_KEY = 'xmil_quick_state'; // 最新クイックセーブキー

    // ----------------------------------------------------------------
    // UI要素キャッシュ
    // ----------------------------------------------------------------
    const elements = {
        loading: null,
        mainContent: null,
        btnStart: null,
        btnStop: null,
        btnReset: null,
        btnTestAudio: null,
        fileRomX1:  null,
        fileRomX1t: null,
        statusText: null,
        fpsText: null,
        canvas: null,
        romTypeRadios: null,
        dipHighres: null,
        dip2hd: null,
        skipLine: null,
        motorSound: null,
        joystickEnable: null,
        mouseEnable: null,
        statusToastEnable: null,
        keyModeRadios: null
    };

    // ----------------------------------------------------------------
    // ライブラリ: キー生成ユーティリティ
    // ----------------------------------------------------------------

    // FNV-32a ハッシュ (6桁36進数)
    function fnv32a(str) {
        var h = 0x811c9dc5;
        for (var i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = (h * 0x01000193) >>> 0;
        }
        return h.toString(36).slice(0, 6);
    }

    // OPFS キー生成: lib_{type}_{sanitized}_{hash}
    // パス区切り・制御文字のみ '_' 置換。ドット '.' は保持。
    function makeLibraryKey(type, filename) {
        var s = filename.replace(/[\/\\\x00-\x1f\x7f]/g, '_');
        return 'lib_' + type + '_' + s + '_' + fnv32a(filename);
    }

    // スロット UI 識別子 → 内部スロット名
    function slotIndexToName(type, index) {
        if (type === 'fdd') return index === 0 ? 'drive0' : 'drive1';
        if (type === 'hdd') return index === 0 ? 'hdd0'   : 'hdd1';
        if (type === 'cmt') return 'cmt';
        return null;
    }

    // VFS パス生成 (元拡張子保持: x1_set_fd() が拡張子で分岐するため)
    function slotToVfsPath(slotName, ext) {
        if (slotName.startsWith('emm')) {
            return '/EMM' + emmSlotNum(slotName) + '.MEM';
        }
        var base = { drive0: 'fdd0', drive1: 'fdd1', hdd0: 'hdd0', hdd1: 'hdd1', cmt: 'cmt' }[slotName];
        return '/' + base + '.' + ext;
    }

    // ----------------------------------------------------------------
    // ライブラリ: localStorage 操作
    // ----------------------------------------------------------------
    function getLibrary() {
        try {
            var raw = localStorage.getItem(LS_LIBRARY);
            return raw ? JSON.parse(raw) : [];
        } catch(e) { return []; }
    }

    function saveLibrary(lib) {
        try { localStorage.setItem(LS_LIBRARY, JSON.stringify(lib)); } catch(e) {
            console.warn('saveLibrary failed:', e);
        }
    }

    function getMountState() {
        try {
            var raw = localStorage.getItem(LS_MOUNT_STATE);
            return raw ? JSON.parse(raw) : {};
        } catch(e) { return {}; }
    }

    function saveMountState() {
        try { localStorage.setItem(LS_MOUNT_STATE, JSON.stringify(slotState)); } catch(e) {
            console.warn('saveMountState failed:', e);
        }
    }

    // ----------------------------------------------------------------
    // ファイルタイプ判定 (X1_fdc.cpp の x1_set_fd() 実サポートに合わせた拡張子のみ)
    // ----------------------------------------------------------------
    function detectFileType(filename) {
        var ext = filename.split('.').pop().toLowerCase();
        if (['d88', '2d', '88d'].includes(ext)) return 'fdd';
        if (['hdd', 'hd'].includes(ext)) return 'hdd';
        if (['cas', 'cmt', 'tap', 'bas', 'bin'].includes(ext)) return 'cmt';
        if (ext === 'mem' && /^EMM\d\.MEM$/i.test(filename)) return 'emm';
        return null;
    }

    // ----------------------------------------------------------------
    // EMM 作成・管理
    // ----------------------------------------------------------------

    async function createEmm(slotNum, sizeBytes) {
        if (slotNum < 0 || slotNum > 9) return;
        if (sizeBytes <= 0 || sizeBytes > 16 * 1024 * 1024) return;
        // 256B 境界に丸める
        sizeBytes = Math.ceil(sizeBytes / 256) * 256;

        var slotName = 'emm' + slotNum;
        var fileName = 'EMM' + slotNum + '.MEM';

        // 既存マウント中ならイジェクト
        if (slotState[slotName]) await ejectSlot(slotName);

        // ゼロ埋めデータ作成
        var data = new ArrayBuffer(sizeBytes);

        // OPFS に保存
        await window.XmilStorage.write(fileName, data);

        // ライブラリ upsert（同キー or 同 name+type を除去してから push）
        // 古いキーが異なる場合は OPFS の孤児データを削除
        var oldLib = getLibrary();
        for (var oi = 0; oi < oldLib.length; oi++) {
            var oe = oldLib[oi];
            if (oe.key !== fileName && oe.type === 'emm' && oe.name === fileName) {
                try { await window.XmilStorage.remove(oe.key); } catch(_) {}
            }
        }
        var existingFav = false;
        var lib = oldLib.filter(function(e) {
            if (e.key === fileName || (e.type === 'emm' && e.name === fileName)) {
                if (e.favorite) existingFav = true;
                return false;
            }
            return true;
        });
        var entry = { key: fileName, name: fileName, type: 'emm', ext: 'MEM', size: sizeBytes, addedAt: new Date().toISOString(), favorite: existingFav };
        lib.push(entry);
        saveLibrary(lib);

        // 即マウント
        await mountFromLibrary(fileName, slotName);
        renderLibraryList();
        updateStatus('EMM' + slotNum + ' 作成 (' + (sizeBytes / 1024) + 'KB)');
    }

    function openEmmCreateDialog(fixedSlot) {
        var dlg = document.getElementById('emm-create-dialog');
        if (!dlg) return;
        var sel = dlg.querySelector('#emm-create-slot');
        if (sel) {
            if (fixedSlot !== undefined) {
                // スロット固定モード（10スロット UI から呼ばれる）
                sel.value = fixedSlot;
                sel.disabled = true;
            } else {
                sel.disabled = false;
                for (var i = 0; i < sel.options.length; i++)
                    sel.options[i].disabled = !!slotState['emm' + i];
                for (var j = 0; j < sel.options.length; j++)
                    if (!sel.options[j].disabled) { sel.selectedIndex = j; break; }
            }
        }
        emmSyncCustomInput();
        dlg.classList.remove('hidden');
    }

    function closeEmmCreateDialog() {
        var dlg = document.getElementById('emm-create-dialog');
        if (dlg) {
            dlg.classList.add('hidden');
            // 固定モード解除
            var sel = dlg.querySelector('#emm-create-slot');
            if (sel) sel.disabled = false;
        }
    }

    // ラジオ選択に応じて custom 入力欄を有効/無効化
    function emmSyncCustomInput() {
        var checked = document.querySelector('input[name="emm-size"]:checked');
        var inp = document.getElementById('emm-custom-size');
        if (inp) inp.disabled = !(checked && checked.value === 'custom');
    }

    // ラジオボタン change イベント (init() 内で設定)
    function initEmmSizeRadios() {
        var radios = document.querySelectorAll('input[name="emm-size"]');
        for (var i = 0; i < radios.length; i++) {
            radios[i].addEventListener('change', emmSyncCustomInput);
        }
        // custom 入力欄クリック時に custom ラジオを自動選択
        var inp = document.getElementById('emm-custom-size');
        if (inp) {
            inp.addEventListener('focus', function() {
                var customRadio = document.querySelector('input[name="emm-size"][value="custom"]');
                if (customRadio) { customRadio.checked = true; emmSyncCustomInput(); }
            });
        }
    }

    async function onEmmCreateConfirm() {
        var sel = document.getElementById('emm-create-slot');
        if (!sel) return;
        var slotNum = parseInt(sel.value, 10);

        // サイズ取得
        var sizeBytes;
        var checkedRadio = document.querySelector('input[name="emm-size"]:checked');
        if (checkedRadio && checkedRadio.value === 'custom') {
            // custom: KB 単位入力 → バイト変換
            var customInput = document.getElementById('emm-custom-size');
            var kb = parseInt(customInput ? customInput.value : '0', 10);
            if (!kb || kb <= 0) { alert('サイズを入力してください'); return; }
            sizeBytes = kb * 1024;
        } else if (checkedRadio) {
            // プリセット: value はバイト単位
            sizeBytes = parseInt(checkedRadio.value, 10);
        } else {
            sizeBytes = 1048576; // デフォルト 1MB
        }

        if (!sizeBytes || sizeBytes <= 0) { alert('サイズを入力してください'); return; }
        if (sizeBytes > 16 * 1024 * 1024) { alert('最大 16MB です'); return; }
        if (sizeBytes % 256 !== 0) { sizeBytes = Math.ceil(sizeBytes / 256) * 256; }

        closeEmmCreateDialog();
        await createEmm(slotNum, sizeBytes);
    }

    // ----------------------------------------------------------------
    // EMM 10スロット固定ビュー
    // ----------------------------------------------------------------

    function renderEmmSlotList() {
        var listEl = document.getElementById('library-list');
        if (!listEl) return;
        var lib = getLibrary();
        var html = '';
        for (var i = 0; i < 10; i++) {
            var slotName = 'emm' + i;
            var fileName = 'EMM' + i + '.MEM';
            var entry = lib.find(function(e) { return e.type === 'emm' && e.name === fileName; });
            var isMounted = !!slotState[slotName];
            var hasEntry = !!entry;
            var busy = !!emmSlotInFlight[i];

            html += '<div class="emm-slot-row' + (isMounted ? ' mounted' : '') + '">';
            html += '<span class="emm-slot-label">EMM' + i + '</span>';

            if (hasEntry) {
                var sizeMb = (entry.size / 1024 / 1024).toFixed(1);
                html += '<span class="emm-slot-info">' + escHtml(entry.name) + ' (' + sizeMb + 'MB)</span>';
            } else {
                html += '<span class="emm-slot-info emm-unassigned">未割り当て</span>';
            }

            html += '<div class="emm-slot-btns">';
            // 挿入/イジェクト (マウント状態で切替)
            if (isMounted) {
                html += '<button class="emm-action-btn emm-action-eject" data-action="emm-eject" data-slot="' + i + '"'
                     + (busy ? ' disabled' : '') + '>イジェクト</button>';
            } else if (hasEntry) {
                html += '<button class="emm-action-btn emm-action-insert" data-action="emm-insert" data-slot="' + i + '"'
                     + (busy ? ' disabled' : '') + '>挿入</button>';
            }
            html += '<button class="emm-action-btn" data-action="emm-create" data-slot="' + i + '"'
                 + (busy ? ' disabled' : '') + '>作成</button>';
            html += '<button class="emm-action-btn" data-action="emm-export" data-slot="' + i + '"'
                 + (!hasEntry || busy ? ' disabled' : '') + '>エクスポート</button>';
            html += '<button class="emm-action-btn" data-action="emm-import" data-slot="' + i + '"'
                 + (busy ? ' disabled' : '') + '>インポート</button>';
            html += '<button class="emm-action-btn" data-action="emm-edit" data-slot="' + i + '"'
                 + (!hasEntry || busy ? ' disabled' : '') + '>編集</button>';
            if (hasEntry) {
                html += '<button class="emm-action-btn emm-action-del" data-action="emm-delete" data-slot="' + i + '"'
                     + (isMounted || busy ? ' disabled' : '') + '>削除</button>';
            }
            html += '</div></div>';
        }
        listEl.innerHTML = html;
    }

    // ---- EMM ガード（create / import 用）----
    function emmGuardStart(slotNum) {
        if (emmSlotInFlight[slotNum]) return false;
        emmSlotInFlight[slotNum] = true;
        renderEmmSlotList();
        return true;
    }
    function emmGuardEnd(slotNum) {
        delete emmSlotInFlight[slotNum];
        renderEmmSlotList();
    }

    // ---- EMM スロットアクションハンドラ ----
    function onEmmSlotCreate(slotNum) {
        var fileName = 'EMM' + slotNum + '.MEM';
        var lib = getLibrary();
        var existing = lib.find(function(e) { return e.type === 'emm' && e.name === fileName; });
        if (existing) {
            if (!confirm('現在割り当てられている EMM データを削除して新規に EMM 領域を作成しますか？')) return;
        }
        openEmmCreateDialog(slotNum);
    }

    function onEmmSlotExport(slotNum) {
        var fileName = 'EMM' + slotNum + '.MEM';
        var entry = getLibrary().find(function(e) { return e.type === 'emm' && e.name === fileName; });
        if (!entry) return;
        downloadFromLibrary(entry.key, entry.name);
    }

    function onEmmSlotImport(slotNum) {
        var fileName = 'EMM' + slotNum + '.MEM';
        var existing = getLibrary().find(function(e) { return e.type === 'emm' && e.name === fileName; });
        if (existing) {
            if (!confirm('EMM' + slotNum + ' には既にデータが割り当てられています。上書きしますか？')) return;
        }
        emmImportSlot = slotNum;
        if (emmImportInput) emmImportInput.click();
    }

    function onEmmSlotDelete(slotNum) {
        var fileName = 'EMM' + slotNum + '.MEM';
        var entry = getLibrary().find(function(e) { return e.type === 'emm' && e.name === fileName; });
        if (!entry) return;
        deleteFromLibrary(entry.key);
    }

    async function onEmmSlotInsert(slotNum) {
        var slotName = 'emm' + slotNum;
        var fileName = 'EMM' + slotNum + '.MEM';
        var entry = getLibrary().find(function(e) { return e.type === 'emm' && e.name === fileName; });
        if (!entry) return;
        if (slotState[slotName]) return; // 既にマウント中
        if (!emmGuardStart(slotNum)) return;
        try {
            await mountFromLibrary(entry.key, slotName);
        } catch(e) {
            console.error('EMM insert failed:', slotNum, e);
        } finally {
            emmGuardEnd(slotNum);
        }
    }

    async function onEmmSlotEject(slotNum) {
        var slotName = 'emm' + slotNum;
        if (!slotState[slotName]) return; // マウントされていない
        if (!emmGuardStart(slotNum)) return;
        try {
            await ejectSlot(slotName);
        } catch(e) {
            console.error('EMM eject failed:', slotNum, e);
        } finally {
            emmGuardEnd(slotNum);
        }
    }

    // ----------------------------------------------------------------
    // コアライブラリ操作
    // ----------------------------------------------------------------

    // ファイルをライブラリに追加 (OPFS + localStorage メタ)
    async function addToLibrary(file) {
        var type = detectFileType(file.name);
        if (!type) {
            alert('不明なファイル形式です: ' + file.name + '\n対応: D88/2D/88D (FDD), HDD/HD (HDD), CAS/CMT/TAP/BAS/BIN (CMT)');
            return null;
        }
        var ext = file.name.split('.').pop();  // 大文字/小文字保持
        var key = makeLibraryKey(type, file.name);

        var sizeLimit = SIZE_LIMIT[type];
        if (sizeLimit && file.size > sizeLimit) {
            alert('ファイルが大きすぎます: ' + file.name
                + '\n(' + (file.size / 1024 / 1024).toFixed(1) + 'MB'
                + ' / 上限 ' + (sizeLimit / 1024 / 1024).toFixed(0) + 'MB)');
            return null;
        }

        try {
            if (window.XmilStorage) await window.XmilStorage.ensureCapacity(file.size);
        } catch(e) {
            alert(e.message || '容量不足のため追加できません');
            return null;
        }

        // 同名ファイルの上書き確認
        var lib = getLibrary();
        var existingIdx = lib.findIndex(function(e) { return e.key === key; });
        if (existingIdx >= 0) {
            if (!confirm('同名のファイルが既に存在します:\n' + file.name + '\n\n上書きしますか？')) {
                return null;
            }
        }

        updateStatus('ライブラリに追加中: ' + file.name);
        try {
            var data = await file.arrayBuffer();
            if (window.XmilStorage) await window.XmilStorage.write(key, data);

            var existingFav = (existingIdx >= 0) ? !!lib[existingIdx].favorite : false;
            var entry = { key: key, name: file.name, type: type, ext: ext, size: file.size, addedAt: new Date().toISOString(), favorite: existingFav };
            if (existingIdx >= 0) lib[existingIdx] = entry; else lib.push(entry);
            saveLibrary(lib);
            updateStatus('追加完了: ' + file.name);
            renderLibraryList();
            updateCapacityDisplay();
            return entry;
        } catch(e) {
            console.error('addToLibrary failed:', e);
            updateStatus('追加エラー: ' + file.name);
            return null;
        }
    }

    // ライブラリからスロットにマウント
    async function mountFromLibrary(key, slotName) {
        var entry = getLibrary().find(function(e) { return e.key === key; });
        if (!entry) { alert('ファイルが見つかりません'); return; }

        // タイプガード
        if (entry.type !== SLOT_TYPES[slotName]) {
            console.error('Type mismatch: cannot mount', entry.type, 'to slot', slotName);
            return;
        }

        // 同一ファイルが他スロットにマウント中なら先にeject (二重マウント防止)
        for (var sn in slotState) {
            if (slotState[sn] === key && sn !== slotName) {
                await ejectSlot(sn);
            }
        }

        // 現在スロットにマウント中なら先にeject
        if (slotState[slotName]) await ejectSlot(slotName);

        // OPFS → VFS
        if (!window.XmilStorage) { alert('ストレージが初期化されていません'); return; }
        var data = await window.XmilStorage.read(key);
        if (!data) { alert('ストレージからファイルを読み込めませんでした: ' + entry.name); return; }

        // ext フォールバック (古いデータで ext が欠落している場合)
        var ext = entry.ext != null ? entry.ext : (entry.name.split('.').pop() || 'd88');
        var vfsPath = slotToVfsPath(slotName, ext);
        writeFileToVFS(vfsPath, new Uint8Array(data));

        // エミュレータに通知
        // js_insert_disk(const char* path, int drive) — platform_main.cpp
        if (module) {
            try {
                if (slotName === 'drive0') {
                    module.ccall('js_insert_disk', null, ['string', 'number'], [vfsPath, 0]);
                    // D88 ディスクタイプ判定
                    var arr = new Uint8Array(data);
                    fddDiskType[0] = (arr.length > 0x1C && arr[0x1B] === 0x20) ? '2hd' : '2d';
                } else if (slotName === 'drive1') {
                    module.ccall('js_insert_disk', null, ['string', 'number'], [vfsPath, 1]);
                    var arr2 = new Uint8Array(data);
                    fddDiskType[1] = (arr2.length > 0x1C && arr2[0x1B] === 0x20) ? '2hd' : '2d';
                } else if (slotName === 'hdd0') {
                    module.ccall('js_set_sasi_path', null, ['string', 'number'], [vfsPath, 0]);
                } else if (slotName === 'hdd1') {
                    module.ccall('js_set_sasi_path', null, ['string', 'number'], [vfsPath, 1]);
                } else if (slotName === 'cmt') {
                    module.ccall('js_insert_cmt', null, ['string'], [vfsPath]);
                    // cmt_set() は失敗時に tape_freq を 0 のまま返す (file_open失敗・形式不正等)
                    // js_get_cmt_freq() で成否を判定する
                    var cmtFreq = (module._js_get_cmt_freq ? module._js_get_cmt_freq() >>> 0 : 1);
                    if (cmtFreq === 0) {
                        updateStatus('テープロード失敗: ' + entry.name + ' (対応していない形式の可能性があります)');
                        return;  // slotState を更新しない
                    }
                } else if (slotName.startsWith('emm')) {
                    // EMM: VFS にファイルが配置済み → C++ エラーフラグ/キャッシュ無効化
                    if (module._js_emm_reset_slot) {
                        module._js_emm_reset_slot(emmSlotNum(slotName));
                    }
                }
            } catch(e) {
                console.error('mount emulator call failed:', slotName, e);
            }
        }

        slotState[slotName]   = key;
        slotVfsPath[slotName] = vfsPath;
        slotDirty[slotName]   = false;
        slotDirtyPages[slotName] = null;
        saveMountState();
        updateSlotUI(slotName, entry.name);
        renderLibraryList();
        updateStatus('マウント完了: ' + entry.name + ' → ' + slotName);
    }

    // スロットをeject (ファイルはライブラリに保持)
    async function ejectSlot(slotName) {
        if (!slotState[slotName]) return;

        // 順序が重要:
        // 1. まずC++にイジェクトを通知する (fdd_eject_d88 → drvflush() がVFSに最後のバッファを書き込む)
        // 2. その後VFS→OPFSへフラッシュする
        // ※ 逆順にすると「C++がまだVFSに書いていないバッファ」が漏れてOPFSに保存されてしまう
        if (module) {
            try {
                if (slotName === 'drive0') {
                    module._js_eject_disk(0);
                    fddDiskType[0] = null;
                } else if (slotName === 'drive1') {
                    module._js_eject_disk(1);
                    fddDiskType[1] = null;
                } else if (slotName === 'hdd0') {
                    module.ccall('js_set_sasi_path', null, ['string', 'number'], ['', 0]);
                } else if (slotName === 'hdd1') {
                    module.ccall('js_set_sasi_path', null, ['string', 'number'], ['', 1]);
                } else if (slotName === 'cmt') {
                    if (module._js_cmt_eject) module._js_cmt_eject();
                } else if (slotName.startsWith('emm')) {
                    // EMM: C++ dirty バッファ → VFS にフラッシュ
                    if (module._js_emm_flush) module._js_emm_flush();
                    // dirty_slots を JS に反映 (flushSlot が OPFS 保存を判断するため)
                    syncEmmDirtyFromCpp();
                    // キャッシュハンドル解放 + エラーフラグ/ページキャッシュ無効化
                    if (module._js_emm_reset_slot) {
                        module._js_emm_reset_slot(emmSlotNum(slotName));
                    }
                }
            } catch(e) {
                console.error('ejectSlot emulator call failed:', slotName, e);
            }
        }

        // C++がVFSを更新した後にOPFSへ保存
        // flush 失敗してもスロット状態はクリアする（不整合防止）
        try {
            if (slotDirty[slotName]) await flushSlot(slotName);
        } catch(e) {
            console.error('ejectSlot flush failed:', slotName, e);
        }

        // EMM: VFS ファイルも削除
        if (slotName.startsWith('emm') && slotVfsPath[slotName]) {
            try { module.FS.unlink(slotVfsPath[slotName]); } catch(e) {}
        }

        slotState[slotName]   = null;
        slotVfsPath[slotName] = null;
        slotDirty[slotName]   = false;
        slotDirtyPages[slotName] = null;
        saveMountState();
        updateSlotUI(slotName, null);
        renderLibraryList();
        updateStatus('イジェクト: ' + slotName);
    }

    // ライブラリからダウンロード
    async function downloadFromLibrary(key, name) {
        if (!window.XmilStorage) return;
        var data = await window.XmilStorage.read(key);
        if (!data) { alert('ファイルを読み込めませんでした'); return; }
        var url = URL.createObjectURL(new Blob([data]));
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ライブラリから削除
    async function deleteFromLibrary(key) {
        var entry = getLibrary().find(function(e) { return e.key === key; });
        if (!entry) return;
        if (!confirm('"' + entry.name + '" をライブラリから削除しますか？\nマウント中の場合は自動的にイジェクトされます。')) return;

        // マウント中なら先にeject
        for (var sn in slotState) {
            if (slotState[sn] === key) await ejectSlot(sn);
        }

        if (window.XmilStorage) {
            try { await window.XmilStorage.remove(key); } catch(e) {}
        }
        saveLibrary(getLibrary().filter(function(e) { return e.key !== key; }));
        renderLibraryList();
        updateCapacityDisplay();
        updateStatus('削除完了: ' + entry.name);
    }

    // 起動時: マウント状態を復元
    async function autoRestoreMounts(excludeSlots) {
        var state = getMountState();
        var lib = getLibrary();
        var exclude = excludeSlots || [];
        for (var slotName in state) {
            if (exclude.indexOf(slotName) >= 0) continue;
            var key = state[slotName];
            if (!key) continue;
            var exists = lib.find(function(e) { return e.key === key; });
            if (!exists) continue;  // ライブラリに存在しない → スキップ
            try {
                await mountFromLibrary(key, slotName);
            } catch(e) {
                console.warn('マウント復元失敗:', slotName, e);
            }
        }
    }

    // ----------------------------------------------------------------
    // dirty page tracking (OPFS partial write)
    // ----------------------------------------------------------------
    function markDirtyRange(slotName, offset, size) {
        if (!slotState[slotName]) return;
        if (size <= 0 || offset < 0) return;
        slotDirty[slotName] = true;
        slotDirtyEpoch[slotName] = (slotDirtyEpoch[slotName] || 0) + 1;
        if (!slotDirtyPages[slotName]) slotDirtyPages[slotName] = new Set();
        var pageStart = Math.floor(offset / PAGE_SIZE);
        var pageEnd   = Math.floor((offset + size - 1) / PAGE_SIZE);
        for (var p = pageStart; p <= pageEnd; p++) {
            slotDirtyPages[slotName].add(p);
        }
    }

    function markSlotDirty(slotName) {
        if (!slotState[slotName]) return;
        slotDirty[slotName] = true;
        slotDirtyEpoch[slotName] = (slotDirtyEpoch[slotName] || 0) + 1;
    }

    // ----------------------------------------------------------------
    // dirty flush
    // slotFlushInFlight には bool ではなく進行中の Promise を保持する。
    // 呼び出し元は await flushSlot() で既存フラッシュの完了を待てる。
    // ----------------------------------------------------------------
    function flushSlot(slotName) {
        if (slotFlushInFlight[slotName]) return slotFlushInFlight[slotName];
        if (!slotDirty[slotName] || !slotState[slotName]) return Promise.resolve();
        // 一時ディスク (__x1pen_temp__) は保存対象外
        if (slotState[slotName] === '__x1pen_temp__') {
            slotDirty[slotName] = false;
            slotDirtyPages[slotName] = null;
            return Promise.resolve();
        }

        var pages = slotDirtyPages[slotName];
        slotDirtyPages[slotName] = null;
        var epochAtStart = slotDirtyEpoch[slotName] || 0;

        var p = (async function() {
            var backend = await window.XmilStorage.detectBackend();

            var usePartial = false;
            if (pages && pages.size > 0 && backend === 'opfs') {
                try {
                    var vfsStat = module.FS.stat(slotVfsPath[slotName]);
                    var opfsSize = await window.XmilStorage.stat(slotState[slotName]);
                    var totalPages = Math.ceil(vfsStat.size / PAGE_SIZE);
                    // サイズ一致 & dirty ページがファイルの半分以下なら部分書き込み
                    // 半分超はメモリ圧縮+シーケンシャル I/O 効率の観点で全量書き込み
                    usePartial = opfsSize !== null && opfsSize === vfsStat.size
                              && pages.size <= totalPages / 2;
                } catch(e) { /* usePartial remains false → full write */ }
            }

            if (usePartial) {
                try {
                    await flushVfsToStorageDirty(slotVfsPath[slotName], slotState[slotName], pages);
                } catch(e) {
                    console.warn('writePatch failed, falling back to full write:', slotName, e);
                    await flushVfsToStorage(slotVfsPath[slotName], slotState[slotName]);
                }
            } else {
                await flushVfsToStorage(slotVfsPath[slotName], slotState[slotName]);
            }

            if ((slotDirtyEpoch[slotName] || 0) === epochAtStart) {
                slotDirty[slotName] = false;
            } else {
            }
        })().catch(function(e) {
            if (pages && pages.size > 0) {
                if (!slotDirtyPages[slotName]) slotDirtyPages[slotName] = new Set();
                pages.forEach(function(pg) { slotDirtyPages[slotName].add(pg); });
            }
            throw e;
        }).finally(function() { slotFlushInFlight[slotName] = null; });

        slotFlushInFlight[slotName] = p;
        return p;
    }

    // EMM dirty ビットマスクを C++ から取得 (take: 取得+クリアがアトミック)
    function syncEmmDirtyFromCpp() {
        if (!module || !module._js_emm_take_dirty_slots) return;
        var mask = module._js_emm_take_dirty_slots();
        for (var i = 0; i < 10; i++) {
            if ((mask & (1 << i)) && slotState['emm' + i]) {
                slotDirty['emm' + i] = true;
            }
        }
    }

    var currentFlushPromise = null;
    var currentFlushStrict = false;

    async function flushAllDirty(opts) {
        var strict = opts && opts.strict;
        if (currentFlushPromise) {
            if (strict && !currentFlushStrict) {
                // strict 要求が non-strict flush 中: 完了を待ってから strict で再実行
                await currentFlushPromise.catch(function() {});
                return flushAllDirty(opts);
            }
            // non-strict→any, strict→strict: 進行中 Promise に合流
            return currentFlushPromise;
        }
        currentFlushStrict = !!strict;

        var p = (async function() {
            // C++ dirty バッファ → VFS にフラッシュ（VFS→OPFS 前に必須）
            // FDD flush 失敗時は VFS が古いままなので FDD スロットの OPFS 同期をスキップ
            var fddFlushOk = true;
            if (module && module._js_fdd_flush) {
                fddFlushOk = (module._js_fdd_flush() === 0);
            }
            if (module && module._js_emm_flush) module._js_emm_flush();
            syncEmmDirtyFromCpp();

            var anyDirty = false;
            for (var sn in slotDirty) { if (slotDirty[sn]) { anyDirty = true; break; } }
            if (!anyDirty) {
                if (!fddFlushOk && strict) {
                    throw new Error('FDD flush failed: C++ track buffers could not be written to VFS');
                }
                return;
            }

            if (strict) updateStatus('保存中...');
            for (var slotName in slotState) {
                if (!fddFlushOk && (slotName === 'drive0' || slotName === 'drive1')) continue;
                await flushSlot(slotName);
            }
            if (strict) updateStatus('保存完了');

            if (!fddFlushOk && strict) {
                throw new Error('FDD flush failed: C++ track buffers could not be written to VFS');
            }
        })();

        currentFlushPromise = p;
        p.finally(function() { currentFlushPromise = null; currentFlushStrict = false; });
        return p;
    }

    // ライフサイクルフラッシュ (visibilitychange が主系)
    // flush 失敗はログのみ（ユーザー操作なしのバックグラウンド処理のため）
    function silentFlush() { flushAllDirty().catch(function(e) { console.error('background flush failed:', e); }); }
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') silentFlush();
    });
    window.addEventListener('pagehide', silentFlush);
    window.addEventListener('beforeunload', silentFlush);
    setInterval(silentFlush, 30000);

    // ----------------------------------------------------------------
    // ステートセーブ/ロード
    // ----------------------------------------------------------------

    function getStateList() {
        try {
            var raw = localStorage.getItem(LS_STATES);
            return raw ? JSON.parse(raw) : [];
        } catch(e) { return []; }
    }

    function saveStateList(list) {
        try { localStorage.setItem(LS_STATES, JSON.stringify(list)); } catch(e) {
            console.warn('saveStateList failed:', e);
        }
    }

    function makeStateKey() {
        return 'state_' + Date.now().toString(36) + '_' + fnv32a(Math.random().toString());
    }

    // SHA-256 ハッシュ (hex string) — Web Crypto API
    async function sha256hex(arrayBuffer) {
        var hash = await crypto.subtle.digest('SHA-256', arrayBuffer);
        var bytes = new Uint8Array(hash);
        var hex = '';
        for (var i = 0; i < bytes.length; i++) hex += ('0' + bytes[i].toString(16)).slice(-2);
        return hex;
    }

    // マウント中メディアのSHA-256を計算
    async function computeMountHashes() {
        var hashes = {};
        for (var sn in slotState) {
            if (slotState[sn] && window.XmilStorage) {
                try {
                    var data = await window.XmilStorage.read(slotState[sn]);
                    if (data) hashes[sn] = await sha256hex(data);
                } catch(e) { /* skip */ }
            }
        }
        return hashes;
    }

    // セーブ: VFS flush → C側セーブ → OPFS保存 → メタデータ記録
    async function saveState(name) {
        if (!module) { updateStatus('エミュレータ未初期化'); return null; }
        if (!window.XmilStorage) { updateStatus('ストレージ未初期化'); return null; }

        updateStatus('ステートセーブ中...');
        try {
            // 1. dirty VFS → OPFS 書き戻し
            await flushAllDirty({strict: true});

            // 2. C側セーブ (js_save_state(sizePtr, flags) → malloc buffer → JS copy → free)
            var portableEmm = document.getElementById('cfg-portable-emm');
            var portableFlag = (portableEmm && portableEmm.checked) ? 0x04 : 0;  // STATE_FLAG_PORTABLE_EMM
            var sizePtr = module._malloc(4);
            var bufPtr  = module._js_save_state(sizePtr, portableFlag);
            var size    = new Int32Array(module.wasmMemory.buffer, sizePtr, 1)[0];
            module._free(sizePtr);

            if (!bufPtr || size <= 0) {
                if (bufPtr) module._free(bufPtr);
                updateStatus('ステートセーブ失敗');
                return null;
            }

            var data = new Uint8Array(module.wasmMemory.buffer, bufPtr, size).slice();
            module._free(bufPtr);

            // 3. OPFS保存
            var key = makeStateKey();
            await window.XmilStorage.write(key, data.buffer);

            // 4. マウント中メディアのSHA-256を記録
            var mediaHashes = await computeMountHashes();

            // 5. メタデータ
            var lib = getLibrary();
            var mNames = {};
            for (var sn in slotState) {
                if (slotState[sn]) {
                    var le = lib.find(function(e) { return e.key === slotState[sn]; });
                    if (le) mNames[sn] = le.name;
                }
            }
            var entry = {
                key: key,
                name: name || new Date().toLocaleString('ja-JP'),
                time: new Date().toISOString(),
                size: size,
                mounts: Object.assign({}, slotState),
                mountNames: mNames,
                hashes: mediaHashes,
                portable: !!(portableFlag & 0x04)
            };
            var list = getStateList();
            list.unshift(entry);  // 最新を先頭
            saveStateList(list);

            updateStatus('ステートセーブ完了: ' + entry.name);
            return entry;
        } catch(e) {
            console.error('saveState failed:', e);
            updateStatus('ステートセーブエラー: ' + e.message);
            return null;
        }
    }

    // ロード: メタデータ → 依存メディア確認 → eject → マウント復元 → C側ロード
    async function loadState(key) {
        if (!module) { updateStatus('エミュレータ未初期化'); return false; }
        if (!window.XmilStorage) { updateStatus('ストレージ未初期化'); return false; }

        var list = getStateList();
        var entry = list.find(function(e) { return e.key === key; });
        if (!entry) { updateStatus('ステートが見つかりません'); return false; }

        updateStatus('ステートロード中...');
        try {
            // 1. 依存メディア存在チェック
            var mounts = entry.mounts || {};
            var mNames = entry.mountNames || {};
            var isPortable = !!(entry.portable);
            var lib = getLibrary();
            var missing = [];
            for (var sn in mounts) {
                if (mounts[sn]) {
                    // Portable モードでは EMM スロットをスキップ（EMD セクションから復元される）
                    if (isPortable && sn.startsWith('emm')) continue;
                    if (!lib.find(function(e) { return e.key === mounts[sn]; })) {
                        missing.push(sn + ': ' + (mNames[sn] || mounts[sn]));
                    }
                }
            }
            // mountNames にはあるが mounts に逆引きできなかったスロット
            for (var sn4 in mNames) {
                if (mNames[sn4] && !mounts[sn4]) {
                    missing.push(sn4 + ': ' + mNames[sn4]);
                }
            }
            if (missing.length > 0) {
                var msg = '以下の依存メディアがライブラリにありません:\n' + missing.join('\n') +
                          '\n\nロードを続行しますか?';
                if (!confirm(msg)) { updateStatus('ステートロードキャンセル'); return false; }
            }

            // 2. メディアSHA-256 検証 (eject前にOPFSから直接読んで比較)
            if (entry.hashes) {
                var changed = [];
                for (var sn3 in entry.hashes) {
                    // Portable EMM はステート内に含まれるためスキップ
                    if (isPortable && sn3.startsWith('emm')) continue;
                    if (mounts[sn3]) {
                        try {
                            var mediaData = await window.XmilStorage.read(mounts[sn3]);
                            if (mediaData) {
                                var h = await sha256hex(mediaData);
                                if (h !== entry.hashes[sn3]) {
                                    var libE = lib.find(function(e) { return e.key === mounts[sn3]; });
                                    changed.push(sn3 + ': ' + (libE ? libE.name : mounts[sn3]));
                                }
                            }
                        } catch(e2) { /* skip */ }
                    }
                }
                if (changed.length > 0) {
                    var warnMsg = '以下のメディアはセーブ時から内容が変更されています:\n' +
                                  changed.join('\n') +
                                  '\n\nロードを続行しますか?\n(ディスク/テープの状態が不整合になる可能性があります)';
                    if (!confirm(warnMsg)) { updateStatus('ステートロードキャンセル'); return false; }
                }
            }

            // 3. flush + eject all
            await flushAllDirty({strict: true});
            for (var slot in slotState) {
                if (slotState[slot]) await ejectSlot(slot);
            }

            // 4. マウント復元
            var mountFailed = [];
            for (var sn2 in mounts) {
                if (mounts[sn2]) {
                    // Portable EMM はステートロード後に VFS → OPFS で復元
                    if (isPortable && sn2.startsWith('emm')) continue;
                    await mountFromLibrary(mounts[sn2], sn2);
                    if (slotState[sn2] !== mounts[sn2]) {
                        mountFailed.push(sn2);
                    }
                }
            }

            // 5. C側ロード
            var stateData = await window.XmilStorage.read(key);
            if (!stateData) { updateStatus('ステートデータ読み込み失敗'); return false; }

            var arr = new Uint8Array(stateData);
            var ptr = module._malloc(arr.length);
            new Uint8Array(module.wasmMemory.buffer).set(arr, ptr);
            var rc = module._js_load_state(ptr, arr.length);
            module._free(ptr);

            // WAV効果音（FDDシーク音等）を停止
            if (window.xmilWavSrcs) {
                window.xmilWavSrcs.forEach(function(src, i) {
                    if (src) { try { src.stop(); } catch(e) {} window.xmilWavSrcs[i] = null; }
                });
            }

            if (rc < 0) {
                updateStatus('ステートロード失敗 (データ不正)');
                return false;
            }

            // 5.5 Portable EMM: C++ が EMD 展開 → VFS 書き出し済み → OPFS に書き戻し
            if (isPortable) {
                for (var ei = 0; ei < 10; ei++) {
                    var emmPath = '/EMM' + ei + '.MEM';
                    try {
                        var stat = module.FS.stat(emmPath);
                        if (stat && stat.size > 0) {
                            var emmData = module.FS.readFile(emmPath);
                            var emmKey = 'EMM' + ei + '.MEM';
                            await window.XmilStorage.write(emmKey, emmData.buffer);
                            // ライブラリエントリがなければ作成
                            var eLib = getLibrary();
                            if (!eLib.find(function(e) { return e.key === emmKey; })) {
                                eLib.push({ key: emmKey, name: emmKey, type: 'emm', size: emmData.length, added: new Date().toISOString() });
                                saveLibrary(eLib);
                            }
                            // スロット状態を更新
                            var emmSn = 'emm' + ei;
                            slotState[emmSn] = emmKey;
                            slotVfsPath[emmSn] = emmPath;
                            slotDirty[emmSn] = false;
                            slotDirtyPages[emmSn] = null;
                        }
                    } catch(e) { /* VFS にファイルが無い場合はスキップ */ }
                }
                saveMountState();
            }

            // 6. 警告表示
            var warnings = [];
            if (rc === 1) warnings.push('ROM機種が異なります');
            if (mountFailed.length > 0) warnings.push(mountFailed.join(', ') + ' のマウント復元失敗');
            // セクション読み込み失敗の警告
            var warnPtr = module._js_get_load_warnings();
            if (warnPtr) {
                var sectionWarn = UTF8ToString(warnPtr);
                if (sectionWarn) warnings.push(sectionWarn + ' の読み込み失敗');
            }
            if (warnings.length > 0) {
                updateStatus('ステートロード完了 (注意: ' + warnings.join('; ') + ')');
            } else {
                updateStatus('ステートロード完了: ' + entry.name);
            }
            // C側の復元値をJS側UI/設定に反映
            if (module) {
                // ROM_TYPE (MODEL)
                if (module._js_get_rom_type) {
                    var rt = module._js_get_rom_type();
                    if (elements.romTypeRadios) {
                        elements.romTypeRadios.forEach(function(r) {
                            r.checked = (parseInt(r.value, 10) === rt);
                        });
                    }
                    if (module._js_set_rom_type) module._js_set_rom_type(rt);
                }
                // DIP_SW (2D/2HD, RESOLUTION)
                if (module._js_get_dip_sw) {
                    var dip = module._js_get_dip_sw();
                    if (elements.dipHighres) elements.dipHighres.checked = !(dip & 0x01);
                    if (elements.dip2hd)     elements.dip2hd.checked     = !!(dip & 0x04);
                    if (module._js_set_dip_sw) module._js_set_dip_sw(dip);
                }
                // SOUND_SW (FM Board)
                if (module._js_get_sound_sw) {
                    var sw = module._js_get_sound_sw();
                    if (elements.fmEnable) elements.fmEnable.checked = !!sw;
                    if (module._js_set_sound_sw) module._js_set_sound_sw(sw);
                }
            }
            syncModelBtnActive();
            syncToggleItems();
            updateDiskTypeSwitch();
            updateResolutionSwitch();
            // CMT デッキ UI を復元された C 側コマンドに同期
            if (module._js_get_cmt_cmd) {
                onCmtStateChange(module._js_get_cmt_cmd());
            }
            return true;
        } catch(e) {
            console.error('loadState failed:', e);
            updateStatus('ステートロードエラー: ' + e.message);
            return false;
        }
    }

    // クイックセーブ
    async function quickSave() {
        var overwrite = !!(elements.stateOverwrite && elements.stateOverwrite.checked);
        var lastKey = null;
        try { lastKey = localStorage.getItem(QUICK_STATE_KEY); } catch(e) {}

        if (overwrite && lastKey) {
            var result = await overwriteState(lastKey);
            if (result) {
                renderStateList();
                return result;
            }
            // エントリが消えていた場合はフォールバック
        }
        var entry = await saveState('Quick Save');
        if (entry) {
            try { localStorage.setItem(QUICK_STATE_KEY, entry.key); } catch(e) {}
            renderStateList();
        }
        return entry;
    }

    // クイックロード
    async function quickLoad() {
        var key = null;
        try { key = localStorage.getItem(QUICK_STATE_KEY); } catch(e) {}
        if (!key) { updateStatus('クイックセーブがありません'); return false; }
        return await loadState(key);
    }

    // ステート削除
    async function deleteState(key) {
        try {
            if (window.XmilStorage) await window.XmilStorage.remove(key);
        } catch(e) {}
        var list = getStateList().filter(function(e) { return e.key !== key; });
        saveStateList(list);
        // クイックセーブキーと一致する場合は解除
        try {
            if (localStorage.getItem(QUICK_STATE_KEY) === key) {
                localStorage.removeItem(QUICK_STATE_KEY);
            }
        } catch(e) {}
    }

    // ステート全削除
    async function deleteAllStates() {
        var list = getStateList();
        for (var i = 0; i < list.length; i++) {
            try {
                if (window.XmilStorage) await window.XmilStorage.remove(list[i].key);
            } catch(e) {}
        }
        saveStateList([]);
        try { localStorage.removeItem(QUICK_STATE_KEY); } catch(e) {}
    }

    // ステートリネーム
    function renameState(key, newName) {
        var list = getStateList();
        var entry = list.find(function(e) { return e.key === key; });
        if (entry) {
            entry.name = newName;
            saveStateList(list);
        }
    }

    // ステートを上書きセーブ (既存エントリのキーに再セーブ)
    async function overwriteState(key) {
        if (!module) return null;
        if (!window.XmilStorage) return null;

        var list = getStateList();
        var idx = list.findIndex(function(e) { return e.key === key; });
        if (idx < 0) return null;

        updateStatus('ステート上書き中...');
        try {
            await flushAllDirty({strict: true});

            var portableEmm2 = document.getElementById('cfg-portable-emm');
            var portableFlag2 = (portableEmm2 && portableEmm2.checked) ? 0x04 : 0;
            var sizePtr = module._malloc(4);
            var bufPtr  = module._js_save_state(sizePtr, portableFlag2);
            var size    = new Int32Array(module.wasmMemory.buffer, sizePtr, 1)[0];
            module._free(sizePtr);

            if (!bufPtr || size <= 0) {
                if (bufPtr) module._free(bufPtr);
                updateStatus('ステート上書き失敗');
                return null;
            }

            var data = new Uint8Array(module.wasmMemory.buffer, bufPtr, size).slice();
            module._free(bufPtr);

            await window.XmilStorage.write(key, data.buffer);

            var mediaHashes = await computeMountHashes();
            var lib2 = getLibrary();
            var mNames2 = {};
            for (var sn5 in slotState) {
                if (slotState[sn5]) {
                    var le2 = lib2.find(function(e) { return e.key === slotState[sn5]; });
                    if (le2) mNames2[sn5] = le2.name;
                }
            }
            list[idx].time = new Date().toISOString();
            list[idx].size = size;
            list[idx].portable = !!(portableFlag2 & 0x04);
            list[idx].mounts = Object.assign({}, slotState);
            list[idx].mountNames = mNames2;
            list[idx].hashes = mediaHashes;
            saveStateList(list);

            updateStatus('ステート上書き完了: ' + list[idx].name);
            return list[idx];
        } catch(e) {
            console.error('overwriteState failed:', e);
            updateStatus('ステート上書きエラー');
            return null;
        }
    }

    // ステートダウンロード
    async function downloadState(key) {
        var list = getStateList();
        var entry = list.find(function(e) { return e.key === key; });
        if (!entry) return;

        var data = await window.XmilStorage.read(key);
        if (!data) { updateStatus('ステートデータ読み込み失敗'); return; }

        // mounts キー→ファイル名マッピングを構築
        var lib = getLibrary();
        var mountNames = {};
        var mounts = entry.mounts || {};
        for (var sn in mounts) {
            if (mounts[sn]) {
                var libE = lib.find(function(e) { return e.key === mounts[sn]; });
                if (libE) mountNames[sn] = libE.name;
            }
        }
        // メタデータ JSON を末尾に付加: [xmst][json]["XMMT"][len32]
        var meta = JSON.stringify({ mounts: mountNames, hashes: entry.hashes || {} });
        var metaBytes = new TextEncoder().encode(meta);
        var trailer = new Uint8Array(metaBytes.length + 8); // json + "XMMT" + u32 len
        trailer.set(metaBytes, 0);
        trailer[metaBytes.length]     = 0x58; // 'X'
        trailer[metaBytes.length + 1] = 0x4D; // 'M'
        trailer[metaBytes.length + 2] = 0x4D; // 'M'
        trailer[metaBytes.length + 3] = 0x54; // 'T'
        var jl = metaBytes.length;
        trailer[metaBytes.length + 4] = jl & 0xFF;
        trailer[metaBytes.length + 5] = (jl >> 8) & 0xFF;
        trailer[metaBytes.length + 6] = (jl >> 16) & 0xFF;
        trailer[metaBytes.length + 7] = (jl >> 24) & 0xFF;

        var blob = new Blob([data, trailer], { type: 'application/octet-stream' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = (entry.name || 'state') + '.xmst';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async function importState(file) {
        if (!window.XmilStorage) { updateStatus('ストレージ未初期化'); return false; }
        updateStatus('ステートインポート中...');
        try {
            var buf = await file.arrayBuffer();
            var arr = new Uint8Array(buf);
            // magic check "XMST"
            if (arr.length < 8 || arr[0] !== 0x58 || arr[1] !== 0x4D ||
                arr[2] !== 0x53 || arr[3] !== 0x54) {
                updateStatus('ステートファイルではありません');
                return false;
            }

            // 末尾メタデータ抽出: [...xmst...][json]["XMMT"][len32]
            var mounts = {};
            var mNames = {};
            var hashes = {};
            var stateLen = arr.length; // C側に渡すバイナリ長
            if (arr.length >= 16) {
                var tOff = arr.length - 8;
                if (arr[tOff] === 0x58 && arr[tOff+1] === 0x4D &&
                    arr[tOff+2] === 0x4D && arr[tOff+3] === 0x54) {
                    var jl = arr[tOff+4] | (arr[tOff+5] << 8) | (arr[tOff+6] << 16) | (arr[tOff+7] << 24);
                    if (jl > 0 && jl <= tOff) {
                        var jsonStart = tOff - jl;
                        try {
                            var jsonStr = new TextDecoder().decode(arr.slice(jsonStart, tOff));
                            var meta = JSON.parse(jsonStr);
                            hashes = meta.hashes || {};
                            // ファイル名からライブラリキーを逆引き
                            var lib = getLibrary();
                            var mountNames = meta.mounts || {};
                            for (var sn in mountNames) {
                                mNames[sn] = mountNames[sn];
                                var libE = lib.find(function(e) { return e.name === mountNames[sn]; });
                                if (libE) mounts[sn] = libE.key;
                            }
                        } catch(e2) { console.warn('importState: meta parse failed', e2); }
                        stateLen = jsonStart; // メタ部分を除いた実データ長
                    }
                }
            }

            // Portable EMM 判定: ヘッダ flags bit2 を LE で読み取り
            var importPortable = false;
            if (arr.length >= 8) {
                var dv;
                if (arr instanceof Uint8Array) {
                    dv = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
                } else {
                    dv = new DataView(buf, 0, 8);
                }
                var importFlags = dv.getUint16(6, true); // LE
                importPortable = !!(importFlags & 0x04);  // STATE_FLAG_PORTABLE_EMM
            }

            var name = file.name.replace(/\.xmst$/i, '') || 'Imported';
            var key = 'state_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
            // メタ部分を除いた純粋なステートバイナリのみ保存
            await window.XmilStorage.write(key, buf.slice(0, stateLen));
            var list = getStateList();
            list.push({ key: key, name: name, time: new Date().toISOString(), size: stateLen, mounts: mounts, mountNames: mNames, hashes: hashes, portable: importPortable });
            saveStateList(list);
            updateStatus('ステートインポート完了: ' + name);
            return true;
        } catch(e) {
            console.error('importState failed:', e);
            updateStatus('ステートインポートエラー: ' + e.message);
            return false;
        }
    }

    // ステートリスト描画
    function renderStateList() {
        var el = document.getElementById('state-list');
        if (!el) return;
        var list = getStateList();
        if (list.length === 0) {
            el.innerHTML = '<div class="state-empty">セーブデータがありません</div>';
            return;
        }
        var lib = getLibrary();
        var html = '';
        for (var i = 0; i < list.length; i++) {
            var s = list[i];
            var sizeStr = s.size ? (s.size / 1024).toFixed(0) + 'KB' : '';
            var timeStr = '';
            try { timeStr = new Date(s.time).toLocaleString('ja-JP'); } catch(e) { timeStr = s.time || ''; }

            // マウントバッジ
            var badges = '';
            if (s.mounts) {
                for (var sn in s.mounts) {
                    if (s.mounts[sn]) {
                        var libEntry = lib.find(function(e) { return e.key === s.mounts[sn]; });
                        var label = libEntry ? libEntry.name : sn;
                        badges += '<span class="state-mount-badge">' + escapeHtml(sn.replace(/\d+$/, '') + ': ' + label) + '</span>';
                    }
                }
            }

            html += '<div class="state-row">' +
                '<div class="state-row-info">' +
                    '<div class="state-row-name">' + escapeHtml(s.name) + '</div>' +
                    '<div class="state-row-meta">' + escapeHtml(timeStr) + ' / ' + sizeStr + '</div>' +
                    (badges ? '<div class="state-row-mounts">' + badges + '</div>' : '') +
                '</div>' +
                '<div class="state-row-btns">' +
                    '<button class="state-btn-load" data-action="state-load" data-key="' + escapeHtml(s.key) + '">LOAD</button>' +
                    '<button data-action="state-rename" data-key="' + escapeHtml(s.key) + '">REN</button>' +
                    '<button data-action="state-download" data-key="' + escapeHtml(s.key) + '">DL</button>' +
                    '<button data-action="state-overwrite" data-key="' + escapeHtml(s.key) + '">SAVE</button>' +
                    '<button class="state-btn-del" data-action="state-delete" data-key="' + escapeHtml(s.key) + '">DEL</button>' +
                '</div>' +
            '</div>';
        }
        el.innerHTML = html;
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ----------------------------------------------------------------
    // バイナリ ↔ Base64 変換 (ROM用)
    // ----------------------------------------------------------------
    function arrayBufferToBase64(buffer) {
        var bytes = new Uint8Array(buffer);
        var binary = '';
        for (var i = 0; i < bytes.byteLength; i += 8192) {
            var slice = bytes.subarray(i, Math.min(i + 8192, bytes.byteLength));
            binary += String.fromCharCode.apply(null, slice);
        }
        return btoa(binary);
    }

    function base64ToUint8Array(base64) {
        var binary = atob(base64);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    // ----------------------------------------------------------------
    // localStorage: 設定の保存/復元
    // ----------------------------------------------------------------
    function saveSettings() {
        try {
            var settings = {
                romType: (function() {
                    var c = document.querySelector('input[name="rom-type"]:checked');
                    return c ? parseInt(c.value, 10) : 2;
                })(),
                dipHighres: elements.dipHighres  ? elements.dipHighres.checked  : false,
                dip2hd:     elements.dip2hd      ? elements.dip2hd.checked      : false,
                skipLine:      elements.skipLine      ? elements.skipLine.checked      : false,
                motorSound:    elements.motorSound    ? elements.motorSound.checked    : false,
                seekVolume:    elements.seekVolume    ? parseInt(elements.seekVolume.value, 10) : 80,
                joystickEnable: elements.joystickEnable ? elements.joystickEnable.checked : false,
                mouseEnable: elements.mouseEnable ? elements.mouseEnable.checked : false,
                fmEnable: elements.fmEnable ? elements.fmEnable.checked : true,
                statusToast: elements.statusToastEnable ? elements.statusToastEnable.checked : false,
                stateOverwrite: elements.stateOverwrite ? elements.stateOverwrite.checked : false,
                portableEmm: !!(function() { var cb = document.getElementById('cfg-portable-emm'); return cb && cb.checked; })(),
                keyMode: (function() {
                    var c = document.querySelector('input[name="key-mode"]:checked');
                    return c ? parseInt(c.value, 10) : 0;
                })(),
                libSort: currentLibrarySort
            };
            localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
        } catch(e) {
            console.warn('saveSettings failed:', e);
        }
    }

    function loadSettings() {
        try {
            var raw = localStorage.getItem(LS_SETTINGS);
            if (!raw) return;
            var s = JSON.parse(raw);
            if (s.romType && elements.romTypeRadios) {
                elements.romTypeRadios.forEach(function(r) {
                    r.checked = (parseInt(r.value, 10) === s.romType);
                });
            }
            if (elements.dipHighres)  elements.dipHighres.checked  = !!s.dipHighres;
            if (elements.dip2hd)      elements.dip2hd.checked      = !!s.dip2hd;
            if (elements.skipLine)       elements.skipLine.checked       = !!s.skipLine;
            if (elements.motorSound)     elements.motorSound.checked     = !!s.motorSound;
            if (s.seekVolume !== undefined && elements.seekVolume) {
                elements.seekVolume.value = s.seekVolume;
                if (elements.seekVolumeVal) elements.seekVolumeVal.textContent = s.seekVolume;
            }
            if (elements.joystickEnable) elements.joystickEnable.checked = !!s.joystickEnable;
            if (elements.mouseEnable) elements.mouseEnable.checked = !!s.mouseEnable;
            if (elements.fmEnable) elements.fmEnable.checked = (s.fmEnable !== undefined ? !!s.fmEnable : true);
            if (elements.statusToastEnable) elements.statusToastEnable.checked = (s.statusToast !== undefined ? !!s.statusToast : false);
            if (elements.stateOverwrite) elements.stateOverwrite.checked = !!s.stateOverwrite;
            var peCb = document.getElementById('cfg-portable-emm');
            if (peCb) peCb.checked = !!s.portableEmm;
            if (s.keyMode !== undefined && elements.keyModeRadios) {
                elements.keyModeRadios.forEach(function(r) {
                    r.checked = (parseInt(r.value, 10) === s.keyMode);
                });
            }
            if (s.libSort) {
                currentLibrarySort = s.libSort;
                var sortSel = document.getElementById('lib-sort-select');
                if (sortSel) sortSel.value = s.libSort;
            }
        } catch(e) {
            console.warn('loadSettings failed:', e);
        }
    }

    // ROM 用 localStorage helper
    function saveFile(key, name, arrayBuffer) {
        try {
            var MAX_BYTES = 3 * 1024 * 1024;
            if (arrayBuffer.byteLength > MAX_BYTES) return false;
            localStorage.setItem(key, JSON.stringify({ name: name, data: arrayBufferToBase64(arrayBuffer) }));
            return true;
        } catch(e) { return false; }
    }

    function loadFile(key) {
        try {
            var raw = localStorage.getItem(key);
            if (!raw) return null;
            var entry = JSON.parse(raw);
            return { name: entry.name, data: base64ToUint8Array(entry.data) };
        } catch(e) { return null; }
    }

    // ----------------------------------------------------------------
    // Web Audio ストリーミング
    // ----------------------------------------------------------------
    function getAudioLatency() {
        return Math.floor((window.xmilSampleRate || 44100) * 0.2) * 2;
    }

    // AudioWorklet プロセッサを Blob URL で生成
    function createWorkletBlobURL() {
        var code = [
            'class XmilAudioProcessor extends AudioWorkletProcessor {',
            '  constructor(options) {',
            '    super();',
            '    var sr = options.processorOptions && options.processorOptions.sampleRate || 44100;',
            '    this.bufSize = sr * 2 * 2;',
            '    this.buf = new Float32Array(this.bufSize);',
            '    this.writePos = 0;',
            '    this.readPos = 0;',
            '    this.buffering = true;',
            '    this.latencyTarget = Math.floor(sr * 0.2) * 2;',
            '    this.overruns = 0;',
            '    this.underruns = 0;',
            '    this.port.onmessage = this._onMessage.bind(this);',
            '  }',
            '  _onMessage(e) {',
            '    if (e.data.type === "audio") this._append(e.data.samples);',
            '    else if (e.data.type === "reset") {',
            '      this.writePos = 0; this.readPos = 0;',
            '      this.buffering = true; this.buf.fill(0);',
            '      this.overruns = 0; this.underruns = 0;',
            '    } else if (e.data.type === "getStats") {',
            '      this.port.postMessage({ type: "stats",',
            '        overruns: this.overruns, underruns: this.underruns });',
            '    }',
            '  }',
            '  _append(data) {',
            '    var len = data.length, buf = this.buf, size = this.bufSize;',
            '    var wp = this.writePos, rp = this.readPos;',
            '    var used = (wp - rp + size) % size;',
            '    var free = size - used - 2;',
            '    if (len > free) {',
            '      this.overruns++;',
            '      len = free > 0 ? free : 0;',
            '      if (len === 0) return;',
            '      data = data.subarray(0, len);',
            '    }',
            '    if (wp + len <= size) { buf.set(data, wp); }',
            '    else { var f = size - wp; buf.set(data.subarray(0, f), wp); buf.set(data.subarray(f), 0); }',
            '    this.writePos = (wp + len) % size;',
            '  }',
            '  process(inputs, outputs) {',
            '    var outL = outputs[0][0], outR = outputs[0][1], n = outL.length;',
            '    var buf = this.buf, size = this.bufSize, rp = this.readPos, wp = this.writePos;',
            '    if (this.buffering) {',
            '      var avail = (wp - rp + size) % size;',
            '      if (avail >= this.latencyTarget) {',
            '        this.readPos = rp = (wp - this.latencyTarget + size) % size;',
            '        this.buffering = false;',
            '      } else { outL.fill(0); outR.fill(0); return true; }',
            '    }',
            '    for (var i = 0; i < n; i++) {',
            '      if (((wp - rp + size) % size) >= 2) {',
            '        outL[i] = buf[rp]; outR[i] = buf[rp + 1]; rp = (rp + 2) % size;',
            '      } else { outL[i] = outR[i] = 0; this.underruns++; }',
            '    }',
            '    this.readPos = rp;',
            '    if (((wp - rp + size) % size) < 2) {',
            '      this.buffering = true;',
            '    }',
            '    return true;',
            '  }',
            '}',
            'registerProcessor("xmil-audio-processor", XmilAudioProcessor);'
        ].join('\n');
        return URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
    }

    // WAV デコード待ちバッファの処理（AudioWorklet / SPN 共通）
    function decodePendingWavBuffers(ctx) {
        if (window.xmilWavPending) {
            window.xmilWavPending.forEach(function(ab, num) {
                if (!ab) return;
                ctx.decodeAudioData(ab,
                    function(buf) {
                        if (!window.xmilWavBufs) window.xmilWavBufs = [];
                        window.xmilWavBufs[num] = buf;
                    },
                    function(err) { console.warn('[xmil wav] decode error slot=' + num + ': ' + err); }
                );
            });
            window.xmilWavPending = null;
        }
    }

    // ScriptProcessorNode フォールバック（AudioWorklet 非対応ブラウザ用）
    function setupScriptProcessor(ctx) {
        if (window.xmilAudioProcessor) return;
        var AUDIO_LATENCY = getAudioLatency();
        var proc = ctx.createScriptProcessor(2048, 0, 2);

        proc.onaudioprocess = function(e) {
            var outL = e.outputBuffer.getChannelData(0);
            var outR = e.outputBuffer.getChannelData(1);
            var n    = e.outputBuffer.length;
            var pcm  = window.xmilPcm;
            var size = window.xmilPcmSize;

            if (!pcm) {
                for (var j = 0; j < n; j++) { outL[j] = outR[j] = 0; }
                return;
            }

            var wp = window.xmilPcmWrite;
            var rp = window.xmilPcmRead;

            if (window.xmilAudioBuffering) {
                for (var j = 0; j < n; j++) { outL[j] = outR[j] = 0; }
                var avail = (wp - rp + size) % size;
                if (avail >= AUDIO_LATENCY) {
                    window.xmilPcmRead = (wp - AUDIO_LATENCY + size * 2) % size;
                    window.xmilAudioBuffering = false;
                }
                return;
            }

            var underflows = 0;
            for (var i = 0; i < n; i++) {
                if ((wp - rp + size) % size >= 2) {
                    outL[i] = pcm[rp]     / 32768.0;
                    outR[i] = pcm[rp + 1] / 32768.0;
                    rp = (rp + 2) % size;
                } else {
                    outL[i] = outR[i] = 0;
                    underflows++;
                }
            }
            window.xmilPcmRead = rp;
            if (underflows >= n) {
                window.xmilAudioBuffering = true;
                window.xmilPcmRead = wp;
            }
        };

        var master = ctx.createGain();
        master.connect(ctx.destination);
        proc.connect(master);
        window.xmilMasterGain = master;
        window.xmilAudioProcessor = proc;
        audioUnlocked = true;
        decodePendingWavBuffers(ctx);
    }

    // AudioWorklet パス
    async function setupAudioWorklet(ctx) {
        var blobURL = createWorkletBlobURL();
        try {
            await ctx.audioWorklet.addModule(blobURL);


            var sr = window.xmilSampleRate || 44100;
            var node = new AudioWorkletNode(ctx, 'xmil-audio-processor', {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [2],
                processorOptions: { sampleRate: sr }
            });

            var master = ctx.createGain();
            master.connect(ctx.destination);
            node.connect(master);
            window.xmilMasterGain = master;
            window.xmilAudioProcessor = node;
            audioUnlocked = true;

            // フレーム末フラッシュ関数
            var port = node.port;
            window.xmilFlushAudio = function() {
                var pcm = window.xmilPcm;
                if (!pcm) return;
                var size = window.xmilPcmSize;
                var wp = window.xmilPcmWrite;
                var rp = window.xmilPcmRead;
                if (wp === rp) return;

                var count = (wp - rp + size) % size;
                var f32 = new Float32Array(count);
                for (var i = 0; i < count; i++) {
                    f32[i] = pcm[(rp + i) % size] / 32768.0;
                }
                try {
                    port.postMessage({ type: 'audio', samples: f32 }, [f32.buffer]);
                    window.xmilPcmRead = wp;
                } catch(e) {
                    // context close 直後等: 次フレームで再試行
                }
            };

            decodePendingWavBuffers(ctx);
            console.log('[xmil audio] AudioWorklet initialized');
        } catch(e) {
            console.warn('[xmil audio] AudioWorklet failed, falling back to ScriptProcessor:', e);
            setupScriptProcessor(ctx);
        } finally {
            URL.revokeObjectURL(blobURL);
        }
    }

    var xmilAudioSetupPromise = null;

    function setupAudioStream() {
        var ctx = window.audioContext;
        if (!ctx) {
            try {
                var sr = window.xmilSampleRate || 44100;
                ctx = window.audioContext = new (window.AudioContext || window.webkitAudioContext)({sampleRate: sr});
            } catch(e) {
                console.warn('AudioContext create failed:', e);
                return;
            }
        }

        var doSetup = function() {
            if (window.xmilAudioProcessor) return;
            if (xmilAudioSetupPromise) return;
            window.xmilAudioBuffering = true;

            if (ctx.audioWorklet && typeof ctx.audioWorklet.addModule === 'function') {
                xmilAudioSetupPromise = setupAudioWorklet(ctx).finally(function() {
                    xmilAudioSetupPromise = null;
                });
            } else {
                setupScriptProcessor(ctx);
            }
        };

        if (ctx.state === 'suspended') {
            ctx.resume().then(doSetup).catch(function(e) { console.warn('resume failed:', e); });
        } else {
            doSetup();
        }
    }

    function reinitAudioForReset() {
        window.xmilAudioBuffering = true;
        if (window.xmilPcm) window.xmilPcm.fill(0);
        window.xmilPcmWrite = 0;
        window.xmilPcmRead  = 0;
        // AudioWorklet にリセット通知
        if (window.xmilAudioProcessor && window.xmilAudioProcessor.port) {
            window.xmilAudioProcessor.port.postMessage({ type: 'reset' });
        }
    }

    function testAudio() {
        if (!window.xmilPcm) {
            var sr0 = window.xmilSampleRate || 44100;
            window.xmilPcmSize  = sr0 * 2 * 2;
            window.xmilPcm      = new Int16Array(window.xmilPcmSize);
            window.xmilPcmWrite = 0;
            window.xmilPcmRead  = 0;
        }
        setupAudioStream();
        var sampleRate = window.xmilSampleRate || 44100;
        var freq = 440;
        var samples = Math.floor(sampleRate * 0.5);
        var pcm  = window.xmilPcm;
        var size = window.xmilPcmSize;
        var wp   = window.xmilPcmWrite;
        for (var i = 0; i < samples; i++) {
            var v = Math.round(Math.sin(2 * Math.PI * freq * i / sampleRate) * 20000);
            pcm[wp]     = v;
            pcm[wp + 1] = v;
            wp = (wp + 2) % size;
        }
        window.xmilPcmWrite = wp;
        updateStatus('テスト音再生中 (440Hz)');
    }

    // ----------------------------------------------------------------
    // ソフトウェアキーボード
    // ----------------------------------------------------------------
    var skActivePointers = new Map(); // pointerId → { vk, el }
    var skOneShotMods = {};           // vk(string) → true/false
    var skToggleState = {};           // vk(number) → true/false
    var skShiftActive = false;
    var skKanaActive  = false;

    // VK → { s: shift表記, k: カナ表記, ks: カナ+Shift表記 }
    var SK_FACE_MAP = {
        // 数字行
        0x31: { s:'!', k:'ヌ' },  0x32: { s:'"', k:'フ' },
        0x33: { s:'#', k:'ア', ks:'ァ' },  0x34: { s:'$', k:'ウ', ks:'ゥ' },
        0x35: { s:'%', k:'エ', ks:'ェ' },  0x36: { s:'&', k:'オ', ks:'ォ' },
        0x37: { s:"'", k:'ヤ', ks:'ャ' },  0x38: { s:'(', k:'ユ', ks:'ュ' },
        0x39: { s:')', k:'ヨ', ks:'ョ' },  0x30: { k:'ワ', ks:'ヲ' },
        0xBD: { s:'=', k:'ホ', ks:'ー' },  0xDE: { s:'~', k:'ヘ' },
        0xDC: { s:'|', k:'ー' },
        // QWERTY 行
        0x51: { k:'タ' },  0x57: { k:'テ' },  0x45: { k:'イ', ks:'ィ' },
        0x52: { k:'ス' },  0x54: { k:'カ' },  0x59: { k:'ン' },
        0x55: { k:'ナ' },  0x49: { k:'ニ' },  0x4F: { k:'ラ' },  0x50: { k:'セ' },
        0xC0: { s:'`', k:'゛' },  0xDB: { s:'{', k:'゜', ks:'「' },
        // ホーム行
        0x41: { k:'チ' },  0x53: { k:'ト' },  0x44: { k:'シ' },  0x46: { k:'ハ' },
        0x47: { k:'キ' },  0x48: { k:'ク' },  0x4A: { k:'マ' },  0x4B: { k:'ノ' },
        0x4C: { k:'リ' },
        0xBA: { s:'*', k:'ケ' },  0xBB: { s:'+', k:'レ' },
        0xDD: { s:'}', k:'ム', ks:'」' },
        // 下段
        0x5A: { k:'ツ', ks:'ッ' },  0x58: { k:'サ' },  0x43: { k:'ソ' },
        0x56: { k:'ヒ' },  0x42: { k:'コ' },  0x4E: { k:'ミ' },  0x4D: { k:'モ' },
        0xBC: { s:'<', k:'ネ', ks:'、' },  0xBE: { s:'>', k:'ル', ks:'。' },
        0xBF: { s:'?', k:'メ', ks:'・' },  0xE2: { k:'ロ' }
    };

    // 初期化: 各キーの元ラベルを data-label に保存
    function skInitKeyFaces() {
        document.querySelectorAll('.x1-key[data-vk]').forEach(function(el) {
            if (!el.dataset.latch && !el.dataset.action) {
                el.dataset.label = el.textContent.trim();
            }
        });
    }

    // SHIFT / カナ状態に応じてキーフェイスを更新
    function skUpdateKeyFaces() {
        document.querySelectorAll('.x1-key[data-label]').forEach(function(el) {
            var vk = parseInt(el.dataset.vk, 16);
            var m = SK_FACE_MAP[vk];
            if (!m) return;
            var label = el.dataset.label;
            if (skKanaActive && skShiftActive && m.ks) label = m.ks;
            else if (skKanaActive && m.k) label = m.k;
            else if (skShiftActive && m.s) label = m.s;
            el.textContent = label;
        });
    }

    function skKeyDown(vk) {
        if (module && module._js_key_down) module._js_key_down(vk);
    }
    function skKeyUp(vk) {
        if (module && module._js_key_up) module._js_key_up(vk);
    }

    function skHandleAction(action) {
        if (!module) return;
        // SHIFT + テープ制御: F6/F7/F8 を SHIFT 押下状態で送る
        // CHR_TBL1 により C_AR(頭出し巻戻)/C_EJ(イジェクト)/C_AF(頭出し早送) になる
        if (skShiftActive) {
            var fVk = null, msg = null;
            if (action === 'cmt_rew')  { fVk = 0x75; msg = 'CMT 頭出し巻き戻し'; }
            if (action === 'cmt_stop') { fVk = 0x76; msg = 'CMT イジェクト'; }
            if (action === 'cmt_ff')   { fVk = 0x77; msg = 'CMT 頭出し早送り'; }
            if (fVk) {
                skKeyDown(fVk);
                if (msg) updateStatus(msg);
                // SCPU がキーを認識するまで数フレーム保持してから離す
                setTimeout(function() {
                    skKeyUp(fVk);
                    skReleaseOneShot();
                }, 150);
            }
            return;
        }
        if (action === 'cmt_rew'  && module._js_cmt_rew)  { module._js_cmt_rew();  updateStatus('CMT 巻き戻し'); }
        if (action === 'cmt_stop' && module._js_cmt_stop) { module._js_cmt_stop(); updateStatus('CMT 停止');     }
        if (action === 'cmt_play' && module._js_cmt_play) { module._js_cmt_play(); updateStatus('CMT 再生');     }
        if (action === 'cmt_ff'   && module._js_cmt_ff)   { module._js_cmt_ff();   updateStatus('CMT 早送り');   }
    }

    function skHandleOneShotDown(key, vk) {
        var vkStr = String(vk);
        if (skOneShotMods[vkStr]) {
            skKeyUp(vk);
            skOneShotMods[vkStr] = false;
            key.classList.remove('active');
            if (vk === 0x10) { skShiftActive = false; skUpdateKeyFaces(); }
        } else {
            skKeyDown(vk);
            skOneShotMods[vkStr] = true;
            key.classList.add('active');
            if (vk === 0x10) { skShiftActive = true; skUpdateKeyFaces(); }
        }
    }

    function skReleaseOneShot() {
        var faceChanged = false;
        for (var vkStr in skOneShotMods) {
            if (skOneShotMods[vkStr]) {
                var vk = parseInt(vkStr, 10);
                skKeyUp(vk);
                skOneShotMods[vkStr] = false;
                if (vk === 0x10) { skShiftActive = false; faceChanged = true; }
                var hex = '0x' + vk.toString(16);
                document.querySelectorAll('.x1-key[data-vk="' + hex + '"]').forEach(function(el) {
                    el.classList.remove('active');
                });
            }
        }
        if (faceChanged) skUpdateKeyFaces();
    }

    function skHandleToggleDown(key, vk) {
        skToggleState[vk] = !skToggleState[vk];
        if (skToggleState[vk]) {
            skKeyDown(vk);
            // CAPS(0x14)/KANA(0x15) は C++ 側が内部トグルなので即 up
            if (vk === 0x14 || vk === 0x15) skKeyUp(vk);
            // GRP(0x12) は押しっぱなし（KEY_TBL 管理）なので up しない
        } else {
            // CAPS/KANA は再度 down+up でトグル解除
            if (vk === 0x14 || vk === 0x15) { skKeyDown(vk); skKeyUp(vk); }
            // GRP は up で解除
            else skKeyUp(vk);
        }
        if (vk === 0x15) { skKanaActive = skToggleState[vk]; skUpdateKeyFaces(); }
        var hex = '0x' + vk.toString(16);
        document.querySelectorAll('.x1-key[data-vk="' + hex + '"]').forEach(function(el) {
            el.classList.toggle('active', skToggleState[vk]);
        });
    }

    function skReleaseAllKeys() {
        skActivePointers.forEach(function(info) {
            skKeyUp(info.vk);
            info.el.classList.remove('pressed');
        });
        skActivePointers.clear();
        skReleaseOneShot();
        // GRP(0x12) ホールド解除
        if (skToggleState[0x12]) {
            skKeyUp(0x12);
            skToggleState[0x12] = false;
            document.querySelectorAll('.x1-key[data-vk="0x12"]').forEach(function(el) {
                el.classList.remove('active');
            });
        }
        document.querySelectorAll('.x1-key.pressed').forEach(function(el) {
            el.classList.remove('pressed');
        });
    }

    function onSkPointerDown(e) {
        e.preventDefault();
        var key = e.target.closest('.x1-key');
        if (!key) return;
        key.setPointerCapture(e.pointerId);

        // テープ制御キー
        if (key.dataset.action) { skHandleAction(key.dataset.action); return; }

        var vk = parseInt(key.dataset.vk, 16);

        // 修飾キー
        if (key.dataset.latch === 'oneshot') { skHandleOneShotDown(key, vk); return; }
        if (key.dataset.latch === 'toggle')  { skHandleToggleDown(key, vk); return; }

        // 通常キー
        skActivePointers.set(e.pointerId, { vk: vk, el: key });
        skKeyDown(vk);
        key.classList.add('pressed');
    }

    function onSkPointerUp(e) {
        var info = skActivePointers.get(e.pointerId);
        if (info) {
            skKeyUp(info.vk);
            info.el.classList.remove('pressed');
            skActivePointers.delete(e.pointerId);
            skReleaseOneShot();
        }
    }

    function toggleSoftKeyboard() {
        var kb = document.getElementById('soft-keyboard');
        var btn = document.getElementById('sk-toggle');
        if (!kb) return;
        if (!kb.classList.contains('hidden')) {
            skReleaseAllKeys();
        }
        kb.classList.toggle('hidden');
        if (btn) btn.classList.toggle('on', !kb.classList.contains('hidden'));
    }

    function toggleNumpad() {
        var np  = document.getElementById('sk-numpad');
        var btn = document.getElementById('sk-numpad-toggle');
        if (np) np.classList.toggle('hidden');
        if (btn) btn.classList.toggle('on', np && !np.classList.contains('hidden'));
    }

    // ----------------------------------------------------------------
    // 初期化
    // ----------------------------------------------------------------
    function init() {
        elements.loading      = document.getElementById('loading');
        elements.mainContent  = document.getElementById('main-content');
        elements.btnStart     = document.getElementById('btn-start');
        elements.btnStop      = document.getElementById('btn-stop');
        elements.btnReset     = document.getElementById('btn-reset');
        elements.btnTestAudio = document.getElementById('btn-test-audio');
        elements.fileRomX1  = document.getElementById('file-rom-x1');
        elements.fileRomX1t = document.getElementById('file-rom-x1t');
        elements.fileFntAnk8  = document.getElementById('file-fnt-ank8');
        elements.fileFntAnk16 = document.getElementById('file-fnt-ank16');
        elements.fileFntKnj   = document.getElementById('file-fnt-knj');
        // 新FDDパネル要素
        elements.fddBay      = [document.getElementById('fdd-bay-0'),      document.getElementById('fdd-bay-1')];
        elements.fddLed      = [document.getElementById('fdd-led-0'),      document.getElementById('fdd-led-1')];
        elements.fddDiskName = [document.getElementById('fdd-disk-name-0'), document.getElementById('fdd-disk-name-1')];
        elements.fddEject    = [document.getElementById('fdd-eject-0'),    document.getElementById('fdd-eject-1')];
        elements.fddHwEject  = [document.getElementById('fdd-hw-eject-0'), document.getElementById('fdd-hw-eject-1')];
        // コントロールオーバーレイ
        elements.ctrlPower   = document.getElementById('ctrl-power');
        elements.ctrlIpl     = document.getElementById('ctrl-ipl');
        elements.ctrlNmi     = document.getElementById('ctrl-nmi');
        // CMT
        elements.btnCmtEject  = document.getElementById('btn-cmt-eject');
        elements.btnCmtPlay   = document.getElementById('btn-cmt-play');
        elements.btnCmtStop   = document.getElementById('btn-cmt-stop');
        elements.btnCmtFf     = document.getElementById('btn-cmt-ff');
        elements.btnCmtRew    = document.getElementById('btn-cmt-rew');
        elements.cmtName      = document.getElementById('cmt-name');
        elements.statusText   = document.getElementById('status-text');
        elements.fpsText      = document.getElementById('fps-text');
        elements.canvas       = document.getElementById('canvas');
        elements.btnScreenshot = document.getElementById('btn-screenshot');
        elements.romTypeRadios = document.querySelectorAll('input[name="rom-type"]');
        elements.dipHighres   = document.getElementById('dip-highres');
        elements.dip2hd       = document.getElementById('dip-2hd');
        elements.skipLine      = document.getElementById('skip-line');
        elements.motorSound    = document.getElementById('motor-sound');
        elements.seekVolume    = document.getElementById('seek-volume');
        elements.seekVolumeVal = document.getElementById('seek-volume-val');
        elements.seekVolumeRow = document.getElementById('cfg-seek-vol-row');
        elements.joystickEnable = document.getElementById('joystick-enable');
        elements.mouseEnable = document.getElementById('mouse-enable');
        elements.fmEnable = document.getElementById('fm-enable');
        elements.statusToastEnable = document.getElementById('status-toast-enable');
        elements.keyModeRadios = document.querySelectorAll('input[name="key-mode"]');
        elements.swDiskToggle = document.getElementById('sw-disk-toggle');
        elements.swResToggle  = document.getElementById('sw-res-toggle');
        elements.stateOverwrite = document.getElementById('state-overwrite-mode');

        // ライブラリ追加用 file input
        var fileAddToLibrary = document.getElementById('file-add-to-library');
        if (fileAddToLibrary) {
            fileAddToLibrary.addEventListener('change', async function(e) {
                var files = e.target.files;
                for (var i = 0; i < files.length; i++) {
                    await addToLibrary(files[i]);
                }
                e.target.value = '';  // 同ファイル再選択できるようリセット
            });
        }

        // ライブラリパネルフィルタ
        var filterBtns = document.querySelectorAll('.lib-filter');
        filterBtns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                filterBtns.forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                renderLibraryList();
            });
        });

        // ライブラリリスト: イベント委譲 (innerHTML 再生成のたびにリスナーを付け直さない)
        // ボタンは data-action / data-key / data-slot / data-name で動作を指定
        var libListEl = document.getElementById('library-list');
        if (libListEl) {
            libListEl.addEventListener('click', function(e) {
                var btn = e.target.closest('[data-action]');
                if (!btn) return;
                var action = btn.dataset.action;
                var key    = btn.dataset.key;
                var slot   = btn.dataset.slot;
                var name   = btn.dataset.name;
                if (action === 'mount')    mountFromLibrary(key, slot);
                if (action === 'download') downloadFromLibrary(key, name);
                if (action === 'edit') {
                    if (window.XmilDiskEditor) window.XmilDiskEditor.openEditor(key);
                }
                if (action === 'delete')   deleteFromLibrary(key);
                if (action === 'toggle-fav') toggleFavorite(key);
                if (action === 'drive-save') {
                    if (window.XmilDrive) window.XmilDrive.saveByKey(key);
                }
                // EMM 10スロットビュー用アクション
                if (action === 'emm-create') onEmmSlotCreate(parseInt(btn.dataset.slot, 10));
                if (action === 'emm-export') onEmmSlotExport(parseInt(btn.dataset.slot, 10));
                if (action === 'emm-import') onEmmSlotImport(parseInt(btn.dataset.slot, 10));
                if (action === 'emm-delete') onEmmSlotDelete(parseInt(btn.dataset.slot, 10));
                if (action === 'emm-insert') onEmmSlotInsert(parseInt(btn.dataset.slot, 10));
                if (action === 'emm-eject') onEmmSlotEject(parseInt(btn.dataset.slot, 10));
                if (action === 'emm-edit') {
                    var slotNum = parseInt(btn.dataset.slot, 10);
                    var emmFileName = 'EMM' + slotNum + '.MEM';
                    var emmEntry = getLibrary().find(function(e) { return e.type === 'emm' && e.name === emmFileName; });
                    if (emmEntry && window.XmilDiskEditor) window.XmilDiskEditor.openEditor(emmEntry.key);
                }
            });
        }

        // ライブラリ: 検索入力
        var libSearchInput = document.getElementById('lib-search-input');
        if (libSearchInput) {
            libSearchInput.addEventListener('input', function() {
                currentLibrarySearch = libSearchInput.value;
                renderLibraryList();
            });
        }
        // ライブラリ: ソートセレクト
        var libSortSelect = document.getElementById('lib-sort-select');
        if (libSortSelect) {
            libSortSelect.addEventListener('change', function() {
                currentLibrarySort = libSortSelect.value;
                renderLibraryList();
                saveSettings();
            });
        }
        // ライブラリ: お気に入りフィルタ
        var libFavFilter = document.getElementById('lib-fav-filter');
        if (libFavFilter) {
            libFavFilter.addEventListener('click', function() {
                currentFavoritesOnly = !currentFavoritesOnly;
                libFavFilter.classList.toggle('active', currentFavoritesOnly);
                libFavFilter.textContent = currentFavoritesOnly ? '★' : '☆';
                renderLibraryList();
            });
        }

        // エミュレータ制御ボタン
        if (elements.btnStart)     elements.btnStart.addEventListener('click', onStartClick);
        if (elements.btnStop)      elements.btnStop.addEventListener('click', onStopClick);
        if (elements.btnReset)     elements.btnReset.addEventListener('click', onResetClick);
        if (elements.btnTestAudio) elements.btnTestAudio.addEventListener('click', onTestAudioClick);
        if (elements.fileRomX1)    elements.fileRomX1.addEventListener('change', function(e) { onRomFileChange('x1',  e); });
        if (elements.fileRomX1t)   elements.fileRomX1t.addEventListener('change', function(e) { onRomFileChange('x1t', e); });
        if (elements.fileFntAnk8)  elements.fileFntAnk8.addEventListener('change',  function(e) { onFontFileChange('ank8',  e); });
        if (elements.fileFntAnk16) elements.fileFntAnk16.addEventListener('change', function(e) { onFontFileChange('ank16', e); });
        if (elements.fileFntKnj)   elements.fileFntKnj.addEventListener('change',   function(e) { onFontFileChange('knj',   e); });
        var fntClearAnk8  = document.getElementById('fnt-clear-ank8');
        var fntClearAnk16 = document.getElementById('fnt-clear-ank16');
        var fntClearKnj   = document.getElementById('fnt-clear-knj');
        if (fntClearAnk8)  fntClearAnk8.addEventListener('click',  function() { clearFont('ank8');  });
        if (fntClearAnk16) fntClearAnk16.addEventListener('click', function() { clearFont('ank16'); });
        if (fntClearKnj)   fntClearKnj.addEventListener('click',   function() { clearFont('knj');   });
        var romClearX1  = document.getElementById('rom-clear-x1');
        var romClearX1t = document.getElementById('rom-clear-x1t');
        if (romClearX1)  romClearX1.addEventListener('click',  function() { clearRom('x1');  });
        if (romClearX1t) romClearX1t.addEventListener('click',  function() { clearRom('x1t'); });

        // コントロールボタン
        if (elements.ctrlPower)   elements.ctrlPower.addEventListener('click',   onPowerToggle);
        if (elements.ctrlIpl)     elements.ctrlIpl.addEventListener('click',     onIplResetClick);
        if (elements.ctrlNmi)     elements.ctrlNmi.addEventListener('click',     onNmiResetClick);

        // ハードウェアトグルスイッチ
        if (elements.swDiskToggle) elements.swDiskToggle.addEventListener('click', onDiskTypeToggle);
        if (elements.swResToggle)  elements.swResToggle.addEventListener('click',  onResolutionToggle);

        // 新FDDパネルのイジェクトボタン
        for (var di = 0; di < 2; di++) {
            (function(d) {
                if (elements.fddEject[d])   elements.fddEject[d].addEventListener('click',   function() { ejectSlot('drive' + d).catch(function(e) { console.error('eject failed:', e); }); });
                if (elements.fddHwEject[d]) elements.fddHwEject[d].addEventListener('click', function() { ejectSlot('drive' + d).catch(function(e) { console.error('eject failed:', e); }); });
            })(di);
        }

        // HDD イジェクトボタン
        for (var hi = 0; hi < 2; hi++) {
            (function(h) {
                var hddEjectBtn = document.getElementById('btn-hdd' + h + '-eject');
                if (hddEjectBtn) hddEjectBtn.addEventListener('click', function() { ejectSlot(h === 0 ? 'hdd0' : 'hdd1').catch(function(e) { console.error('eject failed:', e); }); });
            })(hi);
        }

        // ステートセーブ/ロード ボタン
        var stateQuickSave = document.getElementById('state-quick-save');
        var stateQuickLoad = document.getElementById('state-quick-load');
        var stateOpenPanel = document.getElementById('state-open-panel');
        var stateCloseBtn  = document.getElementById('state-close-btn');
        var stateNewSave    = document.getElementById('state-new-save');
        var stateImportBtn  = document.getElementById('state-import-btn');
        var stateImportFile = document.getElementById('state-import-file');
        var stateDeleteAll  = document.getElementById('state-delete-all');
        var statePanel      = document.getElementById('state-panel');
        var stateListEl     = document.getElementById('state-list');

        if (stateQuickSave) stateQuickSave.addEventListener('click', function() { quickSave(); });
        if (stateQuickLoad) stateQuickLoad.addEventListener('click', function() { quickLoad(); });
        function muteAudio() {
            if (window.xmilMasterGain) window.xmilMasterGain.gain.value = 0;
        }
        function unmuteAudio() {
            if (window.xmilMasterGain) window.xmilMasterGain.gain.value = 1;
        }
        if (stateOpenPanel) stateOpenPanel.addEventListener('click', function() {
            if (statePanel) { statePanel.classList.remove('hidden'); muteAudio(); renderStateList(); }
        });
        if (stateCloseBtn) stateCloseBtn.addEventListener('click', function() {
            if (statePanel) statePanel.classList.add('hidden');
            unmuteAudio();
        });
        if (statePanel) statePanel.addEventListener('click', function(e) {
            if (e.target === statePanel) { statePanel.classList.add('hidden'); unmuteAudio(); }
        });
        if (stateNewSave) stateNewSave.addEventListener('click', async function() {
            var name = prompt('セーブ名:', new Date().toLocaleString('ja-JP'));
            if (name === null) return;
            await saveState(name || new Date().toLocaleString('ja-JP'));
            renderStateList();
        });
        if (stateDeleteAll) stateDeleteAll.addEventListener('click', async function() {
            if (!confirm('すべてのステートセーブを削除しますか?')) return;
            await deleteAllStates();
            renderStateList();
        });
        if (stateImportBtn) stateImportBtn.addEventListener('click', function() {
            if (stateImportFile) stateImportFile.click();
        });
        if (stateImportFile) stateImportFile.addEventListener('change', async function() {
            if (this.files && this.files[0]) {
                await importState(this.files[0]);
                this.value = '';
                renderStateList();
            }
        });

        // ステートリスト: イベント委譲
        if (stateListEl) {
            stateListEl.addEventListener('click', async function(e) {
                var btn = e.target.closest('[data-action]');
                if (!btn) return;
                var action = btn.dataset.action;
                var key    = btn.dataset.key;
                if (action === 'state-load') {
                    await loadState(key);
                    if (statePanel) statePanel.classList.add('hidden');
                    unmuteAudio();
                }
                if (action === 'state-overwrite') {
                    if (!confirm('このステートを上書きしますか?')) return;
                    await overwriteState(key);
                    renderStateList();
                }
                if (action === 'state-rename') {
                    var list = getStateList();
                    var entry = list.find(function(e) { return e.key === key; });
                    var newName = prompt('新しい名前:', entry ? entry.name : '');
                    if (newName === null || newName === '') return;
                    renameState(key, newName);
                    renderStateList();
                }
                if (action === 'state-download') {
                    await downloadState(key);
                }
                if (action === 'state-delete') {
                    if (!confirm('このステートを削除しますか?')) return;
                    await deleteState(key);
                    renderStateList();
                }
            });
        }

        // CMT トランスポート
        var deckTransport = {
            'cdeck-rew':  function() { if (module && module._js_cmt_rew)  { module._js_cmt_rew();  updateStatus('CMT 巻き戻し'); } },
            'cdeck-stop': function() { if (module && module._js_cmt_stop) { module._js_cmt_stop(); updateStatus('CMT 停止');     } },
            'cdeck-play': function() { if (module && module._js_cmt_play) { module._js_cmt_play(); updateStatus('CMT 再生');     } },
            'cdeck-ff':   function() { if (module && module._js_cmt_ff)   { module._js_cmt_ff();   updateStatus('CMT 早送り');   } }
        };
        Object.keys(deckTransport).forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('click', deckTransport[id]);
        });
        var cdEject = document.getElementById('cdeck-eject');
        if (cdEject) cdEject.addEventListener('click', function() { ejectSlot('cmt').catch(function(e) { console.error('eject failed:', e); }); });

        // CMT ボタン (後方互換)
        if (elements.btnCmtEject) elements.btnCmtEject.addEventListener('click', function() { ejectSlot('cmt').catch(function(e) { console.error('eject failed:', e); }); });
        if (elements.btnCmtPlay)  elements.btnCmtPlay.addEventListener('click',  function() { if (module && module._js_cmt_play)  { module._js_cmt_play();  updateStatus('CMT 再生');     } });
        if (elements.btnCmtStop)  elements.btnCmtStop.addEventListener('click',  function() { if (module && module._js_cmt_stop)  { module._js_cmt_stop();  updateStatus('CMT 停止');     } });
        if (elements.btnCmtFf)    elements.btnCmtFf.addEventListener('click',   function() { if (module && module._js_cmt_ff)    { module._js_cmt_ff();    updateStatus('CMT 早送り');   } });
        if (elements.btnCmtRew)   elements.btnCmtRew.addEventListener('click',  function() { if (module && module._js_cmt_rew)   { module._js_cmt_rew();   updateStatus('CMT 巻き戻し'); } });

        // ----------------------------------------------------------------
        // onclick → addEventListener 明示マップ（CSP 対応: unsafe-inline 排除）
        // shell.html 側の onclick 属性を削除し、ここで addEventListener を設定する
        // ----------------------------------------------------------------
        var _btnMap = [
            { id: 'fdd-open-0',         fn: function() { openFddLibrary(0); } },
            { id: 'fdd-open-1',         fn: function() { openFddLibrary(1); } },
            { id: 'hdd-open-0',         fn: function() { openHddLibrary(0); } },
            { id: 'hdd-open-1',         fn: function() { openHddLibrary(1); } },
            { id: 'cdeck-insert',       fn: function() { openCmtLibrary(); } },
            { id: 'btn-rom-x1-open',    fn: function() { var el = document.getElementById('file-rom-x1');   if (el) el.click(); } },
            { id: 'btn-rom-x1t-open',   fn: function() { var el = document.getElementById('file-rom-x1t');  if (el) el.click(); } },
            { id: 'btn-fnt-ank8-open',  fn: function() { var el = document.getElementById('file-fnt-ank8'); if (el) el.click(); } },
            { id: 'btn-fnt-ank16-open', fn: function() { var el = document.getElementById('file-fnt-ank16');if (el) el.click(); } },
            { id: 'btn-fnt-knj-open',   fn: function() { var el = document.getElementById('file-fnt-knj');  if (el) el.click(); } },
            { id: 'btn-drive-connect',  fn: function() { if (window.XmilDrive) window.XmilDrive.connectDrive(); } },
            { id: 'btn-clear-data',     fn: async function() {
                if (!window.confirm(
                    '保存済みのすべてのデータを削除します。\n\n' +
                    '・ディスクイメージ (FDD / HDD)\n' +
                    '・カセットテープ\n' +
                    '・ファイルライブラリ\n' +
                    '・IPL ROM / フォント ROM\n' +
                    '・各種設定\n\n' +
                    'この操作は元に戻せません。本当に削除しますか？'
                )) return;
                if (window.XMillennium) { await window.XMillennium.clearStorage(); location.reload(); }
            }},
            { id: 'lib-close-btn',      fn: closeLibraryPanel },
            { id: 'lib-add-btn',        fn: function() { var el = document.getElementById('file-add-to-library'); if (el) el.click(); } },
            { id: 'btn-emm-manage',     fn: function() { openLibraryPanel('emm'); } },
            { id: 'emm-create-close',   fn: closeEmmCreateDialog },
            { id: 'emm-create-confirm', fn: onEmmCreateConfirm },
        ];
        _btnMap.forEach(function(b) {
            var el = document.getElementById(b.id);
            if (el) el.addEventListener('click', b.fn);
        });

        // EMM サイズ選択ラジオ初期化
        initEmmSizeRadios();

        // EMM インポート用隠し file input
        emmImportInput = document.createElement('input');
        emmImportInput.type = 'file';
        emmImportInput.accept = '.mem,.MEM';
        emmImportInput.style.display = 'none';
        document.body.appendChild(emmImportInput);
        emmImportInput.addEventListener('change', async function(e) {
            var file = e.target.files[0];
            e.target.value = '';
            var slotNum = emmImportSlot;
            emmImportSlot = -1;
            if (!file || slotNum < 0) return;
            if (!emmGuardStart(slotNum)) return;
            var slotName = 'emm' + slotNum;
            var fileName = 'EMM' + slotNum + '.MEM';
            var wasExistingKey = null;
            try {
                if (file.size > 16 * 1024 * 1024) { alert('最大 16MB です'); return; }
                var existingEntry = getLibrary().find(function(ent) {
                    return ent.type === 'emm' && ent.name === fileName;
                });
                wasExistingKey = existingEntry ? existingEntry.key : null;
                if (slotState[slotName]) await ejectSlot(slotName);
                var data = await file.arrayBuffer();
                var key = fileName;
                await window.XmilStorage.write(key, data);
                // 古いキーが異なる場合は OPFS の孤児データを削除
                var oldLib2 = getLibrary();
                for (var oi2 = 0; oi2 < oldLib2.length; oi2++) {
                    var oe2 = oldLib2[oi2];
                    if (oe2.key !== key && oe2.type === 'emm' && oe2.name === fileName) {
                        try { await window.XmilStorage.remove(oe2.key); } catch(_) {}
                    }
                }
                var existingFav = false;
                var lib = oldLib2.filter(function(ent) {
                    if (ent.key === key || (ent.type === 'emm' && ent.name === fileName)) {
                        if (ent.favorite) existingFav = true;
                        return false;
                    }
                    return true;
                });
                lib.push({ key: key, name: fileName, type: 'emm', ext: 'MEM',
                           size: data.byteLength, addedAt: new Date().toISOString(),
                           favorite: existingFav });
                saveLibrary(lib);
                await mountFromLibrary(key, slotName);
                renderLibraryList();
                updateCapacityDisplay();
                updateStatus('インポート完了: ' + fileName);
            } catch(err) {
                console.error('EMM import failed:', err);
                alert('インポートに失敗しました: ' + (err.message || err));
                if (wasExistingKey && !slotState[slotName]) {
                    try { await mountFromLibrary(wasExistingKey, slotName); } catch(_) {}
                }
                renderLibraryList();
            } finally {
                emmGuardEnd(slotNum);
            }
        });

        // スクリーンショット
        // 1. エミュレータ停止  2. キャンバスキャプチャ  3. ダイアログ表示
        // 4. 保存 or キャンセル  5. エミュレータ再開
        var screenshotBlob = null;
        var screenshotFilename = '';
        var screenshotWasRunning = false;
        var screenshotModal = document.getElementById('screenshot-modal');
        var screenshotPreview = document.getElementById('screenshot-preview');
        var screenshotSaveBtn = document.getElementById('screenshot-save');
        var screenshotCancelBtn = document.getElementById('screenshot-cancel');

        function screenshotResume() {
            if (screenshotBlob) {
                URL.revokeObjectURL(screenshotPreview.src);
                screenshotBlob = null;
            }
            screenshotModal.classList.add('hidden');
            if (screenshotWasRunning) {
                Module.ccall('js_xmil_start', null, [], []);
            }
        }

        function takeScreenshot() {
            var canvas = document.getElementById('canvas');
            if (!canvas) return;
            // 撮影前の実行状態を保持し、実行中なら停止
            screenshotWasRunning = isRunning;
            if (isRunning) {
                Module.ccall('js_xmil_stop', null, [], []);
            }
            canvas.toBlob(function(blob) {
                if (!blob) { screenshotResume(); return; }
                screenshotBlob = blob;
                var now = new Date();
                var ts = now.getFullYear()
                    + ('0' + (now.getMonth()+1)).slice(-2)
                    + ('0' + now.getDate()).slice(-2)
                    + '_'
                    + ('0' + now.getHours()).slice(-2)
                    + ('0' + now.getMinutes()).slice(-2)
                    + ('0' + now.getSeconds()).slice(-2);
                screenshotFilename = 'xmil_' + ts + '.png';
                // プレビュー表示
                screenshotPreview.src = URL.createObjectURL(blob);
                screenshotModal.classList.remove('hidden');
            }, 'image/png');
        }

        if (screenshotSaveBtn) {
            screenshotSaveBtn.addEventListener('click', function() {
                if (screenshotBlob) {
                    var url = URL.createObjectURL(screenshotBlob);
                    var a = document.createElement('a');
                    a.href = url;
                    a.download = screenshotFilename;
                    a.click();
                    URL.revokeObjectURL(url);
                    updateStatus('スクリーンショット保存');
                }
                screenshotResume();
            });
        }
        if (screenshotCancelBtn) {
            screenshotCancelBtn.addEventListener('click', function() {
                screenshotResume();
            });
        }

        if (elements.btnScreenshot) {
            elements.btnScreenshot.addEventListener('click', function(e) {
                e.stopPropagation();
                takeScreenshot();
            });
        }

        // フルスクリーン
        (function() {
            var wrap = document.getElementById('screen-wrap');
            var btn  = document.getElementById('btn-fullscreen');
            if (!wrap || !btn) return;

            var _cursorTimer = null;
            var _hasNativeFS = !!(wrap.requestFullscreen || wrap.webkitRequestFullscreen);
            var _pseudoFS = false;

            function isFS() {
                return _pseudoFS || !!(document.fullscreenElement || document.webkitFullscreenElement);
            }

            function enterFS() {
                if (_hasNativeFS) {
                    var r = wrap.requestFullscreen || wrap.webkitRequestFullscreen;
                    try {
                        var p = r.call(wrap);
                        if (p && p.catch) p.catch(function(e) {});
                    } catch(e) {}
                } else {
                    // 疑似フルスクリーン (iOS standalone PWA 等)
                    _pseudoFS = true;
                    wrap.classList.add('pseudo-fullscreen');
                    onFullscreenChange();
                }
            }
            function exitFS() {
                if (_pseudoFS) {
                    _pseudoFS = false;
                    wrap.classList.remove('pseudo-fullscreen');
                    onFullscreenChange();
                } else {
                    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
                }
            }

            function updateIcon() {
                btn.textContent = isFS() ? '✕' : '⛶';
                btn.title       = isFS() ? 'タップで解除' : 'フルスクリーン';
            }

            // マウス/タッチ動作でカーソル＆ボタンを一時表示し、3秒で消す
            function showCursor() {
                wrap.classList.add('fs-cursor-visible');
                clearTimeout(_cursorTimer);
                if (isFS()) {
                    _cursorTimer = setTimeout(function() { wrap.classList.remove('fs-cursor-visible'); }, 3000);
                }
            }
            function onFullscreenChange() {
                updateIcon();
                if (!isFS()) {
                    clearTimeout(_cursorTimer);
                    wrap.classList.add('fs-cursor-visible');
                } else {
                    showCursor();
                }
            }

            btn.addEventListener('click', function() { isFS() ? exitFS() : enterFS(); });
            wrap.addEventListener('dblclick', function() {
                if (elements.mouseEnable && elements.mouseEnable.checked) return;
                isFS() ? exitFS() : enterFS();
            });
            wrap.addEventListener('mousemove', showCursor);
            wrap.addEventListener('touchstart', showCursor);
            document.addEventListener('fullscreenchange', onFullscreenChange);
            document.addEventListener('webkitfullscreenchange', onFullscreenChange);
        })();

        // 設定ラジオ/チェック
        if (elements.romTypeRadios) {
            elements.romTypeRadios.forEach(function(radio) {
                radio.addEventListener('change', function() { onRomTypeChange(); saveSettings(); });
            });
        }
        if (elements.dipHighres) elements.dipHighres.addEventListener('change', function() { onDipSwChange(); saveSettings(); });
        if (elements.dip2hd)     elements.dip2hd.addEventListener('change', function() { onDipSwChange(); saveSettings(); });
        // トグル項目: label 内に hidden checkbox があるため change イベントが
        // 確実に発火しない環境がある。label の click を直接捕捉して制御する。
        var scanlineItem  = document.getElementById('cfg-scanline-item');
        var motorItem     = document.getElementById('cfg-motor-item');
        var joystickItem  = document.getElementById('cfg-joystick-item');
        var mouseItem     = document.getElementById('cfg-mouse-item');
        if (scanlineItem) scanlineItem.addEventListener('click', function(e) {
            e.preventDefault();
            if (elements.skipLine) elements.skipLine.checked = !elements.skipLine.checked;
            onSkipLineChange(); saveSettings();
        });
        if (motorItem) motorItem.addEventListener('click', function(e) {
            e.preventDefault();
            if (elements.motorSound) elements.motorSound.checked = !elements.motorSound.checked;
            onMotorChange(); saveSettings();
        });
        if (elements.seekVolume) {
            // スライダー操作がトグルラベルの click 処理に巻き込まれないよう分離
            if (elements.seekVolumeRow) {
                elements.seekVolumeRow.addEventListener('pointerdown', function(e) { e.stopPropagation(); });
                elements.seekVolumeRow.addEventListener('click', function(e) { e.stopPropagation(); });
            }
            elements.seekVolume.addEventListener('pointerdown', function(e) { e.stopPropagation(); });
            elements.seekVolume.addEventListener('mousedown', function(e) { e.stopPropagation(); });
            elements.seekVolume.addEventListener('touchstart', function(e) { e.stopPropagation(); }, { passive: true });
            elements.seekVolume.addEventListener('click', function(e) { e.stopPropagation(); });
            elements.seekVolume.addEventListener('input', function() {
                onMotorVolumeChange(); saveSettings();
            });
            elements.seekVolume.addEventListener('change', function() {
                onMotorVolumeChange(); saveSettings();
            });
        }
        if (joystickItem) joystickItem.addEventListener('click', function(e) {
            e.preventDefault();
            if (elements.joystickEnable) elements.joystickEnable.checked = !elements.joystickEnable.checked;
            onJoystickChange(); saveSettings();
        });
        if (mouseItem) mouseItem.addEventListener('click', function(e) {
            e.preventDefault();
            if (elements.mouseEnable) elements.mouseEnable.checked = !elements.mouseEnable.checked;
            onMouseChange(); saveSettings();
        });
        var fmItem = document.getElementById('cfg-fm-item');
        if (fmItem) fmItem.addEventListener('click', function(e) {
            e.preventDefault();
            if (elements.fmEnable) elements.fmEnable.checked = !elements.fmEnable.checked;
            onFmChange(); saveSettings();
        });
        var statusItem = document.getElementById('cfg-status-item');
        if (statusItem) statusItem.addEventListener('click', function(e) {
            e.preventDefault();
            if (elements.statusToastEnable) elements.statusToastEnable.checked = !elements.statusToastEnable.checked;
            syncToggleItems(); saveSettings();
        });
        var overwriteItem = document.getElementById('cfg-overwrite-item');
        if (overwriteItem) overwriteItem.addEventListener('click', function(e) {
            e.preventDefault();
            if (elements.stateOverwrite) elements.stateOverwrite.checked = !elements.stateOverwrite.checked;
            syncToggleItems(); saveSettings();
        });
        var portableEmmItem = document.getElementById('cfg-portable-emm-item');
        if (portableEmmItem) portableEmmItem.addEventListener('click', function(e) {
            e.preventDefault();
            var cb = document.getElementById('cfg-portable-emm');
            if (cb) cb.checked = !cb.checked;
            syncToggleItems(); saveSettings();
        });
        if (elements.keyModeRadios) {
            elements.keyModeRadios.forEach(function(radio) {
                radio.addEventListener('change', function() { onKeyModeChange(); saveSettings(); });
            });
        }

        // ── ソフトウェアキーボード ──
        var skToggleBtn = document.getElementById('sk-toggle');
        var skKeyboard  = document.getElementById('soft-keyboard');
        var skNumToggle = document.getElementById('sk-numpad-toggle');
        if (skToggleBtn) skToggleBtn.addEventListener('click', toggleSoftKeyboard);
        if (skNumToggle) skNumToggle.addEventListener('click', toggleNumpad);
        if (skKeyboard) {
            skKeyboard.addEventListener('pointerdown',        onSkPointerDown);
            skKeyboard.addEventListener('pointerup',          onSkPointerUp);
            skKeyboard.addEventListener('pointercancel',      onSkPointerUp);
            skKeyboard.addEventListener('lostpointercapture', onSkPointerUp);
        }
        // フォーカス喪失・タブ切替時にキー取り残しを防止
        window.addEventListener('blur', skReleaseAllKeys);
        document.addEventListener('visibilitychange', function() {
            if (document.hidden) skReleaseAllKeys();
        });
        skInitKeyFaces();

        loadSettings();
        syncModelBtnActive();
        syncKeyModeBtnActive();
        syncToggleItems();
        updateDiskTypeSwitch();
        updateResolutionSwitch();

        // Mouse ON 時: Canvas クリックで Pointer Lock 開始
        if (elements.canvas) {
            elements.canvas.addEventListener('click', function() {
                if (elements.mouseEnable && elements.mouseEnable.checked && !document.pointerLockElement) {
                    elements.canvas.requestPointerLock();
                }
            });
            // Mouse ON 時: 右クリック contextmenu 抑止
            elements.canvas.addEventListener('contextmenu', function(e) {
                if (elements.mouseEnable && elements.mouseEnable.checked) {
                    e.preventDefault();
                }
            });
        }

        setInterval(updateFPS, 1000);

        // 最初のユーザー操作でオーディオをアンロック
        var unlockOnce = function() { setupAudioStream(); };
        document.addEventListener('click',      unlockOnce, { once: true });
        document.addEventListener('keydown',    unlockOnce, { once: true });
        document.addEventListener('touchstart', unlockOnce, { once: true, passive: true });

        // ライブラリ初期表示
        renderLibraryList();
        updateCapacityDisplay();
    }

    // モジュール読み込み完了時
    async function onModuleReady() {
        // マルチタブ警告
        if (_multiTabPromise) {
            var otherTabExists = await _multiTabPromise;
            if (otherTabExists) {
                var ok = confirm(
                    'このエミュレーターは別のタブで既に起動しています。\n\n' +
                    '複数のタブで同時に使用すると、ディスクイメージの' +
                    'データが競合し破損する可能性があります。\n\n' +
                    'このタブでも起動しますか？'
                );
                if (!ok) {
                    // 起動中止 — チャネルを閉じて以後 ping に応答しない
                    if (_tabChannel) { _tabChannel.close(); _tabChannel = null; }
                    if (elements.loading) {
                        elements.loading.textContent =
                            '他のタブを閉じてからページをリロードしてください。';
                    }
                    return;
                }
            }
        }
        module = window.Module;

        if (elements.loading)     elements.loading.classList.add('hidden');
        if (elements.mainContent) elements.mainContent.classList.remove('hidden');

        applyInitialSettings();
        isRunning = true;
        updateStatus('実行中 (クリックで音声ON)');
        updatePowerBtn();

        // ROM/フォント自動ロード → マウント状態復元 (非同期)
        autoLoadRom();
        autoLoadFonts();
        await autoRestoreMounts();
    }

    function applyInitialSettings() {
        if (!module) return;
        onRomTypeChange();
        onDipSwChange();
        onSkipLineChange();
        onMotorChange();
        onMotorVolumeChange();
        onJoystickChange();
        onMouseChange();
        onFmChange();
        onKeyModeChange();
        syncModelBtnActive();
        syncKeyModeBtnActive();
        syncToggleItems();
        updateDiskTypeSwitch();
        updateResolutionSwitch();
    }

    // ----------------------------------------------------------------
    // ROM 自動ロード (localStorage → VFS → reset)
    // ----------------------------------------------------------------
    function autoLoadRom() {
        var anyLoaded = false;

        // 旧キー (xmil_rom) からのマイグレーション
        var old = loadFile(LS_ROM);
        if (old) {
            var fn = old.name.toUpperCase();
            if (fn === 'IPLROM.X1' && !loadFile(LS_ROM_X1)) {
                saveFile(LS_ROM_X1, old.name, old.data.buffer);
            } else if (fn === 'IPLROM.X1T' && !loadFile(LS_ROM_X1T)) {
                saveFile(LS_ROM_X1T, old.name, old.data.buffer);
            }
        }

        var savedX1 = loadFile(LS_ROM_X1);
        if (savedX1) {
            writeFileToVFS('/IPLROM.X1', savedX1.data);
            updateRomUI('x1', true, savedX1.name);
            anyLoaded = true;
        }

        var savedX1t = loadFile(LS_ROM_X1T);
        if (savedX1t) {
            writeFileToVFS('/IPLROM.X1T', savedX1t.data);
            updateRomUI('x1t', true, savedX1t.name);
            anyLoaded = true;
        }

        if (anyLoaded) {
            updateStatus('ROM自動ロード完了');
            setTimeout(function() {
                if (module && module._js_xmil_reset) {
                    module._js_xmil_reset();
                    reinitAudioForReset();
                }
            }, 100);
        }
    }

    function updateRomUI(type, loaded, name) {
        var led      = document.getElementById('rom-led-'   + type);
        var nameEl   = document.getElementById('rom-name-'  + type);
        var clearBtn = document.getElementById('rom-clear-' + type);
        if (led)      led.classList.toggle('loaded', !!loaded);
        if (nameEl) {
            nameEl.textContent = loaded ? (name || '(ロード済み)') : '未ロード';
            nameEl.classList.toggle('loaded', !!loaded);
        }
        if (clearBtn) clearBtn.disabled = !loaded;
    }

    function clearRom(type) {
        var lsKey = (type === 'x1') ? LS_ROM_X1 : LS_ROM_X1T;
        try { localStorage.removeItem(lsKey); } catch(e) {}
        updateRomUI(type, false, null);
    }

    // ----------------------------------------------------------------
    // フォント ROM ロード
    // ----------------------------------------------------------------
    var FONT_CFG = {
        ank8:  { lsKey: LS_FNT_ANK8,  vfsPath: '/FNT0808.X1', defaultLabel: '内蔵フォント' },
        ank16: { lsKey: LS_FNT_ANK16, vfsPath: '/FNT0816.X1', defaultLabel: '未ロード' },
        knj:   { lsKey: LS_FNT_KNJ,   vfsPath: '/FNT1616.X1', defaultLabel: '未ロード' }
    };

    function autoLoadFonts() {
        var anyLoaded = false;
        Object.keys(FONT_CFG).forEach(function(type) {
            var cfg   = FONT_CFG[type];
            var saved = loadFile(cfg.lsKey);
            if (saved) {
                writeFileToVFS(cfg.vfsPath, saved.data);
                updateFontUI(type, true, saved.name);
                anyLoaded = true;
            }
        });
        if (anyLoaded && module && module._js_reload_fonts) {
            module._js_reload_fonts();
        }
    }

    function updateFontUI(type, loaded, name) {
        var cfg      = FONT_CFG[type];
        var led      = document.getElementById('fnt-led-'   + type);
        var nameEl   = document.getElementById('fnt-name-'  + type);
        var clearBtn = document.getElementById('fnt-clear-' + type);
        if (led)      led.classList.toggle('loaded', !!loaded);
        if (nameEl) {
            nameEl.textContent = loaded ? (name || '(ロード済み)') : cfg.defaultLabel;
            nameEl.classList.toggle('loaded', !!loaded);
        }
        if (clearBtn) clearBtn.disabled = !loaded;
    }

    function clearFont(type) {
        var cfg = FONT_CFG[type];
        try { localStorage.removeItem(cfg.lsKey); } catch(e) {}
        if (module && module.FS) {
            try { module.FS.unlink(cfg.vfsPath); } catch(e) {}
        }
        updateFontUI(type, false, null);
    }

    function onFontFileChange(type, event) {
        var file = event.target.files[0];
        if (!file) return;
        var cfg  = FONT_CFG[type];
        var reader = new FileReader();
        reader.onload = function(e) {
            var data = new Uint8Array(e.target.result);
            writeFileToVFS(cfg.vfsPath, data);
            saveFile(cfg.lsKey, file.name, e.target.result);
            updateFontUI(type, true, file.name);
            if (module && module._js_reload_fonts) {
                module._js_reload_fonts();
            }
            updateStatus('フォント読み込み完了: ' + file.name);
        };
        reader.readAsArrayBuffer(file);
    }

    // ----------------------------------------------------------------
    // VFS ヘルパー
    // ----------------------------------------------------------------
    function writeFileToVFS(filename, data) {
        if (module && module.FS) {
            try { module.FS.writeFile(filename, data); }
            catch(e) { console.error('FS.writeFile failed:', filename, e); }
        }
    }

    // OPFS/IDB へのストリーミング書き戻し (64KB チャンク; ピークメモリ = 64KB)
    async function flushVfsToStorage(vfsPath, storageKey) {
        if (!module || !module.FS || !window.XmilStorage) return;
        var stat;
        try { stat = module.FS.stat(vfsPath); }
        catch(e) { console.warn('flushVfsToStorage: stat failed for', vfsPath, e); return; }
        var fd = module.FS.open(vfsPath, 'r');
        var size   = stat.size;
        var CHUNK  = 64 * 1024;
        var offset = 0;
        try {
            await window.XmilStorage.writeStream(storageKey, async function() {
                if (offset >= size) return null;
                var n   = Math.min(CHUNK, size - offset);
                var buf = new Uint8Array(n);
                module.FS.read(fd, buf, 0, n, offset);
                offset += n;
                return buf;
            });
        } finally {
            try { module.FS.close(fd); } catch(_) {}
        }
    }

    // OPFS dirty ページのみ書き戻し (連続ページは結合して syscall 削減)
    async function flushVfsToStorageDirty(vfsPath, storageKey, dirtyPages) {
        if (!module || !module.FS || !window.XmilStorage) return;
        var stat;
        try { stat = module.FS.stat(vfsPath); }
        catch(e) { return; }

        var fd = module.FS.open(vfsPath, 'r');
        var fileSize = stat.size;
        var patches = [];

        try {
            var sorted = Array.from(dirtyPages).sort(function(a, b) { return a - b; });
            var i = 0;
            while (i < sorted.length) {
                var startPage = sorted[i];
                var endPage = startPage;
                while (i + 1 < sorted.length && sorted[i + 1] === endPage + 1) {
                    endPage = sorted[++i];
                }
                i++;
                var offset = startPage * PAGE_SIZE;
                var size   = Math.min((endPage - startPage + 1) * PAGE_SIZE, fileSize - offset);
                if (size <= 0) continue;
                var buf = new Uint8Array(size);
                module.FS.read(fd, buf, 0, size, offset);
                patches.push({ offset: offset, data: buf });
            }
        } finally {
            try { module.FS.close(fd); } catch(_) {}
        }

        if (patches.length > 0) {
            await window.XmilStorage.writePatch(storageKey, patches);
        }
    }

    // ----------------------------------------------------------------
    // スロット UI 更新
    // ----------------------------------------------------------------
    function updateSlotUI(slotName, name) {
        if (slotName === 'drive0' || slotName === 'drive1') {
            var driveIdx = slotName === 'drive0' ? 0 : 1;
            if (elements.fddDiskName && elements.fddDiskName[driveIdx]) {
                var fn = elements.fddDiskName[driveIdx];
                if (name) { fn.textContent = name; fn.classList.add('loaded'); }
                else       { fn.textContent = '未挿入'; fn.classList.remove('loaded'); }
            }
            if (elements.fddBay && elements.fddBay[driveIdx]) {
                if (name) elements.fddBay[driveIdx].classList.add('disk-in');
                else      elements.fddBay[driveIdx].classList.remove('disk-in');
            }
            if (elements.fddEject && elements.fddEject[driveIdx]) {
                elements.fddEject[driveIdx].disabled = !name;
            }
            if (elements.fddHwEject && elements.fddHwEject[driveIdx]) {
                elements.fddHwEject[driveIdx].disabled = !name;
            }
            if (elements.fddLed && elements.fddLed[driveIdx]) {
                var led = elements.fddLed[driveIdx];
                led.classList.remove('led-2d', 'led-2hd');
                if (name && fddDiskType[driveIdx]) {
                    led.classList.add('led-' + fddDiskType[driveIdx]);
                }
            }
            // スロット名表示
            var slotNameEl = document.getElementById('fdd-slot-name-' + driveIdx);
            if (slotNameEl) slotNameEl.textContent = name ? slotName.toUpperCase() : '';

        } else if (slotName === 'hdd0' || slotName === 'hdd1') {
            var hddIdx = slotName === 'hdd0' ? 0 : 1;
            var nameEl  = document.getElementById('hdd' + hddIdx + '-name');
            var ejectEl = document.getElementById('btn-hdd' + hddIdx + '-eject');
            var ledEl   = document.getElementById('hdd' + hddIdx + '-led');
            if (nameEl) {
                if (name) { nameEl.textContent = name; nameEl.classList.add('loaded'); }
                else      { nameEl.textContent = '（未挿入）'; nameEl.classList.remove('loaded'); }
            }
            if (ejectEl) ejectEl.disabled = !name;
            if (ledEl)   ledEl.classList.toggle('loaded', !!name);

        } else if (slotName === 'cmt') {
            if (elements.cmtName) {
                if (name) { elements.cmtName.textContent = name; elements.cmtName.classList.add('loaded'); }
                else      { elements.cmtName.textContent = '（未挿入）'; elements.cmtName.classList.remove('loaded'); }
            }
            var hasTape = !!name;
            if (elements.btnCmtEject) elements.btnCmtEject.disabled = !hasTape;
            if (elements.btnCmtPlay)  elements.btnCmtPlay.disabled  = !hasTape;
            if (elements.btnCmtStop)  elements.btnCmtStop.disabled  = !hasTape;
            if (elements.btnCmtFf)    elements.btnCmtFf.disabled    = !hasTape;
            if (elements.btnCmtRew)   elements.btnCmtRew.disabled   = !hasTape;
            var cdEjectEl = document.getElementById('cdeck-eject');
            if (cdEjectEl) cdEjectEl.disabled = !hasTape;

            cmtDeckTapeName = name;
            var deckName = document.getElementById('cmt-deck-name');
            if (deckName) {
                deckName.textContent = name || '未挿入';
                if (name) deckName.classList.add('loaded');
                else      deckName.classList.remove('loaded');
            }
            if (!hasTape) { stopCmtDeckUpdater(); resetCmtDeckUI(); }
        }
    }

    // ----------------------------------------------------------------
    // ライブラリ UI
    // ----------------------------------------------------------------
    var currentLibraryFilter = 'all'; // 'all' | 'fdd' | 'hdd' | 'cmt' | 'emm'
    var pendingSlotName = null;       // ライブラリパネルを開いたスロット名

    function openLibraryPanel(type, index) {
        // 対応するスロット名を記憶 (nullなら全スロット選択可)
        pendingSlotName = (type && index !== undefined) ? slotIndexToName(type, index) : null;

        // ☁ Drive 系ボタンに現在のスロットコンテキストを設定 (data属性で管理)
        var drivePickBtn = document.getElementById('btn-drive-pick');
        if (drivePickBtn) drivePickBtn.dataset.slot = pendingSlotName || '';

        // フィルタを対応タイプに切り替え
        if (type) {
            currentLibraryFilter = type;
            var filterBtns = document.querySelectorAll('.lib-filter');
            filterBtns.forEach(function(btn) {
                btn.classList.toggle('active', btn.dataset.type === type);
            });
        }

        // 検索テキストをクリア
        currentLibrarySearch = '';
        var searchInput = document.getElementById('lib-search-input');
        if (searchInput) searchInput.value = '';

        // お気に入りフィルタをリセット
        currentFavoritesOnly = false;
        var favBtn = document.getElementById('lib-fav-filter');
        if (favBtn) { favBtn.classList.remove('active'); favBtn.textContent = '☆'; }

        // ソートセレクト値を復元
        var sortSel = document.getElementById('lib-sort-select');
        if (sortSel) sortSel.value = currentLibrarySort;

        var panel = document.getElementById('library-panel');
        if (panel) panel.classList.remove('hidden');
        renderLibraryList();
        updateCapacityDisplay();
    }

    function closeLibraryPanel() {
        var panel = document.getElementById('library-panel');
        if (panel) panel.classList.add('hidden');
        pendingSlotName = null;
    }

    var TYPE_ORDER = { fdd: 0, hdd: 1, cmt: 2, emm: 3 };

    function sortLibraryEntries(entries, sortKey) {
        var sorted = entries.slice();
        sorted.sort(function(a, b) {
            var fa = a.favorite ? 0 : 1;
            var fb = b.favorite ? 0 : 1;
            if (fa !== fb) return fa - fb;
            switch (sortKey) {
                case 'type-name':
                    var ta = TYPE_ORDER[a.type] !== undefined ? TYPE_ORDER[a.type] : 9;
                    var tb = TYPE_ORDER[b.type] !== undefined ? TYPE_ORDER[b.type] : 9;
                    if (ta !== tb) return ta - tb;
                    return a.name.localeCompare(b.name, 'ja');
                case 'date-desc':
                    return (b.addedAt || '').localeCompare(a.addedAt || '');
                case 'size-desc':
                    return (b.size || 0) - (a.size || 0);
                default:
                    return a.name.localeCompare(b.name, 'ja');
            }
        });
        return sorted;
    }

    function toggleFavorite(key) {
        var lib = getLibrary();
        var entry = lib.find(function(e) { return e.key === key; });
        if (!entry) return;
        entry.favorite = !entry.favorite;
        saveLibrary(lib);
        renderLibraryList();
    }

    function renderLibraryList() {
        var listEl = document.getElementById('library-list');
        if (!listEl) return;

        // アクティブフィルタ取得
        var activeBtn = document.querySelector('.lib-filter.active');
        var filter = activeBtn ? activeBtn.dataset.type : 'all';
        currentLibraryFilter = filter;

        // 「＋ 追加」ボタン: EMM タブ時は非表示
        var addBtn = document.getElementById('lib-add-btn');
        if (addBtn) addBtn.classList.toggle('hidden', filter === 'emm');

        // ★ フィルタボタン / ツールバー: EMM タブ時は非表示
        var favFilterBtn = document.getElementById('lib-fav-filter');
        if (favFilterBtn) favFilterBtn.classList.toggle('hidden', filter === 'emm');
        var toolbar = document.getElementById('lib-toolbar');
        if (toolbar) toolbar.classList.toggle('hidden', filter === 'emm');

        // EMM タブ → 専用 10 スロットビュー
        if (filter === 'emm') {
            renderEmmSlotList();
            return;
        }

        var lib = getLibrary();
        var filtered = filter === 'all' ? lib : lib.filter(function(e) { return e.type === filter; });

        // お気に入りフィルタ
        if (currentFavoritesOnly) {
            filtered = filtered.filter(function(e) { return !!e.favorite; });
        }
        // テキスト検索フィルタ
        var searchText = currentLibrarySearch.trim().toLowerCase();
        if (searchText) {
            filtered = filtered.filter(function(e) {
                return e.name.toLowerCase().indexOf(searchText) >= 0;
            });
        }

        if (filtered.length === 0) {
            var emptyMsg = searchText
                ? '一致するファイルがありません'
                : (currentFavoritesOnly
                    ? 'お気に入りに登録されたファイルがありません'
                    : 'ライブラリにファイルがありません<br><small>「＋ 追加」からファイルを追加してください</small>');
            listEl.innerHTML = '<div class="lib-empty">' + emptyMsg + '</div>';
            return;
        }

        // ソート適用
        var sortSel = document.getElementById('lib-sort-select');
        var sortKey = sortSel ? sortSel.value : 'name';
        filtered = sortLibraryEntries(filtered, sortKey);

        // マウント中のスロット情報を逆引き
        var mountedBy = {};
        for (var sn in slotState) {
            if (slotState[sn]) mountedBy[slotState[sn]] = sn;
        }

        var html = '';
        filtered.forEach(function(entry) {
            var sizeMb = (entry.size / 1024 / 1024).toFixed(1);
            var isMounted = !!mountedBy[entry.key];
            var mountedSlot = mountedBy[entry.key];

            var typeBadge = { fdd: 'FDD', hdd: 'HDD', cmt: 'CMT', emm: 'EMM' }[entry.type] || entry.type.toUpperCase();
            var typeClass  = 'lib-badge-' + entry.type;

            // マウントボタン生成 (data-* 属性でキー/スロットを渡す。onclick 文字列連結は使わない)
            var ek = escHtml(entry.key);   // HTML属性エスケープ (不等号・引用符)
            var en = escHtml(entry.name);  // 同上 (表示・title・data-name)
            var mountBtns = '';
            if (entry.type === 'fdd') {
                var fd0Active = mountedSlot === 'drive0';
                var fd1Active = mountedSlot === 'drive1';
                mountBtns += '<button class="lib-mount-btn' + (fd0Active ? ' active' : '') + '" data-action="mount" data-key="' + ek + '" data-slot="drive0" title="ドライブ0にマウント">FD0' + (fd0Active ? '✓' : '') + '</button>';
                mountBtns += '<button class="lib-mount-btn' + (fd1Active ? ' active' : '') + '" data-action="mount" data-key="' + ek + '" data-slot="drive1" title="ドライブ1にマウント">FD1' + (fd1Active ? '✓' : '') + '</button>';
            } else if (entry.type === 'hdd') {
                var hd0Active = mountedSlot === 'hdd0';
                var hd1Active = mountedSlot === 'hdd1';
                mountBtns += '<button class="lib-mount-btn' + (hd0Active ? ' active' : '') + '" data-action="mount" data-key="' + ek + '" data-slot="hdd0" title="HDD0にマウント">HD0' + (hd0Active ? '✓' : '') + '</button>';
                mountBtns += '<button class="lib-mount-btn' + (hd1Active ? ' active' : '') + '" data-action="mount" data-key="' + ek + '" data-slot="hdd1" title="HDD1にマウント">HD1' + (hd1Active ? '✓' : '') + '</button>';
            } else if (entry.type === 'cmt') {
                var cmtActive = mountedSlot === 'cmt';
                mountBtns += '<button class="lib-mount-btn' + (cmtActive ? ' active' : '') + '" data-action="mount" data-key="' + ek + '" data-slot="cmt" title="CMTにマウント">CMT' + (cmtActive ? '✓' : '') + '</button>';
            } else if (entry.type === 'emm') {
                // EMM: ファイル名からスロットが一意に決まる
                var emmSn = emmSlotFromName(entry.name);
                if (emmSn) {
                    var emmActive = mountedSlot === emmSn;
                    var emmLabel = 'EMM' + emmSlotNum(emmSn);
                    mountBtns += '<button class="lib-mount-btn' + (emmActive ? ' active' : '') + '" data-action="mount" data-key="' + ek + '" data-slot="' + emmSn + '" title="' + emmLabel + 'にマウント">' + emmLabel + (emmActive ? '✓' : '') + '</button>';
                }
            }

            var favClass = entry.favorite ? ' favorited' : '';
            var favIcon  = entry.favorite ? '★' : '☆';

            html += '<div class="lib-row' + (isMounted ? ' mounted' : '') + '">';
            html += '<button class="lib-fav-btn' + favClass + '" data-action="toggle-fav" data-key="' + ek + '" title="お気に入り">' + favIcon + '</button>';
            html += '<span class="lib-type-badge ' + typeClass + '">' + typeBadge + '</span>';
            html += '<span class="lib-file-name" title="' + en + '">' + en + '</span>';
            html += '<span class="lib-file-size">' + sizeMb + 'MB</span>';
            html += '<div class="lib-row-btns">' + mountBtns;
            if (entry.type === 'fdd' || entry.type === 'hdd' || entry.type === 'emm') {
                html += '<button class="lib-edit-btn" data-action="edit" data-key="' + ek + '" title="ディスク編集">&#x270E;</button>';
            }
            html += '<button class="lib-dl-btn" data-action="download" data-key="' + ek + '" data-name="' + en + '" title="ダウンロード">⬇</button>';
            html += '<button class="lib-del-btn" data-action="delete" data-key="' + ek + '" title="削除">🗑</button>';
            html += '<button class="lib-drive-save-btn hidden" data-action="drive-save" data-key="' + ek + '" title="Google Driveへ保存">☁</button>';
            html += '</div></div>';
        });
        listEl.innerHTML = html;
        if (window.XmilDrive && window.XmilDrive.onLibraryListRendered) {
            window.XmilDrive.onLibraryListRendered();
        }
    }

    function escHtml(s) {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    async function updateCapacityDisplay() {
        var el = document.getElementById('library-capacity');
        if (!el || !navigator.storage || !navigator.storage.estimate) return;
        try {
            var est   = await navigator.storage.estimate();
            var usage = (est.usage || 0) / 1024 / 1024;
            var quota = (est.quota || 0) / 1024 / 1024;
            var pct   = quota > 0 ? Math.min(100, (usage / quota) * 100) : 0;
            el.innerHTML = '<div class="lib-cap-bar-wrap"><div class="lib-cap-bar-fill" style="width:' + pct.toFixed(1) + '%"></div></div>'
                         + '<span class="lib-cap-text">' + usage.toFixed(0) + 'MB / ' + quota.toFixed(0) + 'MB 使用中</span>';
        } catch(e) {
            el.textContent = '容量情報を取得できませんでした';
        }
    }

    // グローバル公開: shell.html の onclick から呼ばれる関数のみ公開
    // ライブラリリスト内ボタンはイベント委譲で処理するため、libMountClick 等のグローバルは不要
    window.openLibraryPanel  = openLibraryPanel;
    window.closeLibraryPanel = closeLibraryPanel;

    // X1Pen 用: DOM 不要で localStorage から設定を読み C 側に直接適用
    // デフォルト値は platform_main.cpp の xmilcfg 初期値と一致させること
    function applySettingsFromStorage() {
        if (!module) return;
        try {
            var raw = localStorage.getItem(LS_SETTINGS);
            var s = raw ? JSON.parse(raw) : {};
            // ROM_TYPE: default 1 (X1)
            if (module._js_set_rom_type)    module._js_set_rom_type(s.romType !== undefined ? s.romType : 1);
            // DIP_SW: default 1 (bit0=高解像度OFF)
            if (module._js_set_dip_sw) {
                var dip = 0;
                if (!s.dipHighres) dip |= 0x01;  // NOT: unchecked = bit set
                if (s.dip2hd)      dip |= 0x04;
                module._js_set_dip_sw(dip);
            }
            if (module._js_set_skip_line)   module._js_set_skip_line(s.skipLine ? 1 : 0);
            // MOTOR: default 1 (有効)
            if (module._js_set_motor)       module._js_set_motor((s.motorSound !== undefined ? s.motorSound : true) ? 1 : 0);
            // MOTORVOL: default 80
            if (module._js_set_motor_volume) module._js_set_motor_volume(s.seekVolume !== undefined ? s.seekVolume : 80);
            // JOYSTICK: default true (有効)
            if (module._js_set_joystick)    module._js_set_joystick((s.joystickEnable !== undefined ? s.joystickEnable : true) ? 1 : 0);
            // MOUSE: default false (無効)
            if (module._js_set_mouse)       module._js_set_mouse(s.mouseEnable ? 1 : 0);
            // SOUND_SW (FM): default true (有効)
            if (module._js_set_sound_sw)    module._js_set_sound_sw((s.fmEnable !== undefined ? s.fmEnable : true) ? 1 : 0);
            // KEY_MODE: default 0
            if (module._js_set_key_mode)    module._js_set_key_mode(s.keyMode !== undefined ? s.keyMode : 0);
        } catch(e) {
            console.warn('[x1pen] applySettingsFromStorage failed:', e);
        }
    }

    // X1Pen 用: 共通初期化関数を公開
    window.XmilInit = {
        setupAudioStream: setupAudioStream,
        applySettingsFromStorage: applySettingsFromStorage
    };

    // X1Pen 用: DOM 不要の設定保存 (部分更新: read-modify-write)
    function saveSettingsDirect(overrides) {
        try {
            var raw = localStorage.getItem(LS_SETTINGS);
            var settings = raw ? JSON.parse(raw) : {};
            Object.assign(settings, overrides);
            localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
        } catch(e) { console.warn('saveSettingsDirect failed:', e); }
    }

    // X1Pen 用: ROM を VFS に配置するだけ (reset なし, 旧キー互換あり)
    function loadRomToVfs() {
        var old = loadFile(LS_ROM);
        if (old) {
            var fn = old.name.toUpperCase();
            if (fn === 'IPLROM.X1' && !loadFile(LS_ROM_X1))
                saveFile(LS_ROM_X1, old.name, old.data.buffer);
            else if (fn === 'IPLROM.X1T' && !loadFile(LS_ROM_X1T))
                saveFile(LS_ROM_X1T, old.name, old.data.buffer);
        }
        var savedX1 = loadFile(LS_ROM_X1);
        if (savedX1) writeFileToVFS('/IPLROM.X1', savedX1.data);
        var savedX1t = loadFile(LS_ROM_X1T);
        if (savedX1t) writeFileToVFS('/IPLROM.X1T', savedX1t.data);
    }

    // X1Pen 用: フォントを VFS に配置するだけ (js_reload_fonts なし)
    function loadFontsToVfs() {
        Object.keys(FONT_CFG).forEach(function(type) {
            var cfg = FONT_CFG[type];
            var saved = loadFile(cfg.lsKey);
            if (saved) writeFileToVFS(cfg.vfsPath, saved.data);
        });
    }

    // X1Pen 用: コントロール API
    window.XmilControls = {
        // Reset
        iplReset: onIplResetClick,
        nmiReset: onNmiResetClick,

        // 設定変更 (C export + localStorage 永続化)
        setRomType: function(v) {
            if (module && module._js_set_rom_type) module._js_set_rom_type(v);
            saveSettingsDirect({ romType: v });
        },
        setDipHighres: function(on) {
            if (module && module._js_get_dip_sw && module._js_set_dip_sw) {
                var dip = module._js_get_dip_sw();
                if (on) dip &= ~0x01; else dip |= 0x01;
                module._js_set_dip_sw(dip);
            }
            saveSettingsDirect({ dipHighres: on });
        },
        setDip2hd: function(on) {
            if (module && module._js_get_dip_sw && module._js_set_dip_sw) {
                var dip = module._js_get_dip_sw();
                if (on) dip |= 0x04; else dip &= ~0x04;
                module._js_set_dip_sw(dip);
            }
            saveSettingsDirect({ dip2hd: on });
        },
        setSkipLine: function(on) {
            if (module && module._js_set_skip_line) module._js_set_skip_line(on ? 1 : 0);
            saveSettingsDirect({ skipLine: on });
        },
        setMotorSound: function(on) {
            if (module && module._js_set_motor) module._js_set_motor(on ? 1 : 0);
            saveSettingsDirect({ motorSound: on });
        },
        setMotorVolume: function(v) {
            if (module && module._js_set_motor_volume) module._js_set_motor_volume(v);
            saveSettingsDirect({ seekVolume: v });
        },
        setJoystick: function(on) {
            if (module && module._js_set_joystick) module._js_set_joystick(on ? 1 : 0);
            saveSettingsDirect({ joystickEnable: on });
        },
        setMouse: function(on) {
            if (module && module._js_set_mouse) module._js_set_mouse(on ? 1 : 0);
            saveSettingsDirect({ mouseEnable: on });
        },
        setFmSound: function(on) {
            if (module && module._js_set_sound_sw) module._js_set_sound_sw(on ? 1 : 0);
            saveSettingsDirect({ fmEnable: on });
        },
        setKeyMode: function(v) {
            if (module && module._js_set_key_mode) module._js_set_key_mode(v);
            saveSettingsDirect({ keyMode: v });
        },

        // 設定読み取り
        getSettings: function() {
            try {
                var raw = localStorage.getItem(LS_SETTINGS);
                return raw ? JSON.parse(raw) : {};
            } catch(e) { return {}; }
        },

        // ROM/Font 管理
        onRomFileChange: onRomFileChange,
        onFontFileChange: onFontFileChange,
        clearRom: clearRom,
        clearFont: clearFont,
        loadRomToVfs: loadRomToVfs,
        loadFontsToVfs: loadFontsToVfs,

        // ROM/Font 状態取得
        getRomStatus: function() {
            var status = {};
            var x1  = loadFile(LS_ROM_X1);
            var x1t = loadFile(LS_ROM_X1T);
            status.x1  = x1  ? x1.name  : null;
            status.x1t = x1t ? x1t.name : null;
            Object.keys(FONT_CFG).forEach(function(type) {
                var saved = loadFile(FONT_CFG[type].lsKey);
                status[type] = saved ? saved.name : null;
            });
            return status;
        },

        // CMT transport
        cmtPlay: function() { if (module && module._js_cmt_play) module._js_cmt_play(); },
        cmtStop: function() { if (module && module._js_cmt_stop) module._js_cmt_stop(); },
        cmtFf:   function() { if (module && module._js_cmt_ff) module._js_cmt_ff(); },
        cmtRew:  function() { if (module && module._js_cmt_rew) module._js_cmt_rew(); },

        // 一時ディスクマウント (X1Pen PROGRAM ディスク用)
        mountTempDisk: async function(arrayBuffer, slotName) {
            // 既存ディスクが通常マウントなら flush/eject して変更を保存
            if (slotState[slotName] && slotState[slotName] !== '__x1pen_temp__') {
                try { await ejectSlot(slotName); } catch(e) {}
            }
            var vfsPath = slotToVfsPath(slotName, 'd88');
            writeFileToVFS(vfsPath, new Uint8Array(arrayBuffer));
            if (module) {
                var driveIndex = slotName === 'drive0' ? 0 : 1;
                module.ccall('js_insert_disk', null, ['string', 'number'], [vfsPath, driveIndex]);
            }
            slotState[slotName] = '__x1pen_temp__';
            slotVfsPath[slotName] = vfsPath;
            slotDirty[slotName] = false;
            slotDirtyPages[slotName] = null;
            // saveMountState() は呼ばない (一時マウント)
        },

        // EMM スロット操作
        onEmmSlotCreate: onEmmSlotCreate,
        onEmmSlotExport: onEmmSlotExport,
        onEmmSlotImport: onEmmSlotImport,
        onEmmSlotDelete: onEmmSlotDelete,
        onEmmSlotInsert: onEmmSlotInsert,
        onEmmSlotEject:  onEmmSlotEject,
        openEmmCreateDialog: openEmmCreateDialog,
        closeEmmCreateDialog: closeEmmCreateDialog,
        onEmmCreateConfirm: onEmmCreateConfirm,
        initEmmSizeRadios: initEmmSizeRadios,

        // EMM import input 生成 (init() 外で呼べるように)
        createEmmImportInput: function() {
            if (emmImportInput) return;
            emmImportInput = document.createElement('input');
            emmImportInput.type = 'file';
            emmImportInput.accept = '.mem,.MEM';
            emmImportInput.style.display = 'none';
            document.body.appendChild(emmImportInput);
            emmImportInput.addEventListener('change', async function(e) {
                var file = e.target.files[0];
                e.target.value = '';
                var slotNum = emmImportSlot;
                emmImportSlot = -1;
                if (!file || slotNum < 0) return;
                if (!emmGuardStart(slotNum)) return;
                var slotName = 'emm' + slotNum;
                var fileName = 'EMM' + slotNum + '.MEM';
                var wasExistingKey = null;
                try {
                    if (file.size > 16 * 1024 * 1024) { alert('最大 16MB です'); return; }
                    var existingEntry = getLibrary().find(function(ent) {
                        return ent.type === 'emm' && ent.name === fileName;
                    });
                    wasExistingKey = existingEntry ? existingEntry.key : null;
                    if (slotState[slotName]) await ejectSlot(slotName);
                    var data = await file.arrayBuffer();
                    var key = fileName;
                    await window.XmilStorage.write(key, data);
                    var oldLib = getLibrary();
                    for (var oi = 0; oi < oldLib.length; oi++) {
                        var oe = oldLib[oi];
                        if (oe.type === 'emm' && oe.name === fileName && oe.key !== key) {
                            try { await window.XmilStorage.remove(oe.key); } catch(_) {}
                        }
                    }
                    var lib = getLibrary().filter(function(ent) {
                        return !(ent.type === 'emm' && ent.name === fileName);
                    });
                    var existingFav = (existingEntry && existingEntry.favorite) || false;
                    lib.push({ key: key, name: fileName, type: 'emm', size: file.size,
                               addedAt: new Date().toISOString(), ext: 'mem',
                               favorite: existingFav });
                    saveLibrary(lib);
                    await mountFromLibrary(key, slotName);
                    renderLibraryList();
                    updateCapacityDisplay();
                } catch(err) {
                    alert('インポートに失敗しました: ' + (err.message || err));
                    if (wasExistingKey && !slotState[slotName]) {
                        try { await mountFromLibrary(wasExistingKey, slotName); } catch(_) {}
                    }
                    renderLibraryList();
                } finally {
                    emmGuardEnd(slotNum);
                }
            });
        }
    };

    // X1Pen 用: ライブラリ内部関数を公開
    window.XmilLibrary = {
        addToLibrary: addToLibrary,
        mountFromLibrary: mountFromLibrary,
        downloadFromLibrary: downloadFromLibrary,
        deleteFromLibrary: deleteFromLibrary,
        toggleFavorite: toggleFavorite,
        renderLibraryList: renderLibraryList,
        autoRestoreMounts: autoRestoreMounts,
        setSearch: function(v) { currentLibrarySearch = v; },
        setSort:   function(v) { currentLibrarySort = v; },
        setFavoritesOnly: function(v) { currentFavoritesOnly = v; },
        getFavoritesOnly: function()  { return currentFavoritesOnly; }
    };

    // FDD ベイの「ライブラリを開く」ボタン用 (shell.htmlから呼ばれる)
    window.openFddLibrary = function(drive) { openLibraryPanel('fdd', drive); };
    window.openHddLibrary = function(id)    { openLibraryPanel('hdd', id);    };
    window.openCmtLibrary = function()      { openLibraryPanel('cmt', 0);     };

    // ----------------------------------------------------------------
    // CMT デッキ UI
    // ----------------------------------------------------------------
    var CMT_EJECT = 0, CMT_STOP = 1, CMT_PLAY = 2, CMT_FF = 3, CMT_REW = 4, CMT_AFF = 5, CMT_AREW = 6;

    function onCmtStateChange(cmd) {
        // SCPU 経由のイジェクト（SHIFT+STOP）: JS 側のスロット状態も同期
        if (cmd === CMT_EJECT && cmtDeckTapeName) {
            cmtDeckTapeName = null;
            var deckName = document.getElementById('cmt-deck-name');
            if (deckName) { deckName.textContent = '未挿入'; deckName.classList.remove('loaded'); }
            slotState['cmt'] = null;
            stopCmtDeckUpdater();
            resetCmtDeckUI();
            return;
        }
        updateCmtDeck();
        var inMotion = (cmd === CMT_PLAY || cmd === CMT_FF || cmd === CMT_REW ||
                        cmd === CMT_AFF  || cmd === CMT_AREW);
        if (inMotion && cmtDeckTapeName) startCmtDeckUpdater();
        else stopCmtDeckUpdater();
    }

    function startCmtDeckUpdater() {
        if (!cmtDeckInterval) cmtDeckInterval = setInterval(updateCmtDeck, 250);
    }

    function stopCmtDeckUpdater() {
        if (cmtDeckInterval) { clearInterval(cmtDeckInterval); cmtDeckInterval = null; }
    }

    function flashFddLed(drive) {
        if (!elements.fddLed || !elements.fddLed[drive]) return;
        var led = elements.fddLed[drive];
        led.classList.add('active');
        if (fddLedTimers[drive]) clearTimeout(fddLedTimers[drive]);
        fddLedTimers[drive] = setTimeout(function() {
            led.classList.remove('active');
            fddLedTimers[drive] = null;
        }, 400);
    }

    function resetCmtDeckUI() {
        ['cmt-reel-l', 'cmt-reel-r'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.setAttribute('class', 'cmt-reel-svg');
        });
        ['cdeck-rew','cdeck-stop','cdeck-play','cdeck-ff'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.className = 'cmt-trans-btn';
        });
        var badge = document.getElementById('cmt-deck-badge');
        if (badge) { badge.textContent = '● EJECT'; badge.className = 'cmt-deck-badge'; }
        var timeEl = document.getElementById('cmt-deck-time');
        if (timeEl) { timeEl.textContent = '--:-- / --:--'; timeEl.className = 'cmt-deck-time'; }
        var bar = document.getElementById('cmt-deck-bar');
        if (bar) bar.style.width = '0%';
        var tl = document.getElementById('cmt-tape-ring-l');
        var tr = document.getElementById('cmt-tape-ring-r');
        if (tl) tl.setAttribute('r', '14');
        if (tr) tr.setAttribute('r', '7');
    }

    function fmtTime(sec) {
        var m = Math.floor(sec / 60);
        var s = Math.floor(sec % 60);
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function updateCmtDeck() {
        if (!module || !module._js_get_cmt_cmd) return;
        var cmd = 0, pos = 0, end = 0, freq = 0;
        try {
            cmd  =  module._js_get_cmt_cmd()  | 0;
            pos  = (module._js_get_cmt_pos()  >>> 0);
            end  = (module._js_get_cmt_end()  >>> 0);
            freq = (module._js_get_cmt_freq() >>> 0);
        } catch(e) { return; }

        var reelL = document.getElementById('cmt-reel-l');
        var reelR = document.getElementById('cmt-reel-r');
        var animCls = '';
        if      (cmd === CMT_PLAY)                         animCls = 'anim-play';
        else if (cmd === CMT_FF || cmd === CMT_AFF)        animCls = 'anim-ff';
        else if (cmd === CMT_REW || cmd === CMT_AREW)      animCls = 'anim-rew';
        [reelL, reelR].forEach(function(el) {
            if (!el) return;
            el.setAttribute('class', 'cmt-reel-svg' + (animCls ? ' ' + animCls : ''));
        });

        var badge = document.getElementById('cmt-deck-badge');
        if (badge) {
            var labels = {};
            labels[CMT_EJECT] = '● EJECT';
            labels[CMT_STOP]  = '■ STOP';
            labels[CMT_PLAY]  = '▶ 再生中';
            labels[CMT_FF]    = '⏭ 早送り';
            labels[CMT_REW]   = '⏮ 巻戻し';
            labels[CMT_AFF]   = '⏭⏭ A-FF';
            labels[CMT_AREW]  = '⏮⏮ A-REW';
            badge.textContent = labels[cmd] || '■ STOP';
            badge.className   = 'cmt-deck-badge';
            if      (cmd === CMT_STOP)                        badge.classList.add('state-stop');
            else if (cmd === CMT_PLAY)                        badge.classList.add('state-play');
            else if (cmd === CMT_FF || cmd === CMT_AFF)       badge.classList.add('state-ff');
            else if (cmd === CMT_REW || cmd === CMT_AREW)     badge.classList.add('state-rew');
        }

        var btnMap = {
            'cdeck-rew':  { cond: (cmd === CMT_REW || cmd === CMT_AREW), cls: 'on-rew'  },
            'cdeck-stop': { cond: (cmd === CMT_STOP),                    cls: 'on-stop' },
            'cdeck-play': { cond: (cmd === CMT_PLAY),                    cls: 'on-play' },
            'cdeck-ff':   { cond: (cmd === CMT_FF  || cmd === CMT_AFF),  cls: 'on-ff'   }
        };
        Object.keys(btnMap).forEach(function(id) {
            var el = document.getElementById(id);
            if (!el) return;
            var info = btnMap[id];
            el.className = 'cmt-trans-btn' + (info.cond ? ' ' + info.cls : '');
        });

        if (end > 0) {
            var ratio = Math.min(1, Math.max(0, pos / end));
            var rL = Math.round(14 - ratio * 7);
            var rR = Math.round(7  + ratio * 7);
            var tl = document.getElementById('cmt-tape-ring-l');
            var tr = document.getElementById('cmt-tape-ring-r');
            if (tl) tl.setAttribute('r', rL);
            if (tr) tr.setAttribute('r', rR);
        }

        var timeEl = document.getElementById('cmt-deck-time');
        var bar    = document.getElementById('cmt-deck-bar');
        if (freq > 0 && end > 0) {
            var posSec = pos / freq;
            var endSec = end / freq;
            var pct    = Math.min(100, (pos / end) * 100);
            if (timeEl) {
                timeEl.textContent = fmtTime(posSec) + ' / ' + fmtTime(endSec);
                timeEl.className = 'cmt-deck-time loaded';
            }
            if (bar) bar.style.width = pct.toFixed(1) + '%';
        }
    }

    // ----------------------------------------------------------------
    // ボタンハンドラ
    // ----------------------------------------------------------------
    function onStartClick() {
        setupAudioStream();
        if (isRunning) return;
        if (module && module._js_xmil_start) {
            module._js_xmil_start();
            isRunning = true;
            updateStatus('実行中');
            updatePowerBtn();
        }
    }

    function onTestAudioClick() { testAudio(); }

    function onStopClick() {
        if (!isRunning) return;
        if (module && module._js_xmil_stop) {
            module._js_xmil_stop();
            isRunning = false;
            updateStatus('停止中');
            updatePowerBtn();
        }
    }

    async function onResetClick() {
        if (!module || !module._js_xmil_reset) return;
        try {
            await flushAllDirty({strict: true});
        } catch(e) {
            if (!confirm('データの保存に失敗しました。リセットするとデータが失われる可能性があります。続行しますか？')) return;
        }
        module._js_xmil_reset();
        reinitAudioForReset();
        updateStatus('リセット完了');
    }

    async function onPowerToggle() {
        if (!module) return;
        if (isRunning) {
            // 電源 OFF: flush → 停止
            try {
                await flushAllDirty({strict: true});
            } catch(e) {
                if (!confirm('データの保存に失敗しました。電源を切るとデータが失われる可能性があります。続行しますか？')) return;
            }
            if (module._js_xmil_power_off) { module._js_xmil_power_off(); }
            isRunning = false;
            updateStatus('電源 OFF');
            updatePowerBtn();
        } else {
            // 電源 ON: リセットして最初から起動
            setupAudioStream();
            reinitAudioForReset();
            if (module._js_xmil_power_on) { module._js_xmil_power_on(); }
            isRunning = true;
            updateStatus('電源 ON');
            updatePowerBtn();
        }
    }

    async function onIplResetClick() {
        if (!module) return;
        try {
            await flushAllDirty({strict: true});
        } catch(e) {
            if (!confirm('データの保存に失敗しました。IPL リセットするとデータが失われる可能性があります。続行しますか？')) return;
        }
        if (module._js_xmil_reset) { module._js_xmil_reset(); reinitAudioForReset(); }
        updateStatus('IPL リセット');
    }

    function onNmiResetClick() {
        if (!module) return;
        if (module._js_xmil_nmi) { module._js_xmil_nmi(); }
        updateStatus('NMI リセット');
    }

    function updatePowerBtn() {
        var btn = elements.ctrlPower || document.getElementById('ctrl-power');
        if (btn) {
            if (isRunning) btn.classList.add('on');
            else           btn.classList.remove('on');
        }
    }

    function onDiskTypeToggle() {
        if (!elements.dip2hd) return;
        elements.dip2hd.checked = !elements.dip2hd.checked;
        onDipSwChange();
        saveSettings();
        updateDiskTypeSwitch();
    }

    function onResolutionToggle() {
        if (!elements.dipHighres) return;
        elements.dipHighres.checked = !elements.dipHighres.checked;
        onDipSwChange();
        saveSettings();
        updateResolutionSwitch();
    }

    function updateDiskTypeSwitch() {
        var is2hd = elements.dip2hd && elements.dip2hd.checked;
        var el2d  = document.getElementById('sw-disk-2d');
        var el2hd = document.getElementById('sw-disk-2hd');
        if (el2d)  el2d.classList.toggle('active',  !is2hd);
        if (el2hd) el2hd.classList.toggle('active',  !!is2hd);
    }

    function updateResolutionSwitch() {
        var isHigh = elements.dipHighres && elements.dipHighres.checked;
        var elStd  = document.getElementById('sw-res-std');
        var elHigh = document.getElementById('sw-res-high');
        if (elStd)  elStd.classList.toggle('active',  !isHigh);
        if (elHigh) elHigh.classList.toggle('active',  !!isHigh);
    }

    // ROM 選択ハンドラ
    function onRomFileChange(type, event) {
        var file = event.target.files[0];
        if (!file) return;
        var vfsPath = (type === 'x1') ? '/IPLROM.X1' : '/IPLROM.X1T';
        var lsKey   = (type === 'x1') ? LS_ROM_X1    : LS_ROM_X1T;

        var reader = new FileReader();
        reader.onload = function(e) {
            var data = new Uint8Array(e.target.result);
            writeFileToVFS(vfsPath, data);
            saveFile(lsKey, file.name, e.target.result);
            updateRomUI(type, true, file.name);
            if (module && module._js_xmil_reset) {
                module._js_xmil_reset();
                reinitAudioForReset();
            }
            updateStatus('ROM読み込み完了: ' + file.name);
        };
        reader.readAsArrayBuffer(file);
    }

    // ----------------------------------------------------------------
    // 設定変更ハンドラ
    // ----------------------------------------------------------------
    function onRomTypeChange() {
        syncModelBtnActive();
        if (!module || !module._js_set_rom_type) return;
        var checked = document.querySelector('input[name="rom-type"]:checked');
        if (checked) module._js_set_rom_type(parseInt(checked.value, 10));
    }

    function onDipSwChange() {
        if (!module || !module._js_set_dip_sw) return;
        var dip = 0;
        if (!elements.dipHighres || !elements.dipHighres.checked) dip |= 0x01;
        if (elements.dip2hd && elements.dip2hd.checked) dip |= 0x04;
        module._js_set_dip_sw(dip);
    }

    function onSkipLineChange() {
        syncToggleItems();
        if (!module || !module._js_set_skip_line) return;
        module._js_set_skip_line((elements.skipLine && elements.skipLine.checked) ? 1 : 0);
    }

    function onMotorChange() {
        syncToggleItems();
        if (!module || !module._js_set_motor) return;
        module._js_set_motor((elements.motorSound && elements.motorSound.checked) ? 1 : 0);
    }

    function onMotorVolumeChange() {
        var vol = elements.seekVolume ? parseInt(elements.seekVolume.value, 10) : 80;
        if (elements.seekVolumeVal) elements.seekVolumeVal.textContent = vol;
        if (!module || !module._js_set_motor_volume) return;
        module._js_set_motor_volume(vol);
    }

    function onJoystickChange() {
        syncToggleItems();
        var val = (elements.joystickEnable && elements.joystickEnable.checked) ? 1 : 0;
        if (!module || !module._js_set_joystick) return;
        module._js_set_joystick(val);
    }

    function onMouseChange() {
        syncToggleItems();
        var val = (elements.mouseEnable && elements.mouseEnable.checked) ? 1 : 0;
        if (!module || !module._js_set_mouse) return;
        module._js_set_mouse(val);
        // Mouse OFF → Pointer Lock 解除
        if (!val && document.pointerLockElement) {
            document.exitPointerLock();
        }
    }

    function onFmChange() {
        var on = !!(elements.fmEnable && elements.fmEnable.checked);
        if (module && module._js_set_sound_sw) module._js_set_sound_sw(on ? 1 : 0);
        syncToggleItems();
    }

    function onKeyModeChange() {
        syncKeyModeBtnActive();
        var c = document.querySelector('input[name="key-mode"]:checked');
        var mode = c ? parseInt(c.value, 10) : 0;
        if (!module || !module._js_set_key_mode) return;
        module._js_set_key_mode(mode);
    }

    function syncKeyModeBtnActive() {
        var checked = document.querySelector('input[name="key-mode"]:checked');
        var map = { '0': 'cfgbtn-key-std', '1': 'cfgbtn-key-joy1', '2': 'cfgbtn-key-joy2' };
        Object.keys(map).forEach(function(v) {
            var el = document.getElementById(map[v]);
            if (el) el.classList.toggle('active', !!(checked && checked.value === v));
        });
    }

    function syncModelBtnActive() {
        var checked = document.querySelector('input[name="rom-type"]:checked');
        var map = { '1': 'cfgbtn-x1', '2': 'cfgbtn-turbo', '3': 'cfgbtn-turboz' };
        Object.keys(map).forEach(function(v) {
            var el = document.getElementById(map[v]);
            if (el) el.classList.toggle('active', !!(checked && checked.value === v));
        });
    }

    function syncToggleItems() {
        var scanEl  = document.getElementById('cfg-scanline-item');
        var motorEl = document.getElementById('cfg-motor-item');
        var joyEl   = document.getElementById('cfg-joystick-item');
        var mouseEl = document.getElementById('cfg-mouse-item');
        var motorOn = !!(elements.motorSound && elements.motorSound.checked);
        if (scanEl)  scanEl.classList.toggle('on',  !!(elements.skipLine      && elements.skipLine.checked));
        if (motorEl) motorEl.classList.toggle('on', motorOn);
        if (elements.seekVolumeRow) elements.seekVolumeRow.classList.toggle('off', !motorOn);
        if (elements.seekVolume) elements.seekVolume.disabled = !motorOn;
        if (joyEl)   joyEl.classList.toggle('on',   !!(elements.joystickEnable && elements.joystickEnable.checked));
        if (mouseEl) mouseEl.classList.toggle('on', !!(elements.mouseEnable   && elements.mouseEnable.checked));
        var fmEl = document.getElementById('cfg-fm-item');
        if (fmEl) fmEl.classList.toggle('on', !!(elements.fmEnable && elements.fmEnable.checked));
        var statusEl = document.getElementById('cfg-status-item');
        if (statusEl) statusEl.classList.toggle('on', !!(elements.statusToastEnable && elements.statusToastEnable.checked));
        var owEl = document.getElementById('cfg-overwrite-item');
        var owOn = !!(elements.stateOverwrite && elements.stateOverwrite.checked);
        if (owEl) owEl.classList.toggle('on', owOn);
        var saveBtn = document.getElementById('state-quick-save');
        if (saveBtn) {
            saveBtn.classList.toggle('overwrite-on', owOn);
            saveBtn.title = owOn ? 'クイックセーブ（上書き）' : 'クイックセーブ';
        }
        var peEl = document.getElementById('cfg-portable-emm-item');
        var peCb = document.getElementById('cfg-portable-emm');
        if (peEl) peEl.classList.toggle('on', !!(peCb && peCb.checked));
    }

    // ----------------------------------------------------------------
    // UI ユーティリティ
    // ----------------------------------------------------------------
    var _statusTimer = null;
    function updateStatus(text) {
        if (!elements.statusText) return;
        if (elements.statusToastEnable && !elements.statusToastEnable.checked) return;
        elements.statusText.textContent = text;
        elements.statusText.classList.add('visible');
        if (_statusTimer) clearTimeout(_statusTimer);
        _statusTimer = setTimeout(function() {
            elements.statusText.classList.remove('visible');
            _statusTimer = null;
        }, 1000);
    }

    function updateFPS() {
        var now   = performance.now();
        var delta = now - lastTime;
        fps = Math.round((frameCount * 1000) / delta);
        if (elements.fpsText) elements.fpsText.textContent = fps;
        frameCount = 0;
        lastTime = now;
    }

    window.countFrame = function() { frameCount++; };

    // ----------------------------------------------------------------
    // Emscripten モジュール設定
    // ----------------------------------------------------------------
    window.Module = {
        preRun: [function() {}],
        postRun: [function() {
            if (window.__X1PEN_MODE) {
                module = window.Module;  // pre.js 内部の module 参照を設定
                if (window.__x1pen_onModuleReady) window.__x1pen_onModuleReady();
            } else {
                onModuleReady();
            }
        }],
        print:    function(text) { /* リリース: stdout 抑制 */ },
        printErr: function(text) { console.warn('[xmil]', text); },
        canvas: (function() {
            var canvas = document.getElementById('canvas');
            if (canvas) {
                canvas.addEventListener('webglcontextlost', function(e) {
                    alert('WebGL context lost. Please reload the page.');
                    e.preventDefault();
                }, false);
            }
            return canvas;
        })(),
        setStatus: function(text) {},
        monitorRunDependencies: function(left) {},
        onRuntimeInitialized: function() {}
    };

    // ページ読み込み完了時に初期化 (X1Pen モードでは呼ばない)
    if (!window.__X1PEN_MODE) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    }

    // グローバル公開
    window.XMillennium = {
        start:     onStartClick,
        stop:      onStopClick,
        reset:     onResetClick,
        testAudio: testAudio,
        // C++ → JS イベントコールバック
        onFddAccess: function(mask) {
            for (var d = 0; d < 2; d++) {
                if (mask & (1 << d)) flashFddLed(d);
            }
        },
        onFddWrite: function(drive) {
            // FDD 書き込み時のみ dirty マーク (C++ fdd_write_d88/fdd_write_2d から呼ばれる)
            var sn = ['drive0', 'drive1'][drive];
            markSlotDirty(sn);
        },
        onHddWrite: function(id, offset, size) {
            // HDD 書き込み時 dirty マーク + ページ追跡 (C++ sasi_write_block から呼ばれる)
            var sn = ['hdd0', 'hdd1'][id];
            markDirtyRange(sn, offset, size);
        },
        onEmmPageWrite: function(slot, offset, size) {
            // EMM ページ書き込み時 dirty マーク + ページ追跡
            markDirtyRange('emm' + slot, offset, size);
        },
        onCmtStateChange: onCmtStateChange,
        // ステートセーブ/ロード
        saveState:      saveState,
        loadState:      loadState,
        quickSave:      quickSave,
        quickLoad:      quickLoad,
        deleteState:    deleteState,
        deleteAllStates: deleteAllStates,
        renameState:    renameState,
        overwriteState: overwriteState,
        downloadState:  downloadState,
        getStateList:   getStateList,
        clearStorage: async function() {
            if (window.XmilStorage) {
                // Step 1: manifest キーを削除（JSON 破損時は空扱いで続行）
                var manifest = [];
                try {
                    var _raw = localStorage.getItem('xmil_opfs_manifest');
                    var _parsed = JSON.parse(_raw || '[]');
                    if (Array.isArray(_parsed)) manifest = _parsed;
                } catch(e) { /* 破損 JSON → manifest 空 → Step 2 フォールバックに委ねる */ }
                for (var i = 0; i < manifest.length; i++) {
                    try { await window.XmilStorage.remove(manifest[i]); } catch(e) {}
                }
                localStorage.removeItem('xmil_opfs_manifest');

                // Step 2: フォールバック（常時実行）
                // manifest が null/破損/stale でも確実に削除するため、
                // list() で残存エントリを確認し xmil 管理対象キーのみ追加削除する
                var KNOWN_SLOTS = ['disk0.d88', 'disk1.d88', 'cmt.cas', 'hdd0.hdd', 'hdd1.hdd'];
                try {
                    var allEntries = await window.XmilStorage.list();
                    for (var j = 0; j < allEntries.length; j++) {
                        var k = allEntries[j].key;
                        if (k.indexOf('lib_') === 0 || k.indexOf('state_') === 0 || KNOWN_SLOTS.indexOf(k) !== -1) {
                            try { await window.XmilStorage.remove(k); } catch(e) {}
                        }
                    }
                } catch(e) {}
            }
            // localStorage: OPFS削除後にクリア
            [LS_SETTINGS, LS_ROM, LS_ROM_X1, LS_ROM_X1T,
             LS_FNT_ANK8, LS_FNT_ANK16, LS_FNT_KNJ,
             LS_LIBRARY, LS_MOUNT_STATE, LS_STATES, QUICK_STATE_KEY,
             'xmil_drive_links'].forEach(function(k) {
                localStorage.removeItem(k);
            });
            return true;
        }
    };

    // drive_integration.js などの外部モジュールから pre.js 内部機能にアクセスするためのインターフェース
    // 外部から内部オブジェクトを直接書き換えられないよう浅いコピーを返す
    window.XmilCore = {
        addToLibrary:      addToLibrary,
        detectFileType:    detectFileType,
        mountFromLibrary:  mountFromLibrary,
        ejectSlot:         ejectSlot,
        flushSlot:         flushSlot,
        getSlotState:      function() { return Object.assign({}, slotState); },
        getSlotDirty:      function() { return Object.assign({}, slotDirty); },
        getSlotVfsPath:    function() { return Object.assign({}, slotVfsPath); },
        getLibrary:        getLibrary,
        saveLibrary:       saveLibrary,
        renderLibraryList: renderLibraryList,
        updateStatus:      updateStatus,
        // ステートセーブ/ロード
        saveState:         saveState,
        loadState:         loadState,
        quickSave:         quickSave,
        quickLoad:         quickLoad,
        deleteState:       deleteState,
        deleteAllStates:   deleteAllStates,
        renameState:       renameState,
        overwriteState:    overwriteState,
        downloadState:     downloadState,
        getStateList:      getStateList,
        readVfsFile: function(vfsPath) {
            if (!window.Module || !window.Module.FS) return null;
            try { return window.Module.FS.readFile(vfsPath); } catch(e) { return null; }
        }
    };

})();

// X1Pen — FuzzyBASIC IDE application logic
// Requires: x1pen_tokenizer.js, storage.js, xmillennium.js (Emscripten)

// xmillennium.js ロード前にフラグ設定 (CSP 対策: inline script 不可)
window.__X1PEN_MODE = true;

(function() {
    'use strict';

    var COLD_STATE_FILE = 'fuzzybasic_cold.v2.xmst';
    var BOOT_DISK_FILE  = 'fuzzybasic_boot.v2.d88';
    var LSX_COLD_STATE  = 'lsxdodgers_cold.v1.xmst';
    var LSX_BOOT_DISK   = 'lsxdodgers_boot.v1.d88';
    var XMIL_BUILD_HASH = '@@XMIL_BUILD_HASH@@';
    var module = null;
    var lastAsmSymbols = null;  // { symbols: {}, predefined: {}, sourceMode: string }
    var lastAsmTabOrigin = null; // null | 'user' | 'slang-generated'

    var automationReadyState = 'loading';
    var automationReadyResolve;
    var automationReadyReject;
    var automationReadyPromise = new Promise(function(resolve, reject) {
        automationReadyResolve = resolve;
        automationReadyReject = reject;
    });
    // The API exposes the rejection to clients; this handler prevents an unhandled rejection
    // when the page is used normally without an automation client.
    automationReadyPromise.catch(function() {});
    var automationOperationQueue = Promise.resolve();
    var automationPendingOperations = 0;
    var automationKeyAdmission = false;
    var automationPadAdmission = false;
    var automationInputEpoch = 0;
    window.__X1PEN_SYNTHETIC_INPUT_LOCKED = false;
    var runAdmission = null;
    var lastRunDetails = null;
    var RUN_QUEUE_TIMEOUT_MS = 20000;
    var RUN_STALL_WARNING_MS = 30000;
    var automationRevision = 0;
    var automationConnected = false;
    var automationInteractionLocked = false;
    var automationInteractionLockDepth = 0;
    var automationInstanceId = (function() {
        try {
            var saved = sessionStorage.getItem('x1pen_automation_instance_id');
            if (saved) return saved;
            var created = crypto.randomUUID();
            sessionStorage.setItem('x1pen_automation_instance_id', created);
            return created;
        } catch(e) {
            return 'x1pen-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        }
    })();
    // instanceId identifies the tab session and intentionally survives reloads.
    // revisionEpoch binds the in-memory revision counter to this document load.
    var automationRevisionEpoch = (function() {
        try {
            return crypto.randomUUID();
        } catch(e) {
            return 'epoch-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        }
    })();

    function markProgramChanged() {
        automationRevision++;
    }

    // ── FuzzyBASIC addrmap ──

    var COLD_STATE_VERSION = {
        'fuzzybasic_cold.v1.xmst': '1.1L',
        'fuzzybasic_cold.v2.xmst': '1.2L',
    };

    // JSON 読み込み失敗時のフォールバック
    var ADDRMAP_FALLBACK = {
        '1.1L': { TEXTAREA: 0x4A3C, TEXTST: 0x39DC, TEXTED: 0x39DE },
        '1.2L': { TEXTAREA: 0x4A39, TEXTST: 0x39D9, TEXTED: 0x39DB },
    };

    var addrmapVersions = null;

    async function loadAddrmapVersions() {
        if (addrmapVersions) return addrmapVersions;
        try {
            var data = await loadRuntimeAsset('addrmap_versions.json');
            if (!data) return null;
            addrmapVersions = JSON.parse(new TextDecoder().decode(data));
            return addrmapVersions;
        } catch(e) { return null; }
    }

    async function getAddrMapForColdState(coldStateFile) {
        var verName = COLD_STATE_VERSION[coldStateFile];
        if (!verName) return null;
        var versions = await loadAddrmapVersions();
        if (versions && versions[verName] && versions[verName].memory) {
            var mem = versions[verName].memory;
            return {
                TEXTAREA: parseInt(mem.TEXTAREA, 16),
                TEXTST:   parseInt(mem.TEXTST, 16),
                TEXTED:   parseInt(mem.TEXTED, 16),
            };
        }
        return ADDRMAP_FALLBACK[verName] || null;
    }

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

    var COLD_STATE_PATTERN = /^(fuzzybasic|lsxdodgers)_cold\.[A-Za-z0-9._-]+\.xmst$/;
    var BOOT_DISK_PATTERN  = /^(fuzzybasic|lsxdodgers)_boot\.[A-Za-z0-9._-]+\.d88$/;
    function validateAssetName(name, fallback) {
        if (!name || typeof name !== 'string') return fallback;
        var pattern = name.endsWith('.xmst') ? COLD_STATE_PATTERN : BOOT_DISK_PATTERN;
        return pattern.test(name) ? name : fallback;
    }

    function getUserDefaultRuntime() {
        var settings = window.XmilControls ? window.XmilControls.getSettings() : {};
        var model = validateModel(settings.romType, 1);
        var assets = resolveRuntimeAssets(model);
        return { model: model, coldState: assets.coldState, bootDisk: assets.bootDisk, relocAddrs: null, runMode: 'fuzzybasic' };
    }

    // ── Run mode detection ──

    function detectRunMode(basicSrc, asmSrc) {
        if (!basicSrc && asmSrc) return 'lsx';
        return 'fuzzybasic';
    }

    function normalizeRuntimeForRunMode(runtime, runMode) {
        runtime.runMode = runMode;
        if (runMode === 'lsx') {
            runtime.coldState = LSX_COLD_STATE;
            runtime.bootDisk  = LSX_BOOT_DISK;
        } else {
            // fuzzybasic: 常に FuzzyBASIC asset に正規化（LSX asset 混入防止）
            if (!runtime.coldState || runtime.coldState === LSX_COLD_STATE) runtime.coldState = COLD_STATE_FILE;
            if (!runtime.bootDisk || runtime.bootDisk === LSX_BOOT_DISK)   runtime.bootDisk  = BOOT_DISK_FILE;
        }
        return runtime;
    }

    // ── Relocatable binary support ──

    var relocConfig = null;

    async function loadRelocConfig() {
        if (relocConfig) return relocConfig;
        try {
            // 小さいファイルなので毎回サーバーに検証させる (ETag/304)
            var resp = await fetch('reloc/reloc_webapp.json', { cache: 'no-cache' });
            if (!resp.ok) return null;
            var data = await resp.arrayBuffer();
            if (!data) return null;
            relocConfig = JSON.parse(new TextDecoder().decode(data));
            return relocConfig;
        } catch(e) {
            console.warn('[x1pen] Failed to load reloc config:', e);
            return null;
        }
    }

    async function loadREL(filename) {
        var ver = relocConfig ? relocConfig.version : '';
        var suffix = ver ? '?v=' + encodeURIComponent(ver) : '';
        return await loadRuntimeAsset('reloc/' + filename + suffix);
    }

    function getDefaultRelocAddresses(config) {
        var addrs = {};
        for (var key in config.symbols) {
            addrs[key] = parseInt(config.symbols[key].default, 16);
        }
        return addrs;
    }

    function validateRelocAddresses(addrs, config) {
        var defaults = getDefaultRelocAddresses(config);
        var result = {};
        for (var key in defaults) {
            var val = addrs ? addrs[key] : undefined;
            if (typeof val === 'number' && val >= 0 && val <= 0xFFFF && (val & 0xFF) === 0) {
                result[key] = val;
            } else {
                result[key] = defaults[key];
            }
        }
        return result;
    }

    function checkRelocOverlap(addrs, config) {
        var regions = [];
        if (config.fixed_regions) {
            for (var i = 0; i < config.fixed_regions.length; i++) {
                var fr = config.fixed_regions[i];
                regions.push({
                    name: fr.name,
                    start: parseInt(fr.start, 16),
                    end: parseInt(fr.end, 16)
                });
            }
        }
        // 同じ SELF シンボルを持つバイナリは択一（例: PSGAKG/PSGAKM）
        // シンボルごとに最大サイズのバイナリだけを代表として登録
        var selfBySymbol = {};
        for (var key in config.binaries) {
            var info = config.binaries[key];
            var selfGroup = null;
            for (var i = 0; i < info.groups.length; i++) {
                if (info.groups[i].name === 'SELF') { selfGroup = info.groups[i]; break; }
            }
            if (selfGroup) {
                var sym = selfGroup.symbol;
                if (!selfBySymbol[sym] || info.binary_size > selfBySymbol[sym].binary_size) {
                    selfBySymbol[sym] = info;
                }
            }
        }
        for (var sym in selfBySymbol) {
            var info = selfBySymbol[sym];
            var addr = addrs[sym];
            regions.push({ name: info.output_file, start: addr, end: addr + info.binary_size - 1 });
        }
        for (var i = 0; i < regions.length; i++) {
            for (var j = i + 1; j < regions.length; j++) {
                if (regions[i].start <= regions[j].end && regions[j].start <= regions[i].end) {
                    return { overlap: true, a: regions[i], b: regions[j] };
                }
            }
        }
        return { overlap: false };
    }

    var LS_RELOC_ADDRS = 'x1pen_reloc_addrs';

    function getUserRelocAddresses(config) {
        var defaults = getDefaultRelocAddresses(config);
        try {
            var saved = JSON.parse(localStorage.getItem(LS_RELOC_ADDRS));
            if (saved) return validateRelocAddresses(saved, config);
        } catch(e) {}
        return defaults;
    }

    function saveUserRelocAddresses(addrs) {
        try { localStorage.setItem(LS_RELOC_ADDRS, JSON.stringify(addrs)); } catch(e) {}
    }

    function patchREL(relArrayBuffer, groups, symbolAddresses) {
        var view = new DataView(relArrayBuffer);
        var totalLen = relArrayBuffer.byteLength;

        if (totalLen < 5) throw new Error('REL too short');
        var tableSize = view.getUint16(0, true);
        var binarySize = view.getUint16(2, true);
        var groupCount = view.getUint8(4);
        if (tableSize + binarySize > totalLen) throw new Error('REL size mismatch');

        var binary = new Uint8Array(relArrayBuffer.slice(tableSize, tableSize + binarySize));

        var pos = 5;
        for (var g = 0; g < groupCount; g++) {
            if (pos + 20 > tableSize) throw new Error('REL group header overflow');

            var nameBytes = new Uint8Array(relArrayBuffer, pos, 16);
            var name = '';
            for (var k = 0; k < 16 && nameBytes[k]; k++) name += String.fromCharCode(nameBytes[k]);
            pos += 16;

            var defaultAddr = view.getUint16(pos, true); pos += 2;
            var fixupCount = view.getUint16(pos, true); pos += 2;

            if (pos + fixupCount * 2 > tableSize) throw new Error('REL fixup table overflow');

            var groupInfo = null;
            for (var gi = 0; gi < groups.length; gi++) {
                if (groups[gi].name === name) { groupInfo = groups[gi]; break; }
            }
            var newAddr = groupInfo ? symbolAddresses[groupInfo.symbol] : null;

            if (newAddr !== null && newAddr !== undefined) {
                var diff = (newAddr >> 8) - (defaultAddr >> 8);
                for (var i = 0; i < fixupCount; i++) {
                    var offset = view.getUint16(pos + i * 2, true);
                    if (offset >= binary.length) throw new Error('REL fixup offset out of range: ' + offset);
                    binary[offset] = (binary[offset] + diff) & 0xFF;
                }
            }
            pos += fixupCount * 2;
        }
        return binary;
    }

    // デフォルトアドレスと同一か判定 (同一ならリロケート不要)
    function isDefaultRelocAddresses(addrs, config) {
        if (!addrs || !config) return true;
        var defaults = getDefaultRelocAddresses(config);
        for (var key in defaults) {
            if (addrs[key] !== defaults[key]) return false;
        }
        return true;
    }

    // getEffectiveRuntime: getUserDefaultRuntime の async 版。relocAddrs を含む。
    async function getEffectiveRuntime(baseRuntime) {
        var runtime = baseRuntime || getUserDefaultRuntime();
        var config = await loadRelocConfig();
        if (!config) {
            if (runtime.relocAddrs) {
                throw new Error('Relocation assets not available');
            }
            runtime.relocAddrs = null;
        } else {
            if (runtime.relocAddrs) {
                runtime.relocAddrs = validateRelocAddresses(runtime.relocAddrs, config);
            } else {
                runtime.relocAddrs = getUserRelocAddresses(config);
            }
            // 注: デフォルトアドレスでも relocAddrs は保持する
            // (ブートディスクに存在しないバイナリ (GPAINT.BIN 等) の追加が必要なため)
        }
        return runtime;
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
    var LS_EDITOR_SLANG = 'x1pen_editor_slang';

    function persistEditorSources(basic, asm, slang) {
        try {
            localStorage.setItem(LS_EDITOR_BASIC, basic);
            localStorage.setItem(LS_EDITOR_ASM, asm);
            localStorage.setItem(LS_EDITOR_SLANG, slang);
        } catch(e) {
            console.warn('[x1pen] Failed to persist editor sources:', e);
        }
    }

    var elBtnRun    = document.getElementById('btn-run');
    var elBtnRunRecover = document.getElementById('btn-run-recover');
    var elBtnStop   = document.getElementById('btn-stop');
    var elBtnDevReload = document.getElementById('btn-dev-reload');
    var elStatus    = document.getElementById('x1pen-status');
    var elLiveNotice = document.getElementById('x1pen-live-notice');
    var activeTab   = 'basic';

    function isDevAssetMode() {
        var host = location.hostname;
        return host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
               new URLSearchParams(location.search).get('dev') === '1';
    }

    async function reloadAssetsBypassCache() {
        assetCache = {};
        window._slangRuntimeVFS = null; // SLANG ランタイムも再読み込み
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
          onChange: function(text) { markProgramChanged(); try { localStorage.setItem(LS_EDITOR_BASIC, text); } catch(e) {} },
          onFocus: pauseCallbacks.onFocus,
          onBlur:  pauseCallbacks.onBlur }
    );

    var asmEditor = window.X1PenEditor.create(
        document.getElementById('asm-editor-container'),
        { language: 'asm',
          showLineNumbers: true,
          placeholder: '; Z80 Assembly\nORG 0E000h\n    LD A,042h\n    RET',
          onChange: function(text) { markProgramChanged(); lastAsmTabOrigin = 'user'; try { localStorage.setItem(LS_EDITOR_ASM, text); } catch(e) {} },
          onFocus: pauseCallbacks.onFocus,
          onBlur:  pauseCallbacks.onBlur }
    );

    var slangEditor = window.X1PenEditor.create(
        document.getElementById('slang-editor-container'),
        { language: 'slang',
          showLineNumbers: true,
          placeholder: '// SLANG program\nVAR x = 42;\nmain() BEGIN\n  PRINT(x);\nEND;',
          onChange: function(text) { markProgramChanged(); try { localStorage.setItem(LS_EDITOR_SLANG, text); } catch(e) {} },
          onFocus: pauseCallbacks.onFocus,
          onBlur:  pauseCallbacks.onBlur }
    );

    // localStorage から復元 (silent: onChange を発火させない)
    try {
        var savedBasic = localStorage.getItem(LS_EDITOR_BASIC);
        if (savedBasic) basicEditor.setValue(savedBasic, { silent: true });
        var savedAsm = localStorage.getItem(LS_EDITOR_ASM);
        if (savedAsm) { asmEditor.setValue(savedAsm, { silent: true }); lastAsmTabOrigin = 'user'; }
        var savedSlang = localStorage.getItem(LS_EDITOR_SLANG);
        if (savedSlang) slangEditor.setValue(savedSlang, { silent: true });
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

    // FZBASIC.COM の参照アドレスを RAM 上で直接パッチ (cold state 復元後に呼ぶ)
    // REL バイナリ全体で上書きせず、fixup offset の該当バイトだけを変更する
    // (コールドステートの FZBASIC と REL のビルドが異なる可能性があるため)
    async function patchFzbasicInRam(relocAddresses) {
        var config = await loadRelocConfig();
        if (!config || !config.binaries['FZBASIC.REL']) return;

        var binInfo = config.binaries['FZBASIC.REL'];
        var relData = await loadREL(binInfo.rel_file);
        if (!relData) { console.warn('[x1pen] FZBASIC.REL not available'); return; }

        // REL ヘッダからグループ情報と fixup offset を読み取り、RAM を直接パッチ
        var view = new DataView(relData);
        var tableSize = view.getUint16(0, true);
        var groupCount = view.getUint8(4);

        var ramPtr = module._js_get_main_ram();
        var ram = new Uint8Array(module.wasmMemory.buffer, ramPtr, 0x10000);
        var baseAddr = 0x0100; // FZBASIC.COM のロードアドレス
        var patchCount = 0;

        var pos = 5;
        for (var g = 0; g < groupCount; g++) {
            if (pos + 20 > tableSize) break;
            var nameBytes = new Uint8Array(relData, pos, 16);
            var name = '';
            for (var k = 0; k < 16 && nameBytes[k]; k++) name += String.fromCharCode(nameBytes[k]);
            pos += 16;

            var defaultAddr = view.getUint16(pos, true); pos += 2;
            var fixupCount = view.getUint16(pos, true); pos += 2;

            if (pos + fixupCount * 2 > tableSize) break;

            // JSON の groups からシンボル名を引く
            var groupInfo = null;
            for (var gi = 0; gi < binInfo.groups.length; gi++) {
                if (binInfo.groups[gi].name === name) { groupInfo = binInfo.groups[gi]; break; }
            }
            var newAddr = groupInfo ? relocAddresses[groupInfo.symbol] : null;

            if (newAddr !== null && newAddr !== undefined && newAddr !== defaultAddr) {
                var diff = (newAddr >> 8) - (defaultAddr >> 8);
                for (var i = 0; i < fixupCount; i++) {
                    var offset = view.getUint16(pos + i * 2, true);
                    var ramOffset = baseAddr + offset;
                    if (ramOffset < 0x10000) {
                        ram[ramOffset] = (ram[ramOffset] + diff) & 0xFF;
                        patchCount++;
                    }
                }
            }
            pos += fixupCount * 2;
        }
        if (patchCount > 0) {
            console.log('[x1pen] FZBASIC.COM: patched ' + patchCount + ' bytes in RAM');
        } else {
            console.log('[x1pen] FZBASIC.COM: no address changes needed');
        }
    }

    async function injectProgram(tokenizedBytes, coldStateFile) {
        var addrs = await getAddrMapForColdState(coldStateFile);
        if (!addrs) return false;  // 未知バージョン

        var ramPtr = module._js_get_main_ram();
        var ram = new Uint8Array(module.wasmMemory.buffer, ramPtr, 0x10000);

        // TEXTST 読取 (cold state では TEXTAREA を指す)
        var textStart = ram[addrs.TEXTST] | (ram[addrs.TEXTST + 1] << 8);
        if (textStart === 0) textStart = addrs.TEXTAREA;

        // トークン化バイト列を書き込み
        for (var i = 0; i < tokenizedBytes.length; i++) {
            ram[textStart + i] = tokenizedBytes[i];
        }

        // TEXTED 更新 (0x0000 ターミネータの先頭を指す)
        var textEnd = textStart + tokenizedBytes.length - 2;
        ram[addrs.TEXTED]     = textEnd & 0xFF;
        ram[addrs.TEXTED + 1] = (textEnd >> 8) & 0xFF;
        return true;
    }

    // ── キー注入 ──
    // JoyKey では Enter が keyboard_inkey で落ちるため、合成キー送信中だけ実機 KEY_MODE を KB にする。
    // 永続設定(localStorage)は触らない。重なった送信は参照カウントで全完了まで KB を維持する。

    var syntheticKeyDepth = 0;
    var syntheticKeyRestoreMode = null;

    function getConfiguredKeyMode(fallback) {
        try {
            if (window.XmilControls && window.XmilControls.getSettings) {
                var mode = window.XmilControls.getSettings().keyMode;
                if (mode === 0 || mode === 1 || mode === 2) return mode;
            }
        } catch (e) {}
        return fallback;
    }

    function enterSyntheticKeyboardMode(prevMode) {
        if (!module || !module._js_set_key_mode || prevMode === 0) return false;
        if (syntheticKeyDepth === 0) {
            try {
                module._js_set_key_mode(0);
            } catch (e) {
                return false;  // 切替失敗時は depth を増やさない
            }
            syntheticKeyRestoreMode = prevMode;
        }
        syntheticKeyDepth++;
        return true;
    }

    function leaveSyntheticKeyboardMode(switched) {
        if (!switched) return;
        syntheticKeyDepth = Math.max(0, syntheticKeyDepth - 1);
        if (syntheticKeyDepth === 0) {
            var restoreMode = getConfiguredKeyMode(syntheticKeyRestoreMode);
            syntheticKeyRestoreMode = null;
            if (module && module._js_set_key_mode && restoreMode !== null) {
                module._js_set_key_mode(restoreMode);
            }
        }
    }

    var SYNTHETIC_KEY_HOLD_MS = 80;
    var SYNTHETIC_KEY_MAX_HOLD_MS = 2000;
    var automationInputQueue = Promise.resolve();

    function waitForSyntheticKey(ms) {
        return new Promise(function(resolve) { setTimeout(resolve, ms); });
    }

    function setSyntheticInputLocked(locked) {
        if (!module || typeof module._js_set_automation_input_lock !== 'function') return false;
        module._js_set_automation_input_lock(locked ? 1 : 0);
        window.__X1PEN_SYNTHETIC_INPUT_LOCKED = !!locked;
        return true;
    }

    async function runSyntheticKeySequence(keys, gapMs, holdMs) {
        // `gapMs` is the idle gap after a key is released. Keeping one key's
        // full lifecycle in this loop prevents delayed/coalesced timers from
        // overlapping key presses.
        gapMs = (gapMs === undefined) ? 100 : gapMs;
        holdMs = (holdMs === undefined) ? SYNTHETIC_KEY_HOLD_MS : holdMs;
        if (!keys || keys.length === 0) return Promise.resolve();

        var prevMode = getConfiguredKeyMode(0);
        var inputGated = setSyntheticInputLocked(true);

        // This switches the emulator module directly and intentionally leaves
        // the persistent XmilControls settings store unchanged.
        var switched = enterSyntheticKeyboardMode(prevMode);

        try {
            for (var i = 0; i < keys.length; i++) {
                var vk = keys[i];
                var keyIsDown = false;
                try {
                    module._js_key_down(vk);
                    keyIsDown = true;
                    await waitForSyntheticKey(holdMs);
                } finally {
                    if (keyIsDown) {
                        module._js_key_up(vk);
                    }
                }
                if (i < keys.length - 1) {
                    await waitForSyntheticKey(gapMs);
                }
            }
        } finally {
            try {
                leaveSyntheticKeyboardMode(switched);
            } finally {
                if (inputGated) {
                    try {
                        setSyntheticInputLocked(false);
                    } finally {
                        window.__X1PEN_SYNTHETIC_INPUT_LOCKED = false;
                    }
                }
            }
        }
    }

    function queueAutomationInput(operation) {
        var result = automationInputQueue.then(operation);
        // A failed input operation must not poison later RUN/PROG or MCP input.
        automationInputQueue = result.catch(function() {});
        return result;
    }

    function simulateKeys(keys, gapMs, holdMs) {
        return queueAutomationInput(function() {
            return runSyntheticKeySequence(keys, gapMs, holdMs);
        });
    }

    function simulateRunCommand() {
        return simulateKeys([0x52, 0x55, 0x4E, 0x0D], 100);  // R, U, N, Enter
    }

    function simulateProgCommand() {
        return simulateKeys([0x50, 0x52, 0x4F, 0x47, 0x0D], 50);  // P, R, O, G, Enter
    }

    function isSupportedAutomationKeyCode(code) {
        if (!Number.isInteger(code)) return false;
        if ((code >= 0x30 && code <= 0x39) ||
            (code >= 0x41 && code <= 0x5A) ||
            (code >= 0x70 && code <= 0x7B) ||
            (code >= 0x21 && code <= 0x28) ||
            (code >= 0x2D && code <= 0x2E) ||
            (code >= 0x60 && code <= 0x6B) ||
            (code >= 0x6D && code <= 0x6F)) return true;
        return [
            0x08, 0x09, 0x0D, 0x13, 0x1B, 0x20,
            0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xBF, 0xC0,
            0xDB, 0xDC, 0xDD, 0xDE, 0xE2
        ].indexOf(code) >= 0;
    }

    function createAutomationInputError(code, message) {
        var error = new Error(message);
        error.code = code;
        error.component = 'x1pen';
        error.feature = 'input.keyboard';
        return error;
    }

    function isAutomationKeyboardAvailable() {
        return !!module &&
            typeof module._js_key_down === 'function' &&
            typeof module._js_key_up === 'function' &&
            typeof module._js_set_automation_input_lock === 'function';
    }

    function assertAutomationKeyboardReady() {
        if (automationReadyState !== 'ready' || !isAutomationKeyboardAvailable()) {
            throw createAutomationInputError(
                'INPUT_UNAVAILABLE', 'X1Pen keyboard input is not ready'
            );
        }
        if (document.visibilityState !== 'visible') {
            throw createAutomationInputError(
                'INPUT_TAB_NOT_VISIBLE', 'X1Pen keyboard input requires a visible tab'
            );
        }
    }

    function sendAutomationKey(code, durationMs) {
        if (!isSupportedAutomationKeyCode(code)) {
            return Promise.reject(createAutomationInputError(
                'INVALID_INPUT', 'code must be a supported X1Pen virtual-key integer'
            ));
        }
        if (durationMs === undefined) durationMs = SYNTHETIC_KEY_HOLD_MS;
        if (!Number.isInteger(durationMs) ||
            durationMs < SYNTHETIC_KEY_HOLD_MS || durationMs > SYNTHETIC_KEY_MAX_HOLD_MS) {
            return Promise.reject(createAutomationInputError(
                'INVALID_INPUT', 'durationMs must be an integer from 80 to 2000'
            ));
        }
        try {
            assertAutomationKeyboardReady();
        } catch (error) {
            return Promise.reject(error);
        }
        if (automationKeyAdmission) {
            return Promise.reject(createAutomationInputError(
                'INPUT_IN_PROGRESS', 'Another X1Pen key request is already pending'
            ));
        }
        automationKeyAdmission = true;
        return queueAutomationOperation(function() {
            // Recheck immediately before dispatch because the request may have
            // waited behind another Automation operation.
            assertAutomationKeyboardReady();
            return simulateKeys([code], 0, durationMs).then(function() {
                return { ok: true, code: code, durationMs: durationMs };
            });
        }).finally(function() {
            automationKeyAdmission = false;
        });
    }

    function createAutomationPadError(code, message) {
        var error = new Error(message);
        error.code = code;
        error.component = 'x1pen';
        error.feature = 'input.pad';
        return error;
    }

    function isAutomationPadAvailable() {
        return !!module &&
            typeof module._js_set_automation_pad === 'function' &&
            typeof module._js_release_automation_pads === 'function';
    }

    function assertAutomationPadReady() {
        if (automationReadyState !== 'ready' || !isAutomationPadAvailable()) {
            throw createAutomationPadError('INPUT_UNAVAILABLE', 'X1Pen pad input is not ready');
        }
        if (document.visibilityState !== 'visible') {
            throw createAutomationPadError(
                'INPUT_TAB_NOT_VISIBLE', 'X1Pen pad input requires a visible tab'
            );
        }
    }

    function validateAutomationPadRequest(port, bits) {
        if (!Number.isInteger(port) || (port !== 1 && port !== 2)) {
            throw createAutomationPadError('INVALID_INPUT', 'port must be 1 or 2');
        }
        if (!Number.isInteger(bits) || bits < 0 || bits > 0xFF) {
            throw createAutomationPadError('INVALID_INPUT', 'bits must be an integer from 0 to 255');
        }
    }

    function releaseAutomationPad(port) {
        automationInputEpoch++;
        if (!isAutomationPadAvailable()) {
            return Promise.reject(createAutomationPadError(
                'INPUT_UNAVAILABLE', 'X1Pen pad input is not ready'
            ));
        }
        try {
            if (module._js_set_automation_pad(port, 0xFF) !== 1) {
                throw createAutomationPadError('INPUT_UNAVAILABLE', 'X1Pen rejected pad release');
            }
            return Promise.resolve({ ok: true, port: port, bits: 0xFF });
        } catch (error) {
            return Promise.reject(error);
        }
    }

    function releaseAllAutomationPads() {
        automationInputEpoch++;
        if (!isAutomationPadAvailable()) return { ok: false, released: false };
        module._js_release_automation_pads();
        return { ok: true, released: true, bits: [0xFF, 0xFF] };
    }

    function setAutomationPad(port, bits) {
        try {
            validateAutomationPadRequest(port, bits);
        } catch (error) {
            return Promise.reject(error);
        }
        // A full release is cleanup, not a press: it must work while hidden or
        // while an older press is queued, and invalidates that queued press.
        if (bits === 0xFF) return releaseAutomationPad(port);
        try {
            assertAutomationPadReady();
        } catch (error) {
            return Promise.reject(error);
        }
        if (automationPadAdmission) {
            return Promise.reject(createAutomationPadError(
                'PAD_INPUT_IN_PROGRESS', 'Another X1Pen pad request is already pending'
            ));
        }
        automationPadAdmission = true;
        var requestEpoch = automationInputEpoch;
        return queueAutomationOperation(function() {
            return queueAutomationInput(function() {
                assertAutomationPadReady();
                if (requestEpoch !== automationInputEpoch) {
                    throw createAutomationPadError(
                        'PAD_INPUT_CANCELLED', 'X1Pen pad request was superseded by cleanup'
                    );
                }
                if (module._js_set_automation_pad(port, bits) !== 1) {
                    throw createAutomationPadError('INPUT_UNAVAILABLE', 'X1Pen rejected pad input');
                }
                return { ok: true, port: port, bits: bits };
            });
        }).finally(function() {
            automationPadAdmission = false;
        });
    }

    function inferSourceMode(basicSrc, asmSrc, slangSrc) {
        if (slangSrc) return 'slang';
        if (!basicSrc && asmSrc) return 'asm';
        return 'basic+asm';
    }

    async function ensureSlangToolchain() {
        if (!window.X1PenSlangCompiler) {
            await new Promise(function(resolve, reject) {
                var s = document.createElement('script');
                s.src = 'x1pen_slang_compiler.js' + ((XMIL_BUILD_HASH && XMIL_BUILD_HASH.indexOf('@@') < 0) ? '?v=' + XMIL_BUILD_HASH : '');
                s.onload = resolve;
                s.onerror = function() { reject(new Error('Failed to load SLANG compiler')); };
                document.head.appendChild(s);
            });
        }
        if (window._slangRuntimeVFS) return;

        var runtimeFiles = [
            'runtime.asm', 'core.asm', 'opt.asm', 'libfloat.asm',
            'liblsx_base.asm', 'libx1_base.asm', 'libx1_grp.asm',
            'liblsx_input.asm', 'libx1_print.asm', 'liblsx_file.asm',
            'libx1_pcg.asm', 'libmag.asm', 'libm8a.asm', 'libx1_psg.asm',
            'libcompress.asm', 'libsoroban.asm', 'libx1_magic.asm', 'libx1_sgl_lsx.asm',
        ];
        var includeFiles = [
            'GRAPH.LIB', 'GRAPHF.LIB', 'SOROBAN.LIB',
            'CHIPLIB.LIB', 'SPRLIB.LIB', 'TILELIB.LIB', 'TILESPR.LIB', 'UILIB.LIB',
        ];
        var vfs = {};
        var vBust = (XMIL_BUILD_HASH && XMIL_BUILD_HASH.indexOf('@@') < 0) ? '?v=' + XMIL_BUILD_HASH : '';
        for (var ri = 0; ri < runtimeFiles.length; ri++) {
            try {
                var resp = await fetch('slang_runtime/' + runtimeFiles[ri] + vBust);
                if (resp.ok) vfs[runtimeFiles[ri]] = await resp.text();
            } catch(e) { /* optional file */ }
        }
        for (var ii = 0; ii < includeFiles.length; ii++) {
            try {
                var iresp = await fetch('slang_include/' + includeFiles[ii] + vBust);
                if (iresp.ok) vfs[includeFiles[ii]] = await iresp.text();
            } catch(e) { /* optional file */ }
        }
        window._slangRuntimeVFS = vfs;
    }

    async function getPredefinedSymbols(coldStateFile) {
        var predefined = { OS_TYPE: 0, ENV_TYPE: 1 };
        var versions = await loadAddrmapVersions();
        var verName = COLD_STATE_VERSION[coldStateFile];
        if (!versions || !verName || !versions[verName]) return predefined;

        var ver = versions[verName];
        var groups = [ver.user_hooks, ver.sound, ver.graphics];
        for (var gi = 0; gi < groups.length; gi++) {
            var group = groups[gi];
            if (!group) continue;
            for (var key in group) predefined[key] = parseInt(group[key], 16);
        }
        return predefined;
    }

    // ── RUN ──

    function normalizeRunOrigin(origin, internal) {
        if (internal && (origin === 'ui' || origin === 'share')) return origin;
        return origin === 'mcp' ? 'mcp' : 'automation';
    }

    function getRunAdmissionSnapshot() {
        if (!runAdmission) return { pending: false, origin: null, phase: 'idle', ageMs: 0, phaseAgeMs: 0 };
        var now = performance.now();
        return {
            pending: true,
            origin: runAdmission.origin,
            phase: runAdmission.phase,
            ageMs: Math.max(0, Math.round(now - runAdmission.createdAt)),
            phaseAgeMs: Math.max(0, Math.round(now - runAdmission.phaseAt))
        };
    }

    function announceRunNotice(message) {
        if (elLiveNotice) elLiveNotice.textContent = message || '';
    }

    function refreshRunTriggerState() {
        if (!elBtnRun) return;
        var ready = automationReadyState === 'ready';
        var pending = !!runAdmission;
        elBtnRun.disabled = !ready || automationInteractionLocked;
        if (pending) {
            elBtnRun.setAttribute('aria-disabled', 'true');
            elBtnRun.setAttribute('aria-busy', 'true');
        } else {
            elBtnRun.removeAttribute('aria-disabled');
            elBtnRun.removeAttribute('aria-busy');
        }
        if (elBtnRunRecover) {
            var stalled = !!runAdmission && runAdmission.phase === 'stalled';
            elBtnRunRecover.classList.toggle('hidden', !stalled);
            elBtnRunRecover.disabled = !stalled;
        }
    }

    function tryReserveRun(origin, phase) {
        if (runAdmission) return null;
        var token = {};
        var now = performance.now();
        runAdmission = {
            token: token,
            origin: origin,
            phase: phase || 'reserved',
            createdAt: now,
            phaseAt: now,
            stallTimer: null
        };
        refreshRunTriggerState();
        return token;
    }

    function transitionRunToExecuting(token) {
        if (!runAdmission || runAdmission.token !== token ||
            (runAdmission.phase !== 'reserved' && runAdmission.phase !== 'queued')) return false;
        runAdmission.phase = 'executing';
        runAdmission.phaseAt = performance.now();
        runAdmission.stallTimer = setTimeout(function() {
            if (!runAdmission || runAdmission.token !== token || runAdmission.phase !== 'executing') return;
            runAdmission.phase = 'stalled';
            runAdmission.phaseAt = performance.now();
            announceRunNotice('Run setup appears stalled. Reloading preserves editor source but loses emulator RAM and unpersisted disk changes.');
            refreshRunTriggerState();
        }, RUN_STALL_WARNING_MS);
        refreshRunTriggerState();
        return true;
    }

    function releaseRun(token) {
        if (!runAdmission || runAdmission.token !== token) return;
        if (runAdmission.phase === 'recovering') return;
        var stallTimer = runAdmission.stallTimer;
        runAdmission = null;
        if (stallTimer) clearTimeout(stallTimer);
        try {
            refreshRunTriggerState();
        } catch (error) {
            console.warn('[x1pen] Failed to refresh Run trigger after release:', error);
        }
    }

    function makeRunResult(ok, code, status, retryable, retryAfterMs) {
        var result = {
            ok: !!ok,
            status: status || (elStatus ? elStatus.textContent : ''),
            sourceMode: getAutomationProgram().sourceMode,
            revision: automationRevision
        };
        if (code) result.code = code;
        if (retryable !== undefined) result.retryable = !!retryable;
        if (retryAfterMs !== undefined) result.retryAfterMs = retryAfterMs;
        if (!ok && runAdmission) result.activeOrigin = runAdmission.origin;
        if (lastRunDetails) Object.keys(lastRunDetails).forEach(function(key) { result[key] = lastRunDetails[key]; });
        return result;
    }

    function makeRunBusyResult() {
        return makeRunResult(false, 'RUN_IN_PROGRESS', 'Run setup is already in progress', true, 500);
    }

    function makeRunQueueTimeoutResult(origin) {
        var result = makeRunResult(false, 'RUN_QUEUE_TIMEOUT', 'Run did not start before the Automation queue timeout', false);
        result.activeOrigin = origin;
        return result;
    }

    async function executeReservedRun(token) {
        if (!transitionRunToExecuting(token)) return makeRunBusyResult();
        try {
            lastRunDetails = null;
            var ok = await performRun(token);
            return makeRunResult(ok);
        } finally {
            releaseRun(token);
        }
    }

    async function onRunClick(origin) {
        var normalizedOrigin = normalizeRunOrigin(origin, true);
        var token = tryReserveRun(normalizedOrigin, 'reserved');
        if (!token) {
            announceRunNotice('Run already in progress');
            return false;
        }
        var result = await executeReservedRun(token);
        return result.ok;
    }

    function recoverStalledRun(confirmDataLoss) {
        var warning = 'Reloading preserves editor source but loses emulator RAM and unpersisted disk changes.';
        if (!confirmDataLoss) {
            return { ok: false, code: 'RECOVERY_CONFIRM_REQUIRED', status: warning };
        }
        if (!runAdmission || runAdmission.phase !== 'stalled') {
            return { ok: false, code: 'RECOVERY_NOT_STALLED', status: 'Run setup is not stalled' };
        }
        persistEditorSources(
            basicEditor ? basicEditor.getValue() : '',
            asmEditor ? asmEditor.getValue() : '',
            slangEditor ? slangEditor.getValue() : ''
        );
        var snapshot = getRunAdmissionSnapshot();
        runAdmission.phase = 'recovering';
        runAdmission.phaseAt = performance.now();
        refreshRunTriggerState();
        return {
            ok: true,
            code: 'RECOVERY_ACCEPTED',
            status: warning,
            activeOrigin: snapshot.origin,
            ageMs: snapshot.ageMs,
            reloadRequired: true
        };
    }

    async function performRun(token) {
        if (!runAdmission || runAdmission.token !== token) {
            console.warn('[x1pen] performRun called without the active Run token');
            return false;
        }
        if (!module) return false;

        // 0. sourceMode / runMode 判定
        var basicSrc = basicEditor.getValue().trim();
        var asmSrc = asmEditor ? asmEditor.getValue().trim() : '';
        var slangSrc = slangEditor ? slangEditor.getValue().trim() : '';

        // sourceMode 判定
        var sourceMode;
        if (pendingShareRuntime && pendingShareRuntime.sourceMode) {
            sourceMode = pendingShareRuntime.sourceMode;
        } else {
            sourceMode = inferSourceMode(basicSrc, asmSrc, slangSrc);
        }

        if (!basicSrc && !asmSrc && !slangSrc) {
            elStatus.textContent = 'Nothing to run';
            return false;
        }

        // SLANG → コンパイル → ASM に変換
        if (sourceMode === 'slang') {
            elStatus.textContent = 'Compiling SLANG...';
            try {
                await ensureSlangToolchain();
            } catch(e) {
                elStatus.textContent = e.message;
                return false;
            }

            // X1 環境固定 (ENV_TYPE: 0=CP/M, 1=LSX-Dodgers, 2=MSX-DOS)
            var slangEnv = { defaultOrg: 0x100, codeReadonly: false, defines: { ENV_TYPE: 1 } };
            var slangResult = window.X1PenSlangCompiler.compile(slangSrc, window._slangRuntimeVFS, slangEnv);
            if (slangResult.errors && slangResult.errors.length > 0) {
                var firstErr = slangResult.errors[0];
                elStatus.textContent = 'SLANG: ' + (firstErr.message || firstErr);
                clearSymbols();
                return false;
            }
            // コンパイル結果の ASM を使う
            asmSrc = slangResult.asm;
            // ASM タブにユーザーの手書き ASM がある場合は確認
            if (asmEditor && lastAsmTabOrigin === 'user' && asmEditor.getValue().trim()) {
                if (!confirm('ASM タブの内容が上書きされます。よろしいですか？')) {
                    return false;
                }
            }
            // ASM タブにコンパイル結果を表示
            if (asmEditor) {
                asmEditor.setValue(asmSrc, { silent: true });
                lastAsmTabOrigin = 'slang-generated';
                markProgramChanged();
            }
            elStatus.textContent = 'SLANG compiled (' + asmSrc.split('\n').length + ' lines)';
        }

        var isSharedRun = !!pendingShareRuntime;
        var runMode;
        if (pendingShareRuntime && pendingShareRuntime.runMode) {
            runMode = pendingShareRuntime.runMode;
        } else if (sourceMode === 'slang' || sourceMode === 'asm') {
            runMode = 'lsx';
        } else {
            runMode = detectRunMode(basicSrc, asmSrc);
        }
        var isLsxMode = (runMode === 'lsx');

        // 1. effective runtime を決定 (async: relocAddrs を含む)
        var baseRuntime = pendingShareRuntime || getUserDefaultRuntime();
        pendingShareRuntime = null;
        normalizeRuntimeForRunMode(baseRuntime, runMode);
        var runtime;
        try {
            runtime = await getEffectiveRuntime(baseRuntime);
        } catch(e) {
            elStatus.textContent = e.message;
            return false;
        }

        var mountedProjectSelection = null;
        if (window.XmilLibrary && window.XmilLibrary.inspectMountedProjectDisk) {
            try {
                mountedProjectSelection = await window.XmilLibrary.inspectMountedProjectDisk();
            } catch(e) {
                elStatus.textContent = e.message;
                lastRunDetails = { code: e.code || 'PROJECT_DISK_READ_FAILED' };
                return false;
            }
        }

        // 衝突チェック (Conflict check オプション ON 時のみ)
        var overlapChk = document.getElementById('ec-addr-overlap-check');
        if (runtime.relocAddrs && overlapChk && overlapChk.checked) {
            var config = await loadRelocConfig();
            if (config) {
                var overlap = checkRelocOverlap(runtime.relocAddrs, config);
                if (overlap.overlap) {
                    elStatus.textContent = 'Address conflict: ' + overlap.a.name + ' / ' + overlap.b.name;
                    return false;
                }
            }
        }

        // 2. MODEL を適用
        if (module._js_set_rom_type) module._js_set_rom_type(runtime.model);

        // 3. runtime asset をロード (キャッシュヒットすれば高速)
        var actualColdState = runtime.coldState;
        var actualBootDisk = runtime.bootDisk;

        var stateData = null;
        var bootData = null;
        if (!mountedProjectSelection) {
            stateData = await loadRuntimeAsset(runtime.coldState);
            if (!stateData && !isLsxMode && runtime.coldState !== COLD_STATE_FILE) {
                // FuzzyBASIC モードのみ fallback（LSX モードでは fallback しない）
                console.warn('[x1pen] Fallback to current cold state');
                stateData = await loadRuntimeAsset(COLD_STATE_FILE);
                if (stateData) actualColdState = COLD_STATE_FILE;
            }
            bootData = await loadRuntimeAsset(runtime.bootDisk);
            if (!bootData && !isLsxMode && runtime.bootDisk !== BOOT_DISK_FILE) {
                console.warn('[x1pen] Fallback to current boot disk');
                bootData = await loadRuntimeAsset(BOOT_DISK_FILE);
                if (bootData) actualBootDisk = BOOT_DISK_FILE;
            }
        }

        if (!stateData && !mountedProjectSelection) {
            elStatus.textContent = 'Failed to load cold state';
            return false;
        }

        // lastUsedRuntime を記録 (再 Share 用、state restore 後に model 更新)
        lastUsedRuntime = { model: runtime.model, coldState: actualColdState, bootDisk: actualBootDisk, relocAddrs: runtime.relocAddrs, runMode: runMode };
        lastRunWasShared = isSharedRun;

        var hasProgramDisk = false;

        // 4. ASM アセンブル (タブに内容がある場合)
        //    addrmap から predefined symbols を構築
        var predefined = await getPredefinedSymbols(actualColdState);

        var asmResult = null;
        if (asmSrc) {
            asmResult = window.X1PenZ80Asm.assemble(asmSrc, predefined);
            if (asmResult.errors.length > 0) {
                elStatus.textContent = 'ASM error (L' + asmResult.errors[0].line + '): ' +
                                       asmResult.errors[0].msg;
                clearSymbols();
                return false;
            }
            // シンボルテーブル保存
            lastAsmSymbols = {
                symbols: asmResult.symbols,
                predefined: (function() { var u = {}; for (var pk in predefined) u[pk.toUpperCase()] = predefined[pk]; return u; })(),
                sourceMode: sourceMode
            };
            var symBtn = document.getElementById('btn-symbols');
            if (symBtn) symBtn.disabled = false;

            if (asmResult.bytes.length > 0) {
                var orgAddr = asmResult.org;
                var endAddr = orgAddr + asmResult.bytes.length - 1;
                elStatus.textContent = 'ASM: ' + asmResult.bytes.length + ' bytes (' +
                    orgAddr.toString(16).toUpperCase().padStart(4, '0') + 'h-' +
                    endAddr.toString(16).toUpperCase().padStart(4, '0') + 'h)';
            }
        } else {
            // ASM なし（BASIC only）
            clearSymbols();
        }

        // 5. BASIC ソースをトークナイズ (FuzzyBASIC モードのみ)
        var tokenized = null;
        if (!isLsxMode && basicSrc) {
            try {
                tokenized = window.X1PenTokenizer.tokenizeProgram(basicSrc);
            } catch(e) {
                elStatus.textContent = 'Tokenize error: ' + e.message;
                return false;
            }
        }

        var asmBytes = (asmResult && asmResult.bytes.length > 0) ? asmResult.bytes : null;

        // LSX モードで ASM バイナリが 0 byte なら実行不可
        if (isLsxMode && !asmBytes) {
            elStatus.textContent = 'Nothing to run (ASM produced no bytes)';
            return false;
        }

        // Library-backed FDD0: fork/update the persistent X1Pen project copy,
        // then boot it normally. No cold state or temporary disk is used here.
        if (mountedProjectSelection) {
            var projectApi = window.X1PenProjectDisk;
            if (!projectApi) {
                elStatus.textContent = 'Project disk support is unavailable';
                lastRunDetails = { code: 'PROJECT_DISK_UNAVAILABLE' };
                return false;
            }
            var preview;
            try {
                preview = projectApi.inspect(
                    mountedProjectSelection.bytes,
                    mountedProjectSelection.entry.name,
                    runMode
                );
            } catch(e) {
                elStatus.textContent = e.message;
                lastRunDetails = { code: e.code || 'PROJECT_DISK_INVALID' };
                return false;
            }
            if (!mountedProjectSelection.entry.x1penProject) {
                var origin = runAdmission ? runAdmission.origin : 'automation';
                if (origin !== 'ui' && origin !== 'share') {
                    elStatus.textContent = 'Run once from the X1Pen UI to create a project copy of the mounted FDD0 disk';
                    lastRunDetails = {
                        code: 'PROJECT_DISK_SETUP_REQUIRED',
                        retryable: false,
                        action: 'Run once interactively in X1Pen, confirm project-copy creation, then retry.'
                    };
                    return false;
                }
                var managedNames = isLsxMode ? 'PROG.COM and AUTOEXEC.BAT' :
                    ((asmBytes ? 'PROGRAM.BIN, ' : '') + 'AUTORUN.BAS and AUTOEXEC.BAT');
                var warningText = preview.warnings.length
                    ? '\n\nWarnings:\n- ' + preview.warnings.join('\n- ')
                    : '';
                var confirmed = confirm(
                    'Create a persistent X1Pen project copy of "' + mountedProjectSelection.entry.name + '"?\n\n' +
                    'The copy will be named <source>-X1Pen (with a number if needed).\n' +
                    'X1Pen will update ' + managedNames + ' in the copy.\n' +
                    'Guest writes already made to the source disk are flushed normally before copying.\n' +
                    'The source is not changed by X1Pen program/AUTOEXEC edits.\n\n' +
                    'Validation checks the LSX filesystem only; boot and program execution are NOT verified.\n' +
                    'Starting the copy performs a cold power-on and clears emulator RAM.' + warningText
                );
                if (!confirmed) {
                    elStatus.textContent = 'Project disk setup cancelled';
                    lastRunDetails = { code: 'PROJECT_DISK_SETUP_CANCELLED', bootVerified: false };
                    return false;
                }
            }

            var transaction = null;
            try {
                transaction = await window.XmilLibrary.beginProjectDiskTransaction();
                var projectFiles = [];
                if (asmBytes) {
                    projectFiles.push({
                        name: isLsxMode ? 'PROG.COM' : 'PROGRAM.BIN',
                        data: new Uint8Array(asmBytes)
                    });
                }
                if (tokenized) projectFiles.push({ name: 'AUTORUN.BAS', data: tokenized });
                var relocationFiles = await collectRelocationDiskFiles(runtime.relocAddrs);
                projectFiles = projectFiles.concat(relocationFiles);
                var prepared = projectApi.prepare(transaction.bytes, transaction.entry.name, {
                    mode: runMode,
                    previousMode: transaction.entry.projectMode || null,
                    files: projectFiles
                });
                var projectEntry = await window.XmilLibrary.commitProjectDiskTransaction(
                    transaction, prepared.bytes, runMode
                );
                var machine = window.XmilControls.coldPowerOnProjectDisk(runtime.model, transaction.otherSlots);
                if (module._js_debug_resume) module._js_debug_resume();
                lastUsedRuntime = {
                    model: machine.model,
                    coldState: actualColdState,
                    bootDisk: projectEntry.name,
                    relocAddrs: runtime.relocAddrs,
                    runMode: runMode
                };
                lastRunWasShared = isSharedRun;
                updateAddrReference(actualColdState);
                elStatus.textContent = 'Project disk started (filesystem verified; boot not verified)';
                lastRunDetails = {
                    projectDisk: true,
                    projectDiskName: projectEntry.name,
                    committed: true,
                    poweredOn: true,
                    bootVerified: false,
                    executionVerified: false,
                    verification: 'filesystem-only',
                    warnings: prepared.warnings
                };
                window.XmilLibrary.finishProjectDiskTransaction(transaction, false);
                return true;
            } catch(e) {
                if (transaction) {
                    try { await window.XmilLibrary.restoreProjectDiskTransaction(transaction); }
                    catch(rollbackError) {
                        e.rollbackFailed = true;
                        e.rollbackMessage = rollbackError.message;
                    }
                    window.XmilLibrary.finishProjectDiskTransaction(transaction, true);
                }
                console.error('[x1pen] Project disk Run failed:', e);
                elStatus.textContent = e.message || 'Project disk update failed';
                lastRunDetails = {
                    code: e.code || 'PROJECT_DISK_UPDATE_FAILED',
                    committed: false,
                    poweredOn: false,
                    bootVerified: false,
                    executionVerified: false,
                    rollbackFailed: !!e.rollbackFailed
                };
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

        // ADDR Reference を actual cold state に合わせて更新
        updateAddrReference(actualColdState);

        // 6b. FZBASIC.COM を RAM に直接パッチ (FuzzyBASIC モードのみ)
        if (!isLsxMode && runtime.relocAddrs) {
            try {
                await patchFzbasicInRam(runtime.relocAddrs);
            } catch(e) {
                console.warn('[x1pen] FZBASIC patch failed (continuing):', e);
                elStatus.textContent = 'Warning: FZBASIC reloc failed';
            }
        }

        // 7. ディスクイメージ作成 (ASM バイナリ and/or AUTORUN.BAS)
        if (asmBytes || tokenized) {
            if (bootData) {
                if (!(await mountProgramDisk(asmBytes, tokenized, bootData, runtime.relocAddrs, { mode: runMode }))) {
                    elStatus.textContent = 'Disk write failed';
                    return false;
                }
                hasProgramDisk = true;
            }
        }

        // 8. FDD 等のマウント状態を再適用 (PROGRAM ディスク使用時は drive0 を除外)
        if (window.XmilLibrary && window.XmilLibrary.autoRestoreMounts) {
            await window.XmilLibrary.autoRestoreMounts(hasProgramDisk ? ['drive0'] : []);
        }

        // 9. モード別のエミュレータ開始
        // A previous debugger session may have left the machine paused. A new
        // Run always starts execution while preserving configured breakpoints.
        if (module._js_debug_resume) module._js_debug_resume();
        if (isLsxMode) {
            // LSX-Dodgers モード: コマンドプロンプトから PROG を実行
            console.log('[x1pen] starting emulator (LSX-Dodgers mode)');
            module._js_xmil_start();
            var canvas = document.getElementById('canvas');
            if (canvas) canvas.focus();
            await new Promise(function(r) { setTimeout(r, 500); });
            await simulateProgCommand();
            elStatus.textContent = 'LSX-Dodgers mode';
        } else {
            // FuzzyBASIC モード: BASIC 注入 + RUN キー注入
            if (!tokenized) {
                elStatus.textContent = 'No program to run';
                return false;
            }
            if (!(await injectProgram(tokenized, actualColdState))) {
                elStatus.textContent = 'State version not supported';
                return false;
            }
            console.log('[x1pen] starting emulator + injecting RUN command');
            module._js_xmil_start();
            var canvas = document.getElementById('canvas');
            if (canvas) canvas.focus();
            await new Promise(function(r) { setTimeout(r, 500); });
            await simulateRunCommand();
        }
        return true;
    }

    // ── PROGRAM ディスク マウント ──

    async function collectRelocationDiskFiles(relocAddresses) {
        var files = [];
        if (!relocAddresses) return files;
        try {
            var config = await loadRelocConfig();
            if (!config) return files;
            for (var key in config.binaries) {
                var binInfo = config.binaries[key];
                var relData = await loadREL(binInfo.rel_file);
                if (!relData) {
                    console.warn('[x1pen] REL not available: ' + binInfo.rel_file);
                    continue;
                }
                var hasSelf = false;
                for (var gi = 0; gi < binInfo.groups.length; gi++) {
                    if (binInfo.groups[gi].name === 'SELF') { hasSelf = true; break; }
                }
                files.push({
                    name: binInfo.output_file,
                    data: patchREL(relData, binInfo.groups, relocAddresses),
                    replaceOnly: !hasSelf
                });
            }
        } catch(e) {
            console.warn('[x1pen] Reloc disk patching failed (continuing):', e);
        }
        return files;
    }

    async function mountProgramDisk(programBytes, basicTokenized, diskData, relocAddresses, options) {
        var mode = (options && options.mode) || 'fuzzybasic';
        if (!diskData) {
            console.error('[x1pen] Boot disk not loaded');
            return false;
        }

        // 1. ベースディスクを ArrayBuffer としてコピー
        var diskCopy = diskData.slice(0);

        // 2. D88 コンテナとして開く
        var container = window.XmilDiskContainer.openContainer(diskCopy, 'boot.d88', 'fdd');
        if (!container) return false;

        // 3. LSX-Dodgers FS でファイルを書き込み
        try {
            var lsx = new window.XmilDiskFS.LsxDodgersFS(container);

            // 3a. リロケート済みバイナリで既存ファイルを上書き
            if (relocAddresses) {
                try {
                    var config = await loadRelocConfig();
                    if (config) {
                        for (var key in config.binaries) {
                            var binInfo = config.binaries[key];

                            var relData = await loadREL(binInfo.rel_file);
                            if (!relData) {
                                console.warn('[x1pen] REL not available: ' + binInfo.rel_file);
                                continue;
                            }

                            var patched = patchREL(relData, binInfo.groups, relocAddresses);

                            // 既存ファイルがあれば削除して再追加
                            // 既存がない場合: SELF グループ持ちなら新規追加、なければスキップ
                            // (FZBASIC.COM は RAM パッチで対応するため、ディスクに不在なら追加不要)
                            var nameParts = binInfo.output_file.split('.');
                            var existing = lsx.findByName(nameParts[0], nameParts[1]);
                            if (existing) {
                                lsx.deleteFile(existing);
                                lsx.addFile(nameParts[0], nameParts[1], patched);
                            } else {
                                var hasSelf = false;
                                for (var gi = 0; gi < binInfo.groups.length; gi++) {
                                    if (binInfo.groups[gi].name === 'SELF') { hasSelf = true; break; }
                                }
                                if (hasSelf) lsx.addFile(nameParts[0], nameParts[1], patched);
                            }
                        }
                    }
                } catch(e) {
                    console.warn('[x1pen] Reloc disk patching failed (continuing):', e);
                }
            }

            // 3b. ユーザープログラム
            if (programBytes && programBytes.length > 0) {
                var fileName = (mode === 'lsx') ? 'PROG' : 'PROGRAM';
                var fileExt  = (mode === 'lsx') ? 'COM' : 'BIN';
                lsx.addFile(fileName, fileExt, new Uint8Array(programBytes));
            }
            if (basicTokenized) {
                lsx.addFile('AUTORUN', 'BAS', basicTokenized);
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

    var lastShareHash = null;
    var lastShareId = null;

    async function captureScreenshot() {
        var canvas = document.getElementById('canvas');
        if (!canvas) return null;
        return new Promise(function(resolve) {
            canvas.toBlob(function(blob) { resolve(blob); }, 'image/png');
        });
    }

    async function computePayloadHash(payloadStr) {
        var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payloadStr));
        return Array.from(new Uint8Array(buf)).map(function(b) {
            return b.toString(16).padStart(2, '0');
        }).join('');
    }

    // ── Automation API (Playwright / MCP bridge) ──

    function getAutomationProgram() {
        var basic = basicEditor ? basicEditor.getValue() : '';
        var asm = asmEditor ? asmEditor.getValue() : '';
        var slang = slangEditor ? slangEditor.getValue() : '';
        return {
            basic: basic,
            asm: asm,
            slang: slang,
            sourceMode: inferSourceMode(basic.trim(), asm.trim(), slang.trim()),
            revision: automationRevision,
            revisionEpoch: automationRevisionEpoch,
            instanceId: automationInstanceId
        };
    }

    function normalizeAutomationProgram(program) {
        if (!program || typeof program !== 'object' || Array.isArray(program)) {
            throw new TypeError('program must be an object');
        }

        var basic = program.basic === undefined ? '' : program.basic;
        var asm = program.asm === undefined ? '' : program.asm;
        var slang = program.slang === undefined ? '' : program.slang;
        if (typeof basic !== 'string' || typeof asm !== 'string' || typeof slang !== 'string') {
            throw new TypeError('basic, asm and slang must be strings');
        }

        var sourceMode = program.sourceMode || inferSourceMode(basic.trim(), asm.trim(), slang.trim());
        if (sourceMode !== 'basic+asm' && sourceMode !== 'asm' && sourceMode !== 'slang') {
            throw new TypeError('sourceMode must be basic+asm, asm or slang');
        }
        if (sourceMode === 'slang' && !slang.trim()) {
            throw new TypeError('slang source is required for sourceMode slang');
        }
        if (sourceMode === 'asm' && !asm.trim()) {
            throw new TypeError('asm source is required for sourceMode asm');
        }
        if (sourceMode === 'basic+asm' && !basic.trim()) {
            throw new TypeError('basic source is required for sourceMode basic+asm');
        }

        // A complete program replaces all editor state so stale sources cannot change run mode.
        if (sourceMode === 'slang') {
            basic = '';
            asm = '';
        } else if (sourceMode === 'asm') {
            basic = '';
            slang = '';
        } else {
            slang = '';
        }

        return { basic: basic, asm: asm, slang: slang, sourceMode: sourceMode };
    }

    function createProgramConflictError(code, message, details) {
        var error = new Error(message);
        error.code = code;
        error.component = 'x1pen';
        error.action = code === 'REVISION_EPOCH_REQUIRED'
            ? 'Call getProgram again and retry with both expectedRevisionEpoch and expectedRevision.'
            : 'Call getProgram, compare the current source identity, and reconcile changes before retrying.';
        Object.keys(details || {}).forEach(function(key) { error[key] = details[key]; });
        return error;
    }

    function setAutomationProgram(program, expectedRevision, expectedRevisionEpoch, transport) {
        var requireRevisionEpoch = transport && transport.requireRevisionEpoch === true;
        if (requireRevisionEpoch && expectedRevision !== undefined && expectedRevisionEpoch === undefined) {
            throw createProgramConflictError(
                'REVISION_EPOCH_REQUIRED',
                'A revision epoch is required with expectedRevision',
                { expectedRevision: expectedRevision, currentRevision: automationRevision,
                    currentRevisionEpoch: automationRevisionEpoch, instanceId: automationInstanceId }
            );
        }
        if (expectedRevisionEpoch !== undefined && expectedRevisionEpoch !== automationRevisionEpoch) {
            throw createProgramConflictError(
                'REVISION_EPOCH_MISMATCH',
                'Revision epoch conflict: expectedRevisionEpoch does not match the current program epoch',
                { expectedRevision: expectedRevision, expectedRevisionEpoch: expectedRevisionEpoch,
                    currentRevision: automationRevision, currentRevisionEpoch: automationRevisionEpoch,
                    instanceId: automationInstanceId }
            );
        }
        if (expectedRevision !== undefined && expectedRevision !== automationRevision) {
            throw createProgramConflictError(
                'REVISION_MISMATCH',
                'Revision conflict: expected ' + expectedRevision + ', current ' + automationRevision,
                { expectedRevision: expectedRevision, currentRevision: automationRevision,
                    currentRevisionEpoch: automationRevisionEpoch, instanceId: automationInstanceId }
            );
        }
        if (!basicEditor || !asmEditor || !slangEditor) {
            throw new Error('X1Pen editors are not ready');
        }
        var normalized = normalizeAutomationProgram(program);
        basicEditor.setValue(normalized.basic, { silent: true });
        asmEditor.setValue(normalized.asm, { silent: true });
        slangEditor.setValue(normalized.slang, { silent: true });
        persistEditorSources(normalized.basic, normalized.asm, normalized.slang);
        lastAsmTabOrigin = normalized.asm ? 'user' : null;
        pendingShareRuntime = null;
        lastRunWasShared = false;
        markProgramChanged();
        clearSymbols();
        forceResyncEditorTab(normalized.sourceMode === 'basic+asm' ? 'basic' : normalized.sourceMode);
        elStatus.textContent = 'Program loaded';
        var result = getAutomationProgram();
        var epochGuarded = expectedRevision !== undefined && expectedRevisionEpoch !== undefined;
        result.guardedWritesReloadSafe = epochGuarded;
        result.writeGuard = epochGuarded ? 'revision-epoch' : 'revision-only';
        return result;
    }

    function makeAutomationDiagnostic(kind, message, details) {
        var diagnostic = {
            kind: kind,
            severity: (details && details.severity) || 'error',
            message: String(message || 'Unknown error')
        };
        if (details && details.file) diagnostic.file = details.file;
        if (details && Number.isFinite(details.line)) diagnostic.line = details.line;
        if (details && Number.isFinite(details.column)) diagnostic.column = details.column;
        return diagnostic;
    }

    async function validateAutomationProgram() {
        var program = getAutomationProgram();
        var diagnostics = [];
        var asmSource = program.asm;
        var generatedAsmLines = 0;
        var asmBytes = 0;
        var basicBytes = 0;

        if (!program.basic.trim() && !program.asm.trim() && !program.slang.trim()) {
            diagnostics.push(makeAutomationDiagnostic('program', 'Nothing to validate'));
        }
        if (program.sourceMode === 'slang' && diagnostics.length === 0) {
            try {
                await ensureSlangToolchain();
                var slangEnv = { defaultOrg: 0x100, codeReadonly: false, defines: { ENV_TYPE: 1 } };
                var slangResult = window.X1PenSlangCompiler.compile(program.slang.trim(), window._slangRuntimeVFS, slangEnv);
                var slangErrors = slangResult.errors || [];
                for (var si = 0; si < slangErrors.length; si++) {
                    var slangError = slangErrors[si];
                    var start = slangError.span && slangError.span.start;
                    diagnostics.push(makeAutomationDiagnostic('slang', slangError.message || slangError, {
                        severity: String(slangError.severity || 'error').toLowerCase(),
                        file: start && start.fileName,
                        line: start && start.line,
                        column: start && start.column
                    }));
                }
                asmSource = slangResult.asm || '';
                generatedAsmLines = asmSource ? asmSource.split('\n').length : 0;
            } catch(e) {
                diagnostics.push(makeAutomationDiagnostic('slang', e.message));
            }
        }
        if (asmSource.trim() && diagnostics.length === 0) {
            var coldState = program.sourceMode === 'basic+asm' ? COLD_STATE_FILE : LSX_COLD_STATE;
            var predefined = await getPredefinedSymbols(coldState);
            var asmResult = window.X1PenZ80Asm.assemble(asmSource.trim(), predefined);
            asmBytes = asmResult.bytes.length;
            for (var ai = 0; ai < asmResult.errors.length; ai++) {
                var asmError = asmResult.errors[ai];
                diagnostics.push(makeAutomationDiagnostic('asm', asmError.msg, { line: asmError.line }));
            }
        }
        if (program.sourceMode === 'basic+asm' && program.basic.trim() && diagnostics.length === 0) {
            try {
                basicBytes = window.X1PenTokenizer.tokenizeProgram(program.basic.trim()).length;
            } catch(e) {
                diagnostics.push(makeAutomationDiagnostic('basic', e.message));
            }
        }

        return {
            ok: diagnostics.length === 0,
            sourceMode: program.sourceMode,
            revision: automationRevision,
            diagnostics: diagnostics,
            output: {
                basicBytes: basicBytes,
                asmBytes: asmBytes,
                generatedAsmLines: generatedAsmLines
            }
        };
    }

    var DEBUGGER_STATE_WORD = Object.freeze({
        VERSION: 0,
        WORD_COUNT: 1,
        SEQUENCE: 2,
        RUN_STATE: 3,
        STOP_REASON: 4,
        STOP_ADDRESS: 5,
        BREAKPOINT_COUNT: 6,
        EMULATOR_RUNNING: 7,
        AF: 8,
        BC: 9,
        DE: 10,
        HL: 11,
        IX: 12,
        IY: 13,
        PC: 14,
        SP: 15,
        AF2: 16,
        BC2: 17,
        DE2: 18,
        HL2: 19,
        I: 20,
        R: 21,
        IM: 22,
        IFF1: 23,
        IFF2: 24,
        CYCLES: 25,
        LOW_MEMORY_MAPPING: 26,
        LOW_MEMORY_BANK: 27,
        ROM_TYPE: 28,
        ROM_SWITCH: 29,
        LASTMEM: 30,
        WORDS: 31
    });
    var DEBUGGER_RUN_STATE_NAMES = ['running', 'paused'];
    var DEBUGGER_STOP_REASON_NAMES = ['none', 'manual', 'breakpoint', 'step'];
    var DEBUGGER_MEMORY_MAPPING_NAMES = ['main', 'bios', 'bank'];
    var DEBUGGER_MAX_READ_LENGTH = 4096;
    var DEBUGGER_VIDEO_STATE_WORD = Object.freeze({
        VERSION: 0,
        WORD_COUNT: 1,
        ROM_TYPE: 2,
        SCREEN_BITS: 3,
        DISPLAY_BANK: 4,
        ACCESS_BANK: 5,
        TEXT_COLUMNS: 6,
        TEXT_ROWS: 7,
        GRAPHICS_WIDTH: 8,
        GRAPHICS_HEIGHT: 9,
        DISPLAY_PAGE: 10,
        WORDS: 11
    });
    var DEBUGGER_VRAM_REGION_CODES = Object.freeze({
        text: 0,
        attribute: 1,
        kanji: 2,
        graphics: 3
    });
    var DEBUGGER_VRAM_REGION_SIZES = Object.freeze({
        text: 0x0800,
        attribute: 0x0800,
        kanji: 0x0800,
        graphics: 0x4000
    });
    var DEBUGGER_VRAM_BANK_CODES = Object.freeze({
        display: 2,
        access: 3
    });
    var DEBUGGER_VRAM_PLANE_CODES = Object.freeze({
        blue: 0,
        red: 1,
        green: 2
    });

    function isDebuggerModuleAvailable() {
        return !!(module && module.wasmMemory && module._malloc && module._free &&
            module._js_debug_get_state && module._js_debug_pause && module._js_debug_resume &&
            module._js_debug_step && module._js_debug_replace_breakpoints &&
            module._js_debug_read_memory);
    }

    function isDebuggerVramModuleAvailable() {
        return !!(isDebuggerModuleAvailable() && module._js_debug_get_video_state &&
            module._js_debug_read_vram && module._js_debug_write_vram);
    }

    function requireDebuggerModule() {
        if (!isDebuggerModuleAvailable()) {
            throw new Error('X1Pen debugger is not ready');
        }
        return module;
    }

    function requireDebuggerVramModule() {
        if (!isDebuggerVramModuleAvailable()) {
            throw new Error('X1Pen VRAM debugger is not ready');
        }
        return module;
    }

    function getAvailableDebuggerVramRegions() {
        if (!isDebuggerVramModuleAvailable()) return [];
        var regions = ['text', 'attribute'];
        if (module._js_get_rom_type && module._js_get_rom_type() >= 2) {
            regions.push('kanji');
        }
        regions.push('graphics');
        return regions;
    }

    function debuggerEnumName(names, value) {
        return names[value] === undefined ? 'unknown' : names[value];
    }

    function decodeDebuggerPair(value, highName, lowName, target) {
        target[highName] = (value >>> 8) & 0xFF;
        target[lowName] = value & 0xFF;
    }

    function decodeDebuggerState(state) {
        var word = DEBUGGER_STATE_WORD;
        var registers = {
            af: state[word.AF],
            bc: state[word.BC],
            de: state[word.DE],
            hl: state[word.HL],
            ix: state[word.IX],
            iy: state[word.IY],
            pc: state[word.PC],
            sp: state[word.SP],
            af2: state[word.AF2],
            bc2: state[word.BC2],
            de2: state[word.DE2],
            hl2: state[word.HL2],
            i: state[word.I],
            r: state[word.R],
            im: state[word.IM],
            iff1: state[word.IFF1] !== 0,
            iff2: state[word.IFF2] !== 0
        };
        decodeDebuggerPair(registers.af, 'a', 'f', registers);
        decodeDebuggerPair(registers.bc, 'b', 'c', registers);
        decodeDebuggerPair(registers.de, 'd', 'e', registers);
        decodeDebuggerPair(registers.hl, 'h', 'l', registers);
        decodeDebuggerPair(registers.af2, 'a2', 'f2', registers);
        decodeDebuggerPair(registers.bc2, 'b2', 'c2', registers);
        decodeDebuggerPair(registers.de2, 'd2', 'e2', registers);
        decodeDebuggerPair(registers.hl2, 'h2', 'l2', registers);

        var mappingCode = state[word.LOW_MEMORY_MAPPING];
        var mappingName = debuggerEnumName(DEBUGGER_MEMORY_MAPPING_NAMES, mappingCode);
        return {
            version: state[word.VERSION],
            sequence: state[word.SEQUENCE],
            runState: debuggerEnumName(DEBUGGER_RUN_STATE_NAMES, state[word.RUN_STATE]),
            runStateCode: state[word.RUN_STATE],
            stopReason: debuggerEnumName(DEBUGGER_STOP_REASON_NAMES, state[word.STOP_REASON]),
            stopReasonCode: state[word.STOP_REASON],
            stopAddress: state[word.STOP_ADDRESS],
            breakpointCount: state[word.BREAKPOINT_COUNT],
            emulatorRunning: state[word.EMULATOR_RUNNING] !== 0,
            registers: registers,
            cycles: state[word.CYCLES],
            memory: {
                lowMapping: mappingName,
                lowMappingCode: mappingCode,
                lowBank: mappingName === 'bank' ? state[word.LOW_MEMORY_BANK] : null,
                romType: state[word.ROM_TYPE],
                romSwitch: state[word.ROM_SWITCH] !== 0,
                lastmem: state[word.LASTMEM]
            }
        };
    }

    function getAutomationDebuggerState() {
        var debuggerModule = requireDebuggerModule();
        var wordCount = DEBUGGER_STATE_WORD.WORDS;
        var ptr = debuggerModule._malloc(wordCount * 4);
        if (!ptr) throw new Error('Failed to allocate debugger state buffer');
        try {
            var result = debuggerModule._js_debug_get_state(ptr, wordCount);
            if (result !== wordCount) {
                throw new Error('Unsupported debugger state ABI: ' + result);
            }
            var raw = Array.from(new Uint32Array(debuggerModule.wasmMemory.buffer, ptr, wordCount));
            if (raw[DEBUGGER_STATE_WORD.VERSION] !== 1 ||
                raw[DEBUGGER_STATE_WORD.WORD_COUNT] !== wordCount) {
                throw new Error('Unsupported debugger state version: ' + raw[DEBUGGER_STATE_WORD.VERSION]);
            }
            return decodeDebuggerState(raw);
        } finally {
            debuggerModule._free(ptr);
        }
    }

    function callAutomationDebuggerControl(exportName, operation) {
        var debuggerModule = requireDebuggerModule();
        if (debuggerModule[exportName]() !== 1) {
            throw new Error('Debugger ' + operation + ' failed');
        }
        return getAutomationDebuggerState();
    }

    function isRunSetupPending() {
        return !!runAdmission;
    }

    function createRunPendingError(operation) {
        var error = new Error(operation + ' is unavailable while run setup is pending');
        error.code = 'RUN_PENDING';
        return error;
    }

    function createDebuggerRunPendingError(operation) {
        return createRunPendingError('Debugger ' + operation);
    }

    function runAutomationDebuggerControl(exportName, operation) {
        return automationReadyPromise.then(function() {
            if (isRunSetupPending()) {
                throw createDebuggerRunPendingError(operation);
            }
            return callAutomationDebuggerControl(exportName, operation);
        });
    }

    function normalizeDebuggerAddress(value, name) {
        if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) {
            throw new TypeError((name || 'address') + ' must be an integer from 0 to 65535');
        }
        return value;
    }

    function setAutomationDebuggerBreakpoints(addresses) {
        if (!Array.isArray(addresses)) throw new TypeError('addresses must be an array');
        var normalized = [];
        var seen = new Set();
        for (var i = 0; i < addresses.length; i++) {
            var address = normalizeDebuggerAddress(addresses[i], 'addresses[' + i + ']');
            if (!seen.has(address)) {
                seen.add(address);
                normalized.push(address);
            }
        }
        normalized.sort(function(left, right) { return left - right; });

        var debuggerModule = requireDebuggerModule();
        var ptr = 0;
        try {
            if (normalized.length > 0) {
                ptr = debuggerModule._malloc(normalized.length * 2);
                if (!ptr) throw new Error('Failed to allocate debugger breakpoint buffer');
                new Uint16Array(debuggerModule.wasmMemory.buffer, ptr, normalized.length).set(normalized);
            }
            if (!debuggerModule._js_debug_replace_breakpoints ||
                debuggerModule._js_debug_replace_breakpoints(ptr, normalized.length) !== 1) {
                throw new Error('Failed to replace debugger breakpoints');
            }
        } finally {
            if (ptr) debuggerModule._free(ptr);
        }
        return getAutomationDebuggerState();
    }

    function readAutomationDebuggerMemory(address, length) {
        address = normalizeDebuggerAddress(address);
        if (!Number.isInteger(length) || length < 1 || length > DEBUGGER_MAX_READ_LENGTH) {
            throw new TypeError('length must be an integer from 1 to ' + DEBUGGER_MAX_READ_LENGTH);
        }
        if (address + length > 0x10000) throw new RangeError('memory range exceeds the 64KB address space');

        var debuggerModule = requireDebuggerModule();
        var ptr = debuggerModule._malloc(length);
        if (!ptr) throw new Error('Failed to allocate debugger memory buffer');
        try {
            var result = debuggerModule._js_debug_read_memory(address, ptr, length);
            if (result !== length) throw new Error('Debugger memory read failed: ' + result);
            return {
                address: address,
                length: length,
                bytes: Array.from(new Uint8Array(debuggerModule.wasmMemory.buffer, ptr, length))
            };
        } finally {
            debuggerModule._free(ptr);
        }
    }

    function getAutomationDebuggerVideoState() {
        var debuggerModule = requireDebuggerVramModule();
        var word = DEBUGGER_VIDEO_STATE_WORD;
        var ptr = debuggerModule._malloc(word.WORDS * 4);
        if (!ptr) throw new Error('Failed to allocate debugger video state buffer');
        try {
            var result = debuggerModule._js_debug_get_video_state(ptr, word.WORDS);
            if (result !== word.WORDS) {
                throw new Error('Unsupported debugger video state ABI: ' + result);
            }
            var state = Array.from(new Uint32Array(
                debuggerModule.wasmMemory.buffer, ptr, word.WORDS));
            if (state[word.VERSION] !== 1 || state[word.WORD_COUNT] !== word.WORDS) {
                throw new Error('Unsupported debugger video state version: ' + state[word.VERSION]);
            }
            var romType = state[word.ROM_TYPE];
            var modelNames = ['', 'x1', 'x1turbo', 'x1turboZ'];
            return {
                version: state[word.VERSION],
                model: modelNames[romType] || 'unknown',
                romType: romType,
                screenBits: state[word.SCREEN_BITS],
                displayBank: state[word.DISPLAY_BANK],
                accessBank: state[word.ACCESS_BANK],
                text: {
                    columns: state[word.TEXT_COLUMNS],
                    rows: state[word.TEXT_ROWS],
                    displayPage: state[word.DISPLAY_PAGE],
                    regionSize: 0x0800,
                    kanjiAvailable: romType >= 2
                },
                graphics: {
                    width: state[word.GRAPHICS_WIDTH],
                    height: state[word.GRAPHICS_HEIGHT],
                    banks: romType >= 2 ? 2 : 1,
                    planes: ['blue', 'red', 'green'],
                    planeSize: 0x4000
                }
            };
        } finally {
            debuggerModule._free(ptr);
        }
    }

    function normalizeDebuggerVramRequest(options, length) {
        if (!options || typeof options !== 'object' || Array.isArray(options)) {
            throw new TypeError('VRAM options must be an object');
        }
        var region = options.region;
        if (!Object.prototype.hasOwnProperty.call(DEBUGGER_VRAM_REGION_CODES, region)) {
            throw new TypeError('region must be text, attribute, kanji or graphics');
        }
        var offset = options.offset;
        var size = DEBUGGER_VRAM_REGION_SIZES[region];
        if (!Number.isInteger(offset) || offset < 0 || offset >= size) {
            throw new TypeError('offset must be an integer from 0 to ' + (size - 1));
        }
        if (!Number.isInteger(length) || length < 1 || length > DEBUGGER_MAX_READ_LENGTH) {
            throw new TypeError('length must be an integer from 1 to ' + DEBUGGER_MAX_READ_LENGTH);
        }
        if (offset + length > size) throw new RangeError('VRAM range exceeds the ' + region + ' region');

        var bankSelector = 0;
        var planeCode = 0;
        if (region === 'graphics') {
            if (options.bank === 0 || options.bank === 1) {
                bankSelector = options.bank;
            } else if (typeof options.bank === 'string' &&
                Object.prototype.hasOwnProperty.call(DEBUGGER_VRAM_BANK_CODES, options.bank)) {
                bankSelector = DEBUGGER_VRAM_BANK_CODES[options.bank];
            } else {
                throw new TypeError('graphics bank must be 0, 1, display or access');
            }
            if (!Object.prototype.hasOwnProperty.call(DEBUGGER_VRAM_PLANE_CODES, options.plane)) {
                throw new TypeError('graphics plane must be blue, red or green');
            }
            planeCode = DEBUGGER_VRAM_PLANE_CODES[options.plane];
        } else if (options.bank !== undefined || options.plane !== undefined) {
            throw new TypeError('bank and plane are only valid for graphics VRAM');
        }
        return {
            region: region,
            regionCode: DEBUGGER_VRAM_REGION_CODES[region],
            bankSelector: bankSelector,
            bank: region === 'graphics' ? options.bank : undefined,
            plane: region === 'graphics' ? options.plane : undefined,
            planeCode: planeCode,
            offset: offset,
            length: length
        };
    }

    function createDebuggerVramError(operation, result) {
        var error;
        if (result === -2) {
            error = new Error('Debugger VRAM ' + operation + ' is unsupported by the current X1 model');
            error.code = 'DEBUGGER_VRAM_UNSUPPORTED';
        } else if (result === -3) {
            error = new Error('Debugger VRAM ' + operation + ' requires the paused state');
            error.code = 'DEBUGGER_NOT_PAUSED';
        } else {
            error = new Error('Debugger VRAM ' + operation + ' failed: ' + result);
            error.code = 'DEBUGGER_VRAM_INVALID';
        }
        return error;
    }

    function debuggerVramResult(request, resolvedBank, bytes) {
        var result = {
            region: request.region,
            offset: request.offset,
            length: request.length
        };
        if (request.region === 'graphics') {
            result.bankSelector = request.bank;
            result.bank = resolvedBank;
            result.plane = request.plane;
        }
        if (bytes) result.bytes = bytes;
        return result;
    }

    function readAutomationDebuggerVram(options) {
        var request = normalizeDebuggerVramRequest(options, options && options.length);
        var debuggerModule = requireDebuggerVramModule();
        var dataPtr = debuggerModule._malloc(request.length);
        var bankPtr = debuggerModule._malloc(4);
        if (!dataPtr || !bankPtr) {
            if (dataPtr) debuggerModule._free(dataPtr);
            if (bankPtr) debuggerModule._free(bankPtr);
            throw new Error('Failed to allocate debugger VRAM buffer');
        }
        try {
            var result = debuggerModule._js_debug_read_vram(
                request.regionCode, request.bankSelector, request.planeCode,
                request.offset, dataPtr, request.length, bankPtr);
            if (result !== request.length) throw createDebuggerVramError('read', result);
            var resolvedBank = new Int32Array(debuggerModule.wasmMemory.buffer, bankPtr, 1)[0];
            var bytes = Array.from(new Uint8Array(
                debuggerModule.wasmMemory.buffer, dataPtr, request.length));
            return debuggerVramResult(request, resolvedBank, bytes);
        } finally {
            debuggerModule._free(dataPtr);
            debuggerModule._free(bankPtr);
        }
    }

    function writeAutomationDebuggerVram(options) {
        var source = options && options.bytes;
        if (!Array.isArray(source) && !(source instanceof Uint8Array)) {
            throw new TypeError('bytes must be an array or Uint8Array');
        }
        var bytes = Array.from(source);
        for (var i = 0; i < bytes.length; i++) {
            if (!Number.isInteger(bytes[i]) || bytes[i] < 0 || bytes[i] > 0xFF) {
                throw new TypeError('bytes[' + i + '] must be an integer from 0 to 255');
            }
        }
        var request = normalizeDebuggerVramRequest(options, bytes.length);
        var debuggerModule = requireDebuggerVramModule();
        var dataPtr = debuggerModule._malloc(request.length);
        var bankPtr = debuggerModule._malloc(4);
        if (!dataPtr || !bankPtr) {
            if (dataPtr) debuggerModule._free(dataPtr);
            if (bankPtr) debuggerModule._free(bankPtr);
            throw new Error('Failed to allocate debugger VRAM buffer');
        }
        try {
            new Uint8Array(debuggerModule.wasmMemory.buffer, dataPtr, request.length).set(bytes);
            var result = debuggerModule._js_debug_write_vram(
                request.regionCode, request.bankSelector, request.planeCode,
                request.offset, dataPtr, request.length, bankPtr);
            if (result !== request.length) throw createDebuggerVramError('write', result);
            var resolvedBank = new Int32Array(debuggerModule.wasmMemory.buffer, bankPtr, 1)[0];
            var response = debuggerVramResult(request, resolvedBank);
            response.bytesWritten = request.length;
            response.redrawPending = true;
            return response;
        } finally {
            debuggerModule._free(dataPtr);
            debuggerModule._free(bankPtr);
        }
    }

    // afterSequence must be the sequence returned by resume(), not the one
    // from the preceding stopped state, so it identifies a later stop.
    function waitForAutomationDebuggerPause(options) {
        options = options || {};
        if (typeof options !== 'object' || Array.isArray(options)) {
            throw new TypeError('options must be an object');
        }
        var hasAfterSequence = options.afterSequence !== undefined;
        if (hasAfterSequence && (!Number.isInteger(options.afterSequence) ||
            options.afterSequence < 0 || options.afterSequence > 0xFFFFFFFF)) {
            throw new TypeError('afterSequence must be an unsigned 32-bit integer');
        }
        if (options.stopReason !== undefined &&
            DEBUGGER_STOP_REASON_NAMES.indexOf(options.stopReason) < 0) {
            throw new TypeError('stopReason must be none, manual, breakpoint or step');
        }
        if (options.address !== undefined) normalizeDebuggerAddress(options.address);
        var timeoutMs = options.timeoutMs === undefined ? 5000 : options.timeoutMs;
        var pollIntervalMs = options.pollIntervalMs === undefined ? 16 : options.pollIntervalMs;
        if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 60000) {
            throw new TypeError('timeoutMs must be from 0 to 60000');
        }
        if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 1 || pollIntervalMs > 1000) {
            throw new TypeError('pollIntervalMs must be from 1 to 1000');
        }

        var matches = function(state) {
            return state.runState === 'paused' &&
                (!hasAfterSequence || state.sequence !== options.afterSequence) &&
                (options.stopReason === undefined || state.stopReason === options.stopReason) &&
                (options.address === undefined || state.stopAddress === options.address);
        };
        return automationReadyPromise.then(function() {
            var deadline = Date.now() + timeoutMs;
            return new Promise(function(resolve, reject) {
                var poll = function() {
                    var state;
                    try {
                        state = getAutomationDebuggerState();
                    } catch(e) {
                        reject(e);
                        return;
                    }
                    if (matches(state)) {
                        resolve(state);
                        return;
                    }
                    if (Date.now() >= deadline) {
                        reject(new Error('Timed out waiting for debugger pause'));
                        return;
                    }
                    setTimeout(poll, pollIntervalMs);
                };
                poll();
            });
        });
    }

    var X1PEN_AUTOMATION_API_VERSION = 2;
    var X1PEN_PRODUCT = window.X1PenBuild || { name: 'x1pen', version: 'unknown' };

    function getAutomationFeatures() {
        var features = ['automation.core', 'automation.run-recovery', 'automation.source-sync', 'screen.capture'];
        if (isAutomationKeyboardAvailable()) {
            features.push('input.keyboard');
        }
        if (isAutomationPadAvailable()) features.push('input.pad');
        if (isDebuggerModuleAvailable()) features.push('debugger.cpu');
        if (isDebuggerVramModuleAvailable()) features.push('debugger.vram');
        return features;
    }

    // Call X1PenAutomation.ready() before synchronous observation methods.
    // Async debugger methods wait for readiness.
    var automationDebuggerApi = Object.freeze({
        version: 2,
        getState: getAutomationDebuggerState,
        getVideoState: getAutomationDebuggerVideoState,
        pause: function() {
            return runAutomationDebuggerControl('_js_debug_pause', 'pause');
        },
        resume: function() {
            return runAutomationDebuggerControl('_js_debug_resume', 'resume');
        },
        step: function() {
            return automationReadyPromise.then(function() {
                if (isRunSetupPending()) {
                    throw createDebuggerRunPendingError('step');
                }
                if (getAutomationDebuggerState().runState !== 'paused') {
                    throw new Error('Debugger step requires the paused state');
                }
                return callAutomationDebuggerControl('_js_debug_step', 'step');
            });
        },
        setBreakpoints: function(addresses) {
            if (isRunSetupPending()) return Promise.reject(createDebuggerRunPendingError('set breakpoints'));
            return queueAutomationOperation(function() {
                return setAutomationDebuggerBreakpoints(addresses);
            });
        },
        readMemory: readAutomationDebuggerMemory,
        readVram: readAutomationDebuggerVram,
        writeVram: function(options) {
            if (isRunSetupPending()) return Promise.reject(createDebuggerRunPendingError('write VRAM'));
            return queueAutomationOperation(function() {
                if (getAutomationDebuggerState().runState !== 'paused') {
                    throw createDebuggerVramError('write', -3);
                }
                return writeAutomationDebuggerVram(options);
            });
        },
        waitForPause: waitForAutomationDebuggerPause
    });

    function getAutomationStatus() {
        var sourceMode = inferSourceMode(
            basicEditor ? basicEditor.getValue().trim() : '',
            asmEditor ? asmEditor.getValue().trim() : '',
            slangEditor ? slangEditor.getValue().trim() : ''
        );
        var activeLanguageProfile = sourceMode === 'slang'
            ? { language: 'slang', id: 'x1pen-slang-c9e8f53-lsx' }
            : (sourceMode === 'basic+asm'
                ? { language: 'fuzzybasic', id: 'x1pen-fuzzybasic-1.2L' }
                : null);
        return {
            instanceId: automationInstanceId,
            revision: automationRevision,
            revisionEpoch: automationRevisionEpoch,
            ready: automationReadyState === 'ready',
            state: automationReadyState,
            busy: automationPendingOperations > 0,
            connected: automationConnected,
            interactionLocked: automationInteractionLocked,
            runAdmission: getRunAdmissionSnapshot(),
            title: document.title,
            url: location.href,
            status: elStatus ? elStatus.textContent : '',
            sourceMode: sourceMode,
            activeLanguageProfile: activeLanguageProfile,
            x1pen: {
                name: X1PEN_PRODUCT.name,
                version: X1PEN_PRODUCT.version,
                automationApiVersion: X1PEN_AUTOMATION_API_VERSION,
                features: getAutomationFeatures()
            },
            capabilities: {
                debugger: {
                    available: isDebuggerModuleAvailable(),
                    version: automationDebuggerApi.version,
                    addressSpaceSize: 0x10000,
                    maxReadLength: DEBUGGER_MAX_READ_LENGTH,
                    runPending: isRunSetupPending(),
                    vram: {
                        available: isDebuggerVramModuleAvailable(),
                        maxReadLength: DEBUGGER_MAX_READ_LENGTH,
                        maxWriteLength: DEBUGGER_MAX_READ_LENGTH,
                        regions: ['text', 'attribute', 'kanji', 'graphics'],
                        regionSizes: {
                            text: DEBUGGER_VRAM_REGION_SIZES.text,
                            attribute: DEBUGGER_VRAM_REGION_SIZES.attribute,
                            kanji: DEBUGGER_VRAM_REGION_SIZES.kanji,
                            graphics: DEBUGGER_VRAM_REGION_SIZES.graphics
                        },
                        modelDependentRegions: ['kanji'],
                        availableRegions: getAvailableDebuggerVramRegions(),
                        graphicsPlanes: ['blue', 'red', 'green']
                    }
                }
            },
            languageProfiles: {
                fuzzybasic: {
                    id: 'x1pen-fuzzybasic-1.2L',
                    version: COLD_STATE_VERSION[COLD_STATE_FILE],
                    runtime: COLD_STATE_FILE
                },
                slang: {
                    id: 'x1pen-slang-c9e8f53-lsx',
                    compilerRevision: 'c9e8f5315d8d44a413368045d78439a4ec8da3fc',
                    environment: 'lsx-dodgers',
                    envType: 1,
                    defaultOrg: 0x100
                }
            }
        };
    }

    function setAutomationConnectionState(connected, label) {
        if (!connected) {
            try { releaseAllAutomationPads(); } catch (e) {}
        }
        automationConnected = !!connected;
        var badge = document.getElementById('x1pen-mcp-status');
        if (badge) {
            badge.textContent = label || 'MCP Connected';
            badge.classList.toggle('hidden', !automationConnected);
        }
        return getAutomationStatus();
    }

    function setAutomationInteractionLocked(locked, label) {
        var wasLocked = automationInteractionLocked;
        if (locked) {
            automationInteractionLockDepth++;
        } else {
            automationInteractionLockDepth = Math.max(0, automationInteractionLockDepth - 1);
        }
        automationInteractionLocked = automationInteractionLockDepth > 0;
        var panel = document.getElementById('editor-panel');
        var overlay = document.getElementById('x1pen-automation-lock');
        if (!wasLocked && automationInteractionLocked && document.activeElement && document.activeElement.blur) {
            document.activeElement.blur();
        }
        if (panel) panel.inert = automationInteractionLocked;
        if (overlay) {
            if (automationInteractionLocked && label) overlay.textContent = label;
            if (!automationInteractionLocked) overlay.textContent = 'AI is editing...';
            overlay.classList.toggle('hidden', !automationInteractionLocked);
        }
        var buttons = document.querySelectorAll('#x1pen-toolbar button:not(#btn-run):not([data-automation-lock-exempt="true"])');
        buttons.forEach(function(button) {
            if (!wasLocked && automationInteractionLocked) {
                button.dataset.mcpWasDisabled = button.disabled ? '1' : '0';
                button.disabled = true;
            } else if (wasLocked && !automationInteractionLocked && button.dataset.mcpWasDisabled !== undefined) {
                button.disabled = button.dataset.mcpWasDisabled === '1';
                delete button.dataset.mcpWasDisabled;
            }
        });
        refreshRunTriggerState();
        return getAutomationStatus();
    }

    function captureAutomationScreen() {
        var canvas = document.getElementById('canvas');
        if (!canvas) throw new Error('X1Pen canvas not found');
        return canvas.toDataURL('image/png');
    }

    function queueAutomationOperation(operation) {
        automationPendingOperations++;
        var result = automationOperationQueue.then(function() {
            return automationReadyPromise.then(operation);
        });
        automationOperationQueue = result.catch(function() {});
        return result.then(function(value) {
            automationPendingOperations--;
            return value;
        }, function(error) {
            automationPendingOperations--;
            throw error;
        });
    }

    function runAutomation(options) {
        options = options || {};
        var origin = normalizeRunOrigin(options.origin, false);
        var token = tryReserveRun(origin, 'queued');
        if (!token) return Promise.resolve(makeRunBusyResult());
        var requestedTimeout = Number(options.queueTimeoutMs);
        var queueTimeoutMs = Number.isFinite(requestedTimeout)
            ? Math.max(100, Math.min(RUN_QUEUE_TIMEOUT_MS, Math.floor(requestedTimeout)))
            : RUN_QUEUE_TIMEOUT_MS;
        var settled = false;
        return new Promise(function(resolve, reject) {
            var queueTimer = setTimeout(function() {
                if (!runAdmission || runAdmission.token !== token || runAdmission.phase !== 'queued') return;
                releaseRun(token);
                settled = true;
                resolve(makeRunQueueTimeoutResult(origin));
            }, queueTimeoutMs);
            queueAutomationOperation(function() {
                clearTimeout(queueTimer);
                return executeReservedRun(token);
            }).then(function(value) {
                if (settled) return;
                settled = true;
                resolve(value);
            }, function(error) {
                if (settled) return;
                settled = true;
                releaseRun(token);
                reject(error);
            });
        });
    }

    window.X1PenAutomation = Object.freeze({
        version: X1PEN_AUTOMATION_API_VERSION,
        ready: function() {
            return automationReadyPromise.then(getAutomationStatus);
        },
        getProgram: getAutomationProgram,
        setProgram: function(program, expectedRevision, expectedRevisionEpoch, transport) {
            if (isRunSetupPending()) return Promise.reject(createRunPendingError('Program update'));
            return queueAutomationOperation(function() {
                return setAutomationProgram(program, expectedRevision, expectedRevisionEpoch, transport);
            });
        },
        validate: function() {
            if (isRunSetupPending()) return Promise.reject(createRunPendingError('Validation'));
            return queueAutomationOperation(validateAutomationProgram);
        },
        run: runAutomation,
        stop: function() {
            return queueAutomationOperation(function() {
                onStopClick();
                return getAutomationStatus();
            });
        },
        debugger: automationDebuggerApi,
        getStatus: getAutomationStatus,
        captureScreen: captureAutomationScreen,
        sendKey: sendAutomationKey,
        setPad: setAutomationPad,
        releasePads: releaseAllAutomationPads,
        recoverStalled: recoverStalledRun,
        setConnectionState: setAutomationConnectionState,
        setInteractionLocked: setAutomationInteractionLocked
    });

    function showShareDialog(url) {
        var dialog = document.getElementById('share-dialog');
        var urlInput = document.getElementById('share-dialog-url');
        var copyBtn = document.getElementById('share-dialog-copy');
        urlInput.value = url;
        copyBtn.textContent = 'Copy';
        dialog.classList.remove('hidden');
        urlInput.select();
    }

    function closeShareDialog() {
        document.getElementById('share-dialog').classList.add('hidden');
    }

    (function() {
        var close = document.getElementById('share-dialog-close');
        var ok = document.getElementById('share-dialog-ok');
        var backdrop = document.getElementById('share-dialog-backdrop');
        var copyBtn = document.getElementById('share-dialog-copy');
        if (close) close.addEventListener('click', closeShareDialog);
        if (ok) ok.addEventListener('click', closeShareDialog);
        if (backdrop) backdrop.addEventListener('click', closeShareDialog);
        if (copyBtn) copyBtn.addEventListener('click', function() {
            var urlInput = document.getElementById('share-dialog-url');
            urlInput.select();
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(urlInput.value).then(function() {
                    copyBtn.textContent = 'Copied!';
                    elStatus.textContent = 'URL copied!';
                }).catch(function() {
                    execCopyFallback(urlInput, copyBtn);
                });
            } else {
                execCopyFallback(urlInput, copyBtn);
            }
        });

        function execCopyFallback(urlInput, copyBtn) {
            urlInput.select();
            var ok = document.execCommand('copy');
            if (ok) {
                copyBtn.textContent = 'Copied!';
                elStatus.textContent = 'URL copied!';
            } else {
                copyBtn.textContent = 'Copy';
                elStatus.textContent = 'Copy failed - please copy manually';
            }
        }
    })();

    // ── Symbol Table ダイアログ ──

    function clearSymbols() {
        lastAsmSymbols = null;
        var symBtn = document.getElementById('btn-symbols');
        if (symBtn) symBtn.disabled = true;
    }

    var symSortByAddr = true;
    var symHidePredefined = false;

    function openSymbolDialog() {
        if (!lastAsmSymbols) return;
        document.getElementById('sym-dialog').classList.remove('hidden');
        // ソースモード表示
        var srcLabel = document.getElementById('sym-source');
        if (srcLabel) {
            var mode = (lastAsmSymbols.sourceMode || '').toUpperCase();
            if (mode === 'BASIC+ASM') mode = 'BASIC+ASM';
            srcLabel.textContent = mode ? '(' + mode + ')' : '';
        }
        document.getElementById('sym-filter').value = '';
        renderSymbolTable();
    }

    function closeSymbolDialog() {
        document.getElementById('sym-dialog').classList.add('hidden');
    }

    function renderSymbolTable() {
        var syms = lastAsmSymbols.symbols;
        var predefined = lastAsmSymbols.predefined;
        var filterText = (document.getElementById('sym-filter').value || '').toUpperCase();

        // 省略後の名前の出現回数（重複検出）
        var nameCount = {};
        for (var key in syms) {
            var short = key.indexOf('NAME_SPACE_DEFAULT.') === 0 ? key.substring(19) : key;
            nameCount[short] = (nameCount[short] || 0) + 1;
        }

        var entries = [];
        var totalCount = 0;
        for (var key in syms) {
            var isPredefined = key in predefined;
            if (symHidePredefined && isPredefined) { totalCount++; continue; }
            totalCount++;
            var displayName = key;
            if (key.indexOf('NAME_SPACE_DEFAULT.') === 0) {
                var short = key.substring(19);
                displayName = nameCount[short] > 1 ? key : short;
            }
            if (filterText && displayName.toUpperCase().indexOf(filterText) < 0) continue;
            entries.push({ name: displayName, value: syms[key], isPredefined: isPredefined });
        }

        if (symSortByAddr) {
            entries.sort(function(a, b) { return a.value - b.value; });
        } else {
            entries.sort(function(a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
        }

        var tbody = document.getElementById('sym-table-body');
        tbody.innerHTML = '';
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            var tr = document.createElement('tr');
            if (e.isPredefined) tr.className = 'sym-predefined';
            var tdName = document.createElement('td');
            tdName.textContent = e.name;
            var tdVal = document.createElement('td');
            tdVal.textContent = (e.value >= 0 && e.value <= 0xFFFF)
                ? e.value.toString(16).toUpperCase().padStart(4, '0') + 'h'
                : String(e.value);
            tr.appendChild(tdName);
            tr.appendChild(tdVal);
            tbody.appendChild(tr);
        }

        var countEl = document.getElementById('sym-count');
        if (countEl) {
            countEl.textContent = entries.length < totalCount
                ? entries.length + ' / ' + totalCount + ' symbols'
                : totalCount + ' symbols';
        }
    }

    (function() {
        var symBtn = document.getElementById('btn-symbols');
        if (symBtn) symBtn.addEventListener('click', openSymbolDialog);
        var symClose = document.getElementById('sym-dialog-close');
        var symOk = document.getElementById('sym-dialog-ok');
        var symBackdrop = document.getElementById('sym-dialog-backdrop');
        if (symClose) symClose.addEventListener('click', closeSymbolDialog);
        if (symOk) symOk.addEventListener('click', closeSymbolDialog);
        if (symBackdrop) symBackdrop.addEventListener('click', closeSymbolDialog);
        var symFilter = document.getElementById('sym-filter');
        if (symFilter) symFilter.addEventListener('input', renderSymbolTable);
        var symSortBtn = document.getElementById('sym-sort-toggle');
        if (symSortBtn) symSortBtn.addEventListener('click', function() {
            symSortByAddr = !symSortByAddr;
            symSortBtn.textContent = symSortByAddr ? 'Addr\u25B2' : 'Name\u25B2';
            renderSymbolTable();
        });
        var symHideChk = document.getElementById('sym-hide-predefined');
        if (symHideChk) symHideChk.addEventListener('change', function() {
            symHidePredefined = symHideChk.checked;
            renderSymbolTable();
        });
    })();

    async function onShareClick() {
        var src = basicEditor.getValue().trim();
        var asmSrc = asmEditor ? asmEditor.getValue().trim() : '';
        var slangSrc = slangEditor ? slangEditor.getValue().trim() : '';
        if (!src && !asmSrc && !slangSrc) { elStatus.textContent = 'Nothing to share'; return; }

        var shareSourceMode = slangSrc ? 'slang' : (!src && asmSrc ? 'asm' : 'basic+asm');
        var shareRunMode = (shareSourceMode === 'slang' || shareSourceMode === 'asm') ? 'lsx' : detectRunMode(src, asmSrc);

        // Share 用 runtime を決定 (relocAddrs を正規化済みで取得)
        var baseShareRuntime;
        if (pendingShareRuntime) {
            baseShareRuntime = pendingShareRuntime;
        } else if (lastRunWasShared && lastUsedRuntime) {
            baseShareRuntime = lastUsedRuntime;
        } else {
            baseShareRuntime = getUserDefaultRuntime();
        }
        var shareRuntime;
        try {
            normalizeRuntimeForRunMode(baseShareRuntime, shareRunMode);
            shareRuntime = await getEffectiveRuntime(baseShareRuntime);
        } catch(e) {
            shareRuntime = baseShareRuntime;
        }

        var meta = {
            model: shareRuntime.model,
            coldState: shareRuntime.coldState,
            bootDisk: shareRuntime.bootDisk,
            runMode: shareRunMode,
            sourceMode: shareSourceMode
        };
        if (shareRuntime.relocAddrs) meta.relocAddrs = shareRuntime.relocAddrs;

        // SLANG モードでは生成 ASM を payload に含めない（slang が正）
        var shareAsm = (shareSourceMode === 'slang') ? null : (asmSrc || null);
        var payload = JSON.stringify({
            basic: src,
            asm: shareAsm,
            slang: slangSrc || null,
            meta: meta
        });

        // ハッシュ計算 (payload 全体 = BASIC + ASM + meta)
        var hashHex = await computePayloadHash(payload);

        // 前回と同じなら POST せず URL を再利用
        if (hashHex === lastShareHash && lastShareId) {
            var url = location.origin + '/x1pen?id=' + lastShareId;
            showShareDialog(url);
            elStatus.textContent = 'Same content - URL reused';
            return;
        }

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

            // スクリーンショット撮影
            var screenshot = await captureScreenshot();

            // multipart 送信 (data + screenshot)
            var formData = new FormData();
            formData.append('data', new Blob([compressed], { type: 'application/octet-stream' }));
            if (screenshot) formData.append('screenshot', screenshot, 'screenshot.png');

            var resp = await fetch('/api/share', {
                method: 'POST',
                body: formData
            });
            if (!resp.ok) {
                var errBody = await resp.json().catch(function() { return {}; });
                throw new Error(errBody.error || 'HTTP ' + resp.status);
            }
            var result = await resp.json();

            // 成功 → ハッシュと ID を記録
            lastShareHash = hashHex;
            lastShareId = result.id;

            var url = location.origin + '/x1pen?id=' + result.id;
            showShareDialog(url);
            elStatus.textContent = 'Shared!';
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
                    automationReadyState = 'error';
                    automationReadyReject(new Error(elStatus.textContent));
                    return;
                }
            }
        }

        // runtime asset をプリロード (assetCache に格納)
        var coldState = await loadRuntimeAsset(COLD_STATE_FILE);
        if (!coldState) {
            elStatus.textContent = 'Failed to load FuzzyBASIC state';
            automationReadyState = 'error';
            automationReadyReject(new Error(elStatus.textContent));
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
            automationReadyState = 'error';
            automationReadyReject(new Error(elStatus.textContent));
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

        elStatus.textContent = 'Ready';
        automationReadyState = 'ready';
        refreshRunTriggerState();
        automationReadyResolve();

        // 共有コード読み込み (?id=xxx)
        var urlId = new URLSearchParams(location.search).get('id');

        // Share パラメータなしの場合、保存済みコンテンツに応じてタブを自動選択
        // BASIC → SLANG → ASM の優先順で、内容のあるタブに切り替える
        // (DOM/state 不整合を防ぐため、どのケースでも setActiveEditorTab を呼ぶ)
        if (!urlId) {
            var hasBasic = basicEditor.getValue().trim().length > 0;
            var hasSlang = slangEditor && slangEditor.getValue().trim().length > 0;
            var hasAsm   = asmEditor && asmEditor.getValue().trim().length > 0;
            var targetTab;
            if (!hasBasic && hasSlang) targetTab = 'slang';
            else if (!hasBasic && !hasSlang && hasAsm) targetTab = 'asm';
            else targetTab = 'basic';
            // activeTab と同じでも強制的にコンテナ状態を同期する
            forceResyncEditorTab(targetTab);
        }

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
                    basicEditor.setValue(shared.basic || '', { silent: true });
                    if (asmEditor) {
                        asmEditor.setValue(shared.asm || '', { silent: true });
                    }
                    if (slangEditor) {
                        slangEditor.setValue(shared.slang || '', { silent: true });
                    }
                    markProgramChanged();
                    // Share meta → pendingShareRuntime
                    if (shared.meta) {
                        var shareRelocAddrs = null;
                        if (shared.meta.relocAddrs) {
                            var rc = await loadRelocConfig();
                            if (rc) {
                                shareRelocAddrs = validateRelocAddresses(shared.meta.relocAddrs, rc);
                            } else {
                                // 新 Share なのに config が読めない → relocAddrs をそのまま保持（getEffectiveRuntime でエラーになる）
                                shareRelocAddrs = shared.meta.relocAddrs;
                            }
                        }
                        var sharedRunMode = shared.meta.runMode || detectRunMode(shared.basic || '', shared.asm || '');
                        pendingShareRuntime = {
                            model: validateModel(shared.meta.model, 1),
                            coldState: validateAssetName(shared.meta.coldState, COLD_STATE_FILE),
                            bootDisk: validateAssetName(shared.meta.bootDisk, BOOT_DISK_FILE),
                            relocAddrs: shareRelocAddrs,
                            sourceMode: shared.meta.sourceMode || (shared.slang ? 'slang' : null)
                        };
                        normalizeRuntimeForRunMode(pendingShareRuntime, sharedRunMode);
                    }
                    // 読み込んだ内容のハッシュを記録 (再 Share 時の URL 再利用用)
                    // effective runtime に揃えて、旧 Share でも default reloc が反映される
                    var replayRuntime;
                    try {
                        replayRuntime = await getEffectiveRuntime(
                            pendingShareRuntime || getUserDefaultRuntime()
                        );
                    } catch(e) {
                        replayRuntime = pendingShareRuntime || getUserDefaultRuntime();
                    }
                    var replaySourceMode = (shared.meta && shared.meta.sourceMode)
                        ? shared.meta.sourceMode
                        : (shared.slang ? 'slang' : null);
                    var replayMeta = {
                        model: replayRuntime.model,
                        coldState: replayRuntime.coldState,
                        bootDisk: replayRuntime.bootDisk,
                        runMode: replayRuntime.runMode || 'fuzzybasic',
                        sourceMode: replaySourceMode
                    };
                    if (replayRuntime.relocAddrs) replayMeta.relocAddrs = replayRuntime.relocAddrs;
                    // SLANG Share では生成 ASM を含めない（通常 Share 側と同じ正規化）
                    var replayAsm = (replaySourceMode === 'slang') ? null : (shared.asm || null);
                    var replayPayload = JSON.stringify({
                        basic: shared.basic,
                        asm: replayAsm,
                        slang: shared.slang || null,
                        meta: replayMeta
                    });
                    lastShareHash = await computePayloadHash(replayPayload);
                    lastShareId = urlId;

                    var runOk = await onRunClick('share');
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

    // ── ADDR メニュー (reloc address settings) ──

    function updateAddrReference(coldStateFile) {
        var refEl = document.getElementById('ec-addr-ref');
        if (!refEl) return;
        refEl.innerHTML = '';
        loadAddrmapVersions().then(function(versions) {
            var csFile = coldStateFile || COLD_STATE_FILE;
            var verName = COLD_STATE_VERSION[csFile];
            if (!verName) return; // LSX-Dodgers etc. — no addrmap needed
            if (!versions || !versions[verName]) {
                console.warn('[x1pen] ADDR Reference unavailable (addrmap not loaded or version mismatch)');
                return;
            }
            var hooks = versions[verName].user_hooks;
            if (!hooks) return;
            ['USR_A', 'FN_A', 'PR_A'].forEach(function(key) {
                if (!hooks[key]) return;
                var row = document.createElement('div');
                row.className = 'addr-field-row';
                row.innerHTML = '<span class="addr-field-label">' + key + '</span>' +
                    '<span style="color:#5599ee; font-family:monospace;">$' +
                    hooks[key].replace('0x', '') + '</span>';
                refEl.appendChild(row);
            });
        });
    }

    function initAddrMenu() {
        var fieldsEl = document.getElementById('ec-addr-fields');
        var errorEl = document.getElementById('ec-addr-error');
        var resetBtn = document.getElementById('ec-addr-reset');
        var applyBtn = document.getElementById('ec-addr-apply');
        var addrBtn = document.getElementById('ec-addr-btn');
        if (!fieldsEl) return;

        // Reference 初期表示
        updateAddrReference(COLD_STATE_FILE);

        loadRelocConfig().then(function(config) {
            if (!config) {
                if (addrBtn) addrBtn.disabled = true;
                console.warn('[x1pen] Reloc config not available, ADDR button disabled');
                return;
            }

            // フォームを動的生成
            var inputs = {};
            var addrs = getUserRelocAddresses(config);
            for (var key in config.symbols) {
                var sym = config.symbols[key];
                var row = document.createElement('div');
                row.className = 'addr-field-row';
                var label = document.createElement('span');
                label.className = 'addr-field-label';
                label.textContent = sym.label.ja || sym.label.en || key;
                var input = document.createElement('input');
                input.className = 'addr-field-input';
                input.type = 'text';
                input.maxLength = 4;
                input.value = addrs[key].toString(16).toUpperCase().padStart(4, '0');
                input.dataset.symbol = key;
                var suffix = document.createElement('span');
                suffix.className = 'addr-field-suffix';
                suffix.textContent = 'h';
                row.appendChild(label);
                row.appendChild(input);
                row.appendChild(suffix);
                fieldsEl.appendChild(row);
                inputs[key] = input;
            }

            function readInputs() {
                var result = {};
                for (var k in inputs) {
                    var val = parseInt(inputs[k].value, 16);
                    result[k] = isNaN(val) ? -1 : val;
                }
                return result;
            }

            function validateAndShowError() {
                var addrs = readInputs();
                errorEl.textContent = '';
                var hasError = false;
                for (var k in inputs) {
                    var val = addrs[k];
                    var bad = val < 0 || val > 0xFFFF || (val & 0xFF) !== 0;
                    inputs[k].classList.toggle('error', bad);
                    if (bad) { hasError = true; errorEl.textContent = k + ': xx00h boundary required'; }
                }
                if (hasError) return null;

                var validated = validateRelocAddresses(addrs, config);
                var overlapChk = document.getElementById('ec-addr-overlap-check');
                if (overlapChk && overlapChk.checked) {
                    var overlap = checkRelocOverlap(validated, config);
                    if (overlap.overlap) {
                        errorEl.textContent = 'Conflict: ' + overlap.a.name + ' / ' + overlap.b.name;
                        return null;
                    }
                }
                return validated;
            }

            // 入力時にリアルタイムバリデーション
            for (var k in inputs) {
                inputs[k].addEventListener('input', validateAndShowError);
            }
            var overlapChk = document.getElementById('ec-addr-overlap-check');
            if (overlapChk) overlapChk.addEventListener('change', validateAndShowError);

            if (applyBtn) applyBtn.addEventListener('click', function() {
                var validated = validateAndShowError();
                if (!validated) return;
                saveUserRelocAddresses(validated);
                errorEl.textContent = '';
                elStatus.textContent = 'Address settings saved';
                closeAllMenus();
            });

            if (resetBtn) resetBtn.addEventListener('click', function() {
                var defaults = getDefaultRelocAddresses(config);
                for (var k in inputs) {
                    inputs[k].value = defaults[k].toString(16).toUpperCase().padStart(4, '0');
                    inputs[k].classList.remove('error');
                }
                errorEl.textContent = '';
            });
        });
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

        // ADDR (relocatable binary addresses)
        initAddrMenu();

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

    elBtnRun.addEventListener('click', function() {
        if (elBtnRun.getAttribute('aria-disabled') === 'true') {
            announceRunNotice('Run already in progress');
            return;
        }
        onRunClick('ui');
    });
    if (elBtnRunRecover) {
        elBtnRunRecover.addEventListener('click', function() {
            var result = recoverStalledRun(window.confirm(
                'Reloading preserves editor source but loses emulator RAM and unpersisted disk changes. Continue?'
            ));
            if (result.ok) location.reload();
            else announceRunNotice(result.status);
        });
    }
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
        if (e.ctrlKey && e.key === 'Enter' && !elBtnRun.disabled &&
            elBtnRun.getAttribute('aria-disabled') !== 'true') {
            e.preventDefault();
            onRunClick('ui');
        }
    });

    // Tab, focus/blur, localStorage は CodeMirror 初期化時に設定済み

    // タブ切り替え（共通関数）
    var editorTabs = document.getElementById('editor-tabs');
    function forceResyncEditorTab(target) {
        // activeTab と target が同じでも DOM 状態を強制同期する
        activeTab = null; // 強制的に変化があったと判定させる
        setActiveEditorTab(target);
    }
    function setActiveEditorTab(target) {
        if (target === activeTab) return;
        activeTab = target;
        if (editorTabs) {
            editorTabs.querySelectorAll('.editor-tab').forEach(function(t) {
                t.classList.toggle('active', t.dataset.tab === target);
            });
        }
        var basicContainer = document.getElementById('basic-editor-container');
        var asmContainer = document.getElementById('asm-editor-container');
        var slangContainer = document.getElementById('slang-editor-container');
        var importBtn = document.getElementById('btn-asm-import');
        var manualBtn = document.getElementById('btn-basic-manual');

        // 全エディタコンテナを非表示
        if (basicContainer) basicContainer.classList.add('hidden');
        if (asmContainer) asmContainer.classList.add('hidden');
        if (slangContainer) slangContainer.classList.add('hidden');
        if (importBtn) importBtn.classList.add('hidden');
        if (manualBtn) manualBtn.classList.add('hidden');

        // 選択されたタブのコンテナを表示
        if (target === 'basic') {
            if (basicContainer) basicContainer.classList.remove('hidden');
            if (manualBtn) manualBtn.classList.remove('hidden');
        } else if (target === 'asm') {
            if (asmContainer) asmContainer.classList.remove('hidden');
            if (importBtn) importBtn.classList.remove('hidden');
        } else if (target === 'slang') {
            if (slangContainer) slangContainer.classList.remove('hidden');
        }
    }
    if (editorTabs) {
        editorTabs.addEventListener('click', function(e) {
            var tab = e.target.closest('.editor-tab');
            if (!tab) return;
            setActiveEditorTab(tab.dataset.tab);
        });
    }

    // モバイルタブ切り替え
    var mobileActivePanel = 'emulator';
    function isMobile() {
        return window.innerWidth <= 768 ||
            (window.innerHeight <= 500 && window.innerWidth > window.innerHeight);
    }

    function switchMobilePanel(panel) {
        mobileActivePanel = panel;
        var editorPanel = document.getElementById('editor-panel');
        var emuPanel = document.getElementById('emu-panel');
        if (panel === 'emulator') {
            editorPanel.classList.add('mobile-hidden');
            emuPanel.classList.remove('mobile-hidden');
        } else {
            editorPanel.classList.remove('mobile-hidden');
            emuPanel.classList.add('mobile-hidden');
            setActiveEditorTab(panel);
            setTimeout(function() {
                var editor = (panel === 'basic') ? basicEditor :
                             (panel === 'slang') ? slangEditor : asmEditor;
                if (editor && editor.view) editor.view.requestMeasure();
            }, 0);
        }
        document.querySelectorAll('.mobile-tab').forEach(function(t) {
            t.classList.toggle('active', t.dataset.panel === panel);
        });
    }

    document.getElementById('mobile-tabs').addEventListener('click', function(e) {
        var tab = e.target.closest('.mobile-tab');
        if (!tab) return;
        switchMobilePanel(tab.dataset.panel);
    });

    if (isMobile()) {
        switchMobilePanel('emulator');
    }

    var wasMobile = isMobile();
    window.addEventListener('resize', function() {
        var mobile = isMobile();
        if (mobile === wasMobile) return;
        wasMobile = mobile;
        if (!mobile) {
            document.body.style.height = '';
            document.getElementById('editor-panel').classList.remove('mobile-hidden');
            document.getElementById('emu-panel').classList.remove('mobile-hidden');
            setTimeout(function() {
                var editor = (activeTab === 'basic') ? basicEditor :
                             (activeTab === 'slang') ? slangEditor : asmEditor;
                if (editor && editor.view) editor.view.requestMeasure();
            }, 0);
        } else {
            switchMobilePanel(mobileActivePanel);
        }
    });

    // モバイル仮想キーボード対応: visualViewport で body 高さを動的更新
    if (window.visualViewport) {
        var onViewportChange = function() {
            if (!isMobile()) return;
            document.body.style.height = visualViewport.height + 'px';
        };
        visualViewport.addEventListener('resize', onViewportChange);
        visualViewport.addEventListener('scroll', onViewportChange);
        onViewportChange();
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

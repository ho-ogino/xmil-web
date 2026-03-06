// disk_editor.js - ディスクイメージ編集ツール UI
// X millennium Web - ディスク編集ツール (UI層)
(function() {
    'use strict';

    // 現在の編集セッション
    var currentEditor = null;
    // { key, entryName, container, fs, dirty, dirPath }
    // dirPath: [{ name: '/', cluster: 0 }, { name: 'SUBDIR', cluster: 5 }, ...]

    // ================================================================
    // エディタを開く
    // ================================================================
    async function openEditor(libraryKey) {
        if (!window.XmilCore || !window.XmilStorage) {
            alert('ストレージが初期化されていません');
            return;
        }

        // 既存の未保存セッションがある場合は確認
        if (currentEditor && currentEditor.dirty) {
            if (!confirm('現在編集中のディスクに未保存の変更があります。破棄して別のディスクを開きますか？')) {
                return;
            }
        }

        var lib = window.XmilCore.getLibrary();
        var entry = null;
        for (var i = 0; i < lib.length; i++) {
            if (lib[i].key === libraryKey) { entry = lib[i]; break; }
        }
        if (!entry) { alert('ファイルが見つかりません'); return; }

        // マウント中チェック — 該当する全スロットをイジェクト
        var state = window.XmilCore.getSlotState();
        var mountedSlots = [];
        for (var sn in state) {
            if (state[sn] === libraryKey) mountedSlots.push(sn);
        }
        if (mountedSlots.length > 0) {
            var slotNames = mountedSlots.map(function(sn) {
                return sn.replace('drive', 'FD');
            }).join(', ');
            if (!confirm('このディスクは ' + slotNames + ' にマウント中です。\nイジェクトして編集しますか？')) {
                return;
            }
            for (var i = 0; i < mountedSlots.length; i++) {
                await window.XmilCore.ejectSlot(mountedSlots[i]);
            }
        }

        // OPFS/IDB からデータ読み込み
        var data;
        try {
            data = await window.XmilStorage.read(libraryKey);
        } catch(e) {
            alert('ファイルの読み込みに失敗しました: ' + e.message);
            return;
        }
        if (!data) { alert('ファイルデータが空です'); return; }

        // コンテナ解析
        var container = window.XmilDiskContainer.openContainer(data, entry.name);
        if (!container) {
            alert('ディスクイメージの形式を認識できませんでした');
            return;
        }

        // ファイルシステム検出
        var fs = window.XmilDiskFS.detectFilesystem(container);

        currentEditor = {
            key: libraryKey,
            entryName: entry.name,
            container: container,
            fs: fs,
            dirty: false,
            dirPath: [{ name: '/', cluster: 0 }]
        };

        renderEditor();
        showPanel(true);
    }

    // ================================================================
    // ディレクトリナビゲーション
    // ================================================================

    function currentDirCluster() {
        if (!currentEditor || !currentEditor.dirPath) return 0;
        return currentEditor.dirPath[currentEditor.dirPath.length - 1].cluster;
    }

    function isInSubDirectory() {
        return currentEditor && currentEditor.dirPath && currentEditor.dirPath.length > 1;
    }

    function supportsSubDirs() {
        return currentEditor && currentEditor.fs &&
               currentEditor.fs.fsType !== 'HuBASIC';
    }

    function navigateToDir(name, cluster) {
        if (!currentEditor) return;
        currentEditor.dirPath.push({ name: name, cluster: cluster });
        renderFileList();
    }

    function navigateToPathIndex(idx) {
        if (!currentEditor) return;
        currentEditor.dirPath = currentEditor.dirPath.slice(0, idx + 1);
        renderFileList();
    }

    // ================================================================
    // UI 描画
    // ================================================================

    function renderEditor() {
        if (!currentEditor) return;

        var titleEl = document.getElementById('disk-editor-title');
        var infoEl = document.getElementById('disk-editor-info');
        var listEl = document.getElementById('disk-editor-list');
        var addBtn = document.getElementById('disk-editor-add-btn');
        var saveBtn = document.getElementById('disk-editor-save-btn');

        // タイトル
        if (titleEl) titleEl.textContent = 'ディスク編集: ' + currentEditor.entryName;

        // ルートに戻す
        if (currentEditor.dirPath) {
            currentEditor.dirPath = [{ name: '/', cluster: 0 }];
        }

        if (!currentEditor.fs) {
            // FS 未認識
            if (infoEl) infoEl.innerHTML = '<span class="disk-editor-warn">このディスクのフォーマットは未対応です (HuBASIC / LSX-Dodgers のみ対応)</span>';
            if (listEl) listEl.innerHTML = '<div class="lib-empty">ファイルシステムを認識できませんでした</div>';
            if (addBtn) addBtn.style.display = 'none';
            if (saveBtn) saveBtn.style.display = 'none';
            return;
        }

        var info = currentEditor.fs.getInfo();

        // ディスク情報
        var infoHtml = '<span class="disk-editor-info-item">' + escHtml(info.fsType) + ' ' + escHtml(info.format) + '</span>';
        if (info.fatType) {
            infoHtml += '<span class="disk-editor-info-item">' + escHtml(info.fatType) + '</span>';
        }
        infoHtml += '<span class="disk-editor-info-item">空き: ' + info.freeClusters + ' / ' + info.totalClusters + ' クラスタ (' + formatBytes(info.freeBytes) + ')</span>';

        if (info.readOnly) {
            infoHtml += '<span class="disk-editor-warn">&#9888; ' + escHtml(info.readOnlyReason || '読み取り専用') + '</span>';
        }
        if (infoEl) infoEl.innerHTML = infoHtml;

        // ツールバー
        if (addBtn) {
            addBtn.style.display = info.readOnly ? 'none' : '';
        }
        if (saveBtn) {
            saveBtn.style.display = '';
            saveBtn.textContent = currentEditor.dirty ? '保存して閉じる' : '閉じる';
        }

        // ファイル一覧
        renderFileList();
    }

    function hex4(n) {
        return ('0000' + n.toString(16).toUpperCase()).slice(-4);
    }

    function updateSaveButton() {
        var saveBtn = document.getElementById('disk-editor-save-btn');
        if (saveBtn && currentEditor) {
            saveBtn.textContent = currentEditor.dirty ? '保存して閉じる' : '閉じる';
        }
    }

    function renderFileList() {
        var listEl = document.getElementById('disk-editor-list');
        if (!listEl || !currentEditor || !currentEditor.fs) return;

        // 保存ボタンのテキスト更新 (dirty 反映)
        updateSaveButton();

        var dirCluster = currentDirCluster();
        var files = currentEditor.fs.listDirectory(dirCluster);
        var info = currentEditor.fs.getInfo();
        var isHuBasic = currentEditor.fs.fsType === 'HuBASIC';
        var inSubDir = isInSubDirectory();

        // ファイル追加ボタンの表示制御
        var addBtn = document.getElementById('disk-editor-add-btn');
        if (addBtn) {
            addBtn.style.display = info.readOnly ? 'none' : '';
        }

        var html = '';

        // パンくずナビゲーション (サブディレクトリ対応FSのみ)
        if (supportsSubDirs() && currentEditor.dirPath.length > 0) {
            html += '<div class="disk-editor-breadcrumb">';
            for (var i = 0; i < currentEditor.dirPath.length; i++) {
                if (i > 0) html += '<span class="disk-editor-breadcrumb-sep">&gt;</span>';
                var p = currentEditor.dirPath[i];
                if (i < currentEditor.dirPath.length - 1) {
                    // クリック可能なリンク
                    html += '<span class="disk-editor-breadcrumb-item" data-action="nav-path" data-path-idx="' + i + '">' + escHtml(p.name) + '</span>';
                } else {
                    // 現在のディレクトリ (非クリック)
                    html += '<span class="disk-editor-breadcrumb-current">' + escHtml(p.name) + '</span>';
                }
            }
            html += '</div>';
        }

        if (files.length === 0) {
            html += '<div class="lib-empty">ファイルがありません</div>';
            listEl.innerHTML = html;
            return;
        }

        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            html += '<div class="disk-editor-row">';

            if (f.isDirectory) {
                // フォルダ行
                html += '<span class="disk-editor-fname disk-editor-dir-name" data-action="enter-dir" data-index="' + f.index + '" data-cluster="' + f.startCluster + '" data-name="' + escHtml(f.fullName) + '" title="フォルダを開く">';
                html += '&#128193; ' + escHtml(f.fullName);
                html += '</span>';
                html += '<span class="disk-editor-fattr">' + escHtml(f.modeStr) + '</span>';
                html += '<span class="disk-editor-fsize">&lt;DIR&gt;</span>';
            } else {
                // ファイル行
                html += '<span class="disk-editor-fname">' + escHtml(f.fullName) + '</span>';
                if (isHuBasic && !info.readOnly && !f.isReadonly) {
                    html += '<span class="disk-editor-fattr disk-editor-fmode-edit" data-action="edit-mode" data-index="' + f.index + '" title="ファイルモード (クリックで変更: A=ASCII, M=Machine, B=BASIC)">' + escHtml(f.modeStr) + '</span>';
                } else {
                    html += '<span class="disk-editor-fattr">' + escHtml(f.modeStr) + '</span>';
                }
                html += '<span class="disk-editor-fsize">' + formatBytes(f.size) + '</span>';
            }

            if (isHuBasic && !f.isDirectory) {
                html += '<span class="disk-editor-faddr" data-action="edit-load" data-index="' + f.index + '" title="ロードアドレス (クリックで編集)">L:' + hex4(f.loadAddr) + '</span>';
                html += '<span class="disk-editor-faddr" data-action="edit-exec" data-index="' + f.index + '" title="実行アドレス (クリックで編集)">E:' + hex4(f.execAddr) + '</span>';
            }
            html += '<span class="disk-editor-fdate">' + escHtml(f.date) + '</span>';
            html += '<span class="disk-editor-row-btns">';
            if (!f.isDirectory) {
                if (!info.readOnly && !f.isReadonly) {
                    html += '<button class="disk-editor-btn" data-action="rename" data-index="' + f.index + '" title="リネーム">&#x270E;</button>';
                }
                html += '<button class="disk-editor-btn" data-action="extract" data-index="' + f.index + '" title="抽出 (ダウンロード)">&#11015;</button>';
                if (!info.readOnly && !f.isReadonly) {
                    html += '<button class="disk-editor-btn disk-editor-btn-del" data-action="del-file" data-index="' + f.index + '" title="削除">&#128465;</button>';
                }
            }
            html += '</span>';
            html += '</div>';
        }
        listEl.innerHTML = html;
    }

    function formatBytes(n) {
        if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + 'MB';
        if (n >= 1024) return (n / 1024).toFixed(1) + 'KB';
        return n + 'B';
    }

    function escHtml(s) {
        if (!s) return '';
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ================================================================
    // ファイル操作
    // ================================================================

    function findEntry(index) {
        if (!currentEditor || !currentEditor.fs) return null;
        var dirCluster = currentDirCluster();
        var entries = currentEditor.fs.listDirectory(dirCluster);
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].index === index) return entries[i];
        }
        return null;
    }

    function onExtractFile(index) {
        var entry = findEntry(index);
        if (!entry) return;

        try {
            var data = currentEditor.fs.readFile(entry);
            if (!data) { alert('ファイルの読み取りに失敗しました'); return; }

            var blob = new Blob([data]);
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = entry.fullName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch(e) {
            alert('ファイルの抽出に失敗しました: ' + e.message);
        }
    }

    function onDeleteFile(index) {
        var entry = findEntry(index);
        if (!entry) return;

        if (!confirm('"' + entry.fullName + '" を削除しますか？')) return;

        try {
            currentEditor.fs.deleteFile(entry);
            currentEditor.dirty = true;
            renderEditor();
        } catch(e) {
            alert('削除に失敗しました: ' + e.message);
        }
    }

    function onRenameFile(index) {
        var entry = findEntry(index);
        if (!entry) return;

        var isHuBasic = currentEditor.fs.fsType === 'HuBASIC';
        var maxName = isHuBasic ? 13 : 8;

        var currentName = entry.ext ? (entry.name + '.' + entry.ext) : entry.name;
        var newFullName = prompt('新しいファイル名を入力してください (name.ext):', currentName);
        if (newFullName === null || newFullName === currentName) return;

        var parts = splitFilename(newFullName);
        if (!parts.name) { alert('ファイル名が空です'); return; }
        if (parts.name.length > maxName) {
            alert('ファイル名は' + maxName + '文字以内で指定してください');
            return;
        }

        try {
            currentEditor.fs.renameFile(entry, parts.name, parts.ext);
            currentEditor.dirty = true;
            renderFileList();
        } catch(e) {
            alert('リネームに失敗しました: ' + e.message);
        }
    }

    function onEditMode(index) {
        var entry = findEntry(index);
        if (!entry) return;
        if (currentEditor.fs.fsType !== 'HuBASIC') return;

        // 現在のモードから基本タイプを取得
        var currentType = (entry.mode & 0x02) ? 'B' :
                          (entry.mode & 0x01) ? 'M' : 'A';
        var input = prompt(
            'ファイルモードを入力してください:\n  A = ASCII\n  M = Machine (Binary)\n  B = BASIC',
            currentType
        );
        if (input === null) return;
        input = input.trim().toUpperCase();
        if (input !== 'A' && input !== 'M' && input !== 'B') {
            alert('A, M, B のいずれかを入力してください');
            return;
        }
        if (input === currentType) return;

        try {
            currentEditor.fs.setFileMode(entry, input);
            currentEditor.dirty = true;
            renderFileList();
        } catch(e) {
            alert('モード変更に失敗しました: ' + e.message);
        }
    }

    function onEditAddr(index, field) {
        var entry = findEntry(index);
        if (!entry) return;
        if (currentEditor.fs.fsType !== 'HuBASIC') return;

        var isLoad = (field === 'load');
        var currentVal = isLoad ? entry.loadAddr : entry.execAddr;
        var label = isLoad ? 'ロードアドレス' : '実行アドレス';
        var input = prompt(label + ' (16進数):', hex4(currentVal));
        if (input === null) return;

        var val = parseInt(input, 16);
        if (isNaN(val) || val < 0 || val > 0xFFFF) {
            alert('0000-FFFF の16進数で入力してください');
            return;
        }

        try {
            if (isLoad) {
                currentEditor.fs.setLoadAddr(entry, val);
            } else {
                currentEditor.fs.setExecAddr(entry, val);
            }
            currentEditor.dirty = true;
            renderFileList();
        } catch(e) {
            alert('変更に失敗しました: ' + e.message);
        }
    }

    function onAddFiles(fileList) {
        if (!currentEditor || !currentEditor.fs) return;
        if (!fileList || fileList.length === 0) return;

        var remaining = fileList.length;
        var errors = [];

        for (var i = 0; i < fileList.length; i++) {
            (function(file) {
                var reader = new FileReader();
                reader.onload = function(e) {
                    try {
                        var data = new Uint8Array(e.target.result);
                        var parts = splitFilename(file.name);
                        var dirCluster = currentDirCluster();
                        // 同名ファイルチェック
                        var existing = currentEditor.fs.findByName(parts.name, parts.ext, dirCluster);
                        if (existing) {
                            if (!confirm('"' + existing.fullName + '" は既に存在します。上書きしますか？')) {
                                remaining--;
                                if (remaining === 0) renderEditor();
                                return;
                            }
                            // 削除前に上書き後の容量チェック
                            var info = currentEditor.fs.getInfo();
                            var clusterSize = info.clusterSize || 4096;
                            var existingClusters = Math.max(1, Math.ceil(existing.size / clusterSize));
                            var neededClusters = Math.max(1, Math.ceil(data.length / clusterSize));
                            if (neededClusters > info.freeClusters + existingClusters) {
                                throw new Error('空き容量が不足しています (必要: ' + neededClusters + ', 利用可能: ' + (info.freeClusters + existingClusters) + ' クラスタ)');
                            }
                            currentEditor.fs.deleteFile(existing);
                        }
                        currentEditor.fs.addFile(parts.name, parts.ext, data, dirCluster);
                        currentEditor.dirty = true;
                    } catch(err) {
                        errors.push(file.name + ': ' + err.message);
                    }
                    remaining--;
                    if (remaining === 0) {
                        if (errors.length > 0) {
                            alert('一部のファイル追加に失敗しました:\n' + errors.join('\n'));
                        }
                        renderEditor();
                    }
                };
                reader.onerror = function() {
                    errors.push(file.name + ': 読み取りエラー');
                    remaining--;
                    if (remaining === 0) {
                        if (errors.length > 0) {
                            alert('一部のファイル追加に失敗しました:\n' + errors.join('\n'));
                        }
                        renderEditor();
                    }
                };
                reader.readAsArrayBuffer(file);
            })(fileList[i]);
        }
    }

    function splitFilename(filename) {
        // HuBASIC: name(max 13) + ext(max 3)
        // FAT: name(max 8) + ext(max 3)
        var dot = filename.lastIndexOf('.');
        if (dot >= 0) {
            return {
                name: filename.substring(0, dot),
                ext: filename.substring(dot + 1)
            };
        }
        return { name: filename, ext: '' };
    }

    // ================================================================
    // 保存・閉じる
    // ================================================================

    async function saveAndClose() {
        if (!currentEditor) { closeEditor(); return; }

        if (currentEditor.dirty) {
            try {
                var newData = currentEditor.container.toArrayBuffer();
                await window.XmilStorage.write(currentEditor.key, newData);

                // ライブラリメタデータ更新
                var lib = window.XmilCore.getLibrary();
                for (var i = 0; i < lib.length; i++) {
                    if (lib[i].key === currentEditor.key) {
                        lib[i].size = newData.byteLength;
                        break;
                    }
                }
                window.XmilCore.saveLibrary(lib);
                window.XmilCore.renderLibraryList();

                currentEditor.dirty = false;
            } catch(e) {
                alert('保存に失敗しました: ' + e.message + '\n再試行するか、キャンセルしてください。');
                return; // ダイアログは閉じない
            }
        }

        closeEditor();
    }

    function closeEditor() {
        if (currentEditor && currentEditor.dirty) {
            if (!confirm('変更が保存されていません。閉じますか？')) return;
        }
        currentEditor = null;
        showPanel(false);
    }

    // ================================================================
    // パネル表示制御
    // ================================================================

    function showPanel(show) {
        var panel = document.getElementById('disk-editor-panel');
        if (panel) {
            panel.classList.toggle('hidden', !show);
        }
    }

    // ================================================================
    // イベント初期化
    // ================================================================

    function initEvents() {
        // 閉じるボタン
        var closeBtn = document.getElementById('disk-editor-close');
        if (closeBtn) closeBtn.addEventListener('click', closeEditor);

        // 保存ボタン
        var saveBtn = document.getElementById('disk-editor-save-btn');
        if (saveBtn) saveBtn.addEventListener('click', saveAndClose);

        // ファイル追加ボタン
        var addBtn = document.getElementById('disk-editor-add-btn');
        var fileInput = document.getElementById('disk-editor-file-input');
        if (addBtn && fileInput) {
            addBtn.addEventListener('click', function() {
                fileInput.click();
            });
            fileInput.addEventListener('change', function(e) {
                if (e.target.files && e.target.files.length > 0) {
                    onAddFiles(e.target.files);
                    e.target.value = ''; // リセット
                }
            });
        }

        // ファイルリスト: イベント委譲
        var listEl = document.getElementById('disk-editor-list');
        if (listEl) {
            listEl.addEventListener('click', function(e) {
                var btn = e.target.closest('[data-action]');
                if (!btn) return;
                var action = btn.dataset.action;
                var index = parseInt(btn.dataset.index, 10);
                if (action === 'extract') onExtractFile(index);
                if (action === 'del-file') onDeleteFile(index);
                if (action === 'rename') onRenameFile(index);
                if (action === 'edit-mode') onEditMode(index);
                if (action === 'edit-load') onEditAddr(index, 'load');
                if (action === 'edit-exec') onEditAddr(index, 'exec');
                if (action === 'enter-dir') {
                    var cluster = parseInt(btn.dataset.cluster, 10);
                    var name = btn.dataset.name;
                    navigateToDir(name, cluster);
                }
                if (action === 'nav-path') {
                    var pathIdx = parseInt(btn.dataset.pathIdx, 10);
                    navigateToPathIndex(pathIdx);
                }
            });
        }
    }

    // DOMContentLoaded 後にイベント初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initEvents);
    } else {
        initEvents();
    }

    // ================================================================
    // 公開 API
    // ================================================================
    window.XmilDiskEditor = {
        openEditor: openEditor
    };

})();

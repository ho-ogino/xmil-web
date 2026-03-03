// drive_integration.js - Google Drive integration for X millennium Web
// (Drive API v3 REST + カスタムファイルブラウザ)
//
// Exposes: window.XmilDrive
//   .connectDrive()            → toggle connect/disconnect
//   .disconnectDrive()         → revoke token + clear state
//   .openPickerForSlot(slot)   → Drive ブラウザを開く
//   .saveSlotToDrive(slot)     → flush OPFS → resumable upload to Drive
//   .onLibraryListRendered()   → called by pre.js after renderLibraryList()
//   .closeDriveBrowser()       → Drive ブラウザを閉じる
//
// Requires:
//   DRIVE_CLIENT_ID を Google Cloud Console から取得して設定すること
//   Google Cloud Console: Drive API 有効化・OAuth2 クライアント ID 取得・許可ドメイン設定
//   Scopes: drive.file のみ（アプリが作成したファイルにのみアクセス）

(function() {
    'use strict';

    // ----------------------------------------------------------------
    // 定数（Google Cloud Console から取得して設定）
    // ----------------------------------------------------------------
    // OAuth 設定は config.js (window.XmilConfig) から読み込む。
    // config.js はリポジトリにコミットせず、デプロイ時に注入すること。
    var _cfg             = (window.XmilConfig || {});
    var DRIVE_CLIENT_ID      = _cfg.DRIVE_CLIENT_ID || '';

    // drive.file: アプリが作成したファイルにのみアクセス
    var DRIVE_SCOPE     = 'https://www.googleapis.com/auth/drive.file';

    // ファイルタイプ別サイズ上限（DoS防止）
    var DRIVE_SIZE_LIMIT = { fdd: 32 * 1024 * 1024, cmt: 32 * 1024 * 1024, hdd: 512 * 1024 * 1024 };
    var LS_DRIVE_LINKS  = 'xmil_drive_links';

    // ----------------------------------------------------------------
    // 状態
    // ----------------------------------------------------------------
    var driveToken           = null;   // { accessToken: string, expiresAt: number(ms) } | null
    var driveConnected       = false;
    var tokenClient          = null;   // GIS TokenClient
    var gisInitialized       = false;
    var pendingResolve       = null;
    var pendingReject        = null;
    var inFlightTokenPromise = null;   // single-flight: 同時トークン要求を束ねる

    // Drive ブラウザ状態
    var browserSlotName      = null;   // 選択後にマウントするスロット（null = ライブラリのみ）

    // ----------------------------------------------------------------
    // 永続化（localStorage: xmil_drive_links = { [opfsKey]: DriveLink }）
    // DriveLink = { fileId, name, modifiedTime, savedAt }
    // ----------------------------------------------------------------
    function getDriveLinks() {
        try { return JSON.parse(localStorage.getItem(LS_DRIVE_LINKS) || '{}'); } catch(e) { return {}; }
    }
    function saveDriveLinks(links) {
        try { localStorage.setItem(LS_DRIVE_LINKS, JSON.stringify(links)); } catch(e) {}
    }
    function getLinkForKey(opfsKey) { return getDriveLinks()[opfsKey] || null; }
    function setLinkForKey(opfsKey, link) {
        var links = getDriveLinks();
        if (link === null) { delete links[opfsKey]; }
        else { links[opfsKey] = link; }
        saveDriveLinks(links);
    }

    // ----------------------------------------------------------------
    // GIS スクリプトロード（冪等）
    // ----------------------------------------------------------------
    var _gisLoadPromise = null;
    function loadGIS() {
        if (_gisLoadPromise) return _gisLoadPromise;
        _gisLoadPromise = new Promise(function(res, rej) {
            if (window.google && window.google.accounts) { res(); return; }
            var s = document.createElement('script');
            s.src = 'https://accounts.google.com/gsi/client';
            s.onload = res;
            s.onerror = function() {
                rej(new Error('Google Sign-In の読み込みに失敗しました。広告ブロッカーや Brave Shields が有効な場合は無効にしてお試しください。'));
            };
            document.head.appendChild(s);
        });
        return _gisLoadPromise;
    }

    // ----------------------------------------------------------------
    // GIS 初期化
    // ----------------------------------------------------------------
    function initGIS() {
        if (gisInitialized) return;
        if (!window.google || !window.google.accounts) return;
        tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: DRIVE_CLIENT_ID,
            scope:     DRIVE_SCOPE,
            callback:  function(r) {
                var resolve = pendingResolve, reject = pendingReject;
                pendingResolve = pendingReject = null;
                inFlightTokenPromise = null;
                if (r.error) {
                    driveConnected = false;
                    updateDriveUI();
                    if (reject) reject(new Error(r.error));
                    return;
                }
                driveToken = {
                    accessToken: r.access_token,
                    expiresAt:   Date.now() + r.expires_in * 1000
                };
                driveConnected = true;
                updateDriveUI();
                if (resolve) resolve(r.access_token);
            }
        });
        gisInitialized = true;
    }

    // ----------------------------------------------------------------
    // トークン取得（single-flight + 期限チェック）
    // ----------------------------------------------------------------
    function getValidToken() {
        if (driveToken && Date.now() < driveToken.expiresAt - 60000) {
            return Promise.resolve(driveToken.accessToken);
        }
        if (inFlightTokenPromise) return inFlightTokenPromise;
        if (!tokenClient) return Promise.reject(new Error('tokenClient が初期化されていません'));
        inFlightTokenPromise = new Promise(function(res, rej) {
            pendingResolve = res;
            pendingReject  = rej;
            tokenClient.requestAccessToken({ prompt: '' });
        });
        return inFlightTokenPromise;
    }

    // ----------------------------------------------------------------
    // 接続 / 切断
    // ----------------------------------------------------------------
    async function driveConnect() {
        if (driveConnected) { driveDisconnect(); return; }
        try {
            await loadGIS();
        } catch(e) {
            updateStatus('GIS ロード失敗: ' + e.message);
            return;
        }
        initGIS();
        if (!tokenClient) {
            updateStatus('Drive 初期化失敗');
            return;
        }
        inFlightTokenPromise = new Promise(function(res, rej) {
            pendingResolve = res;
            pendingReject  = rej;
            tokenClient.requestAccessToken({ prompt: 'consent' });
        });
        try {
            await inFlightTokenPromise;
        } catch(e) {
            var _msg  = e.message || String(e);
            var _hint = '';
            if (_msg.indexOf('読み込みに失敗') >= 0 || _msg.indexOf('load failed') >= 0) {
                _hint = ' → 広告ブロッカーや Brave Shields を無効にしてお試しください。';
            } else if (_msg.indexOf('popup') >= 0 || _msg.indexOf('closed') >= 0) {
                _hint = ' → ポップアップがブロックされた可能性があります。ポップアップを許可してください。';
            } else if (_msg.indexOf('401') >= 0 || _msg.indexOf('403') >= 0) {
                _hint = ' → 認証の有効期限が切れました。再度接続してください。';
            }
            updateStatus('Drive 接続失敗: ' + _msg + _hint);
        }
    }

    function driveDisconnect() {
        if (driveToken && window.google && window.google.accounts) {
            try { window.google.accounts.oauth2.revoke(driveToken.accessToken, function() {}); } catch(e) {}
        }
        driveToken           = null;
        driveConnected       = false;
        inFlightTokenPromise = null;
        pendingResolve       = null;
        pendingReject        = null;
        updateDriveUI();
        updateDriveRowButtons();
        updateStatus('Drive 切断しました');
    }

    // ----------------------------------------------------------------
    // Drive REST 共通ラッパー（401 時1回リトライ）
    // ----------------------------------------------------------------
    async function driveApiCall(method, url, options) {
        var token = await getValidToken();
        var headers = Object.assign({ 'Authorization': 'Bearer ' + token }, options.headers || {});
        var resp = await fetch(url, Object.assign({}, options, { method: method, headers: headers }));
        if (resp.status === 401) {
            // トークン期限切れ → サイレント再取得
            driveToken = null;
            inFlightTokenPromise = null;
            token = await getValidToken();
            headers['Authorization'] = 'Bearer ' + token;
            resp = await fetch(url, Object.assign({}, options, { method: method, headers: headers }));
        }
        return resp;
    }

    // ----------------------------------------------------------------
    // Drive: 「X millennium Web」フォルダ内ファイル一覧（REST v3）
    // drive.file スコープ: アプリが作成した「X millennium Web」フォルダを検索し、
    // そのフォルダ内ファイルのみ列挙する（アプリ作成ファイルのみ返される）。
    // ----------------------------------------------------------------
    async function driveListFiles(query) {
        // ① 「X millennium Web」フォルダを全ドライブから検索
        var folderQ = "name = '" + XMIL_FOLDER_NAME.replace(/'/g, "\\'")
            + "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
        var folderUrl = 'https://www.googleapis.com/drive/v3/files'
            + '?q=' + encodeURIComponent(folderQ)
            + '&fields=files(id)&pageSize=50';
        var folderResp = await driveApiCall('GET', folderUrl, {});
        var folderIds = [];
        if (folderResp.ok) {
            var folderData = await folderResp.json();
            folderIds = (folderData.files || []).map(function(f) { return f.id; });
        }
        if (folderIds.length === 0) return [];  // フォルダ未作成 → 空リスト

        // ② フォルダ内ファイルを列挙（複数フォルダ対応）
        var parents = folderIds.map(function(id) {
            return '"' + id + '" in parents';
        }).join(' or ');
        var q = 'trashed = false and (' + parents + ')';
        if (query) {
            q += " and name contains '" + query.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
        }
        var url = 'https://www.googleapis.com/drive/v3/files'
            + '?q=' + encodeURIComponent(q)
            + '&fields=' + encodeURIComponent('files(id,name,size,modifiedTime,mimeType,parents)')
            + '&orderBy=modifiedTime+desc'
            + '&pageSize=100';
        var resp = await driveApiCall('GET', url, {});
        if (!resp.ok) throw new Error('Drive list failed: ' + resp.status);
        var data = await resp.json();
        return data.files || [];
    }

    // ----------------------------------------------------------------
    // Drive: ファイルダウンロード（drive.file でアプリ作成・Picker 選択済みファイルを取得）
    // ----------------------------------------------------------------
    async function driveDownloadFile(fileId, type) {
        // サイズ事前チェック（ダウンロード前に弾く）
        var limit = (type && DRIVE_SIZE_LIMIT[type]) || (512 * 1024 * 1024);
        var metaResp = await driveApiCall('GET',
            'https://www.googleapis.com/drive/v3/files/' + fileId + '?fields=size,name', {});
        if (!metaResp.ok) {
            throw new Error('ファイルメタデータの取得に失敗しました (status: ' + metaResp.status + ')');
        }
        var meta = await metaResp.json();
        var sz = parseInt(meta.size || 0);
        if (sz > limit) {
            throw new Error('ファイルが大きすぎます: ' + (meta.name || fileId)
                + ' (' + (sz / 1024 / 1024).toFixed(1) + 'MB'
                + ' / 上限 ' + (limit / 1024 / 1024).toFixed(0) + 'MB)');
        }
        var resp = await driveApiCall('GET',
            'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media',
            {}
        );
        if (!resp.ok) throw new Error('Drive download failed: ' + resp.status);
        return resp.arrayBuffer();
    }

    // ----------------------------------------------------------------
    // Drive: resumable upload（既存ファイル更新）
    // drive.file スコープで、アプリが作成したファイルのみ更新可
    // ----------------------------------------------------------------
    async function driveUpdateFile(fileId, buffer) {
        var token = await getValidToken();
        var byteLength = buffer.byteLength !== undefined ? buffer.byteLength : buffer.length;

        // Phase 1: resumable セッション開始
        var initResp = await fetch(
            'https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=resumable',
            {
                method:  'PATCH',
                headers: {
                    'Authorization':           'Bearer ' + token,
                    'Content-Type':            'application/json',
                    'X-Upload-Content-Type':   'application/octet-stream',
                    'X-Upload-Content-Length': String(byteLength)
                },
                body: '{}'
            }
        );
        if (!initResp.ok) {
            var initErr = new Error('Drive resumable init failed: ' + initResp.status);
            initErr.status = initResp.status;
            throw initErr;
        }
        var sessionUri = initResp.headers.get('Location');
        if (!sessionUri) throw new Error('Drive resumable: Location header missing');

        // Phase 2: 全量 PUT
        var uploadResp = await fetch(sessionUri, {
            method:  'PUT',
            headers: {
                'Content-Length': String(byteLength),
                'Content-Type':   'application/octet-stream'
            },
            body: buffer
        });
        if (!uploadResp.ok) {
            var uploadErr = new Error('Drive upload failed: ' + uploadResp.status);
            uploadErr.status = uploadResp.status;
            throw uploadErr;
        }
        return uploadResp.json();
    }

    // ----------------------------------------------------------------
    // Drive: 「X millennium Web」サブフォルダの取得または作成
    // parentId: 元ファイルの親フォルダID（null = Drive ルート）
    // 同セッション内で結果をキャッシュして API 呼び出しを節約
    // ----------------------------------------------------------------
    var XMIL_FOLDER_NAME  = 'X millennium Web';
    var _xmilFolderCache  = {};  // { parentCacheKey: folderId }
    var _folderNameCache  = {};  // { folderId: folderName } — フォルダ名キャッシュ

    // フォルダ名を取得（drive.file でアプリ作成フォルダは取得可。権限なし→null を返す）
    async function driveGetFolderName(folderId) {
        if (_folderNameCache[folderId] !== undefined) return _folderNameCache[folderId];
        var resp = await driveApiCall('GET',
            'https://www.googleapis.com/drive/v3/files/' + folderId + '?fields=name,mimeType',
            {}
        );
        if (!resp.ok) { _folderNameCache[folderId] = null; return null; }
        var data = await resp.json();
        _folderNameCache[folderId] = data.name || null;
        return _folderNameCache[folderId];
    }

    // 保存先フォルダを解決
    // - sourceParentId が「X millennium Web」フォルダなら → そのまま返す（二重ネスト防止）
    // - そうでなければ → [sourceParentId]/X millennium Web/ を取得または作成
    async function driveResolveSaveFolder(sourceParentId) {
        if (sourceParentId) {
            var name = await driveGetFolderName(sourceParentId);
            if (name === XMIL_FOLDER_NAME) {
                // 元ファイルはすでに「X millennium Web」フォルダ内 → 同フォルダに直接作成
                return sourceParentId;
            }
        }
        return driveGetOrCreateXmilFolder(sourceParentId);
    }

    async function driveGetOrCreateXmilFolder(parentId) {
        var cacheKey = parentId || 'root';
        if (_xmilFolderCache[cacheKey]) return _xmilFolderCache[cacheKey];

        // 既存フォルダを検索（drive.file: アプリ作成フォルダのみ対象）
        var parentQ  = parentId ? ("'" + parentId + "' in parents") : "'root' in parents";
        var q = "name = '" + XMIL_FOLDER_NAME.replace(/'/g, "\\'") + "'"
            + " and mimeType = 'application/vnd.google-apps.folder'"
            + ' and ' + parentQ
            + ' and trashed = false';
        var url = 'https://www.googleapis.com/drive/v3/files'
            + '?q='      + encodeURIComponent(q)
            + '&fields=' + encodeURIComponent('files(id)')
            + '&pageSize=1';
        var resp = await driveApiCall('GET', url, {});
        if (!resp.ok) throw new Error('Drive folder search failed: ' + resp.status);
        var data = await resp.json();
        if (data.files && data.files.length > 0) {
            _xmilFolderCache[cacheKey] = data.files[0].id;
            return data.files[0].id;
        }

        // フォルダが存在しなければ作成（drive.file で可）
        var token    = await getValidToken();
        var metadata = { name: XMIL_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' };
        if (parentId) metadata.parents = [parentId];
        var createResp = await fetch(
            'https://www.googleapis.com/drive/v3/files?fields=id',
            {
                method:  'POST',
                headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                body:    JSON.stringify(metadata)
            }
        );
        if (!createResp.ok) throw new Error('Drive folder create failed: ' + createResp.status);
        var created = await createResp.json();
        _xmilFolderCache[cacheKey] = created.id;
        return created.id;
    }

    // ----------------------------------------------------------------
    // Drive: resumable upload（新規ファイル作成）
    // parentId: 保存先フォルダID（指定なし = Drive ルート）
    // drive.file スコープで作成可（この後の update も drive.file で OK）
    // ----------------------------------------------------------------
    async function driveCreateFile(name, buffer, parentId) {
        var token = await getValidToken();
        var byteLength = buffer.byteLength !== undefined ? buffer.byteLength : buffer.length;

        // Phase 1: resumable セッション開始
        var metadata = { name: name };
        if (parentId) metadata.parents = [parentId];
        var initResp = await fetch(
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,modifiedTime',
            {
                method:  'POST',
                headers: {
                    'Authorization':           'Bearer ' + token,
                    'Content-Type':            'application/json',
                    'X-Upload-Content-Type':   'application/octet-stream',
                    'X-Upload-Content-Length': String(byteLength)
                },
                body: JSON.stringify(metadata)
            }
        );
        if (!initResp.ok) throw new Error('Drive create init failed: ' + initResp.status);
        var sessionUri = initResp.headers.get('Location');
        if (!sessionUri) throw new Error('Drive create: Location header missing');

        // Phase 2: 全量 PUT
        var uploadResp = await fetch(sessionUri, {
            method:  'PUT',
            headers: {
                'Content-Length': String(byteLength),
                'Content-Type':   'application/octet-stream'
            },
            body: buffer
        });
        if (!uploadResp.ok) throw new Error('Drive create upload failed: ' + uploadResp.status);
        return uploadResp.json(); // { id, modifiedTime }
    }

    // ================================================================
    // Drive カスタムファイルブラウザ（gapi.js Picker の代替）
    // Google Picker は gapi.js の gadgets.rpc relay 問題で localhost 不動のため廃止
    // ================================================================

    function escHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatFileSize(bytes) {
        if (bytes === null || bytes === undefined) return '-';
        bytes = Number(bytes);
        if (isNaN(bytes)) return '-';
        if (bytes < 1024)             return bytes + ' B';
        if (bytes < 1024 * 1024)      return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    async function showDriveBrowser(slotName) {
        if (!driveConnected) {
            await driveConnect();
            if (!driveConnected) return;
        }
        browserSlotName = (slotName !== undefined && slotName !== null && slotName !== '') ? slotName : null;

        var modal = document.getElementById('drive-browser-modal');
        if (!modal) { console.error('drive-browser-modal not found'); return; }
        modal.classList.remove('hidden');

        var input = document.getElementById('drive-search-input');
        if (input) input.value = '';
        renderBrowserLoading('読み込み中...');

        try {
            var files = await driveListFiles('');
            renderDriveFileList(files);
        } catch(e) {
            renderBrowserError('読み込み失敗: ' + e.message);
        }
    }

    function hideDriveBrowser() {
        var modal = document.getElementById('drive-browser-modal');
        if (modal) modal.classList.add('hidden');
        browserSlotName = null;
    }

    function renderBrowserLoading(msg) {
        var el = document.getElementById('drive-file-list');
        if (el) el.innerHTML = '<li class="drive-file-msg">' + escHtml(msg) + '</li>';
    }

    function renderBrowserError(msg) {
        var el = document.getElementById('drive-file-list');
        if (el) el.innerHTML = '<li class="drive-file-msg drive-file-error">' + escHtml(msg) + '</li>';
    }

    function renderDriveFileList(files) {
        var listEl = document.getElementById('drive-file-list');
        if (!listEl) return;
        if (!files || files.length === 0) {
            listEl.innerHTML = '<li class="drive-file-msg">ファイルが見つかりません</li>';
            return;
        }
        var html = '';
        files.forEach(function(f) {
            // parents[0] = 親フォルダID（保存時に同フォルダへ作成するために使用）
            var parentId = (f.parents && f.parents.length > 0) ? f.parents[0] : '';
            html += '<li class="drive-file-item"'
                + ' data-id="' + escHtml(f.id) + '"'
                + ' data-name="' + escHtml(f.name) + '"'
                + ' data-parent="' + escHtml(parentId) + '">'
                + '<span class="drive-file-name">' + escHtml(f.name) + '</span>'
                + '<span class="drive-file-size">' + formatFileSize(f.size) + '</span>'
                + '</li>';
        });
        listEl.innerHTML = html;

        // クリックハンドラ（browserSlotName を closure でキャプチャ）
        listEl.querySelectorAll('.drive-file-item').forEach(function(item) {
            item.addEventListener('click', function() {
                var fileId   = this.dataset.id;
                var fileName = this.dataset.name;
                var parentId = this.dataset.parent || null;  // 元のフォルダID
                var slot     = browserSlotName;   // hideDriveBrowser() より前にキャプチャ
                hideDriveBrowser();
                driveSelectAndMount(slot, fileId, fileName, parentId);
            });
        });
    }

    async function driveBrowserSearch() {
        var input = document.getElementById('drive-search-input');
        var query = input ? input.value.trim() : '';
        renderBrowserLoading('検索中...');
        try {
            var files = await driveListFiles(query);
            renderDriveFileList(files);
        } catch(e) {
            renderBrowserError('検索失敗: ' + e.message);
        }
    }

    // ----------------------------------------------------------------
    // 統合操作: Drive ファイル選択 → OPFS ライブラリ → マウント
    // ----------------------------------------------------------------
    async function driveSelectAndMount(slotName, fileId, driveName, parentId) {
        if (!window.XmilCore) { console.error('XmilCore not available'); return; }
        try {
            // ファイルタイプ判定（未知形式はダウンロード前に中断）
            var fileType = window.XmilCore.detectFileType ? window.XmilCore.detectFileType(driveName) : null;
            if (!fileType) {
                updateStatus('対応していないファイル形式です: ' + driveName);
                return;
            }
            updateStatus('Driveからダウンロード中: ' + driveName + ' ...');
            var buf   = await driveDownloadFile(fileId, fileType);
            var file  = new File([buf], driveName, { type: 'application/octet-stream' });
            var entry = await window.XmilCore.addToLibrary(file);
            if (!entry) {
                updateStatus('ライブラリ追加失敗: ' + driveName);
                return;
            }
            // 元フォルダIDをプレースホルダーリンクとして保存
            // 元ファイルが「X millennium Web」フォルダ内にある場合は、その fileId を保持して
            // 保存時に直接上書き更新を試みる（別PCで保存したファイルの継続編集をサポート）
            // 元フォルダが「X millennium Web」かどうかはフォルダ名確認で判定（非同期・失敗しても続行）
            var isXmilFolder = false;
            if (parentId) {
                try {
                    var parentName = await driveGetFolderName(parentId);
                    isXmilFolder = (parentName === XMIL_FOLDER_NAME);
                } catch(e) { /* フォルダ名取得失敗は無視 */ }
            }
            setLinkForKey(entry.key, {
                fileId:   isXmilFolder ? fileId : null,  // X millennium Web 内ならそのまま更新可
                parentId: parentId || null,
                name:     driveName,
                savedAt:  null
            });
            if (slotName) {
                await window.XmilCore.mountFromLibrary(entry.key, slotName);
            }
            updateDriveRowButtons();
            updateStatus('Driveからロード完了: ' + driveName);
        } catch(e) {
            console.error('driveSelectAndMount error:', e);
            updateStatus('Driveロード失敗: ' + e.message);
        }
    }

    // ----------------------------------------------------------------
    // 統合操作: OPFS キー → Drive 保存（マウント中/イジェクト済み両対応）
    // ----------------------------------------------------------------
    async function driveSaveByKey(opfsKey) {
        if (!opfsKey) return;
        if (!window.XmilCore)    { console.error('XmilCore not available');    return; }
        if (!window.XmilStorage) { console.error('XmilStorage not available'); return; }

        var lib   = window.XmilCore.getLibrary();
        var entry = lib ? lib.find(function(e) { return e.key === opfsKey; }) : null;
        if (!entry) { showDriveStatus('ライブラリにエントリーが見つかりません', 'error'); return; }

        // マウント中スロットを探す
        var ss          = window.XmilCore.getSlotState();
        var mountedSlot = null;
        for (var sn in ss) { if (ss[sn] === opfsKey) { mountedSlot = sn; break; } }

        // FDD / CMT はマウント中のみ未フラッシュデータの可能性あり → confirm で警告
        // イジェクト済みは OPFS に確定済みのため警告不要
        var isFddCmt = (mountedSlot === 'drive0' || mountedSlot === 'drive1' || mountedSlot === 'cmt');
        if (isFddCmt) {
            if (!confirm(
                'FDD/CMT がマウント中です。最後の書き込みが未確定の可能性があります。\n' +
                '確実なデータが必要な場合はイジェクトしてから保存してください。\n' +
                'このまま保存しますか？'
            )) return;
        }

        // 対象ボタンをローディング状態にする
        var listEl  = document.getElementById('library-list');
        var saveBtn = listEl ? listEl.querySelector('.lib-drive-save-btn[data-key="' + opfsKey + '"]') : null;
        var origText = saveBtn ? saveBtn.textContent : null;
        if (saveBtn) { saveBtn.classList.add('saving'); saveBtn.textContent = '…'; }

        try {
            showDriveStatus('保存中: ' + entry.name + ' ...', 'progress');
            // マウント中の場合は VFS の変更を OPFS に確定させる
            if (mountedSlot) {
                await window.XmilCore.flushSlot(mountedSlot);
            }
            // OPFS から読む
            var data = await window.XmilStorage.read(opfsKey);
            if (!data) { showDriveStatus('ストレージ読み込み失敗: ' + entry.name, 'error'); return; }

            var link = getLinkForKey(opfsKey);

            var needsCreate = !(link && link.fileId);

            if (!needsCreate) {
                // ── 既存 Drive ファイルを更新（アプリが作成したファイル → drive.file で可）──
                try {
                    var meta = await driveUpdateFile(link.fileId, data);
                    link.modifiedTime = meta.modifiedTime || link.modifiedTime;
                    link.savedAt      = new Date().toISOString();
                    setLinkForKey(opfsKey, link);
                    showDriveStatus('✓ Drive保存完了: ' + entry.name, 'success');
                    updateDriveRowButtons();
                    return;
                } catch(updateErr) {
                    // 403/404 のみ新規作成へフォールバック（権限不足/リンク切れ）。
                    // それ以外のエラー（通信断・5xx等）は失敗として扱う。
                    var st = updateErr && updateErr.status;
                    if (st === 403 || st === 404) {
                        console.warn('driveUpdateFile failed (' + updateErr.message + '), falling back to create');
                        needsCreate = true;
                    } else {
                        throw updateErr;
                    }
                }
            }

            if (needsCreate) {
                // ── 新規作成 ──
                // 保存先: [元ファイルの親フォルダ]/X millennium Web/  または  /X millennium Web/
                // 同名ファイルとの混在を防ぐためサブフォルダを使用
                var sourceParentId = link ? link.parentId : null;
                var location = sourceParentId
                    ? '元フォルダ内の「' + XMIL_FOLDER_NAME + '」フォルダ'
                    : 'Driveルートの「' + XMIL_FOLDER_NAME + '」フォルダ';
                if (!confirm(
                    '"' + entry.name + '" を Google Drive に保存しますか？\n' +
                    '保存先: ' + location
                )) return;

                showDriveStatus('保存先フォルダを確認中...', 'progress');
                // driveResolveSaveFolder: 元フォルダが「X millennium Web」なら二重ネストしない
                var xmilFolderId = await driveResolveSaveFolder(sourceParentId);

                showDriveStatus('Driveにアップロード中...', 'progress');
                var created = await driveCreateFile(entry.name, data, xmilFolderId);
                setLinkForKey(opfsKey, {
                    fileId:       created.id,
                    parentId:     sourceParentId || null,
                    name:         entry.name,
                    modifiedTime: created.modifiedTime || '',
                    savedAt:      new Date().toISOString()
                });
                showDriveStatus('✓ Drive保存完了: ' + location + '/' + entry.name, 'success');
            }
            updateDriveRowButtons();
        } catch(e) {
            console.error('driveSaveByKey error:', e);
            showDriveStatus('✗ Drive保存失敗: ' + e.message, 'error');
        } finally {
            if (saveBtn) { saveBtn.classList.remove('saving'); saveBtn.textContent = origText || '☁'; }
        }
    }

    // スロット名からキーを解決して driveSaveByKey に委譲（後方互換用）
    async function driveSaveSlot(slotName) {
        if (!slotName) return;
        if (!window.XmilCore) { console.error('XmilCore not available'); return; }
        var ss      = window.XmilCore.getSlotState();
        var opfsKey = ss[slotName];
        if (!opfsKey) { updateStatus('スロットにファイルがマウントされていません'); return; }
        await driveSaveByKey(opfsKey);
    }

    // ----------------------------------------------------------------
    // UI 更新
    // ----------------------------------------------------------------
    function updateDriveUI() {
        var connectBtn = document.getElementById('btn-drive-connect');
        var pickBtn    = document.getElementById('btn-drive-pick');

        if (connectBtn) {
            if (driveConnected) {
                connectBtn.textContent = '✓ Drive 接続中';
                connectBtn.classList.add('connected');
            } else {
                connectBtn.textContent = '☁ Drive 接続';
                connectBtn.classList.remove('connected');
            }
        }
        if (pickBtn) {
            if (driveConnected) { pickBtn.classList.remove('hidden'); }
            else                { pickBtn.classList.add('hidden');    }
        }
        updateDriveRowButtons();
    }

    function updateDriveRowButtons() {
        var listEl = document.getElementById('library-list');
        if (!listEl) return;
        var buttons = listEl.querySelectorAll('.lib-drive-save-btn');
        if (buttons.length === 0) return;

        // 現在のスロット状態（XmilCore 経由・浅いコピー）
        var ss = (window.XmilCore && window.XmilCore.getSlotState) ? window.XmilCore.getSlotState() : {};

        buttons.forEach(function(btn) {
            var key = btn.dataset.key;
            if (!key) return;

            // マウント中スロットを探す
            var mounted = false;
            for (var sn in ss) {
                if (ss[sn] === key) { mounted = true; break; }
            }

            // 表示制御: Drive 接続中の行はマウント中/イジェクト済み問わず表示
            if (!driveConnected) {
                btn.classList.add('hidden');
                btn.classList.remove('linked');
                return;
            }
            btn.classList.remove('hidden');

            // FDD/CMT がマウント中の場合は tooltip に注記
            var isMountedFddCmt = mounted && (ss['drive0'] === key || ss['drive1'] === key || ss['cmt'] === key);
            var mountNote = isMountedFddCmt ? ' (⚠ マウント中)' : '';

            // Drive リンクあり（fileId が確定済み）→ .linked クラス
            var link = getLinkForKey(key);
            if (link && link.fileId) {
                btn.classList.add('linked');
                btn.title = 'Driveへ保存 (リンク済み: ' + link.name + ')' + mountNote;
            } else if (link && link.parentId) {
                // Driveからダウンロード済み・未保存: 元フォルダが分かっている
                btn.classList.remove('linked');
                btn.title = 'Google Driveに保存 (元フォルダの「' + XMIL_FOLDER_NAME + '」内に作成)' + mountNote;
            } else {
                btn.classList.remove('linked');
                btn.title = 'Google Driveに新規保存 (「' + XMIL_FOLDER_NAME + '」フォルダに作成)' + mountNote;
            }
        });
    }

    function updateStatus(text) {
        if (window.XmilCore && window.XmilCore.updateStatus) {
            window.XmilCore.updateStatus(text);
        }
    }

    // ライブラリパネル内のドライブステータス表示
    var _driveStatusTimer = null;
    function showDriveStatus(text, type) {
        var el = document.getElementById('drive-status');
        if (!el) return;
        clearTimeout(_driveStatusTimer);
        el.className = type ? 'drive-' + type : '';
        el.textContent = text;
        // success / error は 4 秒後に自動消去
        if (type === 'success' || type === 'error') {
            _driveStatusTimer = setTimeout(function() { el.classList.add('hidden'); }, 4000);
        }
    }

    // ----------------------------------------------------------------
    // 初期化（DOM 準備後）
    // ----------------------------------------------------------------
    function init() {
        // ☁ Drive ブラウザボタン（ライブラリパネル内）
        var pickBtn = document.getElementById('btn-drive-pick');
        if (pickBtn) {
            pickBtn.addEventListener('click', function() {
                var slot = this.dataset.slot || null;
                showDriveBrowser(slot);
            });
        }

        // Drive ブラウザ: 検索ボタン
        var searchBtn = document.getElementById('drive-search-btn');
        if (searchBtn) {
            searchBtn.addEventListener('click', driveBrowserSearch);
        }

        // Drive ブラウザ: Enter キーで検索
        var searchInput = document.getElementById('drive-search-input');
        if (searchInput) {
            searchInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') driveBrowserSearch();
            });
        }

        // Drive ブラウザ: キャンセルボタン
        var cancelBtn = document.getElementById('drive-browser-cancel');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', hideDriveBrowser);
        }

        // Drive ブラウザ: 背景クリックで閉じる
        var modal = document.getElementById('drive-browser-modal');
        if (modal) {
            modal.addEventListener('click', function(e) {
                if (e.target === modal) hideDriveBrowser();
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // ----------------------------------------------------------------
    // 公開インターフェース
    // ----------------------------------------------------------------
    window.XmilDrive = {
        connectDrive:          driveConnect,
        disconnectDrive:       driveDisconnect,
        openPickerForSlot:     showDriveBrowser,
        saveSlotToDrive:       driveSaveSlot,
        saveByKey:             driveSaveByKey,
        onLibraryListRendered: updateDriveRowButtons,
        closeDriveBrowser:     hideDriveBrowser
    };

})();

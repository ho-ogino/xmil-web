// disk_fs.js - ディスクファイルシステムパーサ (HuBASIC / LSX-Dodgers FAT)
// X millennium Web - ディスク編集ツール (ファイルシステム層)
(function() {
    'use strict';

    var decodeSJIS = window.XmilDiskContainer.decodeSJIS;

    // ================================================================
    // 共通ユーティリティ
    // ================================================================

    // BCD バイトをデコード
    function bcd(b) {
        return ((b >> 4) & 0x0F) * 10 + (b & 0x0F);
    }

    // BCD エンコード
    function toBcd(n) {
        n = n % 100;
        return ((Math.floor(n / 10) & 0x0F) << 4) | (n % 10);
    }

    // HuBASIC 日付パース (6 bytes)
    // [0] year (binary, +2000 if <80)
    // [1] upper nibble=month, lower nibble=day-of-week
    // [2] day (BCD)
    // [3] hour (BCD)
    // [4] minute (BCD)
    // [5] second (BCD)
    function parseHuBasicDate(data, offset) {
        var year = data[offset];
        if (year < 80) year += 2000; else year += 1900;
        var month = (data[offset + 1] >> 4) & 0x0F;
        var day = bcd(data[offset + 2]);
        var hour = bcd(data[offset + 3]);
        var min = bcd(data[offset + 4]);

        if (month < 1 || month > 12 || day < 1 || day > 31) return '';

        return (year % 100).toString().padStart(2, '0') + '/' +
               month.toString().padStart(2, '0') + '/' +
               day.toString().padStart(2, '0') + ' ' +
               hour.toString().padStart(2, '0') + ':' +
               min.toString().padStart(2, '0');
    }

    // 現在日時を HuBASIC BCD 日付に変換 (6 bytes)
    function makeHuBasicDate() {
        var now = new Date();
        var buf = new Uint8Array(6);
        buf[0] = now.getFullYear() % 100;
        buf[1] = ((now.getMonth() + 1) << 4) | (now.getDay() & 0x07);
        buf[2] = toBcd(now.getDate());
        buf[3] = toBcd(now.getHours());
        buf[4] = toBcd(now.getMinutes());
        buf[5] = toBcd(now.getSeconds());
        return buf;
    }

    // ファイルモードの人間可読文字列
    function modeString(mode) {
        if (mode === 0x00) return 'DEL';
        if (mode === 0xFF) return '';
        var s = '';
        if (mode & 0x02) s += 'B'; // BASIC
        else if (mode & 0x01) s += 'M'; // Machine (binary)
        else s += 'A'; // ASCII
        if (mode & 0x40) s += 'R'; // Read-only
        if (mode & 0x10) s += 'H'; // Hidden
        if (mode & 0x80) s += 'D'; // Directory
        return s;
    }

    // ================================================================
    // HuBasicFS - HuBASIC ファイルシステム
    // ================================================================

    // layoutOverride: 省略時は fdType から自動判定。
    //   '2d' を指定すると 2HD 物理メディア上でも 2D レイアウト
    //   (FAT=LS15, Dir=LS17, 80クラスタ) を使用する (S-OS 等)。
    function HuBasicFS(container, layoutOverride) {
        this._container = container;
        this.fsType = 'HuBASIC';
        this.readOnly = false;
        this.readOnlyReason = '';

        var geom = container.getGeometry();
        this._fdType = geom.fdType;
        this._sectorSize = geom.sectorSize || 256;

        // 物理ジオメトリに基づくセクタ/トラック (CHS 変換用)
        var physSPT = (this._fdType === 0x20) ? 26 : 16;

        // レイアウト判定: 2HD 物理でも layoutOverride='2d' なら 2D レイアウト
        // layoutOverride='2hd' なら fdType に関係なく 2HD レイアウトを強制 (HDD 等)
        var use2hdLayout = (layoutOverride === '2hd') ||
                           ((this._fdType === 0x20) && (layoutOverride !== '2d'));

        if (use2hdLayout) {
            // 標準 2HD レイアウト (SPT=26 を明示固定)
            this._sectorsPerTrack = 26;
            this._fatSectors = [29, 30];  // 論理セクタ (1-based)
            this._maxClusters = 250;
            this._reservedClusters = 3;
            this._dirStartSector = 33;
            this._dirSectors = 16;
            this._formatName = '2HD';
        } else {
            // 2D レイアウト (2D/2DD 物理、または 2HD 物理上の S-OS 等)
            this._sectorsPerTrack = physSPT;
            this._fatSectors = [15];
            this._maxClusters = 80;
            this._reservedClusters = 2;
            this._dirStartSector = 17;
            this._dirSectors = 10;
            if (this._fdType === 0x20) {
                this._formatName = '2HD (2D layout)';
            } else {
                this._formatName = (this._fdType === 0x10) ? '2DD' : '2D';
            }
        }

        this._clusterSectors = 16; // 1 cluster = 16 sectors

        // ライトプロテクトチェック
        if (container.protect) {
            this.readOnly = true;
            this.readOnlyReason = 'ライトプロテクトされています';
        }

        // FAT 読み込み
        this._fat = null;
        this._fatDirty = false;
        this._dirEntries = null;
        this._dirRawSectors = null;
        this._dirDirty = false;
        this._anomalyDetected = false;

        try {
            this._readFat();
            this._readDirectory();
        } catch(e) {
            this._anomalyDetected = true;
            this.readOnly = true;
            this.readOnlyReason = 'ディレクトリに異常があるため読み取り専用です';
        }
    }

    // 論理セクタ(1-based) → 物理 C, H, R
    HuBasicFS.prototype._logicalToPhysical = function(logSector) {
        var idx = logSector - 1; // 0-based
        var sectorsPerCyl = this._sectorsPerTrack * 2;
        var c = Math.floor(idx / sectorsPerCyl);
        var rem = idx % sectorsPerCyl;
        var h = Math.floor(rem / this._sectorsPerTrack);
        var r = (rem % this._sectorsPerTrack) + 1;
        return { c: c, h: h, r: r };
    };

    HuBasicFS.prototype._readLogicalSector = function(logSector) {
        // LBA 対応コンテナ (HDD/EMM) は CHS 変換をスキップ
        // HuBASIC 論理セクタは 1-based → LBA は 0-based
        if (this._container.readSectorLBA) {
            return this._container.readSectorLBA(logSector - 1);
        }
        var p = this._logicalToPhysical(logSector);
        return this._container.readSector(p.c, p.h, p.r);
    };

    HuBasicFS.prototype._writeLogicalSector = function(logSector, data) {
        if (this._container.writeSectorLBA) {
            this._container.writeSectorLBA(logSector - 1, data);
            return;
        }
        var p = this._logicalToPhysical(logSector);
        this._container.writeSector(p.c, p.h, p.r, data);
    };

    // FAT 読み込み
    HuBasicFS.prototype._readFat = function() {
        this._fat = new Uint8Array(this._maxClusters);
        var pos = 0;
        for (var i = 0; i < this._fatSectors.length; i++) {
            var data = this._readLogicalSector(this._fatSectors[i]);
            if (!data) throw new Error('FAT sector read failed: ' + this._fatSectors[i]);
            var copyLen = Math.min(data.length, this._maxClusters - pos);
            for (var j = 0; j < copyLen; j++) {
                this._fat[pos++] = data[j];
            }
        }
    };

    // FAT 書き戻し
    HuBasicFS.prototype._writeFat = function() {
        var pos = 0;
        for (var i = 0; i < this._fatSectors.length; i++) {
            var data = this._readLogicalSector(this._fatSectors[i]);
            if (!data) data = new Uint8Array(this._sectorSize);
            else data = new Uint8Array(data); // コピー
            var copyLen = Math.min(data.length, this._maxClusters - pos);
            for (var j = 0; j < copyLen; j++) {
                data[j] = this._fat[pos++];
            }
            this._writeLogicalSector(this._fatSectors[i], data);
        }
        this._fatDirty = false;
    };

    // ディレクトリ読み込み
    HuBasicFS.prototype._readDirectory = function() {
        this._dirEntries = [];
        this._dirRawSectors = [];

        for (var s = 0; s < this._dirSectors; s++) {
            var logSec = this._dirStartSector + s;
            var data = this._readLogicalSector(logSec);
            if (!data) {
                this._anomalyDetected = true;
                break;
            }
            this._dirRawSectors.push({ sector: logSec, data: new Uint8Array(data) });

            var entriesPerSector = Math.floor(data.length / 32);
            for (var e = 0; e < entriesPerSector; e++) {
                var off = e * 32;
                var mode = data[off];

                if (mode === 0xFF) {
                    // 終端マーカ — ここでディレクトリ走査終了
                    this._dirEntries.push({
                        mode: 0xFF,
                        isEnd: true,
                        sectorIdx: s,
                        entryIdx: e
                    });
                    return;
                }

                var rawEntry = data.slice(off, off + 32);
                var entry = this._parseDirEntry(rawEntry, s, e);
                this._dirEntries.push(entry);
            }
        }
    };

    // ディレクトリエントリのパース
    HuBasicFS.prototype._parseDirEntry = function(raw, sectorIdx, entryIdx) {
        var mode = raw[0];
        var entry = {
            mode: mode,
            isEnd: false,
            isDeleted: (mode === 0x00),
            isDirectory: !!(mode & 0x80),
            isReadonly: !!(mode & 0x40),
            isHidden: !!(mode & 0x10),
            isBASIC: !!(mode & 0x02),
            isBinary: !!(mode & 0x01),
            name: decodeSJIS(raw, 1, 13),
            ext: decodeSJIS(raw, 14, 3),
            password: raw[0x11],
            size: raw[0x12] | (raw[0x13] << 8),
            loadAddr: raw[0x14] | (raw[0x15] << 8),
            execAddr: raw[0x16] | (raw[0x17] << 8),
            date: parseHuBasicDate(raw, 0x18),
            startCluster: (raw[0x1F] << 7) | (raw[0x1E] & 0x7F),
            modeStr: modeString(mode),
            rawEntry: new Uint8Array(raw),
            sectorIdx: sectorIdx,
            entryIdx: entryIdx
        };
        entry.fullName = entry.ext ? (entry.name + '.' + entry.ext) : entry.name;
        return entry;
    };

    // ディレクトリセクタ書き戻し
    HuBasicFS.prototype._writeDirectory = function() {
        for (var i = 0; i < this._dirRawSectors.length; i++) {
            var info = this._dirRawSectors[i];
            this._writeLogicalSector(info.sector, info.data);
        }
        this._dirDirty = false;
    };

    // ディレクトリエントリをセクタバッファに反映
    HuBasicFS.prototype._updateDirEntryInBuffer = function(entry) {
        var info = this._dirRawSectors[entry.sectorIdx];
        if (!info) return;
        var off = entry.entryIdx * 32;
        info.data.set(entry.rawEntry, off);
    };

    // ================================================================
    // 公開 API
    // ================================================================

    HuBasicFS.prototype.renameFile = function(entry, newName, newExt) {
        if (this.readOnly) throw new Error(this.readOnlyReason || '読み取り専用です');
        if (entry.isDeleted || entry.isEnd) throw new Error('無効なエントリです');
        if (!newName || newName.length > 13) throw new Error('ファイル名は1-13文字で指定してください');
        if (newExt && newExt.length > 3) throw new Error('拡張子は3文字以内で指定してください');

        var raw = entry.rawEntry;
        for (var i = 0; i < 13; i++) {
            raw[1 + i] = (i < newName.length) ? newName.charCodeAt(i) : 0x20;
        }
        for (var i = 0; i < 3; i++) {
            raw[14 + i] = (i < (newExt || '').length) ? newExt.charCodeAt(i) : 0x20;
        }
        entry.name = decodeSJIS(raw, 1, 13);
        entry.ext = decodeSJIS(raw, 14, 3);
        entry.fullName = entry.ext ? (entry.name + '.' + entry.ext) : entry.name;

        this._updateDirEntryInBuffer(entry);
        this._writeDirectory();
    };

    HuBasicFS.prototype.setLoadAddr = function(entry, addr) {
        if (this.readOnly) throw new Error(this.readOnlyReason || '読み取り専用です');
        entry.rawEntry[0x14] = addr & 0xFF;
        entry.rawEntry[0x15] = (addr >> 8) & 0xFF;
        entry.loadAddr = addr;
        this._updateDirEntryInBuffer(entry);
        this._writeDirectory();
    };

    HuBasicFS.prototype.setExecAddr = function(entry, addr) {
        if (this.readOnly) throw new Error(this.readOnlyReason || '読み取り専用です');
        entry.rawEntry[0x16] = addr & 0xFF;
        entry.rawEntry[0x17] = (addr >> 8) & 0xFF;
        entry.execAddr = addr;
        this._updateDirEntryInBuffer(entry);
        this._writeDirectory();
    };

    HuBasicFS.prototype.setFileMode = function(entry, newMode) {
        if (this.readOnly) throw new Error(this.readOnlyReason || '読み取り専用です');
        // newMode: 'A' (ASCII), 'M' (Machine/Binary), 'B' (BASIC)
        // 既存の上位ビット (RO, Hidden, Dir 等) は保持し、bit0-1 のみ変更
        var mode = entry.rawEntry[0] & 0xFC; // bit0,1 をクリア
        if (newMode === 'M') mode |= 0x01;
        else if (newMode === 'B') mode |= 0x02;
        // 'A' は bit0,1 共に 0 だが mode=0x00 は削除マーク
        // → 上位ビットが全て 0 の場合、bit5 を立てて 0x00 を回避
        if (mode === 0x00) mode = 0x20;
        entry.rawEntry[0] = mode;
        entry.mode = mode;
        entry.isBinary = !!(mode & 0x01);
        entry.isBASIC = !!(mode & 0x02);
        entry.modeStr = modeString(mode);
        this._updateDirEntryInBuffer(entry);
        this._writeDirectory();
    };

    HuBasicFS.prototype.findByName = function(name, ext) {
        var nu = name.toUpperCase(), eu = (ext || '').toUpperCase();
        for (var i = 0; i < this._dirEntries.length; i++) {
            var e = this._dirEntries[i];
            if (e.isEnd) break;
            if (e.isDeleted) continue;
            if (e.name.toUpperCase() === nu && (e.ext || '').toUpperCase() === eu) {
                e.index = i;
                return e;
            }
        }
        return null;
    };

    HuBasicFS.prototype.listDirectory = function() {
        var result = [];
        for (var i = 0; i < this._dirEntries.length; i++) {
            var e = this._dirEntries[i];
            if (e.isEnd) break;
            if (e.isDeleted) continue;
            e.index = i;
            result.push(e);
        }
        return result;
    };

    HuBasicFS.prototype.readFile = function(entry) {
        if (entry.isDeleted || entry.isEnd) return null;

        var clusters = [];
        var cluster = entry.startCluster;
        var visited = {};
        var lastFatValue = 0;

        // FAT チェーン追跡
        while (cluster > 0 && cluster < 0x80) {
            if (visited[cluster]) {
                // 循環検出
                this._anomalyDetected = true;
                break;
            }
            visited[cluster] = true;
            clusters.push(cluster);
            if (clusters.length > this._maxClusters) {
                this._anomalyDetected = true;
                break;
            }
            lastFatValue = this._fat[cluster];
            if (lastFatValue >= 0x80) break; // EOF
            cluster = lastFatValue;
        }

        if (clusters.length === 0) {
            // 開始クラスタ自体が EOF マーカの場合
            if (entry.startCluster >= 0x80 && entry.startCluster <= 0x8F) {
                // 0サイズファイル扱い
                return new Uint8Array(0);
            }
            return null;
        }

        // 最終クラスタの使用セクタ数
        var lastUsedSectors = this._clusterSectors;
        if (lastFatValue >= 0x80 && lastFatValue <= 0x8F) {
            lastUsedSectors = (lastFatValue & 0x0F) + 1;
        }

        // データ読み出し
        var result = new Uint8Array(entry.size);
        var pos = 0;
        for (var ci = 0; ci < clusters.length; ci++) {
            var sectorsToRead = (ci === clusters.length - 1) ? lastUsedSectors : this._clusterSectors;
            var baseSector = clusters[ci] * this._clusterSectors + 1;
            for (var s = 0; s < sectorsToRead && pos < entry.size; s++) {
                var sectorData = this._readLogicalSector(baseSector + s);
                if (!sectorData) break;
                var copyLen = Math.min(this._sectorSize, entry.size - pos);
                result.set(sectorData.subarray(0, copyLen), pos);
                pos += copyLen;
            }
        }

        return result;
    };

    HuBasicFS.prototype.deleteFile = function(entry) {
        if (this.readOnly) throw new Error(this.readOnlyReason || '読み取り専用です');
        if (entry.isDeleted || entry.isEnd) throw new Error('無効なエントリです');
        if (entry.isReadonly) throw new Error('読み取り専用ファイルです');

        // FAT チェーンをクリア
        var cluster = entry.startCluster;
        var visited = {};
        while (cluster > 0 && cluster < 0x80) {
            if (visited[cluster] || cluster >= this._maxClusters) break;
            visited[cluster] = true;
            var next = this._fat[cluster];
            this._fat[cluster] = 0x00;
            if (next >= 0x80) {
                // EOF — チェーン終了
                break;
            }
            cluster = next;
        }
        // 開始クラスタがEOFの場合もクリア
        if (entry.startCluster >= 0x80 && entry.startCluster < this._maxClusters) {
            this._fat[entry.startCluster] = 0x00;
        }

        // ディレクトリエントリのモードを削除マークに
        entry.rawEntry[0] = 0x00;
        entry.mode = 0x00;
        entry.isDeleted = true;
        this._updateDirEntryInBuffer(entry);

        // 書き戻し
        this._writeFat();
        this._writeDirectory();
    };

    HuBasicFS.prototype.addFile = function(name, ext, data) {
        if (this.readOnly) throw new Error(this.readOnlyReason || '読み取り専用です');

        // ファイル名バリデーション (ASCII のみ)
        if (!name || name.length === 0 || name.length > 13) {
            throw new Error('ファイル名は1-13文字で指定してください');
        }
        if (ext && ext.length > 3) {
            throw new Error('拡張子は3文字以内で指定してください');
        }

        var fileSize = data.length;
        if (fileSize > 65535) {
            throw new Error('ファイルサイズが大きすぎます (最大 65535 バイト)');
        }

        // 必要クラスタ数
        var bytesPerCluster = this._clusterSectors * this._sectorSize;
        var neededClusters = Math.max(1, Math.ceil(fileSize / bytesPerCluster));

        // 空きクラスタ検索
        var freeClusters = [];
        for (var i = this._reservedClusters; i < this._maxClusters; i++) {
            if (this._fat[i] === 0x00) {
                freeClusters.push(i);
                if (freeClusters.length >= neededClusters) break;
            }
        }
        if (freeClusters.length < neededClusters) {
            throw new Error('空き容量が不足しています (必要: ' + neededClusters +
                           ' クラスタ, 空き: ' + freeClusters.length + ' クラスタ)');
        }

        // 空きディレクトリスロット検索
        var dirSlot = null;
        for (var i = 0; i < this._dirEntries.length; i++) {
            var e = this._dirEntries[i];
            if (e.isDeleted || e.isEnd) {
                dirSlot = i;
                break;
            }
        }
        if (dirSlot === null) {
            throw new Error('ディレクトリが満杯です');
        }

        // 終端マーカの場合、次のスロットに新しい終端を追加
        var existingEntry = this._dirEntries[dirSlot];
        if (existingEntry.isEnd) {
            // 次のスロットが存在するか確認
            var nextSectorIdx = existingEntry.sectorIdx;
            var nextEntryIdx = existingEntry.entryIdx + 1;
            var entriesPerSector = Math.floor(this._sectorSize / 32);
            if (nextEntryIdx >= entriesPerSector) {
                nextEntryIdx = 0;
                nextSectorIdx++;
            }
            if (nextSectorIdx < this._dirRawSectors.length) {
                // 次のスロットに終端マーカを置く
                var nextInfo = this._dirRawSectors[nextSectorIdx];
                nextInfo.data[nextEntryIdx * 32] = 0xFF;
            }
            // ディレクトリエントリリストにも新しい終端を追加
            if (dirSlot + 1 >= this._dirEntries.length) {
                this._dirEntries.push({
                    mode: 0xFF,
                    isEnd: true,
                    sectorIdx: nextSectorIdx,
                    entryIdx: nextEntryIdx
                });
            }
        }

        // FAT チェーン構築
        for (var i = 0; i < freeClusters.length; i++) {
            if (i < freeClusters.length - 1) {
                this._fat[freeClusters[i]] = freeClusters[i + 1];
            } else {
                // 最終クラスタ: EOF マーカ
                var lastSectorIdx = Math.floor((fileSize - 1) / this._sectorSize) % this._clusterSectors;
                if (fileSize === 0) lastSectorIdx = 0;
                this._fat[freeClusters[i]] = 0x80 | lastSectorIdx;
            }
        }

        // データ書き込み
        var pos = 0;
        for (var ci = 0; ci < freeClusters.length; ci++) {
            var baseSector = freeClusters[ci] * this._clusterSectors + 1;
            for (var s = 0; s < this._clusterSectors; s++) {
                var sectorData = new Uint8Array(this._sectorSize);
                if (pos < fileSize) {
                    var copyLen = Math.min(this._sectorSize, fileSize - pos);
                    sectorData.set(data.subarray(pos, pos + copyLen));
                    pos += copyLen;
                }
                this._writeLogicalSector(baseSector + s, sectorData);
            }
        }

        // ディレクトリエントリ構築
        var rawEntry = new Uint8Array(32);
        // モード: HuBASIC ディレクトリエントリの mode byte
        //   0x00 = 削除済み, 0xFF = 終端
        //   bit0 = Binary, bit1 = BASIC
        //   bit0,1 共に 0 = ASCII だが mode=0x00 は削除マークと衝突
        //   → ASCII は bit5 (0x20) を立てて 0x20 とする (mode!=0 かつ bit0,1=0)
        var fileExt = (ext || '').toUpperCase();
        if (fileExt === 'BAS') {
            rawEntry[0] = 0x02; // BASIC
        } else if (fileExt === 'TXT' || fileExt === 'ASC') {
            rawEntry[0] = 0x20; // ASCII (bit5 を立てて削除マーク 0x00 と区別)
        } else {
            rawEntry[0] = 0x01; // Binary
        }

        // ファイル名 (13 bytes, space-padded)
        var nameUpper = name.toUpperCase();
        for (var i = 0; i < 13; i++) {
            rawEntry[1 + i] = (i < nameUpper.length) ? nameUpper.charCodeAt(i) : 0x20;
        }

        // 拡張子 (3 bytes, space-padded)
        var extUpper = (ext || '').toUpperCase();
        for (var i = 0; i < 3; i++) {
            rawEntry[14 + i] = (i < extUpper.length) ? extUpper.charCodeAt(i) : 0x20;
        }

        // パスワード
        rawEntry[0x11] = 0x20;

        // サイズ (LE)
        rawEntry[0x12] = fileSize & 0xFF;
        rawEntry[0x13] = (fileSize >> 8) & 0xFF;

        // ロードアドレス、実行アドレス (0 for now)
        rawEntry[0x14] = 0; rawEntry[0x15] = 0;
        rawEntry[0x16] = 0; rawEntry[0x17] = 0;

        // 日付 (6 bytes BCD)
        var dateBytes = makeHuBasicDate();
        rawEntry.set(dateBytes, 0x18);

        // 開始クラスタ (HIGH, LOW, MIDDLE)
        var startCl = freeClusters[0];
        rawEntry[0x1D] = 0; // HIGH
        rawEntry[0x1E] = startCl & 0x7F; // LOW
        rawEntry[0x1F] = (startCl >> 7) & 0xFF; // MIDDLE

        // ディレクトリエントリ更新
        var newEntry = this._parseDirEntry(rawEntry, existingEntry.sectorIdx, existingEntry.entryIdx);
        this._dirEntries[dirSlot] = newEntry;
        this._updateDirEntryInBuffer(newEntry);

        // 書き戻し
        this._writeFat();
        this._writeDirectory();
    };

    HuBasicFS.prototype.getFreeSpace = function() {
        var free = 0;
        for (var i = this._reservedClusters; i < this._maxClusters; i++) {
            if (this._fat[i] === 0x00) free++;
        }
        return free * this._clusterSectors * this._sectorSize;
    };

    HuBasicFS.prototype.getFreeClusters = function() {
        var free = 0;
        for (var i = this._reservedClusters; i < this._maxClusters; i++) {
            if (this._fat[i] === 0x00) free++;
        }
        return free;
    };

    HuBasicFS.prototype.getInfo = function() {
        return {
            fsType: this.fsType,
            format: this._formatName,
            freeClusters: this.getFreeClusters(),
            totalClusters: this._maxClusters - this._reservedClusters,
            freeBytes: this.getFreeSpace(),
            clusterSize: this._clusterSectors * this._sectorSize,
            readOnly: this.readOnly,
            readOnlyReason: this.readOnlyReason,
            anomaly: this._anomalyDetected
        };
    };

    // ================================================================
    // LsxDodgersFS - LSX-Dodgers FAT ファイルシステム
    // ================================================================

    // inferredBPB: BPB のないディスク用に推定パラメータを渡す (省略時はブートセクタから読む)
    function LsxDodgersFS(container, inferredBPB) {
        this._container = container;
        this.fsType = 'LSX-Dodgers';
        this.readOnly = false;
        this.readOnlyReason = '';
        this._anomalyDetected = false;
        this._inferredBPB = inferredBPB || null;

        var geom = container.getGeometry();
        this._sectorSize = geom.sectorSize || 256;
        this._fdType = geom.fdType;
        this._formatName = (this._fdType === 0x20) ? '2HD' :
                           (this._fdType === 0x10) ? '2DD' : '2D';

        // 論理→物理変換パラメータ (デフォルト値; _parseBPB で BPB の値に上書きされる)
        this._sectorsPerTrack = 16;
        this._heads = 2;

        // ライトプロテクトチェック
        if (container.protect) {
            this.readOnly = true;
            this.readOnlyReason = 'ライトプロテクトされています';
        }

        // BPB 解析
        try {
            this._parseBPB();
            this._readFat();
            this._readRootDirectory();
        } catch(e) {
            this._anomalyDetected = true;
            this.readOnly = true;
            this.readOnlyReason = 'ファイルシステムに異常があるため読み取り専用です';
            if (!this._dirEntries) this._dirEntries = [];
        }
    }

    // 論理セクタ(0-based for FAT) → 物理 C, H, R
    LsxDodgersFS.prototype._logicalToPhysical = function(logSector) {
        // FAT の論理セクタは 0-based
        var sectorsPerCyl = this._sectorsPerTrack * this._heads;
        var c = Math.floor(logSector / sectorsPerCyl);
        var rem = logSector % sectorsPerCyl;
        var h = Math.floor(rem / this._sectorsPerTrack);
        var r = (rem % this._sectorsPerTrack) + 1;
        return { c: c, h: h, r: r };
    };

    LsxDodgersFS.prototype._readLogicalSector = function(logSector) {
        // LBA 対応コンテナ (HDD/EMM) は CHS 変換をスキップ
        // LSX-Dodgers 論理セクタは 0-based = LBA と一致
        if (this._container.readSectorLBA) {
            return this._container.readSectorLBA(logSector);
        }
        var p = this._logicalToPhysical(logSector);
        return this._container.readSector(p.c, p.h, p.r);
    };

    LsxDodgersFS.prototype._writeLogicalSector = function(logSector, data) {
        if (this._container.writeSectorLBA) {
            this._container.writeSectorLBA(logSector, data);
            return;
        }
        var p = this._logicalToPhysical(logSector);
        this._container.writeSector(p.c, p.h, p.r, data);
    };

    LsxDodgersFS.prototype._parseBPB = function() {
        var bpbSPT, bpbHeads;

        if (this._inferredBPB) {
            // BPB レスディスク: 推定パラメータを使用
            var ib = this._inferredBPB;
            this._bytesPerSector = ib.bytesPerSector;
            this._sectorsPerCluster = ib.sectorsPerCluster;
            this._reservedSectors = ib.reservedSectors;
            this._numberOfFATs = ib.numberOfFATs;
            this._rootEntries = ib.rootEntries;
            this._totalSectors = ib.totalSectors;
            this._mediaDescriptor = ib.mediaDescriptor;
            this._sectorsPerFAT = ib.sectorsPerFAT;
            bpbSPT = ib.sectorsPerTrack;
            bpbHeads = ib.heads;
        } else {
            // 通常: ブートセクタから BPB を読み取り
            var boot = this._readLogicalSector(0);
            if (!boot) throw new Error('Boot sector read failed');

            this._bytesPerSector = boot[0x0B] | (boot[0x0C] << 8);
            this._sectorsPerCluster = boot[0x0D];
            this._reservedSectors = boot[0x0E] | (boot[0x0F] << 8);
            this._numberOfFATs = boot[0x10];
            this._rootEntries = boot[0x11] | (boot[0x12] << 8);
            this._totalSectors = boot[0x13] | (boot[0x14] << 8);
            // FAT16/32: 16-bit が 0 なら 32-bit totalSectors (offset 0x20) を使用
            if (this._totalSectors === 0 && boot.length >= 0x24) {
                this._totalSectors = ((boot[0x20] | (boot[0x21] << 8) |
                    (boot[0x22] << 16) | (boot[0x23] << 24)) >>> 0);
            }
            this._mediaDescriptor = boot[0x15];
            this._sectorsPerFAT = boot[0x16] | (boot[0x17] << 8);
            bpbSPT = boot[0x18] | (boot[0x19] << 8);
            bpbHeads = boot[0x1A] | (boot[0x1B] << 8);
        }

        // バリデーション
        if (this._bytesPerSector !== 256 && this._bytesPerSector !== 512) throw new Error('Unsupported sector size: ' + this._bytesPerSector);
        // BPB セクタサイズとコンテナの物理セクタサイズの整合チェック (HDD/EMM のみ)
        // D88/FDD はセクタサイズ混在がありうる (例: R=1 が 256B, R=2 以降が 512B)
        var containerGeom = this._container.getGeometry();
        if (containerGeom.isHdd || containerGeom.isEmm) {
            var physSectorSize = containerGeom.sectorSize || 256;
            if (this._bytesPerSector !== physSectorSize) {
                throw new Error('BPB sector size (' + this._bytesPerSector + ') does not match container (' + physSectorSize + ')');
            }
        }
        if (this._sectorsPerCluster === 0) throw new Error('Invalid sectors per cluster');
        if (this._numberOfFATs < 1 || this._numberOfFATs > 2) throw new Error('Invalid FAT count');
        if (this._rootEntries === 0) throw new Error('Invalid root entry count');
        if (this._sectorsPerFAT === 0) throw new Error('Invalid FAT size');
        // LBA デバイス (HDD/EMM) は CHS ジオメトリ不要 (SPT=0, heads=0 が正常)
        if (!(containerGeom.isHdd || containerGeom.isEmm)) {
            if (bpbSPT === 0 || bpbHeads === 0) throw new Error('Invalid BPB geometry');
        }

        // 論理→物理変換パラメータを BPB の値で上書き
        this._sectorsPerTrack = bpbSPT;
        this._heads = bpbHeads;

        // フォーマット名を BPB ジオメトリから推定
        if (containerGeom.isHdd) {
            this._formatName = 'HDD';
        } else if (containerGeom.isEmm) {
            this._formatName = 'EMM';
        } else if (this._bytesPerSector === 512) {
            this._formatName = '2DD';
        } else if (this._sectorsPerTrack === 26) {
            this._formatName = '2HD';
        } else {
            this._formatName = '2D';
        }

        // 派生パラメータ
        this._fatStartSector = this._reservedSectors;
        this._rootDirStartSector = this._fatStartSector + this._numberOfFATs * this._sectorsPerFAT;
        this._rootDirSectors = Math.ceil((this._rootEntries * 32) / this._bytesPerSector);
        this._dataStartSector = this._rootDirStartSector + this._rootDirSectors;
        this._dataSectors = this._totalSectors - this._dataStartSector;
        this._totalClusters = Math.floor(this._dataSectors / this._sectorsPerCluster) + 2; // +2 for cluster numbering starting at 2

        // FAT12 / FAT16 判定
        this._isFAT16 = (this._totalClusters - 2) >= 4085;
        this._clusterSize = this._sectorsPerCluster * this._bytesPerSector;
    };

    LsxDodgersFS.prototype._readFat = function() {
        var fatBytes = this._sectorsPerFAT * this._bytesPerSector;
        this._fatData = new Uint8Array(fatBytes);
        for (var s = 0; s < this._sectorsPerFAT; s++) {
            var data = this._readLogicalSector(this._fatStartSector + s);
            if (!data) throw new Error('FAT sector read failed');
            this._fatData.set(data, s * this._bytesPerSector);
        }
    };

    // FAT エントリ読み取り
    LsxDodgersFS.prototype._getFatEntry = function(cluster) {
        if (this._isFAT16) {
            var off = cluster * 2;
            return this._fatData[off] | (this._fatData[off + 1] << 8);
        } else {
            // FAT12
            var off = Math.floor(cluster * 3 / 2);
            if (cluster & 1) {
                return ((this._fatData[off] >> 4) | (this._fatData[off + 1] << 4)) & 0xFFF;
            } else {
                return (this._fatData[off] | ((this._fatData[off + 1] & 0x0F) << 8)) & 0xFFF;
            }
        }
    };

    // FAT エントリ書き込み
    LsxDodgersFS.prototype._setFatEntry = function(cluster, value) {
        if (this._isFAT16) {
            var off = cluster * 2;
            this._fatData[off] = value & 0xFF;
            this._fatData[off + 1] = (value >> 8) & 0xFF;
        } else {
            // FAT12
            var off = Math.floor(cluster * 3 / 2);
            if (cluster & 1) {
                this._fatData[off] = (this._fatData[off] & 0x0F) | ((value & 0x0F) << 4);
                this._fatData[off + 1] = (value >> 4) & 0xFF;
            } else {
                this._fatData[off] = value & 0xFF;
                this._fatData[off + 1] = (this._fatData[off + 1] & 0xF0) | ((value >> 8) & 0x0F);
            }
        }
    };

    // EOF 判定
    LsxDodgersFS.prototype._isEofCluster = function(value) {
        if (this._isFAT16) return value >= 0xFFF8;
        return value >= 0xFF8;
    };

    // FAT 全コピー書き戻し
    LsxDodgersFS.prototype._writeFatAll = function() {
        for (var f = 0; f < this._numberOfFATs; f++) {
            var fatStart = this._fatStartSector + f * this._sectorsPerFAT;
            for (var s = 0; s < this._sectorsPerFAT; s++) {
                var off = s * this._bytesPerSector;
                var sectorData = this._fatData.slice(off, off + this._bytesPerSector);
                this._writeLogicalSector(fatStart + s, sectorData);
            }
        }
    };

    // ルートディレクトリ読み込み
    LsxDodgersFS.prototype._readRootDirectory = function() {
        this._dirEntries = [];
        this._dirRawSectors = [];

        for (var s = 0; s < this._rootDirSectors; s++) {
            var logSec = this._rootDirStartSector + s;
            var data = this._readLogicalSector(logSec);
            if (!data) {
                this._anomalyDetected = true;
                break;
            }
            this._dirRawSectors.push({ sector: logSec, data: new Uint8Array(data) });

            var entriesPerSector = Math.floor(this._bytesPerSector / 32);
            for (var e = 0; e < entriesPerSector; e++) {
                var off = e * 32;
                var firstByte = data[off];

                if (firstByte === 0x00) {
                    // エントリ終了
                    this._dirEntries.push({
                        mode: 0x00,
                        isEnd: true,
                        sectorIdx: s,
                        entryIdx: e
                    });
                    return;
                }

                // VFAT LFN エントリ (attr=0x0F) とボリュームラベル (attr=0x08) はスキップ
                var attr = data[off + 0x0B];
                if (attr === 0x0F || attr === 0x08) continue;

                var rawEntry = data.slice(off, off + 32);
                var entry = this._parseDosEntry(rawEntry, s, e);
                this._dirEntries.push(entry);
            }
        }
    };

    // DOS ディレクトリエントリのパース
    LsxDodgersFS.prototype._parseDosEntry = function(raw, sectorIdx, entryIdx) {
        var firstByte = raw[0];
        var isDeleted = (firstByte === 0xE5);
        var attr = raw[0x0B];

        // 8.3 ファイル名
        var name = '';
        for (var i = 0; i < 8; i++) {
            var ch = raw[i];
            if (ch === 0x20) break;
            if (firstByte === 0xE5 && i === 0) ch = 0xE5; // 復元用
            name += String.fromCharCode(ch);
        }
        var ext = '';
        for (var i = 0; i < 3; i++) {
            var ch = raw[8 + i];
            if (ch === 0x20) break;
            ext += String.fromCharCode(ch);
        }

        // タイムスタンプ (DOS packed format)
        var time = raw[0x16] | (raw[0x17] << 8);
        var date = raw[0x18] | (raw[0x19] << 8);
        var dateStr = '';
        if (date > 0) {
            var year = ((date >> 9) & 0x7F) + 80;
            var month = (date >> 5) & 0x0F;
            var day = date & 0x1F;
            var hour = (time >> 11) & 0x1F;
            var min = (time >> 5) & 0x3F;
            dateStr = (year % 100).toString().padStart(2, '0') + '/' +
                     month.toString().padStart(2, '0') + '/' +
                     day.toString().padStart(2, '0') + ' ' +
                     hour.toString().padStart(2, '0') + ':' +
                     min.toString().padStart(2, '0');
        }

        var startCluster = raw[0x1A] | (raw[0x1B] << 8);
        var fileSize = raw[0x1C] | (raw[0x1D] << 8) | (raw[0x1E] << 16) | (raw[0x1F] << 24);

        var modeStr = '';
        if (attr & 0x01) modeStr += 'R';
        if (attr & 0x02) modeStr += 'H';
        if (attr & 0x04) modeStr += 'S';
        if (attr & 0x10) modeStr += 'D';
        if (attr & 0x20) modeStr += 'A';

        return {
            mode: isDeleted ? 0x00 : attr,
            isEnd: false,
            isDeleted: isDeleted,
            isDirectory: !!(attr & 0x10),
            isReadonly: !!(attr & 0x01),
            isHidden: !!(attr & 0x02),
            isSystem: !!(attr & 0x04),
            isBASIC: false,
            isBinary: true,
            name: name,
            ext: ext,
            fullName: ext ? (name + '.' + ext) : name,
            password: 0,
            size: fileSize,
            loadAddr: 0,
            execAddr: 0,
            date: dateStr,
            startCluster: startCluster,
            modeStr: modeStr,
            rawEntry: new Uint8Array(raw),
            sectorIdx: sectorIdx,
            entryIdx: entryIdx
        };
    };

    LsxDodgersFS.prototype._updateDirEntryInBuffer = function(entry, rawSectors) {
        var sectors = rawSectors || this._dirRawSectors;
        var info = sectors[entry.sectorIdx];
        if (!info) return;
        var off = entry.entryIdx * 32;
        info.data.set(entry.rawEntry, off);
    };

    LsxDodgersFS.prototype._writeDirectorySectors = function(rawSectors) {
        var sectors = rawSectors || this._dirRawSectors;
        for (var i = 0; i < sectors.length; i++) {
            var info = sectors[i];
            this._writeLogicalSector(info.sector, info.data);
        }
    };

    LsxDodgersFS.prototype._writeDirectory = function() {
        this._writeDirectorySectors(this._dirRawSectors);
    };

    // クラスタ→論理セクタ変換
    LsxDodgersFS.prototype._clusterToSector = function(cluster) {
        return this._dataStartSector + (cluster - 2) * this._sectorsPerCluster;
    };

    // ================================================================
    // LsxDodgersFS 公開 API
    // ================================================================

    LsxDodgersFS.prototype.renameFile = function(entry, newName, newExt) {
        if (this.readOnly) throw new Error(this.readOnlyReason || '読み取り専用です');
        if (entry.isDeleted || entry.isEnd) throw new Error('無効なエントリです');
        if (!newName || newName.length > 8) throw new Error('ファイル名は1-8文字で指定してください');
        if (newExt && newExt.length > 3) throw new Error('拡張子は3文字以内で指定してください');

        var raw = entry.rawEntry;
        var nameUpper = newName.toUpperCase();
        for (var i = 0; i < 8; i++) {
            raw[i] = (i < nameUpper.length) ? nameUpper.charCodeAt(i) : 0x20;
        }
        var extUpper = (newExt || '').toUpperCase();
        for (var i = 0; i < 3; i++) {
            raw[8 + i] = (i < extUpper.length) ? extUpper.charCodeAt(i) : 0x20;
        }
        entry.name = nameUpper;
        entry.ext = extUpper;
        entry.fullName = extUpper ? (nameUpper + '.' + extUpper) : nameUpper;

        if (entry.dirCluster && entry.dirCluster > 0) {
            var ctx = this._getSubDirContext(entry.dirCluster);
            this._updateDirEntryInBuffer(entry, ctx.rawSectors);
            this._writeDirectorySectors(ctx.rawSectors);
        } else {
            this._updateDirEntryInBuffer(entry);
            this._writeDirectory();
        }
    };

    LsxDodgersFS.prototype.findByName = function(name, ext, dirCluster) {
        var entries = this.listDirectory(dirCluster);
        var nu = name.toUpperCase(), eu = (ext || '').toUpperCase();
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            if (e.name.toUpperCase() === nu && (e.ext || '').toUpperCase() === eu) {
                return e;
            }
        }
        return null;
    };

    LsxDodgersFS.prototype.listDirectory = function(startCluster) {
        var entries;
        if (startCluster === undefined || startCluster === 0) {
            // ルートディレクトリ
            entries = this._dirEntries;
        } else {
            // サブディレクトリ: クラスタチェーンからエントリを読む
            entries = this._readSubDirectory(startCluster);
        }
        if (!entries) return [];

        var result = [];
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            if (e.isEnd) break;
            if (e.isDeleted) continue;
            if (e.name === '.' || e.name === '..') continue;
            // Hidden+System は OS 内部エントリ (System Volume Information 等)
            if (e.isHidden && e.isSystem) continue;
            e.index = i;
            e.dirCluster = startCluster || 0;
            result.push(e);
        }
        return result;
    };

    // サブディレクトリのエントリ読み込み (クラスタチェーン)
    // rawSectorsOut: 省略可。渡すとセクタ情報を蓄積 (書き戻し用)
    LsxDodgersFS.prototype._readSubDirectory = function(startCluster, rawSectorsOut) {
        var entries = [];
        var cluster = startCluster;
        var visited = {};
        var sectorIdx = 0;

        while (cluster >= 2 && !this._isEofCluster(cluster)) {
            if (visited[cluster]) break;
            visited[cluster] = true;

            var baseSector = this._clusterToSector(cluster);
            for (var s = 0; s < this._sectorsPerCluster; s++) {
                var logSec = baseSector + s;
                var data = this._readLogicalSector(logSec);
                if (!data) return entries;

                if (rawSectorsOut) {
                    rawSectorsOut.push({ sector: logSec, data: new Uint8Array(data) });
                }

                var entriesPerSector = Math.floor(this._bytesPerSector / 32);
                for (var e = 0; e < entriesPerSector; e++) {
                    var off = e * 32;
                    if (data[off] === 0x00) {
                        entries.push({ mode: 0x00, isEnd: true, sectorIdx: sectorIdx, entryIdx: e });
                        return entries;
                    }
                    // VFAT LFN エントリ (attr=0x0F) とボリュームラベル (attr=0x08) はスキップ
                    var attr = data[off + 0x0B];
                    if (attr === 0x0F || attr === 0x08) continue;

                    var rawEntry = data.slice(off, off + 32);
                    entries.push(this._parseDosEntry(rawEntry, sectorIdx, e));
                }
                sectorIdx++;
            }
            cluster = this._getFatEntry(cluster);
        }
        return entries;
    };

    // サブディレクトリのエントリ + セクタ情報を取得 (書き戻し対応)
    LsxDodgersFS.prototype._getSubDirContext = function(startCluster) {
        var rawSectors = [];
        var entries = this._readSubDirectory(startCluster, rawSectors);
        return { entries: entries, rawSectors: rawSectors, startCluster: startCluster };
    };

    LsxDodgersFS.prototype.readFile = function(entry) {
        if (entry.isDeleted || entry.isEnd || entry.isDirectory) return null;

        var result = new Uint8Array(entry.size);
        var pos = 0;
        var cluster = entry.startCluster;
        var visited = {};

        while (cluster >= 2 && !this._isEofCluster(cluster)) {
            if (visited[cluster]) { this._anomalyDetected = true; break; }
            visited[cluster] = true;

            var baseSector = this._clusterToSector(cluster);
            for (var s = 0; s < this._sectorsPerCluster && pos < entry.size; s++) {
                var data = this._readLogicalSector(baseSector + s);
                if (!data) break;
                var copyLen = Math.min(this._bytesPerSector, entry.size - pos);
                result.set(data.subarray(0, copyLen), pos);
                pos += copyLen;
            }
            cluster = this._getFatEntry(cluster);
        }
        return result;
    };

    LsxDodgersFS.prototype.deleteFile = function(entry) {
        if (this.readOnly) throw new Error(this.readOnlyReason || '読み取り専用です');
        if (entry.isDeleted || entry.isEnd) throw new Error('無効なエントリです');

        // FAT チェーンをクリア
        var cluster = entry.startCluster;
        var visited = {};
        while (cluster >= 2 && !this._isEofCluster(cluster)) {
            if (visited[cluster]) break;
            visited[cluster] = true;
            var next = this._getFatEntry(cluster);
            this._setFatEntry(cluster, 0x000);
            cluster = next;
        }

        // ディレクトリエントリの先頭バイトを 0xE5 (削除マーク) に
        entry.rawEntry[0] = 0xE5;
        entry.isDeleted = true;

        if (entry.dirCluster && entry.dirCluster > 0) {
            var ctx = this._getSubDirContext(entry.dirCluster);
            this._updateDirEntryInBuffer(entry, ctx.rawSectors);
            this._writeFatAll();
            this._writeDirectorySectors(ctx.rawSectors);
        } else {
            this._updateDirEntryInBuffer(entry);
            this._writeFatAll();
            this._writeDirectory();
        }
    };

    LsxDodgersFS.prototype.addFile = function(name, ext, data, dirCluster) {
        if (this.readOnly) throw new Error(this.readOnlyReason || '読み取り専用です');

        if (!name || name.length > 8) throw new Error('ファイル名は1-8文字で指定してください');
        if (ext && ext.length > 3) throw new Error('拡張子は3文字以内で指定してください');

        var isSubDir = (dirCluster !== undefined && dirCluster > 0);
        var dirEntries, dirRawSectors;
        if (isSubDir) {
            var ctx = this._getSubDirContext(dirCluster);
            dirEntries = ctx.entries;
            dirRawSectors = ctx.rawSectors;
        } else {
            dirEntries = this._dirEntries;
            dirRawSectors = this._dirRawSectors;
        }

        var fileSize = data.length;
        var neededClusters = Math.max(1, Math.ceil(fileSize / this._clusterSize));

        // 空きクラスタ検索
        var freeClusters = [];
        for (var i = 2; i < this._totalClusters; i++) {
            if (this._getFatEntry(i) === 0x000) {
                freeClusters.push(i);
                if (freeClusters.length >= neededClusters) break;
            }
        }
        if (freeClusters.length < neededClusters) {
            throw new Error('空き容量が不足しています');
        }

        // 空きディレクトリスロット検索
        var dirSlot = null;
        for (var i = 0; i < dirEntries.length; i++) {
            var e = dirEntries[i];
            if (e.isDeleted || e.isEnd) { dirSlot = i; break; }
        }

        // サブディレクトリで空きスロットがない場合、クラスタを拡張
        if (dirSlot === null && isSubDir) {
            dirSlot = this._extendSubDirectory(dirCluster, dirEntries, dirRawSectors);
        }
        if (dirSlot === null) throw new Error('ディレクトリが満杯です');

        var existingEntry = dirEntries[dirSlot];
        if (existingEntry.isEnd) {
            // 次スロットに終端マーカ
            var nextSectorIdx = existingEntry.sectorIdx;
            var nextEntryIdx = existingEntry.entryIdx + 1;
            var entriesPerSector = Math.floor(this._bytesPerSector / 32);
            if (nextEntryIdx >= entriesPerSector) {
                nextEntryIdx = 0;
                nextSectorIdx++;
            }
            if (nextSectorIdx < dirRawSectors.length) {
                dirRawSectors[nextSectorIdx].data[nextEntryIdx * 32] = 0x00;
            } else if (isSubDir) {
                // 次セクタが存在しない→クラスタ拡張が必要
                dirSlot = this._extendSubDirectory(dirCluster, dirEntries, dirRawSectors);
                if (dirSlot === null) throw new Error('ディレクトリが満杯です');
                existingEntry = dirEntries[dirSlot];
            }
            if (dirSlot + 1 >= dirEntries.length) {
                dirEntries.push({
                    mode: 0x00, isEnd: true,
                    sectorIdx: nextSectorIdx, entryIdx: nextEntryIdx
                });
            }
        }

        // FAT チェーン構築
        var eofMark = this._isFAT16 ? 0xFFFF : 0xFFF;
        for (var i = 0; i < freeClusters.length; i++) {
            if (i < freeClusters.length - 1) {
                this._setFatEntry(freeClusters[i], freeClusters[i + 1]);
            } else {
                this._setFatEntry(freeClusters[i], eofMark);
            }
        }

        // データ書き込み
        var pos = 0;
        for (var ci = 0; ci < freeClusters.length; ci++) {
            var baseSector = this._clusterToSector(freeClusters[ci]);
            for (var s = 0; s < this._sectorsPerCluster; s++) {
                var sectorData = new Uint8Array(this._bytesPerSector);
                if (pos < fileSize) {
                    var copyLen = Math.min(this._bytesPerSector, fileSize - pos);
                    sectorData.set(data.subarray(pos, pos + copyLen));
                    pos += copyLen;
                }
                this._writeLogicalSector(baseSector + s, sectorData);
            }
        }

        // DOS ディレクトリエントリ構築
        var rawEntry = new Uint8Array(32);
        var nameUpper = name.toUpperCase();
        for (var i = 0; i < 8; i++) {
            rawEntry[i] = (i < nameUpper.length) ? nameUpper.charCodeAt(i) : 0x20;
        }
        var extUpper = (ext || '').toUpperCase();
        for (var i = 0; i < 3; i++) {
            rawEntry[8 + i] = (i < extUpper.length) ? extUpper.charCodeAt(i) : 0x20;
        }
        rawEntry[0x0B] = 0x20; // Archive attribute

        // タイムスタンプ (DOS packed)
        var now = new Date();
        var dosTime = ((now.getHours() & 0x1F) << 11) | ((now.getMinutes() & 0x3F) << 5) | ((now.getSeconds() >> 1) & 0x1F);
        var dosDate = (((now.getFullYear() - 1980) & 0x7F) << 9) | (((now.getMonth() + 1) & 0x0F) << 5) | (now.getDate() & 0x1F);
        rawEntry[0x16] = dosTime & 0xFF;
        rawEntry[0x17] = (dosTime >> 8) & 0xFF;
        rawEntry[0x18] = dosDate & 0xFF;
        rawEntry[0x19] = (dosDate >> 8) & 0xFF;

        // 開始クラスタ
        rawEntry[0x1A] = freeClusters[0] & 0xFF;
        rawEntry[0x1B] = (freeClusters[0] >> 8) & 0xFF;

        // ファイルサイズ (32-bit LE)
        rawEntry[0x1C] = fileSize & 0xFF;
        rawEntry[0x1D] = (fileSize >> 8) & 0xFF;
        rawEntry[0x1E] = (fileSize >> 16) & 0xFF;
        rawEntry[0x1F] = (fileSize >> 24) & 0xFF;

        var newEntry = this._parseDosEntry(rawEntry, existingEntry.sectorIdx, existingEntry.entryIdx);
        if (isSubDir) {
            dirEntries[dirSlot] = newEntry;
            this._updateDirEntryInBuffer(newEntry, dirRawSectors);
            this._writeFatAll();
            this._writeDirectorySectors(dirRawSectors);
        } else {
            this._dirEntries[dirSlot] = newEntry;
            this._updateDirEntryInBuffer(newEntry);
            this._writeFatAll();
            this._writeDirectory();
        }
    };

    // サブディレクトリのクラスタ拡張: 新クラスタを割り当ててゼロ初期化
    LsxDodgersFS.prototype._extendSubDirectory = function(dirCluster, dirEntries, dirRawSectors) {
        // 空きクラスタを1つ確保
        var newCluster = -1;
        for (var i = 2; i < this._totalClusters; i++) {
            if (this._getFatEntry(i) === 0x000) { newCluster = i; break; }
        }
        if (newCluster < 0) return null;

        // 既存チェーンの末尾を探してつなげる
        var cluster = dirCluster;
        var visited = {};
        while (true) {
            if (visited[cluster]) return null;
            visited[cluster] = true;
            var next = this._getFatEntry(cluster);
            if (this._isEofCluster(next) || next < 2) {
                this._setFatEntry(cluster, newCluster);
                break;
            }
            cluster = next;
        }
        var eofMark = this._isFAT16 ? 0xFFFF : 0xFFF;
        this._setFatEntry(newCluster, eofMark);

        // 新クラスタをゼロクリアしてセクタ情報を追加
        var baseSector = this._clusterToSector(newCluster);
        var sectorIdx = dirRawSectors.length;
        var entriesPerSector = Math.floor(this._bytesPerSector / 32);
        for (var s = 0; s < this._sectorsPerCluster; s++) {
            var logSec = baseSector + s;
            var zeroData = new Uint8Array(this._bytesPerSector);
            this._writeLogicalSector(logSec, zeroData);
            dirRawSectors.push({ sector: logSec, data: new Uint8Array(zeroData) });
        }

        // 新クラスタの先頭エントリを終端として返す
        var slot = dirEntries.length;
        dirEntries.push({
            mode: 0x00, isEnd: true,
            sectorIdx: sectorIdx, entryIdx: 0
        });
        return slot;
    };

    LsxDodgersFS.prototype.getFreeSpace = function() {
        var free = 0;
        for (var i = 2; i < this._totalClusters; i++) {
            if (this._getFatEntry(i) === 0x000) free++;
        }
        return free * this._clusterSize;
    };

    LsxDodgersFS.prototype.getFreeClusters = function() {
        var free = 0;
        for (var i = 2; i < this._totalClusters; i++) {
            if (this._getFatEntry(i) === 0x000) free++;
        }
        return free;
    };

    LsxDodgersFS.prototype.getInfo = function() {
        return {
            fsType: this.fsType,
            format: this._formatName,
            freeClusters: this.getFreeClusters(),
            totalClusters: this._totalClusters - 2,
            freeBytes: this.getFreeSpace(),
            clusterSize: this._clusterSize,
            readOnly: this.readOnly,
            readOnlyReason: this.readOnlyReason,
            anomaly: this._anomalyDetected,
            fatType: this._isFAT16 ? 'FAT16' : 'FAT12'
        };
    };

    // ================================================================
    // ファイルシステム自動認識
    // ================================================================

    function detectFilesystem(container) {
        var geom = container.getGeometry();

        if (geom.isHdd || geom.isEmm) {
            // HDD/EMM: BPB 付き FAT が主流 → LSX-Dodgers 優先
            var fatFs = tryLsxDodgers(container, geom);
            if (fatFs) return fatFs;
            var huFs = tryHuBasic(container, geom);
            if (huFs) return huFs;
        } else {
            // FDD: 従来通り HuBASIC 優先
            var huFs = tryHuBasic(container, geom);
            if (huFs) return huFs;
            var fatFs = tryLsxDodgers(container, geom);
            if (fatFs) return fatFs;
        }

        return null;
    }

    // 論理セクタ(1-based) → 物理 CHS (HuBASIC 検出用ヘルパー)
    function huLogToCHS(logSector, sectorsPerTrack) {
        var idx = logSector - 1;
        var sectorsPerCyl = sectorsPerTrack * 2;
        var c = Math.floor(idx / sectorsPerCyl);
        var rem = idx % sectorsPerCyl;
        var h = Math.floor(rem / sectorsPerTrack);
        var r = (rem % sectorsPerTrack) + 1;
        return { c: c, h: h, r: r };
    }

    // FAT セクタの署名チェック
    function checkHuBasicFatSignature(fatData, is2hdLayout) {
        if (!fatData || fatData.length < 2) return false;
        if (fatData[0] !== 0x01) return false;
        if (fatData[1] < 0x80 || fatData[1] > 0x8F) return false;
        if (is2hdLayout) {
            // 標準 2HD: 3バイト目もチェック (FAT が 2 セクタ)
            if (fatData.length < 3) return false;
            if (fatData[2] < 0x80 || fatData[2] > 0x8F) return false;
        }
        return true;
    }

    function tryHuBasic(container, geom) {
        try {
            var useLBA = !!geom.isHdd || !!geom.isEmm;

            if (useLBA) {
                // HDD/EMM: LBA で直接読む。2D レイアウト (LS15) を先に試す
                var fat15 = container.readSectorLBA(14); // LS15 = LBA 14
                if (checkHuBasicFatSignature(fat15, false)) {
                    return new HuBasicFS(container, '2d');
                }
                // 2HD レイアウト (LS29)
                var fat29 = container.readSectorLBA(28); // LS29 = LBA 28
                if (checkHuBasicFatSignature(fat29, true)) {
                    return new HuBasicFS(container, '2hd');
                }
                return null;
            }

            var spt = (geom.fdType === 0x20) ? 26 : 16;

            if (geom.fdType === 0x20) {
                // 2HD: まず標準 2HD レイアウト (FAT=LS29) を試す
                var p29 = huLogToCHS(29, spt);
                var fat29 = container.readSector(p29.c, p29.h, p29.r);
                if (checkHuBasicFatSignature(fat29, true)) {
                    return new HuBasicFS(container);
                }

                // フォールバック: 2D レイアウト on 2HD (S-OS 等; FAT=LS15)
                var p15 = huLogToCHS(15, spt);
                var fat15 = container.readSector(p15.c, p15.h, p15.r);
                if (checkHuBasicFatSignature(fat15, false)) {
                    return new HuBasicFS(container, '2d');
                }

                return null;
            }

            // 2D / 2DD: FAT=LS15
            var p = huLogToCHS(15, spt);
            var fatData = container.readSector(p.c, p.h, p.r);
            if (!checkHuBasicFatSignature(fatData, false)) return null;

            return new HuBasicFS(container);
        } catch(e) {
            return null;
        }
    }

    // メディア記述子 → 標準 BPB パラメータ (BPB レスディスク用)
    // X1 の IPL ブート互換ディスクは BPB を持たないことがある
    var MEDIA_BPB_TABLE = {
        0xFC: { bytesPerSector: 512, sectorsPerCluster: 1, reservedSectors: 1,
                numberOfFATs: 2, rootEntries: 64,  totalSectors: 360,
                sectorsPerFAT: 2, sectorsPerTrack: 9, heads: 1 },
        0xFD: { bytesPerSector: 512, sectorsPerCluster: 2, reservedSectors: 1,
                numberOfFATs: 2, rootEntries: 112, totalSectors: 720,
                sectorsPerFAT: 2, sectorsPerTrack: 9, heads: 2 },
        0xFE: { bytesPerSector: 512, sectorsPerCluster: 1, reservedSectors: 1,
                numberOfFATs: 2, rootEntries: 64,  totalSectors: 320,
                sectorsPerFAT: 1, sectorsPerTrack: 8, heads: 1 },
        0xFF: { bytesPerSector: 512, sectorsPerCluster: 2, reservedSectors: 1,
                numberOfFATs: 2, rootEntries: 112, totalSectors: 640,
                sectorsPerFAT: 1, sectorsPerTrack: 8, heads: 2 },
        0xF9: { bytesPerSector: 512, sectorsPerCluster: 2, reservedSectors: 1,
                numberOfFATs: 2, rootEntries: 112, totalSectors: 1440,
                sectorsPerFAT: 3, sectorsPerTrack: 9, heads: 2 }
    };

    function tryLsxDodgers(container, geom) {
        try {
            var useLBA = !!geom.isHdd || !!geom.isEmm;

            // 1. 標準 BPB 検出: ブートセクタに JMP + BPB があるか
            var boot = useLBA ? container.readSectorLBA(0)
                              : container.readSector(0, 0, 1);
            if (boot && boot.length >= 32 &&
                (boot[0] === 0xEB || boot[0] === 0xE9)) {

                var bps = boot[0x0B] | (boot[0x0C] << 8);
                // HDD/EMM: コンテナの sectorSize と BPB の bps が一致するか検証
                if (useLBA) {
                    var containerSectorSize = geom.sectorSize || 256;
                    if (bps !== containerSectorSize) return null;
                }

                if (bps === 256 || bps === 512) {
                    var spc = boot[0x0D];
                    var numFATs = boot[0x10];
                    var media = boot[0x15];
                    var bpbSPT = boot[0x18] | (boot[0x19] << 8);
                    var bpbHeads = boot[0x1A] | (boot[0x1B] << 8);

                    // LBA デバイスは CHS ジオメトリ不要 (SPT=0, heads=0 が正常)
                    var geomOk = useLBA || (bpbSPT > 0 && bpbHeads > 0);
                    if (spc > 0 && (spc & (spc - 1)) === 0 &&
                        numFATs >= 1 && numFATs <= 2 &&
                        media >= 0xF0 && geomOk) {
                        return new LsxDodgersFS(container);
                    }
                }
            }

            // 2. BPB レス検出 (FDD のみ; HDD/EMM は誤認識リスクが高いためスキップ)
            if (useLBA) return null;

            //    R=1 が IPL (256B) で R=2 に FAT12 がある場合
            //    X1 IPL ブート互換 + MSX/PC-88 2DD FAT12 ディスク
            var fat1 = container.readSector(0, 0, 2);
            if (fat1 && fat1.length === 512 && fat1[1] === 0xFF && fat1[2] === 0xFF) {
                var mediaDesc = fat1[0];
                var bpb = MEDIA_BPB_TABLE[mediaDesc];
                if (bpb) {
                    // メディア記述子から BPB パラメータを構築
                    var inferredBPB = {};
                    for (var k in bpb) inferredBPB[k] = bpb[k];
                    inferredBPB.mediaDescriptor = mediaDesc;
                    return new LsxDodgersFS(container, inferredBPB);
                }
            }

            return null;
        } catch(e) {
            return null;
        }
    }

    // ================================================================
    // 公開 API
    // ================================================================
    window.XmilDiskFS = {
        HuBasicFS: HuBasicFS,
        LsxDodgersFS: LsxDodgersFS,
        detectFilesystem: detectFilesystem
    };

})();

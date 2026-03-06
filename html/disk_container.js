// disk_container.js - D88/2D ディスクイメージコンテナパーサ
// X millennium Web - ディスク編集ツール (コンテナ層)
(function() {
    'use strict';

    // ================================================================
    // Shift_JIS 最小デコーダ (ディスク名表示用)
    // ================================================================
    function decodeShiftJIS(bytes) {
        var result = '';
        for (var i = 0; i < bytes.length; i++) {
            var b = bytes[i];
            if (b === 0x00) break;
            if (b >= 0x20 && b <= 0x7E) {
                result += String.fromCharCode(b);
            } else if (b >= 0xA1 && b <= 0xDF) {
                // 半角カナ
                result += String.fromCharCode(0xFF61 + (b - 0xA1));
            } else if ((b >= 0x81 && b <= 0x9F) || (b >= 0xE0 && b <= 0xFC)) {
                // 2バイト文字
                if (i + 1 < bytes.length) {
                    var b2 = bytes[++i];
                    // Shift_JIS → JIS 変換
                    var hi = b, lo = b2;
                    if (hi >= 0xE0) hi -= 0x40;
                    hi -= 0x81;
                    hi *= 2;
                    if (lo >= 0x80) lo--;
                    if (lo >= 0x9E) { hi++; lo -= 0x9E; } else { lo -= 0x40; }
                    var jis = ((hi + 0x21) << 8) | (lo + 0x21);
                    // JIS → Unicode (簡易: 未変換時はフォールバック)
                    try {
                        var decoded = new TextDecoder('shift_jis').decode(new Uint8Array([b, b2]));
                        result += decoded;
                    } catch(e) {
                        result += '\\x' + b.toString(16).padStart(2, '0')
                                + '\\x' + b2.toString(16).padStart(2, '0');
                    }
                } else {
                    result += '\\x' + b.toString(16).padStart(2, '0');
                }
            } else {
                result += '\\x' + b.toString(16).padStart(2, '0');
            }
        }
        return result;
    }

    // TextDecoder('shift_jis') が使えるかチェック
    var hasShiftJISDecoder = false;
    try {
        new TextDecoder('shift_jis');
        hasShiftJISDecoder = true;
    } catch(e) {}

    // Shift_JIS バイト列をデコード (TextDecoder 利用版)
    function decodeSJIS(bytes, offset, len) {
        var sub = bytes.slice(offset, offset + len);
        // 末尾の 0x00 と 0x20 パディングを除去
        var end = sub.length;
        while (end > 0 && (sub[end - 1] === 0x00 || sub[end - 1] === 0x20)) end--;
        if (end === 0) return '';
        sub = sub.slice(0, end);

        if (hasShiftJISDecoder) {
            try {
                return new TextDecoder('shift_jis').decode(sub);
            } catch(e) {}
        }
        return decodeShiftJIS(sub);
    }

    // ================================================================
    // Raw2DContainer - 2D ベタフォーマット
    // ================================================================
    // 40 cylinders × 2 heads × 16 sectors/track × 256 bytes/sector = 327,680 bytes

    function Raw2DContainer(arrayBuffer) {
        this._buf = new Uint8Array(arrayBuffer);
        if (this._buf.length < 327680) {
            throw new Error('2D image too small: ' + this._buf.length + ' bytes');
        }
        this.name = '';
        this.protect = 0;
        this.fdType = 0x00; // 2D
        this.isMultiDisk = false;
    }

    Raw2DContainer.prototype.readSector = function(c, h, r) {
        if (c < 0 || c >= 40 || h < 0 || h >= 2 || r < 1 || r > 16) return null;
        var offset = (c * 32 + h * 16 + r - 1) * 256;
        if (offset + 256 > this._buf.length) return null;
        return this._buf.slice(offset, offset + 256);
    };

    Raw2DContainer.prototype.writeSector = function(c, h, r, data) {
        if (c < 0 || c >= 40 || h < 0 || h >= 2 || r < 1 || r > 16) {
            throw new Error('Sector out of range: C=' + c + ' H=' + h + ' R=' + r);
        }
        if (data.length !== 256) {
            throw new Error('Sector size mismatch: expected 256, got ' + data.length);
        }
        var offset = (c * 32 + h * 16 + r - 1) * 256;
        this._buf.set(data, offset);
    };

    Raw2DContainer.prototype.toArrayBuffer = function() {
        return this._buf.buffer.slice(0);
    };

    Raw2DContainer.prototype.getGeometry = function() {
        return {
            cylinders: 40,
            heads: 2,
            sectorsPerTrack: 16,
            sectorSize: 256,
            fdType: 0x00
        };
    };

    // ================================================================
    // D88Container - D88 ディスクイメージ
    // ================================================================
    // ヘッダ: 0x2B0 bytes
    //   [0x00-0x10] disk name (17 bytes, null-terminated)
    //   [0x11-0x19] reserved (9 bytes)
    //   [0x1A]      write protect
    //   [0x1B]      disk type (0x00=2D, 0x10=2DD, 0x20=2HD, 0x30=1DD, 0x40=1D)
    //   [0x1C-0x1F] disk size (uint32 LE)
    //   [0x20-0x2AF] track pointers (164 × uint32 LE)
    // セクタヘッダ: 16 bytes
    //   [0] c, [1] h, [2] r, [3] n, [4-5] sectors count,
    //   [6] mfm, [7] del, [8] stat, [9-13] reserved, [14-15] data size

    var D88_HEADER_SIZE = 0x2B0;
    var D88_SECTOR_HEADER_SIZE = 16;
    var D88_TRACK_COUNT = 164;
    var D88_VALID_FD_TYPES = [0x00, 0x10, 0x20, 0x30, 0x40];

    function D88Container(arrayBuffer, diskOffset) {
        diskOffset = diskOffset || 0;
        this._fullBuf = new Uint8Array(arrayBuffer);
        this._diskOffset = diskOffset;
        this._view = new DataView(arrayBuffer);

        // ヘッダ解析
        var off = diskOffset;
        this.name = decodeSJIS(this._fullBuf, off, 17);
        this.protect = this._fullBuf[off + 0x1A];
        this.fdType = this._fullBuf[off + 0x1B];
        this.fdSize = this._view.getUint32(off + 0x1C, true);

        // マルチディスク検出
        this.isMultiDisk = (this.fdSize > 0 && this.fdSize < (this._fullBuf.length - diskOffset));

        // トラックポインタ
        this.trackPtrs = new Array(D88_TRACK_COUNT);
        for (var i = 0; i < D88_TRACK_COUNT; i++) {
            this.trackPtrs[i] = this._view.getUint32(off + 0x20 + i * 4, true);
        }

        // セクタインデックス構築
        this._sectorIndex = {};
        this._buildSectorIndex();
    }

    D88Container.prototype._buildSectorIndex = function() {
        var off = this._diskOffset;
        var diskEnd = off + this.fdSize;

        // 使用中のトラックポインタをソート (次トラックの開始位置特定用)
        var usedPtrs = [];
        for (var t = 0; t < D88_TRACK_COUNT; t++) {
            if (this.trackPtrs[t] > 0) {
                usedPtrs.push(this.trackPtrs[t]);
            }
        }
        usedPtrs.sort(function(a, b) { return a - b; });

        for (var t = 0; t < D88_TRACK_COUNT; t++) {
            var trkPtr = this.trackPtrs[t];
            if (trkPtr === 0) continue;

            var absPtr = off + trkPtr;
            if (absPtr + D88_SECTOR_HEADER_SIZE > this._fullBuf.length) continue;

            // 次トラックの開始位置を特定
            var nextTrkEnd = diskEnd;
            for (var p = 0; p < usedPtrs.length; p++) {
                if (usedPtrs[p] > trkPtr) {
                    nextTrkEnd = off + usedPtrs[p];
                    break;
                }
            }

            // トラック内のセクタを走査
            var pos = absPtr;
            var safeguard = 256; // 無限ループ防止
            while (pos + D88_SECTOR_HEADER_SIZE <= nextTrkEnd && safeguard-- > 0) {
                var c = this._fullBuf[pos];
                var h = this._fullBuf[pos + 1];
                var r = this._fullBuf[pos + 2];
                var dataSize = this._fullBuf[pos + 14] | (this._fullBuf[pos + 15] << 8);

                if (pos + D88_SECTOR_HEADER_SIZE + dataSize > this._fullBuf.length) break;

                var key = c + '-' + h + '-' + r;
                // 同じ C-H-R が複数回出現する場合は最初のものを使用
                if (!this._sectorIndex[key]) {
                    this._sectorIndex[key] = {
                        dataOffset: pos + D88_SECTOR_HEADER_SIZE,
                        dataSize: dataSize
                    };
                }

                pos += D88_SECTOR_HEADER_SIZE + dataSize;
            }
        }
    };

    D88Container.prototype.readSector = function(c, h, r) {
        var key = c + '-' + h + '-' + r;
        var info = this._sectorIndex[key];
        if (!info) return null;
        return this._fullBuf.slice(info.dataOffset, info.dataOffset + info.dataSize);
    };

    D88Container.prototype.writeSector = function(c, h, r, data) {
        var key = c + '-' + h + '-' + r;
        var info = this._sectorIndex[key];
        if (!info) throw new Error('Sector not found: C=' + c + ' H=' + h + ' R=' + r);
        if (data.length !== info.dataSize) {
            throw new Error('Sector size mismatch: expected ' + info.dataSize + ', got ' + data.length);
        }
        this._fullBuf.set(data, info.dataOffset);
    };

    D88Container.prototype.toArrayBuffer = function() {
        // _fullBuf 全体を返す (マルチディスク時の後続ディスクも保持)
        return this._fullBuf.buffer.slice(0);
    };

    D88Container.prototype.getGeometry = function() {
        var type = this.fdType;
        var geom = { fdType: type };

        if (type === 0x20) {
            // 2HD
            geom.cylinders = 77;
            geom.heads = 2;
            geom.sectorsPerTrack = 26;
            geom.sectorSize = 256;
        } else if (type === 0x10) {
            // 2DD
            geom.cylinders = 80;
            geom.heads = 2;
            geom.sectorsPerTrack = 16;
            geom.sectorSize = 256;
        } else {
            // 2D (default)
            geom.cylinders = 40;
            geom.heads = 2;
            geom.sectorsPerTrack = 16;
            geom.sectorSize = 256;
        }

        // 実際のセクタサイズをインデックスから推定
        for (var key in this._sectorIndex) {
            geom.sectorSize = this._sectorIndex[key].dataSize;
            break;
        }

        return geom;
    };

    // ================================================================
    // RawHddContainer - HDD/EMM RAW ベタフォーマット (LBA アクセス)
    // ================================================================
    // RAW バイト列。MBR パーティション検出 + 可変セクタサイズ (256B/512B)。

    // FAT12/16 系パーティションタイプ (優先)
    // FAT32 (0x0B, 0x0C) は現 FS 実装が FAT12/16 のみのため除外
    var FAT_PTYPES = [0x01, 0x04, 0x06, 0x0E];
    // 拡張パーティション (スキップ対象: 将来 EBR 対応時に分離)
    var EXTENDED_PTYPES = [0x05, 0x0F, 0x85];

    // entryType: 'hdd' or 'emm' (openContainer から渡される)
    function RawHddContainer(arrayBuffer, entryType) {
        if (arrayBuffer.byteLength % 256 !== 0) {
            throw new Error('HDD/EMM image size must be a multiple of 256 bytes');
        }
        this._buf = new Uint8Array(arrayBuffer);
        this.sectorSize = 256;
        this._partitionOffset = 0;
        this._partitionSize = this._buf.length;
        this.name = '';
        this.protect = 0;
        this.fdType = -1;
        this.isMultiDisk = false;
        this._mediaType = entryType || 'hdd';

        // MBR パーティションテーブル検出 (HDD のみ。EMM は MBR を持たない)
        if (entryType !== 'emm' && this._detectMBR()) {
            this._detectSectorSize();
        } else {
            // MBR なし (EMM / non-MBR HDD): 既知オフセットから VBR (BPB) を探索
            // EMM は先頭 512B がシステム予約で BPB が 0x200 に配置される場合がある
            this._detectVBR();
        }
    }

    // MBR パーティションテーブル検出
    // 4 エントリを走査し、最初の有効パーティションを選択 (FAT 系優先)
    RawHddContainer.prototype._detectMBR = function() {
        if (this._buf.length < 512) return false;
        if (this._buf[0x1FE] !== 0x55 || this._buf[0x1FF] !== 0xAA) return false;

        var bestEntry = null;
        for (var i = 0; i < 4; i++) {
            var pe = 0x1BE + i * 16;
            var ptype = this._buf[pe + 4];
            if (ptype === 0) continue;
            if (EXTENDED_PTYPES.indexOf(ptype) >= 0) continue;

            var lbaStart = ((this._buf[pe + 8]  | (this._buf[pe + 9] << 8) |
                             (this._buf[pe + 10] << 16) | (this._buf[pe + 11] << 24)) >>> 0);
            var lbaSize  = ((this._buf[pe + 12] | (this._buf[pe + 13] << 8) |
                             (this._buf[pe + 14] << 16) | (this._buf[pe + 15] << 24)) >>> 0);

            if (lbaStart === 0 || lbaSize === 0) continue;
            // パーティション範囲がファイル内に収まるか検証 (MBR LBA は 512B ベース)
            var partEnd = (lbaStart + lbaSize) * 512;
            if (partEnd > this._buf.length) continue;

            var isFAT = FAT_PTYPES.indexOf(ptype) >= 0;
            if (!bestEntry || (isFAT && !bestEntry.isFAT)) {
                bestEntry = { offset: lbaStart * 512, size: lbaSize * 512, isFAT: isFAT };
                if (isFAT) break;
            }
        }

        if (!bestEntry) return false;
        this._partitionOffset = bestEntry.offset;
        this._partitionSize = bestEntry.size;
        return true;
    };

    // MBR なし時: VBR (BPB) を既知オフセットから探索
    // EMM (LSX-Dodgers) は先頭 512B をシステム予約とし BPB を 0x200 に配置する
    // HDD は 0x000 のみ (0x200 まで探すと非 FAT データを誤検出するリスク)
    RawHddContainer.prototype._detectVBR = function() {
        var offsets = (this._mediaType === 'emm') ? [0x000, 0x200] : [0x000];
        for (var i = 0; i < offsets.length; i++) {
            var off = offsets[i];
            if (off + 32 > this._buf.length) continue;

            // JMP 命令チェック (FAT BPB の必須シグネチャ)
            var b0 = this._buf[off];
            if (b0 !== 0xEB && b0 !== 0xE9) continue;

            var bps = this._buf[off + 0x0B] | (this._buf[off + 0x0C] << 8);
            if (bps !== 256 && bps !== 512) continue;

            // BPB 発見 — パーティションオフセットとセクタサイズを設定
            if (off > 0) {
                this._partitionOffset = off;
                this._partitionSize = this._buf.length - off;
            }
            this.sectorSize = bps;
            return;
        }
    };

    // パーティション先頭の BPB から論理セクタサイズを検出
    RawHddContainer.prototype._detectSectorSize = function() {
        var off = this._partitionOffset;
        if (off + 32 > this._buf.length) return;
        var b0 = this._buf[off];
        if (b0 !== 0xEB && b0 !== 0xE9) return;
        var bps = this._buf[off + 0x0B] | (this._buf[off + 0x0C] << 8);
        if (bps === 256 || bps === 512) {
            this.sectorSize = bps;
        }
    };

    RawHddContainer.prototype.readSectorLBA = function(lba) {
        if (lba < 0) return null;
        var localOffset = lba * this.sectorSize;
        if (localOffset + this.sectorSize > this._partitionSize) return null;
        var absOffset = this._partitionOffset + localOffset;
        return this._buf.slice(absOffset, absOffset + this.sectorSize);
    };

    RawHddContainer.prototype.writeSectorLBA = function(lba, data) {
        if (lba < 0 || data.length !== this.sectorSize) {
            throw new Error('Invalid LBA write: lba=' + lba +
                ' data.length=' + data.length + ' expected=' + this.sectorSize);
        }
        var localOffset = lba * this.sectorSize;
        if (localOffset + this.sectorSize > this._partitionSize) {
            throw new Error('Sector out of range: LBA ' + lba +
                ' (partition limit: ' + Math.floor(this._partitionSize / this.sectorSize) + ')');
        }
        this._buf.set(data, this._partitionOffset + localOffset);
    };

    // CHS は提供しない
    RawHddContainer.prototype.readSector = function(c, h, r) {
        return null;
    };

    RawHddContainer.prototype.writeSector = function(c, h, r, data) {
        throw new Error('CHS access not supported on HDD/EMM container');
    };

    RawHddContainer.prototype.toArrayBuffer = function() {
        return this._buf.buffer.slice(0);
    };

    RawHddContainer.prototype.getGeometry = function() {
        return {
            sectorSize: this.sectorSize,
            fdType: -1,
            isHdd: this._mediaType === 'hdd',
            isEmm: this._mediaType === 'emm',
            totalSectors: Math.floor(this._partitionSize / this.sectorSize)
        };
    };

    // ================================================================
    // コンテナ自動検出 (内容優先、拡張子補助)
    // ================================================================
    // entryType: ライブラリの entry.type ('fdd', 'hdd', 'emm') — 省略可
    function openContainer(arrayBuffer, filename, entryType) {
        if (!arrayBuffer || arrayBuffer.byteLength < 256) return null;

        var buf = new Uint8Array(arrayBuffer);
        var view = new DataView(arrayBuffer);
        var ext = '';
        if (filename) {
            var dotIdx = filename.lastIndexOf('.');
            if (dotIdx >= 0) ext = filename.substring(dotIdx + 1).toLowerCase();
        }

        // 0. entryType による最優先判定 (HDD/EMM)
        if (entryType === 'hdd' || entryType === 'emm') {
            try { return new RawHddContainer(arrayBuffer, entryType); } catch(e) { return null; }
        }

        // 1. D88 ヘッダ妥当性チェック (内容ベース)
        if (arrayBuffer.byteLength >= D88_HEADER_SIZE) {
            var fdSize = view.getUint32(0x1C, true);
            var fdType = buf[0x1B];
            var trackPtr0 = view.getUint32(0x20, true);

            var isValidD88 =
                fdSize > D88_HEADER_SIZE &&
                fdSize <= arrayBuffer.byteLength &&
                D88_VALID_FD_TYPES.indexOf(fdType) >= 0 &&
                (trackPtr0 === 0 || trackPtr0 >= D88_HEADER_SIZE);

            if (isValidD88) {
                return new D88Container(arrayBuffer, 0);
            }
        }

        // 2. 2D 判定: サイズが 327,680 bytes ちょうど
        if (arrayBuffer.byteLength === 327680) {
            return new Raw2DContainer(arrayBuffer);
        }

        // 3. 拡張子フォールバック
        if (ext === 'd88' || ext === '88d') {
            try { return new D88Container(arrayBuffer, 0); } catch(e) {}
        }
        if (ext === '2d') {
            try { return new Raw2DContainer(arrayBuffer); } catch(e) {}
        }

        // 3.5. HDD/EMM 拡張子フォールバック
        if (ext === 'hdd' || ext === 'hd') {
            try { return new RawHddContainer(arrayBuffer, 'hdd'); } catch(e) {}
        }
        if (ext === 'mem') {
            try { return new RawHddContainer(arrayBuffer, 'emm'); } catch(e) {}
        }

        return null; // 不明コンテナ
    }

    // ================================================================
    // 公開 API
    // ================================================================
    window.XmilDiskContainer = {
        D88Container: D88Container,
        Raw2DContainer: Raw2DContainer,
        RawHddContainer: RawHddContainer,
        openContainer: openContainer,
        decodeSJIS: decodeSJIS
    };

})();

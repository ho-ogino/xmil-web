// x1pen_slfs_disk.js — SLFS disk image (D88, 2D) for SLANG x1native programs
// Port of SLANG-compiler src/SLANGCompiler.SlfsPack (D88Writer, SlfsBootHeader,
// SlfsSuperblock, SlfsPackerLibrary) for the no-asset case. The output is
// byte-identical to `slangbuild --emit disk` for the same program.
// The X1 IPL reads only the 32-byte header in sector 0 and the program body.

(function() {
    'use strict';

    var SIDES = 2;
    var TRACKS = 40;
    var SECTORS_PER_TRACK = 16;
    var SECTOR_SIZE = 256;
    var SECTOR_SIZE_CODE = 1;          // 128 << 1
    var MEDIA_TYPE_2D = 0x00;
    var D88_HEADER_SIZE = 0x20;
    var TRACK_TABLE_ENTRIES = 164;
    var DATA_AREA_OFFSET = D88_HEADER_SIZE + TRACK_TABLE_ENTRIES * 4;   // 0x2B0
    var SECTOR_HEADER_SIZE = 16;
    var LOGICAL_SECTORS = TRACKS * SIDES * SECTORS_PER_TRACK;
    var DIR_START_SECTOR = 2;
    var DEFAULT_SAVE_SECTORS = 64;

    function writeAsciiPadded(buf, offset, length, text) {
        var s = String(text || '');
        for (var i = 0; i < length; i++) {
            if (i < s.length) {
                var c = s.charCodeAt(i);
                if (c > 0x7F) throw new Error('SLFS names must be ASCII');
                buf[offset + i] = c;
            } else {
                buf[offset + i] = 0x20;
            }
        }
    }

    function writeU16(buf, offset, value) {
        buf[offset] = value & 0xFF;
        buf[offset + 1] = (value >> 8) & 0xFF;
    }

    function writeU32(buf, offset, value) {
        writeU16(buf, offset, value & 0xFFFF);
        writeU16(buf, offset + 2, (value >>> 16) & 0xFFFF);
    }

    // options: { mainName, loadAddr, execAddr, volumeName, saveSectors }
    function buildSlfsD88(programBytes, options) {
        var program = programBytes instanceof Uint8Array ? programBytes : new Uint8Array(programBytes || []);
        var opts = options || {};
        if (program.length === 0) throw new Error('SLFS main program is empty');
        if (program.length > 0xFFFF) throw new Error('SLFS main program is too large (' + program.length + ' > 65535)');
        var loadAddr = opts.loadAddr === undefined ? 0x1000 : opts.loadAddr;
        var execAddr = opts.execAddr === undefined ? 0x1000 : opts.execAddr;
        var mainName = opts.mainName === undefined ? 'SLFSMAIN' : opts.mainName;
        var volumeName = opts.volumeName === undefined ? 'GAMEDISK' : opts.volumeName;
        var saveSectors = opts.saveSectors === undefined ? DEFAULT_SAVE_SECTORS : opts.saveSectors;

        var dirSectorCount = 1;       // no assets: an empty directory still takes one sector
        var mainStartSector = DIR_START_SECTOR + dirSectorCount;
        var mainSectorCount = Math.ceil(program.length / SECTOR_SIZE);
        var saveStartSector = mainStartSector + mainSectorCount;
        var saveSectorCount = Math.max(0, Math.min(saveSectors, LOGICAL_SECTORS - saveStartSector));
        if (saveStartSector > LOGICAL_SECTORS) throw new Error('SLFS disk image overflow');

        var sectors = new Uint8Array(LOGICAL_SECTORS * SECTOR_SIZE);

        // Sector 0: Hu-BASIC IPL header
        var h = 0;
        sectors[h] = 0x01;
        writeAsciiPadded(sectors, h + 0x01, 13, mainName);
        writeAsciiPadded(sectors, h + 0x0E, 3, 'Sys');
        sectors[h + 0x11] = 0x20;
        writeU16(sectors, h + 0x12, program.length);
        writeU16(sectors, h + 0x14, loadAddr);
        writeU16(sectors, h + 0x16, execAddr);
        // +18..+1C date: zero
        var diskOffset = mainStartSector * SECTOR_SIZE;
        sectors[h + 0x1D] = diskOffset & 0xFF;
        sectors[h + 0x1E] = (diskOffset >> 8) & 0xFF;
        sectors[h + 0x1F] = (diskOffset >> 16) & 0xFF;

        // Sector 1: superblock
        var sb = SECTOR_SIZE;
        sectors[sb] = 0x53; sectors[sb + 1] = 0x4C; sectors[sb + 2] = 0x46; sectors[sb + 3] = 0x53;   // "SLFS"
        sectors[sb + 0x04] = 1;
        sectors[sb + 0x05] = SIDES;
        sectors[sb + 0x06] = TRACKS;
        sectors[sb + 0x07] = SECTORS_PER_TRACK;
        writeU16(sectors, sb + 0x08, DIR_START_SECTOR);
        writeU16(sectors, sb + 0x0A, 0);                  // directory entries
        writeU16(sectors, sb + 0x0C, saveStartSector);    // data area (no assets) starts where save does
        writeU16(sectors, sb + 0x0E, saveStartSector);
        writeU16(sectors, sb + 0x10, saveSectorCount);
        writeAsciiPadded(sectors, sb + 0x12, 16, volumeName);

        // Sector 2: empty directory. Sector 3..: program
        sectors.set(program, mainStartSector * SECTOR_SIZE);

        // D88 container
        var trackBlockSize = SECTORS_PER_TRACK * (SECTOR_HEADER_SIZE + SECTOR_SIZE);
        var totalSize = DATA_AREA_OFFSET + TRACKS * SIDES * trackBlockSize;
        var img = new Uint8Array(totalSize);
        var nameText = String(volumeName);
        for (var n = 0; n < Math.min(nameText.length, 16); n++) {
            var nc = nameText.charCodeAt(n);
            if (nc > 0x7F) throw new Error('SLFS names must be ASCII');
            img[n] = nc;
        }
        img[0x1B] = MEDIA_TYPE_2D;
        writeU32(img, 0x1C, totalSize);
        var cur = DATA_AREA_OFFSET;
        for (var cyl = 0; cyl < TRACKS; cyl++) {
            for (var head = 0; head < SIDES; head++) {
                writeU32(img, D88_HEADER_SIZE + (2 * cyl + head) * 4, cur);
                for (var sec = 1; sec <= SECTORS_PER_TRACK; sec++) {
                    var lsec = cyl * SIDES * SECTORS_PER_TRACK + head * SECTORS_PER_TRACK + (sec - 1);
                    img[cur] = cyl;
                    img[cur + 1] = head;
                    img[cur + 2] = sec;
                    img[cur + 3] = SECTOR_SIZE_CODE;
                    writeU16(img, cur + 4, SECTORS_PER_TRACK);
                    writeU16(img, cur + 0x0E, SECTOR_SIZE);
                    img.set(sectors.subarray(lsec * SECTOR_SIZE, (lsec + 1) * SECTOR_SIZE), cur + SECTOR_HEADER_SIZE);
                    cur += SECTOR_HEADER_SIZE + SECTOR_SIZE;
                }
            }
        }
        return img.buffer;
    }

    window.X1PenSlfsDisk = {
        buildSlfsD88: buildSlfsD88
    };
})();

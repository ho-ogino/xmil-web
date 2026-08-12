// project_disk.js - X1Pen project disk validation and mutation
(function() {
    'use strict';

    var MANAGED_FILES = ['PROG.COM', 'PROGRAM.BIN', 'AUTORUN.BAS'];
    var MODE_LAUNCH = { lsx: 'PROG', fuzzybasic: 'FZBASIC' };

    function ProjectDiskError(code, message, details) {
        this.name = 'ProjectDiskError';
        this.code = code;
        this.message = message;
        if (Error.captureStackTrace) Error.captureStackTrace(this, ProjectDiskError);
        var self = this;
        Object.keys(details || {}).forEach(function(key) { self[key] = details[key]; });
    }
    ProjectDiskError.prototype = Object.create(Error.prototype);
    ProjectDiskError.prototype.constructor = ProjectDiskError;

    function fail(code, message, details) {
        throw new ProjectDiskError(code, message, details);
    }

    function splitName(fullName) {
        var dot = fullName.lastIndexOf('.');
        return dot < 0
            ? { name: fullName, ext: '' }
            : { name: fullName.slice(0, dot), ext: fullName.slice(dot + 1) };
    }

    function cloneBytes(value) {
        if (value instanceof ArrayBuffer) return value.slice(0);
        if (ArrayBuffer.isView(value)) {
            return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
        }
        fail('PROJECT_DISK_INVALID_BYTES', 'プロジェクトディスクのデータはArrayBufferまたはTypedArrayで指定してください');
    }

    function openValidated(arrayBuffer, filename) {
        var bytes = cloneBytes(arrayBuffer);
        var container = window.XmilDiskContainer.openContainer(bytes, filename || 'project.d88', 'fdd');
        if (!container) fail('PROJECT_DISK_UNSUPPORTED_CONTAINER', 'FDD0のディスクは対応するD88またはraw 2D形式ではありません');
        if (container.isMultiDisk) fail('PROJECT_DISK_MULTI_D88', '複数ディスクを含むD88はX1Penプロジェクトディスクとして使用できません');
        if (container.protect) fail('PROJECT_DISK_WRITE_PROTECTED', '選択したディスクイメージは書き込み禁止です');

        var fs = window.XmilDiskFS.detectFilesystem(container);
        if (!fs || fs.fsType !== 'LSX-Dodgers') {
            fail('PROJECT_DISK_NOT_LSX', '選択したディスクはLSX-Dodgers形式ではありません');
        }
        var info = fs.getInfo();
        if (info.readOnly) fail('PROJECT_DISK_READ_ONLY', '選択したファイルシステムは読み取り専用です');
        if (info.anomaly) fail('PROJECT_DISK_ANOMALY', '選択したファイルシステムの領域割り当てに異常があります');
        return { container: container, fs: fs, info: info };
    }

    function firstToken(line) {
        var text = String(line || '').trim();
        while (text.charAt(0) === '@') text = text.slice(1).trim();
        if (!text || text.slice(0, 2) === '::') return '';
        var token = text.split(/[\s=]+/, 1)[0].toUpperCase();
        return token;
    }

    function isPreludeLine(line) {
        var text = String(line || '').trim();
        if (!text || text.slice(0, 2) === '::') return true;
        var token = firstToken(text);
        if (token === 'REM' || token === 'PATH' || token === 'SET' || token === 'PROMPT' ||
            token === 'ECHO' || token === 'CD' || token === 'CHDIR') return true;
        return /^[A-Z]:$/i.test(token);
    }

    function decodeAutoexec(bytes) {
        if (!bytes) return { lines: [], newline: '\r\n' };
        var end = bytes.length;
        for (var i = 0; i < bytes.length; i++) {
            if (bytes[i] === 0x1A || bytes[i] === 0x00) { end = i; break; }
        }
        var text = '';
        for (var j = 0; j < end; j++) text += String.fromCharCode(bytes[j] & 0x7F);
        var newline = text.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
        var lines = text ? text.split(/\r?\n/) : [];
        while (lines.length && lines[lines.length - 1] === '') lines.pop();
        return { lines: lines, newline: newline };
    }

    function encodeAutoexec(lines, newline) {
        var text = lines.join(newline || '\r\n') + (newline || '\r\n');
        var out = new Uint8Array(text.length + 1);
        for (var i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0x7F;
        out[out.length - 1] = 0x1A;
        return out;
    }

    function updateAutoexec(existingBytes, mode) {
        var launch = MODE_LAUNCH[mode];
        if (!launch) fail('PROJECT_DISK_MODE_INVALID', '未対応のプロジェクトディスクモードです: ' + mode);
        var decoded = decodeAutoexec(existingBytes);
        var launchLine = launch;
        var retained = [];
        for (var i = 0; i < decoded.lines.length; i++) {
            var token = firstToken(decoded.lines[i]);
            if (token === 'PROG' || token === 'FZBASIC') {
                if (token === launch && launchLine === launch) launchLine = decoded.lines[i].trim();
                continue;
            }
            retained.push(decoded.lines[i]);
        }
        var insertAt = 0;
        while (insertAt < retained.length && isPreludeLine(retained[insertAt])) insertAt++;
        var followingCommand = insertAt < retained.length ? retained[insertAt].trim() : null;
        retained.splice(insertAt, 0, launchLine);
        return {
            bytes: encodeAutoexec(retained, decoded.newline),
            insertedAt: insertAt,
            followingCommand: followingCommand,
            launch: launchLine,
            lines: retained
        };
    }

    function replaceFile(fs, fullName, data) {
        var parts = splitName(fullName);
        var existing = fs.findByName(parts.name, parts.ext);
        if (existing) fs.deleteFile(existing);
        fs.addFile(parts.name, parts.ext, data instanceof Uint8Array ? data : new Uint8Array(data));
    }

    function deleteFile(fs, fullName) {
        var parts = splitName(fullName);
        var existing = fs.findByName(parts.name, parts.ext);
        if (existing) fs.deleteFile(existing);
    }

    function inspect(arrayBuffer, filename, mode) {
        var opened = openValidated(arrayBuffer, filename);
        var warnings = [];
        if (!opened.fs.findByName('LD', 'BIN')) warnings.push('LD.BINがありません。LSX-Dodgersを起動できない可能性があります');
        if (mode === 'fuzzybasic' && !opened.fs.findByName('FZBASIC', 'COM')) {
            warnings.push('FZBASIC.COMがありません。このディスクからFuzzyBASICを起動できません');
        }
        return {
            fsType: opened.fs.fsType,
            format: opened.info.format,
            freeBytes: opened.info.freeBytes,
            warnings: warnings,
            bootVerified: false
        };
    }

    function prepare(arrayBuffer, filename, options) {
        options = options || {};
        var mode = options.mode;
        var opened = openValidated(arrayBuffer, filename);
        var fs = opened.fs;
        var warnings = [];
        if (!fs.findByName('LD', 'BIN')) warnings.push('LD.BINがありません。LSX-Dodgersを起動できない可能性があります');
        if (mode === 'fuzzybasic' && !fs.findByName('FZBASIC', 'COM')) {
            warnings.push('FZBASIC.COMがありません。このディスクからFuzzyBASICを起動できません');
        }

        MANAGED_FILES.forEach(function(name) { deleteFile(fs, name); });
        var files = options.files || [];
        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            if (file.replaceOnly) {
                var parts = splitName(file.name);
                if (!fs.findByName(parts.name, parts.ext)) continue;
            }
            replaceFile(fs, file.name, file.data);
        }

        var autoEntry = fs.findByName('AUTOEXEC', 'BAT');
        var autoBytes = autoEntry ? fs.readFile(autoEntry) : null;
        var autoexec = updateAutoexec(autoBytes, mode);
        replaceFile(fs, 'AUTOEXEC.BAT', autoexec.bytes);

        var output = opened.container.toArrayBuffer();
        var verified = openValidated(output, filename);
        var required = mode === 'lsx' ? ['PROG.COM'] : ['AUTORUN.BAS'];
        for (var r = 0; r < required.length; r++) {
            var requiredParts = splitName(required[r]);
            if (!verified.fs.findByName(requiredParts.name, requiredParts.ext)) {
                fail('PROJECT_DISK_VERIFY_FAILED', '保存後のディスクに管理対象ファイルがありません: ' + required[r]);
            }
        }
        var verifiedAuto = verified.fs.findByName('AUTOEXEC', 'BAT');
        if (!verifiedAuto) fail('PROJECT_DISK_VERIFY_FAILED', '保存後のディスクにAUTOEXEC.BATがありません');
        var verifiedText = decodeAutoexec(verified.fs.readFile(verifiedAuto)).lines;
        if (verifiedText.map(firstToken).indexOf(MODE_LAUNCH[mode]) < 0) {
            fail('PROJECT_DISK_VERIFY_FAILED', 'AUTOEXEC.BATに必要な起動コマンドがありません');
        }

        return {
            bytes: output,
            mode: mode,
            warnings: warnings,
            autoexec: autoexec,
            bootVerified: false,
            executionVerified: false,
            verification: 'filesystem-only'
        };
    }

    window.X1PenProjectDisk = Object.freeze({
        ProjectDiskError: ProjectDiskError,
        inspect: inspect,
        prepare: prepare,
        updateAutoexec: updateAutoexec,
        _decodeAutoexec: decodeAutoexec,
        _firstToken: firstToken
    });
})();

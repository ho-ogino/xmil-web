// x1pen_hubasic.js — HuBASIC toolchain for X1Pen
// HuBASIC → (hubasic2sl) SLANG → (slangc) ASM → (X1PenZ80Asm) binary → size check → boot disk.
// The converter, the compiler and the Hu-BASIC disk builder run in the SLANG-compiler browser
// bundle (X1PenSlangWasm, x1pen_slang_wasm.js); the assembler is X1Pen's own.
//
// The converter says which environment a program needs: requiredEnv "x1native_hufs" when it uses
// the file statements (OPEN, FILES, KILL, ...), null otherwise. File programs boot from a Hu-BASIC
// format disk built by the bundle with the files the user added; other programs boot from an SLFS
// disk (X1PenSlfsDisk) and the added files are not used.
// Lazy-loaded: window.X1PenHuBasic = { load, build, info }

(function() {
    'use strict';

    var SLFS_ENV = 'x1native_slfs';
    var HUFS_ENV = 'x1native_hufs';
    var SOURCE_NAME = 'PROGRAM.BAS';

    function toolchainError(message) {
        var error = new Error(message);
        error.code = 'HUBASIC_TOOLCHAIN_UNAVAILABLE';
        return error;
    }

    function load() {
        if (!window.X1PenSlangWasm) return Promise.reject(toolchainError('The SLANG bundle loader is not loaded'));
        return window.X1PenSlangWasm.load().then(function() { return info(); });
    }

    function info() {
        var bundle = window.X1PenSlangWasm && window.X1PenSlangWasm.info();
        if (!bundle) return null;
        return {
            revision: bundle.revision,
            hubasic2slVersion: bundle.hubasic2slVersion,
            slangcVersion: bundle.slangcVersion,
            basAbi: bundle.basAbi,
            basFileAbi: bundle.basFileAbi,
            environment: SLFS_ENV,
            environments: [SLFS_ENV, HUFS_ENV],
            loadAddress: bundle.loadAddress,
            reservedStart: bundle.reservedStart
        };
    }

    function stageFailure(stage, message, extra) {
        var result = { ok: false, stage: stage, message: message };
        Object.keys(extra || {}).forEach(function(key) { result[key] = extra[key]; });
        return result;
    }

    function formatDiagnostic(d) {
        var where = d.line ? 'L' + d.line + ':' + d.column + ': ' : '';
        if (where && d.file && d.file !== 'PROGRAM.SL') where = d.file + ' ' + where;
        return where + d.message;
    }

    // Converts, compiles, assembles, size-checks and puts one program on a fresh boot disk.
    // Never throws for program errors: the first failing stage is returned. Throws only when the
    // toolchain is unusable.
    // source: the program in X1 bytes (a Uint8Array, as the HuBASIC tab keeps it) or UTF-8 text.
    // options: extra hubasic2sl Transpile options (X1PenHuBasicOptions.changed); none = defaults.
    // files: [{ name, kind, bytes }] to put on a Hu-BASIC format disk (used only when the program
    // needs x1native_hufs).
    // extra.sourceName: the name the converter sees (and the default boot file name); PROGRAM.BAS.
    async function build(source, options, files, extra) {
        await load();
        var wasm = window.X1PenSlangWasm;
        if (!window.X1PenZ80Asm || !window.X1PenSlfsDisk) {
            throw toolchainError('X1Pen assembler or disk builder is not loaded');
        }
        files = files || [];

        var x1 = source instanceof Uint8Array;
        var bytes = x1 ? source : new TextEncoder().encode(source);
        var transpileOptions = Object.assign({ inputEncoding: x1 ? 'x1' : 'utf8' }, options || {});
        var transpiled = await wasm.transpile(bytes, (extra && extra.sourceName) || SOURCE_NAME, transpileOptions);
        var diagnostics = Array.isArray(transpiled.diagnostics) ? transpiled.diagnostics : [];
        if (!transpiled.ok) {
            var firstError = diagnostics.filter(function(d) { return d.severity === 'error'; })[0];
            return stageFailure('transpile', firstError ? firstError.text : (transpiled.error || 'HuBASIC conversion failed'),
                { diagnostics: diagnostics });
        }
        var envName = transpiled.requiredEnv || SLFS_ENV;
        if (envName !== SLFS_ENV && envName !== HUFS_ENV) {
            return stageFailure('transpile', 'The program needs the ' + envName + ' environment, which X1Pen cannot boot',
                { diagnostics: diagnostics });
        }
        var env = wasm.env(envName);
        var common = { diagnostics: diagnostics, sl: transpiled.sl, environment: envName };

        var compiled = await wasm.compile(transpiled.sl, envName);
        if (!compiled.ok) {
            var compileError = compiled.diagnostics.filter(function(d) { return d.severity === 'error'; })[0];
            return stageFailure('compile', formatDiagnostic(compileError),
                Object.assign({ compileDiagnostics: compiled.diagnostics }, common));
        }
        common.asm = compiled.asm;

        // Same constants as slangbuild passes to the assembler: ENV_TYPE/OS_TYPE plus the env defines
        var constants = Object.assign({ ENV_TYPE: env.envType, OS_TYPE: env.osType }, env.defines);
        var assembled = window.X1PenZ80Asm.assemble(compiled.asm, constants, { allowTopLevelLocalLabels: true });
        // One assembler error shifts every later address, so only the first error is meaningful.
        if (assembled.errors.length > 0) {
            var asmError = assembled.errors[0];
            return stageFailure('assemble', 'L' + asmError.line + ': ' + asmError.msg, common);
        }
        var loadAddress = wasm.info().loadAddress;
        if (assembled.org !== loadAddress) {
            return stageFailure('layout', 'Program does not start at $' + loadAddress.toString(16).toUpperCase(), common);
        }
        var workEnd = assembled.symbols['NAME_SPACE_DEFAULT.__WORKEND__'];
        if (typeof workEnd !== 'number') {
            return stageFailure('layout', '__WORKEND__ is not defined', common);
        }
        // CLEAR <address> lowers the top of memory the program may use
        var clearTop = (typeof transpiled.clearTop === 'number') ? transpiled.clearTop : null;
        var layout = await wasm.checkLayout(assembled.bytes.length, workEnd, clearTop);
        if (!layout.ok) {
            return stageFailure('layout', layout.message || layout.error || 'Program does not fit in memory',
                Object.assign({ workEnd: workEnd, binLength: assembled.bytes.length, clearTop: clearTop }, common));
        }

        var program = new Uint8Array(assembled.bytes);
        var mainName = transpiled.diskMainName || env.defaultDiskMainName;
        var d88;
        if (envName === HUFS_ENV) {
            var disk = await wasm.buildHufsDisk(program, {
                mainName: mainName, load: env.diskMainLoad, exec: env.diskMainExec, files: files
            });
            if (!disk.ok) return stageFailure('disk', disk.error, common);
            d88 = disk.d88;
        } else {
            d88 = window.X1PenSlfsDisk.buildSlfsD88(program, {
                mainName: mainName,
                loadAddr: env.diskMainLoad,
                execAddr: env.diskMainExec,
                volumeName: env.diskVolume
            });
        }
        return {
            ok: true,
            stage: 'done',
            message: layout.message,
            diagnostics: diagnostics,
            compileDiagnostics: compiled.diagnostics,
            environment: envName,
            sl: transpiled.sl,
            asm: compiled.asm,
            bytes: program,
            symbols: assembled.symbols,
            workEnd: workEnd,
            clearTop: clearTop,
            diskMainName: mainName,
            filesUsed: envName === HUFS_ENV ? files.length : 0,
            filesIgnored: envName === HUFS_ENV ? 0 : files.length,
            d88: d88
        };
    }

    window.X1PenHuBasic = {
        load: load,
        build: build,
        info: info
    };
})();

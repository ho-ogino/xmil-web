// x1pen_hubasic.js — Hu-BASIC toolchain for X1Pen
// Hu-BASIC → (hubasic2sl, .NET browser-wasm) SLANG → (X1PenSlangCompiler) ASM
// → (X1PenZ80Asm) binary → size check → (X1PenSlfsDisk) SLFS D88 for the x1native_slfs environment.
//
// The wasm converter and the x1native runtime come from one SLANG-compiler bundle
// (hubasic/<revision>/, copied in by scripts/import-hubasic-bundle.sh). Its manifest is the only
// source of the x1native values (OS_TYPE, defines, ORG, libraries); they are checked against
// the expected x1native_slfs values before use, because a wrong OS_TYPE silently assembles
// LSX-Dodgers code. The x1native runtime is kept in its own VFS, never mixed with slang_runtime/.
// Lazy-loaded: window.X1PenHuBasic = { load, build, info }

(function() {
    'use strict';

    var ENV_NAME = 'x1native_slfs';
    var SOURCE_NAME = 'PROGRAM.BAS';
    var VOLUME_NAME = 'SLFS DEMO';      // x1native_slfs.env disk.volume

    var loadPromise = null;
    var state = null;    // { revision, base, manifest, env, api, vfs }

    function toolchainError(message, details) {
        var error = new Error(message);
        error.code = 'HUBASIC_TOOLCHAIN_UNAVAILABLE';
        Object.keys(details || {}).forEach(function(key) { error[key] = details[key]; });
        return error;
    }

    function isDevHost() {
        var host = location.hostname;
        return host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
               new URLSearchParams(location.search).get('dev') === '1';
    }

    // The bundle must describe exactly the x1native_slfs environment X1Pen boots.
    function checkManifest(manifest) {
        if (!manifest || typeof manifest !== 'object') throw toolchainError('Hu-BASIC manifest is invalid');
        if (manifest.dirty !== false && !isDevHost()) {
            throw toolchainError('Hu-BASIC bundle was built from uncommitted sources');
        }
        var env = manifest.envs && manifest.envs[ENV_NAME];
        if (!env) throw toolchainError('Hu-BASIC manifest has no ' + ENV_NAME + ' environment');
        var defines = env.defines || {};
        var checks = [
            ['envType', env.envType === 1],
            ['osType', env.osType === 4],
            ['defaultOrg', env.defaultOrg === 0x1000],
            ['defines.X1NATIVE', defines.X1NATIVE === 1],
            ['defines.SLFS', defines.SLFS === 1],
            ['loadAddress', manifest.loadAddress === 0x1000],
            ['reservedStart', typeof manifest.reservedStart === 'number' &&
                manifest.reservedStart > 0x1000 && manifest.reservedStart <= 0xFFE0],
            ['libraries', Array.isArray(env.libraries) && env.libraries.length > 0 &&
                env.libraries.every(function(name) {
                    return typeof name === 'string' && /^[A-Za-z0-9_]+\.asm$/.test(name) && !/^liblsx/i.test(name);
                })]
        ];
        for (var i = 0; i < checks.length; i++) {
            if (!checks[i][1]) throw toolchainError('Hu-BASIC manifest has an unexpected ' + checks[i][0]);
        }
        return env;
    }

    async function fetchText(url) {
        var resp = await fetch(url);
        if (!resp.ok) throw toolchainError('Failed to load ' + url + ' (' + resp.status + ')');
        return resp.text();
    }

    async function loadOnce() {
        var current = JSON.parse(await fetchText('hubasic/current.json'));
        if (!current || typeof current.revision !== 'string' || !/^[0-9a-f]{40}$/.test(current.revision)) {
            throw toolchainError('hubasic/current.json is invalid');
        }
        var base = 'hubasic/' + current.revision + '/';
        var manifest = JSON.parse(await fetchText(base + 'manifest.json'));
        if (manifest.slangCompilerRevision !== current.revision) {
            throw toolchainError('Hu-BASIC manifest revision does not match its directory');
        }
        var env = checkManifest(manifest);

        var vfs = {};
        await Promise.all(env.libraries.map(async function(name) {
            vfs[name] = await fetchText(base + 'runtime/' + name);
        }));

        var api;
        try {
            var mod = await import(new URL(base + '_framework/dotnet.js', location.href).href);
            var runtime = await mod.dotnet.create();
            var exports = await runtime.getAssemblyExports('hubasic2sl-wasm');
            api = exports.SLANGCompiler.HuBasic.Wasm.HuBasicWeb;
        } catch (e) {
            throw toolchainError('Failed to start the Hu-BASIC converter: ' + (e && e.message || e));
        }
        var version = JSON.parse(api.Version());
        if (!version.informational || version.informational.slice(-41) !== '+' + current.revision) {
            throw toolchainError('Hu-BASIC converter revision does not match the runtime');
        }
        state = { revision: current.revision, base: base, manifest: manifest, env: env, api: api, vfs: vfs,
                  version: version.version };
        return info();
    }

    function load() {
        if (!loadPromise) {
            loadPromise = loadOnce().catch(function(e) {
                loadPromise = null;     // allow a retry after a transient failure
                throw e;
            });
        }
        return loadPromise;
    }

    function info() {
        if (!state) return null;
        return {
            revision: state.revision,
            hubasic2slVersion: state.version,
            environment: ENV_NAME,
            loadAddress: state.manifest.loadAddress,
            reservedStart: state.manifest.reservedStart
        };
    }

    function stageFailure(stage, message, extra) {
        var result = { ok: false, stage: stage, message: message };
        Object.keys(extra || {}).forEach(function(key) { result[key] = extra[key]; });
        return result;
    }

    // Converts, compiles, assembles and size-checks one program. Never throws for program
    // errors: the first failing stage is returned. Throws only when the toolchain is unusable.
    async function build(sourceText) {
        await load();
        if (!window.X1PenSlangCompiler || !window.X1PenZ80Asm || !window.X1PenSlfsDisk) {
            throw toolchainError('X1Pen compiler, assembler or disk builder is not loaded');
        }
        var env = state.env;

        var bytes = new TextEncoder().encode(sourceText);
        var transpiled = JSON.parse(state.api.Transpile(bytes, SOURCE_NAME, JSON.stringify({ inputEncoding: 'utf8' })));
        var diagnostics = Array.isArray(transpiled.diagnostics) ? transpiled.diagnostics : [];
        if (!transpiled.ok) {
            var firstError = diagnostics.filter(function(d) { return d.severity === 'error'; })[0];
            return stageFailure('transpile', firstError ? firstError.text : (transpiled.error || 'Hu-BASIC conversion failed'),
                { diagnostics: diagnostics });
        }

        var compiled = window.X1PenSlangCompiler.compile(transpiled.sl, state.vfs, {
            defaultOrg: env.defaultOrg, codeReadonly: false, defines: env.defines
        });
        if (compiled.errors && compiled.errors.length > 0) {
            var compileError = compiled.errors[0];
            return stageFailure('compile', compileError.message || String(compileError),
                { diagnostics: diagnostics, sl: transpiled.sl });
        }

        var assembled = window.X1PenZ80Asm.assemble(compiled.asm, { OS_TYPE: env.osType, ENV_TYPE: env.envType },
            { allowTopLevelLocalLabels: true });
        // One assembler error shifts every later address, so only the first error is meaningful.
        if (assembled.errors.length > 0) {
            var asmError = assembled.errors[0];
            return stageFailure('assemble', 'L' + asmError.line + ': ' + asmError.msg,
                { diagnostics: diagnostics, sl: transpiled.sl, asm: compiled.asm });
        }
        if (assembled.org !== state.manifest.loadAddress) {
            return stageFailure('layout', 'Program does not start at $' + state.manifest.loadAddress.toString(16).toUpperCase(),
                { diagnostics: diagnostics, sl: transpiled.sl, asm: compiled.asm });
        }
        var workEnd = assembled.symbols['NAME_SPACE_DEFAULT.__WORKEND__'];
        if (typeof workEnd !== 'number') {
            return stageFailure('layout', '__WORKEND__ is not defined', { diagnostics: diagnostics, sl: transpiled.sl, asm: compiled.asm });
        }
        var layout = JSON.parse(state.api.CheckLayout(assembled.bytes.length, workEnd));
        if (!layout.ok) {
            return stageFailure('layout', layout.message || layout.error || 'Program does not fit in memory',
                { diagnostics: diagnostics, sl: transpiled.sl, asm: compiled.asm, workEnd: workEnd, binLength: assembled.bytes.length });
        }

        var program = new Uint8Array(assembled.bytes);
        var d88 = window.X1PenSlfsDisk.buildSlfsD88(program, {
            mainName: transpiled.diskMainName || 'SLFSMAIN',
            loadAddr: state.manifest.loadAddress,
            execAddr: state.manifest.loadAddress,
            volumeName: VOLUME_NAME
        });
        return {
            ok: true,
            stage: 'done',
            message: layout.message,
            diagnostics: diagnostics,
            sl: transpiled.sl,
            asm: compiled.asm,
            bytes: program,
            symbols: assembled.symbols,
            workEnd: workEnd,
            diskMainName: transpiled.diskMainName,
            d88: d88
        };
    }

    window.X1PenHuBasic = {
        load: load,
        build: build,
        info: info,
        _checkManifest: checkManifest
    };
})();

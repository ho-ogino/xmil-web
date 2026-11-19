// x1pen_slang_wasm.js — the SLANG-compiler browser bundle for X1Pen
// One .NET browser-wasm bundle (hubasic/<revision>/, copied in by scripts/import-hubasic-bundle.mjs)
// carries the HuBASIC converter (hubasic2sl), the SLANG compiler (slangc) and the Hu-BASIC disk
// builder, all from one SLANG-compiler revision. This file loads it once, checks that its manifest
// describes the environments X1Pen uses, and wraps the calls:
//   HuBASIC tab: transpile (hubasic2sl) → compile (slangc, ASM text) → [X1PenZ80Asm in the page] →
//     checkLayout / checkLayoutClear → buildHufsDisk (x1native_hufs) or X1PenSlfsDisk (x1native_slfs)
//   SLANG tab: compile in the x1 environment (LSX-Dodgers on the X1), #INCLUDE from include/
// Every call returns a Promise, so the bundle can later move into a worker without changing callers.
// Lazy-loaded: window.X1PenSlangWasm

(function() {
    'use strict';

    var ASSEMBLY = 'hubasic2sl-wasm';
    var VFS_ROOT = '/slang';
    var WORK_DIR = '/work/';

    var loadPromise = null;
    var state = null;    // { revision, base, manifest, envs, hubasic, slang, runtimeText, versions }

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

    var LIBRARY_NAME = /^[A-Za-z0-9_]+\.asm$/;
    var BOOT_NAME = /^[\x20-\x7E]{1,13}$/;

    function x1nativeChecks(env) {
        var defines = env.defines || {};
        return [
            ['envType', env.envType === 1],
            ['osType', env.osType === 4],
            ['defaultOrg', env.defaultOrg === 0x1000],
            ['defines.X1NATIVE', defines.X1NATIVE === 1],
            ['diskMainLoad', env.diskMainLoad === 0x1000],
            ['diskMainExec', env.diskMainExec === 0x1000],
            ['defaultDiskMainName', typeof env.defaultDiskMainName === 'string' && BOOT_NAME.test(env.defaultDiskMainName)],
            // x1native code must never pull in the LSX-Dodgers runtime
            ['libraries', Array.isArray(env.libraries) && env.libraries.length > 0 &&
                env.libraries.every(function(name) {
                    return typeof name === 'string' && LIBRARY_NAME.test(name) && !/^liblsx/i.test(name);
                })]
        ];
    }

    // The environments X1Pen boots, with the values it relies on. A wrong OS_TYPE or define
    // silently assembles another machine's code, so every value is checked before use.
    var ENV_CHECKS = {
        x1native_slfs: function(env) {
            var defines = env.defines || {};
            return x1nativeChecks(env).concat([
                ['defines.SLFS', defines.SLFS === 1],
                ['defines.HUFS', defines.HUFS === undefined],
                ['diskTool', env.diskTool === 'slfs-pack'],
                ['diskVolume', typeof env.diskVolume === 'string' && /^[\x20-\x7E]{0,16}$/.test(env.diskVolume)]
            ]);
        },
        // The SLANG tab: LSX-Dodgers on the X1, programs from $100
        x1: function(env) {
            var defines = env.defines || {};
            return [
                ['envType', env.envType === 1],
                ['osType', env.osType === 0],
                ['defaultOrg', env.defaultOrg === 0x100],
                ['defines', Object.keys(defines).length === 0],
                ['libraries', Array.isArray(env.libraries) && env.libraries.length > 0 &&
                    env.libraries.every(function(name) {
                        return typeof name === 'string' && LIBRARY_NAME.test(name) && !/^libx1native/i.test(name);
                    })]
            ];
        },
        x1native_hufs: function(env, manifest) {
            var defines = env.defines || {};
            return x1nativeChecks(env).concat([
                ['defines.HUFS', defines.HUFS === 1],
                ['defines.SLFS', defines.SLFS === undefined],
                ['diskTool', env.diskTool === 'hufs-pack'],
                ['basFileAbi', Number.isInteger(manifest.basFileAbi) && manifest.basFileAbi > 0]
            ]);
        }
    };

    function checkManifest(manifest) {
        if (!manifest || typeof manifest !== 'object') throw toolchainError('SLANG bundle manifest is invalid');
        if (manifest.dirty !== false && !isDevHost()) {
            throw toolchainError('SLANG bundle was built from uncommitted sources');
        }
        var common = [
            ['basAbi', Number.isInteger(manifest.basAbi) && manifest.basAbi > 0],
            ['loadAddress', manifest.loadAddress === 0x1000],
            ['reservedStart', typeof manifest.reservedStart === 'number' &&
                manifest.reservedStart > 0x1000 && manifest.reservedStart <= 0xFFE0]
        ];
        for (var i = 0; i < common.length; i++) {
            if (!common[i][1]) throw toolchainError('SLANG bundle manifest has an unexpected ' + common[i][0]);
        }
        var envs = {};
        Object.keys(ENV_CHECKS).forEach(function(name) {
            var env = manifest.envs && manifest.envs[name];
            if (!env) throw toolchainError('SLANG bundle manifest has no ' + name + ' environment');
            var checks = ENV_CHECKS[name](env, manifest);
            for (var j = 0; j < checks.length; j++) {
                if (!checks[j][1]) throw toolchainError('SLANG bundle manifest has an unexpected ' + name + '.' + checks[j][0]);
            }
            envs[name] = env;
        });
        return envs;
    }

    function abiMarkers(runtimeText, prefix) {
        var found = [];
        var re = new RegExp('^;\\s*@name\\s+' + prefix + '_(\\d+)\\s*$', 'gm');
        Object.keys(runtimeText).forEach(function(name) {
            var m;
            re.lastIndex = 0;
            while ((m = re.exec(runtimeText[name]))) found.push(Number(m[1]));
        });
        return found;
    }

    // Converter output calls BAS_ABI_<n>() (and BAS_FABI_<n>() when it uses files); the runtime
    // defines exactly one of each. The bundle, the runtime and the converter must agree.
    function checkBasAbi(manifest, runtimeText, converterAbi) {
        var abi = abiMarkers(runtimeText, 'BAS_ABI');
        if (abi.length !== 1 || abi[0] !== manifest.basAbi) {
            throw toolchainError('HuBASIC runtime BAS_ABI does not match the manifest');
        }
        if (converterAbi !== manifest.basAbi) {
            throw toolchainError('HuBASIC converter BAS_ABI does not match the runtime');
        }
        var fabi = abiMarkers(runtimeText, 'BAS_FABI');
        if (fabi.length !== 1 || fabi[0] !== manifest.basFileAbi) {
            throw toolchainError('HuBASIC file runtime BAS_FABI does not match the manifest');
        }
    }

    function checkRevision(informational, revision, what) {
        if (typeof informational !== 'string' || informational.slice(-41) !== '+' + revision) {
            throw toolchainError(what + ' revision does not match the bundle');
        }
    }

    async function fetchBytes(url) {
        var resp = await fetch(url);
        if (!resp.ok) throw toolchainError('Failed to load ' + url + ' (' + resp.status + ')');
        return new Uint8Array(await resp.arrayBuffer());
    }

    async function fetchJson(url) {
        return JSON.parse(new TextDecoder().decode(await fetchBytes(url)));
    }

    async function loadOnce() {
        var current = await fetchJson('hubasic/current.json');
        if (!current || typeof current.revision !== 'string' || !/^[0-9a-f]{40}$/.test(current.revision)) {
            throw toolchainError('hubasic/current.json is invalid');
        }
        var base = 'hubasic/' + current.revision + '/';
        var manifest = await fetchJson(base + 'manifest.json');
        if (manifest.slangCompilerRevision !== current.revision) {
            throw toolchainError('SLANG bundle manifest revision does not match its directory');
        }
        var envs = checkManifest(manifest);

        // The env files and every runtime library they list, for slangc's in-memory file system
        var files = {};
        var libraries = {};
        Object.keys(envs).forEach(function(name) {
            files['env/' + name + '.env'] = null;
            envs[name].libraries.forEach(function(lib) { libraries[lib] = true; });
        });
        Object.keys(libraries).forEach(function(lib) { files['runtime/' + lib] = null; });
        // The #INCLUDE files of the x1 environment, as the manifest lists them
        (Array.isArray(manifest.files) ? manifest.files : []).forEach(function(file) {
            if (file && typeof file.path === 'string' && /^include\/[A-Za-z0-9_.-]+$/.test(file.path)) files[file.path] = null;
        });
        await Promise.all(Object.keys(files).map(async function(path) {
            files[path] = await fetchBytes(base + path);
        }));
        // The HuBASIC runtime markers are in the x1native libraries
        var runtimeText = {};
        ['x1native_slfs', 'x1native_hufs'].forEach(function(name) {
            envs[name].libraries.forEach(function(lib) {
                runtimeText[lib] = new TextDecoder().decode(files['runtime/' + lib]);
            });
        });

        var hubasic, slang;
        try {
            var mod = await import(new URL(base + '_framework/dotnet.js', location.href).href);
            var runtime = await mod.dotnet.create();
            var exports = await runtime.getAssemblyExports(ASSEMBLY);
            hubasic = exports.SLANGCompiler.HuBasic.Wasm.HuBasicWeb;
            slang = exports.SLANGCompiler.HuBasic.Wasm.SlangWeb;
            if (!hubasic || !slang) throw new Error('the bundle has no HuBasicWeb/SlangWeb exports');
        } catch (e) {
            throw toolchainError('Failed to start the SLANG bundle: ' + (e && e.message || e));
        }
        var hubasicVersion = JSON.parse(hubasic.Version());
        var slangVersion = JSON.parse(slang.Version());
        checkRevision(hubasicVersion.informational, current.revision, 'HuBASIC converter');
        checkRevision(slangVersion.informational, current.revision, 'SLANG compiler');
        checkBasAbi(manifest, runtimeText, hubasicVersion.basAbi);

        Object.keys(files).forEach(function(path) { slang.PutFile(VFS_ROOT + '/' + path, files[path]); });
        // The include files by upper-case name, for programs that spell them in another case
        var includes = {};
        Object.keys(files).forEach(function(path) {
            if (path.indexOf('include/') === 0) includes[path.slice(8).toUpperCase()] = files[path];
        });
        state = {
            revision: current.revision, base: base, manifest: manifest, envs: envs,
            hubasic: hubasic, slang: slang, includes: includes,
            versions: { hubasic2sl: hubasicVersion.version, slangc: slangVersion.slangc }
        };
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
            hubasic2slVersion: state.versions.hubasic2sl,
            slangcVersion: state.versions.slangc,
            basAbi: state.manifest.basAbi,
            basFileAbi: state.manifest.basFileAbi,
            loadAddress: state.manifest.loadAddress,
            reservedStart: state.manifest.reservedStart
        };
    }

    function requireState() {
        if (!state) throw toolchainError('The SLANG bundle is not loaded');
        return state;
    }

    function env(name) {
        var s = requireState();
        var e = s.envs[name];
        if (!e) throw toolchainError('Unknown SLANG environment ' + name);
        return e;
    }

    // slangc prints diagnostics like the CLI: "<file>:<line>:<col>: <severity>: <message>", and a
    // fatal stop as "slangc: error: <message>". file is the in-memory path; show the user's names.
    var DIAGNOSTIC_LINE = /^(.*?):(\d+):(\d+): (error|warning|info|note): (.*)$/;
    function displayFile(path) {
        if (path.indexOf(WORK_DIR) === 0) return path.slice(WORK_DIR.length);
        var slash = path.lastIndexOf('/');
        return slash >= 0 ? path.slice(slash + 1) : path;
    }
    function parseLog(lines) {
        var out = [];
        (lines || []).forEach(function(line) {
            var m = DIAGNOSTIC_LINE.exec(line);
            if (m) {
                out.push({ severity: m[4], message: m[5], file: displayFile(m[1]),
                           line: Number(m[2]), column: Number(m[3]) });
                return;
            }
            var fatal = /^slangc: (error|warning): (.*)$/.exec(line);
            if (fatal) out.push({ severity: fatal[1], message: fatal[2], file: null, line: null, column: null });
        });
        return out;
    }

    async function transpile(bytes, sourceName, options) {
        var s = requireState();
        return JSON.parse(s.hubasic.Transpile(bytes, sourceName, JSON.stringify(options || {})));
    }

    // Compiles SLANG text in one of the checked environments. Never throws for program errors.
    // Returns { ok, asm, diagnostics: [{severity, message, file, line, column}], log, error? }.
    // The bundled include files are upper case (GRAPH.LIB); X1Pen's former compiler found them
    // whatever the case of the name in #INCLUDE, but slangc's file system tells cases apart. Put
    // each bundled file also under the spelling a program uses (#INCLUDE "graph.lib", #include
    // Graph.Lib, #CHAIN likewise).
    var INCLUDE_LINE = /^[ \t]*#(?:INCLUDE|CHAIN)[ \t]+"?([^"\s;]+)"?/gim;
    function provideIncludeSpellings(s, source) {
        var m;
        INCLUDE_LINE.lastIndex = 0;
        while ((m = INCLUDE_LINE.exec(source))) {
            var spelled = m[1];
            var bytes = s.includes[spelled.toUpperCase()];
            if (bytes && /^[A-Za-z0-9_.-]+$/.test(spelled) && !s.includes[spelled]) {
                s.slang.PutFile(VFS_ROOT + '/include/' + spelled, bytes);
            }
        }
    }

    // options: { sourceName } ('PROGRAM.SL')
    async function compile(source, envName, options) {
        var s = requireState();
        env(envName);
        var name = (options && options.sourceName) || 'PROGRAM.SL';
        var path = WORK_DIR + name;
        s.slang.PutFile(path, new TextEncoder().encode(source));
        provideIncludeSpellings(s, source);
        // #INCLUDE looks next to the source, then in the bundle's include/ (as slangc -I)
        var request = { env: envName, libPaths: [VFS_ROOT], includePaths: [VFS_ROOT + '/include'] };
        var r = JSON.parse(s.slang.Compile(path, JSON.stringify(request)));
        var diagnostics = parseLog(r.log);
        if (r.ok) return { ok: true, asm: r.asm, diagnostics: diagnostics, log: r.log || [] };
        var errors = diagnostics.filter(function(d) { return d.severity === 'error'; });
        if (errors.length === 0) {
            diagnostics.push({ severity: 'error', message: r.error || 'SLANG compile failed', file: null, line: null, column: null });
        }
        return { ok: false, diagnostics: diagnostics, log: r.log || [], error: r.error || null };
    }

    async function checkLayout(binLength, workEnd, clearTop) {
        var s = requireState();
        var json = (clearTop === null || clearTop === undefined)
            ? s.hubasic.CheckLayout(binLength, workEnd)
            : s.hubasic.CheckLayoutClear(binLength, workEnd, clearTop);
        return JSON.parse(json);
    }

    function base64ToBytes(text) {
        var bin = atob(text);
        var out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    // A Hu-BASIC format boot disk (x1native_hufs): the program first, in consecutive clusters and
    // write-protected (the IPL reads it as one run of records), then the files in name order.
    // Always built from a blank disk. files: [{ name, kind: 'text'|'bin'|'raw', bytes }], names
    // already checked by X1PenHuBasicFiles. Returns { ok, d88 } or { ok: false, error }.
    async function buildHufsDisk(program, options) {
        var s = requireState();
        var add = [];
        (options.files || []).forEach(function(file, i) {
            var path = WORK_DIR + 'hufs/' + i;
            s.slang.PutFile(path, file.bytes);
            add.push(file.name + '=' + path + (file.kind === 'text' ? ',text' : file.kind === 'bin' ? ',bin' : ''));
        });
        var request = { mainName: options.mainName, add: add };
        if (options.load !== undefined) request.load = options.load;
        if (options.exec !== undefined) request.exec = options.exec;
        var r = JSON.parse(s.slang.BuildHuDisk(program, JSON.stringify(request)));
        if (!r.ok) return { ok: false, error: r.error || 'hufs: the disk could not be built' };
        return { ok: true, d88: base64ToBytes(r.d88) };
    }

    window.X1PenSlangWasm = {
        load: load,
        info: info,
        env: env,
        transpile: transpile,
        compile: compile,
        checkLayout: checkLayout,
        buildHufsDisk: buildHufsDisk,
        _checkManifest: checkManifest,
        _checkBasAbi: checkBasAbi,
        _parseLog: parseLog
    };
})();

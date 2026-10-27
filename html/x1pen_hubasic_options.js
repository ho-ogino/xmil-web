// x1pen_hubasic_options.js — hubasic2sl conversion options for X1Pen's HuBASIC tab
// One global set of options (not per program), kept by x1pen.js in localStorage and passed to
// the converter (x1pen_hubasic.js build) as the wasm Transpile options. Only values that
// differ from hubasic2sl's defaults are passed, so untouched options convert exactly as before.
// The keys are the wasm option names: wait, noLineNumbers, assumeDefint, stringLen, dataBudget.

(function(root) {
    'use strict';

    // hubasic2sl's own defaults (HuTranspileOptions: Wait=None, LineNumbers=true,
    // AssumeDefint=false, StringLen=HuAnalyzer.MaxStringLen, DataBudget=HuAnalyzer.DefaultDataBudget)
    var DEFAULTS = Object.freeze({
        wait: 'none',
        noLineNumbers: false,
        assumeDefint: false,
        stringLen: 255,
        dataBudget: 24576
    });
    var KEYS = Object.keys(DEFAULTS);
    // The runtime takes the wait count in HL (BAS_WLINE, BAS_VSYNC): larger values would wrap
    var MAX_WAIT_COUNT = 65535;
    var MAX_DATA_BUDGET = 65535;

    function isInt(value, min, max) {
        return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
    }

    // 'none' | 'line[:N]' | 'frame[:N]' -> { mode, count }; a missing N is 1, as in the CLI
    function parseWait(value) {
        var m = typeof value === 'string' ? /^(none|line|frame)(?::(\d{1,5}))?$/.exec(value) : null;
        var count = m && m[2] !== undefined ? Number(m[2]) : 1;
        if (!m || (m[1] === 'none' && m[2] !== undefined) || !isInt(count, 1, MAX_WAIT_COUNT)) {
            throw new TypeError('wait must be none, line:N or frame:N (N = 1..' + MAX_WAIT_COUNT + ')');
        }
        return { mode: m[1], count: m[1] === 'none' ? 0 : count };
    }

    function formatWait(mode, count) {
        return mode === 'none' ? 'none' : mode + ':' + count;
    }

    // One option value -> its normalised form; throws a TypeError naming the key
    function checkValue(key, value) {
        switch (key) {
            case 'wait':
                var wait = parseWait(value);
                return formatWait(wait.mode, wait.count);
            case 'noLineNumbers':
            case 'assumeDefint':
                if (typeof value !== 'boolean') throw new TypeError(key + ' must be true or false');
                return value;
            case 'stringLen':
                if (!isInt(value, 1, 255)) throw new TypeError('stringLen must be an integer 1..255');
                return value;
            case 'dataBudget':
                if (!isInt(value, 1, MAX_DATA_BUDGET)) throw new TypeError('dataBudget must be an integer 1..' + MAX_DATA_BUDGET);
                return value;
            default:
                throw new TypeError('unknown HuBASIC option: ' + key);
        }
    }

    // current options + a patch -> new full options. A null value resets that key to its default.
    // Throws a TypeError for an unknown key or a bad value; current is never changed.
    function apply(current, patch) {
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
            throw new TypeError('HuBASIC options must be an object');
        }
        var next = {};
        KEYS.forEach(function(key) { next[key] = current[key]; });
        Object.keys(patch).forEach(function(key) {
            if (KEYS.indexOf(key) < 0) throw new TypeError('unknown HuBASIC option: ' + key);
            next[key] = patch[key] === null ? DEFAULTS[key] : checkValue(key, patch[key]);
        });
        return next;
    }

    function defaults() {
        return apply(DEFAULTS, {});
    }

    // Saved options (any JSON value) -> full options. Bad or unknown fields fall back to the
    // defaults one by one; never throws.
    function fromStored(saved) {
        var options = defaults();
        if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return options;
        KEYS.forEach(function(key) {
            if (!Object.prototype.hasOwnProperty.call(saved, key)) return;
            try {
                options[key] = checkValue(key, saved[key]);
            } catch (e) {
                // keep the default
            }
        });
        return options;
    }

    // Only the options that differ from the defaults: what is saved and passed to Transpile
    function changed(options) {
        var out = {};
        KEYS.forEach(function(key) {
            if (options[key] !== DEFAULTS[key]) out[key] = options[key];
        });
        return out;
    }

    function isDefault(options) {
        return Object.keys(changed(options)).length === 0;
    }

    root.X1PenHuBasicOptions = Object.freeze({
        DEFAULTS: DEFAULTS,
        MAX_WAIT_COUNT: MAX_WAIT_COUNT,
        MAX_DATA_BUDGET: MAX_DATA_BUDGET,
        defaults: defaults,
        parseWait: parseWait,
        formatWait: formatWait,
        apply: apply,
        fromStored: fromStored,
        changed: changed,
        isDefault: isDefault
    });
})(typeof window !== 'undefined' ? window : this);

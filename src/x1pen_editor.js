// x1pen_editor.js — CodeMirror 6 wrapper for X1Pen
// Bundled via esbuild into html/x1pen_editor.bundle.js

import { EditorView, keymap, placeholder as cmPlaceholder, lineNumbers } from '@codemirror/view';
import { EditorState, Annotation } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { bracketMatching } from '@codemirror/language';

// Annotation to suppress onChange callback (e.g. share load)
const silentAnnotation = Annotation.define();

// Tab → 2 spaces (matches existing textarea behavior)
const tabToSpaces = keymap.of([{
    key: 'Tab',
    run: (view) => {
        view.dispatch(view.state.replaceSelection('  '));
        return true;
    }
}]);

// Dark theme matching existing X1Pen editor colors
const x1penTheme = EditorView.theme({
    '&': {
        backgroundColor: '#0d1117',
        color: '#c9d1d9',
        fontSize: '14px',
        fontFamily: "'Courier New', monospace",
        lineHeight: '1.5',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-content': { padding: '12px 12px 12px 4px', caretColor: '#c9d1d9' },
    '.cm-gutters': {
        backgroundColor: '#0d1117',
        color: '#484f58',
        border: 'none',
        minWidth: '36px',
    },
    '.cm-activeLineGutter': { backgroundColor: '#161b22' },
    '.cm-activeLine': { backgroundColor: '#161b22' },
    '.cm-cursor': { borderLeftColor: '#c9d1d9' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
        backgroundColor: '#264f78 !important'
    },
    '.cm-searchMatch': { backgroundColor: '#3a5a1e', outline: '1px solid #5a8a2e' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#264f78' },
    '.cm-placeholder': { color: '#484f58' },
    // Search panel
    '.cm-panels': { backgroundColor: '#16213e', color: '#c9d1d9' },
    '.cm-panels input': {
        backgroundColor: '#0d1117', color: '#c9d1d9',
        border: '1px solid #0f3460', borderRadius: '3px',
        fontFamily: "'Courier New', monospace",
    },
    '.cm-panels button': {
        backgroundColor: '#1a1a2e', color: '#c9d1d9',
        border: '1px solid #0f3460', borderRadius: '3px',
        cursor: 'pointer',
    },
}, { dark: true });

/**
 * Create a CodeMirror editor instance
 * @param {HTMLElement} container - mount target
 * @param {Object} opts
 * @param {string} [opts.placeholder] - placeholder text
 * @param {function(string)} [opts.onChange] - called on content change (suppressed by silent)
 * @param {function()} [opts.onFocus] - called on focus
 * @param {function()} [opts.onBlur] - called on blur
 * @returns editor wrapper object
 */
function createEditor(container, opts) {
    opts = opts || {};

    var extensions = [
        lineNumbers(),
        history(),
        bracketMatching(),
        highlightSelectionMatches(),
        tabToSpaces,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        x1penTheme,
        EditorView.lineWrapping,
    ];

    if (opts.placeholder) {
        extensions.push(cmPlaceholder(opts.placeholder));
    }

    // onChange listener (skip silent dispatches)
    if (opts.onChange) {
        extensions.push(EditorView.updateListener.of(function(update) {
            if (!update.docChanged) return;
            // Check if any transaction has silent annotation
            for (var i = 0; i < update.transactions.length; i++) {
                if (update.transactions[i].annotation(silentAnnotation)) return;
            }
            opts.onChange(update.state.doc.toString());
        }));
    }

    // focus/blur listeners
    if (opts.onFocus || opts.onBlur) {
        extensions.push(EditorView.updateListener.of(function(update) {
            if (!update.focusChanged) return;
            if (update.view.hasFocus) {
                if (opts.onFocus) opts.onFocus();
            } else {
                if (opts.onBlur) opts.onBlur();
            }
        }));
    }

    var view = new EditorView({
        state: EditorState.create({ doc: '', extensions: extensions }),
        parent: container,
    });

    return {
        getValue: function() {
            return view.state.doc.toString();
        },
        setValue: function(text, setOpts) {
            var annotations = (setOpts && setOpts.silent) ? [silentAnnotation.of(true)] : [];
            view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: text || '' },
                annotations: annotations,
            });
        },
        insertAt: function(pos, text) {
            view.dispatch({ changes: { from: pos, insert: text } });
        },
        replaceSelection: function(text) {
            view.dispatch(view.state.replaceSelection(text));
        },
        getCursor: function() {
            return view.state.selection.main.head;
        },
        getSelection: function() {
            var sel = view.state.selection.main;
            return { from: sel.from, to: sel.to };
        },
        setCursor: function(pos) {
            view.dispatch({ selection: { anchor: pos } });
        },
        getCharAt: function(pos) {
            return view.state.doc.sliceString(pos, pos + 1);
        },
        focus: function() {
            view.focus();
        },
        dom: view.dom,
        view: view,
    };
}

// Public API
window.X1PenEditor = { create: createEditor };

// x1pen_editor.js — CodeMirror 6 wrapper for X1Pen
// Bundled via esbuild into html/x1pen_editor.bundle.js

import { EditorView, keymap, placeholder as cmPlaceholder, lineNumbers } from '@codemirror/view';
import { EditorState, Annotation } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentMore, indentLess } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { bracketMatching, HighlightStyle, syntaxHighlighting, indentUnit } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { fuzzyBasicLanguage, basicAutoLineNumber } from './x1pen_basic_lang.js';
import { z80AsmLanguage } from './x1pen_asm_lang.js';

// Annotation to suppress onChange callback (e.g. share load)
const silentAnnotation = Annotation.define();

// Tab: block indent if selection spans multiple lines, otherwise align to 4-space tab stop
// Shift-Tab: block unindent
const tabHandlers = keymap.of([{
    key: 'Tab',
    run: (view) => {
        var sel = view.state.selection.main;
        if (sel.from !== sel.to) {
            var fromLine = view.state.doc.lineAt(sel.from).number;
            var toLine = view.state.doc.lineAt(sel.to).number;
            if (fromLine !== toLine) {
                // Multi-line selection → block indent
                return indentMore(view);
            }
        }
        // No selection → insert spaces to next tab stop
        var line = view.state.doc.lineAt(sel.head);
        var col = sel.head - line.from;
        var spaces = 4 - (col % 4) || 4;
        view.dispatch(view.state.replaceSelection(' '.repeat(spaces)));
        return true;
    }
}, {
    key: 'Shift-Tab',
    run: indentLess
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

// Syntax highlight colors
const x1penHighlight = HighlightStyle.define([
    { tag: tags.keyword,      color: '#c678dd' },  // purple (mnemonics/BASIC keywords)
    { tag: tags.typeName,     color: '#61afef' },  // blue (ASM pseudo-instructions)
    { tag: tags.variableName, color: '#e5c07b' },  // yellow (registers)
    { tag: tags.labelName,    color: '#e5c07b' },  // yellow (labels)
    { tag: tags.string,       color: '#98c379' },  // green
    { tag: tags.comment,      color: '#5c6370', fontStyle: 'italic' },
    { tag: tags.number,       color: '#d19a66' },  // orange
    { tag: tags.operator,     color: '#56b6c2' },  // cyan
]);

// Language map
const LANGUAGES = {
    'basic': fuzzyBasicLanguage,
    'asm': z80AsmLanguage,
};

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

    var extensions = [];

    // Line numbers (opt-out for BASIC tab)
    if (opts.showLineNumbers !== false) {
        extensions.push(lineNumbers());
    }

    // BASIC AUTO line number (must be before defaultKeymap to take priority)
    if (opts.language === 'basic') {
        extensions.push(keymap.of([{ key: 'Enter', run: basicAutoLineNumber }]));
    }

    extensions.push(
        indentUnit.of('    '),
        history(),
        bracketMatching(),
        highlightSelectionMatches(),
        tabHandlers,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        x1penTheme,
        syntaxHighlighting(x1penHighlight),
        EditorView.lineWrapping,
    );

    // Language support
    if (opts.language && LANGUAGES[opts.language]) {
        extensions.push(LANGUAGES[opts.language]);
    }

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

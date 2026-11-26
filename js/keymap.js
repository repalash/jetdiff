// The editors' keymaps. The JetBrains one is ported from the IntelliJ IDEA Keybindings extension for VS Code
// (github.com/kasecato/vscode-intellij-idea-keybindings 1.7.8, contributes.keybindings in its package.json),
// Copyright (c) 2017 - present Keisuke Kato, MIT License (its notice is in NOTICE): the entries whose command Monaco's
// editor has, with its macOS keys on a Mac and its Windows/Linux keys elsewhere. 'vscode' is Monaco's own bindings.

// as Monaco tells macOS (its KeyMod.CtrlCmd is ⌘ there)
export const MAC = /Macintosh/.test(globalThis.navigator?.userAgent || '')

export const KEYMAPS = {jetbrains: 'JetBrains', vscode: 'VS Code'}
export const DEFAULT_KEYMAP = 'jetbrains'

// the app's own commands (main.js runs them)
export const DECLARATION = 'jd.goToDeclaration'
export const BACK = 'jd.back'
export const FORWARD = 'jd.forward'

// [command, macOS key, Windows/Linux key, when]. Editing commands keep `editorTextFocus` alone: in a read-only editor
// they do nothing, and the key does not fall through to the browser (⌘D would bookmark the page).
const JETBRAINS = [
    ['editor.action.copyLinesDownAction', 'cmd+d', 'ctrl+d', 'editorTextFocus && !editorHasSelection'],
    ['editor.action.duplicateSelection', 'cmd+d', 'ctrl+d', 'editorTextFocus && editorHasSelection'],
    ['editor.action.deleteLines', 'cmd+backspace', 'ctrl+y'],
    ['editor.action.moveLinesUpAction', 'shift+alt+up', 'shift+alt+up'],
    ['editor.action.moveLinesDownAction', 'shift+alt+down', 'shift+alt+down'],
    ['editor.action.moveLinesUpAction', null, 'shift+ctrl+up'],
    ['editor.action.moveLinesDownAction', null, 'shift+ctrl+down'],
    ['editor.action.commentLine', 'cmd+/', 'ctrl+/'],
    ['editor.action.commentLine', 'cmd+numpad_divide', 'ctrl+numpad_divide'],
    ['editor.action.blockComment', 'cmd+alt+/', 'ctrl+shift+/'],
    ['editor.action.blockComment', 'cmd+alt+numpad_divide', 'ctrl+shift+numpad_divide'],
    ['editor.action.joinLines', 'ctrl+shift+j', 'ctrl+shift+j'],
    ['lineBreakInsert', 'cmd+enter', 'ctrl+enter'],
    ['editor.action.insertLineAfter', 'shift+enter', 'shift+enter'],
    ['editor.action.insertLineAfter', 'shift+cmd+enter', 'shift+ctrl+enter'],
    ['editor.action.insertLineBefore', 'alt+cmd+enter', 'alt+ctrl+enter'],
    ['editor.action.clipboardCutAction', 'cmd+delete', 'shift+delete'],
    ['editor.action.changeAll', 'shift+f6', 'shift+f6'],
    ['editor.action.smartSelect.expand', 'alt+up', 'ctrl+w'],
    ['editor.action.smartSelect.shrink', 'alt+down', 'ctrl+shift+w'],
    ['editor.action.addSelectionToNextFindMatch', 'ctrl+g', 'alt+j', 'editorFocus'],
    ['cursorUndo', 'ctrl+shift+g', 'alt+shift+j'],
    ['editor.action.selectHighlights', 'ctrl+cmd+g', 'ctrl+shift+alt+j', 'editorFocus'],
    ['editor.action.gotoLine', 'cmd+l', 'ctrl+g'],
    ['editor.action.startFindReplaceAction', 'cmd+r', 'ctrl+r', 'editorFocus'],
    ['editor.action.jumpToBracket', 'ctrl+m', 'ctrl+shift+m'],
    ['editor.action.showHover', 'ctrl+j', 'ctrl+q'],
    ['editor.action.showHover', 'f1', null],
    // not in the extension, as VS Code has them already: IntelliJ's redo (Ctrl+Y deletes a line there)
    ['redo', 'cmd+shift+z', 'ctrl+shift+z'],
    [DECLARATION, 'cmd+b', 'ctrl+b'],
    [DECLARATION, 'f4', 'f4'],
    [BACK, 'cmd+[', 'ctrl+alt+left'],
    [BACK, 'cmd+alt+left', null],
    [FORWARD, 'cmd+]', 'ctrl+alt+right'],
    [FORWARD, 'cmd+alt+right', null],
]

// Monaco's own bindings on the keys above, removed so that a key never does both: [command, macOS key, other key],
// with the keys of Windows and of Linux (Monaco's defaults differ between them). Those of widgets (the find and
// replace fields, suggestions, hovers) stay: they apply only while the widget has the focus.
const JETBRAINS_REMOVED = [
    ['editor.action.addSelectionToNextFindMatch', 'cmd+d', 'ctrl+d'],
    ['deleteAllLeft', 'cmd+backspace', null],
    ['deleteAllRight', 'cmd+delete', null],
    ['redo', null, 'ctrl+y'],
    ['editor.action.copyLinesUpAction', 'shift+alt+up', 'shift+alt+up'],
    ['editor.action.copyLinesDownAction', 'shift+alt+down', 'shift+alt+down'],
    ['editor.action.insertCursorAbove', null, 'shift+alt+up'],
    ['editor.action.insertCursorBelow', null, 'shift+alt+down'],
    ['editor.action.insertCursorAbove', null, 'shift+ctrl+up'],
    ['editor.action.insertCursorBelow', null, 'shift+ctrl+down'],
    ['cursorUpSelect', null, 'shift+ctrl+up'],
    ['cursorDownSelect', null, 'shift+ctrl+down'],
    ['editor.action.moveLinesUpAction', 'alt+up', null],
    ['editor.action.moveLinesDownAction', 'alt+down', null],
    ['editor.action.insertLineAfter', 'cmd+enter', 'ctrl+enter'],
    ['editor.action.insertLineBefore', 'shift+cmd+enter', 'shift+ctrl+enter'],
    ['editor.action.joinLines', 'ctrl+j', null],
    ['editor.action.gotoLine', 'ctrl+g', null],
    ['expandLineSelection', 'cmd+l', null],
    ['editor.action.outdentLines', 'cmd+[', null],
    ['editor.action.indentLines', 'cmd+]', null],
    ['editor.action.quickCommand', 'f1', null],
]

const VSCODE = [
    // Monaco's F12 needs a definition provider, which jetdiff's languages have not
    [DECLARATION, 'f12', 'f12'],
]
const VSCODE_REMOVED = [['editor.action.revealDefinition', 'f12', 'f12']]

const KEYS = {jetbrains: [JETBRAINS, JETBRAINS_REMOVED], vscode: [VSCODE, VSCODE_REMOVED]}

const NAMED = {
    up: 'UpArrow', down: 'DownArrow', left: 'LeftArrow', right: 'RightArrow', enter: 'Enter', backspace: 'Backspace',
    delete: 'Delete', escape: 'Escape', tab: 'Tab', space: 'Space', home: 'Home', end: 'End', '/': 'Slash',
    '[': 'BracketLeft', ']': 'BracketRight', '=': 'Equal', '-': 'Minus', '.': 'Period', ',': 'Comma', ';': 'Semicolon',
    '\\': 'Backslash', '`': 'Backquote', "'": 'Quote', numpad_divide: 'NumpadDivide',
}

/** Monaco's number for a key like 'cmd+shift+z' ('ctrl' is Control on a Mac, ⌘ is 'cmd'). */
function keybinding(monaco, key) {
    const {KeyMod, KeyCode} = monaco
    let n = 0
    for (const part of key.split('+')) {
        if (part === 'cmd') n |= KeyMod.CtrlCmd
        else if (part === 'ctrl') n |= MAC ? KeyMod.WinCtrl : KeyMod.CtrlCmd
        else if (part === 'alt') n |= KeyMod.Alt
        else if (part === 'shift') n |= KeyMod.Shift
        else {
            const name = NAMED[part] || (/^[a-z]$/.test(part) ? 'Key' + part.toUpperCase() : /^\d$/.test(part) ? 'Digit' + part : part.toUpperCase())
            if (KeyCode[name] === undefined) throw new Error(`No key ${part}`)
            n |= KeyCode[name]
        }
    }
    return n
}

const SYMBOLS = {cmd: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧', up: '↑', down: '↓', left: '←', right: '→', enter: '↩', backspace: '⌫', delete: '⌦'}
const WORDS = {up: '↑', down: '↓', left: '←', right: '→', backspace: 'Backspace', delete: 'Delete', enter: 'Enter'}

/** How a key reads in the app's hints: ⌘⇧Z on a Mac, Ctrl+Shift+Z elsewhere. */
export function keyLabel(key) {
    const parts = key.split('+')
    if (MAC) return parts.map((p) => SYMBOLS[p] || p.toUpperCase()).join('')
    return parts.map((p) => WORDS[p] || (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1))).join('+')
}

/** The first key of `command` in a keymap on this platform, as it reads, or ''. */
export function shortcut(name, command) {
    const row = KEYS[name]?.[0].find((r) => r[0] === command && r[MAC ? 1 : 2])
    return row ? keyLabel(row[MAC ? 1 : 2]) : ''
}

let rules = null

/** Sets the editors' keymap (all Monaco editors share their keybindings). */
export function setKeymap(monaco, name) {
    rules?.dispose()
    const [add, removed] = KEYS[name] || KEYS[DEFAULT_KEYMAP]
    const key = (row) => row[MAC ? 1 : 2]
    rules = monaco.editor.addKeybindingRules([
        ...removed.filter(key).map((row) => ({keybinding: keybinding(monaco, key(row)), command: '-' + row[0]})),
        ...add.filter(key).map((row) => ({keybinding: keybinding(monaco, key(row)), command: row[0], when: row[3] || 'editorTextFocus'})),
    ])
}

/** Registers the app's commands: `run` maps DECLARATION, BACK and FORWARD to what they do. */
export function registerAppCommands(monaco, run) {
    for (const [id, fn] of Object.entries(run)) monaco.editor.registerCommand(id, () => fn())
}

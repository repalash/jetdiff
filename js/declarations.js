// Go to Declaration by symbol search: where a name is declared in a file's text, by simple per-language patterns of
// declarations (`function x`, `class x`, `def x`, `const x =`, `fn x`, `func x`, a C type before `x(`…). A name used as
// a key (`x:` in an object literal) or assigned again (`x = 1`) is not a declaration.

import {commentsOf} from './editor.js'

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// `W` stands for the name (a capture group): patterns are sources of regular expressions, matched on each line
const JS_MODS = '(?:(?:export|default|declare|public|private|protected|static|readonly|abstract|override|async|get|set|accessor)\\s+)'
const JS = [
    '\\b(?:function\\*?|class|interface|type|enum|namespace|module|const|let|var)\\s+W(?![\\w$])',
    // a destructured name: const {a, W} = …
    '\\b(?:const|let|var)\\s+[{[][^=]*?(?<![\\w$.:])W(?![\\w$])(?!\\s*:)[^=]*[}\\]]\\s*=',
    // a method (its parameters, then its body: a call's arguments rarely end in {), a member with a modifier; an
    // interface member ends with ;
    '^\\s*\\*?#?W\\s*(?:<[^>]*>)?\\s*\\([^()]*\\)\\s*(?::\\s*[^=;{]+)?\\{\\s*\\}?\\s*$',
    `^\\s*${JS_MODS}+\\*?#?W\\s*(?:<[^>]*>)?\\s*\\(`,
    `^\\s*${JS_MODS}+#?W\\s*[?!]?\\s*[:=]`,
    '^\\s*#?W\\s*\\??\\s*:[^,]*;\\s*$',
    '\\bexports\\.W\\s*=(?!=)',
]
const PYTHON = ['^\\s*(?:async\\s+)?def\\s+W\\b', '^\\s*class\\s+W\\b', '^W\\s*(?::[^=]+)?=(?!=)']
const RUBY = ['^\\s*def\\s+(?:self\\.)?W\\b', '^\\s*(?:class|module)\\s+(?:\\w+::)*W\\b', '^\\s*W\\s*=(?![=~])', '^\\s*attr_(?:reader|writer|accessor)\\b.*:W\\b']
const GO = ['^func\\s+(?:\\([^)]*\\)\\s*)?W\\b', '\\b(?:type|var|const)\\s+W\\b', '^\\s*(?:\\w+\\s*,\\s*)*W(?:\\s*,\\s*\\w+)*\\s*:=',
    // struct fields and the specs of a grouped var, const or type
    '^\\s+W\\s+[\\w*\\[.]']
const RUST = ['\\b(?:fn|struct|enum|trait|type|mod|const|static|union|macro_rules!)\\s+W\\b', '\\blet\\s+(?:mut\\s+)?W\\b', '^\\s*pub(?:\\([^)]*\\))?\\s+W\\s*:']
// C, C++, Objective-C, the shading languages, Java, C#, Dart: a type before the name. The words of a statement
// (return x;) are not a type: see C_STATEMENT.
const C_TYPE = '^\\s*(?:[\\w:<>,*&\\[\\]]+\\s+)+[*&]*'
const C = ['#\\s*define\\s+W\\b',
    '\\b(?:struct|class|union|enum(?:\\s+class)?|namespace|interface|record|typedef\\s+struct)\\s+W\\b',
    '\\btypedef\\b.*\\bW\\s*;',
    `${C_TYPE}W\\s*\\(`,
    `${C_TYPE}W\\s*(?:=(?!=)|;|\\[|,|\\{|$)`]
const C_STATEMENT = /^\s*(?:return|else|case|new|delete|throw|goto|yield|await|co_return|co_yield|sizeof|typeof|import|package)\b/
const KOTLIN = ['\\b(?:fun|val|var|class|interface|object|typealias|enum\\s+class)\\s+(?:[\\w.<>]+\\.)?W\\b']
const SWIFT = ['\\b(?:func|var|let|class|struct|enum|protocol|extension|typealias|actor)\\s+W\\b']
const SCALA = ['\\b(?:def|val|var|class|object|trait|type|enum|given)\\s+W\\b']
const PHP = ['\\bfunction\\s+&?W\\b', '\\b(?:class|interface|trait|enum)\\s+W\\b', '\\bconst\\s+W\\b']
const LUA = ['\\bfunction\\s+(?:[\\w.]+[.:])?W\\b', '\\blocal\\s+(?:function\\s+)?W\\b', '^\\s*(?:[\\w.]+\\.)?W\\s*=\\s*function\\b', '^W\\s*=(?!=)']
const SHELL = ['^\\s*(?:function\\s+)?W\\s*\\(\\s*\\)', '\\bfunction\\s+W\\b', '^\\s*(?:export\\s+|local\\s+|readonly\\s+|declare\\s+(?:-\\w+\\s+)?)?W=']
const ELIXIR = ['\\b(?:def|defp|defmacro|defmacrop|defguard|defdelegate|defmodule|defstruct|defprotocol|defimpl)\\s+(?:[\\w.]+\\.)?W\\b']
const HASKELL = ['^W\\s*::', '^(?:data|type|newtype|class)\\s+W\\b']
const ERLANG = ['^W\\s*\\(', '-(?:define|record|type)\\(\\s*W\\b']
const CLOJURE = ['\\((?:def|defn-?|defmacro|defmulti|defprotocol|defrecord|deftype|defonce)\\s+W(?![\\w-])']
const CSS = ['^\\s*\\$W\\s*:', '^\\s*@W\\s*:', '@(?:mixin|function)\\s+W\\b', '(?:^|[\\s;{])W\\s*:(?!:)']
const SQL = ['\\bcreate\\s+(?:or\\s+replace\\s+)?(?:temp(?:orary)?\\s+)?(?:table|view|materialized\\s+view|function|procedure|index|type|trigger|sequence|schema)\\s+(?:if\\s+not\\s+exists\\s+)?(?:[\\w"`]+\\.)?["`]?W\\b']
const MAKE = ['^W\\s*:(?!=)', '^W\\s*[:?+]?=', '^define\\s+W\\b']
const CMAKE = ['\\b(?:function|macro)\\s*\\(\\s*W\\b', '\\bset\\s*\\(\\s*W\\b']
const NIX = ['^\\s*W\\s*=(?!=)']
const GRAPHQL = ['\\b(?:type|input|enum|interface|union|scalar|fragment|query|mutation|subscription|extend\\s+type)\\s+W\\b', '\\bdirective\\s+@W\\b']
const PROTO = ['\\b(?:message|enum|service|rpc)\\s+W\\b']
const R = ['^\\s*W\\s*(?:<-|=)\\s*function\\b']
const GENERIC = ['\\b(?:function|func|fn|def|class|struct|interface|enum|type|const|let|var|val|module|trait|macro|proc|sub)\\s+W\\b']

/** Patterns by Shiki language id; others get GENERIC. */
const PATTERNS = {}
const set = (ids, p) => { for (const id of ids.split(' ')) PATTERNS[id] = p }
set('typescript tsx javascript jsx vue svelte astro', JS)
set('python', PYTHON)
set('ruby', RUBY)
set('go', GO)
set('rust', RUST)
set('c cpp objective-c objective-cpp glsl hlsl wgsl java csharp dart groovy', C)
set('kotlin', KOTLIN)
set('swift', SWIFT)
set('scala', SCALA)
set('php', PHP)
set('lua', LUA)
set('shellscript fish', SHELL)
set('elixir', ELIXIR)
set('haskell', HASKELL)
set('erlang', ERLANG)
set('clojure', CLOJURE)
set('css scss sass less stylus', CSS)
set('sql plsql', SQL)
set('make', MAKE)
set('cmake', CMAKE)
set('nix', NIX)
set('graphql', GRAPHQL)
set('proto', PROTO)
set('r', R)

// Files that declare names for each other: a name in one is looked for in the others
const FAMILIES = [
    'typescript tsx javascript jsx vue svelte astro mdx', 'c cpp objective-c objective-cpp', 'glsl hlsl wgsl',
    'java kotlin scala groovy', 'css scss sass less stylus', 'shellscript fish', 'sql plsql',
]
const FAMILY = new Map(FAMILIES.flatMap((f) => f.split(' ').map((id) => [id, f])))

/** The languages whose files may declare a name used in a file of language `id`. */
export function familyOf(id) {
    return FAMILY.get(id)?.split(' ') || [id]
}

const compiled = new Map()
/** The patterns of a language for a name: [{re, typed}], `typed` when a C type comes first (see C_STATEMENT). */
function regexes(id, word) {
    const key = id + '\0' + word
    if (!compiled.has(key)) {
        const flags = id === 'sql' || id === 'plsql' ? 'di' : 'd'
        compiled.set(key, (PATTERNS[id] || GENERIC).map((p) => ({re: new RegExp(p.replaceAll('W', `(${esc(word)})`), flags), typed: p.startsWith(C_TYPE)})))
    }
    return compiled.get(key)
}

/** Whether a name is worth looking for: a word, not a number. */
export const isName = (word) => !!word && /^[\p{L}_$-][\p{L}\p{N}_$-]*$/u.test(word) && !/^-*$/.test(word)

/**
 * Where `word` is declared in `text` (a file in the Shiki language `id`): [{line, column, text}], 1-based, the column of
 * the name. Lines that are comments are skipped.
 */
export function findDeclarations(text, word, id) {
    const res = regexes(id, word)
    const comment = commentsOf(id)?.lineComment
    const out = []
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.length > 2000 || !line.includes(word)) continue
        const t = line.trimStart()
        if ((comment && t.startsWith(comment)) || /^\*(?!\*)|^\/\*/.test(t)) continue
        for (const {re, typed} of res) {
            const m = re.exec(line)
            if (!m || (typed && C_STATEMENT.test(line))) continue
            out.push({line: i + 1, column: m.indices[1][0] + 1, text: line.trim()})
            break
        }
    }
    return out
}

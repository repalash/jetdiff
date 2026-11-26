// A classic script, in syntax old browsers read, run before the app: a browser too old for the app (an ES module that
// imports by an import map, with regular expressions that look behind: Safari 16.4) would show a blank page otherwise.
(function () {
    var ok
    try { ok = new RegExp('(?<=a)b').test('ab') } catch (e) { ok = false }
    if (ok && HTMLScriptElement.supports) ok = HTMLScriptElement.supports('importmap')
    if (!ok) document.getElementById('unsupported').hidden = false
})()

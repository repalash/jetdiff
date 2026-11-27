// 404.html: jetdiff.com/owner/repo/pull/1 (a GitHub link with the host swapped) opens as ?pr=owner/repo/1; any other
// path opens the start page, which says it is no such link (?path=)
import {parseTarget, targetToParams} from './github.js'

const target = parseTarget('https://github.com' + location.pathname)
location.replace('/?' + (target ? targetToParams(target) : new URLSearchParams({path: location.pathname})))

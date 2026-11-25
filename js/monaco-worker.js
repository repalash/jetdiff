// Keep the version in step with MONACO_VERSION in editor.js. It is not read from this URL's query: offline, the saved
// copy can answer without the query string, and a worker's location is its response's URL.
const base = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/'
self.MonacoEnvironment = {baseUrl: base}
importScripts(base + 'vs/base/worker/workerMain.js')

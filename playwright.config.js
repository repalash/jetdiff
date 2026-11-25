import {defineConfig, devices} from '@playwright/test'

// service worker requests go through the tests' routes too (tests/offline.spec.js)
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1'

const port = 4173

export default defineConfig({
    testDir: 'tests',
    fullyParallel: true,
    retries: process.env.CI ? 1 : 0,
    use: {baseURL: `http://localhost:${port}/`, serviceWorkers: 'block', trace: 'off'},
    projects: [
        {name: 'desktop', use: {viewport: {width: 1440, height: 900}}, grepInvert: /@phone/},
        {name: 'phone', use: {...devices['iPhone 13'], browserName: 'chromium'}, grep: /@phone/},
    ],
    webServer: {command: 'node tools/serve.mjs', env: {PORT: String(port)}, port, reuseExistingServer: !process.env.CI},
})

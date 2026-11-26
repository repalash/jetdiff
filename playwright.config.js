import {defineConfig, devices} from '@playwright/test'

// service worker requests go through the tests' routes too (tests/offline.spec.js)
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1'

const port = +(process.env.TEST_PORT || 4173)

export default defineConfig({
    testDir: 'tests',
    fullyParallel: true,
    retries: process.env.CI ? 1 : 0,
    use: {baseURL: `http://localhost:${port}/`, serviceWorkers: 'block', trace: 'off'},
    projects: [
        {name: 'desktop', use: {viewport: {width: 1440, height: 900}}, grepInvert: /@phone/},
        {name: 'phone', use: {...devices['iPhone 13'], browserName: 'chromium'}, grep: /@phone/},
    ],
    // the Worker and Cloudflare's static asset server, as wrangler dev runs them (it builds dist/ first), without Sign in
    // with GitHub, whatever secret .dev.vars holds: the tests that sign in answer /auth/ themselves
    webServer: {
        command: `npx wrangler dev --ip 127.0.0.1 --port ${port} --var GITHUB_CLIENT_ID: --var GITHUB_APP_SLUG:`,
        port,
        reuseExistingServer: !process.env.CI,
    },
})

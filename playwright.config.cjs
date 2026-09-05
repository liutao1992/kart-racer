const { defineConfig } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const cachedChrome = fs.existsSync(cache) ? fs.readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort().reverse().map(name => path.join(cache, name, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')).find(file => fs.existsSync(file)) : undefined;
module.exports = defineConfig({
  testDir: './tests/e2e', timeout: 180000, workers: 1, retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    viewport: { width: 1440, height: 960 },
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.BREEZE_BROWSER_PATH || cachedChrome },
    baseURL: 'http://127.0.0.1:5190'
  },
  webServer: { command: 'node scripts/serve.cjs', url: 'http://127.0.0.1:5190', reuseExistingServer: true, timeout: 15000 }
});

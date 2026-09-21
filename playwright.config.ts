import { defineConfig, devices } from '@playwright/test';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
export default defineConfig({ testDir: './tests', fullyParallel: true, reporter: 'list', use: { baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3100', trace: 'retain-on-failure', launchOptions: { executablePath } }, projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: {width:1440,height:1000} } }, { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType:'chromium' } }] });

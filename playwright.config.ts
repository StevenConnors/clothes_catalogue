import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';
config({ path: '.env.local' });
export default defineConfig({
 testDir: './tests/e2e', workers: 1, fullyParallel: false,
 globalSetup: './tests/e2e/prerequisites.ts',
 use: { baseURL: process.env.E2E_BASE_URL || 'http://localhost:3100', trace: 'retain-on-failure' },
 projects: [{ name:'phone', use:{...devices['iPhone 13']} },{name:'desktop', use:{...devices['Desktop Chrome']}}],
});

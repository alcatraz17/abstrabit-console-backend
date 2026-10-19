import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    globalSetup: ['tests/helpers/global-setup.js'],
    fileParallelism: false,
    testTimeout: 15_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      APP_URL: 'http://localhost:5173',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://app:app@127.0.0.1:54329/abstrabit_console_test',
      SESSION_SECRET: 'test-session-secret-0123456789abcdef',
      ENCRYPTION_KEY: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
      DISCORD_APPLICATION_ID: '100000000000000001',
      DISCORD_PUBLIC_KEY: 'ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c',
      DISCORD_BOT_TOKEN: 'test-bot-token-0123456789',
      CRON_SECRET: 'test-cron-secret-0123456789abcdef0123',
      GROQ_API_KEY: '',
    },
  },
});

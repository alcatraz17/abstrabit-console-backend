import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../../src/config/env.js';
import { normalizeAiResult } from '../../../src/modules/ai/ai.service.js';

const valid = {
  APP_URL: 'https://console.example.com',
  DATABASE_URL: 'postgres://app:app@127.0.0.1:5432/app',
  SESSION_SECRET: 's'.repeat(32),
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  DISCORD_APPLICATION_ID: '123456789012345678',
  DISCORD_PUBLIC_KEY: 'a'.repeat(64),
  DISCORD_BOT_TOKEN: 'x'.repeat(60),
  CRON_SECRET: 'c'.repeat(32),
};

describe('environment loading', () => {
  it('applies defaults and supports rotating session secrets', () => {
    const env = loadEnv({
      ...valid,
      SESSION_SECRET: `${'n'.repeat(32)}, ${'o'.repeat(32)}`,
      GROQ_API_KEY: '',
    });
    expect(env.PORT).toBe(3000);
    expect(env.SESSION_SECRET).toHaveLength(2);
    expect(env.GROQ_API_KEY).toBeUndefined();
  });

  it('lists every problem without echoing secret values', () => {
    const attempt = () =>
      loadEnv({ ...valid, DISCORD_BOT_TOKEN: 'short-secret', ENCRYPTION_KEY: 'c2hvcnQ=' });
    expect(attempt).toThrow(/DISCORD_BOT_TOKEN/);
    expect(attempt).toThrow(/ENCRYPTION_KEY/);
    expect(attempt).not.toThrow(/short-secret/);
  });
});

describe('AI result normalisation', () => {
  it('keeps only known tags and severities and caps the summary', () => {
    expect(
      normalizeAiResult({
        summary: 'x'.repeat(200),
        tags: ['Outage', 'outage', 'made-up', 'billing'],
        severity: 'critical',
      }),
    ).toEqual({
      summary: `${'x'.repeat(139)}…`,
      tags: ['outage', 'billing'],
      severitySuggestion: null,
    });
  });

  it('rejects malformed model output', () => {
    expect(normalizeAiResult(null)).toBeNull();
    expect(normalizeAiResult({ tags: [] })).toBeNull();
    expect(normalizeAiResult({ summary: '   ' })).toBeNull();
  });
});

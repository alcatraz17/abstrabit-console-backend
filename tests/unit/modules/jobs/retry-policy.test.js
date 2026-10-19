import { describe, expect, it } from 'vitest';
import {
  deadlineFor,
  retryDelayMs,
  shouldGiveUp,
  usesInteractionToken,
} from '../../../../src/modules/jobs/retry-policy.js';

describe('retry policy', () => {
  it('retries once inline, then backs off through the sweeper', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((attempt) => retryDelayMs(attempt))).toEqual([
      2000, 60_000, 120_000, 240_000, 480_000, 600_000, 600_000,
    ]);
  });

  it('honours Retry-After and ignores invalid input', () => {
    expect(retryDelayMs(1, 30)).toBe(30_000);
    expect(retryDelayMs(3, 1)).toBe(120_000);
    expect(retryDelayMs(Number.NaN)).toBe(2000);
    expect(retryDelayMs(2, -5)).toBe(60_000);
  });

  it('assigns deadlines to processing and token-bound work', () => {
    const received = new Date('2026-10-20T10:00:00Z');
    expect(deadlineFor('process', received).toISOString()).toBe('2026-10-20T10:12:00.000Z');
    expect(deadlineFor('discord_reply', received).toISOString()).toBe('2026-10-20T10:15:00.000Z');
    expect(deadlineFor('channel_post', received)).toBeNull();
    expect(usesInteractionToken('failure_notice')).toBe(true);
    expect(usesInteractionToken('mirror')).toBe(false);
  });

  it('gives up on permanent errors, exhausted attempts or a passed deadline', () => {
    const next = new Date('2026-10-20T10:05:00Z');
    expect(
      shouldGiveUp({ attempts: 1, maxAttempts: 8, permanent: true, nextAttemptAt: next }),
    ).toBe(true);
    expect(
      shouldGiveUp({ attempts: 8, maxAttempts: 8, permanent: false, nextAttemptAt: next }),
    ).toBe(true);
    expect(
      shouldGiveUp({
        attempts: 2,
        maxAttempts: 8,
        permanent: false,
        nextAttemptAt: next,
        deadlineAt: '2026-10-20T10:04:00Z',
      }),
    ).toBe(true);
    expect(
      shouldGiveUp({
        attempts: 2,
        maxAttempts: 8,
        permanent: false,
        nextAttemptAt: next,
        deadlineAt: null,
      }),
    ).toBe(false);
  });
});

import { JOB_KIND, TIMING } from '../../config/constants.js';

export const MAX_ATTEMPTS = 8;
export const INLINE_ATTEMPTS = 2;
export const INLINE_RETRY_DELAY_MS = 2000;
const SWEEPER_DELAYS_MS = [60_000, 120_000, 240_000, 480_000, 600_000];

export function retryDelayMs(failedAttempts, retryAfterSeconds = null) {
  const attempts = Number.isFinite(failedAttempts) ? Math.max(1, Math.floor(failedAttempts)) : 1;
  const scheduled =
    attempts < INLINE_ATTEMPTS
      ? INLINE_RETRY_DELAY_MS
      : (SWEEPER_DELAYS_MS[attempts - INLINE_ATTEMPTS] ?? SWEEPER_DELAYS_MS.at(-1));
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.max(scheduled, Math.ceil(retryAfterSeconds * 1000));
  }
  return scheduled;
}

const TOKEN_BOUND = new Set([JOB_KIND.DISCORD_REPLY, JOB_KIND.FAILURE_NOTICE]);

export function usesInteractionToken(kind) {
  return TOKEN_BOUND.has(kind);
}

export function deadlineFor(kind, receivedAt) {
  const received = new Date(receivedAt).getTime();
  if (kind === JOB_KIND.PROCESS) return new Date(received + TIMING.processDeadlineMs);
  if (usesInteractionToken(kind)) return new Date(received + TIMING.interactionTokenTtlMs);
  return null;
}

export function shouldGiveUp({ attempts, maxAttempts, permanent, nextAttemptAt, deadlineAt }) {
  if (permanent || attempts >= maxAttempts) return true;
  return Boolean(deadlineAt && nextAttemptAt.getTime() >= new Date(deadlineAt).getTime());
}

import { and, eq, lt, sql } from 'drizzle-orm';
import { EVENT_TYPE, GUILD_STATUS, JOB_KIND, TIMING } from '../../config/constants.js';
import { recordEvent } from '../../common/events.js';
import { db } from '../../db/index.js';
import { events, guilds, interactions, jobAttempts, sessions } from '../../db/schema.js';
import { sleep } from '../../utils/background.js';
import { logger } from '../../utils/logger.js';
import { GUILD_ATTENTION_CODES } from '../discord/discord.client.js';
import { handleJob } from '../interactions/interactions.pipeline.js';
import {
  LeaseLostError,
  claimJobs,
  completeJob,
  enqueueJobs,
  failJob,
  jobSpec,
  nextInlineAttemptAt,
  refreshInteractionStatus,
} from './jobs.service.js';

const DELIVERY_KINDS = new Set([JOB_KIND.CHANNEL_POST, JOB_KIND.MIRROR, JOB_KIND.COMPONENT_UPDATE]);

async function flagGuild(job, failure) {
  if (!job.guildId || !DELIVERY_KINDS.has(job.kind)) return;
  const attention =
    GUILD_ATTENTION_CODES.has(failure.providerCode) ||
    (job.kind === JOB_KIND.MIRROR && [401, 403, 404, 410].includes(failure.httpStatus));
  if (!attention) return;
  const reason =
    job.kind === JOB_KIND.MIRROR
      ? `The mirror webhook was rejected (${failure.httpStatus}). Update the mirror settings.`
      : `Discord rejected a post to the report channel (${failure.providerCode ?? failure.httpStatus}). Check the bot's permissions or choose another channel.`;
  await db
    .update(guilds)
    .set({ status: GUILD_STATUS.NEEDS_ATTENTION, attentionReason: reason, updatedAt: new Date() })
    .where(and(eq(guilds.id, job.guildId), eq(guilds.status, GUILD_STATUS.CONNECTED)));
  await recordEvent({
    type: EVENT_TYPE.GUILD_NEEDS_ATTENTION,
    level: 'warn',
    guildId: job.guildId,
    interactionId: job.interactionId,
    data: { kind: job.kind, reason },
  });
}

async function scheduleFailureNotice(job) {
  const [interaction] = await db
    .select({
      id: interactions.id,
      guildId: interactions.guildId,
      receivedAt: interactions.receivedAt,
    })
    .from(interactions)
    .where(eq(interactions.id, job.interactionId))
    .limit(1);
  if (interaction) await enqueueJobs([jobSpec(JOB_KIND.FAILURE_NOTICE, interaction)]);
}

export async function executeJob(job) {
  const startedAt = new Date();
  try {
    const outcome = await handleJob(job, startedAt);
    if (!outcome?.completed) await completeJob(job, startedAt, outcome?.result ?? null);
  } catch (error) {
    if (error instanceof LeaseLostError) {
      logger.warn({ jobId: job.id, kind: job.kind }, 'Job lease lost; another runner owns it');
      return;
    }
    try {
      const { dead, failure } = await failJob(job, startedAt, error);
      logger.warn(
        {
          jobId: job.id,
          kind: job.kind,
          attempt: job.attempts,
          dead,
          outcome: failure.outcome,
          err: error,
        },
        'Job attempt failed',
      );
      if (dead && job.kind === JOB_KIND.PROCESS) await scheduleFailureNotice(job);
      if (dead) await flagGuild(job, failure);
    } catch (recordError) {
      if (!(recordError instanceof LeaseLostError)) throw recordError;
    }
  } finally {
    await refreshInteractionStatus(job.interactionId);
  }
}

export async function runInteraction(interactionId) {
  const stopAt = Date.now() + TIMING.inlineBudgetMs;
  while (Date.now() < stopAt) {
    const claimed = await claimJobs({ interactionId, limit: 10, inlineOnly: true });
    if (claimed.length > 0) {
      await Promise.all(claimed.map(executeJob));
      continue;
    }
    const next = await nextInlineAttemptAt(interactionId);
    if (!next || next.getTime() > stopAt) break;
    await sleep(Math.max(0, next.getTime() - Date.now()));
  }
}

async function runWithConcurrency(items, concurrency, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) await worker(queue.shift());
  });
  await Promise.all(runners);
}

export async function sweep({ limit = 25, concurrency = 5 } = {}) {
  const claimed = await claimJobs({ limit });
  await runWithConcurrency(claimed, concurrency, executeJob);
  return claimed.length;
}

export async function housekeeping(now = new Date()) {
  const retentionCutoff = new Date(now.getTime() - TIMING.retentionDays * 24 * 60 * 60 * 1000);
  const [tokens, expiredSessions, oldEvents, oldAttempts] = await Promise.all([
    db
      .update(interactions)
      .set({ tokenEnc: null })
      .where(and(lt(interactions.tokenExpiresAt, now), sql`${interactions.tokenEnc} IS NOT NULL`))
      .returning({ id: interactions.id }),
    db.delete(sessions).where(lt(sessions.expire, now)).returning({ sid: sessions.sid }),
    db.delete(events).where(lt(events.ts, retentionCutoff)).returning({ id: events.id }),
    db
      .delete(jobAttempts)
      .where(lt(jobAttempts.startedAt, retentionCutoff))
      .returning({ id: jobAttempts.id }),
  ]);
  return {
    tokensCleared: tokens.length,
    sessionsDeleted: expiredSessions.length,
    eventsDeleted: oldEvents.length,
    attemptsDeleted: oldAttempts.length,
  };
}

export async function scheduledSweep() {
  const startedAt = Date.now();
  const processed = await sweep();
  const cleanup = await housekeeping();
  const summary = { processed, ...cleanup, durationMs: Date.now() - startedAt };
  await recordEvent({ type: EVENT_TYPE.SWEEP_RUN, data: summary });
  return summary;
}

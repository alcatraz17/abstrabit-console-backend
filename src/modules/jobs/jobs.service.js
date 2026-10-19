import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  ATTEMPT_OUTCOME,
  EVENT_TYPE,
  INTERACTION_STATUS,
  JOB_KIND,
  JOB_STATUS,
  TIMING,
} from '../../config/constants.js';
import { recordEvent } from '../../common/events.js';
import { db, pool } from '../../db/index.js';
import { jobAttempts, jobs } from '../../db/schema.js';
import { DeliveryError } from '../../utils/http.js';
import { errorText } from '../../utils/scrub.js';
import {
  INLINE_ATTEMPTS,
  MAX_ATTEMPTS,
  deadlineFor,
  retryDelayMs,
  shouldGiveUp,
} from './retry-policy.js';

export class LeaseLostError extends Error {
  constructor(jobId) {
    super(`Lease lost for job ${jobId}.`);
    this.name = 'LeaseLostError';
  }
}

export function jobSpec(kind, interaction, payload = {}) {
  return {
    interactionId: interaction.id,
    guildId: interaction.guildId,
    kind,
    payload,
    deadlineAt: deadlineFor(kind, interaction.receivedAt),
    maxAttempts: MAX_ATTEMPTS,
  };
}

export async function enqueueJobs(specs, executor = db) {
  if (specs.length === 0) return;
  await executor.insert(jobs).values(specs).onConflictDoNothing();
}

const CLAIM_SQL = `
  UPDATE jobs
  SET status = 'running',
      locked_until = now() + make_interval(secs => $3),
      lease_token = gen_random_uuid(),
      attempts = attempts + 1,
      updated_at = now()
  WHERE id IN (
    SELECT id FROM jobs
    WHERE ($1::varchar IS NULL OR interaction_id = $1)
      AND ($4::int IS NULL OR attempts < $4)
      AND (
        (status IN ('pending', 'retrying') AND next_attempt_at <= now())
        OR (status = 'running' AND locked_until < now())
      )
    ORDER BY next_attempt_at
    LIMIT $2
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id, interaction_id AS "interactionId", guild_id AS "guildId", kind, status,
            attempts, max_attempts AS "maxAttempts", deadline_at AS "deadlineAt",
            lease_token AS "leaseToken", payload`;

export async function claimJobs({ interactionId = null, limit = 10, inlineOnly = false } = {}) {
  const { rows } = await pool.query(CLAIM_SQL, [
    interactionId,
    limit,
    TIMING.leaseSeconds,
    inlineOnly ? INLINE_ATTEMPTS : null,
  ]);
  return rows;
}

export async function nextInlineAttemptAt(interactionId) {
  const [row] = await db
    .select({ next: sql`min(${jobs.nextAttemptAt})` })
    .from(jobs)
    .where(
      and(
        eq(jobs.interactionId, interactionId),
        inArray(jobs.status, [JOB_STATUS.PENDING, JOB_STATUS.RETRYING]),
        sql`${jobs.attempts} < ${INLINE_ATTEMPTS}`,
      ),
    );
  return row?.next ? new Date(row.next) : null;
}

function fenced(job) {
  return and(eq(jobs.id, job.id), eq(jobs.leaseToken, job.leaseToken));
}

async function recordAttempt(
  executor,
  job,
  { startedAt, outcome, httpStatus, providerCode, error },
) {
  await executor.insert(jobAttempts).values({
    jobId: job.id,
    attempt: job.attempts,
    startedAt,
    durationMs: Math.max(0, Date.now() - startedAt.getTime()),
    outcome,
    httpStatus: httpStatus ?? null,
    discordCode: providerCode ?? null,
    error: error ?? null,
  });
}

export async function completeJob(job, startedAt, result = null, executor = db) {
  const updated = await executor
    .update(jobs)
    .set({
      status: JOB_STATUS.SUCCEEDED,
      result,
      lastError: null,
      lockedUntil: null,
      leaseToken: null,
      updatedAt: new Date(),
    })
    .where(fenced(job))
    .returning({ id: jobs.id });
  if (updated.length === 0) throw new LeaseLostError(job.id);
  await recordAttempt(executor, job, { startedAt, outcome: ATTEMPT_OUTCOME.OK });
}

export async function skipJob(job, startedAt, reason) {
  const updated = await db
    .update(jobs)
    .set({
      status: JOB_STATUS.SKIPPED,
      result: { skipped: reason },
      lockedUntil: null,
      leaseToken: null,
      updatedAt: new Date(),
    })
    .where(fenced(job))
    .returning({ id: jobs.id });
  if (updated.length === 0) throw new LeaseLostError(job.id);
  await recordAttempt(db, job, {
    startedAt,
    outcome: ATTEMPT_OUTCOME.OK,
    error: `skipped: ${reason}`,
  });
}

export function describeFailure(error) {
  if (error instanceof DeliveryError) {
    return {
      outcome: error.outcome,
      httpStatus: error.httpStatus,
      providerCode: error.providerCode,
      retryAfterSeconds: error.retryAfterSeconds,
      permanent: error.permanent,
      message: errorText(error),
    };
  }
  return {
    outcome: ATTEMPT_OUTCOME.UNKNOWN,
    httpStatus: null,
    providerCode: null,
    retryAfterSeconds: null,
    permanent: Boolean(error?.permanent),
    message: errorText(error),
  };
}

export async function failJob(job, startedAt, error) {
  const failure = describeFailure(error);
  const nextAttemptAt = new Date(
    Date.now() + retryDelayMs(job.attempts, failure.retryAfterSeconds),
  );
  const dead = shouldGiveUp({
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    permanent: failure.permanent,
    nextAttemptAt,
    deadlineAt: job.deadlineAt,
  });
  const updated = await db
    .update(jobs)
    .set({
      status: dead ? JOB_STATUS.DEAD : JOB_STATUS.RETRYING,
      nextAttemptAt: dead ? new Date() : nextAttemptAt,
      lastError: failure.message,
      lockedUntil: null,
      leaseToken: null,
      updatedAt: new Date(),
    })
    .where(fenced(job))
    .returning({ id: jobs.id });
  if (updated.length === 0) throw new LeaseLostError(job.id);
  await recordAttempt(db, job, { startedAt, ...failure, error: failure.message });
  if (dead) {
    await recordEvent({
      type: EVENT_TYPE.JOB_DEAD,
      level: 'error',
      guildId: job.guildId,
      interactionId: job.interactionId,
      data: { jobId: job.id, kind: job.kind, attempts: job.attempts, error: failure.message },
    });
  }
  return { dead, failure };
}

export async function refreshInteractionStatus(interactionId) {
  await pool.query(
    `UPDATE interactions i
     SET status = CASE
       WHEN EXISTS (SELECT 1 FROM jobs j WHERE j.interaction_id = i.id AND j.status IN ('pending','running','retrying')) THEN $2
       WHEN EXISTS (SELECT 1 FROM jobs j WHERE j.interaction_id = i.id AND j.kind = $6 AND j.status = 'dead') THEN $3
       WHEN (i.decision ->> 'allowed') = 'false' THEN $4
       WHEN EXISTS (SELECT 1 FROM jobs j WHERE j.interaction_id = i.id AND j.status = 'dead') THEN $5
       ELSE $7
     END,
     updated_at = now()
     WHERE i.id = $1 AND EXISTS (SELECT 1 FROM jobs j WHERE j.interaction_id = i.id)`,
    [
      interactionId,
      INTERACTION_STATUS.PROCESSING,
      INTERACTION_STATUS.FAILED,
      INTERACTION_STATUS.BLOCKED,
      INTERACTION_STATUS.PARTIAL,
      JOB_KIND.PROCESS,
      INTERACTION_STATUS.DONE,
    ],
  );
}

export async function retryJobs(where, now = new Date()) {
  return db
    .update(jobs)
    .set({
      status: JOB_STATUS.RETRYING,
      nextAttemptAt: now,
      maxAttempts: sql`greatest(${jobs.maxAttempts}, ${jobs.attempts} + 3)`,
      deadlineAt: sql`CASE WHEN ${jobs.kind} = ${JOB_KIND.PROCESS} THEN NULL ELSE ${jobs.deadlineAt} END`,
      updatedAt: now,
    })
    .where(where)
    .returning({ id: jobs.id, interactionId: jobs.interactionId });
}

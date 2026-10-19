import { and, desc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import { JOB_KIND, JOB_STATUS } from '../../config/constants.js';
import { ConflictError, NotFoundError } from '../../common/errors.js';
import { db } from '../../db/index.js';
import { adminGuilds, interactions, jobs } from '../../db/schema.js';
import { background } from '../../utils/background.js';
import { retryJobs } from './jobs.service.js';
import { scheduledSweep, sweep } from './jobs.runner.js';
import { usesInteractionToken } from './retry-policy.js';

const LIST_STATUSES = { retrying: [JOB_STATUS.RETRYING], dead: [JOB_STATUS.DEAD] };
const TOKEN_BOUND_KINDS = [JOB_KIND.DISCORD_REPLY, JOB_KIND.FAILURE_NOTICE];

const retryable = and(
  eq(jobs.status, JOB_STATUS.DEAD),
  or(
    notInArray(jobs.kind, TOKEN_BOUND_KINDS),
    isNull(jobs.deadlineAt),
    sql`${jobs.deadlineAt} > now()`,
  ),
);

export async function list(req, res) {
  const { status } = req.valid.query;
  const rows = await db
    .select({
      id: jobs.id,
      interactionId: jobs.interactionId,
      kind: jobs.kind,
      status: jobs.status,
      attempts: jobs.attempts,
      maxAttempts: jobs.maxAttempts,
      nextAttemptAt: jobs.nextAttemptAt,
      deadlineAt: jobs.deadlineAt,
      lastError: jobs.lastError,
      updatedAt: jobs.updatedAt,
      command: interactions.command,
      userName: interactions.userName,
      reportId: interactions.reportId,
    })
    .from(jobs)
    .innerJoin(interactions, eq(interactions.id, jobs.interactionId))
    .where(and(eq(jobs.guildId, req.guild.id), inArray(jobs.status, LIST_STATUSES[status])))
    .orderBy(desc(jobs.updatedAt))
    .limit(200);
  const now = Date.now();
  res.json({
    jobs: rows.map((row) => ({
      ...row,
      retryable:
        row.status === JOB_STATUS.DEAD &&
        !(
          usesInteractionToken(row.kind) &&
          row.deadlineAt &&
          new Date(row.deadlineAt).getTime() <= now
        ),
    })),
  });
}

export async function retryOne(req, res) {
  const { jobId } = req.valid.params;
  const [job] = await db
    .select({ id: jobs.id, status: jobs.status, kind: jobs.kind, deadlineAt: jobs.deadlineAt })
    .from(jobs)
    .innerJoin(adminGuilds, eq(adminGuilds.guildId, jobs.guildId))
    .where(and(eq(jobs.id, jobId), eq(adminGuilds.adminId, req.admin.id)))
    .limit(1);
  if (!job) throw new NotFoundError('That job was not found.');
  if (![JOB_STATUS.DEAD, JOB_STATUS.RETRYING].includes(job.status)) {
    throw new ConflictError('Only failed or retrying jobs can be retried.', 'not_retryable');
  }
  if (
    usesInteractionToken(job.kind) &&
    job.deadlineAt &&
    new Date(job.deadlineAt).getTime() <= Date.now()
  ) {
    throw new ConflictError(
      'The Discord interaction token has expired, so this reply can no longer be sent.',
      'token_expired',
    );
  }
  await retryJobs(eq(jobs.id, job.id));
  background(() => sweep({ limit: 5 }));
  res.status(202).json({ queued: 1 });
}

export async function retryAllDead(req, res) {
  const queued = await retryJobs(and(eq(jobs.guildId, req.guild.id), retryable));
  if (queued.length > 0) background(() => sweep({ limit: 10 }));
  res.status(202).json({ queued: queued.length });
}

export async function cronSweep(_req, res) {
  res.json(await scheduledSweep());
}

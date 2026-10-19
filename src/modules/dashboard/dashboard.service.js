import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import {
  EVENT_TYPE,
  INTERACTION_KIND,
  JOB_KIND,
  JOB_STATUS,
  REPORT_STATUS,
  SECURITY_EVENT_TYPES,
} from '../../config/constants.js';
import { db } from '../../db/index.js';
import { adminGuilds, events, interactions, jobAttempts, jobs, reports } from '../../db/schema.js';
import { truncate } from '../../utils/text.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function overview(guildId) {
  const since = new Date(Date.now() - DAY_MS);
  const [traffic] = await db
    .select({
      commands24h: sql`count(*)`.mapWith(Number),
      finished:
        sql`count(*) filter (where ${interactions.status} in ('done','partial','failed'))`.mapWith(
          Number,
        ),
      succeeded: sql`count(*) filter (where ${interactions.status} = 'done')`.mapWith(Number),
      averageAckMs: sql`round(avg(${interactions.ackMs}))`.mapWith(Number),
      p95AckMs:
        sql`round(percentile_cont(0.95) within group (order by ${interactions.ackMs}))`.mapWith(
          Number,
        ),
    })
    .from(interactions)
    .where(and(eq(interactions.guildId, guildId), gte(interactions.receivedAt, since)));
  const [jobStats] = await db
    .select({
      pendingRetries: sql`count(*) filter (where ${jobs.status} = ${JOB_STATUS.RETRYING})`.mapWith(
        Number,
      ),
      deadJobs: sql`count(*) filter (where ${jobs.status} = ${JOB_STATUS.DEAD})`.mapWith(Number),
    })
    .from(jobs)
    .where(eq(jobs.guildId, guildId));
  const [reportStats] = await db
    .select({
      openReports:
        sql`count(*) filter (where ${reports.status} <> ${REPORT_STATUS.RESOLVED})`.mapWith(Number),
      openHighPriority:
        sql`count(*) filter (where ${reports.status} <> ${REPORT_STATUS.RESOLVED} and ${reports.priority} = 'high')`.mapWith(
          Number,
        ),
    })
    .from(reports)
    .where(eq(reports.guildId, guildId));
  const [securityStats] = await db
    .select({
      rejectedRequests24h:
        sql`count(*) filter (where ${events.type} in (${EVENT_TYPE.SIGNATURE_REJECTED}, ${EVENT_TYPE.STALE_TIMESTAMP}) and ${events.ts} >= ${since})`.mapWith(
          Number,
        ),
      lastSweepAt: sql`max(${events.ts}) filter (where ${events.type} = ${EVENT_TYPE.SWEEP_RUN})`,
    })
    .from(events);

  return {
    commands24h: traffic.commands24h,
    successRate: traffic.finished > 0 ? traffic.succeeded / traffic.finished : null,
    averageAckMs: Number.isFinite(traffic.averageAckMs) ? traffic.averageAckMs : null,
    p95AckMs: Number.isFinite(traffic.p95AckMs) ? traffic.p95AckMs : null,
    ...jobStats,
    ...reportStats,
    rejectedRequests24h: securityStats.rejectedRequests24h,
    lastSweepAt: securityStats.lastSweepAt ? new Date(securityStats.lastSweepAt) : null,
  };
}

function inputPreview(row) {
  if (row.command === 'status') return '/status';
  if (row.command === 'connect') return '/connect';
  if (row.kind === INTERACTION_KIND.BUTTON) {
    return `${row.input?.action ?? 'Action'} on report #${row.input?.reportId ?? '?'}`;
  }
  if (row.input?.openedForm) return 'Opened the report form';
  return truncate(row.input?.text ?? '', 160);
}

function toFeedItem(row, actions) {
  const decision = row.decision;
  return {
    id: row.id,
    kind: row.kind,
    command: row.command,
    userName: row.userName,
    inputPreview: inputPreview(row),
    status: row.status,
    priority: decision?.allowed ? (decision.priority ?? null) : null,
    tags: [...new Set([...(decision?.tags ?? []), ...(row.ai?.tags ?? [])])],
    blockReason: decision && !decision.allowed ? decision.reason : null,
    reportId: row.reportId,
    ackMs: row.ackMs,
    configVersion: row.configVersion,
    aiSummary: row.ai?.summary ?? null,
    receivedAt: row.receivedAt,
    updatedAt: row.updatedAt,
    actions,
  };
}

async function actionsFor(interactionIds) {
  if (interactionIds.length === 0) return new Map();
  const rows = await db
    .select({
      interactionId: jobs.interactionId,
      id: jobs.id,
      kind: jobs.kind,
      status: jobs.status,
      attempts: jobs.attempts,
      maxAttempts: jobs.maxAttempts,
      nextAttemptAt: jobs.nextAttemptAt,
      lastError: jobs.lastError,
    })
    .from(jobs)
    .where(and(inArray(jobs.interactionId, interactionIds), ne(jobs.kind, JOB_KIND.PROCESS)))
    .orderBy(asc(jobs.createdAt));
  const grouped = new Map();
  for (const { interactionId, ...action } of rows) {
    if (!grouped.has(interactionId)) grouped.set(interactionId, []);
    grouped.get(interactionId).push(action);
  }
  return grouped;
}

export async function feed(guildId, { since, before, command, status, limit }) {
  const [{ now }] = (await db.execute(sql`select now() as now`)).rows;
  const filters = [eq(interactions.guildId, guildId)];
  if (command) filters.push(eq(interactions.command, command));
  if (since) filters.push(gte(interactions.updatedAt, since));
  else if (status) filters.push(eq(interactions.status, status));
  if (before) filters.push(lt(interactions.receivedAt, before));

  const rows = await db
    .select()
    .from(interactions)
    .where(and(...filters))
    .orderBy(desc(interactions.receivedAt), desc(interactions.id))
    .limit(since ? 500 : limit + 1);
  const page = since ? rows : rows.slice(0, limit);
  const actions = await actionsFor(page.map((row) => row.id));
  return {
    items: page.map((row) => toFeedItem(row, actions.get(row.id) ?? [])),
    cursor: new Date(now).toISOString(),
    hasMore: !since && rows.length > limit,
  };
}

export async function interactionDetail(adminId, interactionId) {
  const [row] = await db
    .select({ interaction: interactions })
    .from(interactions)
    .innerJoin(adminGuilds, eq(adminGuilds.guildId, interactions.guildId))
    .where(and(eq(interactions.id, interactionId), eq(adminGuilds.adminId, adminId)))
    .limit(1);
  if (!row) return null;
  const interaction = row.interaction;

  const [jobRows, attemptRows, eventRows, reportRows] = await Promise.all([
    db
      .select()
      .from(jobs)
      .where(eq(jobs.interactionId, interactionId))
      .orderBy(asc(jobs.createdAt)),
    db
      .select({ attempt: jobAttempts, kind: jobs.kind })
      .from(jobAttempts)
      .innerJoin(jobs, eq(jobs.id, jobAttempts.jobId))
      .where(eq(jobs.interactionId, interactionId)),
    db.select().from(events).where(eq(events.interactionId, interactionId)),
    interaction.reportId
      ? db.select().from(reports).where(eq(reports.id, interaction.reportId)).limit(1)
      : [],
  ]);

  const timeline = [
    {
      id: `received-${interaction.id}`,
      at: interaction.receivedAt,
      kind: 'event',
      level: 'info',
      title: 'Interaction received and verified',
      detail: interaction.ackMs !== null ? `Acknowledged in ${interaction.ackMs} ms` : null,
    },
    ...eventRows.map((event) => ({
      id: `event-${event.id}`,
      at: event.ts,
      kind: 'event',
      level: event.level,
      title: event.type.replaceAll('_', ' '),
      detail: event.data?.error ?? event.data?.reason ?? null,
    })),
    ...attemptRows.map(({ attempt, kind }) => ({
      id: `attempt-${attempt.id}`,
      at: attempt.startedAt,
      kind: 'attempt',
      level: attempt.outcome === 'ok' ? 'info' : 'warn',
      title: `${kind.replaceAll('_', ' ')} attempt ${attempt.attempt}: ${attempt.outcome === 'ok' ? 'succeeded' : 'failed'}`,
      detail: attempt.error,
      jobKind: kind,
      outcome: attempt.outcome,
      durationMs: attempt.durationMs,
      httpStatus: attempt.httpStatus,
    })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));

  const actions = jobRows
    .filter((job) => job.kind !== JOB_KIND.PROCESS)
    .map((job) => ({
      id: job.id,
      kind: job.kind,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      nextAttemptAt: job.nextAttemptAt,
      lastError: job.lastError,
    }));

  const report = reportRows[0] ?? null;
  return {
    ...toFeedItem(interaction, actions),
    channelId: interaction.channelId,
    input: interaction.input,
    decision: interaction.decision,
    ai: interaction.ai,
    processStatus: jobRows.find((job) => job.kind === JOB_KIND.PROCESS)?.status ?? null,
    report: report && {
      id: report.id,
      status: report.status,
      priority: report.priority,
      severity: report.severity,
      text: report.text,
      handledByName: report.handledByName,
      handledAt: report.handledAt,
      channelId: report.channelId,
      channelMessageId: report.channelMessageId,
    },
    timeline,
  };
}

export async function securityEvents(adminId) {
  const linked = db
    .select({ guildId: adminGuilds.guildId })
    .from(adminGuilds)
    .where(eq(adminGuilds.adminId, adminId));
  const rows = await db
    .select({
      id: events.id,
      at: events.ts,
      type: events.type,
      level: events.level,
      data: events.data,
      guildId: events.guildId,
    })
    .from(events)
    .where(
      and(
        inArray(events.type, SECURITY_EVENT_TYPES),
        or(isNull(events.guildId), inArray(events.guildId, linked)),
      ),
    )
    .orderBy(desc(events.ts))
    .limit(100);
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    type: row.type,
    level: row.level,
    guildId: row.guildId,
    detail: row.data?.reason ?? (row.data?.email ? `Sign-in attempt for ${row.data.email}` : null),
    ip: row.data?.ip ?? null,
  }));
}

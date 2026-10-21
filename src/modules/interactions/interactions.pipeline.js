import { and, count, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { COMMANDS, INTERACTION_KIND, JOB_KIND, REPORT_ACTIONS } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { db } from '../../db/index.js';
import { guilds, interactions, reports } from '../../db/schema.js';
import { decrypt } from '../../utils/crypto.js';
import { logger } from '../../utils/logger.js';
import { DEFAULT_REPLY_TEMPLATE, renderTemplate } from '../../utils/template.js';
import { escapeMarkdown } from '../../utils/text.js';
import { isAiConfigured, summarizeReport } from '../ai/ai.service.js';
import { describeBlockReason, evaluate } from '../commands/rule-engine.js';
import { discord } from '../discord/discord.client.js';
import { message, reportCard } from '../discord/discord.payloads.js';
import { completeJob, enqueueJobs, jobSpec } from '../jobs/jobs.service.js';
import { sendMirror } from '../mirror/mirror.service.js';

export class PermanentJobError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermanentJobError';
    this.permanent = true;
  }
}

async function loadContext(job) {
  const [interaction] = await db
    .select()
    .from(interactions)
    .where(eq(interactions.id, job.interactionId))
    .limit(1);
  if (!interaction) throw new PermanentJobError('The interaction no longer exists.');
  const [guild] = interaction.guildId
    ? await db.select().from(guilds).where(eq(guilds.id, interaction.guildId)).limit(1)
    : [];
  const [report] = interaction.reportId
    ? await db.select().from(reports).where(eq(reports.id, interaction.reportId)).limit(1)
    : [];
  return { interaction, guild: guild ?? null, report: report ?? null };
}

function interactionToken(interaction) {
  if (!interaction.tokenEnc || new Date(interaction.tokenExpiresAt).getTime() <= Date.now()) {
    throw new PermanentJobError('The interaction token has expired.');
  }
  return decrypt(interaction.tokenEnc);
}

async function countRecentReports(interaction, windowSeconds) {
  const since = new Date(new Date(interaction.receivedAt).getTime() - windowSeconds * 1000);
  const [row] = await db
    .select({ total: count() })
    .from(interactions)
    .where(
      and(
        eq(interactions.guildId, interaction.guildId),
        eq(interactions.userId, interaction.userId),
        eq(interactions.command, COMMANDS.REPORT),
        inArray(interactions.kind, [INTERACTION_KIND.COMMAND, INTERACTION_KIND.MODAL]),
        ne(interactions.id, interaction.id),
        gte(interactions.receivedAt, since),
        lt(interactions.receivedAt, interaction.receivedAt),
        sql`(${interactions.decision} ->> 'allowed') = 'true'`,
      ),
    );
  return Number(row?.total ?? 0);
}

async function processReport(job, { interaction, guild }, startedAt) {
  const config = interaction.configSnapshot;
  const { text, severity } = interaction.input;
  const recentCountForUser = config.cooldown
    ? await countRecentReports(interaction, config.cooldown.windowSeconds)
    : 0;
  const decision = evaluate(COMMANDS.REPORT, config, interaction.configVersion, {
    text,
    severity,
    recentCountForUser,
  });

  let ai = null;
  let aiPending = false;
  if (decision.allowed && decision.aiEnabled && isAiConfigured()) {
    try {
      ai = await summarizeReport(text, { simulateSlow: guild?.settings?.slowAi });
    } catch (error) {
      aiPending = true;
      logger.warn({ err: error, interactionId: interaction.id }, 'AI summary deferred');
    }
  }

  await db.transaction(async (tx) => {
    let reportId = null;
    const children = [jobSpec(JOB_KIND.DISCORD_REPLY, interaction)];
    if (decision.allowed) {
      const [report] = await tx
        .insert(reports)
        .values({
          guildId: interaction.guildId,
          interactionId: interaction.id,
          authorId: interaction.userId,
          authorName: interaction.userName ?? 'Unknown user',
          text,
          severity: severity ?? null,
          priority: decision.priority,
          tags: decision.tags,
          aiSummary: ai?.summary ?? null,
          channelId: decision.postToChannel ? guild?.postChannelId : null,
        })
        .returning({ id: reports.id });
      reportId = report.id;
      if (decision.postToChannel && guild?.postChannelId) {
        children.push(jobSpec(JOB_KIND.CHANNEL_POST, interaction));
      }
      if (decision.mirror && guild && guild.mirrorKind !== 'none') {
        children.push(jobSpec(JOB_KIND.MIRROR, interaction, { type: 'report' }));
      }
      if (aiPending) children.push(jobSpec(JOB_KIND.AI_ENRICH, interaction));
    }
    await tx
      .update(interactions)
      .set({ decision, ai, reportId, updatedAt: new Date() })
      .where(eq(interactions.id, interaction.id));
    await enqueueJobs(children, tx);
    await completeJob(job, startedAt, { allowed: decision.allowed, reportId }, tx);
  });
  return { completed: true };
}

async function processButton(job, { interaction, guild }, startedAt) {
  const { action, reportId } = interaction.input;
  const transition = REPORT_ACTIONS[action];
  if (!transition) throw new PermanentJobError(`Unknown report action ${action}.`);

  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ status: reports.status })
      .from(reports)
      .where(and(eq(reports.id, reportId), eq(reports.guildId, interaction.guildId)))
      .limit(1);
    if (!before) throw new PermanentJobError('The report no longer exists.');

    const [updated] = await tx
      .update(reports)
      .set({
        status: transition.status,
        handledById: interaction.userId,
        handledByName: interaction.userName,
        handledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(reports.id, reportId),
          eq(reports.guildId, interaction.guildId),
          inArray(reports.status, transition.from),
        ),
      )
      .returning({ id: reports.id, status: reports.status, interactionId: reports.interactionId });
    if (updated) {
      await tx
        .update(interactions)
        .set({ updatedAt: new Date() })
        .where(eq(interactions.id, updated.interactionId));
    }

    const decision = updated
      ? { allowed: true, transition: { action, from: before.status, to: updated.status } }
      : { allowed: true, transition: null, unchangedStatus: before.status };
    const children = updated
      ? [
          jobSpec(JOB_KIND.COMPONENT_UPDATE, interaction),
          ...(guild && guild.mirrorKind !== 'none'
            ? [jobSpec(JOB_KIND.MIRROR, interaction, { type: 'transition' })]
            : []),
        ]
      : [
          jobSpec(JOB_KIND.DISCORD_REPLY, interaction, {
            mode: 'followup',
            content: `Report #${reportId} is already ${before.status}.`,
          }),
        ];

    await tx
      .update(interactions)
      .set({ decision, updatedAt: new Date() })
      .where(eq(interactions.id, interaction.id));
    await enqueueJobs(children, tx);
    await completeJob(job, startedAt, decision, tx);
  });
  return { completed: true };
}

function replyContent(interaction, report) {
  const decision = interaction.decision;
  if (!decision?.allowed) {
    return describeBlockReason(decision?.reason, interaction.configSnapshot);
  }
  const template = interaction.configSnapshot?.replyTemplate || DEFAULT_REPLY_TEMPLATE;
  const lines = [
    renderTemplate(template, {
      reportId: report?.id,
      priority: decision.priority,
      tags: decision.tags.join(', '),
      rule: decision.matchedRuleName,
      user: interaction.userName,
    }),
  ];
  if (decision.matchedRuleName) lines.push(`Rule: ${escapeMarkdown(decision.matchedRuleName)}`);
  if (interaction.ai?.summary) lines.push(`Summary: ${escapeMarkdown(interaction.ai.summary)}`);
  return lines.join('\n');
}

async function discordReply(job, { interaction, report }) {
  const token = interactionToken(interaction);
  if (job.payload?.mode === 'followup') {
    await discord.createFollowup(token, message({ content: job.payload.content, ephemeral: true }));
    return { result: { followup: true } };
  }
  await discord.editOriginalResponse(
    token,
    message({ content: replyContent(interaction, report) }),
  );
  return { result: { edited: true } };
}

async function findPostedCard(channelId, reportId) {
  const messages = await discord.listChannelMessages(channelId, 50);
  const marker = `:${reportId}`;
  return (
    messages.find(
      (candidate) =>
        candidate.author?.id === env.DISCORD_APPLICATION_ID &&
        candidate.components?.some((row) =>
          row.components?.some((component) => component.custom_id?.endsWith(marker)),
        ),
    ) ?? null
  );
}

async function channelPost(job, { interaction, report }) {
  if (!report?.channelId) throw new PermanentJobError('No report channel is configured.');
  if (report.channelMessageId)
    return { result: { messageId: report.channelMessageId, existing: true } };
  if (job.attempts > 1) {
    const existing = await findPostedCard(report.channelId, report.id);
    if (existing) {
      await db
        .update(reports)
        .set({ channelMessageId: existing.id, updatedAt: new Date() })
        .where(eq(reports.id, report.id));
      return { result: { messageId: existing.id, reconciled: true } };
    }
  }
  const created = await discord.createChannelMessage(report.channelId, {
    ...reportCard(report),
    nonce: interaction.id,
    enforce_nonce: true,
  });
  await db
    .update(reports)
    .set({ channelMessageId: created.id, updatedAt: new Date() })
    .where(eq(reports.id, report.id));
  return { result: { messageId: created.id } };
}

function mirrorNotification(job, { interaction, guild, report }) {
  if (job.payload?.type === 'transition') {
    const transition = interaction.decision?.transition;
    return {
      title: `Report #${report.id} ${transition?.to ?? 'updated'} by ${interaction.userName}`,
      body: report.text,
      priority: report.priority,
      guildName: guild.name,
      ref: interaction.id,
    };
  }
  return {
    title: `${report.priority === 'high' ? 'High priority report' : 'New report'} #${report.id} from ${report.authorName}`,
    body: report.aiSummary ? `${report.text}\n\nSummary: ${report.aiSummary}` : report.text,
    priority: report.priority,
    guildName: guild.name,
    ref: interaction.id,
  };
}

async function mirror(job, context) {
  const { guild, report } = context;
  if (!guild || !report) throw new PermanentJobError('The report or server no longer exists.');
  const outcome = await sendMirror(guild, mirrorNotification(job, context), {
    reconcile: job.attempts > 1,
  });
  if (outcome.messageId && job.payload?.type !== 'transition') {
    await db
      .update(reports)
      .set({ mirrorMessageId: outcome.messageId, updatedAt: new Date() })
      .where(eq(reports.id, report.id));
  }
  return { result: outcome };
}

async function componentUpdate(job, { report }) {
  if (!report?.channelId || !report.channelMessageId) {
    throw new PermanentJobError('The report card was never posted.');
  }
  await discord.editChannelMessage(report.channelId, report.channelMessageId, reportCard(report));
  return { result: { status: report.status } };
}

async function aiEnrich(job, { interaction, guild, report }) {
  const ai = await summarizeReport(interaction.input.text, {
    simulateSlow: guild?.settings?.slowAi,
  });
  if (!ai) return { result: { skipped: 'AI is not configured' } };
  await db.transaction(async (tx) => {
    await tx
      .update(interactions)
      .set({ ai, updatedAt: new Date() })
      .where(eq(interactions.id, interaction.id));
    if (report) {
      await tx
        .update(reports)
        .set({ aiSummary: ai.summary, updatedAt: new Date() })
        .where(eq(reports.id, report.id));
    }
  });
  const refreshed = await loadContext(job);
  const followUps = [];
  if (refreshed.report?.channelMessageId) {
    followUps.push(
      discord.editChannelMessage(
        refreshed.report.channelId,
        refreshed.report.channelMessageId,
        reportCard(refreshed.report),
      ),
    );
  }
  if (new Date(interaction.tokenExpiresAt).getTime() > Date.now() && interaction.tokenEnc) {
    followUps.push(
      discord.editOriginalResponse(
        decrypt(interaction.tokenEnc),
        message({ content: replyContent(refreshed.interaction, refreshed.report) }),
      ),
    );
  }
  const settled = await Promise.allSettled(followUps);
  return {
    result: {
      summary: ai.summary,
      updatesFailed: settled.filter((item) => item.status === 'rejected').length,
    },
  };
}

async function failureNotice(job, { interaction }) {
  const token = interactionToken(interaction);
  await discord.editOriginalResponse(
    token,
    message({
      content: `We could not process this ${interaction.command === COMMANDS.REPORT ? 'report' : 'request'} (ref ${interaction.id}). An admin has been notified.`,
    }),
  );
  return { result: { notified: true } };
}

const PROCESSORS = {
  [INTERACTION_KIND.COMMAND]: processReport,
  [INTERACTION_KIND.MODAL]: processReport,
  [INTERACTION_KIND.BUTTON]: processButton,
};

const HANDLERS = {
  [JOB_KIND.PROCESS]: (job, context, startedAt) => {
    const processor = PROCESSORS[context.interaction.kind];
    if (!processor) throw new PermanentJobError(`No processor for ${context.interaction.kind}.`);
    return processor(job, context, startedAt);
  },
  [JOB_KIND.DISCORD_REPLY]: discordReply,
  [JOB_KIND.CHANNEL_POST]: channelPost,
  [JOB_KIND.MIRROR]: mirror,
  [JOB_KIND.COMPONENT_UPDATE]: componentUpdate,
  [JOB_KIND.AI_ENRICH]: aiEnrich,
  [JOB_KIND.FAILURE_NOTICE]: failureNotice,
};

export async function handleJob(job, startedAt) {
  const handler = HANDLERS[job.kind];
  if (!handler) throw new PermanentJobError(`Unknown job kind ${job.kind}.`);
  const context = await loadContext(job);
  return handler(job, context, startedAt);
}

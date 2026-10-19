import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import {
  CONFIGURABLE_COMMANDS,
  EVENT_TYPE,
  GUILD_STATUS,
  JOB_KIND,
  JOB_STATUS,
  REPORT_STATUS,
  TIMING,
} from '../../config/constants.js';
import { recordEvent } from '../../common/events.js';
import { db } from '../../db/index.js';
import {
  adminGuilds,
  commandConfigs,
  connectCodes,
  guilds,
  interactions,
  jobs,
  reports,
} from '../../db/schema.js';
import { encrypt, normalizeCode, sha256 } from '../../utils/crypto.js';
import { truncate } from '../../utils/text.js';
import { defaultCommandConfig } from '../commands/command-defaults.js';
import { ensureDefaultConfigs } from '../commands/commands.service.js';
import { discord } from '../discord/discord.client.js';
import { GUILD_COMMANDS } from '../discord/discord.commands.js';
import { message } from '../discord/discord.payloads.js';
import { enqueueJobs, jobSpec } from '../jobs/jobs.service.js';

export function interactionUser(interaction) {
  const user = interaction.member?.user ?? interaction.user ?? {};
  return {
    id: user.id ?? null,
    name: truncate(user.global_name || user.username || 'Unknown user', 100),
  };
}

export async function loadGuildContext(guildId, command) {
  if (!guildId) return { guild: null, config: null, version: 0 };
  const [row] = await db
    .select({ guild: guilds, config: commandConfigs.config, version: commandConfigs.version })
    .from(guilds)
    .leftJoin(
      commandConfigs,
      and(eq(commandConfigs.guildId, guilds.id), eq(commandConfigs.command, command)),
    )
    .where(eq(guilds.id, guildId))
    .limit(1);
  if (!row) return { guild: null, config: null, version: 0 };
  const configurable = CONFIGURABLE_COMMANDS.includes(command);
  return {
    guild: row.guild,
    config: row.config ?? (configurable ? defaultCommandConfig(command) : null),
    version: row.version ?? 0,
  };
}

export function isGuildActive(guild) {
  return Boolean(guild) && guild.status !== GUILD_STATUS.DISCONNECTED;
}

export function buildRecord(
  interaction,
  { kind, command, input = {}, customId = null, config = null, version = null, status },
) {
  const user = interactionUser(interaction);
  return {
    id: interaction.id,
    guildId: interaction.guild_id ?? null,
    channelId: interaction.channel_id ?? interaction.channel?.id ?? null,
    userId: user.id,
    userName: user.name,
    kind,
    command,
    customId,
    input,
    configSnapshot: config,
    configVersion: version,
    tokenEnc: interaction.token ? encrypt(interaction.token) : null,
    tokenExpiresAt: new Date(Date.now() + TIMING.interactionTokenTtlMs),
    ...(status ? { status } : {}),
  };
}

export async function recordInteraction(record, { withProcessJob }) {
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(interactions)
      .values(record)
      .onConflictDoNothing()
      .returning({
        id: interactions.id,
        guildId: interactions.guildId,
        receivedAt: interactions.receivedAt,
      });
    if (!inserted) return { duplicate: true };
    if (withProcessJob) await enqueueJobs([jobSpec(JOB_KIND.PROCESS, inserted)], tx);
    return { duplicate: false };
  });
}

export function recordDuplicate(interaction) {
  return recordEvent({
    type: EVENT_TYPE.DUPLICATE_INTERACTION,
    level: 'warn',
    guildId: interaction.guild_id ?? null,
    interactionId: interaction.id,
    data: { type: interaction.type },
  });
}

export async function updateAckTime(interactionId, ackMs) {
  await db.update(interactions).set({ ackMs }).where(eq(interactions.id, interactionId));
}

export async function statusSummary(guildId) {
  const [reportStats] = await db
    .select({
      open: sql`count(*) filter (where ${reports.status} <> ${REPORT_STATUS.RESOLVED})`.mapWith(
        Number,
      ),
      openHigh:
        sql`count(*) filter (where ${reports.status} <> ${REPORT_STATUS.RESOLVED} and ${reports.priority} = 'high')`.mapWith(
          Number,
        ),
      today: sql`count(*) filter (where ${reports.createdAt} >= date_trunc('day', now()))`.mapWith(
        Number,
      ),
    })
    .from(reports)
    .where(eq(reports.guildId, guildId));
  const [jobStats] = await db
    .select({
      retrying: sql`count(*) filter (where ${jobs.status} = ${JOB_STATUS.RETRYING})`.mapWith(
        Number,
      ),
      failed: sql`count(*) filter (where ${jobs.status} = ${JOB_STATUS.DEAD})`.mapWith(Number),
      lastMirror: sql`max(${jobs.updatedAt}) filter (where ${jobs.kind} = ${JOB_KIND.MIRROR} and ${jobs.status} = ${JOB_STATUS.SUCCEEDED})`,
    })
    .from(jobs)
    .where(eq(jobs.guildId, guildId));
  return { ...reportStats, ...jobStats };
}

export function statusMessage(summary) {
  const lastMirror = summary.lastMirror
    ? `<t:${Math.floor(new Date(summary.lastMirror).getTime() / 1000)}:R>`
    : 'none yet';
  return [
    `Open reports: **${summary.open}** (${summary.openHigh} high priority)`,
    `Reports today: **${summary.today}**`,
    `Deliveries retrying: **${summary.retrying}** · failed: **${summary.failed}**`,
    `Last successful mirror: ${lastMirror}`,
  ].join('\n');
}

export async function consumeConnectCode(rawCode, guildId) {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [code] = await tx
      .update(connectCodes)
      .set({ usedAt: now, usedGuildId: guildId })
      .where(
        and(
          eq(connectCodes.codeHash, sha256(normalizeCode(rawCode))),
          isNull(connectCodes.usedAt),
          gt(connectCodes.expiresAt, now),
        ),
      )
      .returning({ adminId: connectCodes.adminId });
    if (!code) return null;
    await tx
      .insert(guilds)
      .values({ id: guildId, name: `Server ${guildId}`, connectedBy: code.adminId })
      .onConflictDoUpdate({
        target: guilds.id,
        set: {
          status: GUILD_STATUS.CONNECTED,
          attentionReason: null,
          connectedAt: now,
          connectedBy: code.adminId,
          updatedAt: now,
        },
      });
    await tx.insert(adminGuilds).values({ adminId: code.adminId, guildId }).onConflictDoNothing();
    await ensureDefaultConfigs(guildId, tx);
    return code;
  });
}

export async function registerGuildCommands(guildId) {
  await discord.setGuildCommands(guildId, GUILD_COMMANDS);
}

export async function finishConnect(guildId, adminId, token) {
  let name = null;
  try {
    const guild = await discord.getGuild(guildId);
    name = truncate(guild.name, 100);
    await db.update(guilds).set({ name, updatedAt: new Date() }).where(eq(guilds.id, guildId));
  } catch {
    name = null;
  }

  let commandsRegistered = true;
  try {
    await registerGuildCommands(guildId);
  } catch {
    commandsRegistered = false;
    await db
      .update(guilds)
      .set({
        status: GUILD_STATUS.NEEDS_ATTENTION,
        attentionReason:
          'Slash commands could not be registered. Use Re-register commands in the dashboard.',
        updatedAt: new Date(),
      })
      .where(eq(guilds.id, guildId));
  }

  await recordEvent({
    type: EVENT_TYPE.GUILD_CONNECTED,
    guildId,
    data: { adminId, commandsRegistered },
  });

  const label = name ? `**${name}**` : 'This server';
  await discord.editOriginalResponse(
    token,
    message({
      content: commandsRegistered
        ? `${label} is connected. Choose a report channel and a mirror in the dashboard to finish setup.`
        : `${label} is linked, but registering /report and /status failed. Use Re-register commands in the dashboard.`,
    }),
  );
}

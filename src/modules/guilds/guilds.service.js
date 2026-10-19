import { and, desc, eq, isNull } from 'drizzle-orm';
import { EVENT_TYPE, GUILD_STATUS, TIMING } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { UpstreamError, ValidationError } from '../../common/errors.js';
import { recordEvent } from '../../common/events.js';
import { db } from '../../db/index.js';
import { adminGuilds, connectCodes, guilds } from '../../db/schema.js';
import { decrypt, encrypt, randomCode, sha256 } from '../../utils/crypto.js';
import { DeliveryError } from '../../utils/http.js';
import { errorText } from '../../utils/scrub.js';
import { discord } from '../discord/discord.client.js';
import { basePermissions, canBotPost, channelPermissions } from '../discord/discord.permissions.js';
import { registerGuildCommands } from '../interactions/interactions.service.js';
import { sendMirror } from '../mirror/mirror.service.js';
import { botInviteUrl, maskWebhookUrl, validateWebhookUrl } from './webhooks.js';

const POSTABLE_CHANNEL_TYPES = new Set([0, 5]);

export function toGuildView(guild) {
  return {
    id: guild.id,
    name: guild.name,
    status: guild.status,
    attentionReason: guild.attentionReason,
    postChannelId: guild.postChannelId,
    mirrorKind: guild.mirrorKind,
    mirrorUrlMasked: guild.mirrorUrlEnc ? maskWebhookUrl(decrypt(guild.mirrorUrlEnc)) : null,
    settings: guild.settings,
    connectedAt: guild.connectedAt,
    updatedAt: guild.updatedAt,
  };
}

export async function listGuildsForAdmin(adminId) {
  const rows = await db
    .select({ guild: guilds })
    .from(adminGuilds)
    .innerJoin(guilds, eq(guilds.id, adminGuilds.guildId))
    .where(eq(adminGuilds.adminId, adminId))
    .orderBy(desc(guilds.connectedAt));
  return rows.map((row) => toGuildView(row.guild));
}

function upstream(error, fallback) {
  if (error instanceof DeliveryError && [403, 404].includes(error.httpStatus)) {
    return new UpstreamError(
      'The bot no longer has access to this server. Add it again, then run /connect.',
      'bot_missing',
    );
  }
  return new UpstreamError(fallback);
}

export async function listChannels(guildId) {
  let guild;
  let member;
  let channels;
  try {
    [guild, member, channels] = await Promise.all([
      discord.getGuild(guildId),
      discord.getGuildMember(guildId, env.DISCORD_APPLICATION_ID),
      discord.getGuildChannels(guildId),
    ]);
  } catch (error) {
    throw upstream(error, 'Discord did not return the channel list. Try again shortly.');
  }
  const scope = {
    guildId,
    ownerId: guild.owner_id,
    roles: guild.roles ?? [],
    memberId: env.DISCORD_APPLICATION_ID,
    memberRoleIds: member.roles ?? [],
  };
  const base = basePermissions(scope);
  return channels
    .filter((channel) => POSTABLE_CHANNEL_TYPES.has(channel.type))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type === 5 ? 'announcement' : 'text',
      canPost: canBotPost(
        channelPermissions(base, { ...scope, overwrites: channel.permission_overwrites ?? [] }),
      ),
    }));
}

export async function updateSettings(guild, input, adminId) {
  const fields = {};
  if (input.postChannelId) {
    const channels = await listChannels(guild.id);
    const channel = channels.find((candidate) => candidate.id === input.postChannelId);
    if (!channel) fields.postChannelId = 'That channel no longer exists.';
    else if (!channel.canPost) {
      fields.postChannelId = `The bot needs View Channel, Send Messages, Embed Links and Read Message History in #${channel.name}.`;
    }
  }

  let mirrorUrlEnc = null;
  if (input.mirrorKind !== 'none') {
    const typed = input.mirrorUrl?.trim() ?? '';
    if (!typed) {
      if (guild.mirrorKind === input.mirrorKind && guild.mirrorUrlEnc)
        mirrorUrlEnc = guild.mirrorUrlEnc;
      else fields.mirrorUrl = 'Enter the webhook URL for this mirror.';
    } else {
      const check = validateWebhookUrl(input.mirrorKind, typed);
      if (check.ok) mirrorUrlEnc = encrypt(check.url);
      else fields.mirrorUrl = check.reason;
    }
  }
  if (Object.keys(fields).length > 0) throw new ValidationError(undefined, fields);

  const [updated] = await db
    .update(guilds)
    .set({
      postChannelId: input.postChannelId,
      mirrorKind: input.mirrorKind,
      mirrorUrlEnc,
      status: guild.status === GUILD_STATUS.NEEDS_ATTENTION ? GUILD_STATUS.CONNECTED : guild.status,
      attentionReason: null,
      updatedAt: new Date(),
    })
    .where(eq(guilds.id, guild.id))
    .returning();
  await recordEvent({
    type: EVENT_TYPE.GUILD_UPDATED,
    guildId: guild.id,
    data: {
      adminId,
      postChannelChanged: guild.postChannelId !== input.postChannelId,
      mirrorKind: input.mirrorKind,
      mirrorUrlReplaced: Boolean(input.mirrorUrl?.trim()),
    },
  });
  return toGuildView(updated);
}

export async function sendTestMirror(guild) {
  if (guild.mirrorKind === 'none' || !guild.mirrorUrlEnc) {
    throw new ValidationError('Set up a mirror before sending a test message.', {
      mirrorKind: 'Choose a mirror type and save it first.',
    });
  }
  try {
    await sendMirror(
      guild,
      {
        title: 'Test message from the admin dashboard',
        body: 'Mirroring is set up correctly for this server.',
        priority: null,
        guildName: guild.name,
        ref: `test-${Date.now()}`,
      },
      { reconcile: false },
    );
  } catch (error) {
    throw new UpstreamError(
      `The mirror did not accept the test message: ${errorText(error)}`,
      'mirror_failed',
    );
  }
}

export async function disconnectGuild(guild, adminId) {
  let commandsRemoved = true;
  try {
    await discord.setGuildCommands(guild.id, []);
  } catch {
    commandsRemoved = false;
  }
  await db
    .update(guilds)
    .set({ status: GUILD_STATUS.DISCONNECTED, updatedAt: new Date() })
    .where(eq(guilds.id, guild.id));
  await recordEvent({
    type: EVENT_TYPE.GUILD_DISCONNECTED,
    guildId: guild.id,
    data: { adminId, commandsRemoved },
  });
  return { commandsRemoved };
}

export async function syncCommands(guild) {
  try {
    await registerGuildCommands(guild.id);
  } catch (error) {
    throw upstream(error, 'Discord did not accept the commands. Try again shortly.');
  }
  if (guild.status === GUILD_STATUS.NEEDS_ATTENTION) {
    await db
      .update(guilds)
      .set({ status: GUILD_STATUS.CONNECTED, attentionReason: null, updatedAt: new Date() })
      .where(eq(guilds.id, guild.id));
  }
}

export async function createConnectCode(adminId) {
  const code = randomCode(8);
  const expiresAt = new Date(Date.now() + TIMING.connectCodeTtlMs);
  await db.transaction(async (tx) => {
    await tx
      .delete(connectCodes)
      .where(and(eq(connectCodes.adminId, adminId), isNull(connectCodes.usedAt)));
    await tx.insert(connectCodes).values({ codeHash: sha256(code), adminId, expiresAt });
  });
  return { code, expiresAt, command: `/connect code:${code}` };
}

export function botInfo() {
  return {
    applicationId: env.DISCORD_APPLICATION_ID,
    inviteUrl: botInviteUrl(env.DISCORD_APPLICATION_ID),
  };
}

export async function updateDemoSettings(guild, settings) {
  const [updated] = await db
    .update(guilds)
    .set({ settings: { ...guild.settings, ...settings }, updatedAt: new Date() })
    .where(eq(guilds.id, guild.id))
    .returning({ settings: guilds.settings });
  return updated.settings;
}

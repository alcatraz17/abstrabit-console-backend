import { ATTEMPT_OUTCOME } from '../../config/constants.js';
import { decrypt } from '../../utils/crypto.js';
import { DeliveryError, requestJson } from '../../utils/http.js';
import { escapeMarkdown, truncate } from '../../utils/text.js';
import { discord } from '../discord/discord.client.js';
import { NO_MENTIONS, capitalize } from '../discord/discord.payloads.js';
import { parseDiscordWebhook } from '../guilds/webhooks.js';

const PRIORITY_COLOR = { high: 0xed4245, normal: 0x5865f2, low: 0x95a5a6 };
const SLACK_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

function slackEscape(value) {
  return String(value).replace(/[&<>]/g, (character) => SLACK_ESCAPES[character]);
}

function discordPayload(notification) {
  return {
    username: 'Abstrabit Console',
    allowed_mentions: NO_MENTIONS,
    embeds: [
      {
        title: truncate(notification.title, 256),
        description: truncate(escapeMarkdown(notification.body), 4000),
        color: PRIORITY_COLOR[notification.priority] ?? PRIORITY_COLOR.normal,
        fields: [
          {
            name: 'Server',
            value: truncate(escapeMarkdown(notification.guildName), 1024),
            inline: true,
          },
          ...(notification.priority
            ? [{ name: 'Priority', value: capitalize(notification.priority), inline: true }]
            : []),
        ],
        footer: { text: `Ref ${notification.ref}` },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function slackPayload(notification) {
  const priority = notification.priority ? ` · ${capitalize(notification.priority)} priority` : '';
  return {
    text: `${slackEscape(notification.title)}${priority}\n${slackEscape(truncate(notification.body, 2500))}\nServer: ${slackEscape(notification.guildName)} · Ref ${notification.ref}`,
  };
}

async function findExistingDiscordMessage(webhook, ref) {
  try {
    const info = await requestJson(
      `https://discord.com/api/v10/webhooks/${webhook.id}/${webhook.token}`,
      {
        route: 'GET /webhooks/:id/:token',
      },
    );
    const messages = await discord.listChannelMessages(info.channel_id, 50);
    const found = messages.find(
      (candidate) =>
        candidate.webhook_id === webhook.id &&
        candidate.embeds?.some((embed) => embed.footer?.text === `Ref ${ref}`),
    );
    return found?.id ?? null;
  } catch {
    return null;
  }
}

export async function sendMirror(guild, notification, { reconcile }) {
  if (guild.settings?.mirrorOutage) {
    throw new DeliveryError({
      route: 'POST /webhooks/:id/:token',
      outcome: ATTEMPT_OUTCOME.UNKNOWN,
      httpStatus: 503,
      detail: 'simulated mirror outage',
    });
  }
  if (guild.mirrorKind === 'none' || !guild.mirrorUrlEnc) return { skipped: true };
  const url = decrypt(guild.mirrorUrlEnc);

  if (guild.mirrorKind === 'slack') {
    await requestJson(url, {
      route: 'POST /services/:team/:bot/:token',
      method: 'POST',
      body: slackPayload(notification),
    });
    return { delivered: 'slack' };
  }

  const webhook = parseDiscordWebhook(url);
  if (reconcile && webhook) {
    const existing = await findExistingDiscordMessage(webhook, notification.ref);
    if (existing) return { messageId: existing, reconciled: true };
  }
  const created = await requestJson(`${url}?wait=true`, {
    route: 'POST /webhooks/:id/:token',
    method: 'POST',
    body: discordPayload(notification),
  });
  return { messageId: created?.id ?? null };
}

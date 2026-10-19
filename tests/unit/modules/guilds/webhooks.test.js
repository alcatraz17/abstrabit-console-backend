import { describe, expect, it } from 'vitest';
import {
  botInviteUrl,
  maskWebhookUrl,
  parseDiscordWebhook,
  validateWebhookUrl,
} from '../../../../src/modules/guilds/webhooks.js';

const discordUrl =
  'https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz_-0123456789';
const slackUrl =
  'https://hooks.slack.com/services/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ittests';

describe('webhook URL validation', () => {
  it('accepts real Discord and Slack webhook shapes', () => {
    expect(validateWebhookUrl('discord', discordUrl)).toEqual({ ok: true, url: discordUrl });
    expect(validateWebhookUrl('discord', `${discordUrl}/`)).toEqual({ ok: true, url: discordUrl });
    expect(
      validateWebhookUrl(
        'discord',
        discordUrl.replace('discord.com/api', 'canary.discord.com/api/v10'),
      ).ok,
    ).toBe(true);
    expect(validateWebhookUrl('slack', `  ${slackUrl}  `)).toEqual({ ok: true, url: slackUrl });
  });

  it.each([
    ['empty', ''],
    ['not a URL', 'discord webhook'],
    ['http', discordUrl.replace('https', 'http')],
    ['credentials', discordUrl.replace('https://', 'https://user:pass@')],
    ['port', discordUrl.replace('discord.com', 'discord.com:8443')],
    ['query', `${discordUrl}?thread_id=1`],
    ['lookalike host', discordUrl.replace('discord.com', 'discord.com.evil.example')],
    [
      'internal address',
      'https://169.254.169.254/api/webhooks/123456789012345678/abcdefghijklmnopqrstu',
    ],
    ['wrong path', 'https://discord.com/api/channels/123456789012345678/messages'],
    ['too long', `${discordUrl}${'a'.repeat(400)}`],
  ])('rejects %s', (_label, value) => {
    expect(validateWebhookUrl('discord', value).ok).toBe(false);
  });

  it('keeps Discord and Slack URLs apart', () => {
    expect(validateWebhookUrl('slack', discordUrl).ok).toBe(false);
    expect(validateWebhookUrl('discord', slackUrl).ok).toBe(false);
  });

  it('masks and parses URLs without leaking the token', () => {
    expect(maskWebhookUrl(discordUrl)).toBe('discord.com/…/••••6789');
    expect(maskWebhookUrl('not a url')).toBe('••••');
    expect(parseDiscordWebhook(discordUrl)).toEqual({
      id: '123456789012345678',
      token: 'AbCdEfGhIjKlMnOpQrStUvWxYz_-0123456789',
    });
  });

  it('builds the invite with exactly the permissions the bot needs', () => {
    const url = new URL(botInviteUrl('123456789012345678'));
    expect(url.searchParams.get('permissions')).toBe('84992');
    expect(url.searchParams.get('scope')).toBe('bot applications.commands');
  });
});

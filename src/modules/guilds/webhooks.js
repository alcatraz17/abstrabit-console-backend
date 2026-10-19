import { BOT_CHANNEL_PERMISSIONS } from '../../config/constants.js';

const MAX_URL_LENGTH = 300;
const DISCORD_HOSTS = new Set([
  'discord.com',
  'ptb.discord.com',
  'canary.discord.com',
  'discordapp.com',
]);
const DISCORD_PATH = /^\/api(?:\/v\d{1,2})?\/webhooks\/(\d{17,20})\/([A-Za-z0-9_-]{20,100})$/;
const SLACK_HOST = 'hooks.slack.com';
const SLACK_PATH = /^\/services\/T[A-Z0-9]{6,}\/B[A-Z0-9]{6,}\/[A-Za-z0-9]{20,}$/;

function fail(reason) {
  return { ok: false, reason };
}

export function validateWebhookUrl(kind, raw) {
  const value = String(raw ?? '').trim();
  if (!value) return fail('Enter the webhook URL.');
  if (value.length > MAX_URL_LENGTH) return fail('The webhook URL is too long.');
  let url;
  try {
    url = new URL(value);
  } catch {
    return fail('Enter a complete URL starting with https://.');
  }
  if (url.protocol !== 'https:') return fail('The webhook URL must use https.');
  if (url.username || url.password) return fail('The webhook URL must not contain credentials.');
  if (url.port) return fail('The webhook URL must not specify a port.');
  if (url.search || url.hash) return fail('Remove query parameters and fragments from the URL.');
  const path = url.pathname.replace(/\/$/, '');
  if (kind === 'discord') {
    if (!DISCORD_HOSTS.has(url.hostname) || !DISCORD_PATH.test(path)) {
      return fail(
        'This is not a Discord webhook URL. Copy it from Channel settings, Integrations.',
      );
    }
  } else if (kind === 'slack') {
    if (url.hostname !== SLACK_HOST || !SLACK_PATH.test(path)) {
      return fail('This is not a Slack incoming webhook URL.');
    }
  } else {
    return fail('Choose a mirror type.');
  }
  return { ok: true, url: `${url.origin}${path}` };
}

export function parseDiscordWebhook(url) {
  const match = DISCORD_PATH.exec(new URL(url).pathname.replace(/\/$/, ''));
  return match ? { id: match[1], token: match[2] } : null;
}

export function maskWebhookUrl(raw) {
  try {
    const url = new URL(raw);
    const tail = url.pathname.split('/').filter(Boolean).at(-1)?.slice(-4) ?? '';
    return `${url.hostname}/…/••••${tail}`;
  } catch {
    return '••••';
  }
}

export function botInviteUrl(applicationId) {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', applicationId);
  url.searchParams.set('scope', 'bot applications.commands');
  url.searchParams.set('permissions', BOT_CHANNEL_PERMISSIONS.toString());
  url.searchParams.set('integration_type', '0');
  return url.toString();
}

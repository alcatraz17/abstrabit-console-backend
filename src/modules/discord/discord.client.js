import { env } from '../../config/env.js';
import { requestJson } from '../../utils/http.js';

export const DISCORD_API = 'https://discord.com/api/v10';
const USER_AGENT = 'DiscordBot (https://github.com/alcatraz17/abstrabit-console-backend, 1.0.0)';

export const GUILD_ATTENTION_CODES = new Set([10003, 10004, 10015, 50001, 50013]);

function buildPath(route, params = {}) {
  return route.replace(/:(\w+)/g, (_, name) => {
    const value = params[name];
    if (value === undefined || value === null) throw new Error(`Missing route parameter ${name}.`);
    return encodeURIComponent(String(value));
  });
}

export function discordRequest(method, route, { params, query, body, auth = true } = {}) {
  const search = query ? `?${new URLSearchParams(query).toString()}` : '';
  return requestJson(`${DISCORD_API}${buildPath(route, params)}${search}`, {
    route: `${method} ${route}`,
    method,
    body,
    headers: {
      'User-Agent': USER_AGENT,
      ...(auth ? { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } : {}),
    },
  });
}

const appId = env.DISCORD_APPLICATION_ID;

export const discord = {
  editOriginalResponse: (token, payload) =>
    discordRequest('PATCH', '/webhooks/:appId/:token/messages/@original', {
      params: { appId, token },
      body: payload,
      auth: false,
    }),
  createFollowup: (token, payload) =>
    discordRequest('POST', '/webhooks/:appId/:token', {
      params: { appId, token },
      body: payload,
      auth: false,
    }),
  createChannelMessage: (channelId, payload) =>
    discordRequest('POST', '/channels/:channelId/messages', {
      params: { channelId },
      body: payload,
    }),
  editChannelMessage: (channelId, messageId, payload) =>
    discordRequest('PATCH', '/channels/:channelId/messages/:messageId', {
      params: { channelId, messageId },
      body: payload,
    }),
  listChannelMessages: (channelId, limit = 50) =>
    discordRequest('GET', '/channels/:channelId/messages', {
      params: { channelId },
      query: { limit: String(limit) },
    }),
  getGuild: (guildId) => discordRequest('GET', '/guilds/:guildId', { params: { guildId } }),
  getGuildChannels: (guildId) =>
    discordRequest('GET', '/guilds/:guildId/channels', { params: { guildId } }),
  getGuildMember: (guildId, userId) =>
    discordRequest('GET', '/guilds/:guildId/members/:userId', { params: { guildId, userId } }),
  setGuildCommands: (guildId, commands) =>
    discordRequest('PUT', '/applications/:appId/guilds/:guildId/commands', {
      params: { appId, guildId },
      body: commands,
    }),
  setGlobalCommands: (commands) =>
    discordRequest('PUT', '/applications/:appId/commands', { params: { appId }, body: commands }),
};

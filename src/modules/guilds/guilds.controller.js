import {
  botInfo,
  createConnectCode,
  disconnectGuild,
  listChannels,
  listGuildsForAdmin,
  sendTestMirror,
  syncCommands,
  toGuildView,
  updateDemoSettings,
  updateSettings,
} from './guilds.service.js';

export async function list(req, res) {
  res.json({ guilds: await listGuildsForAdmin(req.admin.id) });
}

export function show(req, res) {
  res.json({ guild: toGuildView(req.guild) });
}

export async function channels(req, res) {
  res.json({ channels: await listChannels(req.guild.id) });
}

export async function settings(req, res) {
  res.json({ guild: await updateSettings(req.guild, req.valid.body, req.admin.id) });
}

export async function testMirror(req, res) {
  await sendTestMirror(req.guild);
  res.status(204).end();
}

export async function commandsSync(req, res) {
  await syncCommands(req.guild);
  res.status(204).end();
}

export async function disconnect(req, res) {
  res.json(await disconnectGuild(req.guild, req.admin.id));
}

export function demo(req, res) {
  res.json({ settings: req.guild.settings });
}

export async function updateDemo(req, res) {
  res.json({ settings: await updateDemoSettings(req.guild, req.valid.body) });
}

export async function connectCode(req, res) {
  res.status(201).json(await createConnectCode(req.admin.id));
}

export function bot(_req, res) {
  res.json(botInfo());
}

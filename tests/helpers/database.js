import { db, pool } from '../../src/db/index.js';
import { adminGuilds, guilds } from '../../src/db/schema.js';
import { upsertAdmin } from '../../src/modules/auth/auth.service.js';
import { ensureDefaultConfigs } from '../../src/modules/commands/commands.service.js';
import { encrypt } from '../../src/utils/crypto.js';

const TABLES = [
  'job_attempts',
  'jobs',
  'reports',
  'interactions',
  'command_configs',
  'connect_codes',
  'admin_guilds',
  'guilds',
  'events',
  'session',
  'admins',
];

export const ADMIN = { email: 'admin@example.com', password: 'correct horse battery staple' };
export const GUILD_ID = '300000000000000001';
export const REPORT_CHANNEL_ID = '300000000000000011';
export const MIRROR_URL =
  'https://discord.com/api/webhooks/300000000000000099/mirrorWebhookTokenValue_abcdefghij';

export async function resetDatabase() {
  await pool.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

export async function createAdmin(overrides = {}) {
  const admin = { ...ADMIN, ...overrides };
  const result = await upsertAdmin(admin.email, admin.password, { reset: false });
  return { ...admin, id: result.id };
}

export async function createGuild({
  adminId,
  id = GUILD_ID,
  name = 'Test Server',
  status = 'connected',
  postChannelId = REPORT_CHANNEL_ID,
  mirrorKind = 'discord',
  mirrorUrl = MIRROR_URL,
  settings = { mirrorOutage: false, slowAi: false },
} = {}) {
  await db.insert(guilds).values({
    id,
    name,
    status,
    postChannelId,
    mirrorKind,
    mirrorUrlEnc: mirrorKind === 'none' ? null : encrypt(mirrorUrl),
    settings,
    connectedBy: adminId ?? null,
  });
  if (adminId) await db.insert(adminGuilds).values({ adminId, guildId: id });
  await ensureDefaultConfigs(id);
  return id;
}

export async function query(text, params = []) {
  const { rows } = await pool.query(text, params);
  return rows;
}

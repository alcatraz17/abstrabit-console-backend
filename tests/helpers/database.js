import { pool } from '../../src/db/index.js';
import { upsertAdmin } from '../../src/modules/auth/auth.service.js';

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

export async function resetDatabase() {
  await pool.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

export async function createAdmin(overrides = {}) {
  const admin = { ...ADMIN, ...overrides };
  const result = await upsertAdmin(admin.email, admin.password, { reset: false });
  return { ...admin, id: result.id };
}

export async function query(text, params = []) {
  const { rows } = await pool.query(text, params);
  return rows;
}

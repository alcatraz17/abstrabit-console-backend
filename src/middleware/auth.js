import { and, eq } from 'drizzle-orm';
import { NotFoundError, UnauthorizedError } from '../common/errors.js';
import { recordEvent } from '../common/events.js';
import { EVENT_TYPE, TIMING } from '../config/constants.js';
import { env } from '../config/env.js';
import { db } from '../db/index.js';
import { adminGuilds, admins, guilds } from '../db/schema.js';
import { safeEqual } from '../utils/crypto.js';

function destroySession(req) {
  return new Promise((resolve) => req.session.destroy(() => resolve()));
}

export function isSessionExpired(sessionData, now = Date.now()) {
  const createdAt = Number(sessionData?.createdAt);
  return !Number.isFinite(createdAt) || now - createdAt >= TIMING.sessionAbsoluteMs;
}

export async function requireAdmin(req, _res, next) {
  const adminId = req.session?.adminId;
  if (!adminId) return next(new UnauthorizedError());
  if (isSessionExpired(req.session)) {
    await destroySession(req);
    return next(
      new UnauthorizedError('Your session has expired. Sign in again.', 'session_expired'),
    );
  }
  const [admin] = await db
    .select({ id: admins.id, email: admins.email })
    .from(admins)
    .where(eq(admins.id, adminId))
    .limit(1);
  if (!admin) {
    await destroySession(req);
    return next(new UnauthorizedError());
  }
  req.admin = admin;
  return next();
}

export async function requireGuildAccess(req, _res, next) {
  const guildId = req.params.guildId;
  const [row] = await db
    .select({ guild: guilds })
    .from(adminGuilds)
    .innerJoin(guilds, eq(guilds.id, adminGuilds.guildId))
    .where(and(eq(adminGuilds.adminId, req.admin.id), eq(adminGuilds.guildId, guildId)))
    .limit(1);
  if (!row) return next(new NotFoundError('That server is not linked to your account.'));
  req.guild = row.guild;
  return next();
}

export async function requireCronSecret(req, _res, next) {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (token && safeEqual(token, env.CRON_SECRET)) return next();
  await recordEvent({
    type: EVENT_TYPE.CRON_UNAUTHORIZED,
    level: 'warn',
    data: { ip: req.ip, path: req.path },
  });
  return next(new UnauthorizedError('A valid cron secret is required.'));
}

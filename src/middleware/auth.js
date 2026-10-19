import { eq } from 'drizzle-orm';
import { UnauthorizedError } from '../common/errors.js';
import { TIMING } from '../config/constants.js';
import { db } from '../db/index.js';
import { admins } from '../db/schema.js';

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

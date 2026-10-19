import bcrypt from 'bcryptjs';
import { and, count, eq, gt, min, sql } from 'drizzle-orm';
import { EVENT_TYPE, LOGIN_LIMITS, TIMING } from '../../config/constants.js';
import { TooManyRequestsError } from '../../common/errors.js';
import { recordEvent } from '../../common/events.js';
import { db } from '../../db/index.js';
import { admins, events, sessions } from '../../db/schema.js';

const BCRYPT_COST = 10;
let dummyHash;

function getDummyHash() {
  dummyHash ??= bcrypt.hashSync('timing-equalisation-placeholder', BCRYPT_COST);
  return dummyHash;
}

export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

async function countRecentFailures(field, value, since) {
  const [row] = await db
    .select({ failures: count(), oldest: min(events.ts) })
    .from(events)
    .where(
      and(
        eq(events.type, EVENT_TYPE.LOGIN_FAILED),
        gt(events.ts, since),
        sql`${events.data} ->> ${field} = ${value}`,
      ),
    );
  return { failures: Number(row?.failures ?? 0), oldest: row?.oldest ?? null };
}

function retryAfterSeconds(oldest, now) {
  if (!oldest) return Math.ceil(TIMING.loginWindowMs / 1000);
  return Math.max(1, Math.ceil((new Date(oldest).getTime() + TIMING.loginWindowMs - now) / 1000));
}

export async function assertLoginAllowed(email, ip) {
  const now = Date.now();
  const windowStart = new Date(now - TIMING.loginWindowMs);
  const [admin] = await db
    .select({ lastLoginAt: admins.lastLoginAt })
    .from(admins)
    .where(eq(admins.email, email))
    .limit(1);
  const emailSince =
    admin?.lastLoginAt && admin.lastLoginAt > windowStart ? admin.lastLoginAt : windowStart;

  const [byEmail, byIp] = await Promise.all([
    countRecentFailures('email', email, emailSince),
    ip ? countRecentFailures('ip', ip, windowStart) : { failures: 0, oldest: null },
  ]);

  const limited =
    byEmail.failures >= LOGIN_LIMITS.perEmail
      ? byEmail
      : byIp.failures >= LOGIN_LIMITS.perIp
        ? byIp
        : null;
  if (limited) {
    throw new TooManyRequestsError(
      'Too many failed sign-in attempts. Try again later.',
      retryAfterSeconds(limited.oldest, now),
    );
  }
}

export async function authenticate(email, password) {
  const [admin] = await db.select().from(admins).where(eq(admins.email, email)).limit(1);
  const matches = await bcrypt.compare(password, admin?.passwordHash ?? getDummyHash());
  if (!admin || !matches) return null;
  await db.update(admins).set({ lastLoginAt: new Date() }).where(eq(admins.id, admin.id));
  return { id: admin.id, email: admin.email };
}

export function recordLoginFailure(email, ip) {
  return recordEvent({
    type: EVENT_TYPE.LOGIN_FAILED,
    level: 'warn',
    data: { email, ip: ip ?? null },
  });
}

export function recordLoginSuccess(admin, ip) {
  return recordEvent({
    type: EVENT_TYPE.LOGIN_SUCCEEDED,
    data: { email: admin.email, ip: ip ?? null },
  });
}

export async function upsertAdmin(email, password, { reset }) {
  const passwordHash = await hashPassword(password);
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: admins.id })
      .from(admins)
      .where(eq(admins.email, email))
      .limit(1);
    if (existing && !reset) return { created: false, updated: false, id: existing.id };
    if (existing) {
      await tx.update(admins).set({ passwordHash }).where(eq(admins.id, existing.id));
      await tx.delete(sessions).where(sql`${sessions.sess} ->> 'adminId' = ${existing.id}`);
      return { created: false, updated: true, id: existing.id };
    }
    const [created] = await tx
      .insert(admins)
      .values({ email, passwordHash })
      .returning({ id: admins.id });
    return { created: true, updated: false, id: created.id };
  });
}

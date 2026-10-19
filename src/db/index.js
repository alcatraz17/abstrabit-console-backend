import { attachDatabasePool } from '@vercel/functions';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import * as schema from './schema.js';

export function createPool(connectionString = env.DATABASE_URL) {
  const pool = new pg.Pool({
    connectionString,
    max: env.DATABASE_POOL_MAX,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    ...(env.DATABASE_CA_CERT
      ? { ssl: { ca: env.DATABASE_CA_CERT, rejectUnauthorized: true } }
      : {}),
  });
  pool.on('error', (error) => logger.error({ err: error }, 'Idle database client error'));
  return pool;
}

export const pool = createPool();

if (process.env.VERCEL) attachDatabasePool(pool);

export const db = drizzle(pool, { schema });

export async function closeDatabase() {
  await pool.end();
}

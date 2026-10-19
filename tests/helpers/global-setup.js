import pg from 'pg';
import { runMigrations } from '../../scripts/migrate.js';

const url =
  process.env.TEST_DATABASE_URL ?? 'postgres://app:app@127.0.0.1:54329/abstrabit_console_test';

export default async function setup() {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
  } catch {
    throw new Error('The test database is not reachable. Start it with "npm run test:db".');
  }
  await client.query(
    'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;',
  );
  await client.end();
  await runMigrations(url);
}

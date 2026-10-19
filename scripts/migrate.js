import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export async function runMigrations(connectionString, caCert) {
  const client = new pg.Client({
    connectionString,
    ...(caCert ? { ssl: { ca: caCert, rejectUnauthorized: true } } : {}),
  });
  await client.connect();
  try {
    await migrate(drizzle(client), {
      migrationsFolder: path.resolve(import.meta.dirname, '../src/db/migrations'),
    });
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Set MIGRATION_DATABASE_URL or DATABASE_URL before running migrations.');
    process.exit(1);
  }
  try {
    await runMigrations(connectionString, process.env.DATABASE_CA_CERT || undefined);
    console.log('Migrations applied.');
  } catch (error) {
    console.error(`Migration failed: ${error.message}`);
    process.exit(1);
  }
}

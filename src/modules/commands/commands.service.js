import { and, eq, sql } from 'drizzle-orm';
import { CONFIGURABLE_COMMANDS, EVENT_TYPE } from '../../config/constants.js';
import { ConflictError } from '../../common/errors.js';
import { recordEvent } from '../../common/events.js';
import { db } from '../../db/index.js';
import { commandConfigs } from '../../db/schema.js';
import { defaultCommandConfig } from './command-defaults.js';

function toView(row) {
  return {
    command: row.command,
    version: row.version,
    config: row.config,
    updatedAt: row.updatedAt,
  };
}

export async function ensureDefaultConfigs(guildId, executor = db) {
  await executor
    .insert(commandConfigs)
    .values(
      CONFIGURABLE_COMMANDS.map((command) => ({
        guildId,
        command,
        config: defaultCommandConfig(command),
      })),
    )
    .onConflictDoNothing();
}

export async function getCommandConfig(guildId, command) {
  const [row] = await db
    .select()
    .from(commandConfigs)
    .where(and(eq(commandConfigs.guildId, guildId), eq(commandConfigs.command, command)))
    .limit(1);
  if (row) return toView(row);
  await ensureDefaultConfigs(guildId);
  return getCommandConfig(guildId, command);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function changedKeys(before, after) {
  return Object.keys(after).filter(
    (key) => JSON.stringify(canonical(before[key])) !== JSON.stringify(canonical(after[key])),
  );
}

export async function saveCommandConfig({ guildId, command, expectedVersion, config, adminId }) {
  const current = await getCommandConfig(guildId, command);
  const [saved] = await db
    .update(commandConfigs)
    .set({
      config,
      version: sql`${commandConfigs.version} + 1`,
      updatedAt: new Date(),
      updatedBy: adminId,
    })
    .where(
      and(
        eq(commandConfigs.guildId, guildId),
        eq(commandConfigs.command, command),
        eq(commandConfigs.version, expectedVersion),
      ),
    )
    .returning();
  if (!saved) {
    throw new ConflictError(
      `This configuration was changed by someone else (now version ${current.version}). Reload it and apply your changes again.`,
      'version_conflict',
    );
  }
  await recordEvent({
    type: EVENT_TYPE.CONFIG_CHANGED,
    guildId,
    data: {
      command,
      fromVersion: expectedVersion,
      toVersion: saved.version,
      changed: changedKeys(current.config, config),
      adminId,
    },
  });
  return toView(saved);
}

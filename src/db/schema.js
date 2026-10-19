import { sql } from 'drizzle-orm';
import {
  bigserial,
  index,
  integer,
  json,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const snowflake = (name) => varchar(name, { length: 20 });
const timestamptz = (name) => timestamp(name, { withTimezone: true });

export const admins = pgTable('admins', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 254 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  lastLoginAt: timestamptz('last_login_at'),
});

export const sessions = pgTable(
  'session',
  {
    sid: varchar('sid').primaryKey(),
    sess: json('sess').notNull(),
    expire: timestamp('expire', { precision: 6 }).notNull(),
  },
  (table) => [index('session_expire_idx').on(table.expire)],
);

export const guilds = pgTable(
  'guilds',
  {
    id: snowflake('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('connected'),
    attentionReason: text('attention_reason'),
    postChannelId: snowflake('post_channel_id'),
    mirrorKind: varchar('mirror_kind', { length: 10 }).notNull().default('none'),
    mirrorUrlEnc: text('mirror_url_enc'),
    settings: jsonb('settings')
      .notNull()
      .default(sql`'{"mirrorOutage":false,"slowAi":false}'::jsonb`),
    connectedAt: timestamptz('connected_at').notNull().defaultNow(),
    connectedBy: uuid('connected_by').references(() => admins.id, { onDelete: 'set null' }),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [index('guilds_status_idx').on(table.status)],
);

export const adminGuilds = pgTable(
  'admin_guilds',
  {
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.id, { onDelete: 'cascade' }),
    guildId: snowflake('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).notNull().default('owner'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.adminId, table.guildId] })],
);

export const connectCodes = pgTable(
  'connect_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codeHash: varchar('code_hash', { length: 64 }).notNull().unique(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.id, { onDelete: 'cascade' }),
    expiresAt: timestamptz('expires_at').notNull(),
    usedAt: timestamptz('used_at'),
    usedGuildId: snowflake('used_guild_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [index('connect_codes_admin_idx').on(table.adminId)],
);

export const commandConfigs = pgTable(
  'command_configs',
  {
    guildId: snowflake('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    command: varchar('command', { length: 32 }).notNull(),
    version: integer('version').notNull().default(1),
    config: jsonb('config').notNull(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => admins.id, { onDelete: 'set null' }),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.command] })],
);

export const interactions = pgTable(
  'interactions',
  {
    id: snowflake('id').primaryKey(),
    guildId: snowflake('guild_id'),
    channelId: snowflake('channel_id'),
    userId: snowflake('user_id'),
    userName: varchar('user_name', { length: 100 }),
    kind: varchar('kind', { length: 20 }).notNull(),
    command: varchar('command', { length: 32 }).notNull(),
    customId: varchar('custom_id', { length: 100 }),
    input: jsonb('input')
      .notNull()
      .default(sql`'{}'::jsonb`),
    configSnapshot: jsonb('config_snapshot'),
    configVersion: integer('config_version'),
    tokenEnc: text('token_enc'),
    tokenExpiresAt: timestamptz('token_expires_at'),
    decision: jsonb('decision'),
    ai: jsonb('ai'),
    reportId: integer('report_id'),
    status: varchar('status', { length: 20 }).notNull().default('received'),
    ackMs: integer('ack_ms'),
    receivedAt: timestamptz('received_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('interactions_guild_received_idx').on(table.guildId, table.receivedAt.desc()),
    index('interactions_guild_updated_idx').on(table.guildId, table.updatedAt),
    index('interactions_user_received_idx').on(table.guildId, table.userId, table.receivedAt),
  ],
);

export const reports = pgTable(
  'reports',
  {
    id: serial('id').primaryKey(),
    guildId: snowflake('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    interactionId: snowflake('interaction_id')
      .notNull()
      .unique()
      .references(() => interactions.id, { onDelete: 'cascade' }),
    authorId: snowflake('author_id').notNull(),
    authorName: varchar('author_name', { length: 100 }).notNull(),
    text: text('text').notNull(),
    severity: varchar('severity', { length: 10 }),
    priority: varchar('priority', { length: 10 }).notNull(),
    tags: jsonb('tags')
      .notNull()
      .default(sql`'[]'::jsonb`),
    aiSummary: text('ai_summary'),
    status: varchar('status', { length: 20 }).notNull().default('open'),
    handledById: snowflake('handled_by_id'),
    handledByName: varchar('handled_by_name', { length: 100 }),
    handledAt: timestamptz('handled_at'),
    channelId: snowflake('channel_id'),
    channelMessageId: snowflake('channel_message_id'),
    mirrorMessageId: varchar('mirror_message_id', { length: 32 }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [index('reports_guild_status_idx').on(table.guildId, table.status)],
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    interactionId: snowflake('interaction_id')
      .notNull()
      .references(() => interactions.id, { onDelete: 'cascade' }),
    guildId: snowflake('guild_id'),
    kind: varchar('kind', { length: 32 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(8),
    nextAttemptAt: timestamptz('next_attempt_at').notNull().defaultNow(),
    lockedUntil: timestamptz('locked_until'),
    leaseToken: uuid('lease_token'),
    deadlineAt: timestamptz('deadline_at'),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    result: jsonb('result'),
    lastError: text('last_error'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('jobs_interaction_kind_unique').on(table.interactionId, table.kind),
    index('jobs_status_next_idx').on(table.status, table.nextAttemptAt),
    index('jobs_guild_status_idx').on(table.guildId, table.status),
  ],
);

export const jobAttempts = pgTable(
  'job_attempts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    attempt: integer('attempt').notNull(),
    startedAt: timestamptz('started_at').notNull(),
    durationMs: integer('duration_ms').notNull(),
    outcome: varchar('outcome', { length: 20 }).notNull(),
    httpStatus: integer('http_status'),
    discordCode: integer('discord_code'),
    error: text('error'),
  },
  (table) => [index('job_attempts_job_idx').on(table.jobId)],
);

export const events = pgTable(
  'events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ts: timestamptz('ts').notNull().defaultNow(),
    level: varchar('level', { length: 10 }).notNull().default('info'),
    type: varchar('type', { length: 40 }).notNull(),
    guildId: snowflake('guild_id'),
    interactionId: snowflake('interaction_id'),
    data: jsonb('data')
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (table) => [
    index('events_ts_idx').on(table.ts.desc()),
    index('events_type_ts_idx').on(table.type, table.ts),
    index('events_interaction_idx').on(table.interactionId),
  ],
);

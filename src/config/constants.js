export const COMMANDS = Object.freeze({ REPORT: 'report', STATUS: 'status', CONNECT: 'connect' });
export const CONFIGURABLE_COMMANDS = Object.freeze([COMMANDS.REPORT, COMMANDS.STATUS]);

export const SEVERITIES = Object.freeze(['low', 'medium', 'high']);
export const PRIORITIES = Object.freeze(['low', 'normal', 'high']);
export const VISIBILITIES = Object.freeze(['ephemeral', 'public']);
export const MIRROR_POLICIES = Object.freeze(['always', 'high_only', 'never']);
export const MIRROR_KINDS = Object.freeze(['discord', 'slack', 'none']);
export const AI_TAGS = Object.freeze([
  'outage',
  'bug',
  'billing',
  'security',
  'performance',
  'account',
  'feature_request',
  'other',
]);

export const GUILD_STATUS = Object.freeze({
  CONNECTED: 'connected',
  NEEDS_ATTENTION: 'needs_attention',
  DISCONNECTED: 'disconnected',
});

export const INTERACTION_KIND = Object.freeze({
  COMMAND: 'command',
  BUTTON: 'button',
  MODAL: 'modal',
});

export const INTERACTION_STATUS = Object.freeze({
  RECEIVED: 'received',
  PROCESSING: 'processing',
  DONE: 'done',
  PARTIAL: 'partial',
  FAILED: 'failed',
  BLOCKED: 'blocked',
});

export const REPORT_STATUS = Object.freeze({
  OPEN: 'open',
  ACKNOWLEDGED: 'acknowledged',
  ESCALATED: 'escalated',
  RESOLVED: 'resolved',
});

export const REPORT_ACTIONS = Object.freeze({
  ack: { status: REPORT_STATUS.ACKNOWLEDGED, from: [REPORT_STATUS.OPEN], requiresManage: false },
  escalate: {
    status: REPORT_STATUS.ESCALATED,
    from: [REPORT_STATUS.OPEN, REPORT_STATUS.ACKNOWLEDGED],
    requiresManage: true,
  },
  resolve: {
    status: REPORT_STATUS.RESOLVED,
    from: [REPORT_STATUS.OPEN, REPORT_STATUS.ACKNOWLEDGED, REPORT_STATUS.ESCALATED],
    requiresManage: true,
  },
});

export const JOB_KIND = Object.freeze({
  PROCESS: 'process',
  AI_ENRICH: 'ai_enrich',
  DISCORD_REPLY: 'discord_reply',
  CHANNEL_POST: 'channel_post',
  MIRROR: 'mirror',
  COMPONENT_UPDATE: 'component_update',
  FAILURE_NOTICE: 'failure_notice',
});

export const JOB_STATUS = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  RETRYING: 'retrying',
  SUCCEEDED: 'succeeded',
  DEAD: 'dead',
  SKIPPED: 'skipped',
});

export const ATTEMPT_OUTCOME = Object.freeze({
  OK: 'ok',
  NOT_SENT: 'not_sent',
  REJECTED: 'rejected',
  UNKNOWN: 'unknown',
});

export const EVENT_TYPE = Object.freeze({
  SIGNATURE_REJECTED: 'signature_rejected',
  STALE_TIMESTAMP: 'stale_timestamp',
  DUPLICATE_INTERACTION: 'duplicate_interaction',
  LOGIN_FAILED: 'login_failed',
  LOGIN_SUCCEEDED: 'login_succeeded',
  CRON_UNAUTHORIZED: 'cron_unauthorized',
  SWEEP_RUN: 'sweep_run',
  JOB_DEAD: 'job_dead',
  CONFIG_CHANGED: 'config_changed',
  GUILD_CONNECTED: 'guild_connected',
  GUILD_DISCONNECTED: 'guild_disconnected',
  GUILD_UPDATED: 'guild_updated',
  GUILD_NEEDS_ATTENTION: 'guild_needs_attention',
});

export const SECURITY_EVENT_TYPES = Object.freeze([
  EVENT_TYPE.SIGNATURE_REJECTED,
  EVENT_TYPE.STALE_TIMESTAMP,
  EVENT_TYPE.DUPLICATE_INTERACTION,
  EVENT_TYPE.LOGIN_FAILED,
  EVENT_TYPE.CRON_UNAUTHORIZED,
]);

export const LIMITS = Object.freeze({
  reportText: 1000,
  rulesPerCommand: 25,
  ruleName: 60,
  keywordsPerRule: 30,
  keywordLength: 40,
  tagsPerRule: 5,
  tagsPerDecision: 10,
  tagLength: 24,
  replyTemplate: 500,
  cooldownMaxCount: 50,
  cooldownMaxWindowSeconds: 3600,
  aiSummary: 140,
});

export const TIMING = Object.freeze({
  signatureToleranceSeconds: 300,
  recordBudgetMs: 1500,
  inlineBudgetMs: 15_000,
  outboundTimeoutMs: 5000,
  aiTimeoutMs: 5000,
  leaseSeconds: 60,
  interactionTokenTtlMs: 15 * 60 * 1000,
  processDeadlineMs: 12 * 60 * 1000,
  connectCodeTtlMs: 10 * 60 * 1000,
  sessionIdleMs: 30 * 60 * 1000,
  sessionAbsoluteMs: 8 * 60 * 60 * 1000,
  loginWindowMs: 15 * 60 * 1000,
  retentionDays: 30,
});

export const LOGIN_LIMITS = Object.freeze({ perEmail: 5, perIp: 20 });

export const PERMISSIONS = Object.freeze({
  ADMINISTRATOR: 1n << 3n,
  MANAGE_GUILD: 1n << 5n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  READ_MESSAGE_HISTORY: 1n << 16n,
});

export const BOT_CHANNEL_PERMISSIONS =
  PERMISSIONS.VIEW_CHANNEL |
  PERMISSIONS.SEND_MESSAGES |
  PERMISSIONS.EMBED_LINKS |
  PERMISSIONS.READ_MESSAGE_HISTORY;

import {
  COMMANDS,
  CONFIGURABLE_COMMANDS,
  INTERACTION_KIND,
  INTERACTION_STATUS,
  LIMITS,
  PERMISSIONS,
  REPORT_ACTIONS,
  SEVERITIES,
  TIMING,
} from '../../config/constants.js';
import { AppError } from '../../common/errors.js';
import { background, withTimeout } from '../../utils/background.js';
import { logger } from '../../utils/logger.js';
import { discord } from '../discord/discord.client.js';
import {
  EPHEMERAL_FLAG,
  REPORT_FORM_PREFIX,
  REPORT_TEXT_INPUT,
  RESPONSE,
  ephemeralReply,
  message,
  reportForm,
} from '../discord/discord.payloads.js';
import { hasPermission } from '../discord/discord.permissions.js';
import { runInteraction } from '../jobs/jobs.runner.js';
import {
  buildRecord,
  consumeConnectCode,
  finishConnect,
  isGuildActive,
  loadGuildContext,
  recordDuplicate,
  recordInteraction,
  statusMessage,
  statusSummary,
  updateAckTime,
} from './interactions.service.js';

const INTERACTION_TYPE = { PING: 1, COMMAND: 2, BUTTON: 3, REPORT_FORM: 5 };
const BUTTON_PATTERN = /^r:(ack|escalate|resolve):(\d{1,10})$/;

const NOT_CONNECTED =
  'This server is not connected yet. A member with Manage Server can link it with /connect.';
const UNAVAILABLE = 'The service is temporarily unavailable. Please try again in a minute.';

function option(interaction, name) {
  return interaction.data?.options?.find((candidate) => candidate.name === name)?.value;
}

function cleanSeverity(value) {
  return SEVERITIES.includes(value) ? value : null;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim().slice(0, LIMITS.reportText) : '';
}

function findInputValue(components, customId) {
  for (const component of components ?? []) {
    if (component.custom_id === customId && typeof component.value === 'string')
      return component.value;
    const nested = findInputValue(
      component.components ?? (component.component ? [component.component] : []),
      customId,
    );
    if (nested !== null) return nested;
  }
  return null;
}

function deferredFor(config) {
  const ephemeral = !config?.enabled || config?.visibility !== 'public';
  return {
    type: RESPONSE.DEFERRED_CHANNEL_MESSAGE,
    data: ephemeral ? { flags: EPHEMERAL_FLAG } : {},
  };
}

function trackAck(req, res, interactionId) {
  res.once('finish', () => {
    const ackMs = Date.now() - req.receivedAt;
    background(() => updateAckTime(interactionId, ackMs), { interactionId });
  });
}

async function notifyRecordingFailure(token) {
  if (!token) return;
  await discord.editOriginalResponse(token, message({ content: UNAVAILABLE }));
}

async function acknowledge(req, res, { record, response, withProcessJob }) {
  const interaction = req.interaction;
  const recording = recordInteraction(record, { withProcessJob });
  let outcome;
  try {
    outcome = await withTimeout(recording, TIMING.recordBudgetMs);
  } catch (error) {
    logger.error({ err: error, interactionId: interaction.id }, 'Failed to record interaction');
    return res.json(ephemeralReply(UNAVAILABLE));
  }

  if (outcome.timedOut) {
    res.json(response);
    background(
      async () => {
        try {
          const settled = await recording;
          if (!settled.duplicate && withProcessJob) await runInteraction(interaction.id);
        } catch (error) {
          await notifyRecordingFailure(interaction.token);
          throw error;
        }
      },
      { interactionId: interaction.id },
    );
    return undefined;
  }

  if (outcome.value.duplicate) {
    await recordDuplicate(interaction);
    return res.json(response);
  }

  trackAck(req, res, interaction.id);
  res.json(response);
  if (withProcessJob)
    background(() => runInteraction(interaction.id), { interactionId: interaction.id });
  return undefined;
}

async function handleConnect(req, res) {
  const interaction = req.interaction;
  const guildId = interaction.guild_id;
  if (!guildId) return res.json(ephemeralReply('Run /connect inside the server you want to link.'));
  if (!hasPermission(interaction.member?.permissions, PERMISSIONS.MANAGE_GUILD)) {
    return res.json(ephemeralReply('You need the Manage Server permission to link this server.'));
  }
  const code = cleanText(option(interaction, 'code'));
  const recorded = await recordInteraction(
    buildRecord(interaction, {
      kind: INTERACTION_KIND.COMMAND,
      command: COMMANDS.CONNECT,
      status: INTERACTION_STATUS.DONE,
    }),
    { withProcessJob: false },
  );
  if (recorded.duplicate) {
    await recordDuplicate(interaction);
    return res.json(ephemeralReply('This request was already received.'));
  }
  const linked = code ? await consumeConnectCode(code, guildId) : null;
  if (!linked) {
    return res.json(
      ephemeralReply(
        'That code is invalid, expired or already used. Generate a new one in the dashboard.',
      ),
    );
  }
  trackAck(req, res, interaction.id);
  res.json({ type: RESPONSE.DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL_FLAG } });
  background(() => finishConnect(guildId, linked.adminId, interaction.token), {
    interactionId: interaction.id,
  });
  return undefined;
}

async function handleStatus(req, res, { config, version }) {
  const interaction = req.interaction;
  const record = buildRecord(interaction, {
    kind: INTERACTION_KIND.COMMAND,
    command: COMMANDS.STATUS,
    config,
    version,
    status: config.enabled ? INTERACTION_STATUS.DONE : INTERACTION_STATUS.BLOCKED,
  });
  const recorded = await recordInteraction(record, { withProcessJob: false });
  if (recorded.duplicate) {
    await recordDuplicate(interaction);
    return res.json(ephemeralReply('This request was already received.'));
  }
  trackAck(req, res, interaction.id);
  if (!config.enabled)
    return res.json(ephemeralReply('This command is turned off for this server.'));
  const summary = await statusSummary(interaction.guild_id);
  return res.json({
    type: RESPONSE.CHANNEL_MESSAGE,
    data: message({ content: statusMessage(summary), ephemeral: config.visibility !== 'public' }),
  });
}

async function handleReport(req, res, { config, version }, { text, severity, kind }) {
  const interaction = req.interaction;
  if (kind === INTERACTION_KIND.COMMAND && !text && config.enabled) {
    trackAck(req, res, interaction.id);
    const recorded = await recordInteraction(
      buildRecord(interaction, {
        kind,
        command: COMMANDS.REPORT,
        input: { severity, openedForm: true },
        config,
        version,
        status: INTERACTION_STATUS.DONE,
      }),
      { withProcessJob: false },
    );
    if (recorded.duplicate) await recordDuplicate(interaction);
    return res.json(reportForm(severity));
  }
  return acknowledge(req, res, {
    record: buildRecord(interaction, {
      kind,
      command: COMMANDS.REPORT,
      input: { text, severity },
      customId: interaction.data?.custom_id ?? null,
      config,
      version,
    }),
    response: deferredFor(config),
    withProcessJob: true,
  });
}

async function handleCommand(req, res) {
  const interaction = req.interaction;
  const name = interaction.data?.name;
  if (name === COMMANDS.CONNECT) return handleConnect(req, res);
  if (!CONFIGURABLE_COMMANDS.includes(name))
    return res.json(ephemeralReply('This command is not supported.'));
  if (!interaction.guild_id) return res.json(ephemeralReply('Use this command inside a server.'));

  const context = await loadGuildContext(interaction.guild_id, name);
  if (!isGuildActive(context.guild)) return res.json(ephemeralReply(NOT_CONNECTED));
  if (name === COMMANDS.STATUS) return handleStatus(req, res, context);
  return handleReport(req, res, context, {
    text: cleanText(option(interaction, 'text')),
    severity: cleanSeverity(option(interaction, 'severity')),
    kind: INTERACTION_KIND.COMMAND,
  });
}

async function handleReportForm(req, res) {
  const interaction = req.interaction;
  const customId = interaction.data?.custom_id ?? '';
  if (!customId.startsWith(`${REPORT_FORM_PREFIX}:`)) {
    return res.json(ephemeralReply('This form is no longer supported.'));
  }
  const context = await loadGuildContext(interaction.guild_id, COMMANDS.REPORT);
  if (!isGuildActive(context.guild)) return res.json(ephemeralReply(NOT_CONNECTED));
  return handleReport(req, res, context, {
    text: cleanText(findInputValue(interaction.data?.components, REPORT_TEXT_INPUT)),
    severity: cleanSeverity(customId.split(':')[1]),
    kind: INTERACTION_KIND.MODAL,
  });
}

async function handleButton(req, res) {
  const interaction = req.interaction;
  const match = BUTTON_PATTERN.exec(interaction.data?.custom_id ?? '');
  if (!match) return res.json(ephemeralReply('This button is no longer supported.'));
  const [, action, reportIdText] = match;
  const context = await loadGuildContext(interaction.guild_id, COMMANDS.REPORT);
  if (!isGuildActive(context.guild)) return res.json(ephemeralReply(NOT_CONNECTED));
  if (
    REPORT_ACTIONS[action].requiresManage &&
    !hasPermission(interaction.member?.permissions, PERMISSIONS.MANAGE_MESSAGES)
  ) {
    return res.json(ephemeralReply('You need the Manage Messages permission to do that.'));
  }
  const record = buildRecord(interaction, {
    kind: INTERACTION_KIND.BUTTON,
    command: COMMANDS.REPORT,
    input: { action, reportId: Number(reportIdText) },
    customId: interaction.data.custom_id,
    config: context.config,
    version: context.version,
  });
  return acknowledge(req, res, {
    record: { ...record, reportId: Number(reportIdText) },
    response: { type: RESPONSE.DEFERRED_UPDATE_MESSAGE },
    withProcessJob: true,
  });
}

export async function handleInteraction(req, res) {
  switch (req.interaction.type) {
    case INTERACTION_TYPE.PING:
      return res.json({ type: RESPONSE.PONG });
    case INTERACTION_TYPE.COMMAND:
      return handleCommand(req, res);
    case INTERACTION_TYPE.BUTTON:
      return handleButton(req, res);
    case INTERACTION_TYPE.REPORT_FORM:
      return handleReportForm(req, res);
    default:
      throw new AppError(400, 'unsupported_interaction', 'This interaction type is not supported.');
  }
}

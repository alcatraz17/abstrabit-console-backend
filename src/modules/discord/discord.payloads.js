import { REPORT_ACTIONS, REPORT_STATUS } from '../../config/constants.js';
import { escapeMarkdown, truncate } from '../../utils/text.js';

export const RESPONSE = Object.freeze({
  PONG: 1,
  CHANNEL_MESSAGE: 4,
  DEFERRED_CHANNEL_MESSAGE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  MODAL: 9,
});

export const EPHEMERAL_FLAG = 64;
export const NO_MENTIONS = Object.freeze({ parse: [] });
export const REPORT_FORM_PREFIX = 'report_modal';
export const REPORT_TEXT_INPUT = 'report_text';

const LIMIT = Object.freeze({ content: 2000, description: 4096, field: 1024, title: 256 });

const PRIORITY_COLOR = { high: 0xed4245, normal: 0x5865f2, low: 0x95a5a6 };
const STATUS_COLOR = { resolved: 0x57f287 };
const STATUS_LABEL = {
  [REPORT_STATUS.OPEN]: 'Open',
  [REPORT_STATUS.ACKNOWLEDGED]: 'Acknowledged',
  [REPORT_STATUS.ESCALATED]: 'Escalated',
  [REPORT_STATUS.RESOLVED]: 'Resolved',
};

export function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

export function message({ content, embeds, components, ephemeral = false }) {
  return {
    ...(content !== undefined ? { content: truncate(content, LIMIT.content) } : {}),
    ...(embeds ? { embeds } : {}),
    ...(components ? { components } : {}),
    ...(ephemeral ? { flags: EPHEMERAL_FLAG } : {}),
    allowed_mentions: NO_MENTIONS,
  };
}

export function ephemeralReply(content) {
  return { type: RESPONSE.CHANNEL_MESSAGE, data: message({ content, ephemeral: true }) };
}

export function reportMarker(reportId) {
  return `:${reportId}`;
}

export function reportButtons(report) {
  const button = (action, label, style) => ({
    type: 2,
    style,
    label,
    custom_id: `r:${action}:${report.id}`,
    disabled: !REPORT_ACTIONS[action].from.includes(report.status),
  });
  return [
    {
      type: 1,
      components: [
        button('ack', 'Acknowledge', 1),
        button('escalate', 'Escalate', 4),
        button('resolve', 'Resolve', 3),
      ],
    },
  ];
}

export function reportCard(report) {
  const fields = [
    { name: 'Priority', value: capitalize(report.priority), inline: true },
    { name: 'Status', value: STATUS_LABEL[report.status] ?? report.status, inline: true },
    { name: 'Reported by', value: `<@${report.authorId}>`, inline: true },
  ];
  if (report.severity) {
    fields.push({ name: 'Reported severity', value: capitalize(report.severity), inline: true });
  }
  if (report.tags?.length) {
    fields.push({
      name: 'Tags',
      value: truncate(report.tags.join(', '), LIMIT.field),
      inline: true,
    });
  }
  if (report.aiSummary) {
    fields.push({
      name: 'AI summary',
      value: truncate(escapeMarkdown(report.aiSummary), LIMIT.field),
    });
  }
  if (report.handledByName && report.status !== REPORT_STATUS.OPEN) {
    fields.push({
      name: 'Last action',
      value: truncate(
        `${STATUS_LABEL[report.status]} by ${escapeMarkdown(report.handledByName)}`,
        LIMIT.field,
      ),
    });
  }
  return message({
    embeds: [
      {
        title: truncate(`Report #${report.id}`, LIMIT.title),
        description: truncate(escapeMarkdown(report.text), LIMIT.description),
        color:
          STATUS_COLOR[report.status] ?? PRIORITY_COLOR[report.priority] ?? PRIORITY_COLOR.normal,
        fields,
        footer: { text: `Ref ${report.interactionId}` },
        timestamp: new Date(report.createdAt).toISOString(),
      },
    ],
    components: reportButtons(report),
  });
}

export function reportForm(severity) {
  return {
    type: RESPONSE.MODAL,
    data: {
      custom_id: `${REPORT_FORM_PREFIX}:${severity ?? 'none'}`,
      title: 'Report a problem',
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: REPORT_TEXT_INPUT,
              label: 'What is wrong?',
              style: 2,
              min_length: 1,
              max_length: 1000,
              required: true,
              placeholder: 'Describe what happened and who is affected.',
            },
          ],
        },
      ],
    },
  };
}

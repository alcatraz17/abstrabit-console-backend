import { COMMANDS } from '../../config/constants.js';
import { DEFAULT_REPLY_TEMPLATE } from '../../utils/template.js';

export function defaultCommandConfig(command) {
  if (command === COMMANDS.STATUS) {
    return {
      enabled: true,
      visibility: 'ephemeral',
      postToChannel: false,
      mirrorPolicy: 'never',
      aiEnabled: false,
      cooldown: null,
      replyTemplate: '',
      rules: [],
    };
  }
  return {
    enabled: true,
    visibility: 'ephemeral',
    postToChannel: true,
    mirrorPolicy: 'always',
    aiEnabled: true,
    cooldown: { maxCount: 3, windowSeconds: 300 },
    replyTemplate: DEFAULT_REPLY_TEMPLATE,
    rules: [
      {
        id: 'outage',
        name: 'Outage keywords',
        enabled: true,
        match: { anyKeywords: ['outage', 'down', 'urgent', 'breach'], severityIn: [] },
        then: { priority: 'high', addTags: ['outage'], mirror: true },
      },
    ],
  };
}

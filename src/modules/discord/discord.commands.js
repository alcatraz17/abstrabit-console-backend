import { COMMANDS, LIMITS, PERMISSIONS, SEVERITIES } from '../../config/constants.js';

const GUILD_ONLY = { contexts: [0], integration_types: [0] };
const STRING_OPTION = 3;

export const REPORT_COMMAND = {
  name: COMMANDS.REPORT,
  description: 'Report a problem to the team',
  type: 1,
  ...GUILD_ONLY,
  options: [
    {
      type: STRING_OPTION,
      name: 'text',
      description: 'What is wrong? Leave empty to open a form.',
      required: false,
      max_length: LIMITS.reportText,
    },
    {
      type: STRING_OPTION,
      name: 'severity',
      description: 'How serious is it?',
      required: false,
      choices: SEVERITIES.map((value) => ({
        name: value.charAt(0).toUpperCase() + value.slice(1),
        value,
      })),
    },
  ],
};

export const STATUS_COMMAND = {
  name: COMMANDS.STATUS,
  description: 'Show open reports and delivery health',
  type: 1,
  ...GUILD_ONLY,
};

export const CONNECT_COMMAND = {
  name: COMMANDS.CONNECT,
  description: 'Link this server to the admin dashboard',
  type: 1,
  ...GUILD_ONLY,
  default_member_permissions: PERMISSIONS.MANAGE_GUILD.toString(),
  options: [
    {
      type: STRING_OPTION,
      name: 'code',
      description: 'The code shown in the dashboard',
      required: true,
      min_length: 8,
      max_length: 12,
    },
  ],
};

export const GUILD_COMMANDS = [REPORT_COMMAND, STATUS_COMMAND];
export const GLOBAL_COMMANDS = [CONNECT_COMMAND];

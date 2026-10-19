import { z } from 'zod';
import { MIRROR_KINDS } from '../../config/constants.js';

const snowflake = z.string().regex(/^\d{17,20}$/, 'Choose a valid channel.');

export const guildParamsSchema = z.object({ guildId: z.string().regex(/^\d{17,20}$/) });

export const settingsSchema = z.object({
  postChannelId: snowflake.nullable(),
  mirrorKind: z.enum(MIRROR_KINDS),
  mirrorUrl: z.string().trim().max(300, 'The webhook URL is too long.').nullable().optional(),
});

export const demoSchema = z.object({
  mirrorOutage: z.boolean(),
  slowAi: z.boolean(),
});

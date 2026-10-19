import { z } from 'zod';
import { CONFIGURABLE_COMMANDS, COMMANDS, INTERACTION_STATUS } from '../../config/constants.js';

const isoDate = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

export const feedQuerySchema = z.object({
  since: isoDate.optional(),
  before: isoDate.optional(),
  command: z.enum([...CONFIGURABLE_COMMANDS, COMMANDS.CONNECT]).optional(),
  status: z.enum(Object.values(INTERACTION_STATUS)).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const interactionParamsSchema = z.object({
  interactionId: z.string().regex(/^\d{17,20}$/),
});

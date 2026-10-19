import { Router } from 'express';
import { z } from 'zod';
import { requireCronSecret, requireGuildAccess } from '../../middleware/auth.js';
import { validate } from '../../middleware/validator.js';
import { guildParamsSchema } from '../guilds/guilds.schema.js';
import { cronSweep, list, retryAllDead, retryOne } from './jobs.controller.js';

export const guildJobsRouter = Router({ mergeParams: true });

guildJobsRouter.get(
  '/',
  validate({
    params: guildParamsSchema,
    query: z.object({ status: z.enum(['retrying', 'dead']).default('retrying') }),
  }),
  requireGuildAccess,
  list,
);
guildJobsRouter.post(
  '/retry-dead',
  validate({ params: guildParamsSchema }),
  requireGuildAccess,
  retryAllDead,
);

export const jobsRouter = Router();

jobsRouter.post('/:jobId/retry', validate({ params: z.object({ jobId: z.uuid() }) }), retryOne);

export const cronRouter = Router();

cronRouter.get('/sweep', requireCronSecret, cronSweep);

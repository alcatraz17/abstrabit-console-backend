import { Router } from 'express';
import { requireGuildAccess } from '../../middleware/auth.js';
import { validate } from '../../middleware/validator.js';
import { guildParamsSchema } from '../guilds/guilds.schema.js';
import {
  listInteractions,
  listSecurityEvents,
  showInteraction,
  showOverview,
} from './dashboard.controller.js';
import { feedQuerySchema, interactionParamsSchema } from './dashboard.schema.js';

export const guildDashboardRouter = Router({ mergeParams: true });

guildDashboardRouter.get(
  '/overview',
  validate({ params: guildParamsSchema }),
  requireGuildAccess,
  showOverview,
);
guildDashboardRouter.get(
  '/interactions',
  validate({ params: guildParamsSchema, query: feedQuerySchema }),
  requireGuildAccess,
  listInteractions,
);

export const dashboardRouter = Router();

dashboardRouter.get(
  '/interactions/:interactionId',
  validate({ params: interactionParamsSchema }),
  showInteraction,
);
dashboardRouter.get('/security-events', listSecurityEvents);

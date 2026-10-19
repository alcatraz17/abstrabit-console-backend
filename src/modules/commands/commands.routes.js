import { Router } from 'express';
import { requireGuildAccess } from '../../middleware/auth.js';
import { validate } from '../../middleware/validator.js';
import { guildParamsSchema } from '../guilds/guilds.schema.js';
import { show, testRules, update } from './commands.controller.js';
import { commandParamsSchema, ruleTestSchema, saveConfigSchema } from './commands.schema.js';

export const commandsRouter = Router({ mergeParams: true });

commandsRouter.get(
  '/:command',
  validate({ params: commandParamsSchema }),
  requireGuildAccess,
  show,
);
commandsRouter.put(
  '/:command',
  validate({ params: commandParamsSchema, body: saveConfigSchema }),
  requireGuildAccess,
  update,
);

export const rulesRouter = Router({ mergeParams: true });

rulesRouter.post(
  '/test',
  validate({ params: guildParamsSchema, body: ruleTestSchema }),
  requireGuildAccess,
  testRules,
);

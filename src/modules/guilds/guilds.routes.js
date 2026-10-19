import { Router } from 'express';
import { requireGuildAccess } from '../../middleware/auth.js';
import { validate } from '../../middleware/validator.js';
import {
  bot,
  channels,
  commandsSync,
  connectCode,
  demo,
  disconnect,
  list,
  settings,
  show,
  testMirror,
  updateDemo,
} from './guilds.controller.js';
import { demoSchema, guildParamsSchema, settingsSchema } from './guilds.schema.js';

export const guildsRouter = Router();

const guildScoped = [validate({ params: guildParamsSchema }), requireGuildAccess];

guildsRouter.get('/', list);
guildsRouter.get('/:guildId', ...guildScoped, show);
guildsRouter.get('/:guildId/channels', ...guildScoped, channels);
guildsRouter.put(
  '/:guildId/settings',
  ...guildScoped,
  validate({ body: settingsSchema }),
  settings,
);
guildsRouter.post('/:guildId/test-mirror', ...guildScoped, testMirror);
guildsRouter.post('/:guildId/commands/sync', ...guildScoped, commandsSync);
guildsRouter.delete('/:guildId', ...guildScoped, disconnect);
guildsRouter.get('/:guildId/demo', ...guildScoped, demo);
guildsRouter.put('/:guildId/demo', ...guildScoped, validate({ body: demoSchema }), updateDemo);

export const connectCodesRouter = Router();
connectCodesRouter.post('/', connectCode);

export const botRouter = Router();
botRouter.get('/', bot);

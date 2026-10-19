import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { commandsRouter, rulesRouter } from '../modules/commands/commands.routes.js';
import { botRouter, connectCodesRouter, guildsRouter } from '../modules/guilds/guilds.routes.js';

const adminRouter = Router();

adminRouter.use(requireAdmin);
adminRouter.use('/bot', botRouter);
adminRouter.use('/connect-codes', connectCodesRouter);
adminRouter.use('/guilds/:guildId/commands', commandsRouter);
adminRouter.use('/guilds/:guildId/rules', rulesRouter);
adminRouter.use('/guilds', guildsRouter);

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/admin', adminRouter);

import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { commandsRouter, rulesRouter } from '../modules/commands/commands.routes.js';
import { dashboardRouter, guildDashboardRouter } from '../modules/dashboard/dashboard.routes.js';
import { botRouter, connectCodesRouter, guildsRouter } from '../modules/guilds/guilds.routes.js';
import { guildJobsRouter, jobsRouter } from '../modules/jobs/jobs.routes.js';

const adminRouter = Router();

adminRouter.use(requireAdmin);
adminRouter.use('/bot', botRouter);
adminRouter.use('/connect-codes', connectCodesRouter);
adminRouter.use('/guilds/:guildId/commands', commandsRouter);
adminRouter.use('/guilds/:guildId/rules', rulesRouter);
adminRouter.use('/guilds/:guildId/jobs', guildJobsRouter);
adminRouter.use('/guilds/:guildId', guildDashboardRouter);
adminRouter.use('/guilds', guildsRouter);
adminRouter.use('/jobs', jobsRouter);
adminRouter.use('/', dashboardRouter);

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/admin', adminRouter);

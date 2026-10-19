import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { authRouter } from '../modules/auth/auth.routes.js';

const adminRouter = Router();

adminRouter.use(requireAdmin);

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/admin', adminRouter);

import { Router } from 'express';
import { requireCronSecret } from '../../middleware/auth.js';
import { cronSweep } from './jobs.controller.js';

export const cronRouter = Router();

cronRouter.get('/sweep', requireCronSecret, cronSweep);

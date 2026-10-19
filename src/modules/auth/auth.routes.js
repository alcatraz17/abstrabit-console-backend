import { Router } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validator.js';
import { login, logout, me } from './auth.controller.js';
import { loginSchema } from './auth.schema.js';

export const authRouter = Router();

authRouter.post('/login', validate({ body: loginSchema }), login);
authRouter.post('/logout', logout);
authRouter.get('/me', requireAdmin, me);

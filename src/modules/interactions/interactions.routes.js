import express, { Router } from 'express';
import { handleInteraction } from './interactions.controller.js';
import { verifyDiscordRequest } from './interactions.verify.js';

export const interactionsRouter = Router();

interactionsRouter.post(
  '/',
  express.raw({ type: () => true, limit: '256kb' }),
  verifyDiscordRequest,
  handleInteraction,
);

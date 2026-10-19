import pino from 'pino';
import { env } from '../config/env.js';
import { registerSecret, scrub, scrubDeep, scrubError } from './scrub.js';

for (const value of [
  ...env.SESSION_SECRET,
  env.ENCRYPTION_KEY,
  env.DISCORD_BOT_TOKEN,
  env.CRON_SECRET,
  env.GROQ_API_KEY,
  env.DATABASE_URL,
]) {
  registerSecret(value);
}

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'abstrabit-console-backend' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-signature-ed25519"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.token',
      '*.passwordHash',
    ],
    censor: '[redacted]',
  },
  serializers: { err: scrubError, error: scrubError },
  formatters: {
    log: (object) => scrubDeep(object),
  },
  hooks: {
    logMethod(args, method) {
      method.apply(
        this,
        args.map((arg) => (typeof arg === 'string' ? scrub(arg) : arg)),
      );
    },
  },
});

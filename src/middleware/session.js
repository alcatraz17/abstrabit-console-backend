import connectPgSimple from 'connect-pg-simple';
import session from 'express-session';
import { TIMING } from '../config/constants.js';
import { env, isProduction } from '../config/env.js';
import { pool } from '../db/index.js';

const PgStore = connectPgSimple(session);

export const SESSION_COOKIE_NAME = isProduction ? '__Host-sid' : 'sid';

export const sessionCookieOptions = Object.freeze({
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  path: '/',
});

export const sessionMiddleware = session({
  name: SESSION_COOKIE_NAME,
  secret: env.SESSION_SECRET,
  store: new PgStore({
    pool,
    tableName: 'session',
    createTableIfMissing: false,
    pruneSessionInterval: false,
  }),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  unset: 'destroy',
  cookie: { ...sessionCookieOptions, maxAge: TIMING.sessionIdleMs },
});

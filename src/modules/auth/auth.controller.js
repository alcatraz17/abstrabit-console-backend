import { UnauthorizedError } from '../../common/errors.js';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '../../middleware/session.js';
import {
  assertLoginAllowed,
  authenticate,
  recordLoginFailure,
  recordLoginSuccess,
} from './auth.service.js';

function regenerate(req) {
  return new Promise((resolve, reject) =>
    req.session.regenerate((error) => (error ? reject(error) : resolve())),
  );
}

function save(req) {
  return new Promise((resolve, reject) =>
    req.session.save((error) => (error ? reject(error) : resolve())),
  );
}

function destroy(req) {
  return new Promise((resolve, reject) =>
    req.session.destroy((error) => (error ? reject(error) : resolve())),
  );
}

export async function login(req, res) {
  const { email, password } = req.valid.body;
  await assertLoginAllowed(email, req.ip);
  const admin = await authenticate(email, password);
  if (!admin) {
    await recordLoginFailure(email, req.ip);
    throw new UnauthorizedError('The email or password is incorrect.', 'invalid_credentials');
  }
  await regenerate(req);
  req.session.adminId = admin.id;
  req.session.createdAt = Date.now();
  await save(req);
  await recordLoginSuccess(admin, req.ip);
  res.json({ admin });
}

export async function logout(req, res) {
  if (req.session) await destroy(req);
  res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions);
  res.status(204).end();
}

export function me(req, res) {
  res.json({ admin: req.admin });
}

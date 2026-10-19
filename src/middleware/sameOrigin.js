import { env } from '../config/env.js';
import { AppError, ForbiddenError } from '../common/errors.js';

const allowedOrigin = new URL(env.APP_URL).origin;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function sameOrigin(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.get('origin') !== allowedOrigin) {
    return next(new ForbiddenError('Cross-origin requests are not accepted.'));
  }
  const hasBody = Number(req.get('content-length') ?? 0) > 0 || req.get('transfer-encoding');
  if (hasBody && !req.is('application/json')) {
    return next(new AppError(415, 'unsupported_media_type', 'Send the request body as JSON.'));
  }
  return next();
}

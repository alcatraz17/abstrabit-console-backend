import { AppError, NotFoundError } from '../common/errors.js';

export function notFoundHandler(_req, _res, next) {
  next(new NotFoundError('No API route matches this request.'));
}

function toAppError(error) {
  if (error instanceof AppError) return error;
  if (error?.type === 'entity.too.large') {
    return new AppError(413, 'payload_too_large', 'The request body is too large.');
  }
  if (error?.type === 'entity.parse.failed') {
    return new AppError(400, 'invalid_json', 'The request body is not valid JSON.');
  }
  return null;
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const known = toAppError(error);
  if (!known) {
    req.log?.error({ err: error }, 'Unhandled request error');
    return res.status(500).json({
      error: { code: 'internal_error', message: 'Something went wrong. Please try again.' },
    });
  }
  if (known.status >= 500) req.log?.error({ err: error }, 'Request failed');
  if (known.retryAfterSeconds) res.set('Retry-After', String(known.retryAfterSeconds));
  return res.status(known.status).json({
    error: { code: known.code, message: known.message, ...(known.details ?? {}) },
  });
}

export class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Check the highlighted fields.', fields = {}) {
    super(400, 'validation_failed', message, { fields });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Sign in to continue.', code = 'unauthorized') {
    super(401, code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'This request is not allowed.') {
    super(403, 'forbidden', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'The requested resource was not found.') {
    super(404, 'not_found', message);
  }
}

export class ConflictError extends AppError {
  constructor(message, code = 'conflict') {
    super(409, code, message);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message, retryAfterSeconds) {
    super(429, 'rate_limited', message, { retryAfterSeconds });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class UpstreamError extends AppError {
  constructor(message, code = 'upstream_unavailable') {
    super(502, code, message);
  }
}

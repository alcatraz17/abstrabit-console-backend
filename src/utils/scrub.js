const REDACTED = '[redacted]';
const MIN_SECRET_LENGTH = 8;
const MAX_DEPTH = 8;

const knownSecrets = new Set();

const PATTERNS = [
  [
    /https?:\/\/(?:[\w-]+\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/\d+\/[\w.-]+/gi,
    `https://discord.com/api/webhooks/${REDACTED}`,
  ],
  [
    /https:\/\/hooks\.slack\.com\/services\/[\w/]+/gi,
    `https://hooks.slack.com/services/${REDACTED}`,
  ],
  [/aW50ZXJhY3Rpb246[\w-]+/g, REDACTED],
  [/[\w-]{24,}\.[\w-]{6,}\.[\w-]{27,}/g, REDACTED],
  [/\b(Bearer|Bot)\s+[\w.~+/=-]+/gi, `$1 ${REDACTED}`],
  [/gsk_[A-Za-z0-9]+/g, REDACTED],
  [/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s]+@/gi, `$1${REDACTED}@`],
];

export function registerSecret(value) {
  if (typeof value === 'string' && value.length >= MIN_SECRET_LENGTH) knownSecrets.add(value);
}

export function scrub(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  let result = text;
  for (const secret of knownSecrets) {
    if (result.includes(secret)) result = result.split(secret).join(REDACTED);
  }
  for (const [pattern, replacement] of PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function scrubDeep(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === 'string') return scrub(value);
  if (value === null || typeof value !== 'object' || depth > MAX_DEPTH) return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (value instanceof Error) return scrubError(value, depth, seen);
  if (Array.isArray(value)) return value.map((item) => scrubDeep(item, depth + 1, seen));
  if (Buffer.isBuffer(value)) return `[buffer ${value.length} bytes]`;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, scrubDeep(item, depth + 1, seen)]),
  );
}

export function scrubError(error, depth = 0, seen = new WeakSet()) {
  if (!(error instanceof Error)) return scrubDeep(error, depth, seen);
  const serialized = {
    type: error.name,
    message: scrub(error.message),
    stack: scrub(error.stack ?? ''),
  };
  if (typeof error.code === 'string' || typeof error.code === 'number')
    serialized.code = error.code;
  if (error.cause !== undefined && depth < MAX_DEPTH) {
    serialized.cause = scrubDeep(error.cause, depth + 1, seen);
  }
  return serialized;
}

export function errorText(error) {
  if (error instanceof Error) return scrub(error.message).slice(0, 500);
  return scrub(String(error)).slice(0, 500);
}

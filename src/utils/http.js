import { ATTEMPT_OUTCOME, TIMING } from '../config/constants.js';

const NOT_SENT_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

export class DeliveryError extends Error {
  constructor({
    route,
    outcome,
    httpStatus = null,
    providerCode = null,
    retryAfterSeconds = null,
    permanent = false,
    detail = '',
  }) {
    const status = httpStatus ? ` returned ${httpStatus}` : ' failed';
    const code = providerCode ? ` (${providerCode})` : '';
    super(`${route}${status}${code}${detail ? `: ${detail}` : ''}`);
    this.name = 'DeliveryError';
    this.route = route;
    this.outcome = outcome;
    this.httpStatus = httpStatus;
    this.providerCode = providerCode;
    this.retryAfterSeconds = retryAfterSeconds;
    this.permanent = permanent;
  }
}

function networkFailure(route, error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return new DeliveryError({
      route,
      outcome: ATTEMPT_OUTCOME.UNKNOWN,
      detail: 'timed out',
    });
  }
  const code = error?.cause?.code ?? error?.code;
  return new DeliveryError({
    route,
    outcome: NOT_SENT_CODES.has(code) ? ATTEMPT_OUTCOME.NOT_SENT : ATTEMPT_OUTCOME.UNKNOWN,
    detail: code ? `network error ${code}` : 'network error',
  });
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function providerDetails(payload) {
  const nested = payload?.error && typeof payload.error === 'object' ? payload.error : null;
  const numericCode = typeof payload?.code === 'number' ? payload.code : null;
  const textCode = typeof nested?.code === 'string' ? nested.code : null;
  const message =
    typeof payload?.message === 'string'
      ? payload.message
      : typeof nested?.message === 'string'
        ? nested.message
        : typeof payload?.error === 'string'
          ? payload.error
          : '';
  const detail = [textCode, message].filter(Boolean).join(': ').slice(0, 200);
  return { providerCode: numericCode, detail };
}

function retryAfterFrom(response, body) {
  const fromBody = Number(body?.retry_after);
  if (Number.isFinite(fromBody) && fromBody > 0) return Math.ceil(fromBody);
  const fromHeader = Number(response.headers.get('retry-after'));
  return Number.isFinite(fromHeader) && fromHeader > 0 ? Math.ceil(fromHeader) : null;
}

export async function requestJson(url, { route, method = 'GET', headers = {}, body, timeoutMs }) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs ?? TIMING.outboundTimeoutMs),
    });
  } catch (error) {
    throw networkFailure(route, error);
  }

  const payload = await readBody(response);
  if (response.ok) return payload;

  const { providerCode, detail } = providerDetails(payload);
  if (response.status === 429) {
    throw new DeliveryError({
      route,
      outcome: ATTEMPT_OUTCOME.REJECTED,
      httpStatus: 429,
      providerCode,
      retryAfterSeconds: retryAfterFrom(response, payload),
      detail,
    });
  }
  if (response.status >= 500 || response.status === 408) {
    throw new DeliveryError({
      route,
      outcome: ATTEMPT_OUTCOME.UNKNOWN,
      httpStatus: response.status,
      providerCode,
    });
  }
  throw new DeliveryError({
    route,
    outcome: ATTEMPT_OUTCOME.REJECTED,
    httpStatus: response.status,
    providerCode,
    permanent: true,
    detail,
  });
}

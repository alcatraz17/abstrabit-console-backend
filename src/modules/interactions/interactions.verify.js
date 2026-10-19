import { verifyKey } from 'discord-interactions';
import { EVENT_TYPE, TIMING } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { AppError, UnauthorizedError } from '../../common/errors.js';
import { recordEvent } from '../../common/events.js';

const SIGNATURE_PATTERN = /^[0-9a-f]{128}$/i;
const TIMESTAMP_PATTERN = /^\d{1,12}$/;

async function reject(req, type, reason) {
  await recordEvent({ type, level: 'warn', data: { reason, ip: req.ip } });
  return new UnauthorizedError('Invalid request signature.', 'invalid_signature');
}

export async function verifyDiscordRequest(req, _res, next) {
  req.receivedAt = Date.now();
  const signature = req.get('x-signature-ed25519') ?? '';
  const timestamp = req.get('x-signature-timestamp') ?? '';
  const body = req.body;

  if (!Buffer.isBuffer(body) || body.length === 0 || !signature || !timestamp) {
    return next(
      await reject(req, EVENT_TYPE.SIGNATURE_REJECTED, 'missing signature, timestamp or body'),
    );
  }
  if (!SIGNATURE_PATTERN.test(signature) || !TIMESTAMP_PATTERN.test(timestamp)) {
    return next(await reject(req, EVENT_TYPE.SIGNATURE_REJECTED, 'malformed signature headers'));
  }

  let valid = false;
  try {
    valid = await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY);
  } catch {
    valid = false;
  }
  if (!valid) return next(await reject(req, EVENT_TYPE.SIGNATURE_REJECTED, 'signature mismatch'));

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (ageSeconds > TIMING.signatureToleranceSeconds) {
    return next(
      await reject(req, EVENT_TYPE.STALE_TIMESTAMP, `timestamp off by ${Math.round(ageSeconds)} s`),
    );
  }

  try {
    req.interaction = JSON.parse(body.toString('utf8'));
  } catch {
    return next(new AppError(400, 'invalid_json', 'The request body is not valid JSON.'));
  }
  if (typeof req.interaction?.id !== 'string' || typeof req.interaction?.type !== 'number') {
    return next(new AppError(400, 'invalid_interaction', 'The interaction payload is incomplete.'));
  }
  return next();
}

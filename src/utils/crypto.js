import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { env } from '../config/env.js';
import { registerSecret } from './scrub.js';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const key = Buffer.from(env.ENCRYPTION_KEY, 'base64');

export function encrypt(plaintext) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
  return `${VERSION}:${payload}`;
}

export function decrypt(value) {
  const [version, payload] = value.split(':');
  if (version !== VERSION || !payload) throw new Error('Unsupported encrypted value format.');
  const buffer = Buffer.from(payload, 'base64');
  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buffer.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  registerSecret(plaintext);
  return plaintext;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a, b) {
  const left = Buffer.from(sha256(String(a)), 'hex');
  const right = Buffer.from(sha256(String(b)), 'hex');
  return timingSafeEqual(left, right);
}

export function randomCode(length = 8) {
  return Array.from({ length }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

export function normalizeCode(value) {
  return value.trim().toUpperCase().replace(/[\s-]/g, '');
}

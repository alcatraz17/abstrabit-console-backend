import { waitUntil } from '@vercel/functions';
import { logger } from './logger.js';

const pending = new Set();

export function background(task, context = {}) {
  const tracked = Promise.resolve()
    .then(task)
    .catch((error) => logger.error({ err: error, ...context }, 'Background task failed'))
    .finally(() => pending.delete(tracked));
  pending.add(tracked);
  if (process.env.VERCEL) waitUntil(tracked);
  return tracked;
}

export async function drainBackground() {
  while (pending.size > 0) {
    await Promise.allSettled([...pending]);
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  try {
    return await Promise.race([promise.then((value) => ({ timedOut: false, value })), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

import { db } from '../db/index.js';
import { events } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { scrubDeep } from '../utils/scrub.js';

export async function recordEvent(
  { type, level = 'info', guildId = null, interactionId = null, data = {} },
  executor = db,
) {
  try {
    await executor
      .insert(events)
      .values({ type, level, guildId, interactionId, data: scrubDeep(data) });
  } catch (error) {
    logger.warn({ err: error, type }, 'Failed to record event');
  }
}

import { Router } from 'express';
import { and, count, eq, inArray, lte, max } from 'drizzle-orm';
import { EVENT_TYPE, JOB_STATUS } from '../../config/constants.js';
import { db } from '../../db/index.js';
import { events, jobs } from '../../db/schema.js';

export const healthRouter = Router();

healthRouter.get('/', async (req, res) => {
  try {
    const [[backlog], [sweep]] = await Promise.all([
      db
        .select({ due: count() })
        .from(jobs)
        .where(
          and(
            inArray(jobs.status, [JOB_STATUS.PENDING, JOB_STATUS.RETRYING]),
            lte(jobs.nextAttemptAt, new Date()),
          ),
        ),
      db
        .select({ at: max(events.ts) })
        .from(events)
        .where(eq(events.type, EVENT_TYPE.SWEEP_RUN)),
    ]);
    res.json({
      status: 'ok',
      database: 'ok',
      dueJobs: Number(backlog.due),
      lastSweepAt: sweep.at,
    });
  } catch (error) {
    req.log.error({ err: error }, 'Health check failed');
    res.status(503).json({ status: 'degraded', database: 'unavailable' });
  }
});

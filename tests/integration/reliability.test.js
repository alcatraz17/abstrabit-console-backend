import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';
import { JOB_KIND } from '../../src/config/constants.js';
import {
  LeaseLostError,
  claimJobs,
  completeJob,
  enqueueJobs,
  jobSpec,
} from '../../src/modules/jobs/jobs.service.js';
import { sweep } from '../../src/modules/jobs/jobs.runner.js';
import { drainBackground } from '../../src/utils/background.js';
import { buttonInteraction, commandInteraction, sendInteraction } from '../helpers/discord.js';
import {
  GUILD_ID,
  MIRROR_URL,
  createAdmin,
  createGuild,
  query,
  resetDatabase,
} from '../helpers/database.js';
import { installFakeFetch, json } from '../helpers/fake-fetch.js';

const reportCommand = (text) =>
  commandInteraction({ name: 'report', options: [{ name: 'text', type: 3, value: text }] });

async function jobOf(interactionId, kind) {
  const [job] = await query('SELECT * FROM jobs WHERE interaction_id = $1 AND kind = $2', [
    interactionId,
    kind,
  ]);
  return job;
}

async function makeDue(jobId) {
  await query(`UPDATE jobs SET next_attempt_at = now() - interval '1 second' WHERE id = $1`, [
    jobId,
  ]);
}

describe('delivery reliability', () => {
  let fake;
  let admin;

  beforeEach(async () => {
    await resetDatabase();
    admin = await createAdmin();
    fake = installFakeFetch();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('retries a failing mirror twice inline, then recovers through the sweeper', async () => {
    await createGuild({ adminId: admin.id, settings: { mirrorOutage: true, slowAi: false } });
    const payload = reportCommand('Payments are down');
    await sendInteraction(payload);
    await drainBackground();

    const failing = await jobOf(payload.id, JOB_KIND.MIRROR);
    expect(failing).toMatchObject({ status: 'retrying', attempts: 2 });
    expect(failing.last_error).toMatch(/simulated mirror outage/);
    expect(
      (await query('SELECT status FROM interactions WHERE id = $1', [payload.id]))[0].status,
    ).toBe('processing');

    await query(`UPDATE guilds SET settings = '{"mirrorOutage":false,"slowAi":false}'`);
    await makeDue(failing.id);
    expect(await sweep()).toBe(1);

    const recovered = await jobOf(payload.id, JOB_KIND.MIRROR);
    expect(recovered).toMatchObject({ status: 'succeeded', attempts: 3 });
    const attempts = await query(
      'SELECT outcome FROM job_attempts WHERE job_id = $1 ORDER BY attempt',
      [failing.id],
    );
    expect(attempts.map((row) => row.outcome)).toEqual(['unknown', 'unknown', 'ok']);
    expect(
      (await query('SELECT status FROM interactions WHERE id = $1', [payload.id]))[0].status,
    ).toBe('done');
  });

  it('lets exactly one runner claim a job and fences late completions', async () => {
    await createGuild({ adminId: admin.id });
    const [interaction] = await query(
      `INSERT INTO interactions (id, guild_id, kind, command) VALUES ('900000000000000001', $1, 'command', 'report')
       RETURNING id, guild_id AS "guildId", received_at AS "receivedAt"`,
      [GUILD_ID],
    );
    await enqueueJobs([jobSpec(JOB_KIND.MIRROR, interaction)]);

    const [first, second] = await Promise.all([claimJobs({ limit: 5 }), claimJobs({ limit: 5 })]);
    expect(first.length + second.length).toBe(1);
    const claimed = first[0] ?? second[0];

    await query(`UPDATE jobs SET lease_token = gen_random_uuid() WHERE id = $1`, [claimed.id]);
    await expect(completeJob(claimed, new Date())).rejects.toBeInstanceOf(LeaseLostError);
  });

  it('reclaims a job whose lease expired after a crash', async () => {
    await createGuild({ adminId: admin.id });
    const payload = reportCommand('Search is broken');
    await sendInteraction(payload);
    await drainBackground();
    const mirror = await jobOf(payload.id, JOB_KIND.MIRROR);
    await query(
      `UPDATE jobs SET status = 'running', attempts = 1, locked_until = now() - interval '1 second' WHERE id = $1`,
      [mirror.id],
    );
    expect(await sweep()).toBe(1);
    expect((await jobOf(payload.id, JOB_KIND.MIRROR)).status).toBe('succeeded');
  });

  it('reconciles a card whose first post timed out instead of posting twice', async () => {
    await createGuild({ adminId: admin.id });
    let posted = null;
    fake.respondWith(
      (call) => call.method === 'POST' && /\/channels\/\d+\/messages$/.test(call.url),
      (call) => {
        posted = call.body;
        const error = new DOMException('The operation timed out.', 'TimeoutError');
        return Promise.reject(error);
      },
      { once: true },
    );
    fake.respondWith(
      (call) => call.method === 'GET' && /\/channels\/\d+\/messages\?limit=50$/.test(call.url),
      () =>
        json([
          {
            id: '800000000000000001',
            author: { id: '100000000000000001' },
            components: posted.components,
          },
        ]),
    );

    const payload = reportCommand('Checkout broken');
    await sendInteraction(payload);
    await drainBackground();

    const card = await jobOf(payload.id, JOB_KIND.CHANNEL_POST);
    expect(card).toMatchObject({ status: 'succeeded', attempts: 2 });
    expect(card.result).toMatchObject({ reconciled: true, messageId: '800000000000000001' });
    expect(fake.callsTo(/POST .*\/channels\/\d+\/messages$/)).toHaveLength(1);
  });

  it('gives up immediately on a deleted mirror webhook and flags the server', async () => {
    await createGuild({ adminId: admin.id });
    fake.respondWith(
      (call) => call.url.includes('?wait=true'),
      () => json({ code: 10015, message: 'Unknown Webhook' }, 404),
    );
    const payload = reportCommand('Mirror test');
    await sendInteraction(payload);
    await drainBackground();

    expect(await jobOf(payload.id, JOB_KIND.MIRROR)).toMatchObject({ status: 'dead', attempts: 1 });
    const [guild] = await query('SELECT status, attention_reason FROM guilds WHERE id = $1', [
      GUILD_ID,
    ]);
    expect(guild.status).toBe('needs_attention');
    expect(guild.attention_reason).toMatch(/mirror webhook/);
    expect(
      (await query('SELECT status FROM interactions WHERE id = $1', [payload.id]))[0].status,
    ).toBe('partial');
  });

  it('sends a failure notice when processing fails permanently', async () => {
    await createGuild({ adminId: admin.id });
    const payload = buttonInteraction({ customId: 'r:ack:999' });
    await sendInteraction(payload);
    await drainBackground();

    expect(await jobOf(payload.id, JOB_KIND.PROCESS)).toMatchObject({ status: 'dead' });
    expect(await jobOf(payload.id, JOB_KIND.FAILURE_NOTICE)).toMatchObject({ status: 'succeeded' });
    const [notice] = fake.callsTo(/PATCH .*@original$/);
    expect(notice.body.content).toMatch(new RegExp(`ref ${payload.id}`));
    expect(
      (await query('SELECT status FROM interactions WHERE id = $1', [payload.id]))[0].status,
    ).toBe('failed');
  });

  it('stops retrying replies once the interaction token has expired', async () => {
    await createGuild({ adminId: admin.id });
    fake.respondWith(
      (call) => call.url.endsWith('/messages/@original'),
      () => json({ message: 'Service unavailable' }, 503),
    );
    const payload = reportCommand('Token expiry test');
    await sendInteraction(payload);
    await drainBackground();
    const reply = await jobOf(payload.id, JOB_KIND.DISCORD_REPLY);
    expect(reply.status).toBe('retrying');

    await query(
      `UPDATE interactions SET token_expires_at = now() - interval '1 second' WHERE id = $1`,
      [payload.id],
    );
    await query(`UPDATE jobs SET deadline_at = now() + interval '30 seconds' WHERE id = $1`, [
      reply.id,
    ]);
    await makeDue(reply.id);
    await sweep();
    const expired = await jobOf(payload.id, JOB_KIND.DISCORD_REPLY);
    expect(expired.status).toBe('dead');
    expect(expired.last_error).toMatch(/token has expired/);
    expect((await jobOf(payload.id, JOB_KIND.CHANNEL_POST)).status).toBe('succeeded');
  });

  it('scrubs secrets that appear inside upstream error messages', async () => {
    await createGuild({ adminId: admin.id });
    fake.respondWith(
      (call) => call.url.includes('?wait=true'),
      () =>
        json({ message: `Bad request for ${MIRROR_URL} using Bot test-bot-token-0123456789` }, 400),
    );
    const payload = reportCommand('Scrub test');
    await sendInteraction(payload);
    await drainBackground();
    const mirror = await jobOf(payload.id, JOB_KIND.MIRROR);
    const [attempt] = await query('SELECT error FROM job_attempts WHERE job_id = $1', [mirror.id]);
    for (const text of [mirror.last_error, attempt.error]) {
      expect(text).not.toContain('mirrorWebhookTokenValue');
      expect(text).not.toContain('test-bot-token-0123456789');
      expect(text).toContain('[redacted]');
    }
  });

  it('applies a configuration change to the very next report', async () => {
    await createGuild({ adminId: admin.id });
    const agent = request.agent(app);
    await agent
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ email: admin.email, password: admin.password });
    const { body: current } = await agent.get(`/api/admin/guilds/${GUILD_ID}/commands/report`);
    const saved = await agent
      .put(`/api/admin/guilds/${GUILD_ID}/commands/report`)
      .set('Origin', 'http://localhost:5173')
      .send({
        expectedVersion: current.version,
        config: { ...current.config, mirrorPolicy: 'never' },
      });
    expect(saved.status).toBe(200);

    const payload = reportCommand('Checkout is down');
    await sendInteraction(payload);
    await drainBackground();
    const [interaction] = await query(
      'SELECT config_version, decision FROM interactions WHERE id = $1',
      [payload.id],
    );
    expect(interaction.config_version).toBe(saved.body.version);
    expect(interaction.decision.mirror).toBe(false);
    expect(await jobOf(payload.id, JOB_KIND.MIRROR)).toBeUndefined();
  });
});

describe('cron sweep endpoint', () => {
  beforeEach(resetDatabase);

  it('requires the bearer secret and records unauthorised attempts', async () => {
    expect((await request(app).get('/api/cron/sweep')).status).toBe(401);
    expect(
      (await request(app).get('/api/cron/sweep').set('Authorization', 'Bearer wrong')).status,
    ).toBe(401);
    expect(await query(`SELECT id FROM events WHERE type = 'cron_unauthorized'`)).toHaveLength(2);
  });

  it('runs a sweep with housekeeping and records it', async () => {
    await query(
      `INSERT INTO interactions (id, kind, command, token_enc, token_expires_at)
       VALUES ('900000000000000002', 'command', 'report', 'v1:abc', now() - interval '1 minute')`,
    );
    const response = await request(app)
      .get('/api/cron/sweep')
      .set('Authorization', 'Bearer test-cron-secret-0123456789abcdef0123');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ processed: 0, tokensCleared: 1 });
    expect(await query(`SELECT id FROM events WHERE type = 'sweep_run'`)).toHaveLength(1);
    const [row] = await query(`SELECT token_enc FROM interactions WHERE id = '900000000000000002'`);
    expect(row.token_enc).toBeNull();
  });
});

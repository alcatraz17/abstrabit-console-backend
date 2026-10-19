import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';
import { drainBackground } from '../../src/utils/background.js';
import { commandInteraction, sendInteraction } from '../helpers/discord.js';
import { GUILD_ID, createAdmin, createGuild, query, resetDatabase } from '../helpers/database.js';
import { installFakeFetch, json } from '../helpers/fake-fetch.js';

const ORIGIN = 'http://localhost:5173';
const SLACK_URL =
  'https://hooks.slack.com/services/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ittests';

async function signIn(admin) {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/login')
    .set('Origin', ORIGIN)
    .send({ email: admin.email, password: admin.password });
  return agent;
}

async function report(text) {
  const payload = commandInteraction({
    name: 'report',
    options: [{ name: 'text', type: 3, value: text }],
  });
  await sendInteraction(payload);
  await drainBackground();
  return payload;
}

describe('admin API', () => {
  let fake;
  let admin;
  let agent;

  beforeEach(async () => {
    await resetDatabase();
    admin = await createAdmin();
    await createGuild({ adminId: admin.id });
    fake = installFakeFetch();
    agent = await signIn(admin);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('scopes servers to the admin who linked them', async () => {
    const other = await createAdmin({ email: 'other@example.com' });
    const otherAgent = await signIn(other);
    expect((await otherAgent.get('/api/admin/guilds')).body.guilds).toEqual([]);
    expect((await otherAgent.get(`/api/admin/guilds/${GUILD_ID}`)).status).toBe(404);
    expect((await otherAgent.get(`/api/admin/guilds/${GUILD_ID}/overview`)).status).toBe(404);
  });

  it('lists postable channels using the bot’s effective permissions', async () => {
    const response = await agent.get(`/api/admin/guilds/${GUILD_ID}/channels`);
    expect(response.body.channels).toEqual([
      { id: '300000000000000010', name: 'general', type: 'text', canPost: true },
      { id: '300000000000000011', name: 'reports', type: 'text', canPost: true },
      { id: '300000000000000012', name: 'locked', type: 'text', canPost: false },
    ]);
  });

  it('validates and stores server settings without exposing the webhook', async () => {
    const put = (body) =>
      agent.put(`/api/admin/guilds/${GUILD_ID}/settings`).set('Origin', ORIGIN).send(body);

    const invalidUrl = await put({
      postChannelId: '300000000000000011',
      mirrorKind: 'slack',
      mirrorUrl: 'https://hooks.slack.com.evil.example/services/x',
    });
    expect(invalidUrl.status).toBe(400);
    expect(invalidUrl.body.error.fields.mirrorUrl).toMatch(/Slack/);

    const locked = await put({ postChannelId: '300000000000000012', mirrorKind: 'none' });
    expect(locked.body.error.fields.postChannelId).toMatch(/Send Messages/);

    const missingUrl = await put({ postChannelId: '300000000000000011', mirrorKind: 'slack' });
    expect(missingUrl.body.error.fields.mirrorUrl).toMatch(/Enter the webhook URL/);

    const saved = await put({
      postChannelId: '300000000000000010',
      mirrorKind: 'slack',
      mirrorUrl: SLACK_URL,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.guild).toMatchObject({
      postChannelId: '300000000000000010',
      mirrorKind: 'slack',
    });
    expect(saved.body.guild.mirrorUrlMasked).toBe('hooks.slack.com/…/••••ests');
    expect(JSON.stringify(saved.body)).not.toContain('fixturewebhooktoken');

    const kept = await put({
      postChannelId: '300000000000000010',
      mirrorKind: 'slack',
      mirrorUrl: null,
    });
    expect(kept.status).toBe(200);
    const [row] = await query('SELECT mirror_url_enc FROM guilds WHERE id = $1', [GUILD_ID]);
    expect(row.mirror_url_enc).toMatch(/^v1:/);
  });

  it('sends a test message and reports mirror failures clearly', async () => {
    expect(
      (await agent.post(`/api/admin/guilds/${GUILD_ID}/test-mirror`).set('Origin', ORIGIN)).status,
    ).toBe(204);
    fake.respondWith(
      (call) => call.url.includes('?wait=true'),
      () => json({ message: 'Unknown Webhook', code: 10015 }, 404),
    );
    const failed = await agent
      .post(`/api/admin/guilds/${GUILD_ID}/test-mirror`)
      .set('Origin', ORIGIN);
    expect(failed.status).toBe(502);
    expect(failed.body.error.message).toMatch(/did not accept/);
    expect(failed.body.error.message).not.toMatch(/mirrorWebhookTokenValue/);
  });

  it('saves command configuration with optimistic concurrency', async () => {
    const url = `/api/admin/guilds/${GUILD_ID}/commands/report`;
    const { body: current } = await agent.get(url);
    expect(current.version).toBe(1);

    const config = { ...current.config, aiEnabled: false };
    const saved = await agent.put(url).set('Origin', ORIGIN).send({ expectedVersion: 1, config });
    expect(saved.body.version).toBe(2);

    const stale = await agent.put(url).set('Origin', ORIGIN).send({ expectedVersion: 1, config });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('version_conflict');

    const invalid = await agent
      .put(url)
      .set('Origin', ORIGIN)
      .send({
        expectedVersion: 2,
        config: {
          ...config,
          replyTemplate: 'Ticket {ticket}',
          rules: [
            {
              id: 'a',
              name: 'Empty',
              enabled: true,
              match: { anyKeywords: [], severityIn: [] },
              then: { priority: null, addTags: [], mirror: null },
            },
          ],
        },
      });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.fields).toMatchObject({
      'config.replyTemplate': 'Unknown placeholders: {ticket}.',
      'config.rules.0.match.anyKeywords': 'Add at least one keyword or severity to match on.',
    });

    const [event] = await query(`SELECT data FROM events WHERE type = 'config_changed'`);
    expect(event.data).toMatchObject({
      command: 'report',
      fromVersion: 1,
      toVersion: 2,
      changed: ['aiEnabled'],
    });
  });

  it('evaluates draft rules without saving them', async () => {
    const { body: current } = await agent.get(`/api/admin/guilds/${GUILD_ID}/commands/report`);
    const response = await agent
      .post(`/api/admin/guilds/${GUILD_ID}/rules/test`)
      .set('Origin', ORIGIN)
      .send({
        command: 'report',
        config: current.config,
        input: { text: 'download page', severity: null, recentCountForUser: 0 },
      });
    expect(response.body.decision).toMatchObject({
      allowed: true,
      priority: 'normal',
      matchedRuleId: null,
    });
  });

  it('serves a feed with a change cursor and older pages', async () => {
    const first = await report('First report about checkout');
    const initial = await agent.get(`/api/admin/guilds/${GUILD_ID}/interactions?limit=1`);
    expect(initial.body.items).toHaveLength(1);
    expect(initial.body.items[0]).toMatchObject({
      id: first.id,
      status: 'done',
      priority: 'normal',
    });
    expect(initial.body.items[0].actions.map((action) => action.kind).sort()).toEqual([
      'channel_post',
      'discord_reply',
      'mirror',
    ]);

    const second = await report('Second report: site down');
    const changes = await agent
      .get(`/api/admin/guilds/${GUILD_ID}/interactions`)
      .query({ since: initial.body.cursor });
    expect(changes.body.items.map((item) => item.id)).toEqual([second.id]);
    expect(changes.body.hasMore).toBe(false);

    const page = await agent.get(`/api/admin/guilds/${GUILD_ID}/interactions?limit=1`);
    expect(page.body.hasMore).toBe(true);
    const older = await agent
      .get(`/api/admin/guilds/${GUILD_ID}/interactions`)
      .query({ limit: 1, before: page.body.items[0].receivedAt });
    expect(older.body.items[0].id).toBe(first.id);
  });

  it('returns interaction details with a timeline and without secrets', async () => {
    const payload = await report('Detail check');
    const response = await agent.get(`/api/admin/interactions/${payload.id}`);
    expect(response.status).toBe(200);
    const detail = response.body.interaction;
    expect(detail.report).toMatchObject({ status: 'open', text: 'Detail check' });
    expect(detail.timeline.some((entry) => entry.title === 'mirror attempt 1: succeeded')).toBe(
      true,
    );
    expect(JSON.stringify(detail)).not.toMatch(/token_?enc|aW50ZXJhY3Rpb246/i);
  });

  it('summarises health on the overview', async () => {
    await report('Overview check: outage');
    const { body } = await agent.get(`/api/admin/guilds/${GUILD_ID}/overview`);
    expect(body).toMatchObject({
      commands24h: 1,
      successRate: 1,
      openReports: 1,
      openHighPriority: 1,
      deadJobs: 0,
    });
    expect(body.averageAckMs).toBeGreaterThanOrEqual(0);
  });

  it('lists failed jobs and retries them on request', async () => {
    fake.respondWith(
      (call) => call.url.includes('?wait=true'),
      () => json({ code: 10015, message: 'Unknown Webhook' }, 404),
      { once: true },
    );
    await report('Will fail to mirror');
    const dead = await agent.get(`/api/admin/guilds/${GUILD_ID}/jobs?status=dead`);
    expect(dead.body.jobs).toHaveLength(1);
    expect(dead.body.jobs[0]).toMatchObject({ kind: 'mirror', retryable: true });

    const retry = await agent
      .post(`/api/admin/jobs/${dead.body.jobs[0].id}/retry`)
      .set('Origin', ORIGIN);
    expect(retry.status).toBe(202);
    await drainBackground();
    const [job] = await query('SELECT status, max_attempts FROM jobs WHERE id = $1', [
      dead.body.jobs[0].id,
    ]);
    expect(job.status).toBe('succeeded');

    const again = await agent
      .post(`/api/admin/jobs/${dead.body.jobs[0].id}/retry`)
      .set('Origin', ORIGIN);
    expect(again.status).toBe(409);
  });

  it('creates single-use connect codes, toggles demo settings and exposes bot info', async () => {
    const code = await agent.post('/api/admin/connect-codes').set('Origin', ORIGIN);
    expect(code.body.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(code.body.command).toBe(`/connect code:${code.body.code}`);
    const [stored] = await query('SELECT code_hash FROM connect_codes');
    expect(stored.code_hash).not.toBe(code.body.code);

    const demo = await agent
      .put(`/api/admin/guilds/${GUILD_ID}/demo`)
      .set('Origin', ORIGIN)
      .send({ mirrorOutage: true, slowAi: false });
    expect(demo.body.settings).toEqual({ mirrorOutage: true, slowAi: false });

    const bot = await agent.get('/api/admin/bot');
    expect(bot.body.inviteUrl).toContain('permissions=84992');
  });

  it('disconnects a server and removes its commands', async () => {
    const response = await agent.delete(`/api/admin/guilds/${GUILD_ID}`).set('Origin', ORIGIN);
    expect(response.body).toEqual({ commandsRemoved: true });
    const [command] = fake.callsTo(/PUT .*\/guilds\/\d+\/commands$/);
    expect(command.body).toEqual([]);
    const reply = await sendInteraction(commandInteraction({ name: 'status' }));
    expect(reply.body.data.content).toMatch(/not connected/);
  });

  it('lists security events for the admin', async () => {
    await request(app).post('/api/discord/interactions').send('{}');
    const { body } = await agent.get('/api/admin/security-events');
    expect(body.events[0]).toMatchObject({
      type: 'signature_rejected',
      detail: 'missing signature, timestamp or body',
    });
  });
});

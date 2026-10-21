import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/app.js';
import { drainBackground } from '../../src/utils/background.js';
import {
  ALL_PERMISSIONS,
  buttonInteraction,
  commandInteraction,
  member,
  modalInteraction,
  sendInteraction,
  signature,
} from '../helpers/discord.js';
import {
  REPORT_CHANNEL_ID,
  createAdmin,
  createGuild,
  query,
  resetDatabase,
} from '../helpers/database.js';
import { installFakeFetch } from '../helpers/fake-fetch.js';

const report = (text, severity) =>
  commandInteraction({
    name: 'report',
    options: [
      ...(text === undefined ? [] : [{ name: 'text', type: 3, value: text }]),
      ...(severity ? [{ name: 'severity', type: 3, value: severity }] : []),
    ],
  });

describe('interactions endpoint security', () => {
  beforeEach(resetDatabase);

  it('answers PING with PONG', async () => {
    const response = await sendInteraction({ id: '1', type: 1 });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ type: 1 });
  });

  it.each([
    ['missing headers', (req) => req],
    [
      'malformed signature',
      (req) => req.set('X-Signature-Ed25519', 'zz').set('X-Signature-Timestamp', '1'),
    ],
    [
      'wrong signature',
      (req) =>
        req
          .set('X-Signature-Ed25519', 'a'.repeat(128))
          .set('X-Signature-Timestamp', String(Math.floor(Date.now() / 1000))),
    ],
  ])('rejects %s with 401', async (_label, decorate) => {
    const response = await decorate(
      request(app).post('/api/discord/interactions').set('Content-Type', 'application/json'),
    ).send('{"id":"1","type":1}');
    expect(response.status).toBe(401);
  });

  it('rejects a tampered body', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await request(app)
      .post('/api/discord/interactions')
      .set('Content-Type', 'application/json')
      .set('X-Signature-Ed25519', signature('{"id":"1","type":1}', timestamp))
      .set('X-Signature-Timestamp', timestamp)
      .send('{"id":"1","type":2}');
    expect(response.status).toBe(401);
  });

  it('rejects oversized bodies', async () => {
    const response = await sendInteraction(null, {
      body: JSON.stringify({ id: '1', type: 1, pad: 'x'.repeat(300_000) }),
    });
    expect(response.status).toBe(413);
  });

  it('rejects signed bodies that are not interactions', async () => {
    expect((await sendInteraction(null, { body: 'not json' })).status).toBe(400);
    expect((await sendInteraction({ hello: 'world' })).status).toBe(400);
  });
});

describe('report pipeline', () => {
  let fake;
  let admin;

  beforeEach(async () => {
    await resetDatabase();
    admin = await createAdmin();
    await createGuild({ adminId: admin.id });
    fake = installFakeFetch();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('defers, records, decides, replies, posts the card and mirrors', async () => {
    const payload = report('Checkout is DOWN for EU users', 'medium');
    const response = await sendInteraction(payload);
    expect(response.body).toEqual({ type: 5, data: { flags: 64 } });
    await drainBackground();

    const [interaction] = await query('SELECT * FROM interactions WHERE id = $1', [payload.id]);
    expect(interaction.status).toBe('done');
    expect(interaction.decision).toMatchObject({
      allowed: true,
      priority: 'high',
      matchedRuleId: 'outage',
    });
    expect(interaction.ack_ms).toBeGreaterThanOrEqual(0);

    const [savedReport] = await query('SELECT * FROM reports WHERE interaction_id = $1', [
      payload.id,
    ]);
    expect(savedReport).toMatchObject({ priority: 'high', status: 'open', severity: 'medium' });
    expect(savedReport.channel_message_id).toMatch(/^\d+$/);
    expect(savedReport.mirror_message_id).toMatch(/^\d+$/);

    const [reply] = fake.callsTo(/PATCH .*messages\/@original$/);
    expect(reply.body.content).toMatch(/report #1/);
    expect(reply.body.allowed_mentions).toEqual({ parse: [] });

    const [card] = fake.callsTo(new RegExp(`POST .*/channels/${REPORT_CHANNEL_ID}/messages$`));
    expect(card.body).toMatchObject({ nonce: payload.id, enforce_nonce: true });
    expect(card.body.components[0].components.map((button) => button.custom_id)).toEqual([
      `r:ack:${savedReport.id}`,
      `r:escalate:${savedReport.id}`,
      `r:resolve:${savedReport.id}`,
    ]);

    const [mirror] = fake.callsTo(/POST .*webhooks\/\d+\/[^/]+\?wait=true$/);
    expect(mirror.body.embeds[0].footer.text).toBe(`Ref ${payload.id}`);
  });

  it('handles a duplicated delivery exactly once', async () => {
    const payload = report('Login page is down');
    await sendInteraction(payload);
    await drainBackground();
    const replay = await sendInteraction(payload);
    expect(replay.status).toBe(200);
    await drainBackground();

    expect(await query('SELECT id FROM interactions WHERE id = $1', [payload.id])).toHaveLength(1);
    expect(await query('SELECT id FROM jobs WHERE interaction_id = $1', [payload.id])).toHaveLength(
      4,
    );
    expect(fake.callsTo(/POST .*\/channels\/\d+\/messages$/)).toHaveLength(1);
    expect(await query(`SELECT id FROM events WHERE type = 'duplicate_interaction'`)).toHaveLength(
      1,
    );
  });

  it('blocks reports over the cooldown with a private reply and no card', async () => {
    for (let index = 0; index < 4; index += 1) {
      await sendInteraction(report(`Report number ${index}`));
      await drainBackground();
    }
    const [blocked] = await query(`SELECT * FROM interactions ORDER BY received_at DESC LIMIT 1`);
    expect(blocked.status).toBe('blocked');
    expect(blocked.decision.reason).toBe('cooldown');
    expect(await query('SELECT id FROM reports')).toHaveLength(3);
  });

  it('opens a modal when no text is given and processes its submission', async () => {
    const open = await sendInteraction(report(undefined, 'high'));
    expect(open.body.type).toBe(9);
    expect(open.body.data.custom_id).toBe('report_modal:high');

    const submit = modalInteraction({ text: 'Billing page broken', severity: 'high' });
    expect((await sendInteraction(submit)).body.type).toBe(5);
    await drainBackground();
    const [saved] = await query('SELECT priority, severity FROM reports');
    expect(saved).toEqual({ priority: 'high', severity: 'high' });
  });

  it('tells members of unconnected servers to run /connect', async () => {
    const payload = commandInteraction({
      name: 'report',
      guildId: '399999999999999999',
      options: [],
    });
    const response = await sendInteraction(payload);
    expect(response.body.type).toBe(4);
    expect(response.body.data.flags).toBe(64);
    expect(response.body.data.content).toMatch(/\/connect/);
  });

  it('answers /status inline with live figures', async () => {
    await sendInteraction(report('Outage in checkout'));
    await drainBackground();
    const response = await sendInteraction(commandInteraction({ name: 'status' }));
    expect(response.body.type).toBe(4);
    expect(response.body.data.content).toMatch(/Open reports: \*\*1\*\* \(1 high priority\)/);
  });

  it('applies a report transition once and explains repeated clicks', async () => {
    await sendInteraction(report('Search is slow'));
    await drainBackground();
    const [{ id: reportId }] = await query('SELECT id FROM reports');

    const first = await sendInteraction(buttonInteraction({ customId: `r:ack:${reportId}` }));
    expect(first.body).toEqual({ type: 6 });
    await drainBackground();
    await sendInteraction(buttonInteraction({ customId: `r:ack:${reportId}` }));
    await drainBackground();

    const [saved] = await query('SELECT status, handled_by_name FROM reports WHERE id = $1', [
      reportId,
    ]);
    expect(saved).toEqual({ status: 'acknowledged', handled_by_name: 'maya' });
    expect(fake.callsTo(/PATCH .*\/channels\/\d+\/messages\/\d+$/)).toHaveLength(1);
    const [followup] = fake.callsTo(/POST .*\/webhooks\/\d+\/[^/?]+$/);
    expect(followup.body).toMatchObject({
      content: `Report #${reportId} is already acknowledged.`,
      flags: 64,
    });
  });

  it('requires Manage Messages to resolve or escalate', async () => {
    const response = await sendInteraction(buttonInteraction({ customId: 'r:resolve:1' }));
    expect(response.body.data.content).toMatch(/Manage Messages/);
    const allowed = await sendInteraction(
      buttonInteraction({
        customId: 'r:resolve:1',
        actor: member({ permissions: ALL_PERMISSIONS }),
      }),
    );
    expect(allowed.body).toEqual({ type: 6 });
  });
});

describe('connect flow', () => {
  let fake;
  let agent;

  beforeEach(async () => {
    await resetDatabase();
    await createAdmin();
    fake = installFakeFetch();
    agent = request.agent(app);
    await agent
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'admin@example.com', password: 'correct horse battery staple' });
  });

  afterEach(() => vi.unstubAllGlobals());

  async function newCode() {
    const response = await agent
      .post('/api/admin/connect-codes')
      .set('Origin', 'http://localhost:5173');
    expect(response.status).toBe(201);
    return response.body.code;
  }

  const connect = (code, permissions = ALL_PERMISSIONS, guildId = '300000000000000777') =>
    commandInteraction({
      name: 'connect',
      guildId,
      options: [{ name: 'code', type: 3, value: code }],
      actor: member({ permissions }),
    });

  it('links the server, registers commands and confirms privately', async () => {
    const code = await newCode();
    const response = await sendInteraction(connect(code.toLowerCase()));
    expect(response.body).toEqual({ type: 5, data: { flags: 64 } });
    await drainBackground();

    const guilds = (await agent.get('/api/admin/guilds')).body.guilds;
    expect(guilds).toHaveLength(1);
    expect(guilds[0]).toMatchObject({
      id: '300000000000000777',
      name: 'Test Server',
      status: 'connected',
    });
    expect(fake.callsTo(/PUT .*\/guilds\/300000000000000777\/commands$/)).toHaveLength(1);
    const [reply] = fake.callsTo(/PATCH .*@original$/);
    expect(reply.body.content).toMatch(/is connected/);
  });

  it('rejects reused, invalid and unauthorised connect attempts', async () => {
    const code = await newCode();
    expect((await sendInteraction(connect(code, '0'))).body.data.content).toMatch(/Manage Server/);
    await sendInteraction(connect(code));
    await drainBackground();
    expect(
      (await sendInteraction(connect(code, ALL_PERMISSIONS, '300000000000000778'))).body.data
        .content,
    ).toMatch(/invalid, expired or already used/);
    expect((await sendInteraction(connect('WRONGCODE'))).body.data.content).toMatch(/invalid/);
  });

  it('keeps the server linked and flags it when command registration fails', async () => {
    fake.respondWith(
      (call) => call.method === 'PUT' && call.url.endsWith('/commands'),
      () =>
        new Response(JSON.stringify({ code: 50001, message: 'Missing Access' }), { status: 403 }),
    );
    await sendInteraction(connect(await newCode()));
    await drainBackground();
    const [guild] = (await agent.get('/api/admin/guilds')).body.guilds;
    expect(guild.status).toBe('needs_attention');
    expect(guild.attentionReason).toMatch(/Re-register commands/);
  });
});

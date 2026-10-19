import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../src/app.js';
import { TIMING } from '../../src/config/constants.js';
import { ADMIN, createAdmin, query, resetDatabase } from '../helpers/database.js';

const ORIGIN = 'http://localhost:5173';

function login(agent, body) {
  return agent.post('/api/auth/login').set('Origin', ORIGIN).send(body);
}

describe('authentication', () => {
  beforeEach(async () => {
    await resetDatabase();
    await createAdmin();
  });

  it('signs in, exposes the session through /me and signs out', async () => {
    const agent = request.agent(app);
    const response = await login(agent, { email: ' Admin@Example.com ', password: ADMIN.password });
    expect(response.status).toBe(200);
    expect(response.body.admin).toEqual({ id: expect.any(String), email: ADMIN.email });

    const cookie = response.headers['set-cookie'][0];
    expect(cookie).toMatch(/^sid=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.admin.email).toBe(ADMIN.email);

    const logout = await agent.post('/api/auth/logout').set('Origin', ORIGIN);
    expect(logout.status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('returns the same error for a wrong password and an unknown email', async () => {
    const wrongPassword = await login(request(app), { email: ADMIN.email, password: 'nope' });
    const unknownEmail = await login(request(app), {
      email: 'ghost@example.com',
      password: 'nope',
    });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.error.code).toBe('invalid_credentials');
  });

  it('rejects malformed bodies with field errors', async () => {
    const response = await login(request(app), { email: 'not-an-email', password: '' });
    expect(response.status).toBe(400);
    expect(response.body.error.fields).toMatchObject({
      email: 'Enter a valid email address.',
      password: 'Enter your password.',
    });
  });

  it('issues a new session id on every sign-in', async () => {
    const agent = request.agent(app);
    const first = await login(agent, { email: ADMIN.email, password: ADMIN.password });
    const second = await login(agent, { email: ADMIN.email, password: ADMIN.password });
    const sid = (res) => res.headers['set-cookie'][0].split(';')[0];
    expect(sid(first)).not.toBe(sid(second));
  });

  it('expires sessions after the absolute limit', async () => {
    const agent = request.agent(app);
    await login(agent, { email: ADMIN.email, password: ADMIN.password });
    await query(
      `UPDATE session SET sess = jsonb_set(sess::jsonb, '{createdAt}', to_jsonb($1::bigint))::json`,
      [Date.now() - TIMING.sessionAbsoluteMs - 1000],
    );
    const response = await agent.get('/api/auth/me');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('session_expired');
  });

  it('rate limits after five failed attempts for one email', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login(request(app), { email: ADMIN.email, password: 'wrong' })).status).toBe(
        401,
      );
    }
    const limited = await login(request(app), { email: ADMIN.email, password: ADMIN.password });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('rejects cross-origin and non-JSON state-changing requests', async () => {
    const crossOrigin = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: ADMIN.email, password: ADMIN.password });
    expect(crossOrigin.status).toBe(403);

    const noOrigin = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN.email, password: ADMIN.password });
    expect(noOrigin.status).toBe(403);

    const form = await request(app)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .type('form')
      .send(`email=${ADMIN.email}&password=x`);
    expect(form.status).toBe(415);
  });

  it('never leaks internals in error responses', async () => {
    const response = await login(request(app), { email: ADMIN.email, password: 'wrong' });
    const text = JSON.stringify(response.body);
    expect(text).not.toMatch(/stack|password_hash|\$2[aby]\$/);
  });

  it('protects admin routes and returns JSON for unknown API paths', async () => {
    expect((await request(app).get('/api/admin/guilds')).status).toBe(401);
    const unknown = await request(app).get('/api/nope');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('not_found');
  });

  it('records failed sign-ins as security events', async () => {
    await login(request(app), { email: ADMIN.email, password: 'wrong' });
    const rows = await query(`SELECT type, data FROM events WHERE type = 'login_failed'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].data.email).toBe(ADMIN.email);
  });
});

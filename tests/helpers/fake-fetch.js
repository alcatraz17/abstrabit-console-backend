import { vi } from 'vitest';
import { nextSnowflake } from './discord.js';

function json(body, status = 200, headers = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function defaultResponse(call) {
  const { url, method } = call;
  if (url.includes('hooks.slack.com')) return new Response('ok', { status: 200 });
  if (url.includes('api.groq.com')) {
    return json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: 'Checkout outage in the EU',
              tags: ['outage'],
              severity: 'high',
            }),
          },
        },
      ],
    });
  }
  if (/\/webhooks\/\d+\/[^/?]+\?wait=true$/.test(url)) return json({ id: nextSnowflake() });
  if (/\/webhooks\/\d+\/[^/?]+$/.test(url) && method === 'GET') {
    return json({ channel_id: '300000000000000013' });
  }
  if (url.endsWith('/messages/@original')) return json({ id: nextSnowflake() });
  if (/\/webhooks\/\d+\/[^/]+$/.test(url) && method === 'POST')
    return json({ id: nextSnowflake() });
  if (/\/channels\/\d+\/messages$/.test(url) && method === 'POST') {
    return json({ id: nextSnowflake(), channel_id: url.split('/').at(-2) });
  }
  if (/\/channels\/\d+\/messages\?limit=\d+$/.test(url)) return json([]);
  if (/\/channels\/\d+\/messages\/\d+$/.test(url)) return json({ id: url.split('/').at(-1) });
  if (/\/commands$/.test(url)) return json([]);
  if (/\/guilds\/\d+\/members\/\d+$/.test(url)) return json({ roles: ['300000000000000500'] });
  if (/\/guilds\/\d+\/channels$/.test(url)) {
    return json([
      {
        id: '300000000000000010',
        name: 'general',
        type: 0,
        position: 0,
        permission_overwrites: [],
      },
      {
        id: '300000000000000011',
        name: 'reports',
        type: 0,
        position: 1,
        permission_overwrites: [],
      },
      {
        id: '300000000000000012',
        name: 'locked',
        type: 0,
        position: 2,
        permission_overwrites: [{ id: '300000000000000001', type: 0, allow: '0', deny: '2048' }],
      },
      { id: '300000000000000014', name: 'voice', type: 2, position: 3, permission_overwrites: [] },
    ]);
  }
  if (/\/guilds\/\d+$/.test(url)) {
    const id = url.split('/').at(-1);
    return json({
      id,
      name: 'Test Server',
      owner_id: '500000000000000999',
      roles: [
        { id, permissions: '0' },
        { id: '300000000000000500', permissions: String(1024 + 2048 + 16384 + 65536) },
      ],
    });
  }
  return json({ message: 'Unhandled in fake fetch' }, 500);
}

export function installFakeFetch() {
  const calls = [];
  const overrides = [];
  const fake = vi.fn(async (input, init = {}) => {
    const call = {
      url: String(input),
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const index = overrides.findIndex((override) => override.match(call));
    if (index !== -1) {
      const [override] = overrides[index].once ? overrides.splice(index, 1) : [overrides[index]];
      return override.respond(call);
    }
    return defaultResponse(call);
  });
  vi.stubGlobal('fetch', fake);
  return {
    calls,
    respondWith(match, respond, { once = false } = {}) {
      overrides.push({ match, respond, once });
    },
    callsTo(pattern) {
      return calls.filter((call) => pattern.test(`${call.method} ${call.url}`));
    },
    clear() {
      calls.length = 0;
      overrides.length = 0;
    },
  };
}

export { json };

import { createPrivateKey, sign } from 'node:crypto';
import request from 'supertest';
import app from '../../src/app.js';
import { PERMISSIONS } from '../../src/config/constants.js';
import { GUILD_ID } from './database.js';

const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, 7)]),
  format: 'der',
  type: 'pkcs8',
});

let sequence = 0n;

export function nextSnowflake() {
  sequence += 1n;
  return (400000000000000000n + sequence).toString();
}

export const ALL_PERMISSIONS = (PERMISSIONS.MANAGE_GUILD | PERMISSIONS.MANAGE_MESSAGES).toString();

export function member({ id = '500000000000000001', name = 'maya', permissions = '0' } = {}) {
  return { user: { id, username: name, global_name: name }, permissions };
}

export function commandInteraction({ name, options = [], guildId = GUILD_ID, actor = member() }) {
  return {
    id: nextSnowflake(),
    type: 2,
    token: `aW50ZXJhY3Rpb246${nextSnowflake()}token`,
    guild_id: guildId,
    channel_id: '300000000000000010',
    member: actor,
    data: { name, options },
  };
}

export function buttonInteraction({ customId, guildId = GUILD_ID, actor = member() }) {
  return {
    id: nextSnowflake(),
    type: 3,
    token: `aW50ZXJhY3Rpb246${nextSnowflake()}token`,
    guild_id: guildId,
    channel_id: '300000000000000011',
    member: actor,
    data: { custom_id: customId, component_type: 2 },
  };
}

export function modalInteraction({
  text,
  severity = 'none',
  guildId = GUILD_ID,
  actor = member(),
}) {
  return {
    id: nextSnowflake(),
    type: 5,
    token: `aW50ZXJhY3Rpb246${nextSnowflake()}token`,
    guild_id: guildId,
    channel_id: '300000000000000010',
    member: actor,
    data: {
      custom_id: `report_modal:${severity}`,
      components: [{ type: 1, components: [{ type: 4, custom_id: 'report_text', value: text }] }],
    },
  };
}

export function signature(body, timestamp) {
  return sign(null, Buffer.from(`${timestamp}${body}`), privateKey).toString('hex');
}

export function sendInteraction(payload, { timestamp = Math.floor(Date.now() / 1000), body } = {}) {
  const raw = body ?? JSON.stringify(payload);
  return request(app)
    .post('/api/discord/interactions')
    .set('Content-Type', 'application/json')
    .set('X-Signature-Ed25519', signature(raw, String(timestamp)))
    .set('X-Signature-Timestamp', String(timestamp))
    .send(raw);
}

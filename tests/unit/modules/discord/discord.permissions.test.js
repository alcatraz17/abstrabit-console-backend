import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '../../../../src/config/constants.js';
import {
  basePermissions,
  canBotPost,
  channelPermissions,
  hasPermission,
} from '../../../../src/modules/discord/discord.permissions.js';

const GUILD = '1';
const BOT = '9';
const POST = (1024n + 2048n + 16384n + 65536n).toString();

const scope = (overrides = {}) => ({
  guildId: GUILD,
  ownerId: '2',
  roles: [
    { id: GUILD, permissions: '0' },
    { id: 'bot-role', permissions: POST },
    { id: 'admin-role', permissions: PERMISSIONS.ADMINISTRATOR.toString() },
  ],
  memberId: BOT,
  memberRoleIds: ['bot-role'],
  ...overrides,
});

describe('channel permissions', () => {
  it('grants posting from role permissions', () => {
    const base = basePermissions(scope());
    expect(canBotPost(channelPermissions(base, { ...scope(), overwrites: [] }))).toBe(true);
  });

  it('applies @everyone, role and member overwrites in Discord order', () => {
    const base = basePermissions(scope());
    const denyEveryone = [{ id: GUILD, type: 0, allow: '0', deny: '2048' }];
    expect(canBotPost(channelPermissions(base, { ...scope(), overwrites: denyEveryone }))).toBe(
      false,
    );

    const allowRole = [...denyEveryone, { id: 'bot-role', type: 0, allow: '2048', deny: '0' }];
    expect(canBotPost(channelPermissions(base, { ...scope(), overwrites: allowRole }))).toBe(true);

    const denyMember = [...allowRole, { id: BOT, type: 1, allow: '0', deny: '1024' }];
    expect(canBotPost(channelPermissions(base, { ...scope(), overwrites: denyMember }))).toBe(
      false,
    );
  });

  it('lets administrators and the owner bypass overwrites', () => {
    const admin = basePermissions(scope({ memberRoleIds: ['admin-role'] }));
    const denyAll = [{ id: GUILD, type: 0, allow: '0', deny: POST }];
    expect(canBotPost(channelPermissions(admin, { ...scope(), overwrites: denyAll }))).toBe(true);
    const owner = basePermissions(scope({ ownerId: BOT, memberRoleIds: [] }));
    expect(canBotPost(channelPermissions(owner, { ...scope(), overwrites: denyAll }))).toBe(true);
  });

  it('reads member permission strings safely', () => {
    expect(hasPermission(PERMISSIONS.MANAGE_GUILD.toString(), PERMISSIONS.MANAGE_GUILD)).toBe(true);
    expect(hasPermission(PERMISSIONS.ADMINISTRATOR.toString(), PERMISSIONS.MANAGE_MESSAGES)).toBe(
      true,
    );
    expect(hasPermission('0', PERMISSIONS.MANAGE_GUILD)).toBe(false);
    expect(hasPermission(undefined, PERMISSIONS.MANAGE_GUILD)).toBe(false);
    expect(hasPermission('not-a-number', PERMISSIONS.MANAGE_GUILD)).toBe(false);
  });
});

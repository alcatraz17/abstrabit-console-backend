import { BOT_CHANNEL_PERMISSIONS, PERMISSIONS } from '../../config/constants.js';

const ALL_PERMISSIONS = (1n << 64n) - 1n;

function toBigInt(value) {
  try {
    return BigInt(value ?? 0);
  } catch {
    return 0n;
  }
}

export function hasPermission(permissions, flag) {
  const value = toBigInt(permissions);
  return (
    (value & PERMISSIONS.ADMINISTRATOR) === PERMISSIONS.ADMINISTRATOR || (value & flag) === flag
  );
}

export function basePermissions({ guildId, ownerId, roles, memberId, memberRoleIds }) {
  if (memberId === ownerId) return ALL_PERMISSIONS;
  const roleMap = new Map(roles.map((role) => [role.id, toBigInt(role.permissions)]));
  let permissions = roleMap.get(guildId) ?? 0n;
  for (const roleId of memberRoleIds) permissions |= roleMap.get(roleId) ?? 0n;
  return (permissions & PERMISSIONS.ADMINISTRATOR) === PERMISSIONS.ADMINISTRATOR
    ? ALL_PERMISSIONS
    : permissions;
}

export function channelPermissions(base, { guildId, memberId, memberRoleIds, overwrites = [] }) {
  if (base === ALL_PERMISSIONS) return ALL_PERMISSIONS;
  let permissions = base;
  const everyone = overwrites.find((overwrite) => overwrite.id === guildId);
  if (everyone) {
    permissions &= ~toBigInt(everyone.deny);
    permissions |= toBigInt(everyone.allow);
  }
  let roleAllow = 0n;
  let roleDeny = 0n;
  for (const overwrite of overwrites) {
    if (overwrite.type === 0 && memberRoleIds.includes(overwrite.id)) {
      roleAllow |= toBigInt(overwrite.allow);
      roleDeny |= toBigInt(overwrite.deny);
    }
  }
  permissions &= ~roleDeny;
  permissions |= roleAllow;
  const member = overwrites.find((overwrite) => overwrite.type === 1 && overwrite.id === memberId);
  if (member) {
    permissions &= ~toBigInt(member.deny);
    permissions |= toBigInt(member.allow);
  }
  return permissions;
}

export function canBotPost(permissions) {
  return (permissions & BOT_CHANNEL_PERMISSIONS) === BOT_CHANNEL_PERMISSIONS;
}

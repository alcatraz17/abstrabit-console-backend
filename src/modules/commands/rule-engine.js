import { COMMANDS, LIMITS } from '../../config/constants.js';
import { containsPhrase, tokenize } from '../../utils/text.js';

export const BLOCK_REASONS = Object.freeze({
  COMMAND_DISABLED: 'command_disabled',
  EMPTY_TEXT: 'empty_text',
  COOLDOWN: 'cooldown',
});

export function priorityFromSeverity(severity) {
  if (severity === 'high') return 'high';
  if (severity === 'low') return 'low';
  return 'normal';
}

export function resolveMirror(policy, priority, override) {
  if (policy === 'never') return false;
  if (override !== null && override !== undefined) return override;
  return policy === 'always' || priority === 'high';
}

function matchKeyword(rule, tokens) {
  if (rule.match.anyKeywords.length === 0) return null;
  for (const keyword of rule.match.anyKeywords) {
    const phrase = tokenize(keyword);
    if (phrase.length > 0 && containsPhrase(tokens, phrase)) return keyword.trim();
  }
  return false;
}

function matchSeverity(rule, severity) {
  if (rule.match.severityIn.length === 0) return true;
  return severity !== null && rule.match.severityIn.includes(severity);
}

export function findMatchingRule(rules, tokens, severity) {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const keyword = matchKeyword(rule, tokens);
    if (keyword === false || !matchSeverity(rule, severity)) continue;
    return { rule, keyword };
  }
  return null;
}

function normalizeTags(tags) {
  const result = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase();
    if (tag && !result.includes(tag)) result.push(tag);
  }
  return result.slice(0, LIMITS.tagsPerDecision);
}

function blocked(version, reason, priority) {
  return {
    allowed: false,
    reason,
    priority,
    tags: [],
    mirror: false,
    postToChannel: false,
    aiEnabled: false,
    visibility: 'ephemeral',
    matchedRuleId: null,
    matchedRuleName: null,
    matchedKeyword: null,
    configVersion: version,
  };
}

export function evaluate(command, config, version, input) {
  const severity = input.severity ?? null;
  const basePriority = priorityFromSeverity(severity);
  if (!config.enabled) return blocked(version, BLOCK_REASONS.COMMAND_DISABLED, basePriority);

  const tokens = tokenize(input.text ?? '');
  if (command === COMMANDS.REPORT && tokens.length === 0) {
    return blocked(version, BLOCK_REASONS.EMPTY_TEXT, basePriority);
  }

  const recent = Number.isFinite(input.recentCountForUser)
    ? Math.max(0, input.recentCountForUser)
    : 0;
  if (config.cooldown && recent >= config.cooldown.maxCount) {
    return blocked(version, BLOCK_REASONS.COOLDOWN, basePriority);
  }

  const match = findMatchingRule(config.rules, tokens, severity);
  const priority = match?.rule.then.priority ?? basePriority;
  return {
    allowed: true,
    reason: null,
    priority,
    tags: normalizeTags(match?.rule.then.addTags ?? []),
    mirror: resolveMirror(config.mirrorPolicy, priority, match?.rule.then.mirror ?? null),
    postToChannel: config.postToChannel,
    aiEnabled: config.aiEnabled,
    visibility: config.visibility,
    matchedRuleId: match?.rule.id ?? null,
    matchedRuleName: match?.rule.name ?? null,
    matchedKeyword: match?.keyword ?? null,
    configVersion: version,
  };
}

export function describeBlockReason(reason, config) {
  switch (reason) {
    case BLOCK_REASONS.COMMAND_DISABLED:
      return 'This command is turned off for this server.';
    case BLOCK_REASONS.EMPTY_TEXT:
      return 'Add a description of the problem and try again.';
    case BLOCK_REASONS.COOLDOWN:
      return `You can send ${config?.cooldown?.maxCount ?? 'a few'} reports every ${Math.round((config?.cooldown?.windowSeconds ?? 300) / 60)} minutes. Please try again shortly.`;
    default:
      return 'This request could not be processed.';
  }
}

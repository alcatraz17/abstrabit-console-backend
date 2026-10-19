import { describe, expect, it } from 'vitest';
import { defaultCommandConfig } from '../../../../src/modules/commands/command-defaults.js';
import { commandConfigSchema } from '../../../../src/modules/commands/commands.schema.js';
import {
  evaluate,
  priorityFromSeverity,
  resolveMirror,
} from '../../../../src/modules/commands/rule-engine.js';

const rule = (overrides) => ({
  id: overrides.id,
  name: overrides.id,
  enabled: true,
  match: { anyKeywords: [], severityIn: [] },
  then: { priority: null, addTags: [], mirror: null },
  ...overrides,
});

const report = (overrides = {}) => ({ ...defaultCommandConfig('report'), ...overrides });
const input = { text: 'Checkout is down for EU users', severity: null, recentCountForUser: 0 };
const run = (config, overrides = {}, version = 3) =>
  evaluate('report', config, version, { ...input, ...overrides });

describe('rule engine', () => {
  it('applies the first matching enabled rule', () => {
    expect(run(report())).toMatchObject({
      allowed: true,
      priority: 'high',
      tags: ['outage'],
      mirror: true,
      matchedRuleId: 'outage',
      matchedKeyword: 'down',
      configVersion: 3,
    });
  });

  it.each([
    ['download speeds are slow', false],
    ['countdown timer broken', false],
    ['THE SITE IS DOWN!!!', true],
    ['site-down since noon', true],
    ['ＤＯＷＮ', true],
  ])('matches whole words only: %s', (text, matched) => {
    expect(run(report(), { text }).matchedRuleId === 'outage').toBe(matched);
  });

  it('matches phrases contiguously and ignores accents', () => {
    const config = report({
      rules: [
        rule({
          id: 'login',
          match: { anyKeywords: ['cannot log in', 'café'], severityIn: [] },
          then: { priority: 'high', addTags: [], mirror: null },
        }),
      ],
    });
    expect(run(config, { text: 'I CANNOT log-in' }).matchedRuleId).toBe('login');
    expect(run(config, { text: 'cannot even log in' }).matchedRuleId).toBeNull();
    expect(run(config, { text: 'The CAFE page fails' }).matchedRuleId).toBe('login');
  });

  it('requires keyword and severity when both are set', () => {
    const config = report({
      rules: [
        rule({
          id: 'billing',
          match: { anyKeywords: ['invoice'], severityIn: ['high'] },
          then: { priority: 'high', addTags: ['billing'], mirror: null },
        }),
      ],
    });
    expect(run(config, { text: 'invoice wrong', severity: 'high' }).matchedRuleId).toBe('billing');
    expect(run(config, { text: 'invoice wrong', severity: 'low' }).matchedRuleId).toBeNull();
    expect(run(config, { text: 'invoice wrong' }).matchedRuleId).toBeNull();
  });

  it('skips disabled rules and respects order', () => {
    const config = report({
      rules: [
        rule({
          id: 'off',
          enabled: false,
          match: { anyKeywords: ['down'], severityIn: [] },
          then: { priority: 'low', addTags: [], mirror: null },
        }),
        rule({
          id: 'second',
          match: { anyKeywords: ['down'], severityIn: [] },
          then: { priority: 'high', addTags: [], mirror: null },
        }),
        rule({
          id: 'third',
          match: { anyKeywords: ['down'], severityIn: [] },
          then: { priority: 'low', addTags: [], mirror: null },
        }),
      ],
    });
    expect(run(config).matchedRuleId).toBe('second');
  });

  it('falls back to the reported severity', () => {
    const config = report({ rules: [], mirrorPolicy: 'high_only' });
    expect(run(config, { severity: 'high' })).toMatchObject({ priority: 'high', mirror: true });
    expect(run(config, { severity: 'low' })).toMatchObject({ priority: 'low', mirror: false });
  });

  it.each([
    ['disabled command', report({ enabled: false }), {}, 'command_disabled'],
    ['empty text', report(), { text: '  !!! ' }, 'empty_text'],
    ['cooldown', report(), { recentCountForUser: 3 }, 'cooldown'],
  ])(
    'blocks on %s and keeps the decision private and inert',
    (_label, config, overrides, reason) => {
      expect(run(config, overrides)).toMatchObject({
        allowed: false,
        reason,
        visibility: 'ephemeral',
        mirror: false,
        postToChannel: false,
        aiEnabled: false,
        tags: [],
      });
    },
  );

  it('tolerates invalid cooldown counts and allows /status without text', () => {
    expect(run(report(), { recentCountForUser: Number.NaN }).allowed).toBe(true);
    expect(run(report(), { recentCountForUser: -4 }).allowed).toBe(true);
    expect(
      evaluate('status', defaultCommandConfig('status'), 1, { text: '', severity: null }).allowed,
    ).toBe(true);
  });

  it('normalises and deduplicates tags', () => {
    const config = report({
      rules: [
        rule({
          id: 'tags',
          match: { anyKeywords: ['down'], severityIn: [] },
          then: { priority: null, addTags: ['outage', 'api'], mirror: null },
        }),
      ],
    });
    expect(run(config).tags).toEqual(['outage', 'api']);
  });
});

describe('mirror resolution', () => {
  it('treats never as a hard stop and otherwise lets rules override', () => {
    expect(resolveMirror('never', 'high', true)).toBe(false);
    expect(resolveMirror('always', 'normal', false)).toBe(false);
    expect(resolveMirror('high_only', 'low', true)).toBe(true);
    expect(resolveMirror('high_only', 'high', null)).toBe(true);
    expect(resolveMirror('high_only', 'normal', null)).toBe(false);
  });

  it('maps severity to priority', () => {
    expect(['high', 'medium', 'low', null].map(priorityFromSeverity)).toEqual([
      'high',
      'normal',
      'low',
      'normal',
    ]);
  });
});

describe('command configuration schema', () => {
  it('accepts the defaults', () => {
    expect(commandConfigSchema.safeParse(defaultCommandConfig('report')).success).toBe(true);
    expect(commandConfigSchema.safeParse(defaultCommandConfig('status')).success).toBe(true);
  });

  it.each([
    ['duplicate keywords', { match: { anyKeywords: ['Down', 'down '], severityIn: [] } }],
    ['punctuation-only keyword', { match: { anyKeywords: ['!!!'], severityIn: [] } }],
    ['bad tag', { then: { priority: null, addTags: ['Bad Tag'], mirror: null } }],
    ['no effect', { then: { priority: null, addTags: [], mirror: null } }],
  ])('rejects %s', (_label, overrides) => {
    const config = report({
      rules: [
        rule({
          id: 'r',
          match: { anyKeywords: ['down'], severityIn: [] },
          then: { priority: 'high', addTags: [], mirror: null },
          ...overrides,
        }),
      ],
    });
    expect(commandConfigSchema.safeParse(config).success).toBe(false);
  });

  it('rejects duplicate rule ids, unknown placeholders and out-of-range cooldowns', () => {
    const base = report();
    expect(
      commandConfigSchema.safeParse({ ...base, rules: [base.rules[0], base.rules[0]] }).success,
    ).toBe(false);
    expect(commandConfigSchema.safeParse({ ...base, replyTemplate: 'Hi {ticket}' }).success).toBe(
      false,
    );
    expect(
      commandConfigSchema.safeParse({ ...base, cooldown: { maxCount: 0, windowSeconds: 60 } })
        .success,
    ).toBe(false);
    expect(
      commandConfigSchema.safeParse({ ...base, cooldown: { maxCount: 3, windowSeconds: 5 } })
        .success,
    ).toBe(false);
  });
});

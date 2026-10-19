import { z } from 'zod';
import {
  CONFIGURABLE_COMMANDS,
  LIMITS,
  MIRROR_POLICIES,
  PRIORITIES,
  SEVERITIES,
  VISIBILITIES,
} from '../../config/constants.js';
import { findUnknownPlaceholders } from '../../utils/template.js';
import { foldText, hasWordCharacter } from '../../utils/text.js';

const TAG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

const keywordSchema = z
  .string()
  .trim()
  .min(1, 'Keywords cannot be empty.')
  .max(LIMITS.keywordLength, `Keywords are at most ${LIMITS.keywordLength} characters.`)
  .refine(hasWordCharacter, 'Keywords need at least one letter or digit.');

const tagSchema = z
  .string()
  .trim()
  .min(1, 'Tags cannot be empty.')
  .max(LIMITS.tagLength, `Tags are at most ${LIMITS.tagLength} characters.`)
  .regex(TAG_PATTERN, 'Tags use lowercase letters, digits, hyphens and underscores.');

function duplicatesOf(values, normalize) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    const key = normalize(value);
    if (seen.has(key)) duplicates.add(value);
    seen.add(key);
  }
  return [...duplicates];
}

export const ruleSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    name: z
      .string()
      .trim()
      .min(1, 'Name the rule.')
      .max(LIMITS.ruleName, `Rule names are at most ${LIMITS.ruleName} characters.`),
    enabled: z.boolean(),
    match: z.object({
      anyKeywords: z
        .array(keywordSchema)
        .max(LIMITS.keywordsPerRule, `A rule has at most ${LIMITS.keywordsPerRule} keywords.`),
      severityIn: z.array(z.enum(SEVERITIES)),
    }),
    then: z.object({
      priority: z.enum(PRIORITIES).nullable(),
      addTags: z
        .array(tagSchema)
        .max(LIMITS.tagsPerRule, `A rule adds at most ${LIMITS.tagsPerRule} tags.`),
      mirror: z.boolean().nullable(),
    }),
  })
  .superRefine((rule, context) => {
    if (rule.match.anyKeywords.length === 0 && rule.match.severityIn.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['match', 'anyKeywords'],
        message: 'Add at least one keyword or severity to match on.',
      });
    }
    if (
      rule.then.priority === null &&
      rule.then.addTags.length === 0 &&
      rule.then.mirror === null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['then', 'priority'],
        message: 'Choose at least one effect: a priority, tags or a mirror setting.',
      });
    }
    const keywords = duplicatesOf(rule.match.anyKeywords, (value) => foldText(value));
    if (keywords.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['match', 'anyKeywords'],
        message: `Duplicate keywords: ${keywords.join(', ')}.`,
      });
    }
    const tags = duplicatesOf(rule.then.addTags, (value) => value);
    if (tags.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['then', 'addTags'],
        message: `Duplicate tags: ${tags.join(', ')}.`,
      });
    }
    if (new Set(rule.match.severityIn).size !== rule.match.severityIn.length) {
      context.addIssue({
        code: 'custom',
        path: ['match', 'severityIn'],
        message: 'List each severity once.',
      });
    }
  });

export const commandConfigSchema = z
  .object({
    enabled: z.boolean(),
    visibility: z.enum(VISIBILITIES),
    postToChannel: z.boolean(),
    mirrorPolicy: z.enum(MIRROR_POLICIES),
    aiEnabled: z.boolean(),
    cooldown: z
      .object({
        maxCount: z.number().int().min(1).max(LIMITS.cooldownMaxCount),
        windowSeconds: z.number().int().min(10).max(LIMITS.cooldownMaxWindowSeconds),
      })
      .nullable(),
    replyTemplate: z
      .string()
      .max(LIMITS.replyTemplate, `Templates are at most ${LIMITS.replyTemplate} characters.`)
      .superRefine((value, context) => {
        const unknown = findUnknownPlaceholders(value);
        if (unknown.length > 0) {
          context.addIssue({
            code: 'custom',
            message: `Unknown placeholders: ${unknown.map((name) => `{${name}}`).join(', ')}.`,
          });
        }
      }),
    rules: z
      .array(ruleSchema)
      .max(LIMITS.rulesPerCommand, `A command has at most ${LIMITS.rulesPerCommand} rules.`),
  })
  .superRefine((config, context) => {
    const ids = config.rules.map((rule) => rule.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', path: ['rules'], message: 'Rule ids must be unique.' });
    }
  });

export const commandParamsSchema = z.object({
  guildId: z.string().regex(/^\d{17,20}$/),
  command: z.enum(CONFIGURABLE_COMMANDS),
});

export const saveConfigSchema = z.object({
  expectedVersion: z.number().int().min(1),
  config: commandConfigSchema,
});

export const ruleTestSchema = z.object({
  command: z.enum(CONFIGURABLE_COMMANDS),
  config: commandConfigSchema,
  input: z.object({
    text: z.string().max(LIMITS.reportText),
    severity: z.enum(SEVERITIES).nullable(),
    recentCountForUser: z.number().int().min(0).max(1000),
  }),
});

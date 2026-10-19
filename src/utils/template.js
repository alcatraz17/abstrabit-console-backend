import { escapeMarkdown } from './text.js';

export const TEMPLATE_PLACEHOLDERS = Object.freeze([
  'reportId',
  'priority',
  'tags',
  'rule',
  'user',
]);
export const DEFAULT_REPLY_TEMPLATE = 'Logged as report #{reportId} with {priority} priority.';

const PLACEHOLDER = /\{([A-Za-z]+)\}/g;
const KNOWN = new Set(TEMPLATE_PLACEHOLDERS);

export function findUnknownPlaceholders(template) {
  const unknown = new Set();
  for (const [, name] of template.matchAll(PLACEHOLDER)) {
    if (!KNOWN.has(name)) unknown.add(name);
  }
  return [...unknown];
}

export function renderTemplate(template, values) {
  return template.replace(PLACEHOLDER, (whole, name) => {
    if (!KNOWN.has(name)) return whole;
    const value = values[name];
    return value === undefined || value === null || value === '' ? '—' : escapeMarkdown(value);
  });
}

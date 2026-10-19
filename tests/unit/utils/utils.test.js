import { describe, expect, it } from 'vitest';
import {
  decrypt,
  encrypt,
  normalizeCode,
  randomCode,
  safeEqual,
} from '../../../src/utils/crypto.js';
import { registerSecret, scrub, scrubDeep, scrubError } from '../../../src/utils/scrub.js';
import { findUnknownPlaceholders, renderTemplate } from '../../../src/utils/template.js';
import { containsPhrase, escapeMarkdown, tokenize, truncate } from '../../../src/utils/text.js';

describe('text', () => {
  it('folds case, width and accents and splits on punctuation', () => {
    expect(tokenize('Ｃafé DOWN!! log-in')).toEqual(['cafe', 'down', 'log', 'in']);
    expect(tokenize('Сервер упал')).toEqual(['сервер', 'упал']);
  });

  it('matches contiguous phrases only', () => {
    expect(containsPhrase(['a', 'b', 'c'], ['b', 'c'])).toBe(true);
    expect(containsPhrase(['a', 'b', 'c'], ['a', 'c'])).toBe(false);
    expect(containsPhrase(['a'], [])).toBe(false);
  });

  it('truncates by code point and escapes Discord markdown', () => {
    expect(truncate('😀😀😀😀', 3)).toBe('😀😀…');
    expect(truncate('short', 10)).toBe('short');
    expect(escapeMarkdown('**bold** _x_ `c`')).toBe('\\*\\*bold\\*\\* \\_x\\_ \\`c\\`');
  });
});

describe('templates', () => {
  it('fills known placeholders with escaped values and flags unknown ones', () => {
    expect(renderTemplate('#{reportId} by {user}', { reportId: 42, user: '*admin*' })).toBe(
      '#42 by \\*admin\\*',
    );
    expect(renderTemplate('{rule}', {})).toBe('—');
    expect(findUnknownPlaceholders('{reportId} {ticket} {foo}')).toEqual(['ticket', 'foo']);
  });
});

describe('crypto', () => {
  it('round-trips AES-GCM and rejects tampering', () => {
    const sealed = encrypt('https://hooks.slack.com/services/T1/B1/secret');
    expect(sealed).toMatch(/^v1:/);
    expect(decrypt(sealed)).toBe('https://hooks.slack.com/services/T1/B1/secret');
    const tampered = `${sealed.slice(0, -4)}AAAA`;
    expect(() => decrypt(tampered)).toThrow();
    expect(() => decrypt('v2:abc')).toThrow(/Unsupported/);
  });

  it('creates unambiguous codes and compares secrets safely', () => {
    expect(randomCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    expect(normalizeCode(' ab-cd ef ')).toBe('ABCDEF');
    expect(safeEqual('a', 'a')).toBe(true);
    expect(safeEqual('a', 'ab')).toBe(false);
  });
});

describe('scrub', () => {
  it.each([
    ['https://discord.com/api/webhooks/123/abcDEF_ghi-jkl', 'abcDEF_ghi'],
    ['https://hooks.slack.com/services/T1/B2/xyz123', 'xyz123'],
    ['token aW50ZXJhY3Rpb246MTIzNDU2Nzg5MA', 'aW50ZXJhY3Rpb246MTIz'],
    ['Authorization: Bot abc.def.ghi', 'abc.def.ghi'],
    ['Bearer gsk_abcdefghijklmnop', 'gsk_abcdefghijklmnop'],
    ['postgres://user:hunter2@db.example.com/app', 'hunter2'],
  ])('removes secrets from %s', (text, secret) => {
    const cleaned = scrub(text);
    expect(cleaned).not.toContain(secret);
    expect(cleaned).toContain('[redacted]');
  });

  it('removes registered values exactly and walks nested errors', () => {
    registerSecret('very-specific-secret-value');
    const error = new Error('outer very-specific-secret-value', {
      cause: new Error('inner https://discord.com/api/webhooks/1/secretToken'),
    });
    const serialized = JSON.stringify(scrubError(error));
    expect(serialized).not.toContain('very-specific-secret-value');
    expect(serialized).not.toContain('secretToken');
    expect(scrubDeep({ list: ['very-specific-secret-value'] })).toEqual({ list: ['[redacted]'] });
  });
});

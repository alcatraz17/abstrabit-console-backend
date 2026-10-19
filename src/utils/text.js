const COMBINING_MARKS = /\p{M}+/gu;
const NON_WORD = /[^\p{L}\p{N}]+/u;
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

export function foldText(value) {
  return value.normalize('NFKD').replace(COMBINING_MARKS, '').toLowerCase();
}

export function tokenize(value) {
  return foldText(value)
    .split(NON_WORD)
    .filter((token) => token.length > 0);
}

export function hasWordCharacter(value) {
  return WORD_CHARACTER.test(value);
}

export function containsPhrase(haystack, phrase) {
  if (phrase.length === 0 || phrase.length > haystack.length) return false;
  outer: for (let start = 0; start <= haystack.length - phrase.length; start += 1) {
    for (let offset = 0; offset < phrase.length; offset += 1) {
      if (haystack[start + offset] !== phrase[offset]) continue outer;
    }
    return true;
  }
  return false;
}

export function truncate(value, maxLength, suffix = '…') {
  const characters = Array.from(value ?? '');
  if (characters.length <= maxLength) return value ?? '';
  return characters.slice(0, Math.max(0, maxLength - 1)).join('') + suffix;
}

export function escapeMarkdown(value) {
  return String(value).replace(/[\\*_~`|>#[\]()-]/g, (character) => `\\${character}`);
}

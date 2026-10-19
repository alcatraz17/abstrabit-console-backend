import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'acorn';

const root = path.resolve(import.meta.dirname, '..');
const scanned = ['src', 'tests', 'scripts', 'cron-worker'];
const ignored = new Set(['node_modules', 'migrations', 'coverage', 'dist']);
const extensions = new Set(['.js', '.mjs']);

async function collect(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(
    entries.map(async (entry) => {
      if (ignored.has(entry.name)) return [];
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return collect(full);
      return extensions.has(path.extname(entry.name)) ? [full] : [];
    }),
  );
  return nested.flat();
}

const files = (await Promise.all(scanned.map((dir) => collect(path.join(root, dir))))).flat();
const violations = [];

for (const file of files) {
  const comments = [];
  parse(await readFile(file, 'utf8'), {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowHashBang: true,
    locations: true,
    onComment: comments,
  });
  for (const comment of comments) {
    violations.push(`${path.relative(root, file)}:${comment.loc.start.line}`);
  }
}

if (violations.length > 0) {
  console.error('Source files must not contain comments:');
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}

import { parseArgs } from 'node:util';
import readline from 'node:readline';

function promptHidden(question) {
  return new Promise((resolve) => {
    const input = process.stdin;
    if (!input.isTTY) {
      let data = '';
      input.setEncoding('utf8');
      input.on('data', (chunk) => (data += chunk));
      input.on('end', () => resolve(data.replace(/\r?\n$/, '')));
      return;
    }
    const rl = readline.createInterface({ input, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => {
      if (text.includes(question)) process.stdout.write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const { values } = parseArgs({
  options: { email: { type: 'string' }, reset: { type: 'boolean', default: false } },
});

const { emailSchema, newPasswordSchema } = await import('../src/modules/auth/auth.schema.js');
const email = emailSchema.safeParse(values.email ?? '');
if (!email.success) {
  console.error('Usage: npm run seed:admin -- --email <address> [--reset]');
  process.exit(1);
}

const password = await promptHidden('Password (at least 12 characters): ');
const confirmation = process.stdin.isTTY ? await promptHidden('Repeat password: ') : password;
if (password !== confirmation) {
  console.error('The passwords do not match.');
  process.exit(1);
}
const checked = newPasswordSchema.safeParse(password);
if (!checked.success) {
  console.error(checked.error.issues[0].message);
  process.exit(1);
}

const { upsertAdmin } = await import('../src/modules/auth/auth.service.js');
const { closeDatabase } = await import('../src/db/index.js');
try {
  const result = await upsertAdmin(email.data, password, { reset: values.reset });
  if (result.created) console.log(`Created admin ${email.data}.`);
  else if (result.updated)
    console.log(`Reset the password for ${email.data} and signed out its sessions.`);
  else console.log(`Admin ${email.data} already exists. Pass --reset to change its password.`);
} finally {
  await closeDatabase();
}

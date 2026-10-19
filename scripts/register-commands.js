import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { guild: { type: 'string' } } });

const { discord } = await import('../src/modules/discord/discord.client.js');
const { GLOBAL_COMMANDS, GUILD_COMMANDS } =
  await import('../src/modules/discord/discord.commands.js');
const { closeDatabase } = await import('../src/db/index.js');

try {
  if (values.guild) {
    if (!/^\d{17,20}$/.test(values.guild)) throw new Error('--guild must be a Discord server id.');
    await discord.setGuildCommands(values.guild, GUILD_COMMANDS);
    console.log(`Registered /report and /status in server ${values.guild}.`);
  } else {
    await discord.setGlobalCommands(GLOBAL_COMMANDS);
    console.log('Registered the global /connect command.');
  }
} catch (error) {
  console.error(`Registration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}

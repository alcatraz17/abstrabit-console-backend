import { evaluate } from './rule-engine.js';
import { getCommandConfig, saveCommandConfig } from './commands.service.js';

export async function show(req, res) {
  const { guildId, command } = req.valid.params;
  res.json(await getCommandConfig(guildId, command));
}

export async function update(req, res) {
  const { guildId, command } = req.valid.params;
  const { expectedVersion, config } = req.valid.body;
  res.json(
    await saveCommandConfig({ guildId, command, expectedVersion, config, adminId: req.admin.id }),
  );
}

export function testRules(req, res) {
  const { command, config, input } = req.valid.body;
  res.json({ decision: evaluate(command, config, 0, input) });
}

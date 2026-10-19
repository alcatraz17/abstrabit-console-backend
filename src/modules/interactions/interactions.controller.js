import { AppError } from '../../common/errors.js';
import { RESPONSE, ephemeralReply } from '../discord/discord.payloads.js';

const INTERACTION_TYPE = { PING: 1, COMMAND: 2, COMPONENT: 3, MODAL: 5 };

const NOT_READY = 'This command is not available yet. Please try again later.';

export async function handleInteraction(req, res) {
  switch (req.interaction.type) {
    case INTERACTION_TYPE.PING:
      return res.json({ type: RESPONSE.PONG });
    case INTERACTION_TYPE.COMMAND:
    case INTERACTION_TYPE.COMPONENT:
    case INTERACTION_TYPE.MODAL:
      return res.json(ephemeralReply(NOT_READY));
    default:
      throw new AppError(400, 'unsupported_interaction', 'This interaction type is not supported.');
  }
}

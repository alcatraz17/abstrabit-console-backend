import { NotFoundError } from '../../common/errors.js';
import { background } from '../../utils/background.js';
import { sweep } from '../jobs/jobs.runner.js';
import { feed, interactionDetail, overview, securityEvents } from './dashboard.service.js';

export async function showOverview(req, res) {
  res.json(await overview(req.guild.id));
}

export async function listInteractions(req, res) {
  const page = await feed(req.guild.id, req.valid.query);
  background(() => sweep({ limit: 5 }));
  res.json(page);
}

export async function showInteraction(req, res) {
  const detail = await interactionDetail(req.admin.id, req.valid.params.interactionId);
  if (!detail) throw new NotFoundError('That interaction was not found.');
  res.json({ interaction: detail });
}

export async function listSecurityEvents(req, res) {
  res.json({ events: await securityEvents(req.admin.id) });
}

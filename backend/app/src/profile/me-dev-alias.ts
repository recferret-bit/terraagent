import type { PrismaClient } from '@terra/db';
import { devPlayerId } from '../ws/session-verifier.js';
import type { ResolvedMePlayer } from './me-auth.js';

/** Dev fixture players that keep their literal `pr_dev_<name>` id (seeded by `W12SeedService`). */
const FIXTURE_IDS = new Set(['pr_dev_w12']);

/**
 * Dev only: `/me.html?as=<name>` resolves to `pr_dev_<name>`, while the game and staking sessions resolve `dev:<name>`
 * to `devPlayerId(name)`. When only the latter player exists (a dev pilot who played a scenario, e.g. `?scenario=w28`),
 * the profile follows it, so the wallet that pilot linked shows on `/me.html#staking`. Fixture ids and any `pr_dev_*`
 * with its own row are unchanged; production never aliases.
 */
export async function aliasDevPlayer(
  player: ResolvedMePlayer,
  prisma: PrismaClient | undefined,
  production: boolean,
): Promise<ResolvedMePlayer> {
  if (production || !player.id.startsWith('pr_dev_') || FIXTURE_IDS.has(player.id) || !prisma?.player) return player;
  const alias = devPlayerId(player.id.slice('pr_dev_'.length));
  const [own, played] = await Promise.all([
    prisma.player.findUnique({ where: { id: player.id }, select: { id: true } }),
    prisma.player.findUnique({ where: { id: alias }, select: { id: true } }),
  ]).catch(() => [null, null] as const);
  return !own && played ? { ...player, id: alias } : player;
}

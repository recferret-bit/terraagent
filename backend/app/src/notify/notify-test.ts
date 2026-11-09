import { HomeColonyId } from '@terra/contracts';
import { z } from 'zod';
import type { AlertRouteInput } from './alert-map.js';

export const NotifyTestBody = z.object({
  colonyId: HomeColonyId,
  planetId: z.string().min(1).max(80).optional(),
  tick: z.number().int().nonnegative().optional(),
  eventId: z.string().min(1).max(128).optional(),
}).strict();

export type NotifyTestInput = z.infer<typeof NotifyTestBody>;

/** One `under_attack` through the alert router. The mock writes a row only when that colony has no playing socket. */
export async function routeDevAttack(
  router: { route(input: AlertRouteInput): Promise<{ sent: number }> },
  body: NotifyTestInput,
  nowMs = Date.now(),
): Promise<{ kind: 'under_attack'; colonyId: string; sent: number }> {
  const result = await router.route({
    kind: 'under_attack',
    colonyId: body.colonyId,
    eventId: body.eventId ?? `dev:under_attack:${body.colonyId}:${nowMs}`,
    nowMs,
    ...(body.planetId ? { planetId: body.planetId } : {}),
    ...(body.tick !== undefined ? { tick: body.tick } : {}),
  });
  return { kind: 'under_attack', colonyId: body.colonyId, sent: result.sent };
}

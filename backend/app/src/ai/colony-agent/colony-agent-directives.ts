import { z } from 'zod';
import type { ColonyObservation } from './colony-agent-types.js';

export const AgentDirectiveSchema = z.object({
  action: z.enum([
    'queue_goal',
    'propose_truce',
    'respond_truce',
    'declare_war',
    'cancel_war',
    'raid',
    'trade',
    'accept_guild_offer',
    'cancel_truce',
    'stake',
    'hold',
  ]),
  goal: z.enum(['grow_economy', 'secure_power', 'defend_colony', 'terraform_zone', 'raid_target']).optional(),
  targetColonyIndex: z.number().int().nonnegative().optional(),
  offerId: z.string().min(1).optional(),
  accept: z.boolean().optional(),
  durationHours: z.union([z.literal(2), z.literal(6), z.literal(12), z.literal(24), z.literal(72)]).optional(),
  bondToken: z.string().optional(),
  bondAmount: z.number().nonnegative().optional(),
  tradeSide: z.enum(['buy', 'sell']).optional(),
  tradePair: z.string().optional(),
  tradeAmount: z.number().int().positive().optional(),
  tradeNotionalAtomic: z.string().regex(/^\d+$/).optional(),
  rationale: z.string().min(1).max(180),
});
export type AgentDirective = z.infer<typeof AgentDirectiveSchema>;

export const BatchedAgentDirectiveItemSchema = AgentDirectiveSchema.extend({
  colonyIndex: z.number().int().nonnegative(),
});
export type BatchedAgentDirectiveItem = z.infer<typeof BatchedAgentDirectiveItemSchema>;

export const BatchedAgentDirectivesSchema = z.object({
  directives: z.array(BatchedAgentDirectiveItemSchema),
});

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  return trimmed;
}

function clampDirectiveRationale(entry: unknown): unknown {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  const rec = entry as Record<string, unknown>;
  if (typeof rec.rationale === 'string' && rec.rationale.length > 180) {
    return { ...rec, rationale: `${rec.rationale.slice(0, 177)}...` };
  }
  return entry;
}

export function parseDirectiveJson(raw: string): AgentDirective | null {
  try {
    const obj = clampDirectiveRationale(JSON.parse(stripJsonFence(raw)) as unknown);
    const res = AgentDirectiveSchema.safeParse(obj);
    return res.success ? res.data : null;
  } catch {
    return null;
  }
}

export function parseBatchedDirectivesJson(
  raw: string,
  observations: readonly ColonyObservation[],
): { readonly map: Map<number, AgentDirective>; readonly isBatchedPayload: boolean } | null {
  try {
    const rawObj = JSON.parse(stripJsonFence(raw)) as unknown;
    const obj =
      rawObj && typeof rawObj === 'object' && !Array.isArray(rawObj) && Array.isArray((rawObj as { directives?: unknown }).directives)
        ? {
            ...(rawObj as Record<string, unknown>),
            directives: (rawObj as { directives: unknown[] }).directives.map(clampDirectiveRationale),
          }
        : clampDirectiveRationale(rawObj);
    const batched = BatchedAgentDirectivesSchema.safeParse(obj);
    if (batched.success) {
      const map = new Map<number, AgentDirective>();
      for (const item of batched.data.directives) {
        const { colonyIndex, ...directive } = item;
        map.set(colonyIndex, directive);
      }
      return { map, isBatchedPayload: true };
    }
    if (Array.isArray(obj)) {
      const map = new Map<number, AgentDirective>();
      obj.forEach((entry, idx) => {
        const clamped = clampDirectiveRationale(entry);
        const withIdx = BatchedAgentDirectiveItemSchema.safeParse(clamped);
        if (withIdx.success) {
          const { colonyIndex, ...directive } = withIdx.data;
          map.set(colonyIndex, directive);
          return;
        }
        const single = AgentDirectiveSchema.safeParse(clamped);
        const obs = observations[idx];
        if (single.success && obs) map.set(obs.colonyIndex, single.data);
      });
      if (map.size > 0) return { map, isBatchedPayload: true };
    }
    const single = AgentDirectiveSchema.safeParse(obj);
    if (single.success && observations[0]) {
      const map = new Map<number, AgentDirective>();
      map.set(observations[0].colonyIndex, single.data);
      return { map, isBatchedPayload: false };
    }
    return null;
  } catch {
    return null;
  }
}

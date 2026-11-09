import type { PriorityKey } from '@terra/contracts';
import type { BuildOrder } from './types';

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Pulls a building order out of either enqueueTask wire shape. */
export function buildOrder(args: unknown): BuildOrder | null {
  if (!isRec(args)) return null;
  const flat = typeof args.building === 'string' ? args : undefined;
  const direct = isRec(args.build) ? args.build : flat;
  const task = isRec(args.task) && args.task.kind === 'build' ? args.task : undefined;
  const src = direct ?? task;
  if (!src || typeof src.building !== 'string') return null;
  const q = num(src.q);
  const r = num(src.r);
  if (q === undefined || r === undefined) return null;
  const tier = num(src.tier) ?? 1;
  const taskId = typeof args.taskId === 'string' ? args.taskId : undefined;
  return { building: src.building, q, r, tier, taskId };
}

export function repairOrder(args: unknown): boolean {
  if (!isRec(args)) return false;
  if (isRec(args.repair)) return true;
  return isRec(args.task) && args.task.kind === 'repair';
}

export function unitOrder(args: unknown): { unit: string; tier: number } | null {
  if (!isRec(args)) return null;
  const src = isRec(args.buildUnit) ? args.buildUnit : isRec(args.task) && args.task.kind === 'buildUnit' ? args.task : null;
  if (!src || typeof src.unit !== 'string') return null;
  return { unit: src.unit, tier: num(src.tier) ?? 1 };
}

/** Slider patch from `setPriorities` (flat or `{ priorities }`). */
export function priorityPatch(args: unknown): Partial<Record<PriorityKey, number>> | null {
  if (!isRec(args)) return null;
  const src = isRec(args.priorities) ? args.priorities : args;
  const out: Partial<Record<PriorityKey, number>> = {};
  for (const key of ['economy', 'expansion', 'defense', 'power', 'terraform'] as const) {
    const n = num(src[key]);
    if (n !== undefined) out[key] = n;
  }
  return Object.keys(out).length ? out : null;
}

export function beaconTile(args: unknown): { q: number; r: number } | null {
  const order = buildOrder(args);
  if (!order) return null;
  if (order.building !== 'claimBeacon' && order.building !== 'outpostBeacon') return null;
  return { q: order.q, r: order.r };
}

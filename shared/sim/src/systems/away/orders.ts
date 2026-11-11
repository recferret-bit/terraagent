import type { PriorityKey } from '@terra/contracts';
import type { BuildOrder } from './types';

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const VALID_TRUCE_HOURS = new Set([2, 6, 24, 72]);

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

export function raidOrder(args: unknown): boolean {
  if (!isRec(args)) return false;
  if (isRec(args.raid) || args.kind === 'raid' || args.goal === 'raid_target') return true;
  if (isRec(args.goal) && args.goal.kind === 'raid_target') return true;
  return isRec(args.task) && args.task.kind === 'raid';
}

export function isRaidCommand(command: { readonly kind: string; readonly args: unknown }): boolean {
  if (command.kind === 'raid') return true;
  return (command.kind === 'enqueueTask' || command.kind === 'queueGoal') && raidOrder(command.args);
}

export function isCancelTruce(command: { readonly kind: string; readonly args: unknown }): boolean {
  if (command.kind === 'diplomacy.cancelTruce' || command.kind === 'cancelTruce' || command.kind === 'truceCancel') {
    return true;
  }
  if (!isRec(command.args)) return false;
  return (
    command.args.kind === 'cancelTruce' ||
    command.args.kind === 'diplomacy.cancelTruce' ||
    isRec(command.args.cancelTruce)
  );
}

export function isProposeTruce(command: { readonly kind: string; readonly args: unknown }): boolean {
  if (command.kind === 'diplomacy.proposeTruce' || command.kind === 'proposeTruce' || command.kind === 'truceOffer') {
    return true;
  }
  if (!isRec(command.args)) return false;
  return (
    command.args.kind === 'proposeTruce' ||
    command.args.kind === 'diplomacy.proposeTruce' ||
    isRec(command.args.proposeTruce) ||
    isRec(command.args.truceOffer)
  );
}

export function isRespondTruce(command: { readonly kind: string; readonly args: unknown }): boolean {
  if (command.kind === 'diplomacy.respondTruce' || command.kind === 'respondTruce' || command.kind === 'truceRespond') {
    return true;
  }
  if (!isRec(command.args)) return false;
  return (
    command.args.kind === 'respondTruce' ||
    command.args.kind === 'diplomacy.respondTruce' ||
    isRec(command.args.respondTruce) ||
    isRec(command.args.truceRespond)
  );
}

export function isTruceCommand(command: { readonly kind: string; readonly args: unknown }): boolean {
  return isCancelTruce(command) || isProposeTruce(command) || isRespondTruce(command);
}

/**
 * UO-DIP-05 / AW-13 / AC-13. While away, automated actors may propose or respond to truces
 * within valid duration bounds (2/6/24/72 h), and may NEVER cancel an active truce.
 */
export function withinDiplomacyPolicy(
  _view: unknown,
  command: { readonly kind: string; readonly args: unknown; readonly withinDiplomacy?: boolean },
): boolean {
  if (isCancelTruce(command) || command.withinDiplomacy === false) return false;
  const propose = isProposeTruce(command);
  const respond = isRespondTruce(command);
  if (!propose && !respond) return false;
  if (!isRec(command.args)) return true;
  if (command.args.withinDiplomacy === false) return false;
  if (propose) {
    const src = isRec(command.args.proposeTruce)
      ? command.args.proposeTruce
      : isRec(command.args.truceOffer)
        ? command.args.truceOffer
        : command.args;
    const rawHours = src.hours ?? src.durationHours;
    if (rawHours !== undefined && (typeof rawHours !== 'number' || !VALID_TRUCE_HOURS.has(rawHours))) {
      return false;
    }
  }
  if (respond) {
    const src = isRec(command.args.respondTruce)
      ? command.args.respondTruce
      : isRec(command.args.truceRespond)
        ? command.args.truceRespond
        : command.args;
    if (src.accept !== undefined && typeof src.accept !== 'boolean') return false;
    if (src.offerId !== undefined && (typeof src.offerId !== 'string' || src.offerId.length === 0)) return false;
  }
  return true;
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

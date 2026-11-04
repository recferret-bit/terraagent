import { parseWaves, type DirectorTrigger } from '@terra/contracts';
import { compileData, dataRow } from '@terra/sim';

/** One authoritative director signal before job admission (AI_ORCHESTRATOR §3). */
export interface TriggerEvent {
  trigger: DirectorTrigger;
  atMs: number;
  colonyId: string;
  critical: boolean;
  source: 'world' | 'director';
}

/** `kept` stays in input order. `coalesced` and `suppressed` count drops, not extra jobs. */
export interface TriggerProjection {
  kept: TriggerEvent[];
  coalesced: number;
  suppressed: number;
}

const PLAYER_INTENT: DirectorTrigger = 'player.intent_changed';

type AnchorMap = Map<string, Map<DirectorTrigger, TriggerEvent[]>>;

type Classified =
  | { kind: 'suppressed' }
  | { kind: 'coalesced' }
  | { kind: 'kept'; event: TriggerEvent };

/**
 * Drops director echoes, always keeps player intent, and coalesces the same colony and trigger
 * within `debounceMs` of an already kept event. A later critical event upgrades that kept event.
 */
export function projectTriggers(events: readonly TriggerEvent[], debounceMs: number): TriggerProjection {
  const kept: TriggerEvent[] = [];
  const anchors: AnchorMap = new Map();
  let coalesced = 0;
  let suppressed = 0;
  for (const event of events) {
    const outcome = classify(event, debounceMs, anchors);
    if (outcome.kind === 'suppressed') suppressed += 1;
    else if (outcome.kind === 'coalesced') coalesced += 1;
    else kept.push(outcome.event);
  }
  return { kept, coalesced, suppressed };
}

/** `cadence.debounceS` is design seconds (the row is not tick-converted). */
export function directorDebounceMs(): number {
  const seconds = dataRow(compileData(parseWaves('..16')), 'director', 'cadence').debounceS;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    throw new Error('director.cadence.debounceS is not a number');
  }
  return seconds * 1000;
}

function classify(event: TriggerEvent, debounceMs: number, anchors: AnchorMap): Classified {
  if (event.source === 'director') return { kind: 'suppressed' };
  if (event.trigger === PLAYER_INTENT) return { kind: 'kept', event: { ...event } };
  const prior = withinWindow(anchors, event, debounceMs);
  if (prior) {
    if (event.critical && !prior.critical) prior.critical = true;
    return { kind: 'coalesced' };
  }
  const owned = { ...event };
  bucket(anchors, owned).push(owned);
  return { kind: 'kept', event: owned };
}

/** Same colony and trigger, either side of the kept timestamp. Input order picks the anchor. */
function withinWindow(anchors: AnchorMap, event: TriggerEvent, debounceMs: number): TriggerEvent | undefined {
  const group = anchors.get(event.colonyId)?.get(event.trigger);
  return group?.find((prior) => Math.abs(event.atMs - prior.atMs) <= debounceMs);
}

function bucket(anchors: AnchorMap, event: TriggerEvent): TriggerEvent[] {
  let byTrigger = anchors.get(event.colonyId);
  if (!byTrigger) {
    byTrigger = new Map();
    anchors.set(event.colonyId, byTrigger);
  }
  let group = byTrigger.get(event.trigger);
  if (!group) {
    group = [];
    byTrigger.set(event.trigger, group);
  }
  return group;
}

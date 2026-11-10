import type { AwayAllowRule, AwayCommand, AwayPolicyView, BuildOrder } from './types';
import { AWAY_FAMILIES } from './types';
import { beaconTile, buildOrder, priorityPatch, repairOrder, unitOrder } from './orders';

const DEFENSE = new Set(['turret', 'pulseTurret', 'laserTower', 'watchtower', 'wall']);
const POWER = new Set(['solar', 'battery', 'generator']);

function isExtractor(kind: string): boolean {
  return /extractor/i.test(kind);
}

/** One directive may spend at most `perDirectivePct` of the away-start stock (AW-20). */
export function withinDirective(view: AwayPolicyView, cost: AwayCommand['cost']): boolean {
  for (const family of AWAY_FAMILIES) {
    const spend = cost?.[family] ?? 0;
    if (spend < 0) return false;
    const row = view.budget[family];
    const cap = (row.stock.start * row.perDirectivePct) / 100;
    if (spend > cap) return false;
  }
  return true;
}

function sameTile(order: BuildOrder, kind: string, tier: number, q: number, r: number): boolean {
  return order.building === kind && order.tier === tier && order.q === q && order.r === r;
}

function matchRebuild(view: AwayPolicyView, order: BuildOrder | null, repair: boolean): boolean {
  if (repair) return true;
  if (!order) return false;
  return view.baseline.some((b) => b.destroyed && sameTile(order, b.kind, b.tier, b.q, b.r));
}

function matchThreatBuild(view: AwayPolicyView, order: BuildOrder | null, cost: AwayCommand['cost']): boolean {
  if (!order || (!view.threat.underAttack && !view.threat.brownout)) return false;
  const kind = DEFENSE.has(order.building) || POWER.has(order.building);
  return kind && withinDirective(view, cost);
}

function withinSession(view: AwayPolicyView, cost: AwayCommand['cost']): boolean {
  for (const family of AWAY_FAMILIES) {
    const spend = cost?.[family] ?? 0;
    const row = view.budget[family];
    const cap = (row.stock.start * row.perSessionPct) / 100;
    if (row.stock.spent + spend > cap) return false;
  }
  return true;
}

function matchExtractor(view: AwayPolicyView, order: BuildOrder | null, cost: AwayCommand['cost']): boolean {
  if (!order || order.tier !== 1 || !isExtractor(order.building)) return false;
  return withinDirective(view, cost) && withinSession(view, cost);
}

function matchQueued(view: AwayPolicyView, args: unknown): boolean {
  if (typeof args !== 'object' || args === null) return false;
  const id = (args as { taskId?: unknown }).taskId;
  return typeof id === 'string' && view.queuedTaskIds.includes(id);
}

function matchPriorities(view: AwayPolicyView, args: unknown): AwayAllowRule | null {
  const patch = priorityPatch(args);
  if (!patch) return null;
  let moved = false;
  for (const key of ['economy', 'expansion', 'defense', 'power', 'terraform'] as const) {
    const next = patch[key];
    if (next === undefined) continue;
    const delta = Math.abs(next - view.priorities[key]);
    if (delta > view.guardPoints) return null;
    if (delta > 0) moved = true;
  }
  return moved ? 'AW-06' : 'AW-01';
}

function matchUnits(view: AwayPolicyView, args: unknown): boolean {
  const unit = unitOrder(args);
  if (!unit || unit.tier > view.unlockStage) return false;
  if (!view.ownedUnitKinds.includes(unit.unit)) return false;
  return view.lossKinds.includes(unit.unit);
}

function matchBeacon(view: AwayPolicyView, args: unknown): boolean {
  const tile = beaconTile(args);
  if (!tile) return false;
  return view.queuedBeacons.some((b) => b.q === tile.q && b.r === tile.r);
}

/** The first matching allow rule, or null when none of AW-01..07 apply. */
export function allowRule(view: AwayPolicyView, command: AwayCommand): AwayAllowRule | null {
  if (command.kind === 'shedLoad') return 'AW-05';
  if (command.kind === 'setPriorities') return matchPriorities(view, command.args);
  const order = command.kind === 'enqueueTask' || command.kind === 'placeBuilding' ? buildOrder(command.args) : null;
  if (matchQueued(view, command.args)) return 'AW-01';
  if (matchRebuild(view, order, command.kind === 'repair' || repairOrder(command.args))) return 'AW-02';
  if (matchThreatBuild(view, order, command.cost)) return 'AW-03';
  if (matchExtractor(view, order, command.cost)) return 'AW-01';
  if ((command.kind === 'enqueueTask' || command.kind === 'buildUnit') && matchUnits(view, command.args)) return 'AW-04';
  if (matchBeacon(view, command.args)) return 'AW-07';
  return null;
}

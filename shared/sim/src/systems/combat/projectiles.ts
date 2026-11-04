import { rowOf } from '../../ecs/store';
import { hexDistance, hexRound } from '../../grid/hex';
import { TICKS_PER_SECOND } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { colonyWho } from '../find';
import { collectAoeSplashTargets, getEntityHitRadius, SPLASH_DAMAGE_RATIO } from './aoe';
import { applyDamage } from './damage';

export { getEntityHitRadius } from './aoe';

export const PROJECTILE_IMPACTS_BLOB = 'projectileImpacts';

export type ProjectileWeaponKind = 'bullet' | 'shell' | 'rocket' | 'acid';

export interface ProjectilePoint {
  x: number;
  y: number;
  q: number;
  r: number;
}

export interface PendingProjectileImpact {
  id: number;
  attackerId: number;
  attackerOwner: number;
  targetId: number;
  weaponId: string;
  weaponKind: ProjectileWeaponKind;
  from: ProjectilePoint;
  to: ProjectilePoint;
  damage: number;
  speed: number;
  aoe: number;
  firedTick: number;
  impactTick: number;
}

export interface ProjectileImpactsBlob {
  nextProjectileId: number;
  queue: PendingProjectileImpact[];
}

export interface FireProjectileOptions {
  attackerId: number;
  attackerOwner?: number;
  targetId: number;
  weaponId?: string;
  weaponKind?: ProjectileWeaponKind;
  from?: { x: number; y: number; q?: number; r?: number };
  to?: { x: number; y: number; q?: number; r?: number };
  damage: number;
  speed: number;
  aoe?: number;
  tick?: number;
  arc?: 'direct' | 'indirect';
  /** When true, `speed` is already expressed in tiles/tick rather than tiles/second. */
  speedIsPerTick?: boolean;
}

export interface ProjectileImpactEvent {
  id: number;
  tick: number;
  attackerId: number;
  attackerOwner: number;
  targetId: number;
  weaponId: string;
  weaponKind: ProjectileWeaponKind;
  at: ProjectilePoint;
  to: ProjectilePoint;
  hit: boolean;
  hitIds: number[];
  hitEntityIds: number[];
  aoe: number;
  damage: number;
}

export type ApplyProjectileDamageFn = (
  state: PlanetState,
  targetId: number,
  amount: number,
  attackerId: number,
  attackerOwner: number,
  ctx?: StepContext,
) => void;

function toContractWeaponType(kind: ProjectileWeaponKind): 'bullet' | 'shell' | 'rocket' {
  if (kind === 'shell') return 'shell';
  if (kind === 'rocket') return 'rocket';
  return 'bullet';
}

function inferWeaponKind(weaponId?: string, explicit?: ProjectileWeaponKind): ProjectileWeaponKind {
  if (explicit) return explicit;
  if (weaponId === 'spitterAcid' || weaponId === 'acid') return 'acid';
  if (weaponId === 'artilleryShell' || weaponId === 'shell') return 'shell';
  if (weaponId === 'tankRocket' || weaponId === 'rocket') return 'rocket';
  return 'bullet';
}

function emitCombatEvent(
  state: PlanetState,
  ctx: StepContext | undefined,
  kind: 'projectileFired' | 'projectileImpact',
  attackerOwner: number,
  contractData: Record<string, unknown>,
  aliases: Record<string, unknown>,
): void {
  if (!ctx || typeof ctx.emit !== 'function') return;
  const colonyIds: (string | number)[] = [];
  const data: Record<string, unknown> = { ...contractData };
  if (attackerOwner >= 0 && state.colonies[attackerOwner]) {
    const { colonyIdStr, who } = colonyWho(state, attackerOwner);
    colonyIds.push(colonyIdStr);
    Object.assign(data, who, { colonyIndex: attackerOwner });
  }
  for (const [k, v] of Object.entries(aliases)) {
    Object.defineProperty(data, k, { value: v, enumerable: false, configurable: true, writable: true });
  }

  const emitFn = ctx.emit as unknown as (...args: unknown[]) => void;
  if (emitFn.length >= 2) {
    emitFn(kind, data);
  } else {
    ctx.emit({ kind, severity: 'info', colonyIds, data });
  }
}

/**
 * Reads the current projectile impact queue from `state.blobs.projectileImpacts`.
 */
export function getProjectileImpactsBlob(state: PlanetState): ProjectileImpactsBlob {
  const raw = state.blobs[PROJECTILE_IMPACTS_BLOB]?.value as Partial<ProjectileImpactsBlob> | undefined;
  const nextProjectileId =
    typeof raw?.nextProjectileId === 'number' && raw.nextProjectileId >= 1 ? raw.nextProjectileId : 1;
  const queue = Array.isArray(raw?.queue)
    ? raw.queue.map((item) => ({ ...item, from: { ...item.from }, to: { ...item.to } }))
    : [];
  return { nextProjectileId, queue };
}

/**
 * Returns the pending projectile impacts currently queued on `state`.
 */
export function getPendingProjectileImpacts(state: PlanetState): readonly PendingProjectileImpact[] {
  return getProjectileImpactsBlob(state).queue;
}

function normalizePoint(
  pt: { x: number; y: number; q?: number; r?: number } | undefined,
  fallbackX: number,
  fallbackY: number,
  fallbackQ: number,
  fallbackR: number,
): ProjectilePoint {
  if (!pt) return { x: fallbackX, y: fallbackY, q: fallbackQ, r: fallbackR };
  const [rq, rr] = pt.q !== undefined && pt.r !== undefined ? [pt.q, pt.r] : hexRound(pt.x, pt.y);
  return { x: pt.x, y: pt.y, q: rq, r: rr };
}

function resolveProjectileEndpoints(
  state: PlanetState,
  opts: FireProjectileOptions,
): { attackerOwner: number; from: ProjectilePoint; to: ProjectilePoint } {
  const cols = state.entities.cols;
  const aRow = rowOf(state.entities, opts.attackerId);
  const tRow = rowOf(state.entities, opts.targetId);
  const attackerOwner = opts.attackerOwner ?? (aRow >= 0 ? cols.owner[aRow]! : -1);
  const from = normalizePoint(
    opts.from,
    aRow >= 0 ? cols.x[aRow]! : 0,
    aRow >= 0 ? cols.y[aRow]! : 0,
    aRow >= 0 ? cols.q[aRow]! : 0,
    aRow >= 0 ? cols.r[aRow]! : 0,
  );
  const to = normalizePoint(
    opts.to,
    tRow >= 0 ? cols.x[tRow]! : from.x,
    tRow >= 0 ? cols.y[tRow]! : from.y,
    tRow >= 0 ? cols.q[tRow]! : from.q,
    tRow >= 0 ? cols.r[tRow]! : from.r,
  );
  return { attackerOwner, from, to };
}

/**
 * Fires a non-laser projectile (`UO-C-03`): schedules an impact in `state.blobs.projectileImpacts`
 * and emits `projectileFired` without creating an ECS entity row.
 */
export function fireProjectile(
  state: PlanetState,
  opts: FireProjectileOptions,
  ctx?: StepContext,
): PendingProjectileImpact {
  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const { attackerOwner, from, to } = resolveProjectileEndpoints(state, opts);
  const weaponKind = inferWeaponKind(opts.weaponId, opts.weaponKind);
  const weaponId = opts.weaponId ?? weaponKind;
  const speed = Math.max(1e-6, opts.speed);
  const aoe = Math.max(0, opts.aoe ?? 0);
  const damage = Math.max(0, opts.damage);

  const dist = Math.max(0, hexDistance(from.x, from.y, to.x, to.y));
  const dtTicks = Math.max(1, ctx?.dt ?? 1);
  const stepDist = opts.speedIsPerTick ? speed * dtTicks : (speed / TICKS_PER_SECOND) * dtTicks;
  const flightTicks = Math.max(1, Math.ceil(dist / stepDist - 1e-9));
  const impactTick = tick + flightTicks;

  const blob = getProjectileImpactsBlob(state);
  const entry: PendingProjectileImpact = {
    id: blob.nextProjectileId,
    attackerId: opts.attackerId,
    attackerOwner,
    targetId: opts.targetId,
    weaponId,
    weaponKind,
    from,
    to,
    damage,
    speed: opts.speed,
    aoe,
    firedTick: tick,
    impactTick,
  };

  setBlob(state, PROJECTILE_IMPACTS_BLOB, { nextProjectileId: blob.nextProjectileId + 1, queue: [...blob.queue, entry] }, tick);

  emitCombatEvent(
    state,
    ctx,
    'projectileFired',
    attackerOwner,
    {
      attackerId: entry.attackerId,
      targetId: entry.targetId,
      weaponId: entry.weaponId,
      weaponType: toContractWeaponType(entry.weaponKind),
      ...(opts.arc ? { arc: opts.arc } : {}),
      fromX: from.x,
      fromY: from.y,
      aimX: to.x,
      aimY: to.y,
      q: Math.round(from.q),
      r: Math.round(from.r),
      aimQ: Math.round(to.q),
      aimR: Math.round(to.r),
      speed: entry.speed,
      flightTicks,
      impactTick,
      ...(aoe > 0 ? { aoe } : {}),
      damage: entry.damage,
    },
    { tick, weaponKind: entry.weaponKind, from: { ...from }, to: { ...to } },
  );

  return entry;
}

function defaultApplyProjectileDamage(
  state: PlanetState,
  targetId: number,
  amount: number,
  attackerId?: number,
  attackerOwner?: number,
  tick?: number,
  ctx?: StepContext,
): void {
  applyDamage(state, targetId, amount, {
    attackerId,
    attackerOwner,
    tick: tick ?? ctx?.tick ?? state.meta.tick,
    ctx,
    data: ctx?.data,
  });
}

function resolveSingleImpact(
  state: PlanetState,
  impact: PendingProjectileImpact,
  tick: number,
  ctx?: StepContext,
  applyDmg?: ApplyProjectileDamageFn,
): ProjectileImpactEvent {
  const cols = state.entities.cols;
  const hitIds: number[] = [];
  let directHitTarget = false;

  const dealDamage = (targetId: number, amount: number): void => {
    if (applyDmg) applyDmg(state, targetId, amount, impact.attackerId, impact.attackerOwner, ctx);
    else defaultApplyProjectileDamage(state, targetId, amount, impact.attackerId, impact.attackerOwner, tick, ctx);
  };

  const tRow = rowOf(state.entities, impact.targetId);
  if (tRow >= 0 && cols.hp[tRow]! > 0) {
    const d = hexDistance(cols.x[tRow]!, cols.y[tRow]!, impact.to.x, impact.to.y);
    const r = getEntityHitRadius(state, tRow, ctx?.data);
    if (d <= r + 1e-5) {
      directHitTarget = true;
      hitIds.push(impact.targetId);
      dealDamage(impact.targetId, impact.damage);
    }
  }

  if (impact.aoe > 0) {
    const splashTargets = collectAoeSplashTargets(
      state,
      impact.to,
      impact.aoe,
      impact.attackerOwner,
      directHitTarget ? impact.targetId : undefined,
      ctx?.data,
    );
    const splashDamage = impact.damage * SPLASH_DAMAGE_RATIO;
    for (const splashId of splashTargets) {
      hitIds.push(splashId);
      dealDamage(splashId, splashDamage);
    }
  }

  const hit = hitIds.length > 0;
  emitCombatEvent(
    state,
    ctx,
    'projectileImpact',
    impact.attackerOwner,
    {
      attackerId: impact.attackerId,
      targetId: impact.targetId,
      weaponId: impact.weaponId,
      weaponType: toContractWeaponType(impact.weaponKind),
      aimX: impact.to.x,
      aimY: impact.to.y,
      q: Math.round(impact.to.q),
      r: Math.round(impact.to.r),
      hit,
      ...(impact.aoe > 0 ? { aoe: impact.aoe } : {}),
      damage: impact.damage,
      hitEntityIds: [...hitIds],
    },
    { tick, weaponKind: impact.weaponKind, at: { ...impact.to }, to: { ...impact.to }, hitIds: [...hitIds], aoe: impact.aoe },
  );

  return {
    id: impact.id,
    tick,
    attackerId: impact.attackerId,
    attackerOwner: impact.attackerOwner,
    targetId: impact.targetId,
    weaponId: impact.weaponId,
    weaponKind: impact.weaponKind,
    at: { ...impact.to },
    to: { ...impact.to },
    hit,
    hitIds,
    hitEntityIds: [...hitIds],
    aoe: impact.aoe,
    damage: impact.damage,
  };
}

/**
 * Resolves all queued projectile impacts due at or before `tick` (`impact.impactTick <= tick`)
 * in ascending `id` order, applying direct and AoE splash damage and emitting `projectileImpact`.
 */
export function stepProjectileImpacts(
  state: PlanetState,
  tick: number = state.meta.tick,
  ctx?: StepContext,
  applyDmg?: ApplyProjectileDamageFn,
): ProjectileImpactEvent[] {
  const blob = getProjectileImpactsBlob(state);
  if (blob.queue.length === 0) return [];

  const due: PendingProjectileImpact[] = [];
  const remaining: PendingProjectileImpact[] = [];

  for (const item of blob.queue) {
    if (item.impactTick <= tick) due.push(item);
    else remaining.push(item);
  }
  if (due.length === 0) return [];

  due.sort((a, b) => a.id - b.id);
  setBlob(state, PROJECTILE_IMPACTS_BLOB, { nextProjectileId: blob.nextProjectileId, queue: remaining }, tick);

  const resolved: ProjectileImpactEvent[] = [];
  for (const impact of due) {
    resolved.push(resolveSingleImpact(state, impact, tick, ctx, applyDmg));
  }
  return resolved;
}

export const projectileImpactsSystem = defineSystem({
  id: 'combat.projectiles',
  slot: 10,
  wave: 'W07',
  run(state, ctx) {
    stepProjectileImpacts(state, ctx.tick, ctx);
  },
});

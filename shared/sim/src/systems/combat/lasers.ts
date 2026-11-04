import { compileData, type CompiledRow } from '../../data';
import { ENTITY_KIND } from '../../ecs/columns';
import { removeRow, rowOf, setField } from '../../ecs/store';
import { hexDistance } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { colonyWho } from '../find';
import { recordEntityDamaged } from './hqSurvival';
import { canWeaponHitTarget } from './layers';

export type ApplyLaserDamageFn = (
  state: PlanetState,
  targetId: number,
  amount: number,
  attackerId: number,
  attackerOwner: number,
  ctx?: StepContext,
) => void;

export interface FireLaserOptions {
  attackerId: number;
  targetId: number;
  weaponId?: string;
  weaponRow?: Record<string, unknown>;
  damage?: number;
  range?: number;
  minRange?: number;
  tick?: number;
  applyDmg?: ApplyLaserDamageFn;
}

export interface LaserFireResult {
  hit: boolean;
  damageDealt: number;
  targetId?: number;
  tick?: number;
}

interface LaserPoint {
  x: number;
  y: number;
  q: number;
  r: number;
}

const W07_WAVE_SET = new Set(['W00', 'W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07']);
let cachedW07Data: CompiledDataLike | null = null;

function defaultW07Data(): CompiledDataLike {
  if (!cachedW07Data) cachedW07Data = compileData(W07_WAVE_SET);
  return cachedW07Data;
}

const WEAPON_ID_ALIASES: Readonly<Record<string, string>> = {
  pulsedLaser: 'laserTower',
  mandibleBite: 'antBite',
  hornGore: 'beetleBite',
};

const KIND_TO_DEFAULT_LASER_WEAPON_ID: Readonly<Record<number, string>> = {
  [ENTITY_KIND.laserTower]: 'laserTower',
  [ENTITY_KIND.blackAnt]: 'antBite',
  [ENTITY_KIND.blueBeetle]: 'beetleBite',
};

const DEFAULT_LASER_WEAPON_ROW: Readonly<Record<string, unknown>> = {
  id: 'laser',
  kind: 'laser',
  weaponType: 'laser',
  delivery: 'instant',
  hitsGround: true,
  hitsAir: true,
};

/**
 * Resolves a weapon row by id (including aliases such as `pulsedLaser`, `mandibleBite`, `hornGore`)
 * from `data` or the default W07 compiled tables.
 */
export function resolveWeaponRow(
  weaponId: string | undefined,
  data?: CompiledDataLike,
): CompiledRow | undefined {
  if (!weaponId) return undefined;
  const canonicalId = WEAPON_ID_ALIASES[weaponId] ?? weaponId;
  const weaponsTbl = data?.tables?.weapons as Readonly<Record<string, CompiledRow | undefined>> | undefined;
  const fromData = weaponsTbl?.[weaponId] ?? weaponsTbl?.[canonicalId];
  if (fromData) return fromData;

  const fallbackTbl = defaultW07Data().tables.weapons as Readonly<Record<string, CompiledRow | undefined>> | undefined;
  return fallbackTbl?.[weaponId] ?? fallbackTbl?.[canonicalId];
}

/**
 * Returns `true` when `weaponRow` represents an instant-hit laser or range-1 melee bite
 * (`kind === 'laser'`, `weaponType === 'laser'`, or `delivery === 'instant'`).
 */
export function isLaserWeapon(weaponRow: Record<string, unknown> | undefined): boolean {
  if (!weaponRow) return false;
  return (
    weaponRow.kind === 'laser' ||
    weaponRow.weaponType === 'laser' ||
    weaponRow.delivery === 'instant'
  );
}

function attachNonEnumerableAliases(target: Record<string, unknown>, aliases: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(aliases)) {
    Object.defineProperty(target, k, {
      value: v,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
}

function emitLaserCombatEvent(
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
  attachNonEnumerableAliases(data, aliases);

  const emitFn = ctx.emit as unknown as (...args: unknown[]) => void;
  if (emitFn.length >= 2) {
    emitFn(kind, data);
  } else {
    ctx.emit({
      kind,
      severity: 'info',
      colonyIds,
      data,
    });
  }
}

function emitLaserShotEvents(
  state: PlanetState,
  ctx: StepContext | undefined,
  params: {
    attackerId: number;
    attackerOwner: number;
    targetId: number;
    weaponId: string;
    damage: number;
    tick: number;
    from: LaserPoint;
    to: LaserPoint;
  },
): void {
  const { attackerId, attackerOwner, targetId, weaponId, damage, tick, from, to } = params;
  emitLaserCombatEvent(
    state,
    ctx,
    'projectileFired',
    attackerOwner,
    {
      attackerId,
      targetId,
      weaponId,
      weaponType: 'laser',
      arc: 'direct',
      fromX: from.x,
      fromY: from.y,
      aimX: to.x,
      aimY: to.y,
      q: Math.round(from.q),
      r: Math.round(from.r),
      aimQ: Math.round(to.q),
      aimR: Math.round(to.r),
      speed: 0,
      flightTicks: 0,
      impactTick: tick,
      aoe: 0,
      damage,
    },
    {
      tick,
      weaponKind: 'laser',
      from: { ...from },
      to: { ...to },
    },
  );

  emitLaserCombatEvent(
    state,
    ctx,
    'projectileImpact',
    attackerOwner,
    {
      attackerId,
      targetId,
      weaponId,
      weaponType: 'laser',
      aimX: to.x,
      aimY: to.y,
      q: Math.round(to.q),
      r: Math.round(to.r),
      hit: true,
      aoe: 0,
      damage,
      hitEntityIds: [targetId],
    },
    {
      tick,
      weaponKind: 'laser',
      at: { ...to },
      to: { ...to },
      hitIds: [targetId],
    },
  );
}

function defaultApplyLaserDamage(
  state: PlanetState,
  targetId: number,
  amount: number,
  tick: number,
): void {
  if (amount <= 0) return;
  const row = rowOf(state.entities, targetId);
  if (row < 0) return;
  const cols = state.entities.cols;
  const owner = cols.owner[row]!;
  if (owner >= 0 && (state.colonies[owner] as { godMode?: boolean } | undefined)?.godMode === true) {
    return;
  }
  const prevHp = cols.hp[row]!;
  if (prevHp <= 0) return;

  if (cols.kind[row] === ENTITY_KIND.hq) {
    const nextHp = Math.fround(Math.max(1, prevHp - amount));
    setField(state.entities, row, 'hp', nextHp, tick);
    return;
  }

  const nextHp = Math.fround(Math.max(0, prevHp - amount));
  if (nextHp > 0) {
    setField(state.entities, row, 'hp', nextHp, tick);
  } else {
    removeRow(state.entities, targetId, tick);
  }
}

/**
 * Fires an instant-hit laser or range-1 melee bite (`UO-C-02`, `W07-05`):
 * - Checks attacker & target alive, in `[minRange, maxRange]` on the fire tick (ignoring `projSpeed`),
 *   and compatible with target layer (`canWeaponHitTarget`).
 * - Applies damage immediately on the fire tick (0-tick travel time).
 * - Emits `projectileFired` and `projectileImpact` with `weaponKind: 'laser'` for client beam/flash rendering.
 */
export function fireLaserOrMelee(
  state: PlanetState,
  opts: FireLaserOptions,
  ctx?: StepContext,
): LaserFireResult {
  const cols = state.entities.cols;
  const aRow = rowOf(state.entities, opts.attackerId);
  const tRow = rowOf(state.entities, opts.targetId);
  if (aRow < 0 || tRow < 0 || cols.hp[aRow]! <= 0 || cols.hp[tRow]! <= 0) {
    return { hit: false, damageDealt: 0 };
  }

  const inferredWeaponId =
    opts.weaponId ??
    (typeof opts.weaponRow?.id === 'string' ? opts.weaponRow.id : undefined) ??
    KIND_TO_DEFAULT_LASER_WEAPON_ID[cols.kind[aRow]!];
  const resolvedRow = opts.weaponRow ?? resolveWeaponRow(inferredWeaponId, ctx?.data);
  const effectiveWeaponRow = resolvedRow ?? DEFAULT_LASER_WEAPON_ROW;

  const maxRange =
    opts.range !== undefined
      ? opts.range
      : typeof effectiveWeaponRow.range === 'number'
        ? effectiveWeaponRow.range
        : 6;
  const minRange =
    opts.minRange !== undefined
      ? opts.minRange
      : typeof effectiveWeaponRow.minRange === 'number'
        ? effectiveWeaponRow.minRange
        : 0;
  const damage = Math.max(
    0,
    opts.damage !== undefined
      ? opts.damage
      : typeof effectiveWeaponRow.damage === 'number'
        ? effectiveWeaponRow.damage
        : 0,
  );

  const dist = hexDistance(cols.x[aRow]!, cols.y[aRow]!, cols.x[tRow]!, cols.y[tRow]!);
  if (dist > maxRange + 1e-4 || dist < minRange - 1e-4) {
    return { hit: false, damageDealt: 0 };
  }

  if (!canWeaponHitTarget(state, effectiveWeaponRow, tRow, ctx?.data)) {
    return { hit: false, damageDealt: 0 };
  }

  const tick = opts.tick ?? ctx?.tick ?? state.meta.tick;
  const attackerOwner = cols.owner[aRow]!;
  const weaponId = inferredWeaponId ?? 'laser';
  const from: LaserPoint = {
    x: cols.x[aRow]!,
    y: cols.y[aRow]!,
    q: cols.q[aRow]!,
    r: cols.r[aRow]!,
  };
  const to: LaserPoint = {
    x: cols.x[tRow]!,
    y: cols.y[tRow]!,
    q: cols.q[tRow]!,
    r: cols.r[tRow]!,
  };

  if (opts.applyDmg) {
    recordEntityDamaged(state, opts.targetId, tick, attackerOwner, opts.attackerId);
    opts.applyDmg(state, opts.targetId, damage, opts.attackerId, attackerOwner, ctx);
  } else {
    recordEntityDamaged(state, opts.targetId, tick, attackerOwner, opts.attackerId);
    defaultApplyLaserDamage(state, opts.targetId, damage, tick);
  }

  emitLaserShotEvents(state, ctx, {
    attackerId: opts.attackerId,
    attackerOwner,
    targetId: opts.targetId,
    weaponId,
    damage,
    tick,
    from,
    to,
  });

  return {
    hit: true,
    damageDealt: damage,
    targetId: opts.targetId,
    tick,
  };
}

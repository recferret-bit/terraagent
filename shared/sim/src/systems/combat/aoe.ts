import { ENTITY_KIND } from '../../ecs/columns';
import { hexDistance } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { applyDamage } from './damage';

export const SPLASH_DAMAGE_RATIO = 0.5;

const KIND_TO_ROW_ID: Readonly<Record<number, string>> = {
  [ENTITY_KIND.hq]: 'hq',
  [ENTITY_KIND.commandHub]: 'commandHub',
  [ENTITY_KIND.worker]: 'worker',
  [ENTITY_KIND.roboticsFactory]: 'roboticsFactory',
  [ENTITY_KIND.droneControlArray]: 'droneControlArray',
  [ENTITY_KIND.autocannon]: 'autocannon',
  [ENTITY_KIND.laserTower]: 'laserTower',
  [ENTITY_KIND.recon]: 'recon',
  [ENTITY_KIND.blackAnt]: 'blackAnt',
  [ENTITY_KIND.blueBeetle]: 'blueBeetle',
  [ENTITY_KIND.greenSpitter]: 'greenSpitter',
  [ENTITY_KIND.hiveBlackAnt]: 'hiveBlackAnt',
  [ENTITY_KIND.hiveBlueBeetle]: 'hiveBlueBeetle',
  [ENTITY_KIND.hiveGreenSpitter]: 'hiveGreenSpitter',
};

const DEFAULT_HIT_RADIUS_BY_KIND: Readonly<Record<number, number>> = {
  [ENTITY_KIND.blackAnt]: 0.3,
  [ENTITY_KIND.greenSpitter]: 0.4,
  [ENTITY_KIND.recon]: 0.5,
  [ENTITY_KIND.hq]: 0.5,
  [ENTITY_KIND.worker]: 0.5,
  [ENTITY_KIND.blueBeetle]: 0.8,
  [ENTITY_KIND.autocannon]: 0.65,
  [ENTITY_KIND.laserTower]: 0.65,
  [ENTITY_KIND.droneControlArray]: 0.65,
  [ENTITY_KIND.solar]: 0.65,
  [ENTITY_KIND.pylon]: 0.65,
  [ENTITY_KIND.devProbe]: 0.65,
  [ENTITY_KIND.roboticsFactory]: 1.5,
  [ENTITY_KIND.commandHub]: 1.5,
  [ENTITY_KIND.pod]: 1.5,
  [ENTITY_KIND.tradeHub]: 1.5,
  [ENTITY_KIND.hiveBlackAnt]: 1.5,
  [ENTITY_KIND.hiveBlueBeetle]: 1.5,
  [ENTITY_KIND.hiveGreenSpitter]: 1.5,
};

/**
 * Resolves the hit radius (in tiles) for an entity row (`UO-C-00`, `UO-C-03`).
 */
export function getEntityHitRadius(
  state: PlanetState,
  row: number,
  data?: CompiledDataLike,
): number {
  if (row < 0 || row >= state.entities.count) return 0.5;
  const cols = state.entities.cols;
  const kind = cols.kind[row]!;
  const rowId = KIND_TO_ROW_ID[kind];

  if (rowId && data?.tables) {
    const combatUnitsTbl = data.tables.combatUnits as Record<string, Record<string, unknown> | undefined> | undefined;
    const faunaTbl = data.tables.fauna as Record<string, Record<string, unknown> | undefined> | undefined;
    const tableRow = combatUnitsTbl?.[rowId] ?? faunaTbl?.[rowId];
    if (typeof tableRow?.radius === 'number' && tableRow.radius > 0) {
      return tableRow.radius;
    }
  }

  const byKind = DEFAULT_HIT_RADIUS_BY_KIND[kind];
  if (byKind !== undefined) return byKind;
  if (cols.footprintW[row]! >= 3 || cols.footprintD[row]! >= 3) return 1.5;
  return 0.65;
}

/**
 * Collects all alive hostile entity IDs within `aoeRadius` of `aim` (`UO-C-03`, `W07-04`).
 * Friendly units (`cols.owner[row] === attackerOwner`) never take splash damage.
 */
export function collectAoeSplashTargets(
  state: PlanetState,
  aim: { x: number; y: number },
  aoeRadius: number,
  attackerOwner: number,
  excludeEntityId?: number,
  data?: CompiledDataLike,
): number[] {
  if (aoeRadius <= 0) return [];
  const cols = state.entities.cols;
  const splashTargetIds: number[] = [];
  for (let row = 0; row < state.entities.count; row++) {
    const entityId = cols.id[row]!;
    if (excludeEntityId !== undefined && entityId === excludeEntityId) continue;
    if (cols.hp[row]! <= 0) continue;
    if (cols.owner[row]! === attackerOwner) continue;
    const d = hexDistance(cols.x[row]!, cols.y[row]!, aim.x, aim.y);
    const r = getEntityHitRadius(state, row, data);
    if (d <= aoeRadius + r + 1e-5) {
      splashTargetIds.push(entityId);
    }
  }
  return splashTargetIds;
}

export interface ApplyAoeSplashOptions {
  attackerId?: number;
  attackerOwner?: number;
  excludeEntityId?: number;
  tick?: number;
  ctx?: StepContext;
  data?: CompiledDataLike;
  ratio?: number;
  customApplyDamage?: (
    state: PlanetState,
    targetId: number,
    amount: number,
    attackerId?: number,
    attackerOwner?: number,
    ctx?: StepContext,
  ) => void;
}

/**
 * Applies 50% splash damage to hostile entities within `aoeRadius` of `aim` (`W07-04`).
 */
export function applyAoeSplashDamage(
  state: PlanetState,
  aim: { x: number; y: number },
  aoeRadius: number,
  baseDamage: number,
  attackerOwnerOrOpts?: number | ApplyAoeSplashOptions,
  maybeOpts?: ApplyAoeSplashOptions,
): number[] {
  const opts: ApplyAoeSplashOptions =
    typeof attackerOwnerOrOpts === 'object' && attackerOwnerOrOpts !== null
      ? attackerOwnerOrOpts
      : (maybeOpts ?? {});
  const attackerOwner =
    typeof attackerOwnerOrOpts === 'number'
      ? attackerOwnerOrOpts
      : (opts.attackerOwner ?? -1);

  if (aoeRadius <= 0 || baseDamage <= 0) return [];

  const targets = collectAoeSplashTargets(
    state,
    aim,
    aoeRadius,
    attackerOwner,
    opts.excludeEntityId,
    opts.data ?? opts.ctx?.data,
  );

  const ratio = opts.ratio ?? SPLASH_DAMAGE_RATIO;
  const splashDamage = baseDamage * ratio;
  const tick = opts.tick ?? opts.ctx?.tick ?? state.meta.tick;
  const data = opts.data ?? opts.ctx?.data;

  for (const targetId of targets) {
    if (opts.customApplyDamage) {
      opts.customApplyDamage(state, targetId, splashDamage, opts.attackerId, attackerOwner, opts.ctx);
    } else {
      applyDamage(state, targetId, splashDamage, {
        attackerId: opts.attackerId,
        attackerOwner,
        tick,
        ctx: opts.ctx,
        data,
      });
    }
  }

  return targets;
}

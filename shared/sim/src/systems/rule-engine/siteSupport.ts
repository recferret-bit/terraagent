import { ENTITY_KIND } from '../../ecs/columns';
import type { DepositRule } from '../../grid/geo';
import { hexIndex } from '../../grid/hex';
import { DEPOSIT } from '../../grid/layers';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { resolvePlacementRule } from '../construction/placement';

export interface SiteBuildingSpec {
  canonicalBuilding: string;
  hasNativeRule: boolean;
  isHub: boolean;
  isBeacon: boolean;
  isPylon: boolean;
  footprint: number;
  depositRule: DepositRule;
  requiresDeposit?: number;
}

const EXTRACTOR_DEPOSIT_MAP: Readonly<Record<string, number>> = {
  metalsExtractor: DEPOSIT.metals,
  extractor: DEPOSIT.metals,
  mineralsExtractor: DEPOSIT.minerals,
  mineralsQuarry: DEPOSIT.minerals,
  quarry: DEPOSIT.minerals,
  petroleumWell: DEPOSIT.oil,
  biomassExtractor: DEPOSIT.oil,
  oilExtractor: DEPOSIT.oil,
};

const FOOTPRINT_ONE_BUILDINGS: ReadonlySet<string> = new Set([
  'pylon',
  'turret',
  'autocannon',
  'pulseTurret',
  'laserTower',
  'outpostBeacon',
  'claimBeacon',
  'beacon',
  'droneControlArray',
  'dca',
  'radar',
  'wall',
  'road',
]);

const FOOTPRINT_THREE_BUILDINGS: ReadonlySet<string> = new Set([
  'commandHub',
  'hub',
  'roboticsFactory',
  'robotics_factory',
  'factory',
]);

export function resolveSiteBuildingSpec(buildingKind: string, data?: CompiledDataLike): SiteBuildingSpec {
  const nativeRule = resolvePlacementRule(buildingKind, data);
  const reqDeposit = nativeRule?.requiresDeposit ?? EXTRACTOR_DEPOSIT_MAP[buildingKind];
  const isBeacon = buildingKind === 'outpostBeacon' || buildingKind === 'claimBeacon' || buildingKind === 'beacon';
  const isPylon = buildingKind === 'pylon';
  if (nativeRule) {
    return {
      canonicalBuilding: buildingKind,
      hasNativeRule: true,
      isHub: nativeRule.isHub,
      isBeacon,
      isPylon,
      footprint: nativeRule.footprint,
      depositRule: nativeRule.deposit,
      requiresDeposit: reqDeposit,
    };
  }
  const footprint = FOOTPRINT_THREE_BUILDINGS.has(buildingKind)
    ? 3
    : FOOTPRINT_ONE_BUILDINGS.has(buildingKind)
      ? 1
      : 2;
  return {
    canonicalBuilding: buildingKind,
    hasNativeRule: false,
    isHub: buildingKind === 'commandHub' || buildingKind === 'hub',
    isBeacon,
    isPylon,
    footprint,
    depositRule: reqDeposit !== undefined ? 'any' : 'forbid',
    ...(reqDeposit !== undefined ? { requiresDeposit: reqDeposit } : {}),
  };
}

export function findColonySupportNodes(
  state: PlanetState,
  colonyIndex: number,
): {
  hubAnchor: { q: number; r: number };
  supportNodes: Array<{ q: number; r: number }>;
  powerSources: Array<{ q: number; r: number }>;
} {
  const cols = state.entities.cols;
  let hubAnchor: { q: number; r: number } | null = null;
  let hqAnchor: { q: number; r: number } | null = null;
  let podAnchor: { q: number; r: number } | null = null;
  const supportNodes: Array<{ q: number; r: number }> = [];
  const powerSources: Array<{ q: number; r: number }> = [];

  for (let row = 0; row < state.entities.count; row++) {
    if (cols.owner[row] !== colonyIndex) continue;
    if (cols.hpMax[row] > 0 && cols.hp[row] <= 0) continue;
    const pos = { q: cols.q[row]!, r: cols.r[row]! };
    const kind = cols.kind[row];
    if (kind === ENTITY_KIND.commandHub) {
      if (!hubAnchor) hubAnchor = pos;
      supportNodes.push(pos);
      powerSources.push(pos);
    } else if (kind === ENTITY_KIND.pylon) {
      supportNodes.push(pos);
      powerSources.push(pos);
    } else if (kind === ENTITY_KIND.hq) {
      if (!hqAnchor) hqAnchor = pos;
    } else if (kind === ENTITY_KIND.pod) {
      if (!podAnchor) podAnchor = pos;
    } else if (kind !== ENTITY_KIND.worker && kind !== ENTITY_KIND.devProbe) {
      supportNodes.push(pos);
    }
  }

  const queueEntries = (
    state.blobs.queue?.value as
      | { entries?: ReadonlyArray<{ colonyIndex?: number; state?: string; task?: { kind?: string; building?: string; q?: number; r?: number } }> }
      | undefined
  )?.entries;
  if (Array.isArray(queueEntries)) {
    for (const e of queueEntries) {
      if (
        e.colonyIndex === colonyIndex &&
        e.state !== 'done' &&
        e.state !== 'cancelled' &&
        e.task?.kind === 'build' &&
        e.task.building === 'pylon' &&
        typeof e.task.q === 'number' &&
        typeof e.task.r === 'number'
      ) {
        powerSources.push({ q: e.task.q, r: e.task.r });
      }
    }
  }

  let fallbackAnchor = hubAnchor ?? hqAnchor ?? podAnchor;
  if (!fallbackAnchor) {
    const ownerLayer = state.grid.layers.owner as Int16Array;
    const hx = hexIndex(state.grid.radius);
    for (let i = 0; i < state.grid.count; i++) {
      if (ownerLayer[i] === colonyIndex) {
        fallbackAnchor = { q: hx.q[i]!, r: hx.r[i]! };
        break;
      }
    }
  }
  const resolvedHub = fallbackAnchor ?? { q: 0, r: 0 };
  if (supportNodes.length === 0) supportNodes.push(resolvedHub);
  if (powerSources.length === 0) powerSources.push(resolvedHub);
  return { hubAnchor: resolvedHub, supportNodes, powerSources };
}

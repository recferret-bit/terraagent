import { getColonyStock, restore, ENTITY_KIND, type PlanetState } from '@terra/sim';
import type { DigestBaseline } from './types';

const ROBOT_KINDS = new Set<number>([
  ENTITY_KIND.worker,
  ENTITY_KIND.recon,
  ENTITY_KIND.demoTank,
  ENTITY_KIND.demoArtillery,
]);

export function stateOf(raw: Uint8Array): PlanetState | null {
  try {
    return restore(raw);
  } catch {
    return null;
  }
}

/** Stock, net grid power, live robots and owned tiles. Null when the colony is not on the planet. */
export function baselineFromState(state: PlanetState, colonyId: string): DigestBaseline | null {
  const index = state.colonies.findIndex((c) => c.id === colonyId);
  if (index < 0) return null;
  return {
    resources: getColonyStock(state, index),
    energy: energyOf(state.colonies[index]),
    robots: robotCount(state, index),
    territory: territoryOf(state, index),
  };
}

function energyOf(colony: PlanetState['colonies'][number] | undefined): number {
  const net = (colony?.power as { net?: unknown } | undefined)?.net;
  return typeof net === 'number' && Number.isFinite(net) ? net : 0;
}

function robotCount(state: PlanetState, index: number): number {
  const { cols, count } = state.entities;
  let robots = 0;
  for (let i = 0; i < count; i++) {
    if (cols.owner[i] !== index || (cols.hp[i] ?? 0) <= 0) continue;
    if (ROBOT_KINDS.has(cols.kind[i] ?? -1)) robots++;
  }
  return robots;
}

function territoryOf(state: PlanetState, index: number): number {
  const owners = state.grid.layers.owner;
  let tiles = 0;
  for (let i = 0; i < owners.length; i++) if (owners[i] === index) tiles++;
  return tiles;
}

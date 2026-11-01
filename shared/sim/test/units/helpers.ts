import { parseWaves } from '@terra/contracts';
import {
  createPlanet,
  ENTITY_KIND,
  getHubFootprintTiles,
  hexDistance,
  hexIndex,
  PREP,
  setTilePrep,
  SimHost,
  type PlanetState,
  type SimCommand,
} from '../../src';

let seq = 0;
export function cmd(kind: string, args: unknown, colonyIndex: number | null = 0): SimCommand {
  return { colonyIndex, source: 'player', commandId: `units_${++seq}`, kind, args };
}

export function w01Host(radius = 20, seed = 'units-test'): SimHost {
  const host = new SimHost({ flags: parseWaves('..01') });
  host.load(createPlanet({ type: 'flat', seed, radius }));
  return host;
}

/** HQ T1 speed in tiles per tick (1.6 t/s × 0.2 s). */
export const HQ_SPEED_PER_TICK = 0.32;

export function prepareFootprint(state: PlanetState, q: number, r: number): void {
  const idx = hexIndex(state.grid.radius);
  for (const t of getHubFootprintTiles(q, r)) setTilePrep(state.grid, idx.indexOf(t.q, t.r), PREP.prepared);
}

/**
 * Watches every unit across steps and records the largest per-step displacement (hex distance between continuous
 * positions). A teleport anywhere shows up as a step far above the unit speed.
 */
export class MotionWatch {
  private last = new Map<number, [number, number]>();
  maxStep = 0;
  steps = 0;

  constructor(private readonly state: () => PlanetState) {
    this.sample();
  }

  sample(): void {
    const e = this.state().entities;
    for (let row = 0; row < e.count; row++) {
      if (e.cols.kind[row] !== ENTITY_KIND.hq) continue;
      const id = e.cols.id[row];
      const now: [number, number] = [e.cols.x[row], e.cols.y[row]];
      const prev = this.last.get(id);
      if (prev) this.maxStep = Math.max(this.maxStep, hexDistance(prev[0], prev[1], now[0], now[1]));
      this.last.set(id, now);
    }
    this.steps++;
  }
}

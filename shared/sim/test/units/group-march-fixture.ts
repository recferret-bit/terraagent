import {
  ENTITY_STATE,
  insertRow,
  mobileStats,
  placeSpawnedEntity,
  rowOf,
  type PlanetState,
  type SimHost,
  type StepContext,
} from '../../src';
import { MarchOracle } from './group-march-oracle';

export function speed(host: SimHost, id: number): number {
  const row = rowOf(host.state.entities, id);
  return mobileStats(host.state.entities.cols.kind[row], host.pipeline.config.data)!.speedPerTick;
}

export function spawnKind(state: PlanetState, kind: number, q: number, r: number, hp: number): number {
  const tick = state.meta.tick;
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, tick);
  const cols = state.entities.cols;
  cols.kind[row] = kind;
  cols.owner[row] = 0;
  cols.hp[row] = hp;
  cols.hpMax[row] = hp;
  cols.state[row] = ENTITY_STATE.idle;
  placeSpawnedEntity(state.entities, row, q, r, tick);
  return id;
}

export function ctxOf(host: SimHost): StepContext {
  return {
    dt: 1,
    tick: host.tick,
    flags: new Set(['W00', 'W01']),
    data: host.pipeline.config.data,
    events: [],
    rng: () => new Uint32Array(4),
    newEntityId: () => 0,
    emit: () => undefined,
    record: () => undefined,
    postings: [],
  } as unknown as StepContext;
}

export function runUntil(oracle: MarchOracle, done: () => boolean, max: number): void {
  oracle.step();
  for (let i = 1; i < max && !done(); i++) oracle.step();
  if (!done()) throw new Error(`march did not finish in ${max} ticks`);
}

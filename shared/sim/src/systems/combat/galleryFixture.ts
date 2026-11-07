import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { faceTowards } from '../../units/movement/locomotion';
import { insertRow, rowOf } from '../../ecs/store';
import type { CompiledDataLike } from '../../kernel/config';
import { setBlob, type PlanetState } from '../../kernel/state';
import { spawnFaunaBug, spawnHiveSite } from '../fauna/spawn';
import type { FaunaSpeciesId } from '../fauna/types';
import { COMBAT_DRY_FIRE_BLOB, FIRING_RANGE_BLOB } from './firingRange';

export interface GalleryLane { shooterId: number; targetId: number; kind: number }
const SHOOTERS = [ENTITY_KIND.autocannon, ENTITY_KIND.laserTower, ENTITY_KIND.recon, ENTITY_KIND.demoTank, ENTITY_KIND.demoArtillery];
const SPECIES: FaunaSpeciesId[] = ['blackAnt', 'blueBeetle', 'greenSpitter'];

/** Two parallel, evenly spaced lines. No preview-side position writes or movement overrides. */
export function populateShootingGallery(state: PlanetState, scene: FaunaSpeciesId | 'mixed', data: CompiledDataLike): GalleryLane[] {
  const species = scene === 'mixed' ? SPECIES : [scene];
  const hives = new Map<FaunaSpeciesId, number>();
  for (const [i, kind] of species.entries()) {
    const r = (i - (species.length - 1) / 2) * 4;
    const id = spawnHiveSite(state, {
      species: kind, q: 6 - r / 2, r, initialResidents: 0, popCap: 0,
    }, state.meta.tick, data);
    hives.set(kind, id);
  }
  const lanes = SHOOTERS.map((kind, i): GalleryLane => {
    // Even axial rows keep integer tile coordinates and straight world-space columns.
    const laneR = (i - 2) * 2;
    const shooterId = state.meta.nextEntityId++;
    const row = insertRow(state.entities, shooterId, state.meta.tick);
    const cols = state.entities.cols;
    cols.kind[row] = kind;
    cols.owner[row] = 0;
    cols.hp[row] = cols.hpMax[row] = 500;
    cols.state[row] = ENTITY_STATE.active;
    cols.footprintW[row] = cols.footprintD[row] = 1;
    placeSpawnedEntity(state.entities, row, -2 - laneR / 2, laneR, state.meta.tick);
    const bugSpecies = species[i % species.length]!;
    const targetId = spawnFaunaBug(state, {
      species: bugSpecies, q: 2 - laneR / 2, r: laneR, homeHiveId: hives.get(bugSpecies),
    }, state.meta.tick, data);
    faceTowards(state, rowOf(state.entities, targetId), -2 - laneR / 2, laneR, state.meta.tick);
    faceTowards(state, row, 2 - laneR / 2, laneR, state.meta.tick);
    return { shooterId, targetId, kind };
  });
  const pairs = Object.fromEntries(lanes.map(lane => [lane.shooterId, lane.targetId]));
  setBlob(state, FIRING_RANGE_BLOB, { mode: 'gallery', pairs }, state.meta.tick);
  setBlob(state, COMBAT_DRY_FIRE_BLOB, true, state.meta.tick);
  return lanes;
}

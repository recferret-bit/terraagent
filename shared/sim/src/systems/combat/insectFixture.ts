import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow, rowOf } from '../../ecs/store';
import type { CompiledDataLike } from '../../kernel/config';
import { setBlob, type PlanetState } from '../../kernel/state';
import { faceTowards } from '../../units/movement/locomotion';
import { spawnFaunaBug, spawnHiveSite } from '../fauna/spawn';
import { SPECIES_ORDER, type FaunaSpeciesId } from '../fauna/types';
import { COMBAT_DRY_FIRE_BLOB, FIRING_RANGE_BLOB } from './firingRange';

export interface InsectScenePair { bugId: number; robotId: number; species: FaunaSpeciesId }

function spawnRobot(state: PlanetState, q: number, r: number): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  const cols = state.entities.cols;
  cols.kind[row] = ENTITY_KIND.recon;
  cols.owner[row] = 0;
  cols.hp[row] = cols.hpMax[row] = 2000;
  cols.state[row] = ENTITY_STATE.active;
  cols.footprintW[row] = cols.footprintD[row] = 1;
  placeSpawnedEntity(state.entities, row, q, r, state.meta.tick);
  return id;
}

/** Finite, live combat specimens: each insect has its own stationary robot and its species hive. */
export function populateInsectAttackScene(state: PlanetState, scene: FaunaSpeciesId | 'mixed',
  direction: 'bugs' | 'robots', data: CompiledDataLike): InsectScenePair[] {
  const species = scene === 'mixed' ? SPECIES_ORDER : [scene];
  const pairs = species.map((kind, i): InsectScenePair => {
    const r = (i - (species.length - 1) / 2) * 4;
    const hiveId = spawnHiveSite(state, { species: kind, q: -5 - r / 2, r,
      entranceQ: -3 - r / 2, entranceR: r, initialResidents: 0, popCap: 0,
    }, state.meta.tick, data);
    const bugId = spawnFaunaBug(state, { species: kind, q: -2 - r / 2, r, homeHiveId: hiveId }, state.meta.tick, data);
    if (direction === 'robots') {
      // A short live-health specimen makes the full hit/death sequence reviewable after a reset.
      const row = rowOf(state.entities, bugId);
      state.entities.cols.hp[row] = state.entities.cols.hpMax[row] = Math.min(84, state.entities.cols.hp[row]!);
    }
    const robotId = spawnRobot(state, 2 - r / 2, r);
    faceTowards(state, rowOf(state.entities, bugId), 2 - r / 2, r, state.meta.tick);
    // Bug attacks use a side-on armor specimen: the wider nose would touch the horn before release.
    // The robot-attack direction still faces the opponent; its turret aims independently.
    if (direction === 'bugs') faceTowards(state, rowOf(state.entities, robotId), 3 - r / 2, r - 2, state.meta.tick);
    else faceTowards(state, rowOf(state.entities, robotId), -2 - r / 2, r, state.meta.tick);
    return { bugId, robotId, species: kind };
  });
  const targets = Object.fromEntries(pairs.flatMap(pair => [[pair.bugId, pair.robotId], [pair.robotId, pair.bugId]]));
  setBlob(state, FIRING_RANGE_BLOB, { mode: direction, pairs: targets }, state.meta.tick);
  setBlob(state, COMBAT_DRY_FIRE_BLOB, false, state.meta.tick);
  return pairs;
}

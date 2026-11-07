import { expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  clone, compileData, createState, decodeDiff, diffSince, encodeValue, FaunaMotionReplica,
  getUnitCommand, insertRow, ENTITY_KIND, setBlob, spawnFaunaBug, TERRAIN, applyDiff,
} from '../../src';
import { installFaunaMotionSeed } from '../../src/codec/faunaMotionSeed';
import { getFaunaDirectivesState } from '../../src/systems/fauna/directives';

it('installing fauna routes preserves colony-unit and entity-less shared group path requests', () => {
  const state = createState({ planetId: 'motion-seed', planetType: 'temperate', seed: 'motion-seed', radius: 8 });
  const row = insertRow(state.entities, 1, 0);
  state.entities.cols.kind[row] = ENTITY_KIND.hq;
  const group = { id: 'gf1', from: { q: 0, r: 0 }, to: { q: 2, r: 0 }, enqueuedAtTick: 0, expansionsUsed: 1 };
  const colony = { ...group, id: 'mv1', entityId: 1 };
  setBlob(state, 'pathQueue', [group, colony], 0);
  installFaunaMotionSeed(state, { pathQueue: { changedAt: 1, value: [] } });
  expect(state.blobs.pathQueue.value).toEqual([group, colony]);
});

it('retains a future-effective directive after its announcement frame advances the server sequence', () => {
  const data = compileData(parseWaves('..07'));
  const server = createState({ planetId: 'future-motion', planetType: 'temperate', seed: 'future-motion', radius: 8 });
  server.grid.layers.terrain.fill(TERRAIN.flat);
  const id = spawnFaunaBug(server, { species: 'blackAnt', q: 0, r: 0 }, 0, data);
  const client = clone(server);
  const motion = new FaunaMotionReplica();
  motion.welcome(client, data);
  const directive = { version: 1, seq: 1, effectiveTick: 3, hiveId: 0, decisionIndex: 1,
    kind: 'targetChange' as const, payload: { species: 'blackAnt' as const, bugId: id, memberIds: [id], objectiveQ: 4, objectiveR: 0 } };
  const directives = getFaunaDirectivesState(server);
  directives.lastSeq = 1; directives.log = [directive]; directives.appliedSeqs = [1];
  setBlob(server, 'faunaDirectives', directives, 1);
  for (let tick = 1; tick <= 3; tick++) {
    server.meta.tick = tick;
    const diff = decodeDiff(diffSince(server, tick - 1, { forClient: true }));
    const bytes = encodeValue(diff);
    applyDiff(client, bytes);
    motion.apply(bytes, client, data);
    if (tick < 3) expect(getUnitCommand(client, id)).toBeNull();
  }
  expect(getUnitCommand(client, id)).toMatchObject({ kind: 'move', q: 4, r: 0 });
});

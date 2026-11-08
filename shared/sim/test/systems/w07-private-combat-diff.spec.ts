import { expect, it } from 'vitest';
import { applyDiff, clone, createState, decodeDiff, diffSince, setBlob } from '../../src';
import { clearEvasiveState } from '../../src/systems/combat/evasive';
import { recordEntityDamaged } from '../../src/systems/combat/hqSurvival';
import { updateColonyVisionCache } from '../../src/systems/combat/vision';

it('full host deltas retain private combat mutations while public deltas omit them', () => {
  const state = createState({ planetId: 'private-combat-diff', planetType: 'temperate', seed: 'private-combat-diff', radius: 4 });
  recordEntityDamaged(state, 100, 0);
  updateColonyVisionCache(state, 0, undefined, true);
  setBlob(state, 'combatEvasive', { byEntityId: { 100: {} }, lastHeadingTickByEntity: { 100: 0 }, headingQ: {}, headingR: {} }, 0);
  const replica = clone(state);
  state.meta.tick = 1;
  recordEntityDamaged(state, 100, 1);
  updateColonyVisionCache(state, 1, undefined, true);
  clearEvasiveState(state, 100, 1);
  applyDiff(replica, diffSince(state, 0));
  const publicDiff = decodeDiff(diffSince(state, 0, { forClient: true }));
  for (const name of ['combatDamage', 'combatEvasive', 'combatVision']) {
    expect(replica.blobs[name]).toEqual(state.blobs[name]);
    expect(publicDiff.blobs[name]).toBeUndefined();
  }
});

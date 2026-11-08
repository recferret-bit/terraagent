import { expect, it } from 'vitest';
import { createState } from '@terra/sim';
import { FaunaClientSync } from '../FaunaClientSync';

it('drops prior planet checkpoints when the combat session resets', () => {
  const sync = new FaunaClientSync();
  const state = createState({ planetId: 'old-planet', planetType: 'temperate', seed: 'old', radius: 4 });
  sync.checkpoint(state);
  expect(sync.replica.checkpoints.getExact(0)).toBeDefined();
  sync.reset();
  expect(sync.replica.checkpoints.getExact(0)).toBeUndefined();
  expect(sync.replica.checkpoints.getAtOrBefore(100)).toBeUndefined();
});

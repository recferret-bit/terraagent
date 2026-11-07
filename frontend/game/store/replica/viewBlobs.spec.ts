import { expect, it } from 'vitest';
import { createState, view } from '@terra/sim';
import { packView, unpackView } from './viewCodec';

it('keeps reconstruction queues off the render thread while preserving live vision and public unit state', () => {
  const original = view(createState({ planetId: 'view-boundary', planetType: 'temperate', seed: 'view', radius: 2 }));
  const publicBlobs = { combatVision: { byColony: { 0: [1] } }, faunaHives: { initialized: true }, units: { byId: { 1: { hp: 100 } } } };
  original.blobs = { ...publicBlobs, unitMotion: { largeRoute: true }, pathQueue: ['private search'],
    groupMarch: {}, pathStats: {}, faunaMotionSeed: {}, combatStanceChanges: { fieldsById: { 1: { 128: 3 } } } };
  const { view: packed } = packView(original, false);
  expect(unpackView(packed).blobs).toEqual(publicBlobs);
  expect(original.blobs.pathQueue).toEqual(['private search']);
});

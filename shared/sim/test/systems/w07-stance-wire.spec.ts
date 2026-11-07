import { expect, it } from 'vitest';
import { applyDiff, createState, decodeDiff, diffSince, restore, setBlob, snapshot, type PlanetState } from '../../src';
import { writeStancesBlob } from '../../src/systems/combat/stanceHelpers';
import type { CombatStancesBlob, UnitStanceRecord } from '../../src/systems/combat/stances';

const records = (state: PlanetState) => (state.blobs.combatStances.value as CombatStancesBlob).byEntityId;
const stance = (id: number): UnitStanceRecord => ({ entityId: id, stance: 'hold', anchorQ: -3, anchorR: 2, targetId: null });
function update(state: PlanetState, tick: number, byId: Record<number, UnitStanceRecord>) {
  writeStancesBlob(state, byId, tick);
  state.meta.tick = tick;
}

it('sends only changed entity fields, retaining exact cadence through batched changes and mid-combat welcomes', () => {
  const server = createState({ planetId: 'stance-wire', planetType: 'temperate', seed: 'stance-wire', radius: 8 });
  update(server, 0, { 1: stance(1), 2: stance(2) });
  const batchClient = restore(snapshot(server, { forClient: true }));
  update(server, 1, { 1: { ...stance(1), targetId: 20, lastFiredTick: 1, nextShotTick: 3.5, shotIntervalTicks: 2.5 }, 2: stance(2) });
  const first = decodeDiff(diffSince(server, 0, { forClient: true }));
  expect(first.blobs.combatStances).toBeUndefined();
  expect(first.stancePatch?.[3].map(row => row[0])).toEqual([1]);
  const middleClient = restore(snapshot(server, { forClient: true }));
  update(server, 2, { 1: { ...stance(1), lastFiredTick: 1, explicitTargetId: null }, 2: stance(2) });
  applyDiff(batchClient, diffSince(server, 0, { forClient: true }));
  applyDiff(middleClient, diffSince(server, 1, { forClient: true }));
  expect(records(batchClient)).toEqual(records(server));
  expect(records(middleClient)).toEqual(records(server));
  expect(records(middleClient)[1].targetId).toBeNull();
  expect(records(middleClient)[1].nextShotTick).toBeUndefined();
  expect(records(middleClient)[1].explicitTargetId).toBeNull();
});

it('transmits deleted stance records and falls back to a full map for unjournaled legacy writes', () => {
  const server = createState({ planetId: 'stance-removal', planetType: 'temperate', seed: 'stance-removal', radius: 8 });
  update(server, 0, { 1: stance(1), 2: stance(2) });
  const client = restore(snapshot(server, { forClient: true }));
  update(server, 1, { 1: stance(1) });
  const removed = diffSince(server, 0, { forClient: true });
  expect(decodeDiff(removed).stancePatch?.[3]).toContainEqual([2, -1, 0]);
  applyDiff(client, removed);
  expect(records(client)).toEqual(records(server));
  setBlob(server, 'combatStances', { byEntityId: { 3: stance(3) } }, 2);
  server.meta.tick = 2;
  const legacy = diffSince(server, 1, { forClient: true });
  expect(decodeDiff(legacy).stancePatch?.[2]).toBe(true);
  applyDiff(client, legacy);
  expect(records(client)).toEqual({ 3: stance(3) });
});

it('sends a complete new record when stance creation and its first shot occur in the same tick', () => {
  const server = createState({ planetId: 'stance-first-tick', planetType: 'temperate', seed: 'stance-first-tick', radius: 8 });
  const client = restore(snapshot(server, { forClient: true }));
  update(server, 1, { 1: stance(1) });
  update(server, 1, { 1: { ...stance(1), targetId: 2, lastFiredTick: 1, nextShotTick: 3.5, shotIntervalTicks: 2.5 } });
  applyDiff(client, diffSince(server, 0, { forClient: true }));
  expect(records(client)).toEqual(records(server));
});

it('replaces a baseline when a raw legacy record is created and changed before a journal exists', () => {
  const server = createState({ planetId: 'stance-legacy-first-tick', planetType: 'temperate', seed: 'stance-legacy-first-tick', radius: 8 });
  server.meta.tick = 4;
  const client = restore(snapshot(server, { forClient: true }));
  setBlob(server, 'combatStances', { byEntityId: { 1: stance(1) } }, 5);
  update(server, 5, { 1: { ...stance(1), targetId: 2, lastFiredTick: 5, nextShotTick: 7.5, shotIntervalTicks: 2.5 } });
  const bytes = diffSince(server, 4, { forClient: true });
  expect(decodeDiff(bytes).stancePatch?.[2]).toBe(true);
  applyDiff(client, bytes);
  expect(records(client)).toEqual(records(server));
});

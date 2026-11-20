// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { StakingPrestigeResponse } from '@terra/contracts/staking/performance';
import { ENTITY_KIND } from '@terra/sim';
import { createArchetypeMesh, stripBuildingPlinth } from '@terra/render/kitbash';
import { hubPrestigeTier, hubUplinkBeam } from '@terra/render/prestige/hubPrestige';
import { HUB_BASE_ID, HUB_GOLD_ID, HUB_UPLINK_ID } from '@terra/render/prestige/tierVisuals';
import type { ClientView } from '../../store/replica/viewCodec';
import type { EntityMeshRecord } from '../online/EntityMeshRecord';
import { PrestigeDressing } from './PrestigeDressing';
import { PrestigeStore } from './PrestigeStore';

const PLANET = 'pl_dune';
const response = (colonies: StakingPrestigeResponse['colonies']): StakingPrestigeResponse => ({ planetId: PLANET, leadPatron: null, colonies });
const view = { planet: { id: PLANET }, colonies: [{ index: 0, id: 'col_a' }, { index: 1, id: 'col_b' }, { index: 2, id: 'col_c' }] } as unknown as ClientView;

function hubRecord(id: number, owner: number, strip = true): EntityMeshRecord {
  const mesh = createArchetypeMesh(HUB_BASE_ID);
  if (strip) stripBuildingPlinth(mesh);
  return { id, kind: ENTITY_KIND.commandHub, owner, mesh } as unknown as EntityMeshRecord;
}
const workerRecord = (id: number, owner: number) => ({ id, kind: ENTITY_KIND.worker, owner, mesh: new THREE.Group() }) as unknown as EntityMeshRecord;
const site = (workerId: number, targetKind = 'rock' as const) => ({
  workerId: String(workerId), targetKind, botOrigin: [0, 0, 0] as [number, number, number], toolOrigins: [] as [number, number, number][],
  targetPos: [0, 0, 0] as [number, number, number], groundY: 0,
});

async function loaded(colonies: StakingPrestigeResponse['colonies'] | null): Promise<PrestigeStore> {
  const store = new PrestigeStore(async () => (colonies ? response(colonies) : null));
  await store.ensureLoaded(PLANET);
  return store;
}

describe('W28-12 PrestigeDressing hubs (integration with real archetype meshes)', () => {
  it('dresses each colony hub for its own tier', async () => {
    const d = new PrestigeDressing(await loaded([{ colonyId: 'col_a', tier: 0 }, { colonyId: 'col_b', tier: 1 }, { colonyId: 'col_c', tier: 4 }]));
    d.isEnabled = () => true;
    const recs = [hubRecord(1, 0), hubRecord(2, 1), hubRecord(3, 2)];
    d.sync(view, recs);
    expect(recs.map((r) => r.mesh.userData.archetypeId)).toEqual([HUB_BASE_ID, HUB_UPLINK_ID, HUB_GOLD_ID]);
    expect(recs.map((r) => Boolean(hubUplinkBeam(r.mesh)))).toEqual([false, true, true]);
    expect(recs.map((r) => hubPrestigeTier(r.mesh))).toEqual([0, 1, 4]);
  });

  it('is off by default and when disabled (W28 off or ?host=local): nothing changes', async () => {
    const store = await loaded([{ colonyId: 'col_a', tier: 4 }]);
    const d = new PrestigeDressing(store);
    const rec = hubRecord(1, 0);
    d.sync(view, [rec]);
    expect(rec.mesh.userData.archetypeId).toBe(HUB_BASE_ID);
    d.isEnabled = () => false;
    d.sync(view, [rec]);
    expect(hubUplinkBeam(rec.mesh)).toBeNull();
  });

  it('404 / none answer and unknown colonies stay tier 0', async () => {
    const d = new PrestigeDressing(await loaded(null));
    d.isEnabled = () => true;
    const rec = hubRecord(1, 0);
    d.sync(view, [rec]);
    expect(rec.mesh.userData.archetypeId).toBe(HUB_BASE_ID);
    const d2 = new PrestigeDressing(await loaded([{ colonyId: 'someone_else', tier: 4 }]));
    d2.isEnabled = () => true;
    d2.sync(view, [rec]);
    expect(rec.mesh.userData.archetypeId).toBe(HUB_BASE_ID);
  });

  it('prestige arriving AFTER the meshes exist dresses them on the next sync (and keeps ground contact)', async () => {
    let resolve!: (v: StakingPrestigeResponse) => void;
    const store = new PrestigeStore(() => new Promise((r) => { resolve = r; }));
    const d = new PrestigeDressing(store);
    d.isEnabled = () => true;
    const rec = hubRecord(1, 0);
    d.sync(view, [rec]);
    expect(rec.mesh.userData.archetypeId).toBe(HUB_BASE_ID);
    resolve(response([{ colonyId: 'col_a', tier: 3 }]));
    await store.ensureLoaded(PLANET);
    d.sync(view, [rec]);
    expect(rec.mesh.userData.archetypeId).toBe(HUB_GOLD_ID);
    const g = (rec.mesh as THREE.Mesh).geometry;
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeCloseTo(0, 4);
  });

  it('prestige known BEFORE the mesh exists: a freshly created hub is dressed on its first sync', async () => {
    const d = new PrestigeDressing(await loaded([{ colonyId: 'col_a', tier: 2 }]));
    d.isEnabled = () => true;
    d.sync(view, []);
    const rec = hubRecord(9, 0);
    d.sync(view, [rec]);
    expect(rec.mesh.userData.archetypeId).toBe(HUB_UPLINK_ID);
  });

  it('a downgrade (stake withdrawn) removes the beam on the next refresh', async () => {
    const colonies = [{ colonyId: 'col_a', tier: 2 }];
    const store = new PrestigeStore(async () => response(colonies), (() => { let t = 0; return () => (t += 61_000); })());
    await store.ensureLoaded(PLANET);
    const d = new PrestigeDressing(store);
    d.isEnabled = () => true;
    const rec = hubRecord(1, 0);
    d.sync(view, [rec]);
    expect(hubUplinkBeam(rec.mesh)).not.toBeNull();
    colonies[0] = { colonyId: 'col_a', tier: 0 };
    await store.ensureLoaded(PLANET); // TTL elapsed in the fake clock
    d.sync(view, [rec]);
    expect(hubUplinkBeam(rec.mesh)).toBeNull();
    expect(rec.mesh.userData.archetypeId).toBe(HUB_BASE_ID);
  });

  it('leaves non-hub entities alone', async () => {
    const d = new PrestigeDressing(await loaded([{ colonyId: 'col_a', tier: 4 }]));
    d.isEnabled = () => true;
    const w = workerRecord(5, 0);
    expect(() => d.sync(view, [w])).not.toThrow();
    expect(w.mesh.children.length).toBe(0);
  });
});

describe('W28-12 PrestigeDressing cyan cutters (integration)', () => {
  it('names the cyan preset only on sites of tier 2+ colonies', async () => {
    const d = new PrestigeDressing(await loaded([{ colonyId: 'col_a', tier: 1 }, { colonyId: 'col_b', tier: 2 }, { colonyId: 'col_c', tier: 4 }]));
    d.isEnabled = () => true;
    const records = new Map([[1, workerRecord(1, 0)], [2, workerRecord(2, 1)], [3, workerRecord(3, 2)]]);
    const out = d.tintCutters([site(1), site(2), site(3, 'metals' as never)], records, view);
    expect(out.map((s) => s.presetId)).toEqual([undefined, 'work.rock.cyan', 'work.metals.cyan']);
  });

  it('keeps an explicit preset, ignores unknown workers, and is a no-op when disabled or without a view', async () => {
    const d = new PrestigeDressing(await loaded([{ colonyId: 'col_b', tier: 3 }]));
    const records = new Map([[2, workerRecord(2, 1)]]);
    expect(d.tintCutters([site(2)], records, view)[0].presetId).toBeUndefined(); // disabled by default
    d.isEnabled = () => true;
    const explicit = { ...site(2), presetId: 'work.tree' };
    expect(d.tintCutters([explicit], records, view)[0].presetId).toBe('work.tree');
    expect(d.tintCutters([site(99)], records, view)[0].presetId).toBeUndefined();
    expect(d.tintCutters([site(2)], records, null)[0].presetId).toBeUndefined();
    expect(d.tintCutters([], records, view)).toEqual([]);
  });
});

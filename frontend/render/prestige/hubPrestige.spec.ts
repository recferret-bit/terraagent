import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ArchetypeCatalog, createArchetypeMesh, setArchetypeBuildProgress, setArchetypeRuin, stripBuildingPlinth, tickArchetypeMesh } from '../kitbash';
import { cableAnchorFor } from './testHelpers';
import { applyHubPrestige, hubPrestigeTier, hubUplinkBeam, isHubMesh } from './hubPrestige';
import { uplinkShouldShow } from './uplinkBeam';
import { HUB_BASE_ID, HUB_GOLD_ID, HUB_UPLINK_ID } from './tierVisuals';

const triCount = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;
const minY = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); return g.boundingBox!.min.y; };

describe('W28-12 hub variants are registered (unit)', () => {
  it('registers the base hub and both tier variants as buildings under the triangle cap', () => {
    for (const id of [HUB_BASE_ID, HUB_UPLINK_ID, HUB_GOLD_ID]) {
      expect(ArchetypeCatalog.has(id)).toBe(true);
      expect(ArchetypeCatalog.get(id).category).toBe('building');
      const g = ArchetypeCatalog.getGeometry(id);
      expect(triCount(g)).toBeLessThan(3500);
      expect(minY(g)).toBeCloseTo(0, 3);
      expect(g.getAttribute('aPartAnim')).toBeTruthy();
    }
  });

  it('keeps tier-0 geometry identical to before and adds parts for the variants', () => {
    const base = ArchetypeCatalog.getGeometry(HUB_BASE_ID);
    const uplink = ArchetypeCatalog.getGeometry(HUB_UPLINK_ID);
    expect(base.userData.partRanges.length).toBe(45);
    expect(uplink.userData.partRanges.length).toBeGreaterThan(base.userData.partRanges.length);
    const names = (uplink.userData.partRanges as { name: string }[]).map((p) => p.name);
    expect(names).toContain('quantum dish bowl');
    expect(names).toContain('uplink emitter housing');
    expect((base.userData.partRanges as { name: string }[]).some((p) => p.name.startsWith('quantum'))).toBe(false);
  });

  it('spins the dish through the GPU part-animation path (aPartAnim animType 1) on the roof mount', () => {
    const g = ArchetypeCatalog.getGeometry(HUB_UPLINK_ID);
    const ranges = g.userData.partRanges as { name: string; start: number; count: number }[];
    const anim = g.getAttribute('aPartAnim') as THREE.BufferAttribute;
    const bowl = ranges.find((r) => r.name === 'quantum dish bowl')!;
    expect(anim.getX(bowl.start)).toBe(1);
    const mast = ranges.find((r) => r.name === 'quantum dish mast')!;
    expect(anim.getX(mast.start)).toBe(0);
  });

  it('colours the gold variant differently from the uplink variant on the accent zone only', () => {
    const colorOf = (id: string, part: string) => {
      const g = ArchetypeCatalog.getGeometry(id);
      const r = (g.userData.partRanges as { name: string; start: number }[]).find((p) => p.name === part)!;
      const c = g.getAttribute('color') as THREE.BufferAttribute;
      return [c.getX(r.start), c.getY(r.start), c.getZ(r.start)];
    };
    expect(colorOf(HUB_GOLD_ID, 'tank cap 1')).not.toEqual(colorOf(HUB_UPLINK_ID, 'tank cap 1'));
    expect(colorOf(HUB_GOLD_ID, 'command lower hull')).toEqual(colorOf(HUB_UPLINK_ID, 'command lower hull'));
  });

  it('resolves cable anchors of the variants to the hub row', () => {
    expect(cableAnchorFor(HUB_GOLD_ID)).toEqual(cableAnchorFor(HUB_BASE_ID));
    expect(cableAnchorFor(HUB_UPLINK_ID)).toEqual(cableAnchorFor(HUB_BASE_ID));
  });
});

describe('W28-12 applyHubPrestige (integration with the real archetype mesh)', () => {
  it('tier 0 leaves the hub untouched: no beam, base geometry', () => {
    const mesh = createArchetypeMesh(HUB_BASE_ID);
    const before = mesh.geometry;
    const kids = mesh.children.length;
    const v = applyHubPrestige(mesh, 0);
    expect(v.uplinkBeam).toBe(false);
    expect(mesh.geometry).toBe(before);
    expect(hubUplinkBeam(mesh)).toBeNull();
    expect(mesh.children.length).toBe(kids);
  });

  it('tier 1 swaps in the dish variant and attaches one beam; applying again is idempotent', () => {
    const mesh = createArchetypeMesh(HUB_BASE_ID);
    applyHubPrestige(mesh, 1);
    expect(mesh.userData.archetypeId).toBe(HUB_UPLINK_ID);
    const beam = hubUplinkBeam(mesh)!;
    expect(beam.group.parent).toBe(mesh);
    const geo = mesh.geometry;
    applyHubPrestige(mesh, 1);
    expect(mesh.geometry).toBe(geo);
    expect(hubUplinkBeam(mesh)).toBe(beam);
    expect(mesh.children.filter((c) => c === beam.group)).toHaveLength(1);
  });

  it('tier 3 and 4 use the gold variant; going back to 0 drops the beam and restores the base hub', () => {
    const mesh = createArchetypeMesh(HUB_BASE_ID);
    const kids = mesh.children.length;
    applyHubPrestige(mesh, 3);
    expect(mesh.userData.archetypeId).toBe(HUB_GOLD_ID);
    applyHubPrestige(mesh, 4);
    expect(mesh.userData.archetypeId).toBe(HUB_GOLD_ID);
    expect(hubPrestigeTier(mesh)).toBe(4);
    applyHubPrestige(mesh, 0);
    expect(mesh.userData.archetypeId).toBe(HUB_BASE_ID);
    expect(hubUplinkBeam(mesh)).toBeNull();
    expect(mesh.children.length).toBe(kids);
  });

  it('unknown tiers act as tier 0', () => {
    const mesh = createArchetypeMesh(HUB_BASE_ID);
    applyHubPrestige(mesh, 2);
    applyHubPrestige(mesh, -3);
    expect(mesh.userData.archetypeId).toBe(HUB_BASE_ID);
    expect(hubUplinkBeam(mesh)).toBeNull();
  });

  it('ignores meshes that are not a Command Hub', () => {
    const solar = createArchetypeMesh('building.solar');
    const kids = solar.children.length;
    expect(isHubMesh(solar)).toBe(false);
    const v = applyHubPrestige(solar, 4);
    expect(v.tier).toBe(0);
    expect(solar.userData.archetypeId).toBe('building.solar');
    expect(solar.children.length).toBe(kids);
  });

  it('works when the prestige arrives AFTER the plinth strip: re-strips, keeps ground contact and refreshes uBuildHeight', () => {
    const mesh = createArchetypeMesh(HUB_BASE_ID);
    stripBuildingPlinth(mesh);
    const strip0 = mesh.geometry.userData.stripOffsetY as number;
    expect(strip0).toBeGreaterThan(0);
    applyHubPrestige(mesh, 3);
    expect(typeof mesh.geometry.userData.stripOffsetY).toBe('number');
    expect(minY(mesh.geometry)).toBeCloseTo(0, 4);
    expect(mesh.userData.uniforms.uBuildHeight.value).toBeCloseTo(mesh.geometry.boundingBox!.max.y, 4);
    const beam = hubUplinkBeam(mesh)!;
    expect(beam.group.position.y).toBeCloseTo(4.34 - (mesh.geometry.userData.stripOffsetY as number), 4);
  });

  it('works when the prestige arrives BEFORE the plinth strip (same result)', () => {
    const early = createArchetypeMesh(HUB_BASE_ID);
    applyHubPrestige(early, 3);
    stripBuildingPlinth(early);
    const late = createArchetypeMesh(HUB_BASE_ID);
    stripBuildingPlinth(late);
    applyHubPrestige(late, 3);
    expect(early.userData.archetypeId).toBe(late.userData.archetypeId);
    expect(early.geometry.attributes.position.count).toBe(late.geometry.attributes.position.count);
    expect(minY(early.geometry)).toBeCloseTo(minY(late.geometry), 5);
  });

  it('does not stop the dish spin: the mesh ticks like any archetype', () => {
    const mesh = createArchetypeMesh(HUB_BASE_ID);
    applyHubPrestige(mesh, 1);
    tickArchetypeMesh(mesh, 3.5);
    expect(mesh.userData.uniforms.uTime.value).toBe(3.5);
  });
});

describe('W28-12 uplink beam visibility rules (unit)', () => {
  it('shows on a finished hub, hides while building and on a ruin, and can be forced', () => {
    const mesh = createArchetypeMesh(HUB_BASE_ID);
    expect(uplinkShouldShow(mesh)).toBe(true);
    setArchetypeBuildProgress(mesh, 0.5);
    expect(uplinkShouldShow(mesh)).toBe(false);
    setArchetypeBuildProgress(mesh, 1);
    expect(uplinkShouldShow(mesh)).toBe(true);
    setArchetypeRuin(mesh, true);
    expect(uplinkShouldShow(mesh)).toBe(false);
    expect(uplinkShouldShow(null)).toBe(true);
  });

  it('disposes cleanly: removes the group from its parent', () => {
    const mesh = createArchetypeMesh(HUB_BASE_ID);
    applyHubPrestige(mesh, 2);
    const beam = hubUplinkBeam(mesh)!;
    beam.dispose();
    expect(beam.group.parent).toBeNull();
  });
});

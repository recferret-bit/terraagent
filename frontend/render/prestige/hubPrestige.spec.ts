import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ArchetypeCatalog, createArchetypeMesh, setArchetypeBuildProgress, setArchetypeRuin, stripBuildingPlinth, tickArchetypeMesh } from '../kitbash';
import { PooledMeshEntry } from '../pools/PooledObject';
import { cableAnchorFor } from './testHelpers';
import { applyHubPrestige, defaultHubTierForArchetype, hubPrestigeTier, hubUplinkBeam, isHubMesh } from './hubPrestige';
import { createUplinkBeam, uplinkShouldShow } from './uplinkBeam';
import { buildUplinkFragment, UPLINK_DISC_FRAG, UPLINK_HALO_FRAG } from './uplinkBeamGlsl';
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

  it('equips each tier with distinct structural details and escalates part count across tiers', () => {
    const base = ArchetypeCatalog.getGeometry(HUB_BASE_ID);
    const uplink = ArchetypeCatalog.getGeometry(HUB_UPLINK_ID);
    const gold = ArchetypeCatalog.getGeometry(HUB_GOLD_ID);
    const partNames = (g: THREE.BufferGeometry) => (g.userData.partRanges as { name: string }[]).map((p) => p.name);
    const baseNames = partNames(base);
    const uplinkNames = partNames(uplink);
    const goldNames = partNames(gold);

    expect(baseNames.length).toBe(63);
    expect(uplinkNames.length).toBeGreaterThan(baseNames.length);
    expect(goldNames.length).toBeGreaterThan(uplinkNames.length);

    // Tier 0 industrial outpost details (without prestige uplink or sovereign structures)
    expect(baseNames).toContain('airlock hazard hood');
    expect(baseNames).toContain('flank cooling fin L 1');
    expect(baseNames).toContain('field comms housing');
    expect(baseNames).toContain('tank strap 1');
    expect(baseNames.some((n) => n.startsWith('quantum') || n.startsWith('uplink') || n.startsWith('sovereign'))).toBe(false);

    // Tier 1-2 orbital uplink focusing cage, quantum dish, telemetry pods & spires
    expect(uplinkNames).toContain('quantum dish bowl');
    expect(uplinkNames).toContain('uplink emitter housing');
    expect(uplinkNames).toContain('uplink focus ring');
    expect(uplinkNames).toContain('flank telemetry pod L');
    expect(uplinkNames).toContain('corner telemetry spire');

    // Tier 3+ sovereign gold cathedral spire, triple crowns, obelisks, portico & flank shields
    expect(goldNames).toContain('quantum dish bowl');
    expect(goldNames).toContain('spire lancet pinnacle');
    expect(goldNames).toContain('sovereign apex crown ring');
    expect(goldNames).toContain('sovereign corner obelisk');
    expect(goldNames).toContain('sovereign portico arch');
    expect(goldNames).toContain('sovereign flank shield L');
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

describe('W28-12 hub tier progression & defaults (unit)', () => {
  it('keeps the exact 6x6 footprint across all three tiers while escalating vertical complexity and distinct palettes', () => {
    const dims = (id: string) => {
      const g = ArchetypeCatalog.getGeometry(id);
      g.computeBoundingBox();
      const s = new THREE.Vector3();
      g.boundingBox!.getSize(s);
      return { w: s.x, h: s.y, d: s.z, parts: (g.userData.partRanges as unknown[]).length };
    };
    const base = dims(HUB_BASE_ID);
    const uplink = dims(HUB_UPLINK_ID);
    const gold = dims(HUB_GOLD_ID);
    // Identical initial 3x3 (6m x 6m) footprint across every tier
    for (const d of [base, uplink, gold]) {
      expect(d.w).toBeCloseTo(6, 2);
      expect(d.d).toBeCloseTo(6, 2);
    }
    // Distinct structural escalation across all three tiers
    expect(uplink.parts).toBeGreaterThan(base.parts);
    expect(gold.parts).toBeGreaterThan(uplink.parts);
    expect(gold.h).toBeGreaterThan(uplink.h + 1.0);
    // Distinct accent colour on every tier (orange vs orbital azure vs sovereign gold)
    const accentOf = (id: string) => {
      const g = ArchetypeCatalog.getGeometry(id);
      const r = (g.userData.partRanges as { name: string; start: number }[]).find((p) => p.name === 'plinth border Z')!;
      const c = g.getAttribute('color') as THREE.BufferAttribute;
      return [c.getX(r.start), c.getY(r.start), c.getZ(r.start)];
    };
    expect(accentOf(HUB_BASE_ID)).not.toEqual(accentOf(HUB_UPLINK_ID));
    expect(accentOf(HUB_UPLINK_ID)).not.toEqual(accentOf(HUB_GOLD_ID));
    expect(accentOf(HUB_BASE_ID)).not.toEqual(accentOf(HUB_GOLD_ID));
  });

  it('maps catalog hub variant ids to their intrinsic default preview tier', () => {
    expect(defaultHubTierForArchetype(HUB_BASE_ID)).toBe(0);
    expect(defaultHubTierForArchetype(HUB_UPLINK_ID)).toBe(1);
    expect(defaultHubTierForArchetype(HUB_GOLD_ID)).toBe(3);
    expect(defaultHubTierForArchetype('building.solar')).toBe(0);
    expect(defaultHubTierForArchetype('')).toBe(0);
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

  it('works when the prestige arrives BEFORE the plinth strip (same result, beam y aligned, idempotent double-strip)', () => {
    const early = createArchetypeMesh(HUB_BASE_ID);
    applyHubPrestige(early, 3);
    stripBuildingPlinth(early);
    const late = createArchetypeMesh(HUB_BASE_ID);
    stripBuildingPlinth(late);
    applyHubPrestige(late, 3);
    expect(early.userData.archetypeId).toBe(late.userData.archetypeId);
    expect(early.geometry.attributes.position.count).toBe(late.geometry.attributes.position.count);
    expect(minY(early.geometry)).toBeCloseTo(minY(late.geometry), 5);
    const earlyY = hubUplinkBeam(early)!.group.position.y;
    expect(earlyY).toBeCloseTo(hubUplinkBeam(late)!.group.position.y, 5);
    stripBuildingPlinth(early);
    expect(hubUplinkBeam(early)!.group.position.y).toBeCloseTo(earlyY, 5);
  });

  it('does not stop the dish spin: the mesh ticks like any archetype', () => {
    const mesh = createArchetypeMesh(HUB_BASE_ID);
    applyHubPrestige(mesh, 1);
    tickArchetypeMesh(mesh, 3.5);
    expect(mesh.userData.uniforms.uTime.value).toBe(3.5);
  });
});

describe('W28-12 beam VFX style progression (integration)', () => {
  it('upgrades and downgrades beam VFX style between Tier 1-2 (cyan uplink) and Tier 3+ (gold sovereign astrolabe)', () => {
    const mesh = createArchetypeMesh(HUB_BASE_ID);
    applyHubPrestige(mesh, 1);
    const uplinkBeam = hubUplinkBeam(mesh)!;
    expect(uplinkBeam.style).toBe('uplink');
    expect(uplinkBeam.group.children.some((c) => c.name.startsWith('uplink-pulse-ring'))).toBe(true);
    expect(uplinkBeam.group.children.some((c) => c.name.startsWith('sovereign-orbit-ring'))).toBe(false);

    // Tier 1 -> 2 keeps the same uplink beam instance
    applyHubPrestige(mesh, 2);
    expect(hubUplinkBeam(mesh)).toBe(uplinkBeam);

    // Tier 2 -> 3 swaps in the sovereign gold beam with orbiting astrolabe rings and disposes the old one
    applyHubPrestige(mesh, 3);
    const goldBeam = hubUplinkBeam(mesh)!;
    expect(goldBeam).not.toBe(uplinkBeam);
    expect(uplinkBeam.group.parent).toBeNull();
    expect(goldBeam.style).toBe('gold');
    expect(goldBeam.group.children.filter((c) => c.name.startsWith('sovereign-orbit-ring'))).toHaveLength(3);
    expect(goldBeam.group.children.some((c) => c.name === 'sovereign-apex-flare')).toBe(true);

    // Tier 3 -> 4 keeps the same gold beam instance
    applyHubPrestige(mesh, 4);
    expect(hubUplinkBeam(mesh)).toBe(goldBeam);

    // Downgrade Tier 4 -> 1 swaps back cleanly to the cyan uplink beam
    applyHubPrestige(mesh, 1);
    const downgraded = hubUplinkBeam(mesh)!;
    expect(goldBeam.group.parent).toBeNull();
    expect(downgraded.style).toBe('uplink');
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

  it('cleans up prestige geometry and beam on PooledMeshEntry reset (preserving plinth strip) and dispose', () => {
    const mesh = createArchetypeMesh(HUB_BASE_ID);
    stripBuildingPlinth(mesh);
    const entry = new PooledMeshEntry('building:dune:building.commandHub', 0, HUB_BASE_ID, 'dune', mesh);
    applyHubPrestige(mesh, 3);
    const goldBeam = hubUplinkBeam(mesh)!;
    expect(mesh.userData.archetypeId).toBe(HUB_GOLD_ID);
    expect(goldBeam.style).toBe('gold');

    entry.reset();
    expect(mesh.userData.archetypeId).toBe(HUB_BASE_ID);
    expect(typeof mesh.geometry.userData.stripOffsetY).toBe('number');
    expect(minY(mesh.geometry)).toBeCloseTo(0, 4);
    expect(hubPrestigeTier(mesh)).toBe(0);
    expect(hubUplinkBeam(mesh)).toBeNull();
    expect(goldBeam.group.parent).toBeNull();

    applyHubPrestige(mesh, 1);
    const uplinkBeam = hubUplinkBeam(mesh)!;
    entry.dispose();
    expect(uplinkBeam.group.parent).toBeNull();
    expect((mesh.userData as { hubPrestige?: unknown }).hubPrestige).toBeUndefined();
  });
});

describe('W28-12 beam runtime uniforms, transforms & off-state discard (unit)', () => {
  it('toggles uOn via setForced and guards all fragment shaders with an off-state discard', () => {
    for (const frag of [buildUplinkFragment(), UPLINK_DISC_FRAG, UPLINK_HALO_FRAG]) {
      expect(frag).toContain('if (uOn < 0.001) discard;');
    }
    const beam = createUplinkBeam('gold');
    const mats = beam.group.children.map((c) => (c as THREE.Mesh).material as THREE.ShaderMaterial);
    expect(mats.every((m) => m.uniforms.uOn?.value === 1)).toBe(true);
    beam.setForced(false);
    expect(mats.every((m) => m.uniforms.uOn?.value === 0)).toBe(true);
    beam.setForced(true);
    expect(mats.every((m) => m.uniforms.uOn?.value === 1)).toBe(true);
    beam.dispose();
  });

  it('syncs pulse and orbiting astrolabe world matrices both standalone and parented to a transformed hub', () => {
    const beam = createUplinkBeam('gold');
    beam.group.position.set(1, 4, -2);
    beam.setForced(true);
    const pulse = beam.group.children.find((c) => c.name === 'uplink-pulse-ring-0')!;
    const orbit = beam.group.children.find((c) => c.name === 'sovereign-orbit-ring-0')!;
    const standalonePos = new THREE.Vector3().setFromMatrixPosition(pulse.matrixWorld);
    expect(standalonePos.x).toBeCloseTo(1, 4);
    expect(standalonePos.y).toBeGreaterThan(4.3);
    expect(standalonePos.z).toBeCloseTo(-2, 4);
    const orbitPos = new THREE.Vector3().setFromMatrixPosition(orbit.matrixWorld);
    expect(orbitPos.y).toBeCloseTo(4.91, 4);

    const mesh = createArchetypeMesh(HUB_BASE_ID);
    mesh.position.set(10, 0, -5);
    mesh.add(beam.group);
    mesh.updateMatrixWorld(true);
    beam.setForced(null);
    const parentedPos = new THREE.Vector3().setFromMatrixPosition(orbit.matrixWorld);
    expect(parentedPos.x).toBeCloseTo(11, 4);
    expect(parentedPos.y).toBeCloseTo(4.91, 4);
    expect(parentedPos.z).toBeCloseTo(-7, 4);
    beam.dispose();
  });
});

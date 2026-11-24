// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ArchetypeCatalog } from '../../kitbash';
import { FLAGSHIP_CARRIER_ID } from '../../prestige/tierVisuals';
import { BiomeMaterialRegistry } from '../../visuals/UnifiedColonyMaterial';
import { FlagshipCarrier } from './FlagshipCarrier';

describe('W28-12 ship.flagshipCarrier archetype (unit)', () => {
  it('is registered as a ship under the triangle cap with ground contact and a gold accent zone', () => {
    expect(ArchetypeCatalog.has(FLAGSHIP_CARRIER_ID)).toBe(true);
    expect(ArchetypeCatalog.get(FLAGSHIP_CARRIER_ID).category).toBe('ship');
    const g = ArchetypeCatalog.getGeometry(FLAGSHIP_CARRIER_ID);
    expect(g.attributes.position.count / 3).toBeLessThan(3500);
    g.computeBoundingBox();
    expect(Math.abs(g.boundingBox!.min.y)).toBeLessThan(1e-3);
    const names = (g.userData.partRanges as { name: string }[]).map((p) => p.name);
    expect(names).toContain('flagship command crest');
    expect(names.length).toBeGreaterThanOrEqual(7);
    const stock = ArchetypeCatalog.getGeometry('ship.carrier').getAttribute('color') as THREE.BufferAttribute;
    const ours = g.getAttribute('color') as THREE.BufferAttribute;
    // the accent plates differ from the stock orange carrier (gold-anodized livery)
    const r = (g.userData.partRanges as { name: string; start: number }[]).find((p) => p.name === 'nose dorsal crest')!;
    const rs = (
      ArchetypeCatalog.getGeometry('ship.carrier').userData.partRanges as { name: string; start: number }[]
    ).find((p) => p.name === 'nose dorsal crest')!;
    expect(ours.getX(r.start)).not.toBeCloseTo(stock.getX(rs.start), 2);
  });
});

describe('W28-12 FlagshipCarrier stage part (integration)', () => {
  const camera = () => {
    const c = new THREE.PerspectiveCamera(28, 1.6, 0.5, 4000);
    c.position.set(0, 1.4, 62);
    c.lookAt(0, 0.3, 0);
    c.updateMatrixWorld();
    return c;
  };

  it('builds nothing until a patron exists, then parks one model and projects a screen anchor', () => {
    const scene = new THREE.Scene();
    const f = new FlagshipCarrier(scene);
    expect(f.active).toBe(false);
    expect(f.project(camera())).toBeNull();
    f.setLeadPatron({ carrierName: 'ISS alice.near' });
    expect(f.active).toBe(true);
    expect(scene.children.length).toBe(1);
    f.update(1, new THREE.Vector3(8, 0, 0), true);
    const p = f.project(camera())!;
    expect(p.name).toBe('ISS alice.near');
    expect(p.visible).toBe(true);
    expect(p.nx).toBeGreaterThan(0);
    expect(p.nx).toBeLessThan(1);
    expect(p.ny).toBeGreaterThan(0);
    expect(p.ny).toBeLessThan(1);
    f.dispose();
  });

  it('renaming keeps the one model; null (or a blank name) removes it', () => {
    const scene = new THREE.Scene();
    const f = new FlagshipCarrier(scene);
    f.setLeadPatron({ carrierName: 'ISS a.near' });
    f.setLeadPatron({ carrierName: 'ISS b.near' });
    expect(scene.children.length).toBe(1);
    f.update(0, new THREE.Vector3(), true);
    expect(f.project(camera())!.name).toBe('ISS b.near');
    f.setLeadPatron({ carrierName: '   ' });
    expect(f.active).toBe(false);
    expect(scene.children.length).toBe(0);
    f.setLeadPatron({ carrierName: 'ISS c.near' });
    f.setLeadPatron(null);
    expect(f.active).toBe(false);
  });

  it('is hidden while the stage deploys or dives and syncs Fresnel rim tint on setBiome', () => {
    const scene = new THREE.Scene();
    const f = new FlagshipCarrier(scene, 'dune');
    f.setLeadPatron({ carrierName: 'ISS a.near' });
    f.update(1, new THREE.Vector3(), false);
    expect(f.project(camera())!.visible).toBe(false);
    f.update(1, new THREE.Vector3(), true);
    expect(f.project(camera())!.visible).toBe(true);

    f.setBiome('oceanForest');
    const mesh = scene.children[0]!.children[0] as THREE.Mesh;
    expect((mesh.userData.uniforms.uRimTint.value as THREE.Color).getHex()).toBe(
      BiomeMaterialRegistry.getBiome('oceanForest').rimTint,
    );
    f.dispose();
  });
});

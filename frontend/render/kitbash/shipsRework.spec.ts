// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createDropRig } from '../descent/dropRig';
import { UNIT_POOL_THRESHOLDS, resolveUnitPoolThreshold } from '../pools/PoolThresholds';
import { ProceduralTextureRegistry } from '../visuals/ProceduralTextureRegistry';
import { ShaderPluginRegistry } from '../visuals/UnifiedColonyMaterial';
import { FLAGSHIP_PLATING, SHIP_SPIN_NORMALS } from '../visuals/unified/flagshipPlating';
import { acquireModel } from '../visuals/space/placeholders';
import { bevelSlab, chamferBox } from './greebles/shipParts';
import { ArchetypeCatalog, KitbashBuilder, createArchetypeMesh, tickArchetypeMesh } from './index';
import { validateArchetype } from './validate';

interface PartRange {
  name: string;
  start: number;
  count: number;
}

function measureBox(id: string): {
  size: THREE.Vector3;
  box: THREE.Box3;
  tris: number;
  parts: PartRange[];
  geo: THREE.BufferGeometry;
} {
  const geo = ArchetypeCatalog.getGeometry(id);
  geo.computeBoundingBox();
  const box = geo.boundingBox!.clone();
  const size = box.getSize(new THREE.Vector3());
  const tris = geo.getAttribute('position').count / 3;
  const parts = (geo.userData.partRanges as PartRange[]) ?? [];
  return { size, box, tris, parts, geo };
}

function countAnimChannelVerts(geo: THREE.BufferGeometry, channel: number): number {
  const anim = geo.getAttribute('aPartAnim') as THREE.BufferAttribute;
  let hits = 0;
  for (let i = 0; i < anim.count; i++) {
    if (Math.round(anim.getX(i)) === channel) hits++;
  }
  return hits;
}

function partCenter(pos: THREE.BufferAttribute, r: PartRange): THREE.Vector3 {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (let i = r.start; i < r.start + r.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return new THREE.Vector3((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);
}

describe('Space ships rework: distinct architectures & scale hierarchy', () => {
  it('gives guildTrader, carrier, and flagshipCarrier distinct dimensions, minY=0 contact, and scale hierarchy', () => {
    const trader = measureBox('ship.guildTrader');
    const carrier = measureBox('ship.carrier');
    const flagship = measureBox('ship.flagshipCarrier');

    expect(trader.tris).toBeLessThan(3400);
    expect(carrier.tris).toBeLessThan(3420);
    expect(flagship.tris).toBeLessThan(3420);

    expect(Math.abs(trader.box.min.y)).toBeLessThan(1e-3);
    expect(Math.abs(carrier.box.min.y)).toBeLessThan(1e-3);
    expect(Math.abs(flagship.box.min.y)).toBeLessThan(1e-3);

    expect(trader.size.z).toBeGreaterThan(15);
    expect(trader.size.z).toBeLessThan(24);
    expect(carrier.size.z).toBeGreaterThan(45);
    expect(carrier.size.z).toBeLessThan(62);
    expect(flagship.size.z).toBeGreaterThan(75);
    expect(flagship.size.x).toBeGreaterThan(carrier.size.x + 10);

    expect(trader.parts.length).toBeGreaterThanOrEqual(40);
    expect(trader.parts.length).toBeLessThan(carrier.parts.length);
    expect(flagship.parts.length).toBeGreaterThan(carrier.parts.length);

    const traderNames = new Set(trader.parts.map((p) => p.name));
    const carrierNames = new Set(carrier.parts.map((p) => p.name));
    const flagshipNames = new Set(flagship.parts.map((p) => p.name));

    expect(traderNames.has('tug cabin hull')).toBe(true);
    expect(traderNames.has('belly cargo collar')).toBe(true);
    expect(traderNames.has('carrier main hull')).toBe(false);

    expect(carrierNames.has('bow mandible prow')).toBe(true);
    expect(carrierNames.has('drop bay docking collar')).toBe(true);
    expect(carrierNames.has('gravimetric centrifuge ring')).toBe(false);

    expect(flagshipNames.has('hammerhead atrium prow')).toBe(true);
    expect(flagshipNames.has('midships bridging hull chine')).toBe(true);
    expect(flagshipNames.has('gravimetric centrifuge ring')).toBe(true);
    expect(flagshipNames.has('astrogation glass cupola')).toBe(true);
  });
});

describe('Space ships rework: solar panels, drop-pod arrays & bevel integrity', () => {
  it('replaces legacy slab wings with multi-cell solar panels and 6 planet-canted pods on flagship', () => {
    for (const id of ['ship.carrier', 'ship.flagshipCarrier', 'ship.guildTrader']) {
      const legacyVanes = measureBox(id).parts.filter((p) => /collector wing|wing collector vane/i.test(p.name));
      expect(legacyVanes, `${id} should have zero legacy collector vanes`).toHaveLength(0);
    }

    const carrierParts = measureBox('ship.carrier').parts;
    const flagshipParts = measureBox('ship.flagshipCarrier').parts;
    expect(carrierParts.filter((p) => /solar cell/i.test(p.name)).length).toBeGreaterThanOrEqual(16);
    expect(flagshipParts.filter((p) => /solar cell/i.test(p.name)).length).toBeGreaterThanOrEqual(24);
    expect(flagshipParts.filter((p) => p.name === 'racked drop pod')).toHaveLength(6);
    expect(carrierParts.filter((p) => p.name === 'racked drop pod')).toHaveLength(4);

    const fMeasured = measureBox('ship.flagshipCarrier');
    const fPos = fMeasured.geo.getAttribute('position') as THREE.BufferAttribute;
    const starSleeves = fMeasured.parts.filter((p) => p.name === 'starboard flagship pod launch sleeve');
    const starShields = fMeasured.parts.filter((p) => p.name === 'starboard flagship pod heat shield');
    const portSleeves = fMeasured.parts.filter((p) => p.name === 'port flagship pod launch sleeve');
    const portShields = fMeasured.parts.filter((p) => p.name === 'port flagship pod heat shield');
    expect(starSleeves).toHaveLength(3);
    expect(portSleeves).toHaveLength(3);
    const starDir = partCenter(fPos, starShields[0]!).sub(partCenter(fPos, starSleeves[0]!)).normalize();
    const portDir = partCenter(fPos, portShields[0]!).sub(partCenter(fPos, portSleeves[0]!)).normalize();
    expect(starDir.y).toBeLessThan(-0.98);
    expect(portDir.y).toBeLessThan(-0.98);
    expect(starDir.dot(portDir)).toBeGreaterThan(0.95);
  });

  it('eliminates raw sharp BoxGeometry across all parts, centers carrier docking collar, and sets dropPod quartz glass', () => {
    for (const id of ['ship.flagshipCarrier', 'ship.carrier', 'ship.guildTrader']) {
      const rep = validateArchetype(id);
      expect(rep.parts.length, `${id} part count`).toBeGreaterThanOrEqual(40);
      const sharpBoxes = rep.parts.filter((p) => p.kind === 'BoxGeometry');
      expect(
        sharpBoxes.map((p) => p.name),
        `${id} raw BoxGeometry parts`,
      ).toEqual([]);
    }

    const fittedCarrier = acquireModel('ship.carrier', 'dune');
    const cMesh = fittedCarrier.mesh as THREE.Mesh;
    const cPos = cMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const cRanges = cMesh.geometry.userData.partRanges as PartRange[];
    const collarCenter = partCenter(
      cPos,
      cRanges.find((r) => r.name === 'drop bay docking collar')!,
    ).add(cMesh.position);
    expect(Math.abs(collarCenter.x)).toBeLessThan(0.015);
    expect(Math.abs(collarCenter.z)).toBeLessThan(0.015);
    const dropRig = createDropRig(fittedCarrier.root, { biomeKey: 'dune', carrierScale: 1 });
    expect(dropRig.group.parent).toBe(fittedCarrier.root);
    dropRig.dispose();
    fittedCarrier.dispose();

    const podGeo = ArchetypeCatalog.getGeometry('ship.dropPod');
    const podColor = podGeo.getAttribute('color') as THREE.BufferAttribute;
    const podRanges = podGeo.userData.partRanges as PartRange[];
    const visorRange = podRanges.find((r) => r.name === 'hatch viewport visor')!;
    expect(podColor.getZ(visorRange.start)).toBeGreaterThan(0.8);
    expect(podColor.getY(visorRange.start)).toBeGreaterThan(0.4);

    expect(UNIT_POOL_THRESHOLDS['ship.flagshipCarrier']).toEqual({ initialSize: 1, threshold: 2 });
    expect(resolveUnitPoolThreshold('ship.flagshipCarrier').threshold).toBe(2);
  });
});

describe('Space ships rework: quartz-glass viewports, radars & GPU channels', () => {
  it('equips each ship with readable quartz-glass viewports, varied radars/antennas, and GPU animations', () => {
    for (const [id, minGlass] of [
      ['ship.guildTrader', 4],
      ['ship.carrier', 7],
      ['ship.flagshipCarrier', 7],
    ] as const) {
      const { parts, geo } = measureBox(id);
      const glassParts = parts.filter(
        (p) => /visor|glass|window|windshield|canopy|cupola/i.test(p.name) && !/brow|light|housing|frame/i.test(p.name),
      );
      expect(glassParts.length, `${id} glass parts`).toBeGreaterThanOrEqual(minGlass);
      expect(countAnimChannelVerts(geo, 1), `${id} SpinY vertices`).toBeGreaterThan(0);
      expect(countAnimChannelVerts(geo, 3), `${id} RecoilPulse vertices`).toBeGreaterThan(0);

      const mesh = createArchetypeMesh(id, 'dune');
      for (const [t, w, wk] of [
        [0, 0, 0],
        [12.5, 0, 1],
        [10_000, 1, 0.5],
      ] as const) {
        tickArchetypeMesh(mesh, t, w, wk);
        expect(Number.isFinite(mesh.userData.uniforms.uTime.value)).toBe(true);
      }
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }

    for (const id of ['ship.carrier', 'ship.flagshipCarrier']) {
      const names = measureBox(id)
        .parts.map((p) => p.name)
        .join(' | ');
      expect(names).toMatch(/radar scanner bar/);
      expect(names).toMatch(/radar dish/);
      expect(names).toMatch(/aesa radar/);
      expect(names).toMatch(/optical camera window/);
      expect(names).toMatch(/dipole crossbar/);
    }
  });
});

describe('Space ships rework: flagship PBR shader compilation & uniform derivative safety', () => {
  it('binds hull albedo, Sobel normal, roughness & solar hex textures exclusively to ship.flagshipCarrier', () => {
    const bundle = ProceduralTextureRegistry.get('flagshipSovereignHull', 128);
    expect(bundle.map).toBeInstanceOf(THREE.DataTexture);
    expect(bundle.normalMap).toBeInstanceOf(THREE.DataTexture);
    expect(bundle.roughnessMap).toBeInstanceOf(THREE.DataTexture);
    expect(bundle.map!.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(bundle.normalMap!.colorSpace).toBe(THREE.NoColorSpace);

    const data = (bundle.map!.image as { data: Uint8Array }).data;
    let minR = 255,
      maxR = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! < minR) minR = data[i]!;
      if (data[i]! > maxR) maxR = data[i]!;
    }
    expect(maxR - minR).toBeGreaterThan(80);

    const plugin = ShaderPluginRegistry.getModifier(FLAGSHIP_PLATING);
    expect(plugin?.fragmentNormalChunk).toContain('uFlagshipNormalMap');
    expect(plugin?.fragmentColorChunk).toContain('uFlagshipSolarMap');
    expect(ShaderPluginRegistry.getModifier(SHIP_SPIN_NORMALS)?.vertexNormalChunk).toContain('objectNormal');

    const flagshipMesh = createArchetypeMesh('ship.flagshipCarrier', 'dune');
    const carrierMesh = createArchetypeMesh('ship.carrier', 'dune');
    const traderMesh = createArchetypeMesh('ship.guildTrader', 'dune');

    const compiled = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    (flagshipMesh.material as THREE.Material).onBeforeCompile(
      compiled as THREE.WebGLProgramParametersWithUniforms,
      null as unknown as THREE.WebGLRenderer,
    );
    expect(compiled.vertexShader).toContain('snSpinAng');
    expect(compiled.fragmentShader).toContain('sampleFlagshipTriplanar');
    const afterHoistComment = compiled.fragmentShader.split('Sample mipmapped DataTextures outside')[1] ?? '';
    const beforeFirstBranch = afterHoistComment.split('if (isEmissive < 0.5')[0] ?? '';
    expect(beforeFirstBranch).toContain('sampleFlagshipTriplanar(uFlagshipHullMap');
    expect(beforeFirstBranch).toContain('sampleFlagshipTriplanar(uFlagshipSolarMap');

    expect(flagshipMesh.userData.uniforms.uFlagshipHullMap?.value).toBeDefined();
    expect(flagshipMesh.userData.uniforms.uFlagshipNormalMap?.value).toBeDefined();
    expect(flagshipMesh.userData.uniforms.uFlagshipRoughMap?.value).toBeDefined();
    expect(flagshipMesh.userData.uniforms.uFlagshipSolarMap?.value).toBeDefined();
    expect(carrierMesh.userData.uniforms.uFlagshipHullMap).toBeUndefined();
    expect(traderMesh.userData.uniforms.uFlagshipHullMap).toBeUndefined();

    expect((flagshipMesh.material as THREE.MeshStandardMaterial).fog).toBe(false);
    expect((carrierMesh.material as THREE.MeshStandardMaterial).fog).toBe(false);
    expect((traderMesh.material as THREE.MeshStandardMaterial).fog).toBe(true);

    for (const m of [flagshipMesh, carrierMesh, traderMesh]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
});

describe('Space ships rework: shipParts greeble registry & boundary geometry edge cases', () => {
  it('handles zero/negative/oversized bevels and invokes all 7 registered ship greebles without NaN attributes', () => {
    for (const g of [
      chamferBox(0, 0, 0, 5),
      chamferBox(1, 2, 3, -1),
      bevelSlab(0, 0, 0, 4),
      bevelSlab(1, 0.2, 2, -0.5, 'x', -1),
    ]) {
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      expect(nrm.count).toBe(pos.count);
      expect(uv.count).toBe(pos.count);
      for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i])).toBe(true);
      for (let i = 0; i < uv.array.length; i++) expect(Number.isFinite(uv.array[i])).toBe(true);
      g.dispose();
    }

    for (const id of [
      'ship.carrier',
      'ship.guildTrader',
      'ship.flagshipCarrier',
      'ship.dropPod',
      'ship.dropPodShell',
    ]) {
      const shipGeo = ArchetypeCatalog.getGeometry(id);
      const vCount = shipGeo.getAttribute('position').count;
      for (const [attrName, attr] of Object.entries(shipGeo.attributes)) {
        expect(attr.count, `${id}.${attrName}.count vs position.count`).toBe(vCount);
      }
      shipGeo.dispose();
    }

    const b = new KitbashBuilder();
    b.addGreeble('orbitalSolarWing', { position: [0, 0, 0], span: 2, chord: 1, cols: 1, rows: 1 });
    b.addGreeble('radiatorLouvres', { position: [3, 0, 0], width: 1.2, height: 0.8, slats: 1 });
    b.addGreeble('angledDropPodCradle', { position: [6, 0, 0], scale: 0.5 });
    b.addGreeble('slottedRadar', { base: [0, 2, 0] });
    b.addGreeble('parabolicDish', { base: [3, 2, 0] });
    b.addGreeble('dipoleCommsMast', { base: [6, 2, 0] });
    b.addGreeble('opticalSensorTurret', { base: [9, 2, 0], invert: true });
    const merged = b.build();
    const mPos = merged.getAttribute('position') as THREE.BufferAttribute;
    expect(mPos.count).toBeGreaterThan(100);
    for (let i = 0; i < mPos.array.length; i++) expect(Number.isFinite(mPos.array[i])).toBe(true);
    merged.dispose();
  });
});

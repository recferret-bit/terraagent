import * as THREE from 'three';
import {
  buildDepositArchetypeStage,
  DEPOSIT_STAGES,
  getDepositPreviewStage,
  isDepositArchetype,
  registerDepositStageBuilder,
  resolveDepositArchetype,
  setDepositPreviewStage,
  type CanonicalDepositId,
  type DepositVisualStage,
} from '../../catalog';
import { KitbashBuilder } from '../../KitbashRegistry';
import { rbox, cyl, sph, strut, sag, rockGeo, rng, lathe, type V3 } from '../../greebles/unitParts';
import { finalizeBuiltGeometry, register } from './common';

export {
  buildDepositArchetypeStage,
  DEPOSIT_STAGES,
  getDepositPreviewStage,
  isDepositArchetype,
  resolveDepositArchetype,
  setDepositPreviewStage,
  type CanonicalDepositId,
  type DepositVisualStage,
};

// ---------------------------------------------------------------------------
// Resource deposits (full / half / depleted visual stages)
// ---------------------------------------------------------------------------
function buildMetalDeposit(b: KitbashBuilder, stage: DepositVisualStage = 'full'): void {
  const yScale = stage === 'full' ? 1.0 : stage === 'half' ? 0.68 : 0.28;
  const xzScale = stage === 'depleted' ? 0.92 : 1.0;
  b.addPart(rockGeo(0.7, 3, 0.78), 'hullPrimary', {
    position: [0, 0.42 * yScale, 0],
    scale: [xzScale, yScale, xzScale],
  });
  b.addPart(rockGeo(0.34, 5, 0.82), 'hullSecondary', {
    position: [0.58, 0.24 * yScale, 0.26],
    scale: [xzScale, yScale, xzScale],
  });
  b.addPart(rockGeo(0.32, 8, 0.82), 'frameGunmetal', {
    position: [-0.52, 0.22 * yScale, 0.34],
    scale: [xzScale, yScale, xzScale],
  });
  b.addPart(rockGeo(0.24, 12, 0.82), 'hullSecondary', {
    position: [-0.15, 0.2 * yScale, -0.54],
    scale: [xzScale, yScale, xzScale],
  });
  b.addPart(rbox(0.3, 0.82 * yScale, 0.3, stage === 'full' ? 0.06 : 0.04), 'frameGunmetal', {
    position: [0.14, 0.78 * yScale, 0.08],
    rotation: [0.2, 0.5, 0.3],
  });
  b.addPart(rbox(0.24, 0.58 * yScale, 0.24, stage === 'full' ? 0.05 : 0.04), 'hullSecondary', {
    position: [-0.26, 0.68 * yScale, 0.16],
    rotation: [-0.3, 0.2, -0.4],
  });
  b.addPart(rbox(0.46, Math.max(0.08, 0.16 * yScale), 0.22, stage === 'full' ? 0.04 : 0.03), 'hullPrimary', {
    position: [0.42, 0.48 * yScale, 0.2],
    rotation: [0, 0.7, 0.4],
  });
  const allNuggets: V3[] = [
    [0.78, 0.36 * yScale, 0.28],
    [0.32, 0.72 * yScale, -0.34],
    [-0.68, 0.32 * yScale, 0.42],
    [-0.18, 0.32 * yScale, -0.62],
  ];
  if (stage !== 'full') {
    // Mined-out ore pits: dull chips where the harvested nuggets were (detail on the rocks they left bare).
    const chips: V3[] = [[-0.72, 0.4 * yScale, 0.38], [-0.5, 0.45 * yScale, 0.5], [-0.17, 0.34 * yScale, -0.68]];
    chips.forEach((p, i) => b.addPart(rockGeo(0.065, 40 + i, 0.8, 0), 'hullPrimary', { name: 'mined ore chip', position: p }));
  }
  const nuggetCount = stage === 'full' ? 4 : stage === 'half' ? 2 : 1;
  const nuggetRad = stage === 'full' ? 0.11 : stage === 'half' ? 0.095 : 0.075;
  for (let i = 0; i < nuggetCount; i++) {
    b.addPart(rockGeo(nuggetRad, 20 + i, 1, 0), 'warningAmber', {
      position: allNuggets[i]!,
      emissiveIntensity: stage === 'depleted' ? 3.0 : 3.2,
    });
  }
}

function buildCrystalDeposit(b: KitbashBuilder, stage: DepositVisualStage = 'full'): void {
  const bedY = stage === 'depleted' ? 0.55 : 1.0;
  b.addPart(rockGeo(0.64, 31, 0.48), 'hullPrimary', { position: [0, 0.18 * bedY, 0], scale: [1, bedY, 1] });
  b.addPart(rockGeo(0.33, 33, 0.58), 'frameGunmetal', { position: [0.54, 0.14 * bedY, 0.18], scale: [1, bedY, 1] });
  b.addPart(rockGeo(0.31, 35, 0.58), 'hullSecondary', { position: [-0.46, 0.14 * bedY, -0.2], scale: [1, bedY, 1] });
  const r = rng(77);
  const spires: [number, number, number, number][] = [
    [0, 0, 1.45, 0.17],
    [0.26, 0.14, 1.05, 0.13],
    [-0.26, 0.1, 0.92, 0.12],
    [0.12, -0.26, 0.82, 0.1],
    [-0.14, 0.26, 0.76, 0.095],
    [0.52, 0.18, 0.72, 0.09],
  ];
  spires.forEach(([x, z, rawH, rad], i) => {
    const lean = (r() - 0.5) * 0.22;
    const hMul =
      stage === 'full'
        ? 1.0
        : stage === 'half'
          ? i < 3
            ? 0.62
            : 0.24
          : 0.18;
    const h = rawH * hMul;
    const baseOff = 0.18 * bedY;
    if (stage === 'full' || (stage === 'half' && i < 3)) {
      b.addPart(cyl(0.0, rad * 0.9, h * 0.42, 6), 'energyCyan', {
        position: [x, baseOff + h * 0.78, z],
        rotation: [lean, 0, lean * 0.6],
        emissiveIntensity: i === 0 ? 4.2 : 3.4,
      });
    }
    // Cut-down stubs that would sit wholly inside the bed rock are left out (invisible, and the validator's
    // BURIED_PART / HAIRLINE_GAP between neighbouring stubs): half keeps spires 0–2, depleted the centre + outer one.
    if ((stage === 'half' && i >= 3) || (stage === 'depleted' && i >= 1 && i <= 4)) return;
    b.addPart(cyl(rad * 0.9, rad, h * 0.66, 6), stage === 'depleted' && i > 1 ? 'frameGunmetal' : 'energyCyan', {
      position: [x, baseOff + h * 0.33, z],
      rotation: [lean, 0, lean * 0.6],
      ...(stage === 'depleted' && i > 1 ? {} : { emissiveIntensity: 3.0 }),
    });
  });
  const allShards: V3[] = [
    [0.44, 0.38 * bedY, -0.18],
    [-0.38, 0.38 * bedY, 0.26],
    [0.74, 0.26 * bedY, 0.24],
    [-0.64, 0.24 * bedY, -0.26],
    [0.16, 0.42 * bedY, 0.42],
  ];
  if (stage !== 'full') {
    // Spent crystal stumps on the side rocks: the harvested spires leave dark broken bases (detail on the rocks).
    const stumps: V3[] = [[0.6, 0.27 * bedY, 0.08], [0.68, 0.25 * bedY, 0.3], [-0.4, 0.27 * bedY, -0.3], [-0.54, 0.27 * bedY, -0.12]];
    stumps.forEach((p, i) => b.addPart(cyl(0.028, 0.04, 0.16 * bedY + 0.04, 6), 'frameGunmetal', {
      name: 'spent crystal stump', position: p, rotation: [0.15 * (i % 2 ? 1 : -1), 0, 0.12],
    }));
  }
  const shardCount = stage === 'full' ? 5 : stage === 'half' ? 2 : 1;
  for (let i = 0; i < shardCount; i++) {
    b.addPart(new THREE.OctahedronGeometry(stage === 'depleted' ? 0.08 : 0.11, 0), 'energyCyan', {
      position: allShards[i]!,
      emissiveIntensity: 3.2,
    });
  }
}

function buildOilDeposit(b: KitbashBuilder, stage: DepositVisualStage = 'full'): void {
  const rimScale = stage === 'depleted' ? 0.55 : stage === 'half' ? 0.78 : 1.0;
  const mastTop = stage === 'full' ? 1.0 : stage === 'half' ? 0.68 : 0.36;
  b.addPart(lathe([[0, 0.0], [0.98, 0.0], [1.05, 0.11 * rimScale], [0, 0.11 * rimScale]], 20), 'hullPrimary', {
    position: [0, 0, 0],
  });
  b.addPart(
    cyl(0.86, 0.86, 0.07 * rimScale, 20),
    stage === 'depleted' ? 'rubberDark' : 'glassVisor',
    { position: [0, 0.12 * rimScale, 0] },
  );
  if (stage !== 'depleted') {
    const sheenR = stage === 'full' ? 0.48 : 0.28;
    b.addPart(cyl(sheenR, sheenR, 0.03, 16), 'dangerCrimson', {
      position: [-0.15, 0.155 * rimScale, 0.1],
      emissiveIntensity: 3.0,
    });
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.38;
    const zone = i % 2 === 0 ? 'hullSecondary' : 'frameGunmetal';
    b.addPart(rockGeo((0.18 + (i % 2) * 0.03) * rimScale, 40 + i, 0.75), zone, {
      position: [Math.cos(a) * 0.94, 0.14 * rimScale, Math.sin(a) * 0.94],
    });
  }
  if (stage === 'full' || stage === 'half') {
    b.addPart(sph(0.12 * rimScale, 10, 6), 'hullSecondary', {
      position: [0.3, 0.15 * rimScale, -0.2],
      scale: [1, 0.6, 1],
    });
  }
  if (stage === 'full') {
    b.addPart(sph(0.09, 10, 6), 'hullSecondary', { position: [-0.35, 0.15, -0.3], scale: [1, 0.6, 1] });
  }
  b.addPart(cyl(0.14, 0.18, 0.22 * rimScale, 8), 'frameGunmetal', { position: [0, 0.2 * rimScale, -0.45] });
  b.addPart(rbox(0.5, 0.16 * rimScale, 0.44, 0.04), 'frameGunmetal', { position: [0, 0.14 * rimScale, -1.02] });
  strut(b, [0, 0.16 * rimScale, -1.02], [0, mastTop, -1.02], 0.055, 'hullPrimary');
  b.addPart(rbox(0.14, 0.14, 0.86 * (stage === 'depleted' ? 0.55 : 1), 0.03), 'hullSecondary', {
    position: [0, mastTop + 0.02, -0.95],
    rotation: [-0.2, 0, 0],
  });
  const beaconY = mastTop + 0.1;
  const beaconZ = stage === 'depleted' ? -0.76 : -0.56;
  b.addPart(sph(stage === 'depleted' ? 0.055 : 0.07), 'warningAmber', {
    position: [0, beaconY, beaconZ],
    emissiveIntensity: stage === 'depleted' ? 3.2 : 4,
    animType: 3,
    animPivot: [0, beaconY, beaconZ],
  });
  if (stage !== 'depleted') {
    sag(b, [0.0, mastTop * 0.82, -1.0], [0.0, 0.26 * rimScale, -0.48], 0.08 * rimScale, 0.025);
  }
}

registerDepositStageBuilder('resource.metalDeposit', (stage) => {
  const b = new KitbashBuilder();
  buildMetalDeposit(b, stage);
  return finalizeBuiltGeometry(b.build(), { snap: true });
});

registerDepositStageBuilder('resource.crystalDeposit', (stage) => {
  const b = new KitbashBuilder();
  buildCrystalDeposit(b, stage);
  return finalizeBuiltGeometry(b.build(), { snap: true });
});

registerDepositStageBuilder('resource.oilDeposit', (stage) => {
  const b = new KitbashBuilder();
  buildOilDeposit(b, stage);
  return finalizeBuiltGeometry(b.build(), { snap: true });
});

register({
  id: 'resource.metalDeposit',
  label: 'Metal Deposit',
  category: 'resource',
  footprint: [2, 2],
  notes: 'Rock cluster with exposed metallic ore veins and amber-lit nuggets.',
  build: (b) => buildMetalDeposit(b, getDepositPreviewStage()),
});

register({
  id: 'resource.crystalDeposit',
  label: 'Crystal Deposit',
  category: 'resource',
  footprint: [2, 2],
  notes: 'Glowing cyan crystal spires erupting from a rock bed.',
  build: (b) => buildCrystalDeposit(b, getDepositPreviewStage()),
});

register({
  id: 'resource.oilDeposit',
  label: 'Oil Deposit',
  category: 'resource',
  footprint: [2, 2],
  notes: 'Dark viscous pool in a rock ring with seep bubbles, rusty pump jack stub and amber marker.',
  build: (b) => buildOilDeposit(b, getDepositPreviewStage()),
});

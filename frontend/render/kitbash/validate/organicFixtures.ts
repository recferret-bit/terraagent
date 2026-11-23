import '../index';
import { KitbashBuilder } from '../KitbashRegistry';
import { organ } from '../greebles/organic/shapes';
import { FAUNA_SPECIES_ZONES } from '../faunaVisualRegistry';
import { extractArchetype } from './extract';
import { validateModel } from './ModelValidator';
import type { ModelInput, PartDef, Report } from './types';

function fixture(): ModelInput {
  const b = new KitbashBuilder(FAUNA_SPECIES_ZONES.blackAnt);
  b.addPart(organ([0.3, 0.3, 0.3], 1), 'hullPrimary', { name: 'shell', position: [0, 0.3, 0] });
  b.addPart(organ([0.13, 0.15, 0.13], 2), 'frameGunmetal', { name: 'membrane', position: [0, 0.68, 0] });
  const { built } = KitbashBuilder.capture(() => b.build());
  const model = built[0];
  const pos = model.geometry.getAttribute('position');
  let offset = 0;
  const parts: PartDef[] = model.parts.map((p): PartDef => {
    const tris = new Float32Array(p.vertexCount * 3);
    for (let i = 0; i < p.vertexCount; i++) {
      tris[i * 3] = pos.getX(offset + i);
      tris[i * 3 + 1] = pos.getY(offset + i);
      tris[i * 3 + 2] = pos.getZ(offset + i);
    }
    offset += p.vertexCount;
    return {
      ...p,
      tris,
      vertRig: p.vertRig
        ? {
            role: p.vertRig.role,
            pivot: [p.pivot[0], p.pivot[1], p.pivot[2]],
            joint: p.vertRig.joint ? [p.vertRig.joint[0], p.vertRig.joint[1], p.vertRig.joint[2]] : [p.pivot[0], p.pivot[1], p.pivot[2]],
            tip: p.vertRig.tip ? [p.vertRig.tip[0], p.vertRig.tip[1], p.vertRig.tip[2]] : [p.pivot[0], p.pivot[1], p.pivot[2]],
            meta: p.vertRig.meta ?? 0,
          }
        : undefined,
    };
  });
  model.geometry.dispose();
  return { id: 'organic.fixture', label: 'organic fixture', source: 'builder', parts };
}

function cloneModel(src: ModelInput): ModelInput {
  return {
    ...src,
    parts: src.parts.map((p): PartDef => ({
      ...p,
      pivot: [...p.pivot],
      tris: new Float32Array(p.tris),
      vertRig: p.vertRig ? { ...p.vertRig, pivot: [...p.vertRig.pivot], joint: [...p.vertRig.joint], tip: [...p.vertRig.tip] } : undefined,
      vertConfig: p.vertConfig ? { ...p.vertConfig } : undefined,
    })),
  };
}

function insectFixtures(): Array<{ name: string; report: Report; expected?: string }> {
  const cases: Array<{ name: string; change?: (m: ModelInput) => void; expected?: string }> = [
    { name: 'smooth nonemissive organic shell is valid' },
    { name: 'untyped tissue is rejected', change: (m) => { m.parts[1].tissue = 0; }, expected: 'ORGANIC_TISSUE' },
    { name: 'metallic biological joint is rejected', change: (m) => { m.parts[1].metalness = 0.8; }, expected: 'ORGANIC_METAL' },
    { name: 'invalid tissue roughness is rejected', change: (m) => { m.parts[0].roughness = NaN; }, expected: 'ORGANIC_ROUGHNESS' },
    { name: 'rigid shell cannot use flexible channel', change: (m) => { m.parts[0].animType = 60; }, expected: 'ORGANIC_FLEX' },
    { name: 'dark unreadable tissue is rejected', change: (m) => { for (const p of m.parts) p.color = 0x020202; }, expected: 'ORGANIC_TOO_DARK' },
    { name: 'single tissue response is reported', change: (m) => { m.parts[1].tissue = 1; }, expected: 'ORGANIC_UNIFORM' },
    { name: 'organic floating tissue remains invalid', change: (m) => { for (let i = 1; i < m.parts[1].tris.length; i += 3) m.parts[1].tris[i] += 0.5; }, expected: 'FLOATING_PART' },
    { name: 'bounded secretory pulse is valid', change: (m) => { m.parts[1].tissue = 3; m.parts[1].animType = 60; } },
    { name: 'vertebrate fur pelage and avian plumage tissues are valid', change: (m) => { m.parts[0].tissue = 6; m.parts[1].tissue = 7; } },
    { name: 'out-of-range tissue id is rejected', change: (m) => { m.parts[0].tissue = 8; }, expected: 'ORGANIC_TISSUE' },
  ];
  return cases.map((c) => {
    const model = fixture();
    c.change?.(model);
    return { name: c.name, report: validateModel(model, { minParts: 2 }), expected: c.expected };
  });
}

function vertebrateFixtures(): Array<{ name: string; report: Report; expected?: string }> {
  const mammalBase = extractArchetype('fauna.crownStag');
  const birdBase = extractArchetype('fauna.bird.pineCrossbill');
  const cases: Array<{ name: string; base: ModelInput; change?: (m: ModelInput) => void; expected?: string }> = [
    { name: 'sculpted vertebrate mammal rig passes anatomy & motion sweep', base: mammalBase },
    { name: 'sculpted vertebrate bird rig passes wing & feather fan checks', base: birdBase },
    {
      name: 'under-detailed vertebrate rig (< 22 sub-parts) is rejected',
      base: mammalBase,
      change: (m) => { m.parts = m.parts.slice(0, 10); },
      expected: 'VERTEBRATE_DETAIL_RICHNESS',
    },
    {
      name: 'vertebrate part missing closed-form rig metadata is rejected',
      base: mammalBase,
      change: (m) => { m.parts[0].vertRig = undefined; },
      expected: 'VERTEBRATE_RIG_PARITY',
    },
    {
      name: 'mammal lacking articulated multi-role limbs or exposing mechanical joint fails',
      base: mammalBase,
      change: (m) => {
        for (const p of m.parts) {
          if (p.vertRig && (p.vertRig.role === 5 || p.vertRig.role === 6)) p.vertRig.role = 4;
        }
        m.parts[1].tissue = 2;
        m.parts[1].name = 'shoulder joint ball';
      },
      expected: 'VERTEBRATE_LIMB_ANATOMY',
    },
    {
      name: 'bird lacking separated primary feathers & fanned tail rectrices fails',
      base: birdBase,
      change: (m) => {
        for (const p of m.parts) {
          if (p.vertRig?.role === 8) p.vertRig.role = 7;
          if (p.vertRig?.role === 9) p.vertRig.role = 1;
        }
      },
      expected: 'VERTEBRATE_WING_ARTICULATION',
    },
    {
      name: 'oversized cartoon marble eye (>25% cranium width) is rejected',
      base: mammalBase,
      change: (m) => {
        const cranium = m.parts.find((p) => p.name.includes('cranium'))!;
        const eye = m.parts.find((p) => p.tissue === 5 && p.name.includes('eye'))!;
        const cw = cranium.tris.reduce((mx, v, i) => (i % 3 === 0 ? Math.max(mx, Math.abs(v)) : mx), 0.1);
        for (let i = 0; i < eye.tris.length; i += 3) {
          eye.tris[i] = i % 9 === 0 ? -cw : cw;
        }
      },
      expected: 'VERTEBRATE_EYE_PROPORTION',
    },
    {
      name: 'excessive non-emissive white coat albedo (>218) warns against HDR bloom',
      base: birdBase,
      change: (m) => { m.parts[0].color = 0xf4f8fc; },
      expected: 'VERTEBRATE_BLOOM_SAFE',
    },
  ];

  return cases.map((c) => {
    const model = cloneModel(c.base);
    c.change?.(model);
    return {
      name: c.name,
      report: validateModel(model, {
        minParts: c.expected === 'VERTEBRATE_DETAIL_RICHNESS' ? 1 : 22,
        grounded: c.base !== birdBase,
      }),
      expected: c.expected,
    };
  });
}

function vertebrateSleepAndFootFixtures(): Array<{ name: string; report: Report; expected?: string }> {
  const flamingo = extractArchetype('fauna.bird.coralFlamingo');
  const stag = extractArchetype('fauna.crownStag');
  const cases: Array<{ name: string; base: ModelInput; change?: (m: ModelInput) => void; expected?: string }> = [
    { name: 'wader bird rig anchors trailing feet and toes solidly into leg tips', base: flamingo },
    {
      name: 'under-anchored avian trailing foot/toes (< 1 cm overlap) are rejected',
      base: flamingo,
      change: (m) => {
        for (const p of m.parts) {
          if (!p.name.startsWith('trailing foot') && !p.name.includes('trailing ') || (!p.name.includes('foot') && !p.name.includes('toe'))) continue;
          for (let i = 2; i < p.tris.length; i += 3) p.tris[i] -= 0.025;
        }
      },
      expected: 'VERTEBRATE_FOOT_ANCHOR',
    },
    {
      name: 'grazing sliver avian toe (< 4 mm cross overlap) is rejected',
      base: flamingo,
      change: (m) => {
        for (const p of m.parts) {
          if (!p.name.includes('toe')) continue;
          for (let i = 0; i < p.tris.length; i += 3) p.tris[i] += p.name.includes('outer') ? 0.024 : -0.024;
        }
      },
      expected: 'VERTEBRATE_FOOT_ANCHOR',
    },
    {
      name: 'gapped/disconnected mammal elbow joint (< 6 mm ball-in-socket overlap) is rejected',
      base: stag,
      change: (m) => {
        for (const p of m.parts) {
          if (!p.name.includes('right fore forearm')) continue;
          for (let i = 1; i < p.tris.length; i += 3) p.tris[i] -= 0.05;
        }
      },
      expected: 'VERTEBRATE_LIMB_ANATOMY',
    },
    {
      name: 'quadruped sleep posture hovering off ground is rejected',
      base: stag,
      change: (m) => {
        for (const p of m.parts) if (p.vertConfig) p.vertConfig.sleepDrop *= 0.35;
      },
      expected: 'VERTEBRATE_SLEEP_POSTURE',
    },
    {
      name: 'quadruped sleep posture with horizontal lateral limb breakout is rejected',
      base: stag,
      change: (m) => {
        for (const p of m.parts) {
          if (p.vertRig && p.name.includes('left fore')) {
            p.vertRig.joint[0] -= 0.16;
            p.vertRig.tip[0] -= 0.16;
          }
        }
      },
      expected: 'VERTEBRATE_SLEEP_POSTURE',
    },
    {
      name: 'quadruped sleep posture with upward elbow spike is rejected',
      base: stag,
      change: (m) => {
        for (const p of m.parts) {
          if (p.vertRig && p.name.includes('right fore upper')) p.vertRig.tip[1] += 0.45;
        }
      },
      expected: 'VERTEBRATE_SLEEP_POSTURE',
    },
  ];
  return cases.map((c) => {
    const model = cloneModel(c.base);
    c.change?.(model);
    return {
      name: c.name,
      report: validateModel(model, { minParts: 22, grounded: c.base !== flamingo }),
      expected: c.expected,
    };
  });
}

function vertebrateTorsoFixtures(): Array<{ name: string; report: Report; expected?: string }> {
  const stag = extractArchetype('fauna.crownStag');
  const cases: Array<{ name: string; change: (m: ModelInput) => void; expected: string }> = [
    {
      name: 'uniform capsule mammal trunk lacking chest/waist/croup silhouette contrast is rejected',
      change: (m) => {
        const trunk = m.parts.find((p) => p.name.includes('trunk'))!;
        for (let i = 0; i < trunk.tris.length; i += 3) {
          const x = trunk.tris[i]!;
          const dy = trunk.tris[i + 1]! - 0.75;
          const r = Math.max(1e-4, Math.hypot(x, dy));
          trunk.tris[i] = (x / r) * 0.16;
          trunk.tris[i + 1] = 0.75 + (dy / r) * 0.16;
        }
      },
      expected: 'VERTEBRATE_TORSO_SILHOUETTE',
    },
    {
      name: 'single-tube mammal torso lacking 3D scapular/gluteal/pectoral muscle volumes is rejected',
      change: (m) => {
        m.parts = m.parts
          .filter(
            (p) => !p.name.includes('scapular shoulder') && !p.name.includes('gluteal haunch') && !p.name.includes('pectoral brisket'),
          )
          .map((p, index) => ({ ...p, index }));
      },
      expected: 'VERTEBRATE_TORSO_SILHOUETTE',
    },
  ];
  return cases.map((c) => {
    const model = cloneModel(stag);
    c.change(model);
    return {
      name: c.name,
      report: validateModel(model, { minParts: 22, grounded: true }),
      expected: c.expected,
    };
  });
}

/** Shared by the CLI validator self-test and Vitest. Every profile rule has positive and negative fixtures. */
export function organicValidatorFixtures(): Array<{ name: string; report: Report; expected?: string }> {
  return [...insectFixtures(), ...vertebrateFixtures(), ...vertebrateSleepAndFootFixtures(), ...vertebrateTorsoFixtures()];
}

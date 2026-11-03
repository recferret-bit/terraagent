#!/usr/bin/env node
// Proves the particle effect validator catches every defect code on synthetic presets,
// and verifies that all built-in presets in ParticlePresetRegistry pass cleanly.
//   node .agents/skills/particle-effect-validator/scripts/self-test.mjs
import { createServer } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const vite = await createServer({
  root: resolve(root, 'frontend'),
  configFile: resolve(root, 'frontend/vite.config.ts'),
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
});

try {
  const { validateParticlePreset, ParticlePresetRegistry } = await vite.ssrLoadModule('/render/particles/index.ts');

  const basePreset = () => ({
    id: 'test.clean',
    label: 'Clean Synthetic Preset',
    targetKind: 'rock',
    notes: 'Synthetic test fixture',
    toolBeam: {
      coreColor: 0xe0ffff,
      glowColor: 0x00e5ff,
      emissiveIntensity: 4.5,
      beamRadius: 0.035,
      sweepRadius: 0.25,
      sweepFreq: 6.0,
      pulseFreq: 16.0,
      ringColor: 0x00e5ff,
    },
    layers: [
      {
        name: 'granite shards',
        role: 'primary',
        geometry: 'rockShard',
        count: 42,
        color: 0x9aa4b2,
        roughness: 0.75,
        metalness: 0.15,
        emissiveIntensity: 0,
        sizeRange: [0.06, 0.14],
        speedRange: [1.0, 2.5],
        upwardBias: [1.5, 3.2],
        spreadCone: 1.0,
        gravity: 12.0,
        drag: 0.6,
        bounce: 0.45,
        spinSpeed: 8.0,
        lifetimeRange: [0.6, 1.2],
      },
      {
        name: 'dark basalt slabs',
        role: 'secondary',
        geometry: 'slateChunk',
        count: 23,
        color: 0x3b424d,
        roughness: 0.85,
        metalness: 0.2,
        emissiveIntensity: 0,
        sizeRange: [0.05, 0.12],
        speedRange: [0.8, 2.2],
        upwardBias: [1.2, 2.6],
        spreadCone: 0.95,
        gravity: 11.5,
        drag: 0.7,
        bounce: 0.35,
        spinSpeed: 7.0,
        lifetimeRange: [0.55, 1.1],
      },
      {
        name: 'plasma sparks',
        role: 'accent',
        geometry: 'weldSpark',
        count: 10,
        color: 0x66f7ff,
        roughness: 0.2,
        metalness: 0.1,
        emissiveIntensity: 4.8,
        sizeRange: [0.04, 0.09],
        speedRange: [2.0, 4.5],
        upwardBias: [1.8, 3.8],
        spreadCone: 0.85,
        gravity: 6.0,
        drag: 1.5,
        bounce: 0.3,
        spinSpeed: 12.0,
        lifetimeRange: [0.25, 0.55],
        stretchByVelocity: 2.5,
      },
    ],
  });

  const codes = (r) => r.issues.map((i) => i.code);
  const cases = [];
  const t = (name, mutate, expect) => cases.push({ name, mutate, expect });

  t('clean 3-layer 60/30/10 preset with contrast & ground bounce → 0 issues', () => {}, (r) => r.pass && codes(r).length === 0);

  t('preset with only 2 layers → FEW_LAYERS', (p) => {
    p.layers.pop();
  }, (r) => codes(r).includes('FEW_LAYERS') && codes(r).includes('MISSING_ROLE'));

  t('all layers using identical 3D geometry → FLAT_GEOMETRY_VARIETY', (p) => {
    for (const l of p.layers) l.geometry = 'rockShard';
  }, (r) => codes(r).includes('FLAT_GEOMETRY_VARIETY'));

  t('missing secondary role → MISSING_ROLE', (p) => {
    p.layers[1].role = 'primary';
  }, (r) => codes(r).includes('MISSING_ROLE'));

  t('skewed 20/70/10 role hierarchy → ROLE_RATIO_SKEW', (p) => {
    p.layers[0].count = 15;
    p.layers[1].count = 50;
    p.layers[2].count = 10;
  }, (r) => codes(r).includes('ROLE_RATIO_SKEW'));

  t('primary and secondary layers with nearly identical grey colour → LOW_LAYER_CONTRAST', (p) => {
    p.layers[0].color = 0x606670;
    p.layers[1].color = 0x596069;
  }, (r) => codes(r).includes('LOW_LAYER_CONTRAST'));

  t('accent layer with emissiveIntensity 1.2 (below bloom threshold) → EMISSIVE_TOO_LOW', (p) => {
    p.layers[2].emissiveIntensity = 1.2;
  }, (r) => codes(r).includes('EMISSIVE_TOO_LOW'));

  t('primary debris layer glowing at emissiveIntensity 2.5 → PRIMARY_EMISSIVE_BLOWOUT', (p) => {
    p.layers[0].emissiveIntensity = 2.5;
  }, (r) => codes(r).includes('PRIMARY_EMISSIVE_BLOWOUT'));

  t('zero ground bounce on heavy ballistic layers → NO_GROUND_BOUNCE', (p) => {
    p.layers[0].bounce = 0;
    p.layers[1].bounce = 0.02;
  }, (r) => codes(r).includes('NO_GROUND_BOUNCE'));

  t('zero ground bounce on low-gravity layers → NO_GROUND_BOUNCE', (p) => {
    p.layers[0].gravity = 2.0;
    p.layers[0].bounce = 0.05;
    p.layers[1].gravity = 2.5;
    p.layers[1].bounce = 0.1;
  }, (r) => codes(r).includes('NO_GROUND_BOUNCE'));

  t('inverted sizeRange or invalid bounce → PHYSICS_INVALID', (p) => {
    p.layers[1].sizeRange = [0.2, 0.05];
    p.layers[0].bounce = 1.5;
  }, (r) => codes(r).includes('PHYSICS_INVALID'));

  t('negative drag or non-positive toolBeam.beamRadius → PHYSICS_INVALID', (p) => {
    p.layers[0].drag = -0.5;
    p.toolBeam.beamRadius = 0;
  }, (r) => codes(r).filter((c) => c === 'PHYSICS_INVALID').length >= 2);

  t('excessive instance & triangle count → PARTICLE_BUDGET', (p) => {
    p.layers[0].count = 130;
    p.layers[1].count = 70;
    p.layers[2].count = 30;
  }, (r) => codes(r).includes('PARTICLE_BUDGET'));

  for (const preset of ParticlePresetRegistry.list()) {
    t(`built-in registry preset "${preset.id}" (${preset.targetKind}) passes with 0 errors and 0 warnings`, (p) => {
      Object.assign(p, preset);
    }, (r) => r.pass && r.errors === 0 && r.warnings === 0);
  }

  let fail = 0;
  for (const c of cases) {
    const p = basePreset();
    c.mutate(p);
    const r = validateParticlePreset(p);
    const ok = c.expect(r);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}${ok ? '' : `   → got [${codes(r).join(', ') || 'nothing'}]`}`);
    if (!ok) fail++;
  }
  console.log(`\n${cases.length - fail}/${cases.length} particle validator self-tests passed`);
  process.exitCode = fail ? 1 : 0;
} finally {
  await vite.close();
}

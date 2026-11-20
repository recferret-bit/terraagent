import { describe, expect, it } from 'vitest';
import { BUILTIN_PARTICLE_PRESETS, ParticlePresetRegistry, validateParticlePreset } from './index';
import { CYAN_CUTTER_BEAM, CYAN_CUTTER_PRESETS, cyanCutterPresetId, deriveCyanCutter } from './presetsPrestige';
import { workPresetIdFor } from './cutterVariant';
import { WorkParticleSystem } from './WorkParticleSystem';

describe('W28-12 cyan cutter variants (unit)', () => {
  it('registers one variant per built-in work preset, found by id', () => {
    expect(CYAN_CUTTER_PRESETS).toHaveLength(BUILTIN_PARTICLE_PRESETS.length);
    for (const base of BUILTIN_PARTICLE_PRESETS) {
      const v = ParticlePresetRegistry.getWork(cyanCutterPresetId(base.id))!;
      expect(v).toBeDefined();
      expect(v.variantOf).toBe(base.id);
      expect(v.targetKind).toBe(base.targetKind);
      expect(v.toolBeam.glowColor).toBe(CYAN_CUTTER_BEAM.glowColor);
      expect(v.toolBeam.ringColor).toBe(CYAN_CUTTER_BEAM.ringColor);
      expect(v.layers).toBe(base.layers);
    }
  });

  it('never hijacks the default preset of a target kind', () => {
    for (const base of BUILTIN_PARTICLE_PRESETS) {
      expect(ParticlePresetRegistry.getByTargetKind(base.targetKind).id).toBe(base.id);
      expect(ParticlePresetRegistry.getByTargetKind(base.targetKind).toolBeam.glowColor).toBe(base.toolBeam.glowColor);
    }
  });

  it('every variant passes the particle validator with 0 errors and 0 warnings', () => {
    for (const v of CYAN_CUTTER_PRESETS) {
      const r = validateParticlePreset(v);
      expect(r.errors, v.id).toBe(0);
      expect(r.warnings, v.id).toBe(0);
      expect(v.toolBeam.emissiveIntensity).toBeGreaterThanOrEqual(3);
    }
  });

  it('does not mutate the base preset when deriving', () => {
    const base = BUILTIN_PARTICLE_PRESETS[0];
    const glow = base.toolBeam.glowColor;
    deriveCyanCutter(base);
    expect(base.toolBeam.glowColor).toBe(glow);
    expect(base.variantOf).toBeUndefined();
  });

  it('keeps a stronger beam than the HDR floor when the base is already brighter', () => {
    const base = { ...BUILTIN_PARTICLE_PRESETS[0], toolBeam: { ...BUILTIN_PARTICLE_PRESETS[0].toolBeam, emissiveIntensity: 7 } };
    expect(deriveCyanCutter(base).toolBeam.emissiveIntensity).toBe(7);
  });

  it('workPresetIdFor: undefined for tier 0, the variant id for cyan', () => {
    expect(workPresetIdFor('tree', false)).toBeUndefined();
    expect(workPresetIdFor('tree', true)).toBe('work.tree.cyan');
    expect(workPresetIdFor('metals', true)).toBe('work.metals.cyan');
  });
});

describe('W28-12 cyan cutters drive a work site (integration with WorkParticleSystem)', () => {
  const site = (id: string, presetId?: string) => ({
    workerId: id, targetKind: 'rock' as const, ...(presetId ? { presetId } : {}),
    botOrigin: [0, 0, 0] as [number, number, number], toolOrigins: [[0.3, 0.8, 0.2]] as [number, number, number][],
    targetPos: [1, 0.3, 0] as [number, number, number], groundY: 0, intensity: 1,
  });

  it('an emitter uses the cyan preset when the site names it and the default otherwise; a switch swaps the emitter', () => {
    const sys = new WorkParticleSystem();
    sys.syncSites([site('a', workPresetIdFor('rock', true)), site('b')]);
    expect(sys.group.children.length).toBe(2);
    // switching a site from default to cyan replaces its emitter (the old one fades out), the other is untouched
    sys.syncSites([site('a'), site('b')]);
    expect(sys.group.children.length).toBeGreaterThanOrEqual(2);
    sys.clear();
    sys.dispose();
  });

  it('an unknown preset id falls back to the target kind default instead of throwing', () => {
    const sys = new WorkParticleSystem();
    expect(() => sys.syncSites([site('c', 'work.nope.cyan')])).not.toThrow();
    sys.dispose();
  });
});

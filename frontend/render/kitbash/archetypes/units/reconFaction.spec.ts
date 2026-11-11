import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_MATERIAL_ZONES } from '../../KitbashRegistry';
import { extractArchetype, validateArchetype } from '../../validate';
import { reconFactionPalette, setReconFactionPreview } from './reconFaction';
import '../../index';

afterEach(() => setReconFactionPreview(null));

describe('reconFactionPalette', () => {
  it('mercenary palette differs from the default hull', () => {
    const merc = reconFactionPalette('mercenary');
    const base = reconFactionPalette(null);
    expect(merc.id).toBe('mercenary');
    expect(merc.marks).toBe(true);
    expect(merc.zones.hullPrimary?.color).not.toBe(DEFAULT_MATERIAL_ZONES.hullPrimary.color);
    expect(base.marks).toBe(false);
    expect(base.zones).toEqual({});
  });

  it('unknown faction falls back to default', () => {
    expect(reconFactionPalette('pirate')).toEqual(reconFactionPalette(undefined));
    expect(reconFactionPalette('player')).toEqual(reconFactionPalette('default'));
  });

  it('missing query is default', () => {
    expect(reconFactionPalette(null)).toEqual(reconFactionPalette(undefined));
    expect(reconFactionPalette('')).toEqual(reconFactionPalette(undefined));
    expect(reconFactionPalette(undefined).id).toBe('default');
  });
});

describe('robot.recon mercenary build', () => {
  it('keeps the default mesh free of merc parts and valid', () => {
    setReconFactionPreview(null);
    const report = validateArchetype('robot.recon');
    expect(report.errors).toBe(0);
    expect(report.warnings).toBe(0);
    expect(report.minY).toBeCloseTo(0, 3);
    const model = extractArchetype('robot.recon');
    expect(model.parts.some((p) => p.name === 'merc emblem')).toBe(false);
    expect(model.parts.find((p) => p.name === 'body hull')?.color).toBe(DEFAULT_MATERIAL_ZONES.hullPrimary.color);
  });

  it('adds a grey-teal hull, emblem and emissive marker', () => {
    setReconFactionPreview('mercenary');
    const report = validateArchetype('robot.recon');
    expect(report.errors, report.issues.map((i) => `${i.severity} ${i.code} ${i.message}`).join('\n')).toBe(0);
    expect(report.warnings, report.issues.map((i) => `${i.severity} ${i.code} ${i.message}`).join('\n')).toBe(0);
    expect(report.minY).toBeCloseTo(0, 3);
    const model = extractArchetype('robot.recon');
    const hull = model.parts.find((p) => p.name === 'body hull');
    const marker = model.parts.find((p) => p.name === 'merc marker light');
    expect(model.parts.some((p) => p.name === 'merc emblem')).toBe(true);
    expect(hull?.color).toBe(reconFactionPalette('mercenary').zones.hullPrimary?.color);
    expect(marker?.zone).toBe('energyCyan');
    expect(marker?.emissive).toBeGreaterThanOrEqual(3);
  });
});

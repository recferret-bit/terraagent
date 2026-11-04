import { afterEach, describe, expect, it } from 'vitest';
import {
  ArchetypeCatalog,
  clearFaunaVisualOverrides,
  createArchetypeMesh,
  FAUNA_VISUAL_ROLES,
  FAUNA_VISUAL_SPECIES,
  registerFaunaVisualOverride,
  resolveFaunaArchetypeId,
} from './index';

describe('faunaVisualRegistry and W07 fauna/hive kitbash catalog', () => {
  afterEach(() => {
    clearFaunaVisualOverrides();
  });

  it('resolves shared W07 bug and hive archetype IDs across all planet types by default', () => {
    const planets = [undefined, 'dune', 'desert', 'ocean', 'oceanForest', 'forest', 'forestRock', 'temperate'];
    for (const planet of planets) {
      expect(resolveFaunaArchetypeId('blackAnt', 'bug', planet)).toBe('fauna.blackAnt');
      expect(resolveFaunaArchetypeId('blueBeetle', 'bug', planet)).toBe('fauna.blueBeetle');
      expect(resolveFaunaArchetypeId('greenSpitter', 'bug', planet)).toBe('fauna.greenSpitter');
      expect(resolveFaunaArchetypeId('blackAnt', 'hive', planet)).toBe('fauna.hive.blackAnt');
      expect(resolveFaunaArchetypeId('blueBeetle', 'hive', planet)).toBe('fauna.hive.blueBeetle');
      expect(resolveFaunaArchetypeId('greenSpitter', 'hive', planet)).toBe('fauna.hive.greenSpitter');
    }
  });

  it('supports planet-specific visual overrides and normalizes planet aliases', () => {
    registerFaunaVisualOverride('oceanForest', 'blueBeetle', 'bug', 'fauna.blueBeetle.ocean');
    registerFaunaVisualOverride('forestRock', 'greenSpitter', 'hive', 'fauna.hive.greenSpitter.forest');

    expect(resolveFaunaArchetypeId('blueBeetle', 'bug', 'ocean')).toBe('fauna.blueBeetle.ocean');
    expect(resolveFaunaArchetypeId('blueBeetle', 'bug', 'oceanForest')).toBe('fauna.blueBeetle.ocean');
    expect(resolveFaunaArchetypeId('blueBeetle', 'bug', 'dune')).toBe('fauna.blueBeetle');

    expect(resolveFaunaArchetypeId('greenSpitter', 'hive', 'forest')).toBe('fauna.hive.greenSpitter.forest');
    expect(resolveFaunaArchetypeId('greenSpitter', 'hive', 'temperate')).toBe('fauna.hive.greenSpitter.forest');
    expect(resolveFaunaArchetypeId('greenSpitter', 'hive', 'dune')).toBe('fauna.hive.greenSpitter');
  });

  it('builds all 6 fauna/hive archetypes and W07 combat archetypes within triangle and ground budgets', () => {
    for (const species of FAUNA_VISUAL_SPECIES) {
      for (const role of FAUNA_VISUAL_ROLES) {
        const id = resolveFaunaArchetypeId(species, role, 'dune');
        expect(ArchetypeCatalog.has(id)).toBe(true);
        const entry = ArchetypeCatalog.get(id);
        expect(entry.category).toBe('fauna');
        const mesh = createArchetypeMesh(id);
        const pos = mesh.geometry.getAttribute('position');
        const tris = pos.count / 3;
        expect(tris).toBeGreaterThan(200);
        expect(tris).toBeLessThan(3500);
        expect(Math.abs(mesh.geometry.boundingBox!.min.y)).toBeLessThanOrEqual(0.01);
      }
    }

    for (const id of ['robot.recon', 'unit.recon', 'building.laserTower']) {
      expect(ArchetypeCatalog.has(id)).toBe(true);
      const mesh = createArchetypeMesh(id);
      const pos = mesh.geometry.getAttribute('position');
      expect(pos.count / 3).toBeLessThan(3500);
    }
  });
});

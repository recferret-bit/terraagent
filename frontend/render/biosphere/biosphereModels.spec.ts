import { describe, expect, it } from 'vitest';
import { ArchetypeCatalog } from '../kitbash';
import { validateArchetype } from '../kitbash/validate';

describe('Biosphere 3D fauna model geometry & animation validation', () => {
  it('validates all 12 warm-blooded mammal archetypes with 0 errors and 0 warnings', () => {
    const mammals = ArchetypeCatalog.listBiosphere().filter((e) => !e.id.startsWith('fauna.bird.'));
    expect(mammals).toHaveLength(12);
    for (const entry of mammals) {
      const report = validateArchetype(entry.id);
      expect(report.errors, `${entry.id} had errors: ${JSON.stringify(report.issues)}`).toBe(0);
      expect(report.warnings, `${entry.id} had warnings: ${JSON.stringify(report.issues)}`).toBe(0);
      expect(report.triCount).toBeLessThan(3500);
      expect(report.partCount).toBeGreaterThanOrEqual(7);
    }
  }, 20_000);

  it('validates all 15 avian bird archetypes with 0 errors and 0 warnings', () => {
    const birds = ArchetypeCatalog.listBiosphere().filter((e) => e.id.startsWith('fauna.bird.'));
    expect(birds).toHaveLength(15);
    for (const entry of birds) {
      const report = validateArchetype(entry.id);
      expect(report.errors, `${entry.id} had errors: ${JSON.stringify(report.issues)}`).toBe(0);
      expect(report.warnings, `${entry.id} had warnings: ${JSON.stringify(report.issues)}`).toBe(0);
      expect(report.triCount).toBeLessThan(3500);
      expect(report.partCount).toBeGreaterThanOrEqual(7);
    }
  }, 20_000);
});

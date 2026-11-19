import { describe, expect, it } from 'vitest';
import { ArchetypeCatalog } from '../kitbash';
import { validateArchetype } from '../kitbash/validate';

describe('Biosphere 3D fauna model geometry & animation validation', () => {
  const biosphere = ArchetypeCatalog.listBiosphere();
  const mammals = biosphere.filter((e) => !e.id.startsWith('fauna.bird.'));
  const birds = biosphere.filter((e) => e.id.startsWith('fauna.bird.'));

  it('registers all 12 warm-blooded mammals and 15 avian birds', () => {
    expect(mammals).toHaveLength(12);
    expect(birds).toHaveLength(15);
  });

  it.each(mammals.map((e) => e.id))(
    'validates warm-blooded mammal %s with 0 errors and 0 warnings',
    (id) => {
      const report = validateArchetype(id);
      expect(report.errors, `${id} had errors: ${JSON.stringify(report.issues)}`).toBe(0);
      expect(report.warnings, `${id} had warnings: ${JSON.stringify(report.issues)}`).toBe(0);
      expect(report.triCount).toBeLessThan(3500);
      expect(report.partCount).toBeGreaterThanOrEqual(7);
    },
    20_000,
  );

  it.each(birds.map((e) => e.id))(
    'validates avian bird %s with 0 errors and 0 warnings',
    (id) => {
      const report = validateArchetype(id);
      expect(report.errors, `${id} had errors: ${JSON.stringify(report.issues)}`).toBe(0);
      expect(report.warnings, `${id} had warnings: ${JSON.stringify(report.issues)}`).toBe(0);
      expect(report.triCount).toBeLessThan(3500);
      expect(report.partCount).toBeGreaterThanOrEqual(7);
    },
    20_000,
  );
});

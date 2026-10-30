import { afterEach, describe, expect, it } from 'vitest';
import { clearMigrations, createState, decodeValue, encodeValue, registerMigration, restore, SIM_VERSION, snapshot, entityColumns } from '../../src';

const mk = () => createState({ planetId: 'pl_m', planetType: 'desert', seed: 's', radius: 3 });
const asVersion = (v: number) => {
  const d = decodeValue(snapshot(mk())) as { header: { simVersion: number } };
  d.header.simVersion = v;
  return encodeValue(d);
};
afterEach(clearMigrations);

describe('migrations and envelope', () => {
  it('equal version is a no-op', () => { expect(restore(snapshot(mk()))).toEqual(mk()); });
  it('migrates an older snapshot (test-only migration)', () => {
    registerMigration(SIM_VERSION - 1, SIM_VERSION, (s) => { s.state.migrated = true; return s; });
    const r = restore(asVersion(SIM_VERSION - 1)) as unknown as { migrated: boolean; meta: { simVersion: number } };
    expect(r.migrated).toBe(true);
    expect(r.meta.simVersion).toBe(SIM_VERSION);
  });
  it('chains migrations', () => {
    registerMigration(-2, -1, (s) => { s.state.a = 1; return s; });
    registerMigration(-1, SIM_VERSION, (s) => { s.state.b = 2; return s; });
    const r = restore(asVersion(-2)) as unknown as { a: number; b: number };
    expect([r.a, r.b]).toEqual([1, 2]);
  });
  it('refuses without a path or for newer snapshots', () => {
    expect(() => restore(asVersion(SIM_VERSION - 1))).toThrow(/no migration path/);
    expect(() => restore(asVersion(SIM_VERSION + 1))).toThrow(/newer than engine/);
  });
  it('keeps unknown columns and zero-fills missing ones', () => {
    const d = decodeValue(snapshot(mk())) as { state: ReturnType<typeof mk> };
    (d.state.entities.cols as Record<string, unknown>).fromFuture = new Uint16Array(64).fill(7);
    delete (d.state.entities.cols as Record<string, unknown>).progress;
    delete (d.state.grid.layers as Record<string, unknown>).height;
    const r = restore(encodeValue(d));
    expect((r.entities.cols as Record<string, unknown>).fromFuture).toEqual(new Uint16Array(64).fill(7));
    expect(r.entities.cols.progress).toEqual(new Float32Array(64));
    expect(r.grid.layers.height).toEqual(new Float32Array(r.grid.count));
    expect(entityColumns().length).toBeGreaterThan(0);
  });
  it('radius-56 empty planet snapshot is well under 1 MB raw', () => {
    const bytes = snapshot(createState({ planetId: 'pl_big', planetType: 'ocean', seed: 'big', radius: 56 }));
    console.log(`radius 56 empty snapshot: ${bytes.length} bytes`);
    expect(bytes.length).toBeLessThan(1_000_000);
  });
});

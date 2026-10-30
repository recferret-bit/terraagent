import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RepositoryBase, withTransaction, type DbClient } from '../src';
import { createTestDatabase, databaseExists, type TestDatabase } from '../src/testing';

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

class NotesRepo extends RepositoryBase {
  async add(body: string, tx?: DbClient) {
    await this.db(tx).$executeRawUnsafe(`INSERT INTO core_scratch (body) VALUES ($1)`, body);
  }
  async all(tx?: DbClient) {
    return (await this.db(tx).$queryRawUnsafe<{ body: string }[]>(`SELECT body FROM core_scratch ORDER BY id`)).map((r) => r.body);
  }
  addTwo(a: string, b: string, tx?: DbClient) {
    return this.tx(async (t) => {
      await this.add(a, t);
      await this.add(b, t);
    }, tx);
  }
}

describe('test database harness', () => {
  it('creates and migrates a fresh database', async () => {
    console.log(`[test-db] using ${db.name}`);
    expect(db.name).toMatch(/^terra_test_[0-9a-f]{12}$/);
    expect(await databaseExists(db.name)).toBe(true);
    const schemas = await db.prisma.$queryRaw<{ schema_name: string }[]>`
      SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('core','world','ai','chain') ORDER BY 1`;
    expect(schemas.map((s) => s.schema_name)).toEqual(['ai', 'chain', 'core', 'world']);
    const migrations = await db.prisma.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
      SELECT migration_name, finished_at FROM public._prisma_migrations ORDER BY migration_name`;
    expect(migrations.map((m) => m.migration_name)).toContain('0001_init');
    expect(migrations.every((m) => m.finished_at)).toBe(true);
  });

  it('uses it: commit inside tx(), roll back on throw, compose via a passed transaction', async () => {
    await db.prisma.$executeRawUnsafe(`CREATE TABLE core_scratch (id serial PRIMARY KEY, body text NOT NULL)`);
    const repo = new NotesRepo(db.prisma);
    await repo.addTwo('a', 'b');
    expect(await repo.all()).toEqual(['a', 'b']);

    await expect(
      withTransaction(db.prisma, async (tx) => {
        await repo.addTwo('c', 'd', tx);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await repo.all()).toEqual(['a', 'b']);

    await withTransaction(db.prisma, async (tx) => {
      await repo.add('e', tx);
      expect(await repo.all(tx)).toEqual(['a', 'b', 'e']);
    });
    expect(await repo.all()).toEqual(['a', 'b', 'e']);
  });

  it('drops the database', async () => {
    const throwaway = await createTestDatabase();
    expect(await databaseExists(throwaway.name)).toBe(true);
    await throwaway.drop();
    expect(await databaseExists(throwaway.name)).toBe(false);
    await throwaway.drop();
  });
});

import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@terra/db';
import { aliasDevPlayer } from '../../src/profile/me-dev-alias';
import { devPlayerId } from '../../src/ws/session-verifier';

const dev = (name: string) => ({ id: `pr_dev_${name}`, handle: name, isGuest: true });

function prismaWith(rows: string[], fail = false): PrismaClient {
  return {
    player: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (fail) throw new Error('db down');
        return rows.includes(where.id) ? { id: where.id } : null;
      },
    },
  } as unknown as PrismaClient;
}

describe('W28 /me dev identity bridge (aliasDevPlayer)', () => {
  it('follows the game session player when only devPlayerId(name) has a row (positive)', async () => {
    const out = await aliasDevPlayer(dev('w28'), prismaWith([devPlayerId('w28')]), false);
    expect(out.id).toBe(devPlayerId('w28'));
    expect(out.handle).toBe('w28');
  });

  it('keeps pr_dev_<name> when that player has its own row, in production, or for fixture ids (negative)', async () => {
    expect((await aliasDevPlayer(dev('w28'), prismaWith(['pr_dev_w28', devPlayerId('w28')]), false)).id).toBe('pr_dev_w28');
    expect((await aliasDevPlayer(dev('w28'), prismaWith([devPlayerId('w28')]), true)).id).toBe('pr_dev_w28');
    expect((await aliasDevPlayer(dev('w12'), prismaWith([devPlayerId('w12')]), false)).id).toBe('pr_dev_w12');
    const real = { id: 'pr_REALPLAYER0000000000000000', handle: 'real', isGuest: false };
    expect(await aliasDevPlayer(real, prismaWith([]), false)).toBe(real);
  });

  it('degrades to the literal id when neither player exists, the DB throws or there is no DB (corner)', async () => {
    expect((await aliasDevPlayer(dev('ghost'), prismaWith([]), false)).id).toBe('pr_dev_ghost');
    expect((await aliasDevPlayer(dev('w28'), prismaWith([devPlayerId('w28')], true), false)).id).toBe('pr_dev_w28');
    expect((await aliasDevPlayer(dev('w28'), undefined, false)).id).toBe('pr_dev_w28');
  });
});

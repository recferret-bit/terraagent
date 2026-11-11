import { describe, expect, it } from 'vitest';
import type { DbClient } from '@terra/db';
import type { FlagsService } from '../../src/flags/flags.service.js';
import { GuildProvisionError } from '../../src/market/guild/guild-error.js';
import type { GuildNpcRepository } from '../../src/market/guild/guild-npc.repository.js';
import {
  allocationId,
  quoteAtomic,
  withCargo,
  YOCTO_PER_NEAR,
  loadPolicy,
  publicKeyOf,
  type GuildAllocation,
  type GuildDraft,
  type GuildPolicy,
  type RosterNpc,
} from '../../src/market/guild/guild-plan.js';
import { GuildProvisionService } from '../../src/market/guild/guild-provision.service.js';
import type { GuildTradeKeyBinder } from '../../src/market/guild/guild-trade-key.binder.js';
import type { GuildWalletBinder } from '../../src/market/guild/guild-wallet.binder.js';

const on = { has: (wave: string) => wave === 'W15' } as unknown as FlagsService;
const off = { has: () => false } as unknown as FlagsService;

class MemStore {
  rows: GuildAllocation[] = [];
  reads = 0;
  async find(id: string): Promise<GuildAllocation | null> {
    this.reads += 1;
    return this.rows.find((row) => row.npcId === id) ?? null;
  }
  async list(): Promise<GuildAllocation[]> {
    this.reads += 1;
    return [...this.rows];
  }
  async allocatedAtomic(): Promise<bigint> {
    const rows = await this.list();
    return rows.reduce((sum, row) => sum + BigInt(row.quoteBudgetAtomic), 0n);
  }
  withLock<T>(_id: string, fn: (db: DbClient) => Promise<T>): Promise<T> {
    return fn({} as DbClient);
  }
  async insert(draft: GuildDraft): Promise<GuildAllocation> {
    const row: GuildAllocation = {
      npcId: draft.npc.id, accountId: draft.npc.accountId, allocationId: allocationId(draft.policyVersion, draft.npc.id),
      quoteBudgetAtomic: draft.quoteBudgetAtomic, spendAtomic: '0', lossAtomic: '0', tradeKeyId: draft.tradeKeyId,
      publicKey: draft.publicKey, cargoLabel: 'fixture', quoteLabel: 'subsidy', cashEnabled: 0, actorKind: 'npc',
      inventory: draft.inventory, policyVersion: draft.policyVersion,
    };
    this.rows.push(row);
    return row;
  }
  async appendFixture(id: string, resource: string, amount: number): Promise<GuildAllocation> {
    const row = this.rows.find((item) => item.npcId === id);
    if (!row) throw new GuildProvisionError('not_provisioned', id);
    const updated = { ...row, inventory: withCargo(row.inventory, resource, amount) };
    this.rows = this.rows.map((item) => (item.npcId === id ? updated : item));
    return updated;
  }
}

class MemWallet {
  accounts = 0;
  keys = 0;
  async ensureAccount(npc: RosterNpc): Promise<string> {
    this.accounts += 1;
    return npc.accountId;
  }
  async ensureKey(npc: RosterNpc): Promise<string> {
    this.keys += 1;
    return publicKeyOf(npc.id);
  }
}

class MemKeys {
  n = 0;
  async ensure(npc: RosterNpc): Promise<string> {
    this.n += 1;
    return `key_${npc.id}`;
  }
}

function service(flags: FlagsService, store = new MemStore(), wallet = new MemWallet(), keys = new MemKeys()) {
  const svc = new GuildProvisionService(
    flags,
    store as unknown as GuildNpcRepository,
    wallet as unknown as GuildWalletBinder,
    keys as unknown as GuildTradeKeyBinder,
  );
  return { svc, store, wallet, keys };
}

describe('Guild provisioning (W15-05)', () => {
  it('boots once per NPC and a second call returns the same allocation', async () => {
    const { svc, wallet, keys } = service(on);
    const first = await svc.provision();
    const second = await svc.provision();
    expect(first.map((row) => row.npcId).sort()).toEqual(['kestrel', 'vanguard']);
    expect(second).toEqual(first);
    expect(first.map((row) => row.allocationId).sort()).toEqual([
      'guild-alloc:guild-mock-1:kestrel',
      'guild-alloc:guild-mock-1:vanguard',
    ]);
    expect(first.every((row) => row.cargoLabel === 'fixture' && row.quoteLabel === 'subsidy' && row.cashEnabled === 0 && row.actorKind === 'npc')).toBe(true);
    expect(first.every((row) => row.inventory.lines.length === 0 && row.spendAtomic === '0' && row.lossAtomic === '0')).toBe(true);
    expect(first.reduce((sum, row) => sum + BigInt(row.quoteBudgetAtomic), 0n)).toBe(10n * YOCTO_PER_NEAR);
    expect(wallet.accounts).toBe(2);
    expect(wallet.keys).toBe(2);
    expect(keys.n).toBe(2);
  });

  it('keeps spend and loss when the stored row is read again', async () => {
    const { svc, store } = service(on);
    await svc.provision();
    store.rows = store.rows.map((row) => (row.npcId === 'kestrel' ? { ...row, spendAtomic: '9', lossAtomic: '4' } : row));
    const again = await svc.provision();
    expect(again.find((row) => row.npcId === 'kestrel')).toMatchObject({ spendAtomic: '9', lossAtomic: '4', allocationId: 'guild-alloc:guild-mock-1:kestrel' });
  });

  it('a refill attempt does not increase the allocation', async () => {
    const { svc, wallet } = service(on);
    const [kestrel] = await svc.provision();
    const extra = (BigInt(kestrel!.quoteBudgetAtomic) + 1n).toString();
    const after = await svc.refill('kestrel', extra);
    expect(after).toEqual(kestrel);
    expect(wallet.accounts).toBe(2);
  });

  it('W15 off skips writes', async () => {
    const { svc, store, wallet } = service(off);
    expect(await svc.provision()).toEqual([]);
    expect(await svc.ensureNpc('kestrel')).toBeNull();
    expect(await svc.refill('kestrel', '1')).toBeNull();
    expect(await svc.allocateFixtureCargo('kestrel', 'metals.t1', 5)).toBeNull();
    expect(store.rows).toEqual([]);
    expect(store.reads).toBe(0);
    expect(wallet.accounts).toBe(0);
  });

  it('rejects an unknown npc id', async () => {
    const { svc, store } = service(on);
    await expect(svc.ensureNpc('osprey')).rejects.toMatchObject({ errorCode: 'unknown_npc' });
    await expect(svc.refill('osprey', '1')).rejects.toMatchObject({ errorCode: 'unknown_npc' });
    expect(store.rows).toEqual([]);
  });

  it('allocation amount 0 does not create cargo, and a positive grant is a fixture line', async () => {
    const { svc } = service(on);
    await svc.provision();
    const zero = await svc.allocateFixtureCargo('kestrel', 'metals.t1', 0);
    expect(zero!.inventory.lines).toEqual([]);
    const granted = await svc.allocateFixtureCargo('kestrel', 'bio.water', 4);
    expect(granted!.inventory.lines).toEqual([{ resource: 'bio.water', amount: 4, label: 'fixture', organic: false, source: 'mock-grant' }]);
    const again = await svc.allocateFixtureCargo('kestrel', 'bio.water', 0);
    expect(again!.inventory.lines).toHaveLength(1);
    await expect(svc.allocateFixtureCargo('kestrel', 'metals.t1', -1)).rejects.toMatchObject({ errorCode: 'bad_amount' });
    await expect(svc.allocateFixtureCargo('kestrel', 'metals.t2', 1)).rejects.toMatchObject({ errorCode: 'bad_amount' });
  });

  it('quote budget is zero when the global float is already used', () => {
    const policy: GuildPolicy = loadPolicy(() => true);
    expect(quoteAtomic(policy, 0n)).toBe(5n * YOCTO_PER_NEAR);
    expect(quoteAtomic(policy, 6n * YOCTO_PER_NEAR)).toBe(4n * YOCTO_PER_NEAR);
    expect(quoteAtomic(policy, 10n * YOCTO_PER_NEAR)).toBe(0n);
  });
});

import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import type { FlagsService } from '../../src/flags/flags.service.js';
import type { AgentWalletPort, KeyStatus } from '../../src/near/application/ports/agent-wallet.port.js';
import { replacedTokenCaps } from '../../src/near/director-key/director-key.allowance.js';
import type { DirectorKeyRepository, DirectorKeyRow, OwnedColony } from '../../src/near/director-key/director-key.repository.js';
import { DirectorKeyService } from '../../src/near/director-key/director-key.service.js';

const COLONY: OwnedColony = { colonyId: 'co_1', playerId: 'p', planetId: 'pl_dev', colonyIndex: 0 };
const EXISTING: DirectorKeyRow = {
  colonyId: 'co_1', accountId: 'co.dir.terraagent.mock', publicKey: 'ed25519:d:co_1:1', revokedAt: null,
};
const on = { has: (wave: string) => wave === 'W15' } as unknown as FlagsService;
const off = { has: () => false } as unknown as FlagsService;

describe('director.allowance replaces the key (W15-28)', () => {
  it('revokes the old key and adds one whose metals.t1 allowance is the new amount', async () => {
    const wallet = new MemWallet();
    const saved: { allowance?: string; publicKey?: string; revokedAt?: Date | null } = {};
    const repo = {
      locate: async () => COLONY,
      find: async () => EXISTING,
      save: async (row: { allowance: string; publicKey: string; revokedAt: Date | null }) => {
        saved.allowance = row.allowance;
        saved.publicKey = row.publicKey;
        saved.revokedAt = row.revokedAt;
      },
    };
    const svc = new DirectorKeyService(on, wallet.asPort(), repo as unknown as DirectorKeyRepository, new EventBus());
    const out = await svc.setDevAllowance('co_1', 'metals.t1', 600);
    expect(wallet.revoked).toEqual(['ed25519:d:co_1:1']);
    expect(wallet.added[0]).toMatchObject({
      publicKey: 'ed25519:d:co_1:2',
      tokens: [
        { token: 'metals.t1', allowance: '600' },
        { token: 'minerals.t1', allowance: '50' },
      ],
    });
    expect(out).toMatchObject({ allowance: '600', spent: '0', publicKey: 'ed25519:d:co_1:2', replaced: true });
    expect(saved).toMatchObject({ allowance: '600', publicKey: 'ed25519:d:co_1:2', revokedAt: null });
  });

  it('W15 off and a missing key do not add a key', async () => {
    const wallet = new MemWallet();
    const missing = { locate: async () => COLONY, find: async () => null, save: async () => undefined };
    const svc = new DirectorKeyService(on, wallet.asPort(), missing as unknown as DirectorKeyRepository, new EventBus());
    await expect(svc.setDevAllowance('co_1', 'metals.t1', 1)).rejects.toMatchObject({ errorCode: 'director_key_missing' });
    const disabled = new DirectorKeyService(off, wallet.asPort(), missing as unknown as DirectorKeyRepository, new EventBus());
    await expect(disabled.setDevAllowance('co_1', 'metals.t1', 1)).rejects.toMatchObject({ errorCode: 'wave_disabled' });
    expect(wallet.added).toHaveLength(0);
    expect(replacedTokenCaps([{ token: 'minerals.t1', allowance: '50' }], 'metals.t1', 600)).toEqual([
      { token: 'minerals.t1', allowance: '50' },
      { token: 'metals.t1', allowance: '600' },
    ]);
  });
});

class MemWallet {
  readonly revoked: string[] = [];
  readonly added: { publicKey: string; tokens?: readonly { token: string; allowance: string }[] }[] = [];

  revokeKey(input: { publicKey: string }): Promise<{ txHash: string }> {
    this.revoked.push(input.publicKey);
    return Promise.resolve({ txHash: 'mock:revoke' });
  }

  addLimitedKey(input: { publicKey: string; tokens?: readonly { token: string; allowance: string }[] }): Promise<{ txHash: string }> {
    this.added.push(input);
    return Promise.resolve({ txHash: 'mock:add' });
  }

  asPort(): AgentWalletPort {
    return this as unknown as AgentWalletPort;
  }

  keyStatus(input: { accountId: string; publicKey: string }): Promise<KeyStatus> {
    const added = this.added.find((row) => row.publicKey === input.publicKey);
    const tokens = (added?.tokens ?? [
      { token: 'metals.t1', allowance: '100' },
      { token: 'minerals.t1', allowance: '50' },
    ]).map((row) => ({ token: row.token, allowance: row.allowance, reserved: '0', spent: '0', available: row.allowance }));
    return Promise.resolve({
      accountId: input.accountId,
      publicKey: input.publicKey,
      revoked: false,
      receiverId: 'intents.near',
      methodNames: ['execute_intents'],
      tokens,
      gasAllowance: '0',
      gasSpent: '0',
    });
  }
}


import 'reflect-metadata';
import { MARKET_TOKENS, toChainUnits } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TestnetIntentsAdapter } from '../../src/near/infrastructure/adapters/real/testnet-intents.adapter.js';
import { loadKekRing } from '../../src/near/keystore/kek.js';
import { KeyStore } from '../../src/near/keystore/keys.js';

/** `TestnetIntentsAdapter` on a real Postgres ledger with the verifier path on and a fake chain RPC injected. */
let db: TestDatabase;
const WATER = MARKET_TOKENS['bio.water'].verifierId;
const USDC = MARKET_TOKENS.USDC.verifierId;
const w = (n: number) => toChainUnits('bio.water', String(n));
const FUTURE = Date.now() + 3_600_000;
const VERIFIER = 'verifier.terraagent.testnet';
let n = 0;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

async function colony(name: string, water: bigint, usdc: bigint): Promise<void> {
  const g = new KeyStore(loadKekRing({ NODE_ENV: 'test' })).generate();
  n += 1;
  await db.prisma.mockChainAccount.create({ data: { accountId: name, kind: 'named' } });
  await db.prisma.$executeRaw`INSERT INTO chain.near_colony_account (account_id, player_id, slot, owner_account_id, public_key, encrypted_secret, kek_version)
    VALUES (${name}, ${'vp' + n}, 'colony-1', 'owner.mock', ${g.row.publicKey}, ${g.row.encryptedSecret}, ${g.row.kekVersion})`;
  await db.prisma.$executeRaw`INSERT INTO chain.mock_chain_intents_balance (account_id, token_id, amount) VALUES (${name}, ${WATER}, ${water.toString()}::numeric), (${name}, ${USDC}, ${usdc.toString()}::numeric)`;
}

interface FakeChain {
  registered: Set<string>;
  balances: Map<string, string>;
  calls: string[];
  down: boolean;
}

function adapterWithFakeChain(chain: FakeChain): TestnetIntentsAdapter {
  const ix = new TestnetIntentsAdapter(
    {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://x',
      NEAR_MODE: 'testnet',
      NEAR_CONTRACT_VERIFIER: VERIFIER,
      NEAR_MINTER_SECRET_KEY: 'ed25519:3D4YudUQRE39Lc4JHghuB5WM8kbgDDa2s5QnMzgNhGeqCMdoSzQk1ceDUZCXjFPNs6XNMeqzfXWuEdgV4tkv1CDG',
    } as never,
    db.prisma as never,
  );
  const fake = {
    config: (ix as unknown as { rpc: { config: unknown } }).rpc.config,
    network: 'testnet',
    view: vi.fn(async (_c: string, m: string, a: Record<string, string> = {}) => {
      if (chain.down) throw new TypeError('fetch failed');
      if (m === 'has_public_key') return chain.registered.has(`${a.account_id}|${a.public_key}`);
      if (m === 'balance_of') return chain.balances.get(`${a.account_id}|${a.token_id}`) ?? '0';
      throw new Error(`unexpected view ${m}`);
    }),
    call: vi.fn(async (p: { methodName: string; args: Record<string, string> }) => {
      chain.calls.push(p.methodName);
      if (p.methodName === 'register_account_key') chain.registered.add(`${p.args.account_id}|${p.args.public_key}`);
      return { receipt: { txHash: `chain-${p.methodName}`, network: 'testnet' } };
    }),
  };
  (ix as unknown as { rpc: unknown }).rpc = fake;
  return ix;
}

const newChain = (): FakeChain => ({ registered: new Set(), balances: new Map(), calls: [], down: false });

async function swap(ix: TestnetIntentsAdapter, seller: string, buyer: string) {
  return [
    await ix.signTokenDiff({ accountId: seller, deltas: { [WATER]: (-w(10)).toString(), [USDC]: '500' }, deadlineMs: FUTURE }),
    await ix.signTokenDiff({ accountId: buyer, deltas: { [WATER]: w(10).toString(), [USDC]: '-500' }, deadlineMs: FUTURE }),
  ];
}

describe('TestnetIntentsAdapter verifier settlement (W28-14)', () => {
  it('syncs both signer keys, verifies strict balances, then settles on the verifier and in the ledger', async () => {
    const chain = newChain();
    await colony('vs-seller.mock', w(100), 0n);
    await colony('vs-buyer.mock', 0n, 1000n);
    chain.balances.set(`vs-seller.mock|${WATER}`, w(10).toString());
    chain.balances.set(`vs-buyer.mock|${USDC}`, '500');
    const ix = adapterWithFakeChain(chain);
    const intents = await swap(ix, 'vs-seller.mock', 'vs-buyer.mock');
    const r = await ix.execute({ opId: 'vs-ok', intents });
    expect(r.txHash).toBe('chain-execute_intents');
    expect(chain.calls).toEqual(['register_account_key', 'register_account_key', 'execute_intents']);
    const rows = await db.prisma.mockChainIntentsBalance.findMany({ where: { accountId: 'vs-seller.mock', tokenId: USDC } });
    expect(rows[0]!.amount.toFixed()).toBe('500');
  });

  it('insufficient on-chain balance: typed error, nothing settles in the ledger or on-chain (strict_balances)', async () => {
    const chain = newChain();
    await colony('vs-seller2.mock', w(100), 0n);
    await colony('vs-buyer2.mock', 0n, 1000n);
    chain.balances.set(`vs-seller2.mock|${WATER}`, (w(10) - 1n).toString());
    chain.balances.set(`vs-buyer2.mock|${USDC}`, '500');
    const ix = adapterWithFakeChain(chain);
    const intents = await swap(ix, 'vs-seller2.mock', 'vs-buyer2.mock');
    await expect(ix.execute({ opId: 'vs-short', intents })).rejects.toMatchObject({ code: 'insufficient_onchain_balance' });
    expect(chain.calls).not.toContain('execute_intents');
    const rows = await db.prisma.mockChainIntentsBalance.findMany({ where: { accountId: 'vs-seller2.mock', tokenId: USDC } });
    expect(rows[0]!.amount.toFixed()).toBe('0');
    expect(await db.prisma.mockChainIntent.count({ where: { signer: 'vs-seller2.mock', status: 'executed' } })).toBe(0);
  });

  it('RPC down: key_not_registered (cause rpc_unreachable) surfaces, no silent mock fallback, and the ledger is untouched', async () => {
    const chain = newChain();
    await colony('vs-seller3.mock', w(100), 0n);
    await colony('vs-buyer3.mock', 0n, 1000n);
    const ix = adapterWithFakeChain(chain);
    const intents = await swap(ix, 'vs-seller3.mock', 'vs-buyer3.mock');
    chain.down = true;
    const err = await ix.execute({ opId: 'vs-down', intents }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'key_not_registered' });
    expect((err as { cause: { code: string } }).cause.code).toBe('rpc_unreachable');
    expect(await db.prisma.mockChainIntent.count({ where: { signer: 'vs-seller3.mock', status: 'executed' } })).toBe(0);
  });

  it('syncVerifierKeys on the adapter is idempotent and skips already-registered keys', async () => {
    const chain = newChain();
    const ix = adapterWithFakeChain(chain);
    const keys = [
      { accountId: 'bot-7.mock', publicKey: 'ed25519:k1', role: 'bot' as const },
      { accountId: 'pilot-7.testnet', publicKey: 'ed25519:k2', role: 'pilot' as const },
    ];
    expect((await ix.syncVerifierKeys(keys)).registered).toHaveLength(2);
    const again = await ix.syncVerifierKeys(keys);
    expect(again.registered).toHaveLength(0);
    expect(again.skipped).toHaveLength(2);
    expect(again.allKeysOnchain).toBe(true);
  });
});

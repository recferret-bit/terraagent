import { randomBytes } from 'node:crypto';
import { tokenKeyOfVerifierId, type MarketTokenKey } from '@terra/contracts';
import {
  IntentsPort,
  type IntentsDepositInput,
  type IntentsExecuteInput,
  type IntentsSimulation,
  type IntentsWithdrawInput,
  type SignedIntent,
  type SignTokenDiffInput,
} from '../application/ports/intents.port';
import { NearException } from '../domain/errors';
import type { ChainReceipt } from '../domain/types';
import { signTokenDiffPayload } from '../intents/nep413-token-diff';
import { DEV_KEK, DEV_KEK_VERSION, KekRing } from '../keystore/kek';
import { ed25519PrivateKeyFromSeed, KeyStore } from '../keystore/keys';
import { InMemoryChain } from './in-memory-chain';

const NOT_YET = 'not implemented until W13-05';

/**
 * In-memory `IntentsPort` for unit tests (NEAR §1a rule 8). Amounts are chain base units. `own` is the account's own balance
 * (stand-in for the cargo / USDC / NEAR mock ledger) seeded with `fund`; `verifier` is the intents ledger.
 */
export class InMemoryIntents extends IntentsPort {
  private readonly own = new Map<string, bigint>();
  private readonly verifier = new Map<string, bigint>();
  private readonly keys = new Map<string, { seed: Buffer; publicKey: string }>();

  constructor(private readonly chain: InMemoryChain = new InMemoryChain()) {
    super();
  }

  fund(accountId: string, key: MarketTokenKey, atomic: bigint): void {
    this.add(this.own, accountId, key, atomic);
  }

  ownBalance(accountId: string, key: MarketTokenKey): bigint {
    return this.own.get(slot(accountId, key)) ?? 0n;
  }

  verifierBalance(accountId: string, verifierId: string): bigint {
    return this.verifier.get(slot(accountId, verifierId)) ?? 0n;
  }

  async deposit(input: IntentsDepositInput): Promise<ChainReceipt> {
    const { key, amount } = parse(input.tokenId, input.amount);
    return this.chain.write(input.opId, () => {
      this.sub(this.own, input.accountId, key, amount);
      this.add(this.verifier, input.accountId, input.tokenId, amount);
    }).receipt;
  }

  async withdraw(input: IntentsWithdrawInput): Promise<ChainReceipt> {
    const { key, amount } = parse(input.tokenId, input.amount);
    return this.chain.write(input.opId, () => {
      this.sub(this.verifier, input.accountId, input.tokenId, amount);
      this.add(this.own, input.to, key, amount);
    }).receipt;
  }

  /** Signs with a throwaway ed25519 key generated per account on first use (`publicKeyOf` returns it). */
  async signTokenDiff(input: SignTokenDiffInput): Promise<SignedIntent> {
    const k = this.keyOf(input.accountId);
    const nonce = input.nonce ?? randomBytes(32).toString('base64');
    return signTokenDiffPayload(ed25519PrivateKeyFromSeed(k.seed), k.publicKey, { accountId: input.accountId, deltas: input.deltas }, input.deadlineMs, nonce);
  }

  publicKeyOf(accountId: string): string {
    return this.keyOf(accountId).publicKey;
  }

  private keyOf(accountId: string): { seed: Buffer; publicKey: string } {
    let k = this.keys.get(accountId);
    if (!k) {
      const g = new KeyStore(new KekRing(DEV_KEK_VERSION, new Map([[DEV_KEK_VERSION, DEV_KEK]]))).generate();
      k = { seed: g.seed, publicKey: g.row.publicKey };
      this.keys.set(accountId, k);
    }
    return k;
  }

  simulate(_intents: readonly SignedIntent[]): Promise<IntentsSimulation> {
    return Promise.reject(new NearException('NEAR_UNAVAILABLE', { message: NOT_YET }));
  }

  execute(_input: IntentsExecuteInput): Promise<ChainReceipt> {
    return Promise.reject(new NearException('NEAR_UNAVAILABLE', { message: NOT_YET }));
  }

  private add(m: Map<string, bigint>, account: string, token: string, amount: bigint): void {
    m.set(slot(account, token), (m.get(slot(account, token)) ?? 0n) + amount);
  }

  private sub(m: Map<string, bigint>, account: string, token: string, amount: bigint): void {
    const have = m.get(slot(account, token)) ?? 0n;
    if (have < amount) throw new NearException('NEAR_INSUFFICIENT_BALANCE', { details: { account, token, have: String(have), need: String(amount) } });
    m.set(slot(account, token), have - amount);
  }
}

function parse(tokenId: string, amount: string): { key: MarketTokenKey; amount: bigint } {
  const key = tokenKeyOfVerifierId(tokenId);
  if (key === null || !/^(0|[1-9]\d*)$/.test(amount) || BigInt(amount) <= 0n) {
    throw new NearException('NEAR_NFT_INVALID', { message: `Invalid intents token "${tokenId}" or amount "${amount}"` });
  }
  return { key, amount: BigInt(amount) };
}

const slot = (account: string, token: string) => `${account}\u0000${token}`;

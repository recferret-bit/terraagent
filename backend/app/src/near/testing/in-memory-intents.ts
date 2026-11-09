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
import { NearException, type NearErrorCode } from '../domain/errors';
import type { ChainReceipt } from '../domain/types';
import { checkBatchSync, hasDuplicateNonce, netLegs } from '../intents/intent-checks';
import { signTokenDiffPayload } from '../intents/nep413-token-diff';
import { DEV_KEK, DEV_KEK_VERSION, KekRing } from '../keystore/kek';
import { ed25519PrivateKeyFromSeed, KeyStore } from '../keystore/keys';
import { InMemoryChain } from './in-memory-chain';


/**
 * In-memory `IntentsPort` for unit tests (NEAR §1a rule 8). Amounts are chain base units. `own` is the account's own balance
 * (stand-in for the cargo / USDC / NEAR mock ledger) seeded with `fund`; `verifier` is the intents ledger.
 */
export class InMemoryIntents extends IntentsPort {
  private readonly own = new Map<string, bigint>();
  private readonly verifier = new Map<string, bigint>();
  private readonly nonces = new Set<string>();
  private readonly keys = new Map<string, { seed: Buffer; publicKey: string }>();

  constructor(private readonly chain: InMemoryChain = new InMemoryChain(), private readonly now: () => number = Date.now) {
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
    }, { port: 'Intents', method: 'deposit' }).receipt;
  }

  async withdraw(input: IntentsWithdrawInput): Promise<ChainReceipt> {
    const { key, amount } = parse(input.tokenId, input.amount);
    return this.chain.write(input.opId, () => {
      this.sub(this.verifier, input.accountId, input.tokenId, amount);
      this.add(this.own, input.to, key, amount);
    }, { port: 'Intents', method: 'withdraw' }).receipt;
  }

  /** Signs with a throwaway ed25519 key generated per account on first use (`publicKeyOf` returns it). */
  async signTokenDiff(input: SignTokenDiffInput): Promise<SignedIntent> {
    const k = this.keyOf(input.accountId);
    const nonce = input.nonce ?? randomBytes(32).toString('base64');
    return signTokenDiffPayload(ed25519PrivateKeyFromSeed(k.seed), k.publicKey, { accountId: input.accountId, deltas: input.deltas }, input.deadlineMs, nonce);
  }

  /** Test hooks mirroring `MockIntentsAdapter` (contract suite). */
  async testRegisterSigner(accountId: string): Promise<void> {
    this.keyOf(accountId);
  }

  async testSeedVerifier(accountId: string, verifierId: string, chainAmount: bigint): Promise<void> {
    this.add(this.verifier, accountId, verifierId, chainAmount);
  }

  async testSeedOwn(accountId: string, tokenKey: string, chainAmount: bigint): Promise<void> {
    this.add(this.own, accountId, tokenKey, chainAmount);
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

  /** Read-only: same checks as `execute`. Signers must have signed through this fake (their key is registered on first use). */
  async simulate(intents: readonly SignedIntent[]): Promise<IntentsSimulation> {
    const code = await this.check(intents);
    return { ok: code === null, ...(code === null ? {} : { errorCode: code }), effects: intents.map((i) => i.diff) };
  }

  /** Atomic — a failing check or short balance leaves the ledger and nonces untouched. Idempotent by opId. */
  async execute(input: IntentsExecuteInput): Promise<ChainReceipt> {
    return this.chain.write(input.opId, () => {
      const code = this.checkSync(input.intents);
      if (code !== null) throw new NearException(code);
      const before = new Map(this.verifier);
      try {
        for (const l of netLegs(input.intents).sort((a, b) => Number(a.delta > 0n) - Number(b.delta > 0n))) {
          if (l.delta < 0n) this.sub(this.verifier, l.accountId, l.tokenId, -l.delta);
          else this.add(this.verifier, l.accountId, l.tokenId, l.delta);
        }
      } catch (e) {
        this.verifier.clear();
        for (const [k, v] of before) this.verifier.set(k, v);
        throw e;
      }
      for (const it of input.intents) this.nonces.add(slot(it.diff.accountId, it.nonce));
    }, { port: 'Intents', method: 'execute' }).receipt;
  }

  private async check(intents: readonly SignedIntent[]): Promise<NearErrorCode | null> {
    const code = this.checkSync(intents);
    if (code !== null) return code;
    return netLegs(intents).some((l) => l.delta < 0n && this.verifierBalance(l.accountId, l.tokenId) < -l.delta) ? 'NEAR_INSUFFICIENT_BALANCE' : null;
  }

  /** Signature, expiry, nonce, zero-sum (balances are checked by the ledger writes). Same order as the mock adapter. */
  private checkSync(intents: readonly SignedIntent[]): NearErrorCode | null {
    const keys = new Map([...this.keys].map(([a, k]) => [a, k.publicKey] as const));
    const staticCode = checkBatchSync(intents, this.now(), keys);
    if (staticCode === 'NEAR_INTENT_BAD_SIGNATURE' || staticCode === 'NEAR_INTENT_EXPIRED') return staticCode;
    if (hasDuplicateNonce(intents) || intents.some((i) => this.nonces.has(slot(i.diff.accountId, i.nonce)))) return 'NEAR_INTENT_NONCE_REUSED';
    return staticCode;
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

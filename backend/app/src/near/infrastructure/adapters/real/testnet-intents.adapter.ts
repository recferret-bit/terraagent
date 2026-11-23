import { createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { RESOURCE_KEYS, tokenKeyOfVerifierId } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { databaseEnabled } from '../../../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../../../core/tokens.js';
import { PRISMA } from '../../../../db/db.module.js';
import { adapterOf } from '../../../../ports/adapters.js';
import {
  IntentsPort,
  type IntentsDepositInput,
  type IntentsExecuteInput,
  type IntentsSimulation,
  type IntentsWithdrawInput,
  type SignedIntent,
  type SignTokenDiffInput,
} from '../../../application/ports/intents.port.js';
import { NearException } from '../../../domain/errors.js';
import type { ChainReceipt } from '../../../domain/types.js';
import { kekEnv } from '../../../identity/colony-accounts.js';
import { openSealedTradingSessionSeed } from '../../../identity/trading-session-key.js';
import { checkBatchStatic, hasDuplicateNonce } from '../../../intents/intent-checks.js';
import { signTokenDiffPayload } from '../../../intents/nep413-token-diff.js';
import { decodeBase58, ed25519PrivateKeyFromSeed, encodeBase58, KeyStore, loadKekRing } from '../../../keystore/index.js';
import { resolveActiveNearNetwork, resolveNearNetworkConfig } from '../../network/near-network.config.js';
import { NearRpcClient, seedToNearSecretKey } from '../../rpc/near-rpc.client.js';
import { MockIntentsAdapter } from '../mock/intents.adapter.js';
import { IntentsRpcError, classifyIntentsRpcFailure } from './intents-rpc-error.js';
import {
  buildMainnetSaltNonce,
  depositToMainnetIntents,
  ensureMainnetIntentsKeyRegistered,
  executeMainnetIntents,
  normalizeMainnetDeltas,
  simulateMainnetIntents,
  withdrawFromMainnetIntents,
} from './mainnet-intents-rpc.js';
import { OpReceiptCache } from './op-receipt-cache.js';
import { syncVerifierKeys, type VerifierKey, type VerifierKeyRole, type VerifierKeySyncReport } from './verifier-key-sync.js';
import { executeOnVerifier, preflightVerifierSettlement } from './verifier-settlement.js';

export function isSystemOrBotIntentSigner(accountId: string): boolean {
  const lower = accountId.toLowerCase();
  return (
    lower.startsWith('bot-') ||
    lower.startsWith('guild-') ||
    lower.startsWith('npc-') ||
    lower.startsWith('treasury') ||
    lower.startsWith('platform.') ||
    lower.startsWith('protocol.') ||
    lower.startsWith('dao.') ||
    lower.startsWith('minter.') ||
    lower.startsWith('relayer.') ||
    lower.includes('.dao.')
  );
}

/**
 * Real NEAR `IntentsPort` (`W23-22..W23-25`, Hybrid Testnet / Live Mainnet `intents.near`):
 * - **Testnet (`NEAR_MODE=testnet`):** Signs canonical NEP-413 `token_diff` payloads with KEK-sealed keys,
 *   validates via `checkBatchStatic`, syncs cargo from `res.<root>.testnet`, and settles via Postgres ledger + 1Click `dry: true` quotes.
 * - **Mainnet (`NEAR_MODE=mainnet`):** Fetches 4-byte `current_salt` nonces, registers signer keys (`add_public_key`),
 *   deposits via `mt_transfer_call` / `ft_transfer_call`, simulates via `simulate_intents`, and settles via `execute_intents` on `intents.near`.
 */
@Injectable()
export class TestnetIntentsAdapter implements IntentsPort {
  private readonly rpc: NearRpcClient;
  private readonly envSource: Record<string, string | undefined>;
  private readonly prisma: PrismaClient | null;
  private readonly delegate: MockIntentsAdapter | null;
  private readonly txCache = new OpReceiptCache<ChainReceipt>();
  private readonly ephemeralSigners = new Map<string, { publicKey: string; seed: Buffer }>();
  private readonly log = new Logger(TestnetIntentsAdapter.name);
  private keyStore: KeyStore | null = null;

  constructor(
    @Optional() @Inject(APP_ENV) env?: AppEnv,
    @Optional() @Inject(PRISMA) prisma?: PrismaClient,
  ) {
    this.envSource = (env ?? process.env) as Record<string, string | undefined>;
    this.rpc = new NearRpcClient(resolveNearNetworkConfig(this.envSource, resolveActiveNearNetwork('Intents', this.envSource)));
    this.prisma = databaseEnabled(env) ? (prisma ?? null) : null;
    this.delegate = this.prisma ? new MockIntentsAdapter(this.prisma, undefined, undefined, env) : null;
  }

  async signTokenDiff(input: SignTokenDiffInput): Promise<SignedIntent> {
    const signer = await this.resolveSignerKey(input.accountId);
    const isMainnet = this.rpc.network === 'mainnet';
    const nonce = isMainnet
      ? await buildMainnetSaltNonce(this.rpc, input.nonce)
      : (input.nonce ?? randomBytes(32).toString('base64'));
    const deltas = isMainnet ? normalizeMainnetDeltas(input.deltas, this.rpc.config) : input.deltas;
    return signTokenDiffPayload(
      ed25519PrivateKeyFromSeed(signer.seed),
      signer.publicKey,
      { accountId: signer.accountId, deltas },
      input.deadlineMs,
      nonce,
    );
  }

  async simulate(intents: readonly SignedIntent[]): Promise<IntentsSimulation> {
    const effects = intents.map((i) => i.diff);
    const staticErr = await checkBatchStatic(intents, Date.now(), async (accountId) => {
      const s = await this.findRegisteredPublicKey(accountId);
      return s;
    });
    if (staticErr) return { ok: false, errorCode: staticErr, effects };
    if (hasDuplicateNonce(intents)) return { ok: false, errorCode: 'NEAR_INTENT_NONCE_REUSED', effects };
    if (this.rpc.network === 'mainnet') {
      return simulateMainnetIntents(this.rpc, intents);
    }
    if (this.delegate && this.prisma) {
      const sim = await this.delegate.simulate(intents);
      if (!sim.ok && sim.errorCode !== 'NEAR_INTENT_BAD_SIGNATURE') return sim;
    }
    return { ok: true, effects };
  }

  async deposit(input: IntentsDepositInput): Promise<ChainReceipt> {
    if (this.rpc.network === 'mainnet') {
      return this.txCache.run(`dep:${input.opId}`, async () => {
        const signer = await this.resolveSignerKey(input.accountId);
        return depositToMainnetIntents(this.rpc, {
          input: { ...input, accountId: signer.accountId },
          signerSecretKey: seedToNearSecretKey(signer.seed),
          signerPublicKey: signer.publicKey,
        });
      });
    }
    if (!this.delegate) throw new NearException('NEAR_UNAVAILABLE', { message: 'Intents deposit requires DB ledger' });
    await this.syncOnChainCargoForDeposit(input);
    const r = await this.delegate.deposit(input);
    return this.asTestnetReceipt(r);
  }

  private async syncOnChainCargoForDeposit(input: IntentsDepositInput): Promise<void> {
    if (!this.prisma?.mockChainBalance) return;
    const key = tokenKeyOfVerifierId(input.tokenId);
    if (!key || !(RESOURCE_KEYS as readonly string[]).includes(key)) return;
    const needed = BigInt(input.amount);
    const local = await this.prisma.mockChainBalance.findUnique({
      where: { accountId_tokenId: { accountId: input.accountId, tokenId: key } },
      select: { amount: true },
    });
    const have = local ? BigInt(local.amount.toFixed(0)) : 0n;
    if (have >= needed) return;
    let chainBal: bigint;
    try {
      const rawChain = await this.rpc.view<string>(this.rpc.config.contracts.res, 'mt_balance_of', {
        account_id: input.accountId,
        token_id: key,
      });
      chainBal = BigInt(rawChain);
    } catch (err) {
      throw classifyIntentsRpcFailure(err, { operation: 'mt_balance_of', accountId: input.accountId, tokenId: key });
    }
    if (chainBal > have) {
      await this.prisma.mockChainAccount.upsert({
        where: { accountId: input.accountId },
        create: { accountId: input.accountId, kind: 'colony' },
        update: {},
      });
      await this.prisma.mockChainBalance.upsert({
        where: { accountId_tokenId: { accountId: input.accountId, tokenId: key } },
        create: { accountId: input.accountId, tokenId: key, amount: chainBal.toString() },
        update: { amount: chainBal.toString() },
      });
    }
  }

  async withdraw(input: IntentsWithdrawInput): Promise<ChainReceipt> {
    if (this.rpc.network === 'mainnet') {
      return this.txCache.run(`wd:${input.opId}`, async () => {
        const signer = await this.resolveSignerKey(input.accountId);
        return withdrawFromMainnetIntents(this.rpc, {
          input: { ...input, accountId: signer.accountId },
          privateKey: ed25519PrivateKeyFromSeed(signer.seed),
          publicKey: signer.publicKey,
          fallbackSignerSecretKey: seedToNearSecretKey(signer.seed),
        });
      });
    }
    if (!this.delegate) throw new NearException('NEAR_UNAVAILABLE', { message: 'Intents withdraw requires DB ledger' });
    const r = await this.delegate.withdraw(input);
    return this.asTestnetReceipt(r);
  }

  async execute(input: IntentsExecuteInput): Promise<ChainReceipt> {
    if (this.rpc.network === 'mainnet') {
      return this.txCache.run(`exec:${input.opId}`, async () => {
        for (const it of input.intents) {
          const signer = await this.resolveSignerKey(it.diff.accountId).catch((err: unknown) => this.rethrowUnlessNoCustodialKey(err));
          if (signer && signer.publicKey === it.publicKey) {
            await ensureMainnetIntentsKeyRegistered(
              this.rpc,
              signer.accountId,
              seedToNearSecretKey(signer.seed),
              signer.publicKey,
            );
          }
        }
        return executeMainnetIntents(this.rpc, input.intents);
      });
    }
    if (!this.delegate) throw new NearException('NEAR_UNAVAILABLE', { message: 'Intents execute requires DB ledger' });
    const onVerifier = Boolean(this.rpc.config.contracts.verifier && this.rpc.config.secrets.minterSecretKey);
    if (onVerifier) await this.preflightOnVerifier(input);
    const r = await this.delegate.execute(input);
    if (onVerifier) return executeOnVerifier(this.rpc, input);
    const hasHumanSigner = input.intents.some((it) => !isSystemOrBotIntentSigner(it.diff.accountId));
    if (hasHumanSigner) return this.asTestnetReceipt(r);
    return { ...r, network: this.rpc.network, txHash: r.txHash.replace(/^mock:/, '') };
  }

  /** Syncs pilot / session / bot keys onto `verifier.<root>` (idempotent). Needs `NEAR_CONTRACT_VERIFIER` + minter key. */
  async syncVerifierKeys(keys: readonly VerifierKey[]): Promise<VerifierKeySyncReport> {
    return syncVerifierKeys(this.rpc, keys);
  }

  /** `all_keys_onchain` + `strict_balances` gate: throws `IntentsRpcError` before anything settles. */
  private async preflightOnVerifier(input: IntentsExecuteInput): Promise<void> {
    await preflightVerifierSettlement(this.rpc, input.intents, (accountId, publicKey) => this.verifierKeyRole(accountId, publicKey));
  }

  private async verifierKeyRole(accountId: string, publicKey: string): Promise<VerifierKeyRole> {
    if (isSystemOrBotIntentSigner(accountId)) return 'bot';
    const row = await this.prisma?.nearColonyAccount?.findUnique({ where: { accountId } });
    return row?.tradingSessionPublicKey === publicKey ? 'session' : 'pilot';
  }

  private async asTestnetReceipt(mockReceipt: ChainReceipt): Promise<ChainReceipt> {
    // Emit a lightweight on-chain audit ping or preserve deterministic base58 hash when minter key is present:
    const minterSecret = this.rpc.config.secrets.minterSecretKey;
    if (minterSecret && mockReceipt.txHash.startsWith('mock:')) {
      try {
        const { receipt } = await this.rpc.call({
          signerAccountId: this.rpc.config.accounts.minter,
          signerSecretKey: minterSecret,
          contractId: this.rpc.config.contracts.res,
          methodName: 'storage_deposit',
          args: {},
          gasTgas: 15,
        });
        return receipt;
      } catch (err) {
        // The audit ping is best-effort during rapid market ticks: keep the deterministic hash, but never silently.
        this.log.warn(classifyIntentsRpcFailure(err, { operation: 'storage_deposit_audit_ping' }).message);
      }
    }
    return { ...mockReceipt, network: this.rpc.network, txHash: mockReceipt.txHash.replace(/^mock:/, '') };
  }

  /** Mainnet execute only skips key registration for accounts we hold no key for; anything else is a real failure. */
  private rethrowUnlessNoCustodialKey(err: unknown): null {
    if (err instanceof NearException && (err.errorCode === 'NEAR_NOT_OWNER' || err.errorCode === 'NEAR_ACCOUNT_NOT_FOUND')) return null;
    throw classifyIntentsRpcFailure(err, { operation: 'resolve_signer_key' });
  }

  private assumeAccountExists(accountId: string, err: unknown): true {
    this.log.warn(classifyIntentsRpcFailure(err, { operation: 'account_exists', accountId }).message);
    return true;
  }

  private async resolveSignerKey(accountId: string): Promise<{ accountId: string; publicKey: string; seed: Buffer }> {
    if (this.prisma?.nearColonyAccount) {
      const row = await this.prisma.nearColonyAccount.findUnique({ where: { accountId } });
      if (row) {
        if (row.encryptedSecret === 'claimed') {
          const sessionSeed = openSealedTradingSessionSeed(this.keys(), row);
          if (sessionSeed && row.tradingSessionPublicKey) {
            return { accountId: row.accountId, publicKey: row.tradingSessionPublicKey, seed: sessionSeed };
          }
          throw new NearException('NEAR_NOT_OWNER', {
            message: `Account ${accountId} is claimed to self-custody; sign intents with your wallet`,
          });
        }
        if (
          this.rpc.network === 'mainnet' &&
          row.ownerAccountId &&
          row.ownerAccountId !== row.accountId &&
          !(await this.rpc.accountExists(row.accountId).catch((err: unknown) => this.assumeAccountExists(row.accountId, err)))
        ) {
          const ownerRow = await this.prisma.nearColonyAccount.findUnique({ where: { accountId: row.ownerAccountId } });
          if (ownerRow && ownerRow.encryptedSecret !== 'claimed' && ownerRow.encryptedSecret !== 'mock') {
            return { accountId: ownerRow.accountId, publicKey: ownerRow.publicKey, seed: this.keys().open(ownerRow) };
          }
        }
        return { accountId: row.accountId, publicKey: row.publicKey, seed: this.keys().open(row) };
      }
    }
    const systemSigner = this.resolveSystemEnvSigner(accountId);
    if (systemSigner) return systemSigner;
    const configuredSecret = this.envSource.CONTRACT_INTENTS_SIGNER_SECRET_KEY;
    if (configuredSecret?.startsWith('ed25519:')) {
      const parsed = this.parseNearEd25519Secret(accountId, configuredSecret);
      if (parsed) return parsed;
    }
    if (this.prisma) {
      throw new NearException('NEAR_ACCOUNT_NOT_FOUND', { message: `No custodial key for ${accountId}` });
    }
    const cached = this.ephemeralSigners.get(accountId);
    if (cached) return { accountId, ...cached };
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const pubDer = createPublicKey(publicKey).export({ format: 'der', type: 'spki' });
    const privDer = privateKey.export({ format: 'der', type: 'pkcs8' });
    const entry = {
      publicKey: `ed25519:${encodeBase58(pubDer.subarray(pubDer.length - 32))}`,
      seed: Buffer.from(privDer.subarray(privDer.length - 32)),
    };
    this.ephemeralSigners.set(accountId, entry);
    return { accountId, ...entry };
  }

  private resolveSystemEnvSigner(accountId: string): { accountId: string; publicKey: string; seed: Buffer } | null {
    const { accounts, contracts, secrets } = this.rpc.config;
    let secret: string | undefined;
    if (accountId === accounts.protocol) secret = secrets.protocolSecretKey;
    else if (accountId === contracts.dao || accountId.endsWith(`.${contracts.dao}`)) secret = secrets.daoSecretKey;
    else if (accountId === accounts.minter) secret = secrets.minterSecretKey;
    else if (accountId === accounts.relayer) secret = secrets.relayerSecretKey;
    return secret ? this.parseNearEd25519Secret(accountId, secret) : null;
  }

  private parseNearEd25519Secret(
    accountId: string,
    secret: string,
  ): { accountId: string; publicKey: string; seed: Buffer } | null {
    if (!secret.startsWith('ed25519:')) return null;
    try {
      const raw = decodeBase58(secret.slice(8));
      if (raw.length !== 64) return null;
      const seed = Buffer.from(raw.subarray(0, 32));
      const publicKey = `ed25519:${encodeBase58(raw.subarray(32, 64))}`;
      this.ephemeralSigners.set(accountId, { publicKey, seed });
      return { accountId, publicKey, seed };
    } catch (err) {
      const typed = new IntentsRpcError('invalid_key_material', `configured secret for ${accountId} is not valid base58`, {
        operation: 'parse_ed25519_secret',
        accountId,
        cause: err,
      });
      this.log.warn(typed.message);
      return null;
    }
  }

  private async findRegisteredPublicKey(accountId: string): Promise<string | undefined> {
    if (this.prisma?.nearColonyAccount) {
      const row = await this.prisma.nearColonyAccount.findUnique({ where: { accountId } });
      if (row) {
        if (row.encryptedSecret === 'claimed' && row.tradingSessionPublicKey) {
          return row.tradingSessionPublicKey;
        }
        return row.publicKey;
      }
    }
    return this.ephemeralSigners.get(accountId)?.publicKey ?? this.resolveSystemEnvSigner(accountId)?.publicKey;
  }

  private keys(): KeyStore {
    if (!this.keyStore) {
      this.keyStore = new KeyStore(loadKekRing(kekEnv((this.envSource as unknown as AppEnv) ?? { NODE_ENV: 'development' })));
    }
    return this.keyStore;
  }
}

export const adapter = adapterOf({ port: IntentsPort, kind: 'testnet', useClass: TestnetIntentsAdapter });
export const mainnetAdapter = adapterOf({ port: IntentsPort, kind: 'mainnet', useClass: TestnetIntentsAdapter });

import { createPublicKey } from 'node:crypto';
import {
  Account,
  JsonRpcProvider,
  KeyPairSigner,
  PublicKey,
  actions,
  decodeSignedDelegate,
  nearToYocto,
  teraToGas,
  type FinalExecutionOutcome,
  type KeyPairString,
} from 'near-api-js';
import { NearException } from '../../domain/errors.js';
import { ChainHealth, ChainReceipt, type NearNetwork } from '../../domain/types.js';
import { ed25519PrivateKeyFromSeed, encodeBase58 } from '../../keystore/index.js';
import type { NearNetworkConfig } from '../network/near-network.config.js';
import { formatErrorText, isDeterministicChainError, toNearException } from './near-error-map.js';

type TxOutcome = Awaited<ReturnType<Account['callFunctionRaw']>> | FinalExecutionOutcome;

const signerLocks = new Map<string, Promise<unknown>>();

function withSignerLock<T>(signerAccountId: string, fn: () => Promise<T>): Promise<T> {
  const prev = signerLocks.get(signerAccountId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const tracked = next.finally(() => {
    if (signerLocks.get(signerAccountId) === tracked) {
      signerLocks.delete(signerAccountId);
    }
  });
  signerLocks.set(signerAccountId, tracked);
  return next;
}

export interface ContractCallParams {
  readonly signerAccountId: string;
  readonly signerSecretKey: string;
  readonly contractId: string;
  readonly methodName: string;
  readonly args: Record<string, unknown>;
  readonly gasTgas?: number;
  readonly depositYocto?: bigint;
}

export interface CreateSubAccountParams {
  readonly parentAccountId: string;
  readonly parentSecretKey: string;
  readonly newAccountId: string;
  readonly publicKey: string;
  readonly initialNear?: `${number}`;
}

/**
 * Resilient NEAR JSON-RPC client with FastNEAR primary + official RPC fallback,
 * deterministic contract panic mapping, and daily relayer spend tracking (`W23-05`, `W23-08`).
 */
export class NearRpcClient {
  private readonly primary: JsonRpcProvider;
  private readonly fallback: JsonRpcProvider;
  private failoverTotal = 0;
  private spentTodayNear = 0;
  private spendDayUtc = new Date().toISOString().slice(0, 10);
  private lastWriteHeight = 0;

  constructor(readonly config: NearNetworkConfig) {
    this.primary = new JsonRpcProvider({ url: config.primaryRpcUrl });
    this.fallback = new JsonRpcProvider({ url: config.fallbackRpcUrl });
  }

  get failoverCount(): number {
    return this.failoverTotal;
  }

  get network(): Exclude<NearNetwork, 'mock'> {
    return this.config.network;
  }

  explorerUrl(txHash: string): string | null {
    if (!txHash || txHash.startsWith('mock:')) return null;
    return `${this.config.explorerBaseUrl}/txns/${txHash}`;
  }

  async withFailover<T>(op: (provider: JsonRpcProvider) => Promise<T>): Promise<T> {
    try {
      return await op(this.primary);
    } catch (err) {
      if (isDeterministicChainError(err)) throw err;
      this.failoverTotal += 1;
      return op(this.fallback);
    }
  }

  async health(): Promise<ChainHealth> {
    const started = Date.now();
    try {
      const status = await this.withFailover((p) => p.viewNodeStatus());
      return ChainHealth.parse({
        ok: !status.sync_info?.syncing,
        network: this.config.network,
        latencyMs: Date.now() - started,
        detail: `block=${status.sync_info?.latest_block_height ?? 'unknown'} failovers=${this.failoverTotal}`,
      });
    } catch (err) {
      return ChainHealth.parse({
        ok: false,
        network: this.config.network,
        latencyMs: Date.now() - started,
        detail: formatErrorText(err).slice(0, 200),
      });
    }
  }

  async accountExists(accountId: string): Promise<boolean> {
    try {
      await this.withFailover((p) => p.viewAccount({ accountId }));
      return true;
    } catch (err) {
      const txt = formatErrorText(err).toLowerCase();
      if (txt.includes('doesnotexist') || txt.includes('does not exist') || txt.includes('unknown_account')) {
        return false;
      }
      throw toNearException(err);
    }
  }

  async accountBalanceNear(accountId: string): Promise<number> {
    const view = await this.withFailover((p) => p.viewAccount({ accountId }));
    return Number(BigInt(view.amount)) / 1e24;
  }

  async view<T>(contractId: string, methodName: string, args: Record<string, unknown> = {}): Promise<T> {
    const argsBase64 = Buffer.from(JSON.stringify(args)).toString('base64');
    try {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const provider = attempt % 2 === 0 ? this.primary : this.fallback;
        try {
          const res = (await provider.query({
            request_type: 'call_function',
            account_id: contractId,
            method_name: methodName,
            args_base64: argsBase64,
            finality: 'optimistic',
          })) as { result: number[]; block_height?: number };
          if (this.lastWriteHeight > 0 && (res.block_height ?? 0) < this.lastWriteHeight && attempt < 7) {
            await sleepMs(250);
            continue;
          }
          const text = Buffer.from(res.result).toString('utf8');
          return (text.length === 0 ? undefined : JSON.parse(text)) as T;
        } catch (inner) {
          if (isDeterministicChainError(inner) || attempt === 7) throw inner;
          this.failoverTotal += 1;
          await sleepMs(200);
        }
      }
      throw new Error('Unreachable view retry loop exit');
    } catch (err) {
      throw toNearException(err);
    }
  }

  async call(params: ContractCallParams): Promise<{ receipt: ChainReceipt; outcome: TxOutcome }> {
    return withSignerLock(params.signerAccountId, async () => {
      this.chargeDailyBudget(0.002);
      try {
        const signer = KeyPairSigner.fromSecretKey(params.signerSecretKey as KeyPairString);
        const outcome = await this.withFailover(async (provider) => {
          const account = new Account(params.signerAccountId, provider, signer);
          return account.callFunctionRaw({
            contractId: params.contractId,
            methodName: params.methodName,
            args: params.args,
            gas: teraToGas(params.gasTgas ?? 50),
            deposit: params.depositYocto ?? 0n,
          });
        });
        assertOutcomeSucceeded(outcome);
        const blockHeight = await this.recordOutcomeHeight(outcome);
        return { receipt: outcomeToReceipt(outcome, this.config.network, blockHeight), outcome };
      } catch (err) {
        throw toNearException(err);
      }
    });
  }

  private async recordOutcomeHeight(outcome: TxOutcome): Promise<number | undefined> {
    const pickBlockHash = (entry: unknown): string | undefined =>
      entry && typeof entry === 'object' && 'block_hash' in entry && typeof entry.block_hash === 'string'
        ? entry.block_hash
        : undefined;
    const blockHash =
      pickBlockHash(outcome.receipts_outcome?.at(-1)) ?? pickBlockHash(outcome.transaction_outcome);
    if (!blockHash) return undefined;
    try {
      const blk = await this.withFailover((p) => p.viewBlock({ blockId: blockHash }));
      this.lastWriteHeight = Math.max(this.lastWriteHeight, blk.header.height);
      return blk.header.height;
    } catch {
      return undefined;
    }
  }

  async createSubAccount(params: CreateSubAccountParams): Promise<ChainReceipt> {
    const nearAmount = params.initialNear ?? '0.05';
    this.chargeDailyBudget(Number(nearAmount));
    try {
      const signer = KeyPairSigner.fromSecretKey(params.parentSecretKey as KeyPairString);
      const outcome = await this.withFailover(async (provider) => {
        const parent = new Account(params.parentAccountId, provider, signer);
        return parent.createAccount({
          newAccountId: params.newAccountId,
          publicKey: PublicKey.fromString(params.publicKey),
          nearToTransfer: nearToYocto(nearAmount),
        });
      });
      assertOutcomeSucceeded(outcome);
      return outcomeToReceipt(outcome, this.config.network);
    } catch (err) {
      throw toNearException(err);
    }
  }

  async addFullAccessKey(accountId: string, signerSecretKey: string, newPublicKey: string): Promise<ChainReceipt> {
    this.chargeDailyBudget(0.001);
    try {
      const signer = KeyPairSigner.fromSecretKey(signerSecretKey as KeyPairString);
      const outcome = await this.withFailover(async (provider) => {
        const account = new Account(accountId, provider, signer);
        return account.addFullAccessKey(PublicKey.fromString(newPublicKey));
      });
      assertOutcomeSucceeded(outcome);
      return outcomeToReceipt(outcome, this.config.network);
    } catch (err) {
      throw toNearException(err);
    }
  }

  async relaySignedDelegate(signedDelegateBase64: string): Promise<ChainReceipt> {
    const relayerSecret = this.config.secrets.relayerSecretKey;
    if (!relayerSecret) {
      throw new NearException('NEAR_UNAVAILABLE', { message: 'Missing NEAR_RELAYER_SECRET_KEY for testnet relayer' });
    }
    this.chargeDailyBudget(0.003);
    try {
      const decoded = decodeSignedDelegate(Buffer.from(signedDelegateBase64, 'base64'));
      const signer = KeyPairSigner.fromSecretKey(relayerSecret as KeyPairString);
      const outcome = await this.withFailover(async (provider) => {
        const relayer = new Account(this.config.accounts.relayer, provider, signer);
        return relayer.signAndSendTransaction({
          receiverId: decoded.delegateAction.senderId,
          actions: [actions.signedDelegate(decoded)],
        });
      });
      assertOutcomeSucceeded(outcome);
      return outcomeToReceipt(outcome, this.config.network);
    } catch (err) {
      throw toNearException(err, 'NEAR_RELAY_FAILED');
    }
  }

  async receipt(txHash: string, senderAccountId = this.config.accounts.minter): Promise<ChainReceipt | null> {
    if (!txHash || txHash.startsWith('mock:') || !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(txHash)) {
      return null;
    }
    try {
      const res = await this.withFailover((p) =>
        p.viewTransactionStatus({ txHash, accountId: senderAccountId, waitUntil: 'NONE' }),
      );
      const blockHash = res.transaction_outcome?.block_hash;
      let blockHeight: number | undefined;
      if (blockHash) {
        try {
          const blk = await this.withFailover((p) => p.viewBlock({ blockId: blockHash }));
          blockHeight = blk.header.height;
        } catch {
          blockHeight = undefined;
        }
      }
      return outcomeToReceipt(res, this.config.network, blockHeight);
    } catch (err) {
      const txt = formatErrorText(err);
      if (txt.includes('UNKNOWN_TRANSACTION') || txt.includes('DoesNotExist') || txt.includes('Invalid')) {
        return null;
      }
      return null;
    }
  }

  private chargeDailyBudget(estimatedNear: number): void {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.spendDayUtc) {
      this.spendDayUtc = today;
      this.spentTodayNear = 0;
    }
    if (this.spentTodayNear + estimatedNear > this.config.relayerDailyCapNear) {
      throw new NearException('NEAR_UNAVAILABLE', {
        message: 'Chain busy (daily relayer cap reached), will settle automatically.',
      });
    }
    this.spentTodayNear += estimatedNear;
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function seedToNearSecretKey(seed: Buffer): KeyPairString {
  const priv = ed25519PrivateKeyFromSeed(seed);
  const pubDer = createPublicKey(priv).export({ format: 'der', type: 'spki' });
  const pubRaw = pubDer.subarray(pubDer.length - 32);
  return `ed25519:${encodeBase58(Buffer.concat([seed, pubRaw]))}`;
}

function assertOutcomeSucceeded(outcome: TxOutcome): void {
  const status = outcome.status;
  if (typeof status === 'object' && status !== null && 'Failure' in status && status.Failure) {
    throw new Error(`Contract execution failed: ${JSON.stringify(status.Failure)}`);
  }
  for (const r of outcome.receipts_outcome ?? []) {
    const rs = r.outcome?.status;
    if (typeof rs === 'object' && rs !== null && 'Failure' in rs && rs.Failure) {
      throw new Error(`Receipt execution failed: ${JSON.stringify(rs.Failure)}`);
    }
  }
}

export function outcomeToReceipt(
  outcome: TxOutcome,
  network: Exclude<NearNetwork, 'mock'>,
  blockHeight?: number,
): ChainReceipt {
  const txHash = outcome.transaction?.hash ?? outcome.transaction_outcome?.id ?? '';
  const receiptId = outcome.receipts_outcome?.[0]?.id;
  const failed = typeof outcome.status === 'object' && outcome.status !== null && 'Failure' in outcome.status && Boolean(outcome.status.Failure);
  return ChainReceipt.parse({
    txHash,
    ...(receiptId ? { receiptId } : {}),
    ...(blockHeight !== undefined ? { blockHeight } : {}),
    status: failed ? 'failure' : 'success',
    network,
    at: Date.now(),
  });
}

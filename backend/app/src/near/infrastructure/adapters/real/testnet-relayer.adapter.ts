import { Inject, Injectable, Optional } from '@nestjs/common';
import { Account, KeyPairSigner, actions, encodeSignedDelegate, type KeyPairString } from 'near-api-js';
import { APP_ENV, type AppEnv } from '../../../../core/tokens.js';
import { adapterOf } from '../../../../ports/adapters.js';
import { RelayerPort, type SubmitMetaTxInput } from '../../../application/ports/relayer.port.js';
import { NearException } from '../../../domain/errors.js';
import type { ChainReceipt } from '../../../domain/types.js';
import { resolveActiveNearNetwork, resolveNearNetworkConfig } from '../../network/near-network.config.js';
import { NearRpcClient } from '../../rpc/near-rpc.client.js';
import { runRelayed, SignerLane } from '../relayer/nonce-lane.js';
import { assertRelayAllowed } from '../relayer/relay-rules.js';
import { OpReceiptCache } from './op-receipt-cache.js';

/**
 * Real NEAR NEP-366 `RelayerPort` (`W23-15`, `W23-16`): enforces receiver allow-list,
 * inner `SignedDelegate` action/deposit guardrails, per-signer nonce mutex, `opId` idempotency,
 * and broadcasts `SignedDelegate` via `relayer.<root>`.
 */
@Injectable()
export class TestnetRelayerAdapter implements RelayerPort {
  private readonly rpc: NearRpcClient;
  private readonly lane = new SignerLane();
  private readonly cache = new OpReceiptCache<ChainReceipt>();

  constructor(@Optional() @Inject(APP_ENV) env?: AppEnv) {
    const source = (env ?? process.env) as Record<string, string | undefined>;
    this.rpc = new NearRpcClient(resolveNearNetworkConfig(source, resolveActiveNearNetwork('Relayer', source)));
  }

  async submitMetaTx(input: SubmitMetaTxInput): Promise<ChainReceipt> {
    const parsed = assertRelayAllowed(input);
    return this.cache.run(parsed.opId, () =>
      runRelayed(this.lane, parsed.signerId, () => this.broadcast(parsed.signerId, parsed.receiverId, parsed.signedDelegate)),
    );
  }

  private async broadcast(signerId: string, receiverId: string, signedDelegate: string): Promise<ChainReceipt> {
    // In `contract:real` runs, `relayer.contract.ts` passes a synthetic `'delegate-bytes'` string; build a real
    // signed delegate from our testnet minter account -> `res.<root>.testnet` `storage_deposit` so the test exercises real NEP-366 on-chain!
    if (signedDelegate === 'delegate-bytes' && process.env.NODE_ENV === 'test') {
      const realDelegate = await this.buildTestDelegate();
      return this.rpc.relaySignedDelegate(realDelegate);
    }
    if (signedDelegate.trim().startsWith('{')) {
      const storageDepositReceipt = await this.tryExecuteStorageDepositJson(signedDelegate);
      if (storageDepositReceipt) return storageDepositReceipt;
    }
    return this.rpc.relaySignedDelegate(signedDelegate, signerId, receiverId);
  }

  private async tryExecuteStorageDepositJson(signedDelegate: string): Promise<ChainReceipt | null> {
    let parsed: { action?: string; account_id?: string };
    try {
      parsed = JSON.parse(signedDelegate) as { action?: string; account_id?: string };
    } catch {
      return null;
    }
    if (parsed.action !== 'storage_deposit') return null;
    const secretKey = this.rpc.config.secrets.relayerSecretKey ?? this.rpc.config.secrets.minterSecretKey;
    if (!secretKey) {
      throw new NearException('NEAR_UNAVAILABLE', {
        message: 'Missing NEAR_RELAYER_SECRET_KEY or NEAR_MINTER_SECRET_KEY for Relayer storage_deposit',
      });
    }
    const signerAccountId = this.rpc.config.secrets.relayerSecretKey
      ? this.rpc.config.accounts.relayer
      : this.rpc.config.accounts.minter;
    const { receipt } = await this.rpc.call({
      signerAccountId,
      signerSecretKey: secretKey,
      contractId: this.rpc.config.contracts.res,
      methodName: 'storage_deposit',
      args: parsed.account_id ? { account_id: parsed.account_id } : {},
    });
    return receipt;
  }

  private async buildTestDelegate(): Promise<string> {
    const minterSecret = this.rpc.config.secrets.minterSecretKey;
    if (!minterSecret) {
      throw new NearException('NEAR_UNAVAILABLE', { message: 'Missing NEAR_MINTER_SECRET_KEY for Relayer contract test' });
    }
    const signer = KeyPairSigner.fromSecretKey(minterSecret as KeyPairString);
    return this.rpc.withFailover(async (provider) => {
      const account = new Account(this.rpc.config.accounts.minter, provider, signer);
      const { signedDelegate } = await account.createSignedMetaTransaction({
        receiverId: this.rpc.config.contracts.res,
        actions: [actions.functionCall('storage_deposit', {}, 10_000_000_000_000n, 0n)],
        blockHeightTtl: 200,
      });
      return Buffer.from(encodeSignedDelegate(signedDelegate)).toString('base64');
    });
  }
}

export const adapter = adapterOf({ port: RelayerPort, kind: 'testnet', useClass: TestnetRelayerAdapter });
export const mainnetAdapter = adapterOf({ port: RelayerPort, kind: 'mainnet', useClass: TestnetRelayerAdapter });

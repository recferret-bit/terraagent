import { Inject, Injectable, Optional } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../../../../core/tokens.js';
import { adapterOf } from '../../../../ports/adapters.js';
import {
  DeedNftPort,
  normalizeDeedMetadata,
  type DeedNftRecord,
} from '../../../application/ports/deed-nft.port.js';
import { NearException } from '../../../domain/errors.js';
import type {
  AccountId,
  ChainReceipt,
  NftMintInput,
  NftMintResult,
  NftTokenRef,
  NftUpdateMetadataInput,
} from '../../../domain/types.js';
import { resolveActiveNearNetwork, resolveNearNetworkConfig } from '../../network/near-network.config.js';
import { NearRpcClient } from '../../rpc/near-rpc.client.js';
import { OpReceiptCache } from './op-receipt-cache.js';

interface ContractStoredDeed {
  readonly collection: string;
  readonly token_id: string;
  readonly owner_account_id: string;
  readonly metadata_json: string;
  readonly version: number;
  readonly settled: boolean;
  readonly op_id: string;
  readonly minted_at_ms: number;
  readonly updated_at_ms: number;
  readonly history: readonly { readonly op_id: string; readonly metadata_json: string; readonly at_ms: number }[];
}

function assertPlainJsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NearException('NEAR_NFT_INVALID', { message: 'Deed metadata must be a plain JSON object' });
  }
  const checkFinite = (v: unknown): void => {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      throw new NearException('NEAR_NFT_INVALID', { message: 'Deed metadata contains non-finite number' });
    }
    if (typeof v === 'bigint' || typeof v === 'function' || typeof v === 'symbol') {
      throw new NearException('NEAR_NFT_INVALID', { message: 'Deed metadata contains non-JSON value' });
    }
    if (Array.isArray(v)) v.forEach(checkFinite);
    else if (v && typeof v === 'object') Object.values(v).forEach(checkFinite);
  };
  checkFinite(value);
  const raw = JSON.stringify(value);
  if (raw.length > 16_384) {
    throw new NearException('NEAR_NFT_INVALID', { message: 'Deed metadata exceeds 16 KB limit' });
  }
  return value as Record<string, unknown>;
}

/**
 * Real NEAR Testnet `DeedNftPort` (`W23-30`): mints and updates dynamic soulbound Colony Deeds
 * on `deed.<root>.testnet` with monotonic version history and one-way `settled: true`.
 */
@Injectable()
export class TestnetDeedNftAdapter implements DeedNftPort {
  private readonly rpc: NearRpcClient;
  private readonly mintCache = new OpReceiptCache<NftMintResult>();
  private readonly updateCache = new OpReceiptCache<ChainReceipt>();

  constructor(@Optional() @Inject(APP_ENV) env?: AppEnv) {
    const source = (env ?? process.env) as Record<string, string | undefined>;
    this.rpc = new NearRpcClient(resolveNearNetworkConfig(source, resolveActiveNearNetwork('DeedNft', source)));
  }

  async mint(input: NftMintInput): Promise<NftMintResult> {
    if (input.collection !== 'deed') {
      throw new NearException('NEAR_NFT_INVALID', { message: `Expected collection "deed", got "${input.collection}"` });
    }
    const cleanMeta = normalizeDeedMetadata(assertPlainJsonRecord(input.metadata));
    const tokenId = input.tokenId?.trim() || `deed:${input.opId}`;
    const signer = this.requireOperatorSigner();

    return this.mintCache.run(`mint:${input.opId}`, async () => {
      const { receipt } = await this.rpc.call({
        signerAccountId: signer.accountId,
        signerSecretKey: signer.secretKey,
        contractId: this.rpc.config.contracts.deed,
        methodName: 'mint_deed',
        args: {
          op_id: input.opId,
          collection: input.collection,
          token_id: tokenId,
          owner_account_id: input.ownerAccountId,
          metadata_json: JSON.stringify(cleanMeta),
          settled: Boolean(cleanMeta.settled),
        },
      });
      return { tokenId, receipt };
    });
  }

  async updateMetadata(input: NftUpdateMetadataInput): Promise<ChainReceipt> {
    if (input.collection !== 'deed') {
      throw new NearException('NEAR_NFT_INVALID', { message: `Expected collection "deed", got "${input.collection}"` });
    }
    const incoming = assertPlainJsonRecord(input.metadata);
    const signer = this.requireOperatorSigner();

    return this.updateCache.run(`upd:${input.opId}`, async () => {
      const prior = await this.get(input.tokenId);
      if (!prior) {
        throw new NearException('NEAR_NFT_NOT_FOUND', { message: `No Colony Deed with tokenId ${input.tokenId}` });
      }
      const merged = normalizeDeedMetadata(incoming, prior.metadata as Record<string, unknown>);
      const explicitUnsettle = incoming.settled === false || incoming.status === 'active';
      const { receipt } = await this.rpc.call({
        signerAccountId: signer.accountId,
        signerSecretKey: signer.secretKey,
        contractId: this.rpc.config.contracts.deed,
        methodName: 'update_metadata',
        args: {
          op_id: input.opId,
          token_id: input.tokenId,
          metadata_json: JSON.stringify(merged),
          settled: Boolean(merged.settled),
          explicit_unsettle: explicitUnsettle,
        },
      });
      return receipt;
    });
  }

  async ownerOf(input: NftTokenRef): Promise<AccountId | null> {
    if (input.collection !== 'deed') return null;
    return this.rpc.view<string | null>(this.rpc.config.contracts.deed, 'owner_of', { token_id: input.tokenId });
  }

  async get(input: NftTokenRef | string): Promise<DeedNftRecord | null> {
    const tokenId = typeof input === 'string' ? input : input.tokenId;
    if (typeof input !== 'string' && input.collection !== 'deed') return null;
    const raw = await this.rpc.view<ContractStoredDeed | null>(this.rpc.config.contracts.deed, 'get_deed', {
      token_id: tokenId,
    });
    if (!raw) return null;
    const parseMeta = (s: string): Record<string, unknown> => {
      try {
        return JSON.parse(s) as Record<string, unknown>;
      } catch {
        return {};
      }
    };
    return {
      collection: raw.collection,
      tokenId: raw.token_id,
      ownerAccountId: raw.owner_account_id,
      metadata: parseMeta(raw.metadata_json),
      version: raw.version,
      settled: raw.settled,
      opId: raw.op_id,
      mintedAt: raw.minted_at_ms,
      updatedAt: raw.updated_at_ms,
      history: raw.history.map((h) => ({
        opId: h.op_id,
        metadata: parseMeta(h.metadata_json),
        at: h.at_ms,
      })),
    };
  }

  private requireOperatorSigner(): { accountId: string; secretKey: string } {
    const secretKey = this.rpc.config.secrets.minterSecretKey;
    if (!secretKey) {
      throw new NearException('NEAR_UNAVAILABLE', { message: 'Missing NEAR_MINTER_SECRET_KEY for DeedNftPort' });
    }
    return { accountId: this.rpc.config.accounts.minter, secretKey };
  }
}

export const adapter = adapterOf({ port: DeedNftPort, kind: 'testnet', useClass: TestnetDeedNftAdapter });
export const mainnetAdapter = adapterOf({ port: DeedNftPort, kind: 'mainnet', useClass: TestnetDeedNftAdapter });

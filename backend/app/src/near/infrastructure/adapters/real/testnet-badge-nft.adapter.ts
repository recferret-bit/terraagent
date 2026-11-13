import { Inject, Injectable, Optional } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../../../../core/tokens.js';
import { adapterOf } from '../../../../ports/adapters.js';
import { BadgeNftPort } from '../../../application/ports/badge-nft.port.js';
import { NearException } from '../../../domain/errors.js';
import type {
  AccountId,
  ChainReceipt,
  NftMintInput,
  NftMintResult,
  NftTokenRef,
  NftUpdateMetadataInput,
} from '../../../domain/types.js';
import { resolveNearNetworkConfig } from '../../network/near-network.config.js';
import { NearRpcClient } from '../../rpc/near-rpc.client.js';
import { OpReceiptCache } from './op-receipt-cache.js';

interface ContractStoredNft {
  readonly collection: string;
  readonly token_id: string;
  readonly owner_account_id: string;
  readonly metadata_json: string;
}

function assertPlainJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NearException('NEAR_NFT_INVALID', { message: 'Badge metadata must be a plain JSON object' });
  }
  const check = (v: unknown): void => {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      throw new NearException('NEAR_NFT_INVALID', { message: 'Badge metadata contains non-finite number' });
    }
    if (typeof v === 'bigint' || typeof v === 'function' || typeof v === 'symbol') {
      throw new NearException('NEAR_NFT_INVALID', { message: 'Badge metadata contains non-JSON value' });
    }
    if (Array.isArray(v)) v.forEach(check);
    else if (v && typeof v === 'object') Object.values(v).forEach(check);
  };
  check(value);
  if (JSON.stringify(value).length > 16_384) {
    throw new NearException('NEAR_NFT_INVALID', { message: 'Badge metadata exceeds 16 KB limit' });
  }
  return value as Record<string, unknown>;
}

/**
 * Real NEAR Testnet `BadgeNftPort`: mints and updates colony achievement badges on `deed.<root>.testnet`
 * (`collection: 'badge'`).
 */
@Injectable()
export class TestnetBadgeNftAdapter implements BadgeNftPort {
  private readonly rpc: NearRpcClient;
  private readonly mintCache = new OpReceiptCache<NftMintResult>();
  private readonly updateCache = new OpReceiptCache<ChainReceipt>();

  constructor(@Optional() @Inject(APP_ENV) env?: AppEnv) {
    const source = (env ?? process.env) as Record<string, string | undefined>;
    this.rpc = new NearRpcClient(resolveNearNetworkConfig(source, 'testnet'));
  }

  async mint(input: NftMintInput): Promise<NftMintResult> {
    if (input.collection !== 'badge') {
      throw new NearException('NEAR_NFT_INVALID', { message: `Expected collection "badge", got "${input.collection}"` });
    }
    const cleanMeta = assertPlainJsonObject(input.metadata);
    const tokenId = input.tokenId?.trim() || `badge:${input.opId}`;
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
          settled: false,
        },
      });
      return { tokenId, receipt };
    });
  }

  async updateMetadata(input: NftUpdateMetadataInput): Promise<ChainReceipt> {
    if (input.collection !== 'badge') {
      throw new NearException('NEAR_NFT_INVALID', { message: `Expected collection "badge", got "${input.collection}"` });
    }
    const cleanMeta = assertPlainJsonObject(input.metadata);
    const signer = this.requireOperatorSigner();

    return this.updateCache.run(`upd:${input.opId}`, async () => {
      const existing = await this.rpc.view<ContractStoredNft | null>(this.rpc.config.contracts.deed, 'get_deed', {
        token_id: input.tokenId,
      });
      if (!existing || existing.collection !== 'badge') {
        throw new NearException('NEAR_NFT_NOT_FOUND', { message: `No badge NFT with tokenId ${input.tokenId}` });
      }
      const { receipt } = await this.rpc.call({
        signerAccountId: signer.accountId,
        signerSecretKey: signer.secretKey,
        contractId: this.rpc.config.contracts.deed,
        methodName: 'update_metadata',
        args: {
          op_id: input.opId,
          token_id: input.tokenId,
          metadata_json: JSON.stringify(cleanMeta),
          settled: false,
          explicit_unsettle: true,
        },
      });
      return receipt;
    });
  }

  async ownerOf(input: NftTokenRef): Promise<AccountId | null> {
    if (input.collection !== 'badge') return null;
    const existing = await this.rpc.view<ContractStoredNft | null>(this.rpc.config.contracts.deed, 'get_deed', {
      token_id: input.tokenId,
    });
    if (!existing || existing.collection !== 'badge') return null;
    return existing.owner_account_id;
  }

  private requireOperatorSigner(): { accountId: string; secretKey: string } {
    const secretKey = this.rpc.config.secrets.minterSecretKey;
    if (!secretKey) {
      throw new NearException('NEAR_UNAVAILABLE', { message: 'Missing NEAR_MINTER_SECRET_KEY for BadgeNftPort' });
    }
    return { accountId: this.rpc.config.accounts.minter, secretKey };
  }
}

export const adapter = adapterOf({ port: BadgeNftPort, kind: 'testnet', useClass: TestnetBadgeNftAdapter });

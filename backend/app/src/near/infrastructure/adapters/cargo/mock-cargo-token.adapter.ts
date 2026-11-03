import { Injectable } from '@nestjs/common';
import { RESOURCE_KEYS } from '@terra/contracts';
import type { DbClient } from '@terra/db';
import { adapterOf } from '../../../../ports/adapters.js';
import {
  CARGO_DECIMALS,
  CARGO_MINTER_ACCOUNT,
  CargoTokenPort,
  type BurnCargoInput,
  type CargoBalanceInput,
  type MintCargoInput,
  type TransferCargoInput,
} from '../../../application/ports/cargo-token.port.js';
import { NearException } from '../../../domain/errors.js';
import { TokenAmount, type AccountId, type ChainReceipt, type OpId } from '../../../domain/types.js';
import { MockChainBase } from '../../mock/mock-chain.base.js';

const CARGO_TOKEN_IDS: ReadonlySet<string> = new Set(RESOURCE_KEYS);

/**
 * Mock NEP-245 multi-token adapter (`CargoTokenPort`) on `MockChainBase` (W10-10).
 * Token ids are the 10 `ResourceKey`s in 18-decimal base units, stored in `chain.mock_chain_balance`
 * with NEP-245 receipts (`mt_mint`, `mt_burn`, `mt_transfer`) in `chain.mock_chain_receipt`.
 */
@Injectable()
export class MockCargoTokenAdapter extends MockChainBase implements CargoTokenPort {
  async mint(input: MintCargoInput): Promise<ChainReceipt> {
    this.assertTokenId(input.tokenId);
    this.assertPositiveAmount(input.amount);
    this.assertMinter(input.caller);
    return this.call('CargoToken', 'mt_mint', input.opId, async (tx) => {
      await this.credit(tx, input.to, input.tokenId, input.amount);
      return {
        standard: 'nep245',
        event: 'mt_mint',
        caller: input.caller ?? CARGO_MINTER_ACCOUNT,
        owner_id: input.to,
        token_ids: [input.tokenId],
        amounts: [input.amount],
        decimals: CARGO_DECIMALS,
      };
    });
  }

  async burn(input: BurnCargoInput): Promise<ChainReceipt> {
    this.assertTokenId(input.tokenId);
    this.assertPositiveAmount(input.amount);
    this.assertMinter(input.caller);
    return this.call('CargoToken', 'mt_burn', input.opId, async (tx) => {
      await this.debit(tx, input.from, input.tokenId, input.amount);
      return {
        standard: 'nep245',
        event: 'mt_burn',
        caller: input.caller ?? CARGO_MINTER_ACCOUNT,
        owner_id: input.from,
        token_ids: [input.tokenId],
        amounts: [input.amount],
        decimals: CARGO_DECIMALS,
      };
    });
  }

  async transfer(input: TransferCargoInput): Promise<ChainReceipt> {
    this.assertTokenId(input.tokenId);
    this.assertPositiveAmount(input.amount);
    return this.call('CargoToken', 'mt_transfer', input.opId, async (tx) => {
      await this.debit(tx, input.from, input.tokenId, input.amount);
      await this.credit(tx, input.to, input.tokenId, input.amount);
      return {
        standard: 'nep245',
        event: 'mt_transfer',
        sender_id: input.from,
        receiver_id: input.to,
        token_ids: [input.tokenId],
        amounts: [input.amount],
        decimals: CARGO_DECIMALS,
      };
    });
  }

  async storageDeposit(accountId: AccountId, opId?: OpId): Promise<ChainReceipt> {
    return this.call('CargoToken', 'storage_deposit', opId, async (tx) => {
      await this.ensureAccount(tx, accountId);
      return {
        action: 'storage_deposit',
        account_id: accountId,
      };
    });
  }

  override balanceOf(input: CargoBalanceInput): Promise<TokenAmount>;
  override balanceOf(tx: DbClient, accountId: string, tokenId: string): Promise<string>;
  override async balanceOf(
    inputOrTx: CargoBalanceInput | DbClient,
    accountId?: string,
    tokenId?: string,
  ): Promise<TokenAmount> {
    if (typeof accountId === 'string' && typeof tokenId === 'string') {
      return super.balanceOf(inputOrTx as DbClient, accountId, tokenId);
    }
    const input = inputOrTx as CargoBalanceInput;
    this.assertTokenId(input.tokenId);
    return super.balanceOf(this.prisma, input.accountId, input.tokenId);
  }

  private assertTokenId(tokenId: string): void {
    if (!CARGO_TOKEN_IDS.has(tokenId)) {
      throw new NearException('NEAR_NFT_INVALID', {
        message: `Unknown NEP-245 cargo tokenId "${tokenId}"`,
      });
    }
  }

  private assertPositiveAmount(amount: TokenAmount): void {
    if (!TokenAmount.safeParse(amount).success || BigInt(amount) <= 0n) {
      throw new NearException('NEAR_NFT_INVALID', {
        message: `Invalid NEP-245 cargo amount "${amount}"`,
      });
    }
  }

  private assertMinter(caller?: AccountId): void {
    if (caller !== undefined && caller !== CARGO_MINTER_ACCOUNT) {
      throw new NearException('NEAR_NOT_OWNER', {
        message: `Only ${CARGO_MINTER_ACCOUNT} may mint or burn cargo (got ${caller}).`,
      });
    }
  }
}

export const adapter = adapterOf({ port: CargoTokenPort, kind: 'mock', useClass: MockCargoTokenAdapter });

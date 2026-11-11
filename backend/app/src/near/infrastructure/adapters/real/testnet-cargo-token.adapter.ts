import { Inject, Injectable, Optional } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../../../../core/tokens.js';
import { adapterOf } from '../../../../ports/adapters.js';
import {
  CARGO_MINTER_ACCOUNT,
  CargoTokenPort,
  type BurnCargoInput,
  type CargoBalanceInput,
  type MintCargoInput,
  type TransferCargoInput,
} from '../../../application/ports/cargo-token.port.js';
import { NearException } from '../../../domain/errors.js';
import type { ChainReceipt, TokenAmount } from '../../../domain/types.js';
import { resolveNearNetworkConfig } from '../../network/near-network.config.js';
import { NearRpcClient } from '../../rpc/near-rpc.client.js';
import { OpReceiptCache } from './op-receipt-cache.js';

/**
 * Real NEAR Testnet `CargoTokenPort` (`W23-19`): executes NEP-245 multi-token mint/burn/transfer/balanceOf
 * on `res.<root>.testnet` with `opId` idempotency and canonical `NearException` mapping.
 */
@Injectable()
export class TestnetCargoTokenAdapter implements CargoTokenPort {
  private readonly rpc: NearRpcClient;
  private readonly cache = new OpReceiptCache<ChainReceipt>();

  constructor(@Optional() @Inject(APP_ENV) env?: AppEnv) {
    const source = (env ?? process.env) as Record<string, string | undefined>;
    this.rpc = new NearRpcClient(resolveNearNetworkConfig(source, 'testnet'));
  }

  async mint(input: MintCargoInput): Promise<ChainReceipt> {
    this.assertMinterCaller(input.caller);
    const signer = this.requireMinterSigner();
    return this.cache.run(`mint:${input.opId}`, async () => {
      const { receipt } = await this.rpc.call({
        signerAccountId: signer.accountId,
        signerSecretKey: signer.secretKey,
        contractId: this.rpc.config.contracts.res,
        methodName: 'mt_mint',
        args: {
          op_id: input.opId,
          to: input.to,
          token_id: input.tokenId,
          amount: input.amount,
        },
      });
      return receipt;
    });
  }

  async burn(input: BurnCargoInput): Promise<ChainReceipt> {
    this.assertMinterCaller(input.caller);
    const signer = this.requireMinterSigner();
    return this.cache.run(`burn:${input.opId}`, async () => {
      const { receipt } = await this.rpc.call({
        signerAccountId: signer.accountId,
        signerSecretKey: signer.secretKey,
        contractId: this.rpc.config.contracts.res,
        methodName: 'mt_burn',
        args: {
          op_id: input.opId,
          from: input.from,
          token_id: input.tokenId,
          amount: input.amount,
        },
      });
      return receipt;
    });
  }

  async transfer(input: TransferCargoInput): Promise<ChainReceipt> {
    const signer = this.requireMinterSigner();
    return this.cache.run(`transfer:${input.opId}`, async () => {
      const { receipt } = await this.rpc.call({
        signerAccountId: signer.accountId,
        signerSecretKey: signer.secretKey,
        contractId: this.rpc.config.contracts.res,
        methodName: 'operator_transfer',
        args: {
          op_id: input.opId,
          from: input.from,
          to: input.to,
          token_id: input.tokenId,
          amount: input.amount,
        },
      });
      return receipt;
    });
  }

  async balanceOf(input: CargoBalanceInput): Promise<TokenAmount> {
    return this.rpc.view<string>(this.rpc.config.contracts.res, 'mt_balance_of', {
      account_id: input.accountId,
      token_id: input.tokenId,
    });
  }

  private assertMinterCaller(caller?: string): void {
    if (!caller) return;
    const allowed = new Set([
      CARGO_MINTER_ACCOUNT,
      this.rpc.config.accounts.minter,
      this.rpc.config.rootAccount,
    ]);
    if (!allowed.has(caller)) {
      throw new NearException('NEAR_NOT_OWNER', { message: `Caller ${caller} is not authorized minter` });
    }
  }

  private requireMinterSigner(): { accountId: string; secretKey: string } {
    const secretKey = this.rpc.config.secrets.minterSecretKey;
    if (!secretKey) {
      throw new NearException('NEAR_UNAVAILABLE', { message: 'Missing NEAR_MINTER_SECRET_KEY for CargoTokenPort' });
    }
    return { accountId: this.rpc.config.accounts.minter, secretKey };
  }
}

export const adapter = adapterOf({ port: CargoTokenPort, kind: 'testnet', useClass: TestnetCargoTokenAdapter });

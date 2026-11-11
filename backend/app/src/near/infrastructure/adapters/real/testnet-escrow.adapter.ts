import { Inject, Injectable, Optional } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../../../../core/tokens.js';
import { adapterOf } from '../../../../ports/adapters.js';
import { escrowIdFromOp } from '../../../application/escrow-id.js';
import {
  EscrowActionInput,
  EscrowGetInput,
  EscrowOpenInput,
  EscrowOpenResult,
  EscrowPort,
  EscrowView,
} from '../../../application/ports/escrow.port.js';
import { NearException } from '../../../domain/errors.js';
import type { ChainReceipt } from '../../../domain/types.js';
import { resolveNearNetworkConfig } from '../../network/near-network.config.js';
import { NearRpcClient } from '../../rpc/near-rpc.client.js';
import { OpReceiptCache } from './op-receipt-cache.js';

interface RawChainEscrowView {
  escrow_id: string;
  status: 'open' | 'claimed' | 'refunded';
  funder: string;
  beneficiary: string;
  token_id: string;
  amount: string;
  expires_at_ms: number;
}

/**
 * Real NEAR Testnet `EscrowPort` (`W23-40`): executes bounty & mercenary escrow holds, claims,
 * and full/partial refunds on `bounty.<root>.testnet` paired with NEP-245 cargo settlement on `res.<root>.testnet`.
 */
@Injectable()
export class TestnetEscrowAdapter implements EscrowPort {
  private readonly rpc: NearRpcClient;
  private readonly openCache = new OpReceiptCache<EscrowOpenResult>();
  private readonly actionCache = new OpReceiptCache<ChainReceipt>();
  private creditSeq = 0;

  constructor(@Optional() @Inject(APP_ENV) env?: AppEnv) {
    const source = (env ?? process.env) as Record<string, string | undefined>;
    this.rpc = new NearRpcClient(resolveNearNetworkConfig(source, 'testnet'));
  }

  async open(raw: EscrowOpenInput): Promise<EscrowOpenResult> {
    const input = EscrowOpenInput.parse(raw);
    const signer = this.requireOperatorSigner();
    return this.openCache.run(`open:${input.opId}`, async () => {
      const escrowId = escrowIdFromOp(input.opId);
      await this.transferCargo(`esc-hold:${input.opId}`, input.funder, escrowId, input.tokenId, input.amount);
      const { receipt } = await this.rpc.call({
        signerAccountId: signer.accountId,
        signerSecretKey: signer.secretKey,
        contractId: this.rpc.config.contracts.bounty,
        methodName: 'open_escrow',
        args: {
          op_id: input.opId,
          escrow_id: escrowId,
          funder: input.funder,
          beneficiary: input.beneficiary,
          token_id: input.tokenId,
          amount: input.amount,
          expires_at_ms: input.expiresAtMs ?? 0,
        },
      });
      return EscrowOpenResult.parse({ escrowId, receipt });
    });
  }

  async claim(raw: EscrowActionInput): Promise<ChainReceipt> {
    const input = EscrowActionInput.parse(raw);
    const signer = this.requireOperatorSigner();
    return this.actionCache.run(`claim:${input.opId}`, async () => {
      const row = await this.fetchOpenRow(input.escrowId);
      const { receipt } = await this.rpc.call({
        signerAccountId: signer.accountId,
        signerSecretKey: signer.secretKey,
        contractId: this.rpc.config.contracts.bounty,
        methodName: 'claim_escrow',
        args: {
          op_id: input.opId,
          escrow_id: input.escrowId,
          caller: input.caller,
        },
      });
      await this.transferCargo(`esc-claim:${input.opId}`, input.escrowId, input.caller, row.token_id, row.amount);
      return receipt;
    });
  }

  async refund(raw: EscrowActionInput): Promise<ChainReceipt> {
    const input = EscrowActionInput.parse(raw);
    const signer = this.requireOperatorSigner();
    return this.actionCache.run(`refund:${input.opId}`, async () => {
      const row = await this.fetchOpenRow(input.escrowId);
      const whole = BigInt(row.amount);
      const requested = input.amount === undefined ? whole : BigInt(input.amount);
      if (requested > whole) {
        throw new NearException('NEAR_ESCROW_STATE', { details: { escrowId: input.escrowId, amount: input.amount } });
      }
      const { receipt } = await this.rpc.call({
        signerAccountId: signer.accountId,
        signerSecretKey: signer.secretKey,
        contractId: this.rpc.config.contracts.bounty,
        methodName: 'refund_escrow',
        args: {
          op_id: input.opId,
          escrow_id: input.escrowId,
          _caller: input.caller,
          amount: input.amount ?? null,
        },
      });
      if (requested > 0n) {
        await this.transferCargo(
          `esc-ref:${input.opId}`,
          input.escrowId,
          row.funder,
          row.token_id,
          requested.toString(),
        );
      }
      return receipt;
    });
  }

  async get(raw: EscrowGetInput): Promise<EscrowView> {
    const input = EscrowGetInput.parse(raw);
    const row = await this.rpc.view<RawChainEscrowView | null>(this.rpc.config.contracts.bounty, 'get_escrow', {
      escrow_id: input.escrowId,
    });
    if (!row) {
      throw new NearException('NEAR_ESCROW_NOT_FOUND', { details: { escrowId: input.escrowId } });
    }
    return EscrowView.parse({
      escrowId: row.escrow_id,
      status: row.status,
      funder: row.funder,
      beneficiary: row.beneficiary,
      tokenId: row.token_id,
      amount: row.amount,
      expiresAtMs: 0,
    });
  }

  /** Contract-suite seam (`W23-40`): raises `accountId` up to `amount` of `tokenId` on `res.<root>.testnet`. */
  async creditCargo(accountId: string, tokenId: string, amount: string): Promise<void> {
    const have = BigInt(await this.readCargoBalance(accountId, tokenId));
    const target = BigInt(amount);
    if (have >= target) return;
    const signer = this.requireOperatorSigner();
    const seq = ++this.creditSeq;
    await this.rpc.call({
      signerAccountId: signer.accountId,
      signerSecretKey: signer.secretKey,
      contractId: this.rpc.config.contracts.res,
      methodName: 'mt_mint',
      args: {
        op_id: `esc-seed:${Date.now().toString(36)}:${seq}`,
        to: this.toCargoAccount(accountId),
        token_id: tokenId,
        amount: (target - have).toString(),
      },
    });
  }

  /** Contract-suite seam (`W23-40`): reads on-chain NEP-245 balance for an account or `escrow:<hex>` hold id. */
  async readCargoBalance(accountId: string, tokenId: string): Promise<string> {
    return this.rpc.view<string>(this.rpc.config.contracts.res, 'mt_balance_of', {
      account_id: this.toCargoAccount(accountId),
      token_id: tokenId,
    });
  }

  private async fetchOpenRow(escrowId: string): Promise<RawChainEscrowView> {
    const row = await this.rpc.view<RawChainEscrowView | null>(this.rpc.config.contracts.bounty, 'get_escrow', {
      escrow_id: escrowId,
    });
    if (!row) {
      throw new NearException('NEAR_ESCROW_NOT_FOUND', { details: { escrowId } });
    }
    if (row.status !== 'open') {
      throw new NearException('NEAR_ESCROW_STATE', { details: { escrowId, status: row.status } });
    }
    return row;
  }

  private async transferCargo(
    opId: string,
    from: string,
    to: string,
    tokenId: string,
    amount: string,
  ): Promise<void> {
    const signer = this.requireOperatorSigner();
    await this.rpc.call({
      signerAccountId: signer.accountId,
      signerSecretKey: signer.secretKey,
      contractId: this.rpc.config.contracts.res,
      methodName: 'operator_transfer',
      args: {
        op_id: opId,
        from: this.toCargoAccount(from),
        to: this.toCargoAccount(to),
        token_id: tokenId,
        amount,
      },
    });
  }

  /** Maps `escrow:<32hex>` hold identifiers onto a syntactically valid NEAR `AccountId` for `res.<root>.testnet`. */
  private toCargoAccount(id: string): string {
    const match = /^escrow:([0-9a-f]{32})$/.exec(id);
    if (match) return `hold-${match[1]}.${this.rpc.config.rootAccount}`;
    return id;
  }

  private requireOperatorSigner(): { accountId: string; secretKey: string } {
    const secretKey = this.rpc.config.secrets.minterSecretKey;
    if (!secretKey) {
      throw new NearException('NEAR_UNAVAILABLE', { message: 'Missing NEAR_MINTER_SECRET_KEY for EscrowPort' });
    }
    return { accountId: this.rpc.config.accounts.minter, secretKey };
  }
}

export const adapter = adapterOf({ port: EscrowPort, kind: 'testnet', useClass: TestnetEscrowAdapter });

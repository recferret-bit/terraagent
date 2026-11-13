import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PrismaClient } from '@terra/db';
import { databaseEnabled } from '../../../../core/persistence.js';
import { APP_ENV, type AppEnv } from '../../../../core/tokens.js';
import { PRISMA } from '../../../../db/db.module.js';
import { adapterOf } from '../../../../ports/adapters.js';
import {
  AddMemberInput,
  CreateDaoInput,
  type CreateDaoResult,
  DaoDepositInput,
  DaoGetInput,
  DaoView,
  FinalizeInput,
  ProposeInput,
  type ProposeResult,
  RemoveMemberInput,
  TreasuryDaoPort,
  VoteInput,
} from '../../../application/ports/treasury-dao.port.js';
import { NearException } from '../../../domain/errors.js';
import type { ChainReceipt } from '../../../domain/types.js';
import { PASS_ABOVE_BP, PASS_MIN_YES, tallyMemberVotes, type DaoVoteValue } from '../../../treasury/pass-rule.js';
import { daoAccountIdFor, readCost } from '../../../treasury/policy.js';
import { insertDaoIfMissing } from '../../../treasury/store.js';
import { resolveNearNetworkConfig } from '../../network/near-network.config.js';
import { NearRpcClient } from '../../rpc/near-rpc.client.js';
import { OpReceiptCache } from './op-receipt-cache.js';

interface ContractDaoRecord {
  readonly dao_account_id: string;
  readonly name: string;
  readonly members: readonly { readonly account_id: string; readonly can_propose: boolean }[];
  readonly balances: Readonly<Record<string, string>>;
  readonly proposals: readonly {
    readonly id: number;
    readonly proposer: string;
    readonly status: 'InProgress' | 'Approved' | 'Rejected' | 'Expired';
    readonly votes: readonly { readonly voter: string; readonly vote: DaoVoteValue }[];
    readonly kind: string;
    readonly description: string;
  }[];
}

function parseSuccessJson<T>(outcome: unknown): T | undefined {
  if (!outcome || typeof outcome !== 'object' || !('status' in outcome)) return undefined;
  const s = (outcome as { status?: unknown }).status;
  if (typeof s === 'object' && s !== null && 'SuccessValue' in s && typeof s.SuccessValue === 'string' && s.SuccessValue.length > 0) {
    return JSON.parse(Buffer.from(s.SuccessValue, 'base64').toString('utf8')) as T;
  }
  return undefined;
}

/**
 * Real NEAR Testnet `TreasuryDaoPort`: manages planet council treasuries, token deposits,
 * quorum voting, and proposal finalization on `dao.<root>.testnet`.
 */
@Injectable()
export class TestnetTreasuryDaoAdapter implements TreasuryDaoPort {
  private readonly rpc: NearRpcClient;
  private readonly envSource: Record<string, string | undefined>;
  private readonly prisma: PrismaClient | null;
  private readonly createCache = new OpReceiptCache<CreateDaoResult>();
  private readonly proposeCache = new OpReceiptCache<ProposeResult>();
  private readonly txCache = new OpReceiptCache<ChainReceipt>();

  constructor(
    @Optional() @Inject(APP_ENV) env?: AppEnv,
    @Optional() @Inject(PRISMA) prisma?: PrismaClient,
  ) {
    this.envSource = (env ?? process.env) as Record<string, string | undefined>;
    this.rpc = new NearRpcClient(resolveNearNetworkConfig(this.envSource, 'testnet'));
    this.prisma = databaseEnabled(env) && prisma ? prisma : null;
  }

  async createDao(raw: CreateDaoInput): Promise<CreateDaoResult> {
    const input = CreateDaoInput.parse(raw);
    const daoAccountId = daoAccountIdFor(input.name, this.envSource);
    const signer = this.requireOperatorSigner();
    return this.createCache.run(`create:${input.opId}`, async () => {
      const { receipt } = await this.rpc.call({
        signerAccountId: signer.accountId,
        signerSecretKey: signer.secretKey,
        contractId: this.rpc.config.contracts.dao,
        methodName: 'create_dao',
        args: {
          op_id: input.opId,
          dao_account_id: daoAccountId,
          name: input.name,
          council_account_ids: input.councilAccountIds,
        },
      });
      if (this.prisma && 'mockChainDao' in this.prisma && this.prisma.mockChainDao) {
        await insertDaoIfMissing(this.prisma, daoAccountId, input.name, input.councilAccountIds);
      }
      return { daoAccountId, receipt };
    });
  }

  async propose(raw: ProposeInput): Promise<ProposeResult> {
    const input = ProposeInput.parse(raw);
    const priced = readCost(input.payload);
    const signer = this.requireOperatorSigner();
    return this.proposeCache.run(`propose:${input.opId}`, async () => {
      const { receipt, outcome } = await this.rpc.call({
        signerAccountId: signer.accountId,
        signerSecretKey: signer.secretKey,
        contractId: this.rpc.config.contracts.dao,
        methodName: 'propose',
        args: {
          op_id: input.opId,
          dao_account_id: input.daoAccountId,
          proposer: input.proposer,
          description: input.description,
          kind: input.kind,
          payload_json: JSON.stringify(input.payload),
          cost: priced.cost ?? null,
          token_id: priced.tokenId ?? null,
        },
      });
      const proposalId = parseSuccessJson<number>(outcome) ?? 0;
      return { proposalId, receipt };
    });
  }

  async vote(raw: VoteInput): Promise<ChainReceipt> {
    const input = VoteInput.parse(raw);
    const signer = this.requireOperatorSigner();
    return this.txCache.run(`vote:${input.opId}`, async () => {
      const { receipt } = await this.rpc.call({
        signerAccountId: signer.accountId,
        signerSecretKey: signer.secretKey,
        contractId: this.rpc.config.contracts.dao,
        methodName: 'vote',
        args: {
          op_id: input.opId,
          dao_account_id: input.daoAccountId,
          proposal_id: input.proposalId,
          voter: input.voter,
          vote: input.vote,
          pass_above_bp: PASS_ABOVE_BP,
          pass_min_yes: PASS_MIN_YES,
        },
      });
      return receipt;
    });
  }

  async finalize(raw: FinalizeInput): Promise<ChainReceipt> {
    const input = FinalizeInput.parse(raw);
    const signer = this.requireOperatorSigner();
    return this.txCache.run(`finalize:${input.opId}`, async () => {
      const { receipt } = await this.rpc.call({
        signerAccountId: signer.accountId,
        signerSecretKey: signer.secretKey,
        contractId: this.rpc.config.contracts.dao,
        methodName: 'finalize',
        args: {
          op_id: input.opId,
          dao_account_id: input.daoAccountId,
          proposal_id: input.proposalId,
          pass_above_bp: PASS_ABOVE_BP,
          pass_min_yes: PASS_MIN_YES,
        },
      });
      return receipt;
    });
  }

  async deposit(raw: DaoDepositInput): Promise<ChainReceipt> {
    const input = DaoDepositInput.parse(raw);
    const signer = this.requireOperatorSigner();
    return this.txCache.run(`deposit:${input.opId}`, async () => {
      const { receipt } = await this.rpc.call({
        signerAccountId: signer.accountId,
        signerSecretKey: signer.secretKey,
        contractId: this.rpc.config.contracts.dao,
        methodName: 'deposit',
        args: {
          op_id: input.opId,
          dao_account_id: input.daoAccountId,
          from: input.from,
          token_id: input.tokenId,
          amount: input.amount,
        },
      });
      return receipt;
    });
  }

  async addMember(raw: AddMemberInput): Promise<ChainReceipt> {
    const input = AddMemberInput.parse(raw);
    const signer = this.requireOperatorSigner();
    return this.txCache.run(`add:${input.opId}`, async () => {
      const { receipt } = await this.rpc.call({
        signerAccountId: signer.accountId,
        signerSecretKey: signer.secretKey,
        contractId: this.rpc.config.contracts.dao,
        methodName: 'add_member',
        args: {
          op_id: input.opId,
          dao_account_id: input.daoAccountId,
          member: input.member,
          can_propose: input.canPropose ?? null,
        },
      });
      return receipt;
    });
  }

  async removeMember(raw: RemoveMemberInput): Promise<ChainReceipt> {
    const input = RemoveMemberInput.parse(raw);
    const signer = this.requireOperatorSigner();
    return this.txCache.run(`remove:${input.opId}`, async () => {
      const { receipt } = await this.rpc.call({
        signerAccountId: signer.accountId,
        signerSecretKey: signer.secretKey,
        contractId: this.rpc.config.contracts.dao,
        methodName: 'remove_member',
        args: {
          op_id: input.opId,
          dao_account_id: input.daoAccountId,
          member: input.member,
        },
      });
      return receipt;
    });
  }

  async get(raw: DaoGetInput): Promise<DaoView> {
    const input = DaoGetInput.parse(raw);
    const rec = await this.rpc.view<ContractDaoRecord>(this.rpc.config.contracts.dao, 'get_dao', {
      dao_account_id: input.daoAccountId,
    });
    const memberIds = rec.members.map((m) => m.account_id);
    return DaoView.parse({
      daoAccountId: rec.dao_account_id,
      name: rec.name,
      members: rec.members.map((m) => ({ accountId: m.account_id, canPropose: m.can_propose })),
      balances: rec.balances,
      proposals: rec.proposals.map((p) => {
        const tally = tallyMemberVotes(p.votes, memberIds);
        return {
          proposalId: p.id,
          proposer: p.proposer,
          kind: p.kind,
          description: p.description,
          state: p.status,
          yes: tally.yes,
          no: tally.no,
          votes: p.votes.map((v) => ({ voter: v.voter, vote: v.vote })),
        };
      }),
    });
  }

  private requireOperatorSigner(): { accountId: string; secretKey: string } {
    const secretKey = this.rpc.config.secrets.minterSecretKey;
    if (!secretKey) {
      throw new NearException('NEAR_UNAVAILABLE', { message: 'Missing NEAR_MINTER_SECRET_KEY for TreasuryDaoPort' });
    }
    return { accountId: this.rpc.config.accounts.minter, secretKey };
  }
}

export const adapter = adapterOf({ port: TreasuryDaoPort, kind: 'testnet', useClass: TestnetTreasuryDaoAdapter });

import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { MARKET_TOKENS, formatAtomic, mockLabel, parseDisplayAmount, toChainUnits, type MarketTokenKey } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { z } from 'zod';
import { CoreException } from '../../core/errors/index.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { PRISMA } from '../../db/db.module.js';
import { FlagsService } from '../../flags/flags.service.js';

export const FAUCET_TOKENS = ['USDC', 'NEAR'] as const;
/** Dev guard rail per call, in whole tokens (not a balance number of the game). */
const MAX_WHOLE: Record<(typeof FAUCET_TOKENS)[number], bigint> = { USDC: 100_000n, NEAR: 10_000n };

export const FaucetArgs = z.strictObject({
  colonyId: z.string().min(1).optional(),
  playerId: z.string().min(1).optional(),
  token: z.preprocess((v) => (typeof v === 'string' ? v.toUpperCase() : v), z.enum(FAUCET_TOKENS)),
  /** Whole-token display amount, exact (`"20"`, `"10.50"`); more decimals than the token has are rejected. */
  amount: z.union([z.string(), z.number()]).transform(String),
}).refine((a) => Boolean(a.colonyId) !== Boolean(a.playerId), 'give exactly one of colonyId or playerId');
export type FaucetArgs = z.output<typeof FaucetArgs>;

export interface FaucetResult {
  readonly accountId: string;
  readonly token: MarketTokenKey;
  readonly amountAtomic: string;
  readonly display: string;
  readonly label: string;
  readonly funding: 'fixture';
  readonly noteId: string;
}

/**
 * Dev-only mock faucet (W13-17): credits a colony account's balance in the mock `intents.near` verifier ledger. It is a
 * fixture/subsidy funding, never organic: the note is a `mock_chain_intent` row (`signer faucet.mock`, `diff.actorKind
 * "fixture"`) and nothing here touches the game ledger or the order book.
 */
@Injectable()
export class MarketFaucetService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly flags: FlagsService,
  ) {}

  async credit(raw: unknown): Promise<FaucetResult> {
    if (this.env.NODE_ENV === 'production') throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
    if (!this.flags.has('W13')) throw new CoreException('wave_disabled', { status: 403, message: 'Markets are off', details: { code: 'wave_disabled' } });
    const args = FaucetArgs.parse(raw);
    const token = args.token;
    let atomic: bigint;
    try {
      atomic = parseDisplayAmount(token, args.amount);
    } catch (e) {
      throw new CoreException('VALIDATION_ERROR', { status: 400, message: (e as Error).message });
    }
    if (atomic <= 0n || atomic > MAX_WHOLE[token] * 10n ** BigInt(MARKET_TOKENS[token].decimals)) {
      throw new CoreException('VALIDATION_ERROR', { status: 400, message: `amount must be > 0 and at most ${MAX_WHOLE[token]} ${token}` });
    }
    const account = await this.prisma.nearColonyAccount.findFirst({
      where: args.colonyId ? { colonyId: args.colonyId } : { playerId: args.playerId },
      orderBy: { createdAt: 'asc' },
    });
    if (!account) throw new CoreException('NOT_FOUND', { status: 404, message: 'No colony account for that colony/player' });

    const chain = toChainUnits(token, atomic).toString();
    const tokenId = MARKET_TOKENS[token].verifierId;
    const noteId = `faucet-${randomUUID()}`;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO chain.mock_chain_intents_balance (account_id, token_id, amount) VALUES (${account.accountId}, ${tokenId}, ${chain}::numeric)
        ON CONFLICT (account_id, token_id) DO UPDATE SET amount = chain.mock_chain_intents_balance.amount + EXCLUDED.amount`;
      await tx.mockChainIntent.create({
        data: {
          id: noteId, signer: 'faucet.mock', status: 'executed', opId: `faucet:${noteId}`,
          diff: { kind: 'faucet', actorKind: 'fixture', funding: 'fixture', organic: false, accountId: account.accountId, token, amountAtomic: atomic.toString() },
        },
      });
    });
    return { accountId: account.accountId, token, amountAtomic: atomic.toString(), display: formatAtomic(token, atomic), label: mockLabel(token), funding: 'fixture', noteId };
  }
}

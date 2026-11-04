import { Inject, Injectable } from '@nestjs/common';
import { MARKET_TOKENS, MarketTokenKey } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { adapterOf } from '../../../../ports/adapters.js';
import { PRISMA } from '../../../../db/db.module.js';
import { IntentsBalanceReadPort } from '../../../application/ports/intents-balance-read.port.js';
import { verifierBalance, verifierBalances, verifierChainBalance } from './intents-ledger.js';

/** Mock read side of the verifier ledger (`chain.mock_chain_intents_balance`). No latency, no failure injection. */
@Injectable()
export class MockIntentsBalanceReadAdapter extends IntentsBalanceReadPort {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {
    super();
  }

  verifierBalance(accountId: string, token: string): Promise<bigint> {
    return verifierBalance(this.prisma, accountId, this.verifierId(token));
  }

  verifierChainBalance(accountId: string, token: string): Promise<bigint> {
    return verifierChainBalance(this.prisma, accountId, this.verifierId(token));
  }

  private verifierId(token: string): string {
    const key = MarketTokenKey.safeParse(token);
    return key.success ? MARKET_TOKENS[key.data].verifierId : token;
  }

  verifierBalances(accountId: string) {
    return verifierBalances(this.prisma, accountId);
  }
}

export const adapter = adapterOf({ port: IntentsBalanceReadPort, kind: 'mock', useClass: MockIntentsBalanceReadAdapter });

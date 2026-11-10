import { Inject, Injectable } from '@nestjs/common';
import type { ResourceKey } from '@terra/contracts';
import { directorAutoOrder } from '@terra/sim';
import { withinAutoTrade } from '@terra/sim/systems/away/auto-trade';
import { AgentWalletPort } from '../../near/application/ports/agent-wallet.port.js';
import { DirectorKeyRepository } from '../../near/director-key/director-key.repository.js';
import { DirectorColonySource } from './director-source.js';

export interface DirectorMatchInput {
  readonly colonyId: string;
  readonly resource: ResourceKey;
  readonly amount: number;
  readonly side: 'buy' | 'sell';
}

function whole(amount: string | undefined): number | undefined {
  if (!amount || !/^(0|[1-9]\d*)$/.test(amount)) return undefined;
  const n = Number(amount);
  return Number.isSafeInteger(n) ? n : undefined;
}

/**
 * Second `withinAutoTrade` call (W15-20), after the sim's `decideDirectorTrade`.
 * A missing key, a revoked key, or no limit for the resource fails closed: the order must not match.
 * Caps are not reimplemented here.
 */
@Injectable()
export class DirectorMatchGuard {
  constructor(
    @Inject(DirectorColonySource) private readonly source: DirectorColonySource,
    @Inject(DirectorKeyRepository) private readonly keys: DirectorKeyRepository,
    @Inject(AgentWalletPort) private readonly wallet: AgentWalletPort,
  ) {}

  async block(input: DirectorMatchInput): Promise<'autotrade_limit' | undefined> {
    const spent = await this.sessionSpent(input.colonyId, input.resource);
    if (spent === undefined) return 'autotrade_limit';
    const view = await this.source.load(input.colonyId);
    const row = view?.rows.find((item) => item.forecast.resource === input.resource);
    const limit = row?.forecast.limit;
    if (!row || !limit) return 'autotrade_limit';
    const order = directorAutoOrder({ ...row.forecast, sessionSpent: spent }, input);
    return withinAutoTrade(limit, order) ? undefined : 'autotrade_limit';
  }

  /** Key `spent` for this resource. Undefined when the cap cannot be read (fail closed). */
  private async sessionSpent(colonyId: string, resource: string): Promise<number | undefined> {
    const key = await this.keys.find(colonyId);
    if (!key || key.revokedAt) return undefined;
    const status = await this.wallet.keyStatus({ accountId: key.accountId, publicKey: key.publicKey });
    if (status.revoked) return undefined;
    return whole(status.tokens.find((token) => token.token === resource)?.spent);
  }
}

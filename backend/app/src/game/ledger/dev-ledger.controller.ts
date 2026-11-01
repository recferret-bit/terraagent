import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import type { LedgerView } from '@terra/sim';
import { CoreException } from '../../core/errors';
import { APP_ENV, type AppEnv } from '../../core/tokens';
import { assertDevOnly } from '../dev-planets.controller';
import { PlanetLedgerService } from './planet-ledger.service';

export const DEFAULT_LEDGER_ACCOUNT = 'colony:0';
export const DEFAULT_LEDGER_LIMIT = 10;
export const MAX_LEDGER_LIMIT = 1000;
const ACCOUNT_RE = /^[a-z]+:[A-Za-z0-9_.-]{1,64}$/;

/**
 * Dev-only: a loaded planet's server ledger (D-34), `GET /v1/dev/planets/:planetId/ledger?account=colony:0&limit=10`
 * → `{ planetId, account, balances, entries }` (entries newest last). Clients never get the journal otherwise. 404 in
 * production and for a planet that is not loaded; 503 `LEDGER_UNAVAILABLE` while its restore is still pending (the
 * database is down: the restore is retried) or after it was abandoned at shutdown.
 */
@Controller('dev')
export class DevLedgerController {
  constructor(private readonly ledger: PlanetLedgerService, @Inject(APP_ENV) private readonly env: AppEnv) {}

  @Get('planets/:planetId/ledger')
  async get(@Param('planetId') planetId: string, @Query('account') account?: string, @Query('limit') limit?: string): Promise<LedgerView> {
    assertDevOnly(this.env);
    const acc = account ?? DEFAULT_LEDGER_ACCOUNT;
    if (!ACCOUNT_RE.test(acc)) throw new CoreException('BAD_REQUEST', { status: 400, message: `bad account "${acc}" (e.g. colony:0, sys:construction)` });
    const view = await this.ledger.view(planetId, acc, parseLimit(limit));
    if (!view) throw new CoreException('NOT_FOUND', { status: 404, message: `planet ${planetId} is not loaded` });
    return view;
  }
}

/** `limit` query → 1..{@link MAX_LEDGER_LIMIT}; absent or not a number → {@link DEFAULT_LEDGER_LIMIT}. */
export function parseLimit(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return DEFAULT_LEDGER_LIMIT;
  return Math.min(MAX_LEDGER_LIMIT, Math.max(1, n));
}

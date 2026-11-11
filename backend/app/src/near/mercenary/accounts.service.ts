import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { FlagsService } from '../../flags/flags.service.js';
import { AgentWalletPort } from '../application/ports/agent-wallet.port.js';
import { NearException } from '../domain/errors.js';
import { mercenaryRoster, type MercenaryRosterEntry } from './roster.js';

/**
 * Creates the mercenary sub-accounts on boot (W22-27, NEAR-112).
 * The opId is `merc-account:{accountId}`, so a second boot does not insert another row.
 * W22 off creates none. `fundingCap` is the roster ceiling (LED-33) and is not minted.
 */
@Injectable()
export class MercenaryAccountsService implements OnModuleInit {
  private readonly log = new Logger(MercenaryAccountsService.name);
  private entries: readonly MercenaryRosterEntry[] = [];

  constructor(
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(AgentWalletPort) private readonly wallet: AgentWalletPort,
  ) {}

  onModuleInit(): Promise<void> {
    return this.ensure().then(
      () => undefined,
      (err: unknown) => {
        this.log.warn(`mercenary accounts were not created: ${err instanceof Error ? err.message : String(err)}`);
      },
    );
  }

  roster(): readonly MercenaryRosterEntry[] {
    return this.entries;
  }

  async ensure(): Promise<readonly MercenaryRosterEntry[]> {
    const rows = mercenaryRoster(this.flags);
    if (rows.length === 0) {
      this.entries = [];
      return [];
    }
    for (const row of rows) await this.openAccount(row);
    this.entries = rows;
    return this.entries;
  }

  private async openAccount(row: MercenaryRosterEntry): Promise<void> {
    try {
      const created = await this.wallet.createSubAccount({
        opId: `merc-account:${row.accountId}`,
        parent: row.parent,
        name: row.name,
      });
      if (created.accountId !== row.accountId) {
        throw new Error(`expected ${row.accountId}, wallet returned ${created.accountId}`);
      }
    } catch (err) {
      if (err instanceof NearException && err.errorCode === 'NEAR_ACCOUNT_EXISTS') return;
      throw err;
    }
  }
}

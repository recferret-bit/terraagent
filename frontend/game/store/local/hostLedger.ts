import { createLedgerState, Ledger } from '@terra/ledger';
import { LEDGER_REASONS, colonyAccount, getColonyStock, isSystemAccount, type LedgerPosting, type PlanetState } from '@terra/sim';
import type { LedgerReply } from '../../net/devServer';

/** Journal entries a browser host keeps; older ones fold into the ledger's opening balances. */
export const HOST_JOURNAL_LIMIT = 1024;

/**
 * The resource journal of a browser host (`?host=local` worker, or the in-process fallback `LocalHost`): an in-memory
 * `@terra/ledger` fed by `SimHost.onPostings`, the browser counterpart of the server's Postgres ledger. It stays on the
 * host: the client store / replica only ever gets `col.stock`, never postings or entries.
 */
export class HostLedger {
  private readonly ledger = new Ledger(createLedgerState({ journalLimit: HOST_JOURNAL_LIMIT }), isSystemAccount);

  /**
   * A ledger for a planet the host adopts as is (a resumed snapshot, or a scenario planet whose setup steps ran before
   * the host subscribed). The journal that produced its stock is gone, so each colony's `col.stock` is opened with one
   * `ledger.opening` posting from `sys:opening` by `actor` (`system:resume`, `system:seed`): balances match the
   * stock from here on, and `sys:*` totals (e.g. `sys:construction`) only count what happens after this point.
   */
  static open(state: PlanetState, actor: string): HostLedger {
    const out = new HostLedger();
    const tick = state.meta.tick;
    state.colonies.forEach((_col, i) => {
      // all-zero stock has no legs (the ledger rejects an empty entry): nothing to open
      out.ledger.transfer(LEDGER_REASONS['ledger.opening'].counter, colonyAccount(i), getColonyStock(state, i), { at: tick, reason: 'ledger.opening', actor });
    });
    return out;
  }

  /** A ledger replaying `postings` from the planet's first step (e.g. a scenario's setup: the real `landing.cargo`). */
  static replay(postings: readonly LedgerPosting[]): { ledger: HostLedger; problems: string[] } {
    const ledger = new HostLedger();
    return { ledger, problems: ledger.record(postings) };
  }

  /** Posts a step's postings; returns a description of every one the ledger rejected (stock and journal disagree). */
  record(postings: readonly LedgerPosting[]): string[] {
    const problems: string[] = [];
    for (const p of postings) {
      const r = this.ledger.post(p);
      if (!r.ok) problems.push(`ledger rejected ${p.reason} by ${p.actor}: ${r.code}${r.detail ? ` (${r.detail})` : ''}`);
    }
    return problems;
  }

  /** Same shape as `GET /v1/dev/planets/:planetId/ledger`: the account's balances and its last `limit` entries, oldest first. */
  view(planetId: string, account: string, limit: number): LedgerReply {
    return { planetId, account, balances: this.ledger.balances(account), entries: this.ledger.entries({ account }).slice(-Math.max(1, limit)) };
  }
}

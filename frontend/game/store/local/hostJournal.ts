import type { LedgerState } from '@terra/ledger';
import { PlanetJournal, type PlanetState } from '@terra/sim';

/** The shared formatter for a refused posting (same text on every host). */
export { describeJournalProblem } from '@terra/sim';

/**
 * The browser persistence of the shared `PlanetJournal`: a resumed IndexedDB snapshot continues the journal saved with
 * it when that journal is intact (`verify`) and explains every colony's `col.stock` (`reconcile`). Otherwise (no saved
 * journal, malformed, or inconsistent) the history is opened from `col.stock` by `system:resume`, and `problem` says why
 * when there was a saved journal to refuse.
 */
export function resumeJournal(saved: LedgerState | undefined, state: PlanetState): { journal: PlanetJournal; problem?: string } {
  if (!saved) return { journal: PlanetJournal.open(state, 'system:resume') };
  let why: string;
  try {
    const journal = PlanetJournal.fromState(saved);
    const check = journal.verify();
    const mismatches = check.ok ? journal.reconcile(state) : [];
    if (check.ok && mismatches.length === 0) return { journal };
    why = !check.ok
      ? check.problems.slice(0, 3).join('; ')
      : mismatches.slice(0, 3).map((m) => `${m.account} ${m.asset}: journal ${m.ledger}, stock ${m.state}`).join('; ');
  } catch (e) {
    why = `malformed (${e instanceof Error ? e.message : String(e)})`;
  }
  return { journal: PlanetJournal.open(state, 'system:resume'), problem: `saved ledger journal does not match the snapshot, reopened from col.stock: ${why}` };
}

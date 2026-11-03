import { colonyAccountId, MOCK_ACCOUNT_ROOT, NearAccountId } from '@terra/contracts';

/** `NearAccountId` and `chain.near_colony_account.account_id` both stop at 64 (BE-42). */
export const COLONY_ACCOUNT_MAX = 64;

const SUFFIX_ATTEMPTS = 20;

const TOO_LONG = 'colony account id cannot fit in 64 characters without dropping the colony id';

/** Characters left for `{name}` after `{colony}.` and `.terraagent.mock`. */
export function colonyNameBudget(colonyId: string): number {
  return COLONY_ACCOUNT_MAX - colonyId.toLowerCase().length - MOCK_ACCOUNT_ROOT.length - 2;
}

function fits(accountId: string): boolean {
  return accountId.length <= COLONY_ACCOUNT_MAX && NearAccountId.safeParse(accountId).success;
}

/** Cut to `budget` and drop a trailing `-` so the segment stays a valid account label. */
function clipStem(playerName: string, budget: number): string {
  const cut = playerName.slice(0, Math.max(0, budget)).replace(/-+$/g, '');
  if (cut.length >= 1) return cut;
  return budget >= 1 ? 'p' : '';
}

/**
 * `{colony}.{name}.terraagent.mock` that fits in 64 characters.
 * The colony segment stays whole. Only the name stem is shortened.
 * `suffix` (for example `-2`) is kept in full when the budget allows (BE-42).
 */
export function fitColonyAccountId(colonyId: string, playerName: string, suffix = ''): string {
  const budget = colonyNameBudget(colonyId) - suffix.length;
  if (budget < 1) throw new Error(TOO_LONG);
  const natural = colonyAccountId(colonyId, `${playerName}${suffix}`);
  if (playerName.length <= budget && fits(natural)) return natural;
  let stem = clipStem(playerName, budget);
  let accountId = colonyAccountId(colonyId, `${stem}${suffix}`);
  while (!fits(accountId) && stem.length > 1) {
    stem = clipStem(stem.slice(0, -1), budget);
    accountId = colonyAccountId(colonyId, `${stem}${suffix}`);
  }
  if (!fits(accountId)) throw new Error(TOO_LONG);
  return accountId;
}

/** Fitting id, then `-2` … so a shortened stem that is already taken can still be unique. */
export function colonyAccountCandidates(colonyId: string, playerName: string): readonly string[] {
  const ids = [fitColonyAccountId(colonyId, playerName)];
  for (let n = 2; n <= SUFFIX_ATTEMPTS; n += 1) {
    const suffix = `-${n}`;
    if (colonyNameBudget(colonyId) <= suffix.length) break;
    const id = fitColonyAccountId(colonyId, playerName, suffix);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

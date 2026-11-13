import { colonyAccountId, MOCK_ACCOUNT_ROOT, NearAccountId } from '@terra/contracts';

/** `NearAccountId` and `chain.near_colony_account.account_id` both stop at 64 (BE-42). */
export const COLONY_ACCOUNT_MAX = 64;

const SUFFIX_ATTEMPTS = 20;

const TOO_LONG = 'colony account id cannot fit in 64 characters without dropping the colony id';

/** Characters left for `{name}` after `{colony}.` and `.terraagent.mock` (or custom root). */
export function colonyNameBudget(colonyId: string, root = MOCK_ACCOUNT_ROOT): number {
  return COLONY_ACCOUNT_MAX - colonyId.toLowerCase().length - root.length - 2;
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

function formatColonyAccountId(colonyId: string, playerName: string, root: string): string {
  return root === MOCK_ACCOUNT_ROOT
    ? colonyAccountId(colonyId, playerName)
    : `${colonyId.toLowerCase()}.${playerName}.${root}`;
}

/**
 * `{colony}.{name}.terraagent.mock` (or `.terraagent.testnet`) that fits in 64 characters.
 * The colony segment stays whole. Only the name stem is shortened.
 * `suffix` (for example `-2`) is kept in full when the budget allows (BE-42).
 */
export function fitColonyAccountId(
  colonyId: string,
  playerName: string,
  suffix = '',
  root = MOCK_ACCOUNT_ROOT,
): string {
  const budget = colonyNameBudget(colonyId, root) - suffix.length;
  if (budget < 1) throw new Error(TOO_LONG);
  const natural = formatColonyAccountId(colonyId, `${playerName}${suffix}`, root);
  if (playerName.length <= budget && fits(natural)) return natural;
  let stem = clipStem(playerName, budget);
  let accountId = formatColonyAccountId(colonyId, `${stem}${suffix}`, root);
  while (!fits(accountId) && stem.length > 1) {
    stem = clipStem(stem.slice(0, -1), budget);
    accountId = formatColonyAccountId(colonyId, `${stem}${suffix}`, root);
  }
  if (!fits(accountId)) throw new Error(TOO_LONG);
  return accountId;
}

/** Fitting id, then `-2` … so a shortened stem that is already taken can still be unique. */
export function colonyAccountCandidates(
  colonyId: string,
  playerName: string,
  root = MOCK_ACCOUNT_ROOT,
): readonly string[] {
  const ids = [fitColonyAccountId(colonyId, playerName, '', root)];
  for (let n = 2; n <= SUFFIX_ATTEMPTS; n += 1) {
    const suffix = `-${n}`;
    if (colonyNameBudget(colonyId, root) <= suffix.length) break;
    const id = fitColonyAccountId(colonyId, playerName, suffix, root);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

import { compileData, type CompiledRow } from '@terra/sim';

/** Parent of `merc-N.npc.terraagent.mock`. W22-27 does not create this account (BE-78). */
export const MERC_PARENT = 'npc.terraagent.mock';

const TIER1 = 'robot.recon';

export interface MercenaryRosterEntry {
  readonly id: string;
  readonly accountId: string;
  readonly name: string;
  readonly parent: typeof MERC_PARENT;
  readonly archetype: typeof TIER1;
  readonly count: number;
  readonly pricePerGameHour: Readonly<Record<string, number>>;
  readonly fundingCap: Readonly<Record<string, number>>;
}

/** Tier-1 recon rows only. W22 off, a missing cap, Tank, or Artillery yields nothing. */
export function mercenaryRoster(flags: { has(wave: string): boolean }): readonly MercenaryRosterEntry[] {
  if (!flags.has('W22')) return [];
  const table = compileData(flags).tables.mercenary ?? {};
  const out: MercenaryRosterEntry[] = [];
  for (const row of Object.values(table)) {
    const entry = rosterEntry(row);
    if (entry) out.push(entry);
  }
  return out.sort((a, b) => (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0));
}

function rosterEntry(row: CompiledRow): MercenaryRosterEntry | null {
  const accountId = typeof row.accountId === 'string' ? row.accountId : '';
  const name = mercName(accountId);
  const price = resourceMap(row.pricePerGameHour);
  const cap = resourceMap(row.fundingCap);
  if (row.archetype !== TIER1 || !name || !price || !cap) return null;
  if (typeof row.count !== 'number' || !Number.isInteger(row.count) || row.count < 1) return null;
  return {
    id: row.id,
    accountId,
    name,
    parent: MERC_PARENT,
    archetype: TIER1,
    count: row.count,
    pricePerGameHour: price,
    fundingCap: cap,
  };
}

function mercName(accountId: string): string | null {
  const suffix = `.${MERC_PARENT}`;
  if (!accountId.endsWith(suffix)) return null;
  const name = accountId.slice(0, -suffix.length);
  return /^merc-[1-9]\d*$/.test(name) ? name : null;
}

/** A non-empty map of whole, non-negative amounts. Anything else is not a finite cap or price. */
function resourceMap(value: unknown): Readonly<Record<string, number>> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, amount] of Object.entries(value)) {
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) return null;
    out[key] = amount;
  }
  return Object.keys(out).length === 0 ? null : out;
}

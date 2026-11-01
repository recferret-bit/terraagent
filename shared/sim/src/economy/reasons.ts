/**
 * The closed catalog of reasons a colony's resources change (the "why" column of the ledger). Each reason names the
 * direction(s) it may move value in and the system account on the other side of the double entry, so the balance of
 * e.g. `sys:construction` is the net amount every colony has sunk into construction.
 */

export type MoveDirection = 'add' | 'withdraw';

export interface ReasonSpec {
  readonly directions: readonly MoveDirection[];
  /** The counter account: where added value comes from / withdrawn value goes to. */
  readonly counter: string;
  readonly summary: string;
}

export const LEDGER_REASONS = {
  'landing.cargo': { directions: ['add'], counter: 'sys:cargo', summary: 'Starting cargo unloaded by the landing pod.' },
  'terraform.yield': { directions: ['add'], counter: 'sys:world', summary: 'Resources recovered by clearing or breaking a tile.' },
  'production.tick': { directions: ['add'], counter: 'sys:world', summary: 'Periodic output of extractors and harvesters.' },
  'construction.spend': { directions: ['withdraw'], counter: 'sys:construction', summary: 'Cost paid gradually while a building is built.' },
  'construction.refund': { directions: ['add'], counter: 'sys:construction', summary: 'Share of the paid cost returned when a build is cancelled.' },
  'building.sell': { directions: ['add'], counter: 'sys:construction', summary: 'Salvage returned when a building is sold.' },
  trade: { directions: ['add', 'withdraw'], counter: 'sys:market', summary: 'Goods bought from or sold to the market.' },
  'dev.grant': { directions: ['add', 'withdraw'], counter: 'sys:dev', summary: 'Dev console grant (positive) or revoke (negative).' },
  'admin.correction': { directions: ['add', 'withdraw'], counter: 'sys:admin', summary: 'Manual correction: seeding, tests, support fixes.' },
  // Host-only (never posted by the sim): a journal that starts after the planet did (a resumed local save) opens each
  // colony's balance with one entry, so the ledger explains `col.stock` from that point on.
  'ledger.opening': { directions: ['add'], counter: 'sys:opening', summary: 'Opening balance of a journal started on an existing planet.' },
} as const satisfies Record<string, ReasonSpec>;

export type LedgerReason = keyof typeof LEDGER_REASONS;

export function isLedgerReason(r: unknown): r is LedgerReason {
  return typeof r === 'string' && Object.prototype.hasOwnProperty.call(LEDGER_REASONS, r);
}

/** Whether `reason` may move value in `direction`. */
export function reasonAllows(reason: LedgerReason, direction: MoveDirection): boolean {
  return (LEDGER_REASONS[reason].directions as readonly MoveDirection[]).includes(direction);
}

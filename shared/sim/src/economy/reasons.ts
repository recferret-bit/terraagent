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
  /** Posted by the host's journal only (never through the sim treasury, which rejects it `invalid_reason`). */
  readonly hostOnly?: boolean;
}

export const LEDGER_REASONS = {
  'landing.cargo': { directions: ['add'], counter: 'sys:cargo', summary: 'Starting cargo unloaded by the landing pod.' },
  'terraform.yield': { directions: ['add'], counter: 'sys:world', summary: 'Resources recovered by clearing or breaking a tile.' },
  'production.tick': { directions: ['add'], counter: 'sys:world', summary: 'Periodic output of extractors and harvesters.' },
  'production.consume': { directions: ['withdraw'], counter: 'sys:world', summary: 'Fuel and inputs burned by power plants and factories.' },
  'construction.spend': { directions: ['withdraw'], counter: 'sys:construction', summary: 'Cost paid gradually while a building is built.' },
  'construction.refund': { directions: ['add'], counter: 'sys:construction', summary: 'Share of the paid cost returned when a build is cancelled.' },
  'building.sell': { directions: ['add'], counter: 'sys:construction', summary: 'Salvage returned when a building is sold.' },
  trade: { directions: ['add', 'withdraw'], counter: 'sys:market', summary: 'Goods bought from or sold to the market.' },
  'transport.reserve': { directions: ['withdraw'], counter: 'sys:transport', summary: 'Inputs held for a cargo export or import transport service (W13); kept when the service settles.' },
  'transport.release': { directions: ['add'], counter: 'sys:transport', summary: 'Transport inputs returned because the cargo operation failed before service (W13).' },
  'logistics.supply': { directions: ['withdraw'], counter: 'sys:logistics', summary: 'Inputs reserved for a logistics supply window and local reserves (W13); kept when consumed.' },
  'logistics.release': { directions: ['add'], counter: 'sys:logistics', summary: 'Reserved logistics inputs returned: unused part of a window or a removed entity reserve (W13).' },
  'cargo.export': { directions: ['withdraw'], counter: 'sys:cargo', summary: 'Cargo exported to orbital custody via a Trade Hub.' },
  'cargo.import': { directions: ['add'], counter: 'sys:cargo', summary: 'Cargo imported from orbital custody via a Trade Hub.' },
  'cargo.refund': { directions: ['add'], counter: 'sys:cargo', summary: 'Failed cargo export refunded to the colony stockpile.' },
  'dev.grant': { directions: ['add', 'withdraw'], counter: 'sys:dev', summary: 'Dev console grant (positive) or revoke (negative).' },
  'admin.correction': { directions: ['add', 'withdraw'], counter: 'sys:admin', summary: 'Manual correction: seeding, tests, support fixes.' },
  // Host-only (the treasury rejects it): a journal that starts after the planet did (a resumed local save) opens each
  // colony's balance with one entry, so the ledger explains `col.stock` from that point on (`PlanetJournal.open`).
  'ledger.opening': { directions: ['add'], counter: 'sys:opening', summary: 'Opening balance of a journal started on an existing planet.', hostOnly: true },
} as const satisfies Record<string, ReasonSpec>;

export type LedgerReason = keyof typeof LEDGER_REASONS;

export function isLedgerReason(r: unknown): r is LedgerReason {
  return typeof r === 'string' && Object.prototype.hasOwnProperty.call(LEDGER_REASONS, r);
}

/** Whether only the host's journal may post `reason` (the sim treasury rejects it). */
export function isHostOnlyReason(reason: LedgerReason): boolean {
  return (LEDGER_REASONS[reason] as ReasonSpec).hostOnly === true;
}

/** Whether `reason` may move value in `direction`. */
export function reasonAllows(reason: LedgerReason, direction: MoveDirection): boolean {
  return (LEDGER_REASONS[reason].directions as readonly MoveDirection[]).includes(direction);
}

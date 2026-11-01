import { RESOURCE_KEYS, type ResourceKey, type Stock } from '@terra/contracts';
import { isMajor, transferLegs, type Leg } from '@terra/ledger';
import { ensureColonyRecord } from '../kernel/colonies';
import type { CompiledDataLike } from '../kernel/config';
import type { LedgerPosting } from '../kernel/context';
import type { EmitInput } from '../kernel/events';
import type { PlanetState } from '../kernel/state';
import { colonyAccount, systemActor } from './accounts';
import { amountsProblem, findShortfall } from './amounts';
import { clampToCaps, getColonyCaps } from './caps';
import { LEDGER_REASONS, isHostOnlyReason, isLedgerReason, reasonAllows, type LedgerReason, type MoveDirection } from './reasons';
import { getColonyStock, writeColonyStock } from './store';

/** Whole-unit amounts per resource key. */
export type Amounts = Partial<Record<ResourceKey, number>>;

/** A posting with the sim's reason catalog. */
export type ColonyPosting = LedgerPosting & { reason: LedgerReason };

/**
 * Where the treasury records postings, and the tick they happen at. Inside a step pass the `StepContext` (it has
 * `tick` and `record`), so every change reaches the host's ledger. {@link unrecorded} exists for tests and seeding.
 */
export interface TreasuryCtx {
  readonly tick: number;
  /** Compiled data (a step ctx has it): caps before a Hub come from `hq.startingKit.storageCaps`. */
  readonly data?: CompiledDataLike;
  record(p: LedgerPosting): void;
  /** The step's event sink, for reporting a rejected change (`reportTreasuryReject`). */
  emit?(e: EmitInput): void;
}

/**
 * The treasury ctx for code that takes an optional step ctx: records (and emits) into the step when there is one,
 * otherwise discards (only tests call systems without a ctx; every step passes one).
 */
export function treasuryCtx(
  tick: number,
  ctx?: { record?: (p: LedgerPosting) => void; emit?: (e: EmitInput) => void; data?: CompiledDataLike },
): TreasuryCtx {
  const base = ctx?.record ? { tick, record: ctx.record } : unrecorded(tick);
  return { ...base, ...(ctx?.emit ? { emit: ctx.emit } : {}), ...(ctx?.data ? { data: ctx.data } : {}) };
}

/** A ctx that DISCARDS postings: the change happens in state but never reaches a ledger. Tests and seeding only. */
export function unrecorded(tick: number): TreasuryCtx {
  return { tick, record: () => {} };
}

export interface MoveRequest {
  colony: number;
  amounts: Amounts;
  reason: LedgerReason;
  /** Who caused it: `colonyActor(...)`, `systemActor(...)`, `DEV_ACTOR`. */
  actor: string;
  /** What it relates to, e.g. `order:42`. */
  ref?: string;
}

export interface AddRequest extends MoveRequest {
  /**
   * Credit only what fits under the colony's family caps. The rest is reported as `overflow` and posted in the same
   * entry from the reason's counter account to {@link OVERFLOW_ACCOUNT}, so the journal shows the loss (LED-11).
   */
  clampToCap?: boolean;
}

/** Where capped-off value goes: the journal's record of what storage caps destroyed. */
export const OVERFLOW_ACCOUNT = 'sys:overflow';

export type TreasuryRejectCode = 'invalid_resource' | 'invalid_reason' | 'invalid_amount' | 'insufficient_funds';

export interface TreasuryReject {
  ok: false;
  code: TreasuryRejectCode;
  resource?: ResourceKey;
  have?: number;
  need?: number;
  detail?: string;
}

export interface AddOk {
  ok: true;
  credited: Amounts;
  overflow: Amounts;
  /** Absent when nothing moved (all amounts zero or fully capped). */
  posting?: ColonyPosting;
}

export interface WithdrawOk {
  ok: true;
  debited: Amounts;
  posting?: ColonyPosting;
}

export type AddResult = AddOk | TreasuryReject;
export type WithdrawResult = WithdrawOk | TreasuryReject;
export type SetStockResult = { ok: true } | TreasuryReject;

/**
 * The one door through which a colony's resources change. `add` and `withdraw` validate the request (whole units,
 * known resource, reason allowed in that direction, an existing colony record (GP-24), no negative balance), update
 * `col.stock`, and record one balanced double-entry posting (colony ↔ the reason's `sys:*` counter account) with the
 * actor and ref for the host's ledger.
 */
export class ColonyTreasury {
  constructor(
    private readonly state: PlanetState,
    private readonly ctx: TreasuryCtx,
  ) {}

  stock(colony: number): Stock {
    return getColonyStock(this.state, colony);
  }

  add(req: AddRequest): AddResult {
    const bad = checkMove(req, 'add');
    if (bad) return bad;
    if (!this.state.colonies[req.colony]) return { ok: false, code: 'invalid_amount', detail: 'unknown colony' };
    const stock = this.stock(req.colony);
    const credited = req.clampToCap
      ? clampToCaps(stock, getColonyCaps(this.state, req.colony, this.ctx.data), req.amounts).credited
      : positive(req.amounts);
    for (const [key, v] of entriesOf(credited)) {
      if (!isMajor(stock[key] + v)) return { ok: false, code: 'invalid_amount', resource: key, detail: 'balance overflow' };
      stock[key] += v;
    }
    const overflow: Amounts = {};
    for (const [key, v] of entriesOf(req.amounts)) if (v - (credited[key] ?? 0) > 0) overflow[key] = v - (credited[key] ?? 0);
    const counter = LEDGER_REASONS[req.reason].counter;
    const lost = transferLegs(counter, OVERFLOW_ACCOUNT, overflow as Record<string, number>) as Leg[];
    const posting = this.apply(req, stock, counter, colonyAccount(req.colony), credited, lost);
    return posting ? { ok: true, credited, overflow, posting } : { ok: true, credited, overflow };
  }

  /** All-or-nothing: rejects `insufficient_funds` (with the first short resource, `SHORTFALL_ORDER`) and moves nothing. */
  withdraw(req: MoveRequest): WithdrawResult {
    const bad = checkMove(req, 'withdraw');
    if (bad) return bad;
    if (!this.state.colonies[req.colony]) return { ok: false, code: 'invalid_amount', detail: 'unknown colony' };
    const stock = this.stock(req.colony);
    const short = findShortfall(stock, req.amounts);
    if (short) return { ok: false, code: 'insufficient_funds', ...short };
    const debited = positive(req.amounts);
    for (const [key, v] of entriesOf(debited)) stock[key] -= v;
    const posting = this.apply(req, stock, colonyAccount(req.colony), LEDGER_REASONS[req.reason].counter, debited);
    return posting ? { ok: true, debited, posting } : { ok: true, debited };
  }

  /** Moves the colony to exactly `target` (missing keys = 0) with `admin.correction` postings. For seeding and tests. */
  setStock(colony: number, target: Amounts, actor: string, ref?: string): SetStockResult {
    const bad = checkMove({ colony, amounts: target, reason: 'admin.correction', actor }, 'add');
    if (bad) return bad;
    ensureColonyRecord(this.state, colony, this.ctx.tick); // seeding may name a colony before its record exists
    const cur = this.stock(colony);
    const up: Amounts = {};
    const down: Amounts = {};
    for (const key of RESOURCE_KEYS) {
      const diff = (target[key] ?? 0) - cur[key];
      if (diff > 0) up[key] = diff;
      if (diff < 0) down[key] = -diff;
    }
    // Neither can be rejected: amounts are validated whole units and `down` never exceeds the balance.
    this.withdraw({ colony, amounts: down, reason: 'admin.correction', actor, ref });
    this.add({ colony, amounts: up, reason: 'admin.correction', actor, ref });
    writeColonyStock(this.state, colony, this.stock(colony), this.ctx.tick);
    return { ok: true };
  }

  /**
   * Writes the new stock and records the posting (plus `extra` legs, e.g. capped overflow); nothing (and no posting)
   * when there is nothing to move.
   */
  private apply(req: MoveRequest, stock: Stock, from: string, to: string, amounts: Amounts, extra: Leg[] = []): ColonyPosting | undefined {
    if (Object.keys(amounts).length === 0 && extra.length === 0) return undefined;
    // `amounts` passed validate() and holds only positive whole units, so transferLegs never returns null here.
    const legs = [...(transferLegs(from, to, amounts as Record<string, number>) as Leg[]), ...extra];
    const posting: ColonyPosting = { at: this.ctx.tick, reason: req.reason, actor: req.actor, legs };
    if (req.ref !== undefined) posting.ref = req.ref;
    if (Object.keys(amounts).length > 0) writeColonyStock(this.state, req.colony, stock, this.ctx.tick);
    this.ctx.record(posting);
    return posting;
  }
}

/** Shorthand: `treasury(state, ctx).add({...})` with the step's `ctx`. */
export function treasury(state: PlanetState, ctx: TreasuryCtx): ColonyTreasury {
  return new ColonyTreasury(state, ctx);
}

/**
 * Sets a colony's stock to exactly `target` (missing keys = 0) as `admin.correction` by `system:admin`. Without a
 * `ctx` the postings are discarded (tests, seeding a planet before it runs); inside a step pass the step's ctx.
 */
export function setColonyStock(
  state: PlanetState,
  colonyIndex: number,
  target: Amounts,
  ctx: TreasuryCtx = unrecorded(state.meta.tick),
): SetStockResult {
  return treasury(state, ctx).setStock(colonyIndex, target, systemActor('admin'));
}

/**
 * Validates a change without making it (what `add` / `withdraw` check first): the reason exists, may move value in
 * `direction` and is not host-only (`invalid_reason`); the colony index and every amount are whole units
 * (`invalid_amount`); every key is a resource (`invalid_resource`). Balances are not checked. Validate-first callers
 * (landing) use it to refuse before they change anything else.
 */
export function checkMove(req: MoveRequest, direction: MoveDirection): TreasuryReject | null {
  if (!isLedgerReason(req.reason) || isHostOnlyReason(req.reason) || !reasonAllows(req.reason, direction)) {
    return { ok: false, code: 'invalid_reason', detail: `${String(req.reason)} cannot ${direction}` };
  }
  if (!isMajor(req.colony) || req.colony < 0) return { ok: false, code: 'invalid_amount', detail: 'bad colony index' };
  const bad = amountsProblem(req.amounts);
  if (!bad) return null;
  return bad.resource === undefined
    ? { ok: false, code: bad.code, detail: bad.detail }
    : { ok: false, code: bad.code, resource: bad.resource as ResourceKey, detail: bad.detail };
}

function entriesOf(amounts: Amounts): [ResourceKey, number][] {
  return Object.entries(amounts) as [ResourceKey, number][];
}

/** The non-zero entries of validated (whole, non-negative) amounts. */
function positive(amounts: Amounts): Amounts {
  const out: Amounts = {};
  for (const [key, v] of entriesOf(amounts)) if (v > 0) out[key] = v;
  return out;
}

import { newId, type BountyReward, type BountyTarget, type FlagSet, type SimCommandV1 } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import type { PlanetState } from '@terra/sim';
import { findColonyHqRow } from '@terra/sim/systems/find';
import { CoreException } from '../../core/errors/core-exception.js';
import { resolveColonyAccountId } from '../cargo/cargo-export-outbox.js';
import type { ChainReceipt } from '../domain/types.js';
import { AccountId } from '../domain/types.js';
import type { DaoView } from '../application/ports/treasury-dao.port.js';
import type { BountyRepository } from '../bounty/bounty.repository.js';
import type { BountyPayService } from '../bounty/pay.service.js';
import type { BountyPostService } from '../bounty/post.service.js';
import { HOUR_MS } from '../bounty/validate.js';
import { TREASURY_COST_TOKEN, treasuryProject } from './costs.js';
import { effectUntilTick, treasuryEffectCommand } from './finalize-effect.js';
import type { EnsuredPlanetDao } from './lifecycle.service.js';

/** Loaded-planet surface `treasury.effect` and `merc.hire` need. */
export interface ConsoleSim {
  isLoaded(planetId: string): boolean;
  submit(planetId: string, cmd: SimCommandV1): Promise<{ ok: boolean; code?: string; detail?: string }>;
  fullState(planetId: string, timeoutMs?: number): Promise<{ tick: number }>;
}

export interface WaveGate {
  has(wave: string): boolean;
  readonly flags: FlagSet;
}

export interface ConsoleDao {
  deposit(input: {
    opId: string;
    daoAccountId: string;
    from: string;
    tokenId: string;
    amount: string;
  }): Promise<Pick<ChainReceipt, 'txHash'>>;
  get(input: { daoAccountId: string }): Promise<Pick<DaoView, 'balances'>>;
}

export interface ConsoleLifecycle {
  ensurePlanetDao(planetId: string): Promise<EnsuredPlanetDao | null>;
}

export interface ConsoleWorld {
  load(planetId: string): Promise<PlanetState | null>;
}

/** Dev mint into the DAO. `deposit` records `from` and does not debit it. */
export const DEV_TREASURY_FUNDER = 'dev.treasury.terraagent.mock';

/** Roster row id. Count comes from the `mercenary` table (4 recon). */
const LIGHT_ROSTER = 'light';

/** Spawn schema is 1..8. The roster table has no radius. */
const LIGHT_RADIUS = 3;

const OPENABLE = new Set(['open', 'claimed']);
const PAYABLE = new Set(['open', 'claimed', 'completed', 'paid']);

export interface TreasuryEffectBody {
  readonly planetId: string;
  readonly kind: string;
}

export interface TreasuryFundBody {
  readonly planetId: string;
  readonly amount: number;
}

export interface BountyPostBody {
  readonly planetId: string;
  readonly colonyIndex: number;
  readonly colonyId?: string;
  readonly target: BountyTarget;
  readonly reward: BountyReward;
}

export interface BountyCompleteBody {
  readonly id: string;
  readonly claimer?: string;
}

export interface BountyExpireBody {
  readonly id: string;
}

/** `refundDue` after this command has moved one row's `expiresAt` into the past. */
export interface ConsoleExpiry {
  refundDue(nowMs: number): Promise<{ refunded: number }>;
}

/** `MercenaryHireService.hire`. The console opens escrow here instead of spawning alone. */
export interface ConsoleHire {
  hire(input: {
    planetId: string;
    colonyId: string;
    colonyIndex: number;
    accountId: string;
    rosterId: string;
    hours: number;
    q: number;
    r: number;
    radius?: number;
  }): Promise<{
    bountyId: string;
    rosterId: string;
    escrowId: string;
    mercenaryAccountId: string;
    total: number;
    spawn: { args?: unknown };
  }>;
}

export interface MercHireBody {
  readonly planetId: string;
  readonly colonyIndex: number;
  readonly hours: number;
  readonly q?: number;
  readonly r?: number;
}

export interface ConsoleDeps {
  readonly flags: WaveGate;
  readonly dao: ConsoleDao;
  readonly lifecycle: ConsoleLifecycle;
  readonly sim: ConsoleSim;
  readonly posts: Pick<BountyPostService, 'post'>;
  readonly pay: Pick<BountyPayService, 'pay'>;
  readonly repo: Pick<BountyRepository, 'find' | 'completeForPayout' | 'markCompleted'>;
  readonly world: ConsoleWorld;
  readonly prisma: PrismaClient;
  readonly expiry: ConsoleExpiry;
  readonly hire: ConsoleHire;
}

export async function runTreasuryFund(deps: ConsoleDeps, body: TreasuryFundBody) {
  assertW22(deps.flags);
  const ensured = await deps.lifecycle.ensurePlanetDao(body.planetId);
  if (!ensured) throw new CoreException('NOT_FOUND', { status: 404, message: 'Planet treasury is not available' });
  const amount = String(body.amount);
  const receipt = await deps.dao.deposit({
    opId: `dev-fund:${newId('cm')}`,
    daoAccountId: ensured.daoAccountId,
    from: DEV_TREASURY_FUNDER,
    tokenId: TREASURY_COST_TOKEN,
    amount,
  });
  const view = await deps.dao.get({ daoAccountId: ensured.daoAccountId });
  return {
    planetId: body.planetId,
    daoAccountId: ensured.daoAccountId,
    tokenId: TREASURY_COST_TOKEN,
    amount,
    balance: view.balances[TREASURY_COST_TOKEN] ?? '0',
    txHash: receipt.txHash,
  };
}

/** Module `system.treasuryEffect`. A client `cmd` of this kind is `unknown_kind`. */
export async function runTreasuryEffect(deps: ConsoleDeps, body: TreasuryEffectBody) {
  assertW22(deps.flags);
  const project = treasuryProject(deps.flags.flags, body.kind);
  if (!project) throw new CoreException('VALIDATION_ERROR', { status: 400, message: `Unknown effect "${body.kind}"` });
  const tick = await loadedTick(deps.sim, body.planetId);
  const untilTick = effectUntilTick(tick, project.durationH);
  const out = await deps.sim.submit(body.planetId, treasuryEffectCommand(project, untilTick));
  if (!out.ok) throw rejected(out);
  return { planetId: body.planetId, kind: project.kind, tick, untilTick, durationH: project.durationH };
}

/** Chain escrow via `BountyPostService`. Does not also submit sim `bounty.post` (BE-76). */
export async function runBountyPost(deps: ConsoleDeps, body: BountyPostBody) {
  assertW22(deps.flags);
  const colonyId = body.colonyId ?? `col_${body.colonyIndex}`;
  const nowMs = Date.now();
  const accountId = await resolveColonyAccountId(deps.prisma, colonyId, null, body.planetId, body.colonyIndex);
  const posted = await deps.posts.post({
    planetId: body.planetId,
    colonyId,
    colonyIndex: body.colonyIndex,
    accountId,
    nowMs,
    args: { target: body.target, reward: body.reward, expiresAt: expiresAtFor(body.target, nowMs) },
  });
  return {
    id: posted.id,
    state: posted.state,
    kind: body.target.kind,
    escrowId: posted.escrowId,
    txHash: posted.receipt.txHash,
  };
}

export async function runBountyComplete(deps: ConsoleDeps, body: BountyCompleteBody) {
  assertW22(deps.flags);
  const row = await deps.repo.find(body.id);
  if (!row) throw new CoreException('NOT_FOUND', { status: 404, message: `Bounty "${body.id}" was not found` });
  if (!PAYABLE.has(row.state)) {
    throw new CoreException('VALIDATION_ERROR', { status: 400, message: `Bounty is ${row.state}` });
  }
  const claimer = await settleClaimer(deps, row, body.claimer);
  if (row.state === 'paid') return { id: row.id, state: 'paid', paid: true, claimer: row.claimerAccountId };
  const paid = await tryPay(deps, row.id, claimer);
  const next = await deps.repo.find(row.id);
  return {
    id: row.id,
    state: next?.state ?? 'completed',
    paid: paid.ok,
    claimer,
    ...(claimer ? {} : { note: 'completed; pay skipped because the row has no claimer' }),
    ...(paid.error ? { payError: paid.error } : {}),
  };
}

/**
 * Light squad through `MercenaryHireService` (W22-28). Opens the defend escrow and spawns.
 * Hours are whole. A fractional hour is rejected before the hire service quotes a price.
 */
export async function runMercHire(deps: ConsoleDeps, body: MercHireBody) {
  assertW22(deps.flags);
  if (!Number.isInteger(body.hours)) {
    throw new CoreException('VALIDATION_ERROR', { status: 400, message: 'hours must be a whole number' });
  }
  const poster = await posterAccount(deps, body.planetId, body.colonyIndex);
  const center = await defendCenter(deps, body);
  const hired = await deps.hire.hire({
    planetId: body.planetId,
    colonyId: poster.colonyId,
    colonyIndex: body.colonyIndex,
    accountId: poster.accountId,
    rosterId: LIGHT_ROSTER,
    hours: body.hours,
    q: center.q,
    r: center.r,
    radius: LIGHT_RADIUS,
  });
  return {
    planetId: body.planetId,
    colonyIndex: body.colonyIndex,
    hours: body.hours,
    count: spawnCount(hired.spawn.args),
    rosterId: hired.rosterId,
    q: center.q,
    r: center.r,
    radius: LIGHT_RADIUS,
    bountyId: hired.bountyId,
    escrowId: hired.escrowId,
    mercenaryAccountId: hired.mercenaryAccountId,
    total: hired.total,
    escrow: true as const,
  };
}

const MERC_SUFFIX = '.npc.terraagent.mock';

/**
 * Player bounties only. Sets `expiresAt` into the past, then `refundDue`.
 * A mercenary claimer is left for W22-30 (BE-88). A second call does not pay again.
 */
export async function runBountyExpire(deps: ConsoleDeps, body: BountyExpireBody) {
  assertW22(deps.flags);
  const row = await deps.repo.find(body.id);
  if (!row) throw new CoreException('NOT_FOUND', { status: 404, message: `Bounty "${body.id}" was not found` });
  if (row.claimerAccountId?.endsWith(MERC_SUFFIX)) {
    return { id: row.id, state: row.state, refunded: false, skipped: 'mercenary' as const };
  }
  const now = Date.now();
  await deps.prisma.chainBounty.update({ where: { id: row.id }, data: { expiresAt: new Date(now - 1000) } });
  const sweep = await deps.expiry.refundDue(now);
  const next = await deps.repo.find(row.id);
  return {
    id: row.id,
    state: next?.state ?? row.state,
    refunded: sweep.refunded > 0,
    board: next?.state === 'refunded' ? 'Expired' : next?.state ?? row.state,
  };
}

function assertW22(flags: WaveGate): void {
  if (!flags.has('W22')) throw new CoreException('NOT_FOUND', { status: 404, message: 'Not found' });
}

async function loadedTick(sim: ConsoleSim, planetId: string): Promise<number> {
  if (!sim.isLoaded(planetId)) {
    throw new CoreException('NOT_FOUND', { status: 404, message: `Planet "${planetId}" is not loaded` });
  }
  const state = await sim.fullState(planetId, 2_000);
  if (typeof state.tick !== 'number' || !Number.isFinite(state.tick) || state.tick < 0) {
    throw new CoreException('VALIDATION_ERROR', { status: 400, message: `Planet "${planetId}" has no tick` });
  }
  return Math.floor(state.tick);
}

function rejected(out: { code?: string; detail?: string }): CoreException {
  return new CoreException('VALIDATION_ERROR', { status: 400, message: out.detail ?? out.code ?? 'rejected' });
}

function expiresAtFor(target: BountyTarget, nowMs: number): number {
  const hours = target.kind === 'defend_area' ? target.durationH : 2;
  const clamped = Math.min(48, Math.max(2, Math.ceil(hours)));
  return nowMs + clamped * HOUR_MS;
}

async function settleClaimer(
  deps: ConsoleDeps,
  row: { id: string; state: string; claimerAccountId: string | null },
  requested: string | undefined,
): Promise<string | null> {
  if (requested && !AccountId.safeParse(requested).success) {
    throw new CoreException('VALIDATION_ERROR', { status: 400, message: 'claimer account is invalid' });
  }
  if (!OPENABLE.has(row.state)) return row.claimerAccountId;
  const claimer = requested ?? row.claimerAccountId;
  if (claimer) await deps.repo.completeForPayout(row.id, claimer);
  else await deps.repo.markCompleted(row.id);
  return claimer;
}

async function tryPay(deps: ConsoleDeps, id: string, claimer: string | null): Promise<{ ok: boolean; error?: string }> {
  if (!claimer) return { ok: false };
  try {
    return { ok: await deps.pay.pay(id, claimer) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function posterAccount(
  deps: ConsoleDeps,
  planetId: string,
  colonyIndex: number,
): Promise<{ colonyId: string; accountId: string }> {
  const seated = await deps.prisma.colony.findFirst({
    where: { planetId, colonyIndex },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  const colonyId = seated?.id ?? `col_${colonyIndex}`;
  const accountId = await resolveColonyAccountId(deps.prisma, colonyId, null, planetId, colonyIndex);
  return { colonyId, accountId };
}

function spawnCount(args: unknown): number {
  if (!args || typeof args !== 'object' || !('count' in args)) return 0;
  const count = (args as { count: unknown }).count;
  return typeof count === 'number' && Number.isInteger(count) ? count : 0;
}

async function defendCenter(deps: ConsoleDeps, body: MercHireBody): Promise<{ q: number; r: number }> {
  if (body.q !== undefined && body.r !== undefined) return { q: body.q, r: body.r };
  const state = await deps.world.load(body.planetId);
  if (!state) return { q: 0, r: 0 };
  const row = findColonyHqRow(state, body.colonyIndex);
  if (row < 0) return { q: 0, r: 0 };
  return { q: state.entities.cols.q[row] ?? 0, r: state.entities.cols.r[row] ?? 0 };
}

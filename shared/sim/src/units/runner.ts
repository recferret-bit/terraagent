import { ENTITY_KIND, ENTITY_STATE } from '../ecs/columns';
import { rowOf, setField } from '../ecs/store';
import { hexDistance, hexIndex } from '../grid/hex';
import { DEPOSIT } from '../grid/layers';
import type { StepContext } from '../kernel/context';
import type { PlanetState } from '../kernel/state';
import { applyDamage, retreatHqToSafety } from '../systems/combat/damage';
import { setUnitActivity } from './approach';
import { UnitBook } from './book';
import { mobileStats, notifyUnitChanged } from './mobility';
import { cancelMove, getMotion, requestMove, runMovement } from './movement/orchestrator';
import { commandKey, type UnitCommand, type UnitCommandStatus, type UnitCtx, type UnitRegistry, type UnitWorkPhase } from './types';

/**
 * The units runner. `stepUnits` is one step of every unit's command processing (units slot 5):
 *  1. think: a dead unit gets `die`; an idle or auto-driven unit asks the work providers for work; the current
 *     command executes (most commands start by asking the movement orchestrator for a route);
 *  2. move: the orchestrator solves queued paths within the budget and advances units along their routes;
 *  3. settle: commands of units whose route ended this step execute once more, so a `move` ends on its arrival step.
 * `stepUnitWork` then runs, in a later slot, the `work` of commands of that `phase` (build / terraform progress in the
 * construction slot 6, damage in the combat slot 10).
 */

export interface IssueOpts {
  /** Append after the current command instead of replacing it (shift-queue). */
  queue?: boolean;
}

function unitCtx(state: PlanetState, ctx: StepContext, book: UnitBook, row: number): UnitCtx | null {
  const cols = state.entities.cols;
  const stats = mobileStats(cols.kind[row], ctx.data);
  if (!stats) return null;
  const id = cols.id[row];
  return { state, ctx, row, id, owner: cols.owner[row], stats, record: book.get(id) };
}

const isOut = (state: PlanetState, row: number): boolean => {
  const s = state.entities.cols.state[row];
  return s === ENTITY_STATE.descending || s === ENTITY_STATE.inert;
};

function propose(reg: UnitRegistry, u: UnitCtx, book: UnitBook): UnitCommand | null {
  if (u.ctx.tick < u.record.holdUntil || u.record.reserve) return null; // on hold, or in reserve (no work)
  if (u.ctx.flags.has('W07') && u.state.entities.cols.kind[u.row] === ENTITY_KIND.hq) {
    const hpMax = Math.max(1, u.state.entities.cols.hpMax[u.row]);
    if (u.state.entities.cols.hp[u.row] / hpMax < 0.4) return null;
  }
  for (const [key, until] of Object.entries(u.record.skip)) {
    if (until > u.ctx.tick) continue;
    delete u.record.skip[key];
    book.touch();
  }
  for (const p of reg.providers) {
    const cmd = p.propose(u);
    if (cmd) return cmd;
  }
  // Nothing to do and nothing on hold: the failure history is over.
  if (u.record.fails && Object.keys(u.record.skip).length === 0) {
    delete u.record.fails;
    book.touch();
  }
  return null;
}

/** Skips a failed auto command, twice as long per consecutive failure, up to `retryMaxTicks` (GP-21). */
function backOff(reg: UnitRegistry, u: UnitCtx, cmd: UnitCommand): void {
  const key = commandKey(reg, cmd);
  const fails = (u.record.fails ??= {});
  const n = (fails[key] = (fails[key] ?? 0) + 1);
  u.record.skip[key] = u.ctx.tick + Math.min(u.stats.retryTicks * (1 << Math.min(n - 1, 20)), Math.max(u.stats.retryTicks, u.stats.retryMaxTicks));
}

function isClientVisibleCommand(cmd: UnitCommand | null | undefined): boolean {
  if (!cmd) return false;
  if (cmd.source !== 'auto') return true;
  return cmd.kind === 'build' || cmd.kind === 'terraform' || cmd.kind === 'attack';
}

/** Ends the current command and lines up the next one (queue first, then auto work) without executing it yet. */
function finish(reg: UnitRegistry, u: UnitCtx, book: UnitBook, status: Exclude<UnitCommandStatus, 'running'>): void {
  const rec = u.record;
  const cur = rec.current;
  let needsStamp = isClientVisibleCommand(cur);
  if (cur && status === 'failed') {
    if (cur.source === 'auto') backOff(reg, u, cur);
    else {
      rec.lastFailure = { code: 'no_path', tick: u.ctx.tick, kind: cur.kind, source: cur.source };
      needsStamp = true;
    }
  } else if (cur && rec.fails) {
    delete rec.fails[commandKey(reg, cur)];
  }
  rec.current = null; // before proposing: a provider must not hand back the command that just ended
  rec.current = rec.queue.shift() ?? propose(reg, u, book);
  if (isClientVisibleCommand(rec.current)) needsStamp = true;
  cancelMove(u.state, u.id, u.ctx.tick);
  book.touch(needsStamp);
  if (!rec.current) {
    const cols = u.state.entities.cols;
    setUnitActivity(u, ENTITY_STATE.idle, cols.q[u.row], cols.r[u.row]);
  }
}

function runCurrent(reg: UnitRegistry, u: UnitCtx, book: UnitBook): void {
  const cur = u.record.current;
  if (!cur) return;
  const def = reg.commands.get(cur.kind);
  const status: UnitCommandStatus = def ? def.execute(u, cur) : 'failed';
  if (status !== 'running') finish(reg, u, book, status);
}

function think(reg: UnitRegistry, u: UnitCtx, book: UnitBook): void {
  const rec = u.record;
  if (rec.reserve?.mode === 'activating' && u.ctx.tick >= rec.reserve.readyAt) {
    delete rec.reserve; // deployment delay over
    book.touch();
  }
  if (!rec.current && rec.queue.length > 0) {
    rec.current = rec.queue.shift() ?? null;
    book.touch();
  }
  if (!rec.current || (rec.current.source === 'auto' && rec.current.kind !== 'move')) {
    const next = propose(reg, u, book);
    if (!next) {
      if (rec.current) finish(reg, u, book, 'done'); // the auto work is gone (done elsewhere or cancelled)
      return;
    }
    if (!rec.current || commandKey(reg, rec.current) !== commandKey(reg, next)) {
      const needsStamp = isClientVisibleCommand(rec.current) || isClientVisibleCommand(next);
      rec.current = next;
      cancelMove(u.state, u.id, u.ctx.tick);
      book.touch(needsStamp);
    }
  }
  runCurrent(reg, u, book);
}

/** Runs one step of command processing and movement for every unit (see the file comment). */
export function stepUnits(reg: UnitRegistry, state: PlanetState, ctx: StepContext): void {
  const book = new UnitBook(state);
  const e = state.entities;
  for (let row = 0; row < e.count; row++) {
    if (isOut(state, row)) continue;
    const u = unitCtx(state, ctx, book, row);
    if (!u) continue;
    if (e.cols.hp[row] <= 0) {
      if (ctx.flags.has('W07')) {
        if (e.cols.kind[row] === ENTITY_KIND.hq) {
          setField(e, row, 'hp', 1, ctx.tick);
          retreatHqToSafety(state, row, ctx.tick, ctx);
        } else {
          applyDamage(state, e.cols.id[row], 1, { tick: ctx.tick, ctx, data: ctx.data });
          row--;
        }
        book.touch();
        continue;
      }
      reg.commands.get('die')?.execute(u, { kind: 'die', source: 'auto' });
      book.touch();
      continue;
    }
    think(reg, u, book);
    if (!u.record.current && e.cols.state[row] === ENTITY_STATE.moving) {
      const existingMotion = getMotion(state, u.id);
      if (!existingMotion || existingMotion.status === 'failed') {
        const tq = e.cols.targetQ[row], tr = e.cols.targetR[row];
        const tIdx = hexIndex(state.grid.radius).indexOf(tq, tr);
        const isDep = tIdx >= 0 && state.grid.layers.deposit[tIdx] !== DEPOSIT.none;
        if (isDep) {
          const atAdj = hexDistance(e.cols.q[row], e.cols.r[row], tq, tr) === 1 && hexDistance(e.cols.x[row], e.cols.y[row], e.cols.q[row], e.cols.r[row]) <= 0.15;
          if (!atAdj) {
            requestMove(state, row, { q: tq, r: tr, minDist: 1, maxDist: 1 }, ctx);
          } else {
            setField(e, row, 'state', ENTITY_STATE.idle, ctx.tick);
            notifyUnitChanged(state, row, ctx.tick, ctx.data);
          }
        } else if (hexDistance(e.cols.x[row], e.cols.y[row], tq, tr) > 1e-4) {
          requestMove(state, row, { q: tq, r: tr, minDist: 0, maxDist: 0 }, ctx);
        } else {
          setField(e, row, 'state', ENTITY_STATE.idle, ctx.tick);
          notifyUnitChanged(state, row, ctx.tick, ctx.data);
        }
      }
    }
  }

  for (const id of runMovement(state, ctx)) {
    const row = rowOf(e, id);
    if (row < 0 || isOut(state, row)) continue;
    const u = unitCtx(state, ctx, book, row);
    if (u?.record.current) {
      runCurrent(reg, u, book);
    } else if (u && e.cols.state[row] === ENTITY_STATE.moving) {
      setField(e, row, 'state', ENTITY_STATE.idle, ctx.tick);
      notifyUnitChanged(state, row, ctx.tick, ctx.data);
    }
  }

  for (const id of book.ids()) if (rowOf(e, id) < 0) book.remove(id);
  book.flush(ctx.tick);
}

/** The `work` of every unit whose current command acts in `phase` (construction slot 6, combat slot 10). */
export function stepUnitWork(reg: UnitRegistry, phase: UnitWorkPhase, state: PlanetState, ctx: StepContext): void {
  const book = new UnitBook(state);
  const e = state.entities;
  for (let row = 0; row < e.count; row++) {
    if (isOut(state, row) || e.cols.hp[row] <= 0) continue;
    const id = e.cols.id[row];
    const rec = book.peek(id);
    const cur = rec?.reserve ? null : rec?.current; // a unit in reserve neither attacks nor works
    const def = cur ? reg.commands.get(cur.kind) : undefined;
    if (!cur || !def?.work || def.phase !== phase) continue;
    const u = unitCtx(state, ctx, book, row);
    if (!u) continue;
    const status = def.work(u, cur);
    if (status !== 'running') finish(reg, u, book, status);
  }
  book.flush(ctx.tick);
}

/**
 * Issues `cmd` to unit `row` (the one entry point for unit input: player handlers, systems, tests). Returns a reject
 * code or nothing. Immediate commands (stop, die) run now; others replace the current command (or queue after it).
 */
export function issueUnitCommand(
  reg: UnitRegistry,
  state: PlanetState,
  row: number,
  cmd: UnitCommand,
  ctx: StepContext,
  opts: IssueOpts = {},
): string | void {
  if (row < 0 || row >= state.entities.count) return 'unknown_entity';
  const book = new UnitBook(state);
  const u = unitCtx(state, ctx, book, row);
  if (!u) return 'invalid_args';
  if (state.entities.cols.state[row] === ENTITY_STATE.inert || state.entities.cols.hp[row] <= 0) return 'invalid_args';
  const def = reg.commands.get(cmd.kind);
  if (!def) return 'unknown_kind';
  if (u.record.reserve && def.work) return 'invalid_args'; // reserve: no attack / build / terraform (move and retreat stay)
  const code = def.validate?.(u, cmd as never);
  if (code) return code;
  const prevCmd = u.record.current;
  if (def.immediate) {
    def.execute(u, cmd as never);
  } else if (opts.queue && u.record.current) {
    u.record.queue.push(cmd);
  } else {
    u.record.current = cmd;
    u.record.queue = [];
    cancelMove(state, u.id, ctx.tick);
  }
  book.touch(isClientVisibleCommand(prevCmd) || isClientVisibleCommand(cmd));
  book.flush(ctx.tick);
}

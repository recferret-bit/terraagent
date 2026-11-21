import { hasCommandKind, precheckClientCommand, REJECT_CODES, REJECT_DETAIL_MAX, type ClientMessageOf, type RejectCode, type SimCommandV1 } from '@terra/contracts';
import { Counter, type Registry } from 'prom-client';
import { normalizeColonyStatus, type SectorAntiCheatService } from '../core/anticheat';
import type { CommandPrechecks } from '../core/command-prechecks';
import type { ColonyRecord } from '../core/home/home.repository';
import type { FlagsService, CommandWaveLookup } from '../flags/flags.service';
import type { GamePlanets } from '../game/game-planets.service';
import type { CommandContext, CommandIngress } from './command-ingress';
import { CommandRateLimiter, type CommandRateLimitOptions } from './command-rate-limit';

const isRejectCode = (c: string): c is RejectCode => (REJECT_CODES as readonly string[]).includes(c);

/** The colony lookup the ingress needs (`HomeRepository`): cached first, the store on a miss. */
export interface ColonyLookup {
  findColonyByPlayerAndPlanet(playerId: string, planetId: string): Promise<ColonyRecord | null>;
}

export interface SimCommandIngressOptions {
  readonly planets: GamePlanets;
  readonly flags: Pick<FlagsService, 'gate'>;
  readonly registry: Registry;
  readonly production: boolean;
  readonly homeRepo?: ColonyLookup;
  /** Per-player token bucket (default 20 commands/s, bursts of 40); over it a command is rejected `rate_limited`. */
  readonly rateLimit?: CommandRateLimitOptions;
  /** Server-side prechecks per kind (W13-01), run after the contract checks and before the sim. */
  readonly prechecks?: Pick<CommandPrechecks, 'has' | 'run'>;
  /** O(1) hash-based real-time planet & sector anti-cheat validator. */
  readonly antiCheat?: SectorAntiCheatService;
}

/**
 * The command pipeline of PROTOCOL §4.2 / SIM-C-01: per-player rate limit, flag gate, strict args, origin/dev rules, colony from the session,
 * then `GamePlanets.submit` to the owning thread. The reply is sent when the engine applied the command (WS-21), so
 * the handler does not block the socket's frame queue: several commands may be in flight and are answered in step order.
 *
 * Colony: always derived server-side, never taken from the client: the player's colony row on the joined planet. A
 * player without one sends dev kinds with `colonyIndex: null`, `source: 'dev'`; any other kind is `not_own_colony`,
 * except a `dev:` session on a scenario planet, which plays colony 0 (BE-07). Commands of one player are resolved and
 * submitted strictly in arrival order (one chain per player, BE-09), whatever the lookup latency.
 */
export class SimCommandIngress implements CommandIngress {
  /** Test seam: lets a test pretend a kind belongs to another wave. */
  waveOf: CommandWaveLookup | undefined;
  private readonly acked: Counter<'kind'>;
  private readonly rejected: Counter<'kind' | 'code'>;
  private readonly limiter: CommandRateLimiter;
  /** Per player: the tail of its command chain (resolve colony → submit), dropped when it drains. */
  private readonly chains = new Map<string, Promise<void>>();

  constructor(private readonly o: SimCommandIngressOptions) {
    this.acked = new Counter({ name: 'ta_planet_cmd_acked_total', help: 'Commands applied by the engine', labelNames: ['kind'], registers: [o.registry] });
    this.limiter = new CommandRateLimiter(o.rateLimit);
    this.rejected = new Counter({ name: 'ta_planet_cmd_rejected_total', help: 'Commands rejected', labelNames: ['kind', 'code'], registers: [o.registry] });
  }

  /** Resolves once the command was rejected or handed to its planet thread (not when the engine applied it). */
  handle(ctx: CommandContext, cmd: ClientMessageOf<'cmd'>): Promise<void> {
    if (!this.limiter.take(ctx.playerId)) return Promise.resolve(this.reject(ctx, cmd, 'rate_limited'));
    const prev = this.chains.get(ctx.playerId) ?? Promise.resolve();
    const next = prev.then(async () => {
      let colony: ColonyRecord | null;
      try {
        colony = await this.resolveColony(ctx);
      } catch {
        return this.reject(ctx, cmd, 'internal', 'colony lookup failed');
      }
      await this.dispatchWithColony(ctx, cmd, colony);
    });
    this.chains.set(ctx.playerId, next);
    void next.finally(() => { if (this.chains.get(ctx.playerId) === next) this.chains.delete(ctx.playerId); });
    return next;
  }

  /** The player's colony row on the planet; else live anti-cheat binding; else colony 0 for a dev session on a scenario planet; else none. */
  private async resolveColony(ctx: CommandContext): Promise<ColonyRecord | null> {
    const { playerId, planetId, memo } = ctx;
    if (memo?.planetId === planetId && memo.colony) return memo.colony as ColonyRecord;
    const rememberedMiss = memo?.planetId === planetId && memo.colony === null;
    const row = rememberedMiss || !this.o.homeRepo ? null : await this.o.homeRepo.findColonyByPlayerAndPlanet(playerId, planetId);
    if (row) {
      this.o.antiCheat?.recordColonyBase({
        ...row,
        playerId: row.playerId ?? playerId,
        planetId: row.planetId ?? planetId,
      });
      this.rememberColony(memo, planetId, row);
      return row;
    }
    const live = this.liveColony(ctx);
    if (live) {
      this.rememberColony(memo, planetId, live);
      return live;
    }
    if (memo && !rememberedMiss) { memo.planetId = planetId; memo.colony = null; }
    return null;
  }

  /** Anti-cheat binding, or colony 0 for a dev session on a scenario planet. */
  private liveColony(ctx: CommandContext): ColonyRecord | null {
    const { playerId, planetId } = ctx;
    const liveActive = this.o.antiCheat?.index.getActiveBaseByPlayer(playerId);
    if (liveActive && liveActive.planetId === planetId) {
      return {
        id: liveActive.colonyId, playerId, planetId, colonyIndex: liveActive.colonyIndex,
        name: liveActive.name ?? `Colony-${playerId.slice(-4)}`, color: liveActive.colonyIndex,
        status: liveActive.status, state: liveActive.status, foundingSectorId: liveActive.baseSectorId,
        spawnQ: liveActive.baseQ, spawnR: liveActive.baseR,
      } as ColonyRecord;
    }
    if (ctx.dev && this.o.planets.isScenarioColonyPlanet(planetId)) {
      return { id: 'col_0', playerId, planetId, colonyIndex: 0, name: 'Colony 1', spawnQ: 0, spawnR: 0, status: 'ACTIVE' } as ColonyRecord;
    }
    return null;
  }

  private rememberColony(memo: CommandContext['memo'], planetId: string, colony: ColonyRecord): void {
    if (!memo) return;
    memo.planetId = planetId;
    memo.colony = colony;
  }

  private dispatchWithColony(
    ctx: CommandContext,
    cmd: ClientMessageOf<'cmd'>,
    colony: ColonyRecord | null,
  ): Promise<void> | void {
    const pre = precheckClientCommand(cmd.d.kind, cmd.d.args, {
      gate: (k) => this.o.flags.gate(k, this.waveOf),
      production: this.o.production,
      hasColony: Boolean(colony),
    });
    if (!pre.ok) return this.reject(ctx, cmd, pre.code, pre.detail);
    if (!pre.dev && colony && normalizeColonyStatus(colony.status ?? colony.state ?? 'ACTIVE') !== 'ACTIVE') {
      return this.reject(ctx, cmd, 'colony_inactive');
    }
    if (!pre.dev && this.o.antiCheat) {
      const ac = this.o.antiCheat.validateCommand({
        transport: ctx.transport ?? 'ws',
        playerId: ctx.playerId,
        planetId: ctx.planetId,
        sectorId: ctx.sectorId,
        bindingHash: ctx.bindingHash,
        colony,
        kind: cmd.d.kind,
        args: pre.args,
        rawArgs: cmd.d.args,
        dev: pre.dev,
        production: this.o.production,
        isScenarioPlanet: Boolean(this.o.planets.isScenarioColonyPlanet?.(ctx.planetId)),
      });
      if (!ac.ok) return this.reject(ctx, cmd, ac.rejectCode, ac.detail);
    }
    if (this.o.prechecks?.has(cmd.d.kind)) return this.precheckThenSubmit(ctx, cmd, colony, pre.args, pre.dev);
    this.submit(ctx, cmd, colony, pre.args, pre.dev);
  }

  /** A registered server precheck (W13-01) may reject before the sim sees the command; otherwise it is submitted. */
  /** Awaited by the player's command chain, so a precheck never reorders that player's commands (BE-09). */
  private precheckThenSubmit(ctx: CommandContext, cmd: ClientMessageOf<'cmd'>, colony: ColonyRecord | null, args: unknown, dev: boolean): Promise<void> {
    const input = { kind: cmd.d.kind, args, playerId: ctx.playerId, planetId: ctx.planetId, colony: colony ? { id: colony.id, colonyIndex: colony.colonyIndex } : null, dev };
    return Promise.resolve()
      .then(() => this.o.prechecks!.run(input))
      .then(
        (out) => (out ? this.reject(ctx, cmd, out.code, out.detail) : this.submit(ctx, cmd, colony, args, dev)),
        () => this.reject(ctx, cmd, 'internal', 'precheck failed'),
      );
  }

  private submit(ctx: CommandContext, cmd: ClientMessageOf<'cmd'>, colony: ColonyRecord | null, args: unknown, dev: boolean): void {
    const simCmd: SimCommandV1 = {
      colonyIndex: colony ? colony.colonyIndex : null,
      source: dev ? 'dev' : 'player',
      commandId: cmd.id,
      kind: cmd.d.kind,
      args,
    };
    this.o.planets.submit(ctx.planetId, simCmd).then(
      (out) => {
        if (out.ok) {
          this.acked.inc({ kind: cmd.d.kind });
          ctx.reply({ v: 1, t: 'cmd.ack', d: { id: cmd.id, appliedAtTick: out.appliedAtTick } });
        } else if (isRejectCode(out.code)) this.reject(ctx, cmd, out.code, out.detail, out.unlocksAt); // the sim's cause (GP-31)
        else this.reject(ctx, cmd, 'internal', out.code);
      },
      () => this.reject(ctx, cmd, 'internal', 'engine unavailable'),
    );
  }

  private reject(ctx: CommandContext, cmd: ClientMessageOf<'cmd'>, code: RejectCode, detail?: string, unlocksAt?: string): void {
    this.rejected.inc({ kind: this.labelKind(cmd.d.kind), code });
    const d = detail ? detail.slice(0, REJECT_DETAIL_MAX) : ''; // a longer detail would fail the client's frame check
    ctx.reply({ v: 1, t: 'cmd.reject', d: { id: cmd.id, code, ...(d ? { detail: d } : {}), ...(unlocksAt ? { unlocksAt } : {}) } });
  }

  /** Unknown kinds share one label so a client cannot create unbounded metric series. */
  private labelKind(kind: string): string {
    return hasCommandKind(kind) ? kind : 'unknown';
  }
}

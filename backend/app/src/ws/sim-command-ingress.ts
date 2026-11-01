import { hasCommandKind, precheckClientCommand, REJECT_CODES, type ClientMessageOf, type RejectCode, type SimCommandV1 } from '@terra/contracts';
import { Counter, type Registry } from 'prom-client';
import type { ColonyRecord } from '../core/home/home.repository';
import type { FlagsService, CommandWaveLookup } from '../flags/flags.service';
import type { GamePlanets } from '../game/game-planets.service';
import type { CommandContext, CommandIngress } from './command-ingress';
import { CommandRateLimiter, type CommandRateLimitOptions } from './command-rate-limit';

const isRejectCode = (c: string): c is RejectCode => (REJECT_CODES as readonly string[]).includes(c);

export interface ColonyLookup {
  readonly dbEnabled?: boolean;
  findMemColonyByPlayerAndPlanet?(playerId: string, planetId: string): ColonyRecord | null;
  findColonyByPlayerAndPlanet?(playerId: string, planetId: string): Promise<ColonyRecord | null>;
  findColonyByPlayerId?(playerId: string): Promise<ColonyRecord | null>;
  findColonyByPlayer?(playerId: string): Promise<ColonyRecord | null>;
}

export interface SimCommandIngressOptions {
  readonly planets: GamePlanets;
  readonly flags: Pick<FlagsService, 'gate'>;
  readonly registry: Registry;
  readonly production: boolean;
  readonly homeRepo?: ColonyLookup;
  /** Per-player token bucket (default 20 commands/s, bursts of 40); over it a command is rejected `rate_limited`. */
  readonly rateLimit?: CommandRateLimitOptions;
}

/**
 * The command pipeline of PROTOCOL §4.2 / SIM-C-01: per-player rate limit, flag gate, strict args, origin/dev rules, colony from the session,
 * then `GamePlanets.submit` to the owning thread. The reply is sent when the engine applied the command (WS-21), so
 * the handler does not block the socket's frame queue: several commands may be in flight and are answered in step order.
 *
 * Colony: always derived server-side, never taken from the client. W00 sessions have no colony: dev kinds go in with
 * `colonyIndex: null`, `source: 'dev'`; any other kind is `not_own_colony`. In W01+, seated players resolve their
 * `colonyIndex` on the joined planet via `HomeRepository`.
 */
export class SimCommandIngress implements CommandIngress {
  /** Test seam: lets a test pretend a kind belongs to another wave. */
  waveOf: CommandWaveLookup | undefined;
  private readonly acked: Counter<'kind'>;
  private readonly rejected: Counter<'kind' | 'code'>;
  private readonly limiter: CommandRateLimiter;

  constructor(private readonly o: SimCommandIngressOptions) {
    this.acked = new Counter({ name: 'ta_planet_cmd_acked_total', help: 'Commands applied by the engine', labelNames: ['kind'], registers: [o.registry] });
    this.limiter = new CommandRateLimiter(o.rateLimit);
    this.rejected = new Counter({ name: 'ta_planet_cmd_rejected_total', help: 'Commands rejected', labelNames: ['kind', 'code'], registers: [o.registry] });
  }

  handle(ctx: CommandContext, cmd: ClientMessageOf<'cmd'>): void {
    if (!this.limiter.take(ctx.playerId)) return this.reject(ctx, cmd, 'rate_limited');
    const resolved = this.resolveColony(ctx.playerId, ctx.planetId);
    if (resolved instanceof Promise) {
      resolved.then(
        (colony) => this.dispatchWithColony(ctx, cmd, colony),
        () => this.reject(ctx, cmd, 'internal', 'colony lookup failed'),
      );
      return;
    }
    this.dispatchWithColony(ctx, cmd, resolved);
  }

  private resolveColony(playerId: string, planetId: string): ColonyRecord | null | Promise<ColonyRecord | null> {
    const fallback = (): ColonyRecord | null =>
      this.o.planets.isScenarioColonyPlanet?.(planetId)
        ? ({ id: 'col_0', playerId, planetId, colonyIndex: 0, name: 'Colony 1', spawnQ: 0, spawnR: 0, status: 'ACTIVE' } as ColonyRecord)
        : null;
    const repo = this.o.homeRepo;
    if (!repo) return fallback();
    if (repo.findMemColonyByPlayerAndPlanet) {
      const mem = repo.findMemColonyByPlayerAndPlanet(playerId, planetId);
      if (mem || !repo.dbEnabled) return mem ?? fallback();
    }
    if (repo.findColonyByPlayerAndPlanet) {
      return repo.findColonyByPlayerAndPlanet(playerId, planetId).then((c) => c ?? fallback());
    }
    if (repo.findColonyByPlayerId) {
      return repo.findColonyByPlayerId(playerId).then((c) => (c?.planetId === planetId ? c : fallback()));
    }
    if (repo.findColonyByPlayer) {
      return repo.findColonyByPlayer(playerId).then((c) => (c?.planetId === planetId ? c : fallback()));
    }
    return fallback();
  }

  private dispatchWithColony(
    ctx: CommandContext,
    cmd: ClientMessageOf<'cmd'>,
    colony: ColonyRecord | null,
  ): void {
    const pre = precheckClientCommand(cmd.d.kind, cmd.d.args, {
      gate: (k) => this.o.flags.gate(k, this.waveOf),
      production: this.o.production,
      hasColony: Boolean(colony),
    });
    if (!pre.ok) return this.reject(ctx, cmd, pre.code, pre.detail);
    if (!pre.dev && (colony?.status === 'ELIMINATED' || colony?.state === 'ELIMINATED')) {
      return this.reject(ctx, cmd, 'colony_inactive');
    }
    const simCmd: SimCommandV1 = {
      colonyIndex: colony ? colony.colonyIndex : null,
      source: pre.dev ? 'dev' : 'player',
      commandId: cmd.id,
      kind: cmd.d.kind,
      args: pre.args,
    };
    this.o.planets.submit(ctx.planetId, simCmd).then(
      (out) => {
        if (out.ok) {
          this.acked.inc({ kind: cmd.d.kind });
          ctx.reply({ v: 1, t: 'cmd.ack', d: { id: cmd.id, appliedAtTick: out.appliedAtTick } });
        } else this.reject(ctx, cmd, isRejectCode(out.code) ? out.code : 'internal', isRejectCode(out.code) ? undefined : out.code);
      },
      () => this.reject(ctx, cmd, 'internal', 'engine unavailable'),
    );
  }

  private reject(ctx: CommandContext, cmd: ClientMessageOf<'cmd'>, code: RejectCode, detail?: string): void {
    this.rejected.inc({ kind: this.labelKind(cmd.d.kind), code });
    ctx.reply({ v: 1, t: 'cmd.reject', d: { id: cmd.id, code, ...(detail ? { detail } : {}) } });
  }

  /** Unknown kinds share one label so a client cannot create unbounded metric series. */
  private labelKind(kind: string): string {
    return hasCommandKind(kind) ? kind : 'unknown';
  }
}

import { commandDef, hasCommandKind, parseCommandArgs, REJECT_CODES, type ClientMessageOf, type RejectCode, type SimCommandV1 } from '@terra/contracts';
import { Counter, type Registry } from 'prom-client';
import type { ColonyRecord } from '../core/home/home.repository';
import type { FlagsService, CommandWaveLookup } from '../flags/flags.service';
import type { GamePlanets } from '../game/game-planets.service';
import type { CommandContext, CommandIngress } from './command-ingress';

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
}

/**
 * The command pipeline of PROTOCOL §4.2 / SIM-C-01: flag gate, strict args, origin/dev rules, colony from the session,
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

  constructor(private readonly o: SimCommandIngressOptions) {
    this.acked = new Counter({ name: 'ta_planet_cmd_acked_total', help: 'Commands applied by the engine', labelNames: ['kind'], registers: [o.registry] });
    this.rejected = new Counter({ name: 'ta_planet_cmd_rejected_total', help: 'Commands rejected', labelNames: ['kind', 'code'], registers: [o.registry] });
  }

  handle(ctx: CommandContext, cmd: ClientMessageOf<'cmd'>): void {
    const pre = this.precheck(cmd);
    if (pre.reject) return this.reject(ctx, cmd, pre.reject, pre.detail);

    const resolved = this.resolveColony(ctx.playerId, ctx.planetId);
    if (resolved instanceof Promise) {
      resolved.then(
        (colony) => this.dispatchWithColony(ctx, cmd, pre, colony),
        () => this.reject(ctx, cmd, 'internal', 'colony lookup failed'),
      );
      return;
    }
    this.dispatchWithColony(ctx, cmd, pre, resolved);
  }

  private resolveColony(playerId: string, planetId: string): ColonyRecord | null | Promise<ColonyRecord | null> {
    const repo = this.o.homeRepo;
    if (!repo) return null;
    if (repo.findMemColonyByPlayerAndPlanet) {
      const mem = repo.findMemColonyByPlayerAndPlanet(playerId, planetId);
      if (mem || !repo.dbEnabled) return mem;
    }
    if (repo.findColonyByPlayerAndPlanet) {
      return repo.findColonyByPlayerAndPlanet(playerId, planetId);
    }
    if (repo.findColonyByPlayerId) {
      return repo.findColonyByPlayerId(playerId).then((c) => (c?.planetId === planetId ? c : null));
    }
    if (repo.findColonyByPlayer) {
      return repo.findColonyByPlayer(playerId).then((c) => (c?.planetId === planetId ? c : null));
    }
    return null;
  }

  private dispatchWithColony(
    ctx: CommandContext,
    cmd: ClientMessageOf<'cmd'>,
    pre: { args: unknown; dev: boolean },
    colony: ColonyRecord | null,
  ): void {
    if (!pre.dev) {
      if (!colony) return this.reject(ctx, cmd, 'not_own_colony');
      if (colony.status === 'ELIMINATED' || colony.state === 'ELIMINATED') {
        return this.reject(ctx, cmd, 'colony_inactive');
      }
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

  private precheck(cmd: ClientMessageOf<'cmd'>): { reject: RejectCode; detail?: string; args?: undefined; dev?: undefined } | { reject?: undefined; detail?: undefined; args: unknown; dev: boolean } {
    const gate = this.o.flags.gate(cmd.d.kind, this.waveOf);
    if (gate) return { reject: gate };
    const parsed = parseCommandArgs(cmd.d.kind, cmd.d.args);
    if (!hasCommandKind(cmd.d.kind)) return { reject: 'unknown_kind' };
    const def = commandDef(cmd.d.kind);
    if (def.origin !== 'client' || (def.dev && this.o.production)) return { reject: 'unknown_kind' };
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      return { reject: 'invalid_args', detail: i ? `${i.path.join('.') || 'args'}: ${i.message}`.slice(0, 200) : undefined };
    }
    return { args: parsed.data, dev: Boolean(def.dev) };
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

import { AWAY_AFTER_S } from '@terra/contracts';
import type { LastSeenPort, PresenceClock, PresenceCommandPort, PresenceJoin, PresenceLog, PresenceTransition } from './types';
import { postPresence, presenceCommand } from './post';

interface ColonyRec {
  planetId: string;
  colonyId: string;
  playerId: string;
  colonyIndex?: number;
  sockets: Set<string>;
  away: boolean;
  /** Set while the last socket is gone and the away timer has not fired. */
  disconnectedAt?: number;
  cancel?: () => void;
}

export interface PresenceTrackerDeps {
  readonly clock: PresenceClock;
  readonly commands: PresenceCommandPort;
  readonly lastSeen: LastSeenPort;
  readonly log?: PresenceLog;
  /** Fired when the colony flips away or back, before the sim command is posted. */
  readonly onTransition?: (info: PresenceTransition) => void | Promise<void>;
  /** Override for tests. Production uses `AWAY_AFTER_S` (60s). The boundary is inclusive. */
  readonly awayAfterMs?: number;
}

/**
 * In-memory presence (CT-10..13, D-24). No NATS and no leases.
 * A join cancels the away timer. The last socket's close starts it. At `AWAY_AFTER_S` the colony
 * is away; a reconnect at that exact time is away, then back. A blip shorter than that posts nothing.
 */
export class PresenceTracker {
  private readonly colonies = new Map<string, ColonyRec>();
  private readonly socketColony = new Map<string, string>();
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly deps: PresenceTrackerDeps) {}

  join(session: PresenceJoin): void {
    const rec = this.ensure(session);
    this.moveSocket(session.socketId, rec);
    this.flushIfDue(rec);
    rec.sockets.add(session.socketId);
    this.cancelTimer(rec);
    rec.disconnectedAt = undefined;
    if (rec.away) this.become(rec, false);
  }

  close(socketId: string): void {
    const colonyId = this.socketColony.get(socketId);
    if (!colonyId) return;
    this.socketColony.delete(socketId);
    this.dropSocket(colonyId, socketId);
  }

  /** Cancels timers. Used on shutdown so a dying process does not post into a stopped sim. */
  stop(): void {
    for (const rec of this.colonies.values()) this.cancelTimer(rec);
  }

  /** Resolves when queued presence posts have finished. Tests await this instead of sleeping. */
  settled(): Promise<void> {
    return this.tail;
  }

  /** Connected sockets on this planet, every colony. Zero is the coarse-step line (CT-14). */
  socketsOn(planetId: string): number {
    let n = 0;
    for (const rec of this.colonies.values()) if (rec.planetId === planetId) n += rec.sockets.size;
    return n;
  }

  /** Planet of a socket that is still tracked. Read this before `close`; close drops the id. */
  planetOf(socketId: string): string | undefined {
    const colonyId = this.socketColony.get(socketId);
    return colonyId ? this.colonies.get(colonyId)?.planetId : undefined;
  }

  private ensure(session: PresenceJoin): ColonyRec {
    const prev = this.colonies.get(session.colonyId);
    if (prev) {
      prev.planetId = session.planetId;
      prev.playerId = session.playerId;
      if (session.colonyIndex !== undefined) prev.colonyIndex = session.colonyIndex;
      return prev;
    }
    const rec: ColonyRec = {
      planetId: session.planetId,
      colonyId: session.colonyId,
      playerId: session.playerId,
      colonyIndex: session.colonyIndex,
      sockets: new Set(),
      away: false,
    };
    this.colonies.set(session.colonyId, rec);
    return rec;
  }

  /** A replaced socket is a different id. Moving one socket off a colony can start that colony's timer. */
  private moveSocket(socketId: string, rec: ColonyRec): void {
    const prevId = this.socketColony.get(socketId);
    this.socketColony.set(socketId, rec.colonyId);
    if (prevId && prevId !== rec.colonyId) this.dropSocket(prevId, socketId);
  }

  private dropSocket(colonyId: string, socketId: string): void {
    const rec = this.colonies.get(colonyId);
    if (!rec) return;
    rec.sockets.delete(socketId);
    if (rec.sockets.size > 0 || rec.away || rec.disconnectedAt !== undefined) return;
    rec.disconnectedAt = this.deps.clock.now();
    this.arm(rec);
  }

  /** Inclusive: `now === disconnectedAt + AWAY_AFTER_S` is already away, before the socket is counted again. */
  private flushIfDue(rec: ColonyRec): void {
    if (rec.away || rec.sockets.size > 0 || rec.disconnectedAt === undefined) return;
    if (this.deps.clock.now() < rec.disconnectedAt + this.awayMs()) return;
    this.cancelTimer(rec);
    this.become(rec, true);
  }

  private arm(rec: ColonyRec): void {
    this.cancelTimer(rec);
    const dueAt = (rec.disconnectedAt ?? this.deps.clock.now()) + this.awayMs();
    const wait = Math.max(0, dueAt - this.deps.clock.now());
    rec.cancel = this.deps.clock.delay(wait, () => this.onTimer(rec));
  }

  private onTimer(rec: ColonyRec): void {
    rec.cancel = undefined;
    if (rec.sockets.size > 0 || rec.away) return;
    this.become(rec, true);
  }

  private become(rec: ColonyRec, away: boolean): void {
    if (rec.away === away) return;
    rec.away = away;
    const at = new Date(this.deps.clock.now());
    this.notify(rec, away, at);
    this.enqueue(() => this.apply(rec, away, at));
  }

  private notify(rec: ColonyRec, away: boolean, at: Date): void {
    const fn = this.deps.onTransition;
    if (!fn) return;
    try {
      const out = fn({ planetId: rec.planetId, colonyId: rec.colonyId, away, at });
      if (out instanceof Promise) out.catch((err: unknown) => this.warn(err));
    } catch (err) {
      this.warn(err);
    }
  }

  private warn(err: unknown): void {
    this.deps.log?.warn({ err: err instanceof Error ? err.message : String(err) }, 'presence transition failed');
  }

  private async apply(rec: ColonyRec, away: boolean, at: Date): Promise<void> {
    const seen = await this.deps.lastSeen.touch({
      colonyId: rec.colonyId,
      playerId: rec.playerId,
      at,
      colonyIndex: rec.colonyIndex,
    });
    if (seen.colonyIndex !== undefined) rec.colonyIndex = seen.colonyIndex;
    const cmd = presenceCommand({ colonyId: rec.colonyId, away, colonyIndex: rec.colonyIndex });
    await postPresence(this.deps.commands, rec.planetId, cmd, this.deps.log);
  }

  private enqueue(work: () => Promise<void>): void {
    this.tail = this.tail.then(work).catch((err: unknown) => {
      this.deps.log?.warn({ err: err instanceof Error ? err.message : String(err) }, 'presence update failed');
    });
  }

  private cancelTimer(rec: ColonyRec): void {
    rec.cancel?.();
    rec.cancel = undefined;
  }

  private awayMs(): number {
    return this.deps.awayAfterMs ?? AWAY_AFTER_S * 1000;
  }
}

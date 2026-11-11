import type { GuildArrivedPayload, GuildDepartedPayload } from '@terra/contracts';
import { GUILD_DOCK_FALLBACK, type GuildDockSpot } from './dockSpot';

/** Descent and takeoff, in milliseconds of the injected clock. */
export const GUILD_TRANSIT_MS = 3000;
/** Metres above the hover height at the start of a descent and the end of a takeoff. */
export const GUILD_CRUISE_M = 32;
const BOB_M = 0.22;
const BOB_HZ = 0.45;

export type GuildShipPhase = 'descending' | 'docked' | 'departing' | 'gone';

export interface GuildDockMark {
  readonly shipId: string;
  readonly q: number;
  readonly r: number;
  /** false clears that ship's minimap mark. */
  readonly visible: boolean;
}

export interface GuildShipPose {
  readonly shipId: string;
  readonly phase: GuildShipPhase;
  readonly q: number;
  readonly r: number;
  readonly hubQ: number;
  readonly hubR: number;
  readonly startedAt: number;
  /** Metres above the hover height. */
  readonly altitudeM: number;
  readonly bobM: number;
  /** 0..1. */
  readonly flame: number;
}

export interface GuildShipPresenterOpts {
  /** Monotonic milliseconds. Tests move this; the view advances it with frame dt. */
  now(): number;
  /** When false the presenter never calls `marker` (W04 off must not touch the minimap). */
  w04: boolean;
  marker?(mark: GuildDockMark): void;
  dockFor?(shipId: string): GuildDockSpot;
  /** False ignores the push (another planet). Absent: every planet. */
  samePlanet?(planetId: string): boolean;
}

interface Visit {
  shipId: string;
  phase: GuildShipPhase;
  t0: number;
  /** Altitude (m) captured when a departure starts, so a mid-descent lift does not snap down. */
  fromAlt: number;
  q: number;
  r: number;
  hubQ: number;
  hubR: number;
  markShown: boolean;
}

/**
 * Guild visit phases for one ship id. A second `arrived` while the visit is not `gone` is ignored.
 * Departure during descent cancels the descent and lifts off from the current height.
 */
export class GuildShipPresenter {
  private readonly visits = new Map<string, Visit>();

  constructor(private readonly opts: GuildShipPresenterOpts) {}

  phase(shipId: string): GuildShipPhase | undefined {
    return this.visits.get(shipId)?.phase;
  }

  arrive(payload: GuildArrivedPayload): boolean {
    if (!this.forPlanet(payload.planetId)) return false;
    const cur = this.visits.get(payload.shipId);
    if (cur && cur.phase !== 'gone') return false;
    const spot = this.opts.dockFor?.(payload.shipId) ?? GUILD_DOCK_FALLBACK;
    const now = this.opts.now();
    this.visits.set(payload.shipId, {
      shipId: payload.shipId,
      phase: 'descending',
      t0: now,
      fromAlt: GUILD_CRUISE_M,
      q: spot.q,
      r: spot.r,
      hubQ: spot.hubQ,
      hubR: spot.hubR,
      markShown: false,
    });
    return true;
  }

  depart(payload: GuildDepartedPayload): boolean {
    if (!this.forPlanet(payload.planetId)) return false;
    const v = this.visits.get(payload.shipId);
    if (!v || v.phase === 'gone' || v.phase === 'departing') return false;
    const now = this.opts.now();
    v.fromAlt = altitudeM(v, now);
    v.phase = 'departing';
    v.t0 = now;
    this.syncMark(v, false);
    return true;
  }

  /** Advance every visit to `now()`. Descent and takeoff each finish at {@link GUILD_TRANSIT_MS}. */
  sync(): void {
    const now = this.opts.now();
    for (const v of this.visits.values()) this.advance(v, now);
  }

  poses(): GuildShipPose[] {
    const now = this.opts.now();
    const out: GuildShipPose[] = [];
    for (const v of this.visits.values()) out.push(this.poseOf(v, now));
    return out;
  }

  pose(shipId: string): GuildShipPose | undefined {
    const v = this.visits.get(shipId);
    return v ? this.poseOf(v, this.opts.now()) : undefined;
  }

  /** Drop visits the view has already removed. */
  forgetGone(): void {
    for (const [id, v] of this.visits) if (v.phase === 'gone') this.visits.delete(id);
  }

  private poseOf(v: Visit, now: number): GuildShipPose {
    return {
      shipId: v.shipId,
      phase: v.phase,
      q: v.q,
      r: v.r,
      hubQ: v.hubQ,
      hubR: v.hubR,
      startedAt: v.t0,
      altitudeM: altitudeM(v, now),
      bobM: v.phase === 'docked' ? Math.sin(((now - v.t0) / 1000) * Math.PI * 2 * BOB_HZ) * BOB_M : 0,
      flame: flameOf(v, now),
    };
  }

  private advance(v: Visit, now: number): void {
    if (v.phase === 'descending' && now - v.t0 >= GUILD_TRANSIT_MS) {
      v.phase = 'docked';
      v.t0 = now;
      this.syncMark(v, true);
      return;
    }
    if (v.phase === 'departing' && now - v.t0 >= GUILD_TRANSIT_MS) {
      v.phase = 'gone';
      this.syncMark(v, false);
    }
  }

  /** Marker only while docked, and only when W04 is on. */
  private syncMark(v: Visit, visible: boolean): void {
    if (!this.opts.w04 || !this.opts.marker) return;
    if (visible === v.markShown) return;
    v.markShown = visible;
    this.opts.marker({ shipId: v.shipId, q: v.q, r: v.r, visible });
  }

  private forPlanet(planetId: string): boolean {
    return this.opts.samePlanet ? this.opts.samePlanet(planetId) : true;
  }
}

function altitudeM(v: Visit, now: number): number {
  const u = ease(clamp01((now - v.t0) / GUILD_TRANSIT_MS));
  if (v.phase === 'descending') return GUILD_CRUISE_M * (1 - u);
  if (v.phase === 'departing') return v.fromAlt + (GUILD_CRUISE_M - v.fromAlt) * u;
  return 0;
}

function flameOf(v: Visit, now: number): number {
  const u = ease(clamp01((now - v.t0) / GUILD_TRANSIT_MS));
  if (v.phase === 'descending') return 1 - u;
  if (v.phase === 'departing') return 0.25 + 0.75 * u;
  return 0;
}

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const ease = (t: number) => t * t * (3 - 2 * t);

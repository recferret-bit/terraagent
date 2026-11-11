import { hashString } from '@terra/sim';
import { GuildVisitError } from './guild-visit.error.js';

/** Missed cadence windows materialised on one tick. Older ones are dropped (LED-35). */
export const MAX_VISIT_CATCHUP = 8;

export type VisitPhase = 'docked' | 'enroute';

export interface ScheduleInput {
  readonly seed: string;
  readonly npcId: string;
  readonly planetId: string;
  /** `loop-local` means this planet is the whole route (W11 off). */
  readonly route: readonly string[];
  readonly dockWindowMs: number;
  readonly visitGapMs: number;
  readonly enabled: boolean;
}

export interface VisitWindow {
  readonly npcId: string;
  readonly planetId: string;
  readonly arriveAt: number;
  readonly departAt: number;
}

export interface ScheduleView extends VisitWindow {
  readonly phase: VisitPhase;
  /** Where the ship goes after this window. One planet loops back to `planetId`. */
  readonly nextPlanetId: string;
}

interface Bounds {
  readonly cycle: number;
  readonly offset: number;
  readonly dock: number;
}

/** Stops other than the local-loop token. One stop, or none, means the ship returns to `planetId`. */
export function loopPlanet(planetId: string, route: readonly string[]): string {
  const stops = route.filter((stop) => stop.length > 0 && stop !== 'loop-local');
  if (stops.length <= 1) return planetId;
  const at = stops.indexOf(planetId);
  return stops[(at < 0 ? 0 : at + 1) % stops.length] ?? planetId;
}

/** Stable row id for one cadence window. A second tick of the same window hits this id. */
export function cadenceId(npcId: string, planetId: string, arriveAt: number): string {
  return `gv:${npcId}:${planetId}:${arriveAt}`;
}

export function extraVisitId(npcId: string, planetId: string, arriveAt: number, nonce: string): string {
  return `gv:x:${npcId}:${planetId}:${arriveAt}:${nonce}`;
}

/**
 * The dock that contains `nowMs`, or the next one when the ship is en route.
 * Same seed, npc, planet and `nowMs` always return the same times. W15 off returns null.
 */
export function scheduleAt(input: ScheduleInput, nowMs: number): ScheduleView | null {
  const b = bounds(input);
  if (!b || !Number.isInteger(nowMs)) return null;
  const index = nowMs < b.offset ? -1 : Math.floor((nowMs - b.offset) / b.cycle);
  const arriveAt = b.offset + Math.max(0, index) * b.cycle;
  const docked = index >= 0 && nowMs < arriveAt + b.dock;
  const start = docked || index < 0 ? arriveAt : arriveAt + b.cycle;
  return {
    npcId: input.npcId,
    planetId: input.planetId,
    arriveAt: start,
    departAt: start + b.dock,
    phase: docked ? 'docked' : 'enroute',
    nextPlanetId: loopPlanet(input.planetId, input.route),
  };
}

/** `count` docks from the current or next arrival. Empty when the wave is off. */
export function upcomingVisits(input: ScheduleInput, nowMs: number, count: number): VisitWindow[] {
  const first = scheduleAt(input, nowMs);
  if (!first || count <= 0) return [];
  const cycle = input.dockWindowMs + input.visitGapMs;
  const out: VisitWindow[] = [];
  for (let i = 0; i < count; i++) out.push(shift(input, first.arriveAt + i * cycle));
  return out;
}

/**
 * Cadence windows to open or close at `nowMs`.
 * `lastArriveAt` null is a cold start: only the window that is docked now, never the visits already missed.
 * Otherwise every window from that arrival through `nowMs`, capped at `limit`.
 */
export function dueWindows(
  input: ScheduleInput,
  lastArriveAt: number | null,
  nowMs: number,
  limit = MAX_VISIT_CATCHUP,
): VisitWindow[] {
  const b = bounds(input);
  if (!b || !Number.isInteger(nowMs)) return [];
  const end = Math.floor((nowMs - b.offset) / b.cycle);
  if (end < 0) return [];
  if (lastArriveAt === null) return coldWindow(input, b, end, nowMs);
  const start = Math.round((lastArriveAt - b.offset) / b.cycle);
  if (end < start) return [];
  const from = Math.max(start, end - limit + 1);
  const out: VisitWindow[] = [];
  for (let i = from; i <= end; i++) {
    const arriveAt = b.offset + i * b.cycle;
    if (arriveAt > nowMs) break;
    out.push(shift(input, arriveAt));
  }
  return out;
}

/** One extra dock starting at `nowMs`. A dock of 0 ms (or less) is rejected. It does not move the cadence. */
export function extraVisit(input: {
  npcId: string;
  planetId: string;
  nowMs: number;
  dockWindowMs: number;
}): VisitWindow {
  if (!Number.isInteger(input.dockWindowMs) || input.dockWindowMs <= 0) {
    throw new GuildVisitError('zero_visit', 'A Guild visit must last longer than 0 ms');
  }
  return {
    npcId: input.npcId,
    planetId: input.planetId,
    arriveAt: input.nowMs,
    departAt: input.nowMs + input.dockWindowMs,
  };
}

function coldWindow(input: ScheduleInput, b: Bounds, end: number, nowMs: number): VisitWindow[] {
  const arriveAt = b.offset + end * b.cycle;
  if (nowMs >= arriveAt + b.dock) return [];
  return [shift(input, arriveAt)];
}

function shift(input: ScheduleInput, arriveAt: number): VisitWindow {
  return { npcId: input.npcId, planetId: input.planetId, arriveAt, departAt: arriveAt + input.dockWindowMs };
}

function bounds(input: ScheduleInput): Bounds | null {
  if (!input.enabled) return null;
  const dock = input.dockWindowMs;
  const gap = input.visitGapMs;
  if (!Number.isInteger(dock) || !Number.isInteger(gap) || dock <= 0 || gap <= 0) return null;
  const cycle = dock + gap;
  const offset = hashString(`${input.seed}\0${input.npcId}\0${input.planetId}`) % cycle;
  return { cycle, offset, dock };
}

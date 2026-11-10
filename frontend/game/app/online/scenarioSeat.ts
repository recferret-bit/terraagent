/** Remembered `?scenario=` seat for this tab. A reload after `away` rejoins it; a reload before that still creates a fresh planet. */

export const SCENARIO_SEAT_KEY = 'ta.scenario.seat';
export const DEV_PLANET_ID = /^pl_[0-9A-Za-z]{1,40}$/;

export interface ScenarioSeat {
  readonly scenario: string;
  readonly planetId: string;
  readonly as: string;
  readonly resume: boolean;
}

export interface SeatStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ResumeChoice {
  readonly name: string;
  readonly planetId: string | null;
}

const randomName = () => `pilot-${Math.random().toString(36).slice(2, 8)}`;
const SCENARIO_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** `?scenario=<id>` (lower-cased, validated) or null. */
export function scenarioId(search: string): string | null {
  const v = new URLSearchParams(search).get('scenario')?.trim().toLowerCase();
  return v && SCENARIO_ID.test(v) ? v : null;
}

export function browserSeatStorage(): SeatStorage | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function readScenarioSeat(storage: SeatStorage | null): ScenarioSeat | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SCENARIO_SEAT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ScenarioSeat>;
    if (typeof parsed.scenario !== 'string' || typeof parsed.planetId !== 'string' || typeof parsed.as !== 'string') return null;
    if (!parsed.scenario || !parsed.as || !DEV_PLANET_ID.test(parsed.planetId)) return null;
    return { scenario: parsed.scenario, planetId: parsed.planetId, as: parsed.as, resume: parsed.resume === true };
  } catch {
    return null;
  }
}

export function writeScenarioSeat(storage: SeatStorage | null, seat: ScenarioSeat): void {
  if (!storage || !DEV_PLANET_ID.test(seat.planetId)) return;
  try { storage.setItem(SCENARIO_SEAT_KEY, JSON.stringify(seat)); } catch { /* private mode */ }
}

export function clearScenarioSeat(storage: SeatStorage | null): void {
  if (!storage) return;
  try { storage.removeItem(SCENARIO_SEAT_KEY); } catch { /* private mode */ }
}

/** Flip the stored seat to resume. No-op when this tab has not recorded a scenario planet yet. */
export function markScenarioResume(storage: SeatStorage | null = browserSeatStorage()): void {
  const seat = readScenarioSeat(storage);
  if (!seat || seat.resume) return;
  writeScenarioSeat(storage, { ...seat, resume: true });
}

/** Record the live scenario seat and rejoin it on the next reload of this tab. */
export function rememberAwayReturn(
  seat: { scenario: string; planetId: string; as: string },
  storage: SeatStorage | null = browserSeatStorage(),
): void {
  if (!seat.scenario || !seat.planetId || !seat.as) {
    markScenarioResume(storage);
    return;
  }
  writeScenarioSeat(storage, { scenario: seat.scenario, planetId: seat.planetId, as: seat.as, resume: true });
}

/** `away` on the server host: the next reload of this tab rejoins `planetId` as this dev player. */
export function rememberPageAway(
  search: string,
  planetId: string,
  accessToken: string,
  storage: SeatStorage | null = browserSeatStorage(),
): void {
  if (new URLSearchParams(search).get('host') === 'local') return;
  const as = accessToken.startsWith('dev:') ? accessToken.slice('dev:'.length) : '';
  rememberAwayReturn({ scenario: scenarioId(search) ?? '', planetId, as }, storage);
}

function devAs(search: string): string {
  return new URLSearchParams(search).get('as')?.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) ?? '';
}

/**
 * Name and planet for this load. `resume` seats rejoin the planet marked by `away`.
 * `?fresh=1`, a different scenario, or a different `?as=` start a new planet.
 */
export function chooseScenarioSeat(search: string, scenario: string | null, storage: SeatStorage | null): ResumeChoice {
  const fresh = new URLSearchParams(search).get('fresh') === '1';
  if (fresh) clearScenarioSeat(storage);
  const explicit = devAs(search);
  const stored = !fresh && scenario ? readScenarioSeat(storage) : null;
  const samePlayer = !explicit || explicit === stored?.as;
  if (stored && stored.scenario === scenario && stored.resume && samePlayer) {
    return { name: explicit || stored.as, planetId: stored.planetId };
  }
  return { name: explicit || randomName(), planetId: null };
}

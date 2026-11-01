import type { SimCommandV1 } from '@terra/contracts';
import type { Logger } from 'pino';
import { CoreConflict } from '../core/errors';
import { type ColonySeatAssignment, createSpawnColonyCommand } from '../core/home/home.service';
import { HOST_DOWN_CODES, type CommandOutcomeMsg, type GamePlanets, type LoadOptions } from './game-planets.service';
import type { SnapshotService } from './persistence/snapshot.service';
import type { ProgressionEventForwarder } from './progression-events.service';

/**
 * Budget of one landing (load the planet + `system.spawnColony`): the seat holds the global seat lock, so a planet
 * that never answers must not wedge every later `/me/home`.
 */
export const SEAT_LANDING_TIMEOUT_MS = 15_000;

/** What a seat needs from the game. */
export interface SeatHost {
  /** Loads the planet when it is not loaded; throws for a planet that must not be generated fresh (it has snapshots). */
  ensureLoaded(planetId: string, opts: LoadOptions): Promise<unknown>;
  submit(planetId: string, cmd: SimCommandV1): Promise<CommandOutcomeMsg>;
  /** The sim acked a landing after the seat timed out (its colony row was already rolled back). */
  onLateLanding?(assignment: ColonySeatAssignment, appliedAtTick: number): void;
}

/** The game's seat host: new planets through `SnapshotService.loadNew`, a late landing logged as an error. */
export function gameSeatHost(snapshots: Pick<SnapshotService, 'loadNew'>, planets: Pick<GamePlanets, 'submit'>, log: Pick<Logger, 'error'>): SeatHost {
  return {
    ensureLoaded: (planetId, opts) => snapshots.loadNew(planetId, opts),
    submit: (planetId, cmd) => planets.submit(planetId, cmd),
    onLateLanding: ({ planet, colony }, appliedAtTick) => log.error(
      { planetId: planet.id, colonyId: colony.id, appliedAtTick },
      `colony ${colony.id} landed on ${planet.id} after its seat timed out and was rolled back: the sim has a colony without a row`,
    ),
  };
}

const TIMED_OUT = Symbol('timed out');
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function beforeTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((r) => { timer = setTimeout(() => r(TIMED_OUT), ms); });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function seatRejected({ planet, colony }: ColonySeatAssignment, code: string, message: string, cause?: string): CoreConflict {
  return new CoreConflict('COLONY_SEAT_REJECTED', {
    message,
    details: { code, ...(cause === undefined ? {} : { cause }), planetId: planet.id, colonyId: colony.id, colonyIndex: colony.colonyIndex },
  });
}

/**
 * Lands a newly seated colony on its planet (loading the planet first). The sim may reject `system.spawnColony`
 * (`already_landed`, `landing_site_taken`, …): that is not a seat, so it throws `COLONY_SEAT_REJECTED` (409, the
 * sim's code in `details.code`) and `HomeService` rolls the colony row back instead of answering ACTIVE. A planet that
 * cannot be loaded (it has snapshots but is not loaded, its thread is down), a host-side reject (`thread_down`,
 * `planet_not_loaded`: in `details.cause`) or a landing not answered within `timeoutMs` is `details.code:
 * 'host_unavailable'` (rolled back, never retried).
 */
export async function seatColonyOnPlanet(host: SeatHost, assignment: ColonySeatAssignment, timeoutMs = SEAT_LANDING_TIMEOUT_MS): Promise<void> {
  const { planet, colony } = assignment;
  const started = Date.now();
  const left = () => Math.max(0, timeoutMs - (Date.now() - started));
  const params = { type: planet.type, seed: planet.seed, radius: planet.radius, capacity: planet.capacity };
  let loaded: unknown;
  try {
    loaded = await beforeTimeout(host.ensureLoaded(planet.id, { params }), left());
  } catch (e) {
    throw seatRejected(assignment, 'host_unavailable', `planet ${planet.id} cannot be loaded for colony ${colony.id}: ${errText(e)}`);
  }
  if (loaded === TIMED_OUT) throw seatRejected(assignment, 'host_unavailable', `loading ${planet.id} for colony ${colony.id} took over ${timeoutMs} ms`);
  const submitted = host.submit(planet.id, createSpawnColonyCommand(assignment));
  let out: CommandOutcomeMsg | typeof TIMED_OUT;
  try {
    out = await beforeTimeout(submitted, left());
  } catch (e) {
    throw seatRejected(assignment, 'host_unavailable', `landing of colony ${colony.id} on ${planet.id} failed: ${errText(e)}`);
  }
  if (out === TIMED_OUT) {
    void submitted.then((late) => { if (late.ok) host.onLateLanding?.(assignment, late.appliedAtTick); }, () => undefined);
    throw seatRejected(assignment, 'host_unavailable', `landing of colony ${colony.id} on ${planet.id} not answered within ${timeoutMs} ms`);
  }
  if (out.ok) return;
  if (HOST_DOWN_CODES.includes(out.code)) {
    throw seatRejected(assignment, 'host_unavailable', `landing of colony ${colony.id} on ${planet.id} failed: ${out.code}`, out.code);
  }
  throw seatRejected(assignment, out.code, `landing of colony ${colony.id} on ${planet.id} rejected by the sim: ${out.code}`);
}

/**
 * The game's seat listener: registers the colony's player with the progression forwarder (events name the player),
 * then lands it. A rejected landing unregisters it again, since `HomeService` rolls the colony row back (and may seat
 * the player again under a new colony id).
 */
export async function seatAndRegisterColony(
  forwarder: Pick<ProgressionEventForwarder, 'registerColony' | 'unregisterColony'>,
  host: SeatHost,
  assignment: ColonySeatAssignment,
): Promise<void> {
  const { colony } = assignment;
  forwarder.registerColony(colony.id, colony.playerId);
  try {
    await seatColonyOnPlanet(host, assignment);
  } catch (e) {
    forwarder.unregisterColony(colony.id);
    throw e;
  }
}

import {
  SECTOR_ID_REGEX,
  W11_SEVEN_SECTOR_COORDS,
  formatSectorId,
  type PlanetType,
  type PublicColonySummaryV1,
} from '@terra/contracts';
import { isRivalAiColony, restore, type PlanetState } from '@terra/sim';
import type { HomeRepository } from '../../core/home/home.repository';
import type { GamePlanets } from '../../game/game-planets.service';

const LIVING_COLONY_STATES: ReadonlySet<string> = new Set(['ACTIVE', 'ALIVE', 'FOUNDING', 'active', 'founding', 'critical']);
const ENDED_PLANET_STATES: ReadonlySet<string> = new Set(['ENDED', 'PLANET_ENDED', 'ARCHIVED']);
const FULL_STATE_TIMEOUT_MS = 350;

export interface LoadedPlanetTelemetry {
  readonly planetTypes: ReadonlyMap<string, PlanetType>;
  readonly humanKeysByType: Record<PlanetType, Set<string>>;
  readonly aiBotKeysByType: Record<PlanetType, Set<string>>;
  readonly liveColoniesByType: Record<PlanetType, PublicColonySummaryV1[]>;
}

function emptySets(): Record<PlanetType, Set<string>> {
  return { desert: new Set(), ocean: new Set(), temperate: new Set() };
}

function emptyLists(): Record<PlanetType, PublicColonySummaryV1[]> {
  return { desert: [], ocean: [], temperate: [] };
}

function sanitizeColonyId(rawId: unknown, index: number): string {
  if (typeof rawId === 'string' && /^(co|col)_[A-Za-z0-9_-]{1,64}$/.test(rawId)) return rawId;
  return `col_sim_${Math.max(0, index)}`;
}

function resolveSectorId(rawSector: unknown, index: number): string {
  if (typeof rawSector === 'string' && SECTOR_ID_REGEX.test(rawSector)) return rawSector;
  const [mq, mr] = W11_SEVEN_SECTOR_COORDS[Math.abs(index) % W11_SEVEN_SECTOR_COORDS.length]!;
  return formatSectorId(mq, mr);
}

async function readFullStateWithTimeout(gamePlanets: GamePlanets, planetId: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      gamePlanets.fullState(planetId, FULL_STATE_TIMEOUT_MS),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), FULL_STATE_TIMEOUT_MS + 25); }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function pushSummary(
  target: PublicColonySummaryV1[],
  seenNames: Set<string>,
  entry: PublicColonySummaryV1,
  dedupKey: string,
): void {
  if (seenNames.has(dedupKey)) return;
  seenNames.add(dedupKey);
  target.push(entry);
}

function collectOwnedColonyIndices(state: PlanetState): Set<number> {
  const owned = new Set<number>();
  const { count, cols } = state.entities;
  for (let r = 0; r < count; r++) {
    const owner = cols.owner[r];
    if (owner !== undefined && owner >= 0 && (cols.hp[r] ?? 0) > 0) owned.add(owner);
  }
  return owned;
}

async function collectFromHomeRepo(
  homeRepo: HomeRepository,
  out: LoadedPlanetTelemetry,
  planetTypes: Map<string, PlanetType>,
  seenNames: Set<string>,
  archivedIds: ReadonlySet<string>,
  inferType: (planetId: string, dbType?: string | null) => PlanetType,
): Promise<void> {
  const [planets, colonies] = await Promise.all([homeRepo.listPlanets(), homeRepo.listColonies()]);
  for (const p of planets) {
    if (!ENDED_PLANET_STATES.has(p.state) && !ENDED_PLANET_STATES.has(p.status)) {
      planetTypes.set(p.id, inferType(p.id, p.type));
    }
  }
  for (const c of colonies) {
    if (archivedIds.has(c.planetId)) continue;
    if (!LIVING_COLONY_STATES.has(c.status) && !LIVING_COLONY_STATES.has(c.state)) continue;
    const t = inferType(c.planetId, planetTypes.get(c.planetId));
    const isBot = c.playerId.startsWith('ai:');
    const key = `${c.planetId}:${c.id}`;
    if (isBot) out.aiBotKeysByType[t].add(key);
    else out.humanKeysByType[t].add(key);
    pushSummary(
      out.liveColoniesByType[t],
      seenNames,
      {
        colonyId: sanitizeColonyId(c.id, c.colonyIndex),
        displayName: c.name,
        foundingSectorId: resolveSectorId(c.foundingSectorId, c.colonyIndex),
        foundedAt: c.createdAt.toISOString(),
        ...(isBot ? { isBot: true } : {}),
      },
      key,
    );
  }
}

async function collectFromSimThreads(
  gamePlanets: GamePlanets,
  out: LoadedPlanetTelemetry,
  planetTypes: Map<string, PlanetType>,
  seenNames: Set<string>,
  archivedIds: ReadonlySet<string>,
  inferType: (planetId: string, dbType?: string | null) => PlanetType,
): Promise<void> {
  const loadedIds = gamePlanets.loadedIds();
  const snaps = await Promise.all(
    loadedIds
      .filter((id) => !archivedIds.has(id))
      .map(async (id) => ({ id, full: await readFullStateWithTimeout(gamePlanets, id) })),
  );
  const nowIso = new Date().toISOString();
  for (const { id, full } of snaps) {
    if (!full) continue;
    try {
      const state = restore(full.bytes);
      const t = inferType(id, full.planetType || state.meta.planetType || planetTypes.get(id));
      planetTypes.set(id, t);
      const ownedIndices = collectOwnedColonyIndices(state);
      for (const col of state.colonies) {
        if (!col || col.status === 'eliminated' || col.status === 'settled') continue;
        const playerId = typeof col.playerId === 'string' ? col.playerId : '';
        const isBot = isRivalAiColony(state, col.index) || playerId.startsWith('ai:');
        const isSeated =
          ownedIndices.has(col.index) ||
          playerId.length > 0 ||
          typeof col.landingSlotId === 'string' ||
          col.status === 'active';
        if (!isBot && !isSeated) continue;
        const colonyId = sanitizeColonyId(col.id, col.index);
        const key = `${id}:${colonyId}`;
        if (isBot) out.aiBotKeysByType[t].add(key);
        else if (!seenNames.has(key)) out.humanKeysByType[t].add(key);
        pushSummary(
          out.liveColoniesByType[t],
          seenNames,
          {
            colonyId,
            displayName: String(col.name || `Colony ${col.index + 1}`).slice(0, 64),
            foundingSectorId: resolveSectorId(col.foundingSectorId, col.index),
            foundedAt: nowIso,
            ...(isBot ? { isBot: true } : {}),
          },
          key,
        );
      }
    } catch {
      /* ignore transient snapshot decode failure */
    }
  }
}

/**
 * Collects living human & Rival AI bot colonies from in-memory `HomeRepository` and active `GamePlanets` sim threads.
 * Gives `GET /v1/planets` real player & bot counts even in dev/in-memory mode or before Rival AIs write DB rows.
 */
export async function collectLoadedPlanetTelemetry(options: {
  readonly gamePlanets?: GamePlanets;
  readonly homeRepo?: HomeRepository;
  readonly archivedIds: ReadonlySet<string>;
  readonly knownTypes: ReadonlyMap<string, PlanetType>;
  readonly inferType: (planetId: string, dbType?: string | null) => PlanetType;
}): Promise<LoadedPlanetTelemetry> {
  const planetTypes = new Map<string, PlanetType>(options.knownTypes);
  const out: LoadedPlanetTelemetry = {
    planetTypes,
    humanKeysByType: emptySets(),
    aiBotKeysByType: emptySets(),
    liveColoniesByType: emptyLists(),
  };
  const seenNames = new Set<string>();
  if (options.homeRepo) {
    await collectFromHomeRepo(options.homeRepo, out, planetTypes, seenNames, options.archivedIds, options.inferType);
  }
  if (options.gamePlanets && typeof options.gamePlanets.loadedIds === 'function') {
    await collectFromSimThreads(options.gamePlanets, out, planetTypes, seenNames, options.archivedIds, options.inferType);
  }
  return out;
}

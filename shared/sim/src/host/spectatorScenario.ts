import { resolveTileSector } from '../atlas/crossSectorGameplay';
import { getColonyStock } from '../economy/store';
import { ENTITY_KIND, ENTITY_STATE } from '../ecs/columns';
import type { LedgerPosting } from '../kernel/context';
import type { ColonyState, PlanetState } from '../kernel/state';
import { createPipeline } from '../kernel/step';
import { applyAutopilot } from '../systems/away/store';
import { mirrorAutopilotOnDirector } from '../systems/director/store';
import { getLandingPods } from '../systems/landing';
import {
  linkAllActiveColonyContacts,
  readRivalAiBlob,
  seedRivalAiColonies,
  writeRivalAiBlob,
  type RivalAiBlobValue,
  type RivalPersona,
} from '../systems/rival-ai';
import { PlanetJournal } from './journal';
import { SimHost } from './SimHost';
import { buildPipeline } from './tuning';

export interface PrepareSpectatorScenarioOptions {
  readonly botCount?: number;
  readonly fallbackFlags?: Iterable<string>;
}

export interface PreparedSpectatorScenario {
  readonly host: SimHost;
  readonly setupPostings: LedgerPosting[];
  readonly colonyCount: number;
}

function findColonyAnchor(state: PlanetState, col: ColonyState): { q: number; r: number } {
  const { count, cols } = state.entities;
  let bestRank = 0;
  let bestQ = typeof col.spawnQ === 'number' ? col.spawnQ : 0;
  let bestR = typeof col.spawnR === 'number' ? col.spawnR : 0;
  const rawPos = col as { q?: unknown; r?: unknown };
  if (typeof rawPos.q === 'number' && typeof rawPos.r === 'number' && typeof col.spawnQ !== 'number') {
    bestQ = rawPos.q;
    bestR = rawPos.r;
  }
  for (let row = 0; row < count; row++) {
    if (cols.owner[row] !== col.index || (cols.hp[row] ?? 0) <= 0 || cols.state[row] === ENTITY_STATE.inert) continue;
    const kind = cols.kind[row];
    const rank = kind === ENTITY_KIND.commandHub ? 3 : kind === ENTITY_KIND.hq ? 2 : kind === ENTITY_KIND.pod ? 1 : 0;
    if (rank > bestRank) {
      bestRank = rank;
      bestQ = Math.round(cols.q[row] ?? 0);
      bestR = Math.round(cols.r[row] ?? 0);
    }
  }
  return { q: bestQ, r: bestR };
}

function adoptColonyAsSpectatorBot(host: SimHost, col: ColonyState, blob: RivalAiBlobValue): void {
  const anchor = findColonyAnchor(host.state, col);
  col.status = 'active';
  col.isBot = true;
  col.aiEnabled = true;
  const colRec = col as unknown as Record<string, unknown>;
  colRec.isAiColony = true;
  const persona: RivalPersona =
    colRec.botPersona === 'warlord' || colRec.botPersona === 'trader'
      ? colRec.botPersona
      : col.index % 2 === 0
        ? 'trader'
        : 'warlord';
  colRec.botPersona = persona;
  if (typeof col.playerId !== 'string' || !col.playerId) {
    colRec.playerId = `ai:scenario_col_${col.index}`;
  }
  if (typeof colRec.handle !== 'string' || !colRec.handle) {
    colRec.handle = col.name || `scenario_bot_${col.index}`;
  }
  if (typeof colRec.foundingSectorId !== 'string' || !colRec.foundingSectorId) {
    colRec.foundingSectorId = resolveTileSector(host.state, anchor.q, anchor.r)?.sectorId ?? 'sec_0_0';
  }
  if (typeof col.spawnQ !== 'number') colRec.spawnQ = anchor.q;
  if (typeof col.spawnR !== 'number') colRec.spawnR = anchor.r;
  const awayRaids = persona === 'warlord';
  colRec.awayRaids = awayRaids;
  applyAutopilot(host.state, col.index, { mode: 'director', awayRaids }, host.pipeline.config.data, host.tick);
  mirrorAutopilotOnDirector(host.state, col.index, { mode: 'director', awayRaids }, host.tick);
  blob.rivals[col.index] = {
    colonyIndex: col.index,
    colonyId: col.id || `col_${col.index}`,
    name: col.name || `Colony ${col.index + 1}`,
    persona,
    risk: awayRaids ? 'risky' : 'conservative',
    allowWarDiplomacy: true,
    anchorQ: anchor.q,
    anchorR: anchor.r,
    seededAtTick: host.tick,
  };
}

function deployPendingScenarioPods(host: SimHost, setupPostings: LedgerPosting[]): void {
  const undeployedPods = getLandingPods(host.state).filter((p) => !p.deployed);
  if (undeployedPods.length === 0 || !host.pipeline.config.flags.has('W01')) return;
  const off = host.onPostings((p) => {
    setupPostings.push(...p);
  });
  try {
    for (const pod of undeployedPods) {
      host.submit({
        colonyIndex: pod.colonyId,
        source: 'dev',
        commandId: `spec_land_${pod.colonyId}`,
        kind: 'dev.land',
        args: {},
      });
      host.step(1);
    }
  } finally {
    off();
  }
}

function normalizeScenarioSetupPostings(host: SimHost, candidatePostings: readonly LedgerPosting[]): LedgerPosting[] {
  const probe = PlanetJournal.empty();
  const problems = probe.record(candidatePostings);
  if (problems.length === 0 && probe.reconcile(host.state).length === 0) {
    return [...candidatePostings];
  }
  const stocks = host.state.colonies.map((_c, i) => getColonyStock(host.state, i));
  return PlanetJournal.openingPostings(stocks, host.tick, 'system:seed');
}

function buildSpectatorHost(builtHost: SimHost, fallbackFlags?: Iterable<string>): SimHost {
  if (fallbackFlags) {
    const rawFlags = [...fallbackFlags];
    const next = new SimHost(buildPipeline(rawFlags, {}, undefined, 'authority_external_bots'));
    next.load(builtHost.state);
    return next;
  }
  if (builtHost.pipeline.config.hostRole === 'authority_external_bots') return builtHost;
  const next = new SimHost(createPipeline({ ...builtHost.pipeline.config, hostRole: 'authority_external_bots' }));
  next.load(builtHost.state);
  return next;
}

/**
 * Prepares a seeded scenario `SimHost` for zero-player spectator execution:
 * - Immediately deploys any descending landing pods (`dev.land`, e.g. `w01` / `w06`) while recording cargo postings.
 * - Upgrades pipeline flags to `fallbackFlags` (matching server `SimThreadPool` behavior) while preserving scenario overrides.
 * - Seeds Rival AI bots on empty scenarios (`w00`) or adopts live scenario colonies as active Rival AI bots, reconciling setup postings.
 */
export function prepareSpectatorScenarioHost(
  built: { readonly host: SimHost; readonly setupPostings: readonly LedgerPosting[] },
  opts: PrepareSpectatorScenarioOptions = {},
): PreparedSpectatorScenario {
  const setupPostings: LedgerPosting[] = [...built.setupPostings];
  const botCount = Math.max(1, Math.min(6, opts.botCount ?? 2));
  deployPendingScenarioPods(built.host, setupPostings);
  const host = buildSpectatorHost(built.host, opts.fallbackFlags);

  const liveCols = host.state.colonies.filter(
    (c): c is ColonyState => Boolean(c && c.status !== 'eliminated'),
  );

  if (liveCols.length === 0) {
    seedRivalAiColonies(host.state, {
      count: botCount,
      colonyIndices: Array.from({ length: botCount }, (_, idx) => idx),
      capacity: 8,
      tick: host.tick,
      data: host.pipeline.config.data,
      recordPosting: (p) => {
        setupPostings.push(p);
      },
    });
    const seededLive = host.state.colonies.filter((c) => Boolean(c && c.status !== 'eliminated')).length;
    return {
      host,
      setupPostings: normalizeScenarioSetupPostings(host, setupPostings),
      colonyCount: seededLive || botCount,
    };
  }

  const blob = readRivalAiBlob(host.state);
  for (const col of liveCols) adoptColonyAsSpectatorBot(host, col, blob);
  blob.governorEnabled = true;
  blob.seeded = true;
  writeRivalAiBlob(host.state, blob, host.tick);
  linkAllActiveColonyContacts(host.state, host.tick);

  return {
    host,
    setupPostings: normalizeScenarioSetupPostings(host, setupPostings),
    colonyCount: liveCols.length,
  };
}

import 'reflect-metadata';
import type { PrismaClient } from '@terra/db';
import { createAtlasPlanetState, createState, snapshot } from '@terra/sim';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { SectorAntiCheatService } from '../../src/core/anticheat';
import { HomeRepository, HomeService } from '../../src/core/home';
import { MetricsRegistry } from '../../src/core/metrics.registry';
import { FlagsService } from '../../src/flags/flags.service';
import { LobbyPersistenceService } from '../../src/lobby/lobby-persistence.service';
import { MatchTicketsService } from '../../src/lobby/tickets.service';
import { TradeError } from '../../src/market/trade/trade-error';
import { TradeOrdersService } from '../../src/market/trade/trade-orders.service';
import { BountyController } from '../../src/near/bounty/bounty.controller';
import { TreasuryProposalsService } from '../../src/near/treasury/proposals.service';
import { verifyPostSnapshotConnectionJoin } from '../../src/ws/parts/connection-helpers';
import { devPlayerId } from '../../src/ws/session-verifier';

function buildMultiSectorFixture() {
  const repo = new HomeRepository();
  const metrics = new MetricsRegistry();
  const antiCheat = new SectorAntiCheatService(repo, metrics);
  const state = createAtlasPlanetState({
    planetType: 'temperate',
    seed: 'round2-anticheat-fixture',
    sectorRadius: 24,
    gridRadius: 96,
    skipPerfCaps: true,
  });
  antiCheat.syncFromPlanetState('pl_atlas', state);

  const col0 = antiCheat.index.upsertColonyBase({
    playerId: 'pr_alpha',
    colonyId: 'co_alpha',
    planetId: 'pl_atlas',
    colonyIndex: 0,
    name: 'AlphaSpire',
    foundingSectorId: 'sec_0_0',
    spawnQ: 0,
    spawnR: 0,
    status: 'ACTIVE',
  });
  const col1 = antiCheat.index.upsertColonyBase({
    playerId: 'pr_bravo',
    colonyId: 'co_bravo',
    planetId: 'pl_atlas',
    colonyIndex: 1,
    name: 'BravoBastion',
    foundingSectorId: 'sec_1_0',
    spawnQ: 49,
    spawnR: -24,
    status: 'ACTIVE',
  });
  const col2SameSec = antiCheat.index.upsertColonyBase({
    playerId: 'pr_ally',
    colonyId: 'co_same_sec',
    planetId: 'pl_atlas',
    colonyIndex: 2,
    name: 'GammaOutpost',
    foundingSectorId: 'sec_0_0',
    spawnQ: 6,
    spawnR: -3,
    status: 'ACTIVE',
  });

  const spatial = antiCheat.index.getPlanet('pl_atlas')!;
  spatial.entitiesById.set(101, { entityId: 101, ownerColonyIndex: 0, kind: 1, q: 2, r: -1, sectorId: 'sec_0_0', alive: true });
  spatial.entitiesById.set(102, { entityId: 102, ownerColonyIndex: 0, kind: 2, q: 4, r: 0, sectorId: 'sec_0_0', alive: true });
  spatial.entitiesById.set(201, { entityId: 201, ownerColonyIndex: 1, kind: 1, q: 49, r: -24, sectorId: 'sec_1_0', alive: true });
  spatial.nextEntityId = 400;
  spatial.maxEntityId = 201;

  const ctx = {
    transport: 'ws' as const,
    playerId: 'pr_alpha',
    planetId: 'pl_atlas',
    sectorId: 'sec_0_0',
    bindingHash: col0.bindingHash,
    colony: { id: 'co_alpha', colonyIndex: 0, planetId: 'pl_atlas', foundingSectorId: 'sec_0_0' },
  };
  return { antiCheat, repo, col0, col1, col2SameSec, spatial, ctx };
}

describe('Round 2 AntiCheat — multi-field unit/producer/target & diplomacy bypasses', () => {
  it('validates ALL present unit/entity ID fields when combined in raid, combat & stance payloads', () => {
    const { antiCheat, ctx } = buildMultiSectorFixture();

    // Raid smuggling foreign unitIds alongside valid entityIds (sim reads unitIds ?? entityIds)
    expect(
      antiCheat.validateCommand({ ...ctx, kind: 'raid', args: { targetColonyId: 'co_same_sec', entityIds: [101], unitIds: [201] } }),
    ).toMatchObject({ ok: false, rejectCode: 'not_own_colony' });
    expect(
      antiCheat.validateCommand({
        ...ctx,
        kind: 'enqueueTask',
        args: { task: { kind: 'raid', targetColonyId: 'co_same_sec', entityIds: [101], unitIds: [201] } },
      }),
    ).toMatchObject({ ok: false, rejectCode: 'not_own_colony' });

    // Single+Batch combat schemas allowing both entityId and entityIds simultaneously
    expect(
      antiCheat.validateCommand({ ...ctx, kind: 'attackMove', args: { entityId: 201, entityIds: [101], q: 2, r: 0 } }),
    ).toMatchObject({ ok: false, rejectCode: 'not_own_colony' });
    expect(
      antiCheat.validateCommand({ ...ctx, kind: 'attackTarget', args: { entityId: 201, entityIds: [101], targetId: 305 } }),
    ).toMatchObject({ ok: false, rejectCode: 'not_own_colony' });
    expect(
      antiCheat.validateCommand({ ...ctx, kind: 'setStance', args: { entityId: 201, entityIds: [101], stance: 'defend' } }),
    ).toMatchObject({ ok: false, rejectCode: 'not_own_colony' });
  });

  it('validates ALL producer/hub/rally entity fields and ALL target-colony alias formats', () => {
    const { antiCheat, ctx } = buildMultiSectorFixture();

    // buildUnit with both producerId and hubEntityId
    expect(
      antiCheat.validateCommand({
        ...ctx,
        kind: 'enqueueTask',
        args: { task: { kind: 'buildUnit', unit: 'worker', producerId: 102, hubEntityId: 201 } },
      }),
    ).toMatchObject({ ok: false, rejectCode: 'not_own_colony' });

    // setRally with both producerId and entityId
    expect(
      antiCheat.validateCommand({ ...ctx, kind: 'setRally', args: { producerId: 102, entityId: 201, q: 2, r: 0 } }),
    ).toMatchObject({ ok: false, rejectCode: 'not_own_colony' });

    // Multiple target-colony fields where first is valid same-sector and second is foreign or conflicting
    expect(
      antiCheat.validateCommand({ ...ctx, kind: 'raid', args: { targetColonyId: 'co_same_sec', targetColonyIndex: 1, unitIds: [101] } }),
    ).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });
    expect(
      antiCheat.validateCommand({
        ...ctx,
        kind: 'diplomacy.declareWar',
        args: { targetColonyId: 'co_same_sec', toColony: 'co_bravo', bondAmount: 10 },
      }),
    ).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });

    // Sim alias parity: single-letter ('b' -> 1), hyphen ('COL-1'), and colony name ('BravoBastion')
    for (const alias of ['b', 'COL-1', 'BravoBastion']) {
      expect(antiCheat.validateCommand({ ...ctx, kind: 'raid', args: { targetColonyId: alias, unitIds: [101] } })).toMatchObject({
        ok: false,
        rejectCode: 'cross_sector_disabled',
      });
    }
    for (const selfAlias of ['a', 'COL-0', 'AlphaSpire', ' 0 ']) {
      expect(antiCheat.validateCommand({ ...ctx, kind: 'raid', args: { targetColonyId: selfAlias, unitIds: [101] } })).toMatchObject({
        ok: false,
        rejectCode: 'invalid_args',
      });
    }
  });
});

describe('Round 2 AntiCheat — diplomacy sector isolation & ID/alias checks', () => {
  it('enforces sector isolation and ownership on declareWar, proposeTruce, respondTruce, cancelTruce & cancelWar', () => {
    const { antiCheat, spatial, ctx } = buildMultiSectorFixture();

    expect(
      antiCheat.validateCommand({ ...ctx, kind: 'diplomacy.declareWar', args: { targetColonyId: 'co_same_sec', bondAmount: 10 } }).ok,
    ).toBe(true);
    expect(
      antiCheat.validateCommand({ ...ctx, kind: 'diplomacy.declareWar', args: { targetColonyId: 'co_bravo', bondAmount: 10 } }),
    ).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });
    expect(
      antiCheat.validateCommand({ ...ctx, kind: 'diplomacy.proposeTruce', args: { targetColonyId: 'co_bravo', hours: 6 } }),
    ).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });

    // Colony references smuggled in offerId / truceId / warId
    expect(
      antiCheat.validateCommand({ ...ctx, kind: 'diplomacy.respondTruce', args: { offerId: 'co_bravo', accept: true } }),
    ).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });
    expect(
      antiCheat.validateCommand({ ...ctx, kind: 'diplomacy.cancelTruce', args: { truceId: 'COL-1' } }),
    ).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });
    expect(
      antiCheat.validateCommand({ ...ctx, kind: 'diplomacy.cancelWar', args: { warId: 'BravoBastion' } }),
    ).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });

    // Indexed offer/truce/war records belonging to other colonies or foreign sectors
    spatial.diplomacyOffersById.set('of_foreign', { offerId: 'of_foreign', fromColonyIndex: 1, toColonyIndex: 0 });
    spatial.diplomacyOffersById.set('of_not_mine', { offerId: 'of_not_mine', fromColonyIndex: 2, toColonyIndex: 1 });
    spatial.diplomacyTrucesById.set('tr_other', { truceId: 'tr_other', colonyAIndex: 1, colonyBIndex: 2 });
    spatial.diplomacyWarsById.set('war_other', { warId: 'war_other', attackerColonyIndex: 2, defenderColonyIndex: 0 });

    expect(antiCheat.validateCommand({ ...ctx, kind: 'diplomacy.respondTruce', args: { offerId: 'of_foreign', accept: true } })).toMatchObject({
      ok: false,
      rejectCode: 'cross_sector_disabled',
    });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'diplomacy.respondTruce', args: { offerId: 'of_not_mine', accept: true } })).toMatchObject({
      ok: false,
      rejectCode: 'not_own_colony',
    });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'diplomacy.cancelTruce', args: { truceId: 'tr_other' } })).toMatchObject({
      ok: false,
      rejectCode: 'not_own_colony',
    });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'diplomacy.cancelWar', args: { warId: 'war_other' } })).toMatchObject({
      ok: false,
      rejectCode: 'not_own_colony',
    });
  });
});

describe('Round 2 AntiCheat — precedence bypasses & O(1) Home/Tickets/WS live parity', () => {
  it('blocks hq, autoSitePrep & system precedence on enqueueTask and repair while allowing player/auto', () => {
    const { antiCheat, ctx } = buildMultiSectorFixture();

    for (const badPrec of ['system', 'hq', 'autoSitePrep'] as const) {
      expect(
        antiCheat.validateCommand({
          ...ctx,
          kind: 'enqueueTask',
          args: { precedence: badPrec, task: { kind: 'build', building: 'roboticsFactory', q: 0, r: 0 } },
        }),
      ).toMatchObject({ ok: false, rejectCode: 'invalid_args' });

      expect(
        antiCheat.validateCommand({ ...ctx, kind: 'repair', args: { entityId: 102, precedence: badPrec } }),
      ).toMatchObject({ ok: false, rejectCode: 'invalid_args' });
    }

    expect(
      antiCheat.validateCommand({
        ...ctx,
        kind: 'enqueueTask',
        args: { precedence: 'player', task: { kind: 'build', building: 'pylon', q: 0, r: 0 } },
      }).ok,
    ).toBe(true);
    expect(antiCheat.validateCommand({ ...ctx, kind: 'repair', args: { entityId: 102, precedence: 'auto' } }).ok).toBe(true);
  });

  it('propagates live terminalFromLive elimination/planet-end immediately to HomeService, MatchTicketsService & WS post-snapshot join', async () => {
    const repo = new HomeRepository();
    const persistence = new LobbyPersistenceService();
    const antiCheat = new SectorAntiCheatService(repo);
    const homeService = new HomeService(repo, undefined, persistence, undefined, antiCheat);
    const tickets = new MatchTicketsService(persistence, undefined, repo, homeService, antiCheat);

    const planet = await repo.upsertDevPlanet('pl_live', { radius: 32, capacity: 4 });
    const { colony } = await repo.createColony({
      id: 'co_live_1',
      playerId: 'pr_live_1',
      planetId: 'pl_live',
      colonyIndex: 0,
      name: 'LiveColony',
      status: 'ACTIVE',
      foundingSectorId: 'sec_0_0',
      spawnQ: 0,
      spawnR: 0,
    });
    antiCheat.recordColonyBase(colony, planet, true);

    // O(1) HomeRepository lookup hits latestByPlayerPlanet without store scan
    expect((await repo.findColonyByPlayerAndPlanet('pr_live_1', 'pl_live'))?.id).toBe('co_live_1');
    expect((await homeService.getExistingHome('pr_live_1'))?.state).toBe('ACTIVE');
    expect(await tickets.resolveActivePlayerHome('pr_live_1')).not.toBeNull();

    // Live sim elimination before DB updates HomeRepository: HomeService & MatchTicketsService reflect ELIMINATED immediately
    antiCheat.applyPlanetEvents('pl_live', [
      { kind: 'colonyEliminated', severity: 'critical', colonyIds: [0], atTick: 40, data: { colonyId: 'co_live_1', colonyIndex: 0 } },
    ]);
    expect((await repo.findColonyById('co_live_1'))?.status).toBe('ACTIVE');
    expect((await homeService.getExistingHome('pr_live_1'))?.state).toBe('ELIMINATED');
    await expect(homeService.resumeColony('pr_live_1', 'co_live_1')).rejects.toMatchObject({ errorCode: 'COLONY_UNAVAILABLE' });
    expect(await tickets.resolveActivePlayerHome('pr_live_1')).toBeNull();

    // WS post-snapshot join check rejects single-sector sec_1_0 and live-eliminated colonies
    const singleSnap = snapshot(createState({ planetId: 'pl_single', planetType: 'temperate', seed: 'single', radius: 16 }));
    antiCheat.syncFromSnapshotBytes('pl_single', singleSnap);
    expect(
      verifyPostSnapshotConnectionJoin({
        antiCheat,
        planetId: 'pl_single',
        colonyId: null,
        colonyIndex: undefined,
        requestedSectorId: 'sec_1_0',
        dev: true,
        isScenarioPlanet: false,
      }),
    ).toEqual({ ok: false, reason: 'invalid_sector' });
    expect(
      verifyPostSnapshotConnectionJoin({
        antiCheat,
        planetId: 'pl_live',
        colonyId: 'co_live_1',
        colonyIndex: 0,
        requestedSectorId: 'sec_0_0',
        dev: false,
        isScenarioPlanet: false,
      }),
    ).toEqual({ ok: false, reason: 'colony_inactive' });
  });
});

describe('Round 2 AntiCheat — BountyController, TreasuryProposalsService & TradeOrdersService HTTP guards', () => {
  it('hydrates cold planets on BountyController and blocks cross-sector ULID bounty claims without sectorId', async () => {
    const { antiCheat } = buildMultiSectorFixture();
    const state = createAtlasPlanetState({
      planetType: 'temperate',
      seed: 'round2-anticheat-fixture',
      sectorRadius: 24,
      gridRadius: 96,
      skipPerfCaps: true,
    });
    // Simulate cold planet (clear syncedFromSim) and omit body.sectorId
    antiCheat.removePlanet('pl_atlas');
    expect(antiCheat.index.getPlanet('pl_atlas')?.syncedFromSim).toBe(false);

    const alphaDevId = devPlayerId('alpha');
    antiCheat.index.upsertColonyBase({
      playerId: alphaDevId,
      colonyId: 'co_alpha',
      planetId: 'pl_atlas',
      colonyIndex: 0,
      foundingSectorId: 'sec_0_0',
      spawnQ: 0,
      spawnR: 0,
      status: 'ACTIVE',
    });
    const storedBounties = new Map<string, { planetId: string; posterColonyId: string; colonyIndex: number; target: unknown }>();
    const prisma = {
      colony: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === 'co_alpha'
            ? { id: 'co_alpha', playerId: alphaDevId, planetId: 'pl_atlas', colonyIndex: 0, foundingSectorId: 'sec_0_0' }
            : { id: 'co_bravo', playerId: 'pr_bravo', planetId: 'pl_atlas', colonyIndex: 1, foundingSectorId: 'sec_1_0' },
        ),
      },
      nearColonyAccount: { findFirst: vi.fn(async () => ({ accountId: 'alpha.pilot.terraagent.mock', playerId: alphaDevId })) },
      chainBounty: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => storedBounties.get(where.id) ?? null),
      },
    } as unknown as PrismaClient;

    const ctrl = new BountyController(
      {
        post: vi.fn(async (inp: { bountyId?: string; planetId: string; colonyId: string; colonyIndex: number; args: { target: unknown } }) => {
          const id = inp.bountyId ?? 'bt_01JULIDFOREIGN0001';
          storedBounties.set(id, { planetId: inp.planetId, posterColonyId: inp.colonyId, colonyIndex: inp.colonyIndex, target: inp.args.target });
          return { id, state: 'open' };
        }),
        list: vi.fn(),
      } as never,
      { claim: vi.fn(async () => ({ id: 'bt_01JULIDFOREIGN0001', state: 'claimed' })) } as never,
      new FlagsService({ TA_WAVES: 'all' } as never),
      prisma,
      undefined,
      { NODE_ENV: 'test' } as never,
      antiCheat,
      { load: async (pid) => { antiCheat.syncFromPlanetState(pid, state); return state; } },
    );
    const reqAlpha = { headers: { authorization: 'Bearer dev:alpha' } } as unknown as IncomingMessage;

    // Cold planet without body.sectorId still hydrates and blocks cross-sector defend_area post
    await expect(
      ctrl.post(
        'pl_atlas',
        {
          colonyId: 'co_alpha',
          colonyIndex: 0,
          target: { kind: 'defend_area', q: 49, r: -24, radius: 4, durationH: 2 },
          reward: { resource: 'metals.t1', amount: 10 },
          expiresAt: Date.now() + 7_200_000,
        },
        reqAlpha,
      ),
    ).rejects.toMatchObject({ errorCode: 'CROSS_SECTOR_DISABLED', status: 403 });

    // Bravo in sec_1_0 posts ULID bounty; Alpha in sec_0_0 cannot claim it (even after clearing RAM bountiesById)
    storedBounties.set('bt_01JULIDFOREIGN0001', {
      planetId: 'pl_atlas',
      posterColonyId: 'co_bravo',
      colonyIndex: 1,
      target: { kind: 'clear_nest', nestId: 'nest_custom_id' },
    });
    await expect(
      ctrl.claim('pl_atlas', 'bt_01JULIDFOREIGN0001', { colonyId: 'co_alpha', colonyIndex: 0 }, reqAlpha),
    ).rejects.toMatchObject({ errorCode: 'CROSS_SECTOR_DISABLED', status: 403 });
  });
});

describe('Round 2 AntiCheat — TreasuryProposalsService & TradeOrdersService live guards', () => {
  it('enforces live planet_ended and colony_inactive on TreasuryProposalsService and TradeOrdersService before DB writes', async () => {
    const { antiCheat } = buildMultiSectorFixture();
    const flags = new FlagsService({ TA_WAVES: 'all' } as never);

    // 1. TreasuryProposalsService: live ELIMINATED colony & live ENDED planet block propose/vote even when DB says ACTIVE
    const treasuryPrisma = {
      planet: { findUnique: vi.fn(async () => ({ lifecycle: 'ACTIVE', state: 'ACTIVE' })) },
      colony: { findFirst: vi.fn(async () => ({ id: 'co_alpha' })) },
      nearColonyAccount: { findFirst: vi.fn(async () => ({ accountId: 'alpha.pilot.terraagent.mock', colonyId: 'co_alpha' })) },
      mockChainDaoProposal: { findMany: vi.fn(async () => []) },
    } as unknown as PrismaClient;
    const proposals = new TreasuryProposalsService(
      flags,
      { ensurePlanetDao: vi.fn(async () => ({ daoAccountId: 'dao.terraagent.mock' })) } as never,
      { get: vi.fn(async () => ({ proposals: [] })), propose: vi.fn(), vote: vi.fn() } as never,
      treasuryPrisma,
      { NODE_ENV: 'test' } as never,
      undefined,
      undefined,
      { verifyAccessToken: () => ({ playerId: 'pr_alpha', sub: 'pr_alpha', handle: 'alpha', isGuest: false }) } as never,
      undefined,
      antiCheat,
    );
    const reqAlpha = { headers: { authorization: 'Bearer jwt_alpha' } } as unknown as IncomingMessage;

    antiCheat.recordColonyStatus('co_alpha', 'ELIMINATED');
    await expect(proposals.propose('pl_atlas', { kind: 'meteor_shield' }, reqAlpha)).rejects.toMatchObject({
      errorCode: 'COLONY_INACTIVE',
      status: 409,
    });
    antiCheat.recordPlanetStatus('pl_atlas', 'ENDED');
    await expect(proposals.vote('pl_atlas', '1', { vote: 'approve' }, reqAlpha)).rejects.toMatchObject({
      errorCode: 'planet_ended',
      status: 409,
    });

    // 2. TradeOrdersService: getColonyByPlanetIndex fallback & ended-planet check reject before opening DB transaction
    const lockOwner = vi.fn();
    const tradeService = new TradeOrdersService(
      {} as never,
      { lockOwner } as never,
      {} as never,
      {} as never,
      {} as never,
      flags,
      { NODE_ENV: 'test' } as never,
      antiCheat,
    );
    const principal = {
      ownerId: 'pr_bravo',
      ownerRef: 'player:pr_bravo',
      actorKind: 'player' as const,
      scopes: new Set(['read', 'trade', 'manage'] as const),
      colonyFor: vi.fn(async () => ({ colonyId: 'co_unindexed_ulid', colonyIndex: 1, accountId: 'bravo.mock' })),
    };

    await expect(tradeService.colonyOrThrow(principal as never, 'pl_atlas')).rejects.toEqual(
      expect.objectContaining({ code: 'planet_ended', status: 409 } satisfies Partial<TradeError>),
    );
    antiCheat.recordPlanetStatus('pl_atlas', 'ACTIVE');
    antiCheat.recordColonyStatus('co_bravo', 'ELIMINATED');
    await expect(tradeService.colonyOrThrow(principal as never, 'pl_atlas')).rejects.toMatchObject({ code: 'no_colony' });
    expect(lockOwner).not.toHaveBeenCalled();
  });
});

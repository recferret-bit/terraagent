import 'reflect-metadata';
import { CANONICAL_PLANETS, newId, type ClientMessageOf } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { createAtlasPlanetState } from '@terra/sim';
import type { IncomingMessage } from 'node:http';
import { Registry } from 'prom-client';
import { describe, expect, it, vi } from 'vitest';
import { McpService } from '../../src/ai/mcp/mcp.service';
import { SectorAntiCheatService } from '../../src/core/anticheat';
import { HomeRepository, HomeService } from '../../src/core/home';
import { FlagsService } from '../../src/flags/flags.service';
import {
  CanonicalWorldProvisioningService,
  LobbyPersistenceService,
  MatchTicketsService,
  MemoryLobbyStore,
  SectorReservationService,
  WorldLifecycleService,
  WorldReconciliationService,
} from '../../src/lobby';
import { TradeError } from '../../src/market/trade/trade-error';
import { TradeOrdersService } from '../../src/market/trade/trade-orders.service';
import { BountyController } from '../../src/near/bounty/bounty.controller';
import { NearDeedController } from '../../src/near/deed/deed.controller';
import { DirectorKeyService } from '../../src/near/director-key/director-key.service';
import { verifyConnectionJoin } from '../../src/ws/parts/connection-helpers';
import { SimCommandIngress } from '../../src/ws/sim-command-ingress';
import { devPlayerId } from '../../src/ws/session-verifier';

function createAtlasFixture() {
  const repo = new HomeRepository();
  const antiCheat = new SectorAntiCheatService(repo);
  const state = createAtlasPlanetState({
    planetType: 'temperate',
    seed: 'review-regression-seed',
    sectorRadius: 24,
    gridRadius: 96,
    skipPerfCaps: true,
  });
  antiCheat.syncFromPlanetState('pl_atlas', state);

  const col0 = antiCheat.index.upsertColonyBase({
    playerId: 'pr_alpha', colonyId: 'co_alpha', planetId: 'pl_atlas', colonyIndex: 0,
    name: 'AlphaSpire', foundingSectorId: 'sec_0_0', spawnQ: 0, spawnR: 0, status: 'ACTIVE',
  });
  antiCheat.index.upsertColonyBase({
    playerId: 'pr_of_bravo', colonyId: 'co_bravo', planetId: 'pl_atlas', colonyIndex: 1,
    name: 'of_bravo', foundingSectorId: 'sec_1_0', spawnQ: 49, spawnR: -24, status: 'ACTIVE',
  });
  antiCheat.index.upsertColonyBase({
    playerId: 'pr_tr_charlie', colonyId: 'co_charlie', planetId: 'pl_atlas', colonyIndex: 2,
    name: 'tr_charlie', foundingSectorId: 'sec_1_0', spawnQ: 50, spawnR: -24, status: 'ACTIVE',
  });
  antiCheat.index.upsertColonyBase({
    playerId: 'pr_war_delta', colonyId: 'co_delta', planetId: 'pl_atlas', colonyIndex: 3,
    name: 'war_delta', foundingSectorId: 'sec_1_0', spawnQ: 51, spawnR: -24, status: 'ACTIVE',
  });

  const spatial = antiCheat.index.getPlanet('pl_atlas')!;
  spatial.entitiesById.set(101, { entityId: 101, ownerColonyIndex: 0, kind: 1, q: 2, r: -1, sectorId: 'sec_0_0', alive: true });
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
  return { repo, antiCheat, spatial, ctx };
}

async function createLobbyTransferHarness() {
  const store = new MemoryLobbyStore();
  const persistence = new LobbyPersistenceService(undefined, undefined, store);
  const lifecycle = new WorldLifecycleService(persistence);
  const homeRepo = new HomeRepository();
  const antiCheat = new SectorAntiCheatService(homeRepo);
  const homeService = new HomeService(homeRepo, undefined, persistence, lifecycle, antiCheat);
  const reservations = new SectorReservationService(persistence, lifecycle, undefined, antiCheat);
  const provisioning = new CanonicalWorldProvisioningService(persistence, lifecycle, homeRepo);
  const reconciliation = new WorldReconciliationService(
    persistence, lifecycle, reservations, undefined, provisioning, homeRepo, undefined, undefined, antiCheat,
  );
  const tickets = new MatchTicketsService(persistence, lifecycle, homeRepo, homeService, antiCheat);
  await provisioning.provisionAllCanonicalWorlds({ foundingSeatsPerSector: 4 });
  return { homeRepo, antiCheat, homeService, reservations, reconciliation, tickets };
}

describe('AntiCheat Review — rawArgs, to-coords, cancelTask, market.cancelOrder & diplomacy prefixes', () => {
  it('blocks rawArgs unitIds smuggling in SimCommandIngress and to-coordinate overrides', async () => {
    const { antiCheat, ctx } = createAtlasFixture();
    expect(
      antiCheat.validateCommand({ ...ctx, kind: 'attackMove', args: { entityId: 101, q: 0, r: 0, to: { q: 49, r: -24 } } }),
    ).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });

    const homeRepo = new HomeRepository();
    await homeRepo.createColony({
      id: 'co_alpha', playerId: 'pr_alpha', planetId: 'pl_atlas', colonyIndex: 0,
      name: 'AlphaSpire', status: 'ACTIVE', foundingSectorId: 'sec_0_0', spawnQ: 0, spawnR: 0,
    });
    const submitSpy = vi.fn(async () => ({ ok: true as const, commandId: 'cm_1', appliedAtTick: 1 }));
    const ingress = new SimCommandIngress({
      planets: { submit: submitSpy, isScenarioColonyPlanet: () => false } as never,
      flags: new FlagsService({ TA_WAVES: 'all' } as never),
      registry: new Registry(),
      production: false,
      homeRepo,
      antiCheat,
    });
    let replyMsg: { t: string; d: Record<string, unknown> } | undefined;
    const frame: ClientMessageOf<'cmd'> = {
      v: 1, t: 'cmd', id: 'cm_smuggle',
      d: { kind: 'attackMove', args: { entityIds: [101], unitIds: [201], q: 2, r: 0 } },
    };
    await ingress.handle(
      { transport: 'ws', playerId: 'pr_alpha', planetId: 'pl_atlas', sectorId: 'sec_0_0', reply: (m) => { replyMsg = m as never; } },
      frame,
    );
    expect(replyMsg).toMatchObject({ t: 'cmd.reject', d: { code: 'not_own_colony' } });
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('validates cancelTask entity prefixes, market.cancelOrder refs, of_/tr_/war_ names, and colonyFounded/hqLanded events', () => {
    const { antiCheat, ctx } = createAtlasFixture();
    expect(antiCheat.validateCommand({ ...ctx, kind: 'cancelTask', args: { taskId: 'building:201' } })).toMatchObject({ ok: false, rejectCode: 'not_own_colony' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'cancelTask', args: { taskId: 'building:0' } })).toMatchObject({ ok: false, rejectCode: 'invalid_args' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'cancelTask', args: { taskId: 'building:101' } }).ok).toBe(true);
    expect(antiCheat.validateCommand({ ...ctx, kind: 'market.cancelOrder', args: { orderId: 'market-order:co_bravo:4' } })).toMatchObject({ ok: false, rejectCode: 'not_own_colony' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'market.cancelOrder', args: { orderId: 'market-order:co_alpha:4' } }).ok).toBe(true);

    expect(antiCheat.validateCommand({ ...ctx, kind: 'diplomacy.respondTruce', args: { offerId: 'of_bravo', accept: true } })).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'diplomacy.cancelTruce', args: { truceId: 'tr_charlie' } })).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'diplomacy.cancelWar', args: { warId: 'war_delta' } })).toMatchObject({ ok: false, rejectCode: 'cross_sector_disabled' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'diplomacy.respondTruce', args: { offerId: 'of_99', accept: true } }).ok).toBe(true);

    antiCheat.applyPlanetEvents('pl_atlas', [
      { kind: 'colonyFounded', severity: 'info', colonyIds: ['co_bravo'], atTick: 10, data: { colonyId: 'co_bravo', hubId: 305, q: 49, r: -24 } },
      { kind: 'hqLanded', severity: 'info', colonyIds: ['co_bravo'], atTick: 11, data: { colonyId: 'co_bravo', entityId: 306, podEntityId: 307, q: 49, r: -24 } },
    ]);
    expect(antiCheat.validateCommand({ ...ctx, kind: 'demolish', args: { entityId: 305 } })).toMatchObject({ ok: false, rejectCode: 'not_own_colony' });
    expect(antiCheat.validateCommand({ ...ctx, kind: 'demolish', args: { entityId: 307 } })).toMatchObject({ ok: false, rejectCode: 'not_own_colony' });
  });
});

describe('AntiCheat Review — TRANSFERRED non-resurrection & mid-TRANSFER HTTP/WS parity', () => {
  it('never resurrects TRANSFERRED colonies on active worlds', async () => {
    const { homeRepo, antiCheat, homeService } = await createLobbyTransferHarness();
    const planetA = CANONICAL_PLANETS.desert.id;
    const { colony: settledCol } = await homeRepo.createColony({
      id: newId('co'), playerId: 'pr_settled_only', planetId: planetA, colonyIndex: 0,
      name: 'SettledBase', status: 'TRANSFERRED', foundingSectorId: 'sec_0_0', spawnQ: 0, spawnR: 0,
    });
    const settledHome = await homeService.getExistingHome('pr_settled_only', planetA);
    expect(settledHome?.state).toBe('PLANET_ENDED');
    expect(
      await antiCheat.verifyJoin({
        transport: 'ws', playerId: 'pr_settled_only', targetPlanetId: planetA,
        resolvedHome: settledHome ?? undefined, allowNewJoin: false,
      }),
    ).toMatchObject({ ok: false, reason: 'colony_inactive' });
    expect(antiCheat.index.getColonyById(settledCol.id)?.status).toBe('ENDED');
  });

  it('switches HTTP/WS atomically on TRANSFER commit before HomeRepository settles source colony', async () => {
    const { homeRepo, antiCheat, homeService, reservations, reconciliation, tickets } = await createLobbyTransferHarness();
    const planetA = CANONICAL_PLANETS.desert.id;
    const planetB = CANONICAL_PLANETS.temperate.id;
    const playerId = newId('pr');
    const { colony: colA, planet: recA } = await homeRepo.createColony({
      id: newId('co'), playerId, planetId: planetA, colonyIndex: 1,
      name: 'OriginColony', status: 'ACTIVE', foundingSectorId: 'sec_0_0', spawnQ: 0, spawnR: 0,
    });
    antiCheat.recordColonyBase(colA, recA, true);

    const tk = await tickets.enqueueTicket(playerId, {
      mode: 'TRANSFER', planetId: planetB, sectorId: 'sec_1_0', sourcePlanetId: planetA, sourceColonyId: colA.id,
    });
    const held = await reservations.reserveSlotForTicket(tk.id);
    if (!held.ok) throw new Error('expected held transfer reservation');
    const committed = await reservations.commitReservation(held.reservation.reservationId);

    expect(antiCheat.index.getColonyById(colA.id)?.status).toBe('ENDED');
    expect(await antiCheat.verifyJoin({ transport: 'http', playerId, targetPlanetId: planetA, allowNewJoin: false })).toMatchObject({
      ok: false, reason: 'not_your_planet', expectedPlanetId: planetB,
    });
    expect(antiCheat.validateCommand({ transport: 'ws', playerId, planetId: planetA, sectorId: 'sec_0_0', colony: colA, kind: 'landPod', args: {} })).toMatchObject({
      ok: false, rejectCode: 'not_own_colony', errorCode: 'WRONG_PLANET',
    });

    const getHomeSpy = vi.fn();
    const wsJoin = await verifyConnectionJoin({
      homeProvider: { getHome: getHomeSpy }, antiCheat, log: { warn: vi.fn(), debug: vi.fn() } as never,
      playerId, planetId: planetB, requestedSectorId: 'sec_1_0', dev: false, isScenarioPlanet: false,
    });
    expect(wsJoin).toMatchObject({ ok: true, colonyId: committed.colonyId, sectorId: 'sec_1_0' });
    expect(getHomeSpy).not.toHaveBeenCalled();

    const ingress = new SimCommandIngress({
      planets: { submit: async () => ({ ok: true as const, commandId: 'cm_b', appliedAtTick: 5 }), isScenarioColonyPlanet: () => false } as never,
      flags: new FlagsService({ TA_WAVES: 'all' } as never),
      registry: new Registry(),
      production: false,
      homeRepo,
      antiCheat,
    });
    let ackB: { t: string } | undefined;
    await ingress.handle(
      { transport: 'http', playerId, planetId: planetB, sectorId: 'sec_1_0', bindingHash: wsJoin.ok ? wsJoin.bindingHash : undefined, reply: (m) => { ackB = m as never; } },
      { v: 1, t: 'cmd', id: 'cm_b', d: { kind: 'landPod', args: {} } },
    );
    expect(ackB?.t).toBe('cmd.ack');

    await reconciliation.settleColony(colA.id, { planetId: planetA });
    expect(await homeService.resolveHome({ id: playerId, handle: 'TransferPilot' })).toMatchObject({
      state: 'ACTIVE', colony: { id: committed.colonyId, planetId: planetB, foundingSectorId: 'sec_1_0' },
    });
  });
});

describe('AntiCheat Review — cold BountyController, Deed, DirectorKey, Trade & MCP JSON-RPC', () => {
  it('hydrates unindexed caller/poster on BountyController and scopes NearDeedController.settleDeed', async () => {
    const flags = new FlagsService({ TA_WAVES: 'all' } as never);
    const antiCheat = new SectorAntiCheatService();
    const state = createAtlasPlanetState({ planetType: 'desert', seed: 'cold-bounty-seed', sectorRadius: 24, gridRadius: 96, skipPerfCaps: true });
    antiCheat.syncFromPlanetState('pl_cold', state);

    const alphaDevId = devPlayerId('cold_alpha');
    const prisma = {
      colony: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === 'co_sec1'
            ? { id: 'co_sec1', playerId: alphaDevId, planetId: 'pl_cold', colonyIndex: 1, foundingSectorId: 'sec_1_0', status: 'ACTIVE' }
            : { id: 'co_sec0', playerId: 'pr_sec0', planetId: 'pl_cold', colonyIndex: 0, foundingSectorId: 'sec_0_0', status: 'ACTIVE' },
        ),
      },
      nearColonyAccount: { findFirst: vi.fn(async () => ({ accountId: 'sec1.pilot.terraagent.mock', playerId: alphaDevId })) },
      chainBounty: {
        findUnique: vi.fn(async () => ({
          planetId: 'pl_cold', posterColonyId: 'co_sec0', colonyIndex: 0, target: { kind: 'clear_nest', nestId: 'nest_unindexed' },
        })),
      },
    } as unknown as PrismaClient;

    const bountyCtrl = new BountyController(
      { post: vi.fn(), list: vi.fn() } as never, { claim: vi.fn() } as never,
      flags, prisma, undefined, { NODE_ENV: 'test' } as never, antiCheat,
    );
    const reqAlpha = { headers: { authorization: 'Bearer dev:cold_alpha' } } as unknown as IncomingMessage;

    await expect(bountyCtrl.claim('pl_cold', 'bt_01JCOLDULID0001', { colonyId: 'co_sec1', colonyIndex: 1 }, reqAlpha)).rejects.toMatchObject({
      errorCode: 'CROSS_SECTOR_DISABLED', status: 403,
    });
    await expect(bountyCtrl.claim('pl_cold', 'bt_01JCOLDULID0001', { colonyId: 'co_sec1', colonyIndex: 1, sectorId: 'NOT_A_SECTOR' }, reqAlpha)).rejects.toMatchObject({
      errorCode: 'INVALID_SECTOR', status: 400,
    });

    const listSpy = vi.fn(async ({ playerId }: { playerId?: string }) =>
      playerId === alphaDevId ? [{ colonyId: 'co_sec1', planetId: 'pl_cold', playerId: alphaDevId }] : [{ colonyId: 'co_other', planetId: 'pl_cold', playerId: 'pr_other' }],
    );
    const deedCtrl = new NearDeedController(
      flags,
      { listForPlayerOrColony: listSpy, findByColonyId: vi.fn(), listAll: vi.fn(async () => []), toDeedView: vi.fn(async (r) => r) } as never,
      {} as never, {} as never, { settleColonyDeed: vi.fn(async () => undefined) } as never, {} as never,
      undefined, undefined, undefined, undefined, { NODE_ENV: 'test' } as never, antiCheat,
    );
    await deedCtrl.settleDeed({ planetId: 'pl_cold' }, reqAlpha);
    expect(listSpy).toHaveBeenCalledWith({ playerId: alphaDevId, planetId: 'pl_cold' });
  });

  it('guards DirectorKey.add, preserves Trade HTTP status, and blocks MCP JSON-RPC on ended planets', async () => {
    const flags = new FlagsService({ TA_WAVES: 'all' } as never);
    const antiCheat = new SectorAntiCheatService();
    const alphaDevId = devPlayerId('cold_alpha');
    const reqAlpha = { headers: { authorization: 'Bearer dev:cold_alpha' } } as unknown as IncomingMessage;
    antiCheat.index.upsertColonyBase({
      playerId: alphaDevId, colonyId: 'co_sec1', planetId: 'pl_cold', colonyIndex: 1,
      foundingSectorId: 'sec_1_0', spawnQ: 49, spawnR: -24, status: 'ELIMINATED', authoritativeStatus: true,
    });

    const revokeKey = vi.fn(async () => ({}));
    const directorKeys = new DirectorKeyService(
      flags,
      { addLimitedKey: vi.fn(), revokeKey, keyStatus: vi.fn(async () => ({ publicKey: 'ed25519:111', allowance: '0', spent: '0', tokens: [], revoked: true })) } as never,
      {
        requireOwner: vi.fn(async () => ({ colonyId: 'co_sec1', planetId: 'pl_cold', playerId: alphaDevId, colonyIndex: 1 })),
        find: vi.fn(async () => ({ colonyId: 'co_sec1', accountId: 'sec1.mock', publicKey: 'ed25519:111', revokedAt: null })),
        save: vi.fn(async () => undefined),
      } as never,
      { emit: vi.fn() } as never,
      undefined, undefined, { NODE_ENV: 'test' } as never, antiCheat,
    );
    await expect(directorKeys.add(reqAlpha, { colonyId: 'co_sec1' })).rejects.toMatchObject({
      errorCode: 'COLONY_INACTIVE', status: 409,
    });
    await directorKeys.remove(reqAlpha, { colonyId: 'co_sec1' });
    expect(revokeKey).toHaveBeenCalledTimes(1);

    antiCheat.recordPlanetStatus('pl_cold', 'ENDED');
    const tradeOrders = new TradeOrdersService(
      {} as never, {} as never, {} as never, {} as never, {} as never, flags, { NODE_ENV: 'test' } as never, antiCheat,
    );
    const principal = {
      ownerId: alphaDevId, ownerRef: `player:${alphaDevId}`, actorKind: 'player' as const,
      scopes: ['read', 'trade', 'manage'] as const,
      colonyFor: vi.fn(async () => ({ colonyId: 'co_sec1', colonyIndex: 1, accountId: 'sec1.mock' })),
    };
    expect(() =>
      tradeOrders.assertTradeCommandAllowed(principal as never, 'pl_cold', { colonyId: 'co_sec1', colonyIndex: 1, accountId: 'sec1.mock' }, 'market.cancelOrder', { orderId: 'ord_1' }),
    ).toThrow(expect.objectContaining({ code: 'planet_ended', status: 409 } satisfies Partial<TradeError>));

    const mcp = new McpService({ authenticate: vi.fn(async () => principal) } as never, {} as never, {} as never, tradeOrders, undefined);
    const rpcRes = await mcp.handleJsonRpc(reqAlpha, {
      jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: { name: 'place_order', arguments: { planetId: 'pl_cold', side: 'sell', resource: 'metals.t1', amount: 10, price: { token: 'USDC', amount: '1000000' } } },
    });
    expect(rpcRes).toMatchObject({ jsonrpc: '2.0', id: 7, error: { code: -32000, message: expect.stringContaining('pl_cold has ended') } });
  });
});

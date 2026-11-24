import 'reflect-metadata';
import { CANONICAL_PLANETS, MANAGED_AI_MODEL, newId } from '@terra/contracts';
import { Registry } from 'prom-client';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { ColonyAgentLoopService } from '../../src/ai/colony-agent/colony-agent-loop.service';
import { SectorAntiCheatService } from '../../src/core/anticheat';
import { ColonySlotAllowanceService } from '../../src/core/home/colony-slot-allowance.service';
import { HomeRepository } from '../../src/core/home/home.repository';
import { HomeService } from '../../src/core/home/home.service';
import { FlagsService } from '../../src/flags/flags.service';
import type { GamePlanets } from '../../src/game/game-planets.service';
import {
  LobbyPersistenceService,
  MatchmakerService,
  MatchTicketsService,
  SectorReservationService,
  SpawnSagaService,
  WorldLifecycleService,
} from '../../src/lobby';
import type { LlmProviderPort, LlmRequest, LlmResponse } from '../../src/ports/llm-provider.port';
import { ColonyHistoryStore } from '../../src/profile/colony-history.store';
import { MeAchievementsService } from '../../src/profile/me-achievements.service';
import { MeProfileService } from '../../src/profile/me-profile.service';
import { PlayerAiSettingsStore } from '../../src/profile/player-ai-settings.store';
import { FactsStore } from '../../src/progression/facts.store';
import { XpStore } from '../../src/progression/xp.store';
import { verifyConnectionJoin } from '../../src/ws/parts/connection-helpers';
import { SimCommandIngress } from '../../src/ws/sim-command-ingress';
import { readStakeClock } from '../../src/near/staking/perks/stake-clock.reader';
import { extractSectorSyncPayload } from '../../src/game/persistence/sector-extract';
import { createAtlasPlanetState, spawnColonyLanding } from '@terra/sim';
import { createFakePlanetHarness } from '../ai/fake-planet-harness';

async function createMultiColonyLobbyStack() {
  const persistence = new LobbyPersistenceService();
  await persistence.provisionAllCanonicalWorlds({
    foundingSeatsPerSector: 4,
    validatedSeatsPerSector: 4,
  });
  const lifecycle = new WorldLifecycleService(persistence);
  const homeRepo = new HomeRepository();
  const slotAllowance = new ColonySlotAllowanceService();
  const antiCheat = new SectorAntiCheatService(homeRepo, undefined, slotAllowance);
  antiCheat.setLobbyPersistence(persistence);
  const home = new HomeService(homeRepo, undefined, persistence, lifecycle, antiCheat, slotAllowance);
  const reservations = new SectorReservationService(persistence, lifecycle, undefined, antiCheat, slotAllowance);
  const tickets = new MatchTicketsService(persistence, lifecycle, homeRepo, home, antiCheat, slotAllowance);
  const matchmaker = new MatchmakerService(persistence, reservations, lifecycle);
  const saga = new SpawnSagaService(persistence, reservations, homeRepo, lifecycle);
  return { persistence, lifecycle, homeRepo, slotAllowance, antiCheat, home, reservations, tickets, matchmaker, saga };
}

describe('Multi-colony staking & NEAR.AI colony slots — server validation', () => {
  it('blocks non-stakers (0 NEAR) and Tier 1 (10 NEAR, 1 slot) from founding a second colony across tickets, home & reservations', async () => {
    const { home, tickets, matchmaker, saga, reservations, slotAllowance } = await createMultiColonyLobbyStack();
    const player = { id: newId('pr'), handle: 'CadetOne' };

    const t1 = await tickets.enqueueTicket(player.id, { mode: 'JOIN_PLANET', planetType: 'desert', sectorId: 'sec_0_0' });
    const p1 = await matchmaker.processTicket(t1.id);
    expect(p1.reserved).toBe(true);
    const s1 = await saga.executeSpawnForTicket(t1.id);
    expect(s1.ok).toBe(true);

    // 0 NEAR: rejected on tickets (409 already_has_colony + reason=staking_required) and home?new=1 (403 STAKING_REQUIRED)
    await expect(
      tickets.enqueueTicket(player.id, { mode: 'JOIN_PLANET', planetType: 'ocean', autoSector: true }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'already_has_colony',
      details: { reason: 'staking_required' },
    });
    await expect(
      home.resolveHome(player, { newColony: true, preferredType: 'ocean' }),
    ).rejects.toMatchObject({ status: 403, errorCode: 'STAKING_REQUIRED' });

    // 10 NEAR (Tier 1 -> 1 NEAR.AI slot): still capped at 1 active colony (409 AI_SLOT_LIMIT / already_has_colony)
    slotAllowance.setTestStakedNear(player.id, 10);
    await expect(
      tickets.enqueueTicket(player.id, { mode: 'JOIN_PLANET', planetType: 'ocean', autoSector: true }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'already_has_colony',
      details: { reason: 'ai_slot_limit' },
    });
    await expect(
      home.resolveHome(player, { newColony: true, preferredType: 'ocean' }),
    ).rejects.toMatchObject({ status: 409, errorCode: 'AI_SLOT_LIMIT' });

    // Direct reservation attempt also blocked
    const resAttempt = await reservations.reserveSectorSlot({
      planetId: CANONICAL_PLANETS.ocean.id,
      sectorId: 'sec_0_0',
      ticketId: newId('mt'),
      playerId: player.id,
      colonyId: newId('co'),
    });
    expect(resAttempt.ok).toBe(false);
    if (!resAttempt.ok) expect(resAttempt.code).toBe('ticket_not_reservable');
  });
});

describe('Multi-colony Tier 2+ staker slot allowance & same-sector prohibition', () => {
  it('allows Tier 2 stakers (50 NEAR, 3 slots) to found colonies in distinct sectors on the same planet and across planets, while blocking same-sector founding', async () => {
    const { home, tickets, matchmaker, saga, slotAllowance } = await createMultiColonyLobbyStack();
    const staker = { id: newId('pr'), handle: 'CommanderVega' };
    slotAllowance.setTestStakedNear(staker.id, 50);

    // Colony 1: Desert sec_0_0
    const tk1 = await tickets.enqueueTicket(staker.id, { mode: 'JOIN_PLANET', planetType: 'desert', sectorId: 'sec_0_0' });
    await matchmaker.processTicket(tk1.id);
    const sp1 = await saga.executeSpawnForTicket(tk1.id);
    expect(sp1.ok).toBe(true);

    // Same-sector attempt (Desert sec_0_0 again) MUST fail on both tickets and home?new=1
    await expect(
      tickets.enqueueTicket(staker.id, { mode: 'JOIN_PLANET', planetType: 'desert', sectorId: 'sec_0_0' }),
    ).rejects.toMatchObject({ status: 409, code: 'sector_already_colonized' });
    await expect(
      home.resolveHome(staker, { newColony: true, planetId: CANONICAL_PLANETS.desert.id, sectorId: 'sec_0_0' }),
    ).rejects.toMatchObject({ status: 409, errorCode: 'SECTOR_ALREADY_COLONIZED' });

    // Colony 2: Same planet (Desert) via AUTO sector -> automatically skips sec_0_0 and assigns distinct colonyIndex!
    const tk2 = await tickets.enqueueTicket(staker.id, { mode: 'JOIN_PLANET', planetType: 'desert', autoSector: true });
    const pr2 = await matchmaker.processTicket(tk2.id);
    expect(pr2.reserved).toBe(true);
    expect(pr2.ticket.reservedSectorId).not.toBe('sec_0_0');
    const sp2 = await saga.executeSpawnForTicket(tk2.id);
    expect(sp2.ok).toBe(true);
    expect(sp2.colony?.colonyIndex).not.toBe(sp1.colony?.colonyIndex);

    // Colony 3: Different planet (Ocean sec_0_0)
    const tk3 = await tickets.enqueueTicket(staker.id, { mode: 'JOIN_PLANET', planetType: 'ocean', sectorId: 'sec_0_0' });
    await matchmaker.processTicket(tk3.id);
    const sp3 = await saga.executeSpawnForTicket(tk3.id);
    expect(sp3.ok).toBe(true);

    const resolved = await home.resolveHome(staker);
    expect(resolved.colonySlots).toMatchObject({ used: 3, max: 3, aiColonySlots: 3, tier: 2, isStaker: true });
    expect(resolved.activeColonies).toHaveLength(3);

    // 4th colony blocked at Tier 2 (3/3), then unlocked after staking to Tier 3 (200 NEAR -> 6 slots)
    await expect(
      tickets.enqueueTicket(staker.id, { mode: 'JOIN_PLANET', planetType: 'temperate', autoSector: true }),
    ).rejects.toMatchObject({ status: 409, code: 'already_has_colony', details: { reason: 'ai_slot_limit' } });

    slotAllowance.setTestStakedNear(staker.id, 200);
    const tk4 = await tickets.enqueueTicket(staker.id, { mode: 'JOIN_PLANET', planetType: 'temperate', sectorId: 'sec_0_0' });
    expect(tk4.planetType).toBe('temperate');
  });

  it('excludes HomeRepository colonies on AUTO/alternative sector placement and blocks spawn if unstaked in queue', async () => {
    const { homeRepo, tickets, matchmaker, saga, reservations, slotAllowance } = await createMultiColonyLobbyStack();
    const desertId = CANONICAL_PLANETS.desert.id;
    const player = newId('pr');
    slotAllowance.setTestStakedNear(player, 50);

    // Colony 1 created directly in HomeRepository (no SectorReservation row)
    await homeRepo.upsertDevPlanet(desertId, { radius: 96, capacity: 12 });
    await homeRepo.createColony({
      id: newId('co'), playerId: player, planetId: desertId, colonyIndex: 0,
      name: 'DirectBase', color: 0, status: 'ACTIVE', foundingSectorId: 'sec_0_0', spawnQ: 0, spawnR: 0,
    });

    // acceptAlternativeSector to already-occupied HomeRepository sector is rejected (409 sector_already_colonized)
    const tkAlt = await tickets.enqueueTicket(player, { mode: 'JOIN_PLANET', planetType: 'desert', sectorId: 'sec_1_0' });
    await expect(
      matchmaker.acceptAlternativeSector({ ticketId: tkAlt.id, playerId: player, sectorId: 'sec_0_0', processImmediately: false }),
    ).rejects.toMatchObject({ status: 409, code: 'sector_already_colonized' });

    // Unstaking to 0 NEAR while reservation is HELD causes SpawnSagaService to fail & release the HELD slot cleanly
    const heldRes = await matchmaker.processTicket(tkAlt.id);
    expect(heldRes.reserved).toBe(true);
    expect(heldRes.ticket.reservedSectorId).toBe('sec_1_0');
    slotAllowance.setTestStakedNear(player, 0);
    const abortedSpawn = await saga.executeSpawnForTicket(tkAlt.id);
    expect(abortedSpawn.ok).toBe(false);
    expect(abortedSpawn.ticketFailed).toBe(true);
    expect((await reservations.getReservationByTicketId(tkAlt.id))?.state).toBe('EXPIRED');

    // Re-stake 50 NEAR, enqueue AUTO sector on Desert -> Matchmaker skips sec_0_0 (occupied in HomeRepository)
    slotAllowance.setTestStakedNear(player, 50);
    const tkAuto = await tickets.enqueueTicket(player, { mode: 'JOIN_PLANET', planetType: 'desert', autoSector: true });
    const autoRes = await matchmaker.processTicket(tkAuto.id);
    expect(autoRes.reserved).toBe(true);
    expect(autoRes.ticket.reservedSectorId).not.toBe('sec_0_0');

    // Cancel tkAuto & unstake while a fresh ticket is still QUEUED -> Matchmaker refuses to reserve
    await reservations.releaseReservation(autoRes.reservation!.reservationId, 'RELEASED');
    await tickets.cancelTicket(tkAuto.id, player);
    const queuedTk = await tickets.enqueueTicket(player, { mode: 'JOIN_PLANET', planetType: 'ocean', sectorId: 'sec_0_0' });
    slotAllowance.setTestStakedNear(player, 0);
    const blockedMatch = await matchmaker.processTicket(queuedTk.id);
    expect(blockedMatch.reserved).toBe(false);
    expect(blockedMatch.reason).toBe('ticket_not_reservable');
  });
});

describe('Multi-colony WS join & SimCommandIngress routing on the same planet', () => {
  it('routes WS join and SimCommandIngress to the exact colony when a staker owns 2 colonies on the same planet', async () => {
    const { home, homeRepo, antiCheat, tickets, matchmaker, saga, slotAllowance } = await createMultiColonyLobbyStack();
    const stakerId = newId('pr');
    slotAllowance.setTestStakedNear(stakerId, 50);

    const tkA = await tickets.enqueueTicket(stakerId, { mode: 'JOIN_PLANET', planetType: 'desert', sectorId: 'sec_0_0' });
    await matchmaker.processTicket(tkA.id);
    const spA = await saga.executeSpawnForTicket(tkA.id);

    const tkB = await tickets.enqueueTicket(stakerId, { mode: 'JOIN_PLANET', planetType: 'desert', sectorId: 'sec_1_0' });
    await matchmaker.processTicket(tkB.id);
    const spB = await saga.executeSpawnForTicket(tkB.id);

    const planetId = CANONICAL_PLANETS.desert.id;
    const homeProvider = { getHome: (pid: string, plId?: string) => home.resolveHome(pid, { planetId: plId }) };
    const log = pino({ level: 'silent' });

    const joinA = await verifyConnectionJoin({
      homeProvider, antiCheat, log, playerId: stakerId, planetId,
      requestedColonyId: spA.colonyId, dev: false, isScenarioPlanet: false,
    });
    const joinB = await verifyConnectionJoin({
      homeProvider, antiCheat, log, playerId: stakerId, planetId,
      requestedColonyId: spB.colonyId, dev: false, isScenarioPlanet: false,
    });
    expect(joinA).toMatchObject({ ok: true, colonyId: spA.colonyId, colonyIndex: spA.colony!.colonyIndex, sectorId: 'sec_0_0' });
    expect(joinB).toMatchObject({ ok: true, colonyId: spB.colonyId, colonyIndex: spB.colony!.colonyIndex, sectorId: 'sec_1_0' });

    const submittedIndices: Array<number | null> = [];
    const planetsStub = {
      isScenarioColonyPlanet: () => false,
      submit: async (_pid: string, cmd: { colonyIndex: number | null }) => {
        submittedIndices.push(cmd.colonyIndex);
        return { ok: true as const, appliedAtTick: 5 };
      },
    } as unknown as GamePlanets;
    const ingress = new SimCommandIngress({
      planets: planetsStub,
      flags: new FlagsService({ WAVES: 'all' } as never),
      registry: new Registry(),
      production: false,
      homeRepo,
      antiCheat,
    });

    const replies: object[] = [];
    if (joinA.ok && joinB.ok) {
      await ingress.handle(
        { playerId: stakerId, planetId, colonyId: joinA.colonyId ?? undefined, sectorId: joinA.sectorId, bindingHash: joinA.bindingHash, memo: {}, reply: (m) => replies.push(m) },
        { v: 1, t: 'cmd', id: newId('cm'), d: { kind: 'queueGoal', args: { goal: 'grow_economy' } } },
      );
      await ingress.handle(
        { playerId: stakerId, planetId, colonyId: joinB.colonyId ?? undefined, sectorId: joinB.sectorId, bindingHash: joinB.bindingHash, memo: {}, reply: (m) => replies.push(m) },
        { v: 1, t: 'cmd', id: newId('cm'), d: { kind: 'queueGoal', args: { goal: 'grow_economy' } } },
      );
    }
    expect(submittedIndices).toEqual([spA.colony!.colonyIndex, spB.colony!.colonyIndex]);
    expect(replies).toHaveLength(2);
  });
});

describe('NEAR.AI settings lock & exclusive z-ai/glm-5.3-flash managed model', () => {
  it('enforces BYOK API key lock on settings and runs staker enclave probes on z-ai/glm-5.3-flash', async () => {
    const flags = new FlagsService({ WAVES: 'all' } as never);
    const facts = new FactsStore();
    const xp = new XpStore();
    const achievements = new MeAchievementsService(facts, undefined as never, undefined as never, flags);
    const colonies = new ColonyHistoryStore();
    const slotSvc = new ColonySlotAllowanceService();
    const pingLlm: LlmProviderPort = {
      complete: async (req: LlmRequest): Promise<LlmResponse> => ({
        text: '{"ok":true}',
        usage: { inputTokens: 2, outputTokens: 2 },
        model: req.model ?? MANAGED_AI_MODEL,
      }),
    };
    const profileSvc = new MeProfileService(
      facts, xp, achievements, colonies, flags, undefined, undefined, undefined,
      undefined, pingLlm, { NODE_ENV: 'test', NEAR_AI_MODEL: 'deepseek/deepseek-v3.2' } as never, slotSvc,
    );
    const player = { id: 'pr_ai_lock_test', handle: 'PilotAi', isGuest: false };

    await expect(
      profileSvc.updateAiSettings(player, { model: 'deepseek/deepseek-v3.2' }),
    ).rejects.toMatchObject({ errorCode: 'invalid_ai_settings', status: 400 });
    await expect(
      profileSvc.updateAiSettings(player, { model: 'deepseek/deepseek-v3.2', apiKey: 'short' }),
    ).rejects.toMatchObject({ errorCode: 'invalid_ai_settings', status: 400 });
    await expect(
      profileSvc.updateAiSettings(player, { model: 'deepseek/deepseek-v3.2', apiKey: 'bad key 12345' }),
    ).rejects.toMatchObject({ errorCode: 'invalid_ai_settings', status: 400 });

    const saved = await profileSvc.updateAiSettings(player, {
      model: 'deepseek/deepseek-v3.2',
      apiKey: 'sk-valid-near-ai-key-99',
    });
    expect(saved.hasApiKey).toBe(true);
    expect(saved.model).toBe('deepseek/deepseek-v3.2');

    slotSvc.setTestStakedNear(player.id, 50);
    await profileSvc.updateAiSettings(player, { model: MANAGED_AI_MODEL, apiKey: null });
    const probe = await profileSvc.verifyAiEnclave(player.id);
    expect(probe.ok).toBe(true);
    expect(probe.managedStaker).toBe(true);
    expect(probe.model).toBe(MANAGED_AI_MODEL);
  });

  it('forces z-ai/glm-5.3-flash for managed staker colony turns even when NEAR_AI_MODEL env is overridden', async () => {
    const { host, planets } = createFakePlanetHarness();
    host.state.colonies[0]!.aiEnabled = true;
    const aiStore = new PlayerAiSettingsStore();
    aiStore.bindColonyPlayer('pl_loop', 0, 'pr_staker_1');

    const seenRequests: LlmRequest[] = [];
    const llm: LlmProviderPort = {
      complete: async (req: LlmRequest): Promise<LlmResponse> => {
        seenRequests.push(req);
        const body = JSON.parse(req.messages[0]?.content ?? '{}') as { colonies?: Array<{ colonyIndex: number }> };
        const indices = body.colonies?.map((c) => c.colonyIndex) ?? [0];
        return {
          text: JSON.stringify({
            directives: indices.map((colonyIndex) => ({
              colonyIndex,
              action: 'queue_goal',
              goal: 'grow_economy',
              rationale: 'Managed staker turn.',
            })),
          }),
          usage: { inputTokens: 10, outputTokens: 5 },
          model: req.model ?? MANAGED_AI_MODEL,
        };
      },
    };
    const loop = new ColonyAgentLoopService(
      planets,
      llm,
      undefined,
      undefined,
      { NEAR_AI_MODEL: 'deepseek/deepseek-v3.2' } as never,
      aiStore,
    );
    const evals = await loop.tickPlanetAgents('pl_loop', { stakedByColony: { 0: true } });
    const stakerEval = evals.find((e) => e.colonyIndex === 0);
    expect(stakerEval?.governed).toBe(true);
    expect(stakerEval?.usedPlayerKey).toBe(false);
    expect(stakerEval?.model).toBe(MANAGED_AI_MODEL);
    const stakerRequest = seenRequests.find((r) => {
      const parsed = JSON.parse(r.messages[0]?.content ?? '{}') as { colonies?: Array<{ colonyIndex: number }> };
      return parsed.colonies?.some((c) => c.colonyIndex === 0);
    });
    expect(stakerRequest?.model).toBe(MANAGED_AI_MODEL);

    const bareLoop = new ColonyAgentLoopService(planets, llm, undefined, undefined, { NEAR_AI_MODEL: 'deepseek/deepseek-v3.2' } as never);
    const bareEvals = await bareLoop.tickPlanetAgents('pl_loop');
    expect(bareEvals.find((e) => e.colonyIndex === 0)?.model).toBe(MANAGED_AI_MODEL);
  });
});

describe('Multi-colony regressions — stake deduplication', () => {
  it('deduplicates staking_position rows across multiple colonies for the same (accountId, poolId)', async () => {
    const fiftyNearYocto = 50n * 10n ** 24n;
    const dec = (v: bigint) => ({ toFixed: () => v.toString() });
    const now = new Date('2026-11-20T00:00:00.000Z');
    const dbStub = {
      stakingPosition: {
        findMany: async () => [
          { colonyId: 'vega.near', poolId: 'pool.near', accountId: 'vega.near', stakedSnapshot: dec(fiftyNearYocto), unbondingSnapshot: null, stakedSinceAt: now, lastStakedAt: now, updatedAt: now },
          { colonyId: 'co_1', poolId: 'pool.near', accountId: 'vega.near', stakedSnapshot: dec(fiftyNearYocto), unbondingSnapshot: null, stakedSinceAt: now, lastStakedAt: now, updatedAt: now },
          { colonyId: 'co_2', poolId: 'pool.near', accountId: 'vega.near', stakedSnapshot: dec(fiftyNearYocto), unbondingSnapshot: null, stakedSinceAt: now, lastStakedAt: now, updatedAt: now },
        ],
      },
      socialIdentity: {
        findFirst: async () => ({ accountId: 'vega.near', provider: 'near' }),
      },
      colony: {
        findMany: async () => [{ id: 'co_1' }, { id: 'co_2' }],
      },
    };
    const clock = await readStakeClock(dbStub as never, {
      walletKey: 'vega.near',
      accountIds: ['vega.near'],
      colonyIds: ['co_1', 'co_2'],
      playerId: 'pr_vega',
    });
    expect(clock.activeStakedYocto).toBe(fiftyNearYocto);

    const allowanceSvc = new ColonySlotAllowanceService(dbStub as never, { DATABASE_URL: 'postgresql://stub' } as never);
    const allowance = await allowanceSvc.resolveForPlayer('pr_vega', 2);
    expect(allowance).toMatchObject({
      used: 2,
      max: 3,
      aiColonySlots: 3,
      tier: 2,
      tierName: 'Commander',
      isStaker: true,
    });
  });
});

describe('Multi-colony regressions — concurrent index safety, sector telemetry & WS terminal sibling', () => {
  it('allocates distinct colonyIndex on concurrent same-planet spawns, preserves canonical foundingSectorId, and admits active colony when a sibling is eliminated', async () => {
    const { home, homeRepo, antiCheat, tickets, matchmaker, saga, slotAllowance } = await createMultiColonyLobbyStack();
    const stakerId = newId('pr');
    slotAllowance.setTestStakedNear(stakerId, 50);

    const tk1 = await tickets.enqueueTicket(stakerId, { mode: 'JOIN_PLANET', planetType: 'desert', sectorId: 'sec_0_0' });
    await matchmaker.processTicket(tk1.id);
    const tk2 = await tickets.enqueueTicket(newId('pr'), { mode: 'JOIN_PLANET', planetType: 'desert', sectorId: 'sec_1_0' });
    await matchmaker.processTicket(tk2.id);

    const [sp1, sp2] = await Promise.all([
      saga.executeSpawnForTicket(tk1.id, {
        executor: async () => {
          await new Promise((r) => setTimeout(r, 15));
          return { ok: true, appliedAtTick: 1 };
        },
      }),
      saga.executeSpawnForTicket(tk2.id, {
        executor: async () => {
          await new Promise((r) => setTimeout(r, 15));
          return { ok: true, appliedAtTick: 1 };
        },
      }),
    ]);
    expect(sp1.ok).toBe(true);
    expect(sp2.ok).toBe(true);
    expect(sp1.colony?.colonyIndex).not.toBe(sp2.colony?.colonyIndex);

    // Sim spawnColonyLanding stamps foundingSectorId so radius-24 canonical worlds report distinct sector participants
    const simState = createAtlasPlanetState({
      planetId: CANONICAL_PLANETS.desert.id,
      planetType: 'desert',
      seed: 'kharon-01',
      radius: 24,
    });
    expect(spawnColonyLanding(simState, { colonyId: 0, colonyIdStr: 'co_s0', playerId: stakerId, sectorId: 'sec_0_0', landingSlotId: 'slot_sec_0_0_0', q: 0, r: 0 }).ok).toBe(true);
    expect(spawnColonyLanding(simState, { colonyId: 1, colonyIdStr: 'co_s1', playerId: stakerId, sectorId: 'sec_1_0', landingSlotId: 'slot_sec_1_0_0', q: 8, r: -8 }).ok).toBe(true);
    const syncPayload = extractSectorSyncPayload(CANONICAL_PLANETS.desert.id, simState, new Map());
    expect(syncPayload.participants.find((p) => p.colonyId === 'co_s0')?.sectorId).toBe('sec_0_0');
    expect(syncPayload.participants.find((p) => p.colonyId === 'co_s1')?.sectorId).toBe('sec_1_0');

    // Sibling colony eliminated in live antiCheat index does NOT block hydrating & joining active colony on same planet
    const tkElim = await tickets.enqueueTicket(stakerId, { mode: 'JOIN_PLANET', planetType: 'desert', sectorId: 'sec_0_1' });
    await matchmaker.processTicket(tkElim.id);
    const spElim = await saga.executeSpawnForTicket(tkElim.id);
    antiCheat.recordColonyRemoved(sp1.colonyId!);
    antiCheat.index.upsertColonyBase({
      playerId: stakerId,
      colonyId: spElim.colonyId!,
      planetId: CANONICAL_PLANETS.desert.id,
      colonyIndex: spElim.colony!.colonyIndex,
      foundingSectorId: 'sec_0_1',
      spawnQ: 0,
      spawnR: 0,
      status: 'ELIMINATED',
      authoritativeStatus: true,
    });
    await homeRepo.setColonyStatus(spElim.colonyId!, 'ELIMINATED');

    const joinActiveSibling = await verifyConnectionJoin({
      homeProvider: { getHome: (pid, plId) => home.resolveHome(pid, { planetId: plId }) },
      antiCheat,
      log: pino({ level: 'silent' }),
      playerId: stakerId,
      planetId: CANONICAL_PLANETS.desert.id,
      requestedColonyId: sp1.colonyId,
      dev: false,
      isScenarioPlanet: false,
    });
    expect(joinActiveSibling).toMatchObject({ ok: true, colonyId: sp1.colonyId, sectorId: 'sec_0_0' });
  });
});

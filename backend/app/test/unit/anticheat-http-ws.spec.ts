import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { AuthResponseSchema, decodeWire, HomeResponseSchema, newId, Welcome } from '@terra/contracts';
import { createAtlasPlanetState, getAtlasBlob, snapshot } from '@terra/sim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../../src/app';
import { SectorAntiCheatService } from '../../src/core/anticheat';
import { createSpawnColonyCommand, HomeRepository } from '../../src/core/home';
import { MetricsRegistry } from '../../src/core/metrics.registry';
import { devPlanetIds } from '../../src/game/dev-planets';
import { GamePlanets } from '../../src/game/game-planets.service';
import { HOME_PROVIDER, type HomeProvider } from '../../src/ws/home-provider';
import { UNIT_APP_ENV } from '../unit-app-env';

let activeApp: INestApplication | undefined;
const openSockets: WebSocket[] = [];

class WsClient {
  readonly frames: { t: string; d: Record<string, unknown> }[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  private waiters: (() => void)[] = [];

  constructor(readonly ws: WebSocket) {
    openSockets.push(ws);
    ws.on('message', (data, isBinary) => {
      const buf = data as Buffer;
      const decoded = decodeWire(isBinary ? buf : buf.toString('utf8')) as { t: string; d: Record<string, unknown> };
      this.frames.push(decoded);
      this.waiters.splice(0).forEach((w) => w());
    });
    this.closed = new Promise((res) =>
      ws.on('close', (code, reason) => res({ code, reason: reason.toString() })),
    );
  }

  static async open(wsUrl: string): Promise<WsClient> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((res, rej) => {
      ws.once('open', () => res());
      ws.once('error', rej);
    });
    return new WsClient(ws);
  }

  send(msg: object): void {
    this.ws.send(JSON.stringify({ v: 1, ...msg }));
  }

  hello(accessToken: string): void {
    this.send({ t: 'hello', d: { accessToken, proto: [1], client: { app: 'game', version: '0.1.0' } } });
  }

  async nextAny(ts: readonly string[]): Promise<{ t: string; d: Record<string, unknown> }> {
    for (;;) {
      const idx = this.frames.findIndex((f) => ts.includes(f.t));
      if (idx >= 0) return this.frames.splice(idx, 1)[0]!;
      await new Promise<void>((r) => {
        this.waiters.push(r);
      });
    }
  }

  next(t: string): Promise<{ t: string; d: Record<string, unknown> }> {
    return this.nextAny([t]);
  }
}

async function bootServer() {
  const created = await createApp({
    source: {
      ...UNIT_APP_ENV,
      NODE_ENV: 'test',
      SIM_THREADS: '1',
      GAME_DEV_PLANETS: '1',
      JWT_ACCESS_SECRET: 'test-anticheat-jwt-secret-0123456789abcdef',
    },
  });
  await created.app.listen(0, '127.0.0.1');
  activeApp = created.app;
  const url = (await created.app.getUrl()).replace('[::1]', '127.0.0.1');
  const port = new URL(url).port;
  return { app: created.app, url, wsUrl: `ws://127.0.0.1:${port}/ws` };
}

async function registerGuest(url: string, secret: string, handle: string) {
  const res = await fetch(`${url}/v1/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceSecret: secret, handle }),
  });
  expect(res.status).toBe(200);
  return AuthResponseSchema.parse(await res.json());
}

async function sendHttpCmd(url: string, token: string, planetId: string, kind: string, args: unknown, extra: Record<string, unknown> = {}) {
  const res = await fetch(`${url}/v1/planets/${planetId}/commands`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ kind, args, ...extra }),
  });
  const json = (await res.json()) as { ok?: boolean; error?: { details?: { code?: string }; code?: string } };
  return { status: res.status, ok: res.status === 200 && json.ok === true, code: json.error?.details?.code ?? json.error?.code };
}

afterEach(async () => {
  for (const ws of openSockets.splice(0)) ws.terminate();
  await activeApp?.close();
  activeApp = undefined;
});

describe('HTTP & WebSocket join sector anti-cheat parity', () => {
  it('blocks joining full or ocean sectors and blocks joining any sector or planet different from base', async () => {
    const [planetB] = devPlanetIds(1, 1);
    const { app, url, wsUrl } = await bootServer();
    const antiCheat = app.get(SectorAntiCheatService);

    const alice = await registerGuest(url, 'anticheat-alice-secret-0001', 'Alice');
    const aliceHome = HomeResponseSchema.parse(
      await (await fetch(`${url}/v1/me/home`, { headers: { authorization: `Bearer ${alice.accessToken}` } })).json(),
    );
    if (aliceHome.state !== 'ACTIVE') throw new Error('expected ACTIVE');
    const planetA = aliceHome.planet.id;
    expect(planetA).not.toBe(planetB);

    for (const pid of [planetA, planetB!]) {
      antiCheat.syncSectorSpace({ planetId: pid, sectorId: 'sec_0_0', kind: 'land', capacity: 1, foundedSeats: 1, freeSeats: 0 });
      antiCheat.syncSectorSpace({ planetId: pid, sectorId: 'sec_2_0', kind: 'ocean', capacity: 0, freeSeats: 0 });
    }

    const bob = await registerGuest(url, 'anticheat-bob-secret-0002', 'Bob');
    const bobFullHttp = await fetch(`${url}/v1/me/home?sector=sec_0_0`, { headers: { authorization: `Bearer ${bob.accessToken}` } });
    expect(bobFullHttp.status).toBe(409);
    expect(await bobFullHttp.json()).toMatchObject({ errorCode: 'SECTOR_FULL', error: { code: 'sector_full' } });

    const bobOceanHttp = await fetch(`${url}/v1/me/home?sector=sec_2_0`, { headers: { authorization: `Bearer ${bob.accessToken}` } });
    expect(bobOceanHttp.status).toBe(400);

    const bobWsFull = await WsClient.open(wsUrl);
    bobWsFull.hello(bob.accessToken);
    await bobWsFull.next('ready');
    bobWsFull.send({ t: 'join', d: { planetId: planetA, sectorId: 'sec_0_0' } });
    expect((await bobWsFull.next('bye')).d).toEqual({ code: 4003, reason: 'sector_full' });

    expect((await fetch(`${url}/v1/me/home?sector=sec_0_0&planetId=${planetA}`, { headers: { authorization: `Bearer ${alice.accessToken}` } })).status).toBe(200);
    expect((await fetch(`${url}/v1/me/home?sector=sec_1_0`, { headers: { authorization: `Bearer ${alice.accessToken}` } })).status).toBe(409);
    expect((await fetch(`${url}/v1/me/home?planetId=${planetB}`, { headers: { authorization: `Bearer ${alice.accessToken}` } })).status).toBe(409);

    const aliceWrongPlanetWs = await WsClient.open(wsUrl);
    aliceWrongPlanetWs.hello(alice.accessToken);
    await aliceWrongPlanetWs.next('ready');
    aliceWrongPlanetWs.send({ t: 'join', d: { planetId: planetB } });
    expect((await aliceWrongPlanetWs.next('bye')).d).toEqual({ code: 4003, reason: 'not_your_planet' });

    const aliceWrongSecWs = await WsClient.open(wsUrl);
    aliceWrongSecWs.hello(alice.accessToken);
    await aliceWrongSecWs.next('ready');
    aliceWrongSecWs.send({ t: 'join', d: { planetId: planetA, sectorId: 'sec_1_0' } });
    expect((await aliceWrongSecWs.next('bye')).d).toEqual({ code: 4003, reason: 'not_your_sector' });
  });
});

async function bootLiveAtlasPlanet(app: INestApplication, alicePlayer: { id: string; handle: string }) {
  const planetId = 'pl_01JATLASPAR1TYTEST00000001';
  const gamePlanets = app.get(GamePlanets);
  const homeRepo = app.get(HomeRepository);
  const antiCheat = app.get(SectorAntiCheatService);
  const atlasState = createAtlasPlanetState({
    planetId,
    planetType: 'desert',
    seed: 'ws-http-parity',
    sectorRadius: 24,
    gridRadius: 96,
    skipPerfCaps: true,
  });
  const atlas = getAtlasBlob(atlasState)!;
  const slotHome = atlas.safeLandingSlots.find((s) => s.sectorId === 'sec_0_0')!;
  const slotForeign = atlas.safeLandingSlots.find((s) => s.sectorId !== 'sec_0_0')!;

  await gamePlanets.load(planetId, { snapshot: snapshot(atlasState) });
  const planetRec = await homeRepo.upsertDevPlanet(planetId, { radius: 96, capacity: 12 });
  const { colony: aliceCol } = await homeRepo.createColony({
    playerId: alicePlayer.id, planetId, colonyIndex: 0, name: 'AliceBase', color: 0, status: 'ACTIVE',
    foundingSectorId: slotHome.sectorId, landingSlotId: slotHome.slotId, spawnQ: slotHome.q, spawnR: slotHome.r,
  });
  const { colony: rivalCol } = await homeRepo.createColony({
    playerId: 'pr_rival_foreign', planetId, colonyIndex: 1, name: 'RivalBase', color: 1, status: 'ACTIVE',
    foundingSectorId: slotForeign.sectorId, landingSlotId: slotForeign.slotId, spawnQ: slotForeign.q, spawnR: slotForeign.r,
  });

  await gamePlanets.submit(planetId, createSpawnColonyCommand({
    player: alicePlayer, colony: aliceCol, planet: planetRec,
    slot: { index: slotHome.slotIndex, q: slotHome.q, r: slotHome.r, sectorId: slotHome.sectorId, landingSlotId: slotHome.slotId },
  }));
  await gamePlanets.submit(planetId, createSpawnColonyCommand({
    player: { id: 'pr_rival_foreign', handle: 'Rival' }, colony: rivalCol, planet: planetRec,
    slot: { index: slotForeign.slotIndex, q: slotForeign.q, r: slotForeign.r, sectorId: slotForeign.sectorId, landingSlotId: slotForeign.slotId },
  }));
  await gamePlanets.submit(planetId, { colonyIndex: 0, source: 'player', commandId: newId('cm'), kind: 'landPod', args: {} });
  await gamePlanets.submit(planetId, { colonyIndex: 1, source: 'player', commandId: newId('cm'), kind: 'landPod', args: {} });

  const full = await gamePlanets.fullState(planetId, 2000);
  antiCheat.syncFromSnapshotBytes(planetId, full.bytes);
  antiCheat.recordColonyBase(aliceCol, planetRec);
  antiCheat.recordColonyBase(rivalCol, planetRec);

  const entities = [...antiCheat.index.getPlanet(planetId)!.entitiesById.values()];
  const aliceEntityId = entities.find((e) => e.ownerColonyIndex === 0 && e.alive)!.entityId;
  const rivalEntityId = entities.find((e) => e.ownerColonyIndex === 1 && e.alive)!.entityId;
  return { planetId, aliceCol, rivalCol, slotHome, slotForeign, secForeign: slotForeign.sectorId, aliceEntityId, rivalEntityId };
}

describe('HTTP & WebSocket command anti-cheat parity', () => {
  it('enforces real-time planet & sector checks for base, terraform, units, attack & bounty over HTTP and WS', async () => {
    const [planetB] = devPlanetIds(1, 1);
    const { app, url, wsUrl } = await bootServer();
    const alice = await registerGuest(url, 'anticheat-cmd-alice-0001', 'CmdAlice');
    const seeded = await bootLiveAtlasPlanet(app, { id: alice.player.id, handle: 'CmdAlice' });
    const { planetId: planetA, aliceCol, rivalCol, slotHome, slotForeign, secForeign, aliceEntityId, rivalEntityId } = seeded;

    const wsClient = await WsClient.open(wsUrl);
    wsClient.hello(alice.accessToken);
    await wsClient.next('ready');
    wsClient.send({ t: 'join', d: { planetId: planetA, sectorId: 'sec_0_0' } });
    Welcome.parse(await wsClient.next('welcome'));

    expect(await sendHttpCmd(url, alice.accessToken, planetA, 'setRally', { q: slotHome.q, r: slotHome.r })).toMatchObject({ status: 200, ok: true });
    wsClient.send({ t: 'cmd', id: newId('cm'), d: { kind: 'setRally', args: { q: slotHome.q, r: slotHome.r } } });
    expect((await wsClient.nextAny(['cmd.ack', 'cmd.reject'])).t).toBe('cmd.ack');

    const fq = slotForeign.q;
    const fr = slotForeign.r;
    const cases: ReadonlyArray<[string, unknown, string]> = [
      ['placeBuilding', { building: 'commandHub', q: fq, r: fr }, 'cross_sector_disabled'],
      ['enqueueTask', { terraform: { op: 'grade', tiles: [{ q: fq, r: fr }] } }, 'cross_sector_disabled'],
      ['enqueueTask', { buildUnit: { unit: 'worker', producerId: rivalEntityId } }, 'not_own_colony'],
      ['setRally', { q: fq, r: fr }, 'cross_sector_disabled'],
      ['attackMove', { entityId: aliceEntityId, q: fq, r: fr }, 'cross_sector_disabled'],
      ['attackTarget', { entityId: aliceEntityId, targetId: rivalEntityId }, 'cross_sector_disabled'],
      ['raid', { targetColonyId: rivalCol.id, unitIds: [aliceEntityId] }, 'cross_sector_disabled'],
      ['cargo.export', { colonyId: rivalCol.id, resource: 'metals.t1', amount: 5 }, 'not_own_colony'],
    ];

    for (const [kind, args, code] of cases) {
      wsClient.send({ t: 'cmd', id: newId('cm'), d: { kind, args } });
      const wsReply = await wsClient.nextAny(['cmd.ack', 'cmd.reject']);
      expect({ ok: wsReply.t === 'cmd.ack', code: wsReply.d.code }).toEqual({ ok: false, code });
      expect(await sendHttpCmd(url, alice.accessToken, planetA, kind, args)).toMatchObject({ ok: false, code });
    }

    expect(await sendHttpCmd(url, alice.accessToken, planetB!, 'setRally', { q: 0, r: 0 })).toMatchObject({ status: 409, ok: false, code: 'not_your_planet' });
    expect(await sendHttpCmd(url, alice.accessToken, planetA, 'setRally', { q: slotHome.q, r: slotHome.r }, { sectorId: secForeign })).toMatchObject({ status: 409, ok: false, code: 'not_your_sector' });

    const spoofBounty = await fetch(`${url}/v1/bounties/${planetB}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${alice.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        colonyId: aliceCol.id,
        colonyIndex: aliceCol.colonyIndex,
        target: { kind: 'deliver_units', resource: 'metals.t1', amount: 10 },
        reward: { resource: 'metals.t1', amount: 5 },
        expiresAt: Date.now() + 7_200_000,
      }),
    });
    expect(spoofBounty.status).toBe(403);
    expect(await app.get(MetricsRegistry).registry.metrics()).toContain('ta_anticheat_rejected_total');

    // Cold metadata-only stub (`removePlanet` clears syncedFromSim) still syncs from sim on HTTP command
    const antiCheat = app.get(SectorAntiCheatService);
    antiCheat.removePlanet(planetA);
    expect(antiCheat.index.getPlanet(planetA)?.syncedFromSim).toBe(false);
    expect(await sendHttpCmd(url, alice.accessToken, planetA, 'placeBuilding', { building: 'commandHub', q: fq, r: fr })).toMatchObject({
      ok: false,
      code: 'cross_sector_disabled',
    });

    // Live colonyEliminated event blocks BOTH WS and HTTP commands even before HomeRepository updates
    antiCheat.applyPlanetEvents(planetA, [
      { kind: 'colonyEliminated', severity: 'critical', colonyIds: [0], atTick: 25, data: { colonyId: aliceCol.id, colonyIndex: 0 } },
    ]);
    wsClient.send({ t: 'cmd', id: newId('cm'), d: { kind: 'setRally', args: { q: slotHome.q, r: slotHome.r } } });
    const elimWsReply = await wsClient.nextAny(['cmd.ack', 'cmd.reject']);
    expect({ ok: elimWsReply.t === 'cmd.ack', code: elimWsReply.d.code }).toEqual({ ok: false, code: 'colony_inactive' });
    expect(await sendHttpCmd(url, alice.accessToken, planetA, 'setRally', { q: slotHome.q, r: slotHome.r })).toMatchObject({
      status: 409,
      ok: false,
      code: 'colony_inactive',
    });
  });
});

describe('HTTP & WebSocket concurrent last-seat race & single-sector validation', () => {
  it('prevents concurrent HTTP and WS races from over-admitting the last free seat and rejects invalid single-sector IDs', async () => {
    const { app, url, wsUrl } = await bootServer();
    const antiCheat = app.get(SectorAntiCheatService);

    const p1 = await registerGuest(url, 'race-seat-p1-secret-0001', 'Racer1');
    const p2 = await registerGuest(url, 'race-seat-p2-secret-0002', 'Racer2');
    const p3 = await registerGuest(url, 'race-seat-p3-secret-0003', 'Racer3');

    // Requesting sec_1_0 on a single-sector dev planet fails with 400 INVALID_SECTOR instead of stamping sec_1_0 onto (0, 0)
    const badSecRes = await fetch(`${url}/v1/me/home?sector=sec_1_0`, {
      headers: { authorization: `Bearer ${p1.accessToken}` },
    });
    expect(badSecRes.status).toBe(400);
    expect(await badSecRes.json()).toMatchObject({ errorCode: 'INVALID_SECTOR' });

    // Seat p1 to materialize planetA, then configure capacity=2 with foundedSeats=1 -> exactly 1 free seat left
    const p1Home = HomeResponseSchema.parse(
      await (await fetch(`${url}/v1/me/home?sector=sec_0_0`, { headers: { authorization: `Bearer ${p1.accessToken}` } })).json(),
    );
    if (p1Home.state !== 'ACTIVE') throw new Error('expected p1 ACTIVE');
    const targetPlanetId = p1Home.planet.id;
    antiCheat.syncSectorSpace({
      planetId: targetPlanetId,
      sectorId: 'sec_0_0',
      kind: 'land',
      capacity: 2,
      foundedSeats: 1,
      freeSeats: 1,
    });
    expect(antiCheat.index.getSectorSpace(targetPlanetId, 'sec_0_0')?.freeSeats).toBe(1);

    // Race p2 and p3 concurrently for the single remaining seat on targetPlanetId
    const [r2, r3] = await Promise.all([
      fetch(`${url}/v1/me/home?planetId=${targetPlanetId}&sector=sec_0_0`, { headers: { authorization: `Bearer ${p2.accessToken}` } }),
      fetch(`${url}/v1/me/home?planetId=${targetPlanetId}&sector=sec_0_0`, { headers: { authorization: `Bearer ${p3.accessToken}` } }),
    ]);
    const statuses = [r2.status, r3.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);
    expect(antiCheat.index.getSectorSpace(targetPlanetId, 'sec_0_0')?.freeSeats).toBe(0);
    expect(antiCheat.index.getSectorSpace(targetPlanetId, 'sec_0_0')?.foundedSeats).toBe(2);

    // Concurrent WS join frames from unseated loser + fresh guest both get rejected with 4003 sector_full
    const loserToken = r2.status === 409 ? p2.accessToken : p3.accessToken;
    const p4 = await registerGuest(url, 'race-seat-p4-secret-0004', 'Racer4');
    const [ws1, ws2] = await Promise.all([WsClient.open(wsUrl), WsClient.open(wsUrl)]);
    ws1.hello(loserToken);
    ws2.hello(p4.accessToken);
    await Promise.all([ws1.next('ready'), ws2.next('ready')]);
    ws1.send({ t: 'join', d: { planetId: targetPlanetId, sectorId: 'sec_0_0' } });
    ws2.send({ t: 'join', d: { planetId: targetPlanetId, sectorId: 'sec_0_0' } });
    const [bye1, bye2] = await Promise.all([ws1.next('bye'), ws2.next('bye')]);
    expect(bye1.d).toEqual({ code: 4003, reason: 'sector_full' });
    expect(bye2.d).toEqual({ code: 4003, reason: 'sector_full' });
  });
});

describe('HTTP & WebSocket Round 2 fast-path, multi-field & precedence parity', () => {
  it('uses O(1) RAM hash fast-path on HTTP commands and blocks multi-field, diplomacy & precedence bypasses identically on HTTP and WS', async () => {
    const [singlePlanet] = devPlanetIds(1, 1);
    const { app, url, wsUrl } = await bootServer();
    const alice = await registerGuest(url, 'round2-alice-secret-0001', 'R2Alice');
    const seeded = await bootLiveAtlasPlanet(app, { id: alice.player.id, handle: 'R2Alice' });
    const { planetId: planetA, slotHome, aliceEntityId, rivalEntityId, rivalCol } = seeded;

    const wsClient = await WsClient.open(wsUrl);
    wsClient.hello(alice.accessToken);
    await wsClient.next('ready');
    wsClient.send({ t: 'join', d: { planetId: planetA, sectorId: 'sec_0_0' } });
    Welcome.parse(await wsClient.next('welcome'));

    // Prove HttpCommandController hits SectorHashIndex in O(1) RAM with 0 HomeProvider calls
    const homeSpy = vi.spyOn(app.get<HomeProvider>(HOME_PROVIDER), 'getHome');
    expect(await sendHttpCmd(url, alice.accessToken, planetA, 'setRally', { q: slotHome.q, r: slotHome.r })).toMatchObject({
      status: 200,
      ok: true,
    });
    expect(homeSpy).not.toHaveBeenCalled();

    const round2Bypasses: ReadonlyArray<[string, unknown, string]> = [
      ['attackMove', { entityId: rivalEntityId, entityIds: [aliceEntityId], q: slotHome.q, r: slotHome.r }, 'not_own_colony'],
      ['attackMove', { entityIds: [aliceEntityId], unitIds: [rivalEntityId], q: slotHome.q, r: slotHome.r }, 'not_own_colony'],
      ['attackTarget', { entityId: aliceEntityId, unitId: rivalEntityId, targetId: rivalEntityId }, 'not_own_colony'],
      ['setStance', { entityId: rivalEntityId, entityIds: [aliceEntityId], stance: 'defend' }, 'not_own_colony'],
      ['setStance', { entityIds: [aliceEntityId], unitIds: [rivalEntityId], stance: 'defend' }, 'not_own_colony'],
      ['setRally', { producerId: aliceEntityId, entityId: rivalEntityId, q: slotHome.q, r: slotHome.r }, 'not_own_colony'],
      ['cancelTask', { taskId: `building:${rivalEntityId}` }, 'not_own_colony'],
      ['cancelTask', { taskId: `worker:${rivalEntityId}` }, 'not_own_colony'],
      ['market.cancelOrder', { orderId: `market-order:${rivalCol.id}:1` }, 'not_own_colony'],
      ['raid', { targetColonyId: rivalCol.id, entityIds: [aliceEntityId], unitIds: [rivalEntityId] }, 'not_own_colony'],
      ['diplomacy.declareWar', { targetColonyId: rivalCol.id, bondAmount: 10 }, 'cross_sector_disabled'],
      ['diplomacy.respondTruce', { offerId: rivalCol.id, accept: true }, 'cross_sector_disabled'],
      ['enqueueTask', { precedence: 'hq', task: { kind: 'build', building: 'roboticsFactory', q: slotHome.q, r: slotHome.r } }, 'invalid_args'],
      ['enqueueTask', { precedence: 'autoSitePrep', task: { kind: 'build', building: 'pylon', q: slotHome.q, r: slotHome.r } }, 'invalid_args'],
      ['repair', { entityId: aliceEntityId, precedence: 'system' }, 'invalid_args'],
    ];

    for (const [kind, args, code] of round2Bypasses) {
      wsClient.send({ t: 'cmd', id: newId('cm'), d: { kind, args } });
      const wsReply = await wsClient.nextAny(['cmd.ack', 'cmd.reject']);
      expect({ ok: wsReply.t === 'cmd.ack', code: wsReply.d.code }).toEqual({ ok: false, code });
      expect(await sendHttpCmd(url, alice.accessToken, planetA, kind, args)).toMatchObject({ ok: false, code });
    }

    // Dev WS join with invalid sec_1_0 on cold single-sector planet is blocked post-snapshot
    const devWs = await WsClient.open(wsUrl);
    devWs.hello('dev:spectator_round2');
    await devWs.next('ready');
    devWs.send({ t: 'join', d: { planetId: singlePlanet, sectorId: 'sec_1_0' } });
    expect((await devWs.next('bye')).d).toEqual({ code: 4003, reason: 'invalid_sector' });

    // Live colonyEliminated immediately surfaces state: ELIMINATED on GET /v1/me/home before DB sweep
    app.get(SectorAntiCheatService).applyPlanetEvents(planetA, [
      { kind: 'colonyEliminated', severity: 'critical', colonyIds: [0], atTick: 55, data: { colonyId: seeded.aliceCol.id, colonyIndex: 0 } },
    ]);
    const homeAfterElim = HomeResponseSchema.parse(
      await (await fetch(`${url}/v1/me/home`, { headers: { authorization: `Bearer ${alice.accessToken}` } })).json(),
    );
    expect(homeAfterElim.state).toBe('ELIMINATED');
  });
});

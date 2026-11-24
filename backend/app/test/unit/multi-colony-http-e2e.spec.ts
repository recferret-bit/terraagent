import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  AuthResponseSchema,
  CANONICAL_PLANETS,
  decodeWire,
  HomeResponseSchema,
  MANAGED_AI_MODEL,
  MeProfileResponseSchema,
} from '@terra/contracts';
import { createAtlasPlanetState, snapshot } from '@terra/sim';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../../src/app';
import { ColonySlotAllowanceService, createSpawnColonyCommand, HomeRepository } from '../../src/core/home';
import { GamePlanets } from '../../src/game/game-planets.service';
import {
  LobbyPersistenceService,
  MatchmakerService,
  SpawnSagaService,
} from '../../src/lobby';
import { UNIT_APP_ENV } from '../unit-app-env';

let activeApp!: INestApplication;
let url!: string;
let wsUrl!: string;
const openSockets: WebSocket[] = [];

beforeAll(async () => {
  const created = await createApp({
    source: {
      ...UNIT_APP_ENV,
      NODE_ENV: 'test',
      SIM_THREADS: '1',
      GAME_DEV_PLANETS: '1',
      JWT_ACCESS_SECRET: 'test-multicolony-jwt-secret-0123456789abcdef',
    },
  });
  await created.app.listen(0, '127.0.0.1');
  activeApp = created.app;
  url = (await created.app.getUrl()).replace('[::1]', '127.0.0.1');
  const port = new URL(url).port;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
});

afterEach(() => {
  for (const ws of openSockets.splice(0)) ws.terminate();
});

afterAll(async () => {
  for (const ws of openSockets.splice(0)) ws.terminate();
  await activeApp?.close();
});

async function registerGuest(url: string, secret: string, handle: string) {
  const res = await fetch(`${url}/v1/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceSecret: secret, handle }),
  });
  expect(res.status).toBe(200);
  return AuthResponseSchema.parse(await res.json());
}

async function openAuthedWs(wsUrl: string, accessToken: string) {
  const ws = new WebSocket(wsUrl);
  openSockets.push(ws);
  const frames: Array<{ t: string; d: Record<string, unknown> }> = [];
  const waiters: Array<() => void> = [];
  ws.on('message', (data, isBinary) => {
    const buf = data as Buffer;
    frames.push(decodeWire(isBinary ? buf : buf.toString('utf8')) as { t: string; d: Record<string, unknown> });
    waiters.splice(0).forEach((w) => w());
  });
  ws.on('close', (code, reason) => {
    frames.push({ t: 'closed', d: { code, reason: reason.toString() } });
    waiters.splice(0).forEach((w) => w());
  });
  await new Promise<void>((res, rej) => {
    ws.once('open', () => res());
    ws.once('error', rej);
  });
  const send = (msg: object) => ws.send(JSON.stringify({ v: 1, ...msg }));
  const next = async (types: readonly string[]) => {
    for (;;) {
      const idx = frames.findIndex((f) => types.includes(f.t));
      if (idx >= 0) return frames.splice(idx, 1)[0]!;
      await new Promise<void>((r) => waiters.push(r));
    }
  };
  send({ t: 'hello', d: { accessToken, proto: [1], client: { app: 'game', version: '0.1.0' } } });
  await next(['ready']);
  return { send, next };
}

describe('HTTP & WebSocket E2E — Multi-colony staking, sector lock & /v1/me/ai-settings lock', () => {
  it('enforces API key lock on PUT /v1/me/ai-settings and returns colonySlots on GET /v1/me/profile', async () => {
    const slotAllowance = activeApp.get(ColonySlotAllowanceService);
    const pilot = await registerGuest(url, 'e2e-ai-lock-secret-0001', 'AiPilot');
    const authHeaders = { authorization: `Bearer ${pilot.accessToken}`, 'content-type': 'application/json' };

    const prof0 = MeProfileResponseSchema.parse(
      await (await fetch(`${url}/v1/me/profile`, { headers: authHeaders })).json(),
    );
    expect(prof0.colonySlots).toMatchObject({ used: 0, max: 1, aiColonySlots: 0, tier: 0, isStaker: false });
    expect(prof0.aiSettings).toMatchObject({ model: MANAGED_AI_MODEL, hasApiKey: false });

    const noKeyRes = await fetch(`${url}/v1/me/ai-settings`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ model: 'deepseek/deepseek-v3.2' }),
    });
    expect(noKeyRes.status).toBe(400);

    const badKeyRes = await fetch(`${url}/v1/me/ai-settings`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ model: 'deepseek/deepseek-v3.2', apiKey: 'short' }),
    });
    expect(badKeyRes.status).toBe(400);

    const okKeyRes = await fetch(`${url}/v1/me/ai-settings`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ model: 'deepseek/deepseek-v3.2', apiKey: 'sk-nearai-valid-key-9999' }),
    });
    expect(okKeyRes.status).toBe(200);
    expect(await okKeyRes.json()).toMatchObject({ hasApiKey: true, model: 'deepseek/deepseek-v3.2' });

    const clearRes = await fetch(`${url}/v1/me/ai-settings`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ apiKey: '' }),
    });
    expect(clearRes.status).toBe(200);
    expect(await clearRes.json()).toMatchObject({ hasApiKey: false, model: MANAGED_AI_MODEL });

    slotAllowance.setTestStakedNear(pilot.player.id, 50);
    const profStaked = MeProfileResponseSchema.parse(
      await (await fetch(`${url}/v1/me/profile`, { headers: authHeaders })).json(),
    );
    expect(profStaked.colonySlots).toMatchObject({ used: 0, max: 3, aiColonySlots: 3, tier: 2, isStaker: true });
    expect(profStaked.aiSettings?.stakerAutopilotActive).toBe(true);
    expect(profStaked.aiSettings?.model).toBe(MANAGED_AI_MODEL);
  });
});

async function ensureDesertSimLoaded() {
  const persistence = activeApp.get(LobbyPersistenceService);
  const gamePlanets = activeApp.get(GamePlanets);
  const homeRepo = activeApp.get(HomeRepository);
  await persistence.provisionAllCanonicalWorlds({ foundingSeatsPerSector: 4, validatedSeatsPerSector: 4 });
  const desertId = CANONICAL_PLANETS.desert.id;
  if (!gamePlanets.isLoaded(desertId)) {
    const atlasState = createAtlasPlanetState({
      planetId: desertId, planetType: 'desert', seed: 'e2e-multi-colony-desert',
      sectorRadius: 24, gridRadius: 96, skipPerfCaps: true,
    });
    await gamePlanets.load(desertId, { snapshot: snapshot(atlasState) });
  }
  const planetRec = await homeRepo.upsertDevPlanet(desertId, { radius: 96, capacity: 12 });
  return { desertId, gamePlanets, planetRec };
}

describe('HTTP & WebSocket E2E — Multi-colony same-planet WS & HTTP command routing', () => {
  it('enforces staking slots, forbids same-sector colonies, and routes WS/HTTP commands across 2 colonies on the same planet', async () => {
    const matchmaker = activeApp.get(MatchmakerService);
    const saga = activeApp.get(SpawnSagaService);
    const slotAllowance = activeApp.get(ColonySlotAllowanceService);
    const { desertId, gamePlanets, planetRec } = await ensureDesertSimLoaded();

    const staker = await registerGuest(url, 'e2e-multicolony-staker-0001', 'CommanderMulti');
    const authHeaders = { authorization: `Bearer ${staker.accessToken}`, 'content-type': 'application/json' };

    const tk1Res = await fetch(`${url}/v1/match/tickets`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ mode: 'JOIN_PLANET', planetType: 'desert', sectorId: 'sec_0_0' }),
    });
    expect(tk1Res.status).toBe(200);
    const tk1 = (await tk1Res.json()) as { id: string };
    await matchmaker.processTicket(tk1.id);
    const sp1 = await saga.executeSpawnForTicket(tk1.id);
    expect(sp1.ok).toBe(true);

    const nonStakerTicket = await fetch(`${url}/v1/match/tickets`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ mode: 'JOIN_PLANET', planetType: 'ocean', autoSector: true }),
    });
    expect(nonStakerTicket.status).toBe(409);
    expect((await fetch(`${url}/v1/me/home?new=1&type=ocean`, { headers: authHeaders })).status).toBe(403);

    slotAllowance.setTestStakedNear(staker.player.id, 50);
    const sameSecRes = await fetch(`${url}/v1/match/tickets`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ mode: 'JOIN_PLANET', planetType: 'desert', sectorId: 'sec_0_0' }),
    });
    expect(sameSecRes.status).toBe(409);
    expect(await sameSecRes.json()).toMatchObject({ code: 'sector_already_colonized' });

    const tk2Res = await fetch(`${url}/v1/match/tickets`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ mode: 'JOIN_PLANET', planetType: 'desert', sectorId: 'sec_1_0' }),
    });
    expect(tk2Res.status).toBe(200);
    const tk2 = (await tk2Res.json()) as { id: string };
    await matchmaker.processTicket(tk2.id);
    const sp2 = await saga.executeSpawnForTicket(tk2.id);
    expect(sp2.ok).toBe(true);

    const homeA = HomeResponseSchema.parse(await (await fetch(`${url}/v1/me/home?colony=${sp1.colonyId}`, { headers: authHeaders })).json());
    const homeB = HomeResponseSchema.parse(await (await fetch(`${url}/v1/me/home?colony=${sp2.colonyId}`, { headers: authHeaders })).json());
    expect(homeA.state).toBe('ACTIVE');
    expect(homeB.state).toBe('ACTIVE');
    if (homeA.state === 'ACTIVE') expect(homeA.colony.id).toBe(sp1.colonyId);
    if (homeB.state === 'ACTIVE') expect(homeB.colony.id).toBe(sp2.colonyId);
    expect(homeB.colonySlots).toMatchObject({ used: 2, max: 3, isStaker: true });
    expect(homeB.activeColonies).toHaveLength(2);

    for (const [sp, sec] of [[sp1, 'sec_0_0'], [sp2, 'sec_1_0']] as const) {
      await gamePlanets.submit(desertId, createSpawnColonyCommand({
        player: { id: staker.player.id, handle: 'CommanderMulti' }, colony: sp.colony!, planet: planetRec,
        slot: { index: sp.colony!.colonyIndex, q: sp.colony!.spawnQ, r: sp.colony!.spawnR, sectorId: sec },
      }));
    }

    const ws = await openAuthedWs(wsUrl, staker.accessToken);
    ws.send({ t: 'join', d: { planetId: desertId, colonyId: sp2.colonyId, sectorId: 'sec_1_0' } });
    const welcomeB = await ws.next(['welcome', 'error', 'closed']);
    expect(welcomeB.t).toBe('welcome');
    expect(welcomeB.d).toMatchObject({ colonyId: sp2.colonyId });

    const httpCmdB = await fetch(`${url}/v1/planets/${desertId}/commands`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ kind: 'queueGoal', args: { goal: 'grow_economy' }, colonyId: sp2.colonyId, sectorId: 'sec_1_0' }),
    });
    expect(httpCmdB.status).toBe(200);
    expect(await httpCmdB.json()).toMatchObject({ ok: true });
  });
});

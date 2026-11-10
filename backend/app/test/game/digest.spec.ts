import { AwayDigestV1Schema, RESOURCE_KEYS, type AwayDigestV1, type ResourceKey } from '@terra/contracts';
import { ENTITY_KIND, createState, insertRow, snapshot } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { GlobalTokenBudget } from '../../src/ai/budget/global';
import { awayStory } from '../../src/ai/story/away';
import { emptyDigest } from '../../src/game/digest/body';
import { mergeBodies } from '../../src/game/digest/folder';
import { MemoryDigestStore } from '../../src/game/digest/memory-store';
import { AwayDigestService } from '../../src/game/digest/service';
import { awayFacts, awayStoryEnabled, createDigestStory, digestStoryProvider, type DigestStory } from '../../src/game/digest/story';
import type { DigestBaseline } from '../../src/game/digest/types';

const COLONY = 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const PLANET = 'pl_01ARZ3NDEKTSV4RRFFQ69G5FAV';

function stock(over: Partial<Record<ResourceKey, number>> = {}): Record<ResourceKey, number> {
  const out = {} as Record<ResourceKey, number>;
  for (const key of RESOURCE_KEYS) out[key] = over[key] ?? 0;
  return out;
}

function clock(start = Date.parse('2026-11-09T12:00:00.000Z')) {
  let t = start;
  return {
    now: () => new Date(t),
    add: (ms: number) => {
      t += ms;
    },
  };
}

function service(
  store = new MemoryDigestStore(),
  reader?: { read: () => Promise<DigestBaseline | null> },
  c = clock(),
  story?: DigestStory,
) {
  return {
    store,
    c,
    svc: new AwayDigestService({
      store,
      now: c.now,
      ...(reader ? { reader } : {}),
      ...(story ? { story } : {}),
    }),
  };
}

const away = () => ({
  planetId: PLANET,
  tick: 1,
  kind: 'colonyAway',
  colonyIds: [COLONY],
  data: { colonyId: COLONY, atTick: 1 },
});
const back = () => ({
  planetId: PLANET,
  tick: 2,
  kind: 'colonyBack',
  colonyIds: [COLONY],
  data: { colonyId: COLONY, atTick: 2 },
});
const raid = (n: number, kind = 'raidStarted') => ({
  planetId: PLANET,
  tick: n,
  kind,
  colonyIds: [COLONY],
  data: { colonyId: COLONY, species: `R${n}`, q: 1, r: 2, unbreached: true },
});

function planetBytes(): Uint8Array {
  const state = createState({ planetId: PLANET, planetType: 'desert', seed: 'digest', radius: 2 });
  state.colonies.push({
    index: 0,
    id: COLONY,
    name: 'A',
    color: 1,
    status: 'active',
    changedAt: 0,
    stock: { 'metals.t1': 12 },
    power: { net: -4 },
  });
  state.grid.layers.owner[0] = 0;
  state.grid.layers.owner[1] = 0;
  const worker = insertRow(state.entities, 1, 0);
  state.entities.cols.kind[worker] = ENTITY_KIND.worker;
  state.entities.cols.owner[worker] = 0;
  state.entities.cols.hp[worker] = 5;
  const dead = insertRow(state.entities, 2, 0);
  state.entities.cols.kind[dead] = ENTITY_KIND.worker;
  state.entities.cols.owner[dead] = 0;
  return snapshot(state);
}

describe('away digest', () => {
  it('two raid folds set attacks.count to 2', async () => {
    const { svc, store } = service();
    await svc.onPlanetEvent(away());
    await svc.onPlanetEvent(raid(1));
    await svc.onPlanetEvent(raid(2));
    await svc.flushPlanet(PLANET);
    expect((await store.findOpen(COLONY))?.body.attacks.count).toBe(2);
  });

  it('a raid while the colony is present does not open a digest', async () => {
    const { svc, store } = service();
    await svc.onPlanetEvent(raid(1));
    await svc.onPlanetEvent({ ...raid(2), kind: 'underAttack' });
    await svc.onPlanetEvent(raid(3, 'raidRepelled'));
    await svc.flushPlanet(PLANET);
    expect(await store.count()).toBe(0);
    expect(store.rowCount()).toBe(0);
    expect(await store.findOpen(COLONY)).toBeNull();
  });

  it('drops the 21st attack list item and still counts it', async () => {
    const { svc, store } = service();
    await svc.onPlanetEvent(away());
    for (let n = 1; n <= 21; n++) await svc.onPlanetEvent(raid(n));
    await svc.flushPlanet(PLANET);
    const attacks = (await store.findOpen(COLONY))!.body.attacks;
    expect(attacks.count).toBe(21);
    expect(attacks.byColony).toHaveLength(20);
    expect(attacks.byColony.some((row) => row.displayName === 'R21')).toBe(false);
    expect(attacks.byColony[0]?.displayName).toBe('R1');
  });

  it('a restart reloads the flushed body and the second raid brings the count to 2', async () => {
    const store = new MemoryDigestStore();
    const c = clock();
    const first = new AwayDigestService({ store, now: c.now });
    await first.onPlanetEvent(away());
    await first.onPlanetEvent(raid(1));
    await first.flushPlanet(PLANET);
    expect((await store.findOpen(COLONY))?.body.attacks.count).toBe(1);
    const restarted = new AwayDigestService({ store, now: c.now });
    await restarted.restoreOpen();
    await restarted.onPlanetEvent(raid(2));
    await restarted.flushPlanet(PLANET);
    expect((await store.findOpen(COLONY))?.body.attacks.count).toBe(2);
  });
});

describe('away digest close, merge and baseline', () => {
  it('counts a repelled raid separately and records underAttack', async () => {
    const { svc, store } = service();
    await svc.onPlanetEvent(away());
    await svc.onPlanetEvent(raid(1, 'raidRepelled'));
    await svc.onPlanetEvent({ ...raid(2), kind: 'underAttack' });
    await svc.flushPlanet(PLANET);
    const body = (await store.findOpen(COLONY))!.body;
    expect(body.attacks).toMatchObject({ count: 1, repelled: 1 });
    expect(body.alerts).toEqual([{ code: 'under_attack', message: 'Under attack at 1,2' }]);
  });

  it('closes on return with durationS and merges older unseen digests', async () => {
    const { svc, store, c } = service();
    await svc.onPlanetEvent(away());
    await svc.onPlanetEvent(raid(1));
    c.add(600_000);
    await svc.onPlanetEvent(back());
    c.add(1_000);
    await svc.onPlanetEvent(away());
    await svc.onPlanetEvent(raid(2));
    await svc.flushPlanet(PLANET);
    const unseen = await store.listUnseen(COLONY);
    expect(unseen).toHaveLength(1);
    expect(unseen[0]?.body.attacks.count).toBe(2);
    expect(unseen[0]?.body.attacks.byColony.map((row) => row.displayName)).toEqual(['R1', 'R2']);
    expect(unseen[0]?.body.durationS).toBe(600);
    expect(await store.count()).toBe(2);
    expect(store.rowCount()).toBe(2);
  });

  it('a presence return closes the row and a late colonyAway does not reopen it', async () => {
    const { svc, store, c } = service();
    await svc.onPlanetEvent(away());
    c.add(120_000);
    await svc.onPresence({ planetId: PLANET, colonyId: COLONY, away: false, at: c.now() });
    await svc.onPlanetEvent(away());
    const rows = await store.listUnseen(COLONY);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.closedAt).toEqual(c.now());
    expect(rows[0]?.body.durationS).toBe(120);
    await svc.onPresence({ planetId: PLANET, colonyId: COLONY, away: true, at: c.now() });
    await svc.onPlanetEvent(away());
    expect(await store.findOpen(COLONY)).not.toBeNull();
  });

  it('fills a zero baseline from the snapshot passed to flush', async () => {
    const { svc, store } = service();
    await svc.onPlanetEvent(away());
    await svc.flushPlanet(PLANET, planetBytes());
    const body = (await store.findOpen(COLONY))!.body;
    expect(body.resources['metals.t1']).toEqual({ before: 12, after: 12 });
    expect(body.energy).toEqual({ before: -4, after: -4 });
    expect(body.robots.before).toBe(1);
    expect(body.territory).toEqual({ before: 2, after: 2 });
  });

  it('stores a live baseline and caps merged attack lists at 20', async () => {
    const base: DigestBaseline = { resources: stock({ 'metals.t1': 4 }), energy: 2, robots: 3, territory: 5 };
    const { svc, store } = service(new MemoryDigestStore(), {
      async read() {
        return base;
      },
    });
    await svc.onPlanetEvent(away());
    const opened = (await store.findOpen(COLONY))!.body;
    expect(opened.resources['metals.t1'].before).toBe(4);
    expect(opened.robots).toMatchObject({ before: 3, after: 3 });
    const older = emptyDigest(COLONY, '2026-11-09T10:00:00.000Z');
    const newer = emptyDigest(COLONY, '2026-11-09T11:00:00.000Z');
    older.attacks = {
      count: 15,
      repelled: 1,
      byColony: Array.from({ length: 15 }, (_, i) => ({ displayName: `A${i}`, count: 1 })),
    };
    newer.attacks = {
      count: 10,
      repelled: 2,
      byColony: Array.from({ length: 10 }, (_, i) => ({ displayName: `B${i}`, count: 1 })),
    };
    const merged = mergeBodies([older, newer]);
    expect(merged.attacks.count).toBe(25);
    expect(merged.attacks.repelled).toBe(3);
    expect(merged.attacks.byColony).toHaveLength(20);
    expect(merged.attacks.byColony[0]?.displayName).toBe('A0');
    expect(merged.attacks.byColony.some((row) => row.displayName === 'B9')).toBe(false);
  });
});

describe('away story on digest close', () => {
  async function played(story?: DigestStory) {
    const { svc, store, c } = service(new MemoryDigestStore(), undefined, clock(), story);
    await svc.onPlanetEvent(away());
    await svc.onPlanetEvent(raid(1));
    const open = (await store.findOpen(COLONY))!.body;
    c.add(60_000);
    await svc.onPlanetEvent(back());
    const body = (await store.listUnseen(COLONY))[0]!.body;
    return { open, body };
  }

  it('adds a capped paragraph when the provider is on, and leaves the body unchanged when it is off', async () => {
    const on = await played(digestStoryProvider(true, new GlobalTokenBudget(10_000)));
    const off = await played(digestStoryProvider(false, new GlobalTokenBudget(10_000)));
    const none = await played();
    expect(on.open.story).toBeUndefined();
    expect(on.body.story).toBe('Away for 60s. 1 attacks, 0 repelled.');
    expect(on.body.story!.length).toBeLessThanOrEqual(600);
    expect(on.body.story).not.toMatch(/^\s*(build|attack|buy|sell|move|destroy)\b/i);
    expect(on.body).not.toHaveProperty('commands');
    expect(off.body.story).toBeUndefined();
    expect(stableJson(withoutStory(on.body))).toBe(stableJson(off.body));
    expect(JSON.stringify(off.body)).toBe(JSON.stringify(none.body));
  });

  it('omits a paragraph that starts with Build and records no tokens', async () => {
    const budget = new GlobalTokenBudget(10_000);
    const told = awayStory(
      { enabled: true, day: '2026-11-09', colonyId: COLONY, facts: ['Build the south wall'] },
      budget,
    );
    expect(told).toEqual({ paragraph: null, commands: [] });
    expect(budget.snapshot().days).toEqual([{ day: '2026-11-09', spent: 0, outstanding: [] }]);
    const { body } = await played({ paragraph: () => 'Build the south wall' });
    expect(body.story).toBeUndefined();
    expect(AwayDigestV1Schema.safeParse(body).success).toBe(true);
  });

  it('keeps a valid closed digest when the provider throws', async () => {
    const { svc, store } = service(new MemoryDigestStore(), undefined, clock(), {
      paragraph() {
        throw new Error('provider down');
      },
    });
    await expect(svc.onPlanetEvent(away())).resolves.toBeUndefined();
    await expect(svc.onPlanetEvent(back())).resolves.toBeUndefined();
    const row = (await store.listUnseen(COLONY))[0]!;
    expect(row.closedAt).not.toBeNull();
    expect(row.body.story).toBeUndefined();
    expect(AwayDigestV1Schema.safeParse(row.body).success).toBe(true);
  });

  it('writes no story for empty facts and still returns a valid digest', async () => {
    const { svc, store } = service(
      new MemoryDigestStore(),
      undefined,
      clock(),
      digestStoryProvider(true, new GlobalTokenBudget(10_000)),
    );
    await svc.onPlanetEvent(away());
    await svc.onPlanetEvent(back());
    const body = (await store.listUnseen(COLONY))[0]!.body;
    expect(awayFacts(body)).toEqual([]);
    expect(body.story).toBeUndefined();
    expect(body.durationS).toBe(0);
    expect(AwayDigestV1Schema.safeParse(body).success).toBe(true);
  });

  it('seals the awayStory paragraph when the provider is on and omits story when it is off', async () => {
    const facts = ['Away for 60s.', '1 attacks, 0 repelled.'];
    const told = awayStory(
      { enabled: true, day: '2026-11-09', colonyId: COLONY, facts },
      new GlobalTokenBudget(10_000),
    );
    const on = await played(createDigestStory({ NODE_ENV: 'production', AWAY_STORY_ENABLED: 'true', TA_WAVES: '..16' }));
    expect(on.body.story).toBe(told.paragraph);
    expect(on.body.story).toBe('Away for 60s. 1 attacks, 0 repelled.');
    const off = await played(createDigestStory({ NODE_ENV: 'production', AWAY_STORY_ENABLED: 'false', TA_WAVES: '..16' }));
    expect(off.body).not.toHaveProperty('story');
  });

  it('mentions duration and one resource net, and stays off when W16 is off', () => {
    const body = emptyDigest(COLONY, '2026-11-09T12:00:00.000Z');
    body.durationS = 5;
    body.resources['metals.t1'] = { before: 1, after: 4 };
    expect(awayFacts(body)).toEqual(['Away for 5s.', 'metals.t1 net 3.']);
    expect(createDigestStory({ NODE_ENV: 'production', AWAY_STORY_ENABLED: 'true', TA_WAVES: '..09' })).toBeUndefined();
    expect(awayStoryEnabled({ NODE_ENV: 'production' })).toBe(true);
    expect(awayStoryEnabled({ NODE_ENV: 'test' })).toBe(false);
    expect(awayStoryEnabled({ NODE_ENV: 'production', AWAY_STORY_ENABLED: 'false' })).toBe(false);
    expect(awayStoryEnabled({ NODE_ENV: 'development', AWAY_STORY_ENABLED: 'true' })).toBe(true);
  });
});

function withoutStory(body: AwayDigestV1): AwayDigestV1 {
  const copy = { ...body };
  delete copy.story;
  return copy;
}

function stableJson(value: unknown): string {
  return JSON.stringify(orderKeys(value));
}

function orderKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderKeys);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = orderKeys((value as Record<string, unknown>)[key]);
  }
  return out;
}

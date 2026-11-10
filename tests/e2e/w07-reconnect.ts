import { expect, type Page } from '@playwright/test';
import { devConsole, expectNoPageErrors, getEntitiesSnapshot, login, waitForTick } from './harness';
import { independentBrowser } from './harness/independentBrowser';
import type { ClientView, EntityRow } from '../../frontend/game/store/replica/viewCodec';

interface CombatSample { planet: string; tick: number; entities: EntityRow[]; fauna: unknown; impacts: unknown; directives: unknown }
interface ProbeWindow extends Window {
  __combatSamples?: Record<number, CombatSample>;
  __online: { store: { latest: ClientView; onView(fn: (v: ClientView) => void): () => void } };
}

async function sampleCombat(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const w = window as unknown as ProbeWindow;
    const path = '/game/store/replica/viewCodec.ts';
    const { forEachEntity } = await import(path);
    w.__combatSamples = {};
    const record = (v: ClientView) => {
      const entities: EntityRow[] = [];
      forEachEntity(v.entities, v.count, (row: EntityRow) => entities.push(row));
      const sample = { planet: v.planet.id, tick: v.tick, entities: entities.sort((a, b) => a.id - b.id),
        fauna: v.blobs?.faunaHives ?? null, impacts: v.blobs?.projectileImpacts ?? null,
        directives: v.blobs?.faunaDirectives ?? null };
      w.__combatSamples![v.tick] = JSON.parse(JSON.stringify(sample));
      const keys = Object.keys(w.__combatSamples!).map(Number).sort((a, b) => a - b);
      for (const key of keys.slice(0, -100)) delete w.__combatSamples![key];
    };
    w.__online.store.onView(record);
    record(w.__online.store.latest);
  });
}

async function equalCombatTicks(first: Page, second: Page, after: number): Promise<void> {
  await expect.poll(async () => {
    const read = (p: Page) => p.evaluate(() => (window as unknown as ProbeWindow).__combatSamples ?? {});
    const [a, b] = await Promise.all([read(first), read(second)]);
    const common = Object.keys(a).map(Number).filter(tick => tick > after && b[tick] && activeCombat(a[tick]));
    if (common.length < 3) return false;
    for (const tick of common.slice(-3)) expect(b[tick], `same planet combat state at tick ${tick}`).toEqual(a[tick]);
    return true;
  }, { timeout: 30_000 }).toBe(true);
}

async function latestCombat(page: Page): Promise<CombatSample> {
  return page.evaluate(() => {
    const samples = (window as unknown as ProbeWindow).__combatSamples!;
    return samples[Math.max(...Object.keys(samples).map(Number))];
  });
}

function activeCombat(sample: CombatSample): boolean {
  const directives = sample.directives as { cohortsById?: Record<string, { memberIds: number[] }> } | null;
  const impacts = sample.impacts as { queue?: { weaponKind: string }[] } | null;
  return Object.values(directives?.cohortsById ?? {}).some(c => c.memberIds.length > 0)
    && Boolean(impacts?.queue?.some(shot => shot.weaponKind === 'acid'))
    && sample.entities.some(e => e.kind === 65 && e.hp > 0 && e.hp < e.hpMax);
}

async function prepareActiveCombat(page: Page): Promise<void> {
  expect(await devConsole(page, 'godMode on')).toContain('dev.godmode ok');
  await devConsole(page, 'tune fauna.greenSpitter.range 25');
  await devConsole(page, 'tune fauna.greenSpitter.projSpeed 0.1');
  expect(await devConsole(page, 'spawnHive greenSpitter 10 0 passive')).toContain('dev.spawnhive ok');
  let hiveId = 0;
  await expect.poll(async () => (hiveId = (await getEntitiesSnapshot(page))
    .find(e => e.kind === 65 && e.q === 10 && e.r === 0)?.id ?? 0)).toBeGreaterThan(0);
  expect(await devConsole(page, `damage ${hiveId} 10`)).toContain('dev.damage ok');
  expect(await devConsole(page, `spawnRaid ${hiveId}`)).toContain('dev.spawnraid ok');
}

/** A second connection joins the same planet; reconnect must restore identity, HP, cohorts and impact queue. */
export async function checkServerCombatReconnect(page: Page): Promise<void> {
  await devConsole(page, 'warp 1');
  await sampleCombat(page);
  const planet = await page.evaluate(() => (window as unknown as ProbeWindow).__online.store.latest.planet.id);
  const peer = await independentBrowser(page.context().browser()!, {
    baseURL: new URL(page.url()).origin, storageState: await page.context().storageState(),
  }, 'reconnect');
  const second = await peer.context.newPage();
  const errors: string[] = [];
  second.on('pageerror', error => errors.push(error.message));
  let failed = false;
  try {
    const query = new URLSearchParams({ join: planet, predict: '0', shadow: '0', crt: '0', wind: '0' });
    query.set('as', new URLSearchParams(login(second, 'e2e-reconnect-peer')).get('as')!);
    await second.goto(`/play.html?${query}`);
    const joinedAt = await waitForTick(second, () => true, 120_000);
    await sampleCombat(second);
    expect(await second.evaluate(() => (window as unknown as ProbeWindow).__online.store.latest.planet.id)).toBe(planet);
    await prepareActiveCombat(page);
    await equalCombatTicks(page, second, joinedAt);
    console.info(`[w07 reconnect] same-planet active combat matches after join at tick ${joinedAt}`);
    // Reload the join URL, not a scenario URL: a new scenario would silently test a different planet.
    await second.reload();
    const rejoinedAt = await waitForTick(second, () => true, 120_000);
    await sampleCombat(second);
    expect(await second.evaluate(() => (window as unknown as ProbeWindow).__online.store.latest.planet.id)).toBe(planet);
    await equalCombatTicks(page, second, rejoinedAt);
    console.info(`[w07 reconnect] same-planet active combat matches after reload at tick ${rejoinedAt}`);
    expectNoPageErrors(second);
  } catch (error) {
    failed = true;
    const diagnostic = await Promise.race([second.evaluate(() => {
      const online = (window as unknown as { __online?: { store?: { latest?: { tick?: number }; tick?: number; confirmedTick?: number; status?: unknown }; transport?: { state?: unknown } } }).__online;
      return { url: location.href, online: Boolean(online), tick: online?.store?.latest?.tick,
        storeTick: online?.store?.tick, confirmedTick: online?.store?.confirmedTick,
        status: online?.store?.status, connection: online?.transport?.state,
        body: document.body.innerText.slice(0, 2000) };
    }), new Promise(resolve => setTimeout(() => resolve('join diagnostics timed out'), 5000))]);
    console.log('[w07 reconnect diagnostics]', diagnostic, errors);
    throw error;
  } finally { await peer.close(failed); }
}

/** Local hosts are independent worlds; prove persisted reload, not a fictitious shared second connection. */
export async function checkLocalCombatResume(page: Page): Promise<void> {
  await devConsole(page, 'warp 1');
  await sampleCombat(page);
  await prepareActiveCombat(page);
  await expect.poll(async () => activeCombat(await latestCombat(page)), { timeout: 30_000 }).toBe(true);
  const before = await latestCombat(page);
  const hives = (await getEntitiesSnapshot(page)).filter(e => e.kind >= 63 && e.kind <= 65).map(e => ({ id: e.id, kind: e.kind, hp: e.hp }));
  await page.waitForTimeout(11_000); // The local checkpoint persists every ten seconds.
  await page.reload();
  await waitForTick(page, before.tick, 120_000);
  await sampleCombat(page);
  const after = await latestCombat(page);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__online.store.latest.planet.id)).toBe(before.planet);
  expect((await getEntitiesSnapshot(page)).filter(e => e.kind >= 63 && e.kind <= 65).map(e => ({ id: e.id, kind: e.kind, hp: e.hp }))).toEqual(hives);
  const cohorts = (sample: CombatSample) => (sample.directives as { cohortsById: unknown }).cohortsById;
  expect(cohorts(after)).toEqual(cohorts(before));
  const queue = (sample: CombatSample) => (sample.impacts as { queue: { id: number; impactTick: number }[] }).queue;
  expect(queue(before).length).toBeGreaterThan(0);
  for (const shot of queue(before)) {
    expect(after.tick).toBeLessThan(shot.impactTick);
    expect(queue(after).find(pending => pending.id === shot.id)).toEqual(shot);
  }
}

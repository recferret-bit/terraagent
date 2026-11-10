import { describe, expect, it, vi } from 'vitest';
import { createSessionTarget, joinParam, scenarioParam } from './sessionTarget';
import { onlineMode } from './onlineMode';
import { rememberPageAway, type SeatStorage } from './scenarioSeat';

const loc = (search: string) => ({ protocol: 'http:', host: 'x:1', search });
const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

function memoryStorage(): SeatStorage {
  const mem = new Map<string, string>();
  return {
    getItem: (key) => mem.get(key) ?? null,
    setItem: (key, value) => { mem.set(key, value); },
    removeItem: (key) => { mem.delete(key); },
  };
}

describe('session target', () => {
  it('creates the scenario planet once per page load and reuses it on reconnect', async () => {
    let n = 0;
    const f = vi.fn(async () => okJson({ planetId: `pl_${++n}` }));
    const storage = memoryStorage();
    const t = createSessionTarget(loc('?scenario=W00'), f, storage, memoryStorage());
    expect(await t.resolve()).toEqual({ planetId: 'pl_1' });
    expect(await t.resolve()).toEqual({ planetId: 'pl_1' });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith('/v1/dev/scenarios/w00', { method: 'POST' });
    // a page reload before `away`, with no other tab holding the planet, builds a fresh planet
    expect(await createSessionTarget(loc('?scenario=w00'), f, storage, memoryStorage()).resolve()).toEqual({ planetId: 'pl_2' });
  });

  it('a second tab joins the planet the first tab is playing, as the same dev player', async () => {
    const live = memoryStorage();
    const planets = ['pl_live'];
    let n = 0;
    const f = vi.fn(async (url: string) => {
      if (url === '/v1/dev/planets') return okJson({ planets: planets.map((id) => ({ id })) });
      const id = n++ === 0 ? 'pl_live' : `pl_extra_${n}`;
      planets.push(id);
      return okJson({ planetId: id });
    });
    const first = createSessionTarget(loc('?scenario=w09'), f, memoryStorage(), live);
    expect(await first.resolve()).toEqual({ planetId: 'pl_live' });
    const second = createSessionTarget(loc('?scenario=w09'), f, memoryStorage(), live);
    expect(second.accessToken).toBe(first.accessToken);
    expect(await second.resolve()).toEqual({ planetId: 'pl_live' });
    const other = createSessionTarget(loc('?scenario=w09&as=b'), f, memoryStorage(), live);
    expect(other.accessToken).toBe('dev:b');
    expect(await other.resolve()).toEqual({ planetId: 'pl_extra_2' });
    expect(f.mock.calls.filter((call) => String(call[0]).includes('/scenarios/'))).toHaveLength(2);
  });

  it('retries after a failed creation', async () => {
    const f = vi.fn().mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) }).mockResolvedValueOnce(okJson({ planetId: 'pl_9' }));
    const t = createSessionTarget(loc('?scenario=w00'), f);
    await expect(t.resolve()).rejects.toThrow('500');
    expect(await t.resolve()).toEqual({ planetId: 'pl_9' });
  });

  it('falls back to the first loaded planet without ?scenario', async () => {
    const f = vi.fn(async () => okJson({ planets: [{ id: 'pl_A' }] }));
    expect(await createSessionTarget(loc('?host=local'), f).resolve()).toEqual({ planetId: 'pl_A' });
    expect(f).toHaveBeenCalledWith('/v1/dev/planets');
  });

  it('validates the scenario param', () => {
    expect(scenarioParam('?scenario=../x')).toBeNull();
    expect(scenarioParam('?scenario=w00-empty')).toBe('w00-empty');
  });
});

describe('away reload', () => {
  function scenarioFetch(planets: string[]) {
    let n = 0;
    return vi.fn(async (url: string) => {
      if (url === '/v1/dev/planets') return okJson({ planets: planets.map((id) => ({ id })) });
      return okJson({ planetId: `pl_${++n}` });
    });
  }

  it('rejoins the same planet and dev player after away, and a second reload stays on it', async () => {
    const storage = memoryStorage();
    const f = scenarioFetch(['pl_1']);
    const first = createSessionTarget(loc('?scenario=w09'), f, storage);
    expect(await first.resolve()).toEqual({ planetId: 'pl_1' });
    rememberPageAway('?scenario=w09', 'pl_1', first.accessToken, storage);
    const again = createSessionTarget(loc('?scenario=w09'), f, storage);
    expect(again.accessToken).toBe(first.accessToken);
    expect(await again.resolve()).toEqual({ planetId: 'pl_1' });
    expect(await createSessionTarget(loc('?scenario=w09'), f, storage).resolve()).toEqual({ planetId: 'pl_1' });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('?fresh=1 and a different dev name start a new planet', async () => {
    const storage = memoryStorage();
    const f = scenarioFetch(['pl_1', 'pl_2']);
    const first = createSessionTarget(loc('?scenario=w09&as=e2e'), f, storage);
    expect(await first.resolve()).toEqual({ planetId: 'pl_1' });
    rememberPageAway('?scenario=w09&as=e2e', 'pl_1', 'dev:e2e', storage);
    expect((await createSessionTarget(loc('?scenario=w09&fresh=1'), f, storage).resolve()).planetId).toBe('pl_2');
    expect(await createSessionTarget(loc('?scenario=w09&as=other'), f, storage).resolve()).toEqual({ planetId: 'pl_3' });
  });

  it('creates a fresh planet when the remembered one is gone, and still rejoins when the list cannot be read', async () => {
    const storage = memoryStorage();
    const gone = scenarioFetch([]);
    const first = createSessionTarget(loc('?scenario=w09&as=e2e'), gone, storage);
    expect(await first.resolve()).toEqual({ planetId: 'pl_1' });
    rememberPageAway('?scenario=w09', 'pl_1', 'dev:e2e', storage);
    expect(await createSessionTarget(loc('?scenario=w09'), gone, storage).resolve()).toEqual({ planetId: 'pl_2' });

    const kept = memoryStorage();
    const flaky = vi.fn(async (url: string) => {
      if (url === '/v1/dev/planets') return { ok: false, status: 500, json: async () => ({}) };
      return okJson({ planetId: 'pl_9' });
    });
    expect(await createSessionTarget(loc('?scenario=w09&as=e2e'), flaky, kept).resolve()).toEqual({ planetId: 'pl_9' });
    rememberPageAway('?scenario=w09', 'pl_9', 'dev:e2e', kept);
    expect(await createSessionTarget(loc('?scenario=w09'), flaky, kept).resolve()).toEqual({ planetId: 'pl_9' });
    expect(createSessionTarget(loc('?scenario=w09'), flaky, kept).accessToken).toBe('dev:e2e');
  });
});

describe('?join=<planetId>', () => {
  it('joins the given planet without creating one', async () => {
    const calls: string[] = [];
    const t = createSessionTarget({ protocol: 'http:', host: 'x', search: '?scenario=w00&join=pl_01ABC&as=b' }, async (u) => { calls.push(u); return { ok: true, status: 200, json: async () => ({}) }; });
    expect(await t.resolve()).toEqual({ planetId: 'pl_01ABC' });
    expect(calls).toEqual([]);
    expect(t.accessToken).toBe('dev:b');
  });
  it('ignores a malformed id', () => {
    expect(joinParam('?join=bad id')).toBeNull();
    expect(onlineMode('?join=pl_1')).toBe('scenario');
  });
});

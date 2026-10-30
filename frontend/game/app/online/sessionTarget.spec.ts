import { describe, expect, it, vi } from 'vitest';
import { createSessionTarget, scenarioParam } from './sessionTarget';

const loc = (search: string) => ({ protocol: 'http:', host: 'x:1', search });
const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe('session target', () => {
  it('creates the scenario planet once per page load and reuses it on reconnect', async () => {
    let n = 0;
    const f = vi.fn(async () => okJson({ planetId: `pl_${++n}` }));
    const t = createSessionTarget(loc('?scenario=W00'), f);
    expect(await t.resolve()).toEqual({ planetId: 'pl_1' });
    expect(await t.resolve()).toEqual({ planetId: 'pl_1' });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith('/v1/dev/scenarios/w00', { method: 'POST' });
    // a page reload builds a new target: a fresh planet
    expect(await createSessionTarget(loc('?scenario=w00'), f).resolve()).toEqual({ planetId: 'pl_2' });
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

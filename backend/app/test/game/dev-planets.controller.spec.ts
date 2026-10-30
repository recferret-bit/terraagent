import { describe, expect, it } from 'vitest';
import { CoreException } from '../../src/core/errors';
import { DevPlanetsController } from '../../src/game/dev-planets.controller';

const planets = { loadedIds: () => ['pl_A', 'pl_B'] } as never;

describe('DevPlanetsController', () => {
  it('lists the loaded planets outside production', () => {
    expect(new DevPlanetsController(planets, { NODE_ENV: 'development' } as never).list()).toEqual({ planets: [{ id: 'pl_A' }, { id: 'pl_B' }] });
  });
  it('is a 404 in production', () => {
    const c = new DevPlanetsController(planets, { NODE_ENV: 'production' } as never);
    expect(() => c.list()).toThrow(CoreException);
    try { c.list(); } catch (e) { expect((e as CoreException).status).toBe(404); }
  });
});

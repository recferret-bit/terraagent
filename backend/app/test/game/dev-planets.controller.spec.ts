import { describe, expect, it } from 'vitest';
import { DevOnlyGuard } from '../../src/core/dev-only.guard';
import { CoreException } from '../../src/core/errors';
import { DevPlanetsController } from '../../src/game/dev-planets.controller';

const planets = { loadedIds: () => ['pl_A', 'pl_B'] } as never;

describe('DevPlanetsController', () => {
  it('lists the loaded planets outside production', () => {
    expect(new DevPlanetsController(planets).list()).toEqual({ planets: [{ id: 'pl_A' }, { id: 'pl_B' }] });
  });
  it('DevOnlyGuard: 404 in production, passes otherwise', () => {
    expect(new DevOnlyGuard({ NODE_ENV: 'development' } as never).canActivate()).toBe(true);
    const prod = new DevOnlyGuard({ NODE_ENV: 'production' } as never);
    expect(() => prod.canActivate()).toThrow(CoreException);
    try { prod.canActivate(); } catch (e) { expect((e as CoreException).status).toBe(404); }
  });
});

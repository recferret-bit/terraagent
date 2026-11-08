import { expect, it, vi } from 'vitest';
import { CombatHealthTracker } from '../CombatHealthTracker';

it('corrects a predicted death when a current snapshot restores the entity, but ignores stale positive health', () => {
  const die = vi.fn(), revive = vi.fn();
  const health = new CombatHealthTracker(die, revive);
  health.sync(9, accept => accept(1, 100));
  health.dead(1, 10);
  health.sync(9, accept => accept(1, 100));
  expect(health.deaths.has(1)).toBe(true);
  expect(health.hp.get(1)).toBe(0);
  expect(revive).not.toHaveBeenCalled();
  health.sync(10, accept => accept(1, 80));
  expect(health.deaths.has(1)).toBe(false);
  expect(health.hp.get(1)).toBe(80);
  expect(revive).toHaveBeenCalledExactlyOnceWith(1);
  health.sync(11, () => {});
  expect(health.deaths.has(1)).toBe(true);
  health.clear();
  expect(health.hp.size).toBe(0);
  expect(health.deaths.size).toBe(0);
});

it('bounds retired entities while keeping living health and recent death correction', () => {
  const revive = vi.fn();
  const health = new CombatHealthTracker(vi.fn(), revive);
  health.sync(1, accept => accept(1, 100));
  for (let id = 2; id <= 2051; id++) health.dead(id, id);
  expect(health.deaths.size).toBe(2048);
  expect(health.hp.size).toBe(2049);
  expect(health.hp.get(1)).toBe(100);
  expect(health.hp.has(2)).toBe(false);
  health.sync(2050, accept => { accept(1, 100); accept(2051, 80); });
  expect(health.hp.get(2051)).toBe(0);
  expect(revive).not.toHaveBeenCalled();
  health.sync(2051, accept => { accept(1, 100); accept(2051, 80); });
  expect(health.hp.get(2051)).toBe(80);
  expect(revive).toHaveBeenCalledExactlyOnceWith(2051);
});

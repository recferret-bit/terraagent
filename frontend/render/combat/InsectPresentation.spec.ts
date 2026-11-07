import { expect, it, vi } from 'vitest';
import { createArchetypeMesh } from '../kitbash';
import { getInsectAnimator } from '../animation/insects/InsectAnimationController';
import { InsectPresentation } from './InsectPresentation';

it('restored insects cancel corpse disposal and resume animation after a predicted death', () => {
  const presentation = new InsectPresentation(), mesh = createArchetypeMesh('fauna.blackAnt');
  const dispose = vi.fn();
  presentation.track(1, mesh, 20, false);
  presentation.track(1, mesh, 0, false);
  presentation.retire(1, dispose, true);
  presentation.update(0.4);
  presentation.track(1, mesh, 20, true);
  presentation.update(3);
  expect(dispose).not.toHaveBeenCalled();
  expect(getInsectAnimator(mesh)!.state).toBe('moving');
  expect(getInsectAnimator(mesh)!.pose.death).toBe(0);
});

it('a stale alive snapshot does not automatically erase an event-only death', () => {
  const presentation = new InsectPresentation(), mesh = createArchetypeMesh('fauna.blackAnt');
  presentation.track(1, mesh, 20, false);
  presentation.die(1);
  presentation.track(1, mesh, 20, true);
  expect(getInsectAnimator(mesh)!.state).toBe('dying');
  presentation.revive(1);
  presentation.track(1, mesh, 20, true);
  expect(getInsectAnimator(mesh)!.state).toBe('moving');
});

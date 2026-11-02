import { describe, expect, it } from 'vitest';
import { createScenarioPlanet } from '../_loader';

// WE-07: a server-loaded scenario planet carries a hidden-ground salt, so its buried layers differ from what a client
// can rebuild from the public seed.
describe('scenario worldSalt', () => {
  it('stores the salt in meta and changes only the hidden subsurface', () => {
    const plain = createScenarioPlanet('w01', { planetId: 'pl_S' }).host.state;
    const salted = createScenarioPlanet('w01', { planetId: 'pl_S', worldSalt: 'salt-1' }).host.state;
    expect(plain.meta.worldSalt).toBeUndefined();
    expect(salted.meta.worldSalt).toBe('salt-1');
    expect(salted.grid.layers.terrain).toEqual(plain.grid.layers.terrain);
    expect(salted.grid.layers.deposit).toEqual(plain.grid.layers.deposit);
    expect(salted.grid.layers.subDeposit).not.toEqual(plain.grid.layers.subDeposit);
  });
});

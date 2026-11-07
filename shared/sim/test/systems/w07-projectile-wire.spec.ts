import { expect, it } from 'vitest';
import { applyDiff, clone, createState, diffSince } from '../../src';
import { fireProjectile, getProjectileImpactsBlob, stepProjectileImpacts } from '../../src/systems/combat/projectiles';

it('streams every projectile enqueue and removal to an existing client, matching a fresh welcome', () => {
  const server = createState({ planetId: 'projectile-wire', planetType: 'temperate', seed: 'projectile-wire', radius: 8 });
  const shot = (tick: number) => fireProjectile(server, { attackerId: 100, targetId: 101, tick,
    from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, speed: 1, damage: 0, weaponKind: 'acid' });
  shot(0);
  const client = clone(server);
  for (const tick of [1, 5, 6]) {
    const from = server.meta.tick;
    server.meta.tick = tick;
    if (tick === 1) shot(tick);
    else stepProjectileImpacts(server, tick);
    applyDiff(client, diffSince(server, from, { forClient: true }));
    expect(getProjectileImpactsBlob(client)).toEqual(getProjectileImpactsBlob(server));
    expect(getProjectileImpactsBlob(client).queue).toHaveLength(tick === 1 ? 2 : tick === 5 ? 1 : 0);
  }
});

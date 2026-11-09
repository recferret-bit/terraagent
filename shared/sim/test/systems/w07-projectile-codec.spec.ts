import { expect, it } from 'vitest';
import { clone, createState, decodeDiff, decodeValue, diffSince, encodeValue, setBlob, snapshot } from '../../src';
import { packProjectileQueue, unpackProjectileQueue } from '../../src/codec/projectileQueue';
import type { PendingProjectileImpact, ProjectileWeaponKind } from '../../src/systems/combat/projectiles';

function impact(kind: ProjectileWeaponKind): PendingProjectileImpact {
  return { id: 100, attackerId: 10001, attackerOwner: -1, targetId: 10245,
    weaponId: `custom:${kind}`, weaponKind: kind,
    from: { x: 1 / 3, y: -123.456789012345, q: 123, r: -456 },
    to: { x: -0.000000000123, y: 98765.4321098765, q: -999, r: 789 },
    damage: 17.125, speed: 0.001, aoe: 2.75, firedTick: 12345, impactTick: 34567 };
}

it.each(['bullet', 'shell', 'rocket', 'acid'] as const)('losslessly packs every %s field without float narrowing', kind => {
  const blob = { changedAt: 12345, value: { nextProjectileId: 987654, queue: [impact(kind)] } };
  const encoded = encodeValue(packProjectileQueue(blob));
  expect(unpackProjectileQueue(decodeValue(encoded) as ReturnType<typeof packProjectileQueue>)).toEqual(blob);
  expect(encoded.byteLength).toBeLessThan(encodeValue(blob).byteLength);
});

it('preserves optional extension fields on rows and their endpoints', () => {
  const row = { ...impact('acid'), trace: { source: 'fixture', active: false, amount: 0 }, optional: null,
    from: { ...impact('acid').from, height: 1 / 7 }, to: { ...impact('acid').to, material: '' } };
  const blob = { changedAt: 7, value: { nextProjectileId: 101, queue: [row] } };
  expect(unpackProjectileQueue(decodeValue(encodeValue(packProjectileQueue(blob))) as ReturnType<typeof packProjectileQueue>)).toEqual(blob);
});

it('preserves omitted fields from legacy or targetless queued shots without turning undefined into null', () => {
  const row = { ...impact('acid'), targetId: undefined } as unknown as PendingProjectileImpact;
  const blob = { changedAt: 7, value: { nextProjectileId: 101, queue: [row] } };
  expect(unpackProjectileQueue(decodeValue(encodeValue(packProjectileQueue(blob))) as ReturnType<typeof packProjectileQueue>)).toEqual(blob);
});

it('uses compact client diffs while retaining canonical snapshots, internal diffs and decoded state', () => {
  const server = createState({ planetId: 'projectile-codec', planetType: 'temperate', seed: 'projectile-codec', radius: 8 });
  server.meta.tick = 1;
  setBlob(server, 'projectileImpacts', { nextProjectileId: 101, queue: [impact('rocket')] }, 1);
  const before = snapshot(server);
  const packed = diffSince(server, 0, { forClient: true });
  const wire = decodeValue(packed) as { projectileQueue?: unknown; blobs: Record<string, unknown> };
  expect(wire.projectileQueue).toBeDefined();
  expect(wire.blobs.projectileImpacts).toBeUndefined();
  expect(decodeDiff(packed).blobs.projectileImpacts).toEqual(server.blobs.projectileImpacts);
  expect(decodeDiff(diffSince(server, 0)).blobs.projectileImpacts).toEqual(server.blobs.projectileImpacts);
  expect(snapshot(server)).toEqual(before);
  expect(clone(server).blobs.projectileImpacts).toEqual(server.blobs.projectileImpacts);
});

it('rejects unknown packed versions instead of silently decoding an incompatible queue', () => {
  const packed = packProjectileQueue({ changedAt: 1, value: { nextProjectileId: 1, queue: [] } });
  packed[0] = 2 as 1;
  expect(() => unpackProjectileQueue(packed)).toThrow('unsupported projectile queue format 2');
});

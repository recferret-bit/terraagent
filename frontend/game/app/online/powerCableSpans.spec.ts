import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { tileXZ } from '@terra/render/planets/hex';
import { ENTITY_KIND } from '@terra/sim';
import { derivePowerCableSpans, relayTree, type CableNodeSource } from './powerCableSpans';

function node(id: number, kind: number, q: number, r: number, owner = 0): CableNodeSource {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
  const [x, z] = tileXZ(q, r);
  mesh.position.set(x, 0, z);
  return { id, kind, owner, mesh };
}

const HUB = node(1, ENTITY_KIND.commandHub, 0, 0);
const P1 = node(8, ENTITY_KIND.pylon, 3, -1);
const P2 = node(9, ENTITY_KIND.pylon, 6, -1);
const QUARRY = node(12, ENTITY_KIND.mineralsQuarry, 7, 0);

function view(comp: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { colonies: [{ index: 0, power: { components: [{ componentId: 0, ...comp }], ...extra } }] };
}

describe('grid cable layout from synced power components', () => {
  it('wires the relays as a tree from the Hub (2 conductors each) and each building to its nearest relay', () => {
    const spans = derivePowerCableSpans([HUB, P1, P2, QUARRY], view({ entityIds: [1, 8, 9, 12], powered: true }), 0);
    expect(spans).toHaveLength(2 * 2 + 1);
    expect(spans.map((s) => s.state)).toEqual(['online', 'demand', 'online', 'demand', 'demand']);
    // Hub → P1 first, upstream end at the Hub (energy flows outward).
    expect(Math.hypot(spans[0].a[0] - HUB.mesh.position.x, spans[0].a[2] - HUB.mesh.position.z)).toBeLessThan(3);
    // The quarry's drop comes from P2, its nearest relay.
    const drop = spans[4];
    expect(Math.hypot(drop.a[0] - P2.mesh.position.x, drop.a[2] - P2.mesh.position.z)).toBeLessThan(1.2);
    expect(drop.radius).toBeLessThan(spans[0].radius);
  });

  it('shows unpowered grids dark, shed grids as brownout, shed consumers dark and overloaded pylons as overload', () => {
    const recs = [HUB, P1, P2, QUARRY];
    expect(derivePowerCableSpans(recs, view({ entityIds: [1, 8, 9, 12], powered: false }), 0).every((s) => s.state === 'off')).toBe(true);
    const brown = derivePowerCableSpans(recs, view({ entityIds: [1, 8, 9, 12], powered: true, shedEntityIds: [12] }), 0);
    expect(brown.slice(0, 4).every((s) => s.state === 'brownout')).toBe(true);
    expect(brown[4].state).toBe('off');
    const over = derivePowerCableSpans(recs, view({ entityIds: [1, 8, 9, 12], powered: true }, { pylonLoads: { 9: { flow: 90, max: 80, overloaded: true } } }), 0);
    expect(over.slice(0, 2).map((s) => s.state)).toEqual(['online', 'demand']);
    expect(over.slice(2).every((s) => s.state === 'overload')).toBe(true);
  });

  it('draws nothing without components, for other colonies, or for hidden meshes', () => {
    expect(derivePowerCableSpans([HUB, P1], { colonies: [{ index: 0, power: {} }] }, 0)).toEqual([]);
    const foreign = node(20, ENTITY_KIND.pylon, 2, 0, 1);
    expect(derivePowerCableSpans([HUB, foreign], view({ entityIds: [1, 20], powered: true }), 0)).toEqual([]);
    const hidden = node(21, ENTITY_KIND.pylon, 2, 0);
    hidden.mesh.visible = false;
    expect(derivePowerCableSpans([HUB, hidden], view({ entityIds: [1, 21], powered: true }), 0)).toEqual([]);
  });

  it('relayTree is a spanning tree rooted at the Hub', () => {
    const pts = [{ id: 5, x: 10 }, { id: 2, x: 0 }, { id: 3, x: 4 }, { id: 9, x: 6 }];
    const edges = relayTree(pts, (n) => n.id === 2, (a, b) => (a.x - b.x) ** 2);
    expect(edges.map(([p, c]) => `${p.id}>${c.id}`)).toEqual(['2>3', '3>9', '9>5']);
  });
});

it('sends generator pulses into the relay, and relay pulses toward consumers', () => {
  const solar = node(30, ENTITY_KIND.solar, -3, 0);
  const spans = derivePowerCableSpans([HUB, solar, QUARRY], view({ entityIds: [1, 30, 12], powered: true }), 0);
  expect(spans).toHaveLength(2);
  expect(spans[0].a[0]).toBeCloseTo(solar.mesh.position.x + 0.15);
  expect(spans[0].b[0]).toBeCloseTo(HUB.mesh.position.x + 1.35);
  expect(spans[1].a[0]).toBeCloseTo(HUB.mesh.position.x + 1.35);
});

it('raises the span above an intervening building roof', async () => {
  const { clearCableRoofs } = await import('./cableClearance');
  const { cablePoint } = await import('@terra/render/lighting/gridCables/cableGeometry');
  const obstacle = new THREE.Mesh(new THREE.BoxGeometry(2, 8, 2));
  obstacle.position.set(5, 4, 0);
  const span = clearCableRoofs({ a: [0, 3, 0], b: [10, 3, 0], sag: 0.4, radius: 0.03, state: 'online', seed: 0 }, [obstacle]);
  for (let t = 0.4; t <= 0.6; t += 0.01) expect(cablePoint(span, t, new THREE.Vector3()).y).toBeGreaterThan(8.3);
});


it('pairs pylon conductors in opposite directions and colors the request wire yellow', () => {
  const spans = derivePowerCableSpans([HUB, P1], view({ entityIds: [1, 8], powered: true }), 0);
  expect(spans[0].b[0]).toBeGreaterThan(spans[0].a[0]);
  expect(spans[1].b[0]).toBeLessThan(spans[1].a[0]);
  expect(spans.map((s) => s.state)).toEqual(['online', 'demand']);
});

it('turns the solar arc off at night and restores it by day while consumer demand stays yellow', () => {
  const solar = node(30, ENTITY_KIND.solar, -3, 0);
  const records = [HUB, solar, QUARRY];
  const comp = { entityIds: [1, 30, 12], powered: true };
  const night = derivePowerCableSpans(records, view(comp, { phase: 'night', daylight: 0 }), 0);
  expect(night.map((s) => s.state)).toEqual(['off', 'demand']);
  const day = derivePowerCableSpans(records, view(comp, { phase: 'day', daylight: 1 }), 0);
  expect(day.map((s) => s.state)).toEqual(['online', 'demand']);
  expect(derivePowerCableSpans(records, view(comp, { entityPower: { 30: { state: 'offline' } } }), 0)[0].state).toBe('off');
});

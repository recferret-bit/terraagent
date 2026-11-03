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
    expect(spans.every((s) => s.state === 'online')).toBe(true);
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
    expect(over.slice(0, 2).every((s) => s.state === 'online')).toBe(true);
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

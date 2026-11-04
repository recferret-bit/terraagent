import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildCableGeometry, cablePoint, cableSegments, CABLE_CLEARANCE_M, type CableSpan } from './cableGeometry';
import { buildCableArcVertexShader } from './cableArcMaterial';
import { GridCableRenderer } from './GridCableRenderer';
import { pylonCableAnchor } from './cableAnchors';

const span = (over: Partial<CableSpan> = {}): CableSpan => ({
  a: [0, 4, 0], b: [10, 4, 0], sag: 0.6, radius: 0.03, state: 'online', seed: 0.3, ...over,
});

describe('grid cable geometry', () => {
  it('sags by `sag` at mid-span, ends on its anchors, and keeps clear of the ground', () => {
    const p = new THREE.Vector3();
    expect(cablePoint(span(), 0, p).toArray()).toEqual([0, 4, 0]);
    expect(cablePoint(span(), 1, p).toArray()).toEqual([10, 4, 0]);
    expect(cablePoint(span(), 0.5, p).y).toBeCloseTo(3.4);
    expect(cablePoint(span(), 0.5, p, () => 3.5).y).toBeCloseTo(3.5 + CABLE_CLEARANCE_M);
  });

  it('merges every span into one geometry with the arc attributes and per-span ranges', () => {
    const { geometry, ranges } = buildCableGeometry([span(), span({ a: [0, 4, 5], b: [3, 2, 5], state: 'off' })]);
    const n = geometry.getAttribute('position').count;
    expect(ranges).toHaveLength(2);
    expect(ranges[0].count + ranges[1].count).toBe(n);
    expect(ranges[0].count).toBe((cableSegments(10) + 1) * 4);
    const cable = geometry.getAttribute('aCable');
    expect(cable.itemSize).toBe(4);
    expect(cable.getW(0)).toBe(2); // online
    expect(cable.getW(ranges[1].start)).toBe(0); // off
    expect(cable.getY(0)).toBeCloseTo(10); // span length
    expect(geometry.getAttribute('aSide').count).toBe(n);
  });

  it('rebuilds only when the shape changes and patches the state in place otherwise', () => {
    const r = new GridCableRenderer(new THREE.Group());
    r.setSpans([span()]);
    const geo = (r.group.children[0] as THREE.Mesh).geometry;
    r.setSpans([span({ state: 'brownout' })]);
    expect((r.group.children[0] as THREE.Mesh).geometry).toBe(geo);
    expect(geo.getAttribute('aCable').getW(0)).toBe(1);
    r.setSpans([span({ state: 'demand' })]);
    expect((r.group.children[0] as THREE.Mesh).geometry).toBe(geo);
    expect(geo.getAttribute('aCable').getW(0)).toBe(4);
    expect(r.uniforms.uColorDemand.value.r).toBeGreaterThan(r.uniforms.uColorDemand.value.b);
    r.setSpans([span({ state: 'off' })]);
    expect(geo.getAttribute('aCable').getW(0)).toBe(0);
    r.setSpans([span({ b: [12, 4, 0] })]);
    expect((r.group.children[0] as THREE.Mesh).geometry).not.toBe(geo);
    r.update(1.5);
    expect(r.uniforms.uTime.value).toBeCloseTo(1.5);
    r.setSpans([]);
    expect(r.group.visible).toBe(false);
    r.dispose();
  });

  it('hangs pylon cables from the insulator cap on the side facing the other end', () => {
    const right = pylonCableAnchor(0, 1);
    const left = pylonCableAnchor(0, -1);
    expect(right[0]).toBeGreaterThan(0);
    expect(left[0]).toBe(-right[0]);
    expect(pylonCableAnchor(1, 1)[1]).toBeGreaterThan(right[1]);
    expect(pylonCableAnchor(0, 1, 0.18)[1]).toBeCloseTo(right[1] - 0.18);
  });

  it('composes the arc shader from its named chunks', () => {
    const vs = buildCableArcVertexShader();
    for (const fn of ['arcHash', 'arcStateParams', 'arcPacket', 'void main']) expect(vs).toContain(fn);
  });
});

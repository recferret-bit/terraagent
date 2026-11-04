import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { CableSpan } from '@terra/render/lighting/gridCables';
import { clearCableRoofs, MAX_LIFT_M } from './cableClearance';

const span = (len: number): CableSpan => ({ a: [0, 3, 0], b: [len, 3, 0], sag: -0.1, radius: 0.03, state: 'online', seed: 0.5 });
const box = (x: number, h: number): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(2, h, 2));
  m.position.set(x, h / 2, 0);
  return m;
};

describe('clearCableRoofs on short spans', () => {
  it('a tall neighbour hugging the anchor no longer launches the wire into the sky', () => {
    const s = clearCableRoofs(span(1.5), [box(0.2, 8)]);
    expect(-s.sag).toBeLessThanOrEqual(0.6 * 1.5 + 1e-9);
    expect(Number.isFinite(s.sag)).toBe(true);
  });
  it('never exceeds the height cap, even on long spans', () => {
    const s = clearCableRoofs(span(40), [box(20, 60), box(0, 60)]);
    expect(-s.sag).toBeLessThanOrEqual(MAX_LIFT_M);
  });
  it('still clears a normal roof on a mid span', () => {
    const s = clearCableRoofs(span(12), [box(6, 4.5)]);
    expect(-s.sag).toBeGreaterThan(0.3);
  });
});

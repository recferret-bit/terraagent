import * as THREE from 'three';

export const smoother = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * t * (t * (t * 6 - 15) + 10); };
/** Quintic window: 0 before `a`, 1 after `b`. */
export const win = (a: number, b: number, x: number) => smoother((x - a) / (b - a));

export const slerpDir = (a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3) => {
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1), th = Math.acos(dot);
  if (th < 1e-4) return out.copy(a).lerp(b, t).normalize();
  const sa = Math.sin((1 - t) * th) / Math.sin(th), sb = Math.sin(t * th) / Math.sin(th);
  return out.set(a.x * sa + b.x * sb, a.y * sa + b.y * sb, a.z * sa + b.z * sb).normalize();
};

export const bez = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, t: number, out: THREE.Vector3) => {
  const u = 1 - t;
  return out.copy(a).multiplyScalar(u * u * u).addScaledVector(b, 3 * u * u * t).addScaledVector(c, 3 * u * t * t).addScaledVector(d, t * t * t);
};

/** Rotation taking frame (x1,y1,x1×y1) to (x2,y2,x2×y2). */
export const frameRot = (x1: THREE.Vector3, y1: THREE.Vector3, x2: THREE.Vector3, y2: THREE.Vector3) => {
  const m1 = new THREE.Matrix4().makeBasis(x1, y1, x1.clone().cross(y1));
  const m2 = new THREE.Matrix4().makeBasis(x2, y2, x2.clone().cross(y2));
  return new THREE.Quaternion().setFromRotationMatrix(m2.multiply(m1.transpose()));
};

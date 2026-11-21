import * as THREE from 'three';
import type { PartDef } from '../../kitbash/validate/types';
import { vertebratePartMatrix } from './pose';
import type { VertebratePartInput, VertebratePose, VertebrateRigConfig } from './types';

export function vertebrateValidationStates(config: VertebrateRigConfig): Array<{ label: string; pose: VertebratePose }> {
  const base: VertebratePose = { time: 0, walk: 0, run: 0, work: 0, sleep: 0, config };
  const out: Array<{ label: string; pose: VertebratePose }> = [];
  const stepPeriod = (Math.PI * 2) / Math.max(0.5, config.gaitFreq);

  if (config.isBird > 0.5) {
    for (let i = 0; i < 4; i++) {
      out.push({ label: `bird glide ${i}`, pose: { ...base, time: i * 0.4, walk: 0.16 } });
    }
    for (let i = 0; i < 16; i++) {
      out.push({ label: `bird flap ${i}`, pose: { ...base, time: (i / 16) * stepPeriod, walk: 1 } });
    }
    return out;
  }

  for (let i = 0; i < 4; i++) {
    out.push({ label: `mammal idle ${i}`, pose: { ...base, time: i * 0.7 } });
  }
  for (let i = 0; i < 16; i++) {
    out.push({ label: `mammal walk ${i}`, pose: { ...base, time: (i / 16) * stepPeriod, walk: 1 } });
  }
  for (let i = 0; i < 12; i++) {
    out.push({ label: `mammal run ${i}`, pose: { ...base, time: (i / 12) * stepPeriod, walk: 1, run: 1 } });
  }
  for (let i = 0; i <= 4; i++) {
    const u = i / 4;
    out.push({ label: `mammal graze ${i}`, pose: { ...base, time: u * 0.6, work: u } });
    out.push({ label: `mammal sleep ${i}`, pose: { ...base, time: u * 0.5, sleep: u } });
  }
  return out;
}

export function vertebratePartPoses(part: PartDef): Array<{ label: string; tris: Float32Array }> {
  const rig: VertebratePartInput = part.vertRig ?? {
    role: 1,
    pivot: part.pivot,
    joint: part.pivot,
    tip: [part.pivot[0], 0.02, part.pivot[2]],
    meta: 0,
  };
  const config = part.vertConfig!;
  const point = new THREE.Vector3();
  return vertebrateValidationStates(config).map(({ label, pose }) => {
    const matrix = vertebratePartMatrix(rig, pose);
    const tris = new Float32Array(part.tris.length);
    for (let i = 0; i < tris.length; i += 3) {
      point.fromArray(part.tris, i).applyMatrix4(matrix);
      tris.set(point.toArray(), i);
    }
    return { label, tris };
  });
}

import * as THREE from 'three';
import { validateArchetype, type Report } from '@terra/render/kitbash/validate';
import { textSprite } from '../stage/textSprite';
import type { Spawn } from './SpawnSet';

export const VAL_LIST_MAX = 14;
const SEV_COLOR = { error: 0xff3b3b, warn: 0xffb020, info: 0x39d0ff } as const;

/** Model validation overlay (skill: model-geometry-validator): outlines offending parts and numbers the issues on the model. */
export class ValidationOverlay {
  private cache = new Map<string, Report>();
  private group: THREE.Group | null = null;

  report(id: string, enabled: boolean): Report | null {
    if (!enabled || !id) return null;
    if (!this.cache.has(id)) { try { this.cache.set(id, validateArchetype(id)); } catch (e) { console.error('validate failed', e); return null; } }
    return this.cache.get(id)!;
  }

  /** Outline every part that an error/warning is about (red = error, amber = warning) and number the issues. */
  apply(r: Report | null, spawn: Spawn | undefined) {
    this.group?.removeFromParent(); this.group = null;
    if (!r || !spawn) return;
    const g = new THREE.Group(); g.name = 'validation';
    this.addOutlines(g, r);
    this.addLabels(g, r);
    spawn.mesh.add(g); this.group = g;
  }

  private addOutlines(g: THREE.Group, r: Report) {
    const strongest = new Map<number, 'error' | 'warn'>();
    r.issues.filter((it) => it.severity !== 'info').slice(0, VAL_LIST_MAX).forEach((it) => { for (const pi of it.parts) if (strongest.get(pi) !== 'error') strongest.set(pi, it.severity as 'error' | 'warn'); });
    for (const [pi, sev] of strongest) {
      const b = r.parts.find((x) => x.index === pi)?.box; if (!b) continue;
      const h = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5])), SEV_COLOR[sev]);
      const m = h.material as THREE.LineBasicMaterial; m.depthTest = false; m.transparent = true; m.opacity = 0.95; h.renderOrder = 900;
      g.add(h);
    }
  }

  private addLabels(g: THREE.Group, r: Report) {
    let n = 0;
    for (const it of r.issues) {
      if (it.severity === 'info') continue;
      n++;
      if (n > VAL_LIST_MAX) break;       // the info-panel list is capped the same way: numbers on the model always have an entry
      if (!it.parts.length) continue;    // model-wide issues (TRI_BUDGET, FEW_PARTS) have no place in 3D
      const bb = r.parts.find((x) => x.index === it.parts[0])?.box;
      const at = it.at ?? (bb ? [(bb[0] + bb[3]) / 2, bb[4], (bb[2] + bb[5]) / 2] : [0, 0, 0]);
      const lbl = textSprite(String(n), it.severity === 'error' ? '#ff6b6b' : '#ffcf5a');
      lbl.scale.multiplyScalar(0.5); lbl.position.set(at[0], at[1] + 0.12, at[2]);
      (lbl.material as THREE.SpriteMaterial).depthTest = false; lbl.renderOrder = 901;
      g.add(lbl);
    }
  }
}

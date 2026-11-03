import * as THREE from 'three';
import { inViewFocus } from '../core/viewFocus';
import { ParticlePresetRegistry } from './ParticlePresetRegistry';
import type { ActiveWorkSiteInput } from './types';
import { WorkParticleEmitter } from './WorkParticleEmitter';

/** Reach (m) of a work site's particles and tool beams around its target (debris arcs, the bot standing next to it). */
export const WORK_PARTICLE_FOCUS_PAD_M = 6;

export class WorkParticleSystem {
  readonly group = new THREE.Group();
  private readonly activeByWorker = new Map<string, WorkParticleEmitter>();
  private readonly dying: WorkParticleEmitter[] = [];
  private burstCounter = 0;

  constructor(parent?: THREE.Object3D) {
    this.group.name = 'WorkParticleSystem';
    parent?.add(this.group);
  }

  private readonly seen = new Set<string>();

  syncSites(sites: readonly ActiveWorkSiteInput[]): void {
    const seen = this.seen; // called every frame: reuse the set
    seen.clear();
    for (const site of sites) {
      if ((site.intensity ?? 1) <= 0.02) continue;
      seen.add(site.workerId);
      const preset =
        (site.presetId ? ParticlePresetRegistry.get(site.presetId) : undefined) ??
        ParticlePresetRegistry.getByTargetKind(site.targetKind);

      const existing = this.activeByWorker.get(site.workerId);
      if (existing && existing.preset.id === preset.id) {
        existing.updateSite(site);
        continue;
      }
      if (existing) {
        existing.setInactive();
        this.dying.push(existing);
      }
      const next = new WorkParticleEmitter(preset, site);
      this.group.add(next.group);
      this.activeByWorker.set(site.workerId, next);
    }

    for (const [workerId, emitter] of this.activeByWorker) {
      if (!seen.has(workerId)) {
        emitter.setInactive();
        this.dying.push(emitter);
        this.activeByWorker.delete(workerId);
      }
    }
  }

  emitCompletionBurst(
    site: Omit<ActiveWorkSiteInput, 'workerId'> & { workerId?: string },
    durationSeconds = 0.95,
  ): void {
    const preset =
      (site.presetId ? ParticlePresetRegistry.get(site.presetId) : undefined) ??
      ParticlePresetRegistry.getByTargetKind(site.targetKind);
    const fullSite: ActiveWorkSiteInput = {
      ...site,
      workerId: site.workerId ?? `burst:${++this.burstCounter}`,
      intensity: 1,
    };
    const emitter = new WorkParticleEmitter(preset, fullSite);
    emitter.triggerBurst(durationSeconds);
    emitter.setInactive();
    this.group.add(emitter.group);
    this.dying.push(emitter);
  }

  /**
   * Steps the emitters. An emitter whose work site lies outside the view focus (`core/viewFocus.ts`, camera footprint
   * plus margin) is hidden and not simulated; it resumes from where it stopped when the camera comes back (the focus
   * margin keeps that off-screen). A fading emitter that is off the focus is dropped at once.
   */
  update(dt: number): void {
    for (const emitter of this.activeByWorker.values()) {
      if (!this.showIfInFocus(emitter)) continue;
      emitter.step(dt);
    }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const emitter = this.dying[i];
      const stillAlive = this.showIfInFocus(emitter) && emitter.step(dt);
      if (!stillAlive) {
        this.group.remove(emitter.group);
        emitter.dispose();
        this.dying.splice(i, 1);
      }
    }
  }

  private showIfInFocus(emitter: WorkParticleEmitter): boolean {
    emitter.group.visible = inViewFocus(emitter.targetX, emitter.targetZ, WORK_PARTICLE_FOCUS_PAD_M);
    return emitter.group.visible;
  }

  getActiveCount(): number {
    return this.activeByWorker.size + this.dying.length;
  }

  clear(): void {
    for (const emitter of this.activeByWorker.values()) {
      this.group.remove(emitter.group);
      emitter.dispose();
    }
    this.activeByWorker.clear();
    for (const emitter of this.dying) {
      this.group.remove(emitter.group);
      emitter.dispose();
    }
    this.dying.length = 0;
  }

  dispose(): void {
    this.clear();
    this.group.removeFromParent();
  }
}

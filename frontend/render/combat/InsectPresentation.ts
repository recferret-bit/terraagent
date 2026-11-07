import * as THREE from 'three';
import { getInsectAnimator, type InsectActionView, type InsectAnimationController } from '../animation/insects/InsectAnimationController';

interface Entry {
  mesh: THREE.Object3D; animator: InsectAnimationController; hp: number;
  dispose?: () => void; pendingRemoval: number; releaseTick: number;
}
/** Owns animation lifetimes, including the brief corpse after the sim removes an insect. */
export class InsectPresentation {
  private readonly entries = new Map<number, Entry>();
  private actions: Record<number, InsectActionView> = {};
  private tick = 0;

  track(id: number, mesh: THREE.Object3D, hp: number, moving: boolean): void {
    const animator = getInsectAnimator(mesh);
    if (!animator) return;
    let entry = this.entries.get(id);
    if (entry?.mesh !== mesh) {
      entry?.dispose?.();
      entry = { mesh, animator, hp, pendingRemoval: 0, releaseTick: -1 };
      this.entries.set(id, entry);
    }
    if (hp > 0 && (entry.hp <= 0 || entry.dispose)) this.revive(id);
    if (hp < entry.hp && hp > 0) animator.hit();
    if (hp <= 0) animator.die();
    entry.hp = hp;
    animator.setMoving(moving);
    if (this.tick >= entry.releaseTick) animator.sync(this.actions[id], this.tick);
  }

  sync(raw: unknown, tick: number): void {
    const slot = raw as { value?: unknown } | undefined;
    const data = (slot?.value ?? raw) as { byEntityId?: Record<number, InsectActionView> } | undefined;
    this.actions = data?.byEntityId ?? {};
    this.tick = tick;
    for (const [id, entry] of this.entries) {
      if (tick >= entry.releaseTick) entry.animator.sync(this.actions[id], tick);
    }
  }

  /** Events may arrive before their matching snapshot. Sample the release pose immediately. */
  release(id: number, tick: number, targetId?: number): void {
    const entry = this.entries.get(id);
    if (!entry || tick < entry.releaseTick || tick < this.tick) return;
    entry.releaseTick = tick;
    entry.animator.sync({ state: 'attack', startedTick: tick, durationTicks: 1, targetId }, tick);
  }

  hit(id: number): void { this.entries.get(id)?.animator.hit(); }
  die(id: number): void { this.entries.get(id)?.animator.die(); }
  /** Cancel corpse disposal when corrected state restores the entity. */
  revive(id: number): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.dispose = undefined;
    entry.pendingRemoval = 0;
    entry.releaseTick = -1;
    entry.animator.revive();
  }
  /** Allow an event arriving just after a snapshot to confirm death; visibility loss is not a death. */
  retire(id: number, dispose: () => void, confirmed = false): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.dispose = dispose;
    entry.pendingRemoval = 0.3;
    entry.animator.setMoving(false);
    if (confirmed) entry.animator.die();
    return true;
  }

  update(dt: number): void {
    for (const [id, entry] of this.entries) {
      entry.animator.update(dt);
      if (!entry.dispose) continue;
      entry.pendingRemoval -= dt;
      const dead = entry.animator.state === 'dying' || entry.animator.state === 'dead';
      if (dead ? entry.animator.corpseDone : entry.pendingRemoval <= 0) {
        entry.dispose();
        this.entries.delete(id);
      }
    }
  }
  snapshots(): Array<{ id: number; state: string; phase: number; retired: boolean }> {
    return [...this.entries].map(([id, e]) => ({ id, state: e.animator.state, phase: e.animator.phase, retired: !!e.dispose }));
  }
  clear(): void {
    for (const entry of this.entries.values()) entry.dispose?.();
    this.entries.clear(); this.actions = {};
  }
}

/** Contract weapon types historically label instant melee as laser; anatomy determines presentation. */
export function isInsectMelee(weaponId?: string): boolean {
  return weaponId === 'antBite' || weaponId === 'beetleBite' || weaponId === 'mandibleBite' || weaponId === 'hornGore';
}

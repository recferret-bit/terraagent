import * as THREE from 'three';
import { isInsectMelee } from './InsectPresentation';
import type { BattlePresentation } from './BattlePresentation';
import type { ProjectileVfxSystem } from '../visuals/projectiles/ProjectileVfxSystem';
import type { ProjectileFiredVfxInput } from '../visuals/projectiles/types';

interface ScheduledBurstRound {
  attackerId: number;
  targetId?: number;
  weaponId?: string;
  to: THREE.Vector3;
  speed?: number;
  delayS: number;
  ageS: number;
  heatGain: number;
  targetIsInsect: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);

function hashFloat(seed: number): number {
  const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Computes realistic per-shell angular dispersion offsets around `(to - from)`
 * so every shell in a multi-round burst travels along a noticeably distinct ray.
 */
export function computeBurstSpreadTargets(
  from: { x: number; y: number; z?: number },
  to: { x: number; y: number; z?: number },
  count: number,
  seed: number,
): THREE.Vector3[] {
  const f = new THREE.Vector3(from.x, from.y, from.z ?? 0);
  const t = new THREE.Vector3(to.x, to.y, to.z ?? 0);
  const dir = t.clone().sub(f);
  const dist = Math.max(0.5, dir.length());
  dir.divideScalar(dist);
  const right = new THREE.Vector3().crossVectors(dir, UP);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  else right.normalize();
  const up = new THREE.Vector3().crossVectors(right, dir).normalize();

  const out: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const h1 = hashFloat(seed * 19.3 + i * 7.1 + 1.3) * 2 - 1;
    const h2 = hashFloat(seed * 37.7 + i * 13.7 + 5.9) * 2 - 1;
    // Fixed angular cone (~0.028..0.068 rad) scaled with distance so burst shells cleanly diverge
    const patternX = (i === 0 ? -0.042 : i === 1 ? 0.045 : -0.012) + h1 * 0.016;
    const patternY = (i === 0 ? 0.015 : i === 1 ? -0.026 : 0.036) + h2 * 0.014;
    const pt = t.clone()
      .addScaledVector(right, patternX * dist)
      .addScaledVector(up, patternY * dist);
    pt.y = Math.max(0.08, pt.y);
    out.push(pt);
  }
  return out;
}

/**
 * Shared coordinator for turret alignment checks, 3-round Recon bursts with spread + cartridge
 * ejection, and insect death explosion wiring across both Online gameplay and the Playground.
 */
export class CombatShotCoordinator {
  private readonly bursts: ScheduledBurstRound[] = [];

  constructor(
    readonly battle: BattlePresentation,
    readonly projectiles: ProjectileVfxSystem,
    readonly meshForEntity: (id: number) => THREE.Object3D | undefined,
  ) {
    this.battle.insects.onDeath = ({ mesh, at, groundY }) => {
      const s = Math.max(0.75, Math.min(1.4, mesh.scale.x || 1));
      this.projectiles.emitInsectDeath({ at, groundY, scale: s });
    };
  }

  /**
   * Returns `false` if the shooter currently has a slewed turret rig that is NOT yet aligned
   * on the same line as `target` (never teleports; caller holds the shot briefly until aligned).
   */
  isReadyToFire(attackerId: number, input: ProjectileFiredVfxInput): boolean {
    const rig = this.battle.getRig(attackerId);
    if (!rig || !rig.hasSlewed) return true;
    return this.battle.prepareShot(attackerId, input);
  }

  dispatchShot(
    attackerId: number,
    input: ProjectileFiredVfxInput,
    opts?: { burstSeed?: number },
  ): void {
    const shot = this.battle.shot(attackerId, input);
    if (isInsectMelee(shot.weaponId)) return;

    const wid = shot.weaponId?.toLowerCase() ?? '';
    if (wid === 'recongun') {
      const seed = opts?.burstSeed ?? (attackerId * 31 + (shot.firedTick ?? 1));
      const targets = computeBurstSpreadTargets(shot.from, shot.to, 3, seed);
      const t0 = targets[0]!;
      const rig = this.battle.getRig(attackerId);
      this.projectiles.onProjectileFired({
        ...shot,
        to: t0,
        ejectCartridge: true,
        direction: () => {
          const cur = rig ? rig.muzzle() : new THREE.Vector3(shot.from.x, shot.from.y, shot.from.z ?? 0);
          return t0.clone().sub(cur).normalize();
        },
      });
      const targetMesh = shot.targetId === undefined ? undefined : this.meshForEntity(shot.targetId);
      const targetArch = (targetMesh?.userData as { archetypeId?: string } | undefined)?.archetypeId ?? targetMesh?.name ?? '';
      const targetIsInsect = targetArch.startsWith('fauna.') && !targetArch.startsWith('fauna.hive.');
      const speed = shot.speed ?? 38;
      for (let r = 1; r < targets.length; r++) {
        this.bursts.push({
          attackerId,
          targetId: shot.targetId,
          weaponId: shot.weaponId,
          to: targets[r]!,
          speed,
          delayS: r * 0.068,
          ageS: 0,
          heatGain: 0.30,
          targetIsInsect,
        });
      }
      return;
    }

    this.projectiles.onProjectileFired(shot);
  }

  update(dtSeconds: number): void {
    if (dtSeconds <= 0) return;
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const round = this.bursts[i]!;
      round.ageS += dtSeconds;
      if (round.ageS < round.delayS) continue;
      this.bursts.splice(i, 1);

      const shooterMesh = this.meshForEntity(round.attackerId);
      const rig = this.battle.getRig(round.attackerId);
      if (!shooterMesh || !rig) continue;

      const fired = rig.triggerFire(true, round.heatGain);
      const eject = rig.ejectOrigin(fired.barrel);
      const from = fired.from;
      const to = round.to;
      const dir = to.clone().sub(from).normalize();
      this.projectiles.onProjectileFired({
        weaponKind: 'bullet',
        weaponType: 'bullet',
        weaponId: round.weaponId ?? 'reconGun',
        arc: 'direct',
        from,
        to,
        speed: round.speed,
        targetId: round.targetId,
        targetIsInsect: round.targetIsInsect,
        autoImpactOnArrival: true,
        ejectCartridge: true,
        ejectFrom: eject.pos,
        ejectGroundY: eject.groundY,
        source: () => rig.muzzle(fired.barrel),
        direction: () => dir,
      });
      if (round.targetIsInsect && round.targetId !== undefined) {
        this.battle.insects.hit(round.targetId);
      }
    }
  }

  clear(): void {
    this.bursts.length = 0;
  }
}

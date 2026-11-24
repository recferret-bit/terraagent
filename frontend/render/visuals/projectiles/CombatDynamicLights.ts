import { setDynamicLightChannel, type ColonyProjectorDesc } from '../../lighting/ColonyVisionAndLights';
import type { ProjectileVfxPools } from './pools';

const MAX_COMBAT_DYNAMIC_LIGHTS = 18;

interface TransientCombatLight {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  range: number;
  intensity: number;
  ageS: number;
  durationS: number;
}

/**
 * Tracks transient muzzle flashes, explosions, and active beam/projectile/death point lights
 * and uploads them each frame on a scoped `ColonyVisionAndLights` dynamic light channel.
 */
export class CombatDynamicLights {
  private readonly transients: TransientCombatLight[] = [];

  constructor(
    private readonly channel: string,
    private readonly enabled: boolean,
  ) {}

  push(
    x: number,
    y: number,
    z: number,
    r: number,
    g: number,
    b: number,
    range: number,
    intensity: number,
    durationS: number,
  ): void {
    if (!this.enabled) return;
    if (this.transients.length >= 24) this.transients.shift();
    this.transients.push({
      x, y, z, r, g, b, range, intensity, ageS: 0, durationS: Math.max(0.05, durationS),
    });
  }

  step(dtSeconds: number): void {
    for (let i = this.transients.length - 1; i >= 0; i--) {
      const tl = this.transients[i]!;
      tl.ageS += dtSeconds;
      if (tl.ageS >= tl.durationS) this.transients.splice(i, 1);
    }
  }

  sync(pools: ProjectileVfxPools): void {
    if (!this.enabled) return;
    const lights: ColonyProjectorDesc[] = [];
    for (const l of pools.lasers) {
      if (!l.active || lights.length >= MAX_COMBAT_DYNAMIC_LIGHTS) continue;
      const fade = Math.max(0.15, 1 - l.ageS / l.durationS);
      const lenSq = (l.toX - l.fromX) ** 2 + (l.toY - l.fromY) ** 2 + (l.toZ - l.fromZ) ** 2;
      lights.push({
        x: (l.fromX + l.toX) * 0.5,
        y: (l.fromY + l.toY) * 0.5 + 0.12,
        z: (l.fromZ + l.toZ) * 0.5,
        range: 7.8, dirX: 0, dirY: -1, dirZ: 0, cosAngle: -1,
        r: 0.25, g: 0.92, b: 1.0, intensity: 3.3 * fade,
      });
      if (lenSq > 9 && lights.length < MAX_COMBAT_DYNAMIC_LIGHTS) {
        lights.push({
          x: l.toX, y: l.toY + 0.18, z: l.toZ,
          range: 6.4, dirX: 0, dirY: -1, dirZ: 0, cosAngle: -1,
          r: 0.35, g: 0.96, b: 1.0, intensity: 3.0 * fade,
        });
      }
    }
    const heavyProjectiles = [];
    const lightProjectiles = [];
    for (const p of pools.projectiles) {
      if (!p.active) continue;
      if (p.weaponKind === 'shell' || p.weaponKind === 'rocket' || p.scale >= 1.5) heavyProjectiles.push(p);
      else lightProjectiles.push(p);
    }
    for (const p of [...heavyProjectiles, ...lightProjectiles]) {
      if (lights.length >= MAX_COMBAT_DYNAMIC_LIGHTS) break;
      const isShell = p.weaponKind === 'shell';
      const isRocket = p.weaponKind === 'rocket';
      const isAcid = p.weaponKind === 'acid';
      const isHeavyBullet = p.weaponKind === 'bullet' && p.scale >= 1.5;
      const range = isShell ? 7.2 : isRocket ? 6.8 : isHeavyBullet ? 6.2 : isAcid ? 4.6 : 4.6 * Math.min(1.5, Math.max(0.8, p.scale));
      const intensity = isShell ? 3.1 : isRocket ? 2.9 : isHeavyBullet ? 2.6 : isAcid ? 1.6 : 1.8 * Math.min(1.4, Math.max(0.8, p.scale));
      const r = isAcid ? 0.48 : 1.0;
      const g = isAcid ? 1.0 : isShell ? 0.52 : isRocket ? 0.56 : 0.72;
      const b = isAcid ? 0.20 : isShell || isRocket ? 0.14 : 0.24;
      lights.push({
        x: p.x, y: p.y + 0.16, z: p.z, range,
        dirX: 0, dirY: -1, dirZ: 0, cosAngle: -1, r, g, b, intensity,
      });
    }
    const ranked = this.transients
      .map((tl) => {
        const fade = Math.max(0, 1 - tl.ageS / tl.durationS);
        const env = fade * fade;
        return { tl, env, power: tl.intensity * env };
      })
      .filter(entry => entry.env > 0.01)
      .sort((a, b) => b.power - a.power);
    for (const { tl, env } of ranked) {
      if (lights.length >= MAX_COMBAT_DYNAMIC_LIGHTS) break;
      lights.push({
        x: tl.x, y: tl.y, z: tl.z, range: tl.range,
        dirX: 0, dirY: -1, dirZ: 0, cosAngle: -1,
        r: tl.r, g: tl.g, b: tl.b, intensity: tl.intensity * env,
      });
    }
    setDynamicLightChannel(this.channel, lights);
  }

  clear(): void {
    this.transients.length = 0;
    if (this.enabled) setDynamicLightChannel(this.channel, []);
  }
}

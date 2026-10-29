// .agents/skills/planetary-lighting-and-lightning/examples/PlanetaryLightingSystem.ts
import * as THREE from 'three';

export interface WeatherAtmospherePreset {
  sunMultiplier: number;
  fogDensity: number;
  fogTint: number;
  skyTint: number;
}

export class WeatherPresetRegistry {
  private static presets = new Map<string, WeatherAtmospherePreset>([
    ['clear',             { sunMultiplier: 1.00, fogDensity: 0.007, fogTint: 0xe09f7d, skyTint: 0xf4a261 }],
    ['sandstorm',         { sunMultiplier: 0.42, fogDensity: 0.022, fogTint: 0xc27155, skyTint: 0xb5654d }],
    ['blizzard',          { sunMultiplier: 0.48, fogDensity: 0.020, fogTint: 0xc8ddf2, skyTint: 0x90b8e0 }],
    ['lightningStorm',    { sunMultiplier: 0.35, fogDensity: 0.015, fogTint: 0x2b3648, skyTint: 0x3b4d6b }],
    ['radiationAnomaly',  { sunMultiplier: 0.55, fogDensity: 0.016, fogTint: 0x22382c, skyTint: 0x10b981 }],
  ]);

  public static register(name: string, preset: WeatherAtmospherePreset): void {
    this.presets.set(name, preset);
  }

  public static get(name: string): WeatherAtmospherePreset {
    return this.presets.get(name) ?? this.presets.get('clear')!;
  }
}

interface PooledLightLease {
  light: THREE.PointLight;
  age: number;
  duration: number;
  peakIntensity: number;
}

/**
 * Manages the orbital day/night cycle, texel-quantized shadow frustum tracking,
 * weather state transitions, sky lightning flashes, and a zero-recompilation PointLight pool.
 */
export class PlanetaryLightingSystem {
  public readonly sunLight: THREE.DirectionalLight;
  public readonly hemiLight: THREE.HemisphereLight;
  public readonly fog: THREE.FogExp2;

  private readonly lightPool: PooledLightLease[] = [];
  private readonly sunOffset = new THREE.Vector3(35, 55, 25);

  private currentWeather: WeatherAtmospherePreset;
  private targetWeather: WeatherAtmospherePreset;
  private weatherBlend = 1.0;

  private skyFlashAge = 999;
  private skyFlashDuration = 0.24;

  /** Current gameplay Solar Station efficiency (0.0 at night -> 1.0 at noon, scaled by weather) */
  public solarEfficiency = 1.0;

  constructor(private readonly scene: THREE.Scene, poolSize = 8) {
    this.currentWeather = WeatherPresetRegistry.get('clear');
    this.targetWeather = this.currentWeather;

    this.fog = new THREE.FogExp2(this.currentWeather.fogTint, this.currentWeather.fogDensity);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(this.currentWeather.fogTint);

    this.hemiLight = new THREE.HemisphereLight(this.currentWeather.skyTint, 0x3b4d3b, 0.85);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff5e4, 3.2);
    this.sunLight.position.copy(this.sunOffset);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 5;
    this.sunLight.shadow.camera.far = 150;
    const d = 36;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Pre-allocate fixed PointLight pool so shaders never recompile at runtime
    for (let i = 0; i < poolSize; i++) {
      const pt = new THREE.PointLight(0x00f0ff, 0, 18, 1.8);
      pt.castShadow = false;
      this.scene.add(pt);
      this.lightPool.push({ light: pt, age: 0, duration: 0, peakIntensity: 0 });
    }
  }

  public setWeather(presetName: string): void {
    this.targetWeather = WeatherPresetRegistry.get(presetName);
    this.weatherBlend = 0.0;
  }

  /**
   * Leases a pre-allocated PointLight for explosions, mining lasers, or lightning hits.
   */
  public spawnDynamicFlash(
    position: THREE.Vector3,
    colorHex: number,
    peakIntensity = 12.0,
    distance = 20.0,
    duration = 0.25
  ): void {
    // Find an inactive light or steal the oldest one
    let chosen = this.lightPool.find((slot) => slot.duration === 0);
    if (!chosen) {
      chosen = this.lightPool.reduce((a, b) => (a.age > b.age ? a : b));
    }
    chosen.light.position.copy(position);
    chosen.light.color.setHex(colorHex);
    chosen.light.distance = distance;
    chosen.light.intensity = peakIntensity;
    chosen.age = 0;
    chosen.duration = duration;
    chosen.peakIntensity = peakIntensity;
  }

  /**
   * Triggers a double-stroke atmospheric sky lightning flash.
   */
  public triggerSkyFlash(duration = 0.24): void {
    this.skyFlashAge = 0;
    this.skyFlashDuration = duration;
  }

  /**
   * Updates orbital sun position, quantized shadow frustum, weather transitions, and pooled flashes.
   * @param dt Delta time in seconds
   * @param cameraTarget World-space ground point the RTS camera is looking at
   * @param orbitalPhase Normalized planetary time-of-day [0..1] (default: 0.22 bright morning)
   */
  public update(dt: number, cameraTarget: THREE.Vector3, orbitalPhase = 0.22): void {
    // 1. Weather state interpolation
    if (this.weatherBlend < 1.0) {
      this.weatherBlend = Math.min(1.0, this.weatherBlend + dt * 0.4);
    }
    const sunMult = THREE.MathUtils.lerp(
      this.currentWeather.sunMultiplier,
      this.targetWeather.sunMultiplier,
      this.weatherBlend
    );
    this.fog.density = THREE.MathUtils.lerp(
      this.currentWeather.fogDensity,
      this.targetWeather.fogDensity,
      this.weatherBlend
    );
    this.fog.color.lerpColors(
      new THREE.Color(this.currentWeather.fogTint),
      new THREE.Color(this.targetWeather.fogTint),
      this.weatherBlend
    );
    if (this.weatherBlend >= 1.0) {
      this.currentWeather = this.targetWeather;
    }

    // 2. Orbital Solar Elevation & Color Temperature
    const angle = orbitalPhase * Math.PI * 2;
    const elevation = Math.sin(angle); // -1 (midnight) to +1 (noon)
    const daylightFactor = THREE.MathUtils.smoothstep(elevation, -0.15, 0.35);

    this.solarEfficiency = Math.max(0, elevation) * sunMult;

    const noonColor = new THREE.Color(0xfff5e4);
    const duskColor = new THREE.Color(0xff7b47);
    const nightColor = new THREE.Color(0x4cc9f0);

    if (elevation >= 0) {
      this.sunLight.color.lerpColors(duskColor, noonColor, Math.min(1, elevation * 1.4));
    } else {
      this.sunLight.color.lerpColors(nightColor, duskColor, Math.max(0, 1 + elevation * 4));
    }

    this.sunLight.intensity = THREE.MathUtils.lerp(0.65, 3.2, daylightFactor) * sunMult;

    // 3. Double-stroke Sky Lightning Flash
    let flashBoost = 0;
    if (this.skyFlashAge < this.skyFlashDuration) {
      this.skyFlashAge += dt;
      const t = this.skyFlashAge / this.skyFlashDuration;
      const stroke1 = Math.exp(-Math.pow((t - 0.06) / 0.08, 2));
      const stroke2 = 0.65 * Math.exp(-Math.pow((t - 0.38) / 0.12, 2));
      flashBoost = Math.min(1.0, stroke1 + stroke2) * 4.2;
    }
    this.hemiLight.intensity = THREE.MathUtils.lerp(0.35, 0.88, daylightFactor) + flashBoost;
    (this.scene.background as THREE.Color).copy(this.fog.color).multiplyScalar(
      THREE.MathUtils.lerp(0.25, 1.0, daylightFactor) + flashBoost * 0.15
    );

    // 4. Texel-Quantized Shadow Frustum Tracking (Prevents shadow swimming when panning)
    const snapX = Math.round(cameraTarget.x);
    const snapZ = Math.round(cameraTarget.z);
    this.sunLight.target.position.set(snapX, 0, snapZ);
    const orbitX = Math.cos(angle) * 42;
    const orbitY = Math.max(18, Math.abs(elevation) * 58 + 14);
    this.sunLight.position.set(snapX + orbitX, orbitY, snapZ + 26);

    // 5. Update Pooled PointLights
    for (const slot of this.lightPool) {
      if (slot.duration > 0) {
        slot.age += dt;
        if (slot.age >= slot.duration) {
          slot.light.intensity = 0;
          slot.duration = 0;
        } else {
          const norm = 1.0 - slot.age / slot.duration;
          slot.light.intensity = slot.peakIntensity * (norm * norm);
        }
      }
    }
  }
}

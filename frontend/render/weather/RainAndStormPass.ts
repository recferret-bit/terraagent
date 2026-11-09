import * as THREE from 'three';
import { isSceneInDescent } from '../core/dayNightConfig';
import { getViewFocus } from '../core/viewFocus';
import {
  getRainLevel,
  getWeatherParams,
  isWeatherOn,
  onWeatherAction,
  type RainLevel,
} from '../core/weatherConfig';
import { getWindParams, isWindOn } from '../core/windConfig';
import { mulberry32 } from '../visuals/terrain/noise';
import { excludeFromReflection } from '../visuals/water/reflection/reflectionRegistry';
import {
  applyStormAtmosphere,
  createAtmosphereBaseline,
  type RainAndStormLights,
} from './stormAtmosphere';

export type { RainAndStormLights } from './stormAtmosphere';

const MAX_RAIN_STREAKS = 1200;
const RAIN_BOX_SPAN = 90;
const RAIN_BOX_HEIGHT = 38;
const RAIN_TINT_MINOR = 0x93c5fd;
const RAIN_TINT_HEAVY = 0xcbd5e1;

export type RainPassContext = RainAndStormLights;

export interface RainAndStormPass {
  readonly group: THREE.Group;
  readonly rainLines: THREE.LineSegments;
  readonly material: THREE.LineBasicMaterial;
  getActiveStreakCount(): number;
  getRainLevel(): RainLevel;
  /** Current horizontal wind tilt vector `(dx, dz)` applied per streak from top to bottom. */
  getWindTilt(): { readonly dx: number; readonly dz: number };
  triggerFlash(boost?: number): void;
  update(
    dtSec?: number,
    targetScene?: THREE.Scene,
    targetCamera?: THREE.Camera,
    lights?: RainAndStormLights,
  ): void;
  dispose(): void;
}

interface StreakSeeds {
  readonly wx: Float32Array;
  readonly wy: Float32Array;
  readonly wz: Float32Array;
  readonly scaleX: Float32Array;
  readonly scaleY: Float32Array;
  readonly fallSpeed: Float32Array;
}

function buildStreakSeeds(count: number, colors: Float32Array): StreakSeeds {
  const rng = mulberry32(0x57415635);
  const wx = new Float32Array(count);
  const wy = new Float32Array(count);
  const wz = new Float32Array(count);
  const scaleX = new Float32Array(count);
  const scaleY = new Float32Array(count);
  const fallSpeed = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    wx[i] = (rng() - 0.5) * RAIN_BOX_SPAN;
    wy[i] = rng() * RAIN_BOX_HEIGHT;
    wz[i] = (rng() - 0.5) * RAIN_BOX_SPAN;
    const tierRoll = rng();
    let alpha: number;
    if (tierRoll < 0.22) {
      scaleX[i] = 1.55 + rng() * 0.22;
      scaleY[i] = 1.35 + rng() * 0.22;
      fallSpeed[i] = 32 + rng() * 6;
      alpha = 0.95 + rng() * 0.15;
    } else if (tierRoll < 0.68) {
      scaleX[i] = 0.92 + rng() * 0.18;
      scaleY[i] = 0.92 + rng() * 0.18;
      fallSpeed[i] = 24 + rng() * 6;
      alpha = 0.72 + rng() * 0.16;
    } else {
      scaleX[i] = 0.48 + rng() * 0.16;
      scaleY[i] = 0.58 + rng() * 0.16;
      fallSpeed[i] = 17 + rng() * 5;
      alpha = 0.42 + rng() * 0.16;
    }
    const topB = alpha * 0.52;
    const cIdx = i * 6;
    colors[cIdx] = topB; colors[cIdx + 1] = topB; colors[cIdx + 2] = topB;
    colors[cIdx + 3] = alpha; colors[cIdx + 4] = alpha; colors[cIdx + 5] = alpha;
  }
  return { wx, wy, wz, scaleX, scaleY, fallSpeed };
}

function computeCameraTargetXZ(camera: THREE.Camera, out: THREE.Vector3): void {
  const focus = getViewFocus();
  if (focus.enabled && focus.radius < 1e5 && (focus.x !== 0 || focus.z !== 0)) {
    out.set(focus.x, 0, focus.z);
    return;
  }
  camera.getWorldDirection(out);
  if (out.y < -0.05) {
    const t = Math.min(85, Math.max(0, -camera.position.y / out.y));
    out.set(camera.position.x + out.x * t, 0, camera.position.z + out.z * t);
  } else {
    out.set(camera.position.x, 0, camera.position.z);
  }
}

const _targetPos = new THREE.Vector3();
const _flashColor = new THREE.Color(0xdbeafe);

interface RainStepState {
  currentTiltX: number;
  currentTiltZ: number;
  prevCamX: number;
  prevCamZ: number;
  camVelX: number;
  camVelZ: number;
  hasPrevCam: boolean;
}

function stepStreakPositions(
  seeds: StreakSeeds,
  positions: Float32Array,
  posAttr: THREE.BufferAttribute,
  state: RainStepState,
  camX: number,
  camZ: number,
  count: number,
  rainInt: number,
  dt: number,
): void {
  const wind = getWindParams();
  const windStr = isWindOn() ? wind.strength : 0;
  const rad = THREE.MathUtils.degToRad(wind.directionDeg);
  const windDirX = Math.cos(rad);
  const windDirZ = Math.sin(rad);

  if (!state.hasPrevCam) {
    state.prevCamX = camX;
    state.prevCamZ = camZ;
    state.hasPrevCam = true;
    for (let i = 0; i < MAX_RAIN_STREAKS; i++) {
      seeds.wx[i] = camX + seeds.wx[i]!;
      seeds.wz[i] = camZ + seeds.wz[i]!;
    }
  } else if (dt > 1e-4) {
    const rawVx = Math.max(-55, Math.min(55, (camX - state.prevCamX) / dt));
    const rawVz = Math.max(-55, Math.min(55, (camZ - state.prevCamZ) / dt));
    const blend = Math.min(1, dt * 10);
    state.camVelX += (rawVx - state.camVelX) * blend;
    state.camVelZ += (rawVz - state.camVelZ) * blend;
    state.prevCamX = camX;
    state.prevCamZ = camZ;
  }

  const baseStreakLen = rainInt > 0.5
    ? 2.7 + ((rainInt - 0.5) / 0.5) * 1.8
    : 1.6 + (rainInt / 0.5) * 1.1;

  const slantFactor = windStr * 0.55;
  state.currentTiltX = windDirX * baseStreakLen * slantFactor;
  state.currentTiltZ = windDirZ * baseStreakLen * slantFactor;

  const windSpeed = windStr * 11.5;
  const fallBoost = 0.85 + rainInt * 0.35;
  const { wx, wy, wz, scaleX, scaleY, fallSpeed } = seeds;

  for (let i = 0; i < count; i++) {
    const sx = scaleX[i]!;
    const sy = scaleY[i]!;
    const sp = fallSpeed[i]! * fallBoost;
    const driftVx = windDirX * windSpeed * (0.7 + 0.3 * sy) - state.camVelX * 0.22 * (sx - 0.85);
    const driftVz = windDirZ * windSpeed * (0.7 + 0.3 * sy) - state.camVelZ * 0.22 * (sx - 0.85);

    let x = wx[i]! + driftVx * dt;
    let z = wz[i]! + driftVz * dt;
    let y = wy[i]! - sp * dt;

    x -= Math.round((x - camX) / RAIN_BOX_SPAN) * RAIN_BOX_SPAN;
    z -= Math.round((z - camZ) / RAIN_BOX_SPAN) * RAIN_BOX_SPAN;
    if (y < 0) y = ((y % RAIN_BOX_HEIGHT) + RAIN_BOX_HEIGHT) % RAIN_BOX_HEIGHT;

    wx[i] = x; wy[i] = y; wz[i] = z;

    const dropLen = baseStreakLen * sy;
    const tiltX = state.currentTiltX * sy + state.camVelX * 0.028 * sx;
    const tiltZ = state.currentTiltZ * sy + state.camVelZ * 0.028 * sx;

    const idx = i * 6;
    positions[idx] = x - tiltX;
    positions[idx + 1] = y + dropLen;
    positions[idx + 2] = z - tiltZ;
    positions[idx + 3] = x;
    positions[idx + 4] = y;
    positions[idx + 5] = z;
  }
  posAttr.needsUpdate = true;
}

function buildRainRig(scene: THREE.Scene) {
  const positions = new Float32Array(MAX_RAIN_STREAKS * 6);
  const colors = new Float32Array(MAX_RAIN_STREAKS * 6);
  const posAttr = new THREE.BufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setDrawRange(0, 0);

  const material = new THREE.LineBasicMaterial({
    color: RAIN_TINT_MINOR,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });

  const rainLines = new THREE.LineSegments(geo, material);
  rainLines.name = 'rainStreaks';
  rainLines.frustumCulled = false;
  rainLines.castShadow = false;
  rainLines.receiveShadow = false;
  rainLines.renderOrder = 95;
  rainLines.raycast = () => {};

  const group = new THREE.Group();
  group.name = 'rainAndStormPass';
  group.visible = false;
  group.add(rainLines);
  scene.add(group);
  return { positions, colors, posAttr, geo, material, rainLines, group };
}

export function createRainAndStormPass(scene: THREE.Scene, camera: THREE.Camera): RainAndStormPass {
  const { positions, colors, posAttr, geo, material, rainLines, group } = buildRainRig(scene);
  const seeds = buildStreakSeeds(MAX_RAIN_STREAKS, colors);
  const offReflect = excludeFromReflection(group);
  const baseline = createAtmosphereBaseline();
  const state: RainStepState = {
    currentTiltX: 0, currentTiltZ: 0, prevCamX: 0, prevCamZ: 0, camVelX: 0, camVelZ: 0, hasPrevCam: false,
  };
  let activeStreaks = 0;
  let flashEnvelope = 0;
  let lastNowMs = -1;

  const offAction = onWeatherAction((act) => {
    if (act === 'lightning' || act === 'meteor' || act === 'storm') {
      flashEnvelope = Math.max(flashEnvelope, (act === 'meteor' ? 1.15 : 0.9) * getWeatherParams().lightningFlash);
    }
  });

  return {
    group,
    rainLines,
    material,
    getActiveStreakCount: () => activeStreaks,
    getRainLevel: () => (isWeatherOn() ? getRainLevel(getWeatherParams().rainIntensity) : 'none'),
    getWindTilt: () => ({ dx: state.currentTiltX, dz: state.currentTiltZ }),
    triggerFlash(boost = 1.0) {
      flashEnvelope = Math.max(flashEnvelope, boost * getWeatherParams().lightningFlash);
    },
    update(dtSec, targetScene = scene, targetCamera = camera, lights) {
      const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const dt = dtSec !== undefined
        ? Math.min(0.1, Math.max(0, dtSec))
        : lastNowMs < 0 ? 0.016 : Math.min(0.1, Math.max(0, (nowMs - lastNowMs) / 1000));
      lastNowMs = nowMs;
      if (flashEnvelope > 0) flashEnvelope = Math.max(0, flashEnvelope - dt * 3.8);
      if (group.parent !== targetScene) targetScene.add(group);
      if (isSceneInDescent(targetScene)) {
        group.visible = false;
        activeStreaks = 0;
        return;
      }

      const wp = getWeatherParams();
      const on = isWeatherOn();
      const effRain = on ? wp.rainIntensity : 0;
      const effStorm = on ? (wp.stormActive ? Math.max(0.75, wp.stormDarkness) : wp.stormDarkness) : 0;
      const overcast = on ? Math.min(1, effRain * 0.72 + effStorm * 0.45) : 0;
      applyStormAtmosphere(targetScene, baseline, overcast, flashEnvelope, lights);

      if (effRain <= 0.005) {
        group.visible = false; rainLines.visible = false; activeStreaks = 0;
        state.currentTiltX = 0; state.currentTiltZ = 0; material.opacity = 0;
        geo.setDrawRange(0, 0);
        return;
      }

      if (effRain <= 0.5) {
        const t = effRain / 0.5;
        activeStreaks = Math.round(140 + t * 380);
        material.opacity = 0.28 + t * 0.28;
        material.color.setHex(RAIN_TINT_MINOR);
      } else {
        const t = (effRain - 0.5) / 0.5;
        activeStreaks = Math.round(520 + t * (MAX_RAIN_STREAKS - 520));
        material.opacity = 0.56 + t * 0.36;
        material.color.setHex(RAIN_TINT_HEAVY);
      }
      if (flashEnvelope > 0.01) material.color.lerp(_flashColor, Math.min(1, flashEnvelope * 0.7));

      computeCameraTargetXZ(targetCamera, _targetPos);
      group.position.set(0, 0, 0);
      group.visible = true;
      rainLines.visible = true;
      geo.setDrawRange(0, activeStreaks * 2);
      stepStreakPositions(seeds, positions, posAttr, state, _targetPos.x, _targetPos.z, activeStreaks, effRain, dt);
    },
    dispose() {
      offAction();
      offReflect();
      applyStormAtmosphere(scene, baseline, 0, 0);
      group.removeFromParent();
      geo.dispose();
      material.dispose();
    },
  };
}

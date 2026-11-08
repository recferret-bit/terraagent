import {
  getRainLevel,
  getTwisterAvailabilityHint,
  isTwisterAvailable,
  setWeather,
  triggerWeatherAction,
  type RainLevel,
} from '@terra/render/core/weatherConfig';
import { getWindParams, setWindParams } from '@terra/render/core/windConfig';
import { TILE_M } from '@terra/render/planets/hex';
import { patchWeatherParams, readWeatherParams } from '@terra/render/weather';
import { planeToAxial } from '@terra/sim/grid/hex';
import type { DevCommandDef, FeatureContext, GameView } from '../../core/registry/types';
import type { CommandResult } from '../../net/commandBus';
import { ownColonyIndex } from '../shared/colony';
import { extractHqFromView } from '../shared/hqView';
import '../../net/services';

export interface WeatherPreviewService {
  triggerMeteor(q: number, r: number): void;
  triggerTwister(q: number, r: number, dirDeg?: number): void;
  triggerLightning(q: number, r: number): void;
}

declare module '../../core/registry/types' {
  interface FeatureServices {
    weatherPreview?: WeatherPreviewService;
  }
}

function readRtsCamera(ctx: FeatureContext): { target?: { x: number; y: number; z: number }; setShake?(amp: number): void } | null {
  return (ctx.services as { rtsCamera?: { target?: { x: number; y: number; z: number }; setShake?(amp: number): void } | null }).rtsCamera ?? null;
}

function readSimView(ctx: FeatureContext): unknown {
  const fromGet = typeof ctx.services.getView === 'function' ? ctx.services.getView() : undefined;
  const fromProp =
    typeof ctx.services.view === 'function'
      ? (ctx.services.view as () => GameView | undefined)()
      : ctx.services.view;
  const gv = fromGet ?? fromProp;
  return gv?.sim?.view ?? ctx.services.store?.latest ?? gv;
}

/**
 * Resolves `(q, r)` from explicit numeric args, or falls back to the current RTS camera ground target tile,
 * or an offset from the player's HQ tile, or `(0, 0)`.
 */
export function resolveTargetTile(
  args: readonly string[],
  ctx: FeatureContext,
  hqOffset: { dq: number; dr: number } = { dq: 0, dr: 0 },
): { q: number; r: number } {
  if (args.length >= 2) {
    const qNum = Number(args[0]);
    const rNum = Number(args[1]);
    if (Number.isFinite(qNum) && Number.isFinite(rNum)) {
      return { q: Math.round(qNum), r: Math.round(rNum) };
    }
  }

  const camTarget = readRtsCamera(ctx)?.target;
  if (camTarget && Number.isFinite(camTarget.x) && Number.isFinite(camTarget.z)) {
    if (Math.abs(camTarget.x) > 0.01 || Math.abs(camTarget.z) > 0.01) {
      const [q, r] = planeToAxial(camTarget.x / TILE_M, camTarget.z / TILE_M);
      return { q, r };
    }
  }

  const simView = readSimView(ctx);
  const hq = extractHqFromView(simView, ownColonyIndex(ctx.services));
  if (hq) {
    return { q: hq.q + hqOffset.dq, r: hq.r + hqOffset.dr };
  }

  return { q: 0, r: 0 };
}

async function dispatchSim(ctx: FeatureContext, kind: string, args: Record<string, unknown>): Promise<CommandResult> {
  const send = ctx.services.sendCommand;
  if (!send) {
    return { ok: false, code: 'not_connected', detail: 'no game server connection' };
  }
  return send(kind, args);
}

function formatAckOrThrow(kind: string, r: CommandResult, summary: string, onPreview?: () => void): string {
  if (r.ok) {
    return `${kind} ok (tick ${r.appliedAtTick}) — ${summary}`;
  }
  if (r.code === 'not_connected') {
    onPreview?.();
    return `${kind} preview — ${summary}`;
  }
  throw new Error(`${kind} rejected: ${r.code}${r.detail ? ` (${r.detail})` : ''}`);
}

export const meteorCommand: DevCommandDef = {
  name: 'meteor',
  help: 'meteor [q r] — strike a 37-hex area with a meteor (destroys all in 37 hexes & leaves explosion holes)',
  async run(args, ctx) {
    const { q, r } = resolveTargetTile(args, ctx, { dq: 4, dr: -2 });
    const colonyIndex = ownColonyIndex(ctx.services);
    const payload = { q, r, hexCount: 37, colonyIndex };
    const res = await dispatchSim(ctx, 'dev.meteor', payload);
    return formatAckOrThrow(
      'dev.meteor',
      res,
      `37-hex meteor strike at (${q}, ${r})`,
      () => {
        if (ctx.services.weatherPreview) ctx.services.weatherPreview.triggerMeteor(q, r);
        else triggerWeatherAction('meteor', { q, r });
      },
    );
  },
};

export const twisterCommand: DevCommandDef = {
  name: 'twister',
  help: 'twister [q r] [dirDeg] — spawn a rising twister that moves randomly, damages path, sucks units & trees (auto-configures high wind & minor rain if needed)',
  async run(args, ctx) {
    const { q, r } = resolveTargetTile(args, ctx, { dq: 3, dr: -1 });
    const dirArg = args.length >= 3 ? Number(args[2]) : args.length === 1 ? Number(args[0]) : undefined;
    const dirDeg = dirArg !== undefined && Number.isFinite(dirArg) ? dirArg : undefined;
    const colonyIndex = ownColonyIndex(ctx.services);

    let autoConfigured = false;
    if (!isTwisterAvailable(getWindParams().strength, readWeatherParams().rainIntensity)) {
      autoConfigured = true;
      setWeather(true, 'user');
      setWindParams({ strength: Math.max(1.35, getWindParams().strength) }, 'user');
      patchWeatherParams({ rainIntensity: 0.35, stormActive: false, stormDarkness: 0.25 });
      await dispatchSim(ctx, 'dev.setwind', { pct: 135 });
      await dispatchSim(ctx, 'dev.rain', { level: 'minor', intensity: 0.35 });
    }

    const payload: Record<string, unknown> = {
      q,
      r,
      colonyIndex,
      ...(dirDeg !== undefined ? { dirDeg } : {}),
    };
    let res = await dispatchSim(ctx, 'dev.twister', payload);
    if (!res.ok && res.code === 'weather_conditions_not_met') {
      autoConfigured = true;
      setWeather(true, 'user');
      setWindParams({ strength: Math.max(1.35, getWindParams().strength) }, 'user');
      patchWeatherParams({ rainIntensity: 0.35, stormActive: false, stormDarkness: 0.25 });
      await dispatchSim(ctx, 'dev.setwind', { pct: 135 });
      await dispatchSim(ctx, 'dev.rain', { level: 'minor', intensity: 0.35 });
      res = await dispatchSim(ctx, 'dev.twister', payload);
    }

    const hint = getTwisterAvailabilityHint(getWindParams().strength, readWeatherParams().rainIntensity);
    const summary = autoConfigured
      ? `Auto-configured HIGH wind (135%) + MINOR rain (35%) and spawned Twister at (${q}, ${r}) [${hint}]`
      : `rising twister at (${q}, ${r}) [${hint}]`;
    return formatAckOrThrow(
      'dev.twister',
      res,
      summary,
      () => {
        if (ctx.services.weatherPreview) ctx.services.weatherPreview.triggerTwister(q, r, dirDeg);
        else triggerWeatherAction('twister', { q, r });
      },
    );
  },
};

export const lightningCommand: DevCommandDef = {
  name: 'lightning',
  help: 'lightning [q r] [+ rain] — strike 4 hexes with heavy damage, electrical overload (buildings offline), and screen flash',
  async run(args, ctx) {
    const hasCoords = args.length >= 2 && Number.isFinite(Number(args[0])) && Number.isFinite(Number(args[1]));
    const { q, r } = hasCoords
      ? { q: Math.round(Number(args[0])), r: Math.round(Number(args[1])) }
      : resolveTargetTile([], ctx, { dq: 2, dr: -1 });
    const withRain = args.some((token) => {
      const t = token.trim().toLowerCase();
      return t === 'rain' || t === '+' || t === '+rain' || t === 'true';
    });
    if (withRain) {
      setWeather(true, 'user');
      patchWeatherParams({ rainIntensity: Math.max(0.35, readWeatherParams().rainIntensity) });
    }
    const colonyIndex = ownColonyIndex(ctx.services);
    const payload: Record<string, unknown> = {
      q,
      r,
      hexCount: 4,
      colonyIndex,
      ...(withRain ? { rain: true } : {}),
    };
    const res = await dispatchSim(ctx, 'dev.lightning', payload);
    return formatAckOrThrow(
      'dev.lightning',
      res,
      `4-hex lightning strike at (${q}, ${r})${withRain ? ' + rain' : ''} (electrical overload offline)`,
      () => {
        if (ctx.services.weatherPreview) ctx.services.weatherPreview.triggerLightning(q, r);
        else triggerWeatherAction('lightning', { q, r });
      },
    );
  },
};

export const stormCommand: DevCommandDef = {
  name: 'storm',
  help: 'storm [on|off] — toggle storm + rain + lightning weather',
  async run(args, ctx) {
    const first = args[0]?.trim().toLowerCase();
    const current = readWeatherParams().stormActive;
    const active =
      first === 'on' || first === 'true' || first === '1'
        ? true
        : first === 'off' || first === 'false' || first === '0'
          ? false
          : !current;
    const rain: RainLevel = active ? 'heavy' : 'none';
    if (active) setWeather(true, 'user');
    patchWeatherParams({
      stormActive: active,
      stormDarkness: active ? 0.75 : 0,
      rainIntensity: active ? Math.max(0.75, readWeatherParams().rainIntensity) : 0,
    });
    const colonyIndex = ownColonyIndex(ctx.services);
    const res = await dispatchSim(ctx, 'dev.storm', {
      active,
      rain,
      lightning: active,
      colonyIndex,
    });
    return formatAckOrThrow('dev.storm', res, `storm ${active ? 'ON (rain + lightning)' : 'OFF'}`);
  },
};

export const rainCommand: DevCommandDef = {
  name: 'rain',
  help: 'rain [none|minor|heavy|0..1] — set planet rain intensity (minor rain + high wind unlocks twister)',
  async run(args, ctx) {
    const raw = args[0]?.trim().toLowerCase() ?? 'minor';
    let level: RainLevel;
    let intensity: number;

    if (raw === 'none' || raw === 'off' || raw === 'clear') {
      level = 'none';
      intensity = 0;
    } else if (raw === 'minor' || raw === 'light') {
      level = 'minor';
      intensity = 0.3;
    } else if (raw === 'heavy' || raw === 'major' || raw === 'full') {
      level = 'heavy';
      intensity = 0.85;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error('usage: rain [none|minor|heavy|0..1]');
      }
      intensity = Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
      level = getRainLevel(intensity);
    }

    if (intensity > 0.01) setWeather(true, 'user');
    patchWeatherParams({ rainIntensity: intensity });
    const colonyIndex = ownColonyIndex(ctx.services);
    const res = await dispatchSim(ctx, 'dev.rain', { level, intensity, colonyIndex });
    return formatAckOrThrow('dev.rain', res, `rain ${level} (${Math.round(intensity * 100)}%)`);
  },
};

export const WEATHER_DEV_COMMANDS: DevCommandDef[] = [
  meteorCommand,
  twisterCommand,
  lightningCommand,
  stormCommand,
  rainCommand,
];

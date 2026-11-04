import { defineFeature, type DevCommandDef, type FeatureContext } from '../../core/registry/types';
import { intArg } from '../../dev/console/parse';
import type { CommandResult } from '../../net/commandBus';
import '../../net/services';
import {
  createHitDebugRenderer,
  ensureHitDebugService,
  HitDebugController,
  type HitDebugAimPoint,
  type HitDebugCircle,
  type HitDebugService,
} from './HitDebugRenderer';

export {
  createHitDebugRenderer,
  ensureHitDebugService,
  HitDebugController,
  type HitDebugAimPoint,
  type HitDebugCircle,
  type HitDebugService,
};

declare module '../../core/registry/types' {
  interface FeatureServices {
    hitDebug?: HitDebugService;
  }
}

const VALID_SPECIES = new Set(['blackAnt', 'blueBeetle', 'greenSpitter']);
const VALID_SPAWN_UNITS = new Set([
  'recon',
  'demoTank',
  'tank',
  'demoArtillery',
  'artillery',
  'harvester',
  'builder',
  'blackAnt',
  'blueBeetle',
  'greenSpitter',
]);

function isSpecies(v: string | undefined): v is 'blackAnt' | 'blueBeetle' | 'greenSpitter' {
  return typeof v === 'string' && VALID_SPECIES.has(v);
}

function isMode(v: string | undefined): v is 'passive' | 'aggressive' {
  return v === 'passive' || v === 'aggressive';
}

function parseBoolArg(raw: string | undefined, cmdName: string): boolean | undefined {
  if (raw === undefined) return undefined;
  const s = raw.trim().toLowerCase();
  if (s === 'on' || s === '1' || s === 'true') return true;
  if (s === 'off' || s === '0' || s === 'false') return false;
  throw new Error(`usage: ${cmdName} [on|off|1|0]`);
}

async function sim(ctx: FeatureContext, kind: string, args: unknown): Promise<CommandResult> {
  const send = ctx.services.sendCommand;
  return send
    ? send(kind, args)
    : { ok: false, code: 'not_connected', detail: 'no game server connection' };
}

function ackText(kind: string, r: CommandResult): string {
  if (r.ok) return `${kind} ok, applied at tick ${r.appliedAtTick}`;
  throw new Error(`${kind} rejected: ${r.code}${r.detail ? ` (${r.detail})` : ''}`);
}

export function parseSpawnRaidArgs(a: string[]): Record<string, unknown> {
  if (a.length === 0) return {};
  const first = a[0]!;
  if (a.length === 1) {
    if (isSpecies(first)) return { species: first };
    return { hiveId: intArg(a, 0, 'hiveId') };
  }
  if (a.length === 2) {
    if (isSpecies(first)) return { species: first, count: intArg(a, 1, 'count') };
    return { q: intArg(a, 0, 'q'), r: intArg(a, 1, 'r') };
  }
  if (isSpecies(first)) {
    return { species: first, q: intArg(a, 1, 'q'), r: intArg(a, 2, 'r') };
  }
  return { hiveId: intArg(a, 0, 'hiveId'), q: intArg(a, 1, 'q'), r: intArg(a, 2, 'r') };
}

export function parseSpawnHiveArgs(a: string[]): Record<string, unknown> {
  if (a.length === 0) return { species: 'blackAnt' };
  const first = a[0]!;
  if (isSpecies(first)) {
    if (a.length === 1) return { species: first };
    if (a.length === 2) {
      if (!isMode(a[1])) throw new Error('mode must be passive or aggressive');
      return { species: first, mode: a[1] };
    }
    const q = intArg(a, 1, 'q');
    const r = intArg(a, 2, 'r');
    if (a.length >= 4) {
      if (!isMode(a[3])) throw new Error('mode must be passive or aggressive');
      return { species: first, q, r, mode: a[3] };
    }
    return { species: first, q, r };
  }
  if (isMode(first)) {
    return { species: 'blackAnt', mode: first };
  }
  if (/^-?\d+$/.test(first) && a.length >= 2) {
    const q = intArg(a, 0, 'q');
    const r = intArg(a, 1, 'r');
    if (a[2] !== undefined) {
      if (!isMode(a[2])) throw new Error('mode must be passive or aggressive');
      return { species: 'blackAnt', q, r, mode: a[2] };
    }
    return { species: 'blackAnt', q, r };
  }
  throw new Error('species must be blackAnt, blueBeetle, or greenSpitter');
}

export function parseFaunaModeArgs(a: string[]): Record<string, unknown> {
  const id = intArg(a, 0, 'id');
  const second = a[1];
  if (second === undefined) {
    throw new Error('usage: faunaMode <id> <passive|aggressive> [targetId|q r]');
  }
  if (isMode(second)) {
    if (a.length === 2) return { id, mode: second };
    if (a.length === 3) return { id, mode: second, targetId: intArg(a, 2, 'targetId') };
    return { id, mode: second, targetQ: intArg(a, 2, 'q'), targetR: intArg(a, 3, 'r') };
  }
  if (/^-?\d+$/.test(second)) {
    if (a.length === 2) return { id, mode: 'aggressive', targetId: intArg(a, 1, 'targetId') };
    return { id, mode: 'aggressive', targetQ: intArg(a, 1, 'q'), targetR: intArg(a, 2, 'r') };
  }
  throw new Error('mode must be passive or aggressive');
}

export function parseSpawnUnitArgs(a: string[]): Record<string, unknown> {
  const unit = a[0];
  if (!unit) {
    throw new Error('usage: spawnUnit <recon|demoTank|demoArtillery|blackAnt|blueBeetle|greenSpitter> [q r] [count]');
  }
  if (!VALID_SPAWN_UNITS.has(unit)) {
    throw new Error(`unknown unit "${unit}"`);
  }
  if (a.length === 1) return { unit };
  if (a.length === 2) return { unit, count: intArg(a, 1, 'count') };
  const q = intArg(a, 1, 'q');
  const r = intArg(a, 2, 'r');
  if (a.length >= 4) {
    return { unit, q, r, count: intArg(a, 3, 'count') };
  }
  return { unit, q, r };
}

function makeSpawnRaidCommand(name: string): DevCommandDef {
  return {
    name,
    help: 'spawnRaid [species|hiveId] [q r]  Provoke a species hive (or spawn one) and dispatch a bounded raid wave',
    async run(a, ctx) {
      const args = parseSpawnRaidArgs(a);
      return ackText('dev.spawnraid', await sim(ctx, 'dev.spawnraid', args));
    },
  };
}

function makeSpawnHiveCommand(name: string): DevCommandDef {
  return {
    name,
    help: 'spawnHive <blackAnt|blueBeetle|greenSpitter> [q r] [passive|aggressive]  Spawn a 3x3 species hive with initial residents',
    async run(a, ctx) {
      const args = parseSpawnHiveArgs(a);
      return ackText('dev.spawnhive', await sim(ctx, 'dev.spawnhive', args));
    },
  };
}

function makeFaunaModeCommand(name: string): DevCommandDef {
  return {
    name,
    help: 'faunaMode <id> <passive|aggressive> [targetId|q r]  Switch a hive or bug between passive/aggressive or retarget it',
    async run(a, ctx) {
      const args = parseFaunaModeArgs(a);
      return ackText('dev.faunamode', await sim(ctx, 'dev.faunamode', args));
    },
  };
}

function makeGodModeCommand(name: string): DevCommandDef {
  return {
    name,
    help: 'godMode [on|off|1|0]  Toggle or set colony invulnerability (0 damage to own units and buildings)',
    async run(a, ctx) {
      const enabled = parseBoolArg(a[0], 'godMode');
      const args = enabled !== undefined ? { enabled } : {};
      return ackText('dev.godmode', await sim(ctx, 'dev.godmode', args));
    },
  };
}

function makeSpawnUnitCommand(name: string): DevCommandDef {
  return {
    name,
    help: 'spawnUnit <recon|demoTank|demoArtillery|blackAnt|blueBeetle|greenSpitter> [q r] [count]  Spawn combat or fauna units',
    async run(a, ctx) {
      const args = parseSpawnUnitArgs(a);
      return ackText('dev.spawnunit', await sim(ctx, 'dev.spawnunit', args));
    },
  };
}

function makeHitDebugCommand(name: string): DevCommandDef {
  return {
    name,
    help: 'hitDebug [on|off|1|0]  Toggle 3D projectile aim-point crosshairs and AoE splash radius rings',
    run(a, ctx) {
      const explicit = parseBoolArg(a[0], 'hitDebug');
      const svc = ensureHitDebugService(ctx);
      const next = svc.toggle(explicit);
      return next ? 'hitDebug on' : 'hitDebug off';
    },
  };
}

export const devtoolsW07 = defineFeature({
  id: 'devtools-w07',
  wave: 'W07',
  devCommands: [
    makeSpawnRaidCommand('spawnRaid'),
    makeSpawnRaidCommand('spawnraid'),
    makeSpawnHiveCommand('spawnHive'),
    makeSpawnHiveCommand('spawnhive'),
    makeSpawnHiveCommand('fauna.hive'),
    makeFaunaModeCommand('faunaMode'),
    makeFaunaModeCommand('faunamode'),
    makeFaunaModeCommand('fauna.mode'),
    makeFaunaModeCommand('faunaTarget'),
    makeFaunaModeCommand('faunatarget'),
    makeFaunaModeCommand('fauna.target'),
    makeGodModeCommand('godMode'),
    makeGodModeCommand('godmode'),
    makeSpawnUnitCommand('spawnUnit'),
    makeSpawnUnitCommand('spawnunit'),
    makeHitDebugCommand('hitDebug'),
    makeHitDebugCommand('hitdebug'),
  ],
  renderers: [{ id: 'hit-debug-3d', mount: createHitDebugRenderer }],
});

export default devtoolsW07;

import { defineFeature, type DevCommandDef, type FeatureContext, type GameView } from '../../core/registry/types';
import { DevServerError } from '../../net/devServer';
import { numArg } from '../../dev/console/parse';
import type { CommandResult } from '../../net/commandBus';
import { timeCommand } from '../warp';
import { ownColonyIndex, viewColony } from '../shared/colony';
import '../../net/services';

export interface PowerSummaryView {
  supply?: number;
  demand?: number;
  net?: number;
  founderCorePerS?: number;
  solarGrossPerS?: number;
  solarInternalDrainPerS?: number;
  solarNetPerS?: number;
  rawDemand?: number;
  buildingDemand?: number;
  unitDemand?: number;
  workDemand?: number;
  brownout?: boolean;
  shedGroupsActive?: number[];
  shedEntityIds?: number[];
  shedWorkJobIds?: string[];
  daylight?: number;
  phase?: string;
  clockText?: string;
  [key: string]: unknown;
}

declare module '../../core/registry/types' {
  interface FeatureServices {
    /** Sim view access for dev commands (e.g. `power`). */
    view?: GameView | (() => GameView | undefined);
    getView?: () => GameView | undefined;
  }
}

/** Dev console commands that talk to the game: sim `dev.*` commands over the transport, server dev commands over HTTP. */

async function sim(ctx: FeatureContext, kind: string, args: unknown, predict = true): Promise<CommandResult> {
  const send = ctx.services.sendCommand;
  return send ? (predict ? send(kind, args) : send(kind, args, { predict: false })) : { ok: false, code: 'not_connected', detail: 'no game server connection' };
}

function ackText(kind: string, r: CommandResult): string {
  if (r.ok) return `${kind} ok, applied at tick ${r.appliedAtTick}`;
  throw new Error(`${kind} rejected: ${r.code}${r.detail ? ` (${r.detail})` : ''}`);
}

/** `name` may end in `!`: the command is sent without telling the predictor (the client sees the result only through the server delta). */
const simCommand = (name: string, help: string, args: (a: string[]) => unknown): DevCommandDef => {
  const kind = `dev.${name.replace(/!$/, '')}`;
  return { name, help, async run(a, ctx) { return ackText(kind, await sim(ctx, kind, args(a), !name.endsWith('!'))); } };
};

const chainPing: DevCommandDef = {
  name: 'chain.ping',
  help: 'Server: write a ping receipt through the mock chain, print its mock: hash',
  async run(_a, ctx) {
    const server = ctx.services.devServer;
    if (!server) throw new DevServerError('host_unavailable', 'chain.ping needs the game server; not available on this host');
    const r = (await server('chain.ping')) as { txHash?: string; status?: string; blockHeight?: unknown };
    return `${r.txHash ?? JSON.stringify(r)}${r.status ? `  ${r.status}` : ''}${r.blockHeight !== undefined ? `  block ${String(r.blockHeight)}` : ''}`;
  },
};

const fill: DevCommandDef = {
  name: 'fill',
  help: 'fill [res] [amount]  Fill colony stock to cap (or set to exact amount, clamped to cap)',
  async run(a, ctx) {
    const res = a[0] ?? 'all';
    const amount = a[1] !== undefined ? Number(a[1]) : undefined;
    const r = await sim(ctx, 'dev.fill', { res, ...(amount !== undefined ? { amount } : {}) });
    return ackText('dev.fill', r);
  },
};

const time = timeCommand;

const skipnight: DevCommandDef = {
  name: 'skipnight',
  help: 'skipnight  Skip to next sunrise (06:00)',
  async run(_a, ctx) {
    const r = await sim(ctx, 'dev.skipnight', {});
    return ackText('dev.skipnight', r);
  },
};

const power: DevCommandDef = {
  name: 'power',
  help: 'power [colonyIndex]  Dump power grid component supply/demand/shedding',
  async run(a, ctx) {
    const colonyIndex = a[0] !== undefined ? Number(a[0]) : ownColonyIndex(ctx.services); // the player's seat (FF-46)
    const r = await sim(ctx, 'dev.power', a[0] !== undefined ? { colonyIndex } : {});
    const ack = ackText('dev.power', r);
    const v = typeof ctx.services.getView === 'function'
      ? ctx.services.getView()
      : typeof ctx.services.view === 'function'
        ? (ctx.services.view as () => GameView | undefined)()
        : ctx.services.view;
    const colony = viewColony(v, colonyIndex) as { power?: PowerSummaryView } | undefined;
    const p = colony?.power;
    if (!p) return ack;
    const lines = [
      `colony ${colonyIndex} power: ${p.net !== undefined && p.net >= 0 ? '+' : ''}${p.net ?? 0} E/s (${p.brownout ? 'BROWNOUT' : 'OK'})`,
      `  supply: ${p.supply ?? 0} E/s (core: ${p.founderCorePerS ?? 0}, solar: ${p.solarNetPerS ?? 0} [gross ${p.solarGrossPerS ?? 0}, drain ${p.solarInternalDrainPerS ?? 0}])`,
      `  demand: ${p.demand ?? 0} E/s (raw: ${p.rawDemand ?? 0}, buildings: ${p.buildingDemand ?? 0}, units: ${p.unitDemand ?? 0}, work: ${p.workDemand ?? 0})`,
      `  daylight: ${p.daylight ?? 0} (${p.phase ?? 'day'} ${p.clockText ?? ''})`,
    ];
    if (p.shedGroupsActive?.length) lines.push(`  shed groups: ${p.shedGroupsActive.join(', ')}`);
    if (p.shedEntityIds?.length) lines.push(`  shed entities: ${p.shedEntityIds.join(', ')}`);
    if (p.shedWorkJobIds?.length) lines.push(`  paused work jobs: ${p.shedWorkJobIds.join(', ')}`);
    return lines.join('\n');
  },
};

const scenarioCommand: DevCommandDef = {
  name: 'scenario',
  help: 'scenario <id>  Server: create a fresh dev planet from a seed scenario (e.g. w00), print its id (open ?scenario=<id> to play it)',
  async run(a, ctx) {
    const id = a[0];
    if (!id) throw new Error('usage: scenario <id>');
    const server = ctx.services.devServer;
    if (!server) throw new DevServerError('host_unavailable', 'scenario needs the game server; not available on this host');
    const r = (await server('scenario', { id })) as { planetId: string };
    return `created ${r.planetId} from scenario ${id}`;
  },
};

/** `planet.wipe <planetId>`: the server dev command (LED-06) for a held planet that cannot load. */
const planetWipe: DevCommandDef = {
  name: 'planet.wipe',
  help: 'planet.wipe <planetId>  Server: delete a held (unloaded) planet with its snapshots, ledger and colony rows (a loaded planet is refused)',
  async run(a, ctx) {
    const planetId = a[0];
    if (!planetId) throw new Error('usage: planet.wipe <planetId>');
    const server = ctx.services.devServer;
    if (!server) throw new DevServerError('host_unavailable', 'planet.wipe needs the game server; not available on this host');
    await server('planet.wipe', { planetId });
    return `wiped ${planetId}: the next seat or boot starts it fresh`;
  },
};

/** `planet`: the current planet id and a ready-to-open link for a second player (`&join=<id>&as=<name>`). */
const planet: DevCommandDef = {
  name: 'planet',
  help: 'planet [name]  Print this planet\'s id and a link that joins it as another player (default name b) — open it in a second browser profile',
  run(a, ctx) {
    const id = ctx.services.session?.planetId();
    if (!id) throw new Error('no planet joined yet');
    const q = new URLSearchParams(location.search);
    q.delete('scenario'); q.delete('as'); q.set('join', id); q.set('as', a[0] ?? 'b');
    return `planet ${id}\njoin as another player: ${location.origin}${location.pathname}?${q}`;
  },
};

export default defineFeature({
  id: 'devtools',
  wave: 'W00',
  devCommands: [
    chainPing,
    scenarioCommand,
    planetWipe,
    planet,
    simCommand('ping', 'Round-trip a no-op sim command; prints the ack tick', () => ({})),
    simCommand('spawn', 'spawn [q r]  Insert a test entity at tile (default 0 0)', (a) => ({ q: numArg(a, 0, 'q', 0), r: numArg(a, 1, 'r', 0) })),
    simCommand('nudge', 'nudge <id> [dq dr]  Move a test entity one nudge step (default +q)', (a) => {
      const dq = a[1] === undefined ? undefined : numArg(a, 1, 'dq');
      const dr = a[2] === undefined ? undefined : numArg(a, 2, 'dr');
      return { id: numArg(a, 0, 'id'), ...(dq !== undefined ? { dq } : {}), ...(dr !== undefined ? { dr } : {}) };
    }),
    simCommand('teleport', 'teleport <id> <q> <r>  Set a test entity position', (a) => ({ id: numArg(a, 0, 'id'), q: numArg(a, 1, 'q'), r: numArg(a, 2, 'r') })),
    simCommand('teleport!', 'teleport! <id> <q> <r>  Like teleport, but the client does not predict it (watch the correction blend)', (a) => ({ id: numArg(a, 0, 'id'), q: numArg(a, 1, 'q'), r: numArg(a, 2, 'r') })),
    time,
  ],
});

/**
 * Dev commands whose sim handlers are wave W02 (`dev.fill`, `dev.skipnight`, `dev.power`, `dev.spawndeposit`): a W02
 * feature (mounted by `features/devtools-w02`), so `?waves=..01` does not list commands the host would reject.
 */
export const devtoolsW02 = defineFeature({
  id: 'devtools-w02',
  wave: 'W02',
  devCommands: [
    simCommand('spawndeposit', 'spawndeposit <q> <r> <metals|minerals|oil> <1|2|3>  Place a full deposit of that tier on a tile (a terraform find)', (a) => ({
      q: numArg(a, 0, 'q'), r: numArg(a, 1, 'r'), family: a[2] ?? 'metals', tier: numArg(a, 3, 'tier', 1),
    })),
    fill,
    skipnight,
    power,
  ],
});

const makeSetWind = (name: string): DevCommandDef => ({
  name,
  help: 'setWind <pct>  Set wind output factor (0..500%)',
  async run(a, ctx) {
    const pct = numArg(a, 0, 'pct');
    return ackText('dev.setwind', await sim(ctx, 'dev.setwind', { pct }));
  },
});

const makeDrainFuel = (name: string): DevCommandDef => ({
  name,
  help: 'drainFuel [colonyIndex]  Zero out colony bio.biomass stock to test Thermal Plant fuel starvation',
  async run(a, ctx) {
    const args = a[0] !== undefined ? { colonyIndex: numArg(a, 0, 'colonyIndex') } : {};
    return ackText('dev.drainfuel', await sim(ctx, 'dev.drainfuel', args));
  },
});

const makeAddLoad = (name: string): DevCommandDef => ({
  name,
  help: 'addLoad <E/s> [entityId]  Inject synthetic electrical load (E/s) onto the colony or a pylon',
  async run(a, ctx) {
    const loadPerS = numArg(a, 0, 'loadPerS');
    const entityId = a[1] !== undefined ? numArg(a, 1, 'entityId') : undefined;
    return ackText('dev.addload', await sim(ctx, 'dev.addload', { loadPerS, ...(entityId !== undefined ? { entityId } : {}) }));
  },
});

const damageCommand: DevCommandDef = {
  name: 'damage',
  help: 'damage <entity> <pct>  Damage an entity by pct% of its max HP (1..100)',
  async run(a, ctx) {
    const entityId = numArg(a, 0, 'entity');
    const pct = numArg(a, 1, 'pct');
    return ackText('dev.damage', await sim(ctx, 'dev.damage', { entityId, pct }));
  },
};

export const devtoolsW03 = defineFeature({
  id: 'devtools-w03',
  wave: 'W03',
  devCommands: [
    makeSetWind('setWind'),
    makeSetWind('setwind'),
    makeDrainFuel('drainFuel'),
    makeDrainFuel('drainfuel'),
    makeAddLoad('addLoad'),
    makeAddLoad('addload'),
    damageCommand,
  ],
});

import { RESOURCE_KEYS, type ResourceKey } from '@terra/contracts';
import { defineFeature, type DevCommandDef, type FeatureContext } from '../../core/registry/types';
import type { CommandResult } from '../../net/commandBus';
import '../../net/services';

const GRANT_USAGE = 'cargo.grant <colony> <res> <amt>';
const CAP_RESET_USAGE = 'cargo.cap.reset [colony]';
const TRADEHUB_SPAWN_USAGE = 'tradehub.spawn [q] [r]';

async function sim(ctx: FeatureContext, kind: string, args: unknown): Promise<CommandResult> {
  const send = ctx.services.sendCommand;
  return send
    ? send(kind, args)
    : { ok: false, code: 'not_connected', detail: 'no game server connection' };
}

function parseColony(raw?: string): { colony: string; colonyIndex: number } {
  if (!raw || raw === '') return { colony: '0', colonyIndex: 0 };
  let colonyIndex = 0;
  if (/^\d+$/.test(raw)) {
    colonyIndex = parseInt(raw, 10);
  } else if (raw.startsWith('col-') && /^\d+$/.test(raw.slice(4))) {
    colonyIndex = parseInt(raw.slice(4), 10);
  }
  return { colony: raw, colonyIndex };
}

export const cargoGrantCmd: DevCommandDef = {
  name: 'cargo.grant',
  help: `${GRANT_USAGE}  Grant orbital cargo tokens to a colony`,
  async run(a, ctx) {
    let colony = '0';
    let colonyIndex = 0;
    let res = '';
    let amtStr = '';

    if (a.length === 2) {
      res = a[0] ?? '';
      amtStr = a[1] ?? '';
    } else if (a.length === 3) {
      const parsed = parseColony(a[0]);
      colony = parsed.colony;
      colonyIndex = parsed.colonyIndex;
      res = a[1] ?? '';
      amtStr = a[2] ?? '';
    } else {
      throw new Error(`usage: ${GRANT_USAGE}`);
    }

    const amount = Number(amtStr);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
      throw new Error(`usage: ${GRANT_USAGE}`);
    }

    const resource = res as ResourceKey;
    if (!RESOURCE_KEYS.includes(resource)) {
      throw new Error(`usage: ${GRANT_USAGE}`);
    }

    const r = await sim(ctx, 'dev.cargoGrant', { colonyIndex, resource, amount });
    if (!r.ok && r.code !== 'not_connected') {
      throw new Error(`dev.cargoGrant rejected: ${r.code}${r.detail ? ` (${r.detail})` : ''}`);
    }

    if (ctx.host !== 'local' && typeof fetch === 'function') {
      try {
        await fetch('/v1/dev/command', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'cargo.grant', args: { colony: String(colony), resource, amount } }),
        });
      } catch {
        // ignore network errors in offline/local mode
      }
      if (ctx.services.devServer) {
        try {
          await ctx.services.devServer('cargo.grant', { colony: String(colony), resource, amount });
        } catch {
          // ignore
        }
      }
    }

    return `Granted ${amount} ${resource} in orbit for colony ${colony}`;
  },
};

export const cargoCapResetCmd: DevCommandDef = {
  name: 'cargo.cap.reset',
  help: `${CAP_RESET_USAGE}  Reset rolling and daily cargo export caps for a colony`,
  async run(a, ctx) {
    const { colonyIndex } = parseColony(a[0]);
    const r = await sim(ctx, 'dev.cargoCapReset', { colonyIndex });
    if (!r.ok && r.code !== 'not_connected') {
      throw new Error(`dev.cargoCapReset rejected: ${r.code}${r.detail ? ` (${r.detail})` : ''}`);
    }
    return `Reset cargo mint caps for colony ${colonyIndex}`;
  },
};

export const tradehubSpawnCmd: DevCommandDef = {
  name: 'tradehub.spawn',
  help: `${TRADEHUB_SPAWN_USAGE}  Spawn an online Trade Hub T1 at (q, r) or free footprint near HQ`,
  async run(a, ctx) {
    let q: number | undefined;
    let r: number | undefined;
    if (a.length >= 2 && a[0] !== undefined && a[0] !== '' && a[1] !== undefined && a[1] !== '') {
      const parsedQ = Number(a[0]);
      const parsedR = Number(a[1]);
      if (Number.isFinite(parsedQ) && Number.isFinite(parsedR)) {
        q = Math.trunc(parsedQ);
        r = Math.trunc(parsedR);
      }
    }

    const simArgs: Record<string, unknown> = { colonyIndex: 0 };
    if (q !== undefined && r !== undefined) {
      simArgs.q = q;
      simArgs.r = r;
    }

    const res = await sim(ctx, 'dev.tradehubSpawn', simArgs);
    if (!res.ok && res.code !== 'not_connected') {
      throw new Error(`dev.tradehubSpawn rejected: ${res.code}${res.detail ? ` (${res.detail})` : ''}`);
    }
    return 'Spawned online Trade Hub T1';
  },
};

export default defineFeature({
  id: 'cargo-dev',
  wave: 'W10',
  devCommands: [cargoGrantCmd, cargoCapResetCmd, tradehubSpawnCmd],
  consoleCommands: [cargoGrantCmd, cargoCapResetCmd, tradehubSpawnCmd],
});

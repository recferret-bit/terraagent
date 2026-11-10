import { T1_RESOURCE_KEYS, TREASURY_EFFECT_KINDS, type BountyReward, type BountyTarget } from '@terra/contracts';
import type { DevCommandDef, FeatureContext } from '../../core/registry/types';
import '../../net/services';
import { serverFor, usage } from '../shared/devCommand';
import { ownColonyIndex, viewColony } from '../shared/colony';

const EFFECT_USAGE = `treasury.effect <${TREASURY_EFFECT_KINDS.join('|')}>`;
const FUND_USAGE = 'treasury.fund <planet> <amount>';
const POST_USAGE =
  'bounty.post clear_nest <nestId> <reward> [resource] | defend_area <q> <r> <radius> <hours> <reward> [resource] | deliver_units <resource> <amount> <reward> [rewardResource]';
const COMPLETE_USAGE = 'bounty.complete <id> [claimerAccount]';
const HIRE_USAGE = 'merc.hire <hours>';

const EFFECTS = new Set<string>(TREASURY_EFFECT_KINDS);
const T1 = new Set<string>(T1_RESOURCE_KEYS);

export interface BountyPostBody {
  readonly planetId: string;
  readonly colonyIndex: number;
  readonly colonyId?: string;
  readonly target: BountyTarget;
  readonly reward: BountyReward;
}

function joinedPlanet(ctx: FeatureContext, line: string): string {
  const id = ctx.services.session?.planetId();
  if (!id) throw new Error(`${line}: not connected to a planet yet`);
  return id;
}

function whole(raw: string | undefined, line: string): number {
  if (!raw || !/^[1-9]\d*$/.test(raw)) usage(line);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) usage(line);
  return n;
}

function signedInt(raw: string | undefined, line: string, min: number, max: number): number {
  if (!raw || !/^-?(?:0|[1-9]\d*)$/.test(raw)) usage(line);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max) usage(line);
  return n;
}

function hoursOf(raw: string | undefined, line: string, max: number): number {
  if (!raw || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) usage(line);
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > max) usage(line);
  return n;
}

function resourceOf(raw: string | undefined, line: string): BountyReward['resource'] {
  const resource = raw ?? 'metals.t1';
  if (!T1.has(resource)) usage(line);
  return resource as BountyReward['resource'];
}

/** Console words for `bounty.post`. Unknown kinds, including anything that is not a bounty target, are a usage error. */
export function parseBountyPost(args: readonly string[]): { target: BountyTarget; reward: BountyReward } {
  const kind = args[0];
  if (kind === 'clear_nest') return clearNest(args);
  if (kind === 'defend_area') return defendArea(args);
  if (kind === 'deliver_units') return deliverUnits(args);
  usage(POST_USAGE);
}

function clearNest(args: readonly string[]): { target: BountyTarget; reward: BountyReward } {
  if (args.length < 3 || args.length > 4) usage(POST_USAGE);
  const nestId = args[1] ?? '';
  if (nestId.length < 1 || nestId.length > 80) usage(POST_USAGE);
  return {
    target: { kind: 'clear_nest', nestId },
    reward: { resource: resourceOf(args[3], POST_USAGE), amount: whole(args[2], POST_USAGE) },
  };
}

function defendArea(args: readonly string[]): { target: BountyTarget; reward: BountyReward } {
  if (args.length < 6 || args.length > 7) usage(POST_USAGE);
  return {
    target: {
      kind: 'defend_area',
      q: signedInt(args[1], POST_USAGE, -32_768, 32_767),
      r: signedInt(args[2], POST_USAGE, -32_768, 32_767),
      radius: signedInt(args[3], POST_USAGE, 1, 8),
      durationH: hoursOf(args[4], POST_USAGE, 48),
    },
    reward: { resource: resourceOf(args[6], POST_USAGE), amount: whole(args[5], POST_USAGE) },
  };
}

function deliverUnits(args: readonly string[]): { target: BountyTarget; reward: BountyReward } {
  if (args.length < 4 || args.length > 5) usage(POST_USAGE);
  const resource = resourceOf(args[1], POST_USAGE);
  return {
    target: { kind: 'deliver_units', resource, amount: whole(args[2], POST_USAGE) },
    reward: { resource: resourceOf(args[4], POST_USAGE), amount: whole(args[3], POST_USAGE) },
  };
}

function seat(ctx: FeatureContext, line: string): { planetId: string; colonyIndex: number; colonyId?: string } {
  const planetId = joinedPlanet(ctx, line);
  const colonyIndex = ownColonyIndex(ctx.services);
  const id = ctx.services.session?.colonyId?.() ?? viewColony(ctx.services.store?.latest, colonyIndex)?.id;
  return { planetId, colonyIndex, ...(id ? { colonyId: id } : {}) };
}

function hqAnchor(ctx: FeatureContext): { q: number; r: number } | undefined {
  const hq = viewColony(ctx.services.store?.latest, ownColonyIndex(ctx.services))?.hq;
  if (!hq || !Number.isInteger(hq.q) || !Number.isInteger(hq.r)) return undefined;
  return { q: hq.q, r: hq.r };
}

export const treasuryEffectCmd: DevCommandDef = {
  name: 'treasury.effect',
  help: `${EFFECT_USAGE}  Server: post system.treasuryEffect for this planet so the badge shows without a vote`,
  async run(a, ctx) {
    if (a.length !== 1 || !EFFECTS.has(a[0] ?? '')) usage(EFFECT_USAGE);
    const kind = a[0] ?? '';
    const planetId = joinedPlanet(ctx, EFFECT_USAGE);
    const r = (await serverFor(ctx, 'treasury.effect')('treasury.effect', { planetId, kind })) as {
      untilTick?: number;
    };
    return `${kind} until tick ${r.untilTick ?? '?'}`;
  },
};

export const treasuryFundCmd: DevCommandDef = {
  name: 'treasury.fund',
  help: `${FUND_USAGE}  Server: deposit whole metals.t1 into that planet's DAO`,
  async run(a, ctx) {
    if (a.length !== 2 || !a[0]) usage(FUND_USAGE);
    const amount = whole(a[1], FUND_USAGE);
    const r = (await serverFor(ctx, 'treasury.fund')('treasury.fund', { planetId: a[0], amount })) as {
      balance?: string;
    };
    return `funded ${a[0]} metals.t1 ${amount} (balance ${r.balance ?? amount})`;
  },
};

export const bountyPostCmd: DevCommandDef = {
  name: 'bounty.post',
  help: `${POST_USAGE}  Server: open escrow for this colony (chain row; reward must be in cargo)`,
  async run(a, ctx) {
    const parsed = parseBountyPost(a);
    const body: BountyPostBody = { ...seat(ctx, POST_USAGE), ...parsed };
    const r = (await serverFor(ctx, 'bounty.post')('bounty.post', body)) as {
      id?: string;
      state?: string;
      escrowId?: string;
    };
    return `posted ${r.id ?? '?'} ${parsed.target.kind} (${r.state ?? 'open'}) escrow ${r.escrowId ?? '?'}`;
  },
};

export const bountyCompleteCmd: DevCommandDef = {
  name: 'bounty.complete',
  help: `${COMPLETE_USAGE}  Server: mark the chain bounty completed and pay it when a claimer exists`,
  async run(a, ctx) {
    if (a.length < 1 || a.length > 2 || !a[0]) usage(COMPLETE_USAGE);
    const id = a[0];
    const claimer = a[1];
    const r = (await serverFor(ctx, 'bounty.complete')('bounty.complete', {
      id,
      ...(claimer ? { claimer } : {}),
    })) as { state?: string; paid?: boolean; claimer?: string | null; note?: string; payError?: string };
    const extra = r.payError ? `; ${r.payError}` : r.note ? `; ${r.note}` : '';
    const who = r.claimer ? ` claimer ${r.claimer}` : '';
    return `bounty ${id} ${r.state ?? 'completed'} (${r.paid ? 'paid' : 'not paid'})${who}${extra}`;
  },
};

export const mercHireCmd: DevCommandDef = {
  name: 'merc.hire',
  help: `${HIRE_USAGE}  Server: spawn the light recon squad around this colony's HQ (no escrow hire)`,
  async run(a, ctx) {
    if (a.length !== 1) usage(HIRE_USAGE);
    const hours = hoursOf(a[0], HIRE_USAGE, 168);
    const placed = seat(ctx, HIRE_USAGE);
    const anchor = hqAnchor(ctx);
    const r = (await serverFor(ctx, 'merc.hire')('merc.hire', {
      planetId: placed.planetId,
      colonyIndex: placed.colonyIndex,
      hours,
      ...(anchor ?? {}),
    })) as { count?: number; endTick?: number; q?: number; r?: number };
    return `hired light squad (${r.count ?? 4} recon) until tick ${r.endTick ?? '?'} at (${r.q ?? '?'},${r.r ?? '?'}); escrow hire is not on this branch`;
  },
};

export const TREASURY_DEV_COMMANDS: readonly DevCommandDef[] = [
  treasuryFundCmd,
  treasuryEffectCmd,
  bountyPostCmd,
  bountyCompleteCmd,
  mercHireCmd,
];

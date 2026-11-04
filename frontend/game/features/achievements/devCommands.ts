import type { DevCommandDef, FeatureContext } from '../../core/registry/types';
import { DevServerError } from '../../net/devServer';
import '../../net/services';
import '../xp';
import { readActivePilot } from './activePilot';
import type { AchievementToastPayload } from './toast';

interface FactAddReply {
  readonly playerId: string;
  readonly family: string;
  readonly value: number;
  readonly unlocked?: readonly AchievementToastPayload[];
  readonly levelUp?: {
    readonly level: number;
    readonly previousLevel?: number;
    readonly xp: number;
    readonly title?: string;
  } | null;
  readonly xp?: number;
  readonly level?: number;
}

interface XpAddReply {
  readonly playerId: string;
  readonly delta: number;
  readonly xp: number;
  readonly level: number;
  readonly title: string;
  readonly levelUp?: {
    readonly level: number;
    readonly previousLevel?: number;
    readonly xp: number;
    readonly title?: string;
  } | null;
}

function resolvePilotId(ctx: FeatureContext): string | undefined {
  const fromTracker = ctx.services.activePilot?.playerId;
  if (fromTracker) return fromTracker;
  return readActivePilot()?.playerId || undefined;
}

function requireServer(ctx: FeatureContext, cmdName: string): NonNullable<FeatureContext['services']['devServer']> {
  const server = ctx.services.devServer;
  if (!server) {
    throw new DevServerError('host_unavailable', `${cmdName} needs the game server; not available on this host`);
  }
  return server;
}

export const factCommand: DevCommandDef = {
  name: 'fact',
  help: 'fact add <family> <n>  Server: increment or update achievement fact <family> by <n>',
  async run(args, ctx) {
    if (args[0] !== 'add' || !args[1] || args[2] === undefined) {
      throw new Error('usage: fact add <family> <n>');
    }
    const family = args[1];
    const delta = Number(args[2]);
    if (!Number.isFinite(delta) || delta <= 0) {
      throw new Error('usage: fact add <family> <n>  (n must be positive)');
    }
    const server = requireServer(ctx, 'fact');
    const playerId = resolvePilotId(ctx);
    const r = (await server('fact.add', {
      ...(playerId ? { playerId } : {}),
      family,
      delta,
    })) as FactAddReply;

    for (const u of r.unlocked ?? []) {
      ctx.services.achievementToasts?.show(u);
    }
    if (r.levelUp) {
      ctx.services.xpToasts?.show(r.levelUp);
    }
    const badgeSummary =
      r.unlocked && r.unlocked.length > 0
        ? ` · unlocked ${r.unlocked.map((u) => `${u.familyName} ${u.tierName} (+${u.xp} XP)`).join(', ')}`
        : '';
    return `fact ${r.family} = ${r.value}${badgeSummary}`;
  },
};

export const xpCommand: DevCommandDef = {
  name: 'xp',
  help: 'xp add <n>  Server: award <n> XP to the current pilot',
  async run(args, ctx) {
    if (args[0] !== 'add' || args[1] === undefined) {
      throw new Error('usage: xp add <n>');
    }
    const delta = Number(args[1]);
    if (!Number.isFinite(delta) || delta <= 0) {
      throw new Error('usage: xp add <n>  (n must be positive)');
    }
    const server = requireServer(ctx, 'xp');
    const playerId = resolvePilotId(ctx);
    const r = (await server('xp.add', {
      ...(playerId ? { playerId } : {}),
      delta,
    })) as XpAddReply;

    if (r.levelUp) {
      ctx.services.xpToasts?.show(r.levelUp);
    }
    return `xp +${r.delta} → ${r.xp} XP (level ${r.level} · ${r.title})`;
  },
};

export const profileCommand: DevCommandDef = {
  name: 'profile',
  help: 'profile reset  Server: reset current pilot facts, achievement unlocks and XP',
  async run(args, ctx) {
    if (args[0] !== 'reset') {
      throw new Error('usage: profile reset');
    }
    const server = requireServer(ctx, 'profile');
    const playerId = resolvePilotId(ctx);
    const r = (await server('profile.reset', {
      ...(playerId ? { playerId } : {}),
    })) as { playerId: string; reset: boolean };
    ctx.services.achievementToasts?.dismiss();
    ctx.services.xpToasts?.dismiss();
    return `profile reset (${r.playerId})`;
  },
};

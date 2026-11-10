import type { DevCommandDef, FeatureContext } from '../../core/registry/types';
import '../../net/services';
import { serverFor } from '../shared/devCommand';
import { ownColonyIndex, viewColony } from '../shared/colony';
import { parseGuildDev, type GuildDevParsed } from './parse';

interface SeatBody {
  readonly planetId: string;
  readonly colonyIndex: number;
  readonly colonyId?: string;
}

function planetOf(ctx: FeatureContext): string {
  const id = ctx.services.session?.planetId();
  if (!id) throw new Error('not connected to a planet yet');
  return id;
}

function seatOf(ctx: FeatureContext): SeatBody {
  const planetId = planetOf(ctx);
  const colonyIndex = ownColonyIndex(ctx.services);
  const fromSession = ctx.services.session?.colonyId?.();
  const colonyId = (fromSession && fromSession.startsWith('co_') ? fromSession : undefined) ?? viewColony(ctx.services.store?.latest, colonyIndex)?.id;
  return { planetId, colonyIndex, ...(colonyId ? { colonyId } : {}) };
}

function send(ctx: FeatureContext, name: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return serverFor(ctx, name)(name, body).then((reply) => reply as Record<string, unknown>);
}

function textOf(parsed: GuildDevParsed, body: Record<string, unknown>): string {
  if (parsed.name === 'guild.summon') return `${String(body.name ?? parsed.npc)} docked — ${Number(body.placed ?? 0)} quotes`;
  if (parsed.name === 'guild.depart') return `${parsed.npc} departed (${Number(body.cleared ?? 0)} docks cleared)`;
  if (parsed.name === 'guild.setInventory') return `${parsed.npc} ${parsed.resource} stock ${Number(body.stock ?? parsed.amount)}`;
  if (parsed.name === 'guild.disable') return `${parsed.npc} quotes killed`;
  if (parsed.name === 'away.simulate') return body.posted === false ? `already ${parsed.on ? 'away' : 'present'}` : `away simulated ${parsed.on ? 'on' : 'off'}`;
  return `director ${String(body.resource ?? parsed.resource)} allowance ${String(body.allowance ?? parsed.amount)} (key replaced)`;
}

function needsPlanet(name: GuildDevParsed['name']): boolean {
  return name === 'guild.summon' || name === 'guild.depart';
}

async function runParsed(ctx: FeatureContext, parsed: GuildDevParsed): Promise<string> {
  const seat = parsed.name === 'away.simulate' || parsed.name === 'director.allowance' ? seatOf(ctx) : null;
  const planetId = needsPlanet(parsed.name) ? planetOf(ctx) : seat?.planetId ?? '';
  const body = await send(ctx, parsed.name, requestOf(parsed, planetId, seat));
  return textOf(parsed, body);
}

function requestOf(parsed: GuildDevParsed, planetId: string, seat: SeatBody | null): Record<string, unknown> {
  if (parsed.name === 'guild.summon' || parsed.name === 'guild.depart') return { planetId, npc: parsed.npc };
  if (parsed.name === 'guild.disable') return { npc: parsed.npc };
  if (parsed.name === 'guild.setInventory') return { npc: parsed.npc, resource: parsed.resource, amount: parsed.amount };
  const body = seat ?? { planetId };
  if (parsed.name === 'away.simulate') return { ...body, on: parsed.on };
  return { ...body, amount: parsed.amount, resource: parsed.resource };
}

function command(name: GuildDevParsed['name'], help: string): DevCommandDef {
  return {
    name,
    help,
    run(args, ctx) {
      return runParsed(ctx, parseGuildDev(name, args));
    },
  };
}

export const guildDevCommands: readonly DevCommandDef[] = [
  command('guild.summon', 'guild.summon <npc>  Dock that Guild NPC now and place its quotes (kestrel, vanguard). Server.'),
  command('guild.depart', 'guild.depart <npc>  Depart that Guild NPC now and drop its quotes. Server.'),
  command('guild.setInventory', 'guild.setInventory <npc> <res> <amt>  Set carried Tier-1 stock. Never negative. Server.'),
  command('guild.disable', 'guild.disable <npc>  Kill that NPC\'s quotes. Server.'),
  command('away.simulate', 'away.simulate on|off  Post system.presence. The director loop reads that blob. Server.'),
  command('director.allowance', 'director.allowance [resource] <amt>  Replace the director key allowance (default metals.t1). Server.'),
];

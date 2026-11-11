import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { defineDevCommand, type DevCommand, DevCommandRegistry } from '../../../dev/dev-command.registry.js';
import { GuildDevService } from './guild-dev.service.js';

const planetNpc = z.object({ planetId: z.string().min(1).max(64), npc: z.string().min(1).max(64) }).strict();
const npcOnly = z.object({ npc: z.string().min(1).max(64) }).strict();
const stock = z.object({
  npc: z.string().min(1).max(64),
  resource: z.string().min(1).max(64),
  amount: z.number().int().nonnegative(),
}).strict();
const away = z.object({
  planetId: z.string().min(1),
  on: z.boolean(),
  colonyIndex: z.number().int().nonnegative().optional(),
  colonyId: z.string().min(1).optional(),
}).strict();
const allowance = z.object({
  amount: z.number().int().nonnegative(),
  resource: z.string().min(1).max(64).optional(),
  colonyId: z.string().min(1).optional(),
  planetId: z.string().min(1).optional(),
  colonyIndex: z.number().int().nonnegative().optional(),
}).strict();

/** Server side of the W15 dev console. 404 in production, same as the other dev commands. */
@Injectable()
export class GuildDevCommand implements OnModuleInit {
  constructor(
    private readonly registry: DevCommandRegistry,
    private readonly dev: GuildDevService,
  ) {}

  onModuleInit(): void {
    this.bind('guild.summon', 'Dock a Guild NPC now and place its quotes: {planetId, npc:"kestrel"|"vanguard"}', planetNpc, ({ planetId, npc }) => this.dev.summon(planetId, npc));
    this.bind('guild.depart', 'Depart a Guild NPC now and drop its quotes: {planetId, npc}', planetNpc, ({ planetId, npc }) => this.dev.depart(planetId, npc));
    this.bind('guild.setInventory', 'Set one Tier-1 resource on a Guild NPC (never negative): {npc, resource, amount}', stock, ({ npc, resource, amount }) => this.dev.setInventory(npc, resource, amount));
    this.bind('guild.disable', 'Kill one Guild NPC\'s quotes: {npc}', npcOnly, ({ npc }) => this.dev.disable(npc));
    this.bind('away.simulate', 'Post system.presence so the director loop\'s away read flips: {planetId, on:true|false, colonyIndex?, colonyId?}', away, (args) => this.dev.simulateAway(args));
    this.bind('director.allowance', 'Replace the director key so one Tier-1 allowance (default metals.t1) is {amount}', allowance, (args) => this.dev.setAllowance(args));
  }

  private bind<S extends z.ZodType>(name: string, help: string, args: S, run: (value: z.output<S>) => unknown): void {
    const command: DevCommand<S> = { name, help, args, run };
    this.registry.register(defineDevCommand(command));
  }
}

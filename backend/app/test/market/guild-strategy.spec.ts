import { compileData, guildPolicy } from '@terra/sim';
import { describe, expect, it, vi } from 'vitest';
import { LlmProviderPort, type LlmResponse } from '../../src/ports/llm-provider.port.js';
import { DeterministicGuildStrategy, guildRouteToken } from '../../src/market/guild/strategy/deterministic.js';
import { LlmGuildStrategy } from '../../src/market/guild/strategy/llm.js';
import {
  GuildStrategyPort,
  parseGuildStrategy,
  type GuildStrategyChoice,
  type GuildStrategyClock,
  type GuildStrategyNpc,
} from '../../src/market/guild/strategy/port.js';

const NPC: GuildStrategyNpc = { id: 'kestrel' };
const CLOCK: GuildStrategyClock = { nowMs: 1_700_000_000_000 };
const LATER: GuildStrategyClock = { nowMs: CLOCK.nowMs + 86_400_000 };

const SAMPLE: GuildStrategyChoice = {
  route: 'loop-local',
  stockpile: [{ resource: 'metals.t1', target: 2500 }],
  specialisation: 'balanced',
  risk: 'conservative',
};

function rosterNpc(id: string) {
  const npc = guildPolicy(compileData(new Set(['W15']))).roster.find((row) => row.id === id);
  if (!npc) throw new Error(`missing ${id}`);
  return npc;
}

function fakeLlm(text: () => string, calls: { n: number }): LlmProviderPort {
  return new (class extends LlmProviderPort {
    complete(): Promise<LlmResponse> {
      calls.n += 1;
      return Promise.resolve({ text: text(), usage: { inputTokens: 0, outputTokens: 0 }, model: 'fake' });
    }
  })();
}

class FakeGuildStrategy extends GuildStrategyPort {
  choose(): Promise<GuildStrategyChoice> {
    return Promise.resolve({ ...SAMPLE, route: 'fake-hop', specialisation: 'miner', risk: 'moderate' });
  }
}

async function routeOf(port: GuildStrategyPort, npc: GuildStrategyNpc = NPC): Promise<string> {
  return (await port.choose(npc, CLOCK)).route;
}

function rejectCode(raw: unknown): string {
  const parsed = parseGuildStrategy(raw);
  if (parsed.ok) throw new Error('expected reject');
  return parsed.code;
}

function silence(): Array<ReturnType<typeof vi.spyOn>> {
  return (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) =>
    vi.spyOn(console, name).mockImplementation(() => undefined),
  );
}

describe('Guild strategy port (W15-13)', () => {
  it('deterministic strategy is stable and uses the guild table targets', async () => {
    const strategy = new DeterministicGuildStrategy();
    const kestrel = rosterNpc('kestrel');
    const first = await strategy.choose(NPC, CLOCK);
    const second = await strategy.choose(NPC, LATER);
    expect(second).toEqual(first);
    expect(first.route).toBe(guildRouteToken(kestrel.id, kestrel.route));
    expect(first.route).toBe(kestrel.route[0]);
    expect(first.stockpile).toEqual(kestrel.pairs.map((resource) => ({ resource, target: kestrel.targets[resource] })));
    expect(first.specialisation).toBe('balanced');
    expect(first.risk).toBe('conservative');
    expect(first).not.toHaveProperty('price');
    expect(first).not.toHaveProperty('free_price');
    expect(parseGuildStrategy(first)).toEqual({ ok: true, value: first });

    const vanguard = rosterNpc('vanguard');
    const other = await strategy.choose({ id: 'vanguard' }, { nowMs: 0 });
    expect(other.route).toBe(guildRouteToken('vanguard', vanguard.route));
    expect(other.stockpile).toEqual(
      vanguard.pairs.map((resource) => ({ resource, target: vanguard.targets[resource] })),
    );
    expect(await strategy.choose({ id: 'vanguard' }, LATER)).toEqual(other);
    expect(guildRouteToken('kestrel', ['alpha', 'beta'])).toBe(guildRouteToken('kestrel', ['alpha', 'beta']));
  });

  it('a fake strategy changes the route', async () => {
    expect(await routeOf(new FakeGuildStrategy())).toBe('fake-hop');
    expect(await routeOf(new FakeGuildStrategy())).not.toBe(await routeOf(new DeterministicGuildStrategy()));
  });

  it('rejects a payload that contains price or free_price', () => {
    expect(rejectCode({ ...SAMPLE, price: 4 })).toBe('price');
    const nested = {
      ...SAMPLE,
      stockpile: [{ resource: 'metals.t1', target: 2500, free_price: 9 }],
    };
    expect(rejectCode(nested)).toBe('free_price');
    expect(rejectCode({ ...SAMPLE, stockpile: [{ resource: 'bio.water', target: 1, price: 1 }] })).toBe('price');
  });

  it('rejects an empty stockpile', () => {
    expect(parseGuildStrategy({ ...SAMPLE, stockpile: [] })).toEqual({ ok: false, code: 'empty_stockpile' });
    expect(rejectCode({ route: 'loop-local', specialisation: 'balanced', risk: 'conservative' })).toBe(
      'empty_stockpile',
    );
  });

  it('W16 off does not call a fake LLM or log', async () => {
    const calls = { n: 0 };
    const port = fakeLlm(() => JSON.stringify(SAMPLE), calls);
    const spies = silence();
    try {
      await expect(new LlmGuildStrategy(port).choose(NPC, CLOCK)).rejects.toMatchObject({
        code: 'w16_off',
        message: 'unused',
      });
      await expect(new LlmGuildStrategy(port, false).choose(NPC, LATER)).rejects.toMatchObject({ code: 'w16_off' });
      expect(calls.n).toBe(0);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('unknown npc is rejected and does not invent targets', async () => {
    await expect(new DeterministicGuildStrategy().choose({ id: 'osprey' }, CLOCK)).rejects.toMatchObject({
      code: 'unknown_npc',
    });
  });
});

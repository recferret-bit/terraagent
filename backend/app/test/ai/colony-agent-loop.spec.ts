import { parseWaves, type SimCommandV1 } from '@terra/contracts';
import { createPlanet, createRegistryPipeline, seedRivalAiColonies, SimHost, snapshot } from '@terra/sim';
import { describe, expect, it, vi } from 'vitest';
import { ColonyAgentLoopService } from '../../src/ai/colony-agent/colony-agent-loop.service.js';
import { CoreException } from '../../src/core/errors/index.js';
import type { FlagsService } from '../../src/flags/flags.service.js';
import type { AwayDigestService } from '../../src/game/digest/index.js';
import type { GamePlanets } from '../../src/game/game-planets.service.js';
import { StakingController } from '../../src/near/staking/staking.controller.js';
import type { StakingService } from '../../src/near/staking/staking.service.js';
import type { LlmProviderPort, LlmResponse } from '../../src/ports/llm-provider.port.js';

function createFakePlanetHarness() {
  const flags = parseWaves('..22').list;
  const host = new SimHost(createRegistryPipeline({ flags }));
  host.load(
    createPlanet({
      id: 'pl_loop',
      planetId: 'pl_loop',
      type: 'temperate',
      planetType: 'temperate',
      seed: 'loop-seed',
      radius: 26,
      capacity: 6,
    }),
  );
  host.submit({
    colonyIndex: 0,
    source: 'system',
    commandId: 'spawn_0',
    kind: 'system.spawnColony',
    args: { colonyId: 'col_0', colonyIndex: 0, name: 'Human Colony', unlockStage: 0 },
  });
  host.step(1);
  seedRivalAiColonies(host.state, { count: 2, capacity: 6, tick: host.tick });

  const submitted: SimCommandV1[] = [];
  const planets = {
    fullState: async () => ({
      planetId: 'pl_loop',
      tick: host.tick,
      bytes: snapshot(host.state),
      simVersion: 1,
      dataHash: 'h',
      planetType: 'temperate',
      warp: 1,
    }),
    submit: async (_planetId: string, cmd: SimCommandV1) => {
      submitted.push(cmd);
      host.submit(cmd);
      const out = host.step(1).outcomes[0];
      return out?.code
        ? { ok: false as const, commandId: cmd.commandId, code: out.code }
        : { ok: true as const, commandId: cmd.commandId, appliedAtTick: host.tick };
    },
  } as unknown as GamePlanets;

  return { host, planets, submitted };
}

describe('ColonyAgentLoopService — human manual gate, NEAR AI Cloud attestation & guardrails', () => {
  it('skips online manual human colonies while governing Rival AIs and preserving TEE attestation', async () => {
    const { planets, submitted } = createFakePlanetHarness();
    const llm: LlmProviderPort = {
      complete: async (): Promise<LlmResponse> => ({
        text: JSON.stringify({ action: 'queue_goal', goal: 'terraform_zone', rationale: 'Cultivate Living hexes.' }),
        usage: { inputTokens: 40, outputTokens: 25 },
        model: 'deepseek-ai/DeepSeek-V3.1',
        attestation: {
          chatId: 'chat_1',
          requestHash: 'a'.repeat(64),
          responseHash: 'b'.repeat(64),
          signingAddress: '0xtee',
          verified: true,
        },
      }),
    };
    const svc = new ColonyAgentLoopService(planets, llm);
    const evals = await svc.tickPlanetAgents('pl_loop');
    const human = evals.find((e) => e.colonyIndex === 0);
    const trader = evals.find((e) => e.colonyIndex === 4);

    expect(human?.governed).toBe(false);
    expect(human?.reason).toBe('manual_human_control');
    expect(trader?.governed).toBe(true);
    expect(trader?.attestation?.verified).toBe(true);
    expect(submitted.some((c) => c.colonyIndex === 0)).toBe(false);
    expect(submitted.some((c) => c.colonyIndex === 4 && c.kind === 'queueGoal')).toBe(true);
  });

  it('blocks cancel_truce (AW-13), stake (D-18), and kill-switched trades, and records offline digest highlights', async () => {
    const { host, planets } = createFakePlanetHarness();
    host.submit({
      colonyIndex: 0,
      source: 'system',
      commandId: 'away_0',
      kind: 'system.presence',
      args: { colonyId: 'col_0', away: true },
    });
    host.step(1);

    const replies = [
      { action: 'queue_goal', goal: 'grow_economy', rationale: 'Harvested metals while offline.' },
      { action: 'cancel_truce', rationale: 'Attempt illegal oathbreaker.' },
      { action: 'trade', tradePair: 'metals.t1/minerals.t1', tradeAmount: 10, tradeNotionalAtomic: '9999999999', rationale: 'Oversized order.' },
    ];
    let idx = 0;
    const llm: LlmProviderPort = {
      complete: async () => ({
        text: JSON.stringify(replies[idx++ % replies.length]),
        usage: { inputTokens: 10, outputTokens: 10 },
        model: 'mock',
      }),
    };
    const noteHighlight = vi.fn().mockResolvedValue(true);
    const digests = { noteHighlight } as unknown as AwayDigestService;
    const svc = new ColonyAgentLoopService(planets, llm, digests);

    const evals = await svc.tickPlanetAgents('pl_loop', {
      allowanceByColony: {
        5: {
          allowedPairs: ['metals.t1/minerals.t1'],
          maxOrderNotional: '100',
          maxOpenOrders: 1,
          dailyBudget: '100',
          priceBandBp: null,
          killSwitch: true,
        },
      },
    });
    expect(noteHighlight).toHaveBeenCalledOnce();
    expect(evals.find((e) => e.colonyIndex === 4)?.guardrailRejected).toBe('AW-13_CANCEL_TRUCE_FORBIDDEN');
    expect(evals.find((e) => e.colonyIndex === 5)?.guardrailRejected).toBe('kill_switch');
  });

  it('executes allowed barter trade directives on the live planet sim via market.placeOrder', async () => {
    const { planets, submitted } = createFakePlanetHarness();
    const llm: LlmProviderPort = {
      complete: async (): Promise<LlmResponse> => ({
        text: JSON.stringify({
          action: 'trade',
          tradePair: 'metals.t1/bio.water',
          tradeAmount: 25,
          tradeNotionalAtomic: '25000000',
          rationale: 'Bartering surplus metals.t1 for scarce bio.water.',
        }),
        usage: { inputTokens: 20, outputTokens: 20 },
        model: 'mock',
      }),
    };
    const svc = new ColonyAgentLoopService(planets, llm);
    const evals = await svc.tickPlanetAgents('pl_loop');
    const trader = evals.find((e) => e.colonyIndex === 4);
    expect(trader?.governed).toBe(true);
    expect(trader?.guardrailRejected).toBeUndefined();
    expect(trader?.submittedCommand?.kind).toBe('market.placeOrder');
    expect(trader?.commandOutcome).toEqual({ ok: true });
    expect(submitted.some((c) => c.colonyIndex === 4 && c.kind === 'market.placeOrder')).toBe(true);
  });
});

describe('StakingController — D-18 human-only guardrail', () => {
  it('rejects AI / director / agent staking calls with 403 AI_STAKING_FORBIDDEN', () => {
    const stakingSvc = { stake: vi.fn(), unstake: vi.fn(), withdraw: vi.fn(), getStatus: vi.fn() } as unknown as StakingService;
    const flags = { has: () => true } as unknown as FlagsService;
    const ctl = new StakingController(stakingSvc, flags);

    let thrown: unknown;
    try {
      ctl.stake({ colonyId: 'col_0', amountYocto: '1000000000000000000000000' }, 'ai');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(CoreException);
    expect((thrown as CoreException).errorCode).toBe('AI_STAKING_FORBIDDEN');
    expect((thrown as CoreException).status).toBe(403);
    expect(stakingSvc.stake).not.toHaveBeenCalled();
  });
});

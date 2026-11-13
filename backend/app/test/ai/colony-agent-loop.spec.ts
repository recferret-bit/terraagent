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
import type { LlmProviderPort, LlmRequest, LlmResponse } from '../../src/ports/llm-provider.port.js';
import { PlayerAiSettingsStore } from '../../src/profile/player-ai-settings.store.js';

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

describe('ColonyAgentLoopService — batching, cooldown cache & player NEAR.AI key routing', () => {
  it('batches all Rival AI bots into a single NEAR.AI (z-ai/glm-5.3-flash) request and caches unchanged states', async () => {
    const { planets } = createFakePlanetHarness();
    const requests: LlmRequest[] = [];
    const llm: LlmProviderPort = {
      complete: async (req): Promise<LlmResponse> => {
        requests.push(req);
        return {
          text: JSON.stringify({
            directives: [
              {
                colonyIndex: 4,
                action: 'queue_goal',
                goal: 'grow_economy',
                rationale: 'Batch directive for Iron Guild Outpost.',
              },
              {
                colonyIndex: 5,
                action: 'queue_goal',
                goal: 'secure_power',
                rationale: 'Batch directive for Crimson Vanguard.',
              },
            ],
          }),
          usage: { inputTokens: 80, outputTokens: 45 },
          model: req.model ?? 'z-ai/glm-5.3-flash',
        };
      },
    };
    const svc = new ColonyAgentLoopService(planets, llm);
    const firstEvals = await svc.tickPlanetAgents('pl_loop', { useCache: true, nowMs: 1_000 });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.model).toBe('z-ai/glm-5.3-flash');
    expect(firstEvals.find((e) => e.colonyIndex === 4)?.directive?.goal).toBe('grow_economy');
    expect(firstEvals.find((e) => e.colonyIndex === 5)?.directive?.goal).toBe('secure_power');

    // Second sweep within cooldown window reuses cached decisions with 0 new LLM calls
    const cachedEvals = await svc.tickPlanetAgents('pl_loop', { useCache: true, nowMs: 30_000 });
    expect(requests).toHaveLength(1);
    expect(cachedEvals.find((e) => e.colonyIndex === 4)?.cached).toBe(true);
    expect(cachedEvals.find((e) => e.colonyIndex === 5)?.cached).toBe(true);
  });

  it('uses server NEAR.AI only for bots, and routes player bots through the player connected NEAR.AI API key + model', async () => {
    const { host, planets } = createFakePlanetHarness();
    host.state.colonies[0]!.aiEnabled = true;

    const store = new PlayerAiSettingsStore();
    store.bindColonyPlayer('pl_loop', 0, 'player_1');

    const requests: LlmRequest[] = [];
    const llm: LlmProviderPort = {
      complete: async (req): Promise<LlmResponse> => {
        requests.push(req);
        const body = JSON.parse(req.messages[0]?.content ?? '{}') as { colonies?: Array<{ colonyIndex: number }> };
        const indices = body.colonies?.map((c) => c.colonyIndex) ?? [];
        return {
          text: JSON.stringify({
            directives: indices.map((colonyIndex) => ({
              colonyIndex,
              action: 'queue_goal',
              goal: 'grow_economy',
              rationale: `LLM governed col_${colonyIndex}.`,
            })),
          }),
          usage: { inputTokens: 50, outputTokens: 30 },
          model: req.model ?? 'z-ai/glm-5.3-flash',
        };
      },
    };

    const svc = new ColonyAgentLoopService(planets, llm, undefined, undefined, undefined, store);

    // 1. Without a connected player API key: human colony 0 uses deterministic policy; only bots (4, 5) call LLM
    const evalsNoKey = await svc.tickPlanetAgents('pl_loop');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.apiKey).toBeUndefined();
    expect(requests[0]?.model).toBe('z-ai/glm-5.3-flash');
    const humanNoKey = evalsNoKey.find((e) => e.colonyIndex === 0);
    expect(humanNoKey?.governed).toBe(true);
    expect(humanNoKey?.usedPlayerKey).toBe(false);
    expect(humanNoKey?.model).toBe('deterministic-policy');

    // 2. Player connects their own NEAR.AI key + selects model on /me: colony 0 now uses player's key & model
    await store.updateSettings(
      { id: 'player_1', handle: 'pilot1' },
      { apiKey: 'sk-player-personal-nearai-key', model: 'deepseek/deepseek-v3.2' },
    );

    const evalsWithKey = await svc.tickPlanetAgents('pl_loop');
    expect(requests).toHaveLength(3); // +1 batched call for bots (4,5) and +1 batched call for player_1 (0)
    const playerReq = requests.find((r) => r.apiKey === 'sk-player-personal-nearai-key');
    expect(playerReq).toBeDefined();
    expect(playerReq?.model).toBe('deepseek/deepseek-v3.2');
    const humanWithKey = evalsWithKey.find((e) => e.colonyIndex === 0);
    expect(humanWithKey?.usedPlayerKey).toBe(true);
    expect(humanWithKey?.model).toBe('deepseek/deepseek-v3.2');
  });
});

describe('ColonyAgentLoopService — staker Managed NEAR.AI Autopilot', () => {
  it('unlocks managed server NEAR.AI Autopilot for human colonies staking >= 10 NEAR even without a personal BYOK key', async () => {
    const { host, planets } = createFakePlanetHarness();
    host.state.colonies[0]!.aiEnabled = true;

    const store = new PlayerAiSettingsStore();
    store.bindColonyPlayer('pl_loop', 0, 'staker_pilot');

    const seenBatches: number[][] = [];
    const llm: LlmProviderPort = {
      complete: async (req): Promise<LlmResponse> => {
        const body = JSON.parse(req.messages[0]?.content ?? '{}') as { colonies?: Array<{ colonyIndex: number }> };
        const indices = body.colonies?.map((c) => c.colonyIndex) ?? [];
        seenBatches.push(indices);
        return {
          text: JSON.stringify({
            directives: indices.map((colonyIndex) => ({
              colonyIndex,
              action: 'queue_goal',
              goal: 'grow_economy',
              rationale: `Managed NEAR.AI Autopilot for col_${colonyIndex}.`,
            })),
          }),
          usage: { inputTokens: 60, outputTokens: 30 },
          model: req.model ?? 'z-ai/glm-5.3-flash',
        };
      },
    };

    const svc = new ColonyAgentLoopService(planets, llm, undefined, undefined, undefined, store);

    const unstaked = await svc.tickPlanetAgents('pl_loop', { stakedByColony: { 0: false } });
    expect(unstaked.find((e) => e.colonyIndex === 0)?.model).toBe('deterministic-policy');

    const staked = await svc.tickPlanetAgents('pl_loop', { stakedByColony: { 0: true } });
    const col0 = staked.find((e) => e.colonyIndex === 0);
    expect(col0?.governed).toBe(true);
    expect(col0?.usedPlayerKey).toBe(false);
    expect(col0?.model).toBe('z-ai/glm-5.3-flash');
    expect(seenBatches.at(-1)).toContain(0);
  });
});

describe('ColonyAgentLoopService — sim playerId resolution, cache invalidation & batch error fallback', () => {
  it('resolves col.playerId from sim state and invalidates cached decisions when player updates NEAR.AI key/model', async () => {
    const { host, planets } = createFakePlanetHarness();
    host.state.colonies[0]!.aiEnabled = true;
    host.state.colonies[0]!.playerId = 'player_sim_owner';

    const store = new PlayerAiSettingsStore();
    const requests: LlmRequest[] = [];
    const llm: LlmProviderPort = {
      complete: async (req): Promise<LlmResponse> => {
        requests.push(req);
        const body = JSON.parse(req.messages[0]?.content ?? '{}') as { colonies?: Array<{ colonyIndex: number }> };
        const indices = body.colonies?.map((c) => c.colonyIndex) ?? [];
        return {
          text: JSON.stringify({
            directives: indices.map((colonyIndex) => ({
              colonyIndex,
              action: 'queue_goal',
              goal: 'grow_economy',
              rationale: `LLM governed col_${colonyIndex}.`,
            })),
          }),
          usage: { inputTokens: 40, outputTokens: 20 },
          model: req.model ?? 'z-ai/glm-5.3',
        };
      },
    };

    const svc = new ColonyAgentLoopService(planets, llm, undefined, undefined, undefined, store);

    // 1. Initial tick with useCache at t=10_000 (no player key -> deterministic-policy cached)
    const first = await svc.tickPlanetAgents('pl_loop', { useCache: true, nowMs: 10_000 });
    expect(first.find((e) => e.colonyIndex === 0)?.model).toBe('deterministic-policy');

    // 2. Player connects key at t=20_000 (within 120s cooldown) -> cache invalidated for colony 0, LLM called!
    await store.updateSettings(
      { id: 'player_sim_owner', handle: 'sim_owner' },
      { apiKey: 'sk-owner-key-1111', model: 'z-ai/glm-5.3' },
    );
    const second = await svc.tickPlanetAgents('pl_loop', { useCache: true, nowMs: 20_000 });
    const col0Second = second.find((e) => e.colonyIndex === 0);
    expect(col0Second?.cached).toBeFalsy();
    expect(col0Second?.usedPlayerKey).toBe(true);
    expect(col0Second?.model).toBe('z-ai/glm-5.3');
    // Bots (4, 5) remained cached at t=20_000!
    expect(second.find((e) => e.colonyIndex === 4)?.cached).toBe(true);
  });

  it('falls back to deterministic-policy in 1 request when batch LLM returns empty/error without N-1 retries', async () => {
    const { planets } = createFakePlanetHarness();
    let callCount = 0;
    const llm: LlmProviderPort = {
      complete: async (): Promise<LlmResponse> => {
        callCount += 1;
        throw new Error('401 Unauthorized');
      },
    };
    const svc = new ColonyAgentLoopService(planets, llm);
    const evals = await svc.tickPlanetAgents('pl_loop');
    expect(callCount).toBe(1);
    expect(evals.find((e) => e.colonyIndex === 4)?.model).toBe('deterministic-policy');
    expect(evals.find((e) => e.colonyIndex === 5)?.model).toBe('deterministic-policy');
  });
});

describe('ColonyAgentLoopService — war, diplomacy & trade directives', () => {
  it('supports declare_war / raid, propose_truce, respond_truce, and accept_guild_offer directives', async () => {
    const { planets, submitted } = createFakePlanetHarness();
    const llm: LlmProviderPort = {
      complete: async (): Promise<LlmResponse> => ({
        text: JSON.stringify({
          directives: [
            {
              colonyIndex: 4,
              action: 'propose_truce',
              targetColonyIndex: 5,
              durationHours: 6,
              rationale: 'Trader proposing 6h bilateral peace truce with rival.',
            },
            {
              colonyIndex: 5,
              action: 'declare_war',
              targetColonyIndex: 4,
              rationale: 'Warlord declaring war and dispatching raid squad.',
            },
          ],
        }),
        usage: { inputTokens: 60, outputTokens: 40 },
        model: 'z-ai/glm-5.3',
      }),
    };
    const svc = new ColonyAgentLoopService(planets, llm);
    const evals = await svc.tickPlanetAgents('pl_loop');
    const trader = evals.find((e) => e.colonyIndex === 4);
    const warlord = evals.find((e) => e.colonyIndex === 5);

    expect(trader?.submittedCommand?.kind).toBe('diplomacy.proposeTruce');
    expect(trader?.commandOutcome?.ok).toBe(true);
    expect(warlord?.submittedCommand?.kind).toBe('raid');
    expect(warlord?.commandOutcome?.ok).toBe(true);
    expect(submitted.some((c) => c.colonyIndex === 4 && c.kind === 'diplomacy.proposeTruce')).toBe(true);
    expect(submitted.some((c) => c.colonyIndex === 5 && c.kind === 'raid')).toBe(true);
  });

  it('supports USDC pairs (metals.t1/USDC) with atomic quote amounts on market.placeOrder', async () => {
    const { planets, submitted } = createFakePlanetHarness();
    const llm: LlmProviderPort = {
      complete: async (): Promise<LlmResponse> => ({
        text: JSON.stringify({
          directives: [
            {
              colonyIndex: 4,
              action: 'trade',
              tradePair: 'metals.t1/USDC',
              tradeSide: 'sell',
              tradeAmount: 10,
              rationale: 'Selling surplus orbital metals for USDC.',
            },
          ],
        }),
        usage: { inputTokens: 40, outputTokens: 25 },
        model: 'z-ai/glm-5.3',
      }),
    };
    const svc = new ColonyAgentLoopService(planets, llm);
    const evals = await svc.tickPlanetAgents('pl_loop');
    const trader = evals.find((e) => e.colonyIndex === 4);
    expect(trader?.submittedCommand?.kind).toBe('market.placeOrder');
    expect(trader?.commandOutcome?.ok).toBe(true);
    const orderCmd = submitted.find((c) => c.colonyIndex === 4 && c.kind === 'market.placeOrder') as
      | { args: { amount: number; price: { token: string; amount: string } } }
      | undefined;
    expect(orderCmd?.args.amount).toBe(10);
    expect(orderCmd?.args.price).toEqual({ token: 'USDC', amount: '10000000' });
  });

  it('uses NEAR_AI_MODEL from APP_ENV for Rival AI bot batches', async () => {
    const { planets } = createFakePlanetHarness();
    const seenModels: Array<string | undefined> = [];
    const llm: LlmProviderPort = {
      complete: async (req: LlmRequest): Promise<LlmResponse> => {
        seenModels.push(req.model);
        return {
          text: JSON.stringify({
            directives: [
              { colonyIndex: 4, action: 'hold', rationale: 'Wait.' },
              { colonyIndex: 5, action: 'hold', rationale: 'Wait.' },
            ],
          }),
          usage: { inputTokens: 20, outputTokens: 10 },
          model: req.model ?? 'z-ai/glm-5.3',
        };
      },
    };
    const svc = new ColonyAgentLoopService(planets, llm, undefined, undefined, {
      NEAR_AI_MODEL: 'deepseek/deepseek-v3.2',
    } as never);
    await svc.tickPlanetAgents('pl_loop');
    expect(seenModels).toEqual(['deepseek/deepseek-v3.2']);
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

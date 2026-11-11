import 'reflect-metadata';
import type { DirectorKeyStatusPayload } from '@terra/contracts';
import { createState, snapshot } from '@terra/sim';
import { writeAutoTradeLimits } from '@terra/sim/systems/trade/autotrade/store';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/bus/event-bus.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import type { GamePlanets } from '../../src/game/game-planets.service.js';
import {
  AgentWalletPort,
  type AddLimitedKeyInput,
  type AllowanceOpInput,
  type AllowanceOpResult,
  type CreateSubAccountInput,
  type CreateSubAccountResult,
  type KeyStatus,
  type KeyStatusQuery,
  type RevokeKeyInput,
} from '../../src/near/application/ports/agent-wallet.port.js';
import type { ChainReceipt } from '../../src/near/domain/types.js';
import { DirectorKeyController } from '../../src/near/director-key/director-key.controller.js';
import type { DirectorKeyRepository, DirectorKeyRow, DirectorKeySave, OwnedColony } from '../../src/near/director-key/director-key.repository.js';
import { DirectorKeyService } from '../../src/near/director-key/director-key.service.js';
import { devBearerPlayer } from '../../src/ws/session-verifier.js';

const receipt: ChainReceipt = { txHash: 'mock:1', status: 'success', network: 'mock', at: 0 };
const owner = devBearerPlayer('dev:owner')!;
const stranger = devBearerPlayer('dev:other')!;

function limit(maxPerSession: number) {
  return { maxPerTrade: Math.min(300, maxPerSession), maxPerSession, minStock: 0, partners: 'guild' as const };
}

function asBearer(token: string): IncomingMessage {
  return { headers: { authorization: `Bearer ${token}` } } as IncomingMessage;
}

class FakeWallet extends AgentWalletPort {
  readonly adds: AddLimitedKeyInput[] = [];
  revoked = false;
  createSubAccount(_input: CreateSubAccountInput): Promise<CreateSubAccountResult> { throw new Error('unused'); }
  addLimitedKey(input: AddLimitedKeyInput): Promise<ChainReceipt> { this.adds.push(input); return Promise.resolve(receipt); }
  revokeKey(_input: RevokeKeyInput): Promise<ChainReceipt> { this.revoked = true; return Promise.resolve(receipt); }
  keyStatus(input: KeyStatusQuery): Promise<KeyStatus> {
    const added = this.adds.find((row) => row.accountId === input.accountId && row.publicKey === input.publicKey);
    if (!added) return Promise.reject(new Error('missing key'));
    return Promise.resolve({
      accountId: input.accountId,
      publicKey: input.publicKey,
      revoked: this.revoked,
      receiverId: added.receiverId,
      methodNames: added.methodNames,
      tokens: (added.tokens ?? []).map((row) => ({ token: row.token, allowance: row.allowance, reserved: '0', spent: '0', available: row.allowance })),
      gasAllowance: added.allowance,
      gasSpent: '0',
    });
  }
  reserveAllowance(_input: AllowanceOpInput): Promise<AllowanceOpResult> { throw new Error('unused'); }
  consumeAllowance(_input: AllowanceOpInput): Promise<AllowanceOpResult> { throw new Error('unused'); }
  releaseAllowance(_input: AllowanceOpInput): Promise<AllowanceOpResult> { throw new Error('unused'); }
}

class MemoryKeys {
  ownerCalls = 0;
  readonly saves: DirectorKeySave[] = [];
  private readonly rows = new Map<string, DirectorKeyRow>();
  private readonly owners = new Map<string, string>();
  seat(colonyId: string, playerId: string): void { this.owners.set(colonyId, playerId); }
  async requireOwner(colonyId: string, playerId: string): Promise<OwnedColony> {
    this.ownerCalls += 1;
    const found = this.owners.get(colonyId);
    if (!found) throw Object.assign(new Error('Colony not found'), { status: 404, errorCode: 'NOT_FOUND' });
    if (found !== playerId) throw Object.assign(new Error('not owner'), { status: 403, errorCode: 'NEAR_NOT_OWNER' });
    return { colonyId, playerId, planetId: 'pl_blob', colonyIndex: 0 };
  }
  async find(colonyId: string): Promise<DirectorKeyRow | null> { return this.rows.get(colonyId) ?? null; }
  async accountIdFor(colonyId: string): Promise<string> { return `${colonyId}.dir.terraagent.mock`; }
  async save(row: DirectorKeySave): Promise<void> {
    this.saves.push(row);
    this.rows.set(row.colonyId, { colonyId: row.colonyId, accountId: row.accountId, publicKey: row.publicKey, revokedAt: row.revokedAt });
  }
}

function harness(waves = 'all', planets?: GamePlanets) {
  const wallet = new FakeWallet();
  const repo = new MemoryKeys();
  const bus = new EventBus();
  const pushed: DirectorKeyStatusPayload[] = [];
  bus.on('director.status', (ev) => pushed.push(ev.payload), { module: 'test' });
  const keys = new DirectorKeyService(new FlagsService({ TA_WAVES: waves } as never), wallet, repo as unknown as DirectorKeyRepository, bus, planets);
  return { wallet, repo, pushed, controller: new DirectorKeyController(keys) };
}

describe('W15-18 director key', () => {
  it('turns maxPerSession 600 into token allowance 600 and does not spend gas', async () => {
    const { controller, wallet, repo, pushed } = harness();
    repo.seat('co_600', owner.id);
    const got = await controller.add(asBearer('dev:owner'), {
      colonyId: 'co_600',
      limits: { 'metals.t1': limit(600), 'minerals.t1': limit(10), 'bio.water': limit(5) },
    });
    expect(wallet.adds[0]?.tokens).toEqual([
      { token: 'metals.t1', allowance: '600' },
      { token: 'minerals.t1', allowance: '10' },
      { token: 'bio.water', allowance: '5' },
    ]);
    expect(wallet.adds[0]?.allowance).toBe('0');
    expect(repo.saves[0]?.allowance).toBe('600');
    expect(got.state).toBe('active');
    expect(got.tokens.find((row) => row.token === 'metals.t1')?.allowance).toBe('600');
    expect(pushed[0]?.state).toBe('active');
    expect(got.gasAllowance).toBe('0');
  });

  it('rejects empty limits with 400 and writes nothing', async () => {
    const { controller, wallet, repo } = harness();
    repo.seat('co_empty', owner.id);
    await expect(controller.add(asBearer('dev:owner'), { colonyId: 'co_empty', limits: {} })).rejects.toMatchObject({ status: 400 });
    await expect(controller.add(asBearer('dev:owner'), { colonyId: 'co_empty' })).rejects.toMatchObject({ status: 400 });
    expect(wallet.adds).toHaveLength(0);
    expect(repo.saves).toHaveLength(0);
  });

  it('returns wave_disabled and writes nothing when W15 is off', async () => {
    const { controller, wallet, repo } = harness('..14');
    repo.seat('co_off', owner.id);
    await expect(controller.add(asBearer('dev:owner'), { colonyId: 'co_off', limits: { 'metals.t1': limit(600) } })).rejects.toMatchObject({
      status: 403, errorCode: 'wave_disabled',
    });
    await expect(controller.remove(asBearer('dev:owner'), { colonyId: 'co_off' })).rejects.toMatchObject({ status: 403, errorCode: 'wave_disabled' });
    expect(repo.ownerCalls).toBe(0);
    expect(wallet.adds).toHaveLength(0);
  });

  it('gives a stranger 403 and a fractional cap 400', async () => {
    const { controller, wallet, repo } = harness();
    repo.seat('co_own', owner.id);
    await expect(controller.add(asBearer('dev:other'), { colonyId: 'co_own', limits: { 'metals.t1': limit(600) } })).rejects.toMatchObject({
      status: 403, errorCode: 'NEAR_NOT_OWNER',
    });
    await expect(controller.add(asBearer('dev:owner'), { colonyId: 'co_own', limits: { 'metals.t1': { ...limit(1), maxPerSession: 1.5 } } })).rejects.toMatchObject({ status: 400 });
    expect(stranger.id).not.toBe(owner.id);
    expect(wallet.adds).toHaveLength(0);
  });

  it('stores allowance 0 when maxPerSession is 0', async () => {
    const { controller, wallet, repo } = harness();
    repo.seat('co_zero', owner.id);
    const got = await controller.add(asBearer('dev:owner'), { colonyId: 'co_zero', limits: { 'metals.t1': limit(0) } });
    expect(wallet.adds[0]?.tokens).toEqual([{ token: 'metals.t1', allowance: '0' }]);
    expect(got.tokens[0]?.allowance).toBe('0');
    expect(repo.saves[0]?.allowance).toBe('0');
  });

  it('reads the autoTrade blob when the body has no limits', async () => {
    const state = createState({ planetId: 'pl_blob', planetType: 'desert', seed: 'dir', radius: 1 });
    writeAutoTradeLimits(state, 0, { 'metals.t1': limit(600) }, 1);
    const bytes = snapshot(state);
    const planets = { isLoaded: () => true, fullState: async () => ({ bytes }) } as unknown as GamePlanets;
    const { controller, wallet, repo } = harness('all', planets);
    repo.seat('co_blob', owner.id);
    const got = await controller.add(asBearer('dev:owner'), { colonyId: 'co_blob' });
    expect(wallet.adds[0]?.tokens?.[0]).toEqual({ token: 'metals.t1', allowance: '600' });
    expect(got.state).toBe('active');
  });

  it('a second POST while active does not add another key', async () => {
    const { controller, wallet, repo } = harness();
    repo.seat('co_again', owner.id);
    await controller.add(asBearer('dev:owner'), { colonyId: 'co_again', limits: { 'metals.t1': limit(600) } });
    const again = await controller.add(asBearer('dev:owner'), { colonyId: 'co_again', limits: { 'metals.t1': limit(1) } });
    expect(wallet.adds).toHaveLength(1);
    expect(repo.saves).toHaveLength(1);
    expect(again.tokens.find((row) => row.token === 'metals.t1')?.allowance).toBe('600');
  });

  it('requires a bearer', async () => {
    const { controller } = harness();
    await expect(controller.add({ headers: {} } as IncomingMessage, { colonyId: 'co', limits: { 'metals.t1': limit(600) } })).rejects.toMatchObject({ status: 401 });
  });
});

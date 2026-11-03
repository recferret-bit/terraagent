import 'reflect-metadata';
import type { PrismaClient } from '@terra/db';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { AuthTokenService } from '../../src/core/auth/index';
import { CoreException } from '../../src/core/errors/index';
import type { FlagsService } from '../../src/flags/flags.service';
import type { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository';
import { RelayStatusService } from '../../src/near/identity/relay-status.service';
import { reduceRelayState } from '../../src/near/identity/relay-state';

const ACCOUNT = 'co_abc.test-pilot.terraagent.mock';
const OP = `storage-deposit:${ACCOUNT}`;

describe('reduceRelayState (W06-20)', () => {
  it('is none when the player has no deposit rows', () => {
    expect(reduceRelayState([])).toEqual({ state: 'none' });
  });

  it('lets pending win over failed and dead', () => {
    expect(reduceRelayState([
      { opId: 'storage-deposit:done', status: 'DONE' },
      { opId: 'storage-deposit:dead', status: 'DEAD' },
      { opId: 'storage-deposit:run', status: 'RUNNING' },
    ])).toEqual({ state: 'pending', opId: 'storage-deposit:run' });
    expect(reduceRelayState([
      { opId: 'storage-deposit:fail', status: 'FAILED' },
      { opId: OP, status: 'PENDING' },
    ])).toEqual({ state: 'pending', opId: OP });
  });

  it('is failed when a row gave up and nothing is in flight', () => {
    expect(reduceRelayState([
      { opId: 'storage-deposit:done', status: 'DONE' },
      { opId: OP, status: 'FAILED' },
    ])).toEqual({ state: 'failed', opId: OP });
    expect(reduceRelayState([{ opId: OP, status: 'DEAD' }])).toEqual({ state: 'failed', opId: OP });
  });

  it('is settled only when every deposit row is done', () => {
    expect(reduceRelayState([
      { opId: OP, status: 'DONE' },
      { opId: 'storage-deposit:other', status: 'DONE' },
    ])).toEqual({ state: 'settled', opId: OP });
  });
});

function service(opts: {
  wave?: boolean;
  rows?: Array<{ opId: string; status: string }>;
  accounts?: Array<{ accountId: string }>;
}) {
  const requeued: string[][] = [];
  const lookups: unknown[] = [];
  const flags = { has: () => opts.wave !== false } as unknown as FlagsService;
  const tokens = {
    verifyAccessToken: () => ({ sub: 'pr_player', handle: 'pilot' }),
  } as unknown as AuthTokenService;
  const outbox = {
    findStatuses: async (opIds: readonly string[]) => {
      lookups.push([...opIds]);
      return opts.rows ?? [];
    },
    requeueFailed: async (opIds: readonly string[]) => {
      requeued.push([...opIds]);
      return opIds.length;
    },
  } as unknown as ChainOutboxRepository;
  const prisma = {
    nearColonyAccount: {
      findMany: async (q: { where: unknown }) => {
        lookups.push(q.where);
        return opts.accounts ?? [{ accountId: ACCOUNT }];
      },
    },
  } as unknown as PrismaClient;
  return { svc: new RelayStatusService(flags, tokens, outbox, prisma), requeued, lookups };
}

const authed = { headers: { authorization: 'Bearer token' } } as IncomingMessage;

describe('RelayStatusService (W06-20)', () => {
  it('reads colony deposit rows and lets pending win', async () => {
    const { svc, lookups } = service({
      rows: [{ opId: OP, status: 'PENDING' }, { opId: 'storage-deposit:other', status: 'FAILED' }],
    });
    await expect(svc.status(authed)).resolves.toEqual({ state: 'pending', opId: OP });
    expect(lookups).toContainEqual({ playerId: 'pr_player', slot: { not: 'player' } });
    expect(lookups).toContainEqual([OP]);
  });

  it('requeues only that player\'s deposit op ids and answers pending', async () => {
    const { svc, requeued } = service({});
    await expect(svc.retry(authed)).resolves.toEqual({ state: 'pending' });
    expect(requeued).toEqual([[OP]]);
  });

  it('is 404 when W06 is off, before the bearer is checked', async () => {
    const { svc } = service({ wave: false });
    const err = await svc.status({ headers: {} } as IncomingMessage).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(CoreException);
    expect(err).toMatchObject({ status: 404, errorCode: 'NOT_FOUND' });
  });
});

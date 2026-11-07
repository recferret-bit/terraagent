import { randomUUID } from 'node:crypto';
import type { MarketTokenKey } from '@terra/contracts';
import { expect } from 'vitest';
import { GamePlanets } from '../../src/game/game-planets.service.js';
import { auditPlanet, expectLedgerDelta } from '../exchange/exchange-audit.js';
import type { Actor, Exchange } from '../exchange/exchange-harness.js';
import { simColony } from './real-planet.js';

const dec = (x: { toFixed(): string }): bigint => BigInt(x.toFixed());
export const code = (r: { body: { error?: { code?: string } } }): string | undefined => r.body?.error?.code;

/** Verifier funding plus the sim's `cargo.inOrbit` mirror (the real sim pre-checks cargo, the faucet only credits the verifier). */
export async function grant(ex: Exchange, a: Actor, token: MarketTokenKey, whole: number): Promise<void> {
  await a.fund(token, BigInt(whole));
  const out = await ex.get(GamePlanets).submit(a.planetId, {
    colonyIndex: a.idx, source: 'dev', commandId: `fx-${randomUUID()}`, kind: 'dev.cargoGrant', args: { colonyIndex: a.idx, resource: token, amount: whole },
  } as never);
  expect((out as { code?: string }).code, `cargoGrant ${token}`).toBeUndefined();
}

export const snapshotOf = async (ex: Exchange) => { await ex.settle(); return { sup: await ex.supply(), led: await ex.ledger() }; };

/**
 * The sim agrees with the server for every actor, once the module commands arrive (they travel the bus to the sim thread):
 * reserved water == remaining units of its open sell orders, every open order has its ref, `inOrbit` water == verifier water.
 */
export async function expectSimMirror(ex: Exchange, planetId: string, actors: readonly Actor[]): Promise<void> {
  for (const a of actors) {
    await ex.until(async () => {
      const [view, rows] = [await simColony(ex, planetId, a.idx), await ex.prisma.marketOrder.findMany({ where: { planetId, colonyId: a.colonyId, state: { in: ['OPEN', 'PARTIAL'] } } })];
      const reserved = rows.filter((r) => r.side === 'sell' && r.base === 'bio.water').reduce((s, r) => s + dec(r.amount) - dec(r.filled), 0n);
      const ok = BigInt(view.reservedInOrbit['bio.water'] ?? 0) === reserved
        && rows.every((r) => view.openRefs.includes(r.ref)) // not `===`: the sim keeps a filled USDC buy's ref forever (SIM-LEAK, see sim-leak.real.int.spec.ts)
        && BigInt(view.inOrbit['bio.water'] ?? 0) === (await a.bal('bio.water'));
      return ok ? true : false;
    }, 8000, `sim mirror of ${a.name}`);
  }
}

/** Ledger conservation after a scenario: supply unchanged, balances moved exactly by the FINAL trades, order/book/trade audit, sim mirror. */
export async function expectConserved(ex: Exchange, planetId: string, before: Awaited<ReturnType<typeof snapshotOf>>, actors: readonly Actor[], extra: Record<string, bigint> = {}): Promise<void> {
  await ex.settle();
  expect(await ex.supply()).toEqual(before.sup);
  await expectLedgerDelta(ex, planetId, before.led, extra);
  await auditPlanet(ex, planetId);
  await expectSimMirror(ex, planetId, actors);
}

import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { defineCommandHandler } from '../../kernel/commands';
import type { CompiledDataLike } from '../../kernel/config';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { ensureColonyLedger } from '../economy/ledger';

export type TradeHubUnlockReason =
  | 's5'
  | 'guildVisit'
  | 'neighborContact'
  | 'tradeHubAtS2'
  | 'stageLocked'
  | 'contactRequired';

export interface TradeHubUnlockStatus {
  unlocked: boolean;
  reason: TradeHubUnlockReason;
  hint: string;
  stage: number;
  neighborContact: boolean;
  guildVisit: boolean;
  tradeHubAtS2: boolean;
}

export interface EvaluateTradeHubUnlockOptions {
  tradeHubAtS2?: boolean;
}

const PACKED_ENTITY_STRIDE = 12;

function hasActiveCommandHub(stateOrView: unknown, colonyIndex: number): boolean {
  if (!stateOrView || typeof stateOrView !== 'object') return false;
  const obj = stateOrView as Record<string, unknown>;
  const entities = obj.entities as Record<string, unknown> | Float32Array | Array<Record<string, unknown>> | undefined;
  if (!entities) return false;

  if (entities instanceof Float32Array) {
    const count =
      typeof obj.count === 'number' && Number.isFinite(obj.count)
        ? obj.count
        : Math.floor(entities.length / PACKED_ENTITY_STRIDE);
    for (let i = 0; i < count; i++) {
      const base = i * PACKED_ENTITY_STRIDE;
      const kind = entities[base + 1];
      const owner = entities[base + 2];
      const hp = entities[base + 8];
      const hpMax = entities[base + 9];
      const state = entities[base + 10];
      if (
        owner === colonyIndex &&
        kind === ENTITY_KIND.commandHub &&
        state !== ENTITY_STATE.constructing &&
        !(hpMax > 0 && hp <= 0)
      ) {
        return true;
      }
    }
    return false;
  }

  if (Array.isArray(entities)) {
    return entities.some(
      (e) =>
        e &&
        e.owner === colonyIndex &&
        e.kind === ENTITY_KIND.commandHub &&
        e.state !== ENTITY_STATE.constructing &&
        !(typeof e.hpMax === 'number' && e.hpMax > 0 && typeof e.hp === 'number' && e.hp <= 0),
    );
  }

  const cols = entities.cols as
    | {
        kind?: ArrayLike<number>;
        owner?: ArrayLike<number>;
        state?: ArrayLike<number>;
        hp?: ArrayLike<number>;
        hpMax?: ArrayLike<number>;
      }
    | undefined;
  const count = typeof entities.count === 'number' ? entities.count : 0;
  if (cols?.kind && cols.owner && cols.state) {
    for (let i = 0; i < count; i++) {
      const dead = cols.hpMax && cols.hp ? cols.hpMax[i] > 0 && cols.hp[i] <= 0 : false;
      if (
        cols.owner[i] === colonyIndex &&
        cols.kind[i] === ENTITY_KIND.commandHub &&
        cols.state[i] !== ENTITY_STATE.constructing &&
        !dead
      ) {
        return true;
      }
    }
  }
  return false;
}

function extractColonyRecord(stateOrView: unknown, colonyIndex: number): Record<string, unknown> | undefined {
  if (!stateOrView || typeof stateOrView !== 'object') return undefined;
  const obj = stateOrView as Record<string, unknown>;
  if (Array.isArray(obj.colonies)) {
    const list = obj.colonies as Array<Record<string, unknown> | undefined>;
    return list.find((c) => c && c.index === colonyIndex) ?? list[colonyIndex];
  }
  return obj;
}

function resolveUnlockRuleRow(data?: CompiledDataLike): {
  minContactStage: number;
  autoUnlockStage: number;
  tradeHubAtS2: boolean;
} {
  const tradeHubTable = data?.tables?.tradeHub as Record<string, Record<string, unknown>> | undefined;
  const unlockRow = tradeHubTable?.unlock;
  const minContactStage =
    typeof unlockRow?.minContactStage === 'number' && Number.isFinite(unlockRow.minContactStage)
      ? unlockRow.minContactStage
      : 2;
  const autoUnlockStage =
    typeof unlockRow?.autoUnlockStage === 'number' && Number.isFinite(unlockRow.autoUnlockStage)
      ? unlockRow.autoUnlockStage
      : 5;
  const tradeHubAtS2 = Boolean(unlockRow?.tradeHubAtS2 ?? true);
  return { minContactStage, autoUnlockStage, tradeHubAtS2 };
}

/**
 * Evaluates whether the Inter-Colony Trade Hub is unlocked for `colonyIndex` on a `PlanetState` or client `GameView`.
 * Rule (`tradeHub.unlock`): `neighborContact(>=S2) | guildVisit | S5`, plus demo override `TRADE_HUB_AT_S2=true`.
 */
export function evaluateTradeHubUnlock(
  stateOrView: unknown,
  colonyIndex = 0,
  data?: CompiledDataLike,
  opts?: EvaluateTradeHubUnlockOptions,
): TradeHubUnlockStatus {
  const obj = stateOrView && typeof stateOrView === 'object' ? (stateOrView as Record<string, unknown>) : undefined;
  const colony = extractColonyRecord(stateOrView, colonyIndex);
  const rawStage = colony?.stage ?? obj?.stage;
  const stage =
    typeof rawStage === 'number' && Number.isFinite(rawStage)
      ? Math.max(1, Math.floor(rawStage))
      : hasActiveCommandHub(stateOrView, colonyIndex)
        ? 2
        : 1;

  const unlockRow = resolveUnlockRuleRow(data);
  const tradeHubAtS2 =
    opts?.tradeHubAtS2 ??
    (typeof colony?.tradeHubAtS2 === 'boolean'
      ? colony.tradeHubAtS2
      : typeof obj?.tradeHubAtS2 === 'boolean'
        ? obj.tradeHubAtS2
        : unlockRow.tradeHubAtS2);
  const neighborContact = Boolean(
    colony?.neighborContact || colony?.contactFake || obj?.neighborContact || obj?.contactFake,
  );
  const guildVisit = Boolean(colony?.guildVisit || obj?.guildVisit);

  if (stage >= unlockRow.autoUnlockStage) {
    return {
      unlocked: true,
      reason: 's5',
      hint: 'Unlocked at Stage 5',
      stage,
      neighborContact,
      guildVisit,
      tradeHubAtS2,
    };
  }
  if (guildVisit) {
    return {
      unlocked: true,
      reason: 'guildVisit',
      hint: 'Unlocked by Trade Guild visit',
      stage,
      neighborContact,
      guildVisit,
      tradeHubAtS2,
    };
  }
  if (stage >= unlockRow.minContactStage && neighborContact) {
    return {
      unlocked: true,
      reason: 'neighborContact',
      hint: 'Unlocked by neighbor contact',
      stage,
      neighborContact,
      guildVisit,
      tradeHubAtS2,
    };
  }
  if (stage >= unlockRow.minContactStage && tradeHubAtS2) {
    return {
      unlocked: true,
      reason: 'tradeHubAtS2',
      hint: 'Unlocked at Stage 2 (TRADE_HUB_AT_S2)',
      stage,
      neighborContact,
      guildVisit,
      tradeHubAtS2,
    };
  }
  if (stage < unlockRow.minContactStage) {
    return {
      unlocked: false,
      reason: 'stageLocked',
      hint: 'Requires Stage 2 + Neighbor Contact (or Stage 5)',
      stage,
      neighborContact,
      guildVisit,
      tradeHubAtS2,
    };
  }
  return {
    unlocked: false,
    reason: 'contactRequired',
    hint: 'Requires Neighbor Contact, Guild Visit, or Stage 5',
    stage,
    neighborContact,
    guildVisit,
    tradeHubAtS2,
  };
}

function ensureColony(state: PlanetState, colonyIndex: number, tick: number): ColonyState {
  let col = state.colonies.find((c) => c && c.index === colonyIndex) ?? state.colonies[colonyIndex];
  if (!col) {
    col = {
      index: colonyIndex,
      id: `col-${colonyIndex}`,
      name: `Colony ${colonyIndex + 1}`,
      color: 0xff6b00,
      status: 'active',
      changedAt: tick,
    };
    state.colonies[colonyIndex] = col;
  }
  return ensureColonyLedger(col);
}

/**
 * Applies `contact.fake` to `state.colonies[colonyIndex]`: sets `neighborContact = true` and `contactFake = true`
 * (and `guildVisit = true` if requested), ensures `stage >= 2`, and stamps `changedAt = tick`.
 */
export function applyContactFake(
  state: PlanetState,
  colonyIndex = 0,
  tick: number = state.meta.tick,
  guildVisit = false,
): void {
  const colony = ensureColony(state, colonyIndex, tick);
  const rec = colony as Record<string, unknown>;
  rec.neighborContact = true;
  rec.contactFake = true;
  if (guildVisit) {
    rec.guildVisit = true;
  }
  const prevStage = typeof rec.stage === 'number' && Number.isFinite(rec.stage) ? rec.stage : 1;
  rec.stage = Math.max(prevStage, 2);
  colony.changedAt = tick;
}

export const devContactFakeHandler = defineCommandHandler({
  kind: 'dev.contactFake',
  wave: 'W10',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as { colonyIndex?: number; enabled?: boolean; guildVisit?: boolean };
    const colonyIndex =
      typeof args.colonyIndex === 'number' && Number.isInteger(args.colonyIndex) && args.colonyIndex >= 0
        ? args.colonyIndex
        : typeof cmd.colonyIndex === 'number' && Number.isInteger(cmd.colonyIndex) && cmd.colonyIndex >= 0
          ? cmd.colonyIndex
          : 0;
    if (args.enabled === false) {
      const colony = ensureColony(state, colonyIndex, ctx.tick);
      const rec = colony as Record<string, unknown>;
      rec.neighborContact = false;
      rec.contactFake = false;
      if (args.guildVisit === false) rec.guildVisit = false;
      colony.changedAt = ctx.tick;
      return;
    }
    applyContactFake(state, colonyIndex, ctx.tick, Boolean(args.guildVisit));
  },
});

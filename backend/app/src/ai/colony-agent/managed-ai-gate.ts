import { MANAGED_AI_MODEL, SCRIPT_AI_MODEL, STAKING_TIERS, type AiAccessMode, type AiBudgetView } from '@terra/contracts';
import type { PrismaClient } from '@terra/db';
import { databaseEnabled } from '../../core/persistence.js';
import type { AppEnv } from '../../core/tokens.js';
import { aiSlotLedger, type AiSlotLedger } from '../../near/staking/perks/ai-slot.ledger.js';
import { resolveWalletPerks } from '../../near/staking/perks/perks.resolver.js';
import { stakingNowMs, type PerksDeps } from '../../near/staking/perks/perks-deps.js';
import { buildAiBudgetView } from '../../near/staking/perks/tier-engine.js';
import { consumeTrialTurn, isVerifiedPilot } from './trial-ledger.js';
import { chargeWalletCall } from './wallet-ai-usage.js';

/** Why a colony decision was downshifted to `deterministic-policy` (mode `script`). */
export type AiDownshiftReason = 'guest' | 'no_stake' | 'budget_exhausted' | 'slot_cap' | 'trial_exhausted' | 'no_database';

export interface ManagedAiAccess {
  readonly mode: AiAccessMode;
  /** `MANAGED_AI_MODEL` for `trial` / `tee`, `SCRIPT_AI_MODEL` for `script`. */
  readonly model: string;
  readonly reason?: AiDownshiftReason;
  readonly trialTurnsLeft?: number;
}

export interface GateColony {
  readonly id: string;
  readonly planetId?: string;
  readonly colonyIndex?: number;
  readonly playerId?: string;
}

const DEFAULT_SCRIPT_COOLDOWN_MS = STAKING_TIERS[0]!.sweepSeconds * 1_000;
const script = (reason: AiDownshiftReason): ManagedAiAccess => ({ mode: 'script', model: SCRIPT_AI_MODEL, reason });

async function resolveColonyIdentity(db: PrismaClient | undefined, col: GateColony): Promise<{ colonyId: string; playerId?: string }> {
  if (!db || typeof db.colony?.findUnique !== 'function') return { colonyId: col.id, playerId: col.playerId };
  const byId = (await db.colony.findUnique({ where: { id: col.id }, select: { id: true, playerId: true } })) as
    | { id: string; playerId: string }
    | null;
  if (byId) return { colonyId: byId.id, playerId: col.playerId ?? byId.playerId };
  if (col.planetId && col.colonyIndex !== undefined && typeof db.colony.findFirst === 'function') {
    const bySlot = (await db.colony.findFirst({
      where: { planetId: col.planetId, colonyIndex: col.colonyIndex },
      select: { id: true, playerId: true },
    })) as { id: string; playerId: string } | null;
    if (bySlot) return { colonyId: bySlot.id, playerId: col.playerId ?? bySlot.playerId };
  }
  return { colonyId: col.id, playerId: col.playerId };
}

/**
 * W28-06: who may spend the protocol's managed `glm-5.3-flash` budget on a colony decision (BYOK keys never come
 * here: they cost the protocol `$0`). Staked wallets share one daily call budget and `maxAiColonySlots` colonies;
 * verified (`!isGuest`) pilots with no stake get the one-time free turns; everyone else, and anyone out of budget,
 * slots or trial, downshifts to the deterministic policy. Never touches `@terra/sim`.
 */
export class ManagedAiGate {
  private readonly lastCooldownMsByColony = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaClient | undefined,
    private readonly env: AppEnv | undefined,
    private readonly slots: AiSlotLedger = aiSlotLedger,
    private readonly deps?: Partial<PerksDeps>,
  ) {}

  private envBag(): Record<string, string | undefined> {
    return (this.env ?? process.env) as unknown as Record<string, string | undefined>;
  }

  /** Tier sweep cooldown (`STAKING_TIERS[tier].sweepSeconds * 1000`) recorded on the last `admit` for `colonyId`. */
  cooldownMsOf(colonyId: string): number | undefined {
    return this.lastCooldownMsByColony.get(colonyId);
  }

  /** Decides and charges one managed turn for `col`. */
  async admit(col: GateColony, nowMs: number = stakingNowMs()): Promise<ManagedAiAccess> {
    const db = this.prisma;
    if (!db || !databaseEnabled(this.env)) {
      this.lastCooldownMsByColony.set(col.id, DEFAULT_SCRIPT_COOLDOWN_MS);
      return script('no_database');
    }
    const resolved = await resolveColonyIdentity(db, col);
    const r = await resolveWalletPerks(db, {
      colonyId: resolved.colonyId,
      playerId: resolved.playerId,
      env: this.envBag(),
      w28: true,
      full: true,
      nowMs,
      deps: this.deps,
    });
    const { perks, wallet, usage } = r;
    const tierCooldownMs = perks.sweepSeconds * 1_000;
    this.lastCooldownMsByColony.set(col.id, tierCooldownMs);
    this.lastCooldownMsByColony.set(resolved.colonyId, tierCooldownMs);
    if (perks.maxAiColonySlots > 0) {
      if (usage.dailyCallsUsed >= perks.dailyAiCallLimit) return script('budget_exhausted');
      if (!this.slots.claim(wallet.walletKey, resolved.colonyId, perks.maxAiColonySlots, nowMs)) return script('slot_cap');
      if (!(await chargeWalletCall(db, wallet.walletKey, perks.dailyAiCallLimit, nowMs))) return script('budget_exhausted');
      return { mode: 'tee', model: MANAGED_AI_MODEL };
    }
    const playerId = resolved.playerId ?? wallet.playerId;
    if (!(await isVerifiedPilot(db, playerId))) return script('guest');
    const left = await consumeTrialTurn(db, playerId);
    if (left === null) return script('trial_exhausted');
    return { mode: 'trial', model: MANAGED_AI_MODEL, trialTurnsLeft: left };
  }

  private db(): PrismaClient | undefined {
    return this.prisma && (databaseEnabled(this.env) || !('$connect' in this.prisma)) ? this.prisma : undefined;
  }

  /**
   * Read-only AI access card of one colony (`GET /v1/near/staking/ai-access`): the wallet's `AiBudgetView` with the
   * colony's own mode (`byok` when the player has a key, `script` when the colony sits outside the slot set).
   */
  async view(col: GateColony, opts: { byok?: boolean; nowMs?: number } = {}): Promise<AiBudgetView> {
    const nowMs = opts.nowMs ?? stakingNowMs();
    const db = this.db();
    const resolved = await resolveColonyIdentity(db, col);
    const r = await resolveWalletPerks(db, {
      colonyId: resolved.colonyId,
      playerId: resolved.playerId,
      env: this.envBag(),
      w28: true,
      full: true,
      nowMs,
      deps: this.deps,
    });
    const base = { ...buildAiBudgetView(r.perks, r.usage, r.nearUsd), colonySlotsUsed: this.slots.used(r.wallet.walletKey, nowMs) };
    if (opts.byok) return { ...base, mode: 'byok', model: 'byok' };
    const slotsFull =
      r.perks.maxAiColonySlots > 0 &&
      !this.slots.has(r.wallet.walletKey, resolved.colonyId, nowMs) &&
      this.slots.used(r.wallet.walletKey, nowMs) >= r.perks.maxAiColonySlots;
    const spent = r.perks.maxAiColonySlots > 0 && r.usage.dailyCallsUsed >= r.perks.dailyAiCallLimit;
    return slotsFull || spent ? { ...base, mode: 'script', model: SCRIPT_AI_MODEL } : base;
  }
}

const utcDay = (nowMs: number): string => new Date(nowMs).toISOString().slice(0, 10);

/**
 * Managed-AI colony slots per wallet and UTC day (first come, first served). The slot set of a wallet is the colonies
 * that used managed AI today, so a wallet with ten colonies never gets more than its tier's `maxAiColonySlots`.
 * Process-local: after a restart the first colonies that ask again take the slots (the call budget lives in the DB).
 */
export class AiSlotLedger {
  private day = '';
  private readonly sets = new Map<string, Set<string>>();

  private roll(nowMs: number): void {
    const day = utcDay(nowMs);
    if (day === this.day) return;
    this.day = day;
    this.sets.clear();
  }

  /** `true` when `colonyId` already holds a slot of `walletKey` or takes a free one (`max` slots). */
  claim(walletKey: string, colonyId: string, max: number, nowMs: number): boolean {
    this.roll(nowMs);
    if (max <= 0) {
      this.sets.delete(walletKey);
      return false;
    }
    const set = this.sets.get(walletKey) ?? new Set<string>();
    while (set.size > max) {
      const oldestOrNewest = Array.from(set).pop();
      if (oldestOrNewest === undefined) break;
      set.delete(oldestOrNewest);
    }
    if (set.has(colonyId)) return true;
    if (set.size >= max) return false;
    set.add(colonyId);
    this.sets.set(walletKey, set);
    return true;
  }

  release(walletKey: string, colonyId: string, nowMs: number): void {
    this.roll(nowMs);
    const set = this.sets.get(walletKey);
    if (!set) return;
    set.delete(colonyId);
    if (set.size === 0) this.sets.delete(walletKey);
  }

  has(walletKey: string, colonyId: string, nowMs: number): boolean {
    this.roll(nowMs);
    return this.sets.get(walletKey)?.has(colonyId) ?? false;
  }

  used(walletKey: string, nowMs: number): number {
    this.roll(nowMs);
    return this.sets.get(walletKey)?.size ?? 0;
  }

  reset(): void {
    this.sets.clear();
    this.day = '';
  }
}

/** The process-wide ledger shared by the Director gate and the perks reader. */
export const aiSlotLedger = new AiSlotLedger();

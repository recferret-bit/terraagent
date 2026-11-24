import { MANAGED_AI_MODEL } from '@terra/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ManagedAiGate, type ManagedAiAccess } from '../../src/ai/colony-agent/managed-ai-gate.js';
import { ProviderHealth } from '../../src/ai/provider/provider-health.js';

/** The real gate with only its charge ledger exercised: `charged` is the private hook `admit` uses. */
function gateWith(updateMany: ReturnType<typeof vi.fn>) {
  const prisma = { aiFreeTrial: { updateMany } } as never;
  const gate = new ManagedAiGate(prisma, undefined, undefined, undefined, new ProviderHealth({ failuresToOpen: 5, openMs: 60_000 }));
  const access: ManagedAiAccess = { mode: 'trial', model: MANAGED_AI_MODEL, trialTurnsLeft: 2 };
  (gate as unknown as { charged(a: ManagedAiAccess, c: unknown): ManagedAiAccess }).charged(access, { kind: 'trial', playerId: 'pr_1' });
  return { gate, access };
}

describe('ManagedAiGate.refund keeps the charge until the write lands', () => {
  it('a failed write throws and the same refund can be retried; a landed refund is final', async () => {
    const updateMany = vi.fn().mockRejectedValueOnce(new Error('P1001')).mockResolvedValue({ count: 1 });
    const { gate, access } = gateWith(updateMany);
    await expect(gate.refund(access)).rejects.toThrow('P1001');
    await expect(gate.refund(access)).resolves.toBe(true);
    await expect(gate.refund(access)).resolves.toBe(false);
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it('two refunds racing for one charge give the turn back once', async () => {
    let land!: () => void;
    const updateMany = vi.fn(() => new Promise<{ count: number }>((resolve) => (land = () => resolve({ count: 1 }))));
    const { gate, access } = gateWith(updateMany);
    const first = gate.refund(access);
    await expect(gate.refund(access)).resolves.toBe(false);
    land();
    await expect(first).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});

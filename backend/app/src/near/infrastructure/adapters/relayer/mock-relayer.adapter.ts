import { Injectable } from '@nestjs/common';
import { adapterOf } from '../../../../ports/adapters';
import { RelayerPort, type SubmitMetaTxInput } from '../../../application/ports/relayer.port';
import type { ChainReceipt } from '../../../domain/types';
import { MockChainBase } from '../../mock/mock-chain.base';
import { runRelayed, SignerLane } from './nonce-lane';
import { assertRelayAllowed, relayTxHash, type RelaySubmit } from './relay-rules';

/** Mock NEP-366 relayer: allow-list, then one Postgres receipt per signer nonce. A repeated caller `opId` does not take another. */
@Injectable()
export class MockRelayerAdapter extends MockChainBase implements RelayerPort {
  private readonly lane = new SignerLane();
  /** In-flight submits by caller opId, so two overlapping calls share one lane entry. */
  private readonly inflight = new Map<string, Promise<ChainReceipt>>();

  async submitMetaTx(input: SubmitMetaTxInput): Promise<ChainReceipt> {
    const parsed = assertRelayAllowed(input);
    const pending = this.inflight.get(parsed.opId);
    if (pending) return pending;
    const run = this.startRelay(parsed);
    this.inflight.set(parsed.opId, run);
    try {
      return await run;
    } finally {
      if (this.inflight.get(parsed.opId) === run) this.inflight.delete(parsed.opId);
    }
  }

  /**
   * Replay before `runRelayed`. The lane hands out a nonce before the attempt, so a hit inside `submitAt`
   * would still consume one. The row itself stays keyed by action-hash plus nonce; the caller opId is in the payload.
   */
  private async startRelay(parsed: RelaySubmit): Promise<ChainReceipt> {
    const prior = await this.findReceiptByPayload('Relayer', 'submitMetaTx', 'opId', parsed.opId);
    if (prior) return prior;
    return runRelayed(this.lane, parsed.signerId, (nonce) => this.submitAt(parsed, nonce));
  }

  /**
   * The stored opId is the action hash plus this nonce. A failed call writes nothing, so the retry
   * (next nonce) is a new receipt; a replay of the same action and the same nonce returns the stored one.
   */
  private submitAt(parsed: RelaySubmit, nonce: bigint): Promise<ChainReceipt> {
    const n = nonce.toString();
    return this.call('Relayer', 'submitMetaTx', `${relayTxHash(parsed)}:${n}`, async (tx) => {
      await this.ensureAccount(tx, parsed.signerId);
      return receiptPayload(parsed, n);
    });
  }
}

/** Receipt body. Nonce and the caller's opId stay as they were; a JSON delegate only adds fields. */
function receiptPayload(parsed: RelaySubmit, nonce: string): {
  signerId: string;
  receiverId: string;
  opId: string;
  method: 'submitMetaTx';
  nonce: string;
  action?: string;
  account_id?: string;
} {
  return {
    signerId: parsed.signerId,
    receiverId: parsed.receiverId,
    ...delegateReceiptFields(parsed.signedDelegate),
    opId: parsed.opId,
    method: 'submitMetaTx',
    nonce,
  };
}

/**
 * `action` and `account_id` when `signedDelegate` is a JSON object.
 * A non-JSON delegate (and JSON without those strings) adds nothing.
 */
export function delegateReceiptFields(signedDelegate: string): { readonly action?: string; readonly account_id?: string } {
  const parsed = parseDelegateJson(signedDelegate);
  if (!parsed) return {};
  const action = parsed.action;
  const accountId = parsed.account_id;
  return {
    ...(typeof action === 'string' ? { action } : {}),
    ...(typeof accountId === 'string' ? { account_id: accountId } : {}),
  };
}

function parseDelegateJson(signedDelegate: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(signedDelegate) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const adapter = adapterOf({ port: RelayerPort, kind: 'mock', useClass: MockRelayerAdapter });

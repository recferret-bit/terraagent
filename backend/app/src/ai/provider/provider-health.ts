import { createHash } from 'node:crypto';
import type { LlmFailureKind, LlmProviderError } from '../../ports/llm-provider.port.js';
import { circuitSettings, ProviderCircuit, type CircuitSettings } from '../budget/circuit.js';

/** `protocol` = the server's own NEAR AI key; `byok` = a player's saved key (each one has its own circuit). */
export type ProviderScope = 'protocol' | 'byok';

/** An unfunded or rejected key stays open this long, then one probe is allowed. */
export const HARD_OPEN_MS = 15 * 60_000;

export type ProviderAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly kind: LlmFailureKind; readonly scope: ProviderScope; readonly retryAtMs: number };

export interface ProviderStateChange {
  readonly scope: ProviderScope;
  /** `protocol` or `byok:<sha256 prefix>` (never the key). */
  readonly keyId: string;
  readonly state: 'open' | 'closed';
  /** The failure that opened it (`open` only). */
  readonly kind?: LlmFailureKind;
  readonly retryAtMs?: number;
  readonly atMs: number;
}

/** A player key nobody used for this long is forgotten (its circuit starts closed again if the key comes back). */
export const BYOK_FORGET_MS = 60 * 60_000;

/** Telemetry sink: called once per state change (never per call) and once per fallback batch. */
export interface ProviderHealthObserver {
  onStateChange(change: ProviderStateChange, openKeys: Readonly<Record<ProviderScope, number>>): void;
  /** Open-key counts changed without a state change (stale player keys were forgotten). */
  onOpenKeys?(openKeys: Readonly<Record<ProviderScope, number>>): void;
  onFallback(reason: string, decisions: number): void;
}

/** Settles one call: `null` = success, an error = counted by kind, `'neutral'` = neither (caller abort, rejected). */
export type CallOutcome = null | LlmProviderError | 'neutral';

interface KeyEntry {
  readonly circuit: ProviderCircuit;
  readonly scope: ProviderScope;
  open: boolean;
  kind?: LlmFailureKind;
  /** Last acquire / settle (wall ms): stale player keys are forgotten. */
  usedAt: number;
}

const COUNTED: ReadonlySet<LlmFailureKind> = new Set(['rate_limited', 'server', 'timeout', 'bad_response']);
const HARD: ReadonlySet<LlmFailureKind> = new Set(['unfunded', 'unauthorized']);

/** `protocol` for the server key (no override), else `byok:` + the first 16 hex of SHA-256 of the trimmed key. */
export function keyIdOf(apiKey?: string | null): string {
  const key = apiKey?.trim();
  return key ? `byok:${createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16)}` : 'protocol';
}

/**
 * One `ProviderCircuit` per API key fingerprint (AI §7). `unfunded` / `unauthorized` open the key for 15 min, then
 * one probe; `rate_limited` / `server` / `timeout` / `bad_response` use the 5-failure rule. Process-wide like the AI
 * slot ledger, so the colony gate and the `ai-access` card read the same state the guarded provider writes.
 */
export class ProviderHealth {
  private readonly keys = new Map<string, KeyEntry>();
  private settings?: CircuitSettings;
  private observer?: ProviderHealthObserver;

  constructor(
    settings?: CircuitSettings,
    readonly now: () => number = Date.now,
  ) {
    this.settings = settings;
  }

  /** Replaces the telemetry sink (one per process; a second Nest app replaces the first). */
  setObserver(observer: ProviderHealthObserver | undefined): void {
    this.observer = observer;
  }

  /** Pure read for the gate and the `ai-access` card: never takes the probe. */
  availability(apiKey?: string | null, nowMs: number = this.now()): ProviderAvailability {
    const entry = this.keys.get(keyIdOf(apiKey));
    return entry?.circuit.state(nowMs) === 'open' ? this.unavailable(entry) : { available: true };
  }

  /** Takes the right to call now (the half-open probe goes to one caller only). */
  acquire(apiKey?: string | null, nowMs: number = this.now()): ProviderAvailability {
    const entry = this.entry(keyIdOf(apiKey), nowMs);
    return entry.circuit.allow(nowMs) ? { available: true } : this.unavailable(entry);
  }

  settle(apiKey: string | null | undefined, outcome: CallOutcome, nowMs: number = this.now()): void {
    const keyId = keyIdOf(apiKey);
    const entry = this.entry(keyId, nowMs);
    if (outcome === null) entry.circuit.recordSuccess();
    else if (outcome === 'neutral' || !(HARD.has(outcome.kind) || COUNTED.has(outcome.kind))) entry.circuit.releaseProbe();
    else if (HARD.has(outcome.kind)) entry.circuit.trip(nowMs, HARD_OPEN_MS);
    else entry.circuit.recordFailure(nowMs);
    if (outcome !== null && outcome !== 'neutral' && entry.circuit.state(nowMs) !== 'closed') entry.kind = outcome.kind;
    this.emitIfChanged(keyId, entry, nowMs);
  }

  /** Counts decisions that fell back to rules for `reason` (one metric bump per batch, no log line). */
  noteFallback(reason: string, decisions = 1): void {
    if (decisions > 0) this.observer?.onFallback(reason, decisions);
  }

  openKeys(nowMs: number = this.now()): Record<ProviderScope, number> {
    const out: Record<ProviderScope, number> = { protocol: 0, byok: 0 };
    for (const e of this.keys.values()) if (e.circuit.state(nowMs) !== 'closed') out[e.scope] += 1;
    return out;
  }

  /** Test helper: forget every key. */
  reset(): void {
    this.keys.clear();
  }

  private entry(keyId: string, nowMs: number): KeyEntry {
    let entry = this.keys.get(keyId);
    if (!entry) {
      this.forgetStale(nowMs);
      this.settings ??= circuitSettings();
      entry = { circuit: new ProviderCircuit(this.settings), scope: keyId === 'protocol' ? 'protocol' : 'byok', open: false, usedAt: nowMs };
      this.keys.set(keyId, entry);
    }
    entry.usedAt = nowMs;
    return entry;
  }

  /**
   * Drops player keys nobody used for {@link BYOK_FORGET_MS} unless their window is still open, so the registry (and
   * the open-key gauge) cannot grow with every key a player ever tried. Runs when a new key appears.
   */
  private forgetStale(nowMs: number): void {
    let droppedOpen = false;
    for (const [id, e] of this.keys) {
      if (e.scope !== 'byok' || nowMs - e.usedAt < BYOK_FORGET_MS || e.circuit.state(nowMs) === 'open') continue;
      droppedOpen ||= e.open;
      this.keys.delete(id);
    }
    if (droppedOpen) this.observer?.onOpenKeys?.(this.openKeys(nowMs));
  }

  private unavailable(entry: KeyEntry): ProviderAvailability {
    return { available: false, kind: entry.kind ?? 'server', scope: entry.scope, retryAtMs: entry.circuit.retryAtMs() };
  }

  private emitIfChanged(keyId: string, entry: KeyEntry, nowMs: number): void {
    const open = entry.circuit.state(nowMs) !== 'closed';
    if (open === entry.open) return;
    entry.open = open;
    if (!open) entry.kind = undefined;
    const change: ProviderStateChange = open
      ? { scope: entry.scope, keyId, state: 'open', kind: entry.kind, retryAtMs: entry.circuit.retryAtMs(), atMs: nowMs }
      : { scope: entry.scope, keyId, state: 'closed', atMs: nowMs };
    this.observer?.onStateChange(change, this.openKeys(nowMs));
  }
}

/** The process-wide registry (the guarded `LlmProviderPort`, `ManagedAiGate` and the `ai-access` card share it). */
export const providerHealth = new ProviderHealth();

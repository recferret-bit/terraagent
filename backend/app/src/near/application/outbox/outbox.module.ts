import { Inject, Injectable, Module, type BeforeApplicationShutdown, type OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { defineEnv, envFlagTrue } from '@terra/config';
import type { Logger } from 'pino';
import { Gauge, Counter } from 'prom-client';
import { z } from 'zod';
import { layerLogger } from '../../../core/logging/logger.js';
import { MetricsRegistry } from '../../../core/metrics.registry.js';
import { APP_ENV, LOGGER, type AppEnv } from '../../../core/tokens.js';
import { PORTS } from '../ports/index.js';
import { ChainOutboxRepository } from './chain-outbox.repository.js';
import { OutboxRelay, type OutboxRelayConfig } from './outbox-relay.js';

const num = (d: number) => z.string().optional().transform((v) => (v === undefined || v === '' ? d : Number(v))).pipe(z.number().int().positive());

/** `OUTBOX_RELAY_ENABLED`: `true`/`false`; unset = on, except under tests (`NODE_ENV=test`). */
export const env = defineEnv('chain-outbox', {
  OUTBOX_RELAY_ENABLED: z.string().optional(),
  OUTBOX_POLL_MS: num(1000),
  OUTBOX_LEASE_MS: num(30_000),
  OUTBOX_MAX_ATTEMPTS: num(8),
});

/** Whether the relay runs in this process. */
export function relayEnabled(e: { OUTBOX_RELAY_ENABLED?: unknown; NODE_ENV?: unknown }): boolean {
  const v = e.OUTBOX_RELAY_ENABLED;
  return typeof v === 'string' && v !== '' ? envFlagTrue(v) : e.NODE_ENV !== 'test';
}

/** Runs the `OutboxRelay` inside the app: resolves ports from the Nest container, exposes the outbox metrics, drains on shutdown. */
@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly log: Logger;
  private readonly relay: OutboxRelay;
  private readonly enabled: boolean;

  constructor(repo: ChainOutboxRepository, ref: ModuleRef, metrics: MetricsRegistry, @Inject(APP_ENV) appEnv: AppEnv, @Inject(LOGGER) root: Logger) {
    const e = appEnv as unknown as Record<string, number | string | undefined>;
    this.log = layerLogger(root, 'infra', appEnv.LOG_LEVELS as string | undefined);
    this.enabled = relayEnabled(e);
    const cfg: OutboxRelayConfig = {
      pollMs: Number(e.OUTBOX_POLL_MS ?? 1000), leaseMs: Number(e.OUTBOX_LEASE_MS ?? 30_000), maxAttempts: Number(e.OUTBOX_MAX_ATTEMPTS ?? 8),
      batch: 10, backoffBaseMs: 1000, backoffMaxMs: 600_000,
    };
    const registers = [metrics.registry];
    const relayed = new Counter({ name: 'ta_chain_outbox_relayed_total', help: 'Outbox rows processed by the relay', labelNames: ['port', 'status'], registers });
    new Gauge({ name: 'ta_chain_outbox_pending', help: 'Outbox rows waiting to be relayed', registers, collect: async function (this: Gauge) { this.set((await repo.counts()).pending); } });
    new Gauge({ name: 'ta_chain_outbox_dead', help: 'Outbox rows given up on (alert)', registers, collect: async function (this: Gauge) { this.set((await repo.counts()).dead); } });
    const tokens = new Map(PORTS.map((p) => [p.name as string, p.token]));
    this.relay = new OutboxRelay(repo, cfg, {
      resolve: (name) => {
        const token = tokens.get(name);
        if (!token) throw new Error(`unknown port ${name}`);
        return ref.get(token, { strict: false });
      },
      onResult: (port, status) => relayed.inc({ port, status }),
      onError: (row, err) => this.log.warn({ opId: row?.opId, port: row?.port, attempts: row?.attempts, err: err instanceof Error ? err.message : String(err) }, 'outbox relay error'),
    });
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    this.relay.start();
    this.log.info('chain outbox relay started');
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.relay.stop();
  }
}

@Module({ providers: [ChainOutboxRepository, OutboxRelayService], exports: [ChainOutboxRepository] })
export class OutboxModule {}

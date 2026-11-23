import type { Server } from 'node:http';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { SimCommandV1 } from '@terra/contracts';
import type { Logger } from 'pino';
import { layerLogger } from '../../core/logging/logger';
import { APP_ENV, LOGGER, type AppEnv } from '../../core/tokens';
import type { HomeLandingSite } from '../../core/home/home.service';
import type { CommandOutcomeMsg, FullState, GamePlanets, LoadOptions } from '../game-planets.service';
import { GamePlanets as GamePlanetsToken } from '../game-planets.service';
import type { LandingSiteAnswer } from '../thread/protocol';
import { SimLeaseService, type SimLeaseRecord, type SimWorkerNodeRecord } from '../persistence/sim-lease.service';
import { SnapshotService } from '../persistence/snapshot.service';
import { internalAuthHeaders } from './internal-auth';

export type PlanetHostLocation =
  | { readonly kind: 'local' }
  | { readonly kind: 'remote'; readonly workerId: string; readonly internalUrl: string };

interface SerializedFullState {
  readonly planetId: string;
  readonly tick: number;
  readonly bytesBase64: string;
  readonly simVersion: number;
  readonly dataHash: string;
  readonly planetType: string;
  readonly warp: number;
  readonly overrides?: FullState['overrides'];
}

class ClusterHttpError extends Error {
  constructor(readonly status: number, method: string, path: string) {
    super(`cluster ${method} ${path} returned ${status}`);
  }
}

function isClusterTransportError(err: unknown): boolean {
  return !(err instanceof ClusterHttpError);
}

function decodeSerializedFullState(res: SerializedFullState): FullState {
  return {
    planetId: res.planetId,
    tick: res.tick,
    bytes: new Uint8Array(Buffer.from(res.bytesBase64, 'base64')),
    simVersion: res.simVersion,
    dataHash: res.dataHash,
    planetType: res.planetType,
    warp: res.warp,
    ...(res.overrides ? { overrides: res.overrides } : {}),
  };
}

/**
 * Coordinates simulation placement and transparent cross-process RPC across `all`, `sim-worker`, and `api` replicas.
 * Keeps `api` pods stateless while routing live WebSockets, HTTP commands, and colony landings to the lease holder.
 */
@Injectable()
export class SimClusterService {
  private readonly log: Logger;
  private readonly headers: Record<string, string>;
  workerWaitMs = 20_000;

  constructor(
    @Inject(APP_ENV) env: AppEnv,
    @Inject(LOGGER) root: Logger,
    @Inject(GamePlanetsToken) private readonly planets: GamePlanets,
    @Inject(SimLeaseService) private readonly simLease: SimLeaseService,
    @Optional() @Inject(SnapshotService) private readonly snapshots?: SnapshotService,
  ) {
    this.log = layerLogger(root, 'sim', env.LOG_LEVELS as string | undefined);
    this.headers = internalAuthHeaders(env);
  }

  attachHttpServer(server: Server | undefined | null): void {
    if (!server) {
      if (this.simLease.configuredInternalUrl) {
        void this.simLease.setInternalUrl(this.simLease.configuredInternalUrl);
      }
      return;
    }
    const sync = () => {
      if (this.simLease.internalUrl) return;
      const isListening = Boolean(server.listening || (typeof server.address === 'function' && server.address()));
      if (!isListening) return;
      if (this.simLease.configuredInternalUrl) {
        void this.simLease.setInternalUrl(this.simLease.configuredInternalUrl);
        return;
      }
      const addr = typeof server.address === 'function' ? server.address() : null;
      if (!addr || typeof addr === 'string' || !addr.port) return;
      const host = !addr.address || addr.address === '0.0.0.0' || addr.address === '::' ? '127.0.0.1' : addr.address;
      void this.simLease.setInternalUrl(`http://${host}:${addr.port}`);
    };
    sync();
    server.once('listening', sync);
  }

  async resolveLocation(planetId: string): Promise<PlanetHostLocation | null> {
    if (this.planets.isLoaded(planetId)) return { kind: 'local' };
    const lease = await this.simLease.getOwnerLease(planetId);
    if (!lease || lease.workerId === this.simLease.workerId || !lease.internalUrl) return null;
    return { kind: 'remote', workerId: lease.workerId, internalUrl: lease.internalUrl };
  }

  private async resolveLocationWithWait(planetId: string, waitMs = this.workerWaitMs): Promise<PlanetHostLocation | null> {
    if (this.planets.isLoaded(planetId)) return { kind: 'local' };
    let lease = await this.simLease.getOwnerLease(planetId);
    if (!lease || lease.workerId === this.simLease.workerId) return null;
    if (lease.internalUrl) {
      return { kind: 'remote', workerId: lease.workerId, internalUrl: lease.internalUrl };
    }
    if (!this.simLease.enabled || waitMs <= 0) return null;
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      if (this.planets.isLoaded(planetId)) return { kind: 'local' };
      lease = await this.simLease.getOwnerLease(planetId);
      if (!lease || lease.workerId === this.simLease.workerId) return null;
      if (lease.internalUrl) {
        return { kind: 'remote', workerId: lease.workerId, internalUrl: lease.internalUrl };
      }
    }
    return null;
  }

  private async waitForHealthyWorker(waitMs = this.workerWaitMs): Promise<SimWorkerNodeRecord | null> {
    const immediate = await this.simLease.pickHealthyWorker();
    if (immediate && immediate.workerId !== this.simLease.workerId) return immediate;
    if (this.simLease.canHostSim() || !this.simLease.enabled || waitMs <= 0) return null;
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      const w = await this.simLease.pickHealthyWorker();
      if (w && w.workerId !== this.simLease.workerId) return w;
    }
    return null;
  }

  private async verifyRemoteLocation(
    planetId: string,
    loc: Extract<PlanetHostLocation, { kind: 'remote' }>,
  ): Promise<PlanetHostLocation | null> {
    try {
      const res = await this.postJson<{ hosted: boolean }>(
        loc.internalUrl,
        `/v1/internal/sim/planets/${encodeURIComponent(planetId)}/load-home`,
        { loadOptions: {}, restoreOnly: true },
        5_000,
      );
      if (res.hosted) return loc;
      await this.simLease.evictPlanetLease?.(planetId, loc.workerId);
      return null;
    } catch (err) {
      if (!isClusterTransportError(err)) throw err;
      await this.simLease.evictWorker?.(loc.workerId);
      return null;
    }
  }

  private async postToHealthyWorker<T>(
    path: string,
    body: unknown,
    waitMs = this.workerWaitMs,
    timeoutMs = 15_000,
  ): Promise<{ readonly worker: SimWorkerNodeRecord; readonly data: T } | null> {
    const deadline = Date.now() + Math.max(0, waitMs);
    for (;;) {
      const remaining = Math.max(0, deadline - Date.now());
      const worker = await this.waitForHealthyWorker(remaining);
      if (!worker || worker.workerId === this.simLease.workerId) return null;
      try {
        const data = await this.postJson<T>(worker.internalUrl, path, body, timeoutMs);
        return { worker, data };
      } catch (err) {
        if (!isClusterTransportError(err)) throw err;
        await this.simLease.evictWorker?.(worker.workerId);
        if (Date.now() >= deadline) return null;
      }
    }
  }

  async ensureHosted(planetId: string, opts?: LoadOptions, waitMs = this.workerWaitMs): Promise<PlanetHostLocation | null> {
    const started = Date.now();
    const cur = await this.resolveLocationWithWait(planetId, waitMs);
    if (cur?.kind === 'local') return cur;
    if (cur?.kind === 'remote') {
      const verified = await this.verifyRemoteLocation(planetId, cur);
      if (verified) return verified;
    }

    if (this.simLease.canHostSim() && this.snapshots) {
      if (opts) {
        await this.snapshots.loadNew(planetId, opts);
      } else {
        await this.snapshots.restoreIfPersisted(planetId);
      }
      if (this.planets.isLoaded(planetId)) return { kind: 'local' };
      return this.resolveLocation(planetId);
    }

    const left = Math.max(0, waitMs - (Date.now() - started));
    const path = opts
      ? `/v1/internal/sim/planets/${encodeURIComponent(planetId)}/load-new`
      : `/v1/internal/sim/planets/${encodeURIComponent(planetId)}/load-home`;
    const body = opts ? opts : { loadOptions: {}, restoreOnly: true };
    const out = await this.postToHealthyWorker<{ hosted: boolean }>(path, body, left).catch(() => null);
    if (out?.data.hosted) return { kind: 'remote', workerId: out.worker.workerId, internalUrl: out.worker.internalUrl };
    return this.resolveLocationWithWait(planetId, Math.min(left, 1_500));
  }

  async isAvailableAnywhere(planetId: string): Promise<boolean> {
    return (await this.resolveLocation(planetId)) !== null;
  }

  async listAvailablePlanets(): Promise<Array<{ id: string }>> {
    const ids = new Set<string>(this.planets.loadedIds());
    const leases: SimLeaseRecord[] = await this.simLease.findActiveLeases().catch(() => []);
    for (const l of leases) ids.add(l.planetId);
    return [...ids].sort().map((id) => ({ id }));
  }

  async fullStateAnywhere(planetId: string, timeoutMs = 4_000): Promise<FullState> {
    if (this.planets.isLoaded(planetId)) return this.planets.fullState(planetId, timeoutMs);
    const path = `/v1/internal/sim/planets/${encodeURIComponent(planetId)}/full-state`;
    let loc = await this.resolveLocationWithWait(planetId);
    if (loc?.kind === 'remote') {
      try {
        return decodeSerializedFullState(await this.getJson<SerializedFullState>(loc.internalUrl, path, timeoutMs));
      } catch (err) {
        if (isClusterTransportError(err)) {
          await this.simLease.evictWorker?.(loc.workerId);
        } else if (err instanceof ClusterHttpError && err.status === 404) {
          await this.simLease.evictPlanetLease?.(planetId, loc.workerId);
        } else {
          throw err;
        }
      }
    }
    loc = await this.ensureHosted(planetId, undefined, this.workerWaitMs);
    if (loc?.kind === 'local') return this.planets.fullState(planetId, timeoutMs);
    if (!loc || loc.kind !== 'remote') throw new Error(`planet ${planetId} is not hosted in cluster`);
    return decodeSerializedFullState(await this.getJson<SerializedFullState>(loc.internalUrl, path, timeoutMs));
  }

  async submitAnywhere(planetId: string, cmd: SimCommandV1): Promise<CommandOutcomeMsg> {
    if (this.planets.isLoaded(planetId)) return this.planets.submit(planetId, cmd);
    const path = `/v1/internal/sim/planets/${encodeURIComponent(planetId)}/command`;
    let loc = await this.resolveLocationWithWait(planetId);
    if (loc?.kind === 'remote') {
      try {
        return await this.postJson<CommandOutcomeMsg>(loc.internalUrl, path, { cmd });
      } catch (e) {
        if (isClusterTransportError(e)) {
          await this.simLease.evictWorker?.(loc.workerId);
          loc = await this.ensureHosted(planetId, undefined, Math.min(this.workerWaitMs, 5_000)).catch(() => null);
          if (loc?.kind === 'local') return this.planets.submit(planetId, cmd);
          if (loc?.kind === 'remote') {
            try {
              return await this.postJson<CommandOutcomeMsg>(loc.internalUrl, path, { cmd });
            } catch (retryErr) {
              this.log.warn({ planetId, workerId: loc.workerId, err: String(retryErr) }, 'remote submit retry failed');
            }
          }
        } else {
          this.log.warn({ planetId, workerId: loc.workerId, err: e instanceof Error ? e.message : String(e) }, 'remote submit failed');
        }
        return { ok: false, commandId: cmd.commandId, code: 'thread_down' };
      }
    }
    return { ok: false, commandId: cmd.commandId, code: 'planet_not_loaded' };
  }

  async setModeRemotely(internalUrl: string, planetId: string, mode: 'active' | 'coarse'): Promise<void> {
    await this.postJson(internalUrl, `/v1/internal/sim/planets/${encodeURIComponent(planetId)}/mode`, { mode }).catch(() => undefined);
  }

  async forwardLoadNew(planetId: string, opts: LoadOptions & { scenarioSeats?: number[]; captureInitial?: boolean }): Promise<void> {
    const loc = await this.resolveLocationWithWait(planetId);
    const { snapshot, ...rest } = opts;
    const payload = {
      ...rest,
      ...(snapshot ? { snapshotBase64: Buffer.from(snapshot).toString('base64') } : {}),
    };
    const path = `/v1/internal/sim/planets/${encodeURIComponent(planetId)}/load-new`;
    if (loc?.kind === 'remote') {
      try {
        await this.postJson(loc.internalUrl, path, payload);
        return;
      } catch (err) {
        if (!isClusterTransportError(err)) throw err;
        await this.simLease.evictWorker?.(loc.workerId);
      }
    }
    const out = await this.postToHealthyWorker(path, payload);
    if (!out) throw new Error(`No simulation worker available to load ${planetId}`);
  }

  async wipeAnywhere(planetId: string): Promise<void> {
    const path = `/v1/internal/sim/planets/${encodeURIComponent(planetId)}/wipe`;
    const loc = await this.resolveLocationWithWait(planetId);
    if (loc?.kind === 'remote') {
      try {
        await this.postJson(loc.internalUrl, path, {});
        return;
      } catch (err) {
        if (!isClusterTransportError(err)) throw err;
        await this.simLease.evictWorker?.(loc.workerId);
      }
    }
    if (this.simLease.canHostSim() && this.snapshots) {
      await this.snapshots.wipeLoadedOrHeld(planetId);
      return;
    }
    const out = await this.postToHealthyWorker(path, {});
    if (!out && this.snapshots) {
      await this.snapshots.wipeLoadedOrHeld(planetId);
    }
  }

  async forwardLoadHome(planetId: string, opts: LoadOptions): Promise<'loaded' | 'restored' | 'generated'> {
    const loc = await this.resolveLocationWithWait(planetId);
    if (loc?.kind === 'remote') {
      const verified = await this.verifyRemoteLocation(planetId, loc);
      if (verified) return 'loaded';
    }
    const out = await this.postToHealthyWorker<{ outcome: 'loaded' | 'restored' | 'generated' }>(
      `/v1/internal/sim/planets/${encodeURIComponent(planetId)}/load-home`,
      { loadOptions: opts },
    );
    if (!out) throw new Error(`No simulation worker available to load home ${planetId}`);
    return out.data.outcome;
  }

  async forwardLandingSite(planetId: string, opts: LoadOptions, colonyIndex: number, timeoutMs: number): Promise<HomeLandingSite> {
    const path = `/v1/internal/sim/planets/${encodeURIComponent(planetId)}/landing-site`;
    const body = { loadOptions: opts, colonyIndex, timeoutMs };
    const existing = await this.resolveLocationWithWait(planetId);
    if (existing?.kind === 'remote') {
      try {
        const ans = await this.postJson<LandingSiteAnswer>(existing.internalUrl, path, body, timeoutMs + 2_000);
        if (!ans.ok) throw new Error(`Remote landing site failed on ${planetId}: ${ans.code}`);
        return ans;
      } catch (err) {
        if (!isClusterTransportError(err)) throw err;
        await this.simLease.evictWorker?.(existing.workerId);
      }
    }
    const out = await this.postToHealthyWorker<LandingSiteAnswer>(path, body, this.workerWaitMs, timeoutMs + 2_000);
    if (!out) throw new Error(`No simulation worker available for landing site on ${planetId}`);
    if (!out.data.ok) throw new Error(`Remote landing site failed on ${planetId}: ${out.data.code}`);
    return out.data;
  }

  private async getJson<T>(baseUrl: string, path: string, timeoutMs = 5_000): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: this.headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new ClusterHttpError(res.status, 'GET', path);
    return (await res.json()) as T;
  }

  private async postJson<T>(baseUrl: string, path: string, body: unknown, timeoutMs = 15_000): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new ClusterHttpError(res.status, 'POST', path);
    return (await res.json()) as T;
  }
}

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
import { SimLeaseService, type SimLeaseRecord } from '../persistence/sim-lease.service';
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

/**
 * Coordinates simulation placement and transparent cross-process RPC across `all`, `sim-worker`, and `api` replicas.
 * Keeps `api` pods stateless while routing live WebSockets, HTTP commands, and colony landings to the lease holder.
 */
@Injectable()
export class SimClusterService {
  private readonly log: Logger;
  private readonly headers: Record<string, string>;

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
    if (!server) return;
    const sync = () => {
      if (this.simLease.internalUrl) return;
      const addr = typeof server.address === 'function' ? server.address() : null;
      if (!addr || typeof addr === 'string' || !addr.port) return;
      const host = !addr.address || addr.address === '0.0.0.0' || addr.address === '::' ? '127.0.0.1' : addr.address;
      this.simLease.setInternalUrl(`http://${host}:${addr.port}`);
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

  async ensureHosted(planetId: string, opts?: LoadOptions): Promise<PlanetHostLocation | null> {
    const cur = await this.resolveLocation(planetId);
    if (cur) return cur;

    if (this.simLease.canHostSim() && this.snapshots) {
      if (opts) {
        await this.snapshots.loadNew(planetId, opts);
      } else {
        await this.snapshots.restoreIfPersisted(planetId);
      }
      if (this.planets.isLoaded(planetId)) return { kind: 'local' };
      return this.resolveLocation(planetId);
    }

    const worker = await this.simLease.pickHealthyWorker();
    if (!worker || worker.workerId === this.simLease.workerId) return null;

    const path = opts
      ? `/v1/internal/sim/planets/${encodeURIComponent(planetId)}/load-new`
      : `/v1/internal/sim/planets/${encodeURIComponent(planetId)}/load-home`;
    const body = opts ? opts : { loadOptions: {}, restoreOnly: true };
    const res = await this.postJson<{ hosted: boolean }>(worker.internalUrl, path, body).catch(() => null);
    if (res?.hosted) return { kind: 'remote', workerId: worker.workerId, internalUrl: worker.internalUrl };
    return this.resolveLocation(planetId);
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
    const loc = await this.resolveLocation(planetId);
    if (!loc || loc.kind !== 'remote') throw new Error(`planet ${planetId} is not hosted in cluster`);
    const res = await this.getJson<SerializedFullState>(
      loc.internalUrl,
      `/v1/internal/sim/planets/${encodeURIComponent(planetId)}/full-state`,
      timeoutMs,
    );
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

  async submitAnywhere(planetId: string, cmd: SimCommandV1): Promise<CommandOutcomeMsg> {
    if (this.planets.isLoaded(planetId)) return this.planets.submit(planetId, cmd);
    const loc = await this.resolveLocation(planetId);
    if (!loc || loc.kind !== 'remote') return { ok: false, commandId: cmd.commandId, code: 'planet_not_loaded' };
    try {
      return await this.postJson<CommandOutcomeMsg>(
        loc.internalUrl,
        `/v1/internal/sim/planets/${encodeURIComponent(planetId)}/command`,
        { cmd },
      );
    } catch (e) {
      this.log.warn({ planetId, workerId: loc.workerId, err: e instanceof Error ? e.message : String(e) }, 'remote submit failed');
      return { ok: false, commandId: cmd.commandId, code: 'thread_down' };
    }
  }

  async setModeRemotely(internalUrl: string, planetId: string, mode: 'active' | 'coarse'): Promise<void> {
    await this.postJson(internalUrl, `/v1/internal/sim/planets/${encodeURIComponent(planetId)}/mode`, { mode }).catch(() => undefined);
  }

  async forwardLoadNew(planetId: string, opts: LoadOptions & { scenarioSeats?: number[] }): Promise<void> {
    const loc = await this.resolveLocation(planetId);
    const { snapshot, ...rest } = opts;
    const payload = {
      ...rest,
      ...(snapshot ? { snapshotBase64: Buffer.from(snapshot).toString('base64') } : {}),
    };
    if (loc?.kind === 'remote') {
      await this.postJson(loc.internalUrl, `/v1/internal/sim/planets/${encodeURIComponent(planetId)}/load-new`, payload);
      return;
    }
    const worker = await this.simLease.pickHealthyWorker();
    if (!worker) throw new Error(`No simulation worker available to load ${planetId}`);
    await this.postJson(worker.internalUrl, `/v1/internal/sim/planets/${encodeURIComponent(planetId)}/load-new`, payload);
  }

  async forwardLoadHome(planetId: string, opts: LoadOptions): Promise<'loaded' | 'restored' | 'generated'> {
    const loc = await this.resolveLocation(planetId);
    if (loc?.kind === 'remote') return 'loaded';
    const worker = await this.simLease.pickHealthyWorker();
    if (!worker) throw new Error(`No simulation worker available to load home ${planetId}`);
    const out = await this.postJson<{ outcome: 'loaded' | 'restored' | 'generated' }>(
      worker.internalUrl,
      `/v1/internal/sim/planets/${encodeURIComponent(planetId)}/load-home`,
      { loadOptions: opts },
    );
    return out.outcome;
  }

  async forwardLandingSite(planetId: string, opts: LoadOptions, colonyIndex: number, timeoutMs: number): Promise<HomeLandingSite> {
    const existing = await this.resolveLocation(planetId);
    const targetUrl =
      existing?.kind === 'remote' ? existing.internalUrl : (await this.simLease.pickHealthyWorker())?.internalUrl;
    if (!targetUrl) throw new Error(`No simulation worker available for landing site on ${planetId}`);
    const ans = await this.postJson<LandingSiteAnswer>(
      targetUrl,
      `/v1/internal/sim/planets/${encodeURIComponent(planetId)}/landing-site`,
      { loadOptions: opts, colonyIndex, timeoutMs },
      timeoutMs + 2_000,
    );
    if (!ans.ok) throw new Error(`Remote landing site failed on ${planetId}: ${ans.code}`);
    return ans;
  }

  private async getJson<T>(baseUrl: string, path: string, timeoutMs = 5_000): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: this.headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`cluster GET ${path} returned ${res.status}`);
    return (await res.json()) as T;
  }

  private async postJson<T>(baseUrl: string, path: string, body: unknown, timeoutMs = 15_000): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`cluster POST ${path} returned ${res.status}`);
    return (await res.json()) as T;
  }
}

import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { mergeOverrides, type BalanceOverrides } from '@terra/sim';
import { EconomyActivationService, type ActivationView } from '../economy/activation/activation.service';
import { EconomyProfileService } from '../economy/profile/profile.service';
import { ProfileSwapper } from './profile-swap';

/** Injection token: balance overrides that are not part of the economy profile (file ⊕ env), layered under the profile. */
export const STATIC_OVERRIDES = Symbol('STATIC_OVERRIDES');
export const SWAPPER = Symbol('PROFILE_SWAPPER');
const RECONCILE_EVERY_MS = 30_000;

/**
 * Host side of an activation (W13-39). Pending activations are applied to the sim threads in order: compile once, send
 * the plain overrides (never a DB handle), wait for every thread to store them, then acknowledge (`markApplied`).
 * `reconcile` runs on boot and every 30 s, so a crash between the DB write and the apply is repaired (all steps idempotent),
 * and a database that was down at boot is retried until a version loads.
 */
@Injectable()
export class EconomyActivationBridge implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('EconomyActivationBridge');
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> = Promise.resolve();
  private off: (() => void) | undefined;

  constructor(
    private readonly profiles: EconomyProfileService,
    private readonly activations: EconomyActivationService,
    private readonly swapper: ProfileSwapper,
    private readonly staticOverrides: BalanceOverrides,
  ) {}

  onApplicationBootstrap(): void {
    this.off = this.activations.onScheduled(() => void this.reconcile());
    void this.reconcile();
    this.timer = setInterval(() => void this.reconcile(), RECONCILE_EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.off?.();
  }

  /** Serialised: concurrent triggers queue behind the running pass. Never throws (a DB outage keeps the loaded snapshot). */
  reconcile(): Promise<void> {
    this.running = this.running.then(() => this.pass()).catch((e: unknown) => this.log.error(`economy reconcile failed: ${e instanceof Error ? e.message : String(e)}`));
    return this.running;
  }

  private async pass(): Promise<void> {
    if (!this.activations.persistent) return;
    if (this.profiles.loadState === 'unavailable') await this.recover();
    for (const act of await this.activations.pending()) await this.applyOne(act);
  }

  /** The database is reachable again: load the active global version into the threads and reopen cash actions. */
  private async recover(): Promise<void> {
    const c = await this.profiles.compiledFor({});
    if (c.layers.length === 0) return;
    if (await this.swapper.swap(mergeOverrides(this.staticOverrides, c.overrides), 0, c.overridesHash)) this.profiles.markLoaded();
  }

  private async applyOne(act: ActivationView): Promise<void> {
    try {
      const compiled = await this.profiles.compileVersion(act.versionId);
      const ok = await this.swapper.swap(mergeOverrides(this.staticOverrides, compiled.overrides), act.effectiveTick ?? 0, compiled.overridesHash);
      if (!ok) return void this.log.warn(`activation ${act.id}: threads did not acknowledge; will retry`);
      await this.activations.markApplied(act.id, act.effectiveTick ?? 0);
      this.profiles.markLoaded();
    } catch (e) {
      await this.activations.markFailed(act.id, e instanceof Error ? e.message : String(e));
      this.log.error(`activation ${act.id} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

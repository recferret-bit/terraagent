import { ENTITY_KIND } from '@terra/sim';
import { workPresetIdFor } from '@terra/render/particles/cutterVariant';
import type { ActiveWorkSiteInput } from '@terra/render/particles/types';
import { applyHubPrestige } from '@terra/render/prestige/hubPrestige';
import { prestigeVisualsForTier } from '@terra/render/prestige/tierVisuals';
import type { ClientView } from '../../store/replica/viewCodec';
import type { EntityMeshRecord } from '../online/EntityMeshRecord';
import { prestigeStore, type PrestigeStore } from './PrestigeStore';

/**
 * Applies the staking prestige to the colony's entity meshes (W28-12). Cosmetic only: tiers come from
 * `GET /v1/near/staking/prestige` (fetched once per planet) and are passed to `@terra/render` as plain numbers.
 * Colonies are matched by `view.colonies[owner].id`, else by slot index (dev scenario rows differ from sim ids). Off unless `isEnabled()` (W28 on, not `?host=local`).
 */
export class PrestigeDressing {
  /** Set by the session: W28 flag on and not an in-browser host. Default off, so tests and tools show nothing. */
  isEnabled: () => boolean = () => false;

  constructor(private readonly store: PrestigeStore = prestigeStore) {}

  /** colony slot index -> tier, from the cached prestige of the view's planet. Empty while nothing is known. */
  private tiers(view: ClientView): Map<number, number> {
    const out = new Map<number, number>();
    const planetId = view.planet?.id;
    if (!planetId) return out;
    void this.store.ensureLoaded(planetId);
    for (const c of view.colonies ?? []) out.set(c.index, this.store.tierOfColony(planetId, c.id, c.index));
    return out;
  }

  /** Dress every Command Hub for its colony's tier. Idempotent, so it is safe to call on every view. */
  sync(view: ClientView, records: Iterable<EntityMeshRecord>): void {
    if (!this.isEnabled()) return;
    const tiers = this.tiers(view);
    for (const rec of records) {
      if (rec.kind !== ENTITY_KIND.commandHub) continue;
      applyHubPrestige(rec.mesh, tiers.get(rec.owner) ?? 0);
    }
  }

  /** Tier 2+ colonies work with cyan cutter beams: name the cyan preset on their work sites. */
  tintCutters(sites: ActiveWorkSiteInput[], records: ReadonlyMap<number, EntityMeshRecord>, view: ClientView | null): ActiveWorkSiteInput[] {
    if (!view || !this.isEnabled() || sites.length === 0) return sites;
    const tiers = this.tiers(view);
    for (const s of sites) {
      if (s.presetId) continue;
      const owner = records.get(Number(s.workerId))?.owner;
      if (owner === undefined || !prestigeVisualsForTier(tiers.get(owner) ?? 0).cyanCutters) continue;
      s.presetId = workPresetIdFor(s.targetKind, true);
    }
    return sites;
  }
}

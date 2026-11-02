import {
  ENTITY_KIND,
  ENTITY_STATE,
  resolveHqT1Row,
  type CompiledDataLike,
  type HqJob,
  type HqUnitView,
  type ViewEntity,
} from '@terra/sim';
import { forEachEntity, type EntityRow } from '../../store/replica/viewCodec';
import { viewColony } from './colony';

/** One reader of a view's HQ for every panel that shows it (HQ panel, top-bar power cell; FF-20). */

/** What the HQ panel shows as the current job: the sim's job, or `waiting` (queued work it cannot start yet). */
export type HqPanelJob = HqJob | 'waiting';

/** The sim's HQ panel view (`HqUnitView`) as the client reads it from a view; work rate and vision are not shown. */
export type HqStatusView = Omit<HqUnitView, 'workRate' | 'viewRadius' | 'currentJob'> & { currentJob: HqPanelJob };

/** Panel job of an entity state code (`ENTITY_STATE`); a descending HQ never reaches the panel. */
export function hqJobFromStateCode(stateCode: number): HqPanelJob {
  if (stateCode === ENTITY_STATE.moving) return 'moving';
  if (stateCode === ENTITY_STATE.working) return 'working';
  if (stateCode === ENTITY_STATE.constructing) return 'constructing';
  if (stateCode === ENTITY_STATE.waiting) return 'waiting';
  return 'idle';
}

/** The first landed HQ (of `owner`, when given) in a view's entity rows. */
function findHqInEntities(view: { entities?: Float32Array | ViewEntity[]; count?: number }, owner?: number): EntityRow | null {
  let found: EntityRow | null = null;
  forEachEntity(view.entities, view.count, (e) => {
    if (e.kind !== ENTITY_KIND.hq || (owner !== undefined && e.owner !== owner) || e.state === ENTITY_STATE.descending) return;
    found = e;
    return false;
  });
  return found;
}

/** Extra HQ fields only a `SimView`'s `ViewEntity[]` carries (the packed buffer has the columns only). */
function viewEntityExtras(view: { entities?: Float32Array | ViewEntity[] }, id: number): Partial<ViewEntity> {
  return Array.isArray(view.entities) ? (view.entities.find((e) => e.id === id) ?? {}) : {};
}

function queueCountOf(colHq: Partial<HqStatusView> | undefined, colAny: Record<string, unknown> | undefined, blobHq: Partial<HqStatusView> | undefined, job: HqPanelJob): number {
  for (const n of [colHq?.queueCount, colAny?.queueCount, blobHq?.queueCount]) if (typeof n === 'number') return n;
  return job === 'idle' ? 0 : 1;
}

/**
 * Extracts the HQ status view from a `ClientView` or `SimView`. Returns `null` when the view names no addressable HQ
 * (no HQ entity and no HQ record with an entity id): the panel never invents an id to send orders to (FF-23).
 * Maxima missing from the view come from the `hq.t1` row (`data`: the host's live balance data, defaults otherwise).
 */
export function extractHqFromView(rawView: unknown, ownerColonyIndex?: number, data?: CompiledDataLike): HqStatusView | null {
  if (!rawView || typeof rawView !== 'object') return null;
  const view = rawView as { entities?: Float32Array | ViewEntity[]; count?: number; blobs?: Record<string, unknown> };

  const entityHq = findHqInEntities(view, ownerColonyIndex);
  const extras: Partial<ViewEntity> = entityHq ? viewEntityExtras(view, entityHq.id) : {};
  const owner = entityHq?.owner ?? ownerColonyIndex ?? 0;
  const col = viewColony(view, owner);
  const colAny = col as unknown as Record<string, unknown> | undefined;
  const colHq = col?.hq as Partial<HqStatusView> | undefined;
  // `blobs.hq` is `{ byColony }` only (the sim's one shape)
  const blobHq = (view.blobs?.hq as { byColony?: Record<number, Partial<HqStatusView>> } | undefined)?.byColony?.[owner];
  const meta = colHq ?? blobHq;

  const entityId = entityHq?.id ?? meta?.entityId;
  if (entityId === undefined) return null;

  const currentJob: HqPanelJob = entityHq
    ? hqJobFromStateCode(entityHq.state)
    : ((colHq?.currentJob ?? (colAny?.currentJob as HqJob | undefined) ?? blobHq?.currentJob ?? 'idle') as HqPanelJob);
  const row = resolveHqT1Row(data);
  const q = entityHq?.q ?? meta?.q ?? 0;
  const r = entityHq?.r ?? meta?.r ?? 0;
  const hpMax = entityHq?.hpMax ?? meta?.hpMax ?? Number(row.hp);
  const cellMax = extras.cellMax ?? meta?.cellMax ?? Number(row.cellCapacity);

  return {
    entityId,
    owner,
    tier: extras.tier ?? meta?.tier ?? Number(row.tier),
    q,
    r,
    x: entityHq?.x ?? meta?.x ?? q,
    y: entityHq?.y ?? meta?.y ?? r,
    hp: entityHq?.hp ?? meta?.hp ?? hpMax,
    hpMax,
    cell: extras.cell ?? meta?.cell ?? cellMax,
    cellMax,
    targetQ: extras.targetQ ?? meta?.targetQ ?? q,
    targetR: extras.targetR ?? meta?.targetR ?? r,
    currentJob,
    queueCount: queueCountOf(colHq, colAny, blobHq, currentJob),
  };
}

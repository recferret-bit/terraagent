import { MAP_LAYER_META } from '@terra/contracts';
import { ENTITY_KIND } from '@terra/sim';
import { resolveCssToken } from '../../maps/entityDots';
import type { MapLayer, MapLayerDrawView } from '../../maps/types';
import { forEachEntity } from '../../store/replica/viewCodec';
import { resolveHealthBarKind } from '../../app/online/unitHealthBars';

export type ScreenEdge = 'top' | 'bottom' | 'left' | 'right';

export interface CombatAlertPing {
  readonly id: string;
  readonly kind: string;
  readonly q: number;
  readonly r: number;
  readonly colonyIndex?: number;
  readonly attackerId?: number;
  readonly victimId?: number;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly edge: ScreenEdge | null;
}

const EK = ENTITY_KIND as Readonly<Record<string, number | undefined>>;

const HIVE_KIND_SET = new Set<number>(
  [
    ENTITY_KIND.hiveBlackAnt,
    ENTITY_KIND.hiveBlueBeetle,
    ENTITY_KIND.hiveGreenSpitter,
    EK.blackAntHive,
    EK.blueBeetleHive,
    EK.greenSpitterHive,
  ].filter((k): k is number => typeof k === 'number'),
);

export function isFaunaHiveKind(rawKind: number | string): boolean {
  const kind = typeof rawKind === 'number' ? rawKind : resolveHealthBarKind(rawKind);
  return HIVE_KIND_SET.has(kind);
}

function collectHiveCoords(view: MapLayerDrawView): Array<{ q: number; r: number }> {
  const coords: Array<{ q: number; r: number }> = [];
  const seen = new Set<string>();
  const push = (q: number, r: number) => {
    if (!Number.isFinite(q) || !Number.isFinite(r)) return;
    const key = `${q},${r}`;
    if (seen.has(key)) return;
    seen.add(key);
    coords.push({ q, r });
  };

  const cv = view.clientView;
  if (cv?.entities) {
    forEachEntity(cv.entities, cv.count, (row) => {
      if (row.hp > 0 && isFaunaHiveKind(row.kind)) {
        push(row.q, row.r);
      }
    });
    if (Array.isArray(cv.entities)) {
      for (const raw of cv.entities as ReadonlyArray<Record<string, unknown>>) {
        if (!raw || typeof raw !== 'object') continue;
        const hp = typeof raw.hp === 'number' ? raw.hp : 1;
        const kindVal = (raw.kind ?? raw.building ?? raw.archetype ?? '') as number | string;
        if (hp > 0 && isFaunaHiveKind(kindVal)) {
          push(Number(raw.q ?? raw.x ?? 0), Number(raw.r ?? raw.y ?? 0));
        }
      }
    }
  }

  const blobs = (cv as { blobs?: Record<string, unknown> } | null | undefined)?.blobs;
  const hivesBlob = (blobs?.faunaHives as {
    hivesById?: Record<string, Record<string, unknown>>;
    hives?: Record<string, Record<string, unknown>>;
    byEntityId?: Record<string, Record<string, unknown>>;
  } | undefined);
  for (const map of [hivesBlob?.hivesById, hivesBlob?.hives, hivesBlob?.byEntityId]) {
    if (!map || typeof map !== 'object') continue;
    for (const h of Object.values(map)) {
      if (h && typeof h.q === 'number' && typeof h.r === 'number') {
        push(h.q, h.r);
      }
    }
  }

  return coords;
}

export interface ThreatsDrawSummary {
  readonly hiveMarkers: number;
  readonly pingRings: number;
}

export function drawThreatsLayer(
  ctx: CanvasRenderingContext2D,
  view: MapLayerDrawView,
  activePings: readonly CombatAlertPing[] = [],
): ThreatsDrawSummary {
  const faultColor = resolveCssToken('--ta-fault', '#FF3B3B');
  const warnColor = resolveCssToken('--ta-orange', '#FF6A13');
  const hives = collectHiveCoords(view);

  ctx.save();
  ctx.fillStyle = faultColor;
  ctx.strokeStyle = faultColor;
  ctx.lineWidth = 1.5;

  const r = Math.max(3.5, view.tilePixelRadius * 0.9);
  for (const hive of hives) {
    const { x, y } = view.axialToPixel(hive.q, hive.r);
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  let pingRings = 0;
  ctx.strokeStyle = warnColor;
  ctx.lineWidth = 2;
  for (const ping of activePings) {
    const { x, y } = view.axialToPixel(ping.q, ping.r);
    const ringRadius = Math.max(6, view.tilePixelRadius * 2.2);
    ctx.beginPath();
    ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
    ctx.stroke();
    pingRings++;
  }
  ctx.restore();

  return { hiveMarkers: hives.length, pingRings };
}

export function createThreatsMapLayer(
  getActivePings?: () => readonly CombatAlertPing[],
): MapLayer {
  const meta = MAP_LAYER_META.threats;
  return {
    id: meta.id,
    label: meta.label,
    wave: meta.wave,
    defaultOn: meta.defaultOn,
    order: meta.order,
    draw(ctx, view) {
      drawThreatsLayer(ctx, view, getActivePings?.() ?? []);
    },
  };
}

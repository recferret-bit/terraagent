import { z } from 'zod';
import { WaveId, type WaveId as WaveIdType } from '../flags';
import {
  ALERT_PING_KINDS,
  AlertPingKindSchema,
  type AlertPingKind,
} from '../events/alert-ping';

export { ALERT_PING_KINDS, AlertPingKindSchema, type AlertPingKind };

export const MAP_LAYER_IDS = [
  'territory',
  'terrain',
  'terraformPct',
  'resources',
  'units',
  'threats',
  'market',
  'walls',
] as const;

export type MapLayerId = (typeof MAP_LAYER_IDS)[number];

export const MapLayerIdSchema = z.enum(MAP_LAYER_IDS);

export interface MapLayerMeta {
  readonly id: MapLayerId;
  readonly label: string;
  readonly wave: WaveIdType;
  readonly defaultOn: boolean;
  readonly order: number;
}

export const MAP_LAYER_META: Record<MapLayerId, MapLayerMeta> = {
  territory: { id: 'territory', label: 'Territory', wave: 'W04', defaultOn: true, order: 10 },
  terrain: { id: 'terrain', label: 'Terrain', wave: 'W04', defaultOn: true, order: 20 },
  units: { id: 'units', label: 'Units', wave: 'W04', defaultOn: true, order: 30 },
  terraformPct: { id: 'terraformPct', label: 'Terraform %', wave: 'W15', defaultOn: false, order: 40 },
  resources: { id: 'resources', label: 'Resources', wave: 'W09', defaultOn: false, order: 50 },
  threats: { id: 'threats', label: 'Threats', wave: 'W07', defaultOn: false, order: 60 },
  market: { id: 'market', label: 'Market', wave: 'W13', defaultOn: false, order: 70 },
  walls: { id: 'walls', label: 'Walls', wave: 'W14', defaultOn: false, order: 80 },
};

export const MapLayerMetaSchema = z.strictObject({
  id: MapLayerIdSchema,
  label: z.string().min(1),
  wave: WaveId,
  defaultOn: z.boolean(),
  order: z.number().int(),
});

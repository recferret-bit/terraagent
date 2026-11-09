import { defineFeature } from '../../core/registry/types';
import {
  createRangeRingsRenderer,
  RangeRingsController,
  type RangeRingsService,
} from './RangeRingsRenderer';
import {
  is2x2RingBuildingKind,
  normalizeRingEntityKind,
  rangeRingsData,
  resolveEntityRingSpec,
  resolveGhostTurretRingSpec,
  RING_ENTITY_KIND,
  type EntityRingSpec,
} from './ringSpecs';

export {
  createRangeRingsRenderer,
  is2x2RingBuildingKind,
  normalizeRingEntityKind,
  rangeRingsData,
  RangeRingsController,
  resolveEntityRingSpec,
  resolveGhostTurretRingSpec,
  RING_ENTITY_KIND,
  type EntityRingSpec,
  type RangeRingsService,
};

declare module '../../core/registry/types' {
  interface FeatureServices {
    rangeRings?: RangeRingsService;
  }
}

export const rangeRingsFeature = defineFeature({
  id: 'range-rings',
  wave: 'W07',
  renderers: [{ id: 'range-rings-3d', mount: createRangeRingsRenderer }],
});

export default rangeRingsFeature;

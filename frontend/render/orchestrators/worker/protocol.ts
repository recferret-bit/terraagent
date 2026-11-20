import type { BirdFlock, HabitatAnchor, LandAnimalAgent } from '../../biosphere/biosphereTypes';
import type { TilePropInstance } from '../../planets/hex/chunkPropScatter';
import type { PoolThresholdSpec } from '../../pools';
import type { Place } from '../../visuals/terrain/Scatter';
import type { BiomeOrchestratorConfig } from '../BiomeConfig';

export interface BiomeWorkerTileInput {
  readonly terrain: Uint8Array;
  readonly height: Float32Array;
  readonly prep?: Uint8Array;
  readonly deposit?: Uint8Array;
  readonly richness?: Float32Array | Uint16Array;
  readonly depositTier?: Uint8Array;
  readonly owner?: Int8Array | Int16Array | Uint8Array;
}

export interface WorkerChunkGeometryData {
  readonly key: string;
  readonly cq: number;
  readonly cr: number;
  readonly position: Float32Array;
  readonly normal: Float32Array;
  readonly aAO: Float32Array;
  readonly aRock: Float32Array;
  readonly aHexShore: Float32Array;
  readonly index: Uint32Array;
}

export interface SerializedHabitatSnapshot {
  readonly halfSize: number;
  readonly forestAnchors: HabitatAnchor[];
  readonly forestTileIndices: number[];
  readonly waterAnchors: HabitatAnchor[];
  readonly grassAnchors: HabitatAnchor[];
  readonly rockAnchors: HabitatAnchor[];
  readonly colonizedAnchors: HabitatAnchor[];
}

export interface BiomeGeneratedPayload {
  readonly config: BiomeOrchestratorConfig;
  readonly generatedInWorker: boolean;
  readonly terrain: {
    readonly effHeights: Float32Array;
    readonly chunks: WorkerChunkGeometryData[];
  };
  readonly trees: {
    readonly standByCell: Record<string, TilePropInstance[]>;
    readonly wadiByCell: Record<string, Place[]>;
    readonly chunkTrees: Record<string, TilePropInstance[]>;
  };
  readonly groundObjects: {
    readonly floraByCell: Record<string, Record<string, Place[]>>;
    readonly rocksByCell: Record<string, Record<'boulder' | 'spire', TilePropInstance[]>>;
    readonly chunkRocks: Record<string, { boulder: TilePropInstance[]; spire: TilePropInstance[] }>;
  };
  readonly resources: {
    readonly depositsByCell: Record<string, Record<'metals' | 'minerals' | 'oil', TilePropInstance[]>>;
    readonly chunkDeposits: Record<string, { metals: TilePropInstance[]; minerals: TilePropInstance[]; oil: TilePropInstance[] }>;
  };
  readonly habitat: SerializedHabitatSnapshot;
  readonly birds: {
    readonly flocks: BirdFlock[];
  };
  readonly animals: {
    readonly agents: LandAnimalAgent[];
  };
  readonly bugs: {
    readonly speciesPools: Readonly<Record<string, PoolThresholdSpec>>;
  };
}

export type ToBiomeWorker =
  | {
      readonly t: 'generate';
      readonly id: number;
      readonly jsonConfig: string;
      readonly tiles: BiomeWorkerTileInput;
    }
  | {
      readonly t: 'stop';
    };

export type FromBiomeWorker =
  | {
      readonly t: 'generated';
      readonly id: number;
      readonly payload: BiomeGeneratedPayload;
    }
  | {
      readonly t: 'error';
      readonly id: number;
      readonly message: string;
    };

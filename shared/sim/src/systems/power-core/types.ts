export interface EntityPowerStatus {
  state: 'online' | 'offline';
  reason?: string;
  component: number;
}

export interface PowerComponentSummary {
  componentId: number;
  entityIds: number[];
  pylonIds: number[];
  hasHub: boolean;
  supply: number;
  demand: number;
  rawDemand?: number;
  net: number;
  powered: boolean;
  shedEntityIds?: number[];
  shedGroupsActive?: number[];
  deficitPerS?: number;
}

export interface ColonyPowerSummary {
  colonyIndex: number;
  hasHub: boolean;
  founderCorePerS: number;
  solarGrossPerS: number;
  solarInternalDrainPerS: number;
  solarNetPerS: number;
  thermalGrossPerS?: number;
  thermalInternalDrainPerS?: number;
  thermalNetPerS?: number;
  windFactor?: number;
  windGrossPerS?: number;
  windInternalDrainPerS?: number;
  windNetPerS?: number;
  capacitorStoredE?: number;
  capacitorCapacityE?: number;
  capacitorDischargePerS?: number;
  capacitorChargePerS?: number;
  supply: number;
  demand: number;
  rawDemand: number;
  buildingDemand: number;
  unitDemand: number;
  workDemand: number;
  net: number;
  brownout: boolean;
  shedGroupsActive: number[];
  shedEntityIds: number[];
  shedWorkJobIds: string[];
  unpoweredEntityIds: number[];
  hqFastRechargeShed: boolean;
  offlineReasons: Record<number, string>;
  daylight: number;
  phase: 'day' | 'night';
  clockText: string;
  entityPower?: Record<number, EntityPowerStatus>;
  components?: PowerComponentSummary[];
  pylonLoads?: Record<number, { flow: number; max: number; overloaded?: boolean; shedEntityIds?: number[] }>;
  overloadedEntityIds?: number[];
}

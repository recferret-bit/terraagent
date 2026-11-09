import { RESOURCE_KEYS, type ResourceKey } from '@terra/contracts';
import { emptyFlow, type ResourceFlow } from '../flows/accounting';

const addRecord = (into: Record<string, bigint>, from: Readonly<Record<string, bigint>>): void => {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0n) + v;
};

/** Adds `from` into `into` (consecutive windows of one scope sum to the window of their union). */
export function addFlowInto(into: ResourceFlow, from: ResourceFlow): void {
  addRecord(into.production, from.production);
  addRecord(into.capped, from.capped);
  addRecord(into.consumption, from.consumption);
  into.recovered += from.recovered;
  into.imports += from.imports;
  into.exports += from.exports;
  into.cargoInternalIn += from.cargoInternalIn;
  into.cargoInternalOut += from.cargoInternalOut;
  into.transferIn += from.transferIn;
  into.transferOut += from.transferOut;
}

export const emptyFlowTable = (): Record<ResourceKey, ResourceFlow> => {
  const t = {} as Record<ResourceKey, ResourceFlow>;
  for (const k of RESOURCE_KEYS) t[k] = emptyFlow();
  return t;
};

export function addFlowTable(into: Record<ResourceKey, ResourceFlow>, from: Readonly<Record<ResourceKey, ResourceFlow>>): void {
  for (const k of RESOURCE_KEYS) addFlowInto(into[k], from[k]);
}

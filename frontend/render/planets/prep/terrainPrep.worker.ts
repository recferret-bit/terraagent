import { handleTerrainPrepRequest } from './terrainPrepCore';
import type { TerrainPrepRequest, TerrainPrepResponse } from './types';

interface DedicatedWorkerScope {
  onmessage: ((ev: MessageEvent<TerrainPrepRequest>) => void) | null;
  postMessage(message: TerrainPrepResponse, transfer: Transferable[]): void;
}

const scope = self as unknown as DedicatedWorkerScope;

scope.onmessage = (ev: MessageEvent<TerrainPrepRequest>) => {
  const { response, transfer } = handleTerrainPrepRequest(ev.data);
  scope.postMessage(response, transfer);
};

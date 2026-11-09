import type { ServerMessage } from '@terra/contracts';
import type { HexTerrain } from '@terra/render/planets/hex';
import type { WorldStore } from '../../store/WorldStore';
import type { CombatSyncController } from './combatSync';

export function bindStoreCombatEvents(
  store: Pick<WorldStore, 'onServerEvents' | 'onRenderEvents'>,
  combatSync: CombatSyncController,
  getTerrain: () => HexTerrain | null,
): () => void {
  const offServer = store.onServerEvents((events) => combatSync.ingestCombatEvents(events, getTerrain()));
  const offRender = store.onRenderEvents((events) => combatSync.ingestCombatEvents(events, getTerrain()));
  return () => { offServer(); offRender(); };
}

export function ingestHostMessageCombatEvents(
  msg: ServerMessage,
  combatSync: CombatSyncController,
  terrain: HexTerrain | null,
): void {
  if (msg.t === 'delta' && msg.d.events?.length) combatSync.ingestCombatEvents(msg.d.events, terrain);
  else if (msg.t === 'event') combatSync.ingestCombatEvents([msg.d], terrain);
}

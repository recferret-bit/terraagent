import type { HexPick, HexTerrain } from '@terra/render/planets/hex';
import type { CommandBus } from '../../net/commandBus';
import type { WorldStore } from '../../store/WorldStore';
import { LandfallController } from '../../features/landfall';
import type { EntityMeshes } from './EntityMeshes';

export interface UnitControlDeps {
  store: WorldStore;
  commandBus: CommandBus;
  canvas: HTMLElement;
  entities: EntityMeshes;
  pickAt(clientX: number, clientY: number): HexPick | null;
  terrain(): HexTerrain | null;
  /** HUD toast (the top bar may not be mounted yet when this is built). */
  toast(message: string): void;
  onRollback(): void;
}

/** Stop key for the selected unit, by physical key so it works on any layout (S is camera pan, see `RTSCamera`). */
export const STOP_KEY_CODE = 'KeyX';

/**
 * Player control of own units in the online scene: selection and right-click orders (`LandfallController`), the
 * target ring, the X stop key, a single toast when an order fails in the sim, and dropping the predicted walk of a
 * rejected command.
 */
export function createUnitControl(d: UnitControlDeps): { landfall: LandfallController; dispose(): void } {
  const landfall = new LandfallController({
    store: d.store, sendCommand: d.commandBus.send,
    pickTile: (cx, cy) => d.pickAt(cx, cy), canvas: d.canvas,
    isHqDeployed: () => d.entities.isHqDeployed(),
    onTargetMove: (q, r) => d.entities.flashTarget(q, r, d.terrain()),
    onOrderFailed: () => d.toast('No path: the HQ cannot reach that tile'),
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.code !== STOP_KEY_CODE) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    landfall.stopSelected();
  };
  const hasWindow = typeof window !== 'undefined' && typeof window.addEventListener === 'function';
  if (hasWindow) window.addEventListener('keydown', onKey);
  const offs = [
    () => { if (hasWindow) window.removeEventListener('keydown', onKey); },
    landfall.onChange(({ selectedEntityId }) => d.entities.setSelectedEntityId(selectedEntityId)),
    d.store.onCommandRejected((r) => { d.onRollback(); d.entities.discardPrediction(r.code); }),
  ];
  return { landfall, dispose: () => { for (const off of offs) off(); } };
}

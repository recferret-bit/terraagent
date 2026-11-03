/** Keyboard rules shared by every feature hotkey: one typing guard and one table of who owns which key. */

/** The key event comes from a text field (input, textarea, select, contenteditable): hotkeys stay quiet. */
export function isTypingTarget(e: Event): boolean {
  const t = e.target as (Partial<HTMLElement> & { tagName?: string }) | null;
  if (!t || typeof t !== 'object') return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable === true;
}

/** A plain hotkey press: no modifier, not auto-repeat, not typing. */
export function isHotkeyPress(e: KeyboardEvent): boolean {
  return !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && !isTypingTarget(e);
}

export interface HotkeyDef {
  /** `KeyboardEvent.key`, lower case. */
  key: string;
  owner: string;
  action: string;
}

/**
 * Every in-game hotkey of the online colony scene, so a new one shows its conflicts here first. Keys handled outside
 * `features/` (camera, stop, console, pause) are listed for completeness; each owner reads its key itself.
 */
export const HOTKEYS: readonly HotkeyDef[] = [
  { key: 'g', owner: 'terraform-basic', action: 'arm TERRAFORM while the Terraform tab is open (click a hex: the worker terraforms it, then the nearest obstacles)' },
  { key: 'r', owner: 'terraform-basic / construction-menu', action: 'arm REPAIR while the Terraform tab is open; rotates the building ghost while one is up (the brush is blocked then)' },
  { key: 'b', owner: 'core/hud/CommandDock', action: 'toggle the Build tab' },
  { key: 't', owner: 'core/hud/CommandDock', action: 'toggle the Terraform tab' },
  { key: 'u', owner: 'core/hud/CommandDock', action: 'toggle the Production tab' },
  { key: 'h', owner: 'hub-placement', action: 'open the Command Hub placement ghost' },
  { key: 'escape', owner: 'hub-placement / terraform-basic / session', action: 'cancel placement, else disarm the brush, else pause' },
  { key: 'z', owner: 'terraform-basic', action: 'arm DISMANTLE while the Terraform tab is open (click an own building or unit: 50% refund)' },
  { key: 'x', owner: 'app/online/unitControl', action: 'stop the selected unit' },
  // Conflict (reported, behaviour unchanged): Q both rotates the camera and toggles the queue panel.
  { key: 'q', owner: 'app/RTSCamera / queue-panel', action: 'rotate the camera left; also toggles the queue panel (QueuePanel)' },
  { key: 'e', owner: 'app/RTSCamera', action: 'rotate the camera right' },
  { key: 'w', owner: 'app/RTSCamera', action: 'pan up' },
  { key: 'a', owner: 'app/RTSCamera', action: 'pan left' },
  { key: 's', owner: 'app/RTSCamera', action: 'pan down' },
  { key: 'd', owner: 'app/RTSCamera', action: 'pan right' },
  { key: 'f', owner: 'app/RTSCamera', action: 'follow the HQ' },
  { key: '`', owner: 'dev/console', action: 'open the dev console' },
];

/** The table entry of `key` (lower case). */
export function hotkeyOf(key: string): HotkeyDef | undefined {
  return HOTKEYS.find((h) => h.key === key);
}

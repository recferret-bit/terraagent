import {
  formatBondLabel,
  formatTickRemaining,
  type DiplomacyBondSpec,
  type DiplomacyColonyView,
  type DiplomacyPanelActions,
  type DiplomacyWarView,
} from '../types';

export type WarBondPresetKey = '5_near' | '100_metals';

export const WAR_BOND_PRESETS: Readonly<Record<WarBondPresetKey, { label: string; spec: DiplomacyBondSpec }>> = {
  '5_near': { label: '5 NEAR', spec: { bondToken: 'NEAR', bondAmount: 5 } },
  '100_metals': { label: '100 Metals', spec: { bondToken: 'metals.t1', bondAmount: 100 } },
};

export function buildWarBadgeElement(
  war: DiplomacyWarView,
  currentTick: number,
  actions?: Partial<DiplomacyPanelActions>,
): HTMLElement {
  const badge = document.createElement('div');
  badge.className = 'ta-diplomacy-war-badge plate-sm';
  badge.dataset.testid = 'diplomacy-war-badge';
  badge.dataset.warId = war.warId;
  badge.dataset.role = war.role;

  const main = document.createElement('div');
  main.className = 'ta-diplomacy-truce-badge__main';

  const partner = document.createElement('span');
  partner.className = 'ta-diplomacy-truce-badge__partner';
  partner.textContent = `${war.role === 'attacker' ? 'SIEGE VS' : 'DEFENDING VS'} Colony #${war.partnerColony}`;

  const pill = document.createElement('span');
  pill.className = 'ta-diplomacy-war-badge__pill';
  pill.textContent = `${formatBondLabel(war.bondAmount, war.bondToken)} · 2X LOOT`;
  main.append(partner, pill);

  const obj = document.createElement('div');
  obj.className = 'ta-diplomacy-war-badge__objective';
  obj.dataset.testid = 'war-objective-progress';
  obj.textContent = `Objective: Structures ${war.structuresDestroyed}/1 · Siphoned ${Math.floor(war.resourcesSiphoned)}/200`;

  const footer = document.createElement('div');
  footer.className = 'ta-diplomacy-truce-badge__footer';

  const timer = document.createElement('span');
  timer.className = 'ta-diplomacy-truce-badge__timer';
  timer.dataset.testid = 'war-timer';
  timer.textContent = `6h Bond: ${formatTickRemaining(war.expiresAtTick, currentTick)}`;
  footer.appendChild(timer);

  if (war.role === 'attacker') {
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-ghost btn-sm';
    cancelBtn.dataset.action = 'cancel-war';
    cancelBtn.dataset.warId = war.warId;
    cancelBtn.textContent = 'Cancel (Slash)';
    cancelBtn.title = 'Forfeit war bond: 90% to Defender, 10% to TerraAgent Protocol';
    cancelBtn.onclick = () => actions?.onCancelWar?.(war.warId);
    footer.appendChild(cancelBtn);
  }

  badge.append(main, obj, footer);
  return badge;
}

export function renderWarDeclareSection(
  warDeclareEl: HTMLElement,
  view: DiplomacyColonyView,
  selectedTargetColony: number,
  selectedWarPreset: WarBondPresetKey,
  onSelectPreset: (preset: WarBondPresetKey) => void,
  onDeclare: () => void,
): void {
  warDeclareEl.replaceChildren();

  const label = document.createElement('div');
  label.className = 'ta-diplomacy-propose__label';
  label.textContent = '6H BONDED WAR ESCROW (2X LOOT)';

  const chips = document.createElement('div');
  chips.className = 'ta-diplomacy-chips';
  for (const key of ['5_near', '100_metals'] as const) {
    const preset = WAR_BOND_PRESETS[key];
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `ta-diplomacy-chip btn btn-ghost btn-sm ${key === selectedWarPreset ? 'ta-chip--active' : ''}`;
    chip.dataset.testid = `war-bond-chip-${key}`;
    chip.textContent = preset.label;
    chip.onclick = () => onSelectPreset(key);
    chips.appendChild(chip);
  }

  const note = document.createElement('div');
  note.className = 'ta-diplomacy-slash-note';
  note.textContent = '100% refunded on ≥1 structure or ≥200 siphoned in 6h. Cancel/expiry slashes 90% Defender · 10% TerraAgent Protocol.';

  const hasTruce = view.truces.some((t) => t.partnerColony === selectedTargetColony && t.status !== 'ended');
  const hasWar = (view.wars ?? []).some((w) => w.role === 'attacker' && w.partnerColony === selectedTargetColony);

  const declareBtn = document.createElement('button');
  declareBtn.type = 'button';
  declareBtn.className = 'btn btn-ghost btn-sm ta-diplomacy-war__submit';
  declareBtn.dataset.action = 'declare-war';
  declareBtn.textContent = `Declare 6h War on #${selectedTargetColony}`;
  declareBtn.disabled = hasTruce || hasWar;
  declareBtn.onclick = onDeclare;

  warDeclareEl.append(label, chips, note, declareBtn);
}

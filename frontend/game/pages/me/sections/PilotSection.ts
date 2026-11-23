import {
  LOCAL_MOCK_PLAYER_NAME_MAX,
  LOCAL_MOCK_PLAYER_NAME_MIN,
  validateLocalMockPlayerName,
  type MeProfileResponse,
} from '@terra/contracts';
import { saveMePilotHandle, type MeFetchFn } from '../api';
import { el, formatThinInt } from '../dom';
import './pilot.css';

export interface RenderPilotSectionOptions {
  readonly fetch?: MeFetchFn;
  readonly search?: string;
  readonly onRenamed?: (nextHandle: string) => void;
}

function formatPilotSince(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

function xpPercent(xp: number, currentLevelXp: number, nextLevelXp: number): number {
  if (nextLevelXp <= currentLevelXp) return 100;
  const span = nextLevelXp - currentLevelXp;
  const into = Math.max(0, xp - currentLevelXp);
  return Math.max(0, Math.min(100, Math.round((into / span) * 100)));
}

function updateStoredActivePilotHandle(nextHandle: string): void {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('ta_active_pilot') : null;
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    localStorage.setItem('ta_active_pilot', JSON.stringify({ ...parsed, handle: nextHandle }));
  } catch {
    /* ignore storage errors */
  }
}

function createRenameFormDom(initialHandle: string) {
  const input = el('input', {
    className: 'input ta-pilot-rename-input',
    type: 'text',
    aria: { label: 'New pilot name' },
    dataset: { testid: 'me-pilot-rename-input' },
  });
  input.minLength = LOCAL_MOCK_PLAYER_NAME_MIN;
  input.maxLength = LOCAL_MOCK_PLAYER_NAME_MAX;
  input.value = initialHandle;

  const status = el('span', {
    className: 'ta-pilot-rename-status',
    role: 'status',
    aria: { live: 'polite' },
    dataset: { testid: 'me-pilot-rename-status' },
  });
  const saveBtn = el('button', { className: 'btn btn-primary btn-sm', type: 'submit', dataset: { testid: 'me-pilot-rename-save' } }, 'Save');
  const cancelBtn = el('button', { className: 'btn btn-ghost btn-sm', type: 'button', dataset: { testid: 'me-pilot-rename-cancel' } }, 'Cancel');
  const form = el('form', { className: 'ta-pilot-rename-form', dataset: { testid: 'me-pilot-rename-form' } }, input, saveBtn, cancelBtn, status);
  form.noValidate = true;
  form.hidden = true;
  return { form, input, status, saveBtn, cancelBtn };
}

function buildInlineRenameControls(
  initialHandle: string,
  renameBtn: HTMLButtonElement,
  opts: RenderPilotSectionOptions,
  applyHandle: (nextHandle: string) => void,
): HTMLElement {
  let currentHandle = initialHandle;
  let saving = false;
  const { form, input, status, saveBtn, cancelBtn } = createRenameFormDom(initialHandle);

  const closeForm = (restoreFocus: boolean): void => {
    form.hidden = true;
    renameBtn.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-invalid');
    status.textContent = '';
    if (restoreFocus) renameBtn.focus();
  };

  renameBtn.addEventListener('click', () => {
    if (!form.hidden) return closeForm(false);
    input.value = currentHandle;
    input.removeAttribute('aria-invalid');
    status.textContent = '';
    form.hidden = false;
    renameBtn.setAttribute('aria-expanded', 'true');
    input.focus();
    input.select();
  });
  input.addEventListener('input', () => {
    input.removeAttribute('aria-invalid');
    if (status.dataset.tone === 'error') status.textContent = '';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeForm(true); }
  });
  cancelBtn.addEventListener('click', () => closeForm(true));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (saving) return;
    const checked = validateLocalMockPlayerName(input.value);
    if (!checked.ok) {
      input.setAttribute('aria-invalid', 'true');
      status.dataset.tone = 'error';
      status.textContent = checked.message;
      input.focus();
      return;
    }
    saving = true;
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    status.dataset.tone = 'info';
    status.textContent = 'Saving…';
    void saveMePilotHandle(checked.value, opts.fetch, opts.search)
      .then((res) => {
        if (!res.ok) {
          input.setAttribute('aria-invalid', 'true');
          status.dataset.tone = 'error';
          status.textContent = res.message;
          return;
        }
        currentHandle = res.handle;
        applyHandle(res.handle);
        updateStoredActivePilotHandle(res.handle);
        opts.onRenamed?.(res.handle);
        closeForm(true);
      })
      .finally(() => {
        saving = false;
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
      });
  });

  return form;
}

function buildPilotXpBlock(progression: MeProfileResponse['progression']): HTMLElement {
  const pct = xpPercent(progression.xp, progression.currentLevelXp, progression.nextLevelXp);
  const xpLabel = `${formatThinInt(progression.xp)} / ${formatThinInt(progression.nextLevelXp)}`;
  const xpHeader = el(
    'div',
    { className: 'ta-pilot-xp-head' },
    el('span', { className: 'plate-sm ta-pilot-level-badge', dataset: { testid: 'me-pilot-level' } }, `Level ${progression.level}`),
    el('span', { className: 'ta-pilot-xp-label', dataset: { testid: 'me-pilot-xp-text' } }, `${xpLabel} XP`),
  );
  const xpBar = el(
    'div',
    {
      className: 'ta-pilot-xp-bar',
      role: 'progressbar',
      dataset: { testid: 'me-pilot-xp-bar' },
      aria: {
        valuemin: String(progression.currentLevelXp),
        valuemax: String(progression.nextLevelXp),
        valuenow: String(progression.xp),
        label: 'Pilot XP progress',
      },
    },
    el('div', { className: 'ta-pilot-xp-fill', style: { width: `${pct}%` } }),
    el('span', { className: 'ta-pilot-xp-bar-text' }, xpLabel),
  );
  return el('div', { className: 'ta-pilot-xp-block' }, xpHeader, xpBar);
}

/**
 * Renders the Pilot identity section (`#pilot`, W12-14):
 * avatar + frame, handle + inline rename control, Pilot ID (`<name>.terraagent.mock`),
 * "pilot since", level badge (`Level 4`), XP bar (`1 120 / 1 500`), and title (`Surveyor`).
 */
export function renderPilotSection(
  profile: MeProfileResponse,
  opts: RenderPilotSectionOptions = {},
): HTMLElement {
  const { identity, progression } = profile;
  const pilotIdText = identity.accountId ?? identity.playerId;

  const avatarGlyphEl = el('span', { className: 'ta-pilot-avatar-glyph' }, (identity.handle.trim()[0] ?? 'P').toUpperCase());
  const avatar = el(
    'div',
    {
      className: `plate-sm ta-pilot-avatar ta-frame-${identity.frame}`,
      dataset: { testid: 'me-pilot-avatar', frame: identity.frame },
    },
    avatarGlyphEl,
  );

  const handleEl = el('h3', { className: 'ta-pilot-handle', dataset: { testid: 'me-pilot-handle' } }, identity.handle);
  const renameBtn = el(
    'button',
    {
      className: 'btn btn-ghost btn-sm ta-pilot-rename label c-orange',
      type: 'button',
      aria: { expanded: 'false' },
      dataset: { testid: 'me-pilot-rename' },
    },
    'Rename',
  );
  const renameForm = buildInlineRenameControls(identity.handle, renameBtn, opts, (nextHandle) => {
    handleEl.textContent = nextHandle;
    avatarGlyphEl.textContent = (nextHandle.trim()[0] ?? 'P').toUpperCase();
  });

  const nameRow = el(
    'div',
    { className: 'ta-pilot-name-row' },
    handleEl,
    el('span', { className: 'plate-sm ta-pilot-title-chip', dataset: { testid: 'me-pilot-title' } }, progression.title),
    renameBtn,
  );

  const metaRow = el(
    'div',
    { className: 'ta-pilot-meta-row' },
    el('div', { className: 'ta-pilot-meta-item' }, el('span', { className: 'label' }, 'PILOT ID'), el('span', { className: 'ta-pilot-id', dataset: { testid: 'me-pilot-id' } }, pilotIdText)),
    el('div', { className: 'ta-pilot-meta-item' }, el('span', { className: 'label' }, 'PILOT SINCE'), el('span', { className: 'ta-pilot-since', dataset: { testid: 'me-pilot-since' } }, `Pilot since ${formatPilotSince(identity.pilotSince)}`)),
  );

  return el(
    'div',
    { className: 'ta-pilot-body', dataset: { testid: 'me-pilot-body' } },
    el('div', { className: 'ta-pilot-identity' }, avatar, el('div', { className: 'ta-pilot-info' }, nameRow, renameForm, metaRow)),
    buildPilotXpBlock(progression),
  );
}

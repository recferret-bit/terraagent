// Section 05 interactive scenarios: mounts the 4 tactical scenario cards beside #director-terminal
// so clicking (or arrow-keying) any card updates the live trace right in the same console.
import { prefersReducedMotion } from '@terra/render/core/motionUtils';
import {
  renderDirectorScenariosHtml,
  renderTerminalBody,
  SCENARIOS,
} from './directorTemplates';

function bindScenarioSwitcher(host: HTMLElement): void {
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('[data-scenario-card]')];
  const terminal = document.getElementById('director-terminal');
  const titleEl = terminal?.querySelector<HTMLElement>('[data-dir-title]');
  const attestEl = terminal?.querySelector<HTMLElement>('[data-dir-attest]');
  const bodyEl = terminal?.querySelector<HTMLElement>('[data-dir-body]');

  const selectIndex = (index: number, focusBtn = false): void => {
    const btn = buttons[index];
    const target = SCENARIOS[index];
    if (!btn || !target) return;
    for (const b of buttons) {
      const selected = b === btn;
      b.classList.toggle('is-selected', selected);
      b.setAttribute('aria-pressed', String(selected));
    }
    if (focusBtn) btn.focus();
    if (titleEl) titleEl.textContent = target.terminalTitle;
    if (attestEl) attestEl.textContent = target.attestBadge;
    if (bodyEl) bodyEl.innerHTML = renderTerminalBody(target);
    if (terminal && typeof terminal.getBoundingClientRect === 'function') {
      const rect = terminal.getBoundingClientRect();
      if (rect.height > 0 && (rect.bottom < 80 || rect.top > innerHeight - 60)) {
        terminal.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
      }
    }
  };

  buttons.forEach((btn, idx) => {
    btn.addEventListener('click', () => selectIndex(idx));
    btn.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') {
        ev.preventDefault();
        selectIndex((idx + 1) % buttons.length, true);
      } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        selectIndex((idx - 1 + buttons.length) % buttons.length, true);
      }
    });
  });
}

export function initDirectorScenarios(): void {
  const host = document.getElementById('director-scenarios');
  if (!host) return;

  if (host.children.length === 0) host.innerHTML = renderDirectorScenariosHtml();
  bindScenarioSwitcher(host);

  const cards = [...host.querySelectorAll<HTMLElement>('[data-scenario-card]')];
  if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
    cards.forEach((c) => c.classList.add('is-visible'));
    return;
  }
  host.classList.add('js-reveal');
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          (e.target as HTMLElement).classList.add('is-visible');
          io.unobserve(e.target);
        }
      }
    },
    { threshold: 0.12 },
  );
  cards.forEach((c) => io.observe(c));
}

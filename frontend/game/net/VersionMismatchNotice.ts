import type { WorldStatus } from '../store/WorldStore';
import './banner.css';

interface StatusSource {
  readonly status: WorldStatus;
  onStatus(fn: (status: WorldStatus) => void): () => void;
}

/** Scenario reloads rejoin their existing planet; ordinary authenticated and local boots keep their URL. */
export function versionReloadUrl(href: string, planetId: string | null): string {
  const url = new URL(href);
  if (planetId && url.searchParams.get('host') !== 'local' && (url.searchParams.has('scenario') || url.searchParams.has('join'))) {
    url.searchParams.delete('scenario');
    url.searchParams.set('join', planetId);
  }
  return url.href;
}

/** Persistent update prompt, independent of socket health. Reload is always an explicit player action. */
export function bindVersionMismatchNotice(parent: HTMLElement, source: StatusSource, planetId: () => string | null): () => void {
  const el = document.createElement('div');
  el.className = 'ta-net-banner ta-version-notice plate';
  el.dataset.testid = 'version-mismatch';
  el.setAttribute('role', 'alert');
  el.hidden = true;
  el.textContent = 'Game updated. Reload to continue. ';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-primary btn-sm';
  button.textContent = 'Reload';
  button.onclick = () => window.location.assign(versionReloadUrl(window.location.href, planetId()));
  el.appendChild(button);
  parent.appendChild(el);
  const render = (status: WorldStatus) => { el.hidden = status.status !== 'versionMismatch'; };
  const off = source.onStatus(render);
  render(source.status);
  return () => { off(); button.onclick = null; el.remove(); };
}

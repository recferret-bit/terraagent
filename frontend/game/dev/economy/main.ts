import { EconomyPanel } from './panel';

/** Mounts the economy operator panel into `root` (`/dev/chain/?tab=economy`). */
export function mountEconomy(root: HTMLElement): void {
  root.replaceChildren();
  new EconomyPanel(root).render();
}

export const isEconomyTab = (search: string): boolean => new URLSearchParams(search).get('tab') === 'economy';

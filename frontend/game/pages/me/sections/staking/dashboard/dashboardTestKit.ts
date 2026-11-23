// Shared jsdom test kit for the dashboard specs: a routing fetch mock and a mount helper.
import { afterEach } from 'vitest';
import type { StakingPerformanceResponse } from '@terra/contracts';
import type { MeFetchFn } from '../../../api';
import { makePerformance, NOW } from './dashboardFixtures';
import { renderStakingDashboard, type StakingDashboardHandle } from './StakingDashboard';

export type Res = { ok: boolean; status: number; json(): Promise<unknown> };
export const ok = (body: unknown): Res => ({ ok: true, status: 200, json: async () => body });
export const fail = (status: number, body: unknown = {}): Res => ({ ok: false, status, json: async () => body });

export interface Mock {
  fetch: MeFetchFn;
  calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }>;
  /** Next performance payload factory (mutated by tests / action handlers). */
  perf: (window: '30d' | '90d' | '1y') => StakingPerformanceResponse | null;
  post: (path: string, body: Record<string, unknown>) => Res;
}

export function makeMock(initial: (w: '30d' | '90d' | '1y') => StakingPerformanceResponse | null = (w) => makePerformance({}, w)): Mock {
  const m: Mock = {
    calls: [],
    perf: initial,
    post: () => ok({}),
    fetch: async (url, init) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      m.calls.push({ url, method, body });
      if (url.includes('/v1/near/staking/performance')) {
        const w = new URL(url, 'http://x').searchParams.get('window') as '30d' | '90d' | '1y';
        const p = m.perf(w);
        return p ? ok(p) : fail(404);
      }
      // wallet status (pool pick): the mock host's whitelisted pool, no position yet
      if (method === 'GET' && /\/v1\/near\/staking\?/.test(url)) return ok({ positions: [], pools: [{ poolId: 'astro-stakers.pool.mock' }] });
      return m.post(url, body ?? {});
    },
  };
  return m;
}

const handles: StakingDashboardHandle[] = [];
export async function mount(mock: Mock, extra: Partial<Parameters<typeof renderStakingDashboard>[0]> = {}): Promise<HTMLElement> {
  const h = renderStakingDashboard({ accountId: 'pilot.mock', amount: 50, fetch: mock.fetch, search: '?as=w12', now: () => NOW, tickMs: 0, origin: 'https://terra.test', ...extra });
  handles.push(h);
  document.body.append(h.el);
  await h.ready;
  return h.el;
}
afterEach(() => {
  for (const h of handles.splice(0)) {
    h.dispose();
    h.el.remove();
  }
});

export const q = (root: ParentNode, id: string): HTMLElement | null => root.querySelector(`[data-testid="${id}"]`);
export const click = (root: ParentNode, id: string): void => {
  q(root, id)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};
export const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
export const perfCalls = (m: Mock): string[] => m.calls.filter((c) => c.url.includes('/staking/performance')).map((c) => c.url);

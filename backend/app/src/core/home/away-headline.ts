import type { AwaySummary, HomeResponse } from '@terra/contracts';

/** CT-04: the headline is optional. Past this, `/me/home` returns without it. */
export const AWAY_SUMMARY_BUDGET_MS = 250;

export interface AwayHeadline {
  headline(colonyId: string): Promise<AwaySummary | null>;
}

type ActiveHome = Extract<HomeResponse, { state: 'ACTIVE' }>;

/** Reads the newest unseen digest row. A miss or a slow read leaves `awaySummary` off the response. */
export async function attachAwaySummary(
  home: ActiveHome,
  source: AwayHeadline | undefined,
  budgetMs = AWAY_SUMMARY_BUDGET_MS,
): Promise<HomeResponse> {
  if (!source) return home;
  const awaySummary = await firstOf(source.headline(home.colony.id), budgetMs);
  return awaySummary ? { ...home, awaySummary } : home;
}

function firstOf(work: Promise<AwaySummary | null>, budgetMs: number): Promise<AwaySummary | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), budgetMs);
    timer.unref?.();
    work.then(
      (summary) => {
        clearTimeout(timer);
        resolve(summary);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

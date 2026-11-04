export interface DirectorAnalyticsEvent {
  readonly name: 'director.decision';
  readonly props: {
    readonly risk: 'conservative' | 'risky';
    readonly outcome: string;
  };
}

/** Consent off yields nothing. Props are enums only, never a prompt or a secret (AI §13). */
export function directorAnalytics(consent: boolean, risk: 'conservative' | 'risky', outcome: string): DirectorAnalyticsEvent | null {
  if (!consent) return null;
  if (outcome.length > 40 || outcome.includes(' ')) return null;
  return { name: 'director.decision', props: { risk, outcome } };
}

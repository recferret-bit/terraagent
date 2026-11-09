import {
  AWAY_DIRECTIVE_PCT_DEFAULT,
  AWAY_SESSION_PCT_DEFAULT,
  type AutopilotMode,
  type SetAutopilotArgs,
} from '@terra/contracts';

/** D-34 families. Oil is bio, not a fourth slider (BE-53). */
export const AWAY_FAMILIES = ['metals', 'minerals', 'bio'] as const;
export type AwayFamily = (typeof AWAY_FAMILIES)[number];

export const AWAY_FAMILY_LABEL: Record<AwayFamily, string> = {
  metals: 'Metals',
  minerals: 'Minerals',
  bio: 'Bio',
};

/** Shown, not edited: the stored directive default (AW-20). */
export const AWAY_DIRECTIVE_PCT = AWAY_DIRECTIVE_PCT_DEFAULT;

export interface AwaySettings {
  mode: AutopilotMode;
  awayRaids: boolean;
  session: Record<AwayFamily, number>;
}

export function defaultAwaySettings(): AwaySettings {
  const pct = AWAY_SESSION_PCT_DEFAULT;
  return { mode: 'director', awayRaids: false, session: { metals: pct, minerals: pct, bio: pct } };
}

/** 0 and 100 are legal. 101 is not (AW-20). */
export function isSessionPct(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 100;
}

export type AutopilotDiff =
  | { kind: 'args'; args: SetAutopilotArgs }
  | { kind: 'empty' }
  | { kind: 'invalid' };

/** Patch against the last ack. An out-of-range percent is `invalid` and must not be sent. */
export function diffAutopilot(prev: AwaySettings, next: AwaySettings): AutopilotDiff {
  if (!isMode(next.mode) || AWAY_FAMILIES.some((family) => !isSessionPct(next.session[family]))) {
    return { kind: 'invalid' };
  }
  const awayBudget: NonNullable<SetAutopilotArgs['awayBudget']> = {};
  let budget = false;
  for (const family of AWAY_FAMILIES) {
    if (next.session[family] === prev.session[family]) continue;
    awayBudget[family] = { perSessionPct: next.session[family] };
    budget = true;
  }
  const args: SetAutopilotArgs = {
    ...(next.mode !== prev.mode ? { mode: next.mode } : {}),
    ...(next.awayRaids !== prev.awayRaids ? { awayRaids: next.awayRaids } : {}),
    ...(budget ? { awayBudget } : {}),
  };
  if (args.mode === undefined && args.awayRaids === undefined && args.awayBudget === undefined) return { kind: 'empty' };
  return { kind: 'args', args };
}

function isMode(mode: string): mode is AutopilotMode {
  return mode === 'director' || mode === 'rules_only';
}

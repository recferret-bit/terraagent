import {
  DIRECTOR_ACTION_STATES,
  DIRECTOR_OUTCOMES,
  DIRECTOR_RISKS,
  DIRECTOR_SKILL_FAMILIES,
  DIRECTOR_TRIGGERS,
  type DirectorActionState,
  type DirectorOutcome,
  type DirectorRisk,
  type DirectorSkillFamily,
  type DirectorTrigger,
} from '@terra/contracts';

const LABEL_MAX = 40;
/** Prefixed entity ids (`co_`, `pl_`, …) and `scope:id` tokens are not metric labels. */
const ID_LABEL = /(?:co|pl|pr|mt|pt|cm|tr|or|bt|tc|col)_|:/;

export interface DirectorObservation {
  readonly trigger: string;
  readonly skill: string;
  readonly risk: string;
  readonly outcome: string;
  readonly waitMs: number;
  readonly actionState: string;
}

/** Distinct series key. Outcome is checked, then counted only through `actionState`. */
export interface DirectorLabelTriple {
  readonly trigger: DirectorTrigger;
  readonly skill: DirectorSkillFamily;
  readonly risk: DirectorRisk;
}

interface ParsedLabels extends DirectorLabelTriple {
  readonly outcome: DirectorOutcome;
  readonly actionState: DirectorActionState;
}

/**
 * In-memory load report for one director process (AI §13).
 * Labels are the small trigger, skill, risk, outcome and action-state enums. Colony ids never become labels.
 */
export class DirectorMetrics {
  private oldest = 0;
  private readonly actions = new Map<DirectorActionState, number>();
  private readonly rows: DirectorLabelTriple[] = [];
  private readonly keys = new Set<string>();

  observe(sample: DirectorObservation): void {
    const labels = readLabels(sample);
    const waitMs = readWait(sample.waitMs);
    this.remember(labels);
    this.actions.set(labels.actionState, (this.actions.get(labels.actionState) ?? 0) + 1);
    if (waitMs > this.oldest) this.oldest = waitMs;
  }

  /** Longest `waitMs` seen. Zero when nothing has been observed. */
  oldestWaitMs(): number {
    return this.oldest;
  }

  actionCounts(): Record<DirectorActionState, number> {
    return {
      proposed: this.actions.get('proposed') ?? 0,
      applied: this.actions.get('applied') ?? 0,
      rejected: this.actions.get('rejected') ?? 0,
      superseded: this.actions.get('superseded') ?? 0,
    };
  }

  labels(): readonly DirectorLabelTriple[] {
    return this.rows.map((row) => ({ ...row }));
  }

  private remember(labels: ParsedLabels): void {
    const key = `${labels.trigger}\0${labels.skill}\0${labels.risk}`;
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.rows.push({ trigger: labels.trigger, skill: labels.skill, risk: labels.risk });
  }
}

function readLabels(sample: DirectorObservation): ParsedLabels {
  return {
    trigger: oneOf(sample.trigger, DIRECTOR_TRIGGERS),
    skill: oneOf(sample.skill, DIRECTOR_SKILL_FAMILIES),
    risk: oneOf(sample.risk, DIRECTOR_RISKS),
    outcome: oneOf(sample.outcome, DIRECTOR_OUTCOMES),
    actionState: oneOf(sample.actionState, DIRECTOR_ACTION_STATES),
  };
}

function oneOf<T extends string>(value: string, allowed: readonly T[]): T {
  if (value.length > LABEL_MAX || ID_LABEL.test(value) || !isMember(allowed, value)) {
    throw new Error('director metric label is not a bounded enum');
  }
  return value;
}

function isMember<T extends string>(allowed: readonly T[], value: string): value is T {
  return (allowed as readonly string[]).includes(value);
}

function readWait(waitMs: number): number {
  if (!Number.isFinite(waitMs) || waitMs < 0) throw new Error('director metric waitMs is not a duration');
  return waitMs;
}

import type { ExperimentManifest } from '@terra/contracts';

export interface CandidateCheck { readonly ok: boolean; readonly errors: readonly { readonly code: string; readonly message: string }[] }

/**
 * ECONOMY §9: an endowment candidate regenerates an isolated seeded fixture (its endowment hash MUST differ and its runtime
 * hash stays equal, otherwise it changes nothing or two things at once); a runtime candidate keeps the SAME terrain (equal
 * endowment hash) and only changes operational/logistics inputs. A terrain change is never compared as a yield-only change.
 */
export function checkCandidateMode(baseline: ExperimentManifest, candidate: ExperimentManifest): CandidateCheck {
  const errors: { code: string; message: string }[] = [];
  const mode = candidate.candidateMode;
  if (!mode) errors.push({ code: 'candidate_mode_missing', message: 'a region comparison must declare candidateMode (endowment or runtime)' });
  const sameEndowment = baseline.endowmentHash !== undefined && baseline.endowmentHash === candidate.endowmentHash;
  const sameRuntime = baseline.runtimeEconomyHash !== undefined && baseline.runtimeEconomyHash === candidate.runtimeEconomyHash;
  if (mode === 'runtime' && !sameEndowment) errors.push({ code: 'terrain_changed_as_runtime', message: 'a runtime candidate must keep the baseline endowmentHash; a different terrain is an endowment candidate' });
  if (mode === 'endowment') {
    if (sameEndowment) errors.push({ code: 'endowment_unchanged', message: 'an endowment candidate must change endowmentHash' });
    if (!sameRuntime) errors.push({ code: 'endowment_changes_runtime', message: 'an endowment candidate must keep runtimeEconomyHash so only terrain differs' });
  }
  return { ok: errors.length === 0, errors };
}

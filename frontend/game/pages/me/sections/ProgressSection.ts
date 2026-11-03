import type { MeProfileResponse } from '@terra/contracts';
import { el } from '../dom';

/** Renders the Progress section body (`#progress`, implemented in W12-15). */
export function renderProgressSection(profile: MeProfileResponse): HTMLElement {
  return el(
    'div',
    { className: 'ta-progress-body', dataset: { testid: 'me-progress-body' } },
    el('span', null, `Stage S${profile.progression.unlockStage}`),
  );
}

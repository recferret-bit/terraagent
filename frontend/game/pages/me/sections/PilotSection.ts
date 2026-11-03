import type { MeProfileResponse } from '@terra/contracts';
import { el } from '../dom';

/** Renders the Pilot section body (`#pilot`, implemented in W12-14). */
export function renderPilotSection(profile: MeProfileResponse): HTMLElement {
  return el(
    'div',
    { className: 'ta-pilot-body', dataset: { testid: 'me-pilot-body' } },
    el('span', { className: 'ta-pilot-handle' }, profile.identity.handle),
  );
}

import { runtimeLabel } from './context';
import { trackProduct } from './trackSafe';

const SECTIONS = ['pilot', 'progress', 'planets', 'history', 'achievements', 'play'] as const;
export type ProfileSection = (typeof SECTIONS)[number];
export type ProfileReason = 'unauthorized' | 'network' | 'invalid' | 'unknown';

export function classifyProfileFailure(input: { status?: number; name?: string; network?: boolean; invalid?: boolean }): ProfileReason {
  if (input.status === 401 || input.status === 403) return 'unauthorized';
  if (input.network || input.name === 'TypeError') return 'network';
  if (input.invalid || input.name === 'ZodError' || input.status === 400 || input.status === 422) return 'invalid';
  return 'unknown';
}

export function isProfileSection(id: string): id is ProfileSection {
  return (SECTIONS as readonly string[]).includes(id);
}

export function noteProfileViewed(): void {
  trackProduct('profile_viewed', { runtime: runtimeLabel() });
}

export function noteProfileSection(section: string): void {
  if (!isProfileSection(section)) return;
  trackProduct('profile_section_opened', { section, runtime: runtimeLabel() });
}

export function noteProfileLoadFailed(reason: ProfileReason): void {
  trackProduct('profile_load_failed', { reason, runtime: runtimeLabel() });
}

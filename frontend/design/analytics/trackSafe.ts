import { sanitizeAnalyticsProps } from '@terra/contracts';
import { track } from '../../game/core/analytics';

export function trackProduct(name: string, props: Readonly<Record<string, string | number | boolean | null | undefined>>): void {
  track(name, sanitizeAnalyticsProps(name, props));
}

import type { AnalyticsSurface } from './context';
import { runtimeLabel } from './context';
import { noteGameplayError } from './play';
import { trackProduct } from './trackSafe';

export type ClientErrorReason = 'script' | 'resource' | 'socket' | 'unknown';

const RESOURCE_TAGS = new Set(['SCRIPT', 'LINK', 'IMG']);

let installed = false;

export function classifyClientError(event: Event): { kind: 'error' | 'rejection'; reason: ClientErrorReason } {
  if (isRejection(event)) {
    return { kind: 'rejection', reason: mentionsSocket(rejectionMessage(event)) ? 'socket' : 'unknown' };
  }
  if (isResourceLoad(event)) return { kind: 'error', reason: 'resource' };
  const message = event instanceof ErrorEvent ? event.message : '';
  if (mentionsSocket(message)) return { kind: 'error', reason: 'socket' };
  return { kind: 'error', reason: 'script' };
}

export function installClientErrorTracking(surface: AnalyticsSurface): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (event) => report(surface, event), true);
  window.addEventListener('unhandledrejection', (event) => report(surface, event));
}

function report(surface: AnalyticsSurface, event: Event): void {
  const classified = classifyClientError(event);
  trackProduct('client_error', { surface, kind: classified.kind, reason: classified.reason, runtime: runtimeLabel() });
  if (surface === 'play') noteGameplayError(classified.reason);
}

function isRejection(event: Event): boolean {
  return typeof PromiseRejectionEvent !== 'undefined' && event instanceof PromiseRejectionEvent;
}

function isResourceLoad(event: Event): boolean {
  const target = event.target;
  if (!target || target === window) return false;
  const tag = (target as unknown as { tagName?: string }).tagName;
  return typeof tag === 'string' && RESOURCE_TAGS.has(tag);
}

function rejectionMessage(event: Event): string {
  const reason = (event as PromiseRejectionEvent).reason;
  if (typeof reason === 'string') return reason;
  if (reason instanceof Error) return reason.message;
  return '';
}

function mentionsSocket(message: string): boolean {
  return /websocket/i.test(message);
}

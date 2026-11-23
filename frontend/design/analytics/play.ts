import { runtimeLabel } from './context';
import { trackProduct } from './trackSafe';

const PLANETS = ['dune', 'oceanForest', 'forestRock'] as const;
const BOOT_REASONS = ['boot', 'socket', 'auth', 'timeout', 'rejected', 'webgl', 'unknown'] as const;
const COMMANDS = ['move', 'build', 'terraform', 'attack', 'stop', 'other'] as const;
type Planet = (typeof PLANETS)[number];
type BootReason = (typeof BOOT_REASONS)[number];
type CommandKind = (typeof COMMANDS)[number];
type PlayHost = 'local' | 'online';

let lastPlanet: Planet | undefined;
let lastSelection = '';
let hostMode: PlayHost = 'online';
let pickerNoted = false;
let descentNoted = false;
let colonyNoted = false;
let booted = false;
let bootFailed = false;
let enterFailed = false;
let commandNoted = false;
let gameplayErrorNoted = false;

const IGNORED_COMMANDS = new Set(['landPod', 'ping', 'join', 'leave', 'reauth']);

export function setPlayHost(host: PlayHost): void {
  hostMode = host;
}

export function notePlanetPickerViewed(surface: 'landing' | 'play'): void {
  if (pickerNoted) return;
  pickerNoted = true;
  trackProduct('planet_picker_viewed', { surface, runtime: runtimeLabel() });
}

export function notePlanetSelected(planet: string, surface: 'landing' | 'play'): void {
  const kind = canonPlanet(planet);
  if (!kind) return;
  const key = `${surface}:${kind}`;
  lastPlanet = kind;
  if (lastSelection === key) return;
  lastSelection = key;
  trackProduct('planet_selected', { planet: kind, surface, runtime: runtimeLabel() });
}

export function bindLandingPlanets(): void {
  notePlanetPickerViewed('landing');
  if (typeof document === 'undefined') return;
  document.querySelectorAll<HTMLAnchorElement>('a[href*="planet="]').forEach((link) => {
    link.addEventListener('click', () => {
      const planet = new URL(link.href, location.origin).searchParams.get('planet');
      if (planet) notePlanetSelected(planet, 'landing');
    });
  });
}

export function noteDescentStarted(planet?: string | null): void {
  if (descentNoted) return;
  const kind = canonPlanet(planet) ?? lastPlanet;
  if (!kind) return;
  descentNoted = true;
  lastPlanet = kind;
  trackProduct('descent_started', { planet: kind, runtime: runtimeLabel() });
}

export function notePlayBooted(planet?: string | null, host?: PlayHost): void {
  if (host) hostMode = host;
  const kind = canonPlanet(planet) ?? lastPlanet;
  if (!kind || booted) {
    if (kind) lastPlanet = kind;
    return;
  }
  booted = true;
  lastPlanet = kind;
  trackProduct('play_booted', { planet: kind, host: hostMode, runtime: runtimeLabel() });
}

export function noteColonyEntered(planet?: string | null, host?: PlayHost): void {
  if (host) hostMode = host;
  if (colonyNoted) return;
  const kind = canonPlanet(planet) ?? lastPlanet;
  if (!kind) return;
  colonyNoted = true;
  lastPlanet = kind;
  trackProduct('colony_entered', { planet: kind, host: hostMode, runtime: runtimeLabel() });
}

export function classifyBootFailure(input: { message?: string; status?: number | null; code?: string; webgl?: boolean }): BootReason {
  const message = (input.message ?? '').toLowerCase();
  if (input.webgl || message.includes('webgl')) return 'webgl';
  if (message.includes('websocket') || message.includes('socket') || input.code === 'socket') return 'socket';
  if (input.status === 401 || input.status === 403 || /\b(401|403)\b/.test(message) || message.includes('/auth') || input.code === 'auth') return 'auth';
  if (message.includes('timeout') || message.includes('timed out') || input.status === 408 || /\b408\b/.test(message) || input.code === 'timeout') return 'timeout';
  if (message.includes('reject') || input.status === 400 || input.status === 409 || input.status === 422 || /\b(400|409|422)\b/.test(message) || input.code === 'rejected') return 'rejected';
  if (message.includes('boot') || message.includes('orbit') || message.includes('deploy') || input.code === 'boot') return 'boot';
  return 'unknown';
}

export function notePlayBootFailed(reason: BootReason): void {
  if (bootFailed) return;
  bootFailed = true;
  trackProduct('play_boot_failed', { reason, runtime: runtimeLabel() });
}

export function noteColonyEnterFailed(planet: string | null | undefined, reason: BootReason): void {
  if (enterFailed) return;
  const kind = canonPlanet(planet) ?? lastPlanet;
  if (!kind) return;
  enterFailed = true;
  trackProduct('colony_enter_failed', { planet: kind, reason, runtime: runtimeLabel() });
}

export function noteBootFailure(message: string, status?: number | null): void {
  const reason = classifyBootFailure({ message, status });
  notePlayBootFailed(reason);
  noteColonyEnterFailed(lastPlanet, reason);
}

export function notePlayerCommand(kind: string, args?: unknown): void {
  if (commandNoted || kind.startsWith('dev.') || IGNORED_COMMANDS.has(kind)) return;
  commandNoted = true;
  trackProduct('gameplay_first_command', { kind: classifyCommand(kind, args), runtime: runtimeLabel() });
}

export function noteGameplayError(reason: 'script' | 'resource' | 'socket' | 'unknown'): void {
  if (!colonyNoted || gameplayErrorNoted) return;
  gameplayErrorNoted = true;
  trackProduct('gameplay_error', { reason, runtime: runtimeLabel() });
}

function classifyCommand(kind: string, args?: unknown): CommandKind {
  const key = kind.toLowerCase();
  if (key.includes('attack')) return 'attack';
  if (key === 'stop' || key === 'stopunit' || key.includes('cancel')) return 'stop';
  if (key.includes('move')) return 'move';
  if (key === 'placebuilding' || key === 'build') return 'build';
  if (key.includes('terraform')) return 'terraform';
  if (key === 'enqueuetask') {
    const rec = args && typeof args === 'object' ? args as { terraform?: unknown } : undefined;
    return rec && 'terraform' in rec ? 'terraform' : 'build';
  }
  return 'other';
}

function canonPlanet(planet?: string | null): Planet | undefined {
  return planet === 'dune' || planet === 'oceanForest' || planet === 'forestRock' ? planet : undefined;
}

export type AutopilotMode = 'director' | 'rules_only';

export interface SharedAutopilotState {
  readonly aiEnabled: boolean;
  readonly awayRaids: boolean;
  readonly mode: AutopilotMode;
}

type Listener = (state: SharedAutopilotState) => void;

let currentState: SharedAutopilotState = {
  aiEnabled: false,
  awayRaids: false,
  mode: 'director',
};

const listeners = new Set<Listener>();

export function getSharedAutopilotState(): SharedAutopilotState {
  return currentState;
}

export function patchSharedAutopilotState(patch: Partial<SharedAutopilotState>): SharedAutopilotState {
  const next: SharedAutopilotState = {
    aiEnabled: patch.aiEnabled ?? currentState.aiEnabled,
    awayRaids: patch.awayRaids ?? currentState.awayRaids,
    mode: patch.mode ?? currentState.mode,
  };
  if (
    next.aiEnabled === currentState.aiEnabled &&
    next.awayRaids === currentState.awayRaids &&
    next.mode === currentState.mode
  ) {
    return currentState;
  }
  currentState = next;
  for (const fn of [...listeners]) {
    try {
      fn(currentState);
    } catch {
      // ignore listener errors
    }
  }
  return currentState;
}

export function subscribeSharedAutopilotState(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function resetSharedAutopilotStateForTests(): void {
  currentState = {
    aiEnabled: false,
    awayRaids: false,
    mode: 'director',
  };
  listeners.clear();
}

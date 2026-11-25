import '../../ui/ui.css';
import './combat-test.css';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import { OnlineSession } from '../../app/online/OnlineSession';
import { isProductionBuild } from '../../core/buildEnv';
import {
  COMBAT_SPAWN_PRESETS,
  buildCombatTestSearch,
  parseCombatTestUrlParams,
  type CombatTestMapSpec,
} from './catalog';
import { CombatTestPanel } from './CombatTestPanel';

declare global {
  interface Window {
    __combatTest?: {
      readonly biome: PlanetKind;
      readonly session: OnlineSession;
      readonly panel: CombatTestPanel;
      switchBiome(kind: PlanetKind): void;
      reset(): void;
      spawn(presetId: string, q?: number, r?: number, owner?: number): void;
    };
  }
}

function renderProductionDisabled(root: HTMLElement): void {
  root.innerHTML = '';
  const wrap = document.createElement('main');
  wrap.className = 'ta-ct-disabled';
  const card = document.createElement('section');
  card.className = 'ta-ct-disabled-card plate';
  card.dataset.testid = 'combat-test-disabled';
  const h1 = document.createElement('h1');
  h1.textContent = 'Combat Test Arena Disabled';
  const p = document.createElement('p');
  p.textContent = 'This dev-only combat sandbox route is excluded from production builds.';
  const back = document.createElement('a');
  back.className = 'btn btn-primary btn-sm';
  back.href = '/';
  back.textContent = 'Return to Hub';
  card.append(h1, p, back);
  wrap.appendChild(card);
  root.appendChild(wrap);
}

function bootCombatTest(): void {
  const root = document.getElementById('combat-test-app') ?? document.body;
  if (isProductionBuild()) {
    renderProductionDisabled(root);
    return;
  }

  root.innerHTML = '';
  root.className = 'ta-ct-root';
  const stage = document.createElement('div');
  stage.className = 'ta-ct-stage';
  const hudRoot = document.createElement('div');
  root.append(stage, hudRoot);

  let activeSession: OnlineSession | null = null;
  let activePanel: CombatTestPanel | null = null;
  const initial = parseCombatTestUrlParams(typeof location !== 'undefined' ? location.search : '');

  const mountMap = (spec: CombatTestMapSpec, seed: string, botCount: number, waves: string | null) => {
    activePanel?.dispose();
    activeSession?.dispose();
    hudRoot.replaceChildren();
    stage.replaceChildren();

    const nextSearch = buildCombatTestSearch({ biome: spec.kind, seed, botCount });
    if (typeof history !== 'undefined' && typeof location !== 'undefined') {
      history.replaceState(null, '', `${location.pathname}${nextSearch}`);
    }

    const session = new OnlineSession(stage, 'scenario', {
      uiParent: hudRoot,
      planetKind: spec.kind,
      loadMode: 'instant',
      skipDescent: true,
      combatTest: true,
      search: nextSearch,
      localHostOptions: {
        scenario: 'combatTest',
        combatTest: true,
        ephemeral: true,
        reset: true,
        planetType: spec.biome,
        seed,
        botCount,
        waves,
      },
    });

    const panel = new CombatTestPanel({
      root: hudRoot,
      activeSpec: spec,
      session,
      onSwitchBiome: (nextKind) => {
        const nextParsed = parseCombatTestUrlParams(`?biome=${nextKind}&bots=${botCount}${waves ? `&waves=${encodeURIComponent(waves)}` : ''}`);
        mountMap(nextParsed.spec, nextParsed.seed, nextParsed.botCount, nextParsed.waves);
      },
      onResetMap: () => {
        mountMap(spec, seed, botCount, waves);
      },
    });

    activeSession = session;
    activePanel = panel;
    window.__combatTest = {
      biome: spec.kind,
      session,
      panel,
      switchBiome: (nextKind) => {
        const nextParsed = parseCombatTestUrlParams(`?biome=${nextKind}&bots=${botCount}${waves ? `&waves=${encodeURIComponent(waves)}` : ''}`);
        mountMap(nextParsed.spec, nextParsed.seed, nextParsed.botCount, nextParsed.waves);
      },
      reset: () => mountMap(spec, seed, botCount, waves),
      spawn: (presetId, q, r, owner) => {
        const t = session.cameraTargetTile;
        const p = COMBAT_SPAWN_PRESETS.find((item) => item.id === presetId) ?? null;
        if (p) panel.spawnAt(p, q ?? t.q, r ?? t.r, owner);
      },
    };
  };

  mountMap(initial.spec, initial.seed, initial.botCount, initial.waves);
}

if (typeof document !== 'undefined') {
  bootCombatTest();
}

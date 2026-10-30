import { LAST_WAVE, waveId } from '@terra/contracts';
import { defineFeature, type FeatureContext } from '../../core/registry/types';
import type { FlagSource } from '../../core/flags/resolve';
import './flags.css';

declare module '../../core/registry/types' {
  interface FeatureServices {
    /** Where the active flag set came from (read-only flag panel). */
    flagsSource?: FlagSource;
  }
}

const SOURCE_LABEL: Record<FlagSource, string> = { welcome: 'server', override: '?waves= override', default: 'default' };
const ALL = Array.from({ length: LAST_WAVE + 1 }, (_, i) => waveId(i));

const flagLines = (ctx: FeatureContext) =>
  `${ctx.flags.size}/${ALL.length} on (${SOURCE_LABEL[ctx.services.flagsSource ?? 'default']}): ${ALL.filter((w) => ctx.flags.has(w)).join(' ')}`;

/** Minimal read-only flag panel (the runtime toggle comes later). */
export default defineFeature({
  id: 'flags',
  wave: 'W00',
  hud: [{
    id: 'waves', slot: 'top-right', order: -100,
    mount(el, ctx) {
      const on = ALL.filter((w) => ctx.flags.has(w)).length;
      let open = import.meta.env.DEV;
      const root = document.createElement('div');
      root.className = 'ta-flags plate-sm';
      el.appendChild(root);
      const render = () => {
        root.replaceChildren();
        root.dataset.open = String(open);
        const head = document.createElement('button');
        head.type = 'button';
        head.className = 'ta-flags__head';
        head.textContent = open ? 'WAVES' : `WAVES ${on}/${ALL.length}`;
        head.title = open ? 'Collapse' : 'Expand';
        head.setAttribute('aria-expanded', String(open));
        head.onclick = () => { open = !open; render(); };
        root.appendChild(head);
        if (!open) return;
        const count = document.createElement('span');
        count.className = 'ta-flags__count';
        count.textContent = `${on}/${ALL.length}`;
        head.appendChild(count);
        const chips = document.createElement('div');
        chips.className = 'ta-flags__chips';
        for (const w of ALL) {
          const chip = document.createElement('span');
          chip.className = 'ta-flags__chip';
          chip.dataset.wave = w;
          chip.dataset.on = String(ctx.flags.has(w));
          chip.textContent = w;
          chips.appendChild(chip);
        }
        const src = document.createElement('div');
        src.className = 'ta-flags__src';
        src.dataset.source = ctx.services.flagsSource ?? 'default';
        src.textContent = `source: ${SOURCE_LABEL[ctx.services.flagsSource ?? 'default']}`;
        root.append(chips, src);
      };
      render();
      return { dispose: () => root.remove() };
    },
  }],
  devCommands: [{ name: 'flags', help: 'Print the enabled waves and where they came from', run: (_a, ctx) => flagLines(ctx) }],
});

/* Lightweight Faction-Plate FPS counter in the top-right corner.
   Calculates running frames per second and frame time (ms), updating smoothly. */

const CSS = `
#fps-counter{position:fixed;top:12px;right:12px;z-index:90;pointer-events:none;display:flex;align-items:center;gap:6px;
  font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:#f2f4f7;
  background:rgba(8,10,16,.82);border:1px solid rgba(255,255,255,.18);border-right:3px solid #1e5bff;
  padding:6px 10px 6px 8px;backdrop-filter:blur(6px);clip-path:polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)}
#fps-counter .fps-dot{width:6px;height:6px;background:#3ddc84;display:inline-block;border-radius:1px}
#fps-counter.warn .fps-dot{background:#ffb020}
#fps-counter.crit .fps-dot{background:#ff4d6d}
#fps-counter .fps-val{color:#f2f4f7;font-weight:700;font-variant-numeric:tabular-nums;min-width:32px;text-align:right}
#fps-counter .fps-ms{color:#8a93a6;font-size:10px;font-variant-numeric:tabular-nums}
body.fps-hidden #fps-counter{display:none}
`;

let el: HTMLElement | null = null;
let frames = 0;
let lastTime = performance.now();
let rafId = 0;

export function initFpsCounter() {
  if (typeof document === 'undefined' || document.getElementById('fps-counter')) return;
  document.head.insertAdjacentHTML('beforeend', `<style id="fps-css">${CSS}</style>`);
  el = document.createElement('div');
  el.id = 'fps-counter';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<i class="fps-dot"></i><span class="fps-val">--</span><span>FPS</span><span class="fps-ms">(-- ms)</span>';
  document.body.appendChild(el);

  const valEl = el.querySelector<HTMLElement>('.fps-val')!;
  const msEl = el.querySelector<HTMLElement>('.fps-ms')!;

  const tick = (now: number) => {
    frames++;
    const delta = now - lastTime;
    if (delta >= 500) {
      const fps = Math.round((frames * 1000) / delta);
      const ms = (delta / frames).toFixed(1);
      valEl.textContent = String(fps);
      msEl.textContent = `(${ms} ms)`;
      if (el) {
        el.classList.toggle('warn', fps < 45 && fps >= 25);
        el.classList.toggle('crit', fps < 25);
      }
      frames = 0;
      lastTime = now;
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

export function disposeFpsCounter() {
  cancelAnimationFrame(rafId);
  document.getElementById('fps-counter')?.remove();
  document.getElementById('fps-css')?.remove();
  el = null;
}

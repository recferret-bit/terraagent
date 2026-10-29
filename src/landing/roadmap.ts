// Landing: the roadmap's flight plan (a burn line and a ship that ride your scroll, legs ignite as you pass them) and the
// road-to-market board (split-flap statuses that flip when the board comes into view, then now and then on their own).
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// ---- flight plan
const mission = document.getElementById('mission');
if (mission) {
  const legs = [...mission.querySelectorAll<HTMLElement>('[data-leg]')];
  mission.classList.add('js');
  const update = () => {
    const r = mission.getBoundingClientRect(), line = innerHeight * 0.6;
    const p = reduced ? 1 : clamp((line - r.top) / r.height, 0, 1);
    mission.style.setProperty('--p', String(p));
    for (const l of legs) l.classList.toggle('reached', reduced || l.querySelector('.leg-node')!.getBoundingClientRect().top < line);
  };
  let queued = false;
  const onScroll = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; update(); }); };
  addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onScroll);
  update();
}

// ---- split-flap board
const board = document.getElementById('board');
if (board) {
  const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const flaps = [...board.querySelectorAll<HTMLElement>('[data-flap]')];
  const cells = new Map<HTMLElement, { s: HTMLElement; ch: string }[]>();
  for (const el of flaps) {
    const text = el.textContent!.trim();
    el.setAttribute('role', 'img'); el.setAttribute('aria-label', text);
    el.textContent = ''; el.classList.add('is-flap');
    cells.set(el, [...text].map((ch) => {
      const s = document.createElement('span'); s.className = 'fc'; s.setAttribute('aria-hidden', 'true');
      s.textContent = ch === ' ' ? ' ' : ch; el.appendChild(s); return { s, ch };
    }));
  }
  const flip = (el: HTMLElement, delay = 0, ms = 520) => {
    const row = cells.get(el)!, t0 = performance.now() + delay;
    const tick = (now: number) => {
      let live = false;
      row.forEach(({ s, ch }, i) => {
        const end = t0 + ms + i * 55;
        if (now < t0) { live = true; return; }
        if (now < end) { live = true; s.textContent = ch === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0]; } else s.textContent = ch === ' ' ? ' ' : ch;
      });
      if (live) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  let seen = false, visible = false;
  new IntersectionObserver((es) => {
    visible = es[0].isIntersecting;
    if (visible && !seen && !reduced) { seen = true; flaps.forEach((el, i) => flip(el, i * 90)); }
  }, { threshold: 0.25 }).observe(board);
  if (!reduced) {
    const live = flaps.filter((el) => !el.classList.contains('s-off'));
    setInterval(() => { if (visible && seen) flip(live[(Math.random() * live.length) | 0], 0, 420); }, 5000); // a lane re-flips now and then
  }
}

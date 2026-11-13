// Interactive keyboard & button controller for the TerraAgent Pitch Deck (/pitchdeck/).
// Supports single-slide presentation mode (ArrowLeft/ArrowRight, 1..8) and full-scroll overview mode.

function rewriteSubdomainLinks(): void {
  if (location.hostname !== 'pitchdeck.terraagent.fun') return;
  const map: Readonly<Record<string, string>> = {
    '/': 'https://terraagent.fun/',
    '/landing.html': 'https://terraagent.fun/',
    '/play.html?planet=oceanForest&deploy=1': 'https://play.terraagent.fun/play.html?planet=oceanForest&deploy=1',
    '/trade.html': 'https://play.terraagent.fun/trade.html',
    '/me.html': 'https://play.terraagent.fun/me.html',
    '/dev/economy-sim/': 'https://play.terraagent.fun/dev/economy-sim/',
    '/whitepaper/': 'https://whitepaper.terraagent.fun/',
    '/v1/near/status': 'https://api.terraagent.fun/v1/near/status',
    '/v1/near/protocol': 'https://api.terraagent.fun/v1/near/protocol',
  };
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const raw = a.getAttribute('href');
    if (raw && map[raw]) a.href = map[raw];
  }
}

function bootPitchDeck(): void {
  rewriteSubdomainLinks();
  const root = document.querySelector<HTMLElement>('.pitch');
  const slides = [...document.querySelectorAll<HTMLElement>('[data-slide]')];
  const dotsHost = document.getElementById('pitch-dots');
  const prevBtn = document.getElementById('pitch-prev') as HTMLButtonElement | null;
  const nextBtn = document.getElementById('pitch-next') as HTMLButtonElement | null;
  const modeBtn = document.getElementById('pitch-mode') as HTMLButtonElement | null;
  const fill = document.getElementById('pitch-progress-fill');
  const counter = document.getElementById('pitch-counter');
  if (!root || slides.length === 0) return;

  let idx = 0;
  let deckMode = new URLSearchParams(location.search).get('view') !== 'all';

  const dots = slides.map((_, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pitch-dot';
    btn.textContent = `0${i + 1}`;
    btn.setAttribute('aria-label', `Slide ${i + 1}`);
    btn.addEventListener('click', () => go(i));
    dotsHost?.appendChild(btn);
    return btn;
  });

  function sync(): void {
    if (!root) return;
    root.classList.toggle('is-deck', deckMode);
    slides.forEach((s, i) => s.classList.toggle('is-active', i === idx));
    dots.forEach((d, i) => d.classList.toggle('is-active', deckMode && i === idx));
    if (prevBtn) prevBtn.disabled = !deckMode || idx === 0;
    if (nextBtn) nextBtn.disabled = !deckMode || idx === slides.length - 1;
    if (modeBtn) modeBtn.textContent = deckMode ? 'ALL SLIDES' : 'SLIDE VIEW';
    if (fill) fill.style.width = `${((idx + 1) / slides.length) * 100}%`;
    if (counter) counter.textContent = deckMode ? `SLIDE 0${idx + 1} / 0${slides.length} · ← → KEYS` : `ALL 0${slides.length} SLIDES`;
  }

  function go(next: number): void {
    idx = Math.max(0, Math.min(slides.length - 1, next));
    deckMode = true;
    sync();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  prevBtn?.addEventListener('click', () => go(idx - 1));
  nextBtn?.addEventListener('click', () => go(idx + 1));
  modeBtn?.addEventListener('click', () => {
    deckMode = !deckMode;
    sync();
  });

  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') go(idx + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(idx - 1);
    else if (e.key >= '1' && e.key <= String(slides.length)) go(Number(e.key) - 1);
  });

  sync();
}

bootPitchDeck();

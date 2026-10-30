// Live stats (GET /v1/planets/stats -> { planetsActive, coloniesAlive, playersOnline, updatedAt }), refreshed every minute.
export function initLiveStats(page: HTMLElement | null) {
  const api = page?.dataset.api || 'https://api.terraagent.com';
  const load = () => {
    if (!window.fetch || location.protocol === 'file:') return;
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 1500);
    fetch(api + '/v1/planets/stats', { signal: ctl.signal }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      document.querySelectorAll<HTMLElement>('[data-stat]').forEach((el) => {
        const v = d[el.dataset.stat!];
        if (typeof v === 'number') el.textContent = v.toLocaleString('en-US');
      });
    }).catch(() => {}).finally(() => clearTimeout(to));
  };
  load(); setInterval(load, 60000);
}

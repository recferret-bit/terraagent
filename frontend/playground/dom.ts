export const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
export const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Highlight the `[data-v]` button of the group `sel` whose value is `val`. */
export function setBtn(sel: string, val: string | null) {
  document.querySelectorAll<HTMLElement>(`${sel} [data-v]`).forEach((b) => b.classList.toggle('on', b.dataset.v === val));
}
export function download(url: string, name: string) { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }

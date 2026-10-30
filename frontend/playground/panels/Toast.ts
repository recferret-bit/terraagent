import { $ } from '../dom';

let timer = 0;
export function toast(msg: string) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(timer); timer = window.setTimeout(() => t.classList.remove('show'), 2200);
}

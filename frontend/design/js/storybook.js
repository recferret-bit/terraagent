/* Storybook-style explorer: story switching, Canvas/Docs tabs, background,
   button playground controls, switches, priority sliders, toast. No dependencies. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var STORIES = {
    button: ['Button', 'COMPONENTS / BUTTON / PLAYGROUND', 'Primary actions are verbs in uppercase on an orange plate. Only one primary per view.', 'Use System blue for secondary, AI or chain actions.', 'Never put white text on orange; it fails contrast.', "import { Button } from '@terra/ui';\n<Button variant=\"primary\" size=\"lg\">PICK A PLANET</Button>"],
    radio: ['Radio', 'COMPONENTS / RADIO / PLANET PICKER', 'Card radios pick one planet type or one open planet; inline radios for short choices.', 'Show the reason a choice is disabled (sealed, full).', 'Do not hide sealed planets without telling the player why.', '<RadioCard name="planet" value="desert" meta="3 / 5 SEATS" />'],
    toggle: ['Toggle', 'COMPONENTS / TOGGLE / AUTOPILOT', 'Switches apply instantly (autopilot, notifications). Checkboxes collect choices that are saved with a button.', 'Label the switch with the setting; show ON/OFF inside the track.', 'Do not use a switch for a choice that needs a confirm.', '<Switch checked={director} onChange={setDirector} label="AI Director" />'],
    slider: ['Slider', 'COMPONENTS / SLIDER / PRIORITIES', 'Priority sliders send one setPriorities command when released, in steps of 5.', 'Show the numeric value next to every slider.', 'Do not normalise values behind the player’s back.', '<PrioritySlider id="economy" value={60} step={5} />'],
    input: ['Input', 'COMPONENTS / INPUT · BADGE', 'Labels above fields in mono caps; help or error text below. Badges carry state in two words or fewer.', 'Errors say what happened and what to do next.', 'Do not rely on red alone; pair it with an icon or the word.', '<TextField label="COLONY NAME" hint="Up to 32 characters" />'],
    hud: ['HUD', 'GAME / HUD / OVERVIEW', 'In-game overlay: resource readouts with rate, grid meter, event log and toasts. Updates at most 10 times a second.', 'Rates in blue when positive, orange when negative.', 'Do not animate counters faster than the server tick.', '<ResourceBar resources={view.resources} />']
  };

  // stories
  function show(id) {
    var m = STORIES[id];
    $$('.sb-item').forEach(function (b) { b.setAttribute('aria-current', b.dataset.story === id ? 'page' : 'false'); });
    $$('[data-panel]').forEach(function (p) { p.hidden = p.dataset.panel !== id; });
    $('[data-title]').textContent = m[0];
    $('[data-tag]').textContent = m[1];
    $('[data-path]').textContent = id;
    $('[data-doc="usage"]').textContent = m[2];
    $('[data-doc="do"]').textContent = m[3];
    $('[data-doc="dont"]').textContent = m[4];
    $('[data-doc="code"]').textContent = m[5];
    $('[data-args]').hidden = id !== 'button';
    $('[data-no-args]').hidden = id === 'button';
    if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
  }
  $$('.sb-item').forEach(function (b) { b.addEventListener('click', function () { show(b.dataset.story); }); });
  $('#sb-search').addEventListener('input', function (e) {
    var q = e.target.value.trim().toLowerCase();
    $$('.sb-item').forEach(function (b) { b.hidden = q && b.textContent.toLowerCase().indexOf(q) < 0; });
  });

  // tabs + background
  $$('.sb-tab').forEach(function (t) {
    t.addEventListener('click', function () {
      var docs = t.dataset.tab === 'docs';
      $$('.sb-tab').forEach(function (x) { x.setAttribute('aria-selected', String(x === t)); });
      $('.sb-docs').hidden = !docs; $('.sb-canvas').hidden = docs;
    });
  });
  $$('.sb-chip').forEach(function (c) {
    c.addEventListener('click', function () {
      $$('.sb-chip').forEach(function (x) { x.setAttribute('aria-pressed', String(x === c)); });
      $('#preview').classList.toggle('is-light', c.dataset.bg === 'light');
    });
  });

  // button playground
  var btn = $('#pg-btn');
  function renderBtn() {
    var variant = $('#c-variant').value, size = $('#c-size').value;
    var disabled = $('#c-disabled').checked, loading = $('#c-loading').checked, arrow = $('#c-arrow').checked;
    btn.className = 'btn btn-' + variant + (size === 'md' ? '' : ' btn-' + size);
    btn.disabled = disabled;
    // loading keeps the variant colour but blocks clicks
    btn.setAttribute('aria-busy', String(loading));
    btn.style.opacity = loading ? '0.85' : '';
    btn.style.pointerEvents = loading ? 'none' : '';
    $('.spin', btn).hidden = !loading;
    $('[data-pg-arrow]', btn).hidden = !arrow || loading;
    $('[data-pg-label]', btn).textContent = ($('#c-label').value || 'BUTTON').toUpperCase();
  }
  ['#c-variant', '#c-size', '#c-label', '#c-disabled', '#c-loading', '#c-arrow'].forEach(function (s) {
    $(s).addEventListener('input', renderBtn); $(s).addEventListener('change', renderBtn);
  });
  renderBtn();

  // switches
  $$('.switch').forEach(function (s) {
    s.addEventListener('click', function () { s.setAttribute('aria-checked', String(s.getAttribute('aria-checked') !== 'true')); });
  });

  // priority sliders
  var names = { 'pr-economy': 'ECONOMY', 'pr-expand': 'EXPAND', 'pr-defense': 'DEFENSE', 'pr-rocket': 'ROCKET' };
  function renderPrio() {
    var top = null, max = -1;
    $$('.prio input').forEach(function (r) {
      r.style.setProperty('--val', r.value + '%');
      $('output[for="' + r.id + '"]').textContent = r.value;
      if (+r.value > max) { max = +r.value; top = r.id; }
    });
    $('[data-prio-hint]').textContent = 'Rule engine will favour ' + names[top] + ' first. Values are weights, not percentages.';
  }
  $$('.prio input').forEach(function (r) { r.addEventListener('input', renderPrio); });
  renderPrio();

  // toast
  $('#fire-toast').addEventListener('click', function () {
    var slot = $('#toast-slot'); slot.innerHTML = '';
    slot.appendChild($('#toast-tpl').content.cloneNode(true));
  });

  var start = location.hash.slice(1);
  show(STORIES[start] ? start : 'button');
})();

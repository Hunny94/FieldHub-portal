// FieldHub — page loading screen: the page blurs and a delivery rider rides round and round a circle, with a trail of dots behind him.
// LOOK ONLY: it reads and changes no data. It shows only when a page takes longer than a moment to load,
// covers only the page area (the menu and top bar stay usable), and always goes away by itself after 8 seconds.
// At sign-in it says "Logging you in" until the first page is ready (or the sign-in shows an error).
// TO REMOVE IT: delete this file (loader.js) on GitHub. Everything works exactly as before without it.
(function () {
  'use strict';
  if (window.__fhLoader) return; window.__fhLoader = true;

  // ---------------------------------------------------------------- the rider (drawn here, no picture file)
  const RIDER = `<svg class="fhl-rider" viewBox="0 0 130 86" aria-hidden="true">
    <g class="fhl-body">
      <rect x="10" y="22" width="34" height="28" rx="4" class="fhl-fill"/>
      <path d="M15 30h24" class="fhl-cut"/>
      <path d="M40 58 Q44 48 58 50 L84 50 Q90 50 92 44 L98 24 L104 24" class="fhl-stroke"/>
      <path d="M30 60 Q34 50 46 50 L70 50 L78 60 Z" class="fhl-fill"/>
      <path d="M96 30 L106 60" class="fhl-stroke"/>
      <circle cx="70" cy="12" r="9" class="fhl-fill"/>
      <path d="M72 8 h8 a4 4 0 0 1 -2 6 h-6 z" class="fhl-cut2"/>
      <path d="M66 22 Q60 34 62 46 L74 46 Q78 36 74 24 Z" class="fhl-fill"/>
      <path d="M70 28 L90 26 L98 25" class="fhl-stroke"/>
      <path d="M66 46 L80 48 L84 60" class="fhl-stroke"/>
    </g>
    <g class="fhl-wheel" style="transform-origin:34px 66px"><circle cx="34" cy="66" r="11" class="fhl-tyre"/><path d="M34 57v18M25 66h18" class="fhl-spoke"/></g>
    <g class="fhl-wheel" style="transform-origin:104px 66px"><circle cx="104" cy="66" r="11" class="fhl-tyre"/><path d="M104 57v18M95 66h18" class="fhl-spoke"/></g>
    <path d="M14 80h104" class="fhl-road"/>
  </svg>`;
  // the rider rides round a circle (centre 90,90, radius R); the dots follow behind him on the same circle, getting smaller
  const R = 62, C = 118;   // the box is big enough that the rider never leaves it, even upside down at the bottom
  const DOTS = [[-34, 6, 1], [-48, 5.2, .85], [-62, 4.4, .7], [-76, 3.7, .55], [-90, 3.1, .42], [-104, 2.6, .3]].map(([a, r, o]) => {
    const t = a * Math.PI / 180; return [C + R * Math.sin(t), C - R * Math.cos(t), r, o];
  });

  const css = document.createElement('style'); css.id = 'fhl-css';
  css.textContent = `
    #fh-load{position:fixed;z-index:9000;display:none;flex-direction:column;align-items:center;justify-content:center;gap:4px;
      background:rgba(243,245,251,.62);-webkit-backdrop-filter:blur(9px);backdrop-filter:blur(9px);opacity:0;transition:opacity .22s ease}
    #fh-load.show{opacity:1}
    html.fh-dark #fh-load:not(.fhl-login){background:rgba(13,18,48,.62)}
    #fh-load .fhl-art{position:relative;width:236px;height:236px;margin:-20px 0 0}
    #fh-load .fhl-track{position:absolute;left:56px;top:56px;width:124px;height:124px;border-radius:50%;border:2px dashed rgba(30,42,110,.18);box-sizing:border-box}
    #fh-load .fhl-orbit{position:absolute;inset:0;animation:fhlSpin 1.9s linear infinite}
    #fh-load .fhl-rider{position:absolute;left:79px;top:8px;width:78px;height:52px;overflow:visible}
    #fh-load .fhl-road{display:none}
    #fh-load .fhl-fill{fill:#1E2A6E}
    #fh-load .fhl-stroke{fill:none;stroke:#1E2A6E;stroke-width:6;stroke-linecap:round;stroke-linejoin:round}
    #fh-load .fhl-cut{stroke:rgba(255,255,255,.55);stroke-width:2.5;fill:none}
    #fh-load .fhl-cut2{fill:rgba(255,255,255,.75)}
    #fh-load .fhl-tyre{fill:none;stroke:#1E2A6E;stroke-width:5}
    #fh-load .fhl-spoke{stroke:#1E2A6E;stroke-width:2.5}
    #fh-load .fhl-wheel{animation:fhlSpin .5s linear infinite}
    #fh-load .fhl-road{stroke:#1E2A6E;stroke-width:2;stroke-dasharray:10 9;opacity:.35;animation:fhlRoad .4s linear infinite}
    #fh-load .fhl-dot{position:absolute;border-radius:50%;background:#1E2A6E}
    html.fh-dark #fh-load:not(.fhl-login) .fhl-fill,html.fh-dark #fh-load:not(.fhl-login) .fhl-dot{fill:#E0B23B;background:#E0B23B}
    html.fh-dark #fh-load:not(.fhl-login) .fhl-stroke,html.fh-dark #fh-load:not(.fhl-login) .fhl-tyre,html.fh-dark #fh-load:not(.fhl-login) .fhl-spoke,html.fh-dark #fh-load:not(.fhl-login) .fhl-road{stroke:#E0B23B}
    #fh-load b{font-size:17px;color:#151C3F;margin-top:10px}
    html.fh-dark #fh-load:not(.fhl-login) b{color:#eef1ff} html.fh-dark #fh-load:not(.fhl-login) .fhl-track{border-color:rgba(224,178,59,.25)}
    @keyframes fhlSpin{to{transform:rotate(360deg)}}
    @keyframes fhlRoad{to{stroke-dashoffset:-19}}
    @media (prefers-reduced-motion:reduce){#fh-load *{animation:none!important}}
  `;
  document.head.appendChild(css);

  let el = null;
  function build() {
    if (el && el.isConnected) return el;
    el = document.createElement('div'); el.id = 'fh-load'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<div class="fhl-art"><div class="fhl-track"></div><div class="fhl-orbit">' + RIDER + DOTS.map((d) => '<i class="fhl-dot" style="left:' + (d[0] - d[2]).toFixed(1) + 'px;top:' + (d[1] - d[2]).toFixed(1) + 'px;width:' + (d[2] * 2) + 'px;height:' + (d[2] * 2) + 'px;opacity:' + d[3] + '"></i>').join('') + '</div></div><b></b>';
    document.body.appendChild(el); return el;
  }
  let showT = null, hideT = null, maxT = null, shownAt = 0, kind = '';
  function place(full) {
    const area = document.querySelector('.main-area');
    if (full || !area || !area.offsetWidth) { Object.assign(el.style, { left: '0', top: '0', width: '100vw', height: '100vh' }); return; }
    const r = area.getBoundingClientRect();
    Object.assign(el.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  }
  function show(title, sub, opts) {
    opts = opts || {};
    clearTimeout(showT); clearTimeout(hideT); clearTimeout(maxT);
    const go = () => {
      build(); kind = opts.kind || 'page';
      el.classList.toggle('fhl-login', kind === 'login');
      el.querySelector('b').textContent = title;
      place(kind === 'login');
      el.style.display = 'flex'; void el.offsetWidth; el.classList.add('show'); shownAt = performance.now();
      maxT = setTimeout(hideNow, opts.max || 8000);
    };
    if (opts.delay) showT = setTimeout(go, opts.delay); else go();
  }
  function hideNow() {
    clearTimeout(showT); clearTimeout(maxT); clearTimeout(hideT); kind = '';
    if (!el) return;
    el.classList.remove('show'); hideT = setTimeout(() => { if (el) el.style.display = 'none'; }, 230);
  }
  function hide() {
    clearTimeout(showT);
    if (!el || el.style.display !== 'flex') { kind = ''; return; }
    const left = 450 - (performance.now() - shownAt);   // once it is up, it stays long enough not to flicker
    if (left > 0) { clearTimeout(hideT); hideT = setTimeout(hideNow, left); } else hideNow();
  }

  const label = () => { try { const v = state.view; return (typeof NAV_LABEL !== 'undefined' && NAV_LABEL[v]) || (document.getElementById('view-title') || {}).textContent || 'page'; } catch (_e) { return 'page'; } };

  // page changes: the portal already turns its thin progress bar on and off around each page; the rider follows it
  function hook() {
    if (typeof window.fhProgress !== 'function' || window.fhProgress.__fhl) return;
    const orig = window.fhProgress;
    const w = function (on) {
      try { orig.apply(this, arguments); } finally {
        try {
          if (kind === 'login') { if (!on && document.body.classList.contains('fh-app')) hide(); }
          else if (on) show('Loading ' + label(), '', { delay: 300 });
          else hide();
        } catch (_e) {}
      }
    };
    w.__fhl = true; window.fhProgress = w;
  }
  hook(); setTimeout(hook, 0); window.addEventListener('load', hook);

  // sign-in: "Logging you in" until the first page is ready; an error message takes it away at once
  document.addEventListener('submit', (e) => {
    if (e.target && e.target.id === 'login-form') show('Logging you in', '', { kind: 'login', max: 25000 });
  }, true);
  function hookAuth() {
    if (typeof window.showAuthMessage !== 'function' || window.showAuthMessage.__fhl) return;
    const orig = window.showAuthMessage;
    const w = function () { if (kind === 'login') hideNow(); return orig.apply(this, arguments); };
    w.__fhl = true; window.showAuthMessage = w;
  }
  hookAuth(); window.addEventListener('load', hookAuth);
  window.addEventListener('resize', () => { if (el && el.style.display === 'flex') place(kind === 'login'); });
  window.fhLoader = { show, hide: hideNow };
})();

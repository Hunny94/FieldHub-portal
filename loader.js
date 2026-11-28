// FieldHub — page loading screen: the page blurs and a delivery rider rides with a trail of dots behind him.
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
  // the trail of dots rises behind the rider, like the trail behind a plane
  const DOTS = [[60, 104, 3], [44, 96, 3.6], [31, 83, 4.2], [22, 66, 4.8], [18, 47, 5.4], [18, 26, 6]];

  const css = document.createElement('style'); css.id = 'fhl-css';
  css.textContent = `
    #fh-load{position:fixed;z-index:9000;display:none;flex-direction:column;align-items:center;justify-content:center;gap:4px;
      background:rgba(243,245,251,.62);-webkit-backdrop-filter:blur(9px);backdrop-filter:blur(9px);opacity:0;transition:opacity .22s ease}
    #fh-load.show{opacity:1}
    html.fh-dark #fh-load:not(.fhl-login){background:rgba(13,18,48,.62)}
    #fh-load .fhl-art{position:relative;width:200px;height:120px}
    #fh-load .fhl-rider{position:absolute;left:66px;top:30px;width:130px;height:86px;animation:fhlBob .45s ease-in-out infinite alternate;overflow:visible}
    #fh-load .fhl-fill{fill:#1E2A6E}
    #fh-load .fhl-stroke{fill:none;stroke:#1E2A6E;stroke-width:6;stroke-linecap:round;stroke-linejoin:round}
    #fh-load .fhl-cut{stroke:rgba(255,255,255,.55);stroke-width:2.5;fill:none}
    #fh-load .fhl-cut2{fill:rgba(255,255,255,.75)}
    #fh-load .fhl-tyre{fill:none;stroke:#1E2A6E;stroke-width:5}
    #fh-load .fhl-spoke{stroke:#1E2A6E;stroke-width:2.5}
    #fh-load .fhl-wheel{animation:fhlSpin .5s linear infinite}
    #fh-load .fhl-road{stroke:#1E2A6E;stroke-width:2;stroke-dasharray:10 9;opacity:.35;animation:fhlRoad .4s linear infinite}
    #fh-load .fhl-dot{position:absolute;border-radius:50%;background:#1E2A6E;animation:fhlDot 1.2s ease-in-out infinite}
    html.fh-dark #fh-load:not(.fhl-login) .fhl-fill,html.fh-dark #fh-load:not(.fhl-login) .fhl-dot{fill:#E0B23B;background:#E0B23B}
    html.fh-dark #fh-load:not(.fhl-login) .fhl-stroke,html.fh-dark #fh-load:not(.fhl-login) .fhl-tyre,html.fh-dark #fh-load:not(.fhl-login) .fhl-spoke,html.fh-dark #fh-load:not(.fhl-login) .fhl-road{stroke:#E0B23B}
    #fh-load b{font-size:17px;color:#151C3F;margin-top:6px} #fh-load span{font-size:13px;color:#5d6688}
    html.fh-dark #fh-load:not(.fhl-login) b{color:#eef1ff} html.fh-dark #fh-load:not(.fhl-login) span{color:#a9b3dc}
    @keyframes fhlBob{from{transform:translateY(0)}to{transform:translateY(-3px)}}
    @keyframes fhlSpin{to{transform:rotate(360deg)}}
    @keyframes fhlRoad{to{stroke-dashoffset:-19}}
    @keyframes fhlDot{0%,100%{opacity:.2;transform:scale(.7)}50%{opacity:1;transform:scale(1)}}
    @media (prefers-reduced-motion:reduce){#fh-load *{animation:none!important}}
  `;
  document.head.appendChild(css);

  let el = null;
  function build() {
    if (el && el.isConnected) return el;
    el = document.createElement('div'); el.id = 'fh-load'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<div class="fhl-art">' + RIDER + DOTS.map((d, i) => '<i class="fhl-dot" style="left:' + (d[0] - d[2]) + 'px;top:' + (d[1] - d[2]) + 'px;width:' + (d[2] * 2) + 'px;height:' + (d[2] * 2) + 'px;animation-delay:' + (i * 0.14).toFixed(2) + 's"></i>').join('') + '</div><b></b><span></span>';
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
      el.querySelector('b').textContent = title; el.querySelector('span').textContent = sub;
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
          else if (on) show('Loading ' + label(), 'Your rider is on the way…', { delay: 300 });
          else hide();
        } catch (_e) {}
      }
    };
    w.__fhl = true; window.fhProgress = w;
  }
  hook(); setTimeout(hook, 0); window.addEventListener('load', hook);

  // sign-in: "Logging you in" until the first page is ready; an error message takes it away at once
  document.addEventListener('submit', (e) => {
    if (e.target && e.target.id === 'login-form') show('Logging you in', 'Getting your dashboard ready', { kind: 'login', max: 25000 });
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

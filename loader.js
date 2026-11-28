// FieldHub — loading screen: the page blurs and the delivery rider (the rider picture) rides round a circle,
// nose first like the plane in the reference video, with a trail of dots behind him.
// LOOK ONLY: it reads and changes no data.
//   - page changes: shows only if a page takes longer than a moment; covers only the page area (menu and top bar stay usable);
//     always leaves by itself after 8 seconds
//   - sign-in: "Logging you in" until the first page is ready (an error message removes it at once)
//   - the start-up screen and any old round spinner use the same rider
// TO REMOVE IT: delete this file (loader.js) on GitHub. Everything works exactly as before without it.
(function () {
  'use strict';
  if (window.__fhLoader) return; window.__fhLoader = true;

  const RIDER = 'data:image/png;base64,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';   // the rider picture (one colour; the colour is set by CSS)

  // one rider-on-a-circle drawing, any size
  function art(S) {
    const C = S / 2, R = Math.round(S * 0.27), w = Math.round(S * 0.37), h = Math.round(w * 116 / 150);
    let dots = '';
    for (let k = 0; k < 9; k++) {
      const a = (-30 - k * 17) * Math.PI / 180, r = Math.max(1.4, S * (0.026 - k * 0.0024)), x = C + R * Math.sin(a), y = C - R * Math.cos(a);
      dots += '<i class="fhl-dot" style="left:' + (x - r).toFixed(1) + 'px;top:' + (y - r).toFixed(1) + 'px;width:' + (2 * r).toFixed(1) + 'px;height:' + (2 * r).toFixed(1) + 'px;opacity:' + (1 - k * 0.09).toFixed(2) + '"></i>';
    }
    return '<div class="fhl-art" style="width:' + S + 'px;height:' + S + 'px"><div class="fhl-orbit">' +
      '<i class="fhl-rider" style="left:' + (C - w / 2).toFixed(1) + 'px;top:' + (C - R - h + Math.round(h * 0.06)).toFixed(1) + 'px;width:' + w + 'px;height:' + h + 'px"></i>' + dots + '</div></div>';
  }

  const css = document.createElement('style'); css.id = 'fhl-css';
  css.textContent = `
    .fhl-art{position:relative;--fhl-c:#1E2A6E;flex:0 0 auto}
    .fhl-orbit{position:absolute;inset:0;animation:fhlSpin 1.6s linear infinite}
    .fhl-rider{position:absolute;display:block;background:var(--fhl-c);-webkit-mask:url(${RIDER}) center/contain no-repeat;mask:url(${RIDER}) center/contain no-repeat}
    .fhl-dot{position:absolute;border-radius:50%;background:var(--fhl-c)}
    @keyframes fhlSpin{to{transform:rotate(360deg)}}
    #fh-load{position:fixed;z-index:9000;display:none;flex-direction:column;align-items:center;justify-content:center;
      background:rgba(243,245,251,.7);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);opacity:0;transition:opacity .2s ease}
    #fh-load.show{opacity:1}
    #fh-load b{font-size:17px;color:#151C3F;margin-top:-26px;font-weight:700}
    html.fh-dark #fh-load:not(.fhl-login){background:rgba(13,18,48,.7)}
    html.fh-dark #fh-load:not(.fhl-login) .fhl-art{--fhl-c:#E0B23B}
    html.fh-dark #fh-load:not(.fhl-login) b{color:#eef1ff}
    #boot-loading .fhl-art{--fhl-c:#ffffff}
    .spinner.fhl-done{border:0!important;width:auto!important;height:auto!important;animation:none!important;display:flex;justify-content:center;background:none!important}
    html.fh-dark .spinner.fhl-done .fhl-art{--fhl-c:#E0B23B}
    @media (prefers-reduced-motion:reduce){.fhl-orbit{animation-duration:4s}}
  `;
  document.head.appendChild(css);

  // the start-up screen and any old round spinner get the rider instead
  function swapSpinners(root) {
    (root || document).querySelectorAll('.spinner:not(.fhl-done)').forEach((s) => {
      s.classList.add('fhl-done');
      s.innerHTML = art(s.closest('#boot-loading') ? 170 : 110);
    });
  }
  swapSpinners();
  new MutationObserver((recs) => {
    for (const r of recs) for (const n of r.addedNodes) if (n.nodeType === 1 && (n.classList.contains('spinner') || n.querySelector('.spinner'))) { swapSpinners(n.parentNode || n); return; }
  }).observe(document.documentElement, { childList: true, subtree: true });

  let el = null;
  function build() {
    if (el && el.isConnected) return el;
    el = document.createElement('div'); el.id = 'fh-load'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.innerHTML = art(200) + '<b></b>';
    document.body.appendChild(el); return el;
  }
  let showT = null, hideT = null, maxT = null, shownAt = 0, kind = '';
  function place(full) {
    const area = document.querySelector('.main-area');
    if (full || !area || !area.offsetWidth) { Object.assign(el.style, { left: '0', top: '0', width: '100vw', height: '100vh' }); return; }
    const r = area.getBoundingClientRect();
    Object.assign(el.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  }
  function show(title, opts) {
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
    el.classList.remove('show'); hideT = setTimeout(() => { if (el) el.style.display = 'none'; }, 220);
  }
  function hide() {
    clearTimeout(showT);
    if (!el || el.style.display !== 'flex') { kind = ''; return; }
    const left = 600 - (performance.now() - shownAt);   // once up, it stays long enough to see the rider move, without flicker
    if (left > 0) { clearTimeout(hideT); hideT = setTimeout(hideNow, left); } else hideNow();
  }

  const label = () => { try { const v = state.view; return (typeof NAV_LABEL !== 'undefined' && NAV_LABEL[v]) || (document.getElementById('view-title') || {}).textContent || 'page'; } catch (_e) { return 'page'; } };

  // page changes: the portal turns its thin progress bar on and off around each page; the rider follows it
  function hook() {
    if (typeof window.fhProgress !== 'function' || window.fhProgress.__fhl) return;
    const orig = window.fhProgress;
    const w = function (on) {
      try { orig.apply(this, arguments); } finally {
        try {
          if (kind === 'login') { if (!on && document.body.classList.contains('fh-app')) hide(); }
          else if (on) show('Loading ' + label(), { delay: 250 });
          else hide();
        } catch (_e) {}
      }
    };
    w.__fhl = true; window.fhProgress = w;
  }
  hook(); setTimeout(hook, 0); window.addEventListener('load', hook);

  // sign-in
  document.addEventListener('submit', (e) => {
    if (e.target && e.target.id === 'login-form') show('Logging you in', { kind: 'login', max: 25000 });
  }, true);
  function hookAuth() {
    if (typeof window.showAuthMessage !== 'function' || window.showAuthMessage.__fhl) return;
    const orig = window.showAuthMessage;
    const w = function () { if (kind === 'login') hideNow(); return orig.apply(this, arguments); };
    w.__fhl = true; window.showAuthMessage = w;
  }
  hookAuth(); window.addEventListener('load', hookAuth);
  window.addEventListener('resize', () => { if (el && el.style.display === 'flex') place(kind === 'login'); });
  window.fhLoader = { show: (t, o) => show(t, o), hide: hideNow, art };
})();

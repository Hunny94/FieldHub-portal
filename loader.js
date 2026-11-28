// FieldHub — loading screen: the page blurs; the delivery rider (the rider picture) stays in the middle with his wheels turning,
// and a ring of dots runs round him.
// LOOK ONLY: it reads and changes no data.
//   - page changes: shows only if a page takes longer than a moment; covers only the page area (menu and top bar stay usable);
//     always leaves by itself after 8 seconds
//   - sign-in: "Logging you in" until the first page is ready (an error message removes it at once)
//   - the start-up screen and any old round spinner use the same rider
// TO REMOVE IT: delete this file (loader.js) on GitHub. Everything works exactly as before without it.
(function () {
  'use strict';
  if (window.__fhLoader) return; window.__fhLoader = true;

  const RIDER = 'data:image/png;base64,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';   // the rider picture without its wheels (one colour, set by CSS)
  // a wheel that turns: tyre, hub and four spokes
  const WHEEL = '<svg viewBox="-21 -21 42 42" aria-hidden="true"><circle r="17" fill="none" stroke="currentColor" stroke-width="7"/><path d="M0-13.5V13.5M-13.5 0H13.5M-9.5-9.5L9.5 9.5M9.5-9.5L-9.5 9.5" stroke="currentColor" stroke-width="2.6"/><circle r="4.2" fill="currentColor"/></svg>';

  // the rider stays in the middle with his wheels turning; a ring of dots runs round him
  function art(S) {
    const C = S / 2, R = S * 0.44, w = Math.round(S * 0.5), h = Math.round(w * 116 / 150), wd = w * 0.195;
    let dots = '';
    const N = 16;
    for (let k = 0; k < N; k++) {
      const a = -(k / N) * 2 * Math.PI,   // biggest dot leads, the rest trail behind as the ring turns
       r = Math.max(1.3, S * (0.03 - k * 0.0016)), x = C + R * Math.sin(a), y = C - R * Math.cos(a);
      dots += '<i class="fhl-dot" style="left:' + (x - r).toFixed(1) + 'px;top:' + (y - r).toFixed(1) + 'px;width:' + (2 * r).toFixed(1) + 'px;height:' + (2 * r).toFixed(1) + 'px;opacity:' + Math.max(0.12, 1 - k * 0.06).toFixed(2) + '"></i>';
    }
    const wheel = (cx) => '<i class="fhl-wheel" style="left:' + (cx * w - wd / 2).toFixed(1) + 'px;top:' + (0.824 * h - wd / 2).toFixed(1) + 'px;width:' + wd.toFixed(1) + 'px;height:' + wd.toFixed(1) + 'px">' + WHEEL + '</i>';
    return '<div class="fhl-art" style="width:' + S + 'px;height:' + S + 'px"><div class="fhl-ring">' + dots + '</div>' +
      '<div class="fhl-bike" style="left:' + (C - w / 2).toFixed(1) + 'px;top:' + (C - h / 2).toFixed(1) + 'px;width:' + w + 'px;height:' + h + 'px"><i class="fhl-rider"></i>' + wheel(0.25) + wheel(0.7548) + '</div></div>';
  }

  const css = document.createElement('style'); css.id = 'fhl-css';
  css.textContent = `
    .fhl-art{position:relative;--fhl-c:#1E2A6E;flex:0 0 auto;color:var(--fhl-c)}
    .fhl-ring{position:absolute;inset:0;animation:fhlSpin 1.3s linear infinite}
    .fhl-dot{position:absolute;border-radius:50%;background:var(--fhl-c)}
    .fhl-bike{position:absolute;animation:fhlBob .5s ease-in-out infinite alternate}
    .fhl-rider{position:absolute;inset:0;display:block;background:var(--fhl-c);-webkit-mask:url(${RIDER}) center/100% 100% no-repeat;mask:url(${RIDER}) center/100% 100% no-repeat}
    .fhl-wheel{position:absolute;display:block;animation:fhlSpin .45s linear infinite}
    .fhl-wheel svg{display:block;width:100%;height:100%}
    @keyframes fhlSpin{to{transform:rotate(360deg)}}
    @keyframes fhlBob{from{transform:translateY(0)}to{transform:translateY(-2px)}}
    #fh-load{position:fixed;z-index:9000;display:none;flex-direction:column;align-items:center;justify-content:center;
      background:rgba(243,245,251,.7);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);opacity:0;transition:opacity .2s ease}
    #fh-load.show{opacity:1}
    #fh-load b{font-size:17px;color:#151C3F;margin-top:8px;font-weight:700}
    html.fh-dark #fh-load:not(.fhl-login){background:rgba(13,18,48,.7)}
    html.fh-dark #fh-load:not(.fhl-login) .fhl-art{--fhl-c:#E0B23B}
    html.fh-dark #fh-load:not(.fhl-login) b{color:#eef1ff}
    #boot-loading .fhl-art{--fhl-c:#ffffff}
    .spinner.fhl-done{border:0!important;width:auto!important;height:auto!important;animation:none!important;display:flex;justify-content:center;background:none!important}
    html.fh-dark .spinner.fhl-done .fhl-art{--fhl-c:#E0B23B}
    @media (prefers-reduced-motion:reduce){.fhl-ring,.fhl-wheel{animation-duration:3s}.fhl-bike{animation:none}}
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

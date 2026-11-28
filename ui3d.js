// FieldHub — immersive 3D look for the WHOLE portal (option C, "lite": no 3D engine, about 12 KB).
// LOOK ONLY. It reads nothing from the database and changes nothing: no data, no buttons, no layout sizes.
//   - every page: a moving 3D floor, light and particles drawn BEHIND the content
//   - every page: cards rise into place in 3D when the page opens, with deeper shadows
//   - clickable tiles tilt toward the mouse (phones: a small press); forms and tables never tilt
//   - every pop-up window opens with a short 3D swing
// The sign-in page is not touched (it stays plain and light).
//
// Each person can switch it with the "3D" button at the top: Auto / On / Off (saved on that device only).
//   Auto = on, except on weak phones, battery/data saver, or when the phone asks for less motion.
// TO REMOVE IT FOR EVERYONE: delete this file (ui3d.js) on GitHub. The portal works exactly as before without it.
(function () {
  'use strict';
  if (window.__fh3d) return; window.__fh3d = true;

  const KEY = 'fh_3d';
  const mode = () => { try { const m = localStorage.getItem(KEY); return m === 'on' || m === 'off' ? m : 'auto'; } catch (_e) { return 'auto'; } };
  function weakDevice() {
    try {
      if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
      const c = navigator.connection; if (c && c.saveData) return true;
      if (navigator.deviceMemory && navigator.deviceMemory <= 2) return true;
      if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) return true;
    } catch (_e) {}
    return false;
  }
  const enabled = () => mode() === 'on' || (mode() === 'auto' && !weakDevice());
  const isDark = () => document.documentElement.classList.contains('fh-dark');
  const inApp = () => { try { return document.body.classList.contains('fh-app') && typeof state !== 'undefined' && !!state.user && !!document.querySelector('.main-area #main-content'); } catch (_e) { return false; } };
  const curView = () => { try { return (typeof state !== 'undefined' && state.view) || ''; } catch (_e) { return ''; } };

  // ---------------------------------------------------------------- styles (only while the effect is on)
  const css = document.createElement('style'); css.id = 'fh3d-css';
  const CARDS = '#main-content .card,#main-content .fv-card2,#main-content .fv-panel,#main-content .ft-card,#main-content .fr-card';
  const DEEP = CARDS.split(',').map((s) => 'body.fh3d-on ' + s).join(',');
  const DEEPD = CARDS.split(',').map((s) => 'html.fh-dark body.fh3d-on ' + s).join(',');
  css.textContent = `
    #fh3d-wrap{position:sticky;top:0;height:0;z-index:0;pointer-events:none;display:none}
    #fh3d-wrap canvas{position:absolute;left:0;top:0;display:block}
    body.fh3d-on #fh3d-wrap{display:block}
    body.fh3d-on #main-content{position:relative;z-index:1}
    ${DEEP}{box-shadow:0 1px 2px rgba(30,42,110,.06),0 12px 30px rgba(30,42,110,.12)}
    ${DEEPD}{box-shadow:0 0 0 1px rgba(224,178,59,.14),0 16px 40px rgba(0,0,0,.42)}
    #fh3d-btn{font-weight:700;letter-spacing:.3px;min-width:44px}
    #fh3d-btn[data-m="off"]{opacity:.6}
    @media print{#fh3d-wrap{display:none!important}}
  `;
  document.head.appendChild(css);

  // ---------------------------------------------------------------- the moving backdrop (plain 2D canvas, 30 frames a second at most)
  let wrap = null, cv = null, ctx = null, raf = 0, last = 0, t0 = performance.now(), W = 0, H = 0, dpr = 1, area = null, busyUntil = 0;
  const rnd = (s) => () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const r = rnd(20261128);
  const dots = Array.from({ length: 46 }, () => ({ x: r(), y: r(), s: 1 + r() * 2.4, v: 0.012 + r() * 0.03, p: r() * 6.28 }));
  function build() {
    area = document.querySelector('.main-area'); if (!area) return false;
    if (!wrap || !wrap.isConnected) {
      wrap = document.createElement('div'); wrap.id = 'fh3d-wrap'; wrap.setAttribute('aria-hidden', 'true');
      cv = document.createElement('canvas'); wrap.appendChild(cv); area.insertBefore(wrap, area.firstChild);
      ctx = cv.getContext('2d');
    }
    size(); return !!ctx;
  }
  function size() {
    if (!area || !cv) return;
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = area.clientWidth, h = area.clientHeight;
    if (w === W && h === H && cv.width) return;
    W = w; H = h; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px';
  }
  function draw(now) {
    const t = (now - t0) / 1000, dark = isDark(), sc = area ? area.scrollTop : 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const glow = (x, y, rad, col) => { const g = ctx.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2); };
    glow(W * (0.78 + 0.05 * Math.sin(t * 0.21)), H * (0.18 + 0.04 * Math.cos(t * 0.17)), Math.max(W, H) * 0.45, dark ? 'rgba(224,178,59,.16)' : 'rgba(30,42,110,.07)');
    glow(W * (0.15 + 0.04 * Math.cos(t * 0.19)), H * (0.75 + 0.05 * Math.sin(t * 0.23)), Math.max(W, H) * 0.5, dark ? 'rgba(80,110,230,.18)' : 'rgba(224,178,59,.08)');
    // the 3D floor: lines run to a vanishing point and slide toward you; scrolling tips the horizon a little
    const hz = H * 0.52 - Math.min(sc * 0.15, H * 0.2), vx = W / 2 + Math.sin(t * 0.15) * W * 0.04, line = dark ? '224,178,59' : '30,42,110', a0 = dark ? 0.32 : 0.13;
    ctx.lineWidth = 1;
    for (let i = -14; i <= 14; i++) {
      const xb = vx + i * W * 0.11, a = a0 * (1 - Math.abs(i) / 16);
      const g = ctx.createLinearGradient(0, hz, 0, H); g.addColorStop(0, `rgba(${line},0)`); g.addColorStop(1, `rgba(${line},${a})`);
      ctx.strokeStyle = g; ctx.beginPath(); ctx.moveTo(vx, hz); ctx.lineTo(xb, H); ctx.stroke();
    }
    const sp = (t * 0.18) % 1;
    for (let k = 0; k < 12; k++) {
      const z = (k + sp) / 12, y = hz + (H - hz) * z * z;
      ctx.strokeStyle = `rgba(${line},${(a0 * z).toFixed(3)})`; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.fillStyle = dark ? 'rgba(224,178,59,1)' : 'rgba(30,42,110,1)';
    for (const d of dots) {
      const y = (((d.y - t * d.v) % 1) + 1) % 1, x = d.x + 0.01 * Math.sin(t * 0.6 + d.p);
      ctx.globalAlpha = (dark ? 0.55 : 0.18) * (0.5 + 0.5 * Math.sin(t * 1.3 + d.p)) * Math.min(1, y * 4);
      ctx.beginPath(); ctx.arc(x * W, y * H, d.s, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // while someone types or scrolls, the backdrop holds still, so typing and scrolling stay smooth
  const typing = () => { const a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable); };
  function loop(now) {
    raf = 0;
    if (!active || document.hidden) return;
    if (!inApp()) { leave(); return; }
    if (now - last > 33 && now > busyUntil && !typing()) { last = now; try { size(); draw(now); } catch (_e) { leave(); return; } }
    raf = requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- cards rise into place when a page opens
  const seen = new WeakSet();
  let entranceUntil = 0, lastView = null;
  function entrance() {
    if (!active || performance.now() > entranceUntil) return;
    const list = [...document.querySelectorAll('#main-content .fh-hero, ' + CARDS)].filter((el) => !seen.has(el) && !el.parentElement.closest('.card,.fv-card2,.fv-panel,.ft-card,.fr-card'));
    let i = 0;
    for (const el of list) {
      seen.add(el);
      if (i >= 14 || !el.animate) continue;
      const b = el.getBoundingClientRect(); if (b.top > window.innerHeight) continue;   // only what is on screen
      try { el.animate([{ transform: 'perspective(1100px) rotateX(14deg) translateY(22px)', opacity: 0.001 }, { transform: 'perspective(1100px) rotateX(0deg) translateY(0)', opacity: 1 }],
        { duration: 560, delay: i * 50, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }); } catch (_e) {}
      i++;
    }
  }
  let entT = null;
  const mo = new MutationObserver(() => {
    const v = curView();
    if (v !== lastView) { lastView = v; entranceUntil = performance.now() + 1800; if (tiltEl) untilt(); }
    clearTimeout(entT); entT = setTimeout(entrance, 40);
  });
  // pop-up windows swing open
  const mo2 = new MutationObserver((recs) => {
    if (!active) return;
    for (const rc of recs) for (const n of rc.addedNodes) {
      if (n.nodeType !== 1 || !n.classList || !n.classList.contains('modal-overlay')) continue;
      const m = n.querySelector('.modal'); if (!m || !m.animate) continue;
      try { m.animate([{ transform: 'perspective(1200px) rotateX(-10deg) translateY(18px) scale(.96)', opacity: 0.001 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' }); } catch (_e) {}
    }
  });

  // ---------------------------------------------------------------- tiles that open something tilt toward the mouse (phones: a small press)
  const TILT = '#main-content .stat-card, #main-content .fh-hero, #main-content .card[onclick], #main-content .fv-card2[onclick]';
  const fine = () => window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  let tiltEl = null;
  function untilt() { if (tiltEl) { tiltEl.style.transform = ''; tiltEl.style.transition = ''; tiltEl = null; } }
  function onMove(e) {
    if (!active || !fine()) return;
    const el = e.target && e.target.closest ? e.target.closest(TILT) : null;
    if (tiltEl && tiltEl !== el) untilt();
    if (!el) return;
    const b = el.getBoundingClientRect(); if (b.width > 900) return;       // wide panels stay flat
    const px = (e.clientX - b.left) / b.width - 0.5, py = (e.clientY - b.top) / b.height - 0.5;
    const big = el.classList.contains('fh-hero') ? 0.35 : 1;
    el.style.transition = 'transform .12s ease-out';
    el.style.transform = `perspective(900px) rotateX(${(-py * 9 * big).toFixed(2)}deg) rotateY(${(px * 11 * big).toFixed(2)}deg) translateY(${(-4 * big).toFixed(1)}px)`;
    tiltEl = el;
  }
  function onDown(e) {
    if (!active || fine()) return;
    const el = e.target && e.target.closest ? e.target.closest('#main-content .stat-card, #main-content .card[onclick]') : null;
    if (!el || !el.animate) return;
    try { el.animate([{ transform: 'perspective(700px) scale(1)' }, { transform: 'perspective(700px) translateZ(-24px) scale(.98)' }, { transform: 'perspective(700px) scale(1)' }], { duration: 260, easing: 'ease-out' }); } catch (_e) {}
  }

  // ---------------------------------------------------------------- switching on and off
  let active = false;
  function enter() {
    if (!enabled() || !inApp()) { leave(); return; }
    if (!build()) return;
    document.body.classList.add('fh3d-on');
    if (!active) {
      active = true; t0 = performance.now() - 8000;
      const mc = document.getElementById('main-content'); if (mc) mo.observe(mc, { childList: true, subtree: true });
      mo2.observe(document.body, { childList: true });
      lastView = curView(); entranceUntil = performance.now() + 1800; entrance();
    }
    size();
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function leave() {
    if (active) { mo.disconnect(); mo2.disconnect(); }
    active = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    document.body.classList.remove('fh3d-on');
    untilt();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && active && !raf) raf = requestAnimationFrame(loop); });
  window.addEventListener('resize', () => { if (active) size(); });
  document.addEventListener('scroll', () => { busyUntil = performance.now() + 180; }, { passive: true, capture: true });
  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerdown', onDown, { passive: true });
  document.addEventListener('mouseleave', untilt);
  // signs in and out, and the 3D button, are noticed here
  setInterval(() => { try { if (inApp() && enabled()) { if (!active) enter(); } else if (active) leave(); } catch (_e) {} }, 1200);

  // ---------------------------------------------------------------- the 3D button at the top (Auto / On / Off)
  const LABEL = { auto: '3D Auto', on: '3D On', off: '3D Off' };
  function button() {
    if (document.getElementById('fh3d-btn')) return;
    const ref = document.getElementById('ribbon-theme'); if (!ref || !ref.parentNode) return;
    const b = document.createElement('button'); b.id = 'fh3d-btn'; b.type = 'button'; b.className = ref.className; b.textContent = '3D';
    const paint = () => { const m = mode(); b.dataset.m = m; b.title = LABEL[m] + ' — tap to change'; b.setAttribute('aria-label', b.title); };
    b.onclick = () => {
      const next = { auto: 'on', on: 'off', off: 'auto' }[mode()];
      try { localStorage.setItem(KEY, next); } catch (_e) {}
      paint(); leave(); if (next !== 'off') enter();
      const msg = next === 'auto' ? '3D look: Auto (off on weak phones)' : next === 'on' ? '3D look: On' : '3D look: Off';
      try { toast(msg); } catch (_e) {}
    };
    paint(); ref.parentNode.insertBefore(b, ref);
  }
  setInterval(button, 2000); button();
})();

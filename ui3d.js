// FieldHub — 3D look for the whole portal (light AND dark mode, website AND phone app). About 9 KB, no 3D engine.
// LOOK ONLY. It reads nothing from the database and changes nothing: no data, no buttons, no layout sizes, no colours of
// notices or status badges. Light and dark mode both keep working as before; the 3D look follows whichever is chosen.
//   - every page: a still 3D floor and soft light behind the content (a picture, so it costs nothing while you work)
//   - every card: raised, with an edge light and layered shadows; cards that open something lift when pointed at
//   - cards tilt toward the mouse (wide panels and tables stay still); on phones tiles press in when tapped
//   - when a page opens, its cards fly in from 3D space into place (like option C); pop-up windows swing open
//   - buttons are raised and press in, typing boxes are set into the page, big numbers and the page title have depth
// The sign-in page is not touched (it stays plain and light).
//
// Each person can switch it: the "3D" button at the top, or My Profile → Display: 3D look (Auto / On / Off), saved on that device.
//   Auto = on, except on weak phones, data saver, or when the phone asks for less motion.
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
  const inApp = () => { try { return document.body.classList.contains('fh-app') && typeof state !== 'undefined' && !!state.user && !!document.querySelector('.main-area #main-content'); } catch (_e) { return false; } };
  const curView = () => { try { return (typeof state !== 'undefined' && state.view) || ''; } catch (_e) { return ''; } };

  // ---------------------------------------------------------------- the 3D floor: one still picture per theme
  function floor(line, op) {
    let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 400" preserveAspectRatio="none"><defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".55" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient><mask id="m"><rect width="1200" height="400" fill="url(#f)"/></mask></defs><g mask="url(#m)" stroke="' + line + '" stroke-opacity="' + op + '" stroke-width="1.2" fill="none" vector-effect="non-scaling-stroke">';
    for (let i = -18; i <= 18; i++) s += '<path d="M600 0 L' + (600 + i * 95) + ' 400" vector-effect="non-scaling-stroke"/>';
    for (let k = 1; k <= 11; k++) { const y = (400 * (k / 11) * (k / 11)).toFixed(1); s += '<path d="M0 ' + y + ' H1200" vector-effect="non-scaling-stroke"/>'; }
    return 'url("data:image/svg+xml,' + encodeURIComponent(s + '</g></svg>') + '")';
  }
  const FLOOR_LIGHT = floor('#1E2A6E', 0.16), FLOOR_DARK = floor('#E0B23B', 0.42);

  // ---------------------------------------------------------------- styles (only while the 3D look is on)
  const CARD = ['.card', '.stat-card', '.fv-card2', '.fv-panel', '.ft-card', '.fr-card', '.fh-rowcard'];
  const sel = (pre, suf) => CARD.map((c) => pre + ' #main-content ' + c + (suf || '')).join(',');
  const CLICK = ['.stat-card', '.card[onclick]', '.fv-card2[onclick]', '.fh-quick button', '.fh-rowcard'];
  const clickSel = (pre, suf) => CLICK.map((c) => pre + ' #main-content ' + c + (suf || '')).join(',');
  const css = document.createElement('style'); css.id = 'fh3d-css';
  css.textContent = `
    body.fh3d-on .main-area{background:${FLOOR_LIGHT} center bottom/100% 46% no-repeat,radial-gradient(55% 45% at 88% 0%,rgba(30,42,110,.12),rgba(30,42,110,0) 70%),radial-gradient(45% 40% at 0% 100%,rgba(224,178,59,.14),rgba(224,178,59,0) 70%),linear-gradient(180deg,#f5f7fd,#e2e7f5)!important}
    html.fh-dark body.fh3d-on .main-area{background:${FLOOR_DARK} center bottom/100% 46% no-repeat,radial-gradient(55% 45% at 88% 0%,rgba(224,178,59,.20),rgba(224,178,59,0) 70%),radial-gradient(50% 45% at 0% 100%,rgba(80,110,230,.22),rgba(80,110,230,0) 70%),linear-gradient(180deg,#151c50,#0a0f2e)!important}
    ${sel('body.fh3d-on')}{box-shadow:inset 0 1px 0 rgba(255,255,255,.95),0 1px 1px rgba(30,42,110,.07),0 4px 10px -3px rgba(30,42,110,.12),0 18px 36px -12px rgba(30,42,110,.30)!important}
    ${sel('html.fh-dark body.fh3d-on')}{background:linear-gradient(165deg,#242e6e,#141a4c)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 0 0 1px rgba(224,178,59,.10),0 6px 14px -4px rgba(0,0,0,.45),0 22px 44px -14px rgba(0,0,0,.65)!important}
    html.fh-dark body.fh3d-on .modal{background:linear-gradient(165deg,#242e6e,#121844)!important;box-shadow:0 0 0 1px rgba(224,178,59,.25),0 30px 80px rgba(0,0,0,.6)!important}
    ${clickSel('body.fh3d-on')}{transition:transform .18s ease,box-shadow .18s ease}
    @media (hover:hover) and (pointer:fine){
      ${clickSel('body.fh3d-on', ':hover')}{transform:translateY(-4px)}
    }
    /* buttons are raised and press in */
    body.fh3d-on .main-area :is(.btn,.fv-btn,.btn-primary,.btn-secondary),body.fh3d-on .modal :is(.btn,.fv-btn,.btn-primary,.btn-secondary){box-shadow:inset 0 1px 0 rgba(255,255,255,.22),0 3px 0 rgba(20,28,80,.22),0 6px 14px -4px rgba(20,28,80,.35);transition:transform .12s ease,box-shadow .12s ease}
    body.fh3d-on .main-area :is(.btn,.fv-btn,.btn-primary,.btn-secondary):active,body.fh3d-on .modal :is(.btn,.fv-btn,.btn-primary,.btn-secondary):active{transform:translateY(2px);box-shadow:inset 0 1px 0 rgba(255,255,255,.18),0 1px 0 rgba(20,28,80,.22),0 2px 6px -2px rgba(20,28,80,.3)}
    @media (hover:hover) and (pointer:fine){body.fh3d-on .main-area :is(.btn,.fv-btn,.btn-primary,.btn-secondary):hover,body.fh3d-on .modal :is(.btn,.fv-btn,.btn-primary,.btn-secondary):hover{transform:translateY(-1px)}}
    /* boxes you type in are pressed into the page */
    body.fh3d-on .main-area :is(input:not([type=checkbox]):not([type=radio]):not([type=range]),select,textarea),body.fh3d-on .modal :is(input:not([type=checkbox]):not([type=radio]):not([type=range]),select,textarea){box-shadow:inset 0 2px 4px rgba(20,28,80,.10),inset 0 1px 1px rgba(20,28,80,.08)}
    /* big numbers stand out, small icons float */
    body.fh3d-on #main-content :is(.stat-number,.fh-num,.fr-big){text-shadow:0 1px 0 rgba(255,255,255,.6),0 3px 6px rgba(20,28,80,.22)}
    html.fh-dark body.fh3d-on #main-content :is(.stat-number,.fh-num,.fr-big){text-shadow:0 2px 0 rgba(0,0,0,.35),0 6px 14px rgba(0,0,0,.45)}
    body.fh3d-on #main-content .stat-card .sico{animation:fh3dFloat 3.2s ease-in-out infinite;box-shadow:0 6px 12px -4px rgba(20,28,80,.35)}
    body.fh3d-on #main-content .stat-card:nth-child(2) .sico{animation-delay:-.8s} body.fh3d-on #main-content .stat-card:nth-child(3) .sico{animation-delay:-1.6s} body.fh3d-on #main-content .stat-card:nth-child(4) .sico{animation-delay:-2.4s}
    @keyframes fh3dFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
    /* table headers and the page title get depth */
    body.fh3d-on #main-content thead th{box-shadow:inset 0 -2px 0 rgba(20,28,80,.10)}
    body.fh3d-on #view-title{text-shadow:0 2px 0 rgba(255,255,255,.7),0 4px 10px rgba(20,28,80,.18)}
    html.fh-dark body.fh3d-on #view-title{text-shadow:0 2px 0 rgba(0,0,0,.35),0 6px 14px rgba(0,0,0,.4)}
    /* the open menu item is raised */
    body.fh3d-on .sidebar :is(.active,.nav-link.active,[aria-current]){box-shadow:inset 0 1px 0 rgba(255,255,255,.18),0 4px 12px -2px rgba(0,0,0,.35)}
    @media (prefers-reduced-motion:reduce){body.fh3d-on #main-content .stat-card .sico{animation:none}}
    #fh3d-btn{font-weight:700;letter-spacing:.3px;min-width:44px}
    #fh3d-btn[data-m="off"]{opacity:.6}
  `;
  document.head.appendChild(css);

  // ---------------------------------------------------------------- cards rise into place from depth when a page opens
  const CARDQ = CARD.map((c) => '#main-content ' + c).join(',');
  const seen = new WeakSet();
  let entranceUntil = 0, lastView = null;
  function entrance() {
    if (!active || performance.now() > entranceUntil) return;
    // while the rider loading screen still covers the page, wait: the cards fly in the moment it lifts, so you see them arrive
    const ld = document.getElementById('fh-load');
    if (ld && ld.classList.contains('show')) { entranceUntil = performance.now() + 2500; clearTimeout(entT); entT = setTimeout(entrance, 80); return; }
    const vh = window.innerHeight;
    const list = [...document.querySelectorAll('#main-content .fh-hero, ' + CARDQ)].filter((el) => !seen.has(el) && !el.parentElement.closest(CARD.join(',')));
    const vw = window.innerWidth, cx = vw / 2, cy = vh / 2, small = vw < 700;
    let i = 0;
    for (const el of list) {
      seen.add(el);
      if (i >= 14 || !el.animate) continue;
      const b = el.getBoundingClientRect(); if (b.top > vh) continue;          // only what is on screen
      let from;
      if (b.height > vh * 0.7) from = 'perspective(1400px) translateZ(-160px) rotateX(10deg) translateY(30px)';   // big tables: a calm rise
      else {
        // like option C: each panel starts out in space, away from the middle and tipped, then flies into its place
        const dx = ((b.left + b.width / 2) - cx) * (small ? 0.25 : 0.45), dy = ((b.top + b.height / 2) - cy) * 0.35;
        const ry = Math.max(-28, Math.min(28, -dx / 14)), rx = Math.max(-20, Math.min(20, dy / 12));
        from = 'perspective(1400px) translate3d(' + dx.toFixed(0) + 'px,' + (dy + 40).toFixed(0) + 'px,-' + (small ? 260 : 420) + 'px) rotateY(' + ry.toFixed(1) + 'deg) rotateX(' + rx.toFixed(1) + 'deg)';
      }
      try { el.animate([{ transform: from, opacity: 0.15 }, { transform: 'perspective(1400px) translate3d(0,0,0) rotateY(0) rotateX(0)', opacity: 1 }],
        { duration: 850, delay: i * 70, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' }); } catch (_e) {}
      i++;
    }
  }
  let entT = null;
  const mo = new MutationObserver(() => {
    const v = curView();
    if (v !== lastView) { lastView = v; entranceUntil = performance.now() + 1800; untilt(); }
    else if (performance.now() > entranceUntil) return;               // nothing to do between page changes
    clearTimeout(entT); entT = setTimeout(entrance, 60);
  });
  const mo2 = new MutationObserver((recs) => {   // pop-up windows swing open
    if (!active) return;
    for (const rc of recs) for (const n of rc.addedNodes) {
      if (n.nodeType !== 1 || !n.classList || !n.classList.contains('modal-overlay')) continue;
      const m = n.querySelector('.modal'); if (!m || !m.animate) continue;
      try { m.animate([{ transform: 'perspective(1200px) rotateX(-10deg) translateY(18px) scale(.96)', opacity: 0.2 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' }); } catch (_e) {}
    }
  });

  // ---------------------------------------------------------------- number tiles and the welcome panel tilt toward the mouse (phones: press in)
  const TILT = '#main-content .stat-card, #main-content .fh-hero, ' + CARD.map((c) => '#main-content ' + c).join(', ');
  const fine = () => window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  let tiltEl = null;
  function untilt() { if (tiltEl) { tiltEl.style.transform = ''; tiltEl.style.transition = ''; tiltEl = null; } }
  function onMove(e) {
    if (!active || !fine()) return;
    const el = e.target && e.target.closest ? e.target.closest(TILT) : null;
    if (tiltEl && tiltEl !== el) untilt();
    if (!el) return;
    const b = el.getBoundingClientRect(); if (b.width > 760 || b.height > 520) { return; }   // wide panels and tables stay still
    const px = (e.clientX - b.left) / b.width - 0.5, py = (e.clientY - b.top) / b.height - 0.5;
    const k = el.classList.contains('fh-hero') ? 0.35 : el.classList.contains('stat-card') ? 1 : 0.6;
    el.style.transition = 'transform .12s ease-out';
    el.style.transform = `perspective(900px) rotateX(${(-py * 10 * k).toFixed(2)}deg) rotateY(${(px * 12 * k).toFixed(2)}deg) translateY(${(-5 * k).toFixed(1)}px)`;
    tiltEl = el;
  }
  function onDown(e) {
    if (!active || fine()) return;
    const el = e.target && e.target.closest ? e.target.closest(CLICK.map((c) => '#main-content ' + c).join(',')) : null;
    if (!el || !el.animate || e.target.closest('input,select,textarea')) return;
    try { el.animate([{ transform: 'perspective(700px) translateZ(0)' }, { transform: 'perspective(700px) translateZ(-26px)' }, { transform: 'perspective(700px) translateZ(0)' }], { duration: 240, easing: 'ease-out' }); } catch (_e) {}
  }

  // ---------------------------------------------------------------- switching on and off
  let active = false;
  function enter() {
    if (!enabled() || !inApp()) { leave(); return; }
    document.body.classList.add('fh3d-on');
    if (!active) {
      active = true;
      const mc = document.getElementById('main-content'); if (mc) mo.observe(mc, { childList: true, subtree: true });
      mo2.observe(document.body, { childList: true });
      lastView = curView(); entranceUntil = performance.now() + 1800; entrance();
    }
  }
  function leave() {
    if (active) { mo.disconnect(); mo2.disconnect(); }
    active = false;
    document.body.classList.remove('fh3d-on');
    untilt();
  }
  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerdown', onDown, { passive: true });
  document.addEventListener('mouseleave', untilt);
  // signs in and out are noticed here (a cheap check, no drawing)
  setInterval(() => { try { if (inApp() && enabled()) { if (!active) enter(); } else if (active) leave(); } catch (_e) {} }, 1200);

  // ---------------------------------------------------------------- the 3D button at the top (Auto / On / Off)
  const LABEL = { auto: '3D Auto', on: '3D On', off: '3D Off' };
  function setMode(next) {
    try { localStorage.setItem(KEY, next); } catch (_e) {}
    const b = document.getElementById('fh3d-btn'); if (b) { b.dataset.m = next; b.title = LABEL[next] + ' — tap to change'; b.setAttribute('aria-label', b.title); }
    document.querySelectorAll('#fh3d-prof input').forEach((x) => { x.checked = x.value === next; });
    leave(); if (next !== 'off') enter();
    try { toast(next === 'auto' ? '3D look: Auto (off on weak phones)' : next === 'on' ? '3D look: On' : '3D look: Off'); } catch (_e) {}
  }
  function button() {
    if (document.getElementById('fh3d-btn')) return;
    const ref = document.getElementById('ribbon-theme'); if (!ref || !ref.parentNode) return;
    const b = document.createElement('button'); b.id = 'fh3d-btn'; b.type = 'button'; b.className = ref.className; b.textContent = '3D';
    const m = mode(); b.dataset.m = m; b.title = LABEL[m] + ' — tap to change'; b.setAttribute('aria-label', b.title);
    b.onclick = () => setMode({ auto: 'on', on: 'off', off: 'auto' }[mode()]);
    ref.parentNode.insertBefore(b, ref);
  }
  setInterval(button, 2000); button();

  // ---------------------------------------------------------------- the same switch on My Profile ("Display" card)
  function profileCard() {
    if (curView() !== 'myprofile' || document.getElementById('fh3d-prof')) return;
    const main = document.getElementById('main-content'); if (!main || !main.firstElementChild) return;
    const c = document.createElement('div'); c.className = 'card'; c.id = 'fh3d-prof';
    const opt = (v, t, d) => '<label style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;cursor:pointer"><input type="radio" name="fh3d-m" value="' + v + '" style="width:auto;margin-top:3px"><span><b>' + t + '</b><br><small style="opacity:.75">' + d + '</small></span></label>';
    c.innerHTML = '<h3 style="margin-top:0">Display: 3D look</h3><p style="margin:0 0 6px;opacity:.8">Raised 3D cards and a 3D floor on every page, in light and dark mode. Saved on this device only.</p>' +
      opt('auto', 'Auto (recommended)', 'On, but off by itself on weak phones, data saver or "reduce motion"') + opt('on', 'On', 'Always on') + opt('off', 'Off', 'Plain look, no 3D') +
      '<p style="margin:8px 0 0;font-size:12px;opacity:.6">Look version 114' + (window.fhLoader && window.fhLoader.version ? ' · loader ' + window.fhLoader.version : ' · loader not loaded') + '</p>';
    main.insertBefore(c, main.firstElementChild);
    c.querySelectorAll('input').forEach((i) => { i.checked = i.value === mode(); i.onchange = () => setMode(i.value); });
  }
  setInterval(profileCard, 800);
})();

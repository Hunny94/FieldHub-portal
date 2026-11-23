/* FieldHub UI layer v1 (portal v89).
   Look and feel only: phone top bar with a "More" menu (Option A), nothing covering content, Medium animations,
   tidier buttons, a guard against double-tapping Save, and the Fuel Trends "litres per visit" list.
   It reads no extra data from the database and writes nothing. Logo, favicons and branding are not touched.
   To undo everything: remove the ui.js line from index.html. */
(function () {
  'use strict';
  if (window.__fhUi) return; window.__fhUi = 1;
  const PHONE = 760;
  const RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------------------------------------------------------------- styles
  const CSS = `
/* ---------- phone top bar: brand + bell + More (Option A) ---------- */
#fh-more-btn{display:none}
#fh-more-menu{position:fixed;z-index:5001;min-width:230px;max-width:calc(100vw - 16px);background:#fff;border:1px solid #dfe4f1;border-radius:14px;box-shadow:0 14px 36px rgba(15,23,60,.24);padding:6px;transform-origin:top right;animation:fhMenuIn .18s ease-out both}
#fh-more-menu button{display:flex;align-items:center;gap:12px;width:100%;min-height:46px;padding:0 12px;border:0;border-radius:10px;background:transparent;color:#1b2150;font:500 15px var(--font-body,Inter,sans-serif);text-align:left;cursor:pointer}
#fh-more-menu button:hover,#fh-more-menu button:focus-visible{background:#eef1fb}
#fh-more-menu button .i{width:22px;text-align:center;font-size:17px}
#fh-more-menu button.danger{color:#c0392b;border-top:1px solid #eef0f7;border-radius:0 0 10px 10px}
@keyframes fhMenuIn{from{opacity:0;transform:scale(.92) translateY(-6px)}to{opacity:1;transform:none}}
html.fh-dark #fh-more-menu{background:#171e46;border-color:#2b3470;box-shadow:0 14px 36px rgba(0,0,0,.5)}
html.fh-dark #fh-more-menu button{color:#e6e9ff}
html.fh-dark #fh-more-menu button:hover,html.fh-dark #fh-more-menu button:focus-visible{background:#232c63}
html.fh-dark #fh-more-menu button.danger{color:#ff9b8f;border-color:#2b3470}
@media (max-width:${PHONE}px){
  .top-ribbon-actions #fh-bot-btn,.top-ribbon-actions #ribbon-theme,.top-ribbon-actions #ribbon-reload,.top-ribbon-actions #ribbon-print,.top-ribbon-actions #ribbon-profile-btn,.top-ribbon-actions #logout-btn{display:none!important}
  .top-ribbon-actions{gap:6px!important;flex:0 0 auto!important}
  .top-ribbon-actions #notif-bell-btn,.top-ribbon-actions #fh-more-btn{display:inline-flex!important;align-items:center;justify-content:center;width:44px!important;height:44px!important;min-width:44px!important;padding:0!important;border-radius:12px!important;font-size:19px!important;line-height:1!important;background:rgba(255,255,255,.12)!important}
  .top-ribbon-actions #fh-more-btn{font-size:22px!important;font-weight:700}
  .top-ribbon-actions #fh-more-btn[aria-expanded="true"]{background:rgba(255,255,255,.3)!important}
  #fh-menu-btn{width:44px!important;height:44px!important}
  .top-ribbon-brand{gap:8px!important}
  .top-ribbon-brand .ribbon-title{font-size:17px!important;overflow:visible!important}
  #notif-badge{top:4px!important;right:4px!important;min-width:16px;text-align:center}
}

/* ---------- nothing may cover content ---------- */
@media (max-width:${PHONE}px){
  /* notices: a slim bar at the very bottom; while a pop-up form is open they move to the top, so they never cover its Save button */
  #fh-toasts{top:auto!important;bottom:calc(12px + env(safe-area-inset-bottom,0px))!important;left:10px!important;right:10px!important;max-width:none!important;align-items:stretch!important}
  #fh-toasts .toast{max-width:none!important;width:100%;box-sizing:border-box;padding:9px 8px 9px 12px!important;font-size:13.5px!important;gap:10px!important}
  body:has(.modal-overlay) #fh-toasts{top:calc(env(safe-area-inset-top,0px) + 10px)!important;bottom:auto!important}
  #fh-totop{right:14px!important;bottom:calc(16px + env(safe-area-inset-bottom,0px))!important;width:42px!important;height:42px!important}
  .main-content{padding-bottom:calc(76px + env(safe-area-inset-bottom,0px))!important}
  .modal{padding-bottom:calc(20px + env(safe-area-inset-bottom,0px))!important}
  #notif-dropdown{max-width:calc(100vw - 16px)}
}
body:has(#fh-toasts .toast) #fh-totop,body:has(.modal-overlay) #fh-totop,body.fh-drawer-open #fh-totop,body:has(#fh-bot.open) #fh-totop,body:has(#fh-more-menu) #fh-totop{opacity:0!important;pointer-events:none!important}

#fh-toasts .tq-more{background:transparent!important;border:0!important;box-shadow:none!important;padding:0 2px!important}

/* ---------- Medium animations (run on the device only) ---------- */
.fh-rv{animation-fill-mode:backwards!important}
.btn,.fv-btn,.ribbon-link,.nav-link,.tab,.fh-quick a,.fh-quick button,#fh-more-menu button{transition:transform .12s ease,background-color .15s ease,box-shadow .2s ease,filter .15s ease}
.btn:active,.fv-btn:active,.ribbon-link:not(#fh-menu-btn):active,.tab:active,.fh-quick a:active,.fh-quick button:active,#fh-more-menu button:active,#fh-more-btn:active{transform:scale(.96)}
@media (hover:hover) and (min-width:${PHONE + 1}px){
  .stat-card{transition:transform .2s ease,box-shadow .2s ease}
  .stat-card:hover{transform:translateY(-3px);box-shadow:0 10px 24px rgba(30,42,110,.13)}
}
.toast{animation:fhToastIn .3s cubic-bezier(.2,.8,.2,1) both}
.toast .ti{display:inline-block;animation:fhTick .45s cubic-bezier(.2,1.5,.4,1) .08s both}
@keyframes fhToastIn{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
@keyframes fhTick{from{transform:scale(0)}to{transform:scale(1)}}
#notif-bell-btn.fh-ring{animation:fhRing .9s ease-in-out}
@keyframes fhRing{0%,100%{transform:rotate(0)}15%{transform:rotate(14deg)}30%{transform:rotate(-12deg)}45%{transform:rotate(8deg)}60%{transform:rotate(-5deg)}75%{transform:rotate(2deg)}}
#notif-dropdown{animation:fhMenuIn .18s ease-out both;transform-origin:top right}
/* double-tap guard: the Save button shows it is working */
.fh-busy{pointer-events:none!important;opacity:.8}
.fh-busy::after{content:'';display:inline-block;width:12px;height:12px;margin-left:8px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-2px;animation:fhSpin .7s linear infinite}
@keyframes fhSpin{to{transform:rotate(360deg)}}

/* ---------- buttons: one style, easy to tap, clear focus ---------- */
.btn:disabled,.fv-btn:disabled{opacity:.55;cursor:not-allowed}
button:focus-visible,a:focus-visible,[role="button"]:focus-visible{outline:3px solid #8da0ff!important;outline-offset:2px}
@media (max-width:${PHONE}px){
  .main-content .btn:not(.small),.modal .btn:not(.small),.modal .btn-primary{min-height:42px}
  .main-content .btn.small,.modal .btn.small{min-height:34px}
  .modal .form-row input,.modal .form-row select{min-height:42px;font-size:16px}
}

/* ---------- Fuel Trends: litres per visit list ---------- */
.fh-fa{background:#fff;border:1px solid rgba(30,42,110,.1);border-radius:12px;padding:10px 12px;margin:0 0 10px;box-shadow:0 1px 3px rgba(30,42,110,.06)}
.fh-fa-h{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
.fh-fa-h b{font-family:var(--font-display,'Space Grotesk',sans-serif);font-size:14.5px;color:#1E2A6E}
.fh-fa-seg{display:flex;gap:4px;flex-wrap:wrap}
.fh-fa-seg button{height:32px;padding:0 11px;border:1px solid #cfd6ea;border-radius:16px;background:#fff;color:#1E2A6E;font:600 12px var(--font-body,Inter,sans-serif);cursor:pointer}
.fh-fa-seg button.on{background:#1E2A6E;border-color:#1E2A6E;color:#fff}
.fh-fa-seg button .n{display:inline-block;min-width:18px;margin-left:5px;padding:0 5px;border-radius:9px;background:#c0392b;color:#fff;font-size:11px;line-height:18px}
.fh-fa-l{display:flex;flex-direction:column}
.fh-fa-r{display:flex;align-items:center;gap:10px;width:100%;min-height:44px;padding:6px 4px;border:0;border-top:1px solid #eef0f7;background:transparent;text-align:left;cursor:pointer;color:#2b3350;font:inherit}
.fh-fa-r:hover{background:#f6f8fd}
.fh-fa-r .k{width:22px;flex:0 0 auto;color:#8b92ad;font-weight:700;font-size:12px}
.fh-fa-r .nm{flex:1 1 auto;min-width:0;font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis}
.fh-fa-r .nm small{display:block;font-weight:400;color:#8b92ad;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fh-fa-r .v{flex:0 0 auto;font-weight:700;font-size:13px;text-align:right}
.fh-fa-r .v small{display:block;font-weight:500;font-size:11px;color:#8b92ad}
.fh-fa-note{font-size:12.5px;color:#6b7194;padding:8px 2px}
.fh-fa-more{margin-top:6px;height:34px;padding:0 12px;border:1px solid #cfd6ea;border-radius:10px;background:#fff;color:#1E2A6E;font:600 12.5px var(--font-body,Inter,sans-serif);cursor:pointer}
html.fh-dark .fh-fa{background:#171e46;border-color:#2b3470}
html.fh-dark .fh-fa-h b{color:#dfe5ff}
html.fh-dark .fh-fa-seg button,html.fh-dark .fh-fa-more{background:#171e46;border-color:#34408a;color:#cdd5ff}
html.fh-dark .fh-fa-seg button.on{background:#8da0ff;border-color:#8da0ff;color:#0d1230}
html.fh-dark .fh-fa-r{color:#e6e9ff;border-color:#262f62}
html.fh-dark .fh-fa-r:hover{background:#1b2350}
html.fh-dark .fh-fa-note,html.fh-dark .fh-fa-r .nm small,html.fh-dark .fh-fa-r .v small,html.fh-dark .fh-fa-r .k{color:#9aa4dd}

@media (prefers-reduced-motion:reduce){
  #fh-more-menu,#notif-dropdown,.toast,.toast .ti,#notif-bell-btn.fh-ring,.fh-busy::after{animation:none!important}
  .stat-card:hover{transform:none!important}
}
@media print{#fh-more-btn,#fh-more-menu{display:none!important}}`;

  function addStyle() {
    if (document.getElementById('fh-ui-v1')) return;
    const st = document.createElement('style'); st.id = 'fh-ui-v1'; st.textContent = CSS;
    document.head.appendChild(st);
  }

  // ---------------------------------------------------------------- More menu (phone)
  // Each entry only "presses" the original button, so every action works exactly as before.
  const ITEMS = [
    ['fh-bot-btn', '💬', () => 'Help'],
    ['ribbon-theme', () => (isDark() ? '☀' : '🌙'), () => (isDark() ? 'Light mode' : 'Dark mode')],
    ['ribbon-reload', '⟳', () => 'Refresh'],
    ['ribbon-print', '🖨', () => 'Print / save as PDF'],
    ['ribbon-profile-btn', '👤', () => 'My profile'],
    ['logout-btn', '↪', () => 'Sign out', 'danger']
  ];
  const isDark = () => document.documentElement.classList.contains('fh-dark');
  const val = (x) => (typeof x === 'function' ? x() : x);

  function ensureMoreBtn() {
    const actions = document.querySelector('.top-ribbon-actions');
    if (!actions) return;
    let b = document.getElementById('fh-more-btn');
    if (!b) {
      b = document.createElement('button');
      b.id = 'fh-more-btn'; b.type = 'button'; b.className = 'ribbon-link';
      b.setAttribute('aria-label', 'More options'); b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false');
      b.title = 'More options'; b.textContent = '⋮';
      b.onclick = (e) => { e.stopPropagation(); toggleMenu(); };
    }
    if (actions.lastElementChild !== b) actions.appendChild(b);
  }
  function closeMenu() {
    const m = document.getElementById('fh-more-menu'); if (m) m.remove();
    const b = document.getElementById('fh-more-btn'); if (b) b.setAttribute('aria-expanded', 'false');
  }
  function toggleMenu() {
    if (document.getElementById('fh-more-menu')) { closeMenu(); return; }
    const b = document.getElementById('fh-more-btn'); if (!b) return;
    const nd = document.getElementById('notif-dropdown'); if (nd) nd.remove();
    const items = ITEMS.filter(([id]) => document.getElementById(id));
    if (!items.length) return;
    const m = document.createElement('div');
    m.id = 'fh-more-menu'; m.setAttribute('role', 'menu');
    m.innerHTML = items.map(([id, ic, lb, cls]) => `<button type="button" role="menuitem" data-fh-press="${id}" class="${cls || ''}"><span class="i" aria-hidden="true">${val(ic)}</span><span>${val(lb)}</span></button>`).join('');
    const r = b.getBoundingClientRect();
    m.style.top = Math.round(r.bottom + 6) + 'px';
    m.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
    document.body.appendChild(m);
    b.setAttribute('aria-expanded', 'true');
    m.addEventListener('click', (e) => {
      const it = e.target.closest('[data-fh-press]'); if (!it) return;
      e.stopPropagation();
      const target = document.getElementById(it.dataset.fhPress);
      closeMenu();
      if (target) target.click();
    });
    const first = m.querySelector('button'); if (first && !('ontouchstart' in window)) first.focus();
  }
  document.addEventListener('click', (e) => {
    const m = document.getElementById('fh-more-menu');
    if (m && !m.contains(e.target) && !(e.target.closest && e.target.closest('#fh-more-btn'))) closeMenu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('resize', () => { if (window.innerWidth > PHONE) closeMenu(); });
  // the bell and the More menu never stay open together
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#notif-bell-btn')) closeMenu(); }, true);

  // ---------------------------------------------------------------- bell rings when something new arrives
  let lastBadge = null;
  function watchBell() {
    const badge = document.getElementById('notif-badge'), bell = document.getElementById('notif-bell-btn');
    if (!badge || !bell) return;
    const n = badge.style.display === 'none' ? 0 : (parseInt(badge.textContent, 10) || 0);
    if (lastBadge !== null && n > lastBadge && !RM) { bell.classList.remove('fh-ring'); void bell.offsetWidth; bell.classList.add('fh-ring'); setTimeout(() => bell.classList.remove('fh-ring'), 1000); }
    lastBadge = n;
  }

  // ---------------------------------------------------------------- double-tap guard on Save buttons in pop-up forms
  // While the first press is being saved, a second press is ignored. It clears itself when a message appears,
  // when the form is closed or edited, or after 6 seconds at most. Nothing is blocked in the database.
  const BUSY = new Set();
  const SAVE_WORDS = /save|submit|send|create|add|issue|approve|confirm|update|apply|upload|post|assign|mark|request|record|acknowledg|move|transfer|return|receive/i;
  function clearBusy(b) { (b ? [b] : [...BUSY]).forEach((x) => { x.classList.remove('fh-busy'); x.removeAttribute('aria-busy'); BUSY.delete(x); clearTimeout(x.__fhT); }); }
  document.addEventListener('submit', (e) => {
    const f = e.target; if (!f || !f.closest || !f.closest('.modal, .modal-overlay')) return;
    const b = e.submitter || f.querySelector('button[type="submit"], button:not([type])');
    if (!b || !SAVE_WORDS.test(b.textContent || '')) return;
    if (BUSY.has(b)) { e.preventDefault(); e.stopImmediatePropagation(); return; }   // second press while the first one is still working
    BUSY.add(b); b.classList.add('fh-busy'); b.setAttribute('aria-busy', 'true');
    b.__fhT = setTimeout(() => clearBusy(b), 6000);
    if (!f.__fhIn) { f.__fhIn = 1; f.addEventListener('input', () => clearBusy(b)); }
  }, true);
  (function wrapToast() {
    const t0 = window.toast;
    if (typeof t0 !== 'function' || t0.__fh) return;
    const w = function () { try { clearBusy(); } catch (_e) {} return t0.apply(this, arguments); };
    w.__fh = 1; window.toast = w;
  })();

  // ---------------------------------------------------------------- one light pass after the page changes
  let tm = null;
  function pass() {
    ensureMoreBtn();
    watchBell();
    BUSY.forEach((b) => { if (!document.body.contains(b)) clearBusy(b); });
  }
  function start() {
    addStyle(); pass();
    new MutationObserver(() => { clearTimeout(tm); tm = setTimeout(pass, 120); }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  // ---------------------------------------------------------------- Fuel Trends: litres per visit, latest month
  // Called by Fuel Trends (app.js) with the rows of the current filters. Home Sampling and Home Care are never mixed:
  // each person is counted per category, and the limit is that category's "Max L/visit".
  window.fhFuelAlerts = function (box, rows, ms) {
    if (!box) return;
    try {
      const have = (ms || []).filter((m) => rows.some((r) => r.m === m));
      const m = have[have.length - 1];
      const cur = m ? rows.filter((r) => r.m === m && ftVT(r.category)) : [];
      if (!cur.length) { box.innerHTML = ''; return; }
      const g = new Map();
      cur.forEach((r) => {
        const k = r.rk + '|' + r.category; let o = g.get(k);
        if (!o) g.set(k, o = { rk: r.rk, name: r.rider_name || '(unknown)', emp: r.employee_id || '', region: r.region_name || '', cat: r.category, vt: ftVT(r.category), l: 0, v: 0 });
        o.l += +r.approved_liters || 0; o.v += +r.visits || 0;
      });
      const list = [...g.values()].filter((o) => o.v > 0).map((o) => { o.lpv = o.l / o.v; o.lim = ftLim(o.cat, 'lpv'); return o; });
      const over = list.filter((o) => o.lim && o.lpv > o.lim).sort((a, b) => b.lpv / b.lim - a.lpv / a.lim);
      const fair = list.filter((o) => o.v >= 5);   // at least 5 visits, so one short trip does not top the list
      const low = fair.slice().sort((a, b) => a.lpv - b.lpv).slice(0, 10);
      const high = fair.slice().sort((a, b) => b.lpv - a.lpv).slice(0, 10);
      const anyLim = list.some((o) => o.lim);
      const S = window.__fhFa = window.__fhFa || { tab: null, all: false };
      if (!S.tab) S.tab = over.length ? 'over' : 'low';
      const esc = (s) => escapeHtml(s == null ? '' : String(s));
      const row = (o, i, mode) => {
        const bad = o.lim && o.lpv > o.lim, col = mode === 'low' ? '#2e7d4f' : bad ? '#c0532f' : '#2b3350';
        const sub = [o.emp, o.region, o.vt].filter(Boolean).join(' · ');
        return `<button type="button" class="fh-fa-r" data-rk="${esc(o.rk)}" title="Open this team member's details"><span class="k">${i + 1}</span><span class="nm">${esc(o.name)}<small>${esc(sub)}</small></span><span class="v" style="color:${col}">${ftFmt(o.lpv, 2)} L/visit<small>${o.lim ? 'limit ' + ftFmt(o.lim, 2) + ' · ' : ''}${ftFmt(o.v)} visits</small></span></button>`;
      };
      const paint = () => {
        let body = '';
        if (S.tab === 'over') {
          if (!over.length) body = `<div class="fh-fa-note">${anyLim ? 'Nobody is over the litres-per-visit limit in ' + ftMonthLabel(m) + '. 👍' : 'No litres-per-visit limit is set yet. The Super Admin can set it under <b>Limits &amp; Rs/KM → Max L/visit</b>.'}</div>`;
          else { const show = S.all ? over : over.slice(0, 8); body = show.map((o, i) => row(o, i, 'over')).join('') + (over.length > 8 ? `<button type="button" class="fh-fa-more" data-all>${S.all ? 'Show fewer' : 'Show all ' + over.length}</button>` : ''); }
        } else {
          const L = S.tab === 'low' ? low : high;
          body = L.length ? L.map((o, i) => row(o, i, S.tab)).join('') : '<div class="fh-fa-note">Not enough visits this month to rank (each person needs at least 5).</div>';
        }
        box.innerHTML = `<div class="fh-fa"><div class="fh-fa-h"><b>Litres per visit · ${esc(ftMonthLabel(m))}</b><div class="fh-fa-seg" role="tablist">
          <button type="button" data-fa="over" class="${S.tab === 'over' ? 'on' : ''}">Over the limit${over.length ? `<span class="n">${over.length}</span>` : ''}</button>
          <button type="button" data-fa="low" class="${S.tab === 'low' ? 'on' : ''}">Lowest 10</button>
          <button type="button" data-fa="high" class="${S.tab === 'high' ? 'on' : ''}">Highest 10</button></div></div><div class="fh-fa-l">${body}</div></div>`;
        box.querySelectorAll('[data-fa]').forEach((x) => { x.onclick = () => { S.tab = x.dataset.fa; S.all = false; paint(); }; });
        const more = box.querySelector('[data-all]'); if (more) more.onclick = () => { S.all = !S.all; paint(); };
        box.querySelectorAll('[data-rk]').forEach((x) => {
          x.onclick = () => { try { const mine = rows.filter((r) => r.rk === x.dataset.rk); ftEmpPopup(mine, ms, m, x.querySelector('.nm').firstChild.textContent); } catch (err) { console.warn(err); } };
        });
      };
      paint();
    } catch (e) { console.warn('fuel alerts', e); box.innerHTML = ''; }
  };
})();

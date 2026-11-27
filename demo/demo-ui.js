/* =====================================================================
   FieldHub DEMO: presenter controls (demo/demo-ui.js)
   - one-tap sign-in cards for every role on the sign-in page
   - a small "DEMO" button (bottom-left) to switch role, reset or exit
   ===================================================================== */
(function () {
  'use strict';
  const D = window.FHDEMO; if (!D) return;
  const LOGINS = window.FHDEMO_LOGINS || [];
  const PW = window.FHDEMO_PASSWORD || 'demo1234';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const css = document.createElement('style'); css.id = 'fhdemo-css';
  css.textContent = `
  .fhd-card{margin:0 0 14px;border:1.5px dashed #e8a37f;border-radius:12px;padding:8px 8px 8px 12px;background:#fff6f0;display:flex;align-items:center;justify-content:space-between;gap:10px}
  .fhd-card button{flex:0 0 auto;border:0;background:#c2410c;color:#fff;border-radius:10px;padding:10px 12px;font:700 13px system-ui,sans-serif;cursor:pointer}
  .fhd-card h4{margin:0 0 1px;font:700 13px system-ui,sans-serif;color:#9a3412;letter-spacing:.3px}
  .fhd-card p{margin:0;font:12px system-ui,sans-serif;color:#5b6280}
  .fhd-roles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
  .fhd-roles button{border:1px solid #d5daf3;background:#fff;border-radius:10px;padding:8px 8px;text-align:left;cursor:pointer;font:600 12.5px system-ui,sans-serif;color:#1E2A6E;line-height:1.25}
  .fhd-roles button small{display:block;font-weight:500;color:#6b7290;font-size:11px}
  .fhd-roles button:hover{border-color:#1E2A6E;box-shadow:0 0 0 3px rgba(30,42,110,.10)}
  #fhd-pill{position:fixed;left:0;top:58%;z-index:2147480000;background:#c2410c;color:#fff;border:0;border-radius:0 10px 10px 0;padding:10px 5px;font:700 11px system-ui,sans-serif;letter-spacing:1.5px;box-shadow:0 6px 18px rgba(0,0,0,.25);cursor:pointer;writing-mode:vertical-rl;transform:rotate(180deg);opacity:.9}
  #fhd-pill:hover{opacity:1}
  #fhd-sheet{position:fixed;inset:0;z-index:2147480001;background:rgba(10,14,40,.45);display:flex;align-items:center;justify-content:flex-start}
  #fhd-sheet .in{background:#fff;color:#1b2150;margin:12px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;border-radius:16px;padding:16px;width:min(360px,calc(100vw - 24px));box-shadow:0 18px 50px rgba(0,0,0,.3);font:14px system-ui,sans-serif;max-height:calc(100vh - 24px);overflow:auto}
  #fhd-sheet h3{margin:0 0 4px;font-size:16px;color:#1E2A6E}
  #fhd-sheet .hint{font-size:12.5px;color:#5b6280;margin:0 0 10px}
  #fhd-sheet .role{display:flex;justify-content:space-between;align-items:center;width:100%;border:1px solid #e1e4f3;background:#fff;border-radius:10px;padding:9px 10px;margin:0 0 6px;cursor:pointer;font:600 13.5px system-ui,sans-serif;color:#1E2A6E;text-align:left}
  #fhd-sheet .role.on{background:#eef0fb;border-color:#1E2A6E}
  #fhd-sheet .role small{font-weight:500;color:#6b7290}
  #fhd-sheet .row{display:flex;gap:8px;margin-top:10px}
  #fhd-sheet .row button{flex:1;border-radius:10px;padding:9px;font:600 13px system-ui,sans-serif;cursor:pointer;border:1px solid #cfd4ea;background:#fff;color:#1E2A6E}
  #fhd-sheet .row button.red{color:#b42318;border-color:#f0c9c4}
  html.fh-dark #fhd-sheet .in{background:#171e46;color:#e6e9ff}html.fh-dark #fhd-sheet .role{background:#1b2350;border-color:#2f3870;color:#cdd3ff}
  html.fh-dark #fhd-sheet .row button{background:#1b2350;color:#cdd3ff;border-color:#2f3870}`;
  document.head.appendChild(css);

  // ---------- keep every "#..." link and history change inside the demo page
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[href^="#"]'); if (!a) return;
    const h = a.getAttribute('href'); e.preventDefault();
    if (h.length > 1 && location.hash !== h) location.hash = h;
  }, true);
  ['pushState', 'replaceState'].forEach((k) => {
    const orig = history[k].bind(history);
    history[k] = function (st, t, url) { if (typeof url === 'string' && url.charAt(0) === '#') url = location.pathname + location.search + url; return orig(st, t, url); };
  });

  // ---------- sign in as a role
  function signInAs(phone) {
    const ph = document.getElementById('login-phone'), pw = document.getElementById('login-password'), f = document.getElementById('login-form');
    if (!ph || !pw || !f) return;
    ph.value = phone; pw.value = PW;
    if (f.requestSubmit) f.requestSubmit(); else f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }
  // a small strip at the top of the sign-in form; the role list opens in its own scrolling window
  // (the phone app does not scroll the sign-in page, so nothing is placed below the fold)
  function rolePicker() {
    if (document.getElementById('fhd-sheet')) return;
    const o = document.createElement('div'); o.id = 'fhd-sheet';
    o.innerHTML = `<div class="in"><h3>Demo · sign in as</h3><p class="hint">Sample data only. Every login uses the password <b>${esc(PW)}</b>.</p>
      ${LOGINS.map((l) => `<button class="role" data-ph="${esc(l.phone)}" type="button"><span>${esc(l.label)}</span><small>${esc(l.name)} · ${esc(l.phone)}</small></button>`).join('')}
      <div class="row"><button type="button" id="fhd-leave">← Live FieldHub</button><button type="button" id="fhd-close">Close</button></div></div>`;
    document.body.appendChild(o);
    o.onclick = (e) => { if (e.target === o) o.remove(); };
    o.querySelector('#fhd-close').onclick = () => o.remove();
    o.querySelector('#fhd-leave').onclick = () => { location.href = new URL('../', location.href).href; };
    o.querySelectorAll('[data-ph]').forEach((b) => b.onclick = () => { o.remove(); signInAs(b.dataset.ph); });
  }
  function loginCard() {
    const f = document.getElementById('login-form'); if (!f || document.getElementById('fhd-card')) return;
    const box = document.createElement('div'); box.id = 'fhd-card'; box.className = 'fhd-card';
    box.innerHTML = `<div><h4>DEMO · sample data</h4><p>Password for every role: <b>${esc(PW)}</b></p></div><button type="button" id="fhd-pick">Choose a role ▸</button>`;
    f.insertBefore(box, f.firstChild);
    box.querySelector('#fhd-pick').onclick = rolePicker;
  }
  const pending = D.store.get('switchTo', null);
  function tryPending() {
    if (!pending) return false;
    const scr = document.getElementById('auth-screen');
    if (!scr || scr.style.display === 'none' || !document.getElementById('login-form') || document.getElementById('boot-loading')) return false;
    D.store.del('switchTo'); signInAs(pending); return true;
  }

  // ---------- presenter button
  function whoAmI() { try { return (typeof state !== 'undefined' && state.profile) ? state.profile : null; } catch (_) { return null; } }
  function switchTo(phone) {
    D.store.set('switchTo', phone);
    try { localStorage.removeItem('sb-fhdemo-auth-token'); } catch (_) {}
    location.reload();
  }
  function sheet() {
    const me = whoAmI();
    const o = document.createElement('div'); o.id = 'fhd-sheet';
    o.innerHTML = `<div class="in"><h3>FieldHub demo</h3><p class="hint">Sample data on this device only. Nothing here reaches the live portal.</p>
      <div style="font:600 12px system-ui;color:#6b7290;margin:6px 0">SWITCH ROLE</div>
      ${LOGINS.map((l) => { const on = me && me.phone && me.phone.replace(/\D/g, '').endsWith(l.phone.slice(1)); return `<button class="role${on ? ' on' : ''}" data-ph="${esc(l.phone)}" type="button"><span>${esc(l.label)}</span><small>${esc(l.name)}${on ? ' · now' : ''}</small></button>`; }).join('')}
      <div class="row"><button type="button" id="fhd-reset" class="red">↺ Reset demo data</button><button type="button" id="fhd-exit">Exit demo</button></div>
      <div class="row"><button type="button" id="fhd-close">Close</button></div></div>`;
    document.body.appendChild(o);
    o.onclick = (e) => { if (e.target === o) o.remove(); };
    o.querySelector('#fhd-close').onclick = () => o.remove();
    o.querySelectorAll('[data-ph]').forEach((b) => b.onclick = () => switchTo(b.dataset.ph));
    o.querySelector('#fhd-reset').onclick = () => {
      if (!confirm('Reset the demo?\n\nEverything changed during the demo on this device is removed and the original sample data comes back.')) return;
      const keepPhone = me && me.phone ? '0' + me.phone.replace(/\D/g, '').replace(/^92/, '') : null;
      D.resetAll(); if (keepPhone) D.store.set('switchTo', keepPhone); location.reload();
    };
    o.querySelector('#fhd-exit').onclick = () => { if (confirm('Leave the demo and go back to the live FieldHub?')) location.href = new URL('../', location.href).href; };
  }
  function pill() {
    if (document.getElementById('fhd-pill')) return;
    const b = document.createElement('button'); b.id = 'fhd-pill'; b.type = 'button';
    b.textContent = 'DEMO'; b.title = 'Demo controls: switch role, reset, exit';
    b.onclick = sheet; document.body.appendChild(b);
  }

  // ---------- keep the extras in place as screens change
  let tries = 0;
  const tick = () => {
    pill();
    const scr = document.getElementById('auth-screen');
    const pb = document.getElementById('fhd-pill'); if (pb) pb.style.display = scr && scr.style.display !== 'none' ? 'none' : '';
    if (scr && scr.style.display !== 'none') { loginCard(); if (pending && tries < 40) { if (tryPending()) tries = 99; tries++; } }
    document.title = document.title.indexOf('DEMO') === 0 ? document.title : 'DEMO · ' + document.title.replace(/^DEMO · /, '');
  };
  setInterval(tick, 400); tick();
})();

// =====================================================================================
// fuel-sec.js — 2-step sign-in (authenticator app) for the Fuel pages   (v95, needs migration_67)
// - Fuel Trends (and later Fuel Reimbursement) ask for the 6-digit code once per sign-in.
// - My Profile gets a "2-step sign-in" card: set up / remove; Super Admin also gets the
//   on/off switch and "Reset someone's 2-step".
// - The database itself refuses fuel data without the code (migration_67), this file is the screen part.
// - Before migration_67 is run nothing changes (the check below simply finds no switch table).
// Remove the fuel-sec.js line from index.html to undo the screen part.
// =====================================================================================
(function () {
  'use strict';
  const S = { required: null };
  const esc = (s) => (typeof escapeHtml === 'function' ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s));
  const say = (m) => { try { toast(m); } catch (_e) { alert(m); } };
  const errMsg = (e) => String((e && e.message) || e || 'Something went wrong').replace(/^.*?:\s*(?=[A-Z])/, '');

  function css() {
    if (document.getElementById('fh-2fa-css')) return;
    const st = document.createElement('style'); st.id = 'fh-2fa-css';
    st.textContent = `
      .f2-wrap{max-width:440px;margin:28px auto;background:var(--card,#fff);border:1px solid var(--line,#e3e6f0);border-radius:18px;padding:24px 22px;box-shadow:0 10px 30px rgba(30,42,110,.08);text-align:center}
      .f2-ic{width:56px;height:56px;border-radius:16px;margin:0 auto 10px;display:grid;place-items:center;background:#eef0fb;color:#1E2A6E;font-size:26px}
      .f2-wrap h3{margin:4px 0 6px;color:var(--ink,#1E2A6E)}
      .f2-wrap p{color:#5b6280;font-size:13.5px;margin:4px 0 14px}
      .f2-code{width:100%;max-width:240px;font-size:26px;letter-spacing:8px;text-align:center;padding:10px 8px;border:1.5px solid #cfd4ea;border-radius:12px;font-variant-numeric:tabular-nums}
      .f2-code:focus{outline:none;border-color:#1E2A6E;box-shadow:0 0 0 3px rgba(30,42,110,.12)}
      .f2-btn{margin-top:14px;background:#1E2A6E;color:#fff;border:0;border-radius:10px;padding:10px 18px;font-weight:600;cursor:pointer}
      .f2-btn[disabled]{opacity:.6;cursor:wait}
      .f2-btn.ghost{background:transparent;color:#1E2A6E;border:1px solid #cfd4ea}
      .f2-btn.red{background:#fff;color:#c0392b;border:1px solid #f0c9c4}
      .f2-qr{background:#fff;border:1px solid #e3e6f0;border-radius:14px;padding:10px;display:inline-block;margin:6px 0}
      .f2-qr img{width:190px;height:190px;display:block}
      .f2-key{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;letter-spacing:1px;word-break:break-all;background:#f4f5fb;border-radius:10px;padding:8px 10px;margin:6px 0}
      .f2-steps{text-align:left;font-size:13px;color:#3d4466;margin:8px 0 4px;padding-left:18px}
      .f2-steps li{margin:4px 0}
      .f2-pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600}
      .f2-on{background:#e3f4ea;color:#2e7d4f}.f2-off{background:#fdeceb;color:#c0392b}
      .f2-tbl{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}.f2-tbl td,.f2-tbl th{padding:7px 6px;border-bottom:1px solid #eef0f6;text-align:left}
      html.fh-dark .f2-wrap{background:#161c3a;border-color:#2a3260}html.fh-dark .f2-wrap p{color:#aab1d6}
      html.fh-dark .f2-key{background:#1f2750;color:#e6e9ff}html.fh-dark .f2-code{background:#10152e;color:#fff;border-color:#2f3870}
      html.fh-dark .f2-ic{background:#232b5c;color:#cdd3ff}`;
    document.head.appendChild(st);
  }

  // is the Fuel 2-step rule switched on? (null = migration_67 not run yet → do nothing)
  async function required() {
    try {
      const { data, error } = await sb.from('fh_fuel_security').select('required').eq('id', 1).maybeSingle();
      if (error || !data) return null;
      S.required = !!data.required; return S.required;
    } catch (_e) { return null; }
  }
  async function aal() {
    try { const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel(); return data || {}; } catch (_e) { return {}; }
  }
  async function verifiedFactor() {
    const { data, error } = await sb.auth.mfa.listFactors();
    if (error) throw error;
    return (data && data.totp || []).find(f => f.status === 'verified') || null;
  }
  async function verify(factorId, code) {
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) throw error;
  }
  const clean = (v) => String(v || '').replace(/\D/g, '').slice(0, 6);

  // ---------------------------------------------------------------- code entry / first set-up screen
  function codeBox(host, title, text, onCode, extraHtml) {
    host.innerHTML = `<div class="f2-wrap"><div class="f2-ic">🔐</div><h3>${title}</h3><p>${text}</p>${extraHtml || ''}
      <form id="f2-form" autocomplete="off"><input class="f2-code" id="f2-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" aria-label="6-digit code">
      <div><button class="f2-btn" id="f2-go" type="submit">Continue</button></div></form>
      <p style="margin-top:14px;font-size:12px">Lost your phone? Ask the Super Admin to reset your 2-step sign-in.</p></div>`;
    const inp = host.querySelector('#f2-code'), btn = host.querySelector('#f2-go');
    inp.oninput = () => { inp.value = clean(inp.value); if (inp.value.length === 6) host.querySelector('#f2-form').requestSubmit(); };
    host.querySelector('#f2-form').onsubmit = async (e) => {
      e.preventDefault();
      const code = clean(inp.value); if (code.length !== 6) { say('Type the 6-digit code from your authenticator app'); return; }
      btn.disabled = true; btn.textContent = 'Checking…';
      try { await onCode(code); }
      catch (err) { say(/invalid|expired|code/i.test(errMsg(err)) ? 'That code is not right or has expired. Try the newest code.' : 'Could not check the code: ' + errMsg(err)); inp.value = ''; inp.focus(); btn.disabled = false; btn.textContent = 'Continue'; }
    };
    setTimeout(() => { try { inp.focus(); } catch (_e) {} }, 50);
  }

  async function enrollInto(host, done) {
    host.innerHTML = '<div class="f2-wrap"><p>Preparing…</p></div>';
    try {
      // remove half-finished set-ups left from an earlier try (they block a new one)
      const { data: ls } = await sb.auth.mfa.listFactors();
      for (const f of ((ls && ls.all) || [])) if (f.status !== 'verified') { try { await sb.auth.mfa.unenroll({ factorId: f.id }); } catch (_e) {} }
      const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'FieldHub ' + new Date().toISOString().slice(0, 16) });
      if (error) throw error;
      const qr = data.totp.qr_code, key = data.totp.secret, uri = data.totp.uri;
      const extra = `<ol class="f2-steps">
          <li>Open <b>Google Authenticator</b> on your phone and tap <b>+</b>.</li>
          <li>Choose <b>Scan a QR code</b> and scan this picture.<br><span style="color:#7a809c">Using this same phone? Choose <b>Enter a setup key</b> instead, and paste the key below.</span></li>
          <li>Type the 6-digit code the app shows.</li></ol>
        <div class="f2-qr"><img alt="QR code for the authenticator app" src="${esc(qr)}"></div>
        <div class="f2-key" id="f2-key">${esc(key)}</div>
        <div><button class="f2-btn ghost" id="f2-copy" type="button">Copy key</button> <a class="f2-btn ghost" style="display:inline-block;text-decoration:none" href="${esc(uri)}">Open in app</a></div>`;
      codeBox(host, 'Set up 2-step sign-in', 'Fuel pages are protected. Set this up once; after that you only type a code once per sign-in.', async (code) => {
        await verify(data.id, code);
        try { await sb.from('activity_log').insert({ actor_id: state.user.id, action: 'set up 2-step sign-in', entity_type: 'Account', entity_label: (state.profile && state.profile.full_name) || '' }); } catch (_e) {}
        say('2-step sign-in is on ✓'); done();
      }, extra);
      const cp = host.querySelector('#f2-copy');
      if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(key); say('Key copied'); } catch (_e) { say('Press and hold the key to copy it'); } };
    } catch (err) {
      host.innerHTML = `<div class="f2-wrap"><div class="f2-ic">⚠️</div><h3>Could not start the set-up</h3><p>${esc(errMsg(err))}</p><p>If this keeps happening, the Super Admin should check Supabase → Authentication → Multi-Factor → "TOTP" is enabled.</p><button class="f2-btn" type="button" id="f2-retry">Try again</button></div>`;
      host.querySelector('#f2-retry').onclick = () => enrollInto(host, done);
    }
  }

  // Gate: returns true when the page may open. Otherwise draws the code / set-up screen into host and
  // calls onPass() after success.
  async function gate(host, onPass) {
    const req = await required();
    if (req !== true) return true;                       // switch off, or migration_67 not run yet
    const lv = await aal();
    if (lv.currentLevel === 'aal2') return true;
    css();
    let f = null;
    try { f = await verifiedFactor(); } catch (_e) {}
    if (f) codeBox(host, 'Enter your 2-step code', 'Open your authenticator app and type the 6-digit code for <b>FieldHub</b>.', async (code) => { await verify(f.id, code); onPass(); });
    else enrollInto(host, onPass);
    return false;
  }
  window.fhFuel2fa = { gate, required, aal };

  // ---------------------------------------------------------------- wrap the Fuel Trends page
  function wrapFuel() {
    if (typeof window.renderFuelTrends !== 'function' || window.renderFuelTrends.__f2) return;
    const orig = window.renderFuelTrends;
    const wrapped = async function (view) {
      const main = document.getElementById('main-content');
      const ok = await gate(main, () => { if (state.view === view) orig(view); });
      if (ok) return orig(view);
    };
    wrapped.__f2 = true; window.renderFuelTrends = wrapped;
  }

  // ---------------------------------------------------------------- My Profile card
  async function profileCard() {
    const main = document.getElementById('main-content');
    if (!main || document.getElementById('f2-card')) return;
    const req = await required();
    if (req === null) return;                            // migration_67 not run yet
    css();
    let f = null; try { f = await verifiedFactor(); } catch (_e) {}
    const sup = typeof isSuperAdmin === 'function' && isSuperAdmin();
    const card = document.createElement('div'); card.className = 'card'; card.id = 'f2-card';
    card.innerHTML = `<h3>🔐 2-step sign-in</h3>
      <p class="hint">Fuel Trends and Fuel Reimbursement ask for a 6-digit code from an authenticator app (Google Authenticator or Microsoft Authenticator) once per sign-in.</p>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:8px 0">Status: ${f ? '<span class="f2-pill f2-on">On</span>' : '<span class="f2-pill f2-off">Not set up</span>'}
        <span style="flex:1"></span>${f ? '<button class="f2-btn ghost" id="f2-new" type="button" style="margin:0">Move to a new phone</button><button class="f2-btn red" id="f2-rm" type="button" style="margin:0">Remove</button>' : '<button class="f2-btn" id="f2-setup" type="button" style="margin:0">Set up now</button>'}</div>
      <div id="f2-host"></div>
      ${sup ? `<hr style="border:0;border-top:1px solid #eef0f6;margin:14px 0">
        <h4 style="margin:0 0 6px">Super Admin</h4>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">Code needed for Fuel pages: ${req ? '<span class="f2-pill f2-on">On</span>' : '<span class="f2-pill f2-off">Off</span>'}<span style="flex:1"></span><button class="f2-btn ghost" id="f2-sw" type="button" style="margin:0">${req ? 'Turn off' : 'Turn on'}</button></div>
        <div style="margin-top:12px"><button class="f2-btn ghost" id="f2-list" type="button" style="margin:0">Show who has 2-step / reset someone</button><div id="f2-people"></div></div>` : ''}`;
    main.appendChild(card);
    const host = card.querySelector('#f2-host');
    const reload = () => { card.remove(); profileCard(); };
    const needCode = async (then) => {                 // removing / switching needs this sign-in to have the code
      const lv = await aal(); if (lv.currentLevel === 'aal2') return then();
      const fx = await verifiedFactor();
      if (!fx) return then();
      codeBox(host, 'Confirm with your code', 'Type the 6-digit code from your authenticator app to continue.', async (code) => { await verify(fx.id, code); host.innerHTML = ''; await then(); });
    };
    const b = (id) => card.querySelector('#' + id);
    if (b('f2-setup')) b('f2-setup').onclick = () => enrollInto(host, reload);
    if (b('f2-rm')) b('f2-rm').onclick = () => needCode(async () => {
      if (!confirm('Remove 2-step sign-in?\n\nYou will have to set it up again before you can open the Fuel pages.')) return;
      const { error } = await sb.auth.mfa.unenroll({ factorId: f.id });
      if (error) { say('Could not remove: ' + errMsg(error)); return; }
      try { await sb.from('activity_log').insert({ actor_id: state.user.id, action: 'removed own 2-step sign-in', entity_type: 'Account', entity_label: (state.profile && state.profile.full_name) || '' }); } catch (_e) {}
      say('2-step sign-in removed'); reload();
    });
    if (b('f2-new')) b('f2-new').onclick = () => needCode(async () => {
      if (!confirm('Move 2-step sign-in to a new phone?\n\nThe old phone stops working. You will scan a new QR code now.')) return;
      const { error } = await sb.auth.mfa.unenroll({ factorId: f.id });
      if (error) { say('Could not continue: ' + errMsg(error)); return; }
      enrollInto(host, reload);
    });
    if (b('f2-sw')) b('f2-sw').onclick = () => needCode(async () => {
      const to = !req;
      if (!to && !confirm('Turn OFF the code for Fuel pages?\n\nAnyone with Fuel access will open the pages with their password only.')) return;
      const { error } = await sb.rpc('fh_fuel_2fa_set', { p_required: to });
      if (error) { say('Could not change: ' + errMsg(error)); return; }
      say(to ? 'Code is now needed for Fuel pages' : 'Code turned off for Fuel pages'); reload();
    });
    if (b('f2-list')) b('f2-list').onclick = async () => {
      const box = card.querySelector('#f2-people'); box.innerHTML = '<p class="hint">Loading…</p>';
      const { data, error } = await sb.rpc('fh_2fa_list');
      if (error) { box.innerHTML = `<p class="hint">${esc(errMsg(error))}</p>`; return; }
      if (!data || !data.length) { box.innerHTML = '<p class="hint">Nobody has set up 2-step sign-in yet.</p>'; return; }
      box.innerHTML = `<table class="f2-tbl"><thead><tr><th>Name</th><th>Employee ID</th><th>Since</th><th></th></tr></thead><tbody>${data.map(r => `<tr><td>${esc(r.full_name || '—')}</td><td>${esc(r.employee_id || '—')}</td><td>${esc(String(r.since || '').slice(0, 10))}</td><td style="text-align:right">${r.user_id === state.user.id ? '<span class="hint">you</span>' : `<button class="f2-btn red" data-rs="${esc(r.user_id)}" data-nm="${esc(r.full_name || '')}" type="button" style="margin:0;padding:5px 10px">Reset</button>`}</td></tr>`).join('')}</tbody></table>`;
      box.querySelectorAll('[data-rs]').forEach(x => x.onclick = () => needCode(async () => {
        if (!confirm(`Reset 2-step sign-in for ${x.dataset.nm || 'this person'}?\n\nTheir old phone code stops working; they set it up again the next time they open a Fuel page.`)) return;
        const { error: e2 } = await sb.rpc('fh_2fa_reset', { p_user: x.dataset.rs });
        if (e2) { say('Could not reset: ' + errMsg(e2)); return; }
        say('Reset done'); b('f2-list').click();
      }));
    };
  }
  function wrapProfile() {
    if (typeof window.renderMyProfile !== 'function' || window.renderMyProfile.__f2) return;
    const orig = window.renderMyProfile;
    const wrapped = async function () { const r = await orig.apply(this, arguments); try { await profileCard(); } catch (e) { console.warn('2-step card', e); } return r; };
    wrapped.__f2 = true; window.renderMyProfile = wrapped;
  }

  wrapFuel(); wrapProfile();
})();

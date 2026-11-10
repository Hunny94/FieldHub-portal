/* FieldHub fingerprint sign-in (Android app only). Loaded after app.js.
   It does nothing in a normal browser, and nothing in an older APK that does not contain the
   fingerprint plugin (@capgo/capacitor-native-biometric). The password is kept by the phone's
   secure storage (Android Keystore) and is released only after a successful fingerprint. */
(function () {
  'use strict';
  const SERVER = 'fieldhub-portal';
  const plugin = () => { try { return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativeBiometric; } catch (_) { return null; } };
  const native = () => { try { return typeof fhIsNativeApp === 'function' && fhIsNativeApp(); } catch (_) { return false; } };
  const esc = (s) => escapeHtml(s);
  let typed = null, prompted = false, avail = null;

  async function available() {
    if (avail !== null) return avail;
    const p = plugin(); if (!native() || !p) return (avail = false);
    try { const r = await p.isAvailable({ useFallback: false }); avail = !!(r && r.isAvailable); } catch (_) { avail = false; }
    return avail;
  }
  async function saved() { const p = plugin(); if (!p) return false; try { const r = await p.isCredentialsSaved({ server: SERVER }); return !!(r && r.isSaved); } catch (_) { return false; } }
  async function verify(reason) { const p = plugin(); await p.verifyIdentity({ reason: reason || 'Confirm it is you', title: 'FieldHub', subtitle: 'Use your fingerprint', useFallback: false, maxAttempts: 3 }); }
  async function store(phone, password) { await plugin().setCredentials({ username: phone, password, server: SERVER }); try { localStorage.setItem('fh_bio_on', '1'); } catch (_) {} }
  async function wipe() { const p = plugin(); if (p) { try { await p.deleteCredentials({ server: SERVER }); } catch (_) {} } try { localStorage.removeItem('fh_bio_on'); } catch (_) {} }

  // ---- sign in with fingerprint (login screen) ----
  async function bioSignIn() {
    const p = plugin(); if (!p) return;
    try { await verify('Sign in to FieldHub'); } catch (_) { return; }   // cancelled or not recognised: stay on the login screen
    let c; try { c = await p.getCredentials({ server: SERVER }); } catch (_) { toast('Fingerprint sign-in is not set up. Sign in with your password.'); await wipe(); return; }
    const { data, error } = await sb.auth.signInWithPassword({ phone: c.username, password: c.password });
    if (error) {
      if (/invalid|credentials/i.test(error.message)) { await wipe(); showAuthMessage('Your password was changed. Please sign in with your password; you can turn fingerprint on again afterwards.'); }
      else showAuthMessage(/banned/i.test(error.message) ? 'This account is disabled. Please contact your supervisor.' : error.message);
      return;
    }
    await afterLogin(data.user);
  }
  async function ensureLoginButton() {
    const screen = document.getElementById('auth-screen'), form = document.getElementById('login-form');
    if (!screen || !form || screen.style.display === 'none' || form.style.display === 'none') return;
    if (document.getElementById('fh-bio-login')) return;
    if (!(await available()) || !(await saved())) return;
    const b = document.createElement('button'); b.type = 'button'; b.id = 'fh-bio-login'; b.className = 'btn-primary';
    b.style.cssText = 'margin-top:10px;width:100%;background:transparent;color:var(--ink,#1E2A6E);border:2px solid var(--ink,#1E2A6E)';
    b.textContent = '☝ Sign in with fingerprint';
    b.onclick = bioSignIn;
    const sub = form.querySelector('button[type="submit"]'); (sub && sub.parentNode ? sub.parentNode : form).appendChild(b);
    if (!prompted) { prompted = true; setTimeout(bioSignIn, 400); }   // ask once, as soon as the app opens
  }
  setInterval(() => { if (native() && plugin()) ensureLoginButton(); }, 1200);

  // ---- remember what was typed so we can offer to turn fingerprint on after a successful password login ----
  document.addEventListener('submit', (e) => {
    if (e.target && e.target.id === 'login-form') {
      const ph = document.getElementById('login-phone'), pw = document.getElementById('login-password');
      typed = ph && pw && pw.value ? { phone: toE164(ph.value.trim()), password: pw.value } : null;
    }
  }, true);
  async function offerAfterLogin() {
    const t = typed; typed = null;
    if (!t || !native() || !plugin() || !state.user) return;
    if (!(await available())) return;
    if (localStorage.getItem('fh_bio_on') === '1' || localStorage.getItem('fh_bio_no_' + state.user.id) === '1') return;
    openModal(`<h2>Sign in with your fingerprint?</h2>
      <p class="hint">Next time you can open FieldHub with your fingerprint instead of typing your password. Your password stays protected inside your phone's secure storage. You can turn this off any time on <b>My Profile</b>.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn" id="fh-bio-yes" type="button">Turn on fingerprint</button><button class="btn outline" id="fh-bio-later" type="button">Not now</button><button class="btn outline" id="fh-bio-never" type="button">Do not ask again</button></div>`);
    document.getElementById('fh-bio-later').onclick = () => closeModal();
    document.getElementById('fh-bio-never').onclick = () => { try { localStorage.setItem('fh_bio_no_' + state.user.id, '1'); } catch (_) {} closeModal(); };
    document.getElementById('fh-bio-yes').onclick = async () => {
      try { await verify('Turn on fingerprint sign-in'); await store(t.phone, t.password); closeModal(); toast('Fingerprint sign-in is on.'); }
      catch (_) { toast('Fingerprint was not confirmed, so it was not turned on.'); }
    };
  }
  if (typeof sb !== "undefined" && sb.auth) sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_IN' && typed) setTimeout(offerAfterLogin, 3500); });

  // ---- My Profile: switch it on / off ----
  async function profileCard() {
    if (!native() || !plugin() || state.view !== 'myprofile' && !document.getElementById('mp-pw-btn')) return;
    if (document.getElementById('fh-bio-card') || !document.getElementById('mp-pw-btn')) return;
    const ok = await available(); if (!ok) return;
    const on = (await saved()) && localStorage.getItem('fh_bio_on') === '1';
    const host = document.getElementById('mp-pw-btn').closest('.card'); if (!host) return;
    const card = document.createElement('div'); card.className = 'card'; card.id = 'fh-bio-card';
    card.innerHTML = `<h3>Fingerprint sign-in</h3><p class="hint">${on ? 'Fingerprint sign-in is <b>ON</b> on this phone.' : 'Sign in with your fingerprint instead of typing your password. Only on this phone.'}</p><button class="btn ${on ? 'outline' : ''}" id="fh-bio-toggle" type="button">${on ? 'Turn off' : 'Turn on'}</button>`;
    host.parentNode.insertBefore(card, host);
    document.getElementById('fh-bio-toggle').onclick = async () => {
      if (on) { await wipe(); toast('Fingerprint sign-in is off.'); card.remove(); profileCard(); return; }
      openModal(`<h2>Turn on fingerprint</h2><p class="hint">Enter your current password once, then confirm with your fingerprint.</p><form id="fh-bio-form"><div class="form-row"><label>Current password</label><input type="password" id="fh-bio-pw" required autocomplete="current-password"></div><button class="btn-primary" type="submit">Continue</button></form>`);
      document.getElementById('fh-bio-form').onsubmit = async (e) => {
        e.preventDefault(); const pw = document.getElementById('fh-bio-pw').value;
        const phone = state.profile.phone; const v = await sb.auth.signInWithPassword({ phone, password: pw });
        if (v.error) { toast('That password is not correct.'); return; }
        try { await verify('Turn on fingerprint sign-in'); await store(phone, pw); closeModal(); toast('Fingerprint sign-in is on.'); card.remove(); profileCard(); }
        catch (_) { toast('Fingerprint was not confirmed, so it was not turned on.'); }
      };
    };
  }
  if (typeof renderMyProfile === 'function') {
    const orig = renderMyProfile;
    window.renderMyProfile = async function () { const r = await orig.apply(this, arguments); try { await profileCard(); } catch (_) {} return r; };
  }
})();

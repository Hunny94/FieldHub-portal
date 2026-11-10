/* FieldHub offline reading — free, no server. Loaded BEFORE app.js.
   1. Every successful READ from the database is also saved on this phone/browser (IndexedDB).
   2. With no internet the same read is answered from that saved copy, so pages already opened
      (Knowledge Base, Circulars, Tasks, Requests, Expiry, Team ...) still open.
   3. When the internet returns the current page is refreshed from the live data automatically.
   Saving, editing and deleting always need internet: offline they show a clear message.
   Saved copies are kept per login and erased when the person signs out. */
(function () {
  'use strict';
  const DB_NAME = 'fh_offline', STORE = 'rest', MAX_ENTRIES = 700, MAX_BYTES = 3 * 1024 * 1024;
  const SKIP_TABLES = /\/rest\/v1\/(password_reset_requests|activity_log|push_tokens|user_sessions)\b/;
  const CACHE_RPC = /\/rest\/v1\/rpc\/(fh_team_directory|fh_hotspot_mates)\b/;
  const realFetch = window.fetch.bind(window);
  let dbp = null;
  const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      try {
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'k' }); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    });
    dbp.catch(() => { dbp = null; });
    return dbp;
  }
  const tx = (mode, fn) => db().then((d) => new Promise((res, rej) => { const t = d.transaction(STORE, mode), s = t.objectStore(STORE); const out = fn(s); t.oncomplete = () => res(out && 'result' in out ? out.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }));
  const getEntry = (k) => db().then((d) => new Promise((res) => { const r = d.transaction(STORE).objectStore(STORE).get(k); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); })).catch(() => null);
  const putEntry = (e) => tx('readwrite', (s) => s.put(e)).catch(() => {});
  async function trim(uid) {
    try {
      const d = await db();
      const all = await new Promise((res) => { const r = d.transaction(STORE).objectStore(STORE).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); });
      const mine = all.filter((x) => x.u === uid).sort((a, b) => a.t - b.t);
      if (mine.length > MAX_ENTRIES) await tx('readwrite', (s) => { mine.slice(0, mine.length - MAX_ENTRIES + 100).forEach((x) => s.delete(x.k)); });
    } catch (_) {}
  }
  async function clearUser(uid) {
    try { const d = await db(); const all = await new Promise((res) => { const r = d.transaction(STORE).objectStore(STORE).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); }); await tx('readwrite', (s) => { all.filter((x) => !uid || x.u === uid).forEach((x) => s.delete(x.k)); }); } catch (_) {}
  }

  // who is asking: the "sub" of the login token (an anonymous call has none)
  function uidOf(headers) {
    try {
      const a = headers.get('authorization') || ''; const tok = a.replace(/^Bearer\s+/i, '');
      const p = tok.split('.')[1]; if (!p) return 'anon';
      const j = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
      return j.sub || 'anon';
    } catch (_) { return 'anon'; }
  }
  const synthetic = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'x-fh-offline': '1' } });

  window.fetch = async function (input, init) {
    let url = '', method = 'GET', headers;
    try {
      const req = input instanceof Request ? input : null;
      url = req ? req.url : String(input);
      method = ((init && init.method) || (req && req.method) || 'GET').toUpperCase();
      headers = new Headers((init && init.headers) || (req && req.headers) || {});
    } catch (_) { return realFetch(input, init); }
    const isRest = url.indexOf('/rest/v1/') !== -1;
    if (!isRest || SKIP_TABLES.test(url)) return realFetch(input, init);
    const isRpcRead = method === 'POST' && CACHE_RPC.test(url);
    const cacheable = (method === 'GET' || isRpcRead);

    if (!cacheable) {   // saving / editing / deleting
      if (isOffline()) return synthetic(503, { message: 'You are offline. Please connect to the internet and try again. Nothing was saved.', code: 'OFFLINE' });
      return realFetch(input, init);
    }
    const uid = uidOf(headers);
    let body = ''; if (isRpcRead) { try { body = init && init.body ? String(init.body) : (input instanceof Request ? await input.clone().text() : ''); } catch (_) {} }
    const key = uid + '|' + method + '|' + url + '|' + (headers.get('accept') || '').indexOf('pgrst.object') + '|' + (headers.get('range') || '') + '|' + body;
    const fromCache = async () => {
      const e = await getEntry(key); if (!e) return null;
      window.__fhOfflineServedAt = e.t; window.__fhOfflineServed = (window.__fhOfflineServed || 0) + 1;
      const h = { 'Content-Type': e.ct || 'application/json', 'x-fh-offline': '1' }; if (e.cr) h['Content-Range'] = e.cr;
      return new Response(e.body, { status: e.status, headers: h });
    };
    if (isOffline()) { const c = await fromCache(); if (c) return c; return realFetch(input, init).catch(() => synthetic(503, { message: 'You are offline and this page was not saved on this phone yet. Open it once while online.', code: 'OFFLINE' })); }
    try {
      const res = await realFetch(input, init);
      if (res.ok && uid !== 'anon') {
        res.clone().text().then((txt) => { if (txt.length <= MAX_BYTES) { putEntry({ k: key, u: uid, t: Date.now(), status: res.status, ct: res.headers.get('content-type'), cr: res.headers.get('content-range'), body: txt }); if (Math.random() < 0.05) trim(uid); } }).catch(() => {});
      }
      return res;
    } catch (err) {   // connection dropped / very bad signal
      const c = await fromCache(); if (c) return c; throw err;
    }
  };

  // ---------- keep the login usable with no internet (cold start of the app) ----------
  function storedSession() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (/^sb-.*-auth-token$/.test(k)) { const s = JSON.parse(localStorage.getItem(k)); if (s && s.user && s.access_token) return s; }
      }
    } catch (_) {}
    return null;
  }
  function patchClient(client) {
    try {
      const a = client.auth, g = a.getSession.bind(a), so = a.signOut.bind(a);
      a.getSession = async function () {
        if (isOffline()) { const s = storedSession(); if (s) return { data: { session: s }, error: null }; }   // skip the slow refresh retries
        return g();
      };
      a.signOut = async function () { const s = storedSession(); const out = await so.apply(null, arguments); try { await clearUser(s && s.user && s.user.id); } catch (_) {} return out; };
    } catch (_) {}
    return client;
  }
  if (window.supabase && window.supabase.createClient) {
    const orig = window.supabase.createClient;
    window.supabase.createClient = function () { return patchClient(orig.apply(this, arguments)); };
  }

  // ---------- banner + automatic refresh when the connection comes back ----------
  let bar = null, hideT = null;
  function banner(html, cls) {
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'fh-offline-bar'; bar.setAttribute('role', 'status');
      bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:100000;padding:6px 12px;text-align:center;font:600 13px/1.4 system-ui,sans-serif;color:#fff;display:none';
      (document.body || document.documentElement).appendChild(bar);
    }
    clearTimeout(hideT); bar.style.background = cls === 'ok' ? '#0f7a56' : '#b9560e'; bar.innerHTML = html; bar.style.display = 'block';
    if (cls === 'ok') hideT = setTimeout(() => { bar.style.display = 'none'; }, 3500);
  }
  function showOffline() { banner('📴 You are offline. Showing the data saved on this phone. Saving or editing needs internet.'); }
  async function backOnline() {
    banner('✅ Back online. Updating…', 'ok');
    try { if (typeof sb !== "undefined" && sb.auth) await Promise.race([sb.auth.refreshSession(), new Promise((r) => setTimeout(r, 8000))]); } catch (_) {}
    try {
      const modalOpen = !!document.getElementById('active-modal');
      if (!modalOpen && typeof state !== "undefined" && state.user && typeof navigateTo === 'function' && state.view) await navigateTo(state.view);   // reload the open page from live data
      if (typeof fhRefreshNavBadges === 'function') fhRefreshNavBadges();
      setTimeout(warm, 1500);
    } catch (_) {}
  }
  window.addEventListener('offline', showOffline);
  window.addEventListener('online', backOnline);
  document.addEventListener('DOMContentLoaded', () => { if (isOffline()) showOffline(); });

  // ---------- save the main pages for offline reading (same queries the pages use) ----------
  let warming = false;
  async function warm() {
    if (warming || isOffline() || typeof sb === "undefined" || typeof state === "undefined" || !state.user || !state.profile) return;
    warming = true;
    const uid = state.user.id, isAdm = typeof isAdmin === 'function' && isAdmin(), staff = typeof isStaff === 'function' && isStaff();
    const jobs = [];
    const allowed = (v) => { try { return getAllowedViews().includes(v); } catch (_) { return false; } };
    try {
      if (allowed('knowledgebase')) {
        jobs.push(sb.from('circulars').select('id, title, body, created_at').eq('push_to_kb', true).is('deleted_at', null).order('created_at', { ascending: false }));
        jobs.push(sb.from('knowledge_base_articles').select('*, profiles(full_name)').order('created_at', { ascending: false }));
      }
      if (allowed('circulars')) {
        let q = sb.from('circulars').select('*, profiles!created_by(full_name)').is('deleted_at', null).order('created_at', { ascending: false });
        if (!isAdm) q = q.gte('created_at', state.profile.created_at);
        jobs.push(q, sb.from('circular_acks').select('circular_id').eq('user_id', uid));
      }
      if (allowed('tasks')) {
        const t = () => sb.from('tasks').select('*, assignee:profiles!assigned_to(full_name, employee_id), assigner:profiles!assigned_by(full_name, employee_id)').is('deleted_at', null).order('due_date', { ascending: true, nullsFirst: false });
        jobs.push(staff ? t().eq('assigned_to', uid) : t().eq('assigned_to', uid));
        if (staff) jobs.push(t().eq('assigned_by', uid));
      }
      if (allowed('requests')) jobs.push(sb.from('requests').select('*, rider:profiles!rider_id(full_name, employee_id), poc:profiles!assigned_poc_id(full_name, employee_id)').is('deleted_at', null).order('created_at', { ascending: false }));
      if (allowed('expiries')) jobs.push(sb.from('expiry_items').select('*, profiles!rider_id(full_name, phone, employee_id), added_by:profiles!created_by(full_name)').is('deleted_at', null).order('expiry_date'));
      if (allowed('hierarchy') || allowed('roster')) jobs.push(sb.rpc('fh_team_directory'));
      if (state.profile.role === 'rider') jobs.push(sb.rpc('fh_hotspot_mates'));
      await Promise.allSettled(jobs.map((j) => Promise.resolve(j)));
      try { localStorage.setItem('fh_offline_saved_' + uid, String(Date.now())); } catch (_) {}
    } catch (_) {}
    warming = false;
  }
  window.fhOffline = { warm, clear: clearUser, isOffline };
  // a few seconds after sign-in (and at most once an hour) save the main pages quietly
  setInterval(() => { try { if (typeof state !== "undefined" && state.user && !isOffline()) { const last = +localStorage.getItem('fh_offline_saved_' + state.user.id) || 0; if (Date.now() - last > 3600 * 1000) warm(); } } catch (_) {} }, 20000);
})();

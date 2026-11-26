// =====================================================================================
// fuel-reimb.js — Fuel Reimbursement (v96: Phase 2 Settings + People, Phase 3 Google Drive link;
//                  v98: Phase 4 daily readings, monthly entry, KM per visit by city, bulk regions, fuel-only logins — needs migration_70)
// Needs migration_67 (2-step) and migration_68 (tables + functions). Before migration_68 the pages
// simply say so. All saving goes through database functions (Super Admin + 2-step code), and is logged.
// Remove the fuel-reimb.js line from index.html to hide the whole module again (nothing is deleted).
// =====================================================================================
(function () {
  'use strict';
  const FR = { d: null, tab: 'general', pf: { region: '', group: '', status: 'active', q: '' }, df: { cycle: '', region: '', group: '', q: '' }, me: null, acc: null };
  const h = (s) => (typeof escapeHtml === 'function' ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s));
  const say = (m) => { try { toast(m); } catch (_e) { alert(m); } };
  const em = (e) => String((e && e.message) || e || 'Something went wrong');
  const sup = () => typeof isSuperAdmin === 'function' && isSuperAdmin();
  const notReady = (e) => /fr_|schema cache|does not exist|relation/i.test(em(e));
  const READY_MSG = 'Fuel Reimbursement is not set up yet. Please run <b>migration_68.sql</b> in Supabase → SQL Editor, then reload.';

  function css() {
    if (document.getElementById('fr-css')) return;
    const st = document.createElement('style'); st.id = 'fr-css';
    st.textContent = `
      .fr-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px}
      .fr-tab{border:1px solid #d6daec;background:#fff;color:#1E2A6E;border-radius:999px;padding:6px 14px;font-weight:600;font-size:13px;cursor:pointer}
      .fr-tab.on{background:#1E2A6E;color:#fff;border-color:#1E2A6E}
      .fr-card{background:var(--card,#fff);border:1px solid #e6e8f2;border-radius:14px;padding:16px;margin-bottom:12px}
      .fr-card h4{margin:0 0 8px;color:#1E2A6E}
      .fr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
      .fr-f label{display:block;font-size:12px;font-weight:600;color:#4a5170;margin-bottom:4px}
      .fr-f input,.fr-f select,.fr-f textarea{width:100%;padding:8px 10px;border:1px solid #d6daec;border-radius:9px;font:inherit;background:#fff}
      .fr-hint{font-size:12px;color:#6b7290;margin:4px 0 0}
      .fr-tb{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
      .fr-tb select,.fr-tb input{padding:7px 9px;border:1px solid #d6daec;border-radius:9px;font:inherit;font-size:13px;background:#fff}
      .fr-wrap{overflow:auto;border:1px solid #e6e8f2;border-radius:12px}
      .fr-wrap table{margin:0}
      .fr-pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:600;background:#eef0fb;color:#1E2A6E}
      .fr-pill.g{background:#e3f4ea;color:#2e7d4f}.fr-pill.o{background:#fff3df;color:#a0672b}.fr-pill.r{background:#fdeceb;color:#c0392b}.fr-pill.x{background:#eef0f3;color:#6b7290}
      .fr-checks{max-height:220px;overflow:auto;border:1px solid #e6e8f2;border-radius:10px;padding:6px 10px;columns:2;column-gap:16px}
      .fr-checks label{display:block;font-size:13px;padding:3px 0;break-inside:avoid}
      .fr-empty{padding:18px;text-align:center;color:#6b7290}
      .fr-n{text-align:right;font-variant-numeric:tabular-nums}
      html.fh-dark .fr-card{background:#161c3a;border-color:#2a3260}html.fh-dark .fr-card h4{color:#cdd3ff}
      html.fh-dark .fr-tab{background:#1b2350;color:#cdd3ff;border-color:#2f3870}html.fh-dark .fr-tab.on{background:#8da0ff;color:#0d1230}
      html.fh-dark .fr-f input,html.fh-dark .fr-f select,html.fh-dark .fr-f textarea,html.fh-dark .fr-tb select,html.fh-dark .fr-tb input{background:#10152e;color:#e6e9ff;border-color:#2f3870}
      html.fh-dark .fr-wrap,html.fh-dark .fr-checks{border-color:#2a3260}`;
    document.head.appendChild(st);
  }

  // ---------------------------------------------------------------- data
  async function load(force) {
    if (FR.d && !force) return FR.d;
    const q = (t, sel, ord) => { let x = sb.from(t).select(sel || '*'); if (ord) x = x.order(ord); return x; };
    const [st, gr, ve, cf, ru, rg, ct, ac] = await Promise.all([
      q('fr_settings').eq('id', 1).maybeSingle(), q('fr_groups', '*', 'name'), q('fr_vehicle_types', '*', 'name'),
      q('fr_region_cfg'), q('fr_photo_rules'), q('regions', 'id,name', 'name'), q('sub_regions', 'id,name,region_id,active', 'name'),
      sb.from('fr_access').select('*').eq('user_id', state.user.id).maybeSingle()]);
    const err = [st, gr, ve, cf, ru].find(r => r.error);
    if (err) throw err.error;
    FR.d = {
      settings: st.data || {}, groups: gr.data || [], vehicles: ve.data || [], cfg: cf.data || [], rules: ru.data || [],
      regions: rg.data || [], cities: (ct.data || []).filter(c => c.active !== false), myAccess: ac.data || null
    };
    return FR.d;
  }
  const nm = (list, id) => { const x = (list || []).find(o => o.id === id); return x ? x.name : ''; };
  const opts = (list, sel, blank) => (blank != null ? `<option value="">${h(blank)}</option>` : '') + (list || []).map(o => `<option value="${h(o.id)}"${o.id === sel ? ' selected' : ''}>${h(o.name)}${o.active === false ? ' (inactive)' : ''}</option>`).join('');
  async function rpc(fn, args, ok) {
    const { data, error } = await sb.rpc(fn, args || {});
    if (error) { say(notReady(error) && /function/i.test(error.message) ? 'Please run migration_68.sql in Supabase first.' : 'Could not save: ' + em(error).replace(/^.*?:\s*(?=[A-Z])/, '')); return { ok: false }; }
    if (ok) say(ok);
    return { ok: true, data };
  }

  // ---------------------------------------------------------------- menu
  window.frNavViews = function () {
    if (typeof state === 'undefined' || !state.profile) return [];
    const v = [];
    if (state.profile.role === 'super_admin') v.push('fr_daily', 'fr_monthly', 'fr_people', 'fr_bikes', 'fr_settings');
    else if (window.__frAcc) { v.push('fr_daily', 'fr_people'); if (window.__frAcc.can_enter) v.push('fr_monthly'); }
    if (window.__frMe) v.unshift('fr_my');
    return v;
  };
  // Who am I for Fuel? (rider on the fuel list / staff with access). Checked for every signed-in person,
  // again after a different person signs in, and again every minute while nothing is found
  // (so a rider added to the list today sees the menu without reinstalling anything).
  const CHK = { uid: null, at: 0, busy: false, ok: false };
  async function checkAccess(force) {
    if (typeof state === 'undefined' || !state.user || !state.profile || CHK.busy) return;
    const uid = state.user.id;
    if (CHK.uid !== uid) { window.__frMe = null; window.__frAcc = null; CHK.uid = uid; CHK.at = 0; CHK.ok = false; }
    const found = window.__frMe || window.__frAcc || state.profile.role === 'super_admin';
    if (!force && CHK.ok && (found || Date.now() - CHK.at < 60000)) return;
    CHK.busy = true; CHK.at = Date.now();
    try {
      const [me, ac] = await Promise.all([
        sb.from('fr_people').select('id,full_name,employee_id,region_id,city_id,group_id,vehicle_type_id,status').eq('profile_id', uid).eq('status', 'active').limit(1),
        state.profile.role === 'super_admin' ? Promise.resolve({ data: [] }) : sb.from('fr_access').select('*').eq('user_id', uid).limit(1)]);
      if (state.user && state.user.id !== uid) return;
      const m = (me && me.data && me.data[0]) || null, x = (ac && ac.data && ac.data[0]) || null;
      if (me && me.error) { console.warn('Fuel list check:', me.error.message); return; }
      CHK.ok = true;
      const changed = JSON.stringify(m) !== JSON.stringify(window.__frMe || null) || JSON.stringify(x) !== JSON.stringify(window.__frAcc || null);
      window.__frMe = m; window.__frAcc = x;
      if (changed && typeof origRenderNav === 'function') origRenderNav();
    } catch (e) { console.warn('Fuel access check', e); }
    finally { CHK.busy = false; }
  }
  let origRenderNav = null;
  (function hookNav() {
    if (typeof window.renderNav !== 'function') { setTimeout(hookNav, 300); return; }
    if (window.renderNav.__fr) return;
    origRenderNav = window.renderNav;
    const wrapped = function () { const r = origRenderNav.apply(this, arguments); checkAccess(false); pendingBadge(); bikeGate(); return r; };
    wrapped.__fr = true; window.renderNav = wrapped;
    checkAccess(false);
  })();
  setInterval(() => { checkAccess(false); bikeGate(); }, 3000);
  setInterval(() => pendingBadge(true), 120000);
  // Super Admin: how many people (requested by Area Leads etc.) wait for approval — shown as a number on "Fuel People"
  const PB = { at: 0 };
  async function pendingBadge(force) {
    if (typeof state === 'undefined' || !state.profile || state.profile.role !== 'super_admin' || typeof FH_BADGES === 'undefined') return;
    if (!force && Date.now() - PB.at < 60000) { if (typeof fhApplyNavBadges === 'function') fhApplyNavBadges(); return; }
    PB.at = Date.now();
    try {
      const { data, error } = await sb.rpc('fr_pending_count');
      if (error) return;
      const before = FH_BADGES.fr_people || 0; FH_BADGES.fr_people = data || 0;
      if (typeof fhApplyNavBadges === 'function') fhApplyNavBadges();
      if (data && data !== before && !PB.told) { PB.told = true; say(`⛽ ${data} person(s) waiting for your approval in Fuel People`); }
    } catch (_e) {}
  }
  window.frPendingBadge = () => pendingBadge(true);

  // ---------------------------------------------------------------- bike number: every rider must add it (once), can change it in My Profile
  const BG = { uid: null, done: false, busy: false };
  async function bikeGate() {
    if (typeof state === 'undefined' || !state.user || !state.profile || state.profile.role !== 'rider' || BG.busy) return;
    if (BG.uid !== state.user.id) { BG.uid = state.user.id; BG.done = false; }
    if (BG.done || document.getElementById('fr-bike-gate') || document.getElementById('fh-email-gate')) return;
    if (window.fhOffline && fhOffline.isOffline && fhOffline.isOffline()) return;
    BG.busy = true;
    try {
      const { data, error } = await sb.from('profiles').select('bike_number').eq('id', state.user.id).maybeSingle();
      if (error) { if (/bike_number/i.test(error.message || '')) BG.done = true; return; }   // migration_71 not run yet
      if (data && data.bike_number) { BG.done = true; return; }
      css();
      const o = document.createElement('div'); o.id = 'fr-bike-gate'; o.className = 'modal-overlay'; o.style.zIndex = 99998;
      o.innerHTML = `<div class="modal"><h2>🏍 Add your bike number</h2>
        <p class="hint">Every rider must add the number plate of the bike he uses for work. It is needed for fuel reimbursement. You can change it later in <b>My Profile</b>.</p>
        <form id="fr-bike-f"><div class="form-row"><label>Bike number (as on the number plate)</label><input id="fr-bike-n" required maxlength="15" placeholder="e.g. LEA-1234" style="text-transform:uppercase" autocomplete="off"></div>
        <div class="form-row"><label>Type it again</label><input id="fr-bike-n2" required maxlength="15" style="text-transform:uppercase" autocomplete="off"></div>
        <button class="btn-primary" type="submit" id="fr-bike-s" style="width:100%">Save bike number</button></form></div>`;
      document.body.appendChild(o);
      o.querySelector('#fr-bike-f').onsubmit = async (e) => {
        e.preventDefault();
        const a = o.querySelector('#fr-bike-n').value.trim().toUpperCase(), b = o.querySelector('#fr-bike-n2').value.trim().toUpperCase();
        if (a.replace(/\s+/g, ' ') !== b.replace(/\s+/g, ' ')) { say('The two bike numbers do not match'); return; }
        const { data: v, error: e2 } = await sb.rpc('fh_set_bike_number', { p_number: a });
        if (e2) { say(errText(e2)); return; }
        BG.done = true; o.remove(); say('Bike number saved: ' + v);
      };
    } catch (_e) {} finally { BG.busy = false; }
  }   // cheap: it only asks the database until the first answer, then once a minute while nothing is found
  window.frRecheck = () => checkAccess(true);

  // ---------------------------------------------------------------- page entry
  window.renderFuelReimb = async function (view) {
    const main = document.getElementById('main-content');
    css(); try { fvEnsureStyle(); } catch (_e) {}
    if (!(window.frNavViews() || []).includes(view)) { main.innerHTML = '<div class="empty-state">You do not have access to this page.</div>'; return; }
    if (view !== 'fr_my' && window.fhFuel2fa) { const ok = await fhFuel2fa.gate(main, () => { if (state.view === view) window.renderFuelReimb(view); }); if (!ok) return; }
    try { await load(true); }
    catch (e) { main.innerHTML = `<div class="fr-card fr-empty">${notReady(e) ? READY_MSG : h(em(e))}</div>`; return; }
    if (view === 'fr_settings') return pageSettings(main);
    if (view === 'fr_people') return pagePeople(main);
    if (view === 'fr_my') return pageMy(main);
    if (view === 'fr_daily') return pageDaily(main);
    if (view === 'fr_monthly') return pageMonthly(main);
    if (view === 'fr_bikes') return pageBikes(main);
  };

  // =====================================================================================
  // SETTINGS (Super Admin)
  // =====================================================================================
  const TABS = [['general', 'General'], ['groups', 'Groups'], ['visit', 'KM per visit'], ['vehicles', 'Vehicle types'], ['regions', 'Regions'], ['pictures', 'Pictures'], ['access', 'Staff access'], ['drive', 'Google Drive'], ['log', 'Change log']];
  function pageSettings(main) {
    main.innerHTML = `<p class="fv-sub">Set everything once. Only the Super Admin can change these, and every change is logged.</p>
      <div class="fr-tabs">${TABS.map(([k, l]) => `<button class="fr-tab${FR.tab === k ? ' on' : ''}" data-tab="${k}" type="button">${l}</button>`).join('')}</div><div id="fr-body"></div>`;
    main.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { FR.tab = b.dataset.tab; pageSettings(main); });
    const body = main.querySelector('#fr-body');
    ({ general: tGeneral, groups: tGroups, visit: tVisit, vehicles: tVehicles, regions: tRegions, pictures: tPictures, access: tAccess, drive: tDrive, log: tLog })[FR.tab](body);
  }
  const again = () => { load(true).then(() => pageSettings(document.getElementById('main-content'))); };

  function tGeneral(body) {
    const s = FR.d.settings;
    body.innerHTML = `<div class="fr-card"><h4>Fuel month (cycle) and daily readings</h4><div class="fr-grid">
      <div class="fr-f"><label>Cycle starts on day</label><input type="number" id="g-start" min="1" max="28" value="${h(s.cycle_start_day || 16)}"><p class="fr-hint">16 = from the 16th to the 15th of the next month.</p></div>
      <div class="fr-f"><label>Days back a rider may fill in</label><input type="number" id="g-back" min="0" max="7" value="${h(s.back_days == null ? 2 : s.back_days)}"><p class="fr-hint">2 = today plus the 2 days before. Older days are locked.</p></div>
      <div class="fr-f"><label>Allow equal readings</label><select id="g-eq"><option value="false"${!s.allow_equal ? ' selected' : ''}>No — next Opening must be more than last Closing</option><option value="true"${s.allow_equal ? ' selected' : ''}>Yes — equal is allowed (bike did not move)</option></select></div>
      </div><div style="margin-top:12px"><button class="fv-btn" id="g-save" type="button">Save</button></div></div>
      <div class="fr-card"><h4>Fuel price and rate</h4><p class="fr-hint">One average fuel price per cycle for all groups. It is entered when the cycle is reviewed (Phase 6). Rs per KM = fuel price ÷ KM per litre + maintenance per KM (set under Vehicle types). There is no monthly KM limit.</p></div>`;
    body.querySelector('#g-save').onclick = async () => {
      const a = +body.querySelector('#g-start').value, b = +body.querySelector('#g-back').value;
      if (!(a >= 1 && a <= 28)) { say('Cycle start day must be 1 to 28'); return; }
      if (!(b >= 0 && b <= 7)) { say('Days back must be 0 to 7'); return; }
      if ((await rpc('fr_save_settings', { p: { cycle_start_day: a, back_days: b, allow_equal: body.querySelector('#g-eq').value === 'true' } }, 'Saved')).ok) again();
    };
  }

  function tGroups(body) {
    const g = FR.d.groups;
    body.innerHTML = `<div class="fr-tb"><button class="fv-btn" id="gr-add" type="button">+ Add group</button><button class="fv-btn ghost" id="gr-copy" type="button">Copy groups from Fuel Trends</button><span class="fv-note">Visit-based groups (Home Sampling, Home Care) are limited to "max KM per visit × visits". Set the KM per visit for each city on the <b>KM per visit</b> tab; the value here is only the default for cities without their own.</span></div>
      <div class="fr-wrap"><table class="fv-table"><thead><tr><th>Group</th><th>Visit-based</th><th class="fr-n">Default KM per visit</th><th>Status</th><th></th></tr></thead><tbody>
      ${g.map(x => `<tr><td>${h(x.name)}</td><td>${x.visit_based ? 'Yes' : 'No'}</td><td class="fr-n">${x.visit_based ? (x.max_km_per_visit == null ? '<span class="fr-pill o">not set</span>' : h(x.max_km_per_visit)) : '–'}</td><td>${x.active ? '<span class="fr-pill g">Active</span>' : '<span class="fr-pill x">Inactive</span>'}</td><td style="text-align:right"><button class="fv-btn ghost" data-ed="${h(x.id)}" type="button">Edit</button></td></tr>`).join('') || '<tr><td colspan="5" class="fr-empty">No groups yet. Click "Copy groups from Fuel Trends".</td></tr>'}
      </tbody></table></div>`;
    body.querySelector('#gr-add').onclick = () => groupModal(null);
    body.querySelector('#gr-copy').onclick = async () => { const r = await rpc('fr_copy_groups_from_trends'); if (r.ok) { say(r.data ? r.data + ' group(s) added' : 'Nothing new to copy'); again(); } };
    body.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => groupModal(g.find(x => x.id === b.dataset.ed)));
  }
  function groupModal(x) {
    x = x || { name: '', visit_based: false, max_km_per_visit: '', active: true };
    openModal(`<h2>${x.id ? 'Edit group' : 'Add group'}</h2><div class="fr-f" style="margin:10px 0"><label>Name *</label><input id="m-n" value="${h(x.name)}"></div>
      <div class="fr-f" style="margin:10px 0"><label>Visit-based?</label><select id="m-v"><option value="false">No (couriers, maintenance, etc.)</option><option value="true"${x.visit_based ? ' selected' : ''}>Yes (Home Sampling, Home Care)</option></select></div>
      <div class="fr-f" style="margin:10px 0"><label>Default KM per visit (used for cities without their own value)</label><input type="number" step="0.1" min="0" id="m-k" value="${h(x.max_km_per_visit == null ? '' : x.max_km_per_visit)}"></div>
      ${x.id ? `<div class="fr-f" style="margin:10px 0"><label>Status</label><select id="m-a"><option value="true">Active</option><option value="false"${x.active ? '' : ' selected'}>Inactive (hidden from new entries; history kept)</option></select></div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn-primary" id="m-s" type="button">Save</button>${x.id ? '<button class="btn outline" id="m-del" type="button" style="color:#c0392b">Delete group</button>' : ''}</div>`);
    const del = document.getElementById('m-del');
    if (del) del.onclick = async () => { if (!confirm(`Delete the group "${x.name}"?\n\nOnly possible when nobody is in it. Otherwise make it Inactive.`)) return; if ((await rpc('fr_group_delete', { p_id: x.id }, 'Group deleted')).ok) { closeModal(); again(); } };
    document.getElementById('m-s').onclick = async () => {
      const p = { id: x.id || '', name: document.getElementById('m-n').value, visit_based: document.getElementById('m-v').value === 'true', max_km_per_visit: document.getElementById('m-k').value };
      const a = document.getElementById('m-a'); if (a) p.active = a.value === 'true';
      if ((await rpc('fr_save_group', { p }, 'Group saved')).ok) { closeModal(); again(); }
    };
  }

  function tVehicles(body) {
    const v = FR.d.vehicles;
    body.innerHTML = `<div class="fr-tb"><button class="fv-btn" id="ve-add" type="button">+ Add vehicle type</button><span class="fv-note">Limits stop typing mistakes: a day longer than "Max KM a day", or a jump between yesterday's Closing and today's Opening bigger than "Max overnight gap", is refused.</span></div>
      <div class="fr-wrap"><table class="fv-table"><thead><tr><th>Vehicle type</th><th class="fr-n">KM per litre</th><th class="fr-n">Maintenance Rs/KM</th><th class="fr-n">Max KM a day</th><th class="fr-n">Max overnight gap</th><th>Status</th><th></th></tr></thead><tbody>
      ${v.map(x => `<tr><td>${h(x.name)}</td><td class="fr-n">${h(x.km_per_litre)}</td><td class="fr-n">${h(x.maint_per_km)}</td><td class="fr-n">${x.max_km_day == null ? '–' : h(x.max_km_day)}</td><td class="fr-n">${x.max_gap_km == null ? '–' : h(x.max_gap_km)}</td><td>${x.active ? '<span class="fr-pill g">Active</span>' : '<span class="fr-pill x">Inactive</span>'}</td><td style="text-align:right"><button class="fv-btn ghost" data-ed="${h(x.id)}" type="button">Edit</button></td></tr>`).join('')}
      </tbody></table></div>
      <p class="fr-hint" style="margin-top:8px">Example: fuel price Rs 300 ÷ 40 KM per litre = Rs 7.50, + Rs 1.50 maintenance = <b>Rs 9 per KM</b>.</p>`;
    body.querySelector('#ve-add').onclick = () => vehicleModal(null);
    body.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => vehicleModal(v.find(x => x.id === b.dataset.ed)));
  }
  function vehicleModal(x) {
    x = x || { name: '', km_per_litre: 40, maint_per_km: 0, max_km_day: '', max_gap_km: '', active: true };
    const f = (id, l, v, hint) => `<div class="fr-f" style="margin:10px 0"><label>${l}</label><input type="number" step="0.01" min="0" id="${id}" value="${h(v == null ? '' : v)}">${hint ? `<p class="fr-hint">${hint}</p>` : ''}</div>`;
    openModal(`<h2>${x.id ? 'Edit vehicle type' : 'Add vehicle type'}</h2><div class="fr-f" style="margin:10px 0"><label>Name *</label><input id="m-n" value="${h(x.name)}"></div>
      ${f('m-kpl', 'KM per litre *', x.km_per_litre)}${f('m-mt', 'Maintenance Rs per KM', x.maint_per_km)}
      ${f('m-md', 'Max KM a day', x.max_km_day, 'Closing − Opening on one day. Leave empty for no limit.')}${f('m-mg', 'Max overnight gap (KM)', x.max_gap_km, "Today's Opening − yesterday's Closing. Catches 50030 typed for 5030.")}
      ${x.id ? `<div class="fr-f" style="margin:10px 0"><label>Status</label><select id="m-a"><option value="true">Active</option><option value="false"${x.active ? '' : ' selected'}>Inactive</option></select></div>` : ''}
      <button class="btn-primary" id="m-s" type="button">Save</button>`);
    document.getElementById('m-s').onclick = async () => {
      const g = (id) => document.getElementById(id).value;
      const p = { id: x.id || '', name: g('m-n'), km_per_litre: g('m-kpl'), maint_per_km: g('m-mt'), max_km_day: g('m-md'), max_gap_km: g('m-mg') };
      const a = document.getElementById('m-a'); if (a) p.active = a.value === 'true';
      if ((await rpc('fr_save_vehicle', { p }, 'Vehicle type saved')).ok) { closeModal(); again(); }
    };
  }

  function tRegions(body) {
    const cfg = {}; FR.d.cfg.forEach(c => { cfg[c.region_id] = c.reviewer; });
    const cityN = {}; FR.d.cities.forEach(c => { cityN[c.region_id] = (cityN[c.region_id] || 0) + 1; });
    body.innerHTML = `<div class="fr-tb"><span class="fv-note">Regions and cities come from your existing lists, so names always match. To add a region or city, use Admin → Regions.</span><span style="flex:1"></span><button class="fv-btn" id="rg-bulk" type="button">⬆ Bulk upload regions & cities</button><button class="fv-btn ghost" type="button" onclick="navigateTo('regions')">Open Regions</button></div>
      <div class="fr-wrap"><table class="fv-table"><thead><tr><th>Region</th><th class="fr-n">Cities</th><th>Month-end review done by</th></tr></thead><tbody>
      ${FR.d.regions.map(r => `<tr><td>${h(r.name)}</td><td class="fr-n">${cityN[r.id] || 0}</td><td><select data-rv="${h(r.id)}" style="padding:6px 8px;border:1px solid #d6daec;border-radius:8px"><option value="area">Area Incharge / Regional POC</option><option value="super_admin"${cfg[r.id] === 'super_admin' ? ' selected' : ''}>Super Admin</option></select></td></tr>`).join('') || '<tr><td colspan="3" class="fr-empty">No regions yet.</td></tr>'}
      </tbody></table></div>`;
    body.querySelector('#rg-bulk').onclick = bulkRegionsModal;
    body.querySelectorAll('[data-rv]').forEach(s => s.onchange = async () => { if (!(await rpc('fr_set_reviewer', { p_region: s.dataset.rv, p_reviewer: s.value }, 'Saved')).ok) again(); else load(true); });
  }

  async function tPictures(body) {
    body.innerHTML = '<p class="fr-hint">Loading…</p>';
    const { data: ppl } = await sb.from('fr_people').select('id,full_name,employee_id').order('full_name');
    const lists = { region: FR.d.regions, city: FR.d.cities.map(c => ({ id: c.id, name: c.name + (nm(FR.d.regions, c.region_id) ? ' — ' + nm(FR.d.regions, c.region_id) : '') })), person: (ppl || []).map(p => ({ id: p.id, name: p.full_name + (p.employee_id ? ' (' + p.employee_id + ')' : '') })) };
    const RL = { required: 'Required', optional: 'Optional', off: 'Not allowed' }, SL = { all: 'Everyone', region: 'Region', city: 'City', person: 'One person' };
    const who = (r) => r.scope === 'all' ? 'Everyone' : nm(lists[r.scope], r.scope_id) || '(removed)';
    const rules = FR.d.rules.slice().sort((a, b) => ['all', 'region', 'city', 'person'].indexOf(a.scope) - ['all', 'region', 'city', 'person'].indexOf(b.scope));
    const allRule = (FR.d.rules.find(r => r.scope === 'all') || {}).rule || 'optional';
    body.innerHTML = `<div class="fr-card"><h4>Pictures for everyone (main switch)</h4>
      <p class="fr-hint">Turn pictures <b>off</b> to save Google Drive space. Rules for a region, city or person below still win over this switch — remove them if you want "off" for everyone.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">${[['off', '⛔ Off — no pictures'], ['optional', 'Optional'], ['required', 'Required']].map(([k, l]) => `<button class="fr-tab${allRule === k ? ' on' : ''}" data-all="${k}" type="button">${l}</button>`).join('')}</div></div>
      <div class="fr-card"><h4>Odometer picture rules</h4><p class="fr-hint">The most specific rule wins: one person → city → region → everyone. Pictures are saved in your Google Drive, never in Supabase.</p>
      <div class="fr-wrap" style="margin-top:8px"><table class="fv-table"><thead><tr><th>Applies to</th><th>Who</th><th>Picture</th><th></th></tr></thead><tbody>
      ${rules.map(r => `<tr><td>${SL[r.scope]}</td><td>${h(who(r))}</td><td><span class="fr-pill ${r.rule === 'required' ? 'o' : r.rule === 'off' ? 'x' : 'g'}">${RL[r.rule]}</span></td><td style="text-align:right">${r.scope === 'all' ? '' : `<button class="fv-btn ghost" data-rm="${h(r.scope)}|${h(r.scope_id)}" type="button" style="color:#c0392b">Remove</button>`}</td></tr>`).join('')}
      </tbody></table></div></div>
      <div class="fr-card"><h4>Add or change a rule</h4><div class="fr-grid">
        <div class="fr-f"><label>Applies to</label><select id="p-sc"><option value="all">Everyone</option><option value="region">Region</option><option value="city">City</option><option value="person">One person</option></select></div>
        <div class="fr-f"><label>Who</label><select id="p-id" disabled><option value="">—</option></select></div>
        <div class="fr-f"><label>Picture</label><select id="p-ru"><option value="optional">Optional</option><option value="required">Required</option><option value="off">Not allowed</option></select></div>
      </div><div style="margin-top:12px"><button class="fv-btn" id="p-save" type="button">Save rule</button></div></div>`;
    body.querySelectorAll('[data-all]').forEach(b => b.onclick = async () => { if (b.dataset.all === allRule) return; if (b.dataset.all === 'off' && !confirm('Stop pictures for everyone?\n\nRiders will no longer see the picture button (except where a region, city or person rule says otherwise). Pictures already saved stay in Google Drive.')) return; if ((await rpc('fr_set_photo_rule', { p_scope: 'all', p_scope_id: null, p_rule: b.dataset.all }, 'Saved')).ok) again(); });
    const sc = body.querySelector('#p-sc'), idSel = body.querySelector('#p-id');
    sc.onchange = () => { const l = lists[sc.value]; idSel.disabled = !l; idSel.innerHTML = l ? opts(l, '', 'Choose…') : '<option value="">—</option>'; };
    body.querySelector('#p-save').onclick = async () => {
      if (sc.value !== 'all' && !idSel.value) { say('Please choose who the rule is for'); return; }
      if ((await rpc('fr_set_photo_rule', { p_scope: sc.value, p_scope_id: sc.value === 'all' ? null : idSel.value, p_rule: body.querySelector('#p-ru').value }, 'Rule saved')).ok) again();
    };
    body.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { const [s, i] = b.dataset.rm.split('|'); if ((await rpc('fr_set_photo_rule', { p_scope: s, p_scope_id: i, p_rule: 'inherit' }, 'Rule removed')).ok) again(); });
  }

  async function tAccess(body) {
    body.innerHTML = '<p class="fr-hint">Loading…</p>';
    const [st, ac] = await Promise.all([sb.rpc('fr_staff_list'), sb.from('fr_access').select('*')]);
    if (st.error || ac.error) { body.innerHTML = `<div class="fr-card fr-empty">${h(em(st.error || ac.error))}</div>`; return; }
    const staff = st.data || [], acc = ac.data || [];
    FR.staff = staff;
    const byId = {}; staff.forEach(s => { byId[s.id] = s; });
    const ROLE = { team_lead: 'Area Incharge', regional_poc: 'Regional POC', admin: 'Admin', coordinator: 'Coordinator', super_admin: 'Super Admin', inventory_coordinator: 'Inventory Coordinator' };
    const yes = (b) => b ? '✓' : '–';
    body.innerHTML = `<div class="fr-tb"><button class="fv-btn" id="ac-add" type="button">+ Give access</button><button class="fv-btn ghost" id="ac-new" type="button">+ Create Fuel login (new person)</button><span class="fv-note">Area Incharges, Regional Leads, Admin Officers and the courier manager only see the regions and groups you tick here.</span></div>
      <div class="fr-wrap"><table class="fv-table"><thead><tr><th>Name</th><th>Title</th><th>Regions</th><th>Groups</th><th>Review</th><th>Enter for others</th><th>Request people</th><th></th></tr></thead><tbody>
      ${acc.map(a => { const s = byId[a.user_id] || {}; return `<tr><td>${h(s.full_name || '(not active)')}</td><td>${h(a.title || ROLE[s.role] || s.role || '')}</td><td>${h(a.regions.map(r => nm(FR.d.regions, r)).filter(Boolean).join(', ') || '–')}</td><td>${h(a.groups.length ? a.groups.map(g => nm(FR.d.groups, g)).filter(Boolean).join(', ') : 'All')}</td><td>${yes(a.can_review)}</td><td>${yes(a.can_enter)}</td><td>${yes(a.can_request)}</td><td style="text-align:right"><button class="fv-btn ghost" data-ed="${h(a.user_id)}" type="button">Edit</button></td></tr>`; }).join('') || '<tr><td colspan="8" class="fr-empty">Nobody has access yet.</td></tr>'}
      </tbody></table></div>`;
    const modal = (a) => {
      a = a || { user_id: '', regions: [], groups: [], can_review: true, can_enter: false, can_request: true, title: '' };
      const chk = (list, sel, nmKey) => list.map(o => `<label><input type="checkbox" data-${nmKey}="${h(o.id)}"${sel.includes(o.id) ? ' checked' : ''}> ${h(o.name)}</label>`).join('');
      openModal(`<h2>${a.user_id ? 'Edit access' : 'Give access'}</h2>
        <div class="fr-f" style="margin:10px 0"><label>Staff member *</label>${a.user_id ? `<input value="${h((byId[a.user_id] || {}).full_name || 'New login')}" disabled>` : `<input id="m-q" placeholder="Type to search name or ID…" style="margin-bottom:6px"><select id="m-u" size="6">${staff.filter(s => s.role !== 'super_admin').map(s => `<option value="${h(s.id)}">${h(s.full_name || '')}${s.employee_id ? ' (' + h(s.employee_id) + ')' : ''} — ${h(ROLE[s.role] || s.role)}</option>`).join('')}</select>`}</div>
        <div class="fr-f" style="margin:10px 0"><label>Title shown in Fuel pages</label><input id="m-t" list="fr-titles" value="${h(a.title || '')}" placeholder="e.g. Area Lead, Regional Lead, Admin Officer, Courier Manager"><datalist id="fr-titles"><option>Area Lead</option><option>Regional Lead</option><option>Admin Officer</option><option>Area Incharge</option><option>Courier Manager</option><option>Maintenance Manager</option></datalist></div>
        <div class="fr-f" style="margin:10px 0"><label>Regions *</label><div class="fr-checks">${chk(FR.d.regions, a.regions, 'r')}</div></div>
        <div class="fr-f" style="margin:10px 0"><label>Groups (tick none = all groups)</label><div class="fr-checks">${chk(FR.d.groups.filter(g => g.active), a.groups, 'g')}</div></div>
        <div class="fr-f" style="margin:10px 0"><label><input type="checkbox" id="m-rv"${a.can_review ? ' checked' : ''}> Month-end review (HOD deduction, approved by region)</label>
          <label><input type="checkbox" id="m-en"${a.can_enter ? ' checked' : ''}> Enter readings for people without a login (e.g. courier manager)</label>
          <label><input type="checkbox" id="m-rq"${a.can_request ? ' checked' : ''}> Request new people (you approve)</label></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn-primary" id="m-s" type="button">Save</button>${a.user_id ? '<button class="btn outline" id="m-x" type="button" style="color:#c0392b">Remove access</button>' : ''}</div>`);
      const q = document.getElementById('m-q');
      if (q) q.oninput = () => { const t = q.value.toLowerCase(); document.querySelectorAll('#m-u option').forEach(o => { o.hidden = t && !o.textContent.toLowerCase().includes(t); }); };
      const ticks = (k) => [...document.querySelectorAll(`[data-${k}]`)].filter(i => i.checked).map(i => i.dataset[k]);
      document.getElementById('m-s').onclick = async () => {
        const uid = a.user_id || (document.getElementById('m-u') || {}).value;
        if (!uid) { say('Please choose the staff member'); return; }
        const regions = ticks('r'); if (!regions.length) { say('Please tick at least one region'); return; }
        const p = { title: document.getElementById('m-t').value, regions, groups: ticks('g'), can_review: document.getElementById('m-rv').checked, can_enter: document.getElementById('m-en').checked, can_request: document.getElementById('m-rq').checked };
        if ((await rpc('fr_save_access', { p_user: uid, p }, 'Access saved')).ok) { closeModal(); again(); }
      };
      const x = document.getElementById('m-x');
      if (x) x.onclick = async () => { if (!confirm('Remove this person\'s Fuel Reimbursement access?')) return; if ((await rpc('fr_save_access', { p_user: a.user_id, p: { remove: true } }, 'Access removed')).ok) { closeModal(); again(); } };
    };
    body.querySelector('#ac-add').onclick = () => modal(null);
    body.querySelector('#ac-new').onclick = () => newLoginModal((uid) => { tAccess(body).then(() => modal({ user_id: uid, regions: [], groups: [], can_review: true, can_enter: false, can_request: true, title: '' })); });
    body.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => modal(acc.find(a => a.user_id === b.dataset.ed)));
  }

  // ---------------------------------------------------------------- Phase 3: Google Drive link
  async function drive(action, extra) {
    const url = FR.d && FR.d.settings && FR.d.settings.drive_url;
    if (!url) throw new Error('No Google Drive link saved yet');
    const send = async (fresh) => {
      let s0 = (await sb.auth.getSession()).data.session;
      // a sign-in token lasts about an hour; give the script a fresh one when it is old (or when it was refused once)
      if (fresh || !s0 || (s0.expires_at && s0.expires_at * 1000 - Date.now() < 5 * 60000)) { const r0 = await sb.auth.refreshSession(); if (r0.data && r0.data.session) s0 = r0.data.session; }
      const token = s0 && s0.access_token;
      if (!token) throw new Error('Please sign in again');
      const r = await fetch(url, { method: 'POST', body: JSON.stringify(Object.assign({ action, token }, extra || {})) });   // plain text body: no extra browser check needed
      const j = await r.json().catch(() => null);
      if (!j) throw new Error('The link did not answer like the FieldHub script. Check that you copied the "Web app" URL.');
      return j;
    };
    let j = await send(false);
    if (!j.ok && /sign-in|signed in/i.test(j.error || '')) j = await send(true);
    if (!j.ok) throw new Error(j.error || 'The Drive script refused the request');
    return j;
  }
  window.frDrive = drive;   // used by later phases (pictures, archive)
  function tDrive(body) {
    const u = FR.d.settings.drive_url || '';
    body.innerHTML = `<div class="fr-card"><h4>Google Drive link</h4>
      <p class="fr-hint">Pictures and finalized months are kept in your Google Drive (folder "FieldHub Fuel"), not in Supabase. Paste the <b>Web app URL</b> from your Google Apps Script here (see the Phase 3 guide).</p>
      <div class="fr-f" style="margin-top:10px"><label>Web app URL</label><input id="d-url" placeholder="https://script.google.com/macros/s/…/exec" value="${h(u)}"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="fv-btn" id="d-save" type="button">Save link</button><button class="fv-btn ghost" id="d-test" type="button"${u ? '' : ' disabled'}>Test connection</button></div>
      <div id="d-out" style="margin-top:10px"></div></div>`;
    body.querySelector('#d-save').onclick = async () => {
      const v = body.querySelector('#d-url').value.trim();
      if (v && !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(v)) { say('That does not look like a Web app URL. It should start with https://script.google.com/macros/s/ and end with /exec'); return; }
      if ((await rpc('fr_save_settings', { p: { drive_url: v } }, v ? 'Link saved' : 'Link removed')).ok) again();
    };
    body.querySelector('#d-test').onclick = async () => {
      const out = body.querySelector('#d-out'); out.innerHTML = '<span class="fr-pill">Testing…</span>';
      try {
        const j = await drive('ping'); const gb = (x) => (x / 1073741824).toFixed(2) + ' GB';
        const space = j.limit ? `<div style="margin-top:8px">Google Drive space: <b>${gb(j.used)}</b> of <b>${gb(j.limit)}</b> used (${Math.round(j.used * 100 / j.limit)}%)${j.used / j.limit > 0.9 ? ' <span class="fr-pill r">almost full — turn pictures off or free space</span>' : ''}</div>` : '';
        out.innerHTML = `<span class="fr-pill g">Connected ✓</span> <span class="fr-hint">Folder: ${h(j.folder)} · signed in as ${h(j.user || '')}</span>${space}`;
      }
      catch (e) { out.innerHTML = `<span class="fr-pill r">Not connected</span> <span class="fr-hint">${h(em(e))}</span>`; }
    };
  }

  async function tLog(body) {
    body.innerHTML = '<p class="fr-hint">Loading…</p>';
    const { data, error } = await sb.from('fr_log').select('*').order('id', { ascending: false }).limit(200);
    if (error) { body.innerHTML = `<div class="fr-card fr-empty">${h(em(error))}</div>`; return; }
    const ids = [...new Set((data || []).map(r => r.actor).filter(Boolean))];
    const names = {}; if (ids.length) { const { data: p } = await sb.from('profiles').select('id,full_name').in('id', ids); (p || []).forEach(x => { names[x.id] = x.full_name; }); }
    const short = (v) => v == null ? '' : h(JSON.stringify(v).slice(0, 160));
    body.innerHTML = `<p class="fr-hint">Last 200 changes. Older entries are copied to Google Drive when a cycle is finalized (Phase 6).</p><div class="fr-wrap" style="margin-top:8px"><table class="fv-table"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Action</th><th>Before</th><th>After</th><th>Reason</th></tr></thead><tbody>
      ${(data || []).map(r => `<tr><td style="white-space:nowrap">${h(new Date(r.at).toLocaleString())}</td><td>${h(names[r.actor] || '')}</td><td>${h(r.entity)}</td><td>${h(r.action)}</td><td style="font-size:11px;max-width:220px;word-break:break-all">${short(r.old_val)}</td><td style="font-size:11px;max-width:220px;word-break:break-all">${short(r.new_val)}</td><td>${h(r.reason || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="fr-empty">No changes yet.</td></tr>'}
      </tbody></table></div>`;
  }

  // =====================================================================================
  // PEOPLE (Super Admin: everything; staff with access: their regions, and requests)
  // =====================================================================================
  async function pagePeople(main) {
    const S = sup(), A = FR.d.myAccess || {};
    const canReq = S || A.can_request;
    main.innerHTML = '<p class="fr-hint">Loading…</p>';
    const all = await fvFetchAll(() => sb.from('fr_people').select('*').order('full_name').order('id'));
    const myRegions = S ? FR.d.regions : FR.d.regions.filter(r => (A.regions || []).includes(r.id));
    const f = FR.pf;
    const rows = all.filter(p => (!f.region || p.region_id === f.region) && (!f.group || p.group_id === f.group) && (!f.status || p.status === f.status)
      && (!f.q || (p.full_name + ' ' + (p.employee_id || '')).toLowerCase().includes(f.q.toLowerCase())));
    const pend = all.filter(p => p.status === 'pending');
    const reqBy = {};
    if (S && pend.length) { const ids = [...new Set(pend.map(p => p.requested_by).filter(Boolean))]; if (ids.length) { const { data: rq } = await sb.from('profiles').select('id,full_name').in('id', ids); (rq || []).forEach(x => { reqBy[x.id] = x.full_name; }); } }
    const ST = { active: ['g', 'Active'], pending: ['o', 'Waiting approval'], rejected: ['r', 'Rejected'], inactive: ['x', 'Inactive'] };
    main.innerHTML = `<p class="fv-sub">${S ? 'Everyone who claims fuel. Riders come from the roster; others are added or requested here.' : 'People in your regions. New people you request appear after the Super Admin approves them.'}</p>
      ${S && pend.length ? `<div class="fr-card" style="border-color:#f3d9a8"><h4>⏳ Waiting for your approval (${pend.length})</h4><p class="fr-hint">Requested by Area Leads / Regional Leads / Admin Officers. After you approve, the person appears in the lists and their fuel is processed like everyone else's.</p><div class="fr-wrap"><table class="fv-table"><thead><tr><th>Requested by</th><th>Name</th><th>Employee ID</th><th>Region / City</th><th>Group</th><th>Note</th><th></th></tr></thead><tbody>
        ${pend.map(p => `<tr><td>${h(reqBy[p.requested_by] || '—')}<div class="fr-hint" style="margin:0">${p.requested_at ? h(new Date(p.requested_at).toLocaleDateString('en-GB')) : ''}</div></td><td>${h(p.full_name)}</td><td>${h(p.employee_id || '–')}</td><td>${h(nm(FR.d.regions, p.region_id))}${p.city_id ? ' / ' + h(nm(FR.d.cities, p.city_id)) : ''}</td><td>${h(nm(FR.d.groups, p.group_id))}</td><td>${h(p.note || '')}</td><td style="text-align:right;white-space:nowrap"><button class="fv-btn" data-ap="${h(p.id)}" type="button">Approve</button> <button class="fv-btn ghost" data-rj="${h(p.id)}" type="button" style="color:#c0392b">Reject</button></td></tr>`).join('')}
        </tbody></table></div></div>` : ''}
      <div class="fr-tb">
        <select id="f-r"><option value="">All regions</option>${opts(myRegions, f.region)}</select>
        <select id="f-g"><option value="">All groups</option>${opts(FR.d.groups, f.group)}</select>
        <select id="f-s"><option value="">Any status</option>${Object.keys(ST).map(k => `<option value="${k}"${f.status === k ? ' selected' : ''}>${ST[k][1]}</option>`).join('')}</select>
        <input id="f-q" placeholder="Search name / ID" value="${h(f.q)}" style="min-width:160px">
        <span style="flex:1"></span>
        ${S ? '<button class="fv-btn ghost" id="pp-sync" type="button">↻ Reload riders from roster</button>' : ''}
        ${canReq ? `<button class="fv-btn" id="pp-add" type="button">${S ? '+ Add person' : '+ Request new person'}</button>` : ''}
        <button class="fv-btn ghost" id="pp-csv" type="button">Download (CSV)</button>
      </div>
      <p class="fr-hint" style="margin:0 0 8px">${rows.length} shown · ${all.filter(p => p.status === 'active').length} active in total</p>
      ${S ? `<div class="fr-tb" id="pp-bulk" style="display:none;background:#eef0fb;border-radius:10px;padding:8px 10px"><b id="pp-n">0</b> selected<span style="flex:1"></span><button class="fv-btn" id="pp-bedit" type="button">Edit selected</button><button class="fv-btn ghost" id="pp-bdel" type="button" style="color:#c0392b">Delete permanently</button><button class="fv-btn ghost" id="pp-bclr" type="button">Clear</button></div>` : ''}
      <div class="fr-wrap"><table class="fv-table"><thead><tr>${S ? '<th style="width:28px"><input type="checkbox" id="pp-all" title="Select all shown"></th>' : ''}<th>Name</th><th>Employee ID</th><th>Region</th><th>City</th><th>Group</th><th>Vehicle</th><th>Login</th><th>Status</th>${S ? '<th></th>' : ''}</tr></thead><tbody>
      ${rows.slice(0, 600).map(p => `<tr>${S ? `<td><input type="checkbox" data-sel="${h(p.id)}"${FR.sel && FR.sel.has(p.id) ? ' checked' : ''}${p.status === 'pending' ? ' disabled' : ''}></td>` : ''}<td>${h(p.full_name)}</td><td>${h(p.employee_id || '–')}</td><td>${h(nm(FR.d.regions, p.region_id))}</td><td>${h(nm(FR.d.cities, p.city_id) || '–')}</td><td>${h(nm(FR.d.groups, p.group_id) || '–')}</td><td>${h(nm(FR.d.vehicles, p.vehicle_type_id) || '–')}</td><td>${p.profile_id ? 'Yes' : '<span class="fr-hint">No</span>'}</td><td><span class="fr-pill ${ST[p.status][0]}">${ST[p.status][1]}</span></td>${S ? `<td style="text-align:right"><button class="fv-btn ghost" data-ed="${h(p.id)}" type="button">Edit</button></td>` : ''}</tr>`).join('') || `<tr><td colspan="${S ? 10 : 8}" class="fr-empty">${all.length ? 'Nobody matches these filters.' : S ? 'Nobody yet. Click "Add riders from roster" to start.' : 'Nobody in your regions yet.'}</td></tr>`}
      </tbody></table></div>${rows.length > 600 ? '<p class="fr-hint">Showing the first 600 — use the filters to narrow down.</p>' : ''}`;
    const redraw = () => pagePeople(main);
    if (S) {
      FR.sel = FR.sel || new Set();
      const ids = new Set(all.map(p => p.id)); [...FR.sel].forEach(i => { if (!ids.has(i)) FR.sel.delete(i); });
      const bar = main.querySelector('#pp-bulk'), upd = () => { bar.style.display = FR.sel.size ? 'flex' : 'none'; main.querySelector('#pp-n').textContent = FR.sel.size; };
      main.querySelectorAll('[data-sel]').forEach(c => c.onchange = () => { if (c.checked) FR.sel.add(c.dataset.sel); else FR.sel.delete(c.dataset.sel); upd(); });
      main.querySelector('#pp-all').onchange = (e) => { main.querySelectorAll('[data-sel]:not([disabled])').forEach(c => { c.checked = e.target.checked; if (c.checked) FR.sel.add(c.dataset.sel); else FR.sel.delete(c.dataset.sel); }); upd(); };
      main.querySelector('#pp-bclr').onclick = () => { FR.sel.clear(); redraw(); };
      main.querySelector('#pp-bedit').onclick = () => bulkEditModal([...FR.sel], () => { FR.sel.clear(); redraw(); });
      main.querySelector('#pp-bdel').onclick = () => bulkDeleteModal([...FR.sel], all, () => { FR.sel.clear(); redraw(); });
      upd();
    }
    main.querySelector('#f-r').onchange = (e) => { f.region = e.target.value; redraw(); };
    main.querySelector('#f-g').onchange = (e) => { f.group = e.target.value; redraw(); };
    main.querySelector('#f-s').onchange = (e) => { f.status = e.target.value; redraw(); };
    let tq; main.querySelector('#f-q').oninput = (e) => { clearTimeout(tq); tq = setTimeout(() => { f.q = e.target.value; redraw(); }, 350); };
    main.querySelector('#pp-csv').onclick = () => {
      if (!rows.length) { say('Nothing to download'); return; }
      downloadCSV('fuel-people.csv', toCSV(rows.map(p => ({ Name: p.full_name, 'Employee ID': p.employee_id || '', Region: nm(FR.d.regions, p.region_id), City: nm(FR.d.cities, p.city_id), Group: nm(FR.d.groups, p.group_id), Vehicle: nm(FR.d.vehicles, p.vehicle_type_id), Login: p.profile_id ? 'Yes' : 'No', Status: ST[p.status][1] }))));
    };
    const add = main.querySelector('#pp-add'); if (add) add.onclick = () => personModal(null, myRegions, redraw);
    main.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => personModal(all.find(p => p.id === b.dataset.ed), myRegions, redraw));
    main.querySelectorAll('[data-ap]').forEach(b => b.onclick = async () => { if ((await rpc('fr_decide_person', { p_id: b.dataset.ap, p_approve: true, p_note: null }, 'Approved')).ok) { redraw(); if (window.frPendingBadge) frPendingBadge(); } });
    main.querySelectorAll('[data-rj]').forEach(b => b.onclick = async () => { const n = prompt('Reason for rejecting (the requester will see it):', ''); if (n === null) return; if ((await rpc('fr_decide_person', { p_id: b.dataset.rj, p_approve: false, p_note: n }, 'Rejected')).ok) { redraw(); if (window.frPendingBadge) frPendingBadge(); } });
    const sy = main.querySelector('#pp-sync');
    if (sy) sy.onclick = () => {
      openModal(`<h2>Reload riders from roster</h2><p class="hint">Every rider on the roster who is missing from the fuel list is added, with the roster's region and city. Riders already on the list follow roster region changes. Nobody is removed.</p>
        <label style="display:flex;gap:8px;align-items:flex-start;margin:8px 0"><input type="checkbox" id="m-back" checked> <span>Also bring back riders who are still on the roster but were made <b>Inactive</b> or <b>Rejected</b> here</span></label>
        <div class="fr-f" style="margin:10px 0"><label>Group for the new riders</label><select id="m-g">${opts(FR.d.groups.filter(g => g.active), (FR.d.groups.find(g => /home sampling/i.test(g.name)) || {}).id, 'Choose later')}</select></div>
        <div class="fr-f" style="margin:10px 0"><label>Vehicle type for the new riders</label><select id="m-v">${opts(FR.d.vehicles.filter(v => v.active), (FR.d.vehicles[0] || {}).id, 'Choose later')}</select></div>
        <button class="btn-primary" id="m-s" type="button">Add riders</button>`);
      document.getElementById('m-s').onclick = async () => {
        const r = await rpc('fr_sync_roster', { p_group: document.getElementById('m-g').value || null, p_vehicle: document.getElementById('m-v').value || null, p_reactivate: document.getElementById('m-back').checked });
        if (r.ok) { closeModal(); const d = r.data || {}; say(`${d.added || 0} added, ${d.back || 0} brought back, ${d.moved || 0} moved to their roster region`); redraw(); }
      };
    };
  }
  function personModal(p, regions, done) {
    const S = sup(), isNew = !p || !p.id;
    p = (p && p.id) ? p : Object.assign({ full_name: '', employee_id: '', region_id: regions.length === 1 ? regions[0].id : '', city_id: '', group_id: '', vehicle_type_id: (FR.d.vehicles[0] || {}).id, note: '', status: 'active' }, p || {});
    const cities = (rid) => FR.d.cities.filter(c => c.region_id === rid);
    openModal(`<h2>${isNew ? (S ? 'Add person' : 'Request new person') : 'Edit person'}</h2>
      ${!S ? '<p class="hint">The Super Admin approves new people before they appear.</p>' : ''}
      ${p.profile_id ? '<p class="hint">This person has a FieldHub login (from the roster).</p>' : ''}
      ${!isNew ? '<p class="hint">Changes to region, city, group or vehicle count <b>from today onward</b>; earlier days keep the old values.</p>' : ''}
      <div class="two-col"><div class="fr-f" style="margin:8px 0"><label>Name *</label><input id="m-n" value="${h(p.full_name)}"></div>
      <div class="fr-f" style="margin:8px 0"><label>Employee ID</label><input id="m-e" value="${h(p.employee_id || '')}"></div></div>
      <div class="two-col"><div class="fr-f" style="margin:8px 0"><label>Region *</label><select id="m-r">${opts(regions, p.region_id, 'Choose…')}</select></div>
      <div class="fr-f" style="margin:8px 0"><label>City</label><select id="m-c">${opts(cities(p.region_id), p.city_id, '—')}</select></div></div>
      <div class="two-col"><div class="fr-f" style="margin:8px 0"><label>Group *</label><select id="m-g">${opts(FR.d.groups.filter(g => g.active || g.id === p.group_id), p.group_id, 'Choose…')}</select></div>
      <div class="fr-f" style="margin:8px 0"><label>Vehicle type</label><select id="m-v">${opts(FR.d.vehicles.filter(v => v.active || v.id === p.vehicle_type_id), p.vehicle_type_id, '—')}</select></div></div>
      ${!isNew && S ? `<div class="fr-f" style="margin:8px 0"><label>Status</label><select id="m-s"><option value="active">Active</option><option value="inactive"${p.status === 'inactive' ? ' selected' : ''}>Inactive (stops claiming; history kept)</option></select></div>
        <div class="fr-f" style="margin:8px 0"><label>Reason for this change (kept in the log)</label><input id="m-why"></div>` : ''}
      <div class="fr-f" style="margin:8px 0"><label>Note</label><input id="m-o" value="${h(p.note || '')}" placeholder="${S ? '' : 'e.g. new courier, joined 1 Dec'}"></div>
      <button class="btn-primary" id="m-save" type="button">${isNew && !S ? 'Send request' : 'Save'}</button>`);
    const r = document.getElementById('m-r'), c = document.getElementById('m-c');
    r.onchange = () => { c.innerHTML = opts(cities(r.value), '', '—'); };
    document.getElementById('m-save').onclick = async () => {
      const g = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
      const q = { id: p.id || '', full_name: g('m-n'), employee_id: g('m-e'), region_id: g('m-r'), city_id: g('m-c'), group_id: g('m-g'), vehicle_type_id: g('m-v'), note: g('m-o') };
      if (!isNew && S) { q.status = g('m-s'); q.reason = g('m-why'); }
      if (!q.full_name.trim()) { say('Please type the name'); return; }
      if (!q.region_id) { say('Please choose the region'); return; }
      if (!q.group_id) { say('Please choose the group'); return; }
      if ((await rpc('fr_save_person', { p: q }, isNew && !S ? 'Request sent to the Super Admin' : 'Saved')).ok) { closeModal(); done(); }
    };
  }

  // ---------------------------------------------------------------- Fuel People: edit / delete many at once
  function bulkEditModal(ids, done) {
    const keep = '— keep as it is —';
    openModal(`<h2>Edit ${ids.length} selected</h2><p class="hint">Only the boxes you change are applied to everyone selected. Every change is logged.</p>
      <div class="two-col"><div class="fr-f" style="margin:8px 0"><label>Region</label><select id="b-r">${opts(FR.d.regions, '', keep)}</select></div>
      <div class="fr-f" style="margin:8px 0"><label>City</label><select id="b-c" disabled><option value="">${keep}</option></select></div></div>
      <div class="two-col"><div class="fr-f" style="margin:8px 0"><label>Group</label><select id="b-g">${opts(FR.d.groups.filter(g => g.active), '', keep)}</select></div>
      <div class="fr-f" style="margin:8px 0"><label>Vehicle type</label><select id="b-v">${opts(FR.d.vehicles.filter(v => v.active), '', keep)}</select></div></div>
      <div class="fr-f" style="margin:8px 0"><label>Status</label><select id="b-s"><option value="">${keep}</option><option value="active">Active</option><option value="inactive">Inactive (stops claiming; history kept)</option></select></div>
      <div class="fr-f" style="margin:8px 0"><label>Reason (kept in the log)</label><input id="b-why"></div>
      <button class="btn-primary" id="b-go" type="button">Apply to ${ids.length}</button>`);
    const r = document.getElementById('b-r'), c = document.getElementById('b-c');
    r.onchange = () => { c.disabled = !r.value; c.innerHTML = r.value ? opts(FR.d.cities.filter(x => x.region_id === r.value), '', '— no city —') : `<option value="">${keep}</option>`; };
    document.getElementById('b-go').onclick = async () => {
      const p = {}; if (r.value) { p.region_id = r.value; p.city_id = c.value; }
      ['g:group_id', 'v:vehicle_type_id', 's:status'].forEach(k => { const [id, f] = k.split(':'); const v = document.getElementById('b-' + id).value; if (v) p[f] = v; });
      if (!Object.keys(p).length) { say('Change at least one box'); return; }
      p.reason = document.getElementById('b-why').value;
      const res = await rpc('fr_people_bulk_update', { p_ids: ids, p });
      if (res.ok) { closeModal(); say(res.data + ' person(s) updated'); done(); }
    };
  }
  function bulkDeleteModal(ids, all, done) {
    const names = all.filter(p => ids.includes(p.id)).map(p => p.full_name + (p.employee_id ? ' (' + p.employee_id + ')' : ''));
    openModal(`<h2 style="color:#c0392b">Delete ${ids.length} permanently?</h2>
      <p>This removes them from the fuel list <b>together with all their readings and monthly entries</b>. It cannot be undone (a copy is kept in the Change log). If they only stopped working, use <b>Edit selected → Status: Inactive</b> instead.</p>
      <div class="fr-hint" style="max-height:120px;overflow:auto;margin:8px 0">${names.map(h).join('<br>')}</div>
      <div class="fr-f" style="margin:8px 0"><label>Reason *</label><input id="d-why"></div>
      <div class="fr-f" style="margin:8px 0"><label>Type DELETE to confirm</label><input id="d-ok" autocomplete="off"></div>
      <button class="btn-primary" id="d-go" type="button" style="background:#c0392b">Delete permanently</button>`);
    document.getElementById('d-go').onclick = async () => {
      if (document.getElementById('d-ok').value.trim().toUpperCase() !== 'DELETE') { say('Type DELETE to confirm'); return; }
      const why = document.getElementById('d-why').value.trim(); if (!why) { say('Please type a reason'); return; }
      const res = await rpc('fr_people_delete', { p_ids: ids, p_reason: why });
      if (res.ok) { closeModal(); const d = res.data || {}; say(`${d.people || 0} person(s) deleted (${d.readings || 0} readings, ${d.monthly || 0} monthly entries)`); done(); }
    };
  }

  // =====================================================================================
  // v98 helpers
  // =====================================================================================
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  function pkToday() { try { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Karachi' }); } catch (_e) { return ymd(new Date()); } }
  function addDays(s, n) { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); }
  function cycleStart(dayStr) {
    const S = (FR.d && FR.d.settings && FR.d.settings.cycle_start_day) || 16, d = new Date(dayStr + 'T00:00:00');
    if (d.getDate() >= S) return ymd(new Date(d.getFullYear(), d.getMonth(), S));
    return ymd(new Date(d.getFullYear(), d.getMonth() - 1, S));
  }
  function cycleEnd(start) { const d = new Date(start + 'T00:00:00'); return ymd(new Date(d.getFullYear(), d.getMonth() + 1, d.getDate() - 1)); }
  function cycleDays(start) { const out = []; let x = start; const e = cycleEnd(start); while (x <= e) { out.push(x); x = addDays(x, 1); } return out; }
  const fmtDay = (s) => { const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }); };
  const cycLabel = (st) => { const e = cycleEnd(st); const f = (x) => new Date(x + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); return f(st) + ' – ' + f(e) + ' ' + e.slice(0, 4); };
  const num = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 }));
  const driveLink = (id) => id === 'failed' ? '#' : 'https://drive.google.com/file/d/' + encodeURIComponent(id) + '/view';
  const photoA = (id, label) => !id ? '' : id === 'failed' ? `<span class="fr-pill o" title="The picture could not be saved in Google Drive">${h(label)}: not saved</span>` : `<a href="${driveLink(id)}" target="_blank" rel="noopener">${h(label)}</a>`;
  const errText = (e) => em(e).replace(/^.*?:\s*(?=[A-Z])/, '');

  async function readSheet(file) {
    if (typeof ensureXLSX === 'function') await ensureXLSX();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { defval: '', raw: false }).map(r => { const o = {}; Object.keys(r).forEach(k => { o[String(k).trim().toLowerCase()] = String(r[k]).trim(); }); return o; });
  }
  function pick(row, names) { for (const n of names) { if (row[n] != null && row[n] !== '') return row[n]; } return ''; }

  // shrink a camera picture to a small JPEG (about 15–25 KB)
  // A meter picture: must be taken just now with the camera (not an old gallery photo), must not be blank or
  // completely dark, and gets a stamp (name / ID, date and time) burnt in, so it can't be reused for another day.
  // It cannot prove that the picture shows a meter — the reviewer sees every picture next to the reading.
  function shrinkPhoto(file, stamp) {
    return new Promise((res, rej) => {
      if (!/^image\//.test(file.type || 'image/')) { rej(new Error('That file is not a picture')); return; }
      if (file.lastModified && Date.now() - file.lastModified > 15 * 60000) { rej(new Error('Please take a NEW photo of the meter with the camera now. Old photos from the gallery are not accepted.')); return; }
      const url = URL.createObjectURL(file), img = new Image();
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('That file is not a picture')); };
      img.onload = () => {
        URL.revokeObjectURL(url);
        // blank / dark check on a small copy
        try {
          const t = document.createElement('canvas'); t.width = 64; t.height = 64; const tc = t.getContext('2d'); tc.drawImage(img, 0, 0, 64, 64);
          const d = tc.getImageData(0, 0, 64, 64).data; let sum = 0, sq = 0; const n = d.length / 4;
          for (let i = 0; i < d.length; i += 4) { const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; sum += y; sq += y * y; }
          const mean = sum / n, sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
          if (mean < 22) { rej(new Error('The picture is too dark. Please take it again in better light.')); return; }
          if (sd < 10) { rej(new Error('The picture looks blank. Please take a clear photo of the meter.')); return; }
        } catch (_e) {}
        let w = img.width, hh = img.height; const M = 720; if (w > M || hh > M) { const k = M / Math.max(w, hh); w = Math.round(w * k); hh = Math.round(hh * k); }
        const c = document.createElement('canvas'); c.width = w; c.height = hh; const cx = c.getContext('2d'); cx.drawImage(img, 0, 0, w, hh);
        if (stamp) {
          const fs = Math.max(12, Math.round(w / 34)); cx.font = `600 ${fs}px system-ui, sans-serif`;
          cx.fillStyle = 'rgba(0,0,0,.6)'; cx.fillRect(0, hh - fs * 1.9, w, fs * 1.9);
          cx.fillStyle = '#fff'; cx.textBaseline = 'middle'; cx.fillText(stamp, Math.round(fs * 0.6), hh - fs * 0.95, w - fs);
        }
        let q = 0.6, out = c.toDataURL('image/jpeg', q);
        while (out.length > 34000 && q > 0.2) { q -= 0.08; out = c.toDataURL('image/jpeg', q); }
        if (out.length > 34000) { const c2 = document.createElement('canvas'); c2.width = Math.round(w * 0.7); c2.height = Math.round(hh * 0.7); c2.getContext('2d').drawImage(c, 0, 0, c2.width, c2.height); out = c2.toDataURL('image/jpeg', 0.5); }
        res(out);
      };
      img.src = url;
    });
  }

  // =====================================================================================
  // Settings: KM per visit by city (Home Sampling and Home Care separately)
  // =====================================================================================
  async function tVisit(body) {
    const vg = FR.d.groups.filter(g => g.visit_based && g.active);
    if (!vg.length) { body.innerHTML = '<div class="fr-card fr-empty">No visit-based groups yet. On the Groups tab, mark Home Sampling and Home Care as visit-based.</div>'; return; }
    body.innerHTML = '<p class="fr-hint">Loading…</p>';
    const { data, error } = await sb.from('fr_visit_limits').select('*');
    if (error) { body.innerHTML = `<div class="fr-card fr-empty">${notReady(error) ? 'Please run <b>migration_70.sql</b> first.' : h(em(error))}</div>`; return; }
    const lim = {}; (data || []).forEach(l => { lim[l.city_id + '|' + l.group_id] = l.max_km_per_visit; });
    const regSel = FR.vreg || '';
    const cities = FR.d.cities.filter(c => !regSel || c.region_id === regSel).sort((a, b) => (nm(FR.d.regions, a.region_id) + a.name).localeCompare(nm(FR.d.regions, b.region_id) + b.name));
    body.innerHTML = `<div class="fr-tb"><select id="v-reg"><option value="">All regions</option>${opts(FR.d.regions, regSel)}</select>
        <span class="fv-note">Empty box = the group's default (${vg.map(g => h(g.name) + ': ' + (g.max_km_per_visit == null ? 'not set' : h(g.max_km_per_visit))).join(', ')}).</span><span style="flex:1"></span>
        <button class="fv-btn ghost" id="v-tpl" type="button">Template</button><button class="fv-btn ghost" id="v-up" type="button">⬆ Upload Excel / CSV</button><button class="fv-btn" id="v-save" type="button">Save changes</button></div>
      <div class="fr-wrap"><table class="fv-table"><thead><tr><th>City</th><th>Region</th>${vg.map(g => `<th class="fr-n">${h(g.name)}<br><span style="font-weight:400;font-size:11px">KM per visit</span></th>`).join('')}</tr></thead><tbody>
      ${cities.map(c => `<tr><td>${h(c.name)}</td><td>${h(nm(FR.d.regions, c.region_id))}</td>${vg.map(g => `<td class="fr-n"><input type="number" step="0.1" min="0" data-c="${h(c.id)}" data-g="${h(g.id)}" data-o="${h(lim[c.id + '|' + g.id] == null ? '' : lim[c.id + '|' + g.id])}" value="${h(lim[c.id + '|' + g.id] == null ? '' : lim[c.id + '|' + g.id])}" placeholder="${h(g.max_km_per_visit == null ? '' : g.max_km_per_visit)}" style="width:90px;padding:6px;border:1px solid #d6daec;border-radius:8px;text-align:right"></td>`).join('')}</tr>`).join('') || `<tr><td colspan="${2 + vg.length}" class="fr-empty">No cities yet. Add them on the Regions tab (bulk upload).</td></tr>`}
      </tbody></table></div>`;
    body.querySelector('#v-reg').onchange = (e) => { FR.vreg = e.target.value; tVisit(body); };
    body.querySelector('#v-save').onclick = async () => {
      const rows = [...body.querySelectorAll('input[data-c]')].filter(i => i.value.trim() !== i.dataset.o).map(i => ({ city_id: i.dataset.c, group_id: i.dataset.g, km: i.value.trim() }));
      if (!rows.length) { say('Nothing changed'); return; }
      if ((await rpc('fr_save_visit_limits', { p_rows: rows }, rows.length + ' value(s) saved')).ok) tVisit(body);
    };
    body.querySelector('#v-tpl').onclick = () => downloadCSV('km-per-visit-template.csv', toCSV(FR.d.cities.map(c => { const o = { City: c.name, Region: nm(FR.d.regions, c.region_id) }; vg.forEach(g => { o[g.name] = lim[c.id + '|' + g.id] == null ? '' : lim[c.id + '|' + g.id]; }); return o; })));
    body.querySelector('#v-up').onclick = () => {
      openModal(`<h2>Upload KM per visit</h2><p class="hint">Excel (.xlsx) or CSV with columns <b>City</b>, <b>Region</b> (helps when two cities share a name) and one column per group: ${vg.map(g => '<b>' + h(g.name) + '</b>').join(', ')}. Use "Template" to get the file with all your cities. The file itself is not stored.</p>
        <div class="form-row"><input type="file" id="m-f" accept=".xlsx,.xls,.csv"></div><div id="m-prev"></div><button class="btn-primary" id="m-s" type="button" disabled>Save</button>`);
      let ready = [];
      document.getElementById('m-f').onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try {
          const rows = await readSheet(f); const warn = []; ready = [];
          rows.forEach((r, i) => {
            const cn = pick(r, ['city', 'city name']).toLowerCase(), rn = pick(r, ['region', 'region name']).toLowerCase();
            const cands = FR.d.cities.filter(c => c.name.trim().toLowerCase() === cn && (!rn || nm(FR.d.regions, c.region_id).trim().toLowerCase() === rn));
            if (!cn) return; if (!cands.length) { warn.push(`Row ${i + 2}: city "${pick(r, ['city', 'city name'])}" not found`); return; }
            if (cands.length > 1) { warn.push(`Row ${i + 2}: "${pick(r, ['city'])}" is in more than one region — add the Region column`); return; }
            vg.forEach(g => { const v = r[g.name.trim().toLowerCase()]; if (v != null && v !== '') { if (isNaN(+v)) warn.push(`Row ${i + 2}: ${g.name} "${v}" is not a number`); else ready.push({ city_id: cands[0].id, group_id: g.id, km: String(+v) }); } });
          });
          document.getElementById('m-prev').innerHTML = `<p><b>${ready.length}</b> value(s) ready${warn.length ? `, <b>${warn.length}</b> skipped` : ''}.</p>${warn.length ? `<div class="fr-hint" style="max-height:140px;overflow:auto">${warn.map(h).join('<br>')}</div>` : ''}`;
          document.getElementById('m-s').disabled = !ready.length;
        } catch (err) { say('Could not read the file: ' + em(err)); }
      };
      document.getElementById('m-s').onclick = async () => { if ((await rpc('fr_save_visit_limits', { p_rows: ready }, 'Saved')).ok) { closeModal(); tVisit(body); } };
    };
  }

  // =====================================================================================
  // Settings: bulk regions & cities
  // =====================================================================================
  function bulkRegionsModal() {
    openModal(`<h2>Bulk upload regions & cities</h2>
      <p class="hint">Excel (.xlsx) or CSV with two columns: <b>Region</b> and <b>City</b> (one row per city). New regions and cities are added; existing ones (same name, any capitals) are left as they are. Nothing is renamed or removed. The file itself is not stored.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0"><button class="btn outline" id="m-t" type="button">Download template</button></div>
      <div class="form-row"><input type="file" id="m-f" accept=".xlsx,.xls,.csv"></div><div id="m-prev"></div>
      <button class="btn-primary" id="m-s" type="button" disabled>Add them</button>`);
    let rows = [];
    document.getElementById('m-t').onclick = () => downloadCSV('regions-cities-template.csv', toCSV([{ Region: 'Lahore North', City: 'Lahore' }, { Region: 'Karachi', City: 'Clifton' }]));
    document.getElementById('m-f').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        rows = (await readSheet(f)).map(r => ({ region: pick(r, ['region', 'region name']), city: pick(r, ['city', 'city name', 'sub-region', 'sub region']) })).filter(r => r.region);
        const exR = new Set(FR.d.regions.map(r => r.name.trim().toLowerCase()));
        const newR = new Set(rows.filter(r => !exR.has(r.region.toLowerCase())).map(r => r.region.toLowerCase()));
        const newC = rows.filter(r => r.city && !FR.d.cities.some(c => c.name.trim().toLowerCase() === r.city.toLowerCase() && nm(FR.d.regions, c.region_id).trim().toLowerCase() === r.region.toLowerCase())).length;
        document.getElementById('m-prev').innerHTML = `<p><b>${rows.length}</b> row(s) read: about <b>${newR.size}</b> new region(s) and <b>${newC}</b> new city/cities. The rest already exist.</p>`;
        document.getElementById('m-s').disabled = !rows.length;
      } catch (err) { say('Could not read the file: ' + em(err)); }
    };
    document.getElementById('m-s').onclick = async () => {
      const r = await rpc('fr_bulk_regions', { p_rows: rows });
      if (!r.ok) return;
      const d = r.data || {}; closeModal();
      say(`${d.new_regions || 0} region(s) and ${d.new_cities || 0} city/cities added${(d.warnings || []).length ? ', ' + d.warnings.length + ' skipped' : ''}`);
      load(true).then(() => { FR.tab = 'regions'; pageSettings(document.getElementById('main-content')); });
    };
  }

  // =====================================================================================
  // Settings: create a Fuel-only login (Area Lead, Regional Lead, Admin Officer, Courier Manager…)
  // =====================================================================================
  function newLoginModal(done) {
    openModal(`<h2>Create Fuel login</h2>
      <p class="hint">For people who are not in FieldHub yet (e.g. Area Leads, Regional Leads, Admin Officers of other regions). They sign in with their mobile number and see <b>only</b> the Fuel Reimbursement pages you allow on the next screen. They set up Google Authenticator the first time.</p>
      <div class="two-col"><div class="fr-f" style="margin:8px 0"><label>Full name *</label><input id="m-n"></div>
      <div class="fr-f" style="margin:8px 0"><label>Mobile number (login) *</label><input id="m-p" maxlength="11" placeholder="03XXXXXXXXX"></div></div>
      <div class="two-col"><div class="fr-f" style="margin:8px 0"><label>Password (at least 6) *</label><input id="m-w" type="text" minlength="6"></div>
      <div class="fr-f" style="margin:8px 0"><label>Employee ID</label><input id="m-e"></div></div>
      <div class="fr-f" style="margin:8px 0"><label>Main region</label><select id="m-r">${opts(FR.d.regions, '', '—')}</select></div>
      <button class="btn-primary" id="m-s" type="button">Create login</button> <span id="m-st" class="hint"></span>`);
    document.getElementById('m-s').onclick = async () => {
      const g = (id) => document.getElementById(id).value.trim(), st = document.getElementById('m-st');
      const name = typeof toProperCase === 'function' ? toProperCase(g('m-n')) : g('m-n');
      const phone = typeof toE164 === 'function' ? toE164(g('m-p')) : g('m-p'), pw = document.getElementById('m-w').value;
      if (!name) { say('Please type the name'); return; }
      if (!phone) { say('Please type a valid mobile number'); return; }
      if (pw.length < 6) { say('Password must be at least 6 characters'); return; }
      st.textContent = 'Creating…'; document.getElementById('m-s').disabled = true;
      try {
        const tmp = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'fh-tmp-fuel' } });
        const { data, error } = await tmp.auth.signUp({ phone, password: pw, options: { data: { full_name: name, requested_role: 'coordinator' } } });
        if (error || !data || !data.user) throw new Error(error ? error.message : 'unknown problem');
        const uid = data.user.id; let last = null;
        for (let i = 0; i < 6; i++) {
          const r = await sb.rpc('fr_make_fuel_login', { p_user: uid, p_name: name, p_emp: g('m-e') || ('FL' + phone.replace(/\D/g, '').slice(-8)), p_region: g('m-r') || null });
          if (!r.error) { last = null; break; } last = r.error; await new Promise(z => setTimeout(z, 1200));
        }
        if (last) throw last;
        closeModal(); say(`Login created for ${name}. Now tick their regions and what they may do.`); done(uid);
      } catch (err) { st.textContent = ''; document.getElementById('m-s').disabled = false; say('Could not create: ' + errText(err)); }
    };
  }

  // =====================================================================================
  // Saving one reading (shared by riders and staff): handles "type again" and "send for check"
  // =====================================================================================
  async function saveReading(person, day, kind, value, photo, opts2) {
    opts2 = opts2 || {};
    const { data, error } = await sb.rpc('fr_save_reading', { p_person: person, p_day: day, p_kind: kind, p_value: value, p_photo: photo || null, p_confirm: !!opts2.confirm, p_reason: opts2.reason || null });
    if (!error) return data;
    const m = em(error);
    if (m.includes('DIGITS|')) {
      const again = prompt(m.split('DIGITS|')[1] + '\n\nType the reading again:', '');
      if (again === null) return null;
      if (String(+again) !== String(+value)) { say('The two readings do not match. Nothing was saved.'); return null; }
      return saveReading(person, day, kind, value, photo, Object.assign({}, opts2, { confirm: true }));
    }
    if (m.includes('CHECK|')) {
      const why = m.split('CHECK|')[1];
      const go = confirm(why + '\n\nPress Cancel to change the reading.\nPress OK if your reading is really correct (e.g. meter replaced, long trip) — it will be sent to your Area Incharge for a check.');
      if (!go) return null;
      const reason = prompt('Why is this reading correct? (e.g. meter replaced, bike changed, long trip)', '');
      if (!reason || !reason.trim()) { say('A reason is needed. Nothing was saved.'); return null; }
      return saveReading(person, day, kind, value, photo, Object.assign({}, opts2, { reason: reason.trim(), confirm: true }));
    }
    say(errText(error).replace(/^.*\|/, '')); return null;
  }

  // =====================================================================================
  // RIDER: My Fuel Readings (no authenticator code needed)
  // =====================================================================================
  async function pageMy(main) {
    const me = window.__frMe;
    if (!me) { main.innerHTML = '<div class="fr-card fr-empty">You are not on the fuel list yet. Please ask your Area Incharge.</div>'; return; }
    const today = pkToday(), cs = cycleStart(today), back = FR.d.settings.back_days == null ? 2 : FR.d.settings.back_days;
    const { data: rows, error } = await sb.from('fr_readings').select('*').eq('person_id', me.id).gte('day', addDays(cs, -1)).order('day');
    if (error) { main.innerHTML = `<div class="fr-card fr-empty">${notReady(error) ? 'Daily readings are not switched on yet (migration_70).' : h(em(error))}</div>`; return; }
    let rule = 'optional'; try { const r = await sb.rpc('fr_photo_rule_for', { p_person: me.id }); if (!r.error && r.data) rule = r.data; } catch (_e) {}
    const by = {}; (rows || []).forEach(r => { by[r.day] = r; });
    const days = cycleDays(cs).filter(d => d <= today).reverse();
    const km = (r) => r && r.opening != null && r.closing != null ? r.closing - r.opening : null;
    const total = days.reduce((t, d) => t + (km(by[d]) || 0), 0);
    const missing = days.filter(d => d < today && !(by[d] && by[d].opening != null && by[d].closing != null)).length;
    const t = by[today] || {};
    const photoBtn = (k) => rule === 'off' ? '' : `<label class="fv-btn ghost" style="cursor:pointer;margin:0">📷 ${rule === 'required' ? 'Picture *' : 'Picture'}<input type="file" accept="image/*" capture="environment" data-ph="${k}" hidden></label><span class="fr-hint" data-phs="${k}"></span>`;
    main.innerHTML = `<p class="fv-sub">Fuel cycle ${h(cycLabel(cs))}. Add your meter reading when you start (Opening) and when you finish (Closing) every day.</p>
      <div class="fr-grid" style="margin-bottom:12px">
        <div class="fr-card" style="margin:0"><div class="fr-hint">KM this cycle</div><div style="font-size:26px;font-weight:700;color:#1E2A6E">${num(total)}</div></div>
        <div class="fr-card" style="margin:0"><div class="fr-hint">Days missing</div><div style="font-size:26px;font-weight:700;color:${missing ? '#c0392b' : '#2e7d4f'}">${missing}</div></div>
      </div>
      <div class="fr-card"><h4>Today — ${h(fmtDay(today))}</h4><div class="fr-grid">
        <div class="fr-f"><label>Opening reading</label><input id="my-o" type="number" inputmode="decimal" value="${h(t.opening == null ? '' : t.opening)}" placeholder="e.g. 5030"><div style="display:flex;gap:6px;align-items:center;margin-top:6px">${photoBtn('o')}<button class="fv-btn" id="my-so" type="button" style="margin-left:auto">Save Opening</button></div></div>
        <div class="fr-f"><label>Closing reading</label><input id="my-c" type="number" inputmode="decimal" value="${h(t.closing == null ? '' : t.closing)}" placeholder="${t.opening == null ? 'Add Opening first' : 'more than ' + num(t.opening)}"${t.opening == null ? ' disabled' : ''}><div style="display:flex;gap:6px;align-items:center;margin-top:6px">${photoBtn('c')}<button class="fv-btn" id="my-sc" type="button" style="margin-left:auto"${t.opening == null ? ' disabled' : ''}>Save Closing</button></div></div>
      </div>${t.status === 'check' ? `<p class="fr-hint" style="color:#a0672b;margin-top:8px">⏳ Waiting for a check: ${h(t.check_note || '')}</p>` : ''}</div>
      <div class="fr-card"><h4>This cycle</h4><p class="fr-hint">You can fill in or fix the last ${back} day(s). Older days are locked — ask your Area Incharge.</p>
      <div class="fr-wrap" style="margin-top:8px"><table class="fv-table"><thead><tr><th>Day</th><th class="fr-n">Opening</th><th class="fr-n">Closing</th><th class="fr-n">KM</th><th></th></tr></thead><tbody>
      ${days.map(d => { const r = by[d], k = km(r), open = d >= addDays(today, -back); return `<tr><td>${h(fmtDay(d))}</td><td class="fr-n">${r && r.opening != null ? num(r.opening) : '<span class="fr-pill r">missing</span>'}</td><td class="fr-n">${r && r.closing != null ? num(r.closing) : (r && r.opening != null ? '<span class="fr-pill o">missing</span>' : '–')}</td><td class="fr-n">${k == null ? '–' : num(k)}${r && r.status === 'check' ? ' <span class="fr-pill o">check</span>' : ''}</td><td style="text-align:right">${open && d !== today ? `<button class="fv-btn ghost" data-day="${d}" type="button">Fill in</button>` : ''}</td></tr>`; }).join('')}
      </tbody></table></div></div>`;
    const photos = { o: null, c: null };
    main.querySelectorAll('[data-ph]').forEach(inp => inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return; const k = inp.dataset.ph, st = main.querySelector(`[data-phs="${k}"]`);
      st.textContent = 'Preparing…';
      try { photos[k] = await shrinkPhoto(f, `${me.full_name} · ${me.employee_id || ''} · ${k === 'o' ? 'Opening' : 'Closing'} · ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })}`); st.textContent = '✓ picture ready'; } catch (e) { photos[k] = null; st.textContent = ''; say(em(e)); }
    });
    const upload = async (k, day) => {
      if (!photos[k]) return null;
      if (!window.frDrive) return null;
      const j = await window.frDrive('photo', { data: photos[k], cycle: cs, region: nm(FR.d.regions, me.region_id) || 'No region', name: (me.employee_id || me.id) + '_' + day + '_' + (k === 'o' ? 'opening' : 'closing') });
      return j.id;
    };
    const go = async (kind, day, value, photoKey, btn) => {
      if (value === '' || isNaN(+value)) { say('Please type the meter reading (numbers only)'); return; }
      if (photoKey && rule === 'required' && !photos[photoKey]) { say('Please add a picture of the meter'); return; }
      if (kind === 'close') { const o = (by[day] || {}).opening; if (o != null && +value > o && !confirm(`Today you covered ${num(+value - o)} KM.\n\nSave Closing ${num(+value)}?`)) return; }
      btn.disabled = true; const old = btn.textContent; btn.textContent = 'Saving…';
      try {
        let pid = null;
        if (photoKey && photos[photoKey]) { try { pid = await upload(photoKey, day); } catch (e) { pid = rule === 'required' ? 'failed' : null; say('The picture could not be saved in Google Drive (' + em(e) + '). Your reading is saved without it.'); } }
        const r = await saveReading(me.id, day, kind, +value, pid);
        if (r) { say(r.status === 'check' ? 'Saved and sent for a check' : 'Saved ✓'); pageMy(main); }
      } finally { btn.disabled = false; btn.textContent = old; }
    };
    main.querySelector('#my-so').onclick = (e) => go('open', today, main.querySelector('#my-o').value.trim(), 'o', e.target);
    main.querySelector('#my-sc').onclick = (e) => go('close', today, main.querySelector('#my-c').value.trim(), 'c', e.target);
    main.querySelectorAll('[data-day]').forEach(b => b.onclick = () => readingModal(me.id, b.dataset.day, by[b.dataset.day] || {}, () => pageMy(main)));
  }

  // a small window to fill in / fix one day (rider for the last days, staff with "enter" rights for any day of the open cycles)
  function readingModal(person, day, r, done, who) {
    openModal(`<h2>${h(fmtDay(day))}</h2>${who ? `<p class="hint">${h(who)}</p>` : ''}
      <div class="two-col"><div class="fr-f" style="margin:8px 0"><label>Opening</label><input id="m-o" type="number" inputmode="decimal" value="${h(r.opening == null ? '' : r.opening)}"></div>
      <div class="fr-f" style="margin:8px 0"><label>Closing</label><input id="m-c" type="number" inputmode="decimal" value="${h(r.closing == null ? '' : r.closing)}"></div></div>
      ${r.open_photo || r.close_photo ? `<p class="hint">${photoA(r.open_photo, 'Opening picture')} ${r.close_photo ? ' · ' + photoA(r.close_photo, 'Closing picture') : ''}</p>` : ''}
      ${r.status === 'check' ? `<p class="hint" style="color:#a0672b">⏳ ${h(r.check_note || '')}</p>` : ''}
      <button class="btn-primary" id="m-s" type="button">Save</button>`);
    document.getElementById('m-s').onclick = async () => {
      const o = document.getElementById('m-o').value.trim(), c = document.getElementById('m-c').value.trim();
      if (o === '' && c === '') { say('Type at least the Opening'); return; }
      if (o !== '' && String(+o) !== String(r.opening == null ? '' : +r.opening)) { const x = await saveReading(person, day, 'open', +o, null); if (!x) return; r.opening = +o; }
      if (c !== '' && String(+c) !== String(r.closing == null ? '' : +r.closing)) { const x = await saveReading(person, day, 'close', +c, null); if (!x) return; }
      closeModal(); say('Saved ✓'); done();
    };
  }

  // =====================================================================================
  // STAFF: Daily readings (grid per cycle) + "Needs check"
  // =====================================================================================
  async function pageDaily(main) {
    const S = sup(), A = FR.d.myAccess || {}, f = FR.df, today = pkToday();
    const cur = cycleStart(today), cycles = [cur, cycleStart(addDays(cur, -1)), cycleStart(addDays(cycleStart(addDays(cur, -1)), -1))];
    if (!f.cycle) f.cycle = cur;
    const days = cycleDays(f.cycle), end = days[days.length - 1];
    main.innerHTML = '<p class="fr-hint">Loading…</p>';
    let people = await fvFetchAll(() => sb.from('fr_people').select('*').eq('status', 'active').not('profile_id', 'is', null).order('full_name').order('id'));
    const myRegions = S ? FR.d.regions : FR.d.regions.filter(r => (A.regions || []).includes(r.id));
    people = people.filter(p => (!f.region || p.region_id === f.region) && (!f.group || p.group_id === f.group) && (!f.q || (p.full_name + ' ' + (p.employee_id || '')).toLowerCase().includes(f.q.toLowerCase())));
    const { data: rd, error } = await sb.from('fr_readings').select('*').gte('day', f.cycle).lte('day', end).limit(50000);
    if (error) { main.innerHTML = `<div class="fr-card fr-empty">${notReady(error) ? 'Please run <b>migration_70.sql</b> first.' : h(em(error))}</div>`; return; }
    const by = {}; (rd || []).forEach(r => { by[r.person_id + '|' + r.day] = r; });
    const checks = (rd || []).filter(r => r.status === 'check');
    const pById = {}; people.forEach(p => { pById[p.id] = p; });
    const canEnter = (p) => S || (A.can_enter && (A.regions || []).includes(p.region_id) && (!(A.groups || []).length || A.groups.includes(p.group_id)));
    const canReview = S || A.can_review;
    const shown = days.filter(d => d <= today);
    const cell = (p, d) => {
      const r = by[p.id + '|' + d];
      if (!r || r.opening == null) return `<td class="fr-n" data-cell="${h(p.id)}|${d}" style="background:#fdeceb;cursor:pointer" title="missing">·</td>`;
      if (r.closing == null) return `<td class="fr-n" data-cell="${h(p.id)}|${d}" style="background:#fff3df;cursor:pointer" title="Opening ${num(r.opening)} · no Closing">${r.status === 'check' ? '⚠' : '½'}</td>`;
      return `<td class="fr-n" data-cell="${h(p.id)}|${d}" style="cursor:pointer;${r.status === 'check' ? 'background:#fff3df' : ''}" title="${num(r.opening)} → ${num(r.closing)}">${r.status === 'check' ? '⚠' : ''}${num(r.closing - r.opening)}</td>`;
    };
    const tot = (p) => shown.reduce((t, d) => { const r = by[p.id + '|' + d]; return t + (r && r.opening != null && r.closing != null ? r.closing - r.opening : 0); }, 0);
    const miss = (p) => shown.filter(d => d < today && !(by[p.id + '|' + d] && by[p.id + '|' + d].closing != null)).length;
    main.innerHTML = `<p class="fv-sub">Daily KM per rider (Closing − Opening). Red = missing, ½ = no Closing, ⚠ = waiting for a check. Click a day to see the readings${S || A.can_enter ? ' or fix them' : ''}.</p>
      ${checks.length && canReview ? `<div class="fr-card" style="border-color:#f3d9a8"><h4>⚠ Waiting for a check (${checks.length})</h4><div class="fr-wrap"><table class="fv-table"><thead><tr><th>Rider</th><th>Day</th><th class="fr-n">Opening</th><th class="fr-n">Closing</th><th>Problem and reason</th><th></th></tr></thead><tbody>
        ${checks.map(r => { const p = pById[r.person_id] || {}; return `<tr><td>${h(p.full_name || '')}</td><td>${h(fmtDay(r.day))}</td><td class="fr-n">${num(r.opening)}</td><td class="fr-n">${num(r.closing)}</td><td style="max-width:360px">${h(r.check_note || '')}${r.open_photo ? ' ' + photoA(r.open_photo, 'picture') : ''}${r.close_photo ? ' ' + photoA(r.close_photo, 'picture') : ''}</td><td style="white-space:nowrap;text-align:right"><button class="fv-btn" data-ok="${h(r.id)}" type="button">Approve</button> <button class="fv-btn ghost" data-no="${h(r.id)}" type="button" style="color:#c0392b">Clear</button></td></tr>`; }).join('')}
        </tbody></table></div></div>` : ''}
      <div class="fr-tb">
        <select id="d-c">${cycles.map(c => `<option value="${c}"${c === f.cycle ? ' selected' : ''}>${h(cycLabel(c))}</option>`).join('')}</select>
        <select id="d-r"><option value="">All my regions</option>${opts(myRegions, f.region)}</select>
        <select id="d-g"><option value="">All groups</option>${opts(FR.d.groups, f.group)}</select>
        <input id="d-q" placeholder="Search name / ID" value="${h(f.q)}">
        <span style="flex:1"></span><button class="fv-btn ghost" id="d-csv" type="button">Download (CSV)</button>
      </div>
      <div class="fr-wrap"><table class="fv-table" style="font-size:12px"><thead><tr><th>Rider</th><th class="fr-n">KM</th><th class="fr-n">Missing</th>${shown.map(d => `<th class="fr-n" style="padding:6px 4px">${d.slice(8)}</th>`).join('')}</tr></thead><tbody>
      ${people.map(p => `<tr><td style="white-space:nowrap">${h(p.full_name)}<div class="fr-hint" style="margin:0">${h(p.employee_id || '')} · ${h(nm(FR.d.regions, p.region_id))}</div></td><td class="fr-n"><b>${num(tot(p))}</b></td><td class="fr-n">${miss(p) ? `<span class="fr-pill r">${miss(p)}</span>` : '0'}</td>${shown.map(d => cell(p, d)).join('')}</tr>`).join('') || `<tr><td colspan="${3 + shown.length}" class="fr-empty">No riders with a login in this selection.</td></tr>`}
      </tbody></table></div>
      <p class="fr-hint">People without a login (couriers etc.) are entered monthly on the "Monthly entry" page.</p>`;
    const redraw = () => pageDaily(main);
    main.querySelector('#d-c').onchange = (e) => { f.cycle = e.target.value; redraw(); };
    main.querySelector('#d-r').onchange = (e) => { f.region = e.target.value; redraw(); };
    main.querySelector('#d-g').onchange = (e) => { f.group = e.target.value; redraw(); };
    let tq; main.querySelector('#d-q').oninput = (e) => { clearTimeout(tq); tq = setTimeout(() => { f.q = e.target.value; redraw(); }, 400); };
    main.querySelector('#d-csv').onclick = () => {
      const out = []; people.forEach(p => shown.forEach(d => { const r = by[p.id + '|' + d] || {}; out.push({ Rider: p.full_name, 'Employee ID': p.employee_id || '', Region: nm(FR.d.regions, p.region_id), Group: nm(FR.d.groups, p.group_id), Day: d, Opening: r.opening == null ? '' : r.opening, Closing: r.closing == null ? '' : r.closing, KM: r.opening != null && r.closing != null ? r.closing - r.opening : '', Status: r.status === 'check' ? 'Waiting for check' : (r.opening == null ? 'Missing' : 'OK') }); }));
      downloadCSV('fuel-daily-' + f.cycle + '.csv', toCSV(out));
    };
    main.querySelectorAll('[data-cell]').forEach(td => td.onclick = () => {
      const [pid, d] = td.dataset.cell.split('|'), p = pById[pid], r = by[pid + '|' + d] || {};
      if (canEnter(p)) readingModal(pid, d, Object.assign({}, r), redraw, p.full_name + ' · ' + (p.employee_id || ''));
      else openModal(`<h2>${h(p.full_name)} — ${h(fmtDay(d))}</h2><p>Opening: <b>${num(r.opening) || '–'}</b><br>Closing: <b>${num(r.closing) || '–'}</b>${r.opening != null && r.closing != null ? `<br>KM: <b>${num(r.closing - r.opening)}</b>` : ''}</p>${r.open_photo ? `<p>${photoA(r.open_photo, 'Opening picture')}</p>` : ''}${r.close_photo ? `<p>${photoA(r.close_photo, 'Closing picture')}</p>` : ''}${r.check_note ? `<p class="hint">${h(r.check_note)}</p>` : ''}`);
    });
    main.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => { const n = prompt('Note (optional):', ''); if (n === null) return; if ((await rpc('fr_check_decide', { p_id: b.dataset.ok, p_approve: true, p_note: n }, 'Approved')).ok) redraw(); });
    main.querySelectorAll('[data-no]').forEach(b => b.onclick = async () => { const n = prompt('Why is it cleared? The rider will type it again.', ''); if (n === null) return; if ((await rpc('fr_check_decide', { p_id: b.dataset.no, p_approve: false, p_note: n }, 'Cleared')).ok) redraw(); });
  }

  // =====================================================================================
  // STAFF: Monthly entry for people without a login (courier manager etc.)
  // =====================================================================================
  async function pageMonthly(main) {
    const S = sup(), A = FR.d.myAccess || {}, today = pkToday(), cur = cycleStart(today), prev = cycleStart(addDays(cur, -1));
    FR.mc = FR.mc || cur;
    main.innerHTML = '<p class="fr-hint">Loading…</p>';
    let people = await fvFetchAll(() => sb.from('fr_people').select('*').eq('status', 'active').is('profile_id', null).order('full_name').order('id'));
    if (!S) people = people.filter(p => (A.regions || []).includes(p.region_id) && (!(A.groups || []).length || A.groups.includes(p.group_id)));
    const { data: mo, error } = await sb.from('fr_monthly').select('*').eq('cycle_start', FR.mc);
    if (error) { main.innerHTML = `<div class="fr-card fr-empty">${notReady(error) ? 'Please run <b>migration_70.sql</b> and <b>migration_71.sql</b> first.' : h(em(error))}</div>`; return; }
    const pById = {}; people.forEach(p => { pById[p.id] = p; });
    const byEmp = {}; people.forEach(p => { if (p.employee_id) byEmp[p.employee_id.trim().toLowerCase()] = p; });
    const entries = (mo || []).filter(m => pById[m.person_id]);
    const done = new Set(entries.map(m => m.person_id));
    const todo = people.filter(p => !done.has(p.id));
    const totKm = entries.reduce((t, m) => t + (m.closing - m.opening), 0);
    main.innerHTML = `<p class="fv-sub">For people without a FieldHub login (couriers, maintenance, etc.). One Opening and one Closing reading per person for the whole cycle. Covered KM is worked out automatically.</p>
      <div class="fr-tb"><select id="m-cy"><option value="${cur}"${FR.mc === cur ? ' selected' : ''}>${h(cycLabel(cur))}</option><option value="${prev}"${FR.mc === prev ? ' selected' : ''}>${h(cycLabel(prev))}</option></select>
        <span style="flex:1"></span>
        <button class="fv-btn ghost" id="m-tpl" type="button">Template</button>
        <button class="fv-btn" id="m-up" type="button">⬆ Upload Excel / CSV</button>
        <button class="fv-btn ghost" id="m-paste" type="button">Bulk add (paste)</button>
        <button class="fv-btn ghost" id="m-one" type="button">+ Add one entry</button>
        <button class="fv-btn ghost" id="m-csv" type="button">Download (CSV)</button></div>
      <div class="fr-grid" style="margin-bottom:12px">
        <div class="fr-card" style="margin:0"><div class="fr-hint">Entered</div><div style="font-size:24px;font-weight:700;color:#1E2A6E">${entries.length} / ${people.length}</div></div>
        <div class="fr-card" style="margin:0"><div class="fr-hint">Covered KM (total)</div><div style="font-size:24px;font-weight:700;color:#1E2A6E">${num(totKm)}</div></div>
        <div class="fr-card" style="margin:0"><div class="fr-hint">Not entered yet</div><div style="font-size:24px;font-weight:700;color:${todo.length ? '#c0392b' : '#2e7d4f'}">${todo.length}</div></div>
      </div>
      <div class="fr-wrap"><table class="fv-table"><thead><tr><th>Name</th><th>Employee ID</th><th>Region</th><th>Group</th><th class="fr-n">Opening</th><th class="fr-n">Closing</th><th class="fr-n">Covered KM</th><th></th></tr></thead><tbody>
      ${entries.map(m => { const p = pById[m.person_id]; return `<tr><td>${h(p.full_name)}</td><td>${h(p.employee_id || '–')}</td><td>${h(nm(FR.d.regions, m.region_id || p.region_id))}</td><td>${h(nm(FR.d.groups, m.group_id || p.group_id))}</td><td class="fr-n">${num(m.opening)}</td><td class="fr-n">${num(m.closing)}</td><td class="fr-n"><b>${num(m.closing - m.opening)}</b></td><td style="text-align:right;white-space:nowrap"><button class="fv-btn ghost" data-ed="${h(m.person_id)}" type="button">Edit</button> <button class="fv-btn ghost" data-del="${h(m.id)}" type="button" style="color:#c0392b">Delete</button></td></tr>`; }).join('') || '<tr><td colspan="8" class="fr-empty">Nothing entered for this cycle yet.</td></tr>'}
      </tbody></table></div>
      ${todo.length ? `<details style="margin-top:10px"><summary class="fr-hint" style="cursor:pointer">Show the ${todo.length} not entered yet</summary><p class="fr-hint">${todo.map(p => h(p.full_name + (p.employee_id ? ' (' + p.employee_id + ')' : ''))).join(' · ')}</p></details>` : ''}`;
    const redraw = () => pageMonthly(main);
    main.querySelector('#m-cy').onchange = (e) => { FR.mc = e.target.value; redraw(); };
    main.querySelector('#m-csv').onclick = () => downloadCSV('fuel-monthly-' + FR.mc + '.csv', toCSV(entries.map(m => { const p = pById[m.person_id]; return { Name: p.full_name, 'Employee ID': p.employee_id || '', Region: nm(FR.d.regions, m.region_id || p.region_id), Group: nm(FR.d.groups, m.group_id || p.group_id), Opening: m.opening, Closing: m.closing, 'Covered KM': m.closing - m.opening }; })));
    main.querySelector('#m-tpl').onclick = () => downloadCSV('fuel-monthly-template.csv', toCSV((todo.length ? todo : people).map(p => ({ Name: p.full_name, 'Employee ID': p.employee_id || '', Region: nm(FR.d.regions, p.region_id), Group: nm(FR.d.groups, p.group_id), Opening: '', Closing: '' }))));
    main.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { const why = prompt('Delete this entry? Type the reason:', ''); if (!why) return; if ((await rpc('fr_monthly_delete', { p_id: b.dataset.del, p_reason: why }, 'Deleted')).ok) redraw(); });
    main.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => oneEntryModal(people, entries, b.dataset.ed, redraw));
    main.querySelector('#m-one').onclick = () => oneEntryModal(people, entries, '', redraw);
    main.querySelector('#m-up').onclick = () => {
      openModal(`<h2>Upload monthly readings</h2><p class="hint">Excel (.xlsx) or CSV. These columns are <b>required</b>: <b>Name, Employee ID, Region, Group, Opening, Closing</b>. Covered KM is worked out automatically. Use "Template" to get the list of people with the right names. The file itself is not stored.</p>
        <div class="form-row"><input type="file" id="u-f" accept=".xlsx,.xls,.csv"></div>`);
      document.getElementById('u-f').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { const rows = await readSheet(f); closeModal(); importPreview(rows.map(r => ({ name: pick(r, ['name', 'team member name', 'team member']), employee_id: pick(r, ['employee id', 'employee_id', 'emp id', 'id']), region: pick(r, ['region', 'region name']), group: pick(r, ['group', 'category']), opening: pick(r, ['opening', 'opening reading']), closing: pick(r, ['closing', 'closing reading']) })), people, byEmp, redraw); } catch (err) { say('Could not read the file: ' + em(err)); } };
    };
    main.querySelector('#m-paste').onclick = () => {
      openModal(`<h2>Bulk add (paste from Excel)</h2><p class="hint">Copy six columns from Excel in this order — <b>Name, Employee ID, Region, Group, Opening, Closing</b> — and paste below (one person per line). Cycle: ${h(cycLabel(FR.mc))}.</p>
        <textarea id="p-t" rows="10" style="width:100%;font-family:monospace" placeholder="Ali Raza	C101	Karachi	Sample Transport	12000	13450"></textarea><button class="btn-primary" id="p-go" type="button" style="margin-top:8px">Check</button>`);
      document.getElementById('p-go').onclick = () => {
        const rows = document.getElementById('p-t').value.split(/\r?\n/).map(l => l.split('\t').map(x => x.trim())).filter(a => a.join('') && !/employee/i.test(a[1] || '')).map(a => ({ name: a[0] || '', employee_id: a[1] || '', region: a[2] || '', group: a[3] || '', opening: a[4] || '', closing: a[5] || '' }));
        if (!rows.length) { say('Nothing pasted'); return; }
        closeModal(); importPreview(rows, people, byEmp, redraw);
      };
    };
  }

  // check every row against the mapping (Employee ID → Region / Group) before saving
  function importPreview(rows, people, byEmp, done) {
    const S = sup();
    const clean = (v) => String(v || '').replace(/,/g, '').trim();
    const chk = rows.map((r, i) => {
      const out = Object.assign({ n: i + 1, errs: [], warns: [], fix: null }, r);
      ['name', 'employee_id', 'region', 'group', 'opening', 'closing'].forEach(k => { if (!String(r[k] || '').trim()) out.errs.push((k === 'employee_id' ? 'Employee ID' : k[0].toUpperCase() + k.slice(1)) + ' is missing'); });
      const p = byEmp[String(r.employee_id || '').trim().toLowerCase()];
      out.p = p;
      if (r.employee_id && !p) { out.errs.push('Employee ID not mapped (not on the fuel list, or has a login)'); out.fix = 'add'; }
      if (p) {
        const rn = nm(FR.d.regions, p.region_id), gn = nm(FR.d.groups, p.group_id);
        if (r.region && r.region.trim().toLowerCase() !== rn.trim().toLowerCase()) { out.errs.push(`Region: file "${r.region}", mapping "${rn || '—'}"`); out.fix = 'map'; }
        if (r.group && r.group.trim().toLowerCase() !== gn.trim().toLowerCase()) { out.errs.push(`Group: file "${r.group}", mapping "${gn || '—'}"`); out.fix = 'map'; }
        if (r.name && r.name.replace(/\s+/g, ' ').trim().toLowerCase() !== p.full_name.replace(/\s+/g, ' ').trim().toLowerCase()) out.warns.push(`Name differs from the list ("${p.full_name}")`);
      }
      const o = +clean(r.opening), c = +clean(r.closing);
      if (r.opening && isNaN(o)) out.errs.push('Opening is not a number');
      if (r.closing && isNaN(c)) out.errs.push('Closing is not a number');
      if (!isNaN(o) && !isNaN(c) && r.opening && r.closing && c <= o) out.errs.push('Closing must be more than Opening');
      out.km = (!isNaN(o) && !isNaN(c) && c > o) ? c - o : null;
      return out;
    });
    const ok = chk.filter(r => !r.errs.length), bad = chk.filter(r => r.errs.length);
    openModal(`<h2>Check before saving</h2>
      <p><b style="color:#2e7d4f">${ok.length} ready</b>${bad.length ? ` · <b style="color:#c0392b">${bad.length} with problems</b> (not saved until fixed)` : ''}</p>
      ${bad.length ? `<div class="fr-wrap" style="max-height:240px;margin-bottom:10px"><table class="fv-table" style="font-size:12px"><thead><tr><th>Row</th><th>Employee ID</th><th>Name</th><th>Problem</th><th></th></tr></thead><tbody>
        ${bad.map(r => `<tr><td>${r.n}</td><td>${h(r.employee_id)}</td><td>${h(r.name)}</td><td style="color:#c0392b">${r.errs.map(h).join('<br>')}</td><td style="white-space:nowrap">${S && r.fix === 'add' && r.employee_id ? `<button class="fv-btn ghost" data-fx="add" data-n="${r.n}" type="button">Add to fuel list</button>` : ''}${S && r.fix === 'map' ? `<button class="fv-btn ghost" data-fx="map" data-n="${r.n}" type="button">Update mapping from today</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : ''}
      ${ok.length ? `<div class="fr-wrap" style="max-height:240px"><table class="fv-table" style="font-size:12px"><thead><tr><th>Name</th><th>Employee ID</th><th>Region</th><th>Group</th><th class="fr-n">Opening</th><th class="fr-n">Closing</th><th class="fr-n">Covered KM</th></tr></thead><tbody>
        ${ok.map(r => `<tr><td>${h(r.name)}${r.warns.length ? ` <span class="fr-pill o" title="${h(r.warns.join('; '))}">name?</span>` : ''}</td><td>${h(r.employee_id)}</td><td>${h(r.region)}</td><td>${h(r.group)}</td><td class="fr-n">${h(clean(r.opening))}</td><td class="fr-n">${h(clean(r.closing))}</td><td class="fr-n"><b>${num(r.km)}</b></td></tr>`).join('')}
        </tbody></table></div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn-primary" id="i-save" type="button"${ok.length ? '' : ' disabled'}>Save ${ok.length} ready</button>${bad.length ? '<button class="btn outline" id="i-err" type="button">Download problem rows</button>' : ''}</div>`);
    const recheck = async () => { await load(true); const all = await fvFetchAll(() => sb.from('fr_people').select('*').eq('status', 'active').is('profile_id', null).order('id')); const m = {}; all.forEach(p => { if (p.employee_id) m[p.employee_id.trim().toLowerCase()] = p; }); importPreview(rows, all, m, done); };
    document.querySelectorAll('[data-fx]').forEach(b => b.onclick = async () => {
      const r = chk.find(x => String(x.n) === b.dataset.n);
      const reg = FR.d.regions.find(x => x.name.trim().toLowerCase() === String(r.region).trim().toLowerCase());
      const grp = FR.d.groups.find(x => x.name.trim().toLowerCase() === String(r.group).trim().toLowerCase());
      if (!reg) { say(`Region "${r.region}" does not exist. Add it first (Fuel Settings → Regions → Bulk upload) or correct the file.`); return; }
      if (!grp) { say(`Group "${r.group}" does not exist. Add it first (Fuel Settings → Groups) or correct the file.`); return; }
      if (b.dataset.fx === 'add') {
        if (!confirm(`Add ${r.name} (${r.employee_id}) to the fuel list?\nRegion: ${reg.name}\nGroup: ${grp.name}`)) return;
        const x = await rpc('fr_save_person', { p: { full_name: r.name, employee_id: r.employee_id, region_id: reg.id, group_id: grp.id, vehicle_type_id: (FR.d.vehicles[0] || {}).id || '', note: 'Added from monthly upload' } }, 'Added to the fuel list');
        if (x.ok) recheck();
      } else {
        const p = r.p;
        if (!confirm(`Change the mapping of ${p.full_name} (${p.employee_id}) from today?\nRegion: ${nm(FR.d.regions, p.region_id)} → ${reg.name}\nGroup: ${nm(FR.d.groups, p.group_id)} → ${grp.name}\n\nEarlier days keep the old region / group.`)) return;
        const x = await rpc('fr_save_person', { p: { id: p.id, full_name: p.full_name, employee_id: p.employee_id, region_id: reg.id, city_id: reg.id === p.region_id ? (p.city_id || '') : '', group_id: grp.id, vehicle_type_id: p.vehicle_type_id || '', note: p.note || '', status: p.status, reason: 'Changed from monthly upload' } }, 'Mapping updated from today');
        if (x.ok) recheck();
      }
    });
    const e = document.getElementById('i-err');
    if (e) e.onclick = () => downloadCSV('fuel-monthly-problems.csv', toCSV(bad.map(r => ({ Name: r.name, 'Employee ID': r.employee_id, Region: r.region, Group: r.group, Opening: r.opening, Closing: r.closing, Problem: r.errs.join('; ') }))));
    document.getElementById('i-save').onclick = async () => {
      const x = await rpc('fr_save_monthly', { p_cycle: FR.mc, p_rows: ok.map(r => ({ person_id: r.p.id, employee_id: r.employee_id, name: r.name, region: r.region, group: r.group, opening: clean(r.opening), closing: clean(r.closing) })) });
      if (!x.ok) return;
      const w = (x.data || {}).warnings || [];
      closeModal(); say(`${(x.data || {}).saved || 0} saved${w.length ? ', ' + w.length + ' refused' : ''}`);
      if (w.length) alert('Refused:\n' + w.map(z => 'Row ' + z.row + ': ' + z.msg).join('\n'));
      done();
    };
  }

  function oneEntryModal(people, entries, personId, done) {
    const m0 = entries.find(m => m.person_id === personId) || {};
    openModal(`<h2>${personId ? 'Edit entry' : 'Add one entry'}</h2><p class="hint">Cycle ${h(cycLabel(FR.mc))}</p>
      <div class="fr-f" style="margin:8px 0"><label>Person (Employee ID or name) *</label>${personId ? `<input value="${h((people.find(p => p.id === personId) || {}).full_name || '')}" disabled>` : `<input id="o-q" list="o-list" placeholder="Type ID or name…"><datalist id="o-list">${people.map(p => `<option value="${h((p.employee_id || '') + ' — ' + p.full_name)}">`).join('')}</datalist>`}</div>
      <div id="o-map" class="fr-hint" style="margin:4px 0 8px"></div>
      <div class="two-col"><div class="fr-f" style="margin:8px 0"><label>Opening *</label><input id="o-o" type="number" value="${h(m0.opening == null ? '' : m0.opening)}"></div>
      <div class="fr-f" style="margin:8px 0"><label>Closing *</label><input id="o-c" type="number" value="${h(m0.closing == null ? '' : m0.closing)}"></div></div>
      <p>Covered KM: <b id="o-km">–</b></p>
      <button class="btn-primary" id="o-s" type="button">Save</button>`);
    let pid = personId;
    const showMap = () => { const p = people.find(x => x.id === pid); document.getElementById('o-map').innerHTML = p ? `Region: <b>${h(nm(FR.d.regions, p.region_id))}</b> · Group: <b>${h(nm(FR.d.groups, p.group_id))}</b>${p.city_id ? ' · City: <b>' + h(nm(FR.d.cities, p.city_id)) + '</b>' : ''}` : ''; };
    const km = () => { const o = +document.getElementById('o-o').value, c = +document.getElementById('o-c').value; document.getElementById('o-km').textContent = (document.getElementById('o-o').value && document.getElementById('o-c').value) ? (c > o ? num(c - o) : 'Closing must be more than Opening') : '–'; };
    const q = document.getElementById('o-q');
    if (q) q.oninput = () => { const emp = q.value.split(' — ')[0].trim().toLowerCase(); const p = people.find(x => (x.employee_id || '').trim().toLowerCase() === emp); pid = p ? p.id : ''; showMap(); };
    showMap(); km();
    document.getElementById('o-o').oninput = km; document.getElementById('o-c').oninput = km;
    document.getElementById('o-s').onclick = async () => {
      if (!pid) { say('Choose the person from the list'); return; }
      const o = document.getElementById('o-o').value.trim(), c = document.getElementById('o-c').value.trim();
      if (!o || !c) { say('Opening and Closing are both needed'); return; }
      if (+c <= +o) { say('Closing must be more than Opening'); return; }
      const x = await rpc('fr_save_monthly', { p_cycle: FR.mc, p_rows: [{ person_id: pid, opening: o, closing: c }] });
      if (!x.ok) return;
      const w = (x.data || {}).warnings || [];
      if (w.length) { say(w[0].msg); return; }
      closeModal(); say('Saved ✓'); done();
    };
  }

  // =====================================================================================
  // SUPER ADMIN: Bike numbers of all riders
  // =====================================================================================
  async function pageBikes(main) {
    main.innerHTML = '<p class="fr-hint">Loading…</p>';
    const { data, error } = await sb.rpc('fr_bike_list');
    if (error) { main.innerHTML = `<div class="fr-card fr-empty">${notReady(error) || /bike/i.test(em(error)) ? 'Please run <b>migration_71.sql</b> first.' : h(em(error))}</div>`; return; }
    const all = data || [], f = FR.bf = FR.bf || { q: '', miss: false };
    const count = {}; all.forEach(r => { if (r.bike_number) count[r.bike_number] = (count[r.bike_number] || 0) + 1; });
    const rows = all.filter(r => (!f.miss || !r.bike_number) && (!f.q || (r.full_name + ' ' + (r.employee_id || '') + ' ' + (r.bike_number || '') + ' ' + (r.region || '')).toLowerCase().includes(f.q.toLowerCase())));
    const missing = all.filter(r => !r.bike_number).length;
    main.innerHTML = `<p class="fv-sub">Every rider is asked for his bike number when he opens FieldHub, until he adds it. Riders can change it in My Profile; you can edit or delete it here. Every change is logged.</p>
      <div class="fr-tb"><input id="b-q" placeholder="Search name / ID / bike / region" value="${h(f.q)}" style="min-width:220px"><label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="b-m"${f.miss ? ' checked' : ''}> Missing only</label>
        <span class="fv-note">${all.length} riders · <b style="color:${missing ? '#c0392b' : '#2e7d4f'}">${missing} without a bike number</b></span><span style="flex:1"></span><button class="fv-btn ghost" id="b-csv" type="button">Download (CSV)</button></div>
      <div class="fr-wrap"><table class="fv-table"><thead><tr><th>Name</th><th>Employee ID</th><th>Region</th><th>Bike number</th><th>Last changed</th><th></th></tr></thead><tbody>
      ${rows.slice(0, 800).map(r => `<tr><td>${h(r.full_name)}</td><td>${h(r.employee_id || '–')}</td><td>${h(r.region || '–')}</td><td>${r.bike_number ? `<b>${h(r.bike_number)}</b>${count[r.bike_number] > 1 ? ' <span class="fr-pill o" title="The same bike number is used by more than one rider">shared</span>' : ''}` : '<span class="fr-pill r">missing</span>'}</td><td>${r.bike_updated_at ? h(new Date(r.bike_updated_at).toLocaleDateString('en-GB')) : '–'}</td><td style="text-align:right;white-space:nowrap"><button class="fv-btn ghost" data-ed="${h(r.id)}" type="button">Edit</button>${r.bike_number ? ` <button class="fv-btn ghost" data-del="${h(r.id)}" type="button" style="color:#c0392b">Delete</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="fr-empty">Nobody matches.</td></tr>'}
      </tbody></table></div>`;
    const redraw = () => pageBikes(main);
    let tq; main.querySelector('#b-q').oninput = (e) => { clearTimeout(tq); tq = setTimeout(() => { f.q = e.target.value; redraw(); }, 400); };
    main.querySelector('#b-m').onchange = (e) => { f.miss = e.target.checked; redraw(); };
    main.querySelector('#b-csv').onclick = () => downloadCSV('bike-numbers.csv', toCSV(rows.map(r => ({ Name: r.full_name, 'Employee ID': r.employee_id || '', Region: r.region || '', 'Bike number': r.bike_number || '', 'Last changed': r.bike_updated_at ? new Date(r.bike_updated_at).toLocaleDateString('en-GB') : '' }))));
    main.querySelectorAll('[data-ed]').forEach(b => b.onclick = async () => { const r = all.find(x => x.id === b.dataset.ed); const v = prompt(`Bike number for ${r.full_name}:`, r.bike_number || ''); if (v === null || !v.trim()) return; if ((await rpc('fr_set_bike_number', { p_user: r.id, p_number: v }, 'Saved')).ok) redraw(); });
    main.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { const r = all.find(x => x.id === b.dataset.del); if (!confirm(`Delete the bike number of ${r.full_name}?\n\nHe will be asked to add it again when he opens FieldHub.`)) return; if ((await rpc('fr_set_bike_number', { p_user: r.id, p_number: '' }, 'Deleted')).ok) redraw(); });
  }

  // My Profile: bike number card for riders
  (function hookProfile() {
    if (typeof window.renderMyProfile !== 'function') { setTimeout(hookProfile, 400); return; }
    if (window.renderMyProfile.__frb) return;
    const orig = window.renderMyProfile;
    const wrapped = async function () {
      const r = await orig.apply(this, arguments);
      try {
        if (state.profile && state.profile.role === 'rider' && !document.getElementById('fr-bike-card')) {
          const res = await sb.from('profiles').select('bike_number').eq('id', state.user.id).maybeSingle();
          const data = res.data || {}, error = res.error;
          if (!error) {
            const main = document.getElementById('main-content'), card = document.createElement('div');
            card.className = 'card'; card.id = 'fr-bike-card';
            card.innerHTML = `<h3>🏍 Bike number</h3><p style="font-size:20px;font-weight:700;margin:6px 0">${data && data.bike_number ? h(data.bike_number) : '<span style="color:#c0392b">Not added yet</span>'}</p><button class="btn outline" id="fr-bike-ch" type="button">${data && data.bike_number ? 'Change bike number' : 'Add bike number'}</button>`;
            main.appendChild(card);
            card.querySelector('#fr-bike-ch').onclick = async () => {
              const v = prompt('Bike number (as on the number plate), e.g. LEA-1234:', (data && data.bike_number) || ''); if (v === null || !v.trim()) return;
              const { data: nv, error: e2 } = await sb.rpc('fh_set_bike_number', { p_number: v });
              if (e2) { say(errText(e2)); return; }
              say('Bike number saved: ' + nv); data.bike_number = nv; card.querySelector('p').textContent = nv; card.querySelector('#fr-bike-ch').textContent = 'Change bike number';
            };
          }
        }
      } catch (e) { console.warn('bike card', e); }
      return r;
    };
    wrapped.__frb = true; window.renderMyProfile = wrapped;
  })();

})();

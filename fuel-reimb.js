// =====================================================================================
// fuel-reimb.js — Fuel Reimbursement (v96: Phase 2 Settings + People, Phase 3 Google Drive link)
// Needs migration_67 (2-step) and migration_68 (tables + functions). Before migration_68 the pages
// simply say so. All saving goes through database functions (Super Admin + 2-step code), and is logged.
// Remove the fuel-reimb.js line from index.html to hide the whole module again (nothing is deleted).
// =====================================================================================
(function () {
  'use strict';
  const FR = { d: null, tab: 'general', pf: { region: '', group: '', status: 'active', q: '' } };
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
    if (state.profile.role === 'super_admin') return ['fr_people', 'fr_settings'];
    return window.__frAcc ? ['fr_people'] : [];
  };
  (function watchAccess() {
    let tries = 0;
    const t = setInterval(async () => {
      if (++tries > 120) { clearInterval(t); return; }
      if (typeof state === 'undefined' || !state.user || !state.profile) return;
      clearInterval(t);
      if (state.profile.role === 'super_admin' || state.profile.role === 'rider') return;
      try {
        const { data } = await sb.from('fr_access').select('user_id').eq('user_id', state.user.id).maybeSingle();
        if (data) { window.__frAcc = true; if (typeof renderNav === 'function') renderNav(); }
      } catch (_e) {}
    }, 1000);
  })();

  // ---------------------------------------------------------------- page entry
  window.renderFuelReimb = async function (view) {
    const main = document.getElementById('main-content');
    css(); try { fvEnsureStyle(); } catch (_e) {}
    if (!(window.frNavViews() || []).includes(view)) { main.innerHTML = '<div class="empty-state">You do not have access to this page.</div>'; return; }
    if (window.fhFuel2fa) { const ok = await fhFuel2fa.gate(main, () => { if (state.view === view) window.renderFuelReimb(view); }); if (!ok) return; }
    try { await load(true); }
    catch (e) { main.innerHTML = `<div class="fr-card fr-empty">${notReady(e) ? READY_MSG : h(em(e))}</div>`; return; }
    if (view === 'fr_settings') return pageSettings(main);
    if (view === 'fr_people') return pagePeople(main);
  };

  // =====================================================================================
  // SETTINGS (Super Admin)
  // =====================================================================================
  const TABS = [['general', 'General'], ['groups', 'Groups'], ['vehicles', 'Vehicle types'], ['regions', 'Regions'], ['pictures', 'Pictures'], ['access', 'Staff access'], ['drive', 'Google Drive'], ['log', 'Change log']];
  function pageSettings(main) {
    main.innerHTML = `<p class="fv-sub">Set everything once. Only the Super Admin can change these, and every change is logged.</p>
      <div class="fr-tabs">${TABS.map(([k, l]) => `<button class="fr-tab${FR.tab === k ? ' on' : ''}" data-tab="${k}" type="button">${l}</button>`).join('')}</div><div id="fr-body"></div>`;
    main.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { FR.tab = b.dataset.tab; pageSettings(main); });
    const body = main.querySelector('#fr-body');
    ({ general: tGeneral, groups: tGroups, vehicles: tVehicles, regions: tRegions, pictures: tPictures, access: tAccess, drive: tDrive, log: tLog })[FR.tab](body);
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
    body.innerHTML = `<div class="fr-tb"><button class="fv-btn" id="gr-add" type="button">+ Add group</button><button class="fv-btn ghost" id="gr-copy" type="button">Copy groups from Fuel Trends</button><span class="fv-note">Visit-based groups (Home Sampling, Home Care) are limited to "max KM per visit × visits".</span></div>
      <div class="fr-wrap"><table class="fv-table"><thead><tr><th>Group</th><th>Visit-based</th><th class="fr-n">Max KM per visit</th><th>Status</th><th></th></tr></thead><tbody>
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
      <div class="fr-f" style="margin:10px 0"><label>Max KM per visit (visit-based only)</label><input type="number" step="0.1" min="0" id="m-k" value="${h(x.max_km_per_visit == null ? '' : x.max_km_per_visit)}"></div>
      ${x.id ? `<div class="fr-f" style="margin:10px 0"><label>Status</label><select id="m-a"><option value="true">Active</option><option value="false"${x.active ? '' : ' selected'}>Inactive (hidden from new entries; history kept)</option></select></div>` : ''}
      <button class="btn-primary" id="m-s" type="button">Save</button>`);
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
    body.innerHTML = `<div class="fr-tb"><span class="fv-note">Regions and cities come from your existing lists, so names always match. To add a region or city, use Admin → Regions.</span><span style="flex:1"></span><button class="fv-btn ghost" type="button" onclick="navigateTo('regions')">Open Regions</button></div>
      <div class="fr-wrap"><table class="fv-table"><thead><tr><th>Region</th><th class="fr-n">Cities</th><th>Month-end review done by</th></tr></thead><tbody>
      ${FR.d.regions.map(r => `<tr><td>${h(r.name)}</td><td class="fr-n">${cityN[r.id] || 0}</td><td><select data-rv="${h(r.id)}" style="padding:6px 8px;border:1px solid #d6daec;border-radius:8px"><option value="area">Area Incharge / Regional POC</option><option value="super_admin"${cfg[r.id] === 'super_admin' ? ' selected' : ''}>Super Admin</option></select></td></tr>`).join('') || '<tr><td colspan="3" class="fr-empty">No regions yet.</td></tr>'}
      </tbody></table></div>`;
    body.querySelectorAll('[data-rv]').forEach(s => s.onchange = async () => { if (!(await rpc('fr_set_reviewer', { p_region: s.dataset.rv, p_reviewer: s.value }, 'Saved')).ok) again(); else load(true); });
  }

  async function tPictures(body) {
    body.innerHTML = '<p class="fr-hint">Loading…</p>';
    const { data: ppl } = await sb.from('fr_people').select('id,full_name,employee_id').order('full_name');
    const lists = { region: FR.d.regions, city: FR.d.cities.map(c => ({ id: c.id, name: c.name + (nm(FR.d.regions, c.region_id) ? ' — ' + nm(FR.d.regions, c.region_id) : '') })), person: (ppl || []).map(p => ({ id: p.id, name: p.full_name + (p.employee_id ? ' (' + p.employee_id + ')' : '') })) };
    const RL = { required: 'Required', optional: 'Optional', off: 'Not allowed' }, SL = { all: 'Everyone', region: 'Region', city: 'City', person: 'One person' };
    const who = (r) => r.scope === 'all' ? 'Everyone' : nm(lists[r.scope], r.scope_id) || '(removed)';
    const rules = FR.d.rules.slice().sort((a, b) => ['all', 'region', 'city', 'person'].indexOf(a.scope) - ['all', 'region', 'city', 'person'].indexOf(b.scope));
    body.innerHTML = `<div class="fr-card"><h4>Odometer picture rules</h4><p class="fr-hint">The most specific rule wins: one person → city → region → everyone. Pictures are saved in your Google Drive, never in Supabase.</p>
      <div class="fr-wrap" style="margin-top:8px"><table class="fv-table"><thead><tr><th>Applies to</th><th>Who</th><th>Picture</th><th></th></tr></thead><tbody>
      ${rules.map(r => `<tr><td>${SL[r.scope]}</td><td>${h(who(r))}</td><td><span class="fr-pill ${r.rule === 'required' ? 'o' : r.rule === 'off' ? 'x' : 'g'}">${RL[r.rule]}</span></td><td style="text-align:right">${r.scope === 'all' ? '' : `<button class="fv-btn ghost" data-rm="${h(r.scope)}|${h(r.scope_id)}" type="button" style="color:#c0392b">Remove</button>`}</td></tr>`).join('')}
      </tbody></table></div></div>
      <div class="fr-card"><h4>Add or change a rule</h4><div class="fr-grid">
        <div class="fr-f"><label>Applies to</label><select id="p-sc"><option value="all">Everyone</option><option value="region">Region</option><option value="city">City</option><option value="person">One person</option></select></div>
        <div class="fr-f"><label>Who</label><select id="p-id" disabled><option value="">—</option></select></div>
        <div class="fr-f"><label>Picture</label><select id="p-ru"><option value="optional">Optional</option><option value="required">Required</option><option value="off">Not allowed</option></select></div>
      </div><div style="margin-top:12px"><button class="fv-btn" id="p-save" type="button">Save rule</button></div></div>`;
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
    const byId = {}; staff.forEach(s => { byId[s.id] = s; });
    const ROLE = { team_lead: 'Area Incharge', regional_poc: 'Regional POC', admin: 'Admin', coordinator: 'Coordinator', super_admin: 'Super Admin', inventory_coordinator: 'Inventory Coordinator' };
    const yes = (b) => b ? '✓' : '–';
    body.innerHTML = `<div class="fr-tb"><button class="fv-btn" id="ac-add" type="button">+ Give access</button><span class="fv-note">Area Incharges, Regional Leads, Admin Officers and the courier manager only see the regions and groups you tick here.</span></div>
      <div class="fr-wrap"><table class="fv-table"><thead><tr><th>Name</th><th>Role</th><th>Regions</th><th>Groups</th><th>Review</th><th>Enter for others</th><th>Request people</th><th></th></tr></thead><tbody>
      ${acc.map(a => { const s = byId[a.user_id] || {}; return `<tr><td>${h(s.full_name || '(not active)')}</td><td>${h(ROLE[s.role] || s.role || '')}</td><td>${h(a.regions.map(r => nm(FR.d.regions, r)).filter(Boolean).join(', ') || '–')}</td><td>${h(a.groups.length ? a.groups.map(g => nm(FR.d.groups, g)).filter(Boolean).join(', ') : 'All')}</td><td>${yes(a.can_review)}</td><td>${yes(a.can_enter)}</td><td>${yes(a.can_request)}</td><td style="text-align:right"><button class="fv-btn ghost" data-ed="${h(a.user_id)}" type="button">Edit</button></td></tr>`; }).join('') || '<tr><td colspan="8" class="fr-empty">Nobody has access yet.</td></tr>'}
      </tbody></table></div>`;
    const modal = (a) => {
      a = a || { user_id: '', regions: [], groups: [], can_review: true, can_enter: false, can_request: true };
      const chk = (list, sel, nmKey) => list.map(o => `<label><input type="checkbox" data-${nmKey}="${h(o.id)}"${sel.includes(o.id) ? ' checked' : ''}> ${h(o.name)}</label>`).join('');
      openModal(`<h2>${a.user_id ? 'Edit access' : 'Give access'}</h2>
        <div class="fr-f" style="margin:10px 0"><label>Staff member *</label>${a.user_id ? `<input value="${h((byId[a.user_id] || {}).full_name || '')}" disabled>` : `<input id="m-q" placeholder="Type to search name or ID…" style="margin-bottom:6px"><select id="m-u" size="6">${staff.filter(s => s.role !== 'super_admin').map(s => `<option value="${h(s.id)}">${h(s.full_name || '')}${s.employee_id ? ' (' + h(s.employee_id) + ')' : ''} — ${h(ROLE[s.role] || s.role)}</option>`).join('')}</select>`}</div>
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
        const p = { regions, groups: ticks('g'), can_review: document.getElementById('m-rv').checked, can_enter: document.getElementById('m-en').checked, can_request: document.getElementById('m-rq').checked };
        if ((await rpc('fr_save_access', { p_user: uid, p }, 'Access saved')).ok) { closeModal(); again(); }
      };
      const x = document.getElementById('m-x');
      if (x) x.onclick = async () => { if (!confirm('Remove this person\'s Fuel Reimbursement access?')) return; if ((await rpc('fr_save_access', { p_user: a.user_id, p: { remove: true } }, 'Access removed')).ok) { closeModal(); again(); } };
    };
    body.querySelector('#ac-add').onclick = () => modal(null);
    body.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => modal(acc.find(a => a.user_id === b.dataset.ed)));
  }

  // ---------------------------------------------------------------- Phase 3: Google Drive link
  async function drive(action, extra) {
    const url = FR.d && FR.d.settings && FR.d.settings.drive_url;
    if (!url) throw new Error('No Google Drive link saved yet');
    const { data } = await sb.auth.getSession();
    const token = data && data.session && data.session.access_token;
    if (!token) throw new Error('Please sign in again');
    const r = await fetch(url, { method: 'POST', body: JSON.stringify(Object.assign({ action, token }, extra || {})) });   // plain text body: no extra browser check needed
    const j = await r.json().catch(() => null);
    if (!j) throw new Error('The link did not answer like the FieldHub script. Check that you copied the "Web app" URL.');
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
      try { const j = await drive('ping'); out.innerHTML = `<span class="fr-pill g">Connected ✓</span> <span class="fr-hint">Folder: ${h(j.folder)} · signed in as ${h(j.user || '')}</span>`; }
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
    const ST = { active: ['g', 'Active'], pending: ['o', 'Waiting approval'], rejected: ['r', 'Rejected'], inactive: ['x', 'Inactive'] };
    main.innerHTML = `<p class="fv-sub">${S ? 'Everyone who claims fuel. Riders come from the roster; others are added or requested here.' : 'People in your regions. New people you request appear after the Super Admin approves them.'}</p>
      ${S && pend.length ? `<div class="fr-card" style="border-color:#f3d9a8"><h4>⏳ Waiting for your approval (${pend.length})</h4><div class="fr-wrap"><table class="fv-table"><thead><tr><th>Name</th><th>Employee ID</th><th>Region / City</th><th>Group</th><th>Note</th><th></th></tr></thead><tbody>
        ${pend.map(p => `<tr><td>${h(p.full_name)}</td><td>${h(p.employee_id || '–')}</td><td>${h(nm(FR.d.regions, p.region_id))}${p.city_id ? ' / ' + h(nm(FR.d.cities, p.city_id)) : ''}</td><td>${h(nm(FR.d.groups, p.group_id))}</td><td>${h(p.note || '')}</td><td style="text-align:right;white-space:nowrap"><button class="fv-btn" data-ap="${h(p.id)}" type="button">Approve</button> <button class="fv-btn ghost" data-rj="${h(p.id)}" type="button" style="color:#c0392b">Reject</button></td></tr>`).join('')}
        </tbody></table></div></div>` : ''}
      <div class="fr-tb">
        <select id="f-r"><option value="">All regions</option>${opts(myRegions, f.region)}</select>
        <select id="f-g"><option value="">All groups</option>${opts(FR.d.groups, f.group)}</select>
        <select id="f-s"><option value="">Any status</option>${Object.keys(ST).map(k => `<option value="${k}"${f.status === k ? ' selected' : ''}>${ST[k][1]}</option>`).join('')}</select>
        <input id="f-q" placeholder="Search name / ID" value="${h(f.q)}" style="min-width:160px">
        <span style="flex:1"></span>
        ${S ? '<button class="fv-btn ghost" id="pp-sync" type="button">↻ Add riders from roster</button>' : ''}
        ${canReq ? `<button class="fv-btn" id="pp-add" type="button">${S ? '+ Add person' : '+ Request new person'}</button>` : ''}
        <button class="fv-btn ghost" id="pp-csv" type="button">Download (CSV)</button>
      </div>
      <p class="fr-hint" style="margin:0 0 8px">${rows.length} shown · ${all.filter(p => p.status === 'active').length} active in total</p>
      <div class="fr-wrap"><table class="fv-table"><thead><tr><th>Name</th><th>Employee ID</th><th>Region</th><th>City</th><th>Group</th><th>Vehicle</th><th>Login</th><th>Status</th>${S ? '<th></th>' : ''}</tr></thead><tbody>
      ${rows.slice(0, 600).map(p => `<tr><td>${h(p.full_name)}</td><td>${h(p.employee_id || '–')}</td><td>${h(nm(FR.d.regions, p.region_id))}</td><td>${h(nm(FR.d.cities, p.city_id) || '–')}</td><td>${h(nm(FR.d.groups, p.group_id) || '–')}</td><td>${h(nm(FR.d.vehicles, p.vehicle_type_id) || '–')}</td><td>${p.profile_id ? 'Yes' : '<span class="fr-hint">No</span>'}</td><td><span class="fr-pill ${ST[p.status][0]}">${ST[p.status][1]}</span></td>${S ? `<td style="text-align:right"><button class="fv-btn ghost" data-ed="${h(p.id)}" type="button">Edit</button></td>` : ''}</tr>`).join('') || `<tr><td colspan="${S ? 9 : 8}" class="fr-empty">${all.length ? 'Nobody matches these filters.' : S ? 'Nobody yet. Click "Add riders from roster" to start.' : 'Nobody in your regions yet.'}</td></tr>`}
      </tbody></table></div>${rows.length > 600 ? '<p class="fr-hint">Showing the first 600 — use the filters to narrow down.</p>' : ''}`;
    const redraw = () => pagePeople(main);
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
    main.querySelectorAll('[data-ap]').forEach(b => b.onclick = async () => { if ((await rpc('fr_decide_person', { p_id: b.dataset.ap, p_approve: true, p_note: null }, 'Approved')).ok) redraw(); });
    main.querySelectorAll('[data-rj]').forEach(b => b.onclick = async () => { const n = prompt('Reason for rejecting (the requester will see it):', ''); if (n === null) return; if ((await rpc('fr_decide_person', { p_id: b.dataset.rj, p_approve: false, p_note: n }, 'Rejected')).ok) redraw(); });
    const sy = main.querySelector('#pp-sync');
    if (sy) sy.onclick = () => {
      openModal(`<h2>Add riders from roster</h2><p class="hint">Every rider on the roster who is not on the fuel list yet is added, with the roster's region and city. Riders already on the list follow roster region changes. Nobody is removed.</p>
        <div class="fr-f" style="margin:10px 0"><label>Group for the new riders</label><select id="m-g">${opts(FR.d.groups.filter(g => g.active), (FR.d.groups.find(g => /home sampling/i.test(g.name)) || {}).id, 'Choose later')}</select></div>
        <div class="fr-f" style="margin:10px 0"><label>Vehicle type for the new riders</label><select id="m-v">${opts(FR.d.vehicles.filter(v => v.active), (FR.d.vehicles[0] || {}).id, 'Choose later')}</select></div>
        <button class="btn-primary" id="m-s" type="button">Add riders</button>`);
      document.getElementById('m-s').onclick = async () => {
        const r = await rpc('fr_sync_roster', { p_group: document.getElementById('m-g').value || null, p_vehicle: document.getElementById('m-v').value || null });
        if (r.ok) { closeModal(); say(`${(r.data || {}).added || 0} rider(s) added, ${(r.data || {}).moved || 0} moved to their roster region`); redraw(); }
      };
    };
  }
  function personModal(p, regions, done) {
    const S = sup(), isNew = !p;
    p = p || { full_name: '', employee_id: '', region_id: regions.length === 1 ? regions[0].id : '', city_id: '', group_id: '', vehicle_type_id: (FR.d.vehicles[0] || {}).id, note: '', status: 'active' };
    const cities = (rid) => FR.d.cities.filter(c => c.region_id === rid);
    openModal(`<h2>${isNew ? (S ? 'Add person' : 'Request new person') : 'Edit person'}</h2>
      ${!S ? '<p class="hint">The Super Admin approves new people before they appear.</p>' : ''}
      ${p.profile_id ? '<p class="hint">This person has a FieldHub login (from the roster).</p>' : ''}
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
})();

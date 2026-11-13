/* FieldHub — POS Management (v75). Loaded after app.js and uses its globals (sb, state, toast, openModal, ...).
   Super Admin: Coverage, Machines (Excel upload, issue, charger tracking), Repairs (send to Accounts, replace).
   Riders: see their own machine on the Dashboard and My Profile, and can report a fault.
   Needs migration_56.sql. */
(function () {
  'use strict';
  const esc = (s) => escapeHtml(s == null ? '' : String(s));
  const P = { data: null, f: { q: '', status: '', region: '', bank: '', charger: '', link: '' }, sel: new Set(), shown: 100, tab: 'reported' };
  const STATUS = { issued: ['Issued', 'active'], in_stock: ['In stock', ''], in_repair: ['In repair', 'open'], retired: ['Retired', ''] };
  const REPAIR_STATUS = { reported: 'Reported by rider', with_accounts: 'With Accounts', repaired: 'Repaired', irreparable: 'Irreparable', cancelled: 'Cancelled' };
  const fd = (d) => (d ? formatDate(d) : '—');
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const SETUP_MSG = '<div class="empty-state"><p>POS Management is not set up yet.</p><p class="hint">Ask the admin to run <b>migration_56.sql</b> in Supabase (SQL Editor), then reopen this page.</p></div>';
  const missing = (e) => e && /relation|does not exist|schema cache|column/i.test(e.message || '');

  // ---------------------------------------------------------------- data
  async function load(force) {
    if (P.data && !force) return P.data;
    const q = (t, sel) => fvFetchAll(() => sb.from(t).select(sel).order('created_at', { ascending: true }));
    const [machines, repairs, faults, regs, subs, roster, hot, riders] = await Promise.all([
      q('pos_machines', '*'), q('pos_repairs', '*'),
      sb.from('pos_fault_types').select('*').order('sort_order').order('name').then((r) => { if (r.error) throw r.error; return r.data || []; }),
      sb.from('regions').select('id, name, approved_headcount').order('name').then((r) => r.data || []),
      sb.from('sub_regions').select('id, name, region_id, approved_headcount, active').order('name').then((r) => r.data || []),
      fvFetchAll(() => sb.from('roster_entries').select('id, rider_id, region_id, sub_region_id, hotspot, status').neq('status', 'removed').order('id')),
      sb.from('hotspots').select('name, region_id, sub_region_id').limit(3000).then((r) => r.data || []),
      fvFetchAll(() => sb.from('profiles').select('id, full_name, employee_id, phone, status').eq('role', 'rider').order('id'))
    ]);
    const d = P.data = { machines, repairs, faults, regs, subs, roster, hot, riders };
    d.rid = new Map(riders.map((r) => [r.id, r]));
    d.regName = new Map(regs.map((r) => [r.id, r.name]));
    d.subName = new Map(subs.map((s) => [s.id, s.name]));
    d.mById = new Map(machines.map((m) => [m.id, m]));
    // each working rider -> region / sub-region (roster first; the hotspot's sub-region when the roster has none)
    const hotKey = new Map(hot.map((h) => [h.region_id + '|' + norm(h.name), h.sub_region_id]));
    d.work = new Map();
    roster.forEach((e) => { if (!e.rider_id || d.work.has(e.rider_id)) return; d.work.set(e.rider_id, { region: e.region_id, sub: e.sub_region_id || hotKey.get(e.region_id + '|' + norm(e.hotspot)) || null }); });
    // riders that hold a machine (issued or in repair)
    d.holders = new Set();
    machines.forEach((m) => { if (m.status === 'issued' || m.status === 'in_repair') { if (m.rider_id) d.holders.add(m.rider_id); if (norm(m.employee_id)) d.holders.add('e:' + norm(m.employee_id)); } });
    return d;
  }
  const regionOf = (m, d) => ((m.rider_id && d.work.get(m.rider_id)) ? d.work.get(m.rider_id).region : m.region_id) || null;
  const subOf = (m, d) => ((m.rider_id && d.work.get(m.rider_id)) ? d.work.get(m.rider_id).sub : m.sub_region_id) || null;
  const badge = (st) => { const [t, c] = STATUS[st] || [st, '']; return `<span class="badge ${c}">${esc(t)}</span>`; };
  const faultOpts = (d, sel) => '<option value="">— choose —</option>' + d.faults.filter((f) => f.active || f.id === sel).map((f) => `<option value="${f.id}" ${f.id === sel ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
  async function rpc(name, args, ok) { const r = await sb.rpc(name, args); if (r.error) { toast('Could not save: ' + r.error.message); return false; } if (ok) toast(ok); return r.data == null ? true : r.data; }
  const shell = (sub) => { document.getElementById('topbar-actions').innerHTML = ''; const m = document.getElementById('main-content'); m.innerHTML = `<p class="hint" style="margin-top:0">${sub}</p><div id="pos-body"><div class="mono">Loading…</div></div>`; return document.getElementById('pos-body'); };

  // ---------------------------------------------------------------- page router
  window.renderPos = async function (view) {
    if (!isSuperAdmin()) { document.getElementById('main-content').innerHTML = '<div class="empty-state">This page is for the Super Admin only.</div>'; return; }
    const host = shell({ pos_dash: 'Where POS machines are and where more are needed — by region and sub-region / city.', pos_stock: 'Every POS machine: issue, take back, track chargers, and bulk-update from Excel.', pos_repairs: 'Faulty machines: send to Accounts, record the result, and issue a replacement.' }[view] || '');
    try { await load(true); } catch (e) { host.innerHTML = missing(e) ? SETUP_MSG : '<div class="empty-state">Could not load: ' + esc(e.message) + '</div>'; return; }
    if (view === 'pos_dash') return pageDash(host);
    if (view === 'pos_stock') return pageStock(host);
    if (view === 'pos_repairs') return pageRepairs(host);
  };
  const reload = () => renderPos(state.view);

  // ---------------------------------------------------------------- COVERAGE
  function coverage(d) {
    const rows = new Map(); // key region id (or '-') -> { reg, approved, working, have, stock, repair, chg, subs: Map }
    const mk = (id, name, approved) => ({ id, name, approved, working: 0, have: 0, nopos: 0, stock: 0, repair: 0, chg: 0 });
    const R = (rid) => { const k = rid || '-'; if (!rows.has(k)) rows.set(k, { ...mk(k, rid ? (d.regName.get(rid) || 'Unknown') : 'Unallocated', rid ? (d.regs.find((x) => x.id === rid) || {}).approved_headcount : null), subs: new Map() }); return rows.get(k); };
    const S = (reg, sid) => { const k = sid || '-'; if (!reg.subs.has(k)) reg.subs.set(k, mk(k, sid ? (d.subName.get(sid) || '?') : 'No sub-region set', sid ? (d.subs.find((x) => x.id === sid) || {}).approved_headcount : null)); return reg.subs.get(k); };
    d.regs.forEach((r) => R(r.id));
    const both = (rid, sid, fn) => { const r = R(rid); fn(r); fn(S(r, sid)); };
    const noPos = [];
    d.work.forEach((w, rid) => {
      both(w.region, w.sub, (x) => { x.working++; });
      const pr0 = d.rid.get(rid);
      if (!d.holders.has(rid) && !(pr0 && norm(pr0.employee_id) && d.holders.has('e:' + norm(pr0.employee_id)))) { both(w.region, w.sub, (x) => { x.nopos++; }); const p = d.rid.get(rid); noPos.push({ rid, name: p ? p.full_name : '—', emp: p ? p.employee_id : '', region: w.region, sub: w.sub }); }
    });
    const seen = new Set();
    d.machines.forEach((m) => {
      const rg = regionOf(m, d), sb2 = subOf(m, d);
      if (m.status === 'issued' || m.status === 'in_repair') {
        const key = m.rider_id || (norm(m.employee_id) ? 'e:' + norm(m.employee_id) : m.id); const dup = seen.has(key); seen.add(key);
        both(rg, sb2, (x) => { if (!dup) x.have++; if (m.status === 'in_repair') x.repair++; if (!m.charger_given) x.chg++; });
      } else if (m.status === 'in_stock') both(rg, sb2, (x) => { x.stock++; });
    });
    rows.forEach((r) => { const all = [r, ...r.subs.values()]; all.forEach((x) => { const base = Math.max(x.approved || 0, x.working); x.need = Math.max(0, base - x.have - x.stock); }); });
    return { rows: [...rows.values()].filter((r) => r.working || r.have || r.stock || r.approved || r.id !== '-'), noPos };
  }
  function pageDash(host) {
    const d = P.data, cv = coverage(d);
    const tot = { m: d.machines.length, issued: 0, stock: 0, repair: 0, retired: 0, chg: 0 };
    d.machines.forEach((m) => { if (m.status === 'issued') tot.issued++; else if (m.status === 'in_stock') tot.stock++; else if (m.status === 'in_repair') tot.repair++; else tot.retired++; if ((m.status === 'issued' || m.status === 'in_repair') && !m.charger_given) tot.chg++; });
    const noPosN = cv.noPos.length, procure = Math.max(0, noPosN - tot.stock);
    const rep = d.repairs.filter((r) => r.status === 'reported').length;
    const tile = (n, l, c) => `<div class="stat-card" style="min-width:130px"><div class="stat-number" style="${c ? 'color:' + c : ''}">${n}</div><div class="stat-label">${l}</div></div>`;
    const regSel = '<option value="">All regions</option>' + d.regs.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
    const rowHtml = (x, sub, regId) => `<tr style="${sub ? '' : 'font-weight:700;background:rgba(30,42,110,.05)'}"><td style="${sub ? 'padding-left:26px' : ''}">${esc(x.name)}${sub ? '' : ''}</td>
      <td class="mono">${x.approved == null ? '—' : x.approved} ${!sub && regId !== '-' || sub && x.id !== '-' ? `<button class="btn small outline" data-hc="${sub ? 's' : 'r'}:${x.id}" title="Edit approved headcount" style="padding:0 6px">✎</button>` : ''}</td>
      <td class="mono">${x.working}</td><td class="mono">${x.have}</td><td class="mono" style="${x.nopos ? 'color:#c0392b;font-weight:700' : ''}">${x.nopos}</td><td class="mono">${x.stock}</td><td class="mono">${x.repair || '—'}</td><td class="mono">${x.chg || '—'}</td><td class="mono" style="${x.need ? 'color:#c0392b;font-weight:700' : 'color:#1e8449'}">${x.need || '✔'}</td></tr>`;
    host.innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">${tile(tot.m, 'Total machines')}${tile(tot.issued, 'Issued')}${tile(tot.stock, 'In stock')}${tile(tot.repair, 'In repair')}${tile(tot.chg, 'Charger pending', tot.chg ? '#b9770e' : '')}${tile(noPosN, 'Riders without POS', noPosN ? '#c0392b' : '')}${tile(procure, 'To procure', procure ? '#c0392b' : '')}${rep ? tile(rep, 'Fault reports', '#b9770e') : ''}</div>
      <div class="card"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px"><h3 style="margin:0;flex:1">Coverage by region</h3><select id="pd-reg" class="input" style="max-width:200px">${regSel}</select><button class="btn small outline" id="pd-dl" type="button">⬇ Excel</button></div>
        <p class="hint">Approved = approved headcount. Working = active riders on the roster. <b>POS needed</b> = the larger of Approved and Working, minus riders who already have a POS, minus machines in stock. Click ✎ to change an approved headcount.</p>
        <div style="overflow-x:auto"><table><thead><tr><th>Region / Sub-region</th><th>Approved</th><th>Working</th><th>Have POS</th><th>No POS</th><th>In stock</th><th>In repair</th><th>Charger pending</th><th>POS needed</th></tr></thead><tbody id="pd-rows"></tbody></table></div></div>
      <div class="card" style="margin-top:14px"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px"><h3 style="margin:0;flex:1">Riders without a POS (${noPosN})</h3><input id="pd-q" class="input" placeholder="Search name or ID" style="max-width:190px"><button class="btn small outline" id="pd-dl2" type="button">⬇ Excel</button></div><div id="pd-no"></div></div>`;
    const subRows = (r) => { const l = [...r.subs.values()].filter((s) => s.working || s.have || s.stock || s.approved).sort((a, b) => a.name.localeCompare(b.name)); return l.length === 1 && l[0].id === '-' ? [] : l; };
    const draw = () => {
      const rg = host.querySelector('#pd-reg').value;
      const list = cv.rows.filter((r) => !rg || r.id === rg);
      host.querySelector('#pd-rows').innerHTML = list.map((r) => rowHtml(r, false, r.id) + subRows(r).map((s) => rowHtml(s, true, r.id)).join('')).join('') || '<tr><td colspan="9" class="hint">Nothing to show yet.</td></tr>';
      const q = norm(host.querySelector('#pd-q').value);
      const np = cv.noPos.filter((x) => (!rg || x.region === rg) && (!q || norm(x.name + x.emp).includes(q)));
      host.querySelector('#pd-no').innerHTML = np.length ? `<div style="overflow-x:auto;max-height:380px"><table><thead><tr><th>Rider</th><th>Employee ID</th><th>Region</th><th>Sub-region / City</th><th></th></tr></thead><tbody>${np.slice(0, 200).map((x) => `<tr><td>${esc(x.name)}</td><td class="mono">${esc(x.emp)}</td><td>${esc(d.regName.get(x.region) || '—')}</td><td>${esc(d.subName.get(x.sub) || '—')}</td><td>${d.machines.some((m) => m.status === 'in_stock') ? `<button class="btn small" data-issue-to="${x.rid}">Issue POS</button>` : '<span class="hint">no stock</span>'}</td></tr>`).join('')}</tbody></table></div>${np.length > 200 ? '<p class="hint">Showing 200 of ' + np.length + '. Download for the full list.</p>' : ''}` : '<p class="hint">✅ Everyone on the roster has a POS' + (rg ? ' in this region' : '') + '.</p>';
    };
    draw();
    host.querySelector('#pd-reg').onchange = draw; host.querySelector('#pd-q').oninput = draw;
    host.onclick = async (e) => {
      const h = e.target.closest('[data-hc]'); if (h) { const [k, id] = h.dataset.hc.split(':'); const cur = (k === 'r' ? d.regs : d.subs).find((x) => x.id === id); const v = prompt('Approved headcount for ' + cur.name + ' (a whole number, empty to clear)', cur.approved_headcount == null ? '' : cur.approved_headcount); if (v === null) return; const n = v.trim() === '' ? null : parseInt(v, 10); if (n !== null && (!Number.isInteger(n) || n < 0)) { toast('Enter a whole number'); return; } const r = await sb.from(k === 'r' ? 'regions' : 'sub_regions').update({ approved_headcount: n }).eq('id', id); if (r.error) { toast('Could not save: ' + r.error.message); return; } toast('Saved'); reload(); return; }
      const i = e.target.closest('[data-issue-to]'); if (i) issueModal({ riderId: i.dataset.issueTo });
    };
    host.querySelector('#pd-dl').onclick = async () => {
      const out = []; cv.rows.forEach((r) => { [r, ...[...r.subs.values()].filter((s) => s.working || s.have || s.stock || s.approved)].forEach((x, i) => out.push({ Region: r.name, 'Sub-Region / City': i ? x.name : '(whole region)', Approved: x.approved ?? '', Working: x.working, 'Have POS': x.have, 'No POS': x.nopos, 'In stock': x.stock, 'In repair': x.repair, 'Charger pending': x.chg, 'POS needed': x.need })); });
      await xl(out, 'Coverage', 'pos-coverage.xlsx');
    };
    host.querySelector('#pd-dl2').onclick = () => xl(cv.noPos.map((x) => ({ Rider: x.name, 'Employee ID': x.emp, Region: d.regName.get(x.region) || '', 'Sub-Region / City': d.subName.get(x.sub) || '' })), 'No POS', 'riders-without-pos.xlsx');
  }
  async function xl(rows, sheet, file) {
    try { await ensureXLSX(); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{}]), sheet); await fhSaveXlsx(wb, file); } catch (e) { toast('Could not make the file: ' + (e.message || e)); }
  }

  // ---------------------------------------------------------------- MACHINES
  const machineRow = (m, d) => `<tr><td><input type="checkbox" data-sel="${m.id}" ${P.sel.has(m.id) ? 'checked' : ''}></td>
    <td>${esc(m.rider_name || '—')}${m.employee_id && !m.rider_id ? ' <span title="No portal login matches this Employee ID" style="color:#b9770e">⚠</span>' : ''}</td><td class="mono">${esc(m.employee_id || '')}</td><td class="mono">${esc(m.nexus_id || '')}</td>
    <td>${esc(d.regName.get(regionOf(m, d)) || '')}</td><td>${esc(d.subName.get(subOf(m, d)) || '')}</td><td class="mono">${esc(m.sn)}</td><td class="mono">${esc(m.mid || '')}</td><td class="mono">${esc(m.tid || '')}</td><td>${esc(m.bank_name || '')}</td><td>${fd(m.issued_date)}</td>
    <td>${m.status === 'issued' || m.status === 'in_repair' ? (m.charger_given ? '<span class="badge active">Given</span>' : '<span class="badge open">Pending</span>') : '—'}</td><td>${badge(m.status)}</td>
    <td style="white-space:nowrap"><button class="btn small outline" data-edit="${m.id}">Edit</button> <button class="btn small outline" data-hist="${m.id}">History</button>${m.status === 'in_stock' ? ` <button class="btn small" data-issue="${m.id}">Issue</button>` : ''}${m.status === 'issued' || m.status === 'retired' ? ` <button class="btn small outline" data-back="${m.id}">Take back</button>` : ''}</td></tr>`;
  function filtered(d) {
    const f = P.f, q = norm(f.q);
    return d.machines.filter((m) => (!f.status || m.status === f.status) && (!f.region || regionOf(m, d) === f.region) && (!f.bank || norm(m.bank_name) === norm(f.bank)) &&
      (!f.charger || ((m.status === 'issued' || m.status === 'in_repair') && (f.charger === 'pending' ? !m.charger_given : m.charger_given))) && (!f.link || (m.employee_id && !m.rider_id)) &&
      (!q || norm([m.sn, m.mid, m.tid, m.rider_name, m.employee_id, m.nexus_id, m.bank_name].join(' ')).includes(q)));
  }
  function pageStock(host) {
    const d = P.data, f = P.f;
    const banks = [...new Set(d.machines.map((m) => (m.bank_name || '').trim()).filter(Boolean))].sort();
    host.innerHTML = `<div class="card"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
      <input id="ps-q" class="input" placeholder="Search S/N, MID, TID, rider, ID…" value="${esc(f.q)}" style="max-width:240px">
      <select id="ps-st" class="input" style="max-width:130px"><option value="">All status</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select>
      <select id="ps-rg" class="input" style="max-width:150px"><option value="">All regions</option>${d.regs.map((r) => `<option value="${r.id}" ${f.region === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
      <select id="ps-bk" class="input" style="max-width:140px"><option value="">All banks</option>${banks.map((b) => `<option ${norm(f.bank) === norm(b) ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>
      <select id="ps-ch" class="input" style="max-width:150px"><option value="">Charger: all</option><option value="pending" ${f.charger === 'pending' ? 'selected' : ''}>Charger pending</option><option value="given" ${f.charger === 'given' ? 'selected' : ''}>Charger given</option></select>
      <label class="hint"><input type="checkbox" id="ps-lk" ${f.link ? 'checked' : ''}> Not linked to a login</label></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"><button class="btn small" id="ps-add" type="button">+ Add machine</button><button class="btn small outline" id="ps-up" type="button">⬆ Upload Excel</button><button class="btn small outline" id="ps-tpl" type="button">Template</button><button class="btn small outline" id="ps-dl" type="button">⬇ Download</button><button class="btn small outline" id="ps-link" type="button" title="Match Employee IDs to rider logins">Link riders</button>
        <span style="flex:1"></span><span class="hint" id="ps-selinfo"></span>
        <button class="btn small outline" data-bulk="chg1" type="button">Charger given</button><button class="btn small outline" data-bulk="chg0" type="button">Charger pending</button><button class="btn small outline" data-bulk="rep" type="button">Send to Accounts…</button></div>
      <div id="ps-res"></div><div id="ps-table"></div></div>`;
    const draw = () => {
      const rows = filtered(d);
      host.querySelector('#ps-table').innerHTML = rows.length ? `<p class="hint">${rows.length} machine${rows.length === 1 ? '' : 's'}</p><div style="overflow-x:auto"><table><thead><tr><th><input type="checkbox" id="ps-all"></th><th>Rider</th><th>Emp ID</th><th>Nexus ID</th><th>Region</th><th>Sub-region / City</th><th>S/N</th><th>MID</th><th>TID</th><th>Bank</th><th>Issued</th><th>Charger</th><th>Status</th><th></th></tr></thead><tbody>${rows.slice(0, P.shown).map((m) => machineRow(m, d)).join('')}</tbody></table></div>${rows.length > P.shown ? `<button class="btn small outline" id="ps-more" style="margin-top:8px">Show 100 more (${rows.length - P.shown} left)</button>` : ''}` : '<div class="empty-state"><p>No machines match.</p></div>';
      info();
    };
    const info = () => { host.querySelector('#ps-selinfo').textContent = P.sel.size ? P.sel.size + ' selected' : ''; };
    const bind = (id, k) => { const e = host.querySelector(id); e.onchange = e.oninput = () => { f[k] = e.type === 'checkbox' ? (e.checked ? '1' : '') : e.value; P.shown = 100; draw(); }; };
    bind('#ps-q', 'q'); bind('#ps-st', 'status'); bind('#ps-rg', 'region'); bind('#ps-bk', 'bank'); bind('#ps-ch', 'charger'); bind('#ps-lk', 'link');
    draw();
    host.onclick = async (e) => {
      const t = e.target;
      if (t.id === 'ps-more') { P.shown += 100; draw(); return; }
      if (t.id === 'ps-all') { filtered(d).slice(0, P.shown).forEach((m) => (t.checked ? P.sel.add(m.id) : P.sel.delete(m.id))); draw(); return; }
      if (t.dataset.sel) { t.checked ? P.sel.add(t.dataset.sel) : P.sel.delete(t.dataset.sel); info(); return; }
      const b = t.closest('button'); if (!b) return;
      if (b.id === 'ps-add') return editModal(null);
      if (b.dataset.edit) return editModal(d.mById.get(b.dataset.edit));
      if (b.dataset.hist) return historyModal(d.mById.get(b.dataset.hist));
      if (b.dataset.issue) return issueModal({ machineId: b.dataset.issue });
      if (b.dataset.back) { const m = d.mById.get(b.dataset.back); const why = prompt('Take back ' + m.sn + ' from ' + (m.rider_name || 'the rider') + '? Add a remark (optional):', ''); if (why === null) return; if (await rpc('fh_pos_take_back', { p_machine: m.id, p_remark: why }, 'Returned to stock')) reload(); return; }
      if (b.id === 'ps-up') return uploadModal();
      if (b.id === 'ps-tpl') return xl([{ 'Rider Name': 'Ali Khan', 'Employee ID': '12345', 'Nexus ID': 'NX-001', 'Region Name': 'Lahore', 'Sub Region/City Name': 'Lahore', 'S/N': 'SN123456', MID: '000111222', TID: '12345678', 'Bank Name': 'HBL', 'Issued Date': '01-11-2026', 'Charger Given': 'Yes' }, { 'Rider Name': '', 'Employee ID': '', 'Nexus ID': '', 'Region Name': '', 'Sub Region/City Name': '', 'S/N': 'SN123457', MID: '', TID: '', 'Bank Name': 'Meezan', 'Issued Date': '', 'Charger Given': '' }], 'POS', 'pos-template.xlsx');
      if (b.id === 'ps-dl') return xl(filtered(d).map((m) => ({ 'Rider Name': m.rider_name || '', 'Employee ID': m.employee_id || '', 'Nexus ID': m.nexus_id || '', 'Region Name': d.regName.get(regionOf(m, d)) || '', 'Sub Region/City Name': d.subName.get(subOf(m, d)) || '', 'S/N': m.sn, MID: m.mid || '', TID: m.tid || '', 'Bank Name': m.bank_name || '', 'Issued Date': m.issued_date || '', 'Charger Given': m.charger_given ? 'Yes' : 'No', Status: (STATUS[m.status] || [m.status])[0] })), 'POS', 'pos-machines.xlsx');
      if (b.id === 'ps-link') { const n = await rpc('fh_pos_link', {}, null); if (n !== false) { toast(n + ' machine(s) linked to rider logins'); reload(); } return; }
      if (b.dataset.bulk) {
        const ids = [...P.sel]; if (!ids.length) { toast('Tick the machines first'); return; }
        if (b.dataset.bulk === 'rep') return repairModal(ids);
        if (await rpc('fh_pos_set_charger', { p_ids: ids, p_given: b.dataset.bulk === 'chg1' }, 'Updated')) { P.sel.clear(); reload(); }
      }
    };
  }

  // ---- add / edit
  function editModal(m) {
    const d = P.data, x = m || {};
    openModal(`<h2>${m ? 'Edit machine' : 'Add machine'}</h2><form id="pe-form">
      <div class="form-row"><label>S/N (serial number) *</label><input id="pe-sn" required value="${esc(x.sn)}"></div>
      <div class="form-row"><label>Bank name</label><input id="pe-bank" value="${esc(x.bank_name)}"></div>
      <div class="form-row"><label>MID</label><input id="pe-mid" value="${esc(x.mid)}"></div><div class="form-row"><label>TID</label><input id="pe-tid" value="${esc(x.tid)}"></div>
      <div class="form-row"><label>Rider Employee ID</label><input id="pe-emp" value="${esc(x.employee_id)}" placeholder="leave empty for stock"></div>
      <div class="form-row"><label>Rider name</label><input id="pe-name" value="${esc(x.rider_name)}"></div><div class="form-row"><label>Nexus ID</label><input id="pe-nx" value="${esc(x.nexus_id)}"></div>
      <div class="form-row"><label>Region</label><select id="pe-reg"><option value="">—</option>${d.regs.map((r) => `<option value="${r.id}" ${x.region_id === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
      <div class="form-row"><label>Sub-region / City</label><select id="pe-sub"><option value="">—</option>${d.subs.map((s) => `<option value="${s.id}" ${x.sub_region_id === s.id ? 'selected' : ''}>${esc(d.regName.get(s.region_id) || '')} – ${esc(s.name)}</option>`).join('')}</select></div>
      <div class="form-row"><label>Issued date</label><input type="date" id="pe-date" value="${esc(x.issued_date || '')}"></div>
      <div class="form-row"><label><input type="checkbox" id="pe-chg" ${x.charger_given ? 'checked' : ''}> Charger given</label></div>
      <button class="btn-primary" type="submit">Save</button></form>`);
    document.getElementById('pe-form').onsubmit = async (ev) => {
      ev.preventDefault();
      const v = (id) => document.getElementById(id).value.trim() || null;
      const emp = v('pe-emp'); let rider = null;
      if (emp) { const r = await sb.from('profiles').select('id, full_name, employee_id').ilike('employee_id', emp).limit(1); rider = r.data && r.data[0]; }
      const row = { sn: v('pe-sn'), bank_name: v('pe-bank'), mid: v('pe-mid'), tid: v('pe-tid'), employee_id: emp, rider_id: rider ? rider.id : null, rider_name: v('pe-name') || (rider ? rider.full_name : null), nexus_id: v('pe-nx'), region_id: v('pe-reg'), sub_region_id: v('pe-sub'), issued_date: v('pe-date'), charger_given: document.getElementById('pe-chg').checked, updated_at: new Date().toISOString() };
      if (!m) row.status = (emp || row.rider_name) ? 'issued' : 'in_stock';
      const r = m ? await sb.from('pos_machines').update(row).eq('id', m.id) : await sb.from('pos_machines').insert(row);
      if (r.error) { toast(/duplicate|unique/i.test(r.error.message) ? 'That S/N already exists' : 'Could not save: ' + r.error.message); return; }
      closeModal(); toast('Saved'); reload();
    };
  }
  async function historyModal(m) {
    const [ev, rp] = await Promise.all([sb.from('pos_events').select('*').eq('machine_id', m.id).order('created_at', { ascending: false }).limit(60), sb.from('pos_repairs').select('*').eq('machine_id', m.id).order('created_at', { ascending: false })]);
    const rows = [...(ev.data || []).map((e) => ({ t: e.created_at, a: e.action.replace(/_/g, ' '), d: e.detail })), ...(rp.data || []).map((r) => ({ t: r.created_at, a: 'fault: ' + (r.fault_name || '—'), d: REPAIR_STATUS[r.status] + (r.remark ? ' — ' + r.remark : '') }))].sort((a, b) => String(b.t).localeCompare(String(a.t)));
    openModal(`<h2>History — ${esc(m.sn)}</h2><p class="hint">${esc(m.bank_name || '')} · MID ${esc(m.mid || '—')} · TID ${esc(m.tid || '—')}</p>${rows.length ? rows.map((r) => `<div style="padding:6px 0;border-top:1px solid var(--line,#e5e7ef)"><div class="hint">${esc(new Date(r.t).toLocaleString())}</div><b>${esc(r.a)}</b> ${esc(r.d || '')}</div>`).join('') : '<p class="hint">Nothing recorded yet.</p>'}`);
  }

  // ---- issue (from stock to a rider; also a replacement)
  function issueModal(o) {
    const d = P.data, stock = d.machines.filter((m) => m.status === 'in_stock');
    if (!stock.length) { toast('No machine in stock to issue'); return; }
    const rep = o.repairId ? d.repairs.find((r) => r.id === o.repairId) : null;
    const riderId = o.riderId || (rep && rep.rider_id) || '';
    const mach = o.machineId ? d.mById.get(o.machineId) : null;
    openModal(`<h2>${rep ? 'Issue replacement POS' : 'Issue POS'}</h2><form id="pi-form">
      <div class="form-row"><label>Machine (in stock)</label>${mach ? `<input value="${esc(mach.sn)} · ${esc(mach.bank_name || '')}" disabled>` : `<select id="pi-m">${stock.map((m) => `<option value="${m.id}">${esc(m.sn)} · ${esc(m.bank_name || '')} · TID ${esc(m.tid || '—')}</option>`).join('')}</select>`}</div>
      <div class="form-row"><label>Rider</label>${riderId ? `<input value="${esc((d.rid.get(riderId) || {}).full_name || (rep && rep.rider_name) || '')} (${esc((d.rid.get(riderId) || {}).employee_id || '')})" disabled>` : `<input id="pi-find" list="pi-list" placeholder="Type name or Employee ID" autocomplete="off"><datalist id="pi-list">${d.riders.filter((r) => r.status === 'active').map((r) => `<option value="${esc(r.full_name)} (${esc(r.employee_id || '')})">`).join('')}</datalist>`}</div>
      <div class="form-row"><label>Issued date</label><input type="date" id="pi-date" value="${new Date().toLocaleDateString('en-CA')}"></div>
      <div class="form-row"><label><input type="checkbox" id="pi-chg"> Charger given with this machine</label><span class="hint">Leave unticked if the charger is still pending.</span></div>
      <button class="btn-primary" type="submit">Issue</button></form>`);
    document.getElementById('pi-form').onsubmit = async (ev) => {
      ev.preventDefault();
      let rid = riderId;
      if (!rid) { const t = document.getElementById('pi-find').value.trim(); const hit = d.riders.find((r) => `${r.full_name} (${r.employee_id || ''})` === t) || d.riders.find((r) => norm(r.employee_id) === norm(t)); if (!hit) { toast('Choose a rider from the list'); return; } rid = hit.id; }
      const mid = mach ? mach.id : document.getElementById('pi-m').value;
      if (await rpc('fh_pos_issue', { p_machine: mid, p_rider: rid, p_charger: document.getElementById('pi-chg').checked, p_date: document.getElementById('pi-date').value || null, p_replaces_repair: o.repairId || null }, 'POS issued')) { closeModal(); reload(); }
    };
  }

  // ---- send to Accounts
  function repairModal(ids) {
    const d = P.data; const ms = ids.map((i) => d.mById.get(i)).filter((m) => m && (m.status === 'issued' || m.status === 'in_stock'));
    if (!ms.length) { toast('Only issued or in-stock machines can be sent'); return; }
    openModal(`<h2>Send to Accounts for repair</h2><p class="hint">${ms.length} machine(s): ${esc(ms.slice(0, 5).map((m) => m.sn).join(', '))}${ms.length > 5 ? '…' : ''}</p><form id="pr-form">
      <div class="form-row"><label>Fault *</label><select id="pr-f" required>${faultOpts(d)}</select></div><div class="form-row"><label>Remark</label><textarea id="pr-r" rows="2" maxlength="300"></textarea></div>
      <label class="hint"><input type="checkbox" id="pr-dl" checked> Also download the list for Accounts</label><br><button class="btn-primary" type="submit" style="margin-top:8px">Send to Accounts</button></form>`);
    document.getElementById('pr-form').onsubmit = async (ev) => {
      ev.preventDefault(); const f = document.getElementById('pr-f').value, rem = document.getElementById('pr-r').value;
      const n = await rpc('fh_pos_send_repair', { p_ids: ms.map((m) => m.id), p_fault: f, p_remark: rem }, null); if (n === false) return;
      if (document.getElementById('pr-dl').checked) { const fn = (d.faults.find((x) => x.id === f) || {}).name || ''; await xl(ms.map((m) => ({ 'S/N': m.sn, MID: m.mid || '', TID: m.tid || '', Bank: m.bank_name || '', Rider: m.rider_name || '', 'Employee ID': m.employee_id || '', Fault: fn, Remark: rem, 'Sent on': new Date().toLocaleDateString('en-GB') })), 'For Accounts', 'pos-for-accounts.xlsx'); }
      closeModal(); toast(n + ' machine(s) sent to Accounts'); P.sel.clear(); reload();
    };
  }

  // ---------------------------------------------------------------- Excel upload
  const COLS = { rider_name: ['ridername', 'name', 'employeename', 'fullname', 'rider'], employee_id: ['employeeid', 'empid', 'employeeno', 'empno', 'eid', 'employeecode'], nexus_id: ['nexusid', 'nexus'], region: ['regionname', 'region'], sub_region: ['subregioncityname', 'subregioncity', 'subregion', 'cityname', 'city', 'subregionorcity'], sn: ['sn', 'serialno', 'serialnumber', 'serial', 'snno'], mid: ['mid', 'merchantid'], tid: ['tid', 'terminalid'], bank: ['bankname', 'bank'], issued_date: ['issueddate', 'issueddata', 'dateissued', 'issuedon', 'issued'], charger: ['chargergiven', 'charger', 'chargerstatus'] };
  function isoDate(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') { const dt = new Date(Math.round((v - 25569) * 86400000)); return isNaN(dt) ? '' : dt.toISOString().slice(0, 10); }
    const s = String(v).trim(); let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/); if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
    const dt = new Date(s); return isNaN(dt) ? '' : dt.toISOString().slice(0, 10);
  }
  function uploadModal() {
    openModal(`<h2>Upload POS Excel</h2><p class="hint">Columns: Rider Name, Employee ID, Nexus ID, Region Name, Sub Region/City Name, S/N, MID, TID, Bank Name, Issued Date, Charger Given. <b>S/N is the key</b>: new S/N are added, existing ones are updated. Empty cells never erase saved data. Rows without a rider are added as stock.</p>
      <input type="file" id="pu-file" accept=".xlsx,.xls,.csv"><div id="pu-prev" style="margin-top:10px"></div>`);
    let rows = [];
    document.getElementById('pu-file').onchange = async (ev) => {
      const f = ev.target.files && ev.target.files[0]; if (!f) return; const prev = document.getElementById('pu-prev'); prev.innerHTML = '<span class="hint">Reading…</span>';
      try {
        await ensureXLSX(); const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: false }); const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
        if (!raw.length) { prev.innerHTML = '<span class="badge open">The sheet is empty</span>'; return; }
        const heads = Object.keys(raw[0]), map = {}; Object.entries(COLS).forEach(([k, syn]) => { const h = heads.find((x) => syn.includes(norm(x))); if (h) map[k] = h; });
        if (!map.sn) { prev.innerHTML = '<span class="badge open">No S/N column found. Use the Template.</span>'; return; }
        rows = raw.map((r) => { const o = {}; Object.keys(COLS).forEach((k) => { const v = map[k] ? r[map[k]] : ''; o[k] = k === 'issued_date' ? isoDate(v) : String(v == null ? '' : v).trim(); }); return o; }).filter((r) => Object.values(r).some(Boolean));
        const have = new Set(P.data.machines.map((m) => norm(m.sn))), upd = rows.filter((r) => have.has(norm(r.sn))).length;
        const dup = rows.length - new Set(rows.map((r) => norm(r.sn))).size;
        prev.innerHTML = `<p><b>${rows.length}</b> rows: about <b>${rows.length - upd}</b> new, <b>${upd}</b> updates${dup ? ` · <span style="color:#c0392b">${dup} repeated S/N in the file (the last one wins)</span>` : ''}.</p><p class="hint">Columns found: ${Object.keys(map).map((k) => esc(map[k])).join(', ')}</p><button class="btn-primary" id="pu-go" type="button">Apply to the portal</button><div id="pu-res"></div>`;
        document.getElementById('pu-go').onclick = async () => {
          const go = document.getElementById('pu-go'); go.disabled = true; go.textContent = 'Saving…';
          let ins = 0, up = 0, sk = 0; const warns = [];
          for (let i = 0; i < rows.length; i += 200) {
            const r = await sb.rpc('fh_pos_bulk', { p_rows: rows.slice(i, i + 200) }); if (r.error) { toast('Stopped: ' + r.error.message); break; }
            ins += r.data.inserted; up += r.data.updated; sk += r.data.skipped; (r.data.warnings || []).forEach((w) => warns.push(`Row ${i + w.row}: ${w.msg}`));
          }
          document.getElementById('pu-res').innerHTML = `<p style="margin-top:10px"><span class="badge active">${ins} added · ${up} updated${sk ? ' · ' + sk + ' skipped' : ''}</span></p>${warns.length ? `<div style="max-height:180px;overflow:auto" class="hint">${warns.slice(0, 80).map(esc).join('<br>')}${warns.length > 80 ? '<br>…' : ''}</div>` : ''}`;
          go.remove(); reload();
        };
      } catch (e) { prev.innerHTML = '<span class="badge open">' + esc(e.message || e) + '</span>'; }
    };
  }

  // ---------------------------------------------------------------- REPAIRS
  function pageRepairs(host) {
    const d = P.data, T = P.tab;
    const by = { reported: d.repairs.filter((r) => r.status === 'reported'), with_accounts: d.repairs.filter((r) => r.status === 'with_accounts'), closed: d.repairs.filter((r) => ['repaired', 'irreparable', 'cancelled'].includes(r.status)) };
    const tab = (k, l) => `<button class="btn small ${T === k ? '' : 'outline'}" data-tab="${k}">${l} (${by[k].length})</button>`;
    const list = by[T].slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const mach = (r) => d.mById.get(r.machine_id) || {};
    host.innerHTML = `<div class="card"><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">${tab('reported', 'Reported by riders')}${tab('with_accounts', 'With Accounts')}${tab('closed', 'Closed')}<span style="flex:1"></span><button class="btn small outline" data-act="faults">Manage fault types</button></div>
      ${list.length ? `<div style="overflow-x:auto"><table><thead><tr><th>S/N</th><th>MID / TID</th><th>Bank</th><th>Rider</th><th>Fault</th><th>${T === 'reported' ? 'Reported' : 'Sent'}</th>${T === 'closed' ? '<th>Result</th><th>Replacement</th>' : ''}<th></th></tr></thead><tbody>${list.map((r) => {
        const m = mach(r), rep = r.replacement_machine_id ? d.mById.get(r.replacement_machine_id) : null;
        return `<tr><td class="mono">${esc(m.sn || '—')}</td><td class="mono">${esc(m.mid || '')} / ${esc(m.tid || '')}</td><td>${esc(m.bank_name || '')}</td><td>${esc(r.rider_name || '—')} <span class="mono">${esc(r.rider_employee_id || '')}</span></td><td>${esc(r.fault_name || '—')}${r.remark ? `<div class="hint">${esc(r.remark)}</div>` : ''}</td>
          <td>${fd(T === 'reported' ? r.reported_at : r.sent_date)}</td>${T === 'closed' ? `<td>${esc(REPAIR_STATUS[r.status])}<div class="hint">${fd(r.returned_date)} ${esc(r.outcome_remark || '')}</div></td><td class="mono">${rep ? esc(rep.sn) : '—'}</td>` : ''}
          <td style="white-space:nowrap">${T === 'reported' ? `<button class="btn small" data-send="${r.machine_id}">Send to Accounts</button> <button class="btn small outline" data-res="${r.id}:cancelled">Dismiss</button>` : ''}${T === 'with_accounts' ? `<button class="btn small" data-res="${r.id}:repaired">Repaired</button> <button class="btn small outline" data-res="${r.id}:irreparable">Cannot repair</button> ${!r.replacement_machine_id ? `<button class="btn small outline" data-repl="${r.id}">Issue replacement</button>` : '<span class="badge active">Replaced</span>'}` : ''}${T === 'closed' && r.status === 'irreparable' && !r.replacement_machine_id && m.rider_id ? `<button class="btn small" data-repl="${r.id}">Issue replacement</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty-state"><p>Nothing here.</p></div>'}</div>`;
    host.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.tab) { P.tab = b.dataset.tab; return pageRepairs(host); }
      if (b.dataset.act === 'faults') { settingsTab = 'posfaults'; return navigateTo('settings'); }
      if (b.dataset.send) return repairModal([b.dataset.send]);
      if (b.dataset.repl) return issueModal({ repairId: b.dataset.repl });
      if (b.dataset.res) { const [id, out] = b.dataset.res.split(':'); const rem = prompt(out === 'repaired' ? 'Machine repaired and received back. Remark (optional):' : out === 'irreparable' ? 'Cannot be repaired. Remark (optional):' : 'Dismiss this report? Remark (optional):', ''); if (rem === null) return; if (await rpc('fh_pos_repair_result', { p_repair: id, p_outcome: out, p_remark: rem }, 'Saved')) reload(); }
    };
  }

  // ---------------------------------------------------------------- SETTINGS: fault types
  window.renderPosFaultsSettings = async function (body) {
    if (!isSuperAdmin()) { body.innerHTML = '<p class="hint">Only the Super Admin can open this.</p>'; return; }
    const r = await sb.from('pos_fault_types').select('*').order('sort_order').order('name');
    if (r.error) { body.innerHTML = '<h3>POS Fault Types</h3>' + (missing(r.error) ? '<p class="hint">Not set up yet: run <b>migration_56.sql</b> in Supabase.</p>' : '<p class="hint">' + esc(r.error.message) + '</p>'); return; }
    const list = r.data || [];
    body.innerHTML = `<h3 style="margin-top:0">POS Fault Types</h3><p class="hint">These are the reasons offered when a POS is reported or sent for repair. Hiding a type keeps old records intact.</p>
      ${list.map((f) => `<div class="card" style="padding:8px 10px;margin-bottom:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="flex:1;min-width:140px">${esc(f.name)}</b>${f.active ? '' : '<span class="hint">(hidden)</span>'}<button class="btn small outline" data-ren="${f.id}">Rename</button><button class="btn small outline" data-tog="${f.id}">${f.active ? 'Hide' : 'Show'}</button><button class="btn small outline" data-del="${f.id}">Delete</button></div>`).join('') || '<p class="hint">None yet.</p>'}
      <form id="pf-add" style="display:flex;gap:8px;margin-top:12px"><input id="pf-name" class="input" maxlength="60" placeholder="New fault type, e.g. Network error" style="flex:1"><button class="btn small" type="submit">Add</button></form>`;
    const done = () => renderSettings();
    body.querySelector('#pf-add').onsubmit = async (e) => { e.preventDefault(); const n = body.querySelector('#pf-name').value.trim(); if (!n) return; const x = await sb.from('pos_fault_types').insert({ name: n, sort_order: (list.length + 1) * 10 }); if (x.error) { toast(/duplicate|unique/i.test(x.error.message) ? 'That name already exists' : 'Could not save: ' + x.error.message); return; } toast('Added'); done(); };
    body.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.ren) { const f = list.find((x) => x.id === b.dataset.ren); const n = prompt('Rename fault type', f.name); if (!n || !n.trim()) return; const x = await sb.from('pos_fault_types').update({ name: n.trim() }).eq('id', f.id); if (x.error) { toast('Could not save: ' + x.error.message); return; } done(); }
      if (b.dataset.tog) { const f = list.find((x) => x.id === b.dataset.tog); await sb.from('pos_fault_types').update({ active: !f.active }).eq('id', f.id); done(); }
      if (b.dataset.del) { if (!confirm('Delete this fault type? Past repairs keep its name.')) return; await sb.from('pos_fault_types').delete().eq('id', b.dataset.del); done(); }
    };
  };

  // ---------------------------------------------------------------- RIDER: my POS card (Dashboard + My Profile)
  window.fhPosRiderHtml = async function () {
    if (!state.user) return '';
    let ms = [], rp = [];
    try {
      const a = await sb.from('pos_machines').select('*').eq('rider_id', state.user.id).in('status', ['issued', 'in_repair', 'retired']).order('issued_date', { ascending: false });
      if (a.error) return ''; ms = a.data || [];
      const b = await sb.from('pos_repairs').select('machine_id, status, fault_name').eq('rider_id', state.user.id).in('status', ['reported', 'with_accounts']); rp = b.data || [];
    } catch (_) { return ''; }
    ms = ms.filter((m) => m.status !== 'retired' || !ms.some((x) => x.status !== 'retired'));
    if (!ms.length) return '';
    const names = {}; try { const r = await sb.from('regions').select('id, name'); (r.data || []).forEach((x) => (names[x.id] = x.name)); } catch (_) {}
    return `<div class="card" id="fh-pos-card"><h3 style="margin-top:0">💳 My POS machine</h3>${ms.map((m) => {
      const open = rp.find((r) => r.machine_id === m.id);
      return `<div style="padding:8px 0;border-top:1px solid var(--line,#e5e7ef)"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px 14px">
        <div><span class="hint">Bank</span><br><b>${esc(m.bank_name || '—')}</b></div><div><span class="hint">MID</span><br><b class="mono">${esc(m.mid || '—')}</b></div><div><span class="hint">TID</span><br><b class="mono">${esc(m.tid || '—')}</b></div><div><span class="hint">S/N</span><br><b class="mono">${esc(m.sn)}</b></div>
        <div><span class="hint">Nexus ID</span><br><b class="mono">${esc(m.nexus_id || '—')}</b></div><div><span class="hint">Issued</span><br><b>${fd(m.issued_date)}</b></div>
        <div><span class="hint">Charger</span><br>${m.charger_given ? '<span class="badge active">Given</span>' : '<span class="badge open">Not received yet</span>'}</div><div><span class="hint">Status</span><br>${badge(m.status)}</div></div>
        ${open ? `<p class="hint" style="margin:8px 0 0">🔧 Fault reported (${esc(open.fault_name || '')}): ${open.status === 'with_accounts' ? 'with Accounts for repair' : 'waiting for the Super Admin'}.</p>` : (m.status === 'issued' ? `<button class="btn small outline" data-pos-report="${m.id}" style="margin-top:8px">Report a fault</button>` : '')}</div>`; }).join('')}</div>`;
  };
  window.fhPosRiderBind = function (root) {
    root.querySelectorAll('[data-pos-report]').forEach((b) => b.onclick = async () => {
      const f = await sb.from('pos_fault_types').select('id, name').eq('active', true).order('sort_order');
      openModal(`<h2>Report a POS fault</h2><form id="pr-rf"><div class="form-row"><label>What is wrong? *</label><select id="pr-rt" required><option value="">— choose —</option>${(f.data || []).map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div><div class="form-row"><label>Details (optional)</label><textarea id="pr-rn" rows="2" maxlength="300"></textarea></div><button class="btn-primary" type="submit">Send report</button></form>`);
      document.getElementById('pr-rf').onsubmit = async (e) => {
        e.preventDefault(); const sel = document.getElementById('pr-rt'), p = state.profile;
        const r = await sb.from('pos_repairs').insert({ machine_id: b.dataset.posReport, rider_id: state.user.id, rider_name: p.full_name, rider_employee_id: p.employee_id, fault_type_id: sel.value, fault_name: sel.options[sel.selectedIndex].text, remark: document.getElementById('pr-rn').value.trim() || null, reported_by_rider: true, status: 'reported' });
        if (r.error) { toast(/duplicate|unique/i.test(r.error.message) ? 'A fault is already reported for this machine' : 'Could not send: ' + r.error.message); return; }
        closeModal(); toast('Fault reported to the Super Admin'); const c = document.getElementById('fh-pos-card'); if (c) fhPosMount(c.parentElement, true);
      };
    });
  };
  // inserts / refreshes the card at the top of a page container
  window.fhPosMount = async function (host, refresh) {
    try {
      if (!host || !state.profile || state.profile.role !== 'rider') return;
      const html = await fhPosRiderHtml(); const old = host.querySelector('#fh-pos-card'); if (old) old.remove();
      if (!html || (!refresh && state.view !== 'dashboard' && state.view !== 'myprofile')) return;
      const t = document.createElement('div'); t.innerHTML = html; const card = t.firstElementChild; host.insertBefore(card, host.firstChild); fhPosRiderBind(card);
    } catch (_) {}
  };
})();

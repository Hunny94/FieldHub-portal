/* FieldHub — POS Management (v75). Loaded after app.js and uses its globals (sb, state, toast, openModal, ...).
   Super Admin: Coverage, Machines (Excel upload, issue, charger tracking), Repairs (send to Accounts, replace).
   Riders: see their own machine on the Dashboard and My Profile, and can report a fault.
   Needs migration_56.sql. */
(function () {
  'use strict';
  const esc = (s) => escapeHtml(s == null ? '' : String(s));
  const P = { data: null, f: { q: '', status: '', region: '', bank: '', charger: '', link: '', device: '' }, sel: new Set(), shown: 100, tab: 'reported' };
  const STATUS = { issued: ['Issued', 'active'], in_stock: ['In stock', ''], in_repair: ['In repair', 'open'], retired: ['Retired', ''] };
  const REPAIR_STATUS = { reported: 'Reported by rider', with_accounts: 'With Accounts', repaired: 'Repaired', irreparable: 'Irreparable', cancelled: 'Cancelled' };
  const fd = (d) => (d ? formatDate(d) : '—');
  const DEV = { android: 'Android', non_android: 'Non-Android' };
  const devOpts = (sel) => `<option value="">— choose —</option><option value="android" ${sel === 'android' ? 'selected' : ''}>Android</option><option value="non_android" ${sel === 'non_android' ? 'selected' : ''}>Non-Android</option>`;
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
      host.querySelector('#pd-no').innerHTML = np.length ? `<div style="overflow-x:auto;max-height:380px"><table><thead><tr><th>Rider</th><th>Employee ID</th><th>Region</th><th>Sub-region / City</th><th></th></tr></thead><tbody>${np.slice(0, 200).map((x) => `<tr><td>${esc(x.name)}</td><td class="mono">${esc(x.emp)}</td><td>${esc(d.regName.get(x.region) || '—')}</td><td>${esc(d.subName.get(x.sub) || '—')}</td><td><button class="btn small" data-issue-to="${x.rid}">Issue POS</button></td></tr>`).join('')}</tbody></table></div>${np.length > 200 ? '<p class="hint">Showing 200 of ' + np.length + '. Download for the full list.</p>' : ''}` : '<p class="hint">✅ Everyone on the roster has a POS' + (rg ? ' in this region' : '') + '.</p>';
    };
    draw();
    host.querySelector('#pd-reg').onchange = draw; host.querySelector('#pd-q').oninput = draw;
    host.onclick = async (e) => {
      const h = e.target.closest('[data-hc]'); if (h) { const [k, id] = h.dataset.hc.split(':'); const cur = (k === 'r' ? d.regs : d.subs).find((x) => x.id === id); const v = prompt('Approved headcount for ' + cur.name + ' (a whole number, empty to clear)', cur.approved_headcount == null ? '' : cur.approved_headcount); if (v === null) return; const n = v.trim() === '' ? null : parseInt(v, 10); if (n !== null && (!Number.isInteger(n) || n < 0)) { toast('Enter a whole number'); return; } const r = await sb.from(k === 'r' ? 'regions' : 'sub_regions').update({ approved_headcount: n }).eq('id', id); if (r.error) { toast('Could not save: ' + r.error.message); return; } toast('Saved'); reload(); return; }
      const i = e.target.closest('[data-issue-to]'); if (i) issueNewModal(i.dataset.issueTo);
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
    <td>${esc(d.regName.get(regionOf(m, d)) || '')}</td><td>${esc(d.subName.get(subOf(m, d)) || '')}</td><td class="mono">${esc(m.sn)}</td><td class="mono">${esc(m.mid || '')}</td><td class="mono">${esc(m.tid || '')}</td><td>${esc(m.bank_name || '')}</td><td>${DEV[m.device_type] || '—'}</td><td>${fd(m.issued_date)}</td>
    <td>${m.status === 'issued' || m.status === 'in_repair' ? (m.charger_given ? '<span class="badge active">Given</span>' : '<span class="badge open">Pending</span>') : m.status === 'in_stock' && m.charger_in_stock ? '<span class="badge active" title="Charger came back with the machine">With machine</span>' : '—'}</td><td>${badge(m.status)}</td>
    <td style="white-space:nowrap"><button class="btn small outline" data-edit="${m.id}">Edit</button> <button class="btn small outline" data-hist="${m.id}">History</button>${m.status === 'in_stock' ? ` <button class="btn small" data-issue="${m.id}">Issue</button>` : ''}${m.status === 'retired' ? ` <button class="btn small outline" data-unret="${m.id}">Back to stock</button>` : ''}${m.status === 'issued' || m.status === 'in_stock' ? ` <button class="btn small outline" data-rep1="${m.id}">Send to Accounts</button>` : ''}${m.status === 'issued' || m.status === 'retired' ? ` <button class="btn small outline" data-back="${m.id}">Take back</button>` : ''} <button class="btn small outline" data-del="${m.id}" style="color:#c0392b;border-color:#c0392b">Delete</button></td></tr>`;
  function filtered(d) {
    const f = P.f, q = norm(f.q);
    return d.machines.filter((m) => (!f.status || m.status === f.status) && (!f.region || regionOf(m, d) === f.region) && (!f.bank || norm(m.bank_name) === norm(f.bank)) &&
      (!f.charger || ((m.status === 'issued' || m.status === 'in_repair') && (f.charger === 'pending' ? !m.charger_given : m.charger_given))) && (!f.link || (m.employee_id && !m.rider_id)) && (!f.device || (f.device === 'none' ? !m.device_type : m.device_type === f.device)) &&
      (!q || norm([m.sn, m.mid, m.tid, m.rider_name, m.employee_id, m.nexus_id, m.bank_name].join(' ')).includes(q)));
  }
  function pageStock(host) {
    const d = P.data, f = P.f;
    const banks = [...new Set(d.machines.map((m) => (m.bank_name || '').trim()).filter(Boolean))].sort();
    const cnt = (k, v) => v ? d.machines.filter((m) => k === 'status' ? m.status === v : k === 'device' ? (v === 'none' ? !m.device_type : m.device_type === v) : ((m.status === 'issued' || m.status === 'in_repair') && (v === 'pending' ? !m.charger_given : m.charger_given))).length : d.machines.length;
    const chipRow = (k, label, opts) => `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px"><span class="hint" style="min-width:58px;font-weight:600">${label}</span>${opts.map(([v, l]) => `<button type="button" data-chip="${k}:${v}" class="btn small ${(f[k] || '') === v ? '' : 'outline'}" style="border-radius:999px;padding:5px 12px">${l} <span style="opacity:.7;font-size:11px">${cnt(k, v)}</span></button>`).join('')}</div>`;
    host.innerHTML = `<div class="card"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
      <input id="ps-q" class="input" placeholder="Search S/N, MID, TID, rider, ID…" value="${esc(f.q)}" style="max-width:240px">
      <select id="ps-rg" class="input" style="max-width:150px"><option value="">All regions</option>${d.regs.map((r) => `<option value="${r.id}" ${f.region === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
      <select id="ps-bk" class="input" style="max-width:140px"><option value="">All banks</option>${banks.map((b) => `<option ${norm(f.bank) === norm(b) ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>
      <label class="hint"><input type="checkbox" id="ps-lk" ${f.link ? 'checked' : ''}> Rider has no login yet</label></div>
      <div id="ps-chips" style="margin-bottom:10px">${chipRow('status', 'Status', [['', 'All'], ...Object.entries(STATUS).map(([k, v]) => [k, v[0]])])}${chipRow('device', 'Device', [['', 'All'], ['android', 'Android'], ['non_android', 'Non-Android'], ['none', 'Not set']])}${chipRow('charger', 'Charger', [['', 'All'], ['pending', 'Pending'], ['given', 'Given']])}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"><button class="btn small" id="ps-issue" type="button">💳 Issue POS</button><button class="btn small outline" id="ps-add" type="button">Add to stock</button><button class="btn small outline" id="ps-up" type="button">⬆ Upload Excel</button><button class="btn small outline" id="ps-tpl" type="button">Template</button><button class="btn small outline" id="ps-dl" type="button">⬇ Download</button><button class="btn small outline" id="ps-link" type="button" title="Match Employee IDs to rider logins">Link riders</button>
        <span style="flex:1"></span><span class="hint" id="ps-selinfo"></span>
        <button class="btn small outline" data-bulk="chg1" type="button">Charger given</button><button class="btn small outline" data-bulk="chg0" type="button">Charger pending</button><button class="btn small outline" data-bulk="rep" type="button">Send to Accounts…</button><button class="btn small outline" data-bulk="del" type="button" style="color:#c0392b;border-color:#c0392b">Delete selected</button></div>
      <div id="ps-res"></div><div id="ps-table"></div></div>`;
    const draw = () => {
      const rows = filtered(d);
      host.querySelector('#ps-table').innerHTML = rows.length ? `<p class="hint">${rows.length} machine${rows.length === 1 ? '' : 's'}</p><div style="overflow-x:auto"><table><thead><tr><th><input type="checkbox" id="ps-all" title="Select all ${rows.length} machines (all pages)" ${rows.every((m) => P.sel.has(m.id)) ? 'checked' : ''}></th><th>Rider</th><th>Emp ID</th><th>Nexus ID</th><th>Region</th><th>Sub-region / City</th><th>S/N</th><th>MID</th><th>TID</th><th>Bank</th><th>Device</th><th>Issued</th><th>Charger</th><th>Status</th><th></th></tr></thead><tbody>${rows.slice(0, P.shown).map((m) => machineRow(m, d)).join('')}</tbody></table></div>${rows.length > P.shown ? `<button class="btn small outline" id="ps-more" style="margin-top:8px">Show 100 more (${rows.length - P.shown} left)</button>` : ''}` : '<div class="empty-state"><p>No machines match.</p></div>';
      info();
    };
    const info = () => { host.querySelector('#ps-selinfo').innerHTML = P.sel.size ? P.sel.size + ' selected <button class="btn small outline" id="ps-clr" type="button">Clear</button>' : ''; };
    const bind = (id, k) => { const e = host.querySelector(id); e.onchange = e.oninput = () => { f[k] = e.type === 'checkbox' ? (e.checked ? '1' : '') : e.value; P.shown = 100; draw(); }; };
    bind('#ps-q', 'q'); bind('#ps-rg', 'region'); bind('#ps-bk', 'bank'); bind('#ps-lk', 'link');
    draw();
    host.onclick = async (e) => {
      const t = e.target;
      if (t.id === 'ps-more') { P.shown += 100; draw(); return; }
      if (t.id === 'ps-all') { filtered(d).forEach((m) => (t.checked ? P.sel.add(m.id) : P.sel.delete(m.id))); draw(); return; }
      if (t.id === 'ps-clr') { P.sel.clear(); draw(); return; }
      if (t.dataset.sel) { t.checked ? P.sel.add(t.dataset.sel) : P.sel.delete(t.dataset.sel); info(); return; }
      const b = t.closest('button'); if (!b) return;
      if (b.dataset.chip) { const [k, v] = b.dataset.chip.split(':'); f[k] = v; P.shown = 100; host.querySelector('#ps-chips').innerHTML = [['status', 'Status', [['', 'All'], ...Object.entries(STATUS).map(([k2, v2]) => [k2, v2[0]])]], ['device', 'Device', [['', 'All'], ['android', 'Android'], ['non_android', 'Non-Android'], ['none', 'Not set']]], ['charger', 'Charger', [['', 'All'], ['pending', 'Pending'], ['given', 'Given']]]].map((x) => chipRow(...x)).join(''); draw(); return; }
      if (b.id === 'ps-issue') return issueNewModal();
      if (b.id === 'ps-add') return editModal(null);
      if (b.dataset.del) { const m = d.mById.get(b.dataset.del); if (!confirm('Permanently delete S/N ' + m.sn + (m.rider_name ? ' (issued to ' + m.rider_name + ')' : '') + '?\n\nIts history and repair records are deleted too. This cannot be undone.')) return; if (await rpc('fh_pos_delete', { p_ids: [m.id] }, 'Deleted')) { P.sel.delete(m.id); reload(); } return; }
      if (b.dataset.edit) return editModal(d.mById.get(b.dataset.edit));
      if (b.dataset.hist) return historyModal(d.mById.get(b.dataset.hist));
      if (b.dataset.issue) return issueModal({ machineId: b.dataset.issue });
      if (b.dataset.back) return takeBackModal(d.mById.get(b.dataset.back));
      if (b.dataset.rep1) return repairModal([b.dataset.rep1]);
      if (b.dataset.unret) { if (confirm('Put this retired machine back in stock?') && await rpc('fh_pos_unretire', { p_ids: [b.dataset.unret] }, 'Back in stock')) reload(); return; }
      if (b.id === 'ps-up') return uploadModal();
      if (b.id === 'ps-tpl') return xl([{ 'Rider Name': 'Ali Khan', 'Employee ID': '12345', 'Nexus ID': 'NX-001', 'Region Name': 'Lahore', 'Sub Region/City Name': 'Lahore', 'S/N': 'SN123456', MID: '000111222', TID: '12345678', 'Bank Name': 'HBL', 'Android / Non Android': 'Android', 'Issued Date': '01-11-2026', 'Charger Given': 'Yes' }, { 'Rider Name': '', 'Employee ID': '', 'Nexus ID': '', 'Region Name': '', 'Sub Region/City Name': '', 'S/N': 'SN123457', MID: '', TID: '', 'Bank Name': 'Meezan', 'Android / Non Android': 'Non-Android', 'Issued Date': '', 'Charger Given': '' }], 'POS', 'pos-template.xlsx');
      if (b.id === 'ps-dl') return xl(filtered(d).map((m) => ({ 'Rider Name': m.rider_name || '', 'Employee ID': m.employee_id || '', 'Nexus ID': m.nexus_id || '', 'Region Name': d.regName.get(regionOf(m, d)) || '', 'Sub Region/City Name': d.subName.get(subOf(m, d)) || '', 'S/N': m.sn, MID: m.mid || '', TID: m.tid || '', 'Bank Name': m.bank_name || '', 'Android / Non Android': DEV[m.device_type] || '', 'Issued Date': m.issued_date || '', 'Charger Given': m.charger_given ? 'Yes' : 'No', Status: (STATUS[m.status] || [m.status])[0] })), 'POS', 'pos-machines.xlsx');
      if (b.id === 'ps-link') { const n = await rpc('fh_pos_link', {}, null); if (n !== false) { toast(n + ' machine(s) linked to rider logins'); reload(); } return; }
      if (b.dataset.bulk) {
        const ids = [...P.sel];
        if (b.dataset.bulk === 'rep') return repairModal(ids);
        if (!ids.length) { toast('Tick the machines first'); return; }
        if (b.dataset.bulk === 'del') { if (!confirm('Permanently delete ' + ids.length + ' machine(s) with their history and repair records?\n\nThis cannot be undone.')) return; if (await rpc('fh_pos_delete', { p_ids: ids }, ids.length + ' deleted')) { P.sel.clear(); reload(); } return; }
        if (await rpc('fh_pos_set_charger', { p_ids: ids, p_given: b.dataset.bulk === 'chg1' }, 'Updated')) { P.sel.clear(); reload(); }
      }
    };
  }

  // ---- add / edit
  function editModal(m) {
    const d = P.data, x = m || {};
    openModal(`<h2>${m ? 'Edit machine' : 'Add machine to stock'}</h2><form id="pe-form">
      <div class="form-row"><label>S/N (serial number) *</label><input id="pe-sn" required value="${esc(x.sn)}"></div>
      <div class="form-row"><label>Bank name</label><input id="pe-bank" value="${esc(x.bank_name)}"></div>
      <div class="form-row"><label>Android / Non-Android</label><select id="pe-dev">${devOpts(x.device_type)}</select></div>
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
      const row = { sn: v('pe-sn'), bank_name: v('pe-bank'), mid: v('pe-mid'), tid: v('pe-tid'), employee_id: emp, rider_id: rider ? rider.id : null, rider_name: v('pe-name') || (rider ? rider.full_name : null), nexus_id: v('pe-nx'), device_type: v('pe-dev'), region_id: v('pe-reg'), sub_region_id: v('pe-sub'), issued_date: v('pe-date'), charger_given: document.getElementById('pe-chg').checked, updated_at: new Date().toISOString() };
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

  // riders who are actually working (on the roster), with the region / sub-region the roster gives them
  function workList(d) {
    const has = (rid, pr) => d.holders.has(rid) || (pr && norm(pr.employee_id) && d.holders.has('e:' + norm(pr.employee_id)));
    const out = [];
    d.work.forEach((w, rid) => { const pr = d.rid.get(rid); if (!pr) return; out.push({ id: rid, name: pr.full_name || '', emp: pr.employee_id || '', region: d.regName.get(w.region) || '', sub: d.subName.get(w.sub) || '', has: !!has(rid, pr) }); });
    out.sort((a, b) => Number(a.has) - Number(b.has) || a.name.localeCompare(b.name));
    return out;
  }
  const wLabel = (w) => `${w.name} (${w.emp}) · ${w.region}${w.sub ? ' · ' + w.sub : ''}${w.has ? ' · already has POS' : ''}`;
  // rider picker: type a name / Employee ID, the roster details are filled in (read-only)
  function riderPicker(d, pre) {
    const list = workList(d);
    return { html: `<div class="form-row"><label>Rider (from the roster) *</label><input id="rp-find" list="rp-list" placeholder="Type name or Employee ID" autocomplete="off" ${pre ? 'disabled' : ''}><datalist id="rp-list">${list.map((w) => `<option value="${esc(wLabel(w))}">`).join('')}</datalist></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px"><div class="form-row"><label>Employee ID</label><input id="rp-emp" disabled></div><div class="form-row"><label>Name</label><input id="rp-name" disabled></div>
      <div class="form-row"><label>Region</label><input id="rp-reg" disabled></div><div class="form-row"><label>Sub-region / City</label><input id="rp-sub" disabled></div></div>`,
      bind(onPick) {
        const f = document.getElementById('rp-find'); let cur = null;
        const set = (w) => { cur = w; document.getElementById('rp-emp').value = w ? w.emp : ''; document.getElementById('rp-name').value = w ? w.name : ''; document.getElementById('rp-reg').value = w ? w.region : ''; document.getElementById('rp-sub').value = w ? w.sub : ''; if (onPick) onPick(w); };
        const find = (t) => list.find((w) => wLabel(w) === t) || list.find((w) => norm(w.emp) === norm(t) && norm(t));
        f.oninput = f.onchange = () => set(find(f.value.trim()) || null);
        if (pre) { const w = list.find((x) => x.id === pre); if (w) { f.value = wLabel(w); set(w); } }
        return () => cur;
      } };
  }
  // ---- Issue POS: rider from the roster + machine details
  const ROSTER_ONLY = /lahore|kasur|raiwind/i;   // riders of these regions must come from the roster
  function issueNewModal(preRider, replacesRepair) {
    const d = P.data, rp = riderPicker(d, preRider || '');
    const banks = [...new Set(d.machines.map((m) => (m.bank_name || '').trim()).filter(Boolean))].sort();
    openModal(`<h2>${replacesRepair ? 'Issue replacement POS' : 'Issue POS'}</h2><form id="pn-form"><div id="pn-roster">${rp.html}</div>
      <label class="hint"><input type="checkbox" id="pn-man"> Rider is not on the roster (only for regions other than Lahore, Kasur and Raiwind)</label>
      <div id="pn-manual" style="display:none"><div style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px"><div class="form-row"><label>Employee ID *</label><input id="pm-emp"></div><div class="form-row"><label>Name *</label><input id="pm-name"></div>
        <div class="form-row"><label>Region *</label><select id="pm-reg"><option value="">— choose —</option>${d.regs.map((r) => `<option value="${r.id}" ${ROSTER_ONLY.test(r.name) ? 'disabled' : ''}>${esc(r.name)}${ROSTER_ONLY.test(r.name) ? ' (roster only)' : ''}</option>`).join('')}</select></div>
        <div class="form-row"><label>Sub-region / City</label><select id="pm-sub"><option value="">—</option></select></div></div></div>
      <div class="form-row"><label>S/N (serial number) *</label><input id="pn-sn" required></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px"><div class="form-row"><label>MID</label><input id="pn-mid"></div><div class="form-row"><label>TID</label><input id="pn-tid"></div>
      <div class="form-row"><label>Bank name</label><input id="pn-bank" list="pn-banks"><datalist id="pn-banks">${banks.map((b) => `<option value="${esc(b)}">`).join('')}</datalist></div><div class="form-row"><label>Nexus ID</label><input id="pn-nx"></div></div>
      <div class="form-row"><label>Android / Non-Android *</label><select id="pn-dev" required>${devOpts('')}</select></div>
      <div class="form-row"><label>Issued date</label><input type="date" id="pn-date" value="${new Date().toLocaleDateString('en-CA')}"></div>
      <div class="form-row"><label><input type="checkbox" id="pn-chg"> Charger given with this machine</label><span class="hint">Leave unticked if the charger is still pending.</span></div>
      <button class="btn-primary" type="submit">Issue POS</button></form>`);
    const man = document.getElementById('pn-man');
    man.onchange = () => { document.getElementById('pn-roster').style.display = man.checked ? 'none' : ''; document.getElementById('pn-manual').style.display = man.checked ? '' : 'none'; };
    document.getElementById('pm-reg').onchange = (e) => { document.getElementById('pm-sub').innerHTML = '<option value="">—</option>' + d.subs.filter((x) => x.region_id === e.target.value).map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join(''); };
    const get = rp.bind((w) => { const nx = w && d.machines.find((m) => m.rider_id === w.id && m.nexus_id); const el = document.getElementById('pn-nx'); if (nx && !el.value) el.value = nx.nexus_id; });
    document.getElementById('pn-form').onsubmit = async (ev) => {
      ev.preventDefault(); const v = (id) => document.getElementById(id).value.trim();
      const common = { p_sn: v('pn-sn'), p_mid: v('pn-mid'), p_tid: v('pn-tid'), p_bank: v('pn-bank'), p_nexus: v('pn-nx'), p_device: v('pn-dev'), p_date: v('pn-date') || null, p_charger: document.getElementById('pn-chg').checked };
      if (man.checked) {
        if (!v('pm-emp') || !v('pm-name') || !v('pm-reg')) { toast('Enter Employee ID, name and region'); return; }
        if (await rpc('fh_pos_issue_manual', { p_emp: v('pm-emp'), p_name: v('pm-name'), p_region: v('pm-reg'), p_sub: v('pm-sub') || null, ...common }, 'POS issued')) { closeModal(); reload(); }
        return;
      }
      const w = get(); if (!w) { toast('Choose a rider from the list'); return; }
      if (w.has && !replacesRepair && !confirm(w.name + ' already has a POS. Issue another one?')) return;
      if (await rpc('fh_pos_issue_new', { p_rider: w.id, p_sn: v('pn-sn'), p_mid: v('pn-mid'), p_tid: v('pn-tid'), p_bank: v('pn-bank'), p_nexus: v('pn-nx'), p_device: v('pn-dev'), p_date: v('pn-date') || null, p_charger: document.getElementById('pn-chg').checked, p_replaces_repair: replacesRepair || null }, 'POS issued. The rider has been notified.')) { closeModal(); reload(); }
    };
  }

  // ---- issue (from stock to a rider; also a replacement)
  function issueModal(o) {
    const d = P.data, stock = d.machines.filter((m) => m.status === 'in_stock');
    if (!stock.length) { toast('No machine in stock to issue'); return; }
    const rep = o.repairId ? d.repairs.find((r) => r.id === o.repairId) : null;
    const riderId = o.riderId || (rep && rep.rider_id) || '';
    const mach = o.machineId ? d.mById.get(o.machineId) : null;
    const rider = riderPicker(d, riderId);
    openModal(`<h2>${rep ? 'Issue replacement POS' : 'Issue POS from stock'}</h2><form id="pi-form">
      <div class="form-row"><label>Machine (in stock)</label>${mach ? `<input value="${esc(mach.sn)} · ${esc(mach.bank_name || '')}" disabled>` : `<select id="pi-m">${stock.map((m) => `<option value="${m.id}">${esc(m.sn)} · ${esc(m.bank_name || '')} · TID ${esc(m.tid || '—')}</option>`).join('')}</select>`}</div>
      ${rider.html}
      <div class="form-row"><label>Issued date</label><input type="date" id="pi-date" value="${new Date().toLocaleDateString('en-CA')}"></div>
      <div class="form-row"><label><input type="checkbox" id="pi-chg"> Charger given with this machine</label><span class="hint">Leave unticked if the charger is still pending.</span></div>
      <button class="btn-primary" type="submit">Issue</button></form>`);
    const getW = rider.bind();
    document.getElementById('pi-form').onsubmit = async (ev) => {
      ev.preventDefault();
      let rid = riderId;
      if (!rid) { const w = getW(); if (!w) { toast('Choose a rider from the list'); return; } rid = w.id; }
      const mid = mach ? mach.id : document.getElementById('pi-m').value;
      if (await rpc('fh_pos_issue', { p_machine: mid, p_rider: rid, p_charger: document.getElementById('pi-chg').checked, p_date: document.getElementById('pi-date').value || null, p_replaces_repair: o.repairId || null }, 'POS issued')) { closeModal(); reload(); }
    };
  }

  // ---- send to Accounts: choose the fault, then find each machine by TID / MID / S/N (its details are fetched)
  function repairModal(ids) {
    const d = P.data; const ok = (m) => m && (m.status === 'issued' || m.status === 'in_stock');
    let chosen = ids.map((i) => d.mById.get(i)).filter(ok);
    const cand = d.machines.filter(ok);
    const lab = (m) => `TID ${m.tid || '—'} · MID ${m.mid || '—'} · S/N ${m.sn} · ${m.rider_name || 'in stock'}`;
    openModal(`<h2>Send to Accounts for repair</h2><form id="pr-form">
      <div class="form-row"><label>Fault *</label><select id="pr-f" required>${faultOpts(d)}</select></div>
      <div class="form-row"><label>Find the machine by TID, MID or S/N</label><div style="display:flex;gap:6px"><input id="pr-find" list="pr-list" placeholder="Type or pick" autocomplete="off" style="flex:1"><button class="btn small" id="pr-add" type="button">Add</button></div>
        <datalist id="pr-list">${cand.map((m) => `<option value="${esc(lab(m))}">`).join('')}</datalist></div>
      <div id="pr-sel"></div>
      <div class="form-row"><label>Remark</label><textarea id="pr-r" rows="2" maxlength="300"></textarea></div>
      <label class="hint"><input type="checkbox" id="pr-dl" checked> Also download the list for Accounts</label><br><button class="btn-primary" type="submit" style="margin-top:8px">Send to Accounts</button></form>`);
    const draw = () => {
      document.getElementById('pr-sel').innerHTML = chosen.length ? chosen.map((m) => `<div class="card" style="padding:8px 10px;margin-bottom:6px;display:flex;gap:8px;align-items:center;justify-content:space-between"><div><b class="mono">${esc(m.sn)}</b> <span class="hint">${esc(m.bank_name || '')}</span><div class="hint">TID ${esc(m.tid || '—')} · MID ${esc(m.mid || '—')} · ${esc(m.rider_name || 'in stock')} ${esc(m.employee_id || '')}</div></div><button class="btn small outline" type="button" data-rm="${m.id}">✕</button></div>`).join('') : '<p class="hint">No machine added yet.</p>';
    };
    const add = () => {
      const f = document.getElementById('pr-find'), t = f.value.trim(); if (!t) return;
      const q = norm(t);
      const hit = cand.find((m) => lab(m) === t) || cand.filter((m) => [m.tid, m.mid, m.sn].some((x) => norm(x) === q))[0];
      if (!hit) { toast('No machine with that TID, MID or S/N (only issued or in-stock machines can be sent)'); return; }
      if (!chosen.some((m) => m.id === hit.id)) chosen.push(hit);
      f.value = ''; draw();
    };
    draw();
    document.getElementById('pr-add').onclick = add;
    document.getElementById('pr-find').onchange = () => { const t = document.getElementById('pr-find').value.trim(); if (cand.some((m) => lab(m) === t)) add(); };
    document.getElementById('pr-sel').onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) { chosen = chosen.filter((m) => m.id !== b.dataset.rm); draw(); } };
    document.getElementById('pr-form').onsubmit = async (ev) => {
      ev.preventDefault(); const f = document.getElementById('pr-f').value, rem = document.getElementById('pr-r').value;
      if (!chosen.length) { toast('Add at least one machine'); return; }
      const n = await rpc('fh_pos_send_repair', { p_ids: chosen.map((m) => m.id), p_fault: f, p_remark: rem }, null); if (n === false) return;
      if (document.getElementById('pr-dl').checked) { const fn = (d.faults.find((x) => x.id === f) || {}).name || ''; await xl(chosen.map((m) => ({ 'S/N': m.sn, MID: m.mid || '', TID: m.tid || '', Bank: m.bank_name || '', Rider: m.rider_name || '', 'Employee ID': m.employee_id || '', Fault: fn, Remark: rem, 'Sent on': new Date().toLocaleDateString('en-GB') })), 'For Accounts', 'pos-for-accounts.xlsx'); }
      closeModal(); toast(n + ' machine(s) sent to Accounts'); P.sel.clear(); reload();
    };
  }

  // ---- take back: a reason is required; a faulty machine can go straight to Accounts; a replacement can be issued
  function takeBackModal(m) {
    const d = P.data;
    openModal(`<h2>Take back POS</h2><p class="hint"><b class="mono">${esc(m.sn)}</b> · ${esc(m.bank_name || '')} · TID ${esc(m.tid || '—')} · from ${esc(m.rider_name || '—')} ${esc(m.employee_id || '')}</p><form id="tb-form">
      <div class="form-row"><label>Reason *</label><select id="tb-reason" required><option value="">— choose —</option><option value="resigned">Resigned / terminated / left</option><option value="fault">Machine fault (send to Accounts for repair)</option><option value="replace">Replacement needed</option><option value="other">Other</option></select></div>
      <div class="form-row" id="tb-faultrow" style="display:none"><label>Fault *</label><select id="tb-fault">${faultOpts(d)}</select></div>
      <div class="form-row"><label>Remark</label><textarea id="tb-rem" rows="2" maxlength="300"></textarea></div>
      <div class="form-row"><label>Charger *</label>
        <label style="display:block"><input type="radio" name="tb-ch" value="yes"> With charger</label>
        <label style="display:block"><input type="radio" name="tb-ch" value="no"> Without charger</label></div>
      <div class="form-row" id="tb-reprow"><label>After taking it back</label>
        <label style="display:block"><input type="radio" name="tb-rp" value="no" checked> Take back without replacement</label>
        <label style="display:block"><input type="radio" name="tb-rp" value="yes"> Take back and issue a replacement to the same rider</label></div>
      <button class="btn-primary" type="submit">Take back</button></form>`);
    const rs = document.getElementById('tb-reason');
    rs.onchange = () => {
      document.getElementById('tb-faultrow').style.display = rs.value === 'fault' ? '' : 'none';
      document.getElementById('tb-reprow').style.display = rs.value === 'resigned' || !m.rider_id ? 'none' : '';
      if (rs.value === 'replace') document.querySelector('input[name=tb-rp][value=yes]').checked = true;
    };
    document.getElementById('tb-form').onsubmit = async (ev) => {
      ev.preventDefault();
      const reason = rs.value, fault = reason === 'fault' ? document.getElementById('tb-fault').value : null;
      if (reason === 'fault' && !fault) { toast('Choose the fault'); return; }
      const chk = document.querySelector('input[name=tb-ch]:checked'); if (!chk) { toast('Say whether the charger came back'); return; }
      const label = rs.options[rs.selectedIndex].text, rem = document.getElementById('tb-rem').value;
      const wantRep = document.querySelector('input[name=tb-rp]:checked').value === 'yes' && reason !== 'resigned' && m.rider_id;
      const r = await sb.rpc('fh_pos_take_back_v2', { p_machine: m.id, p_reason: label, p_remark: rem, p_fault: fault, p_charger: chk.value === 'yes' });
      if (r.error) { toast(/function|schema/i.test(r.error.message) ? 'Please run migration_60.sql first' : 'Could not save: ' + r.error.message); return; }
      closeModal(); toast(fault ? 'Taken back and sent to Accounts' : 'Taken back into stock');
      await reload();
      if (wantRep) issueNewModal(r.data && r.data.rider_id || m.rider_id, r.data && r.data.repair_id || null);
    };
  }

  // ---------------------------------------------------------------- Excel upload
  const COLS = { rider_name: ['ridername', 'name', 'employeename', 'fullname', 'rider'], employee_id: ['employeeid', 'empid', 'employeeno', 'empno', 'eid', 'employeecode'], nexus_id: ['nexusid', 'nexus'], region: ['regionname', 'region'], sub_region: ['subregioncityname', 'subregioncity', 'subregion', 'cityname', 'city', 'subregionorcity'], sn: ['sn', 'serialno', 'serialnumber', 'serial', 'snno'], mid: ['mid', 'merchantid'], tid: ['tid', 'terminalid'], bank: ['bankname', 'bank'], device: ['androidornonandroid', 'androidnonandroid', 'androidnonandroid', 'devicetype', 'device', 'android', 'type'], issued_date: ['issueddate', 'issueddata', 'dateissued', 'issuedon', 'issued'], charger: ['chargergiven', 'charger', 'chargerstatus'] };
  function isoDate(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') { const dt = new Date(Math.round((v - 25569) * 86400000)); return isNaN(dt) ? '' : dt.toISOString().slice(0, 10); }
    const s = String(v).trim(); let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/); if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
    const dt = new Date(s); return isNaN(dt) ? '' : dt.toISOString().slice(0, 10);
  }
  function uploadModal() {
    openModal(`<h2>Upload POS Excel</h2><p class="hint">Columns: Rider Name, Employee ID, Nexus ID, Region Name, Sub Region/City Name, S/N, MID, TID, Bank Name, Android / Non Android, Issued Date, Charger Given. <b>S/N is the key</b>: new S/N are added, existing ones are updated. Empty cells never erase saved data. Rows without a rider are added as stock. When an Employee ID is on the roster, the rider's <b>name, region and sub-region are taken from the roster</b>. Riders of Lahore / Kasur / Raiwind who are not on the roster are skipped.</p>
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
          <td style="white-space:nowrap">${T === 'reported' ? `<button class="btn small" data-send="${r.machine_id}">Send to Accounts</button> <button class="btn small outline" data-res="${r.id}:cancelled">Dismiss</button>` : ''}${T === 'with_accounts' ? `<button class="btn small" data-res="${r.id}:repaired">Received back → stock</button> <button class="btn small outline" data-res="${r.id}:irreparable">Will not be received (retire)</button> ${!r.replacement_machine_id ? `<button class="btn small outline" data-repl="${r.id}">Issue replacement</button>` : '<span class="badge active">Replaced</span>'}` : ''}${T === 'closed' && r.status === 'irreparable' && !r.replacement_machine_id && m.rider_id ? `<button class="btn small" data-repl="${r.id}">Issue replacement</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty-state"><p>Nothing here.</p></div>'}</div>`;
    host.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.tab) { P.tab = b.dataset.tab; return pageRepairs(host); }
      if (b.dataset.act === 'faults') { settingsTab = 'posfaults'; return navigateTo('settings'); }
      if (b.dataset.send) return repairModal([b.dataset.send]);
      if (b.dataset.repl) return issueModal({ repairId: b.dataset.repl });
      if (b.dataset.res) { const [id, out] = b.dataset.res.split(':'); const rem = prompt(out === 'repaired' ? 'Machine repaired and received back from Accounts: it goes back into stock, ready to issue to a rider. Remark (optional):' : out === 'irreparable' ? 'Machine will NOT be received back (cannot be repaired / lost). It is marked Retired. Remark (optional):' : 'Dismiss this report? Remark (optional):', ''); if (rem === null) return; if (await rpc('fh_pos_repair_result', { p_repair: id, p_outcome: out, p_remark: rem }, 'Saved')) reload(); }
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

  // ---------------------------------------------------------------- RIDER: My POS (sidebar page) + Dashboard card
  const TAG = { issued: ['Issued', 'active'], in_repair: ['In repair', 'open'], retired: ['Retired', ''], in_stock: ['Pending', 'open'] };
  const tag = (m) => { const [t, c] = m ? (TAG[m.status] || [m.status, '']) : ['Not issued', 'open']; return `<span class="badge ${c}">${esc(t)}</span>`; };
  async function myData() {
    const uid = state.user.id;
    const [a, b, rg, sr] = await Promise.all([
      sb.from('pos_machines').select('*').eq('rider_id', uid).order('issued_date', { ascending: false }),
      sb.from('pos_repairs').select('*').eq('rider_id', uid).order('created_at', { ascending: false }),
      sb.from('regions').select('id, name'), sb.from('sub_regions').select('id, name')]);
    if (a.error) throw a.error;
    const nm = {}; [...(rg.data || []), ...(sr.data || [])].forEach((x) => (nm[x.id] = x.name));
    let ms = a.data || []; if (ms.some((m) => m.status !== 'retired')) ms = ms.filter((m) => m.status !== 'retired');
    return { ms, rp: b.data || [], nm };
  }
  const openRep = (rp, id) => rp.find((r) => r.machine_id === id && (r.status === 'reported' || r.status === 'with_accounts'));

  window.fhPosTileHtml = async function () {
    if (!state.user || !state.profile) return '';
    let D; try { D = await myData(); } catch (_) { return ''; }
    if (!D.ms.length && state.profile.role !== 'rider') return '';
    const m = D.ms[0], extra = D.ms.length > 1 ? ` <span class="hint">+${D.ms.length - 1} more</span>` : '';
    return `<div class="card" style="cursor:pointer;display:flex;gap:12px;align-items:center;flex-wrap:wrap" onclick="navigateTo('my_pos')"><div style="font-size:28px">💳</div>
      <div style="flex:1;min-width:150px"><b>My POS</b> ${tag(m)}${extra}<div class="hint">${m ? esc(m.bank_name || 'POS') + ' · TID ' + esc(m.tid || '—') + (m.charger_given ? '' : ' · charger pending') : 'No POS has been issued to you yet.'}</div></div><span class="hint">View ›</span></div>`;
  };

  window.renderMyPos = async function () {
    const main = document.getElementById('main-content'); document.getElementById('topbar-actions').innerHTML = '';
    let D; try { D = await myData(); } catch (e) { main.innerHTML = missing(e) ? '<div class="empty-state"><p>POS is not available yet.</p></div>' : '<div class="empty-state">Could not load: ' + esc(e.message) + '</div>'; return; }
    const card = (m) => { const o = openRep(D.rp, m.id); return `<div class="card" data-open="${m.id}" style="cursor:pointer"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><div style="font-size:30px">💳</div><div style="flex:1;min-width:150px"><b style="font-size:1.05rem">${esc(m.bank_name || 'POS machine')}</b> ${tag(m)}<div class="hint">S/N ${esc(m.sn)} · ${DEV[m.device_type] || 'device type not set'}</div></div><span class="hint">Tap for details ›</span></div>
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${m.charger_given ? '<span class="badge active">Charger given</span>' : '<span class="badge open">Charger pending</span>'}${o ? `<span class="badge open">🔧 Fault ${o.status === 'with_accounts' ? 'with Accounts' : 'reported'}</span>` : ''}</div></div>`; };
    const hist = D.rp.slice(0, 15);
    main.innerHTML = `<p class="hint" style="margin-top:0">Your POS machine, and any fault you report.</p>
      ${D.ms.length ? D.ms.map(card).join('') : `<div class="card"><div style="display:flex;gap:10px;align-items:center"><div style="font-size:30px">💳</div><div><b>No POS issued yet</b> ${tag(null)}<div class="hint">When a POS is issued to you it will appear here and you will get a notice.</div></div></div></div>`}
      ${D.ms.some((m) => m.status === 'issued' && !openRep(D.rp, m.id)) ? '<button class="btn" id="mp-rep" type="button">🔧 Report a fault</button>' : ''}
      ${hist.length ? `<div class="card" style="margin-top:14px"><h3 style="margin-top:0">My fault reports</h3>${hist.map((r) => `<div style="padding:7px 0;border-top:1px solid var(--line,#e5e7ef)"><b>${esc(r.fault_name || 'Fault')}</b> <span class="badge ${r.status === 'repaired' ? 'active' : 'open'}">${esc(REPAIR_STATUS[r.status] || r.status)}</span><div class="hint">${esc(new Date(r.reported_at || r.created_at).toLocaleDateString())}${r.remark ? ' · ' + esc(r.remark) : ''}${r.outcome_remark ? ' · ' + esc(r.outcome_remark) : ''}</div></div>`).join('')}</div>` : ''}`;
    const detail = (m) => {
      const o = openRep(D.rp, m.id), row = (l, v) => `<div style="padding:7px 0;border-top:1px solid var(--line,#e5e7ef)"><span class="hint">${l}</span><br><b class="mono">${v}</b></div>`;
      openModal(`<h2 style="margin-top:0">💳 POS details ${tag(m)}</h2>${row('Bank', esc(m.bank_name || '—'))}${row('MID', esc(m.mid || '—'))}${row('TID', esc(m.tid || '—'))}${row('S/N', esc(m.sn))}${row('Nexus ID', esc(m.nexus_id || '—'))}${row('Android / Non-Android', DEV[m.device_type] || '—')}${row('Region', esc(D.nm[m.region_id] || '—') + (D.nm[m.sub_region_id] ? ' · ' + esc(D.nm[m.sub_region_id]) : ''))}${row('Issued on', fd(m.issued_date))}${row('Charger', m.charger_given ? 'Given' : 'Not received yet')}
        ${o ? `<p class="hint" style="margin-top:10px">🔧 Fault reported (${esc(o.fault_name || '')}): ${o.status === 'with_accounts' ? 'with Accounts for repair' : 'waiting for the Super Admin'}.</p>` : (m.status === 'issued' ? '<button class="btn" id="pd-rep" type="button" style="margin-top:12px">🔧 Report a fault</button>' : '')}`);
      const b = document.getElementById('pd-rep'); if (b) b.onclick = () => { closeModal(); report(m); };
    };
    const report = async (m) => {
      const f = await sb.from('pos_fault_types').select('id, name').eq('active', true).order('sort_order');
      openModal(`<h2 style="margin-top:0">Report a POS fault</h2><p class="hint">${esc(m.bank_name || 'POS')} · S/N ${esc(m.sn)}</p><form id="pr-rf"><div class="form-row"><label>What is wrong? *</label><select id="pr-rt" required><option value="">— choose —</option>${(f.data || []).map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div><div class="form-row"><label>Details (optional)</label><textarea id="pr-rn" rows="2" maxlength="300"></textarea></div><button class="btn-primary" type="submit">Send report</button></form>`);
      document.getElementById('pr-rf').onsubmit = async (e) => {
        e.preventDefault(); const sel = document.getElementById('pr-rt'), p = state.profile;
        const r = await sb.from('pos_repairs').insert({ machine_id: m.id, rider_id: state.user.id, rider_name: p.full_name, rider_employee_id: p.employee_id, fault_type_id: sel.value, fault_name: sel.options[sel.selectedIndex].text, remark: document.getElementById('pr-rn').value.trim() || null, reported_by_rider: true, status: 'reported' });
        if (r.error) { toast(/duplicate|unique/i.test(r.error.message) ? 'A fault is already reported for this machine' : 'Could not send: ' + r.error.message); return; }
        closeModal(); toast('Fault reported to the Super Admin'); renderMyPos();
      };
    };
    main.onclick = (e) => {
      const rb = e.target.closest('#mp-rep'); if (rb) { const ms = D.ms.filter((m) => m.status === 'issued' && !openRep(D.rp, m.id)); if (ms.length === 1) report(ms[0]); else if (ms.length) { const m = ms[parseInt(prompt('Which machine?\n' + ms.map((x, i) => (i + 1) + '. S/N ' + x.sn).join('\n'), '1'), 10) - 1]; if (m) report(m); } return; }
      const c = e.target.closest('[data-open]'); if (c) detail(D.ms.find((m) => m.id === c.dataset.open));
    };
  };
})();

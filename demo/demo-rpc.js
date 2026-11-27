/* =====================================================================
   FieldHub DEMO: the server functions (demo/demo-rpc.js)
   Each live database function (RPC) the portal calls is answered here
   with the same shape of result, working on the demo's sample data.
   ===================================================================== */
(function () {
  'use strict';
  const D = window.FHDEMO;
  const T = (n) => D.tbl(n);
  const now = () => D.nowIso();
  const today = () => new Date().toISOString().slice(0, 10);
  const err = (msg, code) => D.pgErr(400, code || 'P0001', msg);
  const ok = (data) => D.J(200, data === undefined ? null : data);
  const prof = (id) => D.find('profiles', id);
  const isSuper = (c) => c.me && c.me.role === 'super_admin';
  const isAdm = (c) => c.me && (c.me.role === 'super_admin' || c.me.role === 'admin');
  const notice = (userId, kind, title, body) => D.ins('expiry_notices', { user_id: userId, kind, title, body, read_at: null });
  const toolName = (it) => { const t = D.find('tool_types', it.tool_type_id); return t ? t.name : 'Tool'; };
  const hoursSince = (iso) => iso ? (Date.now() - new Date(iso).getTime()) / 36e5 : 0;
  const ackSettings = () => T('fh_ack_settings')[0] || { force_enabled: true, min_hours: 48, auto_enabled: false, auto_hours: 72, remind_enabled: true, remind_hours: 6, rider_prompt: true };
  const issAcked = (id) => T('tool_issuance_acks').some((a) => a.tool_issuance_id === id);

  // items waiting for a rider's acknowledgement (resolved requests + unacknowledged tools)
  function pendingAcks(riderFilter) {
    const items = [];
    T('requests').filter((r) => r.status === 'resolved' && !r.deleted_at && (!riderFilter || r.rider_id === riderFilter)).forEach((r) => {
      const p = prof(r.rider_id); if (!p || p.status !== 'active') return;
      const h = prof(r.assigned_poc_id);
      items.push({ kind: 'req', id: r.id, name: p.full_name, emp: p.employee_id, rider_id: p.id, what: r.category + ' request', handler: h ? h.full_name : null, since: r.resolved_at || r.updated_at || r.created_at });
    });
    const openReq = new Set(T('requests').filter((r) => ['open', 'in_progress', 'resolved'].includes(r.status) && !r.deleted_at).map((r) => r.id));
    const disputed = new Set(T('fh_ack_disputes').filter((d) => !d.closed_at).map((d) => d.issuance_id));
    T('tool_issuances').filter((it) => !issAcked(it.id) && !it.recovered_on && (!riderFilter || it.rider_id === riderFilter) && !(it.request_id && openReq.has(it.request_id)) && !disputed.has(it.id)).forEach((it) => {
      const p = prof(it.rider_id); if (!p || p.status !== 'active') return;
      const h = prof(it.recorded_by);
      items.push({ kind: 'iss', id: it.id, name: p.full_name, emp: p.employee_id, rider_id: p.id, what: toolName(it), handler: h ? h.full_name : null, since: it.created_at || it.issued_date });
    });
    const S = ackSettings();
    items.forEach((x) => { x.hours = Math.floor(hoursSince(x.since)); x.wait = Math.max(0, Math.ceil(S.min_hours - x.hours)); });
    return items.sort((a, b) => b.hours - a.hours);
  }
  function closeRequest(r, actor, note) {
    D.upd('requests', [r], { status: 'closed', closed_at: now(), updated_at: now() });
    D.ins('request_updates', { request_id: r.id, message: note, created_by: actor, new_status: 'closed' });
    T('tool_issuances').filter((it) => it.request_id === r.id && !issAcked(it.id)).forEach((it) => D.ins('tool_issuance_acks', { tool_issuance_id: it.id, user_id: r.rider_id, acknowledged_at: now() }));
  }
  function forceAck(c, reqIds, issIds, check) {
    const S = ackSettings(); const out = { requests_closed: 0, notified: 0, refused: [], items: [] };
    const list = pendingAcks();
    (reqIds || []).concat(issIds || []).forEach((id) => {
      const x = list.find((i) => i.id === id); if (!x) return;
      if (check && x.hours < S.min_hours) { out.refused.push({ what: x.what, name: x.name, msg: 'wait ' + (S.min_hours - x.hours) + ' more hours' }); return; }
      if (x.kind === 'req') { closeRequest(D.find('requests', id), c.uid, 'Acknowledged by the Super Admin on behalf of the rider.'); out.requests_closed++; }
      else D.ins('tool_issuance_acks', { tool_issuance_id: id, user_id: x.rider_id, acknowledged_at: now() });
      notice(x.rider_id, 'force_ack', 'Marked as received', x.what + ' was marked as received on your behalf.'); out.notified++;
      out.items.push({ rider_id: x.rider_id, name: x.name, what: x.what });
    });
    return out;
  }
  function fvBuild(rider, date, type, payload, c, centerId, lat, lng) {
    const cps = T('fv_checkpoints');
    const answers = (payload || []).map((a) => { const cp = cps.find((x) => x.id === a.checkpoint_id) || {}; return { cp: a.checkpoint_id, text: cp.name || '', weight: Number(cp.weight) || 0, status: a.status, obs: a.observation || '' }; });
    const score = Math.round(answers.reduce((s, a) => s + (a.status === 'OK' ? a.weight : 0), 0) * 10) / 10;
    const rp = prof(rider) || {}; const rid = D.riderRegion(rider); const reg = D.find('regions', rid) || {};
    const ros = T('roster_entries').find((e) => e.rider_id === rider && e.status !== 'removed'); const sr = ros ? D.find('sub_regions', ros.sub_region_id) : null;
    return { rider_id: rider, rider_name: rp.full_name, rider_employee_id: rp.employee_id, region_id: rid, region_name: reg.name || null, sub_region_name: sr ? sr.name : null, submitted_by: c.uid, submitted_by_name: c.me && c.me.full_name,
      visit_date: date, visit_type: type, score, ok_count: answers.filter((a) => a.status === 'OK').length, issue_count: answers.filter((a) => a.status !== 'OK').length, edit_count: 0, answers, center_id: centerId || null, lat: lat || null, lng: lng || null };
  }
  function fvIssues(v) {
    v.answers.filter((a) => a.status !== 'OK').forEach((a) => D.ins('fv_issues', { visit_id: v.id, rider_id: v.rider_id, rider_name: v.rider_name, region_id: v.region_id, visit_date: v.visit_date, cp_key: a.cp, cp_text: a.text, observation: a.obs, status: 'open', resolved_at: null }));
  }
  const frLog = (c, entity, action, nv, reason) => D.ins('fr_log', { at: now(), actor: c.uid, entity, entity_id: null, action, old_val: null, new_val: nv || null, reason: reason || null });
  const frPerson = (id) => D.find('fr_people', id);

  const R = {
    // ---------------- general
    fh_touch_activity: (a, c) => { const u = T('user_activity').find((x) => x.user_id === c.uid); if (u) D.upd('user_activity', [u], { last_active_at: now() }); return null; },
    fh_track: () => null,
    fh_register_push_token: () => null,
    fh_unregister_push_token: () => null,
    fh_purge_expired_perms: () => 0,
    check_employee_id: (a) => T('profiles').filter((p) => String(p.employee_id || '').toLowerCase() === String(a.p_employee_id || '').trim().toLowerCase()).map((p) => ({ full_name: p.full_name, phone: p.phone })),
    fh_phone_exists: (a) => T('profiles').some((p) => p.phone === a.p_phone),
    fh_set_recovery_email: (a, c) => { D.upd('profiles', [c.me], { recovery_email: a.p_email, email: a.p_email }); return a.p_email; },
    get_storage_usage: () => {
      const rows = Object.keys(D.db.t).map((n) => { const k = T(n).length; return { table_name: n, row_count: k, size_bytes: 16384 + JSON.stringify(T(n)).length * 2 }; });
      return rows.sort((a, b) => b.size_bytes - a.size_bytes);
    },
    fh_team_directory: (a, c) => T('profiles').filter((p) => p.status === 'active').map((p) => { const e = T('roster_entries').find((x) => x.rider_id === p.id && x.status !== 'removed'); return Object.assign({}, p, { region_ids: D.regionsOf(p), hotspot: e ? e.hotspot : null, official_mobile: e ? e.official_mobile : null }); }),
    fh_hotspot_mates: (a, c) => {
      const mine = T('roster_entries').find((e) => e.rider_id === c.uid && e.status !== 'removed'); if (!mine) return [];
      return T('roster_entries').filter((e) => e.hotspot === mine.hotspot && e.rider_id !== c.uid && e.status !== 'removed').map((e) => { const p = prof(e.rider_id) || {}; return { full_name: p.full_name, employee_id: p.employee_id, phone: p.phone, role: p.role, official_mobile: e.official_mobile, hotspot: e.hotspot }; });
    },
    fh_rider_hotspot: (a) => {
      const p = T('profiles').find((x) => String(x.employee_id).toLowerCase() === String(a.p_emp).toLowerCase()); if (!p) return [];
      const e = T('roster_entries').find((x) => x.rider_id === p.id && x.status !== 'removed'); const r = e ? D.find('regions', e.region_id) : null;
      return e ? [{ full_name: p.full_name, employee_id: p.employee_id, hotspot: e.hotspot, region: r && r.name, region_name: r && r.name, day_off: e.day_off }] : [];
    },
    fh_circular_remind: (a) => { const ack = new Set(T('circular_acks').filter((x) => x.circular_id === a.p_circular).map((x) => x.user_id)); const ppl = T('profiles').filter((p) => p.status === 'active' && !ack.has(p.id) && p.role !== 'super_admin'); ppl.forEach((p) => notice(p.id, 'circ_remind', 'Please acknowledge a circular', 'A circular is waiting for your acknowledgement.')); return ppl.length; },
    fh_expiry_notify: (a, c) => {
      const items = T('expiry_items').filter((i) => String(i.group_id || i.id) === String(a.p_group));
      let n = 0; items.forEach((i) => { if (i.rider_id) { notice(i.rider_id, a.p_kind === 'closed' ? 'expiry_closed' : 'expiry', a.p_kind === 'closed' ? 'Expiry item closed' : 'Expiry reminder', a.p_message || (i.item_label + ' expires on ' + i.expiry_date)); n++; } });
      if (a.p_kind === 'closed') D.upd('expiry_items', items, { status: 'closed', closed_note: a.p_note || null, closed_at: now(), closed_by: c.uid });
      return n || 1;
    },
    // ---------------- requests & tools
    fh_force_acknowledge: (a, c) => forceAck(c, a.p_request_ids, a.p_issuance_ids, false),
    fh_force_ack_v2: (a, c) => forceAck(c, a.p_request_ids, a.p_issuance_ids, true),
    fh_revert_request: (a, c) => {
      const r = D.find('requests', a.p_request_id); if (!r) return err('Request not found');
      const patch = { status: a.p_status, updated_at: now() }; if (a.p_status !== 'closed') patch.closed_at = null; if (a.p_status === 'open' || a.p_status === 'in_progress') patch.resolved_at = null;
      D.upd('requests', [r], patch);
      D.ins('request_updates', { request_id: r.id, message: 'Reverted by the Super Admin: ' + (a.p_remark || ''), created_by: c.uid, new_status: a.p_status });
      if (a.p_remove_ack) D.del('tool_issuance_acks', T('tool_issuance_acks').filter((x) => T('tool_issuances').some((it) => it.request_id === r.id && it.id === x.tool_issuance_id)));
      return null;
    },
    fh_request_edit: (a, c) => { const r = D.find('requests', a.p_id); if (!r) return err('Request not found'); const p = Object.assign({}, a.p || {}); if (p.category_id) { const cat = D.find('categories', p.category_id); if (cat) p.category = cat.name; } delete p.reason; D.upd('requests', [r], Object.assign(p, { updated_at: now() })); D.ins('request_updates', { request_id: r.id, message: 'Details edited' + (a.p && a.p.reason ? ': ' + a.p.reason : ''), created_by: c.uid, new_status: null }); return null; },
    fh_issuance_edit: (a) => { const it = D.find('tool_issuances', a.p_id); if (!it) return err('Not found'); const p = Object.assign({}, a.p || {}); delete p.reason; D.upd('tool_issuances', [it], p); return null; },
    fh_tool_mark_recovered: (a) => { const rows = T('tool_issuances').filter((x) => (a.p_ids || []).includes(x.id)); D.upd('tool_issuances', rows, a.p_undo ? { recovered_on: null, recovered_note: null } : { recovered_on: a.p_date || today(), recovered_note: a.p_note || null }); return rows.length; },
    // ---------------- acknowledgements (v102)
    fh_ack_list: () => ({ settings: ackSettings(), items: pendingAcks(), disputes: T('fh_ack_disputes').filter((d) => !d.closed_at).map((d) => { const it = D.find('tool_issuances', d.issuance_id) || {}; const p = prof(d.rider_id) || {}; return { id: d.id, name: p.full_name, emp: p.employee_id, what: toolName(it), remark: d.remark, at: d.created_at }; }) }),
    fh_ack_settings_save: (a) => { const s = T('fh_ack_settings')[0]; if (s) D.upd('fh_ack_settings', [s], a.p || {}); else D.ins('fh_ack_settings', Object.assign({ id: 1 }, a.p || {})); return null; },
    fh_ack_dispute_close: (a) => { const d = D.find('fh_ack_disputes', a.p_id); if (d) D.upd('fh_ack_disputes', [d], { closed_at: now() }); return null; },
    fh_ack_email_take: () => [],
    fh_my_pending_acks: (a, c) => { const S = ackSettings(); if (!c.me || c.me.role !== 'rider') return { prompt: false, items: [] }; return { prompt: !!S.rider_prompt, items: pendingAcks(c.uid) }; },
    fh_rider_ack: (a, c) => {
      if (a.p_kind === 'req') {
        const r = D.find('requests', a.p_id); if (!r) return err('Not found');
        if (a.p_received) closeRequest(r, c.uid, 'Received, thank you.' + (a.p_remark ? ' ' + a.p_remark : ''));
        else { if (!a.p_remark) return err('Please write a short remark'); D.upd('requests', [r], { status: 'in_progress', resolved_at: null, updated_at: now() }); D.ins('request_updates', { request_id: r.id, message: 'Not received: ' + a.p_remark, created_by: c.uid, new_status: 'in_progress' }); }
      } else {
        if (a.p_received) D.ins('tool_issuance_acks', { tool_issuance_id: a.p_id, user_id: c.uid, acknowledged_at: now() });
        else D.ins('fh_ack_disputes', { issuance_id: a.p_id, rider_id: c.uid, remark: a.p_remark, closed_at: null });
      }
      return null;
    },
    // ---------------- field visits
    fv_submit_visit_geo: (a, c) => { const v = D.ins('fv_visits', fvBuild(a.p_rider, a.p_date, a.p_type, a.p_answers, c, a.p_center, a.p_lat, a.p_lng))[0]; fvIssues(v); return v.id; },
    fv_submit_visit: (a, c) => { const v = D.ins('fv_visits', fvBuild(a.p_rider, a.p_date, a.p_type, a.p_answers, c))[0]; fvIssues(v); return v.id; },
    fv_update_visit: (a, c) => {
      const v = D.find('fv_visits', a.p_visit); if (!v) return err('Visit not found');
      const nb = fvBuild(v.rider_id, a.p_date, a.p_type, a.p_answers, c); delete nb.submitted_by; delete nb.submitted_by_name;
      D.upd('fv_visits', [v], Object.assign(nb, { edit_count: (v.edit_count || 0) + 1 }));
      D.del('fv_issues', T('fv_issues').filter((i) => i.visit_id === v.id && i.status === 'open')); fvIssues(v); return null;
    },
    fv_delete_visits: (a) => { const rows = T('fv_visits').filter((v) => (a.p_ids || []).includes(v.id)); D.del('fv_issues', T('fv_issues').filter((i) => (a.p_ids || []).includes(i.visit_id))); D.del('fv_visits', rows); return rows.length; },
    fv_set_issue_status: (a, c) => { const i = D.find('fv_issues', a.p_issue); if (i) D.upd('fv_issues', [i], a.p_resolved ? { status: 'resolved', resolved_at: now(), resolved_note: a.p_note || null, resolved_by: c.uid } : { status: 'open', resolved_at: null, resolved_note: null }); return null; },
    fv_set_scope: (a) => {
      const tb = a.p_kind === 'region' ? 'fv_region_settings' : 'fv_rider_settings', col = a.p_kind === 'region' ? 'region_id' : 'rider_id';
      const ex = T(tb).find((x) => x[col] === a.p_id); if (ex) D.upd(tb, [ex], { enabled: !!a.p_enabled }); else D.ins(tb, { [col]: a.p_id, enabled: !!a.p_enabled }); return null;
    },
    fv_set_targets: (a) => { D.ins('fv_targets', { profile_id: a.p_profile || null, onsite_kpi: a.p_onsite, online_target: a.p_online, effective_from: a.p_from, note: a.p_note }); return null; },
    fv_publish_checklist: (a, c) => {
      const keep = new Set((a.p_items || []).filter((i) => i.id).map((i) => i.id));
      D.del('fv_checkpoints', T('fv_checkpoints').filter((x) => !keep.has(x.id)));
      (a.p_items || []).forEach((it, i) => { if (it.id) { const x = D.find('fv_checkpoints', it.id); if (x) D.upd('fv_checkpoints', [x], { name: it.name, weight: it.weight, active: it.active, sort_order: (i + 1) * 10 }); } else D.ins('fv_checkpoints', { name: it.name, weight: it.weight, active: it.active !== false, sort_order: (i + 1) * 10 }); });
      D.ins('fv_checkpoint_log', { action: 'published', detail: (a.p_items || []).length + ' checkpoints', changed_by: c.uid, changed_by_name: c.me && c.me.full_name, changed_at: now() });
      return null;
    },
    // ---------------- POS
    fh_pos_take_back_v2: (a, c) => {
      const m = D.find('pos_machines', a.p_machine); if (!m) return err('Machine not found');
      const to = /repair|fault/i.test(a.p_reason || '') ? 'in_repair' : 'in_stock';
      D.upd('pos_machines', [m], { status: to, rider_id: to === 'in_stock' ? null : m.rider_id, charger_in_stock: !!a.p_charger, updated_at: now() });
      D.ins('pos_events', { machine_id: m.id, action: 'taken_back', detail: (a.p_reason || '') + (a.p_remark ? ' — ' + a.p_remark : ''), actor: c.uid });
      if (to === 'in_repair') D.ins('pos_repairs', { machine_id: m.id, rider_id: m.rider_id, rider_name: m.rider_name, rider_employee_id: m.employee_id, fault_type_id: a.p_fault || null, fault_name: (D.find('pos_fault_types', a.p_fault) || {}).name || a.p_reason, remark: a.p_remark, reported_by_rider: false, status: 'with_accounts' });
      return null;
    },
    fh_pos_bulk: (a) => { let n = 0; (a.p_rows || []).forEach((r) => { const ex = T('pos_machines').find((m) => m.sn === r.sn); if (ex) D.upd('pos_machines', [ex], r); else D.ins('pos_machines', Object.assign({ status: r.rider_id || r.employee_id ? 'issued' : 'in_stock' }, r)); n++; }); return { added: n, updated: 0, done: n }; },
    // ---------------- top performers
    fh_top_cleanup: () => 0,
    // ---------------- Fuel Trends
    fuel_set_limits: (a) => { const ex = T('fuel_limits').find((x) => x.category === a.p_cat); const p = { category: a.p_cat, max_liters: a.p_liters, max_amount: a.p_amount, max_km: a.p_km, max_lpv: a.p_lpv }; if (ex) D.upd('fuel_limits', [ex], p); else D.ins('fuel_limits', p); return null; },
    fuel_set_rate: (a) => { const ex = T('fuel_rates').find((x) => x.month === a.p_month); if (a.p_rate == null) { if (ex) D.del('fuel_rates', [ex]); } else if (ex) D.upd('fuel_rates', [ex], { rs_per_km: a.p_rate }); else D.ins('fuel_rates', { month: a.p_month, rs_per_km: a.p_rate }); return null; },
    fuel_centers_bulk: (a) => { let n = 0; (a.p_rows || []).forEach((r) => { const ex = T('fuel_centers').find((x) => x.month === r.month && x.region_name === r.region_name && x.category === r.category); if (ex) D.upd('fuel_centers', [ex], { centers: r.centers }); else D.ins('fuel_centers', r); n++; }); return n; },
    fuel_delete_months: (a) => { const m = new Set(a.p_months || []); const rows = T('fuel_records').filter((r) => m.has(String(r.month).slice(0, 10))); D.del('fuel_records', rows); return rows.length; },
    fuel_delete_rows: (a) => { const rows = T('fuel_records').filter((r) => (a.p_ids || []).includes(r.id)); D.del('fuel_records', rows); return rows.length; },
    fuel_update_row: (a) => { const r = D.find('fuel_records', a.p_id); if (r) D.upd('fuel_records', [r], a.p || {}); return null; },
    fuel_rename: (a) => { const rows = T('fuel_records').filter((r) => r[a.p_field] === a.p_old); D.upd('fuel_records', rows, { [a.p_field]: a.p_new }); return rows.length; },
    fuel_clean_names: () => 0,
    fuel_import_rows: (a) => { if (a.p_replace && (a.p_months || []).length) R.fuel_delete_months({ p_months: a.p_months }); D.ins('fuel_records', (a.p_rows || []).map((r) => Object.assign({}, r))); return (a.p_rows || []).length; },
    // ---------------- 2-step code for fuel pages: switched off in the demo
    fh_totp_status: () => ({ required: false, has: false, unlocked: true }),
    fh_totp_remove: () => null, fh_fuel_2fa_set: () => null, fh_2fa_list: () => [], fh_2fa_reset: () => null,
    // ---------------- Fuel Reimbursement
    fh_set_bike_number: (a, c) => { const v = String(a.p_number || '').trim().toUpperCase(); D.upd('profiles', [c.me], { bike_number: v }); return v; },
    fr_set_bike_number: (a) => { const p = prof(a.p_user || a.p_profile); const v = String(a.p_number || '').trim().toUpperCase(); if (p) D.upd('profiles', [p], { bike_number: v || null }); return v; },
    fr_bike_list: () => T('profiles').filter((p) => p.role === 'rider' && p.status === 'active').map((p) => { const e = T('roster_entries').find((x) => x.rider_id === p.id && x.status !== 'removed'); const r = D.find('regions', e ? e.region_id : p.region_id); return { id: p.id, profile_id: p.id, full_name: p.full_name, employee_id: p.employee_id, bike_number: p.bike_number, region_id: r && r.id, region_name: r && r.name, region: r && r.name, phone: p.phone }; }),
    fr_pending_count: () => T('fr_people').filter((x) => x.status === 'pending').length,
    fr_photo_rule_for: () => (T('fr_photo_rules').find((r) => r.scope === 'all') || {}).rule || 'optional',
    fr_staff_list: () => T('profiles').filter((p) => p.status === 'active' && p.role !== 'rider').map((p) => ({ id: p.id, user_id: p.id, full_name: p.full_name, employee_id: p.employee_id, role: p.role, region_id: p.region_id })),
    fr_save_settings: (a, c) => { const s = T('fr_settings')[0]; D.upd('fr_settings', [s], Object.assign({}, a.p || {}, { updated_at: now() })); frLog(c, 'settings', 'changed', a.p); return null; },
    fr_save_group: (a, c) => { const p = Object.assign({}, a.p || {}); const id = p.id; delete p.id; if (p.max_km_per_visit === '') p.max_km_per_visit = null; if (id) D.upd('fr_groups', [D.find('fr_groups', id)], p); else D.ins('fr_groups', Object.assign({ active: true }, p)); frLog(c, 'group', id ? 'changed' : 'added', a.p); return null; },
    fr_group_delete: (a) => { if (T('fr_people').some((x) => x.group_id === a.p_id)) return err('People are in this group. Move them first, or make the group Inactive instead.'); D.del('fr_groups', T('fr_groups').filter((g) => g.id === a.p_id)); return null; },
    fr_copy_groups_from_trends: () => { let n = 0; T('fuel_categories').forEach((fc) => { if (!T('fr_groups').some((g) => g.name.toLowerCase() === fc.name.toLowerCase())) { D.ins('fr_groups', { name: fc.name, visit_based: /home/i.test(fc.name), active: true }); n++; } }); return n; },
    fr_save_vehicle: (a) => { const p = Object.assign({}, a.p || {}); const id = p.id; delete p.id; if (id) D.upd('fr_vehicle_types', [D.find('fr_vehicle_types', id)], p); else D.ins('fr_vehicle_types', Object.assign({ active: true }, p)); return null; },
    fr_set_reviewer: (a) => { const ex = T('fr_region_cfg').find((x) => x.region_id === a.p_region); if (ex) D.upd('fr_region_cfg', [ex], { reviewer: a.p_reviewer }); else D.ins('fr_region_cfg', { region_id: a.p_region, reviewer: a.p_reviewer }, { noStamp: true }); return null; },
    fr_set_photo_rule: (a) => { const ex = T('fr_photo_rules').find((x) => x.scope === a.p_scope && (x.scope_id || null) === (a.p_scope_id || null)); if (a.p_rule === 'inherit') { if (ex) D.del('fr_photo_rules', [ex]); } else if (ex) D.upd('fr_photo_rules', [ex], { rule: a.p_rule }); else D.ins('fr_photo_rules', { scope: a.p_scope, scope_id: a.p_scope_id || null, rule: a.p_rule }); return null; },
    fr_save_access: (a, c) => { const ex = T('fr_access').find((x) => x.user_id === a.p_user); if (!a.p || a.p.remove) { if (ex) D.del('fr_access', [ex]); return null; } const p = { regions: a.p.regions || [], groups: a.p.groups || [], can_review: !!a.p.can_review, can_enter: !!a.p.can_enter, can_request: !!a.p.can_request, title: a.p.title || null, updated_at: now() }; if (ex) D.upd('fr_access', [ex], p); else D.ins('fr_access', Object.assign({ user_id: a.p_user }, p)); return null; },
    fr_make_fuel_login: (a) => { const p = prof(a.p_user); if (p) D.upd('profiles', [p], { status: 'active', role: 'coordinator', full_name: a.p_name || p.full_name, employee_id: a.p_emp || p.employee_id, region_id: a.p_region || p.region_id }); D.ins('custom_permissions', { profile_id: a.p_user, permission_key: 'viewer_only', granted_by: null }); return null; },
    fr_bulk_regions: (a) => { let nr = 0, nc = 0, same = 0; (a.p_rows || []).forEach((r) => { if (!r.region) return; let reg = T('regions').find((x) => x.name.toLowerCase() === String(r.region).trim().toLowerCase()); if (!reg) { reg = D.ins('regions', { name: String(r.region).trim(), active: true })[0]; nr++; } if (r.city) { const ex = T('sub_regions').find((s) => s.region_id === reg.id && s.name.toLowerCase() === String(r.city).trim().toLowerCase()); if (ex) same++; else { D.ins('sub_regions', { region_id: reg.id, name: String(r.city).trim(), active: true }); nc++; } } }); return { new_regions: nr, new_cities: nc, already: same, warnings: [] }; },
    fr_save_visit_limits: (a) => { let n = 0, d = 0; (a.p_rows || []).forEach((r) => { const ex = T('fr_visit_limits').find((x) => x.city_id === r.city_id && x.group_id === r.group_id); if (r.km === '' || r.km == null) { if (ex) { D.del('fr_visit_limits', [ex]); d++; } } else { if (ex) D.upd('fr_visit_limits', [ex], { max_km_per_visit: +r.km }); else D.ins('fr_visit_limits', { city_id: r.city_id, group_id: r.group_id, max_km_per_visit: +r.km }); n++; } }); return { set: n, cleared: d }; },
    fr_save_person: (a, c) => {
      const p = Object.assign({}, a.p || {}); const id = p.id; const reason = p.reason; delete p.id; delete p.reason;
      Object.keys(p).forEach((k) => { if (p[k] === '') p[k] = null; });
      if (p.employee_id && T('fr_people').some((x) => x.id !== id && x.employee_id && x.employee_id.toLowerCase() === String(p.employee_id).toLowerCase() && x.status !== 'rejected')) return err('That Employee ID is already on the fuel list.');
      if (id) { D.upd('fr_people', [frPerson(id)], Object.assign(p, { updated_at: now() })); frLog(c, 'people', 'changed', p, reason); return id; }
      const row = D.ins('fr_people', Object.assign({ status: isSuper(c) ? 'active' : 'pending', source: isSuper(c) ? 'manual' : 'request', requested_by: c.uid, vehicle_type_id: (T('fr_vehicle_types')[0] || {}).id, updated_at: now() }, p))[0];
      frLog(c, 'people', 'added', p, reason); return row.id;
    },
    fr_decide_person: (a, c) => { const x = frPerson(a.p_id); if (x) D.upd('fr_people', [x], { status: a.p_approve ? 'active' : 'rejected', decided_by: c.uid, decided_at: now(), updated_at: now() }); return null; },
    fr_sync_roster: (a) => {
      let added = 0; T('roster_entries').filter((e) => e.status !== 'removed').forEach((e) => { if (T('fr_people').some((x) => x.profile_id === e.rider_id)) return; const p = prof(e.rider_id); if (!p) return; D.ins('fr_people', { profile_id: p.id, full_name: p.full_name, employee_id: p.employee_id, region_id: e.region_id, city_id: e.sub_region_id, group_id: a.p_group, vehicle_type_id: a.p_vehicle, status: 'active', source: 'roster', updated_at: now() }); added++; });
      return { added, skipped: 0, back: 0 };
    },
    fr_people_bulk_update: (a) => { const rows = T('fr_people').filter((x) => (a.p_ids || []).includes(x.id) && x.status !== 'pending'); const p = {}; ['region_id', 'city_id', 'group_id', 'vehicle_type_id'].forEach((k) => { if (a.p && k in a.p) p[k] = a.p[k] || null; }); if (a.p && ['active', 'inactive'].includes(a.p.status)) p.status = a.p.status; D.upd('fr_people', rows, p); return rows.length; },
    fr_people_delete: (a) => { const ids = a.p_ids || []; const rd = T('fr_readings').filter((x) => ids.includes(x.person_id)); const mo = T('fr_monthly').filter((x) => ids.includes(x.person_id)); D.del('fr_readings', rd); D.del('fr_monthly', mo); const pp = T('fr_people').filter((x) => ids.includes(x.id)); D.del('fr_people', pp); return { people: pp.length, readings: rd.length, monthly: mo.length }; },
    fr_save_reading: (a, c) => {
      const x = frPerson(a.p_person); if (!x) return err('You cannot enter readings for this person.');
      const v = Math.trunc(Number(a.p_value) * 10) / 10; if (!(v >= 0)) return err('Please type the meter reading (numbers only).');
      if (a.p_day > today()) return err('You cannot enter a reading for a future day.');
      const veh = D.find('fr_vehicle_types', x.vehicle_type_id) || {};
      let r = T('fr_readings').find((y) => y.person_id === x.id && y.day === a.p_day);
      const prev = T('fr_readings').filter((y) => y.person_id === x.id && y.day < a.p_day && (y.closing != null || y.opening != null)).sort((p, q) => q.day < p.day ? -1 : 1)[0];
      const prevV = prev ? (prev.closing != null ? prev.closing : prev.opening) : null;
      let problem = null;
      if (a.p_kind === 'open') {
        if (r && r.closing != null && v >= r.closing) return err('Opening must be less than this day\'s Closing (' + r.closing + ').');
        if (prevV != null && v <= prevV) problem = 'Opening ' + v + ' must be more than the last reading ' + prevV + ' (' + prev.day + ').';
        else if (prevV != null && veh.max_gap_km && v - prevV > veh.max_gap_km) problem = 'That is ' + (v - prevV) + ' KM after the last reading ' + prevV + '. The limit is ' + veh.max_gap_km + ' KM.';
      } else {
        if (!r || r.opening == null) return err('Please add the Opening of this day first.');
        if (v <= r.opening) return err('Closing must be more than this day\'s Opening (' + r.opening + ').');
        if (veh.max_km_day && v - r.opening > veh.max_km_day) problem = 'That is ' + (v - r.opening) + ' KM in one day (Opening ' + r.opening + ' → Closing ' + v + '). The limit is ' + veh.max_km_day + ' KM.';
      }
      const ref = a.p_kind === 'open' ? prevV : (r && r.opening);
      if (ref != null && String(Math.trunc(v)).length > String(Math.trunc(ref)).length && !a.p_confirm) return err('DIGITS|' + v + ' has more digits than the last reading ' + ref + '. Please type it again to confirm.');
      if (problem && !String(a.p_reason || '').trim()) return err('CHECK|' + problem);
      const patch = a.p_kind === 'open' ? { opening: v, open_photo: a.p_photo || (r && r.open_photo) || null } : { closing: v, close_photo: a.p_photo || (r && r.close_photo) || null };
      Object.assign(patch, problem ? { status: 'check', check_kind: a.p_kind, check_note: problem + ' — Reason: ' + String(a.p_reason).trim() } : {}, { entered_by: c.uid, updated_at: now() });
      if (r) D.upd('fr_readings', [r], patch); else r = D.ins('fr_readings', Object.assign({ person_id: x.id, day: a.p_day, opening: null, closing: null, status: 'ok' }, patch))[0];
      return { id: r.id, status: problem ? 'check' : 'ok' };
    },
    fr_check_decide: (a) => {
      const r = D.find('fr_readings', a.p_id); if (!r || r.status !== 'check') return err('This reading is not waiting for a check any more.');
      if (a.p_approve) D.upd('fr_readings', [r], { status: 'ok', check_kind: null, check_note: r.check_note + ' — Approved' + (a.p_note ? ': ' + a.p_note : '') });
      else D.upd('fr_readings', [r], Object.assign({ status: 'ok', check_kind: null, check_note: 'Cleared by reviewer' + (a.p_note ? ': ' + a.p_note : '') }, r.check_kind === 'open' ? { opening: null, open_photo: null } : { closing: null, close_photo: null }));
      return null;
    },
    fr_save_monthly: (a, c) => {
      let n = 0; const warns = [];
      (a.p_rows || []).forEach((r, i) => {
        let pid = r.person_id; if (!pid && r.employee_id) { const x = T('fr_people').find((y) => String(y.employee_id).toLowerCase() === String(r.employee_id).trim().toLowerCase() && y.status === 'active'); pid = x && x.id; }
        if (!pid) { warns.push({ row: i + 1, msg: 'Person not found on the fuel list: ' + (r.employee_id || '?') }); return; }
        const o = Number(r.opening), cl = Number(r.closing); if (!(cl > o)) { warns.push({ row: i + 1, msg: 'Closing must be more than Opening' }); return; }
        const ex = T('fr_monthly').find((m) => m.person_id === pid && m.cycle_start === a.p_cycle);
        if (ex) D.upd('fr_monthly', [ex], { opening: o, closing: cl, note: r.note || null, entered_by: c.uid, updated_at: now() }); else D.ins('fr_monthly', { person_id: pid, cycle_start: a.p_cycle, opening: o, closing: cl, note: r.note || null, entered_by: c.uid, updated_at: now() });
        n++;
      });
      return { saved: n, warnings: warns };
    },
    fr_monthly_delete: (a) => { const rows = T('fr_monthly').filter((m) => m.id === a.p_id || (a.p_ids || []).includes(m.id)); D.del('fr_monthly', rows); return rows.length; }
  };
  D.rpc = R;

  D.callRpc = function (fn, args, ctx) {
    const f = R[fn];
    if (!f) { console.info('[demo] server function answered with a default:', fn, args); return ok(null); }
    try {
      const res = f(args || {}, ctx);
      if (res instanceof Response) return res;
      return ok(res);
    } catch (e) { console.error('[demo rpc]', fn, e); return err(String(e && e.message || e)); }
  };

  // ---------------- Edge functions (bulk riders, password reset, WhatsApp, e-mail, backup)
  D.callFunction = async function (name, body, ctx) {
    const action = body && body.action;
    if (name === 'fieldhub-actions') {
      if (action === 'bulk_create_riders') {
        const results = (body.riders || body.rows || []).map((r) => {
          const phone = '+92' + String(r.phone || '').replace(/[^0-9]/g, '').replace(/^0|^92/, '');
          if (T('profiles').some((p) => p.phone === phone)) return { phone: r.phone, ok: false, success: false, error: 'Phone already registered' };
          const p = D.ins('profiles', { full_name: r.full_name || r.name, phone, employee_id: r.employee_id || null, role: r.role || 'rider', status: 'active', region_id: r.region_id || null, must_change_password: true })[0];
          return { phone: r.phone, ok: true, success: true, id: p.id, user_id: p.id };
        });
        return { results, created: results.filter((x) => x.ok).length };
      }
      if (action === 'reset_password') return { success: true, ok: true, message: 'Password reset (demo).' };
      if (action === 'delete_user') { const p = prof(body.user_id || body.id); if (p) D.upd('profiles', [p], { status: 'disabled' }); return { success: true, ok: true }; }
      if (action === 'send_whatsapp') return { success: true, ok: true, sent: (body.recipients || []).length, demo: true };
      if (action === 'force_signout_self') return { success: true, ok: true };
      if (action === 'expiry_reminders_batch') return { success: true, ok: true, sent: 0 };
      return { success: true, ok: true };
    }
    if (name === 'fieldhub-otp') {
      if (action === 'force_ack_email') return { ok: true, sent: (body.items || []).length, skipped: 0 };
      if (action === 'request' || action === 'send_code') return { ok: true, sent: true, demo: true, message: 'In the demo the code is 123456.' };
      if (action === 'verify') return { ok: String(body.code) === '123456', error: String(body.code) === '123456' ? null : 'Wrong code. In the demo the code is 123456.' };
      return { ok: true };
    }
    if (/backup/i.test(name)) return { ok: true, sent: true, message: 'Backup e-mail is not sent from the demo.' };
    return { ok: true };
  };
  // ---------------- Google Drive script (Fuel pictures): pretend it works
  D.callDrive = async function (b) {
    if (b.action === 'test' || b.action === 'ping') return { ok: true, folder: 'FieldHub Fuel (demo)', name: 'FieldHub Fuel (demo)' };
    if (b.action === 'upload') return { ok: true, id: 'demo-' + Date.now(), file_id: 'demo-' + Date.now() };
    return { ok: true };
  };
})();

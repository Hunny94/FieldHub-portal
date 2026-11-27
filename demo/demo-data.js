/* =====================================================================
   FieldHub DEMO sample data  (demo/demo-data.js)
   Made-up people and records only. No patient data. Dates are counted
   back from today, so the demo always looks current.
   window.FHDEMO_SEED(todayIso) -> { tableName: [rows] }
   ===================================================================== */
window.FHDEMO_LOGINS = [
  { role: 'super_admin', label: 'Super Admin', phone: '03000000001', name: 'Sana Malik' },
  { role: 'admin', label: 'Admin', phone: '03000000002', name: 'Bilal Ahmed' },
  { role: 'regional_poc', label: 'Regional POC', phone: '03000000003', name: 'Usman Tariq' },
  { role: 'team_lead', label: 'Area Incharge', phone: '03000000004', name: 'Kamran Shah' },
  { role: 'coordinator', label: 'Coordinator', phone: '03000000005', name: 'Ayesha Noor' },
  { role: 'inventory_coordinator', label: 'Inventory Coordinator', phone: '03000000006', name: 'Faisal Iqbal' },
  { role: 'rider', label: 'Rider', phone: '03000000007', name: 'Ali Hassan' }
];
window.FHDEMO_PASSWORD = 'demo1234';
window.FHDEMO_DATA_VERSION = 1;   // raise when the sample data below changes (old demo changes are then cleared)

window.FHDEMO_SEED = function (todayIso) {
  'use strict';
  // ---------- deterministic random numbers (same sample data on every open)
  let s = 20261126;
  const rnd = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const chance = (p) => rnd() < p;
  const hex = (n) => { let o = ''; for (let i = 0; i < n; i++) o += Math.floor(rnd() * 16).toString(16); return o; };
  const uid = () => hex(8) + '-' + hex(4) + '-4' + hex(3) + '-' + (8 + Math.floor(rnd() * 4)).toString(16) + hex(3) + '-' + hex(12);

  // ---------- dates
  const T0 = new Date(todayIso + 'T00:00:00Z');
  const day = (n) => new Date(T0.getTime() - n * 864e5).toISOString().slice(0, 10);              // n days ago (yyyy-mm-dd)
  const ts = (n, h, m) => new Date(T0.getTime() - n * 864e5 + ((h == null ? ri(4, 13) : h) * 60 + (m == null ? ri(0, 59) : m)) * 6e4).toISOString();   // UTC; 4-13 UTC = 9am-6pm PKT
  const ym = (back) => { const d = new Date(Date.UTC(T0.getUTCFullYear(), T0.getUTCMonth() - back, 1)); return d.toISOString().slice(0, 7); };
  const T = {};
  const add = (t, row) => { (T[t] = T[t] || []).push(row); return row; };

  // ---------- regions, cities, shifts
  const REG = [
    ['Lahore Center', 26, ['Gulberg', 'Model Town', 'Garden Town']],
    ['Lahore South', 22, ['Johar Town', 'Township', 'Wapda Town']],
    ['Lahore North', 18, ['Shadman', 'Shahdara', 'Samanabad']],
    ['DHA Lahore', 16, ['DHA Phase 5', 'DHA Phase 6', 'Cantt']],
    ['Multan', 12, ['Multan Cantt', 'Gulgasht']],
    ['Faisalabad', 12, ['Madina Town', 'Peoples Colony']],
    ['Raiwind', 6, ['Raiwind City']]
  ];
  const regions = REG.map(([name, hc, subs]) => {
    const r = add('regions', { id: uid(), name, approved_headcount: hc, active: true, created_at: ts(400, 6) });
    r._subs = subs.map((sn) => add('sub_regions', { id: uid(), region_id: r.id, name: sn, active: true, approved_headcount: Math.ceil(hc / subs.length), created_at: ts(400, 6) }));
    return r;
  });
  const lahore = regions.slice(0, 4);
  const RG = (n) => regions.find((r) => r.name === n);
  const shifts = ['Morning (7am–3pm)', 'Evening (3pm–11pm)', 'Split (7am–11am, 5pm–9pm)'].map((name) => add('shift_types', { id: uid(), name, active: true, created_at: ts(400, 6) }));

  // ---------- designations
  const desig = [['Senior Rider', 'rider'], ['Trainee Rider', 'rider'], ['Phlebotomist Rider', 'rider'], ['Area Incharge', 'team_lead'], ['Coordinator', 'coordinator']]
    .map(([name, base_role], i) => add('designations', { id: uid(), name, base_role, active: true, sort_order: (i + 1) * 10, created_at: ts(300, 6) }));

  // ---------- people
  const FIRST = ['Ali', 'Ahmed', 'Hamza', 'Usman', 'Bilal', 'Imran', 'Zeeshan', 'Waqas', 'Adeel', 'Kashif', 'Naveed', 'Shahid', 'Tariq', 'Asif', 'Rizwan', 'Fahad', 'Junaid', 'Saad', 'Umair', 'Danish', 'Haris', 'Arslan', 'Noman', 'Talha', 'Sohail', 'Kamran', 'Yasir', 'Farhan', 'Atif', 'Sajid', 'Azhar', 'Babar', 'Shoaib', 'Irfan', 'Mudassar', 'Raheel'];
  const LAST = ['Khan', 'Ahmed', 'Butt', 'Malik', 'Raza', 'Iqbal', 'Hussain', 'Javed', 'Akhtar', 'Shah', 'Chaudhry', 'Mirza', 'Qureshi', 'Siddiqui', 'Aslam', 'Rana', 'Sheikh', 'Anwar', 'Latif', 'Haider'];
  let empN = 1000, phoneN = 100;
  const usedNames = new Set();
  const nameGen = () => { let n; do { n = pick(FIRST) + ' ' + pick(LAST); } while (usedNames.has(n)); usedNames.add(n); return n; };
  const person = (o) => { Object.keys(o).forEach((k) => { if (o[k] === undefined) delete o[k]; }); if (o.phone) o.phone = '+92' + String(o.phone).replace(/^0/, ''); return add('profiles', Object.assign({
    id: uid(), full_name: o.full_name || nameGen(), employee_id: 'CL-' + (++empN), phone: '+92' + String(o.phone || ('3011' + String(++phoneN).padStart(6, '0'))).replace(/^0/, ''),
    role: 'rider', status: 'active', region_id: null, designation_id: null, email: null, must_change_password: false,
    created_at: ts(ri(200, 700), 6), notifications_last_seen_at: ts(1, 5), bike_number: null, recovery_email: null
  }, o)); };
  const L = window.FHDEMO_LOGINS;
  const P = {};
  P.super = person({ full_name: L[0].name, phone: L[0].phone, role: 'super_admin', region_id: RG('Lahore Center').id, employee_id: 'CL-0001', email: 'sana.malik@example.com', recovery_email: 'sana.malik@example.com' });
  P.admin = person({ full_name: L[1].name, phone: L[1].phone, role: 'admin', region_id: RG('Lahore Center').id, employee_id: 'CL-0002' });
  P.poc = person({ full_name: L[2].name, phone: L[2].phone, role: 'regional_poc', region_id: RG('Lahore Center').id, employee_id: 'CL-0003' });
  P.ai = person({ full_name: L[3].name, phone: L[3].phone, role: 'team_lead', region_id: RG('Lahore Center').id, employee_id: 'CL-0004', designation_id: desig[3].id });
  P.coord = person({ full_name: L[4].name, phone: L[4].phone, role: 'coordinator', region_id: RG('Lahore Center').id, employee_id: 'CL-0005' });
  P.inv = person({ full_name: L[5].name, phone: L[5].phone, role: 'inventory_coordinator', region_id: RG('Lahore Center').id, employee_id: 'CL-0006' });
  [P.super, P.admin, P.poc, P.ai, P.coord, P.inv].forEach((p) => { usedNames.add(p.full_name); p.recovery_email = p.email = p.full_name.toLowerCase().replace(/ /g, '.') + '@example.com'; });
  usedNames.add(L[6].name);
  const link = (p, rs) => rs.forEach((r) => add('profile_regions', { id: uid(), profile_id: p.id, region_id: r.id, created_at: ts(300, 6) }));
  link(P.poc, [RG('Lahore Center'), RG('Lahore South')]);
  link(P.ai, [RG('Lahore Center')]);
  link(P.coord, [RG('Lahore Center')]);
  link(P.inv, lahore);
  // other supervisors (one Area Incharge + one Coordinator per other region, a POC for out-station)
  const leads = { [RG('Lahore Center').id]: P.ai };
  const coords = { [RG('Lahore Center').id]: P.coord };
  regions.slice(1).forEach((r) => {
    const a = person({ role: 'team_lead', region_id: r.id, designation_id: desig[3].id }); link(a, [r]); leads[r.id] = a;
    const c = person({ role: 'coordinator', region_id: r.id }); link(c, [r]); coords[r.id] = c;
  });
  const poc2 = person({ role: 'regional_poc', region_id: RG('Multan').id }); link(poc2, [RG('Multan'), RG('Faisalabad'), RG('Raiwind')]);
  const poc3 = person({ role: 'regional_poc', region_id: RG('Lahore North').id }); link(poc3, [RG('Lahore North'), RG('DHA Lahore')]);
  const inv2 = person({ role: 'inventory_coordinator', region_id: RG('Multan').id }); link(inv2, [RG('Multan'), RG('Faisalabad'), RG('Raiwind')]);
  const staff = T.profiles.filter((p) => p.role !== 'rider');

  // riders
  const riders = [];
  const riderCount = { 'Lahore Center': 14, 'Lahore South': 12, 'Lahore North': 10, 'DHA Lahore': 9, 'Multan': 7, 'Faisalabad': 7, 'Raiwind': 4 };
  const HOT = {};
  regions.forEach((r) => {
    r._subs.forEach((sr) => {
      const base = sr.name.replace(/ (City|Cantt)$/, '');
      HOT[sr.id] = [base + ' Block A', base + ' Block B', base + ' Main Boulevard', base + ' Market'].map((n) => add('hotspots', { id: uid(), region_id: r.id, sub_region_id: sr.id, name: n, active: true, lat: 31.45 + rnd() * 0.15, lng: 74.25 + rnd() * 0.15, created_at: ts(300, 6) }));
    });
    const n = riderCount[r.name];
    for (let i = 0; i < n; i++) {
      const me = r.name === 'Lahore Center' && i === 0;
      const p = person({ full_name: me ? L[6].name : undefined, phone: me ? L[6].phone : undefined, employee_id: me ? 'CL-0007' : undefined, role: 'rider', region_id: r.id,
        designation_id: chance(0.2) ? desig[0].id : chance(0.15) ? desig[2].id : null, bike_number: me ? 'LEA-4471' : (chance(0.85) ? pick(['LEA', 'LEB', 'LEC', 'MNA', 'FDA']) + '-' + ri(1000, 9999) : null), created_at: ts(ri(60, 800), 6) });
      p._region = r; p._sub = r._subs[i % r._subs.length];
      riders.push(p);
    }
  });
  const me = riders[0]; P.rider = me; me.recovery_email = me.email = 'ali.hassan@example.com';
  // a few disabled / pending logins (so Team shows real states)
  const gone = []; for (let i = 0; i < 4; i++) { const r = pick(regions); const p = person({ role: 'rider', region_id: r.id, status: 'disabled', created_at: ts(ri(300, 600), 6) }); p._region = r; p._sub = r._subs[0]; gone.push(p); }
  for (let i = 0; i < 3; i++) person({ role: 'rider', status: 'pending', region_id: null, created_at: ts(ri(0, 3)) });

  // ---------- roster
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  riders.forEach((p, i) => {
    add('roster_entries', { id: uid(), rider_id: p.id, region_id: p._region.id, sub_region_id: p._sub.id, hotspot: pick(HOT[p._sub.id]).name, shift_id: (i % 5 === 4 ? shifts[1] : i % 7 === 6 ? shifts[2] : shifts[0]).id,
      day_off: DAYS[i % 7], personal_mobile: '03' + ri(0, 4) + ri(1, 9) + String(ri(1000000, 9999999)), official_mobile: '0321' + String(ri(1000000, 9999999)), status: 'active', status_date: null,
      removal_reason: null, removal_note: null, replacement_pending: false, created_by: leads[p._region.id].id, created_at: ts(ri(30, 400), 6) });
  });
  gone.forEach((p, i) => add('roster_entries', { id: uid(), rider_id: p.id, region_id: p._region.id, sub_region_id: p._sub.id, hotspot: pick(HOT[p._sub.id]).name, shift_id: shifts[0].id, day_off: DAYS[i], official_mobile: '0321' + ri(1000000, 9999999), personal_mobile: null,
    status: 'removed', removal_reason: pick(['Resigned', 'Terminated', 'Absconded']), status_date: day(ri(10, 60)), removal_note: 'Sample record', replacement_pending: chance(0.5), created_by: P.ai.id, created_at: ts(ri(200, 400), 6) }));
  for (let i = 0; i < 25; i++) {
    const p = pick(riders), d = ri(0, 40);
    add('roster_change_log', { id: 1000 + i, rider_id: p.id, rider_name: p.full_name, employee_id: p.employee_id, region_id: p._region.id, action: pick(['day_off_changed', 'hotspot_changed', 'shift_changed', 'added']), field: 'day_off', old_value: pick(DAYS), new_value: pick(DAYS), changed_by: P.ai.id, changed_by_name: P.ai.full_name, changed_at: ts(d) });
  }

  // ---------- On Job Training
  for (let i = 0; i < 8; i++) {
    const r = pick(regions); const st = i < 5 ? 'in_training' : i < 7 ? 'moved' : 'dropped';
    add('roster_ojt', { id: uid(), full_name: nameGen(), mobile: '0300' + ri(1000000, 9999999), employee_id: 'CL-' + (2000 + i), region_id: r.id, sub_region_id: r._subs[0].id, designation_id: desig[1].id,
      joining_date: day(ri(3, 25)), expected_end: day(-ri(3, 20)), trainer_name: leads[r.id].full_name, notes: i % 3 === 0 ? 'Good progress with sample handling.' : null, status: st,
      moved_rider_id: st === 'moved' ? pick(riders).id : null, moved_at: st === 'moved' ? ts(ri(1, 5)) : null, created_by: leads[r.id].id, created_at: ts(ri(5, 30)), updated_at: ts(ri(0, 5)) });
  }

  // ---------- request categories + routing
  const CATS = [['Bike Maintenance', 'team_lead', 48, true], ['Uniform', 'inventory_coordinator', 72, true], ['Sample Box / Cooler', 'inventory_coordinator', 24, true], ['Glucometer / Strips', 'inventory_coordinator', 24, true],
    ['Mobile Phone / SIM', 'coordinator', 48, true], ['Fuel Card', 'team_lead', 24, true], ['Salary / Allowance Query', 'regional_poc', 72, true], ['Leave Request', 'team_lead', 24, true], ['POS Machine Fault', 'coordinator', 24, true], ['Other', 'coordinator', 72, false]];
  const cats = CATS.map(([name, primary_role, tat_hours, rc]) => add('categories', { id: uid(), name, primary_role, tat_hours, active: true, riders_can_request: rc, created_at: ts(400, 6) }));
  add('categories', { id: uid(), name: 'Raincoat (old)', primary_role: 'inventory_coordinator', tat_hours: 72, active: false, riders_can_request: true, created_at: ts(500, 6) });
  regions.forEach((r) => cats.slice(0, 4).forEach((c) => add('request_routing_rules', { id: uid(), region_id: r.id, category_id: c.id, target_role: c.primary_role, created_at: ts(300, 6) })));
  add('category_region_overrides', { id: uid(), category_id: cats[1].id, region_id: RG('Multan').id, role: 'team_lead', created_at: ts(200, 6) });

  const DESC = {
    'Bike Maintenance': ['Rear brake is weak, needs adjustment before evening shift.', 'Front tyre puncture twice this week, please arrange a new tube.', 'Chain is loose and making noise.', 'Headlight not working, unsafe for evening visits.'],
    'Uniform': ['Need two new shirts, size L.', 'Jacket zip broken, please replace.', 'Cap and ID card holder required.'],
    'Sample Box / Cooler': ['Cooler box lid cracked, temperature not holding.', 'Need extra ice packs for summer shift.', 'Sample box strap torn.'],
    'Glucometer / Strips': ['Strips finished, need one new pack.', 'Glucometer showing error E-3.'],
    'Mobile Phone / SIM': ['Official SIM balance finished.', 'Phone screen cracked, touch not working on one side.', 'Need a new SIM, old one damaged.'],
    'Fuel Card': ['Fuel card not accepted at the pump.', 'Fuel card limit reached before month end.'],
    'Salary / Allowance Query': ['Night allowance for last month not added.', 'Please confirm overtime hours for the 2nd week.'],
    'Leave Request': ['Requesting leave for two days for a family event.', 'Need half-day leave on Thursday.'],
    'POS Machine Fault': ['POS machine not printing receipts.', 'POS battery drains in two hours.'],
    'Other': ['Please update my bike number in the system.', 'Need training on the new sample labelling.']
  };
  const handlerFor = (cat, r) => {
    if (cat.primary_role === 'team_lead') return leads[r.id];
    if (cat.primary_role === 'coordinator') return coords[r.id];
    if (cat.primary_role === 'inventory_coordinator') return lahore.includes(r) ? P.inv : inv2;
    if (cat.primary_role === 'regional_poc') return [RG('Lahore Center'), RG('Lahore South')].includes(r) ? P.poc : lahore.includes(r) ? poc3 : poc2;
    return null;
  };
  const REMARK = { in_progress: ['Noted, arranging it today.', 'Forwarded to the workshop.', 'Checking with the store.'], resolved: ['Done, please confirm.', 'Replaced. Please acknowledge.', 'Issued from store.'], cancelled: ['Duplicate request.', 'Cancelled on rider\'s request.'], closed: ['Received, thank you.', 'Confirmed by rider.'] };
  const reqs = [];
  const mkReq = (rider, ageDays, status, catIdx) => {
    const cat = catIdx == null ? pick(cats) : cats[catIdx];
    const h = handlerFor(cat, rider._region);
    const created = ts(ageDays);
    const r = add('requests', { id: uid(), rider_id: rider.id, region_id: rider._region.id, category_id: cat.id, category: cat.name, description: pick(DESC[cat.name]), status, assigned_poc_id: h ? h.id : null,
      created_at: created, updated_at: created, resolved_at: null, closed_at: null, deleted_at: null, deleted_by: null });
    const thread = [];
    if (status !== 'open') thread.push({ s: status === 'cancelled' ? 'cancelled' : 'in_progress', by: h || P.admin, d: Math.max(ageDays - 1, 0) });
    if (status === 'resolved' || status === 'closed') thread.push({ s: 'resolved', by: h || P.admin, d: Math.max(ageDays - ri(1, 3), 0) });
    if (status === 'closed') thread.push({ s: 'closed', by: rider, d: Math.max(ageDays - ri(3, 5), 0) });
    thread.forEach((t) => {
      const at = ts(t.d);
      add('request_updates', { id: uid(), request_id: r.id, message: pick(REMARK[t.s] || REMARK.in_progress), created_by: t.by.id, new_status: t.s, created_at: at });
      if (t.s === 'resolved') r.resolved_at = at;
      if (t.s === 'closed') r.closed_at = at;
      r.updated_at = at;
    });
    if (status === 'open' && chance(0.3)) add('request_updates', { id: uid(), request_id: r.id, message: 'Any update please?', created_by: rider.id, new_status: null, created_at: ts(Math.max(ageDays - 1, 0)) });
    reqs.push(r); return r;
  };
  riders.forEach((rd) => { const n = rd === me ? 0 : ri(1, 4); for (let i = 0; i < n; i++) { const age = ri(0, 75); mkReq(rd, age, age < 3 ? pick(['open', 'open', 'in_progress']) : age < 10 ? pick(['open', 'in_progress', 'resolved', 'closed', 'closed']) : pick(['closed', 'closed', 'closed', 'closed', 'closed', 'closed', 'resolved', 'cancelled'])); } });
  // the demo rider's own requests: one of each state
  mkReq(me, 0, 'open', 0); mkReq(me, 2, 'in_progress', 4); mkReq(me, 4, 'resolved', 2); mkReq(me, 12, 'closed', 1); mkReq(me, 30, 'closed', 5);
  // two deleted ones for Trash
  const delR = mkReq(pick(riders), 1, 'open'); delR.deleted_at = ts(0, 5); delR.deleted_by = P.ai.id;

  // ---------- tool types + issuances
  const tools = [['Helmet', 'years', 2], ['Uniform Set', 'months', 6], ['Cooler Box', 'years', 1], ['Glucometer', 'after_review', null], ['Raincoat', 'months', 12], ['Mobile Phone', 'wear_tear', null], ['Tourniquet Kit', 'months', 3]]
    .map(([name, reissue_basis, interval_months]) => add('tool_types', { id: uid(), name, reissue_basis, interval_months, active: true, created_at: ts(400, 6) }));
  const addMonths = (iso, m) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + m); return d.toISOString().slice(0, 10); };
  const issuances = [];
  riders.concat(gone).forEach((rd) => {
    tools.forEach((tt, k) => {
      if (k > 4 && !chance(0.4)) return;
      const span = tt.reissue_basis === 'months' ? tt.interval_months * 30 : tt.reissue_basis === 'years' ? tt.interval_months * 365 : 400;
      const issued = day(chance(0.1) ? ri(span, span + 40) : ri(5, Math.max(10, span - 15)));
      const next = tt.reissue_basis === 'months' ? addMonths(issued, tt.interval_months) : tt.reissue_basis === 'years' ? addMonths(issued, 12 * tt.interval_months) : null;
      const it = add('tool_issuances', { id: uid(), rider_id: rd.id, region_id: rd._region.id, tool_type_id: tt.id, issued_date: issued, next_due_date: next, serial_number: chance(0.5) ? tt.name.slice(0, 2).toUpperCase() + '-' + ri(10000, 99999) : null,
        recorded_by: P.inv.id, request_id: null, recovered_on: null, recovered_note: null, created_at: ts(ri(5, 500)) });
      issuances.push(it);
      if (chance(it.issued_date < day(10) ? 0.97 : 0.4)) add('tool_issuance_acks', { id: uid(), tool_issuance_id: it.id, user_id: rd.id, acknowledged_at: it.created_at, created_at: it.created_at });
    });
  });
  // tools issued against resolved requests (waiting for the rider's acknowledgement)
  reqs.filter((r) => r.status === 'resolved').slice(0, 10).forEach((r, i) => {
    const it = add('tool_issuances', { id: uid(), rider_id: r.rider_id, region_id: r.region_id, tool_type_id: tools[i % 3].id, issued_date: (r.resolved_at || ts(1)).slice(0, 10), next_due_date: addMonths((r.resolved_at || ts(1)).slice(0, 10), 12), serial_number: null, recorded_by: r.assigned_poc_id, request_id: r.id, created_at: r.resolved_at });
    issuances.push(it);
  });
  // a resigned rider who still holds tools
  gone.forEach((g) => issuances.filter((x) => x.rider_id === g.id).slice(0, 2).forEach((x, i) => { if (i === 1) { x.recovered_on = day(ri(1, 9)); x.recovered_note = 'Returned to store'; } }));

  // ---------- warnings
  const wtypes = ['Late arrival', 'Uniform not worn', 'Sample handling lapse', 'Rude behaviour', 'Absent without notice'].map((name) => add('warning_types', { id: uid(), name, active: true, created_at: ts(400, 6) }));
  for (let i = 0; i < 22; i++) {
    const rd = i === 0 ? me : pick(riders), wt = pick(wtypes), d = ri(1, 90);
    add('disciplinary_actions', { id: uid(), rider_id: rd.id, warning_type_id: wt.id, action_type: wt.name, description: pick(['Reached the first visit 40 minutes late.', 'Second reminder this month.', 'Verbal warning given, written copy shared.', 'Was not wearing the company shirt during visits.', 'Late sample drop-off at the lab.']), recorded_by: leads[rd._region.id].id, created_at: ts(d) });
  }

  // ---------- expiry tracker
  const etypes = ['Driving Licence', 'Bike Token Tax', 'Bike Insurance', 'Medical Fitness', 'Hepatitis B Vaccination'].map((name) => add('expiry_item_types', { id: uid(), name, active: true, created_at: ts(400, 6) }));
  riders.forEach((rd, i) => {
    const n = rd === me ? 2 : ri(0, 2);
    for (let k = 0; k < n; k++) {
      const et = etypes[(i + k) % etypes.length]; const exp = day(-ri(-25, 150)); const g = uid();
      add('expiry_items', { id: uid(), group_id: g, rider_id: rd.id, region_id: rd._region.id, applies_to_role: 'Rider', item_type_id: et.id, item_type: et.name, item_label: et.name + ' — ' + rd.full_name.split(' ')[0],
        expiry_date: exp, status: chance(0.1) ? 'closed' : 'active', created_by: leads[rd._region.id].id, created_at: ts(ri(20, 200)), deleted_at: null, deleted_by: null });
    }
  });
  regions.forEach((r) => add('expiry_items', { id: uid(), group_id: uid(), rider_id: null, region_id: r.id, applies_to_role: 'All', item_type_id: null, item_type: 'Rental Agreement', item_label: r.name + ' office rental agreement', expiry_date: day(-ri(10, 200)), status: 'active', created_by: P.super.id, created_at: ts(100), deleted_at: null }));

  // ---------- compliance
  const ctypes = ['Uniform photo', 'Bike fitness check', 'Kit check (cooler, tourniquet, strips)', 'Monthly training quiz'].map((name) => add('compliance_item_types', { id: uid(), name, active: true, created_at: ts(400, 6) }));
  [ym(0), ym(1), ym(2)].forEach((period, pi) => riders.forEach((rd) => ctypes.forEach((ct) => { if (chance(pi === 0 ? 0.55 : 0.9)) add('compliance_submissions', { id: uid(), rider_id: rd.id, region_id: rd._region.id, item_type_id: ct.id, period, submitted_at: ts(pi * 30 + ri(0, 20)), created_at: ts(pi * 30 + ri(0, 20)) }); })));

  // ---------- tasks
  const TASKS = ['Collect monthly kit-check photos from all riders', 'Update roster day-offs for next week', 'Arrange bike service camp for South region', 'Share the new sample labelling SOP with riders', 'Verify fuel cards for new joiners', 'Plan Eid duty roster', 'Follow up on pending uniform requests', 'Prepare weekly TAT report', 'Conduct field visit for two riders', 'Collect expired driving licence copies'];
  const supervisors = [P.poc, P.ai, P.coord, P.inv, poc2, poc3].concat(Object.values(leads), Object.values(coords));
  [[P.super, P.admin, 'Review the monthly KPI dashboard', 'in_progress'], [P.super, P.admin, 'Approve the new uniform vendor', 'pending'], [P.admin, P.super, 'Share the Q4 hiring plan', 'pending'], [P.admin, P.super, 'Check fuel reimbursement for Multan', 'completed']].forEach(([to, by, title, st], i) => {
    add('tasks', { id: uid(), title, description: 'Please complete and update here.', assigned_to: to.id, assigned_by: by.id, region_id: null, due_date: day(-ri(1, 7)), status: st, created_at: ts(i + 1), deleted_at: null, deleted_by: null });
  });
  for (let i = 0; i < 36; i++) {
    const to = i < 6 ? [P.ai, P.coord, P.inv, P.poc, P.ai, P.coord][i] : pick(supervisors); const by = to.role === 'regional_poc' ? P.admin : pick([P.super, P.admin, P.poc]);
    const age = ri(0, 40); const st = age < 5 ? pick(['pending', 'in_progress']) : pick(['completed', 'completed', 'in_progress', 'pending']);
    const t = add('tasks', { id: uid(), title: pick(TASKS), description: 'Please complete and update here.', assigned_to: to.id, assigned_by: by.id, region_id: to.region_id, due_date: day(age - ri(2, 10)), status: st, created_at: ts(age), deleted_at: null, deleted_by: null });
    if (st !== 'pending') add('task_updates', { id: uid(), task_id: t.id, message: st === 'completed' ? 'Completed.' : 'Working on it.', new_status: st, created_by: to.id, created_at: ts(Math.max(age - 1, 0)) });
  }

  // ---------- circulars
  const ccats = ['Operations', 'HR', 'Safety', 'Quality'].map((name) => add('circular_categories', { id: uid(), name, active: true, created_at: ts(400, 6) }));
  const CIRC = [
    ['Winter shift timings', 'From 1st December the morning shift starts at 7:30am. Please plan your first visits accordingly.', 0],
    ['Helmet is compulsory', 'Riding without a helmet is not allowed during duty hours. Area Incharges will check during field visits.', 2],
    ['Sample drop-off cut-off time', 'All morning samples must reach the lab by 1:00pm. Late samples must be reported to the Coordinator.', 3],
    ['Eid holidays roster', 'Day-offs during Eid will be shared by each Area Incharge one week before.', 0],
    ['New uniform distribution', 'New winter jackets will be issued region-wise. Requests can be made from the Requests page.', 1],
    ['Fuel reimbursement: daily meter readings', 'Please enter your bike meter opening and closing reading every day in the app.', 0],
    ['Cooler temperature checks', 'Check the ice packs before every shift. Report damaged coolers the same day.', 3],
    ['Quarterly performance review', 'Top performers of the quarter will be announced on the home page.', 1]
  ];
  const circs = CIRC.map(([title, body, ci], i) => add('circulars', { id: uid(), title, body, category_id: ccats[ci].id, created_by: i % 2 ? P.admin.id : P.super.id, target_region_id: null, target_region_ids: null, target_role: null, target_roles: null, push_to_kb: i === 2 || i === 6, created_at: ts(i * 6 + 1), deleted_at: null, deleted_by: null }));
  circs.forEach((c, i) => T.profiles.filter((p) => p.status === 'active' && p.id !== c.created_by).forEach((p) => { if (p.id === me.id && i < 2) return; if (chance(i < 2 ? 0.5 : 0.85)) add('circular_acks', { id: uid(), circular_id: c.id, user_id: p.id, acknowledged_at: ts(Math.max(i * 6 - 1, 0)), created_at: ts(Math.max(i * 6 - 1, 0)) }); }));

  // ---------- knowledge base, resources, release notes, notices, popups
  [['How to raise a request', 'Open Requests → New Request, choose the category, write a short description and submit. You can follow the progress in the same page.'],
    ['Sample handling checklist', '1. Label every tube at the patient\'s home.\n2. Keep samples in the cooler with ice packs.\n3. Drop off before the cut-off time.'],
    ['Bike maintenance policy', 'Minor repairs are paid by the company after approval from the Area Incharge. Keep the receipt.'],
    ['Leave policy for riders', 'Leave must be requested at least 2 days before, except emergencies.'],
    ['Using the POS machine', 'Charge the POS every night. Report faults from My POS → Report a fault.'],
    ['Fuel reimbursement guide', 'Enter Opening in the morning and Closing at the end of the day. Add a meter picture when asked.']]
    .forEach(([title, body], i) => add('knowledge_base_articles', { id: uid(), title, body, table_data: null, created_by: i % 2 ? P.admin.id : P.super.id, created_at: ts(20 + i * 9) }));
  [['Lab test price list', 'Lab', 'https://example.com/price-list'], ['Rider training videos', 'Training', 'https://example.com/training'], ['HR leave form', 'HR', 'https://example.com/leave-form'], ['Emergency contacts', 'Operations', 'https://example.com/contacts'], ['Uniform size chart', 'HR', 'https://example.com/sizes'], ['Safety SOP', 'Operations', 'https://example.com/safety']]
    .forEach(([title, category, url]) => add('resource_links', { id: uid(), title, category, url, created_by: P.super.id, created_at: ts(60) }));
  [['Acknowledgements screen', 'Force acknowledge now opens a clear list with preview and settings.'], ['Fuel Reimbursement', 'Daily meter readings for riders, monthly entry for couriers.'], ['Request details panel', 'Requests open in a side panel with all actions in the header.'], ['Top performers', 'Monthly top performers on the home page.']]
    .forEach(([title, body], i) => add('release_notes', { id: uid(), title, body, created_by: P.super.id, created_at: ts(i * 7 + 1) }));
  add('home_notices', { id: uid(), message: 'Bike service camp this Saturday at the Gulberg office, 10am to 4pm.', active: true, expires_at: day(-5), created_by: P.super.id, created_at: ts(2) });
  add('home_notices', { id: uid(), message: 'Please acknowledge the new winter shift circular.', active: true, expires_at: null, created_by: P.admin.id, created_at: ts(1) });
  add('popup_announcements', { id: uid(), title: 'Welcome to FieldHub', body: 'This is the demo version with sample data. Feel free to click around: changes stay on this device only.', active: true, created_by: P.super.id, created_at: ts(1) });

  // ---------- field visits
  const CPS = [['Rider in full uniform', 15], ['Helmet worn', 15], ['Cooler with ice packs', 15], ['Samples labelled correctly', 20], ['Tourniquet & strips available', 10], ['Polite with customer', 15], ['On time for the visit', 10]];
  const cps = CPS.map(([name, weight], i) => add('fv_checkpoints', { id: uid(), name, weight, active: true, sort_order: (i + 1) * 10, created_at: ts(300, 6) }));
  const centers = [];
  regions.forEach((r) => r._subs.forEach((sr, k) => centers.push(add('fv_centers', { id: uid(), name: 'Chughtai Lab ' + sr.name, code: 'C' + (100 + centers.length), city: r.name.indexOf('Lahore') === 0 || r.name === 'DHA Lahore' || r.name === 'Raiwind' ? 'Lahore' : r.name, latitude: 31.45 + rnd() * 0.15, longitude: 74.25 + rnd() * 0.15, radius_m: 150, active: true, created_by: P.super.id, created_at: ts(200, 6) }))));
  const fvRiders = riders.filter((x, i) => i % 2 === 0 || x === me);
  fvRiders.forEach((rd) => {
    const nV = ri(1, 4);
    for (let k = 0; k < nV; k++) {
      const age = ri(1, 80), by = leads[rd._region.id];
      const answers = cps.map((c) => { const ok = chance(0.86); return { cp: c.id, text: c.name, weight: c.weight, status: ok ? 'OK' : 'Issue', obs: ok ? '' : pick(['Not available at the time of visit.', 'Advised and corrected on the spot.', 'Needs a replacement.']) }; });
      const score = Math.round(answers.reduce((a, x) => a + (x.status === 'OK' ? x.weight : 0), 0) * 10) / 10;
      const v = add('fv_visits', { id: uid(), rider_id: rd.id, rider_name: rd.full_name, rider_employee_id: rd.employee_id, region_id: rd._region.id, region_name: rd._region.name, sub_region_name: rd._sub.name, submitted_by: by.id, submitted_by_name: by.full_name,
        visit_date: day(age), visit_type: chance(0.7) ? 'onsite' : 'online', score, ok_count: answers.filter((a) => a.status === 'OK').length, issue_count: answers.filter((a) => a.status !== 'OK').length, edit_count: 0, answers, center_id: pick(centers).id, created_at: ts(age) });
      answers.filter((a) => a.status !== 'OK').forEach((a) => { const res = age > 10 && chance(0.7); add('fv_issues', { id: uid(), visit_id: v.id, rider_id: rd.id, rider_name: rd.full_name, region_id: rd._region.id, visit_date: v.visit_date, cp_key: a.cp, cp_text: a.text, observation: a.obs, status: res ? 'resolved' : 'open', resolved_at: res ? ts(age - 3) : null, resolved_note: res ? 'Corrected' : null, created_at: v.created_at }); });
    }
  });
  T.profiles.filter((p) => p.role === 'team_lead').forEach((p) => add('fv_targets', { id: uid(), profile_id: p.id, onsite_kpi: 6, online_target: 20, effective_from: day(120), note: 'Monthly target', created_at: ts(120) }));
  add('fv_checkpoint_log', { id: 1, action: 'published', detail: '7 checkpoints', changed_by: P.super.id, changed_by_name: P.super.full_name, changed_at: ts(90) });

  // ---------- POS
  const faults = ['Not printing', 'Battery issue', 'Screen broken', 'Network / SIM error', 'Card reader not working'].map((name, i) => add('pos_fault_types', { id: uid(), name, active: true, sort_order: (i + 1) * 10, created_at: ts(200, 6) }));
  const banks = ['HBL', 'Meezan Bank', 'UBL', 'Bank Alfalah'];
  riders.forEach((rd, i) => {
    if (i % 3 === 2 && rd !== me) return;
    const m = add('pos_machines', { id: uid(), sn: 'SN' + ri(100000, 999999), bank_name: pick(banks), mid: 'M' + ri(10000, 99999), tid: 'T' + ri(10000, 99999), employee_id: rd.employee_id, rider_id: rd.id, rider_name: rd.full_name, nexus_id: 'NX-' + ri(1000, 9999),
      device_type: pick(['Android', 'Non-Android']), region_id: rd._region.id, sub_region_id: rd._sub.id, issued_date: day(ri(10, 300)), charger_given: chance(0.8), status: chance(0.08) ? 'in_repair' : 'issued', created_at: ts(ri(10, 300)), updated_at: ts(ri(0, 10)) });
    add('pos_events', { id: 5000 + T.pos_events?.length || 5000, machine_id: m.id, action: 'issued', detail: 'Issued to ' + rd.full_name, actor: P.inv.id, created_at: m.created_at });
    if (m.status === 'in_repair') add('pos_repairs', { id: uid(), machine_id: m.id, rider_id: rd.id, rider_name: rd.full_name, rider_employee_id: rd.employee_id, fault_type_id: faults[0].id, fault_name: faults[0].name, remark: 'Stopped printing in the morning.', reported_by_rider: true, status: 'reported', created_at: ts(ri(0, 4)) });
  });
  for (let i = 0; i < 9; i++) add('pos_machines', { id: uid(), sn: 'SN' + ri(100000, 999999), bank_name: pick(banks), mid: 'M' + ri(10000, 99999), tid: 'T' + ri(10000, 99999), employee_id: null, rider_id: null, rider_name: null, nexus_id: null, device_type: pick(['Android', 'Non-Android']), region_id: pick(lahore).id, sub_region_id: null, issued_date: null, charger_given: false, charger_in_stock: true, status: i < 7 ? 'in_stock' : 'retired', created_at: ts(ri(30, 300)), updated_at: ts(ri(0, 30)) });
  (T.pos_events || []).forEach((e, i) => { e.id = 5000 + i; });

  // ---------- top performers
  [riders[3], riders[16], riders[30], me].forEach((rd, i) => add('top_performers', { id: uid(), rider_id: rd.id, rider_name: rd.full_name, employee_id: rd.employee_id, region_name: rd._region.name, perf_month: ym(1) + '-01', expires_on: day(-20), note: pick(['Highest visits with zero complaints', 'Best TAT in the region', '100% field-visit score']), photo: null, created_by: P.super.id, created_at: ts(5 + i) }));

  // ---------- Fuel Trends (monthly history)
  const fcats = ['Home Sampling', 'Home Care', 'Accounts Courier', 'Sample Collection Courier', 'Maintenance Team'];
  fcats.forEach((name) => add('fuel_categories', { id: uid(), name, created_at: ts(400, 6) }));
  [['Home Sampling', 90, null, 3000, 1.6], ['Home Care', 80, null, 2600, 1.8], ['Accounts Courier', 70, null, 2200, null], ['Sample Collection Courier', 110, null, 3400, null], ['Maintenance Team', 60, null, 1800, null]]
    .forEach(([category, max_liters, max_amount, max_km, max_lpv]) => add('fuel_limits', { id: uid(), category, max_liters, max_amount, max_km, max_lpv }));
  for (let b = 12; b >= 1; b--) add('fuel_rates', { id: uid(), month: ym(b) + '-01', rs_per_km: Math.round((6.5 + (12 - b) * 0.15) * 100) / 100 });
  let frId = 1;
  for (let b = 12; b >= 1; b--) {
    const month = ym(b) + '-01';
    riders.forEach((rd, i) => {
      const cat = i % 6 === 5 ? 'Home Care' : 'Home Sampling';
      const visits = ri(70, 160), km = Math.round(visits * (6 + rnd() * 5) * (i % 13 === 4 ? 3.6 : 1)), lit = Math.round(km / 38);
      add('fuel_records', { id: frId++, month, employee_id: rd.employee_id, rider_name: rd.full_name, lead_name: leads[rd._region.id].full_name, region_name: rd._region.name, city: rd._region.name.indexOf('Lahore') >= 0 || rd._region.name === 'DHA Lahore' ? 'Lahore' : rd._region.name, location: rd._sub.name, category: cat, approved_liters: lit, amount: Math.round(lit * 265), km, visits });
    });
    ['Accounts Courier', 'Sample Collection Courier', 'Maintenance Team'].forEach((cat, k) => { for (let j = 0; j < 3; j++) { const km = ri(1400, 3200), lit = Math.round(km / 35); add('fuel_records', { id: frId++, month, employee_id: 'CR-' + (300 + k * 10 + j), rider_name: 'Courier ' + String.fromCharCode(65 + k * 3 + j), lead_name: 'Courier Manager', region_name: pick(['Lahore Center', 'Lahore South', 'Multan']), city: 'Lahore', location: 'Head Office', category: cat, approved_liters: lit, amount: Math.round(lit * 265), km, visits: 0 }); } });
  }
  regions.forEach((r) => [ym(3), ym(1)].forEach((m) => add('fuel_centers', { id: T.fuel_centers ? T.fuel_centers.length + 1 : 1, month: m + '-01', category: 'Home Sampling', region_name: r.name, centers: ri(2, 9) })));

  // ---------- Fuel Reimbursement
  add('fr_settings', { id: 1, cycle_start_day: 16, back_days: 2, allow_equal: false, drive_url: 'https://demo-drive.invalid/exec', updated_at: ts(30) });
  const groups = [['Home Sampling', true, 12], ['Home Care', true, 15], ['Accounts Courier', false, null], ['Sample Collection Courier', false, null]].map(([name, visit_based, mk]) => add('fr_groups', { id: uid(), name, visit_based, max_km_per_visit: mk, active: true, created_at: ts(30) }));
  const bike = add('fr_vehicle_types', { id: uid(), name: 'Motorbike', km_per_litre: 40, maint_per_km: 1.5, max_km_day: 250, max_gap_km: 60, active: true, created_at: ts(30) });
  add('fr_vehicle_types', { id: uid(), name: 'Car', km_per_litre: 12, maint_per_km: 4, max_km_day: 400, max_gap_km: 100, active: true, created_at: ts(30) });
  regions.forEach((r) => add('fr_region_cfg', { region_id: r.id, reviewer: lahore.includes(r) ? 'area' : 'super_admin' }));
  add('fr_photo_rules', { id: uid(), scope: 'all', scope_id: null, rule: 'optional', created_at: ts(30) });
  add('fr_access', { id: uid(), user_id: P.ai.id, regions: [RG('Lahore Center').id], groups: [], can_review: true, can_enter: true, can_request: true, title: 'Area Lead', updated_at: ts(20) });
  add('fr_access', { id: uid(), user_id: P.poc.id, regions: [RG('Lahore Center').id, RG('Lahore South').id], groups: [], can_review: true, can_enter: false, can_request: true, title: 'Regional Lead', updated_at: ts(20) });
  const frp = [];
  riders.forEach((rd, i) => frp.push(add('fr_people', { id: uid(), profile_id: rd.id, full_name: rd.full_name, employee_id: rd.employee_id, region_id: rd._region.id, city_id: rd._sub.id, group_id: (i % 6 === 5 ? groups[1] : groups[0]).id, vehicle_type_id: bike.id, status: 'active', source: 'roster', created_at: ts(25), updated_at: ts(25) })));
  const couriers = [];
  for (let j = 0; j < 5; j++) couriers.push(add('fr_people', { id: uid(), profile_id: null, full_name: 'Courier ' + String.fromCharCode(65 + j), employee_id: 'CR-' + (300 + j), region_id: RG('Lahore Center').id, city_id: RG('Lahore Center')._subs[0].id, group_id: groups[2 + (j % 2)].id, vehicle_type_id: bike.id, status: 'active', source: 'manual', created_at: ts(25), updated_at: ts(25) }));
  add('fr_people', { id: uid(), profile_id: null, full_name: nameGen(), employee_id: 'CR-399', region_id: RG('Lahore South').id, city_id: RG('Lahore South')._subs[0].id, group_id: groups[2].id, vehicle_type_id: bike.id, status: 'pending', source: 'request', requested_by: P.poc.id, created_at: ts(1), updated_at: ts(1) });
  // readings for the current and previous cycle
  const cycStart = (() => { const d = new Date(T0); if (d.getUTCDate() >= 16) d.setUTCDate(16); else { d.setUTCMonth(d.getUTCMonth() - 1); d.setUTCDate(16); } return d; })();
  const daysBack = Math.round((T0 - cycStart) / 864e5) + 30;
  frp.forEach((x, i) => {
    let meter = ri(12000, 48000);
    for (let n = daysBack; n >= 0; n--) {
      if (n === 0 && i % 3 === 0) continue;           // some riders have not entered today yet
      if (chance(0.12)) { meter += ri(0, 3); continue; }  // day off
      const check = n > 0 && chance(0.007);
      const open = meter + ri(0, 3), km = check ? ri(255, 295) : ri(35, 95), close = open + km; meter = close;
      add('fr_readings', { id: uid(), person_id: x.id, day: day(n), opening: open, closing: n === 0 && chance(0.6) ? null : close, open_photo: null, close_photo: null, status: check ? 'check' : 'ok', check_kind: check ? 'close' : null, check_note: check ? 'That is ' + km + ' KM in one day (Opening ' + open + ' → Closing ' + close + '). The limit is 250 KM. — Reason: ' + pick(['Long route to Raiwind for a home visit', 'Two extra visits in Kasur', 'Sample drop to the main lab twice']) : null, entered_by: x.profile_id, updated_at: ts(n, 13) });
    }
  });
  couriers.forEach((c) => { const prev = new Date(cycStart); prev.setUTCMonth(prev.getUTCMonth() - 1); const o = ri(20000, 60000); add('fr_monthly', { id: uid(), person_id: c.id, cycle_start: prev.toISOString().slice(0, 10), opening: o, closing: o + ri(1500, 3000), note: null, entered_by: P.super.id, updated_at: ts(10) }); });
  for (let i = 0; i < 12; i++) add('fr_log', { id: i + 1, at: ts(i * 2), actor: P.super.id, entity: pick(['people', 'settings', 'reading', 'access']), entity_id: null, action: pick(['changed', 'added', 'entered by staff', 'check approved']), old_val: null, new_val: { note: 'sample' }, reason: null });

  // ---------- acknowledgements (v102)
  add('fh_ack_settings', { id: 1, force_enabled: true, min_hours: 48, auto_enabled: false, auto_hours: 72, remind_enabled: true, remind_hours: 6, rider_prompt: true });

  // ---------- notifications for the demo logins
  const notice = (u, kind, title, body, age) => add('expiry_notices', { id: uid(), user_id: u.id, kind, title, body, created_at: ts(age), read_at: null });
  notice(me, 'expiry', 'Driving Licence expires soon', 'Your Driving Licence expires in 12 days. Please renew it and share a copy with your Area Incharge.', 1);
  notice(me, 'pos_issued', 'POS machine issued', 'A POS machine was issued to you. Please keep it charged.', 6);
  notice(P.ai, 'expiry', '3 items expire this week', 'Bike Token Tax and Driving Licence items in Lahore Center expire within 7 days.', 0);

  // ---------- settings rows
  add('system_settings', { id: 1, portal_active: true, maintenance_message: 'FieldHub is temporarily unavailable for maintenance. Please check back shortly.', welcome_title: 'Welcome to FieldHub', welcome_text: 'Home Sampling operations in one place: requests, roster, tools, field visits and fuel.',
    app_apk_url: null, app_min_build: 0, app_latest_build: 0, app_update_message: null, circular_word_limit: 300, request_remark_word_limit: 80, task_remark_word_limit: 80, warning_word_limit: 120, fv_geo_required: false, fv_issue_min_words: 3,
    session_timeout_minutes: 0, web_auto_signout_enabled: false, notification_retain_count: 50, nav_icons: null, updated_by: P.super.id, updated_at: ts(10) });
  add('branding_settings', { id: 1, tagline: 'Operational Excellence Portal', subtitle: 'Secure access for authorized personnel', login_title: 'Home Sampling Admin Login', login_subtitle: 'Enter your mobile number and password to continue', logo_url: null, sidebar_bg_url: null, login_bg_url: null, favicon_url: null, updated_at: ts(30) });
  add('home_banner', { id: 1, image_url: null, image_path: null, title: null, expires_at: null, updated_at: ts(30) });
  add('fh_fuel_security', { id: 1, required: false });
  [['How do I raise a request?', 'Open Requests and press + New Request.', null], ['Where is my roster?', 'Open Roster from the menu to see your hotspot, shift and day off.', ['rider']], ['How do I reset a password?', 'Team → choose the person → Reset password.', ['super_admin', 'admin', 'team_lead']]]
    .forEach(([label, answer, roles], i) => add('chat_quick_questions', { id: uid(), label, answer, roles, sort_order: (i + 1) * 10, active: true, created_at: ts(50) }));
  add('password_reset_requests', { id: uid(), phone: riders[5].phone, note: 'Forgot my password after phone change', status: 'pending', created_at: ts(0, 5) });
  for (let i = 0; i < 40; i++) { const p = pick(T.profiles); add('activity_log', { id: uid(), actor_id: p.id, action: pick(['created a request', 'updated a task', 'acknowledged a circular', 'added a roster entry', 'issued a tool', 'submitted a field visit']), entity_type: pick(['Request', 'Task', 'Circular', 'Roster', 'Tool', 'Field Visit']), entity_label: p.full_name, archived: false, created_at: ts(ri(0, 20)) }); }
  const views = ['dashboard', 'requests', 'roster', 'tasks', 'circulars', 'tools', 'expiry', 'fieldvisits', 'reports'];
  for (let n = 0; n < 14; n++) views.forEach((v, i) => add('usage_daily', { id: T.usage_daily ? T.usage_daily.length + 1 : 1, day: day(n), view: v, hits: ri(5, 120) - i * 4 }));
  T.profiles.forEach((p) => { if (p.status === 'active') add('user_activity', { user_id: p.id, last_active_at: ts(ri(0, 6)), last_source: chance(0.7) ? 'app' : 'web', web_last_at: ts(ri(0, 9)), app_last_at: ts(ri(0, 3)) }); });

  // clean helper fields
  T.profiles.forEach((p) => { delete p._region; delete p._sub; });
  regions.forEach((r) => delete r._subs);
  return T;
};

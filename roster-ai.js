/* Roster tools (v86): (1) Roster AI plan page, region by region, with saved rules and an Excel comparison,
   (2) Resigned staff and the tools to recover from them, (3) Roster change log (who, what, when).
   The "AI" is a rule-based balancing method that runs in the browser: no outside AI service, no data leaves the portal. */
(function () {
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const esc = (s) => escapeHtml(s == null ? '' : String(s));
  const main = () => document.getElementById('main-content');
  const canApply = () => isSuperAdmin() || (typeof hasPermission === 'function' && hasPermission('roster_ai_apply'));
  const live = (e) => e.status !== 'removed';
  const shiftOf = (e) => (e.shift_types && e.shift_types.name) || 'No shift';
  const gKey = (e) => [e.region_id || '', e.sub_region_id || '', shiftOf(e)].join('|');
  const gName = (e) => [e.regions && e.regions.name, e.sub_regions && e.sub_regions.name, shiftOf(e)].filter(Boolean).join(' · ');
  const today = () => new Date().toISOString().slice(0, 10);
  const css = 'button.fa-chip{border-radius:999px;padding:3px 11px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;border:1px solid rgba(150,160,210,.5);background:transparent;color:inherit}button.fa-chip.on{background:var(--accent,#5b6ef5);border-color:transparent;color:#fff}button.fa-chip:disabled{opacity:.55;cursor:default}.fa-kpi{flex:1;min-width:130px;padding:10px}.fa-kpi b{font-size:24px;display:block}';
  function addCss() { if (!document.getElementById('fa-css')) { const st = document.createElement('style'); st.id = 'fa-css'; st.textContent = css; document.head.appendChild(st); } }
  const xl = async () => { await ensureXLSX(); };

  // ======================================================================= 1. ROSTER AI PAGE
  const R = { entries: [], rules: new Map(), region: '', tab: 'plan', onlyChanges: true, draft: null };
  const DEFAULT = () => ({ busy_days: [], busy_hours: '', max_off_per_day: null, min_working_pct: null, keep_current: true, protected_ids: [], skip_shifts: [], notes: '' });
  const rulesFor = (rid) => R.rules.get(rid || '') || R.rules.get('') || DEFAULT();

  async function loadEntries() {
    R.entries = await fvFetchAll(() => sb.from('roster_entries').select('*, profiles!rider_id(full_name, employee_id), regions(name), sub_regions(name), shift_types(name)').neq('status', 'removed').order('id'));
    R.entries = R.entries.filter((e) => e.profiles);
    const r = await sb.from('roster_ai_rules').select('*');
    R.rules = new Map(); if (!r.error) (r.data || []).forEach((x) => R.rules.set(x.region_id || '', x));
    R.rulesMissing = !!(r.error && /relation|schema cache/i.test(r.error.message || ''));
  }

  // ---- the plan: per team (region, sub-region, shift), spread day-offs, fewer on busy days, honour the rules
  function plan(list, rl) {
    const act = list.filter(live), groups = new Map(), out = new Map(), why = new Map();
    const busy = rl.busy_days || [], prot = new Set((rl.protected_ids || []).map((x) => String(x).trim().toLowerCase()));
    const skip = new Set(rl.skip_shifts || []);
    act.forEach((e) => { const k = gKey(e); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); });
    groups.forEach((riders) => {
      const n = riders.length; if (skip.has(shiftOf(riders[0]))) { riders.forEach((e) => { out.set(e.id, e.day_off || ''); why.set(e.id, 'Shift left out of the plan'); }); return; }
      let cap = (() => {
        const w = DAYS.map((d) => (busy.includes(d) ? 0.4 : 1)), sw = w.reduce((a, b) => a + b, 0), raw = w.map((x) => (n * x) / sw), t = raw.map(Math.floor); let left = n - t.reduce((a, b) => a + b, 0);
        raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, i]) => { if (left > 0 && !busy.includes(DAYS[i])) { t[i]++; left--; } });
        for (let i = 0; left > 0; i = (i + 1) % 7) { t[i]++; left--; }
        return t;
      })();
      let limit = Infinity;
      if (rl.max_off_per_day) limit = Math.min(limit, rl.max_off_per_day);
      if (rl.min_working_pct) limit = Math.min(limit, Math.max(1, Math.floor((n * (100 - rl.min_working_pct)) / 100)));
      if (limit !== Infinity) { cap = cap.map((c) => Math.min(c, limit)); let total = cap.reduce((a, b) => a + b, 0); for (let i = 0; total < n; i = (i + 1) % 7) { if (!busy.includes(DAYS[i]) || i === 6) { cap[i]++; total++; } } }
      const todo = [];
      riders.forEach((e) => {
        const di = DAYS.indexOf(e.day_off), isP = prot.has(String(e.profiles.employee_id || '').toLowerCase());
        if (isP && di >= 0) { cap[di]--; out.set(e.id, e.day_off); why.set(e.id, 'Protected (day off fixed)'); } else todo.push(e);
      });
      const rest = [];
      todo.forEach((e) => { const di = DAYS.indexOf(e.day_off); if (rl.keep_current !== false && di >= 0 && cap[di] > 0) { cap[di]--; out.set(e.id, e.day_off); why.set(e.id, 'Kept'); } else rest.push(e); });
      rest.forEach((e) => { let b = 0; cap.forEach((c, i) => { if (c > cap[b]) b = i; }); cap[b]--; out.set(e.id, DAYS[b]); why.set(e.id, e.day_off ? (DAYS.indexOf(e.day_off) >= 0 && busy.includes(e.day_off) ? 'Moved off a busy day' : 'Moved to balance the team') : 'No day off was set'); });
    });
    return { act, out, why };
  }
  function stats(list, dayOf, busy) {
    const g = new Map(); list.filter(live).forEach((e) => { const k = gKey(e); if (!g.has(k)) g.set(k, []); g.get(k).push(e); });
    let maxOff = 0, minBusy = Infinity, same = 0, none = 0; const byDay = Object.fromEntries(DAYS.map((d) => [d, 0]));
    list.filter(live).forEach((e) => { const d = dayOf(e); if (d && byDay[d] != null) byDay[d]++; else none++; });
    g.forEach((r) => { const c = Object.fromEntries(DAYS.map((d) => [d, 0])); r.forEach((e) => { const d = dayOf(e); if (d && c[d] != null) c[d]++; });
      DAYS.forEach((d) => { maxOff = Math.max(maxOff, c[d]); if (busy.includes(d)) minBusy = Math.min(minBusy, r.length - c[d]); if (c[d] > 1) same += c[d]; }); });
    return { maxOff, minBusy: minBusy === Infinity ? 0 : minBusy, same, none, byDay, total: list.filter(live).length };
  }

  window.renderRosterAI = async function () {
    addCss(); const m = main(); m.innerHTML = '<div class="mono">Loading roster…</div>';
    try { await loadEntries(); } catch (e) { m.innerHTML = '<div class="empty-state">Could not load the roster: ' + esc(e.message || e) + '</div>'; return; }
    R.draft = null; R.region = R.region || ''; draw();
  };

  function regionsInRoster() { const s = new Map(); R.entries.forEach((e) => { if (e.region_id) s.set(e.region_id, (e.regions && e.regions.name) || e.region_id); }); return [...s.entries()].sort((a, b) => a[1].localeCompare(b[1])); }
  const scopeEntries = () => (R.region ? R.entries.filter((e) => e.region_id === R.region) : R.entries);
  const effRules = () => R.draft || rulesFor(R.region);

  function draw() {
    const m = main(), regs = regionsInRoster(), rl = effRules(), busy = rl.busy_days || [], list = scopeEntries(), isSA = isSuperAdmin();
    const P = plan(list, rl), before = stats(list, (e) => e.day_off, busy), after = stats(list, (e) => P.out.get(e.id), busy);
    const changed = P.act.filter((e) => P.out.get(e.id) && P.out.get(e.id) !== (e.day_off || ''));
    const maxDay = Math.max(1, ...Object.values(before.byDay), ...Object.values(after.byDay));
    const shifts = [...new Set(list.map(shiftOf))].sort();
    const bar = (v, c) => `<div style="display:flex;align-items:center;gap:6px"><div style="flex:1;background:rgba(150,160,210,.2);border-radius:6px;height:12px"><div style="width:${Math.round((v / maxDay) * 100)}%;background:${c};height:12px;border-radius:6px"></div></div><b style="min-width:24px;text-align:right">${v}</b></div>`;
    // region table
    const regRows = (R.region ? [[R.region, (regs.find((r) => r[0] === R.region) || [0, ''])[1]]] : regs).map(([id, name]) => {
      const l = R.entries.filter((e) => e.region_id === id), r = id ? rulesFor(id) : rulesFor(''), b = stats(l, (e) => e.day_off, r.busy_days || []), p = plan(l, r), a = stats(l, (e) => p.out.get(e.id), r.busy_days || []);
      return `<tr data-rg="${id}" style="cursor:pointer"><td><b>${esc(name)}</b></td><td>${b.total}</td><td>${b.none}</td><td>${b.maxOff} → ${a.maxOff}</td><td>${b.minBusy} → ${a.minBusy}</td><td>${l.filter((e) => live(e) && p.out.get(e.id) && p.out.get(e.id) !== (e.day_off || '')).length}</td></tr>`;
    }).join('');
    const clusters = []; { const g = new Map(); list.forEach((e) => { if (!e.day_off) return; const k = gKey(e) + '|' + e.day_off; if (!g.has(k)) g.set(k, { name: gName(e), day: e.day_off, n: 0, tot: 0, key: gKey(e) }); g.get(k).n++; }); const tot = new Map(); list.forEach((e) => tot.set(gKey(e), (tot.get(gKey(e)) || 0) + 1)); g.forEach((v) => { v.tot = tot.get(v.key); if (v.n >= 2) clusters.push(v); }); clusters.sort((a, b) => b.n - a.n); }
    const show = (R.onlyChanges ? changed : P.act).slice(0, 400);
    const ro = isSA ? '' : 'disabled';
    m.innerHTML = `<div class="card" style="padding:14px"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
        <h2 style="margin:0;flex:1;min-width:200px">🧠 Roster AI plan</h2>
        <select id="fa-region" class="input" style="max-width:220px"><option value="">All regions (summary)</option>${regs.map(([id, n]) => `<option value="${id}" ${R.region === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <button class="btn small outline" id="fa-dl" type="button">⬇ Download comparison (Excel)</button>
        ${canApply() ? `<button class="btn small" id="fa-apply" type="button" ${changed.length ? '' : 'disabled'}>Apply plan (${changed.length})</button>` : ''}</div>
      <p class="hint" style="margin:0 0 10px">Counts only active riders. ${R.region ? 'Showing one region.' : 'Pick a region to see its detail and rules. Click a row below to open a region.'}</p>

      <h3 style="margin:8px 0 4px">Region-wise summary</h3>
      <div style="overflow-x:auto"><table><thead><tr><th>Region</th><th>Active</th><th>No day off</th><th>Most off in a team on one day (now → plan)</th><th>Fewest working on a busy day (now → plan)</th><th>Riders to change</th></tr></thead><tbody>${regRows || '<tr><td colspan=6>No roster data</td></tr>'}</tbody></table></div>

      <h3 style="margin:16px 0 4px">Rules for the plan <span class="hint" style="font-weight:400">${R.region ? '(this region)' : '(all regions, used when a region has no rules of its own)'}</span></h3>
      ${R.rulesMissing ? '<p class="hint">Saved rules need <b>migration_65.sql</b>. You can still try rules below; they just cannot be saved yet.</p>' : ''}
      <p class="hint" style="margin:0 0 6px">${isSA ? 'Only the Super Admin can change and save rules. Everyone else sees them.' : 'Rules are set by the Super Admin. You can see how they shape the plan.'}</p>
      <div style="display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">
        <div><label><b>Busy days</b></label><div id="fa-busy" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${DAYS.map((d) => `<button type="button" class="fa-chip ${busy.includes(d) ? 'on' : ''}" data-day="${d}" ${ro}>${d.slice(0, 3)}</button>`).join('')}</div><div class="hint">Fewer day-offs are given on busy days. Tap again to remove.</div></div>
        <div><label><b>Busy hours</b></label><input id="fa-hours" class="input" ${ro} placeholder="e.g. 07:00-11:00 and 16:00-19:00" value="${esc(rl.busy_hours || '')}"><div class="hint">Noted in the plan and Excel. The balancing itself works by day (see Method).</div></div>
        <div><label><b>Most riders of one team off on one day</b></label><input id="fa-max" class="input" type="number" min="1" ${ro} placeholder="automatic" value="${rl.max_off_per_day || ''}"></div>
        <div><label><b>Keep at least this % working every day</b></label><input id="fa-minp" class="input" type="number" min="1" max="100" ${ro} placeholder="automatic" value="${rl.min_working_pct || ''}"></div>
        <div><label><b>Fixed day-off (Employee IDs, one per line)</b></label><textarea id="fa-prot" class="input" rows="3" ${ro} placeholder="Riders whose day off must not change">${esc((rl.protected_ids || []).join('\n'))}</textarea></div>
        <div><label><b>Shifts left out of the plan</b></label><div id="fa-skip" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${shifts.map((s) => `<button type="button" class="fa-chip ${(rl.skip_shifts || []).includes(s) ? 'on' : ''}" data-shift="${esc(s)}" ${ro}>${esc(s)}</button>`).join('') || '<span class="hint">No shifts</span>'}</div></div>
      </div>
      <div style="margin-top:8px"><label><input type="checkbox" id="fa-keep" ${rl.keep_current !== false ? 'checked' : ''} ${ro}> Move as few riders as possible (keep current day-offs where possible)</label></div>
      <div style="margin-top:6px"><label><b>Instructions / notes for the plan</b></label><textarea id="fa-notes" class="input" rows="2" ${ro} placeholder="Anything the planner should remember (kept in the Excel)">${esc(rl.notes || '')}</textarea></div>
      ${isSA ? `<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" id="fa-save" type="button">💾 Save rules for ${R.region ? 'this region' : 'all regions'}</button>${R.draft ? '<span class="hint" style="align-self:center">Not saved yet</span>' : ''}</div>` : ''}

      <h3 style="margin:16px 0 4px">${R.region ? esc((regs.find((r) => r[0] === R.region) || [0, ''])[1]) : 'All regions'}: now and after the plan</h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin:6px 0"><div class="card fa-kpi"><span class="hint">Active riders</span><b>${before.total}</b></div><div class="card fa-kpi"><span class="hint">No day off set</span><b>${before.none}</b></div><div class="card fa-kpi"><span class="hint">Most off in a team on one day</span><b>${before.maxOff} → ${after.maxOff}</b></div><div class="card fa-kpi"><span class="hint">Fewest working on a busy day</span><b>${before.minBusy} → ${after.minBusy}</b></div><div class="card fa-kpi"><span class="hint">Riders to change</span><b>${changed.length}</b></div></div>
      ${DAYS.map((d) => `<div style="display:flex;gap:8px;align-items:center;margin-bottom:3px"><span style="width:84px">${d}${busy.includes(d) ? ' 🔥' : ''}</span><div style="flex:1">${bar(before.byDay[d], '#2f6a95')}${bar(after.byDay[d], '#1d9d6b')}</div></div>`).join('')}
      <div class="hint">Blue = riders off now. Green = riders off after the plan.</div>

      <h3 style="margin:16px 0 4px">Same team, same shift, same day off</h3>
      ${clusters.length ? `<div style="overflow-x:auto;max-height:220px"><table><thead><tr><th>Team · shift</th><th>Day off</th><th>Riders</th><th>Left working</th></tr></thead><tbody>${clusters.slice(0, 80).map((c) => `<tr><td>${esc(c.name)}</td><td>${c.day}</td><td><b>${c.n}</b></td><td>${c.tot - c.n} of ${c.tot}</td></tr>`).join('')}</tbody></table></div>` : '<p class="hint">No two riders in the same team and shift share a day off.</p>'}

      <h3 style="margin:16px 0 4px">Plan: current and proposed <label style="font-weight:400;font-size:13px;margin-left:8px"><input type="checkbox" id="fa-only" ${R.onlyChanges ? 'checked' : ''}> changes only</label></h3>
      <div style="overflow-x:auto;max-height:420px"><table><thead><tr><th>Employee ID</th><th>Rider</th><th>Region</th><th>Sub-region</th><th>Shift</th><th>Current</th><th>Proposed</th><th>Why</th></tr></thead><tbody>${show.map((e) => { const p = P.out.get(e.id) || '', ch = p !== (e.day_off || ''); return `<tr><td class="mono">${esc(e.profiles.employee_id)}</td><td>${esc(e.profiles.full_name)}</td><td>${esc(e.regions && e.regions.name)}</td><td>${esc(e.sub_regions && e.sub_regions.name)}</td><td>${esc(shiftOf(e))}</td><td>${esc(e.day_off || '—')}</td><td><b style="${ch ? 'color:#1d9d6b' : ''}">${esc(p || '—')}</b></td><td class="hint">${esc(P.why.get(e.id) || '')}</td></tr>`; }).join('') || '<tr><td colspan=8>Nothing to change.</td></tr>'}</tbody></table></div>
      ${(R.onlyChanges ? changed : P.act).length > 400 ? '<p class="hint">Showing 400 rows. The Excel has all of them.</p>' : ''}

      <div class="card" style="margin-top:16px;padding:10px;background:rgba(150,160,210,.12)"><b>Method used</b><br><span class="hint">This is a <b>rule-based balancing method</b> built into the portal. It is <b>not</b> an external AI service (no ChatGPT, no Claude, no cloud AI): it runs in your browser and no roster data leaves the portal. For each team (region · sub-region · shift) it spreads day-offs evenly across the week, gives fewer day-offs on busy days, keeps your rules (limits, fixed riders, skipped shifts) and, by default, moves the fewest riders. Busy hours are recorded but the balancing works by day.</span></div>
    </div>`;
    wire(list, P, changed, before, after, rl);
  }

  function readDraft() {
    const g = (id) => document.getElementById(id), cur = effRules();
    return { ...cur, busy_hours: g('fa-hours').value.trim(), max_off_per_day: +g('fa-max').value || null, min_working_pct: +g('fa-minp').value || null, keep_current: g('fa-keep').checked,
      protected_ids: g('fa-prot').value.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean), notes: g('fa-notes').value.trim() };
  }
  function wire(list, P, changed, before, after, rl) {
    const g = (id) => document.getElementById(id);
    g('fa-region').onchange = (e) => { R.region = e.target.value; R.draft = null; draw(); };
    document.querySelectorAll('tr[data-rg]').forEach((tr) => { tr.onclick = () => { R.region = tr.dataset.rg; R.draft = null; draw(); window.scrollTo(0, 0); }; });
    g('fa-only').onchange = (e) => { R.onlyChanges = e.target.checked; draw(); };
    if (isSuperAdmin()) {
      const upd = (patch) => { R.draft = { ...readDraft(), ...patch }; draw(); };
      g('fa-busy').onclick = (e) => { const b = e.target.closest('[data-day]'); if (!b) return; const s = new Set(effRules().busy_days || []); s.has(b.dataset.day) ? s.delete(b.dataset.day) : s.add(b.dataset.day); upd({ busy_days: DAYS.filter((d) => s.has(d)) }); };
      g('fa-skip').onclick = (e) => { const b = e.target.closest('[data-shift]'); if (!b) return; const s = new Set(effRules().skip_shifts || []); s.has(b.dataset.shift) ? s.delete(b.dataset.shift) : s.add(b.dataset.shift); upd({ skip_shifts: [...s] }); };
      ['fa-max', 'fa-minp', 'fa-keep'].forEach((id) => { g(id).onchange = () => upd({}); });
      ['fa-hours', 'fa-prot', 'fa-notes'].forEach((id) => { g(id).oninput = () => { R.draft = { ...readDraft() }; }; });
      g('fa-save').onclick = async () => {
        const d = readDraft(), row = { region_id: R.region || null, busy_days: d.busy_days || [], busy_hours: d.busy_hours || null, max_off_per_day: d.max_off_per_day, min_working_pct: d.min_working_pct, keep_current: d.keep_current !== false, protected_ids: d.protected_ids || [], skip_shifts: d.skip_shifts || [], notes: d.notes || null, updated_by: state.user.id, updated_at: new Date().toISOString() };
        const ex = R.rules.get(R.region || ''), r = ex ? await sb.from('roster_ai_rules').update(row).eq('id', ex.id) : await sb.from('roster_ai_rules').insert(row);
        if (r.error) { toast(/relation|schema cache/i.test(r.error.message) ? 'Please run migration_65.sql first' : 'Could not save: ' + r.error.message); return; }
        toast('Rules saved'); R.draft = null; await loadEntries(); draw();
      };
    }
    g('fa-dl').onclick = () => download(list, P, rl, before, after);
    const ap = g('fa-apply'); if (ap) ap.onclick = async () => {
      if (!canApply() || !changed.length) return;
      if (!confirm('Change the day off of ' + changed.length + ' rider(s) as in the plan?\n\nTip: download the comparison first. Every change is also written to the Roster change log.')) return;
      ap.disabled = true; let ok = 0, bad = 0, err = '';
      for (let i = 0; i < changed.length; i++) { const e = changed[i], r = await sb.from('roster_entries').update({ day_off: P.out.get(e.id) }).eq('id', e.id); if (r.error) { bad++; err = err || r.error.message; } else ok++; if (i % 10 === 0) ap.textContent = 'Applying… ' + (i + 1) + '/' + changed.length; }
      toast(ok + ' day-off(s) updated' + (bad ? ', ' + bad + ' failed (' + err + ')' : '')); await loadEntries(); draw();
    };
  }

  async function download(list, P, rl, before, after) {
    await xl();
    const row = (e) => { const p = P.out.get(e.id) || ''; return { Region: (e.regions && e.regions.name) || '', 'Sub-region': (e.sub_regions && e.sub_regions.name) || '', Shift: shiftOf(e), 'Employee ID': e.profiles.employee_id || '', 'Rider name': e.profiles.full_name || '', 'Current day off': e.day_off || '', 'Proposed day off': p, Changed: p !== (e.day_off || '') ? 'YES' : 'no', Why: P.why.get(e.id) || '' }; };
    const all = P.act.map(row), chg = all.filter((r) => r.Changed === 'YES');
    const dayRows = DAYS.map((d) => ({ Day: d, Busy: (rl.busy_days || []).includes(d) ? 'Yes' : '', 'Off now': before.byDay[d], 'Off after plan': after.byDay[d], Difference: after.byDay[d] - before.byDay[d] }));
    const regs = new Map(); P.act.forEach((e) => { const n = (e.regions && e.regions.name) || 'No region'; if (!regs.has(n)) regs.set(n, { Region: n, Active: 0, 'No day off now': 0, 'Riders to change': 0 }); const r = regs.get(n); r.Active++; if (!e.day_off) r['No day off now']++; if ((P.out.get(e.id) || '') !== (e.day_off || '')) r['Riders to change']++; });
    const ruleRows = [['Scope', R.region ? ((R.entries.find((e) => e.region_id === R.region) || {}).regions || {}).name : 'All regions'], ['Busy days', (rl.busy_days || []).join(', ')], ['Busy hours', rl.busy_hours || ''], ['Most off per team per day', rl.max_off_per_day || 'automatic'], ['Keep at least % working', rl.min_working_pct || 'automatic'], ['Move fewest riders', rl.keep_current !== false ? 'Yes' : 'No'], ['Fixed Employee IDs', (rl.protected_ids || []).join(', ')], ['Shifts left out', (rl.skip_shifts || []).join(', ')], ['Notes', rl.notes || ''], ['Made on', new Date().toLocaleString('en-GB')], ['Method', 'Rule-based balancing method inside the portal. No external AI service; no data left the portal.']].map(([k, v]) => ({ Rule: k, Value: v }));
    const wb = XLSX.utils.book_new(), add = (n, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'Nothing' }]), n);
    add('Comparison (all)', all); add('Changes only', chg); add('Day-wise before-after', dayRows); add('Region summary', [...regs.values()]); add('Rules and method', ruleRows);
    await fhSaveXlsx(wb, 'roster-dayoff-comparison-' + today() + '.xlsx');
  }

  // ======================================================================= 2. RESIGNED STAFF + TOOLS TO RECOVER
  const Z = { rows: [], q: '', region: '', state: 'pending', reasons: [] };
  window.renderResignedStaff = async function () {
    addCss(); const m = main(); m.innerHTML = '<div class="mono">Loading resigned staff…</div>';
    try {
      const ent = await fvFetchAll(() => sb.from('roster_entries').select('*, profiles!rider_id(full_name, employee_id), regions(name)').eq('status', 'removed').order('id'));
      const latest = new Map(); ent.filter((e) => e.profiles).forEach((e) => { const o = latest.get(e.rider_id); if (!o || String(e.created_at) > String(o.created_at)) latest.set(e.rider_id, e); });
      // someone who is active on the roster again is not resigned
      const act = await fvFetchAll(() => sb.from('roster_entries').select('rider_id').neq('status', 'removed').order('id')); const actSet = new Set(act.map((x) => x.rider_id));
      const people = [...latest.values()].filter((e) => !actSet.has(e.rider_id)), ids = people.map((e) => e.rider_id), tools = [];
      for (let i = 0; i < ids.length; i += 80) { const r = await sb.from('tool_issuances').select('id, rider_id, issued_date, serial_number, recovered_on, recovered_note, tool_types(name)').in('rider_id', ids.slice(i, i + 80)).order('issued_date', { ascending: false }); if (r.error) throw r.error; tools.push(...(r.data || [])); }
      const by = new Map(); tools.forEach((t) => { if (!by.has(t.rider_id)) by.set(t.rider_id, []); by.get(t.rider_id).push(t); });
      Z.rows = people.map((e) => ({ e, tools: by.get(e.rider_id) || [] })).sort((a, b) => String(b.e.created_at).localeCompare(String(a.e.created_at)));
      Z.reasons = [...new Set(people.map((e) => e.removal_reason).filter(Boolean))].sort();
    } catch (err) { m.innerHTML = '<div class="empty-state">Could not load: ' + esc(err.message || err) + (/recovered_on/.test(err.message || '') ? '<br>Please run migration_65.sql first.' : '') + '</div>'; return; }
    drawZ();
  };
  function drawZ() {
    const m = main(), can = isSuperAdmin() || (state.profile && ['admin', 'inventory_coordinator'].includes(state.profile.role));
    const regs = [...new Map(Z.rows.map((r) => [r.e.region_id, (r.e.regions && r.e.regions.name) || '']).filter((x) => x[0])).entries()];
    const q = Z.q.toLowerCase();
    const rows = Z.rows.filter((r) => (!Z.region || r.e.region_id === Z.region) && (!Z.reason || r.e.removal_reason === Z.reason) && (!q || (r.e.profiles.full_name + ' ' + r.e.profiles.employee_id).toLowerCase().includes(q)) &&
      (Z.state === 'all' || (Z.state === 'pending' ? r.tools.some((t) => !t.recovered_on) : r.tools.length && r.tools.every((t) => t.recovered_on))));
    const pendingTotal = rows.reduce((a, r) => a + r.tools.filter((t) => !t.recovered_on).length, 0);
    m.innerHTML = `<div class="card" style="padding:14px"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px"><h2 style="margin:0;flex:1;min-width:200px">🧳 Resigned staff and tools to recover</h2><button class="btn small outline" id="z-dl" type="button">⬇ Download (Excel)</button></div>
      <p class="hint">Everyone marked Resign, Termination etc. on the roster, with every tool issued to them. <b>${pendingTotal}</b> tool${pendingTotal === 1 ? '' : 's'} still to recover in this list.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"><input id="z-q" class="input" placeholder="Search name or Employee ID" value="${esc(Z.q)}" style="max-width:230px">
        <select id="z-rg" class="input" style="max-width:170px"><option value="">All regions</option>${regs.map(([id, n]) => `<option value="${id}" ${Z.region === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <select id="z-rs" class="input" style="max-width:170px"><option value="">All reasons</option>${Z.reasons.map((r) => `<option ${Z.reason === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
        ${[['pending', 'To recover'], ['done', 'All recovered'], ['all', 'All']].map(([k, l]) => `<button type="button" class="fa-chip ${Z.state === k ? 'on' : ''}" data-st="${k}">${l}</button>`).join('')}</div>
      ${rows.length ? rows.slice(0, 200).map((r) => `<div style="border-top:1px solid rgba(150,160,210,.3);padding:8px 0"><div><b>${esc(r.e.profiles.full_name)}</b> <span class="mono">${esc(r.e.profiles.employee_id)}</span> · ${esc((r.e.regions && r.e.regions.name) || '')} · <span class="badge open">${esc(r.e.removal_reason || 'Removed')}</span> <span class="hint">${r.e.removed_at ? formatDate(r.e.removed_at) : ''}</span></div>
        ${r.tools.length ? `<div style="overflow-x:auto"><table style="margin-top:4px"><thead><tr><th>Tool</th><th>Issued</th><th>Serial</th><th>Status</th><th></th></tr></thead><tbody>${r.tools.map((t) => `<tr><td>${esc(t.tool_types && t.tool_types.name)}</td><td>${formatDate(t.issued_date)}</td><td class="mono">${esc(t.serial_number || '')}</td><td>${t.recovered_on ? '<span class="badge active">Recovered ' + formatDate(t.recovered_on) + '</span>' + (t.recovered_note ? '<div class="hint">' + esc(t.recovered_note) + '</div>' : '') : '<span class="badge open">To recover</span>'}</td><td>${can ? (t.recovered_on ? `<button class="btn small outline" data-undo="${t.id}">Undo</button>` : `<button class="btn small" data-rec="${t.id}">Mark recovered</button>`) : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="hint">No tools were issued to this person.</div>'}</div>`).join('') + (rows.length > 200 ? '<p class="hint">Showing 200. Use the search or Excel.</p>' : '') : '<p class="hint">Nobody matches.</p>'}</div>`;
    const g = (id) => document.getElementById(id);
    g('z-q').oninput = (e) => { Z.q = e.target.value; clearTimeout(Z.t); Z.t = setTimeout(() => { drawZ(); const i = g('z-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
    g('z-rg').onchange = (e) => { Z.region = e.target.value; drawZ(); }; g('z-rs').onchange = (e) => { Z.reason = e.target.value; drawZ(); };
    m.querySelectorAll('[data-st]').forEach((b) => { b.onclick = () => { Z.state = b.dataset.st; drawZ(); }; });
    m.querySelectorAll('[data-rec]').forEach((b) => { b.onclick = () => recModal(b.dataset.rec); });
    m.querySelectorAll('[data-undo]').forEach((b) => { b.onclick = async () => { if (!confirm('Mark this tool as NOT recovered again?')) return; const r = await sb.rpc('fh_tool_mark_recovered', { p_ids: [b.dataset.undo], p_date: null, p_note: null, p_undo: true }); toast(r.error ? 'Could not save: ' + r.error.message : 'Updated'); if (!r.error) renderResignedStaff(); }; });
    g('z-dl').onclick = async () => {
      await xl(); const out = []; rows.forEach((r) => { const base = { 'Employee ID': r.e.profiles.employee_id, Name: r.e.profiles.full_name, Region: (r.e.regions && r.e.regions.name) || '', Reason: r.e.removal_reason || '' }; if (!r.tools.length) out.push({ ...base, Tool: '(none issued)' }); r.tools.forEach((t) => out.push({ ...base, Tool: (t.tool_types && t.tool_types.name) || '', 'Issued on': t.issued_date, Serial: t.serial_number || '', Status: t.recovered_on ? 'Recovered' : 'To recover', 'Recovered on': t.recovered_on || '', Note: t.recovered_note || '' })); });
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(out.length ? out : [{ Note: 'Nothing' }]), 'Tools to recover'); await fhSaveXlsx(wb, 'resigned-staff-tools-' + today() + '.xlsx');
    };
  }
  function recModal(id) {
    openModal(`<div style="max-width:380px"><h2>Tool recovered</h2><form id="rc-f"><div class="form-row"><label>Date recovered *</label><input type="date" id="rc-d" value="${today()}" max="${today()}" required></div><div class="form-row"><label>Note (optional)</label><input id="rc-n" class="input" placeholder="e.g. returned damaged"></div><button class="btn" type="submit">Save</button></form></div>`);
    document.getElementById('rc-f').onsubmit = async (e) => { e.preventDefault(); const r = await sb.rpc('fh_tool_mark_recovered', { p_ids: [id], p_date: document.getElementById('rc-d').value, p_note: document.getElementById('rc-n').value.trim() || null, p_undo: false }); if (r.error) { toast('Could not save: ' + r.error.message); return; } toast('Marked as recovered'); closeModal(); renderResignedStaff(); };
  }

  // ======================================================================= 3. ROSTER CHANGE LOG
  const L = { q: '', action: '', from: '', to: '', rows: [] };
  const FIELD = { day_off: 'Day off', hotspot: 'Hotspot', status: 'Status', removal_reason: 'Removal reason', region_id: 'Region', sub_region_id: 'Sub-region', shift_id: 'Shift', shift_type_id: 'Shift', official_mobile: 'Official mobile', personal_mobile: 'Personal mobile', rider_id: 'Rider', designation: 'Designation' };
  const fieldName = (k) => FIELD[k] || k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const what = (r) => { const ch = r.changes || {}, ks = Object.keys(ch); if (r.action === 'added') return 'Added to roster'; if (r.action === 'deleted') return 'Deleted permanently'; return ks.map((k) => fieldName(k) + ': ' + (ch[k].old || '—') + ' → ' + (ch[k].new || '—')).join('; ') || 'Changed'; };
  window.renderRosterLog = async function () {
    addCss(); const m = main(); m.innerHTML = '<div class="mono">Loading change log…</div>';
    await loadLog();
  };
  async function loadLog() {
    const m = main(); let q = sb.from('roster_change_log').select('*').order('changed_at', { ascending: false }).limit(1000);
    if (L.action) q = q.eq('action', L.action); if (L.from) q = q.gte('changed_at', L.from + 'T00:00:00'); if (L.to) q = q.lte('changed_at', L.to + 'T23:59:59');
    const r = await q;
    if (r.error) { m.innerHTML = '<div class="empty-state">' + (/relation|schema cache/i.test(r.error.message) ? 'The change log is not set up yet. Please run <b>migration_65.sql</b> in Supabase.' : 'Could not load: ' + esc(r.error.message)) + '</div>'; return; }
    L.rows = r.data || []; drawLog();
  }
  function drawLog() {
    const m = main(), q = L.q.toLowerCase(), rows = L.rows.filter((r) => !q || [r.rider_name, r.employee_id, r.changed_by_name, what(r)].join(' ').toLowerCase().includes(q));
    m.innerHTML = `<div class="card" style="padding:14px"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px"><h2 style="margin:0;flex:1;min-width:200px">📜 Roster change log</h2><button class="btn small outline" id="l-dl" type="button">⬇ Download (Excel)</button></div>
      <p class="hint">Who changed what and when. Shows the latest 1000 changes that match.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"><input id="l-q" class="input" placeholder="Search rider, ID, who or what" value="${esc(L.q)}" style="max-width:240px">
        <select id="l-a" class="input" style="max-width:150px"><option value="">All actions</option>${[['added', 'Added'], ['changed', 'Changed'], ['removed', 'Removed (resign etc.)'], ['deleted', 'Deleted']].map(([k, l]) => `<option value="${k}" ${L.action === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label class="hint">From <input type="date" id="l-f" value="${L.from}"></label><label class="hint">To <input type="date" id="l-t" value="${L.to}"></label></div>
      <div style="overflow-x:auto;max-height:620px"><table><thead><tr><th>When</th><th>Who changed</th><th>Rider</th><th>Action</th><th>What changed</th></tr></thead><tbody>${rows.slice(0, 500).map((r) => `<tr><td class="mono" style="white-space:nowrap">${formatDateTime(r.changed_at)}</td><td>${esc(r.changed_by_name || '')}</td><td>${esc(r.rider_name || '')} <span class="mono">${esc(r.employee_id || '')}</span></td><td><span class="badge ${r.action === 'deleted' || r.action === 'removed' ? 'open' : 'active'}">${esc(r.action)}</span></td><td>${esc(what(r))}</td></tr>`).join('') || '<tr><td colspan=5>No changes found.</td></tr>'}</tbody></table></div></div>`;
    const g = (id) => document.getElementById(id);
    g('l-q').oninput = (e) => { L.q = e.target.value; clearTimeout(L.t); L.t = setTimeout(() => { drawLog(); const i = g('l-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
    g('l-a').onchange = (e) => { L.action = e.target.value; loadLog(); }; g('l-f').onchange = (e) => { L.from = e.target.value; loadLog(); }; g('l-t').onchange = (e) => { L.to = e.target.value; loadLog(); };
    g('l-dl').onclick = async () => { await xl(); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows.map((r) => ({ When: new Date(r.changed_at).toLocaleString('en-GB'), 'Changed by': r.changed_by_name || '', 'Employee ID': r.employee_id || '', Rider: r.rider_name || '', Action: r.action, 'What changed': what(r) })) : [{ Note: 'Nothing' }]), 'Roster changes'); await fhSaveXlsx(wb, 'roster-change-log-' + today() + '.xlsx'); };
  }
})();

/* Roster AI (v82): who is working, who shares a shift + day off, and an optimised days-off plan.
   Analysis is open to everyone who can see the roster (Area Incharge etc.). Applying the plan is for the Super Admin,
   or anyone the Super Admin grants the permission "roster_ai_apply" (Settings > Permissions). */
(function () {
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const esc = (s) => escapeHtml(s == null ? '' : String(s));
  const LS = 'fh_roster_busy_days';
  const getBusy = () => { try { const v = JSON.parse(localStorage.getItem(LS) || 'null'); if (Array.isArray(v)) return v.filter((d) => DAYS.includes(d)); } catch (_e) {} return ['Saturday', 'Sunday']; };
  const setBusy = (v) => { try { localStorage.setItem(LS, JSON.stringify(v)); } catch (_e) {} };
  const canApply = () => isSuperAdmin() || (typeof hasPermission === 'function' && hasPermission('roster_ai_apply'));
  const live = (e) => e.status !== 'removed';
  const shiftOf = (e) => e.shift_types?.name || 'No shift';
  const groupKey = (e) => [e.region_id || '', e.sub_region_id || '', shiftOf(e)].join('|');
  const groupName = (e) => [e.regions?.name || 'No region', e.sub_regions?.name || '', shiftOf(e)].filter(Boolean).join(' · ');

  // ---- analysis -------------------------------------------------------
  function analyse(list) {
    const act = list.filter(live);
    const byDay = Object.fromEntries(DAYS.map((d) => [d, 0])); let noOff = 0;
    const cluster = new Map();   // same group + same day off
    const grp = new Map();
    act.forEach((e) => {
      if (e.day_off && byDay[e.day_off] != null) byDay[e.day_off]++; else noOff++;
      const k = groupKey(e);
      if (!grp.has(k)) grp.set(k, { name: groupName(e), riders: [], days: Object.fromEntries(DAYS.map((d) => [d, 0])) });
      const g = grp.get(k); g.riders.push(e); if (e.day_off && g.days[e.day_off] != null) g.days[e.day_off]++;
      if (e.day_off) { const ck = k + '|' + e.day_off; cluster.set(ck, (cluster.get(ck) || 0) + 1); }
    });
    return { act, byDay, noOff, grp, cluster };
  }

  // ---- optimiser: per (region, sub-region, shift) group, spread day-offs evenly; busy days get fewer offs ----
  function optimise(list, busy) {
    const act = list.filter(live), groups = new Map();
    act.forEach((e) => { const k = groupKey(e); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); });
    const plan = new Map();     // entry id -> proposed day
    groups.forEach((riders) => {
      const n = riders.length, w = DAYS.map((d) => (busy.includes(d) ? 0.4 : 1)), sw = w.reduce((a, b) => a + b, 0);
      const raw = w.map((x) => (n * x) / sw), tgt = raw.map(Math.floor); let left = n - tgt.reduce((a, b) => a + b, 0);
      raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, i]) => { if (left > 0 && !busy.includes(DAYS[i])) { tgt[i]++; left--; } });
      for (let i = 0; left > 0; i = (i + 1) % 7) { tgt[i]++; left--; }       // only if every day is "busy"
      const cap = [...tgt], keep = [], move = [];
      riders.forEach((e) => { const i = DAYS.indexOf(e.day_off); if (i >= 0 && cap[i] > 0) { cap[i]--; keep.push(e); plan.set(e.id, DAYS[i]); } else move.push(e); });
      move.forEach((e) => { let b = 0; cap.forEach((c, i) => { if (c > cap[b]) b = i; }); cap[b]--; plan.set(e.id, DAYS[b]); });
    });
    return { act, plan };
  }
  const metrics = (list, dayOf, busy) => {
    const g = new Map(); list.filter(live).forEach((e) => { const k = groupKey(e); if (!g.has(k)) g.set(k, []); g.get(k).push(e); });
    let maxOff = 0, minBusy = Infinity, shared = 0;
    g.forEach((r) => { const c = Object.fromEntries(DAYS.map((d) => [d, 0])); r.forEach((e) => { const d = dayOf(e); if (d) c[d]++; });
      DAYS.forEach((d) => { maxOff = Math.max(maxOff, c[d]); if (busy.includes(d)) minBusy = Math.min(minBusy, r.length - c[d]); if (c[d] > 1) shared += c[d]; }); });
    return { maxOff, minBusy: minBusy === Infinity ? 0 : minBusy, shared };
  };

  // ---- screen ---------------------------------------------------------
  window.fhRosterAI = function (list, scopeText) {
    const busy = getBusy(), A = analyse(list), O = optimise(list, busy);
    const before = metrics(list, (e) => e.day_off, busy), after = metrics(list, (e) => O.plan.get(e.id), busy);
    const changes = O.act.filter((e) => O.plan.get(e.id) && O.plan.get(e.id) !== e.day_off);
    const maxDay = Math.max(1, ...Object.values(A.byDay));
    const bar = (v, b) => `<div style="display:flex;align-items:center;gap:8px"><div style="flex:1;background:#eef0f6;border-radius:6px;height:14px"><div style="width:${Math.round((v / maxDay) * 100)}%;background:${b ? '#C1502E' : '#2f6a95'};height:14px;border-radius:6px"></div></div><b style="min-width:26px;text-align:right">${v}</b></div>`;
    const clusters = [...A.cluster.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
    const nameOfGroup = (k) => (A.grp.get(k.split('|').slice(0, 3).join('|')) || {}).name || '';
    openModal(`<div style="max-width:880px"><h2>🧠 Roster analysis &amp; days-off plan</h2>
      <p class="hint">${esc(scopeText || 'Everyone shown in the roster')}. Only active riders are counted.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin:10px 0">
        <div class="card" style="flex:1;min-width:130px;padding:10px"><div class="hint">Active riders</div><div style="font-size:26px;font-weight:700">${A.act.length}</div></div>
        <div class="card" style="flex:1;min-width:130px;padding:10px"><div class="hint">No day off set</div><div style="font-size:26px;font-weight:700;color:${A.noOff ? '#c0392b' : '#1d7a47'}">${A.noOff}</div></div>
        <div class="card" style="flex:1;min-width:130px;padding:10px"><div class="hint">Share shift + day off with others</div><div style="font-size:26px;font-weight:700">${before.shared}</div></div>
        <div class="card" style="flex:1;min-width:130px;padding:10px"><div class="hint">Most off on one day (one team)</div><div style="font-size:26px;font-weight:700">${before.maxOff}</div></div></div>
      <h3 style="margin:14px 0 6px">Busy days</h3>
      <p class="hint">Tick the days that are busiest. The plan gives fewer day-offs on those days. Saved on this device.</p>
      <div id="ra-busy" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">${DAYS.map((d) => `<label class="btn small ${busy.includes(d) ? '' : 'outline'}" style="border-radius:999px;cursor:pointer"><input type="checkbox" data-d="${d}" ${busy.includes(d) ? 'checked' : ''} style="display:none">${d.slice(0, 3)}</label>`).join('')}</div>
      <h3 style="margin:14px 0 6px">Riders off on each day (now)</h3>
      ${DAYS.map((d) => `<div style="display:flex;gap:8px;align-items:center;margin-bottom:4px"><span style="width:84px">${d}${busy.includes(d) ? ' 🔥' : ''}</span><div style="flex:1">${bar(A.byDay[d], busy.includes(d))}</div></div>`).join('')}
      <h3 style="margin:14px 0 6px">Same shift &amp; same day off</h3>
      ${clusters.length ? `<div style="overflow-x:auto;max-height:220px"><table><thead><tr><th>Team · shift</th><th>Day off</th><th>Riders</th><th>Left working that day</th></tr></thead><tbody>${clusters.slice(0, 60).map(([k, n]) => { const parts = k.split('|'), d = parts[3], gk = parts.slice(0, 3).join('|'), g = A.grp.get(gk); return `<tr><td>${esc(nameOfGroup(k))}</td><td>${d}</td><td><b>${n}</b></td><td>${g.riders.length - g.days[d]} of ${g.riders.length}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="hint">No two riders in the same team and shift share a day off.</p>'}
      <h3 style="margin:14px 0 6px">Suggested plan</h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <div class="card" style="flex:1;min-width:200px;padding:10px"><div class="hint">Most off on one day</div><b>${before.maxOff} → ${after.maxOff}</b></div>
        <div class="card" style="flex:1;min-width:200px;padding:10px"><div class="hint">Fewest riders working on a busy day</div><b>${before.minBusy} → ${after.minBusy}</b></div>
        <div class="card" style="flex:1;min-width:200px;padding:10px"><div class="hint">Riders whose day off changes</div><b>${changes.length}</b></div></div>
      <p class="hint">The plan works inside each team (region · sub-region · shift), keeps every rider on the current day when possible, and moves only the minimum needed.</p>
      ${changes.length ? `<div style="overflow-x:auto;max-height:240px"><table><thead><tr><th>Employee ID</th><th>Rider</th><th>Team · shift</th><th>Now</th><th>Suggested</th></tr></thead><tbody>${changes.slice(0, 300).map((e) => `<tr><td class="mono">${esc(e.profiles?.employee_id)}</td><td>${esc(e.profiles?.full_name)}</td><td>${esc(groupName(e))}</td><td>${esc(e.day_off || '—')}</td><td><b>${O.plan.get(e.id)}</b></td></tr>`).join('')}</tbody></table></div>${changes.length > 300 ? `<p class="hint">Showing 300 of ${changes.length}. The download has all.</p>` : ''}` : '<p class="hint">Nothing to change: day-offs are already well spread.</p>'}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn small outline" id="ra-dl" type="button" ${changes.length ? '' : 'disabled'}>⬇ Download plan</button>
        ${canApply() ? `<button class="btn" id="ra-apply" type="button" ${changes.length ? '' : 'disabled'}>Apply plan (${changes.length})</button>` : '<span class="hint" style="align-self:center">Only the Super Admin (or someone given the permission) can apply a plan.</span>'}
      </div><div id="ra-msg" class="hint" style="margin-top:8px"></div></div>`);

    document.getElementById('ra-busy').onchange = (e) => {
      const next = [...document.querySelectorAll('#ra-busy input:checked')].map((x) => x.dataset.d);
      setBusy(next); window.fhRosterAI(list, scopeText);
    };
    document.getElementById('ra-dl').onclick = () => {
      const rows = changes.map((e) => ({ 'Employee ID': e.profiles?.employee_id || '', Rider: e.profiles?.full_name || '', Region: e.regions?.name || '', 'Sub-region': e.sub_regions?.name || '', Shift: shiftOf(e), 'Current day off': e.day_off || '', 'Suggested day off': O.plan.get(e.id) }));
      if (typeof downloadCSV === 'function' && typeof toCSV === 'function') downloadCSV('roster-dayoff-plan-' + new Date().toISOString().slice(0, 10) + '.csv', toCSV(rows));
    };
    const ap = document.getElementById('ra-apply');
    if (ap) ap.onclick = async () => {
      if (!canApply()) return;
      if (!confirm('Change the day off of ' + changes.length + ' rider(s) as shown?\n\nThe old day off of each rider stays in the download you can take first.')) return;
      ap.disabled = true; const msg = document.getElementById('ra-msg'); let ok = 0, bad = 0, firstErr = '';
      for (let i = 0; i < changes.length; i++) {
        const e = changes[i], r = await sb.from('roster_entries').update({ day_off: O.plan.get(e.id) }).eq('id', e.id);
        if (r.error) { bad++; firstErr = firstErr || r.error.message; } else ok++;
        if (i % 10 === 0) msg.textContent = 'Applying… ' + (i + 1) + ' of ' + changes.length;
      }
      msg.textContent = ok + ' changed' + (bad ? ', ' + bad + ' could not be changed (' + firstErr + ')' : '') + '.';
      toast(ok + ' day-off(s) updated' + (bad ? ', ' + bad + ' failed' : ''));
      if (ok) { closeModal(); if (typeof renderRosterMain === 'function') renderRosterMain(); }
      else ap.disabled = false;
    };
  };
})();

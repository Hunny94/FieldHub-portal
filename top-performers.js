/* Top performers (v83): Super Admin marks a rider as top performer for a month, with an expiry date and an optional small photo.
   Shown on the home page; removed automatically after the expiry date (database job + this page). */
(function () {
  const esc = (s) => escapeHtml(s == null ? '' : String(s));
  const monthLabel = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); } catch (_e) { return d; } };
  const initials = (n) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

  // shrink a picture to a small square JPEG (about 10-20 KB) so it takes almost no database space
  function shrink(file, size) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(img.width, img.height), c = document.createElement('canvas'); c.width = c.height = size;
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(url);
        let q = 0.72, out = c.toDataURL('image/jpeg', q);
        while (out.length > 40000 && q > 0.3) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
        res(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('That file is not a picture')); };
      img.src = url;
    });
  }

  const card = (t, me) => `<div style="flex:0 0 auto;width:150px;text-align:center;padding:12px 10px;border-radius:14px;background:${me ? 'linear-gradient(160deg,#fff4cf,#ffe39a)' : '#fff'};border:1px solid ${me ? '#f0c24b' : '#e6e9f2'};box-shadow:0 2px 8px rgba(20,30,70,.06)">
    ${t.photo ? `<img src="${t.photo}" alt="" style="width:84px;height:84px;border-radius:50%;object-fit:cover;border:3px solid #f0c24b">` : `<div style="width:84px;height:84px;border-radius:50%;margin:0 auto;background:#2f6a95;color:#fff;font-size:28px;font-weight:700;display:flex;align-items:center;justify-content:center;border:3px solid #f0c24b">${esc(initials(t.rider_name))}</div>`}
    <div style="font-weight:700;margin-top:8px;line-height:1.2">${esc(t.rider_name)}</div>
    <div class="mono" style="font-size:12px;opacity:.8">${esc(t.employee_id)}</div>
    <div style="font-size:12px">${esc(t.region_name || '')}</div>
    <div style="font-size:11px;margin-top:4px;color:#8a5a00;font-weight:600">⭐ ${esc(monthLabel(t.perf_month))}</div></div>`;

  // home-page block (everyone sees the current top performers; the person himself gets a congratulation line)
  window.fhTopHomeHtml = async function () {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await sb.from('top_performers').select('*').gte('expires_on', today).order('perf_month', { ascending: false }).order('created_at', { ascending: false }).limit(40);
      if (!data || !data.length) return '';
      const me = state.user && state.user.id, mine = data.find((t) => t.rider_id === me);
      return `<div class="card" style="padding:14px"><h3 style="margin:0 0 4px">⭐ Our top performers</h3>
        ${mine ? `<p style="margin:0 0 8px;font-weight:600;color:#8a5a00">🎉 Congratulations ${esc((mine.rider_name || '').split(' ')[0])}! You were a top performer in ${esc(monthLabel(mine.perf_month))}.</p>` : '<p class="hint" style="margin:0 0 8px">Well done to the team members below.</p>'}
        <div style="display:flex;gap:12px;overflow-x:auto;padding:4px 2px 8px">${data.map((t) => card(t, t.rider_id === me)).join('')}</div></div>`;
    } catch (_e) { return ''; }
  };

  // Super Admin: roster row action
  window.fhTopModal = async function (entry) {
    if (!isSuperAdmin()) return;
    const p = entry.profiles || {}, today = new Date(), mon = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
    const lastD = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate(), exp = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(lastD).padStart(2, '0');   // end of this month by default
    const { data: ex } = await sb.from('top_performers').select('*').eq('rider_id', entry.rider_id).order('perf_month', { ascending: false });
    openModal(`<div style="max-width:480px"><h2>⭐ Top performer</h2>
      <p><b>${esc(p.full_name)}</b> <span class="mono">${esc(p.employee_id)}</span> · ${esc(entry.regions && entry.regions.name)}</p>
      ${ex && ex.length ? `<div class="hint">Already added:</div>${ex.map((t) => `<div style="display:flex;gap:8px;align-items:center;margin:4px 0"><span style="flex:1">${esc(monthLabel(t.perf_month))} · till ${esc(t.expires_on)}</span><button class="btn small danger" type="button" data-del="${t.id}">Remove</button></div>`).join('')}<hr>` : ''}
      <form id="tp-form">
        <div class="form-row"><label>Month he was top performer *</label><input type="month" id="tp-month" value="${mon}" required></div>
        <div class="form-row"><label>Show on home page until *</label><input type="date" id="tp-exp" value="${exp}" required><div class="hint">The entry and its picture are deleted automatically after this date.</div></div>
        <div class="form-row"><label>Picture (optional)</label><input type="file" id="tp-photo" accept="image/*"><div class="hint">It is shrunk automatically (small file), so it takes almost no storage.</div></div>
        <button class="btn" type="submit" id="tp-save">Save</button></form></div>`);
    document.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { if (!confirm('Remove this top-performer entry?')) return; const r = await sb.from('top_performers').delete().eq('id', b.dataset.del); toast(r.error ? 'Could not remove: ' + r.error.message : 'Removed'); closeModal(); }; });
    document.getElementById('tp-form').onsubmit = async (ev) => {
      ev.preventDefault();
      const m = document.getElementById('tp-month').value + '-01', e = document.getElementById('tp-exp').value, f = document.getElementById('tp-photo').files[0];
      if (e < new Date().toISOString().slice(0, 10)) { toast('Expiry date is already past'); return; }
      const btn = document.getElementById('tp-save'); btn.disabled = true;
      try {
        const photo = f ? await shrink(f, 240) : null;
        const row = { rider_id: entry.rider_id, employee_id: p.employee_id, rider_name: p.full_name, region_name: (entry.regions && entry.regions.name) || '', perf_month: m, expires_on: e, created_by: state.user.id };
        if (photo) row.photo = photo;
        const r = await sb.from('top_performers').upsert(row, { onConflict: 'rider_id,perf_month' });
        if (r.error) throw new Error(/relation .*top_performers|schema cache/i.test(r.error.message) ? 'Please run migration_61.sql first' : r.error.message);
        toast('Saved. Shows on the home page until ' + e); closeModal();
      } catch (err) { toast(err.message || 'Could not save'); btn.disabled = false; }
    };
  };
  // Super Admin: tidy expired rows when the home page opens (the daily database job does the same)
  window.fhTopTidy = function () { if (isSuperAdmin()) sb.rpc('fh_top_cleanup').then(() => {}, () => {}); };
})();

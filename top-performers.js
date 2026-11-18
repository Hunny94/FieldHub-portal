/* Top performers (v83): Super Admin marks a rider as top performer for a month, with an expiry date and an optional small photo.
   Shown on the home page; removed automatically after the expiry date (database job + this page). */
(function () {
  const esc = (s) => escapeHtml(s == null ? '' : String(s));
  const monthLabel = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); } catch (_e) { return d; } };
  const initials = (n) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

  // picture adjuster: choose the picture, then zoom and move it inside a round frame; the result is a small square JPEG (about 15 KB)
  function adjuster(file, size) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('That file is not a picture')); };
      img.onload = () => {
        const V = 260, st = { z: 1, ox: 0, oy: 0 }, base = Math.max(V / img.width, V / img.height);
        const box = document.getElementById('tp-adj'); box.style.display = 'block';
        box.innerHTML = `<div style="text-align:center"><canvas id="tp-cv" width="${V}" height="${V}" style="width:${V}px;max-width:100%;border-radius:50%;border:3px solid #f0c24b;touch-action:none;cursor:grab;background:#ddd"></canvas></div>
          <div class="hint" style="text-align:center">Drag the picture to move it. Use the slider to zoom.</div>
          <div style="display:flex;align-items:center;gap:8px;margin:6px 0"><span>➖</span><input type="range" id="tp-zoom" min="1" max="3.5" step="0.02" value="1" style="flex:1"><span>➕</span></div>
          <div style="text-align:center"><button type="button" class="btn small outline" id="tp-reset">Reset</button></div>`;
        const cv = document.getElementById('tp-cv'), cx = cv.getContext('2d');
        const clamp = () => { const w = img.width * base * st.z, h = img.height * base * st.z; st.ox = Math.min(Math.max(st.ox, -(w - V) / 2), (w - V) / 2); st.oy = Math.min(Math.max(st.oy, -(h - V) / 2), (h - V) / 2); };
        const paint = (c, S) => { const k = S / V; clamp(); const w = img.width * base * st.z * k, h = img.height * base * st.z * k; c.fillStyle = '#fff'; c.fillRect(0, 0, S, S); c.drawImage(img, (S - w) / 2 + st.ox * k, (S - h) / 2 + st.oy * k, w, h); };
        const draw = () => paint(cx, V); draw();
        document.getElementById('tp-zoom').oninput = (e) => { st.z = +e.target.value; draw(); };
        document.getElementById('tp-reset').onclick = () => { st.z = 1; st.ox = st.oy = 0; document.getElementById('tp-zoom').value = 1; draw(); };
        let drag = null;
        cv.onpointerdown = (e) => { drag = { x: e.clientX, y: e.clientY, ox: st.ox, oy: st.oy }; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; };
        cv.onpointermove = (e) => { if (!drag) return; const r = V / cv.getBoundingClientRect().width; st.ox = drag.ox + (e.clientX - drag.x) * r; st.oy = drag.oy + (e.clientY - drag.y) * r; draw(); };
        cv.onpointerup = cv.onpointercancel = () => { drag = null; cv.style.cursor = 'grab'; };
        res({ render: () => { const o = document.createElement('canvas'); o.width = o.height = size; paint(o.getContext('2d'), size); let q = 0.72, out = o.toDataURL('image/jpeg', q); while (out.length > 40000 && q > 0.3) { q -= 0.1; out = o.toDataURL('image/jpeg', q); } return out; } });
      };
      img.src = url;
    });
  }

  const card = (t, me, sa) => `<div style="width:150px;text-align:center;padding:12px 10px;border-radius:14px;background:${me ? 'linear-gradient(160deg,#fff4cf,#ffe39a)' : '#fff'};border:1px solid ${me ? '#f0c24b' : '#e6e9f2'};box-shadow:0 2px 8px rgba(20,30,70,.06)">
    ${t.photo ? `<img src="${t.photo}" alt="" style="width:84px;height:84px;border-radius:50%;object-fit:cover;border:3px solid #f0c24b">` : `<div style="width:84px;height:84px;border-radius:50%;margin:0 auto;background:#2f6a95;color:#fff;font-size:28px;font-weight:700;display:flex;align-items:center;justify-content:center;border:3px solid #f0c24b">${esc(initials(t.rider_name))}</div>`}
    <div style="font-weight:700;margin-top:8px;line-height:1.2">${esc(t.rider_name)}</div>
    <div class="mono" style="font-size:12px;opacity:.8">${esc(t.employee_id)}</div>
    <div style="font-size:12px">${esc(t.region_name || '')}</div>
    <div style="font-size:11px;margin-top:4px;color:#8a5a00;font-weight:600">⭐ ${esc(monthLabel(t.perf_month))}</div>${sa ? `<button type="button" data-revert="${t.id}" style="margin-top:6px;font-size:11px;padding:2px 8px;border-radius:8px;border:1px solid #c0392b;background:transparent;color:#c0392b;cursor:pointer">↩ Revert</button>` : ''}</div>`;

  // home-page block (everyone sees the current top performers; the person himself gets a congratulation line)
  window.fhTopHomeHtml = async function () {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await sb.from('top_performers').select('*').gte('expires_on', today).order('perf_month', { ascending: false }).order('created_at', { ascending: false }).limit(40);
      if (!data || !data.length) return '';
      const me = state.user && state.user.id, mine = data.find((t) => t.rider_id === me), sa = isSuperAdmin(), many = data.length > 1;
      setTimeout(wireStrip, 0);
      return `<div class="card" style="padding:12px 14px" id="tp-wrap"><div style="display:flex;align-items:center;gap:8px"><h3 style="margin:0;flex:1">⭐ Our top performers</h3>${many ? `<span id="tp-count" class="hint" style="font-size:12px;white-space:nowrap"></span>` : ''}</div>
        ${mine ? `<p style="margin:4px 0 0;font-weight:600;color:#8a5a00;font-size:13px">🎉 Congratulations ${esc((mine.rider_name || '').split(' ')[0])}! You were a top performer in ${esc(monthLabel(mine.perf_month))}.</p>` : ''}
        <div style="position:relative;margin-top:8px">
          <div id="tp-strip" style="display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding:4px 2px 10px;scrollbar-width:none;-webkit-overflow-scrolling:touch">${data.map((t) => `<div data-tp="${t.id}" style="scroll-snap-align:start;flex:0 0 auto">${card(t, t.rider_id === me, sa)}</div>`).join('')}</div>
          ${many ? `<button type="button" id="tp-prev" aria-label="Previous" style="position:absolute;left:-4px;top:42%;width:30px;height:30px;border-radius:50%;border:0;background:rgba(30,42,110,.85);color:#fff;font-size:16px;cursor:pointer;display:none">‹</button>
          <button type="button" id="tp-next" aria-label="Next" style="position:absolute;right:-4px;top:42%;width:30px;height:30px;border-radius:50%;border:0;background:rgba(30,42,110,.85);color:#fff;font-size:16px;cursor:pointer">›</button>
          <div id="tp-fade" style="position:absolute;right:0;top:0;bottom:10px;width:34px;pointer-events:none;background:linear-gradient(90deg,transparent,var(--card,#fff));opacity:.9"></div>` : ''}
        </div>
        ${many ? `<div id="tp-hint" style="text-align:center;font-size:12px;opacity:.75;margin-top:-2px">👈 Swipe to see more top performers 👉</div><div id="tp-dots" style="display:flex;justify-content:center;gap:5px;margin-top:4px">${data.map((_, i) => `<i data-d="${i}" style="width:6px;height:6px;border-radius:50%;background:rgba(150,160,210,.5);display:inline-block"></i>`).join('')}</div>` : ''}</div>`;
    } catch (_e) { return ''; }
  };
  function wireStrip() {
    const st = document.getElementById('tp-strip'); if (!st) return;
    const items = [...st.children], prev = document.getElementById('tp-prev'), next = document.getElementById('tp-next'), cnt = document.getElementById('tp-count'), dots = [...document.querySelectorAll('#tp-dots i')], fade = document.getElementById('tp-fade'), hint = document.getElementById('tp-hint');
    const upd = () => {
      const x = st.scrollLeft, w = items[0] ? items[0].offsetWidth + 12 : 1, i = Math.min(items.length - 1, Math.round(x / w)), end = x + st.clientWidth >= st.scrollWidth - 4;
      if (cnt) cnt.textContent = (i + 1) + ' of ' + items.length; dots.forEach((d, k) => { d.style.background = k === i ? '#f0c24b' : 'rgba(150,160,210,.5)'; d.style.transform = k === i ? 'scale(1.4)' : ''; });
      if (prev) prev.style.display = x > 8 ? 'block' : 'none'; if (next) next.style.display = end ? 'none' : 'block'; if (fade) fade.style.display = end ? 'none' : 'block';
      if (hint && x > 40) hint.style.opacity = '0';
    };
    st.addEventListener('scroll', upd, { passive: true }); window.addEventListener('resize', upd); upd();
    if (prev) prev.onclick = () => st.scrollBy({ left: -(items[0].offsetWidth + 12), behavior: 'smooth' }); if (next) next.onclick = () => st.scrollBy({ left: items[0].offsetWidth + 12, behavior: 'smooth' });
    // a small nudge on the first view so people notice the strip moves
    if (items.length > 1 && !st.dataset.nudged) { st.dataset.nudged = '1'; setTimeout(() => { st.scrollTo({ left: 40, behavior: 'smooth' }); setTimeout(() => st.scrollTo({ left: 0, behavior: 'smooth' }), 500); }, 900); }
    st.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-revert]'); if (!b) return;
      if (!confirm('Revert this top performer? The entry and its picture are removed from every home page.')) return;
      const r = await sb.from('top_performers').delete().eq('id', b.dataset.revert);
      toast(r.error ? 'Could not revert: ' + r.error.message : 'Top performer reverted'); if (!r.error) { const el = st.querySelector('[data-tp="' + b.dataset.revert + '"]'); if (el) el.remove(); if (!st.children.length) document.getElementById('tp-wrap').remove(); else upd(); }
    });
  }

  // Super Admin: roster row action
  window.fhTopModal = async function (entry) {
    if (!isSuperAdmin()) return;
    const p = entry.profiles || {}, today = new Date(), mon = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
    const lastD = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate(), exp = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(lastD).padStart(2, '0');   // end of this month by default
    const { data: ex } = await sb.from('top_performers').select('*').eq('rider_id', entry.rider_id).order('perf_month', { ascending: false });
    openModal(`<div style="max-width:480px"><h2>⭐ Top performer</h2>
      <p><b>${esc(p.full_name)}</b> <span class="mono">${esc(p.employee_id)}</span> · ${esc(entry.regions && entry.regions.name)}</p>
      ${ex && ex.length ? `<div class="hint">Already added (Remove = revert):</div>${ex.map((t) => `<div style="display:flex;gap:8px;align-items:center;margin:4px 0"><span style="flex:1">${esc(monthLabel(t.perf_month))} · till ${esc(t.expires_on)}</span><button class="btn small danger" type="button" data-del="${t.id}">Remove</button></div>`).join('')}<hr>` : ''}
      <form id="tp-form">
        <div class="form-row"><label>Month he was top performer *</label><input type="month" id="tp-month" value="${mon}" required></div>
        <div class="form-row"><label>Show on home page until *</label><input type="date" id="tp-exp" value="${exp}" required><div class="hint">The entry and its picture are deleted automatically after this date.</div></div>
        <div class="form-row"><label>Picture (optional)</label><input type="file" id="tp-photo" accept="image/*"><div class="hint">You can move and zoom it before saving. It is shrunk automatically (small file), so it takes almost no storage.</div><div id="tp-adj" style="display:none;margin-top:8px"></div></div>
        <button class="btn" type="submit" id="tp-save">Save</button></form></div>`);
    document.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { if (!confirm('Remove this top-performer entry?')) return; const r = await sb.from('top_performers').delete().eq('id', b.dataset.del); toast(r.error ? 'Could not remove: ' + r.error.message : 'Removed'); closeModal(); }; });
    let adj = null;
    document.getElementById('tp-photo').onchange = async (ev) => { const f = ev.target.files[0]; adj = null; const box = document.getElementById('tp-adj'); box.style.display = 'none'; if (!f) return; try { adj = await adjuster(f, 240); } catch (err) { toast(err.message || 'Could not open the picture'); } };
    document.getElementById('tp-form').onsubmit = async (ev) => {
      ev.preventDefault();
      const m = document.getElementById('tp-month').value + '-01', e = document.getElementById('tp-exp').value;
      if (e < new Date().toISOString().slice(0, 10)) { toast('Expiry date is already past'); return; }
      const btn = document.getElementById('tp-save'); btn.disabled = true;
      try {
        const photo = adj ? adj.render() : null;
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

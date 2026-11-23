/* Top performers (v83): Super Admin marks a rider as top performer for a month, with an expiry date and an optional small photo.
   Shown on the home page; removed automatically after the expiry date (database job + this page). */
(function () {
  const esc = (s) => escapeHtml(s == null ? '' : String(s));
  const monthLabel = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); } catch (_e) { return d; } };
  const initials = (n) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

  // picture adjuster (v94): choose / re-frame a picture inside a rounded-square frame. Zoom in or OUT (white fills the gaps),
  // drag it anywhere, or use the − / + and arrow buttons for small steps. The result is a small square JPEG (about 15-25 KB).
  function adjuster(file, size) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('That file is not a picture')); };
      img.onload = () => {
        const V = 260, base = Math.max(V / img.width, V / img.height), fitZ = Math.min(V / img.width, V / img.height) / base;
        const ZMIN = Math.min(0.5, fitZ), ZMAX = 4, st = { z: 1, ox: 0, oy: 0 };
        const box = document.getElementById('tp-adj'); box.style.display = 'block';
        const b = (id, txt, title) => `<button type="button" class="btn small outline" id="${id}" title="${title}" aria-label="${title}" style="min-width:38px;padding:5px 9px">${txt}</button>`;
        box.innerHTML = `<div style="text-align:center"><canvas id="tp-cv" width="${V}" height="${V}" style="width:${V}px;max-width:100%;border-radius:22px;border:3px solid #f0c24b;touch-action:none;cursor:grab;background:#fff"></canvas></div>
          <div class="hint" style="text-align:center;margin:6px 0">Drag the picture to move it. Zoom out to show more (white fills the empty space).</div>
          <div style="display:flex;align-items:center;gap:8px;margin:6px 0">${b('tp-zout', '−', 'Zoom out')}<input type="range" id="tp-zoom" min="${ZMIN.toFixed(2)}" max="${ZMAX}" step="0.01" value="1" style="flex:1" aria-label="Zoom">${b('tp-zin', '+', 'Zoom in')}</div>
          <div style="display:flex;justify-content:center;align-items:center;gap:6px;flex-wrap:wrap">${b('tp-l', '←', 'Move left')}${b('tp-u', '↑', 'Move up')}${b('tp-d', '↓', 'Move down')}${b('tp-r', '→', 'Move right')}
            <button type="button" class="btn small outline" id="tp-fit" title="Show the whole picture">Whole picture</button><button type="button" class="btn small outline" id="tp-reset">Reset</button></div>`;
        const cv = document.getElementById('tp-cv'), cx = cv.getContext('2d'), zr = document.getElementById('tp-zoom');
        // the picture may move until only a third of it is still inside the frame (so it can never get lost)
        const clamp = () => { const w = img.width * base * st.z, h = img.height * base * st.z, lx = Math.max(Math.abs(w - V) / 2, (w + V) / 2 - Math.min(w, V) / 3), ly = Math.max(Math.abs(h - V) / 2, (h + V) / 2 - Math.min(h, V) / 3); st.ox = Math.min(Math.max(st.ox, -lx), lx); st.oy = Math.min(Math.max(st.oy, -ly), ly); };
        const paint = (c, S) => { const k = S / V; clamp(); const w = img.width * base * st.z * k, h = img.height * base * st.z * k; c.fillStyle = '#fff'; c.fillRect(0, 0, S, S); c.imageSmoothingQuality = 'high'; c.drawImage(img, (S - w) / 2 + st.ox * k, (S - h) / 2 + st.oy * k, w, h); };
        const draw = () => paint(cx, V);
        const setZ = (z) => { st.z = Math.min(ZMAX, Math.max(ZMIN, +z)); zr.value = st.z; draw(); };
        const move = (dx, dy) => { st.ox += dx; st.oy += dy; draw(); };
        draw();
        zr.oninput = (e) => setZ(e.target.value);
        document.getElementById('tp-zin').onclick = () => setZ(st.z + 0.1);
        document.getElementById('tp-zout').onclick = () => setZ(st.z - 0.1);
        document.getElementById('tp-l').onclick = () => move(-8, 0);
        document.getElementById('tp-r').onclick = () => move(8, 0);
        document.getElementById('tp-u').onclick = () => move(0, -8);
        document.getElementById('tp-d').onclick = () => move(0, 8);
        document.getElementById('tp-fit').onclick = () => { st.ox = st.oy = 0; setZ(fitZ); };
        document.getElementById('tp-reset').onclick = () => { st.ox = st.oy = 0; setZ(1); };
        cv.addEventListener('wheel', (e) => { e.preventDefault(); setZ(st.z * (e.deltaY < 0 ? 1.06 : 1 / 1.06)); }, { passive: false });
        let drag = null;
        cv.onpointerdown = (e) => { drag = { x: e.clientX, y: e.clientY, ox: st.ox, oy: st.oy }; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; };
        cv.onpointermove = (e) => { if (!drag) return; const r = V / cv.getBoundingClientRect().width; st.ox = drag.ox + (e.clientX - drag.x) * r; st.oy = drag.oy + (e.clientY - drag.y) * r; draw(); };
        cv.onpointerup = cv.onpointercancel = () => { drag = null; cv.style.cursor = 'grab'; };
        res({ render: () => { const o = document.createElement('canvas'); o.width = o.height = size; paint(o.getContext('2d'), size); let q = 0.8, out = o.toDataURL('image/jpeg', q); while (out.length > 40000 && q > 0.3) { q -= 0.1; out = o.toDataURL('image/jpeg', q); } return out; } });
      };
      img.src = url;
    });
  }
  // v92: compact card (photo left, details right) so the home page stays short; Super Admin gets Edit + Revert
  const TP_CSS = `.tp-card{width:290px;display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:14px;background:#fff;border:1px solid #e6e9f2;box-shadow:0 2px 8px rgba(20,30,70,.06);text-align:left;box-sizing:border-box}
.tp-card.me{background:linear-gradient(160deg,#fff4cf,#ffe39a);border-color:#f0c24b}
.tp-av{width:92px;height:92px;flex:0 0 auto;border-radius:16px;object-fit:cover;object-position:center top;border:3px solid #f0c24b;box-sizing:border-box;background:#eef1fb}
.tp-ini{background:#2f6a95;color:#fff;font-size:28px;font-weight:700;display:flex;align-items:center;justify-content:center}
.tp-tx{min-width:0;display:flex;flex-direction:column;gap:1px;line-height:1.25}
.tp-tx b{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tp-tx .s{font-size:12px;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tp-tx .m{font-size:11.5px;color:#8a5a00;font-weight:600}
.tp-act{display:flex;gap:6px;margin-top:4px}
.tp-act button{font-size:11px;padding:2px 8px;border-radius:8px;background:transparent;cursor:pointer;line-height:1.5}
.tp-act .e{border:1px solid #1E2A6E;color:#1E2A6E}.tp-act .r{border:1px solid #c0392b;color:#c0392b}
html.fh-dark .tp-card{background:#171e46;border-color:#2b3470;box-shadow:none}html.fh-dark .tp-card.me{background:linear-gradient(160deg,#3a3210,#5a4a12);border-color:#b8942f}
html.fh-dark .tp-tx .m{color:#f0c24b}html.fh-dark .tp-act .e{border-color:#8da0ff;color:#8da0ff}html.fh-dark .tp-act .r{border-color:#ff9b8f;color:#ff9b8f}
#tp-wrap{padding:10px 14px 8px!important}#tp-wrap h3{font-size:15px}#tp-wrap>div:nth-child(2),#tp-wrap>div[style*="position:relative"]{margin-top:4px!important}#tp-strip{padding:4px 2px 6px!important}#tp-dots{margin-top:0!important}
@media (hover:hover) and (min-width:701px){#tp-hint{display:none}}
@media (max-width:700px){.tp-card{width:268px}.tp-av{width:84px;height:84px}}`;
  if (!document.getElementById('tp-css')) { const st = document.createElement('style'); st.id = 'tp-css'; st.textContent = TP_CSS; document.head.appendChild(st); }
  const card = (t, me, sa) => `<div class="tp-card ${me ? 'me' : ''}">
    ${t.photo ? `<img class="tp-av" src="${t.photo}" alt="">` : `<div class="tp-av tp-ini">${esc(initials(t.rider_name))}</div>`}
    <div class="tp-tx"><b title="${esc(t.rider_name)}">${esc(t.rider_name)}</b><span class="s">${esc(t.employee_id || '')}${t.region_name ? ' · ' + esc(t.region_name) : ''}</span><span class="m">⭐ ${esc(monthLabel(t.perf_month))}</span>
    ${sa ? `<span class="tp-act"><button type="button" class="e" data-edit-tp="${t.id}">✎ Edit</button><button type="button" class="r" data-revert="${t.id}">↩ Revert</button></span>` : ''}</div></div>`;

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
      const ed = e.target.closest('[data-edit-tp]'); if (ed) { window.fhTopEdit(ed.dataset.editTp); return; }
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
      ${ex && ex.length ? `<div class="hint">Already added (Remove = revert):</div>${ex.map((t) => `<div style="display:flex;gap:8px;align-items:center;margin:4px 0"><span style="flex:1">${esc(monthLabel(t.perf_month))} · till ${esc(t.expires_on)}</span><button class="btn small outline" type="button" data-tpedit="${t.id}">✎ Edit</button><button class="btn small danger" type="button" data-del="${t.id}">Remove</button></div>`).join('')}<hr>` : ''}
      <form id="tp-form">
        <div class="form-row"><label>Month he was top performer *</label><input type="month" id="tp-month" value="${mon}" required></div>
        <div class="form-row"><label>Show on home page until *</label><input type="date" id="tp-exp" value="${exp}" required><div class="hint">The entry and its picture are deleted automatically after this date.</div></div>
        <div class="form-row"><label>Picture (optional)</label><input type="file" id="tp-photo" accept="image/*"><div class="hint">You can move and zoom it before saving. It is shrunk automatically (small file), so it takes almost no storage.</div><div id="tp-adj" style="display:none;margin-top:8px"></div></div>
        <button class="btn" type="submit" id="tp-save">Save</button></form></div>`);
    document.querySelectorAll('[data-tpedit]').forEach((b) => { b.onclick = () => window.fhTopEdit(b.dataset.tpedit); });
    document.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { if (!confirm('Remove this top-performer entry?')) return; const r = await sb.from('top_performers').delete().eq('id', b.dataset.del); toast(r.error ? 'Could not remove: ' + r.error.message : 'Removed'); closeModal(); }; });
    let adj = null;
    document.getElementById('tp-photo').onchange = async (ev) => { const f = ev.target.files[0]; adj = null; const box = document.getElementById('tp-adj'); box.style.display = 'none'; if (!f) return; try { adj = await adjuster(f, 300); } catch (err) { toast(err.message || 'Could not open the picture'); } };
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
  // v92 Super Admin: edit a top performer (name, employee ID, region, month, show-until date, picture: replace, adjust or remove)
  window.fhTopEdit = async function (id) {
    if (!isSuperAdmin()) return;
    const { data: t, error } = await sb.from('top_performers').select('*').eq('id', id).maybeSingle();
    if (error || !t) { toast('Could not open this entry' + (error ? ': ' + error.message : '')); return; }
    const pic = (src) => src ? `<img src="${src}" alt="" style="width:96px;height:96px;border-radius:16px;object-fit:cover;object-position:center top;border:3px solid #f0c24b">` : `<div style="width:96px;height:96px;border-radius:16px;background:#2f6a95;color:#fff;font-size:28px;font-weight:700;display:flex;align-items:center;justify-content:center;border:3px solid #f0c24b">${esc(initials(t.rider_name))}</div>`;
    openModal(`<div style="max-width:480px"><h2>✎ Edit top performer</h2>
      <div style="display:flex;align-items:center;gap:14px;margin:4px 0 12px"><span id="tpe-now">${pic(t.photo)}</span><div class="hint" style="margin:0">Fix any mistake below. The change shows on every home page straight away.</div></div>
      <form id="tpe-form">
        <div class="form-row"><label>Name shown *</label><input type="text" id="tpe-name" value="${esc(t.rider_name || '')}" required maxlength="80"></div>
        <div class="two-col"><div class="form-row"><label>Employee ID</label><input type="text" id="tpe-emp" value="${esc(t.employee_id || '')}" maxlength="20"></div>
        <div class="form-row"><label>Region shown</label><input type="text" id="tpe-reg" value="${esc(t.region_name || '')}" maxlength="60"></div></div>
        <div class="two-col"><div class="form-row"><label>Month he was top performer *</label><input type="month" id="tpe-month" value="${esc(String(t.perf_month || '').slice(0, 7))}" required></div>
        <div class="form-row"><label>Show until *</label><input type="date" id="tpe-exp" value="${esc(t.expires_on || '')}" required></div></div>
        <div class="form-row"><label>Picture</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><label class="btn outline" style="margin:0;cursor:pointer">🖼 Choose new picture<input type="file" id="tpe-photo" accept="image/*" style="display:none"></label>${t.photo ? `<button type="button" class="btn outline" id="tpe-adjust">✂ Adjust current picture</button>` : ''}</div>
          <div class="hint">Move and zoom the picture inside the frame, then Save. It is shrunk automatically (about 15 KB).</div><div id="tp-adj" style="display:none;margin-top:8px"></div></div>
        ${t.photo ? `<label style="display:flex;align-items:center;gap:8px;font-size:13px;margin:-4px 0 12px"><input type="checkbox" id="tpe-nopic" style="width:auto"> Remove the picture (show initials instead)</label>` : ''}
        <button class="btn" type="submit" id="tpe-save">Save changes</button></form></div>`);
    let adj = null;
    const adjBtn = document.getElementById('tpe-adjust');
    if (adjBtn) adjBtn.onclick = async () => {   // re-frame the picture already saved (no new file needed)
      try { const bl = await (await fetch(t.photo)).blob(); adj = await adjuster(new File([bl], 'current.jpg', { type: bl.type || 'image/jpeg' }), 300); const nb = document.getElementById('tpe-nopic'); if (nb) nb.checked = false; }
      catch (err) { toast('Could not open the current picture. Please choose a new one.'); }
    };
    document.getElementById('tpe-photo').onchange = async (ev) => { const f = ev.target.files[0]; adj = null; document.getElementById('tp-adj').style.display = 'none'; if (!f) return; try { adj = await adjuster(f, 300); const nb = document.getElementById('tpe-nopic'); if (nb) nb.checked = false; } catch (err) { toast(err.message || 'Could not open the picture'); } };
    document.getElementById('tpe-form').onsubmit = async (ev) => {
      ev.preventDefault();
      const name = document.getElementById('tpe-name').value.trim(), m = document.getElementById('tpe-month').value, e = document.getElementById('tpe-exp').value;
      if (!name || !m || !e) { toast('Please fill the name, month and show-until date'); return; }
      if (e < new Date().toISOString().slice(0, 10)) { toast('The show-until date is already past. Use Revert to remove an entry.'); return; }
      const row = { rider_name: name, employee_id: document.getElementById('tpe-emp').value.trim() || null, region_name: document.getElementById('tpe-reg').value.trim(), perf_month: m + '-01', expires_on: e };
      const nb = document.getElementById('tpe-nopic');
      if (adj) row.photo = adj.render(); else if (nb && nb.checked) row.photo = null;
      const btn = document.getElementById('tpe-save'); btn.disabled = true;
      const r = await sb.from('top_performers').update(row).eq('id', id);
      if (r.error) { btn.disabled = false; toast(/duplicate|unique/i.test(r.error.message) ? 'This person is already a top performer for that month. Choose another month.' : 'Could not save: ' + r.error.message); return; }
      toast('Top performer updated'); closeModal();
      try { if (state.view === 'dashboard') navigateTo('dashboard'); } catch (_e) {}
    };
  };
  // Super Admin: tidy expired rows when the home page opens (the daily database job does the same)
  window.fhTopTidy = function () { if (isSuperAdmin()) sb.rpc('fh_top_cleanup').then(() => {}, () => {}); };
})();

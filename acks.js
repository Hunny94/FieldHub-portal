// =====================================================================================
// acks.js — acknowledgements & request details (v1, needs migration_72)
//  1. Force acknowledge window (Super Admin): only items older than the set hours (48 by default),
//     clear list, preview of the message the rider gets (app / phone / e-mail), Settings
//     (switch off, automatic after N hours, reminders every N hours, rider prompt), "Not received" list.
//  2. Rider prompt: anything waiting for his acknowledgement must be answered (Received / Not received)
//     before he can use the app. Checked when the app opens and every 30 minutes.
//  3. E-mails for automatic force acknowledgements are sent when the Super Admin opens the portal.
//  4. Requests: "Details" opens in a side panel (bottom sheet on phones) instead of stretching the list.
// Before migration_72 is run, the old Force acknowledge window is used and nothing else changes.
// Remove the acks.js line from index.html to undo all of this.
// =====================================================================================
(function () {
  'use strict';
  const h = (s) => (typeof escapeHtml === 'function' ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s));
  const say = (m) => { try { toast(m); } catch (_e) { alert(m); } };
  const em = (e) => String((e && e.message) || e || 'Something went wrong').replace(/^.*?:\s*(?=[A-Z])/, '');
  const missing = (e) => /fh_ack|fh_my_pending|fh_rider_ack|fh_force_ack_v2|function|schema cache/i.test((e && e.message) || '');
  const dmy = (d) => { const x = new Date(d); return isNaN(x) ? '' : x.toLocaleDateString('en-GB').replace(/\//g, '-'); };
  const ago = (hrs) => hrs < 1 ? 'just now' : hrs < 48 ? Math.round(hrs) + ' h ago' : Math.round(hrs / 24) + ' days ago';
  const ackText = (what, day, auto) => `${what} was issued to you on ${dmy(day)}. Your acknowledgement was pending${auto ? ' for too long' : ''}, so it is now considered acknowledged. Add remarks within 2 hrs or contact your supervisor if you have a concern.`;

  function css() {
    if (document.getElementById('ack-css')) return;
    const st = document.createElement('style'); st.id = 'ack-css';
    st.textContent = `
      .ak-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 12px}
      .ak-tab{border:1px solid #d6daec;background:#fff;color:#1E2A6E;border-radius:999px;padding:6px 14px;font-weight:600;font-size:13px;cursor:pointer}
      .ak-tab.on{background:#1E2A6E;color:#fff;border-color:#1E2A6E}
      .ak-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:0 0 8px}
      .ak-bar input[type=search]{flex:1;min-width:180px;padding:8px 10px;border:1px solid #d6daec;border-radius:9px;font:inherit}
      .ak-bar label{display:flex;gap:6px;align-items:center;font-size:13px;white-space:nowrap}
      .ak-list{max-height:44vh;overflow:auto;border:1px solid #e3e6f0;border-radius:12px}
      .ak-row{display:grid;grid-template-columns:22px 1fr auto;gap:4px 10px;align-items:center;padding:10px 12px;border-bottom:1px solid #eef0f6;cursor:pointer;line-height:1.35}
      .ak-row:last-child{border-bottom:0}
      .ak-row:hover{background:#f7f8fd}
      .ak-row.off{cursor:default;opacity:.62}
      .ak-row input{margin:0;width:16px;height:16px}
      .ak-t{font-weight:700;color:#1E2A6E;font-size:14px;min-width:0;overflow-wrap:anywhere}
      .ak-t span{font-weight:500;color:#3d4466}
      .ak-m{grid-column:2/3;font-size:12px;color:#6b7290}
      .ak-chip{grid-row:1/3;grid-column:3;font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap}
      .ak-chip.ok{background:#e3f4ea;color:#2e7d4f}.ak-chip.wait{background:#fff3df;color:#a0672b}
      .ak-prev{margin-top:10px;padding:10px 12px;border-radius:10px;background:#f4f6fb;border:1px solid #e3e6f0;font-size:13px}
      .ak-prev b{color:#1E2A6E}
      .ak-prev pre{white-space:pre-wrap;font:inherit;margin:4px 0 0;color:#3d4466}
      .ak-set .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:9px 0;border-bottom:1px solid #eef0f6}
      .ak-set .row:last-child{border-bottom:0}
      .ak-set input[type=number]{width:80px;padding:6px 8px;border:1px solid #d6daec;border-radius:8px}
      .ak-set .t{flex:1;min-width:200px}.ak-set .t small{display:block;color:#6b7290;font-size:12px;margin-top:2px}
      .ak-gate .ak-item{border:1px solid #e3e6f0;border-radius:12px;padding:10px 12px;margin:8px 0}
      .ak-gate .ak-item b{color:#1E2A6E}
      .ak-gate .ak-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
      .ak-gate textarea{width:100%;margin-top:8px;padding:8px;border:1px solid #d6daec;border-radius:9px;font:inherit;min-height:56px}
      /* request details panel */
      #rq-drawer-bg{position:fixed;inset:0;background:rgba(15,20,45,.35);z-index:880;opacity:0;transition:opacity .2s}
      #rq-drawer{position:fixed;top:0;right:0;bottom:0;width:min(560px,100vw);background:var(--card,#fff);z-index:890;box-shadow:-12px 0 40px rgba(20,25,60,.18);
        display:flex;flex-direction:column;transform:translateX(100%);transition:transform .25s cubic-bezier(.2,.8,.2,1)}
      #rq-drawer.on{transform:none}#rq-drawer-bg.on{opacity:1}
      #rq-drawer .dh{padding:16px 18px 12px;border-bottom:1px solid #eef0f6}
      #rq-drawer .dh .x{float:right;border:0;background:#f1f3fa;border-radius:10px;width:34px;height:34px;font-size:18px;cursor:pointer;color:#1E2A6E}
      #rq-drawer .dh h3{margin:0 0 4px;color:#1E2A6E;font-size:18px}
      #rq-drawer .dh .sub{font-size:13px;color:#5b6280}
      #rq-drawer .dh .acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
      #rq-drawer .db{flex:1;overflow:auto;padding:14px 18px 20px}
      #rq-drawer .db .rq-more{margin:0;padding:0;border:0}
      @media (max-width:700px){#rq-drawer{top:auto;width:100vw;height:88vh;border-radius:20px 20px 0 0;transform:translateY(100%)}#rq-drawer.on{transform:none}}
      /* tidier request cards */
      .card.rq .rq-desc{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .card.rq .rq-btns .btn.small{padding:6px 12px}
      @media (min-width:1280px){#req-list{display:grid;grid-template-columns:1fr 1fr;gap:10px}#req-list>.card.rq{margin:0}}
      html.fh-dark .ak-row:hover{background:#1b2350}html.fh-dark .ak-list,html.fh-dark .ak-prev,html.fh-dark .ak-gate .ak-item{border-color:#2a3260}
      html.fh-dark .ak-prev{background:#161c3a}html.fh-dark .ak-t{color:#cdd3ff}html.fh-dark .ak-t span{color:#aab1d6}
      html.fh-dark .ak-tab{background:#1b2350;color:#cdd3ff;border-color:#2f3870}html.fh-dark .ak-tab.on{background:#8da0ff;color:#0d1230}
      html.fh-dark #rq-drawer{background:#121838}html.fh-dark #rq-drawer .dh{border-color:#262f62}html.fh-dark #rq-drawer .dh h3{color:#e6e9ff}
      html.fh-dark #rq-drawer .dh .x{background:#1f2750;color:#e6e9ff}`;
    document.head.appendChild(st);
  }

  // =====================================================================================
  // 1. Force acknowledge window
  // =====================================================================================
  const oldModal = window.fhForceAckModal;
  window.fhForceAckModal = async function (after) {
    if (typeof isSuperAdmin !== 'function' || !isSuperAdmin()) return;
    css();
    openModal(`<h2>Acknowledgements</h2><div id="ak-body"><div class="mono">Loading…</div></div>`);
    const { data, error } = await sb.rpc('fh_ack_list');
    if (error) { if (missing(error) && typeof oldModal === 'function') { closeModal(); return oldModal(after); } document.getElementById('ak-body').innerHTML = `<p class="hint">${h(em(error))}</p>`; return; }
    const S = data.settings || {}, items = data.items || [], disputes = data.disputes || [];
    const st = { tab: 'list', q: '', ready: true, sel: new Set() };
    const done = () => { closeModal(); if (typeof after === 'function') after(); else if (state.view === 'requests' && typeof renderRequests === 'function') renderRequests(); };
    const key = (x) => x.kind + ':' + x.id;
    const paint = () => {
      const body = document.getElementById('ak-body'); if (!body) return;
      const ready = items.filter(x => !x.wait), list = items.filter(x => (!st.ready || !x.wait) && (!st.q || (x.name + ' ' + x.emp + ' ' + x.what + ' ' + (x.handler || '')).toLowerCase().includes(st.q)));
      const tabs = `<div class="ak-tabs"><button class="ak-tab${st.tab === 'list' ? ' on' : ''}" data-t="list" type="button">Waiting (${items.length})</button><button class="ak-tab${st.tab === 'disp' ? ' on' : ''}" data-t="disp" type="button">Not received (${disputes.length})</button><button class="ak-tab${st.tab === 'set' ? ' on' : ''}" data-t="set" type="button">⚙ Settings</button></div>`;
      if (st.tab === 'set') {
        body.innerHTML = tabs + `<div class="ak-set">
          <div class="row"><input type="checkbox" id="s-f"${S.force_enabled ? ' checked' : ''}><div class="t"><b>Force acknowledge is ON</b><small>Untick to switch the Force acknowledge button off completely.</small></div></div>
          <div class="row"><div class="t"><b>Allowed only after</b><small>Hours since the request was resolved / the tool was issued. Earlier items show an error.</small></div><input type="number" id="s-m" min="0" max="720" value="${h(S.min_hours)}"> hours</div>
          <div class="row"><input type="checkbox" id="s-a"${S.auto_enabled ? ' checked' : ''}><div class="t"><b>Automatic force acknowledge</b><small>Every hour, items waiting longer than this are acknowledged by themselves. The rider gets the same notice; the e-mail goes out the next time you open the portal.</small></div><input type="number" id="s-ah" min="24" max="2160" value="${h(S.auto_hours)}"> hours</div>
          <div class="row"><input type="checkbox" id="s-r"${S.remind_enabled ? ' checked' : ''}><div class="t"><b>Remind the rider</b><small>A notice in the app and on the phone's notification bar until he answers.</small></div>every <input type="number" id="s-rh" min="1" max="72" value="${h(S.remind_hours)}"> hours</div>
          <div class="row"><input type="checkbox" id="s-p"${S.rider_prompt ? ' checked' : ''}><div class="t"><b>Rider must answer before using the app</b><small>When the app opens he sees each item with <b>Received</b> / <b>Not received</b>.</small></div></div>
          </div><div style="display:flex;gap:8px;margin-top:12px"><button class="btn" id="s-save" type="button">Save settings</button><button class="btn outline" id="ak-close" type="button">Close</button></div>
          <p class="hint" style="margin-top:10px">Automatic force acknowledge and reminders run once an hour on the server (they need the hourly job from migration_72).</p>`;
        document.getElementById('s-save').onclick = async () => {
          const g = (id) => document.getElementById(id);
          const p = { force_enabled: g('s-f').checked, min_hours: +g('s-m').value, auto_enabled: g('s-a').checked, auto_hours: +g('s-ah').value, remind_enabled: g('s-r').checked, remind_hours: +g('s-rh').value, rider_prompt: g('s-p').checked };
          if (p.auto_enabled && p.auto_hours < p.min_hours) { say('Automatic hours must be at least the "allowed only after" hours'); return; }
          const { error: e2 } = await sb.rpc('fh_ack_settings_save', { p });
          if (e2) { say('Could not save: ' + em(e2)); return; }
          Object.assign(S, p); say('Settings saved'); paint();
        };
      } else if (st.tab === 'disp') {
        body.innerHTML = tabs + (disputes.length ? `<p class="hint">Riders said they did <b>not</b> receive these tools. Sort it out with them, then close it here.</p><div class="ak-list">${disputes.map(d => `<div class="ak-row" style="grid-template-columns:1fr auto;cursor:default"><div class="ak-t">${h(d.what)} <span>· ${h(d.name)} (${h(d.emp || '')})</span></div><button class="btn small outline" data-dc="${h(d.id)}" type="button" style="grid-row:1/3;grid-column:2">Close</button><div class="ak-m" style="grid-column:1">"${h(d.remark || '')}" · ${h(dmy(d.at))}</div></div>`).join('')}</div>` : '<p class="hint">Nobody has said "Not received".</p>') + `<div style="margin-top:12px"><button class="btn outline" id="ak-close" type="button">Close</button></div>`;
        body.querySelectorAll('[data-dc]').forEach(b => b.onclick = async () => { const { error: e2 } = await sb.rpc('fh_ack_dispute_close', { p_id: b.dataset.dc }); if (e2) { say(em(e2)); return; } disputes.splice(disputes.findIndex(d => d.id === b.dataset.dc), 1); paint(); });
      } else {
        const first = items.find(x => st.sel.has(key(x)));
        body.innerHTML = tabs + (!S.force_enabled ? '<p class="hint" style="color:#c0392b">Force acknowledge is switched OFF (⚙ Settings).</p>' : '') + `
          <p class="hint">Requests that were resolved and tools that were issued, still waiting for the rider. You can force acknowledge only after <b>${h(S.min_hours)} hours</b>${S.auto_enabled ? ` · automatic after <b>${h(S.auto_hours)} hours</b> is ON` : ''}.</p>
          <div class="ak-bar"><input type="search" id="ak-q" placeholder="Search rider, Employee ID, item or handler…" value="${h(st.q)}">
            <label><input type="checkbox" id="ak-ready"${st.ready ? ' checked' : ''}> Ready only (${ready.length})</label>
            <label><input type="checkbox" id="ak-all"> Select all shown</label></div>
          <div class="ak-list">${list.map(x => `<label class="ak-row${x.wait ? ' off' : ''}"><input type="checkbox" data-k="${key(x)}"${st.sel.has(key(x)) ? ' checked' : ''}${x.wait || !S.force_enabled ? ' disabled' : ''}>
            <div class="ak-t">${h(x.what)} <span>· ${h(x.name)}${x.emp ? ' (' + h(x.emp) + ')' : ''}</span></div>
            <span class="ak-chip ${x.wait ? 'wait' : 'ok'}">${x.wait ? 'Wait ' + h(x.wait) + ' h' : 'Ready'}</span>
            <div class="ak-m">${x.kind === 'req' ? 'Request resolved' : 'Tool issued'} ${h(ago(x.hours))} · ${h(dmy(x.since))}${x.handler ? ' · Handler: ' + h(x.handler) : ''}</div></label>`).join('') || '<p class="hint" style="padding:12px">Nothing here.</p>'}</div>
          ${first ? `<div class="ak-prev"><b>What ${st.sel.size === 1 ? 'the rider gets' : 'each rider gets'}</b> (example: ${h(first.name)})
            <div style="margin-top:6px"><b>📱 App & phone notification:</b> ${h(first.what)} marked as received<pre>${h(ackText(first.what, first.since, false))}</pre></div>
            <div style="margin-top:8px"><b>✉ E-mail</b> (to the e-mail he saved) — subject: ${h(first.what)} marked as received<pre>Dear ${h(first.name)},\n\n${h(first.what)} was issued to you on ${h(dmy(first.since))} and your acknowledgement was pending. Now we considered this as acknowledged.\n\nThe related request in the FieldHub portal has been closed.\n\nPlease contact your supervisor or add your remarks on this request in the FieldHub portal within the next 2 hours if you have any concern or if you have not received the item.\n\nRegards,\nFieldHub, Home Sampling</pre></div></div>` : ''}
          <div id="ak-confirm"></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn" id="ak-go" type="button"${st.sel.size && S.force_enabled ? '' : ' disabled'}>Force acknowledge (${st.sel.size})</button><button class="btn outline" id="ak-close" type="button">Close</button></div>`;
        const qi = document.getElementById('ak-q'); qi.oninput = () => { st.q = qi.value.trim().toLowerCase(); const pos = qi.selectionStart; paint(); const n = document.getElementById('ak-q'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (_e) {} };
        document.getElementById('ak-ready').onchange = (e) => { st.ready = e.target.checked; paint(); };
        const all = document.getElementById('ak-all'); const can = list.filter(x => !x.wait);
        all.checked = can.length > 0 && can.every(x => st.sel.has(key(x)));
        all.onchange = () => { can.forEach(x => all.checked ? st.sel.add(key(x)) : st.sel.delete(key(x))); paint(); };
        body.querySelectorAll('input[data-k]').forEach(c => c.onchange = () => { c.checked ? st.sel.add(c.dataset.k) : st.sel.delete(c.dataset.k); paint(); });
        document.getElementById('ak-go').onclick = () => {
          const box = document.getElementById('ak-confirm');
          box.innerHTML = `<div class="ak-prev" style="background:#fff6e5;border-color:#e8c97a"><b>Force acknowledge ${st.sel.size} item${st.sel.size === 1 ? '' : 's'}?</b><div class="hint" style="margin:4px 0 8px">The requests are closed, the tools show as Acknowledged, and each rider gets the notice above in the app, on the phone and by e-mail. Only Revert can undo it.</div><button class="btn" id="ak-yes" type="button">Yes, force acknowledge</button> <button class="btn outline" id="ak-no" type="button">No</button></div>`;
          document.getElementById('ak-no').onclick = () => { box.innerHTML = ''; };
          document.getElementById('ak-yes').onclick = async () => {
            const req = [], iss = []; st.sel.forEach(k => { const [t, id] = [k.slice(0, 3), k.slice(4)]; (t === 'req' ? req : iss).push(id); });
            const y = document.getElementById('ak-yes'); y.disabled = true; y.textContent = 'Working…';
            const { data: r, error: e2 } = await sb.rpc('fh_force_ack_v2', { p_request_ids: req, p_issuance_ids: iss });
            if (e2) { say('Could not do this: ' + em(e2)); y.disabled = false; y.textContent = 'Yes, force acknowledge'; return; }
            let mail = '';
            try { const ses = (await sb.auth.getSession()).data.session; const m = await fhOtp('force_ack_email', { access_token: ses && ses.access_token, items: (r && r.items) || [] });
              mail = m.ok ? ` ${m.sent} e-mail(s) sent${m.skipped ? ', ' + m.skipped + ' rider(s) have no e-mail saved' : ''}.` : ' E-mail not sent: ' + (m.error || 'unknown problem'); } catch (_e) { mail = ' E-mail not sent.'; }
            const ref = (r && r.refused) || [];
            say(`Done. ${(r && r.requests_closed) || 0} request(s) closed, ${(r && r.notified) || 0} notice(s) sent.` + mail + (ref.length ? ` ${ref.length} refused (too early).` : ''));
            if (ref.length) alert('Not done — too early:\n' + ref.map(x => `${x.what} · ${x.name}: ${x.msg}`).join('\n'));
            done();
          };
        };
      }
      body.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { st.tab = b.dataset.t; paint(); });
      const c = document.getElementById('ak-close'); if (c) c.onclick = () => closeModal();
    };
    paint();
  };

  // =====================================================================================
  // 2. Rider prompt: Received / Not received
  // =====================================================================================
  const G = { uid: null, at: 0, busy: false };
  async function riderGate(force) {
    if (typeof state === 'undefined' || !state.user || !state.profile || state.profile.role !== 'rider' || G.busy) return;
    if (document.getElementById('ak-gate') || document.getElementById('fr-bike-gate') || document.getElementById('fh-email-gate')) return;
    if (window.fhOffline && fhOffline.isOffline && fhOffline.isOffline()) return;
    if (G.uid !== state.user.id) { G.uid = state.user.id; G.at = 0; }
    if (!force && Date.now() - G.at < 30 * 60000) return;
    G.busy = true; G.at = Date.now();
    try {
      const { data, error } = await sb.rpc('fh_my_pending_acks');
      if (error || !data || !data.prompt || !(data.items || []).length) return;
      css(); showGate(data.items);
    } catch (_e) {} finally { G.busy = false; }
  }
  function showGate(items) {
    const o = document.createElement('div'); o.id = 'ak-gate'; o.className = 'modal-overlay ak-gate'; o.style.zIndex = 99990;
    const left = new Map(items.map(x => [x.kind + ':' + x.id, x]));
    const paint = () => {
      if (!left.size) { o.remove(); say('Thank you — all answered'); return; }
      o.innerHTML = `<div class="modal"><h2>📦 Please confirm what you received</h2>
        <p class="hint">These were given to you. Please tell us if you <b>received</b> them. You can use FieldHub after answering.</p>
        ${[...left.values()].map(x => `<div class="ak-item" data-i="${h(x.kind + ':' + x.id)}"><b>${h(x.what)}</b><div class="hint" style="margin:2px 0 0">${x.kind === 'req' ? 'Your request was marked resolved' : 'Issued to you'} on ${h(dmy(x.since))}${x.handler ? ' by ' + h(x.handler) : ''}</div>
          <div class="ak-btns"><button class="btn small success" data-yes type="button">✓ Received</button><button class="btn small outline" data-no type="button" style="color:#c0392b">✗ Not received</button></div></div>`).join('')}
        ${left.size > 1 ? '<button class="btn outline" id="ak-allyes" type="button" style="width:100%;margin-top:6px">✓ I received all of them</button>' : ''}
        <button class="btn outline" id="ak-out" type="button" style="width:100%;margin-top:8px">Sign out</button></div>`;
      o.querySelectorAll('.ak-item').forEach(card => {
        const k = card.dataset.i, x = left.get(k);
        card.querySelector('[data-yes]').onclick = async (e) => { e.target.disabled = true; const { error } = await sb.rpc('fh_rider_ack', { p_kind: x.kind, p_id: x.id, p_received: true, p_remark: null }); if (error) { say(em(error)); e.target.disabled = false; return; } left.delete(k); paint(); };
        card.querySelector('[data-no]').onclick = () => {
          if (card.querySelector('textarea')) return;
          card.insertAdjacentHTML('beforeend', `<textarea placeholder="What did you not receive? (short remark)"></textarea><button class="btn small" data-send type="button" style="margin-top:6px">Send "Not received"</button>`);
          card.querySelector('[data-send]').onclick = async (e) => { const t = card.querySelector('textarea').value.trim(); if (!t) { say('Please write a short remark'); return; } e.target.disabled = true; const { error } = await sb.rpc('fh_rider_ack', { p_kind: x.kind, p_id: x.id, p_received: false, p_remark: t }); if (error) { say(em(error)); e.target.disabled = false; return; } say('Sent to your handler'); left.delete(k); paint(); };
        };
      });
      const a = o.querySelector('#ak-allyes');
      if (a) a.onclick = async () => { if (!confirm('Confirm that you received all ' + left.size + ' items?')) return; a.disabled = true; for (const [k, x] of [...left]) { const { error } = await sb.rpc('fh_rider_ack', { p_kind: x.kind, p_id: x.id, p_received: true, p_remark: null }); if (error) { say(em(error)); break; } left.delete(k); } paint(); };
      o.querySelector('#ak-out').onclick = () => { try { doLogout(); } catch (_e) { sb.auth.signOut().then(() => location.reload()); } o.remove(); };
    };
    document.body.appendChild(o); paint();
  }

  // =====================================================================================
  // 3. Super Admin: e-mails for automatic force acknowledgements
  // =====================================================================================
  const M = { uid: null };
  async function autoEmails() {
    if (typeof state === 'undefined' || !state.user || !state.profile || state.profile.role !== 'super_admin' || M.uid === state.user.id) return;
    M.uid = state.user.id;
    try {
      const { data, error } = await sb.rpc('fh_ack_email_take');
      if (error || !data || !data.length) return;
      const ses = (await sb.auth.getSession()).data.session;
      const m = await fhOtp('force_ack_email', { access_token: ses && ses.access_token, items: data });
      say(m.ok ? `Automatic force acknowledge: ${m.sent} e-mail(s) sent to riders.` : 'Automatic force acknowledge: e-mails could not be sent (' + (m.error || 'unknown') + ').');
    } catch (_e) {}
  }

  setInterval(() => { riderGate(false); autoEmails(); }, 4000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') riderGate(false); });

  // =====================================================================================
  // 4. Requests: details in a side panel
  // =====================================================================================
  let open = null;
  function closeDrawer() {
    const d = document.getElementById('rq-drawer'), bg = document.getElementById('rq-drawer-bg');
    if (open && open.more && open.card.isConnected) { open.more.setAttribute('hidden', ''); open.card.appendChild(open.more); open.card.classList.remove('open'); }
    open = null;
    if (d) { d.classList.remove('on'); setTimeout(() => d.remove(), 260); }
    if (bg) { bg.classList.remove('on'); setTimeout(() => bg.remove(), 220); }
    document.removeEventListener('keydown', onKey);
  }
  const onKey = (e) => { if (e.key === 'Escape' && !document.getElementById('active-modal')) closeDrawer(); };
  function openDrawer(card) {
    css(); if (open) closeDrawer();
    const more = card.querySelector('.rq-more'); if (!more) return;
    const title = (card.querySelector('.rq-title') || {}).textContent || 'Request';
    const badge = card.querySelector('.rq-top .badge'), sub = card.querySelector('.rq-sub');
    const bg = document.createElement('div'); bg.id = 'rq-drawer-bg'; bg.onclick = closeDrawer;
    const d = document.createElement('div'); d.id = 'rq-drawer'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', title);
    d.innerHTML = `<div class="dh"><button class="x" type="button" aria-label="Close">×</button><h3>${h(title)} ${badge ? badge.outerHTML : ''}</h3><div class="sub">${sub ? sub.innerHTML : ''}</div><div class="acts"></div></div><div class="db"></div>`;
    // the action buttons stay on the card (their handlers live there); the panel shows copies that press the real ones
    const acts = d.querySelector('.acts');
    card.querySelectorAll('.rq-btns .btn').forEach(b => { if (b.hasAttribute('data-rq-open')) return; const c = b.cloneNode(true); c.removeAttribute('id'); c.onclick = (e) => { e.preventDefault(); closeDrawer(); b.click(); }; acts.appendChild(c); });
    d.querySelector('.x').onclick = closeDrawer;
    more.removeAttribute('hidden'); d.querySelector('.db').appendChild(more);
    card.classList.add('open');
    document.body.appendChild(bg); document.body.appendChild(d);
    requestAnimationFrame(() => { bg.classList.add('on'); d.classList.add('on'); });
    open = { card, more };
    if (!card.dataset.loaded && typeof loadThread === 'function') { card.dataset.loaded = 1; loadThread(card.dataset.rid); }
    document.addEventListener('keydown', onKey);
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-rq-open]');
    if (!b) return;
    const card = b.closest('.card.rq'); if (!card) return;
    e.preventDefault(); e.stopImmediatePropagation();
    openDrawer(card);
  }, true);
  // close the panel when the page changes or the list is drawn again
  window.addEventListener('hashchange', closeDrawer);
  new MutationObserver(() => { if (open && !open.card.isConnected) closeDrawer(); }).observe(document.body, { childList: true, subtree: true });
  window.fhCloseRequestPanel = closeDrawer;
})();

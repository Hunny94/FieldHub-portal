/* FieldHub Assistant — a free, rule-based chat helper (no AI service, no cost).
   It answers by running the SAME database reads the portal pages already use, so it can only
   ever show what the signed-in person is already allowed to see (row-level security does the filtering).
   Needs app.js (globals: sb, state, escapeHtml, toLocalPhone, toE164, ROLE_LABEL, getAllowedViews, navigateTo ...). */
(function () {
  'use strict';
  const A = { open: false, msgs: [], pending: null, uid: null, busy: false, tools: null, ready: false, sid: '', qq: null };
  const esc = (s) => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s));
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9؀-ۿ\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const squash = (s) => norm(s).replace(/\s/g, '');
  const clean = (s) => String(s || '').replace(/[%,()*\\]/g, ' ').replace(/\s+/g, ' ').trim();
  const allowed = (v) => { try { return getAllowedViews().includes(v); } catch (_) { return false; } };
  const isRiderRole = () => state.profile && state.profile.role === 'rider';
  const todayMid = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const daysFrom = (iso) => Math.round((new Date(String(iso).slice(0, 10) + 'T00:00:00') - todayMid()) / 86400000);
  const fdate = (iso) => (iso ? formatDate(iso) : '—');
  const STOP = new Set('the a an is are was were be to of in on at for me my i we you your do does did can could would should will am it its this that these those and or but with without from by about please tell show give list what which who whom when where how many much any some all there here also just only than then have has had get got want need know find search look check let us our mera meri mere hai hain ka ki ke ko se me kya kab kaun kon kitne kitna wala wali'.split(' '));
  const words = (t) => norm(t).split(' ').filter((w) => w.length > 2 && !STOP.has(w));
  const has = (t, re) => re.test(t);

  // ---------- small HTML builders ----------
  const btn = (label, attrs) => `<button type="button" class="fb-link" ${attrs}>${esc(label)}</button>`;
  const goBtn = (label, view) => btn(label, `data-go="${view}"`);
  const note = (s) => `<div class="fb-dim">${s}</div>`;
  const noAccess = (what) => `You don't have access to <b>${esc(what)}</b>, so I can't look that up. Please ask your supervisor if you need it.`;
  function personRow(p) {
    const ph = p.phone || p.official_mobile || '';
    const loc = ph ? toLocalPhone(ph) : '';
    const digits = ph ? String(toE164(ph) || '').replace(/\D/g, '') : '';
    return `<div class="fb-person"><div><b>${esc(p.full_name || '—')}</b> <span class="fb-dim">${esc(p.employee_id || '')}</span>
      <div class="fb-dim">${esc(ROLE_LABEL[p.role] || '')}${p.region_name ? ' · ' + esc(p.region_name) : ''}${p.hotspot ? ' · ' + esc(p.hotspot) : ''}${p.day_off ? ' · Day off: ' + esc(p.day_off) : ''}</div></div>
      ${loc ? `<div class="fb-act"><a href="tel:${esc(loc)}">📞 ${esc(loc)}</a>${digits ? `<a href="https://wa.me/${digits}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</div>` : '<div class="fb-dim">No number on file</div>'}</div>`;
  }
  const regionName = (id) => ((state.regions || []).find((r) => r.id === id) || {}).name || '';

  // ---------- data helpers ----------
  async function myRoster() {
    const { data } = await sb.from('roster_entries').select('*').eq('rider_id', state.user.id).neq('status', 'removed').order('created_at', { ascending: false }).limit(1);
    return (data && data[0]) || null;
  }
  async function getTools() {
    if (A.tools) return A.tools;
    let list = [];
    try { const r = await sb.from('tool_types').select('id, name, reissue_basis, interval_months').eq('active', true).order('name'); list = r.data || []; } catch (_) {}
    if (!list.length) {   // some logins cannot read the tool list: fall back to the tools in their own history
      try { const r = await sb.from('tool_issuances').select('tool_type_id, tool_types(id, name, reissue_basis, interval_months)').eq('rider_id', state.user.id); const m = new Map(); (r.data || []).forEach((x) => { if (x.tool_types) m.set(x.tool_types.id || x.tool_type_id, { ...x.tool_types, id: x.tool_types.id || x.tool_type_id }); }); list = [...m.values()]; } catch (_) {}
    }
    A.tools = list; return list;
  }
  // "rain coat", "raincoat" and "Rain-Coat" all match a tool called "Rain Coat"
  function toolMentioned(t, name) {
    const q = squash(t), n = squash(name);
    if (!n) return false;
    if (q.includes(n)) return true;
    return norm(name).split(' ').filter((w) => w.length >= 4).some((w) => q.includes(w.replace(/s$/, '')));
  }
  async function findPerson(q) {
    const s = clean(q); if (!s) return [];
    let r = await sb.from('profiles').select('id, full_name, employee_id, phone, role, region_id').eq('employee_id', s).limit(5);
    if (r.data && r.data.length) return r.data;
    r = await sb.from('profiles').select('id, full_name, employee_id, phone, role, region_id').ilike('full_name', '%' + s + '%').eq('status', 'active').limit(6);
    return r.data || [];
  }

  // ---------- intents ----------
  function detect(raw) {
    const t = norm(raw);
    if (!t) return 'empty';
    if (/^(hi|hello|hey|salam|assalam|aoa|help|menu|start)\b|what can you do|kya kar sakte/.test(t)) return 'help';
    if (/\b(thanks|thank you|shukriya|jazak|ok thanks)\b/.test(t)) return 'thanks';
    if (/expir|vial|reagent|near expiry|shelf life/.test(t)) return 'expiry';
    if (/(coordinates?|lat(itude)?\b|long(itude)?\b|location|map|where is|pin)/.test(t) && /(hot ?spot|rider|\b\d{4,}\b|region|city|sub ?region|area)/.test(t) && !/same (area|spot)/.test(t)) return 'hscoord';
    if (/hot ?spot|same (area|spot|location)|colleague|team ?mate|who (works|is working) (in|at|with)|riders? (in|at|of) /.test(t)) return 'hotspot';
    if (/(incharge|in charge|supervisor|coordinator|\bpoc\b|team lead|manager|\bboss\b)/.test(t) && /(who|contact|number|phone|kaun|kon|call|reach)/.test(t)) return 'supervisor';
    if (/eligib|entitle|can i get|am i allowed|milega|mil sakta|re ?issue|replace|last (issued|issuance)|when (was|did) i (get|receive)|issued/.test(t)) return 'eligibility';
    if (/\b(my )?(requests?|tickets?|complaints?)\b/.test(t)) return 'requests';
    if (/\btasks?\b|to ?do|assigned to me|\bkaam\b/.test(t)) return 'tasks';
    if (/circular|notice|announcement/.test(t)) return 'circulars';
    if (/field visit|visit score|my visit|checklist|audit/.test(t)) return 'fieldvisit';
    if (/\bmy (roster|shift|day ?off|region|duty|profile|schedule)\b|\bday ?off\b|off day|chutti/.test(t)) return 'myinfo';
    if (/how (to|do|can)|procedure|\bsop\b|steps|guideline|policy|protocol|what is|kaise|process|rule/.test(t)) return 'kb';
    return 'other';
  }

  // ----- hotspot -----
  function hotspotNameFrom(raw) {
    let m = raw.match(/hot\s?spot\s*(?:is|=|:|of|in|at|named|name)?\s*(.+)$/i) || raw.match(/\b(?:riders?|people|users|colleagues|who)\b.*?\b(?:in|at|of|from|near)\s+(.+)$/i);
    if (!m) return null;
    let n = m[1].split(/[,?!;]| who | and | jo | kon | kaun /i)[0];
    n = n.replace(/^(?:my|the|same|as|me|mine|is|hai|ka|ki)\s+/i, '').replace(/\b(?:please|plz|has|have|also|else)\b.*$/i, '').trim();
    n = n.replace(/^(?:as me|same as me|me|mine|same)$/i, '');
    return n.length >= 3 ? n : null;
  }
  async function hotspot(raw) {
    if (!allowed('roster') && !allowed('hierarchy')) return noAccess('Roster');
    const name = hotspotNameFrom(raw);
    const mine = await myRoster();
    const myHot = mine && mine.hotspot ? mine.hotspot : '';
    const wantsOther = name && (!myHot || squash(myHot) !== squash(name) && !squash(myHot).includes(squash(name)) && !squash(name).includes(squash(myHot)));
    // a rider sees only the people who share his / her own hotspot
    if (isRiderRole()) {
      if (!myHot) return 'Your roster entry has no hotspot yet. Please ask your supervisor to add it, then ask me again.';
      if (wantsOther) return `For privacy, riders can only see colleagues who share their <b>own</b> hotspot. Your hotspot is <b>${esc(myHot)}</b>. Ask me <i>“who has the same hotspot as me?”</i>`;
      const r = await sb.rpc('fh_hotspot_mates');
      if (r.error) return /function|schema cache|does not exist/i.test(r.error.message || '') ? 'This feature is almost ready: the admin still needs to run <b>migration_51.sql</b> in Supabase.' : 'I could not read that just now: ' + esc(r.error.message);
      const rows = r.data || [];
      if (!rows.length) return `You are in <b>${esc(myHot)}</b>. I could not find any other active rider there.`;
      return `<b>${rows.length}</b> other ${rows.length === 1 ? 'person' : 'people'} in your hotspot <b>${esc(myHot)}</b>:` + rows.slice(0, 40).map(personRow).join('') + (rows.length > 40 ? note('…and ' + (rows.length - 40) + ' more.') : '');
    }
    // supervisors / admins: any hotspot inside their own access
    const target = name || myHot;
    if (!target) { A.pending = 'hotspot'; return 'Which hotspot? For example: <i>Wapda Town</i>.'; }
    const { data, error } = await sb.from('roster_entries').select('hotspot, day_off, official_mobile, regions(name), profiles!rider_id(full_name, employee_id, phone, role, status)').neq('status', 'removed').ilike('hotspot', '%' + clean(target) + '%').limit(80);
    if (error) return 'I could not read the roster: ' + esc(error.message);
    const rows = (data || []).filter((x) => x.profiles && x.profiles.status === 'active').map((x) => ({ ...x.profiles, official_mobile: x.official_mobile, hotspot: x.hotspot, day_off: x.day_off, region_name: x.regions && x.regions.name }));
    if (!rows.length) {
      let sugg = [];
      try { const first = words(target)[0] || clean(target).slice(0, 4); const h = await sb.from('hotspots').select('name').ilike('name', '%' + first + '%').limit(6); sugg = (h.data || []).map((x) => x.name); } catch (_) {}
      A.pending = 'hotspot';
      return `I found nobody in a hotspot like “${esc(target)}”.` + (sugg.length ? ' Did you mean: ' + sugg.map((s) => btn(s, `data-say="riders in ${esc(s)}"`)).join(' ') : ' Please check the spelling.');
    }
    return `<b>${rows.length}</b> active ${rows.length === 1 ? 'person' : 'people'} in “${esc(target)}”:` + rows.slice(0, 40).map(personRow).join('') + (rows.length > 40 ? note('…and ' + (rows.length - 40) + ' more. Open the Roster for the full list.') : '');
  }

  // ----- hotspot coordinates (by hotspot / region / city / rider name or id) -----
  const mapLink = (h) => `<a href="https://www.google.com/maps?q=${h.lat},${h.lng}" target="_blank" rel="noopener">📍 Open map</a>`;
  function coordRow(h) {
    const has = h.lat != null && h.lng != null;
    return `<div class="fb-line"><b>${esc(h.name)}</b><div class="fb-dim">${esc([h.regions && h.regions.name, h.sub_regions && h.sub_regions.name].filter(Boolean).join(' · '))}</div>` +
      (has ? `<div class="fb-dim">${Number(h.lat).toFixed(5)}, ${Number(h.lng).toFixed(5)}</div><div class="fb-act">${mapLink(h)}</div>` : '<div class="fb-dim">Coordinates not added yet</div>') + '</div>';
  }
  async function hsCoord(raw) {
    if (!allowed('roster') && !allowed('hierarchy')) return noAccess('Roster');
    const all = await sb.from('hotspots').select('name, lat, lng, regions(name), sub_regions(name)').limit(1500);
    if (all.error) return /lat|column/i.test(all.error.message || '') ? 'Hotspot coordinates are not set up yet: the admin needs to run <b>migration_54.sql</b>.' : 'I could not read hotspots: ' + esc(all.error.message);
    const list = all.data || [];
    const kw = words(raw).filter((w) => !/^(coordinates?|latitude|longitude|location|locations|map|hotspots?|where|pin|riders?|rider|city|region|sub|area|lat|long|lng|located|find|show)$/.test(w));
    const t = norm(raw);
    // rider by employee id or name -> his / her hotspot
    const idm = raw.match(/\b(\d{4,})\b/);
    let rows = [];
    if (idm || (kw.length && !list.some((h) => kw.some((w) => norm(h.name + ' ' + (h.regions && h.regions.name) + ' ' + (h.sub_regions && h.sub_regions.name)).includes(w))))) {
      const people = await findPerson(idm ? idm[1] : kw.join(' '));
      if (people.length) {
        const out = [];
        for (const p of people.slice(0, 4)) {
          const r = await sb.from('roster_entries').select('hotspot, region_id').eq('rider_id', p.id).neq('status', 'removed').order('created_at', { ascending: false }).limit(1);
          const hs = r.data && r.data[0] && r.data[0].hotspot;
          const h = hs && list.find((x) => squash(x.name) === squash(hs));
          out.push(`<div class="fb-h">${esc(p.full_name)} ${esc(p.employee_id || '')}</div>` + (h ? coordRow(h) : `<div class="fb-line">${hs ? 'Hotspot <b>' + esc(hs) + '</b> has no coordinates yet.' : 'No hotspot on the roster.'}</div>`));
        }
        return out.join('');
      }
    }
    rows = list.filter((h) => !kw.length || kw.every((w) => norm(h.name + ' ' + (h.regions && h.regions.name) + ' ' + (h.sub_regions && h.sub_regions.name)).includes(w)));
    if (!rows.length) return `I could not find a hotspot, region, city or rider matching “${esc(kw.join(' '))}”.`;
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return `<b>${rows.length}</b> hotspot${rows.length === 1 ? '' : 's'}${kw.length ? ' for “' + esc(kw.join(' ')) + '”' : ''}:` + rows.slice(0, 15).map(coordRow).join('') + (rows.length > 15 ? note('…and ' + (rows.length - 15) + ' more. Narrow it by region or city.') : '');
  }

  // ----- supervisors -----
  async function supervisor() {
    if (!allowed('hierarchy') && !allowed('roster')) return noAccess('My Team & Supervisors');
    const dir = await sb.rpc('fh_team_directory');
    if (dir.error || !Array.isArray(dir.data)) return 'I could not load the team list just now. ' + goBtn('Open My Team', 'hierarchy');
    const me = dir.data.find((p) => p.id === state.user.id);
    let regs = (me && me.region_ids) || (state.profile.region_id ? [state.profile.region_id] : []);
    const m = await myRoster().catch(() => null); if (m && m.region_id && !regs.includes(m.region_id)) regs = [...regs, m.region_id];
    const roles = ['team_lead', 'coordinator', 'regional_poc'];
    const list = dir.data.filter((p) => roles.includes(p.role) && (Array.isArray(p.region_ids) ? p.region_ids.some((r) => regs.includes(r)) : false));
    if (!list.length) return 'I could not match you to a supervisor yet. ' + goBtn('Open My Team', 'hierarchy');
    const out = [];
    roles.forEach((r) => { const g = list.filter((p) => p.role === r); if (g.length) out.push(`<div class="fb-h">${esc(ROLE_LABEL[r])}</div>` + g.map(personRow).join('')); });
    return 'Your supervisors:' + out.join('');
  }

  // ----- tool eligibility (last issuance via Tool Issuance AND Requests) -----
  async function eligibility(raw) {
    if (!allowed('tools') && !allowed('requests')) return noAccess('Tool Issuance');
    const t = norm(raw);
    let riderId = state.user.id, riderLabel = '';
    if (!isRiderRole()) {   // supervisors may ask "is <name or employee id> eligible for rain coat"
      const m = raw.match(/\b(?:for|of)\s+(.+?)(?:\s+(?:for|to|get)\b.*)?[?.!]*$/i);
      const who = m && m[1] && !/^(me|myself|my|a|an|the)\b/i.test(m[1]) ? m[1] : null;
      if (who) {
        const people = await findPerson(who.replace(/\b(rain ?coat|coat|jacket|bag|helmet|uniform)\b/ig, ''));
        if (people.length === 1) { riderId = people[0].id; riderLabel = people[0].full_name + (people[0].employee_id ? ' (' + people[0].employee_id + ')' : ''); }
        else if (people.length > 1) return 'I found several people. Please type the Employee ID:' + people.map((p) => `<div class="fb-person"><div><b>${esc(p.full_name)}</b> <span class="fb-dim">${esc(p.employee_id || '')}</span></div></div>`).join('');
      }
    }
    const tools = await getTools();
    const hit = tools.filter((x) => toolMentioned(t, x.name));
    if (!hit.length) {
      A.pending = 'eligibility';
      return tools.length ? 'Which item do you mean?<div class="fb-chips2">' + tools.slice(0, 12).map((x) => btn(x.name, `data-say="Am I eligible for ${esc(x.name)}?"`)).join('') + '</div>' : 'Which item do you mean? Please type its name, for example <i>rain coat</i>.';
    }
    const tt = hit[0];
    const [iss, req] = await Promise.all([
      sb.from('tool_issuances').select('*').eq('rider_id', riderId).eq('tool_type_id', tt.id).order('issued_date', { ascending: false }).limit(3),
      (async () => { const key = words(tt.name).sort((a, b) => b.length - a.length)[0] || squash(tt.name); const k = clean(key); return sb.from('requests').select('id, category, description, status, created_at').eq('rider_id', riderId).is('deleted_at', null).or(`category.ilike.%${k}%,description.ilike.%${k}%`).order('created_at', { ascending: false }).limit(3); })()
    ]);
    const last = (iss.data || [])[0], reqs = req.data || [];
    const who = riderLabel ? `<b>${esc(riderLabel)}</b>: ` : '';
    let verdict;
    if (!last) verdict = `✅ <b>No ${esc(tt.name)} has been issued ${riderLabel ? 'to this person' : 'to you'} on record</b>, so ${riderLabel ? 'they are' : 'you are'} eligible. Raise a request if you need one.`;
    else {
      const basis = tt.reissue_basis;
      const ago = Math.abs(daysFrom(last.issued_date));
      const head = `Last issued on <b>${fdate(last.issued_date)}</b> (${ago} day${ago === 1 ? '' : 's'} ago).`;
      if (basis === 'wear_tear' || basis === 'after_review' || !last.next_due_date) verdict = `${head}<br>🔎 There is <b>no fixed re-issue date</b> for ${esc(tt.name)}: it is replaced on wear &amp; tear / after review by the supervisor.`;
      else {
        const left = daysFrom(last.next_due_date);
        verdict = left > 0 ? `${head}<br>❌ <b>Not eligible yet.</b> Next eligible on <b>${fdate(last.next_due_date)}</b> (in ${left} day${left === 1 ? '' : 's'}).` : `${head}<br>✅ <b>Eligible now</b> (re-issue was due on ${fdate(last.next_due_date)}).`;
      }
    }
    const pend = reqs.find((r) => ['open', 'in_progress'].includes(r.status));
    const rq = reqs.length ? '<div class="fb-h">Related requests</div>' + reqs.map((r) => `<div class="fb-line">${fdate(r.created_at)} · ${esc(r.category || '')} · <b>${esc(String(r.status || '').replace('_', ' '))}</b></div>`).join('') : '';
    return `${who}${verdict}${pend ? '<br>⏳ A request for this is already <b>' + esc(pend.status.replace('_', ' ')) + '</b>.' : ''}${rq}<div class="fb-acts">${goBtn('Open Tool Issuance', 'tools')} ${goBtn('Open Requests', 'requests')}</div>`;
  }

  // ----- expiry -----
  async function expiry(raw) {
    if (!allowed('expiries')) return noAccess('Expiry Tracker');
    const t = norm(raw);
    let win = 30;
    const dm = t.match(/(\d{1,3})\s*(day|days|din)/); if (dm) win = Math.min(365, +dm[1]);
    else if (/week/.test(t)) win = 7; else if (/(2|two) months?/.test(t)) win = 60; else if (/month/.test(t)) win = 30; else if (/year/.test(t)) win = 365;
    const kw = words(raw).filter((w) => !/^(vials?|expir\w*|soon|items?|going|next|month|months|week|weeks|days?|year|within|near|reagents?|list|due|shelf|life)$/.test(w));
    const { data, error } = await sb.from('expiry_items').select('*').is('deleted_at', null).order('expiry_date');
    if (error) return 'I could not read the expiry list: ' + esc(error.message);
    const seen = new Set(), rows = [];
    (data || []).forEach((x) => {
      if (x.status === 'closed') return;
      const label = [x.item_type, x.item_label].filter(Boolean).join(' — ');
      if (kw.length && !kw.some((w) => norm(label).includes(w))) return;
      const k = x.group_id ? x.group_id + '|' + x.expiry_date : label + '|' + x.expiry_date;
      if (seen.has(k)) return; seen.add(k);
      const d = daysFrom(x.expiry_date);
      if (d <= win) rows.push({ label, d, date: x.expiry_date, region: regionName(x.region_id) });
    });
    if (!rows.length) return `✅ Nothing${kw.length ? ' matching “' + esc(kw.join(' ')) + '”' : ''} expires in the next <b>${win} days</b>.<div class="fb-acts">${goBtn('Open Expiry Tracker', 'expiries')}</div>`;
    const over = rows.filter((r) => r.d < 0).length;
    return `<b>${rows.length}</b> item${rows.length === 1 ? '' : 's'} ${rows.length === 1 ? 'expires' : 'expire'} within <b>${win} days</b>${over ? ` (${over} already expired)` : ''}:` + rows.slice(0, 12).map((r) => `<div class="fb-line"><b>${esc(r.label)}</b><br><span class="${r.d < 0 ? 'fb-bad' : r.d <= 7 ? 'fb-warn' : ''}">${r.d < 0 ? 'EXPIRED ' + Math.abs(r.d) + ' day' + (Math.abs(r.d) === 1 ? '' : 's') + ' ago' : r.d === 0 ? 'Expires TODAY' : 'in ' + r.d + ' day' + (r.d === 1 ? '' : 's')}</span> · ${fdate(r.date)}${r.region ? ' · ' + esc(r.region) : ''}</div>`).join('') + (rows.length > 12 ? note('…and ' + (rows.length - 12) + ' more.') : '') + `<div class="fb-acts">${goBtn('Open Expiry Tracker', 'expiries')}</div>`;
  }

  // ----- requests / tasks / circulars / visits / my roster -----
  async function requests() {
    if (!allowed('requests')) return noAccess('Requests');
    let q = sb.from('requests').select('id, category, description, status, created_at, rider:profiles!rider_id(full_name)').is('deleted_at', null).order('created_at', { ascending: false }).limit(10);
    if (isRiderRole()) q = q.eq('rider_id', state.user.id); else q = q.in('status', ['open', 'in_progress']);
    const { data, error } = await q; if (error) return 'I could not read requests: ' + esc(error.message);
    if (!data || !data.length) return (isRiderRole() ? 'You have no requests yet.' : 'There are no open requests.') + `<div class="fb-acts">${goBtn('Open Requests', 'requests')}</div>`;
    return (isRiderRole() ? 'Your latest requests:' : 'Open requests you can see:') + data.slice(0, 8).map((r) => `<div class="fb-line"><b>${esc(r.category || 'Request')}</b> · <b>${esc(String(r.status || '').replace('_', ' '))}</b><br>${fdate(r.created_at)}${!isRiderRole() && r.rider ? ' · ' + esc(r.rider.full_name) : ''}<br><span class="fb-dim">${esc(String(r.description || '').slice(0, 90))}</span></div>`).join('') + `<div class="fb-acts">${goBtn('Open Requests', 'requests')}</div>`;
  }
  async function tasks() {
    if (!allowed('tasks')) return noAccess('Tasks');
    const { data, error } = await sb.from('tasks').select('id, title, due_date, status').is('deleted_at', null).eq('assigned_to', state.user.id).in('status', ['pending', 'in_progress']).order('due_date', { ascending: true, nullsFirst: false }).limit(10);
    if (error) return 'I could not read tasks: ' + esc(error.message);
    if (!data || !data.length) return '🎉 You have no pending tasks.';
    return `You have <b>${data.length}</b> open task${data.length === 1 ? '' : 's'}:` + data.map((x) => { const d = x.due_date ? daysFrom(x.due_date) : null; return `<div class="fb-line"><b>${esc(x.title)}</b><br>${x.due_date ? `<span class="${d < 0 ? 'fb-bad' : d <= 2 ? 'fb-warn' : ''}">Due ${fdate(x.due_date)}${d < 0 ? ' (overdue)' : ''}</span>` : 'No due date'}</div>`; }).join('') + `<div class="fb-acts">${goBtn('Open Tasks', 'tasks')}</div>`;
  }
  async function circulars(raw) {
    if (!allowed('circulars')) return noAccess('Circulars');
    const kw = words(raw).filter((w) => !/^(circulars?|notices?|announcements?|latest|new|recent|about)$/.test(w));
    let q = sb.from('circulars').select('id, title, body, created_at').is('deleted_at', null).order('created_at', { ascending: false }).limit(6);
    if (kw.length) q = q.or(kw.map((w) => `title.ilike.%${clean(w)}%,body.ilike.%${clean(w)}%`).join(','));
    const { data, error } = await q; if (error) return 'I could not read circulars: ' + esc(error.message);
    if (!data || !data.length) return 'No circular found' + (kw.length ? ' for “' + esc(kw.join(' ')) + '”' : '') + '.';
    return (kw.length ? 'Circulars about “' + esc(kw.join(' ')) + '”:' : 'Latest circulars:') + data.map((c) => `<div class="fb-line"><b>${esc(c.title)}</b><br><span class="fb-dim">${fdate(c.created_at)} · ${esc(String(c.body || '').replace(/\s+/g, ' ').slice(0, 110))}…</span></div>`).join('') + `<div class="fb-acts">${goBtn('Open Circulars', 'circulars')}</div>`;
  }
  async function fieldvisit() {
    if (!isRiderRole()) return 'Field Visit reports are on the <b>Field Visits</b> pages. ' + (allowed('fv_report') ? goBtn('Open Field Visit report', 'fv_report') : '');
    const { data } = await sb.from('fv_visits').select('visit_date, visit_type, score, issue_count').eq('rider_id', state.user.id).order('visit_date', { ascending: false }).limit(3);
    if (!data || !data.length) return 'I could not find a Field Visit report for you yet.';
    return 'Your latest Field Visit reports:' + data.map((v) => `<div class="fb-line"><b>${fdate(v.visit_date)}</b> · score <b>${esc(v.score)}%</b> · ${esc(v.issue_count || 0)} issue${v.issue_count === 1 ? '' : 's'}</div>`).join('');
  }
  async function myinfo() {
    const r = await myRoster();
    if (!r) return 'I could not find a roster entry for you. ' + (allowed('hierarchy') ? goBtn('Open My Team', 'hierarchy') : '');
    let shift = ''; if (r.shift_id) { try { const s = await sb.from('shift_types').select('name').eq('id', r.shift_id).maybeSingle(); shift = (s.data && s.data.name) || ''; } catch (_) {} }
    return `<div class="fb-line"><b>Region:</b> ${esc(regionName(r.region_id) || '—')}<br><b>Hotspot:</b> ${esc(r.hotspot || '—')}<br><b>Shift:</b> ${esc(shift || '—')}<br><b>Day off:</b> ${esc(r.day_off || '—')}</div>`;
  }

  // ----- Knowledge Base + circular search (also the fallback for anything else) -----
  async function kb(raw, fallback) {
    const kw = words(raw).slice(0, 4);
    if (!kw.length) return fallback ? help(true) : 'Please tell me a little more, for example <i>how to collect a blood culture sample</i>.';
    const ors = kw.map((w) => `title.ilike.%${clean(w)}%,body.ilike.%${clean(w)}%`).join(',');
    const jobs = [];
    if (allowed('knowledgebase')) {
      jobs.push(sb.from('knowledge_base_articles').select('title, body, created_at').or(ors).limit(20).then((r) => (r.data || []).map((x) => ({ t: 'Article', ...x }))));
      jobs.push(sb.from('circulars').select('title, body, created_at').eq('push_to_kb', true).is('deleted_at', null).or(ors).limit(20).then((r) => (r.data || []).map((x) => ({ t: 'Circular', ...x }))));
    } else if (allowed('circulars')) jobs.push(sb.from('circulars').select('title, body, created_at').is('deleted_at', null).or(ors).limit(20).then((r) => (r.data || []).map((x) => ({ t: 'Circular', ...x }))));
    else return noAccess('Knowledge Base');
    const hits = (await Promise.all(jobs)).flat().map((x) => ({ ...x, s: kw.filter((w) => norm(x.title + ' ' + x.body).includes(w)).length * 2 + kw.filter((w) => norm(x.title).includes(w)).length })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
    if (!hits.length) return fallback ? help(true) : `I could not find anything about “${esc(kw.join(' '))}” in the Knowledge Base.`;
    const snip = (b) => { const s = String(b || '').replace(/\s+/g, ' '), i = Math.max(0, norm(s).indexOf(kw[0])); return esc(s.slice(Math.max(0, i - 30), i + 130)); };
    return `I found this in the Knowledge Base:` + hits.map((h) => `<div class="fb-line"><b>${esc(h.title)}</b> <span class="fb-dim">(${h.t})</span><br><span class="fb-dim">…${snip(h.body)}…</span></div>`).join('') + `<div class="fb-acts">${btn('Open Knowledge Base', `data-go="knowledgebase" data-q="${esc(kw[0])}"`)}</div>`;
  }
  function help(notUnderstood) {
    const r = isRiderRole();
    const ex = r ? ['Who has the same hotspot as me?', 'Am I eligible for a new rain coat?', 'Which vials expire soon?', 'Show my requests', 'Who is my Area Incharge?', 'Latest circulars'] : ['Which vials expire in 15 days?', 'Riders in Wapda Town', 'Open requests', 'Is Ali eligible for rain coat?', 'My tasks', 'Latest circulars'];
    return (notUnderstood ? 'I did not find an answer to that. ' : 'Hello! ') + 'I can look things up for you. Try one of these:' + '<div class="fb-chips2">' + ex.map((e) => btn(e, `data-say="${esc(e)}"`)).join('') + '</div>' + note('I only show what your login is allowed to see.') + (r && notUnderstood && allowed('requests') ? `<div class="fb-acts">${btn('Raise a request instead', 'data-act="newreq"')}</div>` : '');
  }

  // ---------- chat engine ----------
  async function answer(raw) {
    let intent = detect(raw);
    const wc = norm(raw).split(' ').length;
    const pend = A.pending; A.pending = null;   // handlers set it again if they still need an answer
    if (pend && wc <= 6 && (intent === 'other' || intent === pend)) { intent = pend; if (pend === 'hotspot' && !/hot ?spot/i.test(raw)) raw = 'hotspot ' + raw; }
    switch (intent) {
      case 'empty': return help();
      case 'help': return help();
      case 'thanks': return 'You are welcome! 😊 Ask me anything else.';
      case 'expiry': return expiry(raw);
      case 'hotspot': return hotspot(raw);
      case 'hscoord': return hsCoord(raw);
      case 'supervisor': return supervisor();
      case 'eligibility': return eligibility(raw);
      case 'requests': return requests();
      case 'tasks': return tasks();
      case 'circulars': return circulars(raw);
      case 'fieldvisit': return fieldvisit();
      case 'myinfo': return myinfo();
      case 'kb': return kb(raw, false);
      default: {
        // maybe it simply names a tool: "rain coat"
        try { const tools = await getTools(); if (tools.some((x) => toolMentioned(norm(raw), x.name)) && wc <= 6) return eligibility(raw); } catch (_) {}
        return kb(raw, true);
      }
    }
  }
  const plain = (h) => String(h || '').replace(/<br\s*\/?>|<\/div>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  async function logChat(q, html, intent) {
    try {
      if (!A.sid) A.sid = (crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
      const r = await sb.from('chat_logs').insert({ user_id: state.user.id, session_id: A.sid, question: q.slice(0, 500), answer: plain(html).slice(0, 700), intent: intent || null }).select('id').single();
      return r.data && r.data.id;
    } catch (_) { return null; }   // logging must never break the chat
  }
  async function ask(text, fixed) {
    text = String(text || '').trim(); if (!text || A.busy) return;
    push('me', esc(text));
    A.busy = true; typing(true);
    let out, it = detect(text);
    try {
      const off = typeof navigator !== 'undefined' && navigator.onLine === false;
      out = fixed ? esc(fixed).replace(/\n/g, '<br>') : (off ? '📴 <i>You are offline: this answer comes from the last data saved on this phone.</i><br><br>' : '') + await answer(text);
      if (fixed) it = 'quick';
    } catch (e) { console.warn(e); out = 'Sorry, something went wrong while looking that up. Please try again.'; it = 'error'; }
    typing(false); A.busy = false;
    push('bot', out);
    const m = A.msgs[A.msgs.length - 1];
    logChat(text, out, it).then((id) => { if (id && m) { m.lid = id; render(); } });
  }
  async function rate(lid, v) {
    const m = A.msgs.find((x) => x.lid === lid); if (!m || m.fb) return;
    m.fb = v; render();
    try { await sb.from('chat_logs').update({ feedback: v }).eq('id', lid); } catch (_) {}
  }
  async function loadQuick() {
    try {
      const r = await sb.from('chat_quick_questions').select('label, answer, roles, sort_order').eq('active', true).order('sort_order').limit(30);
      A.qq = (r.data || []).filter((q) => !q.roles || !q.roles.length || q.roles.includes(state.profile && state.profile.role));
    } catch (_) { A.qq = []; }
  }
  function startSession() {
    A.msgs = []; A.pending = null; A.sid = '';
    const n = (state.profile && state.profile.full_name || '').split(' ')[0];
    A.msgs.push({ who: 'bot', html: `Hello${n ? ' <b>' + esc(n) + '</b>' : ''}! I am the FieldHub Assistant.<br>I answer from the portal data you have access to. Pick a quick question below or type your own.` });
    render();
  }

  // ---------- UI ----------
  const CSS = `
#fh-bot-btn{position:fixed;right:18px;bottom:76px;z-index:9001;width:54px;height:54px;border-radius:50%;border:0;cursor:pointer;background:var(--ink,#1E2A6E);color:#fff;box-shadow:0 6px 18px rgba(20,28,80,.35);display:none;align-items:center;justify-content:center;font-size:24px}
body.fh-app #fh-bot-btn{display:flex}
#fh-bot-btn:hover{filter:brightness(1.12)}
#fh-bot{position:fixed;right:18px;bottom:140px;z-index:9002;width:380px;max-width:calc(100vw - 24px);height:560px;max-height:calc(100vh - 160px);background:#fff;border:1px solid #d9def0;border-radius:16px;box-shadow:0 14px 40px rgba(20,28,80,.28);display:none;flex-direction:column;overflow:hidden;font-size:14px;color:#1b2150}
#fh-bot.open{display:flex}
#fh-bot .fb-head{background:var(--ink,#1E2A6E);color:#fff;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px}
#fh-bot .fb-head small{display:block;opacity:.8;font-size:11.5px;margin-top:2px}
#fh-bot .fb-x{background:transparent;border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1}
#fh-bot .fb-msgs{flex:1;overflow-y:auto;padding:12px;background:#f5f6fb;display:flex;flex-direction:column;gap:8px}
#fh-bot .fb-m{max-width:92%;padding:9px 12px;border-radius:12px;line-height:1.45;word-wrap:break-word;overflow-wrap:anywhere}
#fh-bot .fb-m.me{align-self:flex-end;background:var(--ink,#1E2A6E);color:#fff;border-bottom-right-radius:4px}
#fh-bot .fb-m.bot{align-self:flex-start;background:#fff;border:1px solid #e1e5f3;border-bottom-left-radius:4px}
#fh-bot .fb-dim{color:#6b7194;font-size:12.5px}
#fh-bot .fb-bad{color:#c0392b;font-weight:700}#fh-bot .fb-warn{color:#b9770e;font-weight:700}
#fh-bot .fb-h{font-weight:700;margin:8px 0 3px;font-size:12.5px;color:#4a527f;text-transform:uppercase;letter-spacing:.03em}
#fh-bot .fb-line{padding:6px 0;border-top:1px solid #edf0f8}
#fh-bot .fb-person{padding:7px 0;border-top:1px solid #edf0f8}
#fh-bot .fb-act{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
#fh-bot .fb-act a{background:#eef1ff;color:#1E2A6E;border-radius:14px;padding:3px 10px;font-size:12.5px;text-decoration:none;font-weight:600}
#fh-bot .fb-link{background:#eef1ff;color:#1E2A6E;border:1px solid #cfd6f5;border-radius:14px;padding:4px 11px;font-size:12.5px;cursor:pointer;margin:3px 4px 0 0;font-weight:600}
#fh-bot .fb-acts,#fh-bot .fb-chips2{margin-top:8px}
#fh-bot .fb-chips{display:flex;gap:6px;overflow-x:auto;padding:8px 10px 0;background:#fff;border-top:1px solid #e1e5f3;scrollbar-width:none}
#fh-bot .fb-chips .fb-link{white-space:nowrap;flex:0 0 auto}
#fh-bot .fb-form{display:flex;gap:8px;padding:10px;background:#fff}
#fh-bot .fb-form input{flex:1;padding:10px 12px;border:1px solid #cfd6f5;border-radius:22px;font-size:14px;min-width:0;background:#fff;color:#1b2150}
#fh-bot .fb-form button{background:var(--ink,#1E2A6E);color:#fff;border:0;border-radius:22px;padding:0 16px;font-weight:700;cursor:pointer}
#fh-bot .fb-dots span{display:inline-block;width:7px;height:7px;margin:0 2px;border-radius:50%;background:#99a2d0;animation:fbd 1s infinite}
#fh-bot .fb-dots span:nth-child(2){animation-delay:.15s}#fh-bot .fb-dots span:nth-child(3){animation-delay:.3s}
#fh-bot .fb-rate{margin-top:6px;display:flex;gap:6px;align-items:center}#fh-bot .fb-rate button{background:transparent;border:1px solid #d9def0;border-radius:12px;padding:1px 8px;cursor:pointer;font-size:13px}#fh-bot .fb-rate button:hover{background:#eef1ff}
#fh-bot .fb-new{background:rgba(255,255,255,.18);border:0;color:#fff;border-radius:12px;padding:3px 10px;font-size:12px;cursor:pointer}
@keyframes fbd{0%,80%,100%{opacity:.25}40%{opacity:1}}
html.fh-dark #fh-bot{background:#171e46;border-color:#2b3470;color:#e6e9ff}
html.fh-dark #fh-bot .fb-msgs{background:#0d1230}
html.fh-dark #fh-bot .fb-m.bot{background:#171e46;border-color:#2b3470}
html.fh-dark #fh-bot .fb-m.me{background:#8da0ff;color:#0d1230}
html.fh-dark #fh-bot .fb-chips,html.fh-dark #fh-bot .fb-form{background:#171e46;border-color:#2b3470}
html.fh-dark #fh-bot .fb-form input{background:#0d1230;border-color:#2b3470;color:#e6e9ff}
html.fh-dark #fh-bot .fb-link,html.fh-dark #fh-bot .fb-act a{background:#232c63;color:#cdd5ff;border-color:#34408a}
html.fh-dark #fh-bot .fb-line,html.fh-dark #fh-bot .fb-person{border-color:#2b3470}
html.fh-dark #fh-bot .fb-dim,html.fh-dark #fh-bot .fb-h{color:#9aa4dd}
html.fh-dark #fh-bot-btn{background:#8da0ff;color:#0d1230}
html.fh-dark #fh-bot .fb-form button{background:#8da0ff;color:#0d1230}
@media (max-width:560px){#fh-bot{right:8px;left:8px;width:auto;max-width:none;bottom:8px;height:78vh;max-height:none;border-radius:14px}#fh-bot-btn{bottom:72px;right:14px}}`;

  function el(id) { return document.getElementById(id); }
  function msgsBox() { return document.querySelector('#fh-bot .fb-msgs'); }
  function push(who, html) { A.msgs.push({ who, html }); render(); }
  function typing(on) { const b = msgsBox(); if (!b) return; const old = b.querySelector('.fb-typing'); if (old) old.remove(); if (on) { b.insertAdjacentHTML('beforeend', '<div class="fb-m bot fb-typing"><span class="fb-dots"><span></span><span></span><span></span></span></div>'); b.scrollTop = b.scrollHeight; } }
  function render() { const b = msgsBox(); if (!b) return; b.innerHTML = A.msgs.map((m) => `<div class="fb-m ${m.who}">${m.html}${m.lid ? `<div class="fb-rate">${m.fb ? '<span class="fb-dim">Thanks for the feedback</span>' : `<button type="button" data-fb="1" data-lid="${m.lid}" aria-label="Helpful">👍</button><button type="button" data-fb="-1" data-lid="${m.lid}" aria-label="Not correct">👎</button>`}</div>` : ''}</div>`).join(''); b.scrollTop = b.scrollHeight; }
  function chips() {
    const r = isRiderRole();
    const list = r ? ['Same hotspot as me', 'Rain coat eligibility', 'Vials expiring soon', 'My requests', 'My Area Incharge'] : ['Vials expiring soon', 'Open requests', 'My tasks', 'Latest circulars'];
    const q = { 'Same hotspot as me': 'Who has the same hotspot as me?', 'Rain coat eligibility': 'Am I eligible for a new rain coat?', 'Vials expiring soon': 'Which vials expire soon?', 'My requests': 'Show my requests', 'My Area Incharge': 'Who is my Area Incharge?', 'Open requests': 'Open requests', 'My tasks': 'My tasks', 'Latest circulars': 'Latest circulars' };
    const custom = (A.qq || []);
    el('fh-bot').querySelector('.fb-chips').innerHTML = custom.length
      ? custom.map((c) => btn(c.label, `data-say="${esc(c.label)}"` + (c.answer ? ` data-ans="${esc(c.answer)}"` : ''))).join('')
      : list.map((l) => btn(l, `data-say="${esc(q[l])}"`)).join('');
  }
  function build() {
    if (el('fh-bot')) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const b = document.createElement('button'); b.id = 'fh-bot-btn'; b.type = 'button'; b.title = 'FieldHub Assistant'; b.setAttribute('aria-label', 'Open FieldHub Assistant');
    b.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6A8 8 0 1 1 21 12z"/><circle cx="9" cy="12" r=".8" fill="currentColor"/><circle cx="13" cy="12" r=".8" fill="currentColor"/><circle cx="17" cy="12" r=".8" fill="currentColor"/></svg>';
    const p = document.createElement('div'); p.id = 'fh-bot'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'FieldHub Assistant');
    p.innerHTML = '<div class="fb-head"><div><b>FieldHub Assistant</b><small>Answers from your portal data</small></div><span style="display:flex;gap:8px;align-items:center"><button type="button" class="fb-new">New chat</button><button type="button" class="fb-x" aria-label="Close">✕</button></span></div><div class="fb-msgs" aria-live="polite"></div><div class="fb-chips"></div><form class="fb-form"><input type="text" placeholder="Type your question…" autocomplete="off" maxlength="200"><button type="submit">Send</button></form>';
    document.body.appendChild(p); document.body.appendChild(b);
    b.onclick = () => toggle();
    p.querySelector('.fb-x').onclick = () => toggle(false);
    p.querySelector('.fb-form').onsubmit = (e) => { e.preventDefault(); const i = p.querySelector('input'); const v = i.value; i.value = ''; ask(v); };
    p.addEventListener('click', (e) => {
      const fbk = e.target.closest('[data-fb]'); if (fbk) { rate(fbk.getAttribute('data-lid'), +fbk.getAttribute('data-fb')); return; }
      if (e.target.closest('.fb-new')) { startSession(); chips(); return; }
      const s = e.target.closest('[data-say]'); if (s) { ask(s.getAttribute('data-say'), s.getAttribute('data-ans')); return; }
      const g = e.target.closest('[data-go]');
      if (g) { const v = g.getAttribute('data-go'), q = g.getAttribute('data-q'); if (window.innerWidth < 700) toggle(false); Promise.resolve(navigateTo(v)).then(() => { if (q) setTimeout(() => { const i = document.getElementById('kb-search'); if (i) { i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); } }, 400); }); return; }
      const a = e.target.closest('[data-act="newreq"]'); if (a) { if (window.innerWidth < 700) toggle(false); if (typeof openNewRequestModal === 'function') openNewRequestModal(); }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && A.open) toggle(false); });
  }
  function toggle(force) {
    A.open = typeof force === 'boolean' ? force : !A.open;
    el('fh-bot').classList.toggle('open', A.open);
    if (!A.open) { A.msgs = []; A.pending = null; A.sid = ''; }
    if (A.open) {
      startSession(); chips(); loadQuick().then(chips);
      chips(); setTimeout(() => { const i = el('fh-bot').querySelector('input'); if (i && window.innerWidth > 700) i.focus(); }, 50);
    }
  }
  // called by app.js after a successful sign-in
  window.fhAssistantInit = function () {
    try {
      build();
      const uid = state.user && state.user.id;
      if (A.uid !== uid) { A.uid = uid; A.msgs = []; A.pending = null; A.tools = null; if (A.open) toggle(false); }
    } catch (e) { console.warn('assistant', e); }
  };
  window.fhAssistantAsk = ask;   // for testing / other pages
})();

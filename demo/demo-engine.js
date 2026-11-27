/* =====================================================================
   FieldHub DEMO engine  (demo/demo-engine.js)
   ---------------------------------------------------------------------
   Loaded INSTEAD of config.js on the demo page only. It:
   - points the portal at a made-up address (fhdemo.invalid) that can never
     reach the real Supabase, so the demo cannot read or change live data;
   - answers every database / sign-in / storage / server-function call from
     sample data kept on this device (nothing is uploaded anywhere);
   - keeps everything the demo saves under its own "fhdemo:" names so the
     real sign-in and settings on the same phone are never touched.
   ===================================================================== */
const SUPABASE_URL = 'https://fhdemo.invalid';
const SUPABASE_ANON_KEY = 'fieldhub-demo-key';
const FUNCTIONS_URL = 'https://fhdemo.invalid/functions/v1/fieldhub-actions';

(function () {
  'use strict';
  const D = window.FHDEMO = window.FHDEMO || {};
  D.version = 1;
  D.host = 'fhdemo.invalid';

  // ------------------------------------------------------------------ 1. separate storage
  const PFX = 'fhdemo:';
  function wrapStorage(real) {
    const keys = () => { const out = []; for (let i = 0; i < real.length; i++) { const k = real.key(i); if (k && k.indexOf(PFX) === 0) out.push(k.slice(PFX.length)); } return out; };
    const api = {
      getItem: (k) => real.getItem(PFX + k),
      setItem: (k, v) => real.setItem(PFX + k, String(v)),
      removeItem: (k) => real.removeItem(PFX + k),
      clear: () => keys().forEach((k) => real.removeItem(PFX + k)),
      key: (i) => keys()[i] == null ? null : keys()[i],
      get length() { return keys().length; }
    };
    return new Proxy(api, {
      ownKeys() { return keys(); },
      getOwnPropertyDescriptor(t, k) { const v = real.getItem(PFX + k); return v == null ? undefined : { value: v, writable: true, enumerable: true, configurable: true }; },
      has(t, k) { return k in t || real.getItem(PFX + k) != null; },
      get(t, k) { if (k in t) return t[k]; if (typeof k === 'string') return real.getItem(PFX + k) ?? undefined; return undefined; },
      set(t, k, v) { if (k in t) return false; real.setItem(PFX + k, String(v)); return true; },
      deleteProperty(t, k) { real.removeItem(PFX + k); return true; }
    });
  }
  try {
    const realLS = window.localStorage, realSS = window.sessionStorage;
    D.realLocal = realLS;
    const ls = wrapStorage(realLS), ss = wrapStorage(realSS);
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => ls });
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: () => ss });
  } catch (e) { console.warn('demo storage', e); }
  const store = {
    get(k, d) { try { const v = D.realLocal.getItem(PFX + 'sys:' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { D.realLocal.setItem(PFX + 'sys:' + k, JSON.stringify(v)); } catch (_) {} },
    del(k) { try { D.realLocal.removeItem(PFX + 'sys:' + k); } catch (_) {} }
  };
  D.store = store;

  // ------------------------------------------------------------------ 2. helpers
  let seedN = 1;
  D.uuid = function () {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  };
  D.nowIso = () => new Date().toISOString();
  const clone = (x) => x == null ? x : JSON.parse(JSON.stringify(x));
  D.clone = clone;

  // ------------------------------------------------------------------ 3. the in-memory database
  const DB = D.db = { t: {}, ids: new Map(), seq: {} };
  const INT_ID = new Set(['branding_settings', 'system_settings', 'home_banner', 'fh_ack_settings', 'fh_fuel_security', 'fr_settings', 'fr_log', 'fuel_records', 'usage_daily', 'fuel_centers', 'pos_events', 'roster_change_log', 'fv_checkpoint_log']);
  function tbl(name) { if (!DB.t[name]) DB.t[name] = []; return DB.t[name]; }
  D.tbl = tbl;
  function index(name, row) { if (row && row.id != null && typeof row.id === 'string') DB.ids.set(row.id, name); }
  function nextInt(name) { const rows = tbl(name); let m = DB.seq[name] || 0; rows.forEach((r) => { if (typeof r.id === 'number' && r.id > m) m = r.id; }); DB.seq[name] = m + 1; return m + 1; }
  D.nextInt = nextInt;
  const DEFAULTS = {
    requests: { status: 'open', deleted_at: null }, tasks: { status: 'pending', deleted_at: null }, circulars: { deleted_at: null, push_to_kb: false },
    expiry_items: { deleted_at: null, status: 'active' }, profiles: { status: 'pending', role: 'rider' }, roster_entries: { status: 'active', replacement_pending: false },
    activity_log: { archived: false }, categories: { active: true }, hotspots: { active: true }, sub_regions: { active: true }, regions: { active: true },
    tool_types: { active: true }, warning_types: { active: true }, home_notices: { active: true }, popup_announcements: { active: true }, fv_centers: { active: true, radius_m: 150 },
    pos_fault_types: { active: true }, designations: { active: true }, chat_quick_questions: { active: true }, password_reset_requests: { status: 'pending' },
    account_deletion_requests: { status: 'pending' }, roster_ojt: { status: 'in_training' }, fv_issues: { status: 'open' }
  };
  function insertRow(name, row, opts) {
    row = Object.assign({}, DEFAULTS[name] || {}, row);
    if (row.id == null) row.id = INT_ID.has(name) ? nextInt(name) : D.uuid();
    if (!('created_at' in row) && !(opts && opts.noStamp)) row.created_at = D.nowIso();
    tbl(name).push(row); index(name, row);
    return row;
  }
  D.insertRow = insertRow;
  D.load = function (tables) {
    DB.t = {}; DB.ids = new Map(); DB.seq = {};
    Object.keys(tables).forEach((n) => { DB.t[n] = tables[n]; tables[n].forEach((r) => index(n, r)); });
  };
  D.find = (name, id) => tbl(name).find((r) => r.id === id) || null;
  D.where = (name, fn) => tbl(name).filter(fn);

  // ---- change log: what the presenter changed is kept on this device and replayed on the next open
  let ops = store.get('ops', []);
  let saveT = null;
  function logOp(op) { ops.push(op); clearTimeout(saveT); saveT = setTimeout(() => store.set('ops', ops), 250); }
  D.logOp = logOp;
  D.applyOp = function (op) {
    const rows = tbl(op.tb);
    if (op.k === 'i') op.rows.forEach((r) => { const ex = rows.findIndex((x) => x.id === r.id); if (ex >= 0) rows[ex] = r; else { rows.push(r); index(op.tb, r); } });
    else if (op.k === 'u') { const s = new Set(op.ids); rows.forEach((r) => { if (s.has(r.id)) Object.assign(r, op.p); }); }
    else if (op.k === 'r') { const m = new Map(op.rows.map((r) => [r.id, r])); for (let i = 0; i < rows.length; i++) if (m.has(rows[i].id)) rows[i] = m.get(rows[i].id); }
    else if (op.k === 'd') { const s = new Set(op.ids); DB.t[op.tb] = rows.filter((r) => !s.has(r.id)); }
  };
  D.replay = function () { (store.get('ops', []) || []).forEach((op) => { try { D.applyOp(op); } catch (_) {} }); };
  // public write helpers (used by the REST layer and by the server-function emulation)
  D.ins = function (name, rowOrRows, opts) {
    const list = (Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]).map((r) => insertRow(name, r, opts));
    logOp({ k: 'i', tb: name, rows: clone(list) }); D.emit(name, 'INSERT', list); return list;
  };
  D.upd = function (name, rows, patch) {
    if (!rows.length) return rows;
    rows.forEach((r) => Object.assign(r, patch));
    logOp({ k: 'u', tb: name, ids: rows.map((r) => r.id), p: clone(patch) }); D.emit(name, 'UPDATE', rows); return rows;
  };
  D.del = function (name, rows) {
    if (!rows.length) return rows;
    const s = new Set(rows.map((r) => r.id)); DB.t[name] = tbl(name).filter((r) => !s.has(r.id));
    logOp({ k: 'd', tb: name, ids: [...s] }); D.emit(name, 'DELETE', rows); return rows;
  };
  D.resetAll = function () {
    ['ops', 'anchor'].forEach(store.del);
    try { const rl = D.realLocal, kill = []; for (let i = 0; i < rl.length; i++) { const k = rl.key(i); if (k && k.indexOf(PFX) === 0) kill.push(k); } kill.forEach((k) => rl.removeItem(k)); } catch (_) {}
    try { const rs = Object.getOwnPropertyDescriptor(Window.prototype, 'sessionStorage'); } catch (_) {}
  };

  // ------------------------------------------------------------------ 4. who is asking (for the per-role visibility rules)
  D.users = {};   // auth users: id -> { id, phone, password }
  function tokenUser(headers) {
    const a = headers.get('authorization') || '';
    const t = a.replace(/^Bearer\s+/i, '');
    const parts = t.split('.'); if (parts.length !== 3) return null;
    try { const p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))); return p.sub || null; } catch (_) { return null; }
  }
  D.me = null;
  D.meProfile = () => D.me ? D.find('profiles', D.me) : null;

  // ------------------------------------------------------------------ 5. relationship (embed) resolution
  const SING = { categories: 'category', sub_regions: 'sub_region', profiles: 'profile', shift_types: 'shift', tool_types: 'tool_type', regions: 'region', circulars: 'circular', requests: 'request', tasks: 'task', fv_visits: 'visit', pos_machines: 'machine', tool_issuances: 'tool_issuance', warning_types: 'warning_type', designations: 'designation', fv_centers: 'center' };
  const singular = (t) => SING[t] || t.replace(/ies$/, 'y').replace(/s$/, '');
  const PREF_PROFILE_COL = ['rider_id', 'user_id', 'actor_id', 'profile_id', 'created_by', 'assigned_to', 'recorded_by'];
  const relCache = new Map();
  function resolveRel(parent, parentRows, target, hint) {
    const key = parent + '|' + target + '|' + (hint || '');
    if (relCache.has(key)) return relCache.get(key);
    let rel = null;
    const sample = parentRows.length ? parentRows : tbl(parent);
    const colsOf = (rows) => { const s = new Set(); rows.slice(0, 50).forEach((r) => Object.keys(r).forEach((k) => s.add(k))); return s; };
    const pcols = colsOf(sample);
    if (hint) {
      let h = hint.replace(/^inner$|^left$/, '');
      if (/_fkey$/.test(h)) { h = h.replace(/_fkey$/, ''); if (h.indexOf(parent + '_') === 0) h = h.slice(parent.length + 1); else if (h.indexOf(target + '_') === 0) h = h.slice(target.length + 1); }
      if (pcols.has(h)) rel = { kind: 'fwd', col: h };
      else if (colsOf(tbl(target)).has(h)) rel = { kind: 'rev', col: h };
      else rel = { kind: 'fwd', col: h };
    } else {
      const want = singular(target) + '_id';
      if (pcols.has(want)) rel = { kind: 'fwd', col: want };
      else {
        const hits = [];
        pcols.forEach((c) => { if (c === 'id') return; if (sample.some((r) => typeof r[c] === 'string' && DB.ids.get(r[c]) === target)) hits.push(c); });
        if (hits.length) {
          hits.sort((a, b) => { const ia = PREF_PROFILE_COL.indexOf(a), ib = PREF_PROFILE_COL.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
          rel = { kind: 'fwd', col: hits[0] };
        } else {
          const tcols = colsOf(tbl(target));
          const back = singular(parent) + '_id';
          if (tcols.has(back)) rel = { kind: 'rev', col: back };
          else {
            const ids = new Set(sample.map((r) => r.id));
            let found = null; tcols.forEach((c) => { if (!found && c !== 'id' && tbl(target).some((r) => ids.has(r[c]))) found = c; });
            rel = found ? { kind: 'rev', col: found } : { kind: 'fwd', col: want };
          }
        }
      }
    }
    if (tbl(parent).length && tbl(target).length) relCache.set(key, rel);
    return rel;
  }
  D.resetRelCache = () => relCache.clear();

  // ------------------------------------------------------------------ 6. select / filter / order parsing
  function splitTop(s, sep) {
    const out = []; let depth = 0, cur = '', q = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"') { q = !q; cur += c; continue; }
      if (!q && c === '(') depth++;
      if (!q && c === ')') depth--;
      if (!q && depth === 0 && c === sep) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    if (cur !== '') out.push(cur);
    return out;
  }
  function parseSelect(s) {
    s = (s || '*').replace(/\s+/g, '');
    return splitTop(s, ',').filter(Boolean).map((item) => {
      const p = item.indexOf('(');
      if (p >= 0 && item.endsWith(')')) {
        let head = item.slice(0, p), inner = item.slice(p + 1, -1), alias = null;
        const ci = head.indexOf(':'); if (ci >= 0) { alias = head.slice(0, ci); head = head.slice(ci + 1); }
        const bits = head.split('!'); const target = bits[0]; let hint = null, inner_ = false;
        bits.slice(1).forEach((b) => { if (b === 'inner') inner_ = true; else if (b !== 'left') hint = b; });
        return { embed: true, alias: alias || target, target, hint, inner: inner_, sel: parseSelect(inner) };
      }
      let alias = null, col = item;
      const ci = item.indexOf(':'); if (ci >= 0 && item[ci + 1] !== ':') { alias = item.slice(0, ci); col = item.slice(ci + 1); }
      col = col.replace(/::\w+$/, '');
      let json = null;
      const jm = col.match(/^([a-z_0-9]+)(->>?)(.+)$/); if (jm) { json = jm[3].split(/->>?/); col = jm[1]; }
      return { col, alias: alias || (json ? json[json.length - 1] : col), json };
    });
  }
  function unq(v) { v = v.trim(); if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') return v.slice(1, -1).replace(/\\"/g, '"'); return v; }
  function parseList(v) { v = v.replace(/^\(|\)$/g, '').replace(/^\{|\}$/g, ''); return v === '' ? [] : splitTop(v, ',').map(unq); }
  function parseCond(col, expr) {
    let neg = false;
    if (expr.indexOf('not.') === 0) { neg = true; expr = expr.slice(4); }
    const dot = expr.indexOf('.');
    const op = dot < 0 ? expr : expr.slice(0, dot); const val = dot < 0 ? '' : expr.slice(dot + 1);
    return { col, op, val, neg };
  }
  function parseLogic(kind, body) {   // body: "(a.eq.1,b.is.null,and(c.eq.2,d.eq.3))"
    const inside = body.replace(/^\(/, '').replace(/\)$/, '');
    const parts = splitTop(inside, ',');
    return { logic: kind, items: parts.map((p) => {
      const m = p.match(/^(not\.)?(and|or)(\(.*\))$/);
      if (m) { const g = parseLogic(m[2], m[3]); g.neg = !!m[1]; return g; }
      const i1 = p.indexOf('.'); const col = p.slice(0, i1); return parseCond(col, p.slice(i1 + 1));
    }) };
  }
  const isNum = (x) => typeof x === 'number';
  function cmpVal(a, b) {   // a = row value, b = filter string
    if (a == null) return null;
    if (isNum(a)) { const nb = Number(b); if (!isNaN(nb)) return a === nb ? 0 : a < nb ? -1 : 1; }
    if (typeof a === 'boolean') { const bb = b === 'true'; return a === bb ? 0 : a ? 1 : -1; }
    const sa = String(a), sb_ = String(b);
    return sa === sb_ ? 0 : sa < sb_ ? -1 : 1;
  }
  function likeRe(pat, ci) { const esc = pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[%*]/g, '.*').replace(/_/g, '.'); return new RegExp('^' + esc + '$', ci ? 'is' : 's'); }
  function getPath(row, col) {
    if (col.indexOf('->') >= 0) { const parts = col.split(/->>?/); let v = row[parts[0]]; for (let i = 1; i < parts.length && v != null; i++) v = v[parts[i]]; return v; }
    return row[col];
  }
  function testCond(row, c) {
    const v = getPath(row, c.col); let r;
    switch (c.op) {
      case 'eq': r = v != null && cmpVal(v, c.val) === 0; break;
      case 'neq': r = v != null && cmpVal(v, c.val) !== 0; break;
      case 'gt': r = v != null && cmpVal(v, c.val) > 0; break;
      case 'gte': r = v != null && cmpVal(v, c.val) >= 0; break;
      case 'lt': r = v != null && cmpVal(v, c.val) < 0; break;
      case 'lte': r = v != null && cmpVal(v, c.val) <= 0; break;
      case 'like': r = v != null && likeRe(c.val, false).test(String(v)); break;
      case 'ilike': r = v != null && likeRe(c.val, true).test(String(v)); break;
      case 'is': r = c.val === 'null' ? v == null : c.val === 'true' ? v === true : c.val === 'false' ? v === false : c.val === 'not_null' ? v != null : false; break;
      case 'in': { const L = parseList(c.val); r = v != null && L.some((x) => cmpVal(v, x) === 0); break; }
      case 'cs': { const L = c.val.trim()[0] === '[' ? JSON.parse(c.val) : parseList(c.val); r = Array.isArray(v) && L.every((x) => v.map(String).includes(String(x))); break; }
      case 'cd': { const L = c.val.trim()[0] === '[' ? JSON.parse(c.val) : parseList(c.val); r = Array.isArray(v) && v.every((x) => L.map(String).includes(String(x))); break; }
      case 'ov': { const L = parseList(c.val); r = Array.isArray(v) && v.some((x) => L.map(String).includes(String(x))); break; }
      case 'fts': case 'plfts': case 'wfts': case 'phfts': r = v != null && String(v).toLowerCase().includes(c.val.toLowerCase()); break;
      default: r = true;
    }
    return c.neg ? !r : r;
  }
  function testNode(row, n) {
    if (n.logic) { const res = n.logic === 'and' ? n.items.every((x) => testNode(row, x)) : n.items.some((x) => testNode(row, x)); return n.neg ? !res : res; }
    return testCond(row, n);
  }
  function parseQuery(params) {
    const q = { select: '*', filters: [], embedFilters: {}, order: [], limit: null, offset: 0, onConflict: null, columns: null, embedOrder: {}, embedLimit: {} };
    params.forEach((value, key) => {
      if (key === 'select') q.select = value;
      else if (key === 'order') q.order = value.split(',').map((o) => { const p = o.split('.'); return { col: p[0], desc: p[1] === 'desc', nulls: p.includes('nullsfirst') ? 'first' : p.includes('nullslast') ? 'last' : null }; });
      else if (/\.order$/.test(key)) q.embedOrder[key.slice(0, -6)] = value;
      else if (key === 'limit') q.limit = Number(value);
      else if (/\.limit$/.test(key)) q.embedLimit[key.slice(0, -6)] = Number(value);
      else if (key === 'offset') q.offset = Number(value);
      else if (key === 'on_conflict') q.onConflict = value.split(',');
      else if (key === 'columns') q.columns = value;
      else {
        let node;
        const lg = key.match(/^(?:(.+)\.)?(not\.)?(or|and)$/);
        if (lg) { node = parseLogic(lg[3], value); node.neg = !!lg[2]; if (lg[1]) { (q.embedFilters[lg[1]] = q.embedFilters[lg[1]] || []).push(node); return; } }
        else {
          const dot = key.lastIndexOf('.');
          // an embedded filter looks like "profiles.full_name=ilike.x"
          if (dot > 0 && !/->/.test(key)) { const path = key.slice(0, dot), col = key.slice(dot + 1); (q.embedFilters[path] = q.embedFilters[path] || []).push(parseCond(col, value)); return; }
          node = parseCond(key, value);
        }
        q.filters.push(node);
      }
    });
    return q;
  }
  function sortRows(rows, order) {
    if (!order || !order.length) return rows;
    return rows.slice().sort((a, b) => {
      for (const o of order) {
        const va = getPath(a, o.col), vb = getPath(b, o.col);
        const nf = o.nulls ? o.nulls === 'first' : o.desc;
        if (va == null && vb == null) continue;
        if (va == null) return nf ? -1 : 1;
        if (vb == null) return nf ? 1 : -1;
        let c = (isNum(va) && isNum(vb)) ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: false });
        if (typeof va === 'string' && typeof vb === 'string') c = va < vb ? -1 : va > vb ? 1 : 0;
        if (c !== 0) return o.desc ? -c : c;
      }
      return 0;
    });
  }
  // build output rows for a select list (embeds included)
  function project(table, rows, sel, q, path, ctx) {
    const embeds = sel.filter((s) => s.embed);
    const plain = sel.filter((s) => !s.embed);
    const star = plain.some((s) => s.col === '*') || !plain.length && !embeds.length;
    const out = [];
    for (const row of rows) {
      const o = {};
      if (star) Object.assign(o, clone(row));
      plain.forEach((s) => { if (s.col === '*') return; let v = s.json ? getPath(row, s.col + '->' + s.json.join('->')) : row[s.col]; o[s.alias] = v === undefined ? null : clone(v); });
      let keep = true;
      for (const e of embeds) {
        const ePath = path ? path + '.' + e.alias : e.alias;
        let tName = e.target, rel;
        const isTable = !!DB.t[tName] || /s$/.test(tName) && !(tName in row);
        if (!isTable || (tName in row && !DB.t[tName])) {     // "profiles:user_id(...)" form: the name is a column
          const v = row[tName]; const tt = v != null ? DB.ids.get(v) : null;
          const target = tt ? D.find(tt, v) : null;
          let val = null;
          if (target && visible(tt, target, ctx)) val = project(tt, [target], e.sel, q, ePath, ctx)[0];
          val = applyEmbedFilter(val, ePath, q);
          if (e.inner && !val) keep = false;
          o[e.alias] = val; continue;
        }
        rel = resolveRel(table, rows, tName, e.hint);
        let val;
        if (rel.kind === 'fwd') {
          const v = row[rel.col]; const t = v != null ? tbl(tName).find((x) => x.id === v) : null;
          val = t && visible(tName, t, ctx) ? project(tName, [t], e.sel, q, ePath, ctx)[0] : null;
          val = applyEmbedFilter(val, ePath, q);
          if (e.inner && !val) keep = false;
        } else {
          let kids = tbl(tName).filter((x) => x[rel.col] === row.id && visible(tName, x, ctx));
          const f = q.embedFilters[ePath]; if (f) kids = kids.filter((k) => f.every((n) => testNode(k, n)));
          if (q.embedOrder[ePath]) kids = sortRows(kids, q.embedOrder[ePath].split(',').map((x) => { const p = x.split('.'); return { col: p[0], desc: p[1] === 'desc' }; }));
          if (q.embedLimit[ePath]) kids = kids.slice(0, q.embedLimit[ePath]);
          val = project(tName, kids, e.sel, q, ePath, ctx);
          if (e.inner && !val.length) keep = false;
        }
        o[e.alias] = val;
      }
      if (keep) out.push(o);
    }
    return out;
  }
  function applyEmbedFilter(val, ePath, q) {
    const f = q.embedFilters[ePath];
    if (!f || !val) return val;
    return f.every((n) => testNode(val, n)) ? val : null;
  }

  // ------------------------------------------------------------------ 7. who may see what (a light copy of the live RLS rules)
  function regionsOf(p) {
    if (!p) return [];
    const links = tbl('profile_regions').filter((x) => x.profile_id === p.id).map((x) => x.region_id);
    return links.length ? links : (p.region_id ? [p.region_id] : []);
  }
  D.regionsOf = regionsOf;
  function riderRegion(riderId) {
    const e = tbl('roster_entries').find((x) => x.rider_id === riderId && x.status !== 'removed');
    if (e) return e.region_id;
    const p = D.find('profiles', riderId); return p ? p.region_id : null;
  }
  D.riderRegion = riderRegion;
  function visible(table, row, ctx) {
    const me = ctx && ctx.me; if (!me) return true;
    const role = me.role;
    if (role === 'super_admin' || role === 'admin') return true;
    const mine = ctx.regions || (ctx.regions = regionsOf(me));
    const inMine = (rid) => !rid || mine.includes(rid);
    const rider = role === 'rider';
    switch (table) {
      case 'requests':
        if (rider) return row.rider_id === me.id;
        if (row.assigned_poc_id === me.id) return true;
        if (role === 'inventory_coordinator') return !row.assigned_poc_id || inMine(riderRegion(row.rider_id));
        return inMine(riderRegion(row.rider_id));
      case 'tasks': return row.assigned_to === me.id || row.assigned_by === me.id || (!rider && inMine(riderRegion(row.assigned_to)) && role !== 'coordinator');
      case 'disciplinary_actions': case 'tool_issuances': case 'compliance_submissions': case 'fv_visits': case 'fv_issues':
        return rider ? row.rider_id === me.id : inMine(riderRegion(row.rider_id));
      case 'pos_machines': case 'pos_repairs':
        return rider ? row.rider_id === me.id : true;
      case 'expiry_items': return rider ? (row.rider_id === me.id || (!row.rider_id && inMine(row.region_id))) : inMine(row.region_id);
      case 'expiry_notices': return row.user_id === me.id;
      case 'roster_entries': return rider ? row.rider_id === me.id : inMine(row.region_id);
      case 'circulars': {
        if (row.created_by === me.id) return true;
        const rids = row.target_region_ids || (row.target_region_id ? [row.target_region_id] : []);
        const roles = row.target_roles || (row.target_role ? [row.target_role] : []);
        if (rids.length && !rids.some((r) => mine.includes(r))) return false;
        if (roles.length && !roles.includes(role)) return false;
        return true;
      }
      case 'profiles':
        if (row.id === me.id) return true;
        if (rider) return row.role !== 'rider' || false;
        return true;
      case 'user_prefs': case 'chat_logs': case 'popup_dismissals': return row.user_id === me.id || !rider;
      case 'custom_permissions': return row.profile_id === me.id || !rider;
      case 'activity_log': case 'error_logs': case 'account_deletion_requests': case 'usage_daily': case 'user_activity':
        return !rider || row.user_id === me.id || row.actor_id === me.id;
      default: return true;
    }
  }
  D.visible = visible;

  // ------------------------------------------------------------------ 8. the REST answering machine
  const J = (status, body, headers) => new Response(body == null ? null : JSON.stringify(body), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) });
  D.J = J;
  function pgErr(status, code, message, details) { return J(status, { code, message, details: details || null, hint: null }); }
  D.pgErr = pgErr;
  function ctxFor(headers) { const id = tokenUser(headers); D.me = id; const me = id ? D.find('profiles', id) : null; return { me, uid: id }; }
  D.ctxFor = ctxFor;
  const UNIQUE = { profiles: [['employee_id'], ['phone']], popup_dismissals: [['popup_id', 'user_id']], top_performers: [['rider_id', 'perf_month']], user_prefs: [['user_id']], circular_acks: [['circular_id', 'user_id']], pos_machines: [['sn']], fv_centers: [['code']], tool_issuance_acks: [['tool_issuance_id', 'user_id']], password_reset_requests: [] };
  function dupOf(table, row, ignoreId) {
    for (const cols of (UNIQUE[table] || [])) {
      if (cols.some((c) => row[c] == null || row[c] === '')) continue;
      const hit = tbl(table).find((x) => x.id !== ignoreId && cols.every((c) => String(x[c]).toLowerCase() === String(row[c]).toLowerCase()));
      if (hit) return cols;
    }
    return null;
  }
  async function handleRest(url, method, headers, bodyText) {
    const m = url.pathname.match(/^\/rest\/v1\/(.*)$/); if (!m) return J(404, { message: 'not found' });
    const ctx = ctxFor(headers);
    const name = decodeURIComponent(m[1]);
    if (name.indexOf('rpc/') === 0) {
      const fn = name.slice(4);
      let args = {};
      if (method === 'GET' || method === 'HEAD') url.searchParams.forEach((v, k) => { args[k] = v; });
      else { try { args = bodyText ? JSON.parse(bodyText) : {}; } catch (_) { args = {}; } }
      return D.callRpc(fn, args, ctx, url, headers);
    }
    const table = name;
    const q = parseQuery(url.searchParams);
    const prefer = (headers.get('prefer') || '').toLowerCase();
    const wantRep = /return=representation/.test(prefer);
    const wantCount = /count=(exact|planned|estimated)/.test(prefer);
    const single = /vnd\.pgrst\.object/.test(headers.get('accept') || '');
    const sel = parseSelect(q.select);
    const match = (rows) => rows.filter((r) => q.filters.every((n) => testNode(r, n)));
    const finish = (rows, status, total) => {
      // filters on !inner embeds remove the parent row; filters on normal embeds only empty the embed
      let out = project(table, rows, sel, q, '', ctx);
      const h = {};
      if (single) {
        if (out.length !== 1) return pgErr(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned', 'The result contains ' + out.length + ' rows');
        return J(status, out[0], h);
      }
      if (wantCount || method === 'HEAD') { const n = total == null ? out.length : total; h['Content-Range'] = (out.length ? (q.offset + '-' + (q.offset + out.length - 1)) : '*') + '/' + n; }
      if (method === 'HEAD') return new Response(null, { status: 200, headers: h });
      return J(status, out, h);
    };
    if (method === 'GET' || method === 'HEAD') {
      let rows = match(tbl(table)).filter((r) => visible(table, r, ctx));
      rows = sortRows(rows, q.order);
      // drop rows whose !inner embed fails (done inside project); count before paging is close enough
      const projectedAll = project(table, rows, sel, q, '', ctx);
      const keepIds = new Set(projectedAll.map((_, i) => i));
      let total = projectedAll.length;
      let pageRows = rows;
      if (sel.some((s) => s.embed && s.inner)) {
        // re-run with only parent rows that survived the inner join
        const surv = []; rows.forEach((r) => { if (project(table, [r], sel, q, '', ctx).length) surv.push(r); });
        pageRows = surv; total = surv.length;
      }
      const lim = q.limit == null ? 1000000 : q.limit;
      pageRows = pageRows.slice(q.offset, q.offset + lim);
      void keepIds;
      return finish(pageRows, 200, total);
    }
    let body = null; try { body = bodyText ? JSON.parse(bodyText) : null; } catch (_) {}
    if (method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      const upsert = /resolution=(merge|ignore)-duplicates/.test(prefer);
      const ignore = /resolution=ignore-duplicates/.test(prefer);
      const out = [];
      for (const raw of list) {
        const r = Object.assign({}, raw);
        if (D.beforeInsert) { const e = D.beforeInsert(table, r, ctx); if (e) return e; }
        if (upsert) {
          const cols = q.onConflict || ['id'];
          const ex = tbl(table).find((x) => cols.every((c) => r[c] != null && String(x[c]) === String(r[c])));
          if (ex) { if (!ignore) { D.upd(table, [ex], r); } out.push(ex); continue; }
        }
        const dup = dupOf(table, r, null);
        if (dup) return pgErr(409, '23505', 'duplicate key value violates unique constraint "' + table + '_' + dup.join('_') + '_key"', 'Key (' + dup.join(', ') + ') already exists.');
        out.push(D.ins(table, r)[0]);
        if (D.afterInsert) try { D.afterInsert(table, out[out.length - 1], ctx); } catch (e) { console.warn(e); }
      }
      if (!wantRep) return new Response(null, { status: 201 });
      return finish(out, 201);
    }
    if (method === 'PATCH') {
      const rows = match(tbl(table)).filter((r) => visible(table, r, ctx));
      if (body && rows.length === 1) { const dup = dupOf(table, Object.assign({}, rows[0], body), rows[0].id); if (dup) return pgErr(409, '23505', 'duplicate key value violates unique constraint "' + table + '_' + dup.join('_') + '_key"'); }
      const before = rows.map((r) => clone(r));
      D.upd(table, rows, body || {});
      if (D.afterUpdate) try { D.afterUpdate(table, rows, before, ctx); } catch (e) { console.warn(e); }
      if (!wantRep && !wantCount) return new Response(null, { status: 204 });
      return finish(rows, 200, rows.length);
    }
    if (method === 'DELETE') {
      const rows = match(tbl(table)).filter((r) => visible(table, r, ctx));
      const copy = rows.map(clone);
      D.del(table, rows);
      if (!wantRep && !wantCount) return new Response(null, { status: 204 });
      const res = project(table, copy, sel, q, '', ctx);
      const h = {}; if (wantCount) h['Content-Range'] = '*/' + copy.length;
      return J(200, res, h);
    }
    return J(405, { message: 'method' });
  }
  D.selectRows = function (table, rows, selectStr, ctx) { return project(table, rows, parseSelect(selectStr || '*'), parseQuery(new URLSearchParams()), '', ctx || {}); };

  // ------------------------------------------------------------------ 9. sign-in
  function b64u(o) { return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function authUser(p) {
    return { id: p.id, aud: 'authenticated', role: 'authenticated', phone: (p.phone || '').replace(/^\+/, ''), email: p.email || '', phone_confirmed_at: '2026-01-01T00:00:00Z', confirmed_at: '2026-01-01T00:00:00Z', last_sign_in_at: D.nowIso(), app_metadata: { provider: 'phone', providers: ['phone'] }, user_metadata: { full_name: p.full_name }, identities: [], created_at: p.created_at || '2026-01-01T00:00:00Z', updated_at: D.nowIso() };
  }
  function session(p) {
    const now = Math.floor(Date.now() / 1000), exp = now + 7 * 86400;
    const access = b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ sub: p.id, aud: 'authenticated', role: 'authenticated', exp, iat: now, phone: p.phone, session_id: D.uuid(), iss: 'https://fhdemo.invalid/auth/v1' }) + '.ZGVtbw';
    return { access_token: access, token_type: 'bearer', expires_in: exp - now, expires_at: exp, refresh_token: 'demo-refresh.' + p.id, user: authUser(p) };
  }
  D.passwordOf = (id) => (store.get('pw', {})[id]) || 'demo1234';
  async function handleAuth(url, method, headers, bodyText) {
    const path = url.pathname.replace(/^\/auth\/v1\//, '');
    let body = {}; try { body = bodyText ? JSON.parse(bodyText) : {}; } catch (_) {}
    const bad = (msg, code, status) => J(status || 400, { code: code || 'invalid_credentials', error: 'invalid_grant', error_description: msg, msg });
    if (path === 'token') {
      const gt = url.searchParams.get('grant_type');
      if (gt === 'password') {
        const phone = '+' + String(body.phone || '').replace(/[^0-9]/g, '');
        const p = tbl('profiles').find((x) => x.phone && x.phone.replace(/[^0-9]/g, '') === phone.replace(/[^0-9]/g, ''));
        if (!p || String(body.password) !== D.passwordOf(p.id)) return bad('Invalid login credentials');
        if (p.status === 'disabled' && p.banned) return bad('User is banned', 'user_banned');
        return J(200, session(p));
      }
      if (gt === 'refresh_token') {
        const id = String(body.refresh_token || '').replace(/^demo-refresh\./, '');
        const p = D.find('profiles', id); if (!p) return bad('Invalid Refresh Token', 'refresh_token_not_found');
        return J(200, session(p));
      }
      return bad('unsupported');
    }
    if (path === 'user') {
      const id = tokenUser(headers); const p = id ? D.find('profiles', id) : null;
      if (!p) return J(401, { code: 'bad_jwt', msg: 'invalid JWT' });
      if (method === 'PUT') { if (body.password) { const pw = store.get('pw', {}); pw[p.id] = body.password; store.set('pw', pw); } if (body.email) D.upd('profiles', [p], { email: body.email }); }
      return J(200, authUser(p));
    }
    if (path === 'logout') return new Response(null, { status: 204 });
    if (path === 'signup') {
      const phone = '+' + String(body.phone || '').replace(/[^0-9]/g, '');
      if (tbl('profiles').some((x) => x.phone === phone)) return J(422, { code: 'user_already_exists', msg: 'User already registered' });
      const md = body.data || {};
      const p = D.ins('profiles', { phone, full_name: md.full_name || 'New member', role: md.role || 'rider', status: 'pending', employee_id: md.employee_id || null, region_id: null })[0];
      const pw = store.get('pw', {}); pw[p.id] = body.password; store.set('pw', pw);
      const s = session(p); return J(200, Object.assign({}, s, { user: s.user }));
    }
    if (path === 'otp' || path === 'verify' || path === 'recover') return J(200, {});
    if (path === 'settings') return J(200, { external: { phone: true }, disable_signup: false });
    return J(200, {});
  }

  // ------------------------------------------------------------------ 10. picture storage (kept on the device as small data links)
  const files = store.get('files', {});
  D.fileUrl = (bucket, path) => files[bucket + '/' + path] || null;
  async function handleStorage(url, method, headers, req) {
    const m = url.pathname.match(/^\/storage\/v1\/object\/(?:public\/|sign\/|authenticated\/)?([^/]+)\/(.+)$/);
    if (url.pathname.match(/\/storage\/v1\/object\/list\//)) {
      const bucket = url.pathname.split('/').pop();
      const list = Object.keys(files).filter((k) => k.indexOf(bucket + '/') === 0).map((k) => ({ name: k.slice(bucket.length + 1), id: k, metadata: { size: Math.round(files[k].length * 0.75) }, created_at: D.nowIso() }));
      return J(200, list);
    }
    if (method === 'DELETE') {
      let body = {}; try { body = JSON.parse(await req.text()); } catch (_) {}
      const bucket = url.pathname.split('/').pop();
      (body.prefixes || []).forEach((p) => delete files[bucket + '/' + p]); store.set('files', files);
      return J(200, []);
    }
    if (!m) return J(404, { message: 'not found' });
    const key = m[1] + '/' + decodeURIComponent(m[2]);
    if (method === 'POST' || method === 'PUT') {
      const blob = await req.blob();
      const dataUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
      files[key] = dataUrl; store.set('files', files);
      return J(200, { Key: key, Id: key, path: m[2] });
    }
    if (files[key]) return fetch(files[key]);
    return J(404, { message: 'Object not found' });
  }

  // ------------------------------------------------------------------ 11. live updates (realtime): a pretend socket that answers politely
  const sockets = new Set();
  D.emit = function (table, type, rows) {
    if (!sockets.size || D.replaying) return;
    rows.forEach((row) => sockets.forEach((s) => s._push(table, type, row)));
  };
  class DemoSocket extends EventTarget {
    constructor(u) {
      super(); this.url = u; this.readyState = 0; this.protocol = ''; this.extensions = ''; this.bufferedAmount = 0; this.binaryType = 'blob';
      this.topics = new Map();
      this.v2 = /vsn=2/.test(u);
      sockets.add(this);
      setTimeout(() => { this.readyState = 1; const ev = new Event('open'); this.onopen && this.onopen(ev); this.dispatchEvent(ev); }, 30);
    }
    _recv(obj) {
      const data = this.v2 ? JSON.stringify([obj.join_ref || null, obj.ref || null, obj.topic, obj.event, obj.payload]) : JSON.stringify(obj);
      const ev = new MessageEvent('message', { data });
      setTimeout(() => { if (this.readyState !== 1) return; this.onmessage && this.onmessage(ev); this.dispatchEvent(ev); }, 5);
    }
    send(raw) {
      let msg; try { msg = JSON.parse(raw); } catch (_) { return; }
      if (Array.isArray(msg)) msg = { join_ref: msg[0], ref: msg[1], topic: msg[2], event: msg[3], payload: msg[4] };
      const reply = (response) => this._recv({ topic: msg.topic, event: 'phx_reply', payload: { status: 'ok', response: response || {} }, ref: msg.ref, join_ref: msg.join_ref });
      if (msg.event === 'phx_join') {
        const pc = ((msg.payload && msg.payload.config && msg.payload.config.postgres_changes) || []).map((c, i) => Object.assign({}, c, { id: i + 1 }));
        this.topics.set(msg.topic, { pc, join_ref: msg.join_ref });
        reply({ postgres_changes: pc });
        this._recv({ topic: msg.topic, event: 'system', payload: { status: 'ok', message: 'Subscribed to PostgreSQL', extension: 'postgres_changes', channel: msg.topic.replace(/^realtime:/, '') }, ref: null, join_ref: msg.join_ref });
      } else if (msg.event === 'phx_leave') { this.topics.delete(msg.topic); reply(); }
      else reply();
    }
    _push(table, type, row) {
      this.topics.forEach((t, topic) => {
        const ids = t.pc.filter((c) => (c.table === table || c.table === '*') && (c.event === '*' || c.event === type) && (!c.filter || (() => { const mm = String(c.filter).match(/^(\w+)=eq\.(.+)$/); return !mm || String(row[mm[1]]) === mm[2]; })())).map((c) => c.id);
        if (!ids.length) return;
        const columns = Object.keys(row).map((n) => ({ name: n, type: 'text' }));
        this._recv({ topic, event: 'postgres_changes', payload: { ids, data: { schema: 'public', table, commit_timestamp: D.nowIso(), type, columns, record: type === 'DELETE' ? {} : row, old_record: type === 'DELETE' ? { id: row.id } : {}, errors: null } }, ref: null, join_ref: t.join_ref });
      });
    }
    close() { this.readyState = 3; sockets.delete(this); const ev = new CloseEvent('close', { code: 1000 }); this.onclose && this.onclose(ev); this.dispatchEvent(ev); }
  }
  DemoSocket.CONNECTING = 0; DemoSocket.OPEN = 1; DemoSocket.CLOSING = 2; DemoSocket.CLOSED = 3;
  const RealWS = window.WebSocket;
  window.WebSocket = function (u, p) { if (String(u).indexOf(D.host) >= 0) return new DemoSocket(u, p); return new RealWS(u, p); };
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3, prototype: RealWS.prototype });

  // ------------------------------------------------------------------ 12. the network switch
  const realFetch = window.fetch.bind(window);
  D.realFetch = realFetch;
  window.fetch = async function (input, init) {
    init = init || {};
    const req = (input instanceof Request) ? input : null;
    const href = req ? req.url : String(input);
    let u; try { u = new URL(href, location.href); } catch (_) { return realFetch(input, init); }
    if (u.hostname === D.host) {
      await D.ready;
      const method = String(init.method || (req && req.method) || 'GET').toUpperCase();
      const headers = new Headers(init.headers || (req && req.headers) || {});
      const r = new Request(href, { method, headers, body: (method === 'GET' || method === 'HEAD') ? undefined : (init.body != null ? init.body : (req ? await req.clone().blob() : undefined)) });
      await new Promise((res) => setTimeout(res, 40 + Math.random() * 80));   // feels like a real network
      try {
        if (u.pathname.indexOf('/rest/v1/') === 0) return await handleRest(u, method, headers, method === 'GET' || method === 'HEAD' ? '' : await r.text());
        if (u.pathname.indexOf('/auth/v1/') === 0) return await handleAuth(u, method, headers, method === 'GET' ? '' : await r.text());
        if (u.pathname.indexOf('/storage/v1/') === 0) return await handleStorage(u, method, headers, r);
        if (u.pathname.indexOf('/functions/v1/') === 0) { let b = {}; try { b = JSON.parse(await r.text()); } catch (_) {} return J(200, await D.callFunction(u.pathname.split('/').pop(), b, ctxFor(headers))); }
        return J(404, { message: 'Not found' });
      } catch (e) { console.error('[demo]', e); return pgErr(500, 'XX000', 'Demo engine: ' + (e && e.message || e)); }
    }
    if (u.hostname === 'demo-drive.invalid') { let b = {}; try { b = JSON.parse(init.body || '{}'); } catch (_) {} return J(200, await D.callDrive(b)); }
    if (/\.supabase\.co$/.test(u.hostname) || /\.supabase\.in$/.test(u.hostname)) return J(503, { message: 'The demo never talks to the live server.' });   // hard guard
    return realFetch(input, init);
  };

  // ------------------------------------------------------------------ 13. supabase client tweaks: pictures come from this device
  D.patchClient = function (client) {
    try {
      const of = client.storage.from.bind(client.storage);
      client.storage.from = function (bucket) {
        const b = of(bucket); const gp = b.getPublicUrl.bind(b);
        b.getPublicUrl = function (path) { const d = D.fileUrl(bucket, path); return d ? { data: { publicUrl: d } } : gp(path); };
        return b;
      };
    } catch (_) {}
    return client;
  };
  D.hookSupabase = function () {
    if (!window.supabase || !window.supabase.createClient || window.supabase.__fhdemo) return;
    const orig = window.supabase.createClient;
    window.supabase.createClient = function () { return D.patchClient(orig.apply(this, arguments)); };
    window.supabase.__fhdemo = true;
  };
  D.hookSupabase();

  // ------------------------------------------------------------------ 14. phone app (Capacitor) parts: separate fingerprint slot, no real push
  function patchNative() {
    try {
      const P = window.Capacitor && window.Capacitor.Plugins; if (!P) return;
      const nb = P.NativeBiometric;
      if (nb && !nb.__fhdemo) {
        const w = {}; ['isAvailable', 'verifyIdentity', 'getCredentials', 'setCredentials', 'deleteCredentials', 'isCredentialsSaved'].forEach((k) => {
          w[k] = (o) => nb[k](o && o.server ? Object.assign({}, o, { server: 'fieldhub-demo' }) : o);
        });
        w.__fhdemo = true;
        try { P.NativeBiometric = w; } catch (_) {}
        if (P.NativeBiometric !== w) try { Object.defineProperty(P, 'NativeBiometric', { value: w, configurable: true }); } catch (_) {}
      }
    } catch (_) {}
  }
  patchNative(); let pn = 0; const pnT = setInterval(() => { patchNative(); if (++pn > 20) clearInterval(pnT); }, 500);

  // ------------------------------------------------------------------ 15. start: build the sample data (+ replay what the presenter changed)
  D.ready = new Promise((resolve) => { D._resolveReady = resolve; });
  D.boot = function () {
    const anchor = new Date().toISOString().slice(0, 10);   // sample dates always count back from today
    D.anchor = anchor;
    if (store.get('dv', null) !== window.FHDEMO_DATA_VERSION) { store.set('dv', window.FHDEMO_DATA_VERSION); store.del('ops'); ops = []; }   // new sample data: old changes no longer fit
    const tables = window.FHDEMO_SEED(anchor);
    D.load(tables);
    D.replaying = true; D.replay(); D.replaying = false;
    D._resolveReady();
  };
})();

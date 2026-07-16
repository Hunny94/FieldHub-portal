// =========================================================
// NABZOPS — APPLICATION LOGIC
// You should not need to edit this file. All connection
// settings live in config.js.
// =========================================================
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  user: null,
  profile: null,
  regions: [],
  categories: [],
  profilesInScope: [],
  view: 'dashboard'
};

const ROLE_LABEL = {
  admin: 'Area Lead / Admin',
  regional_poc: 'Regional POC',
  team_lead: 'Team Lead',
  coordinator: 'Coordinator',
  inventory_coordinator: 'Inventory Coordinator',
  rider: 'Rider'
};

const ITEM_TYPE_OPTIONS = [
  'Thermometer Calibration','ID Card','Medical Fitness Certificate',
  'Training Certification','Vehicle Registration','Other'
];

// Convert a Pakistani local number (03xx-xxxxxxx) to +92 E.164 format,
// since Supabase Auth phone login needs international format.
function toE164(raw){
  const digits = (raw || '').replace(/[^0-9+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('0')) return '+92' + digits.slice(1);
  if (digits.startsWith('92')) return '+' + digits;
  return '+92' + digits;
}

// Calls the Edge Function (bulk rider upload / WhatsApp). Fails quietly
// if FUNCTIONS_URL hasn't been configured yet.
async function callEdgeFunction(action, payload){
  if (!FUNCTIONS_URL || FUNCTIONS_URL.includes('PASTE_YOUR')) {
    return { skipped: true, reason: 'Edge Function not configured yet' };
  }
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(FUNCTIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token || ''}`,
      'apikey': SUPABASE_ANON_KEY
    },
    body: JSON.stringify({ action, ...payload })
  });
  return res.json();
}

// ---------------------------------------------------------
// INIT
// ---------------------------------------------------------
window.addEventListener('DOMContentLoaded', init);

async function init(){
  bindAuthForms();
  const { data: { session } } = await sb.auth.getSession();
  if (session){ await afterLogin(session.user); } else { showAuthScreen(); }

  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT'){ showAuthScreen(); }
  });
}

function showAuthScreen(){
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('pending-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'none';
}

async function afterLogin(user){
  state.user = user;
  const { data: profile, error } = await sb.from('profiles').select('*, regions(name)').eq('id', user.id).single();
  if (error || !profile){ toast('Could not load your profile. Try refreshing.'); return; }
  state.profile = profile;

  if (profile.status !== 'active'){
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app-shell').style.display = 'none';
    document.getElementById('pending-screen').style.display = 'flex';
    return;
  }

  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('pending-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'flex';

  await loadRegions();
  await loadCategories();
  renderNav();
  renderUserBadge();
  navigateTo('dashboard');
}

async function loadRegions(){
  const { data } = await sb.from('regions').select('*').order('name');
  state.regions = data || [];
}
async function loadCategories(){
  const { data } = await sb.from('categories').select('*').eq('active', true).order('name');
  state.categories = data || [];
}

// ---------------------------------------------------------
// AUTH FORMS
// ---------------------------------------------------------
function bindAuthForms(){
  document.getElementById('show-signup').onclick = (e) => { e.preventDefault(); toggleAuthForms(true); };
  document.getElementById('show-login').onclick = (e) => { e.preventDefault(); toggleAuthForms(false); };

  document.getElementById('login-form').onsubmit = async (e) => {
    e.preventDefault();
    clearAuthMessage();
    const phone = toE164(document.getElementById('login-phone').value.trim());
    const password = document.getElementById('login-password').value;
    const { data, error } = await sb.auth.signInWithPassword({ phone, password });
    if (error){ showAuthMessage(error.message); return; }
    await afterLogin(data.user);
  };

  document.getElementById('signup-form').onsubmit = async (e) => {
    e.preventDefault();
    clearAuthMessage();
    const full_name = document.getElementById('signup-name').value.trim();
    const employee_id = document.getElementById('signup-empid').value.trim();
    const phone = toE164(document.getElementById('signup-phone').value.trim());
    const email = document.getElementById('signup-email').value.trim();
    const bike_number = document.getElementById('signup-bike').value.trim();
    const password = document.getElementById('signup-password').value;
    const { data, error } = await sb.auth.signUp({
      phone, password, options: { data: { full_name } }
    });
    if (error){ showAuthMessage(error.message); return; }
    if (data.user){
      await sb.from('profiles').update({ email, employee_id, bike_number }).eq('id', data.user.id);
      await afterLogin(data.user);
    }
  };

  document.getElementById('pending-refresh').onclick = async () => {
    const { data: { session } } = await sb.auth.getSession();
    if (session) await afterLogin(session.user);
  };
  document.getElementById('pending-logout').onclick = doLogout;
  document.getElementById('logout-btn').onclick = doLogout;
}

function toggleAuthForms(showSignup){
  document.getElementById('login-form').style.display = showSignup ? 'none' : 'block';
  document.getElementById('signup-form').style.display = showSignup ? 'block' : 'none';
  clearAuthMessage();
}
function showAuthMessage(msg){
  const el = document.getElementById('auth-message');
  el.textContent = msg; el.style.display = 'block';
}
function clearAuthMessage(){
  const el = document.getElementById('auth-message');
  el.style.display = 'none'; el.textContent = '';
}
async function doLogout(){
  await sb.auth.signOut();
  state.user = null; state.profile = null;
  showAuthScreen();
}

// ---------------------------------------------------------
// NAV
// ---------------------------------------------------------
const NAV_BY_ROLE = {
  admin: ['dashboard','circulars','tasks','requests','expiries','team','regions','categories'],
  regional_poc: ['dashboard','circulars','tasks','requests','expiries','team'],
  team_lead: ['dashboard','circulars','tasks','requests','expiries','team'],
  coordinator: ['dashboard','circulars','tasks','requests','expiries','team'],
  inventory_coordinator: ['dashboard','circulars','requests','expiries'],
  rider: ['dashboard','circulars','tasks','requests','expiries']
};
const NAV_LABEL = {
  dashboard:'Dashboard', circulars:'Circulars', tasks:'Tasks', requests:'Requests',
  expiries:'Expiry Tracker', team:'Team', regions:'Regions', categories:'Categories'
};

function renderNav(){
  const items = NAV_BY_ROLE[state.profile.role] || ['dashboard'];
  const nav = document.getElementById('nav-links');
  nav.innerHTML = items.map(key =>
    `<button class="nav-link" data-view="${key}">${NAV_LABEL[key]}</button>`
  ).join('');
  nav.querySelectorAll('.nav-link').forEach(btn => {
    btn.onclick = () => navigateTo(btn.dataset.view);
  });
}
function renderUserBadge(){
  const regionName = state.profile.regions?.name || '—';
  document.getElementById('user-badge').innerHTML = `
    <div>${escapeHtml(state.profile.full_name || state.profile.email)}</div>
    <div class="role-pill">${ROLE_LABEL[state.profile.role] || state.profile.role}</div>
    <div style="color:#9DB6B0; font-size:12px; margin-top:2px;">${escapeHtml(regionName)}</div>
  `;
}

async function navigateTo(view){
  state.view = view;
  document.querySelectorAll('.nav-link').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('view-title').textContent = NAV_LABEL[view];
  document.getElementById('topbar-actions').innerHTML = '';
  const main = document.getElementById('main-content');
  main.innerHTML = `<div class="empty-state">Loading…</div>`;
  try{
    if (view==='dashboard') await renderDashboard();
    else if (view==='circulars') await renderCirculars();
    else if (view==='tasks') await renderTasks();
    else if (view==='requests') await renderRequests();
    else if (view==='expiries') await renderExpiries();
    else if (view==='team') await renderTeam();
    else if (view==='regions') await renderRegions();
    else if (view==='categories') await renderCategories();
  }catch(err){
    console.error(err);
    main.innerHTML = `<div class="empty-state">Something went wrong loading this page. Please refresh.</div>`;
  }
}

function isStaff(){ return ['admin','regional_poc','team_lead','coordinator'].includes(state.profile.role); }
function isAdmin(){ return state.profile.role === 'admin'; }

// ---------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------
async function renderDashboard(){
  const main = document.getElementById('main-content');
  const uid = state.user.id;

  const [openReq, myTasks, circularsRes, expiring, pendingApprovals] = await Promise.all([
    sb.from('requests').select('id', {count:'exact', head:true}).in('status', ['open','in_progress']),
    sb.from('tasks').select('id', {count:'exact', head:true}).eq('assigned_to', uid).in('status', ['pending','in_progress']),
    sb.from('circulars').select('id'),
    sb.from('expiry_items').select('id, expiry_date'),
    isStaff() ? sb.from('profiles').select('id', {count:'exact', head:true}).eq('status','pending') : Promise.resolve({count:0})
  ]);

  let unacked = 0;
  if (circularsRes.data && circularsRes.data.length){
    const ids = circularsRes.data.map(c=>c.id);
    const { data: myAcks } = await sb.from('circular_acks').select('circular_id').eq('user_id', uid);
    const ackedSet = new Set((myAcks||[]).map(a=>a.circular_id));
    unacked = ids.filter(id => !ackedSet.has(id)).length;
  }

  const today = new Date();
  const soonCutoff = new Date(); soonCutoff.setDate(today.getDate()+14);
  const expiringSoon = (expiring.data||[]).filter(i => new Date(i.expiry_date) <= soonCutoff).length;

  main.innerHTML = `
    <div class="grid grid-4">
      <div class="card stat-card clay"><div class="stat-number">${openReq.count ?? 0}</div><div class="stat-label">Open requests</div></div>
      <div class="card stat-card sky"><div class="stat-number">${myTasks.count ?? 0}</div><div class="stat-label">My pending tasks</div></div>
      <div class="card stat-card amber"><div class="stat-number">${unacked}</div><div class="stat-label">Unread circulars</div></div>
      <div class="card stat-card amber"><div class="stat-number">${expiringSoon}</div><div class="stat-label">Expiring within 14 days</div></div>
    </div>
    ${isStaff() ? `
    <div class="card">
      <h3>Pending approvals</h3>
      <p style="color:var(--muted); font-size:13.5px;">${pendingApprovals.count ?? 0} account(s) waiting for role/region assignment.</p>
      <button class="btn small" onclick="navigateTo('team')">Go to Team</button>
    </div>` : ''}
    <div class="card">
      <h3>Welcome, ${escapeHtml(state.profile.full_name)}</h3>
      <p style="color:var(--muted); font-size:13.5px;">Use the menu on the left to post circulars, assign tasks, review rider requests, and track upcoming expiries.</p>
    </div>
  `;
}

// ---------------------------------------------------------
// CIRCULARS
// ---------------------------------------------------------
async function renderCirculars(){
  const main = document.getElementById('main-content');
  if (isStaff()){
    document.getElementById('topbar-actions').innerHTML = `<button class="btn" id="new-circular-btn">+ New Circular</button>`;
    document.getElementById('new-circular-btn').onclick = openNewCircularModal;
  }

  const { data: circulars } = await sb.from('circulars').select('*, profiles!circulars_created_by_fkey(full_name)').order('created_at', {ascending:false});
  const { data: myAcks } = await sb.from('circular_acks').select('circular_id').eq('user_id', state.user.id);
  const ackedSet = new Set((myAcks||[]).map(a=>a.circular_id));

  if (!circulars || circulars.length===0){
    main.innerHTML = emptyState('No circulars yet.');
    return;
  }

  let rowsHtml = '';
  for (const c of circulars){
    const acked = ackedSet.has(c.id);
    let ackInfo = '';
    if (isAdmin() || c.created_by === state.user.id){
      const audience = await countAudience(c.target_region_id, c.target_role);
      const { count: ackCount } = await sb.from('circular_acks').select('id',{count:'exact',head:true}).eq('circular_id', c.id);
      ackInfo = `<div class="mono" style="margin-top:8px;">${ackCount ?? 0} / ${audience} acknowledged</div>
        <button class="btn small outline" style="margin-top:6px;" data-tracker="${c.id}">View tracker</button>
        <div id="tracker-${c.id}"></div>`;
    }
    rowsHtml += `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <h3>${escapeHtml(c.title)}</h3>
          ${acked ? '<span class="badge active">Acknowledged</span>' : ''}
        </div>
        <p style="font-size:13.5px; white-space:pre-wrap;">${escapeHtml(c.body)}</p>
        <div class="mono">By ${escapeHtml(c.profiles?.full_name || 'Staff')} · ${formatDate(c.created_at)}</div>
        ${ackInfo}
        ${!acked ? `<button class="btn small" style="margin-top:10px;" onclick="acknowledgeCircular('${c.id}')">Acknowledge</button>` : ''}
      </div>
    `;
  }
  main.innerHTML = rowsHtml;
  main.querySelectorAll('[data-tracker]').forEach(btn => {
    btn.onclick = () => showCircularTracker(btn.dataset.tracker, circulars.find(c=>c.id===btn.dataset.tracker));
  });
}

async function showCircularTracker(circularId, circular){
  const el = document.getElementById('tracker-'+circularId);
  if (!el) return;
  el.innerHTML = '<div class="mono">Loading…</div>';
  let q = sb.from('profiles').select('id, full_name, role').eq('status','active');
  if (circular.target_region_id) q = q.eq('region_id', circular.target_region_id);
  if (circular.target_role) q = q.eq('role', circular.target_role);
  const { data: audience } = await q;
  const { data: acks } = await sb.from('circular_acks').select('user_id, acknowledged_at').eq('circular_id', circularId);
  const ackMap = new Map((acks||[]).map(a=>[a.user_id, a.acknowledged_at]));
  el.innerHTML = `<table style="margin-top:8px;"><thead><tr><th>Name</th><th>Role</th><th>Status</th></tr></thead><tbody>
    ${(audience||[]).map(p=>{
      const acked = ackMap.get(p.id);
      return `<tr><td>${escapeHtml(p.full_name)}</td><td>${ROLE_LABEL[p.role]||p.role}</td>
        <td>${acked ? `<span class="badge active">Acknowledged</span>` : `<span class="badge open">Pending</span>`}</td></tr>`;
    }).join('')}
  </tbody></table>`;
}

async function countAudience(targetRegionId, targetRole){
  let q = sb.from('profiles').select('id', {count:'exact', head:true}).eq('status','active');
  if (targetRegionId) q = q.eq('region_id', targetRegionId);
  if (targetRole) q = q.eq('role', targetRole);
  const { count } = await q;
  return count ?? 0;
}

async function acknowledgeCircular(circularId){
  const { error } = await sb.from('circular_acks').insert({ circular_id: circularId, user_id: state.user.id });
  if (error){ toast('Could not acknowledge: ' + error.message); return; }
  toast('Acknowledged');
  renderCirculars();
}

function openNewCircularModal(){
  const regionOptions = state.regions.map(r=>`<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  const roleOptions = Object.entries(ROLE_LABEL).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');
  openModal(`
    <h2>New circular</h2>
    <form id="circular-form">
      <div class="form-row"><label>Title</label><input type="text" id="c-title" required></div>
      <div class="form-row"><label>Message</label><textarea id="c-body" required></textarea></div>
      <div class="two-col">
        <div class="form-row"><label>Target region</label><select id="c-region"><option value="">All regions</option>${regionOptions}</select></div>
        <div class="form-row"><label>Target role</label><select id="c-role"><option value="">All roles</option>${roleOptions}</select></div>
      </div>
      <button class="btn-primary" type="submit">Post circular</button>
    </form>
  `);
  document.getElementById('circular-form').onsubmit = async (e) => {
    e.preventDefault();
    const title = document.getElementById('c-title').value.trim();
    const targetRegionId = document.getElementById('c-region').value || null;
    const targetRole = document.getElementById('c-role').value || null;
    const { error } = await sb.from('circulars').insert({
      title,
      body: document.getElementById('c-body').value.trim(),
      created_by: state.user.id,
      target_region_id: targetRegionId,
      target_role: targetRole
    });
    if (error){ toast('Could not post: ' + error.message); return; }
    closeModal(); toast('Circular posted'); renderCirculars();
    // Best-effort WhatsApp broadcast to everyone targeted
    let q = sb.from('profiles').select('phone').eq('status','active');
    if (targetRegionId) q = q.eq('region_id', targetRegionId);
    if (targetRole) q = q.eq('role', targetRole);
    const { data: audience } = await q;
    const phones = (audience || []).map(p=>p.phone).filter(Boolean);
    if (phones.length){
      callEdgeFunction('send_whatsapp', {
        recipients: phones,
        message: `FieldHub Circular: "${title}". Please open the portal to read and acknowledge.`
      });
    }
  };
}

// ---------------------------------------------------------
// TASKS
// ---------------------------------------------------------
let taskTab = 'mine';
async function renderTasks(){
  const main = document.getElementById('main-content');
  if (isStaff()){
    document.getElementById('topbar-actions').innerHTML = `<button class="btn" id="new-task-btn">+ Assign Task</button>`;
    document.getElementById('new-task-btn').onclick = openNewTaskModal;
  }

  let tabsHtml = '';
  if (isStaff()){
    tabsHtml = `<div class="tabs">
      <button class="tab ${taskTab==='mine'?'active':''}" data-tab="mine">Assigned to me</button>
      <button class="tab ${taskTab==='assignedByMe'?'active':''}" data-tab="assignedByMe">I assigned</button>
    </div>`;
  }

  let query = sb.from('tasks').select('*, assignee:profiles!tasks_assigned_to_fkey(full_name), assigner:profiles!tasks_assigned_by_fkey(full_name)').order('due_date', {ascending:true, nullsFirst:false});
  if (!isStaff() || taskTab==='mine') query = query.eq('assigned_to', state.user.id);
  else query = query.eq('assigned_by', state.user.id);
  const { data: tasks } = await query;

  main.innerHTML = tabsHtml + (tasks && tasks.length ? `
    <table><thead><tr><th>Title</th><th>${taskTab==='mine'?'Assigned by':'Assigned to'}</th><th>Due</th><th>Status</th><th></th></tr></thead>
    <tbody>${tasks.map(t=>`
      <tr>
        <td><strong>${escapeHtml(t.title)}</strong><div style="font-size:12.5px; color:var(--muted);">${escapeHtml(t.description||'')}</div></td>
        <td>${escapeHtml((taskTab==='mine'?t.assigner:t.assignee)?.full_name || '—')}</td>
        <td class="mono">${t.due_date || '—'}</td>
        <td><span class="badge ${t.status}">${t.status.replace('_',' ')}</span></td>
        <td>${taskStatusControls(t)}</td>
      </tr>`).join('')}</tbody></table>
  ` : emptyState('No tasks here yet.'));

  main.querySelectorAll('.tab').forEach(tb => tb.onclick = () => { taskTab = tb.dataset.tab; renderTasks(); });
  main.querySelectorAll('[data-task-status]').forEach(btn => {
    btn.onclick = async () => {
      await sb.from('tasks').update({status: btn.dataset.taskStatus}).eq('id', btn.dataset.taskId);
      renderTasks();
    };
  });
}
function taskStatusControls(t){
  if (t.status==='pending') return `<button class="btn small" data-task-id="${t.id}" data-task-status="in_progress">Start</button>`;
  if (t.status==='in_progress') return `<button class="btn small success" data-task-id="${t.id}" data-task-status="completed">Complete</button>`;
  return '';
}

async function openNewTaskModal(){
  await loadScopedProfiles();
  const options = state.profilesInScope.map(p=>`<option value="${p.id}">${escapeHtml(p.full_name)} (${ROLE_LABEL[p.role]||p.role})</option>`).join('');
  openModal(`
    <h2>Assign task</h2>
    <form id="task-form">
      <div class="form-row"><label>Title</label><input type="text" id="t-title" required></div>
      <div class="form-row"><label>Details</label><textarea id="t-desc"></textarea></div>
      <div class="form-row"><label>Assign to</label><select id="t-assignee" required>${options}</select></div>
      <div class="form-row"><label>Due date</label><input type="date" id="t-due"></div>
      <button class="btn-primary" type="submit">Assign task</button>
    </form>
  `);
  document.getElementById('task-form').onsubmit = async (e) => {
    e.preventDefault();
    const assigneeId = document.getElementById('t-assignee').value;
    const assignee = state.profilesInScope.find(p=>p.id===assigneeId);
    const { error } = await sb.from('tasks').insert({
      title: document.getElementById('t-title').value.trim(),
      description: document.getElementById('t-desc').value.trim(),
      assigned_to: assigneeId,
      assigned_by: state.user.id,
      region_id: assignee?.region_id || state.profile.region_id,
      due_date: document.getElementById('t-due').value || null
    });
    if (error){ toast('Could not assign: ' + error.message); return; }
    closeModal(); toast('Task assigned'); renderTasks();
  };
}

// ---------------------------------------------------------
// REQUESTS
// ---------------------------------------------------------
async function renderRequests(){
  const main = document.getElementById('main-content');
  if (state.profile.role === 'rider'){
    document.getElementById('topbar-actions').innerHTML = `<button class="btn" id="new-request-btn">+ New Request</button>`;
    document.getElementById('new-request-btn').onclick = openNewRequestModal;
  }

  const { data: requests } = await sb.from('requests')
    .select('*, rider:profiles!requests_rider_id_fkey(full_name), poc:profiles!requests_assigned_poc_id_fkey(full_name)')
    .order('created_at', {ascending:false});

  if (!requests || requests.length===0){ main.innerHTML = emptyState('No requests yet.'); return; }

  main.innerHTML = requests.map(r => `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <h3>${escapeHtml(r.category)}</h3>
          <div class="mono">Rider: ${escapeHtml(r.rider?.full_name||'—')} · POC: ${escapeHtml(r.poc?.full_name||'Unassigned')} · ${formatDate(r.created_at)}</div>
        </div>
        <span class="badge ${r.status}">${r.status.replace('_',' ')}</span>
      </div>
      <p style="font-size:13.5px;">${escapeHtml(r.description)}</p>
      <div id="thread-${r.id}" class="thread">Loading thread…</div>
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
        ${requestActionControls(r)}
      </div>
      <form class="reply-form" data-request-id="${r.id}" style="margin-top:10px; display:${['closed'].includes(r.status)?'none':'flex'}; gap:8px;">
        <input type="text" placeholder="Write a reply…" style="flex:1; padding:8px 10px; border:1px solid var(--line); border-radius:7px; font-size:13.5px;">
        <button class="btn small" type="submit">Send</button>
      </form>
    </div>
  `).join('');

  requests.forEach(r => loadThread(r.id));
  main.querySelectorAll('.reply-form').forEach(f => {
    f.onsubmit = async (e) => {
      e.preventDefault();
      const input = f.querySelector('input');
      if (!input.value.trim()) return;
      await sb.from('request_updates').insert({ request_id: f.dataset.requestId, message: input.value.trim(), created_by: state.user.id });
      input.value='';
      loadThread(f.dataset.requestId);
    };
  });
  main.querySelectorAll('[data-req-status]').forEach(btn => {
    btn.onclick = async () => {
      const payload = { status: btn.dataset.reqStatus };
      if (btn.dataset.reqStatus === 'closed') payload.closed_at = new Date().toISOString();
      await sb.from('requests').update(payload).eq('id', btn.dataset.reqId);
      renderRequests();
    };
  });
}

function requestActionControls(r){
  const isRider = r.rider_id === state.user.id;
  const isAssignedPoc = r.assigned_poc_id === state.user.id;
  let html = '';
  if ((isAssignedPoc || isAdmin()) && r.status==='open'){
    html += `<button class="btn small" data-req-id="${r.id}" data-req-status="in_progress">Mark In Progress</button>`;
  }
  if ((isAssignedPoc || isAdmin()) && ['open','in_progress'].includes(r.status)){
    html += `<button class="btn small success" data-req-id="${r.id}" data-req-status="resolved">Mark Resolved</button>`;
  }
  if (isRider && r.status==='resolved'){
    html += `<button class="btn small success" data-req-id="${r.id}" data-req-status="closed">Accept &amp; Close</button>`;
  }
  return html;
}

async function loadThread(requestId){
  const { data: updates } = await sb.from('request_updates').select('*, profiles(full_name)').eq('request_id', requestId).order('created_at');
  const el = document.getElementById('thread-'+requestId);
  if (!el) return;
  if (!updates || updates.length===0){ el.innerHTML = '<div style="font-size:12.5px; color:var(--muted);">No replies yet.</div>'; return; }
  el.innerHTML = updates.map(u => `
    <div class="thread-msg">${escapeHtml(u.message)}<div class="meta">${escapeHtml(u.profiles?.full_name||'—')} · ${formatDate(u.created_at)}</div></div>
  `).join('');
}

function openNewRequestModal(){
  const options = state.categories.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  openModal(`
    <h2>New request</h2>
    <form id="request-form">
      <div class="form-row"><label>Category</label><select id="r-category">${options}</select></div>
      <div class="form-row"><label>Description</label><textarea id="r-desc" required placeholder="Describe the issue…"></textarea></div>
      <button class="btn-primary" type="submit">Submit request</button>
    </form>
  `);
  document.getElementById('request-form').onsubmit = async (e) => {
    e.preventDefault();
    const categoryId = document.getElementById('r-category').value;
    const category = state.categories.find(c=>c.id===categoryId);
    const { data: inserted, error } = await sb.from('requests').insert({
      rider_id: state.user.id,
      category: category?.name || 'Other',
      category_id: categoryId,
      description: document.getElementById('r-desc').value.trim()
    }).select('*').single();
    if (error){ toast('Could not submit: ' + error.message); return; }
    closeModal(); toast('Request submitted'); renderRequests();
    // Best-effort WhatsApp alert to whoever it was routed to
    if (inserted?.assigned_poc_id){
      const { data: handler } = await sb.from('profiles').select('phone, full_name').eq('id', inserted.assigned_poc_id).single();
      if (handler?.phone){
        callEdgeFunction('send_whatsapp', {
          recipients: [handler.phone],
          message: `FieldHub: New "${category?.name || 'request'}" query from ${state.profile.full_name}. Please check the portal.`
        });
      }
    }
  };
}

// ---------------------------------------------------------
// EXPIRY TRACKER
// ---------------------------------------------------------
async function renderExpiries(){
  const main = document.getElementById('main-content');
  if (isStaff()){
    document.getElementById('topbar-actions').innerHTML = `<button class="btn" id="new-expiry-btn">+ Add Item</button>`;
    document.getElementById('new-expiry-btn').onclick = openNewExpiryModal;
  }
  const { data: items } = await sb.from('expiry_items').select('*, profiles(full_name)').order('expiry_date');
  if (!items || items.length===0){ main.innerHTML = emptyState('No expiry items tracked yet.'); return; }

  const today = new Date();
  main.innerHTML = `<table><thead><tr><th>Rider</th><th>Item</th><th>Expiry date</th><th>Status</th></tr></thead><tbody>
    ${items.map(i=>{
      const d = new Date(i.expiry_date);
      const daysLeft = Math.ceil((d-today)/(1000*60*60*24));
      let badge = 'badge active', label='OK';
      if (daysLeft < 0){ badge='badge open'; label='Overdue'; }
      else if (daysLeft <= 14){ badge='badge pending'; label=`Due in ${daysLeft}d`; }
      return `<tr>
        <td>${escapeHtml(i.profiles?.full_name||'—')}</td>
        <td>${escapeHtml(i.item_type)}${i.item_label?' — '+escapeHtml(i.item_label):''}</td>
        <td class="mono">${i.expiry_date}</td>
        <td><span class="${badge}">${label}</span></td>
      </tr>`;
    }).join('')}
  </tbody></table>`;
}

async function openNewExpiryModal(){
  await loadScopedProfiles();
  const options = state.profilesInScope.filter(p=>p.role==='rider').map(p=>`<option value="${p.id}">${escapeHtml(p.full_name)}</option>`).join('');
  const typeOptions = ITEM_TYPE_OPTIONS.map(t=>`<option value="${t}">${t}</option>`).join('');
  openModal(`
    <h2>Track expiry item</h2>
    <form id="expiry-form">
      <div class="form-row"><label>Rider</label><select id="e-rider" required>${options}</select></div>
      <div class="form-row"><label>Item type</label><select id="e-type">${typeOptions}</select></div>
      <div class="form-row"><label>Label / notes (optional)</label><input type="text" id="e-label"></div>
      <div class="form-row"><label>Expiry date</label><input type="date" id="e-date" required></div>
      <button class="btn-primary" type="submit">Save</button>
    </form>
  `);
  document.getElementById('expiry-form').onsubmit = async (e) => {
    e.preventDefault();
    const riderId = document.getElementById('e-rider').value;
    const rider = state.profilesInScope.find(p=>p.id===riderId);
    const { error } = await sb.from('expiry_items').insert({
      rider_id: riderId,
      region_id: rider?.region_id,
      item_type: document.getElementById('e-type').value,
      item_label: document.getElementById('e-label').value.trim(),
      expiry_date: document.getElementById('e-date').value
    });
    if (error){ toast('Could not save: ' + error.message); return; }
    closeModal(); toast('Item added'); renderExpiries();
  };
}

// ---------------------------------------------------------
// TEAM (pending approvals + directory)
// ---------------------------------------------------------
async function renderTeam(){
  const main = document.getElementById('main-content');
  if (isAdmin()){
    document.getElementById('topbar-actions').innerHTML = `<button class="btn" id="bulk-add-btn">+ Bulk Add Riders</button>`;
    document.getElementById('bulk-add-btn').onclick = openBulkUploadModal;
  }
  await loadScopedProfiles(true);
  const pending = state.profilesInScope.filter(p=>p.status==='pending');
  const active = state.profilesInScope.filter(p=>p.status!=='pending');

  let html = '';
  if (pending.length){
    html += `<div class="card"><h3>Pending approvals (${pending.length})</h3>
    <table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th></th></tr></thead><tbody>
    ${pending.map(p=>`<tr>
      <td>${escapeHtml(p.full_name)}</td><td class="mono">${escapeHtml(p.email)}</td><td class="mono">${escapeHtml(p.phone||'—')}</td>
      <td><button class="btn small" data-approve="${p.id}">Approve</button></td>
    </tr>`).join('')}
    </tbody></table></div>`;
  }

  html += `<div class="card"><h3>Team directory (${active.length})</h3>
  <table><thead><tr><th>Name</th><th>Role</th><th>Region</th><th>Status</th>${isAdmin()?'<th></th>':''}</tr></thead><tbody>
  ${active.map(p=>`<tr>
    <td>${escapeHtml(p.full_name)}<div class="mono">${escapeHtml(p.email)}</div></td>
    <td>${ROLE_LABEL[p.role]||'—'}</td>
    <td>${escapeHtml(state.regions.find(r=>r.id===p.region_id)?.name || '—')}</td>
    <td><span class="badge ${p.status}">${p.status}</span></td>
    ${isAdmin() ? `<td><button class="btn small outline" data-edit="${p.id}">Edit</button></td>` : ''}
  </tr>`).join('')}
  </tbody></table></div>`;

  main.innerHTML = html || emptyState('No team members yet.');

  main.querySelectorAll('[data-approve]').forEach(btn => btn.onclick = () => openApproveModal(btn.dataset.approve));
  main.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => openApproveModal(btn.dataset.edit));
}

function openApproveModal(profileId){
  const p = state.profilesInScope.find(x=>x.id===profileId);
  const regionOptions = state.regions.map(r=>`<option value="${r.id}" ${p.region_id===r.id?'selected':''}>${escapeHtml(r.name)}</option>`).join('');
  const roleOptions = Object.entries(ROLE_LABEL).map(([k,v])=>`<option value="${k}" ${p.role===k?'selected':''}>${v}</option>`).join('');
  openModal(`
    <h2>${p.status==='pending'?'Approve':'Edit'} team member</h2>
    <p class="mono">${escapeHtml(p.full_name)} · ${escapeHtml(p.email)}</p>
    <form id="approve-form">
      <div class="form-row"><label>Role</label><select id="ap-role" ${isAdmin()?'':'disabled'}>${roleOptions}</select></div>
      <div class="form-row"><label>Region</label><select id="ap-region" ${isAdmin()?'':'disabled'}>${regionOptions}</select></div>
      <div class="form-row"><label>Status</label>
        <select id="ap-status" ${isAdmin()?'':'disabled'}>
          <option value="active" ${p.status==='active'?'selected':''}>Active</option>
          <option value="pending" ${p.status==='pending'?'selected':''}>Pending</option>
          <option value="disabled" ${p.status==='disabled'?'selected':''}>Disabled</option>
        </select>
      </div>
      <button class="btn-primary" type="submit">Save</button>
    </form>
  `);
  document.getElementById('approve-form').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.from('profiles').update({
      role: document.getElementById('ap-role').value,
      region_id: document.getElementById('ap-region').value,
      status: document.getElementById('ap-status').value
    }).eq('id', profileId);
    if (error){ toast('Could not save: ' + error.message); return; }
    closeModal(); toast('Saved'); renderTeam();
  };
}

async function loadScopedProfiles(includeAll){
  let q = sb.from('profiles').select('*').order('full_name');
  const { data } = await q;
  state.profilesInScope = data || [];
}

function openBulkUploadModal(){
  const regionOptions = state.regions.map(r=>`<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  openModal(`
    <h2>Bulk add riders</h2>
    <p class="hint">Paste rows as: <strong>Mobile Number, Employee ID, Password, Full Name (optional), Bike Number (optional)</strong> — one rider per line, comma-separated. All riders in this batch will be assigned to the region you pick below.</p>
    <form id="bulk-form">
      <div class="form-row"><label>Region for this batch</label><select id="bulk-region" required>${regionOptions}</select></div>
      <div class="form-row"><label>Rider list</label><textarea id="bulk-rows" rows="8" placeholder="03001234567, EMP1001, Pass@123, Ali Khan, LEA-1234
03007654321, EMP1002, Pass@456"></textarea></div>
      <button class="btn-primary" type="submit">Create logins</button>
    </form>
    <div id="bulk-results" style="margin-top:14px;"></div>
  `);
  document.getElementById('bulk-form').onsubmit = async (e) => {
    e.preventDefault();
    const regionId = document.getElementById('bulk-region').value;
    const lines = document.getElementById('bulk-rows').value.split('\n').map(l=>l.trim()).filter(Boolean);
    const rows = lines.map(line => {
      const parts = line.split(',').map(p=>p.trim());
      return { phone: parts[0], employee_id: parts[1], password: parts[2], full_name: parts[3]||'', bike_number: parts[4]||'' };
    });
    if (!rows.length){ toast('Paste at least one rider row'); return; }
    document.getElementById('bulk-results').innerHTML = '<div class="mono">Creating logins…</div>';
    const resp = await callEdgeFunction('bulk_create_riders', { rows, region_id: regionId });
    if (resp.skipped){
      document.getElementById('bulk-results').innerHTML = `<div class="auth-message" style="display:block;">The Edge Function isn't deployed/configured yet — see SETUP_GUIDE_PART2.md for the one-time setup, then bulk upload will work.</div>`;
      return;
    }
    if (resp.error){
      document.getElementById('bulk-results').innerHTML = `<div class="auth-message" style="display:block;">${escapeHtml(resp.error)}</div>`;
      return;
    }
    const results = resp.results || [];
    document.getElementById('bulk-results').innerHTML = `<table><thead><tr><th>Mobile</th><th>Result</th></tr></thead><tbody>
      ${results.map(r=>`<tr><td class="mono">${escapeHtml(r.phone)}</td><td>${r.ok ? '<span class="badge active">Created</span>' : `<span class="badge open">Failed: ${escapeHtml(r.error||'')}</span>`}</td></tr>`).join('')}
    </tbody></table>`;
    toast(`${results.filter(r=>r.ok).length} of ${results.length} logins created`);
    renderTeam();
  };
}

// ---------------------------------------------------------
// REGIONS (admin only)
// ---------------------------------------------------------
async function renderRegions(){
  const main = document.getElementById('main-content');
  document.getElementById('topbar-actions').innerHTML = `<button class="btn" id="new-region-btn">+ Add Region</button>`;
  document.getElementById('new-region-btn').onclick = () => {
    openModal(`
      <h2>Add region</h2>
      <form id="region-form">
        <div class="form-row"><label>Region name</label><input type="text" id="reg-name" required></div>
        <button class="btn-primary" type="submit">Add</button>
      </form>
    `);
    document.getElementById('region-form').onsubmit = async (e) => {
      e.preventDefault();
      const { error } = await sb.from('regions').insert({ name: document.getElementById('reg-name').value.trim() });
      if (error){ toast('Could not add: ' + error.message); return; }
      closeModal(); toast('Region added'); await loadRegions(); renderRegions();
    };
  };

  main.innerHTML = `<table><thead><tr><th>Region</th></tr></thead><tbody>
    ${state.regions.map(r=>`<tr><td>${escapeHtml(r.name)}</td></tr>`).join('')}
  </tbody></table>`;
}

// ---------------------------------------------------------
// CATEGORIES (admin only) — decides who a request category routes to
// ---------------------------------------------------------
async function renderCategories(){
  const main = document.getElementById('main-content');
  document.getElementById('topbar-actions').innerHTML = `<button class="btn" id="new-category-btn">+ Add Category</button>`;
  document.getElementById('new-category-btn').onclick = () => openCategoryModal(null);

  const { data: cats } = await sb.from('categories').select('*').order('name');
  main.innerHTML = `<table><thead><tr><th>Category</th><th>Routes to</th><th>Status</th><th></th></tr></thead><tbody>
    ${(cats||[]).map(c=>`<tr>
      <td>${escapeHtml(c.name)}</td>
      <td>${ROLE_LABEL[c.primary_role]||c.primary_role}</td>
      <td><span class="badge ${c.active?'active':'closed'}">${c.active?'Active':'Inactive'}</span></td>
      <td><button class="btn small outline" data-edit-cat="${c.id}">Edit</button></td>
    </tr>`).join('')}
  </tbody></table>`;
  main.querySelectorAll('[data-edit-cat]').forEach(btn => {
    btn.onclick = () => openCategoryModal(cats.find(c=>c.id===btn.dataset.editCat));
  });
}

function openCategoryModal(cat){
  const roleOptions = ['regional_poc','team_lead','inventory_coordinator']
    .map(r=>`<option value="${r}" ${cat?.primary_role===r?'selected':''}>${ROLE_LABEL[r]}</option>`).join('');
  openModal(`
    <h2>${cat ? 'Edit' : 'Add'} category</h2>
    <form id="category-form">
      <div class="form-row"><label>Category name</label><input type="text" id="cat-name" value="${cat?escapeHtml(cat.name):''}" required></div>
      <div class="form-row"><label>Routes to (who handles it)</label><select id="cat-role">${roleOptions}</select></div>
      ${cat ? `<div class="form-row"><label>Status</label><select id="cat-active">
        <option value="true" ${cat.active?'selected':''}>Active</option>
        <option value="false" ${!cat.active?'selected':''}>Inactive</option>
      </select></div>` : ''}
      <button class="btn-primary" type="submit">Save</button>
    </form>
  `);
  document.getElementById('category-form').onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('cat-name').value.trim(),
      primary_role: document.getElementById('cat-role').value
    };
    if (cat) payload.active = document.getElementById('cat-active').value === 'true';
    const { error } = cat
      ? await sb.from('categories').update(payload).eq('id', cat.id)
      : await sb.from('categories').insert(payload);
    if (error){ toast('Could not save: ' + error.message); return; }
    closeModal(); toast('Saved'); await loadCategories(); renderCategories();
  };
}


function openModal(innerHtml){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'active-modal';
  overlay.innerHTML = `<div class="modal"><button class="modal-close" onclick="closeModal()">✕</button>${innerHtml}</div>`;
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
  document.body.appendChild(overlay);
}
function closeModal(){
  const m = document.getElementById('active-modal');
  if (m) m.remove();
}
function toast(msg){
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 3000);
}
function emptyState(msg){
  return `<div class="empty-state">
    <svg viewBox="0 0 200 40" class="pulse-svg"><polyline points="0,20 40,20 52,4 64,36 76,20 90,20 100,8 110,32 120,20 200,20"/></svg>
    <p>${escapeHtml(msg)}</p>
  </div>`;
}
function formatDate(iso){
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'});
}
function escapeHtml(str){
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

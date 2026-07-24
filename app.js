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
  warningTypes: [],
  expiryItemTypes: [],
  complianceItemTypes: [],
  myRegionIds: [],
  profilesInScope: [],
  view: 'dashboard'
};

const ROLE_LABEL = {
  admin: 'Area Lead / Admin',
  regional_poc: 'Regional POC',
  team_lead: 'Area Incharge',
  coordinator: 'Coordinator',
  inventory_coordinator: 'Inventory Coordinator',
  rider: 'Rider'
};

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
  bindForcePasswordForm();
  bindForgotPasswordLink();
  const { data: { session } } = await sb.auth.getSession();
  if (session){ await afterLogin(session.user); } else { showAuthScreen(); }

  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT'){ showAuthScreen(); }
  });
}

function showAuthScreen(){
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('pending-screen').style.display = 'none';
  document.getElementById('force-password-screen').style.display = 'none';
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

  if (profile.must_change_password){
    showForcedPasswordChange();
    return;
  }

  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('pending-screen').style.display = 'none';
  document.getElementById('force-password-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'flex';

  await loadRegions();
  await loadCategories();
  await loadReferenceData();
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
async function loadReferenceData(){
  const [wt, et, ct, myRegions] = await Promise.all([
    sb.from('warning_types').select('*').eq('active', true).order('name'),
    sb.from('expiry_item_types').select('*').eq('active', true).order('name'),
    sb.from('compliance_item_types').select('*').eq('active', true).order('name'),
    sb.from('profile_regions').select('region_id').eq('profile_id', state.user.id)
  ]);
  state.warningTypes = wt.data || [];
  state.expiryItemTypes = et.data || [];
  state.complianceItemTypes = ct.data || [];
  state.myRegionIds = (myRegions.data && myRegions.data.length)
    ? myRegions.data.map(r=>r.region_id)
    : (state.profile.region_id ? [state.profile.region_id] : []);
}

// ---------------------------------------------------------
// AUTH FORMS
// ---------------------------------------------------------
function bindAuthForms(){
  document.getElementById('show-signup').onclick = (e) => { e.preventDefault(); toggleAuthForms(true); };
  document.getElementById('show-login').onclick = (e) => { e.preventDefault(); toggleAuthForms(false); };

  // Digits only in phone fields — no dashes, spaces, or letters
  ['login-phone','signup-phone'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('input', () => {
      el.value = el.value.replace(/[^0-9]/g, '').slice(0, 11);
    });
  });

  // Show/Hide password toggles
  document.querySelectorAll('.password-toggle').forEach(btn => {
    btn.onclick = () => {
      const target = document.getElementById(btn.dataset.target);
      const isHidden = target.type === 'password';
      target.type = isHidden ? 'text' : 'password';
      btn.textContent = isHidden ? 'Hide' : 'Show';
    };
  });

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

function showForcedPasswordChange(){
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('pending-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'none';
  document.getElementById('force-password-screen').style.display = 'flex';
}

function bindForcePasswordForm(){
  document.getElementById('force-password-form').onsubmit = async (e) => {
    e.preventDefault();
    const pw = document.getElementById('force-new-password').value;
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error){ toast('Could not update password: ' + error.message); return; }
    await sb.from('profiles').update({ must_change_password: false }).eq('id', state.user.id);
    toast('Password updated');
    const { data: { session } } = await sb.auth.getSession();
    await afterLogin(session.user);
  };
  document.getElementById('force-password-toggle').onclick = () => {
    const input = document.getElementById('force-new-password');
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    document.getElementById('force-password-toggle').textContent = isHidden ? 'Hide' : 'Show';
  };
}

function bindForgotPasswordLink(){
  document.getElementById('show-forgot').onclick = (e) => {
    e.preventDefault();
    openModal(`
      <h2>Forgot password</h2>
      <p class="hint">Submit your mobile number and your Area Lead / Regional POC will reset it for you and let you know your temporary password.</p>
      <form id="forgot-form">
        <div class="form-row"><label>Mobile Number</label><input type="tel" id="forgot-phone" required maxlength="11" placeholder="03124244131"></div>
        <div class="form-row"><label>Note (optional)</label><textarea id="forgot-note" placeholder="Anything that helps us find your account"></textarea></div>
        <button class="btn-primary" type="submit">Submit request</button>
      </form>
    `);
    document.getElementById('forgot-phone').addEventListener('input', function(){ this.value = this.value.replace(/[^0-9]/g,'').slice(0,11); });
    document.getElementById('forgot-form').onsubmit = async (ev) => {
      ev.preventDefault();
      const { error } = await sb.from('password_reset_requests').insert({
        phone: toE164(document.getElementById('forgot-phone').value.trim()),
        note: document.getElementById('forgot-note').value.trim()
      });
      if (error){ toast('Could not submit: ' + error.message); return; }
      closeModal(); toast('Request submitted — your team will reach out to reset it.');
    };
  };
}

// ---------------------------------------------------------
// NAV
// ---------------------------------------------------------
const NAV_BY_ROLE = {
  admin: ['dashboard','circulars','tasks','requests','expiries','warnings','team','regions','settings','knowledgebase','reports','compliance'],
  regional_poc: ['dashboard','circulars','tasks','requests','expiries','warnings','team','knowledgebase','compliance'],
  team_lead: ['dashboard','circulars','tasks','requests','expiries','warnings','team','knowledgebase','compliance'],
  coordinator: ['dashboard','circulars','tasks','requests','expiries','warnings','team','knowledgebase','compliance'],
  inventory_coordinator: ['dashboard','circulars','requests','expiries','knowledgebase'],
  rider: ['dashboard','circulars','tasks','requests','expiries','warnings','knowledgebase']
};
const NAV_LABEL = {
  dashboard:'Dashboard', circulars:'Circulars', tasks:'Tasks', requests:'Requests',
  expiries:'Expiry Tracker', team:'Team', regions:'Regions', settings:'Settings',
  warnings:'Warnings', knowledgebase:'Knowledge Base', reports:'Reports', compliance:'Compliance Tracker'
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
    else if (view==='settings') await renderSettings();
    else if (view==='warnings') await renderWarnings();
    else if (view==='knowledgebase') await renderKnowledgeBase();
    else if (view==='reports') await renderReports();
    else if (view==='compliance') await renderCompliance();
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

  const [openReq, myTasks, circularsRes, expiring, pendingApprovals, notices] = await Promise.all([
    sb.from('requests').select('id', {count:'exact', head:true}).in('status', ['open','in_progress']),
    sb.from('tasks').select('id', {count:'exact', head:true}).eq('assigned_to', uid).in('status', ['pending','in_progress']),
    sb.from('circulars').select('id'),
    sb.from('expiry_items').select('id, expiry_date'),
    isAdmin() ? sb.from('profiles').select('id', {count:'exact', head:true}).eq('status','pending') : Promise.resolve({count:0}),
    sb.from('home_notices').select('*').eq('active', true).order('created_at', {ascending:false})
  ]);

  let unacked = 0;
  if (circularsRes.data && circularsRes.data.length){
    const ids = circularsRes.data.map(c=>c.id);
    const { data: myAcks } = await sb.from('circular_acks').select('circular_id').eq('user_id', uid);
    const ackedSet = new Set((myAcks||[]).map(a=>a.circular_id));
    unacked = ids.filter(id => !ackedSet.has(id)).length;
  }

  const today = new Date();
  const soonCutoff = new Date(); soonCutoff.setDate(today.getDate()+30);
  const expiringSoon = (expiring.data||[]).filter(i => new Date(i.expiry_date) <= soonCutoff).length;

  main.innerHTML = `
    ${(notices.data||[]).map(n => `<div class="card" style="border-left:4px solid var(--amber); background:#FFF8EC;"><strong>📌 ${escapeHtml(n.message)}</strong></div>`).join('')}
    <div class="grid grid-4">
      <div class="card stat-card clay"><div class="stat-number">${openReq.count ?? 0}</div><div class="stat-label">Open requests</div></div>
      <div class="card stat-card sky"><div class="stat-number">${myTasks.count ?? 0}</div><div class="stat-label">My pending tasks</div></div>
      <div class="card stat-card amber"><div class="stat-number">${unacked}</div><div class="stat-label">Unread circulars</div></div>
      <div class="card stat-card amber"><div class="stat-number">${expiringSoon}</div><div class="stat-label">Expiring within 30 days</div></div>
    </div>
    ${isAdmin() ? `
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
    const isCreator = c.created_by === state.user.id;
    const acked = ackedSet.has(c.id);
    let ackInfo = '';
    if (isAdmin() || isCreator){
      const audience = await countAudience(c.target_region_id, c.target_role, c.created_by);
      const { count: ackCount } = await sb.from('circular_acks').select('id',{count:'exact',head:true}).eq('circular_id', c.id).neq('user_id', c.created_by);
      ackInfo = `<div class="mono" style="margin-top:8px;">${ackCount ?? 0} / ${audience} acknowledged</div>
        <button class="btn small outline" style="margin-top:6px;" data-tracker="${c.id}">View tracker</button>
        <div id="tracker-${c.id}"></div>`;
    }
    rowsHtml += `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <h3>${escapeHtml(c.title)}</h3>
          ${(acked && !isCreator) ? '<span class="badge active">Acknowledged</span>' : ''}
        </div>
        <p style="font-size:13.5px; white-space:pre-wrap;">${escapeHtml(c.body)}</p>
        <div class="mono">By ${escapeHtml(c.profiles?.full_name || 'Staff')} · ${formatDateTime(c.created_at)}</div>
        ${ackInfo}
        ${(!acked && !isCreator) ? `<button class="btn small" style="margin-top:10px;" onclick="acknowledgeCircular('${c.id}')">Acknowledge</button>` : ''}
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
  let q = sb.from('profiles').select('id, full_name, role').eq('status','active').neq('id', circular.created_by);
  if (circular.target_region_id) q = q.eq('region_id', circular.target_region_id);
  if (circular.target_role) q = q.eq('role', circular.target_role);
  const { data: audience } = await q;
  const { data: acks } = await sb.from('circular_acks').select('user_id, acknowledged_at').eq('circular_id', circularId);
  const ackMap = new Map((acks||[]).map(a=>[a.user_id, a.acknowledged_at]));
  const ackedCount = (audience||[]).filter(p=>ackMap.has(p.id)).length;
  el.innerHTML = `<div class="mono" style="margin:8px 0;">Posted ${formatDateTime(circular.created_at)} · ${ackedCount} acknowledged, ${(audience||[]).length - ackedCount} pending</div>
  <table><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>When</th></tr></thead><tbody>
    ${(audience||[]).map(p=>{
      const ackedAt = ackMap.get(p.id);
      return `<tr><td>${escapeHtml(p.full_name)}</td><td>${ROLE_LABEL[p.role]||p.role}</td>
        <td>${ackedAt ? `<span class="badge active">Acknowledged</span>` : `<span class="badge open">Pending</span>`}</td>
        <td class="mono">${ackedAt ? formatDateTime(ackedAt) : '—'}</td></tr>`;
    }).join('')}
  </tbody></table>`;
}

async function countAudience(targetRegionId, targetRole, excludeId){
  let q = sb.from('profiles').select('id', {count:'exact', head:true}).eq('status','active');
  if (targetRegionId) q = q.eq('region_id', targetRegionId);
  if (targetRole) q = q.eq('role', targetRole);
  if (excludeId) q = q.neq('id', excludeId);
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
  const isRegionLocked = ['regional_poc','team_lead','coordinator'].includes(state.profile.role);
  const regionOptions = isRegionLocked
    ? `<option value="${state.profile.region_id}" selected>${escapeHtml(state.regions.find(r=>r.id===state.profile.region_id)?.name || 'Your region')}</option>`
    : `<option value="">All regions</option>` + state.regions.map(r=>`<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  const roleOptions = Object.entries(ROLE_LABEL).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');
  openModal(`
    <h2>New circular</h2>
    <form id="circular-form">
      <div class="form-row"><label>Title</label><input type="text" id="c-title" required></div>
      <div class="form-row"><label>Message</label><textarea id="c-body" required></textarea></div>
      <div class="two-col">
        <div class="form-row"><label>Target region</label><select id="c-region" ${isRegionLocked?'disabled':''}>${regionOptions}</select></div>
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
let currentRequestsList = [];
async function renderRequests(){
  const main = document.getElementById('main-content');
  if (state.profile.role === 'rider'){
    document.getElementById('topbar-actions').innerHTML = `<button class="btn" id="new-request-btn">+ New Request</button>`;
    document.getElementById('new-request-btn').onclick = openNewRequestModal;
  }

  const { data: requests } = await sb.from('requests')
    .select('*, rider:profiles!requests_rider_id_fkey(full_name), poc:profiles!requests_assigned_poc_id_fkey(full_name)')
    .order('created_at', {ascending:false});

  currentRequestsList = requests || [];
  if (!requests || requests.length===0){ main.innerHTML = emptyState('No requests yet.'); return; }

  main.innerHTML = requests.map(r => `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <h3>${escapeHtml(r.category)}</h3>
          <div class="mono">Rider: ${escapeHtml(r.rider?.full_name||'—')} · Handler: ${escapeHtml(r.poc?.full_name||'Unassigned')} · ${formatDateTime(r.created_at)}</div>
        </div>
        <span class="badge ${r.status}">${r.status.replace('_',' ')}</span>
      </div>
      <p style="font-size:13.5px;">${escapeHtml(r.description)}</p>
      <div id="thread-${r.id}" class="thread">Loading thread…</div>
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
        ${requestActionControls(r)}
      </div>
      <form class="reply-form" data-request-id="${r.id}" style="margin-top:10px; display:${['closed'].includes(r.status)?'none':'flex'}; gap:8px;">
        <input type="text" placeholder="Short remark (max 25 words)…" maxlength="180" style="flex:1; padding:8px 10px; border:1px solid var(--line); border-radius:7px; font-size:13.5px;">
        <button class="btn small" type="submit">Send</button>
      </form>
    </div>
  `).join('');

  requests.forEach(r => loadThread(r.id));
  main.querySelectorAll('.reply-form').forEach(f => {
    f.onsubmit = async (e) => {
      e.preventDefault();
      const input = f.querySelector('input');
      const text = input.value.trim();
      if (!text) return;
      if (countWords(text) > 25){ toast('Please keep remarks under 25 words'); return; }
      await sb.from('request_updates').insert({ request_id: f.dataset.requestId, message: text, created_by: state.user.id });
      input.value='';
      loadThread(f.dataset.requestId);
    };
  });
  main.querySelectorAll('[data-req-status]').forEach(btn => {
    btn.onclick = () => changeRequestStatus(btn.dataset.reqId, btn.dataset.reqStatus);
  });
}

function countWords(str){ return (str.trim().match(/\S+/g)||[]).length; }

async function changeRequestStatus(requestId, newStatus){
  const remark = window.prompt(`Add a short remark (max 25 words) for marking this as "${newStatus.replace('_',' ')}":`);
  if (remark === null) return;
  if (!remark.trim()){ toast('A remark is required'); return; }
  if (countWords(remark) > 25){ toast('Please keep remarks under 25 words'); return; }

  const payload = { status: newStatus };
  if (newStatus === 'in_progress') payload.in_progress_at = new Date().toISOString();
  if (newStatus === 'resolved') payload.resolved_at = new Date().toISOString();
  if (newStatus === 'closed') payload.closed_at = new Date().toISOString();

  const { error } = await sb.from('requests').update(payload).eq('id', requestId);
  if (error){ toast('Could not update: ' + error.message); return; }
  await sb.from('request_updates').insert({ request_id: requestId, message: remark.trim(), created_by: state.user.id });
  toast('Updated');
  renderRequests();
}

function requestActionControls(r){
  const isRider = r.rider_id === state.user.id;
  const isHandler = r.assigned_poc_id === state.user.id;
  const isRegionStaff = isStaff() && state.myRegionIds.includes(r.region_id);
  const canAct = isHandler || isAdmin() || isRegionStaff;
  let html = '';
  if (canAct && r.status==='open'){
    html += `<button class="btn small" data-req-id="${r.id}" data-req-status="in_progress">Mark In Progress</button>`;
  }
  if (canAct && ['open','in_progress'].includes(r.status)){
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
    <div class="thread-msg">${escapeHtml(u.message)}<div class="meta">${escapeHtml(u.profiles?.full_name||'—')} · ${formatDateTime(u.created_at)}</div></div>
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
  const { data: items } = await sb.from('expiry_items').select('*, profiles(full_name, phone)').order('expiry_date');
  if (!items || items.length===0){ main.innerHTML = emptyState('No expiry items tracked yet.'); return; }

  const canRemind = isAdmin() || state.profile.role === 'inventory_coordinator';
  const today = new Date();
  main.innerHTML = `<table><thead><tr><th>Rider</th><th>Item</th><th>Expiry date</th><th>Status</th>${canRemind?'<th></th>':''}</tr></thead><tbody>
    ${items.map(i=>{
      const d = new Date(i.expiry_date);
      const daysLeft = Math.ceil((d-today)/(1000*60*60*24));
      let badge = 'badge active', label='OK';
      if (daysLeft < 0){ badge='badge open'; label='Overdue'; }
      else if (daysLeft <= 30){ badge='badge pending'; label=`Due in ${daysLeft}d`; }
      return `<tr>
        <td>${escapeHtml(i.profiles?.full_name||'—')}</td>
        <td>${escapeHtml(i.item_type)}${i.item_label?' — '+escapeHtml(i.item_label):''}</td>
        <td class="mono">${i.expiry_date}</td>
        <td><span class="${badge}">${label}</span></td>
        ${canRemind ? `<td>${daysLeft<=30 ? `<button class="btn small outline" data-remind="${i.id}" data-remind-phone="${i.profiles?.phone||''}" data-remind-item="${escapeHtml(i.item_type)}">Send Reminder</button>` : ''}</td>` : ''}
      </tr>`;
    }).join('')}
  </tbody></table>`;

  main.querySelectorAll('[data-remind]').forEach(btn => {
    btn.onclick = async () => {
      const phone = btn.dataset.remindPhone;
      if (!phone){ toast('This rider has no phone on file'); return; }
      const resp = await callEdgeFunction('send_whatsapp', {
        recipients: [phone],
        message: `FieldHub reminder: your "${btn.dataset.remindItem}" is due/overdue. Please arrange the return/replacement as soon as possible.`
      });
      if (resp.skipped){ toast('WhatsApp not configured yet — see SETUP_GUIDE_PART2.md'); return; }
      toast('Reminder sent');
    };
  });
}

async function openNewExpiryModal(){
  await loadScopedProfiles();
  const options = state.profilesInScope.filter(p=>p.role==='rider').map(p=>`<option value="${p.id}">${escapeHtml(p.full_name)}</option>`).join('');
  const typeOptions = state.expiryItemTypes.map(t=>`<option value="${t.id}" data-name="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join('');
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
    const typeSelect = document.getElementById('e-type');
    const typeId = typeSelect.value;
    const typeName = typeSelect.options[typeSelect.selectedIndex]?.dataset.name || 'Other';
    const { error } = await sb.from('expiry_items').insert({
      rider_id: riderId,
      region_id: rider?.region_id,
      item_type_id: typeId,
      item_type: typeName,
      item_label: document.getElementById('e-label').value.trim(),
      expiry_date: document.getElementById('e-date').value
    });
    if (error){ toast('Could not save: ' + error.message); return; }
    closeModal(); toast('Item added'); renderExpiries();
  };
}

// ---------------------------------------------------------
// TEAM (pending approvals + directory) — view for all staff,
// but add/approve/disable/reset actions are Admin-only
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
  if (pending.length && isAdmin()){
    html += `<div class="card"><h3>Pending approvals (${pending.length})</h3>
    <table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th></th></tr></thead><tbody>
    ${pending.map(p=>`<tr>
      <td>${escapeHtml(p.full_name)}</td><td class="mono">${escapeHtml(p.email)}</td><td class="mono">${escapeHtml(p.phone||'—')}</td>
      <td><button class="btn small" data-approve="${p.id}">Approve</button></td>
    </tr>`).join('')}
    </tbody></table></div>`;
  }

  html += `<div class="card"><h3>Team directory (${active.length})</h3>
  <table><thead><tr><th>Name</th><th>Role</th><th>Region(s)</th><th>Status</th>${isAdmin()?'<th></th>':''}</tr></thead><tbody>
  ${active.map(p=>`<tr>
    <td>${escapeHtml(p.full_name)}<div class="mono">${escapeHtml(p.email||p.phone||'')}</div></td>
    <td>${ROLE_LABEL[p.role]||'—'}</td>
    <td>${escapeHtml(regionNamesFor(p))}</td>
    <td><span class="badge ${p.status}">${p.status}</span></td>
    ${isAdmin() ? `<td style="white-space:nowrap;">
      <button class="btn small outline" data-edit="${p.id}">Edit</button>
      <button class="btn small outline" data-toggle-status="${p.id}">${p.status==='disabled'?'Enable':'Disable'}</button>
      <button class="btn small outline" data-reset-pw="${p.id}">Reset Password</button>
    </td>` : ''}
  </tr>`).join('')}
  </tbody></table></div>`;

  main.innerHTML = html || emptyState('No team members yet.');

  main.querySelectorAll('[data-approve]').forEach(btn => btn.onclick = () => openApproveModal(btn.dataset.approve));
  main.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => openApproveModal(btn.dataset.edit));
  main.querySelectorAll('[data-toggle-status]').forEach(btn => btn.onclick = () => toggleMemberStatus(btn.dataset.toggleStatus));
  main.querySelectorAll('[data-reset-pw]').forEach(btn => btn.onclick = () => openResetPasswordModal(btn.dataset.resetPw));
}

function regionNamesFor(p){
  if (p.role !== 'rider' && p._regionIds && p._regionIds.length){
    return p._regionIds.map(id => state.regions.find(r=>r.id===id)?.name).filter(Boolean).join(', ') || '—';
  }
  if (p.role === 'inventory_coordinator') return 'All regions';
  return state.regions.find(r=>r.id===p.region_id)?.name || '—';
}

async function toggleMemberStatus(profileId){
  const p = state.profilesInScope.find(x=>x.id===profileId);
  const newStatus = p.status === 'disabled' ? 'active' : 'disabled';
  const { error } = await sb.from('profiles').update({ status: newStatus }).eq('id', profileId);
  if (error){ toast('Could not update: ' + error.message); return; }
  toast(newStatus === 'disabled' ? 'Account disabled' : 'Account enabled');
  renderTeam();
}

function openResetPasswordModal(profileId){
  const p = state.profilesInScope.find(x=>x.id===profileId);
  openModal(`
    <h2>Reset password</h2>
    <p class="mono">${escapeHtml(p.full_name)} · ${escapeHtml(p.phone||'')}</p>
    <form id="reset-pw-form">
      <div class="form-row"><label>New temporary password</label><input type="text" id="reset-pw-value" value="Test@123" required></div>
      <p class="hint">They'll be required to set their own password the next time they log in.</p>
      <button class="btn-primary" type="submit">Reset password</button>
    </form>
  `);
  document.getElementById('reset-pw-form').onsubmit = async (e) => {
    e.preventDefault();
    const resp = await callEdgeFunction('reset_password', { user_id: profileId, new_password: document.getElementById('reset-pw-value').value });
    if (resp.skipped){ toast('Edge Function not configured yet.'); return; }
    if (resp.error){ toast(resp.error); return; }
    closeModal(); toast('Password reset');
  };
}

async function openApproveModal(profileId){
  const p = state.profilesInScope.find(x=>x.id===profileId);
  const isMultiRegionRole = ['regional_poc','team_lead','coordinator','inventory_coordinator'].includes(p.role);
  const { data: existingRegions } = await sb.from('profile_regions').select('region_id').eq('profile_id', profileId);
  const selectedIds = new Set((existingRegions||[]).map(r=>r.region_id));
  if (!selectedIds.size && p.region_id) selectedIds.add(p.region_id);

  const roleOptions = Object.entries(ROLE_LABEL).map(([k,v])=>`<option value="${k}" ${p.role===k?'selected':''}>${v}</option>`).join('');
  const regionChecks = state.regions.map(r=>`
    <label style="display:flex; align-items:center; gap:6px; font-weight:400; margin-bottom:4px;">
      <input type="checkbox" class="ap-region-check" value="${r.id}" ${selectedIds.has(r.id)?'checked':''}> ${escapeHtml(r.name)}
    </label>`).join('');
  const singleRegionOptions = state.regions.map(r=>`<option value="${r.id}" ${p.region_id===r.id?'selected':''}>${escapeHtml(r.name)}</option>`).join('');

  openModal(`
    <h2>${p.status==='pending'?'Approve':'Edit'} team member</h2>
    <p class="mono">${escapeHtml(p.full_name)} · ${escapeHtml(p.email||p.phone||'')}</p>
    <form id="approve-form">
      <div class="form-row"><label>Role</label><select id="ap-role">${roleOptions}</select></div>
      <div class="form-row" id="ap-region-wrap">
        <label>Region(s)</label>
        <div id="ap-region-single" style="${isMultiRegionRole?'display:none;':''}">
          <select id="ap-region">${singleRegionOptions}</select>
        </div>
        <div id="ap-region-multi" style="${isMultiRegionRole?'':'display:none;'}">
          <button type="button" class="btn small outline" id="ap-select-all-regions" style="margin-bottom:8px;">Select All Regions</button>
          <div style="max-height:160px; overflow-y:auto; border:1px solid var(--line); border-radius:8px; padding:10px;">${regionChecks}</div>
        </div>
      </div>
      <div class="form-row"><label>Status</label>
        <select id="ap-status">
          <option value="active" ${p.status==='active'?'selected':''}>Active</option>
          <option value="pending" ${p.status==='pending'?'selected':''}>Pending</option>
          <option value="disabled" ${p.status==='disabled'?'selected':''}>Disabled</option>
        </select>
      </div>
      <button class="btn-primary" type="submit">Save</button>
    </form>
  `);

  document.getElementById('ap-role').onchange = (e) => {
    const multi = ['regional_poc','team_lead','coordinator','inventory_coordinator'].includes(e.target.value);
    document.getElementById('ap-region-single').style.display = multi ? 'none' : 'block';
    document.getElementById('ap-region-multi').style.display = multi ? 'block' : 'none';
  };
  document.getElementById('ap-select-all-regions').onclick = () => {
    document.querySelectorAll('.ap-region-check').forEach(cb => cb.checked = true);
  };

  document.getElementById('approve-form').onsubmit = async (e) => {
    e.preventDefault();
    const role = document.getElementById('ap-role').value;
    const status = document.getElementById('ap-status').value;
    const isMulti = ['regional_poc','team_lead','coordinator','inventory_coordinator'].includes(role);
    const singleRegionId = document.getElementById('ap-region').value || null;

    const { error } = await sb.from('profiles').update({ role, status, region_id: singleRegionId }).eq('id', profileId);
    if (error){ toast('Could not save: ' + error.message); return; }

    if (isMulti){
      const checked = Array.from(document.querySelectorAll('.ap-region-check:checked')).map(cb=>cb.value);
      await sb.from('profile_regions').delete().eq('profile_id', profileId);
      if (checked.length){
        await sb.from('profile_regions').insert(checked.map(region_id => ({ profile_id: profileId, region_id })));
      }
    } else {
      await sb.from('profile_regions').delete().eq('profile_id', profileId);
    }
    closeModal(); toast('Saved'); renderTeam();
  };
}

async function loadScopedProfiles(includeAll){
  const { data } = await sb.from('profiles').select('*').order('full_name');
  state.profilesInScope = data || [];
  // Attach each staff member's multi-region list for display purposes
  const staffIds = state.profilesInScope.filter(p=>p.role!=='rider').map(p=>p.id);
  if (staffIds.length){
    const { data: regionRows } = await sb.from('profile_regions').select('profile_id, region_id').in('profile_id', staffIds);
    const byProfile = {};
    (regionRows||[]).forEach(r => { (byProfile[r.profile_id] ||= []).push(r.region_id); });
    state.profilesInScope.forEach(p => { p._regionIds = byProfile[p.id] || []; });
  }
}

function openBulkUploadModal(){
  const regionOptions = state.regions.map(r=>`<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  openModal(`
    <h2>Bulk add riders</h2>
    <p class="hint">Paste rows as: <strong>Mobile Number, Employee ID, Password (optional), Full Name (optional), Bike Number (optional)</strong> — one rider per line, comma-separated. Leave password blank to default everyone to <strong>Test@123</strong> (they'll be required to change it on first login).</p>
    <form id="bulk-form">
      <div class="form-row"><label>Region for this batch</label><select id="bulk-region" required>${regionOptions}</select></div>
      <div class="form-row"><label>Rider list</label><textarea id="bulk-rows" rows="8" placeholder="03001234567, EMP1001
03007654321, EMP1002, , Ali Khan, LEA-1234"></textarea></div>
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
      return { phone: parts[0], employee_id: parts[1], password: parts[2]||'', full_name: parts[3]||'', bike_number: parts[4]||'' };
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
// SETTINGS (admin only) — Categories, Warning Types, Expiry Types,
// Compliance Items, Home Notice — everything configurable lives here
// ---------------------------------------------------------
let settingsTab = 'categories';
async function renderSettings(){
  const main = document.getElementById('main-content');
  document.getElementById('topbar-actions').innerHTML = '';
  const tabs = [
    ['categories','Request Categories'],
    ['warningtypes','Warning Types'],
    ['expirytypes','Expiry Item Types'],
    ['compliancetypes','Compliance Items'],
    ['notice','Home Notice']
  ];
  main.innerHTML = `<div class="tabs">
    ${tabs.map(([k,label]) => `<button class="tab ${settingsTab===k?'active':''}" data-settings-tab="${k}">${label}</button>`).join('')}
  </div><div id="settings-body"></div>`;
  main.querySelectorAll('[data-settings-tab]').forEach(btn => {
    btn.onclick = () => { settingsTab = btn.dataset.settingsTab; renderSettings(); };
  });
  const body = document.getElementById('settings-body');
  if (settingsTab === 'categories') await renderCategoriesInto(body);
  else if (settingsTab === 'warningtypes') await renderSimpleTypeList(body, 'warning_types', 'Warning Type');
  else if (settingsTab === 'expirytypes') await renderSimpleTypeList(body, 'expiry_item_types', 'Expiry Item Type');
  else if (settingsTab === 'compliancetypes') await renderSimpleTypeList(body, 'compliance_item_types', 'Compliance Item');
  else if (settingsTab === 'notice') await renderHomeNoticeSettings(body);
}

async function renderCategoriesInto(body){
  const addBtnHtml = `<button class="btn small" id="new-category-btn" style="margin-bottom:14px;">+ Add Category</button>`;
  const { data: cats } = await sb.from('categories').select('*').order('name');
  body.innerHTML = addBtnHtml + `<table><thead><tr><th>Category</th><th>Routes to</th><th>TAT (hrs)</th><th>Status</th><th></th></tr></thead><tbody>
    ${(cats||[]).map(c=>`<tr>
      <td>${escapeHtml(c.name)}</td>
      <td>${ROLE_LABEL[c.primary_role]||c.primary_role}</td>
      <td class="mono">${c.tat_hours ?? '—'}</td>
      <td><span class="badge ${c.active?'active':'closed'}">${c.active?'Active':'Inactive'}</span></td>
      <td><button class="btn small outline" data-edit-cat="${c.id}">Edit</button></td>
    </tr>`).join('')}
  </tbody></table>`;
  document.getElementById('new-category-btn').onclick = () => openCategoryModal(null);
  body.querySelectorAll('[data-edit-cat]').forEach(btn => {
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
      <div class="form-row"><label>TAT — Turn Around Time (hours)</label><input type="number" id="cat-tat" min="1" value="${cat?.tat_hours ?? ''}" placeholder="e.g. 24"></div>
      ${cat ? `<div class="form-row"><label>Status</label><select id="cat-active">
        <option value="true" ${cat.active?'selected':''}>Active</option>
        <option value="false" ${!cat.active?'selected':''}>Inactive</option>
      </select></div>` : ''}
      <button class="btn-primary" type="submit">Save</button>
    </form>
  `);
  document.getElementById('category-form').onsubmit = async (e) => {
    e.preventDefault();
    const tatVal = document.getElementById('cat-tat').value;
    const payload = {
      name: document.getElementById('cat-name').value.trim(),
      primary_role: document.getElementById('cat-role').value,
      tat_hours: tatVal ? parseInt(tatVal, 10) : null
    };
    if (cat) payload.active = document.getElementById('cat-active').value === 'true';
    const { error } = cat
      ? await sb.from('categories').update(payload).eq('id', cat.id)
      : await sb.from('categories').insert(payload);
    if (error){ toast('Could not save: ' + error.message); return; }
    closeModal(); toast('Saved'); await loadCategories(); renderSettings();
  };
}

// Generic add/enable/disable list for simple "type" tables (name + active)
async function renderSimpleTypeList(body, table, label){
  const { data: rows } = await sb.from(table).select('*').order('name');
  body.innerHTML = `<button class="btn small" id="new-type-btn" style="margin-bottom:14px;">+ Add ${label}</button>
  <table><thead><tr><th>${label}</th><th>Status</th><th></th></tr></thead><tbody>
    ${(rows||[]).map(r=>`<tr>
      <td>${escapeHtml(r.name)}</td>
      <td><span class="badge ${r.active?'active':'closed'}">${r.active?'Active':'Inactive'}</span></td>
      <td>
        <button class="btn small outline" data-toggle-type="${r.id}" data-active="${r.active}">${r.active?'Disable':'Enable'}</button>
        <button class="btn small outline" data-delete-type="${r.id}">Remove</button>
      </td>
    </tr>`).join('')}
  </tbody></table>
  <div class="hint" style="margin-top:14px;">Paste multiple at once, one per line:</div>
  <textarea id="bulk-type-rows" rows="4" style="width:100%; margin-top:8px; padding:9px 11px; border:1px solid var(--line); border-radius:7px;" placeholder="One name per line"></textarea>
  <button class="btn small" id="bulk-type-add" style="margin-top:8px;">Add All</button>`;

  document.getElementById('new-type-btn').onclick = () => {
    const name = prompt(`New ${label} name:`);
    if (name && name.trim()){
      sb.from(table).insert({ name: name.trim() }).then(({error}) => {
        if (error){ toast('Could not add: ' + error.message); return; }
        toast('Added'); refreshReferenceAndRerender(table);
      });
    }
  };
  document.getElementById('bulk-type-add').onclick = async () => {
    const names = document.getElementById('bulk-type-rows').value.split('\n').map(n=>n.trim()).filter(Boolean);
    if (!names.length) return;
    const { error } = await sb.from(table).insert(names.map(name => ({ name })));
    if (error){ toast('Could not add: ' + error.message); return; }
    toast(`${names.length} added`); refreshReferenceAndRerender(table);
  };
  body.querySelectorAll('[data-toggle-type]').forEach(btn => {
    btn.onclick = async () => {
      const newActive = btn.dataset.active !== 'true';
      const { error } = await sb.from(table).update({ active: newActive }).eq('id', btn.dataset.toggleType);
      if (error){ toast('Could not update: ' + error.message); return; }
      refreshReferenceAndRerender(table);
    };
  });
  body.querySelectorAll('[data-delete-type]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Remove this permanently?')) return;
      const { error } = await sb.from(table).delete().eq('id', btn.dataset.deleteType);
      if (error){ toast('Could not remove (it may be in use): ' + error.message); return; }
      refreshReferenceAndRerender(table);
    };
  });
}
async function refreshReferenceAndRerender(table){
  await loadReferenceData();
  renderSettings();
}

async function renderHomeNoticeSettings(body){
  const { data: notices } = await sb.from('home_notices').select('*').order('created_at', {ascending:false});
  body.innerHTML = `<button class="btn small" id="new-notice-btn" style="margin-bottom:14px;">+ Add Notice</button>
  <table><thead><tr><th>Message</th><th>Status</th><th></th></tr></thead><tbody>
    ${(notices||[]).map(n=>`<tr>
      <td>${escapeHtml(n.message)}</td>
      <td><span class="badge ${n.active?'active':'closed'}">${n.active?'Active':'Inactive'}</span></td>
      <td>
        <button class="btn small outline" data-toggle-notice="${n.id}" data-active="${n.active}">${n.active?'Disable':'Enable'}</button>
        <button class="btn small outline" data-delete-notice="${n.id}">Remove</button>
      </td>
    </tr>`).join('')}
  </tbody></table>`;
  document.getElementById('new-notice-btn').onclick = () => {
    const message = prompt('Notice text to highlight on everyone\'s Dashboard:');
    if (message && message.trim()){
      sb.from('home_notices').insert({ message: message.trim(), created_by: state.user.id }).then(({error}) => {
        if (error){ toast('Could not add: ' + error.message); return; }
        toast('Notice added'); renderSettings();
      });
    }
  };
  body.querySelectorAll('[data-toggle-notice]').forEach(btn => {
    btn.onclick = async () => {
      await sb.from('home_notices').update({ active: btn.dataset.active !== 'true' }).eq('id', btn.dataset.toggleNotice);
      renderSettings();
    };
  });
  body.querySelectorAll('[data-delete-notice]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Remove this notice?')) return;
      await sb.from('home_notices').delete().eq('id', btn.dataset.deleteNotice);
      renderSettings();
    };
  });
}

// ---------------------------------------------------------
// WARNINGS / DISCIPLINARY LOG
// ---------------------------------------------------------
async function renderWarnings(){
  const main = document.getElementById('main-content');
  if (isStaff()){
    document.getElementById('topbar-actions').innerHTML = `<button class="btn" id="new-warning-btn">+ Add Warning</button>`;
    document.getElementById('new-warning-btn').onclick = openNewWarningModal;
  }
  const { data: warnings } = await sb.from('disciplinary_actions')
    .select('*, rider:profiles!disciplinary_actions_rider_id_fkey(full_name, employee_id, region_id), recorder:profiles!disciplinary_actions_recorded_by_fkey(full_name)')
    .order('created_at', {ascending:false});

  if (!warnings || warnings.length===0){ main.innerHTML = emptyState('No warnings recorded.'); return; }

  main.innerHTML = warnings.map(w => `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <h3>${escapeHtml(w.action_type)}</h3>
        <span class="mono">${formatDate(w.created_at)}</span>
      </div>
      ${state.profile.role!=='rider' ? `<div class="mono" style="margin-bottom:8px;">
        Rider: ${escapeHtml(w.rider?.full_name||'—')} · Employee ID: ${escapeHtml(w.rider?.employee_id||'—')} · Region: ${escapeHtml(state.regions.find(r=>r.id===w.rider?.region_id)?.name||'—')}
      </div>` : ''}
      <p style="font-size:13.5px;">${escapeHtml(w.description)}</p>
      <div class="mono">Recorded by ${escapeHtml(w.recorder?.full_name||'—')}</div>
    </div>
  `).join('');
}

async function openNewWarningModal(){
  await loadScopedProfiles();
  const riders = state.profilesInScope.filter(p=>p.role==='rider');
  const options = riders.map(p=>`<option value="${p.id}" data-empid="${escapeHtml(p.employee_id||'—')}" data-region="${escapeHtml(state.regions.find(r=>r.id===p.region_id)?.name||'—')}">${escapeHtml(p.full_name)} ${p.employee_id?'('+escapeHtml(p.employee_id)+')':''}</option>`).join('');
  const typeOptions = state.warningTypes.map(t=>`<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  openModal(`
    <h2>Add warning</h2>
    <form id="warning-form">
      <div class="form-row"><label>Rider</label><select id="w-rider" required>${options}</select></div>
      <div class="form-row two-col" style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
        <div><label style="font-size:13px; font-weight:600; color:var(--ink-soft);">Employee ID</label><input type="text" id="w-empid" disabled></div>
        <div><label style="font-size:13px; font-weight:600; color:var(--ink-soft);">Region</label><input type="text" id="w-region" disabled></div>
      </div>
      <div class="form-row"><label>Type</label><select id="w-type">${typeOptions}</select></div>
      <div class="form-row"><label>Details</label><textarea id="w-desc" required placeholder="What happened, what was discussed, any outcome…"></textarea></div>
      <button class="btn-primary" type="submit">Save</button>
    </form>
  `);
  const updateReadOnly = () => {
    const sel = document.getElementById('w-rider');
    const opt = sel.options[sel.selectedIndex];
    document.getElementById('w-empid').value = opt?.dataset.empid || '';
    document.getElementById('w-region').value = opt?.dataset.region || '';
  };
  document.getElementById('w-rider').onchange = updateReadOnly;
  updateReadOnly();
  document.getElementById('warning-form').onsubmit = async (e) => {
    e.preventDefault();
    const typeId = document.getElementById('w-type').value;
    const typeName = state.warningTypes.find(t=>t.id===typeId)?.name || 'Other';
    const { error } = await sb.from('disciplinary_actions').insert({
      rider_id: document.getElementById('w-rider').value,
      warning_type_id: typeId,
      action_type: typeName,
      description: document.getElementById('w-desc').value.trim(),
      recorded_by: state.user.id
    });
    if (error){ toast('Could not save: ' + error.message); return; }
    closeModal(); toast('Warning recorded'); renderWarnings();
  };
}


// ---------------------------------------------------------
// KNOWLEDGE BASE — auto-built from circulars, plus admin-authored entries
// ---------------------------------------------------------
async function renderKnowledgeBase(){
  const main = document.getElementById('main-content');
  if (isAdmin()){
    document.getElementById('topbar-actions').innerHTML = `<button class="btn" id="new-kb-btn">+ Add Article</button>`;
    document.getElementById('new-kb-btn').onclick = openNewKbModal;
  }
  const [circularsRes, articlesRes] = await Promise.all([
    sb.from('circulars').select('id, title, body, created_at').order('created_at', {ascending:false}),
    sb.from('knowledge_base_articles').select('*, profiles(full_name)').order('created_at', {ascending:false})
  ]);
  const combined = [
    ...(circularsRes.data||[]).map(c => ({ type:'Circular', title:c.title, body:c.body, created_at:c.created_at })),
    ...(articlesRes.data||[]).map(a => ({ type:'Article', title:a.title, body:a.body, created_at:a.created_at, author:a.profiles?.full_name }))
  ].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

  if (!combined.length){ main.innerHTML = emptyState('No knowledge base entries yet.'); return; }

  main.innerHTML = `<div class="form-row"><input type="text" id="kb-search" placeholder="Search knowledge base…"></div>` +
    `<div id="kb-list">` + combined.map(e => `
    <div class="card kb-entry" data-search="${escapeHtml((e.title+' '+e.body).toLowerCase())}">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <h3>${escapeHtml(e.title)}</h3>
        <span class="badge ${e.type==='Circular'?'in_progress':'active'}">${e.type}</span>
      </div>
      <p style="font-size:13.5px; white-space:pre-wrap;">${escapeHtml(e.body)}</p>
      <div class="mono">${e.author?escapeHtml(e.author)+' · ':''}${formatDateTime(e.created_at)}</div>
    </div>`).join('') + `</div>`;

  document.getElementById('kb-search').oninput = (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.kb-entry').forEach(el => {
      el.style.display = el.dataset.search.includes(q) ? '' : 'none';
    });
  };
}

function openNewKbModal(){
  openModal(`
    <h2>Add knowledge base article</h2>
    <form id="kb-form">
      <div class="form-row"><label>Title</label><input type="text" id="kb-title" required></div>
      <div class="form-row"><label>Content</label><textarea id="kb-body" rows="6" required></textarea></div>
      <button class="btn-primary" type="submit">Save</button>
    </form>
  `);
  document.getElementById('kb-form').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.from('knowledge_base_articles').insert({
      title: document.getElementById('kb-title').value.trim(),
      body: document.getElementById('kb-body').value.trim(),
      created_by: state.user.id
    });
    if (error){ toast('Could not save: ' + error.message); return; }
    closeModal(); toast('Article added'); renderKnowledgeBase();
  };
}

// ---------------------------------------------------------
// COMPLIANCE TRACKER — monthly Temperature/Inventory sheet submissions
// ---------------------------------------------------------
function currentPeriod(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

async function renderCompliance(){
  const main = document.getElementById('main-content');
  const period = currentPeriod();
  if (state.profile.role === 'rider'){
    const { data: mySubs } = await sb.from('compliance_submissions').select('*').eq('rider_id', state.user.id).eq('period', period);
    const submittedIds = new Set((mySubs||[]).map(s=>s.item_type_id));
    main.innerHTML = `<div class="card"><h3>This month (${period})</h3>
      <table><thead><tr><th>Item</th><th>Status</th><th></th></tr></thead><tbody>
      ${state.complianceItemTypes.map(t => `<tr>
        <td>${escapeHtml(t.name)}</td>
        <td>${submittedIds.has(t.id) ? '<span class="badge active">Submitted</span>' : '<span class="badge open">Pending</span>'}</td>
        <td>${!submittedIds.has(t.id) ? `<button class="btn small" data-submit-compliance="${t.id}">Mark Submitted</button>` : ''}</td>
      </tr>`).join('')}
      </tbody></table></div>`;
    main.querySelectorAll('[data-submit-compliance]').forEach(btn => {
      btn.onclick = async () => {
        const { error } = await sb.from('compliance_submissions').insert({
          rider_id: state.user.id, region_id: state.profile.region_id,
          item_type_id: btn.dataset.submitCompliance, period
        });
        if (error){ toast('Could not submit: ' + error.message); return; }
        toast('Marked as submitted'); renderCompliance();
      };
    });
    return;
  }

  // Staff/Admin view: who has/hasn't submitted this month, in their scope
  await loadScopedProfiles();
  const riders = state.profilesInScope.filter(p=>p.role==='rider');
  const { data: subs } = await sb.from('compliance_submissions').select('*').eq('period', period);
  const subMap = new Map((subs||[]).map(s => [s.rider_id+'|'+s.item_type_id, s.submitted_at]));

  main.innerHTML = `<div class="card"><h3>Compliance for ${period}</h3>
    <table><thead><tr><th>Rider</th><th>Region</th>${state.complianceItemTypes.map(t=>`<th>${escapeHtml(t.name)}</th>`).join('')}</tr></thead><tbody>
    ${riders.map(r => `<tr>
      <td>${escapeHtml(r.full_name)}</td>
      <td>${escapeHtml(state.regions.find(rg=>rg.id===r.region_id)?.name||'—')}</td>
      ${state.complianceItemTypes.map(t => {
        const submitted = subMap.get(r.id+'|'+t.id);
        return `<td>${submitted ? `<span class="badge active">✓ ${formatDate(submitted)}</span>` : '<span class="badge open">Pending</span>'}</td>`;
      }).join('')}
    </tr>`).join('')}
    </tbody></table></div>`;
}

// ---------------------------------------------------------
// REPORTS — CSV export for any date range (Admin)
// ---------------------------------------------------------
async function renderReports(){
  const main = document.getElementById('main-content');
  const today = new Date().toISOString().slice(0,10);
  const monthAgo = new Date(Date.now() - 30*24*60*60*1000).toISOString().slice(0,10);
  main.innerHTML = `
    <div class="card">
      <h3>Download a report</h3>
      <div class="two-col">
        <div class="form-row"><label>Report type</label><select id="rep-type">
          <option value="requests">Requests (with TAT)</option>
          <option value="tasks">Tasks</option>
          <option value="circulars">Circulars &amp; Acknowledgments</option>
          <option value="expiry">Expiry Items</option>
          <option value="warnings">Warnings</option>
        </select></div>
        <div></div>
        <div class="form-row"><label>From</label><input type="date" id="rep-from" value="${monthAgo}"></div>
        <div class="form-row"><label>To</label><input type="date" id="rep-to" value="${today}"></div>
      </div>
      <button class="btn-primary" id="rep-download-btn" style="width:auto; padding:10px 20px;">Download CSV</button>
      <div id="rep-status" class="mono" style="margin-top:10px;"></div>
    </div>
  `;
  document.getElementById('rep-download-btn').onclick = generateReport;
}

function toCSV(rows){
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => `"${String(v ?? '').replace(/"/g,'""')}"`;
  return [headers.join(','), ...rows.map(r => headers.map(h=>escape(r[h])).join(','))].join('\n');
}
function downloadCSV(filename, csv){
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

async function generateReport(){
  const type = document.getElementById('rep-type').value;
  const from = document.getElementById('rep-from').value;
  const to = document.getElementById('rep-to').value + 'T23:59:59';
  const statusEl = document.getElementById('rep-status');
  statusEl.textContent = 'Generating…';

  let rows = [];
  if (type === 'requests'){
    const { data } = await sb.from('requests')
      .select('*, rider:profiles!requests_rider_id_fkey(full_name, employee_id), poc:profiles!requests_assigned_poc_id_fkey(full_name), categories(name, tat_hours)')
      .gte('created_at', from).lte('created_at', to);
    rows = (data||[]).map(r => {
      const hoursToResolve = r.resolved_at ? ((new Date(r.resolved_at) - new Date(r.created_at))/3600000).toFixed(1) : '';
      const hoursToClose = r.closed_at ? ((new Date(r.closed_at) - new Date(r.created_at))/3600000).toFixed(1) : '';
      return {
        Category: r.category, Rider: r.rider?.full_name, 'Employee ID': r.rider?.employee_id,
        Handler: r.poc?.full_name, Status: r.status,
        'Created At': r.created_at, 'In Progress At': r.in_progress_at||'', 'Resolved At': r.resolved_at||'', 'Closed At': r.closed_at||'',
        'TAT Target (hrs)': r.categories?.tat_hours ?? '', 'Hours To Resolve': hoursToResolve, 'Hours To Close': hoursToClose
      };
    });
  } else if (type === 'tasks'){
    const { data } = await sb.from('tasks')
      .select('*, assignee:profiles!tasks_assigned_to_fkey(full_name), assigner:profiles!tasks_assigned_by_fkey(full_name)')
      .gte('created_at', from).lte('created_at', to);
    rows = (data||[]).map(t => ({
      Title: t.title, 'Assigned To': t.assignee?.full_name, 'Assigned By': t.assigner?.full_name,
      Status: t.status, 'Due Date': t.due_date||'', 'Created At': t.created_at
    }));
  } else if (type === 'circulars'){
    const { data } = await sb.from('circulars').select('*, profiles!circulars_created_by_fkey(full_name)').gte('created_at', from).lte('created_at', to);
    for (const c of (data||[])){
      const audience = await countAudience(c.target_region_id, c.target_role, c.created_by);
      const { count: ackCount } = await sb.from('circular_acks').select('id',{count:'exact',head:true}).eq('circular_id', c.id).neq('user_id', c.created_by);
      rows.push({ Title: c.title, 'Posted By': c.profiles?.full_name, 'Posted At': c.created_at, Audience: audience, Acknowledged: ackCount ?? 0, Pending: audience - (ackCount??0) });
    }
  } else if (type === 'expiry'){
    const { data } = await sb.from('expiry_items').select('*, profiles(full_name)').gte('created_at', from).lte('created_at', to);
    rows = (data||[]).map(i => ({ Rider: i.profiles?.full_name, Item: i.item_type, Label: i.item_label||'', 'Expiry Date': i.expiry_date, 'Added At': i.created_at }));
  } else if (type === 'warnings'){
    const { data } = await sb.from('disciplinary_actions').select('*, rider:profiles!disciplinary_actions_rider_id_fkey(full_name, employee_id), recorder:profiles!disciplinary_actions_recorded_by_fkey(full_name)').gte('created_at', from).lte('created_at', to);
    rows = (data||[]).map(w => ({ Rider: w.rider?.full_name, 'Employee ID': w.rider?.employee_id, Type: w.action_type, Description: w.description, 'Recorded By': w.recorder?.full_name, 'Created At': w.created_at }));
  }

  if (!rows.length){ statusEl.textContent = 'No records found for that range.'; return; }
  downloadCSV(`fieldhub-${type}-${from}-to-${to.slice(0,10)}.csv`, toCSV(rows));
  statusEl.textContent = `Downloaded ${rows.length} rows.`;
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
function formatDateTime(iso){
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'});
}
function escapeHtml(str){
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

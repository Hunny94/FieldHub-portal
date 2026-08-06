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
  myPermissions: new Set(),
  profilesInScope: [],
  branding: null,
  notifications: [],
  view: 'dashboard'
};

const ROLE_LABEL = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  regional_poc: 'Regional POC',
  team_lead: 'Area Incharge',
  coordinator: 'Coordinator',
  inventory_coordinator: 'Inventory Coordinator',
  rider: 'Rider'
};

// Convert a Pakistani local number (03xx-xxxxxxx) to +92 E.164 format,
// since Supabase Auth phone login needs international format.
function toProperCase(str){
  if (!str) return str;
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

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
  bindProfileMenu();
  await applyBrandingSettings();
  const { data: { session } } = await sb.auth.getSession();
  if (session){ await afterLogin(session.user); } else { showAuthScreen(); }
  const bootLoading = document.getElementById('boot-loading');
  if (bootLoading) bootLoading.remove();

  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT'){ showAuthScreen(); }
  });
}

async function applyBrandingSettings(){
  try{
    const { data } = await sb.from('branding_settings').select('*').eq('id', 1).single();
    if (!data) return;
    state.branding = data;
    const setText = (id, val) => { const el = document.getElementById(id); if (el && val) el.textContent = val; };
    setText('auth-tagline', data.tagline);
    setText('auth-subtitle', data.subtitle);
    setText('login-title-text', data.login_title);
    setText('login-subtitle-text', data.login_subtitle);

    if (data.logo_url){
      document.querySelectorAll('.auth-logo-img, .brand-logo, .ribbon-logo').forEach(img => { img.src = data.logo_url; });
    }
    if (data.sidebar_bg_url){
      const sidebar = document.querySelector('.sidebar');
      if (sidebar) sidebar.style.backgroundImage = `linear-gradient(rgba(27,37,96,0.93), rgba(27,37,96,0.93)), url('${data.sidebar_bg_url}')`;
    }
    if (data.login_bg_url){
      const authLeft = document.querySelector('.auth-left');
      if (authLeft) authLeft.style.backgroundImage = `linear-gradient(rgba(20,28,80,0.88), rgba(20,28,80,0.88)), url('${data.login_bg_url}')`;
    }
  }catch(_e){ /* table may not exist yet if migration_6/7 hasn't run — fall back to defaults already in HTML */ }
}

function showAuthScreen(){
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('pending-screen').style.display = 'none';
  document.getElementById('force-password-screen').style.display = 'none';
  document.getElementById('maintenance-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'none';
}

async function afterLogin(user){
  state.user = user;
  const { data: profile, error } = await sb.from('profiles').select('*, regions!region_id(name)').eq('id', user.id).single();
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

  // Maintenance mode: only Super Admin can get past this
  const { data: sysSettings } = await sb.from('system_settings').select('*').eq('id', 1).maybeSingle();
  if (sysSettings && !sysSettings.portal_active && profile.role !== 'super_admin'){
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('pending-screen').style.display = 'none';
    document.getElementById('force-password-screen').style.display = 'none';
    document.getElementById('app-shell').style.display = 'none';
    document.getElementById('maintenance-message').textContent = sysSettings.maintenance_message || 'FieldHub is temporarily unavailable for maintenance. Please check back shortly.';
    document.getElementById('maintenance-screen').style.display = 'flex';
    return;
  }

  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('pending-screen').style.display = 'none';
  document.getElementById('force-password-screen').style.display = 'none';
  document.getElementById('maintenance-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'flex';

  await loadRegions();
  await loadCategories();
  await loadReferenceData();
  renderNav();
  renderUserBadge();
  const allowedViews = getAllowedViews();
  const hashView = location.hash.replace('#','');
  navigateTo(allowedViews.includes(hashView) ? hashView : 'dashboard');
  showLatestUnackedCircularPopup();
  showPendingRemindersBanner();
  showPendingPopupAnnouncement();
  loadAndShowNotifications();
  setupDesktopNotifications();
  setupSessionTimeout();
}

window.addEventListener('hashchange', () => {
  if (!state.profile) return;
  const view = location.hash.replace('#','');
  const allowedViews = getAllowedViews();
  if (view && allowedViews.includes(view) && view !== state.view) navigateTo(view);
});

let sessionTimeoutTimer = null;
function setupSessionTimeout(){
  const minutes = (state.systemSettings && state.systemSettings.session_timeout_minutes) || 15;
  const TIMEOUT_MS = minutes * 60 * 1000;
  const reset = () => {
    if (sessionTimeoutTimer) clearTimeout(sessionTimeoutTimer);
    sessionTimeoutTimer = setTimeout(() => {
      toast(`You were signed out after ${minutes} minutes of inactivity.`);
      doLogout();
    }, TIMEOUT_MS);
  };
  ['mousemove','keydown','click','scroll','touchstart'].forEach(evt => {
    document.addEventListener(evt, reset, { passive: true });
  });
  reset();
}

function setupDesktopNotifications(){
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') Notification.requestPermission();
  if (Notification.permission !== 'granted') return;

  // New circulars — notify everyone
  sb.channel('circulars-notify')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'circulars' }, (payload) => {
      if (payload.new.created_by === state.user.id) return;
      new Notification('FieldHub: New Circular', { body: payload.new.title });
    })
    .subscribe();

  // New requests assigned directly to me — notify the handler
  sb.channel('requests-notify-' + state.user.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'requests', filter: `assigned_poc_id=eq.${state.user.id}` }, (payload) => {
      new Notification('FieldHub: New Request', { body: `New "${payload.new.category}" request needs your attention.` });
    })
    .subscribe();
}

async function showLatestUnackedCircularPopup(){
  const { data: circulars } = await sb.from('circulars').select('*').order('created_at', {ascending:false}).limit(1);
  if (!circulars || !circulars.length) return;
  const c = circulars[0];
  if (c.created_by === state.user.id) return;
  const { data: ack } = await sb.from('circular_acks').select('id').eq('circular_id', c.id).eq('user_id', state.user.id).maybeSingle();
  if (ack) return;
  openModal(`
    <h2>📢 ${escapeHtml(c.title)}</h2>
    <div class="mono" style="margin-bottom:10px;">${formatDateTime(c.created_at)}</div>
    <p style="font-size:14px; white-space:pre-wrap;">${escapeHtml(c.body)}</p>
    <button class="btn-primary" id="popup-ack-btn">Acknowledge</button>
  `);
  document.getElementById('popup-ack-btn').onclick = async () => {
    await sb.from('circular_acks').insert({ circular_id: c.id, user_id: state.user.id });
    closeModal(); toast('Acknowledged');
  };
}

async function showPendingRemindersBanner(){
  if (!['inventory_coordinator','regional_poc','team_lead','coordinator','admin','super_admin'].includes(state.profile.role)) return;
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate()+30);
  const cutoffStr = cutoff.toISOString().slice(0,10);
  let expiryQ = sb.from('expiry_items').select('id', {count:'exact', head:true}).lte('expiry_date', cutoffStr);
  let toolQ = sb.from('tool_issuances').select('id', {count:'exact', head:true}).lte('next_due_date', cutoffStr);
  const [{count: expCount}, {count: toolCount}] = await Promise.all([expiryQ, toolQ]);
  if (expCount) toast(`⚠️ ${expCount} expiry item(s) due/overdue — check Expiry Tracker`);
  if (toolCount) toast(`⚠️ ${toolCount} tool(s) due/overdue for reissue — check Tool Issuance`);
}

// ---------------------------------------------------------
// NOTIFICATIONS — a small bell near the profile/sign-out buttons
// showing the most recent items relevant to this person (new
// circulars, status updates on their requests/tasks, warnings issued
// to them). Each item is its own notification, shown as its own toast
// on login, rather than one combined summary line.
// ---------------------------------------------------------
async function loadAndShowNotifications(){
  const retainCount = state.systemSettings?.notification_retain_count || 5;
  const since = state.profile.notifications_last_seen_at || new Date(Date.now() - 3*24*60*60*1000).toISOString();

  const items = [];
  const { data: newCirculars } = await sb.from('circulars').select('id, title, created_at, created_by').gt('created_at', since).order('created_at', {ascending:false}).limit(20);
  (newCirculars||[]).filter(c=>c.created_by!==state.user.id).forEach(c => items.push({ type:'Circular', title:'New circular', body:c.title, created_at:c.created_at }));

  const { data: myRequests } = await sb.from('requests').select('id, category').or(`rider_id.eq.${state.user.id},assigned_poc_id.eq.${state.user.id}`);
  const myRequestIds = (myRequests||[]).map(r=>r.id);
  if (myRequestIds.length){
    const { data: reqUpdates } = await sb.from('request_updates').select('*, profiles(full_name)').in('request_id', myRequestIds).gt('created_at', since).neq('created_by', state.user.id).order('created_at', {ascending:false}).limit(20);
    (reqUpdates||[]).forEach(u => items.push({ type:'Request update', title:`${u.profiles?.full_name||'Someone'} updated a request`, body: u.new_status ? `Status → ${u.new_status.replace('_',' ')}: ${u.message}` : u.message, created_at:u.created_at }));
  }

  const { data: myTasks } = await sb.from('tasks').select('id').or(`assigned_to.eq.${state.user.id},assigned_by.eq.${state.user.id}`);
  const myTaskIds = (myTasks||[]).map(t=>t.id);
  if (myTaskIds.length){
    const { data: taskUpdates } = await sb.from('task_updates').select('*, profiles(full_name)').in('task_id', myTaskIds).gt('created_at', since).neq('created_by', state.user.id).order('created_at', {ascending:false}).limit(20);
    (taskUpdates||[]).forEach(u => items.push({ type:'Task update', title:`${u.profiles?.full_name||'Someone'} updated a task`, body: u.new_status ? `Status → ${u.new_status.replace('_',' ')}: ${u.message}` : u.message, created_at:u.created_at }));
  }

  if (state.profile.role !== 'admin' && state.profile.role !== 'super_admin'){
    const { data: myWarnings } = await sb.from('disciplinary_actions').select('*, recorder:profiles!recorded_by(full_name)').eq('rider_id', state.user.id).gt('created_at', since).order('created_at', {ascending:false}).limit(20);
    (myWarnings||[]).forEach(w => items.push({ type:'Warning', title:`Warning issued by ${w.recorder?.full_name||'—'}`, body: w.action_type, created_at:w.created_at }));
  }

  items.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  state.notifications = items.slice(0, retainCount);

  // Each item gets its own toast, instead of one combined line
  state.notifications.forEach(n => toast(`${n.title}: ${n.body}`));

  ensureNotificationBell();
  updateNotificationBadge();
}

function ensureNotificationBell(){
  if (document.getElementById('notif-bell-btn')) return;
  const actions = document.querySelector('.top-ribbon-actions');
  const logoutBtn = document.getElementById('logout-btn');
  if (!actions || !logoutBtn) return;
  const btn = document.createElement('button');
  btn.id = 'notif-bell-btn';
  btn.className = 'ribbon-link';
  btn.style.position = 'relative';
  btn.innerHTML = `🔔<span id="notif-badge" style="display:none; position:absolute; top:2px; right:2px; background:#c0392b; color:#fff; border-radius:50%; font-size:10px; line-height:1; padding:2px 5px;">0</span>`;
  actions.insertBefore(btn, logoutBtn);
  btn.onclick = (e) => { e.stopPropagation(); toggleNotificationDropdown(); };
}

function updateNotificationBadge(){
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  const n = state.notifications.length;
  badge.style.display = n ? 'block' : 'none';
  badge.textContent = n;
}

function toggleNotificationDropdown(){
  const existing = document.getElementById('notif-dropdown');
  if (existing){ existing.remove(); return; }
  const bell = document.getElementById('notif-bell-btn');
  if (!bell) return;
  const rect = bell.getBoundingClientRect();
  const dropdown = document.createElement('div');
  dropdown.id = 'notif-dropdown';
  dropdown.style.cssText = `position:fixed; top:${rect.bottom+6}px; right:${window.innerWidth-rect.right}px; width:320px; max-height:400px; overflow-y:auto; background:#fff; border:1px solid var(--line); border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,0.15); z-index:5000; padding:10px;`;
  dropdown.innerHTML = state.notifications.length
    ? state.notifications.map(n => `<div style="padding:9px 6px; border-bottom:1px solid var(--line);">
        <div style="font-weight:600; font-size:13px;">${escapeHtml(n.title)}</div>
        <div style="font-size:12.5px; color:var(--muted);">${escapeHtml(n.body||'')}</div>
        <div class="mono" style="font-size:11px; margin-top:2px;">${formatDateTime(n.created_at)}</div>
      </div>`).join('')
    : `<div style="padding:14px; color:var(--muted); font-size:13px;">No recent notifications.</div>`;
  document.body.appendChild(dropdown);
  // Mark as seen so these don't repeat next login
  sb.from('profiles').update({ notifications_last_seen_at: new Date().toISOString() }).eq('id', state.user.id);
  state.profile.notifications_last_seen_at = new Date().toISOString();
  const closeOnOutside = (e) => {
    if (!dropdown.contains(e.target) && e.target.id !== 'notif-bell-btn'){
      dropdown.remove();
      document.removeEventListener('click', closeOnOutside);
    }
  };
  setTimeout(() => document.addEventListener('click', closeOnOutside), 10);
}

async function showPendingPopupAnnouncement(){
  const { data: popups } = await sb.from('popup_announcements').select('*').eq('active', true).order('created_at', {ascending:false});
  if (!popups || !popups.length) return;
  const { data: dismissed } = await sb.from('popup_dismissals').select('popup_id').eq('user_id', state.user.id);
  const dismissedSet = new Set((dismissed||[]).map(d=>d.popup_id));
  const next = popups.find(p => !dismissedSet.has(p.id));
  if (!next) return;
  openModal(`
    <h2>${escapeHtml(next.title)}</h2>
    <p style="font-size:14px; white-space:pre-wrap;">${escapeHtml(next.body)}</p>
    <button class="btn-primary" id="popup-announcement-dismiss">Got it</button>
  `);
  const dismiss = async () => { await sb.from('popup_dismissals').insert({ popup_id: next.id, user_id: state.user.id }); };
  document.getElementById('popup-announcement-dismiss').onclick = async () => { await dismiss(); closeModal(); };
  // Also record dismissal if they close via the modal's own ✕ button
  const modalCloseBtn = document.querySelector('#active-modal .modal-close');
  if (modalCloseBtn) modalCloseBtn.addEventListener('click', dismiss, { once: true });
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
  const [wt, et, ct, myRegions, myPerms, sys] = await Promise.all([
    sb.from('warning_types').select('*').eq('active', true).order('name'),
    sb.from('expiry_item_types').select('*').eq('active', true).order('name'),
    sb.from('compliance_item_types').select('*').eq('active', true).order('name'),
    sb.from('profile_regions').select('region_id').eq('profile_id', state.user.id),
    sb.from('custom_permissions').select('permission_key').eq('profile_id', state.user.id),
    sb.from('system_settings').select('*').eq('id', 1).maybeSingle()
  ]);
  state.warningTypes = wt.data || [];
  state.expiryItemTypes = et.data || [];
  state.complianceItemTypes = ct.data || [];
  state.myRegionIds = (myRegions.data && myRegions.data.length)
    ? myRegions.data.map(r=>r.region_id)
    : (state.profile.region_id ? [state.profile.region_id] : []);
  state.myPermissions = new Set((myPerms.data || []).map(p => p.permission_key));
  state.systemSettings = sys.data || {};
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

  // Show/hide Bike Number based on selected Designation
  const designationSelect = document.getElementById('signup-designation');
  const bikeWrap = document.getElementById('signup-bike-wrap');
  const updateBikeVisibility = () => { bikeWrap.style.display = designationSelect.value === 'rider' ? 'block' : 'none'; };
  designationSelect.onchange = updateBikeVisibility;
  updateBikeVisibility();

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
    const full_name = toProperCase(document.getElementById('signup-name').value.trim());
    const requested_role = document.getElementById('signup-designation').value;
    const employee_id = document.getElementById('signup-empid').value.trim();
    const phone = toE164(document.getElementById('signup-phone').value.trim());
    const email = document.getElementById('signup-email').value.trim();
    const bike_number = requested_role === 'rider' ? document.getElementById('signup-bike').value.trim() : '';
    const password = document.getElementById('signup-password').value;

    const { data: existing } = await sb.rpc('check_employee_id', { p_employee_id: employee_id });
    if (existing && existing.length){
      showAuthMessage(`Employee ID "${employee_id}" is already registered to ${existing[0].full_name} (${existing[0].phone}). Each Employee ID can only be used once.`);
      return;
    }

    const { data, error } = await sb.auth.signUp({
      phone, password, options: { data: { full_name, requested_role } }
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
  document.getElementById('maintenance-logout').onclick = doLogout;
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
  const phoneEl = document.getElementById('login-phone');
  const pwEl = document.getElementById('login-password');
  if (phoneEl) phoneEl.value = '';
  if (pwEl) pwEl.value = '';
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
  super_admin: ['dashboard','circulars','tasks','requests','expiries','tools','warnings','roster','team','regions','settings','knowledgebase','resources','reports','compliance','activitylog','releasenotes'],
  admin: ['dashboard','circulars','tasks','requests','expiries','tools','warnings','roster','team','regions','settings','knowledgebase','resources','reports','compliance','releasenotes'],
  regional_poc: ['dashboard','circulars','tasks','requests','expiries','tools','warnings','roster','team','knowledgebase','resources','compliance','releasenotes'],
  team_lead: ['dashboard','circulars','tasks','requests','expiries','tools','warnings','roster','team','knowledgebase','resources','compliance','releasenotes'],
  coordinator: ['dashboard','circulars','tasks','requests','expiries','tools','warnings','roster','team','knowledgebase','resources','compliance','releasenotes'],
  inventory_coordinator: ['dashboard','circulars','tasks','requests','expiries','tools','roster','knowledgebase','resources','releasenotes'],
  rider: ['dashboard','circulars','tasks','requests','expiries','tools','warnings','roster','knowledgebase','resources','releasenotes']
};
// A granted custom_permission can unlock a whole nav item (e.g. Settings,
// Regions, Reports) for a role that wouldn't normally see it at all —
// without this, granting e.g. 'categories_add' to a Coordinator would be
// useless because they could never navigate to Settings in the first place.
function getAllowedViews(){
  const base = NAV_BY_ROLE[state.profile.role] || ['dashboard'];
  if (isAdmin()) return base;
  const extra = [];
  const settingsKeys = ['categories_add','categories_edit','categories_remove','manage_types','circular_categories_manage'];
  const regionsKeys = ['regions_add','regions_edit','regions_remove'];
  if (!base.includes('settings') && settingsKeys.some(k => hasPermission(k))) extra.push('settings');
  if (!base.includes('regions') && regionsKeys.some(k => hasPermission(k))) extra.push('regions');
  if (!base.includes('reports') && hasPermission('export_active_employees')) extra.push('reports');
  return [...base, ...extra];
}
const NAV_LABEL = {
  dashboard:'Dashboard', circulars:'Circulars', tasks:'Tasks', requests:'Requests',
  expiries:'Expiry Tracker', tools:'Tool Issuance', roster:'Roster', team:'Team', regions:'Regions', settings:'Settings',
  warnings:'Warnings', knowledgebase:'Knowledge Base', resources:'Resource Links', reports:'Reports',
  compliance:'Compliance Tracker', activitylog:'Activity Log', releasenotes:"What's New"
};
// Groups the sidebar into collapsible sections. 'dashboard' always stands alone at top.
const NAV_GROUPS = [
  { label: null, items: ['dashboard'] },
  { label: 'Operations', items: ['circulars','tasks','requests'] },
  { label: 'Inventory', items: ['expiries','tools'] },
  { label: 'People', items: ['team','warnings','compliance','roster'] },
  { label: 'Knowledge', items: ['knowledgebase','resources','releasenotes'] },
  { label: 'Admin', items: ['regions','settings','reports','activitylog'] }
];

function renderNav(){
  const items = getAllowedViews();
  const nav = document.getElementById('nav-links');
  let html = '';
  NAV_GROUPS.forEach(group => {
    const visible = group.items.filter(k => items.includes(k));
    if (!visible.length) return;
    if (!group.label){
      html += visible.map(key => `<a href="#${key}" class="nav-link" data-view="${key}">${NAV_LABEL[key]}</a>`).join('');
    } else {
      const groupId = 'grp-' + group.label.replace(/\s+/g,'-').toLowerCase();
      const isOpen = visible.includes(state.view);
      html += `
        <button class="nav-group-header ${isOpen?'':'collapsed'}" data-group-toggle="${groupId}">
          <span>${group.label}</span><span class="nav-group-arrow">▾</span>
        </button>
        <div class="nav-group-items ${isOpen?'':'collapsed'}" id="${groupId}">
          ${visible.map(key => `<a href="#${key}" class="nav-link" data-view="${key}">${NAV_LABEL[key]}</a>`).join('')}
        </div>`;
    }
  });
  nav.innerHTML = html;
  nav.querySelectorAll('.nav-link').forEach(a => {
    a.onclick = (e) => { e.preventDefault(); navigateTo(a.dataset.view); };
  });
  nav.querySelectorAll('[data-group-toggle]').forEach(btn => {
    btn.onclick = () => {
      const targetEl = document.getElementById(btn.dataset.groupToggle);
      const wasCollapsed = targetEl.classList.contains('collapsed');
      // Accordion: close every other group first
      nav.querySelectorAll('.nav-group-items').forEach(el => el.classList.add('collapsed'));
      nav.querySelectorAll('.nav-group-header').forEach(b => b.classList.add('collapsed'));
      if (wasCollapsed){
        targetEl.classList.remove('collapsed');
        btn.classList.remove('collapsed');
      }
    };
  });
}
function renderUserBadge(){
  const nameEl = document.getElementById('ribbon-profile-name');
  if (nameEl) nameEl.textContent = state.profile.full_name || state.profile.email || 'Profile';
}

function bindProfileMenu(){
  const btn = document.getElementById('ribbon-profile-btn');
  if (btn) btn.onclick = () => navigateTo('myprofile');
  const homeBtn = document.getElementById('ribbon-home-btn');
  if (homeBtn) homeBtn.onclick = () => navigateTo('dashboard');
}

async function navigateTo(view){
  if (location.hash !== '#'+view) history.pushState(null, '', '#'+view);
  state.view = view;
  document.querySelectorAll('.nav-link').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('view-title').textContent = NAV_LABEL[view] || 'My Profile';
  document.getElementById('topbar-actions').innerHTML = '';
  const main = document.getElementById('main-content');
  main.innerHTML = `<div class="empty-state"><div class="spinner"></div>Loading…</div>`;
  try{
    if (view==='dashboard') await renderDashboard();
    else if (view==='circulars') await renderCirculars();
    else if (view==='tasks') await renderTasks();
    else if (view==='requests') await renderRequests();
    else if (view==='expiries') await renderExpiries();
    else if (view==='tools') await renderTools();
    else if (view==='team') await renderTeam();
    else if (view==='regions') await renderRegions();
    else if (view==='settings') await renderSettings();
    else if (view==='warnings') await renderWarnings();
    else if (view==='knowledgebase') await renderKnowledgeBase();
    else if (view==='reports') await renderReports();
    else if (view==='compliance') await renderCompliance();
    else if (view==='resources') await renderResources();
    else if (view==='activitylog') await renderActivityLog();
    else if (view==='roster') await renderRoster();
    else if (view==='releasenotes') await renderReleaseNotes();
    else if (view==='myprofile') await renderMyProfile();
  }catch(err){
    console.error(err);
    main.innerHTML = `<div class="empty-state">Something went wrong loading this page. Please refresh.</div>`;
  }
}

function isStaff(){ return ['admin','super_admin','regional_poc','team_lead','coordinator','inventory_coordinator'].includes(state.profile.role); }
function isAdmin(){ return ['admin','super_admin'].includes(state.profile.role); }
function isSuperAdmin(){ return state.profile.role === 'super_admin'; }
// Super Admin always has every permission. Everyone else only has a
// permission if it was explicitly granted via Settings > Permissions
// (custom_permissions table, loaded into state.myPermissions at login).
function hasPermission(key){ return isSuperAdmin() || state.myPermissions.has(key); }

// ---------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------
async function renderDashboard(){
  const main = document.getElementById('main-content');
  const uid = state.user.id;

  const [openReq, myTasks, circularsRes, expiring, pendingApprovals, notices, banner] = await Promise.all([
    sb.from('requests').select('id', {count:'exact', head:true}).in('status', ['open','in_progress']),
    sb.from('tasks').select('id', {count:'exact', head:true}).eq('assigned_to', uid).in('status', ['pending','in_progress']),
    sb.from('circulars').select('id'),
    sb.from('expiry_items').select('id, expiry_date'),
    isAdmin() ? sb.from('profiles').select('id', {count:'exact', head:true}).eq('status','pending') : Promise.resolve({count:0}),
    sb.from('home_notices').select('*').eq('active', true).order('created_at', {ascending:false}),
    sb.from('home_banner').select('*').eq('id', 1).maybeSingle()
  ]);

  const bannerVisible = banner.data?.image_url && (!banner.data.expires_at || new Date(banner.data.expires_at) > new Date());

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
    ${bannerVisible ? `<div class="card" style="padding:0; overflow:hidden;"><img src="${escapeHtml(banner.data.image_url)}" style="width:100%; max-height:220px; object-fit:cover; display:block;"></div>` : ''}
    ${(notices.data||[]).map(n => `<div class="card" style="border-left:4px solid var(--amber); background:#FFF8EC;"><strong>📌 ${escapeHtml(n.message)}</strong></div>`).join('')}
    <div class="grid grid-4">
      <div class="card stat-card clay" style="cursor:pointer;" onclick="navigateTo('requests')"><div class="stat-number">${openReq.count ?? 0}</div><div class="stat-label">Open requests</div></div>
      <div class="card stat-card sky" style="cursor:pointer;" onclick="navigateTo('tasks')"><div class="stat-number">${myTasks.count ?? 0}</div><div class="stat-label">My pending tasks</div></div>
      <div class="card stat-card amber" style="cursor:pointer;" onclick="navigateTo('circulars')"><div class="stat-number">${unacked}</div><div class="stat-label">Unread circulars</div></div>
      <div class="card stat-card amber" style="cursor:pointer;" onclick="navigateTo('expiries')"><div class="stat-number">${expiringSoon}</div><div class="stat-label">Expiring within 30 days</div></div>
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

  let circularsQuery = sb.from('circulars').select('*, profiles!created_by(full_name)').order('created_at', {ascending:false});
  if (!isAdmin()) circularsQuery = circularsQuery.gte('created_at', state.profile.created_at);
  const { data: circulars } = await circularsQuery;
  const { data: myAcks } = await sb.from('circular_acks').select('circular_id').eq('user_id', state.user.id);
  const ackedSet = new Set((myAcks||[]).map(a=>a.circular_id));

  if (!circulars || circulars.length===0){
    main.innerHTML = emptyState('No circulars yet.');
    return;
  }

  main.innerHTML = circulars.map(c => {
    const isCreator = c.created_by === state.user.id;
    const acked = ackedSet.has(c.id);
    return `
      <div class="card" style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;" data-open-circular="${c.id}">
        <div>
          <h3 style="margin-bottom:2px;">${escapeHtml(c.title)}</h3>
          <div class="mono">By ${escapeHtml(c.profiles?.full_name || 'Staff')} · ${formatDateTime(c.created_at)}</div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          ${(acked && !isCreator) ? '<span class="badge active">Acknowledged</span>' : (!isCreator ? '<span class="badge open">Unread</span>' : '')}
          <span class="mono">›</span>
        </div>
      </div>
    `;
  }).join('');

  main.querySelectorAll('[data-open-circular]').forEach(el => {
    el.onclick = () => openCircularPopup(circulars.find(c=>c.id===el.dataset.openCircular), ackedSet.has(el.dataset.openCircular));
  });
}

function openCircularPopup(c, acked){
  const isCreator = c.created_by === state.user.id;
  openModal(`
    <h2>${escapeHtml(c.title)}</h2>
    <div class="mono" style="margin-bottom:10px;">By ${escapeHtml(c.profiles?.full_name||'Staff')} · ${formatDateTime(c.created_at)}</div>
    <p style="font-size:14px; white-space:pre-wrap;">${escapeHtml(c.body)}</p>
    <div id="circular-popup-actions" style="margin-top:14px; display:flex; gap:8px; flex-wrap:wrap;">
      ${(!acked && !isCreator) ? `<button class="btn" id="popup-ack-btn2">Acknowledge</button>` : ''}
      ${(isAdmin() || isCreator) ? `<button class="btn outline" id="popup-tracker-btn">View Tracker</button>` : ''}
      ${isSuperAdmin() ? `<button class="btn outline" id="popup-kb-toggle-btn">${c.push_to_kb ? 'Remove from Knowledge Base' : 'Push to Knowledge Base'}</button>` : ''}
      ${isSuperAdmin() ? `<button class="btn danger" id="popup-delete-btn">Delete Permanently</button>` : ''}
    </div>
    <div id="popup-tracker-area" style="margin-top:14px;"></div>
  `);
  if (!acked && !isCreator){
    document.getElementById('popup-ack-btn2').onclick = async () => {
      await sb.from('circular_acks').insert({ circular_id: c.id, user_id: state.user.id });
      toast('Acknowledged'); closeModal(); renderCirculars();
    };
  }
  if (isAdmin() || isCreator){
    document.getElementById('popup-tracker-btn').onclick = () => showCircularTracker(c.id, c, document.getElementById('popup-tracker-area'));
  }
  if (isSuperAdmin()){
    document.getElementById('popup-kb-toggle-btn').onclick = async () => {
      const newVal = !c.push_to_kb;
      const { error } = await sb.from('circulars').update({ push_to_kb: newVal }).eq('id', c.id);
      if (error){ toast('Could not update: ' + error.message); return; }
      c.push_to_kb = newVal;
      toast(newVal ? 'Pushed to Knowledge Base' : 'Removed from Knowledge Base');
      closeModal(); openCircularPopup(c, acked);
    };
    document.getElementById('popup-delete-btn').onclick = async () => {
      if (!confirm('Permanently delete this circular? This cannot be undone.')) return;
      const { error } = await sb.from('circulars').delete().eq('id', c.id);
      if (error){ toast('Could not delete: ' + error.message); return; }
      closeModal(); toast('Circular deleted'); renderCirculars();
    };
  }
}

async function showCircularTracker(circularId, circular, el){
  el.innerHTML = '<div class="mono">Loading…</div>';
  let q = sb.from('profiles').select('id, full_name, role').eq('status','active').neq('id', circular.created_by);
  if (circular.target_region_id) q = q.eq('region_id', circular.target_region_id);
  if (circular.target_role) q = q.eq('role', circular.target_role);
  const { data: audience } = await q;
  const { data: acks } = await sb.from('circular_acks').select('user_id, acknowledged_at').eq('circular_id', circularId);
  const ackMap = new Map((acks||[]).map(a=>[a.user_id, a.acknowledged_at]));
  const ackedCount = (audience||[]).filter(p=>ackMap.has(p.id)).length;
  el.innerHTML = `<div class="mono" style="margin:8px 0;">Posted ${formatDateTime(circular.created_at)} · ${ackedCount} acknowledged, ${(audience||[]).length - ackedCount} pending
    <button class="btn small outline" id="tracker-csv-btn" style="margin-left:8px;">Export CSV</button></div>
  <table><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>When</th></tr></thead><tbody>
    ${(audience||[]).map(p=>{
      const ackedAt = ackMap.get(p.id);
      return `<tr><td>${escapeHtml(p.full_name)}</td><td>${ROLE_LABEL[p.role]||p.role}</td>
        <td>${ackedAt ? `<span class="badge active">Acknowledged</span>` : `<span class="badge open">Pending</span>`}</td>
        <td class="mono">${ackedAt ? formatDateTime(ackedAt) : '—'}</td></tr>`;
    }).join('')}
  </tbody></table>`;
  document.getElementById('tracker-csv-btn').onclick = () => {
    const rows = (audience||[]).map(p => ({
      Name: p.full_name, Role: ROLE_LABEL[p.role]||p.role,
      Status: ackMap.has(p.id) ? 'Acknowledged' : 'Pending',
      'Acknowledged At': ackMap.get(p.id) || ''
    }));
    downloadCSV(`circular-tracker-${circular.title.replace(/[^a-z0-9]/gi,'-')}.csv`, toCSV(rows));
  };
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

async function openNewCircularModal(){
  const isRegionLocked = ['regional_poc','team_lead','coordinator'].includes(state.profile.role);
  const myRegions = state.myRegionIds.map(id => state.regions.find(r=>r.id===id)).filter(Boolean);
  const regionOptions = isRegionLocked
    ? (myRegions.length
        ? myRegions.map(r=>`<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')
        : `<option value="">⚠️ No region assigned to you — ask Admin to fix this in Team</option>`)
    : `<option value="">All regions</option>` + state.regions.map(r=>`<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  const isRoleLockedToFieldStaff = state.profile.role === 'team_lead';
  const roleOptions = isRoleLockedToFieldStaff
    ? `<option value="rider">${ROLE_LABEL.rider}</option><option value="coordinator">${ROLE_LABEL.coordinator}</option>`
    : Object.entries(ROLE_LABEL).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');
  const { data: cats } = await sb.from('circular_categories').select('*').eq('active', true).order('name');
  const catOptions = `<option value="">— None —</option>` + (cats||[]).map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  const wordLimit = state.systemSettings?.circular_word_limit;
  openModal(`
    <h2>New circular</h2>
    <form id="circular-form">
      <div class="form-row"><label>Title</label><input type="text" id="c-title" required></div>
      <div class="form-row"><label>Category (optional)</label><select id="c-category">${catOptions}</select></div>
      <div class="form-row"><label>Message</label><textarea id="c-body" required></textarea>
        <span class="field-hint" id="c-word-count">0 words${wordLimit?` / ${wordLimit} max`:''}</span>
      </div>
      <div class="two-col">
        <div class="form-row"><label>Target region</label><select id="c-region">${regionOptions}</select></div>
        <div class="form-row"><label>Target role</label><select id="c-role">${isRoleLockedToFieldStaff ? '' : '<option value="">All roles</option>'}${roleOptions}</select></div>
      </div>
      <button class="btn-primary" type="submit">Post circular</button>
    </form>
  `);
  const bodyEl = document.getElementById('c-body');
  const counterEl = document.getElementById('c-word-count');
  bodyEl.oninput = () => {
    const n = countWords(bodyEl.value);
    counterEl.textContent = `${n} words${wordLimit?` / ${wordLimit} max`:''}`;
    counterEl.style.color = (wordLimit && n > wordLimit) ? 'var(--clay)' : '';
  };
  document.getElementById('circular-form').onsubmit = async (e) => {
    e.preventDefault();
    const title = document.getElementById('c-title').value.trim();
    const body = document.getElementById('c-body').value.trim();
    const { data: sys } = await sb.from('system_settings').select('circular_word_limit').eq('id', 1).maybeSingle();
    if (sys?.circular_word_limit && countWords(body) > sys.circular_word_limit){
      toast(`This circular is too long — please keep it under ${sys.circular_word_limit} words.`);
      return;
    }
    const targetRegionId = document.getElementById('c-region').value || null;
    const targetRole = document.getElementById('c-role').value || null;
    const { error } = await sb.from('circulars').insert({
      title,
      body: document.getElementById('c-body').value.trim(),
      created_by: state.user.id,
      target_region_id: targetRegionId,
      target_role: targetRole,
      category_id: document.getElementById('c-category').value || null
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

  const canSeeAssignedByMe = isStaff() && state.profile.role !== 'team_lead';
  if (!canSeeAssignedByMe) taskTab = 'mine';
  let tabsHtml = '';
  if (canSeeAssignedByMe){
    tabsHtml = `<div class="tabs">
      <button class="tab ${taskTab==='mine'?'active':''}" data-tab="mine">Assigned to me</button>
      <button class="tab ${taskTab==='assignedByMe'?'active':''}" data-tab="assignedByMe">I assigned</button>
    </div>`;
  }

  let query = sb.from('tasks').select('*, assignee:profiles!assigned_to(full_name, employee_id), assigner:profiles!assigned_by(full_name, employee_id)').order('due_date', {ascending:true, nullsFirst:false});
  if (!isStaff() || taskTab==='mine') query = query.eq('assigned_to', state.user.id);
  else query = query.eq('assigned_by', state.user.id);
  const { data: tasks } = await query;

  main.innerHTML = tabsHtml + (tasks && tasks.length ? `
    <table><thead><tr><th>Title</th><th>Assigned by</th><th>Assigned to</th><th>Due</th><th>Status</th><th></th></tr></thead>
    <tbody>${tasks.map(t=>`
      <tr>
        <td><strong>${escapeHtml(t.title)}</strong><div style="font-size:12.5px; color:var(--muted);">${escapeHtml(t.description||'')}</div>
          <button class="btn-text" data-view-log="${t.id}" style="font-size:12px;">View log</button>
        </td>
        <td>${escapeHtml(t.assigner?.full_name || '—')}${t.assigner?.employee_id?' <span class="mono">('+escapeHtml(t.assigner.employee_id)+')</span>':''}</td>
        <td>${escapeHtml(t.assignee?.full_name || '—')}${t.assignee?.employee_id?' <span class="mono">('+escapeHtml(t.assignee.employee_id)+')</span>':''}</td>
        <td class="mono">${t.due_date || '—'}</td>
        <td><span class="badge ${t.status}">${t.status.replace('_',' ')}</span></td>
        <td>${taskStatusControls(t)} ${(isSuperAdmin() || hasPermission('task_delete')) ? `<button class="btn small danger" data-delete-task="${t.id}">Delete</button>` : ''}</td>
      </tr>
      <tr class="task-log-row" data-log-row="${t.id}" style="display:none;"><td colspan="6"><div id="task-log-${t.id}" class="mono" style="font-size:12.5px; padding:10px 0;">Loading…</div></td></tr>`).join('')}</tbody></table>
  ` : emptyState('No tasks here yet.'));

  main.querySelectorAll('.tab').forEach(tb => tb.onclick = () => { taskTab = tb.dataset.tab; renderTasks(); });
  main.querySelectorAll('[data-delete-task]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Permanently delete this task? This cannot be undone.')) return;
      const { error } = await sb.from('tasks').delete().eq('id', btn.dataset.deleteTask);
      if (error){ toast('Could not delete: ' + error.message); return; }
      toast('Task deleted'); renderTasks();
    };
  });
  main.querySelectorAll('[data-task-status]').forEach(btn => {
    btn.onclick = () => openTaskStatusModal(btn.dataset.taskId, btn.dataset.taskStatus);
  });
  main.querySelectorAll('[data-view-log]').forEach(btn => {
    btn.onclick = async () => {
      const row = main.querySelector(`[data-log-row="${btn.dataset.viewLog}"]`);
      const isHidden = row.style.display === 'none';
      row.style.display = isHidden ? '' : 'none';
      if (isHidden){
        const { data: log } = await sb.from('task_updates').select('*, profiles(full_name)').eq('task_id', btn.dataset.viewLog).order('created_at');
        const box = document.getElementById(`task-log-${btn.dataset.viewLog}`);
        box.innerHTML = (log && log.length)
          ? log.map(l => `<div style="margin-bottom:6px;">${formatDateTime(l.created_at)} — <strong>${escapeHtml(l.profiles?.full_name||'—')}</strong>${l.new_status?` → <span class="badge ${l.new_status}">${l.new_status.replace('_',' ')}</span>`:''}${l.message?': '+escapeHtml(l.message):''}</div>`).join('')
          : 'No status changes logged yet.';
      }
    };
  });
}
function taskStatusControls(t){
  if (t.status==='pending') return `<button class="btn small" data-task-id="${t.id}" data-task-status="in_progress">Mark In Process</button>`;
  if (t.status==='in_progress') return `<button class="btn small success" data-task-id="${t.id}" data-task-status="completed">Mark Complete</button>`;
  return '';
}

function openTaskStatusModal(taskId, newStatus){
  const wordLimit = state.systemSettings?.task_remark_word_limit;
  openModal(`
    <h2>${newStatus==='in_progress' ? 'Mark In Process' : 'Mark Complete'}</h2>
    <form id="task-status-form">
      <div class="form-row"><label>Remarks</label><textarea id="ts-remark" required placeholder="What's the update?"></textarea>
        <span class="field-hint" id="ts-word-count">0 words${wordLimit?` / ${wordLimit} max`:''}</span>
      </div>
      <button class="btn-primary" type="submit">Save</button>
    </form>
  `);
  const remarkEl = document.getElementById('ts-remark');
  const counterEl = document.getElementById('ts-word-count');
  remarkEl.oninput = () => {
    const n = countWords(remarkEl.value);
    counterEl.textContent = `${n} words${wordLimit?` / ${wordLimit} max`:''}`;
    counterEl.style.color = (wordLimit && n > wordLimit) ? 'var(--clay)' : '';
  };
  document.getElementById('task-status-form').onsubmit = async (e) => {
    e.preventDefault();
    const message = remarkEl.value.trim();
    if (wordLimit && countWords(message) > wordLimit){ toast(`Please keep remarks under ${wordLimit} words.`); return; }
    const { error: updErr } = await sb.from('tasks').update({ status: newStatus }).eq('id', taskId);
    if (updErr){ toast('Could not update: ' + updErr.message); return; }
    await sb.from('task_updates').insert({ task_id: taskId, message, new_status: newStatus, created_by: state.user.id });
    closeModal(); toast('Updated'); renderTasks();
  };
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

  const { data: rawRequests } = await sb.from('requests')
    .select('*, rider:profiles!rider_id(full_name, employee_id), poc:profiles!assigned_poc_id(full_name, employee_id)')
    .order('created_at', {ascending:false});

  const STATUS_WEIGHT = { open:0, in_progress:1, resolved:2, closed:3 };
  const requests = (rawRequests||[]).slice().sort((a,b) => (STATUS_WEIGHT[a.status]??9) - (STATUS_WEIGHT[b.status]??9) || new Date(b.created_at)-new Date(a.created_at));

  currentRequestsList = requests || [];
  if (!requests || requests.length===0){ main.innerHTML = emptyState('No requests yet.'); return; }

  main.innerHTML = requests.map(r => `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <h3>${escapeHtml(r.category)}</h3>
          <div class="mono">Rider: ${escapeHtml(r.rider?.full_name||'—')}${r.rider?.employee_id?' ('+escapeHtml(r.rider.employee_id)+')':''} · Handler: ${escapeHtml(r.poc?.full_name||'Unassigned')}${r.poc?.employee_id?' ('+escapeHtml(r.poc.employee_id)+')':''} · ${formatDateTime(r.created_at)}</div>
        </div>
        <span class="badge ${r.status}">${r.status.replace('_',' ')}</span>
      </div>
      <p style="font-size:13.5px;">${escapeHtml(r.description)}</p>
      <details class="thread-details">
        <summary style="cursor:pointer; font-size:13px; color:var(--muted); user-select:none;">Status history &amp; remarks ▾</summary>
        <div id="thread-${r.id}" class="thread">Loading thread…</div>
      </details>
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
        ${requestActionControls(r)}
        ${(isAdmin() && !r.assigned_poc_id) ? `<button class="btn small outline" data-reassign-request="${r.id}">Assign Handler</button>` : ''}
        ${isSuperAdmin() ? `<button class="btn small outline" data-edit-request="${r.id}">Edit</button>` : ''}
        ${(isSuperAdmin() || hasPermission('request_delete')) ? `<button class="btn small danger" data-delete-request="${r.id}">Delete Permanently</button>` : ''}
      </div>
      <form class="reply-form" data-request-id="${r.id}" style="margin-top:10px; display:${['closed'].includes(r.status)?'none':'flex'}; flex-direction:column; gap:4px;">
        <div style="display:flex; gap:8px;">
          <input type="text" placeholder="Short remark…" style="flex:1; padding:8px 10px; border:1px solid var(--line); border-radius:7px; font-size:13.5px;">
          <button class="btn small" type="submit">Send</button>
        </div>
        <span class="field-hint reply-word-count">0 words${state.systemSettings?.request_remark_word_limit ? ` / ${state.systemSettings.request_remark_word_limit} max` : ''}</span>
      </form>
    </div>
  `).join('');

  main.querySelectorAll('[data-delete-request]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Permanently delete this request and its whole thread? This cannot be undone.')) return;
      const { data, error } = await sb.from('requests').delete().eq('id', btn.dataset.deleteRequest).select();
      if (error){ toast('Could not delete: ' + error.message); return; }
      if (!data || !data.length){ toast('Delete was blocked by a permissions rule — nothing was removed. Ask Super Admin to check the request_delete database policy.'); return; }
      toast('Request deleted'); renderRequests();
    };
  });
  main.querySelectorAll('[data-edit-request]').forEach(btn => {
    btn.onclick = () => openEditRequestModal(requests.find(r=>r.id===btn.dataset.editRequest));
  });
  main.querySelectorAll('[data-reassign-request]').forEach(btn => {
    btn.onclick = async () => {
      await loadScopedProfiles();
      const staff = state.profilesInScope.filter(p => !['rider'].includes(p.role) && p.status==='active');
      const options = staff.map(p=>`<option value="${p.id}">${escapeHtml(p.full_name)} (${ROLE_LABEL[p.role]})</option>`).join('');
      openModal(`
        <h2>Assign a handler</h2>
        <form id="reassign-form">
          <div class="form-row"><label>Handler</label><select id="reassign-select" required>${options}</select></div>
          <button class="btn-primary" type="submit">Assign</button>
        </form>
      `);
      document.getElementById('reassign-form').onsubmit = async (e) => {
        e.preventDefault();
        const { error } = await sb.from('requests').update({ assigned_poc_id: document.getElementById('reassign-select').value }).eq('id', btn.dataset.reassignRequest);
        if (error){ toast('Could not assign: ' + error.message); return; }
        closeModal(); toast('Handler assigned'); renderRequests();
      };
    };
  });
  requests.forEach(r => loadThread(r.id));
  main.querySelectorAll('.reply-form').forEach(f => {
    const input = f.querySelector('input');
    const counterEl = f.querySelector('.reply-word-count');
    const wordLimit = state.systemSettings?.request_remark_word_limit;
    input.oninput = () => {
      const n = countWords(input.value);
      counterEl.textContent = `${n} words${wordLimit?` / ${wordLimit} max`:''}`;
      counterEl.style.color = (wordLimit && n > wordLimit) ? 'var(--clay)' : '';
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      if (wordLimit && countWords(text) > wordLimit){ toast(`Please keep remarks under ${wordLimit} words`); return; }
      await sb.from('request_updates').insert({ request_id: f.dataset.requestId, message: text, created_by: state.user.id });
      input.value=''; counterEl.textContent = `0 words${wordLimit?` / ${wordLimit} max`:''}`;
      loadThread(f.dataset.requestId);
    };
  });
  main.querySelectorAll('[data-req-status]').forEach(btn => {
    btn.onclick = () => changeRequestStatus(btn.dataset.reqId, btn.dataset.reqStatus);
  });
}

function countWords(str){ return (str.trim().match(/\S+/g)||[]).length; }

function openEditRequestModal(r){
  openModal(`
    <h2>Edit request</h2>
    <p class="hint">Use this to correct a mistake in the original request — this does not notify the rider.</p>
    <form id="request-edit-form">
      <div class="form-row"><label>Category</label><input type="text" id="er-category" value="${escapeHtml(r.category||'')}" required></div>
      <div class="form-row"><label>Description</label><textarea id="er-description" required>${escapeHtml(r.description||'')}</textarea></div>
      <button class="btn-primary" type="submit">Save changes</button>
    </form>
  `);
  document.getElementById('request-edit-form').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.from('requests').update({
      category: document.getElementById('er-category').value.trim(),
      description: document.getElementById('er-description').value.trim()
    }).eq('id', r.id);
    if (error){ toast('Could not save: ' + error.message); return; }
    closeModal(); toast('Updated'); renderRequests();
  };
}

async function changeRequestStatus(requestId, newStatus){
  const wordLimit = state.systemSettings?.request_remark_word_limit ?? 25;
  openModal(`
    <h2>Mark as ${newStatus.replace('_',' ')}</h2>
    <form id="req-status-form">
      <div class="form-row"><label>Remarks</label><textarea id="rs-remark" required placeholder="Short remark for this status change"></textarea>
        <span class="field-hint" id="rs-word-count">0 words${wordLimit?` / ${wordLimit} max`:''}</span>
      </div>
      <button class="btn-primary" type="submit">Save</button>
    </form>
  `);
  const remarkEl = document.getElementById('rs-remark');
  const counterEl = document.getElementById('rs-word-count');
  remarkEl.oninput = () => {
    const n = countWords(remarkEl.value);
    counterEl.textContent = `${n} words${wordLimit?` / ${wordLimit} max`:''}`;
    counterEl.style.color = (wordLimit && n > wordLimit) ? 'var(--clay)' : '';
  };
  document.getElementById('req-status-form').onsubmit = async (e) => {
    e.preventDefault();
    const remark = remarkEl.value.trim();
    if (!remark){ toast('A remark is required'); return; }
    if (wordLimit && countWords(remark) > wordLimit){ toast(`Please keep remarks under ${wordLimit} words`); return; }

    const payload = { status: newStatus };
    if (newStatus === 'in_progress') payload.in_progress_at = new Date().toISOString();
    if (newStatus === 'resolved') payload.resolved_at = new Date().toISOString();
    if (newStatus === 'closed') payload.closed_at = new Date().toISOString();

    const { error } = await sb.from('requests').update(payload).eq('id', requestId);
    if (error){ toast('Could not update: ' + error.message); return; }

    const { error: remarkErr } = await sb.from('request_updates').insert({
      request_id: requestId, message: remark, created_by: state.user.id, new_status: newStatus
    });
    closeModal();
    if (remarkErr){ toast('Status changed, but the remark could not be saved: ' + remarkErr.message); }
    else { toast('Updated'); }
    renderRequests();
  };
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

const STATUS_ICON = { in_progress:'🔵', resolved:'🟢', closed:'⚪', open:'🔴' };
async function loadThread(requestId){
  const { data: updates, error } = await sb.from('request_updates').select('*, profiles(full_name)').eq('request_id', requestId).order('created_at');
  const el = document.getElementById('thread-'+requestId);
  if (!el) return;
  if (error){ el.innerHTML = `<div style="font-size:12.5px; color:var(--clay);">Could not load history: ${escapeHtml(error.message)}</div>`; return; }
  if (!updates || updates.length===0){ el.innerHTML = '<div style="font-size:12.5px; color:var(--muted);">No replies yet.</div>'; return; }
  el.innerHTML = updates.map(u => `
    <div class="thread-msg">
      ${u.new_status ? `<div style="font-weight:700; margin-bottom:3px;">${STATUS_ICON[u.new_status]||''} Status → ${u.new_status.replace('_',' ')}</div>` : ''}
      ${escapeHtml(u.message)}
      <div class="meta">${escapeHtml(u.profiles?.full_name||'—')} · ${formatDateTime(u.created_at)}</div>
    </div>
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
    const myRegionId = state.profile.region_id;

    // Work out who should handle this: a per-region override role takes
    // priority over the category's default role.
    let targetRole = category?.primary_role;
    if (myRegionId){
      const { data: override } = await sb.from('category_region_overrides')
        .select('role').eq('category_id', categoryId).eq('region_id', myRegionId).maybeSingle();
      if (override?.role) targetRole = override.role;
    }
    let assignedPocId = null;
    if (targetRole){
      const [{ data: candidates }, { data: regionLinks }] = await Promise.all([
        sb.from('profiles').select('id, region_id').eq('role', targetRole).eq('status', 'active'),
        myRegionId ? sb.from('profile_regions').select('profile_id').eq('region_id', myRegionId) : Promise.resolve({data:[]})
      ]);
      const linkedIds = new Set((regionLinks||[]).map(r=>r.profile_id));
      const inRegion = (candidates||[]).find(p => linkedIds.has(p.id) || p.region_id === myRegionId);
      assignedPocId = (inRegion || candidates?.[0])?.id || null;
    }

    const { data: inserted, error } = await sb.from('requests').insert({
      rider_id: state.user.id,
      category: category?.name || 'Other',
      category_id: categoryId,
      assigned_poc_id: assignedPocId,
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
  const { data: items } = await sb.from('expiry_items').select('*, profiles!rider_id(full_name, phone), added_by:profiles!created_by(full_name)').order('expiry_date');
  if (!items || items.length===0){ main.innerHTML = emptyState('No expiry items tracked yet.'); return; }

  const canRemind = isAdmin() || state.profile.role === 'inventory_coordinator';
  const canEdit = isAdmin() || hasPermission('expiry_edit');
  const canDelete = isAdmin() || hasPermission('expiry_delete');
  const showActionsCol = canRemind || canEdit || canDelete;
  const today = new Date();
  main.innerHTML = `<table><thead><tr><th>Applies to</th><th>Item</th><th>Added by</th><th>Expiry date</th><th>Status</th>${showActionsCol?'<th></th>':''}</tr></thead><tbody>
    ${items.map(i=>{
      const d = new Date(i.expiry_date);
      const daysLeft = Math.ceil((d-today)/(1000*60*60*24));
      let badge = 'badge active', label='OK';
      if (daysLeft < 0){ badge='badge open'; label='Overdue'; }
      else if (daysLeft <= 30){ badge='badge pending'; label=`Due in ${daysLeft}d`; }
      const appliesTo = i.profiles?.full_name
        ? escapeHtml(i.profiles.full_name)
        : `${escapeHtml(state.regions.find(r=>r.id===i.region_id)?.name || '—')}${i.applies_to_role ? ' · ' + (ROLE_LABEL[i.applies_to_role]||i.applies_to_role) : ' (whole region)'}`;
      return `<tr>
        <td>${appliesTo}</td>
        <td>${escapeHtml(i.item_type)}${i.item_label?' — '+escapeHtml(i.item_label):''}</td>
        <td>${escapeHtml(i.added_by?.full_name||'—')}</td>
        <td class="mono">${i.expiry_date}</td>
        <td><span class="${badge}">${label}</span></td>
        ${showActionsCol ? `<td style="white-space:nowrap;">
          ${(canRemind && daysLeft<=30 && i.profiles?.phone) ? `<button class="btn small outline" data-remind="${i.id}" data-remind-phone="${i.profiles?.phone||''}" data-remind-item="${escapeHtml(i.item_type)}">Send Reminder</button>` : ''}
          ${canEdit ? `<button class="btn small outline" data-edit-expiry="${i.id}">Edit</button>` : ''}
          ${canDelete ? `<button class="btn small danger" data-delete-expiry="${i.id}">Delete</button>` : ''}
        </td>` : ''}
      </tr>`;
    }).join('')}
  </tbody></table>`;

  main.querySelectorAll('[data-delete-expiry]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Permanently delete this expiry item? This cannot be undone.')) return;
      const { error } = await sb.from('expiry_items').delete().eq('id', btn.dataset.deleteExpiry);
      if (error){ toast('Could not delete: ' + error.message); return; }
      toast('Deleted'); renderExpiries();
    };
  });
  main.querySelectorAll('[data-edit-expiry]').forEach(btn => {
    btn.onclick = () => openEditExpiryModal(items.find(i=>i.id===btn.dataset.editExpiry));
  });
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
  const regionChecks = state.regions.map(r=>`
    <label style="display:flex; align-items:center; gap:6px; font-weight:400; margin-bottom:4px;">
      <input type="checkbox" class="e-region-check" value="${r.id}"> ${escapeHtml(r.name)}
    </label>`).join('');
  const roleChecks = Object.entries(ROLE_LABEL).map(([k,v])=>`
    <label style="display:flex; align-items:center; gap:6px; font-weight:400; margin-bottom:4px;">
      <input type="checkbox" class="e-role-check" value="${k}"> ${v}
    </label>`).join('');
  const typeOptions = state.expiryItemTypes.map(t=>`<option value="${t.id}" data-name="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join('');
  openModal(`
    <h2>Track expiry item</h2>
    <p class="hint">Not every item belongs to one rider — leave regions/roles as your only selection for something that applies broadly (e.g. an office agreement). Select more than one region or role if the same item applies to several.</p>
    <form id="expiry-form">
      <div class="form-row">
        <label>Region(s)</label>
        <button type="button" class="btn small outline" id="e-select-all-regions" style="margin-bottom:8px;">Select All Regions</button>
        <div style="max-height:150px; overflow-y:auto; border:1px solid var(--line); border-radius:8px; padding:10px;">${regionChecks}</div>
      </div>
      <div class="form-row">
        <label>Applies to role(s) (optional)</label>
        <button type="button" class="btn small outline" id="e-select-all-roles" style="margin-bottom:8px;">Select All Roles</button>
        <div style="max-height:150px; overflow-y:auto; border:1px solid var(--line); border-radius:8px; padding:10px;">${roleChecks}</div>
      </div>
      <div class="form-row" id="e-rider-wrap"><label>Specific rider (optional)</label><select id="e-rider"><option value="">— Not tied to a specific rider —</option></select>
        <span class="field-hint">Only available when exactly one region is selected.</span>
      </div>
      <div class="form-row"><label>Item type</label><select id="e-type">${typeOptions}</select></div>
      <div class="form-row"><label>Label / notes (optional)</label><input type="text" id="e-label"></div>
      <div class="form-row"><label>Expiry date</label><input type="date" id="e-date" required></div>
      <button class="btn-primary" type="submit">Save</button>
    </form>
  `);
  document.getElementById('e-select-all-regions').onclick = () => {
    document.querySelectorAll('.e-region-check').forEach(cb => cb.checked = true);
    updateRiderVisibility();
  };
  document.getElementById('e-select-all-roles').onclick = () => {
    document.querySelectorAll('.e-role-check').forEach(cb => cb.checked = true);
  };
  const updateRiderVisibility = () => {
    const checkedRegions = Array.from(document.querySelectorAll('.e-region-check:checked')).map(cb=>cb.value);
    const wrap = document.getElementById('e-rider-wrap');
    if (checkedRegions.length === 1){
      wrap.style.display = 'block';
      const riders = state.profilesInScope.filter(p=>p.role==='rider' && p.region_id===checkedRegions[0]);
      document.getElementById('e-rider').innerHTML = '<option value="">— Not tied to a specific rider —</option>' +
        riders.map(p=>`<option value="${p.id}">${escapeHtml(p.full_name)}${p.employee_id?' ('+escapeHtml(p.employee_id)+')':''}</option>`).join('');
    } else {
      wrap.style.display = 'none';
      document.getElementById('e-rider').innerHTML = '<option value="">— Not tied to a specific rider —</option>';
    }
  };
  document.querySelectorAll('.e-region-check').forEach(cb => cb.onchange = updateRiderVisibility);
  updateRiderVisibility();

  document.getElementById('expiry-form').onsubmit = async (e) => {
    e.preventDefault();
    const regionIds = Array.from(document.querySelectorAll('.e-region-check:checked')).map(cb=>cb.value);
    if (!regionIds.length){ toast('Select at least one region'); return; }
    const roles = Array.from(document.querySelectorAll('.e-role-check:checked')).map(cb=>cb.value);
    const roleLabel = roles.length ? roles.map(r=>ROLE_LABEL[r]).join(', ') : null;
    const riderId = (regionIds.length === 1) ? (document.getElementById('e-rider').value || null) : null;
    const typeSelect = document.getElementById('e-type');
    const typeId = typeSelect.value;
    const typeName = typeSelect.options[typeSelect.selectedIndex]?.dataset.name || 'Other';
    const itemLabel = document.getElementById('e-label').value.trim();
    const expiryDate = document.getElementById('e-date').value;

    // One row per selected region (roles are stored per-row as a joined label)
    const payloads = regionIds.map(regionId => ({
      rider_id: regionId === regionIds[0] ? riderId : null,
      region_id: regionId,
      applies_to_role: roleLabel,
      item_type_id: typeId,
      item_type: typeName,
      item_label: itemLabel,
      expiry_date: expiryDate,
      created_by: state.user.id
    }));
    const { error } = await sb.from('expiry_items').insert(payloads);
    if (error){
      if (/created_by/i.test(error.message)){
        toast('Could not save — the database is missing a recent update. Ask your developer to run Migration 16 (schema cache fix), then try again.');
      } else {
        toast('Could not save: ' + error.message);
      }
      return;
    }
    closeModal(); toast(`${payloads.length} item(s) added`); renderExpiries();
  };
}

function openEditExpiryModal(item){
  if (!item) return;
  const typeOptions = state.expiryItemTypes.map(t=>`<option value="${t.id}" data-name="${escapeHtml(t.name)}" ${t.id===item.item_type_id?'selected':''}>${escapeHtml(t.name)}</option>`).join('');
  openModal(`
    <h2>Edit expiry item</h2>
    <form id="expiry-edit-form">
      <div class="form-row"><label>Applies to</label><input type="text" value="${escapeHtml(item.profiles?.full_name || (state.regions.find(r=>r.id===item.region_id)?.name||'—'))}" disabled></div>
      <div class="form-row"><label>Item type</label><select id="ee-type">${typeOptions}</select></div>
      <div class="form-row"><label>Label / notes (optional)</label><input type="text" id="ee-label" value="${escapeHtml(item.item_label||'')}"></div>
      <div class="form-row"><label>Expiry date</label><input type="date" id="ee-date" value="${item.expiry_date}" required></div>
      <button class="btn-primary" type="submit">Save changes</button>
    </form>
  `);
  document.getElementById('expiry-edit-form').onsubmit = async (e) => {
    e.preventDefault();
    const typeSelect = document.getElementById('ee-type');
    const { error } = await sb.from('expiry_items').update({
      item_type_id: typeSelect.value,
      item_type: typeSelect.options[typeSelect.selectedIndex]?.dataset.name || item.item_type,
      item_label: document.getElementById('ee-label').value.trim(),
      expiry_date: document.getElementById('ee-date').value
    }).eq('id', item.id);
    if (error){ toast('Could not save: ' + error.message); return; }
    closeModal(); toast('Updated'); renderExpiries();
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

  let html = '';

  if (isAdmin()){
    const { data: resetRequests } = await sb.from('password_reset_requests').select('*').eq('status','pending').order('created_at', {ascending:false});
    if (resetRequests && resetRequests.length){
      html += `<div class="card"><h3>Password reset requests (${resetRequests.length})</h3>
      <table><thead><tr><th>Phone</th><th>Note</th><th>Submitted</th><th></th></tr></thead><tbody>
      ${resetRequests.map(r => {
        const match = state.profilesInScope.find(p => p.phone === r.phone);
        return `<tr>
          <td class="mono">${escapeHtml(r.phone)}</td>
          <td>${escapeHtml(r.note||'—')}</td>
          <td class="mono">${formatDateTime(r.created_at)}</td>
          <td>
            ${match
              ? `<button class="btn small" data-resolve-reset="${r.id}" data-resolve-profile="${match.id}">Reset for ${escapeHtml(match.full_name)}</button>`
              : `<span class="mono" style="color:var(--clay);">No matching account found</span>`}
            <button class="btn small outline" data-dismiss-reset="${r.id}">Dismiss</button>
          </td>
        </tr>`;
      }).join('')}
      </tbody></table></div>`;
    }
  }

  if (pending.length && isAdmin()){
    html += `<div class="card"><h3>Pending approvals (${pending.length})</h3>
    <div style="margin-bottom:10px;"><button class="btn small" id="bulk-approve-btn" disabled>Approve Selected (<span id="bulk-approve-count">0</span>)</button></div>
    <table><thead><tr><th><input type="checkbox" id="pending-select-all"></th><th>Name</th><th>Designation</th><th>Email</th><th>Phone</th><th></th></tr></thead><tbody>
    ${pending.map(p=>`<tr>
      <td><input type="checkbox" class="pending-select" value="${p.id}"></td>
      <td>${escapeHtml(p.full_name)}</td>
      <td>${ROLE_LABEL[p.role]||'—'}${!p.region_id?' <span class="badge pending" title="No region set">No region</span>':''}</td>
      <td class="mono">${escapeHtml(p.email)}</td><td class="mono">${escapeHtml(p.phone||'—')}</td>
      <td><button class="btn small" data-approve="${p.id}">Approve</button></td>
    </tr>`).join('')}
    </tbody></table></div>`;
  }

  const nonPending = state.profilesInScope.filter(p=>p.status!=='pending');
  const activeCount = nonPending.filter(p=>p.status==='active').length;
  const disabledCount = nonPending.filter(p=>p.status==='disabled').length;
  html += `<div class="card">
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:10px;">
      <h3 style="margin:0;">Team directory (${nonPending.length} total — ${activeCount} active, ${disabledCount} disabled)</h3>
      <input type="text" id="team-search" placeholder="Search name, Employee ID, role, mobile…" style="min-width:240px; padding:8px 10px; border:1px solid var(--line); border-radius:7px;">
    </div>`;
  const roleGroupOrder = isAdmin()
    ? ['rider','regional_poc','team_lead','coordinator','inventory_coordinator','admin','super_admin']
    : ['team_lead','coordinator','regional_poc','inventory_coordinator','rider','admin','super_admin'];
  roleGroupOrder.forEach(role => {
    const members = nonPending.filter(p => p.role === role);
    if (!members.length) return;
    const groupId = 'team-grp-' + role;
    const groupActive = members.filter(p=>p.status==='active').length;
    const groupDisabled = members.filter(p=>p.status==='disabled').length;
    html += `
      <button class="nav-group-header team-group-header collapsed" data-team-group-toggle="${groupId}" style="color:var(--ink); padding:12px 4px;">
        <span>${ROLE_LABEL[role]} (${members.length} — ${groupActive} active, ${groupDisabled} disabled)</span><span class="nav-group-arrow">▾</span>
      </button>
      <div class="nav-group-items collapsed" id="${groupId}">
        <table><thead><tr><th>Name</th><th>Mobile</th><th>Employee ID</th><th>Region(s)</th><th>Status</th>${isAdmin()?'<th></th>':''}</tr></thead><tbody>
        ${members.map(p=>`<tr data-team-row data-search="${escapeHtml((p.full_name+' '+(p.employee_id||'')+' '+ROLE_LABEL[role]+' '+(p.phone||'')).toLowerCase())}">
          <td>${escapeHtml(p.full_name)}</td>
          <td class="mono">${escapeHtml(p.phone||'—')}</td>
          <td class="mono">${escapeHtml(p.employee_id||'—')}</td>
          <td>${escapeHtml(regionNamesFor(p))}</td>
          <td><span class="badge ${p.status}">${p.status}</span></td>
          ${isAdmin() ? `<td style="white-space:nowrap;">
            <button class="btn small outline" data-edit="${p.id}">Edit</button>
            <button class="btn small outline" data-toggle-status="${p.id}">${p.status==='disabled'?'Enable':'Disable'}</button>
            <button class="btn small outline" data-reset-pw="${p.id}">Reset Password</button>
            ${isSuperAdmin() ? `<button class="btn small danger" data-delete-member="${p.id}">Delete</button>` : ''}
          </td>` : ''}
        </tr>`).join('')}
        </tbody></table>
      </div>`;
  });
  html += `</div>`;

  main.innerHTML = html || emptyState('No team members yet.');

  main.querySelectorAll('[data-team-group-toggle]').forEach(btn => {
    btn.onclick = () => {
      const targetEl = document.getElementById(btn.dataset.teamGroupToggle);
      const wasCollapsed = targetEl.classList.contains('collapsed');
      main.querySelectorAll('.nav-group-items').forEach(el => el.classList.add('collapsed'));
      main.querySelectorAll('.team-group-header').forEach(b => b.classList.add('collapsed'));
      if (wasCollapsed){ targetEl.classList.remove('collapsed'); btn.classList.remove('collapsed'); }
    };
  });

  main.querySelectorAll('[data-resolve-reset]').forEach(btn => {
    btn.onclick = () => openResetPasswordModal(btn.dataset.resolveProfile, btn.dataset.resolveReset);
  });
  main.querySelectorAll('[data-dismiss-reset]').forEach(btn => {
    btn.onclick = async () => {
      await sb.from('password_reset_requests').update({ status:'resolved', resolved_by: state.user.id, resolved_at: new Date().toISOString() }).eq('id', btn.dataset.dismissReset);
      toast('Dismissed'); renderTeam();
    };
  });
  main.querySelectorAll('[data-approve]').forEach(btn => btn.onclick = () => openApproveModal(btn.dataset.approve));
  main.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => openApproveModal(btn.dataset.edit));
  main.querySelectorAll('[data-toggle-status]').forEach(btn => btn.onclick = () => toggleMemberStatus(btn.dataset.toggleStatus));
  main.querySelectorAll('[data-reset-pw]').forEach(btn => btn.onclick = () => openResetPasswordModal(btn.dataset.resetPw));
  main.querySelectorAll('[data-delete-member]').forEach(btn => {
    btn.onclick = async () => {
      const p = state.profilesInScope.find(x=>x.id===btn.dataset.deleteMember);
      if (!confirm(`Permanently delete ${p.full_name}'s account and login? This cannot be undone.`)) return;
      const resp = await callEdgeFunction('delete_user', { user_id: btn.dataset.deleteMember });
      if (resp.skipped){ toast('Edge Function not configured yet.'); return; }
      if (resp.error){ toast(resp.error); return; }
      toast('Account deleted'); renderTeam();
    };
  });

  // Team search — filters directory rows live, auto-expanding matching groups
  const teamSearchBox = document.getElementById('team-search');
  if (teamSearchBox){
    teamSearchBox.oninput = () => {
      const q = teamSearchBox.value.trim().toLowerCase();
      main.querySelectorAll('[data-team-row]').forEach(row => {
        const match = !q || (row.dataset.search||'').includes(q);
        row.style.display = match ? '' : 'none';
      });
      main.querySelectorAll('.nav-group-items').forEach(group => {
        const anyVisible = Array.from(group.querySelectorAll('[data-team-row]')).some(r => r.style.display !== 'none');
        const header = main.querySelector(`[data-team-group-toggle="${group.id}"]`);
        if (q && anyVisible){ group.classList.remove('collapsed'); header?.classList.remove('collapsed'); }
        if (header) header.style.display = (q && !anyVisible) ? 'none' : '';
      });
    };
  }

  // Bulk approve
  const selectAllBox = document.getElementById('pending-select-all');
  const bulkApproveBtn = document.getElementById('bulk-approve-btn');
  const updateBulkCount = () => {
    const checked = main.querySelectorAll('.pending-select:checked').length;
    if (bulkApproveBtn){
      bulkApproveBtn.disabled = checked === 0;
      document.getElementById('bulk-approve-count').textContent = checked;
    }
  };
  if (selectAllBox){
    selectAllBox.onchange = () => {
      main.querySelectorAll('.pending-select').forEach(cb => cb.checked = selectAllBox.checked);
      updateBulkCount();
    };
  }
  main.querySelectorAll('.pending-select').forEach(cb => cb.onchange = updateBulkCount);
  if (bulkApproveBtn){
    bulkApproveBtn.onclick = async () => {
      const ids = Array.from(main.querySelectorAll('.pending-select:checked')).map(cb=>cb.value);
      if (!ids.length) return;
      const noRegionCount = pending.filter(p=>ids.includes(p.id) && !p.region_id).length;
      const confirmMsg = noRegionCount
        ? `Approve ${ids.length} people? ${noRegionCount} of them have no region set yet — you'll need to edit those individually afterward to assign a region and add them to Roster.`
        : `Approve ${ids.length} people? Remember to add each of them to Roster afterward.`;
      if (!confirm(confirmMsg)) return;
      const { error } = await sb.from('profiles').update({ status: 'active' }).in('id', ids);
      if (error){ toast('Could not approve: ' + error.message); return; }
      toast(`${ids.length} approved — don't forget to add them to Roster`); renderTeam();
    };
  }
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

  // Keep Roster in sync: disabling a rider's login should also stop showing
  // them as an active roster entry, and vice versa (previously these two
  // could drift apart — see the Javaid Alam bug report).
  if (p.role === 'rider'){
    if (newStatus === 'disabled'){
      await sb.from('roster_entries').update({
        status: 'removed', removal_reason: 'Login Disabled',
        removal_note: 'Automatically set when this account was disabled from Team.'
      }).eq('rider_id', profileId).neq('status', 'removed');
      toast('Account disabled — their roster entry was also marked removed.');
    } else {
      toast('Account enabled. Note: their Roster entry was not automatically restored — re-add it in Roster if they are actively working again.');
    }
  } else {
    toast(newStatus === 'disabled' ? 'Account disabled' : 'Account enabled');
  }
  renderTeam();
}

function openResetPasswordModal(profileId, resetRequestId){
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
    if (resetRequestId){
      await sb.from('password_reset_requests').update({ status:'resolved', resolved_by: state.user.id, resolved_at: new Date().toISOString() }).eq('id', resetRequestId);
    }
    closeModal(); toast('Password reset'); renderTeam();
  };
}

async function openApproveModal(profileId){
  const p = state.profilesInScope.find(x=>x.id===profileId);
  const isMultiRegionRole = ['regional_poc','team_lead','coordinator','inventory_coordinator'].includes(p.role);
  const { data: existingRegions } = await sb.from('profile_regions').select('region_id').eq('profile_id', profileId);
  const selectedIds = new Set((existingRegions||[]).map(r=>r.region_id));
  if (!selectedIds.size && p.region_id) selectedIds.add(p.region_id);
  const canEditCredentials = isAdmin() || hasPermission('edit_credentials');

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
      ${canEditCredentials ? `
      <div class="two-col">
        <div class="form-row"><label>Full name</label><input type="text" id="ap-name" value="${escapeHtml(p.full_name||'')}"></div>
        <div class="form-row"><label>Employee ID</label><input type="text" id="ap-empid" value="${escapeHtml(p.employee_id||'')}"></div>
      </div>
      <div class="two-col">
        <div class="form-row"><label>Mobile number</label><input type="text" id="ap-phone" value="${escapeHtml((p.phone||'').replace('+92','0'))}" maxlength="11" placeholder="03XXXXXXXXX"></div>
        <div class="form-row"><label>Email (optional)</label><input type="email" id="ap-email" value="${escapeHtml(p.email||'')}"></div>
      </div>` : ''}
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
    const checked = isMulti ? Array.from(document.querySelectorAll('.ap-region-check:checked')).map(cb=>cb.value) : [];
    // For multi-region roles, region_id is just a convenience fallback — set it to
    // the first checked region (never the stale hidden single-select value).
    const regionIdToSave = isMulti ? (checked[0] || null) : (document.getElementById('ap-region').value || null);

    const payload = { role, status, region_id: regionIdToSave };
    if (canEditCredentials){
      payload.full_name = toProperCase(document.getElementById('ap-name').value.trim());
      payload.employee_id = document.getElementById('ap-empid').value.trim();
      payload.phone = toE164(document.getElementById('ap-phone').value.trim());
      payload.email = document.getElementById('ap-email').value.trim();
    }

    const { error } = await sb.from('profiles').update(payload).eq('id', profileId);
    if (error){
      if (error.code === '23505' || /duplicate key/i.test(error.message)){
        const conflictField = /employee_id/i.test(error.message) ? 'Employee ID' : /phone/i.test(error.message) ? 'Mobile number' : /email/i.test(error.message) ? 'Email' : 'value';
        toast(`Could not save — that ${conflictField} is already used by another account.`);
      } else {
        toast('Could not save: ' + error.message);
      }
      return;
    }

    if (isMulti){
      await sb.from('profile_regions').delete().eq('profile_id', profileId);
      if (checked.length){
        await sb.from('profile_regions').insert(checked.map(region_id => ({ profile_id: profileId, region_id })));
      }
      if (!checked.length){
        toast('⚠️ No region was checked — this person won\'t be able to see or post anything region-specific until you select at least one region.');
      }
    } else {
      await sb.from('profile_regions').delete().eq('profile_id', profileId);
    }
    closeModal(); toast('Saved'); renderTeam();
    // If this was a fresh approval of a rider, prompt to add them to Roster
    // right away rather than letting it be forgotten.
    if (p.status === 'pending' && role === 'rider'){
      if (confirm(`${p.full_name} is now active. Add them to the Roster now?`)){
        openRosterModal(null);
        setTimeout(() => { const sel = document.getElementById('ro-rider'); if (sel) sel.value = profileId; }, 200);
      }
    }
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
    <p class="hint">Paste rows as: <strong>Mobile Number, Employee ID, Full Name, Region</strong> — one rider per line, comma-separated. Region is optional per row (falls back to the default below). Everyone gets password <strong>Test@123</strong> (forced to change it on first login), and lands as <strong>pending</strong> — just review and Approve them on this page afterward.</p>
    <form id="bulk-form">
      <div class="form-row"><label>Default region (used if a row doesn't specify one)</label><select id="bulk-region">${regionOptions}</select></div>
      <div class="form-row"><label>Rider list</label><textarea id="bulk-rows" rows="8" placeholder="03001234567, EMP1001, Ali Khan, Lahore
03007654321, EMP1002, Bilal Ahmed, Multan"></textarea></div>
      <button class="btn-primary" type="submit">Create logins</button>
    </form>
    <div id="bulk-results" style="margin-top:14px;"></div>
  `);
  document.getElementById('bulk-form').onsubmit = async (e) => {
    e.preventDefault();
    const defaultRegionId = document.getElementById('bulk-region').value;
    const lines = document.getElementById('bulk-rows').value.split('\n').map(l=>l.trim()).filter(Boolean);
    const rows = lines.map(line => {
      const parts = line.split(/\t|,/).map(p=>p.trim());
      const regionName = parts[3] || '';
      const matchedRegion = regionName ? state.regions.find(r => r.name.toLowerCase() === regionName.toLowerCase()) : null;
      return { phone: parts[0], employee_id: parts[1], full_name: toProperCase(parts[2]||''), region_id: matchedRegion?.id || null };
    });
    if (!rows.length){ toast('Paste at least one rider row'); return; }
    document.getElementById('bulk-results').innerHTML = '<div class="mono">Creating logins…</div>';
    const resp = await callEdgeFunction('bulk_create_riders', { rows, region_id: defaultRegionId });
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
      ${results.map(r=>`<tr><td class="mono">${escapeHtml(r.phone)}</td><td>${r.ok ? '<span class="badge pending">Created — pending approval</span>' : `<span class="badge open">Failed: ${escapeHtml(r.error||'')}</span>`}</td></tr>`).join('')}
    </tbody></table>`;
    toast(`${results.filter(r=>r.ok).length} of ${results.length} logins created — approve them below`);
    renderTeam();
  };
}

// ---------------------------------------------------------
// REGIONS (admin only)
// ---------------------------------------------------------
async function renderRegions(){
  const main = document.getElementById('main-content');
  const canAdd = isAdmin() || hasPermission('regions_add');
  const canEdit = isAdmin() || hasPermission('regions_edit');
  const canRemove = isAdmin() || hasPermission('regions_remove');
  document.getElementById('topbar-actions').innerHTML = canAdd ? `<button class="btn" id="new-region-btn">+ Add Region</button>` : '';
  if (canAdd) document.getElementById('new-region-btn').onclick = () => openRegionModal(null);

  const { data: allRegions } = await sb.from('regions').select('*').order('name');
  const { data: allSubs } = await sb.from('sub_regions').select('*').eq('active', true).order('name');
  const subsByRegion = {};
  (allSubs||[]).forEach(s => { (subsByRegion[s.region_id] ||= []).push(s); });

  main.innerHTML = `<table><thead><tr><th>Region</th><th>Sub-Regions / Cities</th><th>Status</th>${(canEdit||canRemove)?'<th></th>':''}</tr></thead><tbody>
    ${(allRegions||[]).map(r=>{
      const subs = subsByRegion[r.id] || [];
      return `<tr>
      <td>${escapeHtml(r.name)}</td>
      <td>${subs.length
        ? `<select style="max-width:220px;"><option>${subs.length} sub-region${subs.length>1?'s':''} ▾</option>${subs.map(s=>`<option disabled>${escapeHtml(s.name)}</option>`).join('')}</select>`
        : `<span class="mono" style="color:var(--muted);">None yet</span>`}</td>
      <td><span class="badge ${r.active!==false?'active':'closed'}">${r.active!==false?'Active':'Deactivated'}</span></td>
      ${(canEdit||canRemove) ? `<td style="white-space:nowrap;">
        ${canEdit ? `<button class="btn small outline" data-edit-region="${r.id}">Edit</button>` : ''}
        ${canRemove ? `<button class="btn small outline" data-toggle-region="${r.id}" data-active="${r.active!==false}">${r.active!==false?'Deactivate':'Reactivate'}</button>` : ''}
      </td>` : ''}
    </tr>`;
    }).join('')}
  </tbody></table>
  <p class="hint" style="margin-top:12px;">To add or rename sub-regions/cities, go to Settings → Sub-Regions / Cities.</p>`;

  main.querySelectorAll('[data-edit-region]').forEach(btn => {
    btn.onclick = () => openRegionModal((allRegions||[]).find(r=>r.id===btn.dataset.editRegion));
  });
  main.querySelectorAll('[data-toggle-region]').forEach(btn => {
    btn.onclick = async () => {
      const willDeactivate = btn.dataset.active === 'true';
      if (willDeactivate && !confirm('Deactivate this region? Staff assigned only to this region will need reassigning.')) return;
      const payload = willDeactivate
        ? { active: false, deactivated_at: new Date().toISOString() }
        : { active: true, deactivated_at: null };
      const { error } = await sb.from('regions').update(payload).eq('id', btn.dataset.toggleRegion);
      if (error){ toast('Could not update: ' + error.message); return; }
      toast(willDeactivate ? 'Region deactivated' : 'Region reactivated');
      await loadRegions(); renderRegions();
    };
  });
}

function openRegionModal(region){
  openModal(`
    <h2>${region ? 'Edit' : 'Add'} region</h2>
    <form id="region-form">
      <div class="form-row"><label>Region name</label><input type="text" id="reg-name" value="${region?escapeHtml(region.name):''}" required></div>
      <div class="form-row"><label>Approved headcount</label><input type="number" id="reg-headcount" min="0" value="${region?.approved_headcount ?? ''}" placeholder="Budgeted number of riders for this region">
        <span class="field-hint">Used on the Roster page to show Approved vs Currently Working.</span>
      </div>
      <button class="btn-primary" type="submit">Save</button>
    </form>
  `);
  document.getElementById('region-form').onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('reg-name').value.trim();
    const headcountVal = document.getElementById('reg-headcount').value;
    const payload = { name, approved_headcount: headcountVal ? parseInt(headcountVal,10) : null };
    const { error } = region
      ? await sb.from('regions').update(payload).eq('id', region.id)
      : await sb.from('regions').insert(payload);
    if (error){ toast('Could not save: ' + error.message); return; }
    closeModal(); toast('Saved'); await loadRegions(); renderRegions();
  };
}

// ---------------------------------------------------------
// SETTINGS (admin only) — Categories, Warning Types, Expiry Types,
// Compliance Items, Home Notice — everything configurable lives here
// ---------------------------------------------------------
let settingsTab = 'categories';
async function renderSettings(){
  const main = document.getElementById('main-content');
  document.getElementById('topbar-actions').innerHTML = '';
  const groups = [
    { label: 'Workflow', items: [
      ['categories','Request Categories', () => isAdmin() || hasPermission('categories_add') || hasPermission('categories_edit') || hasPermission('categories_remove')],
      ['circularcategories','Circular Categories', () => isAdmin() || hasPermission('circular_categories_manage')],
    ]},
    { label: 'Types & Categories', items: [
      ['warningtypes','Warning Types', () => isAdmin() || hasPermission('manage_types')],
      ['expirytypes','Expiry Item Types', () => isAdmin() || hasPermission('manage_types')],
      ['tooltypes','Tool Types', () => isAdmin() || hasPermission('manage_types')],
      ['compliancetypes','Compliance Items', () => isAdmin() || hasPermission('manage_types')],
      ['shifttypes','Shift Types', () => isAdmin() || hasPermission('manage_types')],
    ]},
    { label: 'Regions', items: [
      ['subregions','Sub-Regions / Cities', () => isSuperAdmin()],
      ['hotspots','Hotspots', () => isAdmin() || hasPermission('regions_add') || hasPermission('regions_edit') || hasPermission('regions_remove')],
    ]},
    { label: 'Branding & Announcements', items: [
      ['notice','Home Notice', () => isAdmin()],
      ['branding','Login Page Branding', () => isSuperAdmin()],
      ['homebanner','Home Banner', () => isSuperAdmin()],
      ['popups','Popup Announcements', () => isSuperAdmin()],
    ]},
    { label: 'System', items: [
      ['permissions','Permissions', () => isSuperAdmin()],
      ['storage','Storage Usage', () => isSuperAdmin()],
      ['maintenance','Maintenance & Word Limits', () => isSuperAdmin()],
      ['shortcuts','Keyboard Shortcuts', () => isSuperAdmin()],
    ]}
  ];
  const visibleGroups = groups
    .map(g => ({ label: g.label, items: g.items.filter(([,,can]) => can()) }))
    .filter(g => g.items.length);
  const flatKeys = visibleGroups.flatMap(g => g.items.map(([k]) => k));
  if (!flatKeys.includes(settingsTab)) settingsTab = flatKeys[0] || 'categories';

  main.innerHTML = `
    <div style="display:grid; grid-template-columns:220px 1fr; gap:24px; align-items:start;">
      <div>
        ${visibleGroups.map(g => `
          <div style="margin-bottom:18px;">
            <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted); padding:0 4px 6px;">${g.label}</div>
            ${g.items.map(([k,label]) => `<button class="btn small ${settingsTab===k?'':'outline'}" data-settings-tab="${k}" style="display:block; width:100%; text-align:left; margin-bottom:4px;">${label}</button>`).join('')}
          </div>`).join('')}
      </div>
      <div id="settings-body" class="card"></div>
    </div>`;
  main.querySelectorAll('[data-settings-tab]').forEach(btn => {
    btn.onclick = () => { settingsTab = btn.dataset.settingsTab; renderSettings(); };
  });
  const body = document.getElementById('settings-body');
  if (settingsTab === 'categories') await renderCategoriesInto(body);
  else if (settingsTab === 'warningtypes') await renderSimpleTypeList(body, 'warning_types', 'Warning Type');
  else if (settingsTab === 'expirytypes') await renderSimpleTypeList(body, 'expiry_item_types', 'Expiry Item Type');
  else if (settingsTab === 'tooltypes') await renderToolTypesSettings(body);
  else if (settingsTab === 'compliancetypes') await renderSimpleTypeList(body, 'compliance_item_types', 'Compliance Item');
  else if (settingsTab === 'subregions') await renderSubRegionsSettings(body);
  else if (settingsTab === 'hotspots') await renderHotspotsSettings(body);
  else if (settingsTab === 'shifttypes') await renderSimpleTypeList(body, 'shift_types', 'Shift');
  else if (settingsTab === 'circularcategories') await renderSimpleTypeList(body, 'circular_categories', 'Circular Category');
  else if (settingsTab === 'notice') await renderHomeNoticeSettings(body);
  else if (settingsTab === 'branding') await renderBrandingSettings(body);
  else if (settingsTab === 'homebanner') await renderHomeBannerSettings(body);
  else if (settingsTab === 'popups') await renderPopupsSettings(body);
  else if (settingsTab === 'permissions') await renderPermissionsSettings(body);
  else if (settingsTab === 'storage') await renderStorageSettings(body);
  else if (settingsTab === 'maintenance') await renderMaintenanceSettings(body);
  else if (settingsTab === 'shortcuts') await renderShortcutsSettings(body);
}

async function renderCategoriesInto(body){
  const canAdd = isAdmin() || hasPermission('categories_add');
  const canEdit = isAdmin() || hasPermission('categories_edit') || hasPermission('categories_remove');
  const { data: cats } = await sb.from('categories').select('*').order('name');
  const renderRows = (list) => `<table><thead><tr><th>Category</th><th>Routes to</th><th>TAT (hrs)</th><th>Status</th>${canEdit?'<th></th>':''}</tr></thead><tbody>
    ${list.map(c=>`<tr>
      <td>${escapeHtml(c.name)}</td>
      <td>${ROLE_LABEL[c.primary_role]||c.primary_role}</td>
      <td class="mono">${c.tat_hours ?? '—'}</td>
      <td><span class="badge ${c.active?'active':'closed'}">${c.active?'Active':'Inactive'}</span></td>
      ${canEdit ? `<td><button class="btn small outline" data-edit-cat="${c.id}">Edit</button></td>` : ''}
    </tr>`).join('')}
  </tbody></table>`;
  body.innerHTML = `
    <div style="display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap;">
      ${canAdd ? `<button class="btn small" id="new-category-btn">+ Add Category</button>` : ''}
      <input type="text" id="cat-search" placeholder="Search categories…" style="flex:1; min-width:160px; padding:8px 10px; border:1px solid var(--line); border-radius:7px;">
      <select id="cat-sort" style="padding:8px 10px; border:1px solid var(--line); border-radius:7px;">
        <option value="az">A → Z</option><option value="za">Z → A</option><option value="newest">Newest first</option>
      </select>
    </div>
    <div id="cat-list">${renderRows(cats||[])}</div>`;
  if (canAdd) document.getElementById('new-category-btn').onclick = () => openCategoryModal(null);

  const applyFilters = () => {
    const q = document.getElementById('cat-search').value.toLowerCase();
    const sortMode = document.getElementById('cat-sort').value;
    let list = (cats||[]).filter(c => c.name.toLowerCase().includes(q));
    if (sortMode==='az') list = list.slice().sort((a,b)=>a.name.localeCompare(b.name));
    else if (sortMode==='za') list = list.slice().sort((a,b)=>b.name.localeCompare(a.name));
    else if (sortMode==='newest') list = list.slice().sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
    document.getElementById('cat-list').innerHTML = renderRows(list);
    bindActions();
  };
  document.getElementById('cat-search').oninput = applyFilters;
  document.getElementById('cat-sort').onchange = applyFilters;

  function bindActions(){
    document.querySelectorAll('[data-edit-cat]').forEach(btn => {
      btn.onclick = () => openCategoryModal((cats||[]).find(c=>c.id===btn.dataset.editCat));
    });
  }
  bindActions();
}

async function openCategoryModal(cat){
  const roleOptions = ['regional_poc','team_lead','inventory_coordinator']
    .map(r=>`<option value="${r}" ${cat?.primary_role===r?'selected':''}>${ROLE_LABEL[r]}</option>`).join('');
  let existingOverrides = {};
  if (cat){
    const { data } = await sb.from('category_region_overrides').select('*').eq('category_id', cat.id);
    (data||[]).forEach(o => { existingOverrides[o.region_id] = o.role; });
  }
  const overrideRows = state.regions.map(r => `
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
      <div style="width:110px; font-size:13px;">${escapeHtml(r.name)}</div>
      <select class="cat-override-role" data-region="${r.id}" style="flex:1; padding:6px 8px; border:1px solid var(--line); border-radius:6px; font-size:13px;">
        <option value="">Use default (${cat ? ROLE_LABEL[cat.primary_role] : '—'})</option>
        <option value="regional_poc" ${existingOverrides[r.id]==='regional_poc'?'selected':''}>${ROLE_LABEL.regional_poc}</option>
        <option value="team_lead" ${existingOverrides[r.id]==='team_lead'?'selected':''}>${ROLE_LABEL.team_lead}</option>
        <option value="inventory_coordinator" ${existingOverrides[r.id]==='inventory_coordinator'?'selected':''}>${ROLE_LABEL.inventory_coordinator}</option>
      </select>
    </div>`).join('');
  openModal(`
    <h2>${cat ? 'Edit' : 'Add'} category</h2>
    <form id="category-form">
      <div class="form-row"><label>Category name</label><input type="text" id="cat-name" value="${cat?escapeHtml(cat.name):''}" required></div>
      <div class="form-row"><label>Default routes to</label><select id="cat-role">${roleOptions}</select></div>
      <div class="form-row"><label>TAT — Turn Around Time (hours)</label><input type="number" id="cat-tat" min="1" value="${cat?.tat_hours ?? ''}" placeholder="e.g. 24"></div>
      ${cat ? `<div class="form-row"><label>Status</label><select id="cat-active">
        <option value="true" ${cat.active?'selected':''}>Active</option>
        <option value="false" ${!cat.active?'selected':''}>Inactive</option>
      </select></div>` : ''}
      ${cat ? `<div class="form-row"><label>Per-region overrides (optional)</label>
        <p class="hint" style="margin-bottom:8px;">e.g. this category routes to Area Incharge in Lahore, but Regional POC everywhere else.</p>
        ${overrideRows}
      </div>` : `<p class="hint">Save the category first, then edit it again to set per-region overrides.</p>`}
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

    if (cat){
      await sb.from('category_region_overrides').delete().eq('category_id', cat.id);
      const overrides = Array.from(document.querySelectorAll('.cat-override-role'))
        .filter(sel => sel.value)
        .map(sel => ({ category_id: cat.id, region_id: sel.dataset.region, role: sel.value }));
      if (overrides.length) await sb.from('category_region_overrides').insert(overrides);
    }
    closeModal(); toast('Saved'); await loadCategories(); renderSettings();
  };
}

// Generic add/enable/disable list for simple "type" tables (name + active)
async function renderSimpleTypeList(body, table, label){
  const { data: rows } = await sb.from(table).select('*').order('name');
  const renderRows = (list) => `<table><thead><tr><th>${label}</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map(r=>`<tr>
      <td>${escapeHtml(r.name)}</td>
      <td><span class="badge ${r.active?'active':'closed'}">${r.active?'Active':'Inactive'}</span></td>
      <td>
        <button class="btn small outline" data-edit-type="${r.id}">Edit</button>
        <button class="btn small outline" data-toggle-type="${r.id}" data-active="${r.active}">${r.active?'Disable':'Enable'}</button>
        <button class="btn small outline" data-delete-type="${r.id}">Remove</button>
      </td>
    </tr>`).join('')}
  </tbody></table>`;

  body.innerHTML = `
  <div style="display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap;">
    <button class="btn small" id="new-type-btn">+ Add ${label}</button>
    <input type="text" id="type-search" placeholder="Search ${label}…" style="flex:1; min-width:160px; padding:8px 10px; border:1px solid var(--line); border-radius:7px; font-size:13.5px;">
    <select id="type-sort" style="padding:8px 10px; border:1px solid var(--line); border-radius:7px; font-size:13.5px;">
      <option value="az">A → Z</option>
      <option value="za">Z → A</option>
      <option value="newest">Newest first</option>
    </select>
  </div>
  <div id="type-list-body">${renderRows(rows||[])}</div>
  <div class="hint" style="margin-top:14px;">Paste multiple at once, one per line:</div>
  <textarea id="bulk-type-rows" rows="4" style="width:100%; margin-top:8px; padding:9px 11px; border:1px solid var(--line); border-radius:7px;" placeholder="One name per line"></textarea>
  <button class="btn small" id="bulk-type-add" style="margin-top:8px;">Add All</button>`;

  const applyFilters = () => {
    const q = document.getElementById('type-search').value.toLowerCase();
    const sortMode = document.getElementById('type-sort').value;
    let list = (rows||[]).filter(r => r.name.toLowerCase().includes(q));
    if (sortMode === 'az') list = list.slice().sort((a,b)=>a.name.localeCompare(b.name));
    else if (sortMode === 'za') list = list.slice().sort((a,b)=>b.name.localeCompare(a.name));
    else if (sortMode === 'newest') list = list.slice().sort((a,b)=> new Date(b.created_at||0) - new Date(a.created_at||0));
    document.getElementById('type-list-body').innerHTML = renderRows(list);
    bindRowActions();
  };
  document.getElementById('type-search').oninput = applyFilters;
  document.getElementById('type-sort').onchange = applyFilters;

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
  function bindRowActions(){
    document.querySelectorAll('[data-edit-type]').forEach(btn => {
      btn.onclick = async () => {
        const row = (rows||[]).find(r=>r.id===btn.dataset.editType);
        const newName = prompt(`Rename "${row.name}" to:`, row.name);
        if (newName && newName.trim() && newName.trim() !== row.name){
          const { error } = await sb.from(table).update({ name: newName.trim() }).eq('id', row.id);
          if (error){ toast('Could not rename: ' + error.message); return; }
          toast('Renamed'); refreshReferenceAndRerender(table);
        }
      };
    });
    document.querySelectorAll('[data-toggle-type]').forEach(btn => {
      btn.onclick = async () => {
        const newActive = btn.dataset.active !== 'true';
        const { error } = await sb.from(table).update({ active: newActive }).eq('id', btn.dataset.toggleType);
        if (error){ toast('Could not update: ' + error.message); return; }
        refreshReferenceAndRerender(table);
      };
    });
    document.querySelectorAll('[data-delete-type]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Remove this permanently?')) return;
        const { error } = await sb.from(table).delete().eq('id', btn.dataset.deleteType);
        if (error){ toast('Could not remove (it may be in use): ' + error.message); return; }
        refreshReferenceAndRerender(table);
      };
    });
  }
  bindRowActions();
}
async function refreshReferenceAndRerender(table){
  await loadReferenceData();
  renderSettings();
}

async function renderBrandingSettings(body){
  const { data } = await sb.from('branding_settings').select('*').eq('id', 1).single();
  const b = data || {};
  body.innerHTML = `
    <div class="hint" style="margin-bottom:14px;">Text and pictures here update instantly for everyone — no GitHub editing needed.</div>
    <div class="form-row"><label>Left-panel tagline</label><input type="text" id="brand-tagline" value="${escapeHtml(b.tagline||'')}"></div>
    <div class="form-row"><label>Left-panel subtitle</label><input type="text" id="brand-subtitle" value="${escapeHtml(b.subtitle||'')}"></div>
    <div class="form-row"><label>Sign-in form title</label><input type="text" id="brand-login-title" value="${escapeHtml(b.login_title||'')}"></div>
    <div class="form-row"><label>Sign-in form subtitle</label><input type="text" id="brand-login-subtitle" value="${escapeHtml(b.login_subtitle||'')}"></div>
    <button class="btn" id="brand-save-btn">Save Text</button>

    <hr style="margin:24px 0; border:none; border-top:1px solid var(--line);">
    <h3>Pictures</h3>
    <p class="hint" style="margin-bottom:14px;">Upload a new picture to replace it everywhere instantly, or remove it to fall back to the default.</p>

    ${brandingImageRow('logo', 'Logo', b.logo_url)}
    ${brandingImageRow('sidebar_bg', 'Sidebar background', b.sidebar_bg_url)}
    ${brandingImageRow('login_bg', 'Sign-in page background', b.login_bg_url)}
  `;
  document.getElementById('brand-save-btn').onclick = async () => {
    const { error } = await sb.from('branding_settings').update({
      tagline: document.getElementById('brand-tagline').value.trim(),
      subtitle: document.getElementById('brand-subtitle').value.trim(),
      login_title: document.getElementById('brand-login-title').value.trim(),
      login_subtitle: document.getElementById('brand-login-subtitle').value.trim(),
      updated_by: state.user.id
    }).eq('id', 1);
    if (error){ toast('Could not save: ' + error.message); return; }
    toast('Saved');
  };

  ['logo','sidebar_bg','login_bg'].forEach(key => {
    const fileInput = document.getElementById(`brand-file-${key}`);
    const removeBtn = document.getElementById(`brand-remove-${key}`);
    fileInput.onchange = async () => {
      const file = fileInput.files[0];
      if (!file) return;
      toast('Uploading…');
      const path = `${key}-${Date.now()}.${file.name.split('.').pop()}`;
      const { error: upErr } = await sb.storage.from('branding').upload(path, file, { upsert: true });
      if (upErr){ toast('Could not upload: ' + upErr.message); return; }
      const { data: pub } = sb.storage.from('branding').getPublicUrl(path);
      const column = key + '_url';
      const { error: dbErr } = await sb.from('branding_settings').update({ [column]: pub.publicUrl, updated_by: state.user.id }).eq('id', 1);
      if (dbErr){ toast('Uploaded, but could not save: ' + dbErr.message); return; }
      toast('Updated'); await applyBrandingSettings(); renderSettings();
    };
    if (removeBtn){
      removeBtn.onclick = async () => {
        const column = key + '_url';
        await sb.from('branding_settings').update({ [column]: null }).eq('id', 1);
        toast('Reverted to default'); await applyBrandingSettings(); renderSettings();
      };
    }
  });
}

function brandingImageRow(key, label, currentUrl){
  return `
    <div class="form-row" style="display:flex; align-items:center; gap:14px;">
      ${currentUrl ? `<img src="${escapeHtml(currentUrl)}" style="width:60px; height:60px; object-fit:cover; border-radius:8px; border:1px solid var(--line);">` : `<div style="width:60px; height:60px; border-radius:8px; border:1px dashed var(--line); display:flex; align-items:center; justify-content:center; color:var(--muted); font-size:11px;">Default</div>`}
      <div style="flex:1;">
        <label style="font-weight:600; font-size:13px;">${label}</label>
        <input type="file" accept="image/*" id="brand-file-${key}" style="margin-top:4px;">
      </div>
      ${currentUrl ? `<button type="button" class="btn small outline" id="brand-remove-${key}">Revert to default</button>` : ''}
    </div>`;
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
  const canIssue = isAdmin() || ['regional_poc','team_lead','inventory_coordinator'].includes(state.profile.role);
  if (canIssue){
    document.getElementById('topbar-actions').innerHTML = `<button class="btn" id="new-warning-btn">+ Add Warning</button>`;
    document.getElementById('new-warning-btn').onclick = openNewWarningModal;
  } else {
    document.getElementById('topbar-actions').innerHTML = '';
  }
  const { data: warnings } = await sb.from('disciplinary_actions')
    .select('*, rider:profiles!rider_id(full_name, employee_id, region_id), recorder:profiles!recorded_by(full_name)')
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
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div class="mono">Recorded by ${escapeHtml(w.recorder?.full_name||'—')}</div>
        ${isSuperAdmin() ? `<div style="display:flex; gap:8px;">
          <button class="btn small outline" data-edit-warning="${w.id}">Edit</button>
          <button class="btn small danger" data-delete-warning="${w.id}">Delete</button>
        </div>` : ''}
      </div>
    </div>
  `).join('');

  if (isSuperAdmin()){
    main.querySelectorAll('[data-delete-warning]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Permanently delete this warning? This cannot be undone.')) return;
        const { error } = await sb.from('disciplinary_actions').delete().eq('id', btn.dataset.deleteWarning);
        if (error){ toast('Could not delete: ' + error.message); return; }
        toast('Warning deleted'); renderWarnings();
      };
    });
    main.querySelectorAll('[data-edit-warning]').forEach(btn => {
      btn.onclick = () => openEditWarningModal(warnings.find(w=>w.id===btn.dataset.editWarning));
    });
  }
}

async function openEditWarningModal(w){
  await loadScopedProfiles();
  const typeOptions = state.warningTypes.map(t=>`<option value="${t.id}" ${t.id===w.warning_type_id?'selected':''}>${escapeHtml(t.name)}</option>`).join('');
  const targets = state.profilesInScope.filter(p=>['rider','coordinator'].includes(p.role));
  const targetOptions = targets.map(p=>`<option value="${p.id}" ${p.id===w.rider_id?'selected':''}>${escapeHtml(p.full_name)} (${ROLE_LABEL[p.role]})</option>`).join('');
  openModal(`
    <h2>Edit warning</h2>
    <form id="warning-edit-form">
      <div class="form-row"><label>Rider / Coordinator</label><select id="we-target" required>${targetOptions}</select></div>
      <div class="form-row"><label>Type</label><select id="we-type">${typeOptions}</select></div>
      <div class="form-row"><label>Details</label><textarea id="we-desc" required>${escapeHtml(w.description||'')}</textarea>
        <span class="field-hint" id="we-word-count">0 words${state.systemSettings?.warning_word_limit?` / ${state.systemSettings.warning_word_limit} max`:''}</span>
      </div>
      <button class="btn-primary" type="submit">Save changes</button>
    </form>
  `);
  const editWordLimit = state.systemSettings?.warning_word_limit;
  const editDescEl = document.getElementById('we-desc');
  const editCounterEl = document.getElementById('we-word-count');
  const updateEditCounter = () => {
    const n = countWords(editDescEl.value);
    editCounterEl.textContent = `${n} words${editWordLimit?` / ${editWordLimit} max`:''}`;
    editCounterEl.style.color = (editWordLimit && n > editWordLimit) ? 'var(--clay)' : '';
  };
  editDescEl.oninput = updateEditCounter;
  updateEditCounter();
  document.getElementById('warning-edit-form').onsubmit = async (e) => {
    e.preventDefault();
    const description = editDescEl.value.trim();
    if (editWordLimit && countWords(description) > editWordLimit){ toast(`Please keep details under ${editWordLimit} words`); return; }
    const typeSelect = document.getElementById('we-type');
    const { error } = await sb.from('disciplinary_actions').update({
      rider_id: document.getElementById('we-target').value,
      warning_type_id: typeSelect.value,
      action_type: typeSelect.options[typeSelect.selectedIndex]?.textContent || w.action_type,
      description
    }).eq('id', w.id);
    if (error){ toast('Could not save: ' + error.message); return; }
    closeModal(); toast('Updated'); renderWarnings();
  };
}

async function openNewWarningModal(){
  await loadScopedProfiles();
  const canTargetCoordinators = isAdmin() || ['regional_poc','inventory_coordinator'].includes(state.profile.role)
    || (state.profile.role === 'team_lead' && hasPermission('warnings_issue_to_coordinator'));
  const targetRoles = canTargetCoordinators ? ['rider','coordinator'] : ['rider'];
  const riders = state.profilesInScope.filter(p=>targetRoles.includes(p.role));
  const options = riders.map(p=>`<option value="${p.id}" data-empid="${escapeHtml(p.employee_id||'—')}" data-region="${escapeHtml(state.regions.find(r=>r.id===p.region_id)?.name||'—')}">${escapeHtml(p.full_name)} ${p.employee_id?'('+escapeHtml(p.employee_id)+')':''}</option>`).join('');
  const typeOptions = state.warningTypes.map(t=>`<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  openModal(`
    <h2>Add warning</h2>
    <form id="warning-form">
      <div class="form-row"><label>${canTargetCoordinators?'Rider / Coordinator':'Rider'}</label><select id="w-rider" required>${options}</select></div>
      <div class="form-row two-col" style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
        <div><label style="font-size:13px; font-weight:600; color:var(--ink-soft);">Employee ID</label><input type="text" id="w-empid" disabled></div>
        <div><label style="font-size:13px; font-weight:600; color:var(--ink-soft);">Region</label><input type="text" id="w-region" disabled></div>
      </div>
      <div class="form-row"><label>Type</label><select id="w-type">${typeOptions}</select></div>
      <div class="form-row"><label>Details</label><textarea id="w-desc" required placeholder="What happened, what was discussed, any outcome…"></textarea>
        <span class="field-hint" id="w-word-count">0 words${state.systemSettings?.warning_word_limit?` / ${state.systemSettings.warning_word_limit} max`:''}</span>
      </div>
      <button class="btn-primary" type="submit">Save</button>
    </form>
  `);
  const wordLimit = state.systemSettings?.warning_word_limit;
  const descEl = document.getElementById('w-desc');
  const counterEl = document.getElementById('w-word-count');
  descEl.oninput = () => {
    const n = countWords(descEl.value);
    counterEl.textContent = `${n} words${wordLimit?` / ${wordLimit} max`:''}`;
    counterEl.style.color = (wordLimit && n > wordLimit) ? 'var(--clay)' : '';
  };
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
    const description = document.getElementById('w-desc').value.trim();
    if (wordLimit && countWords(description) > wordLimit){ toast(`Please keep details under ${wordLimit} words`); return; }
    const typeId = document.getElementById('w-type').value;
    const typeName = state.warningTypes.find(t=>t.id===typeId)?.name || 'Other';
    const { error } = await sb.from('disciplinary_actions').insert({
      rider_id: document.getElementById('w-rider').value,
      warning_type_id: typeId,
      action_type: typeName,
      description,
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
    document.getElementById('topbar-actions').innerHTML = `
      <button class="btn outline" id="kb-excel-btn">+ Add from Excel</button>
      <button class="btn" id="new-kb-btn">+ Add Article</button>`;
    document.getElementById('new-kb-btn').onclick = openNewKbModal;
    document.getElementById('kb-excel-btn').onclick = openKbExcelModal;
  }
  let circularsQuery = sb.from('circulars').select('id, title, body, created_at').eq('push_to_kb', true).order('created_at', {ascending:false});
  let articlesQuery = sb.from('knowledge_base_articles').select('*, profiles(full_name)').order('created_at', {ascending:false});
  if (!isAdmin()){
    circularsQuery = circularsQuery.gte('created_at', state.profile.created_at);
    articlesQuery = articlesQuery.gte('created_at', state.profile.created_at);
  }
  const [circularsRes, articlesRes] = await Promise.all([circularsQuery, articlesQuery]);
  const combined = [
    ...(circularsRes.data||[]).map(c => ({ type:'Circular', title:c.title, body:c.body, created_at:c.created_at })),
    ...(articlesRes.data||[]).map(a => ({ type:'Article', title:a.title, body:a.body, created_at:a.created_at, author:a.profiles?.full_name, table_data:a.table_data }))
  ].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

  if (!combined.length){ main.innerHTML = emptyState('No knowledge base entries yet.'); return; }

  const canDownloadKb = isSuperAdmin() || hasPermission('kb_download');
  main.innerHTML = `<div style="display:flex; gap:10px; align-items:center; margin-bottom:14px;">
      <div class="form-row" style="flex:1; margin-bottom:0;"><input type="text" id="kb-search" placeholder="Search knowledge base…"></div>
      ${canDownloadKb ? `<button class="btn small outline" id="kb-download-btn">Download All (CSV)</button>` : ''}
    </div>` +
    `<div id="kb-list">` + combined.map((e,i) => `
    <div class="card kb-entry" data-search="${escapeHtml((e.title+' '+e.body).toLowerCase())}" data-kb-index="${i}" style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
      <div>
        <h3 style="margin-bottom:2px;">${escapeHtml(e.title)}</h3>
        <div class="mono">${e.author?escapeHtml(e.author)+' · ':''}${formatDateTime(e.created_at)}</div>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="badge ${e.type==='Circular'?'in_progress':'active'}">${e.type}</span>
        <span class="mono">›</span>
      </div>
    </div>`).join('') + `</div>`;

  if (canDownloadKb){
    document.getElementById('kb-download-btn').onclick = () => {
      const rows = combined.map(e => ({ Type: e.type, Title: e.title, Content: e.body, Author: e.author||'', 'Created At': e.created_at }));
      downloadCSV('knowledge-base-export.csv', toCSV(rows));
    };
  }

  document.getElementById('kb-search').oninput = (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.kb-entry').forEach(el => {
      el.style.display = el.dataset.search.includes(q) ? '' : 'none';
    });
  };
  document.querySelectorAll('.kb-entry').forEach(el => {
    el.onclick = () => {
      const e = combined[el.dataset.kbIndex];
      let tableHtml = '';
      if (e.table_data && e.table_data.length){
        const headers = Object.keys(e.table_data[0]);
        tableHtml = `<div style="overflow-x:auto;"><table><thead><tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>
          ${e.table_data.map(row => `<tr>${headers.map(h=>`<td>${escapeHtml(row[h])}</td>`).join('')}</tr>`).join('')}
        </tbody></table></div>`;
      }
      openModal(`
        <h2>${escapeHtml(e.title)}</h2>
        <div class="mono" style="margin-bottom:10px;">${e.author?escapeHtml(e.author)+' · ':''}${formatDateTime(e.created_at)}</div>
        ${e.body ? `<p style="font-size:14px; white-space:pre-wrap;">${escapeHtml(e.body)}</p>` : ''}
        ${tableHtml}
      `);
    };
  });
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

function openKbExcelModal(){
  openModal(`
    <h2>Add article from Excel</h2>
    <p class="hint">Great for reference tables that change often — e.g. Panel Companies and their required documents. Upload the sheet again anytime to refresh it (a new dated entry is created each time).</p>
    <form id="kb-excel-form">
      <div class="form-row"><label>Title</label><input type="text" id="kbx-title" required placeholder="e.g. Panel Companies — Required Documents"></div>
      <div class="form-row"><label>Excel file (.xlsx or .csv)</label><input type="file" id="kbx-file" accept=".xlsx,.xls,.csv" required></div>
      <button class="btn-primary" type="submit">Import</button>
    </form>
    <div id="kbx-status" class="mono" style="margin-top:10px;"></div>
  `);
  document.getElementById('kb-excel-form').onsubmit = async (e) => {
    e.preventDefault();
    const file = document.getElementById('kbx-file').files[0];
    const title = document.getElementById('kbx-title').value.trim();
    if (!file) return;
    document.getElementById('kbx-status').textContent = 'Reading file…';
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try{
        const wb = XLSX.read(evt.target.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet);
        if (!rows.length){ toast('No rows found in that sheet'); return; }
        const { error } = await sb.from('knowledge_base_articles').insert({
          title, body: `Imported from Excel — ${rows.length} rows.`, table_data: rows, created_by: state.user.id
        });
        if (error){ toast('Could not save: ' + error.message); return; }
        closeModal(); toast(`Imported ${rows.length} rows`); renderKnowledgeBase();
      }catch(err){
        document.getElementById('kbx-status').textContent = 'Could not read that file: ' + err.message;
      }
    };
    reader.readAsArrayBuffer(file);
  };
}

// ---------------------------------------------------------
// COMPLIANCE TRACKER — monthly Temperature/Inventory sheet submissions
// ---------------------------------------------------------
function currentPeriod(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function monthLabel(period){
  const [y,m] = period.split('-');
  return new Date(y, m-1, 1).toLocaleDateString('en-GB', {month:'long', year:'numeric'});
}
function shiftPeriod(period, delta){
  const [y,m] = period.split('-').map(Number);
  const d = new Date(y, m-1+delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

let complianceSelectedPeriod = null;
async function renderCompliance(){
  const main = document.getElementById('main-content');
  if (!complianceSelectedPeriod) complianceSelectedPeriod = currentPeriod();
  const period = complianceSelectedPeriod;
  const isCurrentMonth = period === currentPeriod();

  if (state.profile.role === 'rider'){
    const { data: mySubs } = await sb.from('compliance_submissions').select('*').eq('rider_id', state.user.id).eq('period', period);
    const submittedIds = new Set((mySubs||[]).map(s=>s.item_type_id));
    main.innerHTML = `<div class="card"><h3>${monthLabel(period)}${isCurrentMonth?' (current month)':''}</h3>
      <table><thead><tr><th>Item</th><th>Status</th><th></th></tr></thead><tbody>
      ${state.complianceItemTypes.map(t => `<tr>
        <td>${escapeHtml(t.name)}</td>
        <td>${submittedIds.has(t.id) ? '<span class="badge active">Submitted</span>' : '<span class="badge open">Pending</span>'}</td>
        <td>${(!submittedIds.has(t.id) && isCurrentMonth) ? `<button class="btn small" data-submit-compliance="${t.id}">Mark Submitted</button>` : ''}</td>
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

  // Staff/Admin view: who has/hasn't submitted, with a month picker and CSV export
  await loadScopedProfiles();
  const riders = state.profilesInScope.filter(p=>p.role==='rider');
  const { data: subs } = await sb.from('compliance_submissions').select('*').eq('period', period);
  const subMap = new Map((subs||[]).map(s => [s.rider_id+'|'+s.item_type_id, s.submitted_at]));

  const pendingCount = riders.reduce((sum, r) => sum + state.complianceItemTypes.filter(t => !subMap.has(r.id+'|'+t.id)).length, 0);
  const canCorrect = isSuperAdmin() || hasPermission('manage_types');

  main.innerHTML = `
    <div class="card" style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
      <div style="display:flex; align-items:center; gap:10px;">
        <button class="btn small outline" id="compliance-prev">‹ Prev</button>
        <h3 style="margin:0;">${monthLabel(period)}${isCurrentMonth?' <span class="badge active" style="margin-left:6px;">Current</span>':''}</h3>
        <button class="btn small outline" id="compliance-next" ${isCurrentMonth?'disabled':''}>Next ›</button>
      </div>
      <button class="btn small" id="compliance-csv-btn">Download Pending (CSV)</button>
    </div>
    <div class="card">
      <p class="hint">${pendingCount} item(s) still pending across all riders this month. Click "Mark as Received" for a pending item${canCorrect ? ', or click a ✓ received item to correct a mistaken click' : ''}.</p>
      <table><thead><tr><th>Rider</th><th>Region</th>${state.complianceItemTypes.map(t=>`<th>${escapeHtml(t.name)}</th>`).join('')}</tr></thead><tbody>
      ${riders.map(r => `<tr>
        <td>${escapeHtml(r.full_name)}</td>
        <td>${escapeHtml(state.regions.find(rg=>rg.id===r.region_id)?.name||'—')}</td>
        ${state.complianceItemTypes.map(t => {
          const submitted = subMap.get(r.id+'|'+t.id);
          if (submitted){
            return `<td><span class="badge active">✓ ${formatDate(submitted)}</span>${canCorrect ? ` <button class="btn small outline" data-revert-compliance="${r.id}|${t.id}" title="Mistakenly marked? Revert to pending">Revert</button>` : ''}</td>`;
          }
          return `<td><button class="btn small" data-mark-received="${r.id}|${t.id}" ${!isCurrentMonth?'disabled title="Only current month can be marked"':''}>Mark as Received</button></td>`;
        }).join('')}
      </tr>`).join('')}
      </tbody></table>
    </div>`;

  document.getElementById('compliance-prev').onclick = () => { complianceSelectedPeriod = shiftPeriod(period, -1); renderCompliance(); };
  document.getElementById('compliance-next').onclick = () => { complianceSelectedPeriod = shiftPeriod(period, 1); renderCompliance(); };
  document.getElementById('compliance-csv-btn').onclick = () => {
    const rows = [];
    riders.forEach(r => {
      state.complianceItemTypes.forEach(t => {
        if (!subMap.has(r.id+'|'+t.id)){
          rows.push({ Rider: r.full_name, 'Employee ID': r.employee_id||'', Region: state.regions.find(rg=>rg.id===r.region_id)?.name||'', Item: t.name, Month: monthLabel(period) });
        }
      });
    });
    if (!rows.length){ toast('No pending items — nothing to export'); return; }
    downloadCSV(`compliance-pending-${period}.csv`, toCSV(rows));
  };
  main.querySelectorAll('[data-mark-received]').forEach(btn => {
    if (btn.disabled) return;
    btn.onclick = async () => {
      const [riderId, itemTypeId] = btn.dataset.markReceived.split('|');
      const rider = riders.find(r=>r.id===riderId);
      const { error } = await sb.from('compliance_submissions').insert({
        rider_id: riderId, region_id: rider?.region_id, item_type_id: itemTypeId, period
      });
      if (error){ toast('Could not mark: ' + error.message); return; }
      toast('Marked as received'); renderCompliance();
    };
  });
  main.querySelectorAll('[data-revert-compliance]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Revert this back to Pending? Use this to correct a mistaken click.')) return;
      const [riderId, itemTypeId] = btn.dataset.revertCompliance.split('|');
      const { error } = await sb.from('compliance_submissions').delete().eq('rider_id', riderId).eq('item_type_id', itemTypeId).eq('period', period);
      if (error){ toast('Could not revert: ' + error.message); return; }
      toast('Reverted to pending'); renderCompliance();
    };
  });
}

// ---------------------------------------------------------
// REPORTS — CSV export for any date range (Admin)
// ---------------------------------------------------------
async function renderReports(){
  const main = document.getElementById('main-content');
  const today = new Date().toISOString().slice(0,10);
  const monthAgo = new Date(Date.now() - 30*24*60*60*1000).toISOString().slice(0,10);
  const canExportEmployees = isSuperAdmin() || hasPermission('export_active_employees');
  const now = new Date();
  const monthOptions = Array.from({length:12}, (_,i)=>{
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    return `<option value="${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}">${d.toLocaleString('default',{month:'long', year:'numeric'})}</option>`;
  }).join('');
  const yearOptions = Array.from({length:5}, (_,i)=>now.getFullYear()-i).map(y=>`<option value="${y}">${y}</option>`).join('');
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
          ${canExportEmployees ? `<option value="active_employees">Active Employees (e.g. for salary processing)</option>` : ''}
        </select></div>
        <div></div>
        <div class="form-row"><label>Date range</label><select id="rep-preset">
          <option value="custom">Custom range</option>
          <option value="month">A specific month</option>
          <option value="year">A specific year</option>
        </select></div>
        <div></div>
        <div class="form-row" id="rep-custom-wrap"><label>From</label><input type="date" id="rep-from" value="${monthAgo}"></div>
        <div class="form-row" id="rep-custom-wrap2"><label>To</label><input type="date" id="rep-to" value="${today}"></div>
        <div class="form-row" id="rep-month-wrap" style="display:none;"><label>Month</label><select id="rep-month">${monthOptions}</select></div>
        <div class="form-row" id="rep-year-wrap" style="display:none;"><label>Year</label><select id="rep-year">${yearOptions}</select></div>
      </div>
      <button class="btn-primary" id="rep-download-btn" style="width:auto; padding:10px 20px;">Download CSV</button>
      <div id="rep-status" class="mono" style="margin-top:10px;"></div>
    </div>
  `;
  document.getElementById('rep-preset').onchange = (e) => {
    const mode = e.target.value;
    document.getElementById('rep-custom-wrap').style.display = mode==='custom' ? 'block' : 'none';
    document.getElementById('rep-custom-wrap2').style.display = mode==='custom' ? 'block' : 'none';
    document.getElementById('rep-month-wrap').style.display = mode==='month' ? 'block' : 'none';
    document.getElementById('rep-year-wrap').style.display = mode==='year' ? 'block' : 'none';
  };
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
  const preset = document.getElementById('rep-preset').value;
  let from, to;
  if (preset === 'month'){
    const [y,m] = document.getElementById('rep-month').value.split('-').map(Number);
    from = new Date(y, m-1, 1).toISOString();
    to = new Date(y, m, 0, 23, 59, 59).toISOString();
  } else if (preset === 'year'){
    const y = parseInt(document.getElementById('rep-year').value, 10);
    from = new Date(y, 0, 1).toISOString();
    to = new Date(y, 11, 31, 23, 59, 59).toISOString();
  } else {
    from = document.getElementById('rep-from').value;
    to = document.getElementById('rep-to').value + 'T23:59:59';
  }
  const statusEl = document.getElementById('rep-status');
  statusEl.textContent = 'Generating…';

  let rows = [];
  if (type === 'requests'){
    const { data } = await sb.from('requests')
      .select('*, rider:profiles!rider_id(full_name, employee_id), poc:profiles!assigned_poc_id(full_name), categories(name, tat_hours)')
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
      .select('*, assignee:profiles!assigned_to(full_name, employee_id), assigner:profiles!assigned_by(full_name, employee_id)')
      .gte('created_at', from).lte('created_at', to);
    rows = (data||[]).map(t => ({
      Title: t.title, 'Assigned To': t.assignee?.full_name, 'Assigned By': t.assigner?.full_name,
      Status: t.status, 'Due Date': t.due_date||'', 'Created At': t.created_at
    }));
  } else if (type === 'circulars'){
    const { data } = await sb.from('circulars').select('*, profiles!created_by(full_name)').gte('created_at', from).lte('created_at', to);
    for (const c of (data||[])){
      const audience = await countAudience(c.target_region_id, c.target_role, c.created_by);
      const { count: ackCount } = await sb.from('circular_acks').select('id',{count:'exact',head:true}).eq('circular_id', c.id).neq('user_id', c.created_by);
      rows.push({ Title: c.title, 'Posted By': c.profiles?.full_name, 'Posted At': c.created_at, Audience: audience, Acknowledged: ackCount ?? 0, Pending: audience - (ackCount??0) });
    }
  } else if (type === 'expiry'){
    const { data } = await sb.from('expiry_items').select('*, profiles(full_name)').gte('created_at', from).lte('created_at', to);
    rows = (data||[]).map(i => ({ Rider: i.profiles?.full_name, Item: i.item_type, Label: i.item_label||'', 'Expiry Date': i.expiry_date, 'Added At': i.created_at }));
  } else if (type === 'warnings'){
    const { data } = await sb.from('disciplinary_actions').select('*, rider:profiles!rider_id(full_name, employee_id), recorder:profiles!recorded_by(full_name)').gte('created_at', from).lte('created_at', to);
    rows = (data||[]).map(w => ({ Rider: w.rider?.full_name, 'Employee ID': w.rider?.employee_id, Type: w.action_type, Description: w.description, 'Recorded By': w.recorder?.full_name, 'Created At': w.created_at }));
  } else if (type === 'active_employees'){
    const { data } = await sb.from('profiles').select('*, regions(name)').eq('status', 'active').order('full_name');
    rows = (data||[]).map(p => ({
      'Full Name': p.full_name, 'Employee ID': p.employee_id||'', Role: ROLE_LABEL[p.role]||p.role,
      'Mobile Number': p.phone||'', Email: p.email||'', Region: p.regions?.name||'', 'Bike Number': p.bike_number||'',
      'Joined On': p.created_at ? p.created_at.slice(0,10) : ''
    }));
  }

  if (!rows.length){ statusEl.textContent = 'No records found for that range.'; return; }
  downloadCSV(`fieldhub-${type}-${from}-to-${to.slice(0,10)}.csv`, toCSV(rows));
  statusEl.textContent = `Downloaded ${rows.length} rows.`;
}

async function renderSubRegionsSettings(body){
  const canManage = isSuperAdmin(); // Client explicitly wants this Super-Admin-only, not delegatable
  const regionOptions = state.regions.map(r=>`<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  const { data: subs } = await sb.from('sub_regions').select('*, regions(name)').order('name');
  const renderRows = (list) => `<table><thead><tr><th>Region</th><th>Sub-Region / City</th><th>Status</th>${canManage?'<th></th>':''}</tr></thead><tbody>
      ${list.map(s=>`<tr>
        <td>${escapeHtml(s.regions?.name||'—')}</td>
        <td>${escapeHtml(s.name)}</td>
        <td><span class="badge ${s.active?'active':'closed'}">${s.active?'Active':'Inactive'}</span></td>
        ${canManage ? `<td style="white-space:nowrap;">
          <button class="btn small outline" data-edit-subregion="${s.id}">Edit</button>
          <button class="btn small outline" data-toggle-subregion="${s.id}" data-active="${s.active}">${s.active?'Disable':'Enable'}</button>
          <button class="btn small danger" data-delete-subregion="${s.id}">Delete Permanently</button>
        </td>` : ''}
      </tr>`).join('')}
    </tbody></table>`;
  body.innerHTML = `
    <p class="hint" style="margin-bottom:14px;">For Lahore these are sub-regions (e.g. "1", "2"). For out-of-station regions like Multan/Faisalabad, use this for cities instead.${canManage?'':' Only Super Admin can add, edit, or delete these.'}</p>
    ${canManage ? `<form id="new-subregion-form" style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;">
      <select id="sr-region" required>${regionOptions}</select>
      <input type="text" id="sr-name" placeholder="e.g. 1, 2, or city name" required style="flex:1; min-width:160px; padding:8px 10px; border:1px solid var(--line); border-radius:7px;">
      <button class="btn small" type="submit">Add</button>
    </form>` : ''}
    <div style="display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap;">
      <input type="text" id="subregion-search" placeholder="Search sub-regions/cities…" style="flex:1; min-width:160px; padding:8px 10px; border:1px solid var(--line); border-radius:7px;">
      <select id="subregion-sort" style="padding:8px 10px; border:1px solid var(--line); border-radius:7px;">
        <option value="az">A → Z</option><option value="za">Z → A</option><option value="newest">Newest first</option>
      </select>
    </div>
    <div id="subregion-list">${renderRows(subs||[])}</div>`;

  if (canManage) document.getElementById('new-subregion-form').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.from('sub_regions').insert({
      region_id: document.getElementById('sr-region').value,
      name: document.getElementById('sr-name').value.trim()
    });
    if (error){ toast('Could not add: ' + error.message); return; }
    toast('Added'); renderSettings();
  };

  const applyFilters = () => {
    const q = document.getElementById('subregion-search').value.toLowerCase();
    const sortMode = document.getElementById('subregion-sort').value;
    let list = (subs||[]).filter(s => s.name.toLowerCase().includes(q) || (s.regions?.name||'').toLowerCase().includes(q));
    if (sortMode==='az') list = list.slice().sort((a,b)=>a.name.localeCompare(b.name));
    else if (sortMode==='za') list = list.slice().sort((a,b)=>b.name.localeCompare(a.name));
    else if (sortMode==='newest') list = list.slice().sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
    document.getElementById('subregion-list').innerHTML = renderRows(list);
    bindActions();
  };
  document.getElementById('subregion-search').oninput = applyFilters;
  document.getElementById('subregion-sort').onchange = applyFilters;

  function bindActions(){
    if (!canManage) return;
    document.querySelectorAll('[data-edit-subregion]').forEach(btn => {
      btn.onclick = async () => {
        const row = (subs||[]).find(s=>s.id===btn.dataset.editSubregion);
        const newName = prompt(`Rename "${row.name}" to:`, row.name);
        if (newName && newName.trim() && newName.trim() !== row.name){
          const { error } = await sb.from('sub_regions').update({ name: newName.trim() }).eq('id', row.id);
          if (error){ toast('Could not rename: ' + error.message); return; }
          toast('Renamed'); renderSettings();
        }
      };
    });
    document.querySelectorAll('[data-delete-subregion]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Permanently delete this sub-region? Roster entries and hotspots using it will lose that reference. This cannot be undone.')) return;
        const { error } = await sb.from('sub_regions').delete().eq('id', btn.dataset.deleteSubregion);
        if (error){ toast('Could not delete: ' + error.message); return; }
        toast('Deleted'); renderSettings();
      };
    });
    document.querySelectorAll('[data-toggle-subregion]').forEach(btn => {
      btn.onclick = async () => {
        await sb.from('sub_regions').update({ active: btn.dataset.active !== 'true' }).eq('id', btn.dataset.toggleSubregion);
        renderSettings();
      };
    });
  }
  bindActions();
}

async function renderHotspotsSettings(body){
  const regionOptions = state.regions.map(r=>`<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  const { data: subs } = await sb.from('sub_regions').select('*').order('name');
  const { data: hotspots } = await sb.from('hotspots').select('*, regions(name), sub_regions(name)').order('name');
  const renderRows = (list) => `<table><thead><tr><th>Region</th><th>Sub-Region/City</th><th>Hotspot</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map(h=>`<tr>
      <td>${escapeHtml(h.regions?.name||'—')}</td>
      <td>${escapeHtml(h.sub_regions?.name||'—')}</td>
      <td>${escapeHtml(h.name)}</td>
      <td><span class="badge ${h.active?'active':'closed'}">${h.active?'Active':'Inactive'}</span></td>
      <td style="white-space:nowrap;">
        <button class="btn small outline" data-edit-hotspot="${h.id}">Edit</button>
        <button class="btn small outline" data-toggle-hotspot="${h.id}" data-active="${h.active}">${h.active?'Disable':'Enable'}</button>
        <button class="btn small danger" data-delete-hotspot="${h.id}">Remove</button>
      </td>
    </tr>`).join('')}
  </tbody></table>`;

  body.innerHTML = `
    <p class="hint" style="margin-bottom:14px;">Hotspots/areas are scoped to a Region (and optionally a Sub-Region/City) so Roster only offers relevant options for whichever region is selected there.</p>
    <form id="new-hotspot-form" style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;">
      <select id="hs-region" required>${regionOptions}</select>
      <select id="hs-subregion"><option value="">— Any sub-region —</option></select>
      <input type="text" id="hs-name" placeholder="e.g. DHA Phase 5" required style="flex:1; min-width:160px; padding:8px 10px; border:1px solid var(--line); border-radius:7px;">
      <button class="btn small" type="submit">Add</button>
    </form>
    <details style="margin-bottom:16px;">
      <summary style="cursor:pointer; font-size:13px; color:var(--muted); user-select:none;">Bulk add hotspots ▾</summary>
      <p class="hint" style="margin:10px 0;">Paste rows as: <strong>Region, Sub-Region/City (optional), Hotspot name</strong> — one per line.</p>
      <textarea id="bulk-hotspot-rows" rows="6" style="width:100%; margin-bottom:8px;" placeholder="Lahore, 1, DHA Phase 5
Lahore, , Model Town
Multan, , Cantt Area"></textarea>
      <button class="btn small" id="bulk-hotspot-add">Add All</button>
      <div id="bulk-hotspot-results" style="margin-top:10px;"></div>
    </details>
    <div style="display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap;">
      <input type="text" id="hotspot-search" placeholder="Search hotspots…" style="flex:1; min-width:160px; padding:8px 10px; border:1px solid var(--line); border-radius:7px;">
      <select id="hotspot-sort" style="padding:8px 10px; border:1px solid var(--line); border-radius:7px;">
        <option value="az">A → Z</option><option value="za">Z → A</option><option value="newest">Newest first</option>
      </select>
    </div>
    <div id="hotspot-list">${renderRows(hotspots||[])}</div>`;

  const populateSubregionOptions = () => {
    const regionId = document.getElementById('hs-region').value;
    const opts = (subs||[]).filter(s=>s.region_id===regionId && s.active);
    document.getElementById('hs-subregion').innerHTML = '<option value="">— Any sub-region —</option>' + opts.map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  };
  document.getElementById('hs-region').onchange = populateSubregionOptions;
  populateSubregionOptions();

  document.getElementById('new-hotspot-form').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.from('hotspots').insert({
      region_id: document.getElementById('hs-region').value,
      sub_region_id: document.getElementById('hs-subregion').value || null,
      name: document.getElementById('hs-name').value.trim()
    });
    if (error){ toast('Could not add: ' + error.message); return; }
    toast('Added'); renderSettings();
  };

  document.getElementById('bulk-hotspot-add').onclick = async () => {
    const lines = document.getElementById('bulk-hotspot-rows').value.split('\n').map(l=>l.trim()).filter(Boolean);
    if (!lines.length) return;
    const resultsEl = document.getElementById('bulk-hotspot-results');
    resultsEl.innerHTML = '<div class="mono">Processing…</div>';
    const rows = [];
    for (const line of lines){
      const parts = line.split(/\t|,/).map(p=>p.trim());
      const [regionName, subRegionName, hotspotName] = parts;
      const region = state.regions.find(r => r.name.toLowerCase() === (regionName||'').toLowerCase());
      if (!region){ rows.push({ label: line, ok:false, msg:`Region "${regionName}" not found` }); continue; }
      const subRegion = subRegionName ? (subs||[]).find(s => s.region_id===region.id && s.name.toLowerCase()===subRegionName.toLowerCase()) : null;
      if (!hotspotName){ rows.push({ label: line, ok:false, msg:'No hotspot name given' }); continue; }
      const { error } = await sb.from('hotspots').insert({ region_id: region.id, sub_region_id: subRegion?.id || null, name: hotspotName });
      rows.push({ label: `${region.name}${subRegion?' / '+subRegion.name:''} — ${hotspotName}`, ok: !error, msg: error ? error.message : 'Added' });
    }
    resultsEl.innerHTML = `<table><thead><tr><th>Hotspot</th><th>Result</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td>${escapeHtml(r.label)}</td><td>${r.ok?`<span class="badge active">${escapeHtml(r.msg)}</span>`:`<span class="badge open">${escapeHtml(r.msg)}</span>`}</td></tr>`).join('')}
    </tbody></table><p class="hint" style="margin-top:8px;">Switch tabs and back (or reload) to see the updated list above.</p>`;
    toast(`${rows.filter(r=>r.ok).length} of ${rows.length} added`);
  };

  const applyFilters = () => {
    const q = document.getElementById('hotspot-search').value.toLowerCase();
    const sortMode = document.getElementById('hotspot-sort').value;
    let list = (hotspots||[]).filter(h => h.name.toLowerCase().includes(q) || (h.regions?.name||'').toLowerCase().includes(q));
    if (sortMode==='az') list = list.slice().sort((a,b)=>a.name.localeCompare(b.name));
    else if (sortMode==='za') list = list.slice().sort((a,b)=>b.name.localeCompare(a.name));
    else if (sortMode==='newest') list = list.slice().sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
    document.getElementById('hotspot-list').innerHTML = renderRows(list);
    bindActions();
  };
  document.getElementById('hotspot-search').oninput = applyFilters;
  document.getElementById('hotspot-sort').onchange = applyFilters;

  function bindActions(){
    document.querySelectorAll('[data-edit-hotspot]').forEach(btn => {
      btn.onclick = async () => {
        const row = (hotspots||[]).find(h=>h.id===btn.dataset.editHotspot);
        const newName = prompt(`Rename "${row.name}" to:`, row.name);
        if (newName && newName.trim() && newName.trim() !== row.name){
          const { error } = await sb.from('hotspots').update({ name: newName.trim() }).eq('id', row.id);
          if (error){ toast('Could not rename: ' + error.message); return; }
          toast('Renamed'); renderSettings();
        }
      };
    });
    document.querySelectorAll('[data-toggle-hotspot]').forEach(btn => {
      btn.onclick = async () => {
        await sb.from('hotspots').update({ active: btn.dataset.active !== 'true' }).eq('id', btn.dataset.toggleHotspot);
        renderSettings();
      };
    });
    document.querySelectorAll('[data-delete-hotspot]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Remove this hotspot permanently?')) return;
        const { error } = await sb.from('hotspots').delete().eq('id', btn.dataset.deleteHotspot);
        if (error){ toast('Could not remove: ' + error.message); return; }
        toast('Removed'); renderSettings();
      };
    });
  }
  bindActions();
}

async function renderShortcutsSettings(body){
  const rows = [
    ['General', [
      ['Esc', 'Close the open form/popup (or dismiss the newest notification if none is open)'],
      ['Ctrl/Cmd + K', 'Jump to the search box on the current page (Team, Permissions, Roster, Knowledge Base, and most Settings lists)'],
      ['Alt + N', 'Trigger the main "+ Add / New" button on the current page'],
      ['Tab / Shift+Tab', 'Move between fields in a form'],
      ['Enter', 'Submit the currently focused form'],
    ]],
    ['Search dropdowns (e.g. Settings → Permissions)', [
      ['↓', 'Highlight the next result'],
      ['↑', 'Highlight the previous result'],
      ['Enter', 'Select the highlighted result'],
      ['Esc', 'Close the results list'],
    ]],
  ];
  body.innerHTML = `
    <p class="hint" style="margin-bottom:16px;">These work anywhere in FieldHub, from any browser, no setup needed.</p>
    ${rows.map(([section, items]) => `
      <h3 style="margin-bottom:8px;">${escapeHtml(section)}</h3>
      <table style="margin-bottom:20px;"><tbody>
        ${items.map(([key,desc]) => `<tr><td class="mono" style="white-space:nowrap; width:160px;"><kbd style="background:var(--line); padding:2px 8px; border-radius:5px; font-size:12.5px;">${escapeHtml(key)}</kbd></td><td>${escapeHtml(desc)}</td></tr>`).join('')}
      </tbody></table>`).join('')}
  `;
}

async function renderPopupsSettings(body){
  const { data: popups } = await sb.from('popup_announcements').select('*').order('created_at', {ascending:false});
  body.innerHTML = `<button class="btn small" id="new-popup-btn" style="margin-bottom:14px;">+ New Popup</button>
  <table><thead><tr><th>Title</th><th>Status</th><th></th></tr></thead><tbody>
    ${(popups||[]).map(p=>`<tr>
      <td>${escapeHtml(p.title)}</td>
      <td><span class="badge ${p.active?'active':'closed'}">${p.active?'Active':'Inactive'}</span></td>
      <td>
        <button class="btn small outline" data-toggle-popup="${p.id}" data-active="${p.active}">${p.active?'Disable':'Enable'}</button>
        <button class="btn small outline" data-delete-popup="${p.id}">Remove</button>
      </td>
    </tr>`).join('')}
  </tbody></table>`;
  document.getElementById('new-popup-btn').onclick = () => {
    openModal(`
      <h2>New popup announcement</h2>
      <p class="hint">Shows once to every logged-in person on their next login/reload. Once someone dismisses it, it never shows to them again.</p>
      <form id="popup-form">
        <div class="form-row"><label>Title</label><input type="text" id="pu-title" required></div>
        <div class="form-row"><label>Message</label><textarea id="pu-body" required></textarea></div>
        <button class="btn-primary" type="submit">Publish</button>
      </form>
    `);
    document.getElementById('popup-form').onsubmit = async (e) => {
      e.preventDefault();
      const { error } = await sb.from('popup_announcements').insert({
        title: document.getElementById('pu-title').value.trim(),
        body: document.getElementById('pu-body').value.trim(),
        created_by: state.user.id
      });
      if (error){ toast('Could not publish: ' + error.message); return; }
      closeModal(); toast('Published'); renderSettings();
    };
  };
  body.querySelectorAll('[data-toggle-popup]').forEach(btn => {
    btn.onclick = async () => {
      await sb.from('popup_announcements').update({ active: btn.dataset.active !== 'true' }).eq('id', btn.dataset.togglePopup);
      renderSettings();
    };
  });
  body.querySelectorAll('[data-delete-popup]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Remove this popup permanently?')) return;
      await sb.from('popup_announcements').delete().eq('id', btn.dataset.deletePopup);
      renderSettings();
    };
  });
}

const GRANTABLE_PERMISSIONS = [
  ['categories_add', 'Request Categories — Add'],
  ['categories_edit', 'Request Categories — Edit'],
  ['categories_remove', 'Request Categories — Remove'],
  ['regions_add', 'Regions/Sub-Regions — Add'],
  ['regions_edit', 'Regions/Sub-Regions — Edit'],
  ['regions_remove', 'Regions/Sub-Regions — Remove/Deactivate'],
  ['manage_types', 'Manage Warning/Expiry/Compliance/Tool Types'],
  ['expiry_edit', 'Expiry Tracker — Edit entries'],
  ['expiry_delete', 'Expiry Tracker — Delete entries permanently'],
  ['edit_credentials', 'Edit any user\'s name/email/Employee ID/number'],
  ['kb_download', 'Download Knowledge Base data'],
  ['roster_manage', 'Add/Edit Roster entries'],
  ['request_delete', 'Requests — Delete permanently'],
  ['task_delete', 'Tasks — Delete permanently'],
  ['circular_categories_manage', 'Manage Circular Categories'],
  ['circular_push_kb', 'Push a Circular to Knowledge Base'],
  ['warnings_issue_to_coordinator', 'Area Incharge: issue warnings to Coordinators'],
  ['export_active_employees', 'Download active-employee list (e.g. for salary processing)'],
  ['tool_bulk_update', 'Bulk-update Tool records']
];
async function renderPermissionsSettings(body){
  await loadScopedProfiles();
  const staff = state.profilesInScope.filter(p => !['rider','super_admin'].includes(p.role) && p.status==='active');

  body.innerHTML = `<p class="hint" style="margin-bottom:14px;">Grant a specific person extra access beyond their normal role — e.g. let one Coordinator manage categories, or let one Area Incharge download the active-employee list.</p>
    <div class="form-row"><label>Search for a person</label>
      <input type="text" id="perm-user-search" placeholder="Type a name…" autocomplete="off">
      <div id="perm-user-results" style="border:1px solid var(--line); border-radius:8px; margin-top:6px; max-height:220px; overflow-y:auto; display:none;"></div>
    </div>
    <div id="perm-selected-user" class="card" style="display:none; margin-top:16px;"></div>`;

  const searchInput = document.getElementById('perm-user-search');
  const resultsBox = document.getElementById('perm-user-results');
  const selectedBox = document.getElementById('perm-selected-user');
  let highlightedIndex = -1;

  const highlightRow = (index) => {
    const rows = resultsBox.querySelectorAll('[data-pick-user]');
    rows.forEach(r => r.style.background = '');
    if (rows[index]){ rows[index].style.background = 'var(--line)'; rows[index].scrollIntoView({block:'nearest'}); }
    highlightedIndex = index;
  };

  searchInput.oninput = () => {
    const q = searchInput.value.trim().toLowerCase();
    highlightedIndex = -1;
    if (!q){ resultsBox.style.display = 'none'; resultsBox.innerHTML=''; return; }
    const matches = staff.filter(p => p.full_name.toLowerCase().includes(q) || (p.employee_id||'').toLowerCase().includes(q)).slice(0, 20);
    resultsBox.innerHTML = matches.length
      ? matches.map(p => `<div class="perm-result-row" data-pick-user="${p.id}" style="padding:9px 12px; cursor:pointer; border-bottom:1px solid var(--line);">
          <strong>${escapeHtml(p.full_name)}</strong> <span class="mono">· ${ROLE_LABEL[p.role]}${p.employee_id?' · '+escapeHtml(p.employee_id):''}</span>
        </div>`).join('')
      : `<div style="padding:9px 12px; color:var(--muted);">No match</div>`;
    resultsBox.style.display = 'block';
    resultsBox.querySelectorAll('[data-pick-user]').forEach(row => {
      row.onclick = () => selectPermUser(row.dataset.pickUser);
    });
  };

  searchInput.onkeydown = (e) => {
    const rows = resultsBox.querySelectorAll('[data-pick-user]');
    if (!rows.length) return;
    if (e.key === 'ArrowDown'){ e.preventDefault(); highlightRow(Math.min(highlightedIndex+1, rows.length-1)); }
    else if (e.key === 'ArrowUp'){ e.preventDefault(); highlightRow(Math.max(highlightedIndex-1, 0)); }
    else if (e.key === 'Enter'){ e.preventDefault(); if (highlightedIndex>=0 && rows[highlightedIndex]) selectPermUser(rows[highlightedIndex].dataset.pickUser); }
    else if (e.key === 'Escape'){ resultsBox.style.display = 'none'; }
  };

  async function selectPermUser(profileId){
    const p = staff.find(x=>x.id===profileId);
    resultsBox.style.display = 'none';
    searchInput.value = p.full_name;
    const { data: grants } = await sb.from('custom_permissions').select('permission_key').eq('profile_id', profileId);
    const originalGranted = new Set((grants||[]).map(g=>g.permission_key));
    selectedBox.style.display = 'block';
    selectedBox.innerHTML = `
      <h3 style="margin-bottom:2px;">${escapeHtml(p.full_name)}</h3>
      <div class="mono" style="margin-bottom:14px;">${ROLE_LABEL[p.role]}${p.employee_id?' · '+escapeHtml(p.employee_id):''}</div>
      ${GRANTABLE_PERMISSIONS.map(([key,label]) => `
        <label style="display:flex; align-items:center; gap:10px; padding:7px 0; border-bottom:1px solid var(--line); font-weight:400;">
          <input type="checkbox" data-perm-toggle="${key}" ${originalGranted.has(key)?'checked':''}> ${escapeHtml(label)}
        </label>`).join('')}
      <button class="btn-primary" id="perm-save-btn" style="margin-top:16px; width:auto; padding:10px 24px;">Save Settings</button>
      <span id="perm-save-status" class="mono" style="margin-left:10px;"></span>
    `;
    document.getElementById('perm-save-btn').onclick = async () => {
      const statusEl = document.getElementById('perm-save-status');
      statusEl.textContent = 'Saving…';
      const checkedNow = new Set(Array.from(selectedBox.querySelectorAll('[data-perm-toggle]:checked')).map(cb=>cb.dataset.permToggle));
      const toAdd = [...checkedNow].filter(k => !originalGranted.has(k));
      const toRemove = [...originalGranted].filter(k => !checkedNow.has(k));
      if (toAdd.length){
        await sb.from('custom_permissions').insert(toAdd.map(key => ({ profile_id: profileId, permission_key: key, granted_by: state.user.id })));
      }
      for (const key of toRemove){
        await sb.from('custom_permissions').delete().eq('profile_id', profileId).eq('permission_key', key);
      }
      toAdd.forEach(k=>originalGranted.add(k));
      toRemove.forEach(k=>originalGranted.delete(k));
      statusEl.textContent = 'Saved ✓';
      toast('Permissions updated');
      setTimeout(()=>{ if (statusEl) statusEl.textContent=''; }, 2000);
    };
  }
}

function formatBytes(n){
  if (!n) return '0 B';
  const units = ['B','KB','MB','GB'];
  let i = 0;
  while (n >= 1024 && i < units.length-1){ n /= 1024; i++; }
  return `${n.toFixed(n<10&&i>0?2:1)} ${units[i]}`;
}
async function listStorageFolderRecursive(bucket, path){
  const { data, error } = await sb.storage.from(bucket).list(path, { limit: 1000 });
  if (error || !data) return [];
  let files = [];
  for (const item of data){
    const fullPath = path ? `${path}/${item.name}` : item.name;
    if (item.id === null){ // folder
      files = files.concat(await listStorageFolderRecursive(bucket, fullPath));
    } else {
      files.push({ path: fullPath, size: item.metadata?.size || 0 });
    }
  }
  return files;
}
async function renderStorageSettings(body){
  body.innerHTML = `<div class="mono">Calculating usage…</div>`;
  const DB_CEILING = 500 * 1024 * 1024;
  const STORAGE_CEILING = 1024 * 1024 * 1024;

  const { data: tableStats, error: rpcError } = await sb.rpc('get_storage_usage');
  const { data: brandingFiles } = await listStorageFolderRecursive('branding', '').then(f=>({data:f})).catch(()=>({data:[]}));

  const dbTotal = (tableStats||[]).reduce((sum,t)=>sum + Number(t.size_bytes||0), 0);
  const storageTotal = (brandingFiles||[]).reduce((sum,f)=>sum+f.size, 0);

  const dbPct = Math.min(100, (dbTotal / DB_CEILING) * 100);
  const storagePct = Math.min(100, (storageTotal / STORAGE_CEILING) * 100);

  const topTables = (tableStats||[]).slice(0, 12);
  const topFiles = (brandingFiles||[]).slice().sort((a,b)=>b.size-a.size).slice(0,15);

  body.innerHTML = `
    <div class="card">
      <h3>Database — ${formatBytes(dbTotal)} of 500 MB used (${dbPct.toFixed(1)}%)</h3>
      <div style="background:var(--line); border-radius:6px; height:10px; overflow:hidden; margin:10px 0;">
        <div style="background:${dbPct>85?'var(--clay)':'var(--teal)'}; height:100%; width:${dbPct}%;"></div>
      </div>
      ${rpcError ? `<p class="hint">Couldn't read exact table sizes (${escapeHtml(rpcError.message)}). Run the get_storage_usage() function from Migration 11 first.</p>` : `
      <table><thead><tr><th>Table</th><th>Rows</th><th>Size</th></tr></thead><tbody>
        ${topTables.map(t=>`<tr><td>${escapeHtml(t.table_name)}</td><td class="mono">${t.row_count}</td><td class="mono">${formatBytes(Number(t.size_bytes))}</td></tr>`).join('')}
      </tbody></table>`}
    </div>
    <div class="card">
      <h3>File Storage — ${formatBytes(storageTotal)} of 1 GB used (${storagePct.toFixed(1)}%)</h3>
      <div style="background:var(--line); border-radius:6px; height:10px; overflow:hidden; margin:10px 0;">
        <div style="background:${storagePct>85?'var(--clay)':'var(--teal)'}; height:100%; width:${storagePct}%;"></div>
      </div>
      <p class="hint">Branding bucket (logo, sidebar, Home Banner uploads, KB attachments if any). Static repo images (logo.jpg etc.) don't count here — those are free on GitHub Pages.</p>
      <table><thead><tr><th>File</th><th>Size</th></tr></thead><tbody>
        ${topFiles.map(f=>`<tr><td class="mono">${escapeHtml(f.path)}</td><td class="mono">${formatBytes(f.size)}</td></tr>`).join('') || '<tr><td colspan="2">No files found.</td></tr>'}
      </tbody></table>
    </div>`;
}

async function renderHomeBannerSettings(body){
  const { data: b } = await sb.from('home_banner').select('*').eq('id', 1).maybeSingle();
  const isLive = b?.image_url && (!b.expires_at || new Date(b.expires_at) > new Date());
  body.innerHTML = `
    <p class="hint" style="margin-bottom:14px;">Shows a picture at the top of everyone's Dashboard until the expiry time you set — after that it's automatically hidden, and the old file is cleaned up the next time you upload a new one (so it never lingers taking up space).</p>
    ${b?.image_url ? `<img src="${escapeHtml(b.image_url)}" style="max-width:300px; border-radius:8px; border:1px solid var(--line); margin-bottom:14px; display:block;">
      <p class="mono" style="margin-bottom:14px;">${isLive ? `Live until ${formatDateTime(b.expires_at)}` : 'Expired (hidden from Dashboard)'}</p>` : ''}
    <div class="form-row"><label>New picture</label><input type="file" id="banner-file" accept="image/*"></div>
    <div class="form-row"><label>Show until</label><input type="datetime-local" id="banner-expiry"></div>
    <button class="btn" id="banner-save-btn">Upload &amp; Show</button>
    ${b?.image_url ? `<button class="btn outline" id="banner-remove-btn" style="margin-left:8px;">Remove Now</button>` : ''}
  `;
  document.getElementById('banner-save-btn').onclick = async () => {
    const file = document.getElementById('banner-file').files[0];
    const expiryVal = document.getElementById('banner-expiry').value;
    if (!file){ toast('Choose a picture first'); return; }
    if (!expiryVal){ toast('Set when it should stop showing'); return; }
    toast('Uploading…');
    const oldPath = b?.image_path;
    const newPath = `home-banner-${Date.now()}.${file.name.split('.').pop()}`;
    const { error: upErr } = await sb.storage.from('branding').upload(newPath, file, { upsert: true });
    if (upErr){ toast('Could not upload: ' + upErr.message); return; }
    const { data: pub } = sb.storage.from('branding').getPublicUrl(newPath);
    const { error: dbErr } = await sb.from('home_banner').update({
      image_url: pub.publicUrl, image_path: newPath,
      expires_at: new Date(expiryVal).toISOString(), updated_by: state.user.id
    }).eq('id', 1);
    if (dbErr){ toast('Uploaded, but could not save: ' + dbErr.message); return; }
    if (oldPath) await sb.storage.from('branding').remove([oldPath]); // clean up the previous file
    toast('Banner updated'); renderSettings();
  };
  if (b?.image_url){
    document.getElementById('banner-remove-btn').onclick = async () => {
      await sb.from('home_banner').update({ image_url: null, expires_at: null }).eq('id', 1);
      if (b.image_path) await sb.storage.from('branding').remove([b.image_path]);
      toast('Removed'); renderSettings();
    };
  }
}

async function renderMaintenanceSettings(body){
  const { data: sys } = await sb.from('system_settings').select('*').eq('id', 1).single();
  body.innerHTML = `
    <div class="card" style="border-left:4px solid ${sys?.portal_active?'var(--moss)':'var(--clay)'};">
      <h3>Portal status: ${sys?.portal_active ? 'Live' : 'Under maintenance'}</h3>
      <p class="hint">Turning this off immediately blocks everyone except Super Admin from using the portal.</p>
      <div class="form-row"><label>Message shown to everyone while offline</label><textarea id="maint-message">${escapeHtml(sys?.maintenance_message||'')}</textarea></div>
      <button class="btn ${sys?.portal_active?'danger':'success'}" id="maint-toggle-btn">${sys?.portal_active ? 'Take Portal Offline' : 'Bring Portal Back Online'}</button>
    </div>
    <div class="card">
      <h3>Word limits</h3>
      <p class="hint">Leave blank for no limit. These are shown live to whoever is typing.</p>
      <div class="form-row"><label>Max words per circular</label><input type="number" id="maint-word-limit" min="1" value="${sys?.circular_word_limit ?? ''}" placeholder="e.g. 150"></div>
      <div class="form-row"><label>Max words per request status remark</label><input type="number" id="maint-req-word-limit" min="1" value="${sys?.request_remark_word_limit ?? 25}" placeholder="e.g. 25"></div>
      <div class="form-row"><label>Max words per task status remark</label><input type="number" id="maint-task-word-limit" min="1" value="${sys?.task_remark_word_limit ?? 25}" placeholder="e.g. 25"></div>
      <div class="form-row"><label>Max words per warning description</label><input type="number" id="maint-warning-word-limit" min="1" value="${sys?.warning_word_limit ?? ''}" placeholder="e.g. 100"></div>
      <button class="btn" id="maint-wordlimit-btn">Save word limits</button>
    </div>
    <div class="card">
      <h3>Auto sign-out</h3>
      <p class="hint">How many minutes of inactivity before someone is automatically signed out.</p>
      <div class="form-row"><label>Minutes of inactivity</label><input type="number" id="maint-session-timeout" min="1" value="${sys?.session_timeout_minutes ?? 15}"></div>
      <button class="btn" id="maint-session-btn">Save</button>
    </div>
    <div class="card">
      <h3>Notification history</h3>
      <p class="hint">How many recent notifications to keep in everyone's notification bell (near the profile/sign-out buttons).</p>
      <div class="form-row"><label>Notifications to retain</label><input type="number" id="maint-notif-count" min="1" max="50" value="${sys?.notification_retain_count ?? 5}"></div>
      <button class="btn" id="maint-notif-btn">Save</button>
    </div>`;
  document.getElementById('maint-toggle-btn').onclick = async () => {
    const newState = !sys?.portal_active;
    if (newState === false && !confirm('This will block everyone except Super Admin from using FieldHub right now. Continue?')) return;
    const { error } = await sb.from('system_settings').update({
      portal_active: newState,
      maintenance_message: document.getElementById('maint-message').value.trim(),
      updated_by: state.user.id
    }).eq('id', 1);
    if (error){ toast('Could not update: ' + error.message); return; }
    toast(newState ? 'Portal is back online' : 'Portal is now offline for everyone else'); renderSettings();
  };
  document.getElementById('maint-wordlimit-btn').onclick = async () => {
    const val = document.getElementById('maint-word-limit').value;
    const reqVal = document.getElementById('maint-req-word-limit').value;
    const taskVal = document.getElementById('maint-task-word-limit').value;
    const warnVal = document.getElementById('maint-warning-word-limit').value;
    const { error } = await sb.from('system_settings').update({
      circular_word_limit: val ? parseInt(val,10) : null,
      request_remark_word_limit: reqVal ? parseInt(reqVal,10) : null,
      task_remark_word_limit: taskVal ? parseInt(taskVal,10) : null,
      warning_word_limit: warnVal ? parseInt(warnVal,10) : null
    }).eq('id', 1);
    if (error){ toast('Could not save: ' + error.message); return; }
    toast('Saved');
    state.systemSettings = {
      ...state.systemSettings,
      circular_word_limit: val?parseInt(val,10):null,
      request_remark_word_limit: reqVal?parseInt(reqVal,10):null,
      task_remark_word_limit: taskVal?parseInt(taskVal,10):null,
      warning_word_limit: warnVal?parseInt(warnVal,10):null
    };
  };
  document.getElementById('maint-session-btn').onclick = async () => {
    const mins = parseInt(document.getElementById('maint-session-timeout').value, 10) || 15;
    const { error } = await sb.from('system_settings').update({ session_timeout_minutes: mins }).eq('id', 1);
    if (error){ toast('Could not save: ' + error.message); return; }
    state.systemSettings = { ...state.systemSettings, session_timeout_minutes: mins };
    toast('Saved — takes effect next login (or refresh)');
  };
  document.getElementById('maint-notif-btn').onclick = async () => {
    const count = parseInt(document.getElementById('maint-notif-count').value, 10) || 5;
    const { error } = await sb.from('system_settings').update({ notification_retain_count: count }).eq('id', 1);
    if (error){ toast('Could not save: ' + error.message); return; }
    state.systemSettings = { ...state.systemSettings, notification_retain_count: count };
    toast('Saved — takes effect next login (or refresh)');
  };
}

const REISSUE_BASIS_LABEL = { months:'Every N Months', years:'Every N Years', wear_tear:'Wear & Tear (as needed)', after_review:'After Review (as needed)' };
async function renderToolTypesSettings(body){
  const { data: rows } = await sb.from('tool_types').select('*').order('name');
  const renderRows = (list) => `<table><thead><tr><th>Tool</th><th>Reissuance</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map(r=>`<tr>
      <td>${escapeHtml(r.name)}</td>
      <td class="mono">${r.reissue_basis==='months' ? `Every ${r.interval_months} months` : r.reissue_basis==='years' ? `Every ${r.interval_months} years` : REISSUE_BASIS_LABEL[r.reissue_basis]||r.reissue_basis}</td>
      <td><span class="badge ${r.active?'active':'closed'}">${r.active?'Active':'Inactive'}</span></td>
      <td style="white-space:nowrap;">
        <button class="btn small outline" data-edit-tool="${r.id}">Edit</button>
        <button class="btn small outline" data-toggle-tool="${r.id}" data-active="${r.active}">${r.active?'Disable':'Enable'}</button>
        <button class="btn small outline" data-delete-tool="${r.id}">Remove</button>
      </td>
    </tr>`).join('')}
  </tbody></table>`;
  body.innerHTML = `
  <div style="display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap;">
    <button class="btn small" id="new-tool-type-btn">+ Add Tool Type</button>
    <input type="text" id="tool-search" placeholder="Search tool types…" style="flex:1; min-width:160px; padding:8px 10px; border:1px solid var(--line); border-radius:7px;">
    <select id="tool-sort" style="padding:8px 10px; border:1px solid var(--line); border-radius:7px;">
      <option value="az">A → Z</option><option value="za">Z → A</option><option value="newest">Newest first</option>
    </select>
  </div>
  <div id="tool-type-list">${renderRows(rows||[])}</div>`;

  const applyFilters = () => {
    const q = document.getElementById('tool-search').value.toLowerCase();
    const sortMode = document.getElementById('tool-sort').value;
    let list = (rows||[]).filter(r => r.name.toLowerCase().includes(q));
    if (sortMode==='az') list = list.slice().sort((a,b)=>a.name.localeCompare(b.name));
    else if (sortMode==='za') list = list.slice().sort((a,b)=>b.name.localeCompare(a.name));
    else if (sortMode==='newest') list = list.slice().sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
    document.getElementById('tool-type-list').innerHTML = renderRows(list);
    bindActions();
  };
  document.getElementById('tool-search').oninput = applyFilters;
  document.getElementById('tool-sort').onchange = applyFilters;
  document.getElementById('new-tool-type-btn').onclick = () => openToolTypeModal(null);

  function bindActions(){
    document.querySelectorAll('[data-edit-tool]').forEach(btn => {
      btn.onclick = () => openToolTypeModal((rows||[]).find(r=>r.id===btn.dataset.editTool));
    });
    document.querySelectorAll('[data-toggle-tool]').forEach(btn => {
      btn.onclick = async () => {
        await sb.from('tool_types').update({ active: btn.dataset.active !== 'true' }).eq('id', btn.dataset.toggleTool);
        renderSettings();
      };
    });
    document.querySelectorAll('[data-delete-tool]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Remove this tool type permanently?')) return;
        const { error } = await sb.from('tool_types').delete().eq('id', btn.dataset.deleteTool);
        if (error){ toast('Could not remove (it may be in use): ' + error.message); return; }
        renderSettings();
      };
    });
  }
  bindActions();
}

// ---------------------------------------------------------
// TOOL ISSUANCE & REISSUANCE (raincoats, uniforms, helmets, etc.)
// ---------------------------------------------------------
async function renderTools(){
  const main = document.getElementById('main-content');
  const canIssue = ['inventory_coordinator','regional_poc','team_lead','coordinator'].includes(state.profile.role) || isAdmin();
  const canBulkUpdate = isAdmin() || hasPermission('tool_bulk_update');
  if (canIssue){
    document.getElementById('topbar-actions').innerHTML = `
      <button class="btn outline" id="bulk-tool-issuance-btn">+ Bulk Issue</button>
      ${canBulkUpdate ? `<button class="btn outline" id="bulk-tool-update-btn">Bulk Update</button>` : ''}
      <button class="btn" id="new-tool-issuance-btn">+ Issue Tool</button>`;
    document.getElementById('new-tool-issuance-btn').onclick = openNewToolIssuanceModal;
    document.getElementById('bulk-tool-issuance-btn').onclick = openBulkToolIssuanceModal;
    if (canBulkUpdate) document.getElementById('bulk-tool-update-btn').onclick = openBulkToolUpdateModal;
  }
  const { data: issuances, error: issuancesErr } = await sb.from('tool_issuances').select('*, profiles!rider_id(full_name, employee_id), tool_types(name)').order('next_due_date');
  if (issuancesErr){ main.innerHTML = emptyState('Could not load tool issuances: ' + issuancesErr.message); return; }
  if (!issuances || !issuances.length){ main.innerHTML = emptyState('No tools issued yet.'); return; }

  const { data: acks } = await sb.from('tool_issuance_acks').select('*');
  const ackMap = new Map((acks||[]).map(a => [a.tool_issuance_id, a]));

  const today = new Date();
  const renderRows = (list) => `<table><thead><tr><th>Rider</th><th>Employee ID</th><th>Tool</th><th>Issued</th><th>Next Due</th><th>Status</th><th>Rider Acknowledgment</th>${isSuperAdmin()?'<th></th>':''}</tr></thead><tbody>
    ${list.map(i => {
      const due = new Date(i.next_due_date);
      const daysLeft = Math.ceil((due-today)/(1000*60*60*24));
      let badge='badge active', label='OK';
      if (daysLeft<0){ badge='badge open'; label='Overdue for reissue'; }
      else if (daysLeft<=30){ badge='badge pending'; label=`Due in ${daysLeft}d`; }
      const ack = ackMap.get(i.id);
      const isMine = i.rider_id === state.user.id;
      let ackCell;
      if (ack){
        ackCell = `<span class="badge active">✓ Acknowledged ${formatDate(ack.seen_at)}</span>`;
      } else if (isMine){
        ackCell = `<button class="btn small" data-ack-tool="${i.id}">Acknowledge Receipt</button>`;
      } else {
        ackCell = `<span class="badge pending">Awaiting rider</span>`;
      }
      return `<tr>
        <td>${escapeHtml(i.profiles?.full_name||'—')}</td>
        <td class="mono">${escapeHtml(i.profiles?.employee_id||'—')}</td>
        <td>${escapeHtml(i.tool_types?.name||'—')}</td>
        <td class="mono">${i.issued_date}</td>
        <td class="mono">${i.next_due_date||'—'}</td>
        <td><span class="${badge}">${label}</span></td>
        <td>${ackCell}</td>
        ${isSuperAdmin() ? `<td style="white-space:nowrap;">
          <button class="btn small outline" data-edit-issuance="${i.id}">Edit</button>
          <button class="btn small danger" data-delete-issuance="${i.id}">Delete</button>
        </td>` : ''}
      </tr>`;
    }).join('')}
  </tbody></table>`;

  main.innerHTML = `<div class="form-row" style="max-width:320px;"><input type="text" id="tool-issuance-search" placeholder="Search by rider name or Employee ID…"></div><div id="tool-issuance-list">${renderRows(issuances)}</div>`;

  const applyFilters = () => {
    const q = document.getElementById('tool-issuance-search').value.trim().toLowerCase();
    const filtered = !q ? issuances : issuances.filter(i =>
      (i.profiles?.full_name||'').toLowerCase().includes(q) || (i.profiles?.employee_id||'').toLowerCase().includes(q)
    );
    document.getElementById('tool-issuance-list').innerHTML = renderRows(filtered);
    bindAckButtons();
    bindSuperAdminActions();
  };
  document.getElementById('tool-issuance-search').oninput = applyFilters;

  function bindSuperAdminActions(){
    if (!isSuperAdmin()) return;
    document.querySelectorAll('[data-edit-issuance]').forEach(btn => {
      btn.onclick = () => openEditToolIssuanceModal(issuances.find(i=>i.id===btn.dataset.editIssuance));
    });
    document.querySelectorAll('[data-delete-issuance]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Permanently delete this tool issuance record? This cannot be undone.')) return;
        const { error } = await sb.from('tool_issuances').delete().eq('id', btn.dataset.deleteIssuance);
        if (error){ toast('Could not delete: ' + error.message); return; }
        toast('Deleted'); renderTools();
      };
    });
  }
  bindSuperAdminActions();

  function bindAckButtons(){
    document.querySelectorAll('[data-ack-tool]').forEach(btn => {
      btn.onclick = async () => {
        const { error } = await sb.from('tool_issuance_acks').insert({ tool_issuance_id: btn.dataset.ackTool, user_id: state.user.id });
        if (error){ toast('Could not acknowledge: ' + error.message); return; }
        toast('Acknowledged — thank you'); renderTools();
      };
    });
  }
  bindAckButtons();
}

function openToolTypeModal(row){
  openModal(`
    <h2>${row?'Edit':'Add'} tool type</h2>
    <form id="tool-type-form">
      <div class="form-row"><label>Tool name</label><input type="text" id="tt-name" required placeholder="e.g. Raincoat" value="${row?escapeHtml(row.name):''}"></div>
      <div class="form-row"><label>Reissuance basis</label><select id="tt-basis">
        <option value="months" ${row?.reissue_basis==='months'?'selected':''}>Every N Months</option>
        <option value="years" ${row?.reissue_basis==='years'?'selected':''}>Every N Years</option>
        <option value="wear_tear" ${row?.reissue_basis==='wear_tear'?'selected':''}>Wear & Tear (as needed, no fixed schedule)</option>
        <option value="after_review" ${row?.reissue_basis==='after_review'?'selected':''}>After Review (as needed, no fixed schedule)</option>
      </select></div>
      <div class="form-row" id="tt-number-row"><label id="tt-number-label">Number of months</label><input type="number" id="tt-number" min="1" placeholder="e.g. 24" value="${row?.interval_months??''}"></div>
      <button class="btn-primary" type="submit">Save</button>
    </form>
  `);
  const basisSelect = document.getElementById('tt-basis');
  const numberRow = document.getElementById('tt-number-row');
  const numberLabel = document.getElementById('tt-number-label');
  const updateNumberField = () => {
    const basis = basisSelect.value;
    if (basis === 'months' || basis === 'years'){
      numberRow.style.display = 'block';
      numberLabel.textContent = basis === 'months' ? 'Number of months' : 'Number of years';
    } else {
      numberRow.style.display = 'none';
    }
  };
  basisSelect.onchange = updateNumberField;
  updateNumberField();

  document.getElementById('tool-type-form').onsubmit = async (e) => {
    e.preventDefault();
    const basis = basisSelect.value;
    const numberVal = document.getElementById('tt-number').value;
    if ((basis === 'months' || basis === 'years') && !numberVal){
      toast('Please enter a number for this reissuance basis'); return;
    }
    const payload = {
      name: document.getElementById('tt-name').value.trim(),
      reissue_basis: basis,
      interval_months: numberVal ? parseInt(numberVal, 10) : null
    };
    const { error } = row
      ? await sb.from('tool_types').update(payload).eq('id', row.id)
      : await sb.from('tool_types').insert(payload);
    if (error){ toast('Could not save: ' + error.message); return; }
    closeModal(); toast('Saved'); renderSettings();
  };
}

function openBulkToolIssuanceModal(){
  openModal(`
    <h2>Bulk issue tool</h2>
    <p class="hint">Paste one <strong>Employee ID</strong> per line — all get the same tool. To backdate historical records (useful when first setting up the portal), you can optionally add a comma + date after the Employee ID to override the default date for that row: <code>EMP1001, 2025-03-15</code>.</p>
    <form id="bulk-tool-form">
      <div class="form-row"><label>Tool</label><select id="bti-tool" required></select></div>
      <div class="form-row"><label>Default issued date</label><input type="date" id="bti-date" value="${new Date().toISOString().slice(0,10)}" required></div>
      <div class="form-row"><label>Employee IDs</label><textarea id="bti-ids" rows="8" placeholder="EMP1001
EMP1002, 2025-03-15
EMP1003"></textarea></div>
      <button class="btn-primary" type="submit">Issue to all</button>
    </form>
    <div id="bulk-tool-results" style="margin-top:14px;"></div>
  `);
  sb.from('tool_types').select('*').eq('active', true).order('name').then(({data}) => {
    document.getElementById('bti-tool').innerHTML = (data||[]).map(t=>`<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  });
  document.getElementById('bulk-tool-form').onsubmit = async (e) => {
    e.preventDefault();
    const lines = document.getElementById('bti-ids').value.split('\n').map(s=>s.trim()).filter(Boolean);
    if (!lines.length){ toast('Paste at least one Employee ID'); return; }
    const toolTypeId = document.getElementById('bti-tool').value;
    const defaultDate = document.getElementById('bti-date').value;
    const resultsEl = document.getElementById('bulk-tool-results');
    resultsEl.innerHTML = '<div class="mono">Processing…</div>';

    await loadScopedProfiles();
    const rows = [];
    for (const line of lines){
      const parts = line.split(/\t|,/).map(p=>p.trim());
      const empId = parts[0];
      const issuedDate = parts[1] || defaultDate;
      const rider = state.profilesInScope.find(p => (p.employee_id||'').toLowerCase() === (empId||'').toLowerCase());
      if (!rider){ rows.push({ empId, ok:false, msg:'No rider found with this Employee ID (or outside your access)' }); continue; }
      const { error } = await sb.from('tool_issuances').insert({
        rider_id: rider.id, region_id: rider.region_id, tool_type_id: toolTypeId,
        issued_date: issuedDate, recorded_by: state.user.id
      });
      rows.push({ empId, ok: !error, msg: error ? error.message : `Issued to ${rider.full_name} (${issuedDate})` });
    }
    resultsEl.innerHTML = `<table><thead><tr><th>Employee ID</th><th>Result</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td class="mono">${escapeHtml(r.empId)}</td><td>${r.ok?`<span class="badge active">${escapeHtml(r.msg)}</span>`:`<span class="badge open">${escapeHtml(r.msg)}</span>`}</td></tr>`).join('')}
    </tbody></table>`;
    toast(`${rows.filter(r=>r.ok).length} of ${rows.length} issued`);
    renderTools();
  };
}

function computeNextDueDate(issuedDateStr, toolType){
  if (!toolType) return null;
  const d = new Date(issuedDateStr);
  if (toolType.reissue_basis === 'months' && toolType.interval_months){
    d.setMonth(d.getMonth() + toolType.interval_months);
    return d.toISOString().slice(0,10);
  }
  if (toolType.reissue_basis === 'years' && toolType.interval_months){
    d.setFullYear(d.getFullYear() + toolType.interval_months);
    return d.toISOString().slice(0,10);
  }
  return null; // wear_tear / after_review — no fixed schedule
}

function openBulkToolUpdateModal(){
  openModal(`
    <h2>Bulk update tool records</h2>
    <p class="hint">Use this to correct issued dates on <strong>existing</strong> tool issuance records for many riders at once (e.g. after a data entry mistake) — this does not create new issuances.</p>
    <form id="bulk-tool-update-form">
      <div class="form-row"><label>Tool</label><select id="btu-tool" required></select></div>
      <div class="form-row"><label>New issued date for all matched records</label><input type="date" id="btu-date" value="${new Date().toISOString().slice(0,10)}" required></div>
      <div class="form-row"><label>Employee IDs (one per line)</label><textarea id="btu-ids" rows="8" placeholder="EMP1001
EMP1002
EMP1003"></textarea></div>
      <button class="btn-primary" type="submit">Update all</button>
    </form>
    <div id="bulk-tool-update-results" style="margin-top:14px;"></div>
  `);
  let toolTypes = [];
  sb.from('tool_types').select('*').order('name').then(({data}) => {
    toolTypes = data || [];
    document.getElementById('btu-tool').innerHTML = toolTypes.map(t=>`<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  });
  document.getElementById('bulk-tool-update-form').onsubmit = async (e) => {
    e.preventDefault();
    const empIds = document.getElementById('btu-ids').value.split('\n').map(s=>s.trim()).filter(Boolean);
    if (!empIds.length){ toast('Paste at least one Employee ID'); return; }
    const toolTypeId = document.getElementById('btu-tool').value;
    const toolType = toolTypes.find(t=>t.id===toolTypeId);
    const issuedDate = document.getElementById('btu-date').value;
    const nextDue = computeNextDueDate(issuedDate, toolType);
    const resultsEl = document.getElementById('bulk-tool-update-results');
    resultsEl.innerHTML = '<div class="mono">Processing…</div>';

    await loadScopedProfiles();
    const rows = [];
    for (const empId of empIds){
      const rider = state.profilesInScope.find(p => p.employee_id === empId);
      if (!rider){ rows.push({ empId, ok:false, msg:'No rider found with this Employee ID (or outside your access)' }); continue; }
      const { data: existing } = await sb.from('tool_issuances').select('id').eq('rider_id', rider.id).eq('tool_type_id', toolTypeId)
        .order('issued_date', {ascending:false}).limit(1).maybeSingle();
      if (!existing){ rows.push({ empId, ok:false, msg:'No existing issuance record for this tool — use Bulk Issue instead' }); continue; }
      const { error } = await sb.from('tool_issuances').update({ issued_date: issuedDate, next_due_date: nextDue }).eq('id', existing.id);
      rows.push({ empId, ok: !error, msg: error ? error.message : `Updated for ${rider.full_name}` });
    }
    resultsEl.innerHTML = `<table><thead><tr><th>Employee ID</th><th>Result</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td class="mono">${escapeHtml(r.empId)}</td><td>${r.ok?`<span class="badge active">${escapeHtml(r.msg)}</span>`:`<span class="badge open">${escapeHtml(r.msg)}</span>`}</td></tr>`).join('')}
    </tbody></table>`;
    toast(`${rows.filter(r=>r.ok).length} of ${rows.length} updated`);
    renderTools();
  };
}

function openEditToolIssuanceModal(issuance){
  openModal(`
    <h2>Edit tool issuance</h2>
    <p class="mono" style="margin-bottom:12px;">${escapeHtml(issuance.profiles?.full_name||'—')} — ${escapeHtml(issuance.tool_types?.name||'—')}</p>
    <form id="ei-form">
      <div class="form-row"><label>Issued date</label><input type="date" id="ei-issued" value="${issuance.issued_date}" required></div>
      <div class="form-row"><label>Next due date (leave blank for no fixed schedule)</label><input type="date" id="ei-due" value="${issuance.next_due_date||''}"></div>
      <button class="btn-primary" type="submit">Save changes</button>
    </form>
  `);
  document.getElementById('ei-form').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.from('tool_issuances').update({
      issued_date: document.getElementById('ei-issued').value,
      next_due_date: document.getElementById('ei-due').value || null
    }).eq('id', issuance.id);
    if (error){ toast('Could not save: ' + error.message); return; }
    closeModal(); toast('Updated'); renderTools();
  };
}

async function openNewToolIssuanceModal(){
  await loadScopedProfiles();
  const riderOptions = state.profilesInScope.filter(p=>p.role==='rider').map(p=>`<option value="${p.id}">${escapeHtml(p.full_name)}</option>`).join('');
  const { data: toolTypes } = await sb.from('tool_types').select('*').eq('active', true).order('name');
  const toolOptions = (toolTypes||[]).map(t=>`<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  openModal(`
    <h2>Issue tool</h2>
    <form id="tool-issuance-form">
      <div class="form-row"><label>Rider</label><select id="ti-rider" required>${riderOptions}</select></div>
      <div class="form-row"><label>Tool</label><select id="ti-tool" required>${toolOptions}</select></div>
      <div class="form-row"><label>Issued date</label><input type="date" id="ti-date" value="${new Date().toISOString().slice(0,10)}" required></div>
      <div id="ti-eligibility"></div>
      <label id="ti-override-wrap" style="display:none; margin-top:8px;">
        <input type="checkbox" id="ti-override"> Super Admin override — issue anyway
      </label>
      <button class="btn-primary" type="submit" id="ti-submit-btn">Save</button>
    </form>
  `);
  const riderSelect = document.getElementById('ti-rider');
  const toolSelect = document.getElementById('ti-tool');
  const eligBox = document.getElementById('ti-eligibility');
  const overrideWrap = document.getElementById('ti-override-wrap');
  const overrideBox = document.getElementById('ti-override');
  const submitBtn = document.getElementById('ti-submit-btn');
  let blocked = false;

  async function checkEligibility(){
    eligBox.innerHTML = '';
    overrideWrap.style.display = 'none';
    blocked = false;
    submitBtn.disabled = false;
    const riderId = riderSelect.value, toolTypeId = toolSelect.value;
    if (!riderId || !toolTypeId) return;
    const { data: last } = await sb.from('tool_issuances')
      .select('*, tool_types(name, reissue_basis)')
      .eq('rider_id', riderId).eq('tool_type_id', toolTypeId)
      .order('issued_date', { ascending: false }).limit(1).maybeSingle();
    if (!last) return; // no prior issuance — always eligible
    const basis = last.tool_types?.reissue_basis;
    if ((basis === 'wear_tear' || basis === 'after_review') || !last.next_due_date) return; // no fixed schedule
    const dueDate = new Date(last.next_due_date);
    if (dueDate > new Date()){
      eligBox.innerHTML = `<div class="auth-message" style="display:block; margin-top:10px;">
        As per policy, this rider is not eligible for reissuance at this time.<br>
        Last issuance date: <strong>${formatDate(last.issued_date)}</strong> — next eligible: <strong>${formatDate(last.next_due_date)}</strong>.
      </div>`;
      if (isSuperAdmin()){
        overrideWrap.style.display = 'block';
        blocked = true;
        submitBtn.disabled = true;
      } else {
        blocked = true;
        submitBtn.disabled = true;
      }
    }
  }
  riderSelect.onchange = checkEligibility;
  toolSelect.onchange = checkEligibility;
  if (overrideBox) overrideBox.onchange = () => { submitBtn.disabled = overrideBox.checked ? false : blocked; };

  document.getElementById('tool-issuance-form').onsubmit = async (e) => {
    e.preventDefault();
    if (blocked && !(isSuperAdmin() && overrideBox?.checked)){ toast('This rider is not yet eligible for reissuance'); return; }
    const riderId = riderSelect.value;
    const rider = state.profilesInScope.find(p=>p.id===riderId);
    const { error } = await sb.from('tool_issuances').insert({
      rider_id: riderId, region_id: rider?.region_id,
      tool_type_id: toolSelect.value,
      issued_date: document.getElementById('ti-date').value,
      recorded_by: state.user.id
    });
    if (error){ toast('Could not save: ' + error.message); return; }
    closeModal(); toast('Tool issued'); renderTools();
  };
}


// ---------------------------------------------------------
// RESOURCE LINKS — panel company sheets, how-to videos, anything
// hosted elsewhere (Google Sheets/Drive/YouTube) so it costs zero
// database/storage space here.
// ---------------------------------------------------------
async function renderResources(){
  const main = document.getElementById('main-content');
  if (isSuperAdmin()){
    document.getElementById('topbar-actions').innerHTML = `<button class="btn" id="new-resource-btn">+ Add Link</button>`;
    document.getElementById('new-resource-btn').onclick = () => openResourceModal(null);
  }
  const { data: links } = await sb.from('resource_links').select('*').order('category').order('title');
  if (!links || !links.length){ main.innerHTML = emptyState('No resource links added yet.'); return; }

  const byCategory = {};
  links.forEach(l => { (byCategory[l.category || 'General'] ||= []).push(l); });

  main.innerHTML = Object.entries(byCategory).map(([cat, items]) => `
    <div class="card">
      <h3>${escapeHtml(cat)}</h3>
      <table><thead><tr><th>Title</th><th></th>${isSuperAdmin()?'<th></th>':''}</tr></thead><tbody>
        ${items.map(l => `<tr>
          <td>${escapeHtml(l.title)}</td>
          <td><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener" class="btn small outline">Open ↗</a></td>
          ${isSuperAdmin() ? `<td>
            <button class="btn small outline" data-edit-resource="${l.id}">Edit</button>
            <button class="btn small outline" data-delete-resource="${l.id}">Remove</button>
          </td>` : ''}
        </tr>`).join('')}
      </tbody></table>
    </div>`).join('');

  main.querySelectorAll('[data-edit-resource]').forEach(btn => {
    btn.onclick = () => openResourceModal(links.find(l=>l.id===btn.dataset.editResource));
  });
  main.querySelectorAll('[data-delete-resource]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Remove this link?')) return;
      await sb.from('resource_links').delete().eq('id', btn.dataset.deleteResource);
      renderResources();
    };
  });
}

function openResourceModal(link){
  openModal(`
    <h2>${link ? 'Edit' : 'Add'} resource link</h2>
    <form id="resource-form">
      <div class="form-row"><label>Title</label><input type="text" id="res-title" value="${link?escapeHtml(link.title):''}" required placeholder="e.g. Sui Gas Panel — Requirements"></div>
      <div class="form-row"><label>Category (optional)</label><input type="text" id="res-category" value="${link?escapeHtml(link.category||''):''}" placeholder="e.g. Panel Companies, How-To Videos"></div>
      <div class="form-row"><label>Link (Google Sheet, Drive, YouTube, etc.)</label><input type="url" id="res-url" value="${link?escapeHtml(link.url):''}" required placeholder="https://..."></div>
      <p class="hint">Tip: in Google Sheets/Docs, use Share → "Anyone with the link can view" so riders can open it.</p>
      <button class="btn-primary" type="submit">Save</button>
    </form>
    <div style="margin-top:14px;">
      <p class="hint">Add many at once — paste rows as <strong>Title | Category | URL</strong>, one per line:</p>
      <textarea id="res-bulk" rows="4" style="width:100%; padding:9px 11px; border:1px solid var(--line); border-radius:7px;" placeholder="Sui Gas Panel | Panel Companies | https://...
Barcode Install Video | How-To Videos | https://youtube.com/..."></textarea>
      <button class="btn small outline" id="res-bulk-btn" style="margin-top:8px;">Add All</button>
    </div>
  `);
  document.getElementById('resource-form').onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      title: document.getElementById('res-title').value.trim(),
      category: document.getElementById('res-category').value.trim() || null,
      url: document.getElementById('res-url').value.trim()
    };
    const { error } = link
      ? await sb.from('resource_links').update(payload).eq('id', link.id)
      : await sb.from('resource_links').insert({ ...payload, created_by: state.user.id });
    if (error){ toast('Could not save: ' + error.message); return; }
    closeModal(); toast('Saved'); renderResources();
  };
  document.getElementById('res-bulk-btn').onclick = async () => {
    const lines = document.getElementById('res-bulk').value.split('\n').map(l=>l.trim()).filter(Boolean);
    const rows = lines.map(line => {
      const [title, category, url] = line.split('|').map(s=>s?.trim());
      return { title, category: category || null, url, created_by: state.user.id };
    }).filter(r => r.title && r.url);
    if (!rows.length){ toast('Paste at least one valid row'); return; }
    const { error } = await sb.from('resource_links').insert(rows);
    if (error){ toast('Could not add: ' + error.message); return; }
    closeModal(); toast(`${rows.length} links added`); renderResources();
  };
}

// ---------------------------------------------------------
// ACTIVITY LOG — Super Admin only
// ---------------------------------------------------------
async function renderActivityLog(){
  const main = document.getElementById('main-content');
  const { data: log } = await sb.from('activity_log').select('*, profiles(full_name)').eq('archived', false).order('created_at', {ascending:false}).limit(200);

  main.innerHTML = `
    <div class="card">
      <h3>Clean up the list</h3>
      <p class="hint">This hides old entries from this page to make it easier to scan — the records themselves are kept in the database, not deleted, so nothing is lost for audit purposes. This does <strong>not</strong> reduce database storage usage.</p>
      <div class="two-col">
        <div class="form-row"><label>From</label><input type="date" id="al-from"></div>
        <div class="form-row"><label>To</label><input type="date" id="al-to"></div>
      </div>
      <label style="display:flex; align-items:center; gap:8px; font-weight:400; margin-bottom:12px;">
        <input type="checkbox" id="al-confirm-archive"> I understand this only hides entries from view, it doesn't free up storage
      </label>
      <button class="btn outline" id="al-archive-btn">Hide entries in this date range</button>
      <button class="btn small outline" id="al-show-archived-btn" style="margin-left:8px;">View hidden entries</button>
    </div>
    <div id="activity-log-list">${log && log.length ? `<table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Type</th><th>Item</th></tr></thead><tbody>
      ${log.map(l => `<tr>
        <td class="mono">${formatDateTime(l.created_at)}</td>
        <td>${escapeHtml(l.profiles?.full_name||'—')}</td>
        <td>${escapeHtml(l.action)}</td>
        <td>${escapeHtml(l.entity_type)}</td>
        <td>${escapeHtml(l.entity_label||'—')}</td>
      </tr>`).join('')}
    </tbody></table>` : emptyState('No activity recorded yet (or everything is currently hidden — use "View hidden entries" to check).')}</div>`;

  document.getElementById('al-archive-btn').onclick = async () => {
    const from = document.getElementById('al-from').value;
    const to = document.getElementById('al-to').value;
    if (!from || !to){ toast('Pick both a From and To date'); return; }
    if (!document.getElementById('al-confirm-archive').checked){ toast('Please check the confirmation box first'); return; }
    if (!confirm(`Hide all Activity Log entries between ${from} and ${to} from this page? They stay in the database.`)) return;
    const { error, count } = await sb.from('activity_log').update({ archived: true })
      .gte('created_at', from).lte('created_at', to + 'T23:59:59').select('id', {count:'exact'});
    if (error){ toast('Could not hide: ' + error.message); return; }
    toast(`${count ?? ''} entries hidden`); renderActivityLog();
  };
  document.getElementById('al-show-archived-btn').onclick = async () => {
    const { data: archived } = await sb.from('activity_log').select('*, profiles(full_name)').eq('archived', true).order('created_at', {ascending:false}).limit(200);
    document.getElementById('activity-log-list').innerHTML = `
      <p class="hint" style="margin-bottom:10px;">Showing hidden entries (still in the database, just not shown on the main list above).</p>
      <button class="btn small outline" id="al-unhide-all-btn" style="margin-bottom:10px;">Unhide these</button>
      ${archived && archived.length ? `<table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Type</th><th>Item</th></tr></thead><tbody>
        ${archived.map(l => `<tr>
          <td class="mono">${formatDateTime(l.created_at)}</td>
          <td>${escapeHtml(l.profiles?.full_name||'—')}</td>
          <td>${escapeHtml(l.action)}</td>
          <td>${escapeHtml(l.entity_type)}</td>
          <td>${escapeHtml(l.entity_label||'—')}</td>
        </tr>`).join('')}
      </tbody></table>` : emptyState('No hidden entries.')}`;
    const unhideBtn = document.getElementById('al-unhide-all-btn');
    if (unhideBtn) unhideBtn.onclick = async () => {
      await sb.from('activity_log').update({ archived: false }).eq('archived', true);
      toast('Unhidden'); renderActivityLog();
    };
  };
}

// ---------------------------------------------------------
// RELEASE NOTES — "What's New", Super Admin posts updates
// ---------------------------------------------------------
async function renderReleaseNotes(){
  const main = document.getElementById('main-content');
  if (isSuperAdmin()){
    document.getElementById('topbar-actions').innerHTML = `<button class="btn" id="new-release-btn">+ Add Update</button>`;
    document.getElementById('new-release-btn').onclick = () => {
      openModal(`
        <h2>Post an update</h2>
        <form id="release-form">
          <div class="form-row"><label>Title</label><input type="text" id="rel-title" required placeholder="e.g. New: Tool Issuance module"></div>
          <div class="form-row"><label>Details</label><textarea id="rel-body" rows="5" required></textarea></div>
          <button class="btn-primary" type="submit">Post</button>
        </form>
      `);
      document.getElementById('release-form').onsubmit = async (e) => {
        e.preventDefault();
        const { error } = await sb.from('release_notes').insert({
          title: document.getElementById('rel-title').value.trim(),
          body: document.getElementById('rel-body').value.trim(),
          created_by: state.user.id
        });
        if (error){ toast('Could not post: ' + error.message); return; }
        closeModal(); toast('Posted'); renderReleaseNotes();
      };
    };
  }
  const { data: notes } = await sb.from('release_notes').select('*, profiles(full_name)').order('created_at', {ascending:false});
  if (!notes || !notes.length){ main.innerHTML = emptyState("No updates posted yet."); return; }
  main.innerHTML = notes.map(n => `
    <div class="card">
      <h3>${escapeHtml(n.title)}</h3>
      <p style="font-size:13.5px; white-space:pre-wrap;">${escapeHtml(n.body)}</p>
      <div class="mono">${formatDateTime(n.created_at)}</div>
    </div>`).join('');
}

// ---------------------------------------------------------
// ROSTER — region/sub-region weekly roster (not date-based)
// ---------------------------------------------------------
async function renderRoster(){
  const main = document.getElementById('main-content');
  const canManage = isAdmin() || hasPermission('roster_manage');
  if (canManage){
    document.getElementById('topbar-actions').innerHTML = `
      <button class="btn outline" id="bulk-roster-btn">+ Bulk Add</button>
      <button class="btn" id="new-roster-btn">+ Add to Roster</button>`;
    document.getElementById('new-roster-btn').onclick = () => openRosterModal(null);
    document.getElementById('bulk-roster-btn').onclick = openBulkRosterModal;
  } else {
    document.getElementById('topbar-actions').innerHTML = '';
  }
  let query = sb.from('roster_entries').select('*, profiles!rider_id(full_name, employee_id), regions(name), sub_regions(name), shift_types(name)');
  if (state.profile.role === 'rider') query = query.eq('rider_id', state.user.id);
  const { data: entries } = await query.order('created_at', {ascending:false});

  if (!entries || !entries.length){ main.innerHTML = emptyState('No roster entries yet.'); return; }

  const total = entries.length;
  const active = entries.filter(e=>e.status!=='removed').length;
  const removedByReason = {};
  entries.filter(e=>e.status==='removed').forEach(e => {
    const key = e.removal_reason || 'Other';
    removedByReason[key] = (removedByReason[key]||0) + 1;
  });
  const replacementPending = entries.filter(e=>e.status==='removed' && e.replacement_pending).length;
  const regionIdsInPlay = [...new Set(entries.map(e=>e.region_id))];
  const approvedHeadcount = regionIdsInPlay.reduce((sum, rid) => sum + (state.regions.find(r=>r.id===rid)?.approved_headcount || 0), 0);

  const shiftNames = [...new Set(entries.map(e=>e.shift_types?.name).filter(Boolean))];
  const dayOffs = [...new Set(entries.map(e=>e.day_off).filter(Boolean))];
  const reasons = [...new Set(entries.filter(e=>e.status==='removed').map(e=>e.removal_reason).filter(Boolean))];

  const renderRows = (list) => list.length ? `<table><thead><tr><th>Rider</th><th>Region</th><th>Sub-Region/City</th><th>Hotspot</th><th>Shift</th><th>Day Off</th><th>Official Mobile</th><th>Personal Mobile</th><th>Status</th>${canManage?'<th></th>':''}</tr></thead><tbody>
    ${list.map(e => `<tr>
      <td>${escapeHtml(e.profiles?.full_name||'—')}<div class="mono">${escapeHtml(e.profiles?.employee_id||'')}</div></td>
      <td>${escapeHtml(e.regions?.name||'—')}</td>
      <td>${escapeHtml(e.sub_regions?.name||'—')}</td>
      <td>${escapeHtml(e.hotspot||'—')}</td>
      <td>${escapeHtml(e.shift_types?.name||'—')}</td>
      <td>${escapeHtml(e.day_off||'—')}</td>
      <td class="mono">${escapeHtml(e.official_mobile||'—')}</td>
      <td class="mono">${escapeHtml(e.personal_mobile||'—')}</td>
      <td>${e.status==='removed'
        ? `<span class="badge open">${escapeHtml(e.removal_reason||'Removed')}${e.status_date?' — '+formatDate(e.status_date):''}</span>${e.replacement_pending?' <span class="badge pending">Replacement pending</span>':''}`
        : '<span class="badge active">Approved / Working</span>'}</td>
      ${canManage ? `<td style="white-space:nowrap;">
        <button class="btn small outline" data-edit-roster="${e.id}">Edit</button>
        ${e.status!=='removed' ? `<button class="btn small danger" data-remove-roster="${e.id}">Mark Resigned/Terminated/Transferred</button>` : ''}
        ${(e.status==='removed' && isSuperAdmin()) ? `<button class="btn small outline" data-reinstate-roster="${e.id}">Reinstate (undo mistake)</button>` : ''}
        ${isSuperAdmin() ? `<button class="btn small danger" data-delete-roster="${e.id}">Delete Permanently</button>` : ''}
      </td>` : ''}
    </tr>`).join('')}
  </tbody></table>` : emptyState('No roster entries match this filter.');

  main.innerHTML = `
    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin-bottom:16px;">
      <div class="card stat-card sky" data-stat-filter="" style="cursor:pointer;"><div class="stat-number">${total}</div><div class="stat-label">Total on Roster</div></div>
      <div class="card stat-card clay" data-stat-filter="active" style="cursor:pointer;"><div class="stat-number">${active}</div><div class="stat-label">Approved / Currently Working</div></div>
      ${approvedHeadcount ? `<div class="card stat-card sky"><div class="stat-number">${approvedHeadcount}</div><div class="stat-label">Approved Headcount (Regions shown)</div></div>` : ''}
      <div class="card stat-card amber" data-stat-filter="removed" style="cursor:pointer;"><div class="stat-number">${total-active}</div><div class="stat-label">Resigned/Terminated/Transferred</div></div>
      <div class="card stat-card amber" data-stat-filter="replacement" style="cursor:pointer;"><div class="stat-number">${replacementPending}</div><div class="stat-label">Replacement Needed</div></div>
    </div>
    ${reasons.length ? `<div class="hint" style="margin-bottom:10px;">Breakdown: ${reasons.map(r=>`${escapeHtml(r)}: ${removedByReason[r]}`).join(' · ')}</div>` : ''}
    <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px;">
      <select id="rf-region"><option value="">All Regions</option>${state.regions.map(r=>`<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')}</select>
      <select id="rf-shift"><option value="">All Shifts</option>${shiftNames.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}</select>
      <select id="rf-dayoff"><option value="">All Day-Offs</option>${dayOffs.map(d=>`<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('')}</select>
      <select id="rf-status"><option value="">All Statuses</option><option value="active">Approved / Working</option><option value="removed">Resigned/Terminated/Transferred</option></select>
      ${reasons.length ? `<select id="rf-reason"><option value="">All Reasons</option>${reasons.map(r=>`<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}</select>` : ''}
      <input type="text" id="rf-search" placeholder="Search rider name or Employee ID…" style="flex:1; min-width:160px;">
    </div>
    <div id="roster-list">${renderRows(entries)}</div>`;

  const applyFilters = () => {
    const region = document.getElementById('rf-region').value;
    const shift = document.getElementById('rf-shift').value;
    const dayOff = document.getElementById('rf-dayoff').value;
    const status = document.getElementById('rf-status').value;
    const reason = document.getElementById('rf-reason')?.value || '';
    const q = document.getElementById('rf-search').value.toLowerCase();
    const filtered = entries.filter(e =>
      (!region || e.region_id === region) &&
      (!shift || e.shift_types?.name === shift) &&
      (!dayOff || e.day_off === dayOff) &&
      (!status || (status==='removed' ? e.status==='removed' : e.status!=='removed')) &&
      (!reason || e.removal_reason === reason) &&
      (!q || (e.profiles?.full_name||'').toLowerCase().includes(q) || (e.profiles?.employee_id||'').toLowerCase().includes(q))
    );
    document.getElementById('roster-list').innerHTML = renderRows(filtered);
    bindRowActions();
  };
  ['rf-region','rf-shift','rf-dayoff','rf-status','rf-reason'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.onchange = applyFilters;
  });
  document.getElementById('rf-search').oninput = applyFilters;

  main.querySelectorAll('[data-stat-filter]').forEach(card => {
    card.onclick = () => {
      const which = card.dataset.statFilter;
      document.getElementById('rf-status').value = which === 'replacement' ? 'removed' : which;
      if (document.getElementById('rf-reason')) document.getElementById('rf-reason').value = '';
      applyFilters();
      if (which === 'replacement'){
        document.getElementById('roster-list').innerHTML = renderRows(entries.filter(e=>e.status==='removed' && e.replacement_pending));
        bindRowActions();
      }
      document.getElementById('roster-list').scrollIntoView({behavior:'smooth', block:'start'});
    };
  });

  function bindRowActions(){
    document.querySelectorAll('[data-edit-roster]').forEach(btn => {
      btn.onclick = () => openRosterModal(entries.find(e=>e.id===btn.dataset.editRoster));
    });
    document.querySelectorAll('[data-remove-roster]').forEach(btn => {
      btn.onclick = () => {
        const entry = entries.find(e=>e.id===btn.dataset.removeRoster);
        openRosterRemovalModal(entry.id, entry.rider_id);
      };
    });
    document.querySelectorAll('[data-reinstate-roster]').forEach(btn => {
      btn.onclick = async () => {
        const entry = entries.find(e=>e.id===btn.dataset.reinstateRoster);
        if (!confirm(`Reinstate ${entry.profiles?.full_name||'this rider'}? This undoes the Resigned/Terminated/Transferred mark and re-enables their login.`)) return;
        const { error } = await sb.from('roster_entries').update({
          status: 'active', removal_reason: null, status_date: null, removal_note: null, replacement_pending: false
        }).eq('id', entry.id);
        if (error){ toast('Could not reinstate: ' + error.message); return; }
        if (entry.rider_id){
          await sb.from('profiles').update({ status: 'active' }).eq('id', entry.rider_id);
        }
        toast('Reinstated — login re-enabled'); renderRoster();
      };
    });
    document.querySelectorAll('[data-delete-roster]').forEach(btn => {
      btn.onclick = async () => {
        const entry = entries.find(e=>e.id===btn.dataset.deleteRoster);
        if (!confirm(`Permanently delete this roster entry for ${entry.profiles?.full_name||'this rider'}? This cannot be undone (their login status is not affected).`)) return;
        const { error } = await sb.from('roster_entries').delete().eq('id', entry.id);
        if (error){ toast('Could not delete: ' + error.message); return; }
        toast('Roster entry deleted'); renderRoster();
      };
    });
  }
  bindRowActions();
}

async function openRosterModal(entry){
  await loadScopedProfiles();
  const riders = state.profilesInScope.filter(p=>p.role==='rider');
  const riderOptions = riders.map(p=>`<option value="${p.id}" ${entry?.rider_id===p.id?'selected':''}>${escapeHtml(p.full_name)} (${escapeHtml(p.employee_id||'—')})</option>`).join('');
  const regionOptions = state.regions.map(r=>`<option value="${r.id}" ${entry?.region_id===r.id?'selected':''}>${escapeHtml(r.name)}</option>`).join('');
  const { data: shifts } = await sb.from('shift_types').select('*').eq('active', true).order('name');
  const shiftOptions = (shifts||[]).map(s=>`<option value="${s.id}" ${entry?.shift_id===s.id?'selected':''}>${escapeHtml(s.name)}</option>`).join('');
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const dayOptions = days.map(d=>`<option value="${d}" ${entry?.day_off===d?'selected':''}>${d}</option>`).join('');

  openModal(`
    <h2>${entry?'Edit':'Add'} roster entry</h2>
    <form id="roster-form">
      <div class="form-row"><label>Rider</label><select id="ro-rider" required>${riderOptions}</select></div>
      <div class="two-col">
        <div class="form-row"><label>Region</label><select id="ro-region" required>${regionOptions}</select></div>
        <div class="form-row"><label>Sub-Region / City</label><select id="ro-subregion"><option value="">—</option></select></div>
      </div>
      <div class="form-row"><label>Hotspot / Area (optional)</label><select id="ro-hotspot"><option value="">— Select region first —</option></select></div>
      <div class="two-col">
        <div class="form-row"><label>Shift</label><select id="ro-shift">${shiftOptions}</select></div>
        <div class="form-row"><label>Day Off</label><select id="ro-dayoff">${dayOptions}</select></div>
      </div>
      <div class="two-col">
        <div class="form-row"><label>Official Mobile</label><input type="text" id="ro-official" value="${entry?escapeHtml(entry.official_mobile||''):''}" required></div>
        <div class="form-row"><label>Personal Mobile (optional)</label><input type="text" id="ro-personal" value="${entry?escapeHtml(entry.personal_mobile||''):''}"></div>
      </div>
      <button class="btn-primary" type="submit">Save</button>
    </form>
  `);

  const loadSubRegions = async (regionId, selectedId) => {
    const { data: subs } = await sb.from('sub_regions').select('*').eq('region_id', regionId).eq('active', true).order('name');
    document.getElementById('ro-subregion').innerHTML = '<option value="">—</option>' + (subs||[]).map(s=>`<option value="${s.id}" ${selectedId===s.id?'selected':''}>${escapeHtml(s.name)}</option>`).join('');
  };
  const loadHotspots = async (regionId, subRegionId, selectedName) => {
    if (!regionId){ document.getElementById('ro-hotspot').innerHTML = '<option value="">— Select region first —</option>'; return; }
    let q = sb.from('hotspots').select('*').eq('region_id', regionId).eq('active', true);
    const { data: spots } = await q.order('name');
    const relevant = (spots||[]).filter(h => !h.sub_region_id || h.sub_region_id === subRegionId);
    document.getElementById('ro-hotspot').innerHTML = '<option value="">— None —</option>' +
      relevant.map(h=>`<option value="${escapeHtml(h.name)}" ${selectedName===h.name?'selected':''}>${escapeHtml(h.name)}</option>`).join('') +
      (relevant.length ? '' : '<option value="" disabled>No hotspots set up for this region yet — add in Settings → Hotspots</option>');
  };
  document.getElementById('ro-region').onchange = (e) => { loadSubRegions(e.target.value, null); loadHotspots(e.target.value, null, null); };
  document.getElementById('ro-subregion').onchange = (e) => loadHotspots(document.getElementById('ro-region').value, e.target.value || null, null);
  if (entry?.region_id){
    await loadSubRegions(entry.region_id, entry.sub_region_id);
    await loadHotspots(entry.region_id, entry.sub_region_id, entry.hotspot);
  }

  document.getElementById('roster-form').onsubmit = async (e) => {
    e.preventDefault();
    const riderId = document.getElementById('ro-rider').value;
    if (!entry){
      const { data: existingActive } = await sb.from('roster_entries').select('id').eq('rider_id', riderId).neq('status', 'removed').maybeSingle();
      if (existingActive){ toast('This rider already has an active roster entry — edit that one instead of creating a duplicate.'); return; }
    }
    const payload = {
      rider_id: riderId,
      region_id: document.getElementById('ro-region').value,
      sub_region_id: document.getElementById('ro-subregion').value || null,
      hotspot: document.getElementById('ro-hotspot').value || null,
      shift_id: document.getElementById('ro-shift').value || null,
      day_off: document.getElementById('ro-dayoff').value || null,
      personal_mobile: document.getElementById('ro-personal').value.trim(),
      official_mobile: document.getElementById('ro-official').value.trim()
    };
    const { error } = entry
      ? await sb.from('roster_entries').update(payload).eq('id', entry.id)
      : await sb.from('roster_entries').insert({ ...payload, created_by: state.user.id });
    if (error){ toast('Could not save: ' + error.message); return; }
    closeModal(); toast('Saved'); renderRoster();
  };
}

function openBulkRosterModal(){
  openModal(`
    <h2>Bulk add to roster</h2>
    <p class="hint">Paste rows as: <strong>Employee ID, Region, Sub-Region/City (optional), Shift name, Day Off, Hotspot (optional)</strong> — one rider per line. It's fine to also include the rider's Name as an extra column right after Employee ID (it'll be ignored — we already know their name from Employee ID); it's just there because that's usually how people copy from Excel. Works with comma-separated or pasted directly from Excel. Region/Shift names must match existing ones exactly (Settings → Sub-Regions / Shift Types).</p>
    <form id="bulk-roster-form">
      <textarea id="br-rows" rows="8" placeholder="EMP1001, Lahore, 1, 7:00 AM - 7:00 PM, Sunday, DHA Phase 5
EMP1002, Ali Khan, Multan, , 8:00 AM - 8:00 PM, Monday"></textarea>
      <button class="btn-primary" type="submit" style="margin-top:12px;">Add All</button>
    </form>
    <div id="bulk-roster-results" style="margin-top:14px;"></div>
  `);
  document.getElementById('bulk-roster-form').onsubmit = async (e) => {
    e.preventDefault();
    const lines = document.getElementById('br-rows').value.split('\n').map(l=>l.trim()).filter(Boolean);
    if (!lines.length){ toast('Paste at least one row'); return; }
    const resultsEl = document.getElementById('bulk-roster-results');
    resultsEl.innerHTML = '<div class="mono">Processing…</div>';

    await loadScopedProfiles();
    const { data: allSubRegions } = await sb.from('sub_regions').select('*');
    const { data: allShifts } = await sb.from('shift_types').select('*');
    const isKnownRegion = (s) => state.regions.some(r => r.name.toLowerCase() === (s||'').trim().toLowerCase());

    const rows = [];
    for (const line of lines){
      const parts = line.split(/\t|,/).map(p=>p.trim());
      const empId = parts[0];
      // Auto-detect an extra "Name" column: if the 2nd field isn't a real
      // region, assume it's a name and shift everything over by one.
      let regionName, subRegionName, shiftName, dayOff, hotspot;
      if (isKnownRegion(parts[1])){
        [regionName, subRegionName, shiftName, dayOff, hotspot] = [parts[1], parts[2], parts[3], parts[4], parts[5]];
      } else {
        [regionName, subRegionName, shiftName, dayOff, hotspot] = [parts[2], parts[3], parts[4], parts[5], parts[6]];
      }
      const rider = state.profilesInScope.find(p => (p.employee_id||'').toLowerCase() === (empId||'').toLowerCase());
      if (!rider){ rows.push({ empId, ok:false, msg:'No rider found with this Employee ID (or outside your access)' }); continue; }
      const { data: existingActive } = await sb.from('roster_entries').select('id').eq('rider_id', rider.id).neq('status', 'removed').maybeSingle();
      if (existingActive){ rows.push({ empId, ok:false, msg:`${rider.full_name} already has an active roster entry — skipped` }); continue; }
      const region = state.regions.find(r => r.name.toLowerCase() === (regionName||'').toLowerCase());
      if (!region){ rows.push({ empId, ok:false, msg:`Region "${regionName}" not found — check spelling matches Settings exactly` }); continue; }
      const subRegion = subRegionName ? (allSubRegions||[]).find(s => s.region_id===region.id && s.name.toLowerCase()===subRegionName.toLowerCase()) : null;
      const shift = shiftName ? (allShifts||[]).find(s => s.name.toLowerCase() === shiftName.toLowerCase()) : null;
      const { error } = await sb.from('roster_entries').insert({
        rider_id: rider.id, region_id: region.id, sub_region_id: subRegion?.id || null,
        shift_id: shift?.id || null, day_off: dayOff || null, hotspot: hotspot || null, created_by: state.user.id
      });
      rows.push({ empId, ok: !error, msg: error ? error.message : `Added — ${rider.full_name}` });
    }
    resultsEl.innerHTML = `<table><thead><tr><th>Employee ID</th><th>Result</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td class="mono">${escapeHtml(r.empId)}</td><td>${r.ok?`<span class="badge active">${escapeHtml(r.msg)}</span>`:`<span class="badge open">${escapeHtml(r.msg)}</span>`}</td></tr>`).join('')}
    </tbody></table>`;
    toast(`${rows.filter(r=>r.ok).length} of ${rows.length} added`);
    renderRoster();
  };
}

function openRosterRemovalModal(entryId, riderId){
  openModal(`
    <h2>Mark as Resigned / Terminated / Transferred</h2>
    <p class="hint">This will also disable this rider's portal login.</p>
    <form id="roster-removal-form">
      <div class="form-row"><label>Reason</label><select id="rr-reason" required>
        <option>Resigned</option><option>Terminated</option><option>Transfer</option><option>Other</option>
      </select></div>
      <div class="form-row"><label>Effective date</label><input type="date" id="rr-date" value="${new Date().toISOString().slice(0,10)}" required></div>
      <div class="form-row"><label>Explanation</label><textarea id="rr-note" required placeholder="Short note for the record"></textarea></div>
      <label style="display:flex; align-items:center; gap:8px; font-weight:400; margin-bottom:14px;">
        <input type="checkbox" id="rr-replacement"> Replacement for this position is needed
      </label>
      <button class="btn-primary" type="submit">Confirm</button>
    </form>
  `);
  document.getElementById('roster-removal-form').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.from('roster_entries').update({
      status: 'removed',
      removal_reason: document.getElementById('rr-reason').value,
      status_date: document.getElementById('rr-date').value,
      removal_note: document.getElementById('rr-note').value.trim(),
      replacement_pending: document.getElementById('rr-replacement').checked
    }).eq('id', entryId);
    if (error){ toast('Could not remove: ' + error.message); return; }
    // Actually disable the login too (this used to just say it did, without doing it).
    if (riderId){
      await sb.from('profiles').update({ status: 'disabled' }).eq('id', riderId);
    }
    closeModal(); toast('Removed from roster — login disabled'); renderRoster();
  };
}

async function renderMyProfile(){
  const main = document.getElementById('main-content');
  const p = state.profile;
  main.innerHTML = `
    <div class="card">
      <h3>Your details</h3>
      <div class="form-row"><label>Full name</label><input type="text" id="mp-name" value="${escapeHtml(p.full_name||'')}"></div>
      <div class="two-col">
        <div class="form-row"><label>Mobile Number</label><input type="text" value="${escapeHtml(p.phone||'')}" disabled></div>
        <div class="form-row"><label>Employee ID</label><input type="text" value="${escapeHtml(p.employee_id||'—')}" disabled></div>
      </div>
      ${p.role==='rider' ? `<div class="form-row"><label>Bike Number</label><input type="text" id="mp-bike" value="${escapeHtml(p.bike_number||'')}"></div>` : ''}
      <div class="form-row"><label>Role</label><input type="text" value="${ROLE_LABEL[p.role]||p.role}" disabled></div>
      <div class="form-row"><label>Region(s)</label><input type="text" value="${escapeHtml(regionNamesFor(p))}" disabled></div>
      <button class="btn" id="mp-save-btn">Save changes</button>
    </div>
    <div class="card">
      <h3>Change password</h3>
      <p class="hint">Changing your password will sign you out of all other devices, for security.</p>
      <div class="form-row"><label>New password</label>
        <div class="password-field"><input type="password" id="mp-new-pw" minlength="6"><button type="button" class="password-toggle" id="mp-pw-toggle">Show</button></div>
      </div>
      <button class="btn" id="mp-pw-btn">Change password</button>
    </div>
  `;
  document.getElementById('mp-save-btn').onclick = async () => {
    const payload = { full_name: toProperCase(document.getElementById('mp-name').value.trim()) };
    if (p.role==='rider') payload.bike_number = document.getElementById('mp-bike').value.trim();
    const { error } = await sb.from('profiles').update(payload).eq('id', state.user.id);
    if (error){ toast('Could not save: ' + error.message); return; }
    state.profile = { ...state.profile, ...payload };
    renderUserBadge();
    toast('Saved');
  };
  document.getElementById('mp-pw-toggle').onclick = () => {
    const input = document.getElementById('mp-new-pw');
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    document.getElementById('mp-pw-toggle').textContent = isHidden ? 'Hide' : 'Show';
  };
  document.getElementById('mp-pw-btn').onclick = async () => {
    const pw = document.getElementById('mp-new-pw').value;
    if (!pw || pw.length < 6){ toast('Password must be at least 6 characters'); return; }
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error){ toast('Could not update: ' + error.message); return; }
    toast('Password updated. Signing you out for security…');
    await callEdgeFunction('force_signout_self', {});
    setTimeout(doLogout, 1200);
  };
}

function openModal(innerHtml){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'active-modal';
  overlay.innerHTML = `<div class="modal"><button class="modal-close" onclick="closeModal()">✕</button>${innerHtml}</div>`;
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
  document.body.appendChild(overlay);
  // Focus the first text input in the modal so typing/shortcuts work immediately
  setTimeout(() => { overlay.querySelector('input,textarea,select')?.focus(); }, 30);
}
function closeModal(){
  const m = document.getElementById('active-modal');
  if (m) m.remove();
}

// Global keyboard shortcuts (see Settings > Keyboard Shortcuts for the full list)
window.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  // Esc: close the topmost modal, or dismiss the newest toast if no modal is open
  if (e.key === 'Escape'){
    if (document.getElementById('active-modal')){ closeModal(); return; }
    const toasts = document.querySelectorAll('.toast');
    if (toasts.length) toasts[toasts.length-1].remove();
    return;
  }
  // Ctrl/Cmd+K: focus the most relevant search box on the current page
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'){
    const box = document.querySelector('#perm-user-search, #kb-search, #rf-search, #type-search, #cat-search, #subregion-search, #hotspot-search, #tool-search');
    if (box){ e.preventDefault(); box.focus(); box.select?.(); }
    return;
  }
  // Alt+N: open the primary "add new" action on the current page, if any
  if (e.altKey && e.key.toLowerCase() === 'n' && !typing){
    const btn = document.querySelector('#topbar-actions .btn:not(.outline)') || document.querySelector('#topbar-actions .btn');
    if (btn){ e.preventDefault(); btn.click(); }
  }
});
function toast(msg){
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<span>${escapeHtml(msg)}</span><button class="toast-close" aria-label="Dismiss">✕</button>`;
  document.body.appendChild(t);
  const timer = setTimeout(()=>t.remove(), 12000);
  t.querySelector('.toast-close').onclick = () => { clearTimeout(timer); t.remove(); };
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

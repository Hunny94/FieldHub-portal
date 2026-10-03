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
  designations: [],
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

// Designations (Settings -> Designations): a display title such as "Trainee Rider"
// that sits ON TOP of one of the real roles. The role (base_role) still decides
// permissions, navigation, RLS and every role check in the app; the designation
// only changes the label people see. If a person's role was changed after their
// designation was set (so they no longer match), we fall back to the role label.
const DESIGNATION_BASE_ROLES = ['rider','coordinator','regional_poc','team_lead','inventory_coordinator'];
function designationOf(p){
  if (!p || !p.designation_id) return null;
  const d = (state.designations || []).find(x => x.id === p.designation_id);
  return (d && d.base_role === p.role) ? d : null;
}
function designationLabel(p){
  const d = designationOf(p);
  return d ? d.name : (ROLE_LABEL[p.role] || p.role || '—');
}
// Small tag shown next to a name ONLY when the designation differs from the plain role label.
function designationTag(p){
  const d = designationOf(p);
  if (!d || d.name.trim().toLowerCase() === (ROLE_LABEL[p.role]||'').toLowerCase()) return '';
  return ` <span class="badge pending" style="font-size:11px;">${escapeHtml(d.name)}</span>`;
}

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
// The database always stores phone numbers in E.164 (+92...) for
// Supabase Auth, but everyone in this portal is used to seeing the
// local 03XXXXXXXXX format — this converts purely for display.
function toLocalPhone(raw){
  if (!raw) return raw;
  let digits = raw.replace(/[^0-9]/g, '');
  if (digits.startsWith('92')) digits = digits.slice(2);
  if (!digits.startsWith('0')) digits = '0' + digits;
  return digits;
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
    if (data.favicon_url){
      document.querySelectorAll("link[rel~='icon']").forEach(l => l.remove());
      const link = document.createElement('link');
      link.rel = 'icon';
      link.href = data.favicon_url;
      document.head.appendChild(link);
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
  await loadDesignations();
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

async function setupDesktopNotifications(){
  const desktopOk = ('Notification' in window);
  if (desktopOk && Notification.permission === 'default') Notification.requestPermission();
  const canDesktop = desktopOk && Notification.permission === 'granted';
  const fire = (title, body) => { if (canDesktop) new Notification(title, { body }); };

  // New circulars — notify everyone
  sb.channel('circulars-notify')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'circulars' }, (payload) => {
      if (payload.new.created_by === state.user.id) return;
      fire('FieldHub: New Circular', payload.new.title);
      pushNotification({ type:'Circular', title:'New circular', body:payload.new.title, created_at:payload.new.created_at });
    })
    .subscribe();

  // New requests assigned directly to me — notify the handler
  sb.channel('requests-notify-' + state.user.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'requests', filter: `assigned_poc_id=eq.${state.user.id}` }, (payload) => {
      fire('FieldHub: New Request', `New "${payload.new.category}" request needs your attention.`);
      pushNotification({ type:'Request', title:'New request assigned to you', body:payload.new.category, created_at:payload.new.created_at });
    })
    .subscribe();

  // Status updates on requests/tasks I care about, and warnings issued
  // to me — these can't be filtered server-side by "my request IDs"
  // (Realtime filters only support one column), so we keep a live set
  // of relevant IDs and check client-side.
  const refreshMyIds = async () => {
    const { data: myRequests } = await sb.from('requests').select('id').or(`rider_id.eq.${state.user.id},assigned_poc_id.eq.${state.user.id}`);
    const { data: myTasks } = await sb.from('tasks').select('id').or(`assigned_to.eq.${state.user.id},assigned_by.eq.${state.user.id}`);
    return {
      requestIds: new Set((myRequests||[]).map(r=>r.id)),
      taskIds: new Set((myTasks||[]).map(t=>t.id))
    };
  };
  let { requestIds, taskIds } = await refreshMyIds();

  sb.channel('request-updates-notify-' + state.user.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'request_updates' }, (payload) => {
      if (payload.new.created_by === state.user.id) return;
      if (!requestIds.has(payload.new.request_id)) return;
      fire('FieldHub: Request updated', payload.new.message || 'Status changed');
      pushNotification({ type:'Request update', title:'A request you follow was updated', body: payload.new.new_status ? `Status → ${payload.new.new_status.replace('_',' ')}: ${payload.new.message}` : payload.new.message, created_at:payload.new.created_at });
    })
    .subscribe();

  sb.channel('task-updates-notify-' + state.user.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_updates' }, (payload) => {
      if (payload.new.created_by === state.user.id) return;
      if (!taskIds.has(payload.new.task_id)) return;
      fire('FieldHub: Task updated', payload.new.message || 'Status changed');
      pushNotification({ type:'Task update', title:'A task you follow was updated', body: payload.new.new_status ? `Status → ${payload.new.new_status.replace('_',' ')}: ${payload.new.message}` : payload.new.message, created_at:payload.new.created_at });
    })
    .subscribe();

  sb.channel('warnings-notify-' + state.user.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'disciplinary_actions', filter: `rider_id=eq.${state.user.id}` }, (payload) => {
      fire('FieldHub: Warning issued', payload.new.action_type);
      pushNotification({ type:'Warning', title:'A warning was issued to you', body:payload.new.action_type, created_at:payload.new.created_at });
    })
    .subscribe();

  // New requests/tasks change the relevant-ID sets — refresh periodically
  // rather than trying to keep them perfectly live.
  setInterval(async () => { ({ requestIds, taskIds } = await refreshMyIds()); }, 5*60*1000);
}

async function showLatestUnackedCircularPopup(){
  const { data: circulars } = await sb.from('circulars').select('*').is('deleted_at', null).order('created_at', {ascending:false}).limit(1);
  if (!circulars || !circulars.length) return;
  const c = circulars[0];
  if (c.created_by === state.user.id) return;
  const { data: ack } = await sb.from('circular_acks').select('id').eq('circular_id', c.id).eq('user_id', state.user.id).maybeSingle();
  if (ack) return;
  // Once acknowledged it never shows again (handled above); until then,
  // only interrupt once per day rather than on every page load.
  const shownKey = `fieldhub_circular_popup_shown_${c.id}_${state.user.id}`;
  const today = new Date().toDateString();
  if (localStorage.getItem(shownKey) === today) return;
  localStorage.setItem(shownKey, today);
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
  const [{ data: expiryRows }, { count: toolCount }] = await Promise.all([
    sb.from('expiry_items').select('id, group_id').lte('expiry_date', cutoffStr),
    sb.from('tool_issuances').select('id', {count:'exact', head:true}).lte('next_due_date', cutoffStr)
  ]);
  const expCount = new Set((expiryRows||[]).map(i => i.group_id || i.id)).size;
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
  const sinceKey = `fieldhub_notif_since_${state.user.id}`;
  // localStorage is the reliable source of truth here — the DB column
  // round-trip was silently failing for some users (e.g. if a migration
  // hadn't landed yet), which made the same notifications keep
  // reappearing on every reload. This can't fail silently the same way.
  const since = localStorage.getItem(sinceKey) || state.profile.notifications_last_seen_at || new Date(Date.now() - 3*24*60*60*1000).toISOString();

  const items = [];
  const { data: newCirculars } = await sb.from('circulars').select('id, title, created_at, created_by').is('deleted_at', null).gt('created_at', since).order('created_at', {ascending:false}).limit(20);
  (newCirculars||[]).filter(c=>c.created_by!==state.user.id).forEach(c => items.push({ id:'circ-'+c.id, type:'Circular', title:'New circular', body:c.title, created_at:c.created_at, read:false }));

  const { data: myRequests } = await sb.from('requests').select('id, category').or(`rider_id.eq.${state.user.id},assigned_poc_id.eq.${state.user.id}`);
  const myRequestIds = (myRequests||[]).map(r=>r.id);
  if (myRequestIds.length){
    const { data: reqUpdates } = await sb.from('request_updates').select('*, profiles(full_name)').in('request_id', myRequestIds).gt('created_at', since).neq('created_by', state.user.id).order('created_at', {ascending:false}).limit(20);
    (reqUpdates||[]).forEach(u => items.push({ id:'req-'+u.id, type:'Request update', title:`${u.profiles?.full_name||'Someone'} updated a request`, body: u.new_status ? `Status → ${u.new_status.replace('_',' ')}: ${u.message}` : u.message, created_at:u.created_at, read:false }));
  }

  const { data: myTasks } = await sb.from('tasks').select('id').or(`assigned_to.eq.${state.user.id},assigned_by.eq.${state.user.id}`);
  const myTaskIds = (myTasks||[]).map(t=>t.id);
  if (myTaskIds.length){
    const { data: taskUpdates } = await sb.from('task_updates').select('*, profiles(full_name)').in('task_id', myTaskIds).gt('created_at', since).neq('created_by', state.user.id).order('created_at', {ascending:false}).limit(20);
    (taskUpdates||[]).forEach(u => items.push({ id:'task-'+u.id, type:'Task update', title:`${u.profiles?.full_name||'Someone'} updated a task`, body: u.new_status ? `Status → ${u.new_status.replace('_',' ')}: ${u.message}` : u.message, created_at:u.created_at, read:false }));
  }

  if (state.profile.role !== 'admin' && state.profile.role !== 'super_admin'){
    const { data: myWarnings } = await sb.from('disciplinary_actions').select('*, recorder:profiles!recorded_by(full_name)').eq('rider_id', state.user.id).gt('created_at', since).order('created_at', {ascending:false}).limit(20);
    (myWarnings||[]).forEach(w => items.push({ id:'warn-'+w.id, type:'Warning', title:`Warning issued by ${w.recorder?.full_name||'—'}`, body: w.action_type, created_at:w.created_at, read:false }));
  }

  items.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  state.notifications = items.slice(0, retainCount);

  // Each item gets its own toast, instead of one combined line
  state.notifications.forEach(n => toast(`${n.title}: ${n.body}`));

  ensureNotificationBell();
  updateNotificationBadge();

  // Advance the cutoff immediately so a reload right after doesn't
  // re-show the same items — this is the fix that actually matters.
  const now = new Date().toISOString();
  localStorage.setItem(sinceKey, now);
  // Best-effort DB write too (for potential future multi-device sync) —
  // failures here are fine since localStorage is already the source of truth.
  sb.from('profiles').update({ notifications_last_seen_at: now }).eq('id', state.user.id).then(()=>{}, ()=>{});
  state.profile.notifications_last_seen_at = now;
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

function pushNotification(item){
  ensureNotificationBell();
  const retainCount = state.systemSettings?.notification_retain_count || 5;
  item.id = item.id || ('live-' + Date.now() + '-' + Math.random());
  item.read = false;
  state.notifications = [item, ...state.notifications].slice(0, retainCount);
  updateNotificationBadge();
  toast(`${item.title}: ${item.body || ''}`);
}

function updateNotificationBadge(){
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  const n = state.notifications.filter(x=>!x.read).length;
  badge.style.display = n ? 'block' : 'none';
  badge.textContent = n;
}

// Notifications are grouped by type into expandable sections. Clicking
// one marks it read (dims it, moves the unread count down) but it stays
// visible in the list — nothing disappears just from being read.
function toggleNotificationDropdown(){
  const existing = document.getElementById('notif-dropdown');
  if (existing){ existing.remove(); return; }
  const bell = document.getElementById('notif-bell-btn');
  if (!bell) return;
  renderNotificationDropdown(bell);
}

function renderNotificationDropdown(bell){
  const rect = bell.getBoundingClientRect();
  let dropdown = document.getElementById('notif-dropdown');
  const isNew = !dropdown;
  if (isNew){
    dropdown = document.createElement('div');
    dropdown.id = 'notif-dropdown';
    dropdown.style.cssText = `position:fixed; top:${rect.bottom+6}px; right:${window.innerWidth-rect.right}px; width:340px; max-height:440px; overflow-y:auto; background:#fff; border:1px solid var(--line); border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,0.15); z-index:5000; padding:10px;`;
    document.body.appendChild(dropdown);
  }

  const groups = new Map();
  state.notifications.forEach(n => { if (!groups.has(n.type)) groups.set(n.type, []); groups.get(n.type).push(n); });

  dropdown.innerHTML = state.notifications.length
    ? Array.from(groups.entries()).map(([type, list]) => {
        const unreadCount = list.filter(n=>!n.read).length;
        return `<details ${unreadCount?'open':''} style="margin-bottom:6px;">
          <summary style="cursor:pointer; font-weight:600; font-size:13px; padding:6px 4px; list-style:none;">
            ${escapeHtml(type)} ${unreadCount ? `<span class="badge pending" style="margin-left:4px;">${unreadCount} new</span>` : ''}
          </summary>
          ${list.map(n => `<div data-notif-item="${n.id}" style="padding:8px 6px; border-bottom:1px solid var(--line); cursor:pointer; ${n.read?'opacity:0.55;':''}">
            <div style="font-weight:${n.read?'400':'600'}; font-size:13px;">${escapeHtml(n.title)}</div>
            <div style="font-size:12.5px; color:var(--muted);">${escapeHtml(n.body||'')}</div>
            <div class="mono" style="font-size:11px; margin-top:2px;">${formatDateTime(n.created_at)}</div>
          </div>`).join('')}
        </details>`;
      }).join('')
    : `<div style="padding:14px; color:var(--muted); font-size:13px;">No recent notifications.</div>`;

  dropdown.querySelectorAll('[data-notif-item]').forEach(el => {
    el.onclick = () => {
      const n = state.notifications.find(x=>x.id===el.dataset.notifItem);
      if (n && !n.read){ n.read = true; updateNotificationBadge(); renderNotificationDropdown(bell); }
    };
  });

  if (isNew){
    const closeOnOutside = (e) => {
      if (!dropdown.contains(e.target) && e.target.id !== 'notif-bell-btn'){
        dropdown.remove();
        document.removeEventListener('click', closeOnOutside);
      }
    };
    setTimeout(() => document.addEventListener('click', closeOnOutside), 10);
  }
}

async function showPendingPopupAnnouncement(){
  const { data: popups } = await sb.from('popup_announcements').select('*').eq('active', true).order('created_at', {ascending:false});
  if (!popups || !popups.length) return;
  const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
  const { data: dismissed } = await sb.from('popup_dismissals').select('popup_id, dismissed_at').eq('user_id', state.user.id).gte('dismissed_at', startOfToday.toISOString());
  const dismissedTodaySet = new Set((dismissed||[]).map(d=>d.popup_id));
  const next = popups.find(p => !dismissedTodaySet.has(p.id));
  if (!next) return;
  openModal(`
    <h2>${escapeHtml(next.title)}</h2>
    <p style="font-size:14px; white-space:pre-wrap;">${escapeHtml(next.body)}</p>
    <button class="btn-primary" id="popup-announcement-dismiss">Got it</button>
  `);
  const dismiss = async () => { await sb.from('popup_dismissals').upsert({ popup_id: next.id, user_id: state.user.id, dismissed_at: new Date().toISOString() }, { onConflict: 'popup_id,user_id' }); };
  document.getElementById('popup-announcement-dismiss').onclick = async () => { await dismiss(); closeModal(); };
  // Also record dismissal if they close via the modal's own ✕ button
  const modalCloseBtn = document.querySelector('#active-modal .modal-close');
  if (modalCloseBtn) modalCloseBtn.addEventListener('click', dismiss, { once: true });
}

async function loadRegions(){
  const { data } = await sb.from('regions').select('*').order('name');
  state.regions = data || [];
}
async function loadDesignations(){
  const { data, error } = await sb.from('designations').select('*').order('sort_order').order('name');
  state.designations = error ? [] : (data || []);
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
  const selectedSignupRole = () => {
    const o = designationSelect.options[designationSelect.selectedIndex];
    return o ? (o.dataset.role || o.value) : '';
  };
  const updateBikeVisibility = () => { bikeWrap.style.display = selectedSignupRole() === 'rider' ? 'block' : 'none'; };
  designationSelect.onchange = updateBikeVisibility;
  updateBikeVisibility();
  // Replace the built-in list with the Super-Admin-managed Designations (if available).
  // If the table doesn't exist yet or is empty, the built-in list above stays as the fallback.
  (async () => {
    const { data, error } = await sb.from('designations').select('id, name, base_role').eq('active', true).order('sort_order').order('name');
    if (error || !data || !data.length) return;
    designationSelect.innerHTML = data.map(d => `<option value="${d.id}" data-role="${d.base_role}" data-designation-id="${d.id}">${escapeHtml(d.name)}</option>`).join('');
    updateBikeVisibility();
  })();

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
    const signupOpt = designationSelect.options[designationSelect.selectedIndex];
    const requested_role = signupOpt.dataset.role || signupOpt.value;
    const signup_designation_id = signupOpt.dataset.designationId || null;
    const employee_id = document.getElementById('signup-empid').value.trim();
    const phone = toE164(document.getElementById('signup-phone').value.trim());
    const email = document.getElementById('signup-email').value.trim();
    const bike_number = requested_role === 'rider' ? document.getElementById('signup-bike').value.trim() : '';
    const password = document.getElementById('signup-password').value;

    const { data: existing } = await sb.rpc('check_employee_id', { p_employee_id: employee_id });
    if (existing && existing.length){
      showAuthMessage(`Employee ID "${employee_id}" is already registered to ${existing[0].full_name} (${toLocalPhone(existing[0].phone)}). Each Employee ID can only be used once.`);
      return;
    }

    const { data, error } = await sb.auth.signUp({
      phone, password, options: { data: { full_name, requested_role } }
    });
    if (error){ showAuthMessage(error.message); return; }
    if (data.user){
      const signupPayload = { email, employee_id, bike_number };
      if (signup_designation_id) signupPayload.designation_id = signup_designation_id;
      await sb.from('profiles').update(signupPayload).eq('id', data.user.id);
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
    await sb.from('activity_log').insert({ actor_id: state.user.id, action: 'changed their own password', entity_type: 'Account', entity_label: state.profile?.full_name || '' });
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
  super_admin: ['dashboard','circulars','tasks','requests','expiries','tools','warnings','roster','fieldvisits','team','regions','settings','knowledgebase','resources','reports','compliance','activitylog','releasenotes','hierarchy'],
  admin: ['dashboard','circulars','tasks','requests','expiries','tools','warnings','roster','fieldvisits','team','regions','settings','knowledgebase','resources','reports','compliance','releasenotes','hierarchy'],
  regional_poc: ['dashboard','circulars','tasks','requests','expiries','tools','warnings','roster','fieldvisits','team','knowledgebase','resources','compliance','releasenotes','hierarchy'],
  team_lead: ['dashboard','circulars','tasks','requests','expiries','tools','warnings','roster','fieldvisits','team','knowledgebase','resources','compliance','releasenotes','hierarchy'],
  coordinator: ['dashboard','circulars','tasks','requests','expiries','tools','warnings','roster','fieldvisits','team','knowledgebase','resources','compliance','releasenotes','hierarchy'],
  inventory_coordinator: ['dashboard','circulars','tasks','requests','expiries','tools','roster','knowledgebase','resources','releasenotes','hierarchy'],
  rider: ['dashboard','circulars','requests','expiries','tools','warnings','roster','fieldvisits','knowledgebase','resources','releasenotes','hierarchy']
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
  compliance:'Compliance Tracker', activitylog:'Activity Log', releasenotes:"What's New", hierarchy:'My Team & Supervisors',
  fieldvisits:'Field Visit Reports'
};
// Groups the sidebar into collapsible sections. 'dashboard' always stands alone at top.
const NAV_GROUPS = [
  { label: null, items: ['dashboard'] },
  { label: 'Operations', items: ['circulars','tasks','requests'] },
  { label: 'Inventory', items: ['expiries','tools'] },
  { label: 'People', items: ['team','warnings','compliance','roster','fieldvisits','hierarchy'] },
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
    else if (view==='hierarchy') await renderHierarchy();
    else if (view==='fieldvisits') await renderFieldVisits();
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
    sb.from('circulars').select('id').is('deleted_at', null),
    sb.from('expiry_items').select('id, group_id, expiry_date'),
    isAdmin() ? sb.from('profiles').select('id', {count:'exact', head:true}).eq('status','pending') : Promise.resolve({count:0}),
    sb.from('home_notices').select('*').eq('active', true).or(`expires_at.is.null,expires_at.gte.${new Date().toISOString().slice(0,10)}`).order('created_at', {ascending:false}),
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
  const expiringDueRows = (expiring.data||[]).filter(i => new Date(i.expiry_date) <= soonCutoff);
  const expiringSoon = new Set(expiringDueRows.map(i => i.group_id || i.id)).size;

  main.innerHTML = `
    ${bannerVisible ? `<div class="card" style="padding:0; overflow:hidden; cursor:pointer;" id="dashboard-banner-click">
      <img src="${escapeHtml(banner.data.image_url)}" style="width:100%; max-height:280px; object-fit:contain; background:#f4f4f4; display:block;">
      ${banner.data.title ? `<div style="padding:8px 12px; font-weight:600;">${escapeHtml(banner.data.title)}</div>` : ''}
    </div>` : ''}
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

  if (bannerVisible){
    document.getElementById('dashboard-banner-click').onclick = () => {
      openModal(`
        <h2>${banner.data.title ? escapeHtml(banner.data.title) : 'Home Banner'}</h2>
        <img src="${escapeHtml(banner.data.image_url)}" style="width:100%; border-radius:8px;">
      `);
    };
  }
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

  let circularsQuery = sb.from('circulars').select('*, profiles!created_by(full_name)').is('deleted_at', null).order('created_at', {ascending:false});
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
      ${isSuperAdmin() ? `<button class="btn outline" id="popup-edit-btn">Edit</button>` : ''}
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
    document.getElementById('popup-edit-btn').onclick = () => { closeModal(); openEditCircularModal(c); };
    document.getElementById('popup-kb-toggle-btn').onclick = async () => {
      const newVal = !c.push_to_kb;
      const { error } = await sb.from('circulars').update({ push_to_kb: newVal }).eq('id', c.id);
      if (error){ toast('Could not update: ' + error.message); return; }
      c.push_to_kb = newVal;
      toast(newVal ? 'Pushed to Knowledge Base' : 'Removed from Knowledge Base');
      closeModal(); openCircularPopup(c, acked);
    };
    document.getElementById('popup-delete-btn').onclick = async () => {
      if (!confirm('Delete this circular? It can be restored from Settings → Trash within 48 hours.')) return;
      const { error } = await sb.from('circulars').update({ deleted_at: new Date().toISOString(), deleted_by: state.user.id }).eq('id', c.id);
      if (error){ toast('Could not delete: ' + error.message); return; }
      closeModal(); toast('Circular deleted — restorable from Trash for 48 hours'); renderCirculars();
    };
  }
}

async function openEditCircularModal(c){
  const currentRegionIds = new Set(c.target_region_ids || (c.target_region_id ? [c.target_region_id] : []));
  const currentRoles = new Set(c.target_roles || (c.target_role ? [c.target_role] : []));
  const { data: cats } = await sb.from('circular_categories').select('*').eq('active', true).order('name');
  const catOptions = `<option value="">— None —</option>` + (cats||[]).map(cat=>`<option value="${cat.id}" ${cat.id===c.category_id?'selected':''}>${escapeHtml(cat.name)}</option>`).join('');
  const regionChecks = state.regions.map(r=>`
    <div style="display:flex; align-items:center; gap:8px; padding:6px 4px;">
      <input type="checkbox" class="ec-region-check" value="${r.id}" id="ec-region-${r.id}" ${currentRegionIds.has(r.id)?'checked':''}>
      <label for="ec-region-${r.id}" style="font-weight:400; margin:0; cursor:pointer;">${escapeHtml(r.name)}</label>
    </div>`).join('');
  const roleChecks = Object.entries(ROLE_LABEL).map(([k,v])=>`
    <div style="display:flex; align-items:center; gap:8px; padding:6px 4px;">
      <input type="checkbox" class="ec-role-check" value="${k}" id="ec-role-${k}" ${currentRoles.has(k)?'checked':''}>
      <label for="ec-role-${k}" style="font-weight:400; margin:0; cursor:pointer;">${v}</label>
    </div>`).join('');
  openModal(`
    <h2>Edit circular</h2>
    <form id="circular-edit-form">
      <div class="form-row"><label>Title</label><input type="text" id="ec-title" value="${escapeHtml(c.title)}" required></div>
      <div class="form-row"><label>Category</label><select id="ec-category">${catOptions}</select></div>
      <div class="form-row"><label>Message</label><textarea id="ec-body" required>${escapeHtml(c.body)}</textarea></div>
      <div class="form-row">
        <label>Target region(s) — none checked = all</label>
        <div style="position:relative;">
          <button type="button" class="btn outline" id="ec-region-trigger" style="width:100%; text-align:left; display:flex; justify-content:space-between; align-items:center;">
            <span id="ec-region-summary">${currentRegionIds.size ? `${currentRegionIds.size} selected` : 'All regions'}</span><span>▾</span>
          </button>
          <div id="ec-region-panel" style="display:none; position:absolute; z-index:50; top:calc(100% + 4px); left:0; right:0; background:#fff; border:1px solid var(--line); border-radius:8px; max-height:220px; overflow-y:auto; padding:8px; box-shadow:0 8px 20px rgba(0,0,0,0.15);">${regionChecks}</div>
        </div>
      </div>
      <div class="form-row">
        <label>Target role(s) — none checked = all</label>
        <div style="position:relative;">
          <button type="button" class="btn outline" id="ec-role-trigger" style="width:100%; text-align:left; display:flex; justify-content:space-between; align-items:center;">
            <span id="ec-role-summary">${currentRoles.size ? `${currentRoles.size} selected` : 'All roles'}</span><span>▾</span>
          </button>
          <div id="ec-role-panel" style="display:none; position:absolute; z-index:50; top:calc(100% + 4px); left:0; right:0; background:#fff; border:1px solid var(--line); border-radius:8px; max-height:220px; overflow-y:auto; padding:8px; box-shadow:0 8px 20px rgba(0,0,0,0.15);">${roleChecks}</div>
        </div>
      </div>
      <button class="btn-primary" type="submit">Save changes</button>
    </form>
  `);
  const setupDropdown = (triggerId, panelId) => {
    const trigger = document.getElementById(triggerId);
    const panel = document.getElementById(panelId);
    trigger.onclick = (e) => {
      e.stopPropagation();
      const isOpen = panel.style.display === 'block';
      document.querySelectorAll('#ec-region-panel, #ec-role-panel').forEach(p => p.style.display = 'none');
      panel.style.display = isOpen ? 'none' : 'block';
    };
  };
  setupDropdown('ec-region-trigger', 'ec-region-panel');
  setupDropdown('ec-role-trigger', 'ec-role-panel');
  document.addEventListener('click', (e) => {
    if (!document.getElementById('active-modal')) return;
    if (!e.target.closest('#ec-region-panel, #ec-region-trigger')) document.getElementById('ec-region-panel').style.display = 'none';
    if (!e.target.closest('#ec-role-panel, #ec-role-trigger')) document.getElementById('ec-role-panel').style.display = 'none';
  });
  document.querySelectorAll('.ec-region-check').forEach(cb => cb.onchange = () => {
    const n = document.querySelectorAll('.ec-region-check:checked').length;
    document.getElementById('ec-region-summary').textContent = n ? `${n} selected` : 'All regions';
  });
  document.querySelectorAll('.ec-role-check').forEach(cb => cb.onchange = () => {
    const n = document.querySelectorAll('.ec-role-check:checked').length;
    document.getElementById('ec-role-summary').textContent = n ? `${n} selected` : 'All roles';
  });
  document.getElementById('circular-edit-form').onsubmit = async (e) => {
    e.preventDefault();
    const regionIds = Array.from(document.querySelectorAll('.ec-region-check:checked')).map(cb=>cb.value);
    const roles = Array.from(document.querySelectorAll('.ec-role-check:checked')).map(cb=>cb.value);
    const { error } = await sb.from('circulars').update({
      title: document.getElementById('ec-title').value.trim(),
      body: document.getElementById('ec-body').value.trim(),
      category_id: document.getElementById('ec-category').value || null,
      target_region_id: regionIds.length === 1 ? regionIds[0] : null,
      target_role: roles.length === 1 ? roles[0] : null,
      target_region_ids: regionIds.length ? regionIds : null,
      target_roles: roles.length ? roles : null
    }).eq('id', c.id);
    if (error){ toast('Could not save: ' + error.message); return; }
    closeModal(); toast('Updated'); renderCirculars();
  };
}

async function showCircularTracker(circularId, circular, el){
  el.innerHTML = '<div class="mono">Loading…</div>';
  let q = sb.from('profiles').select('id, full_name, role, designation_id').eq('status','active').neq('id', circular.created_by);
  const regionIds = circular.target_region_ids || (circular.target_region_id ? [circular.target_region_id] : []);
  const roles = circular.target_roles || (circular.target_role ? [circular.target_role] : []);
  if (regionIds.length) q = q.in('region_id', regionIds);
  if (roles.length) q = q.in('role', roles);
  const { data: audience } = await q;
  const { data: acks } = await sb.from('circular_acks').select('user_id, acknowledged_at').eq('circular_id', circularId);
  const ackMap = new Map((acks||[]).map(a=>[a.user_id, a.acknowledged_at]));
  const ackedCount = (audience||[]).filter(p=>ackMap.has(p.id)).length;
  el.innerHTML = `<div class="mono" style="margin:8px 0;">Posted ${formatDateTime(circular.created_at)} · ${ackedCount} acknowledged, ${(audience||[]).length - ackedCount} pending
    <button class="btn small outline" id="tracker-csv-btn" style="margin-left:8px;">Export CSV</button></div>
  <table><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>When</th></tr></thead><tbody>
    ${(audience||[]).map(p=>{
      const ackedAt = ackMap.get(p.id);
      return `<tr><td>${escapeHtml(p.full_name)}</td><td>${escapeHtml(designationLabel(p))}</td>
        <td>${ackedAt ? `<span class="badge active">Acknowledged</span>` : `<span class="badge open">Pending</span>`}</td>
        <td class="mono">${ackedAt ? formatDateTime(ackedAt) : '—'}</td></tr>`;
    }).join('')}
  </tbody></table>`;
  document.getElementById('tracker-csv-btn').onclick = () => {
    const rows = (audience||[]).map(p => ({
      Name: p.full_name, Role: designationLabel(p),
      Status: ackMap.has(p.id) ? 'Acknowledged' : 'Pending',
      'Acknowledged At': ackMap.get(p.id) || ''
    }));
    downloadCSV(`circular-tracker-${circular.title.replace(/[^a-z0-9]/gi,'-')}.csv`, toCSV(rows));
  };
}

async function countAudience(targetRegionId, targetRole, excludeId, targetRegionIds, targetRoles){
  let q = sb.from('profiles').select('id', {count:'exact', head:true}).eq('status','active');
  const regionIds = targetRegionIds || (targetRegionId ? [targetRegionId] : []);
  const roles = targetRoles || (targetRole ? [targetRole] : []);
  if (regionIds.length) q = q.in('region_id', regionIds);
  if (roles.length) q = q.in('role', roles);
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
  const regionChoices = isRegionLocked ? myRegions : state.regions;
  const isRoleLockedToFieldStaff = state.profile.role === 'team_lead';
  const roleChoices = isRoleLockedToFieldStaff ? [['rider',ROLE_LABEL.rider],['coordinator',ROLE_LABEL.coordinator]] : Object.entries(ROLE_LABEL);
  const { data: cats } = await sb.from('circular_categories').select('*').eq('active', true).order('name');
  const catOptions = `<option value="">— None —</option>` + (cats||[]).map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  const wordLimit = state.systemSettings?.circular_word_limit;

  const regionChecks = regionChoices.length ? regionChoices.map(r=>`
    <div style="display:flex; align-items:center; gap:8px; padding:6px 4px; text-align:left;">
      <input type="checkbox" class="c-region-check" value="${r.id}" id="c-region-${r.id}">
      <label for="c-region-${r.id}" style="font-weight:400; margin:0; cursor:pointer;">${escapeHtml(r.name)}</label>
    </div>`).join('') : `<p class="hint">⚠️ No region assigned to you — ask Admin to fix this in Team.</p>`;
  const roleChecks = roleChoices.map(([k,v])=>`
    <div style="display:flex; align-items:center; gap:8px; padding:6px 4px; text-align:left;">
      <input type="checkbox" class="c-role-check" value="${k}" id="c-role-${k}">
      <label for="c-role-${k}" style="font-weight:400; margin:0; cursor:pointer;">${v}</label>
    </div>`).join('');

  openModal(`
    <h2>New circular</h2>
    <form id="circular-form">
      <div class="form-row"><label>Title</label><input type="text" id="c-title" required></div>
      <div class="form-row"><label>Category (optional)</label><select id="c-category">${catOptions}</select></div>
      <div class="form-row"><label>Message</label><textarea id="c-body" required></textarea>
        <span class="field-hint" id="c-word-count">0 words${wordLimit?` / ${wordLimit} max`:''}</span>
      </div>
      <div class="form-row">
        <label>Target region(s) — none checked = all regions</label>
        <div style="position:relative;">
          <button type="button" class="btn outline" id="c-region-trigger" style="width:100%; text-align:left; display:flex; justify-content:space-between; align-items:center;">
            <span id="c-region-summary">${isRegionLocked ? 'Your region(s)' : 'All regions'}</span><span>▾</span>
          </button>
          <div id="c-region-panel" style="display:none; position:absolute; z-index:50; top:calc(100% + 4px); left:0; right:0; background:#fff; border:1px solid var(--line); border-radius:8px; max-height:220px; overflow-y:auto; padding:8px; box-shadow:0 8px 20px rgba(0,0,0,0.15);">
            ${!isRegionLocked ? `<button type="button" class="btn small outline" id="c-select-all-regions" style="margin-bottom:6px; width:100%;">Select All Regions</button>` : ''}
            ${regionChecks}
          </div>
        </div>
      </div>
      <div class="form-row">
        <label>Target role(s) — none checked = all roles</label>
        <div style="position:relative;">
          <button type="button" class="btn outline" id="c-role-trigger" style="width:100%; text-align:left; display:flex; justify-content:space-between; align-items:center;">
            <span id="c-role-summary">All roles</span><span>▾</span>
          </button>
          <div id="c-role-panel" style="display:none; position:absolute; z-index:50; top:calc(100% + 4px); left:0; right:0; background:#fff; border:1px solid var(--line); border-radius:8px; max-height:220px; overflow-y:auto; padding:8px; box-shadow:0 8px 20px rgba(0,0,0,0.15);">
            <button type="button" class="btn small outline" id="c-select-all-roles" style="margin-bottom:6px; width:100%;">Select All Roles</button>
            ${roleChecks}
          </div>
        </div>
      </div>
      <button class="btn-primary" type="submit">Post circular</button>
    </form>
  `);

  const setupDropdown = (triggerId, panelId) => {
    const trigger = document.getElementById(triggerId);
    const panel = document.getElementById(panelId);
    trigger.onclick = (e) => {
      e.stopPropagation();
      const isOpen = panel.style.display === 'block';
      document.querySelectorAll('#c-region-panel, #c-role-panel').forEach(p => p.style.display = 'none');
      panel.style.display = isOpen ? 'none' : 'block';
    };
  };
  setupDropdown('c-region-trigger', 'c-region-panel');
  setupDropdown('c-role-trigger', 'c-role-panel');
  document.addEventListener('click', (e) => {
    if (!document.getElementById('active-modal')) return;
    if (!e.target.closest('#c-region-panel, #c-region-trigger')) document.getElementById('c-region-panel').style.display = 'none';
    if (!e.target.closest('#c-role-panel, #c-role-trigger')) document.getElementById('c-role-panel').style.display = 'none';
  });

  const updateRegionSummary = () => {
    const checked = regionChoices.filter(r => document.getElementById(`c-region-${r.id}`)?.checked);
    document.getElementById('c-region-summary').textContent = checked.length
      ? (checked.length <= 2 ? checked.map(r=>r.name).join(', ') : `${checked.length} regions selected`)
      : (isRegionLocked ? 'Your region(s)' : 'All regions');
  };
  const updateRoleSummary = () => {
    const checked = Array.from(document.querySelectorAll('.c-role-check:checked'));
    document.getElementById('c-role-summary').textContent = checked.length
      ? (checked.length <= 2 ? checked.map(cb=>ROLE_LABEL[cb.value]).join(', ') : `${checked.length} roles selected`)
      : 'All roles';
  };
  document.getElementById('c-select-all-regions')?.addEventListener('click', () => {
    document.querySelectorAll('.c-region-check').forEach(cb => cb.checked = true);
    updateRegionSummary();
  });
  document.getElementById('c-select-all-roles').onclick = () => {
    document.querySelectorAll('.c-role-check').forEach(cb => cb.checked = true);
    updateRoleSummary();
  };
  document.querySelectorAll('.c-region-check').forEach(cb => cb.onchange = updateRegionSummary);
  document.querySelectorAll('.c-role-check').forEach(cb => cb.onchange = updateRoleSummary);

  const bodyEl = document.getElementById('c-body');
  const counterEl = document.getElementById('c-word-count');
  bodyEl.oninput = () => {
    const n = countWords(bodyEl.value);
    counterEl.textContent = `${n} words${wordLimit?` / ${wordLimit} max`:''}`;
    counterEl.style.color = (wordLimit && n > wordLimit) ? 'var(--clay)' : '';
  };
  document.getElementById('circular-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!confirm('Post this circular now? Everyone it targets will be notified.')) return;
    const title = document.getElementById('c-title').value.trim();
    const body = document.getElementById('c-body').value.trim();
    const { data: sys } = await sb.from('system_settings').select('circular_word_limit').eq('id', 1).maybeSingle();
    if (sys?.circular_word_limit && countWords(body) > sys.circular_word_limit){
      toast(`This circular is too long — please keep it under ${sys.circular_word_limit} words.`);
      return;
    }
    let targetRegionIds = Array.from(document.querySelectorAll('.c-region-check:checked')).map(cb=>cb.value);
    let targetRoles = Array.from(document.querySelectorAll('.c-role-check:checked')).map(cb=>cb.value);
    if (isRegionLocked && !targetRegionIds.length) targetRegionIds = state.myRegionIds;
    if (isRoleLockedToFieldStaff && !targetRoles.length) targetRoles = ['rider','coordinator'];

    const { error } = await sb.from('circulars').insert({
      title,
      body,
      created_by: state.user.id,
      target_region_id: targetRegionIds.length === 1 ? targetRegionIds[0] : null,
      target_role: targetRoles.length === 1 ? targetRoles[0] : null,
      target_region_ids: targetRegionIds.length ? targetRegionIds : null,
      target_roles: targetRoles.length ? targetRoles : null,
      category_id: document.getElementById('c-category').value || null
    });
    if (error){ toast('Could not post: ' + error.message); return; }
    closeModal(); toast('Circular posted'); renderCirculars();
    // Best-effort WhatsApp broadcast to everyone targeted
    let q = sb.from('profiles').select('phone').eq('status','active');
    if (targetRegionIds.length) q = q.in('region_id', targetRegionIds);
    if (targetRoles.length) q = q.in('role', targetRoles);
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
  if (canSeeAssignedByMe || isAdmin()){
    tabsHtml = `<div class="tabs">
      <button class="tab ${taskTab==='mine'?'active':''}" data-tab="mine">Assigned to me</button>
      ${canSeeAssignedByMe ? `<button class="tab ${taskTab==='assignedByMe'?'active':''}" data-tab="assignedByMe">I assigned</button>` : ''}
      ${isAdmin() ? `<button class="tab ${taskTab==='all'?'active':''}" data-tab="all">All Tasks (org-wide)</button>` : ''}
    </div>`;
  }

  let query = sb.from('tasks').select('*, assignee:profiles!assigned_to(full_name, employee_id), assigner:profiles!assigned_by(full_name, employee_id)').is('deleted_at', null).order('due_date', {ascending:true, nullsFirst:false});
  if (taskTab === 'all' && isAdmin()){
    // no filter — Super Admin/Admin see every task in the system
  } else if (!isStaff() || taskTab==='mine') query = query.eq('assigned_to', state.user.id);
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
        <td>${taskStatusControls(t)} ${isSuperAdmin() ? `<button class="btn small outline" data-edit-task="${t.id}">Edit</button>` : ''} ${(isSuperAdmin() || hasPermission('task_delete')) ? `<button class="btn small danger" data-delete-task="${t.id}">Delete</button>` : ''}</td>
      </tr>
      <tr class="task-log-row" data-log-row="${t.id}" style="display:none;"><td colspan="6"><div id="task-log-${t.id}" class="mono" style="font-size:12.5px; padding:10px 0;">Loading…</div></td></tr>`).join('')}</tbody></table>
  ` : emptyState('No tasks here yet.'));

  main.querySelectorAll('.tab').forEach(tb => tb.onclick = () => { taskTab = tb.dataset.tab; renderTasks(); });
  main.querySelectorAll('[data-edit-task]').forEach(btn => {
    btn.onclick = () => openEditTaskModal(tasks.find(t=>t.id===btn.dataset.editTask));
  });
  main.querySelectorAll('[data-delete-task]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Delete this task? It can be restored from Settings → Trash within 48 hours.')) return;
      const { error } = await sb.from('tasks').update({ deleted_at: new Date().toISOString(), deleted_by: state.user.id }).eq('id', btn.dataset.deleteTask);
      if (error){ toast('Could not delete: ' + error.message); return; }
      toast('Task deleted — restorable from Trash for 48 hours'); renderTasks();
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

function openEditTaskModal(task){
  openModal(`
    <h2>Edit task</h2>
    <form id="task-edit-form">
      <div class="form-row"><label>Title</label><input type="text" id="et-title" value="${escapeHtml(task.title)}" required></div>
      <div class="form-row"><label>Details</label><textarea id="et-desc">${escapeHtml(task.description||'')}</textarea></div>
      <div class="form-row"><label>Due date</label><input type="date" id="et-due" value="${task.due_date||''}"></div>
      <button class="btn-primary" type="submit">Save changes</button>
    </form>
  `);
  document.getElementById('task-edit-form').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.from('tasks').update({
      title: document.getElementById('et-title').value.trim(),
      description: document.getElementById('et-desc').value.trim(),
      due_date: document.getElementById('et-due').value || null
    }).eq('id', task.id);
    if (error){ toast('Could not save: ' + error.message); return; }
    closeModal(); toast('Updated'); renderTasks();
  };
}

async function openNewTaskModal(){
  await loadScopedProfiles();
  // Tasks are not for riders. Who you can assign to also depends on your
  // own role: Super Admin/Admin can assign to anyone else on staff;
  // an Area Incharge/Regional POC can only assign to their own Coordinators.
  let assignableRoles;
  if (isAdmin()){
    assignableRoles = ['team_lead','regional_poc','coordinator','inventory_coordinator'];
  } else if (['team_lead','regional_poc'].includes(state.profile.role)){
    assignableRoles = ['coordinator'];
  } else {
    assignableRoles = [];
  }
  const assignable = state.profilesInScope.filter(p => assignableRoles.includes(p.role) && p.status==='active');
  const options = assignable.map(p=>`<option value="${p.id}">${escapeHtml(p.full_name)}${p.employee_id?' — '+escapeHtml(p.employee_id):''} (${escapeHtml(designationLabel(p))})</option>`).join('');
  if (!assignable.length){ toast('No one available for you to assign a task to.'); return; }
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
    .is('deleted_at', null)
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
      if (!confirm('Delete this request? It can be restored from Settings → Trash within 48 hours.')) return;
      const { data, error } = await sb.from('requests').update({ deleted_at: new Date().toISOString(), deleted_by: state.user.id }).eq('id', btn.dataset.deleteRequest).select();
      if (error){ toast('Could not delete: ' + error.message); return; }
      if (!data || !data.length){ toast('Delete was blocked by a permissions rule — nothing was removed. Ask Super Admin to check the request_delete database policy.'); return; }
      toast('Request deleted — restorable from Trash for 48 hours'); renderRequests();
    };
  });
  main.querySelectorAll('[data-edit-request]').forEach(btn => {
    btn.onclick = () => openEditRequestModal(requests.find(r=>r.id===btn.dataset.editRequest));
  });
  main.querySelectorAll('[data-reassign-request]').forEach(btn => {
    btn.onclick = async () => {
      await loadScopedProfiles();
      const staff = state.profilesInScope.filter(p => !['rider'].includes(p.role) && p.status==='active');
      const options = staff.map(p=>`<option value="${p.id}">${escapeHtml(p.full_name)}${p.employee_id?' — '+escapeHtml(p.employee_id):''} (${escapeHtml(designationLabel(p))})</option>`).join('');
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

    // Work out who should handle this. Priority: a specific Super-Admin
    // configured routing rule for this region+category, then a region-wide
    // rule (no category), then the old category-region override, then the
    // category's own default role.
    let targetRole = category?.primary_role;
    if (myRegionId){
      const { data: rules } = await sb.from('request_routing_rules').select('category_id, target_role').eq('region_id', myRegionId);
      const specific = (rules||[]).find(r => r.category_id === categoryId);
      const regionWide = (rules||[]).find(r => !r.category_id);
      if (specific) targetRole = specific.target_role;
      else if (regionWide) targetRole = regionWide.target_role;
      else {
        const { data: override } = await sb.from('category_region_overrides')
          .select('role').eq('category_id', categoryId).eq('region_id', myRegionId).maybeSingle();
        if (override?.role) targetRole = override.role;
      }
    }
    let assignedPocId = null;
    if (targetRole){
      const [{ data: candidates }, { data: allLinksForRole }] = await Promise.all([
        sb.from('profiles').select('id, region_id').eq('role', targetRole).eq('status', 'active'),
        sb.from('profile_regions').select('profile_id, region_id')
      ]);
      const linksByCandidate = new Map();
      (allLinksForRole||[]).forEach(l => { if (!linksByCandidate.has(l.profile_id)) linksByCandidate.set(l.profile_id, []); linksByCandidate.get(l.profile_id).push(l.region_id); });
      const candidateRegionIds = (p) => {
        const links = linksByCandidate.get(p.id);
        if (links && links.length) return links;
        return p.region_id ? [p.region_id] : [];
      };
      const inRegion = (candidates||[]).find(p => myRegionId && candidateRegionIds(p).includes(myRegionId));
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
  const { data: items } = await sb.from('expiry_items').select('*, profiles!rider_id(full_name, phone, employee_id), added_by:profiles!created_by(full_name)').is('deleted_at', null).order('expiry_date');
  if (!items || items.length===0){ main.innerHTML = emptyState('No expiry items tracked yet.'); return; }

  // Group rows that were added together (multi-region/role submissions)
  // into one visual row, instead of one row per region.
  const groups = new Map();
  items.forEach(i => {
    const key = i.group_id || i.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });
  const groupedItems = Array.from(groups.values()).map(rows => {
    const first = rows[0];
    return { rows, first, expiry_date: first.expiry_date, item_type: first.item_type, item_label: first.item_label, added_by: first.added_by };
  }).sort((a,b) => new Date(a.expiry_date) - new Date(b.expiry_date));

  const canRemind = isAdmin() || state.profile.role === 'inventory_coordinator';
  const canEdit = isAdmin() || hasPermission('expiry_edit');
  const canDelete = isAdmin() || hasPermission('expiry_delete');
  const showActionsCol = canRemind || canEdit || canDelete;
  const today = new Date();
  main.innerHTML = `<table><thead><tr><th>Applies to</th><th>Item</th><th>Added by</th><th>Expiry date</th><th>Status</th>${showActionsCol?'<th></th>':''}</tr></thead><tbody>
    ${groupedItems.map(g=>{
      const d = new Date(g.expiry_date);
      const daysLeft = Math.ceil((d-today)/(1000*60*60*24));
      let badge = 'badge active', label='OK';
      if (daysLeft < 0){ badge='badge open'; label='Overdue'; }
      else if (daysLeft <= 30){ badge='badge pending'; label=`Due in ${daysLeft}d`; }
      let appliesTo;
      if (g.rows.length === 1 && g.first.profiles?.full_name){
        appliesTo = escapeHtml(g.first.profiles.full_name) + (g.first.profiles.employee_id ? ` <span class="mono">(${escapeHtml(g.first.profiles.employee_id)})</span>` : '');
      } else {
        const regionNames = g.rows.map(r => state.regions.find(rg=>rg.id===r.region_id)?.name).filter(Boolean);
        const roleLabel = g.first.applies_to_role;
        appliesTo = `${escapeHtml(regionNames.join(', ') || '—')}${roleLabel ? ' · ' + escapeHtml(roleLabel) : ' (whole region)'}${g.rows.length>1 ? ` <span class="mono">(${g.rows.length} regions)</span>` : ''}`;
      }
      const remindPhone = g.rows.length===1 ? g.first.profiles?.phone : null;
      return `<tr>
        <td>${appliesTo}</td>
        <td>${escapeHtml(g.item_type)}${g.item_label?' — '+escapeHtml(g.item_label):''}</td>
        <td>${escapeHtml(g.added_by?.full_name||'—')}</td>
        <td class="mono">${g.expiry_date}</td>
        <td><span class="${badge}">${label}</span></td>
        ${showActionsCol ? `<td style="white-space:nowrap;">
          ${(canRemind && daysLeft<=30 && remindPhone) ? `<button class="btn small outline" data-remind="${g.first.id}" data-remind-phone="${remindPhone}" data-remind-item="${escapeHtml(g.item_type)}">Send Reminder</button>` : ''}
          ${canEdit ? `<button class="btn small outline" data-edit-expiry-group="${g.first.group_id || g.first.id}">Edit</button>` : ''}
          ${canDelete ? `<button class="btn small danger" data-delete-expiry-group="${g.first.group_id || g.first.id}">Delete</button>` : ''}
        </td>` : ''}
      </tr>`;
    }).join('')}
  </tbody></table>`;

  main.querySelectorAll('[data-delete-expiry-group]').forEach(btn => {
    btn.onclick = async () => {
      const key = btn.dataset.deleteExpiryGroup;
      if (!confirm('Delete this expiry item? It can be restored from Settings → Trash within 48 hours.')) return;
      const group = groupedItems.find(g => (g.first.group_id || g.first.id) === key);
      const ids = group.rows.map(r=>r.id);
      const { error } = await sb.from('expiry_items').update({ deleted_at: new Date().toISOString(), deleted_by: state.user.id }).in('id', ids);
      if (error){ toast('Could not delete: ' + error.message); return; }
      toast('Deleted — restorable from Trash for 48 hours'); renderExpiries();
    };
  });
  main.querySelectorAll('[data-edit-expiry-group]').forEach(btn => {
    btn.onclick = () => {
      const key = btn.dataset.editExpiryGroup;
      const group = groupedItems.find(g => (g.first.group_id || g.first.id) === key);
      openEditExpiryModal(group);
    };
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
    <div style="display:flex; align-items:center; justify-content:flex-start; gap:8px; padding:6px 4px; text-align:left;">
      <input type="checkbox" class="e-region-check" value="${r.id}" id="e-region-${r.id}">
      <label for="e-region-${r.id}" style="font-weight:400; margin:0; text-align:left; cursor:pointer;">${escapeHtml(r.name)}</label>
    </div>`).join('');
  const roleChecks = Object.entries(ROLE_LABEL).map(([k,v])=>`
    <div style="display:flex; align-items:center; justify-content:flex-start; gap:8px; padding:6px 4px; text-align:left;">
      <input type="checkbox" class="e-role-check" value="${k}" id="e-role-${k}">
      <label for="e-role-${k}" style="font-weight:400; margin:0; text-align:left; cursor:pointer;">${v}</label>
    </div>`).join('');
  const typeOptions = state.expiryItemTypes.map(t=>`<option value="${t.id}" data-name="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join('');
  openModal(`
    <h2>Track expiry item</h2>
    <p class="hint">Not every item belongs to one rider — leave regions/roles as your only selection for something that applies broadly (e.g. an office agreement). Select more than one region or role if the same item applies to several.</p>
    <form id="expiry-form">
      <div class="form-row">
        <label>Region(s)</label>
        <div style="position:relative;">
          <button type="button" class="btn outline" id="e-region-trigger" style="width:100%; text-align:left; display:flex; justify-content:space-between; align-items:center;">
            <span id="e-region-summary">Select region(s)</span><span>▾</span>
          </button>
          <div id="e-region-panel" style="display:none; position:absolute; z-index:50; top:calc(100% + 4px); left:0; right:0; background:#fff; border:1px solid var(--line); border-radius:8px; max-height:220px; overflow-y:auto; padding:8px; box-shadow:0 8px 20px rgba(0,0,0,0.15);">
            <button type="button" class="btn small outline" id="e-select-all-regions" style="margin-bottom:6px; width:100%;">Select All Regions</button>
            ${regionChecks}
          </div>
        </div>
      </div>
      <div class="form-row">
        <label>Applies to role(s) (optional)</label>
        <div style="position:relative;">
          <button type="button" class="btn outline" id="e-role-trigger" style="width:100%; text-align:left; display:flex; justify-content:space-between; align-items:center;">
            <span id="e-role-summary">Select role(s)</span><span>▾</span>
          </button>
          <div id="e-role-panel" style="display:none; position:absolute; z-index:50; top:calc(100% + 4px); left:0; right:0; background:#fff; border:1px solid var(--line); border-radius:8px; max-height:220px; overflow-y:auto; padding:8px; box-shadow:0 8px 20px rgba(0,0,0,0.15);">
            <button type="button" class="btn small outline" id="e-select-all-roles" style="margin-bottom:6px; width:100%;">Select All Roles</button>
            ${roleChecks}
          </div>
        </div>
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

  // Generic open/close wiring for both dropdowns
  const setupDropdown = (triggerId, panelId) => {
    const trigger = document.getElementById(triggerId);
    const panel = document.getElementById(panelId);
    trigger.onclick = (e) => {
      e.stopPropagation();
      const isOpen = panel.style.display === 'block';
      document.querySelectorAll('#e-region-panel, #e-role-panel').forEach(p => p.style.display = 'none');
      panel.style.display = isOpen ? 'none' : 'block';
    };
  };
  setupDropdown('e-region-trigger', 'e-region-panel');
  setupDropdown('e-role-trigger', 'e-role-panel');
  document.addEventListener('click', (e) => {
    if (!document.getElementById('active-modal')) return;
    if (!e.target.closest('#e-region-panel, #e-region-trigger')) document.getElementById('e-region-panel').style.display = 'none';
    if (!e.target.closest('#e-role-panel, #e-role-trigger')) document.getElementById('e-role-panel').style.display = 'none';
  });

  const updateRegionSummary = () => {
    const checked = state.regions.filter(r => document.getElementById(`e-region-${r.id}`)?.checked);
    document.getElementById('e-region-summary').textContent = checked.length
      ? (checked.length <= 2 ? checked.map(r=>r.name).join(', ') : `${checked.length} regions selected`)
      : 'Select region(s)';
  };
  const updateRoleSummary = () => {
    const checked = Array.from(document.querySelectorAll('.e-role-check:checked'));
    document.getElementById('e-role-summary').textContent = checked.length
      ? (checked.length <= 2 ? checked.map(cb=>ROLE_LABEL[cb.value]).join(', ') : `${checked.length} roles selected`)
      : 'Select role(s)';
  };

  document.getElementById('e-select-all-regions').onclick = () => {
    document.querySelectorAll('.e-region-check').forEach(cb => cb.checked = true);
    updateRiderVisibility(); updateRegionSummary();
  };
  document.getElementById('e-select-all-roles').onclick = () => {
    document.querySelectorAll('.e-role-check').forEach(cb => cb.checked = true);
    updateRoleSummary();
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
  document.querySelectorAll('.e-region-check').forEach(cb => cb.onchange = () => { updateRiderVisibility(); updateRegionSummary(); });
  document.querySelectorAll('.e-role-check').forEach(cb => cb.onchange = updateRoleSummary);
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

    // One row per selected region (roles are stored per-row as a joined
    // label), all sharing a group_id so they display/edit as one item.
    const groupId = (crypto.randomUUID ? crypto.randomUUID() : (Date.now()+'-'+Math.random()));
    const payloads = regionIds.map(regionId => ({
      rider_id: regionId === regionIds[0] ? riderId : null,
      region_id: regionId,
      applies_to_role: roleLabel,
      item_type_id: typeId,
      item_type: typeName,
      item_label: itemLabel,
      expiry_date: expiryDate,
      created_by: state.user.id,
      group_id: groupId
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

function openEditExpiryModal(group){
  if (!group) return;
  const currentRegionIds = new Set(group.rows.map(r=>r.region_id));
  const currentRoles = new Set((group.first.applies_to_role||'').split(',').map(s=>s.trim()).filter(Boolean));
  const regionChecks = state.regions.map(r=>`
    <div style="display:flex; align-items:center; justify-content:flex-start; gap:8px; padding:6px 4px; text-align:left;">
      <input type="checkbox" class="ee-region-check" value="${r.id}" id="ee-region-${r.id}" ${currentRegionIds.has(r.id)?'checked':''}>
      <label for="ee-region-${r.id}" style="font-weight:400; margin:0; text-align:left; cursor:pointer;">${escapeHtml(r.name)}</label>
    </div>`).join('');
  const roleChecks = Object.entries(ROLE_LABEL).map(([k,v])=>`
    <div style="display:flex; align-items:center; justify-content:flex-start; gap:8px; padding:6px 4px; text-align:left;">
      <input type="checkbox" class="ee-role-check" value="${k}" id="ee-role-${k}" ${currentRoles.has(v)?'checked':''}>
      <label for="ee-role-${k}" style="font-weight:400; margin:0; text-align:left; cursor:pointer;">${v}</label>
    </div>`).join('');
  const typeOptions = state.expiryItemTypes.map(t=>`<option value="${t.id}" data-name="${escapeHtml(t.name)}" ${t.id===group.first.item_type_id?'selected':''}>${escapeHtml(t.name)}</option>`).join('');
  openModal(`
    <h2>Edit expiry item</h2>
    <p class="hint">Select/deselect regions or roles as needed — this applies to the whole item.</p>
    <form id="expiry-edit-form">
      <div class="form-row">
        <label>Region(s)</label>
        <div style="max-height:160px; overflow-y:auto; border:1px solid var(--line); border-radius:8px; padding:8px;">${regionChecks}</div>
      </div>
      <div class="form-row">
        <label>Applies to role(s)</label>
        <div style="max-height:160px; overflow-y:auto; border:1px solid var(--line); border-radius:8px; padding:8px;">${roleChecks}</div>
      </div>
      <div class="form-row"><label>Item type</label><select id="ee-type">${typeOptions}</select></div>
      <div class="form-row"><label>Label / notes (optional)</label><input type="text" id="ee-label" value="${escapeHtml(group.item_label||'')}"></div>
      <div class="form-row"><label>Expiry date</label><input type="date" id="ee-date" value="${group.expiry_date}" required></div>
      <button class="btn-primary" type="submit">Save changes</button>
    </form>
  `);
  document.getElementById('expiry-edit-form').onsubmit = async (e) => {
    e.preventDefault();
    const regionIds = Array.from(document.querySelectorAll('.ee-region-check:checked')).map(cb=>cb.value);
    if (!regionIds.length){ toast('Select at least one region'); return; }
    const roles = Array.from(document.querySelectorAll('.ee-role-check:checked')).map(cb=>cb.value);
    const roleLabel = roles.length ? roles.map(r=>ROLE_LABEL[r]).join(', ') : null;
    const typeSelect = document.getElementById('ee-type');
    const typeId = typeSelect.value;
    const typeName = typeSelect.options[typeSelect.selectedIndex]?.dataset.name || group.item_type;
    const itemLabel = document.getElementById('ee-label').value.trim();
    const expiryDate = document.getElementById('ee-date').value;
    const groupId = group.first.group_id || group.first.id;
    // Keep a specific rider tied to this item only when it stays a single region
    const keptRider = (regionIds.length === 1 && group.rows.length === 1) ? group.first.rider_id : null;

    const oldIds = group.rows.map(r=>r.id);
    const { error: delErr } = await sb.from('expiry_items').delete().in('id', oldIds);
    if (delErr){ toast('Could not save: ' + delErr.message); return; }
    const payloads = regionIds.map((regionId, idx) => ({
      rider_id: idx===0 ? keptRider : null,
      region_id: regionId,
      applies_to_role: roleLabel,
      item_type_id: typeId,
      item_type: typeName,
      item_label: itemLabel,
      expiry_date: expiryDate,
      created_by: group.first.created_by || state.user.id,
      group_id: groupId
    }));
    const { error } = await sb.from('expiry_items').insert(payloads);
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
  const canBulkAddTeam = isAdmin() || hasPermission('team_bulk_add');
  if (canBulkAddTeam){
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
        const match = state.profilesInScope.find(p => toE164(p.phone) === toE164(r.phone));
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

  const canBulkApprove = isAdmin() || hasPermission('team_bulk_approve');
  if (pending.length && canBulkApprove){
    html += `<div class="card"><h3>Pending approvals (${pending.length})</h3>
    <div style="margin-bottom:10px;"><button class="btn small" id="bulk-approve-btn" disabled>Approve Selected (<span id="bulk-approve-count">0</span>)</button></div>
    <table><thead><tr><th><input type="checkbox" id="pending-select-all"></th><th>Name</th><th>Designation</th><th>Email</th><th>Phone</th><th></th></tr></thead><tbody>
    ${pending.map(p=>`<tr>
      <td><input type="checkbox" class="pending-select" value="${p.id}"></td>
      <td>${escapeHtml(p.full_name)}</td>
      <td>${escapeHtml(designationLabel(p))}${!p.region_id?' <span class="badge pending" title="No region set">No region</span>':''}</td>
      <td class="mono">${escapeHtml(p.email)}</td><td class="mono">${escapeHtml(toLocalPhone(p.phone)||'—')}</td>
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
        ${members.map(p=>`<tr data-team-row data-search="${escapeHtml((p.full_name+' '+(p.employee_id||'')+' '+ROLE_LABEL[role]+' '+designationLabel(p)+' '+(p.phone||'')).toLowerCase())}">
          <td>${escapeHtml(p.full_name)}${designationTag(p)}</td>
          <td class="mono">${escapeHtml(toLocalPhone(p.phone)||'—')}</td>
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
  main.querySelectorAll('[data-toggle-status]').forEach(btn => {
    btn.onclick = () => {
      const p = state.profilesInScope.find(x=>x.id===btn.dataset.toggleStatus);
      const willDisable = p.status !== 'disabled';
      if (willDisable && p.role !== 'super_admin' && !confirm(`Disable ${p.full_name}'s account? They won't be able to log in until re-enabled.`)) return;
      toggleMemberStatus(btn.dataset.toggleStatus);
    };
  });
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

  if (p.role === 'super_admin' && newStatus === 'disabled'){
    const { count: activeSuperAdmins } = await sb.from('profiles').select('id', {count:'exact', head:true}).eq('role','super_admin').eq('status','active');
    if ((activeSuperAdmins||0) <= 1){
      toast(`Cannot disable ${p.full_name} — they're the only active Super Admin. This would lock everyone out of admin access. Make someone else Super Admin first if this account genuinely needs to be disabled.`);
      return;
    }
    if (!confirm(`⚠️ ${p.full_name} is a Super Admin. Disabling this account removes their admin access immediately. Are you absolutely sure?`)) return;
  }

  const { error } = await sb.from('profiles').update({ status: newStatus }).eq('id', profileId);
  if (error){ toast('Could not update: ' + error.message); return; }

  // Keep Roster in sync: disabling a rider's login should also stop showing
  // them as an active roster entry, and vice versa (previously these two
  // could drift apart — see the Javaid Alam bug report).
  if (p.role === 'rider'){
    if (newStatus === 'disabled'){
      const { error: rosterErr, data: rosterUpdated } = await sb.from('roster_entries').update({
        status: 'removed', removal_reason: 'Login Disabled',
        removal_note: 'Automatically set when this account was disabled from Team.'
      }).eq('rider_id', profileId).neq('status', 'removed').select();
      if (rosterErr){
        toast('Account disabled, but could not update their Roster entry: ' + rosterErr.message + '. Please check Roster manually.');
      } else if (rosterUpdated && rosterUpdated.length){
        toast('Account disabled — their roster entry was also marked removed.');
      } else {
        toast('Account disabled (no active roster entry to update).');
      }
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
    <p class="mono">${escapeHtml(p.full_name)} · ${escapeHtml(toLocalPhone(p.phone)||'')}</p>
    <form id="reset-pw-form">
      <div class="form-row"><label>New temporary password</label><input type="text" id="reset-pw-value" value="Test@123" required></div>
      <p class="hint">They'll be required to set their own password the next time they log in.</p>
      <button class="btn-primary" type="submit">Reset password</button>
    </form>
  `);
  document.getElementById('reset-pw-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!confirm(`Reset ${p.full_name}'s password? They'll need this new password to log in, then will be required to set their own.`)) return;
    const resp = await callEdgeFunction('reset_password', { user_id: profileId, new_password: document.getElementById('reset-pw-value').value });
    if (resp.skipped){ toast('Edge Function not configured yet.'); return; }
    if (resp.error){ toast(resp.error); return; }
    if (resetRequestId){
      await sb.from('password_reset_requests').update({ status:'resolved', resolved_by: state.user.id, resolved_at: new Date().toISOString() }).eq('id', resetRequestId);
    }
    await sb.from('activity_log').insert({ actor_id: state.user.id, action: 'reset password for', entity_type: 'Team Member', entity_label: p.full_name });
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
    <p class="mono">${escapeHtml(p.full_name)} · ${escapeHtml(p.email||toLocalPhone(p.phone)||'')}</p>
    <form id="approve-form">
      ${canEditCredentials ? `
      <div class="two-col">
        <div class="form-row"><label>Full name</label><input type="text" id="ap-name" value="${escapeHtml(p.full_name||'')}"></div>
        <div class="form-row"><label>Employee ID</label><input type="text" id="ap-empid" value="${escapeHtml(p.employee_id||'')}"></div>
      </div>
      <div class="two-col">
        <div class="form-row"><label>Mobile number</label><input type="text" id="ap-phone" value="${escapeHtml(toLocalPhone(p.phone)||'')}" maxlength="11" placeholder="03XXXXXXXXX"></div>
        <div class="form-row"><label>Email (optional)</label><input type="email" id="ap-email" value="${escapeHtml(p.email||'')}"></div>
      </div>` : ''}
      <div class="form-row"><label>Role</label><select id="ap-role">${roleOptions}</select></div>
      <div class="form-row" id="ap-designation-row" style="display:none;"><label>Designation (title shown to everyone)</label><select id="ap-designation"></select></div>
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

  // Designation choices depend on the selected Role. The role's own name is the default.
  const fillDesignationOptions = (roleKey) => {
    const row = document.getElementById('ap-designation-row');
    const sel = document.getElementById('ap-designation');
    const roleName = (ROLE_LABEL[roleKey]||'').toLowerCase();
    const extras = (state.designations||[]).filter(d =>
      d.base_role === roleKey && d.name.trim().toLowerCase() !== roleName && (d.active || d.id === p.designation_id));
    if (!extras.length){ row.style.display = 'none'; sel.innerHTML = ''; return; }
    sel.innerHTML = `<option value="">${escapeHtml(ROLE_LABEL[roleKey])} (default)</option>` +
      extras.map(d => `<option value="${d.id}" ${p.designation_id===d.id?'selected':''}>${escapeHtml(d.name)}${d.active?'':' (disabled)'}</option>`).join('');
    row.style.display = 'block';
  };
  fillDesignationOptions(p.role);
  document.getElementById('ap-role').addEventListener('change', (e) => fillDesignationOptions(e.target.value));

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
    if (!confirm('Save these changes to this team member\'s account?')) return;
    const role = document.getElementById('ap-role').value;
    const status = document.getElementById('ap-status').value;
    const isMulti = ['regional_poc','team_lead','coordinator','inventory_coordinator'].includes(role);
    const checked = isMulti ? Array.from(document.querySelectorAll('.ap-region-check:checked')).map(cb=>cb.value) : [];
    // For multi-region roles, region_id is just a convenience fallback — set it to
    // the first checked region (never the stale hidden single-select value).
    const regionIdToSave = isMulti ? (checked[0] || null) : (document.getElementById('ap-region').value || null);

    const payload = { role, status, region_id: regionIdToSave };
    // Only touch designation_id once the designations feature exists (migration_25 run).
    if (state.designations.length) payload.designation_id = document.getElementById('ap-designation').value || null;
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
  const { data: rosterCounts } = await sb.from('roster_entries').select('region_id, status, replacement_pending');
  const countsByRegion = {};
  (rosterCounts||[]).forEach(e => {
    if (!countsByRegion[e.region_id]) countsByRegion[e.region_id] = { working:0, replacement:0 };
    if (e.status !== 'removed') countsByRegion[e.region_id].working++;
    if (e.status === 'removed' && e.replacement_pending) countsByRegion[e.region_id].replacement++;
  });

  main.innerHTML = `<table><thead><tr><th>Region</th><th>Sub-Regions / Cities</th><th>Approved</th><th>Working</th><th>Replacement Needed</th><th>Status</th>${(canEdit||canRemove)?'<th></th>':''}</tr></thead><tbody>
    ${(allRegions||[]).map(r=>{
      const subs = subsByRegion[r.id] || [];
      const counts = countsByRegion[r.id] || { working:0, replacement:0 };
      return `<tr>
      <td>${escapeHtml(r.name)}</td>
      <td>${subs.length
        ? `<select style="max-width:220px;"><option>${subs.length} sub-region${subs.length>1?'s':''} ▾</option>${subs.map(s=>`<option disabled>${escapeHtml(s.name)}</option>`).join('')}</select>`
        : `<span class="mono" style="color:var(--muted);">None yet</span>`}</td>
      <td class="mono">${r.approved_headcount ?? '—'}</td>
      <td class="mono">${counts.working}</td>
      <td class="mono">${counts.replacement || '—'}</td>
      <td><span class="badge ${r.active!==false?'active':'closed'}">${r.active!==false?'Active':'Deactivated'}</span></td>
      ${(canEdit||canRemove) ? `<td style="white-space:nowrap;">
        ${canEdit ? `<button class="btn small outline" data-edit-region="${r.id}">Edit</button>` : ''}
        ${canRemove ? `<button class="btn small outline" data-toggle-region="${r.id}" data-active="${r.active!==false}">${r.active!==false?'Deactivate':'Reactivate'}</button>` : ''}
      </td>` : ''}
    </tr>`;
    }).join('')}
  </tbody></table>
  <p class="hint" style="margin-top:12px;">To add or rename sub-regions/cities, go to Settings → Sub-Regions / Cities. To set the Approved headcount, click Edit on a region.</p>`;

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
    if (!confirm('Save these region changes?')) return;
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
      ['requestrouting','Request Auto-Routing', () => isSuperAdmin()],
    ]},
    { label: 'Types & Categories', items: [
      ['warningtypes','Warning Types', () => isAdmin() || hasPermission('manage_types')],
      ['expirytypes','Expiry Item Types', () => isAdmin() || hasPermission('manage_types')],
      ['tooltypes','Tool Types', () => isAdmin() || hasPermission('manage_types')],
      ['compliancetypes','Compliance Items', () => isAdmin() || hasPermission('manage_types')],
      ['shifttypes','Shift Types', () => isAdmin() || hasPermission('manage_types')],
    ]},
    { label: 'People', items: [
      ['designations','Designations', () => isSuperAdmin()],
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
      ['trash','Trash (restore deleted items)', () => isSuperAdmin()],
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
  else if (settingsTab === 'designations') await renderDesignationsSettings(body);
  else if (settingsTab === 'subregions') await renderSubRegionsSettings(body);
  else if (settingsTab === 'hotspots') await renderHotspotsSettings(body);
  else if (settingsTab === 'shifttypes') await renderSimpleTypeList(body, 'shift_types', 'Shift');
  else if (settingsTab === 'circularcategories') await renderSimpleTypeList(body, 'circular_categories', 'Circular Category');
  else if (settingsTab === 'requestrouting') await renderRequestRoutingSettings(body);
  else if (settingsTab === 'notice') await renderHomeNoticeSettings(body);
  else if (settingsTab === 'branding') await renderBrandingSettings(body);
  else if (settingsTab === 'homebanner') await renderHomeBannerSettings(body);
  else if (settingsTab === 'popups') await renderPopupsSettings(body);
  else if (settingsTab === 'permissions') await renderPermissionsSettings(body);
  else if (settingsTab === 'storage') await renderStorageSettings(body);
  else if (settingsTab === 'trash') await renderTrashSettings(body);
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
    ${brandingImageRow('favicon', 'Browser tab icon (favicon)', b.favicon_url)}
    <p class="hint">For the favicon, use a small square image (ideally just an icon mark, no text) — it's shown at a tiny size in browser tabs, so anything with fine detail or text won't read clearly.</p>
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

  ['logo','sidebar_bg','login_bg','favicon'].forEach(key => {
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
  <table><thead><tr><th>Message</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>
    ${(notices||[]).map(n=>{
      const expired = n.expires_at && new Date(n.expires_at) < new Date();
      return `<tr>
      <td>${escapeHtml(n.message)}</td>
      <td class="mono">${n.expires_at ? formatDate(n.expires_at) : 'No expiry'}</td>
      <td><span class="badge ${(n.active && !expired)?'active':'closed'}">${expired ? 'Expired' : (n.active?'Active':'Inactive')}</span></td>
      <td>
        <button class="btn small outline" data-toggle-notice="${n.id}" data-active="${n.active}">${n.active?'Disable':'Enable'}</button>
        <button class="btn small outline" data-delete-notice="${n.id}">Remove</button>
      </td>
    </tr>`;
    }).join('')}
  </tbody></table>`;
  document.getElementById('new-notice-btn').onclick = () => {
    openModal(`
      <h2>New Home Notice</h2>
      <form id="notice-form">
        <div class="form-row"><label>Message</label><textarea id="hn-message" required placeholder="Highlighted on everyone's Dashboard"></textarea></div>
        <div class="form-row"><label>Auto-disable on (optional)</label><input type="date" id="hn-expiry"></div>
        <button class="btn-primary" type="submit">Add Notice</button>
      </form>
    `);
    document.getElementById('notice-form').onsubmit = async (e) => {
      e.preventDefault();
      const message = document.getElementById('hn-message').value.trim();
      const expiresAt = document.getElementById('hn-expiry').value || null;
      const { error } = await sb.from('home_notices').insert({ message, expires_at: expiresAt, created_by: state.user.id });
      if (error){ toast('Could not add: ' + error.message); return; }
      closeModal(); toast('Notice added'); renderSettings();
    };
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
  const targetOptions = targets.map(p=>`<option value="${p.id}" ${p.id===w.rider_id?'selected':''}>${escapeHtml(p.full_name)}${p.employee_id?' — '+escapeHtml(p.employee_id):''} (${escapeHtml(designationLabel(p))})</option>`).join('');
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
    if (!confirm('Record this warning? It will be visible to the person and Super Admin.')) return;
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
  let circularsQuery = sb.from('circulars').select('id, title, body, created_at').eq('push_to_kb', true).is('deleted_at', null).order('created_at', {ascending:false});
  let articlesQuery = sb.from('knowledge_base_articles').select('*, profiles(full_name)').order('created_at', {ascending:false});
  // Full Knowledge Base history is available to everyone regardless of when
  // they joined (previously new members only saw items from their join
  // date onward — removed per explicit request).
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
      <table><thead><tr><th>Rider</th><th>Employee ID</th><th>Region</th>${state.complianceItemTypes.map(t=>`<th>${escapeHtml(t.name)}</th>`).join('')}</tr></thead><tbody>
      ${riders.map(r => `<tr>
        <td>${escapeHtml(r.full_name)}</td>
        <td class="mono">${escapeHtml(r.employee_id||'—')}</td>
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
          ${isAdmin() ? `
          <option value="requests">Requests (with TAT)</option>
          <option value="tasks">Tasks</option>
          <option value="circulars">Circulars &amp; Acknowledgments</option>
          <option value="expiry">Expiry Items</option>
          <option value="warnings">Warnings</option>` : ''}
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
  let queryError = null;
  if (type === 'requests'){
    const { data, error } = await sb.from('requests')
      .select('*, rider:profiles!rider_id(full_name, employee_id), poc:profiles!assigned_poc_id(full_name), categories(name, tat_hours)')
      .gte('created_at', from).lte('created_at', to);
    queryError = error;
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
    const { data, error } = await sb.from('tasks')
      .select('*, assignee:profiles!assigned_to(full_name, employee_id), assigner:profiles!assigned_by(full_name, employee_id)')
      .gte('created_at', from).lte('created_at', to);
    queryError = error;
    rows = (data||[]).map(t => ({
      Title: t.title, 'Assigned To': t.assignee?.full_name, 'Assigned By': t.assigner?.full_name,
      Status: t.status, 'Due Date': t.due_date||'', 'Created At': t.created_at
    }));
  } else if (type === 'circulars'){
    const { data, error } = await sb.from('circulars').select('*, profiles!created_by(full_name)').gte('created_at', from).lte('created_at', to);
    queryError = error;
    for (const c of (data||[])){
      const audience = await countAudience(c.target_region_id, c.target_role, c.created_by, c.target_region_ids, c.target_roles);
      const { count: ackCount } = await sb.from('circular_acks').select('id',{count:'exact',head:true}).eq('circular_id', c.id).neq('user_id', c.created_by);
      rows.push({ Title: c.title, 'Posted By': c.profiles?.full_name, 'Posted At': c.created_at, Audience: audience, Acknowledged: ackCount ?? 0, Pending: audience - (ackCount??0) });
    }
  } else if (type === 'expiry'){
    const { data, error } = await sb.from('expiry_items').select('*, profiles(full_name)').gte('created_at', from).lte('created_at', to);
    queryError = error;
    rows = (data||[]).map(i => ({ Rider: i.profiles?.full_name, Item: i.item_type, Label: i.item_label||'', 'Expiry Date': i.expiry_date, 'Added At': i.created_at }));
  } else if (type === 'warnings'){
    const { data, error } = await sb.from('disciplinary_actions').select('*, rider:profiles!rider_id(full_name, employee_id), recorder:profiles!recorded_by(full_name)').gte('created_at', from).lte('created_at', to);
    queryError = error;
    rows = (data||[]).map(w => ({ Rider: w.rider?.full_name, 'Employee ID': w.rider?.employee_id, Type: w.action_type, Description: w.description, 'Recorded By': w.recorder?.full_name, 'Created At': w.created_at }));
  } else if (type === 'active_employees'){
    // No date range applies here — this is a current snapshot, not filtered by when someone joined.
    const { data, error } = await sb.from('profiles').select('*, regions!region_id(name)').eq('status', 'active').order('full_name');
    queryError = error;
    rows = (data||[]).map(p => ({
      'Full Name': p.full_name, 'Employee ID': p.employee_id||'', Role: designationLabel(p),
      'Mobile Number': toLocalPhone(p.phone)||'', Email: p.email||'', Region: p.regions?.name||'', 'Bike Number': p.bike_number||'',
      'Joined On': p.created_at ? p.created_at.slice(0,10) : ''
    }));
  }

  if (queryError){ statusEl.textContent = 'Could not generate: ' + queryError.message; return; }
  if (!rows.length){
    statusEl.textContent = type === 'active_employees' ? 'No active employees found.' : 'No records found for that date range.';
    return;
  }
  downloadCSV(`fieldhub-${type}-${from}-to-${to.slice(0,10)}.csv`, toCSV(rows));
  statusEl.textContent = `Downloaded ${rows.length} rows.`;
}

async function renderDesignationsSettings(body){
  if (!isSuperAdmin()){ body.innerHTML = '<p class="hint">Only Super Admin can manage designations.</p>'; return; }
  const { data: desigs, error } = await sb.from('designations').select('*').order('sort_order').order('name');
  if (error){
    body.innerHTML = `<p class="hint">Could not load designations: ${escapeHtml(error.message)}. Please make sure <strong>migration_25.sql</strong> has been run in Supabase.</p>`;
    return;
  }
  // approved_headcount exists only after migration_26.sql has been run
  const hasHC = (desigs||[]).length > 0 && ('approved_headcount' in desigs[0]);
  // People counts. Everyone is counted exactly once, in ONE bucket:
  // Pending -> Pending; otherwise if their latest Roster entry is Resigned/Terminated/
  // Transferred -> that bucket; otherwise Active (login on) or Disabled/Other.
  const [{ data: allProfiles }, { data: allRoster }] = await Promise.all([
    sb.from('profiles').select('id, role, status, designation_id').limit(5000),
    sb.from('roster_entries').select('rider_id, status, removal_reason, created_at').order('created_at', {ascending:false}).limit(5000)
  ]);
  const latestRoster = new Map();
  (allRoster||[]).forEach(r => { if (!latestRoster.has(r.rider_id)) latestRoster.set(r.rider_id, r); });
  const bucketOf = (p) => {
    if (p.status === 'pending') return 'pending';
    const r = latestRoster.get(p.id);
    if (r && r.status === 'removed'){
      const k = (r.removal_reason||'').toLowerCase();
      if (k.startsWith('resign')) return 'resigned';
      if (k.startsWith('terminat')) return 'terminated';
      if (k.startsWith('transfer')) return 'transferred';
      return 'disabled';
    }
    return p.status === 'active' ? 'active' : 'disabled';
  };
  // People who never picked a designation count under the designation named after their role
  const defaultDesigForRole = {};
  desigs.forEach(d => {
    if (d.name.trim().toLowerCase() === (ROLE_LABEL[d.base_role]||'').toLowerCase() && !defaultDesigForRole[d.base_role]) defaultDesigForRole[d.base_role] = d.id;
  });
  const rowKeyOf = (p) => {
    const d = desigs.find(x => x.id === p.designation_id);
    if (d && d.base_role === p.role) return d.id;
    return defaultDesigForRole[p.role] || ('role:' + p.role);
  };
  const emptyRow = () => ({ total:0, active:0, pending:0, disabled:0, resigned:0, terminated:0, transferred:0 });
  const rowStats = {};
  const counts = {};   // people who explicitly have this designation saved (used to lock role / block delete)
  const grandStats = emptyRow();
  (allProfiles||[]).forEach(p => {
    const key = rowKeyOf(p);
    if (!rowStats[key]) rowStats[key] = emptyRow();
    const b = bucketOf(p);
    rowStats[key].total++; rowStats[key][b]++;
    grandStats.total++; grandStats[b]++;
    if (p.designation_id) counts[p.designation_id] = (counts[p.designation_id]||0) + 1;
  });
  const extraRoleKeys = Object.keys(rowStats).filter(k => k.startsWith('role:'));
  const statCells = (s) => `<td class="mono"><strong>${s.total}</strong></td><td class="mono">${s.active}</td><td class="mono">${s.pending}</td><td class="mono">${s.disabled}</td><td class="mono">${s.resigned}</td><td class="mono">${s.terminated}</td><td class="mono">${s.transferred}</td>`;

  const roleOptionsHtml = (sel) => DESIGNATION_BASE_ROLES.map(r => `<option value="${r}" ${sel===r?'selected':''}>${ROLE_LABEL[r]}</option>`).join('');
  body.innerHTML = `
    <p class="hint" style="margin-bottom:14px;">A designation is the job title people choose at sign-up and see across the portal (e.g. <em>Trainee Rider</em>). Each one <strong>works like</strong> one of the existing roles — that decides its permissions, menus and access, so a Trainee Rider can do exactly what a Rider can. <strong>Disable</strong> hides a designation from new sign-ups without affecting people who already have it. <strong>Delete</strong> is only possible when nobody is counted under it.</p>
    <form id="new-desig-form" style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;">
      <input type="text" id="desig-name" placeholder="Designation name, e.g. Trainee Rider" required style="flex:1; min-width:200px; padding:8px 10px; border:1px solid var(--line); border-radius:7px;">
      <select id="desig-role" title="Works like">${roleOptionsHtml('rider')}</select>
      ${hasHC ? `<input type="number" min="0" step="1" id="desig-hc" placeholder="Approved headcount (optional)" style="width:210px; padding:8px 10px; border:1px solid var(--line); border-radius:7px;">` : ''}
      <button class="btn small" type="submit">Add</button>
    </form>
    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; margin-bottom:16px;">
      <div class="card stat-card sky" style="padding:12px;"><div class="stat-number">${grandStats.total}</div><div class="stat-label" style="font-size:12px;">Total People</div></div>
      <div class="card stat-card clay" style="padding:12px;"><div class="stat-number">${grandStats.active}</div><div class="stat-label" style="font-size:12px;">Active</div></div>
      <div class="card stat-card amber" style="padding:12px;"><div class="stat-number">${grandStats.pending}</div><div class="stat-label" style="font-size:12px;">Pending Approval</div></div>
      <div class="card stat-card amber" style="padding:12px;"><div class="stat-number">${grandStats.resigned}</div><div class="stat-label" style="font-size:12px;">Resigned</div></div>
      <div class="card stat-card amber" style="padding:12px;"><div class="stat-number">${grandStats.terminated}</div><div class="stat-label" style="font-size:12px;">Terminated</div></div>
      <div class="card stat-card amber" style="padding:12px;"><div class="stat-number">${grandStats.transferred}</div><div class="stat-label" style="font-size:12px;">Transferred</div></div>
      <div class="card stat-card amber" style="padding:12px;"><div class="stat-number">${grandStats.disabled}</div><div class="stat-label" style="font-size:12px;">Disabled / Other</div></div>
    </div>
    <div style="overflow-x:auto;"><table><thead><tr><th>Designation</th><th>Works like</th><th>Approved Headcount</th><th>People</th><th>Active</th><th>Pending</th><th>Disabled / Other</th><th>Resigned</th><th>Terminated</th><th>Transferred</th><th>Status</th><th></th></tr></thead><tbody>
      ${(desigs||[]).map(d => `<tr>
        <td><strong>${escapeHtml(d.name)}</strong></td>
        <td>${ROLE_LABEL[d.base_role]||d.base_role}</td>
        <td class="mono">${d.approved_headcount ?? '—'}</td>
        ${statCells(rowStats[d.id] || emptyRow())}
        <td><span class="badge ${d.active?'active':'closed'}">${d.active?'Active':'Disabled'}</span></td>
        <td style="white-space:nowrap;">
          <button class="btn small outline" data-edit-desig="${d.id}">Edit</button>
          <button class="btn small outline" data-toggle-desig="${d.id}">${d.active?'Disable':'Enable'}</button>
          <button class="btn small danger" data-delete-desig="${d.id}">Delete</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="12">No designations yet.</td></tr>'}
      ${extraRoleKeys.map(k => `<tr style="color:var(--muted);">
        <td>${escapeHtml(ROLE_LABEL[k.slice(5)]||k.slice(5))}</td><td>${escapeHtml(ROLE_LABEL[k.slice(5)]||k.slice(5))}</td><td class="mono">—</td>
        ${statCells(rowStats[k])}<td colspan="2"><span class="hint">Role only (no designation)</span></td>
      </tr>`).join('')}
      <tr style="font-weight:700; border-top:2px solid var(--line);"><td>Grand Total</td><td></td><td></td>${statCells(grandStats)}<td colspan="2"></td></tr>
    </tbody></table></div>
    ${hasHC ? '' : '<p class="hint" style="margin-top:10px;">To track an approved headcount per designation, run <strong>migration_26.sql</strong> in Supabase.</p>'}
    <p class="hint" style="margin-top:10px;">Each person is counted once. <strong>Resigned / Terminated / Transferred</strong> come from their latest Roster entry; <strong>Disabled / Other</strong> are people whose login is off for any other reason. People who never chose a designation are counted under the designation named after their role (e.g. Rider).</p>`;

  const refresh = async () => { await loadDesignations(); renderSettings(); };
  const friendly = (err, verb) => (err.code === '23505')
    ? 'A designation with that name already exists.'
    : `Could not ${verb}: ${err.message}`;

  document.getElementById('new-desig-form').onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('desig-name').value.trim().replace(/\s+/g, ' ');
    if (!name) return;
    const addPayload = { name, base_role: document.getElementById('desig-role').value };
    const hcEl = document.getElementById('desig-hc');
    if (hcEl && hcEl.value !== ''){
      const n = Number(hcEl.value);
      if (!Number.isInteger(n) || n < 0){ toast('Approved headcount must be a whole number (0 or more).'); return; }
      addPayload.approved_headcount = n;
    }
    const { error: err } = await sb.from('designations').insert(addPayload);
    if (err){ toast(friendly(err, 'add')); return; }
    toast('Designation added'); await refresh();
  };

  body.querySelectorAll('[data-edit-desig]').forEach(btn => btn.onclick = () => {
    const d = desigs.find(x => x.id === btn.dataset.editDesig);
    const inUse = (counts[d.id]||0) > 0;
    openModal(`
      <h2>Edit designation</h2>
      <form id="edit-desig-form">
        <div class="form-row"><label>Name</label><input type="text" id="ed-name" value="${escapeHtml(d.name)}" required></div>
        <div class="form-row"><label>Works like</label>
          <select id="ed-role" ${inUse?'disabled':''}>${roleOptionsHtml(d.base_role)}</select>
          ${inUse ? `<span class="field-hint">Locked because ${counts[d.id]} ${counts[d.id]===1?'person uses':'people use'} this designation. Create a new designation if you need a different role.</span>` : ''}
        </div>
        ${hasHC ? `<div class="form-row"><label>Approved headcount (optional)</label><input type="number" min="0" step="1" id="ed-hc" value="${d.approved_headcount ?? ''}"><span class="field-hint">Total approved positions for this designation across all regions — used for "Pending Hiring" in Roster. Leave blank if not tracked.</span></div>` : ''}
        <button class="btn-primary" type="submit">Save</button>
      </form>`);
    document.getElementById('edit-desig-form').onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById('ed-name').value.trim().replace(/\s+/g, ' ');
      if (!name) return;
      const payload = { name };
      if (!inUse) payload.base_role = document.getElementById('ed-role').value;
      const edHc = document.getElementById('ed-hc');
      if (edHc){
        if (edHc.value === '') payload.approved_headcount = null;
        else {
          const n = Number(edHc.value);
          if (!Number.isInteger(n) || n < 0){ toast('Approved headcount must be a whole number (0 or more).'); return; }
          payload.approved_headcount = n;
        }
      }
      const { error: err } = await sb.from('designations').update(payload).eq('id', d.id);
      if (err){ toast(friendly(err, 'save')); return; }
      closeModal(); toast('Saved'); await refresh();
    };
  });

  body.querySelectorAll('[data-toggle-desig]').forEach(btn => btn.onclick = async () => {
    const d = desigs.find(x => x.id === btn.dataset.toggleDesig);
    const { error: err } = await sb.from('designations').update({ active: !d.active }).eq('id', d.id);
    if (err){ toast(friendly(err, 'update')); return; }
    toast(d.active ? 'Disabled — hidden from new sign-ups' : 'Enabled'); await refresh();
  });

  body.querySelectorAll('[data-delete-desig]').forEach(btn => btn.onclick = async () => {
    const d = desigs.find(x => x.id === btn.dataset.deleteDesig);
    const inUseCount = Math.max(counts[d.id]||0, (rowStats[d.id]||{}).total||0);
    if (inUseCount > 0){
      toast(`Cannot delete "${d.name}" — ${inUseCount} ${inUseCount===1?'person is':'people are'} using it. Disable it instead, or change those people's designation first.`);
      return;
    }
    if (!confirm(`Permanently delete the designation "${d.name}"? This cannot be undone.`)) return;
    const { error: err } = await sb.from('designations').delete().eq('id', d.id);
    if (err){ toast(friendly(err, 'delete')); return; }
    toast('Deleted'); await refresh();
  });
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
      const cleanParts = line.split(/\t|,/).map(p=>p.trim());
      let regionName, subRegionName, hotspotName;
      if (cleanParts.length >= 3){
        [regionName, subRegionName, hotspotName] = cleanParts;
      } else {
        // No sub-region given — just Region, Hotspot name
        [regionName, hotspotName] = cleanParts;
        subRegionName = '';
      }
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
  ['tool_bulk_update', 'Bulk-update Tool records'],
  ['roster_bulk_add', 'Roster — Bulk Add'],
  ['roster_bulk_update', 'Roster — Bulk Update'],
  ['team_bulk_add', 'Team — Bulk Add Riders'],
  ['team_bulk_approve', 'Team — Bulk Approve pending members'],
  ['hotspot_bulk_add', 'Hotspots — Bulk Add'],
  ['field_visit_manage', 'Field Visit Reports — Manager rights (manage checklist & KPIs, correct any visit, see all teams)']
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
async function renderRequestRoutingSettings(body){
  const { data: rules } = await sb.from('request_routing_rules').select('*, regions(name), categories(name)').order('created_at');
  const regionOptions = state.regions.map(r=>`<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  const categoryOptions = `<option value="">— All categories in this region —</option>` + state.categories.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  const roleOptions = Object.entries(ROLE_LABEL).filter(([k])=>k!=='rider').map(([k,v])=>`<option value="${k}">${v}</option>`).join('');

  body.innerHTML = `
    <p class="hint" style="margin-bottom:14px;">Decide who automatically receives a new request based on the rider's region (and optionally the category). A rule with no category applies to every category in that region unless a more specific rule exists. If no rule matches, the request category's own default role is used instead.</p>
    <form id="routing-form" style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;">
      <select id="rr-region" required>${regionOptions}</select>
      <select id="rr-category">${categoryOptions}</select>
      <select id="rr-role" required>${roleOptions}</select>
      <button class="btn small" type="submit">Add Rule</button>
    </form>
    <table><thead><tr><th>Region</th><th>Category</th><th>Auto-assigned to</th><th></th></tr></thead><tbody>
      ${(rules||[]).map(r=>`<tr>
        <td>${escapeHtml(r.regions?.name||'—')}</td>
        <td>${r.categories?.name ? escapeHtml(r.categories.name) : '<em>All categories</em>'}</td>
        <td>${ROLE_LABEL[r.target_role]||r.target_role}</td>
        <td><button class="btn small outline" data-delete-rule="${r.id}">Remove</button></td>
      </tr>`).join('') || `<tr><td colspan="4">${emptyState('No rules yet — requests fall back to each category\'s default role.')}</td></tr>`}
    </tbody></table>`;

  document.getElementById('routing-form').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.from('request_routing_rules').insert({
      region_id: document.getElementById('rr-region').value,
      category_id: document.getElementById('rr-category').value || null,
      target_role: document.getElementById('rr-role').value
    });
    if (error){ toast('Could not add: ' + error.message); return; }
    toast('Rule added'); renderSettings();
  };
  body.querySelectorAll('[data-delete-rule]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Remove this routing rule?')) return;
      await sb.from('request_routing_rules').delete().eq('id', btn.dataset.deleteRule);
      renderSettings();
    };
  });
}

async function renderTrashSettings(body){
  body.innerHTML = `<div class="mono">Loading…</div>`;
  const cutoff = new Date(Date.now() - 48*60*60*1000).toISOString();

  const [reqRes, taskRes, circRes, expRes] = await Promise.all([
    sb.from('requests').select('*, rider:profiles!rider_id(full_name), deleter:profiles!deleted_by(full_name)').not('deleted_at','is',null).order('deleted_at',{ascending:false}),
    sb.from('tasks').select('*, deleter:profiles!deleted_by(full_name)').not('deleted_at','is',null).order('deleted_at',{ascending:false}),
    sb.from('circulars').select('*, deleter:profiles!deleted_by(full_name)').not('deleted_at','is',null).order('deleted_at',{ascending:false}),
    sb.from('expiry_items').select('*, deleter:profiles!deleted_by(full_name)').not('deleted_at','is',null).order('deleted_at',{ascending:false})
  ]);

  const rows = [
    ...(reqRes.data||[]).map(r => ({ table:'requests', id:r.id, label:`Request: ${r.category} (${r.rider?.full_name||'—'})`, deleted_at:r.deleted_at, deleter:r.deleter?.full_name })),
    ...(taskRes.data||[]).map(t => ({ table:'tasks', id:t.id, label:`Task: ${t.title}`, deleted_at:t.deleted_at, deleter:t.deleter?.full_name })),
    ...(circRes.data||[]).map(c => ({ table:'circulars', id:c.id, label:`Circular: ${c.title}`, deleted_at:c.deleted_at, deleter:c.deleter?.full_name })),
    ...(expRes.data||[]).map(e => ({ table:'expiry_items', id:e.id, label:`Expiry Item: ${e.item_type}${e.item_label?' — '+e.item_label:''}`, deleted_at:e.deleted_at, deleter:e.deleter?.full_name }))
  ].sort((a,b) => new Date(b.deleted_at) - new Date(a.deleted_at));

  const withinWindow = rows.filter(r => r.deleted_at >= cutoff);
  const expired = rows.filter(r => r.deleted_at < cutoff);

  const renderRow = (r, restorable) => `<tr>
    <td>${escapeHtml(r.label)}</td>
    <td class="mono">${formatDateTime(r.deleted_at)}</td>
    <td>${escapeHtml(r.deleter||'—')}</td>
    <td>${restorable ? `<button class="btn small outline" data-restore="${r.table}|${r.id}">Restore</button>` : '<span class="mono" style="color:var(--muted);">Restore window passed</span>'}</td>
  </tr>`;

  body.innerHTML = `
    <p class="hint" style="margin-bottom:14px;">Deleted Requests, Tasks, Circulars, and Expiry items land here and can be restored within 48 hours. After that, they're no longer restorable through this page (the records still exist in the database, but this UI stops offering a one-click undo).</p>
    <h3>Restorable now (${withinWindow.length})</h3>
    ${withinWindow.length ? `<table><thead><tr><th>Item</th><th>Deleted at</th><th>Deleted by</th><th></th></tr></thead><tbody>${withinWindow.map(r=>renderRow(r,true)).join('')}</tbody></table>` : emptyState('Nothing in the restorable window right now.')}
    ${expired.length ? `<h3 style="margin-top:20px;">Past 48 hours (${expired.length})</h3>
    <table><thead><tr><th>Item</th><th>Deleted at</th><th>Deleted by</th><th></th></tr></thead><tbody>${expired.slice(0,50).map(r=>renderRow(r,false)).join('')}</tbody></table>` : ''}
  `;

  body.querySelectorAll('[data-restore]').forEach(btn => {
    btn.onclick = async () => {
      const [table, id] = btn.dataset.restore.split('|');
      const { error } = await sb.from(table).update({ deleted_at: null, deleted_by: null }).eq('id', id);
      if (error){ toast('Could not restore: ' + error.message); return; }
      toast('Restored'); renderSettings();
    };
  });
}

const TABLE_FRIENDLY_NAMES = {
  profiles: "Every Team member & rider's profile",
  circulars: "Circulars (announcements)",
  circular_acks: "Who's acknowledged each circular",
  circular_categories: "Circular category tags",
  requests: "Rider requests",
  request_updates: "Status-change history on requests",
  request_routing_rules: "Auto-routing rules for requests",
  tasks: "Internal tasks",
  task_updates: "Status-change history on tasks",
  categories: "Request Categories (Settings)",
  category_region_overrides: "Per-region request routing overrides",
  roster_entries: "Roster (who's working where)",
  shift_types: "Shift Types (Settings)",
  expiry_items: "Expiry Tracker entries",
  expiry_item_types: "Expiry Item Types (Settings)",
  tool_types: "Tool Types (Settings)",
  tool_issuances: "Tool Issuance records",
  tool_issuance_acks: "Rider receipt confirmations for tools",
  disciplinary_actions: "Warnings issued",
  warning_types: "Warning Types (Settings)",
  compliance_submissions: "Compliance Tracker 'received' marks",
  compliance_item_types: "Compliance Items (Settings)",
  regions: "Regions",
  sub_regions: "Sub-Regions / Cities",
  hotspots: "Hotspots (Settings)",
  profile_regions: "Multi-region assignments for staff",
  custom_permissions: "Who's been granted which extra permission",
  activity_log: "Activity Log (audit trail)",
  knowledge_base_articles: "Knowledge Base articles",
  resource_links: "Resource Links",
  release_notes: "What's New posts",
  home_notices: "Dashboard notice banner",
  home_banner: "Dashboard picture banner",
  popup_announcements: "Pop-up announcements",
  popup_dismissals: "Who's dismissed which pop-up",
  password_reset_requests: "Pending 'Forgot Password' requests",
  system_settings: "Portal-wide settings (word limits, etc.) — always tiny",
  branding_settings: "Logo / background / favicon settings",
  users: "Supabase's internal login accounts list (not your own data)",
  refresh_tokens: "Not passwords — small internal tokens that keep people signed in without re-entering their password. Pure technical housekeeping.",
  sessions: "A record of who's currently logged in and from where. Internal housekeeping, not something you manage directly.",
  identities: "Internal Supabase Auth housekeeping — not FieldHub data.",
  audit_log_entries: "Supabase's own internal login audit trail (separate from FieldHub's own Activity Log).",
  mfa_factors: "Internal Supabase Auth housekeeping (multi-factor login, unused here).",
  mfa_challenges: "Internal Supabase Auth housekeeping (multi-factor login, unused here).",
  mfa_amr_claims: "Internal Supabase Auth housekeeping (multi-factor login, unused here).",
  flow_state: "Internal Supabase Auth housekeeping.",
  one_time_tokens: "Internal Supabase Auth housekeeping (used briefly during password resets).",
  sso_providers: "Internal Supabase Auth housekeeping (single sign-on, unused here).",
  sso_domains: "Internal Supabase Auth housekeeping (single sign-on, unused here).",
  saml_providers: "Internal Supabase Auth housekeeping (unused here).",
  saml_relay_states: "Internal Supabase Auth housekeeping (unused here).",
  instances: "Internal Supabase system table — always empty/tiny.",
  schema_migrations: "Internal record of database setup history — always tiny.",
  objects: "Supabase Storage's internal file index (separate from the File Storage total below).",
  buckets: "Supabase Storage's list of storage buckets — always tiny."
};
function friendlyTableName(name){
  return TABLE_FRIENDLY_NAMES[name] || "Not part of FieldHub's own data — a Supabase system table.";
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
      <table><thead><tr><th>Table</th><th>What this actually is</th><th>Rows</th><th>Size</th></tr></thead><tbody>
        ${topTables.map(t=>`<tr><td class="mono">${escapeHtml(t.table_name)}</td><td>${escapeHtml(friendlyTableName(t.table_name))}</td><td class="mono">${t.row_count}</td><td class="mono">${formatBytes(Number(t.size_bytes))}</td></tr>`).join('')}
      </tbody></table>`}
    </div>
    <div class="card">
      <h3>File Storage — ${formatBytes(storageTotal)} of 1 GB used (${storagePct.toFixed(1)}%)</h3>
      <div style="background:var(--line); border-radius:6px; height:10px; overflow:hidden; margin:10px 0;">
        <div style="background:${storagePct>85?'var(--clay)':'var(--teal)'}; height:100%; width:${storagePct}%;"></div>
      </div>
      <p class="hint">Branding bucket (logo, sidebar, favicon, Home Banner uploads, KB attachments if any). Static repo images (logo.jpg etc.) don't count here — those are free on GitHub Pages.</p>
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
    <div class="form-row"><label>Title (shown under the picture, and in the full-size popup)</label><input type="text" id="banner-title" value="${b?.title?escapeHtml(b.title):''}" placeholder="e.g. Independence Day Notice"></div>
    <div class="form-row"><label>New picture</label><input type="file" id="banner-file" accept="image/*"></div>
    <div class="form-row"><label>Show until</label><input type="datetime-local" id="banner-expiry"></div>
    <button class="btn" id="banner-save-btn">Upload &amp; Show</button>
    ${b?.image_url ? `<button class="btn outline" id="banner-remove-btn" style="margin-left:8px;">Remove Now</button>` : ''}
  `;
  document.getElementById('banner-save-btn').onclick = async () => {
    const file = document.getElementById('banner-file').files[0];
    const expiryVal = document.getElementById('banner-expiry').value;
    const title = document.getElementById('banner-title').value.trim();
    if (!file){ toast('Choose a picture first'); return; }
    if (!expiryVal){ toast('Set when it should stop showing'); return; }
    toast('Uploading…');
    const oldPath = b?.image_path;
    const newPath = `home-banner-${Date.now()}.${file.name.split('.').pop()}`;
    const { error: upErr } = await sb.storage.from('branding').upload(newPath, file, { upsert: true });
    if (upErr){ toast('Could not upload: ' + upErr.message); return; }
    const { data: pub } = sb.storage.from('branding').getPublicUrl(newPath);
    const { error: dbErr } = await sb.from('home_banner').update({
      image_url: pub.publicUrl, image_path: newPath, title: title || null,
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
  const riderOptions = state.profilesInScope.filter(p=>p.role==='rider').map(p=>`<option value="${p.id}">${escapeHtml(p.full_name)}${p.employee_id?' — '+escapeHtml(p.employee_id):''}</option>`).join('');
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
    if (!confirm('Confirm this tool issuance?')) return;
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
  const renderRows = (list, allowDelete) => list && list.length ? `<table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Type</th><th>Item</th>${allowDelete?'<th></th>':''}</tr></thead><tbody>
      ${list.map(l => `<tr>
        <td class="mono">${formatDateTime(l.created_at)}</td>
        <td>${escapeHtml(l.profiles?.full_name||'—')}</td>
        <td>${escapeHtml(l.action)}</td>
        <td>${escapeHtml(l.entity_type)}</td>
        <td>${escapeHtml(l.entity_label||'—')}</td>
        ${allowDelete ? `<td><button class="btn small danger" data-delete-log-row="${l.id}">Delete Permanently</button></td>` : ''}
      </tr>`).join('')}
    </tbody></table>` : emptyState('No entries here.');

  main.innerHTML = `
    <div class="card">
      <h3>Hide old entries (recommended)</h3>
      <p class="hint">Hides entries from this page to make it easier to scan — the records themselves are kept in the database, not deleted, so nothing is lost for audit purposes. This does <strong>not</strong> reduce database storage usage.</p>
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
    <div class="card" style="border-left:4px solid var(--clay);">
      <h3>Permanently delete (real space savings)</h3>
      <p class="hint">This genuinely removes entries from the database — unlike "Hide" above, this <strong>cannot be undone</strong> and there is no audit trail left. Only use this if you specifically need to reduce storage, not just to declutter the page.</p>
      <div class="two-col">
        <div class="form-row"><label>From</label><input type="date" id="al-del-from"></div>
        <div class="form-row"><label>To</label><input type="date" id="al-del-to"></div>
      </div>
      <label style="display:flex; align-items:center; gap:8px; font-weight:400; margin-bottom:12px;">
        <input type="checkbox" id="al-confirm-delete"> I understand this permanently deletes these records with no way to recover them
      </label>
      <button class="btn danger" id="al-delete-range-btn">Permanently Delete Entries in This Range</button>
    </div>
    <div id="activity-log-list">${renderRows(log, true)}</div>`;

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

  document.getElementById('al-delete-range-btn').onclick = async () => {
    const from = document.getElementById('al-del-from').value;
    const to = document.getElementById('al-del-to').value;
    if (!from || !to){ toast('Pick both a From and To date'); return; }
    if (!document.getElementById('al-confirm-delete').checked){ toast('Please check the confirmation box first'); return; }
    if (!confirm(`PERMANENTLY delete all Activity Log entries between ${from} and ${to}? This cannot be undone.`)) return;
    const { error, count } = await sb.from('activity_log').delete()
      .gte('created_at', from).lte('created_at', to + 'T23:59:59').select('id', {count:'exact'});
    if (error){ toast('Could not delete: ' + error.message); return; }
    toast(`${count ?? ''} entries permanently deleted`); renderActivityLog();
  };

  main.querySelectorAll('[data-delete-log-row]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Permanently delete this single entry? This cannot be undone.')) return;
      const { error } = await sb.from('activity_log').delete().eq('id', btn.dataset.deleteLogRow);
      if (error){ toast('Could not delete: ' + error.message); return; }
      toast('Deleted'); renderActivityLog();
    };
  });

  document.getElementById('al-show-archived-btn').onclick = async () => {
    const { data: archived } = await sb.from('activity_log').select('*, profiles(full_name)').eq('archived', true).order('created_at', {ascending:false}).limit(200);
    document.getElementById('activity-log-list').innerHTML = `
      <p class="hint" style="margin-bottom:10px;">Showing hidden entries (still in the database, just not shown on the main list above).</p>
      <button class="btn small outline" id="al-unhide-all-btn" style="margin-bottom:10px;">Unhide these</button>
      ${renderRows(archived, true)}`;
    const unhideBtn = document.getElementById('al-unhide-all-btn');
    if (unhideBtn) unhideBtn.onclick = async () => {
      await sb.from('activity_log').update({ archived: false }).eq('archived', true);
      toast('Unhidden'); renderActivityLog();
    };
    main.querySelectorAll('[data-delete-log-row]').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm('Permanently delete this single entry? This cannot be undone.')) return;
        const { error } = await sb.from('activity_log').delete().eq('id', btn.dataset.deleteLogRow);
        if (error){ toast('Could not delete: ' + error.message); return; }
        toast('Deleted'); document.getElementById('al-show-archived-btn').click();
      };
    });
  };
}

// ---------------------------------------------------------
// RELEASE NOTES — "What's New", Super Admin posts updates
// ---------------------------------------------------------
// ---------------------------------------------------------
// HIERARCHY — read-only org chart so everyone can see their team
// and supervisors, with contact info.
// ---------------------------------------------------------
// FIELD VISIT REPORTS (rebuilt — needs migration_27.sql)
//  * Area Incharges add visit reports; Coordinators / Regional POCs only
//    view (their region); Riders see only their own; Admin sees all;
//    Super Admin (or "field_visit_manage") manages checklist, targets and
//    can correct visits.
//  * Each visit keeps a snapshot of the rider/region/checkpoint weights
//    from that day, so later changes never alter old visits.
//  * Charts are plain SVG/CSS drawn in the browser — nothing is stored.
// ---------------------------------------------------------
const FV = {
  tab: null,
  f: { preset: 'this_month', from: '', to: '', region: '', q: '', type: '', by: '', status: '', cp: '' },
  kpiMonth: ''
};
const fvIsRider      = () => state.profile.role === 'rider';
const fvCanManage    = () => hasPermission('field_visit_manage');
const fvCanAdd       = () => state.profile.role === 'team_lead' || isAdmin() || fvCanManage();
const fvCanResolve   = () => state.profile.role === 'team_lead' || isAdmin() || fvCanManage();
const fvSeesAllAreas = () => isAdmin() || fvCanManage();

const fvIso = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
const fvToday = () => fvIso(new Date());
const fvNum = (n) => Math.round(Number(n || 0) * 10) / 10;
const fvFmtDate = (iso) => iso ? formatDate(iso + (String(iso).length === 10 ? 'T00:00:00' : '')) : '—';
const fvShortDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const fvTypeLabel = (t) => t === 'Onsite' ? 'On-site' : (t || '—');
const fvScoreCls = (s) => Number(s) >= 90 ? 'good' : (Number(s) >= 75 ? 'fair' : 'poor');

const FV_PRESETS = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['this_week', 'This Week'], ['last_7', 'Last 7 Days'],
  ['this_month', 'This Month'], ['last_month', 'Last Month'], ['last_30', 'Last 30 Days'],
  ['this_year', 'This Year'], ['all', 'All Time'], ['custom', 'Custom Range…']
];
function fvRange(f) {
  const n = new Date(), t = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  const add = (d, k) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + k);
  switch (f.preset) {
    case 'today': return { from: fvIso(t), to: fvIso(t) };
    case 'yesterday': { const y = add(t, -1); return { from: fvIso(y), to: fvIso(y) }; }
    case 'this_week': { const s = add(t, -((t.getDay() + 6) % 7)); return { from: fvIso(s), to: fvIso(add(s, 6)) }; }
    case 'last_7': return { from: fvIso(add(t, -6)), to: fvIso(t) };
    case 'last_30': return { from: fvIso(add(t, -29)), to: fvIso(t) };
    case 'last_month': return { from: fvIso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), to: fvIso(new Date(t.getFullYear(), t.getMonth(), 0)) };
    case 'this_year': return { from: fvIso(new Date(t.getFullYear(), 0, 1)), to: fvIso(new Date(t.getFullYear(), 11, 31)) };
    case 'all': return { from: '2000-01-01', to: '2999-12-31' };
    case 'custom': return { from: f.from || '2000-01-01', to: f.to || '2999-12-31' };
    default: return { from: fvIso(new Date(t.getFullYear(), t.getMonth(), 1)), to: fvIso(new Date(t.getFullYear(), t.getMonth() + 1, 0)) };
  }
}

function fvEnsureStyle() {
  if (document.getElementById('fv-style')) return;
  const s = document.createElement('style');
  s.id = 'fv-style';
  s.textContent = `
.fv-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 16px}
.fv-card{background:#fff;border:1px solid rgba(30,42,110,.10);border-left:4px solid var(--ink,#1E2A6E);border-radius:12px;padding:10px 14px;box-shadow:0 1px 2px rgba(30,42,110,.06);animation:fvRise .5s cubic-bezier(.2,.7,.2,1) both}
.fv-card.teal{border-left-color:var(--teal,#17a2a2)}.fv-card.amber{border-left-color:#d9962b}.fv-card.red{border-left-color:#c0532f}.fv-card.green{border-left-color:#2e7d4f}
.fv-card .n{font-size:26px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums;color:var(--ink,#1E2A6E)}
.fv-card .l{font-size:12px;color:var(--muted,#6b7390);margin-top:2px}
.fv-card:nth-child(2){animation-delay:.05s}.fv-card:nth-child(3){animation-delay:.1s}.fv-card:nth-child(4){animation-delay:.15s}.fv-card:nth-child(5){animation-delay:.2s}.fv-card:nth-child(6){animation-delay:.25s}.fv-card:nth-child(7){animation-delay:.3s}
@keyframes fvRise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.fv-panel{background:#fff;border:1px solid rgba(30,42,110,.10);border-radius:14px;padding:14px 16px;margin-bottom:16px;box-shadow:0 1px 2px rgba(30,42,110,.05)}
.fv-panel h3{margin:0 0 10px;font-size:15px;color:var(--ink,#1E2A6E)}
.fv-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px}
.fv-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px}
.fv-filters select,.fv-filters input{padding:7px 9px;border:1px solid var(--line,#d8dce8);border-radius:8px;font:inherit;background:#fff;max-width:220px}
.fv-score{display:inline-flex;align-items:center;gap:6px;min-width:110px}
.fv-score .t{flex:1;height:6px;background:#e8ebf4;border-radius:4px;overflow:hidden}
.fv-score .t i{display:block;height:100%;border-radius:4px;width:0;transition:width .8s cubic-bezier(.2,.7,.2,1)}
.fv-go .fv-score .t i{width:var(--w)}
.fv-score b{font-size:13px;min-width:46px;text-align:right}
.fv-good{color:#2e7d4f}.fv-fair{color:#b9770e}.fv-poor{color:#c0532f}
.fv-bg-good{background:#2e7d4f}.fv-bg-fair{background:#d9962b}.fv-bg-poor{background:#c0532f}.fv-bg-teal{background:#17a2a2}
.fv-type{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:600;white-space:nowrap}
.fv-type.Onsite{background:#e3e8fb;color:#1E2A6E}.fv-type.Online{background:#d9f2f1;color:#0e6f73}
.fv-hbar{display:grid;grid-template-columns:minmax(90px,160px) 1fr 48px;gap:8px;align-items:center;margin:6px 0;font-size:12.5px}
.fv-hbar .t{height:12px;background:#eef0f7;border-radius:7px;overflow:hidden}
.fv-hbar .t i{display:block;height:100%;width:0;border-radius:7px;transition:width .9s cubic-bezier(.2,.7,.2,1)}
.fv-go .fv-hbar .t i{width:var(--w)}
.fv-hbar span.lb{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fv-col{transform-origin:bottom;transform-box:fill-box;transform:scaleY(0);transition:transform .8s cubic-bezier(.2,.7,.2,1)}
.fv-go .fv-col{transform:scaleY(1)}
.fv-line{fill:none;stroke:var(--ink,#1E2A6E);stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset 1.3s ease}
.fv-go .fv-line{stroke-dashoffset:0}
.fv-area{opacity:0;transition:opacity 1.2s ease .5s}.fv-go .fv-area{opacity:1}
.fv-arc{fill:none;stroke-dasharray:0 100;transition:stroke-dasharray 1s cubic-bezier(.2,.7,.2,1);transform-box:fill-box;transform-origin:center}
.fv-go .fv-arc{stroke-dasharray:var(--d) 100}
.fv-seg{display:inline-flex;border:1px solid var(--line,#d8dce8);border-radius:10px;overflow:hidden}
.fv-seg button{padding:7px 18px;border:0;background:#fff;font:inherit;font-weight:600;cursor:pointer;color:#555;transition:background .15s,color .15s}
.fv-seg button.ok.on{background:#2e7d4f;color:#fff}.fv-seg button.issue.on{background:#c0532f;color:#fff}.fv-seg button.t.on{background:var(--ink,#1E2A6E);color:#fff}
.fv-cprow{border:1px solid rgba(30,42,110,.10);border-radius:12px;padding:10px 12px;margin-bottom:8px;background:#fff;transition:border-color .2s,box-shadow .2s}
.fv-cprow.issue{border-color:#c0532f;box-shadow:0 0 0 3px rgba(192,83,47,.08)}.fv-cprow.ok{border-color:#2e7d4f}
.fv-cprow .hd{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.fv-obs{max-height:0;overflow:hidden;transition:max-height .25s ease,margin .25s}
.fv-cprow.issue .fv-obs{max-height:130px;margin-top:8px}
.fv-obs textarea{width:100%;min-height:54px;padding:7px 9px;border:1px solid var(--line,#d8dce8);border-radius:8px;font:inherit;box-sizing:border-box}
.fv-sticky{position:sticky;bottom:0;z-index:5;background:#fff;border:1px solid rgba(30,42,110,.15);border-radius:14px;padding:10px 14px;display:flex;gap:16px;align-items:center;flex-wrap:wrap;box-shadow:0 -4px 16px rgba(30,42,110,.10)}
.fv-chip{display:inline-block;padding:1px 8px;border-radius:999px;background:#eef0f7;font-size:11.5px;color:#46506e;white-space:nowrap}
.fv-note{font-size:12px;color:var(--muted,#6b7390)}
.fv-row-click{cursor:pointer;transition:background .15s}.fv-row-click:hover{background:rgba(30,42,110,.04)}
.fv-tabs{margin-bottom:14px}
.fv-wide{max-width:900px!important;width:96%!important}
@media (prefers-reduced-motion:reduce){
 .fv-card{animation:none!important}
 .fv-score .t i,.fv-hbar .t i{transition:none!important;width:var(--w)!important}
 .fv-col{transition:none!important;transform:none!important}
 .fv-line{transition:none!important;stroke-dashoffset:0!important}
 .fv-area{transition:none!important;opacity:1!important}
 .fv-arc{transition:none!important;stroke-dasharray:var(--d) 100!important}
}`;
  document.head.appendChild(s);
}
// restart the grow-in animations inside a container
function fvGo(host) {
  if (!host) return;
  host.classList.remove('fv-go');
  void host.offsetWidth;
  requestAnimationFrame(() => requestAnimationFrame(() => host.classList.add('fv-go')));
}
const fvError = (e) => `<div class="empty-state"><p>Could not load this page: ${escapeHtml(e?.message || String(e))}</p><p class="fv-note">If this is the first time, please make sure <strong>migration_27.sql</strong> has been run in Supabase.</p></div>`;

// ---------------- data loaders ----------------
async function fvFetchAll(build) {
  const out = [], size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}
const FV_VISIT_COLS = 'id, rider_id, rider_name, rider_employee_id, region_id, region_name, sub_region_name, submitted_by, submitted_by_name, visit_date, visit_type, score, ok_count, issue_count, edit_count, created_at';
const fvLoadVisits = (r) => fvFetchAll(() => sb.from('fv_visits').select(FV_VISIT_COLS)
  .gte('visit_date', r.from).lte('visit_date', r.to)
  .order('visit_date', { ascending: false }).order('created_at', { ascending: false }).order('id'));
const fvLoadIssues = (r) => fvFetchAll(() => sb.from('fv_issues').select('*')
  .gte('visit_date', r.from).lte('visit_date', r.to)
  .order('visit_date', { ascending: false }).order('created_at', { ascending: false }).order('id'));
async function fvLoadCheckpoints() {
  const { data, error } = await sb.from('fv_checkpoints').select('*').order('sort_order').order('created_at');
  if (error) throw error;
  return data || [];
}
async function fvLoadTargets() {
  const { data, error } = await sb.from('fv_targets').select('*').order('effective_from', { ascending: false }).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
function fvTargetFor(targets, pid, iso) {
  return targets.find(t => t.profile_id === pid && t.effective_from <= iso)
      || targets.find(t => !t.profile_id && t.effective_from <= iso)
      || { onsite_kpi: 4, online_target: 20, effective_from: null };
}
// Riders = the Roster (working entries only) joined to an active login.
async function fvLoadRiders() {
  const rows = await fvFetchAll(() => sb.from('roster_entries')
    .select('rider_id, region_id, sub_region_id, status, created_at, profiles!rider_id(full_name, employee_id, status, role, designation_id), regions(name, active), sub_regions(name)')
    .neq('status', 'removed').order('created_at', { ascending: false }).order('id'));
  const seen = new Set(), out = [];
  rows.forEach(e => {
    if (seen.has(e.rider_id) || !e.profiles || e.profiles.status !== 'active') return;
    seen.add(e.rider_id);
    out.push({ id: e.rider_id, name: e.profiles.full_name, emp: e.profiles.employee_id || '',
      region_id: e.region_id, region_name: e.regions?.name || '—', region_active: e.regions?.active !== false,
      sub_region_name: e.sub_regions?.name || '', designation: designationLabel(e.profiles) });
  });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
function fvRegionOptions() {
  const list = state.regions.filter(r => fvSeesAllAreas() || state.myRegionIds.includes(r.id));
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------- small UI pieces ----------------
const fvCard = (n, l, cls = '') => `<div class="fv-card ${cls}"><div class="n">${n}</div><div class="l">${l}</div></div>`;
function fvScorePill(s) {
  if (s === null || s === undefined || s === '') return '<span class="fv-note">—</span>';
  const v = Math.max(0, Math.min(100, Number(s)));
  return `<span class="fv-score" style="--w:${v}%"><span class="t"><i class="fv-bg-${fvScoreCls(v)}"></i></span><b class="fv-${fvScoreCls(v)}">${fvNum(v)}%</b></span>`;
}
const fvTypeBadge = (t) => `<span class="fv-type ${escapeHtml(t)}">${fvTypeLabel(t)}</span>`;

// ---------------- charts (inline SVG/CSS) ----------------
function fvLineChart(pts) {
  if (!pts.length) return '<div class="fv-note">No data for this period.</div>';
  const W = 600, H = 190, pl = 34, pr = 10, pt = 10, pb = 24, n = pts.length;
  const X = i => n === 1 ? pl + (W - pl - pr) / 2 : pl + (W - pl - pr) * i / (n - 1);
  const Y = v => pt + (H - pt - pb) * (1 - Math.max(0, Math.min(100, v)) / 100);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const area = `${d} L${X(n - 1).toFixed(1)},${Y(0)} L${X(0).toFixed(1)},${Y(0)} Z`;
  const grid = [0, 50, 100].map(v => `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e3e6f0" stroke-width="1"/><text x="${pl - 6}" y="${Y(v) + 4}" font-size="10" text-anchor="end" fill="#8b92ad">${v}</text>`).join('');
  const dots = pts.map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3.5" fill="#fff" stroke="#1E2A6E" stroke-width="2"><title>${escapeHtml(p.x)}: ${fvNum(p.y)}%${p.n ? ' (' + p.n + ' visits)' : ''}</title></circle>`).join('');
  const lab = (i, anchor) => `<text x="${X(i).toFixed(1)}" y="${H - 6}" font-size="10" text-anchor="${anchor}" fill="#8b92ad">${escapeHtml(pts[i].x)}</text>`;
  const labels = n === 1 ? lab(0, 'middle') : lab(0, 'start') + (n > 2 ? lab(Math.floor((n - 1) / 2), 'middle') : '') + lab(n - 1, 'end');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Score trend">
    <defs><linearGradient id="fvg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1E2A6E" stop-opacity=".22"/><stop offset="1" stop-color="#1E2A6E" stop-opacity="0"/></linearGradient></defs>
    ${grid}<path class="fv-area" d="${area}" fill="url(#fvg)"/><path class="fv-line" d="${d}" pathLength="1"/>${dots}${labels}</svg>`;
}
function fvColChart(buckets) {
  if (!buckets.length) return '<div class="fv-note">No visits in this period.</div>';
  const W = 600, H = 190, pl = 28, pr = 6, pt = 10, pb = 24, n = buckets.length;
  const max = Math.max(1, ...buckets.map(b => b.a + b.b));
  const slot = (W - pl - pr) / n, bw = Math.min(34, slot * 0.7);
  const Y = v => pt + (H - pt - pb) * (1 - v / max);
  let bars = '';
  buckets.forEach((b, i) => {
    const x = pl + slot * i + (slot - bw) / 2;
    const hb = (H - pt - pb) * b.b / max, ha = (H - pt - pb) * b.a / max;
    bars += `<rect class="fv-col" x="${x.toFixed(1)}" y="${(H - pb - hb).toFixed(1)}" width="${bw.toFixed(1)}" height="${hb.toFixed(1)}" fill="#17a2a2" rx="2"><title>${escapeHtml(b.label)}: ${b.b} Online</title></rect>`;
    bars += `<rect class="fv-col" x="${x.toFixed(1)}" y="${(H - pb - hb - ha).toFixed(1)}" width="${bw.toFixed(1)}" height="${ha.toFixed(1)}" fill="#1E2A6E" rx="2"><title>${escapeHtml(b.label)}: ${b.a} On-site</title></rect>`;
  });
  const step = Math.max(1, Math.ceil(n / 8));
  const labs = buckets.map((b, i) => (i % step === 0 || i === n - 1) ? `<text x="${(pl + slot * i + slot / 2).toFixed(1)}" y="${H - 6}" font-size="10" text-anchor="middle" fill="#8b92ad">${escapeHtml(b.label)}</text>` : '').join('');
  const grid = [0, max].map(v => `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e3e6f0"/><text x="${pl - 5}" y="${Y(v) + 4}" font-size="10" text-anchor="end" fill="#8b92ad">${v}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Visits">${grid}${bars}${labs}</svg>
    <div class="fv-note" style="margin-top:4px;"><span style="color:#1E2A6E;">■</span> On-site &nbsp; <span style="color:#17a2a2;">■</span> Online</div>`;
}
function fvHBars(items, suffix = '') {
  if (!items.length) return '<div class="fv-note">Nothing to show for this period.</div>';
  const max = Math.max(1, ...items.map(i => i.value));
  return items.map(i => `<div class="fv-hbar"><span class="lb" title="${escapeHtml(i.label)}">${escapeHtml(i.label)}</span>
    <span class="t"><i class="${i.cls || ''}" style="--w:${(i.value / max * 100).toFixed(1)}%;${i.color ? 'background:' + i.color : ''}"></i></span><b>${fvNum(i.value)}${suffix}</b></div>`).join('');
}
function fvDonut(parts, centerLabel) {
  const shown = parts.filter(p => p.value > 0);
  const total = shown.reduce((s, p) => s + p.value, 0);
  if (!total) return '<div class="fv-note">No issues in this period.</div>';
  let acc = 0;
  const arcs = shown.map(p => {
    const d = p.value / total * 100, rot = -90 + acc * 3.6; acc += d;
    return `<circle class="fv-arc" cx="18" cy="18" r="15.9155" stroke="${p.color}" stroke-width="4.2" pathLength="100" style="--d:${d.toFixed(2)};transform:rotate(${rot.toFixed(2)}deg)"/>`;
  }).join('');
  const legend = parts.map(p => `<div style="font-size:12.5px;"><span style="color:${p.color}">■</span> ${escapeHtml(p.label)}: <b>${p.value}</b></div>`).join('');
  return `<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;">
    <svg viewBox="0 0 36 36" width="130" height="130" role="img" aria-label="Chart"><circle cx="18" cy="18" r="15.9155" fill="none" stroke="#eef0f7" stroke-width="4.2"/>${arcs}
      <text x="18" y="18.8" text-anchor="middle" font-size="7" font-weight="700" fill="#1E2A6E">${total}</text>
      <text x="18" y="23.6" text-anchor="middle" font-size="2.6" fill="#8b92ad">${escapeHtml(centerLabel || '')}</text></svg>
    <div>${legend}</div></div>`;
}
function fvRing(score, size = 92) {
  const v = Math.max(0, Math.min(100, Number(score) || 0)), col = v >= 90 ? '#2e7d4f' : (v >= 75 ? '#d9962b' : '#c0532f');
  return `<svg viewBox="0 0 36 36" width="${size}" height="${size}" role="img" aria-label="Score"><circle cx="18" cy="18" r="15.9155" fill="none" stroke="#e8ebf4" stroke-width="3.6"/>
    <circle class="fv-arc" cx="18" cy="18" r="15.9155" stroke="${col}" stroke-width="3.6" stroke-linecap="round" pathLength="100" style="--d:${v};transform:rotate(-90deg)"/>
    <text x="18" y="21" text-anchor="middle" font-size="8" font-weight="700" fill="${col}">${fvNum(v)}%</text></svg>`;
}

// ---------------- shared filter bar + loader ----------------
function fvMatchRider(row, q) {
  q = (q || '').trim().toLowerCase();
  if (!q) return true;
  return (row.rider_name || '').toLowerCase().includes(q) || (row.rider_employee_id || '').toLowerCase().includes(q);
}
const fvFilterVisits = (rows, f) => rows.filter(v => (!f.region || v.region_id === f.region) && (!f.type || v.visit_type === f.type) && (!f.by || v.submitted_by === f.by) && fvMatchRider(v, f.q));
const fvFilterIssues = (rows, f) => rows.filter(i => (!f.region || i.region_id === f.region) && (!f.by || i.submitted_by === f.by) && (!f.status || i.status === f.status) && (!f.cp || i.checkpoint_text === f.cp) && fvMatchRider(i, f.q));
const fvOpt = (v, l, cur) => `<option value="${escapeHtml(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${escapeHtml(l)}</option>`;

// cfg: { filters:{region,search,type,by,status:[[v,l]..],cp}, load(range), rows(data)->rows for the "by" list,
//        cps(data)->checkpoint names, draw(data, f, host), extra }
async function fvListShell(host, cfg) {
  host.innerHTML = '<div class="fv-fh"></div><div class="fv-res"></div>';
  const fh = host.querySelector('.fv-fh'), res = host.querySelector('.fv-res');
  let data = null, seq = 0;
  const draw = () => { try { cfg.draw(data, FV.f, res); fvGo(res); } catch (e) { console.error(e); res.innerHTML = fvError(e); } };
  const build = () => {
    const f = FV.f, o = cfg.filters || {};
    const by = new Map();
    if (o.by && data && cfg.rows) cfg.rows(data).forEach(r => { if (r.submitted_by) by.set(r.submitted_by, r.submitted_by_name || 'Unknown'); });
    const cps = (o.cp && data && cfg.cps) ? [...new Set(cfg.cps(data))].sort() : [];
    fh.innerHTML = `<div class="fv-filters">
      <select data-k="preset" title="Date">${FV_PRESETS.map(([k, l]) => fvOpt(k, l, f.preset)).join('')}</select>
      <span data-custom style="display:${f.preset === 'custom' ? 'inline-flex' : 'none'};gap:6px;align-items:center;">
        <input type="date" data-k="from" value="${escapeHtml(f.from)}"> <span class="fv-note">to</span> <input type="date" data-k="to" value="${escapeHtml(f.to)}"></span>
      ${o.region ? `<select data-k="region"><option value="">All Teams / Regions</option>${fvRegionOptions().map(r => fvOpt(r.id, r.name, f.region)).join('')}</select>` : ''}
      ${o.search ? `<input type="search" data-k="q" placeholder="Search rider name or ID…" value="${escapeHtml(f.q)}" style="min-width:210px;">` : ''}
      ${o.type ? `<select data-k="type"><option value="">All Visit Types</option>${fvOpt('Onsite', 'On-site', f.type)}${fvOpt('Online', 'Online', f.type)}</select>` : ''}
      ${o.by ? `<select data-k="by"><option value="">All Area Incharges</option>${[...by.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id, n]) => fvOpt(id, n, f.by)).join('')}</select>` : ''}
      ${o.status ? `<select data-k="status">${o.status.map(([v, l]) => fvOpt(v, l, f.status)).join('')}</select>` : ''}
      ${o.cp ? `<select data-k="cp"><option value="">All Checkpoints</option>${cps.map(c => fvOpt(c, c, f.cp)).join('')}</select>` : ''}
      <button class="btn small outline" data-reset type="button">Reset</button>${cfg.extra || ''}</div>`;
    let timer = null;
    fh.querySelectorAll('[data-k]').forEach(el => {
      const k = el.dataset.k;
      const apply = () => {
        FV.f[k] = el.value;
        if (k === 'preset') { fh.querySelector('[data-custom]').style.display = el.value === 'custom' ? 'inline-flex' : 'none'; if (el.value !== 'custom') reload(); else if (FV.f.from || FV.f.to) reload(); }
        else if (k === 'from' || k === 'to') reload();
        else draw();
      };
      if (k === 'q') el.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(apply, 160); });
      else el.addEventListener('change', apply);
    });
    fh.querySelector('[data-reset]').onclick = () => { FV.f = { preset: 'this_month', from: '', to: '', region: '', q: '', type: '', by: '', status: '', cp: '' }; reload(); };
    if (cfg.afterFilters) cfg.afterFilters(fh, { draw, reload });
  };
  const reload = async () => {
    const my = ++seq;
    res.innerHTML = '<div class="mono">Loading…</div>';
    let d;
    try { d = await cfg.load(fvRange(FV.f)); } catch (e) { if (my === seq) res.innerHTML = fvError(e); return; }
    if (my !== seq) return;
    data = d; build(); draw();
  };
  await reload();
  return { reload, draw };
}

// ---------------- OVERVIEW (dashboard) ----------------
function fvBucketize(visits) {
  if (!visits.length) return [];
  const dates = visits.map(v => v.visit_date).sort();
  const span = (new Date(dates[dates.length - 1] + 'T00:00:00') - new Date(dates[0] + 'T00:00:00')) / 86400000;
  const gran = span <= 45 ? 'day' : (span <= 200 ? 'week' : 'month');
  const key = (iso) => {
    if (gran === 'day') return iso;
    if (gran === 'month') return iso.slice(0, 7) + '-01';
    const d = new Date(iso + 'T00:00:00');
    return fvIso(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)));
  };
  const map = new Map();
  visits.forEach(v => {
    const k = key(v.visit_date);
    if (!map.has(k)) map.set(k, { k, sum: 0, n: 0, a: 0, b: 0 });
    const o = map.get(k); o.sum += Number(v.score || 0); o.n++;
    if (v.visit_type === 'Onsite') o.a++; else o.b++;
  });
  const label = (k) => gran === 'month' ? new Date(k + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : fvShortDate(k);
  return [...map.values()].sort((x, y) => x.k < y.k ? -1 : 1).map(o => ({ label: label(o.k), avg: o.sum / o.n, n: o.n, a: o.a, b: o.b }));
}
const fvAvg = (rows) => rows.length ? rows.reduce((s, v) => s + Number(v.score || 0), 0) / rows.length : null;

async function fvRenderOverview(body) {
  body.innerHTML = '<div id="fv-ov"></div><div id="fv-kpi"></div>';
  const rider = fvIsRider();
  await fvListShell(body.querySelector('#fv-ov'), {
    filters: { region: !rider, type: !rider, by: !rider },
    rows: d => d.v,
    load: async (r) => { const [v, i] = await Promise.all([fvLoadVisits(r), fvLoadIssues(r)]); return { v, i }; },
    draw: (d, f, res) => {
      const visits = fvFilterVisits(d.v, f);
      const ids = new Set(visits.map(v => v.id));
      const issues = d.i.filter(i => ids.has(i.visit_id));
      const open = issues.filter(i => i.status === 'open').length, done = issues.length - open;
      const avg = fvAvg(visits);
      if (!visits.length) { res.innerHTML = emptyState(rider ? 'No visit reports for you in this period yet.' : 'No visit reports match these filters.'); return; }
      const on = visits.filter(v => v.visit_type === 'Onsite').length;
      const cards = rider
        ? fvCard(visits.length, 'Visits', '') + fvCard(fvNum(avg) + '%', 'Average score', fvScoreCls(avg) === 'good' ? 'green' : fvScoreCls(avg) === 'fair' ? 'amber' : 'red')
          + fvCard(fvNum(visits[0].score) + '%', 'Latest score (' + fvShortDate(visits[0].visit_date) + ')', 'teal') + fvCard(open, 'Open issues', 'red') + fvCard(done, 'Resolved issues', 'green')
        : fvCard(visits.length, 'Total visits') + fvCard(on, 'On-site visits') + fvCard(visits.length - on, 'Online visits', 'teal')
          + fvCard(fvNum(avg) + '%', 'Average score', fvScoreCls(avg) === 'good' ? 'green' : fvScoreCls(avg) === 'fair' ? 'amber' : 'red')
          + fvCard(new Set(visits.map(v => v.rider_id)).size, 'Riders visited') + fvCard(open, 'Open issues', 'red') + fvCard(done, 'Resolved issues', 'green');

      const trend = fvBucketize(visits);
      const byRegion = new Map(), byRider = new Map(), byCp = new Map();
      visits.forEach(v => {
        const rk = v.region_name || '—'; if (!byRegion.has(rk)) byRegion.set(rk, []); byRegion.get(rk).push(v);
        const dk = v.rider_id || v.rider_name; if (!byRider.has(dk)) byRider.set(dk, []); byRider.get(dk).push(v);
      });
      issues.forEach(i => byCp.set(i.checkpoint_text, (byCp.get(i.checkpoint_text) || 0) + 1));
      const regionBars = [...byRegion.entries()].map(([k, arr]) => ({ label: k, value: fvAvg(arr), cls: 'fv-bg-' + fvScoreCls(fvAvg(arr)) })).sort((a, b) => b.value - a.value);
      const cpBars = [...byCp.entries()].map(([k, n]) => ({ label: k, value: n, color: '#c0532f' })).sort((a, b) => b.value - a.value).slice(0, 8);
      const lowest = [...byRider.values()].map(arr => ({ name: arr[0].rider_name, emp: arr[0].rider_employee_id, avg: fvAvg(arr), n: arr.length }))
        .sort((a, b) => a.avg - b.avg).slice(0, 5);

      res.innerHTML = `<div class="fv-cards">${cards}</div>
        <div class="fv-grid2">
          <div class="fv-panel"><h3>Score trend</h3>${fvLineChart(trend.map(t => ({ x: t.label, y: t.avg, n: t.n })))}</div>
          ${rider ? '' : `<div class="fv-panel"><h3>Visits over time</h3>${fvColChart(trend)}</div>`}
          ${rider ? '' : `<div class="fv-panel"><h3>Average score by team / region</h3>${fvHBars(regionBars, '%')}</div>`}
          <div class="fv-panel"><h3>Most common issues</h3>${fvHBars(cpBars)}</div>
          <div class="fv-panel"><h3>Issue status</h3>${fvDonut([{ label: 'Open', value: open, color: '#c0532f' }, { label: 'Resolved', value: done, color: '#2e7d4f' }], 'issues')}</div>
          ${rider ? '' : `<div class="fv-panel"><h3>Needs attention — lowest average scores</h3>
            ${lowest.map(r => `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid #eef0f7;">
              <span>${escapeHtml(r.name)} <span class="fv-note">${escapeHtml(r.emp || '')} · ${r.n} visit${r.n === 1 ? '' : 's'}</span></span>${fvScorePill(r.avg)}</div>`).join('')}</div>`}
        </div>`;
    }
  });
  await fvKpiBoard(body.querySelector('#fv-kpi'));
}

// ---------------- Area Incharge monthly KPI board ----------------
const fvProgress = (count, target, cls) => {
  const w = target > 0 ? Math.min(100, count / target * 100) : (count > 0 ? 100 : 0);
  return `<span class="fv-score" style="--w:${w.toFixed(1)}%;min-width:150px;"><span class="t"><i class="${cls}"></i></span><b style="min-width:54px;">${count} / ${target}</b></span>`;
};
async function fvKpiBoard(host) {
  if (!host || fvIsRider()) { if (host) host.innerHTML = ''; return; }
  const thisMonth = fvToday().slice(0, 7);
  const month = FV.kpiMonth || thisMonth;
  host.innerHTML = `<div class="fv-panel"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
      <h3 style="margin:0;">Area Incharge KPI — monthly</h3>
      <input type="month" id="fv-kpi-month" value="${month}" max="${thisMonth}" style="padding:6px 8px;border:1px solid var(--line,#d8dce8);border-radius:8px;"></div>
      <div id="fv-kpi-body" class="fv-note" style="margin-top:10px;">Loading…</div></div>`;
  host.querySelector('#fv-kpi-month').onchange = (e) => { FV.kpiMonth = e.target.value || thisMonth; fvKpiBoard(host); };
  const out = host.querySelector('#fv-kpi-body');
  try {
    const [y, m] = month.split('-').map(Number);
    const range = { from: month + '-01', to: fvIso(new Date(y, m, 0)) };
    const today = fvToday(), ended = range.to < today, evalDate = ended ? range.to : today;
    let aisQ = sb.from('profiles').select('id, full_name, employee_id').eq('role', 'team_lead').eq('status', 'active').order('full_name');
    if (state.profile.role === 'team_lead') aisQ = aisQ.eq('id', state.user.id);
    const [targets, visits, aisRes] = await Promise.all([fvLoadTargets(), fvLoadVisits(range), aisQ]);
    const ais = aisRes.data || [];
    if (!ais.length) { out.innerHTML = 'No Area Incharges to show.'; return; }
    const rows = ais.map(a => {
      const t = fvTargetFor(targets, a.id, evalDate);
      const mine = visits.filter(v => v.submitted_by === a.id);
      return { a, t, on: mine.filter(v => v.visit_type === 'Onsite').length, off: mine.filter(v => v.visit_type === 'Online').length };
    });
    const met = rows.filter(r => r.on >= r.t.onsite_kpi).length;
    const badge = (r) => r.t.onsite_kpi === 0 ? '<span class="badge pending">No KPI</span>'
      : r.on >= r.t.onsite_kpi ? '<span class="badge active">KPI met</span>'
      : ended ? '<span class="badge" style="background:#fde7e1;color:#a63d1f;">Missed</span>' : '<span class="badge pending">In progress</span>';
    out.innerHTML = `<div class="fv-cards" style="margin-top:6px;">${fvCard(met + ' / ' + rows.length, 'Met the On-site KPI', met === rows.length ? 'green' : 'amber')}
        ${fvCard(rows.reduce((s, r) => s + r.on, 0), 'On-site visits this month')}${fvCard(rows.reduce((s, r) => s + r.off, 0), 'Online visits this month', 'teal')}</div>
      <div style="overflow-x:auto;"><table><thead><tr><th>Area Incharge</th><th>On-site (KPI)</th><th>KPI status</th><th>Online (target only)</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${escapeHtml(r.a.full_name)} <span class="fv-note">${escapeHtml(r.a.employee_id || '')}</span></td>
        <td>${fvProgress(r.on, r.t.onsite_kpi, 'fv-bg-' + (r.on >= r.t.onsite_kpi ? 'good' : 'fair'))}</td><td>${badge(r)}</td>
        <td>${fvProgress(r.off, r.t.online_target, 'fv-bg-teal')}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="fv-note" style="margin-top:8px;">The KPI is the number of <strong>On-site</strong> visits per month. <strong>Online</strong> visits are tracked against a target but are <strong>not</strong> part of the KPI. Targets used are the ones in force on ${fvFmtDate(evalDate)} — a change made by the Super Admin applies from its start date and never alters earlier months.</p>`;
    fvGo(out);
  } catch (e) { out.innerHTML = fvError(e); }
}

// ---------------- VISIT SUMMARY ----------------
function fvVisitsToRows(rows) {
  return rows.map(v => ({ Date: v.visit_date, Rider: v.rider_name, 'Employee ID': v.rider_employee_id || '', 'Team / Region': v.region_name || '',
    'Sub-Region': v.sub_region_name || '', 'Visit Type': fvTypeLabel(v.visit_type), 'Score %': fvNum(v.score), 'OK': v.ok_count, 'Issues': v.issue_count,
    'Visited By': v.submitted_by_name || '' }));
}
async function fvRenderVisits(body) {
  const rider = fvIsRider();
  let shown = 50, current = [], ctx = null;
  await fvListShell(body, {
    filters: { region: !rider, search: !rider, type: !rider, by: !rider },
    rows: d => d,
    load: fvLoadVisits,
    extra: rider ? '' : ' <button class="btn small outline" data-export type="button">Download</button>',
    afterFilters: (fh, c) => {
      ctx = c;
      const b = fh.querySelector('[data-export]');
      if (b) b.onclick = () => { if (!current.length) { toast('Nothing to download.'); return; } downloadCSV(`field-visits-${fvToday()}.csv`, toCSV(fvVisitsToRows(current))); };
    },
    draw: (data, f, res) => {
      current = fvFilterVisits(data, f);
      shown = 50;
      const paint = () => {
        if (!current.length) { res.innerHTML = emptyState(rider ? 'No visit reports for you in this period.' : 'No visit reports match these filters.'); return; }
        const avg = fvAvg(current), on = current.filter(v => v.visit_type === 'Onsite').length;
        res.innerHTML = `<div class="fv-cards">${fvCard(current.length, 'Visits')}${fvCard(fvNum(avg) + '%', 'Average score', fvScoreCls(avg) === 'good' ? 'green' : fvScoreCls(avg) === 'fair' ? 'amber' : 'red')}
          ${fvCard(on, 'On-site')}${fvCard(current.length - on, 'Online', 'teal')}${fvCard(current.filter(v => Number(v.score) < 75).length, 'Below 75%', 'red')}</div>
          <div style="overflow-x:auto;"><table><thead><tr><th>Date</th><th>Rider</th>${rider ? '' : '<th>Team / Region</th>'}<th>Type</th><th>Score</th><th>OK / Issues</th><th>Visited by</th></tr></thead><tbody>
          ${current.slice(0, shown).map(v => `<tr class="fv-row-click" data-vid="${v.id}">
            <td>${fvFmtDate(v.visit_date)}</td>
            <td><strong>${escapeHtml(v.rider_name)}</strong><div class="fv-note">${escapeHtml(v.rider_employee_id || '')}</div></td>
            ${rider ? '' : `<td>${escapeHtml(v.region_name || '—')}<div class="fv-note">${escapeHtml(v.sub_region_name || '')}</div></td>`}
            <td>${fvTypeBadge(v.visit_type)}</td><td>${fvScorePill(v.score)}</td>
            <td><span style="color:#2e7d4f;font-weight:600;">${v.ok_count}</span> / <span style="color:#c0532f;font-weight:600;">${v.issue_count}</span></td>
            <td>${escapeHtml(v.submitted_by_name || '—')}${v.edit_count ? ' <span class="fv-chip" title="Corrected by Super Admin">✎ edited</span>' : ''}</td></tr>`).join('')}
          </tbody></table></div>
          ${current.length > shown ? `<div style="text-align:center;margin-top:10px;"><button class="btn small outline" data-more type="button">Show more (${current.length - shown} left)</button></div>` : ''}
          <p class="fv-note" style="margin-top:8px;">Click any row to open the full visit form.</p>`;
        res.querySelectorAll('[data-vid]').forEach(tr => tr.onclick = () => fvOpenVisit(tr.dataset.vid, () => ctx && ctx.reload()));
        const more = res.querySelector('[data-more]');
        if (more) more.onclick = () => { shown += 50; paint(); fvGo(res); };
      };
      paint();
    }
  });
}

// ---------------- VISIT FORM (view / Super Admin correction) ----------------
const fvStatusBadge = (s) => s === 'OK' ? '<span class="badge active">OK</span>' : '<span class="badge" style="background:#fde7e1;color:#a63d1f;">Issue</span>';
async function fvOpenVisit(id, onChanged) {
  const { data: v, error } = await sb.from('fv_visits').select('*').eq('id', id).maybeSingle();
  if (error || !v) { toast('Could not open this visit.'); return; }
  const { data: iss } = await sb.from('fv_issues').select('cp_key, status, resolved_at').eq('visit_id', id);
  const issueBy = new Map((iss || []).map(i => [i.cp_key, i]));
  openModal('');
  const modal = document.querySelector('#active-modal .modal');
  modal.classList.add('fv-wide');
  const closeBtn = '<button class="modal-close" onclick="requestCloseModal()">✕</button>';
  const canEdit = fvCanManage();
  let editing = false;
  const calc = (ans) => { const t = ans.reduce((s, a) => s + Number(a.weight), 0); const ok = ans.filter(a => a.status === 'OK').reduce((s, a) => s + Number(a.weight), 0); return t ? ok / t * 100 : 0; };

  const head = (score) => `<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
      <div id="fv-ring-box">${fvRing(score)}</div>
      <div><h2 style="margin:0 0 4px;">${escapeHtml(v.rider_name)} <span class="fv-note">${escapeHtml(v.rider_employee_id || '')}</span></h2>
        <div>${escapeHtml(v.region_name || '—')}${v.sub_region_name ? ' · ' + escapeHtml(v.sub_region_name) : ''} <span class="fv-note">(as on the visit date)</span></div>
        <div style="margin-top:3px;">${fvFmtDate(v.visit_date)} · ${fvTypeBadge(v.visit_type)} · <span class="fv-note">Visited by ${escapeHtml(v.submitted_by_name || '—')}</span></div>
        ${v.edit_count ? `<div class="fv-note">✎ Corrected by ${escapeHtml(v.last_edited_name || 'Super Admin')} on ${formatDateTime(v.last_edited_at)}${v.edit_count > 1 ? ' (' + v.edit_count + ' times)' : ''}</div>` : ''}</div></div>`;

  const viewHtml = () => `${head(v.score)}
    <div style="overflow-x:auto;"><table><thead><tr><th>#</th><th>Checkpoint</th><th>Weight</th><th>Result</th><th>Observation</th></tr></thead><tbody>
    ${v.answers.map((a, i) => { const is = issueBy.get(a.cp); return `<tr><td>${i + 1}</td><td>${escapeHtml(a.text)}</td><td>${fvNum(a.weight)}</td><td>${fvStatusBadge(a.status)}</td>
      <td>${escapeHtml(a.obs || '')}${is ? `<div class="fv-note">${is.status === 'resolved' ? '✔ Resolved ' + formatDate(is.resolved_at) : '● Open issue'}</div>` : ''}</td></tr>`; }).join('')}
    </tbody></table></div>
    <p class="fv-note" style="margin-top:8px;">Score ${fvNum(v.earned_weight)} of ${fvNum(v.total_weight)} points. Checkpoint names and weightages are shown as they were on the visit date.</p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">${canEdit ? '<button class="btn small" id="fv-edit" type="button">Edit / Correct</button>' : ''}</div>`;

  const editHtml = () => `${head(v.score)}
    <div class="fv-filters"><label>Visit date <input type="date" id="fv-e-date" value="${v.visit_date}" max="${fvToday()}"></label>
      <label>Type <select id="fv-e-type">${fvOpt('Onsite', 'On-site', v.visit_type)}${fvOpt('Online', 'Online', v.visit_type)}</select></label>
      <span class="fv-note">Live score: <strong id="fv-e-score">${fvNum(v.score)}%</strong></span></div>
    <div style="overflow-x:auto;"><table><thead><tr><th>#</th><th>Checkpoint</th><th>Weight</th><th>Result</th><th>Observation (required for Issue)</th></tr></thead><tbody>
    ${v.answers.map((a, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(a.text)}</td><td>${fvNum(a.weight)}</td>
      <td><select data-i="${i}">${fvOpt('OK', 'OK', a.status)}${fvOpt('Issue', 'Issue', a.status)}</select></td>
      <td><input type="text" data-o="${i}" value="${escapeHtml(a.obs || '')}" style="width:100%;min-width:160px;padding:6px 8px;border:1px solid var(--line,#d8dce8);border-radius:8px;"></td></tr>`).join('')}
    </tbody></table></div>
    <p class="fv-note" style="margin-top:8px;">Corrections use the weightages stored on this visit. Issues are added or removed from the Issues dashboard automatically.</p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;"><button class="btn small outline" id="fv-cancel" type="button">Cancel</button><button class="btn small" id="fv-save" type="button">Save correction</button></div>`;

  const collect = () => v.answers.map((a, i) => ({ cp: a.cp, status: modal.querySelector(`[data-i="${i}"]`).value, observation: modal.querySelector(`[data-o="${i}"]`).value.trim() }));
  const paint = () => {
    modal.innerHTML = closeBtn + (editing ? editHtml() : viewHtml());
    if (!editing) { const b = modal.querySelector('#fv-edit'); if (b) b.onclick = () => { editing = true; paint(); }; }
    else {
      const upd = () => { const merged = v.answers.map((a, i) => ({ weight: a.weight, status: modal.querySelector(`[data-i="${i}"]`).value })); modal.querySelector('#fv-e-score').textContent = fvNum(calc(merged)) + '%'; };
      modal.querySelectorAll('[data-i]').forEach(s => s.onchange = upd);
      modal.querySelector('#fv-cancel').onclick = () => { editing = false; paint(); };
      modal.querySelector('#fv-save').onclick = async () => {
        const answers = collect();
        const bad = answers.findIndex(a => a.status === 'Issue' && !a.observation);
        if (bad >= 0) { toast(`Please describe the issue for "${v.answers[bad].text}".`); return; }
        const date = modal.querySelector('#fv-e-date').value, type = modal.querySelector('#fv-e-type').value;
        if (!date) { toast('Please choose the visit date.'); return; }
        if (!confirm('Save this correction? The score and the Issues list will be updated.')) return;
        const { error: err } = await sb.rpc('fv_update_visit', { p_visit: id, p_date: date, p_type: type, p_answers: answers });
        if (err) { toast('Could not save: ' + err.message); return; }
        closeModal(); toast('Visit corrected'); if (onChanged) onChanged();
      };
    }
    fvGo(modal);
  };
  paint();
}

// ---------------- ISSUES DASHBOARD ----------------
async function fvRenderIssues(body) {
  const rider = fvIsRider();
  let current = [], ctx = null;
  await fvListShell(body, {
    filters: { region: !rider, search: !rider, by: !rider, cp: true, status: [['', 'All Statuses'], ['open', 'Open'], ['resolved', 'Resolved']] },
    rows: d => d, cps: d => d.map(i => i.checkpoint_text),
    load: fvLoadIssues,
    extra: rider ? '' : ' <button class="btn small outline" data-export type="button">Download</button>',
    afterFilters: (fh, c) => {
      ctx = c;
      const b = fh.querySelector('[data-export]');
      if (b) b.onclick = () => {
        if (!current.length) { toast('Nothing to download.'); return; }
        downloadCSV(`field-visit-issues-${fvToday()}.csv`, toCSV(current.map(i => ({ 'Visit Date': i.visit_date, Issue: i.checkpoint_text, Rider: i.rider_name, 'Employee ID': i.rider_employee_id || '',
          'Team / Region': i.region_name || '', Observation: i.observation || '', Status: i.status === 'open' ? 'Open' : 'Resolved',
          'Resolved On': i.resolved_at ? i.resolved_at.slice(0, 10) : '', 'Resolved By': i.resolved_by_name || '', 'Resolution Note': i.resolution_note || '' }))));
      };
    },
    draw: (data, f, res) => {
      current = fvFilterIssues(data, f);
      if (!current.length) { res.innerHTML = emptyState('No issues match these filters.'); return; }
      const open = current.filter(i => i.status === 'open').length, done = current.length - open;
      const days = current.filter(i => i.resolved_at).map(i => (new Date(i.resolved_at) - new Date(i.visit_date + 'T00:00:00')) / 86400000);
      const avgDays = days.length ? Math.max(0, days.reduce((a, b) => a + b, 0) / days.length) : null;
      res.innerHTML = `<div class="fv-cards">${fvCard(open, 'Open issues', 'red')}${fvCard(done, 'Resolved', 'green')}${fvCard(current.length, 'Total issues')}${fvCard(avgDays === null ? '—' : fvNum(avgDays) + ' d', 'Avg. time to resolve', 'teal')}</div>
        <div style="overflow-x:auto;"><table><thead><tr><th>Visit date</th><th>Issue</th><th>Rider</th>${rider ? '' : '<th>Team / Region</th>'}<th>Observation</th><th>Status</th><th>Resolved</th><th></th></tr></thead><tbody>
        ${current.map(i => `<tr>
          <td>${fvFmtDate(i.visit_date)}</td><td><strong>${escapeHtml(i.checkpoint_text)}</strong></td>
          <td>${escapeHtml(i.rider_name || '—')}<div class="fv-note">${escapeHtml(i.rider_employee_id || '')}</div></td>
          ${rider ? '' : `<td>${escapeHtml(i.region_name || '—')}</td>`}
          <td style="max-width:260px;">${escapeHtml(i.observation || '')}</td>
          <td>${i.status === 'open' ? '<span class="badge" style="background:#fde7e1;color:#a63d1f;">Open</span>' : '<span class="badge active">Resolved</span>'}</td>
          <td>${i.resolved_at ? `${fvFmtDate(i.resolved_at.slice(0, 10))}<div class="fv-note">${escapeHtml(i.resolved_by_name || '')}${i.resolution_note ? ' — ' + escapeHtml(i.resolution_note) : ''}</div>` : '<span class="fv-note">—</span>'}</td>
          <td style="white-space:nowrap;">${i.status === 'open' && fvCanResolve() ? `<button class="btn small" data-res="${i.id}" type="button">Mark resolved</button>` : ''}
            ${i.status === 'resolved' && fvCanManage() ? `<button class="btn small outline" data-reopen="${i.id}" type="button">Re-open</button>` : ''}
            <button class="btn small outline" data-visit="${i.visit_id}" type="button">Visit</button></td></tr>`).join('')}
        </tbody></table></div>`;
      res.querySelectorAll('[data-visit]').forEach(b => b.onclick = () => fvOpenVisit(b.dataset.visit, () => ctx && ctx.reload()));
      res.querySelectorAll('[data-res]').forEach(b => b.onclick = () => {
        const it = current.find(x => x.id === b.dataset.res);
        openModal(`<h2>Mark issue as resolved</h2>
          <p><strong>${escapeHtml(it.checkpoint_text)}</strong> — ${escapeHtml(it.rider_name || '')} <span class="fv-note">${escapeHtml(it.rider_employee_id || '')}</span></p>
          <p class="fv-note">${escapeHtml(it.observation || '')}</p>
          <div class="form-row"><label>What was done to resolve it? (optional)</label><textarea id="fv-res-note" rows="3" maxlength="300"></textarea></div>
          <button class="btn-primary" id="fv-res-ok" type="button">Confirm resolved</button>`);
        document.getElementById('fv-res-ok').onclick = async () => {
          const { error } = await sb.rpc('fv_set_issue_status', { p_issue: it.id, p_resolved: true, p_note: document.getElementById('fv-res-note').value });
          if (error) { toast('Could not resolve: ' + error.message); return; }
          closeModal(); toast('Marked as resolved'); ctx.reload();
        };
      });
      res.querySelectorAll('[data-reopen]').forEach(b => b.onclick = async () => {
        if (!confirm('Re-open this issue?')) return;
        const { error } = await sb.rpc('fv_set_issue_status', { p_issue: b.dataset.reopen, p_resolved: false, p_note: null });
        if (error) { toast('Could not re-open: ' + error.message); return; }
        toast('Issue re-opened'); ctx.reload();
      });
    }
  });
}

// ---------------- RIDER-WISE ----------------
async function fvRenderRiders(body) {
  let ctx = null;
  await fvListShell(body, {
    filters: { region: true, search: true, status: [['', 'All Riders'], ['visited', 'Visited in this period'], ['notvisited', 'Not visited in this period'], ['inactive', 'Inactive riders']] },
    load: async (r) => {
      const [v, riders, openIss] = await Promise.all([fvLoadVisits(r), fvLoadRiders(),
        fvFetchAll(() => sb.from('fv_issues').select('id, rider_id').eq('status', 'open').order('id'))]);
      return { v, riders, openIss };
    },
    afterFilters: (fh, c) => { ctx = c; },
    draw: (d, f, res) => {
      const map = new Map();
      d.riders.forEach(r => map.set(r.id, { id: r.id, name: r.name, emp: r.emp, region_id: r.region_id, region: r.region_name, sub: r.sub_region_name, designation: r.designation, active: true, visits: [] }));
      d.v.forEach(v => {
        const k = v.rider_id || v.rider_name;
        if (!map.has(k)) map.set(k, { id: v.rider_id, name: v.rider_name, emp: v.rider_employee_id || '', region_id: v.region_id, region: v.region_name || '—', sub: v.sub_region_name || '', designation: '', active: false, visits: [] });
        map.get(k).visits.push(v);
      });
      const openBy = new Map();
      d.openIss.forEach(i => openBy.set(i.rider_id, (openBy.get(i.rider_id) || 0) + 1));
      let rows = [...map.values()].filter(r => (!f.region || r.region_id === f.region) && fvMatchRider({ rider_name: r.name, rider_employee_id: r.emp }, f.q));
      if (f.status === 'visited') rows = rows.filter(r => r.visits.length);
      else if (f.status === 'notvisited') rows = rows.filter(r => r.active && !r.visits.length);
      else if (f.status === 'inactive') rows = rows.filter(r => !r.active);
      rows.sort((a, b) => a.name.localeCompare(b.name));
      const act = [...map.values()].filter(r => r.active && (!f.region || r.region_id === f.region));
      const visited = act.filter(r => r.visits.length).length;
      if (!rows.length) { res.innerHTML = emptyState('No riders match these filters.'); return; }
      res.innerHTML = `<div class="fv-cards">${fvCard(act.length, 'Active riders')}${fvCard(visited, 'Visited in this period', 'green')}${fvCard(act.length - visited, 'Not visited yet', 'amber')}
          ${fvCard(act.length ? Math.round(visited / act.length * 100) + '%' : '—', 'Coverage', 'teal')}</div>
        <div style="overflow-x:auto;"><table><thead><tr><th>Rider</th><th>Team / Region</th><th>Status</th><th>Visits</th><th>On-site / Online</th><th>Avg. score</th><th>Last visit</th><th>Open issues</th></tr></thead><tbody>
        ${rows.map(r => {
          const on = r.visits.filter(v => v.visit_type === 'Onsite').length, last = r.visits[0];
          return `<tr class="fv-row-click" data-rid="${r.id || ''}" data-rn="${escapeHtml(r.name)}" data-re="${escapeHtml(r.emp)}">
            <td><strong>${escapeHtml(r.name)}</strong> ${r.designation && r.designation !== 'Rider' ? `<span class="fv-chip">${escapeHtml(r.designation)}</span>` : ''}<div class="fv-note">${escapeHtml(r.emp)}</div></td>
            <td>${escapeHtml(r.region)}<div class="fv-note">${escapeHtml(r.sub)}</div></td>
            <td>${r.active ? '<span class="badge active">Active</span>' : '<span class="badge pending">Inactive</span>'}</td>
            <td>${r.visits.length}</td><td>${on} / ${r.visits.length - on}</td><td>${r.visits.length ? fvScorePill(fvAvg(r.visits)) : '<span class="fv-note">—</span>'}</td>
            <td>${last ? `${fvShortDate(last.visit_date)} <span class="fv-note">(${fvNum(last.score)}%)</span>` : '<span class="fv-note">—</span>'}</td>
            <td>${openBy.get(r.id) ? `<span style="color:#c0532f;font-weight:700;">${openBy.get(r.id)}</span>` : '0'}</td></tr>`;
        }).join('')}</tbody></table></div>
        <p class="fv-note" style="margin-top:8px;">Riders come straight from the Roster. A rider who is deactivated or removed from the Roster shows as Inactive and no new visits can be added for them. Click a rider for their full history.</p>`;
      res.querySelectorAll('[data-rid]').forEach(tr => tr.onclick = () => { if (tr.dataset.rid) fvOpenRider(tr.dataset.rid, tr.dataset.rn, tr.dataset.re, () => ctx && ctx.reload()); });
    }
  });
}
async function fvOpenRider(id, name, emp, onChanged) {
  const [vs, is] = await Promise.all([
    sb.from('fv_visits').select(FV_VISIT_COLS).eq('rider_id', id).order('visit_date', { ascending: false }).limit(300),
    sb.from('fv_issues').select('*').eq('rider_id', id).order('visit_date', { ascending: false }).limit(300)]);
  const visits = vs.data || [], issues = is.data || [];
  const open = issues.filter(i => i.status === 'open').length;
  openModal('');
  const modal = document.querySelector('#active-modal .modal');
  modal.classList.add('fv-wide');
  const trend = [...visits].reverse().slice(-30).map(v => ({ x: fvShortDate(v.visit_date), y: Number(v.score), n: 0 }));
  modal.innerHTML = `<button class="modal-close" onclick="requestCloseModal()">✕</button>
    <h2 style="margin:0 0 10px;">${escapeHtml(name)} <span class="fv-note">${escapeHtml(emp || '')}</span></h2>
    <div class="fv-cards">${fvCard(visits.length, 'Visits (all time)')}${fvCard(visits.length ? fvNum(fvAvg(visits)) + '%' : '—', 'Average score', 'teal')}
      ${fvCard(visits.length ? fvNum(visits[0].score) + '%' : '—', 'Latest score', 'green')}${fvCard(open, 'Open issues', 'red')}</div>
    <div class="fv-panel"><h3>Score trend (last 30 visits)</h3>${fvLineChart(trend)}</div>
    <div class="fv-panel"><h3>Visits</h3>${visits.length ? `<div style="overflow-x:auto;max-height:260px;overflow-y:auto;"><table><thead><tr><th>Date</th><th>Team / Region</th><th>Type</th><th>Score</th><th>By</th></tr></thead><tbody>
      ${visits.map(v => `<tr class="fv-row-click" data-vid="${v.id}"><td>${fvFmtDate(v.visit_date)}</td><td>${escapeHtml(v.region_name || '—')}</td><td>${fvTypeBadge(v.visit_type)}</td><td>${fvScorePill(v.score)}</td><td>${escapeHtml(v.submitted_by_name || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="fv-note">No visits yet.</div>'}</div>
    <div class="fv-panel"><h3>Issues</h3>${issues.length ? `<div style="overflow-x:auto;max-height:220px;overflow-y:auto;"><table><thead><tr><th>Date</th><th>Issue</th><th>Observation</th><th>Status</th></tr></thead><tbody>
      ${issues.map(i => `<tr><td>${fvFmtDate(i.visit_date)}</td><td>${escapeHtml(i.checkpoint_text)}</td><td>${escapeHtml(i.observation || '')}</td>
        <td>${i.status === 'open' ? '<span class="badge" style="background:#fde7e1;color:#a63d1f;">Open</span>' : `<span class="badge active">Resolved</span><div class="fv-note">${fvFmtDate((i.resolved_at || '').slice(0, 10))}</div>`}</td></tr>`).join('')}</tbody></table></div>` : '<div class="fv-note">No issues recorded.</div>'}</div>`;
  modal.querySelectorAll('[data-vid]').forEach(tr => tr.onclick = () => { closeModal(); fvOpenVisit(tr.dataset.vid, onChanged); });
  fvGo(modal);
}

// ---------------- ADD VISIT (Area Incharge / Admin / Super Admin) ----------------
async function fvRenderAdd(body) {
  if (!fvCanAdd()) { body.innerHTML = emptyState('Only Area Incharges can add visit reports.'); return; }
  body.innerHTML = '<div class="mono">Loading…</div>';
  let cps, riders;
  try { [cps, riders] = await Promise.all([fvLoadCheckpoints(), fvLoadRiders()]); } catch (e) { body.innerHTML = fvError(e); return; }
  cps = cps.filter(c => c.active);
  if (!cps.length) { body.innerHTML = emptyState('No checklist has been set up yet. Please ask the Super Admin to add checkpoints.'); return; }
  const regions = fvRegionOptions().filter(r => r.active !== false && riders.some(x => x.region_id === r.id));
  const allowed = riders.filter(r => regions.some(g => g.id === r.region_id) && r.region_active);
  if (!allowed.length) { body.innerHTML = emptyState('There are no active riders in your region(s) to visit.'); return; }
  const totalW = cps.reduce((s, c) => s + Number(c.weight), 0);
  const ans = {}; cps.forEach(c => { ans[c.id] = { status: '', obs: '' }; });
  let vtype = 'Onsite', riderId = '';

  body.innerHTML = `
    <div class="fv-panel"><h3>1 · Who was visited?</h3>
      <div class="fv-filters">
        <select id="fv-a-region"><option value="">All my Teams / Regions</option>${regions.map(r => fvOpt(r.id, r.name, '')).join('')}</select>
        <input id="fv-a-search" type="search" placeholder="Search rider name or ID…" style="min-width:210px;">
        <select id="fv-a-rider" style="min-width:260px;"></select></div>
      <div id="fv-a-info" class="fv-note">Only active riders from the Roster are listed. Deactivated riders cannot be visited.</div></div>
    <div class="fv-panel"><h3>2 · Visit details</h3>
      <div class="fv-filters"><label>Visit date <input type="date" id="fv-a-date" value="${fvToday()}" max="${fvToday()}"></label>
        <div class="fv-seg" id="fv-a-type"><button type="button" class="t on" data-t="Onsite">On-site</button><button type="button" class="t" data-t="Online">Online</button></div></div></div>
    <div class="fv-panel"><h3>3 · Checklist <span class="fv-note">(${cps.length} checkpoints · ${fvNum(totalW)} points)</span></h3>
      ${cps.map((c, i) => `<div class="fv-cprow" data-c="${c.id}"><div class="hd"><div><strong>${i + 1}. ${escapeHtml(c.name)}</strong> <span class="fv-chip">${fvNum(c.weight)} pts</span></div>
        <div class="fv-seg"><button type="button" class="ok" data-s="OK">OK</button><button type="button" class="issue" data-s="Issue">Issue</button></div></div>
        <div class="fv-obs"><textarea placeholder="Describe what you observed…" maxlength="300"></textarea></div></div>`).join('')}</div>
    <div class="fv-sticky"><div><div class="fv-note">Answered <strong id="fv-a-count">0</strong> / ${cps.length}</div>
        <span class="fv-score" id="fv-a-score" style="--w:0%;min-width:200px;"><span class="t"><i class="fv-bg-poor"></i></span><b class="fv-poor">0%</b></span></div>
      <div style="margin-left:auto;"><button class="btn-primary" id="fv-a-submit" type="button">Submit visit report</button></div></div>`;

  const sel = body.querySelector('#fv-a-rider'), info = body.querySelector('#fv-a-info');
  const fillRiders = () => {
    const rg = body.querySelector('#fv-a-region').value, q = body.querySelector('#fv-a-search').value;
    const list = allowed.filter(r => (!rg || r.region_id === rg) && fvMatchRider({ rider_name: r.name, rider_employee_id: r.emp }, q));
    sel.innerHTML = `<option value="">${list.length ? 'Select rider (' + list.length + ')…' : 'No riders match'}</option>` +
      list.map(r => `<option value="${r.id}" ${r.id === riderId ? 'selected' : ''}>${escapeHtml(r.name)} — ${escapeHtml(r.emp)} (${escapeHtml(r.region_name)})</option>`).join('');
    if (!list.some(r => r.id === riderId)) { riderId = ''; showInfo(); }
  };
  const showInfo = async () => {
    const r = allowed.find(x => x.id === riderId);
    if (!r) { info.innerHTML = 'Only active riders from the Roster are listed. Deactivated riders cannot be visited.'; return; }
    info.innerHTML = `<strong>${escapeHtml(r.name)}</strong> · ${escapeHtml(r.emp)} · ${escapeHtml(r.designation)} · ${escapeHtml(r.region_name)}${r.sub_region_name ? ' / ' + escapeHtml(r.sub_region_name) : ''} <span class="fv-note">— region details are saved with this visit as they are today.</span><div id="fv-a-last" class="fv-note">Checking last visit…</div>`;
    const { data } = await sb.from('fv_visits').select('visit_date, visit_type, score').eq('rider_id', riderId).order('visit_date', { ascending: false }).limit(1);
    const el = document.getElementById('fv-a-last'); if (!el) return;
    el.textContent = data && data.length ? `Last visit: ${fvFmtDate(data[0].visit_date)} · ${fvTypeLabel(data[0].visit_type)} · ${fvNum(data[0].score)}%` : 'No previous visit recorded for this rider.';
  };
  body.querySelector('#fv-a-region').onchange = fillRiders;
  body.querySelector('#fv-a-search').oninput = fillRiders;
  sel.onchange = () => { riderId = sel.value; showInfo(); };
  fillRiders();
  body.querySelectorAll('#fv-a-type [data-t]').forEach(b => b.onclick = () => {
    vtype = b.dataset.t; body.querySelectorAll('#fv-a-type [data-t]').forEach(x => x.classList.toggle('on', x === b));
  });

  const recalc = () => {
    const answered = cps.filter(c => ans[c.id].status).length;
    const earned = cps.filter(c => ans[c.id].status === 'OK').reduce((s, c) => s + Number(c.weight), 0);
    const pct = totalW ? earned / totalW * 100 : 0, cls = fvScoreCls(pct);
    body.querySelector('#fv-a-count').textContent = answered;
    const sc = body.querySelector('#fv-a-score'); sc.style.setProperty('--w', pct.toFixed(1) + '%');
    sc.querySelector('i').className = 'fv-bg-' + cls; const b = sc.querySelector('b'); b.className = 'fv-' + cls; b.textContent = fvNum(pct) + '%';
    return { answered, earned, pct };
  };
  body.querySelectorAll('.fv-cprow').forEach(row => {
    const cid = row.dataset.c;
    row.querySelectorAll('[data-s]').forEach(btn => btn.onclick = () => {
      ans[cid].status = btn.dataset.s;
      row.classList.toggle('ok', btn.dataset.s === 'OK'); row.classList.toggle('issue', btn.dataset.s === 'Issue');
      row.querySelectorAll('[data-s]').forEach(x => x.classList.toggle('on', x === btn));
      recalc();
    });
    row.querySelector('textarea').oninput = (e) => { ans[cid].obs = e.target.value; };
  });
  recalc();
  fvGo(body);

  body.querySelector('#fv-a-submit').onclick = async () => {
    const r = allowed.find(x => x.id === riderId);
    const date = body.querySelector('#fv-a-date').value;
    if (!r) { toast('Please select the rider.'); return; }
    if (!date) { toast('Please choose the visit date.'); return; }
    const missing = cps.find(c => !ans[c.id].status);
    if (missing) { toast(`Please mark "${missing.name}" as OK or Issue.`); body.querySelector(`[data-c="${missing.id}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    const noObs = cps.find(c => ans[c.id].status === 'Issue' && !ans[c.id].obs.trim());
    if (noObs) { toast(`Please describe the issue for "${noObs.name}".`); body.querySelector(`[data-c="${noObs.id}"] textarea`).focus(); return; }
    const { pct } = recalc();
    const issues = cps.filter(c => ans[c.id].status === 'Issue').length;
    const dup = await sb.from('fv_visits').select('id').eq('rider_id', r.id).eq('visit_date', date).eq('visit_type', vtype).limit(1);
    const dupMsg = dup.data && dup.data.length ? `\n\nNOTE: a ${fvTypeLabel(vtype)} visit for this rider on this date already exists.` : '';
    if (!confirm(`Submit this visit report?\n\nRider: ${r.name} (${r.emp})\nTeam / Region: ${r.region_name}\nDate: ${fvFmtDate(date)}\nType: ${fvTypeLabel(vtype)}\nScore: ${fvNum(pct)}%  (${issues} issue${issues === 1 ? '' : 's'})${dupMsg}\n\nOnly the Super Admin can correct it afterwards.`)) return;
    const btn = body.querySelector('#fv-a-submit'); btn.disabled = true;
    const payload = cps.map(c => ({ checkpoint_id: c.id, status: ans[c.id].status, observation: ans[c.id].obs.trim() }));
    const { error } = await sb.rpc('fv_submit_visit', { p_rider: r.id, p_date: date, p_type: vtype, p_answers: payload });
    btn.disabled = false;
    if (error) { toast('Could not submit: ' + error.message); return; }
    toast('Visit report submitted');
    FV.tab = 'visits'; FV.f.preset = date.slice(0, 7) === fvToday().slice(0, 7) ? 'this_month' : 'all'; FV.f.q = ''; FV.f.region = '';
    renderFieldVisits();
  };
}

// ---------------- CHECKLIST (Super Admin) ----------------
async function fvRenderChecklist(body) {
  if (!fvCanManage()) { body.innerHTML = emptyState('Only the Super Admin can manage the checklist.'); return; }
  body.innerHTML = '<div class="mono">Loading…</div>';
  let cps, log;
  try {
    cps = await fvLoadCheckpoints();
    const r = await sb.from('fv_checkpoint_log').select('*').order('changed_at', { ascending: false }).limit(300);
    if (r.error) throw r.error; log = r.data || [];
  } catch (e) { body.innerHTML = fvError(e); return; }
  const active = cps.filter(c => c.active), total = active.reduce((s, c) => s + Number(c.weight), 0);
  const exact = Math.abs(total - 100) < 0.005;
  const dt = (iso) => formatDate(iso);
  const noteFor = (c) => {
    const mine = log.filter(l => l.checkpoint_id === c.id);
    const added = mine.filter(l => l.action === 'added').pop();
    const last = mine.find(l => l.action !== 'added');
    return `${added ? `<div class="fv-note">Added on ${dt(added.changed_at)}</div>` : ''}${last ? `<div class="fv-note">${escapeHtml(last.note)} on ${dt(last.changed_at)}</div>` : ''}`;
  };
  body.innerHTML = `
    <div class="fv-panel"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center;">
        <div><h3 style="margin:0 0 4px;">Home Sampling Checklist</h3><div class="fv-note">${active.length} active checkpoints</div></div>
        <div style="min-width:260px;"><div style="display:flex;justify-content:space-between;font-size:13px;"><span>Total weightage</span><strong class="${exact ? 'fv-good' : 'fv-fair'}">${fvNum(total)} / 100</strong></div>
          <span class="fv-score" style="--w:${Math.min(100, total).toFixed(1)}%;display:flex;"><span class="t"><i class="${exact ? 'fv-bg-good' : 'fv-bg-fair'}"></i></span></span></div></div>
      ${exact ? '' : `<p class="fv-note" style="margin-top:8px;color:#b9770e;">The active weightages add up to ${fvNum(total)}, not 100. Scores are still calculated fairly as a percentage of the active total, but you may want to adjust a weightage so the total is exactly 100.</p>`}
      <p class="fv-note" style="margin-top:8px;">Any change here applies to <strong>new visits only</strong>. Visits already added keep the checkpoint names and weightages from their own date.</p></div>
    <div class="fv-panel"><h3>Add a checkpoint</h3><div class="fv-filters">
      <input type="text" id="fv-c-name" placeholder="Checkpoint name" style="min-width:260px;" maxlength="120">
      <input type="number" id="fv-c-weight" placeholder="Weightage" min="0.01" step="0.01" style="width:120px;">
      <button class="btn small" id="fv-c-add" type="button">Add</button></div></div>
    <div class="fv-panel"><h3>Checkpoints</h3><div style="overflow-x:auto;"><table><thead><tr><th>#</th><th>Checkpoint</th><th>Weightage</th><th>Status</th><th>Change note</th><th></th></tr></thead><tbody>
      ${cps.map((c, i) => `<tr style="${c.active ? '' : 'opacity:.6;'}"><td>${i + 1}</td><td><strong>${escapeHtml(c.name)}</strong></td><td>${fvNum(c.weight)}</td>
        <td>${c.active ? '<span class="badge active">Active</span>' : '<span class="badge pending">Deactivated</span>'}</td><td>${noteFor(c)}</td>
        <td style="white-space:nowrap;"><button class="btn small outline" data-edit="${c.id}" type="button">Edit</button>
          <button class="btn small outline" data-toggle="${c.id}" type="button">${c.active ? 'Deactivate' : 'Activate'}</button>
          <button class="btn small danger" data-del="${c.id}" type="button">Delete</button></td></tr>`).join('') || '<tr><td colspan="6">No checkpoints yet.</td></tr>'}
      </tbody></table></div></div>
    <div class="fv-panel"><h3>Change log</h3>${log.length ? `<div style="overflow-x:auto;max-height:320px;overflow-y:auto;"><table><thead><tr><th>When</th><th>Checkpoint</th><th>What changed</th><th>By</th></tr></thead><tbody>
      ${log.map(l => `<tr><td>${formatDateTime(l.changed_at)}</td><td>${escapeHtml(l.checkpoint_name)}</td><td>${escapeHtml(l.note)}</td><td>${escapeHtml(l.changed_by_name || '—')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="fv-note">No changes yet.</div>'}</div>`;
  fvGo(body);
  const redo = () => fvRenderChecklist(body);
  body.querySelector('#fv-c-add').onclick = async () => {
    const name = body.querySelector('#fv-c-name').value.trim().replace(/\s+/g, ' '), w = Number(body.querySelector('#fv-c-weight').value);
    if (!name) { toast('Please type the checkpoint name.'); return; }
    if (!(w > 0)) { toast('Weightage must be greater than 0.'); return; }
    if (!confirm(`Add "${name}" with weightage ${w}? It will be asked in new visits from now on.`)) return;
    const next = (cps.reduce((m, c) => Math.max(m, c.sort_order), 0)) + 10;
    const { error } = await sb.from('fv_checkpoints').insert({ name, weight: w, sort_order: next });
    if (error) { toast('Could not add: ' + error.message); return; }
    toast('Checkpoint added'); redo();
  };
  body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    const c = cps.find(x => x.id === b.dataset.edit);
    openModal(`<h2>Edit checkpoint</h2><form id="fv-ce-form">
      <div class="form-row"><label>Name</label><input type="text" id="fv-ce-name" value="${escapeHtml(c.name)}" maxlength="120" required></div>
      <div class="form-row"><label>Weightage</label><input type="number" id="fv-ce-w" value="${c.weight}" min="0.01" step="0.01" required></div>
      <div class="form-row"><label>Order in the form (smaller = earlier)</label><input type="number" id="fv-ce-o" value="${c.sort_order}" step="1"></div>
      <p class="fv-note">Applies to new visits only. The change and its date are recorded in the change log.</p>
      <button class="btn-primary" type="submit">Save</button></form>`);
    document.getElementById('fv-ce-form').onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById('fv-ce-name').value.trim().replace(/\s+/g, ' '), w = Number(document.getElementById('fv-ce-w').value), o = parseInt(document.getElementById('fv-ce-o').value, 10);
      if (!name || !(w > 0)) { toast('Please enter a name and a weightage above 0.'); return; }
      if (w !== Number(c.weight) && !confirm(`Change weightage of "${c.name}" from ${fvNum(c.weight)} to ${fvNum(w)}? Past visits are NOT changed.`)) return;
      const { error } = await sb.from('fv_checkpoints').update({ name, weight: w, sort_order: Number.isFinite(o) ? o : c.sort_order }).eq('id', c.id);
      if (error) { toast('Could not save: ' + error.message); return; }
      closeModal(); toast('Saved'); redo();
    };
  });
  body.querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
    const c = cps.find(x => x.id === b.dataset.toggle);
    if (!confirm(c.active ? `Deactivate "${c.name}"? It will no longer be asked in new visits. Past visits are unchanged.` : `Activate "${c.name}" again?`)) return;
    const { error } = await sb.from('fv_checkpoints').update({ active: !c.active }).eq('id', c.id);
    if (error) { toast('Could not update: ' + error.message); return; }
    toast(c.active ? 'Deactivated' : 'Activated'); redo();
  });
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const c = cps.find(x => x.id === b.dataset.del);
    if (!confirm(`PERMANENTLY delete "${c.name}"?\n\nPast visits keep it exactly as it was (name, weightage and result). This cannot be undone. If you only want to stop asking it, use Deactivate instead.`)) return;
    const { error } = await sb.from('fv_checkpoints').delete().eq('id', c.id);
    if (error) { toast('Could not delete: ' + error.message); return; }
    toast('Checkpoint deleted'); redo();
  });
}

// ---------------- TARGETS & KPI (Super Admin) ----------------
async function fvRenderTargets(body) {
  if (!fvCanManage()) { body.innerHTML = emptyState('Only the Super Admin can change KPIs and targets.'); return; }
  body.innerHTML = '<div class="mono">Loading…</div>';
  let targets, ais;
  try {
    targets = await fvLoadTargets();
    const r = await sb.from('profiles').select('id, full_name, employee_id').eq('role', 'team_lead').eq('status', 'active').order('full_name');
    if (r.error) throw r.error; ais = r.data || [];
  } catch (e) { body.innerHTML = fvError(e); return; }
  const today = fvToday(), nameOf = (id) => id ? (ais.find(a => a.id === id)?.full_name || 'Area Incharge') : 'All Area Incharges (default)';
  const cur = (id) => fvTargetFor(targets, id, today);
  const hasOwn = (id) => targets.some(t => t.profile_id === id && t.effective_from <= today);
  const def = fvTargetFor(targets.filter(t => !t.profile_id), null, today);
  body.innerHTML = `
    <div class="fv-panel"><h3>Targets in force today</h3>
      <p class="fv-note" style="margin:0 0 8px;"><strong>On-site visits per month = KPI.</strong> Online visits per month = target only (not part of the KPI).</p>
      <div style="overflow-x:auto;"><table><thead><tr><th>Area Incharge</th><th>On-site KPI / month</th><th>Online target / month</th><th>Setting</th></tr></thead><tbody>
        <tr><td><strong>Default for everyone</strong></td><td>${def.onsite_kpi}</td><td>${def.online_target}</td><td><span class="fv-chip">Default</span></td></tr>
        ${ais.map(a => { const t = cur(a.id); return `<tr><td>${escapeHtml(a.full_name)} <span class="fv-note">${escapeHtml(a.employee_id || '')}</span></td><td>${t.onsite_kpi}</td><td>${t.online_target}</td><td>${hasOwn(a.id) ? '<span class="fv-chip" style="background:#fdf0d5;">Custom</span>' : '<span class="fv-chip">Default</span>'}</td></tr>`; }).join('')}
      </tbody></table></div></div>
    <div class="fv-panel"><h3>Change a KPI / target</h3>
      <div class="fv-filters">
        <label>Applies to <select id="fv-t-who"><option value="">All Area Incharges (default)</option>${ais.map(a => fvOpt(a.id, a.full_name, '')).join('')}</select></label>
        <label>On-site KPI <input type="number" id="fv-t-on" min="0" step="1" value="${def.onsite_kpi}" style="width:90px;"></label>
        <label>Online target <input type="number" id="fv-t-off" min="0" step="1" value="${def.online_target}" style="width:90px;"></label>
        <label>Starts from <input type="date" id="fv-t-from" value="${today}" min="${today}"></label>
        <input type="text" id="fv-t-note" placeholder="Note (optional)" maxlength="150" style="min-width:200px;">
        <button class="btn small" id="fv-t-save" type="button">Save change</button></div>
      <p class="fv-note">The change applies <strong>from the start date</strong> you choose (today or later). Months and visits before it are never affected. Tip: pick the 1st of a month so a whole month uses one value. For a month in which a change takes effect, the value in force on the last day of that month is used.</p></div>
    <div class="fv-panel"><h3>History</h3><div style="overflow-x:auto;max-height:300px;overflow-y:auto;"><table><thead><tr><th>Starts</th><th>Applies to</th><th>On-site KPI</th><th>Online target</th><th>Note</th><th>Set by</th></tr></thead><tbody>
      ${targets.map(t => `<tr><td>${t.effective_from === '2000-01-01' ? 'Initial' : fvFmtDate(t.effective_from)}</td><td>${escapeHtml(nameOf(t.profile_id))}</td><td>${t.onsite_kpi}</td><td>${t.online_target}</td><td>${escapeHtml(t.note || '')}</td><td>${escapeHtml(t.created_by_name || '—')}<div class="fv-note">${formatDate(t.created_at)}</div></td></tr>`).join('')}
      </tbody></table></div></div>`;
  fvGo(body);
  body.querySelector('#fv-t-save').onclick = async () => {
    const who = body.querySelector('#fv-t-who').value || null;
    const on = parseInt(body.querySelector('#fv-t-on').value, 10), off = parseInt(body.querySelector('#fv-t-off').value, 10);
    const from = body.querySelector('#fv-t-from').value, note = body.querySelector('#fv-t-note').value;
    if (!(on >= 0) || !(off >= 0)) { toast('Please enter whole numbers (0 or more).'); return; }
    if (!from || from < today) { toast('The start date cannot be in the past.'); return; }
    if (!confirm(`Apply ${nameOf(who)}: On-site KPI ${on}/month, Online target ${off}/month, starting ${fvFmtDate(from)}?\n\nEarlier data will not change.`)) return;
    const { error } = await sb.rpc('fv_set_targets', { p_profile: who, p_onsite: on, p_online: off, p_from: from, p_note: note });
    if (error) { toast('Could not save: ' + error.message); return; }
    toast('Saved'); fvRenderTargets(body);
  };
}

// ---------------- PAGE ----------------
function fvTabs() {
  if (fvIsRider()) return [['overview', 'My Overview'], ['visits', 'My Visits'], ['issues', 'My Issues']];
  const t = [['overview', 'Overview'], ['visits', 'Visit Summary'], ['issues', 'Issues'], ['riders', 'Rider-wise']];
  if (fvCanAdd()) t.push(['add', 'Add Visit']);
  if (fvCanManage()) t.push(['checklist', 'Checklist'], ['targets', 'Targets & KPI']);
  return t;
}
async function renderFieldVisits() {
  fvEnsureStyle();
  const main = document.getElementById('main-content');
  document.getElementById('topbar-actions').innerHTML = '';
  const tabs = fvTabs();
  if (!tabs.some(t => t[0] === FV.tab)) FV.tab = tabs[0][0];
  main.innerHTML = `<div class="tabs fv-tabs">${tabs.map(([k, l]) => `<button class="tab ${FV.tab === k ? 'active' : ''}" data-fv-tab="${k}">${l}</button>`).join('')}</div><div id="fv-body"></div>`;
  main.querySelectorAll('[data-fv-tab]').forEach(b => b.onclick = () => { FV.tab = b.dataset.fvTab; FV.f.status = ''; FV.f.cp = ''; renderFieldVisits(); });
  const body = document.getElementById('fv-body');
  try {
    if (FV.tab === 'overview') await fvRenderOverview(body);
    else if (FV.tab === 'visits') await fvRenderVisits(body);
    else if (FV.tab === 'issues') await fvRenderIssues(body);
    else if (FV.tab === 'riders') await fvRenderRiders(body);
    else if (FV.tab === 'add') await fvRenderAdd(body);
    else if (FV.tab === 'checklist') await fvRenderChecklist(body);
    else if (FV.tab === 'targets') await fvRenderTargets(body);
  } catch (e) { console.error(e); body.innerHTML = fvError(e); }
}

async function renderHierarchy(){
  const main = document.getElementById('main-content');
  document.getElementById('topbar-actions').innerHTML = '';
  main.innerHTML = `<div class="mono">Loading…</div>`;

  const { data: profiles } = await sb.from('profiles').select('*, regions!region_id(name)').eq('status', 'active').order('full_name');
  const { data: regionLinks } = await sb.from('profile_regions').select('profile_id, region_id');
  const linksByProfile = new Map();
  (regionLinks||[]).forEach(l => { if (!linksByProfile.has(l.profile_id)) linksByProfile.set(l.profile_id, []); linksByProfile.get(l.profile_id).push(l.region_id); });

  const superAdmins = (profiles||[]).filter(p=>p.role==='super_admin');
  const inventoryCoords = (profiles||[]).filter(p=>p.role==='inventory_coordinator');

  const personCard = (p) => `<div style="padding:8px 12px; border:1px solid var(--line); border-radius:8px; margin-bottom:6px;">
    <strong>${escapeHtml(p.full_name)}</strong>${designationTag(p)} <span class="mono">· ${escapeHtml(p.employee_id||'—')}</span>
    <div class="mono" style="font-size:12.5px; color:var(--muted);">${escapeHtml(toLocalPhone(p.phone)||'—')}</div>
  </div>`;

  let html = `
    <div class="card">
      <h3>Super Admin</h3>
      ${superAdmins.map(personCard).join('') || emptyState('None on file')}
    </div>
    <div class="card">
      <h3>Inventory Coordinator (Lahore &amp; Raiwind — reports directly to Super Admin)</h3>
      ${inventoryCoords.map(personCard).join('') || emptyState('None on file')}
    </div>
  `;

  // A person's real working region(s) come from profile_regions if they
  // have any rows there; the legacy single region_id field is only a
  // fallback for when profile_regions is empty. Checking both with OR
  // (the previous bug) caused people to show under two regions whenever
  // a stale region_id was left over from before they were switched to
  // multi-region assignment.
  const personRegionIds = (p) => {
    const links = linksByProfile.get(p.id);
    if (links && links.length) return links;
    return p.region_id ? [p.region_id] : [];
  };

  state.regions.filter(r => r.active !== false).forEach(region => {
    const inRegion = (p) => personRegionIds(p).includes(region.id);
    const leads = (profiles||[]).filter(p => ['team_lead','regional_poc'].includes(p.role) && inRegion(p));
    const coordinators = (profiles||[]).filter(p => p.role==='coordinator' && inRegion(p));
    const riders = (profiles||[]).filter(p => p.role==='rider' && inRegion(p));
    if (!leads.length && !coordinators.length && !riders.length) return;
    html += `
    <div class="card">
      <h3>${escapeHtml(region.name)}</h3>
      <div style="font-size:12.5px; color:var(--muted); margin-bottom:8px;">Area Incharge / Regional POC → Coordinators → Riders</div>
      <div style="margin-left:0;">${leads.map(personCard).join('') || `<p class="hint">No Area Incharge/Regional POC assigned yet</p>`}</div>
      <details style="margin-top:8px;">
        <summary style="cursor:pointer; font-size:13px; color:var(--muted);">Coordinators (${coordinators.length}) ▾</summary>
        <div style="margin-top:8px; margin-left:16px;">${coordinators.map(personCard).join('') || `<p class="hint">None yet</p>`}</div>
      </details>
      <details style="margin-top:8px;">
        <summary style="cursor:pointer; font-size:13px; color:var(--muted);">Riders (${riders.length}) ▾</summary>
        <div style="margin-top:8px; margin-left:16px;">${riders.map(personCard).join('') || `<p class="hint">None yet</p>`}</div>
      </details>
    </div>`;
  });

  main.innerHTML = html;
}

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
async function backfillRosterMobileNumbers(){
  if (!confirm('Fill in the Official Mobile field for every roster entry that\'s missing it, using the phone number already on file in Team? This only fills blanks — it never overwrites a number that\'s already there.')) return;
  const { data: entries } = await sb.from('roster_entries').select('id, rider_id, official_mobile').or('official_mobile.is.null,official_mobile.eq.');
  const missing = (entries||[]).filter(e => !e.official_mobile);
  if (!missing.length){ toast('Nothing to fill — every entry already has a mobile number.'); return; }
  const riderIds = [...new Set(missing.map(e=>e.rider_id))];
  const { data: riders } = await sb.from('profiles').select('id, phone').in('id', riderIds);
  const phoneById = new Map((riders||[]).map(r=>[r.id, r.phone]));
  let filled = 0, skipped = 0;
  for (const entry of missing){
    const phone = phoneById.get(entry.rider_id);
    if (!phone){ skipped++; continue; }
    const { error } = await sb.from('roster_entries').update({ official_mobile: toLocalPhone(phone) }).eq('id', entry.id);
    if (!error) filled++; else skipped++;
  }
  toast(`Filled ${filled} entries${skipped?`, ${skipped} skipped (no phone on file)`:''}`);
  renderRoster();
}

// Counts the Roster summary numbers up (first draw) or from their previous value (after a filter change).
function tweenRosterStats(initial){
  const el = document.getElementById('roster-stats');
  if (!el) return;
  const nums = [...el.querySelectorAll('.stat-number')];
  const next = nums.map(n => parseInt(n.textContent, 10) || 0);
  const prev = state._rosterStatPrev || [];
  state._rosterStatPrev = next;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  nums.forEach((n, i) => {
    const from = initial ? 0 : (prev[i] ?? next[i]);
    const to = next[i];
    if (from === to) return;
    const t0 = performance.now(), dur = 550;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      n.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1 && n.isConnected) requestAnimationFrame(step); else n.textContent = to;
    };
    n.textContent = from;
    requestAnimationFrame(step);
  });
}

async function renderRoster(){
  const main = document.getElementById('main-content');
  const canManage = isAdmin() || hasPermission('roster_manage');
  const canBulkAdd = isAdmin() || hasPermission('roster_bulk_add') || canManage;
  const canBulkUpdate = isAdmin() || hasPermission('roster_bulk_update') || canManage;
  if (canManage || canBulkAdd || canBulkUpdate){
    document.getElementById('topbar-actions').innerHTML = `
      ${canBulkAdd ? `<button class="btn outline" id="bulk-roster-btn">+ Bulk Add</button>` : ''}
      ${canBulkUpdate ? `<button class="btn outline" id="bulk-roster-update-btn">Bulk Update</button>` : ''}
      ${isSuperAdmin() ? `<button class="btn outline" id="backfill-mobile-btn">Fill Missing Mobile Numbers</button>` : ''}
      ${canManage ? `<button class="btn" id="new-roster-btn">+ Add to Roster</button>` : ''}`;
    if (canManage) document.getElementById('new-roster-btn').onclick = () => openRosterModal(null);
    if (canBulkAdd) document.getElementById('bulk-roster-btn').onclick = openBulkRosterModal;
    if (canBulkUpdate) document.getElementById('bulk-roster-update-btn').onclick = openBulkUpdateRosterModal;
    if (isSuperAdmin()) document.getElementById('backfill-mobile-btn').onclick = backfillRosterMobileNumbers;
  } else {
    document.getElementById('topbar-actions').innerHTML = '';
  }
  let query = sb.from('roster_entries').select('*, profiles!rider_id(full_name, employee_id, status, role, designation_id), regions(name), sub_regions(name), shift_types(name)');
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

  // Designation (e.g. Rider / Trainee Rider) of the person on each roster entry
  const entryDesig = (e) => e.profiles ? designationLabel(e.profiles) : '—';
  const desigOrder = (state.designations||[]).map(d => d.name);
  const desigLabels = [...new Set([
    ...entries.map(entryDesig).filter(l => l !== '—'),
    ...(state.designations||[]).filter(d => d.base_role === 'rider' && d.active).map(d => d.name)
  ])].sort((a,b) => {
    const ia = desigOrder.indexOf(a), ib = desigOrder.indexOf(b);
    return (ia<0?999:ia) - (ib<0?999:ib) || a.localeCompare(b);
  });

  // Approved headcount set per designation (e.g. Trainee Rider = 10) vs how many are working now
  const desigApproved = {};
  (state.designations||[]).forEach(d => { if (d.approved_headcount != null) desigApproved[d.name] = d.approved_headcount; });
  const workingByDesigAll = {};
  entries.filter(e => e.status !== 'removed').forEach(e => { const l = entryDesig(e); workingByDesigAll[l] = (workingByDesigAll[l]||0) + 1; });

  const regionCounts = {};
  entries.forEach(e => {
    const name = e.regions?.name || 'Unknown';
    if (!regionCounts[name]) regionCounts[name] = { total:0, working:0, byDesig:{} };
    regionCounts[name].total++;
    if (e.status !== 'removed'){
      regionCounts[name].working++;
      const l = entryDesig(e);
      regionCounts[name].byDesig[l] = (regionCounts[name].byDesig[l]||0) + 1;
    }
  });
  // Grand totals row for the Region-wise counts table
  const grand = { total:0, working:0, headcount:0, pending:0, byDesig:{} };
  Object.entries(regionCounts).forEach(([name,c]) => {
    grand.total += c.total; grand.working += c.working;
    const hc = state.regions.find(r=>r.name===name)?.approved_headcount;
    if (typeof hc === 'number'){ grand.headcount += hc; grand.pending += Math.max(0, hc - c.working); }
    desigLabels.forEach(l => { grand.byDesig[l] = (grand.byDesig[l]||0) + (c.byDesig[l]||0); });
  });

  const renderRows = (list) => list.length ? `<table><thead><tr><th>Rider</th><th>Designation</th><th>Region</th><th>Sub-Region/City</th><th>Hotspot</th><th>Shift</th><th>Day Off</th><th>Official Mobile</th><th>Personal Mobile</th><th>Status</th>${canManage?'<th></th>':''}</tr></thead><tbody>
    ${list.map(e => `<tr>
      <td>${escapeHtml(e.profiles?.full_name||'—')}<div class="mono">${escapeHtml(e.profiles?.employee_id||'')}</div></td>
      <td>${escapeHtml(entryDesig(e))}</td>
      <td>${escapeHtml(e.regions?.name||'—')}</td>
      <td>${escapeHtml(e.sub_regions?.name||'—')}</td>
      <td>${escapeHtml(e.hotspot||'—')}</td>
      <td>${escapeHtml(e.shift_types?.name||'—')}</td>
      <td>${escapeHtml(e.day_off||'—')}</td>
      <td class="mono">${escapeHtml(e.official_mobile||'—')}</td>
      <td class="mono">${escapeHtml(e.personal_mobile||'—')}</td>
      <td>${e.status==='removed'
        ? `<span class="badge open">${escapeHtml(e.removal_reason||'Removed')}${e.status_date?' — '+formatDate(e.status_date):''}</span>${e.replacement_pending?' <span class="badge pending">Replacement pending</span>':''}`
        : '<span class="badge active">Approved / Working</span>'}
        ${(() => {
          const loginDisabled = e.profiles?.status === 'disabled';
          const rosterWorking = e.status !== 'removed';
          if (loginDisabled && rosterWorking){
            return `<div><span class="badge open" title="Login is disabled but roster still shows them as working">⚠️ Login disabled</span>${isSuperAdmin() ? ` <button class="btn small outline" data-sync-roster="${e.id}" data-sync-direction="remove">Sync (mark removed)</button>` : ''}</div>`;
          }
          if (!loginDisabled && !rosterWorking && e.profiles?.status === 'active'){
            return `<div><span class="badge pending" title="Roster shows removed but login is still active">⚠️ Login still active</span>${isSuperAdmin() ? ` <button class="btn small outline" data-sync-roster="${e.id}" data-sync-direction="disable">Sync (disable login)</button>` : ''}</div>`;
          }
          return '';
        })()}
      </td>
      ${canManage ? `<td style="white-space:nowrap;">
        <button class="btn small outline" data-edit-roster="${e.id}">Edit</button>
        ${e.status!=='removed' ? `<button class="btn small danger" data-remove-roster="${e.id}" title="Mark Resigned / Terminated / Transferred">Change Status</button>` : ''}
        ${(e.status==='removed' && isSuperAdmin()) ? `<button class="btn small outline" data-reinstate-roster="${e.id}">Reinstate (undo mistake)</button>` : ''}
        ${isSuperAdmin() ? `<button class="btn small danger" data-delete-roster="${e.id}">Delete Permanently</button>` : ''}
      </td>` : ''}
    </tr>`).join('')}
  </tbody></table>` : emptyState('No roster entries match this filter.');

  const renderStats = (list) => {
    const total = list.length;
    const active = list.filter(e=>e.status!=='removed').length;
    const replacementPending = list.filter(e=>e.status==='removed' && e.replacement_pending).length;
    return `<div class="roster-stat-row">
      <div class="card stat-card sky" data-stat-filter="" style="cursor:pointer; padding:12px;"><div class="stat-number">${total}</div><div class="stat-label" style="font-size:12px; overflow-wrap:break-word;">${desigLabels.length > 1 ? 'Total (All)' : 'Total Riders'}</div></div>
      <div class="card stat-card clay" data-stat-filter="active" style="cursor:pointer; padding:12px;"><div class="stat-number">${active}</div><div class="stat-label" style="font-size:12px; overflow-wrap:break-word;">Approved / Working</div></div>
      <div class="card stat-card amber" data-stat-filter="removed" style="cursor:pointer; padding:12px;"><div class="stat-number">${total-active}</div><div class="stat-label" style="font-size:12px; overflow-wrap:break-word;">Resigned/Terminated/Transferred</div></div>
      <div class="card stat-card amber" data-stat-filter="replacement" style="cursor:pointer; padding:12px;"><div class="stat-number">${replacementPending}</div><div class="stat-label" style="font-size:12px; overflow-wrap:break-word;">Replacement Needed</div></div>
      <div class="card stat-card amber" style="padding:12px;" title="Approved headcount minus currently working, summed over regions that have an approved headcount"><div class="stat-number">${grand.pending}</div><div class="stat-label" style="font-size:12px; overflow-wrap:break-word;">Pending Hiring<br><span style="opacity:.8;">by region headcount</span></div></div>
      ${desigLabels.map(l => {
        const mine = list.filter(e => entryDesig(e) === l);
        const w = mine.filter(e => e.status !== 'removed').length;
        const approved = desigApproved[l];
        const approvedLine = (approved != null)
          ? `<br><span style="opacity:.8;">${approved} approved · ${Math.max(0, approved - (workingByDesigAll[l]||0))} to hire</span>` : '';
        return `<div class="card stat-card sky" data-desig-filter="${escapeHtml(l)}" style="cursor:pointer; padding:12px;"><div class="stat-number">${mine.length}</div><div class="stat-label" style="font-size:12px; overflow-wrap:break-word;">${escapeHtml(/s$/i.test(l) ? l : l + 's')}<br><span style="opacity:.8;">${w} working</span>${approvedLine}</div></div>`;
      }).join('')}
    </div>`;
  };

  main.innerHTML = `
    <style>
      /* Frozen summary bar. The colour "bleed" (box-shadow + clip-path) makes the bar's background
         stretch the full width of the page, so wide table content can never show beside it. */
      #roster-stats { position: sticky; top: 0; z-index: 30; padding: 10px 0 12px;
        box-shadow: 0 0 0 100vmax var(--rs-bg, #f4f6fb); clip-path: inset(0 -100vmax -1px 0); }
      #roster-stats.stuck { box-shadow: 0 0 0 100vmax var(--rs-bg, #f4f6fb), 0 1px 0 100vmax rgba(30,42,110,.16); }
      .roster-stat-row { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(130px, 1fr); gap: 10px; overflow-x: auto; padding: 4px 2px 6px; scrollbar-width: thin; }
      .roster-stat-row .stat-card { min-width: 0; padding: 9px 12px !important; background: #fff; border: 1px solid rgba(30,42,110,.10);
        border-left: 4px solid #3f7399; border-radius: 12px; box-shadow: 0 1px 2px rgba(30,42,110,.06);
        transition: transform .16s ease, box-shadow .16s ease; }
      .roster-stat-row .stat-card.clay  { border-left-color: #c0532f; }
      .roster-stat-row .stat-card.amber { border-left-color: #d9962b; }
      .roster-stat-row .stat-card[data-stat-filter]:hover, .roster-stat-row .stat-card[data-desig-filter]:hover { transform: translateY(-2px); box-shadow: 0 8px 18px rgba(30,42,110,.14); }
      .roster-stat-row .stat-number { font-size: 24px !important; line-height: 1.1; font-variant-numeric: tabular-nums; }
      .roster-stat-row .stat-label { font-size: 11.5px !important; line-height: 1.3; }
      @keyframes rsIn { from { opacity: 0; transform: translateY(10px) scale(.97); } to { opacity: 1; transform: none; } }
      #roster-stats.intro .stat-card { animation: rsIn .5s cubic-bezier(.2,.7,.2,1) both; }
      #roster-stats.intro .stat-card:nth-child(2) { animation-delay: .06s; }
      #roster-stats.intro .stat-card:nth-child(3) { animation-delay: .12s; }
      #roster-stats.intro .stat-card:nth-child(4) { animation-delay: .18s; }
      #roster-stats.intro .stat-card:nth-child(5) { animation-delay: .24s; }
      #roster-stats.intro .stat-card:nth-child(6) { animation-delay: .30s; }
      #roster-stats.intro .stat-card:nth-child(7) { animation-delay: .36s; }
      #roster-stats.intro .stat-card:nth-child(8) { animation-delay: .42s; }
      @media (prefers-reduced-motion: reduce) {
        #roster-stats.intro .stat-card { animation: none; }
        .roster-stat-row .stat-card { transition: none; }
      }
    </style>
    <div id="roster-stats-sentinel" style="height:1px; margin-bottom:-1px;"></div>
    <div id="roster-stats">${renderStats(entries)}</div>
    ${reasons.length ? `<div class="hint" style="margin-bottom:10px;">Breakdown: ${reasons.map(r=>`${escapeHtml(r)}: ${removedByReason[r]}`).join(' · ')}</div>` : ''}
    <details style="margin-bottom:14px;">
      <summary style="cursor:pointer; font-size:13px; color:var(--muted); user-select:none;">Region-wise counts ▾</summary>
      <table style="margin-top:8px;"><thead><tr><th>Region</th><th>Total</th><th>Currently Working</th>${desigLabels.map(l=>`<th>${escapeHtml(l)} (Working)</th>`).join('')}<th>Approved Headcount</th><th>Pending Hiring</th></tr></thead><tbody>
        ${Object.entries(regionCounts).map(([name,c]) => {
          const region = state.regions.find(r=>r.name===name);
          return `<tr><td>${escapeHtml(name)}</td><td class="mono">${c.total}</td><td class="mono">${c.working}</td>${desigLabels.map(l=>`<td class="mono">${c.byDesig[l]||0}</td>`).join('')}<td class="mono">${region?.approved_headcount ?? '—'}</td><td class="mono">${region?.approved_headcount != null ? Math.max(0, region.approved_headcount - c.working) : '—'}</td></tr>`;
        }).join('')}
        <tr style="font-weight:700; border-top:2px solid var(--line); background:var(--bg, #f5f6fa);"><td>Grand Total</td><td class="mono">${grand.total}</td><td class="mono">${grand.working}</td>${desigLabels.map(l=>`<td class="mono">${grand.byDesig[l]||0}</td>`).join('')}<td class="mono">${grand.headcount}</td><td class="mono">${grand.pending}</td></tr>
      </tbody></table>
      ${Object.keys(desigApproved).length ? `<table style="margin-top:14px;"><thead><tr><th>Designation (company-wide)</th><th>Currently Working</th><th>Approved Headcount</th><th>Pending Hiring</th></tr></thead><tbody>
        ${Object.entries(desigApproved).map(([l,a]) => `<tr><td>${escapeHtml(l)}</td><td class="mono">${workingByDesigAll[l]||0}</td><td class="mono">${a}</td><td class="mono">${Math.max(0, a - (workingByDesigAll[l]||0))}</td></tr>`).join('')}
      </tbody></table>` : ''}
    </details>
    <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px;">
      <select id="rf-region"><option value="">All Regions</option>${state.regions.map(r=>`<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')}</select>
      <select id="rf-designation"><option value="">All Designations</option>${desigLabels.map(l=>`<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('')}</select>
      <select id="rf-shift"><option value="">All Shifts</option>${shiftNames.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}</select>
      <select id="rf-dayoff"><option value="">All Day-Offs</option>${dayOffs.map(d=>`<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('')}</select>
      <select id="rf-status"><option value="">All Statuses</option><option value="active">Approved / Working</option><option value="removed">Resigned/Terminated/Transferred</option></select>
      ${reasons.length ? `<select id="rf-reason"><option value="">All Reasons</option>${reasons.map(r=>`<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}</select>` : ''}
      <input type="text" id="rf-search" placeholder="Search rider name or Employee ID…" style="flex:1; min-width:160px;">
    </div>
    <div style="display:flex; gap:8px; margin-bottom:10px;">
      <button class="btn small outline" id="roster-download-filtered-btn">Download Filtered</button>
      <button class="btn small outline" id="roster-download-all-btn">Download All</button>
    </div>
    <div id="roster-list">${renderRows(entries)}</div>`;

  const toCsvRows = (list) => list.map(e => ({
    Rider: e.profiles?.full_name||'', 'Employee ID': e.profiles?.employee_id||'', Designation: entryDesig(e),
    Region: e.regions?.name||'', 'Sub-Region': e.sub_regions?.name||'', Hotspot: e.hotspot||'',
    Shift: e.shift_types?.name||'', 'Day Off': e.day_off||'',
    'Official Mobile': toLocalPhone(e.official_mobile)||e.official_mobile||'', 'Personal Mobile': toLocalPhone(e.personal_mobile)||e.personal_mobile||'',
    Status: e.status==='removed' ? (e.removal_reason||'Removed') : 'Working',
    'Status Date': e.status_date||''
  }));
  let currentFiltered = entries;
  document.getElementById('roster-download-all-btn').onclick = () => {
    downloadCSV(`roster-all-${new Date().toISOString().slice(0,10)}.csv`, toCSV(toCsvRows(entries)));
  };
  document.getElementById('roster-download-filtered-btn').onclick = () => {
    downloadCSV(`roster-filtered-${new Date().toISOString().slice(0,10)}.csv`, toCSV(toCsvRows(currentFiltered)));
  };

  const applyFilters = () => {
    const region = document.getElementById('rf-region').value;
    const desig = document.getElementById('rf-designation').value;
    const shift = document.getElementById('rf-shift').value;
    const dayOff = document.getElementById('rf-dayoff').value;
    const status = document.getElementById('rf-status').value;
    const reason = document.getElementById('rf-reason')?.value || '';
    const q = document.getElementById('rf-search').value.toLowerCase();
    const filtered = entries.filter(e =>
      (!region || e.region_id === region) &&
      (!desig || entryDesig(e) === desig) &&
      (!shift || e.shift_types?.name === shift) &&
      (!dayOff || e.day_off === dayOff) &&
      (!status || (status==='removed' ? e.status==='removed' : e.status!=='removed')) &&
      (!reason || e.removal_reason === reason) &&
      (!q || (e.profiles?.full_name||'').toLowerCase().includes(q) || (e.profiles?.employee_id||'').toLowerCase().includes(q))
    );
    currentFiltered = filtered;
    document.getElementById('roster-stats').innerHTML = renderStats(filtered);
    tweenRosterStats(false);
    bindStatClicks();
    document.getElementById('roster-list').innerHTML = renderRows(filtered);
    bindRowActions();
  };
  ['rf-region','rf-designation','rf-shift','rf-dayoff','rf-status','rf-reason'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.onchange = applyFilters;
  });
  document.getElementById('rf-search').oninput = applyFilters;

  (function freezeRosterStats(){
    const el = document.getElementById('roster-stats');
    if (!el) return;
    let bg = '', n = el.parentElement;
    while (n){
      const c = getComputedStyle(n).backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent'){ bg = c; break; }
      n = n.parentElement;
    }
    el.style.background = bg || '#f4f6fb';
    el.style.setProperty('--rs-bg', bg || '#f4f6fb');
    const tb = document.querySelector('.topbar');
    let off = 0;
    if (tb){ const pos = getComputedStyle(tb).position; if (pos === 'sticky' || pos === 'fixed') off = tb.offsetHeight; }
    el.style.top = off + 'px';
    // Entrance animation (first draw only) + numbers counting up
    el.classList.add('intro');
    setTimeout(() => el.classList.remove('intro'), 1200);
    tweenRosterStats(true);
    // Soft separator line appears only while the bar is actually pinned
    const sentinel = document.getElementById('roster-stats-sentinel');
    if (sentinel && 'IntersectionObserver' in window){
      new IntersectionObserver(([en]) => {
        el.classList.toggle('stuck', !en.isIntersecting && en.boundingClientRect.top < off + 1);
      }, { rootMargin: `-${off + 1}px 0px 0px 0px` }).observe(sentinel);
    }
  })();

  function bindStatClicks(){
    document.querySelectorAll('[data-desig-filter]').forEach(card => {
      card.onclick = () => {
        document.getElementById('rf-designation').value = card.dataset.desigFilter;
        applyFilters();
        document.getElementById('roster-list').scrollIntoView({behavior:'smooth', block:'start'});
      };
    });
    document.querySelectorAll('[data-stat-filter]').forEach(card => {
      card.onclick = () => {
        const which = card.dataset.statFilter;
        if (which === '') document.getElementById('rf-designation').value = '';
        document.getElementById('rf-status').value = which === 'replacement' ? 'removed' : which;
        if (document.getElementById('rf-reason')) document.getElementById('rf-reason').value = '';
        applyFilters();
        if (which === 'replacement'){
          const replacementList = currentFiltered.filter(e=>e.status==='removed' && e.replacement_pending);
          document.getElementById('roster-list').innerHTML = renderRows(replacementList);
          bindRowActions();
        }
        document.getElementById('roster-list').scrollIntoView({behavior:'smooth', block:'start'});
      };
    });
  }
  bindStatClicks();

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
        const region = state.regions.find(r=>r.id===entry.region_id);
        if (region?.approved_headcount != null){
          const { count: workingCount } = await sb.from('roster_entries').select('id', {count:'exact', head:true}).eq('region_id', entry.region_id).neq('status','removed');
          if ((workingCount||0) >= region.approved_headcount){
            toast(`Cannot reinstate — ${region.name} already has ${workingCount} working rider(s), matching its approved headcount of ${region.approved_headcount}.`);
            return;
          }
        }
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
    document.querySelectorAll('[data-sync-roster]').forEach(btn => {
      btn.onclick = async () => {
        const entry = entries.find(e=>e.id===btn.dataset.syncRoster);
        const direction = btn.dataset.syncDirection;
        if (direction === 'remove'){
          if (!confirm(`${entry.profiles?.full_name||'This rider'}'s login is disabled but Roster still shows them working. Mark their roster entry as removed to match?`)) return;
          const { error } = await sb.from('roster_entries').update({
            status: 'removed', removal_reason: 'Login Disabled', removal_note: 'Synced manually — login was already disabled but roster had not been updated.'
          }).eq('id', entry.id);
          if (error){ toast('Could not sync: ' + error.message); return; }
        } else {
          if (!confirm(`${entry.profiles?.full_name||'This rider'}'s roster shows removed but their login is still active. Disable their login to match?`)) return;
          const { error } = await sb.from('profiles').update({ status: 'disabled' }).eq('id', entry.rider_id);
          if (error){ toast('Could not sync: ' + error.message); return; }
        }
        toast('Synced'); renderRoster();
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

  // Auto-fetch the rider's mobile number (and region) from their Team
  // profile when adding a fresh entry, so it doesn't need retyping.
  if (!entry){
    const applyRiderDefaults = (riderId) => {
      const rider = riders.find(p=>p.id===riderId);
      if (!rider) return;
      if (rider.phone) document.getElementById('ro-official').value = toLocalPhone(rider.phone);
      if (rider.region_id){
        document.getElementById('ro-region').value = rider.region_id;
        loadSubRegions(rider.region_id, null);
        loadHotspots(rider.region_id, null, null);
      }
    };
    document.getElementById('ro-rider').onchange = (e) => applyRiderDefaults(e.target.value);
    if (document.getElementById('ro-rider').value) applyRiderDefaults(document.getElementById('ro-rider').value);
  }

  document.getElementById('roster-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!confirm(entry ? 'Save these changes to the roster entry?' : 'Add this rider to the roster with these details?')) return;
    const riderId = document.getElementById('ro-rider').value;
    const regionId = document.getElementById('ro-region').value;
    if (!entry){
      const { data: existingActive } = await sb.from('roster_entries').select('id').eq('rider_id', riderId).neq('status', 'removed').maybeSingle();
      if (existingActive){ toast('This rider already has an active roster entry — edit that one instead of creating a duplicate.'); return; }
    }
    // Approved headcount check — only blocks when adding a NEW working
    // entry, or when re-approving into a region that's already full.
    const isNewOrReactivating = !entry || (entry.status === 'removed');
    if (isNewOrReactivating){
      const region = state.regions.find(r=>r.id===regionId);
      if (region?.approved_headcount != null){
        const { count: workingCount } = await sb.from('roster_entries').select('id', {count:'exact', head:true}).eq('region_id', regionId).neq('status','removed');
        if ((workingCount||0) >= region.approved_headcount){
          toast(`Cannot add — ${region.name} already has ${workingCount} working rider(s), matching its approved headcount of ${region.approved_headcount}. Ask Super Admin to raise the approved count in Regions if this is intentional.`);
          return;
        }
      }
    }
    const payload = {
      rider_id: riderId,
      region_id: regionId,
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
    const { data: allSubRegions } = await sb.from('sub_regions').select('*').eq('active', true);
    const { data: allShifts } = await sb.from('shift_types').select('*').eq('active', true);
    const { data: allHotspots } = await sb.from('hotspots').select('*').eq('active', true);
    const isKnownRegion = (s) => state.regions.some(r => r.name.toLowerCase() === (s||'').trim().toLowerCase());

    const rows = [];
    for (const line of lines){
      const parts = line.split(/\t|,/).map(p=>p.trim());
      const empId = parts[0];
      // Auto-detect an extra "Name" column: if the 2nd field isn't a real
      // region, assume it's a name and shift everything over by one.
      let regionName, subRegionName, shiftName, dayOff, hotspotName;
      if (isKnownRegion(parts[1])){
        [regionName, subRegionName, shiftName, dayOff, hotspotName] = [parts[1], parts[2], parts[3], parts[4], parts[5]];
      } else {
        [regionName, subRegionName, shiftName, dayOff, hotspotName] = [parts[2], parts[3], parts[4], parts[5], parts[6]];
      }
      const rider = state.profilesInScope.find(p => (p.employee_id||'').toLowerCase() === (empId||'').toLowerCase());
      if (!rider){ rows.push({ empId, ok:false, msg:'No rider found with this Employee ID (or outside your access)' }); continue; }
      const { data: existingActive } = await sb.from('roster_entries').select('id').eq('rider_id', rider.id).neq('status', 'removed').maybeSingle();
      if (existingActive){ rows.push({ empId, ok:false, msg:`${rider.full_name} already has an active roster entry — skipped` }); continue; }
      const region = state.regions.find(r => r.name.toLowerCase() === (regionName||'').toLowerCase());
      if (!region){ rows.push({ empId, ok:false, msg:`Region "${regionName}" not found — check spelling matches Settings exactly` }); continue; }
      const subRegion = subRegionName ? (allSubRegions||[]).find(s => s.region_id===region.id && s.name.toLowerCase()===subRegionName.toLowerCase()) : null;
      if (subRegionName && !subRegion){ rows.push({ empId, ok:false, msg:`Sub-Region "${subRegionName}" not found for ${region.name} — not added` }); continue; }
      const shift = shiftName ? (allShifts||[]).find(s => s.name.toLowerCase() === shiftName.toLowerCase()) : null;
      if (shiftName && !shift){ rows.push({ empId, ok:false, msg:`Shift "${shiftName}" not found in Shift Types — not added` }); continue; }
      let hotspotFinal = null;
      if (hotspotName){
        const hs = (allHotspots||[]).find(h => h.region_id===region.id && h.name.toLowerCase()===hotspotName.toLowerCase());
        if (!hs){ rows.push({ empId, ok:false, msg:`Hotspot "${hotspotName}" not found for ${region.name} in Settings → Hotspots — not added` }); continue; }
        hotspotFinal = hs.name;
      }
      const { error } = await sb.from('roster_entries').insert({
        rider_id: rider.id, region_id: region.id, sub_region_id: subRegion?.id || null,
        shift_id: shift?.id || null, day_off: dayOff || null, hotspot: hotspotFinal,
        official_mobile: rider.phone ? toLocalPhone(rider.phone) : null,
        created_by: state.user.id
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

function openBulkUpdateRosterModal(){
  openModal(`
    <h2>Bulk update one field</h2>
    <p class="hint">Update a single field (e.g. just Hotspot, or just Day Off) for many riders at once, without touching anything else on their entry.</p>
    <form id="bulk-roster-update-form">
      <div class="form-row"><label>Field to update</label><select id="bru-field">
        <option value="shift">Shift</option>
        <option value="hotspot">Hotspot</option>
        <option value="dayoff">Day Off</option>
        <option value="subregion">Sub-Region / City</option>
        <option value="official_mobile">Official Mobile</option>
        <option value="personal_mobile">Personal Mobile</option>
      </select></div>
      <div class="form-row"><label>Employee ID, new value — one per line</label>
        <textarea id="bru-rows" rows="8" placeholder="EMP1001, DHA Phase 5
EMP1002, Model Town"></textarea>
        <span class="field-hint">For Shift/Hotspot/Sub-Region, the value must exactly match an existing entry in Settings — anything that doesn't match will be rejected with an error rather than silently skipped.</span>
      </div>
      <button class="btn-primary" type="submit" style="margin-top:12px;">Update All</button>
    </form>
    <div id="bulk-roster-update-results" style="margin-top:14px;"></div>
  `);
  document.getElementById('bulk-roster-update-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!confirm('Apply this update to every Employee ID listed? Please double-check the field and values before confirming.')) return;
    const field = document.getElementById('bru-field').value;
    const lines = document.getElementById('bru-rows').value.split('\n').map(l=>l.trim()).filter(Boolean);
    if (!lines.length) return;
    const resultsEl = document.getElementById('bulk-roster-update-results');
    resultsEl.innerHTML = '<div class="mono">Processing…</div>';

    await loadScopedProfiles();
    const { data: allShifts } = await sb.from('shift_types').select('*').eq('active', true);
    const { data: allSubs } = await sb.from('sub_regions').select('*').eq('active', true);
    const { data: allHotspots } = await sb.from('hotspots').select('*').eq('active', true);

    const rows = [];
    for (const line of lines){
      const parts = line.split(/\t|,/).map(p=>p.trim());
      const [empId, ...rest] = parts;
      const value = rest.join(', ').trim();
      const rider = state.profilesInScope.find(p => (p.employee_id||'').toLowerCase() === (empId||'').toLowerCase());
      if (!rider){ rows.push({ empId, ok:false, msg:'No rider found with this Employee ID' }); continue; }
      const { data: entry } = await sb.from('roster_entries').select('id, region_id').eq('rider_id', rider.id).neq('status', 'removed').maybeSingle();
      if (!entry){ rows.push({ empId, ok:false, msg:'No active roster entry — use Bulk Add instead' }); continue; }
      if (!value){ rows.push({ empId, ok:false, msg:'No value given' }); continue; }

      let payload = {};
      if (field === 'shift'){
        const shift = (allShifts||[]).find(s => s.name.toLowerCase() === value.toLowerCase());
        if (!shift){ rows.push({ empId, ok:false, msg:`"${value}" is not a Shift Type — check Settings → Shift Types spelling. Not applied.` }); continue; }
        payload.shift_id = shift.id;
      } else if (field === 'hotspot'){
        const hotspot = (allHotspots||[]).find(h => h.name.toLowerCase() === value.toLowerCase() && (h.region_id === entry.region_id));
        if (!hotspot){ rows.push({ empId, ok:false, msg:`"${value}" is not a Hotspot set up for this rider's region — check Settings → Hotspots. Not applied.` }); continue; }
        payload.hotspot = hotspot.name;
      } else if (field === 'subregion'){
        const sub = (allSubs||[]).find(s => s.name.toLowerCase() === value.toLowerCase() && s.region_id === entry.region_id);
        if (!sub){ rows.push({ empId, ok:false, msg:`"${value}" is not a Sub-Region for this rider's region. Not applied.` }); continue; }
        payload.sub_region_id = sub.id;
      } else if (field === 'dayoff'){
        payload.day_off = value;
      } else if (field === 'official_mobile' || field === 'personal_mobile'){
        payload[field] = value;
      }
      const { error } = await sb.from('roster_entries').update(payload).eq('id', entry.id);
      rows.push({ empId, ok: !error, msg: error ? error.message : `Updated — ${rider.full_name}` });
    }
    resultsEl.innerHTML = `<table><thead><tr><th>Employee ID</th><th>Result</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td class="mono">${escapeHtml(r.empId)}</td><td>${r.ok?`<span class="badge active">${escapeHtml(r.msg)}</span>`:`<span class="badge open">${escapeHtml(r.msg)}</span>`}</td></tr>`).join('')}
    </tbody></table>`;
    toast(`${rows.filter(r=>r.ok).length} of ${rows.length} updated`);
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
        <div class="form-row"><label>Mobile Number</label><input type="text" value="${escapeHtml(toLocalPhone(p.phone)||'')}" disabled></div>
        <div class="form-row"><label>Employee ID</label><input type="text" value="${escapeHtml(p.employee_id||'—')}" disabled></div>
      </div>
      ${p.role==='rider' ? `<div class="form-row"><label>Bike Number</label><input type="text" id="mp-bike" value="${escapeHtml(p.bike_number||'')}"></div>` : ''}
      <div class="form-row"><label>Role</label><input type="text" value="${escapeHtml(designationLabel(p))}" disabled></div>
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
  overlay.innerHTML = `<div class="modal"><button class="modal-close" onclick="requestCloseModal()">✕</button>${innerHtml}</div>`;
  overlay.onclick = (e) => { if (e.target === overlay) requestCloseModal(); };
  document.body.appendChild(overlay);
  // Focus the first text input in the modal so typing/shortcuts work immediately
  setTimeout(() => { overlay.querySelector('input,textarea,select')?.focus(); }, 30);
}
function closeModal(){
  const m = document.getElementById('active-modal');
  if (m) m.remove();
}
// Used for accidental dismissal (outside click, X button, Esc) — if the
// form has anything typed in it, confirm before discarding. Successful
// saves call closeModal() directly and skip this, since that's intentional.
function requestCloseModal(){
  const m = document.getElementById('active-modal');
  if (!m) return;
  const fields = m.querySelectorAll('input[type="text"], input[type="tel"], input[type="email"], input[type="number"], input[type="date"], input[type="datetime-local"], textarea');
  let hasContent = false;
  fields.forEach(f => { if (f.value && f.value.trim()) hasContent = true; });
  if (hasContent && !confirm("Discard what you've typed and close this form?")) return;
  closeModal();
}

// Global keyboard shortcuts (see Settings > Keyboard Shortcuts for the full list)
window.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  // Esc: close the topmost modal, or dismiss the newest toast if no modal is open
  if (e.key === 'Escape'){
    if (document.getElementById('active-modal')){ requestCloseModal(); return; }
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

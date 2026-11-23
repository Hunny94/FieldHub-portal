/* FieldHub UI layer v3 (portal v91).
   Look and feel only: phone top bar with a "More" menu (Option A), nothing covering content, Medium animations,
   tidier buttons, a guard against double-tapping Save, and the Fuel Trends "litres per visit" list.
   v2: thin menu line on computers, profile menu (desktop), "Ask FieldHub", glass dashboard with trend lines and a
   "This week" chart, sign-in busy/shake. Dashboard trends read a few small columns once and keep them 5 minutes on the
   device. Nothing is written to the database. Logo, favicons and branding are not touched.
   To undo everything: remove the ui.js line from index.html. */
(function () {
  'use strict';
  if (window.__fhUi) return; window.__fhUi = 1;
  const PHONE = 760;
  const RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------------------------------------------------------------- styles
  const CSS = `
/* ---------- phone top bar: brand + bell + More (Option A) ---------- */
#fh-more-btn{display:none}
#fh-more-menu{position:fixed;z-index:5001;min-width:230px;max-width:calc(100vw - 16px);background:#fff;border:1px solid #dfe4f1;border-radius:14px;box-shadow:0 14px 36px rgba(15,23,60,.24);padding:6px;transform-origin:top right;animation:fhMenuIn .18s ease-out both}
#fh-more-menu button{display:flex;align-items:center;gap:12px;width:100%;min-height:46px;padding:0 12px;border:0;border-radius:10px;background:transparent;color:#1b2150;font:500 15px var(--font-body,Inter,sans-serif);text-align:left;cursor:pointer}
#fh-more-menu button:hover,#fh-more-menu button:focus-visible{background:#eef1fb}
#fh-more-menu button .i{width:22px;text-align:center;font-size:17px}
#fh-more-menu button.danger{color:#c0392b;border-top:1px solid #eef0f7;border-radius:0 0 10px 10px}
@keyframes fhMenuIn{from{opacity:0;transform:scale(.92) translateY(-6px)}to{opacity:1;transform:none}}
html.fh-dark #fh-more-menu{background:#171e46;border-color:#2b3470;box-shadow:0 14px 36px rgba(0,0,0,.5)}
html.fh-dark #fh-more-menu button{color:#e6e9ff}
html.fh-dark #fh-more-menu button:hover,html.fh-dark #fh-more-menu button:focus-visible{background:#232c63}
html.fh-dark #fh-more-menu button.danger{color:#ff9b8f;border-color:#2b3470}
@media (max-width:${PHONE}px){
  .top-ribbon-actions #fh-bot-btn,.top-ribbon-actions #ribbon-theme,.top-ribbon-actions #ribbon-reload,.top-ribbon-actions #ribbon-print,.top-ribbon-actions #ribbon-profile-btn,.top-ribbon-actions #logout-btn{display:none!important}
  .top-ribbon-actions{gap:6px!important;flex:0 0 auto!important}
  .top-ribbon-actions #notif-bell-btn,.top-ribbon-actions #fh-more-btn{display:inline-flex!important;align-items:center;justify-content:center;width:44px!important;height:44px!important;min-width:44px!important;padding:0!important;border-radius:12px!important;font-size:19px!important;line-height:1!important;background:rgba(255,255,255,.12)!important}
  .top-ribbon-actions #fh-more-btn{font-size:22px!important;font-weight:700}
  .top-ribbon-actions #fh-more-btn[aria-expanded="true"]{background:rgba(255,255,255,.3)!important}
  #fh-menu-btn{width:44px!important;height:44px!important}
  .top-ribbon-brand{gap:8px!important}
  .top-ribbon-brand .ribbon-title{font-size:17px!important;overflow:visible!important}
  #notif-badge{top:4px!important;right:4px!important;min-width:16px;text-align:center}
}

/* ---------- nothing may cover content ---------- */
@media (max-width:${PHONE}px){
  /* notices: a slim bar at the very bottom; while a pop-up form is open they move to the top, so they never cover its Save button */
  #fh-toasts{top:auto!important;bottom:calc(12px + env(safe-area-inset-bottom,0px))!important;left:10px!important;right:10px!important;max-width:none!important;align-items:stretch!important}
  #fh-toasts .toast{max-width:none!important;width:100%;box-sizing:border-box;padding:9px 8px 9px 12px!important;font-size:13.5px!important;gap:10px!important}
  body:has(.modal-overlay) #fh-toasts{top:calc(env(safe-area-inset-top,0px) + 10px)!important;bottom:auto!important}
  #fh-totop{right:14px!important;bottom:calc(16px + env(safe-area-inset-bottom,0px))!important;width:42px!important;height:42px!important}
  .main-content{padding-bottom:calc(76px + env(safe-area-inset-bottom,0px))!important}
  .modal{padding-bottom:calc(20px + env(safe-area-inset-bottom,0px))!important}
  #notif-dropdown{max-width:calc(100vw - 16px)}
}
body:has(#fh-toasts .toast) #fh-totop,body:has(.modal-overlay) #fh-totop,body.fh-drawer-open #fh-totop,body:has(#fh-bot.open) #fh-totop,body:has(#fh-more-menu) #fh-totop{opacity:0!important;pointer-events:none!important}

#fh-toasts .tq-more{background:transparent!important;border:0!important;box-shadow:none!important;padding:0 2px!important}

/* ---------- Medium animations (run on the device only) ---------- */
.fh-rv{animation-fill-mode:backwards!important}
.btn,.fv-btn,.ribbon-link,.nav-link,.tab,.fh-quick a,.fh-quick button,#fh-more-menu button{transition:transform .12s ease,background-color .15s ease,box-shadow .2s ease,filter .15s ease}
.btn:active,.fv-btn:active,.ribbon-link:not(#fh-menu-btn):active,.tab:active,.fh-quick a:active,.fh-quick button:active,#fh-more-menu button:active,#fh-more-btn:active{transform:scale(.96)}
@media (hover:hover) and (min-width:${PHONE + 1}px){
  .stat-card{transition:transform .2s ease,box-shadow .2s ease}
  .stat-card:hover{transform:translateY(-3px);box-shadow:0 10px 24px rgba(30,42,110,.13)}
}
.toast{animation:fhToastIn .3s cubic-bezier(.2,.8,.2,1) both}
.toast .ti{display:inline-block;animation:fhTick .45s cubic-bezier(.2,1.5,.4,1) .08s both}
@keyframes fhToastIn{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
@keyframes fhTick{from{transform:scale(0)}to{transform:scale(1)}}
#notif-bell-btn.fh-ring{animation:fhRing .9s ease-in-out}
@keyframes fhRing{0%,100%{transform:rotate(0)}15%{transform:rotate(14deg)}30%{transform:rotate(-12deg)}45%{transform:rotate(8deg)}60%{transform:rotate(-5deg)}75%{transform:rotate(2deg)}}
#notif-dropdown{animation:fhMenuIn .18s ease-out both;transform-origin:top right}
/* double-tap guard: the Save button shows it is working */
.fh-busy{pointer-events:none!important;opacity:.8}
.fh-busy::after{content:'';display:inline-block;width:12px;height:12px;margin-left:8px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-2px;animation:fhSpin .7s linear infinite}
@keyframes fhSpin{to{transform:rotate(360deg)}}

/* ---------- buttons: one style, easy to tap, clear focus ---------- */
.btn:disabled,.fv-btn:disabled{opacity:.55;cursor:not-allowed}
button:focus-visible,a:focus-visible,[role="button"]:focus-visible{outline:3px solid #8da0ff!important;outline-offset:2px}
@media (max-width:${PHONE}px){
  .main-content .btn:not(.small),.modal .btn:not(.small),.modal .btn-primary{min-height:42px}
  .main-content .btn.small,.modal .btn.small{min-height:34px}
  .modal .form-row input,.modal .form-row select{min-height:42px;font-size:16px}
}

/* ---------- Fuel Trends: litres per visit list ---------- */
.fh-fa{background:#fff;border:1px solid rgba(30,42,110,.1);border-radius:12px;padding:10px 12px;margin:0 0 10px;box-shadow:0 1px 3px rgba(30,42,110,.06)}
.fh-fa-h{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
.fh-fa-h b{font-family:var(--font-display,'Space Grotesk',sans-serif);font-size:14.5px;color:#1E2A6E}
.fh-fa-seg{display:flex;gap:4px;flex-wrap:wrap}
.fh-fa-seg button{height:32px;padding:0 11px;border:1px solid #cfd6ea;border-radius:16px;background:#fff;color:#1E2A6E;font:600 12px var(--font-body,Inter,sans-serif);cursor:pointer}
.fh-fa-seg button.on{background:#1E2A6E;border-color:#1E2A6E;color:#fff}
.fh-fa-seg button .n{display:inline-block;min-width:18px;margin-left:5px;padding:0 5px;border-radius:9px;background:#c0392b;color:#fff;font-size:11px;line-height:18px}
.fh-fa-l{display:flex;flex-direction:column}
.fh-fa-r{display:flex;align-items:center;gap:10px;width:100%;min-height:44px;padding:6px 4px;border:0;border-top:1px solid #eef0f7;background:transparent;text-align:left;cursor:pointer;color:#2b3350;font:inherit}
.fh-fa-r:hover{background:#f6f8fd}
.fh-fa-r .k{width:22px;flex:0 0 auto;color:#8b92ad;font-weight:700;font-size:12px}
.fh-fa-r .nm{flex:1 1 auto;min-width:0;font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis}
.fh-fa-r .nm small{display:block;font-weight:400;color:#8b92ad;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fh-fa-r .v{flex:0 0 auto;font-weight:700;font-size:13px;text-align:right}
.fh-fa-r .v small{display:block;font-weight:500;font-size:11px;color:#8b92ad}
.fh-fa-note{font-size:12.5px;color:#6b7194;padding:8px 2px}
.fh-fa-more{margin-top:6px;height:34px;padding:0 12px;border:1px solid #cfd6ea;border-radius:10px;background:#fff;color:#1E2A6E;font:600 12.5px var(--font-body,Inter,sans-serif);cursor:pointer}
html.fh-dark .fh-fa{background:#171e46;border-color:#2b3470}
html.fh-dark .fh-fa-h b{color:#dfe5ff}
html.fh-dark .fh-fa-seg button,html.fh-dark .fh-fa-more{background:#171e46;border-color:#34408a;color:#cdd5ff}
html.fh-dark .fh-fa-seg button.on{background:#8da0ff;border-color:#8da0ff;color:#0d1230}
html.fh-dark .fh-fa-r{color:#e6e9ff;border-color:#262f62}
html.fh-dark .fh-fa-r:hover{background:#1b2350}
html.fh-dark .fh-fa-note,html.fh-dark .fh-fa-r .nm small,html.fh-dark .fh-fa-r .v small,html.fh-dark .fh-fa-r .k{color:#9aa4dd}

/* ---------- v2: desktop top bar = Ask FieldHub + bell + profile menu ---------- */
#fh-more-btn .fh-mb-user{display:none}
@media (min-width:${PHONE + 1}px){
  .top-ribbon-actions #ribbon-theme,.top-ribbon-actions #ribbon-reload,.top-ribbon-actions #ribbon-print,.top-ribbon-actions #ribbon-profile-btn,.top-ribbon-actions #logout-btn{display:none!important}
  .top-ribbon-actions #fh-more-btn{display:inline-flex!important;align-items:center;gap:8px;padding:5px 12px 5px 6px!important}
  #fh-more-btn .fh-mb-dots{display:none}
  #fh-more-btn .fh-mb-user{display:inline-flex;align-items:center;gap:8px;white-space:nowrap}
  #fh-more-btn .av{width:28px;height:28px;border-radius:50%;background:#DDE3F6;color:#1E2A6E;display:inline-grid;place-items:center;font-size:12px;font-weight:700}
  .top-ribbon-actions #fh-more-btn[aria-expanded="true"]{background:rgba(255,255,255,.28)!important}
}

/* ---------- v2: thin menu line on computers ---------- */
#fh-rail-pin{display:none}
@media (min-width:901px){
  body.fh-rail{--fh-sbw:76px}
  body.fh-rail.fh-rail-open{--fh-sbw:264px}
  body.fh-rail .sidebar{width:76px!important;transform:none!important;overflow-x:hidden!important;transition:width .3s cubic-bezier(.22,1,.36,1),box-shadow .3s ease!important;padding-left:12px!important;padding-right:12px!important}
  body.fh-rail .sidebar:hover,body.fh-rail.fh-rail-open .sidebar{width:264px!important}
  body.fh-rail:not(.fh-rail-open) .sidebar:hover{box-shadow:14px 0 40px rgba(10,15,45,.35)!important}
  body.fh-rail #fh-sb-pin,body.fh-rail #fh-sb-zone{display:none!important}
  body.fh-rail #nav-links .nav-link,body.fh-rail #nav-links .nav-group-header,body.fh-rail #fh-rail-pin{white-space:nowrap}
  body.fh-rail #nav-links .nav-link:hover{transform:none}
  body.fh-rail .nav-txt,body.fh-rail .nav-ghead>span:not(.nav-ico),body.fh-rail .nav-group-arrow,body.fh-rail .fh-drawer-user,body.fh-rail #fh-rail-pin .lbl,body.fh-rail #nav-links .nav-badge{transition:opacity .2s ease}
  body.fh-rail:not(.fh-rail-open) .sidebar:not(:hover) :is(.nav-txt,.nav-ghead>span:not(.nav-ico),.nav-group-arrow,.fh-drawer-user,#fh-rail-pin .lbl){opacity:0}
  body.fh-rail:not(.fh-rail-open) .sidebar:not(:hover) #nav-links .nav-badge{position:absolute;margin:0;left:34px;top:4px;min-width:0;width:9px;height:9px;padding:0;font-size:0;border-radius:50%}
  body.fh-rail #nav-links .nav-link{position:relative}
  body.fh-rail #fh-rail-pin{display:flex;align-items:center;gap:14px;width:100%;height:42px;padding:0 13px;margin:0 0 10px;border:0;border-radius:10px;background:rgba(255,255,255,.1);color:#fff;font:600 13px var(--font-body,Inter,sans-serif);cursor:pointer;flex:0 0 auto}
  body.fh-rail #fh-rail-pin:hover{background:rgba(255,255,255,.2)}
  body.fh-rail #fh-rail-pin svg{flex:0 0 auto}
}

/* ---------- v2: glass dashboard (dashboard page only) ---------- */
body.fh-on-dash .main-area{background:radial-gradient(620px 480px at 10% 6%,rgba(141,160,255,.30),transparent 70%),radial-gradient(560px 460px at 94% 58%,rgba(27,158,138,.16),transparent 70%),var(--paper,#F5F7FA)}
body.fh-on-dash #main-content .card:not([style*="background"]):not(.fh-hero),body.fh-on-dash #main-content .stat-card{background:rgba(255,255,255,.7)!important;border:1px solid rgba(255,255,255,.95)!important;box-shadow:0 8px 24px rgba(30,42,110,.08)!important}
@media (min-width:${PHONE + 1}px){body.fh-on-dash #main-content .card:not([style*="background"]):not(.fh-hero),body.fh-on-dash #main-content .stat-card{-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}}
html.fh-dark body.fh-on-dash .main-area{background:radial-gradient(620px 480px at 10% 6%,rgba(80,100,220,.30),transparent 70%),radial-gradient(560px 460px at 94% 58%,rgba(27,158,138,.18),transparent 70%),#0d1230}
html.fh-dark body.fh-on-dash #main-content .card:not([style*="background"]):not(.fh-hero),html.fh-dark body.fh-on-dash #main-content .stat-card{background:rgba(23,30,70,.72)!important;border-color:rgba(141,160,255,.18)!important;box-shadow:0 8px 24px rgba(0,0,0,.3)!important}
.fh-spark{margin-top:6px}
.fh-spark svg{display:block;width:100%;height:30px;overflow:visible}
.fh-spark .fh-chg{display:block;font-size:11.5px;font-weight:700;margin-top:2px;color:#6b7194}
.fh-spark .fh-chg.up-bad{color:#c0532f}.fh-spark .fh-chg.down-good,.fh-spark .fh-chg.up-good{color:#2e7d4f}
html.fh-dark .fh-spark .fh-chg{color:#9aa4dd}html.fh-dark .fh-spark .fh-chg.up-bad{color:#ff9b8f}html.fh-dark .fh-spark .fh-chg.down-good,html.fh-dark .fh-spark .fh-chg.up-good{color:#7fe0a8}
.fh-reveal{animation:fhReveal 1.2s cubic-bezier(.3,.7,.3,1) .25s both}
@keyframes fhReveal{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
.fh-fadein{animation:fhFade .8s ease .9s both}@keyframes fhFade{from{opacity:0}}
.fh-row{display:flex;flex-wrap:wrap;gap:16px;margin-bottom:16px;align-items:stretch}
.fh-row>.card{margin:0!important;min-width:0}
.fh-row>.fh-week{flex:2 1 420px}.fh-row>.fh-needs{flex:1 1 280px}
.fh-week .hd{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.fh-week .lg{display:flex;gap:14px;font-size:12.5px;color:#5B6B85;align-items:center}
.fh-week .lg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.fh-week svg{display:block;width:100%;height:170px;margin-top:8px}
.fh-week .xs{display:flex;justify-content:space-between;font-size:11.5px;color:#8b92ad;padding:0 2px}
html.fh-dark .fh-week .lg,html.fh-dark .fh-week .xs{color:#9aa4dd}
.fh-needs .fh-need{display:flex;align-items:center;gap:12px;min-height:50px;border-top:1px solid rgba(30,42,110,.08);cursor:pointer;color:inherit;text-decoration:none;border-radius:8px;padding:0 4px}
.fh-needs .fh-need:hover{background:rgba(30,42,110,.05)}
.fh-needs .nb{width:34px;height:34px;flex:0 0 auto;border-radius:10px;display:grid;place-items:center;font-weight:700;background:#E8F3EC;color:#2e7d4f}
.fh-needs .tx{flex:1;font-size:14px}.fh-needs .ar{color:#8b92ad}
html.fh-dark .fh-needs .fh-need{border-color:rgba(141,160,255,.15)}html.fh-dark .fh-needs .fh-need:hover{background:rgba(141,160,255,.08)}

/* ---------- v2: sign-in states ---------- */
#login-form .btn-primary.fh-busy{opacity:.9}
.fh-shake{animation:fhShake .45s ease}
@keyframes fhShake{0%,100%{transform:none}20%{transform:translateX(-9px)}40%{transform:translateX(8px)}60%{transform:translateX(-5px)}80%{transform:translateX(3px)}}
#fh-bio-login{display:flex!important;align-items:center;justify-content:center;gap:10px;height:50px;background:#fff!important;color:#1E2A6E!important;border:2px solid #1E2A6E!important;border-radius:12px!important;font-weight:600}
#fh-bio-login svg{flex:0 0 auto;animation:fhBio 2.2s ease-in-out infinite}
@keyframes fhBio{50%{transform:scale(1.12)}}

/* ---------- v3: one menu button (the ☰ in the top bar); the extra "Keep menu small" bar is gone ---------- */
@media (min-width:901px){
  body.fh-rail #fh-rail-pin{display:none!important}
  body.fh-rail #fh-menu-btn{transform:none!important}
  body.fh-rail.fh-rail-open #fh-menu-btn{background:rgba(255,255,255,.3)!important}
}

/* ---------- v3: live clock in the top bar (every page; on the dashboard the banner clock shows instead) ---------- */
#fh-topclock{display:flex;align-items:center;gap:10px;margin:0 12px 0 auto;padding:6px 12px;border-radius:12px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.16);color:#fff;white-space:nowrap;font-variant-numeric:tabular-nums;line-height:1.15;flex:0 0 auto}
#fh-topclock .t{font:700 16px var(--font-display,'Space Grotesk',sans-serif);letter-spacing:.3px}
#fh-topclock .d{font-size:12px;opacity:.82}
#fh-topclock .p{font-size:12px;opacity:.88;max-width:200px;overflow:hidden;text-overflow:ellipsis;border:0;background:transparent;color:inherit;padding:0;font-family:inherit;cursor:pointer}
#fh-topclock .p:hover{text-decoration:underline}
#fh-topclock .sep{width:1px;height:18px;background:rgba(255,255,255,.28)}
body.fh-on-dash #fh-topclock{display:none}
@media (max-width:1100px){#fh-topclock .p,#fh-topclock .sep.s2{display:none}}
@media (max-width:${PHONE}px){
  #fh-topclock{margin:0 2px 0 auto;padding:2px 4px;gap:0;flex-direction:column;align-items:flex-end;background:transparent;border:0}
  #fh-topclock .t{font-size:13.5px}#fh-topclock .d{font-size:10px}#fh-topclock .sep{display:none}
}
@media (max-width:374px){#fh-topclock{display:none}}

/* ---------- v3: dashboard banner clock with a small analog face ---------- */
#fh-live-dt .fh-ac{display:none}
@media (min-width:${PHONE + 1}px){
  .fh-hero #fh-live-dt{display:flex;align-items:center;gap:16px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:18px;padding:12px 18px}
  #fh-live-dt .fh-ac{display:block;flex:0 0 auto;width:70px;height:70px}
  #fh-live-dt .fh-dtx{text-align:right}
  #fh-live-dt #fh-lt-time{font-family:var(--font-display,'Space Grotesk',sans-serif)!important;font-size:26px!important}
}
.fh-ac .hd{stroke:#fff;stroke-width:3.2;stroke-linecap:round}.fh-ac .mn{stroke:#fff;stroke-width:2.2;stroke-linecap:round}.fh-ac .sc{stroke:#5eead4;stroke-width:1.4;stroke-linecap:round}
.fh-ac .hd,.fh-ac .mn,.fh-ac .sc{transform-origin:35px 35px;transition:transform .35s cubic-bezier(.3,1.6,.5,1)}

/* ---------- v3: Fuel Trends look ---------- */
.ft-kpi{border-radius:14px!important;padding:10px 13px!important;box-shadow:0 4px 14px rgba(30,42,110,.06)!important;transition:transform .2s ease,box-shadow .2s ease}
.ft-kpi .n{font-size:20px!important}
@media (hover:hover){.ft-kpi:hover{transform:translateY(-2px);box-shadow:0 10px 22px rgba(30,42,110,.12)!important}}
.ft-card{border-radius:16px!important;padding:10px 12px 6px!important;box-shadow:0 6px 20px rgba(30,42,110,.07)!important}
.ft-ch h4{font-size:14px}
.ft-ch button,.ft-tb button{border-radius:999px!important;padding:4px 11px!important}
.ft-card .modebar{background:transparent!important}
@media (hover:hover){.ft-card .modebar-container{opacity:0;transition:opacity .2s ease}.ft-card:hover .modebar-container{opacity:1}}
html.fh-dark .ft-card,html.fh-dark .ft-kpi{box-shadow:0 6px 20px rgba(0,0,0,.3)!important}
.fh-fa.shut .fh-fa-h{margin-bottom:0}
.fh-fa-sum{font-size:12.5px;color:#6b7194;margin-right:auto;margin-left:10px}
.fh-fa-seg .fh-fa-tog{background:#eef1fb;border-color:#cfd6ea;color:#1E2A6E}
html.fh-dark .fh-fa-sum{color:#9aa4dd}html.fh-dark .fh-fa-seg .fh-fa-tog{background:#232c63;border-color:#34408a;color:#cdd5ff}

/* ---------- v3: Roster page, tidier and smaller ---------- */
body.fh-on-roster #topbar-actions{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end}
body.fh-on-roster #topbar-actions .btn{padding:7px 12px;font-size:12.5px;border-radius:9px;line-height:1.2}
body.fh-on-roster #main-content select,body.fh-on-roster #main-content input[type="text"],body.fh-on-roster #main-content input[type="search"],body.fh-on-roster #main-content input:not([type]){min-height:36px;border:1px solid #DCE3ED;border-radius:10px;padding:0 10px;background-color:#fff;font-size:13px;color:#1E2A6E}
html.fh-dark body.fh-on-roster #main-content select,html.fh-dark body.fh-on-roster #main-content input[type="text"],html.fh-dark body.fh-on-roster #main-content input[type="search"],html.fh-dark body.fh-on-roster #main-content input:not([type]){background-color:#0d1230;border-color:#2b3470;color:#e6e9ff}
body.fh-on-roster #main-content table{font-size:13px}
body.fh-on-roster #main-content td{padding:8px 9px}
body.fh-on-roster #main-content .btn.small{padding:5px 10px;font-size:12px;border-radius:8px}
@media (max-width:${PHONE}px){
  body.fh-on-roster #topbar-actions{justify-content:flex-start;gap:6px}
  body.fh-on-roster #topbar-actions .btn,body.fh-on-roster .main-content .btn:not(.small){padding:7px 11px!important;font-size:12.5px!important;min-height:36px!important;line-height:1.2}
  body.fh-on-roster #main-content select{width:calc(50% - 6px)!important;min-width:0!important;max-width:none!important;font-size:13px!important}
  body.fh-on-roster #main-content input[type="text"],body.fh-on-roster #main-content input[type="search"],body.fh-on-roster #main-content input:not([type]){font-size:14px!important}
}
.fh-nw{white-space:nowrap}
.fh-ra{white-space:nowrap}
.fh-ra-menu{position:fixed;z-index:5002;min-width:210px;background:#fff;border:1px solid #dfe4f1;border-radius:12px;box-shadow:0 14px 36px rgba(15,23,60,.24);padding:5px;display:none;flex-direction:column;gap:2px}
.fh-ra-menu.open{display:flex;animation:fhMenuIn .16s ease-out both}
.fh-ra-menu .btn{display:block;width:100%;text-align:left;background:transparent!important;color:#1b2150!important;border:0!important;border-radius:8px!important;padding:9px 12px!important;font-size:13.5px!important;white-space:nowrap}
.fh-ra-menu .btn:hover{background:#eef1fb!important}
.fh-ra-menu .btn.danger{color:#c0392b!important}
.fh-ra-menu .btn.danger:hover{background:#fdecea!important}
html.fh-dark .fh-ra-menu{background:#171e46;border-color:#2b3470}
html.fh-dark .fh-ra-menu .btn{color:#e6e9ff!important}html.fh-dark .fh-ra-menu .btn:hover{background:#232c63!important}html.fh-dark .fh-ra-menu .btn.danger{color:#ff9b8f!important}

@media (prefers-reduced-motion:reduce){
  #fh-more-menu,#notif-dropdown,.toast,.toast .ti,#notif-bell-btn.fh-ring,.fh-busy::after,.fh-reveal,.fh-fadein,.fh-shake,#fh-bio-login svg{animation:none!important}
  body.fh-rail .sidebar{transition:none!important}
  .fh-ac .hd,.fh-ac .mn,.fh-ac .sc,.ft-kpi{transition:none!important}.fh-ra-menu.open{animation:none!important}
  .stat-card:hover{transform:none!important}
}
@media print{#fh-more-btn,#fh-more-menu{display:none!important}}`;

  function addStyle() {
    if (document.getElementById('fh-ui-v1')) return;
    const st = document.createElement('style'); st.id = 'fh-ui-v1'; st.textContent = CSS;
    document.head.appendChild(st);
  }

  // ---------------------------------------------------------------- More menu (phone)
  // Each entry only "presses" the original button, so every action works exactly as before.
  const ITEMS = [
    ['fh-bot-btn', '💬', () => 'Ask FieldHub'],
    ['ribbon-theme', () => (isDark() ? '☀' : '🌙'), () => (isDark() ? 'Light mode' : 'Dark mode')],
    ['ribbon-reload', '⟳', () => 'Refresh'],
    ['ribbon-print', '🖨', () => 'Print / save as PDF'],
    ['ribbon-profile-btn', '👤', () => 'My profile'],
    ['logout-btn', '↪', () => 'Sign out', 'danger']
  ];
  const isDark = () => document.documentElement.classList.contains('fh-dark');
  const val = (x) => (typeof x === 'function' ? x() : x);

  function ensureMoreBtn() {
    const actions = document.querySelector('.top-ribbon-actions');
    if (!actions) return;
    let b = document.getElementById('fh-more-btn');
    if (!b) {
      b = document.createElement('button');
      b.id = 'fh-more-btn'; b.type = 'button'; b.className = 'ribbon-link';
      b.setAttribute('aria-label', 'More options'); b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false');
      b.title = 'More options'; b.innerHTML = '<span class="fh-mb-dots" aria-hidden="true">⋮</span><span class="fh-mb-user"><span class="av"></span><span class="nm"></span> ▾</span>';
      b.onclick = (e) => { e.stopPropagation(); toggleMenu(); };
    }
    if (actions.lastElementChild !== b) actions.appendChild(b);
    try {
      const full = (state.profile && (state.profile.full_name || state.profile.email)) || '';
      const nm = b.querySelector('.nm'), av = b.querySelector('.av');
      if (nm && nm.textContent !== full.split(' ')[0]) { nm.textContent = full.split(' ')[0]; av.textContent = full.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); }
    } catch (_e) {}
  }
  function closeMenu() {
    const m = document.getElementById('fh-more-menu'); if (m) m.remove();
    const b = document.getElementById('fh-more-btn'); if (b) b.setAttribute('aria-expanded', 'false');
  }
  function toggleMenu() {
    if (document.getElementById('fh-more-menu')) { closeMenu(); return; }
    const b = document.getElementById('fh-more-btn'); if (!b) return;
    const nd = document.getElementById('notif-dropdown'); if (nd) nd.remove();
    const items = ITEMS.filter(([id]) => { const el = document.getElementById(id); return el && getComputedStyle(el).display === 'none'; });
    if (!items.length) return;
    const m = document.createElement('div');
    m.id = 'fh-more-menu'; m.setAttribute('role', 'menu');
    m.innerHTML = items.map(([id, ic, lb, cls]) => `<button type="button" role="menuitem" data-fh-press="${id}" class="${cls || ''}"><span class="i" aria-hidden="true">${val(ic)}</span><span>${val(lb)}</span></button>`).join('');
    const r = b.getBoundingClientRect();
    m.style.top = Math.round(r.bottom + 6) + 'px';
    m.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
    document.body.appendChild(m);
    b.setAttribute('aria-expanded', 'true');
    m.addEventListener('click', (e) => {
      const it = e.target.closest('[data-fh-press]'); if (!it) return;
      e.stopPropagation();
      const target = document.getElementById(it.dataset.fhPress);
      closeMenu();
      if (target) target.click();
    });
    const first = m.querySelector('button'); if (first && !('ontouchstart' in window)) first.focus();
  }
  document.addEventListener('click', (e) => {
    const m = document.getElementById('fh-more-menu');
    if (m && !m.contains(e.target) && !(e.target.closest && e.target.closest('#fh-more-btn'))) closeMenu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('resize', () => { if (window.innerWidth > PHONE) closeMenu(); });
  // the bell and the More menu never stay open together
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#notif-bell-btn')) closeMenu(); }, true);

  // ---------------------------------------------------------------- bell rings when something new arrives
  let lastBadge = null;
  function watchBell() {
    const badge = document.getElementById('notif-badge'), bell = document.getElementById('notif-bell-btn');
    if (!badge || !bell) return;
    const n = badge.style.display === 'none' ? 0 : (parseInt(badge.textContent, 10) || 0);
    if (lastBadge !== null && n > lastBadge && !RM) { bell.classList.remove('fh-ring'); void bell.offsetWidth; bell.classList.add('fh-ring'); setTimeout(() => bell.classList.remove('fh-ring'), 1000); }
    lastBadge = n;
  }

  // ---------------------------------------------------------------- double-tap guard on Save buttons in pop-up forms
  // While the first press is being saved, a second press is ignored. It clears itself when a message appears,
  // when the form is closed or edited, or after 6 seconds at most. Nothing is blocked in the database.
  const BUSY = new Set();
  const SAVE_WORDS = /save|submit|send|create|add|issue|approve|confirm|update|apply|upload|post|assign|mark|request|record|acknowledg|move|transfer|return|receive/i;
  function clearBusy(b) { (b ? [b] : [...BUSY]).forEach((x) => { x.classList.remove('fh-busy'); x.removeAttribute('aria-busy'); BUSY.delete(x); clearTimeout(x.__fhT); }); }
  document.addEventListener('submit', (e) => {
    const f = e.target; if (!f || !f.closest || !f.closest('.modal, .modal-overlay')) return;
    const b = e.submitter || f.querySelector('button[type="submit"], button:not([type])');
    if (!b || !SAVE_WORDS.test(b.textContent || '')) return;
    if (BUSY.has(b)) { e.preventDefault(); e.stopImmediatePropagation(); return; }   // second press while the first one is still working
    BUSY.add(b); b.classList.add('fh-busy'); b.setAttribute('aria-busy', 'true');
    b.__fhT = setTimeout(() => clearBusy(b), 6000);
    if (!f.__fhIn) { f.__fhIn = 1; f.addEventListener('input', () => clearBusy(b)); }
  }, true);
  (function wrapToast() {
    const t0 = window.toast;
    if (typeof t0 !== 'function' || t0.__fh) return;
    const w = function () { try { clearBusy(); } catch (_e) {} return t0.apply(this, arguments); };
    w.__fh = 1; window.toast = w;
  })();

  // ---------------------------------------------------------------- one light pass after the page changes
  let tm = null;
  function pass() {
    ensureMoreBtn();
    watchBell();
    applyRail();
    loginPass();
    rosterPass();
    ensureTopClock(); ensureBannerClock();
    document.body.classList.toggle('fh-on-dash', !!document.getElementById('fh-live-dt') && !!document.querySelector('#main-content .grid-4.fh-stagger'));
    BUSY.forEach((b) => { if (!document.body.contains(b)) clearBusy(b); });
  }
  function start() {
    addStyle(); pass();
    const clockOnly = (r) => { const t = r.target && (r.target.nodeType === 1 ? r.target : r.target.parentElement); return !!(t && t.closest && t.closest('#fh-topclock, #fh-live-dt, #fh-lt-time')); };
    new MutationObserver((recs) => { if (recs.every(clockOnly)) return; clearTimeout(tm); tm = setTimeout(pass, 120); }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // ---------------------------------------------------------------- v2: thin menu line (computers only)
  // The menu sits in one thin line of icons. Pointing at it slides the names out; the top button keeps them open.
  // The choice is remembered on this device only.
  const railOpen = () => { try { return localStorage.getItem('fh_rail') === 'open'; } catch (_e) { return false; } };
  const RAIL_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h10M4 17h16"/></svg>';
  function applyRail() {
    const desk = window.innerWidth > 900, b = document.body;
    if (!b) return;
    b.classList.toggle('fh-rail', desk);
    b.classList.toggle('fh-rail-open', desk && railOpen());
    if (desk) b.classList.remove('fh-sb-auto', 'fh-sb-peek');
    const side = document.querySelector('.sidebar');
    if (!side) return;
    let p = document.getElementById('fh-rail-pin');
    if (!p) {
      p = document.createElement('button'); p.type = 'button'; p.id = 'fh-rail-pin';
      p.innerHTML = RAIL_ICON + '<span class="lbl"></span>';
      p.onclick = (e) => { e.stopPropagation(); try { localStorage.setItem('fh_rail', railOpen() ? 'line' : 'open'); } catch (_e) {} applyRail(); };
      side.insertBefore(p, side.firstChild);
    }
    const lbl = railOpen() ? 'Keep menu small' : 'Show menu names';
    const mb = document.getElementById('fh-menu-btn'); if (mb && desk && mb.title !== lbl) { mb.title = lbl; mb.setAttribute('aria-label', lbl); mb.setAttribute('aria-expanded', String(railOpen())); }
    const l = p.querySelector('.lbl'); if (l.textContent !== lbl) { l.textContent = lbl; p.title = lbl; p.setAttribute('aria-label', lbl); }
    // names as tooltips while the line is small
    document.querySelectorAll('#nav-links .nav-link, #nav-links .nav-group-header').forEach((a) => {
      if (a.title) return; const t = (a.querySelector('.nav-txt') || a.querySelector('.nav-ghead') || a).textContent.trim(); if (t) a.title = t;
    });
  }
  document.addEventListener('click', (e) => {   // the ☰ in the top bar opens / closes the names on a computer
    if (window.innerWidth > 900 && e.target.closest && e.target.closest('#fh-menu-btn')) {
      e.preventDefault(); e.stopImmediatePropagation();
      try { localStorage.setItem('fh_rail', railOpen() ? 'line' : 'open'); } catch (_e) {} applyRail();
    }
  }, true);
  window.addEventListener('resize', () => { applyRail(); });

  // ---------------------------------------------------------------- v2: sign-in page states
  let loginT = null, lastMsg = '';
  document.addEventListener('submit', (e) => {
    if (!e.target || e.target.id !== 'login-form') return;
    const b = e.target.querySelector('button[type="submit"]'); if (!b) return;
    b.classList.add('fh-busy'); clearTimeout(loginT); loginT = setTimeout(() => b.classList.remove('fh-busy'), 9000);
  }, true);
  const BIO_ICON = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 11v3a8 8 0 0 1-1.2 4.2"/><path d="M8.5 7.5A5 5 0 0 1 17 11v2a12 12 0 0 1-.6 3.8"/><path d="M7 10.5V12a10 10 0 0 1-1 4.4"/><path d="M5.2 6.6A8 8 0 0 1 20 11v1"/><path d="M15 14.5a15 15 0 0 1-1.6 5.4"/></svg>';
  function loginPass() {
    const m = document.getElementById('auth-message'), f = document.getElementById('login-form');
    if (m && f) {
      const shown = m.style.display !== 'none' && m.textContent.trim();
      const txt = shown ? m.textContent.trim() : '';
      if (txt && txt !== lastMsg) {
        const b = f.querySelector('button[type="submit"]'); if (b) b.classList.remove('fh-busy');
        if (!RM && f.style.display !== 'none') { f.classList.remove('fh-shake'); void f.offsetWidth; f.classList.add('fh-shake'); }
      }
      lastMsg = txt;
    }
    const scr = document.getElementById('auth-screen');
    if (scr && scr.style.display === 'none' && f) { const b = f.querySelector('button[type="submit"]'); if (b) b.classList.remove('fh-busy'); }
    const fb = document.getElementById('fh-bio-login');
    if (fb && !fb.dataset.fh) { fb.dataset.fh = '1'; fb.innerHTML = BIO_ICON + '<span>Sign in with fingerprint</span>'; }
  }

  // ---------------------------------------------------------------- v2: dashboard trend lines and "This week" chart
  // Called by the dashboard (app.js). Reads only dates (created / resolved) for the last 14 days, once every 5 minutes.
  function daySeries(rows, field, start) {
    const a = new Array(14).fill(0);
    (rows || []).forEach((r) => { const v = typeof field === 'function' ? field(r) : r[field]; if (!v) return; const i = Math.floor((new Date(v) - start) / 864e5); if (i >= 0 && i < 14) a[i]++; });
    return a;
  }
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  function sparkSvg(vals, color) {
    const max = Math.max(1, ...vals), pts = vals.map((v, i) => Math.round(i * 100 / (vals.length - 1)) + ',' + (28 - Math.round(v / max * 24))).join(' ');
    return `<svg class="fh-reveal" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
  }
  window.fhDashExtras = async function () {
    try {
      const main = document.getElementById('main-content'); if (!main) return;
      const grid = main.querySelector('.grid-4.fh-stagger'); if (!grid) return;
      const uid = state.user && state.user.id; if (!uid) return;
      const rider = state.profile && state.profile.role === 'rider';
      const key = 'fh_dash_' + uid; let D = null;
      try { const c = JSON.parse(sessionStorage.getItem(key) || 'null'); if (c && Date.now() - c.at < 300000) D = c; } catch (_e) {}
      if (!D) {
        const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 13);
        const iso = start.toISOString();
        const [rq, rc, tk, ci] = await Promise.all([
          sb.from('requests').select('created_at').is('deleted_at', null).gte('created_at', iso).limit(5000),
          rider ? Promise.resolve({ data: [] }) : sb.from('requests').select('resolved_at, closed_at').is('deleted_at', null).or(`resolved_at.gte.${iso},closed_at.gte.${iso}`).limit(5000),
          sb.from('tasks').select('created_at').eq('assigned_to', uid).gte('created_at', iso).limit(5000),
          sb.from('circulars').select('created_at').is('deleted_at', null).gte('created_at', iso).limit(5000)
        ]);
        if (rq.error) return;   // offline or no access: the dashboard simply stays as it is
        D = { at: Date.now(), start: start.getTime(), req: daySeries(rq.data, 'created_at', start), done: daySeries(rc.data, (r) => r.resolved_at || r.closed_at, start), task: tk.error ? null : daySeries(tk.data, 'created_at', start), circ: ci.error ? null : daySeries(ci.data, 'created_at', start) };
        try { sessionStorage.setItem(key, JSON.stringify(D)); } catch (_e) {}
      }
      if (!document.body.contains(grid) || grid.dataset.fhTrend) return;
      grid.dataset.fhTrend = '1';
      const MAP = { requests: [D.req, 'new', true], tasks: [D.task, 'new', true], circulars: [D.circ, 'posted', false] };
      grid.querySelectorAll('.stat-card').forEach((c) => {
        const m = /navigateTo\('([a-z_]+)'\)/.exec(c.getAttribute('onclick') || ''); const def = m && MAP[m[1]];
        if (!def || !def[0]) return;
        const s = def[0], last = s.slice(7), prev = s.slice(0, 7), a = sum(last), b = sum(prev);
        const num = c.querySelector('.stat-number'), col = num ? getComputedStyle(num).color : '#1E2A6E';
        let chg = 'same', cls = '';
        if (b === 0 && a > 0) { chg = '▲ new'; cls = def[2] ? 'up-bad' : ''; }
        else if (b > 0 && a !== b) { const pct = Math.round((a - b) / b * 100); chg = (pct > 0 ? '▲ ' : '▼ ') + Math.abs(pct) + '%'; cls = pct > 0 ? (def[2] ? 'up-bad' : 'up-good') : 'down-good'; }
        const box = document.createElement('div'); box.className = 'fh-spark';
        box.title = a + ' ' + def[1] + ' in the last 7 days (' + b + ' the week before)';
        box.innerHTML = sparkSvg(last, col) + `<span class="fh-chg ${cls}">${a} ${def[1]} this week · ${chg}</span>`;
        const go = c.querySelector('.go'); if (go) c.insertBefore(box, go); else c.appendChild(box);
      });
      if (rider) return;
      // "This week": requests opened vs closed per day
      const o = D.req.slice(7), d = D.done.slice(7), max = Math.max(4, ...o, ...d) * 1.15;
      const X = (i) => Math.round(i * 100), Y = (v) => Math.round(180 - v / max * 160);
      const line = (a) => a.map((v, i) => (i ? 'L' : 'M') + X(i) + ',' + Y(v)).join(' ');
      const days = []; for (let i = 7; i < 14; i++) { const dt = new Date(D.start + i * 864e5); days.push(dt.toLocaleDateString('en-GB', { weekday: 'short' })); }
      const dots = (a, colr, word) => a.map((v, i) => `<circle cx="${X(i)}" cy="${Y(v)}" r="4" fill="${colr}" vector-effect="non-scaling-stroke"><title>${days[i]}: ${v} ${word}</title></circle>`).join('');
      const html = `<div class="card fh-week"><div class="hd"><h3 style="margin:0">Requests this week</h3><span class="lg"><span><i style="background:#3B50B8"></i>Opened <b>${sum(o)}</b></span><span><i style="background:#1B9E8A"></i>Closed <b>${sum(d)}</b></span></span></div>
 <svg class="fh-reveal" viewBox="-8 0 616 190" preserveAspectRatio="none" role="img" aria-label="Requests opened and closed per day, last 7 days">
          <path d="M0 180H600M0 100H600M0 20H600" stroke="rgba(120,130,170,.22)" fill="none" vector-effect="non-scaling-stroke"/>
          <path class="fh-fadein" d="${line(o)} L600,180 L0,180 Z" fill="rgba(59,80,184,.13)"/>
          <path d="${line(o)}" fill="none" stroke="#3B50B8" stroke-width="3" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
          <path d="${line(d)}" fill="none" stroke="#1B9E8A" stroke-width="3" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
          ${dots(o, '#3B50B8', 'opened')}${dots(d, '#1B9E8A', 'closed')}
        </svg><div class="xs">${days.map((x) => `<span>${x}</span>`).join('')}</div></div>`;
      const row = document.createElement('div'); row.className = 'fh-row'; row.innerHTML = html;
      grid.insertAdjacentElement('afterend', row);
      const needs = main.querySelector('.fh-needs'); if (needs) row.appendChild(needs);
    } catch (e) { console.warn('dashboard extras', e); }
  };

  // ---------------------------------------------------------------- v3: live clock (top bar on every page, analog face in the dashboard banner)
  // Uses the device clock and the place name the portal already found (GPS, kept 1 hour). Nothing is stored online.
  const tzCity = (() => { try { const z = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; return z.split('/').pop().replace(/_/g, ' '); } catch (_e) { return ''; } })();
  function placeName() {
    try { if (typeof _fhPlace !== 'undefined' && _fhPlace) return _fhPlace; } catch (_e) {}
    try { const c = JSON.parse(sessionStorage.getItem('fh_place') || 'null'); if (c && c.n) return c.n; } catch (_e) {}
    return '';
  }
  function ensureTopClock() {
    const rib = document.querySelector('.top-ribbon'), act = document.querySelector('.top-ribbon-actions');
    if (!rib || !act) return null;
    let c = document.getElementById('fh-topclock');
    if (!c) {
      c = document.createElement('div'); c.id = 'fh-topclock'; c.setAttribute('role', 'timer'); c.setAttribute('aria-label', 'Current date, time and place');
      c.innerHTML = '<span class="t"></span><span class="sep"></span><span class="d"></span><span class="sep s2"></span><button type="button" class="p" title="Your current place (tap to find it)"></button>';
      c.querySelector('.p').onclick = () => {
        const p = c.querySelector('.p'); if (placeName()) return;
        try { if (typeof fhFindPlace === 'function') { p.textContent = '📍 Finding…'; fhFindPlace(p, tzCity); } } catch (_e) {}
      };
    }
    if (c.nextElementSibling !== act) rib.insertBefore(c, act);
    return c;
  }
  const AC = '<svg class="fh-ac" viewBox="0 0 70 70" aria-hidden="true"><circle cx="35" cy="35" r="32" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.45)" stroke-width="1.5"/>' +
    Array.from({ length: 12 }, (_, i) => { const a = i * Math.PI / 6, r1 = i % 3 ? 27 : 24; return `<line x1="${(35 + r1 * Math.sin(a)).toFixed(1)}" y1="${(35 - r1 * Math.cos(a)).toFixed(1)}" x2="${(35 + 29 * Math.sin(a)).toFixed(1)}" y2="${(35 - 29 * Math.cos(a)).toFixed(1)}" stroke="rgba(255,255,255,${i % 3 ? '.45' : '.9'})" stroke-width="${i % 3 ? 1.2 : 2}" stroke-linecap="round"/>`; }).join('') +
    '<line class="hd" x1="35" y1="35" x2="35" y2="19"/><line class="mn" x1="35" y1="35" x2="35" y2="10"/><line class="sc" x1="35" y1="39" x2="35" y2="8"/><circle cx="35" cy="35" r="2.6" fill="#5eead4"/></svg>';
  function ensureBannerClock() {
    const dt = document.getElementById('fh-live-dt'); if (!dt || dt.querySelector('.fh-ac')) return;
    const wrap = document.createElement('div'); wrap.className = 'fh-dtx';
    while (dt.firstChild) wrap.appendChild(dt.firstChild);
    dt.insertAdjacentHTML('afterbegin', AC); dt.appendChild(wrap);
  }
  const setTxt = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
  function clockTick() {
    const n = new Date(), phone = window.innerWidth <= PHONE;
    const c = ensureTopClock();
    if (c && getComputedStyle(c).display !== 'none') {
      setTxt(c.querySelector('.t'), n.toLocaleTimeString('en-GB', phone ? { hour: 'numeric', minute: '2-digit', hour12: true } : { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }));
      setTxt(c.querySelector('.d'), n.toLocaleDateString('en-GB', phone ? { weekday: 'short', day: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }));
      const p = c.querySelector('.p'), pn = placeName();
      if (pn) setTxt(p, '📍 ' + pn);
      else if (!/Finding/.test(p.textContent)) setTxt(p, '📍 Show my location');
    }
    ensureBannerClock();
    const ac = document.querySelector('#fh-live-dt .fh-ac');
    if (ac && ac.getBoundingClientRect().width) {
      const s = n.getSeconds(), m = n.getMinutes() + s / 60, h = (n.getHours() % 12) + m / 60, base = (n.getHours() >= 12 ? 1 : 0);   // turn forward only (no back-spin), except once at midnight
      ac.querySelector('.sc').style.transform = 'rotate(' + ((n.getHours() * 60 + n.getMinutes()) * 360 + s * 6) + 'deg)';
      ac.querySelector('.mn').style.transform = 'rotate(' + (n.getHours() * 360 + m * 6) + 'deg)';
      ac.querySelector('.hd').style.transform = 'rotate(' + (base * 360 + h * 30) + 'deg)';
    }
  }
  setInterval(() => { if (!document.hidden) clockTick(); }, 1000);

  // ---------------------------------------------------------------- v3: Roster rows: Edit stays, the rest goes under "More ▾" (same buttons, same actions)
  function closeRa() { document.querySelectorAll('.fh-ra-menu.open').forEach((m) => { m.classList.remove('open'); const b = m.previousElementSibling; if (b) b.setAttribute('aria-expanded', 'false'); }); }
  document.addEventListener('click', (e) => { if (!(e.target.closest && e.target.closest('.fh-ra-btn'))) closeRa(); });
  window.addEventListener('scroll', closeRa, true);
  window.addEventListener('resize', closeRa);
  function rosterPass() {
    let on = false; try { on = state.view === 'roster'; } catch (_e) {}
    document.body.classList.toggle('fh-on-roster', on);
    if (!on) return;
    document.querySelectorAll('#main-content td').forEach((td) => {
      if (td.dataset.fhRa || !td.querySelector('[data-edit-roster]')) return;
      td.dataset.fhRa = '1';
      const extra = [...td.querySelectorAll('[data-remove-roster],[data-reinstate-roster],[data-top-roster],[data-delete-roster]')];
      if (!extra.length) return;
      td.classList.add('fh-ra');
      const more = document.createElement('button'); more.type = 'button'; more.className = 'btn small outline fh-ra-btn'; more.textContent = 'More ▾';
      more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
      const menu = document.createElement('div'); menu.className = 'fh-ra-menu'; menu.setAttribute('role', 'menu');
      extra.forEach((b) => { b.setAttribute('role', 'menuitem'); menu.appendChild(b); });
      td.appendChild(more); td.appendChild(menu);
      more.onclick = (e) => {
        e.stopPropagation();
        const was = menu.classList.contains('open'); closeRa(); if (was) return;
        menu.classList.add('open'); more.setAttribute('aria-expanded', 'true');
        const r = more.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
        menu.style.left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw)) + 'px';
        menu.style.top = (r.bottom + 6 + mh > window.innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6) + 'px';
      };
      menu.addEventListener('click', () => setTimeout(closeRa, 0));
    });
    // the Shift column stays on one line
    document.querySelectorAll('#main-content table').forEach((t) => {
      if (t.dataset.fhNw || !t.querySelector('[data-edit-roster], td')) return;
      const ths = [...t.querySelectorAll('thead th')], i = ths.findIndex((h) => /^\s*shift\s*$/i.test(h.textContent.replace(/[↑↓▲▼⇅]/g, '')));
      if (i < 0) return; t.dataset.fhNw = '1';
      t.querySelectorAll('tbody tr').forEach((tr) => { const c = tr.children[i]; if (c) c.classList.add('fh-nw'); });
    });
  }

  // ---------------------------------------------------------------- Fuel Trends: litres per visit, latest month
  // Called by Fuel Trends (app.js) with the rows of the current filters. Home Sampling and Home Care are never mixed:
  // each person is counted per category, and the limit is that category's "Max L/visit".
  window.fhFuelAlerts = function (box, rows, ms) {
    if (!box) return;
    try {
      const have = (ms || []).filter((m) => rows.some((r) => r.m === m));
      const m = have[have.length - 1];
      const cur = m ? rows.filter((r) => r.m === m && ftVT(r.category)) : [];
      if (!cur.length) { box.innerHTML = ''; return; }
      const g = new Map();
      cur.forEach((r) => {
        const k = r.rk + '|' + r.category; let o = g.get(k);
        if (!o) g.set(k, o = { rk: r.rk, name: r.rider_name || '(unknown)', emp: r.employee_id || '', region: r.region_name || '', cat: r.category, vt: ftVT(r.category), l: 0, v: 0 });
        o.l += +r.approved_liters || 0; o.v += +r.visits || 0;
      });
      const list = [...g.values()].filter((o) => o.v > 0).map((o) => { o.lpv = o.l / o.v; o.lim = ftLim(o.cat, 'lpv'); return o; });
      const over = list.filter((o) => o.lim && o.lpv > o.lim).sort((a, b) => b.lpv / b.lim - a.lpv / a.lim);
      const fair = list.filter((o) => o.v >= 5);   // at least 5 visits, so one short trip does not top the list
      const low = fair.slice().sort((a, b) => a.lpv - b.lpv).slice(0, 10);
      const high = fair.slice().sort((a, b) => b.lpv - a.lpv).slice(0, 10);
      const anyLim = list.some((o) => o.lim);
      const S = window.__fhFa = window.__fhFa || { tab: null, all: false };
      const isOpen = () => { try { return localStorage.getItem('fh_fa_open') === '1'; } catch (_e) { return false; } };
      if (!S.tab) S.tab = over.length ? 'over' : 'low';
      const esc = (s) => escapeHtml(s == null ? '' : String(s));
      const row = (o, i, mode) => {
        const bad = o.lim && o.lpv > o.lim, col = mode === 'low' ? '#2e7d4f' : bad ? '#c0532f' : '#2b3350';
        const sub = [o.emp, o.region, o.vt].filter(Boolean).join(' · ');
        return `<button type="button" class="fh-fa-r" data-rk="${esc(o.rk)}" title="Open this team member's details"><span class="k">${i + 1}</span><span class="nm">${esc(o.name)}<small>${esc(sub)}</small></span><span class="v" style="color:${col}">${ftFmt(o.lpv, 2)} L/visit<small>${o.lim ? 'limit ' + ftFmt(o.lim, 2) + ' · ' : ''}${ftFmt(o.v)} visits</small></span></button>`;
      };
      const paint = () => {
        let body = '';
        if (S.tab === 'over') {
          if (!over.length) body = `<div class="fh-fa-note">${anyLim ? 'Nobody is over the litres-per-visit limit in ' + ftMonthLabel(m) + '. 👍' : 'No litres-per-visit limit is set yet. The Super Admin can set it under <b>Limits &amp; Rs/KM → Max L/visit</b>.'}</div>`;
          else { const show = S.all ? over : over.slice(0, 8); body = show.map((o, i) => row(o, i, 'over')).join('') + (over.length > 8 ? `<button type="button" class="fh-fa-more" data-all>${S.all ? 'Show fewer' : 'Show all ' + over.length}</button>` : ''); }
        } else {
          const L = S.tab === 'low' ? low : high;
          body = L.length ? L.map((o, i) => row(o, i, S.tab)).join('') : '<div class="fh-fa-note">Not enough visits this month to rank (each person needs at least 5).</div>';
        }
        const open = isOpen();
        box.innerHTML = `<div class="fh-fa ${open ? '' : 'shut'}"><div class="fh-fa-h"><b>Litres per visit · ${esc(ftMonthLabel(m))}</b>${open ? '' : `<span class="fh-fa-sum">${over.length} over the limit · ${list.length} people</span>`}<div class="fh-fa-seg" role="tablist">
          <button type="button" data-fa="over" class="${S.tab === 'over' ? 'on' : ''}">Over the limit${over.length ? `<span class="n">${over.length}</span>` : ''}</button>
          <button type="button" data-fa="low" class="${S.tab === 'low' ? 'on' : ''}">Lowest 10</button>
          <button type="button" data-fa="high" class="${S.tab === 'high' ? 'on' : ''}">Highest 10</button><button type="button" class="fh-fa-tog" data-fa-tog aria-expanded="${open}">${open ? 'Hide list ▴' : 'Show list ▾'}</button></div></div>${open ? `<div class="fh-fa-l">${body}</div>` : ''}</div>`;
        box.querySelectorAll('[data-fa]').forEach((x) => { x.onclick = () => { S.tab = x.dataset.fa; S.all = false; try { localStorage.setItem('fh_fa_open', '1'); } catch (_e) {} paint(); }; });
        const tog = box.querySelector('[data-fa-tog]'); if (tog) tog.onclick = () => { try { localStorage.setItem('fh_fa_open', isOpen() ? '0' : '1'); } catch (_e) {} paint(); };
        const more = box.querySelector('[data-all]'); if (more) more.onclick = () => { S.all = !S.all; paint(); };
        box.querySelectorAll('[data-rk]').forEach((x) => {
          x.onclick = () => { try { const mine = rows.filter((r) => r.rk === x.dataset.rk); ftEmpPopup(mine, ms, m, x.querySelector('.nm').firstChild.textContent); } catch (err) { console.warn(err); } };
        });
      };
      paint();
    } catch (e) { console.warn('fuel alerts', e); box.innerHTML = ''; }
  };
  // start last, after every helper above exists
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

/* /leads private dashboard.
 * Security model: RLS on public.leads is the real control (only Will's auth user can select).
 * Every lead field is untrusted text from a public form. Render it ONLY via textContent /
 * createTextNode. Never innerHTML. Links: mailto: for valid-looking emails, and https report
 * links that match REPORT_RE exactly. Nothing else becomes a link.
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://tnkqxniwjomkojufuxlp.supabase.co';
  // Publishable anon key (same one index.html ships). Safe to expose; RLS protects the data.
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRua3F4bml3am9ta29qdWZ1eGxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MzE2OTUsImV4cCI6MjA5MDUwNzY5NX0.vwdflPZePcMKUQP5cI9jXu8bxiqa2O2NKFo_ycR5b0U';
  var OWNER_EMAIL = 'will@vantagemode.com';
  var LAST_SEEN_KEY = 'vm_leads_last_seen';
  var DAY = 86400000;
  var COLUMNS = 'id,created_at,name,email,company,brand,service,project_type,budget,timeline,message,source';

  var CHIPS = ['scorecard', 'kpi_template', 'sdr_calculator', 'teardown', 'project_wizard', 'contact', 'sow_form', 'other'];
  var CHIP_LABELS = { scorecard: 'Scorecard', kpi_template: 'KPI template', sdr_calculator: 'SDR calculator', teardown: 'Teardown', project_wizard: 'Project wizard', contact: 'Contact', sow_form: 'SOW form', other: 'Other' };
  var DETAIL_SOURCES = ['project_wizard', 'contact', 'teardown', 'sow_form'];

  // ── Kenji's rules (pure functions) ──

  function parseEmail(raw) {
    var e = String(raw || '').toLowerCase().trim();
    var at = e.lastIndexOf('@');
    var rawLocal = at < 0 ? e : e.slice(0, at);
    var domain = at < 0 ? '' : e.slice(at + 1);
    var gmail = domain === 'gmail.com' || domain === 'googlemail.com';
    var local = rawLocal.replace(/\+.*$/, '');
    if (gmail) local = local.replace(/\./g, '');
    return { rawLocal: rawLocal, local: local, domain: domain, gmail: gmail };
  }

  function isInternal(lead) {
    var p = parseEmail(lead.email);
    return ['vantagemode.com', 'getveroxa.com'].indexOf(p.domain) !== -1 ||
      (p.gmail && p.local === 'thewillmauro') ||
      /^(veroxa|vantage ?mode)$/i.test(String(lead.brand || lead.company || '').trim());
  }

  function botSignals(lead) {
    var p = parseEmail(lead.email);
    var out = [];
    if (p.gmail && (p.rawLocal.match(/\./g) || []).length >= 4) out.push('dot-split gmail');
    if (!(lead.name && String(lead.name).trim())) out.push('empty name');
    if (lead.source === 'sdr_calculator' && /^\[SDR calculator\] 5 SDRs × \$95K × 60% outbound/.test(lead.message || '')) out.push('calculator at defaults');
    return out;
  }

  function chipFor(source) {
    if (source === 'contact_form' || source === 'contact') return 'contact';
    return CHIPS.indexOf(source) !== -1 ? source : 'other';
  }

  function parseScorecard(message) {
    var msg = String(message || '');
    var m = msg.match(/GTM Readiness Scorecard:\s*(\d{1,3})\/100\s*\(([^)]+)\)/);
    if (!m) return null;
    var line2 = msg.split('\n')[1] || '';
    var pillars = {};
    var re = /(Data|AI Agents|RevOps)\s+(\d{1,3})/g, pm;
    while ((pm = re.exec(line2))) pillars[pm[1]] = Number(pm[2]);
    var w = msg.match(/^Weakest:\s*(.+)$/m);
    var link = msg.match(/Report link:\s*(https:\/\/www\.vantagemode\.com\/scorecard\?r=\d+)/);
    return { overall: Number(m[1]), band: m[2], pillars: pillars, weakest: w ? w[1].trim() : null, link: link ? link[1] : null };
  }

  function readLastSeen() {
    try { return localStorage.getItem(LAST_SEEN_KEY); } catch (e) { return null; }
  }
  function writeLastSeen(iso) {
    try { localStorage.setItem(LAST_SEEN_KEY, iso); return true; } catch (e) { return false; }
  }

  // Annotate rows once: internal, bot reasons, real, new, chip.
  function classify(rows, lastSeenIso, now) {
    var lastSeen = lastSeenIso ? Date.parse(lastSeenIso) : NaN;
    var cutoff = isNaN(lastSeen) ? now - 7 * DAY : lastSeen;
    return rows.map(function (r) {
      var reasons = botSignals(r);
      var internal = isInternal(r);
      var bot = reasons.length >= 2;
      var t = Date.parse(r.created_at);
      return { row: r, t: t, internal: internal, bot: bot, reasons: reasons, real: !internal && !bot, isNew: t > cutoff, chip: chipFor(r.source) };
    });
  }

  function summarize(items, now) {
    var s = { newCount: 0, real7: 0, bots: 0, by30: {} };
    items.forEach(function (it) {
      if (it.internal) return;
      if (it.isNew) s.newCount++;
      if (it.bot) s.bots++;
      if (!it.real) return;
      if (it.t >= now - 7 * DAY) s.real7++;
      if (it.t >= now - 30 * DAY) s.by30[it.chip] = (s.by30[it.chip] || 0) + 1;
    });
    return s;
  }

  function timeAgo(t, now) {
    if (isNaN(t)) return '';
    var s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 30 * 86400) return Math.floor(s / 86400) + 'd ago';
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ── DOM helpers (text only) ──

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function $(id) { return document.getElementById(id); }
  function show(node, on) { node.hidden = !on; }

  var EMAIL_RE = /^[^\s@<>"'()\\,;:]+@[^\s@<>"'()\\,;:]+\.[^\s@<>"'()\\,;:]+$/;

  function renderCard(it, now) {
    var r = it.row;
    var card = el('article', 'lv-card' + (it.isNew ? ' is-new' : '') + (it.bot ? ' is-bot' : ''));

    var top = el('div', 'lv-card-top');
    var nameWrap = el('div', 'lv-name' + (r.name && String(r.name).trim() ? '' : ' is-empty'));
    if (it.isNew) {
      var dot = el('span', 'lv-newdot');
      dot.setAttribute('aria-label', 'New');
      dot.setAttribute('role', 'img');
      nameWrap.appendChild(dot);
    }
    nameWrap.appendChild(document.createTextNode(r.name && String(r.name).trim() ? r.name : 'No name'));
    top.appendChild(nameWrap);
    var time = el('time', 'lv-time', timeAgo(it.t, now));
    if (!isNaN(it.t)) { time.dateTime = new Date(it.t).toISOString(); time.title = new Date(it.t).toLocaleString(); }
    top.appendChild(time);
    card.appendChild(top);

    var sub = el('div', 'lv-sub');
    var email = String(r.email || '').trim();
    if (EMAIL_RE.test(email)) {
      var a = el('a', null, email);
      a.href = 'mailto:' + email;
      sub.appendChild(a);
    } else if (email) {
      sub.appendChild(el('span', null, email));
    }
    var co = r.brand || r.company;
    if (co) sub.appendChild(el('span', null, co));
    card.appendChild(sub);

    var badges = el('div', 'lv-badges');
    badges.appendChild(el('span', 'lv-badge src', CHIP_LABELS[it.chip] + (it.chip === 'other' && r.source ? ': ' + r.source : '')));
    if (it.internal) badges.appendChild(el('span', 'lv-badge', 'Internal test'));
    card.appendChild(badges);

    if (it.bot) card.appendChild(el('p', 'lv-bot', 'Likely bot: ' + it.reasons.join(', ')));

    if (it.chip === 'scorecard') renderScorecard(card, r);
    else if (DETAIL_SOURCES.indexOf(it.chip) !== -1) { renderFields(card, r); renderMessage(card, r.message); }
    else if (it.chip !== 'kpi_template') renderMessage(card, r.message);
    return card;
  }

  function renderScorecard(card, r) {
    var sc = parseScorecard(r.message);
    if (!sc) {
      card.querySelector('.lv-badges').appendChild(el('span', 'lv-badge warn', 'Unparsed'));
      renderMessage(card, r.message);
      return;
    }
    var box = el('div', 'lv-score');
    var num = el('div', 'lv-score-num', sc.overall);
    num.appendChild(el('small', null, '/100'));
    box.appendChild(num);
    box.appendChild(el('div', 'lv-band', sc.band));
    var pillars = el('div', 'lv-pillars');
    ['Data', 'AI Agents', 'RevOps'].forEach(function (k) {
      var span = el('span', null, k);
      span.appendChild(el('b', null, sc.pillars[k] != null ? sc.pillars[k] : '-'));
      pillars.appendChild(span);
    });
    box.appendChild(pillars);
    var weak = el('div', 'lv-weak', 'Weakest: ');
    weak.appendChild(el('b', null, sc.weakest || '-'));
    box.appendChild(weak);
    var rep = el('div', 'lv-report');
    if (sc.link) {
      var a = el('a', null, 'Open report');
      a.href = sc.link;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      rep.appendChild(a);
    } else {
      rep.textContent = 'Report link: -';
    }
    box.appendChild(rep);
    card.appendChild(box);
  }

  function renderFields(card, r) {
    var dl = el('dl', 'lv-fields');
    [['Service', r.service || r.project_type], ['Budget', r.budget], ['Timeline', r.timeline]].forEach(function (f) {
      var d = el('div', 'lv-field');
      d.appendChild(el('dt', null, f[0]));
      d.appendChild(el('dd', null, f[1] ? f[1] : '-'));
      dl.appendChild(d);
    });
    card.appendChild(dl);
  }

  function renderMessage(card, message) {
    var text = String(message || '').trim();
    if (!text) return;
    var p = el('p', 'lv-msg is-clamped', text);
    card.appendChild(p);
    // Only offer "Show full message" when the clamp hides something.
    var long = text.split('\n').length > 3 || text.length > 240;
    if (!long) { p.classList.remove('is-clamped'); return; }
    var btn = el('button', 'lv-more', 'Show full message');
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', function () {
      var open = p.classList.toggle('is-clamped') === false;
      btn.textContent = open ? 'Show less' : 'Show full message';
      btn.setAttribute('aria-expanded', String(open));
    });
    card.appendChild(btn);
  }

  // ── App ──

  var state = { items: [], chip: 'all', showInternal: false, now: Date.now() };
  var sb = null;

  function setStatus(text) {
    var s = $('statusLine');
    s.textContent = text || '';
    show(s, !!text);
  }

  function clearData() {
    state.items = [];
    $('cards').replaceChildren();
    $('stat30').replaceChildren();
    $('chips').replaceChildren();
  }

  function showSignIn(notice) {
    clearData();
    show($('dashView'), false);
    show($('signOutBtn'), false);
    setStatus('');
    show($('signInView'), true);
    var n = $('signInNotice');
    n.textContent = notice || '';
    show(n, !!notice);
  }

  function renderSummary() {
    var s = summarize(state.items, state.now);
    $('newCount').textContent = String(s.newCount);
    $('newLabel').textContent = s.newCount === 1 ? 'new lead since your last visit' : 'new leads since your last visit';
    $('markSeenBtn').disabled = state.items.length === 0;
    $('stat7').textContent = String(s.real7);
    $('statBots').textContent = String(s.bots);
    var ul = $('stat30');
    ul.replaceChildren();
    var any = false;
    CHIPS.forEach(function (c) {
      if (!s.by30[c]) return;
      any = true;
      var li = el('li', null, CHIP_LABELS[c]);
      li.appendChild(el('b', null, s.by30[c]));
      ul.appendChild(li);
    });
    if (!any) ul.appendChild(el('li', null, 'None yet'));
  }

  function renderChips() {
    var wrap = $('chips');
    wrap.replaceChildren();
    var counts = { all: 0 };
    state.items.forEach(function (it) {
      if (it.internal && !state.showInternal) return;
      counts.all++;
      counts[it.chip] = (counts[it.chip] || 0) + 1;
    });
    ['all'].concat(CHIPS).forEach(function (c) {
      var b = el('button', 'lv-chip', c === 'all' ? 'All' : CHIP_LABELS[c]);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(state.chip === c));
      b.appendChild(el('span', 'n', counts[c] || 0));
      b.addEventListener('click', function () { state.chip = c; renderChips(); renderCards(); });
      wrap.appendChild(b);
    });
  }

  function renderCards() {
    var wrap = $('cards');
    wrap.replaceChildren();
    var hiddenInternal = 0;
    var visible = state.items.filter(function (it) {
      if (state.chip !== 'all' && it.chip !== state.chip) return false;
      if (it.internal && !state.showInternal) { hiddenInternal++; return false; }
      return true;
    });
    visible.forEach(function (it) { wrap.appendChild(renderCard(it, state.now)); });
    var none = state.items.length === 0;
    show($('emptyAll'), none);
    show($('emptyFiltered'), !none && visible.length === 0);
    var note = $('hiddenNote');
    note.textContent = hiddenInternal ? hiddenInternal + (hiddenInternal === 1 ? ' internal test hidden.' : ' internal tests hidden.') : '';
    show(note, hiddenInternal > 0);
  }

  function renderAll() { renderSummary(); renderChips(); renderCards(); }

  async function loadDashboard(session) {
    show($('signInView'), false);
    show($('signOutBtn'), true);
    setStatus('Loading leads...');
    var res;
    try {
      res = await sb.from('leads').select(COLUMNS).order('created_at', { ascending: false }).limit(2000);
    } catch (e) {
      res = { data: null, error: e };
    }
    if (res.error) {
      show($('dashView'), false);
      setStatus('Could not load leads: ' + (res.error.message || 'unknown error'));
      return;
    }
    var rows = res.data || [];
    var email = String((session.user && session.user.email) || '').toLowerCase();
    if (rows.length === 0 && email !== OWNER_EMAIL) {
      try { await sb.auth.signOut({ scope: 'global' }); } catch (e) {}
      showSignIn('No access. This account cannot see leads, so we signed it out.');
      return;
    }
    state.now = Date.now();
    state.items = classify(rows, readLastSeen(), state.now);
    setStatus('');
    show($('dashView'), true);
    renderAll();
  }

  function markAllSeen() {
    var max = 0;
    state.items.forEach(function (it) { if (!isNaN(it.t) && it.t > max) max = it.t; });
    if (!max) return;
    var iso = new Date(max).toISOString();
    if (!writeLastSeen(iso)) setStatus('Could not save "seen" in this browser (storage blocked).');
    state.items = classify(state.items.map(function (it) { return it.row; }), iso, state.now);
    renderAll();
  }

  function initTheme() {
    $('themeToggle').addEventListener('click', function () {
      var light = document.documentElement.getAttribute('data-theme') === 'light';
      var next = light ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('vm-theme', next); } catch (e) {}
    });
  }

  async function init() {
    initTheme();
    if (!window.supabase || !window.supabase.createClient) {
      setStatus('Could not load the sign-in library. Check your connection and reload.');
      return;
    }
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });

    $('signInForm').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var err = $('signInErr');
      show(err, false);
      var email = $('siEmail').value.trim();
      var password = $('siPassword').value;
      if (!email || !password) { err.textContent = 'Enter your email and password.'; show(err, true); return; }
      var btn = $('signInBtn');
      btn.disabled = true;
      try {
        var r = await sb.auth.signInWithPassword({ email: email, password: password });
        if (r.error || !r.data || !r.data.session) throw r.error || new Error('No session returned');
        $('siPassword').value = '';
        show($('signInNotice'), false);
        await loadDashboard(r.data.session);
      } catch (e) {
        err.textContent = 'Sign-in failed: ' + ((e && e.message) || 'unknown error');
        show(err, true);
      } finally {
        btn.disabled = false;
      }
    });

    $('signOutBtn').addEventListener('click', async function () {
      try { await sb.auth.signOut({ scope: 'global' }); } catch (e) {}
      showSignIn('');
    });
    $('markSeenBtn').addEventListener('click', markAllSeen);
    $('refreshBtn').addEventListener('click', async function () {
      var r = await sb.auth.getSession();
      if (r.data && r.data.session) loadDashboard(r.data.session); else showSignIn('');
    });
    $('showInternal').addEventListener('change', function (e) {
      state.showInternal = e.target.checked;
      renderChips();
      renderCards();
    });

    var s = await sb.auth.getSession();
    if (s.data && s.data.session) loadDashboard(s.data.session); else showSignIn('');
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { parseEmail: parseEmail, isInternal: isInternal, botSignals: botSignals, parseScorecard: parseScorecard, classify: classify, summarize: summarize, chipFor: chipFor };
  } else {
    init();
  }
})();

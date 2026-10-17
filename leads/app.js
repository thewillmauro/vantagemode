/* /leads private dashboard.
 * Security model: RLS on public.leads is the real control (only Will's auth user can select,
 * and update only status and notes). Every lead field is untrusted text from a public form or
 * a Cal.com booking. Render it ONLY via textContent / createTextNode / value. Never innerHTML.
 * Links: mailto: for valid-looking emails, and https report links that match REPORT_RE
 * exactly. Nothing else becomes a link. The only image is the MFA enrollment QR code, and only
 * when it is a data:image/svg+xml URL returned by Supabase Auth.
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://tnkqxniwjomkojufuxlp.supabase.co';
  // Publishable anon key (same one index.html ships). Safe to expose; RLS protects the data.
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRua3F4bml3am9ta29qdWZ1eGxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MzE2OTUsImV4cCI6MjA5MDUwNzY5NX0.vwdflPZePcMKUQP5cI9jXu8bxiqa2O2NKFo_ycR5b0U';
  var OWNER_EMAIL = 'will@vantagemode.com';
  var LAST_SEEN_KEY = 'vm_leads_last_seen';
  var DAY = 86400000;
  var COLUMNS_V1 = 'id,created_at,name,email,company,brand,service,project_type,budget,timeline,message,source';
  var COLUMNS = COLUMNS_V1 + ',status,notes,status_updated_at,is_demo,booking_uid';
  var NOTES_MAX = 5000;

  var CHIPS = ['scorecard', 'kpi_template', 'sdr_calculator', 'booking', 'teardown', 'project_wizard', 'contact', 'sow_form', 'other'];
  var CHIP_LABELS = { scorecard: 'Scorecard', kpi_template: 'KPI template', sdr_calculator: 'SDR calculator', booking: 'Booking', teardown: 'Teardown', project_wizard: 'Project wizard', contact: 'Contact', sow_form: 'SOW form', other: 'Other' };
  var DETAIL_SOURCES = ['project_wizard', 'contact', 'teardown', 'sow_form'];
  var STATUSES = ['new', 'contacted', 'booked', 'won', 'lost', 'spam'];
  var STATUS_LABELS = { new: 'New', contacted: 'Contacted', booked: 'Booked', won: 'Won', lost: 'Lost', spam: 'Spam' };

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

  function statusOf(row) {
    return STATUSES.indexOf(row.status) !== -1 ? row.status : 'new';
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

  // Reads the message the cal-webhook function writes:
  //   [Cal.com] Free Pipeline Teardown, Mon Oct 19, 2:00 PM ET (30 min)
  //   What's breaking in your pipeline today? → <answer>
  //   [Cal.com] Rescheduled to ...      (optional, may repeat)
  //   [Cal.com] Cancelled (was ...)     (optional)
  function parseBooking(message) {
    var lines = String(message || '').split('\n');
    var head = (lines[0] || '').match(/^\[Cal\.com\] [^,]+, (.+)$/);
    if (!head) return null;
    var out = { time: head[1], question: null, answer: null, rescheduled: false, cancelled: false };
    var answerLines = [];
    for (var i = 1; i < lines.length; i++) {
      var l = lines[i];
      var rs = l.match(/^\[Cal\.com\] Rescheduled to (.+)$/);
      if (rs) { out.time = rs[1]; out.rescheduled = true; continue; }
      if (/^\[Cal\.com\] Cancelled/.test(l)) { out.cancelled = true; continue; }
      if (out.question === null) {
        var k = l.indexOf(' → ');
        if (k !== -1) { out.question = l.slice(0, k); answerLines.push(l.slice(k + 3)); continue; }
      }
      answerLines.push(l);
    }
    var a = answerLines.join('\n').trim();
    out.answer = a || null;
    return out;
  }

  function readLastSeen() {
    try { return localStorage.getItem(LAST_SEEN_KEY); } catch (e) { return null; }
  }
  function writeLastSeen(iso) {
    try { localStorage.setItem(LAST_SEEN_KEY, iso); return true; } catch (e) { return false; }
  }

  // Annotate rows once: internal, bot reasons, demo, spam, real, new, chip.
  // Demo rows and spam are never "real" and never "new".
  function classify(rows, lastSeenIso, now) {
    var lastSeen = lastSeenIso ? Date.parse(lastSeenIso) : NaN;
    var cutoff = isNaN(lastSeen) ? now - 7 * DAY : lastSeen;
    return rows.map(function (r) {
      var reasons = botSignals(r);
      var internal = isInternal(r);
      var bot = reasons.length >= 2;
      var demo = r.is_demo === true;
      var spam = statusOf(r) === 'spam';
      var t = Date.parse(r.created_at);
      return {
        row: r, t: t, internal: internal, bot: bot, reasons: reasons, demo: demo, spam: spam,
        real: !internal && !bot && !demo && !spam,
        isNew: !demo && !spam && t > cutoff,
        chip: chipFor(r.source)
      };
    });
  }

  function summarize(items, now) {
    var s = { newCount: 0, real7: 0, bots: 0, by30: {} };
    items.forEach(function (it) {
      if (it.internal || it.demo) return;
      if (it.isNew) s.newCount++;
      if (it.bot) s.bots++;
      if (!it.real) return;
      if (it.t >= now - 7 * DAY) s.real7++;
      if (it.t >= now - 30 * DAY) s.by30[it.chip] = (s.by30[it.chip] || 0) + 1;
    });
    return s;
  }

  function hasRealLeads(items) {
    return items.some(function (it) { return !it.demo && !it.internal && !it.bot && !it.spam; });
  }

  // Which cards show. Spam is hidden unless "Show spam" is on or the Spam status chip is picked.
  function isVisible(it, f) {
    if (f.chip !== 'all' && it.chip !== f.chip) return false;
    if (f.status !== 'all' && statusOf(it.row) !== f.status) return false;
    if (it.internal && !f.showInternal) return false;
    if (it.demo && !f.showDemo) return false;
    if (it.spam && !f.showSpam && f.status !== 'spam') return false;
    return true;
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
  var cardSeq = 0;

  function renderCard(it, now) {
    var r = it.row;
    var card = el('article', 'lv-card' + (it.isNew ? ' is-new' : '') + (it.bot ? ' is-bot' : '') + (it.demo ? ' is-demo' : ''));
    card.dataset.status = statusOf(r);

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
    if (it.demo) badges.appendChild(el('span', 'lv-badge demo', 'Demo'));
    if (it.internal) badges.appendChild(el('span', 'lv-badge', 'Internal test'));
    card.appendChild(badges);

    if (it.bot) card.appendChild(el('p', 'lv-bot', 'Likely bot: ' + it.reasons.join(', ')));

    if (it.chip === 'scorecard') renderScorecard(card, r);
    else if (it.chip === 'booking') renderBookingDetail(card, r);
    else if (DETAIL_SOURCES.indexOf(it.chip) !== -1) { renderFields(card, r); renderMessage(card, r.message); }
    else if (it.chip !== 'kpi_template') renderMessage(card, r.message);

    if (state.v2) renderPipeline(card, it);
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

  function renderBookingDetail(card, r) {
    var b = parseBooking(r.message);
    if (!b) { renderMessage(card, r.message); return; }
    if (b.cancelled) card.querySelector('.lv-badges').appendChild(el('span', 'lv-badge warn', 'Cancelled'));
    else if (b.rescheduled) card.querySelector('.lv-badges').appendChild(el('span', 'lv-badge', 'Rescheduled'));
    var box = el('div', 'lv-booking');
    var when = el('p', 'lv-call' + (b.cancelled ? ' is-cancelled' : ''));
    when.appendChild(el('span', 'lv-call-label', 'Call'));
    when.appendChild(el('b', null, b.time));
    box.appendChild(when);
    if (b.question) box.appendChild(el('p', 'lv-q', b.question));
    card.appendChild(box);
    if (b.answer) renderMessage(card, b.answer);
    else box.appendChild(el('p', 'lv-muted lv-q', 'No answer to the booking question.'));
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

  // Status select + notes, saved straight to Supabase. Optimistic, rolled back on error.
  function renderPipeline(card, it) {
    var r = it.row;
    var id = 'c' + (++cardSeq);
    var box = el('div', 'lv-pipe');

    var row1 = el('div', 'lv-pipe-row');
    var lab = el('label', 'lv-pipe-label', 'Status');
    lab.htmlFor = id + 's';
    var sel = el('select', 'lv-select lv-status');
    sel.id = id + 's';
    STATUSES.forEach(function (s) {
      var o = el('option', null, STATUS_LABELS[s]);
      o.value = s;
      sel.appendChild(o);
    });
    sel.value = statusOf(r);
    sel.dataset.status = sel.value;
    var stamp = el('span', 'lv-stamp');
    var msg = el('span', 'lv-save-msg');
    msg.setAttribute('role', 'status');
    function paintStamp() {
      var t = Date.parse(r.status_updated_at);
      stamp.textContent = isNaN(t) ? '' : 'Status set ' + timeAgo(t, Date.now());
      if (!isNaN(t)) stamp.title = new Date(t).toLocaleString();
    }
    paintStamp();
    row1.appendChild(lab);
    row1.appendChild(sel);
    row1.appendChild(stamp);
    box.appendChild(row1);

    sel.addEventListener('change', async function () {
      var prev = statusOf(r);
      var prevStamp = r.status_updated_at;
      var next = sel.value;
      setRowStatus(it, card, sel, next);
      msg.textContent = 'Saving...';
      msg.className = 'lv-save-msg';
      sel.disabled = true;
      var res = await saveFields(r.id, { status: next }, 'id,status,status_updated_at');
      sel.disabled = false;
      if (res.error) {
        setRowStatus(it, card, sel, prev);
        r.status_updated_at = prevStamp;
        msg.textContent = 'Not saved: ' + res.error;
        msg.className = 'lv-save-msg is-err';
      } else {
        r.status_updated_at = res.row.status_updated_at;
        msg.textContent = 'Saved';
        msg.className = 'lv-save-msg is-ok';
      }
      paintStamp();
      renderSummary();
      renderChips();
    });

    var nlab = el('label', 'lv-pipe-label', 'Notes');
    nlab.htmlFor = id + 'n';
    box.appendChild(nlab);
    var ta = el('textarea', 'lv-notes');
    ta.id = id + 'n';
    ta.maxLength = NOTES_MAX;
    ta.value = r.notes || '';
    // Grow with the text (rough wrap estimate at phone width), 2 to 10 rows.
    function fitRows() {
      var v = ta.value;
      var est = v.split('\n').reduce(function (n, line) { return n + 1 + Math.floor(line.length / 38); }, 0);
      ta.rows = Math.min(10, Math.max(2, est));
    }
    fitRows();
    box.appendChild(ta);

    var row2 = el('div', 'lv-pipe-row');
    var save = el('button', 'lv-btn-ghost lv-save', 'Save notes');
    save.type = 'button';
    save.disabled = true;
    var count = el('span', 'lv-count');
    function paintCount() {
      count.textContent = ta.value.length > NOTES_MAX - 500 ? ta.value.length + ' / ' + NOTES_MAX : '';
      save.disabled = ta.value === (r.notes || '');
    }
    ta.addEventListener('input', function () { paintCount(); fitRows(); });
    save.addEventListener('click', async function () {
      var prev = r.notes || '';
      var next = ta.value.trim() ? ta.value : '';
      r.notes = next || null;
      save.disabled = true;
      msg.textContent = 'Saving...';
      msg.className = 'lv-save-msg';
      var res = await saveFields(r.id, { notes: next || null }, 'id,notes');
      if (res.error) {
        r.notes = prev || null;
        ta.value = prev;
        fitRows();
        msg.textContent = 'Not saved: ' + res.error;
        msg.className = 'lv-save-msg is-err';
      } else {
        msg.textContent = 'Saved';
        msg.className = 'lv-save-msg is-ok';
      }
      paintCount();
    });
    row2.appendChild(save);
    row2.appendChild(count);
    row2.appendChild(msg);
    box.appendChild(row2);
    card.appendChild(box);
  }

  function setRowStatus(it, card, sel, status) {
    it.row.status = status;
    it.spam = status === 'spam';
    it.real = !it.internal && !it.bot && !it.demo && !it.spam;
    if (it.spam) it.isNew = false;
    sel.value = status;
    sel.dataset.status = status;
    card.dataset.status = status;
  }

  // RLS returns zero rows (not an error) when an update is not allowed, so one row back is the
  // only success.
  async function saveFields(id, fields, cols) {
    try {
      var res = await sb.from('leads').update(fields).eq('id', id).select(cols);
      if (res.error) return { error: res.error.message || 'unknown error' };
      if (!res.data || res.data.length !== 1) return { error: 'not allowed. Sign in again (with your code if you use one).' };
      return { row: res.data[0] };
    } catch (e) {
      return { error: (e && e.message) || 'network error' };
    }
  }

  // ── App ──

  var state = { items: [], chip: 'all', status: 'all', showInternal: false, showDemo: false, demoTouched: false, showSpam: false, v2: true, now: Date.now() };
  var sb = null;

  function filters() {
    return { chip: state.chip, status: state.status, showInternal: state.showInternal, showDemo: state.showDemo, showSpam: state.showSpam };
  }

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
    $('statusChips').replaceChildren();
    $('factorList').replaceChildren();
    resetEnroll();
  }

  function showSignIn(notice) {
    clearData();
    show($('dashView'), false);
    show($('mfaView'), false);
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

  function chipButton(label, pressed, count, onClick, extraCls) {
    var b = el('button', 'lv-chip' + (extraCls ? ' ' + extraCls : ''), label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(pressed));
    b.appendChild(el('span', 'n', count || 0));
    b.addEventListener('click', onClick);
    return b;
  }

  function renderChips() {
    var f = filters();
    var src = { all: 0 }, st = { all: 0 };
    state.items.forEach(function (it) {
      if (isVisible(it, Object.assign({}, f, { chip: 'all' }))) { src.all++; src[it.chip] = (src[it.chip] || 0) + 1; }
      if (isVisible(it, Object.assign({}, f, { status: 'all' }))) { st.all++; }
      // Status counts ignore the spam toggle so the Spam chip always shows how many there are.
      if (isVisible(it, Object.assign({}, f, { status: 'all', showSpam: true }))) { var s = statusOf(it.row); st[s] = (st[s] || 0) + 1; }
    });

    var sw = $('statusChips');
    sw.replaceChildren();
    show(sw, state.v2);
    if (state.v2) {
      ['all'].concat(STATUSES).forEach(function (s) {
        sw.appendChild(chipButton(s === 'all' ? 'All' : STATUS_LABELS[s], state.status === s, st[s], function () {
          state.status = s; renderChips(); renderCards();
        }, s === 'all' ? '' : 'st-' + s));
      });
    }

    var wrap = $('chips');
    wrap.replaceChildren();
    ['all'].concat(CHIPS).forEach(function (c) {
      wrap.appendChild(chipButton(c === 'all' ? 'All sources' : CHIP_LABELS[c], state.chip === c, src[c], function () {
        state.chip = c; renderChips(); renderCards();
      }));
    });
  }

  function renderCards() {
    var wrap = $('cards');
    wrap.replaceChildren();
    var f = filters();
    var hiddenInternal = 0, hiddenSpam = 0, demoShown = 0;
    var visible = state.items.filter(function (it) {
      var ok = isVisible(it, f);
      if (!ok && isVisible(it, Object.assign({}, f, { showInternal: true, showSpam: true }))) {
        if (it.internal && !f.showInternal) hiddenInternal++;
        else if (it.spam) hiddenSpam++;
      }
      if (ok && it.demo) demoShown++;
      return ok;
    });
    visible.forEach(function (it) { wrap.appendChild(renderCard(it, state.now)); });
    var none = state.items.length === 0;
    show($('emptyAll'), none);
    show($('emptyFiltered'), !none && visible.length === 0);
    show($('demoBanner'), demoShown > 0);
    var parts = [];
    if (hiddenInternal) parts.push(hiddenInternal + (hiddenInternal === 1 ? ' internal test hidden.' : ' internal tests hidden.'));
    if (hiddenSpam) parts.push(hiddenSpam + ' marked spam, hidden.');
    var note = $('hiddenNote');
    note.textContent = parts.join(' ');
    show(note, parts.length > 0);
  }

  function renderAll() {
    var anyDemo = state.items.some(function (it) { return it.demo; });
    if (!state.demoTouched) state.showDemo = anyDemo && !hasRealLeads(state.items);
    $('showDemo').checked = state.showDemo;
    show($('showDemo').parentNode, anyDemo);
    show($('showSpam').parentNode, state.v2);
    show($('v1Note'), !state.v2);
    renderSummary(); renderChips(); renderCards();
  }

  async function fetchLeads() {
    var res;
    try {
      res = await sb.from('leads').select(COLUMNS).order('created_at', { ascending: false }).limit(2000);
      // Before the v2 migrations run, the new columns do not exist (42703). Fall back to v1.
      if (res.error && (res.error.code === '42703' || /does not exist/i.test(res.error.message || ''))) {
        res = await sb.from('leads').select(COLUMNS_V1).order('created_at', { ascending: false }).limit(2000);
        state.v2 = false;
      } else {
        state.v2 = true;
      }
    } catch (e) {
      res = { data: null, error: e };
    }
    return res;
  }

  async function loadDashboard(session) {
    show($('signInView'), false);
    show($('mfaView'), false);
    show($('signOutBtn'), true);
    setStatus('Loading leads...');
    var res = await fetchLeads();
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
    refreshSecurity();
  }

  function markAllSeen() {
    var max = 0;
    state.items.forEach(function (it) { if (!it.demo && !isNaN(it.t) && it.t > max) max = it.t; });
    if (!max) return;
    var iso = new Date(max).toISOString();
    if (!writeLastSeen(iso)) setStatus('Could not save "seen" in this browser (storage blocked).');
    state.items = classify(state.items.map(function (it) { return it.row; }), iso, state.now);
    renderAll();
  }

  // ── MFA (TOTP) ──
  // The aal2 policy migration is the real control. The client only asks for the code when the
  // account has a verified factor and the session is still aal1.

  async function needsCode() {
    try {
      var r = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (r.error || !r.data) return false;
      return r.data.nextLevel === 'aal2' && r.data.currentLevel !== 'aal2';
    } catch (e) { return false; }
  }

  async function verifiedFactors() {
    var r = await sb.auth.mfa.listFactors();
    if (r.error) throw r.error;
    return ((r.data && r.data.totp) || []).filter(function (f) { return f.status === 'verified'; });
  }

  async function afterSignIn(session) {
    if (await needsCode()) { showMfa(); return; }
    loadDashboard(session);
  }

  async function showMfa() {
    show($('signInView'), false);
    show($('dashView'), false);
    show($('signOutBtn'), true);
    setStatus('');
    show($('mfaView'), true);
    var sel = $('mfaFactor');
    sel.replaceChildren();
    try {
      var factors = await verifiedFactors();
      factors.forEach(function (f) {
        var o = el('option', null, f.friendly_name || 'Authenticator');
        o.value = f.id;
        sel.appendChild(o);
      });
      show(sel, factors.length > 1);
      show($('mfaFactorLabel'), factors.length > 1);
    } catch (e) {
      $('mfaErr').textContent = 'Could not list authenticators: ' + ((e && e.message) || 'unknown error');
      show($('mfaErr'), true);
    }
    $('mfaCode').value = '';
    $('mfaCode').focus();
  }

  function resetEnroll() {
    state.enrolling = null;
    show($('enrollStep'), false);
    show($('enrollForm'), true);
    $('enrollSecret').textContent = '';
    var box = $('enrollQr');
    box.replaceChildren();
    show(box, false);
    $('enrollCode').value = '';
  }

  function securityMsg(err, ok) {
    $('securityErr').textContent = err || '';
    show($('securityErr'), !!err);
    $('securityOk').textContent = ok || '';
    show($('securityOk'), !!ok);
  }

  async function refreshSecurity() {
    var list = $('factorList');
    list.replaceChildren();
    try {
      var aal = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      var lvl = aal.data && aal.data.currentLevel;
      $('aalLine').textContent = lvl === 'aal2' ? 'This session passed two-step sign-in (aal2).' : 'This session used a password only (aal1).';
      var r = await sb.auth.mfa.listFactors();
      if (r.error) throw r.error;
      var all = (r.data && r.data.all) || [];
      var totp = all.filter(function (f) { return f.factor_type === 'totp'; });
      if (!totp.length) list.appendChild(el('li', 'lv-muted', 'None yet.'));
      totp.forEach(function (f) {
        var li = el('li', null);
        li.appendChild(el('b', null, f.friendly_name || 'Authenticator'));
        li.appendChild(el('span', 'lv-badge' + (f.status === 'verified' ? ' ok' : ' warn'), f.status === 'verified' ? 'Verified' : 'Not finished'));
        var t = Date.parse(f.created_at);
        if (!isNaN(t)) li.appendChild(el('span', 'lv-muted', 'added ' + timeAgo(t, Date.now())));
        if (f.status !== 'verified') {
          var rm = el('button', 'lv-btn-ghost lv-small', 'Remove');
          rm.type = 'button';
          rm.addEventListener('click', async function () {
            var u = await sb.auth.mfa.unenroll({ factorId: f.id });
            if (u.error) securityMsg('Could not remove: ' + u.error.message); else refreshSecurity();
          });
          li.appendChild(rm);
        }
        list.appendChild(li);
      });
      var verified = totp.filter(function (f) { return f.status === 'verified'; }).length;
      if (verified === 1) list.appendChild(el('li', 'lv-muted', 'Add a second one (a password manager works) before the aal2 policy is applied.'));
    } catch (e) {
      list.appendChild(el('li', 'lv-err', 'Could not load authenticators: ' + ((e && e.message) || 'unknown error')));
    }
  }

  function initSecurity() {
    $('enrollForm').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      securityMsg('');
      var name = $('enrollName').value.trim();
      if (!name) { securityMsg('Give it a name, like "Phone app" or "Password manager".'); return; }
      var btn = $('enrollBtn');
      btn.disabled = true;
      try {
        var r = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: name });
        if (r.error) throw r.error;
        state.enrolling = r.data.id;
        $('enrollSecret').textContent = r.data.totp.secret;
        var qr = String(r.data.totp.qr_code || '');
        var box = $('enrollQr');
        box.replaceChildren();
        if (qr.indexOf('data:image/svg+xml') === 0) {
          var img = el('img');
          img.alt = 'QR code for the authenticator app';
          img.width = 180;
          img.height = 180;
          img.src = qr;
          box.appendChild(img);
        }
        show(box, box.childNodes.length > 0);
        show($('enrollForm'), false);
        show($('enrollStep'), true);
        $('enrollCode').focus();
        refreshSecurity();
      } catch (e) {
        securityMsg('Could not start enrollment: ' + ((e && e.message) || 'unknown error'));
      } finally {
        btn.disabled = false;
      }
    });
    $('enrollVerifyForm').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      securityMsg('');
      var code = $('enrollCode').value.replace(/\s/g, '');
      if (!/^\d{6}$/.test(code)) { securityMsg('Enter the 6-digit code.'); return; }
      var btn = $('enrollVerifyBtn');
      btn.disabled = true;
      try {
        var r = await sb.auth.mfa.challengeAndVerify({ factorId: state.enrolling, code: code });
        if (r.error) throw r.error;
        resetEnroll();
        $('enrollName').value = '';
        securityMsg('', 'Saved. This authenticator now works for sign-in.');
        refreshSecurity();
      } catch (e) {
        securityMsg('That code did not work: ' + ((e && e.message) || 'unknown error'));
      } finally {
        btn.disabled = false;
      }
    });
    $('enrollCancelBtn').addEventListener('click', async function () {
      var id = state.enrolling;
      resetEnroll();
      if (id) { try { await sb.auth.mfa.unenroll({ factorId: id }); } catch (e) {} }
      refreshSecurity();
    });
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
        await afterSignIn(r.data.session);
      } catch (e) {
        err.textContent = 'Sign-in failed: ' + ((e && e.message) || 'unknown error');
        show(err, true);
      } finally {
        btn.disabled = false;
      }
    });

    $('mfaForm').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var err = $('mfaErr');
      show(err, false);
      var code = $('mfaCode').value.replace(/\s/g, '');
      if (!/^\d{6}$/.test(code)) { err.textContent = 'Enter the 6-digit code.'; show(err, true); return; }
      var btn = $('mfaBtn');
      btn.disabled = true;
      try {
        var factorId = $('mfaFactor').value;
        if (!factorId) { var fs = await verifiedFactors(); factorId = fs[0] && fs[0].id; }
        if (!factorId) throw new Error('No authenticator found');
        var r = await sb.auth.mfa.challengeAndVerify({ factorId: factorId, code: code });
        if (r.error) throw r.error;
        $('mfaCode').value = '';
        var s = await sb.auth.getSession();
        if (s.data && s.data.session) loadDashboard(s.data.session); else showSignIn('');
      } catch (e) {
        err.textContent = 'That code did not work: ' + ((e && e.message) || 'unknown error');
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
      if (r.data && r.data.session) afterSignIn(r.data.session); else showSignIn('');
    });
    $('showInternal').addEventListener('change', function (e) {
      state.showInternal = e.target.checked;
      renderChips(); renderCards();
    });
    $('showDemo').addEventListener('change', function (e) {
      state.showDemo = e.target.checked;
      state.demoTouched = true;
      renderChips(); renderCards();
    });
    $('showSpam').addEventListener('change', function (e) {
      state.showSpam = e.target.checked;
      renderChips(); renderCards();
    });
    initSecurity();

    var s = await sb.auth.getSession();
    if (s.data && s.data.session) afterSignIn(s.data.session); else showSignIn('');
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { parseEmail: parseEmail, isInternal: isInternal, botSignals: botSignals, parseScorecard: parseScorecard, parseBooking: parseBooking, classify: classify, summarize: summarize, chipFor: chipFor, isVisible: isVisible, hasRealLeads: hasRealLeads, statusOf: statusOf };
  } else {
    init();
  }
})();

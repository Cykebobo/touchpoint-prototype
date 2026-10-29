// Touchpoint core: store, follow-up engine, signal detection, insights and API routes.
// Shared by the Node server and the browser (standalone mode on static hosting).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./domain'), require('./seed'));
  else root.TPCore = factory(root.TPDomain, root.TPSeed);
})(typeof self !== 'undefined' ? self : this, function (D, S) {

function createCore({ load, save, onChange = () => {}, draft } = {}) {
  let db = load() || S.seed(Date.now());
  const now = () => Date.now() + (db.clockOffset || 0);
  const rid = p => p + Array.from({ length: 6 }, () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('');
  const findCase = cid => db.cases.find(c => c.id === cid);
  function say(c, from, text, extra = {}) { c.transcript.push({ from, text, at: now(), ...extra }); c.updatedAt = now(); }
  function changed(what) { save(db); onChange(what); }

  // ---------- follow-up engine ----------
  function tick() {
    const t = now();
    let dirty = false;
    for (const c of db.cases) {
      for (const p of c.promises) {
        if (!p.doneAt && p.dueAt < t && !p.overdueAt) {
          p.overdueAt = t; dirty = true;
          say(c, 'engine', `Overdue: “${p.text}” was due ${fmtAgo(t - p.dueAt)} ago. Advisor alerted and case moved to the top of the queue.`);
          say(c, 'system', p.type === 'first_response'
            ? 'Sorry for the wait. Your case is now at the top of our queue and an advisor will reply shortly.'
            : `We have not forgotten you. “${p.text}” is running late and an advisor is on it now.`);
        }
      }
      if (c.status === 'awaiting_consumer') {
        const idle = t - c.awaitingSince;
        if (idle > 2 * D.DAY && !c.nudgedAt) {
          c.nudgedAt = t; dirty = true;
          say(c, 'system', 'Just checking in: we still need a little information to finish this. Reply here any time and you will not need to start again.');
          say(c, 'engine', 'Consumer reminded after 48 hours without a reply.');
        } else if (idle > 5 * D.DAY) {
          c.status = 'closed'; c.closedReason = 'consumer_silent'; c.closedAt = t; dirty = true;
          say(c, 'engine', 'Closed after 5 days without a reply. Logged as a consumer-side unresolved cause.');
        }
      }
      if (c.status === 'resolved' && !c.rating && !c.surveyAt && t - c.resolvedAt > 2 * D.HOUR) {
        c.surveyAt = t; dirty = true;
        say(c, 'system', 'How did we do? Rate this conversation from 1 to 5.');
      }
      const th = D.deriveThemes(c, t);
      if (th.join() !== (c.themes || []).join()) { c.themes = th; dirty = true; }
    }
    if (detectSignals(t)) dirty = true;
    if (dirty) changed('engine');
  }

  // Product signals: 3+ similar defect or safety cases in 7 days are routed automatically.
  function detectSignals(t) {
    const groups = {};
    for (const c of db.cases) {
      if (!['defect', 'safety'].includes(c.issueType) || t - c.createdAt > 7 * D.DAY) continue;
      const k = [c.brand, c.product, c.issueType].join('|');
      (groups[k] = groups[k] || []).push(c);
    }
    let added = false;
    for (const [k, cs] of Object.entries(groups)) {
      if (cs.length < 3) continue;
      let s = db.signals.find(x => x.key === k);
      const [brand, product, issueType] = k.split('|');
      if (!s) {
        s = { id: rid('SIG-'), key: k, brand, product, issueType, owner: D.ISSUES[issueType].owner, createdAt: t, status: 'routed', caseIds: [] };
        db.signals.push(s); added = true;
      }
      const ids = cs.map(c => c.id);
      if (ids.length !== s.caseIds.length) {
        s.caseIds = ids; s.count = ids.length; s.markets = [...new Set(cs.map(c => c.country))]; s.updatedAt = t; added = true;
        for (const c of cs) if (!c.routedTo.some(r => r.signal === s.id)) {
          c.routedTo.push({ owner: s.owner, reason: `Pattern: ${ids.length} similar reports in 7 days`, at: t, signal: s.id });
          say(c, 'engine', `Linked to product signal ${s.id} and routed to ${s.owner}.`);
        }
      }
    }
    return added;
  }

  function fmtAgo(ms) { const m = Math.round(ms / 60e3); if (m < 60) return `${Math.max(1, m)} min`; const h = Math.round(ms / D.HOUR); return h < 48 ? `${h}h` : `${Math.round(h / 24)} days`; }

  // ---------- views ----------
  function risk(c, t) {
    const open = c.promises.filter(p => !p.doneAt);
    return { overdue: open.filter(p => p.dueAt < t).length, nextDue: open.length ? Math.min(...open.map(p => p.dueAt)) : null };
  }
  function summary(c) {
    const r = risk(c, now());
    return {
      id: c.id, createdAt: c.createdAt, updatedAt: c.updatedAt, status: c.status, channel: c.channel, country: c.country,
      consumer: c.consumer.name, brand: c.brand, product: c.product, issueType: c.issueType,
      issueLabel: D.ISSUES[c.issueType].label, overdue: r.overdue, nextDue: r.nextDue, themes: c.themes, rating: c.rating,
      last: c.transcript[c.transcript.length - 1],
    };
  }
  function full(c) { return { ...c, risk: risk(c, now()), copilot: D.copilot(c, now()), issueLabel: D.ISSUES[c.issueType].label }; }

  function startOfDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function insights() {
    const t = now(), cs = db.cases;
    const recent = cs.filter(c => t - c.createdAt <= 14 * D.DAY);
    const resolved = cs.filter(c => c.status === 'resolved');
    const rated = cs.filter(c => c.rating);
    const finished = cs.flatMap(c => c.promises.filter(p => p.type !== 'first_response' && p.doneAt));
    const kept = finished.filter(p => p.doneAt <= p.dueAt);
    const hours = resolved.map(c => (c.resolvedAt - c.createdAt) / D.HOUR).sort((a, b) => a - b);
    const themes = {};
    for (const c of recent) for (const th of c.themes || []) themes[th] = (themes[th] || 0) + 1;
    const country = {};
    for (const k of ['UK', 'US']) {
      const r = rated.filter(c => c.country === k);
      country[k] = { cases: cs.filter(c => c.country === k).length, rating: r.length ? r.reduce((s, c) => s + c.rating, 0) / r.length : null };
    }
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const start = startOfDay(t - i * D.DAY);
      days.push({ day: start, count: cs.filter(c => c.createdAt >= start && c.createdAt < start + D.DAY).length });
    }
    return {
      now: t,
      kpi: {
        open: cs.filter(c => !['resolved', 'closed'].includes(c.status)).length,
        overdue: cs.reduce((n, c) => n + c.promises.filter(p => !p.doneAt && p.dueAt < t).length, 0),
        fcr: resolved.length ? resolved.filter(c => !c.asks).length / resolved.length : null,
        rating: rated.length ? rated.reduce((s, c) => s + c.rating, 0) / rated.length : null,
        ratedCount: rated.length,
        medianHours: hours.length ? hours[Math.floor(hours.length / 2)] : null,
        promisesKept: finished.length ? kept.length / finished.length : null,
      },
      themes: Object.entries(themes).map(([k, n]) => ({ key: k, label: D.THEMES[k] || k, n })).sort((a, b) => b.n - a.n),
      signals: db.signals.slice().sort((a, b) => b.updatedAt - a.updatedAt),
      country,
      unresolved: {
        consumer: cs.filter(c => c.closedReason === 'consumer_silent' || c.status === 'awaiting_consumer').length,
        pg: cs.filter(c => !['resolved', 'closed'].includes(c.status) && c.promises.some(p => !p.doneAt && p.dueAt < t)).length,
      },
      days,
    };
  }

  // ---------- routes ----------
  const routes = [];
  const on = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });
  const httpErr = (code, msg) => Object.assign(new Error(msg), { code });
  const must = cid => { const c = findCase(cid); if (!c) throw httpErr(404, 'Case not found'); return c; };

  on('GET', '/api/meta', () => ({ catalogue: D.CATALOGUE, issues: D.ISSUES, themes: D.THEMES, now: now(), clockOffset: db.clockOffset || 0 }));

  on('POST', '/api/classify', (_, b) => {
    const issueType = D.ISSUES[b.issueType] ? b.issueType : D.classify(b.text);
    return { issueType, label: D.ISSUES[issueType].label, prefill: D.prefill(b.text), questions: D.ISSUES[issueType].questions };
  });

  on('POST', '/api/cases', (_, b) => {
    for (const k of ['brand', 'product', 'description', 'country']) if (!b[k]) throw httpErr(400, `Missing ${k}`);
    if (!b.consumer || !b.consumer.name) throw httpErr(400, 'Missing your name');
    const t = now();
    const issueType = D.ISSUES[b.issueType] ? b.issueType : D.classify(b.description);
    const answers = { ...D.prefill(b.description), ...(b.answers || {}) };
    const cat = D.CATALOGUE.find(x => x.brand === b.brand);
    const c = {
      id: rid('TP-'), createdAt: t, updatedAt: t, status: 'new', channel: b.channel || 'guided', country: b.country,
      consumer: { name: String(b.consumer.name).slice(0, 60), email: String(b.consumer.email || '').slice(0, 80) },
      brand: b.brand, product: b.product, sector: cat ? cat.sector : '',
      issueType, description: String(b.description).slice(0, 2000), answers,
      evidence: { photo: typeof b.photo === 'string' && b.photo.startsWith('data:image/') && b.photo.length < 1.5e6 ? b.photo : null, barcode: b.barcode || null },
      transcript: [], promises: [], routedTo: [], themes: [], asks: 0,
    };
    if (answers.consent_dtc === 'Yes' && answers.order_no) c.dtcOrder = fakeOrder(answers.order_no, c, t);
    say(c, 'consumer', c.description);
    const got = Object.keys(answers).filter(k => answers[k] && k !== 'consent_dtc').length + (c.evidence.photo ? 1 : 0);
    say(c, 'bot', `Thanks, ${c.consumer.name.split(' ')[0]}. I have logged this as “${D.ISSUES[issueType].label}” with ${got} detail${got === 1 ? '' : 's'} captured, so you will not need to repeat them. An advisor will reply within 4 hours.`);
    c.promises.push({ id: rid('P-'), type: 'first_response', text: 'First advisor reply', createdAt: t, dueAt: t + 4 * D.HOUR });
    if (issueType === 'safety' && answers.urgent === 'Yes') {
      c.priority = 'urgent';
      say(c, 'system', 'If anyone is seriously unwell, call emergency services now (999 in the UK, 911 in the US). A safety specialist has been alerted.');
    }
    c.themes = D.deriveThemes(c, t);
    db.cases.push(c);
    detectSignals(t);
    changed('case');
    return full(c);
  });

  on('GET', '/api/cases', q => {
    let list = db.cases.map(summary);
    const f = q.get('filter');
    if (f === 'overdue') list = list.filter(c => c.overdue);
    else if (f === 'open') list = list.filter(c => !['resolved', 'closed'].includes(c.status));
    else if (f === 'awaiting') list = list.filter(c => c.status === 'awaiting_consumer');
    else if (f === 'done') list = list.filter(c => ['resolved', 'closed'].includes(c.status));
    const rank = c => (['resolved', 'closed'].includes(c.status) ? 3 : c.overdue ? 0 : c.status === 'awaiting_consumer' ? 2 : 1);
    list.sort((a, b) => rank(a) - rank(b) || (a.nextDue ?? Infinity) - (b.nextDue ?? Infinity) || b.updatedAt - a.updatedAt);
    return { now: now(), cases: list };
  });

  on('GET', '/api/cases/:id', (q, b, p) => full(must(p.id)));

  on('POST', '/api/cases/:id/messages', (q, b, p) => {
    const c = must(p.id), text = String(b.text || '').trim().slice(0, 2000);
    if (!text) throw httpErr(400, 'Write a message first');
    const from = b.from === 'consumer' ? 'consumer' : 'advisor';
    say(c, from, text);
    if (from === 'advisor') {
      const fr = c.promises.find(x => x.type === 'first_response' && !x.doneAt);
      if (fr) fr.doneAt = now();
      if (b.ask) { c.status = 'awaiting_consumer'; c.awaitingSince = now(); c.asks = (c.asks || 0) + 1; c.nudgedAt = null; }
      else if (c.status === 'new') c.status = 'in_progress';
    } else {
      if (['awaiting_consumer', 'new'].includes(c.status)) c.status = 'in_progress';
      if (c.status === 'resolved' && !c.rating) { c.status = 'in_progress'; c.reopened = (c.reopened || 0) + 1; say(c, 'engine', 'Consumer replied after resolution: case reopened.'); }
      Object.assign(c.answers, D.prefill(text));
    }
    changed('message');
    return full(c);
  });

  on('POST', '/api/cases/:id/promises', (q, b, p) => {
    const c = must(p.id), hours = Math.max(1, Math.min(240, +b.hours || 24));
    const pr = { id: rid('P-'), type: b.type || 'custom', text: String(b.text || 'Follow up').slice(0, 120), createdAt: now(), dueAt: now() + hours * D.HOUR };
    c.promises.push(pr);
    const fr = c.promises.find(x => x.type === 'first_response' && !x.doneAt); if (fr) fr.doneAt = now();
    if (c.status === 'new') c.status = 'in_progress';
    say(c, 'advisor', b.message || `I have arranged this for you: ${pr.text.toLowerCase()}. You will hear from us by ${new Date(pr.dueAt).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}.`);
    say(c, 'engine', `Promise tracked: “${pr.text}”, due in ${hours}h.`);
    changed('promise');
    return full(c);
  });

  on('POST', '/api/cases/:id/promises/:pid/done', (q, b, p) => {
    const c = must(p.id), pr = c.promises.find(x => x.id === p.pid);
    if (!pr) throw httpErr(404, 'Promise not found');
    if (!pr.doneAt) {
      pr.doneAt = now();
      say(c, 'system', `Done: ${pr.text.toLowerCase()}.${pr.overdueAt ? ' Sorry it took longer than we said.' : ''}`);
      say(c, 'engine', `Promise kept${pr.doneAt > pr.dueAt ? ' late' : ' on time'}: “${pr.text}”.`);
    }
    changed('promise');
    return full(c);
  });

  on('POST', '/api/cases/:id/resolve', (q, b, p) => {
    const c = must(p.id);
    if (c.promises.some(x => !x.doneAt && x.type !== 'first_response')) throw httpErr(409, 'Finish the open promises before resolving');
    c.promises.filter(x => !x.doneAt).forEach(x => { x.doneAt = now(); });
    c.status = 'resolved'; c.resolvedAt = now();
    say(c, 'advisor', b.message || 'I have marked this as resolved. If anything else comes up, just reply here and your history comes with you.');
    changed('resolve');
    return full(c);
  });

  on('POST', '/api/cases/:id/route', (q, b, p) => {
    const c = must(p.id), owner = b.owner || D.ISSUES[c.issueType].owner;
    c.routedTo.push({ owner, reason: String(b.reason || 'Routed by advisor').slice(0, 200), at: now() });
    say(c, 'engine', `Routed to ${owner}.`);
    changed('route');
    return full(c);
  });

  on('POST', '/api/cases/:id/rate', (q, b, p) => {
    const c = must(p.id), r = Math.round(+b.rating);
    if (!(r >= 1 && r <= 5)) throw httpErr(400, 'Rating must be 1 to 5');
    c.rating = r; c.ratingComment = String(b.comment || '').slice(0, 500);
    say(c, 'consumer', `Rated ${r}/5${c.ratingComment ? `: ${c.ratingComment}` : ''}`);
    if (r <= 2) say(c, 'engine', 'Low rating: queued for review with the full case history.');
    changed('rate');
    return full(c);
  });

  on('POST', '/api/cases/:id/draft', async (q, b, p) => {
    const c = must(p.id), cp = D.copilot(c, now());
    if (draft) { try { const r = await draft(c, cp, now()); if (r) return r; } catch {} }
    return { text: cp.draft, source: 'Template, based on the case record' };
  });

  on('GET', '/api/insights', () => insights());

  on('POST', '/api/clock/advance', (q, b) => {
    const h = Math.max(-1000, Math.min(240, +b.hours || 0));
    db.clockOffset = (db.clockOffset || 0) + h * D.HOUR;
    tick(); changed('clock');
    return { now: now(), clockOffset: db.clockOffset };
  });

  on('POST', '/api/reset', () => { db = S.seed(Date.now()); tick(); changed('reset'); return { ok: true }; });

  function fakeOrder(no, c, t) {
    return { number: no, placed: t - 6 * D.DAY, items: [`${c.brand} ${c.product}`], total: c.country === 'UK' ? '£24.99' : '$29.99', status: 'Delivered', deliveredAt: t - 2 * D.DAY, carrier: c.country === 'UK' ? 'Royal Mail' : 'UPS' };
  }

  // Returns { status, body } for a request, whatever the transport.
  async function handle(method, pathname, query, body) {
    const r = routes.find(x => x.method === method && x.re.test(pathname));
    if (!r) return { status: 404, body: { error: 'Not found' } };
    try {
      const groups = pathname.match(r.re).groups || {};
      const params = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, decodeURIComponent(v)]));
      return { status: 200, body: await r.fn(query || new URLSearchParams(), body || {}, params) };
    } catch (e) { return { status: e.code && e.code < 600 ? e.code : 500, body: { error: e.message } }; }
  }

  save(db);
  tick();
  return { handle, tick, now, getDb: () => db, findCase };
}

return { createCore };
});

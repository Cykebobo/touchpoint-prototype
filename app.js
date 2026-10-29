// Touchpoint front end: hash router, three views, live updates over SSE.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
let META = null, NOW = Date.now(), view = null;

// Two modes: with the Node server (shared data, local AI) or standalone in the browser
// (static hosting; each visitor gets their own copy of the demo in localStorage).
let local = null;
const STORE_KEY = 'tp-db-v1';
const onLocalChange = () => { clearTimeout(liveT); liveT = setTimeout(async () => { await refreshClock(); if (view?.live) view.live(); }, 250); };
function startLocal() {
  local = TPCore.createCore({
    load: () => { try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; } },
    save: db => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
      catch { // storage full: drop older photos and retry once
        db.cases.slice(0, -3).forEach(c => { if (c.evidence) c.evidence.photo = null; });
        try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch {}
      }
    },
    onChange: onLocalChange,
  });
  setInterval(local.tick, 5000);
  const tag = $('#modeTag'); tag.hidden = false; tag.textContent = 'Demo data saved in this browser';
}
async function detectMode() {
  if (/\.github\.io$/.test(location.hostname) || location.protocol === 'file:') return startLocal();
  try {
    const r = await fetch('/api/meta', { cache: 'no-store' });
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) return;
  } catch {}
  startLocal();
}
async function api(path, body) {
  if (local) {
    const u = new URL(path, 'http://x');
    const r = await local.handle(body === undefined ? 'GET' : 'POST', u.pathname, u.searchParams, body === undefined ? {} : JSON.parse(JSON.stringify(body)));
    if (r.status !== 200) throw new Error(r.body.error || `Request failed (${r.status})`);
    return JSON.parse(JSON.stringify(r.body));
  }
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600); }
const H = 3600e3;
function fmtTime(ms) { return new Date(ms).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
function fmtDur(ms) {
  const a = Math.abs(ms), m = Math.round(a / 60e3);
  if (m < 60) return `${Math.max(1, m)}m`;
  const h = Math.round(a / H);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}
function rel(ms) { const d = ms - NOW; return d >= 0 ? `in ${fmtDur(d)}` : `${fmtDur(d)} ago`; }
const STATUS = { new: ['New', ''], in_progress: ['In progress', ''], awaiting_consumer: ['Waiting for consumer', 'grey'], resolved: ['Resolved', 'ok'], closed: ['Closed, no reply', 'grey'] };
const statusChip = s => `<span class="chip ${STATUS[s]?.[1] || ''}">${STATUS[s]?.[0] || s}</span>`;
const myCases = () => { try { return JSON.parse(localStorage.getItem('tp-mine') || '[]'); } catch { return []; } };
const addMine = idv => { try { localStorage.setItem('tp-mine', JSON.stringify([idv, ...myCases().filter(x => x !== idv)].slice(0, 6))); } catch {} };

// ---------- clock ----------
async function refreshClock() { const m = await api('/api/meta'); META = m; NOW = m.now; $('#clockText').textContent = fmtTime(NOW) + (m.clockOffset ? '  (demo time)' : ''); }
$$('[data-adv]').forEach(b => b.onclick = async () => { await api('/api/clock/advance', { hours: +b.dataset.adv }); await refreshClock(); toast(`Moved time forward ${b.dataset.adv === '24' ? '1 day' : b.dataset.adv + ' hours'}`); render(); });
$('#resetBtn').onclick = async () => { if (!confirm('Restore the demo data? Cases you created will be removed.')) return; await api('/api/reset', {}); await refreshClock(); toast('Demo data restored'); render(); };

// ---------- router ----------
function route() { const [, name = '', a = '', b = ''] = (location.hash || '#/').split('/'); return { name, a, b }; }
async function render() {
  const r = route();
  $$('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === (r.name === 'track' ? 'help' : r.name)));
  try {
    if (r.name === 'help') view = viewHelp();
    else if (r.name === 'track') view = await viewTrack(r.a);
    else if (r.name === 'desk') view = await viewDesk(r.a);
    else if (r.name === 'insights') view = await viewInsights();
    else view = viewHome();
  } catch (e) { app.innerHTML = `<div class="empty"><div><h2>Something went wrong</h2><p>${esc(e.message)}</p></div></div>`; }
}
addEventListener('hashchange', () => { render(); app.focus({ preventScroll: true }); });

// live: re-render read-only views when the server reports a change
let liveT;
function startLive() {
  if (local) return;
  try { const es = new EventSource('/api/events'); es.onmessage = onLocalChange; } catch {}
}

// ---------- home ----------
function viewHome() {
  app.innerHTML = `<div class="home">
    <h1>Every contact ends in a resolved case, not a lost one.</h1>
    <p class="lede">Touchpoint layers four capabilities on P&amp;G's existing support channels: guided capture, one shared case record, a follow-up engine that tracks every promise, and live learning that routes patterns to the teams who can fix them.</p>
    <div class="loop">
      <a href="#/help"><h2>Get help</h2><p>The consumer side. Report a problem once, with photo and batch code captured up front.</p><span class="go">Report a problem</span></a>
      <a href="#/desk"><h2>Advisor desk</h2><p>One case record with the full chat, evidence and, with consent, the online order. A copilot suggests the next step.</p><span class="go">Open the queue</span></a>
      <a href="#/insights"><h2>Insights</h2><p>Live themes, promises kept, and product signals routed automatically when the same fault repeats.</p><span class="go">See what is happening</span></a>
    </div>
    <div class="how">
      <div><b>Capture</b><p>Questions depend on the issue. Details already in the message are never asked again.</p></div>
      <div><b>Carry context</b><p>Chatbot to advisor handoff keeps the whole history in the case record.</p></div>
      <div><b>Keep promises</b><p>Every promise gets a due time. Late ones jump the queue and the consumer is told.</p></div>
      <div><b>Learn</b><p>Three similar faults in seven days become a product signal for the owning team.</p></div>
    </div>
    <p class="muted small" style="margin-top:36px">Try it: report a fault on the Get help page, open it on the Advisor desk, then use <b>+1 day</b> in the top bar to watch the follow-up engine act.</p>
  </div>`;
  return null;
}

// ---------- consumer: get help ----------
const MIN_TEXT = 4;
function viewHelp() {
  const st = { country: 'UK', brand: '', product: '', text: '', issueType: null, detected: null, prefill: {}, answers: {}, photo: null, barcode: null, name: '', email: '', override: false };
  const mine = myCases();
  app.innerHTML = `<div class="flow">
    <div class="intro"><h1>Tell us once. We will take it from there.</h1><p>Most problems are sorted in one conversation when we have the right details up front.</p></div>
    <div class="step" id="s1"><h2><i>1</i>Which product?</h2>
      <label class="f"><span>Where do you live?</span><div class="seg" id="country"><button class="on" data-v="UK">United Kingdom</button><button data-v="US">United States</button></div></label>
      <label class="f"><span>Brand</span><select id="brand"></select></label>
      <label class="f" style="margin:0"><span>Product</span><select id="product"></select></label>
    </div>
    <div class="step dim" id="s2"><h2><i>2</i>What happened?</h2>
      <label class="f" style="margin:0"><span class="sr" style="display:none">Description</span><textarea id="text" placeholder="For example: the charger stopped working after two weeks. Batch 2304A1." maxlength="2000"></textarea></label>
      <div class="detect" id="detect"></div>
    </div>
    <div class="step dim" id="s3"><h2><i>3</i>A few details, asked once</h2><div id="qs"></div></div>
    <div class="step dim" id="s4"><h2><i>4</i>How can we reach you?</h2>
      <label class="f"><span>Your name</span><input type="text" id="name" autocomplete="name" maxlength="60"></label>
      <label class="f"><span>Email</span><input type="email" id="email" autocomplete="email" maxlength="80"><small>Updates also appear on your case page, so you can follow along without an account.</small></label>
      <button class="btn" id="submit" disabled>Send to an advisor</button>
      <p class="small muted" id="why" style="margin-top:8px"></p>
    </div>
    ${mine.length ? `<div class="mine"><h3>Your recent cases</h3>${mine.map(m => `<a href="#/track/${esc(m)}"><span>${esc(m)}</span><span class="link">View</span></a>`).join('')}</div>` : ''}
  </div>`;

  const brandSel = $('#brand'), prodSel = $('#product');
  function fillBrands() {
    const list = META.catalogue.filter(c => c.markets.includes(st.country));
    brandSel.innerHTML = '<option value="">Choose a brand</option>' + list.map(c => `<option ${c.brand === st.brand ? 'selected' : ''}>${esc(c.brand)}</option>`).join('');
    if (!list.some(c => c.brand === st.brand)) { st.brand = ''; st.product = ''; }
    fillProducts();
  }
  function fillProducts() {
    const c = META.catalogue.find(x => x.brand === st.brand);
    prodSel.innerHTML = c ? '<option value="">Choose a product</option>' + c.products.map(p => `<option ${p === st.product ? 'selected' : ''}>${esc(p)}</option>`).join('') : '<option value="">Choose a brand first</option>';
    prodSel.disabled = !c; gate();
  }
  $$('#country button').forEach(b => b.onclick = e => { e.preventDefault(); st.country = b.dataset.v; $$('#country button').forEach(x => x.classList.toggle('on', x === b)); fillBrands(); });
  brandSel.onchange = () => { st.brand = brandSel.value; st.product = ''; fillProducts(); };
  prodSel.onchange = () => { st.product = prodSel.value; gate(); };

  let ct;
  $('#text').oninput = e => { st.text = e.target.value; clearTimeout(ct); ct = setTimeout(classify, st.text.trim().length < MIN_TEXT ? 0 : 350); gate(); };
  async function classify() {
    const n = st.text.trim().length;
    if (n < MIN_TEXT) {
      $('#detect').innerHTML = n ? `<span class="hint">Keep going: a few words about the problem (${MIN_TEXT - n} more character${MIN_TEXT - n === 1 ? '' : 's'}) and we will show the next questions.</span>` : '';
      st.issueType = null; drawQs(); gate(); return;
    }
    const r = await api('/api/classify', { text: st.text, issueType: st.override ? st.issueType : undefined });
    st.issueType = r.issueType; st.prefill = r.prefill;
    $('#detect').innerHTML = `We will treat this as <select id="itype" aria-label="Issue type" style="width:auto;padding:4px 8px">${Object.entries(META.issues).map(([k, v]) => `<option value="${k}" ${k === st.issueType ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>`;
    $('#itype').onchange = ev => { st.issueType = ev.target.value; st.override = true; drawQs(); gate(); };
    drawQs(); gate();
  }
  function drawQs() {
    const box = $('#qs');
    if (!st.issueType) { box.innerHTML = '<p class="muted">Describe the problem first and we will ask only what we need.</p>'; return; }
    const qs = META.issues[st.issueType].questions;
    const got = qs.filter(q => st.prefill[q.key]);
    let h = got.map(q => `<div class="got">✓ <span>Got it from your message: ${esc(q.label.toLowerCase())} <b>${esc(st.prefill[q.key])}</b></span></div>`).join('');
    for (const q of qs) {
      if (st.prefill[q.key]) continue;
      const v = st.answers[q.key] || '';
      if (q.type === 'text') h += `<label class="f"><span>${esc(q.label)}${q.required ? '' : ' <span class="muted">(optional)</span>'}</span><input type="text" data-q="${q.key}" value="${esc(v)}" maxlength="120">${q.hint ? `<small>${esc(q.hint)}</small>` : ''}</label>`;
      else if (q.type === 'choice') h += `<label class="f"><span>${esc(q.label)}</span><div class="seg" data-qc="${q.key}">${q.options.map(o => `<button data-v="${esc(o)}" class="${v === o ? 'on' : ''}">${esc(o)}</button>`).join('')}</div></label>`;
      else if (q.type === 'photo') h += `<label class="f"><span>${esc(q.label)} <span class="muted">(optional)</span></span><div class="photo">${st.photo ? `<img src="${esc(st.photo)}" alt="Your photo">` : ''}<div class="drop" id="drop" tabindex="0" role="button">${st.photo ? 'Replace photo' : 'Add a photo'}</div><input type="file" id="file" accept="image/*" capture="environment" hidden></div>${st.barcode ? `<small>Barcode read from photo: ${esc(st.barcode)}</small>` : q.hint ? `<small>${esc(q.hint)}</small>` : ''}</label>`;
      else if (q.type === 'consent') h += `<label class="consent"><input type="checkbox" data-consent="${q.key}" ${v === 'Yes' ? 'checked' : ''}><span><b>Share this order with the advisor.</b> They will see the items, delivery status and total, so you will not have to explain it again. You can say no and still get help.</span></label>`;
    }
    if (st.issueType === 'safety' && st.answers.urgent === 'Yes') h = `<div class="got" style="background:var(--late-wash);color:var(--late)">If anyone is seriously unwell, call 999 in the UK or 911 in the US now. Then send this and a safety specialist will call you.</div>` + h;
    if (!qs.length) h = '<p class="muted">Nothing else needed. Go to the last step.</p>';
    box.innerHTML = h;
    $$('[data-q]', box).forEach(i => i.oninput = () => { st.answers[i.dataset.q] = i.value.trim(); gate(); });
    $$('[data-qc]', box).forEach(g => $$('button', g).forEach(b => b.onclick = e => { e.preventDefault(); st.answers[g.dataset.qc] = b.dataset.v; drawQs(); gate(); }));
    $$('[data-consent]', box).forEach(c => c.onchange = () => { st.answers[c.dataset.consent] = c.checked ? 'Yes' : 'No'; });
    const drop = $('#drop'), file = $('#file');
    if (drop) { drop.onclick = () => file.click(); drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } }; file.onchange = () => loadPhoto(file.files[0]); }
  }
  async function loadPhoto(f) {
    if (!f) return;
    const img = await createImageBitmap(f).catch(() => null);
    if (!img) { toast('That file is not an image we can read'); return; }
    const k = Math.min(1, 900 / Math.max(img.width, img.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    st.photo = cv.toDataURL('image/jpeg', 0.8);
    if ('BarcodeDetector' in window) { try { const codes = await new BarcodeDetector().detect(cv); if (codes[0]) st.barcode = codes[0].rawValue; } catch {} }
    drawQs(); gate();
  }
  $('#name').oninput = e => { st.name = e.target.value.trim(); gate(); };
  $('#email').oninput = e => { st.email = e.target.value.trim(); gate(); };

  function missing() {
    if (!st.brand || !st.product) return 'Choose the brand and product.';
    if (st.text.trim().length < MIN_TEXT) return 'Describe the problem in step 2 first.';
    const req = (META.issues[st.issueType]?.questions || []).filter(q => q.required && !st.prefill[q.key] && !st.answers[q.key]);
    if (req.length) return `Still needed: ${req.map(q => q.label.toLowerCase()).join(', ')}.`;
    if (!st.name) return 'Add your name.';
    return '';
  }
  function gate() {
    $('#s2').classList.toggle('dim', !(st.brand && st.product));
    $('#s3').classList.toggle('dim', !(st.brand && st.product && st.issueType));
    $('#s4').classList.toggle('dim', !(st.brand && st.product && st.issueType));
    const m = missing(); $('#submit').disabled = !!m; $('#why').textContent = m;
  }
  $('#submit').onclick = async () => {
    $('#submit').disabled = true;
    try {
      const c = await api('/api/cases', { country: st.country, brand: st.brand, product: st.product, description: st.text, issueType: st.issueType, answers: { ...st.prefill, ...st.answers }, photo: st.photo, barcode: st.barcode, consumer: { name: st.name, email: st.email }, channel: 'guided' });
      addMine(c.id);
      const pr = c.promises.find(p => !p.doneAt);
      app.innerHTML = `<div class="flow"><div class="step done">
        <p class="slate">Your case number</p><div class="id">${esc(c.id)}</div>
        <p>Thanks, ${esc(c.consumer.name.split(' ')[0])}. Logged as <b>${esc(c.issueLabel)}</b>${c.copilot.provided.length ? `, with ${c.copilot.provided.length} detail${c.copilot.provided.length > 1 ? 's' : ''} already captured` : ''}.</p>
        <ol class="next">
          <li><b>An advisor replies by ${esc(fmtTime(pr.dueAt))}.</b><br><span class="slate small">They will see everything you sent, so you will not need to repeat it.</span></li>
          <li><b>Every promise gets a due time.</b><br><span class="slate small">If we run late, you hear from us before you need to chase.</span></li>
          <li><b>Reply on your case page any time.</b><br><span class="slate small">Your history stays with the case.</span></li>
        </ol>
        <a class="btn" href="#/track/${esc(c.id)}" style="text-decoration:none;display:inline-block">Follow this case</a>
        <a class="ghost" href="#/desk/${esc(c.id)}" style="text-decoration:none;display:inline-block;margin-left:8px">See it on the advisor desk</a>
      </div></div>`;
    } catch (e) { toast(e.message); $('#submit').disabled = false; }
  };
  fillBrands(); drawQs(); gate();
  return null;
}

// ---------- consumer: track ----------
function promiseLine(p, { action } = {}) {
  const span = p.dueAt - p.createdAt, end = p.doneAt || NOW;
  const pct = Math.max(3, Math.min(100, (end - p.createdAt) / span * 100));
  const late = !p.doneAt && p.dueAt < NOW;
  const cls = p.doneAt ? (p.doneAt <= p.dueAt ? 'kept' : 'lkept') : late ? 'late' : '';
  const when = p.doneAt ? (p.doneAt <= p.dueAt ? `Kept, ${fmtDur(p.dueAt - p.doneAt)} early` : `Kept ${fmtDur(p.doneAt - p.dueAt)} late`) : late ? `Overdue ${fmtDur(NOW - p.dueAt)}` : `Due ${rel(p.dueAt)}`;
  return `<div class="pl ${cls}"><span class="name">${esc(p.text)}</span>${action && !p.doneAt ? `<button class="ghost sm" data-done="${esc(p.id)}">Mark done</button>` : `<span class="when">${when}</span>`}<div class="rail" role="img" aria-label="${esc(p.text)}: ${when}"><i style="width:${pct}%"></i></div>${action && !p.doneAt ? `<span class="when" style="grid-column:1/-1;text-align:left">${when}</span>` : ''}</div>`;
}
const CONSUMER_SEES = ['consumer', 'advisor', 'bot', 'system'];
const label = { consumer: 'You', advisor: 'Advisor', bot: 'Assistant', system: 'Touchpoint' };

async function viewTrack(cid) {
  const c = await api(`/api/cases/${encodeURIComponent(cid)}`);
  const promises = c.promises;
  const needsRating = c.status === 'resolved' && !c.rating;
  app.innerHTML = `<div class="flow track">
    <div class="intro"><p class="slate small"><a href="#/help">Get help</a> / Case ${esc(c.id)}</p><h1>${esc(c.brand)} ${esc(c.product)}</h1><p>${statusChip(c.status)} <span class="slate small" style="margin-left:6px">${esc(c.issueLabel)}, opened ${esc(fmtTime(c.createdAt))}</span></p></div>
    <div class="step"><h2>What we have promised</h2><div class="promises">${promises.map(p => promiseLine(p)).join('') || '<p class="muted">Nothing yet.</p>'}</div></div>
    ${needsRating ? `<div class="step"><h2>How did we do?</h2><div class="stars">${[1, 2, 3, 4, 5].map(n => `<button data-r="${n}" aria-label="${n} out of 5">${n}</button>`).join('')}</div><input type="text" id="rc" placeholder="Anything we should know? (optional)" maxlength="300"></div>` : ''}
    <div class="step"><h2>Conversation</h2><div class="convo">${c.transcript.filter(m => CONSUMER_SEES.includes(m.from)).map(m => `<div class="msg ${m.from}"><span class="meta">${label[m.from]}, ${esc(fmtTime(m.at))}</span>${esc(m.text)}</div>`).join('')}</div>
      ${c.status !== 'closed' ? `<div class="composer"><textarea id="reply" placeholder="Reply to the advisor" maxlength="2000"></textarea><button class="btn" id="send">Send</button></div>` : '<p class="muted small" style="margin-top:12px">This case was closed. Start a new one any time from Get help.</p>'}
    </div>
  </div>`;
  const send = $('#send');
  if (send) send.onclick = async () => { const t = $('#reply').value.trim(); if (!t) return; send.disabled = true; try { await api(`/api/cases/${c.id}/messages`, { from: 'consumer', text: t }); toast('Sent'); render(); } catch (e) { toast(e.message); send.disabled = false; } };
  $$('[data-r]').forEach(b => b.onclick = async () => { await api(`/api/cases/${c.id}/rate`, { rating: +b.dataset.r, comment: $('#rc').value }); toast('Thanks for rating'); render(); });
  return { live: () => { if (!document.activeElement?.matches('textarea,input')) render(); } };
}

// ---------- advisor desk ----------
let deskFilter = 'open';
async function viewDesk(cid) {
  const [q, c] = await Promise.all([api(`/api/cases?filter=${deskFilter}`), cid ? api(`/api/cases/${encodeURIComponent(cid)}`) : null]);
  const counts = await api('/api/cases?filter=overdue');
  app.innerHTML = `<div class="desk ${c ? 'has-case' : ''}">
    <aside class="queue"><div class="filters">${[['open', 'Open'], ['overdue', `Overdue ${counts.cases.length ? `(${counts.cases.length})` : ''}`], ['awaiting', 'Waiting'], ['done', 'Done'], ['all', 'All']].map(([k, l]) => `<button data-f="${k}" class="${deskFilter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="list">${q.cases.map(x => queueItem(x, cid)).join('') || '<p class="empty">No cases here.</p>'}</div></aside>
    <div class="case">${c ? caseView(c) : '<div class="empty" style="grid-column:1/-1"><div><h2>Pick a case</h2><p>Overdue promises sit at the top of the queue.</p></div></div>'}</div>
  </div>`;
  $$('[data-f]').forEach(b => b.onclick = () => { deskFilter = b.dataset.f; render(); });
  if (c) wireCase(c);
  return { live: () => { if (!document.activeElement?.matches('textarea,input')) render(); } };
}
function queueItem(x, cid) {
  const due = ['resolved', 'closed'].includes(x.status) ? (x.rating ? `Rated ${x.rating}/5` : STATUS[x.status][0]) : x.overdue ? `Overdue` : x.nextDue ? `Due ${rel(x.nextDue)}` : STATUS[x.status][0];
  return `<a class="qi ${x.id === cid ? 'on' : ''} ${x.overdue ? 'late' : ''}" href="#/desk/${esc(x.id)}">
    <div class="row"><span class="who">${esc(x.consumer)}</span><span class="due">${esc(due)}</span></div>
    <div class="what">${esc(x.brand)} ${esc(x.product)}, ${esc(x.issueLabel.toLowerCase())}</div>
    <div class="row"><span class="chips">${statusChip(x.status)}<span class="chip grey">${esc(x.channel)}</span><span class="chip grey">${esc(x.country)}</span></span></div>
  </a>`;
}
function caseView(c) {
  const issue = META.issues[c.issueType];
  const ans = issue.questions.filter(qq => c.answers[qq.key] && qq.type !== 'consent').map(qq => `<dt>${esc(qq.label.replace(/\?$/, ''))}</dt><dd>${esc(c.answers[qq.key])}</dd>`).join('');
  const cp = c.copilot;
  return `
  <section>
    <p class="small"><a href="#/desk">Queue</a></p>
    <div class="blk"><h3>Consumer</h3><dl class="kv"><dt>Name</dt><dd>${esc(c.consumer.name)}</dd><dt>Email</dt><dd>${esc(c.consumer.email || 'Not given')}</dd><dt>Market</dt><dd>${esc(c.country)}</dd><dt>Channel</dt><dd>${esc(c.channel)}</dd></dl></div>
    <div class="blk"><h3>Product</h3><dl class="kv"><dt>Brand</dt><dd>${esc(c.brand)}</dd><dt>Product</dt><dd>${esc(c.product)}</dd><dt>Issue</dt><dd>${esc(c.issueLabel)}</dd>${ans}${c.evidence.barcode ? `<dt>Barcode</dt><dd>${esc(c.evidence.barcode)}</dd>` : ''}</dl>
      ${c.evidence.photo ? `<div class="ev"><img src="${esc(c.evidence.photo)}" alt="Photo sent by the consumer"></div>` : ''}</div>
    <div class="blk"><h3>Online order</h3>${c.dtcOrder ? `<div class="card order"><div class="chip ok" style="margin-bottom:8px">Shared with consent</div><dl class="kv" style="margin:0"><dt>Order</dt><dd>${esc(c.dtcOrder.number)}</dd><dt>Items</dt><dd>${esc(c.dtcOrder.items.join(', '))}</dd><dt>Total</dt><dd>${esc(c.dtcOrder.total)}</dd><dt>Status</dt><dd>${esc(c.dtcOrder.status)}, ${esc(c.dtcOrder.carrier)}</dd></dl></div>` : `<p class="muted small">Not shared. ${c.issueType === 'order' ? 'Ask the consumer for consent to view it.' : 'Not needed for this issue.'}</p>`}</div>
    ${c.routedTo.length ? `<div class="blk"><h3>Routed to</h3>${c.routedTo.map(r => `<p class="small"><b>${esc(r.owner)}</b><br><span class="slate">${esc(r.reason)}</span></p>`).join('')}</div>` : ''}
  </section>
  <section class="mid">
    <header><div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline"><h2>${esc(c.id)}</h2>${statusChip(c.status)}</div><p class="slate small">Opened ${esc(fmtTime(c.createdAt))}${c.rating ? `, rated ${c.rating}/5` : ''}</p></header>
    <div class="convo" id="convo">${c.transcript.map(m => `<div class="msg ${m.from} ${m.from === 'engine' && /overdue|low rating/i.test(m.text) ? 'late' : ''}">${m.from === 'engine' ? '' : `<span class="meta">${m.from === 'consumer' ? esc(c.consumer.name.split(' ')[0]) : label[m.from]}, ${esc(fmtTime(m.at))}</span>`}${m.from === 'engine' ? `Follow-up engine: ${esc(m.text)}` : esc(m.text)}</div>`).join('')}</div>
    ${['resolved', 'closed'].includes(c.status) ? '' : `<div class="composer"><textarea id="msg" placeholder="Write a reply" maxlength="2000"></textarea><div style="display:flex;flex-direction:column;gap:6px"><button class="btn" id="sendA">Send</button><button class="ghost sm" id="askA" title="Send and wait for the consumer to reply">Send and wait</button></div></div>`}
  </section>
  <section class="copilot">
    <div class="blk"><h3>Copilot summary</h3><p class="sum">${esc(cp.summary)}</p>
      ${cp.provided.length ? `<p class="small slate" style="margin-bottom:6px">Do not ask again:</p><div class="chips" style="margin-bottom:10px">${cp.provided.map(p => `<span class="chip ok">✓ ${esc(p)}</span>`).join('')}</div>` : ''}
      ${cp.missing.length ? `<p class="small slate" style="margin-bottom:6px">Still missing:</p><div class="chips">${cp.missing.map(m => `<span class="chip late">${esc(m)}</span>`).join('')}</div>` : ''}
    </div>
    ${cp.actions.length ? `<div class="blk"><h3>Suggested next step</h3><div class="acts">${cp.actions.map((a, i) => `<button data-act="${i}" class="${a.kind === 'escalate' || a.kind === 'fulfil' ? 'warn' : ''}">${esc(a.label)}</button>`).join('')}</div></div>` : ''}
    ${['resolved', 'closed'].includes(c.status) ? '' : `<div class="blk"><h3>Draft reply</h3><textarea id="draft" style="min-height:120px">${esc(cp.draft)}</textarea><p class="draftsrc" id="draftsrc">Template, based on the case record</p><div style="display:flex;gap:6px"><button class="ghost sm" id="useDraft">Put in reply box</button>${local ? '' : '<button class="ghost sm" id="aiDraft">Rewrite with local AI</button>'}</div></div>`}
    <div class="blk"><h3>Promises</h3><div class="promises">${c.promises.map(p => promiseLine(p, { action: true })).join('')}</div>
      ${['resolved', 'closed'].includes(c.status) ? '' : `<div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap"><button class="ghost sm" id="newPromise">Add a promise</button><button class="ghost sm" id="routeBtn">Route to ${esc(issue.owner)}</button></div>`}
    </div>
  </section>`;
}
function wireCase(c) {
  const cv = $('#convo'); if (cv) cv.scrollTop = cv.scrollHeight;
  const post = async (path, body, ok) => { try { await api(path, body); if (ok) toast(ok); render(); } catch (e) { toast(e.message); } };
  const msg = $('#msg');
  if ($('#sendA')) $('#sendA').onclick = () => msg.value.trim() && post(`/api/cases/${c.id}/messages`, { from: 'advisor', text: msg.value.trim() }, 'Reply sent');
  if ($('#askA')) $('#askA').onclick = () => msg.value.trim() && post(`/api/cases/${c.id}/messages`, { from: 'advisor', text: msg.value.trim(), ask: true }, 'Sent. Waiting for the consumer');
  if ($('#useDraft')) $('#useDraft').onclick = () => { msg.value = $('#draft').value; msg.focus(); };
  if ($('#aiDraft')) $('#aiDraft').onclick = async () => {
    const b = $('#aiDraft'); b.disabled = true; b.textContent = 'Writing…';
    try { const r = await api(`/api/cases/${c.id}/draft`, {}); $('#draft').value = r.text; $('#draftsrc').textContent = r.source; } catch (e) { toast(e.message); }
    b.disabled = false; b.textContent = 'Rewrite with local AI';
  };
  $$('[data-done]').forEach(b => b.onclick = () => post(`/api/cases/${c.id}/promises/${b.dataset.done}/done`, {}, 'Promise marked done'));
  if ($('#newPromise')) $('#newPromise').onclick = () => {
    const text = prompt('What are you promising the consumer?', META.issues[c.issueType].promise.text); if (!text) return;
    const hours = +prompt('Due in how many hours?', META.issues[c.issueType].promise.hours); if (!hours) return;
    post(`/api/cases/${c.id}/promises`, { text, hours, type: 'custom' }, 'Promise tracked');
  };
  if ($('#routeBtn')) $('#routeBtn').onclick = () => post(`/api/cases/${c.id}/route`, { reason: 'Routed by advisor from the case record' }, 'Routed');
  $$('[data-act]').forEach(b => b.onclick = () => {
    const a = c.copilot.actions[+b.dataset.act];
    if (a.kind === 'promise') post(`/api/cases/${c.id}/promises`, { ...a.promise }, 'Promise tracked');
    else if (a.kind === 'fulfil') post(`/api/cases/${c.id}/promises/${a.promiseId}/done`, {}, 'Promise marked done');
    else if (a.kind === 'resolve') post(`/api/cases/${c.id}/resolve`, {}, 'Case resolved');
    else if (a.kind === 'escalate') post(`/api/cases/${c.id}/route`, { owner: 'Product safety', reason: 'Urgent safety escalation' }, 'Escalated to safety');
    else if (a.kind === 'ask') { msg.value = `Could you share the ${c.copilot.missing[0].toLowerCase()}? That is the last thing I need.`; msg.focus(); }
  });
}

// ---------- insights ----------
async function viewInsights() {
  const d = await api('/api/insights');
  const k = d.kpi, pct = v => v == null ? '–' : Math.round(v * 100) + '%';
  const maxT = Math.max(1, ...d.themes.map(t => t.n));
  const tone = key => ['followup_missed', 'repeat_info'].includes(key) ? 'late' : key === 'consumer_silent' ? 'amber' : key === 'positive' ? 'ok' : '';
  const uTotal = d.unresolved.consumer + d.unresolved.pg;
  const maxDay = Math.max(1, ...d.days.map(x => x.count));
  app.innerHTML = `<div class="ins">
    <header><div><h1>What is happening right now</h1><p class="slate">Updates live as cases move. Last 14 days unless stated.</p></div><span class="slate small">As of ${esc(fmtTime(d.now))}</span></header>
    <div class="kpis">
      <div class="kpi"><b>${k.open}</b><span>Open cases</span></div>
      <div class="kpi ${k.overdue ? 'late' : ''}"><b>${k.overdue}</b><span>Promises overdue now</span></div>
      <div class="kpi"><b>${pct(k.promisesKept)}</b><span>Promises kept on time</span></div>
      <div class="kpi"><b>${pct(k.fcr)}</b><span>Resolved without asking the consumer again</span></div>
      <div class="kpi"><b>${k.rating ? k.rating.toFixed(2) : '–'}</b><span>Average rating, ${k.ratedCount} rated</span></div>
      <div class="kpi"><b>${k.medianHours != null ? fmtDur(k.medianHours * H) : '–'}</b><span>Median time to resolve</span></div>
    </div>
    <div class="grid2">
      <div class="pane"><h2>Themes across cases</h2><p class="sub">Each case can carry several themes. Red marks a process failure P&amp;G controls.</p>
        <div class="bars">${d.themes.map(t => `<div class="b" title="${esc(t.label)}: ${t.n} cases"><span class="lab">${esc(t.label)}</span><div class="track2"><div class="fill ${tone(t.key)}" style="width:${t.n / maxT * 86}%"></div><span class="v" style="left:calc(${t.n / maxT * 86}% + 8px)">${t.n}</span></div></div>`).join('')}</div>
      </div>
      <div class="pane"><h2>Product signals</h2><p class="sub">Three or more similar fault or safety reports in seven days are routed to the owning team automatically.</p>
        ${d.signals.length ? d.signals.map(s => `<div class="sig"><div class="row"><b>${esc(s.brand)} ${esc(s.product)}</b><span class="chip late">${s.count} reports</span></div><p>${esc(META.issues[s.issueType].label)} in ${esc(s.markets.join(' and '))}. Routed to <b>${esc(s.owner)}</b> ${esc(rel(s.createdAt))}.</p><p>${s.caseIds.slice(0, 5).map(x => `<a href="#/desk/${esc(x)}">${esc(x)}</a>`).join(', ')}</p></div>`).join('') : '<p class="muted">No repeating faults right now.</p>'}
      </div>
    </div>
    <div class="grid2">
      <div class="pane"><h2>Why cases are still unresolved</h2><p class="sub">Separates what P&amp;G can fix from what depends on the consumer.</p>
        ${uTotal ? `<div class="split"><div style="flex:${d.unresolved.pg};background:var(--late)" title="P&G side: ${d.unresolved.pg}"></div><div style="flex:${d.unresolved.consumer};background:var(--amber)" title="Consumer side: ${d.unresolved.consumer}"></div></div>
        <div class="legend"><span style="--c:var(--late)">P&amp;G side, overdue promise: ${d.unresolved.pg}</span><span style="--c:var(--amber)">Consumer side, waiting or no reply: ${d.unresolved.consumer}</span></div>` : '<p class="muted">Nothing unresolved.</p>'}
        <h2 style="margin-top:24px">UK and US</h2>
        <div class="cmp">${['UK', 'US'].map(m => `<div><span class="slate small">${m}</span><b>${d.country[m].rating ? d.country[m].rating.toFixed(2) : '–'}</b><span class="slate small">average rating, ${d.country[m].cases} cases</span></div>`).join('')}</div>
      </div>
      <div class="pane"><h2>New cases per day</h2><p class="sub">Last 14 days.</p>
        <div class="days">${d.days.map(x => `<div style="height:${x.count / maxDay * 100}%" title="${esc(new Date(x.day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}: ${x.count}"></div>`).join('')}</div>
        <div class="daylabels"><span>${esc(new Date(d.days[0].day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</span><span>Today</span></div>
      </div>
    </div>
  </div>`;
  return { live: () => render() };
}

detectMode().then(() => { startLive(); return refreshClock(); }).then(render);

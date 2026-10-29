// Synthetic demo data. No real P&G data is used anywhere in this prototype.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./domain'));
  else root.TPSeed = factory(root.TPDomain);
})(typeof self !== 'undefined' ? self : this, function (D) {

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

const NAMES = ['Amelia Hughes', 'Oliver Patel', 'Isla Murphy', 'Noah Williams', 'Ava Thompson', 'Leo Chen', 'Grace Evans', 'Arthur Khan', 'Freya Wilson', 'Jack Robinson',
  'Sophia Martinez', 'Liam Johnson', 'Emma Davis', 'Mason Brown', 'Olivia Garcia', 'Ethan Miller', 'Mia Rodriguez', 'Lucas Anderson', 'Harper Lee', 'Elijah Moore',
  'Poppy Clarke', 'Theo Wright', 'Ruby Walker', 'Henry Scott', 'Chloe Adams', 'Daniel Kim'];

const TEXT = {
  defect: ['The {p} arrived with a cracked cap and leaked all over the cupboard.', 'My {p} stopped working after two weeks of normal use.', 'Opened the pack and the {p} is damaged inside.', 'The {p} is faulty, it was like this straight out of the box. Batch {b}.'],
  safety: ['My little one came up in a red rash after using {p}.', 'My skin started itching and burning after the {p}. Batch {b}.'],
  usage: ['How do I pair my {p} with the app? Bluetooth will not connect.', 'How much {p} should I use for a full load in hard water?', 'Which setting on the {p} is best for sensitive gums?'],
  order: ['My order {o} still has not been delivered and tracking has not moved for 5 days.', 'I was charged twice for order {o}.', 'I cancelled my subscription but was charged again, order {o}.'],
  offer: ['The coupon code from your email does not work at checkout.', 'I never received the rewards points for my {p} purchase.'],
  availability: ['I cannot find {p} in {s} any more. Is it discontinued?', 'Where can I buy {p}? It has been out of stock for weeks.'],
};
const ADVISOR = {
  defect: 'I am sorry about this. I can see the batch code and photo you sent, so there is nothing more you need to do.',
  safety: 'Thank you for telling us. Your safety comes first, so a specialist will call you.',
  usage: 'Happy to help. I will send you a short step-by-step video for your exact model.',
  order: 'I can see your order details, thank you for sharing them. Let me sort this out.',
  offer: 'Sorry the offer did not work. I will put this right for you.',
  availability: 'Thanks for checking with us. I will send you the nearest stockists.',
};
const COMMENT_GOOD = ['Quick and I did not have to repeat myself.', 'Really helpful, sorted in one go.', 'Friendly and kept me updated.', ''];
const COMMENT_BAD = ['Promised a call back that came late.', 'Took too long to hear back.', 'Had to chase twice.'];

function seed(realNow) {
  const r = rng(26650);
  const pick = a => a[Math.floor(r() * a.length)];
  const t0 = realNow, H = D.HOUR, DAY = D.DAY;
  const db = { version: 1, clockOffset: 0, cases: [], signals: [] };
  let n = 0;

  function make({ country, brand, product, issue, age, channel, outcome }) {
    const cat = D.CATALOGUE.find(x => x.brand === brand);
    const created = t0 - age;
    const batch = `${2300 + Math.floor(r() * 99)}${pick(['A', 'B', 'C', 'K'])}${Math.floor(r() * 9) + 1}`;
    const order = `PG-${100000 + Math.floor(r() * 899999)}`;
    const store = country === 'UK' ? pick(['Tesco', 'Boots', 'Sainsbury’s']) : pick(['Target', 'Walmart', 'CVS']);
    const desc = pick(TEXT[issue]).replace('{p}', product).replace('{b}', batch).replace('{o}', order).replace('{s}', store);
    const name = pick(NAMES);
    const c = {
      id: `TP-${(0x1A2B3 + n++ * 7919).toString(16).toUpperCase().slice(-6)}`, createdAt: created, updatedAt: created, status: 'new', channel, country,
      consumer: { name, email: name.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com' },
      brand, product, sector: cat.sector, issueType: issue, description: desc, answers: D.prefill(desc), evidence: { photo: null, barcode: null },
      transcript: [], promises: [], routedTo: [], themes: [], asks: 0,
    };
    const issueDef = D.ISSUES[issue];
    if (issue === 'defect') { c.answers.batch ||= batch; c.answers.still_have = 'Yes'; }
    if (issue === 'safety') { c.answers.batch ||= batch; c.answers.urgent = 'No'; c.answers.who = pick(['Me', 'A child']); }
    if (issue === 'order') { c.answers.order_no = order; if (r() < 0.7) { c.answers.consent_dtc = 'Yes'; c.dtcOrder = { number: order, placed: created - 6 * DAY, items: [`${brand} ${product}`], total: country === 'UK' ? '£24.99' : '$29.99', status: 'In transit', carrier: country === 'UK' ? 'Royal Mail' : 'UPS' }; } }
    const msg = (from, text, at) => { c.transcript.push({ from, text, at }); c.updatedAt = at; };
    msg('consumer', desc, created);
    if (channel === 'chatbot') {
      msg('bot', 'I can help with that. Let me check a few things first.', created + 60e3);
      msg('bot', 'I could not fix this here, so I am passing you to an advisor with this whole chat. You will not need to repeat anything.', created + 3 * 60e3);
    } else {
      msg('bot', `Thanks, ${name.split(' ')[0]}. I have logged this as “${issueDef.label}”. An advisor will reply within 4 hours.`, created + 30e3);
    }
    const fr = { id: `P-${n}F`, type: 'first_response', text: 'First advisor reply', createdAt: created, dueAt: created + 4 * H };
    c.promises.push(fr);
    if (outcome === 'new') { db.cases.push(c); return c; }

    const reply = created + (outcome === 'late' ? 2 : 1.2) * H;
    fr.doneAt = reply;
    msg('advisor', ADVISOR[issue], reply);
    c.status = 'in_progress';
    if (outcome === 'awaiting' || outcome === 'silent') {
      msg('advisor', `Could you share the ${issue === 'offer' ? 'offer code' : issue === 'availability' ? 'town or postcode' : 'batch code from the pack'}?`, reply + 60e3);
      c.status = 'awaiting_consumer'; c.awaitingSince = reply + 60e3; c.asks = 1;
      db.cases.push(c); return c;
    }
    const p = issueDef.promise;
    const pr = { id: `P-${n}A`, type: p.type, text: p.text, createdAt: reply + 2 * 60e3, dueAt: reply + 2 * 60e3 + p.hours * H };
    c.promises.push(pr);
    msg('advisor', `I have arranged this for you: ${p.text.toLowerCase()}, within ${p.hours} hours.`, pr.createdAt);
    msg('engine', `Promise tracked: “${p.text}”, due in ${p.hours}h.`, pr.createdAt);
    if (outcome === 'open') { db.cases.push(c); return c; }
    const late = outcome === 'late';
    pr.doneAt = late ? pr.dueAt + 20 * H : pr.createdAt + p.hours * 0.6 * H;
    if (late) {
      pr.overdueAt = pr.dueAt + 5 * 60e3;
      msg('engine', `Overdue: “${p.text}” passed its due time. Advisor alerted and case moved to the top of the queue.`, pr.overdueAt);
      msg('system', `We have not forgotten you. “${p.text}” is running late and an advisor is on it now.`, pr.overdueAt + 60e3);
    }
    msg('system', `Done: ${p.text.toLowerCase()}.${late ? ' Sorry it took longer than we said.' : ''}`, pr.doneAt);
    c.status = 'resolved'; c.resolvedAt = pr.doneAt + 10 * 60e3;
    msg('advisor', 'I have marked this as resolved. If anything else comes up, just reply here and your history comes with you.', c.resolvedAt);
    if (c.resolvedAt + 3 * H < t0 && r() < 0.85) {
      c.surveyAt = c.resolvedAt + 2 * H;
      msg('system', 'How did we do? Rate this conversation from 1 to 5.', c.surveyAt);
      c.rating = late ? pick([1, 2, 2, 3]) : pick([4, 5, 5, 5, 4, 3]);
      c.ratingComment = c.rating >= 4 ? pick(COMMENT_GOOD) : pick(COMMENT_BAD);
      msg('consumer', `Rated ${c.rating}/5${c.ratingComment ? `: ${c.ratingComment}` : ''}`, c.surveyAt + 40 * 60e3);
    }
    db.cases.push(c); return c;
  }

  // Two planted product patterns so the signal detector has something real to find.
  [5.5, 3.2, 1.6, 0.4].forEach((d, i) => make({ country: 'UK', brand: 'Oral-B', product: 'iO Charger', issue: 'defect', age: d * DAY, channel: pick(['guided', 'chatbot', 'phone']), outcome: ['done', 'late', 'open', 'new'][i] }));
  [4.8, 2.5, 0.9].forEach((d, i) => make({ country: i === 1 ? 'US' : 'UK', brand: 'Pampers', product: 'Sensitive Baby Wipes', issue: 'defect', age: d * DAY, channel: 'guided', outcome: ['done', 'done', 'open'][i] }));

  const issues = ['defect', 'defect', 'usage', 'usage', 'order', 'order', 'offer', 'availability', 'safety'];
  const outcomes = ['done', 'done', 'done', 'done', 'done', 'done', 'late', 'late', 'open', 'awaiting', 'silent', 'new'];
  for (let i = 0; i < 41; i++) {
    const country = r() < 0.45 ? 'UK' : 'US';
    const cat = pick(D.CATALOGUE.filter(x => x.markets.includes(country)));
    let issue = pick(issues);
    if (issue === 'order' && r() < 0.3) issue = 'usage';
    let outcome = pick(outcomes);
    let age = (0.2 + r() * 13.5) * DAY;
    if (outcome === 'silent') age = Math.max(age, 7 * DAY);
    if (outcome === 'new') age = (0.5 + r() * 6) * H;
    if (outcome === 'open') age = Math.min(age, 4 * DAY);
    if (outcome === 'done' && age < 4 * DAY) age += 4 * DAY;
    make({ country, brand: cat.brand, product: pick(cat.products), issue, age, channel: pick(['guided', 'chatbot', 'email', 'phone', 'chatbot']), outcome });
  }
  for (const c of db.cases) c.themes = D.deriveThemes(c, t0);
  return db;
}

return { seed };
});

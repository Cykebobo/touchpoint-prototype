// Touchpoint domain: catalogue, issue taxonomy, guided questions, theme rules, copilot.
// Everything here is synthetic and rule-based so the prototype runs offline.
// Shared by the Node server and the browser (standalone mode).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TPDomain = factory();
})(typeof self !== 'undefined' ? self : this, function () {

const HOUR = 3600e3, DAY = 24 * HOUR;

const CATALOGUE = [
  { brand: 'Pampers', sector: 'Baby, Feminine & Family Care', products: ['Baby Dry Nappies', 'Sensitive Baby Wipes', 'Premium Protection Pants'], markets: ['UK', 'US'] },
  { brand: 'Always', sector: 'Baby, Feminine & Family Care', products: ['Ultra Pads', 'Dailies Liners'], markets: ['UK', 'US'] },
  { brand: 'Bounty', sector: 'Baby, Feminine & Family Care', products: ['Select-A-Size Paper Towels'], markets: ['US'] },
  { brand: 'Charmin', sector: 'Baby, Feminine & Family Care', products: ['Ultra Soft Toilet Paper'], markets: ['US'] },
  { brand: 'Oral-B', sector: 'Health Care', products: ['iO Series 7 Toothbrush', 'Pro 3 Toothbrush', 'iO Charger'], markets: ['UK', 'US'] },
  { brand: 'Crest', sector: 'Health Care', products: ['3D White Toothpaste'], markets: ['US'] },
  { brand: 'Gillette', sector: 'Grooming', products: ['Fusion5 Razor', 'Labs Heated Razor', 'Venus Razor'], markets: ['UK', 'US'] },
  { brand: 'Head & Shoulders', sector: 'Beauty', products: ['Classic Clean Shampoo', 'Supreme Conditioner'], markets: ['UK', 'US'] },
  { brand: 'Olay', sector: 'Beauty', products: ['Regenerist Moisturiser', 'Retinol24 Night Cream'], markets: ['UK', 'US'] },
  { brand: 'Ariel', sector: 'Fabric & Home Care', products: ['All-in-1 Pods', 'Original Liquid'], markets: ['UK'] },
  { brand: 'Fairy', sector: 'Fabric & Home Care', products: ['Original Washing Up Liquid', 'Platinum Dishwasher Tabs'], markets: ['UK'] },
  { brand: 'Lenor', sector: 'Fabric & Home Care', products: ['Spring Awakening Fabric Conditioner'], markets: ['UK'] },
  { brand: 'Tide', sector: 'Fabric & Home Care', products: ['PODS', 'Original Liquid'], markets: ['US'] },
  { brand: 'Febreze', sector: 'Fabric & Home Care', products: ['Air Mist', 'Car Vent Clip'], markets: ['UK', 'US'] },
];

// Issue types: what the guided capture asks for, what the advisor usually promises,
// and who owns a recurring pattern.
const ISSUES = {
  defect: {
    label: 'Product faulty or damaged', owner: 'Product quality',
    keywords: ['leak', 'broke', 'broken', 'damaged', 'stopped working', 'stops working', 'not charging', "won't charge", 'faulty', 'cracked', 'torn', 'defect', 'missing', 'dead', 'battery'],
    questions: [
      { key: 'batch', label: 'Batch or lot code', hint: 'Usually printed near the barcode, for example 2304A1', type: 'text', required: true },
      { key: 'photo', label: 'Photo of the product and the problem', hint: 'Saves you sending it later', type: 'photo', required: false },
      { key: 'still_have', label: 'Do you still have the product?', type: 'choice', options: ['Yes', 'No'], required: true },
      { key: 'since', label: 'When did you notice it?', type: 'choice', options: ['On opening', 'Within a week', 'Later'], required: false },
    ],
    promise: { type: 'replacement', text: 'Send a replacement', hours: 72 },
  },
  safety: {
    label: 'Skin reaction or safety concern', owner: 'Product safety',
    keywords: ['rash', 'irritat', 'allerg', 'burn', 'itch', 'swallow', 'reaction', 'sore', 'red skin', 'hospital', 'doctor'],
    questions: [
      { key: 'urgent', label: 'Does anyone need medical help right now?', type: 'choice', options: ['No', 'Yes'], required: true },
      { key: 'who', label: 'Who was affected?', type: 'choice', options: ['Me', 'A child', 'Someone else'], required: true },
      { key: 'batch', label: 'Batch or lot code', hint: 'Helps safety teams trace the product', type: 'text', required: true },
      { key: 'photo', label: 'Photo of the product label', type: 'photo', required: false },
    ],
    promise: { type: 'callback', text: 'Safety specialist call back', hours: 24 },
  },
  usage: {
    label: 'How to use the product', owner: 'Content and guidance',
    keywords: ['how do i', 'how to', 'instructions', 'setting', 'mode', 'app', 'bluetooth', 'pair', 'not cleaning', "doesn't work well", 'which one', 'dose', 'how much'],
    questions: [
      { key: 'tried', label: 'What have you tried so far?', type: 'text', required: false },
      { key: 'model', label: 'Model or variant, if shown on the pack', type: 'text', required: false },
    ],
    promise: { type: 'guide', text: 'Send step-by-step video guide', hours: 4 },
  },
  order: {
    label: 'Online order, delivery or refund', owner: 'Direct-to-consumer operations',
    keywords: ['order', 'delivery', 'delivered', 'shipped', 'tracking', 'subscription', 'refund', 'charged', 'parcel', 'courier'],
    questions: [
      { key: 'order_no', label: 'Order number', hint: 'From your confirmation email, for example PG-104233', type: 'text', required: true },
      { key: 'consent_dtc', label: 'Let the advisor see this order so you do not have to explain it again?', type: 'consent', required: false },
    ],
    promise: { type: 'refund', text: 'Confirm refund or resend', hours: 48 },
  },
  offer: {
    label: 'Coupon, offer or rewards', owner: 'Brand marketing',
    keywords: ['coupon', 'voucher', 'promo', 'offer', 'rewards', 'points', 'cashback', 'discount'],
    questions: [
      { key: 'offer', label: 'Which offer or code?', type: 'text', required: true },
    ],
    promise: { type: 'voucher', text: 'Issue voucher', hours: 48 },
  },
  availability: {
    label: 'Cannot find or discontinued', owner: 'Brand and supply',
    keywords: ['can\'t find', 'cannot find', 'discontinued', 'out of stock', 'no longer', 'stopped selling', 'where to buy', 'available'],
    questions: [
      { key: 'area', label: 'Town or postcode area', type: 'text', required: false },
      { key: 'retailer', label: 'Where do you usually buy it?', type: 'text', required: false },
    ],
    promise: { type: 'info', text: 'Send stockist information', hours: 24 },
  },
  other: {
    label: 'Something else', owner: 'Consumer care',
    keywords: [],
    questions: [],
    promise: { type: 'callback', text: 'Advisor call back', hours: 24 },
  },
};

// Themes are tagged on the whole case (description + messages + engine events).
const THEMES = {
  defect: 'Product fault', safety: 'Safety concern', usage: 'Usage help', order: 'Order and delivery',
  offer: 'Offers and coupons', availability: 'Availability',
  followup_missed: 'Follow-up missed', repeat_info: 'Asked to repeat information',
  consumer_silent: 'Consumer did not return', positive: 'Positive experience',
};

const BATCH_RE = /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5,10}\b/;
const ORDER_RE = /\bPG-?\d{5,7}\b/i;

function classify(text) {
  const t = (text || '').toLowerCase();
  let best = 'other', score = 0;
  for (const [k, v] of Object.entries(ISSUES)) {
    const s = v.keywords.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
    if (s > score) { best = k; score = s; }
  }
  return best;
}

// Pull answers already present in the free text so the consumer is never asked twice.
function prefill(text) {
  const out = {};
  const b = (text || '').toUpperCase().match(BATCH_RE);
  if (b && !/^PG\d+$/.test(b[0])) out.batch = b[0];
  const o = (text || '').match(ORDER_RE);
  if (o) out.order_no = o[0].toUpperCase().replace(/^PG(\d)/, 'PG-$1');
  return out;
}

function missingInfo(c) {
  const qs = ISSUES[c.issueType]?.questions || [];
  return qs.filter(q => q.required && !c.answers?.[q.key]).map(q => q.label);
}

function caseText(c) {
  return [c.description, ...(c.transcript || []).filter(m => m.from === 'consumer').map(m => m.text)].join(' ');
}

function deriveThemes(c, now) {
  const th = new Set([c.issueType]);
  if ((c.promises || []).some(p => p.overdueAt)) th.add('followup_missed');
  if (c.closedReason === 'consumer_silent') th.add('consumer_silent');
  if (c.rating >= 4) th.add('positive');
  const t = caseText(c).toLowerCase().replace(/(did not|didn't|never|no need to|without having to) (have to |need to )?(repeat|explain)[^.!?]*/g, '');
  if (/(already (told|sent|gave|explained)|repeat (myself|everything)|third time|explain(ed)? (it |this )?again|asked (me )?again)/.test(t)) th.add('repeat_info');
  return [...th].filter(k => k !== 'other');
}

// Copilot: deterministic summary and next best action; the draft reply can be upgraded by a local LLM.
function copilot(c, now) {
  const issue = ISSUES[c.issueType] || ISSUES.other;
  const provided = (issue.questions || []).filter(q => c.answers?.[q.key] && q.type !== 'consent').map(q => q.label.replace(/\?$/, ''));
  if (c.evidence?.photo) provided.push('Photo');
  if (c.dtcOrder) provided.push('Online order (shared with consent)');
  const missing = missingInfo(c);
  const open = (c.promises || []).filter(p => !p.doneAt);
  const openWork = open.filter(p => p.type !== 'first_response');
  const overdue = open.filter(p => p.dueAt < now);
  const actions = [];
  if (c.issueType === 'safety' && c.answers?.urgent === 'Yes') actions.push({ kind: 'escalate', label: 'Escalate to safety team now' });
  if (overdue.length) actions.push({ kind: 'fulfil', label: `Fulfil overdue: ${overdue[0].text}`, promiseId: overdue[0].id });
  if (missing.length) actions.push({ kind: 'ask', label: `Ask for: ${missing[0]}` });
  const everPromised = (c.promises || []).some(p => p.type !== 'first_response');
  if (!everPromised && !['resolved', 'closed'].includes(c.status) && !missing.length) actions.push({ kind: 'promise', label: `${issue.promise.text} (due in ${issue.promise.hours}h)`, promise: issue.promise });
  if (!['resolved', 'closed'].includes(c.status) && !overdue.length && openWork.length === 0 && (c.promises || []).some(p => p.type !== 'first_response' && p.doneAt)) actions.push({ kind: 'resolve', label: 'Resolve case' });
  const parts = [];
  const via = { guided: 'the guided form', chatbot: 'the chatbot', email: 'email', phone: 'phone' }[c.channel] || c.channel;
  parts.push(`${c.consumer.name.split(' ')[0]} contacted us via ${via} about ${c.brand} ${c.product}: ${issue.label.toLowerCase()}.`);
  if (c.channel === 'chatbot') parts.push('Chatbot could not resolve it and handed over the full chat.');
  if (provided.length) parts.push(`Already provided: ${provided.join(', ')}.`);
  if (overdue.length) parts.push(`A promise is overdue (${overdue[0].text}).`);
  return { summary: parts.join(' '), provided, missing, actions, draft: templateDraft(c, issue, missing, overdue[0], everPromised && !openWork.length) };
}

function templateDraft(c, issue, missing, late, allDone) {
  const first = c.consumer.name.split(' ')[0];
  if (allDone) return `Hi ${first}, good news: everything we promised on this case is now done. I will close it for now, but if anything else comes up just reply here and your history comes with you.`;
  if (late) return `Hi ${first}, I am sorry: we said we would ${late.text.toLowerCase()} and we have not done it yet. I have taken this over personally and will confirm today when it is done. You do not need to do anything.`;
  const lines = [`Hi ${first}, thank you for telling us about your ${c.brand} ${c.product}.`];
  if (c.issueType === 'safety') lines.push('Your safety comes first. A specialist will call you within 24 hours, and if symptoms get worse please seek medical advice.');
  else if (missing.length) lines.push(`So we can sort this quickly, could you share the ${missing[0].toLowerCase()}?`);
  else lines.push(`I have everything I need, so you will not have to repeat anything. Next step: ${issue.promise.text.toLowerCase()}, within ${issue.promise.hours} hours.`);
  lines.push('I will check in with you if anything changes.');
  return lines.join(' ');
}

return { HOUR, DAY, CATALOGUE, ISSUES, THEMES, classify, prefill, missingInfo, deriveThemes, copilot };
});

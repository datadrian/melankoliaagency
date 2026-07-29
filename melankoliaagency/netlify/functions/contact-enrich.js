// Contact Enricher — hunts the web to fill MISSING fields on a booking contact.
// Deep mode: Gemini + Google Search grounding to find the website/linktree/socials,
// THEN fetches the linktree / link-in-bio / website page and scrapes emails + links.
// PURE LOOKUP: this function never writes. It returns a `patch` of ONLY the fields
// that are currently empty on the contact, so the panel can apply it through the
// existing contact-proposals `edit` action (review-queue flow, only-fill-empty).
const { getDoc, json } = require('./_firebase');
const { authorize } = require('./_auth');

const COLL = 'contact_discovery_proposals';
const GEMINI_KEY = process.env.GEMINI_API_KEY_V2 || process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_ENRICH_MODEL || 'gemini-3.1-flash-lite';
const ADMIN_PW = process.env.MELANKOLIA_ADMIN_PASSWORD || 'melankolia2025';
const AGENT_KEY = process.env.CONTACT_DISCOVERY_KEY || '';

const SOCIAL_FIELDS = ['website','instagram','facebook','twitter','tiktok','youtube','linkedin','soundcloud','spotify','bandcamp','telegram','whatsapp'];
const ALL_LOOKUP_FIELDS = [...SOCIAL_FIELDS,'email','phone','city','region','country','address','booking_method'];

const now = () => new Date().toISOString();
const clean = (s) => String(s == null ? '' : s).trim();
const isEmpty = (v) => v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0);

function withGuard(promise, ms = 22000) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('enrich timed out')), ms))]);
}
async function fetchText(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MelankoliaBot/1.0; +https://melankoliaagency.com)',
      'Accept': 'text/html,application/xhtml+xml,application/json',
    }});
    if (!r.ok) return '';
    return await r.text();
  } catch { return ''; } finally { clearTimeout(t); }
}

// domain -> platform mapping for scraped outbound links
function classifyLink(url) {
  const u = clean(url).toLowerCase();
  if (!u.startsWith('http')) return null;
  const map = [
    ['instagram', /instagram\.com/], ['facebook', /facebook\.com|fb\.com|fb\.me/],
    ['twitter', /twitter\.com|x\.com/], ['tiktok', /tiktok\.com/],
    ['youtube', /youtube\.com|youtu\.be/], ['linkedin', /linkedin\.com/],
    ['soundcloud', /soundcloud\.com/], ['spotify', /spotify\.com|open\.spotify/],
    ['bandcamp', /bandcamp\.com/], ['telegram', /t\.me|telegram\.me/],
    ['whatsapp', /wa\.me|whatsapp\.com|api\.whatsapp/],
  ];
  for (const [k, re] of map) if (re.test(u)) return { field: k, url };
  return { field: 'website', url };
}

// scrape a linktree / link-in-bio / website page for emails + links
function scrapePage(html) {
  const out = { emails: [], phones: [], links: [] };
  if (!html) return out;
  const nx = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nx) {
    try {
      const seen = new Set();
      const walk = (o) => {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) return o.forEach(walk);
        if (typeof o.url === 'string' && /^https?:/i.test(o.url) && !seen.has(o.url)) { seen.add(o.url); out.links.push(o.url); }
        Object.values(o).forEach(walk);
      };
      walk(JSON.parse(nx[1]));
    } catch {}
  }
  (html.match(/mailto:([^"'?&>\s]+)/gi) || []).forEach(m => out.emails.push(m.replace(/mailto:/i, '')));
  (html.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) || []).forEach(e => out.emails.push(e));
  (html.match(/tel:([+0-9()\-.\s]{6,})/gi) || []).forEach(m => out.phones.push(m.replace(/tel:/i, '').trim()));
  (html.match(/href=["']([^"']+)["']/gi) || []).forEach(h => { const u = h.replace(/^href=["']/i, '').replace(/["']$/, ''); if (/^https?:/i.test(u)) out.links.push(u); });
  const bad = /\.(png|jpe?g|gif|svg|webp)$|sentry|example\.com|@2x|wixpress|\.wix/i;
  out.emails = [...new Set(out.emails.map(e => e.toLowerCase()))].filter(e => !bad.test(e));
  out.phones = [...new Set(out.phones)];
  out.links = [...new Set(out.links)];
  return out;
}

async function geminiLookup(ident, missing) {
  if (!GEMINI_KEY) return { found: {}, sources: [] };
  const hints = [
    ident.name && `Name: ${ident.name}`,
    ident.city && `City: ${ident.city}`,
    ident.country && `Country: ${ident.country}`,
    ident.instagram && `Instagram: ${ident.instagram}`,
    ident.website && `Known website: ${ident.website}`,
    ident.type && `Type: ${ident.type}`,
  ].filter(Boolean).join('\n');
  const prompt = `You are a music-industry researcher. Find VERIFIED contact/booking details for this live-music promoter/venue/booker.
${hints}

Missing fields to hunt for: ${missing.join(', ')}, plus a Linktree / link-in-bio URL if one exists.
Follow the Instagram bio -> Linktree/link-in-bio -> booking email trail when possible.
Rules: Only return info you are confident is correct from real sources. Use an empty string for anything you cannot verify. NEVER invent emails, phones or handles.
Respond with ONLY compact JSON:
{"website":"","linktree":"","booking_email":"","phone":"","city":"","country":"","instagram":"","facebook":"","twitter":"","tiktok":"","youtube":"","linkedin":"","soundcloud":"","spotify":"","bandcamp":"","telegram":"","whatsapp":"","booking_method":""}`;
  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.15, maxOutputTokens: 900 },
    tools: [{ google_search: {} }],
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => null);
  if (!r || !r.ok) return { found: {}, sources: [] };
  const data = await r.json().catch(() => ({}));
  const text = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('\n').trim();
  const sources = [...new Set((data?.candidates?.[0]?.groundingMetadata?.groundingChunks || []).map(c => c?.web?.uri).filter(Boolean))];
  let found = {};
  try {
    const m = text.replace(/```json|```/gi, '').match(/\{[\s\S]*\}/);
    if (m) found = JSON.parse(m[0]);
  } catch {}
  return { found, sources };
}

async function enrich(candidate, deep) {
  const c = candidate || {};
  const ident = {
    name: clean(c.venue_name || c.org || c.name),
    city: clean(c.city), country: clean(c.country),
    instagram: clean(c.instagram), website: clean(c.website), type: clean(c.contact_type),
  };
  const missing = ALL_LOOKUP_FIELDS.filter(f => {
    if (f === 'email') return isEmpty(c.email) && isEmpty(c.emails);
    if (f === 'phone') return isEmpty(c.phone) && isEmpty(c.phones);
    return isEmpty(c[f]);
  });

  const found = {};
  const sources = [];
  const g = await geminiLookup(ident, missing).catch(() => ({ found: {}, sources: [] }));
  sources.push(...(g.sources || []));
  const gf = g.found || {};
  Object.keys(gf).forEach(k => { if (clean(gf[k])) found[k] = clean(gf[k]); });

  const scrapedEmails = [], scrapedPhones = [], scrapedLinks = [];
  if (deep) {
    const urls = [...new Set([found.linktree, found.website, ident.website, c.linktree].filter(Boolean))].slice(0, 3);
    for (const u of urls) {
      const html = await fetchText(u).catch(() => '');
      const s = scrapePage(html);
      scrapedEmails.push(...s.emails); scrapedPhones.push(...s.phones); scrapedLinks.push(...s.links);
      if (html && !sources.includes(u)) sources.push(u);
    }
    scrapedLinks.forEach(link => {
      const cl = classifyLink(link);
      if (cl && cl.field !== 'website' && !found[cl.field]) found[cl.field] = cl.url;
    });
  }

  if (found.linktree && !found.website && isEmpty(c.website)) found.website = found.linktree;

  const patch = {};
  SOCIAL_FIELDS.forEach(f => { if (isEmpty(c[f]) && found[f]) patch[f] = found[f]; });
  ['city','region','country','address','booking_method'].forEach(f => { if (isEmpty(c[f]) && found[f]) patch[f] = found[f]; });

  const emailPool = [...new Set([found.booking_email, ...scrapedEmails].map(clean).filter(Boolean))];
  if (emailPool.length && isEmpty(c.email) && isEmpty(c.emails)) {
    patch.email = emailPool[0];
    if (emailPool.length > 1) patch.emails = emailPool;
  }
  const phonePool = [...new Set([found.phone, ...scrapedPhones].map(clean).filter(Boolean))];
  if (phonePool.length && isEmpty(c.phone) && isEmpty(c.phones)) {
    patch.phone = phonePool[0];
    if (phonePool.length > 1) patch.phones = phonePool;
  }

  return {
    success: true,
    patch,
    found,
    filled: Object.keys(patch),
    missing_before: missing,
    sources: [...new Set(sources)].slice(0, 12),
    linktree: found.linktree || '',
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { success: false, error: 'POST only' });
  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch { return json(400, { success: false, error: 'bad JSON' }); }

  const isAgent = AGENT_KEY && b.agent_key === AGENT_KEY;
  const auth = isAgent ? { ok: true } : await authorize(b, 'discovery');
  if (!auth.ok && !isAgent) return json(401, { success: false, error: auth.error || 'unauthorized' });

  const deep = b.deep !== false;
  try {
    let candidate = b.candidate;
    if (!candidate && b.proposal_id) {
      const p = await getDoc(COLL, b.proposal_id);
      if (!p) return json(404, { success: false, error: 'proposal not found' });
      candidate = p.candidate || {};
    }
    if (!candidate) return json(400, { success: false, error: 'proposal_id or candidate required' });
    const res = await withGuard(enrich(candidate, deep));
    return json(200, { ...res, proposal_id: b.proposal_id || null, at: now() });
  } catch (e) {
    return json(200, { success: false, error: e.message });
  }
};

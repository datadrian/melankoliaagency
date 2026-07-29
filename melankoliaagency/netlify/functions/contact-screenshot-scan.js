// Contact Discovery — SCREENSHOT scan.
// Accepts a small batch of phone screenshots (images as data URLs). For each:
//   1. Stores the ORIGINAL image to GitHub (served via jsDelivr CDN) — kept forever.
//   2. Runs Gemini vision to extract booking-contact fields.
//   3. Stages a proposal in the SAME contact_discovery_proposals collection,
//      tagged source:'screenshot' + source_image_url so the panel shows a badge.
// The admin panel approves/edits exactly like Gmail-sourced proposals.
// Batch client-side (zip unpacked in the browser); this handles ~1-4 images/call
// to stay under the Netlify function timeout.

const { listDocs, createDoc, json } = require('./_firebase');

const COLL = 'contact_discovery_proposals';
const ADMIN_PW = () => process.env.MELANKOLIA_ADMIN_PASSWORD || 'melankolia2025';
const AGENT_KEY = () => process.env.CONTACT_DISCOVERY_KEY || process.env.MELANKOLIA_ADMIN_PASSWORD || 'melankolia2025';
const now = () => new Date().toISOString();
const id = () => `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const norm = v => String(v || '').trim().toLowerCase();

const GH = 'https://api.github.com', OWNER = 'datadrian', REPO = 'melankoliaagency', BRANCH = 'main';
function ghHeaders() {
  const t = process.env.GITHUB_TOKEN;
  if (!t) throw new Error('GITHUB_TOKEN not configured');
  return { 'Authorization': 'Bearer ' + t, 'Accept': 'application/vnd.github+json', 'User-Agent': 'melankolia-screenshot', 'X-GitHub-Api-Version': '2022-11-28' };
}
async function ghPut(path, b64, message) {
  const r = await fetch(`${GH}/repos/${OWNER}/${REPO}/contents/${encodeURI(path)}`, {
    method: 'PUT', headers: ghHeaders(), body: JSON.stringify({ message, content: b64, branch: BRANCH })
  });
  if (!r.ok) throw new Error('GitHub write failed: ' + r.status + ' ' + (await r.text()).slice(0, 160));
  return r.json();
}

const MARKET_HINT = `Coarse market bucket for tour routing. US: SoCal, NorCal, California, Pacific Northwest, Southwest, Midwest, Northeast, Southeast, Texas. EU: DACH, West, UK-IE, South, Balkans-SEE. LATAM. Use "" if unknown.`;

async function geminiExtract(mime, b64) {
  const apiKey = process.env.GEMINI_API_KEY_V2 || process.env.GEMINI_API_KEY;
  if (!apiKey) return { error: 'GEMINI_API_KEY not configured' };
  const model = process.env.GEMINI_DOC_MODEL || 'gemini-3.1-flash-lite';
  const prompt = `You are reading a PHONE SCREENSHOT related to live-music booking (it may be an email, a text/WhatsApp/DM thread, a contact card, an Instagram profile, or a business card photo). Extract the BOOKING CONTACT (a promoter, venue, booker, buyer, festival, or agency) into STRICT JSON. Use "" or [] when a field is not present. Do NOT invent values.

If the screenshot clearly contains NO booking contact (e.g. a random photo, meme, unrelated app), set "is_contact" to false.

${MARKET_HINT}

Capture EVERY contact detail visible anywhere in the screenshot — do not skip anything. Include all email addresses, all phone/WhatsApp numbers, and every social handle or link you can see (headers, signatures, bios, profile fields, footers, business cards). Never invent a value; only record what is actually shown.

Return ONLY this JSON:
{"is_contact":true,"name":"","title":"","org":"","venue_name":"","contact_type":"","email":"","phone":"","emails":[],"phones":[],"website":"","instagram":"","facebook":"","twitter":"","tiktok":"","youtube":"","linkedin":"","soundcloud":"","spotify":"","bandcamp":"","telegram":"","whatsapp":"","other_socials":[{"platform":"","handle":"","url":""}],"city":"","region":"","country":"","address":"","market":"","booking_method":"","relationship_status":"","venues":[{"name":"","city":"","address":""}],"notes":"","confidence":"medium"}
- name: the person; title: their role/job title if shown (e.g. Talent Buyer, Booker)
- contact_type: one of promoter, venue, festival, agency, buyer, other
- email/phone: the PRIMARY/best one; emails[]/phones[]: ALL of them found (include the primary too)
- instagram/facebook/twitter/tiktok/youtube/linkedin/soundcloud/spotify/bandcamp/telegram/whatsapp: handle or URL if present (else "")
- whatsapp: the WhatsApp number/link specifically if identified as WhatsApp
- other_socials[]: any platform not listed above (Discord, Threads, Signal, etc.)
- booking_method: how they book (email, phone, instagram DM, form, etc.) if visible
- venues[]: any specific rooms/venues named
- address: street address of the contact/venue if shown
- confidence: high/medium/low based on how clearly a bookable contact is present`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 18000);
  try {
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } })
    });
    clearTimeout(to);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: (j.error && j.error.message) || ('Gemini ' + r.status) };
    const txt = (((j.candidates || [])[0] || {}).content || {}).parts?.map(x => x.text || '').join('') || '{}';
    try { return { fields: JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)) }; }
    catch { return { error: 'parse failed', raw: txt.slice(0, 300) }; }
  } catch (e) { clearTimeout(to); return { error: e.name === 'AbortError' ? 'Gemini timed out' : e.message }; }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { success: false, error: 'POST only' });
  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch { return json(400, { success: false, error: 'Invalid JSON' }); }

  if (b.password !== ADMIN_PW() && b.agent_key !== AGENT_KEY()) return json(401, { success: false, error: 'Unauthorized' });

  const images = Array.isArray(b.images) ? b.images.slice(0, 4) : [];
  if (!images.length) return json(400, { success: false, error: 'images[] required (max 4 per call)' });

  const existing = await listDocs(COLL, { orderBy: 'created_at desc', pageSize: 500 }).catch(() => []);
  const seen = new Set();
  existing.forEach(d => {
    const em = norm(d.candidate && d.candidate.email);
    if (em) seen.add(em);
    const c = d.candidate || {};
    const key = 'np:' + norm(c.name || c.org || c.venue_name) + '|' + String(c.phone || '').replace(/[^0-9]/g, '');
    if (key !== 'np:|') seen.add(key);
  });

  const results = [];
  let staged = 0, skipped = 0, noncontact = 0, errors = 0;

  for (const img of images) {
    const filename = String(img.filename || 'screenshot.jpg');
    const m = String(img.dataUrl || '').match(/^data:(image\/(?:png|jpe?g|webp|heic|heif));base64,([A-Za-z0-9+/=]+)$/i);
    if (!m) { errors++; results.push({ filename, ok: false, error: 'not an image' }); continue; }
    const mime = m[1].toLowerCase();
    const b64 = m[2];
    const ext = mime.split('/')[1].replace('jpeg', 'jpg');

    let imgUrl = '', sitePath = '';
    try {
      const uniq = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const safe = filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 50) || 'screenshot';
      const relFinal = `contact-screenshots/${uniq}-${safe}.${ext}`;
      await ghPut(`public/${relFinal}`, b64, `contact-discovery: screenshot ${safe}`);
      sitePath = '/' + relFinal;
      imgUrl = `https://cdn.jsdelivr.net/gh/${OWNER}/${REPO}@${BRANCH}/public/${relFinal}`;
    } catch (e) {
      errors++; results.push({ filename, ok: false, error: 'store failed: ' + e.message }); continue;
    }

    const ex = await geminiExtract(mime, b64);
    if (ex.error) { errors++; results.push({ filename, ok: false, error: ex.error, source_image_url: imgUrl }); continue; }
    const f = ex.fields || {};
    if (f.is_contact === false) { noncontact++; results.push({ filename, ok: true, skipped: 'no contact in image', source_image_url: imgUrl }); continue; }

    const email = norm(f.email);
    const npKey = 'np:' + norm(f.name || f.org || f.venue_name) + '|' + String(f.phone || '').replace(/[^0-9]/g, '');
    if ((email && seen.has(email)) || (npKey !== 'np:|' && seen.has(npKey))) {
      skipped++; results.push({ filename, ok: true, skipped: 'duplicate', name: f.name || '', source_image_url: imgUrl }); continue;
    }
    if (email) seen.add(email);
    if (npKey !== 'np:|') seen.add(npKey);

    const uniqStr = (arr, extra) => {
      const out = [], seenl = new Set();
      [].concat(Array.isArray(arr) ? arr : [], extra ? [extra] : []).forEach(x => {
        const v = String(x || '').trim(); const k = v.toLowerCase();
        if (v && !seenl.has(k)) { seenl.add(k); out.push(v); }
      });
      return out;
    };
    const otherSocials = Array.isArray(f.other_socials)
      ? f.other_socials.filter(o => o && (o.handle || o.url)).map(o => ({ platform: o.platform || '', handle: o.handle || '', url: o.url || '' }))
      : [];
    const candidate = {
      name: f.name || '', title: f.title || '', org: f.org || '', venue_name: f.venue_name || f.org || f.name || '',
      contact_type: f.contact_type || 'other',
      email: f.email || (Array.isArray(f.emails) && f.emails[0]) || '',
      phone: f.phone || (Array.isArray(f.phones) && f.phones[0]) || '',
      emails: uniqStr(f.emails, f.email),
      phones: uniqStr(f.phones, f.phone),
      website: f.website || '',
      instagram: f.instagram || '', facebook: f.facebook || '', twitter: f.twitter || '',
      tiktok: f.tiktok || '', youtube: f.youtube || '', linkedin: f.linkedin || '',
      soundcloud: f.soundcloud || '', spotify: f.spotify || '', bandcamp: f.bandcamp || '',
      telegram: f.telegram || '', whatsapp: f.whatsapp || '',
      other_socials: otherSocials,
      city: f.city || '', region: f.region || '', country: f.country || '', address: f.address || '', market: f.market || '',
      booking_method: f.booking_method || '', relationship_status: f.relationship_status || '',
      venues: Array.isArray(f.venues) ? f.venues.filter(v => v && v.name) : [],
      notes: f.notes || '',
    };
    const doc = {
      type: 'new', status: 'pending',
      source: 'screenshot', source_image_url: imgUrl, source_filename: filename, source_site_path: sitePath,
      candidate, match_target_venue_id: '', proposed_fields: {}, existing_snapshot: {},
      confidence: f.confidence || 'medium', note: 'Extracted from phone screenshot',
      scanned_window_start: '', scanned_window_end: '',
      created_at: now(), updated_at: now(),
    };
    await createDoc(COLL, doc, id());
    staged++;
    results.push({ filename, ok: true, staged: true, name: candidate.name || candidate.venue_name || '(unnamed)', source_image_url: imgUrl });
  }

  return json(200, { success: true, staged, skipped, noncontact, errors, processed: images.length, results });
};

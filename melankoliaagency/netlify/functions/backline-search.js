// Melankolia Agency — Backline Finder
// Grounded research for city-level backline rental / production suppliers and venue backline terms.

const RESEARCH_MODEL = 'gemini-3-flash-preview';
const PARSER_MODEL = 'gemini-3.1-flash-lite';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return json({ success:false, error:'POST only' }, 405, headers);
  const apiKey = process.env.GEMINI_API_KEY_V2 || process.env.GEMINI_API_KEY;
  if (!apiKey) return json({ success:false, error:'GEMINI_API_KEY is not configured on Netlify' }, 500, headers);

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}
  try {
    const result = await withTimeout((async()=>{
      const data = body.data || body;
      if (body.debug || (event.queryStringParameters||{}).debug) globalThis.__BL_DEBUG = true;
      const city = clean(data.city || data.location);
      if (!city) { const err=new Error('city required'); err.status=400; throw err; }
      const parsed = await researchBacklineStructured(data, apiKey);
      return { ...parsed, researched_at:new Date().toISOString() };
    })(), 24000, 'Deep grounded backline research timed out; returned fast planning fallback instead.');
    if (globalThis.__BL_DEBUG) result.__raw = String(globalThis.__BL_LAST_RAW||'').slice(0,3000);
    return json({ success:true, data:result }, 200, headers);
  } catch(e) {
    const data = body.data || body || {};
    // Bad request (missing city) is a real error — surface it.
    if (e.status && e.status !== 504 && e.status !== 500) {
      return json({ success:false, error:e.message || 'Backline search failed' }, e.status, headers);
    }
    // Everything else — timeout, Gemini parse failure, transient API error —
    // degrades gracefully to the fast planning fallback so the user always
    // gets usable research links + questions instead of a red error.
    const warning = /timed out/i.test(e.message||'')
      ? e.message
      : `Deep grounded research was unavailable (${e.message||'Gemini error'}); returned fast planning fallback instead.`;
    return json({ success:true, warning, data:fallbackBackline(data, warning) }, 200, headers);
  }
};

function fallbackBackline(d={}, warning='') {
  const city=clean(d.city||d.location), country=clean(d.country), venue=clean(d.venue||d.venue_name||d.suggested_venue);
  const loc=[city,country].filter(Boolean).join(', ');
  const q=encodeURIComponent;
  const searches=[
    {label:'Backline rental search', url:`https://www.google.com/search?q=${q(`${loc} backline rental music gear`)}`},
    {label:'Production / event supplier search', url:`https://www.google.com/search?q=${q(`${loc} event production backline rental`)}`},
    {label:'Rehearsal studio gear rental search', url:`https://www.google.com/search?q=${q(`${loc} rehearsal studio gear rental`)}`},
    venue ? {label:'Venue backline / tech specs search', url:`https://www.google.com/search?q=${q(`${venue} ${city} technical specs backline production contact`)}`} : null
  ].filter(Boolean);
  return {
    location:loc,
    summary:'Fast planning fallback returned because deep grounded research exceeded the live function time limit. Use these links and questions to confirm backline manually; do not treat terms as verified yet.',
    recommended_plan:'Ask promoter/venue first whether house backline or production contacts exist. In parallel, search local backline/event-production suppliers and confirm delivery vs pickup, deposit/ID, hours, and emergency availability before routing the day.',
    risk_level:'unknown',
    suppliers:searches.slice(0,3).map(x=>({name:x.label,type:'search_link',website:x.url,email:null,phone:null,services:['manual research link'],delivery_available:'unknown',pickup_required:'unknown',terms:'Unverified — open link and confirm directly.',deposit_or_id:'unknown',hours_or_timing:'unknown',fit_reason:'Fallback search path generated for quick planning when deep research times out.',confidence_score:1,source_urls:[x.url]})),
    venue_backline: venue ? [{venue,confirmed_backline:'unknown',equipment:[],terms:'Unverified — check venue tech specs or ask production contact.',production_contact:null,source_urls:[searches[3]?.url].filter(Boolean)}] : [],
    open_questions:['Does the venue/promoter provide house backline or a preferred supplier?','Is delivery to venue available, or is pickup/return required?','What deposit, ID, insurance, or payment terms are required?','What are pickup/return hours and after-hours emergency options?','Which exact items are required: drums, bass amp, guitar amp, keyboard stand, DI, cymbals, stands?'],
    grounding:[],
    fallback:true,
    warning
  };
}

async function researchBacklineStructured(d, apiKey) {
  const city = clean(d.city || d.location);
  const country = clean(d.country);
  const venue = clean(d.venue || d.venue_name || d.suggested_venue);
  const gear = clean(d.gear_requirements || d.backline_needed || d.backline || 'partial backline: drums, bass amp, guitar amp, keys stand, DI, basic stage gear');
  const artist = clean(d.artist);
  const date = clean(d.date);
  const prompt = `FAST GROUNDED BACKLINE LOGISTICS RESEARCH. Return compact JSON only.

LOCATION: ${[city,country].filter(Boolean).join(', ')}
${venue ? `VENUE TO CHECK: ${venue}` : ''}
${artist ? `ARTIST: ${artist}` : ''}
${date ? `TARGET DATE: ${date}` : ''}
GEAR / BACKLINE NEED: ${gear}

Find 3-5 practical backline options in/near the city: backline rental companies, instrument rental houses, rehearsal/production suppliers, event production companies, or music stores that explicitly support rental/backline. If a venue is named, check whether official venue pages mention house backline, PA/stage gear, production contacts, or tech specs.

For every claim, use real source-supported information. Do not invent pricing, emails, phone numbers, delivery terms, pickup terms, deposits, opening hours, or venue backline. Unknown is acceptable.

Important wording: this is planning research for a possible stop. Do not say the artist is performing at, playing, or confirmed at the venue unless the input explicitly says confirmed.

Output ONLY a single JSON object — no markdown, no code fences, no commentary, no citations text. Use EXACTLY these top-level keys and array-item keys:
{
  "location": "City, Country",
  "summary": "1-2 sentence overview",
  "recommended_plan": "practical plan: ask promoter/venue first vs rent locally, pickup risk",
  "risk_level": "low | medium | high | unknown",
  "suppliers": [ { "name": "", "type": "backline_rental | production | rehearsal_studio | music_store", "website": "", "email": "", "phone": "", "services": ["drums","bass amp"], "delivery_available": "yes | no | unknown", "pickup_required": "yes | no | unknown", "terms": "", "deposit_or_id": "", "hours_or_timing": "", "fit_reason": "", "source_urls": ["https://..."] } ],
  "venue_backline": [ { "venue": "", "confirmed_backline": "yes | no | unknown", "equipment": ["Gretsch kit","Ampeg SVT"], "terms": "", "production_contact": "", "source_urls": ["https://..."] } ],
  "open_questions": ["question 1","question 2"]
}
Do not invent phone numbers, emails, or terms — use "unknown" when not source-supported.`;
  const res = await callGemini(RESEARCH_MODEL, {
    contents:[{ parts:[{ text:prompt }] }],
    tools:[{ google_search:{} }],
    generationConfig:{ temperature:0.05, maxOutputTokens:4096 }
  }, apiKey, 1);
  const __raw = extractText(res);
  if (globalThis.__BL_DEBUG) globalThis.__BL_LAST_RAW = __raw;
  const parsed = normalizeBackline(parseJsonish(__raw), d);
  parsed.grounding = extractGrounding(res);
  return parsed;
}

// Map whatever key names the grounded model returns into our canonical shape.
// Grounded calls ignore responseSchema, so the model sometimes uses e.g.
// rental_options / company_name / venue_backline_info instead of suppliers / name.
function normalizeBackline(raw, d={}){
  raw = raw && typeof raw === 'object' ? raw : {};
  const pick = (o,keys)=>{ for(const k of keys){ if(o && o[k]!=null && o[k]!=='') return o[k]; } return ''; };
  const arr = v => Array.isArray(v) ? v : (v && typeof v==='object' ? Object.values(v).filter(x=>x&&typeof x==='object') : []);
  const asList = v => Array.isArray(v) ? v.map(x=>String(x)).filter(Boolean)
                     : (typeof v==='string' && v ? v.split(/[;,\n]/).map(x=>x.trim()).filter(Boolean) : []);

  // suppliers can live under many key names
  const rawSuppliers = arr(raw.suppliers || raw.rental_options || raw.backline_options
    || raw.rental_companies || raw.suppliers_list || raw.options || raw.companies || raw.providers);
  const suppliers = rawSuppliers.map(s=>{
    s = s && typeof s==='object' ? s : {};
    return {
      name: pick(s,['name','company_name','company','supplier','title']) || 'Backline supplier',
      type: pick(s,['type','category']) || 'backline_rental',
      website: pick(s,['website','url','web','link','site']),
      email: pick(s,['email','contact_email']),
      phone: pick(s,['phone','contact_info','contact','tel','telephone']),
      services: asList(s.services || s.gear_available || s.equipment || s.inventory || s.gear),
      delivery_available: pick(s,['delivery_available','delivery']) || 'unknown',
      pickup_required: pick(s,['pickup_required','pickup']) || 'unknown',
      terms: pick(s,['terms','notes','details','minimum_rental','rental_terms']),
      deposit_or_id: pick(s,['deposit_or_id','deposit','id_required']) || 'unknown',
      hours_or_timing: pick(s,['hours_or_timing','hours','opening_hours','timing']) || 'unknown',
      fit_reason: pick(s,['fit_reason','why','reason','fit']) || (pick(s,['location','address']) ? ('Located at '+pick(s,['location','address'])) : ''),
      confidence_score: Number(s.confidence_score)||2,
      source_urls: asList(s.source_urls || s.sources || (s.website?[s.website]:[]) )
    };
  });

  // venue backline
  const vbSrc = raw.venue_backline || raw.venue_backline_info || raw.venue || raw.house_backline;
  const vbList = Array.isArray(vbSrc) ? vbSrc : (vbSrc && typeof vbSrc==='object' ? [vbSrc] : []);
  const venue_backline = vbList.map(v=>{
    v = v && typeof v==='object' ? v : {};
    return {
      venue: pick(v,['venue','venue_name','name']) || clean(d.venue||d.venue_name||d.suggested_venue) || '',
      confirmed_backline: pick(v,['confirmed_backline','confirmed','has_backline']) || 'unknown',
      equipment: asList(v.equipment || v.house_gear_summary || v.gear || v.house_gear),
      terms: pick(v,['terms','notes','details']),
      production_contact: pick(v,['production_contact','contact','tech_contact']) || null,
      source_urls: asList(v.source_urls || v.sources || (v.tech_specs_url?[v.tech_specs_url]:[]))
    };
  }).filter(v=>v.venue || v.equipment.length);

  return {
    location: pick(raw,['location','city','area']) || [clean(d.city||d.location),clean(d.country)].filter(Boolean).join(', '),
    summary: pick(raw,['summary','overview']) || 'Grounded backline research for this stop.',
    recommended_plan: pick(raw,['recommended_plan','plan','recommendation','best_plan']) || 'Ask the promoter/venue first whether house backline exists; in parallel line up a local rental supplier and confirm delivery, deposit/ID, and pickup/return timing before routing the day.',
    risk_level: pick(raw,['risk_level','risk']) || 'unknown',
    suppliers,
    venue_backline,
    open_questions: asList(raw.open_questions || raw.questions || raw.follow_ups).length ? asList(raw.open_questions || raw.questions || raw.follow_ups)
      : ['Does the venue/promoter provide house backline or a preferred supplier?','Is delivery to the venue available, or is pickup/return required?','What deposit, ID, or payment terms are required?','What are pickup/return hours and after-hours options?','Which exact items are needed (drums, bass amp, guitar amp, keys stand, DI, cymbals)?']
  };
}

async function researchBackline(d, apiKey) {
  const city = clean(d.city || d.location);
  const country = clean(d.country);
  const venue = clean(d.venue || d.venue_name || d.suggested_venue);
  const gear = clean(d.gear_requirements || d.backline_needed || d.backline || 'partial backline: drums, bass amp, guitar amp, keys stand, DI, basic stage gear');
  const artist = clean(d.artist);
  const date = clean(d.date);
  const prompt = `Research practical backline logistics for a possible route stop by an independent touring music act. This is planning research only; do not imply the show is confirmed unless the input explicitly says confirmed.

LOCATION: ${[city,country].filter(Boolean).join(', ')}
${venue ? `VENUE TO CHECK: ${venue}` : ''}
${artist ? `ARTIST: ${artist}` : ''}
${date ? `TARGET DATE: ${date}` : ''}
GEAR / BACKLINE NEED: ${gear}

Find source-supported information for:
1. Local backline rental companies, musical instrument rental houses, rehearsal studios with gear rental, production companies, or event suppliers that can provide backline in/near this city.
2. Whether suppliers offer delivery to venue, pickup-only, minimum rental term, deposit/ID requirement, quote/contact process, opening hours, and emergency/after-hours feasibility if stated.
3. If a venue is named, whether the venue appears to have house backline, in-house PA/stage gear, or production contacts/tech specs.
4. Best practical plan: ask promoter/venue first vs rent locally, pickup risk, and unresolved questions.

Rules:
- Use Google Search and real source URLs.
- Do not invent pricing, emails, phone numbers, delivery terms, or venue backline. If not verified, say unknown.
- Do not phrase the artist as "performing at" or "playing at" a venue; say "possible stop", "target venue", or "if this stop is confirmed" unless confirmed status is explicitly provided.
- Prefer official supplier/venue pages over directories.
- Keep the dossier compact and operational, not essay-style.
- Include source URLs for every supplier/venue claim.`;
  const res = await callGemini(RESEARCH_MODEL, {
    contents:[{ parts:[{ text:prompt }] }],
    tools:[{ google_search:{} }],
    generationConfig:{ temperature:0.12, maxOutputTokens:4096 }
  }, apiKey, 1);
  return { rawDossier:extractText(res), grounding:extractGrounding(res) };
}

async function parseBackline(d, research, apiKey) {
  const parsePrompt = `Parse this backline logistics dossier into strict JSON. Keep language operational and conditional; do not imply the show is confirmed unless the input explicitly says confirmed.

INPUT CONTEXT:
${JSON.stringify({ city:d.city||d.location, country:d.country, venue:d.venue||d.venue_name||d.suggested_venue, artist:d.artist, date:d.date, gear_requirements:d.gear_requirements||d.backline_needed||d.backline }).slice(0,2000)}

DOSSIER:
${String(research.rawDossier || '').slice(0,18000)}

GLOBAL SOURCE URLS:
${(research.grounding||[]).join('\n')}

Return only JSON matching the schema. Do not guess unverified details; use null/unknown when not confirmed.`;
  const res = await callGemini(PARSER_MODEL, {
    contents:[{ parts:[{ text:parsePrompt }] }],
    generationConfig:{ temperature:0, maxOutputTokens:6144 }
  }, apiKey, 1);
  const parsed = parseJsonish(extractText(res));
  parsed.suppliers = Array.isArray(parsed.suppliers) ? parsed.suppliers : [];
  parsed.venue_backline = Array.isArray(parsed.venue_backline) ? parsed.venue_backline : [];
  parsed.open_questions = Array.isArray(parsed.open_questions) ? parsed.open_questions : [];
  return parsed;
}

const backlineSchema = {
  type:'OBJECT',
  properties:{
    location:{ type:'STRING' },
    summary:{ type:'STRING' },
    recommended_plan:{ type:'STRING' },
    risk_level:{ type:'STRING', enum:['low','medium','high','unknown'] },
    suppliers:{ type:'ARRAY', items:{ type:'OBJECT', properties:{
      name:{ type:'STRING' }, type:{ type:'STRING' }, website:{ type:'STRING', nullable:true }, email:{ type:'STRING', nullable:true }, phone:{ type:'STRING', nullable:true },
      services:{ type:'ARRAY', items:{ type:'STRING' } },
      delivery_available:{ type:'STRING', enum:['yes','no','unknown'] }, pickup_required:{ type:'STRING', enum:['yes','no','unknown'] },
      terms:{ type:'STRING' }, deposit_or_id:{ type:'STRING' }, hours_or_timing:{ type:'STRING' }, fit_reason:{ type:'STRING' }, confidence_score:{ type:'NUMBER' },
      source_urls:{ type:'ARRAY', items:{ type:'STRING' } }
    }, required:['name','type','services','delivery_available','pickup_required','terms','deposit_or_id','hours_or_timing','fit_reason','confidence_score','source_urls'] } },
    venue_backline:{ type:'ARRAY', items:{ type:'OBJECT', properties:{
      venue:{ type:'STRING' }, confirmed_backline:{ type:'STRING', enum:['yes','no','partial','unknown'] }, equipment:{ type:'ARRAY', items:{ type:'STRING' } },
      terms:{ type:'STRING' }, production_contact:{ type:'STRING', nullable:true }, source_urls:{ type:'ARRAY', items:{ type:'STRING' } }
    }, required:['venue','confirmed_backline','equipment','terms','source_urls'] } },
    open_questions:{ type:'ARRAY', items:{ type:'STRING' } }
  },
  required:['location','summary','recommended_plan','risk_level','suppliers','venue_backline','open_questions']
};

async function callGemini(model, payload, apiKey, attempts = 3) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  let lastText='', lastStatus=500;
  for (let i=0;i<attempts;i++) {
    const res = await fetch(url,{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    if (res.ok) return await res.json();
    lastStatus=res.status; lastText=await res.text().catch(()=>'');
    if (![500,502,503,504].includes(res.status)) break;
    await sleep(Math.min(8000, 1000*(2**i)) + Math.random()*500);
  }
  const e = new Error(`Gemini failed (${lastStatus}): ${lastText.slice(0,250)}`); e.status=lastStatus; throw e;
}
function extractText(data){ return (data?.candidates?.[0]?.content?.parts || []).map(p=>p.text||'').join('\n').trim(); }
function extractGrounding(data){ return [...new Set((data?.candidates?.[0]?.groundingMetadata?.groundingChunks || []).map(c=>c?.web?.uri).filter(Boolean))]; }
function parseJsonish(text){
  let clean = String(text||'').trim();
  // Strip markdown code fences anywhere in the string.
  clean = clean.replace(/```json/gi,'```').replace(/```/g,'').trim();
  if(!clean) throw new Error('Gemini returned an empty response');
  // 1) Straight parse.
  try{ return JSON.parse(clean); }catch{}
  // 2) Balanced-brace/bracket scan: find the first { or [ and walk to its
  //    matching close, respecting strings and escapes. Grounded responses often
  //    wrap the JSON in prose or append citations after it, which breaks a
  //    greedy first-to-last slice.
  const balanced = extractBalancedJson(clean);
  if(balanced){ try{ return JSON.parse(balanced); }catch{} }
  // 3) Greedy first-open to last-close as a last resort.
  const m = clean.match(/[\[{][\s\S]*[\]}]/);
  if(m){ try{ return JSON.parse(m[0]); }catch{} }
  throw new Error('Gemini did not return parseable JSON');
}
function extractBalancedJson(str){
  const start = str.search(/[\[{]/);
  if(start < 0) return null;
  const open = str[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for(let i=start; i<str.length; i++){
    const c = str[i];
    if(esc){ esc=false; continue; }
    if(c === '\\'){ esc=true; continue; }
    if(c === '"'){ inStr = !inStr; continue; }
    if(inStr) continue;
    if(c === open) depth++;
    else if(c === close){ depth--; if(depth === 0) return str.slice(start, i+1); }
  }
  return null; // unbalanced (likely truncated output)
}
function clean(v=''){ return String(v||'').replace(/\s+/g,' ').trim(); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function withTimeout(promise, ms, message){ return Promise.race([promise, new Promise((_,reject)=>setTimeout(()=>{ const e=new Error(message); e.status=504; reject(e); }, ms))]); }
function json(obj,statusCode=200,headers={}){ return { statusCode, headers, body:JSON.stringify(obj) }; }

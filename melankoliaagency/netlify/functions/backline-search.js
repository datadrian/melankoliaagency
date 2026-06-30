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
      const city = clean(data.city || data.location);
      if (!city) { const err=new Error('city required'); err.status=400; throw err; }
      const parsed = await researchBacklineStructured(data, apiKey);
      return { ...parsed, researched_at:new Date().toISOString() };
    })(), 16000, 'Deep grounded backline research timed out; returned fast planning fallback instead.');
    return json({ success:true, data:result }, 200, headers);
  } catch(e) {
    const data = body.data || body || {};
    if (e.status === 504 || /timed out/i.test(e.message || '')) {
      return json({ success:true, warning:e.message, data:fallbackBackline(data, e.message) }, 200, headers);
    }
    return json({ success:false, error:e.message || 'Backline search failed' }, e.status || 500, headers);
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

Return only strict JSON matching the schema. Keep terms concise and operational.`;
  const res = await callGemini(RESEARCH_MODEL, {
    contents:[{ parts:[{ text:prompt }] }],
    tools:[{ google_search:{} }],
    generationConfig:{ temperature:0.05, maxOutputTokens:2048, responseMimeType:'application/json', responseSchema:backlineSchema }
  }, apiKey, 1);
  const parsed = parseJsonish(extractText(res));
  parsed.suppliers = Array.isArray(parsed.suppliers) ? parsed.suppliers : [];
  parsed.venue_backline = Array.isArray(parsed.venue_backline) ? parsed.venue_backline : [];
  parsed.open_questions = Array.isArray(parsed.open_questions) ? parsed.open_questions : [];
  parsed.grounding = extractGrounding(res);
  return parsed;
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
    generationConfig:{ temperature:0, maxOutputTokens:6144, responseMimeType:'application/json', responseSchema:backlineSchema }
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
function parseJsonish(text){ const clean=String(text||'').replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim(); try{return JSON.parse(clean);}catch{} const m=clean.match(/[\[{][\s\S]*[\]}]/); if(!m) throw new Error('Gemini did not return parseable JSON'); return JSON.parse(m[0]); }
function clean(v=''){ return String(v||'').replace(/\s+/g,' ').trim(); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function withTimeout(promise, ms, message){ return Promise.race([promise, new Promise((_,reject)=>setTimeout(()=>{ const e=new Error(message); e.status=504; reject(e); }, ms))]); }
function json(obj,statusCode=200,headers={}){ return { statusCode, headers, body:JSON.stringify(obj) }; }

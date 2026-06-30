// Melankolia Agency — Gemini Venue Finder / Generic Generation Proxy
// Runs as a Netlify Function so Gemini API keys never live in browser code.
// Supports:
//   1) legacy generic prompt mode: { prompt, responseType }
//   2) venue finder genre mode: { mode:'detectGenre', band }
//   3) venue finder pipeline mode: { mode:'venues'|'promoters', location, genre, maxCapacity, includeMainstream }

const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const RESEARCH_MODEL = 'gemini-3-flash-preview';
const PARSER_MODEL = 'gemini-3.1-flash-lite';
const GENRE_MODEL = 'gemini-3.1-flash-lite';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return json({ error: 'POST only' }, 405, headers);

  const apiKey = process.env.GEMINI_API_KEY_V2 || process.env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: 'GEMINI_API_KEY is not configured on Netlify' }, 500, headers);

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}

  try {
    if (body.mode === 'detectGenre') {
      return json(await detectGenre(body, apiKey), 200, headers);
    }
    if (body.mode === 'researchDossier') {
      return json(await runResearchDossier(body, apiKey), 200, headers);
    }
    if (body.mode === 'parseDossier') {
      return json(await runParseDossier(body, apiKey), 200, headers);
    }
    if (body.mode === 'venues' || body.mode === 'promoters') {
      return json(await runVenueFinderPipeline(body, apiKey), 200, headers);
    }
    return json(await runGenericPrompt(body, apiKey), 200, headers);
  } catch (e) {
    return json({ ok: false, success: false, error: e.message || 'Gemini request failed' }, e.status || 500, headers);
  }
};

async function detectGenre(body, apiKey) {
  const band = String(body.band || body.artist || '').trim();
  if (!band) throw statusError('band required', 400);
  const prompt = `You are an expert music genre classifier with encyclopedic knowledge of all musical movements, subcultures, and eras.\nAnalyze the artist/band "${band}" and identify their primary musical genre and precise subgenres.\n\nCRITICAL INSTRUCTIONS:\n- Identify the core genre (e.g., Hip-Hop, Indie Rock, Jazz, Techno, Metal, Folk).\n- Identify up to 2 precise subgenres (e.g., Emo Rap, Post-Punk, Hard Bop, Minimal House, Shoegaze).\n- Return ONLY 2-3 specific, comma-separated words (e.g., "Indie Rock, Post-Punk" or "Jazz, Hard Bop").\n- Do not write any introduction, punctuation, or explanations.`;
  const data = await callGemini(GENRE_MODEL, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 64 }
  }, apiKey);
  const text = extractText(data).replace(/[\n.]+$/g, '').trim();
  return { ok: true, success: true, mode: 'detectGenre', text };
}

async function runResearchDossier(body, apiKey) {
  const mode = body.resultType === 'promoters' || body.target === 'promoters' ? 'promoters' : 'venues';
  const ctx = buildVenueFinderContext({ ...body, mode });
  // Per Adrian's instruction, Venue Finder research uses Gemini 3 with grounding — no Gemini 2.5 fallback.
  let modelUsed = RESEARCH_MODEL;
  let researchResponse = await callGemini(RESEARCH_MODEL, {
    systemInstruction: { parts: [{ text: ctx.researcherSystemInstruction }] },
    contents: [{ parts: [{ text: ctx.researcherPrompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.15, maxOutputTokens: mode === 'promoters' ? 3072 : 4096 }
  }, apiKey, 1);
  return { ok:true, success:true, mode:'researchDossier', resultType:mode, rawDossier:extractText(researchResponse), grounding:extractGrounding(researchResponse), model:modelUsed, parameters:ctx.parameters };
}

async function runParseDossier(body, apiKey) {
  const mode = body.resultType === 'promoters' || body.target === 'promoters' ? 'promoters' : 'venues';
  const rawDossier = String(body.rawDossier || '').trim();
  if (!rawDossier) throw statusError('rawDossier required', 400);
  const grounding = Array.isArray(body.grounding) ? body.grounding : [];
  const selectedSchema = mode === 'venues' ? venueSchema : promoterSchema;
  const parserSystemInstruction = getParserSystemInstruction();
  const parsePrompt = `Parse this research dossier into strict JSON for mode "${mode}".\n\nDOSSIER:\n${rawDossier.slice(0, 18000)}\n\nGLOBAL GROUNDING URLS:\n${grounding.join('\n')}`;
  let modelUsed = PARSER_MODEL;
  let parsed;
  const parseResponse = await callGemini(PARSER_MODEL, {
    systemInstruction: { parts: [{ text: parserSystemInstruction }] },
    contents: [{ parts: [{ text: parsePrompt }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 6144, responseMimeType: 'application/json', responseSchema: selectedSchema }
  }, apiKey, 1);
  parsed = parseJsonish(extractText(parseResponse));
  if (!Array.isArray(parsed)) parsed = parsed?.items || parsed?.data || [];
  parsed = normalizePipelineItems(parsed, mode);
  return { ok:true, success:true, mode:'parseDossier', resultType:mode, data:parsed, json:parsed, model:modelUsed };
}

function buildVenueFinderContext(body) {
  const mode = body.mode === 'promoters' ? 'promoters' : 'venues';
  const location = String(body.location || body.loc || '').trim();
  const genre = String(body.genre || '').trim();
  if (!location) throw statusError('location required', 400);
  if (!genre) throw statusError('genre required', 400);
  const capValue = Number.isFinite(parseInt(body.maxCapacity, 10)) ? parseInt(body.maxCapacity, 10) : 1000;
  const includeMainstream = body.includeMainstream !== false && body.includeMainstream !== 'false';
  const scopeText = includeMainstream
    ? 'Include a healthy mix of local independent underground DIY spaces AND established, mainstream, or commercial music clubs/venues that are active hosts of this genre.'
    : 'Focus exclusively on independent, underground, grassroots, DIY, alternative, and artist-run spaces. Exclude mainstream/commercial rooms unless they are essential to the local scene.';
  const requestedLimit = Math.max(4, Math.min(30, parseInt(body.resultLimit || (mode === 'venues' ? 12 : 8), 10) || (mode === 'venues' ? 12 : 8)));
  const searchFocus = String(body.searchFocus || '').trim();
  const focusLine = searchFocus ? `
- Search Focus: ${searchFocus}` : '';
  const researcherSystemInstruction = `You are a professional music booking agent and industry researcher.
Your goal is to compile a concise, grounded research dossier on active music venues and promoters/collectives in the requested location that book the requested genre.

RESEARCH PROTOCOL FOR CONTACTS & DATA:
1. Search Google and use real source pages.
2. Only record websites/socials when a direct, verifiable active URL is found.
3. Do not hallucinate or guess contact emails. If no verified email exists, write "No verified email found" and name the best alternative route.
4. Include source URLs used to confirm active status, booking method, genre relevance, and capacity when applicable.
5. Identify the top 3 strongest matches with a short rationale.
6. Keep the final output compact: structured Markdown bullets, no essays.`;
  const researcherPrompt = mode === 'venues'
    ? `Find as many active music venues as possible, aiming for up to ${requestedLimit}, in "${location}" suitable for "${genre}" acts.\n\nINPUT SEARCH PARAMETERS:\n- Genre Target: ${genre}\n- Maximum Venue Capacity Cap: ${capValue} attendees. Exclude venues strictly larger than this limit unless they have separate smaller rooms/stages within the cap.\n- Search Scope: ${scopeText}${focusLine}\n\nFor each venue, research: name, city, website, Instagram, Facebook, booking method, verified email if public, booking form URL if any, capacity, venue type, similar acts historically booked, coordinates if verified, confidence score, and source URLs.\n\nFlag the top 3 venues that are the strongest matches and explain why.`
    : `FAST GROUNDED PROMOTER DOSSIER. Find as many active music promoters, collectives, bookers, event series, or agencies as possible, aiming for up to ${requestedLimit} in "${location}" that book "${genre}" acts.

INPUT SEARCH PARAMETERS:
- Genre Target: ${genre}
- Search Scope: ${scopeText}
- Exclude standalone venues/bars/clubs that only book their own room; only include them if there is a clearly documented promoter, event-series, collective, agency, label night, festival, or named booking entity attached. Prioritize non-venue promoters/collectives.

For each result, return compact bullets only:
- name and type
- website or primary social
- Instagram/Facebook if directly verified
- booking method and verified email only if publicly listed; otherwise say "No verified email found"
- 1 associated event/act if source-supported
- confidence score 1-5
- 1-3 source URLs

Flag the top 3 strongest matches. Keep the entire dossier concise but do not omit valid matches found within the requested focus.`;
  return { mode, location, genre, capValue, includeMainstream, scopeText, researcherSystemInstruction, researcherPrompt, parameters:{ location, genre, maxCapacity:capValue, includeMainstream } };
}

function getParserSystemInstruction() {
  return `You are a strict data-parsing compiler. Your task is to extract the details from the provided research dossier and format it into the exact JSON schema requested.\n\nCOMPLIANCE RULES:\n- Never guess or construct data.\n- If no contact email was verified in the dossier, set the email field to null.\n- If the dossier indicates they use a web form or Instagram for bookings instead of email, set booking_method to contact_form or instagram_dm and map the respective URL.\n- Ensure capacity_numeric is an integer if documented, or null if unknown.\n- Select the top 3 entries flagged as best fit in the dossier, set is_top_recommendation true, and write a 1-sentence recommendation_reason.\n- For all other entries, set is_top_recommendation false and recommendation_reason null.\n- Preserve verification source URLs from the dossier.\n- Output JSON only.`;
}

async function runVenueFinderPipeline(body, apiKey) {
  const mode = body.mode === 'promoters' ? 'promoters' : 'venues';
  const location = String(body.location || body.loc || '').trim();
  const genre = String(body.genre || '').trim();
  if (!location) throw statusError('location required', 400);
  if (!genre) throw statusError('genre required', 400);

  const capValue = Number.isFinite(parseInt(body.maxCapacity, 10)) ? parseInt(body.maxCapacity, 10) : 1000;
  const includeMainstream = body.includeMainstream !== false && body.includeMainstream !== 'false';
  const scopeText = includeMainstream
    ? 'Include a healthy mix of local independent underground DIY spaces AND established, mainstream, or commercial music clubs/venues that are active hosts of this genre.'
    : 'Focus exclusively on independent, underground, grassroots, DIY, alternative, and artist-run spaces. Exclude mainstream/commercial rooms unless they are essential to the local scene.';
  const requestedLimit = Math.max(4, Math.min(30, parseInt(body.resultLimit || (mode === 'venues' ? 12 : 8), 10) || (mode === 'venues' ? 12 : 8)));
  const searchFocus = String(body.searchFocus || '').trim();
  const focusLine = searchFocus ? `
- Search Focus: ${searchFocus}` : '';

  const researcherSystemInstruction = `You are a professional music booking agent and industry researcher.
Your goal is to compile a concise, grounded research dossier on active music venues and promoters/collectives in the requested location that book the requested genre.

RESEARCH PROTOCOL FOR CONTACTS & DATA:
1. Search Google and use real source pages.
2. Only record websites/socials when a direct, verifiable active URL is found.
3. Do not hallucinate or guess contact emails. If no verified email exists, write "No verified email found" and name the best alternative route.
4. Include source URLs used to confirm active status, booking method, genre relevance, and capacity when applicable.
5. Identify the top 3 strongest matches with a short rationale.
6. Keep the final output compact: structured Markdown bullets, no essays.`;

  const researcherPrompt = mode === 'venues'
    ? `Find as many active music venues as possible, aiming for up to ${requestedLimit}, in "${location}" suitable for "${genre}" acts.\n\nINPUT SEARCH PARAMETERS:\n- Genre Target: ${genre}\n- Maximum Venue Capacity Cap: ${capValue} attendees. Exclude venues strictly larger than this limit unless they have separate smaller rooms/stages within the cap.\n- Search Scope: ${scopeText}${focusLine}\n\nFor each venue, research: name, city, website, Instagram, Facebook, booking method, verified email if public, booking form URL if any, capacity, venue type, similar acts historically booked, coordinates if verified, confidence score, and source URLs.\n\nFlag the top 3 venues that are the strongest matches and explain why.`
    : `FAST GROUNDED PROMOTER DOSSIER. Find as many active music promoters, collectives, bookers, event series, or agencies as possible, aiming for up to ${requestedLimit} in "${location}" that book "${genre}" acts.

INPUT SEARCH PARAMETERS:
- Genre Target: ${genre}
- Search Scope: ${scopeText}
- Exclude standalone venues/bars/clubs that only book their own room; only include them if there is a clearly documented promoter, event-series, collective, agency, label night, festival, or named booking entity attached. Prioritize non-venue promoters/collectives.

For each result, return compact bullets only:
- name and type
- website or primary social
- Instagram/Facebook if directly verified
- booking method and verified email only if publicly listed; otherwise say "No verified email found"
- 1 associated event/act if source-supported
- confidence score 1-5
- 1-3 source URLs

Flag the top 3 strongest matches. Keep the entire dossier concise but do not omit valid matches found within the requested focus.`;

  let researchModelUsed = RESEARCH_MODEL;
  let researchResponse = await callGemini(RESEARCH_MODEL, {
    systemInstruction: { parts: [{ text: researcherSystemInstruction }] },
    contents: [{ parts: [{ text: researcherPrompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.15, maxOutputTokens: mode === 'promoters' ? 3072 : 6144 }
  }, apiKey, 1);
  const rawDossier = extractText(researchResponse);
  const grounding = extractGrounding(researchResponse);

  const parserSystemInstruction = `You are a strict data-parsing compiler. Your task is to extract the details from the provided research dossier and format it into the exact JSON schema requested.\n\nCOMPLIANCE RULES:\n- Never guess or construct data.\n- If no contact email was verified in the dossier, set the email field to null.\n- If the dossier indicates they use a web form or Instagram for bookings instead of email, set booking_method to contact_form or instagram_dm and map the respective URL.\n- Ensure capacity_numeric is an integer if documented, or null if unknown.\n- Select the top 3 entries flagged as best fit in the dossier, set is_top_recommendation true, and write a 1-sentence recommendation_reason.\n- For all other entries, set is_top_recommendation false and recommendation_reason null.\n- Preserve verification source URLs from the dossier.\n- Output JSON only.`;

  const selectedSchema = mode === 'venues' ? venueSchema : promoterSchema;
  const parsePrompt = `Parse this research dossier into strict JSON for mode "${mode}".\n\nDOSSIER:\n${rawDossier.slice(0, 18000)}\n\nGLOBAL GROUNDING URLS:\n${grounding.join('\n')}`;
  let parsed;
  try {
    const parseResponse = await callGemini(PARSER_MODEL, {
      systemInstruction: { parts: [{ text: parserSystemInstruction }] },
      contents: [{ parts: [{ text: parsePrompt }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 6144,
        responseMimeType: 'application/json',
        responseSchema: selectedSchema
      }
    }, apiKey, 4);
    parsed = parseJsonish(extractText(parseResponse));
  } catch (schemaError) {
    throw schemaError;
  }

  if (!Array.isArray(parsed)) parsed = parsed?.items || parsed?.data || [];
  parsed = normalizePipelineItems(parsed, mode);
  return {
    ok: true,
    success: true,
    mode,
    data: parsed,
    json: parsed,
    rawDossier,
    grounding,
    models: { researcher: researchModelUsed, parser: PARSER_MODEL },
    parameters: { location, genre, maxCapacity: capValue, includeMainstream }
  };
}

async function runGenericPrompt(body, apiKey) {
  const model = String(body.model || DEFAULT_MODEL).replace(/[^a-zA-Z0-9._-]/g, '');
  const prompt = String(body.prompt || '').trim();
  const responseType = body.responseType || body.mode || 'text';
  const grounded = body.grounded !== false;
  const system = body.system ? String(body.system) : '';
  if (!prompt) throw statusError('prompt required', 400);
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : 0.2,
      maxOutputTokens: Number.isFinite(Number(body.maxOutputTokens)) ? Number(body.maxOutputTokens) : 4096
    }
  };
  if (system) payload.systemInstruction = { parts: [{ text: system }] };
  if (grounded) payload.tools = [{ google_search: {} }];
  const data = await callGemini(model, payload, apiKey);
  const text = extractText(data);
  if (responseType === 'json') return { ok: true, success: true, model, text, json: parseJsonish(text), grounding: extractGrounding(data) };
  return { ok: true, success: true, model, text, grounding: extractGrounding(data) };
}

function normalizePipelineItems(items, mode) {
  return (Array.isArray(items) ? items : []).map((item, idx) => {
    const coordinates = item.coordinates || {};
    const lat = numOrNull(coordinates.lat ?? item.lat);
    const lng = numOrNull(coordinates.lng ?? item.lng);
    const sources = Array.isArray(item.verification_sources) ? item.verification_sources.filter(Boolean) : [];
    const bookingMethod = normalizeBookingMethod(item.booking_method, item.email, item.booking_form_url, item.instagram, item.facebook);
    const common = {
      ...item,
      coordinates: { lat, lng },
      lat, lng,
      website: nullOrString(item.website),
      instagram: nullOrString(item.instagram),
      facebook: nullOrString(item.facebook),
      booking_method: bookingMethod,
      email: isProbablyEmail(item.email) ? String(item.email).trim() : null,
      booking_form_url: nullOrString(item.booking_form_url),
      description: String(item.description || '').trim(),
      is_top_recommendation: !!item.is_top_recommendation || idx < 3 && /top|recommend/i.test(String(item.recommendation_reason || '')),
      recommendation_reason: item.recommendation_reason ? String(item.recommendation_reason).trim() : null,
      confidence_score: clampInt(item.confidence_score, 1, 5, sources.length ? 3 : 2),
      verification_sources: sources
    };
    if (mode === 'venues') {
      return {
        ...common,
        city: String(item.city || '').trim(),
        capacity_numeric: numOrNull(item.capacity_numeric ?? item.capacity),
        capacity_display: String(item.capacity_display || item.capacity || 'Unknown').trim(),
        capacity: String(item.capacity_display || item.capacity || 'Unknown').trim(),
        price: item.price || 'N/A',
        venue_type: String(item.venue_type || 'Music Venue').trim(),
        similar_acts_booked: Array.isArray(item.similar_acts_booked) ? item.similar_acts_booked : (item.similar_bands || []),
        similar_bands: Array.isArray(item.similar_acts_booked) ? item.similar_acts_booked : (item.similar_bands || [])
      };
    }
    return {
      ...common,
      type: String(item.type || 'Promoter / Collective').trim(),
      associated_acts: Array.isArray(item.associated_acts) ? item.associated_acts : (item.similar_bands || []),
      similar_bands: Array.isArray(item.associated_acts) ? item.associated_acts : (item.similar_bands || [])
    };
  });
}

const venueSchema = {
  type: 'ARRAY',
  items: { type: 'OBJECT', properties: {
    name: { type: 'STRING' }, city: { type: 'STRING' },
    coordinates: { type: 'OBJECT', properties: { lat: { type: 'NUMBER', nullable: true }, lng: { type: 'NUMBER', nullable: true } }, required: ['lat','lng'] },
    website: { type: 'STRING', nullable: true }, instagram: { type: 'STRING', nullable: true }, facebook: { type: 'STRING', nullable: true },
    booking_method: { type: 'STRING', enum: ['email','contact_form','instagram_dm','facebook_messenger','unknown'] },
    email: { type: 'STRING', nullable: true }, booking_form_url: { type: 'STRING', nullable: true },
    description: { type: 'STRING' }, capacity_numeric: { type: 'INTEGER', nullable: true }, capacity_display: { type: 'STRING' }, venue_type: { type: 'STRING' },
    similar_acts_booked: { type: 'ARRAY', items: { type: 'STRING' } },
    is_top_recommendation: { type: 'BOOLEAN' }, recommendation_reason: { type: 'STRING', nullable: true }, confidence_score: { type: 'INTEGER' },
    verification_sources: { type: 'ARRAY', items: { type: 'STRING' } }
  }, required: ['name','city','coordinates','website','instagram','facebook','booking_method','email','booking_form_url','description','capacity_numeric','capacity_display','venue_type','similar_acts_booked','is_top_recommendation','recommendation_reason','confidence_score','verification_sources'] }
};
const promoterSchema = {
  type: 'ARRAY',
  items: { type: 'OBJECT', properties: {
    name: { type: 'STRING' }, type: { type: 'STRING' }, website: { type: 'STRING', nullable: true }, instagram: { type: 'STRING', nullable: true }, facebook: { type: 'STRING', nullable: true },
    booking_method: { type: 'STRING', enum: ['email','contact_form','instagram_dm','facebook_messenger','unknown'] }, email: { type: 'STRING', nullable: true }, booking_form_url: { type: 'STRING', nullable: true },
    description: { type: 'STRING' }, associated_acts: { type: 'ARRAY', items: { type: 'STRING' } },
    is_top_recommendation: { type: 'BOOLEAN' }, recommendation_reason: { type: 'STRING', nullable: true }, confidence_score: { type: 'INTEGER' },
    verification_sources: { type: 'ARRAY', items: { type: 'STRING' } }
  }, required: ['name','type','website','instagram','facebook','booking_method','email','booking_form_url','description','associated_acts','is_top_recommendation','recommendation_reason','confidence_score','verification_sources'] }
};

async function callGemini(model, payload, apiKey, attempts = 4) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  let lastText = '', lastStatus = 500;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (res.ok) return await res.json();
    lastStatus = res.status;
    lastText = await res.text().catch(() => '');
    if (res.status === 429) {
      const detail = extractQuotaDetail(lastText);
      const quota = statusError(detail || 'Gemini API quota/rate limit reached for the specific Netlify GEMINI_API_KEY project/model. Check the exact Google AI Studio/API project attached to that key, or use a paid/upgraded key.', 429);
      throw quota;
    }
    if (![500, 502, 503, 504].includes(res.status)) break;
    await sleep(Math.min(16000, 1000 * (2 ** i)) + Math.random() * 700);
  }
  const err = new Error(`Gemini failed (${lastStatus}): ${lastText.slice(0, 300)}`);
  err.status = lastStatus;
  throw err;
}
function extractText(data) { return (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('\n').trim(); }
function extractGrounding(data) { return [...new Set((data?.candidates?.[0]?.groundingMetadata?.groundingChunks || []).map(c => c?.web?.uri).filter(Boolean))]; }
function parseJsonish(text) {
  const clean = String(text || '').replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(clean); } catch {}
  const m = clean.match(/[\[{][\s\S]*[\]}]/);
  if (!m) throw new Error('Gemini did not return parseable JSON');
  return JSON.parse(m[0]);
}

function extractQuotaDetail(raw) {
  try {
    const data = JSON.parse(raw || '{}');
    const msg = data?.error?.message || '';
    const violation = (data?.error?.details || []).flatMap(d => d.violations || [])[0];
    const retry = (data?.error?.details || []).find(d => d.retryDelay)?.retryDelay;
    const metric = violation?.quotaMetric ? violation.quotaMetric.split('/').pop() : '';
    const quotaId = violation?.quotaId || '';
    const model = violation?.quotaDimensions?.model || '';
    const limit = violation?.quotaValue || '';
    let text = 'Gemini API quota/rate limit reached for the specific Netlify GEMINI_API_KEY project';
    if (model) text += ` on model ${model}`;
    if (quotaId || metric || limit) text += ` (${[quotaId, metric && 'metric: '+metric, limit && 'limit: '+limit].filter(Boolean).join('; ')})`;
    if (retry) text += `. Google suggests retrying after ${retry}`;
    text += '. If your Gemini account dashboard looks fine, verify the exact API key/project configured in Netlify and whether billing/paid tier is enabled for that project.';
    return text;
  } catch {
    return '';
  }
}

function normalizeBookingMethod(v, email, form, instagram, facebook) {
  const s = String(v || '').toLowerCase();
  if (isProbablyEmail(email)) return 'email';
  if (s.includes('form') || form) return 'contact_form';
  if (s.includes('instagram') || s.includes('dm') && instagram) return 'instagram_dm';
  if (s.includes('facebook') || s.includes('messenger') && facebook) return 'facebook_messenger';
  return ['email','contact_form','instagram_dm','facebook_messenger','unknown'].includes(s) ? s : 'unknown';
}
function nullOrString(v) { const s = String(v || '').trim(); return s && !/^null$/i.test(s) && !/^unknown$/i.test(s) ? s : null; }
function numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function clampInt(v, min, max, fallback) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function isProbablyEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim()); }
function statusError(message, status) { const e = new Error(message); e.status = status; return e; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function json(obj, statusCode = 200, headers = {}) { return { statusCode, headers, body: JSON.stringify(obj) }; }

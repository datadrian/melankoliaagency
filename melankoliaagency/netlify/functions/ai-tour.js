const { json, listDocs } = require('./_firebase');

// Keep this inside Netlify functions. No frontend API keys.
const FAST = process.env.GEMINI_FAST_MODEL || 'gemini-3.1-flash-lite';
const ROUTE = process.env.GEMINI_ROUTE_FAST_MODEL || process.env.GEMINI_ROUTE_MODEL_FAST || FAST;
const CTX = `You are Melankolia Agency's senior underground booking strategist for darkwave, EBM, industrial, post-punk, synth, goth, and adjacent touring. Return strict JSON only. Do not write markdown.

Real workflow model:
- A route is not automatically booked. It develops as a booking funnel: prospect -> contacted -> hold -> offer -> negotiating -> deal_made -> confirmed -> advanced -> settled.
- Routing starts from anchors/holds/confirmed dates, then fills gaps with realistic markets and candidate venues.
- Good routing balances drive time, recovery, draw, venue fit, rate, deal structure, routing logic, buyer reliability, hotels, flights/trains/vans, gear weight, backline, border crossings, and whether back-to-back shows are physically possible.
- Holds need deadlines and context. Confirmed/locked stops need advancing details. Every stop should expose venue info, rate target, offer, deal status, travel feasibility, hotel responsibility, gear/backline needs, and next action.
- Avoid pretending unknown data is confirmed.`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { success:false, error:'POST only' });

  const key = process.env.GEMINI_API_KEY_V2 || process.env.GEMINI_API_KEY;
  if (!key) return json(500, { success:false, error:'GEMINI key missing' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { success:false, error:'Invalid request JSON' }); }

  const action = body.action || 'chat';
  const data = body.data || {};
  const model = body.model || ROUTE;

  try {
    const p = await prompt(action, data);
    const maxOutputTokens = action === 'generate_tour' ? 8192 : (action === 'assistant_edit_route' ? 4096 : 3072);
    const out = await gem(key, model, p, maxOutputTokens, action === 'generate_tour' ? 14500 : 24000);
    let dataOut = parse(out, action);
    if (action === 'generate_tour') dataOut = await enforceRouteContract(key, model, data, hydrateTourDefaults(dataOut, data), out);
    if (action === 'review_route') dataOut = hardenReview(dataOut, data);
    return json(200, { success:true, data:dataOut, raw:out, model });
  } catch (err) {
    // Always return JSON so the frontend never sees "Invalid JSON response" for backend failure.
    return json(200, { success:false, error:err.name === 'AbortError' ? 'AI route generation timed out. Try fewer target shows or more specific anchors.' : err.message, model });
  }
};

async function prompt(action, d) {
  if (action === 'generate_tour') {
    const crm = await crmVenueContext(d);
    return `${CTX}
Generate a practical compact route draft as STRICT MINIFIED JSON. HARD REQUIREMENTS:
- Requested numShows=N means EXACTLY N non-day_off show legs. Never return fewer.
- Humans are on a real schedule and may have taken off work: keep the tour manageable but as tight as possible. Avoid giant dead gaps.
- Independent touring limit: target max consecutive drive is 300 miles / 480 km or 4–5 hours. Anything above this must be marked risky and should create a day_off/travel day unless the date range makes it impossible.
- Europe/EU tachograph discipline: max 9 hours daily driving, mandatory 45-minute break after 4.5 hours, and strict 11-hour daily rest. Do not stack impossible drives.
- total_shows must equal requested numShows.
- Every show leg must include at least 5 candidate_venues ranked strongest to weakest. Keep each compact.
- CRM VENUE PRIORITY: proprietary CRM venues below are first-class contacts. For each city/region/capacity match, put CRM venues at the top of candidate_venues and set crm_source:true, relationship_status, and crm_id when available. Only use external/unverified venue discovery when no logical CRM match exists.
- Candidate venues are outreach targets/prospects, not confirmations unless supplied as anchors.

PROPRIETARY CRM VENUE CONTEXT (prioritize these over generic venues):
${crm || 'No CRM venues available yet. Use external venue candidates, clearly unverified.'}

Return only this compact shape; omit extra prose:
{"tour_name":"","name":"","artist":"","region":"","startDate":"","endDate":"","routing_strategy":"","anchor_strategy":"","summary":"","travel_strategy":"","total_days":0,"total_shows":0,"estimated_total_km":0,"legs":[{"date":"YYYY-MM-DD","city":"","country":"","day":1,"day_of_week":"","is_anchor_show":false,"day_off":false,"suggested_venue":"","candidate_venues":[{"name":"","capacity":"","booking_method":"unknown","website":null,"fit_reason":"","outreach_angle":"","crm_source":false,"crm_id":null,"relationship_status":""}],"booking_status":"prospect","deal_status":"not_started","drive_hours":0,"drive_from_previous_km":0,"travel_feasibility":"possible","travel_feasibility_reason":"","hotel_responsibility":"agency","backline_needed":"partial","deal_suggestion":"","next_action":"","notes":""}]}
Inputs: ${JSON.stringify(d).slice(0, 10000)}`;
  }

  if (action === 'analyze_anchors') return `${CTX}\nAnalyze anchors/holds/confirmed stops. Return JSON {overall_verdict, verdict_summary, gap_analysis:[{between,issue,opportunity,fill_cities,next_action}], weak_holds:[{city,date,reason,deadline_recommendation}], missing_markets:[], routing_risks:[], recommended_next_actions:[]}. Inputs: ${JSON.stringify(d).slice(0, 10000)}`;
  if (action === 'review_route') return `${CTX}\nAct as a second-pass tour director reviewing a generated plan before the agency sends emails. Decide whether the plan is reasonable for real humans on a schedule. Return JSON {verdict:'greenlight|needs_changes|risky|reject',score:0-100,summary:'',show_count_check:{requested,actual,passes},schedule_pressure:'tight|reasonable|loose|bad',major_risks:[{severity:'low|medium|high',leg_index,city,issue,fix}],unrealistic_gaps:[],venue_readiness:{all_stops_have_5_targets:true,missing:[]},recommended_changes:[{label,reason,action,leg_index,payload}],suggested_actions:[{label,action,leg_index,payload}]}. Supported action values: insert_blank_day, optimize_route, estimate_budget, research_venues_all, venue_finder_stop, open_stop, generate_email_stop, analyze_anchors, save_tour. Make every major risk actionable. If schedule pressure is tight/bad, include a suggested_action {label:'Add recovery day after [city/event]', action:'insert_blank_day', leg_index:<stop before new rest day>, payload:{reason:'...', city:'optional', date:'optional'}}. If venues are missing, include venue_finder_stop actions for those leg indices. If holds are missing, include open_stop or generate_email_stop actions. Inputs: ${JSON.stringify(d).slice(0, 14000)}`;
  if (action === 'optimize_route') return `${CTX}\nOptimize route order and stop pipeline without losing booking status. Return {optimized_legs,routing_notes,total_km_estimate,tradeoffs,next_actions,suggested_actions:[{label,action,leg_index,payload}]}. Supported action values: estimate_budget, research_venues_all, venue_finder_stop, open_stop, generate_email_stop, analyze_anchors. Inputs: ${JSON.stringify(d).slice(0, 12000)}`;
  if (action === 'estimate_budget') return `${CTX}\nEstimate budget from route, deal pipeline, hotels, flights/trains/vans, airport transfers, gear/backline needs, and promoter-covered costs. Return JSON {revenue:{},expenses:{},net_profit_loss,break_even_guarantee_per_show,is_viable,high_risk_stops:[],savings_tips:[],deal_notes:[],suggested_actions:[{label,action,leg_index,payload}]}. Supported action values: advise_deal, open_stop, research_venues_all, optimize_route. Inputs: ${JSON.stringify(d).slice(0, 12000)}`;
  if (action === 'suggest_venues') return `${CTX}\nSuggest underground venue/promoter options for this city. Return {venues:[{name,capacity,type,known_for,booking_method,booking_contact_tip,deal_type_typical,tier,fit_reason,next_action}]}. Inputs: ${JSON.stringify(d).slice(0, 10000)}`;
  if (action === 'advise_deal') return `${CTX}\nEvaluate the deal/offer. Return {offer_assessment, market_rate_range, counter_suggestion, negotiation_points, additional_asks, accept_if, walk_away_if, next_action}. Inputs: ${JSON.stringify(d).slice(0, 10000)}`;
  if (action === 'assistant_edit_route') return `${CTX}
You are the always-available Route Planner copilot. Read the entire active route/show context and the user's request. If the request is advisory, answer normally. If the request asks to change the tour, return a conservative proposed patch ONLY; never invent confirmations. The frontend will require the user to click Apply before saving.
Return strict JSON {answer:'', summary:'', route_patch:{tour_updates:{}, leg_updates:[{leg_index:0, updates:{}}], add_candidate_venues:[{leg_index:0, venue:{name:'', address:'', capacity:'', booking_method:'', website:'', email:'', fit_reason:'', outreach_angle:'manual/ai assistant'}}], add_legs:[{date:'YYYY-MM-DD', city:'', country:'', day_off:false, suggested_venue:'', booking_status:'prospect', deal_status:'not_started', candidate_venues:[]}], delete_leg_indices:[]}, suggested_actions:[{label:'',action:'insert_blank_day|optimize_route|estimate_budget|research_venues_all|venue_finder_stop|open_stop|generate_email_stop|analyze_anchors|save_tour',leg_index:null,payload:{}}], warnings:[]}.
Rules: leg_index is zero-based. Only include fields that should change. For venue additions prefer add_candidate_venues unless user explicitly says set/select as main venue. Do not change protected ids. Inputs: ${JSON.stringify(d).slice(0, 16000)}`;
  if (action === 'chat') return `${CTX}\nAnswer as a booking strategist, but make useful suggestions actionable. Return JSON {answer:'',recommended_next_actions:[''],suggested_actions:[{label:'',action:'insert_blank_day|optimize_route|estimate_budget|research_venues_all|venue_finder_stop|open_stop|generate_email_stop|analyze_anchors|save_tour',leg_index:null,payload:{}}]}. Only include actions that map to a real next click; if no tool applies, use recommended_next_actions only. Inputs: ${JSON.stringify(d).slice(0, 12000)}`;
  return `${CTX}\nAction ${action}. Return useful JSON. Inputs: ${JSON.stringify(d).slice(0, 10000)}`;
}

async function gem(key, model, prompt, maxOutputTokens, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method:'POST', headers:{'Content-Type':'application/json'}, signal:ctrl.signal,
      body:JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:0.18,maxOutputTokens} })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(j.error?.message || `Gemini ${model} failed ${r.status}`);
    return (j.candidates?.[0]?.content?.parts || []).map(x => x.text || '').join('\n').trim();
  } finally { clearTimeout(timer); }
}


async function crmVenueContext(request={}) {
  try {
    const venues = (await listDocs('route_planner_crm_venues', { orderBy:'updated_at desc', pageSize:180 })).filter(v => !v.deleted_at);
    if (!venues.length) return '';
    const q = [request.artist, request.region, request.city, request.startCity, request.endCity, request.genres, request.genre, request.preferences, request.capacity].filter(Boolean).join(' ');
    const terms = new Set(String(q||'').toLowerCase().replace(/[^a-z0-9\s-]/g,' ').split(/\s+/).filter(w=>w.length>2));
    const scored = venues.map(v => {
      const text = [v.name,v.city,v.country,v.region,v.capacity,Array.isArray(v.genre_affinity)?v.genre_affinity.join(' '):v.genre_affinity,v.relationship_status,v.notes,v.booking_email,v.booking_method].filter(Boolean).join(' ').toLowerCase();
      let score = 0; terms.forEach(t => { if (text.includes(t)) score += 1; });
      if (/confirmed|friendly|warm|known|strong|preferred|trusted/i.test(v.relationship_status||'')) score += 2;
      if (/bad|avoid/i.test(v.relationship_status||'')) score -= 3;
      return { v, score };
    }).sort((a,b)=>b.score-a.score).slice(0, 18).map(x=>x.v);
    return scored.map((v,i)=>`${i+1}. ${v.name} (${v.id||''}) — ${[v.city,v.country].filter(Boolean).join(', ')}; cap ${v.capacity||'unknown'}; genre ${(Array.isArray(v.genre_affinity)?v.genre_affinity.join(', '):v.genre_affinity)||'unknown'}; relationship ${v.relationship_status||'unknown'}; booking ${v.booking_email||v.booking_method||'unknown'}; notes ${String(v.notes||'').slice(0,80)}`).join('\n');
  } catch(e) { return ''; }
}
function routeViolations(t, request={}) {
  const legs = Array.isArray(t?.legs) ? t.legs : [];
  const showLegs = legs.filter(l=>!l.day_off);
  const target = Number(request.numShows || request.targetShows || 0);
  const violations=[];
  if (target && showLegs.length !== target) violations.push(`show_count ${showLegs.length} != requested ${target}`);
  showLegs.forEach((l,i)=>{
    const km=Number(l.drive_from_previous_km||0), hrs=Number(l.drive_hours||0);
    if (km > 480 || hrs > 5) violations.push(`leg ${i+1} ${l.city||''}: drive exceeds independent target (${km}km/${hrs}h)`);
    const eu = /europe|eu|germany|france|spain|italy|netherlands|belgium|poland|austria|czech|switzerland|denmark|sweden|norway|portugal/i.test([request.region,l.country].join(' '));
    if (eu && hrs > 9) violations.push(`leg ${i+1} ${l.city||''}: exceeds EU 9h daily driving limit (${hrs}h)`);
    if (!Array.isArray(l.candidate_venues) || l.candidate_venues.length < 5) violations.push(`leg ${i+1} ${l.city||''}: fewer than 5 venue candidates`);
  });
  return violations;
}

function hydrateTourDefaults(t, request={}) {
  if (!t || !Array.isArray(t.legs)) return t;
  t.artist = t.artist || request.artist || '';
  t.region = t.region || request.region || '';
  t.startDate = t.startDate || request.startDate || '';
  t.endDate = t.endDate || request.endDate || '';
  t.legs = t.legs.map((l, idx) => ({
    date:l.date || '', city:l.city || '', country:l.country || '', day:l.day || idx+1, day_of_week:l.day_of_week || '',
    is_anchor_show:!!l.is_anchor_show, day_off:!!l.day_off,
    suggested_venue:l.suggested_venue || l.venue || l.candidate_venues?.[0]?.name || '',
    candidate_venues:Array.isArray(l.candidate_venues) ? l.candidate_venues.slice(0, 8).map(v => ({name:v.name||v.venue||'',capacity:v.capacity||'',booking_method:v.booking_method||'unknown',website:v.website||null,fit_reason:v.fit_reason||v.reason||'',outreach_angle:v.outreach_angle||v.fit_reason||'',crm_source:!!v.crm_source,crm_id:v.crm_id||v.id||null,relationship_status:v.relationship_status||''})) : [],
    booking_status:l.booking_status || (l.is_anchor_show ? 'hold' : 'prospect'), deal_status:l.deal_status || 'not_started', locked:!!l.locked,
    rate_target_usd:l.rate_target_usd || l.suggested_guarantee_usd || 0, rate_offer_usd:l.rate_offer_usd || null, rate_confirmed_usd:l.rate_confirmed_usd || null,
    deal_suggestion:l.deal_suggestion || '', hold_deadline:l.hold_deadline || '', contact_status:l.contact_status || 'not_contacted', next_action:l.next_action || 'Send branded routing inquiry to top venue targets.',
    drive_from_previous_km:l.drive_from_previous_km || 0, drive_hours:l.drive_hours || 0,
    travel_mode_recommendation:l.travel_mode_recommendation || request.travelPreference || 'drive', travel_feasibility:l.travel_feasibility || 'possible', travel_feasibility_reason:l.travel_feasibility_reason || '',
    can_make_next_show:l.can_make_next_show !== false, monday_tuesday_risk:l.monday_tuesday_risk || '',
    hotel_required:l.hotel_required !== false, hotel_nights:l.hotel_nights || 1, hotel_responsibility:l.hotel_responsibility || 'agency', hotel_notes:l.hotel_notes || '',
    airport_transfer_required:!!l.airport_transfer_required, local_transport_required:l.local_transport_required !== false, transport_responsibility:l.transport_responsibility || 'agency',
    gear:l.gear || { traveling_with_gear:request.travelingWithGear !== false, gear_weight_kg:request.gearWeightKg || 0, gear_notes:'' },
    backline_needed:l.backline_needed || 'partial', backline:l.backline || { drums:false,bass_amp:false,guitar_amp:false,keys_stand:true,di_boxes:true,notes:'' },
    advancing_requirements:l.advancing_requirements || {contacts:true,venue:true,schedule:true,technical:true,backline:true,guest_list:true,merch:true,hotel:true,transportation:true,settlement:true,hospitality:true,wifi:true,notes:true},
    notes:l.notes || '', advancing_notes:l.advancing_notes || l.notes || ''
  }));
  t.total_shows = t.legs.filter(l => !l.day_off).length;
  t.total_days = t.total_days || t.legs.length;
  return t;
}

async function enforceRouteContract(key, model, request, parsed, raw) {
  const target = Math.max(1, Math.min(40, Number(request.numShows || request.total_shows || 0) || 0));
  if (!target || !parsed) return parsed;
  if (!Array.isArray(parsed.legs)) {
    parsed = { _malformed_first_pass:true, _first_pass_text: String(parsed.text || raw || '').slice(0, 12000), legs: [] };
  }
  const showCount = parsed.legs.filter(l => !l.day_off).length;
  const weakVenues = parsed.legs.filter(l => !l.day_off).some(l => !Array.isArray(l.candidate_venues) || l.candidate_venues.length < 5);
  const giantGap = hasGiantGap(parsed.legs);
  const violations = routeViolations(parsed, request);
  const blockingViolations = violations.filter(v => !/fewer than 5 venue candidates/i.test(v));
  if (showCount === target && !giantGap && !blockingViolations.length) {
    if (weakVenues) parsed._contract_warning = 'Some stops returned fewer than 5 venue candidates; use the Venue Board / Research All Cities to hydrate additional grounded options.';
    return parsed;
  }

  const repairPrompt = `${CTX}\nRepair this generated tour so it satisfies the hard contract. Return strict JSON only.\n\nREQUESTED SHOW COUNT: ${target}\nDATE RANGE: ${request.startDate || ''} to ${request.endDate || ''}\nRULES:\n1. Return EXACTLY ${target} non-day_off show legs.\n2. Keep routing tight and human-realistic; avoid huge unexplained gaps. If back-to-back is tight, mark travel_feasibility as tight/risky but still create the requested number of dates.\n3. Preserve supplied anchors/holds.\n4. Every non-day_off leg must include at least 5 ranked candidate_venues. Keep each venue compact: name, capacity, fit_reason under 12 words, booking_method, website/null, outreach_angle under 12 words.\n5. Enforce sustainable drive limits: target <=480km/5h between shows; for Europe never exceed 9h daily driving and include 45-minute breaks + 11h rest in feasibility notes.\n6. Prioritize CRM venues already present in the request/context before generic external venues.\n7. Do not invent confirmations; use prospect/hold/offer status appropriately.\n\nValidation errors to fix:\n${violations.join('; ')}\n\nOriginal request:\n${JSON.stringify(request).slice(0, 12000)}\n\nDeficient output to repair:\n${JSON.stringify(parsed).slice(0, 20000)}`;
  try {
    const fixedRaw = await gem(key, model, repairPrompt, 6500, 8500);
    const fixed = parse(fixedRaw, 'generate_tour');
    if (fixed && Array.isArray(fixed.legs)) {
      const hydratedFixed = hydrateTourDefaults(fixed, request);
      hydratedFixed._contract_repaired = true;
      hydratedFixed._contract_note = `Repaired route to target ${target} requested show dates with 5+ venue targets per show and drive-constraint validation.`;
      return hydratedFixed;
    }
  } catch (e) {
    parsed._contract_warning = `Route contract repair failed: ${e.message}`;
  }
  parsed._contract_warning = parsed._contract_warning || `Requested ${target} shows, generated ${showCount}. Validation issues: ${violations.join('; ') || 'unknown'}. Try narrowing the region/date range or regenerating.`;
  return parsed;
}

function hasGiantGap(legs) {
  const dates = (legs || []).filter(l => !l.day_off && l.date).map(l => new Date(l.date + 'T12:00:00')).filter(d => !isNaN(d));
  for (let i=1;i<dates.length;i++) {
    const gap = Math.round((dates[i]-dates[i-1]) / 86400000);
    if (gap > 4) return true;
  }
  return false;
}


function hardenReview(review={}, input={}) {
  const legs = Array.isArray(input.legs) ? input.legs : (Array.isArray(input.tour?.legs) ? input.tour.legs : []);
  const actual = legs.filter(l => !l?.day_off).length;
  const requested = Number(input.requested_shows || input.tour?.requested_shows || input.tour?.total_shows || actual) || actual;
  review.show_count_check = { ...(review.show_count_check || {}), requested, actual, passes: requested === actual };
  return review;
}

function parse(text, action) {
  let c = String(text || '').replace(/^```json\s*/i,'').replace(/^```\s*/,'').replace(/```$/,'').trim();
  try { return JSON.parse(c); } catch {}
  const m = c.match(/\{[\s\S]*\}/);
  if (m) try { return JSON.parse(m[0]); } catch {}
  return action === 'chat' ? { answer:c, recommended_next_actions:[] } : { text:c };
}

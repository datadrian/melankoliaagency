# Melankolia Agency Route Planner / Booking Ops System — Deep Agent Handoff

Generated: 2026-06-27
Prepared for: Adrian Stucker / Melankolia Agency
Purpose: provide another AI agent or developer with enough context to refine the routing, booking, advancing, and band-facing workflow without breaking the existing system.

This document is intentionally detailed. It describes the current architecture, data flow, AI prompt/workflow design, deployed files, operational constraints, current UX, and refinement targets.

---

## 1. Executive Summary

Melankolia Agency is building an internal tour planning and booking operations system inside the existing Netlify-hosted Melankolia website/admin environment.

The system is not meant to “automatically book tours.” It models the real booking workflow:

1. Build a compact but realistic route around dates, regions, artists, travel constraints, holds, and anchor shows.
2. Ensure the generated route returns the exact requested number of real show dates.
3. Attach multiple ranked venue prospects per city.
4. Run a second AI oversight pass to judge if the route is reasonable for human performers on a schedule.
5. Let the booking operator iterate with AI tools: optimize route, estimate budget, analyze anchors, find venues, advise deals, and generate outreach.
6. Save the route to Firestore.
7. Saving creates linked show records for the Advancing system.
8. Advancing sends or exposes promoter-facing custom form links.
9. Promoter submissions sync back into linked route legs.
10. Approved/published advancing data appears in the Band App.

The important philosophical point: this is a mission-critical operations tool for real working musicians and booking staff. The AI must never treat “tour dates” as abstract calendar filler. If Adrian requests 10 shows, the generated plan must contain 10 non-day-off show legs unless explicitly impossible — and even then it should mark risk, not silently reduce the count.

---

## 2. Non-Negotiable Project Constraints

These constraints are standing rules for any future agent/developer:

- Hosting is Netlify only.
- Deployments should be direct Netlify zip/API deploys, not GitHub-triggered builds.
- Static public site, admin tools, and serverless functions must be deployed as one coordinated package to avoid overwriting current work with stale root `public/` bundles.
- Keep all API keys in Netlify functions/environment variables. Never expose keys in frontend JS.
- Use Gemini 3-series models for AI planning where configured.
- Keep Route Planner portable: Netlify + Firestore + serverless functions, not Base44 entities.
- Keep internal tooling separate from the public-facing static site.
- Preserve Melankolia’s dark premium luxury-tech aesthetic.
- Use logo mark branding, not wordmark, in admin/nav contexts.
- `/admin/` is password-protected with `melankolia2025`.
- Admin save buttons must explicitly use `type="button"` to avoid unintended page navigation.
- The front splash page / Three.js logo background is locked to milestone `logo-milestone-1` and must not be modified unless Adrian explicitly asks.

---

## 3. Primary Deployed Surfaces

### Public/admin URLs

- Main site: `https://melankoliaagency.com`
- Netlify fallback: `https://melankoliaagency.netlify.app`
- Admin dashboard: `/admin/`
- Route Planner: admin sidebar view rendered inside `/admin/`
- Advancing admin: admin sidebar view rendered inside `/admin/`
- Promoter advancing form: `/advancing/` with token-based show lookup/submission
- Band portal: `/band-app/`
- Venue Finder: `/venuefinder.html` and associated function `geminiSearch`

### Important frontend files

- `recovery_deploy/admin/index.html`
- `recovery_deploy/js/route-admin.js`
- `recovery_deploy/js/advancing-admin.js`
- `recovery_deploy/band-app/index.html`
- `recovery_deploy/advancing/index.html`
- `recovery_deploy/css/admin.css`

Equivalent working source copies are maintained under:

- `melankoliaagency/public/...`
- `public/...` in some cases for compatibility with older deploy bundles

The safest deploy package should use `recovery_deploy/` as the static directory plus `melankoliaagency/netlify/functions/` as functions.

---

## 4. Backend Functions

### `ai-tour.js`

Purpose: all AI route planning, route review, optimization, budget, venue suggestion, deal advice, and chat strategy.

Endpoint: `/.netlify/functions/ai-tour`

Actions currently supported:

- `generate_tour`
- `review_route`
- `analyze_anchors`
- `optimize_route`
- `estimate_budget`
- `suggest_venues`
- `advise_deal`
- `chat`

Core model variables:

- `FAST = process.env.GEMINI_FAST_MODEL || 'gemini-3.1-flash-lite'`
- `ROUTE = process.env.GEMINI_ROUTE_FAST_MODEL || process.env.GEMINI_ROUTE_MODEL_FAST || FAST`

Key behavior:

- `generate_tour` uses compact JSON with max output tokens 8192 and 18s timeout.
- Backend hydrates missing route logistics/deal fields programmatically via `hydrateTourDefaults()`.
- Backend enforces exact route contract via `enforceRouteContract()`.
- If first pass is malformed or has wrong show count / weak venue count / giant gaps, it attempts a repair pass.
- Function always returns JSON on errors so the frontend does not see raw Netlify/Gemini HTML errors when possible.

### `route-planner-api.js`

Purpose: Firestore CRUD and linking tours to show records.

Expected actions include:

- `listTours`
- `getTour`
- `createTour`
- `updateTour`
- `deleteTour` / archive behavior
- `updateStop`

Important current behavior:

- Saving a generated route can create show records.
- `updateStop` persists a leg edit into the Firestore tour document.
- If the leg has a linked show ID, `updateStop` also updates the matching show record so Advancing/Band App stay synced.

### `advancing-api.js`

Purpose: show-level advancing workflow.

Typical actions:

- agency/admin show listing and show update
- promoter token lookup
- promoter submit
- publish/approval style flows
- band app data access

Important current behavior:

- Promoter submissions sync hotel, transportation, backline, schedule, venue, and related information into show records.
- For linked route stops, promoter submissions also sync key logistics back to the related route leg.
- Per-show `advancing_requirements` controls what sections the promoter form displays.

### `email-generator.js`

Purpose: branded Melankolia venue outreach email generation.

Current behavior:

- Generates subject, plain text, HTML.
- HTML includes dark Melankolia styling.
- HTML references live logo mark: `https://melankoliaagency.com/images/logo-mark-white.svg`.
- Used by route stop email buttons and per-venue candidate outreach.

### `geminiSearch.js`

Purpose: Grounded Venue Finder / promoter finder search pipeline.

Current behavior:

- Used by Venue Finder and Route Planner’s grounded venue research.
- Route Admin calls it via `VENUE_FINDER_API = '/.netlify/functions/geminiSearch'`.
- “Research Venues All Stops” loops stops and attaches grounded `candidate_venues` to each stop.

---

## 5. Data Model — Tour

A tour document generally contains:

- `id`
- `name` / `tour_name`
- `artist`
- `region`
- `startDate`
- `endDate`
- `status`
- `summary`
- `routing_strategy`
- `anchor_strategy`
- `travel_strategy`
- `total_days`
- `total_shows`
- `estimated_total_km`
- `legs[]`
- `route_review` from second-pass AI oversight
- timestamps / archival fields depending on Firestore implementation

### Tour leg / stop fields

Each non-day-off show leg should contain:

- `date`, `city`, `country`, `day`, `day_of_week`
- `is_anchor_show`, `day_off`, `suggested_venue`, `candidate_venues[]`
- `booking_status`, `deal_status`, `locked`
- `rate_target_usd`, `rate_offer_usd`, `rate_confirmed_usd`
- `deal_suggestion`, `hold_deadline`, `contact_status`, `next_action`
- `drive_from_previous_km`, `drive_hours`
- `travel_mode_recommendation`, `travel_feasibility`, `travel_feasibility_reason`
- `can_make_next_show`, `monday_tuesday_risk`
- `hotel_required`, `hotel_nights`, `hotel_responsibility`, `hotel_notes`
- `airport_transfer_required`, `local_transport_required`, `transport_responsibility`
- `gear`, `backline_needed`, `backline`
- `advancing_requirements`, `notes`, `advancing_notes`
- linked show ID fields depending on route-planner-api implementation

### Candidate venue fields

Each candidate venue should contain:

- `name`
- `capacity`
- `booking_method`
- `website`
- `fit_reason`
- `outreach_angle`

When attached from grounded Venue Finder, candidate venues may also include:

- `booking_form_url`
- `email`
- `instagram`
- `confidence_score`
- `verification_sources[]`

Candidate venues are prospects, not confirmed venues, unless the stop is an explicit anchor/hold supplied by the user.

---

## 6. Data Model — Show / Advancing

A saved route can create linked show records.

Show records typically include:

- `id`, `artist`, `date`, `city`, `country`
- `venue_name`, `venue_address`, `status`, `promoter_token`
- `route_id`, `route_leg_index`
- `advancing_requirements`
- `advancing` or submitted sheet data
- logistics fields mirrored from route leg:
  - hotel responsibility
  - transport responsibility
  - airport transfer requirement
  - backline need
  - rate/deal/booking status

Promoter-facing form submissions are written to the show and then reflected back into the route where linked.

---

## 7. Route Generation Workflow

The workflow from the admin UI:

1. User opens Route Planner in `/admin/`.
2. User creates a new tour plan.
3. User fills core fields: artist, tour name, region, show count, start city, end city, dates, deal type.
4. User fills travel/gear profile: party size, gear weight, travel preference, traveling with gear, backline/hotel/transport assumptions.
5. User may add anchor shows: `City | Date | Venue | Deal | Status`.
6. Frontend calls `ai-tour` with action `generate_tour`.
7. Backend prompt instructs Gemini to return exact compact JSON.
8. Backend hydrates defaults.
9. Backend enforces the route contract.
10. Frontend renders route legs.
11. Frontend automatically runs `review_route` second-pass oversight.
12. User reviews AI oversight verdict and suggested actions.
13. User can optimize, budget, research venues, edit stops, generate emails, or save.
14. Saving creates Firestore tour + linked shows.

---

## 8. Exact Show Count Contract

This was added after a failure mode where a 10-stop request produced only 5 shows spread across a long date range.

Current contract:

- Requested `numShows=N` means exactly N non-day-off show legs.
- `total_shows` must equal requested show count.
- The model must not confuse date range length with show count.
- If routing is tight, mark risk rather than silently reducing stops.
- Huge unexplained gaps should be avoided.
- Backend checks: non-day-off show count, venue candidate count per show, giant gaps between show dates.
- Repair pass attempts to fix deficient output.

Live smoke test performed:

- Request: 10-stop Europe route, Sep 1–14, Berlin to Amsterdam.
- Result: 10 non-day-off show legs.
- Every stop had exactly 5 candidate venues.
- Valid JSON.
- Branded email generation tested successfully.

---

## 9. AI Oversight Workflow

After generation, the frontend automatically calls `review_route`.

Purpose:

- act like a second booking strategist / tour director
- review the plan before outreach
- identify unrealistic routing
- detect missing venue readiness
- ensure show count matches request
- produce actionable next steps

Expected `review_route` output shape:

```json
{
  "verdict": "greenlight|needs_changes|risky|reject",
  "score": 0,
  "summary": "",
  "show_count_check": { "requested": 10, "actual": 10, "passes": true },
  "schedule_pressure": "tight|reasonable|loose|bad",
  "major_risks": [{ "severity": "low|medium|high", "leg_index": 0, "city": "", "issue": "", "fix": "" }],
  "unrealistic_gaps": [],
  "venue_readiness": { "all_stops_have_5_targets": true, "missing": [] },
  "recommended_changes": [{ "label": "", "reason": "", "action": "", "leg_index": 0, "payload": {} }],
  "suggested_actions": [{ "label": "", "action": "", "leg_index": 0, "payload": {} }]
}
```

Supported action values:

- `optimize_route`
- `estimate_budget`
- `research_venues_all`
- `venue_finder_stop`
- `open_stop`
- `generate_email_stop`
- `analyze_anchors`
- `save_tour`

Frontend maps those directly to UI actions.

---

## 10. Ask Booking AI — Actionable Output

The Booking AI chat now returns structured actions, not just text.

Prompt output shape:

```json
{
  "answer": "",
  "recommended_next_actions": [],
  "suggested_actions": [
    {
      "label": "",
      "action": "optimize_route|estimate_budget|research_venues_all|venue_finder_stop|open_stop|generate_email_stop|analyze_anchors|save_tour",
      "leg_index": null,
      "payload": {}
    }
  ]
}
```

Frontend renders `suggested_actions` as buttons.

Current action mapper:

- `optimize_route` → `optimizeCurrent()`
- `estimate_budget` → `estimateBudget()`
- `research_venues_all` → `researchVenuesAllStops()`
- `venue_finder_stop` → `venueFinderForStop(idx)`
- `open_stop` → `openStop(idx)`
- `generate_email_stop` → `generateEmail(idx)`
- `analyze_anchors` → `analyzeCurrentAnchors()`
- `save_tour` → `saveGenerated()`

---

## 11. Venue Research Workflow

There are two tiers of venue suggestions:

### Tier 1: Generated candidate venues

The compact route generation includes 5 ranked candidate venues per stop.

These are useful for route shaping and first-pass outreach planning, but should be treated as prospects.

### Tier 2: Grounded Venue Finder

The route admin UI has:

- per-stop `Venue Finder`
- global `Research Venues All Stops`

These call `/.netlify/functions/geminiSearch` and attach grounded candidates to the stop.

### Per-candidate actions

Each candidate venue in Stop Detail exposes:

- `Use Venue`
- `Branded Email`
- `Site` if website exists

`Use Venue` updates the stop’s `suggested_venue` and persists if the tour is saved.

`Branded Email` generates a Melankolia letterhead outreach email for that exact candidate.

---

## 12. Email Generation Workflow

Route Admin calls `/.netlify/functions/email-generator`.

Payload includes artist, tour, city, country, selected venue, venueData, date, deal suggestion, target rate, and travel mode.

Generated output:

- subject
- plain text
- HTML
- preview

HTML letterhead includes dark background, Melankolia Agency label, logo mark, artist routing inquiry heading, venue/city/date metadata, and professional booking copy.

---

## 13. Stop Editing + Firestore Sync

Stop Detail includes editable fields such as venue, booking status, deal status, locked flag, rates, hold deadline, contact status, travel mode, travel feasibility, hotel responsibility, transport responsibility, backline need, and notes.

When user saves stop edits:

- if route is a draft not saved to Firestore, it updates the in-memory generated route.
- if route has an ID, frontend calls `route-planner-api.updateStop`.
- backend updates tour leg.
- backend updates linked show record if present.

---

## 14. Advancing Workflow

Advancing admin exposes show-level controls.

For each show, admin can configure `advancing_requirements` toggles:

- contacts
- venue details
- schedule
- sound/technical
- backline
- guest list
- merch
- hotel/lodging
- transportation
- settlement
- hospitality/catering
- Wi-Fi
- notes

The public promoter-facing advancing page reads the show by token and applies `advancing_requirements`.

Sections disabled by the admin are hidden and their fields are not required.

Added transportation fields:

- who handles local transport
- airport/station pickup yes/no/TBD
- pickup time
- transportation notes

Added hotel responsibility fields:

- who covers hotel
- rooms/nights
- hotel notes

Promoter submission updates show record, linked route leg logistics, and publishable Band App data.

---

## 15. Band App Workflow

The Band App reads published/approved advancing show data.

It displays date, city/country, venue, status, schedule, contacts, sound/backline, guest list, merch, settlement, accommodation, transportation, catering/hospitality, Wi-Fi, parking, green room, and travel plan summary.

Travel plan summary includes recommended mode, feasibility, hotel responsibility, airport transfer status, and backline need.

---

## 16. Current AI Prompt Architecture — Summary

The AI architecture is multi-pass:

### Pass 1 — Generate Route

Role: senior underground booking strategist.

Goals: exact show count, tight realistic routing, candidate venues, booking pipeline defaults, logistics awareness.

### Pass 2 — Enforce Contract / Repair

Backend logic checks output. If malformed, wrong show count, fewer than 5 venues per stop, or giant gaps, it asks the model to repair output.

### Pass 3 — Oversight Review

After route is displayed, frontend calls `review_route`.

Role: second-pass tour director.

Goals: sanity-check plan, identify risk, provide score/verdict, produce actionable next steps.

### Iteration Tools

- `analyze_anchors`
- `optimize_route`
- `estimate_budget`
- `suggest_venues`
- `advise_deal`
- `chat`

The chat/action system is now structured so AI recommendations can become UI buttons.

---

## 17. Current Known Refinement Targets

Recommended next improvements for another agent:

1. Improve date compression logic further.
2. Improve geographical realism with Google Routes API path/duration data.
3. Make venue candidates more grounded by default.
4. Build bulk branded email queue/export workflow.
5. Add deal pipeline Kanban.
6. Add true calendar/workload awareness.
7. Audit Firestore security and token permissions.
8. Add versioned route revisions.
9. Add email send integration with explicit approval.
10. Harden Band App authentication/user management.

---

## 18. Critical Deployment Notes

Direct Netlify deployment command pattern used in this project:

```bash
NETLIFY_AUTH_TOKEN="$NETLIFY_TOKEN" npx netlify deploy \
  --prod \
  --site 9554992e-4906-4737-b3db-5673a911c542 \
  --dir=/app/recovery_deploy \
  --functions=/app/melankoliaagency/netlify/functions \
  --skip-functions-cache \
  --message "deployment message"
```

Why this matters:

- GitHub-triggered deployments have previously overwritten restored public/admin files with stale bundles.
- Zip/API deploys keep static files and Netlify functions aligned.
- Always verify live markers after deploy, e.g. cache-busted JS query versions.

---

## 19. Embedded Source Snapshots

### 19.1 `melankoliaagency/netlify/functions/ai-tour.js`

```javascript
const { json } = require('./_firebase');

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
    const p = prompt(action, data);
    const maxOutputTokens = action === 'generate_tour' ? 8192 : 3072;
    const out = await gem(key, model, p, maxOutputTokens, action === 'generate_tour' ? 18000 : 24000);
    let dataOut = parse(out, action);
    if (action === 'generate_tour') dataOut = await enforceRouteContract(key, model, data, hydrateTourDefaults(dataOut, data), out);
    return json(200, { success:true, data:dataOut, raw:out, model });
  } catch (err) {
    // Always return JSON so the frontend never sees "Invalid JSON response" for backend failure.
    return json(200, { success:false, error:err.name === 'AbortError' ? 'AI route generation timed out. Try fewer target shows or more specific anchors.' : err.message, model });
  }
};

function prompt(action, d) {
  if (action === 'generate_tour') return `${CTX}
Generate a practical compact route draft as STRICT MINIFIED JSON. HARD REQUIREMENTS:
- Requested numShows=N means EXACTLY N non-day_off show legs. Never return fewer.
- Humans are on a real schedule and may have taken off work: keep the tour manageable but as tight as possible. Avoid giant dead gaps.
- total_shows must equal requested numShows.
- Every show leg must include at least 5 candidate_venues ranked strongest to weakest. Keep each compact.
- Candidate venues are outreach targets/prospects, not confirmations unless supplied as anchors.

Return only this compact shape; omit extra prose:
{"tour_name":"","name":"","artist":"","region":"","startDate":"","endDate":"","routing_strategy":"","anchor_strategy":"","summary":"","travel_strategy":"","total_days":0,"total_shows":0,"estimated_total_km":0,"legs":[{"date":"YYYY-MM-DD","city":"","country":"","day":1,"day_of_week":"","is_anchor_show":false,"day_off":false,"suggested_venue":"","candidate_venues":[{"name":"","capacity":"","booking_method":"unknown","website":null,"fit_reason":"","outreach_angle":""}],"booking_status":"prospect","deal_status":"not_started","drive_hours":0,"drive_from_previous_km":0,"travel_feasibility":"possible","hotel_responsibility":"agency","backline_needed":"partial","deal_suggestion":"","next_action":"","notes":""}]}
Inputs: ${JSON.stringify(d).slice(0, 10000)}`;

  if (action === 'analyze_anchors') return `${CTX}\nAnalyze anchors/holds/confirmed stops. Return JSON {overall_verdict, verdict_summary, gap_analysis:[{between,issue,opportunity,fill_cities,next_action}], weak_holds:[{city,date,reason,deadline_recommendation}], missing_markets:[], routing_risks:[], recommended_next_actions:[]}. Inputs: ${JSON.stringify(d).slice(0, 10000)}`;
  if (action === 'review_route') return `${CTX}\nAct as a second-pass tour director reviewing a generated plan before the agency sends emails. Decide whether the plan is reasonable for real humans on a schedule. Return JSON {verdict:'greenlight|needs_changes|risky|reject',score:0-100,summary:'',show_count_check:{requested,actual,passes},schedule_pressure:'tight|reasonable|loose|bad',major_risks:[{severity:'low|medium|high',leg_index,city,issue,fix}],unrealistic_gaps:[],venue_readiness:{all_stops_have_5_targets:true,missing:[]},recommended_changes:[{label,reason,action,leg_index,payload}],suggested_actions:[{label,action,leg_index,payload}]}. Supported action values: optimize_route, estimate_budget, research_venues_all, venue_finder_stop, open_stop, generate_email_stop, analyze_anchors, save_tour. Inputs: ${JSON.stringify(d).slice(0, 14000)}`;
  if (action === 'optimize_route') return `${CTX}\nOptimize route order and stop pipeline without losing booking status. Return {optimized_legs,routing_notes,total_km_estimate,tradeoffs,next_actions,suggested_actions:[{label,action,leg_index,payload}]}. Supported action values: estimate_budget, research_venues_all, venue_finder_stop, open_stop, generate_email_stop, analyze_anchors. Inputs: ${JSON.stringify(d).slice(0, 12000)}`;
  if (action === 'estimate_budget') return `${CTX}\nEstimate budget from route, deal pipeline, hotels, flights/trains/vans, airport transfers, gear/backline needs, and promoter-covered costs. Return JSON {revenue:{},expenses:{},net_profit_loss,break_even_guarantee_per_show,is_viable,high_risk_stops:[],savings_tips:[],deal_notes:[],suggested_actions:[{label,action,leg_index,payload}]}. Supported action values: advise_deal, open_stop, research_venues_all, optimize_route. Inputs: ${JSON.stringify(d).slice(0, 12000)}`;
  if (action === 'suggest_venues') return `${CTX}\nSuggest underground venue/promoter options for this city. Return {venues:[{name,capacity,type,known_for,booking_method,booking_contact_tip,deal_type_typical,tier,fit_reason,next_action}]}. Inputs: ${JSON.stringify(d).slice(0, 10000)}`;
  if (action === 'advise_deal') return `${CTX}\nEvaluate the deal/offer. Return {offer_assessment, market_rate_range, counter_suggestion, negotiation_points, additional_asks, accept_if, walk_away_if, next_action}. Inputs: ${JSON.stringify(d).slice(0, 10000)}`;
  if (action === 'chat') return `${CTX}\nAnswer as a booking strategist, but make useful suggestions actionable. Return JSON {answer:'',recommended_next_actions:[''],suggested_actions:[{label:'',action:'optimize_route|estimate_budget|research_venues_all|venue_finder_stop|open_stop|generate_email_stop|analyze_anchors|save_tour',leg_index:null,payload:{}}]}. Only include actions that map to a real next click; if no tool applies, use recommended_next_actions only. Inputs: ${JSON.stringify(d).slice(0, 12000)}`;
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
    candidate_venues:Array.isArray(l.candidate_venues) ? l.candidate_venues.slice(0, 8).map(v => ({name:v.name||v.venue||'',capacity:v.capacity||'',booking_method:v.booking_method||'unknown',website:v.website||null,fit_reason:v.fit_reason||v.reason||'',outreach_angle:v.outreach_angle||v.fit_reason||''})) : [],
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
  if (showCount === target && !weakVenues && !giantGap) return parsed;

  const repairPrompt = `${CTX}\nRepair this generated tour so it satisfies the hard contract. Return strict JSON only.\n\nREQUESTED SHOW COUNT: ${target}\nDATE RANGE: ${request.startDate || ''} to ${request.endDate || ''}\nRULES:\n1. Return EXACTLY ${target} non-day_off show legs.\n2. Keep routing tight and human-realistic; avoid huge unexplained gaps. If back-to-back is tight, mark travel_feasibility as tight/risky but still create the requested number of dates.\n3. Preserve supplied anchors/holds.\n4. Every non-day_off leg must include at least 5 ranked candidate_venues. Keep each venue compact: name, capacity, fit_reason under 12 words, booking_method, website/null, outreach_angle under 12 words.\n5. Do not invent confirmations; use prospect/hold/offer status appropriately.\n\nOriginal request:\n${JSON.stringify(request).slice(0, 12000)}\n\nDeficient output to repair:\n${JSON.stringify(parsed).slice(0, 20000)}`;
  try {
    const fixedRaw = await gem(key, model, repairPrompt, 8192, 18000);
    const fixed = parse(fixedRaw, 'generate_tour');
    if (fixed && Array.isArray(fixed.legs)) {
      const hydratedFixed = hydrateTourDefaults(fixed, request);
      hydratedFixed._contract_repaired = true;
      hydratedFixed._contract_note = `Repaired route to target ${target} requested show dates with 5+ venue targets per show.`;
      return hydratedFixed;
    }
  } catch (e) {
    parsed._contract_warning = `Route contract repair failed: ${e.message}`;
  }
  parsed._contract_warning = parsed._contract_warning || `Requested ${target} shows, generated ${showCount}. Try narrowing the region/date range or regenerating.`;
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

function parse(text, action) {
  let c = String(text || '').replace(/^```json\s*/i,'').replace(/^```\s*/,'').replace(/```$/,'').trim();
  try { return JSON.parse(c); } catch {}
  const m = c.match(/\{[\s\S]*\}/);
  if (m) try { return JSON.parse(m[0]); } catch {}
  return action === 'chat' ? { answer:c, recommended_next_actions:[] } : { text:c };
}
```

---

### 19.2 `melankoliaagency/netlify/functions/route-planner-api.js`

```javascript
const { listDocs, getDoc, createDoc, updateDoc, json } = require('./_firebase');

const TOURS = 'route_planner_tours';
const SHOWS = 'route_planner_shows';
const now = () => new Date().toISOString();
const id = p => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { success:false, error:'POST only' });

  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch { return json(400, { success:false, error:'Invalid JSON' }); }

  try {
    const a = b.action;

    if (a === 'listTours') {
      const tours = (await listDocs(TOURS)).filter(x => !x.deleted_at);
      return json(200, { success:true, data:tours });
    }

    if (a === 'getTour') {
      const t = await getDoc(TOURS, b.id);
      if (!t || t.deleted_at) return json(404, { success:false, error:'Tour not found' });
      const shows = (await listDocs(SHOWS, { orderBy:'date' })).filter(x => x.tour_id === b.id && !x.deleted_at);
      return json(200, { success:true, data:{ ...t, shows } });
    }

    if (a === 'createTour') {
      const tid = b.id || id('tour');
      const d = b.tour || {};
      const doc = await createDoc(TOURS, { ...d, status:d.status || 'draft', created_at:now(), updated_at:now() }, tid);
      if (b.createShows !== false && Array.isArray(d.legs)) await createShows(tid, doc, d.legs);
      return json(200, { success:true, data:doc });
    }

    if (a === 'updateTour') {
      const cur = await getDoc(TOURS, b.id);
      if (!cur) return json(404, { success:false, error:'Tour not found' });
      const doc = await updateDoc(TOURS, b.id, { ...cur, ...(b.updates || {}), updated_at:now() });
      if (b.replaceShows && Array.isArray(doc.legs)) {
        const old = (await listDocs(SHOWS, { orderBy:'date' })).filter(s => s.tour_id === b.id && !s.deleted_at);
        await Promise.all(old.map(s => updateDoc(SHOWS, s.id, { ...s, deleted_at:now(), updated_at:now() })));
        await createShows(b.id, doc, doc.legs);
      }
      return json(200, { success:true, data:doc });
    }

    if (a === 'updateStop') {
      const tourId = b.tour_id || b.id;
      const idx = Number(b.leg_index);
      const leg = b.leg || {};
      const cur = await getDoc(TOURS, tourId);
      if (!cur) return json(404, { success:false, error:'Tour not found' });
      const legs = Array.isArray(cur.legs) ? [...cur.legs] : [];
      if (!Number.isInteger(idx) || idx < 0 || idx >= legs.length) return json(400, { success:false, error:'Invalid leg index' });
      legs[idx] = { ...legs[idx], ...leg, updated_at:now() };
      const tour = await updateDoc(TOURS, tourId, { ...cur, legs, updated_at:now() });

      const shows = (await listDocs(SHOWS, { orderBy:'date' })).filter(s => s.tour_id === tourId && Number(s.leg_index) === idx && !s.deleted_at);
      let show = null;
      if (shows[0]) show = await updateDoc(SHOWS, shows[0].id, { ...shows[0], ...showFromLeg(tourId, tour, legs[idx], idx), updated_at:now() });
      return json(200, { success:true, data:{ tour, show } });
    }

    if (a === 'deleteTour') {
      const t = await getDoc(TOURS, b.id);
      if (t) await updateDoc(TOURS, b.id, { ...t, deleted_at:now(), updated_at:now() });
      const oldShows = (await listDocs(SHOWS, { orderBy:'date' })).filter(s => s.tour_id === b.id && !s.deleted_at);
      await Promise.all(oldShows.map(s => updateDoc(SHOWS, s.id, { ...s, deleted_at:now(), updated_at:now() })));
      return json(200, { success:true, archived_shows:oldShows.length });
    }

    if (a === 'duplicateTour') {
      const t = await getDoc(TOURS, b.id);
      if (!t) return json(404, { success:false, error:'Tour not found' });
      const copy = { ...t, name:(t.name || t.tour_name || 'Untitled Tour') + ' (copy)', status:'draft', source_tour_id:b.id, created_at:now(), updated_at:now() };
      delete copy.id; delete copy.deleted_at;
      const doc = await createDoc(TOURS, copy, id('tour'));
      if (Array.isArray(copy.legs)) await createShows(doc.id, doc, copy.legs);
      return json(200, { success:true, data:doc });
    }

    return json(400, { success:false, error:'Unknown action' });
  } catch (err) {
    return json(500, { success:false, error:err.message });
  }
};

async function createShows(tour_id, tour, legs) {
  await Promise.all(legs.filter(l => !l.day_off).map((l, i) => createDoc(SHOWS, showFromLeg(tour_id, tour, l, i), id('show'))));
}

function showFromLeg(tour_id, tour, l, i) {
  return {
    tour_id,
    tour_name: tour.name || tour.tour_name || '',
    artist: tour.artist || '',
    band_ids: tour.band_ids || [],
    leg_index: i,
    date: l.date || '',
    city: l.city || '',
    country: l.country || '',
    venue_name: l.suggested_venue || l.venue || '',
    venue_address: l.venue_address || '',
    status: l.show_status || l.advancing_status || 'draft',
    booking_status: l.booking_status || 'prospect',
    deal_status: l.deal_status || 'not_started',
    locked: !!l.locked,
    deal_suggestion: l.deal_suggestion || '',
    rate_target_usd: l.rate_target_usd || l.suggested_guarantee_usd || 0,
    rate_offer_usd: l.rate_offer_usd || null,
    rate_confirmed_usd: l.rate_confirmed_usd || null,
    hold_deadline: l.hold_deadline || '',
    contact_status: l.contact_status || 'not_contacted',
    next_action: l.next_action || '',
    candidate_venues: l.candidate_venues || [],
    travel: l.travel || {},
    lodging: l.lodging || {},
    gear: l.gear || {},
    backline: l.backline || {},
    transport: l.transport || {},
    advancing_requirements: l.advancing_requirements || defaultAdvancingRequirements(),
    drive_from_previous_km: l.drive_from_previous_km || 0,
    drive_hours: l.drive_hours || 0,
    travel_mode_recommendation: l.travel_mode_recommendation || '',
    travel_feasibility: l.travel_feasibility || '',
    hotel_required: !!l.hotel_required,
    hotel_responsibility: l.hotel_responsibility || '',
    airport_transfer_required: !!l.airport_transfer_required,
    backline_needed: l.backline_needed || '',
    advancing_notes: l.advancing_notes || l.notes || '',
    is_anchor_show: !!l.is_anchor_show,
    created_at: l.created_at || now(),
    updated_at: now()
  };
}

function defaultAdvancingRequirements() {
  return { contacts:true, venue:true, schedule:true, technical:true, backline:true, guest_list:true, merch:true, hotel:true, transportation:true, settlement:true, hospitality:true, wifi:true, notes:true };
}
```

---

### 19.3 `melankoliaagency/netlify/functions/advancing-api.js`

```javascript
const crypto = require('crypto');
const { listDocs, getDoc, createDoc, updateDoc, json } = require('./_firebase');

const SHOWS='route_planner_shows', TOURS='route_planner_tours', BANDS='route_planner_bands', NOTIFS='route_planner_notifications';
const now = () => new Date().toISOString();
const id = p => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
const token = () => crypto.randomBytes(18).toString('hex');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { success:false, error:'POST only' });
  let b={}; try { b=JSON.parse(event.body || '{}'); } catch { return json(400,{success:false,error:'Invalid JSON'}); }

  try {
    const a=b.action;

    if (a==='agency_get_dashboard') {
      const [shows,tours,bands,notifications] = await Promise.all([list(SHOWS),list(TOURS),list(BANDS),list(NOTIFS)]);
      const counts={}; shows.forEach(s=>counts[s.status||'draft']=(counts[s.status||'draft']||0)+1);
      const unreadByShow={}; notifications.filter(n=>!n.resolved&&n.show_id).forEach(n=>unreadByShow[n.show_id]=(unreadByShow[n.show_id]||0)+1);
      shows.forEach(s=>{ if(unreadByShow[s.id]) s._pending_notifications=unreadByShow[s.id]; });
      return json(200,{success:true,data:{shows,tours,bands,notifications,counts}});
    }
    if (a==='agency_list_tours') return json(200,{success:true,data:await list(TOURS)});
    if (a==='agency_list_bands') return json(200,{success:true,data:await list(BANDS)});

    if (a==='agency_get_show') {
      const show=await getDoc(SHOWS,b.show_id);
      return json(show&&!show.deleted_at?200:404,{success:!!(show&&!show.deleted_at),data:show&&!show.deleted_at?show:null,error:show?'Show archived':'Show not found'});
    }

    if (a==='agency_create_show') {
      const incoming = b.show || {};
      const show={
        ...incoming,
        tour_id:b.tour_id||incoming.tour_id||null,
        band_ids:b.band_ids || incoming.band_ids || (b.band_id?[b.band_id]:[]),
        date:b.date||incoming.date||'', venue_name:b.venue_name||incoming.venue_name||'', city:b.city||incoming.city||'', country:b.country||incoming.country||'', venue_address:b.venue_address||incoming.venue_address||'',
        status:b.status||incoming.status||'draft', promoter_token:b.promoter_token||incoming.promoter_token||token(), sheets:incoming.sheets||[], created_at:incoming.created_at||now(), updated_at:now(),
        promoter_url:b.promoter_url||incoming.promoter_url||'', advancing_requirements:incoming.advancing_requirements||b.advancing_requirements||defaultReq()
      };
      show.promoter_url = show.promoter_url || `https://melankoliaagency.com/advancing/?token=${show.promoter_token}`;
      const doc=await createDoc(SHOWS,show,id('show'));
      return json(200,{success:true,data:doc});
    }

    if (a==='agency_update_show') {
      const cur=await getDoc(SHOWS,b.show_id); if(!cur) return json(404,{success:false,error:'Show not found'});
      const updates = b.updates || b.show || {};
      const doc=await updateDoc(SHOWS,b.show_id,{...cur,...updates,updated_at:now()});
      await syncShowToTour(doc, { source:'agency_update_show' });
      return json(200,{success:true,data:doc});
    }

    if (a==='agency_update_sheet') {
      const cur=await getDoc(SHOWS,b.show_id); if(!cur) return json(404,{success:false,error:'Show not found'});
      const sheet={...(cur.sheets?.[0]||{}),...(b.sheet_data||{}),updated_at:now()};
      const promoter=sheet.promoter || cur.promoter || {};
      const doc=await updateDoc(SHOWS,b.show_id,{...cur,sheets:[sheet],promoter,status:cur.status||'draft',updated_at:now()});
      await syncShowToTour(doc, { source:'agency_update_sheet' });
      return json(200,{success:true,data:doc});
    }

    if (a==='agency_approve_sheet') {
      const cur=await getDoc(SHOWS,b.show_id); if(!cur) return json(404,{success:false,error:'Show not found'});
      const doc=await updateDoc(SHOWS,b.show_id,{...cur,status:'approved',reviewed_by:b.reviewed_by||'agency',reviewed_at:now(),updated_at:now()});
      await syncShowToTour(doc, { source:'agency_approve_sheet' });
      return json(200,{success:true,data:doc});
    }

    if (a==='agency_publish_sheet') {
      const cur=await getDoc(SHOWS,b.show_id); if(!cur) return json(404,{success:false,error:'Show not found'});
      const doc=await updateDoc(SHOWS,b.show_id,{...cur,status:'published',published_at:now(),updated_at:now()});
      await syncShowToTour(doc, { source:'agency_publish_sheet' });
      await createDoc(NOTIFS,{type:'band_published',show_id:b.show_id,message:`${cur.venue_name||cur.city||'Show'} published to band portal`,resolved:false,created_at:now(),updated_at:now()},id('notif'));
      return json(200,{success:true,data:doc});
    }

    if (a==='agency_set_show_status') {
      const cur=await getDoc(SHOWS,b.show_id); if(!cur) return json(404,{success:false,error:'Show not found'});
      const doc=await updateDoc(SHOWS,b.show_id,{...cur,status:b.status||cur.status,updated_at:now()});
      await syncShowToTour(doc, { source:'agency_set_show_status' });
      return json(200,{success:true,data:doc});
    }

    if (a==='agency_resolve_notification') {
      const n=await getDoc(NOTIFS,b.notification_id); if(n) await updateDoc(NOTIFS,b.notification_id,{...n,resolved:true,resolved_at:now(),updated_at:now()});
      return json(200,{success:true});
    }

    if (a==='agency_create_band') {
      const username=b.username || String(b.name||'band').toLowerCase().replace(/[^a-z0-9]+/g,'-');
      const band={name:b.name||'Band',username,password:b.password||token().slice(0,10),contacts:b.contacts||[],created_at:now(),updated_at:now()};
      return json(200,{success:true,data:await createDoc(BANDS,band,id('band'))});
    }
    if (a==='agency_update_band_password') {
      const band=await getDoc(BANDS,b.band_id); if(!band) return json(404,{success:false,error:'Band not found'});
      return json(200,{success:true,data:await updateDoc(BANDS,b.band_id,{...band,password:b.new_password||token().slice(0,10),updated_at:now()})});
    }
    if (a==='agency_archive_band') {
      const band=await getDoc(BANDS,b.band_id); if(!band) return json(404,{success:false,error:'Band not found'});
      return json(200,{success:true,data:await updateDoc(BANDS,b.band_id,{...band,deleted_at:now(),updated_at:now()})});
    }
    if (a==='agency_create_tour') {
      const tour={name:b.name||b.tour?.name||'Untitled Tour',band_ids:b.band_ids || (b.band_id?[b.band_id]:[]),startDate:b.start_date||b.startDate||'',endDate:b.end_date||b.endDate||'',status:b.status||'draft',created_at:now(),updated_at:now(),...(b.tour||{})};
      return json(200,{success:true,data:await createDoc(TOURS,tour,id('tour'))});
    }

    if (a==='band_login') {
      const bands=await list(BANDS);
      const band=bands.find(x=>x.username===b.username && String(x.password||'')===String(b.password||''));
      if(!band) return json(401,{success:false,error:'Invalid login'});
      const session_token=crypto.createHash('sha256').update(`${band.id}:${band.password}:melankolia`).digest('hex');
      return json(200,{success:true,data:{band_id:band.id,session_token,band:{id:band.id,name:band.name,username:band.username,contacts:band.contacts||[]}}});
    }
    if (a==='band_get_shows') {
      const band=await getDoc(BANDS,b.band_id); if(!band) return json(404,{success:false,error:'Band not found'});
      const good=crypto.createHash('sha256').update(`${band.id}:${band.password}:melankolia`).digest('hex');
      if(b.session_token!==good) return json(401,{success:false,error:'Invalid session'});
      const shows=(await list(SHOWS)).filter(s=>(s.band_ids||[]).includes(b.band_id) && ['approved','published'].includes(s.status));
      const toursArr=await list(TOURS); const tours={}; toursArr.forEach(t=>tours[t.id]=t);
      const notifications=(await list(NOTIFS)).filter(n=>(shows.some(s=>s.id===n.show_id)) && !n.resolved);
      return json(200,{success:true,data:{shows,tours,notifications,band:{id:band.id,name:band.name,username:band.username}}});
    }
    if (a==='band_mark_notifications_read') {
      await Promise.all((b.notification_ids||[]).map(async nid=>{const n=await getDoc(NOTIFS,nid); if(n) await updateDoc(NOTIFS,nid,{...n,resolved:true,read_at:now(),updated_at:now()});}));
      return json(200,{success:true});
    }

    if (a==='promoter_get_show') {
      const shows=await list(SHOWS);
      const show=shows.find(s=>s.promoter_token===b.token || s.id===b.token);
      return json(show?200:404,{success:!!show,data:show||null,error:show?undefined:'Show not found'});
    }

    if (a==='promoter_submit') {
      const shows=await list(SHOWS);
      const cur=shows.find(s=>s.promoter_token===b.token || s.id===b.token);
      if(!cur) return json(404,{success:false,error:'Show not found'});
      const sheet={...(cur.sheets?.[0]||{}),...(b.data||{}),submitted_at:now(),updated_at:now()};
      const logistics = extractLogisticsFromSheet(sheet);
      const doc=await updateDoc(SHOWS,cur.id,{...cur,...logistics,sheets:[sheet],promoter:sheet.promoter||cur.promoter||{},status:'pending_review',updated_at:now()});
      await syncShowToTour(doc, { source:'promoter_submit', sheet });
      await createDoc(NOTIFS,{type:'promoter_submit',show_id:cur.id,message:`Promoter submitted advancing info for ${cur.venue_name||cur.city||'show'}`,resolved:false,created_at:now(),updated_at:now()},id('notif'));
      return json(200,{success:true,data:{...doc,message:'Thank you. The agency will review and publish confirmed details to the band app.',gaps:[]}});
    }

    return json(400,{success:false,error:'Unknown advancing action'});
  } catch(e) { return json(500,{success:false,error:e.message}); }
};

async function list(c){ return (await listDocs(c,{orderBy:'updated_at desc',pageSize:300})).filter(x=>!x.deleted_at); }
function defaultReq(){ return { contacts:true, venue:true, schedule:true, technical:true, backline:true, guest_list:true, merch:true, hotel:true, transportation:true, settlement:true, hospitality:true, wifi:true, notes:true }; }

function extractLogisticsFromSheet(sheet={}) {
  return {
    venue_address: sheet.venue_address || '',
    capacity: sheet.capacity || '',
    hotel_required: !!(sheet.hotel?.name || sheet.hotel?.address),
    hotel_responsibility: sheet.hotel?.responsibility || sheet.hotel_responsibility || '',
    airport_transfer_required: !!(sheet.transportation?.airport_pickup || sheet.transportation?.airport_transfer),
    travel_mode_recommendation: sheet.transportation?.mode || '',
    transport_responsibility: sheet.transportation?.responsibility || '',
    backline_needed: sheet.backline ? 'provided_details' : '',
    lodging: sheet.hotel || {},
    transport: sheet.transportation || {},
    backline: sheet.backline || {},
    advancing_submitted_at: sheet.submitted_at || now()
  };
}

async function syncShowToTour(show, meta={}) {
  if (!show?.tour_id || show.leg_index === undefined || show.leg_index === null) return null;
  const tour = await getDoc(TOURS, show.tour_id);
  if (!tour || !Array.isArray(tour.legs)) return null;
  const idx = Number(show.leg_index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= tour.legs.length) return null;
  const legs = [...tour.legs];
  legs[idx] = {
    ...legs[idx],
    suggested_venue: show.venue_name || legs[idx].suggested_venue,
    venue_address: show.venue_address || legs[idx].venue_address,
    booking_status: show.booking_status || legs[idx].booking_status,
    deal_status: show.deal_status || legs[idx].deal_status,
    locked: !!show.locked,
    rate_target_usd: show.rate_target_usd || legs[idx].rate_target_usd,
    rate_offer_usd: show.rate_offer_usd || legs[idx].rate_offer_usd,
    rate_confirmed_usd: show.rate_confirmed_usd || legs[idx].rate_confirmed_usd,
    hold_deadline: show.hold_deadline || legs[idx].hold_deadline,
    contact_status: show.contact_status || legs[idx].contact_status,
    next_action: show.next_action || legs[idx].next_action,
    travel_mode_recommendation: show.travel_mode_recommendation || legs[idx].travel_mode_recommendation,
    travel_feasibility: show.travel_feasibility || legs[idx].travel_feasibility,
    hotel_required: show.hotel_required ?? legs[idx].hotel_required,
    hotel_responsibility: show.hotel_responsibility || legs[idx].hotel_responsibility,
    airport_transfer_required: show.airport_transfer_required ?? legs[idx].airport_transfer_required,
    transport_responsibility: show.transport_responsibility || legs[idx].transport_responsibility,
    backline_needed: show.backline_needed || legs[idx].backline_needed,
    lodging: show.lodging || legs[idx].lodging || {},
    transport: show.transport || legs[idx].transport || {},
    backline: show.backline || legs[idx].backline || {},
    sheets: show.sheets || legs[idx].sheets || [],
    advancing_requirements: show.advancing_requirements || legs[idx].advancing_requirements || defaultReq(),
    advancing_status: show.status,
    updated_at: now(),
    last_advancing_sync: { source:meta.source || 'unknown', at:now() }
  };
  return updateDoc(TOURS, tour.id, { ...tour, legs, updated_at:now() });
}
```

---

### 19.4 `melankoliaagency/netlify/functions/email-generator.js`

```javascript
const { json } = require('./_firebase');

function esc(v='') {
  return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function clean(v='') { return String(v ?? '').trim(); }
function line(parts) { return parts.filter(Boolean).join(' · '); }

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { success:false, error:'POST only' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}
  const d = body.data || body;

  const artist = clean(d.artist) || 'Artist';
  const city = clean(d.city) || 'your city';
  const country = clean(d.country);
  const venue = clean(d.venue || d.venue_name);
  const date = clean(d.date);
  const deal = clean(d.deal || d.deal_suggestion || d.offer);
  const notes = clean(d.notes || d.routing_notes || d.context);
  const tourName = clean(d.tour?.name || d.tour?.tour_name || d.tourName);
  const region = clean(d.tour?.region || d.region);

  const subject = `${artist} — ${city}${date ? ` ${date}` : ''} routing inquiry`;
  const intro = `I’m reaching out from Melankolia Agency about a possible ${artist} date in ${city}${country ? `, ${country}` : ''}${date ? ` on or around ${date}` : ''}.`;
  const routing = tourName || region ? `This is part of ${line([tourName, region])}, and ${venue ? `${venue} looks like a strong fit` : 'we are looking for the right room'} for the routing.` : `${venue ? `${venue} looks like a strong fit` : 'We are looking for the right room'} for this routing.`;
  const ask = deal ? `The current target structure is ${deal}, but we’re open to shaping the right deal for the market.` : `We’re open to discussing the right structure for the market — guarantee, best-of-door, or a thoughtful co-pro depending on the room.`;
  const noteBlock = notes ? `\n\nContext: ${notes}` : '';

  const text = `Hi,\n\n${intro}\n\n${routing}\n\n${ask}${noteBlock}\n\nIf this could make sense, I’d love to send over the EPK and talk through availability.\n\nBest,\nMelankolia Agency\nmelankoliaagency.com`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head><body style="margin:0;background:#050505;color:#d7d7d7;font-family:Helvetica,Arial,sans-serif;line-height:1.55"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050505;padding:32px 16px"><tr><td align="center"><table role="presentation" width="100%" style="max-width:680px;border:1px solid #222;background:#0b0b0b" cellspacing="0" cellpadding="0"><tr><td style="padding:28px 30px;border-bottom:1px solid #202020"><img src="https://melankoliaagency.com/images/logo-mark-white.svg" alt="Melankolia" style="width:38px;height:auto;display:block;margin-bottom:22px"><div style="font-size:10px;letter-spacing:.28em;text-transform:uppercase;color:#c8a96e;font-weight:700">Melankolia Agency</div><h1 style="margin:8px 0 0;color:#fff;font-size:25px;line-height:1.15;font-weight:700">${esc(artist)} routing inquiry</h1><div style="margin-top:10px;color:#888;font-size:12px;letter-spacing:.08em;text-transform:uppercase">${esc(line([venue, city, country, date]))}</div></td></tr><tr><td style="padding:30px;color:#d7d7d7;font-size:15px"><p style="margin:0 0 18px">${esc(intro)}</p><p style="margin:0 0 18px">${esc(routing)}</p><p style="margin:0 0 18px">${esc(ask)}</p>${notes ? `<p style="margin:0 0 18px;color:#aaa"><strong style="color:#c8a96e">Context:</strong> ${esc(notes)}</p>` : ''}<p style="margin:24px 0 0">If this could make sense, I’d love to send over the EPK and talk through availability.</p><p style="margin:28px 0 0;color:#aaa">Best,<br><strong style="color:#fff">Melankolia Agency</strong><br><a href="https://melankoliaagency.com" style="color:#c8a96e;text-decoration:none">melankoliaagency.com</a></p></td></tr></table></td></tr></table></body></html>`;

  return json(200, { success:true, data:{ subject, text, html, preview: line([artist, venue, city, date, deal]) } });
};
```

---

### 19.5 `recovery_deploy/js/route-admin.js`

```javascript
/* Melankolia Route Planner — Operations Dashboard UX v2 */
(function(){
  'use strict';

  const ROUTE_API = '/.netlify/functions/route-planner-api';
  const ROUTE_AI = '/.netlify/functions/ai-tour';
  const MAPS_CONFIG = '/.netlify/functions/maps-config';
  const MAPS_PROXY = '/.netlify/functions/maps-proxy';
  const EMAIL_API = '/.netlify/functions/email-generator';
  const VENUE_FINDER_API = '/.netlify/functions/geminiSearch';

  let tours = [];
  let currentTour = null;
  let currentShows = [];
  let currentGenerated = null;
  let activeLibraryFilter = 'active';
  let map = null;
  let mapReady = false;
  let mapMarkers = [];
  let mapLines = [];

  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const attr = v => esc(v).replace(/`/g,'&#96;');
  const val = id => ($(id)?.value || '').trim();
  const num = id => Number(val(id) || 0);
  const clamp = (n,min,max) => Math.max(min, Math.min(max, Number(n)||min));
  const todayISO = () => new Date().toISOString().slice(0,10);
  const plusDaysISO = d => { const x = new Date(); x.setDate(x.getDate()+d); return x.toISOString().slice(0,10); };
  const toast = (msg,type='success') => typeof showToast === 'function' ? showToast(msg,type) : alert(msg);

  async function post(url,payload){
    const res = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload||{})});
    const json = await res.json().catch(()=>({success:false,error:'Invalid JSON response'}));
    if(!res.ok || json.success===false) throw new Error(json.error || `Request failed (${res.status})`);
    return json.data ?? json;
  }
  const api = payload => post(ROUTE_API,payload);
  const ai = (action,data) => post(ROUTE_AI,{action,data});

  function loading(text){ return `<div class="route-loading"><span></span>${esc(text)}</div>`; }
  function errorBox(title,msg){ return `<div class="route-error"><strong>${esc(title)}</strong><br>${esc(msg)}</div>`; }
  function normalizeDateRange(t){ return [t.startDate||t.start_date,t.endDate||t.end_date].filter(Boolean).join(' → ') || 'Dates TBD'; }
  function visibleTours(){
    const term = ($('routeSearch')?.value || '').toLowerCase().trim();
    return tours.filter(t=>{
      const archived = t.deleted_at || t.status === 'archived';
      if(activeLibraryFilter==='active' && archived) return false;
      if(activeLibraryFilter==='archived' && !archived) return false;
      if(!term) return true;
      return [t.name,t.tour_name,t.artist,t.region,t.summary,t.routing_strategy].join(' ').toLowerCase().includes(term);
    });
  }

  async function initRoutePlannerAdmin(){
    const root = $('routeAdminShell');
    if(!root) return;
    root.innerHTML = loading('Loading route operations…');
    try{
      tours = await api({action:'listTours'});
      renderHub();
    } catch(e){ root.innerHTML = errorBox('Route Planner backend unavailable', e.message); }
  }

  function renderHub(){
    const root = $('routeAdminShell');
    const active = tours.filter(t=>!t.deleted_at && t.status!=='archived');
    const archived = tours.filter(t=>t.deleted_at || t.status==='archived');
    const allLegs = tours.flatMap(t=>Array.isArray(t.legs)?t.legs:[]);
    const showCount = allLegs.filter(l=>!l.day_off).length;
    root.innerHTML = `
      <section class="route-ops-shell">
        <aside class="route-library-panel">
          <div class="route-mini-brand"><img src="/images/logo-mark-white.svg" alt=""><div><b>Melankolia</b><span>Route Operations</span></div></div>
          <button type="button" class="btn-primary route-full-btn" onclick="RouteAdmin.renderBuilder()">Create New Tour Plan</button>
          <div class="route-library-tools">
            <input id="routeSearch" class="form-input" placeholder="Search tours, artists, regions…" oninput="RouteAdmin.refreshLibraryList()">
            <div class="route-filter-row">
              <button type="button" class="route-filter active" data-filter="active" onclick="RouteAdmin.setFilter('active')">Active</button>
              <button type="button" class="route-filter" data-filter="all" onclick="RouteAdmin.setFilter('all')">All</button>
              <button type="button" class="route-filter" data-filter="archived" onclick="RouteAdmin.setFilter('archived')">Archived</button>
            </div>
          </div>
          <div class="route-list-head"><span>Tours</span><button type="button" onclick="RouteAdmin.init()">Refresh</button></div>
          <div id="routeLibraryList" class="route-library-list"></div>
        </aside>
        <main class="route-ops-main">
          <div class="route-command-bar">
            <div>
              <p class="route-kicker">AI-powered touring system</p>
              <h1>Tour Route Planner</h1>
              <p>Map-first routing, anchor analysis, budget logic, venue discovery, branded outreach, and advancing handoff.</p>
            </div>
            <div class="route-command-actions">
              <button type="button" class="btn-secondary" onclick="RouteAdmin.systemTour()">How it works</button>
              <button type="button" class="btn-primary" onclick="RouteAdmin.renderBuilder()">New Plan</button>
            </div>
          </div>
          <div class="route-dashboard-grid">
            <div class="route-stat"><strong>${active.length}</strong><span>Active drafts</span></div>
            <div class="route-stat"><strong>${showCount}</strong><span>Generated shows</span></div>
            <div class="route-stat"><strong>${archived.length}</strong><span>Archived routes</span></div>
            <div class="route-stat"><strong>7</strong><span>AI actions wired</span></div>
          </div>
          <div class="route-overview-grid">
            <section class="route-map-card route-map-card-large">
              <div class="route-panel-title"><span>Planning map</span><em>Starts on your continent, then plots generated/saved legs</em></div>
              <div id="routeMap" class="route-map route-map-home"><div class="route-map-placeholder">Loading operations map…</div></div>
            </section>
            <section class="route-ai-board">
              <div class="route-panel-title"><span>AI command center</span><em>What this system can do</em></div>
              ${aiCapabilityCards()}
            </section>
          </div>
          <section class="route-workflow-panel">
            <div class="route-panel-title"><span>Recommended workflow</span><em>Built for repeated planning sessions</em></div>
            <div class="route-workflow-steps">
              <div><b>01</b><strong>Start with anchors</strong><span>Confirmed festivals, high-value weekends, or must-hit cities.</span></div>
              <div><b>02</b><strong>Generate route</strong><span>Gemini builds realistic legs around drive limits and scene markets.</span></div>
              <div><b>03</b><strong>Iterate with AI</strong><span>Analyze gaps, optimize order, estimate budget, find venues, draft emails.</span></div>
              <div><b>04</b><strong>Save + advance</strong><span>Save creates the tour and individual show records for advancing.</span></div>
            </div>
          </section>
        </main>
      </section>`;
    refreshLibraryList();
    renderStarterMap();
  }

  function aiCapabilityCards(){
    const cards = [
      ['Generate Tour','Build a full day-by-day itinerary from artist, region, dates, and anchors.'],
      ['Analyze Anchors','Find routing gaps, weak placements, missing markets, and dead-day opportunities.'],
      ['Optimize Route','Reorder generated or saved legs for drive efficiency and lower cost.'],
      ['Budget Estimate','Calculate projected revenue, expenses, break-even, and viability.'],
      ['Venue Suggestions','Find genre-specific underground rooms by city and capacity.'],
      ['Deal Advisor','Evaluate guarantees, door splits, counters, and walk-away points.'],
      ['Branded Email','Generate polished venue outreach HTML for selected stops.']
    ];
    return `<div class="route-ai-card-grid">${cards.map(c=>`<div class="route-ai-card"><strong>${esc(c[0])}</strong><span>${esc(c[1])}</span></div>`).join('')}</div>`;
  }

  function setFilter(filter){ activeLibraryFilter = filter; document.querySelectorAll('.route-filter').forEach(b=>b.classList.toggle('active', b.dataset.filter===filter)); refreshLibraryList(); }
  function refreshLibraryList(){
    const el = $('routeLibraryList'); if(!el) return;
    const list = visibleTours();
    el.innerHTML = list.length ? list.map(tourListItem).join('') : `<div class="route-library-empty">No ${activeLibraryFilter==='all'?'':activeLibraryFilter} tours yet. Create a new plan to start.</div>`;
  }
  function tourListItem(t){
    const legs = Array.isArray(t.legs)?t.legs:[];
    const shows = legs.filter(l=>!l.day_off).length || t.total_shows || 0;
    return `<article class="route-list-item" onclick="RouteAdmin.openTour('${attr(t.id)}')">
      <div><strong>${esc(t.name||t.tour_name||'Untitled Tour')}</strong><span>${esc(t.artist||'Artist TBD')} · ${esc(t.region||'Region TBD')}</span></div>
      <em>${esc(normalizeDateRange(t))}</em>
      <small>${shows} shows · ${esc(t.status||'draft')}</small>
      <div class="route-list-actions" onclick="event.stopPropagation()">
        <button type="button" onclick="RouteAdmin.openTour('${attr(t.id)}')">Open</button>
        <button type="button" onclick="RouteAdmin.duplicateTour('${attr(t.id)}')">Duplicate</button>
        <button type="button" class="danger" onclick="RouteAdmin.deleteTour('${attr(t.id)}')">Delete</button>
      </div>
    </article>`;
  }

  function renderBuilder(seed={}){
    currentGenerated = null; currentTour = null; currentShows = [];
    const artists = (typeof getArtists === 'function' ? getArtists() : []).map(a=>a.name).filter(Boolean);
    $('routeAdminShell').innerHTML = `
      <section class="route-plan-shell">
        <div class="route-plan-topbar">
          <button type="button" class="btn-secondary btn-sm" onclick="RouteAdmin.init()">← Tour Library</button>
          <div><p class="route-kicker">New routing session</p><h1>Plan a tour around the map</h1><span>Start broad, add anchors, then let AI propose the route. Every action stays visible while you iterate.</span></div>
          <button type="button" class="btn-secondary btn-sm" onclick="RouteAdmin.systemTour()">System Tour</button>
        </div>
        <div class="route-plan-grid">
          <section class="route-map-card route-builder-map-card">
            <div class="route-panel-title"><span>Route map</span><em>Initial view follows your continent; generated routes plot here.</em></div>
            <div id="routeMap" class="route-map route-map-planner"><div class="route-map-placeholder">Loading continent map…</div></div>
          </section>
          <aside class="route-control-panel">
            <form id="routeBuildForm" onsubmit="RouteAdmin.generate(event)">
              <div class="route-form-step"><b>01</b><span>Core plan</span></div>
              <label>Artist<select id="rtArtist" class="form-input"><option value="">Select artist…</option>${artists.map(a=>`<option ${seed.artist===a?'selected':''}>${esc(a)}</option>`).join('')}</select></label>
              <label>Tour Name<input id="rtName" class="form-input" placeholder="Fall 2026 West Coast" value="${attr(seed.name||'')}"></label>
              <div class="route-two-col"><label>Region<input id="rtRegion" class="form-input" placeholder="EU / US West / Northeast" value="${attr(seed.region||'')}"></label><label>Shows<input id="rtShows" type="number" min="1" max="40" class="form-input" value="${attr(seed.numShows||10)}" onfocus="this.select()"></label></div>
              <div class="route-two-col"><label>Start City<input id="rtStartCity" class="form-input" placeholder="Berlin" value="${attr(seed.startCity||'')}"></label><label>End City<input id="rtEndCity" class="form-input" placeholder="Amsterdam" value="${attr(seed.endCity||'')}"></label></div>
              <div class="route-two-col"><label>Start Date<input id="rtStartDate" type="date" class="form-input" value="${attr(seed.startDate||plusDaysISO(7))}"></label><label>End Date<input id="rtEndDate" type="date" class="form-input" value="${attr(seed.endDate||plusDaysISO(21))}"></label></div>
              <label>Deal Type<select id="rtDealType" class="form-input"><option>guarantee vs door</option><option>guarantee</option><option>door deal</option><option>festival routing</option></select></label>
              <div class="route-form-step"><b>02</b><span>Travel + gear profile</span></div>
              <div class="route-two-col"><label>Travel Party<input id="rtPartySize" type="number" min="1" class="form-input" value="${attr(seed.partySize||3)}"></label><label>Gear Weight KG<input id="rtGearWeight" type="number" min="0" class="form-input" value="${attr(seed.gearWeightKg||80)}"></label></div>
              <label>Travel Mode Preference<select id="rtTravelPreference" class="form-input"><option>drive if feasible</option><option>fly when distance is too long</option><option>train when possible</option><option>mixed / decide per leg</option></select></label>
              <label class="route-check-label"><input id="rtTravelingWithGear" type="checkbox" ${seed.travelingWithGear===false?'':'checked'}> Band is traveling with gear</label>
              <label>Backline / Hotel / Transport Assumptions<textarea id="rtLogisticsProfile" class="form-input form-textarea" rows="4" placeholder="Needs partial backline when flying; promoter hotel preferred; airport pickup if flying; can drive max 5.5h after a show; avoid Monday unless Tuesday drive is realistic…">${esc(seed.logisticsProfile||'')}</textarea></label>
              <div class="route-form-step"><b>03</b><span>Anchors + constraints</span></div>
              <label>Routing Preferences<textarea id="rtPreferences" class="form-input form-textarea" rows="4" placeholder="Avoid 6+ hour drives, prioritize 200–500 cap darkwave/EBM/post-punk rooms, avoid Mondays unless necessary…">${esc(seed.preferences||'')}</textarea></label>
              <label>Established Holds / Confirmed Anchors <small>one per line: City | Date | Venue | Deal | Status. Use hold, offer, deal_made, confirmed, or advanced.</small><textarea id="rtAnchors" class="form-input form-textarea" rows="5" placeholder="Berlin | 2026-10-16 | Urban Spree | €800 guarantee | hold">${esc(seed.anchorText||'')}</textarea></label>
              <div class="route-builder-actions"><button class="btn-secondary" type="button" onclick="RouteAdmin.analyzeAnchors()">Analyze Anchors</button><button class="btn-primary" type="submit">Generate Route</button></div>
            </form>
          </aside>
        </div>
        <div class="route-output-grid">
          <section class="route-output-panel"><div class="route-panel-title"><span>Generated route</span><em>Review and save when the logic feels right.</em></div><div id="routeGeneratedResult">${routeStartHelp()}</div></section>
          <section class="route-output-panel"><div class="route-panel-title"><span>AI workbench</span><em>Budget, venues, deal advice, emails, and chat.</em></div><div id="routeToolOutput">${aiWorkbenchEmpty()}</div></section>
        </div>
      </section>`;
    renderStarterMap();
  }

  function routeStartHelp(){ return `<div class="route-help-card"><h2>Start with the route shape.</h2><p>Pick artist, continent/region, endpoints, dates, and anchors. Then generate. The map and route legs will stay here while you keep refining.</p><ul><li>Use holds/anchors for confirmed weekends, active offers, or real buyer interest.</li><li>Use preferences for drive limits and room size.</li><li>Save only when the proposed routing makes sense.</li></ul></div>`; }
  function aiWorkbenchEmpty(){ return `<div class="route-ai-empty">AI tools appear here after you analyze anchors or generate/open a route. You’ll get budget, venue ideas, deal advice, and branded email output without leaving the planner.</div>`; }

  function parseAnchors(text){
    return String(text||'').split(/\n+/).map(x=>x.trim()).filter(Boolean).map(line=>{ const [city,date,venue,deal,status]=line.split('|').map(p=>String(p||'').trim()); return {city,date,venue,deal,status:status||'hold'}; });
  }
  function formPayload(){ return { artist:val('rtArtist'), name:val('rtName'), region:val('rtRegion'), numShows:clamp(num('rtShows')||10,1,40), startCity:val('rtStartCity'), endCity:val('rtEndCity'), startDate:val('rtStartDate'), endDate:val('rtEndDate'), dealType:val('rtDealType'), partySize:num('rtPartySize')||3, gearWeightKg:num('rtGearWeight')||0, travelPreference:val('rtTravelPreference'), travelingWithGear:!!$('rtTravelingWithGear')?.checked, logisticsProfile:val('rtLogisticsProfile'), preferences:val('rtPreferences'), anchorShows:parseAnchors(val('rtAnchors')) }; }

  async function analyzeAnchors(){
    const out = $('routeToolOutput'); if(!out) return;
    const payload = formPayload();
    if(!payload.artist || !payload.region){ toast('Artist and region are required before anchor analysis.', 'error'); return; }
    out.innerHTML = loading('Analyzing anchors and routing gaps…');
    try{ const data = await ai('analyze_anchors', payload); out.innerHTML = renderAnalysisCard('Anchor Analysis', data); toast('✓ Anchor analysis ready','success'); }
    catch(e){ out.innerHTML = errorBox('Anchor analysis failed', e.message); }
  }

  async function generate(ev){
    ev?.preventDefault();
    const out = $('routeGeneratedResult');
    const tools = $('routeToolOutput');
    const payload = formPayload();
    if(!payload.artist || !payload.region || !payload.startCity || !payload.endCity){ toast('Artist, region, start city, and end city are required.', 'error'); return; }
    out.innerHTML = loading('Gemini 3 is building the route…');
    tools.innerHTML = `<div class="route-ai-empty">Generating route first. Then use the AI workbench for budget, venues, deals, and emails.</div>`;
    try{
      currentGenerated = normalizeTour(await ai('generate_tour', payload), payload);
      renderGenerated(currentGenerated, payload);
      await renderMap(currentGenerated.legs || []);
      toast('✓ Route generated — running second-pass AI oversight','success');
      reviewCurrentRoute(true);
    } catch(e){ out.innerHTML = errorBox('Route generation failed', e.message); toast('Route generation failed: '+e.message,'error'); }
  }

  function normalizeTour(t,payload={}){
    t = t || {};
    t.name = t.name || t.tour_name || payload.name || `${payload.artist||'Artist'} ${payload.region||'Tour'}`;
    t.tour_name = t.tour_name || t.name;
    t.artist = t.artist || payload.artist;
    t.region = t.region || payload.region;
    t.startDate = t.startDate || payload.startDate;
    t.endDate = t.endDate || payload.endDate;
    t.status = t.status || 'draft';
    t.legs = Array.isArray(t.legs) ? t.legs : [];
    t.total_days = t.total_days || t.legs.length;
    t.total_shows = t.total_shows || t.legs.filter(l=>!l.day_off).length;
    return t;
  }

  function renderGenerated(t,payload={}){
    $('routeGeneratedResult').innerHTML = `
      <div class="route-generated-card">
        <div class="route-generated-head">
          <div><p class="route-kicker">Generated draft</p><h2>${esc(t.name||t.tour_name)}</h2><span>${esc(t.artist||payload.artist)} · ${esc(t.region||payload.region)} · ${esc(normalizeDateRange(t))}</span><p>${esc(t.summary||t.routing_strategy||'')}</p></div>
          <div class="route-hero-actions"><button class="btn-secondary" onclick="RouteAdmin.reviewCurrentRoute()">AI Oversight</button><button class="btn-secondary" onclick="RouteAdmin.optimizeGenerated()">Optimize</button><button class="btn-secondary" onclick="RouteAdmin.estimateBudget()">Budget</button><button class="btn-secondary" onclick="RouteAdmin.researchVenuesAllStops()">Research Venues All Stops</button><button class="btn-primary" onclick="RouteAdmin.saveGenerated()">Save Tour + Shows</button></div>
        </div>
        ${routeMetrics(t)}
        <div class="route-leg-list">${(t.legs||[]).map(legRow).join('')}</div>
      </div>`;
    const tools = $('routeToolOutput'); if(tools) tools.innerHTML = renderWorkbench(t);
  }

  function routeMetrics(t){ return `<div class="route-metrics"><div><strong>${esc(t.total_shows||0)}</strong><span>Shows</span></div><div><strong>${esc(t.total_days||(t.legs||[]).length||0)}</strong><span>Days</span></div><div><strong>${esc(t.estimated_total_km||'—')}</strong><span>Est. km</span></div><div><strong>${esc(Math.round(((t.legs||[]).reduce((n,l)=>n+(Number(l.drive_hours)||0),0))*10)/10 || '—')}</strong><span>Drive hrs</span></div></div>`; }
  function money(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? '$' + Math.round(n).toLocaleString() : '—'; }
  function statusBadge(v) { const x = String(v || 'prospect').replace(/_/g,' '); return `<span class="route-status-badge ${attr(String(v||'prospect'))}">${esc(x)}</span>`; }
  function legRow(l,i){
    const type = l.day_off ? 'Rest day' : l.is_anchor_show ? 'Anchor show' : 'Target show';
    const status = l.booking_status || (l.locked ? 'confirmed' : 'prospect');
    const rate = l.rate_confirmed_usd || l.rate_offer_usd || l.rate_target_usd || l.suggested_guarantee_usd;
    return `<article class="route-leg ${l.day_off?'day-off':''}" onclick="RouteAdmin.openStop(${i})">
      <div class="route-leg-day"><b>${esc(l.day||i+1)}</b><span>${esc(l.day_of_week||'')}</span></div>
      <div class="route-leg-main"><strong>${esc(l.city||'TBD')}</strong><span>${esc([l.date,l.country].filter(Boolean).join(' · '))}</span>${l.suggested_venue?`<em>${esc(l.suggested_venue)}</em>`:''}${l.notes?`<p>${esc(l.notes)}</p>`:''}</div>
      <div class="route-leg-meta"><span>${esc(type)}</span>${statusBadge(status)}<span>Rate: ${esc(money(rate))}</span><span>${esc(l.travel_mode_recommendation||'travel TBD')}</span><span>${esc(l.hotel_responsibility?('Hotel: '+l.hotel_responsibility):'Hotel TBD')}</span><span>${l.locked?'Locked':'Not locked'}</span></div>
      <div class="route-leg-actions">${!l.day_off?`<button class="btn-secondary btn-sm" onclick="event.stopPropagation();RouteAdmin.openStop(${i})">Details</button><button class="btn-secondary btn-sm" onclick="event.stopPropagation();RouteAdmin.venueFinderForStop(${i})">Venue Finder</button><button class="btn-secondary btn-sm" onclick="event.stopPropagation();RouteAdmin.suggestVenues(${i})">Fast Venues</button><button class="btn-secondary btn-sm" onclick="event.stopPropagation();RouteAdmin.generateEmail(${i})">Email</button><button class="btn-secondary btn-sm" onclick="event.stopPropagation();RouteAdmin.adviseDeal(${i})">Deal</button>`:''}</div>
    </article>`;
  }

  function renderWorkbench(t){ return `<div class="route-workbench-grid"><button onclick="RouteAdmin.reviewCurrentRoute()"><strong>AI oversight</strong><span>Second-pass sanity check before outreach.</span></button><button onclick="RouteAdmin.optimizeCurrent()"><strong>Optimize route</strong><span>Reorder without losing holds/deals.</span></button><button onclick="RouteAdmin.estimateBudget()"><strong>Estimate budget</strong><span>Rates, guarantees, costs, break-even.</span></button><button onclick="RouteAdmin.chatAgent()"><strong>Ask booking AI</strong><span>Routing, buyer, hold, and deal strategy.</span></button><button onclick="RouteAdmin.analyzeCurrentAnchors()"><strong>Analyze pipeline</strong><span>Holds, gaps, dead days, next actions.</span></button></div><div id="routeAiOutput"></div>`; }
  function toolOut(){ return $('routeAiOutput') || $('routeToolOutput') || $('routeDetailTools'); }
  function renderAnalysisCard(title,data){ return `<div class="route-tool-card"><h3>${esc(title)}</h3>${renderObject(data)}${renderSuggestedActions(data?.suggested_actions||data?.recommended_changes||[])}</div>`; }
  function renderObject(obj){
    if(!obj || typeof obj !== 'object') return `<pre>${esc(obj||'')}</pre>`;
    const rows = Object.entries(obj).filter(([k])=>!['raw','model','suggested_actions'].includes(k)).map(([k,v])=>`<div class="route-object-row"><b>${esc(k.replace(/_/g,' '))}</b>${Array.isArray(v)?`<ul>${v.map(x=>`<li>${typeof x==='object'?esc(JSON.stringify(x,null,2)):esc(x)}</li>`).join('')}</ul>`:(typeof v==='object'?`<pre>${esc(JSON.stringify(v,null,2))}</pre>`:`<span>${esc(v)}</span>`)}</div>`).join('');
    return rows || `<pre>${esc(JSON.stringify(obj,null,2))}</pre>`;
  }
  function renderSuggestedActions(actions){
    const list=(Array.isArray(actions)?actions:[]).filter(a=>a&&a.action).slice(0,6);
    if(!list.length) return '';
    return `<div class="route-suggested-actions"><h4>Actionable next steps</h4>${list.map((a,i)=>`<button class="btn-secondary btn-sm" onclick='RouteAdmin.runSuggestedAction(${JSON.stringify(a).replace(/'/g,"&#39;")})'>${esc(a.label||a.action)}</button>`).join('')}</div>`;
  }


  function stopOptions(selected, options){ return options.map(o=>`<option value="${attr(o)}" ${String(selected||'')===o?'selected':''}>${esc(o.replace(/_/g,' '))}</option>`).join(''); }
  function activeRoute(){ return currentGenerated || currentTour; }
  function rerenderActiveRoute(){ if(currentGenerated) renderGenerated(currentGenerated,currentGenerated); else if(currentTour) renderDetail(currentTour); }
  async function persistStop(idx, leg){
    const t=activeRoute(); if(!t?.id) return null;
    const res = await api({action:'updateStop', tour_id:t.id, leg_index:idx, leg});
    if(res?.tour){ currentTour = normalizeTour(res.tour,res.tour); if(res.show){ const pos=currentShows.findIndex(x=>x.id===res.show.id); if(pos>=0) currentShows[pos]=res.show; else currentShows.push(res.show); } }
    return res;
  }
  function openStop(idx){
    const t = activeRoute(); const l = t?.legs?.[idx]; if(!l) return;
    const out = toolOut();
    const candidates = Array.isArray(l.candidate_venues) ? l.candidate_venues : [];
    out.innerHTML = `<div class="route-tool-card route-stop-detail"><h3>Stop Detail — ${esc(l.city || 'TBD')}</h3>
      <div class="route-stop-grid">
        <label>Venue<input id="stopVenue" class="form-input" value="${attr(l.suggested_venue||'')}"></label>
        <label>Booking Status<select id="stopBookingStatus" class="form-input">${stopOptions(l.booking_status||'prospect',['prospect','contacted','hold','offer','negotiating','deal_made','confirmed','advanced','settled','passed'])}</select></label>
        <label>Deal Status<select id="stopDealStatus" class="form-input">${stopOptions(l.deal_status||'not_started',['not_started','offer_needed','offer_sent','countered','deal_made','contract_sent','confirmed','settled'])}</select></label>
        <label>Hold Deadline<input id="stopHoldDeadline" class="form-input" value="${attr(l.hold_deadline||'')}"></label>
        <label>Target Rate USD<input id="stopRateTarget" type="number" class="form-input" value="${attr(l.rate_target_usd||l.suggested_guarantee_usd||'')}"></label>
        <label>Offer USD<input id="stopRateOffer" type="number" class="form-input" value="${attr(l.rate_offer_usd||'')}"></label>
        <label>Confirmed USD<input id="stopRateConfirmed" type="number" class="form-input" value="${attr(l.rate_confirmed_usd||'')}"></label>
        <label class="route-check-label"><input id="stopLocked" type="checkbox" ${l.locked?'checked':''}> Locked / confirmed</label>
        <label>Travel Mode<select id="stopTravelMode" class="form-input">${stopOptions(l.travel_mode_recommendation||'drive',['drive','fly','train','mixed','promoter_transport','tbd'])}</select></label>
        <label>Travel Feasibility<select id="stopTravelFeasibility" class="form-input">${stopOptions(l.travel_feasibility||'possible',['possible','tight','risky','not_possible','needs_day_off'])}</select></label>
        <label>Hotel Responsibility<select id="stopHotelResponsibility" class="form-input">${stopOptions(l.hotel_responsibility||'agency',['agency','promoter','band','shared','tbd','not_needed'])}</select></label>
        <label>Hotel Nights<input id="stopHotelNights" type="number" class="form-input" value="${attr(l.hotel_nights||'')}"></label>
        <label class="route-check-label"><input id="stopHotelRequired" type="checkbox" ${l.hotel_required?'checked':''}> Hotel required</label>
        <label class="route-check-label"><input id="stopAirportTransfer" type="checkbox" ${l.airport_transfer_required?'checked':''}> Airport transfer needed</label>
        <label>Transport Responsibility<select id="stopTransportResponsibility" class="form-input">${stopOptions(l.transport_responsibility||'agency',['agency','promoter','band','shared','tbd','not_needed'])}</select></label>
        <label>Backline Needed<select id="stopBacklineNeeded" class="form-input">${stopOptions(l.backline_needed||'partial',['none','partial','full','tbd'])}</select></label>
      </div>
      <label>Next Action<textarea id="stopNextAction" class="form-input form-textarea" rows="2">${esc(l.next_action||'')}</textarea></label>
      <label>Internal Notes<textarea id="stopNotes" class="form-input form-textarea" rows="3">${esc(l.notes||'')}</textarea></label>
      <div class="route-stop-actions"><button class="btn-primary" onclick="RouteAdmin.saveStopEdits(${idx})">Save Stop Edits</button><button class="btn-secondary" onclick="RouteAdmin.venueFinderForStop(${idx})">Run Grounded Venue Finder</button><button class="btn-secondary" onclick="RouteAdmin.generateEmail(${idx})">Generate Email</button></div>
      <div class="route-stop-venues"><h4>Candidate venues</h4>${candidates.length?candidates.map((v,vi)=>`<div class="route-venue-row"><strong>${esc(v.name||'Venue')}</strong><span>${esc([v.capacity,v.booking_method,v.website].filter(Boolean).join(' · '))}</span><p>${esc(v.fit_reason||v.reason||v.outreach_angle||'')}</p><div class="route-venue-actions"><button class="btn-secondary btn-sm" onclick="RouteAdmin.useCandidateVenue(${idx},${vi})">Use Venue</button><button class="btn-secondary btn-sm" onclick="RouteAdmin.generateVenueEmail(${idx},${vi})">Branded Email</button>${v.website?`<a class="btn-secondary btn-sm" href="${attr(v.website)}" target="_blank">Site</a>`:''}</div></div>`).join(''):'<div class="route-ai-empty">No candidate venues attached yet. Run Venue Finder for grounded options.</div>'}</div>
    </div>`;
  }
  function saveStopEdits(idx){
    const t=activeRoute(); const l=t?.legs?.[idx]; if(!l) return;
    l.suggested_venue = val('stopVenue');
    l.booking_status = val('stopBookingStatus');
    l.deal_status = val('stopDealStatus');
    l.hold_deadline = val('stopHoldDeadline');
    l.rate_target_usd = Number(val('stopRateTarget')) || null;
    l.rate_offer_usd = Number(val('stopRateOffer')) || null;
    l.rate_confirmed_usd = Number(val('stopRateConfirmed')) || null;
    l.locked = !!$('stopLocked')?.checked;
    l.next_action = val('stopNextAction');
    l.travel_mode_recommendation = val('stopTravelMode');
    l.travel_feasibility = val('stopTravelFeasibility');
    l.hotel_responsibility = val('stopHotelResponsibility');
    l.hotel_nights = Number(val('stopHotelNights')) || null;
    l.hotel_required = !!$('stopHotelRequired')?.checked;
    l.airport_transfer_required = !!$('stopAirportTransfer')?.checked;
    l.transport_responsibility = val('stopTransportResponsibility');
    l.backline_needed = val('stopBacklineNeeded');
    l.lodging = {...(l.lodging||{}), required:l.hotel_required, nights:l.hotel_nights, responsibility:l.hotel_responsibility};
    l.transport = {...(l.transport||{}), airport_transfer_required:l.airport_transfer_required, responsibility:l.transport_responsibility, mode:l.travel_mode_recommendation};
    l.notes = val('stopNotes');
    if(t.id){ persistStop(idx,l).then(()=>toast('✓ Stop saved to Firestore','success')).catch(e=>toast('Database save failed: '+e.message,'error')); }
    else toast('✓ Stop updated in this unsaved route draft','success');
    rerenderActiveRoute();
    openStop(idx);
  }
  async function venueFinderForStop(idx){
    const t=activeRoute(); const l=t?.legs?.[idx]; if(!l) return;
    const out=toolOut(); out.innerHTML=loading(`Running grounded Venue Finder for ${l.city}…`);
    try{
      const res=await post(VENUE_FINDER_API,{mode:'venues',location:[l.city,l.country].filter(Boolean).join(', '),genre:'darkwave, EBM, post-punk, industrial, goth, synth',maxCapacity:600,includeMainstream:false,limit:8});
      const items=res.items||res.results||res.venues||res.data?.items||[];
      l.candidate_venues = items.map(v=>({name:v.name,capacity:v.capacity_display||v.capacity,fit_reason:v.recommendation_reason||v.description,booking_method:v.booking_method,website:v.website,booking_form_url:v.booking_form_url,email:v.email,instagram:v.instagram,confidence_score:v.confidence_score,verification_sources:v.verification_sources||[],outreach_angle:v.recommendation_reason||v.description||''}));
      if(!l.suggested_venue && l.candidate_venues[0]) l.suggested_venue=l.candidate_venues[0].name;
      if(t.id) await persistStop(idx,l);
      rerenderActiveRoute();
      openStop(idx);
      toast(t.id?'✓ Venue Finder results saved to Firestore':'✓ Venue Finder results attached to stop','success');
    } catch(e){ out.innerHTML=errorBox('Venue Finder failed',e.message); }
  }

  async function saveGenerated(){
    if(!currentGenerated) return;
    try{ const saved = await api({action:'createTour', tour:currentGenerated, createShows:true}); toast(`✓ Saved ${saved.total_shows||currentGenerated.total_shows||0} shows to advancing`, 'success'); await initRoutePlannerAdmin(); if(saved.id) openTour(saved.id); }
    catch(e){ toast('Save failed: '+e.message,'error'); }
  }
  async function reviewCurrentRoute(auto=false){
    const t=currentGenerated||currentTour; if(!t) return;
    const out=toolOut(); if(out) out.innerHTML=loading(auto?'Running second-pass AI oversight…':'Reviewing route reasonability…');
    try{
      const review=await ai('review_route',{tour:t,artist:t.artist,region:t.region,requested_shows:t.requested_shows||t.total_shows,legs:t.legs||[]});
      t.route_review = review;
      if(t.id) api({action:'updateTour',id:t.id,updates:{route_review:review}}).catch(()=>{});
      const verdict=(review.verdict||'review').replace(/_/g,' ');
      if(out) out.innerHTML=`<div class="route-tool-card route-review-card"><h3>AI Oversight — ${esc(verdict)}</h3>${renderObject(review)}${renderSuggestedActions(review.suggested_actions||review.recommended_changes||[])}</div>`;
      toast(`✓ AI oversight complete: ${verdict}`,'success');
    }catch(e){ if(out) out.innerHTML=errorBox('AI oversight failed',e.message); if(!auto) toast('AI oversight failed: '+e.message,'error'); }
  }
  async function runSuggestedAction(action){
    const a=action||{}; const idx=Number.isInteger(a.leg_index)?a.leg_index:(a.leg_index==null?null:Number(a.leg_index));
    switch(a.action){
      case 'optimize_route': return optimizeCurrent();
      case 'estimate_budget': return estimateBudget();
      case 'research_venues_all': return researchVenuesAllStops();
      case 'venue_finder_stop': return venueFinderForStop(Number.isInteger(idx)?idx:0);
      case 'open_stop': return openStop(Number.isInteger(idx)?idx:0);
      case 'generate_email_stop': return generateEmail(Number.isInteger(idx)?idx:0);
      case 'analyze_anchors': return analyzeCurrentAnchors();
      case 'save_tour': return saveGenerated();
      default: toast('Suggested action is advisory only: '+(a.label||a.action||'Unknown'),'error');
    }
  }
  async function optimizeGenerated(){ return optimizeCurrent(); }
  async function optimizeSaved(){ return optimizeCurrent(); }
  async function optimizeCurrent(){
    const t = currentGenerated || currentTour; if(!t?.legs?.length) return;
    const out = toolOut(); out.innerHTML = loading('Optimizing route order with Gemini 3…');
    try{
      const result = await ai('optimize_route',{artist:t.artist,region:t.region,legs:t.legs,startDate:t.startDate,endDate:t.endDate});
      const optimized = result.optimized_legs || result.legs || t.legs;
      const next = normalizeTour({...t, legs:optimized, routing_strategy:result.routing_notes||result.routing_strategy||t.routing_strategy, estimated_total_km:result.total_km_estimate||t.estimated_total_km}, t);
      if(currentGenerated){ currentGenerated = next; renderGenerated(next,next); } else { currentTour = next; renderDetail(next); await renderMap(next.legs||[]); }
      const box = toolOut(); if(box) box.innerHTML = renderAnalysisCard('Route Optimized', result);
      toast('✓ Optimized route ready','success');
    } catch(e){ out.innerHTML = errorBox('Optimization failed', e.message); }
  }
  async function estimateBudget(){
    const t = currentGenerated || currentTour; if(!t) return;
    const out = toolOut(); out.innerHTML = loading('Estimating budget…');
    try{ const data=await ai('estimate_budget',{tour:t,legs:t.legs||[]}); out.innerHTML = `<div class="route-tool-card"><h3>Budget Estimate</h3>${renderObject(data)}${renderSuggestedActions(data.suggested_actions||[])}</div>`; }
    catch(e){ out.innerHTML = errorBox('Budget failed', e.message); }
  }
  async function suggestVenues(idx){
    const t=currentGenerated||currentTour; const leg=t?.legs?.[idx]; if(!leg) return;
    const out=toolOut(); out.innerHTML=loading(`Finding venues in ${leg.city}…`);
    try{
      const data=await ai('suggest_venues',{artist:t.artist,city:leg.city,country:leg.country,genre_context:'darkwave, EBM, post-punk, industrial, underground',capacity:'150-600',tour:t});
      const venues=data.venues||data.suggestions||data.recommendations||(Array.isArray(data)?data:[]);
      out.innerHTML=`<div class="route-tool-card"><h3>Venue Suggestions — ${esc(leg.city)}</h3>${venues.length?venues.map(v=>`<div class="route-venue-row"><strong>${esc(v.name||v.venue||v.title||'Venue')}</strong><span>${esc([v.capacity?v.capacity+' cap':'',v.type,v.tier,v.suitability].filter(Boolean).join(' · '))}</span><p>${esc(v.booking_contact_tip||v.notes||v.known_for||v.reasoning||v.strategic_note||'')}</p></div>`).join(''):renderObject(data)}</div>`;
    } catch(e){ out.innerHTML=errorBox('Venue search failed',e.message); }
  }

  async function researchVenuesAllStops(){
    const t=currentGenerated||currentTour; if(!t?.legs?.length) return;
    const stops=t.legs.map((l,i)=>({l,i})).filter(x=>!x.l.day_off);
    const out=toolOut(); out.innerHTML=loading(`Running grounded Venue Finder for ${stops.length} stops… this may take a bit.`);
    let ok=0, failed=0;
    for(const {l,i} of stops){
      try{
        const res=await post(VENUE_FINDER_API,{mode:'venues',location:[l.city,l.country].filter(Boolean).join(', '),genre:'darkwave, EBM, post-punk, industrial, goth, synth',maxCapacity:700,includeMainstream:false,limit:8});
        const items=res.items||res.results||res.venues||res.data?.items||[];
        l.candidate_venues = items.map(v=>({name:v.name,capacity:v.capacity_display||v.capacity,fit_reason:v.recommendation_reason||v.description,booking_method:v.booking_method,website:v.website,booking_form_url:v.booking_form_url,email:v.email,instagram:v.instagram,confidence_score:v.confidence_score,verification_sources:v.verification_sources||[],outreach_angle:v.recommendation_reason||v.description||''}));
        if(!l.suggested_venue && l.candidate_venues[0]) l.suggested_venue=l.candidate_venues[0].name;
        if(t.id) await persistStop(i,l);
        ok++;
        out.innerHTML=loading(`Venue research ${ok}/${stops.length} complete…`);
      }catch(e){ failed++; }
    }
    rerenderActiveRoute();
    out.innerHTML=`<div class="route-tool-card"><h3>Venue research complete</h3><p>${ok} stops researched${failed?`, ${failed} failed`:''}. Open any stop to see ranked venues and branded email buttons.</p></div>`;
    toast(t.id?'✓ Venue targets saved to Firestore':'✓ Venue targets attached to route draft', failed?'error':'success');
  }
  function useCandidateVenue(idx, venueIdx){
    const t=activeRoute(); const l=t?.legs?.[idx]; const v=l?.candidate_venues?.[venueIdx]; if(!l||!v) return;
    l.suggested_venue = v.name || l.suggested_venue;
    l.venue_address = v.address || l.venue_address || '';
    if(t.id) persistStop(idx,l).then(()=>toast('✓ Venue selected and saved','success')).catch(e=>toast('Save failed: '+e.message,'error'));
    else toast('✓ Venue selected for draft stop','success');
    rerenderActiveRoute(); openStop(idx);
  }
  async function generateVenueEmail(idx, venueIdx){
    const t=currentGenerated||currentTour; const leg=t?.legs?.[idx]; const v=leg?.candidate_venues?.[venueIdx];
    if(!leg||!v) return generateEmail(idx);
    return generateEmail(idx, v.name || v.venue || '', v);
  }

  async function generateEmail(idx, venueOverride='', venueData=null){
    const t=currentGenerated||currentTour; const leg=t?.legs?.[idx]; if(!leg) return;
    const venueName = venueOverride || leg.suggested_venue;
    const out=toolOut(); out.innerHTML=loading(`Generating branded email for ${venueName||leg.city}…`);
    try{ const email=await post(EMAIL_API,{emailType:'venue_pitch',data:{artist:t.artist,tour:t,city:leg.city,country:leg.country,venue:venueName,venueData,date:leg.date,deal:leg.deal_suggestion,rate_target_usd:leg.rate_target_usd,travel_mode:leg.travel_mode_recommendation}}); out.innerHTML=`<div class="route-tool-card"><h3>Branded Venue Email — ${esc(venueName||leg.city)}</h3><label>Subject<input class="form-input" value="${attr(email.subject||'')}"></label><label>Text<textarea class="form-input form-textarea" rows="8">${esc(email.text||'')}</textarea></label><details open><summary>HTML letterhead version</summary><textarea class="form-input form-textarea" rows="10">${esc(email.html||'')}</textarea></details></div>`; }
    catch(e){ out.innerHTML=errorBox('Email generation failed',e.message); }
  }
  async function adviseDeal(idx){
    const t=currentGenerated||currentTour; const leg=t?.legs?.[idx]; if(!leg) return;
    const offer = prompt(`Offer/deal to evaluate for ${leg.city}:`, leg.deal_suggestion || ''); if(offer===null) return;
    const out=toolOut(); out.innerHTML=loading('Evaluating deal…');
    try{ out.innerHTML=`<div class="route-tool-card"><h3>Deal Advisor — ${esc(leg.city)}</h3>${renderObject(await ai('advise_deal',{artist:t.artist,tour:t,city:leg.city,country:leg.country,venue:leg.suggested_venue,offer}))}</div>`; }
    catch(e){ out.innerHTML=errorBox('Deal advisor failed',e.message); }
  }
  async function chatAgent(){
    const q = prompt('Ask the booking AI about this tour:'); if(!q) return;
    const t=currentGenerated||currentTour||{}; const out=toolOut(); out.innerHTML=loading('Consulting booking AI…');
    try{ const data=await ai('chat',{question:q,tour:t,legs:t.legs||[]}); out.innerHTML=`<div class="route-tool-card"><h3>Booking AI</h3>${renderObject(data)}${renderSuggestedActions(data.suggested_actions||[])}</div>`; }
    catch(e){ out.innerHTML=errorBox('Booking AI failed',e.message); }
  }
  async function analyzeCurrentAnchors(){ const t=currentGenerated||currentTour; if(!t) return analyzeAnchors(); const out=toolOut(); out.innerHTML=loading('Analyzing current route anchors…'); try{ out.innerHTML=renderAnalysisCard('Current Route Anchor Analysis', await ai('analyze_anchors',{tour:t,artist:t.artist,region:t.region,legs:t.legs||[]})); } catch(e){ out.innerHTML=errorBox('Anchor analysis failed', e.message); } }

  async function openTour(id){
    const root=$('routeAdminShell'); root.innerHTML=loading('Opening tour workspace…');
    try{ const data=await api({action:'getTour',id}); currentTour=normalizeTour(data,data); currentGenerated=null; currentShows=data.shows||[]; renderDetail(currentTour); await renderMap(currentTour.legs||[]); }
    catch(e){ root.innerHTML=errorBox('Could not open tour', e.message); }
  }
  function renderDetail(t){
    $('routeAdminShell').innerHTML=`
      <section class="route-plan-shell">
        <div class="route-plan-topbar"><button class="btn-secondary btn-sm" onclick="RouteAdmin.init()">← Tour Library</button><div><p class="route-kicker">Saved tour workspace</p><h1>${esc(t.name||t.tour_name||'Untitled Tour')}</h1><span>${esc(t.artist||'')} · ${esc(t.region||'')} · ${esc(normalizeDateRange(t))}</span></div><div class="route-command-actions"><button class="btn-secondary btn-sm" onclick="RouteAdmin.duplicateTour('${attr(t.id)}')">Duplicate</button><button class="btn-danger btn-sm" onclick="RouteAdmin.deleteTour('${attr(t.id)}')">Delete</button></div></div>
        <div class="route-detail-grid">
          <section class="route-map-card"><div class="route-panel-title"><span>Saved route map</span><em>${esc(t.summary||t.routing_strategy||'')}</em></div><div id="routeMap" class="route-map route-map-detail"><div class="route-map-placeholder">Loading route map…</div></div></section>
          <section class="route-output-panel"><div class="route-panel-title"><span>AI workbench</span><em>Continue refining this saved tour.</em></div><div id="routeToolOutput">${renderWorkbench(t)}</div></section>
        </div>
        <section class="route-output-panel"><div class="route-panel-title"><span>Route legs</span><em>${currentShows.length} Firestore show records linked.</em></div>${routeMetrics(t)}<div class="route-leg-list">${(t.legs||[]).map(legRow).join('')}</div></section>
        <section class="route-output-panel"><div class="route-panel-title"><span>Advancing show records</span><em>Generated from saved route legs.</em></div><div class="route-show-grid">${currentShows.length?currentShows.map(showRow).join(''):'<div class="route-empty-small">No show records found.</div>'}</div></section>
      </section>`;
  }
  function showRow(s){ return `<div class="route-card"><div class="route-card-top"><div><div class="route-card-artist">${esc(s.status||'draft')}</div><h3>${esc(s.venue_name||s.city||'Show')}</h3></div></div><div class="route-card-meta"><span>${esc(s.date||'')}</span><span>${esc([s.city,s.country].filter(Boolean).join(', '))}</span></div><p>${esc([s.advancing_notes||'Ready for advancing details.', s.travel_mode_recommendation?('Travel: '+s.travel_mode_recommendation):'', s.hotel_responsibility?('Hotel: '+s.hotel_responsibility):'', s.backline_needed?('Backline: '+s.backline_needed):''].filter(Boolean).join(' · '))}</p></div>`; }
  async function duplicateTour(id){ const source=tours.find(t=>t.id===id) || currentTour; if(!source) return; const copy={...source,id:undefined,name:(source.name||source.tour_name||'Tour')+' Copy',tour_name:(source.tour_name||source.name||'Tour')+' Copy',status:'draft'}; try{ const saved=await api({action:'createTour',tour:copy,createShows:false}); toast('✓ Tour duplicated','success'); await initRoutePlannerAdmin(); if(saved.id) openTour(saved.id); } catch(e){ toast('Duplicate failed: '+e.message,'error'); } }
  async function deleteTour(id){ if(!confirm('Archive/delete this route and its generated show records?')) return; try{ await api({action:'deleteTour',id}); toast('✓ Route archived','success'); await initRoutePlannerAdmin(); } catch(e){ toast('Delete failed: '+e.message,'error'); } }

  async function ensureMap(){
    if(window.google?.maps){ mapReady=true; return; }
    if(document.getElementById('googleMapsScript')) return new Promise(resolve=>{ const iv=setInterval(()=>{ if(window.google?.maps){ clearInterval(iv); mapReady=true; resolve(); }},150); });
    const cfg=await fetch(MAPS_CONFIG).then(r=>r.json());
    const key=cfg.apiKey||cfg.key;
    if(!key) throw new Error('Google Maps key missing');
    await new Promise((resolve,reject)=>{ const s=document.createElement('script'); s.id='googleMapsScript'; s.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=marker`; s.onload=()=>{mapReady=true;resolve();}; s.onerror=()=>reject(new Error('Google Maps failed to load')); document.head.appendChild(s); });
  }
  function continentView(){
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if(tz.includes('America')) return {center:{lat:39,lng:-98},zoom:4,label:'North America'};
    if(tz.includes('Europe')) return {center:{lat:50,lng:10},zoom:4,label:'Europe'};
    if(tz.includes('Australia')||tz.includes('Pacific')) return {center:{lat:-25,lng:134},zoom:4,label:'Australia / Pacific'};
    if(tz.includes('Asia')) return {center:{lat:34,lng:90},zoom:3,label:'Asia'};
    return {center:{lat:30,lng:5},zoom:3,label:'Global'};
  }
  async function renderStarterMap(){
    const el=$('routeMap'); if(!el) return;
    try{ await ensureMap(); const view=continentView(); map=new google.maps.Map(el,{center:view.center,zoom:view.zoom,mapTypeId:'roadmap',disableDefaultUI:false,styles:darkMapStyle()}); el.classList.add('loaded'); }
    catch(e){ el.innerHTML=`<div class="route-map-placeholder route-map-fallback"><strong>${esc(continentView().label)} planning map</strong><span>Map key unavailable: ${esc(e.message)}</span></div>`; }
  }
  function clearMap(){ mapMarkers.forEach(m=>m.setMap(null)); mapLines.forEach(l=>l.setMap(null)); mapMarkers=[]; mapLines=[]; }
  async function geocode(city,country){
    const q=[city,country].filter(Boolean).join(', '); if(!q) return null;
    try{ const res=await fetch(MAPS_PROXY,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'geocode',query:q})}).then(r=>r.json()); const loc=res.results?.[0]?.geometry?.location || res.data?.results?.[0]?.geometry?.location; return loc ? {lat:loc.lat,lng:loc.lng} : null; } catch { return null; }
  }
  async function renderMap(legs){
    const el=$('routeMap'); if(!el) return;
    try{ await ensureMap(); if(!map) map=new google.maps.Map(el,{center:continentView().center,zoom:continentView().zoom,mapTypeId:'roadmap',disableDefaultUI:false,styles:darkMapStyle()}); clearMap(); const pts=[]; for(const [i,l] of (legs||[]).entries()){ if(l.day_off) continue; const loc=(l.lat&&l.lng)?{lat:Number(l.lat),lng:Number(l.lng)}:await geocode(l.city,l.country); if(loc){ pts.push(loc); const marker=new google.maps.Marker({position:loc,map,label:String(i+1),title:[l.city,l.suggested_venue].filter(Boolean).join(' · ')}); mapMarkers.push(marker); }} if(pts.length){ const line=new google.maps.Polyline({path:pts,geodesic:true,strokeColor:'#c8a96e',strokeOpacity:.95,strokeWeight:2,map}); mapLines.push(line); const bounds=new google.maps.LatLngBounds(); pts.forEach(p=>bounds.extend(p)); map.fitBounds(bounds,{top:50,right:50,bottom:50,left:50}); } else { await renderStarterMap(); } }
    catch(e){ el.innerHTML=`<div class="route-map-placeholder route-map-fallback">Map unavailable: ${esc(e.message)}</div>`; }
  }
  function darkMapStyle(){ return [{elementType:'geometry',stylers:[{color:'#101010'}]},{elementType:'labels.text.stroke',stylers:[{color:'#101010'}]},{elementType:'labels.text.fill',stylers:[{color:'#888'}]},{featureType:'water',elementType:'geometry',stylers:[{color:'#050505'}]},{featureType:'road',elementType:'geometry',stylers:[{color:'#242424'}]},{featureType:'poi',stylers:[{visibility:'off'}]},{featureType:'transit',stylers:[{visibility:'off'}]}]; }

  function systemTour(){
    $('routeAdminShell').innerHTML = `<section class="route-guide"><button class="btn-secondary btn-sm" onclick="RouteAdmin.init()">← Back to Planner</button><div class="route-mini-brand"><img src="/images/logo-mark-white.svg" alt=""><div><b>Route Planner</b><span>Operating model</span></div></div><h1>How to use the planner repeatedly</h1><div class="route-guide-grid"><section><b>1. Tour Library</b><p>Every draft and saved route lives in the left rail. Open, duplicate, delete/archive, and refresh from one place.</p></section><section><b>2. Map-first Builder</b><p>The planning page starts with your continent map, then plots generated and saved routing legs.</p></section><section><b>3. Anchors</b><p>Start from confirmed weekend/festival shows. AI analyzes gaps and builds around them.</p></section><section><b>4. AI Workbench</b><p>Generate, optimize, budget, suggest venues, advise deals, chat, and create branded emails without leaving the route.</p></section><section><b>5. Persistence</b><p>Save writes the tour and creates draft show records for advancing.</p></section><section><b>6. Iteration</b><p>Open the same tour repeatedly, duplicate versions, compare routing, and archive dead drafts.</p></section></div></section>`;
  }

  window.RouteAdmin = { init:initRoutePlannerAdmin, renderBuilder, generate, saveGenerated, optimizeGenerated, optimizeSaved, optimizeCurrent, estimateBudget, suggestVenues, generateEmail, adviseDeal, chatAgent, analyzeAnchors, analyzeCurrentAnchors, openTour, duplicateTour, deleteTour, systemTour, setFilter, refreshLibraryList, openStop, saveStopEdits, venueFinderForStop, researchVenuesAllStops, useCandidateVenue, generateVenueEmail, reviewCurrentRoute, runSuggestedAction };
  document.addEventListener('DOMContentLoaded',()=>{ if($('routeAdminShell')) initRoutePlannerAdmin(); });
})();
```

---

### 19.6 `recovery_deploy/js/advancing-admin.js`

```javascript
/* Melankolia Internal Ops — Advancing + Band Access + Email Generator */
const ADV_API = '/.netlify/functions/advancing-api';
const EMAIL_API = '/.netlify/functions/email-generator';
let _advShows = [], _advBands = [], _advTours = [], _advNotifs = [];

const advEsc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const advAttr = v => advEsc(v).replace(/`/g,'&#96;');
async function advApi(body){
  try{ const r = await fetch(ADV_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})}); return await r.json(); }
  catch(e){ return {success:false,error:e.message}; }
}
async function emailApi(data){
  const r = await fetch(EMAIL_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({emailType:'venue_pitch',data})});
  const j = await r.json(); if(!r.ok || j.success===false) throw new Error(j.error || 'Email generation failed'); return j.data || j;
}
function opsToast(msg,type='success'){ return typeof showToast==='function' ? showToast(msg,type) : alert(msg); }
function opsLoading(text='Loading…'){ return `<div class="ops-loading"><span></span>${advEsc(text)}</div>`; }
function opsError(title,msg){ return `<div class="ops-error"><strong>${advEsc(title)}</strong><br>${advEsc(msg||'')}</div>`; }
async function loadOpsData(){
  const [dash,bands,tours] = await Promise.all([advApi({action:'agency_get_dashboard'}),advApi({action:'agency_list_bands'}),advApi({action:'agency_list_tours'})]);
  if(!dash.success) throw new Error(dash.error || 'Advancing API unavailable');
  _advShows = dash.data?.shows || [];
  _advNotifs = dash.data?.notifications || [];
  _advBands = bands.success ? bands.data || [] : [];
  _advTours = tours.success ? tours.data || [] : [];
  return dash.data?.counts || {};
}

async function initAdvancing(){
  const el = document.getElementById('advancingAdminShell') || document.getElementById('view-advancing'); if(!el) return;
  el.innerHTML = opsLoading('Loading advancing center…');
  try{ const counts = await loadOpsData(); renderAdvancing(el, counts); }
  catch(e){ el.innerHTML = opsError('Advancing unavailable', e.message); }
}
function renderAdvancing(el, counts={}){
  const pending = _advShows.filter(s=>['pending_review','pending_promoter'].includes(s.status));
  el.innerHTML = `<section class="ops-shell">
    <div class="ops-topbar"><div><p class="route-kicker">Advancing Center</p><h1>Show logistics + promoter sheets</h1><span>Route Planner saves draft shows here. Promote each show through promoter info, approval, publishing, and band app visibility.</span></div><div class="ops-actions"><button class="btn-secondary" onclick="initAdvancing()">Refresh</button><button class="btn-primary" onclick="opsCreateShow()">New Show</button></div></div>
    <div class="ops-stat-grid">${opsStat('Draft',counts.draft||0)}${opsStat('Awaiting Promoter',counts.pending_promoter||0)}${opsStat('Pending Review',counts.pending_review||0)}${opsStat('Approved',counts.approved||0)}${opsStat('Published',counts.published||0)}</div>
    ${pending.length?`<div class="ops-panel"><div class="ops-panel-title"><span>Needs attention</span><em>Promoter submissions and shows waiting on review.</em></div><div class="ops-list">${pending.map(showRow).join('')}</div></div>`:''}
    <div class="ops-panel"><div class="ops-panel-title"><span>All advancing shows</span><em>${_advShows.length} show records linked from route planning and manual entries.</em></div>${_advShows.length?`<div class="ops-table">${_advShows.map(showRow).join('')}</div>`:'<div class="ops-empty">No show records yet. Save a route from Route Planner or create one manually.</div>'}</div>
  </section>`;
}
function opsStat(label,count){ return `<div class="ops-stat"><strong>${advEsc(count)}</strong><span>${advEsc(label)}</span></div>`; }
function showRow(s){
  const bandNames = (s.band_ids||[]).map(id=>_advBands.find(b=>b.id===id)?.name).filter(Boolean).join(', ');
  return `<article class="ops-row" onclick="opsOpenShow('${advAttr(s.id)}')"><div><strong>${advEsc(s.venue_name||s.city||'Untitled Show')}</strong><span>${advEsc([s.date,[s.city,s.country].filter(Boolean).join(', '),bandNames].filter(Boolean).join(' · '))}</span></div><em>${advEsc((s.status||'draft').replace(/_/g,' '))}</em><button onclick="event.stopPropagation();opsEmailForShow('${advAttr(s.id)}')">Email</button></article>`;
}
function reqDefaults(r={}){ return { contacts:true, venue:true, schedule:true, technical:true, backline:true, guest_list:true, merch:true, hotel:true, transportation:true, settlement:true, hospitality:true, wifi:true, notes:true, ...r }; }
function reqToggleHtml(req){
  const labels={contacts:'Contacts',venue:'Venue details',schedule:'Schedule',technical:'Sound/technical',backline:'Backline',guest_list:'Guest list',merch:'Merch',hotel:'Hotel/lodging',transportation:'Transportation',settlement:'Settlement',hospitality:'Hospitality/catering',wifi:'Wi‑Fi',notes:'Additional notes'};
  const r=reqDefaults(req);
  return `<div class="ops-toggle-grid">${Object.entries(labels).map(([k,label])=>`<label><input type="checkbox" data-adv-req="${k}" ${r[k]?'checked':''}> ${label}</label>`).join('')}</div>`;
}
async function opsSaveReq(id){
  const req={}; document.querySelectorAll('[data-adv-req]').forEach(cb=>req[cb.dataset.advReq]=!!cb.checked);
  const r=await advApi({action:'agency_update_show',show_id:id,updates:{advancing_requirements:req}});
  if(r.success){ opsToast('✓ Promoter form toggles saved to Firestore'); opsOpenShow(id); } else opsToast(r.error||'Could not save toggles','error');
}
async function opsSetShowLinked(id, updates){
  const r=await advApi({action:'agency_update_show',show_id:id,updates});
  if(r.success){ opsToast('✓ Show updated and synced to route'); opsOpenShow(id); } else opsToast(r.error||'Could not update show','error');
}
async function opsOpenShow(id){
  const el = document.getElementById('advancingAdminShell') || document.getElementById('view-advancing'); if(!el) return;
  el.innerHTML = opsLoading('Opening show…');
  const res = await advApi({action:'agency_get_show',show_id:id});
  if(!res.success) return el.innerHTML = opsError('Could not open show', res.error);
  const s=res.data, bandNames=(s.band_ids||[]).map(id=>_advBands.find(b=>b.id===id)?.name).filter(Boolean).join(', ');
  el.innerHTML = `<section class="ops-shell"><div class="ops-topbar"><button class="btn-secondary btn-sm" onclick="initAdvancing()">← Advancing</button><div><p class="route-kicker">${advEsc(s.status||'draft')}</p><h1>${advEsc(s.venue_name||s.city||'Show')}</h1><span>${advEsc([s.date,[s.city,s.country].filter(Boolean).join(', '),bandNames].filter(Boolean).join(' · '))}</span></div><div class="ops-actions"><button class="btn-secondary" onclick="opsEmailForShow('${advAttr(s.id)}')">Generate Email</button><button class="btn-secondary" onclick="opsApproveShow('${advAttr(s.id)}')">Approve</button><button class="btn-primary" onclick="opsPublishShow('${advAttr(s.id)}')">Publish to Band App</button></div></div>
    <div class="ops-detail-grid"><div class="ops-panel"><div class="ops-panel-title"><span>Promoter link</span><em>Send this to promoter for advancing info.</em></div><input class="form-input" readonly value="${advAttr(s.promoter_url||'')}"><div class="ops-actions"><button class="btn-secondary" onclick="navigator.clipboard.writeText('${advAttr(s.promoter_url||'')}');opsToast('Promoter link copied')">Copy Link</button><a class="btn-secondary" target="_blank" href="${advAttr(s.promoter_url||'#')}">Open Form</a></div></div>
    <div class="ops-panel"><div class="ops-panel-title"><span>Promoter form toggles</span><em>Select exactly what the custom link should ask this venue/promoter to answer.</em></div>${reqToggleHtml(s.advancing_requirements)}<div class="ops-actions"><button class="btn-primary" onclick="opsSaveReq('${advAttr(s.id)}')">Save Form Toggles</button></div></div>
    <div class="ops-panel"><div class="ops-panel-title"><span>Travel / hotel / gear snapshot</span><em>Factors back into Route Planner and publishes to Band App after approval.</em></div><div class="ops-mini-grid"><div><b>Travel</b><span>${advEsc(s.travel_mode_recommendation||s.transport?.mode||'TBD')}</span></div><div><b>Hotel</b><span>${advEsc(s.hotel_responsibility||s.lodging?.responsibility||'TBD')}</span></div><div><b>Transfer</b><span>${s.airport_transfer_required?'Airport transfer needed':'No airport transfer marked'}</span></div><div><b>Backline</b><span>${advEsc(s.backline_needed||'TBD')}</span></div></div><div class="ops-actions"><button class="btn-secondary" onclick="opsSetShowLinked('${advAttr(s.id)}',{hotel_required:true,hotel_responsibility:'promoter'})">Promoter covers hotel</button><button class="btn-secondary" onclick="opsSetShowLinked('${advAttr(s.id)}',{airport_transfer_required:true,transport_responsibility:'promoter'})">Promoter handles airport transfer</button><button class="btn-secondary" onclick="opsSetShowLinked('${advAttr(s.id)}',{backline_needed:'full'})">Full backline needed</button></div></div>
    <div class="ops-panel"><div class="ops-panel-title"><span>Show data</span><em>Raw linked Firestore record.</em></div><pre>${advEsc(JSON.stringify(s,null,2))}</pre></div></div></section>`;
}
async function opsApproveShow(id){ const r=await advApi({action:'agency_approve_sheet',show_id:id,reviewed_by:'agency'}); if(r.success){opsToast('✓ Show approved'); opsOpenShow(id);} else opsToast(r.error||'Approve failed','error'); }
async function opsPublishShow(id){ const r=await advApi({action:'agency_publish_sheet',show_id:id}); if(r.success){opsToast('✓ Published to band app'); opsOpenShow(id);} else opsToast(r.error||'Publish failed','error'); }
async function opsCreateShow(){
  const venue = prompt('Venue name?'); if(!venue) return;
  const city = prompt('City?') || '';
  const date = prompt('Date? YYYY-MM-DD') || '';
  const bandId = (_advBands[0]?.id) || '';
  const r = await advApi({action:'agency_create_show',venue_name:venue,city,date,band_ids:bandId?[bandId]:[],status:'draft'});
  if(r.success){ opsToast('✓ Show created'); initAdvancing(); } else opsToast(r.error||'Create show failed','error');
}

async function initBandAccess(){
  const el = document.getElementById('bandAdminShell') || document.getElementById('view-bands'); if(!el) return;
  el.innerHTML = opsLoading('Loading band access…');
  try{ await loadOpsData(); renderBandAccess(el); }
  catch(e){ el.innerHTML = opsError('Band access unavailable', e.message); }
}
function renderBandAccess(el){
  el.innerHTML = `<section class="ops-shell"><div class="ops-topbar"><div><p class="route-kicker">Band App + Users</p><h1>Band portal access management</h1><span>Create band logins, reset passwords, archive access, and open the band app portal. Published advancing sheets become visible here.</span></div><div class="ops-actions"><a class="btn-secondary" target="_blank" href="/band-app/">Open Band App</a><button class="btn-primary" onclick="opsCreateBand()">Add Band/User</button></div></div>
  <div class="ops-panel"><div class="ops-panel-title"><span>Band users</span><em>${_advBands.length} active band portal accounts.</em></div>${_advBands.length?`<div class="ops-band-grid">${_advBands.map(bandCard).join('')}</div>`:'<div class="ops-empty">No band users yet.</div>'}</div>
  <div class="ops-panel"><div class="ops-panel-title"><span>How this links together</span><em>Route Planner → Advancing → Band App.</em></div><div class="ops-flow"><div>Route Planner saves shows</div><div>Advancing reviews + publishes</div><div>Band App shows approved/published sheets</div></div></div></section>`;
}
function bandCard(b){ return `<article class="ops-band-card"><strong>${advEsc(b.name)}</strong><span>@${advEsc(b.username||'')}</span><small>${advEsc((b.contacts||[]).map(c=>c.email).filter(Boolean).join(', ')||'No contact email')}</small><div class="ops-actions"><button class="btn-secondary btn-sm" onclick="opsResetBandPassword('${advAttr(b.id)}','${advAttr(b.name)}')">Reset Password</button><button class="btn-danger btn-sm" onclick="opsArchiveBand('${advAttr(b.id)}')">Archive</button></div></article>`; }
async function opsCreateBand(){
  const name=prompt('Band/user name?'); if(!name) return;
  const username=prompt('Login username?', name.toLowerCase().replace(/[^a-z0-9]+/g,'-')) || '';
  const password=prompt('Temporary password?', Math.random().toString(36).slice(2,10)) || '';
  const email=prompt('Contact email?') || '';
  const r=await advApi({action:'agency_create_band',name,username,password,contacts:email?[{email}]:[]});
  if(r.success){ opsToast('✓ Band user created'); alert(`Band App login\nUsername: ${username}\nPassword: ${password}`); initBandAccess(); } else opsToast(r.error||'Create band failed','error');
}
async function opsResetBandPassword(id,name){ const pw=prompt(`New password for ${name}:`, Math.random().toString(36).slice(2,10)); if(!pw) return; const r=await advApi({action:'agency_update_band_password',band_id:id,new_password:pw}); if(r.success){ opsToast('✓ Password reset'); alert(`New password for ${name}: ${pw}`); } else opsToast(r.error||'Reset failed','error'); }
async function opsArchiveBand(id){ if(!confirm('Archive this band/user login?')) return; const r=await advApi({action:'agency_archive_band',band_id:id}); if(r.success){ opsToast('✓ Band/user archived'); initBandAccess(); } else opsToast(r.error||'Archive failed','error'); }

function initEmailGenerator(){
  const el=document.getElementById('emailAdminShell') || document.getElementById('view-emails'); if(!el) return;
  const artists=(typeof getArtists==='function'?getArtists():[]).map(a=>a.name).filter(Boolean);
  el.innerHTML=`<section class="ops-shell"><div class="ops-topbar"><div><p class="route-kicker">Email Generator</p><h1>Branded venue outreach</h1><span>Generate standalone pitch emails, or use the Email buttons inside Route Planner/Advancing for contextual venue outreach.</span></div></div><div class="ops-detail-grid"><form class="ops-panel" onsubmit="opsGenerateStandaloneEmail(event)"><div class="ops-panel-title"><span>Pitch details</span><em>Used by the same generator as Route Planner.</em></div><label>Artist<select id="emailArtist" class="form-input"><option value="">Select artist…</option>${artists.map(a=>`<option>${advEsc(a)}</option>`).join('')}</select></label><label>Venue<input id="emailVenue" class="form-input" placeholder="Venue name"></label><label>City<input id="emailCity" class="form-input" placeholder="Berlin"></label><label>Date<input id="emailDate" class="form-input" placeholder="2026-10-16"></label><label>Deal / Ask<input id="emailDeal" class="form-input" placeholder="€800 guarantee / best-of door"></label><label>Notes<textarea id="emailNotes" class="form-input form-textarea" rows="4" placeholder="Routing context, capacity, local scene notes…"></textarea></label><button class="btn-primary" type="submit">Generate Email</button></form><div class="ops-panel"><div class="ops-panel-title"><span>Generated email</span><em>Subject, plain text, and HTML.</em></div><div id="emailOutput" class="ops-empty">Fill the form and generate.</div></div></div></section>`;
}
async function opsGenerateStandaloneEmail(e){ e.preventDefault(); const out=document.getElementById('emailOutput'); out.innerHTML=opsLoading('Generating branded email…'); try{ const email=await emailApi({artist:document.getElementById('emailArtist').value,venue:document.getElementById('emailVenue').value,city:document.getElementById('emailCity').value,date:document.getElementById('emailDate').value,deal:document.getElementById('emailDeal').value,notes:document.getElementById('emailNotes').value}); out.innerHTML=emailOutput(email); }catch(err){ out.innerHTML=opsError('Email failed',err.message); } }
async function opsEmailForShow(id){ const s=_advShows.find(x=>x.id===id) || (await advApi({action:'agency_get_show',show_id:id})).data; const artist=(s.band_ids||[]).map(id=>_advBands.find(b=>b.id===id)?.name).filter(Boolean)[0] || s.artist || 'Artist'; const out=document.getElementById('routeAiOutput')||document.getElementById('routeToolOutput')||document.getElementById('advancingAdminShell')||document.getElementById('emailOutput'); if(out) out.innerHTML=opsLoading('Generating branded email…'); try{ const email=await emailApi({artist,venue:s.venue_name,city:s.city,country:s.country,date:s.date,deal:s.deal_suggestion||s.deal||'',notes:s.notes||s.advancing_notes||''}); if(out) out.innerHTML=`<div class="ops-panel">${emailOutput(email)}</div>`; opsToast('✓ Email generated'); }catch(err){ if(out) out.innerHTML=opsError('Email failed',err.message); } }
function emailOutput(email){ return `<label>Subject<input class="form-input" value="${advAttr(email.subject||'')}"></label><label>Plain text<textarea class="form-input form-textarea" rows="10">${advEsc(email.text||'')}</textarea></label><details open><summary>HTML version</summary><textarea class="form-input form-textarea" rows="12">${advEsc(email.html||'')}</textarea></details>`; }
```

---

## 20. Existing Project Docs

### 20.1 Route Planner Booking Workflow Doc

# Melankolia Route Planner — Booking Workflow Research Notes

Date: 2026-06-27

## Core research finding

A route planner should not imply that AI can simply “make a tour happen.” Real touring unfolds as a booking pipeline: initial routing idea → market list → anchor dates / holds → outreach → offers → negotiation → deal made → confirmed → advancing → show day → settlement.

Tour routing, booking, and advancing are related but distinct:

- **Routing** decides how dates/cities fit together in a workable sequence.
- **Booking** secures buyers, dates, venues, rates, holds, and confirmed deals.
- **Advancing** turns confirmed dates into operational show days: load-in, backline, hospitality, settlement, contacts, schedules, parking, merch, and local logistics.

The planner should treat every stop as a living booking/deal record, not just a map pin.

## Sources reviewed

- Eventric / MasterTour: emphasizes that routing is more than city order; real constraints include drive time, show spacing, recovery, costs, fatigue, and revisiting decisions as dates confirm.
- Ari’s Take advancing guide: confirms that advancing happens after confirmation and requires one final detail email/checklist before show day.
- ASCAP booking-your-own-tour guidance: recommends tracking held dates and city names while booking evolves.
- Toursmart product positioning: AI route generation, venue map, daily plans, export; opportunity is deeper genre-specific agency workflow and actual deal-state tracking.
- Search results on booking-agent workflow: holds are tied to routing decisions, deadlines, buyer history, radius/context, guarantees vs. door deals, and confirmation status.

## Product implications for Melankolia

### 1. Route generation should create a draft booking pipeline

Each generated stop should include:

- city / country / date
- candidate venue(s)
- booking status: prospect, contacted, hold, offer, negotiating, deal_made, confirmed, advanced, settled, passed
- deal status: not_started, offer_needed, offer_sent, countered, deal_made, contract_sent, confirmed, settled
- locked/confirmed flag
- target rate, offered rate, confirmed rate
- hold deadline
- contact status
- next action
- internal notes
- advancing notes

### 2. Established route options should be first-class inputs

The builder must allow already-established or partially established route pieces:

`City | Date | Venue | Deal | Status`

Examples:

- `Berlin | 2026-10-16 | Urban Spree | €800 guarantee | hold`
- `Amsterdam | 2026-10-18 | OCCII | 70/30 door after costs | offer`
- `Paris | 2026-10-22 | Petit Bain | €1000 guarantee | confirmed`

### 3. Venue Finder should be wrapped into stop-level research

For each stop, the planner should expose two venue actions:

- Fast AI venue suggestions for quick ideation.
- Grounded Venue Finder for verified venue data: capacity, booking method, website, email/form/Instagram, fit reason, confidence, and verification sources.

### 4. Stop detail is the operational center

The main route list should be clickable. Clicking a stop should show:

- venue info
- candidate venues
- rate target / offer / confirmed rate
- hold deadline
- booking/deal status
- locked confirmation state
- next action
- notes
- email generation
- deal advisor
- Venue Finder research

### 5. Save route should feed Advancing

Once a route has meaningful confirmed/deal-made stops, saving creates show records. Advancing then takes over for promoter sheets, approval, publishing to band app, and show-day logistics.

## Current implementation checkpoint

Implemented in `route-pipeline-v1`:

- `ai-tour.js` now uses fast Gemini route model with a JSON timeout guard so frontend no longer receives Netlify HTML timeout pages.
- Generated legs include booking/deal pipeline fields.
- Builder input renamed to “Established Holds / Confirmed Anchors.”
- Each route leg is clickable and opens Stop Detail.
- Stop Detail supports editable booking status, deal status, venue, hold deadline, target/offer/confirmed rates, locked flag, next action, and notes.
- Per-stop buttons include Details, Grounded Venue Finder, Fast Venues, Email, and Deal.
- Grounded Venue Finder calls the existing `geminiSearch` venue pipeline and attaches candidate venues to the stop.


---

### 20.2 Full Scope Agent Handoff Doc

[missing: melankoliaagency/public/docs/AGENT_HANDOFF_FULL_SCOPE.md]

---

### 20.3 Venue Finder Prompt Workflow Doc

# Melankolia Venue Finder — Upgraded Universal Prompt / Workflow

Updated 2026-06-26.

The live Venue Finder now uses a two-step Gemini pipeline behind the Netlify Function `/.netlify/functions/geminiSearch`. The same content is published at `/docs/venue-finder-prompt-workflow.md`.

## User Parameters

- `band` for genre detection
- `location` / target sector
- editable `genre` input
- `maxCapacity` numeric cap
- `includeMainstream` toggle for full-spectrum vs underground-only search

## Genre Detection Prompt

```text
You are an expert music genre classifier with encyclopedic knowledge of all musical movements, subcultures, and eras.
Analyze the artist/band "${band}" and identify their primary musical genre and precise subgenres.

CRITICAL INSTRUCTIONS:
- Identify the core genre (e.g., Hip-Hop, Indie Rock, Jazz, Techno, Metal, Folk).
- Identify up to 2 precise subgenres (e.g., Emo Rap, Post-Punk, Hard Bop, Minimal House, Shoegaze).
- Return ONLY 2-3 specific, comma-separated words (e.g., "Indie Rock, Post-Punk" or "Jazz, Hard Bop").
- Do not write any introduction, punctuation, or explanations.
```

## Researcher System Instruction

```text
You are a professional music booking agent and industry researcher.
Your goal is to compile a detailed, grounded research dossier on active music venues and promoters/collectives in the requested location that book the requested genre.

RESEARCH PROTOCOL FOR CONTACTS & DATA:
1. Search Google and use real source pages.
2. Only record websites/socials when a direct, verifiable active URL is found.
3. Do not hallucinate or guess contact emails. If no verified email exists, clearly state "No verified email found" and identify the best alternative route such as contact form, Instagram DM, or Facebook Messenger.
4. Document source URLs used to confirm active status, booking methods, coordinates, genre relevance, and capacity.
5. Identify the top 3 outstanding matches for the genre and size constraints with a short rationale.
6. Keep the final output as a structured Markdown dossier with verification trails.
```

## Venue Research Prompt Template

```text
Find up to 12 active music venues in "${location}" suitable for "${genre}" acts.

INPUT SEARCH PARAMETERS:
- Genre Target: ${genre}
- Maximum Venue Capacity Cap: ${capValue} attendees. Exclude venues strictly larger than this limit unless they have separate smaller rooms/stages within the cap.
- Search Scope: ${scopeText}

For each venue, research: name, city, website, Instagram, Facebook, booking method, verified email if public, booking form URL if any, capacity, venue type, similar acts historically booked, coordinates if verified, confidence score, and source URLs.

Flag the top 3 venues that are the strongest matches and explain why.
```

## Promoter Research Prompt Template

```text
Find up to 8 active music promoters, collectives, bookers, event series, or agencies in "${location}" that book "${genre}" acts.

INPUT SEARCH PARAMETERS:
- Genre Target: ${genre}
- Search Scope: ${scopeText}

For each promoter/collective, research: name, type, website, Instagram, Facebook, booking method, verified email if public, associated acts/events, confidence score, and source URLs.

Flag the top 3 strongest matches and explain why.
```

## Parser System Instruction

```text
You are a strict data-parsing compiler. Your task is to extract the details from the provided research dossier and format it into the exact JSON schema requested.

COMPLIANCE RULES:
- Never guess or construct data.
- If no contact email was verified in the dossier, set the email field to null.
- If the dossier indicates they use a web form or Instagram for bookings instead of email, set booking_method to contact_form or instagram_dm and map the respective URL.
- Ensure capacity_numeric is an integer if documented, or null if unknown.
- Select the top 3 entries flagged as best fit in the dossier, set is_top_recommendation true, and write a 1-sentence recommendation_reason.
- For all other entries, set is_top_recommendation false and recommendation_reason null.
- Preserve verification source URLs from the dossier.
- Output JSON only.
```

## Live Implementation

Review the exact deployed proxy source here:

`/docs/gemini-search-function.js`


---

## 21. One-Paragraph Orientation for the Next Agent

You are working on a Netlify + Firestore internal booking operations system for Melankolia Agency. Do not treat it as a demo or generic travel planner. It must support real underground music booking: exact requested show counts, realistic human travel constraints, venue prospecting, deal pipeline status, branded outreach, promoter advancing, and performer-facing logistics. The core agentic pattern is: generate compact route → hydrate backend defaults → enforce show/venue contract → run second-pass AI oversight → render actionable next steps → save linked Firestore tour/show records → collect promoter advancing → sync back to route → publish to Band App. Preserve the direct Netlify deployment workflow and do not modify the locked public splash/Three.js homepage without explicit approval.

/**
 * Melankolia Tour Planner — AI Tour Intelligence v2
 * Deep booking-agent knowledge baked in.
 * Models: gemini-3.1-pro-preview (routing) | gemini-3.5-flash (fast)
 * Gemini 2.x is strictly forbidden.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const MODELS = {
  PRO: 'gemini-3.1-pro-preview',
  FLASH: 'gemini-3.5-flash'
};

async function callGemini(model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9, maxOutputTokens: 8192 }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ---- DEEP BOOKING CONTEXT ----
const BOOKING_CONTEXT = `
You are an experienced music booking agent at Melankolia Agency, a specialist agency for dark/underground music:
darkwave, EBM, post-punk, industrial, coldwave, synthpop, minimal wave, goth.

Roster: Automelodi, Bestial Mouths, Bootblacks, Zanias, Blood Handsome, Blood Rave, CD Ghost,
Corbeau Hangs, Creux Lies, Dame Area, Daniel Myer, Die Sexual, Donzii, Jorge Elbrecht,
Light Asylum, Male Tears, Mellow Code, Nox Novacula, Sacred Skin, Secret Attraction, Sleek Teeth,
Some Ember, Street Fever, Topographies, XTR Human, Yama Uba.

=== HOW PROFESSIONAL BOOKING AGENTS PLAN TOURS ===

PHASE 1 — STRATEGY & ANCHORS
- Identify the TOUR WINDOW: spring (Mar-May), fall (Sept-Nov) are peak. Avoid December/January for underground acts.
- Anchor shows are the foundation. An anchor is a confirmed, high-value show in a major market — a festival slot, a well-known venue, a promoter relationship. Not every tour has an anchor, but when you have one, you build the route around it.
- Anchor rules: 1-3 anchors per 10-14 day leg. Anchors should be on Fri or Sat. Never put an anchor on a Monday.
- Without anchors: identify the 2-3 strongest markets for this artist (where streaming/social data shows audience density) and treat those as pseudo-anchors.

PHASE 2 — ROUTING LOGIC
- Route as a line or a regional loop — never zigzag. Geography first, always.
- Optimal drive between shows: 2-5 hours / 150-400 km. Hard cap: 6 hours / 500 km without a rest day after.
- Show spacing: 5-7 shows per week maximum for underground acts (they often travel without crew).
- Day-of-week priority: Fri/Sat anchor shows, Thu as strong support, Wed/Sun as acceptable, Mon/Tue for strong markets only or travel days.
- Dead days (no show, no meaningful travel) are a budget drain — minimize them but don't eliminate them. 1 dead day per 7 is healthy for rest.
- Always include 1 routing show before any anchor to warm up.
- End the tour in a major market or near the artist's home city to minimize final travel costs.

PHASE 3 — MARKET TIERS
USA Tier 1 (strongest underground markets): NYC, LA, Chicago, SF/Oakland, Seattle, Portland
USA Tier 2: Denver, Austin, Dallas, Atlanta, Miami, Boston, Philadelphia, Detroit, Minneapolis, New Orleans
USA Tier 3 (test markets): Nashville, Phoenix, Kansas City, Baltimore, Pittsburgh, Raleigh, Columbus
Europe Tier 1: Berlin, London, Amsterdam, Paris, Brussels
Europe Tier 2: Hamburg, Cologne, Vienna, Prague, Warsaw, Barcelona, Madrid, Zurich, Stockholm, Copenhagen, Ghent
Europe Tier 3: Leipzig, Düsseldorf, Antwerp, Rotterdam, Lyon, Bordeaux, Porto, Wrocław, Bratislava

PHASE 4 — DEAL STRUCTURES
- Guarantee: flat fee regardless of attendance. Use for markets where artist has draw. Typical range $500-$3000 USD / €400-€2500 EUR.
- Door deal (split): artist takes 70-80% of door after venue expenses. Use for new markets.
- Guarantee vs. door (best of): ideal — artist gets the higher of the two. Push for this in mid-tier markets.
- Festival offers: flat fee, often includes travel/hotel. Accept $1500+ for underground acts in Europe, $2500+ in USA.
- Never accept a show with no deal structure in writing. Even an email confirmation is acceptable.

PHASE 5 — ADVANCING & LOGISTICS
- Start advancing (contacting venues for tech specs, guest lists, settlement) 4-6 weeks before show date.
- Confirm hotel/accommodation for every date 3 weeks out.
- Build a "day sheet" per show: load-in time, soundcheck, doors, show, settlement.
- Day sheet timeline: Load-in 4-5pm, Soundcheck 5-7pm, Doors 8-9pm, Show 10pm, Settlement at the bar after headliner set.
- Local support acts: always have one. They bring their own audience and reduce load on the headliner.

PHASE 6 — FINANCIAL REALITIES
- Underground acts touring USA on a 10-day run, 3-4 people: budget $8,000-$15,000 in expenses.
- Europe on a 10-day run: budget €5,000-€10,000 expenses.
- Merch is critical: 10-20% of door revenue in merch sales is a realistic target. Merch often covers lodging.
- Break-even: need average guarantee ≥ total expenses ÷ number of shows.
- Tour support: labels sometimes offer $1,000-$5,000 for tour support on releases. Factor this in.

=== UNDERGROUND CIRCUIT KNOWLEDGE ===
USA underground venues (darkwave/EBM/post-punk):
- NYC: TV Eye, Market Hotel, Baby's All Right, Berlin, C'mon Everybody, Trans-Pecos
- LA: The Smell, Zebulon, Troubadour (for bigger acts), Lodge Room
- Chicago: Empty Bottle, Sleeping Village, Schubas
- SF: The Independent, Bottom of the Hill, 1015 Folsom (for EBM), Great American Music Hall
- Seattle: Chop Suey, Neumos, Barboza
- Portland: Mississippi Studios, Doug Fir, Star Theater
- Austin: Mohawk (inside), Parish, Hole in the Wall
- Denver: Bluebird Theater, Larimer Lounge
Europe underground venues:
- Berlin: Musik & Frieden, Badehaus, Berghain Kantine (for EBM), SO36, Frannz Club
- London: Moth Club, Corsica Studios, EartH, Bush Hall
- Amsterdam: Paradiso small hall, Occii, De School alumni venues, Shelter
- Brussels: Botanique, Ancienne Belgique, Magasin 4
- Paris: La Maroquinerie, Supersonic, Le Glazart, Nouveau Casino
- Hamburg: Molotow, Knust, Uebel & Gefährlich
- Vienna: Arena, B72, Fluc
- Prague: Ankali, Cross Club
`;

// ---- HELPERS ----
function extractJSON(text, type = 'object') {
  const patterns = type === 'array'
    ? [/```json\s*(\[[\s\S]*?\])\s*```/, /(\[[\s\S]*\])/]
    : [/```json\s*(\{[\s\S]*?\})\s*```/, /(\{[\s\S]*\})/];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      try { return JSON.parse(m[1]); } catch {}
    }
  }
  throw new Error('AI did not return valid JSON. Raw: ' + text.slice(0, 300));
}

// ---- HANDLER ----
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }), headers }; }

  const { action, data } = body;

  try {
    let result;

    switch (action) {

      // ---- GENERATE FULL TOUR PLAN ----
      case 'generate_tour': {
        const { artist, region, startCity, endCity, startDate, endDate, budget, numShows, preferences, anchorShows, dealType } = data;

        const anchorText = anchorShows?.length
          ? `CONFIRMED ANCHORS (build route around these):\n${anchorShows.map(a => `  - ${a.city} on ${a.date} at ${a.venue || 'TBD'} (${a.deal || 'deal TBD'})`).join('\n')}`
          : 'No confirmed anchors yet — identify the strongest markets as pseudo-anchors and schedule them Fri/Sat.';

        const prompt = `${BOOKING_CONTEXT}

TOUR BRIEF:
- Artist: ${artist}
- Region: ${region}
- Start: ${startCity} on ${startDate}
- End: ${endCity || 'loop back near start'} by ${endDate}
- Target shows: ${numShows || 'as many as geography allows without over-touring'}
- Deal type preference: ${dealType || 'guarantee or best-of'}
- Budget per show: ${budget || 'market rate'}
- Special notes: ${preferences || 'none'}
${anchorText}

As the booking agent, produce a complete, realistic tour itinerary following professional routing principles.
Apply all rules: max 500km between consecutive show days, rest days after hard travel, Fri/Sat for best markets, anchor shows positioned correctly.

Return ONLY a valid JSON object (no markdown, no code fences, no commentary):
{
  "tour_name": "string — evocative tour name",
  "routing_strategy": "linear|regional_loop|hub_spoke",
  "summary": "2-3 sentences describing the routing logic and strategy",
  "total_days": number,
  "total_shows": number,
  "total_rest_days": number,
  "estimated_total_km": number,
  "avg_guarantee_target_usd": number,
  "projected_gross_usd": number,
  "legs": [
    {
      "day": number,
      "date": "YYYY-MM-DD",
      "city": "string",
      "country": "string",
      "venue_type": "club|festival|art_space|theatre|diy|bar",
      "suggested_venue": "specific venue name if known",
      "suggested_venue_search": "search query to find venues",
      "drive_from_previous_km": number,
      "drive_hours": number,
      "is_anchor_show": true|false,
      "is_routing_show": true|false,
      "day_off": true|false,
      "day_type": "anchor|routing|day_off|travel",
      "day_of_week": "Mon|Tue|Wed|Thu|Fri|Sat|Sun",
      "deal_suggestion": "guarantee|door|best_of|festival",
      "suggested_guarantee_usd": number or null,
      "local_support_needed": true|false,
      "notes": "routing rationale and practical notes",
      "advancing_notes": "what to confirm 4-6 weeks out"
    }
  ],
  "anchor_strategy": "explanation of how anchors were placed and why",
  "routing_notes": "key decisions made in the routing",
  "fill_gaps": ["cities worth adding if a date opens up"],
  "warnings": ["routing issues, tight drives, risky dates"],
  "advancing_checklist": ["5-7 items to advance before departure"],
  "ai_tips": ["4-6 specific, actionable tips for this artist on this specific route"]
}`;

        const text = await callGemini(MODELS.PRO, prompt);
        result = extractJSON(text, 'object');
        break;
      }

      // ---- ANALYZE ANCHORS & SUGGEST ROUTING ----
      case 'analyze_anchors': {
        const { artist, anchors, region, tourWindow } = data;

        const prompt = `${BOOKING_CONTEXT}

Artist: ${artist}
Region: ${region}
Tour window: ${tourWindow || 'flexible'}
Confirmed or potential anchor shows:
${anchors.map(a => `- ${a.city} ${a.date ? 'on ' + a.date : '(date TBD)'} ${a.venue ? 'at ' + a.venue : ''}`).join('\n')}

As a booking agent, analyze these anchors and advise on:
1. Are the anchors well-placed for routing?
2. What routing shows should fill the gaps between them?
3. Which markets are missing that are geographically logical?
4. What deal structure should each anchor pursue?

Return ONLY valid JSON (no markdown):
{
  "anchor_assessment": [
    {
      "city": "string",
      "date": "string",
      "assessment": "strong|acceptable|problematic",
      "day_of_week_ok": true|false,
      "note": "string"
    }
  ],
  "routing_gaps": [
    {
      "between": "City A → City B",
      "gap_km": number,
      "suggested_fills": ["city1", "city2"],
      "urgency": "must_fill|nice_to_have"
    }
  ],
  "missing_markets": ["city1", "city2"],
  "deal_suggestions": [
    { "city": "string", "deal_type": "guarantee|door|best_of", "target_usd": number, "reasoning": "string" }
  ],
  "overall_verdict": "strong|needs_work|problematic",
  "verdict_summary": "2-3 sentence honest assessment"
}`;

        const text = await callGemini(MODELS.FLASH, prompt);
        result = extractJSON(text, 'object');
        break;
      }

      // ---- OPTIMIZE ROUTE ORDER ----
      case 'optimize_route': {
        const { cities, startDate, artist, region } = data;

        const prompt = `${BOOKING_CONTEXT}

Artist: ${artist || 'artist on roster'}
Region: ${region || 'USA'}
Starting date: ${startDate}
Cities to visit (in no particular order): ${cities.join(', ')}

Apply professional routing logic: minimize total km, respect day-of-week show quality, avoid backtracking, identify the best anchor cities.

Return ONLY valid JSON (no markdown):
{
  "optimized_order": ["city1", "city2"],
  "routing_strategy": "string",
  "total_km_optimized": number,
  "total_km_naive": number,
  "savings_km": number,
  "anchor_recommendations": ["which cities should be Fri/Sat and why"],
  "problem_legs": [{ "from": "city", "to": "city", "km": number, "issue": "string" }],
  "suggested_additions": [{ "city": "string", "between": "City A and City B", "reason": "string" }],
  "day_by_day": [
    { "day": number, "city": "string", "drive_km": number, "day_of_week": "string", "note": "string" }
  ]
}`;

        const text = await callGemini(MODELS.PRO, prompt);
        result = extractJSON(text, 'object');
        break;
      }

      // ---- BUDGET ESTIMATE ----
      case 'estimate_budget': {
        const { cities, numPeople, numDays, numShows, region, vanRental, avgGuarantee, tourSupport } = data;

        const prompt = `${BOOKING_CONTEXT}

Tour parameters:
- Region: ${region}
- Cities: ${(cities || []).join(', ') || 'not specified'}
- People on tour: ${numPeople || 4}
- Tour days: ${numDays}
- Number of shows: ${numShows || Math.round(numDays * 0.7)}
- Average guarantee per show: $${avgGuarantee || 800} USD
- Van/vehicle rental needed: ${vanRental ? 'yes' : 'no — band has own vehicle'}
- Tour support from label: $${tourSupport || 0}

Build a realistic, itemized tour budget based on the underground circuit for this genre.

Return ONLY valid JSON (no markdown):
{
  "summary": "string",
  "revenue": {
    "show_guarantees_total": number,
    "merch_estimate": number,
    "tour_support": number,
    "total_projected_revenue": number
  },
  "expenses": {
    "fuel_total": number,
    "van_rental_total": number or null,
    "lodging_total": number,
    "food_per_diem_total": number,
    "agent_commission": number,
    "miscellaneous": number,
    "total_expenses": number
  },
  "daily_breakdown": {
    "fuel_per_day": number,
    "lodging_per_person_per_day": number,
    "food_per_person_per_day": number,
    "van_rental_per_day": number or null
  },
  "net_profit_loss": number,
  "break_even_guarantee_per_show": number,
  "is_viable": true|false,
  "viability_note": "string",
  "merch_target_per_show": number,
  "savings_tips": ["3-4 specific tips"]
}`;

        const text = await callGemini(MODELS.FLASH, prompt);
        result = extractJSON(text, 'object');
        break;
      }

      // ---- VENUE SUGGESTIONS ----
      case 'suggest_venues': {
        const { city, country, genre, capacity } = data;

        const prompt = `${BOOKING_CONTEXT}

Find the best underground/dark music venues in ${city}, ${country || ''} for ${genre || 'darkwave/EBM/post-punk'} acts, capacity ~${capacity || '200-500'}.
Prioritize venues with history of booking this genre. Be specific and realistic — only name venues that actually exist or are well-known in the circuit.

Return ONLY a valid JSON array (no markdown):
[
  {
    "name": "string",
    "address": "neighborhood or street",
    "capacity": number or null,
    "type": "club|bar|art_space|theatre|festival_stage|diy",
    "known_for": "string — genre/acts typically booked here",
    "notes": "why this suits the genre",
    "booking_contact_tip": "how to reach the talent buyer",
    "deal_type_typical": "guarantee|door|best_of",
    "tier": "primary|secondary"
  }
]`;

        const text = await callGemini(MODELS.FLASH, prompt);
        result = extractJSON(text, 'array');
        break;
      }

      // ---- DEAL NEGOTIATION ADVISOR ----
      case 'advise_deal': {
        const { artist, city, venue, capacity, artistDraw, offerType, offerAmount } = data;

        const prompt = `${BOOKING_CONTEXT}

Deal to evaluate:
- Artist: ${artist}
- City: ${city}
- Venue: ${venue || 'unknown venue'}
- Venue capacity: ${capacity || 'unknown'}
- Artist expected draw in this market: ${artistDraw || 'unknown'}
- Offer type: ${offerType || 'guarantee'}
- Offer amount: $${offerAmount || 0}

As a booking agent, evaluate this offer and advise on negotiation.

Return ONLY valid JSON (no markdown):
{
  "offer_assessment": "strong|fair|low|insulting",
  "market_rate_range": "e.g. $800-$1500",
  "counter_suggestion": number,
  "negotiation_points": ["point 1", "point 2"],
  "accept_if": "conditions under which to accept as-is",
  "walk_away_if": "conditions under which to pass",
  "deal_structure_recommendation": "guarantee|door|best_of — and why",
  "additional_asks": ["merch split", "hotel", "backline", etc]
}`;

        const text = await callGemini(MODELS.FLASH, prompt);
        result = extractJSON(text, 'object');
        break;
      }

      // ---- FREE CHAT ----
      case 'chat': {
        const { message, context } = data;

        const prompt = `${BOOKING_CONTEXT}

Current context: ${context || 'no active tour'}

User message: "${message}"

Reply as an expert booking agent at Melankolia Agency. Be direct, specific, and practical.
Reference actual venues, cities, deals, or routing principles when relevant.
Keep it concise — 2-4 sentences unless a longer answer is clearly needed.
Plain text only.`;

        result = { reply: await callGemini(MODELS.FLASH, prompt) };
        break;
      }

      default:
        return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}` }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: result }) };

  } catch (err) {
    console.error('[ai-tour error]', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

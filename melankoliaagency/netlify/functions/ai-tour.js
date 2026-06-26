/**
 * Melankolia Tour Planner — AI Tour Intelligence
 * Uses Gemini 3.1 Pro Preview for deep route planning
 * Uses Gemini 3.5 Flash for fast suggestions & chat
 * NO GEMINI 2.x MODELS ANYWHERE IN THIS FILE
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Gemini 3.x model strings — Gemini 2.x is strictly forbidden
const MODELS = {
  PRO: 'gemini-3.1-pro-preview',    // Deep reasoning — full tour planning
  FLASH: 'gemini-3.5-flash'          // Fast — quick suggestions, venue tips, chat
};

async function callGemini(model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 1.0,
      maxOutputTokens: 8192
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

const MELANKOLIA_CONTEXT = `
You are the AI touring intelligence for Melankolia Agency, a booking agency specializing in dark/underground music:
darkwave, EBM, post-punk, industrial, coldwave, synthpop.

Key artists on the roster: Automelodi, Bestial Mouths, Bootblacks, Zanias, Blood Handsome, Blood Rave,
CD Ghost, Corbeau Hangs, Creux Lies, Dame Area, Daniel Myer, Die Sexual, Donzii, Jorge Elbrecht,
Light Asylum, Male Tears, Mellow Code, Nox Novacula, Sacred Skin, Secret Attraction, Sleek Teeth,
Some Ember, Street Fever, Topographies, XTR Human, Yama Uba.

You understand the underground music touring circuit deeply:
- USA circuit: NYC, LA, Chicago, SF, Seattle, Portland, Denver, Austin, Dallas, Atlanta, Miami, Boston, Philadelphia, Detroit, Minneapolis
- Europe circuit: Berlin, London, Amsterdam, Brussels, Paris, Cologne, Hamburg, Vienna, Prague, Warsaw, Barcelona, Madrid, Zurich, Stockholm, Copenhagen
- Key underground venues: clubs, DIY spaces, art galleries, small theatres (200-800 cap)
- Drive rules: max 300 miles / 500 km between consecutive shows
- Typical guarantee range for this genre: $500-$3000 USD / €400-€2500
- Tour legs typically: 7-14 days continuous, with anchor shows on Fri/Sat
`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }), headers };
  }

  const { action, data } = body;

  try {
    let result;

    switch (action) {

      case 'generate_tour': {
        const { artist, region, startCity, endCity, startDate, endDate, budget, numShows, preferences } = data;

        const prompt = `${MELANKOLIA_CONTEXT}

Generate a detailed touring route plan with the following parameters:
- Artist: ${artist}
- Region: ${region} (USA or Europe)
- Start city: ${startCity}
- End city: ${endCity || 'flexible / loop back to start'}
- Date range: ${startDate} to ${endDate}
- Budget per show (guarantee sought): ${budget || 'flexible'}
- Target number of shows: ${numShows || 'as many as makes geographic sense'}
- Special preferences: ${preferences || 'none'}

Return a JSON object (and ONLY the JSON object, no markdown, no code fences) with this exact structure:
{
  "tour_name": "string",
  "summary": "2-3 sentence overview of the routing strategy",
  "total_days": number,
  "total_shows": number,
  "estimated_total_km": number,
  "routing_model": "linear or hub_spoke or regional_loop",
  "legs": [
    {
      "day": number,
      "date": "YYYY-MM-DD",
      "city": "string",
      "country": "string",
      "venue_type": "club or festival or art_space or theatre or diy",
      "suggested_venue_search": "search query to find venues in this city",
      "drive_from_previous_km": number,
      "drive_hours": number,
      "notes": "string",
      "is_anchor_show": true or false,
      "day_off": true or false
    }
  ],
  "gaps": ["list of cities worth adding if routing allows"],
  "warnings": ["any routing issues or concerns"],
  "ai_tips": ["3-5 specific tips for this artist on this route"]
}`;

        const text = await callGemini(MODELS.PRO, prompt);
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('AI did not return valid JSON');
        result = JSON.parse(jsonMatch[0]);
        break;
      }

      case 'suggest_venues': {
        const { city, country, genre, capacity } = data;

        const prompt = `${MELANKOLIA_CONTEXT}

List the best underground/alternative music venues in ${city}, ${country || ''} for ${genre || 'darkwave/EBM/post-punk'} acts with ${capacity || '200-800'} capacity.

Return ONLY a JSON array (no markdown, no code fences) with this structure:
[
  {
    "name": "venue name",
    "address": "approximate address or neighborhood",
    "capacity": number or null,
    "type": "club or bar or art_space or theatre or festival",
    "notes": "why this venue suits the genre",
    "booking_tip": "practical tip for reaching the booker"
  }
]

Return 5-8 venues maximum.`;

        const text = await callGemini(MODELS.FLASH, prompt);
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error('AI did not return valid JSON array');
        result = JSON.parse(jsonMatch[0]);
        break;
      }

      case 'optimize_route': {
        const { cities, startDate, artist } = data;

        const prompt = `${MELANKOLIA_CONTEXT}

The user has a list of confirmed or potential cities for ${artist || 'an artist on our roster'}.
Starting date: ${startDate}.
Cities (in no particular order): ${cities.join(', ')}

Analyze this and return ONLY a JSON object (no markdown, no code fences):
{
  "optimized_order": ["city1", "city2"],
  "routing_strategy": "explanation of the strategy",
  "total_km_optimized": number,
  "total_km_naive": number,
  "savings_km": number,
  "problem_cities": ["cities with large jumps or routing issues"],
  "suggested_additions": ["cities that would naturally fill gaps"],
  "day_by_day": [
    { "day": 1, "city": "string", "drive_km": 0, "note": "string" }
  ]
}`;

        const text = await callGemini(MODELS.PRO, prompt);
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('AI did not return valid JSON');
        result = JSON.parse(jsonMatch[0]);
        break;
      }

      case 'estimate_budget': {
        const { cities, numPeople, numDays, region, vanRental } = data;

        const prompt = `${MELANKOLIA_CONTEXT}

Estimate the touring budget for:
- Cities: ${cities.join(', ')}
- Number of people: ${numPeople || 4}
- Number of days: ${numDays}
- Region: ${region}
- Van rental included: ${vanRental ? 'yes' : 'no (band has own vehicle)'}

Return ONLY a JSON object (no markdown, no code fences):
{
  "summary": "brief overview",
  "daily_breakdown": {
    "fuel_per_day_usd": number,
    "lodging_per_person_per_day_usd": number,
    "food_per_person_per_day_usd": number,
    "van_rental_per_day_usd": number or null
  },
  "total_estimated_cost_usd": number,
  "minimum_guarantee_needed_per_show_usd": number,
  "break_even_shows": number,
  "tips": ["2-3 cost saving tips specific to this region and genre circuit"]
}`;

        const text = await callGemini(MODELS.FLASH, prompt);
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('AI did not return valid JSON');
        result = JSON.parse(jsonMatch[0]);
        break;
      }

      case 'chat': {
        const { message, context } = data;

        const prompt = `${MELANKOLIA_CONTEXT}

Current tour context: ${context || 'none provided'}

User question: ${message}

Answer helpfully and concisely as the Melankolia Agency AI tour planner. Be specific and practical. Plain text only, no markdown.`;

        result = { reply: await callGemini(MODELS.FLASH, prompt) };
        break;
      }

      default:
        return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}` }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: result }) };

  } catch (err) {
    console.error('AI tour error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

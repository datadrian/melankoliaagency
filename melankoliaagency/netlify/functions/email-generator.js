/**
 * Melankolia Agency — Pitch Email Generator
 * Generates HTML pitch emails for venue outreach.
 * Model: gemini-3.5-flash (fast, this is a writing task)
 * Gemini 2.x strictly forbidden.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3.5-flash';

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.85, maxOutputTokens: 4096 }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

const AGENCY_CONTEXT = `
Melankolia Agency is a specialist booking agency for dark/underground music: darkwave, EBM, post-punk, industrial, coldwave, synthpop, minimal wave, goth.
Agency email: booking@melankoliaagency.com
Agency website: melankoliaagency.com
Agency tone: professional but scene-literate. Not corporate. Not fan-girly. Direct, knowledgeable, respectful of the talent buyer's time.
The agency has been working in this niche for years and knows the circuit — reference this credibility subtly.
Never use exclamation marks. Never say "hope this finds you well." Never say "I'm reaching out because." Never use "amazing" or "awesome."
Subject lines should be specific: artist name + city + approximate date. Not vague "booking inquiry."
Emails should be under 200 words in the body. Talent buyers are busy.
`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }), headers }; }

  const { emailType, data } = body;

  try {
    let subjectPrompt, bodyPrompt;

    // ---- EMAIL TYPE ROUTING ----
    if (emailType === 'cold_pitch') {
      const { artist, artistGenre, artistBio, artistLinks, venueName, venueCity, targetDates, dealType, tourContext, pastPerformance } = data;

      subjectPrompt = `${AGENCY_CONTEXT}
Write a subject line for a cold pitch email from Melankolia Agency to the talent buyer at ${venueName} in ${venueCity}.
Artist: ${artist}. Target date range: ${targetDates || 'flexible'}.
Return ONLY the subject line text, no quotes, no label.`;

      bodyPrompt = `${AGENCY_CONTEXT}
Write the body of a cold pitch email from Melankolia Agency to the talent buyer at ${venueName} in ${venueCity}.
Artist: ${artist}
Genre: ${artistGenre || 'darkwave/EBM'}
Artist bio/one-liner: ${artistBio || 'artist on the Melankolia roster'}
Links: ${artistLinks || 'melankoliaagency.com'}
Target dates: ${targetDates || 'flexible — touring the region in [MONTH]'}
Preferred deal: ${dealType || 'guarantee or best of guarantee vs door'}
Tour context: ${tourContext || 'regional tour'}
Past performance in this market: ${pastPerformance || 'first time in this market'}

Rules:
- Under 180 words
- No "hope this finds you well" / no exclamation marks / no filler
- Mention the specific venue by name
- Include a clear ask (specific date or window, deal structure)
- End with a single CTA — reply or check the EPK link
- Sign off as: [Your Name], Melankolia Agency | booking@melankoliaagency.com

Return ONLY the email body text. No subject line. No HTML. Plain text, paragraph breaks with blank lines.`;

    } else if (emailType === 'follow_up') {
      const { artist, venueName, venueCity, originalDate, daysSince, dealType } = data;

      subjectPrompt = `${AGENCY_CONTEXT}
Write a follow-up subject line. Previous email was about booking ${artist} at ${venueName} in ${venueCity} around ${originalDate}.
It's been ${daysSince || 10} days with no reply.
Return ONLY the subject line. No quotes.`;

      bodyPrompt = `${AGENCY_CONTEXT}
Write a follow-up email body. This is a polite but direct nudge — not desperate, not aggressive.
Artist: ${artist}. Venue: ${venueName}, ${venueCity}. Original inquiry: ~${daysSince || 10} days ago about ${originalDate}.
Under 80 words. One paragraph. Reference the original inquiry briefly. Give them one more reason to respond (mention the route is filling in, or dates are limited).
Sign off as: [Your Name], Melankolia Agency | booking@melankoliaagency.com
Return ONLY the email body. Plain text.`;

    } else if (emailType === 'counter_offer') {
      const { artist, venueName, venueCity, theirOffer, ourCounter, dealType, reasoning } = data;

      subjectPrompt = `${AGENCY_CONTEXT}
Write a subject line for a counter-offer response about booking ${artist} at ${venueName} in ${venueCity}.
Return ONLY the subject line. No quotes.`;

      bodyPrompt = `${AGENCY_CONTEXT}
Write a counter-offer email body.
Artist: ${artist}. Venue: ${venueName}, ${venueCity}.
Their offer: ${theirOffer}. Our counter: ${ourCounter}. Deal type: ${dealType || 'guarantee'}.
Context/reasoning: ${reasoning || 'market rate for this artist in this tier market'}
Under 120 words. Professional, direct, not apologetic. State the counter clearly. Leave room to accept if they hold firm on their offer with a small concession.
Sign off as: [Your Name], Melankolia Agency | booking@melankoliaagency.com
Return ONLY the body. Plain text.`;

    } else if (emailType === 'advance') {
      const { artist, venueName, venueCity, showDate, loadIn, soundcheck } = data;

      subjectPrompt = `Advance — ${artist} / ${venueName} / ${showDate}`;

      bodyPrompt = `${AGENCY_CONTEXT}
Write a show advance email from Melankolia Agency to the venue.
Artist: ${artist}. Venue: ${venueName}, ${venueCity}. Show date: ${showDate}.
Load-in: ${loadIn || 'TBD'}. Soundcheck: ${soundcheck || 'TBD'}.

This email should request confirmation of:
- Load-in time, soundcheck time, doors, showtime
- Sound engineer on site
- Backline available (bass amp, guitar amp, drum kit)
- Guest list process (how many spots, when to submit)
- Merch setup (table available, venue cut if any)
- Settlement process (cash or bank transfer, who to collect from)
- Parking for vehicle/van
- Hotel or accommodation (if part of deal)

Under 200 words. Bulleted list format for the requests. Professional.
Sign off as: [Your Name], Melankolia Agency | booking@melankoliaagency.com
Return ONLY the body. Plain text.`;

    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown emailType: ${emailType}` }) };
    }

    // Generate subject + body in parallel
    const [subject, bodyText] = await Promise.all([
      emailType === 'advance' ? Promise.resolve(subjectPrompt) : callGemini(subjectPrompt),
      callGemini(bodyPrompt)
    ]);

    // Build HTML email
    const htmlEmail = buildHTMLEmail(subject.trim(), bodyText.trim(), data);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ success: true, data: { subject: subject.trim(), body: bodyText.trim(), html: htmlEmail } })
    };

  } catch (err) {
    console.error('[email-generator error]', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

function buildHTMLEmail(subject, body, data) {
  // Convert plain text paragraphs to HTML <p> tags
  const paragraphs = body.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  const bodyHtml = paragraphs.map(p => {
    // Handle bullet points
    if (p.includes('\n-') || p.startsWith('-')) {
      const items = p.split('\n').filter(l => l.trim());
      return `<ul style="margin:8px 0;padding-left:20px;">${items.map(i => `<li style="margin-bottom:4px;">${i.replace(/^-\s*/, '')}</li>`).join('')}</ul>`;
    }
    return `<p style="margin:0 0 14px 0;line-height:1.65;">${p.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  const artistName = data.artist || '';
  const epkLink = `https://melankoliaagency.com/artists/${(artistName).toLowerCase().replace(/\s+/g, '-')}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:32px 16px;">
  <tr><td align="center">
    <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e0ddd8;max-width:580px;width:100%;">

      <!-- HEADER -->
      <tr>
        <td style="background:#080808;padding:24px 32px;text-align:center;border-bottom:2px solid #c8a96e;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="text-align:left;vertical-align:middle;">
                <div style="font-family:'Courier New',monospace;font-size:10px;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:#c8a96e;margin-bottom:3px;">Melankolia Agency</div>
                <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:0.2em;text-transform:uppercase;color:#444;">melankoliaagency.com</div>
              </td>
              <td style="text-align:right;vertical-align:middle;">
                <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:0.15em;color:#555;line-height:1.6;">
                  booking@melankoliaagency.com<br>
                  darkwave · EBM · post-punk
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- ARTIST BANNER (if artist specified) -->
      ${artistName ? `
      <tr>
        <td style="background:#111111;padding:12px 32px;border-bottom:1px solid #1e1e1e;">
          <span style="font-family:'Courier New',monospace;font-size:9px;font-weight:700;letter-spacing:0.25em;text-transform:uppercase;color:#666;">Re: </span>
          <span style="font-family:'Courier New',monospace;font-size:9px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#c8a96e;">${artistName}</span>
        </td>
      </tr>` : ''}

      <!-- BODY -->
      <tr>
        <td style="padding:32px 32px 24px;color:#222222;font-size:14px;line-height:1.65;">
          ${bodyHtml}
        </td>
      </tr>

      <!-- LINKS ROW -->
      ${artistName ? `
      <tr>
        <td style="padding:0 32px 28px;">
          <table cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding-right:12px;">
                <a href="${epkLink}" style="display:inline-block;background:#080808;color:#c8a96e;text-decoration:none;font-family:'Courier New',monospace;font-size:9px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;padding:8px 16px;border:1px solid #c8a96e;">EPK →</a>
              </td>
              <td>
                <a href="https://melankoliaagency.com" style="display:inline-block;background:#f8f7f3;color:#444;text-decoration:none;font-family:'Courier New',monospace;font-size:9px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;padding:8px 16px;border:1px solid #ddd;">Roster →</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>` : ''}

      <!-- FOOTER -->
      <tr>
        <td style="background:#f0ede8;padding:16px 32px;border-top:1px solid #e0ddd8;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:0.12em;color:#888;line-height:1.7;text-transform:uppercase;">
                  Melankolia Agency · booking@melankoliaagency.com · melankoliaagency.com<br>
                  Specialist representation for dark &amp; underground music
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/**
 * Melankolia Advancing — Email Notification
 * Sends via Resend from advancing@mail.melankoliaagency.com
 * Handles: promoter submission alerts, band publication notices, advancing request emails to promoters
 */
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'bad json' }; }

  const RESEND_KEY = process.env.RESEND_API_KEY;
  const FROM = 'advancing@mail.melankoliaagency.com';
  const AGENCY_EMAIL = 'booking@melankoliaagency.com';
  const ADMIN_LINK = 'https://melankoliaagency.com/admin#advancing';

  if (!RESEND_KEY) {
    console.log('[notify] No RESEND_API_KEY set — skipping email');
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ sent: false, reason: 'no key' }) };
  }

  const { type } = body;

  let emailPayload = null;

  // ── TYPE: promoter submitted advancing info ──
  if (type === 'promoter_submission') {
    const { show, gaps } = body;
    const subject = `[Advancing] ${show.venue_name}, ${show.city} — ${show.date}`;
    const gapLine = gaps?.length
      ? `<div style="background:#fff5f5;border:1px solid #fcc;padding:10px 14px;font-size:12px;color:#c00;margin-bottom:16px;border-radius:2px;"><strong>⚠ Missing fields (${gaps.length}):</strong> ${gaps.join(', ')}</div>`
      : `<div style="background:#f0fff4;border:1px solid #9e9;padding:10px 14px;font-size:12px;color:#060;margin-bottom:16px;border-radius:2px;">✓ All required fields completed.</div>`;

    emailPayload = {
      from: `Melankolia Advancing <${FROM}>`,
      to: [AGENCY_EMAIL],
      subject,
      html: emailShell(`
        <p style="color:#555;font-size:13px;margin:0 0 16px;">New advancing submission received from the venue.</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
          <tr><td style="color:#888;padding:5px 0;width:100px;">Venue</td><td style="color:#222;font-weight:600;">${esc(show.venue_name)}</td></tr>
          <tr><td style="color:#888;padding:5px 0;">City</td><td style="color:#222;">${esc(show.city)}</td></tr>
          <tr><td style="color:#888;padding:5px 0;">Date</td><td style="color:#222;">${esc(show.date)}</td></tr>
          ${show.promoter_name ? `<tr><td style="color:#888;padding:5px 0;">Promoter</td><td style="color:#222;">${esc(show.promoter_name)}</td></tr>` : ''}
        </table>
        ${gapLine}
        <a href="${ADMIN_LINK}" style="display:inline-block;background:#c8a96e;color:#000;text-decoration:none;font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;padding:11px 22px;border-radius:2px;">Review in Admin Panel →</a>
      `, 'Advancing Submission')
    };
  }

  // ── TYPE: send advancing request to promoter ──
  else if (type === 'advancing_request') {
    const { show, promoter_url, promoter_name, deadline } = body;
    const subject = `Advancing Info Required — ${show.venue_name}, ${show.date}`;

    emailPayload = {
      from: `Melankolia Agency <${FROM}>`,
      to: [body.to],
      reply_to: AGENCY_EMAIL,
      subject,
      html: emailShell(`
        <p style="color:#555;font-size:13px;margin:0 0 12px;">Hi${promoter_name ? ' ' + esc(promoter_name) : ''},</p>
        <p style="color:#555;font-size:13px;margin:0 0 16px;">
          We're advancing the upcoming show at <strong style="color:#222;">${esc(show.venue_name)}</strong> on <strong style="color:#222;">${esc(show.date)}</strong>.
          Please fill in the show details using the link below.
        </p>
        ${deadline ? `<p style="color:#888;font-size:12px;margin:0 0 16px;">Deadline: <strong>${esc(deadline)}</strong></p>` : ''}
        <a href="${promoter_url}" style="display:inline-block;background:#c8a96e;color:#000;text-decoration:none;font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;padding:11px 22px;border-radius:2px;margin-bottom:20px;">Fill In Advancing Info →</a>
        <p style="color:#aaa;font-size:11px;margin:16px 0 0;">Questions? Reply to this email or contact us at ${AGENCY_EMAIL}</p>
      `, 'Advancing Request'),
      text: `Hi${promoter_name ? ' ' + promoter_name : ''},\n\nPlease fill in advancing info for ${show.venue_name} on ${show.date}:\n${promoter_url}\n\nDeadline: ${deadline || 'ASAP'}\n\nQuestions? ${AGENCY_EMAIL}\n\n— Melankolia Agency`
    };
  }

  // ── TYPE: notify band that advancing is published ──
  else if (type === 'band_published') {
    const { show, band_email, band_name } = body;
    const subject = `Advancing Ready — ${show.venue_name}, ${show.date}`;

    emailPayload = {
      from: `Melankolia Agency <${FROM}>`,
      to: [band_email],
      reply_to: AGENCY_EMAIL,
      subject,
      html: emailShell(`
        <p style="color:#555;font-size:13px;margin:0 0 12px;">Hi${band_name ? ' ' + esc(band_name) : ''},</p>
        <p style="color:#555;font-size:13px;margin:0 0 16px;">
          Your advancing sheet for <strong style="color:#222;">${esc(show.venue_name)}</strong>, ${esc(show.city)} on <strong style="color:#222;">${esc(show.date)}</strong> is ready.
        </p>
        <a href="https://melankoliaagency.com/band-app/" style="display:inline-block;background:#c8a96e;color:#000;text-decoration:none;font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;padding:11px 22px;border-radius:2px;margin-bottom:20px;">View in Band Portal →</a>
        <p style="color:#aaa;font-size:11px;margin:16px 0 0;">Questions? Contact us at ${AGENCY_EMAIL}</p>
      `, 'Advancing Ready'),
      text: `Hi${band_name ? ' ' + band_name : ''},\n\nYour advancing sheet for ${show.venue_name}, ${show.city} on ${show.date} is ready.\n\nView it in the band portal: https://melankoliaagency.com/band-app/\n\n— Melankolia Agency`
    };
  }

  if (!emailPayload) {
    return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Unknown notification type' }) };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(emailPayload)
    });
    const data = await res.json();
    if (data.id) {
      console.log('[notify] sent:', data.id, '→', emailPayload.to);
      return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ sent: true, id: data.id }) };
    } else {
      console.error('[notify] Resend error:', JSON.stringify(data));
      return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ sent: false, error: data }) };
    }
  } catch (e) {
    console.error('[notify] fetch error:', e.message);
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ sent: false, error: e.message }) };
  }
};

function emailShell(content, title) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 16px;">
<table width="100%" style="max-width:520px;background:#fff;border:1px solid #e0ddd8;border-radius:3px;overflow:hidden;" cellpadding="0" cellspacing="0">
  <tr><td style="background:#080808;padding:16px 24px;border-bottom:2px solid #c8a96e;">
    <div style="color:#c8a96e;font-size:9px;letter-spacing:0.3em;text-transform:uppercase;font-weight:700;font-family:'Courier New',monospace;">Melankolia Agency</div>
    <div style="color:#fff;font-size:12px;margin-top:3px;letter-spacing:0.1em;font-family:'Courier New',monospace;">${esc(title)}</div>
  </td></tr>
  <tr><td style="padding:24px;">${content}</td></tr>
  <tr><td style="background:#fafaf8;border-top:1px solid #e8e5e0;padding:12px 24px;">
    <p style="color:#aaa;font-size:10px;margin:0;font-family:'Courier New',monospace;letter-spacing:0.05em;">Melankolia Agency · booking@melankoliaagency.com · melankoliaagency.com</p>
  </td></tr>
</table></td></tr></table>
</body></html>`;
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

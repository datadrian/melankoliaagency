const { json } = require('./_firebase');

function esc(v='') { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function clean(v='') { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
function line(parts) { return parts.filter(Boolean).join(' · '); }
function arr(v) { return Array.isArray(v) ? v.filter(Boolean) : []; }
function first(v, n=1) { return arr(v).slice(0,n); }
function monthYear(date='') {
  const s = clean(date);
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`);
    return d.toLocaleDateString('en-US', { month:'long', year:'numeric', timeZone:'UTC' });
  }
  return s;
}
function yearNum(v){ const m=String(v||'').match(/(20\d{2}|19\d{2})/); return m?Number(m[1]):0; }
function recentReleaseRows(discography=[]) {
  const cutoff = new Date().getFullYear() - 2;
  return arr(discography).filter(r=>r&&r.title).map(r=>({...r, _year:yearNum(r.year||r.date||r.release_date)})).filter(r=>!r._year || r._year>=cutoff).sort((a,b)=>(b._year||0)-(a._year||0)).slice(0,4);
}
function cleanPublicNote(v='') {
  const s=clean(v);
  if(!s) return '';
  if(/send branded|routing inquiry|top venue targets|research venues|next action|availability inquiry|internal|pipeline|kanban|venue finder/i.test(s)) return '';
  return s.length>220 ? s.slice(0,217)+'…' : s;
}
function genreText(g) {
  if (Array.isArray(g)) return g.filter(Boolean).slice(0,3).join(' / ');
  return clean(g);
}
function descriptor(artistData={}) {
  const g = genreText(artistData.genres).toLowerCase();
  const b = clean(`${artistData.shortBio || ''} ${artistData.bio || ''}`).toLowerCase();
  const src = `${g} ${b}`;
  if (src.includes('ebm')) return 'EBM / dark electronic act';
  if (src.includes('darkwave')) return 'darkwave act';
  if (src.includes('synth-pop') || src.includes('synth pop')) return 'synth-pop act';
  if (src.includes('post-punk')) return 'post-punk / darkwave act';
  if (src.includes('coldwave') || src.includes('post-industrial')) return 'dark pop artist';
  if (src.includes('industrial') || src.includes('electronic')) return 'dark electronic artist';
  if (src.includes('pop')) return 'dark pop artist';
  return genreText(artistData.genres) ? `${genreText(artistData.genres)} artist` : 'artist';
}
function sentenceSplit(txt='') {
  const seen = new Set();
  return clean(txt).replace(/…/g,'.').split(/(?<=[.!?])\s+/).map(clean).filter(s => {
    if (s.length <= 40) return false;
    const key = s.toLowerCase().replace(/[^a-z0-9]+/g,' ').slice(0,140);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function releaseItems(discography=[]) {
  return recentReleaseRows(discography).map(r => `${r.title}${r._year ? ` (${r._year})` : ''}${r.type ? ` — ${r.type}` : ''}`);
}
function releaseLine(discography=[]) {
  const pick = releaseItems(discography).slice(0,3);
  if (!pick.length) return '';
  return `Recent/upcoming releases include ${pick.join(', ')}.`;
}
function credibilityParagraphs(artistData={}) {
  const shortBio = clean(artistData.shortBio || '');
  const fullBio = clean(artistData.bio || '');
  const bio = fullBio && shortBio && fullBio.toLowerCase().startsWith(shortBio.toLowerCase().replace(/…$/,'')) ? fullBio : `${shortBio} ${fullBio}`;
  const cutoff = new Date().getFullYear() - 2;
  const sentences = sentenceSplit(bio);
  const recent = sentences.filter(s => {
    const y = yearNum(s);
    return y >= cutoff || /upcoming|latest|new album|new ep|recent|forthcoming|set to be out|released on/i.test(s);
  }).slice(0,2);
  const intro = shortBio ? sentenceSplit(shortBio)[0] || shortBio : sentences[0] || '';
  const picked = [];
  if(intro) picked.push(intro.replace(/\s+/g,' ').trim());
  recent.forEach(s=>{ if(s && !picked.includes(s)) picked.push(s); });
  const rel = releaseLine(artistData.discography);
  if (rel && !picked.some(p => /recent\/upcoming releases/i.test(p))) picked.push(rel);
  return picked.slice(0,3);
}
function linkMap(artistData={}) {
  const social = artistData.social_links || artistData.socials || artistData.links || {};
  const videos = arr(artistData.videos || artistData.music_videos);
  const video = videos.find(v => v && (v.url || v.link)) || {};
  return [
    ['Spotify', social.spotify || artistData.spotify || artistData.spotify_url],
    ['Instagram', social.instagram || artistData.instagram || artistData.instagram_url],
    ['Bandcamp', social.bandcamp || artistData.bandcamp || artistData.bandcamp_url],
    ['Music video', video.url || video.link],
    ['EPK', artistData.epkUrl || (artistData.slug ? `https://melankoliaagency.com/epk/${artistData.slug}` : '')]
  ].filter(([,url]) => clean(url));
}
function textLinks(links) { return links.map(([label,url]) => `${label}: ${url}`).join('\n'); }
function htmlLinks(links) { return links.map(([label,url]) => `<li><a href="${esc(url)}" style="color:#c8a96e;text-decoration:none">${esc(label)}</a></li>`).join(''); }
function greeting(d={}) {
  const contact = clean(d.contactName || d.venueData?.contact_name || d.venueData?.booker_name || d.venueData?.booking_contact);
  if (contact && !/@/.test(contact)) return `Hello ${contact},`;
  const venue = clean(d.venue || d.venue_name || d.venueData?.name);
  if (venue) return `Hello ${venue} booking,`;
  return 'Hello,';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { success:false, error:'POST only' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}
  const d = body.data || body;

  const artistData = d.artistContext || d.artistData || {};
  const artist = clean(artistData.name || d.artist) || 'Artist';
  const city = clean(d.city) || 'your city';
  const country = clean(d.country);
  const venue = clean(d.venue || d.venue_name || d.venueData?.name);
  const date = clean(d.date);
  const deal = clean(d.deal || d.deal_suggestion || d.offer);
  const notes = cleanPublicNote(d.public_notes || d.booking_context || d.context); // never use internal route notes/next_action in public email
  const tourName = clean(d.tour?.name || d.tour?.tour_name || d.tourName);
  const region = clean(d.tour?.region || d.region);
  const datePhrase = monthYear(date) || clean(d.date_window || d.month) || 'an upcoming routing window';
  const desc = clean(d.artistDescriptor || descriptor(artistData));
  const location = clean(artistData.location);
  const artistWithOrigin = `${artist}${location ? ` (${location})` : ''}`;
  const links = linkMap(artistData);
  const cred = credibilityParagraphs(artistData);
  const hello = greeting(d);

  const subject = `Booking inquiry: ${desc} ${artistWithOrigin} to play ${venue || city} in ${datePhrase}`;
  const routeSentence = tourName || region
    ? `I wanted to reach out because we would love to bring ${artist} to ${city}${country ? `, ${country}` : ''} as part of ${line([tourName, region])}${date ? ` around ${date}` : ` in ${datePhrase}`}.`
    : `I wanted to reach out because we would love to bring ${artist} to ${city}${country ? `, ${country}` : ''}${date ? ` on or around ${date}` : ` in ${datePhrase}`}.`;
  const venueSentence = venue
    ? `Would you have availability to host them at ${venue} then? They could also be added to an already existing event if you have something suitable around that date.`
    : `Would you have availability to host them then? They could also be added to an already existing event if you have something suitable around that date.`;
  const dealSentence = deal ? `The current deal target is ${deal}, but we are happy to discuss the structure that makes sense for the room and market.` : '';
  const notesSentence = notes ? notes : '';

  const releaseList = releaseItems(artistData.discography);
  const highlightsText = cred.length ? `\n\nArtist highlights\n${cred.map(x=>`- ${x}`).join('\n')}` : '';
  const releasesText = releaseList.length ? `\n\nNotable recent / upcoming releases\n${releaseList.map(x=>`- ${x}`).join('\n')}` : '';
  const linksText = links.length ? `\n\nSocial / EPK links\n${textLinks(links)}` : '';
  const logistics = [dealSentence, notesSentence].filter(Boolean).join('\n\n');
  const text = `${hello}\n\nI hope all is well! ${routeSentence} ${venueSentence}${highlightsText}${releasesText}${linksText}${logistics ? `\n\n${logistics}` : ''}\n\nLet me know if you are interested in booking ${artist} and I would be happy to discuss the details.\n\nI look forward to hearing your thoughts!\n\nBest wishes,\n\nAnna-Maria`;

  const sectionHeading = label => `<h3 style="margin:24px 0 10px;color:#c8a96e;font-size:11px;letter-spacing:.18em;text-transform:uppercase">${esc(label)}</h3>`;
  const bulletList = items => `<ul style="margin:0 0 20px;padding-left:20px;color:#d7d7d7">${items.map(x=>`<li style="margin:0 0 7px">${esc(x)}</li>`).join('')}</ul>`;
  const htmlBody = [
    `<p style="margin:0 0 18px">${esc(`I hope all is well! ${routeSentence} ${venueSentence}`)}</p>`,
    cred.length ? `${sectionHeading('Artist highlights')}${bulletList(cred)}` : '',
    releaseList.length ? `${sectionHeading('Notable recent / upcoming releases')}${bulletList(releaseList)}` : '',
    links.length ? `${sectionHeading('Social / EPK links')}<ul style="margin:0 0 22px;padding-left:20px;color:#d7d7d7">${htmlLinks(links)}</ul>` : '',
    logistics ? `<p style="margin:0 0 18px">${esc(logistics)}</p>` : '',
    `<p style="margin:0 0 18px">${esc(`Let me know if you are interested in booking ${artist} and I would be happy to discuss the details.`)}</p>`,
    `<p style="margin:0 0 18px">I look forward to hearing your thoughts!</p>`
  ].filter(Boolean).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head><body style="margin:0;background:#050505;color:#d7d7d7;font-family:Helvetica,Arial,sans-serif;line-height:1.55"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050505;padding:32px 16px"><tr><td align="center"><table role="presentation" width="100%" style="max-width:720px;border:1px solid #222;background:#0b0b0b" cellspacing="0" cellpadding="0"><tr><td style="padding:28px 30px;border-bottom:1px solid #202020"><img src="https://melankoliaagency.com/images/logo-mark-white.svg" alt="Melankolia" style="width:38px;height:auto;display:block;margin-bottom:22px"><div style="font-size:10px;letter-spacing:.28em;text-transform:uppercase;color:#c8a96e;font-weight:700">Melankolia Agency</div><h1 style="margin:8px 0 0;color:#fff;font-size:24px;line-height:1.15;font-weight:700">${esc(artist)} booking inquiry</h1><div style="margin-top:10px;color:#888;font-size:12px;letter-spacing:.08em;text-transform:uppercase">${esc(line([venue, city, country, date]))}</div></td></tr><tr><td style="padding:30px;color:#d7d7d7;font-size:15px"><p style="margin:0 0 18px">${esc(hello)}</p>${htmlBody}<p style="margin:28px 0 0;color:#aaa">Best wishes,<br><br><strong style="color:#fff">Anna-Maria</strong></p></td></tr></table></td></tr></table></body></html>`;

  return json(200, { success:true, data:{ subject, text, html, preview: line([artist, venue, city, date, deal]), artist_context_used: !!artistData.name, links_used: links.map(([label])=>label), credibility_count: cred.length } });
};

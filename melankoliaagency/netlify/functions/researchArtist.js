// Melankolia Agency — Artist Research Netlify Function
// Migrated off Base44. Uses Gemini via Netlify environment variable GEMINI_API_KEY.

const RM = process.env.GEMINI_RESEARCH_MODEL || 'gemini-3.1-flash-lite';
const PM = 'gemini-3.1-flash-lite';
const BAD = new Set(['jNQXAC9IVRw', 'dQw4w9WgXcQ', '9bZkp7q19f0']);
const BADT = /\b(me at the zoo|rick astley|never gonna give you up)\b/i;
const SYS = `You are a professional underground/electronic music researcher. Use Google Search. Research the exact requested artist, disambiguating similar names. Find verified official URLs for Spotify, Instagram, SoundCloud, YouTube, Facebook, Bandcamp, Resident Advisor, Bandsintown and website. For Spotify find the open.spotify.com artist URL and 22-char ID. For YouTube find up to 5 real music videos/live sets and output only 11-char video IDs. Do not generate a short teaser bio. Always set shortBio to an empty string. Write a 200-300 word editorial bio only. Prioritize finding exact published media/press quotes about the artist; include quotes only when the wording and source are verifiable. Do not invent URLs, IDs, videos, quotes or facts.`;
const PS = `Return ONLY valid JSON with keys: name, genres, location, shortBio, bio, quotes:[{text,source,year,url}], press:[{headline,publication,year,url}], socials:{instagram,spotify,soundcloud,youtube,facebook,bandcamp,ra,bandsintown,website}, images:[], notes, wikipediaTitle, youtubeVideoIds:[], spotifyArtistId. shortBio must always be "". quotes must be exact media/press quotes only; use [] when unverified. Use empty strings/arrays when unverified.`;

exports.handler = async (event) => {
  const startedAt = Date.now();
  const DEADLINE_MS = 24500;
  const remainingMs = () => Math.max(0, DEADLINE_MS - (Date.now() - startedAt));
  const nearDeadline = (buffer = 3500) => remainingMs() < buffer;
  const signalFor = (ms) => AbortSignal.timeout(Math.max(800, Math.min(ms, remainingMs() - 500 || 800)));
  const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Content-Type':'application/json'};
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return json({ error: 'POST only' }, 405, cors);
  const key = process.env.GEMINI_API_KEY_V2 || process.env.GEMINI_API_KEY;
  if (!key) return json({ error: 'GEMINI_API_KEY not set on Netlify' }, 500, cors);
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch {}
  const artist = String(body.artistName || '').trim();
  if (!artist) return json({ error: 'artistName required' }, 400, cors);

  const url = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`;
  const txt = (d) => (d?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('\n').trim();
  const uris = (d) => [...new Set((d?.candidates?.[0]?.groundingMetadata?.groundingChunks || []).map(c => c?.web?.uri || '').filter(Boolean))];
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const yid = (x) => (String(x || '').match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/) || String(x || '').match(/^([A-Za-z0-9_-]{11})$/) || [])[1] || '';

  async function gem(model, payload, label, n = 2) {
    let st = 0, tx = '';
    n = Math.max(1, Math.min(n, nearDeadline(9000) ? 1 : 2));
    for (let i = 0; i < n; i++) {
      if (nearDeadline(2500)) throw Object.assign(new Error(`${label} skipped before Netlify timeout`), { status: 504 });
      const r = await fetch(url(model), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: signalFor(label.includes('parser') ? 7000 : 11000) });
      if (r.ok) return await r.json();
      st = r.status; tx = await r.text().catch(() => '');
      if (![429,500,502,503,504].includes(st) || i === n - 1) break;
      await sleep(Math.min(2200, 700 * 2 ** i) + Math.random() * 250);
    }
    const e = new Error(`${label} failed (${st}): ${tx.slice(0, 200)}`); e.status = st; throw e;
  }
  const spText = (s) => { const m = String(s || '').match(/https?:\/\/(?:open\.)?spotify\.com\/artist\/([A-Za-z0-9]{22})/i) || String(s || '').match(/spotify:artist:([A-Za-z0-9]{22})/i); return m ? { id: m[1], url: `https://open.spotify.com/artist/${m[1]}` } : { id: '', url: '' }; };
  async function spOK(id) { if (!/^[A-Za-z0-9]{22}$/.test(id)) return false; const u = `https://open.spotify.com/artist/${id}`; try { const r = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(u)}`, { signal: signalFor(2200) }); if (r.ok) return true; } catch {} try { const r = await fetch(u, { headers: { 'User-Agent':'Mozilla/5.0' }, signal: signalFor(3000) }); if (!r.ok) return false; const h = await r.text(); return h.includes(id); } catch { return false; } }
  async function spMB(name) { try { let r = await fetch(`https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`artist:"${name}"`)}&fmt=json&limit=5`, { headers:{'User-Agent':'MelankoliaAgencyResearch/1.0'}, signal: signalFor(3000) }); if (!r.ok) return {id:'',url:''}; let d = await r.json(), a = (d.artists || []).find(x => norm(x.name) === norm(name)) || (d.artists || [])[0]; if (!a?.id) return {id:'',url:''}; r = await fetch(`https://musicbrainz.org/ws/2/artist/${a.id}?inc=url-rels&fmt=json`, { headers:{'User-Agent':'MelankoliaAgencyResearch/1.0'}, signal: signalFor(3000) }); if (!r.ok) return {id:'',url:''}; d = await r.json(); for (const rel of d.relations || []) { const f = spText(rel?.url?.resource || ''); if (f.id) return f; } } catch {} return {id:'',url:''}; }

  try {
    const primary = body.researchModel || ((String(body.researchMode || '').toLowerCase() === 'pro') ? 'gemini-3.1-pro-preview' : RM);
    async function research(model, grounded) { const p = { systemInstruction:{parts:[{text:SYS}]}, contents:[{parts:[{text:`Research artist: ${artist}. Include direct official Spotify URL/ID and YouTube video IDs.`}]}], generationConfig:{temperature:.2,maxOutputTokens:4096} }; if (grounded) p.tools = [{ google_search:{} }]; const d = await gem(model, p, grounded ? 'grounded research' : 'fallback research', 1); const u = uris(d); return [txt(d), u.length ? `\n\nVerified source URLs:\n${u.join('\n')}` : ''].join('').trim(); }
    let source = primary, rt = '';
    try { rt = await research(primary, true); } catch { source = 'gemini-3.1-flash-lite-no-grounding'; rt = await research('gemini-3.1-flash-lite', false); }

    const pp = `${PS}\n\nARTIST: ${artist}\n\nDOSSIER:\n${rt.slice(0,24000)}`;
    let raw = '';
    try { raw = txt(await gem(PM, { contents:[{parts:[{text:pp}]}], generationConfig:{temperature:0,maxOutputTokens:4096,responseMimeType:'application/json'} }, 'parser', 1)); }
    catch { raw = txt(await gem('gemini-2.5-flash', { contents:[{parts:[{text:pp+'\nJSON only.'}]}], generationConfig:{temperature:0,maxOutputTokens:4096,responseMimeType:'application/json'} }, 'fallback parser', 1)); }
    let clean = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim(), p = {};
    try { p = JSON.parse(clean); } catch { const m = clean.match(/\{[\s\S]*\}/); if (m) p = JSON.parse(m[0]); }
    p.socials = p.socials || {};

    const videos = [];
    const vrel = (t) => norm(t).includes(norm(artist));
    async function addY(id) { if (!/^[A-Za-z0-9_-]{11}$/.test(id) || BAD.has(id) || videos.some(v => v.id === id)) return; try { const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`, { signal: signalFor(1800) }); if (!r.ok) return; const d = await r.json(), title = d.title || artist; if (BADT.test(title) || !vrel(title)) return; videos.push({ id, title, thumb:`https://img.youtube.com/vi/${id}/mqdefault.jpg` }); } catch {} }
    if (!nearDeadline(5000)) await Promise.allSettled((p.youtubeVideoIds || []).map(x => yid(String(x))).filter(Boolean).slice(0,4).map(addY));
    if (!videos.length && !nearDeadline(6000)) { for (const q of [`"${artist}" music video`,`"${artist}" official video`,`"${artist}" live`,`"${artist}" youtube`]) { if (videos.length >= 3 || nearDeadline(3500)) break; try { const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, { headers:{'User-Agent':'Mozilla/5.0'}, signal: signalFor(3000) }); if (!r.ok) continue; const h = await r.text(); const ids = [...new Set([...h.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)].map(m=>m[1]).concat([...h.matchAll(/watch\?v=([A-Za-z0-9_-]{11})/g)].map(m=>m[1])))].slice(0,6); for (const id of ids) { if (videos.length >= 3 || nearDeadline(3500)) break; await addY(id); } } catch {} } }

    let sid = String(p.spotifyArtistId || ''), f = spText(`${p.socials.spotify || ''}\n${sid ? `spotify:artist:${sid}` : ''}`);
    if (!sid && f.id) sid = f.id; if (!sid) { f = spText(rt); if (f.id) sid = f.id; } if (!sid) { f = await spMB(p.name || artist); if (f.id) sid = f.id; }
    if (sid && !nearDeadline(3500) && await spOK(sid)) { p.spotifyArtistId = sid; p.socials.spotify = `https://open.spotify.com/artist/${sid}`; } else { p.spotifyArtistId = ''; p.socials.spotify = ''; }

    let disc = [];
    try { let r = await fetch(`https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`artist:"${artist}"`)}&fmt=json&limit=5`, { headers:{'User-Agent':'MelankoliaAgencyResearch/1.0'}, signal: signalFor(3000) }); if (r.ok) { let d = await r.json(), a = (d.artists || []).find(x => norm(x.name) === norm(artist)) || (d.artists || [])[0]; if (a?.id) { r = await fetch(`https://musicbrainz.org/ws/2/release-group?artist=${a.id}&fmt=json&limit=20&type=album|ep|single`, { headers:{'User-Agent':'MelankoliaAgencyResearch/1.0'}, signal:signalFor(3500) }); if (r.ok) { const rd = await r.json(), groups = (rd['release-groups'] || []).filter(x => x.title && x['first-release-date']).sort((a,b)=>String(b['first-release-date']).localeCompare(String(a['first-release-date']))).slice(0,8); disc = await Promise.all(groups.map(async x => { let cover='', mbid=x.id || ''; if (nearDeadline(4500)) return { title:x.title, year:String(x['first-release-date'] || '').slice(0,4), type:x['primary-type'] || '', mbid, cover }; try { const ca = await fetch(`https://coverartarchive.org/release-group/${mbid}`, { signal:signalFor(1800) }); if (ca.ok) { const cd = await ca.json(), img = (cd.images || []).find(i=>i.front) || (cd.images || [])[0]; cover = img?.thumbnails?.large || img?.thumbnails?.small || img?.image || ''; } } catch {} if (!cover) { try { const ir = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(`${artist} ${x.title}`)}&entity=album&limit=5`, { signal:signalFor(1800) }); if (ir.ok) { const jd = await ir.json(), hit = (jd.results || []).find(z=>norm(z.collectionName)===norm(x.title)) || (jd.results || [])[0]; if (hit?.artworkUrl100) cover = String(hit.artworkUrl100).replace('100x100bb','600x600bb'); } } catch {} } return { title:x.title, year:String(x['first-release-date'] || '').slice(0,4), type:x['primary-type'] || '', mbid, cover }; })); } } } } catch {}

    return json({ artist, name:p.name || artist, genres:p.genres || '', location:p.location || '', shortBio:'', bio:p.bio || '', quotes:p.quotes || [], press:p.press || [], socials:p.socials || {}, images:[], notes:p.notes || '', wikipediaTitle:p.wikipediaTitle || '', spotifyArtistId:p.spotifyArtistId || '', discography:disc, lastfm:{listeners:0,playcount:0,tags:[],url:''}, videos:videos.map(v=>({ id:v.id, title:v.title, url:`https://www.youtube.com/watch?v=${v.id}`, thumb:v.thumb })), _source:`${source}+${PM}+fast-timeout-guard+spotify+youtube+coverart`, _debug:{researchPreview:rt.slice(0,800),parserRawPreview:raw.slice(0,500)} }, 200, cors);
  } catch (e) { return json({ error:e?.message || 'Research failed', _source:'researchArtist-json-error', _elapsed_ms:Date.now()-startedAt }, e?.status || 500, cors); }
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function json(x, statusCode = 200, headers = {}) { return { statusCode, headers, body: JSON.stringify(x) }; }

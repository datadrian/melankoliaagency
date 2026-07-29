// Contact Discovery — staging store for proposed CRM contacts found in Gmail.
// The agent (Superagent) writes proposals here after scanning Gmail; the admin
// panel lists them and approves/rejects. On approve, matched fields are written
// to the venue CRM via the SAME rag-venues upsert path (single source of truth).
//
// Nothing here writes to route_planner_crm_venues except the `approve` action.
const { listDocs, getDoc, createDoc, updateDoc, deleteDoc, queryDocs, json } = require('./_firebase');
const { authorize } = require('./_auth');

const COLL = 'contact_discovery_proposals';
const VENUES = 'route_planner_crm_venues';
const ADMIN_PW = () => process.env.MELANKOLIA_ADMIN_PASSWORD || 'melankolia2025';
const AGENT_KEY = () => process.env.CONTACT_DISCOVERY_KEY || process.env.MELANKOLIA_ADMIN_PASSWORD || 'melankolia2025';
const now = () => new Date().toISOString();
const id = () => `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const venueId = () => `venue_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const RAG_URL = (process.env.SITE_BASE || 'https://melankoliaagency.com') + '/.netlify/functions/rag-venues';

const guard = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
const withGuard = (p, ms = 23000) => Promise.race([p, guard(ms)]);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { success: false, error: 'POST only' });
  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch { return json(400, { success: false, error: 'Invalid JSON' }); }
  try {
    const isAgent = b.agent_key === AGENT_KEY();
    const auth = isAgent ? { ok: true } : await authorize(b, 'discovery');
    const isAdmin = auth.ok;
    if (!isAdmin && !isAgent) return json(401, { success: false, error: auth.error || 'Unauthorized' });

    if (b.action === '_inspect') {
      const d = await getDoc(COLL, b.id);
      if (!d) return json(200, { success:true, found:false });
      const { candidate, ...top } = d;
      return json(200, { success:true, found:true, top_keys:Object.keys(top), status:d.status, type:d.type, created_at:d.created_at, email:d.email, edited:d.edited, cand_email:(candidate||{}).email, cand_website:(candidate||{}).website });
    }
    if (b.action === 'list') return json(200, await withGuard(listProposals(b)));
    if (b.action === 'stats') return json(200, await withGuard(statsProposals()));
    if (b.action === 'purge') {
      if (!isAgent) return json(403, { success: false, error: 'purge requires agent_key' });
      const all = await listDocs(COLL, { orderBy: 'created_at desc', pageSize: 500 }).catch(() => []);
      let del = 0;
      for (const d of all) {
        const match = (b.status && (d.status || 'pending') === b.status) || (Array.isArray(b.ids) && b.ids.includes(d.id));
        if (match) { await deleteDoc(COLL, d.id).catch(() => {}); del++; }
      }
      return json(200, { success: true, deleted: del });
    }
    if (b.action === 'stage') {
      if (!isAgent) return json(403, { success: false, error: 'stage requires agent_key' });
      return json(200, await withGuard(stageProposals(b.proposals || [], b.scan || {})));
    }
    if (b.action === 'edit') return json(200, await withGuard(editProposal(b.id, b.candidate || {})));
    if (b.action === 'approve') return json(200, await withGuard(approveProposal(b.id)));
    if (b.action === 'bulk_approve') return json(200, await withGuard(bulkApprove(b.ids || [])));
    if (b.action === 'reject') return json(200, await withGuard(rejectProposal(b.id, b.reason || '')));
    return json(400, { success: false, error: 'Unknown action' });
  } catch (e) {
    return json(500, { success: false, error: e.message || 'error' });
  }
};

async function listProposals(b) {
  let docs = await listDocs(COLL, { orderBy: 'created_at desc', pageSize: 500 }).catch(() => []);
  const status = b.status || 'pending';
  if (status !== 'all') docs = docs.filter(d => (d.status || 'pending') === status);
  if (b.type && b.type !== 'all') docs = docs.filter(d => d.type === b.type);
  return { success: true, data: docs, count: docs.length };
}

async function statsProposals() {
  const docs = await listDocs(COLL, { orderBy: 'created_at desc', pageSize: 500 }).catch(() => []);
  const s = { pending: 0, approved: 0, rejected: 0, new: 0, update: 0, total: docs.length };
  docs.forEach(d => {
    const st = d.status || 'pending'; if (s[st] != null) s[st]++;
    if (st === 'pending') { if (d.type === 'new') s.new++; if (d.type === 'update') s.update++; }
  });
  return { success: true, data: s };
}

async function stageProposals(rows, scan) {
  const existing = await listDocs(COLL, { orderBy: 'created_at desc', pageSize: 500 }).catch(() => []);
  const seen = new Set();
  existing.forEach(d => {
    const em = norm(d.candidate && d.candidate.email);
    if (em) seen.add(em);
    else {
      const c = d.candidate || {};
      const key = 'np:' + norm(c.name || c.org || c.venue_name) + '|' + String(c.phone || '').replace(/[^0-9]/g, '');
      if (key !== 'np:|') seen.add(key);
    }
  });
  let staged = 0, skipped = 0;
  for (const r of rows) {
    const source = r.source || (scan && scan.source) || 'gmail';
    const email = norm(r.candidate && r.candidate.email);
    // Dedup: email-based when we have one (all sources). Gmail requires an email.
    // Screenshots often have no email — dedup those by name+phone instead of dropping them.
    if (email) {
      if (seen.has(email)) { skipped++; continue; }
      seen.add(email);
    } else if (source === 'gmail') {
      skipped++; continue;
    } else {
      const c = r.candidate || {};
      const key = 'np:' + norm(c.name || c.org || c.venue_name) + '|' + String(c.phone || '').replace(/[^0-9]/g, '');
      if (key !== 'np:|' && seen.has(key)) { skipped++; continue; }
      if (key !== 'np:|') seen.add(key);
    }
    const doc = {
      type: r.type === 'update' ? 'update' : 'new',
      status: 'pending',
      source,
      source_image_url: r.source_image_url || '',
      source_filename: r.source_filename || '',
      candidate: r.candidate || {},
      match_target_venue_id: r.match_target_venue_id || '',
      proposed_fields: r.proposed_fields || {},
      existing_snapshot: r.existing_snapshot || {},
      confidence: r.confidence || 'medium',
      note: r.note || '',
      scanned_window_start: scan.window_start || '',
      scanned_window_end: scan.window_end || '',
      created_at: now(), updated_at: now(),
    };
    await createDoc(COLL, doc, id());
    staged++;
  }
  return { success: true, staged, skipped, total_in: rows.length };
}

async function editProposal(pid, patch) {
  if (!pid) throw new Error('id required');
  const p = await getDoc(COLL, pid);
  if (!p) return { success: false, error: 'Proposal not found' };
  if ((p.status || 'pending') !== 'pending') return { success: false, error: 'Only pending proposals can be edited' };
  const ALLOWED = ['name','title','org','venue_name','email','phone','whatsapp','website','instagram','facebook','twitter','tiktok','youtube','linkedin','soundcloud','spotify','bandcamp','telegram','contact_type','city','region','country','address','market','booking_method','relationship_status','notes','venues','emails','phones','other_socials'];
  const c = { ...(p.candidate || {}) };
  ALLOWED.forEach(k => {
    if (patch[k] === undefined) return;
    if (k === 'venues') {
      c.venues = Array.isArray(patch.venues)
        ? patch.venues.filter(v => v && String(v.name || '').trim())
            .map(v => ({ name: String(v.name).trim(), city: String(v.city || '').trim(), address: String(v.address || '').trim() }))
        : [];
    } else if (k === 'emails' || k === 'phones') {
      c[k] = Array.isArray(patch[k]) ? patch[k].map(x => String(x || '').trim()).filter(Boolean) : c[k];
    } else if (k === 'other_socials') {
      c[k] = Array.isArray(patch[k]) ? patch[k].filter(o => o && (o.handle || o.url)).map(o => ({ platform: String(o.platform||'').trim(), handle: String(o.handle||'').trim(), url: String(o.url||'').trim() })) : c[k];
    } else {
      c[k] = typeof patch[k] === 'string' ? patch[k].trim() : patch[k];
    }
  });
  const upd = { candidate: c, updated_at: now(), edited: true };
  if (p.type === 'update' && p.proposed_fields) {
    const pf = { ...p.proposed_fields };
    ['website','instagram','phone','booking_method','city','region','country'].forEach(k => {
      if (patch[k] !== undefined && pf[k] !== undefined && c[k]) pf[k] = c[k];
    });
    upd.proposed_fields = pf;
  }
  await updateDoc(COLL, pid, upd);
  return { success: true, candidate: c };
}

async function approveProposal(pid) {
  if (!pid) throw new Error('id required');
  const p = await getDoc(COLL, pid);
  if (!p) throw new Error('proposal not found');
  if (p.status === 'approved') return { success: true, already: true, venue_id: p.venue_id };

  let effective = p, deduped = false, matchedOn = '', matchedVenueId = '';
  if (!(p.type === 'update' && p.match_target_venue_id)) {
    // Not already targeting a known record — fast duplicate safety net before creating a new one.
    const dupe = await findDuplicateVenueFast(p.candidate || {});
    if (dupe) {
      deduped = true; matchedOn = dupe.matched_on; matchedVenueId = dupe.venue.id;
      effective = { ...p, type: 'update', match_target_venue_id: dupe.venue.id, existing_snapshot: dupe.venue };
    }
  }
  const venue = await writeToCRM(effective);
  await updateDoc(COLL, pid, {
    status: 'approved', venue_id: venue.id || '', updated_at: now(),
    deduped, ...(deduped ? { duplicate_of: matchedVenueId, duplicate_matched_on: matchedOn } : {}),
  });
  return { success: true, venue_id: venue.id || '', venue, deduped, matched_existing_id: matchedVenueId, matched_on: matchedOn };
}

async function bulkApprove(ids) {
  const results = [];
  for (const pid of ids) {
    try {
      const r = await approveProposal(pid);
      results.push({ id: pid, ok: true, venue_id: r.venue_id, deduped: r.deduped, matched_on: r.matched_on });
    } catch (e) { results.push({ id: pid, ok: false, error: e.message }); }
  }
  const ok = results.filter(r => r.ok).length;
  const deduped = results.filter(r => r.ok && r.deduped).length;
  return { success: true, approved: ok, failed: results.length - ok, deduped, results };
}

async function rejectProposal(pid, reason) {
  if (!pid) throw new Error('id required');
  await updateDoc(COLL, pid, { status: 'rejected', reject_reason: reason || '', updated_at: now() });
  return { success: true };
}

async function writeToCRM(p) {
  let venuePayload;
  if (p.type === 'update' && p.match_target_venue_id) {
    const live = await getDoc(VENUES, p.match_target_venue_id).catch(() => null);
    const base = live || p.existing_snapshot || {};
    const merged = { ...base, id: p.match_target_venue_id };
    Object.entries(p.proposed_fields || {}).forEach(([k, v]) => {
      if (v && !isFilled(base[k])) merged[k] = v;
    });
    // Venues UNION: never overwrite; add any new rooms not already present (case-insensitive by name)
    const propVenues = Array.isArray((p.candidate || {}).venues) ? p.candidate.venues.filter(v => v && v.name) : [];
    if (propVenues.length) {
      const existingV = Array.isArray(base.associated_venues) ? base.associated_venues : [];
      const seen = new Set(existingV.map(v => String(v.name || '').toLowerCase().trim()));
      const additions = [];
      propVenues.forEach(v => {
        const key = String(v.name).toLowerCase().trim();
        if (key && !seen.has(key)) { seen.add(key); additions.push({ name: v.name, city: v.city || '', address: v.address || '' }); }
      });
      if (additions.length) merged.associated_venues = existingV.concat(additions);
    }
    // Union-merge multi-value contact fields (emails, phones, other socials) — never overwrite, add new only
    const c2 = p.candidate || {};
    const unionStr = (existArr, addArr, addScalar) => {
      const out = Array.isArray(existArr) ? existArr.slice() : [];
      const seenl = new Set(out.map(x => String(x || '').trim().toLowerCase()));
      [].concat(Array.isArray(addArr) ? addArr : [], addScalar ? [addScalar] : []).forEach(x => {
        const v = String(x || '').trim(); const k = v.toLowerCase();
        if (v && !seenl.has(k)) { seenl.add(k); out.push(v); }
      });
      return out;
    };
    const em = unionStr(base.emails, c2.emails, c2.email);
    if (em.length) merged.emails = em;
    const ph = unionStr(base.phones, c2.phones, c2.phone);
    if (ph.length) merged.phones = ph;
    if (Array.isArray(c2.other_socials) && c2.other_socials.length) {
      const existO = Array.isArray(base.other_socials) ? base.other_socials : [];
      const oseen = new Set(existO.map(o => (String(o.platform || '') + '|' + String(o.handle || o.url || '')).toLowerCase()));
      const addO = [];
      c2.other_socials.filter(o => o && (o.handle || o.url)).forEach(o => {
        const k = (String(o.platform || '') + '|' + String(o.handle || o.url || '')).toLowerCase();
        if (!oseen.has(k)) { oseen.add(k); addO.push({ platform: o.platform || '', handle: o.handle || '', url: o.url || '' }); }
      });
      if (addO.length) merged.other_socials = existO.concat(addO);
    }
    // Fill any empty scalar social/contact fields from the candidate (only-if-empty)
    ['contact_name','contact_title','address','whatsapp','instagram','facebook','twitter','tiktok','youtube','linkedin','soundcloud','spotify','bandcamp','telegram','website'].forEach(k => {
      const src = k === 'contact_name' ? c2.name : k === 'contact_title' ? c2.title : c2[k];
      if (src && !isFilled(base[k])) merged[k] = src;
    });
    venuePayload = merged;
  } else {
    const c = p.candidate || {};
    const uniq = (a) => { const o=[],s=new Set(); (Array.isArray(a)?a:[]).forEach(x=>{const v=String(x||'').trim(),k=v.toLowerCase(); if(v&&!s.has(k)){s.add(k);o.push(v);}}); return o; };
    const allEmails = uniq([].concat(c.emails||[], c.email?[c.email]:[]));
    const allPhones = uniq([].concat(c.phones||[], c.phone?[c.phone]:[]));
    const otherSocials = Array.isArray(c.other_socials) ? c.other_socials.filter(o=>o&&(o.handle||o.url)) : [];
    venuePayload = {
      id: venueId(),
      name: c.venue_name || c.org || c.name || c.email || 'Unknown',
      contact_name: c.name || '',
      contact_title: c.title || '',
      city: c.city || 'Unknown',
      country: c.country || '',
      region: c.region || '',
      address: c.address || '',
      market: c.market || '',
      contact_type: c.contact_type || 'promoter',
      booking_email: c.email || (allEmails[0] || ''),
      emails: allEmails,
      phone: c.phone || (allPhones[0] || ''),
      phones: allPhones,
      whatsapp: c.whatsapp || '',
      website: c.website || '',
      instagram: c.instagram || '',
      facebook: c.facebook || '',
      twitter: c.twitter || '',
      tiktok: c.tiktok || '',
      youtube: c.youtube || '',
      linkedin: c.linkedin || '',
      soundcloud: c.soundcloud || '',
      spotify: c.spotify || '',
      bandcamp: c.bandcamp || '',
      telegram: c.telegram || '',
      other_socials: otherSocials,
      booking_method: c.booking_method || (c.email ? 'email' : ''),
      relationship_status: c.relationship_status || 'prospect',
      genre_affinity: c.genre_affinity || [],
      associated_venues: Array.isArray(c.venues) ? c.venues.filter(v => v && v.name).map(v => ({ name: v.name, city: v.city || '', address: v.address || '' })) : [],
      quality_flags: [],
      source_file: 'contact_discovery',
      notes: c.notes || '',
    };
  }
  const res = await fetch(RAG_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'upsert', venue: venuePayload, skip_embeddings: true, agent_key: AGENT_KEY() }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.success) throw new Error('CRM write failed: ' + (j.error || res.status));
  return j.data || {};
}

function isFilled(v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  return String(v).trim() !== '' && String(v).trim().toLowerCase() !== 'unknown';
}
function norm(s) { return String(s || '').trim().toLowerCase(); }
function normPhone(s) { return String(s || '').replace(/[^0-9]/g, ''); }
const notDeleted = (v) => v && !v.deleted_at;

// Duplicate safety net: run before creating any brand-new CRM venue record.
// Uses FAST targeted Firestore queries (indexed EQUAL lookups) rather than scanning
// the whole collection — a full venue read pulls embeddings and takes ~20s (timeout).
// Matches on: shared booking email, shared phone, or same name + city.
async function findDuplicateVenueFast(candidate) {
  const c = candidate || {};
  const emails = [].concat(c.email ? [c.email] : [], Array.isArray(c.emails) ? c.emails : [])
    .map(x => String(x || '').trim()).filter(Boolean);
  for (const em of emails) {
    const hits = await queryDocs(VENUES, 'booking_email', em, { limit: 5 }).catch(() => []);
    const v = (hits || []).find(notDeleted);
    if (v) return { venue: v, matched_on: 'email' };
  }
  const phones = [].concat(c.phone ? [c.phone] : [], Array.isArray(c.phones) ? c.phones : [])
    .map(x => String(x || '').trim()).filter(Boolean);
  for (const ph of phones) {
    const hits = await queryDocs(VENUES, 'phone', ph, { limit: 5 }).catch(() => []);
    const v = (hits || []).find(notDeleted);
    if (v) return { venue: v, matched_on: 'phone' };
  }
  const name = String(c.venue_name || c.org || c.name || '').trim();
  const cityKey = norm(c.city);
  if (name) {
    const hits = await queryDocs(VENUES, 'name', name, { limit: 10 }).catch(() => []);
    const v = (hits || []).filter(notDeleted).find(x => !cityKey || norm(x.city) === cityKey);
    if (v) return { venue: v, matched_on: cityKey ? 'name+city' : 'name' };
  }
  return null;
}

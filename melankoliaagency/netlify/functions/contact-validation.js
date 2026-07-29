// Contact Validation — mass CRM hygiene pass over route_planner_crm_venues.
// Two kinds of proposals, staged for Adrian's approval (NEVER written directly):
//   1. "restructure" — consolidate a venue's single contact_name/contact_title/
//      booking_email/phone into a new `contacts[]` array (multiple people per
//      company). Also flags when the `name` field looks like it holds a PERSON's
//      name instead of the company/venue name (a known Contact Discovery data-
//      quality issue) and suggests the real company name when it can infer one.
//   2. "merge" — likely-duplicate venue records (same email/phone, or same
//      normalized name+city) proposed to be combined into one record, with the
//      losers soft-deleted (deleted_at) on approval.
//
// Runs entirely against Firestore — no external connectors needed, so the admin
// panel can trigger a scan directly (no agent relay required, unlike Contact
// Discovery's Gmail scan).
const { listDocs, getDoc, createDoc, updateDoc, json } = require('./_firebase');
const { authorize } = require('./_auth');

const COLL = 'contact_validation_proposals';
const VENUES = 'route_planner_crm_venues';
const AGENT_KEY = () => process.env.CONTACT_DISCOVERY_KEY || process.env.MELANKOLIA_ADMIN_PASSWORD || 'melankolia2025';
const RAG_URL = (process.env.SITE_BASE || 'https://melankoliaagency.com') + '/.netlify/functions/rag-venues';
const now = () => new Date().toISOString();
const id = () => `cvp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { success: false, error: 'POST only' });
  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch { return json(400, { success: false, error: 'Invalid JSON' }); }
  try {
    const isAgent = b.agent_key === AGENT_KEY();
    const auth = isAgent ? { ok: true } : await authorize(b, 'validation');
    if (!auth.ok) return json(401, { success: false, error: auth.error || 'Unauthorized' });

    if (b.action === 'scan') return json(200, await runScan(b.options || {}));
    if (b.action === 'list') return json(200, await listProposals(b));
    if (b.action === 'stats') return json(200, await statsProposals());
    if (b.action === 'edit') return json(200, await editProposal(b.id, b.after || {}));
    if (b.action === 'approve') return json(200, await approveProposal(b.id));
    if (b.action === 'bulk_approve') return json(200, await bulkApprove(b.ids || []));
    if (b.action === 'reject') return json(200, await rejectProposal(b.id, b.reason || ''));
    if (b.action === 'bulk_reject') return json(200, await bulkReject(b.ids || []));
    if (b.action === 'import_google_contacts') return json(200, await importGoogleContacts(b.csv || '', b.contacts || null));
    if (b.action === 'purge') {
      if (!isAgent) return json(403, { success: false, error: 'purge requires agent_key' });
      const t0 = Date.now();
      const all = await listDocs(COLL, { orderBy: 'created_at desc', pageSize: 1000, mask: ['status'] }).catch(() => []);
      // Bug history: this used to be `(!b.status || status===b.status) || (ids && ids.includes(...))`
      // which meant "no status given" ALWAYS matched everything, regardless of `ids` — a single
      // purge-by-id call with no status wiped the ENTIRE queue once (2026-07-29). Fixed: ids and
      // status are now independent, explicit filters that must each be satisfied when present;
      // if NEITHER is given, match nothing (a purge call must say what it's purging).
      const hasIds = Array.isArray(b.ids) && b.ids.length > 0;
      const hasStatus = !!b.status;
      if (!hasIds && !hasStatus) return json(400, { success: false, error: 'purge requires ids[] and/or status' });
      let del = 0, more = false;
      for (const d of all) {
        if ((Date.now() - t0) > 18000) { more = true; break; }
        const statusOk = !hasStatus || (d.status || 'pending') === b.status;
        const idsOk = !hasIds || b.ids.includes(d.id);
        if (statusOk && idsOk) { await require('./_firebase').deleteDoc(COLL, d.id).catch(() => {}); del++; }
      }
      return json(200, { success: true, deleted: del, more });
    }
    return json(400, { success: false, error: 'Unknown action' });
  } catch (e) {
    return json(500, { success: false, error: e.message || 'error' });
  }
};

// ---------- helpers ----------
function isFilled(v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  return String(v).trim() !== '' && String(v).trim().toLowerCase() !== 'unknown';
}
function uniqArr(a) {
  const out = [], seen = new Set();
  (a || []).forEach(x => {
    const key = typeof x === 'string' ? x.trim().toLowerCase() : JSON.stringify(x);
    if (key && !seen.has(key)) { seen.add(key); out.push(typeof x === 'string' ? x.trim() : x); }
  });
  return out;
}
function normName(x) {
  return String(x || '').toLowerCase()
    .replace(/\b(the|a|an|venue|club|bar|hall|theatre|theater|lounge|room)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function normPhone(s) { return String(s || '').replace(/[^0-9]/g, ''); }
function normEmail(s) { return String(s || '').trim().toLowerCase(); }

const BIZ_WORDS = /\b(club|bar|hall|theatre|theater|lounge|room|agency|booking|bookings|records|recordings|live|presents|productions|production|music|sounds|promotions|festival|collective|events|entertainment|studio|studios|society|association|assoc|llc|inc|ltd|gmbh|kollektiv|verein|company|co\.|group|network|arts|gallery|café|cafe|pub|tavern|warehouse|space|venue|dj|crew|label|management|mgmt|hq|house|hotel|center|centre)\b/i;
function looksLikePerson(name) {
  const s = String(name || '').trim();
  if (!s || BIZ_WORDS.test(s)) return false;
  const words = s.split(/\s+/);
  if (words.length < 2 || words.length > 3) return false;
  if (/[\d@&/]/.test(s)) return false;
  return words.every(w => /^[A-ZÀ-Ý][a-zà-ÿ'’.-]*$/.test(w));
}
function inferCompanyName(v) {
  if (Array.isArray(v.associated_venues) && v.associated_venues.length && v.associated_venues[0].name) return v.associated_venues[0].name;
  return '';
}

const SCALAR_FIELDS = ['name', 'contact_type', 'city', 'region', 'country', 'address', 'market', 'booking_email', 'phone', 'whatsapp', 'website', 'instagram', 'facebook', 'twitter', 'tiktok', 'youtube', 'linkedin', 'soundcloud', 'spotify', 'bandcamp', 'telegram', 'booking_method', 'relationship_status', 'notes', 'capacity', 'actual_capacity', 'rating', 'buyer_status'];
const ARRAY_FIELDS = ['emails', 'phones', 'genre_affinity', 'associated_venues', 'contacts', 'other_socials', 'quality_flags'];
function mergeVenues(primary, losers) {
  const merged = { ...primary };
  for (const loser of losers) {
    for (const f of SCALAR_FIELDS) if (!isFilled(merged[f]) && isFilled(loser[f])) merged[f] = loser[f];
    for (const f of ARRAY_FIELDS) merged[f] = uniqArr([...(merged[f] || []), ...(loser[f] || [])]);
  }
  return merged;
}

const VENUE_MASK = ['name','city','country','region','address','market','contact_type','contact_name','contact_title','booking_email','phone','emails','phones','whatsapp','website','instagram','facebook','twitter','tiktok','youtube','linkedin','soundcloud','spotify','bandcamp','telegram','other_socials','booking_method','relationship_status','genre_affinity','associated_venues','contacts','quality_flags','notes','capacity','actual_capacity','rating','buyer_status','deleted_at','merged_into','created_at','updated_at','source_file'];
async function listVenues() {
  return (await listDocs(VENUES, { orderBy: 'updated_at desc', pageSize: 2000, mask: VENUE_MASK })).filter(v => !v.deleted_at);
}

// ---------- scan ----------
async function runScan(options) {
  const t0 = Date.now();
  const BUDGET_MS = 18000; // leave headroom under Netlify's ~25s function limit
  const outOfTime = () => (Date.now() - t0) > BUDGET_MS;
  const doRestructure = options.restructure !== false;
  const doDedupe = options.dedupe !== false;
  const venues = await listVenues();
  const existingProposals = await listDocs(COLL, { orderBy: 'created_at desc', pageSize: 2000, mask: ['type', 'target_venue_id', 'merge_venue_ids'] }).catch(() => []);

  const restructureSeen = new Set(existingProposals.filter(p => p.type === 'restructure').map(p => p.target_venue_id));
  const mergeSeen = new Set(existingProposals.filter(p => p.type === 'merge').map(p => sigOf(p.target_venue_id, p.merge_venue_ids)));

  let restructureStaged = 0, mergeStaged = 0;

  let restructureTruncated = false;
  if (doRestructure) {
    for (const v of venues) {
      if (outOfTime()) { restructureTruncated = true; break; }
      if (Array.isArray(v.contacts) && v.contacts.length) continue; // already restructured
      if (restructureSeen.has(v.id)) continue;
      const hasPersonFields = v.contact_name || v.booking_email || v.phone || (v.emails && v.emails.length) || (v.phones && v.phones.length);
      if (!hasPersonFields) continue;
      // Only flag "name looks like a person" for records that actually came through
      // Contact Discovery (source_file === 'contact_discovery') — that's the one
      // pipeline known to sometimes put a person's name straight into `name` with no
      // separate contact_name. Legacy-imported venues (~1,121 records, no source_file)
      // legitimately have real venue names here even when they match the word-shape
      // heuristic (e.g. "Mad Planet", "Pie Shop", "Ground Control") — never flag those.
      const personAsCompany = v.source_file === 'contact_discovery' && looksLikePerson(v.name) && !v.contact_name;
      const suggestedName = personAsCompany ? inferCompanyName(v) : '';
      const contactEntry = {
        name: v.contact_name || (personAsCompany ? v.name : '') || '',
        title: v.contact_title || '',
        email: v.booking_email || (v.emails && v.emails[0]) || '',
        phone: v.phone || (v.phones && v.phones[0]) || '',
        whatsapp: v.whatsapp || '',
        is_primary: true,
      };
      const proposedName = suggestedName || v.name;
      const doc = {
        type: 'restructure', status: 'pending',
        target_venue_id: v.id,
        before: { name: v.name, contact_name: v.contact_name || '', contact_title: v.contact_title || '', booking_email: v.booking_email || '', phone: v.phone || '' },
        after: { name: proposedName, contacts: [contactEntry], person_as_company: personAsCompany, needs_manual_name: personAsCompany && !suggestedName },
        confidence: personAsCompany && !suggestedName ? 'low' : (personAsCompany ? 'medium' : 'high'),
        note: personAsCompany
          ? (suggestedName ? `"${v.name}" looks like a person's name, not a company — suggested company name "${suggestedName}" from an associated venue on file.` : `"${v.name}" looks like a person's name, not a company/venue — needs the real business name entered manually.`)
          : 'Consolidating existing single-contact fields into the new multi-contact structure.',
        created_at: now(), updated_at: now(),
      };
      await createDoc(COLL, doc, id());
      restructureStaged++;
    }
  }

  let dedupeTruncated = false;
  if (doDedupe && !outOfTime()) {
    const clusters = findDuplicateClusters(venues);
    for (const cluster of clusters) {
      if (outOfTime()) { dedupeTruncated = true; break; }
      const sig = sigOf(cluster.primary.id, cluster.losers.map(l => l.id));
      if (mergeSeen.has(sig)) continue;
      const merged = mergeVenues(cluster.primary, cluster.losers);
      const doc = {
        type: 'merge', status: 'pending',
        target_venue_id: cluster.primary.id,
        merge_venue_ids: cluster.losers.map(l => l.id),
        before: {
          primary: trimSnapshot(cluster.primary),
          losers: cluster.losers.map(trimSnapshot),
        },
        after: trimSnapshot(merged),
        confidence: cluster.matchedOn === 'name+city' ? 'medium' : 'high',
        note: `Matched by ${cluster.matchedOn}.`,
        created_at: now(), updated_at: now(),
      };
      await createDoc(COLL, doc, id());
      mergeStaged++;
      mergeSeen.add(sig);
    }
  }

  const truncated = restructureTruncated || dedupeTruncated || (doDedupe && outOfTime());
  return { success: true, scanned: venues.length, restructure_staged: restructureStaged, merge_staged: mergeStaged, truncated, more: truncated };
}
function sigOf(targetId, otherIds) { return [targetId, ...(otherIds || [])].sort().join('|'); }
function trimSnapshot(v) {
  const { embedding, rag_text, ...rest } = v || {};
  return rest;
}

function findDuplicateClusters(venues) {
  const byEmail = new Map(), byPhone = new Map(), byNameCity = new Map();
  venues.forEach(v => {
    const emails = uniqArr([].concat(v.booking_email ? [v.booking_email] : [], v.emails || []).map(normEmail));
    emails.forEach(e => { if (!e) return; if (!byEmail.has(e)) byEmail.set(e, []); byEmail.get(e).push(v); });
    const phones = uniqArr([].concat(v.phone ? [v.phone] : [], v.phones || []).map(normPhone));
    phones.forEach(p => { if (!p || p.length < 7) return; if (!byPhone.has(p)) byPhone.set(p, []); byPhone.get(p).push(v); });
    const key = normName(v.name) + '|' + normName(v.city);
    if (normName(v.name) && normName(v.city)) { if (!byNameCity.has(key)) byNameCity.set(key, []); byNameCity.get(key).push(v); }
  });

  const usedAsLoser = new Set();
  const clusters = [];
  function pickPrimary(group) {
    return [...group].sort((a, b) => {
      const scoreA = SCALAR_FIELDS.filter(f => isFilled(a[f])).length, scoreB = SCALAR_FIELDS.filter(f => isFilled(b[f])).length;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return new Date(a.created_at || a._createTime || 0) - new Date(b.created_at || b._createTime || 0);
    })[0];
  }
  function tryStage(group, matchedOn) {
    const distinct = uniqArr(group.map(v => v.id)).map(vid => group.find(v => v.id === vid));
    const fresh = distinct.filter(v => !usedAsLoser.has(v.id));
    if (fresh.length < 2) return;
    const primary = pickPrimary(fresh);
    const losers = fresh.filter(v => v.id !== primary.id);
    if (!losers.length) return;
    losers.forEach(l => usedAsLoser.add(l.id));
    usedAsLoser.add(primary.id);
    clusters.push({ primary, losers, matchedOn });
  }
  for (const group of byEmail.values()) if (group.length > 1) tryStage(group, 'shared booking email');
  for (const group of byPhone.values()) if (group.length > 1) tryStage(group, 'shared phone number');
  for (const group of byNameCity.values()) if (group.length > 1) tryStage(group, 'name+city');
  return clusters;
}

// ---------- Google Contacts import ----------
// No native Google Contacts connector exists on this platform, so the practical
// path is: Adrian exports Google Contacts (contacts.google.com -> Export -> Google
// CSV), and either the agent or the admin panel uploads that CSV text here. Same
// idempotent/time-budgeted staging pattern as scan(): re-posting the same CSV is
// safe, already-staged contacts are skipped via a normalized-identity "seen" set.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const s = String(text || '').replace(/\r\n/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => r.some(v => String(v || '').trim())).map(r => {
    const o = {};
    header.forEach((h, idx) => { o[h] = r[idx] != null ? r[idx].trim() : ''; });
    return o;
  });
}
function colsMatching(header, re) { return header.filter(h => re.test(h)); }
function normalizeGoogleRow(row) {
  const cols = Object.keys(row);
  const emailCols = colsMatching(cols, /^E-mail \d+ - Value$/);
  const phoneCols = colsMatching(cols, /^Phone \d+ - Value$/);
  const websiteCols = colsMatching(cols, /^Website \d+ - Value$/);
  const emails = uniqArr(emailCols.map(c => row[c]).filter(Boolean).map(normEmail));
  const phones = uniqArr(phoneCols.map(c => row[c]).filter(Boolean));
  const website = (websiteCols.map(c => row[c]).find(Boolean)) || '';
  const name = row['Name'] || [row['Given Name'], row['Family Name']].filter(Boolean).join(' ').trim();
  const org = row['Organization Name'] || '';
  const title = row['Organization Title'] || '';
  const notes = row['Notes'] || '';
  const addrFormatted = row['Address 1 - Formatted'] || '';
  const street = row['Address 1 - Street'] || '';
  const city = row['Address 1 - City'] || '';
  const region = row['Address 1 - Region'] || '';
  const postal = row['Address 1 - Postal Code'] || '';
  const country = row['Address 1 - Country'] || '';
  const address = addrFormatted || uniqArr([street, city, region, postal, country].filter(Boolean)).join(', ');
  if (!name && !org && !emails.length && !phones.length) return null;
  return { name, org, title, emails, phones, website, address, city, region, country, notes };
}
function googleContactKey(gc) {
  return normEmail(gc.emails[0] || '') || normPhone(gc.phones[0] || '') || normName(gc.org || gc.name || '');
}
async function importGoogleContacts(csvText, preParsed) {
  const t0 = Date.now();
  const BUDGET_MS = 18000;
  const outOfTime = () => (Date.now() - t0) > BUDGET_MS;

  let rows = [];
  if (Array.isArray(preParsed)) rows = preParsed;
  else rows = parseCsv(csvText).map(normalizeGoogleRow).filter(Boolean);
  if (!rows.length) return { success: true, scanned: 0, matched: 0, staged_new: 0, staged_update: 0, more: false };

  const venues = await listVenues();
  const byEmail = new Map(), byPhone = new Map(), byName = new Map();
  venues.forEach(v => {
    uniqArr([].concat(v.booking_email ? [v.booking_email] : [], v.emails || []).map(normEmail)).forEach(e => { if (e) byEmail.set(e, v); });
    uniqArr([].concat(v.phone ? [v.phone] : [], v.phones || []).map(normPhone)).forEach(p => { if (p && p.length >= 7) byPhone.set(p, v); });
    if (normName(v.name)) byName.set(normName(v.name), v);
    (v.contacts || []).forEach(ct => { if (ct.name && normName(ct.name)) byName.set(normName(ct.name), v); });
  });

  const existingProposals = await listDocs(COLL, { orderBy: 'created_at desc', pageSize: 2000, mask: ['type', 'google_key'] }).catch(() => []);
  const seen = new Set(existingProposals.filter(p => p.type === 'google_contact_update' || p.type === 'google_contact_new').map(p => p.google_key).filter(Boolean));

  let stagedNew = 0, stagedUpdate = 0, matched = 0, scanned = 0, truncated = false;
  for (const gc of rows) {
    scanned++;
    if (outOfTime()) { truncated = true; break; }
    const key = googleContactKey(gc);
    if (!key || seen.has(key)) continue;

    let venue = null;
    for (const e of gc.emails) { if (byEmail.has(e)) { venue = byEmail.get(e); break; } }
    if (!venue) for (const p of gc.phones.map(normPhone)) { if (byPhone.has(p)) { venue = byPhone.get(p); break; } }
    if (!venue && gc.org && byName.has(normName(gc.org))) venue = byName.get(normName(gc.org));
    if (!venue && gc.name && byName.has(normName(gc.name))) venue = byName.get(normName(gc.name));

    if (venue) {
      matched++;
      const proposedFields = {};
      if (!isFilled(venue.address) && gc.address) proposedFields.address = gc.address;
      if (!isFilled(venue.city) && gc.city) proposedFields.city = gc.city;
      if (!isFilled(venue.region) && gc.region) proposedFields.region = gc.region;
      if (!isFilled(venue.country) && gc.country) proposedFields.country = gc.country;
      if (!isFilled(venue.website) && gc.website) proposedFields.website = gc.website;
      const alreadyHasContact = (venue.contacts || []).some(ct => normEmail(ct.email) === (gc.emails[0] || '__none__') || normName(ct.name) === normName(gc.name || '__none__'));
      const newContact = (!alreadyHasContact && (gc.name || gc.emails.length || gc.phones.length))
        ? { name: gc.name || '', title: gc.title || '', email: gc.emails[0] || '', phone: gc.phones[0] || '', is_primary: false }
        : null;
      if (!Object.keys(proposedFields).length && !newContact) { seen.add(key); continue; } // nothing new to add
      const doc = {
        type: 'google_contact_update', status: 'pending', google_key: key,
        target_venue_id: venue.id,
        before: trimSnapshot(venue),
        after: { proposed_fields: proposedFields, new_contact: newContact },
        google_contact: gc,
        confidence: 'high',
        note: `Matched CRM record "${venue.name}" to Google contact "${gc.name || gc.org}".`,
        created_at: now(), updated_at: now(),
      };
      await createDoc(COLL, doc, id());
      stagedUpdate++;
    } else {
      const looksBookingRelated = !!(gc.org || gc.address || gc.title);
      const doc = {
        type: 'google_contact_new', status: 'pending', google_key: key,
        target_venue_id: null,
        before: null,
        after: {
          name: gc.org || gc.name || 'Unknown', contact_type: 'other',
          city: gc.city, region: gc.region, country: gc.country, address: gc.address, website: gc.website,
          booking_email: gc.emails[0] || '', phone: gc.phones[0] || '', emails: gc.emails, phones: gc.phones,
          contacts: [{ name: gc.name || '', title: gc.title || '', email: gc.emails[0] || '', phone: gc.phones[0] || '', is_primary: true }],
          notes: gc.notes || '', source_file: 'google_contacts',
        },
        google_contact: gc,
        confidence: looksBookingRelated ? 'medium' : 'low',
        note: looksBookingRelated ? 'No matching CRM record — proposing a new contact.' : 'No matching CRM record and no org/address/title — double-check this is booking-related before approving.',
        created_at: now(), updated_at: now(),
      };
      await createDoc(COLL, doc, id());
      stagedNew++;
    }
    seen.add(key);
  }
  return { success: true, scanned, matched, staged_new: stagedNew, staged_update: stagedUpdate, truncated, more: truncated };
}

// ---------- list / stats ----------
async function listProposals(b) {
  let docs = await listDocs(COLL, { orderBy: 'created_at desc', pageSize: 2000 }).catch(() => []);
  const status = b.status || 'pending';
  if (status !== 'all') docs = docs.filter(d => (d.status || 'pending') === status);
  if (b.type && b.type !== 'all') docs = docs.filter(d => d.type === b.type);
  return { success: true, data: docs, count: docs.length };
}
async function statsProposals() {
  const docs = await listDocs(COLL, { orderBy: 'created_at desc', pageSize: 2000 }).catch(() => []);
  const s = { pending: 0, approved: 0, rejected: 0, restructure: 0, merge: 0, google_contact_update: 0, google_contact_new: 0, total: docs.length };
  docs.forEach(d => {
    const st = d.status || 'pending'; if (s[st] != null) s[st]++;
    if (st === 'pending' && s[d.type] != null) s[d.type]++;
  });
  const restructureTargets = docs.filter(d => (d.status || 'pending') === 'pending' && d.type === 'restructure').map(d => d.target_venue_id).filter(Boolean);
  const mergeSignatures = docs.filter(d => (d.status || 'pending') === 'pending' && d.type === 'merge').map(d => sigOf(d.target_venue_id, d.merge_venue_ids));
  s.unique_restructure_targets = new Set(restructureTargets).size;
  s.duplicate_restructure_proposals = restructureTargets.length - s.unique_restructure_targets;
  s.unique_merge_signatures = new Set(mergeSignatures).size;
  s.duplicate_merge_proposals = mergeSignatures.length - s.unique_merge_signatures;
  return { success: true, data: s };
}

async function editProposal(pid, patch) {
  if (!pid) throw new Error('id required');
  const p = await getDoc(COLL, pid);
  if (!p) return { success: false, error: 'Proposal not found' };
  if ((p.status || 'pending') !== 'pending') return { success: false, error: 'Only pending proposals can be edited' };
  const after = { ...(p.after || {}) };
  if (patch.name !== undefined) after.name = String(patch.name || '').trim();
  if (Array.isArray(patch.contacts)) {
    after.contacts = patch.contacts.filter(c => c && (c.name || c.email || c.phone)).map(c => ({
      name: String(c.name || '').trim(), title: String(c.title || '').trim(),
      email: String(c.email || '').trim(), phone: String(c.phone || '').trim(),
      whatsapp: String(c.whatsapp || '').trim(), is_primary: !!c.is_primary,
    }));
  }
  await updateDoc(COLL, pid, { after, updated_at: now(), edited: true });
  return { success: true, after };
}

// ---------- approve / reject ----------
async function approveProposal(pid) {
  if (!pid) throw new Error('id required');
  const p = await getDoc(COLL, pid);
  if (!p) throw new Error('proposal not found');
  if (p.status === 'approved') return { success: true, already: true };

  if (p.type === 'restructure') {
    const venue = await getDoc(VENUES, p.target_venue_id);
    if (!venue) throw new Error('Target venue no longer exists');
    const payload = { ...venue, contacts: p.after.contacts || [] };
    if (p.after.name) payload.name = p.after.name;
    const res = await fetch(RAG_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upsert', venue: payload, skip_embeddings: true, agent_key: AGENT_KEY() }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.success) throw new Error('CRM write failed: ' + (j.error || res.status));
    await updateDoc(COLL, pid, { status: 'approved', updated_at: now() });
    return { success: true, venue_id: p.target_venue_id };
  }

  if (p.type === 'merge') {
    const primary = await getDoc(VENUES, p.target_venue_id);
    if (!primary) throw new Error('Primary venue no longer exists');
    const losers = [];
    for (const lid of (p.merge_venue_ids || [])) {
      const l = await getDoc(VENUES, lid);
      if (l && !l.deleted_at) losers.push(l);
    }
    if (!losers.length) { await updateDoc(COLL, pid, { status: 'approved', updated_at: now(), note_extra: 'losers already gone' }); return { success: true, venue_id: p.target_venue_id, no_op: true }; }
    const merged = mergeVenues(primary, losers); // re-merge from LIVE data, not the stale preview
    const res = await fetch(RAG_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upsert', venue: merged, skip_embeddings: true, agent_key: AGENT_KEY() }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.success) throw new Error('CRM write failed: ' + (j.error || res.status));
    for (const l of losers) await updateDoc(VENUES, l.id, { deleted_at: now(), merged_into: primary.id });
    await updateDoc(COLL, pid, { status: 'approved', updated_at: now() });
    return { success: true, venue_id: primary.id, merged_count: losers.length };
  }

  if (p.type === 'google_contact_update') {
    const venue = await getDoc(VENUES, p.target_venue_id);
    if (!venue) throw new Error('Target venue no longer exists');
    const payload = { ...venue, ...(p.after.proposed_fields || {}) };
    if (p.after.new_contact) {
      const dup = (payload.contacts || []).some(ct => normEmail(ct.email) === normEmail(p.after.new_contact.email) || (p.after.new_contact.name && normName(ct.name) === normName(p.after.new_contact.name)));
      if (!dup) payload.contacts = [...(payload.contacts || []), p.after.new_contact];
    }
    const res = await fetch(RAG_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upsert', venue: payload, skip_embeddings: true, agent_key: AGENT_KEY() }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.success) throw new Error('CRM write failed: ' + (j.error || res.status));
    await updateDoc(COLL, pid, { status: 'approved', updated_at: now() });
    return { success: true, venue_id: p.target_venue_id };
  }

  if (p.type === 'google_contact_new') {
    const payload = { ...p.after };
    const res = await fetch(RAG_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upsert', venue: payload, skip_embeddings: true, agent_key: AGENT_KEY() }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.success) throw new Error('CRM write failed: ' + (j.error || res.status));
    await updateDoc(COLL, pid, { status: 'approved', updated_at: now() });
    return { success: true, venue_id: j.data && j.data.id };
  }

  throw new Error('Unknown proposal type');
}
async function bulkApprove(ids) {
  const results = [];
  for (const pid of ids) {
    try { const r = await approveProposal(pid); results.push({ id: pid, ok: true, ...r }); }
    catch (e) { results.push({ id: pid, ok: false, error: e.message }); }
  }
  return { success: true, approved: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results };
}
async function rejectProposal(pid, reason) {
  if (!pid) throw new Error('id required');
  await updateDoc(COLL, pid, { status: 'rejected', reject_reason: reason || '', updated_at: now() });
  return { success: true };
}
async function bulkReject(ids) {
  let n = 0;
  for (const pid of ids) { await updateDoc(COLL, pid, { status: 'rejected', updated_at: now() }).catch(() => {}); n++; }
  return { success: true, rejected: n };
}

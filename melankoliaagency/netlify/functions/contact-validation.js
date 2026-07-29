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
const { listDocs, getDoc, createDoc, updateDoc, queryDocs, json } = require('./_firebase');
const { authorize } = require('./_auth');
const crypto = require('crypto');

const COLL = 'contact_validation_proposals';
const VENUES = 'route_planner_crm_venues';
const GMAIL_QUEUE = 'contact_validation_gmail_queue';
const AGENT_KEY = () => process.env.CONTACT_DISCOVERY_KEY || process.env.MELANKOLIA_ADMIN_PASSWORD || 'melankolia2025';
const RAG_URL = (process.env.SITE_BASE || 'https://melankoliaagency.com') + '/.netlify/functions/rag-venues';
const now = () => new Date().toISOString();
const id = () => `cvp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const venueId = () => `venue_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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
    if (b.action === 'import_contract_contacts') {
      if (!isAgent) return json(403, { success: false, error: 'contract import requires agent_key' });
      return json(200, await importContractContacts(b.contacts || []));
    }
    if (b.action === 'import_email_addresses') {
      if (!isAgent) return json(403, { success: false, error: 'email import requires agent_key' });
      return json(200, await importEmailAddresses(b.contacts || []));
    }
    if (b.action === 'gmail_queue_list') {
      if (!isAgent) return json(403, { success: false, error: 'gmail queue requires agent_key' });
      return json(200, await listGmailQueue(b));
    }
    if (b.action === 'gmail_queue_claim') {
      if (!isAgent) return json(403, { success: false, error: 'gmail queue requires agent_key' });
      return json(200, await claimGmailQueue(b.limit || 10));
    }
    if (b.action === 'gmail_queue_complete') {
      if (!isAgent) return json(403, { success: false, error: 'gmail queue requires agent_key' });
      return json(200, await completeGmailQueue(b.id, b.result || {}));
    }
    if (b.action === 'gmail_queue_fail') {
      if (!isAgent) return json(403, { success: false, error: 'gmail queue requires agent_key' });
      return json(200, await failGmailQueue(b.id, b.error || 'Gmail enrichment failed'));
    }
    if (b.action === 'purge') {
      if (!isAgent) return json(403, { success: false, error: 'purge requires agent_key' });
      const t0 = Date.now();
      const all = await listDocs(COLL, { orderBy: 'created_at desc', pageSize: 2000, mask: ['status','type'] }).catch(() => []);
      // Bug history: this used to be `(!b.status || status===b.status) || (ids && ids.includes(...))`
      // which meant "no status given" ALWAYS matched everything, regardless of `ids` — a single
      // purge-by-id call with no status wiped the ENTIRE queue once (2026-07-29). Fixed: ids and
      // status are now independent, explicit filters that must each be satisfied when present;
      // if NEITHER is given, match nothing (a purge call must say what it's purging).
      const hasIds = Array.isArray(b.ids) && b.ids.length > 0;
      const hasStatus = !!b.status;
      const hasType = !!b.type;
      if (!hasIds && !hasStatus && !hasType) return json(400, { success: false, error: 'purge requires ids[], status, and/or type' });
      let del = 0, more = false;
      for (const d of all) {
        if ((Date.now() - t0) > 18000) { more = true; break; }
        const statusOk = !hasStatus || (d.status || 'pending') === b.status;
        const idsOk = !hasIds || b.ids.includes(d.id);
        const typeOk = !hasType || d.type === b.type;
        if (statusOk && idsOk && typeOk) { await require('./_firebase').deleteDoc(COLL, d.id).catch(() => {}); del++; }
      }
      return json(200, { success: true, deleted: del, more });
    }
    return json(400, { success: false, error: 'Unknown action' });
  } catch (e) {
    return json(500, { success: false, error: e.message || 'error' });
  }
};

// ---------- helpers ----------
const PLACEHOLDERS = new Set(['', 'unknown', 'unknown venue', 'unknown organization', 'unknown organisation', 'n/a', 'na', 'tbd', '-', '--', 'none', 'null', 'no name', 'unnamed']);
function isFilled(v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  return !PLACEHOLDERS.has(String(v).trim().toLowerCase());
}
function isPlaceholder(v) { return !isFilled(v); }
function sha(value) { return crypto.createHash('sha1').update(String(value || '')).digest('hex'); }
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
function isPlausiblePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  // Reject calendar dates/ranges that were historically imported into `phone`,
  // e.g. "6.-9.6.2025", "09/06/2025", or "6-9 June 2025".
  if (/\b\d{1,2}\s*[.\/-]\s*\d{1,2}\s*[.\/-]\s*\d{2,4}\b/.test(raw)) return false;
  if (/\b\d{1,2}\s*[-–]\s*\d{1,2}\s*[.\/-]\s*\d{1,2}\s*[.\/-]\s*\d{2,4}\b/.test(raw)) return false;
  if (/\b\d{1,2}\s*[-–]\s*\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4}\b/i.test(raw)) return false;
  const digits = normPhone(raw);
  if (digits.length < 7 || digits.length > 15) return false;
  // Phone fields may contain labels such as "tel" or "mobile", but reject
  // arbitrary prose/month values. The punctuation itself is phone-safe.
  const words = raw.match(/[a-z]+/gi) || [];
  const allowed = new Set(['tel','telephone','phone','mobile','mob','cell','office','fax','whatsapp','wa','ext','extension']);
  if (words.some(w => !allowed.has(w.toLowerCase()))) return false;
  return true;
}
function normEmail(s) { return String(s || '').trim().toLowerCase(); }
function nameIdentityTokens(name) {
  const generic = new Set(['festival','festivals','fest','events','event','productions','production','promotions','promotion','presents','gatherings','gathering']);
  return [...new Set(normName(name).split(/\s+/).filter(t => t && !generic.has(t)))];
}
function namesLikelySame(a, b) {
  const aa = nameIdentityTokens(a), bb = nameIdentityTokens(b);
  if (!aa.length || !bb.length) return false;
  const sa = aa.join(' '), sb = bb.join(' ');
  if (sa === sb) return true;
  // Alias/expanded names such as "From Hell To Disco" and
  // "Asfalt Gatherings / From Hell To Disco" retain the shorter identity.
  const shorter = aa.length <= bb.length ? aa : bb;
  const longer = aa.length <= bb.length ? bb : aa;
  if (shorter.length >= 2 && shorter.every(t => longer.includes(t))) return true;
  const overlap = aa.filter(t => bb.includes(t)).length;
  return overlap / Math.max(aa.length, bb.length) >= 0.75;
}
function similarNameGroups(group) {
  const pending = [...group], out = [];
  while (pending.length) {
    const component = [pending.shift()];
    for (let i = 0; i < component.length; i++) {
      for (let j = pending.length - 1; j >= 0; j--) {
        if (namesLikelySame(component[i].name, pending[j].name)) component.push(pending.splice(j, 1)[0]);
      }
    }
    if (component.length > 1) out.push(component);
  }
  return out;
}

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

// ---------- notes / legacy enrichment ----------
const NOTE_RECORD_FIELDS = ['name','contact_type','address','city','region','country','website','instagram','booking_method'];
function evidenceValue(raw) { return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 220); }
function labelledValue(notes, labels) {
  const escaped = labels.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const m = String(notes || '').match(new RegExp(`(?:^|[|;\\n])\\s*(?:${escaped})\\s*:\\s*([^|;\\n]+)`, 'i'));
  return m ? evidenceValue(m[1]) : '';
}
function splitPeople(value) {
  const raw = evidenceValue(value);
  if (!isFilled(raw)) return [];
  return uniqArr(raw.split(/\s+(?:and|&)\s+|\s*;\s*/i).map(x => x.trim()).filter(x => isFilled(x) && !/^(several|multiple|various|team|staff)$/i.test(x)));
}
function explicitEmail(notes) {
  const labelled = labelledValue(notes, ['booking email','contact email','email','e-mail']);
  const hay = labelled || String(notes || '');
  const m = hay.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? normEmail(m[0]) : '';
}
function explicitUrl(notes, labels) {
  const labelled = labelledValue(notes, labels);
  const hay = labelled || '';
  const m = hay.match(/https?:\/\/[^\s|,;]+/i);
  return m ? m[0].replace(/[.)]+$/, '') : '';
}
function explicitPhone(notes, labels) {
  const raw = labelledValue(notes, labels);
  return isPlausiblePhone(raw) ? raw : '';
}
function mapContactType(raw) {
  const s = String(raw || '').toLowerCase();
  if (/festival/.test(s)) return 'festival';
  if (/venue|club|theatre|theater|hall|room/.test(s)) return 'venue';
  if (/agency|agent|management/.test(s)) return 'agency';
  if (/promoter|buyer|booker|events|production/.test(s)) return 'promoter';
  return '';
}
function contactKey(c) {
  const email = normEmail(c && c.email), phone = isPlausiblePhone(c && c.phone) ? normPhone(c.phone) : '', name = normName(c && c.name);
  return email ? `e:${email}` : phone ? `p:${phone}` : name ? `n:${name}` : '';
}
function buildContactIndex(venues) {
  const idx = new Map();
  for (const v of venues) {
    const contacts = [...(v.contacts || [])];
    if (v.booking_email || v.contact_name || v.phone) contacts.push({ name:v.contact_name || '', email:v.booking_email || '', phone:v.phone || '' });
    for (const c of contacts) {
      const key = contactKey(c); if (!key) continue;
      if (!idx.has(key)) idx.set(key, []);
      if (!idx.get(key).some(x => x.id === v.id)) idx.get(key).push({ id:v.id, name:v.name || '', city:v.city || '' });
    }
  }
  return idx;
}
function buildNoteEnrichment(v, contactIndex) {
  const notes = String(v.notes || '');
  const proposedFields = {}, evidence = {}, contacts = [];
  const addField = (field, value, label, confidence='high') => {
    value = evidenceValue(value);
    if (!isFilled(v[field]) && isFilled(value)) {
      proposedFields[field] = value;
      evidence[field] = { source:'notes', confidence, snippet:`${label}: ${value}`.slice(0,220) };
    }
  };
  addField('name', labelledValue(notes, ['organization','organisation','company','org','venue name','festival name']), 'Organization');
  addField('address', labelledValue(notes, ['full address','postal address','address','venue address']), 'Address');
  addField('city', labelledValue(notes, ['city','town']), 'City');
  addField('region', labelledValue(notes, ['region','state','province']), 'Region');
  addField('country', labelledValue(notes, ['country']), 'Country');
  addField('website', explicitUrl(notes, ['website','web','url']), 'Website');
  addField('instagram', explicitUrl(notes, ['instagram','ig']), 'Instagram');
  const typeRaw = labelledValue(notes, ['contact type','type of event','type']);
  addField('contact_type', mapContactType(typeRaw), 'Type');
  if (!isFilled(v.booking_method) && (isFilled(v.booking_email) || explicitEmail(notes))) addField('booking_method', 'email', 'Booking method');

  const personRaw = labelledValue(notes, ['promoter name','promoter','contact person','contact name','booker','buyer']);
  const people = splitPeople(personRaw);
  const noteEmail = explicitEmail(notes);
  const notePhone = explicitPhone(notes, ['contact phone','phone','telephone','tel','mobile']);
  const noteWhatsapp = explicitPhone(notes, ['whatsapp','whats app']);
  const existingContacts = Array.isArray(v.contacts) ? v.contacts : [];
  const legacyEmail = isFilled(v.booking_email) ? v.booking_email : (v.emails || []).find(isFilled) || '';
  const legacyPhone = isPlausiblePhone(v.phone) ? v.phone : (v.phones || []).find(isPlausiblePhone) || '';
  const email = noteEmail || legacyEmail;
  const phone = notePhone || legacyPhone;
  if (people.length) {
    people.forEach((name, i) => {
      const existing = existingContacts.find(c => normName(c.name) === normName(name)) || (people.length === 1 ? existingContacts.find(c => !isFilled(c.name) && (normEmail(c.email) === normEmail(email) || (!c.email && email))) : null);
      const candidate = {
        contact_key: contactKey({ name, email:i === 0 ? email : '', phone:i === 0 ? phone : '' }),
        name, title:'Promoter / Buyer', email:i === 0 ? email : '', phone:i === 0 ? phone : '', whatsapp:i === 0 ? noteWhatsapp : '', is_primary: i === 0,
        match_contact_key: existing ? contactKey(existing) : ''
      };
      contacts.push(candidate);
    });
    evidence.contacts = { source:'notes', confidence:'high', snippet:`Promoter name: ${personRaw}`.slice(0,220) };
  } else if (!existingContacts.length && (noteEmail || notePhone || noteWhatsapp)) {
    contacts.push({ contact_key:contactKey({ email:noteEmail, phone:notePhone }), name:'', title:'', email:noteEmail, phone:notePhone, whatsapp:noteWhatsapp, is_primary:true });
    evidence.contacts = { source:'notes', confidence:'high', snippet:'Explicit contact details found in notes.' };
  }
  const crossReferences = [];
  for (const c of contacts) {
    const key = c.contact_key || contactKey(c); if (!key) continue;
    const others = (contactIndex.get(key) || []).filter(x => x.id !== v.id);
    if (others.length) crossReferences.push({ contact_key:key, organizations:others.slice(0,12) });
  }
  const requested = [];
  const currentName = proposedFields.name || v.name;
  if (!isFilled(currentName)) requested.push('organization');
  const allContacts = [...existingContacts, ...contacts];
  const emailsWithoutNames = allContacts.filter(c => isFilled(c.email) && !isFilled(c.name));
  if (emailsWithoutNames.length || (isFilled(v.booking_email) && !isFilled(v.contact_name) && !people.length)) requested.push('contact_name','contact_title');
  if (!isFilled(v.city) && !isFilled(proposedFields.city)) requested.push('city');
  if (!isFilled(v.region) && !isFilled(proposedFields.region)) requested.push('region');
  if (!isFilled(v.country) && !isFilled(proposedFields.country)) requested.push('country');
  if (!isFilled(v.address) && !isFilled(proposedFields.address)) requested.push('address');
  const priority = !isFilled(currentName) ? 'unknown' : requested.includes('contact_name') ? 'email_without_name' : (requested.includes('city') || requested.includes('region')) ? 'missing_city_region' : 'standard';
  return { proposed_fields:proposedFields, proposed_contacts:contacts, evidence, cross_references:crossReferences, gmail_requested_fields:uniqArr(requested), priority };
}
function noteProposalHash(v, result) {
  return sha(JSON.stringify([v.id, v.updated_at || '', v.notes || '', result.proposed_fields, result.proposed_contacts]));
}
async function queueGmailItem(item, seenKeys) {
  const requested = uniqArr(item.requested_fields || []).sort();
  if (!item.source_id || !requested.length) return false;
  const queueKey = sha(`${item.source_type}|${item.source_id}|${requested.join(',')}`);
  if (seenKeys.has(queueKey)) return false;
  const qid = `cvq_${queueKey.slice(0,24)}`;
  await createDoc(GMAIL_QUEUE, { ...item, requested_fields:requested, queue_key:queueKey, status:'queued', retry_count:0, created_at:now(), updated_at:now() }, qid).catch(() => {});
  seenKeys.add(queueKey); return true;
}
function proposalNeedsGmail(p) {
  if ((p.status || 'pending') !== 'pending' || !/_new$/.test(p.type || '')) return [];
  const a = p.after || {}, fields = [];
  if (!isFilled(a.name)) fields.push('organization');
  if (!isFilled(a.city)) fields.push('city');
  if (!isFilled(a.region)) fields.push('region');
  if (!isFilled(a.country)) fields.push('country');
  const contacts = a.contacts || [];
  if ((isFilled(a.booking_email) || contacts.some(c => isFilled(c.email))) && !contacts.some(c => isFilled(c.name))) fields.push('contact_name','contact_title');
  return uniqArr(fields);
}

// ---------- agent-run Gmail enrichment queue ----------
async function listGmailQueue(b) {
  let docs = await listDocs(GMAIL_QUEUE, { orderBy:'created_at asc', pageSize:Math.min(Number(b.limit)||200,500) }).catch(() => []);
  if (b.status && b.status !== 'all') docs = docs.filter(x => (x.status || 'queued') === b.status);
  return { success:true, data:docs, count:docs.length };
}
async function claimGmailQueue(limit) {
  const docs = (await listDocs(GMAIL_QUEUE, { orderBy:'created_at asc', pageSize:500 }).catch(() => []))
    .filter(x => ['queued','failed'].includes(x.status || 'queued'))
    .sort((a,b) => ({unknown:0,email_without_name:1,missing_city_region:2,standard:3}[a.priority] ?? 4) - ({unknown:0,email_without_name:1,missing_city_region:2,standard:3}[b.priority] ?? 4))
    .slice(0, Math.max(1, Math.min(Number(limit)||10,25)));
  for (const d of docs) await updateDoc(GMAIL_QUEUE, d.id, { status:'in_progress', updated_at:now() });
  return { success:true, data:docs, count:docs.length };
}
function cleanGmailResult(result) {
  const allowed = ['name','contact_type','address','city','region','country','website','instagram','booking_method'];
  const fields = {};
  for (const f of allowed) if (isFilled(result.fields && result.fields[f])) fields[f] = evidenceValue(result.fields[f]);
  const contacts = (Array.isArray(result.contacts) ? result.contacts : []).map(cleanEditedContact).filter(Boolean);
  const evidence = {};
  for (const [f,e] of Object.entries(result.evidence || {})) evidence[f] = { source:'gmail', confidence:['high','medium','low'].includes(e.confidence)?e.confidence:'medium', snippet:evidenceValue(e.snippet), message_ids:uniqArr(e.message_ids || []).slice(0,10) };
  return { fields, contacts, evidence, confidence:['high','medium','low'].includes(result.confidence)?result.confidence:'medium', no_evidence:!!result.no_evidence };
}
async function completeGmailQueue(qid, rawResult) {
  if (!qid) throw new Error('id required');
  const q = await getDoc(GMAIL_QUEUE, qid); if (!q) throw new Error('queue item not found');
  const result = cleanGmailResult(rawResult);
  if (q.source_type === 'proposal') {
    const p = await getDoc(COLL, q.source_id); if (!p) throw new Error('source proposal not found');
    if ((p.status || 'pending') !== 'pending') { await updateDoc(GMAIL_QUEUE,qid,{status:'completed',note:'source proposal no longer pending',updated_at:now()}); return {success:true,no_op:true}; }
    const after = { ...(p.after || {}) };
    for (const [f,v] of Object.entries(result.fields)) if (!isFilled(after[f])) after[f] = v;
    const mergedContacts = Array.isArray(after.contacts) ? [...after.contacts] : [];
    for (const c of result.contacts) {
      const key = contactKey(c); const ix = mergedContacts.findIndex(x => key && contactKey(x) === key);
      if (ix < 0) mergedContacts.push({ ...c, contact_key:key });
      else for (const [f,v] of Object.entries(c)) if (!isFilled(mergedContacts[ix][f]) && isFilled(v)) mergedContacts[ix][f] = v;
    }
    after.contacts = mergedContacts;
    await updateDoc(COLL, p.id, { after, gmail_evidence:result.evidence, gmail_enriched_at:now(), updated_at:now() });
  } else {
    const venue = await getDoc(VENUES, q.source_id); if (!venue) throw new Error('source venue not found');
    const pid = q.proposal_id;
    let p = pid ? await getDoc(COLL,pid).catch(() => null) : null;
    const after = p ? { ...(p.after || {}) } : { proposed_fields:{}, proposed_contacts:[] };
    after.proposed_fields = { ...(after.proposed_fields || {}) };
    for (const [f,v] of Object.entries(result.fields)) if (!isFilled(venue[f]) && !isFilled(after.proposed_fields[f])) after.proposed_fields[f] = v;
    after.proposed_contacts = uniqArr([...(after.proposed_contacts || []), ...result.contacts.map(c => ({...c,contact_key:contactKey(c)}))]);
    const patch = { after, gmail_evidence:result.evidence, confidence:result.confidence, updated_at:now(), note:'Missing contact information mined from CRM notes and read-only booking Gmail; review evidence before approval.' };
    if (p) await updateDoc(COLL,p.id,patch);
    else {
      const newId=id();
      await createDoc(COLL,{ type:'note_contact_update',status:'pending',target_venue_id:venue.id,before:trimSnapshot(venue),...patch,created_at:now() },newId);
      await updateDoc(GMAIL_QUEUE,qid,{proposal_id:newId});
    }
  }
  await updateDoc(GMAIL_QUEUE,qid,{status:'completed',result_summary:{fields:Object.keys(result.fields),contacts:result.contacts.length,no_evidence:result.no_evidence},updated_at:now()});
  return { success:true, fields:Object.keys(result.fields), contacts:result.contacts.length };
}
async function failGmailQueue(qid, error) {
  if (!qid) throw new Error('id required');
  const q=await getDoc(GMAIL_QUEUE,qid); if(!q) throw new Error('queue item not found');
  await updateDoc(GMAIL_QUEUE,qid,{status:'failed',last_error:evidenceValue(error),retry_count:Number(q.retry_count||0)+1,updated_at:now()});
  return {success:true};
}

// ---------- scan ----------
async function runScan(options) {
  const t0 = Date.now();
  const BUDGET_MS = 18000; // leave headroom under Netlify's ~25s function limit
  const outOfTime = () => (Date.now() - t0) > BUDGET_MS;
  const doRestructure = options.restructure !== false;
  const doDedupe = options.dedupe !== false;
  const doEnrichNotes = options.enrich_notes === true;
  const venues = await listVenues();
  const existingProposals = await listDocs(COLL, { orderBy: 'created_at desc', pageSize: 2000, mask: ['type', 'status', 'target_venue_id', 'merge_venue_ids', 'note_hash', 'after'] }).catch(() => []);

  const restructureSeen = new Set(existingProposals.filter(p => p.type === 'restructure').map(p => p.target_venue_id));
  const mergeSeen = new Set(existingProposals.filter(p => p.type === 'merge').map(p => sigOf(p.target_venue_id, p.merge_venue_ids)));
  const noteSeen = new Set(existingProposals.filter(p => p.type === 'note_contact_update').map(p => p.note_hash).filter(Boolean));
  const queueDocs = doEnrichNotes ? await listDocs(GMAIL_QUEUE, { orderBy:'created_at desc', pageSize:2000, mask:['queue_key'] }).catch(() => []) : [];
  const queueSeen = new Set(queueDocs.map(q => q.queue_key).filter(Boolean));
  const contactIndex = doEnrichNotes ? buildContactIndex(venues) : new Map();

  let restructureStaged = 0, mergeStaged = 0, noteStaged = 0, gmailQueued = 0;

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

  let notesTruncated = false;
  if (doEnrichNotes && !outOfTime()) {
    for (const v of venues) {
      if (outOfTime()) { notesTruncated = true; break; }
      const result = buildNoteEnrichment(v, contactIndex);
      const hasLocal = Object.keys(result.proposed_fields).length || result.proposed_contacts.length;
      const noteHash = noteProposalHash(v, result);
      let proposalId = '';
      if (hasLocal && !noteSeen.has(noteHash)) {
        proposalId = id();
        await createDoc(COLL, {
          type:'note_contact_update', status:'pending', target_venue_id:v.id,
          before:trimSnapshot(v),
          after:{ proposed_fields:result.proposed_fields, proposed_contacts:result.proposed_contacts },
          evidence:result.evidence, cross_references:result.cross_references,
          note_hash:noteHash, confidence:'high',
          note:'Explicit missing information extracted from CRM notes/legacy fields. Review every field before approval.',
          created_at:now(), updated_at:now()
        }, proposalId);
        noteSeen.add(noteHash); noteStaged++;
      } else {
        const existing = existingProposals.find(p => p.type === 'note_contact_update' && p.note_hash === noteHash);
        proposalId = existing ? existing.id : '';
      }
      if (result.gmail_requested_fields.length) {
        const emails = uniqArr([v.booking_email, ...(v.emails || []), ...(v.contacts || []).map(c => c.email)].filter(isFilled).map(normEmail));
        const names = uniqArr([v.name, v.contact_name, ...(v.contacts || []).map(c => c.name)].filter(isFilled));
        if (emails.length || names.length) gmailQueued += await queueGmailItem({
          source_type:'venue', source_id:v.id, proposal_id:proposalId,
          priority:result.priority, requested_fields:result.gmail_requested_fields,
          query_hints:{ emails:emails.slice(0,8), names:names.slice(0,8), organization:isFilled(v.name)?v.name:'' }
        }, queueSeen) ? 1 : 0;
      }
    }
    // Pending NEW proposals are not yet venue records, but missing city/region
    // currently blocks approval. Queue them directly and patch only the staged
    // proposal when evidence is found.
    for (const p of existingProposals) {
      if (outOfTime()) { notesTruncated = true; break; }
      const requested = proposalNeedsGmail(p); if (!requested.length) continue;
      const a=p.after||{}, contacts=a.contacts||[];
      const emails=uniqArr([a.booking_email,...(a.emails||[]),...contacts.map(c=>c.email)].filter(isFilled).map(normEmail));
      const names=uniqArr([a.name,...contacts.map(c=>c.name)].filter(isFilled));
      if (!emails.length && !names.length) continue;
      const priority=!isFilled(a.name)?'unknown':requested.includes('contact_name')?'email_without_name':'missing_city_region';
      gmailQueued += await queueGmailItem({ source_type:'proposal',source_id:p.id,priority,requested_fields:requested,query_hints:{emails:emails.slice(0,8),names:names.slice(0,8),organization:isFilled(a.name)?a.name:''} },queueSeen)?1:0;
    }
  }

  const truncated = restructureTruncated || dedupeTruncated || notesTruncated || (doDedupe && outOfTime());
  return { success: true, scanned: venues.length, restructure_staged: restructureStaged, merge_staged: mergeStaged, note_enrichment_staged:noteStaged, gmail_queued:gmailQueued, truncated, more: truncated };
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
    const phones = uniqArr([].concat(v.phone ? [v.phone] : [], v.phones || []).filter(isPlausiblePhone).map(normPhone));
    phones.forEach(p => { if (!p) return; if (!byPhone.has(p)) byPhone.set(p, []); byPhone.get(p).push(v); });
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
  // One promoter may represent many venues/festivals. Shared contact details
  // are cross-reference signals only and NEVER organization-merge evidence.
  // Merge proposals require the same normalized organization name AND city.
  for (const group of byNameCity.values()) if (group.length > 1) tryStage(group, 'same organization name + city');
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
  const phones = uniqArr(phoneCols.map(c => row[c]).filter(isPlausiblePhone));
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
  return normEmail(gc.emails[0] || '') || (isPlausiblePhone(gc.phones[0]) ? normPhone(gc.phones[0]) : '') || normName(gc.org || gc.name || '');
}
function findImportVenue(venues, candidate) {
  const org = candidate.organization || candidate.org || candidate.event_or_venue || '';
  const city = normName(candidate.city);
  const emails = uniqArr(candidate.emails || (candidate.email ? [candidate.email] : [])).filter(isFilled).map(normEmail);
  const phones = uniqArr(candidate.phones || (candidate.phone ? [candidate.phone] : [])).filter(isPlausiblePhone).map(normPhone);
  const person = normName(candidate.contact_name || candidate.name || candidate.promoter_person_name || '');
  let orgMatches = [];
  if (isFilled(org)) {
    orgMatches = venues.filter(v => namesLikelySame(v.name, org) && (!city || !normName(v.city) || normName(v.city) === city));
    if (orgMatches.length === 1) return orgMatches[0];
  }
  const pool = orgMatches.length ? orgMatches : venues;
  const contactMatches = pool.filter(v => {
    const contacts = [...(v.contacts || []), {name:v.contact_name||'',email:v.booking_email||'',phone:v.phone||''}];
    return contacts.some(c =>
      (emails.length && emails.includes(normEmail(c.email))) ||
      (phones.length && isPlausiblePhone(c.phone) && phones.includes(normPhone(c.phone))) ||
      (person && normName(c.name) === person)
    );
  });
  const unique = uniqArr(contactMatches.map(v => v.id)).map(id => contactMatches.find(v => v.id === id));
  return unique.length === 1 ? unique[0] : null;
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

  const existingProposals = await listDocs(COLL, { orderBy: 'created_at desc', pageSize: 2000, mask: ['type', 'google_key'] }).catch(() => []);
  const seen = new Set(existingProposals.filter(p => p.type === 'google_contact_update' || p.type === 'google_contact_new').map(p => p.google_key).filter(Boolean));

  let stagedNew = 0, stagedUpdate = 0, matched = 0, scanned = 0, truncated = false;
  for (const gc of rows) {
    scanned++;
    if (outOfTime()) { truncated = true; break; }
    const key = googleContactKey(gc);
    if (!key || seen.has(key)) continue;

    const venue = findImportVenue(venues, { org:gc.org, city:gc.city, emails:gc.emails, phones:gc.phones, contact_name:gc.name });

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

// ---------- Google Drive contract import ----------
// Receives already-extracted promoter/buyer counterparties from the agent's
// read-only Drive pass. Stages only; never writes CRM here. A contract source
// key makes repeated Drive scans idempotent. Matching order: email, phone,
// organization, then person name. Updates contain ONLY fields empty on the
// live CRM record; approval re-reads live data before the rag-venues upsert.
async function importContractContacts(contacts) {
  if (!Array.isArray(contacts)) throw new Error('contacts[] required');
  const rows = contacts.slice(0, 200).filter(x => x && (x.organization || x.promoter_person_name || x.email || x.phone || x.address));
  const venues = await listVenues();
  const existing = await listDocs(COLL, { orderBy: 'created_at desc', pageSize: 2000, mask: ['type', 'contract_key'] }).catch(() => []);
  const seen = new Set(existing.filter(p => /^contract_contact_/.test(p.type || '')).map(p => p.contract_key).filter(Boolean));
  let matched = 0, stagedUpdate = 0, stagedNew = 0, skipped = 0;
  for (const ct of rows) {
    const sourceIds = uniqArr(ct.source_file_ids || (ct.drive_file_id ? [ct.drive_file_id] : []));
    const key = String(ct.contract_key || sourceIds.join('|') || normEmail(ct.email) || normPhone(ct.phone) || normName(ct.organization || ct.promoter_person_name)).trim();
    if (!key || seen.has(key)) { skipped++; continue; }
    const venue = findImportVenue(venues, { organization:ct.organization || ct.event_or_venue, event_or_venue:ct.event_or_venue, city:ct.city, email:ct.email, phone:ct.phone, promoter_person_name:ct.promoter_person_name });
    const source = { drive_file_ids: sourceIds, file_names: uniqArr(ct.file_names || (ct.file_name ? [ct.file_name] : [])), contract_references: uniqArr(ct.contract_references || (ct.contract_number ? [ct.contract_number] : [])), event_or_venue: ct.event_or_venue || '', evidence_notes: ct.evidence_notes || '' };
    if (venue) {
      matched++;
      const fields = {};
      for (const f of ['address','city','region','country','website']) if (!isFilled(venue[f]) && isFilled(ct[f])) fields[f] = ct[f];
      const incoming = (ct.promoter_person_name || ct.email || ct.phone) ? { name: ct.promoter_person_name || '', title: ct.title || 'Promoter / Buyer', email: ct.email || '', phone: ct.phone || '', is_primary: false } : null;
      const alreadyHas = incoming && (venue.contacts || []).some(x => (incoming.email && normEmail(x.email) === normEmail(incoming.email)) || (incoming.phone && normPhone(x.phone) === normPhone(incoming.phone)) || (incoming.name && normName(x.name) === normName(incoming.name)));
      const newContact = alreadyHas ? null : incoming;
      if (!Object.keys(fields).length && !newContact) { skipped++; seen.add(key); continue; }
      await createDoc(COLL, {
        type: 'contract_contact_update', status: 'pending', contract_key: key,
        target_venue_id: venue.id, before: trimSnapshot(venue),
        after: { proposed_fields: fields, new_contact: newContact }, contract_source: source,
        extracted_contact: ct, confidence: ct.confidence || 'medium',
        note: `Matched contract counterparty to CRM record "${venue.name}". Only missing CRM fields are proposed.`,
        created_at: now(), updated_at: now()
      }, id());
      stagedUpdate++;
    } else {
      await createDoc(COLL, {
        type: 'contract_contact_new', status: 'pending', contract_key: key,
        target_venue_id: null, before: null,
        after: {
          name: ct.organization || ct.event_or_venue || ct.promoter_person_name || 'Unknown', contact_type: 'promoter',
          city: ct.city || '', region: ct.region || '', country: ct.country || '', address: ct.address || '', website: ct.website || '',
          booking_email: ct.email || '', phone: ct.phone || '', emails: ct.email ? [ct.email] : [], phones: ct.phone ? [ct.phone] : [],
          contacts: (ct.promoter_person_name || ct.email || ct.phone) ? [{ name: ct.promoter_person_name || '', title: ct.title || 'Promoter / Buyer', email: ct.email || '', phone: ct.phone || '', is_primary: true }] : [],
          notes: source.contract_references.length ? `Contract reference(s): ${source.contract_references.join(', ')}` : '', source_file: 'google_drive_contract'
        },
        contract_source: source, extracted_contact: ct, confidence: ct.confidence || 'medium',
        note: 'No CRM match found — proposing a new promoter/contact record from a signed or issued contract.',
        created_at: now(), updated_at: now()
      }, id());
      stagedNew++;
    }
    seen.add(key);
  }
  return { success: true, scanned: rows.length, matched, staged_update: stagedUpdate, staged_new: stagedNew, skipped };
}

// ---------- booking Gmail address import ----------
// Targeted only at known CRM records that currently lack an address. The agent
// supplies an explicit target_venue_id derived from the message correspondent's
// known CRM email. This action stages proposals only; it never writes CRM.
async function importEmailAddresses(contacts) {
  if (!Array.isArray(contacts)) throw new Error('contacts[] required');
  const rows = contacts.slice(0, 200).filter(x => x && x.target_venue_id && isFilled(x.address));
  const venues = await listVenues();
  const venueById = new Map(venues.map(v => [v.id, v]));
  const existing = await listDocs(COLL, { orderBy: 'created_at desc', pageSize: 2000, mask: ['type','email_key'] }).catch(() => []);
  const seen = new Set(existing.filter(p => p.type === 'email_contact_update').map(p => p.email_key).filter(Boolean));
  let stagedUpdate = 0, skipped = 0, missingTarget = 0;
  for (const ct of rows) {
    const key = String(ct.email_key || `email_address_${ct.target_venue_id}`);
    if (seen.has(key)) { skipped++; continue; }
    const venue = venueById.get(ct.target_venue_id);
    if (!venue || venue.deleted_at) { missingTarget++; continue; }
    const fields = {};
    for (const f of ['address','city','region','country']) if (!isFilled(venue[f]) && isFilled(ct[f])) fields[f] = ct[f];
    if (!Object.keys(fields).length) { skipped++; seen.add(key); continue; }
    await createDoc(COLL, {
      type: 'email_contact_update', status: 'pending', email_key: key,
      target_venue_id: venue.id, before: trimSnapshot(venue),
      after: { proposed_fields: fields, new_contact: null },
      email_source: { message_ids: uniqArr(ct.evidence_message_ids || []), evidence_notes: ct.evidence_notes || '' },
      extracted_contact: { organization: ct.organization || '', promoter_person_name: ct.promoter_person_name || '', email: ct.email || '', phone: ct.phone || '', address: ct.address || '', city: ct.city || '', region: ct.region || '', country: ct.country || '' },
      confidence: ct.confidence || 'medium',
      note: `Matched booking-email address evidence directly to CRM record "${venue.name}". Only still-empty fields are proposed.`,
      created_at: now(), updated_at: now()
    }, id());
    stagedUpdate++; seen.add(key);
  }
  return { success: true, scanned: rows.length, staged_update: stagedUpdate, skipped, missing_target: missingTarget };
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
  const s = { pending: 0, approved: 0, rejected: 0, restructure: 0, merge: 0, google_contact_update: 0, google_contact_new: 0, contract_contact_update: 0, contract_contact_new: 0, email_contact_update: 0, note_contact_update: 0, total: docs.length };
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
  const queue = await listDocs(GMAIL_QUEUE, { orderBy:'created_at desc', pageSize:2000, mask:['status'] }).catch(() => []);
  s.gmail_queued = queue.filter(q => (q.status || 'queued') === 'queued').length;
  s.gmail_in_progress = queue.filter(q => q.status === 'in_progress').length;
  s.gmail_completed = queue.filter(q => q.status === 'completed').length;
  s.gmail_failed = queue.filter(q => q.status === 'failed').length;
  return { success: true, data: s };
}

const EDITABLE_RECORD_FIELDS = ['name','contact_type','address','city','region','country','market','website','booking_email','phone','instagram','booking_method','notes'];
function cleanEditedContact(c) {
  if (!c || !(c.name || c.email || c.phone || c.whatsapp || c.title)) return null;
  const clean = {
    name: String(c.name || '').trim(), title: String(c.title || '').trim(),
    email: String(c.email || '').trim(), phone: String(c.phone || '').trim(),
    whatsapp: String(c.whatsapp || '').trim(), is_primary: c.is_primary === true,
  };
  clean.contact_key = String(c.contact_key || contactKey(clean) || '').trim();
  if (c.match_contact_key) clean.match_contact_key = String(c.match_contact_key).trim();
  return clean;
}
async function editProposal(pid, patch) {
  if (!pid) throw new Error('id required');
  const p = await getDoc(COLL, pid);
  if (!p) return { success: false, error: 'Proposal not found' };
  if ((p.status || 'pending') !== 'pending') return { success: false, error: 'Only pending proposals can be edited' };
  const incomingRecord = patch.record || patch.proposed_fields || {};
  const incomingContacts = (Array.isArray(patch.contacts) ? patch.contacts : [patch.contact || patch.new_contact]).map(cleanEditedContact).filter(Boolean);
  const incomingContact = incomingContacts[0] || null;
  const after = { ...(p.after || {}) };

  if (p.type === 'note_contact_update') {
    const proposed = { ...((after && after.proposed_fields) || {}) };
    for (const f of EDITABLE_RECORD_FIELDS) if (incomingRecord[f] !== undefined) proposed[f] = String(incomingRecord[f] || '').trim();
    after.proposed_fields = proposed;
    after.proposed_contacts = incomingContacts;
  } else if (p.type === 'merge') {
    for (const f of EDITABLE_RECORD_FIELDS) if (incomingRecord[f] !== undefined) after[f] = String(incomingRecord[f] || '').trim();
    after.contacts = incomingContacts;
  } else if (p.type === 'restructure') {
    if (incomingRecord.name !== undefined) after.name = String(incomingRecord.name || '').trim();
    after.contacts = incomingContacts;
  } else if (p.type === 'google_contact_new' || p.type === 'contract_contact_new') {
    for (const f of EDITABLE_RECORD_FIELDS) if (incomingRecord[f] !== undefined) after[f] = String(incomingRecord[f] || '').trim();
    after.emails = after.booking_email ? [after.booking_email] : [];
    after.phones = after.phone ? [after.phone] : [];
    after.contacts = incomingContacts;
  } else if (p.type === 'google_contact_update' || p.type === 'contract_contact_update' || p.type === 'email_contact_update') {
    const proposed = {};
    for (const f of EDITABLE_RECORD_FIELDS) {
      // Existing CRM values remain protected at approval time. The dialog edits
      // only proposed additions, never target IDs or current record fields.
      if (incomingRecord[f] !== undefined && isFilled(incomingRecord[f])) proposed[f] = String(incomingRecord[f]).trim();
    }
    after.proposed_fields = proposed;
    after.new_contact = incomingContact;
    after.additional_contacts = incomingContacts.slice(1);
  } else {
    return { success: false, error: 'This proposal type is not editable' };
  }

  await updateDoc(COLL, pid, { after, updated_at: now(), edited: true });
  return { success: true, after };
}

// ---------- approve / reject ----------
// Approval-time duplicate guard for proposals staged as "new". Keep this
// targeted: a full CRM collection read on every approval made 27-item batches
// exceed the serverless timeout. Exact email/phone matches win; name must also
// match the city when a city is present.
async function findLiveDuplicateFast(candidate) {
  const c = candidate || {};
  const candidateName = c.name || c.organization || '';
  const candidateCity = normName(c.city);
  const sameOrganization = v => {
    if (!isFilled(candidateName) || !namesLikelySame(v.name, candidateName)) return false;
    if (candidateCity && normName(v.city) && normName(v.city) !== candidateCity) return false;
    return true;
  };
  const emails = uniqArr([c.booking_email, ...(c.emails || [])]).filter(isFilled);
  for (const email of emails) {
    const hits = await queryDocs(VENUES, 'booking_email', email, { limit: 10 }).catch(() => []);
    const matches = hits.filter(v => v && !v.deleted_at && sameOrganization(v));
    if (matches.length === 1) return { venue: matches[0], matched_on: 'organization+email' };
  }
  const phones = uniqArr([c.phone, ...(c.phones || [])]).filter(isPlausiblePhone);
  for (const phone of phones) {
    const hits = await queryDocs(VENUES, 'phone', phone, { limit: 10 }).catch(() => []);
    const matches = hits.filter(v => v && !v.deleted_at && sameOrganization(v));
    if (matches.length === 1) return { venue: matches[0], matched_on: 'organization+phone' };
  }
  if (isFilled(candidateName) && candidateCity) {
    const hits = await queryDocs(VENUES, 'name', candidateName, { limit: 10 }).catch(() => []);
    const matches = hits.filter(v => v && !v.deleted_at && normName(v.city) === candidateCity);
    if (matches.length === 1) return { venue: matches[0], matched_on: 'name+city' };
  }
  return null;
}

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
    // Apply reviewed edits only where the freshly merged live record is still
    // empty. Contact entries are matched and only gain missing details.
    for (const f of EDITABLE_RECORD_FIELDS) {
      if (!isFilled(merged[f]) && isFilled((p.after || {})[f])) merged[f] = p.after[f];
    }
    const mergedContacts = Array.isArray(merged.contacts) ? [...merged.contacts] : [];
    for (const edited of ((p.after && p.after.contacts) || [])) {
      const idx = mergedContacts.findIndex(ct =>
        (edited.email && normEmail(ct.email) === normEmail(edited.email)) ||
        (isPlausiblePhone(edited.phone) && isPlausiblePhone(ct.phone) && normPhone(ct.phone) === normPhone(edited.phone)) ||
        (edited.name && normName(ct.name) === normName(edited.name))
      );
      if (idx < 0) mergedContacts.push(edited);
      else for (const [k, v] of Object.entries(edited)) if (!isFilled(mergedContacts[idx][k]) && isFilled(v)) mergedContacts[idx][k] = v;
    }
    merged.contacts = mergedContacts;
    const res = await fetch(RAG_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upsert', venue: merged, skip_embeddings: true, agent_key: AGENT_KEY() }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.success) throw new Error('CRM write failed: ' + (j.error || res.status));
    for (const l of losers) await updateDoc(VENUES, l.id, { deleted_at: now(), merged_into: primary.id });
    await updateDoc(COLL, pid, { status: 'approved', updated_at: now() });
    return { success: true, venue_id: primary.id, merged_count: losers.length };
  }

  if (p.type === 'note_contact_update') {
    const venue = await getDoc(VENUES, p.target_venue_id);
    if (!venue) throw new Error('Target venue no longer exists');
    const payload = { ...venue };
    for (const [field,value] of Object.entries((p.after && p.after.proposed_fields) || {})) {
      if (EDITABLE_RECORD_FIELDS.includes(field) && !isFilled(payload[field]) && isFilled(value)) payload[field] = value;
    }
    const contacts = Array.isArray(payload.contacts) ? payload.contacts.map(c => ({...c})) : [];
    for (const incoming of ((p.after && p.after.proposed_contacts) || [])) {
      if (!incoming || !Object.values(incoming).some(isFilled)) continue;
      const key = incoming.match_contact_key || incoming.contact_key || contactKey(incoming);
      let ix = contacts.findIndex(c => key && (contactKey(c) === key || c.contact_key === key));
      if (ix < 0 && incoming.email) ix = contacts.findIndex(c => normEmail(c.email) === normEmail(incoming.email));
      if (ix < 0 && incoming.name) ix = contacts.findIndex(c => normName(c.name) === normName(incoming.name));
      if (ix < 0) contacts.push({ ...incoming, contact_key:incoming.contact_key || contactKey(incoming) });
      else for (const [field,value] of Object.entries(incoming)) if (!isFilled(contacts[ix][field]) && isFilled(value)) contacts[ix][field] = value;
    }
    payload.contacts = contacts;
    const res = await fetch(RAG_URL, { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'upsert',venue:payload,skip_embeddings:true,agent_key:AGENT_KEY()}) });
    const j=await res.json().catch(()=>({})); if(!res.ok||!j.success) throw new Error('CRM write failed: '+(j.error||res.status));
    await updateDoc(COLL,pid,{status:'approved',updated_at:now()});
    return {success:true,venue_id:venue.id,fields_added:Object.keys((p.after&&p.after.proposed_fields)||{}).length,contacts_reviewed:((p.after&&p.after.proposed_contacts)||[]).length};
  }

  if (p.type === 'google_contact_update' || p.type === 'contract_contact_update' || p.type === 'email_contact_update') {
    const venue = await getDoc(VENUES, p.target_venue_id);
    if (!venue) throw new Error('Target venue no longer exists');
    // Re-check LIVE CRM values at approval time: only apply a proposed field if
    // it is still empty now. This prevents a stale Google/contract proposal from
    // overwriting information added after staging.
    const payload = { ...venue };
    for (const [field, value] of Object.entries(p.after.proposed_fields || {})) {
      if (!isFilled(venue[field]) && isFilled(value)) payload[field] = value;
    }
    for (const incoming of [p.after.new_contact, ...(p.after.additional_contacts || [])].filter(Boolean)) {
      const contacts = payload.contacts || [];
      const ix = contacts.findIndex(ct => (incoming.email && normEmail(ct.email) === normEmail(incoming.email)) || (incoming.name && normName(ct.name) === normName(incoming.name)));
      if (ix < 0) payload.contacts = [...contacts, incoming];
      else for (const [field,value] of Object.entries(incoming)) if (!isFilled(payload.contacts[ix][field]) && isFilled(value)) payload.contacts[ix][field] = value;
    }
    const res = await fetch(RAG_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upsert', venue: payload, skip_embeddings: true, agent_key: AGENT_KEY() }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.success) throw new Error('CRM write failed: ' + (j.error || res.status));
    await updateDoc(COLL, pid, { status: 'approved', updated_at: now() });
    return { success: true, venue_id: p.target_venue_id };
  }

  if (p.type === 'google_contact_new' || p.type === 'contract_contact_new') {
    // Recheck the LIVE CRM before creating anything. If another approval or
    // staff edit created the contact after staging, merge only missing fields
    // and arrays into that live record instead of creating a duplicate.
    const duplicate = await findLiveDuplicateFast(p.after || {});
    const payload = duplicate
      ? { ...mergeVenues(duplicate.venue, [p.after || {}]), id: duplicate.venue.id }
      : { ...(p.after || {}), id: venueId() };
    const res = await fetch(RAG_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upsert', venue: payload, skip_embeddings: true, agent_key: AGENT_KEY() }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.success) throw new Error('CRM write failed: ' + (j.error || res.status));
    await updateDoc(COLL, pid, { status: 'approved', updated_at: now(), approved_venue_id: j.data && j.data.id, approval_match: duplicate ? duplicate.matched_on : 'new' });
    return { success: true, venue_id: j.data && j.data.id, merged_existing: !!duplicate, matched_on: duplicate && duplicate.matched_on };
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

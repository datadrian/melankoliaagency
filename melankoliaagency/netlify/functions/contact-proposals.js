// Contact Discovery — staging store for proposed CRM contacts found in Gmail.
// The agent (Superagent) writes proposals here after scanning Gmail; the admin
// panel lists them and approves/rejects. On approve, matched fields are written
// to the venue CRM via the SAME rag-venues upsert path (single source of truth).
//
// Nothing here writes to route_planner_crm_venues except the `approve` action.
const { listDocs, getDoc, createDoc, updateDoc, deleteDoc, queryDocs, json } = require('./_firebase');

const COLL = 'contact_discovery_proposals';
const VENUES = 'route_planner_crm_venues';
const ADMIN_PW = () => process.env.MELANKOLIA_ADMIN_PASSWORD || 'melankolia2025';
const AGENT_KEY = () => process.env.CONTACT_DISCOVERY_KEY || process.env.MELANKOLIA_ADMIN_PASSWORD || 'melankolia2025';
const now = () => new Date().toISOString();
const id = () => `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const RAG_URL = (process.env.SITE_BASE || 'https://melankoliaagency.com') + '/.netlify/functions/rag-venues';

const guard = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
const withGuard = (p, ms = 23000) => Promise.race([p, guard(ms)]);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { success: false, error: 'POST only' });
  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch { return json(400, { success: false, error: 'Invalid JSON' }); }
  try {
    const isAdmin = b.password === ADMIN_PW();
    const isAgent = b.agent_key === AGENT_KEY();
    if (!isAdmin && !isAgent) return json(401, { success: false, error: 'Unauthorized' });

    if (b.action === 'list') return json(200, await withGuard(listProposals(b)));
    if (b.action === 'stats') return json(200, await withGuard(statsProposals()));
    if (b.action === 'stage') {
      if (!isAgent) return json(403, { success: false, error: 'stage requires agent_key' });
      return json(200, await withGuard(stageProposals(b.proposals || [], b.scan || {})));
    }
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
  const seen = new Set(existing.map(d => norm(d.candidate && d.candidate.email)).filter(Boolean));
  let staged = 0, skipped = 0;
  for (const r of rows) {
    const email = norm(r.candidate && r.candidate.email);
    if (!email) { skipped++; continue; }
    if (seen.has(email)) { skipped++; continue; }
    seen.add(email);
    const doc = {
      type: r.type === 'update' ? 'update' : 'new',
      status: 'pending',
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

async function approveProposal(pid) {
  if (!pid) throw new Error('id required');
  const p = await getDoc(COLL, pid);
  if (!p) throw new Error('proposal not found');
  if (p.status === 'approved') return { success: true, already: true, venue_id: p.venue_id };
  const venue = await writeToCRM(p);
  await updateDoc(COLL, pid, { status: 'approved', venue_id: venue.id || '', updated_at: now() });
  return { success: true, venue_id: venue.id || '', venue };
}

async function bulkApprove(ids) {
  const results = [];
  for (const pid of ids) {
    try { const r = await approveProposal(pid); results.push({ id: pid, ok: true, venue_id: r.venue_id }); }
    catch (e) { results.push({ id: pid, ok: false, error: e.message }); }
  }
  const ok = results.filter(r => r.ok).length;
  return { success: true, approved: ok, failed: results.length - ok, results };
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
    venuePayload = merged;
  } else {
    const c = p.candidate || {};
    venuePayload = {
      name: c.venue_name || c.org || c.name || c.email || 'Unknown',
      city: c.city || 'Unknown',
      country: c.country || '',
      region: c.region || '',
      contact_type: c.contact_type || 'promoter',
      booking_email: c.email || '',
      phone: c.phone || '',
      website: c.website || '',
      instagram: c.instagram || '',
      booking_method: c.booking_method || (c.email ? 'email' : ''),
      relationship_status: c.relationship_status || 'prospect',
      genre_affinity: c.genre_affinity || [],
      quality_flags: [],
      source_file: 'contact_discovery',
      notes: c.notes || '',
    };
  }
  const res = await fetch(RAG_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'upsert', venue: venuePayload, skip_embeddings: true }),
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

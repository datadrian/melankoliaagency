/**
 * Melankolia Advancing API — main backend for the advancing system.
 * All actions routed through a single function for simplicity.
 * Auth: agency actions require X-Agency-Token header.
 *       Band actions require X-Band-Token (Firebase custom token / UID).
 * No Gemini 2.x. Firebase Admin SDK only here.
 */

const { getDb, COLS, admin } = require('./_firebase');
const crypto = require('crypto');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Agency-Token, X-Band-Token',
  'Content-Type': 'application/json',
};

// Simple agency token check — stored in env
const AGENCY_TOKEN = process.env.AGENCY_ADMIN_TOKEN;

function ok(data, status = 200) {
  return { statusCode: status, headers: CORS, body: JSON.stringify({ success: true, data }) };
}
function err(msg, status = 400) {
  return { statusCode: status, headers: CORS, body: JSON.stringify({ success: false, error: msg }) };
}
function isAgency(event) {
  return event.headers['x-agency-token'] === AGENCY_TOKEN;
}
function nowISO() { return new Date().toISOString(); }
function genToken() { return crypto.randomBytes(24).toString('hex'); }
function genId(prefix) { return prefix + '_' + crypto.randomBytes(8).toString('hex'); }

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return err('Invalid JSON'); }
  const { action } = body;
  const db = getDb();

  try {
    // ═══════════════════════════════════════════
    //  BAND AUTH — login, get shows
    // ═══════════════════════════════════════════

    if (action === 'band_login') {
      const { username, password } = body;
      const snap = await db.collection(COLS.BANDS)
        .where('username', '==', username)
        .where('password_hash', '==', hashPw(password))
        .where('active', '==', true)
        .limit(1).get();
      if (snap.empty) return err('Invalid credentials', 401);
      const band = snap.docs[0];
      const sessionToken = genToken();
      await band.ref.update({ session_token: sessionToken, last_login: nowISO() });
      return ok({ band_id: band.id, name: band.data().name, session_token: sessionToken });
    }

    if (action === 'band_get_shows') {
      const { band_id, session_token } = body;
      if (!await verifyBandSession(db, band_id, session_token)) return err('Unauthorized', 401);

      // Get all shows for this band — scoped strictly to their band_id
      const showsSnap = await db.collection(COLS.SHOWS)
        .where('band_ids', 'array-contains', band_id)
        .orderBy('date', 'asc').get();

      const shows = [];
      for (const doc of showsSnap.docs) {
        const show = { id: doc.id, ...doc.data() };
        // Only include published sheets
        if (show.status === 'published') {
          const sheetSnap = await db.collection(COLS.SHEETS)
            .where('show_id', '==', doc.id)
            .where('status', '==', 'published')
            .limit(1).get();
          show.advancing = sheetSnap.empty ? null : sheetSnap.docs[0].data();
        } else {
          show.advancing = null; // advancing in progress
        }
        // Never expose agency_notes or other bands' data
        delete show.agency_notes;
        delete show.promoter_link_token;
        shows.push(show);
      }

      // Group by tour
      const tourIds = [...new Set(shows.map(s => s.tour_id).filter(Boolean))];
      const tours = {};
      for (const tid of tourIds) {
        const t = await db.collection(COLS.TOURS).doc(tid).get();
        if (t.exists) tours[tid] = { id: tid, ...t.data() };
      }

      // Band notifications — unread advancing publications
      const notifSnap = await db.collection('band_notifications')
        .where('band_id', '==', band_id)
        .where('read', '==', false)
        .orderBy('created_at', 'desc').limit(20).get();
      const notifications = notifSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      return ok({ shows, tours, notifications });
    }

    if (action === 'band_mark_notifications_read') {
      const { band_id, session_token, notification_ids } = body;
      if (!await verifyBandSession(db, band_id, session_token)) return err('Unauthorized', 401);
      const batch = db.batch();
      for (const nid of (notification_ids || [])) {
        batch.update(db.collection('band_notifications').doc(nid), { read: true });
      }
      await batch.commit();
      return ok({ marked: notification_ids?.length || 0 });
    }

    // ═══════════════════════════════════════════
    //  AGENCY — band management
    // ═══════════════════════════════════════════

    if (action === 'agency_create_band') {
      if (!isAgency(event)) return err('Forbidden', 403);
      const { name, username, password, genre_tags, contacts } = body;
      if (!name || !username || !password) return err('name, username, password required');
      // Check username unique
      const existing = await db.collection(COLS.BANDS).where('username', '==', username).limit(1).get();
      if (!existing.empty) return err('Username already exists');
      const ref = await db.collection(COLS.BANDS).add({
        name, username,
        password_hash: hashPw(password),
        genre_tags: genre_tags || [],
        contacts: contacts || [],
        active: true,
        created_at: nowISO(),
      });
      return ok({ band_id: ref.id, name, username });
    }

    if (action === 'agency_list_bands') {
      if (!isAgency(event)) return err('Forbidden', 403);
      const snap = await db.collection(COLS.BANDS).where('active', '==', true).get();
      return ok(snap.docs.map(d => ({ id: d.id, name: d.data().name, username: d.data().username, genre_tags: d.data().genre_tags })));
    }

    if (action === 'agency_update_band_password') {
      if (!isAgency(event)) return err('Forbidden', 403);
      const { band_id, new_password } = body;
      await db.collection(COLS.BANDS).doc(band_id).update({ password_hash: hashPw(new_password) });
      return ok({ updated: true });
    }

    if (action === 'agency_delete_band') {
      if (!isAgency(event)) return err('Forbidden', 403);
      const { band_id } = body;
      await db.collection(COLS.BANDS).doc(band_id).update({ active: false });
      return ok({ deactivated: true });
    }

    // ═══════════════════════════════════════════
    //  AGENCY — tour + show management
    // ═══════════════════════════════════════════

    if (action === 'agency_create_tour') {
      if (!isAgency(event)) return err('Forbidden', 403);
      const { name, band_id, start_date, end_date, region } = body;
      const ref = await db.collection(COLS.TOURS).add({
        name, band_id, start_date, end_date, region: region || '',
        created_at: nowISO(), show_ids: [],
      });
      return ok({ tour_id: ref.id });
    }

    if (action === 'agency_list_tours') {
      if (!isAgency(event)) return err('Forbidden', 403);
      const snap = await db.collection(COLS.TOURS).orderBy('start_date', 'desc').get();
      return ok(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }

    if (action === 'agency_create_show') {
      if (!isAgency(event)) return err('Forbidden', 403);
      const { tour_id, band_ids, headliner_band_id, date, venue_name, venue_address, city, country, capacity, age_restriction, agency_notes } = body;
      if (!tour_id || !band_ids?.length || !date || !venue_name) return err('tour_id, band_ids, date, venue_name required');

      const token = genToken();
      const showRef = await db.collection(COLS.SHOWS).add({
        tour_id, band_ids, headliner_band_id: headliner_band_id || band_ids[0],
        date, venue_name, venue_address: venue_address || '', city: city || '', country: country || '',
        capacity: capacity || null, age_restriction: age_restriction || '',
        status: 'draft',
        promoter_link_token: token,
        agency_notes: agency_notes || '',
        created_at: nowISO(), updated_at: nowISO(),
      });

      // Seed empty advancing sheet
      await db.collection(COLS.SHEETS).add({
        show_id: showRef.id, version: 1, source: 'agency',
        status: 'draft',
        load_in_time: '', soundcheck_time: '', doors_time: '', showtime: '',
        sound_engineer: { name: '', contact: '' },
        pa_specs: '', backline: { drum_kit: false, drum_kit_specs: '', bass_amp: false, guitar_amp: false, keys: false },
        guest_list: { spots: '', deadline: '', send_to: '' },
        merch: { table: false, venue_cut_pct: '', settlement_contact: '' },
        hotel: { name: '', address: '', check_in: '', check_out: '', confirmation_no: '' },
        catering_rider: '', parking_instructions: '', wifi: { network: '', password: '' },
        settlement: { method: '', who_pays: '', when: '' },
        promoter: { name: '', email: '', phone: '' },
        day_of_contact: { name: '', phone: '' },
        green_room_info: '',
        submitted_at: null, reviewed_by: null, approved_at: null, published_at: null,
        created_at: nowISO(), updated_at: nowISO(),
      });

      // Update tour.show_ids
      await db.collection(COLS.TOURS).doc(tour_id).update({
        show_ids: admin.firestore.FieldValue.arrayUnion(showRef.id)
      });

      // Audit log
      await logAudit(db, 'create_show', 'agency', showRef.id, null, null, { venue_name, date, band_ids });

      const promoterUrl = `https://melankoliaagency.com/advancing/${token}`;
      return ok({ show_id: showRef.id, promoter_url: promoterUrl, token });
    }

    if (action === 'agency_list_shows') {
      if (!isAgency(event)) return err('Forbidden', 403);
      const { tour_id, status } = body;
      let q = db.collection(COLS.SHOWS);
      if (tour_id) q = q.where('tour_id', '==', tour_id);
      if (status) q = q.where('status', '==', status);
      q = q.orderBy('date', 'asc');
      const snap = await q.get();
      const shows = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Attach notification counts
      const notifSnap = await db.collection(COLS.NOTIFICATIONS).where('resolved', '==', false).get();
      const notifByShow = {};
      notifSnap.docs.forEach(d => {
        const sid = d.data().show_id;
        notifByShow[sid] = (notifByShow[sid] || 0) + 1;
      });
      shows.forEach(s => { s._pending_notifications = notifByShow[s.id] || 0; });
      return ok(shows);
    }

    if (action === 'agency_get_show') {
      if (!isAgency(event)) return err('Forbidden', 403);
      const { show_id } = body;
      const doc = await db.collection(COLS.SHOWS).doc(show_id).get();
      if (!doc.exists) return err('Show not found', 404);
      const show = { id: doc.id, ...doc.data() };

      // All sheets for this show
      const sheetsSnap = await db.collection(COLS.SHEETS)
        .where('show_id', '==', show_id).orderBy('version', 'desc').get();
      show.sheets = sheetsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Pending submissions
      const subSnap = await db.collection(COLS.SUBMISSIONS)
        .where('show_id', '==', show_id).orderBy('submitted_at', 'desc').get();
      show.submissions = subSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Admin notifications for this show
      const nSnap = await db.collection(COLS.NOTIFICATIONS)
        .where('show_id', '==', show_id).orderBy('created_at', 'desc').limit(10).get();
      show.notifications = nSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const promoterUrl = `https://melankoliaagency.com/advancing/${show.promoter_link_token}`;
      show.promoter_url = promoterUrl;
      return ok(show);
    }

    if (action === 'agency_update_sheet') {
      if (!isAgency(event)) return err('Forbidden', 403);
      const { show_id, sheet_data } = body;

      // Find current draft/approved sheet
      const sheetsSnap = await db.collection(COLS.SHEETS)
        .where('show_id', '==', show_id)
        .where('status', 'in', ['draft', 'approved', 'pending_review'])
        .orderBy('version', 'desc').limit(1).get();

      const updateData = { ...sheet_data, source: 'agency', updated_at: nowISO() };

      if (sheetsSnap.empty) {
        await db.collection(COLS.SHEETS).add({ show_id, version: 1, status: 'draft', ...updateData, created_at: nowISO() });
      } else {
        await sheetsSnap.docs[0].ref.update(updateData);
      }
      await db.collection(COLS.SHOWS).doc(show_id).update({ updated_at: nowISO() });
      return ok({ updated: true });
    }

    if (action === 'agency_update_show') {
      if (!isAgency(event)) return err('Forbidden', 403);
      const { show_id, ...updates } = body;
      delete updates.action;
      await db.collection(COLS.SHOWS).doc(show_id).update({ ...updates, updated_at: nowISO() });
      return ok({ updated: true });
    }

    if (action === 'agency_set_show_status') {
      if (!isAgency(event)) return err('Forbidden', 403);
      const { show_id, status } = body; // pending_promoter, pending_review, etc.
      await db.collection(COLS.SHOWS).doc(show_id).update({ status, updated_at: nowISO() });
      return ok({ status });
    }

    if (action === 'agency_approve_sheet') {
      if (!isAgency(event)) return err('Forbidden', 403);
      const { show_id, reviewed_by } = body;
      const sheetsSnap = await db.collection(COLS.SHEETS)
        .where('show_id', '==', show_id)
        .where('status', 'in', ['draft', 'pending_review'])
        .orderBy('version', 'desc').limit(1).get();
      if (sheetsSnap.empty) return err('No sheet to approve');
      await sheetsSnap.docs[0].ref.update({ status: 'approved', reviewed_by: reviewed_by || 'agency', approved_at: nowISO() });
      await db.collection(COLS.SHOWS).doc(show_id).update({ status: 'approved', updated_at: nowISO() });
      await logAudit(db, 'approve_sheet', 'agency', show_id, null, 'approved', { reviewed_by });
      return ok({ approved: true });
    }

    if (action === 'agency_publish_sheet') {
      if (!isAgency(event)) return err('Forbidden', 403);
      const { show_id } = body;

      // Get approved sheet
      const sheetsSnap = await db.collection(COLS.SHEETS)
        .where('show_id', '==', show_id)
        .where('status', '==', 'approved')
        .orderBy('version', 'desc').limit(1).get();
      if (sheetsSnap.empty) return err('No approved sheet — approve first');

      const sheet = sheetsSnap.docs[0];
      const now = nowISO();
      await sheet.ref.update({ status: 'published', published_at: now });
      await db.collection(COLS.SHOWS).doc(show_id).update({ status: 'published', updated_at: now });

      // Get show to find band_ids
      const showDoc = await db.collection(COLS.SHOWS).doc(show_id).get();
      const showData = showDoc.data();
      const bandIds = showData.band_ids || [];

      // Create in-app notification for each band
      for (const band_id of bandIds) {
        await db.collection('band_notifications').add({
          band_id, show_id, type: 'advancing_published',
          message: `Advancing info is ready for ${showData.venue_name}, ${showData.city} on ${showData.date}.`,
          read: false, created_at: now,
        });
      }

      // Resolve pending admin notifications for this show
      const pendingNotifs = await db.collection(COLS.NOTIFICATIONS)
        .where('show_id', '==', show_id).where('resolved', '==', false).get();
      const batch = db.batch();
      pendingNotifs.docs.forEach(d => batch.update(d.ref, { resolved: true }));
      await batch.commit();

      await logAudit(db, 'publish_sheet', 'agency', show_id, 'approved', 'published', { band_ids: bandIds });
      return ok({ published: true, notified_bands: bandIds.length });
    }

    if (action === 'agency_get_dashboard') {
      if (!isAgency(event)) return err('Forbidden', 403);
      const showsSnap = await db.collection(COLS.SHOWS).orderBy('date', 'asc').get();
      const shows = showsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const notifSnap = await db.collection(COLS.NOTIFICATIONS).where('resolved', '==', false).get();
      const notifs = notifSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const counts = { draft: 0, pending_promoter: 0, pending_review: 0, approved: 0, published: 0 };
      shows.forEach(s => { if (counts[s.status] !== undefined) counts[s.status]++; });

      return ok({ shows, notifications: notifs, counts });
    }

    if (action === 'agency_resolve_notification') {
      if (!isAgency(event)) return err('Forbidden', 403);
      const { notification_id } = body;
      await db.collection(COLS.NOTIFICATIONS).doc(notification_id).update({ resolved: true });
      return ok({ resolved: true });
    }

    if (action === 'agency_regenerate_promoter_link') {
      if (!isAgency(event)) return err('Forbidden', 403);
      const { show_id } = body;
      const newToken = genToken();
      await db.collection(COLS.SHOWS).doc(show_id).update({ promoter_link_token: newToken, updated_at: nowISO() });
      return ok({ promoter_url: `https://melankoliaagency.com/advancing/${newToken}`, token: newToken });
    }

    // ═══════════════════════════════════════════
    //  PROMOTER — public form (no auth)
    // ═══════════════════════════════════════════

    if (action === 'promoter_get_show') {
      const { token } = body;
      if (!token) return err('Token required');
      const snap = await db.collection(COLS.SHOWS)
        .where('promoter_link_token', '==', token).limit(1).get();
      if (snap.empty) return err('Invalid or expired link', 404);
      const show = snap.docs[0].data();
      // Only return public fields — never agency_notes or financial internals
      return ok({
        show_id: snap.docs[0].id,
        venue_name: show.venue_name,
        venue_address: show.venue_address,
        city: show.city, country: show.country,
        date: show.date, capacity: show.capacity,
        age_restriction: show.age_restriction,
        already_submitted: show.status === 'published',
      });
    }

    if (action === 'promoter_submit') {
      const { token, data: formData } = body;
      if (!token || !formData) return err('token and data required');

      const snap = await db.collection(COLS.SHOWS)
        .where('promoter_link_token', '==', token).limit(1).get();
      if (snap.empty) return err('Invalid link', 404);

      const showDoc = snap.docs[0];
      const show = showDoc.data();
      const show_id = showDoc.id;

      // Validate required fields
      const gaps = validateAdvancingData(formData);

      // Store submission
      const subRef = await db.collection(COLS.SUBMISSIONS).add({
        show_id, promoter_link_token: token,
        submitted_data: formData,
        validation_gaps: gaps,
        submitted_at: nowISO(),
      });

      // Update advancing sheet with submitted data — mark pending_review
      const sheetsSnap = await db.collection(COLS.SHEETS)
        .where('show_id', '==', show_id).orderBy('version', 'desc').limit(1).get();

      if (!sheetsSnap.empty) {
        const sheet = sheetsSnap.docs[0];
        const currentVersion = sheet.data().version || 1;
        // Create new version
        await db.collection(COLS.SHEETS).add({
          ...sheet.data(), ...formData,
          show_id, version: currentVersion + 1,
          source: 'promoter', status: 'pending_review',
          submitted_at: nowISO(),
          updated_at: nowISO(),
        });
      }

      // Update show status
      await showDoc.ref.update({ status: 'pending_review', updated_at: nowISO() });

      // Create admin notification
      const severity = gaps.length > 3 ? 'high' : gaps.length > 0 ? 'medium' : 'low';
      await db.collection(COLS.NOTIFICATIONS).add({
        type: 'promoter_submission',
        show_id,
        message: `${show.venue_name}, ${show.city} (${show.date}) — promoter submitted advancing info.${gaps.length ? ` Missing: ${gaps.join(', ')}.` : ' All required fields complete.'}`,
        severity, resolved: false, created_at: nowISO(),
        submission_id: subRef.id,
      });

      // Log audit
      await logAudit(db, 'promoter_submit', 'promoter', show_id, 'pending_promoter', 'pending_review', { gaps });

      return ok({ received: true, gaps, message: gaps.length ? `Submitted with ${gaps.length} missing field(s): ${gaps.join(', ')}` : 'Advancing info received — thank you.' });
    }

    return err(`Unknown action: ${action}`);

  } catch (e) {
    console.error('[advancing-api]', e.message, e.stack);
    return err(`Server error: ${e.message}`, 500);
  }
};

// ── Helpers ──────────────────────────────────────────
function hashPw(pw) {
  return crypto.createHash('sha256').update(pw + (process.env.PW_SALT || 'melankolia_salt_2026')).digest('hex');
}

async function verifyBandSession(db, band_id, session_token) {
  if (!band_id || !session_token) return false;
  const doc = await db.collection(COLS.BANDS).doc(band_id).get();
  if (!doc.exists) return false;
  const data = doc.data();
  return data.active && data.session_token === session_token;
}

function validateAdvancingData(d) {
  const gaps = [];
  if (!d.load_in_time) gaps.push('load-in time');
  if (!d.soundcheck_time) gaps.push('soundcheck time');
  if (!d.doors_time) gaps.push('doors time');
  if (!d.showtime) gaps.push('showtime');
  if (!d?.promoter?.name) gaps.push('promoter name');
  if (!d?.promoter?.email) gaps.push('promoter email');
  if (!d?.promoter?.phone) gaps.push('promoter phone');
  if (!d?.day_of_contact?.name) gaps.push('day-of contact name');
  if (!d?.day_of_contact?.phone) gaps.push('day-of contact phone');
  if (!d?.sound_engineer?.name) gaps.push('sound engineer name');
  if (!d?.settlement?.method) gaps.push('settlement method');
  return gaps;
}

async function logAudit(db, action, actor_type, show_id, before, after, meta) {
  await db.collection(COLS.AUDIT).add({
    action, actor_type, show_id, before, after, meta,
    timestamp: new Date().toISOString()
  });
}

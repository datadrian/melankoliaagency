const crypto = require('crypto');
const { listDocs, getDoc, createDoc, updateDoc, json } = require('./_firebase');

const TOURS = 'route_planner_tours';
const SHOWS = 'route_planner_shows';
const now = () => new Date().toISOString();
const id = p => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
const token = () => crypto.randomBytes(18).toString('hex');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { success:false, error:'POST only' });

  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch { return json(400, { success:false, error:'Invalid JSON' }); }

  try {
    const a = b.action;

    if (a === 'listTours') {
      const tours = (await listDocs(TOURS)).filter(x => !x.deleted_at);
      return json(200, { success:true, data:tours });
    }

    if (a === 'getTour') {
      const t = await getDoc(TOURS, b.id);
      if (!t || t.deleted_at) return json(404, { success:false, error:'Tour not found' });
      const shows = (await listDocs(SHOWS, { orderBy:'date' })).filter(x => x.tour_id === b.id && !x.deleted_at);
      return json(200, { success:true, data:{ ...t, shows } });
    }

    if (a === 'createTour') {
      const tid = b.id || id('tour');
      const d = b.tour || {};
      const doc = await createDoc(TOURS, { ...d, status:d.status || 'draft', created_at:now(), updated_at:now() }, tid);
      if (b.createShows !== false && Array.isArray(d.legs)) await createShows(tid, doc, d.legs);
      return json(200, { success:true, data:doc });
    }

    if (a === 'updateTour') {
      const cur = await getDoc(TOURS, b.id);
      if (!cur) return json(404, { success:false, error:'Tour not found' });
      const doc = await updateDoc(TOURS, b.id, { ...cur, ...(b.updates || {}), updated_at:now() });
      if (b.replaceShows && Array.isArray(doc.legs)) {
        const old = (await listDocs(SHOWS, { orderBy:'date' })).filter(s => s.tour_id === b.id && !s.deleted_at);
        await Promise.all(old.map(s => updateDoc(SHOWS, s.id, { ...s, deleted_at:now(), updated_at:now() })));
        await createShows(b.id, doc, doc.legs);
      }
      return json(200, { success:true, data:doc });
    }

    if (a === 'updateStop') {
      const tourId = b.tour_id || b.id;
      const idx = Number(b.leg_index);
      const leg = b.leg || {};
      const cur = await getDoc(TOURS, tourId);
      if (!cur) return json(404, { success:false, error:'Tour not found' });
      const legs = Array.isArray(cur.legs) ? [...cur.legs] : [];
      if (!Number.isInteger(idx) || idx < 0 || idx >= legs.length) return json(400, { success:false, error:'Invalid leg index' });
      legs[idx] = { ...legs[idx], ...leg, updated_at:now() };
      const tour = await updateDoc(TOURS, tourId, { ...cur, legs, updated_at:now() });

      const shows = (await listDocs(SHOWS, { orderBy:'date' })).filter(s => s.tour_id === tourId && Number(s.leg_index) === idx && !s.deleted_at);
      let show = null;
      const shouldHaveShow = !legs[idx].day_off && isConfirmedLike(legs[idx]);
      if (shows[0]) show = await updateDoc(SHOWS, shows[0].id, { ...shows[0], ...showFromLeg(tourId, tour, legs[idx], idx), updated_at:now() });
      else if (shouldHaveShow) show = await createDoc(SHOWS, showFromLeg(tourId, tour, legs[idx], idx), id('show'));
      return json(200, { success:true, data:{ tour, show } });
    }

    if (a === 'deleteTour') {
      const t = await getDoc(TOURS, b.id);
      if (t) await updateDoc(TOURS, b.id, { ...t, deleted_at:now(), updated_at:now() });
      const oldShows = (await listDocs(SHOWS, { orderBy:'date' })).filter(s => s.tour_id === b.id && !s.deleted_at);
      await Promise.all(oldShows.map(s => updateDoc(SHOWS, s.id, { ...s, deleted_at:now(), updated_at:now() })));
      return json(200, { success:true, archived_shows:oldShows.length });
    }

    if (a === 'duplicateTour') {
      const t = await getDoc(TOURS, b.id);
      if (!t) return json(404, { success:false, error:'Tour not found' });
      const copy = { ...t, name:(t.name || t.tour_name || 'Untitled Tour') + ' (copy)', status:'draft', source_tour_id:b.id, created_at:now(), updated_at:now() };
      delete copy.id; delete copy.deleted_at;
      const doc = await createDoc(TOURS, copy, id('tour'));
      if (Array.isArray(copy.legs)) await createShows(doc.id, doc, copy.legs);
      return json(200, { success:true, data:doc });
    }

    return json(400, { success:false, error:'Unknown action' });
  } catch (err) {
    return json(500, { success:false, error:err.message });
  }
};

function isConfirmedLike(l={}) { return ['confirmed','advanced','settled'].includes(String(l.booking_status||'').toLowerCase()) || ['confirmed','settled'].includes(String(l.deal_status||'').toLowerCase()) || !!l.locked; }

async function createShows(tour_id, tour, legs) {
  await Promise.all(legs.map((l, i) => ({l, i})).filter(x => !x.l.day_off).map(({l, i}) => createDoc(SHOWS, showFromLeg(tour_id, tour, l, i), id('show'))));
}

function showFromLeg(tour_id, tour, l, i) {
  const show = {
    tour_id,
    tour_name: tour.name || tour.tour_name || '',
    artist: tour.artist || '',
    band_ids: tour.band_ids || [],
    leg_index: i,
    date: l.date || '',
    city: l.city || '',
    country: l.country || '',
    venue_name: l.suggested_venue || l.venue || '',
    venue_address: l.venue_address || '',
    status: l.show_status || l.advancing_status || (isConfirmedLike(l) ? 'confirmed' : 'draft'),
    promoter_token: l.promoter_token || token(),
    promoter_url: l.promoter_url || '',
    booking_status: l.booking_status || 'prospect',
    deal_status: l.deal_status || 'not_started',
    locked: !!l.locked || isConfirmedLike(l),
    deal_suggestion: l.deal_suggestion || '',
    rate_target_usd: l.rate_target_usd || l.suggested_guarantee_usd || 0,
    rate_offer_usd: l.rate_offer_usd || null,
    rate_confirmed_usd: l.rate_confirmed_usd || null,
    hold_deadline: l.hold_deadline || '',
    contact_status: l.contact_status || 'not_contacted',
    next_action: l.next_action || '',
    candidate_venues: l.candidate_venues || [],
    travel: l.travel || {},
    lodging: l.lodging || {},
    gear: l.gear || {},
    backline: l.backline || {},
    transport: l.transport || {},
    advancing_requirements: l.advancing_requirements || defaultAdvancingRequirements(),
    drive_from_previous_km: l.drive_from_previous_km || 0,
    drive_hours: l.drive_hours || 0,
    travel_mode_recommendation: l.travel_mode_recommendation || '',
    travel_feasibility: l.travel_feasibility || '',
    hotel_required: !!l.hotel_required,
    hotel_responsibility: l.hotel_responsibility || '',
    airport_transfer_required: !!l.airport_transfer_required,
    backline_needed: l.backline_needed || '',
    advancing_notes: l.advancing_notes || l.notes || '',
    is_anchor_show: !!l.is_anchor_show,
    created_at: l.created_at || now(),
    updated_at: now()
  };
  show.promoter_url = show.promoter_url || `https://melankoliaagency.com/advancing/?token=${show.promoter_token}`;
  return show;
}

function defaultAdvancingRequirements() {
  return { contacts:true, venue:true, schedule:true, technical:true, backline:true, guest_list:true, merch:true, hotel:true, transportation:true, settlement:true, hospitality:true, wifi:true, notes:true };
}

const crypto = require('crypto');
const { listDocs, getDoc, createDoc, updateDoc, deleteDoc, json } = require('./_firebase');
const { authorize } = require('./_auth');

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

    const auth = await authorize(b, 'routes');
    if (!auth.ok) return json(401, { success:false, error: auth.error });

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

    if (a === 'debugGhost') {
      const all = await listDocs(TOURS, { pageSize:300 });
      const m = all.filter(t => String(t.name||t.tour_name||'').includes('Guide Demo'));
      return json(200, { success:true, docs: m.map(t => ({ id:t.id, id_json: JSON.stringify(t.id), len:String(t.id).length, codes:[...String(t.id)].map(c=>c.charCodeAt(0)) })) });
    }

    if (a === 'debugGhost2') {
      const PID=process.env.FIREBASE_PROJECT_ID;
      const target=String(b.id||'guide-sacred-skin-westcoast');
      const out={};
      // raw GET the doc
      const { _rawReq } = require('./_firebase');
      try{ out.get = await _rawReq('GET', `/${TOURS}/${encodeURIComponent(target)}`); }catch(e){ out.get_err=e.message; }
      // list subcollection ids under the doc
      try{ out.subcols = await _rawReq('GET', `/${TOURS}/${encodeURIComponent(target)}:listCollectionIds`); }catch(e){ out.subcols_err=e.message; }
      // raw DELETE + immediate raw GET
      try{ out.del = await _rawReq('DELETE', `/${TOURS}/${encodeURIComponent(target)}`); out.del_ok=true; }catch(e){ out.del_err=e.message; }
      try{ out.get_after = await _rawReq('GET', `/${TOURS}/${encodeURIComponent(target)}`); }catch(e){ out.get_after_err=e.message; }
      return json(200, { success:true, out });
    }

    if (a === 'debugGhost3') {
      const { _rawReq } = require('./_firebase');
      const target=String(b.id||'guide-sacred-skin-westcoast');
      const out={};
      try{ out.subcols = await _rawReq('POST', `/${TOURS}/${encodeURIComponent(target)}:listCollectionIds`, {}); }catch(e){ out.subcols_err=e.message; }
      // for each subcollection, list child docs and delete them, then delete parent
      const ids = (out.subcols && out.subcols.collectionIds) || [];
      out.deleted = {};
      for (const cid of ids) {
        try{
          const kids = await _rawReq('GET', `/${TOURS}/${encodeURIComponent(target)}/${encodeURIComponent(cid)}?pageSize=300`);
          const docs = (kids.documents||[]);
          out.deleted[cid] = [];
          for (const d of docs) {
            const path = String(d.name).split('/databases/(default)/documents')[1];
            try{ await _rawReq('DELETE', path); out.deleted[cid].push('ok:'+path.split('/').pop()); }catch(e){ out.deleted[cid].push('fail:'+e.message); }
          }
        }catch(e){ out.deleted[cid]='list-err:'+e.message; }
      }
      // final parent delete attempt
      try{ await _rawReq('DELETE', `/${TOURS}/${encodeURIComponent(target)}`); out.parent_del='ok'; }catch(e){ out.parent_del='err:'+e.message; }
      return json(200, { success:true, out });
    }

    if (a === 'debugGhost4') {
      const { _rawReq } = require('./_firebase');
      // raw list, expose exact document.name for Guide Demo docs
      const j = await _rawReq('GET', `/${TOURS}?pageSize=300`);
      const docs = (j.documents||[]).filter(d => {
        const f=d.fields||{}; const n=(f.name&&f.name.stringValue)||(f.tour_name&&f.tour_name.stringValue)||'';
        return String(n).includes('Guide Demo');
      }).map(d => ({ name:d.name, seg: d.name.split('/documents/')[1] }));
      // try deleting each by its EXACT name path
      for (const d of docs) {
        const path = '/' + d.seg;
        try{ await _rawReq('DELETE', path); d.del='ok'; }catch(e){ d.del='err:'+e.message; }
      }
      return json(200, { success:true, docs });
    }

    if (a === 'hardDeleteTour') {
      // One-shot cleanup for ghost/custom-id tour docs that resist soft-delete.
      const target = String(b.id||'').trim();
      if (!target) return json(400, { success:false, error:'id required' });
      let removed = 0, tried = [];
      // 1) direct delete by id
      try { await deleteDoc(TOURS, target); removed++; tried.push('direct'); } catch(e){ tried.push('direct:'+e.message); }
      // 2) match any remaining docs whose derived id === target and delete each
      const all = await listDocs(TOURS, { pageSize:300 });
      for (const t of all) {
        if (String(t.id).trim() === target) {
          try { await deleteDoc(TOURS, t.id); removed++; tried.push('byid:'+t.id); } catch(e){ tried.push('byid-fail:'+e.message); }
        }
      }
      // 3) archive its shows too
      const shows = (await listDocs(SHOWS, { orderBy:'date' })).filter(s => s.tour_id === target && !s.deleted_at);
      await Promise.all(shows.map(s => updateDoc(SHOWS, s.id, { ...s, deleted_at:now(), updated_at:now() }).catch(()=>{})));
      return json(200, { success:true, removed, archived_shows:shows.length, tried });
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

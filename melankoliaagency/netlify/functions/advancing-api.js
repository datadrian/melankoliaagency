const crypto = require('crypto');
const { listDocs, getDoc, createDoc, updateDoc, json } = require('./_firebase');

const SHOWS='route_planner_shows', TOURS='route_planner_tours', BANDS='route_planner_bands', NOTIFS='route_planner_notifications';
const now = () => new Date().toISOString();
const id = p => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
const token = () => crypto.randomBytes(18).toString('hex');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { success:false, error:'POST only' });
  let b={}; try { b=JSON.parse(event.body || '{}'); } catch { return json(400,{success:false,error:'Invalid JSON'}); }

  try {
    const a=b.action;

    if (a==='agency_get_dashboard') {
      const [shows,tours,bands,notifications] = await Promise.all([list(SHOWS),list(TOURS),list(BANDS),list(NOTIFS)]);
      const counts={}; shows.forEach(s=>counts[s.status||'draft']=(counts[s.status||'draft']||0)+1);
      const unreadByShow={}; notifications.filter(n=>!n.resolved&&n.show_id).forEach(n=>unreadByShow[n.show_id]=(unreadByShow[n.show_id]||0)+1);
      shows.forEach(s=>{ if(unreadByShow[s.id]) s._pending_notifications=unreadByShow[s.id]; });
      return json(200,{success:true,data:{shows,tours,bands,notifications,counts}});
    }
    if (a==='agency_list_tours') return json(200,{success:true,data:await list(TOURS)});
    if (a==='agency_list_bands') return json(200,{success:true,data:await list(BANDS)});

    if (a==='agency_get_show') {
      const show=await getDoc(SHOWS,b.show_id);
      return json(show&&!show.deleted_at?200:404,{success:!!(show&&!show.deleted_at),data:show&&!show.deleted_at?show:null,error:show?'Show archived':'Show not found'});
    }

    if (a==='agency_create_show') {
      const incoming = b.show || {};
      const show={
        ...incoming,
        tour_id:b.tour_id||incoming.tour_id||null,
        band_ids:b.band_ids || incoming.band_ids || (b.band_id?[b.band_id]:[]),
        date:b.date||incoming.date||'', venue_name:b.venue_name||incoming.venue_name||'', city:b.city||incoming.city||'', country:b.country||incoming.country||'', venue_address:b.venue_address||incoming.venue_address||'',
        status:b.status||incoming.status||'draft', promoter_token:b.promoter_token||incoming.promoter_token||token(), sheets:incoming.sheets||[], created_at:incoming.created_at||now(), updated_at:now(),
        promoter_url:b.promoter_url||incoming.promoter_url||'', advancing_requirements:incoming.advancing_requirements||b.advancing_requirements||defaultReq()
      };
      show.promoter_url = show.promoter_url || `https://melankoliaagency.com/advancing/?token=${show.promoter_token}`;
      const doc=await createDoc(SHOWS,show,id('show'));
      return json(200,{success:true,data:doc});
    }

    if (a==='agency_update_show') {
      const cur=await getDoc(SHOWS,b.show_id); if(!cur) return json(404,{success:false,error:'Show not found'});
      const updates = b.updates || b.show || {};
      const doc=await updateDoc(SHOWS,b.show_id,{...cur,...updates,updated_at:now()});
      await syncShowToTour(doc, { source:'agency_update_show' });
      return json(200,{success:true,data:doc});
    }

    if (a==='agency_update_sheet') {
      const cur=await getDoc(SHOWS,b.show_id); if(!cur) return json(404,{success:false,error:'Show not found'});
      const sheet={...(cur.sheets?.[0]||{}),...(b.sheet_data||{}),updated_at:now()};
      const promoter=sheet.promoter || cur.promoter || {};
      const doc=await updateDoc(SHOWS,b.show_id,{...cur,sheets:[sheet],promoter,status:cur.status||'draft',updated_at:now()});
      await syncShowToTour(doc, { source:'agency_update_sheet' });
      return json(200,{success:true,data:doc});
    }

    if (a==='agency_approve_sheet') {
      const cur=await getDoc(SHOWS,b.show_id); if(!cur) return json(404,{success:false,error:'Show not found'});
      const doc=await updateDoc(SHOWS,b.show_id,{...cur,status:'approved',reviewed_by:b.reviewed_by||'agency',reviewed_at:now(),updated_at:now()});
      await syncShowToTour(doc, { source:'agency_approve_sheet' });
      return json(200,{success:true,data:doc});
    }

    if (a==='agency_publish_sheet') {
      const cur=await getDoc(SHOWS,b.show_id); if(!cur) return json(404,{success:false,error:'Show not found'});
      const doc=await updateDoc(SHOWS,b.show_id,{...cur,status:'published',published_at:now(),updated_at:now()});
      await syncShowToTour(doc, { source:'agency_publish_sheet' });
      await createDoc(NOTIFS,{type:'band_published',show_id:b.show_id,message:`${cur.venue_name||cur.city||'Show'} published to band portal`,resolved:false,created_at:now(),updated_at:now()},id('notif'));
      return json(200,{success:true,data:doc});
    }

    if (a==='agency_set_show_status') {
      const cur=await getDoc(SHOWS,b.show_id); if(!cur) return json(404,{success:false,error:'Show not found'});
      const doc=await updateDoc(SHOWS,b.show_id,{...cur,status:b.status||cur.status,updated_at:now()});
      await syncShowToTour(doc, { source:'agency_set_show_status' });
      return json(200,{success:true,data:doc});
    }

    if (a==='agency_resolve_notification') {
      const n=await getDoc(NOTIFS,b.notification_id); if(n) await updateDoc(NOTIFS,b.notification_id,{...n,resolved:true,resolved_at:now(),updated_at:now()});
      return json(200,{success:true});
    }

    if (a==='agency_create_band') {
      const username=b.username || String(b.name||'band').toLowerCase().replace(/[^a-z0-9]+/g,'-');
      const band={name:b.name||'Band',username,password:b.password||token().slice(0,10),contacts:b.contacts||[],created_at:now(),updated_at:now()};
      return json(200,{success:true,data:await createDoc(BANDS,band,id('band'))});
    }
    if (a==='agency_update_band_password') {
      const band=await getDoc(BANDS,b.band_id); if(!band) return json(404,{success:false,error:'Band not found'});
      return json(200,{success:true,data:await updateDoc(BANDS,b.band_id,{...band,password:b.new_password||token().slice(0,10),updated_at:now()})});
    }
    if (a==='agency_archive_band') {
      const band=await getDoc(BANDS,b.band_id); if(!band) return json(404,{success:false,error:'Band not found'});
      return json(200,{success:true,data:await updateDoc(BANDS,b.band_id,{...band,deleted_at:now(),updated_at:now()})});
    }
    if (a==='agency_create_tour') {
      const tour={name:b.name||b.tour?.name||'Untitled Tour',band_ids:b.band_ids || (b.band_id?[b.band_id]:[]),startDate:b.start_date||b.startDate||'',endDate:b.end_date||b.endDate||'',status:b.status||'draft',created_at:now(),updated_at:now(),...(b.tour||{})};
      return json(200,{success:true,data:await createDoc(TOURS,tour,id('tour'))});
    }

    if (a==='band_login') {
      const bands=await list(BANDS);
      const band=bands.find(x=>x.username===b.username && String(x.password||'')===String(b.password||''));
      if(!band) return json(401,{success:false,error:'Invalid login'});
      const session_token=crypto.createHash('sha256').update(`${band.id}:${band.password}:melankolia`).digest('hex');
      return json(200,{success:true,data:{band_id:band.id,session_token,band:{id:band.id,name:band.name,username:band.username,contacts:band.contacts||[]}}});
    }
    if (a==='band_get_shows') {
      const band=await getDoc(BANDS,b.band_id); if(!band) return json(404,{success:false,error:'Band not found'});
      const good=crypto.createHash('sha256').update(`${band.id}:${band.password}:melankolia`).digest('hex');
      if(b.session_token!==good) return json(401,{success:false,error:'Invalid session'});
      const shows=(await list(SHOWS)).filter(s=>(s.band_ids||[]).includes(b.band_id) && ['approved','published'].includes(s.status));
      const toursArr=await list(TOURS); const tours={}; toursArr.forEach(t=>tours[t.id]=t);
      const notifications=(await list(NOTIFS)).filter(n=>(shows.some(s=>s.id===n.show_id)) && !n.resolved);
      return json(200,{success:true,data:{shows,tours,notifications,band:{id:band.id,name:band.name,username:band.username}}});
    }
    if (a==='band_mark_notifications_read') {
      await Promise.all((b.notification_ids||[]).map(async nid=>{const n=await getDoc(NOTIFS,nid); if(n) await updateDoc(NOTIFS,nid,{...n,resolved:true,read_at:now(),updated_at:now()});}));
      return json(200,{success:true});
    }

    if (a==='promoter_get_show') {
      const shows=await list(SHOWS);
      const show=shows.find(s=>s.promoter_token===b.token || s.id===b.token);
      return json(show?200:404,{success:!!show,data:show||null,error:show?undefined:'Show not found'});
    }

    if (a==='promoter_submit') {
      const shows=await list(SHOWS);
      const cur=shows.find(s=>s.promoter_token===b.token || s.id===b.token);
      if(!cur) return json(404,{success:false,error:'Show not found'});
      const sheet={...(cur.sheets?.[0]||{}),...(b.data||{}),submitted_at:now(),updated_at:now()};
      const logistics = extractLogisticsFromSheet(sheet);
      const doc=await updateDoc(SHOWS,cur.id,{...cur,...logistics,sheets:[sheet],promoter:sheet.promoter||cur.promoter||{},status:'pending_review',updated_at:now()});
      await syncShowToTour(doc, { source:'promoter_submit', sheet });
      await createDoc(NOTIFS,{type:'promoter_submit',show_id:cur.id,message:`Promoter submitted advancing info for ${cur.venue_name||cur.city||'show'}`,resolved:false,created_at:now(),updated_at:now()},id('notif'));
      return json(200,{success:true,data:{...doc,message:'Thank you. The agency will review and publish confirmed details to the band app.',gaps:[]}});
    }

    return json(400,{success:false,error:'Unknown advancing action'});
  } catch(e) { return json(500,{success:false,error:e.message}); }
};

async function list(c){ return (await listDocs(c,{orderBy:'updated_at desc',pageSize:300})).filter(x=>!x.deleted_at); }
function defaultReq(){ return { contacts:true, venue:true, schedule:true, technical:true, backline:true, guest_list:true, merch:true, hotel:true, transportation:true, settlement:true, hospitality:true, wifi:true, notes:true }; }

function extractLogisticsFromSheet(sheet={}) {
  return {
    venue_address: sheet.venue_address || '',
    capacity: sheet.capacity || '',
    hotel_required: !!(sheet.hotel?.name || sheet.hotel?.address),
    hotel_responsibility: sheet.hotel?.responsibility || sheet.hotel_responsibility || '',
    airport_transfer_required: !!(sheet.transportation?.airport_pickup || sheet.transportation?.airport_transfer),
    travel_mode_recommendation: sheet.transportation?.mode || '',
    transport_responsibility: sheet.transportation?.responsibility || '',
    backline_needed: sheet.backline ? 'provided_details' : '',
    lodging: sheet.hotel || {},
    transport: sheet.transportation || {},
    backline: sheet.backline || {},
    advancing_submitted_at: sheet.submitted_at || now()
  };
}

async function syncShowToTour(show, meta={}) {
  if (!show?.tour_id || show.leg_index === undefined || show.leg_index === null) return null;
  const tour = await getDoc(TOURS, show.tour_id);
  if (!tour || !Array.isArray(tour.legs)) return null;
  const idx = Number(show.leg_index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= tour.legs.length) return null;
  const legs = [...tour.legs];
  legs[idx] = {
    ...legs[idx],
    suggested_venue: show.venue_name || legs[idx].suggested_venue,
    venue_address: show.venue_address || legs[idx].venue_address,
    booking_status: show.booking_status || legs[idx].booking_status,
    deal_status: show.deal_status || legs[idx].deal_status,
    locked: !!show.locked,
    rate_target_usd: show.rate_target_usd || legs[idx].rate_target_usd,
    rate_offer_usd: show.rate_offer_usd || legs[idx].rate_offer_usd,
    rate_confirmed_usd: show.rate_confirmed_usd || legs[idx].rate_confirmed_usd,
    hold_deadline: show.hold_deadline || legs[idx].hold_deadline,
    contact_status: show.contact_status || legs[idx].contact_status,
    next_action: show.next_action || legs[idx].next_action,
    travel_mode_recommendation: show.travel_mode_recommendation || legs[idx].travel_mode_recommendation,
    travel_feasibility: show.travel_feasibility || legs[idx].travel_feasibility,
    hotel_required: show.hotel_required ?? legs[idx].hotel_required,
    hotel_responsibility: show.hotel_responsibility || legs[idx].hotel_responsibility,
    airport_transfer_required: show.airport_transfer_required ?? legs[idx].airport_transfer_required,
    transport_responsibility: show.transport_responsibility || legs[idx].transport_responsibility,
    backline_needed: show.backline_needed || legs[idx].backline_needed,
    lodging: show.lodging || legs[idx].lodging || {},
    transport: show.transport || legs[idx].transport || {},
    backline: show.backline || legs[idx].backline || {},
    sheets: show.sheets || legs[idx].sheets || [],
    advancing_requirements: show.advancing_requirements || legs[idx].advancing_requirements || defaultReq(),
    advancing_status: show.status,
    updated_at: now(),
    last_advancing_sync: { source:meta.source || 'unknown', at:now() }
  };
  return updateDoc(TOURS, tour.id, { ...tour, legs, updated_at:now() });
}

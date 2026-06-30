// Melankolia Agency — Travel + Hotel Logistics
// Manual-first Firestore travel/hotel records with generated links, feasibility, budget, and band-safe guidance.

const { listDocs, getDoc, createDoc, updateDoc, json } = require('./_firebase');

const TOURS='route_planner_tours', SHOWS='route_planner_shows';
const LEGS='route_planner_travel_legs', HOTELS='route_planner_hotel_stays', BOOKINGS='route_planner_travel_bookings', BUDGETS='route_planner_travel_budgets', ALERTS='route_planner_travel_alerts';
const now=()=>new Date().toISOString();
const id=p=>`${p}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

exports.handler=async(event)=>{
  if(event.httpMethod==='OPTIONS') return json(204,{});
  if(event.httpMethod!=='POST') return json(405,{success:false,error:'POST only'});
  let b={}; try{b=JSON.parse(event.body||'{}')}catch{return json(400,{success:false,error:'Invalid JSON'});}
  try{
    const a=b.action;
    if(a==='getTourTravel') return json(200,{success:true,data:await getTourTravel(b.tour_id||b.id)});
    if(a==='getTravelOpsBoard') return json(200,{success:true,data:await getTravelOpsBoard({mode:b.mode||b.range,days:b.days})});
    if(a==='getTravelAlerts') return json(200,{success:true,data:await getTravelAlerts({mode:b.mode||'week',include_resolved:!!b.include_resolved})});
    if(a==='updateTravelAlert') return json(200,{success:true,data:await updateTravelAlert(b.alert||b)});
    if(a==='generateTravelAlertMessage') return json(200,{success:true,data:generateTravelAlertMessage(b.alert||b,b.message_type||b.type||'agency_note')});
    if(a==='saveTravelLeg') return json(200,{success:true,data:await saveTravelLeg(b.leg||b.travel_leg||b)});
    if(a==='saveHotelStay') return json(200,{success:true,data:await saveHotelStay(b.hotel||b.hotel_stay||b)});
    if(a==='archiveTravelLeg') return json(200,{success:true,data:await archiveTravelRecord(LEGS,b.id||b.leg_id)});
    if(a==='archiveHotelStay') return json(200,{success:true,data:await archiveTravelRecord(HOTELS,b.id||b.hotel_id)});
    if(a==='generateBookingLinks') return json(200,{success:true,data:generateBookingLinks(b)});
    if(a==='generateMapsRoute') return json(200,{success:true,data:await generateMapsRoute(b)});
    if(a==='getTravelProviderStatus') return json(200,{success:true,data:getTravelProviderStatus()});
    if(a==='lookupFlightStatus') return json(200,{success:true,data:await lookupFlightStatus(b)});
    if(a==='searchFlightOffers') return json(200,{success:true,data:await searchFlightOffers(b)});
    if(a==='lookupTrainJourney') return json(200,{success:true,data:await lookupTrainJourney(b)});
    if(a==='checkFeasibility') return json(200,{success:true,data:await checkFeasibility({tour_id:b.tour_id,show_id:b.show_id,leg_index:b.leg_index})});
    if(a==='computeTravelBudget') return json(200,{success:true,data:await computeTravelBudget(b.tour_id)});
    if(a==='generateBandGuidance') return json(200,{success:true,data:await generateBandGuidance({show_id:b.show_id,device_location:b.device_location})});
    if(a==='syncTourBandGuidance') return json(200,{success:true,data:await syncTourBandGuidance(b.tour_id||b.id)});
    return json(400,{success:false,error:'Unknown travel action'});
  }catch(e){return json(e.status||500,{success:false,error:e.message});}
};

async function all(c){ return (await listDocs(c,{orderBy:'updated_at desc',pageSize:1000})).filter(x=>!x.deleted_at); }
async function getTravelOpsBoard({mode='next2',days}={}){
  const [tours,shows,legs,hotels]=await Promise.all([all(TOURS),all(SHOWS),all(LEGS),all(HOTELS)]);
  const today=new Date(); today.setHours(0,0,0,0);
  const range=resolveOpsRange(mode,days,today);
  const start=range.start, end=range.end;
  const activeTours=new Map(tours.filter(t=>!String(t.status||'').match(/archived|deleted/i)).map(t=>[t.id,t]));
  const inWindow=shows.filter(s=>activeTours.has(s.tour_id)&&isDateInWindow(s.date,start,end)).sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
  const rows=inWindow.map(show=>{
    const t=activeTours.get(show.tour_id)||{};
    const slegs=legs.filter(l=>l.show_id===show.id || (l.tour_id===show.tour_id&&Number(l.leg_index)===Number(show.leg_index))).sort((a,b)=>String(a.departure_datetime||'').localeCompare(String(b.departure_datetime||'')));
    const shotels=hotels.filter(h=>h.show_id===show.id || (h.tour_id===show.tour_id&&Number(h.leg_index)===Number(show.leg_index)));
    const feas=feasibilityForRecords(slegs,shotels);
    const flags=[...(feas.flags||[])];
    if(!slegs.length) flags.push({level:'tight',message:'No travel leg saved for this stop.'});
    if(!shotels.length && (show.hotel_required || show.hotel_responsibility || t.hotel_required)) flags.push({level:'tight',message:'Hotel is expected but no hotel stay is saved.'});
    shotels.filter(h=>!String(h.booking_status||'').match(/confirmed|locked/i)).forEach(h=>flags.push({level:'tight',message:`Hotel ${h.hotel_name||h.address||''} is not confirmed.`}));
    slegs.filter(l=>!String(l.booking_status||'').match(/confirmed|locked|planned/i)).forEach(l=>flags.push({level:'tight',message:`Travel ${label(l)} is not confirmed.`}));
    const risk=flags.some(f=>f.level==='critical')?'critical':flags.some(f=>f.level==='risky')?'risky':flags.some(f=>f.level==='tight')?'tight':'none';
    return {show_id:show.id,tour_id:show.tour_id,tour_name:t.name||t.tour_name||'',artist:show.artist||t.artist||'',date:show.date,city:show.city,country:show.country,venue_name:show.venue_name,status:show.status,travel_count:slegs.length,hotel_count:shotels.length,next_travel:slegs[0]||null,next_hotel:shotels[0]||null,risk_level:risk,flags:flags.slice(0,6)};
  });
  const counts={shows:rows.length,critical:rows.filter(r=>r.risk_level==='critical').length,risky:rows.filter(r=>r.risk_level==='risky').length,tight:rows.filter(r=>r.risk_level==='tight').length,missing_travel:rows.filter(r=>!r.travel_count).length,missing_hotels:rows.filter(r=>!r.hotel_count).length};
  return {range:{mode:range.mode,label:range.label,from:start.toISOString().slice(0,10),through:end.toISOString().slice(0,10)},counts,rows,generated_at:now()};
}
function resolveOpsRange(mode,days,today){ const m=String(mode||'next2'); const start=new Date(today), end=new Date(today); if(m==='today'){return{mode:m,label:'Today',start,end};} if(m==='tomorrow'){start.setDate(start.getDate()+1); end.setDate(end.getDate()+1); return{mode:m,label:'Tomorrow',start,end};} if(m==='week'||m==='7days'){end.setDate(end.getDate()+6); return{mode:'week',label:'Next 7 days',start,end};} if(m==='upcoming'||m==='all'){end.setDate(end.getDate()+365); return{mode:'upcoming',label:'Upcoming',start,end};} const n=Math.max(1,Number(days||2)); end.setDate(end.getDate()+n-1); return{mode:'next2',label:n===2?'Today + tomorrow':`Next ${n} days`,start,end}; }
function isDateInWindow(v,start,end){ if(!v) return false; const d=new Date(String(v).slice(0,10)+'T00:00:00'); return Number.isFinite(d.getTime())&&d>=start&&d<=end; }

async function getTravelAlerts({mode='week',include_resolved=false}={}){
  const [board,states]=await Promise.all([getTravelOpsBoard({mode}),all(ALERTS)]);
  const byKey=new Map(states.map(s=>[s.alert_key,s]));
  const alerts=[];
  (board.rows||[]).forEach(row=>{
    (row.flags||[]).forEach(flag=>{
      const key=[row.show_id,row.date,row.city,flag.level,flag.message].join('|');
      const state=byKey.get(key)||{};
      const status=state.status||'open';
      if(status==='resolved'&&!include_resolved) return;
      alerts.push({alert_key:key,alert_id:alertDocId(key),status,owner:state.owner||suggestAlertOwner(flag,row),notes:state.notes||'',updated_at:state.updated_at||'',level:flag.level||'tight',message:flag.message||'',show_id:row.show_id,tour_id:row.tour_id,tour_name:row.tour_name,artist:row.artist,date:row.date,city:row.city,country:row.country,venue_name:row.venue_name,risk_level:row.risk_level});
    });
  });
  const counts={open:alerts.filter(a=>a.status==='open').length,resolved:states.filter(a=>a.status==='resolved').length,critical:alerts.filter(a=>a.level==='critical').length,risky:alerts.filter(a=>a.level==='risky').length,tight:alerts.filter(a=>a.level==='tight').length};
  alerts.sort((a,b)=>severityRank(a.level)-severityRank(b.level)||String(a.date||'').localeCompare(String(b.date||'')));
  return {range:board.range,counts,alerts,digest_text:travelAlertDigest(board.range,alerts,counts),generated_at:now()};
}

function travelAlertDigest(range={},alerts=[],counts={}){
  const lines=['Melankolia Travel Alert Digest',`${range.label||range.mode||'Range'}: ${[range.from,range.through].filter(Boolean).join(' → ')}`,`Open: ${counts.open||0} · Critical: ${counts.critical||0} · Risky: ${counts.risky||0} · Tight: ${counts.tight||0}`,''];
  if(!alerts.length){ lines.push('No open travel alerts in this range.'); return lines.join('\n'); }
  alerts.slice(0,40).forEach(a=>lines.push(`- [${String(a.level||'tight').toUpperCase()}] ${[a.date,a.city,a.country].filter(Boolean).join(' · ')} — ${a.artist||a.tour_name||'Show'}: ${a.message||''} (owner: ${a.owner||'agency'}, status: ${a.status||'open'})${a.notes?` | notes: ${a.notes}`:''}`));
  if(alerts.length>40) lines.push(`...and ${alerts.length-40} more alerts.`);
  return lines.join('\n');
}

async function updateTravelAlert(input={}){
  const key=input.alert_key||input.key; if(!key) throw bad('alert_key required',400);
  const idv=alertDocId(key);
  const cur=await getDoc(ALERTS,idv)||{};
  const doc={...cur,id:idv,alert_key:key,status:input.status||cur.status||'open',owner:input.owner||cur.owner||'agency',notes:input.notes??cur.notes??'',updated_at:now(),created_at:cur.created_at||now()};
  return cur.id?await updateDoc(ALERTS,idv,doc):await createDoc(ALERTS,doc,idv);
}
function alertDocId(key){ return 'alert_'+hash(String(key)); }
function hash(str){ let h=2166136261; for(let i=0;i<str.length;i++){h^=str.charCodeAt(i); h=Math.imul(h,16777619);} return (h>>>0).toString(36); }
function severityRank(v){ return {critical:0,risky:1,tight:2,info:3,none:4}[String(v||'tight').toLowerCase()]??2; }
function suggestAlertOwner(flag,row){ const m=String(flag?.message||'').toLowerCase(); if(m.includes('hotel')) return 'agency'; if(m.includes('promoter')||m.includes('venue')) return 'promoter'; if(m.includes('backline')||m.includes('gear')) return 'promoter'; return 'agency'; }

function generateTravelAlertMessage(alert={},type='agency_note'){
  const date=alert.date||'the show date', city=[alert.city,alert.country].filter(Boolean).join(', ')||'the show city';
  const artist=alert.artist||'the artist'; const tour=alert.tour_name||'the tour'; const venue=alert.venue_name||'the venue';
  const issue=alert.message||'A travel/logistics item needs confirmation.';
  if(type==='promoter_reminder'){
    const subject=`Logistics confirmation for ${artist} — ${city} ${date}`;
    const body=`Hi there,\n\nI hope you are well. I am following up on the logistics for ${artist}'s ${date} show in ${city}${venue?` at ${venue}`:''}.\n\nThe current item we still need to confirm is:\n\n${issue}\n\nCould you please confirm the relevant details when you have a moment? If this sits with the venue or another production contact, feel free to point me to the right person and I will coordinate from there.\n\nBest wishes,\nAnna-Maria`;
    return {type,subject,body_text:body,body_html:htmlEmail(subject,body),audience:'promoter'};
  }
  if(type==='band_note'){
    const subject=`Travel update needed — ${artist} / ${city} ${date}`;
    const body=`Travel/logistics note for ${artist}\n\nShow: ${date} — ${city}${venue?` — ${venue}`:''}\nTour: ${tour}\n\nCurrent issue:\n${issue}\n\nStatus: ${alert.status||'open'}\nOwner: ${alert.owner||'agency'}\n\nPlease do not treat this as confirmed until the agency updates the Band App travel card.`;
    return {type,subject,body_text:body,body_html:plainHtml(body),audience:'band'};
  }
  const subject=`Agency task: ${artist} logistics — ${city} ${date}`;
  const body=`Agency logistics task\n\nArtist: ${artist}\nTour: ${tour}\nShow: ${date} — ${city}${venue?` — ${venue}`:''}\nSeverity: ${String(alert.level||'tight').toUpperCase()}\nOwner: ${alert.owner||'agency'}\n\nIssue:\n${issue}\n\nSuggested next step:\n${agencyNextStep(issue,alert.owner)}`;
  return {type:'agency_note',subject,body_text:body,body_html:plainHtml(body),audience:'agency'};
}
function agencyNextStep(issue='',owner='agency'){ const m=String(issue).toLowerCase(); if(m.includes('hotel')) return 'Confirm hotel booking status, add confirmation number/document URL, then sync Band Guidance.'; if(m.includes('travel')) return 'Add or confirm the travel leg, route/flight number, passenger count, and ticket/booking URL.'; if(owner==='promoter') return 'Ask promoter/venue to confirm responsibility and attach the answer to the show record.'; return 'Resolve the missing field in Travel + Hotels, then mark the alert resolved.'; }
function plainHtml(text=''){ return `<div style="font-family:Arial,sans-serif;line-height:1.5;white-space:pre-wrap">${escapeHtml(text)}</div>`; }
function htmlEmail(title='',text=''){ return `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#111"><h2>${escapeHtml(title)}</h2>${escapeHtml(text).split('\n\n').map(p=>`<p>${p.replace(/\n/g,'<br>')}</p>`).join('')}</div>`; }
function escapeHtml(v){ return String(v||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }



async function getTourTravel(tour_id){
  if(!tour_id) throw bad('tour_id required',400);
  const [tour,legs,hotels,bookings,budget]=await Promise.all([
    getDoc(TOURS,tour_id), all(LEGS), all(HOTELS), all(BOOKINGS), all(BUDGETS)
  ]);
  const data={tour, travel_legs:legs.filter(x=>x.tour_id===tour_id), hotel_stays:hotels.filter(x=>x.tour_id===tour_id), travel_bookings:bookings.filter(x=>x.tour_id===tour_id), budget:budget.find(x=>x.tour_id===tour_id)||null};
  data.links=generateTourLinks(tour||{});
  data.budget_summary=budgetFrom(data.travel_legs,data.hotel_stays,data.budget);
  data.feasibility=feasibilityForTour(tour,data.travel_legs,data.hotel_stays);
  return data;
}
async function saveTravelLeg(input={}){
  let d=normalizeTravelLeg(input);
  if(!d.tour_id) throw bad('tour_id required',400);
  d=await enrichTravelLeg(d);
  if(!d.origin_name && !d.destination_name) throw bad('origin or destination required',400);
  const doc=d.id?await updateDoc(LEGS,d.id,{...(await getDoc(LEGS,d.id)||{}),...d,updated_at:now()}):await createDoc(LEGS,{...d,created_at:now(),updated_at:now()},id('travel'));
  await syncShowGuidance(doc.tour_id,doc.show_id,doc.leg_index);
  return doc;
}
async function saveHotelStay(input={}){
  const d=normalizeHotel(input);
  if(!d.tour_id) throw bad('tour_id required',400);
  if(!d.hotel_name && !d.address) throw bad('hotel name or address required',400);
  const doc=d.id?await updateDoc(HOTELS,d.id,{...(await getDoc(HOTELS,d.id)||{}),...d,updated_at:now()}):await createDoc(HOTELS,{...d,created_at:now(),updated_at:now()},id('hotel'));
  await syncShowGuidance(doc.tour_id,doc.show_id,doc.leg_index);
  return doc;
}
async function archiveTravelRecord(collection,idv){ const doc=await archiveDoc(collection,idv); await syncShowGuidance(doc.tour_id,doc.show_id,doc.leg_index); return doc; }
async function archiveDoc(c,idv){ const cur=await getDoc(c,idv); if(!cur) throw bad('Record not found',404); return updateDoc(c,idv,{...cur,deleted_at:now(),updated_at:now()}); }
function normalizeTravelLeg(x={}){
  return {id:x.id,tour_id:x.tour_id||'',show_id:x.show_id||'',leg_index:numOrNull(x.leg_index),leg_type:x.leg_type||x.mode||'drive',origin_name:x.origin_name||x.origin||'',origin_address:x.origin_address||'',destination_name:x.destination_name||x.destination||'',destination_address:x.destination_address||'',departure_datetime:x.departure_datetime||x.departure||'',arrival_datetime:x.arrival_datetime||x.arrival||'',duration_minutes:numOrNull(x.duration_minutes),static_duration_minutes:numOrNull(x.static_duration_minutes),traffic_delay_minutes:numOrNull(x.traffic_delay_minutes),distance_km:numOrNull(x.distance_km),provider:x.provider||'',route_number:x.route_number||'',booking_status:x.booking_status||'planned',price_amount:numOrNull(x.price_amount),price_currency:x.price_currency||'USD',booking_url:x.booking_url||'',confirmation_number:x.confirmation_number||'',confirmation_doc_url:x.confirmation_doc_url||'',passenger_count:numOrNull(x.passenger_count)||1,baggage_gear_notes:x.baggage_gear_notes||'',responsibility:x.responsibility||'agency',maps_route_url:x.maps_route_url||mapsRoute(x.origin_address||x.origin_name,x.destination_address||x.destination_name,x.leg_type||x.mode),notes:x.notes||'',risk_level:x.risk_level||'unknown'};
}
function normalizeHotel(x={}){
  return {id:x.id,tour_id:x.tour_id||'',show_id:x.show_id||'',leg_index:numOrNull(x.leg_index),hotel_name:x.hotel_name||x.name||'',address:x.address||'',check_in_datetime:x.check_in_datetime||x.check_in||'',check_out_datetime:x.check_out_datetime||x.check_out||'',nights:numOrNull(x.nights)||1,room_type:x.room_type||'',room_count:numOrNull(x.room_count)||1,guest_count:numOrNull(x.guest_count)||1,booking_status:x.booking_status||'needed',price_amount:numOrNull(x.price_amount),price_currency:x.price_currency||'USD',booking_url:x.booking_url||'',confirmation_number:x.confirmation_number||'',confirmation_doc_url:x.confirmation_doc_url||'',contact_phone:x.contact_phone||'',check_in_instructions:x.check_in_instructions||'',responsibility:x.responsibility||'agency',maps_url:x.maps_url||mapsSearch(x.address||x.hotel_name),notes:x.notes||''};
}
async function enrichTravelLeg(d){
  if((d.duration_minutes&&d.distance_km) || !(d.origin_name||d.origin_address) || !(d.destination_name||d.destination_address)) return d;
  try{ const r=await generateMapsRoute({origin:d.origin_address||d.origin_name,destination:d.destination_address||d.destination_name,mode:d.leg_type,departure_datetime:d.departure_datetime}); return {...d,duration_minutes:r.duration_minutes||d.duration_minutes,static_duration_minutes:r.static_duration_minutes||d.static_duration_minutes,traffic_delay_minutes:r.traffic_delay_minutes??d.traffic_delay_minutes,distance_km:r.distance_km||d.distance_km,maps_route_url:r.maps_url||d.maps_route_url,route_source:r.source||d.route_source,route_checked_at:r.route_checked_at||d.route_checked_at}; }catch{return d;}
}
async function generateMapsRoute(b={}){
  const key=process.env.GOOGLE_MAPS_API_KEY;
  const origin=b.origin||b.origin_name||''; const destination=b.destination||b.destination_name||''; const mode=String(b.mode||b.leg_type||'drive').toLowerCase();
  if(!origin||!destination) throw bad('origin and destination required',400);
  const fallback={origin,destination,mode,maps_url:mapsRoute(origin,destination,mode),source:'generated_link'};
  if(!key) return {...fallback,note:'GOOGLE_MAPS_API_KEY missing; returned map link only.'};
  if(mode.includes('train')||mode.includes('bus')||mode.includes('transit')){
    const dep=mapsDepartureParam(b.departure_datetime||b.departure_time||b.date);
    const url=`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${enc(origin)}&destinations=${enc(destination)}&mode=transit&departure_time=${dep}&key=${key}`;
    const res=await fetch(url); const j=await res.json();
    const el=j.rows?.[0]?.elements?.[0]; if(el?.status==='OK') return {...fallback,distance_km:Math.round((el.distance?.value||0)/100)/10,duration_minutes:Math.round((el.duration?.value||el.duration_in_traffic?.value||0)/60),source:'google_distance_matrix_transit',raw_status:el.status};
    return {...fallback,note:j.error_message||el?.status||'Transit timing unavailable'};
  }
  const travelMode=mode.includes('walk')?'WALK':(mode.includes('bike')?'BICYCLE':'DRIVE');
  const routeBody={origin:routeWaypoint(origin),destination:routeWaypoint(destination),travelMode};
  if(travelMode==='DRIVE') { routeBody.routingPreference='TRAFFIC_AWARE'; routeBody.departureTime=mapsDepartureIso(b.departure_datetime||b.departure_time||b.date); }
  const res=await fetch('https://routes.googleapis.com/directions/v2:computeRoutes',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline'},body:JSON.stringify(routeBody)});
  const j=await res.json(); const route=j.routes?.[0];
  if(route) { const dur=Math.round(parseDuration(route.duration)/60), stat=Math.round(parseDuration(route.staticDuration)/60); return {...fallback,distance_km:Math.round((route.distanceMeters||0)/100)/10,duration_minutes:dur,static_duration_minutes:stat||null,traffic_delay_minutes:(stat&&dur)?Math.max(0,dur-stat):null,polyline:route.polyline?.encodedPolyline||'',source:travelMode==='DRIVE'?'google_routes_traffic_aware':'google_routes',route_checked_at:now()}; }
  return {...fallback,note:j.error?.message||'Route timing unavailable'};
}
function parseDuration(v=''){ const m=String(v).match(/([0-9.]+)s/); return m?Number(m[1]):0; }
function mapsDepartureIso(v){ const d=v?new Date(v):new Date(); if(!Number.isFinite(d.getTime())||d<Date.now()) return new Date().toISOString(); return d.toISOString(); }
function mapsDepartureParam(v){ const d=v?new Date(v):null; if(d&&Number.isFinite(d.getTime())&&d>Date.now()) return Math.floor(d.getTime()/1000); return 'now'; }
function routeWaypoint(v){ const ll=parseLatLng(v); return ll?{location:{latLng:{latitude:ll.lat,longitude:ll.lng}}}:{address:v}; }
function parseLatLng(v){ const m=String(v||'').trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/); if(!m) return null; return {lat:Number(m[1]),lng:Number(m[2])}; }
function generateTourLinks(t={}){return {maps_start_end:mapsRoute(t.startCity||t.start_city||'',t.endCity||t.end_city||'', 'drive')}}

function getTravelProviderStatus(){
  return {
    traffic:{configured:!!process.env.GOOGLE_MAPS_API_KEY,provider:'Google Routes API',level:process.env.GOOGLE_MAPS_API_KEY?'live_traffic':'not_configured'},
    transit:{configured:!!process.env.GOOGLE_MAPS_API_KEY,provider:'Google Distance Matrix Transit',level:process.env.GOOGLE_MAPS_API_KEY?'estimated_transit_timing':'not_configured',note:'Estimated transit timing only, not carrier cancellation/platform/ticket status.'},
    flight_status:{configured:!!process.env.AVIATIONSTACK_API_KEY,provider:'Aviationstack',level:process.env.AVIATIONSTACK_API_KEY?'live_status':'not_configured',required_secret:'AVIATIONSTACK_API_KEY'},
    flight_search:{configured:!!(process.env.AMADEUS_CLIENT_ID&&process.env.AMADEUS_CLIENT_SECRET),provider:'Amadeus Self-Service',level:(process.env.AMADEUS_CLIENT_ID&&process.env.AMADEUS_CLIENT_SECRET)?'live_search':'not_configured',required_secrets:['AMADEUS_CLIENT_ID','AMADEUS_CLIENT_SECRET']},
    rail_live:{configured:!!process.env.DB_TRANSPORT_API_BASE || true,provider:'transport.rest / DB Hafas-compatible',level:'best_effort_public_provider',note:'No ticket inventory/PNR. Falls back gracefully if public endpoint is unavailable.'}
  };
}
async function lookupFlightStatus(b={}){
  const key=process.env.AVIATIONSTACK_API_KEY;
  const flight=(b.flight_iata||b.flight_number||b.route_number||'').replace(/\s+/g,'').toUpperCase();
  const date=(b.flight_date||b.date||b.departure_date||'').slice(0,10);
  if(!flight) throw bad('flight_iata / flight_number required',400);
  const fallback={provider:'Aviationstack',configured:!!key,flight_iata:flight,flight_date:date||null,source:'not_configured',links:{google:`https://www.google.com/search?q=${enc(flight+' flight status '+(date||''))}`,flightaware:`https://flightaware.com/live/flight/${enc(flight)}`}};
  if(!key) return {...fallback,note:'AVIATIONSTACK_API_KEY not configured; returned status links only.'};
  const url=`https://api.aviationstack.com/v1/flights?access_key=${enc(key)}&flight_iata=${enc(flight)}${date?`&flight_date=${enc(date)}`:''}`;
  const j=await fetchJson(url,9000).catch(e=>({error:{message:e.message}}));
  const f=(j.data||[])[0];
  if(!f) return {...fallback,source:'aviationstack',note:j.error?.message||'No matching live flight record found.'};
  return {provider:'Aviationstack',configured:true,source:'aviationstack',flight_iata:flight,status:f.flight_status||'',departure:{airport:f.departure?.airport,iata:f.departure?.iata,scheduled:f.departure?.scheduled,estimated:f.departure?.estimated,actual:f.departure?.actual,terminal:f.departure?.terminal,gate:f.departure?.gate,delay_minutes:f.departure?.delay},arrival:{airport:f.arrival?.airport,iata:f.arrival?.iata,scheduled:f.arrival?.scheduled,estimated:f.arrival?.estimated,actual:f.arrival?.actual,terminal:f.arrival?.terminal,gate:f.arrival?.gate,delay_minutes:f.arrival?.delay},airline:f.airline?.name,aircraft:f.aircraft?.registration,checked_at:now()};
}
async function searchFlightOffers(b={}){
  const idv=process.env.AMADEUS_CLIENT_ID, sec=process.env.AMADEUS_CLIENT_SECRET;
  const origin=(b.origin_iata||b.origin||'').toUpperCase(), dest=(b.destination_iata||b.destination||'').toUpperCase(), date=(b.departure_date||b.date||'').slice(0,10);
  if(!origin||!dest||!date) throw bad('origin_iata, destination_iata, and departure_date required',400);
  const fallback={provider:'Amadeus',configured:!!(idv&&sec),origin_iata:origin,destination_iata:dest,departure_date:date,source:'not_configured',links:{google_flights:`https://www.google.com/travel/flights?q=Flights%20from%20${enc(origin)}%20to%20${enc(dest)}%20on%20${enc(date)}`}};
  if(!idv||!sec) return {...fallback,note:'AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET not configured; returned flight search link only.'};
  const tok=await amadeusToken(idv,sec);
  const url=`https://test.api.amadeus.com/v2/shopping/flight-offers?originLocationCode=${enc(origin)}&destinationLocationCode=${enc(dest)}&departureDate=${enc(date)}&adults=${Number(b.adults||1)}&max=${Math.min(10,Number(b.max||5))}`;
  const j=await fetchJson(url,12000,{headers:{Authorization:`Bearer ${tok}`}});
  return {provider:'Amadeus',configured:true,source:'amadeus',origin_iata:origin,destination_iata:dest,departure_date:date,count:(j.data||[]).length,offers:(j.data||[]).map(o=>({id:o.id,price:o.price,validatingAirlineCodes:o.validatingAirlineCodes,itineraries:o.itineraries})).slice(0,Number(b.max||5)),checked_at:now()};
}
async function amadeusToken(idv,sec){
  const r=await fetch('https://test.api.amadeus.com/v1/security/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:idv,client_secret:sec})});
  const j=await r.json().catch(()=>({})); if(!r.ok) throw bad(j.error_description||j.error||'Amadeus auth failed',502); return j.access_token;
}
async function lookupTrainJourney(b={}){
  const origin=b.origin||b.origin_name||'', dest=b.destination||b.destination_name||'', dep=b.departure_datetime||b.departure||b.date||'';
  if(!origin||!dest) throw bad('origin and destination required',400);
  const providerBase=(process.env.DB_TRANSPORT_API_BASE||'https://v6.db.transport.rest').replace(/\/$/,'');
  const fallback={provider:'transport.rest',configured:true,source:'best_effort_public_provider',origin,destination:dest,departure_datetime:dep||null,links:{deutsche_bahn:`https://int.bahn.de/en/buchung/start?S=${enc(origin)}&Z=${enc(dest)}${dep?`&date=${enc(dep.slice(0,10))}`:''}`,rome2rio:`https://www.rome2rio.com/map/${enc(origin)}/${enc(dest)}`},note:'Best-effort public rail lookup only; not ticket inventory/PNR.'};
  try{
    const [ol,dl]=await Promise.all([fetchJson(`${providerBase}/locations?query=${enc(origin)}&results=1`,6000),fetchJson(`${providerBase}/locations?query=${enc(dest)}&results=1`,6000)]);
    const o=Array.isArray(ol)?ol[0]:null, d=Array.isArray(dl)?dl[0]:null; if(!o?.id||!d?.id) return {...fallback,note:'Could not resolve rail stations; returned booking links only.'};
    const url=`${providerBase}/journeys?from=${enc(o.id)}&to=${enc(d.id)}&results=${Math.min(5,Number(b.max||3))}${dep?`&departure=${enc(dep)}`:''}`;
    const j=await fetchJson(url,10000);
    const journeys=(j.journeys||[]).map(x=>({type:x.type,legs:(x.legs||[]).map(l=>({origin:l.origin?.name,destination:l.destination?.name,line:l.line?.name||l.line?.fahrtNr,departure:l.departure,plannedDeparture:l.plannedDeparture,departureDelay:l.departureDelay,arrival:l.arrival,plannedArrival:l.plannedArrival,arrivalDelay:l.arrivalDelay,direction:l.direction,platform:l.platform,plannedPlatform:l.plannedPlatform,mode:l.line?.mode||l.mode}))}));
    return {...fallback,source:'transport_rest',origin_station:o.name,destination_station:d.name,count:journeys.length,journeys,checked_at:now()};
  }catch(e){ return {...fallback,source:'provider_unavailable',provider_error:e.message}; }
}
async function fetchJson(url,timeoutMs=10000,opts={}){ const ac=new AbortController(); const t=setTimeout(()=>ac.abort(),timeoutMs); try{ const r=await fetch(url,{...opts,signal:ac.signal}); const txt=await r.text(); let j={}; try{j=JSON.parse(txt)}catch{throw new Error(`Non-JSON response ${r.status}`)} if(!r.ok) throw new Error(j.error?.message||j.message||`HTTP ${r.status}`); return j; } finally { clearTimeout(t); } }
function generateBookingLinks(b={}){
  const origin=b.origin||b.origin_name||''; const dest=b.destination||b.destination_name||b.city||''; const date=(b.date||b.departure_date||'').slice(0,10); const checkIn=(b.check_in||b.check_in_datetime||date||'').slice(0,10); const checkOut=(b.check_out||b.check_out_datetime||'').slice(0,10);
  return {google_maps:mapsRoute(origin,dest,b.mode||b.leg_type||'drive'),rome2rio:`https://www.rome2rio.com/map/${enc(origin)}/${enc(dest)}`,google_flights:`https://www.google.com/travel/flights?q=Flights%20from%20${enc(origin)}%20to%20${enc(dest)}%20on%20${enc(date)}`,booking_hotels:`https://www.booking.com/searchresults.html?ss=${enc(dest)}${checkIn?`&checkin=${enc(checkIn)}`:''}${checkOut?`&checkout=${enc(checkOut)}`:''}`,deutsche_bahn:`https://int.bahn.de/en/buchung/start?S=${enc(origin)}&Z=${enc(dest)}${date?`&date=${enc(date)}`:''}`,note:'Generated search links only — not live booking or live availability.'};
}
async function checkFeasibility({tour_id,show_id,leg_index}={}){
  const [legs,hotels]=await Promise.all([all(LEGS),all(HOTELS)]);
  let tlegs=legs.filter(x=>(tour_id&&!show_id?x.tour_id===tour_id:true) && (show_id?x.show_id===show_id:true) && (leg_index!=null?Number(x.leg_index)===Number(leg_index):true));
  let thotels=hotels.filter(x=>(tour_id&&!show_id?x.tour_id===tour_id:true) && (show_id?x.show_id===show_id:true) && (leg_index!=null?Number(x.leg_index)===Number(leg_index):true));
  return feasibilityForRecords(tlegs,thotels);
}
async function computeTravelBudget(tour_id){ if(!tour_id) throw bad('tour_id required',400); const [legs,hotels,budgets]=await Promise.all([all(LEGS),all(HOTELS),all(BUDGETS)]); return budgetFrom(legs.filter(x=>x.tour_id===tour_id),hotels.filter(x=>x.tour_id===tour_id),budgets.find(x=>x.tour_id===tour_id)||null); }
function budgetFrom(legs=[],hotels=[],budget=null){ const legTotal=sum(legs), hotelTotal=sum(hotels); const total=legTotal+hotelTotal; const ceiling=Number(budget?.total_budget_amount||0); return {currency:budget?.total_budget_currency||legs[0]?.price_currency||hotels[0]?.price_currency||'USD',legs_total:legTotal,hotels_total:hotelTotal,total,ceiling:ceiling||null,over_budget:!!ceiling&&total>ceiling,by_show:groupCost([...legs,...hotels])}; }
function sum(rows){return rows.reduce((n,x)=>n+(Number(x.price_amount)||0),0)}
function groupCost(rows){const out={}; rows.forEach(r=>{const k=r.show_id||`leg_${r.leg_index??'unassigned'}`; out[k]=(out[k]||0)+(Number(r.price_amount)||0)}); return out;}
function feasibilityForTour(tour,legs,hotels){return feasibilityForRecords(legs,hotels);}
function feasibilityForRecords(legs=[],hotels=[]){
  const flags=[]; const sorted=[...legs].sort((a,b)=>String(a.departure_datetime||'').localeCompare(String(b.departure_datetime||'')));
  sorted.forEach((l,i)=>{ if(l.departure_datetime&&l.arrival_datetime){ const dur=(new Date(l.arrival_datetime)-new Date(l.departure_datetime))/60000; if(Number.isFinite(dur)&&dur<0) flags.push({level:'critical',message:`${label(l)} arrives before it departs.`}); if(Number.isFinite(dur)&&dur>720) flags.push({level:'tight',message:`${label(l)} is a very long travel leg (${Math.round(dur/60)}h).`}); } const next=sorted[i+1]; if(next&&l.arrival_datetime&&next.departure_datetime){ const gap=(new Date(next.departure_datetime)-new Date(l.arrival_datetime))/60000; if(Number.isFinite(gap)&&gap<30) flags.push({level:'critical',message:`Connection between ${label(l)} and ${label(next)} is under 30 minutes.`}); else if(Number.isFinite(gap)&&gap<60) flags.push({level:'risky',message:`Connection between ${label(l)} and ${label(next)} is under 60 minutes.`}); }});
  hotels.forEach(h=>{ if(!h.hotel_name&&!h.address) flags.push({level:'tight',message:'Hotel stay exists but has no name/address.'}); if(String(h.booking_status||'').match(/needed|searched|selected/i)) flags.push({level:'tight',message:`Hotel for ${h.leg_index!=null?'stop '+(Number(h.leg_index)+1):'tour'} is not confirmed.`}); });
  return {risk_level:flags.some(f=>f.level==='critical')?'critical':flags.some(f=>f.level==='risky')?'risky':flags.some(f=>f.level==='tight')?'tight':'none',flags};
}
async function generateBandGuidance({show_id,device_location}={}){
  if(!show_id) throw bad('show_id required',400); const show=await getDoc(SHOWS,show_id); if(!show) throw bad('Show not found',404);
  const [legs,hotels]=await Promise.all([all(LEGS),all(HOTELS)]);
  const tlegs=legs.filter(x=>x.show_id===show_id || (x.tour_id===show.tour_id&&Number(x.leg_index)===Number(show.leg_index))).sort((a,b)=>String(a.departure_datetime||'').localeCompare(String(b.departure_datetime||'')));
  const thotels=hotels.filter(x=>x.show_id===show_id || (x.tour_id===show.tour_id&&Number(x.leg_index)===Number(show.leg_index)));
  const cards=[]; tlegs.forEach(l=>cards.push({type:'travel',title:`${humanMode(l.leg_type)} to ${l.destination_name||show.city||'next stop'}`,origin_name:l.origin_name,origin_address:l.origin_address,destination_name:l.destination_name,destination_address:l.destination_address,leave_by:l.departure_datetime||computedLeaveBy(l),arrive_by:l.arrival_datetime,mode:l.leg_type,provider:l.provider,route_number:l.route_number,duration_minutes:l.duration_minutes,distance_km:l.distance_km,maps_url:l.maps_route_url||mapsRoute(l.origin_address||l.origin_name,l.destination_address||l.destination_name,l.leg_type),notes:l.baggage_gear_notes||l.notes||'',fallback:'If this fails, call the tour manager / agency contact immediately.'}));
  thotels.forEach(h=>cards.push({type:'hotel',title:h.hotel_name||'Hotel',check_in:h.check_in_datetime,check_out:h.check_out_datetime,address:h.address,maps_url:h.maps_url||mapsSearch(h.address||h.hotel_name),confirmation:h.confirmation_number?'Saved in agency system':'',notes:h.check_in_instructions||h.notes||''}));
  const guidance={show_id,venue:show.venue_name,city:show.city,country:show.country,date:show.date,next_move:cards[0]||null,cards,emergency:'If anything changes or you miss a connection, message/call the agency immediately.',device_location_used:!!device_location};
  if(device_location && guidance.next_move) await addLocationGuidance(guidance.next_move, device_location);
  return guidance;
}
async function addLocationGuidance(card, loc){
  const lat=loc.lat ?? loc.latitude, lng=loc.lng ?? loc.longitude;
  if(!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return card;
  const origin=`${lat},${lng}`;
  const target = card.origin_address || card.origin_name || card.destination_address || card.destination_name;
  if(!target) return card;
  const targetTime = card.leave_by || card.arrive_by || '';
  const route = await generateMapsRoute({origin,destination:target,mode:'drive'}).catch(()=>null);
  if(!route) return card;
  const leaveNowBy = targetTime && route.duration_minutes ? new Date(new Date(targetTime).getTime() - Number(route.duration_minutes)*60000).toISOString() : '';
  card.location_guidance={target,target_time:targetTime,duration_minutes:route.duration_minutes,distance_km:route.distance_km,maps_url:route.maps_url,leave_by:leaveNowBy,source:route.source||'maps'};
  return card;
}
async function syncTourBandGuidance(tour_id){
  if(!tour_id) throw bad('tour_id required',400);
  const shows=(await all(SHOWS)).filter(s=>s.tour_id===tour_id&&!s.deleted_at);
  let updated=0;
  for(const s of shows){ await syncShowGuidance(tour_id,s.id,s.leg_index); updated++; }
  return {tour_id,updated};
}
async function syncShowGuidance(tour_id,show_id,leg_index){
  let show=show_id?await getDoc(SHOWS,show_id):null;
  if(!show&&tour_id&&leg_index!=null){ const shows=(await all(SHOWS)).filter(s=>s.tour_id===tour_id&&Number(s.leg_index)===Number(leg_index)); show=shows[0]||null; }
  if(!show) return null;
  const guidance=await generateBandGuidance({show_id:show.id}).catch(()=>null);
  if(!guidance) return null;
  return updateDoc(SHOWS,show.id,{...show,band_travel_guidance:guidance,updated_at:now()});
}
function computedLeaveBy(l={}){ if(!l.arrival_datetime||!l.duration_minutes) return ''; const t=new Date(l.arrival_datetime).getTime()-Number(l.duration_minutes)*60000; return Number.isFinite(t)?new Date(t).toISOString():''; }
function mapsRoute(a,b,mode='drive'){ if(!a&&!b) return ''; return `https://www.google.com/maps/dir/?api=1&origin=${enc(a)}&destination=${enc(b)}&travelmode=${mapMode(mode)}`; }
function mapsSearch(q){return q?`https://maps.google.com/?q=${enc(q)}`:''}
function mapMode(m){m=String(m||'').toLowerCase(); if(m.includes('walk'))return'walking'; if(m.includes('transit')||m.includes('train')||m.includes('bus'))return'transit'; return'driving';}
function enc(v){return encodeURIComponent(String(v||'').trim())}
function humanMode(m){return String(m||'travel').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}
function label(l){return `${humanMode(l.leg_type)} ${l.origin_name||''}→${l.destination_name||''}`}
function numOrNull(v){const n=Number(v); return Number.isFinite(n)?n:null;}
function bad(message,status=400){const e=new Error(message); e.status=status; return e;}

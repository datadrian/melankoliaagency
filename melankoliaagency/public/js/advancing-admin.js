/* Melankolia Internal Ops — Advancing + Band Access + Email Generator */
const ADV_API = '/.netlify/functions/advancing-api';
const EMAIL_API = '/.netlify/functions/email-generator';
let _advShows = [], _advBands = [], _advTours = [], _advNotifs = [];

const advEsc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const advAttr = v => advEsc(v).replace(/`/g,'&#96;');
async function advApi(body){
  try{ const r = await fetch(ADV_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})}); return await r.json(); }
  catch(e){ return {success:false,error:e.message}; }
}
async function emailApi(data){
  const r = await fetch(EMAIL_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({emailType:'booking_inquiry',data})});
  const j = await r.json(); if(!r.ok || j.success===false) throw new Error(j.error || 'Email generation failed'); return j.data || j;
}
function opsToast(msg,type='success'){ return typeof showToast==='function' ? showToast(msg,type) : alert(msg); }
function opsLoading(text='Loading…'){ return `<div class="ops-loading"><span></span>${advEsc(text)}</div>`; }
function opsError(title,msg){ return `<div class="ops-error"><strong>${advEsc(title)}</strong><br>${advEsc(msg||'')}</div>`; }

function opsSlug(v){ return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
function opsArtistContext(name){
  try{ if(window.MelankoliaArtistContextLookup) return window.MelankoliaArtistContextLookup(name); }catch(e){}
  const q=String(name||'').trim(); if(!q) return null;
  const src=(typeof getArtists==='function'?getArtists():(window.MELANKOLIA_DATA?.artists||[]))||[];
  const qs=opsSlug(q), qn=q.toLowerCase();
  const a=src.find(x=>opsSlug(x.slug||x.name)===qs || String(x.name||'').toLowerCase()===qn)
    || src.find(x=>String(x.name||'').toLowerCase().includes(qn) || qn.includes(String(x.name||'').toLowerCase())) || null;
  if(!a) return null;
  const social=a.social_links||a.socials||{};
  const videos=[...(a.music_videos||[]), ...(a.videos||[])].filter(Boolean);
  return {slug:a.slug||opsSlug(a.name), name:a.name||q, genres:a.genres||'', location:a.location||'', shortBio:a.shortBio||'', bio:a.bio||'', press:a.press||[], quotes:a.quotes||[], discography:a.discography||[], social_links:social, videos, epkUrl:a.slug?`https://melankoliaagency.com/epk/${a.slug}`:'https://melankoliaagency.com/epk/'+opsSlug(a.name||q), profileUrl:a.slug?`https://melankoliaagency.com/artists/${a.slug}`:''};
}
async function loadOpsData(){
  const [dash,bands,tours] = await Promise.all([advApi({action:'agency_get_dashboard'}),advApi({action:'agency_list_bands'}),advApi({action:'agency_list_tours'})]);
  if(!dash.success) throw new Error(dash.error || 'Advancing API unavailable');
  _advShows = dash.data?.shows || [];
  _advNotifs = dash.data?.notifications || [];
  _advBands = bands.success ? bands.data || [] : [];
  _advTours = tours.success ? tours.data || [] : [];
  return dash.data?.counts || {};
}

async function initAdvancing(){
  const el = document.getElementById('advancingAdminShell') || document.getElementById('view-advancing'); if(!el) return;
  el.innerHTML = opsLoading('Loading advancing center…');
  try{ const counts = await loadOpsData(); renderAdvancing(el, counts); }
  catch(e){ el.innerHTML = opsError('Advancing unavailable', e.message); }
}
function renderAdvancing(el, counts={}){
  const pending = _advShows.filter(s=>['pending_review','pending_promoter'].includes(s.status));
  el.innerHTML = `<section class="ops-shell">
    <div class="ops-topbar"><div><p class="route-kicker">Advancing Center</p><h1>Show logistics + promoter sheets</h1><span>Route Planner saves draft shows here. Promote each show through promoter info, approval, publishing, and band app visibility.</span></div><div class="ops-actions"><button class="btn-secondary" onclick="initAdvancing()">Refresh</button><button class="btn-primary" onclick="opsCreateShow()">New Show</button></div></div>
    <div class="ops-stat-grid">${opsStat('Draft',counts.draft||0)}${opsStat('Awaiting Promoter',counts.pending_promoter||0)}${opsStat('Pending Review',counts.pending_review||0)}${opsStat('Approved',counts.approved||0)}${opsStat('Published',counts.published||0)}</div>
    ${pending.length?`<div class="ops-panel"><div class="ops-panel-title"><span>Needs attention</span><em>Promoter submissions and shows waiting on review.</em></div><div class="ops-list">${pending.map(showRow).join('')}</div></div>`:''}
    <div class="ops-panel"><div class="ops-panel-title"><span>All advancing shows</span><em>${_advShows.length} show records linked from route planning and manual entries.</em></div>${_advShows.length?`<div class="ops-table">${_advShows.map(showRow).join('')}</div>`:'<div class="ops-empty">No show records yet. Save a route from Route Planner or create one manually.</div>'}</div>
  </section>`;
}
function opsStat(label,count){ return `<div class="ops-stat"><strong>${advEsc(count)}</strong><span>${advEsc(label)}</span></div>`; }
function showRow(s){
  const bandNames = (s.band_ids||[]).map(id=>_advBands.find(b=>b.id===id)?.name).filter(Boolean).join(', ');
  return `<article class="ops-row" onclick="opsOpenShow('${advAttr(s.id)}')"><div><strong>${advEsc(s.venue_name||s.city||'Untitled Show')}</strong><span>${advEsc([s.date,[s.city,s.country].filter(Boolean).join(', '),bandNames].filter(Boolean).join(' · '))}</span></div><em>${advEsc((s.status||'draft').replace(/_/g,' '))}</em><button onclick="event.stopPropagation();opsEmailForShow('${advAttr(s.id)}')">Email</button></article>`;
}
function reqDefaults(r={}){ return { contacts:true, venue:true, schedule:true, technical:true, backline:true, guest_list:true, merch:true, hotel:true, transportation:true, settlement:true, hospitality:true, wifi:true, notes:true, ...r }; }
function reqToggleHtml(req){
  const labels={contacts:'Contacts',venue:'Venue details',schedule:'Schedule',technical:'Sound/technical',backline:'Backline',guest_list:'Guest list',merch:'Merch',hotel:'Hotel/lodging',transportation:'Transportation',settlement:'Settlement',hospitality:'Hospitality/catering',wifi:'Wi‑Fi',notes:'Additional notes'};
  const r=reqDefaults(req);
  return `<div class="ops-toggle-grid">${Object.entries(labels).map(([k,label])=>`<label><input type="checkbox" data-adv-req="${k}" ${r[k]?'checked':''}> ${label}</label>`).join('')}</div>`;
}
async function opsSaveReq(id){
  const req={}; document.querySelectorAll('[data-adv-req]').forEach(cb=>req[cb.dataset.advReq]=!!cb.checked);
  const r=await advApi({action:'agency_update_show',show_id:id,updates:{advancing_requirements:req}});
  if(r.success){ opsToast('✓ Promoter form toggles saved to Firestore'); opsOpenShow(id); } else opsToast(r.error||'Could not save toggles','error');
}
async function opsSetShowLinked(id, updates){
  const r=await advApi({action:'agency_update_show',show_id:id,updates});
  if(r.success){ opsToast('✓ Show updated and synced to route'); opsOpenShow(id); } else opsToast(r.error||'Could not update show','error');
}
async function opsOpenShow(id){
  const el = document.getElementById('advancingAdminShell') || document.getElementById('view-advancing'); if(!el) return;
  el.innerHTML = opsLoading('Opening show…');
  const res = await advApi({action:'agency_get_show',show_id:id});
  if(!res.success) return el.innerHTML = opsError('Could not open show', res.error);
  const s=res.data, bandNames=(s.band_ids||[]).map(id=>_advBands.find(b=>b.id===id)?.name).filter(Boolean).join(', ');
  el.innerHTML = `<section class="ops-shell"><div class="ops-topbar"><button class="btn-secondary btn-sm" onclick="initAdvancing()">← Advancing</button><div><p class="route-kicker">${advEsc(s.status||'draft')}</p><h1>${advEsc(s.venue_name||s.city||'Show')}</h1><span>${advEsc([s.date,[s.city,s.country].filter(Boolean).join(', '),bandNames].filter(Boolean).join(' · '))}</span></div><div class="ops-actions"><button class="btn-secondary" onclick="opsEmailForShow('${advAttr(s.id)}')">Generate Email</button><button class="btn-secondary" onclick="opsApproveShow('${advAttr(s.id)}')">Approve</button><button class="btn-primary" onclick="opsPublishShow('${advAttr(s.id)}')">Publish to Band App</button></div></div>
    <div class="ops-detail-grid"><div class="ops-panel"><div class="ops-panel-title"><span>Promoter link</span><em>Send this to promoter for advancing info.</em></div><input class="form-input" readonly value="${advAttr(s.promoter_url||'')}"><div class="ops-actions"><button class="btn-secondary" onclick="navigator.clipboard.writeText('${advAttr(s.promoter_url||'')}');opsToast('Promoter link copied')">Copy Link</button><a class="btn-secondary" target="_blank" href="${advAttr(s.promoter_url||'#')}">Open Form</a></div></div>
    <div class="ops-panel"><div class="ops-panel-title"><span>Promoter form toggles</span><em>Select exactly what the custom link should ask this venue/promoter to answer.</em></div>${reqToggleHtml(s.advancing_requirements)}<div class="ops-actions"><button class="btn-primary" onclick="opsSaveReq('${advAttr(s.id)}')">Save Form Toggles</button></div></div>
    <div class="ops-panel"><div class="ops-panel-title"><span>Travel / hotel / gear snapshot</span><em>Factors back into Route Planner and publishes to Band App after approval.</em></div><div class="ops-mini-grid"><div><b>Travel</b><span>${advEsc(s.travel_mode_recommendation||s.transport?.mode||'TBD')}</span></div><div><b>Hotel</b><span>${advEsc(s.hotel_responsibility||s.lodging?.responsibility||'TBD')}</span></div><div><b>Transfer</b><span>${s.airport_transfer_required?'Airport transfer needed':'No airport transfer marked'}</span></div><div><b>Backline</b><span>${advEsc(s.backline_needed||'TBD')}</span></div></div><div class="ops-actions"><button class="btn-secondary" onclick="opsSetShowLinked('${advAttr(s.id)}',{hotel_required:true,hotel_responsibility:'promoter'})">Promoter covers hotel</button><button class="btn-secondary" onclick="opsSetShowLinked('${advAttr(s.id)}',{airport_transfer_required:true,transport_responsibility:'promoter'})">Promoter handles airport transfer</button><button class="btn-secondary" onclick="opsSetShowLinked('${advAttr(s.id)}',{backline_needed:'full'})">Full backline needed</button></div></div>
    <div class="ops-panel"><div class="ops-panel-title"><span>Show data</span><em>Raw linked Firestore record.</em></div><pre>${advEsc(JSON.stringify(s,null,2))}</pre></div></div></section>`;
}
async function opsApproveShow(id){ const r=await advApi({action:'agency_approve_sheet',show_id:id,reviewed_by:'agency'}); if(r.success){opsToast('✓ Show approved'); opsOpenShow(id);} else opsToast(r.error||'Approve failed','error'); }
async function opsPublishShow(id){ const r=await advApi({action:'agency_publish_sheet',show_id:id}); if(r.success){opsToast('✓ Published to band app'); opsOpenShow(id);} else opsToast(r.error||'Publish failed','error'); }
async function opsCreateShow(){
  const venue = prompt('Venue name?'); if(!venue) return;
  const city = prompt('City?') || '';
  const date = prompt('Date? YYYY-MM-DD') || '';
  const bandId = (_advBands[0]?.id) || '';
  const r = await advApi({action:'agency_create_show',venue_name:venue,city,date,band_ids:bandId?[bandId]:[],status:'draft'});
  if(r.success){ opsToast('✓ Show created'); initAdvancing(); } else opsToast(r.error||'Create show failed','error');
}

async function initBandAccess(){
  const el = document.getElementById('bandAdminShell') || document.getElementById('view-bands'); if(!el) return;
  el.innerHTML = opsLoading('Loading band access…');
  try{ await loadOpsData(); renderBandAccess(el); }
  catch(e){ el.innerHTML = opsError('Band access unavailable', e.message); }
}
function renderBandAccess(el){
  el.innerHTML = `<section class="ops-shell"><div class="ops-topbar"><div><p class="route-kicker">Band App + Users</p><h1>Band portal access management</h1><span>Create band logins, reset passwords, archive access, and open the band app portal. Published advancing sheets become visible here.</span></div><div class="ops-actions"><a class="btn-secondary" target="_blank" href="/band-app/">Open Band App</a><button class="btn-primary" onclick="opsCreateBand()">Add Band/User</button></div></div>
  <div class="ops-panel"><div class="ops-panel-title"><span>Band users</span><em>${_advBands.length} active band portal accounts.</em></div>${_advBands.length?`<div class="ops-band-grid">${_advBands.map(bandCard).join('')}</div>`:'<div class="ops-empty">No band users yet.</div>'}</div>
  <div class="ops-panel"><div class="ops-panel-title"><span>How this links together</span><em>Route Planner → Advancing → Band App.</em></div><div class="ops-flow"><div>Route Planner saves shows</div><div>Advancing reviews + publishes</div><div>Band App shows approved/published sheets</div></div></div></section>`;
}
function bandCard(b){ return `<article class="ops-band-card"><strong>${advEsc(b.name)}</strong><span>@${advEsc(b.username||'')}</span><small>${advEsc((b.contacts||[]).map(c=>c.email).filter(Boolean).join(', ')||'No contact email')}</small><div class="ops-actions"><button class="btn-secondary btn-sm" onclick="opsResetBandPassword('${advAttr(b.id)}','${advAttr(b.name)}')">Reset Password</button><button class="btn-danger btn-sm" onclick="opsArchiveBand('${advAttr(b.id)}')">Archive</button></div></article>`; }
async function opsCreateBand(){
  const name=prompt('Band/user name?'); if(!name) return;
  const username=prompt('Login username?', name.toLowerCase().replace(/[^a-z0-9]+/g,'-')) || '';
  const password=prompt('Temporary password?', Math.random().toString(36).slice(2,10)) || '';
  const email=prompt('Contact email?') || '';
  const r=await advApi({action:'agency_create_band',name,username,password,contacts:email?[{email}]:[]});
  if(r.success){ opsToast('✓ Band user created'); alert(`Band App login\nUsername: ${username}\nPassword: ${password}`); initBandAccess(); } else opsToast(r.error||'Create band failed','error');
}
async function opsResetBandPassword(id,name){ const pw=prompt(`New password for ${name}:`, Math.random().toString(36).slice(2,10)); if(!pw) return; const r=await advApi({action:'agency_update_band_password',band_id:id,new_password:pw}); if(r.success){ opsToast('✓ Password reset'); alert(`New password for ${name}: ${pw}`); } else opsToast(r.error||'Reset failed','error'); }
async function opsArchiveBand(id){ if(!confirm('Archive this band/user login?')) return; const r=await advApi({action:'agency_archive_band',band_id:id}); if(r.success){ opsToast('✓ Band/user archived'); initBandAccess(); } else opsToast(r.error||'Archive failed','error'); }

function initEmailGenerator(){
  const el=document.getElementById('emailAdminShell') || document.getElementById('view-emails'); if(!el) return;
  const artists=(typeof getArtists==='function'?getArtists():[]).map(a=>a.name).filter(Boolean);
  el.innerHTML=`<section class="ops-shell"><div class="ops-topbar"><div><p class="route-kicker">Email Generator</p><h1>Branded venue outreach</h1><span>Generate standalone pitch emails, or use the Email buttons inside Route Planner/Advancing for contextual venue outreach.</span></div></div><div class="ops-detail-grid"><form class="ops-panel" onsubmit="opsGenerateStandaloneEmail(event)"><div class="ops-panel-title"><span>Pitch details</span><em>Used by the same generator as Route Planner.</em></div><label>Artist<select id="emailArtist" class="form-input"><option value="">Select artist…</option>${artists.map(a=>`<option>${advEsc(a)}</option>`).join('')}</select></label><label>Venue<input id="emailVenue" class="form-input" placeholder="Venue name"></label><label>City<input id="emailCity" class="form-input" placeholder="Berlin"></label><label>Date<input id="emailDate" class="form-input" placeholder="2026-10-16"></label><label>Deal / Ask<input id="emailDeal" class="form-input" placeholder="€800 guarantee / best-of door"></label><label>Notes<textarea id="emailNotes" class="form-input form-textarea" rows="4" placeholder="Routing context, capacity, local scene notes…"></textarea></label><button class="btn-primary" type="submit">Generate Email</button></form><div class="ops-panel"><div class="ops-panel-title"><span>Generated email</span><em>Subject, plain text, and HTML.</em></div><div id="emailOutput" class="ops-empty">Fill the form and generate.</div></div></div></section>`;
}
async function opsGenerateStandaloneEmail(e){ e.preventDefault(); const out=document.getElementById('emailOutput'); const artist=document.getElementById('emailArtist').value; out.innerHTML=opsLoading('Generating branded email…'); try{ const email=await emailApi({artist,artistContext:opsArtistContext(artist),venue:document.getElementById('emailVenue').value,city:document.getElementById('emailCity').value,date:document.getElementById('emailDate').value,deal:document.getElementById('emailDeal').value,notes:document.getElementById('emailNotes').value}); out.innerHTML=emailOutput(email); }catch(err){ out.innerHTML=opsError('Email failed',err.message); } }
async function opsEmailForShow(id){ const s=_advShows.find(x=>x.id===id) || (await advApi({action:'agency_get_show',show_id:id})).data; const artist=(s.band_ids||[]).map(id=>_advBands.find(b=>b.id===id)?.name).filter(Boolean)[0] || s.artist || 'Artist'; const out=document.getElementById('routeAiOutput')||document.getElementById('routeToolOutput')||document.getElementById('advancingAdminShell')||document.getElementById('emailOutput'); if(out) out.innerHTML=opsLoading('Generating branded email…'); try{ const email=await emailApi({artist,artistContext:opsArtistContext(artist),venue:s.venue_name,city:s.city,country:s.country,date:s.date,deal:s.deal_suggestion||s.deal||'',notes:s.notes||s.advancing_notes||''}); if(out) out.innerHTML=`<div class="ops-panel">${emailOutput(email)}</div>`; opsToast('✓ Email generated'); }catch(err){ if(out) out.innerHTML=opsError('Email failed',err.message); } }
function selectRenderedEmailBox(id){ const el=document.getElementById(id); if(!el) return; const r=document.createRange(); r.selectNodeContents(el); const s=window.getSelection(); s.removeAllRanges(); s.addRange(r); el.focus(); }
if(typeof window!=='undefined') window.selectRenderedEmailBox=window.selectRenderedEmailBox||selectRenderedEmailBox;
function renderedEmailHtml(html){ const m=String(html||'').match(/<body[^>]*>([\s\S]*?)<\/body>/i); return m?m[1]:String(html||''); }
function emailOutput(email){ const id='renderedEmail_'+Date.now()+'_'+Math.random().toString(36).slice(2,7); const html=email.html||''; return `<label>Subject<input class="form-input" value="${advAttr(email.subject||'')}"></label><label>Plain text<textarea class="form-input form-textarea" rows="8">${advEsc(email.text||'')}</textarea></label><div class="ops-panel-title" style="margin-top:18px"><span>Rendered Gmail-ready email</span><em>Click Select, copy, then paste into Gmail compose.</em></div><div class="email-render-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 12px"><button type="button" class="btn-primary" onclick="selectRenderedEmailBox('${id}')">Select Rendered Email</button></div><div id="${id}" class="email-render-box" contenteditable="true" style="background:#050505;border:1px solid #333;max-height:520px;overflow:auto;padding:0;user-select:text;-webkit-user-select:text">${renderedEmailHtml(html)}</div><details style="margin-top:14px"><summary>Raw HTML source fallback</summary><textarea class="form-input form-textarea" rows="10">${advEsc(html)}</textarea></details>`; }

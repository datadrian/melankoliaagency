/* Melankolia Route Planner — Operations Dashboard UX v2 */
(function(){
  'use strict';

  const ROUTE_API = '/.netlify/functions/route-planner-api';
  const ROUTE_AI = '/.netlify/functions/ai-tour';
  const MAPS_CONFIG = '/.netlify/functions/maps-config';
  const MAPS_PROXY = '/.netlify/functions/maps-proxy';
  const EMAIL_API = '/.netlify/functions/email-generator';
  const VENUE_FINDER_API = '/.netlify/functions/geminiSearch';
  const BACKLINE_API = '/.netlify/functions/backline-search';
  const TRAVEL_API = '/.netlify/functions/travel-logistics';
  const RAG_VENUES_API = '/.netlify/functions/rag-venues';

  let tours = [];
  let currentTour = null;
  let currentShows = [];
  let currentGenerated = null;
  let activeLibraryFilter = 'active';
  let map = null;
  let mapReady = false;
  let mapMarkers = [];
  let mapLines = [];
  let lastAssistantPatch = null;
  const USD_TO_EUR = 0.92;
  let routeCurrency = 'USD';
  try { routeCurrency = (localStorage.getItem('mk_route_currency') || 'USD').toUpperCase()==='EUR' ? 'EUR' : 'USD'; } catch {}

  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const attr = v => esc(v).replace(/`/g,'&#96;');
  const val = id => ($(id)?.value || '').trim();
  const num = id => Number(val(id) || 0);
  const clamp = (n,min,max) => Math.max(min, Math.min(max, Number(n)||min));
  const todayISO = () => new Date().toISOString().slice(0,10);
  const plusDaysISO = d => { const x = new Date(); x.setDate(x.getDate()+d); return x.toISOString().slice(0,10); };
  const addDaysISO = (iso, days=1) => { const x = iso ? new Date(String(iso).slice(0,10)+'T12:00:00') : new Date(); if(isNaN(x)) return ''; x.setDate(x.getDate()+Number(days||0)); return x.toISOString().slice(0,10); };
  const toast = (msg,type='success') => typeof showToast === 'function' ? showToast(msg,type) : alert(msg);

  async function post(url,payload){
    const res = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload||{})});
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : {}; }
    catch(e){ const snippet=text.slice(0,220).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(); throw new Error(`Non-JSON response from ${url.split('/').pop()} (${res.status}). ${snippet || 'The function likely timed out before returning JSON.'}`); }
    if(!res.ok || json.success===false) throw new Error(json.error || `Request failed (${res.status})`);
    return json.data ?? json;
  }
  const api = payload => post(ROUTE_API,payload);
  const ai = (action,data) => post(ROUTE_AI,{action,data});

  function loading(text){ return `<div class="route-loading"><span></span>${esc(text)}</div>`; }
  function errorBox(title,msg){ return `<div class="route-error"><strong>${esc(title)}</strong><br>${esc(msg)}</div>`; }
  function normalizeDateRange(t){ return [t.startDate||t.start_date,t.endDate||t.end_date].filter(Boolean).join(' → ') || 'Dates TBD'; }
  function visibleTours(){
    const term = ($('routeSearch')?.value || '').toLowerCase().trim();
    return tours.filter(t=>{
      const archived = t.deleted_at || t.status === 'archived';
      if(activeLibraryFilter==='active' && archived) return false;
      if(activeLibraryFilter==='archived' && !archived) return false;
      if(!term) return true;
      return [t.name,t.tour_name,t.artist,t.region,t.summary,t.routing_strategy].join(' ').toLowerCase().includes(term);
    });
  }

  async function initRoutePlannerAdmin(){
    const root = $('routeAdminShell');
    if(!root) return;
    root.innerHTML = loading('Loading route operations…');
    try{
      tours = await api({action:'listTours'});
      renderHub();
    } catch(e){ root.innerHTML = errorBox('Route Planner backend unavailable', e.message); }
  }

  function renderHub(){
    const root = $('routeAdminShell');
    const active = tours.filter(t=>!t.deleted_at && t.status!=='archived');
    const archived = tours.filter(t=>t.deleted_at || t.status==='archived');
    const allLegs = tours.flatMap(t=>Array.isArray(t.legs)?t.legs:[]);
    const showCount = allLegs.filter(l=>!l.day_off).length;
    root.innerHTML = `
      <section class="route-ops-shell">
        <aside class="route-library-panel">
          <div class="route-mini-brand"><img src="/images/logo-mark-white.svg" alt=""><div><b>Melankolia</b><span>Route Operations</span></div></div>
          <button type="button" class="btn-primary route-full-btn" onclick="RouteAdmin.renderBuilder()">Create New Tour Plan</button>
          <div class="route-library-tools">
            <input id="routeSearch" class="form-input" placeholder="Search tours, artists, regions…" oninput="RouteAdmin.refreshLibraryList()">
            <div class="route-filter-row">
              <button type="button" class="route-filter active" data-filter="active" onclick="RouteAdmin.setFilter('active')">Active</button>
              <button type="button" class="route-filter" data-filter="all" onclick="RouteAdmin.setFilter('all')">All</button>
              <button type="button" class="route-filter" data-filter="archived" onclick="RouteAdmin.setFilter('archived')">Archived</button>
            </div>
          </div>
          <div class="route-list-head"><span>Tours</span><button type="button" onclick="RouteAdmin.init()">Refresh</button></div>
          <div id="routeLibraryList" class="route-library-list"></div>
        </aside>
        <main class="route-ops-main">
          <div class="route-command-bar">
            <div>
              <p class="route-kicker">AI-powered touring system</p>
              <h1>Tour Route Planner</h1>
              <p>Map-first routing, anchor analysis, budget logic, venue discovery, branded outreach, and advancing handoff.</p>
            </div>
            <div class="route-command-actions">
              <button type="button" class="btn-secondary" onclick="RouteAdmin.systemTour()">How it works</button>
              <button type="button" class="btn-primary" onclick="RouteAdmin.renderBuilder()">New Plan</button>
            </div>
          </div>
          <div class="route-dashboard-grid">
            <div class="route-stat"><strong>${active.length}</strong><span>Active drafts</span></div>
            <div class="route-stat"><strong>${showCount}</strong><span>Generated shows</span></div>
            <div class="route-stat"><strong>${archived.length}</strong><span>Archived routes</span></div>
            <div class="route-stat"><strong>7</strong><span>AI actions wired</span></div>
          </div>
          <div class="route-overview-grid">
            <section class="route-map-card route-map-card-large">
              <div class="route-panel-title"><span>Planning map</span><em>Starts on your continent, then plots generated/saved legs</em></div>
              <div id="routeMap" class="route-map route-map-home"><div class="route-map-placeholder">Loading operations map…</div></div>
            </section>
            <section class="route-ai-board">
              <div class="route-panel-title"><span>AI command center</span><em>What this system can do</em></div>
              ${aiCapabilityCards()}
            </section>
          </div>
          <section class="route-workflow-panel">
            <div class="route-panel-title"><span>Recommended workflow</span><em>Built for repeated planning sessions</em></div>
            <div class="route-workflow-steps">
              <div><b>01</b><strong>Start with anchors</strong><span>Confirmed festivals, high-value weekends, or must-hit cities.</span></div>
              <div><b>02</b><strong>Generate route</strong><span>Gemini builds realistic legs around drive limits and scene markets.</span></div>
              <div><b>03</b><strong>Iterate with AI</strong><span>Analyze gaps, optimize order, estimate budget, find venues, draft emails.</span></div>
              <div><b>04</b><strong>Save + advance</strong><span>Save creates the tour and individual show records for advancing.</span></div>
            </div>
          </section>
        </main>
      </section>`;
    refreshLibraryList();
    renderStarterMap();
  }

  function aiCapabilityCards(){
    const cards = [
      ['Generate Tour','Build a full day-by-day itinerary from artist, region, dates, and anchors.'],
      ['Analyze Anchors','Find routing gaps, weak placements, missing markets, and dead-day opportunities.'],
      ['Optimize Route','Reorder generated or saved legs for drive efficiency and lower cost.'],
      ['Budget Estimate','Calculate projected revenue, expenses, break-even, and viability.'],
      ['Contact Suggestions','Find genre-specific underground rooms by city and capacity.'],
      ['Deal Advisor','Evaluate guarantees, door splits, counters, and walk-away points.'],
      ['Branded Email','Generate polished venue outreach HTML for selected stops.']
    ];
    return `<div class="route-ai-card-grid">${cards.map(c=>`<div class="route-ai-card"><strong>${esc(c[0])}</strong><span>${esc(c[1])}</span></div>`).join('')}</div>`;
  }

  function setFilter(filter){ activeLibraryFilter = filter; document.querySelectorAll('.route-filter').forEach(b=>b.classList.toggle('active', b.dataset.filter===filter)); refreshLibraryList(); }
  function refreshLibraryList(){
    const el = $('routeLibraryList'); if(!el) return;
    const list = visibleTours();
    el.innerHTML = list.length ? list.map(tourListItem).join('') : `<div class="route-library-empty">No ${activeLibraryFilter==='all'?'':activeLibraryFilter} tours yet. Create a new plan to start.</div>`;
  }
  function tourListItem(t){
    const legs = Array.isArray(t.legs)?t.legs:[];
    const shows = legs.filter(l=>!l.day_off).length || t.total_shows || 0;
    return `<article class="route-list-item" onclick="RouteAdmin.openTour('${attr(t.id)}')">
      <div><strong>${esc(t.name||t.tour_name||'Untitled Tour')}</strong><span>${esc(t.artist||'Artist TBD')} · ${esc(t.region||'Region TBD')}</span></div>
      <em>${esc(normalizeDateRange(t))}</em>
      <small>${shows} shows · ${esc(t.status||'draft')}</small>
      <div class="route-list-actions" onclick="event.stopPropagation()">
        <button type="button" onclick="RouteAdmin.openTour('${attr(t.id)}')">Open</button>
        <button type="button" onclick="RouteAdmin.duplicateTour('${attr(t.id)}')">Duplicate</button>
        <button type="button" class="danger" onclick="RouteAdmin.deleteTour('${attr(t.id)}')">Delete</button>
      </div>
    </article>`;
  }

  function renderBuilder(seed={}){
    currentGenerated = null; currentTour = null; currentShows = [];
    const artists = (typeof getArtists === 'function' ? getArtists() : []).map(a=>a.name).filter(Boolean);
    $('routeAdminShell').innerHTML = `
      <section class="route-plan-shell">
        <div class="route-plan-topbar">
          <button type="button" class="btn-secondary btn-sm" onclick="RouteAdmin.init()">← Tour Library</button>
          <div><p class="route-kicker">New routing session</p><h1>Plan a tour around the map</h1><span>Start broad, add anchors, then let AI propose the route. Every action stays visible while you iterate.</span></div>
          <button type="button" class="btn-secondary btn-sm" onclick="RouteAdmin.systemTour()">System Tour</button>
        </div>
        <div class="route-plan-grid">
          <section class="route-map-card route-builder-map-card">
            <div class="route-panel-title"><span>Route map</span><em>Initial view follows your continent; generated routes plot here.</em></div>
            <div id="routeMap" class="route-map route-map-planner"><div class="route-map-placeholder">Loading continent map…</div></div>
          </section>
          <aside class="route-control-panel">
            <form id="routeBuildForm" onsubmit="RouteAdmin.generate(event)">
              <div class="route-form-step"><b>01</b><span>Core plan</span></div>
              <label>Artist<select id="rtArtist" class="form-input"><option value="">Select artist…</option>${artists.map(a=>`<option ${seed.artist===a?'selected':''}>${esc(a)}</option>`).join('')}</select></label>
              <label>Tour Name<input id="rtName" class="form-input" placeholder="Fall 2026 West Coast" value="${attr(seed.name||'')}"></label>
              <div class="route-two-col"><label>Region<input id="rtRegion" class="form-input" placeholder="EU / US West / Northeast" value="${attr(seed.region||'')}"></label><label>Shows<input id="rtShows" type="number" min="1" max="40" class="form-input" value="${attr(seed.numShows||10)}" onfocus="this.select()"></label></div>
              <div class="route-two-col"><label>Start City<input id="rtStartCity" class="form-input" placeholder="Berlin" value="${attr(seed.startCity||'')}"></label><label>End City<input id="rtEndCity" class="form-input" placeholder="Amsterdam" value="${attr(seed.endCity||'')}"></label></div>
              <div class="route-two-col"><label>Start Date<input id="rtStartDate" type="date" class="form-input" value="${attr(seed.startDate||plusDaysISO(7))}"></label><label>End Date<input id="rtEndDate" type="date" class="form-input" value="${attr(seed.endDate||plusDaysISO(21))}"></label></div>
              <div class="route-two-col"><label>Deal Type<select id="rtDealType" class="form-input"><option>guarantee vs door</option><option>guarantee</option><option>door deal</option><option>festival routing</option></select></label><label>Display Currency<select id="rtCurrency" class="form-input" onchange="RouteAdmin.setCurrency(this.value)"><option value="USD" ${(seed.currency||routeCurrency)==='USD'?'selected':''}>USD $</option><option value="EUR" ${(seed.currency||routeCurrency)==='EUR'?'selected':''}>EUR €</option></select></label></div>
              <div class="route-form-step"><b>02</b><span>Travel + gear profile</span></div>
              <div class="route-two-col"><label>Travel Party<input id="rtPartySize" type="number" min="1" class="form-input" value="${attr(seed.partySize||3)}"></label><label>Gear Weight KG<input id="rtGearWeight" type="number" min="0" class="form-input" value="${attr(seed.gearWeightKg||80)}"></label></div>
              <label>Travel Mode Preference<select id="rtTravelPreference" class="form-input"><option>drive if feasible</option><option>fly when distance is too long</option><option>train when possible</option><option>mixed / decide per leg</option></select></label>
              <label class="route-check-label"><input id="rtTravelingWithGear" type="checkbox" ${seed.travelingWithGear===false?'':'checked'}> Band is traveling with gear</label>
              <label>Backline / Hotel / Transport Assumptions<textarea id="rtLogisticsProfile" class="form-input form-textarea" rows="4" placeholder="Needs partial backline when flying; promoter hotel preferred; airport pickup if flying; can drive max 5.5h after a show; avoid Monday unless Tuesday drive is realistic…">${esc(seed.logisticsProfile||'')}</textarea></label>
              <div class="route-form-step"><b>03</b><span>Anchors + constraints</span></div>
              <label>Routing Preferences<textarea id="rtPreferences" class="form-input form-textarea" rows="4" placeholder="Avoid 6+ hour drives, prioritize 200–500 cap darkwave/EBM/post-punk rooms, avoid Mondays unless necessary…">${esc(seed.preferences||'')}</textarea></label>
              <label>Established Holds / Confirmed Anchors <small>one per line: City | Date | Venue | Deal | Status. Use hold, offer, deal_made, confirmed, or advanced.</small><textarea id="rtAnchors" class="form-input form-textarea" rows="5" placeholder="Berlin | 2026-10-16 | Urban Spree | €800 guarantee | hold">${esc(seed.anchorText||'')}</textarea></label>
              <div class="route-builder-actions"><button class="btn-secondary" type="button" onclick="RouteAdmin.analyzeAnchors()">Analyze Anchors</button><button class="btn-primary" type="submit" onclick="RouteAdmin.generate(event)">Generate Route</button></div>
            </form>
          </aside>
        </div>
        <div class="route-output-grid">
          <section class="route-output-panel"><div class="route-panel-title"><span>Generated route</span><em>Review and save when the logic feels right.</em></div><div id="routeGeneratedResult">${routeStartHelp()}</div></section>
          <section class="route-output-panel"><div class="route-panel-title"><span>AI workbench</span><em>Budget, venues, deal advice, emails, and chat.</em></div><div id="routeToolOutput">${aiWorkbenchEmpty()}</div></section>
        </div>
        ${renderPlanningWizard()}
        ${renderRouteHelpSections()}
        ${renderAssistantDock()}
      </section>`;
    renderStarterMap();
  }

  function routeStartHelp(){ return `<div class="route-help-card"><h2>Start with the route shape.</h2><p>Pick artist, continent/region, endpoints, dates, and anchors. Then generate. The map and route legs will stay here while you keep refining.</p><ul><li>Use holds/anchors for confirmed weekends, active offers, or real buyer interest.</li><li>Use preferences for drive limits and room size.</li><li>Save only when the proposed routing makes sense.</li></ul></div>`; }
  function aiWorkbenchEmpty(){ return `<div class="route-ai-empty">AI tools appear here after you analyze anchors or generate/open a route. You’ll get budget, venue ideas, deal advice, and branded email output without leaving the planner.</div>`; }


  function renderPlanningWizard(){ return `<section class="route-wizard-panel"><div class="route-panel-title"><span>New user route planning wizard</span><em>Use this order when building a tour from scratch.</em></div><div class="route-wizard-grid"><article><b>1</b><strong>Define the frame</strong><p>Choose artist, region, dates, show count, travel party, gear weight, and display currency.</p></article><article><b>2</b><strong>Add anchors</strong><p>Paste confirmed holds, festival offers, or must-hit cities as City | Date | Venue | Deal | Status.</p></article><article><b>3</b><strong>Generate + inspect</strong><p>Let Gemini propose exact show legs, then read the AI Oversight before outreach.</p></article><article><b>4</b><strong>Find venues</strong><p>Use the Contact Board or per-stop Venue Finder to attach targets to every city.</p></article><article><b>5</b><strong>Move through pipeline</strong><p>Drag stops from prospects to holds, negotiating, and confirmed. Generation autosaves immediately, then every move/edit persists.</p></article><article><b>6</b><strong>Advance the show</strong><p>Confirmed stops feed Advancing/Band Access with hotel, transport, backline, and promoter forms.</p></article></div></section>`; }
  function renderRouteHelpSections(compact=false){ return `<section class="route-help-sections ${compact?'compact':''}"><div class="route-panel-title"><span>Route Planner help</span><em>Text guide for repeat use.</em></div><details open><summary>What to enter first</summary><p>Start with a real date range, number of shows, start/end cities, and any anchors. More specific anchors produce stronger routing than vague region-only requests.</p></details><details><summary>How venue targeting works</summary><p>Candidate contacts come from the internal CRM/RAG collection, grounded Venue Finder, fast AI suggestions, and manual additions. Use “Use Venue” only when you want that candidate to become the active venue for the stop.</p></details><details><summary>How saving works</summary><p>Generated routes autosave to Firestore immediately. After that, stop edits, Kanban moves, marker drags, venue selections, venue research, manual venue additions, AI oversight, and assistant-applied patches persist back to Firestore.</p></details><details><summary>What the assistant can change</summary><p>The assistant reads the active tour, legs, candidate venues, show records, budgets, logistics, and pipeline states. It proposes structured patches; you review and click Apply before changes are saved.</p></details></section>`; }
  function renderAssistantDock(){ return `<section class="route-assistant-dock"><div class="route-panel-title"><span>Always-on Booking AI</span><em>Reads the active route and can propose/save changes.</em></div><div id="routeAssistantLog" class="route-assistant-log"><div class="route-ai-empty">Ask things like “add a Leipzig candidate venue”, “move Berlin to hold”, “what’s the weakest stop?”, or “add a rest day after Prague”. I’ll propose a patch before saving.</div></div><div class="route-assistant-input"><textarea id="routeAssistantInput" class="form-input form-textarea" rows="3" placeholder="Ask the route AI to analyze or change this tour…"></textarea><button class="btn-primary" type="button" onclick="RouteAdmin.assistantAsk()">Ask / Propose Change</button></div></section>`; }

  function parseAnchors(text){
    return String(text||'').split(/\n+/).map(x=>x.trim()).filter(Boolean).map(line=>{ const [city,date,venue,deal,status]=line.split('|').map(p=>String(p||'').trim()); return {city,date,venue,deal,status:status||'hold'}; });
  }
  function formPayload(){ return { artist:val('rtArtist'), name:val('rtName'), region:val('rtRegion'), numShows:clamp(num('rtShows')||10,1,40), startCity:val('rtStartCity'), endCity:val('rtEndCity'), startDate:val('rtStartDate'), endDate:val('rtEndDate'), dealType:val('rtDealType'), partySize:num('rtPartySize')||3, gearWeightKg:num('rtGearWeight')||0, travelPreference:val('rtTravelPreference'), travelingWithGear:!!$('rtTravelingWithGear')?.checked, logisticsProfile:val('rtLogisticsProfile'), preferences:val('rtPreferences'), anchorShows:parseAnchors(val('rtAnchors')), currency:(val('rtCurrency')||routeCurrency||'USD').toUpperCase() }; }

  async function analyzeAnchors(){
    const out = $('routeToolOutput'); if(!out) return;
    const payload = formPayload();
    if(!payload.artist || !payload.region){ toast('Artist and region are required before anchor analysis.', 'error'); return; }
    out.innerHTML = loading('Analyzing anchors and routing gaps…');
    try{ const data = await ai('analyze_anchors', payload); out.innerHTML = renderAnalysisCard('Anchor Analysis', data); toast('✓ Anchor analysis ready','success'); }
    catch(e){ out.innerHTML = errorBox('Anchor analysis failed', e.message); }
  }

  async function autoSaveGeneratedRoute(){
    if(!currentGenerated) return null;
    if(currentGenerated.id) return currentGenerated;
    const saved = await api({action:'createTour', tour:{...currentGenerated,status:currentGenerated.status||'draft'}, createShows:true});
    currentGenerated = normalizeTour(saved, currentGenerated);
    currentTour = currentGenerated;
    tours = [currentGenerated, ...tours.filter(t=>t.id!==currentGenerated.id)];
    refreshLibraryList();
    return currentGenerated;
  }

  async function generate(ev){
    ev?.preventDefault();
    const out = $('routeGeneratedResult');
    const tools = $('routeToolOutput');
    const btn = document.querySelector('#routeBuildForm button[type="submit"]');
    const payload = formPayload();
    if(!payload.artist) payload.artist = payload.name || 'Artist TBD';
    const missing = [];
    if(!payload.region) missing.push(['Region','rtRegion']);
    if(!payload.startCity) missing.push(['Start City','rtStartCity']);
    if(!payload.endCity) missing.push(['End City','rtEndCity']);
    if(missing.length){
      const labels = missing.map(x=>x[0]).join(', ');
      if(out) out.innerHTML = errorBox('Route needs a few basics first', `Missing: ${labels}. Fill those fields and click Generate Route again.`);
      toast(`Missing: ${labels}`, 'error');
      const focusEl = $(missing[0][1]); if(focusEl) focusEl.focus();
      return;
    }
    if(out) out.innerHTML = loading('Gemini 3 is building the route…');
    if(tools) tools.innerHTML = `<div class="route-ai-empty">Generating route first. Then use the AI workbench for budget, venues, deals, and emails.</div>`;
    if(btn){ btn.disabled = true; btn.dataset.originalText = btn.textContent; btn.textContent = 'Generating…'; }
    try{
      currentGenerated = normalizeTour(await ai('generate_tour', payload), payload);
      renderGenerated(currentGenerated, payload);
      await renderMap(currentGenerated.legs || []);
      try{
        await autoSaveGeneratedRoute();
        renderGenerated(currentGenerated, payload);
        await renderMap(currentGenerated.legs || []);
        toast('✓ Route generated and autosaved — running second-pass AI oversight','success');
      }catch(saveErr){
        toast('Route generated but autosave failed: '+saveErr.message, 'error');
        if(tools) tools.innerHTML = errorBox('Autosave failed', saveErr.message + ' — click Save / Sync Tour after correcting this.');
      }
      reviewCurrentRoute(true,true);
    } catch(e){ if(out) out.innerHTML = errorBox('Route generation failed', e.message); toast('Route generation failed: '+e.message,'error'); }
    finally { if(btn){ btn.disabled = false; btn.textContent = btn.dataset.originalText || 'Generate Route'; } }
  }

  function normalizeTour(t,payload={}){
    t = t || {};
    t.name = t.name || t.tour_name || payload.name || `${payload.artist||'Artist'} ${payload.region||'Tour'}`;
    t.tour_name = t.tour_name || t.name;
    t.artist = t.artist || payload.artist;
    t.region = t.region || payload.region;
    t.startDate = t.startDate || payload.startDate;
    t.endDate = t.endDate || payload.endDate;
    t.status = t.status || 'draft';
    t.currency = (payload.currency || t.currency || routeCurrency || 'USD').toUpperCase()==='EUR' ? 'EUR' : 'USD'; routeCurrency = t.currency;
    t.legs = Array.isArray(t.legs) ? t.legs : [];
    t.total_days = t.total_days || t.legs.length;
    t.total_shows = t.total_shows || t.legs.filter(l=>!l.day_off).length;
    return t;
  }

  function renderGenerated(t,payload={}){
    $('routeGeneratedResult').innerHTML = `
      <div class="route-generated-card">
        <div class="route-generated-head">
          <div><p class="route-kicker">Generated draft</p><h2>${esc(t.name||t.tour_name)}</h2><span>${esc(t.artist||payload.artist)} · ${esc(t.region||payload.region)} · ${esc(normalizeDateRange(t))}</span><p>${esc(t.summary||t.routing_strategy||'')}</p></div>
          <div class="route-hero-actions"><button class="btn-secondary" onclick="RouteAdmin.reviewCurrentRoute()">AI Oversight</button><button class="btn-secondary" onclick="RouteAdmin.optimizeGenerated()">Optimize</button><button class="btn-secondary" onclick="RouteAdmin.estimateBudget()">Budget</button><button class="btn-secondary" onclick="RouteAdmin.renderVenueBoard()">Contact Board</button><button class="btn-secondary" onclick="RouteAdmin.researchVenuesAllStops()">Research Contacts All Stops</button><button class="btn-secondary" onclick="RouteAdmin.insertBlankDayAfter()">Add Blank Day</button><button class="btn-primary" onclick="RouteAdmin.saveGenerated()">Save / Sync Tour</button></div>
        </div>
        ${routeMetrics(t)}
        ${renderBudgetTicker(t)}
        ${renderKanban(t)}
        <div class="route-leg-list">${(t.legs||[]).map(legRow).join('')}</div>
      </div>`;
    const tools = $('routeToolOutput'); if(tools) tools.innerHTML = renderWorkbench(t);
  }

  function routeMetrics(t){ return `<div class="route-metrics"><div><strong>${esc(t.total_shows||0)}</strong><span>Shows</span></div><div><strong>${esc(t.total_days||(t.legs||[]).length||0)}</strong><span>Days</span></div><div><strong>${esc(t.estimated_total_km||'—')}</strong><span>Est. km</span></div><div><strong>${esc(Math.round(((t.legs||[]).reduce((n,l)=>n+(Number(l.drive_hours)||0),0))*10)/10 || '—')}</strong><span>Drive hrs</span></div></div>`; }
  function budgetStats(t){
    const legs=(t.legs||[]).filter(l=>!l.day_off);
    const km=legs.reduce((n,l)=>n+(Number(l.drive_from_previous_km)||0),0);
    const fuel=km*0.22;
    const lodging=legs.reduce((n,l)=>n+(String(l.hotel_responsibility||'agency').toLowerCase().includes('promoter')?0:(Number(l.hotel_nights||1)*120)),0);
    const perDiem=legs.length*(Number(t.partySize||t.party_size||3)||3)*35;
    const revenue=legs.reduce((n,l)=>n+(Number(l.rate_confirmed_usd)||Number(l.rate_offer_usd)||Number(l.rate_target_usd)||Number(l.suggested_guarantee_usd)||0),0);
    const expenses=fuel+lodging+perDiem;
    return {km:Math.round(km),fuel,lodging,perDiem,revenue,expenses,net:revenue-expenses,shows:legs.length};
  }
  function renderBudgetTicker(t){ const b=budgetStats(t); const c=currencyOf(t); return `<section class="route-budget-ticker"><div><span>Currency</span><strong><select class="form-input" onchange="RouteAdmin.setCurrency(this.value)"><option value="USD" ${c==='USD'?'selected':''}>USD $</option><option value="EUR" ${c==='EUR'?'selected':''}>EUR €</option></select></strong></div><div><span>Projected Revenue</span><strong>${money(b.revenue,c)}</strong></div><div><span>Fuel</span><strong>${money(b.fuel,c)}</strong></div><div><span>Lodging</span><strong>${money(b.lodging,c)}</strong></div><div><span>Per Diems</span><strong>${money(b.perDiem,c)}</strong></div><div class="${b.net>=0?'positive':'negative'}"><span>Projected Net</span><strong>${money(b.net,c)}</strong></div></section>`; }
  function pipelineColumn(status){ status=String(status||'prospect'); if(['confirmed','advanced','settled'].includes(status)) return 'confirmed'; if(['hold','offer'].includes(status)) return 'holds'; if(['contacted','negotiating','deal_made'].includes(status)) return 'negotiating'; return 'prospects'; }
  function pipelineStatusForColumn(col){ return col==='confirmed'?'confirmed':col==='holds'?'hold':col==='negotiating'?'negotiating':'prospect'; }
  function renderKanban(t){ const cols=[['prospects','Prospects'],['holds','Holds / Challenges'],['negotiating','Negotiating'],['confirmed','Confirmed']]; const legs=(t.legs||[]).map((l,i)=>({...l,_idx:i})).filter(l=>!l.day_off); return `<section class="route-kanban"><div class="route-panel-title"><span>Booking Pipeline</span><em>Drag cards between columns. Every move persists to Firestore once the route is generated/autosaved.</em></div><div class="route-kanban-grid">${cols.map(([key,label])=>`<div class="route-kanban-col" data-col="${key}" ondragover="event.preventDefault()" ondrop="RouteAdmin.dropKanban(event,'${key}')"><h4>${label}</h4>${legs.filter(l=>pipelineColumn(l.booking_status||l.deal_status)===key).map(l=>kanbanCard(l,l._idx)).join('')||'<p class="route-kanban-empty">Drop stops here</p>'}</div>`).join('')}</div></section>`; }
  function kanbanCard(l,i){ const rate=l.rate_confirmed_usd||l.rate_offer_usd||l.rate_target_usd||l.suggested_guarantee_usd; return `<article class="route-kanban-card ${pipelineColumn(l.booking_status||l.deal_status)}" draggable="true" ondragstart="RouteAdmin.dragKanban(event,${i})" onclick="RouteAdmin.openStop(${i})"><strong>${esc(l.city||'TBD')}</strong><span>${esc([l.date,l.suggested_venue].filter(Boolean).join(' · '))}</span><em>${statusBadge(l.booking_status||'prospect')} ${money(rate,currencyOf(activeRoute()))}</em></article>`; }
  function setLegStatus(idx,status){ const t=activeRoute(); if(!t?.legs?.[idx]) return; t.legs[idx].booking_status=status; if(status==='confirmed'){ t.legs[idx].deal_status='confirmed'; t.legs[idx].locked=true; } rerenderActiveRoute(); renderMap(t.legs||[]); persistStop(idx,t.legs[idx]).then(()=>toast('✓ Stop moved to '+status.replace(/_/g,' '),'success')).catch(e=>toast('Status save failed: '+e.message,'error')); }
  function dragKanban(ev,idx){ ev.dataTransfer.setData('text/plain', String(idx)); ev.dataTransfer.effectAllowed='move'; }
  function dropKanban(ev,col){ ev.preventDefault(); const idx=Number(ev.dataTransfer.getData('text/plain')); if(Number.isInteger(idx)) setLegStatus(idx,pipelineStatusForColumn(col)); }
  function markerStyle(l){ const c=pipelineColumn(l.booking_status||l.deal_status); if(c==='confirmed') return {fill:'#27ae60',stroke:'#27ae60',fillOpacity:1}; if(c==='holds'||c==='negotiating') return {fill:'#c8a96e',stroke:'#c8a96e',fillOpacity:.85}; return {fill:'#1a0606',stroke:'#c0392b',fillOpacity:.25}; }
  function markerIcon(l){ const st=markerStyle(l); return { path:google.maps.SymbolPath.CIRCLE, scale:9, fillColor:st.fill, fillOpacity:st.fillOpacity, strokeColor:st.stroke, strokeWeight:2 }; }
  async function reverseGeocode(lat,lng){ try{ const res=await fetch(MAPS_PROXY,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reverse_geocode',lat,lng})}).then(r=>r.json()); const r=(res.results||[])[0] || (res.data?.results||[])[0]; const comps=r?.address_components||[]; const find=types=>comps.find(c=>types.some(t=>c.types?.includes(t)))?.long_name||''; return {city:find(['locality','postal_town','administrative_area_level_2'])||r?.formatted_address?.split(',')[0]||'', country:find(['country']), formatted:r?.formatted_address||''}; }catch{return {city:'',country:''};} }
  async function handleMarkerDrop(idx, marker){ const t=activeRoute(); const l=t?.legs?.[idx]; if(!l) return; const pos=marker.getPosition(); l.lat=pos.lat(); l.lng=pos.lng(); toast('Updating stop location + venues…','success'); const geo=await reverseGeocode(l.lat,l.lng); if(geo.city) l.city=geo.city; if(geo.country) l.country=geo.country; l.notes=[l.notes, geo.formatted?`Marker moved/snap: ${geo.formatted}`:'Marker moved'].filter(Boolean).join(' · '); try{ const fast=await ai('suggest_venues',{tour:t,stop:l,city:l.city,country:l.country,region:t.region}); if(Array.isArray(fast.venues)&&fast.venues.length) l.candidate_venues=fast.venues.slice(0,8).map(v=>({name:v.name,capacity:v.capacity,booking_method:v.booking_method||v.booking_contact_tip||'unknown',fit_reason:v.fit_reason||v.known_for||'',outreach_angle:v.next_action||''})); }catch{} await persistStop(idx,l).catch(()=>null); rerenderActiveRoute(); await renderMap(t.legs||[]); }

  function currencyOf(t){ const c=String(t?.currency || routeCurrency || 'USD').toUpperCase(); return c==='EUR' ? 'EUR' : 'USD'; }
  function convertMoney(n,currency){ return currency==='EUR' ? n * USD_TO_EUR : n; }
  function money(v,currency=currencyOf(activeRoute())) { const n = Number(v); if(!Number.isFinite(n) || n <= 0) return '—'; const c=currency==='EUR'?'EUR':'USD'; const symbol=c==='EUR'?'€':'$'; return symbol + Math.round(convertMoney(n,c)).toLocaleString(); }
  function setCurrency(currency){ routeCurrency = String(currency||'USD').toUpperCase()==='EUR' ? 'EUR' : 'USD'; try{ localStorage.setItem('mk_route_currency', routeCurrency); }catch{} const t=activeRoute(); if(t) t.currency=routeCurrency; if(t?.id) api({action:'updateTour',id:t.id,updates:{currency:routeCurrency}}).catch(()=>{}); rerenderActiveRoute(); toast(`Currency switched to ${routeCurrency}`,'success'); }
  function statusBadge(v) { const x = String(v || 'prospect').replace(/_/g,' '); return `<span class="route-status-badge ${attr(String(v||'prospect'))}">${esc(x)}</span>`; }
  function legRow(l,i){
    const type = l.day_off ? 'Rest day' : l.is_anchor_show ? 'Anchor show' : 'Target show';
    const status = l.booking_status || (l.locked ? 'confirmed' : 'prospect');
    const rate = l.rate_confirmed_usd || l.rate_offer_usd || l.rate_target_usd || l.suggested_guarantee_usd;
    return `<article class="route-leg ${l.day_off?'day-off':''}" onclick="RouteAdmin.openStop(${i})">
      <div class="route-leg-day"><b>${esc(l.day||i+1)}</b><span>${esc(l.day_of_week||'')}</span></div>
      <div class="route-leg-main"><strong>${esc(l.city||'TBD')}</strong><span>${esc([l.date,l.country].filter(Boolean).join(' · '))}</span>${l.suggested_venue?`<em>${esc(l.suggested_venue)}</em>`:''}${l.notes?`<p>${esc(l.notes)}</p>`:''}</div>
      <div class="route-leg-meta"><span>${esc(type)}</span>${statusBadge(status)}<span>Rate: ${esc(money(rate,currencyOf(activeRoute())))}</span><span>${esc(l.travel_mode_recommendation||'travel TBD')}</span><span>${esc(l.hotel_responsibility?('Hotel: '+l.hotel_responsibility):'Hotel TBD')}</span><span>${l.locked?'Locked':'Not locked'}</span></div>
      <div class="route-leg-actions">${!l.day_off?`<button class="btn-secondary btn-sm" onclick="event.stopPropagation();RouteAdmin.openStop(${i})">Details</button><button class="btn-secondary btn-sm" onclick="event.stopPropagation();RouteAdmin.venueFinderForStop(${i})">Contact Finder</button><button class="btn-secondary btn-sm" onclick="event.stopPropagation();RouteAdmin.backlineForStop(${i})">Backline</button><button class="btn-secondary btn-sm" onclick="event.stopPropagation();RouteAdmin.suggestVenues(${i})">Fast Contacts</button><button class="btn-secondary btn-sm" onclick="event.stopPropagation();RouteAdmin.generateEmail(${i})">Email</button><button class="btn-secondary btn-sm" onclick="event.stopPropagation();RouteAdmin.adviseDeal(${i})">Deal</button>`:''}</div>
    </article>`;
  }

  function renderWorkbench(t){ return `<div class="route-workbench-grid"><button onclick="RouteAdmin.reviewCurrentRoute()"><strong>AI oversight</strong><span>Show saved review; regenerate only if requested.</span></button><button onclick="RouteAdmin.optimizeCurrent()"><strong>Optimize route</strong><span>Reorder without losing holds/deals.</span></button><button onclick="RouteAdmin.estimateBudget()"><strong>Estimate budget</strong><span>Rates, guarantees, costs, break-even.</span></button><button onclick="RouteAdmin.renderVenueBoard()"><strong>Venue board</strong><span>Find, add, select, and email venues city by city.</span></button><button onclick="RouteAdmin.backlineAllStops()"><strong>Backline finder</strong><span>Research suppliers, venue backline, pickup/delivery terms.</span></button><button onclick="RouteAdmin.renderTravelHotelModule()"><strong>Travel + hotels</strong><span>Flights, trains, drives, hotels, links, costs, band guidance.</span></button><button onclick="RouteAdmin.renderTravelOpsBoard()"><strong>Travel Ops Board</strong><span>Today/tomorrow moves, missing hotels, confirmations, risk flags.</span></button><button onclick="RouteAdmin.renderTravelAlertCenter()"><strong>Travel Alert Center</strong><span>Resolve, assign, and jump into critical travel issues.</span></button><button onclick="RouteAdmin.chatAgent()"><strong>Ask booking AI</strong><span>Routing, buyer, hold, and deal strategy.</span></button><button onclick="RouteAdmin.analyzeCurrentAnchors()"><strong>Analyze pipeline</strong><span>Show saved analysis; regenerate only if requested.</span></button></div><div id="routeAiOutput"></div>`; }
  function toolOut(){ return $('routeAiOutput') || $('routeToolOutput') || $('routeDetailTools'); }
  function renderAnalysisCard(title,data){ return `<div class="route-tool-card"><h3>${esc(title)}</h3>${renderObject(data)}${renderSuggestedActions(data?.suggested_actions||[])}</div>`; }
  function niceKey(k){ return String(k||'').replace(/_/g,' ').replace(/\b\w/g,m=>m.toUpperCase()); }
  function compactObjTitle(o={}){ return o.label || o.title || o.issue || o.risk || o.change || o.action || o.city || o.stop || o.verdict || ''; }
  function renderPrimitive(v){
    if(v===null || v===undefined || v==='') return '<span class="muted">—</span>';
    if(typeof v==='boolean') return `<span>${v?'Yes':'No'}</span>`;
    return `<span>${esc(v)}</span>`;
  }
  function renderObjectCard(o={}){
    const title=compactObjTitle(o);
    const body=Object.entries(o).filter(([k,v])=>!['label','title'].includes(k) && v!==undefined && v!==null && v!=='').map(([k,v])=>{
      if(typeof v==='object') return `<div class="route-object-subrow"><b>${esc(niceKey(k))}</b>${renderValue(v,k)}</div>`;
      return `<div class="route-object-subrow"><b>${esc(niceKey(k))}</b><span>${esc(v)}</span></div>`;
    }).join('');
    return `<li class="route-object-card">${title?`<strong>${esc(title)}</strong>`:''}${body||(!title?'<span class="muted">No details</span>':'')}</li>`;
  }
  function renderValue(v,key=''){
    if(Array.isArray(v)){
      if(!v.length) return '<span class="muted">None</span>';
      const hasObjects=v.some(x=>x && typeof x==='object');
      if(hasObjects) return `<ul class="route-object-card-list">${v.map(x=>x&&typeof x==='object'?renderObjectCard(x):`<li>${esc(x)}</li>`).join('')}</ul>`;
      return `<ul>${v.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`;
    }
    if(v && typeof v==='object'){
      const entries=Object.entries(v).filter(([,val])=>val!==undefined && val!==null && val!=='');
      if(!entries.length) return '<span class="muted">None</span>';
      return `<div class="route-object-nested">${entries.map(([k,val])=>`<div class="route-object-subrow"><b>${esc(niceKey(k))}</b>${renderValue(val,k)}</div>`).join('')}</div>`;
    }
    return renderPrimitive(v);
  }
  function renderObject(obj){
    if(!obj || typeof obj !== 'object') return `<p>${esc(obj||'')}</p>`;
    const skip=new Set(['raw','model','suggested_actions']);
    const rows = Object.entries(obj).filter(([k])=>!skip.has(k)).map(([k,v])=>`<div class="route-object-row"><b>${esc(niceKey(k))}</b>${renderValue(v,k)}</div>`).join('');
    return rows || '<p class="muted">No details returned.</p>';
  }
  function selectRenderedEmailBox(id){ const el=document.getElementById(id); if(!el) return; const r=document.createRange(); r.selectNodeContents(el); const s=window.getSelection(); s.removeAllRanges(); s.addRange(r); el.focus(); }
  if(typeof window!=='undefined') window.selectRenderedEmailBox=window.selectRenderedEmailBox||selectRenderedEmailBox;
  function renderedEmailHtml(html){ const m=String(html||'').match(/<body[^>]*>([\s\S]*?)<\/body>/i); return m?m[1]:String(html||''); }
  function renderEmailOutput(email, title){ const id='renderedEmail_'+Date.now()+'_'+Math.random().toString(36).slice(2,7); const html=email.html||''; return `<div class="route-tool-card"><h3>${esc(title||'Branded Venue Email')}</h3><label>Subject<input class="form-input" value="${attr(email.subject||'')}"></label><label>Plain text<textarea class="form-input form-textarea" rows="8">${esc(email.text||'')}</textarea></label><div class="route-panel-title" style="margin-top:18px"><span>Rendered Gmail-ready email</span><em>Click Select, copy, then paste into Gmail compose.</em></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 12px"><button type="button" class="btn-primary" onclick="selectRenderedEmailBox('${id}')">Select Rendered Email</button></div><div id="${id}" class="email-render-box" contenteditable="true" style="background:#050505;border:1px solid #333;max-height:520px;overflow:auto;padding:0;user-select:text;-webkit-user-select:text">${renderedEmailHtml(html)}</div><details style="margin-top:14px"><summary>Raw HTML source fallback</summary><textarea class="form-input form-textarea" rows="10">${esc(html)}</textarea></details></div>`; }
  function renderSuggestedActions(actions){
    const list=(Array.isArray(actions)?actions:[]).filter(a=>a&&a.action).slice(0,6);
    if(!list.length) return '';
    return `<div class="route-suggested-actions"><h4>Actionable next steps</h4>${list.map((a,i)=>`<button class="btn-secondary btn-sm" onclick='RouteAdmin.runSuggestedAction(${JSON.stringify(a).replace(/'/g,"&#39;")})'>${esc(a.label||a.action)}</button>`).join('')}</div>`;
  }


  function stopOptions(selected, options){ return options.map(o=>`<option value="${attr(o)}" ${String(selected||'')===o?'selected':''}>${esc(o.replace(/_/g,' '))}</option>`).join(''); }
  function activeRoute(){ return currentGenerated || currentTour; }
  function toSlug(v){ return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
  function mergeArtistContext(primary={}, fallback={}){
    const merged={...fallback,...primary};
    merged.social_links={...(fallback.social_links||fallback.socials||{}), ...(primary.social_links||primary.socials||{})};
    if(!Array.isArray(merged.discography)||!merged.discography.length) merged.discography=fallback.discography||[];
    if(!Array.isArray(merged.music_videos)||!merged.music_videos.length) merged.music_videos=fallback.music_videos||fallback.videos||[];
    if(!merged.bio) merged.bio=fallback.bio||'';
    if(!merged.shortBio) merged.shortBio=fallback.shortBio||'';
    return merged;
  }
  function artistPool(){
    const pool=[];
    try{ const stored=JSON.parse(localStorage.getItem('mk_artists')||'[]'); if(Array.isArray(stored)) pool.push(...stored); }catch(e){}
    try{ if(window.MELANKOLIA_DATA?.artists?.length) pool.push(...window.MELANKOLIA_DATA.artists); }catch(e){}
    const map=new Map();
    pool.forEach(a=>{ const k=toSlug(a?.slug||a?.name); if(!k) return; map.set(k, map.has(k)?mergeArtistContext(map.get(k),a):a); });
    return [...map.values()];
  }
  function findArtistContext(name){
    const q=String(name||'').trim(); if(!q) return null;
    const qs=toSlug(q), qn=q.toLowerCase();
    const artists=artistPool();
    const a=artists.find(x=>toSlug(x.slug||x.name)===qs || String(x.name||'').toLowerCase()===qn)
      || artists.find(x=>String(x.name||'').toLowerCase().includes(qn) || qn.includes(String(x.name||'').toLowerCase()))
      || null;
    if(!a) return null;
    const social=a.social_links||a.socials||{};
    const videos=[...(a.music_videos||[]), ...(a.videos||[])].filter(Boolean);
    return {
      slug:a.slug||toSlug(a.name), name:a.name||q, genres:a.genres||'', location:a.location||'', shortBio:a.shortBio||'', bio:a.bio||'',
      press:a.press||[], quotes:a.quotes||[], discography:a.discography||[], social_links:social, videos,
      epkUrl:a.slug?`https://melankoliaagency.com/epk/${a.slug}`:'https://melankoliaagency.com/epk/'+toSlug(a.name||q),
      profileUrl:a.slug?`https://melankoliaagency.com/artists/${a.slug}`:''
    };
  }
  if(typeof window!=='undefined') window.MelankoliaArtistContextLookup = findArtistContext;
  function rerenderActiveRoute(){ if(currentGenerated) renderGenerated(currentGenerated,currentGenerated); else if(currentTour) renderDetail(currentTour); }
  async function persistStop(idx, leg){
    const t=activeRoute(); if(!t?.id) return null;
    const res = await api({action:'updateStop', tour_id:t.id, leg_index:idx, leg});
    if(res?.tour){ currentTour = normalizeTour(res.tour,res.tour); if(res.show){ const pos=currentShows.findIndex(x=>x.id===res.show.id); if(pos>=0) currentShows[pos]=res.show; else currentShows.push(res.show); } }
    return res;
  }
  function venueAddress(v={}){ return v.address || v.formatted_address || v.full_address || v.venue_address || v.location_address || v.street_address || [v.street, v.city, v.country].filter(Boolean).join(', '); }
  function venueMeta(v={}){ return [venueAddress(v), v.capacity?`Cap: ${v.capacity}`:'', v.booking_method, v.website].filter(Boolean).join(' · '); }
  function openStop(idx){
    const t = activeRoute(); const l = t?.legs?.[idx]; if(!l) return;
    const out = toolOut();
    const candidates = Array.isArray(l.candidate_venues) ? l.candidate_venues : [];
    out.innerHTML = `<div class="route-tool-card route-stop-detail"><h3>Stop Detail — ${esc(l.city || 'TBD')}</h3>
      <div class="route-stop-grid">
        <label>Date<input id="stopDate" class="form-input" value="${attr(l.date||'')}"></label>
        <label>City<input id="stopCity" class="form-input" value="${attr(l.city||'')}"></label>
        <label>Country<input id="stopCountry" class="form-input" value="${attr(l.country||'')}"></label>
        <label>Venue<input id="stopVenue" class="form-input" value="${attr(l.suggested_venue||'')}"></label>
        <label>Booking Status<select id="stopBookingStatus" class="form-input">${stopOptions(l.booking_status||'prospect',['prospect','contacted','hold','offer','negotiating','deal_made','confirmed','advanced','settled','passed'])}</select></label>
        <label>Deal Status<select id="stopDealStatus" class="form-input">${stopOptions(l.deal_status||'not_started',['not_started','offer_needed','offer_sent','countered','deal_made','contract_sent','confirmed','settled'])}</select></label>
        <label>Hold Deadline<input id="stopHoldDeadline" class="form-input" value="${attr(l.hold_deadline||'')}"></label>
        <label>Target Rate USD<input id="stopRateTarget" type="number" class="form-input" value="${attr(l.rate_target_usd||l.suggested_guarantee_usd||'')}"></label>
        <label>Offer USD<input id="stopRateOffer" type="number" class="form-input" value="${attr(l.rate_offer_usd||'')}"></label>
        <label>Confirmed USD<input id="stopRateConfirmed" type="number" class="form-input" value="${attr(l.rate_confirmed_usd||'')}"></label>
        <label class="route-check-label"><input id="stopLocked" type="checkbox" ${l.locked?'checked':''}> Locked / confirmed</label>
        <label>Travel Mode<select id="stopTravelMode" class="form-input">${stopOptions(l.travel_mode_recommendation||'drive',['drive','fly','train','mixed','promoter_transport','tbd'])}</select></label>
        <label>Travel Feasibility<select id="stopTravelFeasibility" class="form-input">${stopOptions(l.travel_feasibility||'possible',['possible','tight','risky','not_possible','needs_day_off'])}</select></label>
        <label>Hotel Responsibility<select id="stopHotelResponsibility" class="form-input">${stopOptions(l.hotel_responsibility||'agency',['agency','promoter','band','shared','tbd','not_needed'])}</select></label>
        <label>Hotel Nights<input id="stopHotelNights" type="number" class="form-input" value="${attr(l.hotel_nights||'')}"></label>
        <label class="route-check-label"><input id="stopHotelRequired" type="checkbox" ${l.hotel_required?'checked':''}> Hotel required</label>
        <label class="route-check-label"><input id="stopAirportTransfer" type="checkbox" ${l.airport_transfer_required?'checked':''}> Airport transfer needed</label>
        <label>Transport Responsibility<select id="stopTransportResponsibility" class="form-input">${stopOptions(l.transport_responsibility||'agency',['agency','promoter','band','shared','tbd','not_needed'])}</select></label>
        <label>Backline Needed<select id="stopBacklineNeeded" class="form-input">${stopOptions(l.backline_needed||'partial',['none','partial','full','tbd'])}</select></label>
      </div>
      <label>Next Action<textarea id="stopNextAction" class="form-input form-textarea" rows="2">${esc(l.next_action||'')}</textarea></label>
      <label>Internal Notes<textarea id="stopNotes" class="form-input form-textarea" rows="3">${esc(l.notes||'')}</textarea></label>
      <div class="route-stop-actions"><button class="btn-primary" onclick="RouteAdmin.saveStopEdits(${idx})">Save Stop Edits</button><button class="btn-secondary" onclick="RouteAdmin.insertBlankDayAfter(${idx})">Add Blank Day After</button>${l.day_off?`<button class="btn-secondary" onclick="RouteAdmin.convertBlankDayToProspect(${idx})">Convert To Prospect</button>`:''}<button class="btn-secondary" onclick="RouteAdmin.venueFinderForStop(${idx})">Find Promoters/Venues</button><button class="btn-secondary" onclick="RouteAdmin.backlineForStop(${idx})">Backline Finder</button><button class="btn-secondary" onclick="RouteAdmin.manualVenueForm(${idx})">Manual Add Contact</button><button class="btn-secondary" onclick="RouteAdmin.generateEmail(${idx})">Generate Email</button></div>
      ${renderBacklineMini(l)}<div class="route-stop-venues"><h4>Candidate contacts</h4>${candidates.length?candidates.map((v,vi)=>`<div class="route-venue-row"><strong>${esc(v.name||'Venue')}</strong><span>${esc(venueMeta(v))}</span><p>${esc(v.fit_reason||v.reason||v.outreach_angle||'')}</p><div class="route-venue-actions"><button class="btn-secondary btn-sm" onclick="RouteAdmin.useCandidateVenue(${idx},${vi})">Use Venue</button><button class="btn-secondary btn-sm" onclick="RouteAdmin.generateVenueEmail(${idx},${vi})">Branded Email</button>${v.website?`<a class="btn-secondary btn-sm" href="${attr(v.website)}" target="_blank">Site</a>`:''}</div></div>`).join(''):'<div class="route-ai-empty">No candidate contacts attached yet. Run Contact Finder for grounded promoter/venue options.</div>'}</div>
    </div>`;
  }
  function saveStopEdits(idx){
    const t=activeRoute(); const l=t?.legs?.[idx]; if(!l) return;
    l.date = val('stopDate') || l.date || '';
    l.city = val('stopCity') || l.city || '';
    l.country = val('stopCountry') || l.country || '';
    l.suggested_venue = val('stopVenue');
    l.booking_status = val('stopBookingStatus');
    l.deal_status = val('stopDealStatus');
    l.hold_deadline = val('stopHoldDeadline');
    l.rate_target_usd = Number(val('stopRateTarget')) || null;
    l.rate_offer_usd = Number(val('stopRateOffer')) || null;
    l.rate_confirmed_usd = Number(val('stopRateConfirmed')) || null;
    l.locked = !!$('stopLocked')?.checked;
    l.next_action = val('stopNextAction');
    l.travel_mode_recommendation = val('stopTravelMode');
    l.travel_feasibility = val('stopTravelFeasibility');
    l.hotel_responsibility = val('stopHotelResponsibility');
    l.hotel_nights = Number(val('stopHotelNights')) || null;
    l.hotel_required = !!$('stopHotelRequired')?.checked;
    l.airport_transfer_required = !!$('stopAirportTransfer')?.checked;
    l.transport_responsibility = val('stopTransportResponsibility');
    l.backline_needed = val('stopBacklineNeeded');
    l.lodging = {...(l.lodging||{}), required:l.hotel_required, nights:l.hotel_nights, responsibility:l.hotel_responsibility};
    l.transport = {...(l.transport||{}), airport_transfer_required:l.airport_transfer_required, responsibility:l.transport_responsibility, mode:l.travel_mode_recommendation};
    l.notes = val('stopNotes');
    if(t.id){ persistStop(idx,l).then(()=>toast('✓ Stop saved to Firestore','success')).catch(e=>toast('Database save failed: '+e.message,'error')); }
    else toast('✓ Stop updated in this unsaved route draft','success');
    rerenderActiveRoute();
    openStop(idx);
  }
  function statTile(label,value){ return `<div class="ops-stat"><b>${esc(value)}</b><span>${esc(label)}</span></div>`; }
  function travelStopOptions(t){ return (t?.legs||[]).map((l,i)=>`<option value="${i}">${esc((i+1)+'. '+[l.date,l.city,l.country].filter(Boolean).join(' · '))}</option>`).join(''); }
  function travelLinksHtml(links={}){ return Object.entries(links).filter(([,u])=>u&&/^https?:/.test(String(u))).map(([k,u])=>`<a class="btn-secondary btn-sm" href="${attr(u)}" target="_blank">${esc(k.replace(/_/g,' '))}</a>`).join(''); }
  function travelRecordRow(r,type){ return `<div class="route-object-card"><b>${esc(type==='hotel'?(r.hotel_name||'Hotel'):[r.origin_name||'Origin',r.destination_name||'Destination'].filter(Boolean).join(' → '))}</b><span>${esc(type==='hotel'?[r.check_in_datetime,r.check_out_datetime,r.booking_status, r.price_amount?money(r.price_amount,r.price_currency||currencyOf(activeRoute())):''].filter(Boolean).join(' · '):[r.leg_type,r.duration_minutes?`${r.duration_minutes} min`:'',r.distance_km?`${r.distance_km} km`:'',r.departure_datetime,r.arrival_datetime,r.booking_status,r.price_amount?money(r.price_amount,r.price_currency||currencyOf(activeRoute())):''].filter(Boolean).join(' · '))}</span><p>${esc(type==='hotel'?(r.address||r.notes||''):[r.provider,r.route_number,r.passenger_count?`${r.passenger_count} pax`:'',r.baggage_gear_notes||r.notes].filter(Boolean).join(' · '))}</p>${r.confirmation_number||r.confirmation_doc_url?`<p><strong>Confirmation:</strong> ${esc(r.confirmation_number||'document saved')}</p>`:''}<div class="route-venue-actions">${r.maps_route_url?`<a class="btn-secondary btn-sm" href="${attr(r.maps_route_url)}" target="_blank">Route</a>`:''}${r.maps_url?`<a class="btn-secondary btn-sm" href="${attr(r.maps_url)}" target="_blank">Map</a>`:''}${r.booking_url?`<a class="btn-secondary btn-sm" href="${attr(r.booking_url)}" target="_blank">Booking</a>`:''}${r.confirmation_doc_url?`<a class="btn-secondary btn-sm" href="${attr(r.confirmation_doc_url)}" target="_blank">Confirmation Doc</a>`:''}<button class="btn-secondary btn-sm" onclick="RouteAdmin.archiveTravelRecord('${type}','${attr(r.id)}')">Remove</button></div></div>`; }
  function humanMode(m){ return String(m||'travel').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()); }
  function riskClass(r){ return `risk-${String(r||'none').toLowerCase()}`; }
  function opsBoardRow(r,i){ const next=r.next_travel||{}; const hotel=r.next_hotel||{}; return `<article class="route-object-card ${riskClass(r.risk_level)}"><b>${esc([r.date,r.city,r.country].filter(Boolean).join(' · '))}</b><span>${esc([r.tour_name,r.artist,r.venue_name,r.status].filter(Boolean).join(' · '))}</span><p><strong>Next move:</strong> ${esc(next.id?[humanMode(next.leg_type),next.origin_name||'origin',next.destination_name?`→ ${next.destination_name}`:'',next.departure_datetime,next.duration_minutes?`${next.duration_minutes} min`:''].filter(Boolean).join(' · '):'No travel saved')}</p><p><strong>Hotel:</strong> ${esc(hotel.id?[hotel.hotel_name||hotel.address||'Hotel',hotel.booking_status||''].filter(Boolean).join(' · '):'No hotel saved')}</p>${(r.flags||[]).length?`<ul>${r.flags.map(f=>`<li><strong>${esc(f.level)}</strong> — ${esc(f.message)}</li>`).join('')}</ul>`:'<p>No current travel/hotel flags.</p>'}<div class="route-stop-actions"><button class="btn-secondary btn-sm" onclick="RouteAdmin.openTour('${attr(r.tour_id)}')">Open Tour</button><button class="btn-primary btn-sm" onclick="RouteAdmin.openTourThenTravel('${attr(r.tour_id)}')">Plan Travel / Hotel</button>${next.id?`<button class="btn-secondary btn-sm" onclick="RouteAdmin.opsRouteLinks(${i})">Route Links</button>`:''}</div></article>`; }
  function alertRangeButtons(active){ const opts=[['week','7 Days'],['today','Today'],['tomorrow','Tomorrow'],['next2','Today + Tomorrow'],['upcoming','Upcoming']]; return `<div class="route-stop-actions">${opts.map(([m,l])=>`<button class="${m===active?'btn-primary':'btn-secondary'} btn-sm" onclick="RouteAdmin.renderTravelAlertCenter('${m}')">${esc(l)}</button>`).join('')}</div>`; }
  function alertResolvedToggle(){ return `<div class="route-stop-actions"><button class="${travelAlertIncludeResolved?'btn-primary':'btn-secondary'} btn-sm" onclick="RouteAdmin.renderTravelAlertCenter('${attr(travelAlertMode)}',${!travelAlertIncludeResolved})">${travelAlertIncludeResolved?'Hide Resolved':'Show Resolved'}</button></div>`; }
  function alertFilterButtons(){ const owners=['all','agency','promoter','band']; const levels=['all','critical','risky','tight']; return `<div class="route-stop-actions">${owners.map(o=>`<button class="${travelAlertOwnerFilter===o?'btn-primary':'btn-secondary'} btn-sm" onclick="RouteAdmin.setTravelAlertFilter('owner','${o}')">${esc(o==='all'?'All Owners':o)}</button>`).join('')}${levels.map(l=>`<button class="${travelAlertSeverityFilter===l?'btn-primary':'btn-secondary'} btn-sm" onclick="RouteAdmin.setTravelAlertFilter('severity','${l}')">${esc(l==='all'?'All Severity':l)}</button>`).join('')}</div>`; }
  function filteredTravelAlerts(){ return travelAlertRows.filter(a=>(travelAlertOwnerFilter==='all'||String(a.owner||'agency')===travelAlertOwnerFilter)&&(travelAlertSeverityFilter==='all'||String(a.level||'tight')===travelAlertSeverityFilter)); }
  function setTravelAlertFilter(kind,value){ if(kind==='owner') travelAlertOwnerFilter=value||'all'; if(kind==='severity') travelAlertSeverityFilter=value||'all'; renderTravelAlertCenter(travelAlertMode,travelAlertIncludeResolved); }
  function copyTravelAlertDigest(){ const rows=filteredTravelAlerts(); const text=['Melankolia Travel Alert Digest',`Range: ${travelAlertMode}`,`Filters: owner=${travelAlertOwnerFilter}, severity=${travelAlertSeverityFilter}`,'',...(rows.length?rows.map(a=>`- [${String(a.level||'tight').toUpperCase()}] ${[a.date,a.city,a.country].filter(Boolean).join(' · ')} — ${a.artist||a.tour_name||''}: ${a.message||''} (owner: ${a.owner||'agency'}, status: ${a.status||'open'})${a.notes?` | notes: ${a.notes}`:''}`):['No matching alerts.'])].join('\n'); if(navigator.clipboard) navigator.clipboard.writeText(text); toast('✓ Alert digest copied','success'); }
  async function renderTravelAlertCenter(mode='week',includeResolved=false){ travelAlertMode=mode||travelAlertMode||'week'; travelAlertIncludeResolved=!!includeResolved; const out=toolOut(); out.innerHTML=loading('Loading travel alert center…'); try{ const data=await post(TRAVEL_API,{action:'getTravelAlerts',mode:travelAlertMode,include_resolved:travelAlertIncludeResolved}); const c=data.counts||{}, range=data.range||{}; travelAlertRows=data.alerts||[]; const visible=filteredTravelAlerts(); out.innerHTML=`<div class="route-tool-card route-travel-module"><h3>Travel Alert Center</h3><p>${esc(range.label||'Next 7 days')} issue queue for travel, hotels, confirmations, and timing risks. <span class="route-muted">${esc([range.from,range.through].filter(Boolean).join(' → '))}</span></p>${alertRangeButtons(range.mode||travelAlertMode)}${alertResolvedToggle()}${alertFilterButtons()}<div class="route-stop-actions"><button class="btn-secondary btn-sm" onclick="RouteAdmin.copyTravelAlertDigest()">Copy Alert Digest</button></div><div class="ops-stat-grid">${statTile('Open',c.open||0)}${statTile('Critical',c.critical||0)}${statTile('Risky',c.risky||0)}${statTile('Tight',c.tight||0)}${statTile('Resolved',c.resolved||0)}</div><div class="route-object-card-list">${visible.length?visible.map(a=>alertRow(a,travelAlertRows.indexOf(a))).join(''):'<div class="route-ai-empty">No matching travel alerts in this range/filter.</div>'}</div></div>`;}catch(e){out.innerHTML=errorBox('Travel Alert Center failed',e.message);} }
  function alertRow(a,i){ return `<article class="route-object-card ${riskClass(a.level)}"><b>${esc(String(a.level||'tight').toUpperCase())} — ${esc([a.date,a.city,a.country].filter(Boolean).join(' · '))}</b><span>${esc([a.tour_name,a.artist,a.venue_name].filter(Boolean).join(' · '))}</span><p>${esc(a.message)}</p><p><strong>Owner:</strong> ${esc(a.owner||'agency')} · <strong>Status:</strong> ${esc(a.status||'open')}</p>${a.notes?`<p><strong>Notes:</strong> ${esc(a.notes)}</p>`:''}<div class="route-stop-actions">${a.status==='resolved'?`<button class="btn-primary btn-sm" onclick="RouteAdmin.updateTravelAlert(${i},'open')">Reopen</button>`:`<button class="btn-primary btn-sm" onclick="RouteAdmin.updateTravelAlert(${i},'resolved')">Mark Resolved</button>`}<button class="btn-secondary btn-sm" onclick="RouteAdmin.updateTravelAlert(${i},'open','agency')">Agency</button><button class="btn-secondary btn-sm" onclick="RouteAdmin.updateTravelAlert(${i},'open','promoter')">Promoter</button><button class="btn-secondary btn-sm" onclick="RouteAdmin.updateTravelAlert(${i},'open','band')">Band</button><button class="btn-secondary btn-sm" onclick="RouteAdmin.editTravelAlertNote(${i})">Add Note</button><button class="btn-secondary btn-sm" onclick="RouteAdmin.openTour('${attr(a.tour_id)}')">Open Tour</button><button class="btn-secondary btn-sm" onclick="RouteAdmin.openTourThenTravel('${attr(a.tour_id)}')">Plan Travel</button><button class="btn-secondary btn-sm" onclick="RouteAdmin.generateTravelAlertMessage(${i},'promoter_reminder')">Promoter Draft</button><button class="btn-secondary btn-sm" onclick="RouteAdmin.generateTravelAlertMessage(${i},'band_note')">Band Note</button><button class="btn-secondary btn-sm" onclick="RouteAdmin.generateTravelAlertMessage(${i},'agency_note')">Agency Note</button></div></article>`; }
  async function updateTravelAlert(i,status,owner){ const a=travelAlertRows[Number(i)]; if(!a)return; await post(TRAVEL_API,{action:'updateTravelAlert',alert:{alert_key:a.alert_key,status,owner:owner||a.owner}}); toast(status==='resolved'?'✓ Alert resolved':'✓ Alert updated','success'); renderTravelAlertCenter(travelAlertMode,travelAlertIncludeResolved); }
  async function editTravelAlertNote(i){ const a=travelAlertRows[Number(i)]; if(!a)return; const notes=prompt('Alert notes',a.notes||''); if(notes===null)return; await post(TRAVEL_API,{action:'updateTravelAlert',alert:{alert_key:a.alert_key,status:a.status||'open',owner:a.owner||'agency',notes}}); toast('✓ Alert note saved','success'); renderTravelAlertCenter(travelAlertMode,travelAlertIncludeResolved); }
  async function generateTravelAlertMessage(i,type){ const a=travelAlertRows[Number(i)]; if(!a)return; const out=toolOut(); out.innerHTML=loading('Generating alert message draft…'); try{ const d=await post(TRAVEL_API,{action:'generateTravelAlertMessage',message_type:type,alert:a}); out.innerHTML=`<div class="route-tool-card"><h3>${esc(d.subject||'Travel alert draft')}</h3><p>${esc((d.audience||type||'draft').replace(/_/g,' '))} · copy-ready draft, not sent automatically.</p><label>Subject<input class="form-input" value="${attr(d.subject||'')}"></label><label>Draft<textarea class="form-input form-textarea" rows="14" onclick="this.select()">${esc(d.body_text||'')}</textarea></label><div class="route-stop-actions"><button class="btn-primary" onclick="navigator.clipboard&&navigator.clipboard.writeText(this.closest('.route-tool-card').querySelector('textarea').value); RouteAdmin.toast&&RouteAdmin.toast('Copied draft','success')">Copy Draft</button><button class="btn-secondary" onclick="RouteAdmin.renderTravelAlertCenter()">Back to Alert Center</button></div></div>`;}catch(e){out.innerHTML=errorBox('Draft failed',e.message);} }

  function opsRangeButtons(active){ const opts=[['next2','Today + Tomorrow'],['today','Today'],['tomorrow','Tomorrow'],['week','7 Days'],['upcoming','Upcoming']]; return `<div class="route-stop-actions">${opts.map(([m,l])=>`<button class="${m===active?'btn-primary':'btn-secondary'} btn-sm" onclick="RouteAdmin.renderTravelOpsBoard('${m}')">${esc(l)}</button>`).join('')}</div>`; }
  async function renderTravelOpsBoard(mode='next2'){ const out=toolOut(); out.innerHTML=loading('Loading travel ops board…'); try{ const data=await post(TRAVEL_API,{action:'getTravelOpsBoard',mode}); const c=data.counts||{}, range=data.range||{}; out.innerHTML=`<div class="route-tool-card route-travel-module"><h3>Travel Ops Board</h3><p>${esc(range.label||'Today + tomorrow')} view across active tours: next movement, hotel status, missing records, and timing risk. <span class="route-muted">${esc([range.from,range.through].filter(Boolean).join(' → '))}</span></p>${opsRangeButtons(range.mode||mode)}<div class="ops-stat-grid">${statTile('Shows',c.shows||0)}${statTile('Critical',c.critical||0)}${statTile('Risk/Tight',(c.risky||0)+(c.tight||0))}${statTile('Missing Travel',c.missing_travel||0)}${statTile('Missing Hotels',c.missing_hotels||0)}</div><div class="route-object-card-list">${(data.rows||[]).length?(opsBoardRows=data.rows).map(opsBoardRow).join(''):`<div class="route-ai-empty">No active shows found for ${esc((range.label||'this range').toLowerCase())}.</div>`}</div></div>`;}catch(e){out.innerHTML=errorBox('Travel Ops Board failed',e.message);} }

  async function openTourThenTravel(id){ await openTour(id); setTimeout(()=>renderTravelHotelModule(),150); }
  async function opsRouteLinks(i){ const r=opsBoardRows[Number(i)]||{}, n=r.next_travel||{}; const out=toolOut(); if(!n.id){ toast('No travel leg saved yet. Use Plan Travel / Hotel first.','error'); return; } out.innerHTML=loading('Generating route links…'); try{ const data=await post(TRAVEL_API,{action:'generateBookingLinks',origin:n.origin_address||n.origin_name,destination:n.destination_address||n.destination_name,mode:n.leg_type,date:r.date}); out.innerHTML=`<div class="route-tool-card"><h3>Route Links — ${esc([r.city,r.country].filter(Boolean).join(', '))}</h3><p>${esc([n.origin_name||n.origin_address,n.destination_name||n.destination_address].filter(Boolean).join(' → '))}</p><div class="route-stop-actions"><a class="btn-primary btn-sm" target="_blank" href="${attr(data.google_maps||'#')}">Google Maps</a><a class="btn-secondary btn-sm" target="_blank" href="${attr(data.rome2rio||'#')}">Rome2Rio</a>${data.google_flights?`<a class="btn-secondary btn-sm" target="_blank" href="${attr(data.google_flights)}">Google Flights</a>`:''}${data.db?`<a class="btn-secondary btn-sm" target="_blank" href="${attr(data.db)}">DB</a>`:''}<button class="btn-secondary btn-sm" onclick="RouteAdmin.renderTravelOpsBoard()">Back to Ops Board</button></div></div>`;}catch(e){out.innerHTML=errorBox('Route link generation failed',e.message);} }

  async function renderTravelHotelModule(){
    const t=activeRoute(); const out=toolOut(); if(!t?.id){ out.innerHTML=errorBox('Save the tour first','Travel + hotels are persisted in Firestore, so the route needs to be saved before adding legs or hotel stays.'); return; }
    out.innerHTML=loading('Loading travel + hotel logistics…');
    try{
      const data=await post(TRAVEL_API,{action:'getTourTravel',tour_id:t.id});
      const legs=data.travel_legs||[], hotels=data.hotel_stays||[], budget=data.budget_summary||{}, feas=data.feasibility||{};
      out.innerHTML=`<div class="route-tool-card route-travel-module"><h3>Travel + Hotel Logistics</h3><p>Manual-first planning for flights, trains, buses, driving, local transfer and hotel stays. Google traffic/transit is live where available; flight/rail carrier APIs show provider status before use.</p><div class="route-stop-actions"><button class="btn-secondary btn-sm" onclick="RouteAdmin.showTravelProviderStatus()">Travel API Status</button></div><div class="ops-stat-grid">${statTile('Travel',legs.length)}${statTile('Hotels',hotels.length)}${statTile('Budget',money(budget.total||0,budget.currency||currencyOf(t)))}${statTile('Risk',feas.risk_level||'none')}</div>
      <div class="route-stop-grid"><label>Stop<select id="tlStop" class="form-input">${travelStopOptions(t)}</select></label><label>Mode<select id="tlType" class="form-input">${stopOptions('drive',['drive','train','bus','flight','local_transit','taxi','rideshare','walk'])}</select></label><label>Origin<input id="tlOrigin" class="form-input" placeholder="Hotel / station / airport / city"></label><label>Destination<input id="tlDestination" class="form-input" placeholder="Venue / hotel / station / airport"></label><label>Departure<input id="tlDeparture" class="form-input" placeholder="2027-05-10T14:30"></label><label>Arrival<input id="tlArrival" class="form-input" placeholder="2027-05-10T17:10"></label><label>Provider<input id="tlProvider" class="form-input" placeholder="DB / EasyJet / van"></label><label>Route / Flight #<input id="tlRoute" class="form-input" placeholder="ICE 123 / U2 4567"></label><label>Status<select id="tlStatus" class="form-input">${stopOptions('planned',['needed','searched','planned','selected','confirmed','locked'])}</select></label><label>Passengers<input id="tlPassengers" class="form-input" placeholder="1"></label><label>Price<input id="tlPrice" class="form-input" placeholder="120"></label><label>Confirmation<input id="tlConfirm" class="form-input" placeholder="PNR / booking ref"></label><label>Booking URL<input id="tlBookingUrl" class="form-input" placeholder="https://…"></label><label>Ticket / PDF URL<input id="tlDocUrl" class="form-input" placeholder="https://…"></label></div><label>Gear / notes<textarea id="tlNotes" class="form-input form-textarea" rows="2" placeholder="Oversize synth case; train platform change; pickup needed…"></textarea></label><div class="route-stop-actions"><button class="btn-primary" onclick="RouteAdmin.saveTravelLeg()">Save Travel Leg</button><button class="btn-secondary" onclick="RouteAdmin.openGeneratedTravelLinks()">Generate Search Links</button><button class="btn-secondary" onclick="RouteAdmin.syncTourBandGuidance()">Sync Band Guidance</button></div>
      <hr class="ops-sep"><div class="route-stop-grid"><label>Stop<select id="htStop" class="form-input">${travelStopOptions(t)}</select></label><label>Hotel Name<input id="htName" class="form-input"></label><label>Address<input id="htAddress" class="form-input"></label><label>Check-in<input id="htCheckIn" class="form-input" placeholder="2027-05-10T15:00"></label><label>Check-out<input id="htCheckOut" class="form-input" placeholder="2027-05-11T11:00"></label><label>Price<input id="htPrice" class="form-input"></label><label>Status<select id="htStatus" class="form-input">${stopOptions('needed',['needed','searched','selected','confirmed','locked'])}</select></label><label>Confirmation<input id="htConfirm" class="form-input"></label><label>Booking URL<input id="htBookingUrl" class="form-input" placeholder="https://…"></label><label>Confirmation Doc URL<input id="htDocUrl" class="form-input" placeholder="https://…"></label><label>Contact Phone<input id="htPhone" class="form-input"></label><label>Rooms<input id="htRooms" class="form-input" placeholder="1"></label><label>Guests<input id="htGuests" class="form-input" placeholder="1"></label></div><label>Check-in instructions / notes<textarea id="htNotes" class="form-input form-textarea" rows="2"></textarea></label><div class="route-stop-actions"><button class="btn-primary" onclick="RouteAdmin.saveHotelStay()">Save Hotel Stay</button></div>
      <div class="route-panel-title"><span>Feasibility flags</span></div>${(feas.flags||[]).length?`<ul>${feas.flags.map(f=>`<li><strong>${esc(f.level)}</strong> — ${esc(f.message)}</li>`).join('')}</ul>`:'<div class="route-ai-empty">No feasibility problems flagged yet.</div>'}
      <div class="route-panel-title"><span>Saved travel legs</span><em>${legs.length}</em></div><div class="route-object-card-list">${legs.length?legs.map(r=>travelRecordRow(r,'travel')).join(''):'<div class="route-ai-empty">No travel legs saved yet.</div>'}</div>
      <div class="route-panel-title"><span>Saved hotel stays</span><em>${hotels.length}</em></div><div class="route-object-card-list">${hotels.length?hotels.map(r=>travelRecordRow(r,'hotel')).join(''):'<div class="route-ai-empty">No hotel stays saved yet.</div>'}</div></div>`;
    }catch(e){ out.innerHTML=errorBox('Travel + Hotel module failed',e.message); }
  }
  async function archiveTravelRecord(type,id){ if(!id||!confirm('Remove this saved '+type+' record?')) return; await post(TRAVEL_API,{action:type==='hotel'?'archiveHotelStay':'archiveTravelLeg',id}); toast('✓ '+(type==='hotel'?'Hotel stay':'Travel leg')+' removed','success'); renderTravelHotelModule(); }
  async function syncTourBandGuidance(){ const t=activeRoute(); if(!t?.id)return; const r=await post(TRAVEL_API,{action:'syncTourBandGuidance',tour_id:t.id}); toast(`✓ Synced band guidance for ${r.updated||0} shows`,'success'); renderTravelHotelModule(); }
  async function saveTravelLeg(){ const t=activeRoute(); if(!t?.id)return; const idx=Number(val('tlStop')||0), l=(t.legs||[])[idx]||{}; const rec={tour_id:t.id,show_id:l.show_id||'',leg_index:idx,leg_type:val('tlType'),origin_name:val('tlOrigin'),destination_name:val('tlDestination'),departure_datetime:val('tlDeparture'),arrival_datetime:val('tlArrival'),provider:val('tlProvider'),route_number:val('tlRoute'),booking_status:val('tlStatus')||'planned',passenger_count:val('tlPassengers'),price_amount:val('tlPrice'),price_currency:currencyOf(t),confirmation_number:val('tlConfirm'),booking_url:val('tlBookingUrl'),confirmation_doc_url:val('tlDocUrl'),baggage_gear_notes:val('tlNotes')}; const saved=await post(TRAVEL_API,{action:'saveTravelLeg',leg:rec}); toast('✓ Travel leg saved','success'); renderTravelHotelModule(); }
  async function saveHotelStay(){ const t=activeRoute(); if(!t?.id)return; const idx=Number(val('htStop')||0), l=(t.legs||[])[idx]||{}; const rec={tour_id:t.id,show_id:l.show_id||'',leg_index:idx,hotel_name:val('htName'),address:val('htAddress'),check_in_datetime:val('htCheckIn'),check_out_datetime:val('htCheckOut'),price_amount:val('htPrice'),price_currency:currencyOf(t),booking_status:val('htStatus'),confirmation_number:val('htConfirm'),booking_url:val('htBookingUrl'),confirmation_doc_url:val('htDocUrl'),contact_phone:val('htPhone'),room_count:val('htRooms'),guest_count:val('htGuests'),check_in_instructions:val('htNotes')}; const saved=await post(TRAVEL_API,{action:'saveHotelStay',hotel:rec}); toast('✓ Hotel stay saved','success'); renderTravelHotelModule(); }
  async function openGeneratedTravelLinks(){ const links=await post(TRAVEL_API,{action:'generateBookingLinks',origin:val('tlOrigin'),destination:val('tlDestination'),mode:val('tlType'),date:val('tlDeparture')}); const out=toolOut(); const existing=out.innerHTML; out.innerHTML=existing+`<div class="route-tool-card"><h3>Generated travel search links</h3><p>${esc(links.note||'Generated links only.')}</p><div class="route-stop-actions">${travelLinksHtml(links)}</div></div>`; }
  async function showTravelProviderStatus(){
    const out=toolOut(); out.innerHTML=loading('Checking travel API providers…');
    try{ const data=await post(TRAVEL_API,{action:'getTravelProviderStatus'}); const rows=Object.entries(data).map(([k,v])=>`<div class="route-object-card"><b>${esc(k.replace(/_/g,' '))}</b><span>${esc([v.provider,v.level,v.configured?'configured':'not configured'].filter(Boolean).join(' · '))}</span><p>${esc(v.note||'')}</p>${v.required_secret?`<p><strong>Needs:</strong> ${esc(v.required_secret)}</p>`:''}${v.required_secrets?`<p><strong>Needs:</strong> ${esc(v.required_secrets.join(', '))}</p>`:''}</div>`).join(''); out.innerHTML=`<div class="route-tool-card"><h3>Travel API Provider Status</h3><p>This separates true live provider data from estimates and generated search links.</p><div class="route-object-card-list">${rows}</div></div>`; }
    catch(e){ out.innerHTML=errorBox('Travel provider status failed',e.message); }
  }

  function renderBacklineMini(l={}){
    const b=l.backline_research;
    if(!b) return '';
    return `<div class="route-tool-card route-backline-mini"><h4>Backline logistics</h4><p>${esc(b.summary||b.recommended_plan||'Backline research saved for this stop.')}</p><div class="route-stop-actions"><button class="btn-secondary btn-sm" onclick="RouteAdmin.showBacklineResult(${(activeRoute()?.legs||[]).indexOf(l)})">View Saved Backline</button></div></div>`;
  }
  function renderBacklineResult(data={}, idx=null){
    const suppliers=Array.isArray(data.suppliers)?data.suppliers:[];
    const venueBackline=Array.isArray(data.venue_backline)?data.venue_backline:[];
    const questions=Array.isArray(data.open_questions)?data.open_questions:[];
    const supplierHtml=suppliers.length?suppliers.map(s=>`<div class="route-object-card"><b>${esc(s.name||'Supplier')}</b><span>${esc([s.type,s.delivery_available?`Delivery: ${s.delivery_available}`:'',s.pickup_required?`Pickup: ${s.pickup_required}`:'',s.confidence_score?`Confidence ${s.confidence_score}`:''].filter(Boolean).join(' · '))}</span><p>${esc(s.fit_reason||s.terms||'')}</p><p><strong>Terms:</strong> ${esc(s.terms||'unknown')} ${s.deposit_or_id?` · ${esc(s.deposit_or_id)}`:''}</p><p><strong>Services:</strong> ${esc((s.services||[]).join(', ')||'unknown')}</p><div class="route-venue-actions">${s.website?`<a class="btn-secondary btn-sm" href="${attr(s.website)}" target="_blank">Website</a>`:''}${(s.source_urls||[]).slice(0,3).map((u,i)=>`<a class="btn-secondary btn-sm" href="${attr(u)}" target="_blank">Source ${i+1}</a>`).join('')}</div></div>`).join(''):'<div class="route-ai-empty">No local supplier confirmed yet.</div>';
    const venueHtml=venueBackline.length?venueBackline.map(v=>`<div class="route-object-card"><b>${esc(v.venue||'Venue')}</b><span>${esc('Backline: '+(v.confirmed_backline||'unknown'))}</span><p>${esc(v.terms||'')}</p><p><strong>Equipment:</strong> ${esc((v.equipment||[]).join(', ')||'unknown')}</p><div class="route-venue-actions">${(v.source_urls||[]).slice(0,3).map((u,i)=>`<a class="btn-secondary btn-sm" href="${attr(u)}" target="_blank">Source ${i+1}</a>`).join('')}</div></div>`).join(''):'<div class="route-ai-empty">No venue backline confirmed yet.</div>';
    const fallbackNote=(data.fallback||data.warning)?`<div class="route-warning-list"><b>${data.fallback?'Fallback mode':'Research warning'}</b><ul><li>${esc(data.warning||'Deep verified research was unavailable; links below are search links for manual confirmation, not verified supplier terms.')}</li></ul></div>`:'';
    return `<div class="route-tool-card route-backline-result"><h3>Backline Finder${idx!==null?` — Stop ${idx+1}`:''}</h3>${fallbackNote}<p>${esc(data.summary||'')}</p><p><strong>Recommended plan:</strong> ${esc(data.recommended_plan||'Confirm with promoter/venue and keep a rental backup.')}</p><p><strong>Risk:</strong> ${esc(data.risk_level||'unknown')}</p><div class="route-panel-title"><span>Local suppliers / rental options</span><em>${suppliers.length} found</em></div><div class="route-object-card-list">${supplierHtml}</div><div class="route-panel-title"><span>Venue backline / house gear</span><em>${venueBackline.length} checked</em></div><div class="route-object-card-list">${venueHtml}</div>${questions.length?`<div class="route-panel-title"><span>Open questions for promoter / venue</span></div><ul>${questions.map(q=>`<li>${esc(q)}</li>`).join('')}</ul>`:''}</div>`;
  }
  async function backlineForStop(idx){
    const t=activeRoute(); const l=t?.legs?.[idx]; if(!l) return;
    const out=toolOut(); out.innerHTML=loading(`Researching backline options for ${l.city}…`);
    try{
      const data=await post(BACKLINE_API,{data:{artist:t.artist,city:l.city,country:l.country,venue:l.suggested_venue,date:l.date,backline_needed:l.backline_needed,gear_requirements:t.logisticsProfile||t.logistics_profile||t.gearProfile||''}});
      l.backline_research=data; l.backline_options=data.suppliers||[]; l.venue_backline=data.venue_backline||[]; l.backline_next_questions=data.open_questions||[];
      l.backline_notes=[data.summary,data.recommended_plan].filter(Boolean).join(' · ');
      if(t.id) await persistStop(idx,l);
      out.innerHTML=renderBacklineResult(data,idx);
      toast(t.id?'✓ Backline research saved to stop':'✓ Backline research attached to draft stop','success');
    }catch(e){ out.innerHTML=errorBox('Backline Finder failed', e.message); }
  }
  async function backlineAllStops(){
    const t=activeRoute(); if(!t?.legs?.length) return;
    const stops=t.legs.map((l,i)=>({l,i})).filter(x=>!x.l.day_off);
    const out=toolOut(); out.innerHTML=loading(`Researching backline logistics for ${stops.length} stops…`);
    let ok=0, failed=0;
    for(const {l,i} of stops){ try{ await backlineForStop(i); ok++; }catch(e){ failed++; } }
    out.innerHTML=`<div class="route-tool-card"><h3>Backline research complete</h3><p>${ok} stops researched${failed?`, ${failed} failed`:''}. Open a stop to view saved backline logistics.</p></div>`;
  }
  function showBacklineResult(idx){ const t=activeRoute(); const l=t?.legs?.[idx]; if(!l?.backline_research) return toast('No saved backline research for this stop yet.','error'); toolOut().innerHTML=renderBacklineResult(l.backline_research,idx); }

  function contactCandidate(v={}, type='venue'){
    const isPromoter = type==='promoter' || /promoter|collective|agency|booker|festival|series/i.test(v.type||v.contact_type||'');
    return {contact_type:isPromoter?'promoter':'venue', name:v.name,address:venueAddress(v),city:v.city,country:v.country,capacity:v.capacity_display||v.capacity_numeric||v.capacity,fit_reason:v.recommendation_reason||v.description,booking_method:v.booking_method,website:v.website,booking_form_url:v.booking_form_url,email:v.email,instagram:v.instagram,facebook:v.facebook,confidence_score:v.confidence_score,verification_sources:v.verification_sources||[],outreach_angle:v.recommendation_reason||v.description||'',associated_acts:v.associated_acts||v.similar_acts_booked||[],type:v.type||v.venue_type||(isPromoter?'promoter':'venue')};
  }
  async function runGroundedContactFinder(location, genre, maxCapacity=700){
    const promoterReq=post(VENUE_FINDER_API,{mode:'promoters',location,genre,maxCapacity,includeMainstream:false,resultLimit:8});
    const venueReq=post(VENUE_FINDER_API,{mode:'venues',location,genre,maxCapacity,includeMainstream:false,limit:8,resultLimit:8});
    const [promoters,venues]=await Promise.allSettled([promoterReq,venueReq]);
    const collect=res=>res.status==='fulfilled'?(res.value.items||res.value.results||res.value.venues||res.value.data?.items||[]):[];
    return [...collect(promoters).map(v=>contactCandidate(v,'promoter')),...collect(venues).map(v=>contactCandidate(v,'venue'))];
  }

  async function venueFinderForStop(idx){
    const t=activeRoute(); const l=t?.legs?.[idx]; if(!l) return;
    const out=toolOut(); out.innerHTML=loading(`Running grounded Venue Finder for ${l.city}…`);
    try{
      l.candidate_venues = await runGroundedContactFinder([l.city,l.country].filter(Boolean).join(', '),'darkwave, EBM, post-punk, industrial, goth, synth',600);
      await Promise.allSettled(l.candidate_venues.map(v=>upsertVenueToMaster(v,l,'route_venue_finder')));
      if(!l.suggested_venue && l.candidate_venues[0]) l.suggested_venue=l.candidate_venues[0].name;
      if(t.id) await persistStop(idx,l);
      rerenderActiveRoute();
      openStop(idx);
      toast(t.id?'✓ Venue Finder results saved to Firestore':'✓ Venue Finder results attached to stop','success');
    } catch(e){ out.innerHTML=errorBox('Venue Finder failed',e.message); }
  }


  async function persistWholeRoute(reason='Route updated', replaceShows=false){
    const t=activeRoute();
    if(!t?.id) { toast(`✓ ${reason} in unsaved draft`, 'success'); return null; }
    const updates={...t, updated_at:new Date().toISOString()};
    delete updates.shows;
    const saved=await api({action:'updateTour', id:t.id, updates, replaceShows});
    if(replaceShows){ const fresh=await api({action:'getTour', id:t.id}); currentTour=normalizeTour(fresh,fresh); currentShows=fresh.shows||[]; return fresh; }
    currentTour=normalizeTour(saved,saved);
    return saved;
  }
  function manualVenueForm(idx){
    const t=activeRoute(); const l=t?.legs?.[idx]; if(!l) return;
    const out=toolOut();
    out.innerHTML=`<div class="route-tool-card"><h3>Manual venue — ${esc(l.city||'Stop '+(idx+1))}</h3><div class="route-stop-grid"><label>Name<input id="manualVenueName" class="form-input" placeholder="Venue name"></label><label>Address<input id="manualVenueAddress" class="form-input" placeholder="Street / city"></label><label>Capacity<input id="manualVenueCapacity" class="form-input" placeholder="250"></label><label>Booking method<input id="manualVenueBooking" class="form-input" placeholder="email / form / Instagram"></label><label>Website<input id="manualVenueWebsite" class="form-input" placeholder="https://"></label><label>Email / contact<input id="manualVenueEmail" class="form-input" placeholder="booking@..."></label></div><label>Fit / notes<textarea id="manualVenueReason" class="form-input form-textarea" rows="3" placeholder="Why this room fits, contact history, deal notes…"></textarea></label><div class="route-stop-actions"><button class="btn-primary" onclick="RouteAdmin.addManualVenue(${idx})">Add Contact Option + Save</button><button class="btn-secondary" onclick="RouteAdmin.openStop(${idx})">Cancel</button></div></div>`;
  }
  async function addManualVenue(idx){
    const t=activeRoute(); const l=t?.legs?.[idx]; if(!l) return;
    const name=val('manualVenueName'); if(!name){ toast('Venue name is required','error'); return; }
    const venue={name,address:val('manualVenueAddress'),capacity:val('manualVenueCapacity'),booking_method:val('manualVenueBooking')||'manual',website:val('manualVenueWebsite'),email:val('manualVenueEmail'),fit_reason:val('manualVenueReason')||'Manually added venue option.',outreach_angle:val('manualVenueReason')||'Manual venue option',manual:true,added_at:new Date().toISOString()};
    l.candidate_venues=Array.isArray(l.candidate_venues)?l.candidate_venues:[];
    l.candidate_venues.unshift(venue);
    if(!l.suggested_venue) { l.suggested_venue=name; l.venue_address=venue.address||''; }
    await upsertVenueToMaster(venue,l,'manual_route_add').catch(()=>null);
    try{ if(t.id) await persistStop(idx,l); toast(t.id?'✓ Manual venue added, saved, and added to Contact Manager':'✓ Manual venue added to draft and Contact Manager','success'); rerenderActiveRoute(); openStop(idx); }
    catch(e){ toast('Manual venue save failed: '+e.message,'error'); }
  }
  function renderVenueBoard(){
    const t=activeRoute(); const out=toolOut();
    if(!t?.legs?.length){ out.innerHTML=errorBox('No active route','Generate or open a route first.'); return; }
    const stops=t.legs.map((l,i)=>({l,i})).filter(x=>!x.l.day_off);
    out.innerHTML=`<div class="route-tool-card route-venue-board"><h3>Venue Finder Board</h3><p>Research, manually add, or select venue options for every listed city. Saved tours persist each venue move to Firestore.</p><div class="route-stop-actions"><button class="btn-primary" onclick="RouteAdmin.researchVenuesAllStops()">Research All Cities</button></div>${stops.map(({l,i})=>`<section class="route-venue-city"><div class="route-venue-city-head"><div><b>${esc(i+1)}. ${esc(l.city||'TBD')}</b><span>${esc([l.date,l.country].filter(Boolean).join(' · '))}</span></div><div><button class="btn-secondary btn-sm" onclick="RouteAdmin.venueFinderForStop(${i})">Find Venues</button><button class="btn-secondary btn-sm" onclick="RouteAdmin.manualVenueForm(${i})">Manual Add</button><button class="btn-secondary btn-sm" onclick="RouteAdmin.openStop(${i})">Stop Detail</button></div></div>${Array.isArray(l.candidate_venues)&&l.candidate_venues.length?l.candidate_venues.slice(0,8).map((v,vi)=>`<div class="route-venue-row"><strong>${esc(v.name||'Venue')}</strong><span>${esc(venueMeta(v))}</span><p>${esc(v.fit_reason||v.reason||v.outreach_angle||'')}</p><div class="route-venue-actions"><button class="btn-secondary btn-sm" onclick="RouteAdmin.useCandidateVenue(${i},${vi})">Use Venue</button><button class="btn-secondary btn-sm" onclick="RouteAdmin.generateVenueEmail(${i},${vi})">Email</button>${v.website?`<a class="btn-secondary btn-sm" href="${attr(v.website)}" target="_blank">Site</a>`:''}</div></div>`).join(''):'<div class="route-ai-empty">No venue options yet. Use Find Venues or Manual Add.</div>'}</section>`).join('')}</div>`;
  }
  async function assistantAsk(){
    const input=$('routeAssistantInput'); const log=$('routeAssistantLog'); const q=(input?.value||'').trim(); if(!q) return;
    const t=activeRoute()||{}; if(log) log.innerHTML=`<div class="route-loading"><span></span>Reading route data and asking Booking AI…</div>`;
    try{
      const data=await ai('assistant_edit_route',{question:q,tour:t,legs:t.legs||[],shows:currentShows||[],currency:currencyOf(t)});
      lastAssistantPatch=data.route_patch||null;
      const patchHasChanges=lastAssistantPatch && (Object.keys(lastAssistantPatch.tour_updates||{}).length || (lastAssistantPatch.leg_updates||[]).length || (lastAssistantPatch.add_candidate_venues||[]).length || (lastAssistantPatch.add_legs||[]).length || (lastAssistantPatch.delete_leg_indices||[]).length);
      if(log) log.innerHTML=`<div class="route-tool-card"><h3>Booking AI</h3><p>${esc(data.answer||data.summary||'I reviewed the active route.')}</p>${data.warnings?.length?`<div class="route-warning-list"><b>Warnings</b><ul>${data.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></div>`:''}${patchHasChanges?`<details open><summary>Proposed changes</summary><pre>${esc(JSON.stringify(lastAssistantPatch,null,2))}</pre></details><button class="btn-primary" onclick="RouteAdmin.applyAssistantPatch()">Apply Proposed Changes + Save</button>`:''}${renderSuggestedActions(data.suggested_actions||[])}</div>`;
      input.value='';
    }catch(e){ if(log) log.innerHTML=errorBox('Assistant failed',e.message); }
  }
  async function applyAssistantPatch(){
    const t=activeRoute(); const p=lastAssistantPatch; if(!t||!p) return;
    try{
      const protectedKeys=new Set(['id','created_at','created_date','created_by','deleted_at']);
      Object.entries(p.tour_updates||{}).forEach(([k,v])=>{ if(!protectedKeys.has(k) && k!=='legs' && k!=='shows') t[k]=v; });
      (p.leg_updates||[]).forEach(ch=>{ const i=Number(ch.leg_index); if(Number.isInteger(i)&&t.legs?.[i]) Object.entries(ch.updates||{}).forEach(([k,v])=>{ if(!protectedKeys.has(k)) t.legs[i][k]=v; }); });
      (p.add_candidate_venues||[]).forEach(ch=>{ const i=Number(ch.leg_index); if(Number.isInteger(i)&&t.legs?.[i]){ t.legs[i].candidate_venues=Array.isArray(t.legs[i].candidate_venues)?t.legs[i].candidate_venues:[]; t.legs[i].candidate_venues.unshift({...ch.venue, ai_assistant_added:true, added_at:new Date().toISOString()}); }});
      (p.delete_leg_indices||[]).map(Number).filter(i=>Number.isInteger(i)).sort((a,b)=>b-a).forEach(i=>{ if(t.legs?.[i]) t.legs.splice(i,1); });
      (p.add_legs||[]).forEach(l=>{ t.legs=t.legs||[]; t.legs.push({...l, booking_status:l.booking_status||'prospect', deal_status:l.deal_status||'not_started', candidate_venues:Array.isArray(l.candidate_venues)?l.candidate_venues:[]}); });
      t.total_shows=(t.legs||[]).filter(l=>!l.day_off).length; t.total_days=(t.legs||[]).length;
      if(t.id) await persistWholeRoute('Assistant changes saved', true); else toast('✓ Assistant changes applied to draft','success');
      lastAssistantPatch=null; rerenderActiveRoute(); await renderMap(t.legs||[]); const log=$('routeAssistantLog'); if(log) log.innerHTML='<div class="route-ai-empty">✓ Changes applied. Ask for the next adjustment anytime.</div>';
    }catch(e){ toast('Assistant patch failed: '+e.message,'error'); }
  }

  function renumberLegs(t){ (t.legs||[]).forEach((l,i)=>{ l.day=i+1; }); t.total_days=(t.legs||[]).length; t.total_shows=(t.legs||[]).filter(l=>!l.day_off).length; return t; }
  async function persistAndRerenderRoute(reason='Route updated', replaceShows=true){
    const t=activeRoute(); if(!t) return;
    renumberLegs(t);
    if(t.id) await persistWholeRoute(reason, replaceShows);
    rerenderActiveRoute(); await renderMap(t.legs||[]);
    toast(t.id?`✓ ${reason}`:`✓ ${reason} in draft`, 'success');
  }
  async function insertBlankDayAfter(afterIdx=null, opts={}){
    const t=activeRoute(); if(!t) return;
    if(!Array.isArray(t.legs)) t.legs=[];
    let idx = Number(afterIdx);
    if(!Number.isInteger(idx) || idx < 0) {
      const answer = prompt('Insert blank/recovery day after which stop number?', String(Math.max(1,(t.legs||[]).length)));
      if(answer===null) return;
      idx = Math.max(0, Math.min((t.legs||[]).length-1, Number(answer)-1 || 0));
    }
    const prev=t.legs[idx] || t.legs[t.legs.length-1] || {};
    const date=opts.date || addDaysISO(prev.date,1);
    for(let i=idx+1;i<t.legs.length;i++){ if(t.legs[i]?.date) t.legs[i].date=addDaysISO(t.legs[i].date,1); }
    const blank={date, city:opts.city||prev.city||'', country:opts.country||prev.country||'', day_off:true, suggested_venue:'', booking_status:'day_off', deal_status:'not_started', candidate_venues:[], drive_hours:0, drive_from_previous_km:0, travel_feasibility:'recovery_day', hotel_responsibility:'agency', backline_needed:'none', next_action:'Recovery / routing buffer day', notes:opts.reason||opts.note||'Blank day inserted to reduce schedule pressure.'};
    t.legs.splice(idx+1,0,blank); renumberLegs(t);
    await persistAndRerenderRoute('Blank/recovery day inserted', true);
    openStop(idx+1);
  }
  async function convertBlankDayToProspect(idx){
    const t=activeRoute(); const l=t?.legs?.[idx]; if(!l) return;
    l.day_off=false; l.booking_status='prospect'; l.deal_status=l.deal_status||'not_started'; l.next_action=l.next_action||'Research venues and send availability inquiry.';
    if(!Array.isArray(l.candidate_venues)) l.candidate_venues=[];
    await persistAndRerenderRoute('Blank day converted to prospect', true);
    openStop(idx);
  }
  function reviewChangeActions(review={}){
    const changes=Array.isArray(review.recommended_changes)?review.recommended_changes:[];
    return changes.map(c=>{
      const text=[c.label,c.reason,c.action,typeof c.payload==='string'?c.payload:JSON.stringify(c.payload||{})].join(' ').toLowerCase();
      if(/recovery|buffer|day off|blank day|rest day/.test(text)) return {label:c.label||'Insert recovery day',action:'insert_blank_day',leg_index:c.leg_index,payload:{reason:c.reason||c.payload||'AI recommended adding a buffer/recovery day.'}};
      if(c.action) return {label:c.label||c.action,action:c.action,leg_index:c.leg_index,payload:c.payload||{}};
      return null;
    }).filter(Boolean);
  }
  function renderReviewOutput(review, cached=false){
    const verdict=(review?.verdict||'review').replace(/_/g,' ');
    const actions=[...(review?.suggested_actions||[]), ...reviewChangeActions(review)];
    return `<div class="route-tool-card route-review-card"><div class="route-tool-head"><h3>AI Oversight — ${esc(verdict)}${cached?' <span class="route-cache-pill">saved</span>':''}</h3><div class="route-stop-actions"><button class="btn-secondary btn-sm" onclick="RouteAdmin.reviewCurrentRoute(false,true)">Regenerate Review</button><button class="btn-secondary btn-sm" onclick="RouteAdmin.insertBlankDayAfter()">Add Blank Day</button></div></div>${renderObject(review)}${renderSuggestedActions(actions)}<div class="route-context-chat"><h4>Respond to this review</h4><textarea id="routeReviewChatInput" class="form-input form-textarea" rows="3" placeholder="e.g. Add a rest day after WGT, but keep Paris and London fixed…"></textarea><button class="btn-primary" onclick="RouteAdmin.askAboutCurrentReview()">Ask AI / Propose Fix</button></div></div>`;
  }
  async function askAboutCurrentReview(){
    const q=val('routeReviewChatInput'); if(!q) return toast('Type what you want to do about the review first.','error');
    const input=$('routeAssistantInput'); if(input) input.value=`Using the saved AI Oversight review, ${q}`;
    await assistantAsk();
  }
  function renderPipelineAnalysisOutput(data, cached=false){
    return `<div class="route-tool-card"><div class="route-tool-head"><h3>Current Route Pipeline Analysis ${cached?'<span class="route-cache-pill">saved</span>':''}</h3><div class="route-stop-actions"><button class="btn-secondary btn-sm" onclick="RouteAdmin.analyzeCurrentAnchors(true)">Regenerate Analysis</button></div></div>${renderObject(data)}${renderSuggestedActions(data?.suggested_actions||[])}</div>`;
  }

  function renderBudgetAnalysisOutput(data, cached=false){
    return `<div class="route-tool-card"><div class="route-tool-head"><h3>Budget Estimate ${cached?'<span class="route-cache-pill">saved</span>':''}</h3><div class="route-stop-actions"><button class="btn-secondary btn-sm" onclick="RouteAdmin.estimateBudget(true)">Regenerate Budget</button></div></div>${renderObject(data)}${renderSuggestedActions(data?.suggested_actions||[])}</div>`;
  }

  async function saveGenerated(){
    if(!currentGenerated) return;
    try{
      let saved;
      if(currentGenerated.id){
        const updates={...currentGenerated, updated_at:new Date().toISOString()};
        delete updates.shows;
        saved = await api({action:'updateTour', id:currentGenerated.id, updates, replaceShows:true});
      } else {
        saved = await api({action:'createTour', tour:currentGenerated, createShows:true});
      }
      currentGenerated = normalizeTour(saved, currentGenerated);
      toast(`✓ Saved ${currentGenerated.total_shows||0} shows to advancing`, 'success');
      await initRoutePlannerAdmin(); if(currentGenerated.id) openTour(currentGenerated.id);
    }
    catch(e){ toast('Save failed: '+e.message,'error'); }
  }
  async function reviewCurrentRoute(auto=false, force=false){
    const t=currentGenerated||currentTour; if(!t) return;
    const out=toolOut();
    if(!force && t.route_review){ if(out) out.innerHTML=renderReviewOutput(t.route_review,true); return; }
    if(out) out.innerHTML=loading(auto?'Running second-pass AI oversight…':'Reviewing route reasonability…');
    try{
      const review=await ai('review_route',{tour:t,artist:t.artist,region:t.region,requested_shows:t.requested_shows||t.total_shows,legs:t.legs||[]});
      t.route_review = review;
      if(t.id) api({action:'updateTour',id:t.id,updates:{route_review:review}}).catch(()=>{});
      const verdict=(review.verdict||'review').replace(/_/g,' ');
      if(out) out.innerHTML=renderReviewOutput(review,false);
      toast(`✓ AI oversight complete: ${verdict}`,'success');
    }catch(e){ if(out) out.innerHTML=errorBox('AI oversight failed',e.message); if(!auto) toast('AI oversight failed: '+e.message,'error'); }
  }
  async function runSuggestedAction(action){
    const a=action||{}; const idx=Number.isInteger(a.leg_index)?a.leg_index:(a.leg_index==null?null:Number(a.leg_index));
    switch(a.action){
      case 'optimize_route': return optimizeCurrent();
      case 'estimate_budget': return estimateBudget();
      case 'research_venues_all': return researchVenuesAllStops();
      case 'venue_finder_stop': return venueFinderForStop(Number.isInteger(idx)?idx:0);
      case 'open_stop': return openStop(Number.isInteger(idx)?idx:0);
      case 'generate_email_stop': return generateEmail(Number.isInteger(idx)?idx:0);
      case 'analyze_anchors': return analyzeCurrentAnchors();
      case 'save_tour': return saveGenerated();
      case 'insert_blank_day': return insertBlankDayAfter(Number.isInteger(idx)?idx:null, a.payload||{});
      case 'add_blank_day': return insertBlankDayAfter(Number.isInteger(idx)?idx:null, a.payload||{});
      default: toast('Suggested action is advisory only: '+(a.label||a.action||'Unknown'),'error');
    }
  }
  async function optimizeGenerated(){ return optimizeCurrent(); }
  async function optimizeSaved(){ return optimizeCurrent(); }
  async function optimizeCurrent(){
    const t = currentGenerated || currentTour; if(!t?.legs?.length) return;
    const out = toolOut(); out.innerHTML = loading('Optimizing route order with Gemini 3…');
    try{
      const result = await ai('optimize_route',{artist:t.artist,region:t.region,legs:t.legs,startDate:t.startDate,endDate:t.endDate});
      const optimized = result.optimized_legs || result.legs || t.legs;
      const next = normalizeTour({...t, legs:optimized, routing_strategy:result.routing_notes||result.routing_strategy||t.routing_strategy, estimated_total_km:result.total_km_estimate||t.estimated_total_km}, t);
      if(currentGenerated){ currentGenerated = next; renderGenerated(next,next); } else { currentTour = next; await persistWholeRoute('Optimized route saved', true); renderDetail(currentTour); await renderMap(currentTour.legs||[]); }
      const box = toolOut(); if(box) box.innerHTML = renderAnalysisCard('Route Optimized', result);
      toast('✓ Optimized route ready','success');
    } catch(e){ out.innerHTML = errorBox('Optimization failed', e.message); }
  }
  async function estimateBudget(force=false){
    const t = currentGenerated || currentTour; if(!t) return;
    const out = toolOut();
    if(!force && t.budget_estimate){ out.innerHTML = renderBudgetAnalysisOutput(t.budget_estimate,true); return; }
    out.innerHTML = loading('Estimating budget…');
    try{ const data=await ai('estimate_budget',{tour:t,legs:t.legs||[]}); t.budget_estimate=data; if(t.id) api({action:'updateTour',id:t.id,updates:{budget_estimate:data}}).catch(()=>{}); out.innerHTML = renderBudgetAnalysisOutput(data,false); }
    catch(e){ out.innerHTML = errorBox('Budget failed', e.message); }
  }
  async function suggestVenues(idx){
    const t=currentGenerated||currentTour; const leg=t?.legs?.[idx]; if(!leg) return;
    const out=toolOut(); out.innerHTML=loading(`Finding contacts in ${leg.city}…`);
    try{
      const data=await ai('suggest_venues',{artist:t.artist,city:leg.city,country:leg.country,genre_context:'darkwave, EBM, post-punk, industrial, underground',capacity:'150-600',tour:t});
      const venues=data.venues||data.suggestions||data.recommendations||(Array.isArray(data)?data:[]);
      out.innerHTML=`<div class="route-tool-card"><h3>Contact Suggestions — ${esc(leg.city)}</h3>${venues.length?venues.map(v=>`<div class="route-venue-row"><strong>${esc(v.name||v.venue||v.title||'Venue')}</strong><span>${esc([v.capacity?v.capacity+' cap':'',v.type,v.tier,v.suitability].filter(Boolean).join(' · '))}</span><p>${esc(v.booking_contact_tip||v.notes||v.known_for||v.reasoning||v.strategic_note||'')}</p></div>`).join(''):renderObject(data)}</div>`;
    } catch(e){ out.innerHTML=errorBox('Venue search failed',e.message); }
  }

  async function researchVenuesAllStops(){
    const t=currentGenerated||currentTour; if(!t?.legs?.length) return;
    const stops=t.legs.map((l,i)=>({l,i})).filter(x=>!x.l.day_off);
    const out=toolOut(); out.innerHTML=loading(`Running grounded Venue Finder for ${stops.length} stops… this may take a bit.`);
    let ok=0, failed=0;
    for(const {l,i} of stops){
      try{
        l.candidate_venues = await runGroundedContactFinder([l.city,l.country].filter(Boolean).join(', '),'darkwave, EBM, post-punk, industrial, goth, synth',700);
        await Promise.allSettled(l.candidate_venues.map(v=>upsertVenueToMaster(v,l,'route_research_all')));
        if(!l.suggested_venue && l.candidate_venues[0]) l.suggested_venue=l.candidate_venues[0].name;
        if(t.id) await persistStop(i,l);
        ok++;
        out.innerHTML=loading(`Contact research ${ok}/${stops.length} complete…`);
      }catch(e){ failed++; }
    }
    rerenderActiveRoute();
    out.innerHTML=`<div class="route-tool-card"><h3>Contact research complete</h3><p>${ok} stops researched${failed?`, ${failed} failed`:''}. Open any stop to see ranked venues and branded email buttons.</p></div>`;
    toast(t.id?'✓ Venue targets saved to Firestore':'✓ Venue targets attached to route draft', failed?'error':'success');
  }
  function useCandidateVenue(idx, venueIdx){
    const t=activeRoute(); const l=t?.legs?.[idx]; const v=l?.candidate_venues?.[venueIdx]; if(!l||!v) return;
    l.suggested_venue = v.name || l.suggested_venue;
    l.venue_address = v.address || l.venue_address || '';
    if(t.id) persistStop(idx,l).then(()=>toast('✓ Contact selected and saved','success')).catch(e=>toast('Save failed: '+e.message,'error'));
    else toast('✓ Contact selected for draft stop','success');
    rerenderActiveRoute(); openStop(idx);
  }
  async function generateVenueEmail(idx, venueIdx){
    const t=currentGenerated||currentTour; const leg=t?.legs?.[idx]; const v=leg?.candidate_venues?.[venueIdx];
    if(!leg||!v) return generateEmail(idx);
    return generateEmail(idx, v.name || v.venue || '', v);
  }

  async function generateEmail(idx, venueOverride='', venueData=null){
    const t=currentGenerated||currentTour; const leg=t?.legs?.[idx]; if(!leg) return;
    const venueName = venueOverride || leg.suggested_venue;
    const out=toolOut(); out.innerHTML=loading(`Generating branded email for ${venueName||leg.city}…`);
    try{ const email=await post(EMAIL_API,{emailType:'booking_inquiry',data:{artist:t.artist,artistContext:findArtistContext(t.artist),tour:t,city:leg.city,country:leg.country,venue:venueName,venueData,date:leg.date,deal:leg.deal_suggestion,rate_target_usd:leg.rate_target_usd,travel_mode:leg.travel_mode_recommendation,booking_context:leg.public_booking_context||''}}); out.innerHTML=renderEmailOutput(email, `Booking Inquiry Email — ${venueName||leg.city}`); }
    catch(e){ out.innerHTML=errorBox('Email generation failed',e.message); }
  }
  async function adviseDeal(idx){
    const t=currentGenerated||currentTour; const leg=t?.legs?.[idx]; if(!leg) return;
    const offer = prompt(`Offer/deal to evaluate for ${leg.city}:`, leg.deal_suggestion || ''); if(offer===null) return;
    const out=toolOut(); out.innerHTML=loading('Evaluating deal…');
    try{ out.innerHTML=`<div class="route-tool-card"><h3>Deal Advisor — ${esc(leg.city)}</h3>${renderObject(await ai('advise_deal',{artist:t.artist,tour:t,city:leg.city,country:leg.country,venue:leg.suggested_venue,offer}))}</div>`; }
    catch(e){ out.innerHTML=errorBox('Deal advisor failed',e.message); }
  }
  async function chatAgent(){
    const q = prompt('Ask the booking AI about this tour:'); if(!q) return;
    const t=currentGenerated||currentTour||{}; const out=toolOut(); out.innerHTML=loading('Consulting booking AI…');
    try{ const data=await ai('chat',{question:q,tour:t,legs:t.legs||[]}); out.innerHTML=`<div class="route-tool-card"><h3>Booking AI</h3>${renderObject(data)}${renderSuggestedActions(data.suggested_actions||[])}</div>`; }
    catch(e){ out.innerHTML=errorBox('Booking AI failed',e.message); }
  }
  async function analyzeCurrentAnchors(force=false){ const t=currentGenerated||currentTour; if(!t) return analyzeAnchors(); const out=toolOut(); if(!force && t.pipeline_analysis){ out.innerHTML=renderPipelineAnalysisOutput(t.pipeline_analysis,true); return; } out.innerHTML=loading('Analyzing current route anchors…'); try{ const data=await ai('analyze_anchors',{tour:t,artist:t.artist,region:t.region,legs:t.legs||[]}); t.pipeline_analysis=data; if(t.id) api({action:'updateTour',id:t.id,updates:{pipeline_analysis:data}}).catch(()=>{}); out.innerHTML=renderPipelineAnalysisOutput(data,false); } catch(e){ out.innerHTML=errorBox('Anchor analysis failed', e.message); } }

  async function openTour(id){
    const root=$('routeAdminShell'); root.innerHTML=loading('Opening tour workspace…');
    try{ const data=await api({action:'getTour',id}); currentTour=normalizeTour(data,data); currentGenerated=null; currentShows=data.shows||[]; renderDetail(currentTour); await renderMap(currentTour.legs||[]); }
    catch(e){ root.innerHTML=errorBox('Could not open tour', e.message); }
  }
  function renderDetail(t){
    $('routeAdminShell').innerHTML=`
      <section class="route-plan-shell">
        <div class="route-plan-topbar"><button class="btn-secondary btn-sm" onclick="RouteAdmin.init()">← Tour Library</button><div><p class="route-kicker">Saved tour workspace</p><h1>${esc(t.name||t.tour_name||'Untitled Tour')}</h1><span>${esc(t.artist||'')} · ${esc(t.region||'')} · ${esc(normalizeDateRange(t))}</span></div><div class="route-command-actions"><button class="btn-secondary btn-sm" onclick="RouteAdmin.renderVenueBoard()">Contact Board</button><button class="btn-secondary btn-sm" onclick="RouteAdmin.renderTravelOpsBoard()">Travel Ops</button><button class="btn-secondary btn-sm" onclick="RouteAdmin.renderTravelAlertCenter()">Alerts</button><button class="btn-secondary btn-sm" onclick="RouteAdmin.renderTravelHotelModule()">Travel + Hotels</button><button class="btn-secondary btn-sm" onclick="RouteAdmin.systemTour()">Help</button><button class="btn-secondary btn-sm" onclick="RouteAdmin.duplicateTour('${attr(t.id)}')">Duplicate</button><button class="btn-danger btn-sm" onclick="RouteAdmin.deleteTour('${attr(t.id)}')">Delete</button></div></div>
        <div class="route-detail-grid">
          <section class="route-map-card"><div class="route-panel-title"><span>Saved route map</span><em>${esc(t.summary||t.routing_strategy||'')}</em></div><div id="routeMap" class="route-map route-map-detail"><div class="route-map-placeholder">Loading route map…</div></div></section>
          <section class="route-output-panel"><div class="route-panel-title"><span>AI workbench</span><em>Continue refining this saved tour.</em></div><div id="routeToolOutput">${renderWorkbench(t)}</div></section>
        </div>
        <section class="route-output-panel"><div class="route-panel-title"><span>Route legs</span><em>${currentShows.length} Firestore show records linked.</em></div>${routeMetrics(t)}${renderBudgetTicker(t)}${renderKanban(t)}<div class="route-leg-list">${(t.legs||[]).map(legRow).join('')}</div></section>
        <section class="route-output-panel"><div class="route-panel-title"><span>Advancing show records</span><em>Generated from saved route legs.</em></div><div class="route-show-grid">${currentShows.length?currentShows.map(showRow).join(''):'<div class="route-empty-small">No show records found.</div>'}</div></section>
        ${renderRouteHelpSections(true)}
        ${renderAssistantDock()}
      </section>`;
  }
  function showRow(s){ return `<div class="route-card"><div class="route-card-top"><div><div class="route-card-artist">${esc(s.status||'draft')}</div><h3>${esc(s.venue_name||s.city||'Show')}</h3></div></div><div class="route-card-meta"><span>${esc(s.date||'')}</span><span>${esc([s.city,s.country].filter(Boolean).join(', '))}</span></div><p>${esc([s.advancing_notes||'Ready for advancing details.', s.travel_mode_recommendation?('Travel: '+s.travel_mode_recommendation):'', s.hotel_responsibility?('Hotel: '+s.hotel_responsibility):'', s.backline_needed?('Backline: '+s.backline_needed):''].filter(Boolean).join(' · '))}</p></div>`; }
  async function duplicateTour(id){ const source=tours.find(t=>t.id===id) || currentTour; if(!source) return; const copy={...source,id:undefined,name:(source.name||source.tour_name||'Tour')+' Copy',tour_name:(source.tour_name||source.name||'Tour')+' Copy',status:'draft'}; try{ const saved=await api({action:'createTour',tour:copy,createShows:false}); toast('✓ Tour duplicated','success'); await initRoutePlannerAdmin(); if(saved.id) openTour(saved.id); } catch(e){ toast('Duplicate failed: '+e.message,'error'); } }
  async function deleteTour(id){ if(!confirm('Archive/delete this route and its generated show records?')) return; try{ await api({action:'deleteTour',id}); toast('✓ Route archived','success'); await initRoutePlannerAdmin(); } catch(e){ toast('Delete failed: '+e.message,'error'); } }

  async function ensureMap(){
    if(window.google?.maps){ mapReady=true; return; }
    if(document.getElementById('googleMapsScript')) return new Promise(resolve=>{ const iv=setInterval(()=>{ if(window.google?.maps){ clearInterval(iv); mapReady=true; resolve(); }},150); });
    const cfg=await fetch(MAPS_CONFIG).then(r=>r.json());
    const key=cfg.apiKey||cfg.key;
    if(!key) throw new Error('Google Maps key missing');
    await new Promise((resolve,reject)=>{ const s=document.createElement('script'); s.id='googleMapsScript'; s.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=marker`; s.onload=()=>{mapReady=true;resolve();}; s.onerror=()=>reject(new Error('Google Maps failed to load')); document.head.appendChild(s); });
  }
  function continentView(){
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if(tz.includes('America')) return {center:{lat:39,lng:-98},zoom:4,label:'North America'};
    if(tz.includes('Europe')) return {center:{lat:50,lng:10},zoom:4,label:'Europe'};
    if(tz.includes('Australia')||tz.includes('Pacific')) return {center:{lat:-25,lng:134},zoom:4,label:'Australia / Pacific'};
    if(tz.includes('Asia')) return {center:{lat:34,lng:90},zoom:3,label:'Asia'};
    return {center:{lat:30,lng:5},zoom:3,label:'Global'};
  }
  async function renderStarterMap(){
    const el=$('routeMap'); if(!el) return;
    try{ await ensureMap(); const view=continentView(); map=new google.maps.Map(el,{center:view.center,zoom:view.zoom,mapTypeId:'roadmap',disableDefaultUI:false,styles:darkMapStyle()}); el.classList.add('loaded'); }
    catch(e){ el.innerHTML=`<div class="route-map-placeholder route-map-fallback"><strong>${esc(continentView().label)} planning map</strong><span>Map key unavailable: ${esc(e.message)}</span></div>`; }
  }
  function clearMap(){ mapMarkers.forEach(m=>m.setMap(null)); mapLines.forEach(l=>l.setMap(null)); mapMarkers=[]; mapLines=[]; }
  async function geocode(city,country){
    const q=[city,country].filter(Boolean).join(', '); if(!q) return null;
    try{ const res=await fetch(MAPS_PROXY,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'geocode',address:q})}).then(r=>r.json()); const loc=res.results?.[0]?.geometry?.location || res.data?.results?.[0]?.geometry?.location; return loc ? {lat:loc.lat,lng:loc.lng} : null; } catch { return null; }
  }
  async function renderMap(legs){
    const el=$('routeMap'); if(!el) return;
    try{
      await ensureMap();
      if(!map) map=new google.maps.Map(el,{center:continentView().center,zoom:continentView().zoom,mapTypeId:'roadmap',disableDefaultUI:false,styles:darkMapStyle()});
      clearMap();
      const pts=[];
      for(const [i,l] of (legs||[]).entries()){
        if(l.day_off) continue;
        const loc=(l.lat&&l.lng)?{lat:Number(l.lat),lng:Number(l.lng)}:await geocode(l.city,l.country);
        if(loc){
          l.lat=loc.lat; l.lng=loc.lng; pts.push(loc);
          const marker=new google.maps.Marker({position:loc,map,label:{text:String(i+1),color:'#fff',fontWeight:'700'},title:[l.city,l.suggested_venue].filter(Boolean).join(' · '),draggable:true,icon:markerIcon(l)});
          marker.addListener('click',()=>openStop(i));
          marker.addListener('dragend',()=>handleMarkerDrop(i,marker));
          mapMarkers.push(marker);
        }
      }
      if(pts.length){ const line=new google.maps.Polyline({path:pts,geodesic:true,strokeColor:'#c8a96e',strokeOpacity:.95,strokeWeight:2,map}); mapLines.push(line); const bounds=new google.maps.LatLngBounds(); pts.forEach(p=>bounds.extend(p)); map.fitBounds(bounds,{top:50,right:50,bottom:50,left:50}); }
      else { await renderStarterMap(); }
    } catch(e){ el.innerHTML=`<div class="route-map-placeholder route-map-fallback">Map unavailable: ${esc(e.message)}</div>`; }
  }
  function darkMapStyle(){ return [{elementType:'geometry',stylers:[{color:'#101010'}]},{elementType:'labels.text.stroke',stylers:[{color:'#101010'}]},{elementType:'labels.text.fill',stylers:[{color:'#888'}]},{featureType:'water',elementType:'geometry',stylers:[{color:'#050505'}]},{featureType:'road',elementType:'geometry',stylers:[{color:'#242424'}]},{featureType:'poi',stylers:[{visibility:'off'}]},{featureType:'transit',stylers:[{visibility:'off'}]}]; }

  function systemTour(){
    $('routeAdminShell').innerHTML = `<section class="route-guide"><button class="btn-secondary btn-sm" onclick="RouteAdmin.init()">← Back to Planner</button><div class="route-mini-brand"><img src="/images/logo-mark-white.svg" alt=""><div><b>Route Planner</b><span>Operating model</span></div></div><h1>How to use the planner repeatedly</h1><div class="route-guide-grid"><section><b>1. Tour Library</b><p>Every draft and saved route lives in the left rail. Open, duplicate, delete/archive, and refresh from one place.</p></section><section><b>2. Map-first Builder</b><p>The planning page starts with your continent map, then plots generated and saved routing legs.</p></section><section><b>3. Anchors</b><p>Start from confirmed weekend/festival shows. AI analyzes gaps and builds around them.</p></section><section><b>4. AI Workbench</b><p>Generate, optimize, budget, suggest venues, advise deals, chat, and create branded emails without leaving the route.</p></section><section><b>5. Persistence</b><p>Save writes the tour and creates draft show records for advancing.</p></section><section><b>6. Iteration</b><p>Open the same tour repeatedly, duplicate versions, compare routing, and archive dead drafts.</p></section></div></section>`;
  }


  let venueManagerRows = [];
  let venueManagerAllRows = [];
  let venueManagerFilters = {query:'',city:'',country:'',genre:'',capacity:''};
  let venueManagerMode = 'master';
  function parseCapacity(v){ const n=String(v||'').match(/\d{2,5}/); return n?Number(n[0]):(Number(v)||null); }
  function masterVenueFrom(v={}, leg={}, source='unknown'){
    const notes=[v.notes,v.fit_reason,v.reason,v.outreach_angle,v.description].filter(Boolean).join(' · ');
    return {
      id:v.id || v.crm_id || undefined,
      contact_type:v.contact_type || v.type || (source.includes('promoter')?'promoter':'venue'),
      name:v.name || v.venue || v.title || '',
      city:v.city || leg.city || '', country:v.country || leg.country || '', region:v.region || '',
      address:v.address || v.venue_address || v.formatted_address || '',
      capacity:parseCapacity(v.actual_capacity || v.capacity || v.capacity_display), actual_capacity:parseCapacity(v.actual_capacity || v.capacity || v.capacity_display),
      rating:v.rating || null, relationship_status:v.relationship_status || v.status || 'discovered', buyer_status:v.buyer_status || '',
      booking_email:v.booking_email || v.email || '', phone:v.phone || v.telephone || '', website:v.website || v.url || '', instagram:v.instagram || '',
      booking_method:v.booking_method || v.booking_form_url || (v.email?'email':'unknown'), booking_form_url:v.booking_form_url || '',
      genre_affinity:v.genre_affinity || v.genres || ['darkwave','EBM','post-punk','industrial','goth'],
      notes:notes || `Discovered via ${source}.`, last_found_source:source, last_found_at:new Date().toISOString(), source_tags:Array.from(new Set([...(Array.isArray(v.source_tags)?v.source_tags:[]), source].filter(Boolean)))
    };
  }
  async function upsertVenueToMaster(v, leg={}, source='unknown'){
    const venue=masterVenueFrom(v,leg,source);
    if(!venue.name || !venue.city) return null;
    return post(RAG_VENUES_API,{action:'upsert',skip_embeddings:true,venue});
  }
  function venueRating(r){ const n=Number(r||0); return n?`${'★'.repeat(Math.max(1,Math.min(5,n)))}${'☆'.repeat(5-Math.max(1,Math.min(5,n)))}`:'not rated'; }
  function venueCard(v,i){ return `<article class="venue-manager-card"><div><strong>${esc(v.name||'Venue')}</strong><span>${esc([v.contact_type||'contact',v.city,v.country,v.capacity?`cap ${v.capacity}`:'cap unknown',venueRating(v.rating)].filter(Boolean).join(' · '))}</span><p>${esc(v.notes||v.rag_text||'')}</p><em>${esc([v.booking_email||v.booking_method,v.phone,v.relationship_status].filter(Boolean).join(' · '))}</em></div><div class="route-stop-actions"><button class="btn-secondary btn-sm" onclick="VenueManager.edit(${i})">Edit</button><button class="btn-secondary btn-sm" onclick="VenueManager.sendToRoute(${i})">Send To Current Route</button>${v.website?`<a class="btn-secondary btn-sm" href="${attr(v.website)}" target="_blank">Site</a>`:''}</div></article>`; }
  function renderVenueManager(rows=venueManagerRows,note=''){
    const root=$('venueAdminShell'); if(!root) return;
    venueManagerRows=Array.isArray(rows)?rows:[];
    const shown=venueManagerRows.slice(0,80);
    root.innerHTML=`<section class="route-ops-shell venue-manager-shell"><aside class="route-library-panel"><div class="route-mini-brand"><img src="/images/logo-mark-white.svg" alt=""><div><b>Contact Manager</b><span>Promoters, venues + booking contacts</span></div></div><button class="btn-primary route-full-btn" onclick="VenueManager.newVenue()">+ Add Contact</button><div class="route-library-tools"><input id="vmQuery" class="form-input" placeholder="Instant search name, city, country, phone, email, notes…" value="${attr(venueManagerFilters.query||'')}" oninput="VenueManager.filter()"><div class="route-two-col"><input id="vmCity" class="form-input" placeholder="City" value="${attr(venueManagerFilters.city||'')}" oninput="VenueManager.filter()"><input id="vmCountry" class="form-input" placeholder="Country" value="${attr(venueManagerFilters.country||'')}" oninput="VenueManager.filter()"></div><div class="route-two-col"><input id="vmGenre" class="form-input" placeholder="Genre / scene" value="${attr(venueManagerFilters.genre||'')}" oninput="VenueManager.filter()"><input id="vmCapacity" class="form-input" placeholder="Target cap" value="${attr(venueManagerFilters.capacity||'')}" oninput="VenueManager.filter()"></div><button class="btn-secondary route-full-btn" onclick="VenueManager.search()">Search Deep / Semantic</button><button class="btn-secondary route-full-btn" onclick="VenueManager.findWeb()">Find Promoters/Venues + Add Results</button><button class="btn-secondary route-full-btn" onclick="VenueManager.load()">Show Full Contact List</button></div><div class="route-help-card"><h2>How this works</h2><p>Promoters and venues live in Firestore. Route searches, manual adds, and Finder discoveries are upserted automatically, deduped by name/city/country. Promoters are prioritized because they are usually the real booking relationship.</p></div></aside><main class="route-main-panel"><div class="route-command-bar"><div><p class="route-kicker">Master contact CRM</p><h1>Contact Manager</h1><p>Instant-search promoters, venues, collectives, bookers, phone/email contacts, ratings, capacity, and notes — then send selected contacts into the active route.</p></div><div class="route-command-actions"><button class="btn-secondary" onclick="VenueManager.newVenue()">Manual Contact</button><button class="btn-primary" onclick="VenueManager.findWeb()">Finder Module</button></div></div>${note?`<div id="venueManagerNote" class="route-tool-card"><p>${esc(note)}</p></div>`:`<div id="venueManagerNote"></div>`}<div id="venueManagerForm"></div><section id="venueManagerResults" class="venue-manager-results"><div class="route-panel-title"><span>${esc(venueManagerMode==='finder'?'Finder results added to master list':'Contact list results')}</span><em>${venueManagerRows.length} matched · showing ${shown.length}</em></div>${shown.length?shown.map(venueCard).join(''):'<div class="route-ai-empty">No contacts loaded yet. Search the master list or run the Finder module.</div>'}</section></main></section>`;
  }
  function updateVenueManagerResults(rows=venueManagerRows,note=''){
    venueManagerRows=Array.isArray(rows)?rows:[];
    const shown=venueManagerRows.slice(0,80);
    const noteEl=$('venueManagerNote'); if(noteEl) noteEl.innerHTML=note?`<p>${esc(note)}</p>`:'';
    const el=$('venueManagerResults');
    if(!el) return renderVenueManager(rows,note);
    el.innerHTML=`<div class="route-panel-title"><span>${esc(venueManagerMode==='finder'?'Finder results added to master list':'Contact list results')}</span><em>${venueManagerRows.length} matched · showing ${shown.length}</em></div>${shown.length?shown.map(venueCard).join(''):'<div class="route-ai-empty">No contacts loaded yet. Search the master list or run the Finder module.</div>'}`;
  }
  async function initVenueManager(){ const root=$('venueAdminShell'); if(!root) return; root.innerHTML=loading('Loading Contact Manager…'); try{ await venueManagerLoad(); }catch(e){ root.innerHTML=errorBox('Contact Manager unavailable',e.message); } }
  async function venueManagerLoad(){ venueManagerMode='master'; const rows=await post(RAG_VENUES_API,{action:'list'}); venueManagerAllRows=rows; renderVenueManager(rows,'Full contact list loaded. Start typing to filter instantly.'); }
  function venueManagerFilter(){
    venueManagerFilters={query:val('vmQuery'),city:val('vmCity'),country:val('vmCountry'),genre:val('vmGenre'),capacity:val('vmCapacity')};
    const q=[venueManagerFilters.query,venueManagerFilters.city,venueManagerFilters.country,venueManagerFilters.genre].filter(Boolean).join(' ').toLowerCase();
    const cap=Number(venueManagerFilters.capacity||0);
    const base=venueManagerAllRows.length?venueManagerAllRows:venueManagerRows;
    const rows=base.filter(v=>{
      const hay=[v.name,v.contact_type,v.city,v.country,v.region,v.address,v.capacity,v.actual_capacity,v.rating,v.relationship_status,v.buyer_status,v.booking_email,v.email,v.phone,v.website,v.instagram,v.booking_method,v.notes,(v.genre_affinity||[]).join(' ')].filter(Boolean).join(' ').toLowerCase();
      const textOk=!q || q.split(/\s+/).filter(Boolean).every(term=>hay.includes(term));
      const capOk=!cap || !Number(v.capacity||v.actual_capacity) || Number(v.capacity||v.actual_capacity)<=cap;
      return textOk && capOk;
    });
    venueManagerMode='master'; updateVenueManagerResults(rows, q?`Instant filter: ${rows.length} matching contacts.`:'Full contact list loaded. Start typing to filter instantly.');
  }
  async function venueManagerSearch(){ venueManagerMode='master'; venueManagerFilters={query:val('vmQuery'),city:val('vmCity'),country:val('vmCountry'),genre:val('vmGenre'),capacity:val('vmCapacity')}; const query={query:venueManagerFilters.query,city:venueManagerFilters.city,country:venueManagerFilters.country,genre:venueManagerFilters.genre,capacity:venueManagerFilters.capacity,limit:80}; const data=await post(RAG_VENUES_API,{action:'search',query}); renderVenueManager(data.venues||[],`Search returned ${data.count||0} master contact matches.`); }
  async function venueManagerFinder(){
    venueManagerMode='finder'; venueManagerFilters={query:val('vmQuery'),city:val('vmCity'),country:val('vmCountry'),genre:val('vmGenre'),capacity:val('vmCapacity')};
    const city=venueManagerFilters.city, country=venueManagerFilters.country, genre=venueManagerFilters.genre||'darkwave, EBM, post-punk, industrial, goth, synth';
    if(!city) return toast('City is required for Contact Finder.','error');
    const root=$('venueAdminShell'); root.innerHTML=loading(`Finding promoters, collectives, bookers, and venues in ${city}…`);
    const contacts=await runGroundedContactFinder([city,country].filter(Boolean).join(', '),genre,venueManagerFilters.capacity||700);
    const rows=[];
    for(const item of contacts){ const saved=await upsertVenueToMaster(item,{city,country},item.contact_type==='promoter'?'contact_manager_promoter_finder':'contact_manager_venue_finder').catch(()=>masterVenueFrom(item,{city,country},'contact_manager_finder')); rows.push(saved||masterVenueFrom(item,{city,country},'contact_manager_finder')); }
    venueManagerAllRows=[...rows,...venueManagerAllRows.filter(v=>!rows.some(r=>r.id&&r.id===v.id))];
    renderVenueManager(rows,`Finder discovered ${contacts.length} promoters/venues; valid results were added or updated in the master contact list.`);
  }
  function venueManagerEdit(i){ const v=venueManagerRows[i]||{}; const el=$('venueManagerForm'); if(!el) return; el.innerHTML=`<div class="route-tool-card"><h3>${v.id?'Edit Contact':'Add Contact'}</h3><div class="route-stop-grid"><input type="hidden" id="vmEditId" value="${attr(v.id||'')}"><label>Type<select id="vmEditType" class="form-input">${stopOptions(v.contact_type||'venue',['promoter','venue','both','festival','collective','agency','booker'])}</select></label><label>Name<input id="vmEditName" class="form-input" value="${attr(v.name||'')}"></label><label>City<input id="vmEditCity" class="form-input" value="${attr(v.city||'')}"></label><label>Country<input id="vmEditCountry" class="form-input" value="${attr(v.country||'')}"></label><label>Actual Capacity<input id="vmEditCapacity" class="form-input" value="${attr(v.actual_capacity||v.capacity||'')}"></label><label>Rating 1-5<input id="vmEditRating" class="form-input" value="${attr(v.rating||'')}"></label><label>Relationship<select id="vmEditRelationship" class="form-input">${stopOptions(v.relationship_status||'unknown',['unknown','discovered','cold','warm','friendly','preferred','avoid','inactive','closed'])}</select></label><label>Booking Email<input id="vmEditEmail" class="form-input" value="${attr(v.booking_email||v.email||'')}"></label><label>Phone<input id="vmEditPhone" class="form-input" value="${attr(v.phone||'')}"></label><label>Website<input id="vmEditWebsite" class="form-input" value="${attr(v.website||'')}"></label></div><label>Notes / contact history<textarea id="vmEditNotes" class="form-input form-textarea" rows="4">${esc(v.notes||'')}</textarea></label><div class="route-stop-actions"><button class="btn-primary" onclick="VenueManager.save()">Save Contact</button><button class="btn-secondary" onclick="VenueManager.cancelEdit()">Cancel</button></div></div>`; }
  function venueManagerNew(){ venueManagerEdit(-1); }
  function venueManagerCancel(){ const el=$('venueManagerForm'); if(el) el.innerHTML=''; }
  async function venueManagerSave(){ const venue={id:val('vmEditId')||undefined,contact_type:val('vmEditType')||'venue',name:val('vmEditName'),city:val('vmEditCity'),country:val('vmEditCountry'),actual_capacity:val('vmEditCapacity'),capacity:val('vmEditCapacity'),rating:val('vmEditRating'),relationship_status:val('vmEditRelationship'),booking_email:val('vmEditEmail'),phone:val('vmEditPhone'),website:val('vmEditWebsite'),notes:val('vmEditNotes'),last_found_source:'manual_venue_manager'}; if(!venue.name||!venue.city) return toast('Name and city are required.','error'); const saved=await post(RAG_VENUES_API,{action:'upsert',skip_embeddings:true,venue}); toast('✓ Contact saved to master list','success'); venueManagerRows=[saved,...venueManagerRows.filter(v=>v.id!==saved.id)]; venueManagerAllRows=[saved,...venueManagerAllRows.filter(v=>v.id!==saved.id)]; renderVenueManager(venueManagerRows,'Contact saved.'); }
  async function venueManagerSendToRoute(i){ const v=venueManagerRows[i]; const t=activeRoute(); if(!v) return; if(!t?.legs?.length) return toast('Open or generate a route first, then send venues into it.','error'); const answer=prompt('Send to which stop number?', '1'); if(answer===null) return; const idx=Math.max(0,Math.min(t.legs.length-1,Number(answer)-1||0)); const l=t.legs[idx]; l.candidate_venues=Array.isArray(l.candidate_venues)?l.candidate_venues:[]; const candidate={name:v.name,address:v.address,capacity:v.actual_capacity||v.capacity,booking_method:v.booking_email||v.booking_method||'master list',email:v.booking_email,phone:v.phone,website:v.website,instagram:v.instagram,fit_reason:v.notes||'Selected from Venue Manager.',outreach_angle:v.notes||'Master venue list option',crm_source:true,crm_id:v.id}; l.candidate_venues.unshift(candidate); if(!l.suggested_venue){ l.suggested_venue=v.name; l.venue_address=v.address||''; } if(t.id) await persistStop(idx,l); toast(`✓ ${v.name} added to stop ${idx+1}`,'success'); rerenderActiveRoute(); openStop(idx); }

  window.RouteAdmin = { init:initRoutePlannerAdmin, renderBuilder, generate, saveGenerated, optimizeGenerated, optimizeSaved, optimizeCurrent, estimateBudget, suggestVenues, generateEmail, adviseDeal, chatAgent, analyzeAnchors, analyzeCurrentAnchors, openTour, duplicateTour, deleteTour, systemTour, setFilter, refreshLibraryList, openStop, saveStopEdits, venueFinderForStop, researchVenuesAllStops, useCandidateVenue, generateVenueEmail, backlineForStop, backlineAllStops, showBacklineResult, renderTravelAlertCenter, setTravelAlertFilter, copyTravelAlertDigest, updateTravelAlert, editTravelAlertNote, generateTravelAlertMessage, renderTravelOpsBoard, openTourThenTravel, opsRouteLinks, renderTravelHotelModule, syncTourBandGuidance, archiveTravelRecord, saveTravelLeg, saveHotelStay, openGeneratedTravelLinks, reviewCurrentRoute, runSuggestedAction, dragKanban, dropKanban, setCurrency, renderVenueBoard, manualVenueForm, addManualVenue, assistantAsk, applyAssistantPatch, insertBlankDayAfter, convertBlankDayToProspect, askAboutCurrentReview };
  window.VenueManager = { init:initVenueManager, load:venueManagerLoad, search:venueManagerSearch, findWeb:venueManagerFinder, edit:venueManagerEdit, newVenue:venueManagerNew, cancelEdit:venueManagerCancel, save:venueManagerSave, sendToRoute:venueManagerSendToRoute, filter:venueManagerFilter };
  document.addEventListener('DOMContentLoaded',()=>{ if($('routeAdminShell')) initRoutePlannerAdmin(); if($('venueAdminShell')) initVenueManager(); });
})();

/* ================================================
   MELANKOLIA TOUR PLANNER — Admin Integration
   Embedded as a tab in the admin dashboard.
   All AI calls go through Netlify functions.
   ================================================ */

/* ---- API LAYER ---- */
const TourAPI = {
  async ai(action, data) {
    const res = await fetch('/.netlify/functions/ai-tour', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, data })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'AI request failed');
    return json.data;
  },

  async geocode(address) {
    const res = await fetch('/.netlify/functions/maps-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'geocode', params: { address } })
    });
    const data = await res.json();
    if (data.status !== 'OK' || !data.results?.length) return null;
    return data.results[0].geometry.location;
  }
};

/* ---- MAP CONTROLLER ---- */
const TourMap = (() => {
  let map = null, markers = [], polylines = [], infoWindow = null;

  const DARK_STYLE = [
    { elementType: 'geometry', stylers: [{ color: '#080808' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#444' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#050505' }] },
    { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#111' }] },
    { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#555' }] },
    { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#666' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#161616' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#1e1e1e' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#010101' }] },
    { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#060606' }] }
  ];

  function init(elId) {
    const el = document.getElementById(elId);
    if (!el || map) return;
    map = new google.maps.Map(el, {
      center: { lat: 40, lng: -20 }, zoom: 3,
      styles: DARK_STYLE,
      zoomControl: true, mapTypeControl: false,
      streetViewControl: false, fullscreenControl: false,
      zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_CENTER }
    });
    infoWindow = new google.maps.InfoWindow();
  }

  function clear() {
    markers.forEach(m => m.setMap(null));
    polylines.forEach(p => p.setMap(null));
    markers = []; polylines = [];
    infoWindow?.close();
  }

  function fitAll() {
    if (!map || !markers.length) return;
    const b = new google.maps.LatLngBounds();
    markers.forEach(m => b.extend(m.getPosition()));
    map.fitBounds(b);
  }

  function addMarker({ lat, lng, title, day, isAnchor, isRest, popupHtml }) {
    if (!map) return;
    const color = isRest ? '#222' : isAnchor ? '#c8a96e' : '#555';
    const m = new google.maps.Marker({
      position: { lat, lng }, map, title,
      label: { text: String(day || ''), color: isRest ? '#333' : isAnchor ? '#000' : '#999', fontSize: '8px', fontWeight: '700' },
      icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: color, fillOpacity: isRest ? 0.3 : 1, strokeColor: isAnchor ? '#d9b97e' : '#111', strokeWeight: isAnchor ? 2 : 1, scale: isAnchor ? 13 : isRest ? 7 : 10 },
      zIndex: isAnchor ? 10 : isRest ? 1 : 5
    });
    if (popupHtml) {
      m.addListener('click', () => {
        infoWindow.setContent(popupHtml);
        infoWindow.open(map, m);
      });
    }
    markers.push(m);
  }

  function drawLine(coords, color = '#c8a96e', opacity = 0.5) {
    if (!map || coords.length < 2) return;
    const p = new google.maps.Polyline({ path: coords, geodesic: true, strokeColor: color, strokeOpacity: opacity, strokeWeight: 1.5 });
    p.setMap(map);
    polylines.push(p);
  }

  async function renderLegs(legs) {
    clear();
    if (!legs?.length) return;
    const coords = [];
    for (const leg of legs) {
      const loc = await TourAPI.geocode(`${leg.city}, ${leg.country || ''}`).catch(() => null);
      if (!loc) continue;
      coords.push({ lat: loc.lat, lng: loc.lng });
      addMarker({
        lat: loc.lat, lng: loc.lng,
        title: leg.city, day: leg.day,
        isAnchor: leg.is_anchor_show, isRest: leg.day_off,
        popupHtml: `<div style="background:#111;color:#ddd;padding:10px;border:1px solid #222;font-family:sans-serif;min-width:160px;">
          <div style="font-size:10px;font-weight:700;color:${leg.is_anchor_show ? '#c8a96e' : '#666'};text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">${leg.is_anchor_show ? '★ ANCHOR' : leg.day_off ? '— REST' : '◈ SHOW'}</div>
          <div style="font-size:13px;font-weight:600;margin-bottom:3px;">${leg.city}</div>
          <div style="font-size:11px;color:#666;">${leg.date || ''} · Day ${leg.day}</div>
          ${leg.suggested_venue ? `<div style="font-size:11px;color:#c8a96e;margin-top:4px;">${leg.suggested_venue}</div>` : ''}
          ${leg.drive_from_previous_km ? `<div style="font-size:10px;color:#555;margin-top:2px;">↑ ${leg.drive_from_previous_km}km</div>` : ''}
        </div>`
      });
    }
    drawLine(coords);
    fitAll();
  }

  return { init, clear, fitAll, renderLegs };
})();

/* ---- STATE ---- */
let tourState = {
  currentTour: null,
  anchors: [],       // [{city, date, venue, deal}]
  chatContext: '',
  mapsReady: false
};

/* ---- INIT ---- */
function initTourPlanner() {
  if (tourState.mapsReady) {
    TourMap.init('tourMap');
  }

  // Tab switching
  document.querySelectorAll('.tour-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tour-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tour-tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('ttab-' + btn.dataset.tab)?.classList.add('active');
    });
  });

  // Populate artist dropdowns
  const artists = getArtists ? getArtists() : [];
  ['tp-artist', 'tp-opt-artist', 'tp-deal-artist'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    artists.forEach(a => {
      const o = document.createElement('option');
      o.value = a.name; o.textContent = a.name;
      sel.appendChild(o);
    });
  });

  // Set default dates
  const today = new Date();
  const future = new Date(today); future.setDate(today.getDate() + 14);
  const fmt = d => d.toISOString().split('T')[0];
  ['tp-start-date', 'tp-opt-date'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = fmt(today);
  });
  const ed = document.getElementById('tp-end-date');
  if (ed) ed.value = fmt(future);

  // Anchor add
  document.getElementById('tp-add-anchor')?.addEventListener('click', addAnchorItem);
  document.getElementById('tp-anchor-city')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addAnchorItem(); } });

  // Form submits
  document.getElementById('tp-build-form')?.addEventListener('submit', onGenerateTour);
  document.getElementById('tp-opt-btn')?.addEventListener('click', onOptimizeRoute);
  document.getElementById('tp-budget-btn')?.addEventListener('click', onEstimateBudget);
  document.getElementById('tp-venue-btn')?.addEventListener('click', onFindVenues);
  document.getElementById('tp-deal-btn')?.addEventListener('click', onAdviseDeal);

  // Map controls
  document.getElementById('tp-clear-map')?.addEventListener('click', () => {
    TourMap.clear();
    setTourResults(`<div class="t-results-empty"><div class="t-results-empty-icon">◈</div><div>Build a tour to see results here.</div></div>`);
  });
  document.getElementById('tp-fit-map')?.addEventListener('click', () => TourMap.fitAll());

  // Chat
  const chatSend = () => {
    const inp = document.getElementById('tp-chat-input');
    const msg = inp?.value.trim();
    if (!msg) return;
    inp.value = '';
    onTourChat(msg);
  };
  document.getElementById('tp-chat-send')?.addEventListener('click', chatSend);
  document.getElementById('tp-chat-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') chatSend(); });

  // Initial chat message
  addChatMsg('ai', 'Ready. Use the tabs on the left to build a tour, optimize a route, estimate a budget, or find venues. Ask me anything about booking.');
}

/* ---- ANCHORS ---- */
function addAnchorItem() {
  const city = document.getElementById('tp-anchor-city')?.value.trim();
  const date = document.getElementById('tp-anchor-date')?.value;
  const venue = document.getElementById('tp-anchor-venue')?.value.trim();
  if (!city) return;

  const anchor = { city, date: date || '', venue: venue || '', deal: '' };
  tourState.anchors.push(anchor);

  document.getElementById('tp-anchor-city').value = '';
  document.getElementById('tp-anchor-date').value = '';
  document.getElementById('tp-anchor-venue').value = '';

  renderAnchorList();
}

function removeAnchor(i) {
  tourState.anchors.splice(i, 1);
  renderAnchorList();
}

function renderAnchorList() {
  const el = document.getElementById('tp-anchor-list');
  if (!el) return;
  if (!tourState.anchors.length) {
    el.innerHTML = '<div style="font-size:0.68rem;color:#333;padding:0.3rem 0;">No anchors added yet — or build without them.</div>';
    return;
  }
  el.innerHTML = tourState.anchors.map((a, i) => `
    <div class="anchor-item">
      <div class="anchor-item-info">
        <div>${a.city}</div>
        <div class="anchor-item-sub">${a.date || 'date TBD'}${a.venue ? ' · ' + a.venue : ''}</div>
      </div>
      <button class="anchor-remove" onclick="removeAnchor(${i})">✕</button>
    </div>
  `).join('');
}

/* ---- LOADING STATE ---- */
function setTourLoading(active, text = 'Working...') {
  const overlay = document.getElementById('tp-map-overlay');
  const txt = document.getElementById('tp-loading-text');
  if (overlay) overlay.classList.toggle('active', active);
  if (txt) txt.textContent = text;
}

function setBtnLoading(id, loading) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    btn.dataset.orig = btn.innerHTML;
    btn.innerHTML = '<div class="t-spinner" style="width:12px;height:12px;border-width:2px;margin:0 auto;"></div>';
  } else {
    btn.innerHTML = btn.dataset.orig || btn.innerHTML;
  }
}

function setTourResults(html) {
  const el = document.getElementById('tp-results-area');
  if (el) el.innerHTML = html;
}

/* ---- GENERATE TOUR ---- */
async function onGenerateTour(e) {
  e.preventDefault();
  const artist = document.getElementById('tp-artist').value;
  const region = document.querySelector('input[name="tp-region"]:checked')?.value || 'USA';
  const startCity = document.getElementById('tp-start-city').value.trim();
  const endCity = document.getElementById('tp-end-city').value.trim();
  const startDate = document.getElementById('tp-start-date').value;
  const endDate = document.getElementById('tp-end-date').value;
  const numShows = document.getElementById('tp-num-shows').value;
  const budget = document.getElementById('tp-budget').value.trim();
  const dealType = document.getElementById('tp-deal-type').value;
  const preferences = document.getElementById('tp-prefs').value.trim();

  if (!artist || !startCity || !startDate || !endDate) {
    addChatMsg('ai', 'Fill in the artist, start city, and dates to generate a tour plan.');
    return;
  }

  setTourLoading(true, 'AI is planning your tour route...');
  setBtnLoading('tp-generate-btn', true);
  addChatMsg('ai', `Planning ${artist} tour — ${startCity} → ${endDate}... this uses the Pro model so give it ~30s.`);

  try {
    const tour = await TourAPI.ai('generate_tour', {
      artist, region, startCity, endCity, startDate, endDate,
      budget, numShows: parseInt(numShows) || undefined,
      dealType, preferences, anchorShows: tourState.anchors
    });

    tourState.currentTour = tour;
    tourState.chatContext = `Tour: "${tour.tour_name}" for ${artist}. ${tour.summary} Cities: ${tour.legs.filter(l => !l.day_off).map(l => l.city).join(', ')}.`;

    renderTourResults(tour);
    await TourMap.renderLegs(tour.legs);
    addChatMsg('ai', `"${tour.tour_name}" — ${tour.total_shows} shows across ${tour.total_days} days. ${tour.warnings?.length ? '⚠ ' + tour.warnings[0] : 'Routing looks solid.'}`);

  } catch (err) {
    addChatMsg('ai', `Error: ${err.message}`);
    setTourResults(`<div class="t-warning">Failed to generate tour. ${err.message}</div>`);
  } finally {
    setTourLoading(false);
    setBtnLoading('tp-generate-btn', false);
  }
}

/* ---- OPTIMIZE ---- */
async function onOptimizeRoute() {
  const artist = document.getElementById('tp-opt-artist').value;
  const raw = document.getElementById('tp-opt-cities').value.trim();
  const startDate = document.getElementById('tp-opt-date').value;
  const region = document.querySelector('input[name="tp-opt-region"]:checked')?.value || 'USA';

  if (!raw) { addChatMsg('ai', 'Enter cities to optimize.'); return; }
  const cities = raw.split('\n').map(c => c.trim()).filter(Boolean);
  if (cities.length < 2) { addChatMsg('ai', 'Need at least 2 cities to optimize.'); return; }

  setTourLoading(true, 'Optimizing route order...');
  setBtnLoading('tp-opt-btn', true);

  try {
    const result = await TourAPI.ai('optimize_route', { artist, cities, startDate, region });
    renderOptimizeResults(result);

    if (result.day_by_day) {
      await TourMap.renderLegs(result.day_by_day.map((d, i) => ({
        day: d.day, city: d.city, country: '', is_anchor_show: false, day_off: false,
        drive_from_previous_km: d.drive_km, notes: d.note
      })));
    }

    addChatMsg('ai', `Optimized. Saved ${result.savings_km || 0}km. ${result.problem_legs?.length ? '⚠ Tight leg: ' + result.problem_legs[0].from + ' → ' + result.problem_legs[0].to : 'No major issues.'}`);
  } catch (err) {
    addChatMsg('ai', `Optimization failed: ${err.message}`);
  } finally {
    setTourLoading(false);
    setBtnLoading('tp-opt-btn', false);
  }
}

/* ---- BUDGET ---- */
async function onEstimateBudget() {
  const region = document.getElementById('tp-bud-region').value;
  const numPeople = parseInt(document.getElementById('tp-bud-people').value) || 4;
  const numDays = parseInt(document.getElementById('tp-bud-days').value) || 10;
  const numShows = parseInt(document.getElementById('tp-bud-shows').value) || 7;
  const avgGuarantee = parseInt(document.getElementById('tp-bud-guarantee').value) || 800;
  const tourSupport = parseInt(document.getElementById('tp-bud-support').value) || 0;
  const vanRental = document.getElementById('tp-bud-van').checked;
  const raw = document.getElementById('tp-bud-cities').value.trim();
  const cities = raw.split('\n').map(c => c.trim()).filter(Boolean);

  setTourLoading(true, 'Calculating budget...');
  setBtnLoading('tp-budget-btn', true);

  try {
    const result = await TourAPI.ai('estimate_budget', { region, numPeople, numDays, numShows, avgGuarantee, tourSupport, vanRental, cities });
    renderBudgetResults(result);
    addChatMsg('ai', `Budget: ~$${result.expenses?.total_expenses?.toLocaleString() || '?'} expenses vs $${result.revenue?.total_projected_revenue?.toLocaleString() || '?'} revenue. ${result.is_viable ? '✓ Viable.' : '✗ Needs adjustment.'}`);
  } catch (err) {
    addChatMsg('ai', `Budget estimate failed: ${err.message}`);
  } finally {
    setTourLoading(false);
    setBtnLoading('tp-budget-btn', false);
  }
}

/* ---- VENUES ---- */
async function onFindVenues() {
  const city = document.getElementById('tp-venue-city').value.trim();
  const country = document.getElementById('tp-venue-country').value.trim();
  const genre = document.getElementById('tp-venue-genre').value;
  const capacity = document.getElementById('tp-venue-cap').value;

  if (!city) { addChatMsg('ai', 'Enter a city.'); return; }

  setTourLoading(true, `Searching venues in ${city}...`);
  setBtnLoading('tp-venue-btn', true);

  try {
    const venues = await TourAPI.ai('suggest_venues', { city, country, genre, capacity });
    renderVenueResults(venues, city, country);
    addChatMsg('ai', `Found ${venues.length} venues in ${city} suited for ${genre}.`);
  } catch (err) {
    addChatMsg('ai', `Venue search failed: ${err.message}`);
  } finally {
    setTourLoading(false);
    setBtnLoading('tp-venue-btn', false);
  }
}

/* ---- DEAL ADVISOR ---- */
async function onAdviseDeal() {
  const artist = document.getElementById('tp-deal-artist').value;
  const city = document.getElementById('tp-deal-city').value.trim();
  const venue = document.getElementById('tp-deal-venue').value.trim();
  const capacity = document.getElementById('tp-deal-cap').value.trim();
  const draw = document.getElementById('tp-deal-draw').value.trim();
  const offerType = document.getElementById('tp-deal-type-sel').value;
  const offerAmount = document.getElementById('tp-deal-amount').value;

  if (!city || !offerAmount) { addChatMsg('ai', 'Fill in city and offer amount.'); return; }

  setTourLoading(true, 'Evaluating deal...');
  setBtnLoading('tp-deal-btn', true);

  try {
    const result = await TourAPI.ai('advise_deal', { artist, city, venue, capacity, artistDraw: draw, offerType, offerAmount: parseInt(offerAmount) });
    renderDealResults(result);
    addChatMsg('ai', `Deal assessment: ${result.offer_assessment?.toUpperCase()}. Market rate: ${result.market_rate_range}. ${result.offer_assessment !== 'strong' ? 'Counter: $' + result.counter_suggestion : 'Accept as-is.'}`);
  } catch (err) {
    addChatMsg('ai', `Deal analysis failed: ${err.message}`);
  } finally {
    setTourLoading(false);
    setBtnLoading('tp-deal-btn', false);
  }
}

/* ---- CHAT ---- */
async function onTourChat(message) {
  addChatMsg('user', message);
  try {
    const result = await TourAPI.ai('chat', { message, context: tourState.chatContext });
    addChatMsg('ai', result.reply);
  } catch {
    addChatMsg('ai', 'Something went wrong. Try again.');
  }
}

function addChatMsg(type, text) {
  const box = document.getElementById('tp-chat-msgs');
  if (!box) return;
  const div = document.createElement('div');
  div.className = type === 'user' ? 't-user-msg' : 't-ai-msg';
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

/* ---- RENDER FUNCTIONS ---- */

function renderTourResults(tour) {
  const legs = tour.legs || [];
  const legsHtml = legs.map((leg, i) => `
    <div class="t-leg">
      <div class="t-leg-day">D${leg.day}</div>
      <div class="t-leg-dot-col">
        <div class="t-leg-dot ${leg.is_anchor_show ? 'anchor' : leg.day_off ? 'rest' : 'routing'}"></div>
        ${i < legs.length - 1 ? '<div class="t-leg-connector"></div>' : ''}
      </div>
      <div class="t-leg-info">
        <div class="t-leg-city">${leg.city}${leg.country ? ` <span style="color:#444;font-weight:400">${leg.country}</span>` : ''}</div>
        <div class="t-leg-date">${leg.date || ''} · ${leg.day_of_week || ''}</div>
        ${leg.drive_from_previous_km ? `<div class="t-leg-drive">↑ ${leg.drive_from_previous_km}km / ~${leg.drive_hours || '?'}h</div>` : ''}
        ${leg.suggested_venue ? `<div class="t-leg-venue">↳ ${leg.suggested_venue}</div>` : ''}
        ${leg.notes ? `<div class="t-leg-note">${leg.notes}</div>` : ''}
      </div>
      ${leg.is_anchor_show ? '<div class="t-leg-badge badge-anchor">Anchor</div>' : ''}
      ${leg.day_off ? '<div class="t-leg-badge badge-rest">Rest</div>' : ''}
      ${leg.day_type === 'travel' ? '<div class="t-leg-badge badge-travel">Travel</div>' : ''}
    </div>
  `).join('');

  const warnings = (tour.warnings || []).map(w => `<div class="t-warning">${w}</div>`).join('');
  const tips = (tour.ai_tips || []).map(t => `<div class="t-tip">${t}</div>`).join('');
  const checklist = (tour.advancing_checklist || []).map(c => `<div class="t-tip">${c}</div>`).join('');
  const gaps = tour.fill_gaps?.length ? `<div class="t-tip">Fill gaps: ${tour.fill_gaps.join(' · ')}</div>` : '';

  const netUsd = (tour.projected_gross_usd || 0);

  setTourResults(`
    <div class="t-tour-header">
      <div class="t-tour-name">${tour.tour_name}</div>
      <div class="t-tour-summary">${tour.summary}</div>
      <div class="t-stats">
        <div class="t-stat"><div class="n">${tour.total_shows}</div><div class="l">Shows</div></div>
        <div class="t-stat"><div class="n">${tour.total_days}</div><div class="l">Days</div></div>
        <div class="t-stat"><div class="n">${(tour.estimated_total_km||0).toLocaleString()}</div><div class="l">km</div></div>
        <div class="t-stat"><div class="n">${tour.routing_strategy || '—'}</div><div class="l">Strategy</div></div>
      </div>
    </div>
    <div class="t-section-label">Itinerary</div>
    <div class="t-itinerary">${legsHtml}</div>
    ${gaps ? `<div class="t-section-label">Fill Gaps</div>${gaps}` : ''}
    ${warnings ? `<div class="t-section-label">⚠ Warnings</div>${warnings}` : ''}
    ${checklist ? `<div class="t-section-label">Advancing Checklist</div>${checklist}` : ''}
    ${tips ? `<div class="t-section-label">AI Tips</div>${tips}` : ''}
  `);
}

function renderOptimizeResults(result) {
  const cities = (result.day_by_day || result.optimized_order?.map((c,i) => ({day:i+1,city:c,drive_km:0,note:''})) || []);
  const citiesHtml = cities.map(d => `
    <div style="display:flex;align-items:center;gap:0.7rem;padding:0.45rem 0.6rem;background:#111;border:1px solid #1a1a1a;border-radius:2px;margin-bottom:0.3rem;">
      <div style="color:#c8a96e;font-weight:700;font-size:0.7rem;width:20px;">${d.day}</div>
      <div style="flex:1;font-size:0.78rem;color:#ccc;">${d.city}</div>
      <div style="font-size:0.62rem;color:#444;">${d.drive_km ? d.drive_km+'km' : '—'}</div>
    </div>
  `).join('');

  const problems = (result.problem_legs || []).map(p => `<div class="t-warning">${p.from} → ${p.to}: ${p.km}km — ${p.issue}</div>`).join('');
  const adds = (result.suggested_additions || []).map(a => `<div class="t-tip">Add ${a.city} between ${a.between}: ${a.reason}</div>`).join('');
  const anchors = (result.anchor_recommendations || []).map(a => `<div class="t-tip">${a}</div>`).join('');

  setTourResults(`
    <div class="t-tour-header">
      <div class="t-tour-name">Optimized Route</div>
      <div class="t-tour-summary">${result.routing_strategy || ''}</div>
      <div class="t-stats">
        <div class="t-stat"><div class="n">${(result.total_km_optimized||0).toLocaleString()}</div><div class="l">Opt. km</div></div>
        <div class="t-stat"><div class="n">${(result.savings_km||0).toLocaleString()}</div><div class="l">Saved</div></div>
      </div>
    </div>
    <div class="t-section-label">Order</div>
    ${citiesHtml}
    ${anchors ? `<div class="t-section-label">Anchor Recommendations</div>${anchors}` : ''}
    ${adds ? `<div class="t-section-label">Suggested Additions</div>${adds}` : ''}
    ${problems ? `<div class="t-section-label">⚠ Problem Legs</div>${problems}` : ''}
  `);
}

function renderBudgetResults(r) {
  const rev = r.revenue || {};
  const exp = r.expenses || {};
  const db = r.daily_breakdown || {};
  const tips = (r.savings_tips || []).map(t => `<div class="t-tip">${t}</div>`).join('');

  setTourResults(`
    <div class="t-budget-total">
      <div class="big">${r.net_profit_loss >= 0 ? '+' : ''}$${(r.net_profit_loss||0).toLocaleString()}</div>
      <div class="sub">Net ${r.net_profit_loss >= 0 ? 'Profit' : 'Loss'}</div>
    </div>
    <div class="t-section-label">Revenue</div>
    <div class="t-budget-row"><span class="lb">Show Guarantees</span><span class="vl">$${(rev.show_guarantees_total||0).toLocaleString()}</span></div>
    <div class="t-budget-row"><span class="lb">Merch Estimate</span><span class="vl">$${(rev.merch_estimate||0).toLocaleString()}</span></div>
    ${rev.tour_support ? `<div class="t-budget-row"><span class="lb">Tour Support</span><span class="vl">$${rev.tour_support.toLocaleString()}</span></div>` : ''}
    <div class="t-budget-row"><span class="lb" style="color:#ccc;font-weight:600;">Total Revenue</span><span class="vl" style="color:#c8a96e;">$${(rev.total_projected_revenue||0).toLocaleString()}</span></div>
    <div class="t-section-label">Expenses</div>
    <div class="t-budget-row"><span class="lb">Fuel</span><span class="vl">$${(exp.fuel_total||0).toLocaleString()}</span></div>
    ${exp.van_rental_total ? `<div class="t-budget-row"><span class="lb">Van Rental</span><span class="vl">$${exp.van_rental_total.toLocaleString()}</span></div>` : ''}
    <div class="t-budget-row"><span class="lb">Lodging</span><span class="vl">$${(exp.lodging_total||0).toLocaleString()}</span></div>
    <div class="t-budget-row"><span class="lb">Food / Per Diem</span><span class="vl">$${(exp.food_per_diem_total||0).toLocaleString()}</span></div>
    <div class="t-budget-row"><span class="lb">Agent Commission</span><span class="vl">$${(exp.agent_commission||0).toLocaleString()}</span></div>
    <div class="t-budget-row"><span class="lb" style="color:#ccc;font-weight:600;">Total Expenses</span><span class="vl" style="color:#d07070;">$${(exp.total_expenses||0).toLocaleString()}</span></div>
    <div class="t-section-label">Break Even</div>
    <div class="t-budget-row"><span class="lb">Min. guarantee / show</span><span class="vl">$${(r.break_even_guarantee_per_show||0).toLocaleString()}</span></div>
    <div class="t-budget-row"><span class="lb">Merch target / show</span><span class="vl">$${(r.merch_target_per_show||0).toLocaleString()}</span></div>
    <div class="t-viable ${r.is_viable ? 'yes' : 'no'}">${r.viability_note}</div>
    ${tips ? `<div class="t-section-label">Cost-Saving Tips</div>${tips}` : ''}
  `);
}

function renderVenueResults(venues, city, country) {
  if (!venues?.length) { setTourResults(`<div class="t-warning">No venues found for ${city}.</div>`); return; }
  const html = venues.map(v => `
    <div class="t-venue-card">
      <div class="t-venue-name">${v.name}</div>
      ${v.address ? `<div class="t-venue-addr">${v.address}</div>` : ''}
      <div class="t-venue-tags">
        ${v.type ? `<span class="t-venue-tag">${v.type}</span>` : ''}
        ${v.capacity ? `<span class="t-venue-tag">${v.capacity} cap</span>` : ''}
        ${v.deal_type_typical ? `<span class="t-venue-tag">${v.deal_type_typical}</span>` : ''}
        ${v.tier === 'primary' ? `<span class="t-venue-tag primary">primary</span>` : ''}
      </div>
      ${v.known_for ? `<div class="t-venue-note">Known for: ${v.known_for}</div>` : ''}
      ${v.notes ? `<div class="t-venue-note">${v.notes}</div>` : ''}
      ${v.booking_contact_tip ? `<div class="t-venue-tip">→ ${v.booking_contact_tip}</div>` : ''}
    </div>
  `).join('');
  setTourResults(`<div class="t-section-label">Venues in ${city}${country ? ', ' + country : ''}</div>${html}`);
}

function renderDealResults(r) {
  const points = (r.negotiation_points || []).map(p => `<div class="t-tip">${p}</div>`).join('');
  const asks = (r.additional_asks || []).map(a => `<div class="t-tip">${a}</div>`).join('');

  setTourResults(`
    <div class="t-tour-header">
      <div class="t-tour-name">Deal Assessment</div>
      <div class="t-deal-badge ${r.offer_assessment}">${r.offer_assessment?.toUpperCase()}</div>
    </div>
    <div class="t-budget-row"><span class="lb">Market Rate</span><span class="vl">${r.market_rate_range}</span></div>
    <div class="t-budget-row"><span class="lb">Counter Offer</span><span class="vl" style="color:#c8a96e;">$${(r.counter_suggestion||0).toLocaleString()}</span></div>
    <div class="t-budget-row"><span class="lb">Recommended Structure</span><span class="vl">${r.deal_structure_recommendation}</span></div>
    <div class="t-section-label">Negotiation Points</div>
    ${points}
    ${asks ? `<div class="t-section-label">Also Ask For</div>${asks}` : ''}
    ${r.accept_if ? `<div class="t-section-label">Accept If</div><div class="t-tip">${r.accept_if}</div>` : ''}
    ${r.walk_away_if ? `<div class="t-section-label">Walk Away If</div><div class="t-warning">${r.walk_away_if}</div>` : ''}
  `);
}

/* ================================================
   ONBOARDING WIZARD
   ================================================ */

const WIZARD_STEPS = [
  {
    title: 'Welcome to the Tour Planner',
    sub: 'Your AI-powered booking intelligence for the underground circuit.',
    render: () => `
      <div class="wizard-intro-hero">
        <div class="wizard-hero-icon">◈</div>
        <div class="wizard-hero-text">
          This tool is built around how real booking agents work — anchors first, routing second, budget third.
          It knows the underground circuit: venues, deal structures, drive limits, day-of-week priorities, and how to keep a tour financially viable.
        </div>
      </div>
      <div class="wizard-callout">
        <strong>What it does:</strong> Generate complete tour itineraries, optimize city order, estimate tour budgets, find underground venues by city, and evaluate deal offers — all powered by AI trained on real booking logic.
      </div>
      <div class="wizard-feature-grid">
        <div class="wizard-feature"><div class="wizard-feature-icon">🗺</div><div class="wizard-feature-name">Build</div><div class="wizard-feature-desc">Generate a full AI tour plan with routing, show types, and advancing notes.</div></div>
        <div class="wizard-feature"><div class="wizard-feature-icon">↔</div><div class="wizard-feature-name">Optimize</div><div class="wizard-feature-desc">Drop in a list of cities and get the most efficient routing order.</div></div>
        <div class="wizard-feature"><div class="wizard-feature-icon">$</div><div class="wizard-feature-name">Budget</div><div class="wizard-feature-desc">Full revenue vs. expense model with break-even guarantee per show.</div></div>
        <div class="wizard-feature"><div class="wizard-feature-icon">🎭</div><div class="wizard-feature-name">Venues</div><div class="wizard-feature-desc">Find underground venues by city with booking contact tips.</div></div>
        <div class="wizard-feature"><div class="wizard-feature-icon">🤝</div><div class="wizard-feature-name">Deal Advisor</div><div class="wizard-feature-desc">Evaluate any offer and get a counter-offer recommendation.</div></div>
        <div class="wizard-feature"><div class="wizard-feature-icon">💬</div><div class="wizard-feature-name">AI Chat</div><div class="wizard-feature-desc">Ask anything about routing, venues, or deal strategy mid-session.</div></div>
      </div>
    `
  },
  {
    title: 'How Tours Are Actually Booked',
    sub: 'The professional booking workflow — from strategy to show day.',
    render: () => `
      <div class="wizard-workflow">
        <div class="wizard-wf-step">
          <div class="wizard-wf-badge">1</div>
          <div><div class="wizard-wf-title">Identify the Tour Window</div><div class="wizard-wf-text">Spring (Mar–May) and fall (Sep–Nov) are the prime slots for underground touring. Avoid December and January — venues are slow, audiences are stretched, and margins are tight.</div><div class="wizard-wf-tag">Strategy</div></div>
        </div>
        <div class="wizard-wf-step">
          <div class="wizard-wf-badge">2</div>
          <div><div class="wizard-wf-title">Find or Confirm Anchor Shows</div><div class="wizard-wf-text">An anchor is your highest-value confirmed date — a festival slot, a known promoter, or a strong market you can headline. Anchors anchor everything else. They should land on Friday or Saturday. Not every tour has a formal anchor, but if you have one, the rest of the route bends around it.</div><div class="wizard-wf-tag">Anchor Strategy</div></div>
        </div>
        <div class="wizard-wf-step">
          <div class="wizard-wf-badge">3</div>
          <div><div class="wizard-wf-title">Build Routing Shows Around Anchors</div><div class="wizard-wf-text">Routing shows fill the gaps between anchors. They're in smaller markets, on weeknights, often door deals. Their job is to keep the tour moving geographically and add income. Max 500km between consecutive show days. Build loops or lines — never zigzag.</div><div class="wizard-wf-tag">Routing</div></div>
        </div>
        <div class="wizard-wf-step">
          <div class="wizard-wf-badge">4</div>
          <div><div class="wizard-wf-title">Negotiate Deal Structures</div><div class="wizard-wf-text">Anchor shows: push for a guarantee. Routing shows in new markets: accept door deals (70–80% of door). Mid-tier shows: try guarantee vs. door — best of both. Always get the structure in writing before announcing the show.</div><div class="wizard-wf-tag">Deals</div></div>
        </div>
        <div class="wizard-wf-step">
          <div class="wizard-wf-badge">5</div>
          <div><div class="wizard-wf-title">Advance Every Show</div><div class="wizard-wf-text">Advancing starts 4–6 weeks out: confirm load-in times, sound engineer, backline, guest list, merch split, and settlement process. Lock accommodation 3 weeks before. Never arrive at a venue without a confirmed day sheet.</div><div class="wizard-wf-tag">Logistics</div></div>
        </div>
        <div class="wizard-wf-step">
          <div class="wizard-wf-badge">6</div>
          <div><div class="wizard-wf-title">Monitor the Budget Weekly</div><div class="wizard-wf-text">Tour budgets drift. Track actuals vs. projections every few days. Merch is often the margin — a strong merch night can save a bad door night. Know your break-even guarantee before you leave.</div><div class="wizard-wf-tag">Finance</div></div>
        </div>
      </div>
    `
  },
  {
    title: 'The Anchor Show Principle',
    sub: 'When to use anchors, and when to build without them.',
    render: () => `
      <div class="wizard-callout">
        <strong>Anchors are a tool, not a requirement.</strong> A strong anchor makes routing easier and provides financial confidence. But many great underground tours are built without them — especially for newer acts or experimental runs in new regions.
      </div>
      <div class="wizard-rule">
        <div class="wizard-rule-num">①</div>
        <div><div class="wizard-rule-title">Good anchors: festival slots, known promoters, album release shows</div><div class="wizard-rule-text">These are shows where the artist has a confirmed deal, a built-in audience, and a professional promoter handling local marketing. They usually come from existing relationships or agents pitching directly.</div></div>
      </div>
      <div class="wizard-rule">
        <div class="wizard-rule-num">②</div>
        <div><div class="wizard-rule-title">Anchor placement: Fri/Sat in Tier 1 markets</div><div class="wizard-rule-text">NYC, LA, Chicago, Berlin, London, Amsterdam — these are where your anchors belong. Never put a weaker anchor in a Tier 2 city while leaving a Tier 1 city as a routing show. You're leaving money on the table.</div></div>
      </div>
      <div class="wizard-rule">
        <div class="wizard-rule-num">③</div>
        <div><div class="wizard-rule-title">Without anchors: use streaming and social data to find pseudo-anchors</div><div class="wizard-rule-text">Check Spotify for Artists audience data and Instagram followers by city. The markets with the highest audience density become your pseudo-anchors — still schedule them Fri/Sat, still push for guarantees there.</div></div>
      </div>
      <div class="wizard-rule">
        <div class="wizard-rule-num">④</div>
        <div><div class="wizard-rule-title">1–2 routing shows before your first anchor</div><div class="wizard-rule-text">Always play a routing show to "warm up" before your first anchor. Artists get tighter, you shake out equipment issues, and you arrive at the anchor in better shape.</div></div>
      </div>
      <div class="wizard-rule">
        <div class="wizard-rule-num">⑤</div>
        <div><div class="wizard-rule-title">Add anchors to the planner before generating</div><div class="wizard-rule-text">Use the "Anchors" section in the Build tab to log confirmed or target anchors. The AI will build the route around them — it won't just treat them as regular shows.</div></div>
      </div>
    `
  },
  {
    title: 'Deal Structures & Financials',
    sub: 'What guarantees are realistic for the underground circuit in 2025–2026.',
    render: () => `
      <div class="wizard-callout">
        <strong>Know your number before you call the venue.</strong> Walking into a negotiation without a target guarantee is the fastest way to leave money behind or accept an insulting offer.
      </div>
      <div class="wizard-rule">
        <div class="wizard-rule-num">$</div>
        <div><div class="wizard-rule-title">Guarantee ranges for dark/underground acts</div><div class="wizard-rule-text">USA Tier 1 markets: $1,000–$3,000. USA Tier 2: $500–$1,200. USA Tier 3 / new markets: $0–$500 or door deal. Europe Tier 1: €800–€2,500. Europe Tier 2: €400–€1,000.</div></div>
      </div>
      <div class="wizard-rule">
        <div class="wizard-rule-num">%</div>
        <div><div class="wizard-rule-title">Door deal: take 70–80% after expenses</div><div class="wizard-rule-text">A standard door deal gives the artist 70–80% of door revenue after the venue deducts sound, production, and door costs. Always clarify what's deducted before agreeing. In a new market with no guarantee, a clean 75% split is a fair starting point.</div></div>
      </div>
      <div class="wizard-rule">
        <div class="wizard-rule-num">↑</div>
        <div><div class="wizard-rule-title">Guarantee vs. door — always push for it</div><div class="wizard-rule-text">"Best of" — artist gets whichever is higher — is the gold standard. Push for it whenever the venue has history with this genre. You get downside protection (the guarantee) and upside if the show oversells.</div></div>
      </div>
      <div class="wizard-rule">
        <div class="wizard-rule-num">+</div>
        <div><div class="wizard-rule-title">Beyond the fee: what else to negotiate</div><div class="wizard-rule-text">Merch split (some venues take 15–20% of merch — push back), hotel night, guest list (minimum 4–6 spots), backline (especially drum kit and bass amp), and a door time that gives you enough walk-in time before showtime.</div></div>
      </div>
      <div class="wizard-rule">
        <div class="wizard-rule-num">✓</div>
        <div><div class="wizard-rule-title">Break-even math: do it before you confirm</div><div class="wizard-rule-text">Total expected expenses ÷ number of shows = minimum guarantee needed per show to break even. If no show can meet that, the tour isn't viable yet. Use the Budget tab to run this calculation before committing dates.</div></div>
      </div>
    `
  },
  {
    title: "You're Ready",
    sub: 'Tips for getting the most out of the planner.',
    render: () => `
      <div class="wizard-intro-hero">
        <div class="wizard-hero-icon">✓</div>
        <div class="wizard-hero-text">Here's how to get the most out of every session.</div>
      </div>
      <div class="wizard-rule">
        <div class="wizard-rule-num">1</div>
        <div><div class="wizard-rule-title">Build tab: always add anchors first</div><div class="wizard-rule-text">Even if you only have one confirmed show, add it as an anchor. The AI routes everything else around it. The difference in output quality between "anchor aware" and "no anchors" is significant.</div></div>
      </div>
      <div class="wizard-rule">
        <div class="wizard-rule-num">2</div>
        <div><div class="wizard-rule-title">Use the Optimize tab for confirmed bookings</div><div class="wizard-rule-text">Got 8 cities booked in random order? Drop them in Optimize and get the most efficient routing. It also flags tight legs and suggests fill cities.</div></div>
      </div>
      <div class="wizard-rule">
        <div class="wizard-rule-num">3</div>
        <div><div class="wizard-rule-title">Run the Budget tab before confirming any tour</div><div class="wizard-rule-text">Put in your actual or target guarantees and get a full revenue vs. expense projection. Know your break-even number before you call anyone.</div></div>
      </div>
      <div class="wizard-rule">
        <div class="wizard-rule-num">4</div>
        <div><div class="wizard-rule-title">Deal Advisor for every incoming offer</div><div class="wizard-rule-text">Paste any offer into the Deal Advisor tab. It will assess it against market rate, suggest a counter, and tell you what else to ask for.</div></div>
      </div>
      <div class="wizard-rule">
        <div class="wizard-rule-num">5</div>
        <div><div class="wizard-rule-title">Chat is context-aware after you build a tour</div><div class="wizard-rule-text">After generating a plan, the AI chat knows the full tour context. Ask follow-up questions — "what if we skip Detroit?", "which venues in Chicago book this genre?", "is this guarantee realistic for a Tuesday in Denver?"</div></div>
      </div>
      <div class="wizard-callout" style="margin-top:1rem;">
        <strong>This wizard resets on each session.</strong> You can re-open it anytime with the <strong>? Guide</strong> button at the top of the Tour Planner view.
      </div>
    `
  }
];

let wizardStep = 0;

function openTourWizard() {
  wizardStep = 0;
  renderWizardStep();
  document.getElementById('tourWizardOverlay')?.classList.remove('hidden');
  document.getElementById('tourWizardOverlay').style.display = 'flex';
}

function closeWizard() {
  const el = document.getElementById('tourWizardOverlay');
  if (el) el.style.display = 'none';
  localStorage.setItem('mk_tour_wizard_seen', '1');
}

function wizardNext() {
  if (wizardStep < WIZARD_STEPS.length - 1) {
    wizardStep++;
    renderWizardStep();
  } else {
    closeWizard();
  }
}

function wizardPrev() {
  if (wizardStep > 0) {
    wizardStep--;
    renderWizardStep();
  }
}

function renderWizardStep() {
  const step = WIZARD_STEPS[wizardStep];
  const total = WIZARD_STEPS.length;

  const titleEl = document.getElementById('wizard-title');
  const subEl = document.getElementById('wizard-sub');
  const bodyEl = document.getElementById('wizard-body');
  const progressEl = document.getElementById('wizard-progress');
  const countEl = document.getElementById('wizard-count');
  const prevBtn = document.getElementById('wizard-prev');
  const nextBtn = document.getElementById('wizard-next');

  if (titleEl) titleEl.textContent = step.title;
  if (subEl) subEl.textContent = step.sub;
  if (bodyEl) bodyEl.innerHTML = step.render();
  if (countEl) countEl.textContent = `${wizardStep + 1} of ${total}`;

  if (progressEl) {
    progressEl.innerHTML = Array.from({ length: total }, (_, i) =>
      `<div class="wizard-progress-step ${i < wizardStep ? 'done' : i === wizardStep ? 'active' : ''}"></div>`
    ).join('');
  }

  if (prevBtn) prevBtn.style.visibility = wizardStep === 0 ? 'hidden' : 'visible';
  if (nextBtn) nextBtn.textContent = wizardStep === total - 1 ? 'Start Planning →' : 'Next →';
}

/* ---- GOOGLE MAPS INTEGRATION ---- */
function tourMapReady() {
  tourState.mapsReady = true;
  // If planner is currently visible, init the map now
  const tourView = document.getElementById('view-tour');
  if (tourView?.classList.contains('active')) {
    TourMap.init('tourMap');
  }
}
